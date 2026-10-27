"""Order the rescue queue, in the coordinator's language and the resident's.

Muse Spark reads the resident's words (typed or spoken, in their own language)
next to what the photo showed and extracts facts: how many people, who is
vulnerable, whether anyone is hurt, whether the water is rising. It translates
the message and writes the summary and a dispatch draft in English and in the
resident's language, so a local team and an international responder read the
same report. The priority itself is a fixed, published formula over those facts
and the measured depth, so two coordinators always see the same order and why.
"""

from __future__ import annotations

from typing import Any

from floodline.meta.client import ModelClient

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "people_count": {"type": "integer"},
        "vulnerable": {
            "type": "array",
            "items": {
                "type": "string",
                "enum": ["elderly", "child", "infant", "pregnant", "disabled", "sick"],
            },
        },
        "injury_or_medical": {"type": "boolean"},
        "water_rising": {"type": "string", "enum": ["yes", "no", "unknown"]},
        "trapped": {"type": "boolean"},
        "needs": {
            "type": "array",
            "items": {
                "type": "string",
                "enum": ["evacuation", "boat", "medical", "food", "water", "power", "info"],
            },
        },
        "address_hint": {"type": "string"},
        "language": {"type": "string"},
        "message_en": {"type": "string"},
        "summary_en": {"type": "string"},
        "summary_local": {"type": "string"},
        "dispatch_en": {"type": "string"},
        "dispatch_local": {"type": "string"},
    },
    "required": [
        "people_count",
        "vulnerable",
        "injury_or_medical",
        "water_rising",
        "trapped",
        "needs",
        "address_hint",
        "language",
        "message_en",
        "summary_en",
        "summary_local",
        "dispatch_en",
        "dispatch_local",
    ],
    "additionalProperties": False,
}

SYSTEM = (
    "You extract facts from flood help requests for rescue coordinators, who may not speak the "
    "resident's language. Report only what the resident said or the photo facts show; never "
    "invent people or needs. Keep street names and house numbers exactly as written."
)


def score(facts: dict[str, Any], depth_m: float | None) -> tuple[int, list[str]]:
    """Priority 0-100 and the reasons for it. Published in docs/triage.md."""
    points, why = 0, []
    if facts.get("injury_or_medical"):
        points += 30
        why.append("injury or medical need")
    vulnerable = facts.get("vulnerable") or []
    if vulnerable:
        points += 10 + 5 * min(len(vulnerable), 3)
        why.append("vulnerable: " + ", ".join(vulnerable))
    if facts.get("trapped"):
        points += 15
        why.append("trapped")
    if facts.get("water_rising") == "yes":
        points += 10
        why.append("water rising")
    if depth_m is not None:
        if depth_m >= 1.0:
            points += 20
            why.append(f"depth {depth_m:.1f} m")
        elif depth_m >= 0.5:
            points += 10
            why.append(f"depth {depth_m:.1f} m")
    people = facts.get("people_count") or 0
    if people >= 5:
        points += 5
        why.append(f"{people} people")
    return min(points, 100), why


def triage(
    client: ModelClient,
    analysis,  # PhotoAnalysis or ClipAnalysis: anything with .perception and .estimate
    note: str,
    transcript: str | None,
    *,
    local_language: str = "Vietnamese",
) -> dict[str, Any]:
    words = "\n".join(x for x in (note.strip(), (transcript or "").strip()) if x)
    seen = analysis.perception
    est = analysis.estimate
    photo_facts = {
        "people_in_photo": seen.get("people", {}),
        "depth_m": [round(est.low_m, 2), round(est.high_m, 2)] if est else None,
        "photo_summary": seen.get("summary_vi", ""),
    }
    facts = client.spark_json(
        system=SYSTEM,
        text=(
            f"Resident's message (may be empty):\n{words or '(none)'}\n\n"
            f"What the photo showed: {photo_facts}\n\n"
            "Extract the facts. language: the language of the resident's message (or "
            f"{local_language} if there is none). message_en: the message translated to English, "
            "faithfully, empty if there is none. summary_en / summary_local: one line for the "
            f"coordinator, in English and in {local_language}. dispatch_en / dispatch_local: a "
            "short message a coordinator could send to a rescue team, including the depth range, "
            f"in English and in {local_language}."
        ),
        schema_name="flood_triage",
        schema=SCHEMA,
        effort="low",
    )
    priority, why = score(facts, est.mean_m if est else None)
    return {"priority": priority, "reasons": why, "facts": facts}
