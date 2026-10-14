import {
    appendRecent, assertPlainJson, clonePlain, commit, deepFreeze, hashOf, popUndo, preview, recordUndo, SaveFormatError, stableJson,
    type Command, type CommitResult, type PreviewResult, type ReadonlyWorld, type SimEvent, type State, type UndoStack
} from '../sim';
import { deserialiseHeist, heistWorldId, serialiseHeist, serialiseWorld } from './persist';
import { PlaybackQueue, type PlaybackItem } from './playback';
import type { SaveStorage } from './storage';
import { hudView, recapView, type HudView, type RecapView } from './views';

/*
 * The Session sits between the pure rules (src/sim) and the scene and HUD (implementation plan §2.4, §2.5). It owns
 * the World and the State, previews (cached) and commits commands, keeps the undo stack (§6.6), queues events for the
 * scene to play back (§20.5), and autosaves after every commit, undo and end of turn (§20.6).
 *
 * The autosave is two entries: the World under `world:<id>` (its hash), written once, and the heist under `heist`
 * (the state, the undo stack, the recent events and the UI state), rewritten every time (./persist.ts).
 */

/** Where the camera looks. Opaque to the Session: the scene sets it and gets it back on resume. */
export interface CameraView { x: number; y: number; zoom: number }

/** What the player had on screen, restored on resume (§20.6). */
export interface UiState {
    /** The selected crew member's id. */
    selected: string | null;
    camera: CameraView | null;
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
    ui?: UiState;
}

export class Session {
    readonly world: ReadonlyWorld;
    readonly worldId: string;
    readonly genVersion: string;
    readonly playback = new PlaybackQueue();
    /** The last autosave's error (a full quota), or null when it worked. */
    lastSaveError: unknown = null;

    private _state: State;
    private _undo: UndoStack;
    private undoRecent: SimEvent[][];
    private _recent: SimEvent[];
    private _ui: UiState;
    private worldSaved: boolean;
    private readonly storage: SaveStorage;
    private readonly listeners = new Set<SessionListener>();
    private cache = new Map<string, Cached>();

    private constructor(init: {
        world: ReadonlyWorld; worldId: string; genVersion: string; storage: SaveStorage; state: State; undo: UndoStack;
        undoRecent: SimEvent[][]; recent: SimEvent[]; ui: UiState; worldSaved: boolean;
    }) {
        this.world = init.world;
        this.worldId = init.worldId;
        this.genVersion = init.genVersion;
        this.storage = init.storage;
        this._state = init.state;
        this._undo = init.undo;
        this.undoRecent = init.undoRecent;
        this._recent = init.recent;
        this._ui = init.ui;
        this.worldSaved = init.worldSaved;
    }

    /** A new heist: replaces any heist in progress in `storage`, and saves at once. */
    static start(options: SessionOptions): Session {
        const ui = clonePlain(options.ui ?? { selected: null, camera: null });
        assertPlainJson(ui, 'ui');
        const session = new Session({
            world: options.world, worldId: hashOf(options.world), genVersion: options.genVersion, storage: options.storage,
            state: clonePlain(options.state), undo: [], undoRecent: [], recent: [], ui, worldSaved: false
        });
        session.save();
        return session;
    }

    /**
     * The heist in progress in `storage`, exactly as it was autosaved, or null if there is none. Throws
     * `SaveFormatError` for a save this build can't read.
     */
    static resume(storage: SaveStorage): Session | null {
        const heistText = storage.get(HEIST_KEY);
        if (heistText === null) return null;
        const worldId = heistWorldId(heistText), worldText = storage.get(worldKey(worldId));
        if (worldText === null) throw new SaveFormatError(`The save's world '${worldId}' is missing`);
        const saved = deserialiseHeist<UiState>(heistText, worldText);
        const ui: UiState = { selected: saved.ui?.selected ?? null, camera: saved.ui?.camera ?? null };
        return new Session({
            world: saved.world, worldId, genVersion: saved.genVersion, storage, state: saved.state,
            undo: saved.undo, undoRecent: saved.undoRecent, recent: saved.recent, ui, worldSaved: true
        });
    }

    /** Forgets the heist in progress (the world stays until another replaces it). */
    static clear(storage: SaveStorage): void {
        storage.remove(HEIST_KEY);
    }

    // ------------------------------------------------------------------------------------------------- Reading

