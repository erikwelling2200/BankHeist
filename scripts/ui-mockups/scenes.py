# Renders every world-space mockup frame. Usage: python3 scenes.py <out-dir> [scene ...]
# Each frame is four layers, as the game would draw them: floor art (16px grid, scaled 2x), floor UI (drawn at 2x),
# actors (16px art, scaled 2x), actor UI (drawn at 2x). So UI pixels are half the size of art pixels.
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image
import bh
from bh import grid, W, H, T, WALLS, figure, prone, is_wall, blocks_sight, ring_tiles
import ui2 as u
from ui2 import TS, cx, SAFE, AMBER, RED, GREY, CMD, BONE, INK, DIM, CREW
from rules import Npc, overlay_for, reachable, los

OUT = sys.argv[1]
ONLY = set(sys.argv[2:])
os.makedirs(OUT, exist_ok=True)
_base = None

class Scene:
    def __init__(self):
        global _base
        if _base is None:
            cache = os.path.join(OUT, '.base-cache.png')
            src = os.path.join(os.path.dirname(__file__), 'bh.py')
            if os.path.exists(cache) and os.path.getmtime(cache) > os.path.getmtime(src): _base = Image.open(cache).convert('RGB')
            else: _base = bh.render_world(); _base.save(cache)
        self.world = _base.copy()
        self.actors = Image.new('RGBA', self.world.size, (0, 0, 0, 0))
        self.under = u.layer(self.world.width * 2, self.world.height * 2)
        self.over = u.layer(self.world.width * 2, self.world.height * 2)

    def place(self, spr, tx, ty, alpha=1.0):
        x, y = tx * T, ty * T
        if alpha >= 0.99: bh.shadow(self.world, x, y)
        if alpha < 1:
            spr = spr.copy(); spr.putalpha(spr.split()[3].point(lambda v: int(v * alpha)))
        self.actors.alpha_composite(spr, (x, y))

    def compose(self):
        im = bh.up(self.world, 2).convert('RGBA')
        im.alpha_composite(self.under)
        im.alpha_composite(bh.up(self.actors, 2))
        im.alpha_composite(self.over)
        return im.convert('RGB')

    def crop(self, tx0, ty0, w=844, h=390, offx=0, offy=0):
        x0, y0 = tx0 * TS + offx * 2, ty0 * TS + offy * 2
        return self.compose().crop((x0, y0, x0 + w, y0 + h))

def save(name, im): im.save(os.path.join(OUT, name + '.png')); print('wrote', name)

def fdir(deg):
    deg = deg % 360
    return 'right' if deg < 45 or deg >= 315 else 'down' if deg < 135 else 'left' if deg < 225 else 'up'

# ---- the cast
def p_guard(s, x, y, f, a=1.0): s.place(figure('guard', fdir(f)), x, y, a)
def p_teller(s, x, y, i=0): s.place(figure('teller', 'down', skin=i % 4, hair=[(90, 50, 30), (30, 26, 24), (160, 110, 60), (60, 40, 30)][i % 4], body=[(60, 70, 110), (110, 60, 70), (70, 96, 90), (90, 80, 120)][i % 4]), x, y)
def p_civ(s, x, y, f='down', i=0, a=1.0): s.place(figure('civ', f, skin=i % 4, hair=[(40, 30, 28), (150, 110, 70), (20, 20, 20), (110, 60, 40)][i % 4], body=[(140, 120, 90), (60, 90, 80), (120, 60, 70), (80, 80, 110), (150, 140, 120)][i % 5]), x, y, a)
CLEANER = dict(skin=2, hair=(30, 26, 24), body=(70, 110, 120), legs=(50, 70, 80))
def p_cleaner(s, x, y, f, a=1.0): s.place(figure('civ', f, **CLEANER), x, y, a)
LOOKS = {'mara': dict(skin=3, hair=(120, 50, 40), body=(52, 60, 74)), 'jun': dict(skin=1, hair=(20, 18, 22), body=(74, 70, 64)),
         'dex': dict(skin=0, hair=(60, 40, 30), body=(40, 42, 48)), 'sol': dict(skin=2, hair=(30, 24, 24), body=(56, 50, 66))}
