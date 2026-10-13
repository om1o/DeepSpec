"""Reproduce the approved PNG derivatives with Pillow (tested with 12.3.0)."""
from pathlib import Path
from PIL import Image

for name, size in [("deepspec-symbol", 168), ("deepspec-scan-badge-glass", 336)]:
    source = Path("public/brand") / f"{name}.png"
    resized = Image.open(source).convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    target = source.with_suffix(".webp")
    resized.save(target, format="WEBP", lossless=True, quality=90, method=6)
    decoded = Image.open(target).convert("RGBA")
    assert resized.getchannel("A").tobytes() == decoded.getchannel("A").tobytes()
    # WebP may discard RGB beneath fully transparent pixels; it has no visible effect.
    assert all(a == b for a, b in zip(resized.getdata(), decoded.getdata()) if a[3] > 0)
    print(target, target.stat().st_size)
