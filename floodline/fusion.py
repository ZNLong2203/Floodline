"""Merge reports into a depth per street segment.

A photo says something about the street it was taken on and a little about the
streets next to it. Each report's reading is widened with distance and with age,
so a fresh photo on the segment outweighs an old one two blocks away, and water
that has had hours to recede is not trusted as if it were measured now.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from floodline.catalog import VehicleClass
from floodline.estimate import DepthEstimate, Reading, combine
from floodline.passability import Verdict, assess
from floodline.roads import Roads

RADIUS_M = 120.0
SIGMA_PER_M = 0.003  # a street rises or falls ~0.3 m per 100 m in the worst plausible case
HALF_LIFE_H = 3.0  # uncertainty doubles every three hours


@dataclass
class Report:
    id: str
    lat: float
    lon: float
    at: float  # unix seconds
    estimate: DepthEstimate
    flowing: bool = False


@dataclass
class SegmentState:
    estimate: DepthEstimate
    verdicts: list[Verdict]
    reports: list[str] = field(default_factory=list)

    def status_for(self, vehicle_id: str) -> str:
        for v in self.verdicts:
            if v.vehicle.id == vehicle_id:
                return v.status
        return "unknown"


def _widen(r: Report, distance_m: float, now: float) -> Reading:
    age_h = max(0.0, (now - r.at) / 3600)
    sigma = math.hypot(r.estimate.sigma_m, SIGMA_PER_M * distance_m)
    sigma *= 2 ** (age_h / HALF_LIFE_H)
    return Reading(
        source=f"report:{r.id}",
        low_m=max(0.0, r.estimate.mean_m - 2 * sigma),
        high_m=r.estimate.mean_m + 2 * sigma,
        note=f"{distance_m:.0f} m away, {age_h:.1f} h old",
    )


def fuse(
    reports: list[Report], roads: Roads, vehicles: list[VehicleClass], now: float
) -> dict[str, SegmentState]:
    """Depth and passability for every segment that has a report within reach."""
    by_segment: dict[str, list[tuple[Report, float]]] = {}
    for r in reports:
        for seg_id, dist in roads.nearby_segments(r.lat, r.lon, RADIUS_M):
            by_segment.setdefault(seg_id, []).append((r, dist))

    states: dict[str, SegmentState] = {}
    for seg_id, items in by_segment.items():
        readings = [_widen(r, d, now) for r, d in items]
        est = combine(readings)
        if est is None:
            continue
        flowing = any(r.flowing for r, _ in items)
        states[seg_id] = SegmentState(
            estimate=est,
            verdicts=assess(est, vehicles, flowing=flowing),
            reports=[r.id for r, _ in items],
        )
    return states
