import { cornerEdges, edgeBetween, edgeKey, FACING_STEP, FACINGS, inBounds, tileAt } from '../core/grid';
import { edgeNow, registerRuleDefaults } from '../core/state';
import type { ClimbSide, CrewState, DeepReadonly, DoorDef, DoorStatus, NpcStatus, Pos, ReadonlyWorld, State, Tile } from '../core/types';
import { DIAGONAL_COST, HALF_STEPS_PER_TILE, HEAVY_ARMOUR_ITEM, ORTHOGONAL_COST } from '../data/movement';

/*
 * Where someone can walk (§6.3, §14.7): the cost of one step, every tile within a budget with a path to it, and the
 * check of a path the player dragged. One step function serves all three, so the reach the overlay draws, the path a
 * tap picks and the path a drag is allowed are the same rule.
 *
 * Costs are in half-steps (orthogonal 2, diagonal 3; `data/movement.ts`), so all of it is integer arithmetic.
 *
 * - A step can't cross a wall segment that blocks movement now (`edgeNow`: a closed door does, an open or breached one
 *   doesn't, nor does a hole). A closed or locked door passes only if `canPassDoor` says so; the mover then opens it
 *   on the way (the move command does, `crew/movement.ts`). A jammed door never passes.
 * - A diagonal step can't cut a corner where a wall ends: none of the corner's four edges (`cornerEdges`) may hold a wall
 *   that blocks movement, nor a door frame, open or not (a breached door has no frame left). Furniture doesn't stop a
 *   diagonal: §6.3 names only walls, and a desk is smaller than its tile. Nor do people: a diagonal may squeeze between
 *   two NPCs standing on the corner's other two tiles (they stand in the middle of their tiles).
 * - Tiles that block movement (desks, columns) are never entered, nor are those a plan has off limits (`offLimits`).
 * - Raised tiles (§14.7) are reached only by stairs or ladders: a climb tile is ground floor and leads one way, to the
 *   raised tile on its `climb.to` side. A step between tiles of different height must be that one step, either way.
 * - People: a mover may pass through their own side (crew through crew, NPCs through NPCs) and through anyone lying
 *   down (commanded, tied, unconscious, dead), but never through the other side standing up, and nobody ends a move on
 *   anyone's tile. §6.3 is silent; this is our call. NPCs away from the map (`ABSENT_STATUSES`) aren't anywhere.
 */

declare module '../core/types' {
    interface Rules {
        /** Move's reach in heavy armour (§6.3). */
        heavyMoveTiles: number;
        /** Dash's reach in tiles (§6.3). */
        dashTiles: number;
    }
}

registerRuleDefaults({ heavyMoveTiles: 4, dashTiles: 12 });

export interface MoveOptions {
    /** Who moves (a crew or NPC id): their own tile doesn't count as occupied, and their side decides who they pass. */
    mover?: string;
    /** Whether the mover may pass a door that is closed or locked, opening it on the way. Default: never. */
    canPassDoor?: (door: DeepReadonly<DoorDef>, status: DoorStatus) => boolean;
    /** Plan as if nobody stood anywhere (an NPC's route before people are placed, the overlay of an empty bank). */
    ignorePeople?: boolean;
    /** Per tile, row-major: 1 for a tile the mover may not enter (a crew plan's hidden tiles, crew/movement.ts). */
    offLimits?: Uint8Array;
}

/** NPC statuses in which they lie on the floor: they can be stepped over, but not stood on. */
export const LYING_STATUSES: ReadonlySet<NpcStatus> = new Set<NpcStatus>(['commanded', 'tied', 'unconscious', 'dead']);

/** NPC statuses in which they aren't on the map at all (gone out, rules/npc): nobody meets them anywhere. */
export const ABSENT_STATUSES: ReadonlySet<NpcStatus> = new Set<NpcStatus>(['away']);

/** What stands on a tile: nothing, someone who can be stepped past, or someone who can't. */
export type Occupant = 'none' | 'passable' | 'blocking';

/**
 * Who stands where, by tile index (y * width + x), as the mover sees it. A mover who is an NPC is blocked by standing
 * crew and passes NPCs; anyone else (a crew member, or nobody named) is blocked by standing NPCs and passes crew.
 */
