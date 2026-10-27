"""Depth to a decision a rescue driver can act on.

A vehicle class is passable only when the depth is very unlikely to exceed its
limit. Using the probability rather than the mean keeps a wide, uncertain
estimate from being reported as safe.
"""

from __future__ import annotations

from dataclasses import dataclass

from floodline.catalog import VehicleClass
from floodline.estimate import DepthEstimate

PASSABLE_BELOW = 0.05  # chosen on out-of-fold FloodDET results: halves unsafe "passable" calls
IMPASSABLE_ABOVE = 0.60


@dataclass(frozen=True)
class Verdict:
    vehicle: VehicleClass
    limit_m: float
    p_exceed: float
    status: str  # passable | risky | impassable

    def to_dict(self) -> dict:
        return {
            "vehicle": self.vehicle.id,
            "name_en": self.vehicle.name_en,
            "name_vi": self.vehicle.name_vi,
            "limit_m": self.limit_m,
            "p_exceed": round(self.p_exceed, 3),
            "status": self.status,
        }


def status_for(p_exceed: float) -> str:
    if p_exceed < PASSABLE_BELOW:
        return "passable"
    if p_exceed > IMPASSABLE_ABOVE:
        return "impassable"
    return "risky"


def assess(
    estimate: DepthEstimate, vehicles: list[VehicleClass], *, flowing: bool = False
) -> list[Verdict]:
    verdicts = []
    for v in vehicles:
        limit = v.max_depth_flowing_m if flowing and v.max_depth_flowing_m else v.max_depth_m
        p = estimate.prob_above(limit)
        verdicts.append(Verdict(vehicle=v, limit_m=limit, p_exceed=p, status=status_for(p)))
    return verdicts
