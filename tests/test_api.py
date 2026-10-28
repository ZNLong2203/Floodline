"""End to end through the HTTP API, replaying recorded answers (no key, no cost).

Covers what a visitor does on the public demo: list cities, send a sample photo,
see it on the street map, plan routes for each vehicle, ask a recorded question,
read the credits. Uses a fresh store in a temporary folder.
"""

import importlib
import json

import pytest


@pytest.fixture(scope="module")
def api(tmp_path_factory):
    import os

    state = tmp_path_factory.mktemp("state")
    saved = {
        k: os.environ.get(k)
        for k in ("FLOODLINE_MODEL_MODE", "FLOODLINE_STATE_DIR", "MODEL_API_KEY")
    }
    os.environ.update(
        FLOODLINE_MODEL_MODE="replay", FLOODLINE_STATE_DIR=str(state), MODEL_API_KEY=""
    )
    from floodline import config

    config.settings.cache_clear()
    import floodline.api as module

    module = importlib.reload(module)
    from fastapi.testclient import TestClient

    yield TestClient(module.app)
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    config.settings.cache_clear()


def test_health_reports_replay_without_key(api):
    h = api.get("/api/health").json()
    assert h["ok"] and h["mode"] == "replay" and h["has_key"] is False
    assert set(h["cities"]) >= {"hue", "valencia"}


def test_cities_have_presets_and_samples(api):
    cities = {c["id"]: c for c in api.get("/api/cities").json()}
    for cid in ("hue", "valencia"):
        assert cities[cid]["presets"] and cities[cid]["samples"] == 4
    assert api.get("/api/segments", params={"city": "atlantis"}).status_code == 404


@pytest.mark.parametrize("city", ["hue", "valencia"])
def test_sample_photo_flows_to_map_and_queue(api, city):
    place = next(c for c in api.get("/api/cities").json() if c["id"] == city)
    sample = api.get("/api/samples", params={"city": city}).json()[1]
    photo = api.get(sample["url"])
    assert photo.status_code == 200 and photo.content[:2] == b"\xff\xd8"

    r = api.post(
        "/api/reports",
        data={"lat": place["center"][0], "lon": place["center"][1], "city": city},
        files={"photo": ("sample.jpg", photo.content, "image/jpeg")},
    )
    assert r.status_code == 200, r.text
    report = r.json()
    est = report["analysis"]["estimate"]
    assert 0 <= est["low_m"] <= est["mean_m"] <= est["high_m"]
    assert {v["vehicle"] for v in report["analysis"]["verdicts"]} == {
        "pedestrian",
        "scooter",
        "car",
        "suv",
        "truck",
    }
    facts = report["triage"]["facts"]
    assert facts["summary_en"] and facts["language"] in ("vi", "es")
    assert api.get(report["overlay_url"]).status_code == 200

    listed = [x["id"] for x in api.get("/api/reports", params={"city": city}).json()]
    assert report["id"] in listed
    seg = api.get("/api/segments", params={"city": city}).json()
    assert seg["features"], "a report should colour the streets around it"
    assert all("status_truck" in f["properties"] for f in seg["features"])


def test_routes_for_every_vehicle_and_preset(api):
    for city in api.get("/api/cities").json():
        for preset in city["presets"]:
            for vehicle in ("pedestrian", "scooter", "car", "suv", "truck"):
                a, b = preset["from"], preset["to"]
                r = api.get(
                    "/api/route",
                    params={
                        "from": f"{a[0]},{a[1]}",
                        "to": f"{b[0]},{b[1]}",
                        "vehicle": vehicle,
                        "city": city["id"],
                    },
                )
                assert r.status_code == 200
                body = r.json()
                assert body["naive"] is not None
                assert body["route"] is not None or body["reason"]


def test_unrecorded_words_do_not_fail_a_report(api):
    sample = api.get("/api/samples", params={"city": "hue"}).json()[0]
    r = api.post(
        "/api/reports",
        data={"lat": 16.467, "lon": 107.585, "city": "hue", "note": "never recorded words"},
        files={"photo": ("s.jpg", api.get(sample["url"]).content, "image/jpeg")},
    )
    assert r.status_code == 200
    assert r.json()["triage"]["facts"] is None
    assert r.json()["warnings"]


def test_unrecorded_photo_is_a_clear_503(api):
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (64, 48), (90, 120, 160)).save(buf, format="JPEG")
    r = api.post(
        "/api/reports",
        data={"lat": 16.467, "lon": 107.585, "city": "hue"},
        files={"photo": ("new.jpg", buf.getvalue(), "image/jpeg")},
    )
    assert r.status_code == 503 and "recorded" in r.json()["detail"]


def test_recorded_questions_replay_and_others_explain(api):
    for city in ("hue", "valencia"):
        examples = api.get("/api/ask/examples", params={"city": city}).json()
        assert len(examples) >= 3
        answer = api.post("/api/ask", json={"city": city, "question": examples[0]}).json()
        assert answer["recorded"] is True and answer["answer"] and answer["steps"]
    r = api.post("/api/ask", json={"city": "hue", "question": "a question nobody recorded"})
    assert r.status_code == 503


def test_credits_cover_both_cities(api):
    credits = api.get("/api/attribution").json()
    cities = {p.get("city") for p in credits["photos"]}
    assert {"hue", "valencia"} <= cities
    assert all(p.get("license") for p in credits["photos"])


def test_status_update_and_media_paths_are_safe(api):
    report = api.get("/api/reports", params={"city": "hue"}).json()[0]
    r = api.patch(f"/api/reports/{report['id']}", json={"status": "dispatched"})
    assert r.json()["status"] == "dispatched"
    assert api.get("/api/demo-media/../../.env").status_code == 404
    assert api.get(f"/api/reports/{report['id']}/report.json").status_code == 404
    json.dumps(report)  # the public shape is plain JSON


def test_public_demo_lock_replays_without_clearing(api, monkeypatch):
    from floodline.config import settings

    monkeypatch.setattr(settings(), "demo_lock", True)
    before = len(api.get("/api/reports", params={"city": "hue"}).json())
    assert api.post("/api/demo/reset", params={"city": "hue"}).status_code == 403
    r = api.post("/api/demo/seed", params={"city": "hue"})
    assert r.status_code == 200 and r.json()["replayed"] is True
    assert len(api.get("/api/reports", params={"city": "hue"}).json()) == before
