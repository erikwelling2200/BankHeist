import { cornerEdges, edgeBetween, edgeKey, FACING_STEP, FACINGS, inBounds, tileAt } from '../core/grid';
import { edgeNow } from '../core/state';
import type { CrewState, DeepReadonly, DoorDef, DoorStatus, NpcStatus, Pos, ReadonlyWorld, State } from '../core/types';
import { DIAGONAL_COST, HALF_STEPS_PER_TILE, HEAVY_ARMOUR_ITEM, ORTHOGONAL_COST } from '../data/movement';

/*
 * Where someone can walk (§6.3, §14.7): the cost of one step, every tile within a budget with a path to it, and the
 * check of a path the player dragged. One step function serves all three, so the reach the overlay draws, the path a
 * tap picks and the path a drag is allowed are the same rule.
 *
 * Costs are in half-steps (orthogonal 2, diagonal 3; `data/movement.ts`), so all of it is integer arithmetic.
 *
 * - A step can't cross a wall segment that blocks movement now (`edgeNow`: a closed door does, an open or breached one
 *   doesn't, nor does a hole). A closed or locked door passes only if `canPassDoor` says so (an NPC with the key, later);
 *   the crew open doors with Interact, so by default it says no. A jammed door never passes.
 * - A diagonal step can't cut a corner where a wall ends: none of the corner's four edges (`cornerEdges`) may hold a wall
 *   that blocks movement, nor a door frame, open or not. Furniture doesn't stop a diagonal: §6.3 names only walls, and a
 *   desk is smaller than its tile.
 * - Tiles that block movement (desks, columns) are never entered.
 * - Raised tiles (§14.7) are reached only by stairs or ladders: a step between tiles of different height must be
 *   orthogonal and have a climb tile (`Tile.climb`) at one end.
 * - People: anyone may pass through a crew member or an NPC lying down (commanded, tied, unconscious, dead), but nobody
 *   passes through an NPC standing up, and nobody ends a move on anyone's tile. §6.3 is silent; this is our call.
 */

export interface MoveOptions {
    /** Who moves: their own tile doesn't count as occupied. */
    mover?: string;
    /** Whether the mover may pass a door that is closed or locked (opening it on the way). Default: never. */
    canPassDoor?: (door: DeepReadonly<DoorDef>, status: DoorStatus) => boolean;
    /** Plan as if nobody stood anywhere (an NPC's route before people are placed, the overlay of an empty bank). */
    ignorePeople?: boolean;
}

/** NPC statuses in which they lie on the floor: they can be stepped over, but not stood on. */
export const LYING_STATUSES: ReadonlySet<NpcStatus> = new Set<NpcStatus>(['commanded', 'tied', 'unconscious', 'dead']);

/** What stands on a tile: nothing, someone who can be stepped past, or someone who can't. */
export type Occupant = 'none' | 'passable' | 'blocking';

/** Who stands where, by tile index (y * width + x). */
export function occupancy(world: ReadonlyWorld, state: State, options: MoveOptions = {}): Map<number, Occupant> {
    const out = new Map<number, Occupant>();
    if (options.ignorePeople) return out;
    const at = (p: Pos): number => p.y * world.width + p.x;
    for (const c of state.crew) {
        if (c.id === options.mover) continue;
        if (!out.has(at(c.pos))) out.set(at(c.pos), 'passable');
    }
    for (const n of state.npcs) {
        if (n.id === options.mover) continue;
        if (!LYING_STATUSES.has(n.status)) out.set(at(n.pos), 'blocking');
        else if (!out.has(at(n.pos))) out.set(at(n.pos), 'passable');
    }
    return out;
}

/** Whether a wall on this edge stops a step across it, given the doors the mover may pass. */
function edgeStops(world: ReadonlyWorld, state: State, a: Pos, b: Pos, options: MoveOptions): boolean {
    const key = edgeKey(edgeBetween(a, b));
    const now = edgeNow(world, state, key);
    if (!now?.blocksMove) return false;
    const doorId = world.edges[key]!.door, door = doorId ? world.doors[doorId] : undefined;
    if (!door) return true;
    const status = state.doors[door.id]?.status ?? door.start;
    return status === 'jammed' || !options.canPassDoor?.(door, status);
}

/**
 * The cost in half-steps of one step from `a` to a neighbouring tile `b` (orthogonal 2, diagonal 3), or undefined if
 * the step isn't allowed. People aren't considered here (`occupancy`).
 */
export function stepCost(world: ReadonlyWorld, state: State, a: Pos, b: Pos, options: MoveOptions = {}): number | undefined {
    const dx = b.x - a.x, dy = b.y - a.y, adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx > 1 || ady > 1 || adx + ady === 0) return undefined;
    const from = tileAt(world, a), to = tileAt(world, b);
    if (!from || !to || to.blocksMove) return undefined;
    if (from.raised !== to.raised && (adx + ady !== 1 || (!from.climb && !to.climb))) return undefined;
    if (adx + ady === 1) return edgeStops(world, state, a, b, options) ? undefined : ORTHOGONAL_COST;
    for (const edge of cornerEdges(a, b)) {
        const key = edgeKey(edge), built = world.edges[key];
        if (built && (built.door || edgeNow(world, state, key)!.blocksMove)) return undefined;
    }
    return DIAGONAL_COST;
}

/** One tile someone can reach: its cost in half-steps, the tile before it on the cheapest path, and whether they may stop there. */
export interface ReachTile {
    pos: Pos;
    cost: number;
    parent: Pos | null;
    canEnd: boolean;
}