def p_crew(s, who, x, y, f='down', masked=False, extra=None, sel=False):
    u.crew_ring(s.under, x, y, CREW[who])
    s.place(figure('mask' if masked else 'civ', f, extra=extra, extra_c=tuple(int(v * 0.8) for v in CREW[who]), **LOOKS[who]), x, y)
    if sel: u.bracket(s.over, x, y, CREW[who])
def p_prone(s, x, y, i=0, tied=False, body=None):
    s.place(prone(body=body or [(140, 120, 90), (60, 90, 80), (120, 60, 70), (80, 80, 110), (150, 140, 120)][i % 5], skin=i % 4, tied=tied), x, y)

LOBBY_NPCS = lambda: [
    Npc('guard', 20, 19, 0, 'enf', future=(23, 19, 0)),
    Npc('teller1', 15, 14, 90, 'staff'), Npc('teller2', 20, 14, 90, 'staff'), Npc('teller3', 25, 14, 90, 'staff'),
    Npc('teller4', 30, 14, 90, 'staff'), Npc('teller5', 35, 14, 90, 'staff'),
    Npc('cust1', 24, 19, -90, 'civ'), Npc('cust2', 23, 20, -90, 'civ'), Npc('cust3', 31, 18, 180, 'civ'), Npc('cust4', 13, 21, 0, 'civ'),
    Npc('cust5', 35, 20, 180, 'civ'),
]
def lobby_cast(s, skip=()):
    if 'guard' not in skip: p_guard(s, 20, 19, 0)
    for i, x in enumerate((15, 20, 25, 30, 35)):
        if f'teller{i+1}' not in skip: p_teller(s, x, 14, i)
    p_civ(s, 24, 19, 'up', 0); p_civ(s, 23, 20, 'up', 1); p_civ(s, 31, 18, 'left', 2); p_civ(s, 13, 21, 'right', 3); p_civ(s, 35, 20, 'left', 4)

def los_tiles(src, radius):
    return {(x, y) for y in range(H) for x in range(W)
            if math.hypot(x - src[0], y - src[1]) <= radius and not is_wall(x, y) and los(src[0], src[1], x, y)}

# =============================================================== stealth
def s_select():
    s = Scene(); npcs = LOBBY_NPCS()
    reach = reachable(28, 21, 5, {(n.x, n.y) for n in npcs})
    u.tints(s.under, overlay_for(reach.keys(), npcs, 'concealed'), skip=((28, 21),))
    lobby_cast(s)
    u.arrow(s.over, [(20, 19), (21, 19), (22, 19), (23, 19)], BONE)
    u.arrow(s.over, [(24, 19), (24, 18), (24, 16)], DIM)
    p_crew(s, 'jun', 28, 21, 'up', sel=True); p_crew(s, 'mara', 12, 19, 'right')
    return s.crop(10, 11)

def s_path(stage):
    s = Scene()
    cnow = (37, 11, -90) if stage < 2 else (33, 11, 180)
    cnext = (39, 12, 90) if stage < 2 else (29, 11, 180)
    npcs = [Npc('teller5', 35, 14, 90, 'staff'), Npc('teller4', 30, 14, 90, 'staff'), Npc('cust5', 31, 18, 180, 'civ'),
            Npc('cleaner', cnow[0], cnow[1], cnow[2], 'staff', future=cnext)]
    route = [(35, 19), (36, 18), (37, 17), (38, 16), (39, 16), (40, 15), (40, 14)]
    info = overlay_for(route[1:], npcs, 'clean')
    bad = next((t for t in route[1:] if info[t][0] != 'safe'), None)
    u.tints(s.under, info)
    p_teller(s, 35, 14, 4); p_teller(s, 30, 14, 3); p_civ(s, 31, 18, 'left', 2)
    p_cleaner(s, cnow[0], cnow[1], fdir(cnow[2]))
    u.arrow(s.over, [(cnow[0], cnow[1]), (cnext[0], cnext[1])], DIM)
    if stage == 1:
        p_cleaner(s, cnext[0], cnext[1], fdir(cnext[2]), 0.4)
        u.cone(s.under, blocks_sight, cnext[0], cnext[1], cnext[2], 6, 45, AMBER, 26, dotted=True)
        u.line(s.over, cx(cnext[0]), cx(cnext[1]), cx(bad[0]), cx(bad[1]), AMBER, 240, 3, 2)
        u.bracket(s.over, bad[0], bad[1], BONE)
    u.path(s.under, route)
    if bad and stage != 2: u.glyph_at_tile(s.over, bad[0], bad[1], 'eye', BONE)
    p_crew(s, 'jun', 35, 19, 'up', sel=True)
    return s.crop(20, 9)

