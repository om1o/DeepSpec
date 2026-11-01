"""Small, fail-closed save file for RECALL//ZERO."""

from __future__ import annotations

from copy import deepcopy
import json
import os
from pathlib import Path
from typing import Any


DEFAULT_SAVE: dict[str, Any] = {
    "version": 1,
    "best_score": 0,
    "victories": 0,
    "unlocked_lore": 0,
    "settings": {
        "focus_mode": False,
        "reduced_motion": False,
        "high_contrast": False,
        "muted": False,
    },
}


def default_save_path() -> Path:
    root = Path(os.environ.get("LOCALAPPDATA", Path.home()))
    return root / "RecallZero" / "save.json"


def load_save(path: Path | None = None) -> dict[str, Any]:
    destination = path or default_save_path()
    data = deepcopy(DEFAULT_SAVE)

    try:
        raw = json.loads(destination.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return data

    if not isinstance(raw, dict):
        return data

    for key in ("best_score", "victories", "unlocked_lore"):
        value = raw.get(key)
        if isinstance(value, int) and value >= 0:
            data[key] = value

    raw_settings = raw.get("settings")
    if isinstance(raw_settings, dict):
        for key in data["settings"]:
            value = raw_settings.get(key)
            if isinstance(value, bool):
                data["settings"][key] = value

    return data


def save_data(data: dict[str, Any], path: Path | None = None) -> None:
    destination = path or default_save_path()
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
    temporary.replace(destination)
