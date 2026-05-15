"""Shared paths / constants for local Sprinter catalog automation (stdlib only)."""

from __future__ import annotations

import re
from pathlib import Path

EXPECTED_CSV_FIELDS = (
    "platform_code",
    "oe_part_number_normalized",
    "display_name",
    "functional_group",
    "mounting_side",
    "notes",
)

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}

FLAT_NAME = re.compile(r"^([A-Z0-9]{6,})_(\d+)\.(jpg|jpeg|png|webp|heic|heif)$", re.I)


def repo_root(start: Path | None = None) -> Path:
    p0 = start or Path.cwd()
    for p in [p0, *p0.parents]:
        if (p / "package.json").is_file() and (p / "data").is_dir():
            return p
    return p0.resolve()


def sprinter_dir(root: Path | None = None) -> Path:
    return (root or repo_root()) / "data" / "sprinter"


def norm_oe(raw: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", raw.strip().upper()) if raw else ""


def read_default_platform(root: Path | None = None) -> str:
    p = sprinter_dir(root) / "default_platform.txt"
    if not p.is_file():
        return "NCV3_NA"
    line = p.read_text(encoding="utf-8").strip().splitlines()[0].strip()
    return line or "NCV3_NA"