def s_noise(kind):
    s = Scene()
    if kind == 'quiet':
        u.ring(s.under, ring_tiles((11, 3), 1), CMD, fill=26)
        p_cleaner(s, 13, 8, 'up'); p_guard(s, 6, 9, 0)
        p_crew(s, 'jun', 11, 3, 'up', sel=True)
        return s.crop(1, 0, offy=8)
    tiles = ring_tiles((28, 19), 8)
    u.ring(s.under, tiles, RED, fill=14)
    lobby_cast(s); p_cleaner(s, 38, 12, 'left')
    p_crew(s, 'jun', 28, 19, 'left', sel=True)
    for (x, y) in ((20, 19), (15, 14), (20, 14), (25, 14), (30, 14), (35, 14), (24, 19), (23, 20), (31, 18), (35, 20), (38, 12)):
        if (x, y) in tiles: u.badge(s.over, x, y, 'waves', RED, sym='!')
    return s.crop(10, 10)

def s_challenge():
    s = Scene()
    p_teller(s, 35, 14, 4); p_teller(s, 30, 14, 3)
    p_guard(s, 40, 11, 180)
    u.arrow(s.over, [(40, 11), (39, 12)], BONE)
    u.badge(s.over, 40, 11, 'hand', AMBER)
    u.tints(s.under, {(40, 16): 'safe'})
    u.path(s.under, [(37, 12), (38, 13), (39, 14), (40, 15), (40, 16)], SAFE)
    u.glyph_at_tile(s.over, 40, 16, 'run', SAFE)
    p_crew(s, 'mara', 37, 12, 'right', sel=True)
    u.badge(s.over, 37, 12, 'hand', AMBER, n=1)
    return s.crop(21, 7)

def s_carriers():
    s = Scene()
    p_guard(s, 20, 19, 0)
    for i, x in enumerate((15, 20, 25, 30, 35)): p_teller(s, x, 14, i)
    p_civ(s, 24, 19, 'down', 0); p_civ(s, 31, 18, 'left', 2); p_civ(s, 13, 21, 'right', 3)
    p_crew(s, 'jun', 27, 18, 'left', extra='rifle')
    u.cone(s.under, blocks_sight, 20, 19, -20, 8, 45, RED, 34)
    u.badge(s.over, 30, 14, 'bell', RED, n=2)
    u.badge(s.over, 20, 19, 'radio', RED, n=2)
    u.arrow(s.over, [(13, 21), (14, 22), (19, 22), (22, 22)], RED)
    u.badge(s.over, 13, 21, 'run', RED, n=3)
    u.badge(s.over, 24, 19, 'drops', AMBER); u.badge(s.over, 31, 18, 'drops', AMBER)
    return s.crop(15, 11)

# =============================================================== takeover
def command_rings(s, src, cmd_r):
    cmd = los_tiles(src, cmd_r)
    panic = ring_tiles(src, cmd_r + 3) - cmd
    u.ring(s.under, cmd, CMD, fill=34, dotted=False)
    for (x, y) in panic:
        for py in range(TS):
            for px in range(TS):
                if (px + py) % 8 == 0: u.put(s.under, x * TS + px, y * TS + py, AMBER, 120)
    u.ring(s.under, panic | cmd, AMBER)
    return cmd, panic

def s_go_preview():
    s = Scene()
    cmd, panic = command_rings(s, (28, 21), 9)
    lobby_cast(s); p_cleaner(s, 38, 12, 'left'); p_civ(s, 42, 17, 'down', 1)
    p_crew(s, 'dex', 28, 21, 'up', masked=True, extra='rifle', sel=True)
    p_crew(s, 'mara', 41, 21, 'left', masked=True)
    for (x, y) in ((24, 19), (23, 20), (31, 18), (35, 20), (15, 14), (20, 14), (25, 14), (30, 14), (35, 14), (13, 21), (42, 17), (38, 12)):
        if (x, y) in cmd: u.badge(s.over, x, y, 'down', CMD)
        elif (x, y) in panic: u.badge(s.over, x, y, 'drops', AMBER)
    u.badge(s.over, 20, 19, 'star', CMD)
    return s.crop(16, 11)

