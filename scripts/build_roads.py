"""Build data/hue_roads.json from an OpenStreetMap XML extract.

    curl -A "Floodline" "https://api.openstreetmap.org/api/0.6/map?bbox=107.565,16.450,107.605,16.480" \
        -o data/cache/hue-osm.xml
    uv run python scripts/build_roads.py data/cache/hue-osm.xml
"""

import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

HIGHWAYS = {
    "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
    "living_street", "service", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
}


def main(src: str, dst: str = "data/hue_roads.json") -> None:
    root = ET.parse(src).getroot()
    nodes = {
        int(n.get("id")): [round(float(n.get("lat")), 7), round(float(n.get("lon")), 7)]
        for n in root.iter("node")
    }
    ways = []
    for w in root.iter("way"):
        tags = {t.get("k"): t.get("v") for t in w.iter("tag")}
        if tags.get("highway") not in HIGHWAYS:
            continue
        ways.append({
            "id": int(w.get("id")),
            "name": tags.get("name", ""),
            "highway": tags["highway"],
            "nodes": [int(nd.get("ref")) for nd in w.iter("nd")],
        })
    used = {n for w in ways for n in w["nodes"] if n in nodes}
    Path(dst).write_text(json.dumps({
        "source": "© OpenStreetMap contributors, ODbL 1.0 (api.openstreetmap.org/api/0.6/map)",
        "bbox": [float(root.find("bounds").get(k)) for k in ("minlat", "minlon", "maxlat", "maxlon")],
        "nodes": {str(k): nodes[k] for k in sorted(used)},
        "ways": ways,
    }, ensure_ascii=False, separators=(",", ":")))
    print(f"{len(ways)} ways, {len(used)} nodes -> {dst}")


if __name__ == "__main__":
    main(*sys.argv[1:])
