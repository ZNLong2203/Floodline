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
    touches_edge: bool = False  # cut off by the frame, so its width can't be trusted

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
    sub = obj[:, cols]
    bottoms = height - 1 - np.argmax(sub[::-1], axis=0)

    # water anywhere in [bottom - band, bottom + band], via cumulative sums per column
    cum = np.vstack(
        [
            np.zeros((1, len(cols)), dtype=np.int32),
            np.cumsum(water[:, cols], axis=0, dtype=np.int32),
        ]
    )
    lo = np.clip(bottoms - band, 0, height)
    hi = np.clip(bottoms + band + 1, 0, height)
    idx = np.arange(len(cols))
    touching = bottoms[(cum[hi, idx] - cum[lo, idx]) > 0]

    fraction = len(touching) / len(cols)
    if fraction < min_contact:
        return None

    waterline_y = float(np.median(touching))
    visible = waterline_y - top_y
    if visible <= 1:
        return None

    above = obj[: int(waterline_y) + 1]
    rows = above[above.any(axis=1)]
    if len(rows):
        first = np.argmax(rows, axis=1)
        last = rows.shape[1] - 1 - np.argmax(rows[:, ::-1], axis=1)
        width_px = float(np.percentile(last - first + 1, 95))
    else:
        width_px = 0.0

    return Contact(
        top_y=top_y,
        waterline_y=waterline_y,
        visible_height_px=visible,
        width_px=width_px,
        contact_fraction=fraction,
        columns=len(cols),
        touches_edge=bool(cols[0] == 0 or cols[-1] == obj.shape[1] - 1 or top_y == 0),
    )


def union(masks: list[np.ndarray], shape: tuple[int, int]) -> np.ndarray:
    out = np.zeros(shape, dtype=bool)
    for m in masks:
        out |= m
    return out
