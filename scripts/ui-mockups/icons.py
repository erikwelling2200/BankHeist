# HUD icons on a 24px grid (shown 1:1 at 24 CSS px, twice the detail of the old 12px set) and 48px portraits.
# Usage: python3 icons.py <out-dir>
# STYLE CARD: bone-white strokes, 2px for the main form and 1px for detail, a 1px ink shadow down-right, no fat
# outlines. Silhouettes of real objects (a walkie-talkie, a megaphone, a zip tie) rather than abstract symbols.
import sys, os, math, random
from PIL import Image, ImageDraw
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
BONE, INK = (242, 230, 200), (11, 13, 23)   # the game HUD's cream and night blue (src/style.css)
N = 24

def L(d, pts, w=2): d.line(pts, fill=BONE, width=w)
def R(d, b, w=2): d.rectangle(b, outline=BONE, width=w)
def F(d, b): d.rectangle(b, fill=BONE)
def E(d, b, w=2): d.ellipse(b, outline=BONE, width=w)
def FE(d, b): d.ellipse(b, fill=BONE)
def P(d, pts): d.polygon(pts, fill=BONE)
def PO(d, pts, w=2): d.line(pts + [pts[0]], fill=BONE, width=w)
def A(d, b, s, e, w=2): d.arc(b, s, e, fill=BONE, width=w)
def CUT(d, b): d.rectangle(b, fill=(0, 0, 0, 0))
def CUTP(d, pts): d.polygon(pts, fill=(0, 0, 0, 0))

def gun(d, parts):
    for b in parts: F(d, b)

