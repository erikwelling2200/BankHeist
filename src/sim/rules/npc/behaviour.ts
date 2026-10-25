import { COMBAT_STATUSES } from '../../core/engine';
import { facingToward, FACINGS } from '../../core/grid';
import { sortedIds } from '../../core/json';
import { registerNpcInit } from '../../core/state';
import type { CarrierKind, DeepReadonly, Facing, IntentAction, NpcState, NpcStatus, PersonDef, Pos, ReadonlyWorld, State } from '../../core/types';
import { isEyesDown, pipsOf, type Want, type WantKind } from '../suspicion';
import { isPresent, personOf, type Pace } from './walk';
import { isWounded } from '../woundsState';

/*
 * What an NPC means to do (§8.5–8.7, §16.1–16.2): the state machine on top of its schedule. Perception hands over
 * what each NPC wants about each crew member (`NpcState.wants`, rules/suspicion.ts); this module turns the strongest
 * of them into a goal, and the intent (`intent.ts`) plans the walk to it.
 *
 * - **Calm**: no wants. It follows its schedule (`schedule.ts`).
 * - **Curious** (1 pip, `face`): it stops and turns to face the crew member's last known tile; the new facing is the
 *   telegraph.
 * - **Investigating** (2 pips, `investigate`): it walks (hurried, 5 tiles) to the last known tile; an enforcer that
 *   ends next to the crew member frisks them (`friskFinds`): anything Concealed or worse Exposes them, a clean frisk
 *   satisfies it until its suspicion rises again (`NpcState.frisked`). **One investigates, the others watch** (§16.1):
 *   of all the NPCs that want to investigate the same crew member, only the nearest of the right role walks
 *   (enforcers, then staff, then civilians; nearest to its last known tile, then first in resolution order); the
 *   others turn to watch (`watch`, Curious).
 *   When it loses the trail (its suspicion falls below 2 before it found anyone), it searches for `rules.searchPhases`
 *   (2) world phases (§16.1 cautious search): it keeps watching the last known tile for one more phase, then walks
 *   there and looks round, then goes back to its routine. A clean frisk or another NPC sent instead starts no search.
 * - **Trespass** (§8.6): the challenger (`challenge`) walks toward the crew member and keeps watching them; after
 *   they comply, it escorts (`escort`): follows them to the boundary of the Public floor without stepping onto it,
 *   watches them for one more world phase, then returns to its routine (the escort want runs out, suspicion.ts).
 * - **Alerted** (`react`, Exposed): it reacts by role (§16.2) through a reaction (`registerReaction`). The default
 *   reactions only walk and telegraph: tellers go to their window and press the button, the manager to the desk
 *   button, the operator to the console, guards radio where they stand (`raiseAlarm` intents, carried out by M1-08),
 *   other staff walk to the nearest guard and tell them (`tell`, carried out here: the guard is Exposed to the crew
 *   member too, §8.7). Civilians panic as they Expose someone (rules/panic.ts), which comes first; one not panicking
 *   any more (it was commanded, and got up) only watches. An NPC that has done its part
 *   (`NpcState.reported`) only keeps watching.
 *
 * Its status badge (§16.5) follows: calm, curious, investigating, alerted (the on-edge flag, whatever it is doing) or
 * away. Statuses this module doesn't own (hostile, commanded, tied, out cold, dead) are left alone, and so are those
 * NPCs' intents: eyes-down NPCs stay put, hostile ones belong to combat.
 */

/** What an NPC's intent was planned for. */
export type GoalKind =
    | 'still' | 'routine' | 'enter' | 'away' | 'face' | 'watch' | 'search' | 'investigate' | 'challenge' | 'escort' | 'react'
    // Evidence (rules/evidence.ts): walk over to it, look at it, or report it.
    | 'inspect' | 'look' | 'report'
    // A lapsed command (rules/command.ts, §10.5): run for the way out, or reach for the weapon.
    | 'flee' | 'reach' | 'phone'
    // Wounded (rules/wounds.ts, §11.12): crawling for the nearest way out.
    | 'crawl'
    // A hostage let go (rules/negotiation.ts, §10.7): walks out its way out.
    | 'walkOut'
    // Panic (rules/panic.ts, §10.8): frozen until its reaction is picked, then cowering, hiding or tackling.
    | 'panic' | 'cower' | 'hide' | 'tackle';

