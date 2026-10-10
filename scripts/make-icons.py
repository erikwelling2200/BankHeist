"""Generates the PWA icons (a pixel-art gold bar under a spotlight) into public/icons."""
import math
from pathlib import Path
from PIL import Image

GRID = 16
BAR = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '....hhhhhhhh....',
    '...hHHHHHHHHh...',
    '..hyyyyyyyyyyh..',
    '..hyyyyyyyyyyh..',
    '..oooooooooooo..',
    '................',
]
COLORS = {'h': (242, 201, 76), 'H': (255, 242, 168), 'y': (217, 166, 40), 'o': (138, 90, 20)}

def render(size: int) -> Image.Image:
    small = Image.new('RGB', (GRID, GRID))
    for y in range(GRID):
        for x in range(GRID):
            # Dark background with a warm spotlight falling on the bar.
            d = math.hypot(x - 7.5, y - 8.5) / 9
            glow = max(0.0, 1 - d)
            small.putpixel((x, y), (int(11 + 60 * glow), int(13 + 42 * glow), int(23 + 20 * glow)))
    for y, row in enumerate(BAR):
        for x, c in enumerate(row):
            if c in COLORS:
                small.putpixel((x, y + 2), COLORS[c])
    return small.resize((size, size), Image.NEAREST)

out = Path(__file__).resolve().parent.parent / 'public' / 'icons'
out.mkdir(parents=True, exist_ok=True)
for size in (192, 512):
    render(size).save(out / f'icon-{size}.png')
