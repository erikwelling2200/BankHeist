import type { Ctx } from '../core/engine';
import { cornerEdges, edgeBetween, edgeKey, FACING_STEP, FACINGS, inBounds } from '../core/grid';
import type { EdgeKey, Material, NpcStatus, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { DIAGONAL_COST, HALF_STEPS_PER_TILE, ORTHOGONAL_COST } from '../data/movement';
import { NOISES, SOUND_DAMPING, SOUND_WALL_TILES, type NoiseKind, type NoiseSource } from '../data/noise';

/*
 * How sound spreads (§8.9): from tile to tile like water, a radius R reaching every tile within R tiles of movement
 * cost (diagonals 1.5, §6 decision 3), all in half-steps. A tile is reached when its cost, rounded down to whole
 * tiles, is at most R: in half-steps, cost ≤ 2R + 1, so a radius-1 sound reaches the diagonal neighbours.
 *
 * A wall segment that carries sound (`blocksSound` false: no wall, an open or breached door, a hole; or a fence or railing) costs
 * nothing. One that doesn't costs by material (`data/noise.ts`): a closed door or a Soft or glass wall 3 tiles of reach
 * on top of the step; Reinforced, teller glass and Vault stop it, and so does a closed vault door. A diagonal passes a
 * corner only if all four of its edges carry sound, so sound never slips round the end of a wall for free. Furniture
 * and height don't matter to sound (§14.7). The ring is exactly the tiles reached, and the preview draws the same set.
 */

declare module '../core/types' {
    interface EdgeProps {
        /**
         * Whether sound has to get through this segment (§8.9), at its material's cost. Absent means it does; false
         * for a fence or a hole, which carry sound for free. An open or breached door always carries it.
         */
        blocksSound?: boolean;
    }
    interface EventMap {
        /** A noise was made: from these tiles, this far, and the NPCs inside its ring, in resolution order. */
        noise: { sources: Pos[]; radius: number; kind: NoiseKind; cause: string; heard: string[] };
        /** NPCs heard a noise (`noise` comes first). They will react to it, so the action can't be taken back. */
        heard: { cause: string; kind: NoiseKind; npcs: string[] };
    }
}

const WALL_COST = SOUND_WALL_TILES * HALF_STEPS_PER_TILE;

/** What crossing an edge costs a sound in half-steps on top of the step, or -1 if it stops it. */
function edgeSoundCost(world: ReadonlyWorld, state: State, key: EdgeKey): number {
    const built = world.edges[key];
    if (!built) return 0;
    const changed = Object.hasOwn(state.edges, key) ? state.edges[key]! : undefined;
    if (built.door) {
        const status = Object.hasOwn(state.doors, built.door) ? state.doors[built.door]!.status : world.doors[built.door]!.start;
        if (status === 'open' || status === 'breached') return 0;
    }
    if (!(changed?.blocksSound ?? built.blocksSound ?? true)) return 0;
    const material: Material = changed?.material ?? built.material;
    // A closed door costs 3 whatever it is made of, unless it is the vault's (§8.9 "each closed door").
    if (built.door) return material === 'vault' ? -1 : WALL_COST;
    const damping = SOUND_DAMPING[material];
    return damping === 'passes' ? 0 : damping === 'stops' ? -1 : WALL_COST;
}

/** What crossing an edge costs a sound in half-steps on top of the step, or undefined if it stops it. */
export function soundEdgeCost(world: ReadonlyWorld, state: State, key: EdgeKey): number | undefined {
    const cost = edgeSoundCost(world, state, key);
    return cost < 0 ? undefined : cost;
}

export interface SoundTile {
    pos: Pos;
    /** Reach left on this tile, in half-steps: 2R + 1 − its cost (0 or 1 at the ring's edge). */
    remaining: number;
}

export interface Ring {
    sources: Pos[];
    radius: number;
    /** Every tile the sound reaches, row-major. */
    tiles: SoundTile[];
    /** The same by index (y * width + x). */
    byIndex: Map<number, SoundTile>;
    width: number;
}

/** The budget in half-steps of a noise of `radius` tiles: costs round down, so 1.5 tiles counts as 1. */
export const soundBudget = (radius: number): number => radius * HALF_STEPS_PER_TILE + 1;

/** The tiles a noise of `radius` tiles made on `sources` (one tile, or every tile of a dash) reaches. */
export function soundRing(world: ReadonlyWorld, state: State, sources: Pos | readonly Pos[], radius: number): Ring {
    const from = (Array.isArray(sources) ? sources : [sources]) as readonly Pos[];
    const width = world.width, budget = soundBudget(radius);
    const index = (p: Pos): number => p.y * width + p.x;
    const cost = new Map<number, number>(), settled = new Set<number>();
    // Each edge's cost once per flood: an edge is looked at from both sides and from four corners.
    const edgeCache = new Map<EdgeKey, number>();
    const edgeCost = (key: EdgeKey): number => {
        let c = edgeCache.get(key);
        if (c === undefined) edgeCache.set(key, c = edgeSoundCost(world, state, key));
        return c;
    };
    const buckets: number[][] = [[]];
    for (const p of from) {
        if (!inBounds(world, p) || cost.has(index(p))) continue;
        cost.set(index(p), 0);
        buckets[0]!.push(index(p));
    }
    for (let c = 0; c <= budget; c++) {
        const bucket = buckets[c];
        if (!bucket) continue;
        bucket.sort((a, b) => a - b);
        for (const i of bucket) {
            if (settled.has(i) || cost.get(i) !== c) continue;
            settled.add(i);
            const at = { x: i % width, y: (i - (i % width)) / width };
            for (const f of FACINGS) {
                const d = FACING_STEP[f], next = { x: at.x + d.x, y: at.y + d.y };
                if (!inBounds(world, next) || settled.has(index(next))) continue;
                let step: number;
                if (d.x && d.y) {
                    if (!cornerEdges(at, next).every(e => edgeCost(edgeKey(e)) === 0)) continue;
                    step = DIAGONAL_COST;
                } else {
                    const wall = edgeCost(edgeKey(edgeBetween(at, next)));
                    if (wall < 0) continue;
                    step = ORTHOGONAL_COST + wall;
                }
                const nc = c + step, j = index(next);
                if (nc > budget || (cost.get(j) ?? budget + 1) <= nc) continue;
                cost.set(j, nc);
                (buckets[nc] ??= []).push(j);
            }
        }
    }
    const tiles = [...settled].sort((a, b) => a - b)
        .map(i => ({ pos: { x: i % width, y: (i - (i % width)) / width }, remaining: budget - cost.get(i)! }));
    return { sources: from.map(p => ({ x: p.x, y: p.y })), radius, tiles, byIndex: new Map(tiles.map(t => [index(t.pos), t])), width };
}

/** Whether a ring reaches `p`. */
export const inRing = (ring: Ring, p: Pos): boolean => p.x >= 0 && p.x < ring.width && ring.byIndex.has(p.y * ring.width + p.x);

/** NPCs who can't hear: out cold, dead or away from the map. */
export const DEAF_STATUSES: ReadonlySet<NpcStatus> = new Set<NpcStatus>(['unconscious', 'dead', 'away']);

/** The NPCs inside a ring who can hear it, in resolution order (§6.1). */
export function npcsInside(state: State, ring: Ring): string[] {
    return state.npcs.filter(n => !DEAF_STATUSES.has(n.status) && inRing(ring, n.pos)).map(n => n.id);
}

/** The radius a noise from the table has: `radius` if given (within its range), else its lower end. */
export function noiseRadius(what: NoiseSource, radius?: number): number {
    const def = NOISES[what];
    if ('plusCommandRadius' in def) {
        if (radius === undefined) throw new Error(`A ${what} noise needs its radius: the command radius + ${def.plusCommandRadius}`);
        return radius;
    }
    const r = radius ?? def.min;
    if (r < def.min || r > def.max) throw new Error(`A ${what} noise has radius ${def.min}–${def.max}, not ${r}`);
    return r;
}

/**
 * Makes a noise from the table on `sources` and emits it with who heard it; when anyone did, a `heard` event follows,
 * which blocks undo. Reactions belong to perception (M1-05), which reads the events. Returns the ring.
 */
export function makeNoise(ctx: Ctx, what: NoiseSource, sources: Pos | readonly Pos[], cause: string, radius?: number): Ring {
    const kind = NOISES[what].kind, r = noiseRadius(what, radius);
    const ring = soundRing(ctx.world, ctx.state, sources, r);
    const heard = npcsInside(ctx.state, ring);
    ctx.emit({ type: 'noise', sources: ring.sources, radius: r, kind, cause, heard });
    if (heard.length) ctx.emit({ type: 'heard', cause, kind, npcs: heard });
    return ring;
}

registerEvents({ noise: { undoBlocking: false }, heard: { undoBlocking: true } });
