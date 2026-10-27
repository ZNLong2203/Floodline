"""Command line: `floodline analyse photo.jpg`, `floodline serve`."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _analyse(args: argparse.Namespace) -> int:
    from floodline.meta.client import ModelClient
    from floodline.pipeline import analyse

    client = ModelClient()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    for path in map(Path, args.photos):
        result = analyse(client, path.read_bytes())
        stem = out_dir / path.stem
        stem.with_suffix(".overlay.jpg").write_bytes(result.overlay_jpeg)
        stem.with_suffix(".json").write_text(
            json.dumps(result.to_dict(), ensure_ascii=False, indent=2)
        )
        est = result.estimate
        depth = f"{est.low_m:.2f}-{est.high_m:.2f} m" if est else "no reading"
        verdicts = ", ".join(f"{v.vehicle.id}:{v.status}" for v in result.verdicts)
        print(f"{path.name}: {depth}  {verdicts}  ({result.seconds:.1f}s)")
        for w in result.warnings:
            print(f"  ! {w}")
    s = client.stats
    print(
        f"calls={s.calls} replayed={s.replayed} tokens in/out={s.input_tokens}/{s.output_tokens} "
        f"sam={s.sam_images}",
        file=sys.stderr,
    )
    return 0


def _seed(args: argparse.Namespace) -> int:
    from floodline import scenario
    from floodline.config import settings
    from floodline.meta.client import ModelClient
    from floodline.store import Store

    store = Store(settings().state_dir / "reports")
    if not args.keep:
        store.clear()
    client = ModelClient()
    for r in scenario.seed(store, client):
        est = r.analysis.get("estimate") or {}
        pri = (r.triage or {}).get("priority")
        words = r.note or r.transcript or ""
        depth = f"{est.get('low_m', '-')}-{est.get('high_m', '-')} m"
        print(f"{r.id}  {depth}  priority={pri}  {words[:70]}")
    print(f"calls={client.stats.calls} replayed={client.stats.replayed}", file=sys.stderr)
    return 0


def _serve(args: argparse.Namespace) -> int:
    import uvicorn

    uvicorn.run("floodline.api:app", host=args.host, port=args.port, reload=args.reload)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="floodline")
    sub = parser.add_subparsers(dest="command", required=True)

    a = sub.add_parser("analyse", help="estimate depth and passability for photos")
    a.add_argument("photos", nargs="+")
    a.add_argument("--out", default="var/analyses")
    a.set_defaults(func=_analyse)

    d = sub.add_parser("seed", help="load the Huế demo scenario into the local store")
    d.add_argument("--keep", action="store_true", help="keep existing reports")
    d.set_defaults(func=_seed)

    s = sub.add_parser("serve", help="run the API and the web app")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--reload", action="store_true")
    s.set_defaults(func=_serve)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
