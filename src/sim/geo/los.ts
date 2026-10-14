import { inBounds } from '../core/grid';
import { stableJson } from '../core/json';
import { edgeNow } from '../core/state';
import type { Pos, ReadonlyWorld, State } from '../core/types';

/*
 * Line of sight between tiles (GAME_DESIGN §8.3, §8.15, §11.4, §14.7; implementation plan §2.3, §6 decision 6).
 *
 * The line runs from the middle of one tile to the middle of the other and is walked exactly, with integers only:
 * every tile it enters and every tile edge it crosses is checked, in order (a supercover line). It is blocked by
 *
 * - an edge that blocks sight now (`edgeNow`: a wall, a closed or locked door; glass doesn't, an open or breached
 *   door doesn't);
 * - a tile with a full-height object on it (`tall`), other than the two ends.
 *
 * **Corners (decision 6).** A line that passes exactly through a grid corner goes diagonally from one tile to the
 * next, and is clear only if *both* ways round the corner are: all four edges that meet there let sight through and
 * neither of the two tiles beside the corner holds a full-height object. So a wall that ends at a corner, or a pillar
 * whose corner the line touches, hides what is behind it, and standing next to a corner never exposes anyone (§11.4).
 * The generator's `Nav.sees` needs only one way round (and samples the line in floating point); those are the only
 * places the two disagree (tests/sim/sight.test.ts compares them).
 *
 * **Height (§14.7).** Low objects (desks, counters, planters) never block sight of a tile: people stand taller than
 * them, as the generator already assumes (`tallGrid` in src/gen/generate.ts), and §8.3 names only walls, full-height
 * objects and closed doors as blockers. An observer on a raised tile therefore sees over low objects like everyone
 * else, and walls and full-height objects still block it; height matters for shooting (a raised shooter ignores half
 * cover, §11.4), which the combat rules read from `Tile.raised`, not for whether a tile is seen.
 *
 * **Symmetry.** The walk crosses the same boundaries at the same points whichever end it starts from (a crossing at
 * t from one end is at 1 − t from the other, compared exactly in integers, and a tie is the symmetric corner rule), so
 * `lineOfSight(m, a, b) === lineOfSight(m, b, a)` always.
 */

/** What sight needs from the World and the State, flattened into arrays: build it once per state and reuse it. */
export interface SightMap {
    readonly width: number;
    readonly height: number;
    /** Per tile, row-major: 1 when a full-height object stands on it. */
    readonly tall: Uint8Array;
    /** Per tile, row-major: 1 when it is lit (darkness halves vision, §8.3). */
    readonly lit: Uint8Array;
    /** The vertical boundaries (`northSouth` edges) at x = tx between tiles tx − 1 and tx, index `ty * (width + 1) + tx`: 1 blocks sight. */
    readonly northSouth: Uint8Array;
    /** The horizontal boundaries (`eastWest` edges) at y = ty between tiles ty − 1 and ty, index `ty * width + tx`: 1 blocks sight. */
    readonly eastWest: Uint8Array;
}

/** Builds the sight map of a world in a state. Prefer `sightMap`, which reuses the last one built while nothing changed. */
export function buildSightMap(world: ReadonlyWorld, state: State): SightMap {
    const { width, height } = world;
    const tall = new Uint8Array(width * height), lit = new Uint8Array(width * height);
    world.tiles.forEach((t, i) => {
        tall[i] = t.tall ? 1 : 0;
        lit[i] = t.lit ? 1 : 0;
    });
    const northSouth = new Uint8Array((width + 1) * height), eastWest = new Uint8Array(width * (height + 1));
    for (const key of Object.keys(world.edges)) {
        const e = world.edges[key]!;
        if (!edgeNow(world, state, key)?.blocksSight) continue;
        if (e.run === 'northSouth') {
            if (e.tx >= 0 && e.tx <= width && e.ty >= 0 && e.ty < height) northSouth[e.ty * (width + 1) + e.tx] = 1;
        } else if (e.tx >= 0 && e.tx < width && e.ty >= 0 && e.ty <= height) eastWest[e.ty * width + e.tx] = 1;
    }
    return { width, height, tall, lit, northSouth, eastWest };
}

