import { FACING_STEP, FACINGS, inBounds, samePos, tileAt } from '../../core/grid';
import { registerRuleDefaults } from '../../core/state';
import type { DeepReadonly, DoorDef, DoorStatus, Intent, NpcState, PersonDef, Pos, ReadonlyWorld, State, Zone } from '../../core/types';
import { DIAGONAL_COST, HALF_STEPS_PER_TILE, ORTHOGONAL_COST } from '../../data/movement';
import { ABSENT_STATUSES, LYING_STATUSES, occupancy, stepCost, type MoveOptions } from '../../geo/move';

/*
 * How NPCs walk (§6.1, §6.3, implementation plan §6 decisions 4 and 9): one rule for planning a walk when an intent is
 * committed, and one for carrying the committed walks out, which the safe-floor overlay calls too.
 *
 * - **Pace** in tiles per world phase: a routine walk 4, hurried or investigating 5, running (fleeing, escaping) 8,
 *   with the crew's step costs (`geo/move.ts`: diagonals 1.5, walls, corners, climbs).
 * - **Doors**: anyone opens a closed door by walking through it; staff and enforcers carry the keys their role gives
 *   them and pass locked doors too, except the vault door, which waits for the time lock and dual control (M2-05).
 *   An opened door swings shut again at the end of the world phase (`doors.ts`).
 * - **People**: NPCs walk through each other (passive NPCs move as one group, §6.1) but never through a standing crew
 *   member. A walk ends on a tile nobody stands on now and no other NPC's committed walk ends on, so NPCs that all
 *   carry out their walks never meet on a tile.
 * - **Planning** (`planWalk`): the cheapest path to the target by the crew's step rules (A*, ties broken the same way
 *   every time); if the target can't be ended on (someone stands there or will), the last tile before it on that path
 *   where it can; if it can't be reached at all, the reachable tile nearest it (then the cheapest, then row-major).
 *   Cut to the pace's budget, and back from any tile it can't end on.
 * - **Carrying out** (`resolveWalks`): every walking NPC takes the steps of its committed path, in order, until a
 *   step can't be taken now: a crew member stands on the next tile, or the step became impossible (a door was locked
 *   or jammed since, a tile is no neighbour). Where two walks would then end on one tile (only possible after such a
 *   stop), the later NPC in resolution order steps back along its own path, and an NPC that stopped where it started
 *   pushes back whoever stopped on its tile. The result is the same whatever order the walks are looked at in.
 */

declare module '../../core/types' {
    interface Rules {
        /** An NPC's routine walk per world phase, in tiles (§6 decision 4). */
        npcWalkTiles: number;
        /** Hurried or investigating, in tiles. */
        npcHurryTiles: number;
        /** Running (fleeing, escaping), in tiles. */
        npcRunTiles: number;
        /** How many world phases a cautious search lasts (§16.1). */
        searchPhases: number;
    }
}

registerRuleDefaults({ npcWalkTiles: 4, npcHurryTiles: 5, npcRunTiles: 8, searchPhases: 2 });

export type Pace = 'walk' | 'hurry' | 'run';

/** A pace's budget per world phase in half-steps. */
export function paceBudget(world: ReadonlyWorld, pace: Pace): number {
    const tiles = pace === 'walk' ? world.rules.npcWalkTiles : pace === 'hurry' ? world.rules.npcHurryTiles : world.rules.npcRunTiles;
    return tiles * HALF_STEPS_PER_TILE;
}

const PEOPLE = new WeakMap<ReadonlyWorld, Map<string, DeepReadonly<PersonDef>>>();

/** The person an NPC was built from. */
export function personOf(world: ReadonlyWorld, id: string): DeepReadonly<PersonDef> {
    let people = PEOPLE.get(world);
    if (!people) PEOPLE.set(world, people = new Map(world.people.map(p => [p.id, p])));
    const person = people.get(id);
    if (!person) throw new Error(`NPC '${id}' has no person in the world`);
    return person;
}

