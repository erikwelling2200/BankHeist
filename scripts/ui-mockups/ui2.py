# World-space UI at twice the art resolution: one UI pixel is half an art pixel, so a 16px tile is 32 UI pixels.
# STYLE CARD (gritty, tactical, not cartoon)
# - Hairlines: 1 UI px strokes, with a 1px ink drop shadow down-right instead of a fat outline all round.
# - Muted signal colours (sodium amber, brick red, sage green, steel blue) that sit in the scene's palette.
# - Fills are faint scanlines or fine hatching; the edge carries the meaning. No glowing blobs.
# - Plates over heads are near-black with a thin border in the signal colour; glyph and number are drawn in that
#   colour, never white-on-red stickers.
# - Every state still has a second channel: glyph, hatching or line style, not colour alone.
import math
from PIL import Image

U = 2
TS = 16 * U
SAFE, AMBER, RED, GREY, CMD = (128, 190, 138), (226, 162, 64), (212, 70, 56), (128, 126, 136), (138, 182, 214)
BONE, INK, DIM = (228, 220, 200), (8, 7, 10), (150, 146, 156)
COVER = (172, 216, 244)
CREW = {'mara': (96, 192, 206), 'jun': (206, 116, 184), 'dex': (150, 132, 224), 'sol': (218, 200, 162)}
HOSTILE, CIV, CREWBLUE = RED, (214, 210, 200), (110, 160, 220)

def cx(t): return t * TS + TS // 2

def layer(w, h): return Image.new('RGBA', (w, h), (0, 0, 0, 0))

def put(im, x, y, c, a=255):
    if 0 <= x < im.width and 0 <= y < im.height:
        p = im.load(); old = p[x, y]
        if old[3] == 0 or a >= 255: p[x, y] = c[:3] + (a,)
        else:
            t = a / 255; na = min(255, old[3] + a - old[3] * a // 255)
            p[x, y] = tuple(int(old[i] * (1 - t) + c[i] * t) for i in range(3)) + (na,)

def rect(im, x0, y0, x1, y1, c, a=255):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1): put(im, x, y, c, a)

def frame(im, x0, y0, x1, y1, c, a=255):
    for x in range(x0, x1 + 1): put(im, x, y0, c, a); put(im, x, y1, c, a)
    for y in range(y0, y1 + 1): put(im, x0, y, c, a); put(im, x1, y, c, a)

def line(im, x0, y0, x1, y1, c, a=255, dash=0, gap=0, shadow=True):
    n = int(max(abs(x1 - x0), abs(y1 - y0))) or 1
    pts = []
    for i in range(n + 1):
        if dash and (i % (dash + gap)) >= dash: continue
        pts.append((round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n)))
    if shadow:
        for (x, y) in pts: put(im, x + 1, y + 1, INK, 170)
    for (x, y) in pts: put(im, x, y, c, a)

