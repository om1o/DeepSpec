"""
Run the local Sprinter pipeline on an interval:

  1) Optional NHTSA VIN decode (data/sprinter/vin.txt)
  2) Auto-generate CSV stubs from incoming photo folders (parts.auto.csv)
  3) Ingest images into staging/organized + manifest + checkpoint

This replaces manual 'run three commands' loops. It does NOT crawl Mercedes or eBay.
You still need a sync path for photos (USB, cloud folder, phone export, etc.).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from sprinter_autostub import autostub
from sprinter_vin import decode_vin_to_profile


def _run_ingest(py: str, repo: Path) -> tuple[int, str, str]:
    script = repo / "scripts" / "ingest_local_catalog.py"
    proc = subprocess.run([py, str(script)], cwd=str(repo), check=False, capture_output=True, text=True)
    return int(proc.returncode), proc.stdout or "", proc.stderr or ""


def _emit(line: str, log_path: Path | None) -> None:
    print(line, flush=True)
    if log_path is None:
        return
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Watch-style local pipeline (poll loop).")
    parser.add_argument(
        "--interval",
        type=float,
        default=None,
        help="Seconds between cycles (default: 20, or 45 with --tonight).",
    )
    parser.add_argument("--python", default=sys.executable, help="Python executable for ingest.")
    parser.add_argument("--once", action="store_true", help="Run a single cycle then exit.")
    parser.add_argument("--no-vin", action="store_true", help="Skip vPIC decode step.")
    parser.add_argument(
        "--tonight",
        action="store_true",
        help="Overnight-friendly: 45s between cycles + append to a dated log under data/sprinter/logs/.",
    )
    parser.add_argument(
        "--log",
        type=Path,
        default=None,
        help="Append cycle reports and ingest output to this file (optional; implied when --tonight).",
    )
    args = parser.parse_args()

    repo = Path(__file__).resolve().parent.parent
    py = args.python

    if args.interval is not None:
        interval = float(args.interval)
    elif args.tonight:
        interval = 45.0
    else:
        interval = 20.0

    log_path: Path | None = args.log
    if args.tonight and log_path is None:
        log_path = repo / "data" / "sprinter" / "logs" / f"watch_{time.strftime('%Y%m%d')}.log"

    started = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    if log_path is not None:
        log_path = log_path.resolve()
        _emit(
            f"=== sprinter_watch start {started} interval={interval}s repo={repo} ===",
            log_path,
        )

    cycle = 0
    while True:
        cycle += 1
        report: dict = {"cycle": cycle}
        if not args.no_vin:
            report["vin"] = decode_vin_to_profile(root=repo)
        report["autostub"] = autostub(root=repo)
        rc, out, err = _run_ingest(py, repo)
        report["ingest_exit_code"] = rc
        if out.strip():
            report["ingest_stdout"] = out.strip()
        if err.strip():
            report["ingest_stderr"] = err.strip()
        block = json.dumps(report, indent=2)
        _emit(block, log_path)
        if args.once:
            return 0 if rc == 0 else rc
        time.sleep(max(1.0, interval))


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    raise SystemExit(main())
