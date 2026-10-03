"""Renders the extension icons: three tab-group pills on a dark tile.

Usage: python3 scripts/make-icons.py   (needs Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
SCALE = 8  # supersampling factor for smooth edges

TILE = "#1f2430"
PILLS = [  # (left, top, right, bottom) in a 128 box, color
    ((22, 26, 106, 50), "#5b8def"),
    ((22, 56, 88, 80), "#f2668b"),
    ((22, 86, 70, 110), "#f6b73c"),
]


def render(size):
    s = 128 * SCALE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=28 * SCALE, fill=TILE)
    for (l, t, r, b), color in PILLS:
        d.rounded_rectangle((l * SCALE, t * SCALE, r * SCALE, b * SCALE), radius=12 * SCALE, fill=color)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for size in (16, 32, 48, 128):
        render(size).save(OUT / f"icon{size}.png")
        print("wrote", OUT / f"icon{size}.png")
