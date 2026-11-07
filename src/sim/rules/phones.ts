import { registerWorldHook } from '../core/engine';
import { crewMember } from '../core/state';
import type { CrewState, DeepReadonly, Pos, ReadonlyWorld, State, WorldObject } from '../core/types';
import { registerRuleDefaults } from '../core/state';
import { registerEvents } from '../core/undo';
import { inReach, lacksActions, registerAction } from './actions/act';
import { registerInteraction } from './actions/interact';
import { HACKING_KIT } from './alarms';
import { phoneLineDead, registerCarrierCheck } from './carriers';
import { sendToLook } from './evidence';
import { decidesFor } from './npc/behaviour';
import { reconsider } from './npc/intent';
import { isPresent } from './npc/walk';

/*
 * The bank's telephones (§8.13, §9.1; implementation plan M5-04, decisions 360–362, 368).
 *
 * - **Desk phones** (`deskPhone` objects, from the generator's phones on the desks): each has an owner, the person
 *   whose post is at that desk (`WorldObject.owner`, `worldFromBank`), and the tile they answer it from
 *   (`answerAt`, their post). **Ringing** one (`ringPhone { crew, phone }`, 1 action) sends its owner to answer it, as
 *   a guard is sent to look at a spot (rules/evidence.ts `sendToLook`): they walk to their desk, the walk telegraphed in
 *   this crew phase, and go back to their routine once there (or after `rules.evidencePhases`). It is rung **from
 *   another desk phone** in reach (picking up a phone is Clean, no illegal act), or **remotely with a hacking kit**
 *   (the illegal act 'hack': the kit is out). Only a calm owner comes: one away, down, under the crew's control,
 *   alerted, panicking, or already dealing with something (evidence of any kind, a want about the crew) lets it ring,
 *   so a ring never wipes what an NPC is acting on (decision 368). A phone rings at most once every
 *   `rules.phoneRingPhases` (4) turns. A ring is always final (`phoneRang` blocks undo): whether a hidden owner came
 *   would otherwise show as whether the ring could be undone (decision 368).
 * - **The phone line** (`phoneLine`, the junction box in the alarm closet): **cut** (`interact … cut`, 1 action, 'hack'),
 *   the landlines are dead. A call on a landline (made by someone at their desk or window, `Carrier.line`) doesn't go
 *   out (`lineDead`), and one under way stops (`registerCarrierCheck('phoneLine')`); mobile calls carry on (the jammer
 *   is theirs). Dispatch notices the dead line after `rules.phoneLineNoticed` (15) world phases and sends a patrol car
 *   past, as for any lost contact (rules/checkins.ts), unless a drive-by it sent is still to come. A cut line stays cut.
 */

declare module '../core/types' {
    interface WorldObject {
        /** A desk phone: the person whose desk it is (§8.13), if anyone works there. */
        owner?: string;
        /** A desk phone: where its owner stands to answer it (their post). */
        answerAt?: Pos;
    }
    interface ObjectState {
        /** The phone line: the turn it was cut. */
        cutAt?: number;
        /** The phone line: dispatch has noticed it is dead. */
        lineNoticed?: boolean;
        /** A desk phone: the turn it was last rung. */
        rungAt?: number;
    }
    interface Rules {
        /** World phases until dispatch notices a cut phone line (§9.1: 15). */
        phoneLineNoticed: number;
        /** Turns before a desk phone can be rung again (decision 368). */
        phoneRingPhases: number;
    }
    interface CommandMap {
        /** Ring the desk phone `phone` (1 action): from another desk phone in reach, or anywhere with a hacking kit. */
        ringPhone: { crew: string; phone: string };
    }
    interface EventMap {
        /** A desk phone rang. Whoever comes to answer it shows by their walk. */
        phoneRang: { crew: string; phone: string; remote: boolean };
        /** The phone line was cut (§9.1). */
        phoneLineCut: { crew: string; object: string };
        /** A call on a landline didn't go out: the line is dead. */
        lineDead: { source: string };
        /** Dispatch noticed the dead line: a drive-by is coming (§9.1 "Dispatch: lost contact"). */
        deadLineNoticed: { driveBy: number };
    }
}

registerRuleDefaults({ phoneLineNoticed: 15, phoneRingPhases: 4 });

// ---------------------------------------------------------------------------------------------------------- Desk phones

/** The desk phones within reach of a tile. */
export const phonesInReach = (world: ReadonlyWorld, state: State, from: DeepReadonly<Pos>): DeepReadonly<WorldObject>[] =>
    world.objects.filter(o => o.kind === 'deskPhone' && inReach(world, state, from, o.pos));

/** Whether a crew member would ring it remotely (with the hacking kit) rather than from a phone in reach. */
const ringsRemotely = (world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, phone: string): boolean =>
    !phonesInReach(world, state, member.pos).some(o => o.id !== phone);