def s_go_after():
    s = Scene()
    for i, x in enumerate((15, 20, 25, 30, 35)):
        p_prone(s, x, 14, body=[(60, 70, 110), (110, 60, 70), (70, 96, 90), (90, 80, 120), (60, 70, 110)][i]); u.pips(s.over, x, 14, 2, CMD, total=2, dy=4)
    for (x, y, i) in ((24, 18, 0), (23, 20, 1), (31, 18, 2), (35, 20, 4), (13, 21, 3)):
        p_prone(s, x, y, i); u.pips(s.over, x, y, 2, CMD, total=2, dy=4)
    p_prone(s, 21, 19, tied=True, body=(40, 50, 90)); u.badge(s.over, 21, 19, 'knot', BONE)
    p_crew(s, 'dex', 27, 20, 'up', masked=True, extra='rifle')
    p_crew(s, 'mara', 30, 16, 'up', masked=True, sel=True)
    p_crew(s, 'jun', 22, 19, 'left', masked=True)
    u.ring(s.under, los_tiles((27, 20), 6), CMD)
    u.badge(s.over, 27, 20, 'lock', CMD)
    p_civ(s, 42, 17, 'down', 1); u.badge(s.over, 42, 17, 'phone', RED, n=2)
    return s.crop(11, 11)

def s_lapse():
    s = Scene()
    p_prone(s, 24, 18, 0); u.pips(s.over, 24, 18, 1, CMD, total=2, dy=4)
    p_prone(s, 23, 20, 1); u.pips(s.over, 23, 20, 2, CMD, total=2, dy=4)
    p_prone(s, 31, 18, 2)
    u.arrow(s.over, [(31, 18), (30, 19), (28, 21), (26, 22), (25, 23)], RED)
    u.badge(s.over, 31, 18, 'run', RED, n=2)
    p_prone(s, 33, 20, 3); u.badge(s.over, 33, 20, 'hand', RED, n=1)
    p_prone(s, 35, 21, 4); u.badge(s.over, 35, 21, 'down', CMD)
    p_crew(s, 'dex', 27, 19, 'right', masked=True, extra='rifle', sel=True)
    p_crew(s, 'mara', 34, 16, 'down', masked=True)
    return s.crop(18, 12)

# =============================================================== loud
def s_aim(bullets=6):
    s = Scene()
    p_civ(s, 33, 20, 'left', 1); p_prone(s, 27, 20, 0)
    sx, sy, tx, ty = cx(24), cx(21), cx(31), cx(19)
    u.arcs(s.under, blocks_sight, sx, sy, math.degrees(math.atan2(ty - sy, tx - sx)), 14, 3, bullets, 8)
    p_guard(s, 31, 19, 180); p_guard(s, 30, 16, 180)
    for i, x in enumerate((25, 35)): p_teller(s, x, 14, i + 2)
    p_crew(s, 'mara', 24, 21, 'right', masked=True, sel=True)
    u.cover_edge(s.over, 31, 19, 'w')                 # the desk covers his west edge, and the shot comes from the west
    if bullets > 2: u.cover_edge(s.over, 33, 20, 'n', flanked=True)   # the bench north of the bystander doesn't face the shooter
    u.marker(s.over, 31, 19, 'hostile')
    u.marker(s.over, 30, 16, 'hostile')
    if bullets > 2: u.marker(s.over, 33, 20, 'civ')
    return s.crop(15, 12)

def s_watch():
    s = Scene()
    u.cone(s.under, blocks_sight, 24, 23, -90, 8, 22, RED, 40)
    s.place(figure('police', 'up'), 24, 23)
    u.cone(s.under, blocks_sight, 32, 17, 150, 8, 30, CMD, 44)
    p_crew(s, 'dex', 32, 17, 'left', masked=True, extra='rifle', sel=True)
    p_crew(s, 'mara', 36, 18, 'left', masked=True)
    for (x, y, i) in ((24, 18, 0), (23, 20, 1), (31, 19, 2)): p_prone(s, x, y, i)
    return s.crop(15, 12)

