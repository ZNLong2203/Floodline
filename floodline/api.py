"""HTTP API and the web app.

    GET  /api/cities         the cities this server covers
    POST /api/reports        photo or clip (+ optional voice note) and a location -> analysis
    GET  /api/reports        newest first, with triage
    GET  /api/segments       street segments with depth and status per vehicle (GeoJSON)
    GET  /api/route          a route for one vehicle class that avoids the water
    GET  /api/events         server-sent events: report.created, report.updated, reports.reset

Every endpoint about places takes `city` (default: Huế).
"""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from floodline import cities
from floodline.config import DATA, ROOT, settings
from floodline.fusion import fuse
from floodline.meta.client import CassetteMissingError, ModelClient
from floodline.pipeline import analyse
from floodline.store import Store, StoredReport

app = FastAPI(title="Floodline", version="0.2.0")
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


def _states(city_id: str, now: float | None = None):
    reports = [r.for_fusion() for r in store.all(city_id)]
    return fuse(
        [r for r in reports if r is not None],
        cities.roads(city_id),
        cities.catalog(city_id).vehicles,
        now or time.time(),
    )


def _city(city_id: str | None) -> cities.City:
    if city_id and city_id not in cities.all_cities():
        raise HTTPException(404, f"unknown city {city_id!r}")
    return cities.get(city_id)


# -- cities -------------------------------------------------------------------------


@app.get("/api/cities")
def list_cities() -> list[dict[str, Any]]:
    return [{**c.public(), "reports": len(store.all(c.id))} for c in cities.all_cities().values()]


# -- reports ------------------------------------------------------------------------


@app.post("/api/reports")
async def create_report(
    lat: float = Form(...),
    lon: float = Form(...),
    photo: UploadFile | None = File(None),
    video: UploadFile | None = File(None),
    note: str = Form(""),
    audio: UploadFile | None = File(None),
    at: float | None = Form(None),
    source: str = Form("web"),
    city: str | None = Form(None),
) -> dict[str, Any]:
    """A photo or a short clip of the water, with a location and optional words."""
    place = _city(city)
    upload = video or photo
    if upload is None:
        raise HTTPException(400, "send a photo or a video")
    data = await upload.read()
    if not data:
        raise HTTPException(400, "empty upload")
    cat = cities.catalog(place.id)
    if video is not None:
        from floodline.video import analyse_clip

        result = await asyncio.to_thread(
            analyse_clip, client, data, catalog=cat, local_language=place.language
        )
        image, overlay, clip = result.key_frame_jpeg, result.key_overlay_jpeg, result.overlay_mp4
    else:
        result = await asyncio.to_thread(analyse, client, data, catalog=cat)
        image, overlay, clip = result.image_jpeg, result.overlay_jpeg, None

    transcript = None
    warnings: list[str] = []
    if audio is not None:
        from floodline.voice import transcribe_upload

        try:
            transcript = await asyncio.to_thread(
                transcribe_upload, client, await audio.read(), place.language
            )
        except CassetteMissingError:
            warnings.append("voice note not transcribed: this demo replays recorded answers only")
    elif video is not None and result.spark_video.get("speech"):
        transcript = result.spark_video["speech"]

    from floodline.triage import score
    from floodline.triage import triage as run_triage

    try:
        triage = await asyncio.to_thread(
            run_triage, client, result, note, transcript, local_language=place.language
        )
    except CassetteMissingError:
        # The measurement replayed but these words were never recorded: rank by depth alone.
        est = result.estimate
        priority, why = score({}, est.mean_m if est else None)
        triage = {"priority": priority, "reasons": why, "facts": None}
        warnings.append("message not read: this demo replays recorded answers only")
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
        city=place.id,
        extra={"warnings": warnings} if warnings else {},
    )
    store.save(report, image=image, overlay=overlay, clip=clip)
    _publish("report.created", report.public())
    return report.public()


@app.get("/api/reports")
def list_reports(city: str | None = None) -> list[dict[str, Any]]:
    return [r.public() for r in store.all(_city(city).id)]


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
    if name not in ("image.jpg", "overlay.jpg", "overlay.mp4"):
        raise HTTPException(404)
    path = store.file(report_id, name)
    if path is None:
        raise HTTPException(404)
    return FileResponse(path, media_type="video/mp4" if name.endswith(".mp4") else "image/jpeg")


# -- map ----------------------------------------------------------------------------


@app.get("/api/segments")
def segments(city: str | None = None) -> dict[str, Any]:
    place = _city(city)
    states = _states(place.id)
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
    return cities.roads(place.id).geojson(list(states), props)


