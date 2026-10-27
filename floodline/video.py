"""A walk-by clip instead of one photo.

One photo gives one waterline per object, at one angle, and a ripple or a bad
angle spoils it. A short clip filmed while walking past gives hundreds. SAM 3.1
tracks every reference object through the clip from a single box prompt on the
key frame, so each object is measured on every frame and the median survives the
frames where a wave or a passer-by hides the waterline. Muse Spark also watches
the whole clip, sound included, for its own judgement and anything said on it.

    clip -> 10 fps, <= 960 px  (ffmpeg)
         -> key frame          -> Muse Spark: objects and boxes (as for a photo)
         -> SAM 3.1 video      "flood water", every frame
         -> SAM 3.1 video      box prompts on the key frame, tracked both ways
         -> per frame, per object: waterline -> depth
         -> per object: median over frames -> one reading
         -> Muse Spark video   its own depth range and what people say
"""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw

from floodline import calibration as calibration_mod
from floodline import catalog as catalog_mod
from floodline.estimate import DepthEstimate, Reading, combine
from floodline.geometry import waterline_contact
from floodline.imaging import PALETTE, WATER, encode_jpeg, source_key, to_pixels
from floodline.meta import sam
from floodline.meta.client import Media, ModelClient
from floodline.passability import Verdict, assess
from floodline.perceive import perceive
from floodline.readings import fraction_reading, landmark_reading, scale_reading

FPS = 10
MAX_W = 960
MIN_FRAMES = 8

_FRAME = re.compile(r"^<(\d+)f>")

VIDEO_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "depth_m": {
            "type": "object",
            "properties": {"low": {"type": "number"}, "high": {"type": "number"}},
            "required": ["low", "high"],
            "additionalProperties": False,
        },
        "water_flow": {"type": "string", "enum": ["still", "slow", "fast", "unclear"]},
        "what_happens_en": {"type": "string"},
        "what_happens_local": {"type": "string"},
        "speech": {"type": "string"},
        "speech_en": {"type": "string"},
    },
    "required": [
        "depth_m",
        "water_flow",
        "what_happens_en",
        "what_happens_local",
        "speech",
        "speech_en",
    ],
    "additionalProperties": False,
}


@dataclass
class TrackedObject:
    index: int
    label: str
    orientation: str
    frames: int = 0
    depths: list[float] = field(default_factory=list)
    readings: list[Reading] = field(default_factory=list)


@dataclass
class ClipAnalysis:
    size: tuple[int, int]
    frames: int
    key_frame: int
    perception: dict[str, Any]
    spark_video: dict[str, Any]
    objects: list[TrackedObject]
    estimate: DepthEstimate | None
    verdicts: list[Verdict]
    overlay_mp4: bytes
    key_frame_jpeg: bytes
    seconds: float
    key_overlay_jpeg: bytes = b""

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": "clip",
            "size": list(self.size),
            "frames": self.frames,
            "fps": FPS,
            "key_frame": self.key_frame,
            "perception": self.perception,
            "spark_video": self.spark_video,
            "objects": [
                {
                    "index": o.index,
                    "label": o.label,
                    "orientation": o.orientation,
                    "frames_measured": len(o.depths),
                    "frames_tracked": o.frames,
                    "depth_by_frame": [round(d, 3) for d in o.depths],
                    "readings": [r.to_dict() for r in o.readings],
                }
                for o in self.objects
            ],
            "estimate": self.estimate.to_dict() if self.estimate else None,
            "verdicts": [v.to_dict() for v in self.verdicts],
            "seconds": round(self.seconds, 2),
        }


def prepare(data: bytes, workdir: Path) -> tuple[Path, int, int, int]:
    """Re-encode to H.264 at FPS, <= MAX_W wide, no audio track removed. Returns path, w, h, n."""
    src, dst = workdir / "in", workdir / "clip.mp4"
    src.write_bytes(data)
    subprocess.run(
        [
            "ffmpeg",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(src),
            "-vf",
            f"fps={FPS},scale='min({MAX_W},iw)':-2",
            "-c:v",
            "libx264",
            "-crf",
            "24",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "64k",
            "-movflags",
            "+faststart",
            str(dst),
        ],
        check=True,
    )
    probe = json.loads(
        subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-count_frames",
                "-show_entries",
                "stream=width,height,nb_read_frames",
                "-of",
                "json",
                str(dst),
            ],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    )["streams"][0]
    return dst, int(probe["width"]), int(probe["height"]), int(probe["nb_read_frames"])


