import { propBox, propSpan } from './catalog';
import { TILE } from './level';
import type { LevelProp } from './plan';
import { boxesOverlap, PERSON_SIZE, place, WALL_HEIGHT, type Box } from './space';
import type { Wall, WallRun } from './walls';

/*
 * What the furniture does to the tiles it stands on (§14.1), worked out once from the props and their CATALOG boxes,
 * for the generator (`src/gen/nav.ts`, `generate.ts`) and the rules (`src/sim/world/fromBank.ts`) alike, so the two
 * never disagree about what blocks movement and sight:
 *
 * - **blocked:** something standing on the floor fills the spot a person stands on in the middle of the tile (a desk,
 *   a counter, a bin); the counter's gate stays open.
 * - **tall:** full-height furniture standing on the floor touches the tile (a shelf, a column): it blocks sight.
 * - **halfCover:** blocked by something low, not tall: a desk or a counter to crouch behind (§11.4).
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
    for (const p of placed) {
        const isFull = isTall(p.box);
        for (const { x, y } of tilesOfBox(p.box)) {
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const i = y * width + x;
            if (isFull) tall[i] = 1;
            if (blocksMoveAt(p, x, y)) blocked[i] = 1;
        }
    }
    for (let i = 0; i < n; i++) if (blocked[i] && !tall[i]) halfCover[i] = 1;
    return { width, height, blocked, tall, halfCover };
}

/** The grids of a level's props, each placed against the level's walls. */
export function propTileGrids(width: number, height: number, props: readonly LevelProp[], wallAt: WallAt): TileGrids {
    return tileGrids(width, height, props.map(p => placeProp(p, wallAt)));
}
