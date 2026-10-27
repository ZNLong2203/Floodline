"""Turn readings into one depth with an honest interval.

Each estimator reports an interval in metres. An interval becomes a normal
(mean, sigma) with the interval as roughly +-2 sigma. Outliers are dropped by
median absolute deviation, the rest are combined by inverse variance, and the
spread between estimators is kept so disagreement widens the result instead of
being averaged away.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from statistics import median

MIN_SIGMA_M = 0.04


@dataclass(frozen=True)
class Reading:
    """One estimator's view of the depth at the photo's location."""

    source: str  # e.g. "scale:scooter#2", "landmark:person#1", "spark:holistic"
    low_m: float
    high_m: float
    note: str = ""
    # Set by calibration: the centre and sigma, when the interval was clipped at 0
    mu: float | None = None
    sd: float | None = None

    @property
    def mean(self) -> float:
        return self.mu if self.mu is not None else (self.low_m + self.high_m) / 2

    def to_dict(self) -> dict:
        return {
            "source": self.source,
            "low_m": round(self.low_m, 3),
            "high_m": round(self.high_m, 3),
            "mean_m": round(self.mean, 3),
            "note": self.note,
        }

    @property
    def sigma(self) -> float:
        if self.sd is not None:
            return self.sd
        return max(MIN_SIGMA_M, (self.high_m - self.low_m) / 4)


@dataclass
class DepthEstimate:
    mean_m: float
    sigma_m: float
    used: list[Reading] = field(default_factory=list)
    rejected: list[Reading] = field(default_factory=list)

    @property
    def low_m(self) -> float:
        return max(0.0, self.mean_m - 2 * self.sigma_m)

    @property
    def high_m(self) -> float:
        return max(0.0, self.mean_m + 2 * self.sigma_m)

    def prob_above(self, threshold_m: float) -> float:
        """P(depth > threshold) under the normal model."""
        z = (threshold_m - self.mean_m) / self.sigma_m
        return 0.5 * math.erfc(z / math.sqrt(2))

    def to_dict(self) -> dict:
        return {
            "mean_m": round(self.mean_m, 3),
            "sigma_m": round(self.sigma_m, 3),
            "low_m": round(self.low_m, 3),
            "high_m": round(self.high_m, 3),
            "used": [r.to_dict() for r in self.used],
            "rejected": [r.to_dict() for r in self.rejected],
        }


def combine(
    readings: list[Reading], *, mad_k: float = 3.0, sigma_factor: float = 1.0
) -> DepthEstimate | None:
    """Combine readings into one estimate, or None when there are none.

    `sigma_factor` widens the result: readings from one photo share the model's
    errors, so inverse-variance weighting alone is overconfident.
    """
    readings = [r for r in readings if r.high_m >= 0 and r.high_m >= r.low_m]
    if not readings:
        return None
    if len(readings) >= 3:
        centre = median(r.mean for r in readings)
        mad = median(abs(r.mean - centre) for r in readings)
        scale = max(1.4826 * mad, 0.08)
        used = [r for r in readings if abs(r.mean - centre) <= mad_k * scale]
        rejected = [r for r in readings if r not in used]
    else:
        used, rejected = list(readings), []

    weights = [1 / r.sigma**2 for r in used]
    total = sum(weights)
    mean = sum(w * r.mean for w, r in zip(weights, used, strict=True)) / total
    sigma = math.sqrt(1 / total)
    if len(used) > 1:
        spread = math.sqrt(
            sum(w * (r.mean - mean) ** 2 for w, r in zip(weights, used, strict=True)) / total
        )
        sigma = max(sigma, spread)
    sigma *= sigma_factor
    return DepthEstimate(
        mean_m=max(0.0, mean), sigma_m=max(sigma, MIN_SIGMA_M), used=used, rejected=rejected
    )
