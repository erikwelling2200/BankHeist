import type { Command, CommitResult, PreviewResult, ReadonlyWorld, State } from '../sim';
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
        undo: () => session.undo()
    };
    target.sim = handle;
    return () => {
        if (target.sim === handle) delete target.sim;
    };
}
