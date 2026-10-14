# Every world-space mockup frame, staged in the game's example bank and drawn by the game itself.
#
#   python3 scenes.py cast <dir> [scene ...]      writes <dir>/cast.json: who stands where, and the view, for capture.mjs
#   node capture.mjs <dir> [scene ...]            renders <scene>-world.png, -floor.png (and -ghosts.png) with the game
#   python3 scenes.py compose <dir> [scene ...]   draws the world UI over them and writes <dir>/<scene>.png
#
# A frame is four layers, as the game would draw them: the floor (the capture without the cast), floor UI (tints, paths,
# rings, cones), the cast (lifted out of the difference between the two captures) and actor UI (plates, pips, markers).
# UI is drawn at twice the art resolution, on a layer the size of the whole map, and cropped to the view.
import sys, os, math, json
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageChops
import level as lv
from level import W, H, ringTiles, reachable, los, Sight
import ui2 as u
from ui2 import TS, cx, SAFE, AMBER, RED, GREY, CMD, BONE, INK, DIM, CREW
from rules import Npc, overlayFor

CREWLOOK = {'mara': ('crewMara', 'balaclava'), 'jun': ('crewJun', 'hockey'), 'dex': ('crewDex', 'skull'), 'sol': ('crewSol', 'respirator')}

def sprite(deg):
    """The game draws people facing the camera or away from it: away when they look north."""
    return 'back' if -135 < ((deg + 180) % 360 - 180) < -45 else 'front'

def sight(ox, oy): return Sight(ox, oy, TS)

