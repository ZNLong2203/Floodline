"""The street network: snap reports to street segments and route around water.

Built from OpenStreetMap ways (scripts/build_roads.py) into a networkx graph. Every edge is
one segment between two consecutive way nodes, so a report changes the street it
was taken on, not the whole road.
"""

from __future__ import annotations

import itertools
import json
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import networkx as nx
import numpy as np

from floodline.config import DATA

EARTH_M = 6_371_000.0

# Default speeds, km/h, by OSM highway class; used only to rank routes.
SPEEDS = {
    "trunk": 50, "primary": 45, "secondary": 40, "tertiary": 35, "unclassified": 25,
    "residential": 20, "living_street": 10, "service": 10,
}


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_M * math.asin(math.sqrt(a))


@dataclass(frozen=True)
class Segment:
    id: str  # "u-v" with u < v
    u: int
    v: int
    name: str
    highway: str
    length_m: float
    coords: tuple[tuple[float, float], tuple[float, float]]  # (lon, lat) pairs


class Roads:
    def __init__(self, nodes: dict[int, tuple[float, float]], ways: list[dict]) -> None:
        self.nodes = nodes
        self.graph = nx.Graph()
        self.segments: dict[str, Segment] = {}
        for way in ways:
            ids = [n for n in way["nodes"] if n in nodes]
            for a, b in itertools.pairwise(ids):
                if a == b:
                    continue
                u, v = sorted((a, b))
                (la, oa), (lb, ob) = nodes[u], nodes[v]
                seg = Segment(
                    id=f"{u}-{v}",
                    u=u,
                    v=v,
                    name=way.get("name", ""),
                    highway=way.get("highway", "unclassified"),
                    length_m=haversine_m(la, oa, lb, ob),
                    coords=((oa, la), (ob, lb)),
                )
                self.segments[seg.id] = seg
                self.graph.add_edge(u, v, segment=seg.id, length=seg.length_m)
        ids = list(self.segments)
        self._seg_ids = ids
        mids = np.array(
            [[(s.coords[0][1] + s.coords[1][1]) / 2, (s.coords[0][0] + s.coords[1][0]) / 2]
             for s in (self.segments[i] for i in ids)]
        )
        self._mid = mids
        self._a = np.array([[self.segments[i].coords[0][1], self.segments[i].coords[0][0]]
                            for i in ids])
        self._b = np.array([[self.segments[i].coords[1][1], self.segments[i].coords[1][0]]
                            for i in ids])
        node_ids = list(self.graph.nodes)
        self._node_ids = node_ids
        self._node_xy = np.array([nodes[n] for n in node_ids])

    @classmethod
    def load(cls, path: Path | None = None) -> Roads:
        raw = json.loads((path or DATA / "hue_roads.json").read_text())
        nodes = {int(k): (v[0], v[1]) for k, v in raw["nodes"].items()}
        return cls(nodes, raw["ways"])

    # -- geometry ---------------------------------------------------------------

    def _local_xy(self, lat: float, lon: float, pts: np.ndarray) -> np.ndarray:
        """Equirectangular metres around (lat, lon); fine at street scale."""
        k = math.cos(math.radians(lat))
        return np.stack(
            [(pts[:, 1] - lon) * k * EARTH_M * math.pi / 180,
             (pts[:, 0] - lat) * EARTH_M * math.pi / 180],
            axis=1,
        )

    def nearby_segments(self, lat: float, lon: float, radius_m: float) -> list[tuple[str, float]]:
        """Segments within `radius_m` of a point, with their distance in metres."""
        a = self._local_xy(lat, lon, self._a)
        b = self._local_xy(lat, lon, self._b)
        ab = b - a
        denom = np.maximum((ab**2).sum(axis=1), 1e-9)
        t = np.clip((-(a * ab).sum(axis=1)) / denom, 0, 1)
        closest = a + ab * t[:, None]
        dist = np.sqrt((closest**2).sum(axis=1))
        idx = np.flatnonzero(dist <= radius_m)
        return sorted(((self._seg_ids[i], float(dist[i])) for i in idx), key=lambda x: x[1])

    def nearest_node(self, lat: float, lon: float) -> int:
        d = self._local_xy(lat, lon, self._node_xy)
        return self._node_ids[int(np.argmin((d**2).sum(axis=1)))]

    # -- routing ----------------------------------------------------------------

    def route(
        self,
        start: tuple[float, float],
        end: tuple[float, float],
        *,
        blocked: set[str] = frozenset(),
        risky: set[str] = frozenset(),
        risky_penalty: float = 6.0,
    ) -> dict | None:
        """Fastest route that avoids `blocked` segments and avoids `risky` ones when it can."""
        s, t = self.nearest_node(*start), self.nearest_node(*end)

        def weight(u: int, v: int, data: dict) -> float | None:
            seg_id = data["segment"]
            if seg_id in blocked:
                return None
            seg = self.segments[seg_id]
            seconds = seg.length_m / (SPEEDS.get(seg.highway, 20) / 3.6)
            return seconds * (risky_penalty if seg_id in risky else 1.0)

        try:
            path = nx.shortest_path(self.graph, s, t, weight=weight)
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return None
        seg_ids = [self.graph.edges[u, v]["segment"] for u, v in itertools.pairwise(path)]
        return {
            "coordinates": [[self.nodes[n][1], self.nodes[n][0]] for n in path],
            "segments": seg_ids,
            "length_m": round(sum(self.segments[i].length_m for i in seg_ids), 1),
            "risky_segments": [i for i in seg_ids if i in risky],
        }

    def geojson(self, segment_ids: list[str], properties: dict[str, dict]) -> dict:
        return {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "id": sid,
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [list(c) for c in self.segments[sid].coords],
                    },
                    "properties": {"id": sid, "name": self.segments[sid].name,
                                   **properties.get(sid, {})},
                }
                for sid in segment_ids
            ],
        }


@lru_cache
def default() -> Roads:
    return Roads.load()

