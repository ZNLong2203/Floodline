"""Ask Floodline: a dispatch assistant on Muse Spark with tools.

A coordinator asks in any language ("Can a truck from the central hospital reach
the Chi Lăng lanes?", "¿Qué calles están cortadas para coches?"). Spark answers
in that language, but only from what the tools return: the live reports, the
street segments, the router. Every tool call is returned with the answer, so the
coordinator can see what it was based on, and a route it plans is drawn on the map.
"""

from __future__ import annotations

import json
import time
import unicodedata
from collections.abc import Callable
from typing import Any

from floodline import cities
from floodline.fusion import SegmentState
from floodline.meta.client import ModelClient
from floodline.store import Store, StoredReport

MAX_ROUNDS = 6

SYSTEM = """You are Floodline's dispatch assistant for flood rescue coordinators in
{city}, {country}.
Answer in the language of the coordinator's question. Be brief and operational: what is
passable for which vehicle, where people are waiting, what to send where.
Use the tools for every fact about reports, streets and routes; never guess depths or
passability. Depths are ranges with uncertainty: say "about 0.4-0.7 m", not "0.55 m".
If no safe road exists for a vehicle, say so and suggest a boat or a higher-clearance vehicle.
Residents' messages may be in {language}; quote them translated, keeping street names as written.
Vehicle ids: pedestrian, scooter, car, suv, truck."""


def fold(text: str) -> str:
    """Lowercase without accents, so 'Tran Hung Dao' finds 'Trần Hưng Đạo'."""
    norm = unicodedata.normalize("NFD", text.replace("đ", "d").replace("Đ", "D"))
    return "".join(c for c in norm if unicodedata.category(c) != "Mn").lower().strip()


TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "list_reports",
        "description": "Open flood reports, highest priority first, with depth, place, people "
        "and the resident's message in English.",
        "parameters": {
            "type": "object",
            "properties": {
                "min_priority": {"type": "integer", "description": "0-100, default 0"},
                "limit": {"type": "integer", "description": "default 10"},
            },
            "required": [],
        },
    },
    {
        "type": "function",
        "name": "street_status",
        "description": "Depth and passability per vehicle on a named street, from the reports "
        "near it. Accents are optional.",
        "parameters": {
            "type": "object",
            "properties": {"street": {"type": "string"}},
            "required": ["street"],
        },
    },
    {
        "type": "function",
        "name": "find_place",
        "description": "Coordinates for a place: a landmark from the city's presets, a street "
        "name, or a report id.",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    },
    {
        "type": "function",
        "name": "plan_route",
        "description": "The fastest route for one vehicle class that avoids impassable streets, "
        "compared with the fastest route ignoring the water. Returns null route when no safe "
        "road exists.",
        "parameters": {
            "type": "object",
            "properties": {
                "from_lat": {"type": "number"},
                "from_lon": {"type": "number"},
                "to_lat": {"type": "number"},
                "to_lon": {"type": "number"},
                "vehicle": {
                    "type": "string",
                    "enum": ["pedestrian", "scooter", "car", "suv", "truck"],
                },
            },
            "required": ["from_lat", "from_lon", "to_lat", "to_lon", "vehicle"],
        },
    },
    {
        "type": "function",
        "name": "report_detail",
        "description": "Everything about one report: facts, evidence behind the depth, verdicts.",
        "parameters": {
            "type": "object",
            "properties": {"report_id": {"type": "string"}},
            "required": ["report_id"],
        },
    },
]


