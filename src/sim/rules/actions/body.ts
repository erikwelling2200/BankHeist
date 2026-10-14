import { tileAt } from '../../core/grid';
import { registerCrewInit, registerNpcInit } from '../../core/state';
import type { CrewState, DeepReadonly, NpcState, NpcStatus, Pos, ReadonlyWorld, State } from '../../core/types';
import { registerEvents } from '../../core/undo';
import { registerBudgetModifier, registerDashCheck, registerMoveHook } from '../../crew/movement';
import { isPresent } from '../npc/walk';
import { inReach, lacksActions, registerAction } from './act';

/*
 * Bodies (§8.10, §6.3): a knocked-out, dead or tied person can be dragged (1 action to take hold), dropped (1 action)
 * and stashed (1 action) in a closet or a dumpster. Stashed bodies are not evidence (rules/evidence.ts).
 *
 * - **Dragging** is a Very Heavy carry: the crew member's Move reaches half as far (`registerBudgetModifier`, in
 *   half-steps, rounded down), they can't Dash, and they show as Armed (`Loadout.carrying` 'body', data/items.ts
 *   `CARRIED`). The body lies on the dragger's tile and follows every step (the move hook). Taking hold of a body and
 *   stashing it are the illegal act "dragging a body" (§8.4): `!` for anyone who sees it. Walking with it is judged by
 *   the profile (Armed) like any other move, so the move overlay stays exact (implementation plan §6 decision 27).
 * - **Stashing** needs a stash in reach: an object of a `STASH_KINDS` kind (a dumpster, a closet) or a room the World
 *   tags as one (`World.stashRooms`: the cleaner's closet), standing anywhere in it. The body then lies in the stash:
 *   on the object's tile when it can be stood on, else where the crew member stood. `NpcState.stashed` names the
 *   stash; the scene should hide stashed NPCs as it hides those away.
 */

declare module '../../core/types' {
    interface CommandMap {
        /** Take hold of a body (knocked out, dead or tied) in reach, to drag it (1 action, an illegal act). */
        drag: { crew: string; npc: string };
        /** Let go of the body being dragged, where the crew member stands (1 action). */
        drop: { crew: string };
        /** Put the body being dragged in a stash: the object `at` in reach, or the stash room they stand in (1 action). */
        stash: { crew: string; at?: string };
    }
    interface CrewState {
        /** The NPC whose body they drag (§8.10), or null. */
        dragging: string | null;
    }
    interface NpcState {
        /** The stash it lies in (an object id or a room id), or null: a stashed body is not evidence. */
        stashed: string | null;
    }
    interface World {
        /** Rooms a body can be stashed anywhere in (the cleaner's closet). Absent: none. */
        stashRooms?: string[];
    }
    interface EventMap {
        bodyLifted: { crew: string; npc: string };
        bodyDropped: { crew: string; npc: string; at: Pos };
        bodyStashed: { crew: string; npc: string; stash: string; at: Pos };
    }
}

/** Object kinds a body can be stashed in (§8.10: closets and dumpsters). */
export const STASH_KINDS: ReadonlySet<string> = new Set(['dumpster', 'closet']);

/** Statuses of someone lying still enough to be dragged: out cold, dead or tied. */
export const DRAGGABLE: ReadonlySet<NpcStatus> = new Set<NpcStatus>(['unconscious', 'dead', 'tied']);

registerCrewInit('body', (_world, _start, member) => {
    member.dragging = null;
});

registerNpcInit('body', (_world, _person, npc) => {
    npc.stashed = null;
});

/** Who drags this NPC's body, if anyone. */
export const draggedBy = (state: DeepReadonly<State>, npc: string): DeepReadonly<CrewState> | undefined => state.crew.find(c => c.dragging === npc);

/** Whether an NPC's body is in a stash or being dragged: not lying anywhere to be found. */
export const bodyAway = (state: DeepReadonly<State>, npc: DeepReadonly<NpcState>): boolean => npc.stashed !== null || !!draggedBy(state, npc.id);

/** Why a crew member can't take hold of this NPC's body, or undefined. */
function dragBlocked(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, id: string): string | undefined {
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    if (member.dragging !== null || member.loadout.carrying !== null) return `${member.name}'s hands are full`;
    const npc = state.npcs.find(n => n.id === id);
    if (!npc || !isPresent(npc)) return `No one called '${id}' is here`;
    if (!DRAGGABLE.has(npc.status)) return 'Only a body or a tied person can be dragged';
    if (npc.stashed !== null) return 'The body is stashed';
    if (draggedBy(state, id)) return 'Someone is already dragging the body';
    if (!inReach(world, state, member.pos, npc.pos)) return `${member.name} can't reach them from here`;
    return undefined;
}

