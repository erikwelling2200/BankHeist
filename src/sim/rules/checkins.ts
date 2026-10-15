import { registerWorldHook, type Ctx } from '../core/engine';
import { tileAt } from '../core/grid';
import { sortedIds } from '../core/json';
import { crewMember, registerRuleDefaults, registerStateInit } from '../core/state';
import type { DeepReadonly, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { bandAt, fieldOn, profilesOf } from '../geo/cones';
import { sightMap } from '../geo/los';
import { inRing, makeNoise, registerNoiseHook } from '../geo/sound';
import { inReach, lacksActions, registerAction } from './actions/act';
import { hasTrait, jammed } from './alarms';
import { nearestFreeGuard } from './cameras';
import { raiseCarrier, stopCarrier } from './carriers';
import { guardIds, neutralised, operatorGone, operatorIds } from './cctv';
import { evidenceOnMap, isMajor, sendToLook } from './evidence';
import { activityAt } from './npc/schedule';
import { isPresent } from './npc/walk';
import { reaction } from './perceive';
import { bodyPos } from './place';
import { crewLook } from './profile';

/*
 * Radio check-ins (§8.11), dispatch and the patrol drive-by (§16.3, §16.4, §9.1). All in the devices step.
 *
 * - **Calls.** The operator calls each guard every `rules.checkInPeriod` (6) world phases, staggered: guard i of n (by
 *   id) first on turn period + ⌊i × period ÷ n⌋. A bank without an operator has its guards check in with dispatch
 *   every `rules.dispatchCheckInPeriod` (8), by the same rules. The next call shows on the guard's tag
 *   (`State.radio.calls[guard].next`). An operator away from the map (a smoke break) calls once he is back; a
 *   neutralised one calls nobody any more. A guard inside a jammer's range can't be reached: the call is tried again
 *   the next phase.
 * - **A guard who is up answers.** One who is down (out cold, dead, tied, commanded, stashed or dragged) doesn't: his
 *   radio **buzzes**, a quiet noise of radius 3 on the body, and keeps ringing through the next crew phase, when a
 *   crew member in reach of the body can **answer** (`answerRadio`, 1 action; `rules.radioAnswers` (2) per heist,
 *   +1 per Smooth Talker in the crew). A guard back on his feet by then answers it himself.
 * - **Unanswered** at the next world phase: missed. The first miss sends the nearest free guard to the missing guard's
 *   post (`sendToLook`, an investigation); the second makes the operator (or dispatch) call it in: the missed check-in
 *   carrier (2), whose counters are neutralising the operator, answering the radio now (the same action) and a jammer.
 * - **Dispatch** notices silence (§8.11, §9.1 "Dispatch: lost contact"): an operator neutralised, or a jammer running,
 *   for `rules.dispatchSilence` (10) world phases in a row. It sends a patrol car past `rules.driveByLead` (2) phases
 *   later, announced (the crew's police scanner, §8.15).
 * - **The patrol drive-by** (§16.3): at the timeline's drive-by turns and when dispatch sends one, a police car drives
 *   the street lane (`World.patrol`) in the world phase. Its two officers look out of both sides of the car at every
 *   other tile of the lane (the calm NPC profile, through windows and open doors, darkness halving it), reading the
 *   crew as cameras do (only `!` counts: masks, guns, an illegal act, a body dragged). A `!`, major evidence in view, or
 *   a loud noise that reached the street this turn starts the patrol car carrier (2) where they saw it. Taking the
 *   officers down is M3's; a jammer pauses it.
 */

/** One guard's check-in calls. */
export interface CheckIn {
    /** The turn of the next call (its world phase). */
    next: number;
    /** Calls missed so far this heist. */
    missed: number;
    /** The turn of a call ringing unanswered on a downed guard's radio, or null. */
    ringing: number | null;
}

/** The radio and dispatch's side of the heist. */
export interface Radio {
    /** Each guard's calls, by guard id. */
    calls: Record<string, CheckIn>;
    /** Calls the crew answered this heist. */
    answers: number;
    /** The turn of the first silent world phase in the current run of them, or null. */
    silentSince: number | null;
    /** The turn of the drive-by dispatch sent, once it has. */
    driveBy: number | null;
    /** The turn a loud noise reached the street while a drive-by was due, or null. */
    heard: number | null;
}

/** The street the patrol car drives (§16.3, §16.4): the lane's tiles in order, and the timeline's drive-by turns. */
export interface PatrolRoute { lane: Pos[]; turns: number[] }

declare module '../core/types' {
    interface World {
        /** The patrol car's lane and its scheduled drive-bys. Absent: no street, no drive-by. */
        patrol?: PatrolRoute;
    }
    interface State {
        radio: Radio;
    }
    interface Rules {
        /** World phases between an operator's calls to a guard (§8.11). */
        checkInPeriod: number;
        /** World phases between a guard's check-ins with dispatch, in a bank without an operator (§8.11). */
        dispatchCheckInPeriod: number;
        /** Calls the crew can answer in a heist (§8.11), before Smooth Talkers. */
        radioAnswers: number;
        /** Silent world phases before dispatch sends a car (§8.11, §9.1). */
        dispatchSilence: number;
        /** World phases from dispatch noticing to the car driving past. */
        driveByLead: number;
    }
    interface CommandMap {
        /** Answers a downed guard's radio (§8.11): 1 action, in reach of the body. */
        answerRadio: { crew: string; npc: string };
    }
    interface EventMap {
        /** A guard answered his check-in call. */
        checkIn: { guard: string; by: string };
        /** A downed guard's radio rings: a quiet noise (§8.11). */
        checkInRinging: { guard: string };
        /** A crew member answered a downed guard's radio. */
        radioAnswered: { crew: string; guard: string };
        checkInMissed: { guard: string; missed: number };
        /** Someone was sent to look at the missing guard's post. */
        checkInSearch: { guard: string; sent: string };
        /** Dispatch noticed the silence (§9.1) and sends a car past on turn `driveBy`. */
        dispatchLostContact: { driveBy: number };
        /** The patrol car drove past (§16.3); `saw` names what made it call in, if anything. */
        patrolPassed: { saw: string | null };
    }
}

registerRuleDefaults({ checkInPeriod: 6, dispatchCheckInPeriod: 8, radioAnswers: 2, dispatchSilence: 10, driveByLead: 2 });

/** Whether the bank's check-ins go to an operator (§8.11) rather than to dispatch. */
const hasOperator = (world: ReadonlyWorld): boolean => operatorIds(world).length > 0;

/** World phases between one guard's calls. */
export const checkInPeriod = (world: ReadonlyWorld): number => (hasOperator(world) ? world.rules.checkInPeriod : world.rules.dispatchCheckInPeriod);

registerStateInit('radio', (world, state) => {
    const guards = guardIds(world), period = checkInPeriod(world), calls: Record<string, CheckIn> = {};
    guards.forEach((id, i) => { calls[id] = { next: period + Math.floor((i * period) / guards.length), missed: 0, ringing: null }; });
    state.radio = { calls, answers: 0, silentSince: null, driveBy: null, heard: null };
});

/** Calls the crew may still answer this heist (§8.11): 2, +1 per Smooth Talker. */
export function answersLeft(world: ReadonlyWorld, state: DeepReadonly<State>): number {
    const allowed = world.rules.radioAnswers + state.crew.filter(c => hasTrait(c, 'smoothTalker')).length;
    return Math.max(0, allowed - state.radio.answers);
}

/** Whether a guard would answer a call now: on the map or away, but not down. */
const answers = (state: DeepReadonly<State>, id: string): boolean => {
    const npc = state.npcs.find(n => n.id === id);
    return !!npc && !neutralised(state, npc) && npc.status !== 'unconscious';
};

/** The missed check-in carrier running about a guard, if any. */
const missedCarrier = (state: State, guard: string) => state.carriers.find(c => c.kind === 'missedCheckIn' && c.subject === guard);

/** Where a guard should be: his schedule's spot now, else where his body is. */
function postOf(world: ReadonlyWorld, state: State, guard: string, turn: number): Pos {
    const at = activityAt(world, guard, turn)?.block.at;
    const npc = state.npcs.find(n => n.id === guard)!;
    return at ? { x: at.x, y: at.y } : bodyPos(state, npc);
}

function missed(ctx: Ctx, guard: string, call: CheckIn, turn: number): void {
    const { world, state } = ctx;
    call.missed++;
    ctx.emit({ type: 'checkInMissed', guard, missed: call.missed });
    if (call.missed === 1) {
        const post = postOf(world, state, guard, turn), sent = nearestFreeGuard(world, state, post, guard);
        if (!sent) return;
        ctx.emit({ type: 'checkInSearch', guard, sent: sent.id });
        sendToLook(ctx, sent, `checkin:${guard}:${turn}`, post);
        return;
    }
    const op = operatorIds(world).map(id => state.npcs.find(n => n.id === id)!).find(n => !neutralised(state, n));
    const body = bodyPos(state, state.npcs.find(n => n.id === guard)!);
    raiseCarrier(ctx, { kind: 'missedCheckIn', source: op ? op.id : 'dispatch', pos: op ? op.pos : body, subject: guard });
}

registerWorldHook('devices', 'radio.checkIns', (ctx, phase) => {
    const { world, state } = ctx;
    const turn = phase.turn, period = checkInPeriod(world), radio = state.radio;
    const ops = operatorIds(world).map(id => state.npcs.find(n => n.id === id)!);
    const gone = operatorGone(world, state);
    // An operator off the map (a break) calls once he is back; a neutralised one calls nobody.
    const caller = !ops.length ? 'dispatch' : ops.find(n => !neutralised(state, n) && isPresent(n))?.id ?? null;
    for (const guard of sortedIds(radio.calls)) {
        const call = radio.calls[guard]!;
        if (call.ringing !== null && call.ringing < turn) {
            call.ringing = null;
            if (answers(state, guard)) ctx.emit({ type: 'checkIn', guard, by: guard });
            else missed(ctx, guard, call, turn);
        }
        if (gone || caller === null || turn < call.next) continue;
        const npc = state.npcs.find(n => n.id === guard)!;
        if (jammed(world, state, bodyPos(state, npc))) {
            call.next = turn + 1;
            continue;
        }
        call.next = turn + period;
        if (answers(state, guard)) {
            ctx.emit({ type: 'checkIn', guard, by: guard });
            continue;
        }
        call.ringing = turn;
        ctx.emit({ type: 'checkInRinging', guard });
        makeNoise(ctx, 'radioBuzz', bodyPos(state, npc), `radio ${guard}`, 3);
    }
    // Dispatch and the silence (§9.1): the operator gone, or a jammer running.
    const silent = gone || state.jammers.length > 0;
    if (!silent) radio.silentSince = null;
    else {
        radio.silentSince ??= turn;
        if (radio.driveBy === null && turn - radio.silentSince + 1 >= world.rules.dispatchSilence) {
            radio.driveBy = turn + world.rules.driveByLead;
            ctx.emit({ type: 'dispatchLostContact', driveBy: radio.driveBy });
        }
    }
}, { order: 5 });

registerAction('answerRadio', {
    whyNot(world, state, cmd) {
        const member = crewMember(state, cmd.crew);
        const lack = lacksActions(member, 1);
        if (lack) return lack;
        const call = Object.hasOwn(state.radio.calls, cmd.npc) ? state.radio.calls[cmd.npc]! : undefined;
        if (!call || (call.ringing === null && !missedCarrier(state, cmd.npc))) return 'Nobody is calling that radio';
        if (!answersLeft(world, state)) return 'The operator won\'t buy another answer';
        const npc = state.npcs.find(n => n.id === cmd.npc)!;
        if (!inReach(world, state, member.pos, bodyPos(state, npc))) return `${member.name} can't reach the radio`;
        return undefined;
    },
    candidates: (_world, state, member) => sortedIds(state.radio.calls).map(npc => ({ type: 'answerRadio', crew: member.id, npc })),
    cost: () => 1,
    run(ctx, member, cmd) {
        const { state } = ctx;
        state.radio.answers++;
        const call = state.radio.calls[cmd.npc]!;
        ctx.emit({ type: 'radioAnswered', crew: member.id, guard: cmd.npc });
        if (call.ringing !== null) call.ringing = null;
        else stopCarrier(ctx, missedCarrier(state, cmd.npc)!, 'answered');
    }
});

// ---------------------------------------------------------------------------------------------------------- Patrol

/** Whether the patrol car drives past in the world phase of `turn`. */
export function driveByDue(world: ReadonlyWorld, state: DeepReadonly<State>, turn: number): boolean {
    return !!world.patrol?.lane.length && (world.patrol.turns.includes(turn) || state.radio.driveBy === turn);
}

/** The next drive-by from `turn` on (the HUD's "Patrol drive-by in N"), or null. */
export function nextDriveBy(world: ReadonlyWorld, state: DeepReadonly<State>, turn: number = state.turn): number | null {
    if (!world.patrol?.lane.length) return null;
    const turns = [...world.patrol.turns, ...(state.radio.driveBy !== null ? [state.radio.driveBy] : [])].filter(t => t >= turn).sort((a, b) => a - b);
    return turns[0] ?? null;
}

/** What the patrol's officers see as they drive past (see the header), the first thing on their way, or null. */
export function patrolSightings(world: ReadonlyWorld, state: State): { pos: Pos; crew?: string; evidence?: string } | null {
    const lane = world.patrol?.lane ?? [];
    if (!lane.length) return null;
    const sight = sightMap(world, state), calm = profilesOf(world).calm;
    const major = evidenceOnMap(world, state).filter(e => isMajor(e.kind));
    for (let i = 0; i < lane.length; i += 2) {
        const pos = lane[i]!;
        for (const facing of ['n', 's'] as const) {
            const field = fieldOn(sight, { pos, facing, profile: calm });
            for (const member of state.crew) {
                const band = bandAt(field, member.pos), tile = tileAt(world, member.pos);
                if (!band || !tile) continue;
                const seen = reaction(world.rules, {
                    look: crewLook(member), notoriety: member.notoriety, observer: 'enforcer', role: 'police', camera: true, alerted: false, band,
                    zone: tile.zone, chebyshev: Math.max(Math.abs(member.pos.x - pos.x), Math.abs(member.pos.y - pos.y)), warnedByThis: false, warnedByAny: false
                });
                if (seen.outcome === '!') return { pos: { x: pos.x, y: pos.y }, crew: member.id };
            }
            for (const e of major) if (e.tiles.some(p => bandAt(field, p) !== null)) return { pos: { x: pos.x, y: pos.y }, evidence: e.id };
        }
    }
    return null;
}

// A loud noise reaching the street while the car is due this turn: the officers hear it.
registerNoiseHook('patrol', (ctx, ring, kind) => {
    const { world, state } = ctx;
    if (kind !== 'loud' || !driveByDue(world, state, state.turn)) return;
    if (world.patrol!.lane.some(p => inRing(ring, p))) state.radio.heard = state.turn;
});

registerWorldHook('devices', 'patrol.pass', (ctx, phase) => {
    const { world, state } = ctx;
    if (!driveByDue(world, state, phase.turn)) return;
    const seen = patrolSightings(world, state);
    const heard = state.radio.heard === phase.turn;
    const saw = seen?.crew ?? seen?.evidence ?? (heard ? 'noise' : null);
    ctx.emit({ type: 'patrolPassed', saw });
    if (saw === null) return;
    const pos = seen?.pos ?? world.patrol!.lane[Math.floor(world.patrol!.lane.length / 2)]!;
    raiseCarrier(ctx, { kind: 'patrolCar', source: 'patrol', pos, ...(seen?.crew ? { about: seen.crew } : {}) });
}, { order: 6 });

registerEvents({
    checkIn: { undoBlocking: true },
    checkInRinging: { undoBlocking: true },
    radioAnswered: { undoBlocking: false },
    checkInMissed: { undoBlocking: true },
    checkInSearch: { undoBlocking: true },
    dispatchLostContact: { undoBlocking: true },
    patrolPassed: { undoBlocking: true }
});
