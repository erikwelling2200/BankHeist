# BankHeist UI mockup renderer: a top-down city branch on the 16px grid, plus the in-world (canvas) UI layer drawn as
# pixel art, the way Phaser would draw it. Screen-space HUD is NOT drawn here; that is HTML in the mockups.
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

def place(im, spr, tx, ty, alpha=1.0, offx=0, offy=0):
    x, y = int(tx * T + offx), int(ty * T + offy)
    shadow(im, x, y)
    if alpha < 1:
        spr = spr.copy(); a = spr.split()[3].point(lambda v: int(v * alpha)); spr.putalpha(a)
    im.paste(spr, (x, y), spr)

# ---------------------------------------------------------------- pixel font (3x5) and icons
F = {
 '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
 '5': '111100111001111', '6': '111100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001111',
 '+': '000010111010000', '-': '000000111000000', '!': '010010010000010', '?': '111001011000010', 'x': '000101010101000',
 'T': '111010010010010', 'K': '101110100110101', 'O': '111101101101111', 'S': '111100111001111', 'G': '111100101101111',
 'A': '111101111101101', 'B': '110101110101110', 'L': '100100100100111', 'R': '110101110101101', 'M': '101111111101101',
 'C': '111100100100111', 'E': '111100110100111', 'N': '101111111111101', 'P': '111101111100100', 'H': '101101111101101',
 'I': '111010010010111', 'D': '110101101101110', 'U': '101101101101111', 'W': '101101111111101', 'Y': '101101010010010',
 'V': '101101101101010', 'Q': '111101101111001', ':': '000010000010000', '/': '001001010100100', ' ': '000000000000000',
}
def text(im, x, y, s, c, shadow_c=INK, scale=1):
    p = im.load()
    for i, ch in enumerate(s.upper()):
        g = F.get(ch, F['?'])
        for k, bit in enumerate(g):
            if bit == '1':
                gx, gy = x + i * 4 * scale + (k % 3) * scale, y + (k // 3) * scale
                for sy in range(scale):
                    for sx in range(scale):
                        if shadow_c is not None and 0 <= gx + sx + 1 < im.width and 0 <= gy + sy + 1 < im.height:
                            if p[gx + sx + 1, gy + sy + 1] != c: p[gx + sx + 1, gy + sy + 1] = shadow_c
                        if 0 <= gx + sx < im.width and 0 <= gy + sy < im.height: p[gx + sx, gy + sy] = c

def text_w(s, scale=1): return len(s) * 4 * scale - scale

ICONS = {
 'eye':   ['..xxx..', '.x...x.', 'x..o..x', '.x...x.', '..xxx..'],
 'ear':   ['x..x.', '.x..x', '.x..x', '.x..x', 'x..x.'],
 'bell':  ['..x..', '.xxx.', '.xxx.', 'xxxxx', '..x..'],
 'cam':   ['xxxx..', 'x..xxx', 'x..xxx', 'xxxx..'],
 'knot':  ['x...x', '.x.x.', '..x..', '.x.x.', 'x...x'],
 'down':  ['xxxxx', '.xxx.', '..x..'],
 'cross': ['..x..', '.xxx.', 'xx.xx', '.xxx.', '..x..'],
 'drop':  ['.x.x', 'xxxx', 'xxxx', '.x.x'],
 'skull': ['.xxx.', 'x.x.x', 'xxxxx', '.x.x.'],
 'lock':  ['.xx.', 'x..x', 'xxxx', 'xxxx'],
 'bolt':  ['..xx', '.xx.', 'xxxx', '.xx.', 'xx..'],
 'shield':['xxxxx', 'xxxxx', 'xxxxx', '.xxx.', '..x..'],
 'halfshield': ['xxx..', 'xxx..', 'xxx..', '.xx..', '..x..'],
 'radio': ['x....', 'x....', 'xxxxx', 'x.x.x', 'xxxxx'],
 'phone': ['xxxx', 'x..x', 'x..x', 'xxxx', 'x.xx'],
 'run':   ['..xx.', '.xxx.', 'x.x..', '..xx.', '.x..x'],
 'hand':  ['x.x.x', 'x.x.x', 'xxxxx', 'xxxxx', '.xxx.'],
 'star':  ['..x..', 'xxxxx', '.xxx.', '.x.x.'],
}
def icon(im, name, x, y, c, outline=INK, scale=1):
    rows = ICONS[name]; p = im.load()
    pts = [(cx, cy) for cy, row in enumerate(rows) for cx, ch in enumerate(row) if ch in 'xo']
    if outline is not None:
        for (cx, cy) in pts:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
                for sy in range(scale):
                    for sx in range(scale):
                        X, Y = x + (cx + dx) * scale + sx, y + (cy + dy) * scale + sy
                        if 0 <= X < im.width and 0 <= Y < im.height and (cx + dx, cy + dy) not in pts: p[X, Y] = outline
    for cy, row in enumerate(rows):
        for cx, ch in enumerate(row):
            if ch in 'xo':
                for sy in range(scale):
                    for sx in range(scale):
                        X, Y = x + cx * scale + sx, y + cy * scale + sy
                        if 0 <= X < im.width and 0 <= Y < im.height: p[X, Y] = c if ch == 'x' else (outline or INK)
    return len(rows[0]) * scale, len(rows) * scale

def badge(im, tx, ty, kind, c, n=None, offx=0, sym=None):
    """A state badge above an NPC's head (tile tx,ty is the NPC)."""
    x, y = tx * T + 4 + offx, ty * T - 8
    p = im.load()
    def plate(w, h, col):
        for yy in range(y - 1, y + h + 1):
            for xx in range(x - 1, x + w + 1):
                if 0 <= xx < im.width and 0 <= yy < im.height:
                    edge = yy in (y - 1, y + h) or xx in (x - 1, x + w)
                    p[xx, yy] = INK if edge else col
    if kind == '!':
        plate(5, 7, RED); text(im, x + 1, y + 1, '!', WHITE, None)
    elif kind == '?':
        plate(5, 7, AMBER); text(im, x + 1, y + 1, '?', INK, None)
    elif kind == 'bell':
        w = 6 + (4 if n is not None else 0); plate(w, 7, RED); icon(im, 'bell', x, y + 1, WHITE, None)
        if n is not None: text(im, x + 6, y + 1, str(n), WHITE, None)
    else:
        w, h = len(ICONS[kind][0]), len(ICONS[kind])
        ww = w + (4 if (n is not None or sym is not None) else 0)
        plate(ww + 1, h + 1, c); icon(im, kind, x + 1, y + 1, INK if c in (AMBER, WHITE, CIV) else WHITE, None)
        if n is not None: text(im, x + w + 1, y + 1, str(n), INK if c in (AMBER, WHITE, CIV) else WHITE, None)
        if sym is not None: text(im, x + w + 1, y + 1, sym, INK if c in (AMBER, WHITE, CIV) else WHITE, None)

def pips(im, tx, ty, n, c, total=3, offy=-4):
    """Suspicion or command pips: little squares above a figure."""
    p = im.load(); x0 = tx * T + 8 - (total * 4 - 1) // 2; y = ty * T + offy
    for i in range(total):
        for yy in range(y - 1, y + 3):
            for xx in range(x0 + i * 4 - 1, x0 + i * 4 + 3):
                if 0 <= xx < im.width and 0 <= yy < im.height:
                    inner = (x0 + i * 4 <= xx <= x0 + i * 4 + 1) and (y <= yy <= y + 1)
                    p[xx, yy] = (c if i < n else (60, 60, 70)) if inner else INK

# ---------------------------------------------------------------- overlay helpers
def blend(im, x, y, c, a):
    if 0 <= x < im.width and 0 <= y < im.height:
        p = im.load(); b = p[x, y]; p[x, y] = tuple(int(b[i] * (1 - a) + c[i] * a) for i in range(3))

def tint(im, tx, ty, kind):
    """Safe-floor tints. Every kind differs in shape, not just colour."""
    c = {'safe': SAFE, 'amber': AMBER, 'red': RED, 'grey': GREY, 'hamber': AMBER, 'hred': RED, 'hgrey': GREY, 'cam': RED}[kind]
    for py in range(1, T - 1):
        for px in range(1, T - 1):
            x, y = tx * T + px, ty * T + py
            if kind in ('hamber', 'hred', 'hgrey'):
                if (px + py) % 4 < 2: blend(im, x, y, c, 0.55)
                else: blend(im, x, y, c, 0.12)
            elif kind == 'grey':
                blend(im, x, y, (40, 40, 50), 0.55)
            else:
                edge = px in (1, T - 2) or py in (1, T - 2)
                blend(im, x, y, c, 0.62 if edge else (0.3 if kind == 'safe' else 0.4))
    if kind == 'cam': icon(im, 'cam', tx * T + 5, ty * T + 6, WHITE)

def tile_icon(im, tx, ty, name, c=WHITE):
    w, h = len(ICONS[name][0]), len(ICONS[name])
    icon(im, name, tx * T + (T - w) // 2, ty * T + (T - h) // 2, c)

def dot(im, x, y, c, r=1):
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= r * r + 0.5 and 0 <= x + dx < im.width and 0 <= y + dy < im.height: im.load()[x + dx, y + dy] = c

def line(im, x0, y0, x1, y1, c, dash=0, gap=0, width=1, alpha=1.0):
    n = int(max(abs(x1 - x0), abs(y1 - y0))) or 1
    for i in range(n + 1):
        if dash and (i % (dash + gap)) >= dash: continue
        x, y = round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n)
        for w in range(width):
            for v in range(width):
                xx, yy = x + w - width // 2, y + v - width // 2
                if alpha >= 1:
                    if 0 <= xx < im.width and 0 <= yy < im.height: im.load()[xx, yy] = c
                else: blend(im, xx, yy, c, alpha)

def ctr(t): return t * T + 8

def path(im, tiles, c=WHITE, dash=3, gap=2, end=True):
    pts = [(ctr(x), ctr(y)) for x, y in tiles]
    for (a, b) in zip(pts, pts[1:]):
        line(im, a[0], a[1], b[0], b[1], INK, dash, gap, 3)
    for (a, b) in zip(pts, pts[1:]):
        line(im, a[0], a[1], b[0], b[1], c, dash, gap, 1)
    if end:
        x, y = pts[-1]
        for dy in range(-4, 5):
            for dx in range(-4, 5):
                if abs(dx) + abs(dy) in (4, 5) and abs(dx) + abs(dy) <= 5: pass
        for (dx, dy) in [(i, -4) for i in range(-3, 4)] + [(i, 4) for i in range(-3, 4)] + [(-4, i) for i in range(-3, 4)] + [(4, i) for i in range(-3, 4)]:
            if 0 <= x + dx < im.width and 0 <= y + dy < im.height: im.load()[x + dx, y + dy] = c

def arrow(im, tiles, c=WHITE, label=None):
    """NPC intent: dashed path in the NPC's colour plus a chevron head."""
    pts = [(ctr(x), ctr(y)) for x, y in tiles]
    for (a, b) in zip(pts, pts[1:]):
        line(im, a[0], a[1], b[0], b[1], INK, 2, 2, 3)
    for (a, b) in zip(pts, pts[1:]):
        line(im, a[0], a[1], b[0], b[1], c, 2, 2, 1)
    (ax, ay), (bx, by) = pts[-2], pts[-1]
    ang = math.atan2(by - ay, bx - ax)
    for s in (-1, 1):
        ex, ey = bx - 5 * math.cos(ang + s * 0.6), by - 5 * math.sin(ang + s * 0.6)
        line(im, bx, by, round(ex), round(ey), INK, 0, 0, 3)
    for s in (-1, 1):
        ex, ey = bx - 5 * math.cos(ang + s * 0.6), by - 5 * math.sin(ang + s * 0.6)
        line(im, bx, by, round(ex), round(ey), c)
    if label: text(im, bx + 4, by - 9, label, c)

def los_clear(x0, y0, x1, y1):
    """Pixel-centre line of sight on the tile grid."""
    n = int(max(abs(x1 - x0), abs(y1 - y0)) / 4) + 1
    for i in range(1, n):
        x = x0 + (x1 - x0) * i / n; y = y0 + (y1 - y0) * i / n
        tx, ty = int(x // T), int(y // T)
        if (tx, ty) != (int(x1 // T), int(y1 // T)) and blocks_sight(tx, ty): return False
    return True

def cone(im, tx, ty, facing_deg, rng, half, c, alpha=0.18, edge=True, dotted=False):
    """Vision cone drawn per pixel, clipped by walls."""
    ox, oy = ctr(tx), ctr(ty)
    R = rng * T
    for y in range(max(0, oy - R), min(im.height, oy + R)):
        for x in range(max(0, ox - R), min(im.width, ox + R)):
            dx, dy = x - ox, y - oy; d = math.hypot(dx, dy)
            if d > R or d < 6: continue
            a = math.degrees(math.atan2(dy, dx)); da = (a - facing_deg + 180) % 360 - 180
            if abs(da) > half: continue
            if not los_clear(ox, oy, x, y): continue
            on_edge = abs(abs(da) - half) < 60 / max(d, 1) or abs(d - R) < 1
            if on_edge and edge:
                if not dotted or (int(d) // 3) % 2 == 0: blend(im, x, y, c, 0.8)
            else: blend(im, x, y, c, alpha)

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

def ring(im, tiles, c=(120, 200, 255), fill_a=0.07):
    """Noise ring: the exact reached tiles, filled lightly, with a bright outline on the boundary."""
    p = im.load()
    for (x, y) in tiles:
        for py in range(T):
            for px in range(T):
                X, Y = x * T + px, y * T + py
                if (px + py) % 2 == 0: blend(im, X, Y, c, fill_a)
        for (dx, dy, side) in ((0, -1, 'n'), (0, 1, 's'), (-1, 0, 'w'), (1, 0, 'e')):
            if (x + dx, y + dy) not in tiles:
                for k in range(T):
                    if side == 'n': X, Y = x * T + k, y * T
                    elif side == 's': X, Y = x * T + k, y * T + T - 1
                    elif side == 'w': X, Y = x * T, y * T + k
                    else: X, Y = x * T + T - 1, y * T + k
                    p[X, Y] = c

def arcs(im, sx, sy, ang_deg, aim, rec, bullets, rng, c=(255, 230, 160)):
    """Shot cone: nested arcs, bullet 1 brightest, cut at the first full-height blocker. sx,sy in px."""
    R = rng * T; widest = aim + (bullets - 1) * rec
    for y in range(max(0, int(sy - R)), min(im.height, int(sy + R))):
        for x in range(max(0, int(sx - R)), min(im.width, int(sx + R))):
            dx, dy = x - sx, y - sy; d = math.hypot(dx, dy)
            if d > R or d < 5: continue
            da = abs((math.degrees(math.atan2(dy, dx)) - ang_deg + 180) % 360 - 180)
            if da > widest / 2: continue
            if not los_clear(sx, sy, x, y): continue
            k = 0
            for b in range(bullets):
                if da <= (aim + b * rec) / 2: k = bullets - b; break
            a = 0.10 + 0.32 * (k / bullets)
            edge = any(abs(da - (aim + b * rec) / 2) < 45 / max(d, 1) for b in range(bullets))
            blend(im, x, y, c, 0.75 if edge else a)

def body_marker(im, tx, ty, kind):
    """In-cone markers: hostile diamond, civilian circle, crew triangle (shape + colour)."""
    x, y = ctr(tx), ty * T - 3
    p = im.load()
    shapes = {
        'hostile': (HOSTILE, ['..x..', '.xxx.', 'xxxxx', '.xxx.', '..x..']),
        'civ': (CIV, ['.xxx.', 'xxxxx', 'xxxxx', 'xxxxx', '.xxx.']),
        'crew': (CREWBLUE, ['..x..', '.xxx.', '.xxx.', 'xxxxx', 'xxxxx']),
    }
    c, rows = shapes[kind]
    ICONS['_m'] = rows
    icon(im, '_m', x - 2, y - 2, c)

def bracket(im, tx, ty, c, w=1, h=1):
    """Corner brackets around a tile area (selection, targets)."""
    x0, y0, x1, y1 = tx * T - 1, ty * T - 1, (tx + w) * T, (ty + h) * T
    p = im.load()
    for k in range(4):
        for (X, Y) in ((x0 + k, y0), (x0, y0 + k), (x1 - k, y0), (x1, y0 + k), (x0 + k, y1), (x0, y1 - k), (x1 - k, y1), (x1, y1 - k)):
            if 0 <= X < im.width and 0 <= Y < im.height: p[X, Y] = c

def crew_ring(im, tx, ty, c):
    """Crew ground ring under the feet in the crew colour."""
    cx, cy = ctr(tx), ty * T + 14
    for a in range(0, 360, 6):
        x = cx + round(7 * math.cos(math.radians(a))); y = cy + round(2.5 * math.sin(math.radians(a)))
        if 0 <= x < im.width and 0 <= y < im.height: im.load()[x, y] = c

def crop(im, tx0, ty0, wpx=422, hpx=195, offx=0, offy=0):
    x0, y0 = tx0 * T + offx, ty0 * T + offy
    return im.crop((x0, y0, x0 + wpx, y0 + hpx))

def up(im, k=2): return im.resize((im.width * k, im.height * k), Image.NEAREST)


def tile_glyph(im, tx, ty, g, c):
    """Second channel on every unsafe tile, so colour never carries the meaning alone: pips, an eye, a hand, a question mark."""
    p = im.load(); cx, cy = tx * T + 8, ty * T + 8
    def sq(x, y, col):
        for yy in range(y - 1, y + 3):
            for xx in range(x - 1, x + 3):
                p[xx, yy] = col if (x <= xx <= x + 1 and y <= yy <= y + 1) else INK
    if g in ('+1', '+2'):
        n = int(g[1])
        for i in range(n): sq(cx - (n * 4 - 1) // 2 + i * 4, cy - 1, ramp(c, 1.2))
    elif g == '!': icon(im, 'eye', cx - 3, cy - 2, WHITE)
    elif g == 'T': icon(im, 'hand', cx - 2, cy - 2, ramp(c, 1.2))
    elif g == '?': text(im, cx - 1, cy - 2, '?', (170, 170, 186))

def tints(im, info, skip=()):
    """Safe-floor overlay for a set of tiles: soft fill per kind, outlines only where the outcome changes."""
    glyphs = {t: v[1] for t, v in info.items() if isinstance(v, tuple) and len(v) > 1 and t not in skip}
    kinds = {t: v[0] if isinstance(v, tuple) else v for t, v in info.items() if t not in skip}
    col = {'safe': SAFE, 'amber': AMBER, 'red': RED, 'grey': GREY, 'hamber': AMBER, 'hred': RED, 'hgrey': GREY, 'cam': RED}
    p = im.load()
    for (tx, ty), k in kinds.items():
        c = col[k]
        for py in range(T):
            for px in range(T):
                x, y = tx * T + px, ty * T + py
                if k in ('hamber', 'hred', 'hgrey'):
                    blend(im, x, y, c, 0.6 if (px + py) % 5 < 2 else 0.1)
                elif k == 'grey': blend(im, x, y, (36, 36, 46), 0.6)
                else: blend(im, x, y, c, 0.26 if k == 'safe' else 0.42)
        for (dx, dy) in ((0, -1), (0, 1), (-1, 0), (1, 0)):
            nk = kinds.get((tx + dx, ty + dy))
            if nk == k: continue
            for i in range(T):
                if dx == 0: x, y = tx * T + i, ty * T + (0 if dy < 0 else T - 1)
                else: x, y = tx * T + (0 if dx < 0 else T - 1), ty * T + i
                if k == 'safe' and nk is not None: continue
                p[x, y] = ramp(c, 1.1) if k != 'grey' else (90, 90, 104)
        if k == 'cam': icon(im, 'cam', tx * T + 5, ty * T + 6, WHITE)
        if glyphs.get((tx, ty)) not in (None, '-'): tile_glyph(im, tx, ty, glyphs[(tx, ty)], c)
        elif k == 'grey': tile_glyph(im, tx, ty, '?', c)