/** The last sight map built for each world, with the part of the state it was built from. */
const LAST = new WeakMap<ReadonlyWorld, { key: string; map: SightMap }>();

/**
 * The sight map of a world in a state, reused while the parts of the state sight reads (doors and edge overrides)
 * are unchanged, compared by value, so it is safe even on a state that is being changed in place.
 */
export function sightMap(world: ReadonlyWorld, state: State): SightMap {
    const key = stableJson({ doors: state.doors, edges: state.edges });
    const last = LAST.get(world);
    if (last && last.key === key) return last.map;
    const map = buildSightMap(world, state);
    LAST.set(world, { key, map });
    return map;
}

const inside = (m: SightMap, p: Pos): boolean => p.x >= 0 && p.y >= 0 && p.x < m.width && p.y < m.height;

/** Whether sight crosses the vertical boundary from tile (x, y) one step toward `sx` (±1). */
function clearX(m: SightMap, x: number, y: number, sx: number): boolean {
    return !m.northSouth[y * (m.width + 1) + (sx > 0 ? x + 1 : x)];
}

/** Whether sight crosses the horizontal boundary from tile (x, y) one step toward `sy` (±1). */
function clearY(m: SightMap, x: number, y: number, sy: number): boolean {
    return !m.eastWest[(sy > 0 ? y + 1 : y) * m.width + x];
}

const isTall = (m: SightMap, x: number, y: number): boolean => m.tall[y * m.width + x] === 1;

/**
 * Whether the middles of tiles `a` and `b` see each other. A tile always sees itself; tiles off the map see nothing.
 *
 * The walk: after `ix` steps along x and `iy` along y, the line next meets the boundary x = ix + ½ at
 * t = (2·ix + 1) / (2·nx) and y = iy + ½ at t = (2·iy + 1) / (2·ny) (in units of the whole line); comparing
 * (2·ix + 1)·ny with (2·iy + 1)·nx says which comes first, and equality is a corner.
 */
export function lineOfSight(m: SightMap, a: Pos, b: Pos): boolean {
    if (!inside(m, a) || !inside(m, b)) return false;
    const nx = Math.abs(b.x - a.x), ny = Math.abs(b.y - a.y);
    const sx = b.x > a.x ? 1 : -1, sy = b.y > a.y ? 1 : -1;
    let x = a.x, y = a.y, ix = 0, iy = 0;
    while (ix < nx || iy < ny) {
        const order = ix === nx ? 1 : iy === ny ? -1 : Math.sign((2 * ix + 1) * ny - (2 * iy + 1) * nx);
        if (order < 0) {
            if (!clearX(m, x, y, sx)) return false;
            x += sx; ix++;
        } else if (order > 0) {
            if (!clearY(m, x, y, sy)) return false;
            y += sy; iy++;
        } else {
            // Exactly through a corner: both ways round it have to be clear (decision 6).
            if (!clearX(m, x, y, sx) || !clearY(m, x + sx, y, sy) || !clearY(m, x, y, sy) || !clearX(m, x, y + sy, sx)) return false;
            if (isTall(m, x + sx, y) || isTall(m, x, y + sy)) return false;
            x += sx; y += sy; ix++; iy++;
        }
        if ((x !== b.x || y !== b.y) && isTall(m, x, y)) return false;
    }
    return true;
}

/** Line of sight in a world and state (builds or reuses the sight map). */
export function hasLineOfSight(world: ReadonlyWorld, state: State, a: Pos, b: Pos): boolean {
    if (!inBounds(world, a) || !inBounds(world, b)) return false;
    return lineOfSight(sightMap(world, state), a, b);
}