def plan_route(city_id: str, a: tuple[float, float], b: tuple[float, float], vehicle: str) -> dict:
    states = _states(city_id)
    blocked = {sid for sid, s in states.items() if s.status_for(vehicle) == "impassable"}
    risky = {sid for sid, s in states.items() if s.status_for(vehicle) == "risky"}
    r = cities.roads(city_id)
    found = r.route(a, b, blocked=blocked, risky=risky)
    naive = r.route(a, b)
    crossed = [sid for sid in (naive or {}).get("segments", []) if sid in blocked]
    if found is None:
        return {
            "vehicle": vehicle,
            "route": None,
            "naive": naive,
            "naive_blocked": crossed,
            "reason": "every way is blocked for this vehicle",
        }
    return {"vehicle": vehicle, "route": found, "naive": naive, "naive_blocked": crossed}


@app.get("/api/route")
def route(
    start: str = Query(..., alias="from", description="lat,lon"),
    end: str = Query(..., alias="to", description="lat,lon"),
    vehicle: str = "truck",
    city: str | None = None,
) -> dict[str, Any]:
    try:
        a = tuple(float(x) for x in start.split(","))
        b = tuple(float(x) for x in end.split(","))
    except ValueError as e:
        raise HTTPException(400, "from and to are lat,lon") from e
    return plan_route(_city(city).id, a, b, vehicle)


# -- assistant ----------------------------------------------------------------------


def _recording(city_id: str, question: str) -> Path:
    import hashlib

    key = hashlib.sha256(f"{city_id}\n{question.strip().lower()}".encode()).hexdigest()[:24]
    return settings().cassette_dir / "assistant" / f"{key}.json"


@app.post("/api/ask")
async def ask(body: dict[str, Any]) -> dict[str, Any]:
    """Ask the dispatch assistant. Without an API key, recorded questions are replayed."""
    from floodline.assistant import Tools
    from floodline.assistant import ask as run

    place = _city(body.get("city"))
    question = (body.get("question") or "").strip()
    if not question:
        raise HTTPException(400, "ask a question")
    rec = _recording(place.id, question)
    if settings().model_mode == "record" and rec.exists():
        return {**json.loads(rec.read_text())["answer"], "recorded": True}
    if settings().model_mode == "replay":
        if not rec.exists():
            raise HTTPException(
                503,
                "This demo server has no API key; try one of the example "
                "questions, which were recorded.",
            )
        return {**json.loads(rec.read_text())["answer"], "recorded": True}
    tools = Tools(
        place, store, lambda: _states(place.id), lambda a, b, v: plan_route(place.id, a, b, v)
    )
    answer = await asyncio.to_thread(run, client, tools, question)
    if settings().model_mode == "record":
        rec.parent.mkdir(parents=True, exist_ok=True)
        rec.write_text(
            json.dumps(
                {"city": place.id, "question": question, "answer": answer},
                ensure_ascii=False,
                indent=1,
                default=str,
            )
        )
    return {**answer, "recorded": False}


@app.get("/api/ask/examples")
def ask_examples(city: str | None = None) -> list[str]:
    place = _city(city)
    folder = settings().cassette_dir / "assistant"
    out = []
    for f in sorted(folder.glob("*.json")) if folder.exists() else []:
        d = json.loads(f.read_text())
        if d.get("city") == place.id:
            out.append(d["question"])
    return out


# -- WhatsApp -----------------------------------------------------------------------

_whatsapp = None


def whatsapp():
    """The WhatsApp channel, created on first use so the web demo never needs its settings."""
    global _whatsapp
    if _whatsapp is None:
        from floodline.whatsapp import WhatsApp

        loop = asyncio.get_event_loop()

        def publish(kind: str, payload: dict[str, Any]) -> None:
            loop.call_soon_threadsafe(_publish, kind, payload)

        _whatsapp = WhatsApp(settings(), store, publish)
    return _whatsapp


@app.get("/api/whatsapp/webhook")
def whatsapp_verify(
    mode: str = Query("", alias="hub.mode"),
    token: str = Query("", alias="hub.verify_token"),
    challenge: str = Query("", alias="hub.challenge"),
) -> Any:
    """Meta's one-time check that this URL belongs to the app."""
    from fastapi.responses import PlainTextResponse

    expected = settings().whatsapp_verify_token
    if mode == "subscribe" and expected and token == expected:
        return PlainTextResponse(challenge)
    raise HTTPException(403, "verification failed")


