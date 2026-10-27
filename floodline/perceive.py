"""Ask Muse Spark what is in a flood photo, and where.

Spark is used for what a model is good at: recognising reference objects, saying
which way they face, judging where on each object the water sits, and noticing
what makes a photo untrustworthy. It does not do the arithmetic.
"""

from __future__ import annotations

from typing import Any

from floodline.meta.client import Media, ModelClient

CLASSES = ["scooter", "car", "person", "door", "bicycle", "bus", "truck"]

LANDMARKS = [
    "below_wheel_hub",
    "wheel_hub",
    "footboard",
    "seat",
    "above_seat",
    "sill",
    "door_handle",
    "bonnet",
    "roof",
    "ankle",
    "knee",
    "thigh",
    "waist",
    "chest",
    "shoulder",
    "door_step",
    "window_bottom",
    "unclear",
]

QUALITY_FLAGS = [
    "motion_blur",
    "low_light",
    "strong_reflection",
    "heavy_occlusion",
    "steep_camera_angle",
    "water_surface_unclear",
    "screenshot_or_edited",
    "not_a_real_photo",
]

_box = {
    "type": "object",
    "properties": {
        "x_min": {"type": "integer"},
        "y_min": {"type": "integer"},
        "x_max": {"type": "integer"},
        "y_max": {"type": "integer"},
    },
    "required": ["x_min", "y_min", "x_max", "y_max"],
    "additionalProperties": False,
}

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "is_flood_photo": {"type": "boolean"},
        "water_visible": {"type": "boolean"},
        "setting": {"type": "string", "enum": ["street", "alley", "indoors", "field", "other"]},
        "quality_flags": {"type": "array", "items": {"type": "string", "enum": QUALITY_FLAGS}},
        "water_flow": {"type": "string", "enum": ["still", "slow", "fast", "unclear"]},
        "references": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string", "enum": CLASSES},
                    "box": _box,
                    "orientation": {
                        "type": "string",
                        "enum": ["side", "front_or_back", "oblique", "unclear"],
                    },
                    "standing_in_water": {"type": "boolean"},
                    "fully_visible_above_water": {"type": "boolean"},
                    "waterline_landmark": {"type": "string", "enum": LANDMARKS},
                    "submerged_fraction": {"type": "number"},
                },
                "required": [
                    "label",
                    "box",
                    "orientation",
                    "standing_in_water",
                    "fully_visible_above_water",
                    "waterline_landmark",
                    "submerged_fraction",
                ],
                "additionalProperties": False,
            },
        },
        "people": {
            "type": "object",
            "properties": {
                "count": {"type": "integer"},
                "children_or_elderly": {"type": "boolean"},
                "on_roof_or_upper_floor": {"type": "boolean"},
                "signalling_for_help": {"type": "boolean"},
            },
            "required": ["count", "children_or_elderly", "on_roof_or_upper_floor",
                         "signalling_for_help"],
            "additionalProperties": False,
        },
        "holistic_depth_m": {
            "type": "object",
            "properties": {"low": {"type": "number"}, "high": {"type": "number"}},
            "required": ["low", "high"],
            "additionalProperties": False,
        },
        "summary_vi": {"type": "string"},
    },
    "required": [
        "is_flood_photo",
        "water_visible",
        "setting",
        "quality_flags",
        "water_flow",
        "references",
        "people",
        "holistic_depth_m",
        "summary_vi",
    ],
    "additionalProperties": False,
}

SYSTEM = "You are an object grounding expert helping flood rescue teams read photos."

PROMPT = """This photo was sent by a resident during a flood. Find the reference objects of
known size that stand in or beside the water: scooters/motorbikes, cars, people, doors or
shop shutters, bicycles, buses, trucks. Do not miss any that touch the water; list at most 8,
preferring the largest and clearest.

For each object give:
- box: its full bounding box on a normalized 0-1000 grid, (0,0) top-left; include the part
  hidden under water as best you can infer it.
- orientation: side, front_or_back, oblique, or unclear (how the camera sees it).
- standing_in_water: true only if its base is on the flooded ground (not on a step or kerb
  above the water, not floating).
- fully_visible_above_water: true if nothing other than water hides the part above water.
- waterline_landmark: the part of the object the water surface reaches (for a scooter:
  below_wheel_hub, wheel_hub, footboard, seat, above_seat; for a car: below_wheel_hub,
  wheel_hub, sill, door_handle, bonnet, roof; for a person: ankle, knee, thigh, waist, chest,
  shoulder; for a bus: wheel_hub, door_step, window_bottom). Use unclear when you can't tell.
- submerged_fraction: the share of the object's full height that is under water, 0 to 1.

Also report the photo's quality problems, whether the water seems to flow, the people you
see, your own overall depth range in metres at the deepest object, and a one-sentence
summary in Vietnamese for a rescue coordinator."""


def perceive(client: ModelClient, image: Media) -> dict[str, Any]:
    return client.spark_json(
        system=SYSTEM,
        text=PROMPT,
        images=[image],
        schema_name="flood_photo",
        schema=SCHEMA,
        effort="low",
    )