export interface Goal {
    kind: GoalKind;
    /** The crew member it is about. */
    crew?: string;
    /** Where it heads or looks. */
    tile?: Pos;
    /** The schedule block it follows (routine, enter, away). */
    block?: number;
    /** The evidence it is about (inspect, look, report). */
    evidence?: string;
}

/** How far it is along a route: the next waypoint, the direction, and how many phases it couldn't get closer. */
export interface RouteProgress { block: number; leg: number; dir: 1 | -1; stalled: number }

/** A cautious search (§16.1): where, and the turn whose world phase is its last. */
export interface Search { tile: Pos; until: number }

declare module '../../core/types' {
    interface NpcState {
        /** What its committed intent is for. */
        goal: Goal;
        /** Its progress along the route of the block it walks, or null. */
        route: RouteProgress | null;
        /** Its cautious search, or null. */
        search: Search | null;
        /** Crew members it frisked and found clean, with its pips then: it doesn't investigate them again until they rise. */
        frisked: Record<string, number>;
        /** Crew members whose exposure it has acted on (told a guard; M1-08 adds its alarms): it only watches them now. */
        reported: string[];
    }
    interface IntentActionMap {
        /** An enforcer frisks the crew member if it ends its walk next to them (§8.5). */
        frisk: { crew: string };
        /** Tells the guard `npc` about the crew member if it ends its walk next to them (§8.7): they are Exposed too. */
        tell: { npc: string; crew: string };
        /** Starts an alarm carrier of §9.1 (M1-08 carries it out). Only committed once the NPC stands where it can. */
        raiseAlarm: { carrier: CarrierKind; crew: string };
        /** Leaves the map at the end of its path. */
        leave: Record<never, never>;
        /** Comes back onto the map at its path's only tile. */
        enter: Record<never, never>;
    }
}

registerNpcInit('npc', (_world, _person, npc) => {
    npc.goal = { kind: 'still' };
    npc.route = null;
    npc.search = null;
    npc.frisked = {};
    npc.reported = [];
});

/** Statuses this module sets; any other belongs to another system and is left alone. */
export const ROUTINE_STATUSES: ReadonlySet<NpcStatus> = new Set<NpcStatus>(['calm', 'curious', 'investigating', 'alerted', 'panicked', 'away']);

/**
 * Whether this module decides the NPC's intent: it is neither eyes down nor in combat, nor Surprised (§9.3: it loses
 * the coming world phase standing where it is; rules/command.ts).
 */
export const decidesFor = (npc: DeepReadonly<NpcState>): boolean =>
    ROUTINE_STATUSES.has(npc.status) && !COMBAT_STATUSES.has(npc.status) && npc.surprised === null;

const WANT_RANK: Readonly<Record<WantKind, number>> = { react: 5, challenge: 4, escort: 3, investigate: 2, face: 1 };

/** The want an NPC acts on: the strongest, the first crew member by id among equals. */
export function topWant(npc: DeepReadonly<NpcState>): DeepReadonly<Want> | undefined {
    let top: DeepReadonly<Want> | undefined;
    for (const w of npc.wants) if (!top || WANT_RANK[w.kind] > WANT_RANK[top.kind]) top = w;
    return top;
}

const ROLE_RANK: Readonly<Record<PersonDef['observer'], number>> = { enforcer: 0, staff: 1, civilian: 2 };

/** Whether a clean frisk still satisfies the NPC about this crew member. */
export const friskSatisfied = (npc: DeepReadonly<NpcState>, crew: string): boolean =>
    Object.hasOwn(npc.frisked, crew) && pipsOf(npc, crew) <= npc.frisked[crew]!;

/** Whether an NPC would investigate the crew member, if it is the one sent. */
function wantsToInvestigate(npc: DeepReadonly<NpcState>, crew: string): DeepReadonly<Want> | undefined {
    if (!decidesFor(npc) || !isPresent(npc)) return undefined;
    const top = topWant(npc);
    return top?.kind === 'investigate' && top.crew === crew && !friskSatisfied(npc, crew) ? top : undefined;
}

/**
 * "One investigates, the others watch" (§16.1): of the NPCs that want to investigate the crew member, the one sent.
 * Evidence (M1-07) picks its investigator from its own candidates with `pickInvestigator`.
 */
export function investigatorOf(world: ReadonlyWorld, state: State, crew: string): string | undefined {
    return pickInvestigator(world, state.npcs.flatMap(n => {
        const want = wantsToInvestigate(n, crew);
        return want ? [{ npc: n, tile: want.tile }] : [];
    }));
}