@app.post("/api/whatsapp/webhook")
async def whatsapp_message(request: Request) -> dict[str, Any]:
    from floodline.whatsapp import verify_signature

    body = await request.body()
    if not verify_signature(
        settings().whatsapp_app_secret, body, request.headers.get("x-hub-signature-256")
    ):
        raise HTTPException(401, "bad signature")
    channel = whatsapp()
    if not channel.configured:
        raise HTTPException(503, "WhatsApp is not configured on this server")
    # Answer within the request: Meta retries a slow webhook, and retries of a message
    # already seen are dropped, so each photo is measured once.
    handled = await asyncio.to_thread(channel.handle_payload, json.loads(body or b"{}"))
    return {"handled": handled}


# -- demo ---------------------------------------------------------------------------

_seeding = asyncio.Lock()


@app.post("/api/demo/seed")
async def demo_seed(reset: bool = True, city: str | None = None) -> dict[str, Any]:
    """Replay a city's scenario: reports arrive one by one over SSE, as on a real night."""
    from floodline import scenario

    place = _city(city)
    if place.scenario_path is None:
        raise HTTPException(404, f"{place.name} has no scenario")
    if _seeding.locked():
        raise HTTPException(409, "already seeding")
    if settings().demo_lock:
        return await _replay_stored(place)
    async with _seeding:
        if reset:
            store.clear(place.id)
            _publish("reports.reset", {"city": place.id})
        loop = asyncio.get_running_loop()
        total = len(scenario.load(place.scenario_path)["reports"])
        count = 0

        def publish(report: StoredReport) -> None:
            nonlocal count
            count += 1
            payload = {**report.public(), "seed": {"index": count, "total": total}}
            loop.call_soon_threadsafe(_publish, "report.created", payload)

        created = await asyncio.to_thread(
            scenario.seed, store, client, city=place, on_report=publish
        )
    return {"created": len(created)}


async def _replay_stored(place: cities.City) -> dict[str, Any]:
    """Re-play the stored scenario over SSE, oldest first, without re-analysing or deleting."""
    async with _seeding:
        reports = [r for r in store.all(place.id) if r.extra.get("scenario")]
        reports.sort(key=lambda r: r.effective_at)
        _publish("reports.reset", {"city": place.id})
        for n, report in enumerate(reports, start=1):
            await asyncio.sleep(0.9)
            payload = {**report.public(), "seed": {"index": n, "total": len(reports)}}
            _publish("report.created", payload)
    return {"created": len(reports), "replayed": True}


@app.post("/api/demo/reset")
def demo_reset(city: str | None = None) -> dict[str, Any]:
    if settings().demo_lock:
        raise HTTPException(403, "Clearing is turned off on the public demo; Replay re-plays it.")
    place = _city(city)
    store.clear(place.id)
    _publish("reports.reset", {"city": place.id})
    return {"ok": True}


@app.get("/api/samples")
def samples(city: str | None = None) -> list[dict[str, Any]]:
    """Recorded photos a visitor can send from /report when the server has no API key."""
    place = _city(city)
    return [{"path": p, "url": f"/api/demo-media/{p}"} for p in place.samples]


@app.get("/api/demo-media/{path:path}")
def demo_media(path: str) -> FileResponse:
    root = (DATA / "demo").resolve()
    target = (root / path).resolve()
    if root not in target.parents or not target.is_file():
        raise HTTPException(404)
    media = "video/mp4" if target.suffix == ".mp4" else "image/jpeg"
    return FileResponse(target, media_type=media)


@app.get("/api/attribution")
def attribution() -> Any:
    """Author, licence and source of every demo photo and clip, tagged by city."""
    credits = json.loads((DATA / "demo" / "photos.json").read_text())
    for item in credits.get("photos", []) + credits.get("videos", []):
        item.setdefault("city", "hue")
    extra = DATA / "demo" / "valencia" / "photos.json"
    if extra.exists():
        for item in json.loads(extra.read_text()):
            item["city"] = "valencia"
            key = "videos" if item.get("kind") == "clip" else "photos"
            credits.setdefault(key, []).append(item)
    return credits


@app.get("/api/catalog")
def catalog(city: str | None = None) -> dict[str, Any]:
    cat = cities.catalog(_city(city).id)
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
        # Whether the web app analyses new uploads; WhatsApp may be live while the web replays.
        "has_key": bool(cfg.model_api_key) and cfg.model_mode != "replay",
        "demo_lock": cfg.demo_lock,
        "whatsapp": bool(cfg.whatsapp_token and cfg.whatsapp_phone_number_id),
        "reports": len(store.reports),
        "cities": list(cities.all_cities()),
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