# ---------------------------------------------------------------- glyphs (drawn in one colour, shadowed)
G = {
 'eye':   ['....xxxxx....', '..xx.....xx..', '.x...xxx...x.', 'x...xxxxx...x', '.x...xxx...x.', '..xx.....xx..', '....xxxxx....'],
 'hand':  ['....x.....', '..x.x.x...', '..x.x.x.x.', '..x.x.x.x.', '..x.x.x.x.', 'x.xxxxxxx.', 'xxxxxxxxx.', '.xxxxxxxx.', '.xxxxxxx..', '..xxxxxx..', '...xxxx...'],
 'q':     ['.xxxx.', 'x....x', '.....x', '....x.', '...x..', '..x...', '......', '..x...'],
 'cam':   ['xxxxxxxx....', 'x......xxx..', 'x......x.x..', 'xxxxxxxxxx..', '...x........', '.xxxxx......'],
 'bell':  ['.....x.....', '....xxx....', '...x...x...', '..x.....x..', '..x.....x..', '..x.....x..', '.x.......x.', 'xxxxxxxxxxx', '.....x.....'],
 'radio': ['x.......', 'x.......', 'xxxxxxx.', 'x.....x.', 'x.xxx.x.', 'x.....x.', 'x.xxx.x.', 'x.....x.', 'x.x.x.x.', 'xxxxxxx.'],
 'run':   ['.......xx.', '.......xx.', '....xxxx..', '...x.xxx.x', '..x..xxxx.', '.....xx...', '....x..x..', '...x....x.', '..x.....x.', '.x.......x'],
 'phone': ['xxx.......', 'xxxx......', '.xxx......', '..xx......', '..xx......', '...xx.....', '....xx..xx', '.....xxxxx', '......xxxx'],
 'waves': ['...x.....', '..xx..x..', 'xxxx...x.', 'xxxx.x.x.', 'xxxx...x.', '..xx..x..', '...x.....'],
 'down':  ['x.......x', '.x.....x.', '..x...x..', '...x.x...', '....x....', '.........', 'xxxxxxxxx'],
 'knot':  ['.xxx...xxx.', 'x...x.x...x', 'x...xxx...x', 'x...x.x...x', '.xxx...xxx.'],
 'cross': ['....x....', '..xxxxx..', '.x..x..x.', '.x.....x.', 'xxx...xxx', '.x.....x.', '.x..x..x.', '..xxxxx..', '....x....'],
 'star':  ['....x....', '.x..x..x.', '..x.x.x..', '...x.x...', 'xxx...xxx', '...x.x...', '..x.x.x..', '.x..x..x.', '....x....'],
 'drops': ['..x.....x..', '..x.....x..', '.xxx...xxx.', 'xxxxx.xxxxx', 'xxxxx.xxxxx', '.xxx...xxx.'],
 'lock':  ['..xxxxx..', '.x.....x.', '.x.....x.', 'xxxxxxxxx', 'x.......x', 'x...x...x', 'x...x...x', 'x.......x', 'xxxxxxxxx'],
 'bolt':  ['.....x.....', '..x..x..x..', '...x.x.x...', '....xxx....', 'xxxxx.xxxxx', '....xxx....', '...x.x.x...', '..x..x..x..', '.....x.....'],
 'halfsh':['xxxxxxx', 'x.....x', 'x.....x', 'x.....x', 'x.....x', '.x...x.', '..x.x..', '...x...'],
 'q2':    ['.xxxx.', 'x....x', '.....x', '....x.', '...x..', '..x...', '......', '..x...'],
}
DIG = {
 '0': ['.xxx.', 'x...x', 'x..xx', 'x.x.x', 'xx..x', 'x...x', 'x...x', '.xxx.'], '1': ['..x..', '.xx..', 'x.x..', '..x..', '..x..', '..x..', '..x..', 'xxxxx'],
 '2': ['.xxx.', 'x...x', '....x', '...x.', '..x..', '.x...', 'x....', 'xxxxx'], '3': ['xxxx.', '....x', '....x', '.xxx.', '....x', '....x', '....x', 'xxxx.'],
 '4': ['...x.', '..xx.', '.x.x.', 'x..x.', 'xxxxx', '...x.', '...x.', '...x.'], '5': ['xxxxx', 'x....', 'xxxx.', '....x', '....x', '....x', 'x...x', '.xxx.'],
 '6': ['..xx.', '.x...', 'x....', 'xxxx.', 'x...x', 'x...x', 'x...x', '.xxx.'], '7': ['xxxxx', '....x', '...x.', '...x.', '..x..', '..x..', '.x...', '.x...'],
 '8': ['.xxx.', 'x...x', 'x...x', '.xxx.', 'x...x', 'x...x', 'x...x', '.xxx.'], '9': ['.xxx.', 'x...x', 'x...x', 'x...x', '.xxxx', '....x', '...x.', '.xx..'],
 '+': ['.....', '.....', '..x..', '..x..', 'xxxxx', '..x..', '..x..', '.....'], '-': ['.....', '.....', '.....', '.....', 'xxxxx', '.....', '.....', '.....'],
 '!': ['x', 'x', 'x', 'x', 'x', '.', '.', 'x'], '?': ['.xxx.', 'x...x', '....x', '...x.', '..x..', '.....', '.....', '..x..'],
}

def glyph(im, rows, x, y, c, a=255, shadow=True):
    pts = [(x + i, y + j) for j, r in enumerate(rows) for i, ch in enumerate(r) if ch == 'x']
    if shadow:
        for (px, py) in pts: put(im, px + 1, py + 1, INK, 200)
    for (px, py) in pts: put(im, px, py, c, a)
    return len(rows[0]), len(rows)

def num(im, s, x, y, c, shadow=True):
    for ch in str(s):
        rows = DIG.get(ch, DIG['?'])
        glyph(im, rows, x, y, c, shadow=shadow); x += len(rows[0]) + 1
    return x

def num_w(s): return sum(len(DIG.get(ch, DIG['?'])[0]) + 1 for ch in str(s)) - 1

def gw(name): return len(G[name][0])

