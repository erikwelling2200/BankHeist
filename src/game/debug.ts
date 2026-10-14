import {
    crewMoveOptions, crewPicture, dashBudget, moveBudget, pathTo, reachable, type Command, type CommitResult, type Pos, type PreviewResult, type ReadonlyWorld, type State
} from '../sim';
import type { PlayerPreview, Session } from './session';

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
    commit(cmd: Command): CommitResult;
    endTurn(): CommitResult;
    undo(): boolean;
    /**
     * The path a crew member's Move (or Dash) would take to `to` now, as a tap on it picks it (on the crew's picture), or
     * undefined when it is out of reach; for scripted runs: `commit({ type: 'move', crew, path: sim.path(crew, to)! })`.
     */
    path(crew: string, to: Pos, mode?: 'move' | 'dash'): Pos[] | undefined;
}

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
        commit: cmd => session.commit(cmd),
        endTurn: () => session.endTurn(),
        undo: () => session.undo(),
        path: (crew, to, mode = 'move') => {
            const member = session.state.crew.find(c => c.id === crew);
            if (!member) return undefined;
            const budget = mode === 'dash' ? dashBudget(session.world) : moveBudget(session.world, member);
            // Planned on the crew's picture, as a tap is: a tile an unseen NPC stands on reads as open (§8.15).
            return pathTo(reachable(session.world, crewPicture(session.world, session.state), member.pos, budget, crewMoveOptions(member)), to);
        }
    };
    target.sim = handle;
    return () => {
        if (target.sim === handle) delete target.sim;
    };
}