ICONS = {
 'move': lambda d: (FE(d, (4, 2, 10, 11)), F(d, (5, 12, 9, 14)), FE(d, (13, 8, 19, 17)), F(d, (14, 18, 18, 20))),
 'dash': lambda d: (L(d, [(4, 5), (10, 12), (4, 19)]), L(d, [(12, 5), (18, 12), (12, 19)]), L(d, [(1, 9), (3, 9)], 1), L(d, [(0, 15), (3, 15)], 1)),
 'command': lambda d: (PO(d, [(3, 9), (8, 9), (16, 4), (16, 20), (8, 15), (3, 15)]), L(d, [(8, 15), (10, 21)]), L(d, [(19, 8), (22, 5)], 1), L(d, [(19, 12), (23, 12)], 1), L(d, [(19, 16), (22, 19)], 1)),
 'hold': lambda d: (F(d, (6, 11, 18, 19)), FE(d, (6, 15, 18, 22)), L(d, [(7, 4), (7, 12)]), L(d, [(10, 2), (10, 12)]), L(d, [(13, 2), (13, 12)]), L(d, [(16, 4), (16, 12)]), L(d, [(6, 16), (2, 11)])),
 'watch': lambda d: (L(d, [(3, 12), (21, 4)]), L(d, [(3, 12), (21, 20)]), A(d, (-15, -6, 21, 30), -25, 25), FE(d, (1, 10, 5, 14)), L(d, [(8, 12), (15, 12)], 1)),
 'ziptie': lambda d: (E(d, (2, 7, 11, 17)), E(d, (13, 7, 22, 17)), L(d, [(10, 12), (14, 12)]), F(d, (11, 9, 13, 10))),
 'knockout': lambda d: (F(d, (5, 9, 18, 20)), FE(d, (4, 8, 9, 13)), F(d, (17, 11, 20, 17)), L(d, [(9, 9), (9, 13)], 1) and None, CUT(d, (9, 9, 9, 12)), CUT(d, (13, 9, 13, 12)), L(d, [(6, 1), (7, 5)], 1), L(d, [(12, 0), (12, 5)], 1), L(d, [(18, 1), (17, 5)], 1)),
 'interact': lambda d: (E(d, (6, 6, 18, 18)), [F(d, (11 + round(8 * math.cos(a)) - 1, 11 + round(8 * math.sin(a)) - 1, 12 + round(8 * math.cos(a)), 12 + round(8 * math.sin(a)))) for a in [i * math.pi / 4 for i in range(8)]], FE(d, (10, 10, 14, 14))),
 'bag': lambda d: (FE(d, (3, 8, 21, 22)), F(d, (9, 4, 15, 9)), L(d, [(7, 4), (17, 4)]), CUT(d, (11, 12, 13, 19)), CUT(d, (9, 13, 15, 14)), CUT(d, (9, 17, 15, 18))),
 'throw': lambda d: (A(d, (2, 6, 22, 30), 200, 335, 2), P(d, [(22, 12), (16, 10), (20, 16)]), FE(d, (1, 15, 5, 19))),
 'reload': lambda d: (A(d, (4, 4, 20, 20), 40, 330), P(d, [(16, 2), (21, 7), (14, 9)]), F(d, (10, 9, 14, 15))),
 'mask': lambda d: (E(d, (5, 2, 19, 22)), F(d, (8, 9, 10, 11)), F(d, (14, 9, 16, 11)), L(d, [(10, 17), (14, 17)], 1), L(d, [(12, 3), (12, 7)], 1)),
 'revive': lambda d: (PO(d, [(9, 3), (15, 3), (15, 9), (21, 9), (21, 15), (15, 15), (15, 21), (9, 21), (9, 15), (3, 15), (3, 9), (9, 9)])),
 'grenade': lambda d: (FE(d, (5, 8, 19, 22)), F(d, (9, 4, 15, 8)), E(d, (15, 1, 20, 6), 1), CUT(d, (8, 13, 16, 13)), CUT(d, (8, 17, 16, 17))),
 'charge': lambda d: (F(d, (3, 8, 7, 21)), F(d, (9, 8, 13, 21)), F(d, (15, 8, 19, 21)), CUT(d, (3, 12, 19, 13)), F(d, (9, 4, 13, 6)), L(d, [(11, 4), (15, 1), (21, 3)], 1)),
 'attack': lambda d: (E(d, (4, 4, 20, 20)), L(d, [(12, 0), (12, 7)]), L(d, [(12, 17), (12, 23)]), L(d, [(0, 12), (7, 12)]), L(d, [(17, 12), (23, 12)]), F(d, (11, 11, 12, 12))),
 'suppress': lambda d: (L(d, [(2, 5), (14, 5)]), L(d, [(17, 5), (22, 5)]), L(d, [(5, 10), (22, 10)]), L(d, [(1, 15), (9, 15)]), L(d, [(12, 15), (21, 15)]), L(d, [(4, 20), (18, 20)])),
 'hack': lambda d: (R(d, (3, 4, 20, 15)), F(d, (1, 17, 22, 19)), L(d, [(6, 7), (9, 10), (6, 13)], 1), L(d, [(11, 13), (16, 13)], 1)),
 'drill': lambda d: (F(d, (2, 6, 13, 13)), P(d, [(13, 7), (22, 9), (22, 10), (13, 12)]), F(d, (5, 13, 9, 21)), F(d, (3, 20, 11, 22))),
 'wait': lambda d: (L(d, [(5, 2), (19, 2)]), L(d, [(5, 22), (19, 22)]), L(d, [(6, 3), (12, 12), (6, 21)]), L(d, [(18, 3), (12, 12), (18, 21)]), P(d, [(8, 21), (16, 21), (12, 16)])),
 'end': lambda d: (L(d, [(2, 12), (17, 12)]), P(d, [(12, 6), (19, 12), (12, 18)]), F(d, (20, 5, 22, 19))),
 'undo': lambda d: (A(d, (5, 6, 21, 22), 270, 450 + 0), L(d, [(4, 6), (13, 6)]), P(d, [(3, 6), (9, 1), (9, 11)])),
 'confirm': lambda d: (L(d, [(3, 12), (9, 18), (21, 5)], 3),),
 'layers': lambda d: (PO(d, [(12, 3), (22, 8), (12, 13), (2, 8)]), L(d, [(2, 12), (12, 17), (22, 12)]), L(d, [(2, 16), (12, 21), (22, 16)])),
 'map': lambda d: (PO(d, [(2, 5), (8, 3), (16, 6), (22, 4), (22, 19), (16, 21), (8, 18), (2, 20)]), L(d, [(8, 3), (8, 18)], 1), L(d, [(16, 6), (16, 21)], 1)),
 'bell': lambda d: (A(d, (5, 3, 19, 17), 180, 360), L(d, [(5, 10), (5, 17)]), L(d, [(19, 10), (19, 17)]), L(d, [(2, 18), (22, 18)]), F(d, (10, 20, 14, 22)), F(d, (11, 1, 13, 3))),
 'radio': lambda d: (L(d, [(7, 1), (7, 7)]), R(d, (5, 7, 18, 22)), F(d, (8, 10, 15, 13)), [F(d, (8 + i * 3, 16, 8 + i * 3, 19)) for i in range(3)]),
 'phone': lambda d: (P(d, [(3, 2), (8, 2), (10, 7), (7, 10), (14, 17), (17, 14), (22, 16), (22, 21), (18, 22), (10, 18), (5, 12), (2, 6)]),),
 'run': lambda d: (FE(d, (13, 1, 17, 5)), L(d, [(14, 7), (10, 14)], 3), L(d, [(13, 8), (18, 11), (21, 9)]), L(d, [(12, 8), (7, 9), (5, 12)]), L(d, [(10, 14), (14, 18), (13, 23)]), L(d, [(10, 14), (6, 18), (2, 18)])),
 'eye': lambda d: (A(d, (1, 5, 23, 25), 200, 340), A(d, (1, -1, 23, 19), 20, 160), FE(d, (8, 8, 16, 16)), CUT(d, (11, 11, 12, 12))),
 'ear': lambda d: (P(d, [(2, 9), (6, 9), (11, 5), (11, 19), (6, 15), (2, 15)]), A(d, (8, 6, 18, 18), -50, 50), A(d, (8, 2, 23, 22), -50, 50)),
 'clean': lambda d: (FE(d, (9, 1, 15, 7)), F(d, (8, 9, 16, 16)), L(d, [(8, 10), (5, 16)]), L(d, [(16, 10), (19, 16)]), F(d, (8, 16, 11, 23)), F(d, (13, 16, 16, 23))),
 'concealed': lambda d: (FE(d, (9, 1, 15, 7)), R(d, (7, 9, 17, 17)), L(d, [(7, 10), (4, 16)]), L(d, [(17, 10), (20, 16)]), F(d, (8, 17, 11, 23)), F(d, (13, 17, 16, 23)), F(d, (10, 12, 15, 13)), F(d, (10, 13, 11, 15))),
 'armed': lambda d: gun(d, [(1, 9, 22, 11), (4, 11, 9, 13), (14, 11, 16, 15), (1, 11, 4, 16), (17, 7, 19, 9)]),
 'heavy': lambda d: (FE(d, (5, 2, 19, 22)), CUT(d, (8, 9, 10, 11)), CUT(d, (14, 9, 16, 11)), CUT(d, (10, 16, 14, 17))),
 'loot': lambda d: (P(d, [(2, 20), (5, 15), (11, 15), (13, 20)]), P(d, [(11, 20), (14, 15), (20, 15), (22, 20)]), P(d, [(6, 14), (9, 9), (15, 9), (17, 14)])),
 'shield': lambda d: (PO(d, [(4, 3), (20, 3), (20, 13), (12, 22), (4, 13)]), L(d, [(12, 6), (12, 18)], 1)),
 'swat': lambda d: (A(d, (3, 3, 21, 25), 180, 360), F(d, (3, 13, 21, 15)), F(d, (6, 16, 18, 19)), CUT(d, (7, 17, 17, 18)), L(d, [(3, 13), (3, 20)])),
 'car': lambda d: (R(d, (2, 9, 21, 17)), L(d, [(6, 9), (8, 4), (16, 4), (18, 9)]), FE(d, (4, 15, 9, 20)), FE(d, (14, 15, 19, 20))),
 'skip': lambda d: (P(d, [(2, 5), (10, 12), (2, 19)]), P(d, [(10, 5), (18, 12), (10, 19)]), F(d, (19, 5, 21, 19))),
 'play': lambda d: (P(d, [(6, 4), (19, 12), (6, 20)]),),
 'ff': lambda d: (P(d, [(3, 5), (11, 12), (3, 19)]), P(d, [(12, 5), (20, 12), (12, 19)])),
 'rotl': lambda d: (A(d, (4, 4, 20, 20), 160, 450), P(d, [(1, 7), (8, 6), (5, 13)])),
 'rotr': lambda d: (A(d, (4, 4, 20, 20), 90, 380), P(d, [(23, 7), (16, 6), (19, 13)])),
 'flip': lambda d: (L(d, [(3, 18), (20, 18)]), L(d, [(5, 18), (5, 10)]), L(d, [(18, 18), (18, 10)]), L(d, [(3, 10), (20, 10)], 1), A(d, (8, 1, 20, 13), 200, 340, 1)),
 'pistol': lambda d: gun(d, [(3, 7, 21, 10), (3, 10, 9, 12), (4, 12, 8, 18), (9, 11, 11, 13)]),
 'smg': lambda d: gun(d, [(1, 8, 22, 11), (5, 11, 8, 18), (11, 11, 13, 16), (1, 6, 5, 8)]),
 'shotgun': lambda d: gun(d, [(1, 9, 22, 11), (12, 11, 19, 13), (1, 11, 6, 15), (1, 15, 3, 17)]),
 'lmg': lambda d: gun(d, [(1, 8, 23, 11), (7, 11, 13, 16), (15, 11, 16, 14), (19, 11, 20, 18), (17, 11, 18, 18), (1, 11, 4, 15)]),
 'dmr': lambda d: gun(d, [(1, 10, 23, 12), (8, 5, 16, 7), (11, 7, 12, 9), (1, 12, 5, 16), (12, 12, 13, 16)]),
 'vest': lambda d: (P(d, [(4, 3), (9, 3), (12, 6), (15, 3), (20, 3), (21, 21), (3, 21)]), CUT(d, (6, 10, 18, 11)), CUT(d, (6, 15, 18, 16))),
 'kit': lambda d: (R(d, (2, 8, 21, 20)), R(d, (8, 4, 15, 8), 1), F(d, (2, 12, 21, 13))),
 'medkit': lambda d: (F(d, (2, 7, 21, 20)), F(d, (8, 4, 15, 7)), CUT(d, (10, 9, 13, 18)), CUT(d, (7, 12, 16, 15))),
 'star': lambda d: ([L(d, [(12, 12), (12 + round(10 * math.cos(a)), 12 + round(10 * math.sin(a)))], 1 if i % 2 else 2) for i, a in enumerate([j * math.pi / 4 for j in range(8)])], CUT(d, (9, 9, 14, 14))),
 'heat': lambda d: (P(d, [(12, 1), (17, 8), (19, 13), (17, 19), (12, 22), (7, 19), (5, 13), (8, 9), (10, 12)]), CUTP(d, [(12, 11), (15, 16), (12, 20), (9, 16)])),
 'fork': lambda d: (L(d, [(6, 2), (6, 9)], 1), L(d, [(8, 2), (8, 9)], 1), L(d, [(10, 2), (10, 9)], 1), F(d, (6, 9, 10, 11)), F(d, (7, 11, 9, 22)), P(d, [(15, 2), (18, 2), (18, 22), (16, 22), (16, 13), (14, 12)])),
 'cart': lambda d: (L(d, [(1, 4), (4, 4), (7, 16), (19, 16)]), R(d, (5, 7, 20, 13), 1), FE(d, (7, 18, 10, 21)), FE(d, (16, 18, 19, 21))),
 'truck': lambda d: (F(d, (1, 6, 15, 17)), F(d, (15, 9, 22, 17)), CUT(d, (17, 10, 20, 12)), FE(d, (3, 15, 8, 20)), FE(d, (15, 15, 20, 20)), CUT(d, (4, 9, 12, 10))),
 'moon': lambda d: (FE(d, (3, 3, 21, 21)), d.ellipse((8, 0, 24, 16), fill=(0, 0, 0, 0))),
 'police': lambda d: (PO(d, [(12, 2), (21, 6), (19, 17), (12, 22), (5, 17), (3, 6)]), FE(d, (9, 8, 15, 14))),
 'chat': lambda d: (R(d, (2, 3, 21, 15)), P(d, [(6, 15), (11, 15), (6, 20)]), L(d, [(6, 7), (17, 7)], 1), L(d, [(6, 11), (14, 11)], 1)),
 'swap': lambda d: (L(d, [(2, 8), (19, 8)]), P(d, [(16, 4), (21, 8), (16, 12)]), L(d, [(5, 16), (22, 16)]), P(d, [(8, 12), (3, 16), (8, 20)])),
 'lock': lambda d: (A(d, (6, 2, 18, 16), 180, 360), L(d, [(6, 9), (6, 11)]), L(d, [(18, 9), (18, 11)]), F(d, (4, 11, 20, 22)), CUT(d, (11, 14, 13, 18))),
 'skull': lambda d: (FE(d, (4, 2, 20, 17)), F(d, (8, 15, 16, 21)), CUT(d, (7, 8, 10, 11)), CUT(d, (14, 8, 17, 11)), CUT(d, (11, 13, 13, 14)), CUT(d, (10, 18, 10, 21)), CUT(d, (13, 18, 13, 21))),
 'dollar': lambda d: (L(d, [(12, 1), (12, 23)], 1), A(d, (6, 4, 17, 12), 90, 330), A(d, (7, 11, 18, 19), 270, 510 - 0)),
 'lockpick': lambda d: (L(d, [(3, 20), (15, 8)]), L(d, [(15, 8), (21, 8)]), L(d, [(5, 21), (17, 9)], 1)),
}

