# Renders every world-space mockup frame. Usage: python3 scenes.py <out-dir> [scene ...]
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image
from bh import *
from rules import Npc, overlay_for, reachable, reaction

OUT = sys.argv[1]
ONLY = set(sys.argv[2:])
os.makedirs(OUT, exist_ok=True)
_base = None
def base():
    global _base
    if _base is None:
        cache = os.path.join(OUT, '.base-cache.png')
        if os.path.exists(cache) and os.path.getmtime(cache) > os.path.getmtime(os.path.join(os.path.dirname(__file__), 'bh.py')):
            _base = Image.open(cache).convert('RGB')
        else:
            _base = render_world(); _base.save(cache)
    return _base.copy()

def save(name, im, k=2):
    up(im, k).save(os.path.join(OUT, name + '.png')); print('wrote', name)

FACE = {'down': 90, 'up': -90, 'left': 180, 'right': 0}
def fdir(deg):
    deg = deg % 360
    return 'right' if deg < 45 or deg >= 315 else 'down' if deg < 135 else 'left' if deg < 225 else 'up'

# ---- the cast in the lobby during stealth
def p_guard(im, x, y, f, a=1.0): place(im, figure('guard', fdir(f)), x, y, a)
def p_teller(im, x, y, i=0): place(im, figure('teller', 'down', skin=i % 4, hair=[(90, 50, 30), (30, 26, 24), (160, 110, 60), (60, 40, 30)][i % 4], body=[(60, 70, 110), (110, 60, 70), (70, 96, 90), (90, 80, 120)][i % 4]), x, y)
def p_civ(im, x, y, f='down', i=0, a=1.0): place(im, figure('civ', f, skin=i % 4, hair=[(40, 30, 28), (150, 110, 70), (20, 20, 20), (110, 60, 40)][i % 4], body=[(140, 120, 90), (60, 90, 80), (120, 60, 70), (80, 80, 110), (150, 140, 120)][i % 5]), x, y, a)
def p_cleaner(im, x, y, f): place(im, figure('civ', f, skin=2, hair=(30, 26, 24), body=(70, 110, 120), legs=(50, 70, 80)), x, y)
def p_crew(im, who, x, y, f='down', masked=False, extra=None, sel=False):
    looks = {'mara': dict(skin=3, hair=(120, 50, 40), body=(52, 60, 74)), 'jun': dict(skin=1, hair=(20, 18, 22), body=(74, 70, 64)),
             'dex': dict(skin=0, hair=(60, 40, 30), body=(40, 42, 48)), 'sol': dict(skin=2, hair=(30, 24, 24), body=(56, 50, 66))}[who]
    crew_ring(im, x, y, CREW[who])
    place(im, figure('mask' if masked else 'civ', f, extra=extra, extra_c=CREW[who], **looks), x, y)
    if sel: bracket(im, x, y, CREW[who])

LOBBY_NPCS = lambda: [
    Npc('guard', 20, 19, 0, 'enf', future=(23, 19, 0)),
    Npc('teller1', 15, 14, 90, 'staff'), Npc('teller2', 20, 14, 90, 'staff'), Npc('teller3', 25, 14, 90, 'staff'),
    Npc('teller4', 30, 14, 90, 'staff'), Npc('teller5', 35, 14, 90, 'staff'),
    Npc('cust1', 24, 19, -90, 'civ'), Npc('cust2', 23, 20, -90, 'civ'), Npc('cust3', 31, 18, 180, 'civ'), Npc('cust4', 13, 21, 0, 'civ'),
    Npc('cust5', 35, 20, 180, 'civ'),
]
def draw_lobby_cast(im, skip=()):
    if 'guard' not in skip: p_guard(im, 20, 19, 0)
    for i, x in enumerate((15, 20, 25, 30, 35)):
        if f'teller{i+1}' not in skip: p_teller(im, x, 14, i)
    p_civ(im, 24, 19, 'up', 0); p_civ(im, 23, 20, 'up', 1); p_civ(im, 31, 18, 'left', 2); p_civ(im, 13, 21, 'right', 3); p_civ(im, 35, 20, 'left', 4)

