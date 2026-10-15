import { registerWorldHook, type Ctx } from '../core/engine';
import { samePos } from '../core/grid';
import { crewMember, newId, registerCrewInit, registerRuleDefaults, registerStateInit } from '../core/state';
import type { CrewState, DeepReadonly, NpcState, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { bandAt, fieldOn, npcObserver } from '../geo/cones';
import { sightMap } from '../geo/los';
import { makeNoise } from '../geo/sound';
import { lacksActions, registerAction } from './actions/act';
import { registerInteraction } from './actions/interact';
import { CARRIERS, panelDead, raiseCarrier, registerCarrierCheck } from './carriers';
import { clearEvidence } from './evidence';
import { intentEnd, isPresent } from './npc/walk';
import { isEyesDown } from './suspicion';

/*
 * Raising the alarm (§9.1, §16.2) and what the crew can do about it before it starts: the alarm panel and the jammer.
 *
 * - **Carrying out** the NPCs' alarm intents (`raiseAlarm`, committed at their station by rules/npc/behaviour.ts, and
 *   `reportEvidence`, rules/evidence.ts): from the intents frozen at the start of the world phase (§6.2), after the
 *   passive walks (`alarms.raise`, passiveNpcs order 5), by an NPC still up and standing where its walk was to end.
 *   It starts the carrier (`raiseCarrier`: the teller's or manager's button, the operator's panel, a guard's radio, a
 *   phone call) and the NPC has done its part: the crew member goes into `NpcState.reported` (it only watches them
 *   now), the evidence is cleared (`clearEvidence`). A button pressed while the panel is dead does nothing
 *   (`alarmDead`), but the NPC believes it did.
 * - **"Hands up!"** (§16.2 confront): a guard raising the alarm about a crew member he can see draws and shouts (loud
 *   noise, radius 6: the bank is Loud) and orders them to surrender; the radio carrier (2: draws and takes cover, then
 *   calls) starts with it, so the crew has the next crew phase to respond and another after the call goes out. Firing
 *   is combat's (M3); he isn't Hostile yet, so he can still be knocked out.
 * - **The alarm panel** (§9.1, Secure zone): interact `disable` with a hacking kit, 1 action at a time, the work kept on
 *   the panel (`ObjectState.progress`, in plain actions' worth of work) so it can be spread across turns and crew
 *   members: `rules.panelActions` (4) actions, half with Steady Hands (at least 1; each of their actions does two
 *   actions' worth; `CrewState.traits`). Panel work is a quiet noise of radius 1 (§8.9) and the illegal act
 *   'hack' (§8.4). Once dead, every wired carrier dies, those running too (`registerCarrierCheck('panel')`), and no
 *   button starts one. The panel has its own battery (§14.6): cutting the power doesn't touch it.
 * - **The jammer** (§12.2): `placeJammer` (1 action, the jammer item) leaves it running on the crew member's tile.
 *   Every radio or phone carrier (`CARRIERS[kind].radio`) within `rules.jammerRadius` (8, Euclidean) of where it is
 *   drawn is paused while it runs; dispatch notices the lost contact after 10 phases (checkins.ts).
 * - **The escapee** (§9.1, §16.4) is M2's (panic): `startEscapee` is its starter, countdown max(2, ⌈path ÷ 8⌉).
 */

/** Crew traits (§7.2), as data (their effects live with the rules they change): unknown names are refused at the start. */
export const TRAITS = [
    'steadyHands', 'smoothTalker', 'intimidating', 'bruiser', 'marksman', 'sapper', 'wheelman', 'medic', 'forgettable', 'coolHead'
] as const;
export type Trait = (typeof TRAITS)[number];

/** A jammer left running (§12.2). */
export interface Jammer { id: string; pos: Pos; crew: string; turn: number }

declare module '../core/types' {
    interface CrewState {
        /** The crew member's traits (§7.2): one per recruit, more with experience. */
        traits: string[];
    }
    interface ObjectState {
        /** Actions of work done on it so far (the alarm panel: 4 to disable it). */
        progress?: number;
    }
    interface State {
        /** Jammers running (§12.2). */
        jammers: Jammer[];
    }
    interface Rules {
        /** Actions of hacking that disable the alarm panel (§9.1); Steady Hands halves them. */
        panelActions: number;
        /** A jammer's radius (§12.2), Euclidean in tiles. */
        jammerRadius: number;
    }
    interface CommandMap {
        /** Leaves a jammer running on the crew member's tile (§12.2): 1 action. */
        placeJammer: { crew: string };
    }
    interface EventMap {
        /** An NPC raised the alarm (pressed a button, radioed, phoned): its carrier, unless the panel was dead. */
        alarmAttempt: { npc: string; carrier: CarrierKind; crew: string | null; evidence: string | null };
        /** "Hands up!" (§16.2): a guard drew and shouted at a crew member. */
        confronted: { npc: string; crew: string };
        /** A crew member worked on a panel: `progress` of `needed` actions. */
        panelWorked: { crew: string; object: string; progress: number; needed: number };
        /** The alarm panel is dead (§9.1): every wired carrier with it. */
        panelDisabled: { crew: string; object: string };
        jammerPlaced: { crew: string; jammer: string; pos: Pos };
    }
}

declare module '../core/state' {
    interface CrewStart {
        traits?: string[];
    }
}

registerRuleDefaults({ panelActions: 4, jammerRadius: 8 });

registerCrewInit('traits', (_world, start, member) => {
    for (const t of start.traits ?? []) if (!(TRAITS as readonly string[]).includes(t)) throw new Error(`No trait '${t}'`);
    member.traits = [...(start.traits ?? [])];
});

registerStateInit('jammers', (_world, state) => {
    state.jammers = [];
});

export const hasTrait = (member: DeepReadonly<CrewState>, trait: Trait): boolean => member.traits.includes(trait);

/** Actions of work a crew member needs for a job of `actions` (Steady Hands: half, at least 1, §7.2). */
export const workActions = (member: DeepReadonly<CrewState>, actions: number): number =>
    (hasTrait(member, 'steadyHands') ? Math.max(1, Math.ceil(actions / 2)) : actions);

export const HACKING_KIT = 'hackingKit';
export const JAMMER = 'jammer';

const carries = (member: DeepReadonly<CrewState>, item: string): boolean => member.loadout.items.includes(item);

// ---------------------------------------------------------------------------------------------------------- Raising

/** Whether a guard sees a crew member where they stand now. */
function guardSees(world: ReadonlyWorld, state: State, npc: DeepReadonly<NpcState>, crew: string): boolean {
    const member = state.crew.find(c => c.id === crew), eye = npcObserver(world, npc);
    return !!member && !!eye && bandAt(fieldOn(sightMap(world, state), eye), member.pos) !== null;
}

registerWorldHook('passiveNpcs', 'alarms.raise', (ctx, phase) => {
    const { world, state } = ctx;
    for (const id of phase.passive) {
        const intent = phase.intents[id], action = intent?.action;
        if (!intent || !action || (action.kind !== 'raiseAlarm' && action.kind !== 'reportEvidence')) continue;
        const npc = state.npcs.find(n => n.id === id);
        // Down since, or stopped short of where it meant to press the button.
        if (!npc || isEyesDown(npc) || !isPresent(npc) || npc.outCold !== null) continue;
        if (intent.path.length && !samePos(npc.pos, intentEnd(npc, intent))) continue;
        const crew = action.kind === 'raiseAlarm' ? action.crew : null;
        ctx.emit({ type: 'alarmAttempt', npc: npc.id, carrier: action.carrier, crew, evidence: action.kind === 'reportEvidence' ? action.evidence : null });
        if (crew !== null && action.carrier === 'guardRadio' && guardSees(world, state, npc, crew)) confront(ctx, npc, crew);
        raiseCarrier(ctx, { kind: action.carrier, source: npc.id, pos: npc.pos, ...(crew !== null ? { about: crew } : {}) });
        if (crew !== null) {
            if (!npc.reported.includes(crew)) npc.reported.push(crew);
        } else if (action.kind === 'reportEvidence' && npc.evidence?.id === action.evidence) {
            clearEvidence(ctx, npc);
        }
    }
}, { order: 5 });

/** "Hands up!" (see the header). */
function confront(ctx: Ctx, npc: NpcState, crew: string): void {
    ctx.emit({ type: 'confronted', npc: npc.id, crew });
    makeNoise(ctx, 'guardShout', npc.pos, `hands up ${npc.id}`);
    if (!ctx.state.bank.loud) {
        ctx.state.bank.loud = true;
        ctx.emit({ type: 'wentLoud', cause: `shout ${npc.id}` });
    }
}

/**
 * The escapee (§9.1): an NPC fleeing toward the plot edge along a path of `pathLength` tiles, at a run (8 a phase,
 * implementation plan decision 4). M2's panic calls it.
 */
export function startEscapee(ctx: Ctx, npc: DeepReadonly<NpcState>, pathLength: number): void {
    raiseCarrier(ctx, { kind: 'escapee', source: npc.id, pos: npc.pos, countdown: Math.ceil(pathLength / 8) });
}

// ---------------------------------------------------------------------------------------------------------- The panel

/** Why the crew member can't work on this panel now, or undefined. */
function panelBlocked(state: DeepReadonly<State>, member: DeepReadonly<CrewState>, objectId: string): string | undefined {
    if (!carries(member, HACKING_KIT)) return `${member.name} has no hacking kit`;
    if (Object.hasOwn(state.objects, objectId) && state.objects[objectId]!.disabled) return 'The alarm panel is dead already';
    return undefined;
}

registerInteraction('alarmPanel', {
    disable: {
        cost: () => 1,
        illegal: 'hack',
        whyNot: (_world, state, member, object) => panelBlocked(state, member, object.id),
        run(ctx, member, object) {
            const { state, world } = ctx;
            const now = state.objects[object.id] ?? (state.objects[object.id] = {});
            const needed = world.rules.panelActions;
            now.progress = Math.min(needed, (now.progress ?? 0) + workStep(member, needed));
            ctx.emit({ type: 'panelWorked', crew: member.id, object: object.id, progress: now.progress, needed });
            makeNoise(ctx, 'panelWork', member.pos, `panel ${member.id}`);
            if (now.progress >= needed) {
                now.disabled = true;
                ctx.emit({ type: 'panelDisabled', crew: member.id, object: object.id });
            }
        }
    }
});

/** The work one action does on a job of `actions` (§7.2 Steady Hands: two actions' worth, so half the actions). */
const workStep = (member: DeepReadonly<CrewState>, actions: number): number => Math.ceil(actions / workActions(member, actions));

/** Actions a crew member still needs on a panel (the HUD's "Disable panel: 2 more actions"); 0 once it is dead. */
export function panelWorkLeft(world: ReadonlyWorld, state: DeepReadonly<State>, member: DeepReadonly<CrewState>, objectId: string): number {
    const now = Object.hasOwn(state.objects, objectId) ? state.objects[objectId]! : undefined;
    if (now?.disabled) return 0;
    const needed = world.rules.panelActions;
    return Math.ceil((needed - (now?.progress ?? 0)) / workStep(member, needed));
}

// A dead panel kills every wired carrier, running ones too (§9.1).
registerCarrierCheck('panel', (world, state, carrier) => {
    return CARRIERS[carrier.kind].wired && panelDead(world, state) ? { halt: 'countered', why: 'panel' } : null;
});

// ---------------------------------------------------------------------------------------------------------- Jammer

/** Whether a running jammer covers a tile (§12.2). */
export function jammed(world: ReadonlyWorld, state: DeepReadonly<State>, p: DeepReadonly<Pos>): boolean {
    const r = world.rules.jammerRadius;
    return state.jammers.some(j => {
        const dx = j.pos.x - p.x, dy = j.pos.y - p.y;
        return dx * dx + dy * dy <= r * r;
    });
}

registerCarrierCheck('jammer', (world, state, carrier) =>
    (CARRIERS[carrier.kind].radio && jammed(world, state, carrier.pos) ? { halt: 'paused', why: 'jammer' } : null));

registerAction('placeJammer', {
    whyNot(_world, state, cmd) {
        const member = crewMember(state, cmd.crew);
        return lacksActions(member, 1) ?? (carries(member, JAMMER) ? undefined : `${member.name} has no jammer`);
    },
    candidates: (_world, _state, member) => (carries(member, JAMMER) ? [{ type: 'placeJammer', crew: member.id }] : []),
    cost: () => 1,
    run(ctx, member) {
        const { state } = ctx;
        member.loadout.items.splice(member.loadout.items.indexOf(JAMMER), 1);
        const jammer: Jammer = { id: newId(state, 'jammer'), pos: { x: member.pos.x, y: member.pos.y }, crew: member.id, turn: state.turn };
        state.jammers.push(jammer);
        ctx.emit({ type: 'jammerPlaced', crew: member.id, jammer: jammer.id, pos: { ...jammer.pos } });
    }
});

registerEvents({
    alarmAttempt: { undoBlocking: true },
    confronted: { undoBlocking: true },
    panelWorked: { undoBlocking: false },
    panelDisabled: { undoBlocking: false },
    jammerPlaced: { undoBlocking: false }
});