/** The nearest of the right role among candidates, each with the tile it would go to (see the header). */
export function pickInvestigator(world: ReadonlyWorld, candidates: readonly { npc: DeepReadonly<NpcState>; tile: DeepReadonly<Pos> }[]): string | undefined {
    let best: { id: string; key: [number, number] } | undefined;
    for (const { npc, tile } of candidates) {
        const dx = npc.pos.x - tile.x, dy = npc.pos.y - tile.y;
        const key: [number, number] = [ROLE_RANK[personOf(world, npc.id).observer], dx * dx + dy * dy];
        if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && key[1] < best.key[1])) best = { id: npc.id, key };
    }
    return best?.id;
}

/** A reaction's plan: where to go (null: where it stands), how fast, which way to face, and what to do there. */
export interface ReactionPlan {
    tile: Pos | null;
    pace: Pace;
    facing?: Facing;
    action: IntentAction | null;
    /** The action is committed only once the walk arrives at `tile` (a button, a console); otherwise always. */
    onArrival: boolean;
}

export type Reaction = (world: ReadonlyWorld, state: State, npc: DeepReadonly<NpcState>, want: DeepReadonly<Want>) => ReactionPlan;

const REACTIONS = new Map<string, Reaction>();

/**
 * Sets how NPCs of a role react to a crew member they Exposed (§16.2); '*' is everyone without a reaction of their
 * own. M1-08 and later packages replace these (`replace: true`).
 */
export function registerReaction(role: string, reaction: Reaction, options: { replace?: boolean } = {}): void {
    if (REACTIONS.has(role) && !options.replace) throw new Error(`Reaction '${role}' already exists; pass replace: true to change it`);
    REACTIONS.set(role, reaction);
}

/** The plan of an NPC reacting to a crew member it Exposed. */
export function reactionOf(world: ReadonlyWorld, state: State, npc: DeepReadonly<NpcState>, want: DeepReadonly<Want>): ReactionPlan {
    const role = personOf(world, npc.id).role;
    return (REACTIONS.get(role) ?? REACTIONS.get('*')!)(world, state, npc, want);
}

/** The tile of the first block of a person's schedule doing `activity`. */
function stationOf(person: DeepReadonly<PersonDef>, activities: readonly string[]): Pos | null {
    const b = person.schedule.find(s => activities.includes(s.activity) && s.at);
    return b?.at ? { x: b.at.x, y: b.at.y } : null;
}

const watching = (npc: DeepReadonly<NpcState>, want: DeepReadonly<Want>): ReactionPlan => {
    const facing = facingToward(npc.pos, want.tile);
    return { tile: null, pace: 'hurry', ...(facing ? { facing } : {}), action: null, onArrival: false };
};

/** Alarm by a station: walk to it (hurried) and start the carrier there. */
const atStation = (activities: readonly string[], carrier: CarrierKind): Reaction => (world, _state, npc, want) => {
    if (npc.reported.includes(want.crew)) return watching(npc, want);
    const tile = stationOf(personOf(world, npc.id), activities);
    return { tile, pace: 'hurry', action: { kind: 'raiseAlarm', carrier, crew: want.crew }, onArrival: true };
};

/** Tell the nearest guard on the map who isn't down (§8.7), or phone it in when there is none. */
const tellAGuard: Reaction = (world, state, npc, want) => {
    if (npc.reported.includes(want.crew)) return watching(npc, want);
    let guard: DeepReadonly<NpcState> | undefined, best = Infinity;
    for (const n of state.npcs) {
        if (n.id === npc.id || personOf(world, n.id).observer !== 'enforcer' || isEyesDown(n) || !isPresent(n)) continue;
        const dx = n.pos.x - npc.pos.x, dy = n.pos.y - npc.pos.y, d = dx * dx + dy * dy;
        if (d < best) { best = d; guard = n; }
    }
    if (!guard) return { tile: null, pace: 'hurry', action: { kind: 'raiseAlarm', carrier: 'phoneCall', crew: want.crew }, onArrival: true };
    return { tile: { x: guard.pos.x, y: guard.pos.y }, pace: 'hurry', action: { kind: 'tell', npc: guard.id, crew: want.crew }, onArrival: false };
};

