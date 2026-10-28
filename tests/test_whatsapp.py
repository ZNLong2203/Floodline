"""WhatsApp intake against a fake Graph API, replaying recorded model answers."""

import hashlib
import hmac
from pathlib import Path

from floodline.config import Settings
from floodline.meta.client import ModelClient
from floodline.store import Store
from floodline.whatsapp import WhatsApp, language_and_city, verify_signature

SAMPLE = "data/demo/photos/quangngai-2013-scooters-pushed-school-01.jpg"


class FakeGraph:
    def __init__(self, media: dict[str, bytes]) -> None:
        self.media_by_id = media
        self.sent: list[tuple[str, str, str]] = []

    def media(self, media_id):
        return self.media_by_id[media_id], "image/jpeg"

    def send_text(self, to, body):
        self.sent.append((to, "text", body))

    def send_image(self, to, jpeg, caption):
        assert jpeg[:2] == b"\xff\xd8"
        self.sent.append((to, "image", caption))


def channel(tmp_path, allowed="84900000001"):
    cfg = Settings(
        _env_file=None,
        MODEL_API_KEY="",
        FLOODLINE_MODEL_MODE="replay",
        FLOODLINE_STATE_DIR=str(tmp_path),
        WHATSAPP_TOKEN="t",
        WHATSAPP_PHONE_NUMBER_ID="1",
        WHATSAPP_ALLOWED=allowed,
    )
    events = []
    graph = FakeGraph({"m1": Path(SAMPLE).read_bytes()})
    wa = WhatsApp(
        cfg,
        Store(tmp_path / "reports"),
        lambda k, p: events.append((k, p)),
        graph,
        ModelClient(cfg.model_copy(update={"model_mode": "replay"})),
    )
    return wa, graph, events


def message(mid, kind, body, sender="84900000001"):
    return {"from": sender, "id": mid, "type": kind, kind: body}


def test_photo_gets_verdict_in_senders_language_and_lands_on_the_map(tmp_path):
    wa, graph, events = channel(tmp_path)
    wa.handle(message("w1", "image", {"id": "m1"}))
    texts = [b for _, k, b in graph.sent if k == "text"]
    assert texts[0].startswith("Đã nhận")  # +84: Vietnamese
    assert "Xe máy:" in texts[-1] and "nước khoảng" in texts[-1]
    assert "Gửi vị trí" in texts[-1]  # no location yet: asks for it
    assert any(k == "image" for _, k, _ in graph.sent)  # the overlay
    kind, report = events[-1]
    assert kind == "report.created" and report["source"] == "whatsapp"
    assert report["location_pending"] is True


def test_location_moves_the_latest_report(tmp_path):
    wa, _, events = channel(tmp_path)
    wa.handle(message("w1", "image", {"id": "m1"}))
    wa.handle(message("w2", "location", {"latitude": 16.4712, "longitude": 107.5866}))
    kind, report = events[-1]
    assert kind == "report.updated"
    assert (report["lat"], report["lon"]) == (16.4712, 107.5866)
    assert report["location_pending"] is False


def test_retries_and_strangers_are_ignored(tmp_path):
    wa, graph, _ = channel(tmp_path)
    assert wa.handle(message("w1", "text", {"body": "help"}))
    assert not wa.handle(message("w1", "text", {"body": "help"}))  # Meta retry
    assert not wa.handle(message("w3", "text", {"body": "hi"}, sender="15550001111"))
    assert len(graph.sent) == 1


def test_hourly_cap(tmp_path):
    wa, graph, _ = channel(tmp_path)
    wa.cfg = wa.cfg.model_copy(update={"whatsapp_hourly_limit": 0})
    wa.handle(message("w1", "image", {"id": "m1"}))
    assert "quá tải" in graph.sent[-1][2]


def test_signature_and_language():
    body = b'{"entry":[]}'
    sig = "sha256=" + hmac.new(b"s3cret", body, hashlib.sha256).hexdigest()
    assert verify_signature("s3cret", body, sig)
    assert not verify_signature("s3cret", body + b" ", sig)
    assert not verify_signature("", body, sig)
    assert language_and_city("34600000000") == ("es", "valencia")
    assert language_and_city("4479000000")[0] == "en"


def test_picture_sent_as_a_document_is_measured(tmp_path):
    wa, _, events = channel(tmp_path)
    wa.handle(
        message("w9", "document", {"id": "m1", "mime_type": "image/jpeg", "filename": "flood.jpg"})
    )
    assert events and events[-1][0] == "report.created"