export function occupancy(world: ReadonlyWorld, state: State, options: MoveOptions = {}): Map<number, Occupant> {
    const out = new Map<number, Occupant>();
    if (options.ignorePeople) return out;
    const moverIsNpc = state.npcs.some(n => n.id === options.mover);
    const put = (p: Pos, occupant: Occupant): void => {
        const i = p.y * world.width + p.x;
        if (occupant === 'blocking' || !out.has(i)) out.set(i, occupant);
    };
    for (const c of state.crew) if (c.id !== options.mover) put(c.pos, moverIsNpc ? 'blocking' : 'passable');
    for (const n of state.npcs) if (n.id !== options.mover && !ABSENT_STATUSES.has(n.status)) put(n.pos, !moverIsNpc && !LYING_STATUSES.has(n.status) ? 'blocking' : 'passable');
    return out;
}

/** The door standing on the edge between two orthogonal neighbours, if any. */
export function doorBetween(world: ReadonlyWorld, a: Pos, b: Pos): DeepReadonly<DoorDef> | undefined {
    const id = world.edges[edgeKey(edgeBetween(a, b))]?.door;
    return id ? world.doors[id] : undefined;
}

/** A door's status now. */
export const doorStatus = (world: ReadonlyWorld, state: State, id: string): DoorStatus =>
    Object.hasOwn(state.doors, id) ? state.doors[id]!.status : world.doors[id]!.start;

/** Whether a wall on this edge stops a step across it, given the doors the mover may pass. */
function edgeStops(world: ReadonlyWorld, state: State, a: Pos, b: Pos, options: MoveOptions): boolean {
    const key = edgeKey(edgeBetween(a, b));
    if (!edgeNow(world, state, key)?.blocksMove) return false;
    const door = doorBetween(world, a, b);
    if (!door) return true;
    const status = doorStatus(world, state, door.id);
    return status === 'jammed' || !options.canPassDoor?.(door, status);
}

const SIDES: Readonly<Record<ClimbSide, Pos>> = { n: FACING_STEP.n, e: FACING_STEP.e, s: FACING_STEP.s, w: FACING_STEP.w };

/** Whether `tile` at `p` is a climb tile leading to `q`. */
const leadsTo = (tile: DeepReadonly<Tile>, p: Pos, q: Pos): boolean =>
    !!tile.climb && p.x + SIDES[tile.climb.to].x === q.x && p.y + SIDES[tile.climb.to].y === q.y;

/**
 * The cost in half-steps of one step from `a` to a neighbouring tile `b` (orthogonal 2, diagonal 3), or undefined if
 * the step isn't allowed. People aren't considered here (`occupancy`).
 */
export function stepCost(world: ReadonlyWorld, state: State, a: Pos, b: Pos, options: MoveOptions = {}): number | undefined {
    const dx = b.x - a.x, dy = b.y - a.y, adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx > 1 || ady > 1 || adx + ady === 0) return undefined;
    const from = tileAt(world, a), to = tileAt(world, b);
    if (!from || !to || to.blocksMove || options.offLimits?.[b.y * world.width + b.x]) return undefined;
    if (from.raised !== to.raised && !leadsTo(from, a, b) && !leadsTo(to, b, a)) return undefined;
    if (adx + ady === 1) return edgeStops(world, state, a, b, options) ? undefined : ORTHOGONAL_COST;
    for (const edge of cornerEdges(a, b)) {
        const key = edgeKey(edge), built = world.edges[key];
        if (!built) continue;
        if (built.door ? doorStatus(world, state, built.door) !== 'breached' : edgeNow(world, state, key)!.blocksMove) return undefined;
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
    /** The tile `stop` accepted, when it accepted one: the flood ended there. */
    stopped?: ReachTile;
}

/**
 * Every tile within `budget` half-steps of `from`, with the cheapest path to each (Dijkstra, integer costs). Ties are
 * broken the same way every time: tiles settle in order of cost, then row-major index; each one relaxes its neighbours
 * in the order of `FACINGS` (n, ne, e, se, s, sw, w, nw); a tile keeps the first parent that reached it at its lowest
 * cost. Tiles whose only occupant can be stepped past are reached but can't be ended on. With `stop`, the flood ends at
 * the first tile it settles that `stop` accepts (the cheapest such tile, then the first in row order): `stopped`.
 */
export function reachable(world: ReadonlyWorld, state: State, from: Pos, budget: number, options: MoveOptions = {}, stop?: (tile: ReachTile) => boolean): Reach {
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
            if (stop?.(tile)) return { from: start.pos, budget, tiles, byIndex, width, stopped: tile };
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
 *
 * A path may loop back over its own tiles, even through the start, and end where it began: every step is paid for,
 * so a loop only wastes reach, and a player dragging back and forth gets what they drew.
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
