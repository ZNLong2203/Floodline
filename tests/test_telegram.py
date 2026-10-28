"""Telegram intake against a fake Bot API, replaying recorded model answers."""

from pathlib import Path

from floodline.config import Settings
from floodline.meta.client import ModelClient
from floodline.store import Store
from floodline.telegram import Telegram, check_secret

SAMPLE = "data/demo/photos/quangngai-2013-scooters-pushed-school-01.jpg"
SAMPLE_ES = "data/demo/valencia/photos/catarroja-2024-street-people-wading-cars-01.jpg"


class FakeApi:
    def __init__(self, photo: str = SAMPLE) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.photo = photo

    def call(self, method, data=None, files=None):
        self.calls.append((method, data or {}))
        return {"ok": True}

    def download(self, file_id):
        return Path(self.photo).read_bytes()

    def texts(self):
        return [d["text"] for m, d in self.calls if m == "sendMessage"]


def bot(tmp_path, allowed="", photo=SAMPLE, language="auto"):
    cfg = Settings(
        _env_file=None,
        MODEL_API_KEY="",
        FLOODLINE_MODEL_MODE="replay",
        FLOODLINE_STATE_DIR=str(tmp_path),
        TELEGRAM_BOT_TOKEN="t",
        TELEGRAM_WEBHOOK_SECRET="s",
        TELEGRAM_ALLOWED=allowed,
        TELEGRAM_LANGUAGE=language,
    )
    events: list = []
    api = FakeApi(photo)
    tg = Telegram(
        cfg,
        Store(tmp_path / "reports"),
        lambda k, p: events.append((k, p)),
        api,
        ModelClient(cfg.model_copy(update={"model_mode": "replay"})),
    )
    return tg, api, events


def update(uid, chat=42, lang="vi", **message):
    return {
        "update_id": uid,
        "message": {"chat": {"id": chat}, "from": {"language_code": lang}, **message},
    }


def test_photo_gets_overlay_verdict_and_location_button(tmp_path):
    tg, api, events = bot(tmp_path)
    tg.handle_update(update(1, photo=[{"file_id": "small"}, {"file_id": "big"}]))
    assert api.texts()[0].startswith("Đã nhận")
    assert any(m == "sendPhoto" for m, _ in api.calls)
    last = next(d for m, d in reversed(api.calls) if m == "sendMessage")
    assert "Xe máy:" in last["text"]
    assert last["reply_markup"]["keyboard"][0][0]["request_location"] is True
    kind, report = events[-1]
    assert kind == "report.created" and report["source"] == "telegram" and report["city"] == "hue"


def test_english_by_default_whatever_the_senders_language(tmp_path):
    tg, api, events = bot(tmp_path, language="en")
    tg.handle_update(update(1, lang="vi", photo=[{"file_id": "p"}]))
    assert api.texts()[0].startswith("Got it")
    assert "Scooter:" in api.texts()[-1]
    assert events[-1][1]["city"] == "hue"


def test_shared_location_moves_the_report_and_spanish_goes_to_valencia(tmp_path):
    tg, _, events = bot(tmp_path, photo=SAMPLE_ES)
    tg.handle_update(update(1, lang="es", photo=[{"file_id": "p"}]))
    assert events[-1][1]["city"] == "valencia"
    tg.handle_update(update(2, lang="es", location={"latitude": 39.41, "longitude": -0.40}))
    kind, report = events[-1]
    assert kind == "report.updated" and report["location_pending"] is False


def test_start_command_welcomes_and_repeats_are_dropped(tmp_path):
    tg, api, _ = bot(tmp_path)
    assert tg.handle_update(update(7, lang="en", text="/start"))
    assert not tg.handle_update(update(7, lang="en", text="/start"))
    assert "Floodline measures floodwater" in api.texts()[0]


def test_allow_list_and_daily_cap(tmp_path):
    tg, api, _ = bot(tmp_path, allowed="99")
    assert not tg.handle_update(update(1, chat=42, text="/start"))
    tg, api, _ = bot(tmp_path)
    tg.daily_limit = 0
    tg.handle_update(update(1, photo=[{"file_id": "p"}]))
    assert "quá tải" in api.texts()[-1]


def test_secret_header():
    assert check_secret("s", "s")
    assert not check_secret("s", "x")
    assert not check_secret("", "")
