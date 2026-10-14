import type { Ctx } from '../core/engine';
import { cornerEdges, edgeBetween, edgeKey, FACING_STEP, FACINGS, inBounds } from '../core/grid';
import { edgeNow } from '../core/state';
import type { EdgeKey, NpcStatus, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { DIAGONAL_COST, HALF_STEPS_PER_TILE, ORTHOGONAL_COST } from '../data/movement';
import { NOISES, SOUND_STOPPED_BY, SOUND_STOPPED_BY_DOOR, SOUND_WALL_TILES, type NoiseKind, type NoiseSource } from '../data/noise';

/*
 * How sound spreads (§8.9): from tile to tile like water, a radius R reaching every tile within R tiles of movement
 * cost (diagonals 1.5, §6 decision 3), all in half-steps. Crossing a closed door or a Soft (or glass) wall costs 3
 * tiles of reach on top of the step; Reinforced and Vault walls stop it, and so does a closed vault door; open or
 * breached doors and holes cost nothing (`data/noise.ts` has the materials). A diagonal passes a corner only if none
 * of its four edges costs anything, so sound never slips through the end of a wall for free. Furniture and height
 * don't matter to sound (§14.7). The ring is exactly the tiles reached, and the preview draws the same set.
 */

declare module '../core/types' {
    interface EventMap {
        /** A noise was made: its ring and the NPCs inside it (who hear it), in resolution order. */
        noise: { source: Pos; radius: number; kind: NoiseKind; cause: string; heard: string[] };
    }
}

const WALL_COST = SOUND_WALL_TILES * HALF_STEPS_PER_TILE;

/** What crossing an edge costs a sound in half-steps on top of the step, or undefined if it stops it. */
export function soundEdgeCost(world: ReadonlyWorld, state: State, key: EdgeKey): number | undefined {
    const now = edgeNow(world, state, key);
    // No wall, an open or breached door, or a hole made in it.
    if (!now?.blocksMove) return 0;
    const isDoor = !!world.edges[key]!.door;
    const stops: readonly string[] = isDoor ? SOUND_STOPPED_BY_DOOR : SOUND_STOPPED_BY;
    return stops.includes(now.material) ? undefined : WALL_COST;
}

export interface SoundTile {
    pos: Pos;
    /** Reach left on this tile, in half-steps (0 at the ring's edge). */
    remaining: number;
}

export interface Ring {
    source: Pos;
    radius: number;
    /** Every tile the sound reaches, row-major. */
    tiles: SoundTile[];
    /** The same by index (y * width + x). */
    byIndex: Map<number, SoundTile>;
    width: number;
}

/** The tiles a noise of `radius` tiles made at `source` reaches. */
export function soundRing(world: ReadonlyWorld, state: State, source: Pos, radius: number): Ring {
    const width = world.width, budget = radius * HALF_STEPS_PER_TILE;
    const index = (p: Pos): number => p.y * width + p.x;
    const cost = new Map<number, number>(), settled = new Set<number>();
    const buckets: number[][] = [];
    if (inBounds(world, source)) {
        cost.set(index(source), 0);
        buckets[0] = [index(source)];
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
                let extra: number | undefined;
                if (d.x && d.y) extra = cornerEdges(at, next).every(e => soundEdgeCost(world, state, edgeKey(e)) === 0) ? DIAGONAL_COST : undefined;
                else {
                    const wall = soundEdgeCost(world, state, edgeKey(edgeBetween(at, next)));
                    extra = wall === undefined ? undefined : ORTHOGONAL_COST + wall;
                }
                if (extra === undefined) continue;
                const nc = c + extra, j = index(next);
                if (nc > budget || (cost.get(j) ?? Infinity) <= nc) continue;
                cost.set(j, nc);
                (buckets[nc] ??= []).push(j);
            }
        }
    }
    const tiles = [...settled].sort((a, b) => a - b)
        .map(i => ({ pos: { x: i % width, y: (i - (i % width)) / width }, remaining: budget - cost.get(i)! }));
    return { source: { x: source.x, y: source.y }, radius, tiles, byIndex: new Map(tiles.map(t => [index(t.pos), t])), width };
}

/** Whether a ring reaches `p`. */
export const inRing = (ring: Ring, p: Pos): boolean => p.x >= 0 && p.x < ring.width && ring.byIndex.has(p.y * ring.width + p.x);

/** NPCs who can't hear: out cold or dead. */
export const DEAF_STATUSES: ReadonlySet<NpcStatus> = new Set<NpcStatus>(['unconscious', 'dead']);

/** The NPCs inside a ring who can hear it, in resolution order (§6.1). */
export function npcsInside(state: State, ring: Ring): string[] {
    return state.npcs.filter(n => !DEAF_STATUSES.has(n.status) && inRing(ring, n.pos)).map(n => n.id);
}

/**
 * Makes a noise from the table at `source` and emits it with who heard it. `radius` picks within the source's range
 * (default its lower end; for the command shout, pass the full radius). Reactions to it belong to perception (M1-05),
 * which reads the event. Returns the ring.
 */
export function makeNoise(ctx: Ctx, what: NoiseSource, source: Pos, cause: string, radius?: number): Ring {
    const def = NOISES[what], r = radius ?? def.min;
    if (!('plusCommandRadius' in def) && (r < def.min || r > def.max)) throw new Error(`A ${what} noise has radius ${def.min}–${def.max}, not ${r}`);
    const ring = soundRing(ctx.world, ctx.state, source, r);
    ctx.emit({ type: 'noise', source: { x: source.x, y: source.y }, radius: r, kind: def.kind, cause, heard: npcsInside(ctx.state, ring) });
    return ring;
}

// A noise alone reveals nothing: the reactions of those who hear it are their own events, and those block undo.
registerEvents({ noise: { undoBlocking: false } });
