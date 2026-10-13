# BankHeist UI mockup renderer: the top-down city branch on the 16px grid, its props and its cast. The world-space UI
# drawn over it lives in ui2.py at twice this resolution; the screen-space HUD is HTML in the mockups.
# STYLE CARD
# - Top-down, 16px tiles. Walls show a top and, where they face the viewer (south), a 6px face carrying the material:
#   plaster seams (Soft), brick courses (Reinforced), rivets (Vault), pale blue panes (Glass).
# - Zones live in the floor: public = green marble checker + red carpet runner, staff = pale blue-grey linoleum,
#   secure = bare concrete with expansion joints, vault = steel plate.
# - Muted, hue-shifted ramps; darks drift violet, lights drift warm. No black outlines on the world, only on figures.
# - World UI uses a fixed signal palette that never appears in the art: safe green, amber, red, unknown grey, crew colours.
#   Every signal is shape + colour (hatching, icons), never colour alone.
import math
from PIL import Image

T = 16
W, H = 48, 32
SAFE, AMBER, RED, GREY = (70, 200, 110), (240, 168, 40), (232, 64, 52), (120, 120, 132)
WHITE, INK = (240, 236, 226), (14, 12, 20)
CREW = {'mara': (84, 214, 232), 'jun': (232, 112, 214), 'dex': (150, 128, 255), 'sol': (240, 226, 196)}
HOSTILE, CIV, CREWBLUE = (232, 64, 52), (236, 236, 236), (84, 160, 255)

def ramp(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)

def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

# ---------------------------------------------------------------- map
grid = [['a'] * W for _ in range(H)]
def fill(x0, y0, x1, y1, ch):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1): grid[y][x] = ch
def hline(x0, x1, y, ch): fill(x0, y, x1, y, ch)
def vline(x, y0, y1, ch): fill(x, y0, x, y1, ch)

fill(0, 24, W - 1, 25, 'w'); hline(0, W - 1, 26, 'k'); fill(0, 27, W - 1, 31, 'r')
fill(1, 1, 46, 23, '#')
fill(2, 2, 8, 6, ':'); vline(9, 1, 7, '#'); hline(1, 9, 7, '#'); grid[5][9] = 'M'              # CCTV room
fill(10, 2, 13, 4, ':'); vline(14, 1, 5, '#'); hline(10, 14, 5, '#'); grid[5][12] = 'M'         # alarm closet
fill(17, 2, 28, 6, '='); vline(16, 1, 7, 'V'); vline(29, 1, 7, 'V'); hline(16, 29, 7, 'V'); hline(16, 29, 1, 'V')
grid[7][22] = 'Y'; grid[7][23] = 'Y'                                                            # vault door
fill(30, 2, 36, 6, ':'); vline(37, 1, 7, '#'); hline(30, 37, 7, '#'); grid[7][33] = 'M'         # deposit boxes
fill(38, 2, 45, 6, ','); hline(38, 46, 7, 's'); grid[7][41] = 'D'                               # break room
fill(10, 6, 15, 9, ':'); fill(15, 8, 33, 9, ':')                                                 # secure corridor
vline(34, 8, 9, 's'); grid[8][34] = 'M'; fill(35, 8, 45, 9, ',')                                # mantrap, staff corridor
fill(2, 8, 8, 13, ','); vline(9, 8, 14, 's'); hline(1, 9, 14, 's'); grid[11][9] = 'D'           # manager office
hline(10, 45, 10, 's'); grid[10][20] = 'M'; grid[10][40] = 'D'
fill(10, 11, 45, 14, ',')                                                                       # behind the counter
hline(10, 11, 15, 's'); hline(12, 38, 15, 'T'); grid[15][39] = 's'; grid[15][40] = 'D'; hline(41, 45, 15, 's')
fill(2, 16, 45, 22, '.'); fill(2, 15, 8, 15, '.'); grid[15][9] = 's'
fill(41, 16, 45, 18, 'R'); vline(40, 16, 19, 's'); hline(40, 45, 19, 's'); grid[18][40] = 'D'    # restroom
fill(22, 16, 25, 22, 'c')                                                                       # carpet runner
for x in range(2, 46): grid[23][x] = 'G'
for x in (8, 15, 30, 37): grid[23][x] = '#'
for x in range(22, 26): grid[23][x] = 'E'