# ---------------------------------------------------------------- floor-level UI
def tints(im, info, skip=()):
    """Safe-floor overlay: faint fill, a hairline where the outcome changes, and a glyph on every non-safe tile."""
    glyphs = {t: v[1] for t, v in info.items() if isinstance(v, tuple) and len(v) > 1 and t not in skip}
    kinds = {t: v[0] if isinstance(v, tuple) else v for t, v in info.items() if t not in skip}
    col = {'safe': SAFE, 'amber': AMBER, 'red': RED, 'grey': GREY, 'hamber': AMBER, 'hred': RED, 'hgrey': GREY, 'cam': RED}
    for (tx, ty), k in kinds.items():
        c = col[k]; x0, y0 = tx * TS, ty * TS
        for py in range(TS):
            for px in range(TS):
                if k in ('hamber', 'hred', 'hgrey'):
                    if (px + py) % 6 == 0: put(im, x0 + px, y0 + py, c, 170)
                    elif py % 2 == 0: put(im, x0 + px, y0 + py, c, 18)
                elif k == 'grey':
                    put(im, x0 + px, y0 + py, (14, 14, 20), 120 if (px + py) % 2 else 150)
                elif py % 2 == 0:
                    put(im, x0 + px, y0 + py, c, 40 if k == 'safe' else 70)
        for (dx, dy) in ((0, -1), (0, 1), (-1, 0), (1, 0)):
            nk = kinds.get((tx + dx, ty + dy))
            if nk == k or (k == 'safe' and nk is not None): continue
            for i in range(TS):
                if dx == 0: x, y = x0 + i, y0 + (1 if dy < 0 else TS - 2)
                else: x, y = x0 + (1 if dx < 0 else TS - 2), y0 + i
                put(im, x, y, c, 235)
                put(im, x + (1 if dx == 0 and dy > 0 else 0) * 0, y, c, 235)
        g = glyphs.get((tx, ty))
        if k == 'grey' or g == '?': glyph(im, G['q'], x0 + 13, y0 + 12, GREY)
        elif g in ('+1', '+2'):
            n = int(g[1])
            for i in range(n):
                px0 = x0 + 16 - (n * 7 - 3) // 2 + i * 7
                rect(im, px0, y0 + 14, px0 + 3, y0 + 17, c); rect(im, px0 + 1, y0 + 18, px0 + 4, y0 + 18, INK, 190); rect(im, px0 + 4, y0 + 15, px0 + 4, y0 + 17, INK, 190)
        elif g == '!': glyph(im, G['eye'], x0 + 10, y0 + 13, c)
        elif g == 'T': glyph(im, G['hand'], x0 + 11, y0 + 10, c)
        if k == 'cam': glyph(im, G['cam'], x0 + 10, y0 + 13, c)

def path(im, tiles, c=BONE, end=True, dash=6, gap=4):
    pts = [(cx(x), cx(y)) for x, y in tiles]
    for (a, b) in zip(pts, pts[1:]):
        line(im, a[0], a[1], b[0], b[1], c, 240, dash, gap); line(im, a[0], a[1] - 1, b[0], b[1] - 1, c, 240, dash, gap, shadow=False)
    for (x, y) in pts[1:-1]: rect(im, x - 1, y - 1, x, y, c, 200)
    if end:
        x, y = pts[-1]
        for s in (-1, 1):
            for t in (-1, 1):
                line(im, x + 7 * s, y + 7 * t, x + 4 * s, y + 7 * t, c); line(im, x + 7 * s, y + 7 * t, x + 7 * s, y + 4 * t, c)

def arrow(im, tiles, c=BONE, a=230):
    """NPC intent: dotted line in the NPC's colour and an open chevron."""
    pts = [(cx(x), cx(y)) for x, y in tiles]
    for (p, q) in zip(pts, pts[1:]): line(im, p[0], p[1], q[0], q[1], c, a, 3, 3)
    (ax, ay), (bx, by) = pts[-2], pts[-1]
    ang = math.atan2(by - ay, bx - ax)
    for s in (-1, 1):
        line(im, bx, by, round(bx - 9 * math.cos(ang + s * 0.55)), round(by - 9 * math.sin(ang + s * 0.55)), c, a)
        line(im, bx - 1, by, round(bx - 1 - 9 * math.cos(ang + s * 0.55)), round(by - 9 * math.sin(ang + s * 0.55)), c, a, shadow=False)