/** Why a crew member can't ring the desk phone now, or undefined. */
export function ringBlocked(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, phone: string): string | undefined {
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    const target = world.objects.find(o => o.id === phone);
    if (target?.kind !== 'deskPhone') return 'There is no desk phone there';
    if (phoneLineDead(world, state)) return 'The phone line is dead';
    const rung = Object.hasOwn(state.objects, phone) ? state.objects[phone]!.rungAt : undefined;
    if (rung !== undefined && state.turn - rung < world.rules.phoneRingPhases) return `It was rung lately: again from turn ${rung + world.rules.phoneRingPhases}`;
    if (ringsRemotely(world, state, member, phone) && !member.loadout.items.includes(HACKING_KIT)) return `${member.name} needs another desk phone in reach, or a hacking kit`;
    return undefined;
}

registerAction('ringPhone', {
    whyNot: (world, state, cmd) => ringBlocked(world, state, crewMember(state, cmd.crew), cmd.phone),
    candidates: (world, _state, member) => world.objects.filter(o => o.kind === 'deskPhone').map(o => ({ type: 'ringPhone' as const, crew: member.id, phone: o.id })),
    cost: () => 1,
    illegal: (world, state, cmd) => (ringsRemotely(world, state, crewMember(state, cmd.crew), cmd.phone) ? { act: 'hack' } : undefined),
    run(ctx, member, cmd) {
        const { world, state } = ctx, phone = world.objects.find(o => o.id === cmd.phone)!;
        ctx.emit({ type: 'phoneRang', crew: member.id, phone: phone.id, remote: ringsRemotely(world, state, member, phone.id) });
        state.objects[phone.id] = { ...state.objects[phone.id], rungAt: state.turn };
        const owner = phone.owner !== undefined ? state.npcs.find(n => n.id === phone.owner) : undefined;
        if (!owner || !phone.answerAt || !isPresent(owner) || !decidesFor(owner) || owner.alerted || owner.panic !== null) return;
        // Busy: it keeps to what it is dealing with.
        if (owner.status !== 'calm' || owner.evidence !== null || owner.wants.length || owner.search) return;
        // Each ring is its own errand: the owner walks to the desk and goes back once there.
        sendToLook(ctx, owner, `phone:${phone.id}:${state.turn}`, phone.answerAt);
        reconsider(ctx);
    }
});

// ---------------------------------------------------------------------------------------------------------- The line

registerInteraction('phoneLine', {
    cut: {
        cost: () => 1,
        illegal: 'hack',
        whyNot: (world, state) => (phoneLineDead(world, state) ? 'The line is cut already' : undefined),
        run(ctx, member, object) {
            ctx.state.objects[object.id] = { ...ctx.state.objects[object.id], cutAt: ctx.state.turn };
            ctx.emit({ type: 'phoneLineCut', crew: member.id, object: object.id });
        }
    }
});

// A dead line stops a landline call under way (§9.1's counter).
registerCarrierCheck('phoneLine', (world, state, carrier) =>
    (carrier.kind === 'phoneCall' && carrier.line === 'landline' && phoneLineDead(world, state) ? { halt: 'countered', why: 'phone line cut' } : null));

/** The turn the bank's phone line was cut, or null. */
export function lineCutAt(world: ReadonlyWorld, state: DeepReadonly<State>): number | null {
    const line = world.objects.find(o => o.kind === 'phoneLine');
    const cut = line && Object.hasOwn(state.objects, line.id) ? state.objects[line.id]!.cutAt : undefined;
    return cut ?? null;
}

// Dispatch notices the dead line (§9.1): after `phoneLineNoticed` world phases, a drive-by as for any lost contact.
// Once, unless a drive-by dispatch sent is still to come (that car looks anyway).
registerWorldHook('devices', 'phones.deadLine', (ctx, phase) => {
    const { world, state } = ctx;
    const cut = lineCutAt(world, state), line = world.objects.find(o => o.kind === 'phoneLine');
    if (cut === null || !line || state.objects[line.id]?.lineNoticed || state.bank.alarm) return;
    if (phase.turn - cut + 1 < world.rules.phoneLineNoticed) return;
    state.objects[line.id] = { ...state.objects[line.id], lineNoticed: true };
    const due = state.radio.driveBy !== null && state.radio.driveBy > phase.turn;
    if (!due) state.radio.driveBy = phase.turn + world.rules.driveByLead;
    ctx.emit({ type: 'deadLineNoticed', driveBy: state.radio.driveBy! });
}, { order: 7 });

registerEvents({
    // Final whatever came of it, so undo tells nothing about an owner the crew doesn't know (decision 368).
    phoneRang: { undoBlocking: true },
    // Nobody sees a cut line until dispatch's count runs out: undoable, as cutting the vault's sensors is.
    phoneLineCut: { undoBlocking: false },
    lineDead: { undoBlocking: true },
    deadLineNoticed: { undoBlocking: true }
});
