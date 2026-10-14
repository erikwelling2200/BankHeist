import { propBox, propSpan } from './catalog';
import { TILE } from './constants';
import type { LevelProp } from './plan';
import { boxesOverlap, PERSON_SIZE, place, px, WALL_HEIGHT, type Box } from './space';
import type { Wall, WallRun } from './walls';

/*
 * What the furniture does to the tiles it stands on (§14.1), worked out once from the props and their CATALOG boxes,
 * for the generator (`src/gen/nav.ts`, `generate.ts`) and the rules (`src/sim/world/fromBank.ts`) alike, so the two
 * never disagree about what blocks movement and sight:
 *
 * - **blocked:** something standing on the floor fills the spot a person stands on in the middle of the tile (a desk,
 *   a counter, a bin); the counter's gate stays open.
 * - **tall:** full-height furniture standing on the floor fills that same spot (a shelf, a column): it blocks sight.
 *   Standing in front of a shelf against the wall, where the shelf only reaches into the tile's edge, doesn't.
 * - **halfCover:** blocked, not tall, by something standing on the floor at least `HALF_COVER_HEIGHT` tall: a desk, a
 *   counter, a planter, a sofa, a chair (§11.4). A bin, a wet-floor sign or a coffee table doesn't hide anyone.
 */

/** A prop and the box it fills in the world. */
export interface PlacedProp { prop: LevelProp; box: Box }

export interface TileGrids {
    width: number;
    height: number;
    /** Row-major, 1 where the tile is so: `grid[y * width + x]`. */
    blocked: Uint8Array;
    tall: Uint8Array;
    halfCover: Uint8Array;
}

/** Finds the wall on an edge, as the level or the generator's site keeps them. */
export type WallAt = (edge: { run: WallRun; tx: number; ty: number }) => Wall | undefined;

/** The counter's gate: a flap people walk through, so its tile stays a way through the counter. */
export function isGap(prop: LevelProp, x: number, y: number): boolean {
    return prop.kind === 'counter' && prop.gate === x && prop.ty === y;
}

/** Whether a box is full-height furniture standing on the floor, which blocks sight (§8.3). */
export const isTall = (box: Box): boolean => box.h >= WALL_HEIGHT - 4 && box.z === 0;

/**
 * The least height of something on the floor that gives half cover (§11.4), about a desk's: a desk (0.75m), a sofa
 * (0.85m) and a counter (1.2m) do; a bin (0.6m) and a coffee table (0.45m) don't.
 */
export const HALF_COVER_HEIGHT = px(0.7);

/** Whether a placed prop stands in the way of a person in the middle of tile (x, y). */
export function blocksMoveAt(placed: PlacedProp, x: number, y: number): boolean {
    const { prop, box } = placed;
    if (box.h <= 0 || box.z >= PERSON_SIZE.h || isGap(prop, x, y)) return false;
    return boxesOverlap(box, place({ tx: x, ty: y }, PERSON_SIZE));
}

/** The tiles a box's footprint touches. */
export function tilesOfBox(box: Box): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let y = Math.floor(box.y / TILE); y <= Math.floor((box.y + box.d - 1) / TILE); y++) {
        for (let x = Math.floor(box.x / TILE); x <= Math.floor((box.x + box.w - 1) / TILE); x++) out.push({ x, y });
    }
    return out;
}

/** The walls on the edges of tiles x0..x1, y0..y1 and of the tiles round them: what a prop there is pushed against. */
export function wallsAround(wallAt: WallAt, x0: number, y0: number, x1: number, y1: number): Wall[] {
    const out: Wall[] = [];
    for (let y = y0 - 1; y <= y1 + 2; y++) for (let x = x0 - 1; x <= x1 + 2; x++) {
        const a = wallAt({ run: 'eastWest', tx: x, ty: y }), b = wallAt({ run: 'northSouth', tx: x, ty: y });
        if (a) out.push(a);
        if (b) out.push(b);
    }
    return out;
}

/** Where a prop stands: its CATALOG box, pushed against the walls round its tiles (as the generator places it). */
export function placeProp(prop: LevelProp, wallAt: WallAt): PlacedProp {
    const span = propSpan(prop);
    return { prop, box: propBox(prop, wallsAround(wallAt, span.tx, span.ty, span.tx + span.w - 1, span.ty + span.d - 1)) };
}

/** A `WallAt` over a list of walls (a `Level`'s). */
export function wallLookup(walls: readonly Wall[]): WallAt {
    const byEdge = new Map(walls.map(w => [`${w.run} ${w.tx} ${w.ty}`, w]));
    return e => byEdge.get(`${e.run} ${e.tx} ${e.ty}`);
}

/** The blocked, tall and half-cover grids of a `width` × `height` map from its placed props. */
export function tileGrids(width: number, height: number, placed: readonly PlacedProp[]): TileGrids {
    const n = width * height, blocked = new Uint8Array(n), tall = new Uint8Array(n), halfCover = new Uint8Array(n);
    const cover = new Uint8Array(n);
    for (const p of placed) {
        const full = isTall(p.box), low = p.box.z === 0 && p.box.h >= HALF_COVER_HEIGHT;
        for (const { x, y } of tilesOfBox(p.box)) {
            if (x < 0 || y < 0 || x >= width || y >= height || !blocksMoveAt(p, x, y)) continue;
            const i = y * width + x;
            blocked[i] = 1;
            if (full) tall[i] = 1;
            else if (low) cover[i] = 1;
        }
    }
    for (let i = 0; i < n; i++) if (cover[i] && !tall[i]) halfCover[i] = 1;
    return { width, height, blocked, tall, halfCover };
}

/** The grids of a level's props, each placed against the level's walls. */
export function propTileGrids(width: number, height: number, props: readonly LevelProp[], wallAt: WallAt): TileGrids {
    return tileGrids(width, height, props.map(p => placeProp(p, wallAt)));
}
