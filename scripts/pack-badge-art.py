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
        thumb = source.convert("RGBA").resize((168, 168), Image.Resampling.LANCZOS)
    alpha = thumb.getchannel("A")
    # The indexed card supports binary transparency. Blend soft edges onto its paper color.
    paper = Image.new("RGB", thumb.size, (249, 246, 232))
    paper.paste(thumb, mask=alpha)
    indexed = paper.quantize(colors=128, dither=Image.Dither.NONE)
    pixels = bytes(value + 1 if opacity else 0 for value, opacity in zip(indexed.tobytes(), alpha.tobytes()))
    colors = bytes([0, 0, 0] + indexed.getpalette()[:128 * 3])
    return {"colors": encode(colors), "pixels": encode(gzip.compress(pixels, mtime=0))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    public_posters = list(args.directory.glob("*.webp"))
    if not public_posters:
        parser.error("No WebP source artwork found")
    bundled_posters = (root / "src/features/achievements/posters").glob("*.webp")
    sources = sorted([*public_posters, *bundled_posters], key=lambda path: path.stem)
    if len({path.stem for path in sources}) != len(sources):
        parser.error("Badge poster identifiers must be unique")
    packed = {path.stem: pack(path) for path in sources}
    target = root / "src/features/achievements/artwork.json"
    target.write_text(json.dumps(packed, indent=2) + "\n")


if __name__ == "__main__":
    main()