export interface Reach {
    from: Pos;
    /** The budget in half-steps. */
    budget: number;
    /** Every tile reached, the start first, in the order they were settled: by cost, then row-major. */
    tiles: ReachTile[];
    /** The same tiles by index (y * width + x). */
    byIndex: Map<number, ReachTile>;
    width: number;
}

/**
 * Every tile within `budget` half-steps of `from`, with the cheapest path to each (Dijkstra, integer costs). Ties are
 * broken the same way every time: tiles settle in order of cost, then row-major index; each one relaxes its neighbours
 * in the order of `FACINGS` (n, ne, e, se, s, sw, w, nw); a tile keeps the first parent that reached it at its lowest
 * cost. Tiles whose only occupant can be stepped past are reached but can't be ended on.
 */
export function reachable(world: ReadonlyWorld, state: State, from: Pos, budget: number, options: MoveOptions = {}): Reach {
    const width = world.width, people = occupancy(world, state, options);
    const index = (p: Pos): number => p.y * width + p.x;
    const byIndex = new Map<number, ReachTile>(), tiles: ReachTile[] = [];
    const best = new Map<number, ReachTile>();
    // A bucket per cost: steps cost 2 or 3, so a bucket is complete before it is settled.
    const buckets: number[][] = [];
    const start: ReachTile = { pos: { x: from.x, y: from.y }, cost: 0, parent: null, canEnd: true };
    best.set(index(from), start);
    buckets[0] = [index(from)];
    for (let cost = 0; cost <= budget; cost++) {
        const bucket = buckets[cost];
        if (!bucket) continue;
        bucket.sort((a, b) => a - b);
        for (const i of bucket) {
            const tile = best.get(i)!;
            if (byIndex.has(i) || tile.cost !== cost) continue;
            byIndex.set(i, tile);
            tiles.push(tile);
            for (const f of FACINGS) {
                const step = FACING_STEP[f], next = { x: tile.pos.x + step.x, y: tile.pos.y + step.y };
                if (!inBounds(world, next)) continue;
                const j = index(next);
                if (byIndex.has(j)) continue;
                const occupant = people.get(j) ?? 'none';
                if (occupant === 'blocking') continue;
                const c = stepCost(world, state, tile.pos, next, options);
                if (c === undefined || cost + c > budget) continue;
                const known = best.get(j);
                if (known && known.cost <= cost + c) continue;
                best.set(j, { pos: next, cost: cost + c, parent: tile.pos, canEnd: occupant === 'none' });
                (buckets[cost + c] ??= []).push(j);
            }
        }
    }
    return { from: start.pos, budget, tiles, byIndex, width };
}

/** The tile of a reach at `p`, if reached. */
export const reachAt = (reach: Reach, p: Pos): ReachTile | undefined =>
    p.x < 0 || p.x >= reach.width ? undefined : reach.byIndex.get(p.y * reach.width + p.x);

/** The cheapest path to `to` (without the start, ending on `to`), or undefined if it can't be reached or ended on. */
export function pathTo(reach: Reach, to: Pos): Pos[] | undefined {
    const end = reachAt(reach, to);
    if (!end?.canEnd || !end.parent) return undefined;
    const path: Pos[] = [];
    for (let t: ReachTile | undefined = end; t?.parent; t = reachAt(reach, t.parent)) path.push({ x: t.pos.x, y: t.pos.y });
    return path.reverse();
}

export type PathCheck = { ok: true; cost: number } | { ok: false; reason: string; at: number };

/**
 * Whether `path` (a dragged path: each step to a neighbouring tile, without the start) is a legal move from `from`
 * within `budget` half-steps, by the same steps `reachable` takes. `at` is the index of the first bad step.
 */
export function validatePath(world: ReadonlyWorld, state: State, from: Pos, path: readonly Pos[], budget: number, options: MoveOptions = {}): PathCheck {
    if (!path.length) return { ok: false, reason: 'A move needs a path', at: 0 };
    const people = occupancy(world, state, options);
    let at = from, cost = 0;
    for (let k = 0; k < path.length; k++) {
        const p = path[k]!;
        if (!inBounds(world, p)) return { ok: false, reason: `(${p.x}, ${p.y}) is off the map`, at: k };
        const c = stepCost(world, state, at, p, options);
        if (c === undefined) return { ok: false, reason: `Can't step from (${at.x}, ${at.y}) to (${p.x}, ${p.y})`, at: k };
        cost += c;
        if (cost > budget) return { ok: false, reason: `(${p.x}, ${p.y}) is out of reach`, at: k };
        const occupant = people.get(p.y * world.width + p.x) ?? 'none';
        if (occupant === 'blocking') return { ok: false, reason: `Someone stands on (${p.x}, ${p.y})`, at: k };
        if (k === path.length - 1 && occupant !== 'none') return { ok: false, reason: `Someone is already on (${p.x}, ${p.y})`, at: k };
        at = p;
    }
    return { ok: true, cost };
}

/** Whether a crew member wears heavy armour (§6.3: Move 4, no Dash). */
export const inHeavyArmour = (member: DeepReadonly<CrewState>): boolean => member.loadout.items.includes(HEAVY_ARMOUR_ITEM);

/** A crew member's Move budget in half-steps. */
export const moveBudget = (world: ReadonlyWorld, member: DeepReadonly<CrewState>): number =>
    (inHeavyArmour(member) ? world.rules.heavyMoveTiles : world.rules.moveTiles) * HALF_STEPS_PER_TILE;

/** A crew member's Dash budget in half-steps. */
export const dashBudget = (world: ReadonlyWorld): number => world.rules.dashTiles * HALF_STEPS_PER_TILE;
