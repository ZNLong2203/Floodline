"""Chat intake shared by the messaging channels (Telegram, WhatsApp).

    photo or clip   -> "measuring…", then the verdict per vehicle and the overlay,
                       in the sender's language; the report appears on the map
    location        -> moves the sender's latest report to where they are; while a
                       report waits for one, a typed street, landmark, map link or
                       "lat, lon" does the same
    voice note/text -> transcribed, attached to the latest report, triage re-run

A channel subclasses ChatIntake and provides the transport: fetch a media file,
send text (optionally asking for the location), send an image, and its defaults
for the sender's city. Photos are capped per hour and per day because the
channels call the models live.
"""

from __future__ import annotations

import re
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from types import SimpleNamespace

from floodline import cities
from floodline.config import Settings
from floodline.meta.client import ModelClient
from floodline.store import Store, StoredReport

SESSION_MINUTES = 30
# "16.4637, 107.5909", also inside map links (…/@16.4637,107.5909,17z or ?q=16.46,107.59)
COORDS = re.compile(r"(-?\d{1,2}\.\d{2,})\s*,\s*(-?\d{1,3}\.\d{2,})")
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
        "ask_location": "📍 Share your location (📎 → Location), or type the street name or a "
        "landmark nearby, so the rescue team can find it.",
        "located": "📍 Thanks — your report is now at your location on the map.",
        "located_at": "📍 Thanks — your report is now at {place} on the map.",
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
        "ask_location": "📍 Gửi vị trí của bạn (📎 → Vị trí), hoặc gõ tên đường hay một địa điểm "
        "gần đó, để đội cứu hộ tìm được.",
        "located": "📍 Cảm ơn — báo cáo đã được đặt đúng vị trí của bạn trên bản đồ.",
        "located_at": "📍 Cảm ơn — báo cáo đã được đặt tại {place} trên bản đồ.",
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
        "ask_location": "📍 Comparte tu ubicación (📎 → Ubicación), o escribe el nombre de la calle "
        "o un lugar cercano, para que el equipo te encuentre.",
        "located": "📍 Gracias — tu aviso ya está en tu ubicación en el mapa.",
        "located_at": "📍 Gracias — tu aviso ya está en {place} en el mapa.",
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


@dataclass
class Session:
    report_id: str | None = None
    at: float = 0.0
    lat: float | None = None
    lon: float | None = None
    words: list[str] = field(default_factory=list)


