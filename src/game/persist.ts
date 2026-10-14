import {
    deserialiseState, deserialiseWorld, SAVE_FORMAT, SaveFormatError, serialiseState, serialiseWorld, type ReadonlyWorld, type SavedState,
    type SimEvent, type State, type UndoStack
} from '../sim';

/*
 * How the Session's autosave entries are written and read. The core's save (src/sim/core/save.ts) does the work: the
 * world once with `serialiseWorld`, the state, recent events and undo stack after every action with `serialiseState`.
 * The heist entry is that state save with the Session's own fields added beside the core's (the world it belongs to,
 * the events before each undoable action, the UI and a save counter), so the core checks it as its own.
 */

export { serialiseWorld };

/** What the Session keeps beside the core save. */
export interface HeistExtras<Ui> {
    worldId: string;
    /** In step with the undo stack, so undoing takes its events back too. */
    undoRecent: SimEvent[][];
    /** The turn each recent event happened in, in step with the core's `recent` (absent in older saves). */
    recentTurns?: number[];
    /** The same for each entry of `undoRecent`. */
    undoRecentTurns?: number[][];
    ui: Ui;
    /** Counts the heist's saves, so a UI entry written after it can tell it belongs to this one. */
    seq: number;
}

const EXTRA_KEYS = ['worldId', 'undoRecent', 'ui', 'seq'] as const;

export function serialiseHeist<Ui>(saved: { state: State; recent: readonly SimEvent[]; undo: UndoStack } & HeistExtras<Ui>): string {
    const core = serialiseState(saved);
    const extras = JSON.stringify({
        worldId: saved.worldId, undoRecent: saved.undoRecent, recentTurns: saved.recentTurns ?? [], undoRecentTurns: saved.undoRecentTurns ?? [], ui: saved.ui, seq: saved.seq
    });
    // The core's object, closed one field later: `{…core…,"worldId":…}`.
    return `${core.slice(0, -1)},${extras.slice(1)}`;
}

function parseObject(text: string, what: string): Record<string, unknown> {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new SaveFormatError(`The ${what} isn't JSON: ${(e as Error).message}`);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SaveFormatError(`The ${what} is not an object`);
    return data as Record<string, unknown>;
}

/** The world id a heist entry was played in, to find its world entry. */
export function heistWorldId(heistText: string): string {
    const id = parseObject(heistText, 'save').worldId;
    if (typeof id !== 'string') throw new SaveFormatError('The save names no world');
    return id;
}

export function deserialiseHeist<Ui>(heistText: string, worldText: string): SavedState & { genVersion: string; world: ReadonlyWorld } & HeistExtras<Partial<Ui> | null> {
    const { genVersion, world } = deserialiseWorld(worldText);
    const saved = deserialiseState(heistText);
    const heist = parseObject(heistText, 'save');
    for (const key of EXTRA_KEYS) if (!(key in heist)) throw new SaveFormatError(`The save has no ${key}`);
    const ui = heist.ui && typeof heist.ui === 'object' ? heist.ui as Partial<Ui> : null;
    const seq = typeof heist.seq === 'number' ? heist.seq : 0;
    const numbers = (v: unknown): number[] | undefined => (Array.isArray(v) && v.every(n => typeof n === 'number') ? v as number[] : undefined);
    const recentTurns = numbers(heist.recentTurns);
    const undoRecentTurns = Array.isArray(heist.undoRecentTurns) ? heist.undoRecentTurns.map(numbers).map(t => t ?? []) : undefined;
    const base = { ...saved, genVersion, world, worldId: String(heist.worldId), ui, seq, recentTurns };
    // Undo needs the events before each undoable action; a save without them in step loses its undo rather than
    // making them up.
    if (!Array.isArray(heist.undoRecent) || heist.undoRecent.length !== saved.undo.length) return { ...base, undo: [], undoRecent: [], undoRecentTurns: [] };
    return { ...base, undoRecent: heist.undoRecent as SimEvent[][], undoRecentTurns };
}

/** The UI entry: the UI state alone, written cheaply between heist saves, for the heist save number `seq`. */
export function serialiseUi<Ui>(seq: number, ui: Ui): string {
    return JSON.stringify({ format: SAVE_FORMAT, seq, ui });
}

/** The UI in a UI entry if it belongs to heist save `seq`, else null. Never throws. */
export function deserialiseUi<Ui>(text: string | null, seq: number): Partial<Ui> | null {
    if (text === null) return null;
    try {
        const entry = parseObject(text, 'UI');
        return entry.format === SAVE_FORMAT && entry.seq === seq && entry.ui && typeof entry.ui === 'object' ? entry.ui as Partial<Ui> : null;
    } catch {
        return null;
    }
}
