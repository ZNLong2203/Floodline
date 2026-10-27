"""Compile data/catalog.yaml from the sourced data/references.yaml and data/thresholds.yaml.

    uv run python scripts/build_catalog.py

Every range keeps the source ids it came from. A few landmarks the sources do not
publish (a car's door handle, a scooter's footboard) are kept as conservative
estimates and marked `unverified` with the reason, so the console can say so.
"""

from pathlib import Path

import yaml

DATA = Path(__file__).resolve().parent.parent / "data"


def rng(d: dict | None, lo: str = "low", hi: str = "high") -> list[float] | None:
    if not d or d.get(lo) is None or d.get(hi) is None:
        return None
    return [round(float(d[lo]), 3), round(float(d[hi]), 3)]


def main() -> None:
    refs = yaml.safe_load((DATA / "references.yaml").read_text())
    thr = yaml.safe_load((DATA / "thresholds.yaml").read_text())
    objs = {o["id"]: o for o in refs["objects"]}

    def scale(oid: str, dim: str) -> list[float] | None:
        for s in objs[oid].get("scale_dimensions") or []:
            if s["id"] == dim:
                return rng(s, "low_m", "high_m")
        return None

    def landmark(oid: str, lid: str) -> list[float] | None:
        for lm in objs[oid].get("landmarks") or []:
            if lm["id"] == lid:
                return rng(lm.get("height_m"))
        return None

    def srcs(oid: str) -> list[str]:
        ids: list[str] = []
        o = objs[oid]
        for part in [o, *(o.get("scale_dimensions") or []), *(o.get("landmarks") or [])]:
            for s in part.get("source_ids") or []:
                if s not in ids:
                    ids.append(s)
        return ids

    moto, car, person = "motorbike_generic_vn", "car_generic_vn", "person_adult_vietnamese"
    hub_f, hub_r = landmark(moto, "wheel_hub_front"), landmark(moto, "wheel_hub_rear")
    moto_hub = [min(hub_f[0], hub_r[0]), max(hub_f[1], hub_r[1])]
    moto_h = rng(objs[moto]["height_total_m"])
    moto_seat = landmark(moto, "seat_top")
    car_h = rng(objs[car]["height_total_m"])
    car_hub = landmark(car, "wheel_hub")
    person_h = rng(objs[person]["height_total_m"])
    knee, hip = landmark(person, "knee"), landmark(person, "hip")
    door = "door_swing_shophouse"
    bike = "bicycle_26in_700c"
    bike_hub = landmark(bike, "wheel_hub")

    objects = {
        "scooter": {
            "name_en": "scooter",
            "name_vi": "xe máy",
            "sam_prompt": objs[moto]["sam_prompt"],
            "height_m": moto_h,
            "length_m": scale(moto, "overall_length"),
            "width_m": scale(moto, "overall_width"),
            "landmarks_m": {
                "below_wheel_hub": [0.03, moto_hub[0]],
                "wheel_hub": moto_hub,
                "footboard": [0.30, 0.45],
                "seat": moto_seat,
                "above_seat": [moto_seat[1], moto_h[1]],
            },
            "unverified": {"footboard": "no maker publishes footboard height; typical range"},
            "sources": srcs(moto),
        },
        "car": {
            "name_en": "car",
            "name_vi": "ô tô",
            "sam_prompt": objs[car]["sam_prompt"],
            "height_m": car_h,
            "length_m": scale(car, "overall_length"),
            "width_m": scale(car, "overall_width"),
            "landmarks_m": {
                "below_wheel_hub": [0.03, car_hub[0]],
                "wheel_hub": car_hub,
                "sill": [0.30, 0.50],
                "door_handle": [0.85, 1.05],
                "bonnet": [0.85, 1.10],
                "roof": car_h,
            },
            "unverified": {
                "sill": "not in spec sheets; above ground clearance (0.13-0.24 m)",
                "door_handle": "not in spec sheets",
                "bonnet": "not in spec sheets",
            },
            "sources": srcs(car),
        },
        "person": {
            "name_en": "adult",
            "name_vi": "người lớn",
            "sam_prompt": objs[person]["sam_prompt"],
            "height_m": person_h,
            "landmarks_m": {
                "ankle": [0.03, 0.12],
                "knee": knee,
                "thigh": [knee[1], hip[0]],
                "waist": [hip[0], 1.0],
                "chest": landmark(person, "chest"),
                "shoulder": landmark(person, "shoulder"),
            },
            "unverified": {
                "ankle": "ground to lower calf",
                "waist": "hip line up to about 0.6 H; residents say 'waist' for both",
            },
            "sources": srcs(person),
        },
        "door": {
            "name_en": "door",
            "name_vi": "cửa",
            "sam_prompt": objs[door]["sam_prompt"],
            "height_m": rng(objs[door]["height_total_m"]),
            "landmarks_m": {"door_handle": [0.90, 1.10]},
            "unverified": {"door_handle": "not in a standard"},
            "sources": srcs(door),
        },
        "bicycle": {
            "name_en": "bicycle",
            "name_vi": "xe đạp",
            "sam_prompt": objs[bike]["sam_prompt"],
            "height_m": [0.95, 1.10],
            "length_m": [1.60, 1.80],
            "landmarks_m": {
                "below_wheel_hub": [0.03, bike_hub[0]],
                "wheel_hub": bike_hub,
                "seat": [0.80, 1.00],
            },
            "unverified": {
                "height_m": "frame sizes vary; typical adult bicycle",
                "length_m": "typical adult bicycle",
                "seat": "saddle height varies with rider",
            },
            "sources": srcs(bike),
        },
        "bus": {
            "name_en": "bus",
            "name_vi": "xe buýt",
            "sam_prompt": "bus",
            "height_m": [2.90, 3.30],
            "width_m": [2.30, 2.50],
            "landmarks_m": {
                "wheel_hub": [0.45, 0.55],
                "door_step": [0.30, 0.45],
                "window_bottom": [1.10, 1.40],
            },
            "unverified": {"all": "not researched; typical city bus"},
            "sources": [],
        },
        "truck": {
            "name_en": "truck",
            "name_vi": "xe tải",
            "sam_prompt": "truck",
            "height_m": [2.20, 3.20],
            "width_m": [1.80, 2.50],
            "landmarks_m": {"wheel_hub": [0.40, 0.55]},
            "unverified": {"all": "not researched; light to medium truck"},
            "sources": [],
        },
    }

    classes = {c["id"]: c for c in thr["classes"]}
    names = {
        "pedestrian_adult": ("pedestrian", "On foot", "Đi bộ"),
        "scooter": ("scooter", "Scooter", "Xe máy"),
        "sedan_car": ("car", "Car", "Ô tô con"),
        "suv_pickup": ("suv", "SUV / pickup", "Xe gầm cao"),
        "truck_rescue": ("truck", "Rescue truck", "Xe tải cứu hộ"),
    }
    vehicles = []
    for cid, (vid, en, vi) in names.items():
        c = classes[cid]
        vehicles.append(
            {
                "id": vid,
                "name_en": en,
                "name_vi": vi,
                "max_depth_m": c["max_depth_m"],
                "max_depth_flowing_m": c.get("max_depth_flowing_m"),
                "sources": c.get("source_ids", []),
            }
        )

    used = {s for o in objects.values() for s in o["sources"]} | {
        s for v in vehicles for s in v["sources"]
    }
    sources = {}
    for src in [*refs["sources"], *thr["sources"]]:
        if src["id"] in used and src["id"] not in sources:
            sources[src["id"]] = {k: src[k] for k in ("title", "url") if k in src}

    header = (
        "# Generated by scripts/build_catalog.py from data/references.yaml and "
        "data/thresholds.yaml. Do not edit by hand.\n"
    )
    body = yaml.safe_dump(
        {"sources": sources, "objects": objects, "vehicles": vehicles},
        allow_unicode=True,
        sort_keys=False,
        width=100,
    )
    (DATA / "catalog.yaml").write_text(header + body)
    print(f"{len(objects)} objects, {len(vehicles)} vehicles, {len(sources)} sources")


if __name__ == "__main__":
    main()
