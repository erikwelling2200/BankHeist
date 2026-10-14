import { inBounds } from '../core/grid';
import { sortedIds, stableJson } from '../core/json';
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
 * - a tile with a full-height object on it (`tall`), other than the two ends;
 * - something of middle height (`midHeight`, on a tile other than the ends or on an edge: a vehicle, a wreck), unless
 *   either end of the line is on a raised tile.
 *
 * **Height (§8.3, §14.7).** Low objects (desks, counters, planters, low walls and railings) never block sight of a
 * tile: people stand taller than them, as the generator already assumes (`tallGrid` in src/gen/generate.ts), and §8.3
 * names only walls, full-height objects and closed doors. Things of middle height (vehicles) block people on the
 * ground but not a line with a raised end: an observer up high sees over them, and the ground sees a raised tile over
 * them too (§14.7 "observers on the ground see raised tiles normally"), which keeps the rule symmetric. Walls and
 * full-height objects block everyone. Height matters for shooting too (a raised shooter ignores half cover, §11.4);
 * the combat rules read that from `Tile.raised`.
 *
 * **Corners (decision 6).** A line that passes exactly through a grid corner goes diagonally from one tile to the
 * next, and is clear only if *both* ways round the corner are: all four edges that meet there let sight through and
 * neither of the two tiles beside the corner blocks it. So a wall that ends at a corner, a door jamb, or a pillar whose
 * corner the line touches hides what is behind it, and standing next to a corner never exposes anyone (§11.4). The
 * generator's `Nav.sees` needs only one way round (and samples the line in floating point); those are the only places
 * the two disagree (tests/sim/sight.test.ts compares them).
 *
 * **Symmetry.** The walk crosses the same boundaries at the same points whichever end it starts from (a crossing at
 * t from one end is at 1 − t from the other, compared exactly in integers, and a tie is the symmetric corner rule), so
 * `lineOfSight(m, a, b) === lineOfSight(m, b, a)` always.
 *
 * **Use.** Everything sight reads is flattened into a `SightMap`. A rule that asks many questions in one evaluation
 * (perception over a path, the safe-floor overlay, the crew's knowledge) takes the map once with `sightMap(world,
 * state)` and then calls `lineOfSight`, `seesOn` and `fieldOn` (cones.ts) on it; `hasLineOfSight` and `sees` are the
 * one-off forms and look the map up each call.
 */

declare module '../core/types' {
    interface Tile {
        /** Something of middle height stands on it (a vehicle, a wreck): it blocks sight unless an end of the line is raised. */
        midHeight?: boolean;
    }
    interface EdgeProps {
        /** A middle-height barrier on the edge: blocks sight unless an end of the line is raised. */
        midHeight?: boolean;
    }
}

/** What an edge or tile does to sight in a `SightMap`. */
export const CLEAR = 0, BLOCKS = 1, MID = 2;

/** What sight needs from the World and the State, flattened into arrays: build it once per evaluation and reuse it. */
export interface SightMap {
    readonly width: number;
    readonly height: number;
    /** Per tile, row-major: `BLOCKS` for a full-height object, `MID` for a middle-height one, else `CLEAR`. */
    readonly tiles: Uint8Array;
    /** Per tile, row-major: 1 when raised (§14.7). */
    readonly raised: Uint8Array;
    /** Per tile, row-major: 1 when lit (darkness halves vision, §8.3). */
    readonly lit: Uint8Array;
    /** The vertical boundaries (`northSouth` edges) at x = tx between tiles tx − 1 and tx, index `ty * (width + 1) + tx`. */
    readonly northSouth: Uint8Array;
    /** The horizontal boundaries (`eastWest` edges) at y = ty between tiles ty − 1 and ty, index `ty * width + tx`. */
    readonly eastWest: Uint8Array;
}

/** Each world's doors in id order, so a state's door statuses read as one short string. */
const DOOR_ORDER = new WeakMap<ReadonlyWorld, readonly string[]>();

/**
 * Everything in the State that sight depends on, as a string: equal strings give equal sight maps. Today: each door's
 * status, in id order, and the edge overrides (holes, shot-out panes) when there are any.
 *
 * A package whose state changes sight must join it here and in `buildSightMap`: vehicles that move, smoke, darkness
 * overrides (power cuts, §8.3), barricades, destroyed full-height objects. tests/sim/sight.test.ts checks that changing
 * each input changes the map.
 */
export function sightInputs(world: ReadonlyWorld, state: State): string {
    let order = DOOR_ORDER.get(world);
    if (!order) DOOR_ORDER.set(world, order = sortedIds(world.doors));
    let key = '';
    for (const id of order) key += `${state.doors[id]?.status ?? '-'},`;
    return Object.keys(state.edges).length ? `${key}|${stableJson(state.edges)}` : key;
}

/** Builds the sight map of a world in a state. Prefer `sightMap`, which reuses maps while their inputs are unchanged. */
export function buildSightMap(world: ReadonlyWorld, state: State): SightMap {
    const { width, height } = world;
    const tiles = new Uint8Array(width * height), raised = new Uint8Array(width * height), lit = new Uint8Array(width * height);
    world.tiles.forEach((t, i) => {
        tiles[i] = t.tall ? BLOCKS : t.midHeight ? MID : CLEAR;
        raised[i] = t.raised ? 1 : 0;
        lit[i] = t.lit ? 1 : 0;
    });
    const northSouth = new Uint8Array((width + 1) * height), eastWest = new Uint8Array(width * (height + 1));
    for (const key of Object.keys(world.edges)) {
        const e = world.edges[key]!, now = edgeNow(world, state, key);
        if (!now) continue;
        const door = e.door && state.doors[e.door]?.status;
        const doorway = door === 'open' || door === 'breached';
        const mid = !doorway && (state.edges[key]?.midHeight ?? e.midHeight ?? false);
        const value = now.blocksSight ? BLOCKS : mid ? MID : CLEAR;
        if (!value) continue;
        if (e.run === 'northSouth') {
            if (e.tx >= 0 && e.tx <= width && e.ty >= 0 && e.ty < height) northSouth[e.ty * (width + 1) + e.tx] = value;
        } else if (e.tx >= 0 && e.tx < width && e.ty >= 0 && e.ty <= height) eastWest[e.ty * width + e.tx] = value;
    }
    return { width, height, tiles, raised, lit, northSouth, eastWest };
}

/** How many sight maps each world keeps: a preview alternates between the real state and a hypothetical one. */
const KEEP = 4;
const MAPS = new WeakMap<ReadonlyWorld, { key: string; map: SightMap }[]>();

/**
 * The sight map of a world in a state, reused while `sightInputs` is unchanged (compared by value, so it is safe on
 * a state that is being changed in place). Take it once per evaluation and ask it many questions.
 */
export function sightMap(world: ReadonlyWorld, state: State): SightMap {
    const key = sightInputs(world, state);
    let maps = MAPS.get(world);
    if (!maps) MAPS.set(world, maps = []);
    const i = maps.findIndex(m => m.key === key);
    if (i >= 0) {
        const hit = maps[i]!;
        if (i) { maps.splice(i, 1); maps.unshift(hit); }
        return hit.map;
    }
    const map = buildSightMap(world, state);
    maps.unshift({ key, map });
    if (maps.length > KEEP) maps.length = KEEP;
    return map;
}

const inside = (m: SightMap, p: Pos): boolean => p.x >= 0 && p.y >= 0 && p.x < m.width && p.y < m.height;

/** Whether a `SightMap` value stops a line: always for `BLOCKS`, for `MID` only when neither end is raised. */
const stops = (value: number, high: boolean): boolean => value === BLOCKS || (value === MID && !high);

/**
 * Whether the middles of tiles `a` and `b` see each other. A tile always sees itself; tiles off the map see nothing.
 *
 * The walk: after `ix` steps along x and `iy` along y, the line next meets the boundary x = ix + ½ at
 * t = (2·ix + 1) / (2·nx) and y = iy + ½ at t = (2·iy + 1) / (2·ny) (in units of the whole line); comparing
 * (2·ix + 1)·ny with (2·iy + 1)·nx says which comes first, and equality is a corner.
 */
export function lineOfSight(m: SightMap, a: Pos, b: Pos): boolean {
    if (!inside(m, a) || !inside(m, b)) return false;
    const w = m.width, high = m.raised[a.y * w + a.x] === 1 || m.raised[b.y * w + b.x] === 1;
    const xEdge = (x: number, y: number, sx: number): boolean => stops(m.northSouth[y * (w + 1) + (sx > 0 ? x + 1 : x)]!, high);
    const yEdge = (x: number, y: number, sy: number): boolean => stops(m.eastWest[(sy > 0 ? y + 1 : y) * w + x]!, high);
    const tile = (x: number, y: number): boolean => stops(m.tiles[y * w + x]!, high);
    const nx = Math.abs(b.x - a.x), ny = Math.abs(b.y - a.y);
    const sx = b.x > a.x ? 1 : -1, sy = b.y > a.y ? 1 : -1;
    let x = a.x, y = a.y, ix = 0, iy = 0;
    while (ix < nx || iy < ny) {
        const order = ix === nx ? 1 : iy === ny ? -1 : Math.sign((2 * ix + 1) * ny - (2 * iy + 1) * nx);
        if (order < 0) {
            if (xEdge(x, y, sx)) return false;
            x += sx; ix++;
        } else if (order > 0) {
            if (yEdge(x, y, sy)) return false;
            y += sy; iy++;
        } else {
            // Exactly through a corner: both ways round it have to be clear (decision 6).
            if (xEdge(x, y, sx) || yEdge(x + sx, y, sy) || yEdge(x, y, sy) || xEdge(x, y + sy, sx)) return false;
            if (tile(x + sx, y) || tile(x, y + sy)) return false;
            x += sx; y += sy; ix++; iy++;
        }
        if ((x !== b.x || y !== b.y) && tile(x, y)) return false;
    }
    return true;
}

/** Line of sight in a world and state, for a one-off question; for many, take `sightMap` once and use `lineOfSight`. */
export function hasLineOfSight(world: ReadonlyWorld, state: State, a: Pos, b: Pos): boolean {
    if (!inBounds(world, a) || !inBounds(world, b)) return false;
    return lineOfSight(sightMap(world, state), a, b);
}
