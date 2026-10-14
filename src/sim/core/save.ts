import { freezeWorld } from '../world/freeze';
import { assertPlainJson } from './json';
import type { ReadonlyWorld, SimEvent, State, World } from './types';
import type { UndoStack } from './undo';

/*
 * The autosave (§20.6): the world as built and the state after the last committed action, plus what resuming needs:
 * the last few events for the recap card and the undo stack, so a reload doesn't cost the player an undo. The format
 * number goes up whenever `World`, `State` or this shape changes (tests/sim/save.test.ts holds the shape); a save of
 * another format is refused with a clear error rather than half-loaded.
 */

export const SAVE_FORMAT = 1;

/** How many recent events a save keeps for the resume recap. */
export const RECENT_EVENTS = 10;

export interface Save {
    format: number;
    /** The generator that built the world ('fixture' for test worlds), so a seed-only save can be rebuilt later. */
    genVersion: string;
    world: World;
    state: State;
    recent: SimEvent[];
    undo: State[];
}

export interface Saved { genVersion: string; world: ReadonlyWorld; state: State; recent: SimEvent[]; undo: UndoStack }

/** The recent events after `events` happened, at most `RECENT_EVENTS`. */
export function appendRecent(recent: readonly SimEvent[], events: readonly SimEvent[]): SimEvent[] {
    return [...recent, ...events].slice(-RECENT_EVENTS);
}

export class SaveFormatError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SaveFormatError';
    }
}

export function serialise(saved: { genVersion: string; world: ReadonlyWorld; state: State; recent?: readonly SimEvent[]; undo?: UndoStack }): string {
    const save = {
        format: SAVE_FORMAT,
        genVersion: saved.genVersion,
        world: saved.world,
        state: saved.state,
        recent: (saved.recent ?? []).slice(-RECENT_EVENTS),
        undo: saved.undo ?? []
    };
    assertPlainJson(save, 'save');
    return JSON.stringify(save);
}

/** The keys every state has; a save missing one was not written by this format. */
const STATE_KEYS: readonly (keyof State)[] = [
    'turn', 'phase', 'bank', 'crew', 'npcs', 'doors', 'edges', 'objects', 'cameras', 'carriers', 'seed', 'rng', 'dice', 'nextId'
];

function checkState(state: unknown, path: string): void {
    if (!state || typeof state !== 'object') throw new SaveFormatError(`${path} isn't a state`);
    const missing = STATE_KEYS.filter(k => !(k in state));
    if (missing.length) throw new SaveFormatError(`${path} has no ${missing.join(', ')}`);
}

export function deserialise(text: string): Saved {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new SaveFormatError(`The save isn't JSON: ${(e as Error).message}`);
    }
    if (!data || typeof data !== 'object') throw new SaveFormatError('The save is not an object');
    const save = data as Partial<Save>;
    if (save.format !== SAVE_FORMAT) {
        throw new SaveFormatError(`The save has format ${String(save.format)}, this build reads format ${SAVE_FORMAT}`);
    }
    if (typeof save.genVersion !== 'string') throw new SaveFormatError('The save has no generator version');
    if (!save.world || typeof save.world !== 'object') throw new SaveFormatError('The save has no world');
    if (!save.state || typeof save.state !== 'object') throw new SaveFormatError('The save has no state');
    if (!Array.isArray(save.recent) || !Array.isArray(save.undo)) throw new SaveFormatError('The save has no recent events or undo stack');
    checkState(save.state, 'state');
    save.undo.forEach((s, i) => checkState(s, `undo[${i}]`));
    save.recent.forEach((e, i) => {
        if (!e || typeof e !== 'object' || typeof (e as { type?: unknown }).type !== 'string') throw new SaveFormatError(`recent[${i}] isn't an event`);
    });
    return { genVersion: save.genVersion, world: freezeWorld(save.world), state: save.state, recent: save.recent, undo: save.undo };
}