    /** The current state. Don't change it: commands are the only way to. */
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
     * uses `playerPreview`. Cached until the state changes, so the overlay can ask
     * every frame. Throws what the engine throws (`IllegalCommand` with the reason), from the cache too.
     */
    preview(cmd: Command): PreviewResult {
        const key = stableJson(cmd);
        let cached = this.cache.get(key);
        if (!cached) {
            try {
                cached = { result: deepFreeze(preview(this.world, this._state, cmd)) };
            } catch (error) {
                cached = { error };
            }
            this.cache.set(key, cached);
        }
        if ('error' in cached) throw cached.error;
        return cached.result;
    }

    /** The preview the HUD and overlays may show: `preview` projected to what the crew can know. */
    playerPreview(cmd: Command): PlayerPreview {
        return projectPreview(this.preview(cmd), this._state, this.world);
    }

    /**
     * Plays `cmd` for real: the undo stack grows if it was undoable and empties if not, its events are queued for
     * playback, and the heist is autosaved. Throws, changing nothing, if the engine refuses it.
     */
    commit(cmd: Command): CommitResult {
        const before = this._state, result = commit(this.world, before, cmd);
        this._undo = recordUndo(this._undo, before, result.undoable);
        this.undoRecent = result.undoable ? [...this.undoRecent, this._recent] : [];
        this._recent = appendRecent(this._recent, result.events);
        this.setState(result.state);
        const queued = this.playback.push(result.events, result.state);
        this.save();
        this.emit({ kind: cmd.type === 'endTurn' ? 'endTurn' : 'commit', command: cmd, result, queued });
        return result;
    }

    /** Ends the crew phase and plays the world phase. Never undoable (§6.6). */
    endTurn(): CommitResult {
        return this.commit({ type: 'endTurn' });
    }

    /** Takes back the last undoable action; false when there is none. Drops whatever playback was still queued. */
    undo(): boolean {
        const popped = popUndo(this._undo);
        if (!popped) return false;
        this._undo = popped.stack;
        this._recent = this.undoRecent.at(-1) ?? this._recent;
        this.undoRecent = this.undoRecent.slice(0, -1);
        this.setState(popped.state);
        this.playback.clear();
        this.save();
        this.emit({ kind: 'undo' });
        return true;
    }

    // ------------------------------------------------------------------------------------------------- UI state

    /** Selects a crew member (or none). Saved with the next autosave, or `save()`. */
    select(id: string | null): void {
        if (id !== null && !this._state.crew.some(c => c.id === id)) throw new Error(`No crew member '${id}' to select`);
        if (id === this._ui.selected) return;
        this._ui = { ...this._ui, selected: id };
        this.emit({ kind: 'ui' });
    }

    /** Where the camera looks. Saved with the next autosave, or `save()` (call it when the page is hidden). */
    setCamera(camera: CameraView | null): void {
        const next = camera && { x: camera.x, y: camera.y, zoom: camera.zoom };
        assertPlainJson(next, 'camera');
        this._ui = { ...this._ui, camera: next };
    }

    subscribe(listener: SessionListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    // ------------------------------------------------------------------------------------------------- Saving

    /**
     * Writes the heist (and the world, the first time) to storage. Returns whether it worked; a failure (a full quota)
     * is kept in `lastSaveError` rather than thrown, since the turn itself went fine.
     */
    save(): boolean {
        try {
            if (!this.worldSaved) {
                for (const key of this.storage.keys()) if (key.startsWith('world:') && key !== worldKey(this.worldId)) this.storage.remove(key);
                this.storage.set(worldKey(this.worldId), serialiseWorld(this.genVersion, this.world));
                this.worldSaved = true;
            }
            this.storage.set(HEIST_KEY, serialiseHeist({
                worldId: this.worldId, state: this._state, recent: this._recent, undo: this._undo, undoRecent: this.undoRecent, ui: this._ui
            }));
            this.lastSaveError = null;
            return true;
        } catch (e) {
            this.lastSaveError = e;
            return false;
        }
    }

    private setState(state: State): void {
        this._state = state;
        this.cache = new Map();
        // A selected crew member who is no longer there (arrested, escaped) is deselected.
        if (this._ui.selected !== null && !state.crew.some(c => c.id === this._ui.selected)) this._ui = { ...this._ui, selected: null };
    }

    private emit(change: SessionChange): void {
        for (const listener of [...this.listeners]) listener(change, this);
    }
}
