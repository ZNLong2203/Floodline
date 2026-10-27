"""Prepare photos for the models and draw what the models found."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageDraw, ImageOps

from floodline.meta.client import Media

MAX_SIDE = 1600

PALETTE = [
    (0, 168, 232),
    (255, 170, 0),
    (230, 57, 70),
    (106, 190, 48),
    (155, 89, 182),
    (255, 99, 196),
    (26, 188, 156),
    (241, 196, 15),
]
WATER = (30, 90, 255)


def normalise(data: bytes) -> tuple[Media, Image.Image]:
    """Apply EXIF rotation, cap the long side and re-encode as JPEG.

    Every model sees this exact image, so all coordinates share one pixel space.
    """
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return Media(buf.getvalue(), "image/jpeg"), img


def to_pixels(box: dict, size: tuple[int, int]) -> tuple[int, int, int, int]:
    """Convert a 0-1000 normalised box from Spark into pixel corners."""
    w, h = size

    def clamp(v: float, hi: int) -> int:
        return int(max(0, min(hi - 1, round(v))))

    return (
        clamp(box["x_min"] * w / 1000, w),
        clamp(box["y_min"] * h / 1000, h),
        clamp(box["x_max"] * w / 1000, w),
        clamp(box["y_max"] * h / 1000, h),
    )


def overlay(
    img: Image.Image,
    water: np.ndarray | None,
    objects: list[dict],
) -> bytes:
    """Draw the water mask, each object's mask and its waterline. Returns PNG bytes.

    `objects` items carry `mask` (bool array), `label`, `index` and optionally
    `waterline_y` and `x_range`.
    """
    base = img.convert("RGBA")
    layer = np.zeros((img.height, img.width, 4), dtype=np.uint8)
    if water is not None:
        layer[water] = (*WATER, 90)
    for obj in objects:
        colour = PALETTE[obj["index"] % len(PALETTE)]
        layer[obj["mask"]] = (*colour, 130)
    out = Image.alpha_composite(base, Image.fromarray(layer, "RGBA"))
    draw = ImageDraw.Draw(out)
    for obj in objects:
        colour = PALETTE[obj["index"] % len(PALETTE)]
        ys, xs = np.nonzero(obj["mask"])
        if len(xs) == 0:
            continue
        x0, x1 = int(xs.min()), int(xs.max())
        if obj.get("waterline_y") is not None:
            y = obj["waterline_y"]
            draw.line([(x0 - 6, y), (x1 + 6, y)], fill=(255, 255, 255, 255), width=5)
            draw.line([(x0 - 6, y), (x1 + 6, y)], fill=(*colour, 255), width=3)
        draw.text((x0 + 4, int(ys.min()) + 4), f"{obj['index'] + 1} {obj['label']}",
                  fill=(255, 255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0, 255))
    buf = io.BytesIO()
    out.convert("RGB").save(buf, format="JPEG", quality=85)
    return buf.getvalue()