ZONE = {'.': 'public', 'c': 'public', 'R': 'public', ',': 'staff', ':': 'secure', '=': 'secure'}
WALLS = set('#sVGMDYTE')

def is_wall(x, y):
    if not (0 <= x < W and 0 <= y < H): return True
    return grid[y][x] in '#sVGMDY'

def blocks_sight(x, y):
    if not (0 <= x < W and 0 <= y < H): return True
    return grid[y][x] in '#sVMDY'

# ---------------------------------------------------------------- floor and wall art
import random
rnd = random.Random(7)
PAL = dict(
    mar1=(74, 96, 86), mar2=(56, 76, 70), vein=(98, 116, 106), grout=(40, 52, 50),
    rug=(118, 40, 50), rug2=(92, 30, 40), rug3=(150, 64, 66),
    lino=(150, 160, 172), lino2=(136, 146, 160), linoj=(118, 126, 142),
    conc=(112, 110, 108), conc2=(98, 96, 96), concj=(82, 80, 84),
    steel=(96, 104, 116), steel2=(80, 88, 100), rivet=(140, 148, 160),
    rest=(170, 176, 170), rest2=(150, 158, 154),
    walk=(128, 122, 112), walk2=(110, 104, 98), curb=(150, 146, 136),
    road=(52, 54, 62), road2=(46, 48, 56), lane=(196, 176, 96),
    alley=(60, 58, 64), alley2=(52, 50, 58),
    wtop=(44, 38, 52), wtop2=(58, 50, 66),
    plaster=(176, 164, 146), plaster2=(150, 138, 124),
    brick=(124, 70, 60), brick2=(98, 54, 50), mortar=(70, 54, 56),
    vface=(92, 98, 112), vface2=(70, 76, 90),
    glass=(150, 196, 214), glass2=(110, 156, 180), glasshi=(214, 236, 240),
    wood=(108, 70, 48), wood2=(86, 54, 38), wood3=(132, 92, 62),
    counter=(160, 150, 136), counter2=(120, 110, 100), marbletop=(196, 190, 176),
    leaf=(60, 104, 70), leaf2=(40, 74, 54), pot=(120, 74, 52),
    metal=(150, 154, 164), metal2=(100, 104, 116), dark=(30, 28, 38),
    screen=(90, 170, 150), screen2=(50, 110, 100),
)

