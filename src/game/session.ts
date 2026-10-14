import {
    appendRecent, assertPlainJson, clonePlain, commit, deepFreeze, hashOf, popUndo, preview, recordUndo, SaveFormatError, stableJson,
    type Command, type CommitResult, type PreviewResult, type ReadonlyWorld, type SimEvent, type State, type UndoStack
} from '../sim';
import { deserialiseHeist, deserialiseUi, heistWorldId, serialiseHeist, serialiseUi, serialiseWorld } from './persist';
import { PlaybackQueue, type PlaybackItem } from './playback';
import type { SaveStorage } from './storage';
import { hudView, recapView, type HudView, type RecapView } from './views';

/*
 * The Session sits between the pure rules (src/sim) and the scene and HUD (implementation plan §2.4, §2.5). It owns
 * the World and the State, previews (cached) and commits commands, keeps the undo stack (§6.6), queues events for the
 * scene to play back (§20.5), and autosaves after every commit, undo and end of turn (§20.6).
 *
 * The autosave is two entries: the World under `world:<id>` (its hash), written once, and the heist under `heist`
 * (the state, the undo stack, the recent events and the UI state), rewritten every time (./persist.ts). Selection,
 * camera and a pending command change far more often than the state: they go to a small `ui` entry, debounced.
 *
 * The scene must call `save()` on `visibilitychange` (hidden) and `pagehide`, so a debounced UI change isn't lost when
 * the OS kills the app (§20.6).
 *
 * Everything the Session hands out (state, events, results, previews) is frozen: the undo stack, the cache, the
 * playback queue and the autosave share it, so a caller changing it would make them disagree.
 */

/** Where the camera looks. Opaque to the Session: the scene sets it and gets it back on resume. */
export interface CameraView { x: number; y: number; zoom: number }

/** What the player had on screen, restored on resume (§20.6). */
export interface UiState {
    /** The selected crew member's id. */
    selected: string | null;
    camera: CameraView | null;
    /** The command being previewed and not yet confirmed, so a resume shows the same preview (§20.6). */
    pendingCommand: Command | null;
}

export type SessionChange =
    | { kind: 'commit' | 'endTurn'; command: Command; result: CommitResult; queued: PlaybackItem[] }
    | { kind: 'undo' }
    | { kind: 'ui' };

export type SessionListener = (change: SessionChange, session: Session) => void;

/** The storage key of the heist in progress. */
export const HEIST_KEY = 'heist';
/** The storage key of a world, by its id. */
export const worldKey = (id: string): string => `world:${id}`;
/** The storage key of the UI state written between heist saves. */
export const UI_KEY = 'ui';

/** How many previews the Session keeps (the overlay asks for a few at a time: the path, a tile, an action). */
export const PREVIEW_CACHE = 64;

type Cached = { result: PreviewResult } | { error: unknown };

/**
 * A preview as the player may see it. The engine's PreviewResult is the truth, events the crew can't see included;
 * the HUD and overlays get only this.
 */
export type PlayerPreview = PreviewResult;

/** What of a preview the player sees. TODO(M1-09/M1-10: project through crew knowledge); passes everything for now. */
export function projectPreview(result: PreviewResult, _state: State, _world: ReadonlyWorld): PlayerPreview {
    return result;
}

export interface SessionOptions {
    world: ReadonlyWorld;
    state: State;
    storage: SaveStorage;
    /** The generator that built the world ('fixture' for test worlds). */
    genVersion: string;
    ui?: Partial<UiState>;
    /** How long a UI change waits before it is written (ms); default 500. */
    uiSaveDelay?: number;
    /** Gets errors a listener threw (default console.error); they never reach the caller of commit or undo. */
    onListenerError?: (error: unknown) => void;
}

export type ResumeOptions = Pick<SessionOptions, 'uiSaveDelay' | 'onListenerError'>;

/** The undo stack's companion: the recent events before each undoable action, and the playback items it queued. */
interface UndoExtra { recent: readonly SimEvent[]; seqs: number[] }

