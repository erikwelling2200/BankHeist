import { freezeWorld } from '../world/freeze';
import { assertPlainJson, deepFreeze, devChecksOn, sortedIds } from './json';
import { defaultRules, initialState } from './state';
import type { ReadonlyWorld, SimEvent, State, World } from './types';
import type { UndoStack } from './undo';

/*
 * The autosave (§20.6): the world as built, saved once per heist (`serialiseWorld`), and after every committed action
 * the state with what resuming needs (`serialiseState`): the last few events for the recap card and the undo stack,
 * so a reload doesn't cost the player an undo. `serialise` puts both in one string. A save of another format is
 * refused with a clear error rather than half-loaded.
 *
 * During development the format stays at one number. tests/sim/save.test.ts holds the save's shape and fails when it
 * changes; only the integrator updates that test's hash (and, once saves must survive updates, bumps SAVE_FORMAT).
 * Packages never bump SAVE_FORMAT.
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

/** What a per-action autosave holds: everything but the world, which is saved once per heist. */
export interface SavedState { state: State; recent: SimEvent[]; undo: UndoStack }

/** The keys every state has, from a fresh state of a one-tile world (so packages' own state fields count too). */
function stateKeys(): string[] {
    const tile = { zone: 'public', raised: false, lit: true, blocksMove: false, tall: false, halfCover: false, room: null } as const;
    const world = { width: 1, height: 1, tiles: [tile], edges: {}, doors: {}, objects: [], people: [], cameras: [], rules: defaultRules() };
    return sortedIds(initialState(world, { seed: 0, crew: [] }));
}

function checkState(state: unknown, path: string, keys: readonly string[]): void {
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new SaveFormatError(`${path} isn't a state`);
    const missing = keys.filter(k => !Object.hasOwn(state, k));
    if (missing.length) throw new SaveFormatError(`${path} has no ${missing.join(', ')}`);
}

function parse(text: string, what: string): Record<string, unknown> {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new SaveFormatError(`The ${what} isn't JSON: ${(e as Error).message}`);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SaveFormatError(`The ${what} is not an object`);
    const format = (data as { format?: unknown }).format;
    if (format !== SAVE_FORMAT) throw new SaveFormatError(`The ${what} has format ${String(format)}, this build reads format ${SAVE_FORMAT}`);
    return data as Record<string, unknown>;
}

/** The state part of a save, checked: the state, the recent events and the undo stack. */
function readState(data: Record<string, unknown>): SavedState {
    const { state, recent, undo } = data;
    if (!state || typeof state !== 'object') throw new SaveFormatError('The save has no state');
    if (!Array.isArray(recent) || !Array.isArray(undo)) throw new SaveFormatError('The save has no recent events or undo stack');
    const keys = stateKeys();
    checkState(state, 'state', keys);
    undo.forEach((s, i) => checkState(s, `undo[${i}]`, keys));
    recent.forEach((e, i) => {
        if (!e || typeof e !== 'object' || typeof (e as { type?: unknown }).type !== 'string') throw new SaveFormatError(`recent[${i}] isn't an event`);
    });
    const saved = { state: state as State, recent: recent as SimEvent[], undo: undo as State[] };
    // In development a loaded state is frozen, as a committed one is treated: any write to it is a bug.
    if (devChecksOn()) deepFreeze(saved);
    return saved;
}

function stateFields(saved: { state: State; recent?: readonly SimEvent[]; undo?: UndoStack }): { state: State; recent: SimEvent[]; undo: UndoStack } {
    const fields = { state: saved.state, recent: (saved.recent ?? []).slice(-RECENT_EVENTS), undo: saved.undo ?? [] };
    assertPlainJson(fields, 'save');
    return fields;
}

/** The whole heist in one string: the world (checked once, when it was frozen) and the state part. */
export function serialise(saved: { genVersion: string; world: ReadonlyWorld; state: State; recent?: readonly SimEvent[]; undo?: UndoStack }): string {
    return JSON.stringify({ format: SAVE_FORMAT, genVersion: saved.genVersion, world: freezeWorld(saved.world), ...stateFields(saved) });
}

export function deserialise(text: string): Saved {
    const data = parse(text, 'save');
    if (typeof data.genVersion !== 'string') throw new SaveFormatError('The save has no generator version');
    if (!data.world || typeof data.world !== 'object') throw new SaveFormatError('The save has no world');
    return { genVersion: data.genVersion, world: freezeWorld(data.world as World), ...readState(data) };
}

/** The world alone, saved once when a heist starts; the autosave after each action is `serialiseState`. */
export function serialiseWorld(genVersion: string, world: ReadonlyWorld): string {
    return JSON.stringify({ format: SAVE_FORMAT, genVersion, world: freezeWorld(world) });
}

export function deserialiseWorld(text: string): { genVersion: string; world: ReadonlyWorld } {
    const data = parse(text, 'saved world');
    if (typeof data.genVersion !== 'string') throw new SaveFormatError('The saved world has no generator version');
    if (!data.world || typeof data.world !== 'object') throw new SaveFormatError('The saved world has no world');
    return { genVersion: data.genVersion, world: freezeWorld(data.world as World) };
}

/** The autosave after each committed action (§20.6): the state, the recent events and the undo stack, no world. */
export function serialiseState(saved: { state: State; recent?: readonly SimEvent[]; undo?: UndoStack }): string {
    return JSON.stringify({ format: SAVE_FORMAT, ...stateFields(saved) });
}

export function deserialiseState(text: string): SavedState {
    return readState(parse(text, 'saved state'));
}
