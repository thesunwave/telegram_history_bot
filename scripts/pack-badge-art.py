"""Pack the landing's square badge WebPs into the Worker's indexed card artwork.

Usage: python3 scripts/pack-badge-art.py /path/to/landing/public/landing/badges
Pillow is needed only when changing the artwork.
"""
import argparse
import base64
import gzip
import json
from pathlib import Path

from PIL import Image


def encode(data):
    return base64.b64encode(data).decode("ascii")


def pack(path):
    with Image.open(path) as source:
        thumb = source.convert("RGB").resize((168, 168), Image.Resampling.LANCZOS)
    indexed = thumb.quantize(colors=128, dither=Image.Dither.NONE)
    # Index zero stays available for transparent pixels on the card canvas.
    pixels = bytes(value + 1 for value in indexed.tobytes())
    colors = bytes([0, 0, 0] + indexed.getpalette()[:128 * 3])
    return {"colors": encode(colors), "pixels": encode(gzip.compress(pixels, mtime=0))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    packed = {p.stem: pack(p) for p in sorted(args.directory.glob("*.webp"))}
    if not packed:
        parser.error("No WebP source artwork found")
    target = Path(__file__).resolve().parents[1] / "src/features/achievements/artwork.json"
    target.write_text(json.dumps(packed, indent=2) + "\n")


if __name__ == "__main__":
    main()
