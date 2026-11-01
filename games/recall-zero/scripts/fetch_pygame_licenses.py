"""Fetch the exact pygame-ce 2.5.8 license bundle for release packaging."""

from __future__ import annotations

import argparse
from io import BytesIO
from pathlib import Path
import shutil
from urllib.request import Request, urlopen
from zipfile import ZipFile


VERSION = "2.5.8"
SOURCE_URL = f"https://github.com/pygame-community/pygame-ce/archive/refs/tags/{VERSION}.zip"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()

    request = Request(SOURCE_URL, headers={"User-Agent": "RecallZero-license-fetch/1.0"})
    with urlopen(request, timeout=30) as response:  # noqa: S310 - exact HTTPS release tag
        payload = response.read()

    prefix = f"pygame-ce-{VERSION}/docs/"
    args.destination.mkdir(parents=True, exist_ok=True)

    with ZipFile(BytesIO(payload)) as archive:
        members = [
            name
            for name in archive.namelist()
            if name == f"{prefix}LGPL.txt" or name.startswith(f"{prefix}licenses/")
        ]
        if f"{prefix}LGPL.txt" not in members:
            raise RuntimeError("The pygame-ce release archive did not contain docs/LGPL.txt")

        for member in members:
            if member.endswith("/"):
                continue
            relative = Path(member).relative_to(prefix)
            target = args.destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(member) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)

    (args.destination / "SOURCE.txt").write_text(
        (
            f"pygame-ce {VERSION}\n"
            f"Source: {SOURCE_URL}\n"
            f"Bundled source: pygame-ce-{VERSION}-source.zip\n"
            "No local modifications.\n"
        ),
        encoding="utf-8",
    )
    (args.destination / f"pygame-ce-{VERSION}-source.zip").write_bytes(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
