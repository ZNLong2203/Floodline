"""Fit the reading calibration by cross-validation and report out-of-fold results.

    uv run python -m evals.calibrate evals/runs/<run>/rows.jsonl

Uses the raw readings an eval run stored, so no model is called. Photos are split
into 5 folds by path; each fold is scored with a calibration fitted on the other
four, so every number in the report is on photos the calibration never saw.
The final calibration, fitted on all photos, is written to data/calibration.json.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path
from statistics import median

from floodline import catalog as catalog_mod
from floodline.calibration import IDENTITY, KINDS, PATH, Calibration, KindCalibration, kind_of
from floodline.config import ROOT
from floodline.estimate import Reading, combine
from floodline.passability import assess

FOLDS = 5
COVER = 0.90  # target share of truths inside mean +- 2 sigma


def reading(d: dict) -> Reading:
    return Reading(d["source"], d["low_m"], d["high_m"], d.get("note", ""), mu=d.get("mean_m"))


def truth(row: dict) -> float:
    return (row["truth_low"] + row["truth_high"]) / 2


def quantile(xs: list[float], q: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))]


def samples(rows: list[dict], kind: str) -> list[tuple[Reading, float]]:
    out = []
    for row in rows:
        source = row["photo_readings"] if kind == "spark" else row["object_readings"]
        out += [(reading(d), truth(row)) for d in source if kind_of(d["source"]) == kind]
    return out


def fit(rows: list[dict]) -> Calibration:
    kinds = {}
    for kind in KINDS:
        pairs = samples(rows, kind)
        if len(pairs) < 15:
            continue
        bias = median(r.mean - t for r, t in pairs)
        z = [abs(r.mean - bias - t) / (2 * r.sigma) for r, t in pairs]
        kinds[kind] = KindCalibration(
            bias_m=round(bias, 4), sigma_scale=round(max(0.5, quantile(z, COVER)), 4)
        )
    partial = Calibration(kinds=kinds)
    z = []
    for row in rows:
        est = combine(partial.apply([reading(d) for d in row["photo_readings"]]))
        if est is not None:
            z.append(abs(est.mean_m - truth(row)) / (2 * est.sigma_m))
    factor = max(1.0, quantile(z, COVER)) if z else 1.0
    return Calibration(kinds=kinds, combine_factor=round(factor, 4))


def estimate(row: dict, cal: Calibration):
    return combine(
        cal.apply([reading(d) for d in row["photo_readings"]]), sigma_factor=cal.combine_factor
    )


def score(pairs: list[tuple[dict, object]], vehicles) -> dict:
    answered = [(row, est) for row, est in pairs if est is not None]
    n = len(answered)
    err = [abs(e.mean_m - truth(r)) for r, e in answered]
    covered = sum(
        1 for r, e in answered if e.low_m <= r["truth_high"] and e.high_m >= r["truth_low"]
    )
    decisions = {}
    for v in vehicles:
        counts = {
            "unsafe_passable": 0,
            "passable": 0,
            "risky": 0,
            "impassable": 0,
            "needless_impassable": 0,
            "decided_right": 0,
            "decided": 0,
            "n": 0,
        }
        for r, e in answered:
            if r["truth_low"] < v.max_depth_m < r["truth_high"]:
                continue  # the label straddles the limit; no right answer
            over = truth(r) > v.max_depth_m
            status = next(x.status for x in assess(e, [v]))
            counts["n"] += 1
            counts[status] += 1
            if status == "passable" and over:
                counts["unsafe_passable"] += 1
            if status == "impassable" and not over:
                counts["needless_impassable"] += 1
            if status != "risky":
                counts["decided"] += 1
                counts["decided_right"] += int((status == "impassable") == over)
        decisions[v.id] = counts
    return {
        "answered": n,
        "mae_m": round(sum(err) / n, 3),
        "interval_coverage": round(covered / n, 3),
        "mean_interval_m": round(sum(e.high_m - e.low_m for _, e in answered) / n, 3),
        "decisions": decisions,
    }


def fold_of(path: str) -> int:
    return int(hashlib.sha256(path.encode()).hexdigest(), 16) % FOLDS


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("rows")
    ap.add_argument("--write", action="store_true", help="write data/calibration.json")
    args = ap.parse_args()

    rows = [json.loads(line) for line in Path(args.rows).read_text().splitlines()]
    rows = [r for r in rows if not r.get("error")]
    vehicles = catalog_mod.default().vehicles

    raw, calibrated, fold_params = [], [], []
    for k in range(FOLDS):
        train = [r for r in rows if fold_of(r["path"]) != k]
        test = [r for r in rows if fold_of(r["path"]) == k]
        cal = fit(train)
        fold_params.append(cal.to_dict())
        raw += [(r, estimate(r, IDENTITY)) for r in test]
        calibrated += [(r, estimate(r, cal)) for r in test]

    report = {
        "rows": args.rows,
        "photos": len(rows),
        "folds": FOLDS,
        "raw": score(raw, vehicles),
        "calibrated_out_of_fold": score(calibrated, vehicles),
        "by_class": {},
        "fold_params": fold_params,
    }
    for cls in sorted({r["object_class"] for r in rows}):
        sub = [(r, e) for r, e in calibrated if r["object_class"] == cls]
        sub_raw = [(r, e) for r, e in raw if r["object_class"] == cls]
        report["by_class"][cls] = {
            "raw_mae_m": score(sub_raw, vehicles)["mae_m"],
            "calibrated_mae_m": score(sub, vehicles)["mae_m"],
            "calibrated_coverage": score(sub, vehicles)["interval_coverage"],
        }

    final = fit(rows)
    final = Calibration(
        kinds=final.kinds,
        combine_factor=final.combine_factor,
        meta={
            "fitted": time.strftime("%Y-%m-%d"),
            "dataset": "FloodDET (CC BY 4.0), 292 flooded photos, DeepFlood level-to-depth table",
            "method": "per-kind median bias and 90% |z| scale; 5-fold out-of-fold scores in "
            "evals/reports/calibration.json",
        },
    )
    report["final"] = final.to_dict()
    out = ROOT / "evals" / "reports"
    out.mkdir(parents=True, exist_ok=True)
    (out / "calibration.json").write_text(json.dumps(report, indent=2))
    if args.write:
        PATH.write_text(json.dumps(final.to_dict(), indent=2))

    for name in ("raw", "calibrated_out_of_fold"):
        s = report[name]
        print(
            f"{name:<24} MAE {s['mae_m']:.3f} m  coverage {s['interval_coverage']:.3f}  "
            f"width {s['mean_interval_m']:.3f} m"
        )
        for vid, d in s["decisions"].items():
            print(
                f"   {vid:<11} n={d['n']:<4} passable={d['passable']:<4} risky={d['risky']:<4} "
                f"impassable={d['impassable']:<4} UNSAFE={d['unsafe_passable']:<3} "
                f"needless={d['needless_impassable']:<3} "
                f"right-when-decided={d['decided_right']}/{d['decided']}"
            )
    print("by class:", json.dumps(report["by_class"]))
    print("final:", json.dumps(final.to_dict()["kinds"]), "combine", final.combine_factor)


if __name__ == "__main__":
    main()
