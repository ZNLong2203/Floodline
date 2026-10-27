"""Measure Floodline against photos with known depth.

    uv run python -m evals.run data/datasets/eval_manifest.jsonl --limit 100

Each manifest line: {"path", "approx_depth_m_low", "approx_depth_m_high", ...}.
Every model call goes through cassettes (FLOODLINE_MODEL_MODE=record), so the
ablations below re-use the same Spark and SAM answers and cost nothing extra:

    spark-only     Spark's own depth range for the whole photo
    +landmarks     plus the depth implied by where the water reaches each object
    +geometry      plus the waterline measured on the SAM masks (the full pipeline)

Reports: depth MAE, how often the interval contains the truth, band accuracy, and
calibration of P(depth > limit) for each vehicle limit.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from floodline import catalog as catalog_mod
from floodline.config import ROOT
from floodline.meta.client import ModelClient
from floodline.pipeline import analyse

VARIANTS = {
    "spark-only": frozenset({"holistic"}),
    "+landmarks": frozenset({"holistic", "landmark", "fraction"}),
    "+geometry": frozenset({"holistic", "landmark", "fraction", "scale"}),
}
BANDS = [0.0, 0.15, 0.3, 0.6, 1.0, 9.0]


def band(depth: float) -> int:
    for i in range(len(BANDS) - 1):
        if BANDS[i] <= depth < BANDS[i + 1]:
            return i
    return len(BANDS) - 2


@dataclass
class Row:
    path: str
    truth_low: float
    truth_high: float
    variant: str
    mean: float | None
    low: float | None
    high: float | None
    p_exceed: dict[str, float]
    error: str | None = None

    @property
    def truth(self) -> float:
        return (self.truth_low + self.truth_high) / 2


def run_one(client: ModelClient, item: dict, root: Path) -> list[Row]:
    path = Path(item["path"])
    data = (path if path.is_absolute() else (root / path)).read_bytes()
    rows = []
    for name, estimators in VARIANTS.items():
        try:
            res = analyse(client, data, estimators=estimators, flowing=False)
            est = res.estimate
            rows.append(
                Row(
                    item["path"],
                    item["approx_depth_m_low"],
                    item["approx_depth_m_high"],
                    name,
                    est.mean_m if est else None,
                    est.low_m if est else None,
                    est.high_m if est else None,
                    {v.vehicle.id: v.p_exceed for v in res.verdicts},
                )
            )
        except Exception as e:  # keep going; a failed photo is reported, not fatal
            rows.append(
                Row(
                    item["path"],
                    item["approx_depth_m_low"],
                    item["approx_depth_m_high"],
                    name,
                    None,
                    None,
                    None,
                    {},
                    error=f"{type(e).__name__}: {e}",
                )
            )
    return rows


def summarise(rows: list[Row], vehicles) -> dict:
    out = {}
    for name in VARIANTS:
        rs = [r for r in rows if r.variant == name]
        answered = [r for r in rs if r.mean is not None]
        abs_err = [abs(r.mean - r.truth) for r in answered]
        covered = [r for r in answered if r.low <= r.truth_high and r.high >= r.truth_low]
        band_hits = [r for r in answered if band(r.mean) == band(r.truth)]
        within_one = [r for r in answered if abs(band(r.mean) - band(r.truth)) <= 1]
        calib = {}
        for v in vehicles:
            pairs = [
                (r.p_exceed[v.id], 1.0 if r.truth > v.max_depth_m else 0.0)
                for r in answered
                if v.id in r.p_exceed and not (r.truth_low <= v.max_depth_m <= r.truth_high)
            ]
            if not pairs:
                continue
            bins = []
            for lo in (0.0, 0.1, 0.3, 0.5, 0.7, 0.9):
                hi = {0.0: 0.1, 0.1: 0.3, 0.3: 0.5, 0.5: 0.7, 0.7: 0.9, 0.9: 1.01}[lo]
                b = [(p, y) for p, y in pairs if lo <= p < hi]
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
            brier = sum((p - y) ** 2 for p, y in pairs) / len(pairs)
            # the decision that matters: we said passable (p<0.1) but it was over the limit
            unsafe = [1 for p, y in pairs if p < 0.10 and y == 1.0]
            calib[v.id] = {
                "n": len(pairs),
                "brier": round(brier, 4),
                "unsafe_passable": len(unsafe),
                "bins": bins,
            }
        out[name] = {
            "photos": len(rs),
            "answered": len(answered),
            "errors": sum(1 for r in rs if r.error),
            "mae_m": round(sum(abs_err) / len(abs_err), 3) if abs_err else None,
            "median_abs_err_m": round(sorted(abs_err)[len(abs_err) // 2], 3) if abs_err else None,
            "interval_coverage": round(len(covered) / len(answered), 3) if answered else None,
            "mean_interval_m": round(sum(r.high - r.low for r in answered) / len(answered), 3)
            if answered
            else None,
            "band_accuracy": round(len(band_hits) / len(answered), 3) if answered else None,
            "band_within_one": round(len(within_one) / len(answered), 3) if answered else None,
            "calibration": calib,
        }
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--out", default="evals/runs")
    args = ap.parse_args()

    manifest = Path(args.manifest)
    items = [json.loads(line) for line in manifest.read_text().splitlines() if line.strip()]
    if args.limit:
        items = items[: args.limit]
    root = ROOT  # manifest paths are relative to the repository

    client = ModelClient()
    vehicles = catalog_mod.default().vehicles
    started = time.time()
    rows: list[Row] = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for i, result in enumerate(pool.map(lambda it: run_one(client, it, root), items), 1):
            rows.extend(result)
            if i % 10 == 0:
                print(f"{i}/{len(items)}", flush=True)

    summary = summarise(rows, vehicles)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    out = ROOT / args.out / stamp
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
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2))

    print(json.dumps(meta))
    header = f"{'variant':<12} {'MAE m':>7} {'cover':>6} {'width':>6} {'band':>6} {'±1':>6}"
    print(header)
    for name, m in summary.items():

        def f(x):
            return "-" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x:.3f}"

        print(
            f"{name:<12} {f(m['mae_m']):>7} {f(m['interval_coverage']):>6} "
            f"{f(m['mean_interval_m']):>6} {f(m['band_accuracy']):>6} {f(m['band_within_one']):>6}"
        )
    print(f"-> {out}")


if __name__ == "__main__":
    main()