def s_police():
    s = Scene(); p = s.world.load()
    for x in range(9, 14):
        if grid[23][x] == 'G':
            for py in range(5, 11):
                for px in range(T):
                    if (px * 7 + py * 3) % 5 == 0: p[x * T + px, 23 * T + py] = (40, 50, 60)
    bh.van(p, 9, 26, (200, 202, 208), 3, 2, roof=(30, 40, 80))
    bh.rect(p, 10 * T, 26 * T + 4, 10 * T + 6, 26 * T + 7, (190, 50, 50)); bh.rect(p, 10 * T + 7, 26 * T + 4, 10 * T + 13, 26 * T + 7, (60, 80, 200))
    bh.van(p, 30, 27, (32, 36, 42), 4, 2)
    for (x, y) in ((12, 25), (14, 25)): s.place(figure('police', 'up'), x, y)
    u.cone(s.under, blocks_sight, 14, 25, -75, 8, 22, RED, 34)
    u.bracket(s.over, 16, 23, RED); u.glyph_at_tile(s.over, 16, 23, 'bolt', RED); u.badge(s.over, 16, 23, 'bolt', RED, n=1, dx=0)
    gx, gy = 28, 18
    blast = los_tiles((gx, gy), 2)
    for (x, y) in blast:
        for py in range(TS):
            for px in range(TS):
                if (px + py) % 6 == 0: u.put(s.under, x * TS + px, y * TS + py, BONE, 120)
    u.ring(s.under, blast, BONE, dotted=False)
    u.rect(s.over, cx(gx) - 3, cx(gy) - 3, cx(gx) + 2, cx(gy) + 2, (50, 60, 48)); u.rect(s.over, cx(gx) - 2, cx(gy) - 2, cx(gx) - 1, cx(gy) - 1, (120, 140, 110))
    u.plate(s.over, cx(gx) + 6, cx(gy) - 16, 10, 12, BONE); u.num(s.over, 1, cx(gx) + 9, cx(gy) - 13, BONE, shadow=False)
    u.line(s.over, 44 * TS, 31 * TS, cx(33), cx(17), RED, 230, 3, 3)
    u.rect(s.over, cx(33) - 1, cx(17) - 1, cx(33) + 1, cx(17) + 1, RED)
    s.place(figure('police', 'right'), 19, 21, 0.3)
    u.plate(s.over, cx(19) - 5, 21 * TS - 13, 10, 12, DIM); u.num(s.over, 1, cx(19) - 2, 21 * TS - 10, DIM, shadow=False)
    p_crew(s, 'dex', 28, 16, 'down', masked=True, extra='rifle')
    p_crew(s, 'mara', 31, 17, 'down', masked=True, sel=True)
    p_crew(s, 'jun', 21, 16, 'down', masked=True)
    for (x, y) in ((24, 19), (23, 20), (31, 20), (26, 20)): p_prone(s, x, y, body=(110, 100, 90))
    return s.crop(8, 14, offy=8)

def s_tracers():
    s = Scene()
    p_crew(s, 'dex', 28, 16, 'down', masked=True, extra='rifle')
    s.place(figure('swat', 'up'), 22, 22); s.place(figure('swat', 'up'), 25, 22)
    for (x0, y0, x1, y1) in ((cx(22), cx(22) - 8, cx(28) - 6, cx(16) + 8), (cx(22) + 2, cx(22) - 8, cx(28) + 10, cx(16) - 6)):
        u.line(s.over, x0, y0, x1, y1, (244, 226, 170), 230, 6, 5)
    for k in range(8): u.put(s.over, cx(27) + (k * 5) % 13 - 6, cx(16) + (k * 7) % 9 - 2, (240, 236, 220))
    for (x, y) in ((24, 19), (23, 20), (31, 20)): p_prone(s, x, y, body=(110, 100, 90))
    u.bracket(s.over, 22, 22, RED)
    return s.crop(14, 13)