def overlay(im, tiles_info, sel_tile=None):
    tints(im, tiles_info, skip=(sel_tile,))

# =============================================================== stealth
def s_select():
    im = base()
    npcs = LOBBY_NPCS()
    occ = {(n.x, n.y) for n in npcs}
    reach = reachable(28, 21, 5, occ)
    info = overlay_for(reach.keys(), npcs, 'concealed')
    overlay(im, info, (28, 21))
    for t, (kind, r, who) in info.items():
        if kind in ('amber', 'red'): pass
    draw_lobby_cast(im)
    arrow(im, [(20, 19), (21, 19), (22, 19), (23, 19)], WHITE)      # guard's committed patrol step
    arrow(im, [(24, 19), (24, 18), (24, 16)], (200, 200, 200))      # customer to the window
    p_crew(im, 'jun', 28, 21, 'up', sel=True)
    p_crew(im, 'mara', 12, 19, 'right')
    return crop(im, 10, 11)

def s_path(stage):
    """stage 0: drag shows the eye on the first unsafe tile; 1: long-press explains it; 2: after Wait 1, the route is clean."""
    im = base()
    jx, jy = 35, 19
    cleaner_now = (37, 11, -90) if stage < 2 else (33, 11, 180)
    cleaner_next = (39, 12, 90) if stage < 2 else (29, 11, 180)
    npcs = [Npc('teller5', 35, 14, 90, 'staff'), Npc('teller4', 30, 14, 90, 'staff'), Npc('cust5', 31, 18, 180, 'civ'),
            Npc('cleaner', cleaner_now[0], cleaner_now[1], cleaner_now[2], 'staff', future=cleaner_next)]
    route = [(35, 19), (36, 18), (37, 17), (38, 16), (39, 16), (40, 15), (40, 14)]
    info = overlay_for(route[1:], npcs, 'clean')
    first_bad = next((t for t in route[1:] if info[t][0] != 'safe'), None)
    tints(im, info)
    p_teller(im, 35, 14, 4); p_teller(im, 30, 14, 3); p_civ(im, 31, 18, 'left', 2)
    p_cleaner(im, cleaner_now[0], cleaner_now[1], fdir(cleaner_now[2]))
    arrow(im, [(cleaner_now[0], cleaner_now[1]), (cleaner_next[0], cleaner_next[1])], (200, 200, 200))
    if stage == 1:
        # the cleaner's position next phase, ghosted, with its view and the sightline to the tile
        place(im, figure('civ', fdir(cleaner_next[2]), skin=2, hair=(30, 26, 24), body=(70, 110, 120), legs=(50, 70, 80)), cleaner_next[0], cleaner_next[1], 0.45)
        cone(im, cleaner_next[0], cleaner_next[1], cleaner_next[2], 6, 45, AMBER, 0.10, dotted=True)
        line(im, ctr(cleaner_next[0]), ctr(cleaner_next[1]), ctr(first_bad[0]), ctr(first_bad[1]), INK, 0, 0, 3)
        line(im, ctr(cleaner_next[0]), ctr(cleaner_next[1]), ctr(first_bad[0]), ctr(first_bad[1]), AMBER, 3, 2)
        bracket(im, first_bad[0], first_bad[1], WHITE)
    path(im, route, WHITE)
    if first_bad and stage != 2: tile_icon(im, first_bad[0], first_bad[1], 'eye', WHITE)
    p_crew(im, 'jun', jx, jy, 'up', sel=True)
    return crop(im, 20, 9)

def s_noise(kind):
    im = base()
    if kind == 'quiet':
        src = (11, 3)
        tiles = ring_tiles(src, 1)
        ring(im, tiles, (120, 200, 255))
        p_cleaner(im, 13, 8, 'up')
        p_guard(im, 6, 9, 0)
        p_crew(im, 'jun', 11, 3, 'up', sel=True)
        # an NPC outside the ring gets no ear: nothing to show
        return crop(im, 1, 0, offy=8)
    src = (28, 19)
    tiles = ring_tiles(src, 8)
    ring(im, tiles, (255, 120, 90), 0.07)
    draw_lobby_cast(im)
    p_cleaner(im, 38, 12, 'left')
    p_crew(im, 'jun', 28, 19, 'left', sel=True, extra=None)
    for (x, y) in ((20, 19), (15, 14), (20, 14), (25, 14), (30, 14), (35, 14), (24, 19), (23, 20), (31, 18), (35, 20), (38, 12)):
        if (x, y) in tiles: badge(im, x, y, 'ear', RED, sym='!')
    return crop(im, 10, 10)