const radio: Reaction = (_world, _state, npc, want) => {
    if (npc.reported.includes(want.crew)) return watching(npc, want);
    const facing = facingToward(npc.pos, want.tile);
    return { tile: null, pace: 'hurry', ...(facing ? { facing } : {}), action: { kind: 'raiseAlarm', carrier: 'guardRadio', crew: want.crew }, onArrival: true };
};

registerReaction('teller', atStation(['window'], 'tellerButton'));
registerReaction('headTeller', atStation(['window'], 'tellerButton'));
registerReaction('manager', atStation(['post'], 'managerButton'));
registerReaction('operator', atStation(['post'], 'operatorCamera'));
registerReaction('technician', (_world, _state, npc, want) => (npc.reported.includes(want.crew) ? watching(npc, want)
    : { tile: null, pace: 'hurry', action: { kind: 'raiseAlarm', carrier: 'phoneCall', crew: want.crew }, onArrival: true }));
registerReaction('*', (world, state, npc, want) => {
    const observer = personOf(world, npc.id).observer;
    return observer === 'enforcer' ? radio(world, state, npc, want) : observer === 'staff' ? tellAGuard(world, state, npc, want) : watching(npc, want);
});

/**
 * The goal an NPC's wants and search give it, or null to follow its schedule. Pure: the same state gives the same
 * goal, so a crew phase can ask again after every action and re-plan only the NPCs whose goal changed.
 */
export function behaviourGoal(world: ReadonlyWorld, state: State, npc: DeepReadonly<NpcState>): Goal | null {
    if (!decidesFor(npc)) return null;
    // A runner who got out (rules/command.ts) doesn't come back.
    if ((npc.lapse?.kind === 'flee' || npc.lapse?.kind === 'released') && !isPresent(npc)) return { kind: 'away' };
    if (!isPresent(npc)) return null;
    // Let go (rules/negotiation.ts): it walks out its way out, crawling when wounded (npc/intent.ts), and leaves there.
    if (npc.lapse?.kind === 'released') return { kind: 'walkOut', tile: { x: npc.lapse.exit.x, y: npc.lapse.exit.y } };
    // Wounded (§11.12): it crawls for a way out, whatever it wanted or was running for; a Hostile one fights on (M3-05, M3-06).
    if (npc.status !== 'hostile' && isWounded(world, npc)) return { kind: 'crawl' };
    // A lapsed command's intent (§10.5) comes before anything it wants: it was rolled and shown.
    if (npc.lapse?.kind === 'flee') return { kind: 'flee', tile: { x: npc.lapse.exit.x, y: npc.lapse.exit.y } };
    if (npc.lapse?.kind === 'reach') return { kind: 'reach', crew: npc.lapse.crew };
    if (npc.lapse?.kind === 'phone') return { kind: 'phone', crew: npc.lapse.crew };
    // Panic (§10.8) comes before anything it wants: frozen, then what it picked, shown as it was picked.
    if (npc.panic) return panicGoal(state, npc);
    const top = topWant(npc);
    // Reacting to an Exposed crew member comes first, then major evidence, then the crew wants, then minor evidence.
    const evidence = top?.kind === 'react' ? null : evidenceGoal(world, state, npc);
    if (evidence && npc.evidence!.major) return evidence;
    if (top && top.kind !== 'face') {
        const tile = { x: top.tile.x, y: top.tile.y };
        if (top.kind !== 'investigate') return { kind: top.kind, crew: top.crew, tile };
        if (!friskSatisfied(npc, top.crew) && investigatorOf(world, state, top.crew) === npc.id) return { kind: 'investigate', crew: top.crew, tile };
        return { kind: 'watch', crew: top.crew, tile };
    }
    if (evidence) return evidence;
    if (npc.search && npc.search.until >= comingPhase(state)) return { kind: 'search', tile: { x: npc.search.tile.x, y: npc.search.tile.y } };
    if (top) return { kind: 'face', crew: top.crew, tile: { x: top.tile.x, y: top.tile.y } };
    return null;
}

/** The goal of a panicking NPC (rules/panic.ts): frozen facing the fright, then cowering, hiding or tackling. */
function panicGoal(state: State, npc: DeepReadonly<NpcState>): Goal {
    const panic = npc.panic!, reaction = panic.reaction;
    if (!reaction) return { kind: 'panic', tile: { x: panic.tile.x, y: panic.tile.y }, ...(panic.crew !== null ? { crew: panic.crew } : {}) };
    if (reaction.kind === 'hide') return { kind: 'hide', tile: { x: reaction.spot.x, y: reaction.spot.y } };
    if (reaction.kind === 'tackle') {
        const member = state.crew.find(c => c.id === reaction.crew)!;
        return { kind: 'tackle', crew: reaction.crew, tile: { x: member.pos.x, y: member.pos.y } };
    }
    return { kind: 'cower' };
}

