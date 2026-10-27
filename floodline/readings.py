"""Convert one object's evidence into depth readings, using the catalog."""

from __future__ import annotations

from itertools import product

from floodline.catalog import ObjectSpec
from floodline.estimate import Reading
from floodline.geometry import Contact

FRACTION_SLACK = 0.12
PIXEL_SLACK = 2.0
WIDTH_SLACK = 0.04


def scale_reading(tag: str, spec: ObjectSpec, orientation: str, contact: Contact) -> Reading | None:
    """Depth = full height - visible height, with pixels turned into metres by the
    object's known horizontal size. Only for objects seen squarely from the side or
    the front, where that size is the one in the photo."""
    if orientation == "side":
        size = spec.length_m
    elif orientation == "front_or_back":
        size = spec.width_m
    else:
        return None
    if size is None or contact.width_px < 8 or contact.touches_edge:
        return None

    depths = []
    for h_m, d_m, w_k, v_k in product(
        spec.height_m, size, (1 - WIDTH_SLACK, 1 + WIDTH_SLACK), (-PIXEL_SLACK, PIXEL_SLACK)
    ):
        metres_per_px = d_m / (contact.width_px * w_k)
        depths.append(h_m - (contact.visible_height_px + v_k) * metres_per_px)
    low, high = min(depths), max(depths)
    if high < -0.15:
        # the object reads as taller than it can be: wrong class, size or mask
        return None
    return Reading(
        source=f"scale:{tag}",
        low_m=max(0.0, low),
        high_m=max(0.0, high),
        note=f"{contact.visible_height_px:.0f}px visible of {contact.width_px:.0f}px wide",
    )


def landmark_reading(tag: str, spec: ObjectSpec, landmark: str) -> Reading | None:
    """Depth from the part of the object the water reaches, e.g. a scooter's seat."""
    rng = spec.landmarks_m.get(landmark)
    if rng is None:
        return None
    return Reading(source=f"landmark:{tag}", low_m=rng[0], high_m=rng[1], note=landmark)


def fraction_reading(tag: str, spec: ObjectSpec, fraction: float) -> Reading | None:
    """Depth from the model's estimate of how much of the object is under water."""
    if not 0.0 <= fraction <= 1.0:
        return None
    low = max(0.0, fraction - FRACTION_SLACK) * spec.height_m[0]
    high = min(1.0, fraction + FRACTION_SLACK) * spec.height_m[1]
    return Reading(source=f"fraction:{tag}", low_m=low, high_m=high, note=f"{fraction:.2f}")
