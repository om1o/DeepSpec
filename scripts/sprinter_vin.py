"""
Decode a US-market VIN via the public NHTSA vPIC API and cache to vehicle_profile.json.

No API key. Only helps label *your* van context (make/model/year); it is not a parts catalog.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from sprinter_defaults import repo_root, sprinter_dir

VPIC_TMPL = "https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvaluesextended/{vin}?format=json"


def _read_vin(path: Path) -> str:
    raw = path.read_text(encoding="utf-8", errors="ignore")
    vin = "".join(ch for ch in raw.strip().upper() if ch.isalnum())
    return vin


def decode_vin_to_profile(*, root: Path | None = None, force: bool = False) -> dict:
    root = root or repo_root()
    d = sprinter_dir(root)
    vin_path = d / "vin.txt"
    out_path = d / "vehicle_profile.json"

    if not vin_path.is_file():
        return {"status": "skipped", "reason": "no data/sprinter/vin.txt"}

    vin = _read_vin(vin_path)
    if len(vin) != 17:
        return {"status": "error", "reason": f"VIN must be 17 chars (got {len(vin)})"}

    if not force and out_path.is_file():
        try:
            prior = json.loads(out_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            prior = {}
        if prior.get("vin") == vin and prior.get("decoded_at"):
            return {"status": "cached", "path": str(out_path)}

    url = VPIC_TMPL.format(vin=vin)
    req = urllib.request.Request(url, headers={"User-Agent": "deepspec-local-ingest/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return {"status": "error", "reason": f"vPIC HTTP {e.code}"}
    except urllib.error.URLError as e:
        return {"status": "error", "reason": f"vPIC network error: {e}"}

    results = payload.get("Results") or []
    row = results[0] if results else {}
    summary = {
        "vin": vin,
        "decoded_at": int(time.time()),
        "make": row.get("Make"),
        "model": row.get("Model"),
        "model_year": row.get("ModelYear"),
        "trim": row.get("Trim"),
        "drive_type": row.get("DriveType"),
        "fuel_type_primary": row.get("FuelTypePrimary"),
        "plant_country": row.get("PlantCountry"),
        "error_code": row.get("ErrorCode"),
        "error_text": row.get("ErrorText"),
    }
    out_path.write_text(json.dumps({"vin": vin, "summary": summary, "raw_first_row": row}, indent=2), encoding="utf-8")
    return {"status": "ok", "path": str(out_path), "summary": summary}


def main() -> int:
    parser = argparse.ArgumentParser(description="Decode vin.txt via NHTSA vPIC (US).")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    print(json.dumps(decode_vin_to_profile(force=args.force), indent=2))
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    raise SystemExit(main())
