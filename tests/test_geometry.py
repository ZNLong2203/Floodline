import numpy as np
import pytest

from floodline.catalog import ObjectSpec, VehicleClass
from floodline.estimate import Reading, combine
from floodline.geometry import waterline_contact
from floodline.passability import assess
from floodline.readings import fraction_reading, landmark_reading, scale_reading

H, W = 400, 600


def scene(water_top: int, obj_box: tuple[int, int, int, int]):
    """A rectangle object standing in water whose surface is at row `water_top`.

    The object mask only covers the part above the water, as SAM returns it.
    """
    x1, y1, x2, y2 = obj_box
    water = np.zeros((H, W), dtype=bool)
    water[water_top:, :] = True
    obj = np.zeros((H, W), dtype=bool)
    obj[y1 : min(y2, water_top), x1:x2] = True
    return obj, water


def test_waterline_found_where_object_meets_water():
    obj, water = scene(250, (100, 100, 300, 320))
    c = waterline_contact(obj, water)
    assert c is not None
    assert c.top_y == 100
    assert c.waterline_y == pytest.approx(249, abs=1)
    assert c.width_px == pytest.approx(200, abs=1)
    assert c.contact_fraction == 1.0


def test_object_above_water_gives_no_reading():
    obj, water = scene(350, (100, 100, 300, 200))  # base at 200, water from 350
    assert waterline_contact(obj, water) is None


def test_partial_occlusion_below_threshold_is_rejected():
    obj, water = scene(250, (100, 100, 300, 320))
    water[:, 100:250] = False  # most of the base hidden by something that is not water
    assert waterline_contact(obj, water) is None


SCOOTER = ObjectSpec(
    id="scooter",
    name_en="scooter",
    name_vi="xe máy",
    sam_prompt="scooter",
    height_m=(1.05, 1.10),
    length_m=(1.85, 1.95),
    width_m=(0.68, 0.72),
    landmarks_m={"seat": (0.74, 0.80), "wheel_hub": (0.28, 0.32)},
)


def test_scale_reading_recovers_known_depth():
    # 1.9 m long scooter drawn 380 px wide -> 200 px per metre.
    # Height 1.075 m = 215 px; 0.4 m under water -> 135 px visible.
    obj, water = scene(285, (100, 150, 480, 365))
    c = waterline_contact(obj, water)
    r = scale_reading("scooter#1", SCOOTER, "side", c)
    assert r is not None
    assert r.low_m <= 0.40 <= r.high_m
    assert r.high_m - r.low_m < 0.2


def test_scale_reading_skips_oblique_objects():
    obj, water = scene(285, (100, 150, 480, 365))
    c = waterline_contact(obj, water)
    assert scale_reading("scooter#1", SCOOTER, "oblique", c) is None


def test_landmark_and_fraction_readings():
    assert landmark_reading("s", SCOOTER, "seat").mean == pytest.approx(0.77)
    assert landmark_reading("s", SCOOTER, "knee") is None
    r = fraction_reading("s", SCOOTER, 0.5)
    assert r.low_m < 0.55 < r.high_m


def test_combine_rejects_outlier_and_keeps_spread():
    readings = [
        Reading("a", 0.35, 0.45),
        Reading("b", 0.38, 0.50),
        Reading("c", 0.30, 0.46),
        Reading("d", 1.6, 1.8),  # a mask that swallowed a reflection
    ]
    est = combine(readings)
    assert [r.source for r in est.rejected] == ["d"]
    assert 0.35 < est.mean_m < 0.45
    assert est.low_m < est.mean_m < est.high_m


def test_disagreement_widens_interval():
    tight = combine([Reading("a", 0.39, 0.41), Reading("b", 0.39, 0.41)])
    split = combine([Reading("a", 0.19, 0.21), Reading("b", 0.59, 0.61)])
    assert split.sigma_m > 3 * tight.sigma_m


def test_passability_uses_probability_not_mean():
    vehicles = [
        VehicleClass("scooter", "scooter", "xe máy", 0.30, None),
        VehicleClass("truck", "truck", "xe tải", 0.60, 0.45),
    ]
    est = combine([Reading("a", 0.20, 0.36)])  # mean 0.28 but could exceed 0.30
    by_id = {v.vehicle.id: v for v in assess(est, vehicles)}
    assert by_id["scooter"].status == "risky"
    assert by_id["truck"].status == "passable"
    flowing = {v.vehicle.id: v for v in assess(est, vehicles, flowing=True)}
    assert flowing["truck"].limit_m == 0.45