class ChatIntake:
    channel = "chat"

    def __init__(
        self,
        cfg: Settings,
        store: Store,
        publish: Callable[[str, dict], None],
        client: ModelClient | None,
        *,
        model_mode: str,
        hourly_limit: int,
        daily_limit: int,
    ) -> None:
        self.cfg = cfg
        self.store = store
        self.publish = publish
        mode = model_mode if cfg.model_api_key else "replay"
        self.client = client or ModelClient(cfg.model_copy(update={"model_mode": mode}))
        self.hourly_limit = hourly_limit
        self.daily_limit = daily_limit
        self.sessions: dict[str, Session] = {}
        self.seen: dict[str, float] = {}
        self.recent: deque[float] = deque()
        self.today: deque[float] = deque()

    # -- transport, provided by each channel ------------------------------------------

    def fetch(self, media_ref: str) -> bytes:
        raise NotImplementedError

    def send_text(self, to: str, body: str, *, ask_location: bool = False) -> None:
        raise NotImplementedError

    def send_image(self, to: str, jpeg: bytes, caption: str) -> None:
        raise NotImplementedError

    def default_city(self, sender: str) -> str:
        return cities.DEFAULT

    def working(self, to: str) -> None:
        """Show that something is happening, where the channel can."""

    def ask_location(self, lang: str) -> str:
        return TEXT[lang]["ask_location"]

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
        return cities.get(self.default_city(sender))

    def _allow_one_more(self) -> bool:
        now = time.time()
        while self.recent and now - self.recent[0] > 3600:
            self.recent.popleft()
        while self.today and now - self.today[0] > 86400:
            self.today.popleft()
        if len(self.recent) >= self.hourly_limit or len(self.today) >= self.daily_limit:
            return False
        self.recent.append(now)
        self.today.append(now)
        return True

    def _media_report(self, sender: str, lang: str, media_id: str, kind: str, caption: str) -> None:
        t = TEXT[lang]
        if not self._allow_one_more():
            self.send_text(sender, t["busy"])
            return
        self.send_text(sender, t["measuring"].format(kind=t[kind]))
        self.working(sender)
        data = self.fetch(media_id)
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
            source=self.channel,
            city=place.id,
            extra={"channel": self.channel, "location_pending": not located},
        )
        self.store.save(report, image=image, overlay=overlay, clip=clip)
        self.publish("report.created", report.public())
        s.report_id, s.at, s.words = report.id, time.time(), []

        text = verdict_text(report, lang, kind)
        if overlay:
            self.send_image(sender, overlay, t["overlay"])
        if located:
            self.send_text(sender, text)
        else:
            self.send_text(sender, text + "\n\n" + self.ask_location(lang), ask_location=True)

    def _located(self, sender: str, lang: str, lat: float, lon: float) -> None:
        s = self._session(sender)
        s.lat, s.lon = lat, lon
        report = self.store.reports.get(s.report_id or "")
        if report is not None and report.extra.get("location_pending"):
            report.lat, report.lon = lat, lon
            report.extra["location_pending"] = False
            self.store.save(report)
            self.publish("report.updated", report.public())
        self.send_text(sender, TEXT[lang]["located"])

    def _place_in(self, text: str, city: cities.City) -> tuple[float, float, str] | None:
        """A place the sender typed: coordinates or a map link, a landmark, or a street."""
        if m := COORDS.search(text):
            lat, lon = float(m[1]), float(m[2])
            # only near a city we map, so "0.50, 0.60 m" is not read as a position
            if any(
                abs(lat - c.center[0]) < 1 and abs(lon - c.center[1]) < 1
                for c in cities.all_cities().values()
            ):
                return lat, lon, f"{lat:.5f}, {lon:.5f}"
        from floodline.assistant import Tools, fold

        key = f" {re.sub(r'[^a-z0-9]+', ' ', fold(text))} "
        tools = Tools(city, self.store, dict, lambda *a: {})

        def said(name: str) -> bool:
            folded = re.sub(r"[^a-z0-9]+", " ", fold(name)).strip()
            return len(folded) >= 4 and f" {folded} " in key

        for names, (lat, lon) in tools._landmarks():
            if any(said(n) for n in names):
                return lat, lon, names[0]
        streets = sorted(
            {seg.name for seg in tools.roads.segments.values() if seg.name and said(seg.name)},
            key=len,
            reverse=True,
        )
        if streets:
            segs = [seg for seg in tools.roads.segments.values() if seg.name == streets[0]]
            (lon1, lat1), (lon2, lat2) = segs[len(segs) // 2].coords
            return (lat1 + lat2) / 2, (lon1 + lon2) / 2, streets[0]
        return None

    def _words(self, sender: str, lang: str, words: str) -> None:
        if not words:
            return
        s = self._session(sender)
        report = self.store.reports.get(s.report_id or "")
        if report is None:
            s.words.append(words)  # kept for the photo that follows
            s.at = time.time()
            self.send_text(sender, TEXT[lang]["help"])
            return
        if report.extra.get("location_pending"):
            found = self._place_in(words, cities.get(report.city))
            if found:
                lat, lon, name = found
                s.lat, s.lon = lat, lon
                report.lat, report.lon = lat, lon
                report.extra["location_pending"] = False
                if COORDS.search(words):  # a bare position, nothing to add to the report
                    self.store.save(report)
                    self.publish("report.updated", report.public())
                else:
                    self._attach(report, words)
                self.send_text(sender, TEXT[lang]["located_at"].format(place=name))
                return
        self._attach(report, words)
        self.send_text(sender, TEXT[lang]["words"].format(words=words[:200]))

    def _attach(self, report: StoredReport, words: str) -> None:
        """Add the sender's words to the report and re-run triage with them."""
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