def s_vehicle():
    s = Scene()
    reach = set()
    for dx in range(-8, 9):
        for dy in (-1, 0, 1):
            if abs(dy) * 2 > abs(dx) or dx == 0 or not (0 <= 30 + dx and 30 + dx + 4 <= W): continue
            reach |= {(x, y) for x in range(30 + dx, 34 + dx) for y in range(27 + dy, 29 + dy)}
    u.tints(s.under, {t: 'safe' for t in reach if 26 <= t[1] <= 31})
    u.rect(s.under, 37 * TS + 4, 28 * TS + 4, 41 * TS - 5, 30 * TS - 5, (32, 36, 42), 130)
    u.footprint(s.over, 37, 28, 4, 2, BONE, solid=True)
    u.path(s.over, [(33, 28), (35, 28), (36, 29), (38, 29)], BONE, end=False)
    bh.van(s.world.load(), 30, 27, (32, 36, 42), 4, 2)
    s.place(figure('civ', 'left', skin=1, body=(150, 140, 120)), 41, 25)
    p_crew(s, 'jun', 29, 25, 'right', masked=True)
    return s.crop(18, 19, offy=4)

def s_throw():
    s = Scene()
    bh.van(s.world.load(), 22, 25, (32, 36, 42), 4, 2)
    u.tints(s.under, {(24, 23): 'safe', (25, 22): 'safe', (24, 22): 'safe', (23, 23): 'safe', (25, 23): 'safe'})
    p_crew(s, 'dex', 23, 21, 'down', masked=True, extra='bag', sel=True)
    p_crew(s, 'jun', 24, 23, 'down', masked=True)
    x0, y0, x1, y1 = cx(23), cx(21) - 8, cx(24), cx(23) - 8
    for k in range(0, 31):
        t = k / 30
        if k % 2 == 0: u.rect(s.over, round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t - math.sin(math.pi * t) * 22), round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t - math.sin(math.pi * t) * 22), BONE)
    u.bracket(s.over, 24, 23, BONE)
    return s.crop(12, 15)

def s_route():
    s = Scene()
    route = [(13, 21), (14, 21), (15, 21), (16, 21), (17, 21), (18, 21), (19, 21), (20, 21), (21, 22), (22, 22), (23, 22), (24, 22), (25, 22), (26, 22), (27, 21), (28, 21), (29, 21)]
    npcs = [Npc('guard', 20, 18, -90, 'enf', future=(20, 17, -90))]
    u.tints(s.under, overlay_for(route[1:], npcs, 'clean'))
    u.path(s.under, route)
    for i, k in enumerate((5, 10, 16)):
        x, y = route[k]; u.plate(s.over, cx(x) - 5, cx(y) - 22, 10, 12, BONE); u.num(s.over, i + 1, cx(x) - 2, cx(y) - 19, BONE, shadow=False)
    s.place(figure('guard', 'up'), 20, 18, 0.3)
    for (a, b) in (((20, 18), (20, 16)), ((20, 16), (27, 16)), ((27, 16), (27, 19)), ((27, 19), (20, 19))):
        u.line(s.under, cx(a[0]), cx(a[1]), cx(b[0]), cx(b[1]), DIM, 200, 1, 4)
    u.bracket(s.over, 20, 18, DIM)
    p_civ(s, 24, 19, 'up', 0); p_civ(s, 23, 20, 'up', 1); p_civ(s, 31, 18, 'left', 2)
    for i, x in enumerate((15, 20, 25, 30)): p_teller(s, x, 14, i)
    p_crew(s, 'mara', 13, 21, 'right', sel=True)
    return s.crop(8, 11)

def s_cause():
    s = Scene()
    lobby_cast(s)
    p_crew(s, 'jun', 22, 18, 'left'); p_crew(s, 'mara', 12, 19, 'right')
    u.cone(s.under, blocks_sight, 20, 19, 0, 6, 45, AMBER, 22, dotted=True)
    u.line(s.over, cx(20) + 8, 19 * TS - 6, cx(22) - 6, 18 * TS + 6, CREW['jun'], 230, 3, 2)
    u.pips(s.over, 20, 19, 1, CREW['jun'], dy=-6)
    u.badge(s.over, 20, 19, 'q2', AMBER, dx=-22)
    return s.crop(10, 11)

