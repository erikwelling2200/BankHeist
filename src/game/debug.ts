import type { Command, CommitResult, PreviewResult, ReadonlyWorld, State } from '../sim';
import type { Session } from './session';

/*
 * `window.sim` for debugging and the e2e tests (implementation plan §2.5): the live state and world, and the Session's
 * commands. The properties are getters, so the handle always shows the current state, not the one it was made with.
 */

export interface SimHandle {
    readonly state: State;
    readonly world: ReadonlyWorld;
    readonly session: Session;
    preview(cmd: Command): PreviewResult;
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
        commit: cmd => session.commit(cmd),
        endTurn: () => session.endTurn(),
        undo: () => session.undo()
    };
    target.sim = handle;
    return () => {
        if (target.sim === handle) delete target.sim;
    };
}
