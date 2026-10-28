"""Telegram intake: anyone can open the bot and report, no app to install beyond Telegram.

The bot speaks English by default; with TELEGRAM_LANGUAGE=auto it follows the
sender's Telegram language (Vietnamese, Spanish, otherwise English). It offers
a one-tap "share my location" button (phone apps only; elsewhere the sender types
a street or landmark) and drops the report on the coordinators' map. Webhook
calls must carry the secret given to setWebhook.
The bot token is part of every request URL, so errors are logged by method and
status only, never with the URL or the exception text.
"""

from __future__ import annotations

import hmac
import logging
import time
from collections.abc import Callable
from typing import Any

import httpx

from floodline import cities
from floodline.chat import TEXT, ChatIntake
from floodline.config import Settings
from floodline.meta.client import ModelClient
from floodline.store import Store

log = logging.getLogger("floodline.telegram")

API = "https://api.telegram.org"
LANGS = {"vi": "hue", "es": "valencia"}
SHARE = {
    "en": "📍 Share my location",
    "vi": "📍 Gửi vị trí của tôi",
    "es": "📍 Compartir ubicación",
}
ASK = {  # the location button only works in the phone apps, hence the typed fallback
    "en": "📍 Tap “Share my location” below (phone app), or type the street name or a landmark "
    "nearby, so the rescue team can find it.",
    "vi": "📍 Bấm “Gửi vị trí của tôi” bên dưới (app điện thoại), hoặc gõ tên đường hay một địa "
    "điểm gần đó, để đội cứu hộ tìm được.",
    "es": "📍 Pulsa «Compartir ubicación» abajo (app del móvil), o escribe el nombre de la calle "
    "o un lugar cercano, para que el equipo te encuentre.",
}
WELCOME = {
    "en": "Floodline measures floodwater from your photos and tells rescue teams which "
    "streets a scooter, a car or a truck can still use.\n\n",
    "vi": "Floodline đo mực nước lũ từ ảnh của bạn và cho đội cứu hộ biết đường nào xe máy, "
    "ô tô hay xe tải còn qua được.\n\n",
    "es": "Floodline mide el agua de tus fotos y dice a los equipos de rescate qué calles "
    "pueden usar una moto, un coche o un camión.\n\n",
}


def check_secret(expected: str, header: str | None) -> bool:
    return bool(expected) and hmac.compare_digest((header or "").encode(), expected.encode())


class BotApi:
    """The few Bot API calls Floodline needs."""

    def __init__(self, token: str) -> None:
        self._base = f"{API}/bot{token}"
        self._files = f"{API}/file/bot{token}"

    def call(self, method: str, data: dict[str, Any] | None = None, files=None) -> dict | None:
        try:
            if files:
                r = httpx.post(f"{self._base}/{method}", data=data, files=files, timeout=60)
            else:
                r = httpx.post(f"{self._base}/{method}", json=data or {}, timeout=30)
        except httpx.HTTPError as exc:
            log.warning("telegram %s unreachable: %s", method, type(exc).__name__)
            return None
        body = r.json() if r.content else {}
        if r.status_code != 200 or not body.get("ok"):
            log.warning(
                "telegram %s refused: %s %s", method, r.status_code, body.get("description")
            )
            return None
        return body.get("result")

    def download(self, file_id: str) -> bytes:
        info = self.call("getFile", {"file_id": file_id})
        if not info or "file_path" not in info:
            raise RuntimeError("telegram file not available")
        r = httpx.get(f"{self._files}/{info['file_path']}", timeout=120)
        r.raise_for_status()
        return r.content