def blocks_px(blocks_sight, x0, y0, x1, y1):
    n = int(max(abs(x1 - x0), abs(y1 - y0)) / 6) + 1
    tx1, ty1 = int(x1 // TS), int(y1 // TS)
    for i in range(1, n):
        x = x0 + (x1 - x0) * i / n; y = y0 + (y1 - y0) * i / n
        tx, ty = int(x // TS), int(y // TS)
        if (tx, ty) != (tx1, ty1) and blocks_sight(tx, ty): return True
    return False

def cone(im, blocks_sight, tx, ty, facing, rng, half, c, fill=40, dotted=False):
    """Vision or watch cone: scanline fill, hairline edge, clipped by walls."""
    ox, oy = cx(tx), cx(ty); R = rng * TS
    for y in range(max(0, oy - R), min(im.height, oy + R)):
        for x in range(max(0, ox - R), min(im.width, ox + R)):
            d = math.hypot(x - ox, y - oy)
            if d > R or d < 10: continue
            da = abs((math.degrees(math.atan2(y - oy, x - ox)) - facing + 180) % 360 - 180)
            if da > half: continue
            if blocks_px(blocks_sight, ox, oy, x, y): continue
            edge = abs(da - half) < 50 / max(d, 1) or R - d < 1
            if edge:
                if not dotted or (int(d) // 3) % 2 == 0: put(im, x, y, c, 220)
            elif y % 2 == 0: put(im, x, y, c, fill)

def ring(im, tiles, c, fill=0, dotted=True):
    """Exact reached tiles: a dotted hairline on the boundary, optional faint scanline fill."""
    for (x, y) in tiles:
        x0, y0 = x * TS, y * TS
        if fill:
            for py in range(0, TS, 2):
                for px in range(TS): put(im, x0 + px, y0 + py, c, fill)
        for (dx, dy) in ((0, -1), (0, 1), (-1, 0), (1, 0)):
            if (x + dx, y + dy) in tiles: continue
            for k in range(TS):
                if dotted and k % 4 >= 2: continue
                if dy == -1: X, Y = x0 + k, y0
                elif dy == 1: X, Y = x0 + k, y0 + TS - 1
                elif dx == -1: X, Y = x0, y0 + k
                else: X, Y = x0 + TS - 1, y0 + k
                put(im, X, Y, c, 240)

def arcs(im, blocks_sight, sx, sy, ang, aim, rec, bullets, rng, c=(236, 214, 160)):
    """Shot cone: each bullet's arc as a hairline, bullet 1 brightest; faint scanline fill; cut at blockers."""
    R = rng * TS; widest = aim + (bullets - 1) * rec
    for y in range(max(0, int(sy - R)), min(im.height, int(sy + R))):
        for x in range(max(0, int(sx - R)), min(im.width, int(sx + R))):
            d = math.hypot(x - sx, y - sy)
            if d > R or d < 10: continue
            da = abs((math.degrees(math.atan2(y - sy, x - sx)) - ang + 180) % 360 - 180)
            if da > widest / 2 + 0.01: continue
            if blocks_px(blocks_sight, sx, sy, x, y): continue
            k = next((b for b in range(bullets) if da <= (aim + b * rec) / 2), bullets - 1)
            on_edge = any(abs(da - (aim + b * rec) / 2) < 28 / max(d, 1) for b in range(bullets))
            if on_edge: put(im, x, y, c, 235 if k == 0 else max(90, 220 - k * 25))
            elif y % 2 == 0: put(im, x, y, c, max(14, 70 - k * 10))
    for r in range(2, rng + 1, 2):
        for s in (-1, 1):
            a = math.radians(ang + s * widest / 2)
            put(im, round(sx + r * TS * math.cos(a)), round(sy + r * TS * math.sin(a)), BONE)

def bracket(im, tx, ty, c, w=1, h=1, arm=6):
    x0, y0, x1, y1 = tx * TS + 1, ty * TS + 1, (tx + w) * TS - 2, (ty + h) * TS - 2
    for (x, y, sx, sy) in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
        line(im, x, y, x + sx * arm, y, c); line(im, x, y, x, y + sy * arm, c)

def crew_ring(im, tx, ty, c):
    ox, oy = cx(tx), ty * TS + 29
    for a in range(0, 360, 3):
        x = ox + round(12 * math.cos(math.radians(a))); y = oy + round(4 * math.sin(math.radians(a)))
        if 200 < a < 340: continue
        put(im, x, y, c, 230); put(im, x, y + 1, c, 150)

def footprint(im, tx, ty, w, h, c, a=200, solid=False):
    x0, y0, x1, y1 = tx * TS + 2, ty * TS + 2, (tx + w) * TS - 3, (ty + h) * TS - 3
    for x in range(x0, x1 + 1):
        if solid or x % 4 < 2: put(im, x, y0, c, a); put(im, x, y1, c, a)
    for y in range(y0, y1 + 1):
        if solid or y % 4 < 2: put(im, x0, y, c, a); put(im, x1, y, c, a)

# ---------------------------------------------------------------- actor-level UI
def plate(im, x, y, w, h, c):
    rect(im, x, y, x + w - 1, y + h - 1, (12, 11, 15), 215)
    frame(im, x, y, x + w - 1, y + h - 1, c, 235)

def badge(im, tx, ty, kind, c, n=None, sym=None, dx=0):
    """A state plate over an NPC's head: thin border in the signal colour, glyph and countdown in that colour."""
    rows = G[kind]; gwid, ghei = len(rows[0]), len(rows)
    extra = (num_w(n) + 3) if n is not None else 0
    extra += (len(DIG[sym][0]) + 3) if sym else 0
    w, h = gwid + 8 + extra, max(ghei, 8) + 8
    x = cx(tx) - w // 2 + dx; y = ty * TS - h - 1
    plate(im, x, y, w, h, c)
    glyph(im, rows, x + 4, y + (h - ghei) // 2, c, shadow=False)
    xx = x + 4 + gwid + 2
    if n is not None: rect(im, xx - 1, y + 3, xx - 1, y + h - 4, c, 110); num(im, n, xx + 2, y + (h - 8) // 2, BONE, shadow=False); xx += num_w(n) + 4
    if sym: glyph(im, DIG[sym], xx, y + (h - 8) // 2, c, shadow=False)

def pips(im, tx, ty, n, c, total=3, dy=0):
    """Suspicion or command pips: 3px squares, filled or hollow."""
    x0 = cx(tx) - (total * 7 - 3) // 2; y = ty * TS + dy
    for i in range(total):
        x = x0 + i * 7
        if i < n: rect(im, x, y, x + 3, y + 3, c); rect(im, x + 1, y + 4, x + 4, y + 4, INK, 190); rect(im, x + 4, y + 1, x + 4, y + 3, INK, 190)
        else: frame(im, x, y, x + 3, y + 3, (110, 106, 118), 230)

def marker(im, tx, ty, kind):
    """Bodies in the cone: hostile diamond, civilian circle, crew triangle, as outlined shapes above the head."""
    x, y = cx(tx), ty * TS - 4
    shapes = {
        'hostile': (HOSTILE, ['....x....', '...x.x...', '..x.x.x..', '.x.xxx.x.', 'x.xxxxx.x', '.x.xxx.x.', '..x.x.x..', '...x.x...', '....x....']),
        'civ': (CIV, ['...xxx...', '.xx...xx.', '.x.xxx.x.', 'x.xxxxx.x', 'x.xxxxx.x', 'x.xxxxx.x', '.x.xxx.x.', '.xx...xx.', '...xxx...']),
        'crew': (CREWBLUE, ['....x....', '...x.x...', '...x.x...', '..x.x.x..', '..x.x.x..', '.x.xxx.x.', '.x.xxx.x.', 'x.......x', 'xxxxxxxxx']),
    }
    c, rows = shapes[kind]
    glyph(im, rows, x - 4, y - 9, c)

def glyph_at_tile(im, tx, ty, name, c):
    rows = G[name]; glyph(im, rows, cx(tx) - len(rows[0]) // 2, cx(ty) - len(rows) // 2, c)

def cover_edge(im, tx, ty, side, flanked=False):
    """Half cover: a light-blue bar along the edge of the target's tile that the cover protects, with a soft glow and
    end ticks turned into the tile. Dashed grey when the shot comes from outside the 90-degree arc."""
    x0, y0 = tx * TS, ty * TS
    vertical = side in ('w', 'e')
    inward = {'w': (1, 0), 'e': (-1, 0), 'n': (0, 1), 's': (0, -1)}[side]
    edge = {'w': x0 + 1, 'e': x0 + TS - 2, 'n': y0 + 1, 's': y0 + TS - 2}[side]
    run = range((y0 if vertical else x0) + 2, (y0 if vertical else x0) + TS - 2)
    c = DIM if flanked else COVER
    for i, v in enumerate(run):
        if flanked and i % 5 >= 3: continue
        for w in range(3 if not flanked else 2):
            x, y = (edge + inward[0] * w, v) if vertical else (v, edge + inward[1] * w)
            put(im, x, y, c, 250)
        if not flanked:
            for w, a in ((3, 110), (4, 50), (-1, 110)):
                x, y = (edge + inward[0] * w, v) if vertical else (v, edge + inward[1] * w)
                put(im, x, y, c, a)
    if not flanked:
        for v in (run[0], run[-1]):
            for k in range(3, 7):
                x, y = (edge + inward[0] * k, v) if vertical else (v, edge + inward[1] * k)
                put(im, x, y, c, 235)
