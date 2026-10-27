"""Measure Floodline against photos with known depth.

    uv run python -m evals.run data/datasets/eval_manifest.jsonl --limit 100

Each manifest line names a photo, one labelled reference object in it (its box)
and the depth of water at that object. The pipeline runs once per photo (through
cassettes, so re-runs are free); every estimator is then scored from the same run:

    object level   the reference object Floodline matched to the labelled one
        landmark   depth implied by the part of the object the water reaches
        fraction   Spark's share of the object under water x its known height
        geometry   waterline measured on the SAM masks, scaled by known size
        consensus  all of the above for that object, outliers rejected
    photo level
        spark-only Spark's own depth range for the photo
        floodline  the full pipeline's photo estimate

Reports MAE, interval coverage, band accuracy, and calibration of
P(depth > limit) for each vehicle limit, including the count of "passable" calls
that were in fact over the limit.
"""

from __future__ import annotations

import argparse
import itertools
import json
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from floodline import catalog as catalog_mod
from floodline.config import ROOT
from floodline.estimate import combine
from floodline.meta.client import ModelClient
from floodline.passability import assess
from floodline.pipeline import analyse

BANDS = [0.0, 0.15, 0.3, 0.6, 1.0, 9.0]
OBJECT_VARIANTS = {
    "landmark": ("landmark:",),
    "fraction": ("fraction:",),
    "geometry": ("scale:",),
    "consensus": ("landmark:", "fraction:", "scale:"),
}
MATCH_IOU = 0.3


def band(depth: float) -> int:
    for i in range(len(BANDS) - 1):
        if BANDS[i] <= depth < BANDS[i + 1]:
            return i
    return len(BANDS) - 2


def iou(a, b) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


@dataclass
class Row:
    path: str
    object_class: str
    truth_low: float
    truth_high: float
    matched: bool = False
    results: dict[str, dict | None] = field(default_factory=dict)
    error: str | None = None

    @property
    def truth(self) -> float:
        return (self.truth_low + self.truth_high) / 2


def _result(est, vehicles) -> dict | None:
    if est is None:
        return None
    return {
        "mean": est.mean_m,
        "low": est.low_m,
        "high": est.high_m,
        "p": {v.vehicle.id: v.p_exceed for v in assess(est, vehicles)},
    }


def run_one(client: ModelClient, item: dict, vehicles) -> Row:
    row = Row(
        item["path"], item["object_class"], item["approx_depth_m_low"], item["approx_depth_m_high"]
    )
    path = Path(item["path"])
    try:
        data = (path if path.is_absolute() else ROOT / path).read_bytes()
        res = analyse(client, data, flowing=False)
    except Exception as e:  # a failed photo is reported, not fatal
        row.error = f"{type(e).__name__}: {e}"
        return row

    # the labelled box, in the analysed image's pixels
    sx = res.size[0] / item["image_width"]
    sy = res.size[1] / item["image_height"]
    x, y, w, h = item["target_bbox_xywh"]
    target = (x * sx, y * sy, (x + w) * sx, (y + h) * sy)
    best = max(res.objects, key=lambda o: iou(o.box_px, target), default=None)
    if best is not None and iou(best.box_px, target) >= MATCH_IOU:
        row.matched = True
        for name, prefixes in OBJECT_VARIANTS.items():
            readings = [r for r in best.readings if r.source.startswith(prefixes)]
            row.results[f"object:{name}"] = _result(combine(readings), vehicles)

    used = res.estimate.used if res.estimate else []
    holistic = [r for r in used if r.source == "spark:holistic"]
    row.results["photo:spark-only"] = _result(combine(holistic), vehicles)
    row.results["photo:floodline"] = _result(res.estimate, vehicles)
    return row


def _calibration(answered, vehicles) -> dict:
    calib = {}
    edges = [0.0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.01]
    for v in vehicles:
        # skip photos whose labelled range straddles the limit: their truth is undecided
        ps = [
            (x["p"][v.id], 1.0 if r.truth > v.max_depth_m else 0.0)
            for r, x in answered
            if not (r.truth_low < v.max_depth_m < r.truth_high)
        ]
        if not ps:
            continue
        bins = []
        for lo, hi in itertools.pairwise(edges):
            b = [(p, y) for p, y in ps if lo <= p < hi]
            if b:
                bins.append(
                    {
                        "p_from": lo,
                        "p_to": min(hi, 1.0),
                        "n": len(b),
                        "mean_p": round(sum(p for p, _ in b) / len(b), 3),
                        "observed": round(sum(y for _, y in b) / len(b), 3),
                    }
                )
        calib[v.id] = {
            "n": len(ps),
            "brier": round(sum((p - y) ** 2 for p, y in ps) / len(ps), 4),
            "said_passable": sum(1 for p, _ in ps if p < 0.10),
            "unsafe_passable": sum(1 for p, y in ps if p < 0.10 and y == 1.0),
            "bins": bins,
        }
    return calib


