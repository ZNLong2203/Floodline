"""The cities Floodline serves, one file each in data/cities/.

A city brings its streets (an OpenStreetMap extract), its residents' language
(for voice transcription and local summaries), its people's heights (the body
landmarks scale with them), and its demo scenario. Nothing else in Floodline is
specific to a place.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from functools import cache
from pathlib import Path

import yaml

from floodline import catalog as catalog_mod
from floodline.config import DATA
from floodline.roads import Roads

CITIES = DATA / "cities"
DEFAULT = "hue"


@dataclass(frozen=True)
class City:
    id: str
    name: str
    country: str
    language: str
    center: tuple[float, float]
    zoom: float
    roads_file: str
    scenario_file: str | None
    story: str = ""
    presets: list[dict] = field(default_factory=list)
    person_height_m: tuple[float, float] | None = None
    sources: list[str] = field(default_factory=list)
    samples: list[str] = field(default_factory=list)  # paths under data/demo

    def public(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "country": self.country,
            "language": self.language,
            "center": list(self.center),
            "zoom": self.zoom,
            "story": self.story,
            "presets": self.presets,
            "has_scenario": self.scenario_file is not None,
            "samples": len(self.samples),
        }

    @property
    def scenario_path(self) -> Path | None:
        return DATA / self.scenario_file if self.scenario_file else None


def _load(path: Path) -> City:
    raw = yaml.safe_load(path.read_text())
    height = raw.get("person_height_m")
    return City(
        id=raw["id"],
        name=raw["name"],
        country=raw["country"],
        language=raw["language"],
        center=tuple(raw["center"]),
        zoom=raw.get("zoom", 14),
        roads_file=raw["roads"],
        scenario_file=raw.get("scenario"),
        story=raw.get("story", "").strip(),
        presets=raw.get("presets", []),
        person_height_m=tuple(height) if height else None,
        sources=raw.get("sources", []),
        samples=raw.get("samples", []),
    )


@cache
def all_cities() -> dict[str, City]:
    return {c.id: c for c in map(_load, sorted(CITIES.glob("*.yaml")))}


def get(city_id: str | None) -> City:
    cities = all_cities()
    return cities.get(city_id or DEFAULT) or cities[DEFAULT]


@cache
def roads(city_id: str) -> Roads:
    return Roads.load(DATA / get(city_id).roads_file)


@cache
def catalog(city_id: str) -> catalog_mod.Catalog:
    """The base catalog, with people's heights and body landmarks scaled to the city."""
    base = catalog_mod.default()
    city = get(city_id)
    person = base.objects.get("person")
    if city.person_height_m is None or person is None:
        return base
    k = sum(city.person_height_m) / sum(person.height_m)
    scaled = replace(
        person,
        height_m=city.person_height_m,
        landmarks_m={n: (lo * k, hi * k) for n, (lo, hi) in person.landmarks_m.items()},
        sources=person.sources + tuple(city.sources),
    )
    return replace(base, objects={**base.objects, "person": scaled})