def make(name, fn):
    im = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    fn(ImageDraw.Draw(im))
    a = im.split()[3]
    sh = Image.new('RGBA', (N, N), INK + (0,)); sh.putalpha(a.point(lambda v: 200 if v else 0))
    out = Image.new('RGBA', (N, N), (0, 0, 0, 0)); out.alpha_composite(sh, (1, 1)); out.alpha_composite(im)
    out.save(os.path.join(OUT, f'i-{name}.png'))

for k, fn in ICONS.items(): make(k, fn)

# ---------------------------------------------------------------- portraits, 48px, one hard key light from the left
SK = [(206, 152, 116), (168, 112, 80), (112, 74, 54), (222, 182, 146)]
def shade(c, k): return tuple(max(0, min(255, int(v * k))) for v in c)

def portrait(seed, skin, hair, shirt, style='short', mask=None, accent=(150, 150, 150), scar=False, stubble=False):
    rnd = random.Random(seed)
    im = Image.new('RGB', (48, 48)); p = im.load()
    for y in range(48):
        for x in range(48):
            v = 26 + int(10 * (1 - y / 48)) + rnd.randint(-2, 2)
            p[x, y] = (v, v - 2, v + 3)
    s = skin if isinstance(skin, tuple) else SK[skin]
    lit, mid, dark = shade(s, 1.08), shade(s, 0.86), shade(s, 0.58)
    cxf, cyf = 24, 23
    # neck and shoulders
    for y in range(32, 48):
        for x in range(48):
            if abs(x - 24) < 6 and y < 40: p[x, y] = dark if x > 25 else mid
            sh_w = 10 + (y - 34) * 1.6
            if y >= 37 and abs(x - 24) < sh_w:
                c = shirt if x < 24 else shade(shirt, 0.62)
                if abs(x - 24) < 4 and y < 42: c = shade(shirt, 0.45)
                p[x, y] = c
    # face: an egg, lit from the left, hard terminator
    for y in range(8, 38):
        for x in range(10, 38):
            dx, dy = (x - cxf) / 11.5, (y - cyf) / (14 if y > cyf else 13)
            if dx * dx + dy * dy <= 1:
                t = x - cxf + (y - cyf) * 0.15
                c = lit if t < -3 else (mid if t < 4 else dark)
                if y > 33: c = dark
                p[x, y] = c
    # eye sockets, brows, nose shadow, mouth
    for (ex, side) in ((19, -1), (29, 1)):
        for y in range(20, 23):
            for x in range(ex - 3, ex + 3): p[x, y] = shade(s, 0.55 if side > 0 else 0.68)
        p[ex - 1, 21] = (240, 236, 226); p[ex, 21] = (24, 20, 22)
        for x in range(ex - 3, ex + 3): p[x, 19] = shade(hair, 0.8)
    for y in range(22, 29): p[26, y] = dark
    p[25, 29] = dark; p[26, 29] = dark; p[24, 29] = mid
    for x in range(21, 28): p[x, 32] = shade(s, 0.45)
    if stubble:
        for y in range(29, 37):
            for x in range(14, 35):
                if p[x, y] in (lit, mid, dark) and rnd.random() < 0.35: p[x, y] = shade(p[x, y], 0.72)
    if scar:
        for i in range(6): p[16 + i // 2, 24 + i] = shade(s, 0.5)
    # hair
    def hair_px(x, y, k=1.0): p[x, y] = shade(hair, k * (1.25 if x < 20 else 0.85) * (0.9 + rnd.random() * 0.2))
    if style == 'short':
        for y in range(6, 16):
            for x in range(11, 37):
                if ((x - 24) / 13) ** 2 + ((y - 15) / 9) ** 2 <= 1 and y < 13 + abs(x - 24) // 5: hair_px(x, y)
    elif style == 'long':
        for y in range(5, 42):
            for x in range(8, 40):
                d = ((x - 24) / 15) ** 2 + ((y - 16) / 11) ** 2
                if (d <= 1 and y < 14) or ((x < 13 or x > 34) and 10 < y < 42 and abs(x - 24) < 16): hair_px(x, y)
    elif style == 'bun':
        for y in range(2, 15):
            for x in range(11, 37):
                if (((x - 24) / 13) ** 2 + ((y - 14) / 10) ** 2 <= 1 and y < 13) or ((x - 24) ** 2 + (y - 5) ** 2 < 16): hair_px(x, y)
    elif style == 'ponytail':
        for y in range(6, 15):
            for x in range(11, 37):
                if ((x - 24) / 13) ** 2 + ((y - 15) / 9) ** 2 <= 1 and y < 12 + abs(x - 24) // 6: hair_px(x, y)
        for y in range(14, 40):
            for x in range(34, 40):
                if abs(x - (36 + (y - 14) // 10)) < 2 + (1 if 20 < y < 32 else 0): hair_px(x, y, 0.8)
    elif style == 'buzz':
        for y in range(8, 14):
            for x in range(12, 36):
                if ((x - 24) / 12) ** 2 + ((y - 15) / 8) ** 2 <= 1 and rnd.random() < 0.85: hair_px(x, y, 0.8)
    elif style == 'bald':
        for x in range(14, 22): p[x, 11] = shade(lit, 1.1)
    elif style in ('cap', 'police'):
        cc = (28, 36, 60) if style == 'cap' else (20, 26, 52)
        for y in range(5, 15):
            for x in range(10, 38):
                if ((x - 24) / 14) ** 2 + ((y - 14) / 10) ** 2 <= 1: p[x, y] = shade(cc, 1.2 if x < 22 else 0.85)
        for x in range(9, 39): p[x, 15] = shade(cc, 0.6); p[x, 16] = (14, 14, 18)
        for y in range(8, 12):
            for x in range(22, 26): p[x, y] = (196, 164, 76) if y < 11 else (140, 112, 50)
    elif style == 'helmet':
        for y in range(3, 22):
            for x in range(8, 40):
                if ((x - 24) / 16) ** 2 + ((y - 17) / 14) ** 2 <= 1 and y < 21: p[x, y] = shade((44, 48, 54), 1.2 if x < 22 else 0.8)
        for y in range(18, 23):
            for x in range(12, 36): p[x, y] = (18, 22, 30) if y > 18 else (70, 90, 110)
    # masks: four different real objects, the crew colour only as a stripe or thread
    if mask == 'balaclava':
        for y in range(6, 40):
            for x in range(10, 38):
                if ((x - 24) / 13) ** 2 + ((y - 22) / 17) ** 2 <= 1: p[x, y] = shade((34, 34, 40), 1.25 if x < 22 else 0.85)
        for y in range(19, 24):
            for x in range(15, 33): p[x, y] = shade(s, 0.9 if x < 24 else 0.6)
        for x in range(15, 33): p[x, 18] = accent; p[x, 24] = shade(accent, 0.7)
        p[18, 21] = (24, 20, 22); p[29, 21] = (24, 20, 22)
    elif mask == 'hockey':
        for y in range(8, 38):
            for x in range(11, 37):
                if ((x - 24) / 12) ** 2 + ((y - 23) / 15) ** 2 <= 1: p[x, y] = shade((210, 204, 190), 1.0 if x < 22 else 0.72)
        for (hx, hy) in ((18, 21), (29, 21)):
            for y in range(hy - 1, hy + 2):
                for x in range(hx - 2, hx + 3): p[x, y] = (16, 14, 18)
        for (hx, hy) in ((20, 30), (24, 31), (28, 30), (22, 34), (26, 34), (17, 27), (31, 27)): p[hx, hy] = (40, 36, 40)
        for y in range(9, 37): p[24, y] = accent if y % 3 else shade(accent, 0.7)
    elif mask == 'skull':
        for y in range(26, 40):
            for x in range(11, 37):
                if abs(x - 24) < 13 - max(0, y - 34): p[x, y] = shade((30, 30, 34), 1.2 if x < 22 else 0.85)
        for x in range(14, 35):
            if x % 3 == 0: p[x, 31] = (210, 204, 190); p[x, 32] = (170, 164, 150)
        for x in range(16, 33): p[x, 27] = shade(accent, 0.9)
        for y in range(19, 24):
            for x in range(16, 22): p[x, y] = (18, 16, 20) if (x - 19) ** 2 + (y - 21) ** 2 < 8 else p[x, y]
            for x in range(27, 33): p[x, y] = (18, 16, 20) if (x - 30) ** 2 + (y - 21) ** 2 < 8 else p[x, y]
    elif mask == 'gas':
        for y in range(16, 38):
            for x in range(12, 36):
                if ((x - 24) / 12) ** 2 + ((y - 26) / 11) ** 2 <= 1: p[x, y] = shade((40, 44, 40), 1.2 if x < 22 else 0.8)
        for (gx, gy) in ((19, 22), (29, 22)):
            for y in range(gy - 3, gy + 3):
                for x in range(gx - 3, gx + 3):
                    if (x - gx) ** 2 + (y - gy) ** 2 < 9: p[x, y] = (60, 84, 92) if x < gx else (30, 44, 52)
        for y in range(29, 37):
            for x in range(20, 29): p[x, y] = shade((60, 62, 58), 1.1 if x < 24 else 0.8)
        for x in range(20, 29): p[x, 33] = shade(accent, 0.8)
        for x in range(10, 38): p[x, 18] = (20, 20, 22)
    # vignette and a hairline frame of the background
    for y in range(48):
        for x in range(48):
            v = ((x - 22) / 30) ** 2 + ((y - 20) / 30) ** 2
            if v > 0.55: p[x, y] = shade(p[x, y], max(0.55, 1.25 - v))
    return im

CREWC = {'mara': (96, 192, 206), 'jun': (206, 116, 184), 'dex': (150, 132, 224), 'sol': (218, 200, 162)}

# Faces and clothes from the game's own ramps (src/art/palette.ts) and looks (src/art/bank/people.ts), so a portrait is
# the same person as the sprite in the bank: the ramp's light step for skin, the top step for hair, a middle one for cloth.
def hexc(v): return ((v >> 16) & 255, (v >> 8) & 255, v & 255)
SKIN = {'pale': hexc(0xc89a80), 'tan': hexc(0xb07e60), 'brown': hexc(0x84553f), 'dark': hexc(0x583630)}
HAIR = {'black': hexc(0x2c2630), 'brown': hexc(0x5c3e30), 'auburn': hexc(0x80402e), 'grey': hexc(0xa3a0a2), 'blond': hexc(0xbca06a)}
CLOTH = {'olive': hexc(0x3d4e36), 'black': hexc(0x2e2a34), 'charcoal': hexc(0x302e37), 'guard': hexc(0x2d3a56), 'skyShirt': hexc(0x86a0b6),
         'navy': hexc(0x29324c), 'teal': hexc(0x2a5254), 'beige': hexc(0x9c8160), 'grey': hexc(0x55565b)}
LOOK = {
    'mara': (1, SKIN['pale'], HAIR['auburn'], CLOTH['olive'], 'ponytail', {}),
    'jun': (2, SKIN['tan'], HAIR['black'], CLOTH['black'], 'short', {}),
    'dex': (3, SKIN['pale'], HAIR['brown'], CLOTH['charcoal'], 'buzz', {'stubble': True, 'scar': True}),
    'sol': (4, SKIN['brown'], HAIR['black'], CLOTH['olive'], 'buzz', {'stubble': True}),
}
MASK = {'mara': 'balaclava', 'jun': 'hockey', 'dex': 'skull', 'sol': 'gas'}
P = {}
for who, (seed, skin, hair, cloth, style, extra) in LOOK.items():
    P[who] = portrait(seed, skin, hair, cloth, style, **extra)
    P[who + '-m'] = portrait(seed, skin, hair, cloth, style, mask=MASK[who], accent=CREWC[who], **extra)
P.update({
 'guard': portrait(5, SKIN['brown'], HAIR['black'], CLOTH['guard'], 'cap'),
 'teller': portrait(6, SKIN['tan'], HAIR['brown'], CLOTH['skyShirt'], 'bun'),
 'manager': portrait(7, SKIN['tan'], HAIR['grey'], CLOTH['navy'], 'short'),
 'cleaner': portrait(8, SKIN['dark'], HAIR['black'], CLOTH['teal'], 'bun'),
 'customer': portrait(9, SKIN['tan'], HAIR['black'], CLOTH['beige'], 'long'),
 'police': portrait(10, SKIN['tan'], HAIR['brown'], CLOTH['navy'], 'police'),
 'swat': portrait(11, SKIN['pale'], HAIR['brown'], CLOTH['charcoal'], 'helmet'),
 'operator': portrait(12, SKIN['pale'], HAIR['brown'], CLOTH['charcoal'], 'buzz', stubble=True),
 'negotiator': portrait(13, SKIN['brown'], HAIR['grey'], CLOTH['grey'], 'short'),
})
for k, im in P.items(): im.save(os.path.join(OUT, f'p-{k}.png'))
print(len(ICONS), 'icons', len(P), 'portraits')
