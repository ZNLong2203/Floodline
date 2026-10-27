import time

from floodline.catalog import VehicleClass
from floodline.estimate import Reading, combine
from floodline.fusion import Report, fuse
from floodline.roads import Roads

# A 3x2 grid ~110 m apart:  1 - 2 - 3
#                           |   |   |
#                           4 - 5 - 6
NODES = {
    1: (16.4700, 107.5900),
    2: (16.4700, 107.5910),
    3: (16.4700, 107.5920),
    4: (16.4690, 107.5900),
    5: (16.4690, 107.5910),
    6: (16.4690, 107.5920),
}
WAYS = [
    {"id": 10, "name": "Top", "highway": "residential", "nodes": [1, 2, 3]},
    {"id": 11, "name": "Bottom", "highway": "residential", "nodes": [4, 5, 6]},
    {"id": 12, "name": "A", "highway": "residential", "nodes": [1, 4]},
    {"id": 13, "name": "B", "highway": "residential", "nodes": [2, 5]},
    {"id": 14, "name": "C", "highway": "residential", "nodes": [3, 6]},
]
VEHICLES = [
    VehicleClass("scooter", "scooter", "xe máy", 0.30, None),
    VehicleClass("truck", "truck", "xe tải", 0.60, None),
]


def roads():
    return Roads(NODES, WAYS)


def test_snaps_to_nearest_segment():
    r = roads()
    near = r.nearby_segments(16.47001, 107.5905, 30)
    assert near[0][0] == "1-2"


def test_route_avoids_blocked_segment():
    r = roads()
    direct = r.route((16.4700, 107.5900), (16.4700, 107.5920))
    assert direct["segments"] == ["1-2", "2-3"]
    detour = r.route((16.4700, 107.5900), (16.4700, 107.5920), blocked={"2-3"})
    assert "2-3" not in detour["segments"]
    assert detour["length_m"] > direct["length_m"]


def test_fresh_deep_report_blocks_scooters_on_its_street_only():
    r = roads()
    now = time.time()
    deep = combine([Reading("x", 0.55, 0.65)])
    states = fuse([Report("r1", 16.47001, 107.5915, now, deep)], r, VEHICLES, now)
    assert states["2-3"].status_for("scooter") == "impassable"
    far = [sid for sid in states if sid in ("4-5",)]
    for sid in far:
        assert states[sid].estimate.sigma_m > states["2-3"].estimate.sigma_m


def test_old_reports_lose_weight():
    r = roads()
    now = time.time()
    est = combine([Reading("x", 0.35, 0.45)])
    fresh = fuse([Report("a", 16.47, 107.5915, now, est)], r, VEHICLES, now)["2-3"]
    stale = fuse([Report("a", 16.47, 107.5915, now - 6 * 3600, est)], r, VEHICLES, now)["2-3"]
    assert stale.estimate.sigma_m > 3 * fresh.estimate.sigma_m