/** The UI as saved, checked against the state: an unknown crew id, a bad camera or a bad command are dropped. */
function checkUi(ui: Partial<UiState> | null | undefined, state: State): UiState {
    const selected = typeof ui?.selected === 'string' && state.crew.some(c => c.id === ui.selected) ? ui.selected : null;
    const c = ui?.camera;
    const camera = c && typeof c === 'object' && [c.x, c.y, c.zoom].every(n => typeof n === 'number' && Number.isFinite(n)) && c.zoom > 0
        ? { x: c.x, y: c.y, zoom: c.zoom } : null;
    const p = ui?.pendingCommand;
    let pendingCommand: Command | null = null;
    if (p && typeof p === 'object' && typeof p.type === 'string') {
        try {
            assertPlainJson(p);
            pendingCommand = clonePlain(p);
        } catch { /* dropped */ }
    }
    return { selected, camera, pendingCommand };
}

export class Session {
    readonly world: ReadonlyWorld;
    readonly worldId: string;
    readonly genVersion: string;
    readonly playback = new PlaybackQueue();
    /** The last autosave's error (a full quota), or null when it worked. */
    lastSaveError: unknown = null;
    /** Why the last `resume` found nothing to resume (null when there simply was no heist, or it worked). */
    static lastResumeError: unknown = null;

    private _state: State;
    private _undo: UndoStack;
    private undoExtra: UndoExtra[];
    private _recent: readonly SimEvent[];
    private _ui: UiState;
    private worldSaved: boolean;
    private seq: number;
    private uiTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly uiSaveDelay: number;
    private readonly onListenerError: (error: unknown) => void;
    private readonly storage: SaveStorage;
    private readonly listeners = new Set<SessionListener>();
    private cache = new Map<string, Cached>();
    private emitting = false;
    private readonly emitQueue: SessionChange[] = [];

    private constructor(init: {
        world: ReadonlyWorld; worldId: string; genVersion: string; storage: SaveStorage; state: State; undo: UndoStack;
        undoExtra: UndoExtra[]; recent: readonly SimEvent[]; ui: UiState; worldSaved: boolean; seq: number; options: ResumeOptions;
    }) {
        this.world = init.world;
        this.worldId = init.worldId;
        this.genVersion = init.genVersion;
        this.storage = init.storage;
        this._state = deepFreeze(init.state);
        this._undo = deepFreeze([...init.undo]);
        this.undoExtra = init.undoExtra;
        this._recent = deepFreeze(init.recent);
        this._ui = deepFreeze(init.ui);
        this.worldSaved = init.worldSaved;
        this.seq = init.seq;
        this.uiSaveDelay = init.options.uiSaveDelay ?? 500;
        this.onListenerError = init.options.onListenerError ?? (e => console.error('Session listener failed', e));
    }

    /** A new heist: replaces any heist in progress in `storage`, and saves at once. */
    static start(options: SessionOptions): Session {
        const state = clonePlain(options.state);
        const session = new Session({
            world: options.world, worldId: hashOf(options.world), genVersion: options.genVersion, storage: options.storage,
            state, undo: [], undoExtra: [], recent: [], ui: checkUi(options.ui, state), worldSaved: false, seq: 0, options
        });
        session.save();
        return session;
    }

    /**
     * The heist in progress in `storage`, exactly as it was autosaved, or null if there is none or it can't be read
     * (another format, its world missing or not the one it was played in); `Session.lastResumeError` then says why.
     */
    static resume(storage: SaveStorage, options: ResumeOptions = {}): Session | null {
        Session.lastResumeError = null;
        try {
            const heistText = storage.get(HEIST_KEY);
            if (heistText === null) return null;
            const worldId = heistWorldId(heistText), worldText = storage.get(worldKey(worldId));
            if (worldText === null) throw new SaveFormatError(`The save's world '${worldId}' is missing`);
            const saved = deserialiseHeist<UiState>(heistText, worldText);
            if (hashOf(saved.world) !== worldId) throw new SaveFormatError(`The saved world isn't the world '${worldId}' the heist was played in`);
            const ui = checkUi(deserialiseUi<UiState>(storage.get(UI_KEY), saved.seq) ?? saved.ui, saved.state);
            return new Session({
                world: saved.world, worldId, genVersion: saved.genVersion, storage, state: saved.state, undo: saved.undo,
                undoExtra: saved.undoRecent.map(recent => ({ recent, seqs: [] })), recent: saved.recent, ui, worldSaved: true,
                seq: saved.seq, options
            });
        } catch (e) {
            Session.lastResumeError = e;
            return null;
        }
    }