/** Whether someone of this person's class walks through a door in this state (see the header). */
export function npcCanPass(person: DeepReadonly<PersonDef>): (door: DeepReadonly<DoorDef>, status: DoorStatus) => boolean {
    const keys = person.observer !== 'civilian';
    return (door, status) => status === 'closed' || (status === 'locked' && keys && door.lock !== 'vault');
}

export function npcMoveOptions(world: ReadonlyWorld, npc: DeepReadonly<NpcState>): MoveOptions {
    return { mover: npc.id, canPassDoor: npcCanPass(personOf(world, npc.id)) };
}

/** Whether an NPC is on the map. */
export const isPresent = (npc: DeepReadonly<NpcState>): boolean => !ABSENT_STATUSES.has(npc.status);

/** Where an intent leaves an NPC: the last tile of its path, or where it stands. */
export function intentEnd(npc: DeepReadonly<NpcState>, intent: DeepReadonly<Intent>): Pos {
    const last = intent.path[intent.path.length - 1];
    return last ? { x: last.x, y: last.y } : { x: npc.pos.x, y: npc.pos.y };
}

const indexOf = (world: ReadonlyWorld, p: DeepReadonly<Pos>): number => p.y * world.width + p.x;

/**
 * The tiles an NPC may not end a walk on, as a test by tile index: where the other NPCs on the map stand now, and
 * where their intents (`intents`, default their committed ones) end, an entering NPC's way in among them.
 */
export function othersTiles(
    world: ReadonlyWorld, state: State, npcId: string, intents?: Readonly<Record<string, DeepReadonly<Intent>>>
): (index: number) => boolean {
    const taken = new Set<number>();
    for (const n of state.npcs) {
        if (n.id === npcId) continue;
        const intent = intents && Object.hasOwn(intents, n.id) ? intents[n.id]! : n.intent;
        if (isPresent(n)) taken.add(indexOf(world, n.pos));
        else if (intent.action?.kind !== 'enter') continue;
        taken.add(indexOf(world, intentEnd(n, intent)));
    }
    return i => taken.has(i);
}

export interface WalkTarget {
    tile: Pos;
    pace: Pace;
    /** Stop before the first tile of this zone on the way (an escort keeps to the staff side of the boundary). */
    keepOut?: Zone;
}

export interface PlannedWalk {
    /** The steps, without the start; empty to stay. */
    path: Pos[];
    /** Where the walk was headed this phase: the target, or the nearest tile to it the NPC can end on. */
    dest: Pos;
    /** The walk ends at `dest` this phase. */
    arrives: boolean;
    /** `dest` is the target itself. */
    exact: boolean;
}

interface Node { pos: Pos; cost: number; parent: number; canEnd: boolean }

/**
 * The cheapest path from `from` toward `to` by the movement rules (A*: the octile distance in half-steps never
 * overestimates, and ties go to the lower cost to come, then the lower tile index, so the result is the same every
 * time). Stops when `to` is settled; if it can't be reached, settles everything that can. People as `occupancy`.
 */
