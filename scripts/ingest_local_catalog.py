"""
Ingest locally captured Sprinter catalog assets (CSV + images).

This does NOT search the web or call third-party catalog APIs. It only
organizes files you already have rights to (e.g. photos you took).

Layout options for --incoming:
  A) Per-OE folders:
       incoming/<OE>/any_name.jpg
  B) Flat files:
       incoming/<OE>_<n>.jpg  (OE is A-Z0-9, at least 6 chars)

Outputs under --out:
  organized/<platform_code>/<OE>/<copy files with stable names>
  manifest.jsonl   (one JSON object per file)
  checkpoint.json  (resume state: sha256 of processed file contents)

Resume: re-run the same command; processed blobs are skipped via checkpoint.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path
from typing import Any, Iterable


EXPECTED_CSV_FIELDS = (
    "platform_code",
    "oe_part_number_normalized",
    "display_name",
    "functional_group",
    "mounting_side",
    "notes",
)

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}


def _norm_oe(raw: str) -> str:
    """Strip spaces/dashes/etc. so A906-xxx-yyy matches CSV normalization."""
    return re.sub(r"[^A-Z0-9]", "", raw.strip().upper()) if raw else ""


def _repo_root(start: Path) -> Path:
    for p in [start, *start.parents]:
        if (p / "package.json").is_file() and (p / "data").is_dir():
            return p
    return start.resolve()


def _sha256_file(path: Path, chunk: int = 1024 * 1024) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def _merged_csv_paths(repo_root: Path, single: Path | None) -> list[Path]:
    if single is not None:
        return [single]
    paths: list[Path] = [repo_root / "data" / "sprinter" / "seed-parts.template.csv"]
    auto = repo_root / "data" / "sprinter" / "parts.auto.csv"
    if auto.is_file():
        paths.append(auto)
    return paths


def _load_merged_parts(paths: list[Path]) -> tuple[dict[str, set[str]], list[dict[str, str]]]:
    merged: dict[str, set[str]] = {}
    all_rows: list[dict[str, str]] = []
    for p in paths:
        if not p.is_file():
            continue
        bp, rows = _load_csv_parts(p)
        all_rows.extend(rows)
        for plat, oes in bp.items():
            merged.setdefault(plat, set()).update(oes)
    return merged, all_rows


def _load_csv_parts(csv_path: Path) -> tuple[dict[str, set[str]], list[dict[str, str]]]:
    """Returns (platform -> set of OE), raw rows for manifest context)."""
    by_platform: dict[str, set[str]] = {}
    rows: list[dict[str, str]] = []
    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        missing = [c for c in EXPECTED_CSV_FIELDS if c not in (reader.fieldnames or [])]
        if missing:
            raise SystemExit(f"CSV missing columns: {missing}. Found: {reader.fieldnames}")
        for row in reader:
            rows.append(row)
            platform = (row.get("platform_code") or "").strip()
            raw_oe = row.get("oe_part_number_normalized") or ""
            oe = _norm_oe(raw_oe)
            if not platform or not oe or "REPLACE" in raw_oe.upper():
                continue
            by_platform.setdefault(platform, set()).add(oe)
    return by_platform, rows


def _load_checkpoint(out_dir: Path) -> dict[str, Any]:
    cp = out_dir / "checkpoint.json"
    if not cp.is_file():
        return {"version": 1, "processed_hashes": []}
    data = json.loads(cp.read_text(encoding="utf-8"))
    if "processed_hashes" not in data:
        data["processed_hashes"] = []
    return data


def _save_checkpoint(out_dir: Path, processed: set[str]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    cp = out_dir / "checkpoint.json"
    tmp = cp.with_suffix(".tmp")
    payload = {"version": 1, "processed_hashes": sorted(processed)}
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(cp)


def _append_manifest(out_dir: Path, record: dict[str, Any]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False) + "\n"
    with (out_dir / "manifest.jsonl").open("a", encoding="utf-8") as f:
        f.write(line)


FLAT_NAME = re.compile(r"^([A-Z0-9]{6,})_(\d+)\.(jpg|jpeg|png|webp|heic|heif)$", re.I)


def _iter_images(folder: Path) -> Iterable[Path]:
    for p in sorted(folder.rglob("*")):
        if not p.is_file():
            continue
        if p.suffix.lower() in IMAGE_SUFFIXES:
            yield p


def _oe_from_path(incoming_root: Path, image_path: Path) -> str | None:
    try:
        rel = image_path.relative_to(incoming_root)
    except ValueError:
        return None
    parts = rel.parts
    if len(parts) >= 2:
        candidate = _norm_oe(parts[0])
        if candidate and not candidate.startswith("REPLACE"):
            return candidate
    m = FLAT_NAME.match(image_path.name)
    if m:
        return _norm_oe(m.group(1))
    return None


def _pick_platform_for_oe(by_platform: dict[str, set[str]], oe: str) -> str | None:
    found: list[str] = []
    for platform, oes in by_platform.items():
        if oe in oes:
            found.append(platform)
    if len(found) == 1:
        return found[0]
    if len(found) == 0:
        return None
    # Ambiguous: OE appears in multiple platform slices; require explicit CSV hygiene.
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Organize local Sprinter catalog images + validate against your CSV.")
    parser.add_argument("--repo-root", type=Path, default=None, help="Repo root (auto-detect if omitted).")
    parser.add_argument("--csv", type=Path, default=None, help="Parts CSV path.")
    parser.add_argument("--incoming", type=Path, default=None, help="Folder of images you captured.")
    parser.add_argument("--out", type=Path, default=None, help="Staging output folder.")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Skip images whose OE is not present in the CSV (recommended once your CSV is real).",
    )
    parser.add_argument(
        "--max-files",
        type=int,
        default=0,
        help="Stop after N new ingests (0 = no limit). Useful for chunked runs.",
    )
    args = parser.parse_args()

    repo_root = args.repo_root or _repo_root(Path.cwd())
    csv_paths = _merged_csv_paths(repo_root, args.csv)
    incoming = args.incoming or (repo_root / "data" / "sprinter" / "incoming")
    out_dir = args.out or (repo_root / "data" / "sprinter" / "staging")

    primary = csv_paths[0]
    if not primary.is_file():
        raise SystemExit(f"CSV not found: {primary}")
    if not incoming.is_dir():
        raise SystemExit(f"Incoming folder not found: {incoming}\nCreate it and drop photos there.")

    by_platform, _rows = _load_merged_parts(csv_paths)
    if not any(by_platform.values()):
        print(
            "Warning: CSV has no real OE rows yet (all placeholders?). "
            "Run with real part numbers, or omit --strict to stage by folder name only.",
            file=sys.stderr,
        )

    checkpoint = _load_checkpoint(out_dir)
    processed: set[str] = set(checkpoint.get("processed_hashes") or [])

    organized_root = out_dir / "organized"
    organized_root.mkdir(parents=True, exist_ok=True)

    ingested = 0
    skipped_resume = 0
    skipped_strict = 0

    for img in _iter_images(incoming):
        digest = _sha256_file(img)
        if digest in processed:
            skipped_resume += 1
            continue

        oe = _oe_from_path(incoming, img)
        if not oe:
            print(f"Skip (cannot infer OE from path): {img}", file=sys.stderr)
            continue

        platform = _pick_platform_for_oe(by_platform, oe)
        if platform is None:
            if args.strict and by_platform:
                print(f"Skip strict (unknown OE for known platforms): {oe} ({img})", file=sys.stderr)
                skipped_strict += 1
                continue
            # Fall back: if exactly one platform in CSV, use it; else require strict data.
            platforms = list(by_platform.keys())
            if len(platforms) == 1:
                platform = platforms[0]
            else:
                print(
                    f"Skip (cannot map OE {oe} to platform_code — add it to CSV or use a single platform slice): {img}",
                    file=sys.stderr,
                )
                continue

        dest_dir = organized_root / platform / oe
        dest_dir.mkdir(parents=True, exist_ok=True)
        idx = 1
        ext = img.suffix.lower() if img.suffix else ".jpg"
        while True:
            dest = dest_dir / f"{idx:04d}_{digest[:8]}{ext}"
            if not dest.exists():
                break
            idx += 1

        shutil.copy2(img, dest)
        processed.add(digest)

        record = {
            "source_path": str(img.as_posix()),
            "dest_path": str(dest.as_posix()),
            "platform_code": platform,
            "oe_part_number_normalized": oe,
            "sha256": digest,
            "provenance": "local_capture",
        }
        _append_manifest(out_dir, record)
        _save_checkpoint(out_dir, processed)
        ingested += 1

        if args.max_files and ingested >= args.max_files:
            print(f"Reached --max-files={args.max_files}; stopping.")
            break

    print(
        json.dumps(
            {
                "ingested": ingested,
                "skipped_already_processed": skipped_resume,
                "skipped_strict": skipped_strict,
                "out_dir": str(out_dir),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