def s_challenge():
    im = base()
    p_teller(im, 35, 14, 4); p_teller(im, 30, 14, 3)
    p_guard(im, 40, 11, 180)
    arrow(im, [(40, 11), (39, 12)], WHITE)
    badge(im, 40, 11, 'hand', AMBER)
    p_crew(im, 'mara', 37, 12, 'right', sel=True)
    # where she has to be by the end of this crew phase
    path(im, [(37, 12), (38, 13), (39, 14), (40, 15), (40, 16)], SAFE, 2, 2)
    tint(im, 40, 16, 'safe'); tile_icon(im, 40, 16, 'run', WHITE)
    badge(im, 37, 12, 'hand', AMBER, n=1)
    return crop(im, 21, 7)

def s_carriers():
    im = base()
    p_guard(im, 20, 19, 0)
    for i, x in enumerate((15, 20, 25, 30, 35)):
        p_teller(im, x, 14, i)
    p_civ(im, 24, 19, 'down', 0); p_civ(im, 31, 18, 'left', 2); p_civ(im, 13, 21, 'right', 3)
    p_crew(im, 'jun', 27, 18, 'left', extra='rifle')
    badge(im, 30, 14, 'bell', RED, n=2)                              # teller foot rail
    badge(im, 20, 19, 'radio', RED, n=2); cone(im, 20, 19, -20, 8, 45, RED, 0.10)
    arrow(im, [(13, 21), (14, 22), (19, 22), (22, 22)], RED)          # escapee
    badge(im, 13, 21, 'run', RED, n=3)
    badge(im, 24, 19, 'drop', AMBER); badge(im, 31, 18, 'drop', AMBER)
    return crop(im, 15, 11)

# =============================================================== takeover
def los_tiles(src, radius):
    from rules import los
    out = set()
    for y in range(H):
        for x in range(W):
            if math.hypot(x - src[0], y - src[1]) <= radius and not is_wall(x, y) and los(src[0], src[1], x, y): out.add((x, y))
    return out

