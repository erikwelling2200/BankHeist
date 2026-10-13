# Legend sheets for the visual-language board, plus the desktop frame.
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image
from bh import *
import scenes
OUT = sys.argv[1]
base = scenes.base()
def floor_tile():
    return base.crop((27 * T, 18 * T, 28 * T, 19 * T)).copy()

# 1. safe-floor states: one tile each, 24px cells
states = [('safe', '-'), ('amber', '+1'), ('amber', '+2'), ('amber', 'T'), ('red', '!'), ('hamber', '+1'), ('hred', '!'), ('cam', '-'), ('grey', '?'), ('hgrey', '?')]
sheet = Image.new('RGB', (len(states) * 24, 24), (21, 19, 28))
for i, (k, g) in enumerate(states):
    t = Image.new('RGB', (48, 48)); t.paste(base.crop((26 * T, 17 * T, 29 * T, 20 * T)).resize((48, 48)))
    t = base.crop((26 * T, 17 * T, 28 * T, 19 * T)).copy()
    # draw tint on the top-left tile of a 2x2 crop, then cut it out
    tints(t, {(0, 0): (k, g)})
    sheet.paste(t.crop((0, 0, 16, 16)), (i * 24 + 4, 4))
up(sheet, 4).save(os.path.join(OUT, 'legend-tiles.png'))

# 2. NPC badges over a figure
items = [('?', AMBER, None, None), ('!', RED, None, None), ('bell', RED, 2, None), ('radio', RED, 2, None), ('run', RED, 3, None), ('phone', RED, 2, None),
         ('hand', RED, None, None), ('drop', AMBER, None, None), ('down', (140, 210, 255), None, None), ('knot', WHITE, None, None), ('star', (140, 210, 255), None, None), ('ear', RED, None, '!'), ('cross', RED, None, None)]
sheet = Image.new('RGB', (len(items) * 24, 28), (21, 19, 28))
for i, (k, c, n, sym) in enumerate(items):
    cell = Image.new('RGB', (24, 28), (21, 19, 28))
    fig = figure('civ', 'down', skin=i % 4, body=(80, 86, 104))
    cell.paste(fig, (4, 11), fig)
    badge(cell, 0, 1, k, c, n=n, sym=sym, offx=0) if k not in ('?', '!', 'bell') else badge(cell, 0, 1, k, c, n=n)
    sheet.paste(cell, (i * 24, 0))
up(sheet, 4).save(os.path.join(OUT, 'legend-badges.png'))

# 3. pips and markers
sheet = Image.new('RGB', (8 * 24, 24), (21, 19, 28))
for i, (n, c) in enumerate(((1, CREW['mara']), (2, CREW['jun']), (3, CREW['dex']), (2, (140, 210, 255)))):
    cell = Image.new('RGB', (24, 24), (21, 19, 28)); pips(cell, 0, 0, n, c, total=3 if i < 3 else 2, offy=10); sheet.paste(cell, (i * 24 + 4, 0))
for i, k in enumerate(('hostile', 'civ', 'crew')):
    cell = Image.new('RGB', (24, 24), (21, 19, 28)); body_marker(cell, 0, 1, k); sheet.paste(cell.crop((0, 0, 24, 24)), ((4 + i) * 24 + 4, -2))
up(sheet, 4).save(os.path.join(OUT, 'legend-pips.png'))
print('legend ok')
