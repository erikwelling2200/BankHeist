# The example bank as the mockup rules see it, read from level.json (export-level.test.ts writes it from src/level).
# Walls stand on the edges between tiles, as in the game: ('n', x, y) is the north edge of tile (x, y), ('w', x, y) its
# west edge. Movement and sight follow src/gen/nav.ts: walls stop both, doors let people through, glass and railings
# let sight through, standing furniture blocks a tile and tall furniture blocks sight.
import json, math, os, heapq

DATA = json.load(open(os.path.join(os.path.dirname(__file__), 'level.json')))
TILES = DATA['tiles']
W, H = len(TILES[0]), len(TILES)
T = 16

doors = {'doorWood', 'doorKeycard', 'doorService', 'doorGlass', 'doorTower', 'doorBack'}
seeThrough = {'window', 'doorGlass', 'curtain', 'doorTower', 'rail', 'fence', 'tellerWindow'}
# Sound: thin walls and doors let it through at a cost, heavy walls stop it (GAME_DESIGN.md §8.9).
soundStop = {'concrete', 'vault', 'vaultDoor', 'thick'}

EDGES = {}
for wl in DATA['walls']:
    EDGES[('n' if wl['run'] == 'eastWest' else 'w', wl['tx'], wl['ty'])] = wl['kind']

def edge(a, b):
    """The wall kind on the edge between neighbouring tiles a and b, or None."""
    (x0, y0), (x1, y1) = a, b
    if x1 == x0 + 1 and y1 == y0: return EDGES.get(('w', x1, y0))
    if x1 == x0 - 1 and y1 == y0: return EDGES.get(('w', x0, y0))
    if y1 == y0 + 1 and x1 == x0: return EDGES.get(('n', x0, y1))
    if y1 == y0 - 1 and x1 == x0: return EDGES.get(('n', x0, y0))
    raise ValueError(f'{a} and {b} are not neighbours')

def tile(x, y): return TILES[y][x] if 0 <= x < W and 0 <= y < H else 'x'

# Zones from the rooms (§8.1); outdoors and the neighbours count as public.
ZONES = [['public'] * W for _ in range(H)]
ROOM = [[None] * W for _ in range(H)]
for r in DATA['rooms']:
    for p in r.get('parts') or [r]:
        for y in range(p['y'], p['y'] + p['h']):
            for x in range(p['x'], p['x'] + p['w']):
                if 0 <= x < W and 0 <= y < H:
                    ZONES[y][x] = r['zone'] if r['zone'] in ('public', 'staff', 'secure') else 'public'; ROOM[y][x] = r['name']

def zone(x, y): return ZONES[y][x]

