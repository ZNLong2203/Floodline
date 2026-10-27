"""Known sizes of reference objects and the depths each vehicle can cross.

Values live in `data/catalog.yaml`, each with the sources it came from, so a
coordinator can see why Floodline believes a scooter's seat is 0.76 m high.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml

from floodline.config import DATA

Range = tuple[float, float]


@dataclass(frozen=True)
class ObjectSpec:
    id: str
    name_en: str
    name_vi: str
    sam_prompt: str
    height_m: Range
    length_m: Range | None  # horizontal size seen from the side
    width_m: Range | None  # horizontal size seen from the front or back
    landmarks_m: dict[str, Range] = field(default_factory=dict)
    sources: tuple[str, ...] = ()


@dataclass(frozen=True)
class VehicleClass:
    id: str
    name_en: str
    name_vi: str
    max_depth_m: float
    max_depth_flowing_m: float | None
    sources: tuple[str, ...] = ()


@dataclass(frozen=True)
class Catalog:
    objects: dict[str, ObjectSpec]
    vehicles: list[VehicleClass]
    sources: dict[str, dict]


def _range(value) -> Range | None:
    if value is None:
        return None
    lo, hi = value
    return (float(lo), float(hi))


def load(path: Path | None = None) -> Catalog:
    raw = yaml.safe_load((path or DATA / "catalog.yaml").read_text())
    objects = {
        key: ObjectSpec(
            id=key,
            name_en=o["name_en"],
            name_vi=o["name_vi"],
            sam_prompt=o["sam_prompt"],
            height_m=_range(o["height_m"]),
            length_m=_range(o.get("length_m")),
            width_m=_range(o.get("width_m")),
            landmarks_m={k: _range(v) for k, v in (o.get("landmarks_m") or {}).items()},
            sources=tuple(o.get("sources", ())),
        )
        for key, o in raw["objects"].items()
    }
    vehicles = [
        VehicleClass(
            id=v["id"],
            name_en=v["name_en"],
            name_vi=v["name_vi"],
            max_depth_m=float(v["max_depth_m"]),
            max_depth_flowing_m=(
                float(v["max_depth_flowing_m"]) if v.get("max_depth_flowing_m") else None
            ),
            sources=tuple(v.get("sources", ())),
        )
        for v in raw["vehicles"]
    ]
    return Catalog(objects=objects, vehicles=vehicles, sources=raw.get("sources", {}))


@lru_cache
def default() -> Catalog:
    return load()
