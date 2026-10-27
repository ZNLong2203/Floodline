"""Reports on disk: one folder per report, reloaded on start."""

from __future__ import annotations

import json
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path
from threading import Lock
from typing import Any

from floodline.estimate import DepthEstimate, Reading
from floodline.fusion import Report


@dataclass
class StoredReport:
    id: str
    lat: float
    lon: float
    at: float
    note: str
    analysis: dict[str, Any]
    triage: dict[str, Any] | None = None
    transcript: str | None = None
    source: str = "web"
    status: str = "new"  # new | acknowledged | dispatched | closed
    city: str = "hue"
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def estimate(self) -> DepthEstimate | None:
        e = self.analysis.get("estimate")
        if not e:
            return None
        used = [
            Reading(r["source"], r["low_m"], r["high_m"], r.get("note", ""), mu=r.get("mean_m"))
            for r in e.get("used", [])
        ]
        return DepthEstimate(mean_m=e["mean_m"], sigma_m=e["sigma_m"], used=used)

    def for_fusion(self) -> Report | None:
        est = self.estimate
        if est is None:
            return None
        flowing = self.analysis.get("perception", {}).get("water_flow") == "fast"
        return Report(self.id, self.lat, self.lon, self.at, est, flowing)

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "lat": self.lat,
            "lon": self.lon,
            "at": self.at,
            "note": self.note,
            "source": self.source,
            "status": self.status,
            "city": self.city,
            "transcript": self.transcript,
            "triage": self.triage,
            "analysis": self.analysis,
            "image_url": f"/api/reports/{self.id}/image.jpg",
            "overlay_url": f"/api/reports/{self.id}/overlay.jpg",
            **self.extra,
        }


class Store:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self.reports: dict[str, StoredReport] = {}
        for meta in sorted(root.glob("*/report.json")):
            data = json.loads(meta.read_text())
            self.reports[data["id"]] = StoredReport(**data)

    def new_id(self) -> str:
        return time.strftime("%Y%m%d-%H%M%S-") + secrets.token_hex(2)

    def save(
        self,
        report: StoredReport,
        image: bytes | None = None,
        overlay: bytes | None = None,
        clip: bytes | None = None,
    ) -> None:
        folder = self.root / report.id
        folder.mkdir(parents=True, exist_ok=True)
        if clip:
            (folder / "overlay.mp4").write_bytes(clip)
            report.extra["video_url"] = f"/api/reports/{report.id}/overlay.mp4"
        if image is not None:
            (folder / "image.jpg").write_bytes(image)
        if overlay is not None:
            (folder / "overlay.jpg").write_bytes(overlay)
        (folder / "report.json").write_text(
            json.dumps(report.__dict__, ensure_ascii=False, indent=1)
        )
        with self._lock:
            self.reports[report.id] = report

    def file(self, report_id: str, name: str) -> Path | None:
        path = self.root / report_id / name
        return path if report_id in self.reports and path.exists() else None

    def all(self, city: str | None = None) -> list[StoredReport]:
        reports = [r for r in self.reports.values() if city is None or r.city == city]
        return sorted(reports, key=lambda r: r.at, reverse=True)

    def clear(self, city: str | None = None) -> None:
        import shutil

        with self._lock:
            for rid, r in list(self.reports.items()):
                if city is None or r.city == city:
                    shutil.rmtree(self.root / rid, ignore_errors=True)
                    del self.reports[rid]