/**
 * What evidence the NPC deals with gives it to do (rules/evidence.ts): of the NPCs dealing with the same evidence, one
 * is sent (`pickInvestigator`): to walk over to minor evidence (`inspect`) or to report major evidence (`report`); the
 * others look at it (`look`).
 */
export function evidenceGoal(world: ReadonlyWorld, state: State, npc: DeepReadonly<NpcState>): Goal | null {
    const ev = npc.evidence;
    if (!ev) return null;
    const tile = { x: ev.tile.x, y: ev.tile.y };
    const sent = pickInvestigator(world, state.npcs.flatMap(n => (n.evidence?.id === ev.id && decidesFor(n) && isPresent(n) ? [{ npc: n, tile: n.evidence.tile }] : [])));
    if (sent !== npc.id) return { kind: 'look', evidence: ev.id, tile };
    return { kind: ev.major ? 'report' : 'inspect', evidence: ev.id, tile };
}

/**
 * How an NPC reports major evidence (§8.10): a guard radios where it stands, anyone else walks to the nearest guard on
 * the map who isn't down and tells them, or phones it in when there is none. M1-08 carries out `reportEvidence`.
 */
export function evidenceReport(world: ReadonlyWorld, state: State, npc: DeepReadonly<NpcState>): ReactionPlan {
    const ev = npc.evidence!, facing = facingToward(npc.pos, ev.tile);
    const inPlace = (carrier: CarrierKind): ReactionPlan =>
        ({ tile: null, pace: 'hurry', ...(facing ? { facing } : {}), action: { kind: 'reportEvidence', evidence: ev.id, carrier }, onArrival: true });
    if (personOf(world, npc.id).observer === 'enforcer') return inPlace('guardRadio');
    let guard: DeepReadonly<NpcState> | undefined, best = Infinity;
    for (const n of state.npcs) {
        if (n.id === npc.id || personOf(world, n.id).observer !== 'enforcer' || isEyesDown(n) || !isPresent(n)) continue;
        const dx = n.pos.x - npc.pos.x, dy = n.pos.y - npc.pos.y, d = dx * dx + dy * dy;
        if (d < best) { best = d; guard = n; }
    }
    if (!guard) return inPlace('phoneCall');
    return { tile: { x: guard.pos.x, y: guard.pos.y }, pace: 'hurry', action: { kind: 'tellEvidence', npc: guard.id, evidence: ev.id }, onArrival: false };
}

/** The turn of the coming world phase: this turn's in a crew phase, the next one's at the end of a world phase. */
export const comingPhase = (state: State): number => (state.phase === 'world' ? state.turn + 1 : state.turn);

/** The status badge a goal shows (§16.5), for an NPC whose status this module owns. */
export function statusFor(npc: DeepReadonly<NpcState>, goal: Goal): NpcStatus {
    if (goal.kind === 'away' || goal.kind === 'enter') return 'away';
    if (goal.kind === 'crawl') return 'alerted';
    if (npc.panic) return 'panicked';
    if (npc.alerted || goal.kind === 'react' || goal.kind === 'report' || goal.kind === 'flee' || goal.kind === 'reach' || goal.kind === 'phone') return 'alerted';
    if (goal.kind === 'investigate' || goal.kind === 'search' || goal.kind === 'challenge' || goal.kind === 'escort' || goal.kind === 'inspect') return 'investigating';
    if (goal.kind === 'face' || goal.kind === 'watch' || goal.kind === 'look') return 'curious';
    return 'calm';
}

/** The facing a quarter turn clockwise: a searcher looking round. */
export function quarterTurn(facing: Facing): Facing {
    return FACINGS[(FACINGS.indexOf(facing) + 2) % FACINGS.length]!;
}

/** Forgets clean frisks its suspicion has fallen below (so a rise after the fall sends it again). */
export function settleFrisks(npc: NpcState): void {
    for (const crew of sortedIds(npc.frisked)) {
        const pips = pipsOf(npc, crew);
        if (pips === 0) delete npc.frisked[crew];
        else if (pips < npc.frisked[crew]!) npc.frisked[crew] = pips;
    }
}
