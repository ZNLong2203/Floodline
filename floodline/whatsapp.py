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
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

import httpx

from floodline import cities
from floodline.config import Settings
from floodline.meta.client import ModelClient
from floodline.store import Store, StoredReport

log = logging.getLogger("floodline.whatsapp")
SESSION_MINUTES = 30
ICONS = {"pedestrian": "🚶", "scooter": "🛵", "car": "🚗", "suv": "🚙", "truck": "🚚"}

TEXT = {
    "en": {
        "measuring": "Got it — measuring the water in your {kind}…",
        "header": "🌊 Floodline · water about {lo}–{hi} m",
        "passable": "can pass",
        "risky": "risky, check first",
        "impassable": "cannot pass",
        "no_reading": "🌊 Floodline · we couldn't measure the water in this {kind}. Try a photo with "
        "a person, scooter or car standing in the water.",
        "on_map": "Your report is on the coordinators' map.",
        "ask_location": "📍 Share your location (📎 → Location) so the rescue team can find it.",
        "located": "📍 Thanks — your report is now at your location on the map.",
        "words": "📝 Added to your report: “{words}”",
        "safety": "Don't walk or drive through moving water.",
        "busy": "Floodline is busy — please try again in a few minutes.",
        "help": "Send a photo or a 10–30 s video of the flooded street, with a person, scooter or car "
        "in the water. Floodline measures the depth and tells you what can get through.",
        "overlay": "What Floodline measured",
        "photo": "photo",
        "clip": "video",
    },
    "vi": {
        "measuring": "Đã nhận — đang đo mực nước trong {kind}…",
        "header": "🌊 Floodline · nước khoảng {lo}–{hi} m",
        "passable": "qua được",
        "risky": "rủi ro, cần kiểm tra",
        "impassable": "KHÔNG qua được",
        "no_reading": "🌊 Floodline · chưa đo được mực nước trong {kind} này. Hãy chụp có người, xe "
        "máy hoặc ô tô đang đứng trong nước.",
        "on_map": "Báo cáo của bạn đã hiện trên bản đồ của đội điều phối.",
        "ask_location": "📍 Gửi vị trí của bạn (📎 → Vị trí) để đội cứu hộ tìm được.",
        "located": "📍 Cảm ơn — báo cáo đã được đặt đúng vị trí của bạn trên bản đồ.",
        "words": "📝 Đã thêm vào báo cáo: “{words}”",
        "safety": "Không lội hay đi xe qua chỗ nước chảy xiết.",
        "busy": "Floodline đang quá tải — vui lòng thử lại sau vài phút.",
        "help": "Gửi ảnh hoặc video 10–30 giây con đường bị ngập, có người, xe máy hoặc ô tô đứng "
        "trong nước. Floodline sẽ đo độ sâu và cho biết xe nào qua được.",
        "overlay": "Những gì Floodline đo được",
        "photo": "ảnh",
        "clip": "video",
    },
    "es": {
        "measuring": "Recibido — midiendo el agua de tu {kind}…",
        "header": "🌊 Floodline · agua de unos {lo}–{hi} m",
        "passable": "puede pasar",
        "risky": "arriesgado, comprobar antes",
        "impassable": "NO puede pasar",
        "no_reading": "🌊 Floodline · no pudimos medir el agua en este {kind}. Prueba con una foto "
        "con una persona, moto o coche dentro del agua.",
        "on_map": "Tu aviso ya está en el mapa de los coordinadores.",
        "ask_location": "📍 Comparte tu ubicación (📎 → Ubicación) para que el equipo te encuentre.",
        "located": "📍 Gracias — tu aviso ya está en tu ubicación en el mapa.",
        "words": "📝 Añadido a tu aviso: «{words}»",
        "safety": "No camines ni conduzcas por agua en movimiento.",
        "busy": "Floodline está ocupado — inténtalo de nuevo en unos minutos.",
        "help": "Envía una foto o un vídeo de 10–30 s de la calle inundada, con una persona, moto o "
        "coche en el agua. Floodline mide la profundidad y te dice qué puede pasar.",
        "overlay": "Lo que midió Floodline",
        "photo": "foto",
        "clip": "vídeo",
    },
}
VEHICLE_NAMES = {
    "en": {
        "pedestrian": "On foot",
        "scooter": "Scooter",
        "car": "Car",
        "suv": "SUV / pickup",
        "truck": "Rescue truck",
    },
    "vi": {
        "pedestrian": "Đi bộ",
        "scooter": "Xe máy",
        "car": "Ô tô",
        "suv": "Xe gầm cao",
        "truck": "Xe tải cứu hộ",
    },
    "es": {
        "pedestrian": "A pie",
        "scooter": "Moto",
        "car": "Coche",
        "suv": "Todoterreno",
        "truck": "Camión de rescate",
    },
}
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


def verdict_text(report: StoredReport, lang: str, kind: str) -> str:
    t = TEXT[lang]
    est = report.analysis.get("estimate")
    if not est:
        return t["no_reading"].format(kind=t[kind])
    lines = [t["header"].format(lo=f"{est['low_m']:.2f}", hi=f"{est['high_m']:.2f}")]
    for v in report.analysis.get("verdicts", []):
        name = VEHICLE_NAMES[lang].get(v["vehicle"], v["vehicle"])
        lines.append(f"{ICONS.get(v['vehicle'], '•')} {name}: {t[v['status']]}")
    lines += ["", t["on_map"], t["safety"]]
    return "\n".join(lines)


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


@dataclass
class Session:
    report_id: str | None = None
    at: float = 0.0
    lat: float | None = None
    lon: float | None = None
    words: list[str] = field(default_factory=list)


