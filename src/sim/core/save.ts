import { packWorld, unpackWorld, type PackedWorld } from '../world/compact';
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
    /** The world with its tiles packed by field (`world/compact.ts`): most of a save's size otherwise. */
    world: PackedWorld;
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

/**
 * The keys every state has, and every crew member, loadout and NPC in it, from a fresh state of a two-tile world with
 * one NPC and one crew member: so every package's own fields count, and a save made before a package added one is
 * refused rather than read with the field missing. Worked out on every load, not cached: a shape taken before every
 * package had registered its inits would miss their fields for good, and a two-tile state costs next to nothing.
 */
interface StateShape { state: string[]; crew: string[]; loadout: string[]; npc: string[] }

function stateShape(): StateShape {
    const tile = { zone: 'public', raised: false, floor: 0, lit: true, blocksMove: false, tall: false, halfCover: false, room: null } as const;
    const person = { id: 'npc', name: 'npc', role: 'customer', observer: 'civilian', pos: { x: 1, y: 0 }, facing: 's', schedule: [] } as const;
    const world = { width: 2, height: 1, tiles: [tile, tile], edges: {}, doors: {}, objects: [], people: [person], cameras: [], rules: defaultRules() };
    const fresh = initialState(world, { seed: 0, crew: [{ id: 'crew', pos: { x: 0, y: 0 } }] });
    return {
        state: sortedIds(fresh), crew: sortedIds(fresh.crew[0]!), loadout: sortedIds(fresh.crew[0]!.loadout), npc: sortedIds(fresh.npcs[0]!)
    };
}

function lacks(value: unknown, keys: readonly string[]): string[] | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return keys.filter(k => !Object.hasOwn(value, k));
}

function checkState(state: unknown, path: string, shape: StateShape): void {
    const missing = lacks(state, shape.state);
    if (!missing) throw new SaveFormatError(`${path} isn't a state`);
    if (missing.length) throw new SaveFormatError(`${path} has no ${missing.join(', ')}`);
    const { crew, npcs } = state as { crew: unknown; npcs: unknown };
    if (!Array.isArray(crew) || !Array.isArray(npcs)) throw new SaveFormatError(`${path} has no crew or NPC list`);
    const each = (list: unknown[], what: string, keys: readonly string[], inner?: (v: Record<string, unknown>) => unknown): void => list.forEach((v, i) => {
        const gone = lacks(inner ? inner(v as Record<string, unknown>) : v, keys);
        if (!gone) throw new SaveFormatError(`${path}.${what}[${i}] isn't one`);
        if (gone.length) throw new SaveFormatError(`${path}.${what}[${i}] has no ${gone.join(', ')} (saved by an older build)`);
    });
    each(crew, 'crew', shape.crew);
    each(crew, 'crew', shape.loadout, v => v?.loadout);
    each(npcs, 'npcs', shape.npc);
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
/**
 * A package's check of its own fields of a loaded state: a reason the state can't be read, or undefined. `world` is
 * given when the save holds it (`deserialise`), so sizes can be checked against it.
 */
export type StateCheck = (state: Record<string, unknown>, world?: ReadonlyWorld) => string | undefined;

const STATE_CHECKS = new Map<string, StateCheck>();

/** Registers a check run on every loaded state (and each undo snapshot); a failure is a `SaveFormatError`. */
export function registerStateCheck(name: string, check: StateCheck): void {
    if (STATE_CHECKS.has(name)) throw new Error(`There is already a state check named '${name}'`);
    STATE_CHECKS.set(name, check);
}

function runChecks(state: unknown, path: string, world?: ReadonlyWorld): void {
    for (const name of [...STATE_CHECKS.keys()].sort()) {
        const problem = STATE_CHECKS.get(name)!(state as Record<string, unknown>, world);
        if (problem) throw new SaveFormatError(`${path}: ${problem}`);
    }
}

function readState(data: Record<string, unknown>, world?: ReadonlyWorld): SavedState {
    const { state, recent, undo } = data;
    if (!state || typeof state !== 'object') throw new SaveFormatError('The save has no state');
    if (!Array.isArray(recent) || !Array.isArray(undo)) throw new SaveFormatError('The save has no recent events or undo stack');
    const shape = stateShape();
    checkState(state, 'state', shape);
    undo.forEach((s, i) => checkState(s, `undo[${i}]`, shape));
    runChecks(state, 'state', world);
    undo.forEach((s, i) => runChecks(s, `undo[${i}]`, world));
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

/** A saved world, its tiles packed (world/compact.ts) or plain, unpacked and frozen. */
function readWorld(world: unknown, what: string): ReadonlyWorld {
    let unpacked: World;
    try {
        unpacked = unpackWorld(world as PackedWorld | World);
    } catch (e) {
        throw new SaveFormatError(`The ${what}'s world can't be unpacked: ${(e as Error).message}`);
    }
    return freezeWorld(unpacked);
}

/** The whole heist in one string: the world (checked once, when it was frozen) and the state part. */
export function serialise(saved: { genVersion: string; world: ReadonlyWorld; state: State; recent?: readonly SimEvent[]; undo?: UndoStack }): string {
    return JSON.stringify({ format: SAVE_FORMAT, genVersion: saved.genVersion, world: packWorld(freezeWorld(saved.world)), ...stateFields(saved) });
}

export function deserialise(text: string): Saved {
    const data = parse(text, 'save');
    if (typeof data.genVersion !== 'string') throw new SaveFormatError('The save has no generator version');
    if (!data.world || typeof data.world !== 'object') throw new SaveFormatError('The save has no world');
    const world = readWorld(data.world, 'save');
    return { genVersion: data.genVersion, world, ...readState(data, world) };
}

/** The world alone, saved once when a heist starts; the autosave after each action is `serialiseState`. */
export function serialiseWorld(genVersion: string, world: ReadonlyWorld): string {
    return JSON.stringify({ format: SAVE_FORMAT, genVersion, world: packWorld(freezeWorld(world)) });
}

export function deserialiseWorld(text: string): { genVersion: string; world: ReadonlyWorld } {
    const data = parse(text, 'saved world');
    if (typeof data.genVersion !== 'string') throw new SaveFormatError('The saved world has no generator version');
    if (!data.world || typeof data.world !== 'object') throw new SaveFormatError('The saved world has no world');
    return { genVersion: data.genVersion, world: readWorld(data.world, 'saved world') };
}

/** The autosave after each committed action (§20.6): the state, the recent events and the undo stack, no world. */
export function serialiseState(saved: { state: State; recent?: readonly SimEvent[]; undo?: UndoStack }): string {
    return JSON.stringify({ format: SAVE_FORMAT, ...stateFields(saved) });
}

/** An autosave's state; with its `world` (saved apart), the checks that need one run too. */
export function deserialiseState(text: string, world?: ReadonlyWorld): SavedState {
    return readState(parse(text, 'saved state'), world);
}
