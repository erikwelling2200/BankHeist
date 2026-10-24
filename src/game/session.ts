import {
    actionPreview, assertPlainJson, autoStep, clonePlain, commandPreview, explain, holdPreview, type CommandPlan, pathSafety, safeFloor, safeFloorJob, type ActionPreview, type CarrierChanges, type Explanation, type FloorBand, type FloorJob,
    type PathSafety, type SafeFloor, commit, deepFreeze, hashOf, noticedUnseen, popUndo, preview, previewCertain, projectEvents, projectPreviewEvents, RECENT_EVENTS, recordUndo, SaveFormatError, stableJson,
    type AutoOptions, type AutoStepResult, type AutoStop, type Command, type CommitResult, type Pos, type PreviewResult, type ReadonlyWorld, type Routes, type SimEvent, type State,
    type UndoStack, withLayoutCameras
} from '../sim';
import { foundStop } from './evidenceWarning';
import { deserialiseHeist, deserialiseUi, heistWorldId, serialiseHeist, serialiseUi, serialiseWorld } from './persist';
import { PlaybackQueue, type PlaybackItem } from './playback';
import type { SaveStorage } from './storage';
import type { HudViewModel, RecapVM } from '../ui/hud/viewModels';
import { hudView, recapView, type HudExtras } from './views';

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
export interface CameraView { x: number; y: number; zoom: number; /** The tactical map shows (x, y and zoom are the view to go back to). */ map?: boolean }

/** What the player had on screen, restored on resume (§20.6). */
export interface UiState {
    /** The selected crew member's id. */
    selected: string | null;
    camera: CameraView | null;
    /** The command being previewed and not yet confirmed, so a resume shows the same preview (§20.6). */
    pendingCommand: Command | null;
    /** Each crew member's multi-turn route still to walk (§6.5, src/sim/rules/autoAdvance.ts), by crew id; absent: none. */
    routes?: Routes;
    /** Why the last auto-advance stopped, as the HUD's line shows it until the next run (§6.5); absent: none. */
    autoStop?: AutoStop;
}

export type SessionChange =
    | {
        kind: 'commit' | 'endTurn'; command: Command; result: CommitResult; queued: PlaybackItem[];
        /** The commit is final because someone the crew doesn't know of noticed it (`noticedUnseen`): "something stirred". */
        noticedUnseen: boolean;
    }
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

/**
 * What of a preview the player sees (§8.15): `result` from `previewCertain` (the doors the crew can't vouch for shut),
 * its events projected through the crew's knowledge (`projectPreviewEvents`), so nothing about an NPC the crew neither
 * sees nor predicts shows (an unseen listener doesn't turn Confirm amber). The state is that certain preview's; the HUD
 * and overlays read only the events.
 */
