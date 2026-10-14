import { registerWorldHook } from '../core/engine';
import { sortedIds } from '../core/json';
import type { Pos } from '../core/types';
import { ABSENT_STATUSES } from '../geo/move';
import { registerEvents } from '../core/undo';

/*
 * Leaf doors close themselves (§6 decision 9, §3's staff door that swings shut): at the end of each world phase every
 * open door swings shut, and one with a lock latches locked again, unless
 * - it is propped (`DoorState.propped`, or it was built open: a door wedged open from the start stays so),
 * - it is the vault door (not a leaf door), or
 * - someone (crew or NPC) stands on either tile beside it, in the doorway (a body lying there doesn't hold it).
 * Breached and jammed doors stay as they are. It runs in the devices step, after everyone has acted.
 */

declare module '../core/types' {
    interface DoorState {
        /** Wedged open: it doesn't swing shut. */
        propped?: boolean;
    }
    interface EventMap {
        /** A door shut: by itself at the end of the world phase, or by `by` (a crew member, rules/actions/door.ts). */
        doorClosed: { door: string; by?: string };
    }
}

registerWorldHook('devices', 'doors.swingShut', ctx => {
    const { world, state } = ctx;
    const standing = new Set<string>();
    const at = (p: Pos): string => `${p.x},${p.y}`;
    for (const c of state.crew) standing.add(at(c.pos));
    // A body in the doorway doesn't hold the door (nor one being dragged, whose tile is its dragger's).
    for (const n of state.npcs) if (!ABSENT_STATUSES.has(n.status) && n.status !== 'unconscious' && n.status !== 'dead') standing.add(at(n.pos));
    for (const id of sortedIds(world.doors)) {
        const def = world.doors[id]!, door = state.doors[id];
        if (!door || door.status !== 'open' || door.propped || def.start === 'open' || def.lock === 'vault') continue;
        const edge = world.edges[def.edge];
        if (!edge) continue;
        // The edge's tile south or east of it, and the one across.
        const b = { x: edge.tx, y: edge.ty }, a = edge.run === 'eastWest' ? { x: edge.tx, y: edge.ty - 1 } : { x: edge.tx - 1, y: edge.ty };
        if (standing.has(at(a)) || standing.has(at(b))) continue;
        door.status = def.lock === 'none' ? 'closed' : 'locked';
        ctx.emit({ type: 'doorClosed', door: id });
    }
}, { order: 50 });

registerEvents({ doorClosed: { undoBlocking: false } });