    /** Forgets the heist in progress (the world stays until another replaces it). */
    static clear(storage: SaveStorage): void {
        storage.remove(HEIST_KEY);
        storage.remove(UI_KEY);
    }

    // ------------------------------------------------------------------------------------------------- Reading

    /** The current state, frozen: commands are the only way to change it. */
    get state(): State {
        return this._state;
    }

    get undoStack(): UndoStack {
        return this._undo;
    }

    get canUndo(): boolean {
        return this._undo.length > 0;
    }

    /** The last events, at most `RECENT_EVENTS`. */
    get recent(): readonly SimEvent[] {
        return this._recent;
    }

    get ui(): Readonly<UiState> {
        return this._ui;
    }

    get selected(): string | null {
        return this._ui.selected;
    }

    get camera(): CameraView | null {
        return this._ui.camera;
    }

    get pendingCommand(): Command | null {
        return this._ui.pendingCommand;
    }

    /** What the HUD shows now. */
    hud(): HudView {
        return hudView(this.world, this._state, this._ui);
    }

    /** The resume recap card (§20.6): the last 3 events, the bank, the turn and each crew member's status. */
    recap(): RecapView {
        return recapView(this.world, this._state, this._recent);
    }

    // ------------------------------------------------------------------------------------------------- Playing

    /**
     * What `cmd` would do from the current state (§6.6), frozen: the engine's truth, for the session and tests; the HUD
     * uses `playerPreview`. The last `PREVIEW_CACHE` are cached until the state changes, so the overlay can ask every
     * frame. Throws what the engine throws (`IllegalCommand` with the reason), from the cache too.
     */
    preview(cmd: Command): PreviewResult {
        const key = stableJson(cmd);
        let cached = this.cache.get(key);
        if (cached) {
            this.cache.delete(key);
        } else {
            try {
                cached = { result: deepFreeze(preview(this.world, this._state, cmd)) };
            } catch (error) {
                cached = { error };
            }
            if (this.cache.size >= PREVIEW_CACHE) this.cache.delete(this.cache.keys().next().value!);
        }
        this.cache.set(key, cached);
        if ('error' in cached) throw cached.error;
        return cached.result;
    }

    /** The preview the HUD and overlays may show: `preview` projected to what the crew can know. */
    playerPreview(cmd: Command): PlayerPreview {
        return projectPreview(this.preview(cmd), this._state, this.world);
    }

    /**
     * Plays `cmd` for real: the undo stack grows if it was undoable and empties if not, its events are queued for
     * playback, and the heist is autosaved. Throws, changing nothing, if the engine refuses it. The result is frozen.
     */
    commit(cmd: Command): CommitResult {
        const before = this._state, result = deepFreeze(commit(this.world, before, cmd));
        const queued = this.playback.push(result.events, result.state, before.turn);
        this._undo = deepFreeze(recordUndo(this._undo, before, result.undoable));
        this.undoExtra = result.undoable ? [...this.undoExtra, { recent: this._recent, seqs: queued.map(i => i.seq) }] : [];
        this._recent = deepFreeze(appendRecent(this._recent, result.events));
        this.setState(result.state);
        this.save();
        this.emit({ kind: cmd.type === 'endTurn' ? 'endTurn' : 'commit', command: cmd, result, queued });
        return result;
    }

    /** Ends the crew phase and plays the world phase. Never undoable (§6.6). */
    endTurn(): CommitResult {
        return this.commit({ type: 'endTurn' });
    }

    /** Takes back the last undoable action and its queued playback; false when there is none. */
    undo(): boolean {
        const popped = popUndo(this._undo), extra = this.undoExtra.at(-1);
        if (!popped || !extra) return false;
        this._undo = popped.stack;
        this.undoExtra = this.undoExtra.slice(0, -1);
        this._recent = extra.recent;
        this.playback.remove(extra.seqs);
        this.setState(popped.state);
        this.save();
        this.emit({ kind: 'undo' });
        return true;
    }

