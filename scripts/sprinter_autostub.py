"""
Append missing part rows to data/sprinter/parts.auto.csv based on folder names / filenames.

Does not fetch OEM data from the internet. You (or your phone sync) must still place photos.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

from sprinter_defaults import EXPECTED_CSV_FIELDS, FLAT_NAME, IMAGE_SUFFIXES, norm_oe, read_default_platform, repo_root, sprinter_dir


def _has_image(folder: Path) -> bool:
    for p in folder.rglob("*"):
        if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES:
            return True
    return False


def _collect_oes_from_incoming(incoming: Path) -> set[str]:
    found: set[str] = set()
    if not incoming.is_dir():
        return found
    for child in incoming.iterdir():
        if child.is_dir():
            oe = norm_oe(child.name)
            if oe and not oe.startswith("REPLACE") and _has_image(child):
                found.add(oe)
        elif child.is_file() and child.suffix.lower() in IMAGE_SUFFIXES:
            m = FLAT_NAME.match(child.name)
            if m:
                oe = norm_oe(m.group(1))
                if oe and not oe.startswith("REPLACE"):
                    found.add(oe)
    return found


def _load_known_oes(csv_paths: list[Path]) -> set[tuple[str, str]]:
    known: set[tuple[str, str]] = set()
    for path in csv_paths:
        if not path.is_file():
            continue
        with path.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                plat = (row.get("platform_code") or "").strip()
                raw = row.get("oe_part_number_normalized") or ""
                if "REPLACE" in raw.upper():
                    continue
                oe = norm_oe(raw)
                if plat and oe:
                    known.add((plat, oe))
    return known


def autostub(*, root: Path | None = None, dry_run: bool = False) -> dict:
    root = root or repo_root()
    d = sprinter_dir(root)
    incoming = d / "incoming"
    template = d / "seed-parts.template.csv"
    auto_path = d / "parts.auto.csv"
    platform = read_default_platform(root)

    needed = _collect_oes_from_incoming(incoming)
    known = _load_known_oes([template, auto_path])

    to_add: list[tuple[str, str]] = []
    for oe in sorted(needed):
        if (platform, oe) not in known:
            to_add.append((platform, oe))

    if not to_add:
        return {"added": 0, "platform": platform, "auto_path": str(auto_path)}

    if dry_run:
        return {"added": len(to_add), "would_add": [oe for _, oe in to_add], "platform": platform}

    auto_path.parent.mkdir(parents=True, exist_ok=True)
    write_header = not auto_path.is_file() or auto_path.stat().st_size == 0
    with auto_path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=EXPECTED_CSV_FIELDS)
        if write_header:
            writer.writeheader()
        for plat, oe in to_add:
            writer.writerow(
                {
                    "platform_code": plat,
                    "oe_part_number_normalized": oe,
                    "display_name": f"AUTO_{oe}",
                    "functional_group": "needs_review",
                    "mounting_side": "na",
                    "notes": "autostub: fix name/group when you know it",
                }
            )

    return {"added": len(to_add), "platform": platform, "auto_path": str(auto_path)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Create CSV stubs from incoming/*/ photo folders.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    report = autostub(dry_run=args.dry_run)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    # Allow `py -3 scripts/sprinter_autostub.py` on Windows (add scripts/ to path).
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    raise SystemExit(main())
