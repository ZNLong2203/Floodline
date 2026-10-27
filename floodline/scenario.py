"""A replayable flood night in Huế for the demo.

The photos are real floods in Vietnam (Wikimedia Commons, see
data/demo/ATTRIBUTION.md), but most were taken elsewhere. The scenario places
them on Huế streets that flood often, with times and messages written for the
demo. Every report it creates says so in its `extra.scenario` field, and the
console shows it.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from floodline.config import DATA
from floodline.meta.client import ModelClient
from floodline.pipeline import analyse
from floodline.store import Store, StoredReport

SCENARIO = DATA / "scenario-hue.json"


def load(path: Path = SCENARIO) -> dict:
    return json.loads(path.read_text())


def seed(
    store: Store,
    client: ModelClient,
    *,
    path: Path = SCENARIO,
    now: float | None = None,
    on_report=None,
) -> list[StoredReport]:
    """Analyse every scenario photo and add it to the store, oldest first."""
    from floodline.triage import triage

    scenario = load(path)
    now = now or time.time()
    created = []
    for item in sorted(scenario["reports"], key=lambda r: -r["minutes_ago"]):
        clip = None
        if "clip" in item:
            from floodline.video import analyse_clip

            result = analyse_clip(client, (DATA / "demo" / item["clip"]).read_bytes())
            image, overlay, clip = (
                result.key_frame_jpeg,
                result.key_overlay_jpeg,
                result.overlay_mp4,
            )
        else:
            result = analyse(client, (DATA / "demo" / item["photo"]).read_bytes())
            image, overlay = result.image_jpeg, result.overlay_jpeg
        tri = triage(client, result, item.get("note", ""), item.get("transcript"))
        report = StoredReport(
            id=store.new_id(),
            lat=item["lat"],
            lon=item["lon"],
            at=now - 60 * item["minutes_ago"],
            note=item.get("note", ""),
            analysis=result.to_dict(),
            triage=tri,
            transcript=item.get("transcript"),
            source=item.get("source", "web"),
            extra={"scenario": scenario["name"], "photo_credit": item.get("photo") or item["clip"]},
        )
        store.save(report, image=image, overlay=overlay, clip=clip)
        created.append(report)
        if on_report:
            on_report(report)
    return created
