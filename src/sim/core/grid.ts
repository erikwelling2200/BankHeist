import type { Edge, EdgeKey, Facing, Pos, Tile, WallEdge, World } from './types';

/*
 * Reading the World's grid: tiles by position, the edges between them, and the eight facings. Edges are keyed exactly
 * as the generator keys them (`src/gen/site.ts`), so a generated bank's walls map onto the World one to one.
 */

export const FACINGS: readonly Facing[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

/** The step one tile along each facing. */
export const FACING_STEP: Readonly<Record<Facing, Readonly<Pos>>> = {
    n: { x: 0, y: -1 }, ne: { x: 1, y: -1 }, e: { x: 1, y: 0 }, se: { x: 1, y: 1 },
    s: { x: 0, y: 1 }, sw: { x: -1, y: 1 }, w: { x: -1, y: 0 }, nw: { x: -1, y: -1 }
};

/** The facing nearest the direction from `a` to `b` (in 45° sectors), or undefined when they are the same tile. */
export function facingToward(a: Pos, b: Pos): Facing | undefined {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (!dx && !dy) return undefined;
    // atan2 with y down: 0 is east, a quarter turn is south. Sector 0 is north, clockwise.
    const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4) + 2);
    return FACINGS[((sector % 8) + 8) % 8];
}

export const samePos = (a: Pos, b: Pos): boolean => a.x === b.x && a.y === b.y;

export const inBounds = (world: World, p: Pos): boolean => p.x >= 0 && p.y >= 0 && p.x < world.width && p.y < world.height;

export function tileAt(world: World, p: Pos): Tile | undefined {
    return inBounds(world, p) ? world.tiles[p.y * world.width + p.x] : undefined;
}

export const edgeKey = (e: Edge): EdgeKey => `${e.run} ${e.tx} ${e.ty}`;

/** The edge between two orthogonally neighbouring tiles. */
export function edgeBetween(a: Pos, b: Pos): Edge {
    if (a.y === b.y) return { run: 'northSouth', tx: Math.max(a.x, b.x), ty: a.y };
    return { run: 'eastWest', tx: a.x, ty: Math.max(a.y, b.y) };
}

/** The wall segment between two orthogonally neighbouring tiles, if there is one. */
export const wallBetween = (world: World, a: Pos, b: Pos): WallEdge | undefined => world.edges[edgeKey(edgeBetween(a, b))];
