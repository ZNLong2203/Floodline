"""Measure, in pixels, where the water meets an object.

Everything here is deterministic. The models find the water and the objects; this
module only reads the masks they return, so every number can be checked by eye
against the overlay.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Contact:
    """How an object meets the water, in source-image pixels."""

    top_y: float  # highest row of the object
    waterline_y: float  # row where the object disappears into the water
    visible_height_px: float  # waterline_y - top_y
    width_px: float  # horizontal extent of the visible object
    contact_fraction: float  # share of the object's columns whose bottom edge touches water
    columns: int  # columns the object spans

    def to_dict(self) -> dict[str, float]:
        return {k: round(float(v), 2) for k, v in self.__dict__.items()}


def waterline_contact(
    obj: np.ndarray,
    water: np.ndarray,
    *,
    band: int | None = None,
    min_contact: float = 0.35,
) -> Contact | None:
    """Find the waterline on `obj`, or None when the object is not standing in the water.

    For every column of the object mask, take its lowest pixel and look a few rows
    below it (and inside it, since masks of the two overlap at the edge). A column
    touches the water when water is found there. The waterline is the median bottom
    row over the touching columns; a minority of touching columns means the object's
    base is above water or hidden by something else, so no reading is made.
    """
    if obj.shape != water.shape:
        raise ValueError("object and water masks must have the same shape")
    if not obj.any():
        return None
    height = obj.shape[0]
    band = band or max(3, round(height * 0.015))

    cols = np.flatnonzero(obj.any(axis=0))
    rows_any = np.flatnonzero(obj.any(axis=1))
    top_y = float(rows_any[0])

    # lowest object pixel per column: last True index along axis 0
    flipped = obj[::-1, cols]
    bottoms = height - 1 - np.argmax(flipped, axis=0)

    touching: list[int] = []
    for col, bottom in zip(cols, bottoms, strict=True):
        lo = max(0, bottom - band)
        hi = min(height, bottom + band + 1)
        if water[lo:hi, col].any():
            touching.append(int(bottom))

    fraction = len(touching) / len(cols)
    if fraction < min_contact:
        return None

    waterline_y = float(np.median(touching))
    visible = waterline_y - top_y
    if visible <= 1:
        return None

    above = obj[: int(waterline_y) + 1]
    widths = []
    for row in above[above.any(axis=1)]:
        xs = np.flatnonzero(row)
        widths.append(xs[-1] - xs[0] + 1)
    width_px = float(np.percentile(widths, 95)) if widths else 0.0

    return Contact(
        top_y=top_y,
        waterline_y=waterline_y,
        visible_height_px=visible,
        width_px=width_px,
        contact_fraction=fraction,
        columns=len(cols),
    )


def union(masks: list[np.ndarray], shape: tuple[int, int]) -> np.ndarray:
    out = np.zeros(shape, dtype=bool)
    for m in masks:
        out |= m
    return out