class WhatsApp:
    def __init__(
        self,
        cfg: Settings,
        store: Store,
        publish: Callable[[str, dict], None],
        graph: Graph | None = None,
        client: ModelClient | None = None,
    ) -> None:
        self.cfg = cfg
        self.store = store
        self.publish = publish
        self.graph = graph or Graph(cfg)
        mode = cfg.whatsapp_model_mode if cfg.model_api_key else "replay"
        self.client = client or ModelClient(cfg.model_copy(update={"model_mode": mode}))
        self.allowed = {n.strip().lstrip("+") for n in cfg.whatsapp_allowed.split(",") if n.strip()}
        self.sessions: dict[str, Session] = {}
        self.seen: dict[str, float] = {}
        self.recent: deque[float] = deque()

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

            data, _ = self.graph.media(message["audio"]["id"])
            place = self._city_for(sender)
            self._words(sender, lang, transcribe_upload(self.client, data, place.language))
        elif kind == "text":
            body = message["text"]["body"].strip()
            if body.lower() in {"hi", "hello", "help", "?", "xin chào", "chào", "hola", "ayuda"}:
                self.graph.send_text(sender, TEXT[lang]["help"])
            else:
                self._words(sender, lang, body)
        else:
            self.graph.send_text(sender, TEXT[lang]["help"])
        return True

    # -- steps ----------------------------------------------------------------------

    def _session(self, sender: str) -> Session:
        s = self.sessions.setdefault(sender, Session())
        if time.time() - s.at > SESSION_MINUTES * 60:
            s.report_id, s.words = None, []
        return s

    def _city_for(self, sender: str) -> cities.City:
        s = self._session(sender)
        if s.lat is not None:
            return min(
                cities.all_cities().values(),
                key=lambda c: (c.center[0] - s.lat) ** 2 + (c.center[1] - s.lon) ** 2,
            )
        return cities.get(language_and_city(sender)[1])

    def _allow_one_more(self) -> bool:
        now = time.time()
        while self.recent and now - self.recent[0] > 3600:
            self.recent.popleft()
        if len(self.recent) >= self.cfg.whatsapp_hourly_limit:
            return False
        self.recent.append(now)
        return True

    def _media_report(self, sender: str, lang: str, media_id: str, kind: str, caption: str) -> None:
        t = TEXT[lang]
        if not self._allow_one_more():
            self.graph.send_text(sender, t["busy"])
            return
        self.graph.send_text(sender, t["measuring"].format(kind=t[kind]))
        data, _ = self.graph.media(media_id)
        s = self._session(sender)
        place = self._city_for(sender)
        cat = cities.catalog(place.id)
        if kind == "clip":
            from floodline.video import analyse_clip

            result = analyse_clip(self.client, data, catalog=cat, local_language=place.language)
            image, overlay, clip = (
                result.key_frame_jpeg,
                result.key_overlay_jpeg,
                result.overlay_mp4,
            )
        else:
            from floodline.pipeline import analyse

            result = analyse(self.client, data, catalog=cat)
            image, overlay, clip = result.image_jpeg, result.overlay_jpeg, None
        words = " ".join([caption.strip(), *s.words]).strip()
        from floodline.triage import triage

        tri = triage(self.client, result, words, None, local_language=place.language)
        located = s.lat is not None
        report = StoredReport(
            id=self.store.new_id(),
            lat=s.lat if located else place.center[0],
            lon=s.lon if located else place.center[1],
            at=time.time(),
            note=words,
            analysis=result.to_dict(),
            triage=tri,
            source="whatsapp",
            city=place.id,
            extra={"channel": "whatsapp", "location_pending": not located},
        )
        self.store.save(report, image=image, overlay=overlay, clip=clip)
        self.publish("report.created", report.public())
        s.report_id, s.at, s.words = report.id, time.time(), []

        text = verdict_text(report, lang, kind)
        if overlay:
            self.graph.send_image(sender, overlay, t["overlay"])
        self.graph.send_text(sender, text + ("" if located else "\n\n" + t["ask_location"]))

    def _located(self, sender: str, lang: str, lat: float, lon: float) -> None:
        s = self._session(sender)
        s.lat, s.lon = lat, lon
        report = self.store.reports.get(s.report_id or "")
        if report is not None and report.extra.get("location_pending"):
            report.lat, report.lon = lat, lon
            report.extra["location_pending"] = False
            self.store.save(report)
            self.publish("report.updated", report.public())
        self.graph.send_text(sender, TEXT[lang]["located"])

    def _words(self, sender: str, lang: str, words: str) -> None:
        if not words:
            return
        s = self._session(sender)
        report = self.store.reports.get(s.report_id or "")
        if report is None:
            s.words.append(words)  # kept for the photo that follows
            s.at = time.time()
            self.graph.send_text(sender, TEXT[lang]["help"])
            return
        from floodline.triage import score, triage

        report.transcript = ((report.transcript or "") + " " + words).strip()
        place = cities.get(report.city)

        seen = SimpleNamespace(  # what triage reads from an analysis
            perception=report.analysis.get("perception", {}), estimate=report.estimate
        )
        try:
            report.triage = triage(
                self.client, seen, report.note, report.transcript, local_language=place.language
            )
        except Exception:
            est = report.estimate
            priority, why = score({}, est.mean_m if est else None)
            report.triage = {"priority": priority, "reasons": why, "facts": None}
        self.store.save(report)
        self.publish("report.updated", report.public())
        self.graph.send_text(sender, TEXT[lang]["words"].format(words=words[:200]))
