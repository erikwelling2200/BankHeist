# Previews the hi-bit people style (peopleStyles.ts): double-density sprites can't show in the game yet, because it draws
# at the art's resolution and the browser scales that up. So each person in a standard capture is replaced, outside the
# game, by their hi-bit drawing lit with the light the game gave their standard drawing (lit / unlit, per art pixel).
# Usage: python3 hibit.py <standard-dir> <out-dir> <scene ...>      (after cast, capture.mjs and compose in <standard-dir>)
import sys, os, json, subprocess, shutil
from PIL import Image

src, out, names = sys.argv[1], sys.argv[2], sys.argv[3:]
os.makedirs(out, exist_ok=True)
cast = json.load(open(os.path.join(src, 'cast.json')))
views = json.load(open(os.path.join(src, 'views.json')))
key = lambda p: (p['look'], p['facing'], p.get('mask'), p.get('pose'))
wanted = {key(p): p for n in names for p in cast[n]['people']}
spritesFile = os.path.join(out, 'sprites.json')
root = os.path.join(os.path.dirname(__file__), '..', '..')
env = dict(os.environ, SPRITES=json.dumps([{k: v for k, v in p.items() if k in ('look', 'facing', 'mask', 'pose')} for p in wanted.values()]), SPRITES_OUT=os.path.abspath(spritesFile))
subprocess.run(['npx', 'vitest', 'run', '--config', 'scripts/ui-mockups/vitest.export.config.ts', 'export-sprites'], cwd=root, env=env, check=True, capture_output=True)
sprites = {key(s): s for s in json.load(open(spritesFile))}

def image(s): return Image.frombytes('RGBA', (s['w'], s['h']), bytes(s['rgba']))

for n in names:
    world = Image.open(os.path.join(src, f'{n}-world.png')).convert('RGB')
    floor = Image.open(os.path.join(src, f'{n}-floor.png')).convert('RGB')
    plot = views[n]['plot']
    people = sorted(cast[n]['people'], key=lambda p: p['ty'])
    placed = []
    for p in people:
        s = sprites[key(p)]; std, hi = image(s['standard']), image(s['hibit'])
        sx, sy = round(p['tx'] * 32 + plot['left']), round((p['ty'] * 16 - 14) * 2 + plot['top'])
        ratio = {}
        for y in range(std.height):
            for x in range(std.width):
                r, g, b, a = std.getpixel((x, y))
                if not a: continue
                lit = [world.getpixel((sx + 2 * x + dx, sy + 2 * y + dy)) for dx in (0, 1) for dy in (0, 1) if 0 <= sx + 2 * x + dx < world.width and 0 <= sy + 2 * y + dy < world.height]
                if not lit: continue
                mean = [sum(c[i] for c in lit) / len(lit) for i in range(3)]
                ratio[(x, y)] = [min(2.5, mean[i] / max(1, (r, g, b)[i])) for i in range(3)]
        placed.append((p, std, hi, sx, sy, ratio))
    # Take everyone out of the picture first (the drop shadows stay), then put them back in hi-bit, back to front.
    for p, std, hi, sx, sy, ratio in placed:
        for (x, y) in ratio:
            for dx in (0, 1):
                for dy in (0, 1):
                    X, Y = sx + 2 * x + dx, sy + 2 * y + dy
                    if 0 <= X < world.width and 0 <= Y < world.height: world.putpixel((X, Y), floor.getpixel((X, Y)))
    for p, std, hi, sx, sy, ratio in placed:
        middle = ratio.get((8, 14)) or next(iter(ratio.values()), [1, 1, 1])
        for y in range(hi.height):
            for x in range(hi.width):
                r, g, b, a = hi.getpixel((x, y))
                if not a or not (0 <= sx + x < world.width and 0 <= sy + y < world.height): continue
                k = ratio.get((x // 2, y // 2)) or ratio.get((x // 2, y // 2 + 1)) or middle
                world.putpixel((sx + x, sy + y), tuple(min(255, round(c * k[i])) for i, c in enumerate((r, g, b))))
    world.save(os.path.join(out, f'{n}-world.png'))
    shutil.copy(os.path.join(src, f'{n}-floor.png'), os.path.join(out, f'{n}-floor.png'))
    print('hi-bit', n)
shutil.copy(os.path.join(src, 'cast.json'), os.path.join(out, 'cast.json'))
known = json.load(open(os.path.join(out, 'views.json'))) if os.path.exists(os.path.join(out, 'views.json')) else {}
known.update({n: views[n] for n in names})
json.dump(known, open(os.path.join(out, 'views.json'), 'w'))
