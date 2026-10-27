"""HTTP API and the web app.

POST /api/reports        photo (+ optional voice note) and a location -> analysis
GET  /api/reports        newest first, with triage
GET  /api/segments       street segments with depth and status per vehicle (GeoJSON)
GET  /api/route          a route for one vehicle class that avoids the water
GET  /api/events         server-sent events: report.created, report.updated
"""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from floodline import catalog as catalog_mod
from floodline import roads as roads_mod
from floodline.config import DATA, ROOT, settings
from floodline.fusion import fuse
from floodline.meta.client import CassetteMissingError, ModelClient
from floodline.pipeline import analyse
from floodline.store import Store, StoredReport

app = FastAPI(title="Floodline", version="0.1.0")
store = Store(settings().state_dir / "reports")
client = ModelClient()
_subscribers: set[asyncio.Queue] = set()


@app.exception_handler(CassetteMissingError)
async def _no_cassette(_, exc: CassetteMissingError) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={
            "detail": "This server replays recorded answers only, and this photo was "
            "never recorded. Try a demo photo, or run with an API key."
        },
    )


def _publish(kind: str, payload: dict[str, Any]) -> None:
    for q in list(_subscribers):
        q.put_nowait({"type": kind, "data": payload})


def _states(now: float | None = None):
    reports = [r.for_fusion() for r in store.all()]
    return fuse(
        [r for r in reports if r is not None],
        roads_mod.default(),
        catalog_mod.default().vehicles,
        now or time.time(),
    )


# -- reports ----------------------------------------------------------------------


@app.post("/api/reports")
async def create_report(
    photo: UploadFile = File(...),
    lat: float = Form(...),
    lon: float = Form(...),
    note: str = Form(""),
    audio: UploadFile | None = File(None),
    at: float | None = Form(None),
    source: str = Form("web"),
) -> dict[str, Any]:
    data = await photo.read()
    if not data:
        raise HTTPException(400, "empty photo")
    result = await asyncio.to_thread(analyse, client, data)

    transcript = None
    if audio is not None:
        from floodline.voice import transcribe_upload

        transcript = await asyncio.to_thread(transcribe_upload, client, await audio.read())

    triage = None
    try:
        from floodline.triage import triage as run_triage

        triage = await asyncio.to_thread(run_triage, client, result, note, transcript)
    except ImportError:
        pass

    report = StoredReport(
        id=store.new_id(),
        lat=lat,
        lon=lon,
        at=at or time.time(),
        note=note,
        analysis=result.to_dict(),
        triage=triage,
        transcript=transcript,
        source=source,
    )
    store.save(report, image=result.image_jpeg, overlay=result.overlay_jpeg)
    _publish("report.created", report.public())
    return report.public()


@app.get("/api/reports")
def list_reports() -> list[dict[str, Any]]:
    return [r.public() for r in store.all()]


@app.patch("/api/reports/{report_id}")
def update_report(report_id: str, body: dict[str, Any]) -> dict[str, Any]:
    report = store.reports.get(report_id)
    if report is None:
        raise HTTPException(404)
    if body.get("status") in ("new", "acknowledged", "dispatched", "closed"):
        report.status = body["status"]
    store.save(report)
    _publish("report.updated", report.public())
    return report.public()


@app.get("/api/reports/{report_id}/{name}")
def report_file(report_id: str, name: str) -> FileResponse:
    if name not in ("image.jpg", "overlay.jpg"):
        raise HTTPException(404)
    path = store.file(report_id, name)
    if path is None:
        raise HTTPException(404)
    return FileResponse(path, media_type="image/jpeg")


# -- map ----------------------------------------------------------------------------


@app.get("/api/segments")
def segments() -> dict[str, Any]:
    states = _states()
    props = {
        sid: {
            "depth_m": round(s.estimate.mean_m, 2),
            "low_m": round(s.estimate.low_m, 2),
            "high_m": round(s.estimate.high_m, 2),
            "reports": s.reports,
            **{f"status_{v.vehicle.id}": v.status for v in s.verdicts},
            **{f"p_{v.vehicle.id}": round(v.p_exceed, 3) for v in s.verdicts},
        }
        for sid, s in states.items()
    }
    return roads_mod.default().geojson(list(states), props)


@app.get("/api/route")
def route(
    start: str = Query(..., alias="from", description="lat,lon"),
    end: str = Query(..., alias="to", description="lat,lon"),
    vehicle: str = "truck",
) -> dict[str, Any]:
    try:
        a = tuple(float(x) for x in start.split(","))
        b = tuple(float(x) for x in end.split(","))
    except ValueError as e:
        raise HTTPException(400, "from and to are lat,lon") from e
    states = _states()
    blocked = {sid for sid, s in states.items() if s.status_for(vehicle) == "impassable"}
    risky = {sid for sid, s in states.items() if s.status_for(vehicle) == "risky"}
    r = roads_mod.default()
    found = r.route(a, b, blocked=blocked, risky=risky)
    naive = r.route(a, b)
    if found is None:
        return {
            "vehicle": vehicle,
            "route": None,
            "naive": naive,
            "reason": "every way is blocked for this vehicle",
        }
    crossed = [sid for sid in (naive or {}).get("segments", []) if sid in blocked]
    return {"vehicle": vehicle, "route": found, "naive": naive, "naive_blocked": crossed}


# -- demo ---------------------------------------------------------------------------

_seeding = asyncio.Lock()


@app.post("/api/demo/seed")
async def demo_seed(reset: bool = True) -> dict[str, Any]:
    """Replay the Huế scenario: reports arrive one by one over SSE, as on a real night."""
    from floodline import scenario

    if _seeding.locked():
        raise HTTPException(409, "already seeding")
    async with _seeding:
        if reset:
            store.clear()
            _publish("reports.reset", {})
        loop = asyncio.get_running_loop()

        total = len(scenario.load()["reports"])
        count = 0

        def publish(report: StoredReport) -> None:
            nonlocal count
            count += 1
            payload = {**report.public(), "seed": {"index": count, "total": total}}
            loop.call_soon_threadsafe(_publish, "report.created", payload)

        created = await asyncio.to_thread(scenario.seed, store, client, on_report=publish)
    return {"created": len(created)}


@app.post("/api/demo/reset")
def demo_reset() -> dict[str, Any]:
    store.clear()
    _publish("reports.reset", {})
    return {"ok": True}


@app.get("/api/attribution")
def attribution() -> Any:
    """Author, licence and source of every demo photo and clip."""
    return json.loads((DATA / "demo" / "photos.json").read_text())


@app.get("/api/catalog")
def catalog() -> dict[str, Any]:
    cat = catalog_mod.default()
    return {
        "vehicles": [v.__dict__ for v in cat.vehicles],
        "objects": {k: o.__dict__ for k, o in cat.objects.items()},
        "sources": cat.sources,
    }


@app.get("/api/health")
def health() -> dict[str, Any]:
    cfg = settings()
    return {
        "ok": True,
        "mode": cfg.model_mode,
        "has_key": bool(cfg.model_api_key),
        "reports": len(store.reports),
    }


@app.get("/api/events")
async def events() -> StreamingResponse:
    queue: asyncio.Queue = asyncio.Queue()
    _subscribers.add(queue)

    async def stream():
        try:
            yield "retry: 3000\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"event: {event['type']}\ndata: {json.dumps(event['data'])}\n\n"
                except TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            _subscribers.discard(queue)

    return StreamingResponse(stream(), media_type="text/event-stream")


_web = ROOT / "web" / "dist"
if _web.exists():
    app.mount("/", StaticFiles(directory=Path(_web), html=True), name="web")
