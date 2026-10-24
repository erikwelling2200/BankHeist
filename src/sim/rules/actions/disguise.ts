import { tileAt } from '../../core/grid';
import { crewMember, registerNpcInit } from '../../core/state';
import type { CrewState, DeepReadonly, ReadonlyWorld, State } from '../../core/types';
import { registerEvents } from '../../core/undo';
import type { Uniform } from '../../data/matrix';
import { isPresent, personOf } from '../npc/walk';
import { draggedBy } from '../place';
import { markerKind, withDoubtedShut } from '../knowledge';
import { inReach, lacksActions, registerAction, witnessOn } from './act';
import { handsFree } from './loot';

/*
 * Disguises (§8.14): changing into a uniform. What a uniform does to how the crew is read is the matrix's
 * (data/matrix.ts `UNIFORMS`, rules/perceive.ts `reaction`) and the profile's (rules/profile.ts: it holds only over
 * Concealed or less; a guard's holsters a pistol as Clean); this module is where uniforms come from.
 *
 * - **Change clothes** (`changeClothes { crew, from }`): 2 actions, hands free, `from` in reach:
 *   - a guard (an enforcer; a courier gives the courier's uniform) knocked out or tied, not stripped yet: the guard's
 *     uniform, and the guard is left stripped (`NpcState.stripped`). A stripped guard is still a body or a tied person,
 *     major evidence as before, until stashed (§8.10);
 *   - staff lockers (`lockers` in the Staff zone: the break room, where uniforms hang): a staff uniform.
 *   The staff uniform also comes with the Staff uniforms asset (`CrewStart.uniform`). The courier van's uniforms are the
 *   finale's (§19.5).
 * - **Out of every NPC's sight** (§8.14): it is refused while an NPC the crew sees now would see it (`seenChanging`), and
 *   it is the illegal act 'changeClothes', `!` for anyone else who sees it, Core or Peripheral: an NPC the crew can't see
 *   (refusing for one would tell the player who unseen is watching) or a camera (implementation plan §6 decision 61). A
 *   disguise prevents exposure; it never undoes it (§8.7).
 */

declare module '../../core/types' {
    interface NpcState {
        /** Their uniform was taken (§8.14). */
        stripped: boolean;
    }
    interface CommandMap {
        /** Change into the uniform of the downed guard or from the staff lockers `from` in reach (2 actions). */
        changeClothes: { crew: string; from: string };
    }
    interface EventMap {
        changedClothes: { crew: string; uniform: Uniform; from: string };
        /** A downed guard's uniform was taken (§8.14). */
        guardStripped: { crew: string; npc: string };
    }
}

/** Actions it takes to change into a uniform (§8.14). */
const CHANGE_ACTIONS = 2;

/** Object kinds that hold staff uniforms (in the Staff zone). */
const UNIFORM_KINDS: ReadonlySet<string> = new Set(['lockers']);

registerNpcInit('disguise', (_world, _person, npc) => {
    npc.stripped = false;
});

/** The uniform `from` gives a crew member there, or why it gives none. */
function uniformFrom(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, from: string): Uniform | string {
    const npc = state.npcs.find(n => n.id === from);
    if (npc) {
        const person = personOf(world, npc.id);
        if (person.observer !== 'enforcer') return 'Only a guard\'s uniform is worth taking';
        if (!isPresent(npc) || npc.stashed !== null) return 'They aren\'t here';
        if (npc.status !== 'unconscious' && npc.status !== 'tied') return 'Only a guard knocked out or tied can be stripped';
        if (npc.stripped) return 'Their uniform is gone already';
        if (draggedBy(state, npc.id)) return 'Someone has hold of them';
        if (!inReach(world, state, member.pos, npc.pos)) return `${member.name} can't reach them from here`;
        return person.role === 'courier' ? 'courier' : 'guard';
    }
    const object = world.objects.find(o => o.id === from);
    if (!object || !UNIFORM_KINDS.has(object.kind) || tileAt(world, object.pos)?.zone !== 'staff') return 'There are no uniforms there';
    return inReach(world, state, member.pos, object.pos) ? 'staff' : `${member.name} can't reach the ${object.kind}`;
}

function changeBlocked(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, from: string): string | undefined {
    const lack = lacksActions(member, CHANGE_ACTIONS);
    if (lack) return lack;
    if (!handsFree(member)) return `${member.name}'s hands are full`;
    const uniform = uniformFrom(world, state, member, from);
    if (uniform !== 'staff' && uniform !== 'guard' && uniform !== 'courier') return uniform;
    if (member.loadout.uniform === uniform) return `${member.name} wears that uniform already`;
    const watcher = seenChanging(world, state, member);
    return watcher ? `${personOf(world, watcher).name} would see ${member.name} change` : undefined;
}

/**
 * An NPC the crew sees now (live, §8.15) who would see the change where the crew member stands (Core or Peripheral,
 * through the doors the crew can vouch for, those it can't taken as shut), or undefined: §8.14's "out of every NPC's
 * sight", judged on what the crew can know (decision 61). Anyone else who sees it witnesses it.
 */
function seenChanging(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>): string | undefined {
    const live = new Set(state.npcs.filter(n => markerKind(world, state, n.id) === 'live').map(n => n.id));
    if (!live.size) return undefined;
    return witnessOn(world, withDoubtedShut(world, state), member.id, 'changeClothes', [member.pos])
        .find(s => s.by === 'npc' && live.has(s.observer))?.observer;
}

registerAction('changeClothes', {
    whyNot: (world, state, cmd) => changeBlocked(world, state, crewMember(state, cmd.crew), cmd.from),
    candidates: (world, state, member) => [
        ...state.npcs.filter(n => personOf(world, n.id).observer === 'enforcer' && !n.stripped).map(n => n.id),
        ...world.objects.filter(o => UNIFORM_KINDS.has(o.kind)).map(o => o.id)
    ].map(from => ({ type: 'changeClothes' as const, crew: member.id, from })),
    cost: () => CHANGE_ACTIONS,
    illegal: () => ({ act: 'changeClothes' }),
    run(ctx, member, cmd) {
        const uniform = uniformFrom(ctx.world, ctx.state, member, cmd.from) as Uniform;
        member.loadout.uniform = uniform;
        ctx.emit({ type: 'changedClothes', crew: member.id, uniform, from: cmd.from });
        const npc = ctx.state.npcs.find(n => n.id === cmd.from);
        if (!npc) return;
        npc.stripped = true;
        ctx.emit({ type: 'guardStripped', crew: member.id, npc: npc.id });
    }
});

registerEvents({
    // Unseen, putting on a staff uniform from the lockers changes only the crew member: it can be taken back.
    changedClothes: { undoBlocking: false },
    // Stripping a guard changes him (`stripped`): final.
    guardStripped: { undoBlocking: true }
});