function search(world: ReadonlyWorld, state: State, from: Pos, to: Pos, options: MoveOptions): { nodes: Map<number, Node>; found: boolean } {
    const people = occupancy(world, state, options);
    const goal = indexOf(world, to);
    const h = (p: Pos): number => {
        const ax = Math.abs(p.x - to.x), ay = Math.abs(p.y - to.y), lo = Math.min(ax, ay);
        return DIAGONAL_COST * lo + ORTHOGONAL_COST * (Math.max(ax, ay) - lo);
    };
    const nodes = new Map<number, Node>(), settled = new Set<number>();
    // A binary heap of [f, g, index].
    const heap: [number, number, number][] = [];
    const less = (a: [number, number, number], b: [number, number, number]): boolean =>
        a[0] < b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] < b[2])));
    const push = (e: [number, number, number]): void => {
        heap.push(e);
        for (let i = heap.length - 1; i > 0;) {
            const up = (i - 1) >> 1;
            if (!less(heap[i]!, heap[up]!)) break;
            [heap[i], heap[up]] = [heap[up]!, heap[i]!];
            i = up;
        }
    };
    const pop = (): [number, number, number] => {
        const top = heap[0]!, last = heap.pop()!;
        if (heap.length) {
            heap[0] = last;
            for (let i = 0; ;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < heap.length && less(heap[l]!, heap[m]!)) m = l;
                if (r < heap.length && less(heap[r]!, heap[m]!)) m = r;
                if (m === i) break;
                [heap[i], heap[m]] = [heap[m]!, heap[i]!];
                i = m;
            }
        }
        return top;
    };
    const start = indexOf(world, from);
    nodes.set(start, { pos: { x: from.x, y: from.y }, cost: 0, parent: -1, canEnd: true });
    push([h(from), 0, start]);
    while (heap.length) {
        const [, g, i] = pop();
        if (settled.has(i)) continue;
        const node = nodes.get(i)!;
        if (node.cost !== g) continue;
        settled.add(i);
        if (i === goal) return { nodes, found: true };
        for (const f of FACINGS) {
            const step = FACING_STEP[f], next = { x: node.pos.x + step.x, y: node.pos.y + step.y };
            if (!inBounds(world, next)) continue;
            const j = indexOf(world, next);
            if (settled.has(j)) continue;
            const occupant = people.get(j) ?? 'none';
            if (occupant === 'blocking') continue;
            const c = stepCost(world, state, node.pos, next, options);
            if (c === undefined) continue;
            const known = nodes.get(j);
            if (known && known.cost <= g + c) continue;
            nodes.set(j, { pos: next, cost: g + c, parent: i, canEnd: occupant === 'none' });
            push([g + c + h(next), g + c, j]);
        }
    }
    return { nodes, found: false };
}

/** Plans a walk toward a target (see the header). `taken` says which tiles it may not end on (`othersTiles`). */
export function planWalk(world: ReadonlyWorld, state: State, npc: DeepReadonly<NpcState>, target: WalkTarget, taken: (index: number) => boolean): PlannedWalk {
    const here = { x: npc.pos.x, y: npc.pos.y };
    if (samePos(here, target.tile)) return { path: [], dest: here, arrives: true, exact: true };
    const { nodes, found } = search(world, state, here, target.tile, npcMoveOptions(world, npc));
    const start = indexOf(world, here);
    const endable = (i: number): boolean => i === start || (nodes.get(i)!.canEnd && !taken(i));
    let best = start;
    if (found) {
        // The target, or the last tile before it on the way where it can stop.
        best = indexOf(world, target.tile);
        while (!endable(best)) best = nodes.get(best)!.parent;
    } else {
        // Out of reach: the tile it can get to nearest the target, then the cheapest, then the first in row order.
        let key = [Infinity, Infinity, Infinity];
        for (const [i, t] of nodes) {
            if (!endable(i)) continue;
            const dx = t.pos.x - target.tile.x, dy = t.pos.y - target.tile.y, k = [dx * dx + dy * dy, t.cost, i];
            if (k[0]! < key[0]! || (k[0] === key[0] && (k[1]! < key[1]! || (k[1] === key[1] && k[2]! < key[2]!)))) {
                best = i;
                key = k;
            }
        }
    }
    const chain: Node[] = [];
    for (let i = best; i !== start; i = nodes.get(i)!.parent) chain.push(nodes.get(i)!);
    chain.reverse();
    let stopAt = chain.length;
    if (target.keepOut) {
        const out = chain.findIndex(t => tileAt(world, t.pos)?.zone === target.keepOut);
        if (out >= 0) stopAt = out;
    }
    const dest = stopAt ? chain[stopAt - 1]!.pos : here;
    const pace = paceBudget(world, target.pace);
    let end = 0;
    while (end < stopAt && chain[end]!.cost <= pace) end++;
    while (end > 0 && !endable(indexOf(world, chain[end - 1]!.pos))) end--;
    const path = chain.slice(0, end).map(t => ({ x: t.pos.x, y: t.pos.y }));
    const last = path[path.length - 1] ?? here;
    return { path, dest: { x: dest.x, y: dest.y }, arrives: samePos(last, dest), exact: samePos(dest, target.tile) };
}