def floor_px(ch, x, y, px, py):
    gx, gy = x * T + px, y * T + py
    if ch in '.':
        c = PAL['mar1'] if (x + y) % 2 == 0 else PAL['mar2']
        if px == 0 or py == 0: return PAL['grout']
        v = abs(math.sin((gx * 0.21 + gy * 0.13 + math.sin(gy * 0.07) * 3))) < 0.08
        return mix(c, PAL['vein'], 0.55) if v else c
    if ch == 'c':
        if x in (22, 25) and ((x == 22 and px < 2) or (x == 25 and px > 13)): return PAL['rug3']
        return PAL['rug'] if (gx // 2 + gy // 2) % 7 else PAL['rug2']
    if ch == ',':
        if py == 0 or px == 0: return PAL['linoj']
        return PAL['lino'] if (x * 3 + y) % 4 else PAL['lino2']
    if ch == ':':
        if (x % 3 == 0 and px == 0) or (y % 3 == 0 and py == 0): return PAL['concj']
        return PAL['conc'] if rnd.random() > 0.12 else PAL['conc2']
    if ch == '=':
        if px == 0 or py == 0: return PAL['steel2']
        if px in (2, 13) and py in (2, 13): return PAL['rivet']
        return PAL['steel']
    if ch == 'R':
        if px % 8 == 0 or py % 8 == 0: return PAL['rest2']
        return PAL['rest']
    if ch == 'w':
        if px == 0 or py == 0: return PAL['walk2']
        return PAL['walk']
    if ch == 'k': return PAL['curb'] if py < 5 else PAL['road2']
    if ch == 'r':
        if y == 29 and py in (7, 8) and (gx // 12) % 2 == 0: return PAL['lane']
        return PAL['road'] if rnd.random() > 0.1 else PAL['road2']
    if ch == 'a': return PAL['alley'] if rnd.random() > 0.15 else PAL['alley2']
    return PAL['mar1']

def wall_face(ch):
    return {'#': 'brick', 's': 'plaster', 'V': 'vface', 'M': 'metal', 'D': 'wood', 'Y': 'steel'}.get(ch, 'brick')

def render_base():
    im = Image.new('RGB', (W * T, H * T)); p = im.load()
    for y in range(H):
        for x in range(W):
            ch = grid[y][x]
            under = '.' if ch in 'GETs#MD' and y >= 15 else ch
            for py in range(T):
                for px in range(T):
                    if ch in WALLS: base = floor_px(nearest_floor(x, y), x, y, px, py)
                    else: base = floor_px(ch, x, y, px, py)
                    p[x * T + px, y * T + py] = base
            if ch in WALLS: draw_wall(p, x, y, ch)
    return im

def nearest_floor(x, y):
    for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < W and 0 <= ny < H and grid[ny][nx] not in WALLS: return grid[ny][nx]
    return 'a'

def draw_wall(p, x, y, ch):
    ox, oy = x * T, y * T
    below = grid[y + 1][x] if y + 1 < H else 'a'
    face = below not in WALLS
    if ch == 'G' or ch == 'E':
        for py in range(5, 11):
            for px in range(T):
                c = PAL['glass'] if (px + py) % 9 else PAL['glasshi']
                if ch == 'E' and px in (0, 15): c = PAL['metal2']
                if py in (5, 10): c = PAL['metal2']
                p[ox + px, oy + py] = c
        return
    if ch == 'T':
        for py in range(3, 16):
            for px in range(T):
                if py < 5: c = PAL['glasshi'] if px % 5 else PAL['glass2']
                elif py < 6: c = PAL['metal2']
                elif py < 11: c = PAL['marbletop'] if py > 6 else PAL['counter2']
                else: c = PAL['wood'] if py < 15 else PAL['wood2']
                p[ox + px, oy + py] = c
        return
    if ch == 'D' or ch == 'M' or ch == 'Y':
        open_v = grid[y - 1][x] not in WALLS and below not in WALLS
        mat = {'D': PAL['wood'], 'M': PAL['metal2'], 'Y': PAL['steel2']}[ch]
        hi = {'D': PAL['wood3'], 'M': PAL['metal'], 'Y': PAL['rivet']}[ch]
        for py in range(T):
            for px in range(T):
                if open_v:
                    if 6 <= py <= 9: p[ox + px, oy + py] = hi if py == 6 else mat
                else:
                    if 6 <= px <= 9: p[ox + px, oy + py] = hi if px == 6 else mat
        return
    top_h = 10 if face else T
    for py in range(T):
        for px in range(T):
            if py < top_h:
                c = PAL['wtop2'] if (py == 0 or px == 0) else PAL['wtop']
            else:
                fy = py - top_h; m = wall_face(ch)
                if m == 'brick': c = PAL['mortar'] if fy % 3 == 2 or (px + (fy // 3) * 4) % 8 == 7 else (PAL['brick'] if (px + fy) % 5 else PAL['brick2'])
                elif m == 'plaster': c = PAL['plaster2'] if px % 8 == 0 or fy == 5 else PAL['plaster']
                elif m == 'vface': c = PAL['rivet'] if px % 5 == 2 and fy == 2 else (PAL['vface2'] if fy == 5 else PAL['vface'])
                else: c = PAL['metal']
            p[ox + px, oy + py] = c

# ---------------------------------------------------------------- props
def rect(p, x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1): p[x, y] = c

def desk(p, tx, ty, w=2, pc=True):
    ox, oy = tx * T, ty * T
    rect(p, ox + 1, oy + 4, ox + w * T - 2, oy + 13, PAL['wood']); rect(p, ox + 1, oy + 4, ox + w * T - 2, oy + 5, PAL['wood3'])
    rect(p, ox + 1, oy + 13, ox + w * T - 2, oy + 14, PAL['wood2'])
    if pc:
        rect(p, ox + 4, oy + 5, ox + 10, oy + 9, PAL['dark']); rect(p, ox + 5, oy + 6, ox + 9, oy + 8, PAL['screen'])
    rect(p, ox + 14, oy + 7, ox + 20, oy + 10, (210, 204, 186))

def plant(p, tx, ty):
    ox, oy = tx * T, ty * T
    rect(p, ox + 4, oy + 9, ox + 11, oy + 14, PAL['pot'])
    for (dx, dy) in ((8, 3), (5, 5), (11, 5), (8, 6), (6, 8), (10, 8), (8, 9)):
        rect(p, ox + dx - 2, oy + dy - 2, ox + dx + 1, oy + dy + 1, PAL['leaf'] if (dx + dy) % 3 else PAL['leaf2'])

def bench(p, tx, ty, w=3):
    ox, oy = tx * T, ty * T
    rect(p, ox + 1, oy + 5, ox + w * T - 2, oy + 11, PAL['wood']); rect(p, ox + 1, oy + 5, ox + w * T - 2, oy + 6, PAL['wood3'])

def console(p, tx, ty, w):
    ox, oy = tx * T, ty * T
    rect(p, ox, oy + 2, ox + w * T - 1, oy + 9, PAL['dark'])
    for i in range(w * 2):
        rect(p, ox + i * 8 + 1, oy + 3, ox + i * 8 + 6, oy + 7, PAL['screen'] if i % 3 else PAL['screen2'])
    rect(p, ox, oy + 10, ox + w * T - 1, oy + 12, PAL['metal2'])

def panel(p, tx, ty, c=(200, 60, 50)):
    ox, oy = tx * T, ty * T
    rect(p, ox + 3, oy + 1, ox + 12, oy + 9, PAL['metal']); rect(p, ox + 5, oy + 3, ox + 10, oy + 6, PAL['dark'])
    p[ox + 6, oy + 4] = c; p[ox + 8, oy + 4] = (90, 200, 90)

def deposit_wall(p):
    for tx in range(30, 37):
        ox, oy = tx * T, 2 * T
        for py in range(0, 10):
            for px in range(T):
                p[ox + px, oy + py] = PAL['metal2'] if (px % 4 == 0 or py % 3 == 0) else PAL['metal']

def gold(p, tx, ty):
    ox, oy = tx * T, ty * T
    for i, (dx, dy) in enumerate(((2, 4), (8, 4), (5, 8), (2, 11), (8, 11))):
        rect(p, ox + dx, oy + dy, ox + dx + 5, oy + dy + 2, (226, 182, 72)); rect(p, ox + dx, oy + dy, ox + dx + 5, oy + dy, (250, 226, 150))

def cash(p, tx, ty):
    ox, oy = tx * T, ty * T
    rect(p, ox + 3, oy + 5, ox + 12, oy + 12, (60, 70, 60)); rect(p, ox + 4, oy + 6, ox + 11, oy + 7, (110, 150, 100))
    rect(p, ox + 6, oy + 3, ox + 9, oy + 5, (40, 44, 40))

def van(p, tx, ty, body=(70, 76, 86), w=4, h=2, roof=None):
    ox, oy = tx * T, ty * T
    rect(p, ox + 1, oy + 1, ox + w * T - 2, oy + h * T - 2, ramp(body, 0.75))
    rect(p, ox + 2, oy + 2, ox + w * T - 3, oy + h * T - 4, body)
    rect(p, ox + w * T - 12, oy + 4, ox + w * T - 5, oy + h * T - 6, PAL['glass2'])
    rect(p, ox + 6, oy + 6, ox + w * T - 18, oy + h * T - 8, roof or ramp(body, 1.15))

def camera_prop(p, tx, ty, d):
    ox, oy = tx * T + 8, ty * T + 8
    rect(p, ox - 3, oy - 2, ox + 2, oy + 1, PAL['dark'])
    dx, dy = d
    rect(p, ox + dx * 3 - 1, oy + dy * 3 - 1, ox + dx * 3, oy + dy * 3, (220, 60, 50))

def render_world():
    im = render_base(); p = im.load()
    console(p, 2, 2, 4); panel(p, 7, 2, (90, 90, 90)); rect(p, 7 * T + 3, 2 * T + 1, 7 * T + 12, 2 * T + 9, PAL['dark'])   # recorder
    panel(p, 11, 2); panel(p, 13, 2, (240, 200, 60))   # alarm panel, breaker
    deposit_wall(p)
    for (gx, gy) in ((18, 3), (20, 3), (25, 3), (27, 3)): gold(p, gx, gy)
    for (gx, gy) in ((18, 5), (19, 5), (26, 5), (27, 5)): cash(p, gx, gy)
    desk(p, 4, 9, 3); plant(p, 2, 12)
    for tx in (13, 18, 23, 28, 33): desk(p, tx, 12, 2, pc=True)
    bench(p, 39, 3, 4); desk(p, 42, 5, 2, pc=False)
    plant(p, 2, 16); plant(p, 2, 22); plant(p, 45, 22); plant(p, 21, 22); plant(p, 26, 22)
    bench(p, 5, 19, 3); bench(p, 34, 19, 3); desk(p, 13, 19, 2, pc=False); desk(p, 29, 19, 2, pc=False)
    rect(p, 2 * T + 2, 18 * T, 2 * T + 13, 18 * T + 14, PAL['metal2']); rect(p, 2 * T + 4, 18 * T + 2, 2 * T + 11, 18 * T + 7, PAL['screen'])  # ATM
    for ty in range(17, 22):
        for tx in (21, 26):
            rect(p, tx * T + 7, ty * T + 6, tx * T + 9, ty * T + 9, (180, 150, 80))
    for (tx, ty) in ((43, 16), (43, 17)): rect(p, tx * T + 3, ty * T + 2, tx * T + 12, ty * T + 12, (230, 232, 230))
    camera_prop(p, 2, 15, (1, 1)); camera_prop(p, 45, 11, (-1, 1)); camera_prop(p, 15, 6, (1, 1))
    return light(im)

LAMPS = [(5, 4, 4), (12, 3, 3), (22, 4, 5), (33, 4, 4), (41, 4, 4), (5, 11, 4), (16, 12, 5), (28, 12, 5), (40, 12, 5),
         (8, 18, 6), (18, 18, 6), (30, 18, 6), (40, 20, 5), (43, 17, 3), (22, 8, 6), (40, 8, 4)]
def light(im):
    """Banded light map: cool ambient, warm lamp pools, daylight through the front glass. Dither only at band edges."""
    p = im.load(); bands = (0.72, 0.84, 0.96, 1.06)
    for y in range(im.height):
        for x in range(im.width):
            tx, ty = x / T, y / T
            v = 0.0
            for (lx, ly, r) in LAMPS:
                d = ((tx - lx - 0.5) ** 2 + (ty - ly - 0.5) ** 2) ** 0.5
                v += max(0, 1 - d / r) * 0.5
            if 15.5 < ty < 23.5: v += max(0, (ty - 18) / 5.5) * 0.35
            if ty >= 23.5: v = 1.2
            v = min(1.0, v)
            k = 0.72 + v * 0.36
            i = min(range(4), key=lambda j: abs(bands[j] - k))
            if abs(k - bands[i]) > 0.054 and (x + y) % 2 == 0: i = min(3, i + 1) if k > bands[i] else max(0, i - 1)
            m = bands[i]; c = p[x, y]
            warm = (m - 0.84) * 40
            p[x, y] = (max(0, min(255, int(c[0] * m + warm))), max(0, min(255, int(c[1] * m + warm * 0.5))), max(0, min(255, int(c[2] * m - warm * 0.3 + (8 if m < 0.8 else 0)))))
    return im

# ---------------------------------------------------------------- figures
SKIN = [(216, 162, 122), (176, 120, 86), (120, 80, 58), (232, 190, 150)]
def figure(kind, facing='down', skin=0, hair=(40, 30, 28), body=(70, 80, 100), legs=(40, 40, 50), extra=None, extra_c=None):
    """A 12x14 figure on a 16x16 cell, front/back/side. kind only changes accessories."""
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); p = im.load()
    s = SKIN[skin]
    def r(x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1): p[x, y] = c + (255,)
    # legs and body
    r(5, 11, 6, 14, legs); r(9, 11, 10, 14, legs)
    r(4, 6, 11, 11, body); r(3, 7, 3, 10, body); r(12, 7, 12, 10, body)
    r(3, 10, 3, 10, s); r(12, 10, 12, 10, s)
    # head
    r(5, 1, 10, 5, s)
    if facing == 'down':
        r(5, 1, 10, 2, hair); r(5, 3, 5, 3, hair); r(10, 3, 10, 3, hair)
        p[6, 3] = INK + (255,); p[9, 3] = INK + (255,)
    elif facing == 'up':
        r(5, 1, 10, 5, hair)
    elif facing == 'left':
        r(6, 1, 10, 4, hair); p[5, 3] = INK + (255,)
    elif facing == 'right':
        r(5, 1, 9, 4, hair); p[10, 3] = INK + (255,)
    if kind == 'guard':
        r(5, 0, 10, 1, (24, 34, 64)); r(4, 1, 11, 1, (24, 34, 64))
        p[7, 7] = (226, 194, 80, 255); r(4, 11, 11, 11, (20, 20, 26))
    if kind == 'teller':
        r(7, 6, 8, 9, (220, 220, 230)); p[7, 7] = (150, 40, 50, 255)
    if kind == 'mask':
        r(5, 1, 10, 5, (230, 226, 214)); r(5, 3, 10, 3, extra_c or (180, 40, 40)); p[6, 3] = INK + (255,); p[9, 3] = INK + (255,)
    if kind == 'swat':
        r(4, 0, 11, 2, (30, 34, 40)); r(4, 6, 11, 10, (36, 40, 46)); r(6, 7, 9, 9, (54, 58, 66))
    if kind == 'police':
        r(5, 0, 10, 1, (20, 30, 70)); r(4, 0, 11, 0, (20, 30, 70)); p[6, 7] = (226, 194, 80, 255)
    if extra == 'rifle': r(12, 6, 14, 6, (30, 30, 34)); r(13, 5, 13, 11, (30, 30, 34))
    if extra == 'bag': r(1, 8, 3, 12, (40, 46, 40))
    # silhouette outline
    out = im.copy(); q = out.load()
    for y in range(16):
        for x in range(16):
            if p[x, y][3] == 0 and any(0 <= x + dx < 16 and 0 <= y + dy < 16 and p[x + dx, y + dy][3] == 255 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                q[x, y] = (18, 14, 24, 255)
    return out

def prone(body=(70, 80, 100), skin=0, hair=(40, 30, 28), tied=False):
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); p = im.load()
    def r(x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1): p[x, y] = c + (255,)
    r(1, 6, 4, 10, hair); r(5, 6, 11, 10, body); r(12, 7, 15, 9, (40, 40, 50)); r(4, 4, 6, 5, SKIN[skin]); r(4, 11, 6, 12, SKIN[skin])
    if tied: r(7, 5, 7, 11, (220, 200, 120))
    return im

def shadow(im, x, y):
    p = im.load()
    for dx in range(3, 13):
        for dy in range(14, 16):
            c = p[x + dx, y + dy]; p[x + dx, y + dy] = ramp(c, 0.7)

def ring_tiles(src, radius, door_cost=3):
    """Sound flood fill: open tiles cost 1, closed doors/soft walls cost door_cost+1, reinforced and vault stop it."""
    import heapq
    dist = {src: 0}; q = [(0, src)]
    while q:
        d, (x, y) = heapq.heappop(q)
        if d > dist.get((x, y), 99): continue
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < W and 0 <= ny < H): continue
            ch = grid[ny][nx]
            if ch in '#VY': continue
            if dx and dy and (grid[y][nx] in '#VYsDMGE' or grid[ny][x] in '#VYsDMGE'): continue
            cost = (1.5 if dx and dy else 1) + (door_cost if ch in 'sDMGE' else 0)
            nd = d + cost
            if nd <= radius and nd < dist.get((nx, ny), 99):
                dist[(nx, ny)] = nd; heapq.heappush(q, (nd, (nx, ny)))
    return set(dist)

def up(im, k=2): return im.resize((im.width * k, im.height * k), Image.NEAREST)


