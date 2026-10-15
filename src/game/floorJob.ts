import * as sim from '../sim';
import type { FloorBand, FloorTile, ReadonlyWorld, State } from '../sim';

/*
 * The safe floor a slice at a time (§8.8), so the scene can draw the Move band at once and fill the Dash band in over
 * the following frames (~6 ms of work each) instead of stalling one: a dash heard by NPCs is the dearest tile to judge.
 *
 * Seam: the sim's incremental API (`safeFloorJob(world, state, crew)`, with `step(deadline, now)`, `done`, `has(bands)`
 * and the tiles so far) is used as soon as src/sim exports it. Until then the fallback below steps band by band with
 * `safeFloor`'s `bands` option: the Move band in one step, the Dash band in one more (not sliced).
 */

export interface FloorJob {
    readonly done: boolean;
    /** The tiles tinted so far, in reach order (the crew member's own tile, the Move band, then the Dash band). */
    readonly tiles: readonly FloorTile[];
    /** Whether every tile of these bands is tinted. */
    has(bands: readonly FloorBand[]): boolean;
    /** Tints tiles until `now()` reaches `deadline` (at least one step); true when done. */
    step(deadline?: number, now?: () => number): boolean;
}

type JobFactory = (world: ReadonlyWorld, state: State, crew: string) => FloorJob;

/** The sim's own, once it exports it. */
const native = (sim as unknown as { safeFloorJob?: JobFactory }).safeFloorJob;

const FALLBACK = new WeakMap<State, Map<string, FloorJob>>();

/** The incremental safe floor of `crew` on `state` (one job per state object and crew member). */
export function floorJob(world: ReadonlyWorld, state: State, crew: string): FloorJob {
    if (native) return native(world, state, crew);
    let byCrew = FALLBACK.get(state);
    if (!byCrew) FALLBACK.set(state, byCrew = new Map());
    let job = byCrew.get(crew);
    if (job) return job;
    let stage = 0, tiles: readonly FloorTile[] = [];
    job = {
        get done() { return stage >= 2; },
        get tiles() { return tiles; },
        has: bands => bands.every(b => (b === 'dash' ? stage >= 2 : stage >= 1)),
        step() {
            if (stage < 2) {
                tiles = sim.safeFloor(world, state, crew, { bands: stage === 0 ? ['stay', 'move'] : ['stay', 'move', 'dash'] }).tiles;
                stage++;
            }
            return stage >= 2;
        }
    };
    byCrew.set(crew, job);
    return job;
}
