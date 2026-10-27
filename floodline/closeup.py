"""A second, closer look at each reference object.

In a street photo a wading person can be 60 pixels tall, too small to tell a knee
from a thigh. Floodline crops every object Spark found, enlarges it, and asks
Spark once more, about all crops in one call, where the water reaches on each.
"""

from __future__ import annotations

from typing import Any

from PIL import Image

from floodline.imaging import Media, encode_jpeg
from floodline.meta.client import ModelClient
from floodline.perceive import LANDMARKS

MAX_CROPS = 6
MIN_SIDE = 448
PAD = 0.25

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "objects": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "crop": {"type": "integer"},
                    "waterline_landmark": {"type": "string", "enum": LANDMARKS},
                    "submerged_fraction": {"type": "number"},
                    "base_hidden_by_water": {"type": "boolean"},
                    "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
                },
                "required": [
                    "crop",
                    "waterline_landmark",
                    "submerged_fraction",
                    "base_hidden_by_water",
                    "confidence",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["objects"],
    "additionalProperties": False,
}

PROMPT = """These are close-up crops, numbered from 1 in the order given, of objects standing in
floodwater. Crop {listing}.

For each crop, look at where the water surface meets the object.
- waterline_landmark: the part of the object at the water surface (scooter: below_wheel_hub,
  wheel_hub, footboard, seat, above_seat; car: below_wheel_hub, wheel_hub, sill, door_handle,
  bonnet, roof; person: ankle, knee, thigh, waist, chest, shoulder; bus: wheel_hub, door_step,
  window_bottom; bicycle: below_wheel_hub, wheel_hub, seat). unclear if you can't see it.
- submerged_fraction: share of the object's full height under water, 0 to 1.
- base_hidden_by_water: true if the object's base is under the water.
- confidence: how clearly the crop shows the waterline.
Judge each crop on its own; do not guess from the other crops."""


def crops(img: Image.Image, boxes: list[tuple[int, int, int, int]]) -> list[Image.Image]:
    out = []
    for x1, y1, x2, y2 in boxes:
        w, h = x2 - x1, y2 - y1
        px, py = int(w * PAD) + 8, int(h * PAD) + 8
        c = img.crop(
            (max(0, x1 - px), max(0, y1 - py), min(img.width, x2 + px), min(img.height, y2 + py))
        )
        scale = max(1.0, MIN_SIDE / max(1, min(c.size)))
        if scale > 1:
            c = c.resize((int(c.width * scale), int(c.height * scale)), Image.Resampling.LANCZOS)
        out.append(c)
    return out


def closeup(
    client: ModelClient,
    img: Image.Image,
    labels: list[str],
    boxes: list[tuple[int, int, int, int]],
    parent_key: str | None = None,
) -> dict[int, dict[str, Any]]:
    """Return {object index: closer judgement} for up to MAX_CROPS objects."""
    if not boxes:
        return {}
    chosen = list(range(len(boxes)))[:MAX_CROPS]
    picked = [boxes[i] for i in chosen]
    images = [
        Media(
            encode_jpeg(c),
            "image/jpeg",
            key=f"{parent_key}/crop{n}:{','.join(map(str, box))}" if parent_key else None,
        )
        for n, (c, box) in enumerate(zip(crops(img, picked), picked, strict=True))
    ]
    listing = "; ".join(f"{n + 1} is a {labels[i]}" for n, i in enumerate(chosen))
    answer = client.spark_json(
        system="You are an object grounding expert helping flood rescue teams read photos.",
        text=PROMPT.format(listing=listing),
        images=images,
        schema_name="flood_closeup",
        schema=SCHEMA,
        effort="medium",
    )
    out = {}
    for item in answer.get("objects", []):
        n = item.get("crop", 0) - 1
        if 0 <= n < len(chosen):
            out[chosen[n]] = item
    return out