/** The stash a crew member would use: the object `at`, or the stash room they stand in. */
function stashOf(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, at: string | undefined): { id: string; pos: Pos | null } | string {
    if (at !== undefined) {
        const obj = world.objects.find(o => o.id === at);
        if (!obj || !STASH_KINDS.has(obj.kind)) return `'${at}' is nowhere to hide a body`;
        if (!inReach(world, state, member.pos, obj.pos)) return `${member.name} can't reach the ${obj.kind}`;
        return { id: obj.id, pos: tileAt(world, obj.pos)!.blocksMove ? null : { x: obj.pos.x, y: obj.pos.y } };
    }
    const room = tileAt(world, member.pos)?.room ?? null;
    if (room === null || !world.stashRooms?.includes(room)) return 'There is nowhere here to hide a body';
    return { id: room, pos: null };
}

registerAction('drag', {
    whyNot: (world, state, cmd) => dragBlocked(world, state, state.crew.find(c => c.id === cmd.crew)!, cmd.npc),
    candidates: (_world, state, member) => state.npcs.filter(n => DRAGGABLE.has(n.status)).map(n => ({ type: 'drag', crew: member.id, npc: n.id })),
    cost: () => 1,
    illegal: () => ({ act: 'dragBody' }),
    run(ctx, member, cmd) {
        const npc = ctx.state.npcs.find(n => n.id === cmd.npc)!;
        member.dragging = npc.id;
        member.loadout.carrying = 'body';
        npc.pos = { x: member.pos.x, y: member.pos.y };
        ctx.emit({ type: 'bodyLifted', crew: member.id, npc: npc.id });
    }
});

registerAction('drop', {
    whyNot(_world, state, cmd) {
        const member = state.crew.find(c => c.id === cmd.crew)!;
        return lacksActions(member, 1) ?? (member.dragging === null ? `${member.name} isn't dragging anyone` : undefined);
    },
    candidates: (_world, _state, member) => (member.dragging !== null ? [{ type: 'drop', crew: member.id }] : []),
    cost: () => 1,
    run(ctx, member) {
        const id = member.dragging!;
        releaseBody(ctx.state, member);
        ctx.emit({ type: 'bodyDropped', crew: member.id, npc: id, at: { x: member.pos.x, y: member.pos.y } });
    }
});

registerAction('stash', {
    whyNot(world, state, cmd) {
        const member = state.crew.find(c => c.id === cmd.crew)!;
        const lack = lacksActions(member, 1);
        if (lack) return lack;
        if (member.dragging === null) return `${member.name} isn't dragging anyone`;
        const stash = stashOf(world, state, member, cmd.at);
        return typeof stash === 'string' ? stash : undefined;
    },
    candidates(world, _state, member) {
        if (member.dragging === null) return [];
        return [
            { type: 'stash', crew: member.id },
            ...world.objects.filter(o => STASH_KINDS.has(o.kind)).map(o => ({ type: 'stash' as const, crew: member.id, at: o.id }))
        ];
    },
    cost: () => 1,
    illegal: () => ({ act: 'dragBody' }),
    run(ctx, member, cmd) {
        const stash = stashOf(ctx.world, ctx.state, member, cmd.at) as { id: string; pos: Pos | null };
        const npc = ctx.state.npcs.find(n => n.id === member.dragging)!;
        releaseBody(ctx.state, member);
        npc.stashed = stash.id;
        npc.pos = stash.pos ?? { x: member.pos.x, y: member.pos.y };
        ctx.emit({ type: 'bodyStashed', crew: member.id, npc: npc.id, stash: stash.id, at: { x: npc.pos.x, y: npc.pos.y } });
    }
});

/** Lets go of the body a crew member drags (it stays where it lies). */
export function releaseBody(_state: State, member: CrewState): void {
    member.dragging = null;
    if (member.loadout.carrying === 'body') member.loadout.carrying = null;
}

// A Very Heavy carry: half the reach, and no Dash (§6.3, §8.10).
registerBudgetModifier('dragging', (_world, member, _mode, budget) => (member.dragging !== null ? Math.floor(budget / 2) : budget));
registerDashCheck('dragging', m => (m.dragging !== null ? `${m.name} can't dash dragging a body` : undefined));

// The body follows the dragger step by step.
registerMoveHook('body', {
    step(ctx, member) {
        if (member.dragging === null) return;
        const npc = ctx.state.npcs.find(n => n.id === member.dragging);
        if (npc) npc.pos = { x: member.pos.x, y: member.pos.y };
    }
});

/** The stash objects and rooms of a world, for the UI's hints. */
export function stashes(world: ReadonlyWorld): { objects: string[]; rooms: string[] } {
    return { objects: world.objects.filter(o => STASH_KINDS.has(o.kind)).map(o => o.id), rooms: [...(world.stashRooms ?? [])].sort() };
}

registerEvents({
    bodyLifted: { undoBlocking: true },
    bodyDropped: { undoBlocking: true },
    bodyStashed: { undoBlocking: true }
});
