# Legend sheets for the visual-language board, drawn with the same 2x UI layer as the frames, over the game's own lobby
# floor and a customer from the stealth-select capture.
# Usage: python3 legend.py <dir>      (after scenes.py cast, capture.mjs and scenes.py compose have filled <dir>)
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image
import ui2 as u
from ui2 import TS, AMBER, RED, CMD, BONE, CREW
from scenes import lifted

d = sys.argv[1]
view = json.load(open(os.path.join(d, 'views.json')))['stealth-select']
ox, oy = -view['plot']['left'], -view['plot']['top']
floor = Image.open(os.path.join(d, 'stealth-select-floor.png')).convert('RGBA')
cast = lifted(Image.open(os.path.join(d, 'stealth-select-world.png')).convert('RGBA'), floor)
BG = (11, 13, 23, 255)

def at(img, tx, ty, w, h, dx=0, dy=0):
    """A w x h crop of a capture, starting at map tile (tx, ty) plus (dx, dy) UI pixels."""
    x, y = tx * TS - ox + dx, ty * TS - oy + dy
    return img.crop((x, y, x + w, y + h))

def up(im): return im.resize((im.width * 2, im.height * 2), Image.NEAREST)

# 1. safe-floor states, one lobby tile each, 48px cells, shown at 2x on the board
states = [('safe', '-'), ('amber', '+1'), ('amber', '+2'), ('amber', 'T'), ('red', '!'), ('hamber', '+1'), ('hred', '!'), ('cam', '-'), ('grey', '?'), ('hgrey', '?')]
sheet = Image.new('RGBA', (len(states) * 48, 48), BG)
for i, (k, g) in enumerate(states):
    cell = at(floor, 26, 24, TS, TS).copy(); ui = u.layer(TS, TS)
    u.tints(ui, {(0, 0): (k, g)}); cell.alpha_composite(ui)
    sheet.alpha_composite(cell, (i * 48 + 8, 8))
up(sheet.convert('RGB')).save(os.path.join(d, 'legend-tiles.png'))

# 2. state plates over a customer from the lobby, 48x96 cells
items = [('q2', AMBER, None, None), ('eye', RED, None, None), ('bell', RED, 2, None), ('radio', RED, 2, None), ('run', RED, 3, None), ('phone', RED, 2, None),
         ('hand', RED, 1, None), ('drops', AMBER, None, None), ('down', CMD, None, None), ('knot', BONE, None, None), ('star', CMD, None, None), ('waves', RED, None, '!'), ('cross', RED, None, None)]
person = at(cast, 24, 21, TS, 64, dy=-32)
sheet = Image.new('RGBA', (len(items) * 48, 96), BG)
for i, (k, c, n, sym) in enumerate(items):
    cell = Image.new('RGBA', (48, 96), BG)
    cell.alpha_composite(person, (8, 32))
    ui = u.layer(48, 96)
    u.badge(ui, 0, 2, k, c, n=n, sym=sym, dx=8)
    cell.alpha_composite(ui)
    sheet.alpha_composite(cell, (i * 48, 0))
up(sheet.convert('RGB')).save(os.path.join(d, 'legend-badges.png'))

# 3. pips, cone markers and cover
sheet = Image.new('RGBA', (9 * 48, 48), BG)
for i, (n, c, tot) in enumerate(((1, CREW['mara'], 3), (2, CREW['jun'], 3), (3, CREW['dex'], 3), (2, CMD, 2))):
    ui = u.layer(48, 48); u.pips(ui, 0, 0, n, c, total=tot, dy=20); sheet.alpha_composite(ui, (i * 48 + 8, 0))
for i, k in enumerate(('hostile', 'civ', 'crew')):
    ui = u.layer(48, 48); u.marker(ui, 0, 1, k, lying=True); sheet.alpha_composite(ui, ((4 + i) * 48 + 8, -6))
for i, fl in enumerate((False, True)):
    cell = at(floor, 26, 24, TS, TS).copy(); ui = u.layer(TS, TS); u.cover_edge(ui, 0, 0, 'w', flanked=fl); cell.alpha_composite(ui)
    sheet.alpha_composite(cell, ((7 + i) * 48 + 8, 8))
up(sheet.convert('RGB')).save(os.path.join(d, 'legend-pips.png'))
print('legend ok')