/** What an NPC actually walked in a world phase. */
export interface Walked {
    npc: string;
    /** The steps it took: its committed path or the start of it. */
    steps: Pos[];
    /** It took every step of its committed path. */
    complete: boolean;
    /** It came onto the map (an `enter` intent). */
    entered: boolean;
}

/** Whether an NPC walks its intent in the passive group: standing on the map, or away with a way back in. */
export function walksIntent(npc: DeepReadonly<NpcState>, intent: DeepReadonly<Intent>): boolean {
    if (LYING_STATUSES.has(npc.status)) return false;
    return isPresent(npc) || intent.action?.kind === 'enter';
}

/**
 * Carries out the committed walks of `movers` (NPC ids, in resolution order) on paper (see the header): `blocked`
 * are the tiles standing crew members are on. Changes nothing. NPCs not among the movers stay where they are.
 */
export function resolveWalks(
    world: ReadonlyWorld, state: State, intents: Readonly<Record<string, DeepReadonly<Intent>>>, movers: readonly string[],
    blocked: ReadonlySet<number>
): Walked[] {
    const byId = new Map(state.npcs.map(n => [n.id, n]));
    const walks: Walked[] = [];
    for (const id of movers) {
        const npc = byId.get(id), intent = Object.hasOwn(intents, id) ? intents[id]! : undefined;
        if (!npc || !intent || !walksIntent(npc, intent)) continue;
        const steps: Pos[] = [];
        if (!isPresent(npc)) {
            const p = intent.path[0];
            const free = p && intent.path.length === 1 && inBounds(world, p) && !tileAt(world, p)!.blocksMove && !blocked.has(indexOf(world, p));
            if (free) steps.push({ x: p.x, y: p.y });
            walks.push({ npc: id, steps, complete: steps.length === intent.path.length, entered: true });
            continue;
        }
        const options = npcMoveOptions(world, npc);
        let prev: DeepReadonly<Pos> = npc.pos;
        for (const p of intent.path) {
            if (!inBounds(world, p) || blocked.has(indexOf(world, p)) || stepCost(world, state, prev, p, options) === undefined) break;
            steps.push({ x: p.x, y: p.y });
            prev = p;
        }
        walks.push({ npc: id, steps, complete: steps.length === intent.path.length, entered: false });
    }
    // Where everyone ends: nobody shares a tile (see the header).
    const moving = new Set(walks.map(w => w.npc));
    const fixed = new Map<number, string>();
    for (const n of state.npcs) if (!moving.has(n.id) && isPresent(n)) fixed.set(indexOf(world, n.pos), n.id);
    const finalOf = (w: Walked): number | null => {
        const last = w.steps[w.steps.length - 1];
        if (last) return indexOf(world, last);
        return w.entered ? null : indexOf(world, byId.get(w.npc)!.pos);
    };
    for (let changed = true; changed;) {
        changed = false;
        const taken = new Map<number, Walked | string>(fixed);
        for (const w of walks) {
            const at = finalOf(w);
            if (at === null) continue;
            const other = taken.get(at);
            if (other === undefined) {
                taken.set(at, w);
                continue;
            }
            const back = typeof other !== 'string' && w.steps.length === 0 && !w.entered ? other : w;
            if (!back.steps.length) throw new Error(`NPCs '${w.npc}' and '${typeof other === 'string' ? other : other.npc}' can't both stand on one tile`);
            back.steps.pop();
            back.complete = false;
            changed = true;
            break;
        }
    }
    return walks;
}

/** The tiles the crew stand on, by index: NPCs never walk through them. */
export function crewTiles(world: ReadonlyWorld, state: State, moved?: { crew: string; tile: Pos }): Set<number> {
    const out = new Set<number>();
    for (const c of state.crew) out.add(indexOf(world, moved && c.id === moved.crew ? moved.tile : c.pos));
    return out;
}
