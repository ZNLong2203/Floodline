"""Replayable flood nights for the demo, one per city.

The photos and clips are real floods (Wikimedia Commons, see
data/demo/ATTRIBUTION.md). A scenario places them on a city's streets with times
and messages written for the demo; where a photo was taken elsewhere, the
scenario file says so. Every report it creates carries `extra.scenario`, and the
console shows it.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from floodline import cities
from floodline.cities import City
from floodline.config import DATA
from floodline.meta.client import ModelClient
from floodline.pipeline import analyse
from floodline.store import Store, StoredReport


def load(path: Path) -> dict:
    return json.loads(path.read_text())


def seed(
    store: Store,
    client: ModelClient,
    *,
    city: City | None = None,
    now: float | None = None,
    on_report=None,
) -> list[StoredReport]:
    """Analyse every scenario photo or clip and add it to the store, oldest first."""
    from floodline.triage import triage

    city = city or cities.get(None)
    scenario = load(city.scenario_path)
    cat = cities.catalog(city.id)
    now = now or time.time()
    created = []
    for item in sorted(scenario["reports"], key=lambda r: -r["minutes_ago"]):
        clip = None
        if "clip" in item:
            from floodline.video import analyse_clip

            result = analyse_clip(
                client,
                (DATA / "demo" / item["clip"]).read_bytes(),
                catalog=cat,
                local_language=city.language,
            )
            image, overlay, clip = (
                result.key_frame_jpeg,
                result.key_overlay_jpeg,
                result.overlay_mp4,
            )
        else:
            result = analyse(client, (DATA / "demo" / item["photo"]).read_bytes(), catalog=cat)
            image, overlay = result.image_jpeg, result.overlay_jpeg
        transcript = item.get("transcript")
        if transcript is None and clip is not None and result.spark_video.get("speech"):
            transcript = result.spark_video["speech"]
        tri = triage(client, result, item.get("note", ""), transcript, local_language=city.language)
        report = StoredReport(
            id=store.new_id(),
            lat=item["lat"],
            lon=item["lon"],
            at=now - 60 * item["minutes_ago"],
            note=item.get("note", ""),
            analysis=result.to_dict(),
            triage=tri,
            transcript=transcript,
            source=item.get("source", "web"),
            city=city.id,
            extra={
                "scenario": scenario["name"],
                "photo_credit": item.get("photo") or item["clip"],
            },
        )
        store.save(report, image=image, overlay=overlay, clip=clip)
        created.append(report)
        if on_report:
            on_report(report)
    return created
