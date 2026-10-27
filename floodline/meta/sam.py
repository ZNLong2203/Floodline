"""Read SAM 3.1 output into numpy masks in source-image pixels."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from meta_sam_parser import (
    CompletedOutcome,
    FramePrompt,
    PromptBox,
    PromptObject,
    SegmentationBoxRecord,
    SegmentationMaskRecord,
    build_object_prompt,
    decode_mask_to_raster,
    image_segmentation_format,
    video_segmentation_format,
)
from PIL import Image


@dataclass(frozen=True)
class Segment:
    """One object on one frame: its box and a full-frame boolean mask."""

    object_id: str
    frame: int
    box: tuple[int, int, int, int]  # x1, y1, x2, y2 inclusive, source pixels
    mask: np.ndarray  # bool, shape (frame_h, frame_w)
    confidence: float | None

    @property
    def area(self) -> int:
        return int(self.mask.sum())


def place(full: np.ndarray, local: np.ndarray, bounds: tuple[float, float, float, float]) -> None:
    """Paste a box-local mask into a full-frame mask, in place.

    `bounds` is half-open (left, top, right, bottom). Large masks arrive at a lower
    resolution than their box, so the raster is scaled to the box before pasting.
    """
    height, width = full.shape
    left, top = max(0, round(bounds[0])), max(0, round(bounds[1]))
    right, bottom = min(width, round(bounds[2])), min(height, round(bounds[3]))
    if right <= left or bottom <= top:
        return
    if local.shape != (bottom - top, right - left):
        local = np.asarray(
            Image.fromarray(local).resize((right - left, bottom - top), Image.Resampling.NEAREST)
        )
    full[top:bottom, left:right] |= local


def parse(text: str, size: tuple[int, int], *, video: bool = False) -> list[Segment]:
    """Parse SAM output text into segments. `size` is the media's (width, height)."""
    if not text.strip():
        return []
    parser = (video_segmentation_format() if video else image_segmentation_format()).create_parser()
    parser.push(text if text.endswith("\n") else text + "\n", emit=False)
    result = parser.finish(CompletedOutcome()).result

    boxes: dict[tuple[int, str], SegmentationBoxRecord] = {}
    masks: dict[tuple[int, str], SegmentationMaskRecord] = {}
    for record in result.records:
        frame = record.frame.frame_index if getattr(record, "frame", None) is not None else 0
        if isinstance(record, SegmentationBoxRecord):
            boxes[(frame, record.object_id)] = record
        elif isinstance(record, SegmentationMaskRecord):
            masks[(frame, record.object_id)] = record

    width, height = size
    segments: list[Segment] = []
    for key, box in sorted(boxes.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        mask_record = masks.get(key)
        full = np.zeros((height, width), dtype=bool)
        if mask_record is not None:
            m = mask_record.mask
            raster = np.frombuffer(decode_mask_to_raster(m), dtype=np.uint8)
            local = raster.reshape(m.height, m.width).astype(bool)
            b = mask_record.bounds
            place(full, local, (b.left, b.top, b.right, b.bottom))
        segments.append(
            Segment(
                object_id=box.object_id,
                frame=key[0],
                box=(round(box.left), round(box.top), round(box.right), round(box.bottom)),
                mask=full,
                confidence=box.confidence,
            )
        )
    return segments


def box_prompt(size: tuple[int, int], boxes: Sequence[tuple[int, int, int, int]]) -> str:
    """Build a SAM prompt that segments each box as its own object, ids 1..n."""
    width, height = size
    objects = []
    for i, (x1, y1, x2, y2) in enumerate(boxes, start=1):
        x1, x2 = sorted((max(0, min(width - 1, x1)), max(0, min(width - 1, x2))))
        y1, y2 = sorted((max(0, min(height - 1, y1)), max(0, min(height - 1, y2))))
        if x2 - x1 < 2 or y2 - y1 < 2:
            continue
        objects.append(
            PromptObject(
                id=i,
                prompts=[
                    FramePrompt(
                        frame=0,
                        box=PromptBox(left=x1, top=y1, right=x2, bottom=y2),
                        points=[],
                    )
                ],
            )
        )
    return build_object_prompt(size=size, objects=objects)
