"""Photo in, depth and passability out.

Muse Spark  -> which reference objects, where, facing which way, water at which part
SAM 3.1     -> the water, and a mask for every object Spark boxed
geometry    -> the waterline on each object, in pixels
catalog     -> pixels to metres, landmarks to metres
estimate    -> one depth with an interval, outliers named
passability -> per vehicle: passable, risky or impassable, with a probability
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from floodline import calibration as calibration_mod
from floodline import catalog as catalog_mod
from floodline.closeup import closeup
from floodline.estimate import DepthEstimate, Reading, combine
from floodline.geometry import Contact, union, waterline_contact
from floodline.imaging import normalise, overlay, to_pixels
from floodline.meta import sam
from floodline.meta.client import ModelClient
from floodline.passability import Verdict, assess
from floodline.perceive import perceive
from floodline.readings import fraction_reading, landmark_reading, scale_reading

WATER_PROMPTS = ("flood water", "water")

# Which estimators the pipeline uses. The eval harness switches them off one at a
# time to show what each adds.
ALL_ESTIMATORS = frozenset({"scale", "landmark", "fraction", "holistic", "closeup"})


@dataclass
class ObjectFinding:
    index: int
    label: str
    orientation: str
    landmark: str
    box_px: tuple[int, int, int, int]
    standing_in_water: bool
    sam_confidence: float | None
    contact: Contact | None
    readings: list[Reading] = field(default_factory=list)
    raw_readings: list[Reading] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "label": self.label,
            "orientation": self.orientation,
            "landmark": self.landmark,
            "box_px": list(self.box_px),
            "standing_in_water": self.standing_in_water,
            "sam_confidence": self.sam_confidence,
            "contact": self.contact.to_dict() if self.contact else None,
            "readings": [r.to_dict() for r in self.readings],
        }


@dataclass
class PhotoAnalysis:
    size: tuple[int, int]
    perception: dict[str, Any]
    objects: list[ObjectFinding]
    estimate: DepthEstimate | None
    verdicts: list[Verdict]
    overlay_jpeg: bytes
    image_jpeg: bytes
    water_fraction: float
    seconds: float
    warnings: list[str]
    raw_readings: list[Reading] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "size": list(self.size),
            "perception": self.perception,
            "objects": [o.to_dict() for o in self.objects],
            "estimate": self.estimate.to_dict() if self.estimate else None,
            "verdicts": [v.to_dict() for v in self.verdicts],
            "water_fraction": round(self.water_fraction, 4),
            "seconds": round(self.seconds, 2),
            "warnings": self.warnings,
            "calibration": calibration_mod.default().meta.get("fitted"),
        }


def segment_water(client: ModelClient, image, size) -> np.ndarray:
    for prompt in WATER_PROMPTS:
        segments = sam.parse(client.sam(prompt=prompt, image=image), size)
        if segments:
            return union([s.mask for s in segments], (size[1], size[0]))
    return np.zeros((size[1], size[0]), dtype=bool)


def analyse(
    client: ModelClient,
    photo: bytes,
    *,
    estimators: frozenset[str] = ALL_ESTIMATORS,
    flowing: bool | None = None,
    calibration: calibration_mod.Calibration | None = None,
    draw: bool = True,
    catalog: catalog_mod.Catalog | None = None,
) -> PhotoAnalysis:
    started = time.monotonic()
    image, img = normalise(photo)
    size = img.size
    cat = catalog or catalog_mod.default()
    cal = calibration if calibration is not None else calibration_mod.default()
    warnings: list[str] = []

    # The water mask does not depend on what Spark finds, so both run at once.
    with ThreadPoolExecutor(max_workers=2) as pool:
        water_job = pool.submit(segment_water, client, image, size)
        seen = perceive(client, image)
        water = water_job.result()
    if not seen.get("water_visible") and not water.any():
        water = None
    if water is None or not water.any():
        warnings.append("no water found in the photo")

    refs = [r for r in seen.get("references", []) if r["label"] in cat.objects][:8]
    boxes = [to_pixels(r["box"], size) for r in refs]
    masks: dict[str, sam.Segment] = {}
    closer: dict[int, dict[str, Any]] = {}
    wading = [i for i, r in enumerate(refs) if r["standing_in_water"]]
    with ThreadPoolExecutor(max_workers=2) as pool:
        closer_job = None
        if "closeup" in estimators and wading:
            closer_job = pool.submit(
                closeup, client, img, [refs[i]["label"] for i in wading], [boxes[i] for i in wading]
            )
        if refs and water is not None and water.any():
            prompt = sam.box_prompt(size, boxes)
            if prompt.strip():
                for seg in sam.parse(client.sam(prompt=prompt, image=image), size):
                    masks[seg.object_id] = seg
        if closer_job is not None:
            closer = {wading[k]: v for k, v in closer_job.result().items()}

    objects: list[ObjectFinding] = []
    readings: list[Reading] = []
    for i, (ref, box) in enumerate(zip(refs, boxes, strict=True)):
        spec = cat.objects[ref["label"]]
        seg = masks.get(str(i + 1))
        tag = f"{ref['label']}#{i + 1}"
        contact = None
        if seg is not None and water is not None:
            contact = waterline_contact(seg.mask, water)
        found = ObjectFinding(
            index=i,
            label=ref["label"],
            orientation=ref["orientation"],
            landmark=ref["waterline_landmark"],
            box_px=box,
            standing_in_water=ref["standing_in_water"],
            sam_confidence=seg.confidence if seg else None,
            contact=contact,
        )
        if ref["standing_in_water"]:
            candidates: list[Reading | None] = []
            if "scale" in estimators and contact and ref["fully_visible_above_water"]:
                candidates.append(scale_reading(tag, spec, ref["orientation"], contact))
            if "landmark" in estimators:
                candidates.append(landmark_reading(tag, spec, ref["waterline_landmark"]))
            if "fraction" in estimators:
                candidates.append(fraction_reading(tag, spec, ref["submerged_fraction"]))
            near = closer.get(i)
            if near is not None:
                lm = landmark_reading(tag, spec, near["waterline_landmark"])
                fr = fraction_reading(tag, spec, near["submerged_fraction"])
                for r, kind in ((lm, "closeup-landmark"), (fr, "closeup-fraction")):
                    if r is not None:
                        candidates.append(
                            Reading(
                                f"{kind}:{tag}",
                                r.low_m,
                                r.high_m,
                                f"{r.note} ({near['confidence']})",
                            )
                        )
            raw = [r for r in candidates if r is not None]
            found.raw_readings = raw
            found.readings = cal.apply(raw)
            readings.extend(found.readings)
        objects.append(found)

    raw_holistic: list[Reading] = []
    if "holistic" in estimators and seen.get("water_visible"):
        h = seen["holistic_depth_m"]
        if 0 <= h["low"] <= h["high"] <= 5:
            holistic = Reading("spark:holistic", h["low"], h["high"], "Spark's own range")
            raw_holistic = [holistic]
            readings.extend(cal.apply(raw_holistic))

    estimate = combine(readings, sigma_factor=cal.combine_factor)
    if flowing is None:
        flowing = seen.get("water_flow") == "fast"
    verdicts = assess(estimate, cat.vehicles, flowing=flowing) if estimate else []
    if seen.get("quality_flags"):
        warnings.extend(f"photo: {f.replace('_', ' ')}" for f in seen["quality_flags"])

    drawn = (
        b""
        if not draw
        else overlay(
            img,
            water,
            [
                {
                    "index": o.index,
                    "label": o.label,
                    "mask": masks[str(o.index + 1)].mask,
                    "waterline_y": o.contact.waterline_y if o.contact else None,
                }
                for o in objects
                if str(o.index + 1) in masks
            ],
        )
    )
    return PhotoAnalysis(
        size=size,
        perception=seen,
        objects=objects,
        estimate=estimate,
        verdicts=verdicts,
        overlay_jpeg=drawn,
        raw_readings=[r for o in objects for r in o.raw_readings] + raw_holistic,
        image_jpeg=image.data,
        water_fraction=float(water.mean()) if water is not None else 0.0,
        seconds=time.monotonic() - started,
        warnings=warnings,
    )