def s_wall():
    s = Scene()
    for x in range(10, 20):
        for py in range(TS):
            for px in range(TS):
                if (px + py) % 6 == 0: u.put(s.under, x * TS + px, 10 * TS + py, BONE, 150)
    u.bracket(s.over, 10, 10, BONE, 10, 1, arm=10)
    p_crew(s, 'dex', 14, 12, 'up', masked=True, extra='rifle', sel=True)
    return s.crop(4, 5)

def s_desktop():
    s = Scene(); npcs = [Npc('teller5', 35, 14, 90, 'staff'), Npc('teller4', 30, 14, 90, 'staff'), Npc('cust5', 31, 18, 180, 'civ'),
                         Npc('cleaner', 37, 11, -90, 'staff', future=(39, 12, 90)), Npc('guard', 20, 19, 0, 'enf', future=(23, 19, 0))]
    route = [(35, 19), (36, 18), (37, 17), (38, 16), (39, 16), (40, 15), (40, 14)]
    u.tints(s.under, overlay_for(route[1:], npcs, 'clean'))
    lobby_cast(s, skip=('teller4', 'teller5')); p_teller(s, 35, 14, 4); p_teller(s, 30, 14, 3)
    p_cleaner(s, 37, 11, 'up'); u.arrow(s.over, [(37, 11), (39, 12)], DIM)
    u.arrow(s.over, [(20, 19), (21, 19), (22, 19), (23, 19)], BONE)
    u.path(s.under, route); u.glyph_at_tile(s.over, 40, 14, 'eye', BONE)
    p_crew(s, 'jun', 35, 19, 'up', sel=True); p_crew(s, 'mara', 12, 19, 'right')
    return s.crop(8, 8, 1280, 720)

def s_tactical():
    s = Scene()
    lobby_cast(s)
    p_cleaner(s, 38, 12, 'left'); p_guard(s, 30, 8, 180)
    s.place(figure('civ', 'down', skin=1, body=(50, 50, 70)), 5, 10); s.place(figure('civ', 'up', skin=2, body=(90, 100, 110)), 5, 4)
    p_crew(s, 'mara', 12, 19, 'right'); p_crew(s, 'jun', 28, 21, 'up')
    bh.van(s.world.load(), 30, 27, (32, 36, 42), 4, 2)
    return s.compose()

def s_blueprint():
    s = Scene(); p = s.world.load()
    known = lambda x, y: grid[y][x] in '.cRwkra' or y >= 23
    for y in range(1, 23):
        for x in range(1, 47):
            if known(x, y): continue
            for py in range(T):
                for px in range(T):
                    wall = grid[y][x] in WALLS and grid[y][x] not in 'GTE'
                    p[x * T + px, y * T + py] = (22, 28, 44) if wall else ((36, 48, 76) if (px == 0 or py == 0) and (px + py) % 2 == 0 else (28, 37, 60))
    for (qx, qy) in ((5, 4), (11, 3), (22, 4), (33, 4), (41, 4), (5, 11), (22, 8), (27, 12), (40, 8)):
        u.glyph(s.over, u.G['q'], qx * TS + 14, qy * TS + 12, (120, 140, 180))
    return s.compose()

SCENES = {
    'stealth-select': s_select, 'stealth-path': lambda: s_path(0), 'stealth-why': lambda: s_path(1), 'stealth-wait': lambda: s_path(2),
    'noise-quiet': lambda: s_noise('quiet'), 'noise-loud': lambda: s_noise('loud'), 'challenge': s_challenge, 'carriers': s_carriers,
    'go-preview': s_go_preview, 'go-after': s_go_after, 'lapse': s_lapse, 'aim': s_aim, 'aim-tight': lambda: s_aim(2),
    'watch': s_watch, 'police': s_police, 'tracers': s_tracers, 'vehicle': s_vehicle, 'throw': s_throw,
    'route': s_route, 'cause': s_cause, 'desktop': s_desktop, 'wall': s_wall, 'tactical': s_tactical, 'blueprint': s_blueprint,
}

if __name__ == '__main__':
    for name, fn in SCENES.items():
        if ONLY and name not in ONLY: continue
        save(name, fn())
