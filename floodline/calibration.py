"""Correct each kind of reading for the bias and spread measured on labelled photos.

The raw readings are honest about the catalog's uncertainty (a knee is 0.44-0.49 m
high) but not about the model's (was the water really at the knee?). On FloodDET,
every kind of reading ran high and its interval was too narrow. `evals/calibrate.py`
fits, per kind, an additive bias and a factor on sigma by cross-validation, and
writes `data/calibration.json`, which this module applies at run time.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from floodline.config import DATA
from floodline.estimate import Reading

PATH = DATA / "calibration.json"
KINDS = ("landmark", "fraction", "scale", "spark", "closeup-landmark", "closeup-fraction")


def kind_of(source: str) -> str:
    return source.split(":", 1)[0]


@dataclass(frozen=True)
class KindCalibration:
    bias_m: float = 0.0  # subtracted from the reading's centre
    sigma_scale: float = 1.0
    sigma_floor_m: float = 0.04


@dataclass(frozen=True)
class Calibration:
    kinds: dict[str, KindCalibration] = field(default_factory=dict)
    combine_factor: float = 1.0  # readings from one photo share errors; widen the combination
    meta: dict = field(default_factory=dict)

    def apply(self, readings: list[Reading]) -> list[Reading]:
        out = []
        for r in readings:
            k = self.kinds.get(kind_of(r.source))
            if k is None:
                out.append(r)
                continue
            mu = r.mean - k.bias_m
            sd = max(k.sigma_floor_m, r.sigma * k.sigma_scale)
            out.append(
                Reading(
                    source=r.source,
                    low_m=max(0.0, mu - 2 * sd),
                    high_m=max(0.0, mu + 2 * sd),
                    note=f"{r.note}; raw {r.low_m:.2f}-{r.high_m:.2f} m".strip("; "),
                    mu=mu,
                    sd=sd,
                )
            )
        return out

    def to_dict(self) -> dict:
        return {
            "kinds": {k: v.__dict__ for k, v in self.kinds.items()},
            "combine_factor": self.combine_factor,
            "meta": self.meta,
        }

    @classmethod
    def from_dict(cls, d: dict) -> Calibration:
        return cls(
            kinds={k: KindCalibration(**v) for k, v in d.get("kinds", {}).items()},
            combine_factor=d.get("combine_factor", 1.0),
            meta=d.get("meta", {}),
        )


IDENTITY = Calibration()


def load(path: Path = PATH) -> Calibration:
    return Calibration.from_dict(json.loads(path.read_text())) if path.exists() else IDENTITY


@lru_cache
def default() -> Calibration:
    return load()