def summarise(rows: list[Row], vehicles) -> dict:
    variants = [f"object:{n}" for n in OBJECT_VARIANTS] + ["photo:spark-only", "photo:floodline"]
    out: dict = {}
    for name in variants:
        pairs = [(r, r.results.get(name)) for r in rows if not r.error]
        answered = [(r, x) for r, x in pairs if x is not None]
        n = len(answered)
        if not n:
            out[name] = {"answered": 0}
            continue
        abs_err = sorted(abs(x["mean"] - r.truth) for r, x in answered)
        covered = sum(
            1 for r, x in answered if x["low"] <= r.truth_high and x["high"] >= r.truth_low
        )
        hits = sum(1 for r, x in answered if band(x["mean"]) == band(r.truth))
        near = sum(1 for r, x in answered if abs(band(x["mean"]) - band(r.truth)) <= 1)
        out[name] = {
            "answered": n,
            "of": len(pairs),
            "mae_m": round(sum(abs_err) / n, 3),
            "median_abs_err_m": round(abs_err[n // 2], 3),
            "interval_coverage": round(covered / n, 3),
            "mean_interval_m": round(sum(x["high"] - x["low"] for _, x in answered) / n, 3),
            "band_accuracy": round(hits / n, 3),
            "band_within_one": round(near / n, 3),
            "calibration": _calibration(answered, vehicles),
        }
    out["_counts"] = {
        "photos": len(rows),
        "errors": sum(1 for r in rows if r.error),
        "matched_objects": sum(1 for r in rows if r.matched),
    }
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--flooded-only", action="store_true", help="skip photos with no flood region")
    ap.add_argument("--out", default="evals/runs")
    args = ap.parse_args()

    manifest = Path(args.manifest)
    items = [json.loads(line) for line in manifest.read_text().splitlines() if line.strip()]
    if args.flooded_only:
        items = [i for i in items if i.get("image_has_flood_region", True)]
    if args.limit:
        items = items[: args.limit]

    client = ModelClient()
    vehicles = catalog_mod.default().vehicles
    started = time.time()
    rows: list[Row] = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for i, row in enumerate(pool.map(lambda it: run_one(client, it, vehicles), items), 1):
            rows.append(row)
            if i % 10 == 0:
                print(f"{i}/{len(items)}", flush=True)

    summary = summarise(rows, vehicles)
    out = ROOT / args.out / time.strftime("%Y%m%d-%H%M%S")
    out.mkdir(parents=True, exist_ok=True)
    (out / "rows.jsonl").write_text(
        "\n".join(json.dumps(r.__dict__, ensure_ascii=False) for r in rows)
    )
    (out / "summary.json").write_text(json.dumps(summary, indent=2))
    s = client.stats
    meta = {
        "manifest": str(manifest),
        "photos": len(items),
        "seconds": round(time.time() - started, 1),
        "api_calls": s.calls,
        "replayed": s.replayed,
        "tokens_in": s.input_tokens,
        "tokens_out": s.output_tokens,
        "sam_requests": s.sam_images,
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2))

    print(json.dumps(meta))
    print(json.dumps(summary["_counts"]))
    print(f"{'variant':<20} {'n':>4} {'MAE m':>6} {'cover':>6} {'width':>6} {'band':>6} {'±1':>6}")
    for name, m in summary.items():
        if name.startswith("_") or not m.get("answered"):
            continue
        print(
            f"{name:<20} {m['answered']:>4} {m['mae_m']:>6.3f} {m['interval_coverage']:>6.3f} "
            f"{m['mean_interval_m']:>6.3f} {m['band_accuracy']:>6.3f} {m['band_within_one']:>6.3f}"
        )
    print(f"-> {out}")


if __name__ == "__main__":
    main()