class Telegram(ChatIntake):
    channel = "telegram"

    def __init__(
        self,
        cfg: Settings,
        store: Store,
        publish: Callable[[str, dict], None],
        api: BotApi | None = None,
        client: ModelClient | None = None,
    ) -> None:
        super().__init__(
            cfg,
            store,
            publish,
            client,
            model_mode=cfg.telegram_model_mode,
            hourly_limit=cfg.telegram_hourly_limit,
            daily_limit=cfg.telegram_daily_limit,
        )
        self.api = api or BotApi(cfg.telegram_bot_token)
        self.allowed = {c.strip() for c in cfg.telegram_allowed.split(",") if c.strip()}
        self.langs: dict[str, str] = {}

    @property
    def configured(self) -> bool:
        return bool(self.cfg.telegram_bot_token)

    # -- transport ----------------------------------------------------------------------

    def fetch(self, media_ref: str) -> bytes:
        return self.api.download(media_ref)

    def send_text(self, to: str, body: str, *, ask_location: bool = False) -> None:
        data: dict[str, Any] = {"chat_id": to, "text": body, "disable_web_page_preview": True}
        lang = self.langs.get(to, "en")
        data["reply_markup"] = (
            {
                "keyboard": [[{"text": SHARE[lang], "request_location": True}]],
                "resize_keyboard": True,
                "one_time_keyboard": True,
            }
            if ask_location
            else {"remove_keyboard": True}
        )
        self.api.call("sendMessage", data)

    def send_image(self, to: str, jpeg: bytes, caption: str) -> None:
        self.api.call("sendChatAction", {"chat_id": to, "action": "upload_photo"})
        self.api.call(
            "sendPhoto",
            {"chat_id": to, "caption": caption},
            files={"photo": ("overlay.jpg", jpeg, "image/jpeg")},
        )

    def working(self, to: str) -> None:
        self.api.call("sendChatAction", {"chat_id": to, "action": "typing"})

    def default_city(self, sender: str) -> str:
        return LANGS.get(self.langs.get(sender, "en"), cities.DEFAULT)

    def ask_location(self, lang: str) -> str:
        return ASK[lang]

    # -- updates --------------------------------------------------------------------------

    def handle_update(self, update: dict) -> bool:
        uid = str(update.get("update_id", ""))
        msg = update.get("message") or update.get("edited_message")
        if not msg or uid in self.seen:
            return False
        self.seen[uid] = time.time()
        chat = str(msg.get("chat", {}).get("id", ""))
        if not chat or (self.allowed and chat not in self.allowed):
            log.info("telegram update from a chat that is not allowed")
            return False
        code = self.cfg.telegram_language
        if code == "auto":
            code = (msg.get("from", {}).get("language_code") or "")[:2]
        lang = self.langs.setdefault(chat, code if code in TEXT else "en")
        kind = next(
            (
                k
                for k in ("photo", "video", "document", "voice", "audio", "location", "text")
                if k in msg
            ),
            "other",
        )
        log.info("telegram %s in chat …%s (%s)", kind, chat[-4:], lang)

        if kind == "photo":
            self._media_report(
                chat, lang, msg["photo"][-1]["file_id"], "photo", msg.get("caption", "")
            )
        elif kind == "video":
            self._media_report(chat, lang, msg["video"]["file_id"], "clip", msg.get("caption", ""))
        elif kind == "document" and msg["document"].get("mime_type", "").startswith(
            ("image/", "video/")
        ):
            clip = msg["document"]["mime_type"].startswith("video/")
            self._media_report(
                chat,
                lang,
                msg["document"]["file_id"],
                "clip" if clip else "photo",
                msg.get("caption", ""),
            )
        elif kind == "location":
            loc = msg["location"]
            self._located(chat, lang, float(loc["latitude"]), float(loc["longitude"]))
        elif kind in ("voice", "audio"):
            from floodline.voice import transcribe_upload

            self.api.call("sendChatAction", {"chat_id": chat, "action": "typing"})
            data = self.fetch(msg[kind]["file_id"])
            place = self._city_for(chat)
            self._words(
                chat, lang, transcribe_upload(self.client, data, place.language), spoken=True
            )
        elif kind == "text":
            text = msg["text"].strip()
            if text.startswith("/") or text.lower() in {"hi", "hello", "help", "xin chào", "hola"}:
                self.send_text(chat, WELCOME[lang] + TEXT[lang]["help"])
            else:
                self._words(chat, lang, text)
        else:
            self.send_text(chat, TEXT[lang]["help"])
        return True

    def set_webhook(self, url: str) -> bool:
        return (
            self.api.call(
                "setWebhook",
                {
                    "url": url,
                    "secret_token": self.cfg.telegram_webhook_secret,
                    "allowed_updates": ["message", "edited_message"],
                    "drop_pending_updates": True,
                },
            )
            is not None
        )