# Props: standing furniture takes the tiles whose middle its footprint covers.
PROPS = DATA['props']
BLOCKED, TALL, COVER = set(), set(), {}
for p in PROPS:
    if p['z'] > 0 or p['h'] <= 4: continue
    for y in range(p['y'] // T, (p['y'] + p['d'] - 1) // T + 1):
        for x in range(p['x'] // T, (p['x'] + p['w'] - 1) // T + 1):
            if p['x'] < (x + 0.5) * T < p['x'] + p['w'] and p['y'] < (y + 0.5) * T < p['y'] + p['d']:
                BLOCKED.add((x, y))
                if p['h'] >= 20: TALL.add((x, y))
                elif p['h'] >= 8: COVER[(x, y)] = p['kind']
    if 'gate' in p:
        # The counter's hinged flap: people pass, and it is still half cover.
        BLOCKED.discard((p['gate'], p['ty']))

def walkable(x, y): return 0 <= x < W and 0 <= y < H and tile(x, y) != 'x' and (x, y) not in BLOCKED

def canStep(a, b):
    """One orthogonal or diagonal step, no walking through a wall or cutting a corner."""
    (x0, y0), (x1, y1) = a, b
    if not walkable(x1, y1): return False
    def openEdge(p, q): k = edge(p, q); return k is None or k in doors
    if x0 != x1 and y0 != y1:
        c1, c2 = (x1, y0), (x0, y1)
        return walkable(*c1) and walkable(*c2) and openEdge(a, c1) and openEdge(c1, b) and openEdge(a, c2) and openEdge(c2, b)
    return openEdge(a, b)

def sightEdge(a, b): k = edge(a, b); return k is None or k in seeThrough

def los(x0, y0, x1, y1):
    """Sight from tile middle to tile middle: blocked by a wall edge it crosses or a tall prop between."""
    n = max(abs(x1 - x0), abs(y1 - y0)) * 8
    cur = (x0, y0)
    for i in range(1, n + 1):
        x = x0 + 0.5 + (x1 - x0) * i / n; y = y0 + 0.5 + (y1 - y0) * i / n
        nxt = (math.floor(x), math.floor(y))
        if nxt == cur: continue
        dx, dy = nxt[0] - cur[0], nxt[1] - cur[1]
        if dx and dy:
            via1, via2 = (nxt[0], cur[1]), (cur[0], nxt[1])
            if not ((sightEdge(cur, via1) and sightEdge(via1, nxt)) or (sightEdge(cur, via2) and sightEdge(via2, nxt))): return False
        elif not sightEdge(cur, nxt): return False
        cur = nxt
        if cur != (x1, y1) and cur in TALL: return False
    return True

def reachable(sx, sy, budget, occupied=()):
    """Move reach with diagonals costing 1.5 and no corner cutting."""
    dist = {(sx, sy): 0}; q = [(0, (sx, sy))]
    while q:
        d, (x, y) = heapq.heappop(q)
        if d > dist[(x, y)]: continue
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if dx == dy == 0: continue
                nb = (x + dx, y + dy)
                if nb in occupied or not canStep((x, y), nb): continue
                nd = d + (1.5 if dx and dy else 1)
                if nd <= budget and nd < dist.get(nb, 99): dist[nb] = nd; heapq.heappush(q, (nd, nb))
    return dist

def ringTiles(src, radius, doorCost=3):
    """Sound flood fill: open floor costs 1 a tile, a door or a thin wall doorCost more, heavy walls stop it."""
    dist = {src: 0}; q = [(0, src)]
    def cost(a, b):
        k = edge(a, b)
        if k is None: return 0
        if k in soundStop: return None
        return doorCost
    while q:
        d, (x, y) = heapq.heappop(q)
        if d > dist.get((x, y), 99): continue
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            nb = (x + dx, y + dy)
            if not (0 <= nb[0] < W and 0 <= nb[1] < H) or tile(*nb) == 'x': continue
            if dx and dy:
                c1, c2 = (x + dx, y), (x, y + dy)
                if edge((x, y), c1) or edge(c1, nb) or edge((x, y), c2) or edge(c2, nb): continue
                extra = 0.5
            else:
                extra = cost((x, y), nb)
                if extra is None: continue
            nd = d + 1 + extra
            if nd <= radius and nd < dist.get(nb, 99): dist[nb] = nd; heapq.heappush(q, (nd, nb))
    return set(dist)

def clearLine(ax, ay, bx, by):
    """Sight along a line between two points in tile units (fractions allowed): no wall edge or tall prop across it."""
    n = int(max(abs(bx - ax), abs(by - ay)) * 8) + 1
    cur = (math.floor(ax), math.floor(ay)); end = (math.floor(bx), math.floor(by))
    for i in range(1, n + 1):
        nxt = (math.floor(ax + (bx - ax) * i / n), math.floor(ay + (by - ay) * i / n))
        if nxt == cur: continue
        dx, dy = nxt[0] - cur[0], nxt[1] - cur[1]
        if dx and dy:
            via1, via2 = (nxt[0], cur[1]), (cur[0], nxt[1])
            if not ((sightEdge(cur, via1) and sightEdge(via1, nxt)) or (sightEdge(cur, via2) and sightEdge(via2, nxt))): return False
        elif abs(dx) + abs(dy) > 1: return False
        elif not sightEdge(cur, nxt): return False
        cur = nxt
        if cur != end and cur in TALL: return False
    return True

class Sight:
    """What a point sees, in UI pixels (32 a tile), answered per 4x4 cell and remembered: cones and shot arcs ask a lot."""
    def __init__(self, ox, oy, scale=32):
        self.ox, self.oy, self.scale, self.cells = ox, oy, scale, {}

    def __call__(self, x, y):
        key = (x // 4, y // 4)
        if key not in self.cells:
            s = self.scale
            self.cells[key] = clearLine(self.ox / s, self.oy / s, (key[0] * 4 + 2) / s, (key[1] * 4 + 2) / s)
        return self.cells[key]
