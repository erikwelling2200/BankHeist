# Legend sheets for the visual-language board, drawn with the same 2x UI layer as the frames.
# Usage: python3 legend.py <out-dir>      (run scenes.py into the same folder first: it reuses the floor render)
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image
import bh
import ui2 as u
from ui2 import TS, AMBER, RED, CMD, BONE, CREW
OUT = sys.argv[1]
sys.argv = [sys.argv[0], OUT]
import scenes

floor = bh.up(scenes.Scene().world, 2).convert('RGBA')

def floor_cell(w, h, tx=27, ty=18):
    return floor.crop((tx * TS, ty * TS, tx * TS + w, ty * TS + h))

# 1. safe-floor states, one tile each, 48px cells, shown at 2x on the board
states = [('safe', '-'), ('amber', '+1'), ('amber', '+2'), ('amber', 'T'), ('red', '!'), ('hamber', '+1'), ('hred', '!'), ('cam', '-'), ('grey', '?'), ('hgrey', '?')]
sheet = Image.new('RGBA', (len(states) * 48, 48), (18, 17, 22, 255))
for i, (k, g) in enumerate(states):
    cell = floor_cell(TS, TS).copy(); ui = u.layer(TS, TS)
    u.tints(ui, {(0, 0): (k, g)}); cell.alpha_composite(ui)
    sheet.alpha_composite(cell, (i * 48 + 8, 8))
bh.up(sheet.convert('RGB'), 2).save(os.path.join(OUT, 'legend-tiles.png'))

# 2. state plates over a figure, 48x56 cells
items = [('q2', AMBER, None, None), ('eye', RED, None, None), ('bell', RED, 2, None), ('radio', RED, 2, None), ('run', RED, 3, None), ('phone', RED, 2, None),
         ('hand', RED, 1, None), ('drops', AMBER, None, None), ('down', CMD, None, None), ('knot', BONE, None, None), ('star', CMD, None, None), ('waves', RED, None, '!'), ('cross', RED, None, None)]
sheet = Image.new('RGBA', (len(items) * 48, 64), (18, 17, 22, 255))
for i, (k, c, n, sym) in enumerate(items):
    cell = Image.new('RGBA', (48, 64), (18, 17, 22, 255))
    fig = bh.up(bh.figure('civ', 'down', skin=i % 4, body=(80, 86, 104)), 2)
    cell.alpha_composite(fig, (8, 30))
    ui = u.layer(48, 64)
    u.badge(ui, 0, 1, k, c, n=n, sym=sym, dx=8)
    cell.alpha_composite(ui, (0, -2))
    sheet.alpha_composite(cell, (i * 48, 0))
bh.up(sheet.convert('RGB'), 2).save(os.path.join(OUT, 'legend-badges.png'))

# 3. pips and cone markers
sheet = Image.new('RGBA', (9 * 48, 48), (18, 17, 22, 255))
for i, (n, c, tot) in enumerate(((1, CREW['mara'], 3), (2, CREW['jun'], 3), (3, CREW['dex'], 3), (2, CMD, 2))):
    ui = u.layer(48, 48); u.pips(ui, 0, 0, n, c, total=tot, dy=20); sheet.alpha_composite(ui, (i * 48 + 8, 0))
for i, k in enumerate(('hostile', 'civ', 'crew')):
    ui = u.layer(48, 48); u.marker(ui, 0, 1, k); sheet.alpha_composite(ui, ((4 + i) * 48 + 8, -12))
for i, fl in enumerate((False, True)):
    cell = floor_cell(TS, TS).copy(); ui = u.layer(TS, TS); u.cover_edge(ui, 0, 0, 'w', flanked=fl); cell.alpha_composite(ui)
    sheet.alpha_composite(cell, ((7 + i) * 48 + 8, 8))
bh.up(sheet.convert('RGB'), 2).save(os.path.join(OUT, 'legend-pips.png'))
print('legend ok')