class Scene:
    """A view of the example bank: its top-left corner in tiles (and art pixels more), its size in CSS pixels."""
    def __init__(self, tx0, ty0, dx=0, dy=0, width=844, height=390, mapView=False, outlines=None, moveProps=None, plotOnly=False):
        self.left, self.top, self.width, self.height = tx0 * 16 + dx, ty0 * 16 + dy, width, height
        self.mapView, self.outlines, self.moveProps, self.plotOnly = mapView, outlines, moveProps, plotOnly
        self.people, self.ghosts = [], []
        self.under = u.layer(W * TS, H * TS)
        self.over = u.layer(W * TS, H * TS)

    def add(self, look, x, y, facing=90, pose=None, mask=None, ghost=False):
        p = {'look': look, 'tx': x, 'ty': y, 'facing': sprite(facing)}
        if pose: p['pose'] = pose
        if mask: p['mask'] = mask
        (self.ghosts if ghost else self.people).append(p)

    def crew(self, who, x, y, facing=-90, masked=False, sel=False, ring=True):
        look, mask = CREWLOOK[who]
        if ring: u.crew_ring(self.under, x, y, CREW[who])
        self.add(look, x, y, facing, mask=mask if masked else None)
        if sel: u.bracket(self.over, x, y, CREW[who])

    def prone(self, look, x, y, tied=False):
        self.add(look, x, y, pose='tied' if tied else 'prone')

    def shot(self):
        s = {'left': self.left, 'top': self.top, 'width': self.width, 'height': self.height, 'people': self.people}
        if self.ghosts: s['ghosts'] = self.ghosts
        if self.mapView: s['map'] = True
        if self.outlines: s['outlines'] = self.outlines
        if self.moveProps: s['moveProps'] = self.moveProps
        return s

    def compose(self, d, name, view):
        floor = Image.open(os.path.join(d, f'{name}-floor.png')).convert('RGBA')
        world = Image.open(os.path.join(d, f'{name}-world.png')).convert('RGBA')
        if self.mapView:
            plot = view['plot']
            return (world.crop((round(plot['left']), round(plot['top']), round(plot['right']), round(plot['bottom']))) if self.plotOnly else world).convert('RGB')
        ox, oy = -view['plot']['left'], -view['plot']['top']
        crop = lambda layer: layer.crop((ox, oy, ox + self.width, oy + self.height))
        im = floor.copy()
        im.alpha_composite(crop(self.under))
        im.alpha_composite(lifted(world, floor))
        if self.ghosts:
            g = lifted(Image.open(os.path.join(d, f'{name}-ghosts.png')).convert('RGBA'), floor)
            g.putalpha(g.split()[3].point(lambda v: v * 11 // 20))
            im.alpha_composite(g)
        im.alpha_composite(crop(self.over))
        return im.convert('RGB')

def lifted(img, floor):
    """The pixels where the cast changed the picture: the people and their drop shadows."""
    mask = ImageChops.difference(img.convert('RGB'), floor.convert('RGB')).convert('L').point(lambda v: 255 if v > 6 else 0)
    out = img.copy(); out.putalpha(mask)
    return out

# ---------------------------------------------------------------- the lobby's people
TELLERS = [('teller', 23), ('tellerB', 27), ('headTeller', 35)]
COUNTER = [('customerSuit', 23), ('customerCoat', 27), ('customerDress', 35)]

def lobbyNpcs():
    return [Npc('guard', 33, 23, -90, 'enf', future=(33, 21, -90))] + \
        [Npc(look, x, 14, 90, 'staff') for look, x in TELLERS] + \
        [Npc(look, x, 16, -90, 'civ') for look, x in COUNTER] + \
        [Npc('customerCasual', 30, 18, -90, 'civ'), Npc('customerOld', 24, 21, -90, 'civ')]

def lobbyCast(s, skip=()):
    for n in lobbyNpcs():
        if n.name not in skip: s.add(n.name, n.x, n.y, n.facing)

def losTiles(src, radius):
    return {(x, y) for y in range(H) for x in range(W)
            if math.hypot(x - src[0], y - src[1]) <= radius and lv.walkable(x, y) and los(src[0], src[1], x, y)}

# =============================================================== stealth
def sSelect():
    s = Scene(16, 13); npcs = lobbyNpcs()
    reach = reachable(30, 23, 5, {(n.x, n.y) for n in npcs})
    u.tints(s.under, overlayFor(reach.keys(), npcs, 'concealed'), skip=((30, 23),))
    lobbyCast(s)
    u.arrow(s.over, [(33, 23), (33, 22), (33, 21)], BONE)
    u.arrow(s.over, [(30, 18), (30, 17)], DIM)
    s.crew('jun', 30, 23, sel=True); s.crew('mara', 21, 19, 0)
    return s

ROUTE = [(37, 21), (38, 20), (38, 19), (38, 18), (38, 17), (38, 16), (38, 15), (38, 14)]

def sPath(stage):
    s = Scene(21, 10)
    now = (42, 14, 180) if stage < 2 else (46, 16, 0)
    nxt = (39, 14, 180) if stage < 2 else (48, 16, 0)
    npcs = [Npc('headTeller', 35, 14, 90, 'staff'), Npc('tellerB', 27, 14, 90, 'staff'), Npc('customerDress', 35, 16, -90, 'civ'),
            Npc('cleaner', now[0], now[1], now[2], 'staff', future=nxt)]
    info = overlayFor(ROUTE[1:], npcs, 'clean')
    bad = next((t for t in ROUTE[1:] if info[t][0] != 'safe'), None)
    u.tints(s.under, info)
    for n in npcs: s.add(n.name, n.x, n.y, n.facing)
    u.arrow(s.over, [(now[0], now[1]), (nxt[0], nxt[1])], DIM)
    if stage == 1:
        s.add('cleaner', nxt[0], nxt[1], nxt[2], ghost=True)
        u.cone(s.under, sight, nxt[0], nxt[1], nxt[2], 6, 45, AMBER, 26, dotted=True)
        u.line(s.over, cx(nxt[0]), cx(nxt[1]) - 8, cx(bad[0]), cx(bad[1]), AMBER, 240, 3, 2)
        u.bracket(s.over, bad[0], bad[1], BONE)
    u.path(s.under, ROUTE)
    if bad and stage != 2: u.glyph_at_tile(s.over, bad[0], bad[1], 'eye', BONE)
    s.crew('jun', 37, 21, sel=True)
    s.add('customerCasual', 30, 18, -90)
    return s, bad

def sNoise(kind):
    if kind == 'quiet':
        s = Scene(2, 1, dy=6)
        u.ring(s.under, ringTiles((13, 5), 1), CMD, fill=26)
        s.add('guard', 18, 12, 180); s.add('operator', 24, 12, 180)
        s.crew('jun', 13, 5, sel=True)
        return s
    s = Scene(16, 11)
    tiles = ringTiles((27, 20), 8)
    u.ring(s.under, tiles, RED, fill=40)
    npcs = [n for n in lobbyNpcs() if n.name != 'guard'] + [Npc('guard', 33, 21, -90, 'enf')]
    for n in npcs: s.add(n.name, n.x, n.y, n.facing)
    s.crew('jun', 27, 20, 180, sel=True); s.crew('mara', 21, 19, 0)
    for n in npcs:
        if (n.x, n.y) in tiles: u.badge(s.over, n.x, n.y, 'waves', RED, sym='!')
    return s

def sChallenge():
    s = Scene(22, 10)
    s.add('headTeller', 35, 14, 90); s.add('tellerB', 27, 14, 90); s.add('customerDress', 35, 16, -90)
    s.add('guard', 39, 18, -120)
    u.arrow(s.over, [(39, 18), (39, 17)], BONE)
    u.badge(s.over, 39, 18, 'hand', AMBER)
    u.tints(s.under, {(38, 16): 'safe'})
    u.path(s.under, [(37, 14), (38, 15), (38, 16)], SAFE)
    u.glyph_at_tile(s.over, 38, 16, 'run', SAFE)
    s.crew('mara', 37, 14, 0, sel=True)
    u.badge(s.over, 37, 14, 'hand', AMBER, n=1)
    return s

def sCarriers():
    s = Scene(16, 11, dy=6)
    lobbyCast(s, skip=('customerOld',))
    s.add('customerOld', 24, 22, 90)
    s.crew('jun', 29, 20, 180)
    u.cone(s.under, sight, 33, 23, -150, 8, 45, RED, 34)
    u.badge(s.over, 23, 14, 'bell', RED, n=2)
    u.badge(s.over, 33, 23, 'radio', RED, n=2)
    u.arrow(s.over, [(24, 22), (25, 23), (27, 25), (29, 26), (29, 27)], RED)
    u.badge(s.over, 24, 22, 'run', RED, n=3)
    for x, y in ((23, 16), (35, 16), (30, 18)): u.badge(s.over, x, y, 'drops', AMBER)
    return s

# =============================================================== takeover
def commandRings(s, src, cmdR):
    cmd = losTiles(src, cmdR)
    panic = ringTiles(src, cmdR + 3) - cmd
    u.ring(s.under, cmd, CMD, fill=34, dotted=False)
    for (x, y) in panic:
        for py in range(TS):
            for px in range(TS):
                if (px + py) % 8 == 0: u.put(s.under, x * TS + px, y * TS + py, AMBER, 120)
    u.ring(s.under, panic | cmd, AMBER)
    return cmd, panic

def sGoPreview():
    s = Scene(16, 12)
    cmd, panic = commandRings(s, (30, 22), 9)
    lobbyCast(s)
    s.add('cleaner', 42, 22, 180)
    s.crew('dex', 30, 22, masked=True, sel=True); s.crew('mara', 37, 24, 180, masked=True)
    s.crew('jun', 22, 24, 0, masked=True); s.crew('sol', 25, 18, -45, masked=True)
    for n in lobbyNpcs() + [Npc('cleaner', 42, 22, 180, 'staff')]:
        if n.name == 'guard': continue
        if (n.x, n.y) in cmd: u.badge(s.over, n.x, n.y, 'down', CMD)
        elif (n.x, n.y) in panic: u.badge(s.over, n.x, n.y, 'drops', AMBER)
    u.badge(s.over, 33, 23, 'star', CMD)
    return s

HOSTAGES = [('customerSuit', 23, 17), ('customerCoat', 27, 17), ('customerDress', 34, 17), ('customerCasual', 30, 19), ('customerOld', 25, 21)]

def sGoAfter():
    s = Scene(16, 12)
    for look, x in TELLERS: s.prone(look, x, 14); u.pips(s.over, x, 14, 2, CMD, total=2, dy=-12)
    for look, x, y in HOSTAGES: s.prone(look, x, y); u.pips(s.over, x, y, 2, CMD, total=2, dy=-12)
    s.prone('guard', 33, 22, tied=True); u.badge(s.over, 33, 22, 'knot', BONE, lying=True)
    s.crew('dex', 30, 23, masked=True); u.badge(s.over, 30, 23, 'lock', CMD)
    u.ring(s.under, losTiles((30, 23), 6), CMD)
    s.crew('mara', 36, 21, 180, masked=True, sel=True); s.crew('jun', 22, 24, 0, masked=True)
    s.add('customerHoodie', 17, 24, 0); u.badge(s.over, 17, 24, 'phone', RED, n=2)
    return s

def sLapse():
    s = Scene(18, 13)
    s.prone('customerSuit', 23, 17); u.pips(s.over, 23, 17, 1, CMD, total=2, dy=-12)
    s.prone('customerCoat', 27, 17); u.pips(s.over, 27, 17, 2, CMD, total=2, dy=-12)
    s.prone('customerCasual', 32, 18)
    u.arrow(s.over, [(32, 18), (32, 19), (32, 21), (31, 23), (30, 25), (30, 27)], RED)
    u.badge(s.over, 32, 18, 'run', RED, n=2, lying=True)
    s.prone('customerHoodie', 34, 21); u.badge(s.over, 34, 21, 'hand', RED, n=1, lying=True)
    s.prone('customerDress', 37, 22); u.badge(s.over, 37, 22, 'down', CMD, lying=True)
    s.crew('dex', 28, 21, 0, masked=True, sel=True); s.crew('mara', 36, 17, 90, masked=True)
    return s

# =============================================================== loud
def sAim(bullets=6):
    s = Scene(18, 13)
    shooter, target, bystander = (28, 25), (36, 18), (36, 20)
    s.add('customerCasual', *bystander, 180); s.prone('customerOld', 31, 22)
    sx, sy, tx, ty = cx(shooter[0]), cx(shooter[1]), cx(target[0]), cx(target[1])
    u.arcs(s.under, sight, sx, sy, math.degrees(math.atan2(ty - sy, tx - sx)), 14, 3, bullets, 9)
    s.add('guard', *target, 135)
    s.add('headTeller', 35, 14, 90); s.add('tellerB', 27, 14, 90)
    s.crew('mara', *shooter, -40, masked=True, sel=True)
    u.cover_edge(s.over, target[0], target[1], 's')
    if bullets > 2: u.cover_edge(s.over, bystander[0], bystander[1], 'n', flanked=True)
    u.marker(s.over, target[0], target[1], 'hostile')
    if bullets > 2: u.marker(s.over, bystander[0], bystander[1], 'civ')
    return s

def sWatch():
    s = Scene(16, 14)
    u.cone(s.under, sight, 30, 27, -90, 8, 22, RED, 40)
    s.add('police', 30, 27, -90)
    u.cone(s.under, sight, 35, 20, 150, 8, 30, CMD, 44)
    s.crew('dex', 35, 20, 150, masked=True, sel=True); s.crew('mara', 25, 18, 0, masked=True)
    for look, x, y in HOSTAGES[:4]: s.prone(look, x, y)
    return s

def sPolice():
    s = Scene(15, 18, dy=8)
    for x, y in ((25, 30), (27, 31)): s.add('police', x, y, -90)
    u.cone(s.under, sight, 27, 31, -80, 8, 22, RED, 34)
    u.bracket(s.over, 22, 28, RED); u.badge(s.over, 22, 28, 'bolt', RED, n=1)
    gx, gy = 31, 22
    blast = losTiles((gx, gy), 2)
    for (x, y) in blast:
        for py in range(TS):
            for px in range(TS):
                if (px + py) % 6 == 0: u.put(s.under, x * TS + px, y * TS + py, BONE, 120)
    u.ring(s.under, blast, BONE, dotted=False)
    u.rect(s.over, cx(gx) - 3, cx(gy) - 3, cx(gx) + 2, cx(gy) + 2, (50, 60, 48)); u.rect(s.over, cx(gx) - 2, cx(gy) - 2, cx(gx) - 1, cx(gy) - 1, (120, 140, 110))
    u.plate(s.over, cx(gx) + 6, cx(gy) - 16, 10, 12, BONE); u.num(s.over, 1, cx(gx) + 9, cx(gy) - 13, BONE, shadow=False)
    u.line(s.over, 44 * TS, 36 * TS, cx(35), cx(20) - 14, RED, 230, 3, 3)
    u.rect(s.over, cx(35) - 1, cx(20) - 15, cx(35) + 1, cx(20) - 13, RED)
    s.add('police', 20, 30, 0, ghost=True)
    u.plate(s.over, cx(20) - 5, 30 * TS - 13 - u.HEAD, 10, 12, DIM); u.num(s.over, 1, cx(20) - 2, 30 * TS - 10 - u.HEAD, DIM, shadow=False)
    s.crew('dex', 28, 20, 90, masked=True); s.crew('mara', 35, 20, 90, masked=True, sel=True); s.crew('jun', 22, 21, 90, masked=True)
    for look, x, y in (('customerSuit', 25, 22), ('customerCoat', 27, 22), ('customerCasual', 33, 23), ('customerOld', 30, 24)): s.prone(look, x, y)
    return s

def sTracers():
    s = Scene(16, 14)
    s.crew('dex', 30, 19, 90, masked=True)
    s.add('swat', 29, 26, -90); s.add('swat', 32, 26, -90)
    for (x0, y0, x1, y1) in ((cx(29), cx(26) - 18, cx(30) - 6, cx(19) - 8), (cx(29) + 2, cx(26) - 18, cx(30) + 10, cx(19) - 20)):
        u.line(s.over, x0, y0, x1, y1, (244, 226, 170), 230, 6, 5)
    for k in range(8): u.put(s.over, cx(29) + (k * 5) % 13 - 6, cx(19) + (k * 7) % 9 - 12, (240, 236, 220))
    for look, x, y in (('customerSuit', 25, 22), ('customerCoat', 27, 22), ('customerCasual', 34, 21)): s.prone(look, x, y)
    u.bracket(s.over, 29, 26, RED)
    return s

def sVehicle():
    s = Scene(4, 22, dy=8)
    van = (14, 31)
    reach = set()
    for dx in range(-9, 10):
        for dy in (-1, 0, 1):
            if abs(dy) * 2 > abs(dx) or dx == 0: continue
            reach |= {(x, y) for x in range(van[0] + dx, van[0] + dx + 4) for y in range(van[1] + dy, van[1] + dy + 2)}
    u.tints(s.under, {t: 'safe' for t in reach if 30 <= t[1] <= 34 and 0 <= t[0] < W})
    u.rect(s.under, 22 * TS + 4, 32 * TS + 4, 26 * TS - 5, 34 * TS - 5, (32, 36, 42), 130)
    u.footprint(s.over, 22, 32, 4, 2, BONE, solid=True)
    u.path(s.over, [(16, 31), (19, 31), (20, 32), (23, 32)], BONE, end=False)
    s.add('passerby', 26, 29, 180)
    s.crew('jun', 12, 29, 0, masked=True)
    return s

def sThrow():
    s = Scene(19, 20, moveProps=[{'kind': 'van', 'tx': 29, 'ty': 31}])
    u.tints(s.under, {(31, 29): 'safe', (32, 29): 'safe', (30, 29): 'safe', (31, 30): 'safe', (32, 30): 'safe'})
    s.crew('dex', 30, 27, 90, masked=True, sel=True)
    s.crew('jun', 32, 29, -90, masked=True)
    x0, y0, x1, y1 = cx(30), cx(27) - 20, cx(32), cx(29) - 20
    for k in range(0, 31):
        t = k / 30
        if k % 2 == 0:
            px, py = round(x0 + (x1 - x0) * t), round(y0 + (y1 - y0) * t - math.sin(math.pi * t) * 26)
            u.rect(s.over, px, py, px, py, BONE)
    u.bracket(s.over, 32, 29, BONE)
    return s

def sRoute():
    s = Scene(18, 13)
    route = [(x, 22) for x in range(21, 37)]
    npcs = [Npc('guard', 33, 20, -90, 'enf', future=(33, 19, -90))]
    u.tints(s.under, overlayFor(route[1:], npcs, 'clean'))
    u.path(s.under, route)
    for i, k in enumerate((5, 10, 15)):
        x, y = route[k]; u.plate(s.over, cx(x) - 5, cx(y) - 22, 10, 12, BONE); u.num(s.over, i + 1, cx(x) - 2, cx(y) - 19, BONE, shadow=False)
    s.add('guard', 33, 20, -90, ghost=True)
    u.line(s.under, cx(33), cx(26), cx(33), cx(18), DIM, 200, 1, 4)
    u.bracket(s.over, 33, 20, DIM)
    for look, x in TELLERS: s.add(look, x, 14, 90)
    for look, x in COUNTER: s.add(look, x, 16, -90)
    s.add('customerCasual', 30, 18, -90)
    s.crew('mara', 21, 22, 0, sel=True)
    return s

def sCause():
    s = Scene(16, 13)
    lobbyCast(s, skip=('guard',))
    s.add('guard', 33, 22, 180)
    s.crew('jun', 29, 21, 0); s.crew('mara', 21, 19, 0)
    u.cone(s.under, sight, 33, 22, 180, 6, 45, AMBER, 22, dotted=True)
    u.line(s.over, cx(33) - 10, 22 * TS - u.HEAD + 4, cx(29) + 8, 21 * TS - u.HEAD + 10, CREW['jun'], 230, 3, 2)
    u.pips(s.over, 33, 22, 1, CREW['jun'], dy=-u.HEAD - 8)
    u.badge(s.over, 33, 22, 'q2', AMBER, dx=-22)
    return s

def sWall():
    s = Scene(4, 6)
    for x in range(16, 20):
        for py in range(-10, 10):
            for px in range(TS):
                if (px + py) % 6 == 0: u.put(s.over, x * TS + px, 13 * TS + py, BONE, 150)
    u.bracket(s.over, 16, 12, BONE, 4, 1, arm=10)
    s.crew('dex', 17, 12, 90, masked=True, sel=True)
    return s

def sDesktop():
    s = Scene(14, 8, width=1280, height=720)
    npcs = [Npc('headTeller', 35, 14, 90, 'staff'), Npc('tellerB', 27, 14, 90, 'staff'), Npc('customerDress', 35, 16, -90, 'civ'),
            Npc('cleaner', 42, 14, 180, 'staff', future=(39, 14, 180)), Npc('guard', 33, 23, -90, 'enf', future=(33, 21, -90))]
    info = overlayFor(ROUTE[1:], npcs, 'clean')
    bad = next(t for t in ROUTE[1:] if info[t][0] != 'safe')
    u.tints(s.under, info)
    lobbyCast(s); s.add('cleaner', 42, 14, 180)
    u.arrow(s.over, [(42, 14), (39, 14)], DIM)
    u.arrow(s.over, [(33, 23), (33, 22), (33, 21)], BONE)
    u.path(s.under, ROUTE); u.glyph_at_tile(s.over, bad[0], bad[1], 'eye', BONE)
    s.crew('jun', 37, 21, sel=True); s.crew('mara', 21, 19, 0)
    return s

def sTactical():
    s = Scene(0, 0, mapView=True)
    lobbyCast(s)
    s.add('cleaner', 42, 22, 180); s.add('guard', 30, 12, 180); s.add('operator', 47, 20, 180)
    s.crew('mara', 21, 19, 0); s.crew('jun', 27, 23); s.crew('sol', 35, 40)
    return s

def sBlueprint():
    rooms = [r for r in lv.DATA['rooms'] if r['zone'] in ('staff', 'secure')]
    outlines = [{'x': r['x'], 'y': r['y'], 'w': r['w'], 'h': r['h'], 'name': r['name'], 'parts': r.get('parts') or [{k: r[k] for k in 'xywh'}]} for r in rooms]
    return Scene(0, 0, mapView=True, outlines=outlines, plotOnly=True)

SCENES = {
    'stealth-select': sSelect, 'stealth-path': lambda: sPath(0)[0], 'stealth-why': lambda: sPath(1)[0], 'stealth-wait': lambda: sPath(2)[0],
    'noise-quiet': lambda: sNoise('quiet'), 'noise-loud': lambda: sNoise('loud'), 'challenge': sChallenge, 'carriers': sCarriers,
    'go-preview': sGoPreview, 'go-after': sGoAfter, 'lapse': sLapse, 'aim': sAim, 'aim-tight': lambda: sAim(2),
    'watch': sWatch, 'police': sPolice, 'tracers': sTracers, 'vehicle': sVehicle, 'throw': sThrow,
    'route': sRoute, 'cause': sCause, 'desktop': sDesktop, 'wall': sWall, 'tactical': sTactical, 'blueprint': sBlueprint,
}

if __name__ == '__main__':
    mode, out, only = sys.argv[1], sys.argv[2], set(sys.argv[3:])
    os.makedirs(out, exist_ok=True)
    names = [n for n in SCENES if not only or n in only]
    if mode == 'cast':
        castFile = os.path.join(out, 'cast.json')
        cast = json.load(open(castFile)) if os.path.exists(castFile) else {}
        cast.update({n: SCENES[n]().shot() for n in names})
        json.dump(cast, open(castFile, 'w'), indent=1)
        print('cast for', len(names), 'scenes')
    elif mode == 'compose':
        views = json.load(open(os.path.join(out, 'views.json')))
        for n in names:
            SCENES[n]().compose(out, n, views[n]).save(os.path.join(out, n + '.png')); print('wrote', n)
    else: raise SystemExit('Usage: scenes.py cast|compose <dir> [scene ...]')