def frames(path: Path, w: int, h: int):
    """Yield RGB frames as numpy arrays, in order. Stopping early is fine."""
    proc = subprocess.Popen(
        [
            "ffmpeg",
            "-loglevel",
            "quiet",
            "-i",
            str(path),
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    size = w * h * 3
    assert proc.stdout is not None
    try:
        while chunk := proc.stdout.read(size):
            if len(chunk) < size:
                break
            yield np.frombuffer(chunk, dtype=np.uint8).reshape(h, w, 3)
    finally:
        proc.stdout.close()
        proc.kill()
        proc.wait()


def _decode_frame(args: tuple[int, str, str, int, int]) -> tuple[int, bytes, dict[str, bytes]]:
    """Decode one frame's water and object masks (runs in a worker process)."""
    f, water_line, object_line, w, h = args
    water = np.zeros((h, w), dtype=bool)
    for seg in sam.parse(water_line, (w, h), video=True) if water_line else []:
        water |= seg.mask
    objs = {
        seg.object_id: np.packbits(seg.mask).tobytes()
        for seg in (sam.parse(object_line, (w, h), video=True) if object_line else [])
    }
    return f, np.packbits(water).tobytes(), objs


def _unpack(data: bytes, w: int, h: int) -> np.ndarray:
    return (
        np.unpackbits(np.frombuffer(data, dtype=np.uint8), count=w * h).reshape(h, w).astype(bool)
    )


def by_frame(text: str) -> dict[int, str]:
    out = {}
    for line in text.splitlines():
        m = _FRAME.match(line.strip())
        if m:
            out[int(m.group(1))] = line.strip()
    return out


def analyse_clip(
    client: ModelClient,
    data: bytes,
    *,
    render: bool = True,
    catalog: catalog_mod.Catalog | None = None,
    local_language: str = "Vietnamese",
) -> ClipAnalysis:
    started = time.monotonic()
    cat = catalog or catalog_mod.default()
    cal = calibration_mod.default()
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        path, w, h, n = prepare(data, workdir)
        if n < MIN_FRAMES:
            raise ValueError("clip too short")
        source = f"clip:{source_key(data)}"
        clip = Media(path.read_bytes(), "video/mp4", key=source)
        key = n // 2
        key_img = None
        for i, frame in enumerate(frames(path, w, h)):
            if i == key:
                key_img = Image.fromarray(frame)
                break
        assert key_img is not None
        key_media = Media(encode_jpeg(key_img, 92), "image/jpeg", key=f"{source}/frame{key}")

        seen = perceive(client, key_media)
        refs = [r for r in seen.get("references", []) if r["label"] in cat.objects][:8]
        boxes = [to_pixels(r["box"], (w, h)) for r in refs]

        water_text = client.sam(prompt="flood water", video=clip)
        objects_text = ""
        if boxes:
            prompt = sam.box_prompt((w, h), boxes).replace("<0f>", f"<{key}f>", 1)
            objects_text = client.sam(prompt=prompt, video=clip)
        spark_video = client.spark_json(
            system="You help flood rescue teams read residents' clips.",
            text=(
                "A resident filmed this clip in a flooded street. Estimate the water depth range "
                "in metres where people and vehicles are, and say whether the water flows. "
                "Describe in one sentence what happens, in English (what_happens_en) and in "
                f"{local_language} (what_happens_local). Transcribe anything said on the audio "
                "in its own language (speech) and translate it to English (speech_en); both "
                "empty if nothing is said."
            ),
            videos=[clip],
            schema_name="flood_clip",
            schema=VIDEO_SCHEMA,
            effort="low",
        )

        water_lines = by_frame(water_text)
        object_lines = by_frame(objects_text)
        tracked = [
            TrackedObject(index=i, label=r["label"], orientation=r["orientation"])
            for i, r in enumerate(refs)
        ]
        out_path = workdir / "overlay.mp4"
        writer = None
        if render:
            writer = subprocess.Popen(
                [
                    "ffmpeg",
                    "-loglevel",
                    "error",
                    "-y",
                    "-f",
                    "rawvideo",
                    "-pix_fmt",
                    "rgb24",
                    "-s",
                    f"{w}x{h}",
                    "-r",
                    str(FPS),
                    "-i",
                    "-",
                    "-c:v",
                    "libx264",
                    "-crf",
                    "26",
                    "-pix_fmt",
                    "yuv420p",
                    "-movflags",
                    "+faststart",
                    str(out_path),
                ],
                stdin=subprocess.PIPE,
            )
        key_overlay = b""
        jobs = [(f, water_lines.get(f, ""), object_lines.get(f, ""), w, h) for f in range(n)]
        with ProcessPoolExecutor() as pool:
            decoded = pool.map(_decode_frame, jobs, chunksize=4)
            for (f, water_bits, obj_bits), frame in zip(decoded, frames(path, w, h), strict=False):
                water = _unpack(water_bits, w, h)
                segs = {k: _unpack(v, w, h) for k, v in obj_bits.items()}
                drawn = []
                for obj in tracked:
                    mask = segs.get(str(obj.index + 1))
                    if mask is None or not mask.any():
                        continue
                    obj.frames += 1
                    ref = refs[obj.index]
                    contact = waterline_contact(mask, water)
                    depth = None
                    if contact and ref["standing_in_water"] and ref["fully_visible_above_water"]:
                        r = scale_reading("x", cat.objects[obj.label], obj.orientation, contact)
                        if r is not None:
                            depth = r.mean
                            obj.depths.append(depth)
                    drawn.append((obj, mask, contact, depth))
                if writer is not None or f == key:
                    annotated = _draw(frame, water, drawn)
                    if writer is not None:
                        writer.stdin.write(annotated.tobytes())
                    if f == key:
                        key_overlay = encode_jpeg(Image.fromarray(annotated), 88)
        if writer is not None:
            writer.stdin.close()
            writer.wait()
        overlay_mp4 = out_path.read_bytes() if render and out_path.exists() else b""

    readings: list[Reading] = []
    for obj in tracked:
        spec = cat.objects[obj.label]
        ref = refs[obj.index]
        tag = f"{obj.label}#{obj.index + 1}"
        raw: list[Reading] = []
        if len(obj.depths) >= 5:
            lo, hi = np.percentile(obj.depths, [20, 80])
            raw.append(
                Reading(
                    f"scale:{tag}@clip",
                    float(max(0.0, lo)),
                    float(max(0.0, hi)),
                    f"median of {len(obj.depths)} frames",
                )
            )
        if ref["standing_in_water"]:
            for r in (
                landmark_reading(tag, spec, ref["waterline_landmark"]),
                fraction_reading(tag, spec, ref["submerged_fraction"]),
            ):
                if r is not None:
                    raw.append(r)
        obj.readings = cal.apply(raw)
        readings.extend(obj.readings)
    d = spark_video.get("depth_m", {})
    if 0 <= d.get("low", -1) <= d.get("high", -1) <= 5:
        readings.extend(
            cal.apply([Reading("spark:video", d["low"], d["high"], "Spark watched the clip")])
        )
    estimate = combine(readings, sigma_factor=cal.combine_factor)
    flowing = spark_video.get("water_flow") == "fast"
    verdicts = assess(estimate, cat.vehicles, flowing=flowing) if estimate else []
    return ClipAnalysis(
        size=(w, h),
        frames=n,
        key_frame=key,
        perception=seen,
        spark_video=spark_video,
        objects=tracked,
        estimate=estimate,
        verdicts=verdicts,
        overlay_mp4=overlay_mp4,
        key_frame_jpeg=key_media.data,
        key_overlay_jpeg=key_overlay,
        seconds=time.monotonic() - started,
    )


def _draw(frame: np.ndarray, water: np.ndarray, drawn) -> np.ndarray:
    out = frame.astype(np.float32)
    out[water] = out[water] * 0.62 + np.array(WATER) * 0.38
    for obj, mask, _, _ in drawn:
        colour = np.array(PALETTE[obj.index % len(PALETTE)])
        out[mask] = out[mask] * 0.5 + colour * 0.5
    img = Image.fromarray(out.clip(0, 255).astype(np.uint8))
    draw = ImageDraw.Draw(img)
    for obj, mask, contact, depth in drawn:
        colour = PALETTE[obj.index % len(PALETTE)]
        ys, xs = np.nonzero(mask)
        if len(xs) == 0:
            continue
        x0, x1 = int(xs.min()), int(xs.max())
        if contact is not None:
            y = contact.waterline_y
            draw.line([(x0 - 4, y), (x1 + 4, y)], fill=(255, 255, 255), width=4)
            draw.line([(x0 - 4, y), (x1 + 4, y)], fill=colour, width=2)
        label = f"{obj.index + 1} {obj.label}" + (f" {depth:.2f} m" if depth is not None else "")
        draw.text(
            (x0 + 3, int(ys.min()) + 3),
            label,
            fill=(255, 255, 255),
            stroke_width=2,
            stroke_fill=(0, 0, 0),
        )
    return np.asarray(img)
