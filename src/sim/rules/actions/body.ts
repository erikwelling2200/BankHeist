import { tileAt } from '../../core/grid';
import { registerCrewInit, registerNpcInit } from '../../core/state';
import type { CrewState, DeepReadonly, NpcState, NpcStatus, Pos, ReadonlyWorld, State } from '../../core/types';
import { registerEvents } from '../../core/undo';
import { isPresent } from '../npc/walk';
import { syncHands } from '../hands';
import { draggedBy } from '../place';
import { inReach, lacksActions, registerAction } from './act';

/*
 * Bodies (§8.10, §6.3): a knocked-out, dead or tied person can be dragged (1 action to take hold), dropped (1 action)
 * and stashed (1 action) in a closet or a dumpster. Stashed bodies are not evidence (rules/evidence.ts).
 *
 * - **Dragging** is a Very Heavy carry (`Loadout.carrying` 'body', data/items.ts `CARRY_WEIGHT`): the crew member's
 *   Move reaches half as far (a Bruiser's one tile less), they can't Dash (loot.ts, every carry alike), only a pistol is
 *   in hand, and they show as Armed (`CARRIED`). A body can be passed to a teammate in reach (loot.ts `pass`). Dragging is an illegal act (§8.4) for as long as it lasts: taking hold, every tile walked with it,
 *   every action ended with it and the stash are `!` for anyone who sees them, Core or Peripheral, in any zone
 *   (`CrewLook.act`, read by perception's `reaction`, so a move's preview and the hatched overlay judge it too).
 * - **Where the body is** while dragged is where its dragger stands (`bodyPos`): `NpcState.pos` keeps the tile it was
 *   lifted from and is set only when it is dropped, stashed or comes round (decision 27). So a crew member and their
 *   body are always placed together (an overlay asking about another tile moves just the crew member), and taking hold
 *   of a body or walking with it changes no NPC: unseen, it can be taken back (§6.6). Dropping and stashing put the
 *   body somewhere and are final. Draw a dragged NPC with its dragger; its own `pos` is stale.
 * - **Stashing** needs a stash in reach: an object of a `STASH_KINDS` kind (a dumpster, a closet) or a room the World
 *   tags as one (`World.stashRooms`: the cleaner's closet), standing anywhere in it. The body then lies in the stash:
 *   on the object's tile when it can be stood on, else where the crew member stood. `NpcState.stashed` names the
 *   stash; the scene should hide stashed NPCs as it hides those away.
 */

declare module '../../core/types' {
    interface CommandMap {
        /** Take hold of a body (knocked out, dead or tied) in reach, to drag it (1 action, an illegal act). */
        drag: { crew: string; npc: string };
        /** Let go of the body being dragged (or the hostage being led), where the crew member stands (1 action). */
        drop: { crew: string };
        /** Put the body being dragged in a stash: the object `at` in reach, or the stash room they stand in (1 action). */
        stash: { crew: string; at?: string };
    }
    interface CrewState {
        /** The NPC whose body they drag (§8.10), or the hostage they lead (`leading`, actions/hostage.ts), or null. */
        dragging: string | null;
        /** The one in hand is a hostage led by the arm, not a body (§10.6 escort). */
        leading: boolean;
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
    member.leading = false;
});

registerNpcInit('body', (_world, _person, npc) => {
    npc.stashed = null;
});

export { bodyPos, draggedBy, placeCrew } from '../place';

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
        syncHands(ctx.world, ctx.state, member);
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
        releaseBody(ctx.world, ctx.state, member);
        ctx.state.npcs.find(n => n.id === id)!.pos = { x: member.pos.x, y: member.pos.y };
        ctx.emit({ type: 'bodyDropped', crew: member.id, npc: id, at: { x: member.pos.x, y: member.pos.y } });
    }
});

registerAction('stash', {
    whyNot(world, state, cmd) {
        const member = state.crew.find(c => c.id === cmd.crew)!;
        const lack = lacksActions(member, 1);
        if (lack) return lack;
        if (member.dragging === null) return `${member.name} isn't dragging anyone`;
        // A hostage led along must be tied first: one only face down would get up in there (hostage.ts).
        if (state.npcs.find(n => n.id === member.dragging)?.status === 'commanded') return 'Only someone tied or out cold can be stashed';
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
        releaseBody(ctx.world, ctx.state, member);
        npc.stashed = stash.id;
        npc.pos = stash.pos ?? { x: member.pos.x, y: member.pos.y };
        ctx.emit({ type: 'bodyStashed', crew: member.id, npc: npc.id, stash: stash.id, at: { x: npc.pos.x, y: npc.pos.y } });
    }
});

/** Lets go of the body a crew member drags or the hostage they lead (it stays where it lies). */
export function releaseBody(world: ReadonlyWorld, state: State, member: CrewState): void {
    member.dragging = null;
    member.leading = false;
    syncHands(world, state, member);
}

/** The stash objects and rooms of a world, for the UI's hints. */
export function stashes(world: ReadonlyWorld): { objects: string[]; rooms: string[] } {
    return { objects: world.objects.filter(o => STASH_KINDS.has(o.kind)).map(o => o.id), rooms: [...(world.stashRooms ?? [])].sort() };
}

registerEvents({
    // Unseen, taking hold changes no NPC (its body is where its dragger is): it can be taken back.
    bodyLifted: { undoBlocking: false },
    bodyDropped: { undoBlocking: true },
    bodyStashed: { undoBlocking: true }
});
