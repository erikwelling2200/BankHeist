import type { Edge, EdgeKey, Facing, Pos, ReadonlyWorld, Tile, WallEdge, DeepReadonly } from './types';

/*
 * Reading the World's grid: tiles by position, the edges between them, and the eight facings. Edges are keyed exactly
 * as the generator keys them (`src/gen/site.ts`), so a generated bank's walls map onto the World one to one. Whole
 * tiles and integer arithmetic only: no trigonometry, which may differ in the last bit between engines.
 */

export const FACINGS: readonly Facing[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

/** The step one tile along each facing. */
export const FACING_STEP: Readonly<Record<Facing, Readonly<Pos>>> = {
    n: { x: 0, y: -1 }, ne: { x: 1, y: -1 }, e: { x: 1, y: 0 }, se: { x: 1, y: 1 },
    s: { x: 0, y: 1 }, sw: { x: -1, y: 1 }, w: { x: -1, y: 0 }, nw: { x: -1, y: -1 }
};

/**
 * The facing nearest the direction from `a` to `b` (45° sectors centred on each facing), or undefined when they are
 * the same tile. A direction is along an axis when it is within 22.5° of it: |minor| < (√2 − 1)·|major|, which squares
 * to the exact integer test (|minor| + |major|)² < 2·major². A tie is impossible: √2 is irrational.
 */
export function facingToward(a: Pos, b: Pos): Facing | undefined {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (!dx && !dy) return undefined;
    const ax = Math.abs(dx), ay = Math.abs(dy), sum2 = (ax + ay) * (ax + ay);
    const ns = dy < 0 ? 'n' : 's', ew = dx < 0 ? 'w' : 'e';
    if (sum2 < 2 * ax * ax) return ew;
    if (sum2 < 2 * ay * ay) return ns;
    return `${ns}${ew}` as Facing;
}

export const samePos = (a: Pos, b: Pos): boolean => a.x === b.x && a.y === b.y;

export const inBounds = (world: ReadonlyWorld, p: Pos): boolean => p.x >= 0 && p.y >= 0 && p.x < world.width && p.y < world.height;

export function tileAt(world: ReadonlyWorld, p: Pos): DeepReadonly<Tile> | undefined {
    return inBounds(world, p) ? world.tiles[p.y * world.width + p.x] : undefined;
}

export const edgeKey = (e: Edge): EdgeKey => `${e.run} ${e.tx} ${e.ty}`;

/** The edge between two orthogonally neighbouring tiles; throws for any other pair. */
export function edgeBetween(a: Pos, b: Pos): Edge {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx) + Math.abs(dy) !== 1) throw new Error(`(${a.x}, ${a.y}) and (${b.x}, ${b.y}) share no edge`);
    if (dy === 0) return { run: 'northSouth', tx: Math.max(a.x, b.x), ty: a.y };
    return { run: 'eastWest', tx: a.x, ty: Math.max(a.y, b.y) };
}

/**
 * The four edges that meet at the corner two diagonal neighbours share: a's two edges toward b's row and column, then
 * b's two toward a's. A diagonal step cuts that corner, so any wall among them can stop it (§6.3). Throws unless the
 * tiles are diagonal neighbours.
 */
export function cornerEdges(a: Pos, b: Pos): [Edge, Edge, Edge, Edge] {
    if (Math.abs(b.x - a.x) !== 1 || Math.abs(b.y - a.y) !== 1) throw new Error(`(${a.x}, ${a.y}) and (${b.x}, ${b.y}) aren't diagonal neighbours`);
    const across = { x: b.x, y: a.y }, down = { x: a.x, y: b.y };
    return [edgeBetween(a, across), edgeBetween(a, down), edgeBetween(across, b), edgeBetween(down, b)];
}

/** The wall segment between two orthogonally neighbouring tiles, as built, if there is one. Throws for other pairs. */
export const wallBetween = (world: ReadonlyWorld, a: Pos, b: Pos): DeepReadonly<WallEdge> | undefined => world.edges[edgeKey(edgeBetween(a, b))];