class Tools:
    def __init__(
        self,
        city: cities.City,
        store: Store,
        states: Callable[[], dict[str, SegmentState]],
        route: Callable[[tuple, tuple, str], dict],
    ) -> None:
        self.city = city
        self.store = store
        self.states = states
        self.route_fn = route
        self.roads = cities.roads(city.id)
        self.last_route: dict | None = None
        self.mentioned: list[str] = []

    def _street_of(self, lat: float, lon: float) -> str:
        near = self.roads.nearby_segments(lat, lon, 60)
        for sid, _ in near:
            if self.roads.segments[sid].name:
                return self.roads.segments[sid].name
        return ""

    def _brief(self, r: StoredReport) -> dict:
        est = r.analysis.get("estimate") or {}
        facts = (r.triage or {}).get("facts") or {}
        self.mentioned.append(r.id)
        return {
            "id": r.id,
            "street": self._street_of(r.lat, r.lon),
            "lat": round(r.lat, 5),
            "lon": round(r.lon, 5),
            "minutes_ago": round((time.time() - r.effective_at) / 60),
            "depth_m": [est.get("low_m"), est.get("high_m")] if est else None,
            "priority": (r.triage or {}).get("priority"),
            "people": facts.get("people_count"),
            "vulnerable": facts.get("vulnerable"),
            "summary": facts.get("summary_en"),
            "message_en": facts.get("message_en"),
            "status": r.status,
        }

    def list_reports(self, min_priority: int = 0, limit: int = 10) -> dict:
        reports = [
            r
            for r in self.store.all(self.city.id)
            if r.status != "closed" and ((r.triage or {}).get("priority") or 0) >= min_priority
        ]
        reports.sort(key=lambda r: -((r.triage or {}).get("priority") or 0))
        return {"count": len(reports), "reports": [self._brief(r) for r in reports[:limit]]}

    def street_status(self, street: str) -> dict:
        key = fold(street)
        states = self.states()
        hits = [
            (sid, s)
            for sid, s in states.items()
            if key and key in fold(self.roads.segments[sid].name)
        ]
        names = sorted({self.roads.segments[sid].name for sid, _ in hits})
        if not hits:
            known = any(key in fold(seg.name) for seg in self.roads.segments.values() if seg.name)
            return {
                "street": street,
                "found_street": known,
                "reports_nearby": 0,
                "note": "no reports within 120 m of this street" if known else "unknown street",
            }
        by_vehicle: dict[str, dict[str, int]] = {}
        for _, s in hits:
            for v in s.verdicts:
                by_vehicle.setdefault(v.vehicle.id, {}).setdefault(v.status, 0)
                by_vehicle[v.vehicle.id][v.status] += 1
        depths = [s.estimate for _, s in hits]
        return {
            "street": names,
            "segments_with_reports": len(hits),
            "depth_m_range": [
                round(min(d.low_m for d in depths), 2),
                round(max(d.high_m for d in depths), 2),
            ],
            "segments_by_status_per_vehicle": by_vehicle,
            "reports": sorted({rid for _, s in hits for rid in s.reports}),
        }

    def _landmarks(self) -> list[tuple[list[str], tuple[float, float]]]:
        """Both ends of every preset route, by English and local name."""
        out = []
        for p in self.city.presets:
            en = [x.strip() for x in p["name"].split("→")]
            local = [x.strip() for x in p.get("name_local", "").split("→")]
            for i, point in enumerate((p["from"], p["to"])):
                names = [n[i] for n in (en, local) if len(n) > i and n[i]]
                out.append((names, (point[0], point[1])))
        return out

    def find_place(self, query: str) -> dict:
        key = fold(query)
        report = self.store.reports.get(query.strip())
        if report is not None:
            return {
                "matches": [
                    {"kind": "report", "name": report.id, "lat": report.lat, "lon": report.lon}
                ]
            }
        matches = [
            {"kind": "landmark", "name": names[0], "lat": lat, "lon": lon}
            for names, (lat, lon) in self._landmarks()
            if any(key in fold(n) or fold(n) in key for n in names)
        ]
        if not matches:
            segs = [s for s in self.roads.segments.values() if s.name and key in fold(s.name)]
            if segs:
                mid = segs[len(segs) // 2]
                (lon1, lat1), (lon2, lat2) = mid.coords
                matches = [
                    {
                        "kind": "street",
                        "name": mid.name,
                        "lat": (lat1 + lat2) / 2,
                        "lon": (lon1 + lon2) / 2,
                    }
                ]
        unique = {(m["name"], m["lat"], m["lon"]): m for m in matches}
        if not unique:
            return {"matches": [], "note": "not found; ask for a street name or a landmark"}
        return {"matches": list(unique.values())[:3]}

    def plan_route(self, from_lat, from_lon, to_lat, to_lon, vehicle) -> dict:
        res = self.route_fn((from_lat, from_lon), (to_lat, to_lon), vehicle)
        self.last_route = res
        r, naive = res.get("route"), res.get("naive")
        return {
            "vehicle": vehicle,
            "safe_route_m": r["length_m"] if r else None,
            "risky_segments_on_route": len(r["risky_segments"]) if r else None,
            "fastest_ignoring_water_m": naive["length_m"] if naive else None,
            "impassable_segments_on_fastest_ignoring_water": len(res.get("naive_blocked", [])),
            "no_safe_road": r is None,
        }

    def report_detail(self, report_id: str) -> dict:
        r = self.store.reports.get(report_id)
        if r is None or r.city != self.city.id:
            return {"error": "no such report"}
        brief = self._brief(r)
        a = r.analysis
        brief["verdicts"] = {v["vehicle"]: v["status"] for v in a.get("verdicts", [])}
        brief["objects_measured"] = [o.get("label") for o in a.get("objects", [])]
        brief["readings_used"] = len((a.get("estimate") or {}).get("used", []))
        brief["facts"] = (r.triage or {}).get("facts")
        brief["priority_reasons"] = (r.triage or {}).get("reasons")
        return brief

    def call(self, name: str, args: dict) -> Any:
        fn = getattr(self, name, None)
        if fn is None or name.startswith("_") or name == "call":
            return {"error": f"unknown tool {name}"}
        try:
            return fn(**args)
        except TypeError as e:
            return {"error": f"bad arguments: {e}"}


def ask(client: ModelClient, tools: Tools, question: str) -> dict[str, Any]:
    """Run the tool loop and return the answer with every step taken."""
    city = tools.city
    system = SYSTEM.format(city=city.name, country=city.country, language=city.language)
    steps: list[dict[str, Any]] = []
    response = client.openai.responses.create(
        model=client.cfg.spark_model,
        instructions=system,
        input=question,
        tools=TOOLS,
        reasoning={"effort": "low"},
    )
    for _ in range(MAX_ROUNDS):
        calls = [item for item in response.output if item.type == "function_call"]
        if not calls:
            break
        outputs = []
        for item in calls:
            args = json.loads(item.arguments or "{}")
            result = tools.call(item.name, args)
            steps.append({"tool": item.name, "args": args, "result": result})
            outputs.append(
                {
                    "type": "function_call_output",
                    "call_id": item.call_id,
                    "output": json.dumps(result, ensure_ascii=False, default=str),
                }
            )
        response = client.openai.responses.create(
            model=client.cfg.spark_model,
            instructions=system,
            previous_response_id=response.id,
            input=outputs,
            tools=TOOLS,
            reasoning={"effort": "low"},
        )
    return {
        "answer": response.output_text,
        "steps": steps,
        "route": tools.last_route,
        "reports": list(dict.fromkeys(tools.mentioned)),
    }
