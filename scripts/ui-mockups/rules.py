# A cut-down version of the design's perception rules (GAME_DESIGN.md 8.3-8.8), enough to make the mockup overlays honest:
# every tint in the mockups comes from these checks on the example bank (level.py), not from hand-painting.
import math
from level import los, zone, reachable

PROFILES = ['clean', 'concealed', 'armed', 'heavy']

class Npc:
    def __init__(self, name, x, y, facing, cls, future=None, alerted=False):
        self.name, self.x, self.y, self.facing, self.cls, self.alerted = name, x, y, facing, cls, alerted
        self.future = future  # (x, y, facing) after its committed move

def view(npc, tx, ty, pos=None):
    """'core', 'peri' or None."""
    x, y, f = pos or (npc.x, npc.y, npc.facing)
    d = math.hypot(tx - x, ty - y)
    if d == 0: return None
    coreR, periR = (8, 10) if npc.alerted else (6, 8)
    a = math.degrees(math.atan2(ty - y, tx - x)); da = abs((a - f + 180) % 360 - 180)
    if not los(x, y, tx, ty): return None
    if d <= coreR and da <= 45: return 'core'
    if d <= periR and da <= 70: return 'core' if npc.alerted else 'peri'
    return None

MATRIX = {
    'public': {'clean': ('-', '-', '-'), 'concealed': ('-', '-', '+1f'), 'armed': ('+2', '+2', '!'), 'heavy': ('!', '!', '!')},
    'staff': {'clean': ('-', 'T', 'T'), 'concealed': ('-', '+2', '!'), 'armed': ('!', '!', '!'), 'heavy': ('!', '!', '!')},
}
CLS = {'civ': 0, 'staff': 1, 'enf': 2}

def reaction(npc, tx, ty, profile, pos=None):
    v = view(npc, tx, ty, pos)
    if not v: return '-'
    z = zone(tx, ty)
    x, y, f = pos or (npc.x, npc.y, npc.facing)
    if z == 'secure': r = '!' if npc.cls != 'civ' else '-'
    else:
        p = profile
        if npc.alerted: p = PROFILES[min(3, PROFILES.index(p) + 1)]
        r = MATRIX[z][p][CLS[npc.cls]]
        if r == '+1f': r = '+1' if math.hypot(tx - x, ty - y) <= 2.2 else '-'
    if v == 'peri':
        r = {'!': '+2', '+2': '+1', '+1': '-', 'T': '-', '-': '-'}[r]
    return r

def overlayFor(tiles, npcs, profile):
    """Returns {tile: (kind, who)} using the strongest outcome now, else the strongest during the coming world phase (hatched)."""
    rank = {'-': 0, '+1': 1, 'T': 1, '+2': 2, '!': 3}
    out = {}
    for (tx, ty) in tiles:
        now = max(((reaction(n, tx, ty, profile), n) for n in npcs), key=lambda r: rank[r[0]], default=('-', None))
        fut = max(((reaction(n, tx, ty, profile, n.future), n) for n in npcs if n.future), key=lambda r: rank[r[0]], default=('-', None))
        if rank[now[0]]:
            out[(tx, ty)] = ('red' if now[0] == '!' else 'amber', now[0], now[1])
        elif rank[fut[0]]:
            out[(tx, ty)] = ('hred' if fut[0] == '!' else 'hamber', fut[0], fut[1])
        else:
            out[(tx, ty)] = ('safe', '-', None)
    return out