def command_rings(im, src, cmd_r):
    cmd = los_tiles(src, cmd_r)
    panic = ring_tiles(src, cmd_r + 3) - cmd
    p = im.load()
    for (x, y) in cmd:
        for py in range(T):
            for px in range(T):
                if (px // 2 + py // 2) % 2 == 0: blend(im, x * T + px, y * T + py, (120, 200, 255), 0.22)
    ring(im, cmd, (140, 210, 255), 0.0)
    for (x, y) in panic:
        for py in range(T):
            for px in range(T):
                if (px + py) % 6 == 0: blend(im, x * T + px, y * T + py, AMBER, 0.5)
    ring(im, panic | cmd, AMBER, 0.0)
    return cmd, panic

def s_go_preview():
    im = base()
    src = (28, 21)
    cmd, panic = command_rings(im, src, 9)
    draw_lobby_cast(im)
    p_cleaner(im, 38, 12, 'left')
    p_civ(im, 42, 17, 'down', 1)
    p_crew(im, 'dex', 28, 21, 'up', masked=True, extra='rifle', sel=True)
    p_crew(im, 'mara', 41, 21, 'left', masked=True)
    for (x, y) in ((24, 19), (23, 20), (31, 18), (35, 20), (15, 14), (20, 14), (25, 14), (30, 14), (35, 14), (13, 21)):
        if (x, y) in cmd: badge(im, x, y, 'down', (140, 210, 255))
        elif (x, y) in panic: badge(im, x, y, 'drop', AMBER)
    if (42, 17) in panic: badge(im, 42, 17, 'drop', AMBER)
    if (38, 12) in panic: badge(im, 38, 12, 'drop', AMBER)
    badge(im, 20, 19, 'star', (140, 210, 255))   # guard: surprised, resist chance shown in the HUD chip
    return crop(im, 16, 11)

def s_go_after():
    im = base()
    for i, x in enumerate((15, 20, 25, 30, 35)):
        place(im, prone(body=[(60, 70, 110), (110, 60, 70), (70, 96, 90), (90, 80, 120), (60, 70, 110)][i], skin=i % 4), x, 14)
        pips(im, x, 14, 2, (140, 210, 255), total=2, offy=2)
    for (x, y, i) in ((24, 18, 0), (23, 20, 1), (31, 18, 2), (35, 20, 4), (13, 21, 3)):
        place(im, prone(body=[(140, 120, 90), (60, 90, 80), (120, 60, 70), (80, 80, 110), (150, 140, 120)][i], skin=i % 4), x, y)
        pips(im, x, y, 2, (140, 210, 255), total=2, offy=2)
    place(im, prone(body=(40, 50, 90), tied=True), 21, 19); badge(im, 21, 19, 'knot', WHITE)
    place(im, figure('guard', 'right'), 20, 19, 0.0)
    p_crew(im, 'dex', 27, 20, 'up', masked=True, extra='rifle')
    p_crew(im, 'mara', 30, 16, 'up', masked=True, sel=True)
    p_crew(im, 'jun', 22, 19, 'left', masked=True)
    # Hold: Dex holds the lobby, so pips in his radius and sight are frozen
    hold = los_tiles((27, 20), 6)
    ring(im, hold, (140, 210, 255), 0.0)
    badge(im, 27, 20, 'lock', (140, 210, 255))
    p_civ(im, 42, 17, 'down', 1); badge(im, 42, 17, 'phone', RED, n=2)     # hiding in the restroom: phone carrier
    return crop(im, 11, 11)

def s_lapse():
    im = base()
    place(im, prone(body=(140, 120, 90)), 24, 18); pips(im, 24, 18, 1, (140, 210, 255), total=2, offy=2)
    place(im, prone(body=(60, 90, 80), skin=1), 23, 20); pips(im, 23, 20, 2, (140, 210, 255), total=2, offy=2)
    # twitchy: pips ran out, intent rolled and shown a turn ahead
    place(im, prone(body=(120, 60, 70), skin=2), 31, 18)
    arrow(im, [(31, 18), (30, 19), (28, 21), (26, 22), (25, 23)], RED)
    badge(im, 31, 18, 'run', RED, n=2)
    place(im, prone(body=(80, 80, 110), skin=3), 33, 20)
    badge(im, 33, 20, 'hand', RED)                        # reaching for a weapon
    line(im, ctr(33, ), ctr(20), ctr(30), ctr(20), RED, 1, 2) if False else None
    place(im, prone(body=(150, 140, 120)), 35, 21); badge(im, 35, 21, 'down', (140, 210, 255))
    p_crew(im, 'dex', 27, 19, 'right', masked=True, extra='rifle', sel=True)
    p_crew(im, 'mara', 34, 16, 'down', masked=True)
    return crop(im, 18, 12)

# =============================================================== loud
def s_aim(bullets=6):
    im = base()
    shooter = (24, 21)
    tgt = (31, 19)
    p_civ(im, 33, 20, 'left', 1)
    place(im, prone(body=(140, 120, 90)), 27, 20)
    sx, sy = ctr(shooter[0]), ctr(shooter[1])
    ang = math.degrees(math.atan2(ctr(tgt[1]) - sy, ctr(tgt[0]) - sx))
    arcs(im, sx, sy, ang, 14, 3, bullets, 8)
    p_guard(im, 31, 19, 180)
    p_guard(im, 30, 16, 180)
    for i, x in enumerate((25, 35)): p_teller(im, x, 14, i + 2)
    p_crew(im, 'mara', 24, 21, 'right', masked=True, sel=True)
    body_marker(im, 31, 19, 'hostile'); icon(im, 'halfshield', 31 * T - 2, 19 * T + 5, WHITE)
    body_marker(im, 30, 16, 'hostile')
    body_marker(im, 33, 20, 'civ')
    return crop(im, 15, 12)

def s_watch():
    im = base()
    # police officer's wedge, visible because the crew can see him
    cone(im, 24, 23, -90, 8, 22, RED, 0.16)
    place(im, figure('police', 'up'), 24, 23)
    # crew wedge being dragged
    cone(im, 32, 17, 150, 8, 30, (120, 200, 255), 0.18)
    p_crew(im, 'dex', 32, 17, 'left', masked=True, extra='rifle', sel=True)
    p_crew(im, 'mara', 36, 18, 'left', masked=True)
    for (x, y, i) in ((24, 18, 0), (23, 20, 1), (31, 19, 2)):
        place(im, prone(body=[(140, 120, 90), (60, 90, 80), (120, 60, 70)][i]), x, y)
    return crop(im, 15, 12)

def s_police():
    im = base()
    for x in range(9, 14):
        if grid[23][x] == 'G':
            for py in range(5, 11):
                for px in range(T):
                    if (px * 7 + py * 3) % 5 == 0: im.load()[x * T + px, 23 * T + py] = (40, 50, 60)
    van(im.load(), 9, 26, (230, 230, 236), 3, 2, roof=(30, 40, 90)); rect(im.load(), 10 * T, 26 * T + 4, 10 * T + 6, 26 * T + 7, (220, 50, 50)); rect(im.load(), 10 * T + 7, 26 * T + 4, 10 * T + 13, 26 * T + 7, (60, 90, 230))
    van(im.load(), 30, 27, (32, 36, 42), 4, 2)
    for (x, y) in ((12, 25), (14, 25)): place(im, figure('police', 'up'), x, y)
    cone(im, 14, 25, -75, 8, 22, RED, 0.12)
    # breach next phase on the staff door and a window
    for (bx, by) in ((16, 23),):
        bracket(im, bx, by, RED); tile_icon(im, bx, by, 'bolt', RED); text(im, bx * T + 12, by * T - 6, '1', RED)
    # a grenade has landed: radius drawn, goes off at the start of the next world phase
    gx, gy = 28, 18
    for (x, y) in los_tiles((gx, gy), 2):
        for py in range(T):
            for px in range(T):
                if (px + py) % 3 == 0: blend(im, x * T + px, y * T + py, (255, 240, 200), 0.45)
    ring(im, los_tiles((gx, gy), 2), (255, 240, 200), 0.0)
    dot(im, ctr(gx), ctr(gy), (40, 50, 40), 2); dot(im, ctr(gx), ctr(gy) - 1, (120, 140, 110), 0)
    text(im, ctr(gx) + 5, ctr(gy) - 9, '1', (255, 240, 200))
    # sniper line from the neighbour building
    line(im, 44 * T, 31 * T, ctr(33), ctr(17), RED, 2, 2)
    dot(im, ctr(33), ctr(17), RED, 1)
    # a ghost where an officer was last seen
    place(im, figure('police', 'right'), 19, 21, 0.35); text(im, 19 * T + 4, 21 * T - 7, '1', (200, 200, 210))
    p_crew(im, 'dex', 28, 16, 'down', masked=True, extra='rifle')
    p_crew(im, 'mara', 31, 17, 'down', masked=True, sel=True)
    p_crew(im, 'jun', 21, 16, 'down', masked=True)
    for (x, y) in ((24, 19), (23, 20), (31, 20), (26, 20)): place(im, prone(body=(110, 100, 90)), x, y)
    return crop(im, 8, 14, offy=8)

def s_tracers():
    im = base()
    p_crew(im, 'dex', 28, 16, 'down', masked=True, extra='rifle')
    place(im, figure('swat', 'up'), 22, 22)
    place(im, figure('swat', 'up'), 25, 22, 1.0)
    for i, (x0, y0, x1, y1) in enumerate(((ctr(22), ctr(22) - 4, ctr(28) - 3, ctr(16) + 4), (ctr(22), ctr(22) - 4, ctr(28) + 6, ctr(16) - 3))):
        line(im, x0, y0, x1, y1, (255, 236, 170), 3, 3)
    for k in range(6): dot(im, ctr(27) + (k * 5) % 9 - 4, ctr(16) + (k * 7) % 7 - 1, (250, 250, 230), 0)
    for (x, y) in ((24, 19), (23, 20), (31, 20)): place(im, prone(body=(110, 100, 90)), x, y)
    bracket(im, 22, 22, RED)
    return crop(im, 14, 13)

# =============================================================== sandbox
def s_vehicle():
    im = base()
    p = im.load()
    reach = set()
    for dx in range(-8, 9):
        for dy in (-1, 0, 1):
            if abs(dy) * 2 > abs(dx) or dx == 0: continue
            if 0 <= 30 + dx and 30 + dx + 4 <= W:
                for x in range(30 + dx, 34 + dx):
                    for y in range(27 + dy, 29 + dy): reach.add((x, y))
    reach = {(x, y) for (x, y) in reach if 26 <= y <= 31}
    tints(im, {t: 'safe' for t in reach})
    # the chosen end position, ghosted, and the swept path
    for y in range(28 * T + 2, 30 * T - 2):
        for x in range(37 * T + 2, 41 * T - 2): blend(im, x, y, (32, 36, 42), 0.5)
    bracket(im, 37, 28, WHITE, 4, 2)
    path(im, [(33, 28), (35, 28), (36, 29), (38, 29)], WHITE, 3, 2, end=False)
    van(p, 30, 27, (32, 36, 42), 4, 2)
    place(im, figure('civ', 'left', skin=1, body=(150, 140, 120)), 41, 25)
    p_crew(im, 'jun', 29, 25, 'right', masked=True)
    return crop(im, 18, 19, offy=4)

def s_throw():
    im = base()
    p_crew(im, 'dex', 23, 21, 'down', masked=True, extra='bag', sel=True)
    p_crew(im, 'jun', 24, 23, 'down', masked=True)
    van(im.load(), 22, 25, (32, 36, 42), 4, 2)
    # throw arc: dotted parabola from Dex to Jun
    x0, y0, x1, y1 = ctr(23), ctr(21) - 4, ctr(24), ctr(23) - 4
    for k in range(0, 21):
        t = k / 20; x = x0 + (x1 - x0) * t; y = y0 + (y1 - y0) * t - math.sin(math.pi * t) * 10
        if k % 2 == 0: dot(im, round(x), round(y), WHITE, 0)
    tints(im, {(24, 23): 'safe', (25, 22): 'safe', (24, 22): 'safe', (23, 23): 'safe', (25, 23): 'safe'})
    bracket(im, 24, 23, WHITE)
    return crop(im, 12, 15)

# =============================================================== reading the bank
def s_route():
    """Auto-advance: a multi-turn route with turn ends marked, and a known routine shown as a predicted marker."""
    im = base()
    route = [(13, 21), (14, 21), (15, 21), (16, 21), (17, 21), (18, 21), (19, 21), (20, 21), (21, 22), (22, 22), (23, 22), (24, 22), (25, 22), (26, 22), (27, 21), (28, 21), (29, 21)]
    npcs = [Npc('guard', 20, 18, -90, 'enf', future=(20, 17, -90))]
    info = overlay_for(route[1:], npcs, 'clean')
    tints(im, info)
    path(im, route, WHITE)
    for i, k in enumerate((5, 10, 16)):
        x, y = route[k]
        rect(im.load(), x * T + 5, y * T - 1, x * T + 11, y * T + 6, INK); text(im, x * T + 7, y * T, str(i + 1), WHITE, None)
    # guard on a known routine, currently out of sight behind the pillar: predicted marker plus its loop
    place(im, figure('guard', 'up'), 20, 18, 0.35)
    for (a, b) in (((20, 18), (20, 16)), ((20, 16), (27, 16)), ((27, 16), (27, 19)), ((27, 19), (20, 19))):
        line(im, ctr(a[0]), ctr(a[1]), ctr(b[0]), ctr(b[1]), (200, 200, 210), 1, 3)
    bracket(im, 20, 18, (200, 200, 210))
    p_civ(im, 24, 19, 'up', 0); p_civ(im, 23, 20, 'up', 1); p_civ(im, 31, 18, 'left', 2)
    for i, x in enumerate((15, 20, 25, 30)): p_teller(im, x, 14, i)
    p_crew(im, 'mara', 13, 21, 'right', sel=True)
    return crop(im, 8, 11)

def s_cause():
    """World phase: a guard's suspicion rises, and the change draws a line to its cause."""
    im = base()
    draw_lobby_cast(im)
    p_crew(im, 'jun', 22, 18, 'left')
    p_crew(im, 'mara', 12, 19, 'right')
    line(im, ctr(20), ctr(19) - 6, ctr(22), ctr(18) - 4, CREW['jun'], 2, 1)
    pips(im, 20, 19, 1, CREW['jun'], offy=-5)
    cone(im, 20, 19, 0, 6, 45, AMBER, 0.08, dotted=True)
    badge(im, 20, 19, '?', AMBER, offx=12)
    return crop(im, 10, 11)

def s_wall():
    im = base()
    p = im.load()
    for x in range(10, 20):
        for py in range(T):
            for px in range(T):
                if (px + py) % 4 == 0: blend(im, x * T + px, 10 * T + py, WHITE, 0.5)
    bracket(im, 10, 10, WHITE, 10, 1)
    p_crew(im, 'dex', 14, 12, 'up', masked=True, extra='rifle', sel=True)
    return crop(im, 4, 5)

def s_tactical():
    im = base()
    draw_lobby_cast(im)
    p_cleaner(im, 38, 12, 'left'); p_guard(im, 30, 8, 180); place(im, figure('civ', 'down', skin=1, body=(50, 50, 70)), 5, 10)
    place(im, figure('civ', 'up', skin=2, body=(90, 100, 110)), 5, 4)
    p_crew(im, 'mara', 12, 19, 'right'); p_crew(im, 'jun', 28, 21, 'up')
    van(im.load(), 30, 27, (32, 36, 42), 4, 2)
    return im

def s_blueprint():
    im = base()
    p = im.load()
    known = lambda x, y: grid[y][x] in '.cRwkra' or y >= 23
    for y in range(1, 23):
        for x in range(1, 47):
            if known(x, y): continue
            for py in range(T):
                for px in range(T):
                    X, Y = x * T + px, y * T + py
                    if grid[y][x] in WALLS and grid[y][x] not in 'GTE':
                        p[X, Y] = (24, 32, 58)
                    else:
                        p[X, Y] = (40, 56, 96) if (px == 0 or py == 0) and (x + y) % 1 == 0 and px % 2 == 0 and py % 2 == 0 else (32, 44, 78)
    for (cx, cy) in ((5, 4), (11, 3), (22, 4), (33, 4), (41, 4), (5, 11), (22, 8), (27, 12), (40, 8)):
        text(im, cx * T + 4, cy * T + 4, '?', (110, 140, 200), (20, 26, 48), scale=2)
    return im

SCENES = {
    'stealth-select': s_select,
    'stealth-path': lambda: s_path(0),
    'stealth-why': lambda: s_path(1),
    'stealth-wait': lambda: s_path(2),
    'noise-quiet': lambda: s_noise('quiet'),
    'noise-loud': lambda: s_noise('loud'),
    'challenge': s_challenge,
    'carriers': s_carriers,
    'go-preview': s_go_preview,
    'go-after': s_go_after,
    'lapse': s_lapse,
    'aim': s_aim,
    'aim-tight': lambda: s_aim(2),
    'watch': s_watch,
    'police': s_police,
    'tracers': s_tracers,
    'vehicle': s_vehicle,
    'throw': s_throw,
    'route': s_route,
    'cause': s_cause,
    'wall': s_wall,
}
FULL = {'tactical': s_tactical, 'blueprint': s_blueprint}

if __name__ == '__main__':
    for name, fn in SCENES.items():
        if ONLY and name not in ONLY: continue
        save(name, fn())
    for name, fn in FULL.items():
        if ONLY and name not in ONLY: continue
        fn().save(os.path.join(OUT, name + '.png')); print('wrote', name)
