import {
    effectOf, safeFloor, type ActionPreview, type AutoStop, type Effect, type SimEvent, type WaitOption, type WaitTarget, type Explanation, type FloorBand, type PathSafety, type SafeFloor, crewBudget, crewMoveOptions, crewPicture, isKnownNow, pathTo, whyNot, reachable, type Command, type CommitResult, type Pos, type PreviewResult, type ReadonlyWorld, type State
} from '../sim';
import { AutoRun, waitMenu } from './autoAdvance';
import { Session, UI_KEY, type PlayerPreview } from './session';

/*
 * `window.sim` for debugging and the e2e tests (implementation plan §2.5): the live state and world, and the Session's
 * commands. The properties are getters, so the handle always shows the current state, not the one it was made with.
 * For development and e2e only: `state` and `preview` are the engine's truth, more than the player may see; the HUD
 * and overlays use `playerPreview`, as here.
 */

export interface SimHandle {
    readonly state: State;
    readonly world: ReadonlyWorld;
    readonly session: Session;
    /** The engine's truth. */
    preview(cmd: Command): PreviewResult;
    /** What the player is shown. */
    playerPreview(cmd: Command): PlayerPreview;
    /** What the player is shown before confirming `cmd` (the sim's `actionPreview`, as the overlay and Confirm use it). */
    actionPreview(cmd: Command): ActionPreview;
    /**
     * The safe floor (§8.8) the overlay draws for `crew` now, or on `state` (a scripted setup being tried); `at` doesn't
     * survive `page.evaluate`: use `tiles`.
     */
    safeFloor(crew: string, bands?: readonly FloorBand[], state?: State): SafeFloor;
    /** A drawn path's safety, as the overlay tints it. */
    pathSafety(crew: string, path: readonly Pos[], mode?: 'move' | 'dash'): PathSafety;
    /** Who would notice `crew` on `tile` and why (the long-press tag). */
    explain(crew: string, tile: Pos, path?: readonly Pos[]): Explanation[];
    commit(cmd: Command): CommitResult;
    endTurn(): CommitResult;
    undo(): boolean;
    /**
     * The path a crew member's Move (or Dash) would take to `to` now, as a tap on it picks it (on the crew's picture), or
     * undefined when it is out of reach; for scripted runs: `commit({ type: 'move', crew, path: sim.path(crew, to)! })`.
     */
    path(crew: string, to: Pos, mode?: 'move' | 'dash'): Pos[] | undefined;
    /**
     * The cheapest path for a multi-turn route (§6.5) to `to`, however far (on the crew's picture), or undefined; for
     * scripted runs: `session.setRoute(crew, sim.routePath(crew, to)!)`. `reach` lists the tiles it could go to with
     * their cost in half-steps.
     */
    routePath(crew: string, to: Pos): Pos[] | undefined;
    routeReach(crew: string): { pos: Pos; cost: number }[];
    /** The "Wait for…" menu as the HUD offers it for the selected crew member (§6.5). */
    waitOptions(): WaitOption[];
    /**
     * Plays "Wait for…" `target` as the HUD's menu does (an `AutoRun`, a turn at a time through the Session, at most
     * `AUTO_TURN_CAP` turns) and returns why it stopped.
     */
    waitFor(target: WaitTarget): AutoStop;
    /**
     * What `events` did to crew member `crew` (pips, exposure, a challenge, a camera's report), `before` being the state
     * they started from: the same reading of an outcome as the safe floor's `now` and `next`, for checking one against
     * the other.
     */
    effect(events: readonly SimEvent[], crew: string, before: State): Effect;
    /** Why the rules refuse `cmd` on `state` (the current one by default), or undefined. */
    whyNot(cmd: Command, state?: State): string | undefined;
    /** Whether the crew knows where NPC `id` is now (§8.15) in `state` (the current one by default). */
    knows(id: string, state?: State): boolean;
    /**
     * For scripted e2e setups: starts a heist from `state` in this one's bank and save slot, replacing the one in
     * progress; reloading the page (`?play`) then resumes it.
     */
    restart(state: State): void;
}

/** How far a scripted route may reach, in half-steps (60 tiles). */
const ROUTE_BUDGET = 120;

declare global {
    interface Window { sim?: SimHandle }
}

/** Sets `target.sim` (the window by default) to a live handle on `session`; returns a function that removes it. */
export function installDebugHandle(session: Session, target: { sim?: SimHandle } = globalThis as { sim?: SimHandle }): () => void {
    const handle: SimHandle = {
        get state() { return session.state; },
        get world() { return session.world; },
        get session() { return session; },
        preview: cmd => session.preview(cmd),
        playerPreview: cmd => session.playerPreview(cmd),
        actionPreview: cmd => session.actionPreview(cmd),
        safeFloor: (crew, bands, state) => (state ? safeFloor(session.world, state, crew, bands ? { bands } : {}) : session.safeFloor(crew, bands)),
        pathSafety: (crew, path, mode) => session.pathSafety(crew, path, mode),
        explain: (crew, tile, path) => session.explain(crew, tile, path),
        commit: cmd => session.commit(cmd),
        endTurn: () => session.endTurn(),
        undo: () => session.undo(),
        whyNot: (cmd, state = session.state) => whyNot(session.world, state, cmd),
        knows: (id, state = session.state) => isKnownNow(session.world, state, id),
        waitOptions: () => waitMenu(session).map(({ target, label }) => ({ target, label })),
        waitFor: target => {
            const run = new AutoRun(session, target);
            for (;;) {
                const stop = run.step();
                if (stop) return stop;
            }
        },
        effect: (events, crew, before) => effectOf(events, crew, before),
        restart: state => {
            session.retire();
            // The old heist's UI (camera, selection, preview) mustn't be resumed with the new one.
            session.storage.remove(UI_KEY);
            Session.start({ world: session.world, state, storage: session.storage, genVersion: session.genVersion });
        },
        routePath: (crew, to) => {
            const member = session.state.crew.find(c => c.id === crew);
            if (!member) return undefined;
            return pathTo(reachable(session.world, crewPicture(session.world, session.state), member.pos, ROUTE_BUDGET, crewMoveOptions(member)), to);
        },
        routeReach: crew => {
            const member = session.state.crew.find(c => c.id === crew);
            if (!member) return [];
            const reach = reachable(session.world, crewPicture(session.world, session.state), member.pos, ROUTE_BUDGET, crewMoveOptions(member));
            return reach.tiles.filter(t => t.canEnd).map(t => ({ pos: { x: t.pos.x, y: t.pos.y }, cost: t.cost }));
        },
        path: (crew, to, mode = 'move') => {
            const member = session.state.crew.find(c => c.id === crew);
            if (!member) return undefined;
            const budget = crewBudget(session.world, member, mode);
            // Planned on the crew's picture, as a tap is: a tile an unseen NPC stands on reads as open (§8.15).
            return pathTo(reachable(session.world, crewPicture(session.world, session.state), member.pos, budget, crewMoveOptions(member)), to);
        }
    };
    target.sim = handle;
    return () => {
        if (target.sim === handle) delete target.sim;
    };
}
