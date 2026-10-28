"""WhatsApp intake: residents report through the chat app they already have.

    photo or clip   -> "measuring…", then the verdict per vehicle and the overlay,
                       in the sender's language; the report appears on the map
    location        -> moves the sender's latest report to where they are
    voice note/text -> transcribed, attached to the latest report, triage re-run

Messages arrive on the Cloud API webhook. Every POST is checked against the app
secret, only allowed numbers are served, retries of the same message are ignored,
and photos are capped per hour because the channel calls the models live.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import time
from collections.abc import Callable
from typing import Any

import httpx

from floodline import cities
from floodline.chat import TEXT, ChatIntake, verdict_text
from floodline.config import Settings
from floodline.meta.client import ModelClient
from floodline.store import Store

__all__ = ["TEXT", "WhatsApp", "language_and_city", "verdict_text", "verify_signature"]

log = logging.getLogger("floodline.whatsapp")

COUNTRY = {"84": ("vi", "hue"), "34": ("es", "valencia")}


def language_and_city(wa_id: str) -> tuple[str, str]:
    for prefix, found in COUNTRY.items():
        if wa_id.startswith(prefix):
            return found
    return "en", cities.DEFAULT


def verify_signature(secret: str, body: bytes, header: str | None) -> bool:
    """Meta signs every webhook POST with the app secret (X-Hub-Signature-256)."""
    if not secret or not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header.removeprefix("sha256="))


class Graph:
    """The few Cloud API calls Floodline needs."""

    def __init__(self, cfg: Settings) -> None:
        self.cfg = cfg
        self.base = f"https://graph.facebook.com/{cfg.whatsapp_graph_version}"
        self.headers = {"Authorization": f"Bearer {cfg.whatsapp_token}"}

    def media(self, media_id: str) -> tuple[bytes, str]:
        meta = httpx.get(f"{self.base}/{media_id}", headers=self.headers, timeout=30).json()
        r = httpx.get(meta["url"], headers=self.headers, timeout=120, follow_redirects=True)
        r.raise_for_status()
        return r.content, meta.get("mime_type", "")

    def send_text(self, to: str, body: str) -> None:
        self._send(to, {"type": "text", "text": {"body": body, "preview_url": False}})

    def send_image(self, to: str, jpeg: bytes, caption: str) -> None:
        r = httpx.post(
            f"{self.base}/{self.cfg.whatsapp_phone_number_id}/media",
            headers=self.headers,
            data={"messaging_product": "whatsapp", "type": "image/jpeg"},
            files={"file": ("overlay.jpg", jpeg, "image/jpeg")},
            timeout=60,
        )
        r.raise_for_status()
        self._send(to, {"type": "image", "image": {"id": r.json()["id"], "caption": caption}})

    def _send(self, to: str, message: dict[str, Any]) -> None:
        r = httpx.post(
            f"{self.base}/{self.cfg.whatsapp_phone_number_id}/messages",
            headers=self.headers,
            json={"messaging_product": "whatsapp", "to": to, **message},
            timeout=30,
        )
        r.raise_for_status()


class WhatsApp(ChatIntake):
    channel = "whatsapp"

    def __init__(
        self,
        cfg: Settings,
        store: Store,
        publish: Callable[[str, dict], None],
        graph: Graph | None = None,
        client: ModelClient | None = None,
    ) -> None:
        super().__init__(
            cfg,
            store,
            publish,
            client,
            model_mode=cfg.whatsapp_model_mode,
            hourly_limit=cfg.whatsapp_hourly_limit,
            daily_limit=cfg.whatsapp_hourly_limit * 24,
        )
        self.graph = graph or Graph(cfg)
        self.allowed = {n.strip().lstrip("+") for n in cfg.whatsapp_allowed.split(",") if n.strip()}

    def fetch(self, media_ref: str) -> bytes:
        return self.graph.media(media_ref)[0]

    def send_text(self, to: str, body: str, *, ask_location: bool = False) -> None:
        self.graph.send_text(to, body)

    def send_image(self, to: str, jpeg: bytes, caption: str) -> None:
        self.graph.send_image(to, jpeg, caption)

    def default_city(self, sender: str) -> str:
        return language_and_city(sender)[1]

    @property
    def configured(self) -> bool:
        return bool(self.cfg.whatsapp_token and self.cfg.whatsapp_phone_number_id)

    # -- webhook ------------------------------------------------------------------

    def handle_payload(self, payload: dict) -> int:
        """Process every message in a webhook payload; returns how many were handled."""
        handled = 0
        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})
                messages, statuses = value.get("messages", []), value.get("statuses", [])
                log.info(
                    "whatsapp %s: %d message(s), %d status(es)",
                    change.get("field"),
                    len(messages),
                    len(statuses),
                )
                for st in statuses:
                    errors = [f"{e.get('code')} {e.get('title')}" for e in st.get("errors", [])]
                    log.info(
                        "whatsapp status %s to …%s %s",
                        st.get("status"),
                        str(st.get("recipient_id", ""))[-4:],
                        "; ".join(errors),
                    )
                for message in messages:
                    if self.handle(message):
                        handled += 1
        return handled

    def handle(self, message: dict) -> bool:
        sender, mid = message.get("from", ""), message.get("id", "")
        if not sender or mid in self.seen:
            return False
        self.seen[mid] = time.time()
        kind = message.get("type")
        allowed = not self.allowed or sender in self.allowed
        log.info(
            "whatsapp message %s from …%s: %s",
            kind,
            sender[-4:],
            "ok" if allowed else "not allowed",
        )
        if not allowed:
            return False
        lang, _ = language_and_city(sender)
        if kind == "document" and message["document"].get("mime_type", "").startswith(
            ("image/", "video/")
        ):
            # Desktop WhatsApp often sends a dropped picture or clip as a file.
            doc = message["document"]
            kind = "video" if doc["mime_type"].startswith("video/") else "image"
            message = {**message, "type": kind, kind: doc}
        if kind in ("image", "video"):
            self._media_report(
                sender,
                lang,
                message[kind]["id"],
                "clip" if kind == "video" else "photo",
                message[kind].get("caption", ""),
            )
        elif kind == "location":
            loc = message["location"]
            self._located(sender, lang, float(loc["latitude"]), float(loc["longitude"]))
        elif kind == "audio":
            from floodline.voice import transcribe_upload

            data = self.fetch(message["audio"]["id"])
            place = self._city_for(sender)
            self._words(sender, lang, transcribe_upload(self.client, data, place.language))
        elif kind == "text":
            body = message["text"]["body"].strip()
            if body.lower() in {"hi", "hello", "help", "?", "xin chào", "chào", "hola", "ayuda"}:
                self.send_text(sender, TEXT[lang]["help"])
            else:
                self._words(sender, lang, body)
        else:
            self.send_text(sender, TEXT[lang]["help"])
        return True