export function projectPreview(result: PreviewResult, before: State, world: ReadonlyWorld): PlayerPreview {
    return { ...result, events: projectPreviewEvents(world, before, result) };
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

/**
 * The undo stack's companion: the recent events (and their turns) before each undoable action, and the playback items it
 * queued.
 */
interface UndoExtra { recent: readonly SimEvent[]; recentTurns: readonly number[]; seqs: number[]; /** The routes before it (in memory only). */ routes?: Routes }

/** The turns of saved recent events, or (a save from before turns were kept, or out of step) the current turn for each. */
const turnsOrNow = (turns: readonly number[] | undefined, events: readonly SimEvent[], turn: number): number[] =>
    turns && turns.length === events.length && turns.every(t => Number.isInteger(t)) ? [...turns] : events.map(() => turn);

/** The UI as saved, checked against the state: an unknown crew id, a bad camera or a bad command are dropped. */
function checkUi(ui: Partial<UiState> | null | undefined, state: State): UiState {
    const selected = typeof ui?.selected === 'string' && state.crew.some(c => c.id === ui.selected) ? ui.selected : null;
    const c = ui?.camera;
    const camera = c && typeof c === 'object' && [c.x, c.y, c.zoom].every(n => typeof n === 'number' && Number.isFinite(n)) && c.zoom > 0
        ? { x: c.x, y: c.y, zoom: c.zoom, ...(c.map === true ? { map: true } : {}) } : null;
    const p = ui?.pendingCommand;
    let pendingCommand: Command | null = null;
    if (p && typeof p === 'object' && typeof p.type === 'string') {
        try {
            assertPlainJson(p);
            pendingCommand = clonePlain(p);
        } catch { /* dropped */ }
    }
    // Older saves also kept a picked action ('dash'): movement now picks Move or Dash by distance, so it is dropped.
    const routes = checkRoutes(ui?.routes, state);
    const autoStop = checkStop(ui?.autoStop);
    return { selected, camera, pendingCommand, ...(Object.keys(routes).length ? { routes } : {}), ...(autoStop ? { autoStop } : {}) };
}

/** A saved stop, checked: a kind and a line, and a tile if any. */
function checkStop(stop: unknown): AutoStop | undefined {
    if (!stop || typeof stop !== 'object') return undefined;
    const { kind, text, at, npc, crew } = stop as Record<string, unknown>;
    if (typeof kind !== 'string' || typeof text !== 'string') return undefined;
    return {
        kind: kind as AutoStop['kind'], text, ...(isTile(at) ? { at: { x: at.x, y: at.y } } : {}),
        ...(typeof npc === 'string' ? { npc } : {}), ...(typeof crew === 'string' ? { crew } : {})
    };
}

const isTile = (p: unknown): p is Pos => !!p && typeof p === 'object' && Number.isInteger((p as Pos).x) && Number.isInteger((p as Pos).y);

/** Saved routes, checked: only crew members of the state, only lists of whole tiles. */
function checkRoutes(routes: unknown, state: State): Routes {
    const out: Routes = {};
    if (!routes || typeof routes !== 'object') return out;
    for (const c of state.crew) {
        const r = (routes as Record<string, unknown>)[c.id];
        if (Array.isArray(r) && r.length && r.every(isTile)) out[c.id] = r.map(p => ({ x: p.x, y: p.y }));
    }
    return out;
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
    /** The turn each recent event happened in, recorded when it was appended (in step with `_recent`). */
    private _recentTurns: readonly number[];
    private _ui: UiState;
    private worldSaved: boolean;
    private seq: number;
    private uiTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly uiSaveDelay: number;
    private readonly onListenerError: (error: unknown) => void;
    /** Replaced by another heist in the same save slot (the debug handle's `restart`): it saves nothing any more. */
    private retired = false;
    /** Auto-advance is committing: its moves keep their crew member's route. */
    private autoPlaying = false;
    /** The stop the last auto-advance step ended with: the same evidence stop doesn't hold the next Go again. */
    private lastAutoStop: AutoStop | null = null;
    /** The routes as they were before the command auto-advance is committing (it sets the routes after it first). */
    private routesBefore: Routes | null = null;

    /** Stops this Session saving: another one owns its save slot now. */
    retire(): void {
        this.cancelUiSave();
        this.retired = true;
    }

    /** Where the heist autosaves (the debug handle restarts a scripted heist in it). */
    readonly storage: SaveStorage;
    private readonly listeners = new Set<SessionListener>();
    private cache = new Map<string, Cached>();
    /** `actionPreview` per command, until the state changes (each plays the world phase twice on a copy for its carriers). */
    private actionCache = new Map<string, ActionPreview>();
    private emitting = false;
    private readonly emitQueue: SessionChange[] = [];

    private constructor(init: {
        world: ReadonlyWorld; worldId: string; genVersion: string; storage: SaveStorage; state: State; undo: UndoStack;
        undoExtra: UndoExtra[]; recent: readonly SimEvent[]; recentTurns: readonly number[]; ui: UiState; worldSaved: boolean; seq: number; options: ResumeOptions;
    }) {
        this.world = init.world;
        this.worldId = init.worldId;
        this.genVersion = init.genVersion;
        this.storage = init.storage;
        this._state = deepFreeze(init.state);
        this._undo = deepFreeze([...init.undo]);
        this.undoExtra = init.undoExtra;
        this._recent = deepFreeze(init.recent);
        this._recentTurns = deepFreeze([...init.recentTurns]);
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
            state, undo: [], undoExtra: [], recent: [], recentTurns: [], ui: checkUi(options.ui, state), worldSaved: false, seq: 0, options
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
                // Every camera on the blueprint's layout is known (`withLayoutCameras`), in the state and its undo steps.
                world: saved.world, worldId, genVersion: saved.genVersion, storage, state: withLayoutCameras(saved.world, saved.state),
                undo: saved.undo.map(s => withLayoutCameras(saved.world, s)),
                undoExtra: saved.undoRecent.map((recent, i) => ({ recent, recentTurns: turnsOrNow(saved.undoRecentTurns?.[i], recent, saved.state.turn), seqs: [] })),
                recent: saved.recent, recentTurns: turnsOrNow(saved.recentTurns, saved.recent, saved.state.turn), ui, worldSaved: true,
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

    /** The turn each of `recent` happened in, in step with it. */
    get recentTurns(): readonly number[] {
        return this._recentTurns;
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

    /** Each crew member's route still to walk (§6.5), by crew id. */
    get routes(): Readonly<Routes> {
        return this._ui.routes ?? {};
    }

    /**
     * What the HUD shows now. `extras` adds what only the scene knows (the tactical map); Confirm is
     * coloured from the player's preview of the pending command.
     */
    hud(extras: Omit<HudExtras, 'undoEnabled' | 'previewEvents' | 'costOf'> = {}): HudViewModel {
        let previewEvents: HudExtras['previewEvents'], carriers: CarrierChanges | undefined;
        if (this._ui.pendingCommand) {
            try {
                const shown = this.actionPreview(this._ui.pendingCommand);
                if (shown.ok) {
                    previewEvents = shown.events;
                    carriers = this.carrierChanges(this._ui.pendingCommand);
                }
            } catch { /* a stale command: Confirm shows it, and committing it says why it can't */ }
        }
        return hudView(this.world, this._state, this._ui, {
            ...extras, undoEnabled: this.canUndo, previewEvents, costOf: cmd => this.costOf(cmd), ...(carriers ? { carriers } : {})
        });
    }

    /**
     * Everything the player is shown before confirming `cmd` (§8.8, §8.9, §20.2 step 3): the sim's `actionPreview`, the
     * one projection of a preview through what the crew knows (its events, the noise rings with an ear per known hearer,
     * the witnesses, the carriers it would start or stop, a move's path safety). Cached until the state changes; the
     * result is shared, never change it.
     */
    actionPreview(cmd: Command): ActionPreview {
        const key = stableJson(cmd);
        let found = this.actionCache.get(key);
        if (found) this.actionCache.delete(key);
        else {
            found = actionPreview(this.world, this._state, cmd);
            if (this.actionCache.size >= PREVIEW_CACHE) this.actionCache.delete(this.actionCache.keys().next().value!);
        }
        this.actionCache.set(key, found);
        return found;
    }

    /**
     * What `cmd` does to the alarm carriers (§8.8, Confirm's "this would start: Teller button (2)"): those it starts or
     * stops at once and those the coming world phase would start because of it, as `actionPreview` shows them (the
     * crew's view). Undefined when the rules refuse it.
     */
    carrierChanges(cmd: Command): CarrierChanges | undefined {
        const shown = this.actionPreview(cmd);
        return shown.ok ? shown.carriers : undefined;
    }

    /**
     * The selected crew member's safe floor (§8.8) on the current state, judged on the crew's picture (the sim caches it
     * per state, so asking again is cheap): `bands` limits it, so the Move band can be drawn first and the Dash band a
     * frame later.
     */
    safeFloor(crew: string, bands?: readonly FloorBand[]): SafeFloor {
        return safeFloor(this.world, this._state, crew, bands ? { bands } : {});
    }

    /**
     * The safe floor a slice at a time (the sim's `safeFloorJob`, one job per state and crew member): the scene tints the
     * Move band at once and the Dash band over later frames.
     */
    floorJob(crew: string): FloorJob {
        return safeFloorJob(this.world, this._state, crew);
    }

    /** A drawn path's safety (§8.8): each step's `!`s, the first unsafe step (the eye), its end as the floor tints it. */
    pathSafety(crew: string, path: readonly Pos[], mode?: 'move' | 'dash'): PathSafety {
        return pathSafety(this.world, this._state, crew, path, mode ? { mode } : {});
    }

    /** Who would notice `crew` on `tile` and why (§8.8 long-press), along `path` when one is drawn. */
    explain(crew: string, tile: Pos, path?: readonly Pos[]): Explanation[] {
        return explain(this.world, this._state, crew, tile, path ? { path } : {});
    }

    /**
     * A command's two rings as the crew sees them (§10.1, UI.md "Rings"): the command and panic tiles, each known NPC's
     * outcome and a resister's chance (the one the commit rolls with).
     */
    commandRings(crew: string): CommandPlan {
        return commandPreview(this.world, this._state, crew);
    }

    /** The Commanded NPCs the crew knows of that a hold by `crew` would keep down (§10.3). */
    holdRing(crew: string): string[] {
        return holdPreview(this.world, this._state, crew);
    }

    /** The actions `cmd` spends, from its preview (the engine's: what the commit spends), or undefined when refused. */
    costOf(cmd: Command): number | undefined {
        const crew = (cmd as { crew?: string }).crew;
        const before = this._state.crew.find(c => c.id === crew);
        if (!before) return undefined;
        try {
            const after = this.preview(cmd).state.crew.find(c => c.id === crew);
            // GO gives an action rather than spending one (§9.3): it costs nothing.
            return after ? Math.max(0, before.actionsLeft - after.actionsLeft) : undefined;
        } catch {
            return undefined;
        }
    }

    /** The resume recap card (§20.6): the last 3 events, the bank, the turn and each crew member's status. */
    recap(): RecapVM {
        return recapView(this.world, this._state, this._recent, this._recentTurns);
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

    /**
     * The preview the HUD and overlays may show (`projectPreview`): `previewCertain` (the doors the crew can't vouch for
     * shut), its state and its events projected to what the crew can know. Throws what the engine throws.
     */
    playerPreview(cmd: Command): PlayerPreview {
        return projectPreview(previewCertain(this.world, this._state, cmd), this._state, this.world);
    }

    /**
     * Plays `cmd` for real: the undo stack grows if it was undoable and empties if not, its events are queued for
     * playback, and the heist is autosaved. Throws, changing nothing, if the engine refuses it. The result is frozen.
     */
    commit(cmd: Command): CommitResult {
        const before = this._state, result = deepFreeze(commit(this.world, before, cmd));
        const routesBefore = this.routesBefore ?? this.routes;
        // A crew member moved by hand gives up their route; one walking it for auto-advance keeps the rest.
        if (!this.autoPlaying && (cmd.type === 'move' || cmd.type === 'dash') && Object.hasOwn(this.routes, cmd.crew)) this.dropRoute(cmd.crew);
        // The player is told only what the crew perceives (§8.15): playback, the event log and the recap get the projection.
        const shown = deepFreeze(projectEvents(this.world, result.state, result.events, before));
        const queued = this.playback.push(shown, result.state, before.turn);
        this._undo = deepFreeze(recordUndo(this._undo, before, result.undoable));
        this.undoExtra = result.undoable ? [...this.undoExtra, { recent: this._recent, recentTurns: this._recentTurns, seqs: queued.map(i => i.seq), routes: routesBefore }] : [];
        // Each event's turn is the one the playback queue gave it: a world phase's events belong to the turn that ended.
        this._recent = deepFreeze([...this._recent, ...shown].slice(-RECENT_EVENTS));
        this._recentTurns = deepFreeze([...this._recentTurns, ...queued.map(i => i.turn)].slice(-RECENT_EVENTS));
        this.setState(result.state);
        this.save();
        this.emit({ kind: cmd.type === 'endTurn' ? 'endTurn' : 'commit', command: cmd, result, queued, noticedUnseen: noticedUnseen(this.world, before, result) });
        return result;
    }

    /** Ends the crew phase and plays the world phase. Never undoable (§6.6). */
    endTurn(): CommitResult {
        return this.commit({ type: 'endTurn' });
    }

    /**
     * Plays one turn of auto-advance or "Wait for…" (§6.5, `autoStep` in src/sim/rules/autoAdvance.ts) from the current
     * state with the routes kept here: every command goes through `commit` (autosaved, queued for playback, logged),
     * and the routes left are kept. Returns the step, with why it stopped (null to carry on).
     */
    autoStep(options: Omit<AutoOptions, 'play'> = {}): AutoStepResult {
        this.autoPlaying = true;
        let step: AutoStepResult;
        try {
            step = autoStep(this.world, this._state, this.routes, {
                ...options,
                // Held before a world phase that finds evidence for certain, but not twice in a row for the same.
                beforeEnd: state => {
                    const stop = foundStop(this.world, state), last = this.lastAutoStop;
                    return stop && last && stableJson(stop) === stableJson(last) ? null : stop;
                },
                play: (cmd, state, routes) => {
                    if (state !== this._state) throw new Error('Auto-advance played from a state that isn\'t the session\'s');
                    // The routes as they will be go into the autosave with the command, so a resume walks on from there.
                    this.routesBefore = this.routes;
                    this.putRoutes(routes);
                    try {
                        return this.commit(cmd);
                    } finally {
                        this.routesBefore = null;
                    }
                }
            });
        } finally {
            this.autoPlaying = false;
        }
        this.lastAutoStop = step.stop;
        this.putRoutes(step.routes);
        this.emit({ kind: 'ui' });
        return step;
    }

    /** Sets a crew member's route (§6.5): the tiles to walk from where they stand, over as many turns as it takes; null or [] clears it. */
    setRoute(crew: string, route: readonly Pos[] | null): void {
        if (!this._state.crew.some(c => c.id === crew)) throw new Error(`No crew member '${crew}' to route`);
        if (!route?.length) return this.dropRoute(crew);
        if (!route.every(isTile)) throw new Error('A route is a list of tiles');
        this.setUi({ routes: { ...this.routes, [crew]: route.map(p => ({ x: p.x, y: p.y })) } });
        this.emit({ kind: 'ui' });
    }

    /** Why the last auto-advance stopped (kept with the UI state, so a resume shows it), or null to clear it. */
    setAutoStop(stop: AutoStop | null): void {
        const { autoStop: _old, ...rest } = this._ui;
        this._ui = deepFreeze(stop ? { ...rest, autoStop: clonePlain(stop) } : rest);
        this.setUi({});
    }

    /** Sets the routes, leaving the key out of the UI state when there are none (so a save reads back the same). */
    private putRoutes(routes: Routes): void {
        const { routes: _old, ...rest } = this._ui;
        this._ui = deepFreeze(Object.keys(routes).length ? { ...rest, routes } : rest);
        this.setUi({});
    }

    private dropRoute(crew: string): void {
        if (!Object.hasOwn(this.routes, crew)) return;
        const { [crew]: _gone, ...rest } = this.routes;
        this.putRoutes(rest);
        this.emit({ kind: 'ui' });
    }

    /** Takes back the last undoable action and its queued playback; false when there is none. */
    undo(): boolean {
        const popped = popUndo(this._undo), extra = this.undoExtra.at(-1);
        if (!popped || !extra) return false;
        this._undo = popped.stack;
        this.undoExtra = this.undoExtra.slice(0, -1);
        this._recent = extra.recent;
        this._recentTurns = extra.recentTurns;
        if (extra.routes && stableJson(extra.routes) !== stableJson(this.routes)) this.putRoutes(extra.routes);
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
        const next = camera && { x: camera.x, y: camera.y, zoom: camera.zoom, ...(camera.map ? { map: true } : {}) };
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
        if (this.retired) return false;
        try {
            const heist = serialiseHeist({
                worldId: this.worldId, state: this._state, recent: this._recent, recentTurns: [...this._recentTurns], undo: this._undo,
                undoRecent: this.undoExtra.map(e => [...e.recent]), undoRecentTurns: this.undoExtra.map(e => [...e.recentTurns]), ui: this._ui, seq: this.seq + 1
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
        if (this.retired) return;
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
        this.actionCache = new Map();
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
