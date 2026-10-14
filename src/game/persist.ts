import { assertPlainJson, deserialise, SAVE_FORMAT, SaveFormatError, type ReadonlyWorld, type Saved, type SimEvent, type State, type UndoStack } from '../sim';

/*
 * How the Session's two autosave entries are written and read, behind two pairs of functions, so this can move onto
 * the core's per-action save (state, recent events and undo, with the world serialised once) when src/sim has it.
 * Both entries carry src/sim's SAVE_FORMAT, and reading puts them back together through its `deserialise`, so a save
 * is checked and frozen the same way however it is stored.
 */

/** What the Session keeps beside the core save: the UI and the recent events before each undoable action. */
export interface HeistExtras<Ui> {
    worldId: string;
    /** In step with the undo stack, so undoing takes its events back too. */
    undoRecent: SimEvent[][];
    ui: Ui;
}

export function serialiseWorld(genVersion: string, world: ReadonlyWorld): string {
    return JSON.stringify({ format: SAVE_FORMAT, genVersion, world });
}

export function serialiseHeist<Ui>(saved: { state: State; recent: readonly SimEvent[]; undo: UndoStack } & HeistExtras<Ui>): string {
    const heist = {
        format: SAVE_FORMAT, worldId: saved.worldId, state: saved.state, recent: saved.recent, undo: saved.undo,
        undoRecent: saved.undoRecent, ui: saved.ui
    };
    assertPlainJson(heist, 'heist');
    return JSON.stringify(heist);
}

function parse(text: string, what: string): Record<string, unknown> {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new SaveFormatError(`The ${what} isn't JSON: ${(e as Error).message}`);
    }
    if (!data || typeof data !== 'object') throw new SaveFormatError(`The ${what} is not an object`);
    const record = data as Record<string, unknown>;
    if (record.format !== SAVE_FORMAT) {
        throw new SaveFormatError(`The ${what} has format ${String(record.format)}, this build reads format ${SAVE_FORMAT}`);
    }
    return record;
}

/** The world id a heist entry was played in, to find its world entry. */
export function heistWorldId(heistText: string): string {
    const id = parse(heistText, 'save').worldId;
    if (typeof id !== 'string') throw new SaveFormatError('The save names no world');
    return id;
}

export function deserialiseHeist<Ui>(heistText: string, worldText: string): Saved & HeistExtras<Partial<Ui> | null> {
    const heist = parse(heistText, 'save'), stored = parse(worldText, 'saved world');
    const saved = deserialise(JSON.stringify({
        format: SAVE_FORMAT, genVersion: stored.genVersion, world: stored.world, state: heist.state, recent: heist.recent, undo: heist.undo
    }));
    const undoRecent = Array.isArray(heist.undoRecent) && heist.undoRecent.length === saved.undo.length
        ? heist.undoRecent as SimEvent[][] : saved.undo.map(() => saved.recent);
    const ui = heist.ui && typeof heist.ui === 'object' ? heist.ui as Partial<Ui> : null;
    return { ...saved, worldId: String(heist.worldId), undoRecent, ui };
}