    // ------------------------------------------------------------------------------------------------- UI state

    /** Selects a crew member (or none). */
    select(id: string | null): void {
        if (id !== null && !this._state.crew.some(c => c.id === id)) throw new Error(`No crew member '${id}' to select`);
        if (id === this._ui.selected) return;
        this.setUi({ selected: id });
        this.emit({ kind: 'ui' });
    }

    /** Where the camera looks. */
    setCamera(camera: CameraView | null): void {
        const next = camera && { x: camera.x, y: camera.y, zoom: camera.zoom };
        assertPlainJson(next, 'camera');
        this.setUi({ camera: next });
    }

    /** The command being previewed, not yet confirmed; cleared whenever the state changes. */
    setPendingCommand(cmd: Command | null): void {
        const next = cmd && clonePlain(cmd);
        assertPlainJson(next, 'pendingCommand');
        this.setUi({ pendingCommand: next });
        this.emit({ kind: 'ui' });
    }

    subscribe(listener: SessionListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    // ------------------------------------------------------------------------------------------------- Saving

    /**
     * Writes the heist (and the world, the first time) to storage, UI included. Returns whether it worked; a failure
     * (a full quota) is kept in `lastSaveError` rather than thrown, since the turn itself went fine. The scene calls it
     * when the page is hidden.
     */
    save(): boolean {
        this.cancelUiSave();
        try {
            const heist = serialiseHeist({
                worldId: this.worldId, state: this._state, recent: this._recent, undo: this._undo,
                undoRecent: this.undoExtra.map(e => [...e.recent]), ui: this._ui, seq: this.seq + 1
            });
            if (!this.worldSaved) {
                // Never a heist pointing at a world that isn't there: the old heist goes first, the old worlds last.
                this.storage.remove(HEIST_KEY);
                this.storage.set(worldKey(this.worldId), serialiseWorld(this.genVersion, this.world));
                this.worldSaved = true;
                this.storage.set(HEIST_KEY, heist);
                for (const key of this.storage.keys()) if (key.startsWith('world:') && key !== worldKey(this.worldId)) this.storage.remove(key);
            } else {
                this.storage.set(HEIST_KEY, heist);
            }
            this.seq++;
            this.lastSaveError = null;
            return true;
        } catch (e) {
            this.lastSaveError = e;
            return false;
        }
    }

    /** Writes the UI entry alone (cheap: no state). */
    private saveUi(): void {
        this.cancelUiSave();
        try {
            this.storage.set(UI_KEY, serialiseUi(this.seq, this._ui));
        } catch (e) {
            this.lastSaveError = e;
        }
    }

    private cancelUiSave(): void {
        if (this.uiTimer !== null) clearTimeout(this.uiTimer);
        this.uiTimer = null;
    }

    private setUi(patch: Partial<UiState>): void {
        this._ui = deepFreeze({ ...this._ui, ...patch });
        if (this.uiTimer === null) this.uiTimer = setTimeout(() => this.saveUi(), this.uiSaveDelay);
    }

    private setState(state: State): void {
        this._state = deepFreeze(state);
        this.cache = new Map();
        // A selected crew member who is no longer there (arrested, escaped) is deselected; a pending command is stale.
        const selected = this._ui.selected !== null && state.crew.some(c => c.id === this._ui.selected) ? this._ui.selected : null;
        if (selected !== this._ui.selected || this._ui.pendingCommand) this._ui = deepFreeze({ ...this._ui, selected, pendingCommand: null });
    }

    /** Tells every listener; a change made by a listener is told after this one, and a listener's error is reported. */
    private emit(change: SessionChange): void {
        this.emitQueue.push(change);
        if (this.emitting) return;
        this.emitting = true;
        try {
            for (let next = this.emitQueue.shift(); next; next = this.emitQueue.shift()) {
                for (const listener of [...this.listeners]) {
                    try {
                        listener(next, this);
                    } catch (e) {
                        try {
                            this.onListenerError(e);
                        } catch { /* nowhere left to report it */ }
                    }
                }
            }
        } finally {
            this.emitting = false;
        }
    }
}
