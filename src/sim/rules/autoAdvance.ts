import { commit, IllegalCommand, type CommitResult } from '../core/engine';
import { samePos } from '../core/grid';
import { clonePlain, sortedIds } from '../core/json';
import type { Command, DeepReadonly, Pos, ReadonlyWorld, State } from '../core/types';
import { crewBudget, crewMoveOptions, planningState } from '../crew/movement';
import { MOVE_ACTIONS } from '../data/movement';
import { LYING_STATUSES, validatePath } from '../geo/move';
import { isKnownNow, markerKind, projectEvents } from './knowledge';
import { blockIndexAt } from './npc/schedule';
import { isPresent, personOf } from './npc/walk';
import { onFloor } from './place';

/*
 * Keeping quiet turns fast (GAME_DESIGN §6.5; implementation plan M1-11): multi-turn routes, auto-advance and
 * "Wait for…". Pure functions over the World and the State; the Session (src/game) commits what they ask for.
 *
 * - **Routes.** A route is the tiles a crew member is to walk, as far beyond this turn as the player dragged it. Routes
 *   aren't part of `State` (they are the player's plan, not the bank's): the Session keeps them with the UI state and
 *   saves them, and `autoStep` takes and returns them. Each crew phase a crew member walks their route with ordinary
 *   Move commands, **one Move per action they have left** (2 a turn, the most a player could walk without a Dash),
 *   each as far along the route as the Move's budget reaches on the crew's picture of the bank (the same check the
 *   move command makes). **A Dash is never automatic**: it is noisy, and noise is a decision.
 * - **Auto-advance** (`autoStep`) plays one turn: the crew's route moves, then the end of the turn; it stops as soon as
 *   anything interrupts (a crew move's events are checked before the next command, so the player gets the rest of the
 *   crew phase to react). It is available only while no NPC the crew knows of is Alerted (or Hostile), the bank is
 *   neither loud nor alarmed and no alarm carrier is counting down (`autoAdvanceBlocked`).
 * - **Interrupts** (`interruptsOf`) are a pure function of the state before, the state after and the events between,
 *   judged only on what the crew can know: the events projected through its knowledge (`projectEvents`) and NPCs it
 *   sees or predicts. An NPC the crew doesn't know of can change its mind, walk or start its lunch without stopping
 *   anything; what the player isn't told can't stop the clock either (that would tell them something).
 * - **Wait for…** (`WaitTarget`) ends turns until a chosen event: a turn (the next schedule event the crew knows of),
 *   a known NPC leaving its room or the map, an absent one coming back, or a known NPC's walk crossing a tile ("until
 *   the guard passes"; a doorway is given as a tile beside it). Each is checked after every turn (`waitReached`),
 *   with `AUTO_TURN_CAP` turns at most. While waiting, schedule events of other NPCs don't interrupt (the player chose
 *   what to wait for); every other interrupt does.
 */

/** Each crew member's planned route by crew id: the tiles still to walk, in order, the first next to where they stand. */
export type Routes = Record<string, Pos[]>;

/** The most turns one Go or Wait for plays before it hands back to the player. */
export const AUTO_TURN_CAP = 20;

/** Why auto-advance stopped (or won't start). The interrupt kinds come first, in order of urgency. */
export type InterruptKind =
    | 'carrier' | 'alerted' | 'exposed' | 'challenge' | 'moveCut' | 'suspicion' | 'intent' | 'evidence' | 'revealed' | 'arrival' | 'schedule';

export type StopKind = InterruptKind | 'unavailable' | 'arrived' | 'blocked' | 'target' | 'lost' | 'cap';

/** A reason to stop: its kind, a line for the player ("the cleaner turned toward Jun"), and who and where, if anyone. */
export interface AutoStop {
    kind: StopKind;
    text: string;
    npc?: string;
    crew?: string;
    at?: Pos;
}

export type Interrupt = AutoStop & { kind: InterruptKind };

const URGENCY: readonly InterruptKind[] = ['carrier', 'alerted', 'exposed', 'challenge', 'moveCut', 'suspicion', 'intent', 'evidence', 'revealed', 'arrival', 'schedule'];

/** What "Wait for…" waits for. */
export type WaitTarget =
    /** A turn: the next schedule event the crew knows of (`knownSchedule`). */
    | { kind: 'turn'; turn: number }
    /** A known NPC is no longer in `room` (the room it was in when the wait began), or has left the map. */
    | { kind: 'leaves'; npc: string; room: string | null }
    /** An NPC away from the map is back on it. */
    | { kind: 'arrives'; npc: string }
    /** A known NPC's walk has crossed `tile`. */
    | { kind: 'passes'; npc: string; tile: Pos };

// ---------------------------------------------------------------------------------------------------------- Names

/** An NPC as the stop line names it: "the cleaner". */
export const npcLabel = (world: ReadonlyWorld, id: string): string => {
    const person = world.people.find(p => p.id === id);
    return person ? `the ${person.role}` : 'someone';
};

const crewLabel = (state: DeepReadonly<State>, id: string): string => state.crew.find(c => c.id === id)?.name ?? id;

const roomName = (id: string): string => id.replace(/-\d+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

const roomAt = (world: ReadonlyWorld, p: Pos): string | null => world.tiles[p.y * world.width + p.x]?.room ?? null;

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

// ---------------------------------------------------------------------------------------------------------- Availability

/** Why auto-advance can't run now (in the crew's knowledge), or null when it can. */
export function autoAdvanceBlocked(world: ReadonlyWorld, state: State): string | null {
    if (state.phase !== 'crew') return 'Not during the world phase';
    if (state.bank.alarm) return 'Not after the alarm';
    if (state.bank.loud) return 'Not once the bank is loud';
    if (state.carriers.some(c => c.halted === null)) return 'An alarm is counting down';
    for (const npc of state.npcs) {
        if ((npc.status === 'alerted' || npc.status === 'hostile') && isKnownNow(world, state, npc.id)) return `${capital(npcLabel(world, npc.id))} is alerted`;
    }
    return null;
}

// ---------------------------------------------------------------------------------------------------------- Routes

/** The route with the steps already walked taken off: everything up to the crew member's tile, if it is on it. */
export function trimRoute(route: readonly Pos[], at: Pos): Pos[] {
    let from = 0;
    for (let i = route.length - 1; i >= 0; i--) if (samePos(route[i]!, at)) { from = i + 1; break; }
    return route.slice(from).map(p => ({ x: p.x, y: p.y }));
}

/**
 * The longest start of `route` one Move can walk from `from` (on the crew's picture, with the Move's budget and the
 * move command's own path check), or an empty list when not even its first step can be taken; `reason` says why.
 */
export function routeLeg(world: ReadonlyWorld, state: State, crewId: string, route: readonly Pos[], from?: Pos): { path: Pos[]; reason?: string } {
    const member = state.crew.find(c => c.id === crewId);
    if (!member || !route.length) return { path: [], reason: member ? 'No route' : `No crew member '${crewId}'` };
    const picture = onFloor(planningState(world, state)), start = from ?? member.pos;
    const budget = crewBudget(world, member, 'move'), options = crewMoveOptions(member);
    let best = 0, reason: string | undefined;
    for (let n = 1; n <= route.length; n++) {
        const check = validatePath(world, picture, start, route.slice(0, n), budget, options);
        if (check.ok) { best = n; continue; }
        reason = check.reason;
        // Only someone standing on the last tile can be walked past by a longer path; anything else ends the leg.
        if (check.at < n - 1 || !/^Someone is already on/.test(check.reason)) break;
    }
    return best ? { path: route.slice(0, best).map(p => ({ x: p.x, y: p.y })) } : { path: [], reason: reason ?? 'Blocked' };
}

/** One turn's share of a planned route: the Moves it is walked in, and the turn they are played in. */
export interface RouteLeg { turn: number; path: Pos[] }

/**
 * How a route would be walked as things stand: Move by Move, two to a turn (this turn only as many as the crew member
 * has actions left), each as far as its budget reaches on the crew's picture. `walkable` is how many of the route's
 * tiles the legs cover; the rest can't be planned now (a wall, a locked door, someone in the way).
 */
export function planRoute(world: ReadonlyWorld, state: State, crewId: string, route: readonly Pos[]): { legs: RouteLeg[]; walkable: number } {
    const member = state.crew.find(c => c.id === crewId);
    const legs: RouteLeg[] = [];
    if (!member) return { legs, walkable: 0 };
    let at: Pos = member.pos, left = route.map(p => ({ x: p.x, y: p.y })), walked = 0;
    let turn = state.turn, actions = member.actionsLeft;
    for (let guard = 0; left.length && guard < AUTO_TURN_CAP * world.rules.actionsPerTurn + 2; guard++) {
        if (actions < MOVE_ACTIONS) {
            turn++;
            actions = world.rules.actionsPerTurn;
            continue;
        }
        const leg = routeLeg(world, state, crewId, left, at);
        if (!leg.path.length) break;
        legs.push({ turn, path: leg.path });
        walked += leg.path.length;
        at = leg.path.at(-1)!;
        left = left.slice(leg.path.length);
        actions -= MOVE_ACTIONS;
    }
    return { legs, walkable: walked };
}

/** The first step of `path` that can't be part of a route at all (a wall, a locked door, off the map), or -1. */
export function routeBreak(world: ReadonlyWorld, state: State, crewId: string, path: readonly Pos[]): number {
    const member = state.crew.find(c => c.id === crewId);
    if (!member || !path.length) return 0;
    // Only the crew's tile counts as somewhere to step from; the budget is the whole route's.
    // NPCs move every turn: only the bank itself (walls, locked doors, furniture) breaks a route.
    const picture = { ...onFloor(planningState(world, state)), npcs: [] };
    const check = validatePath(world, picture, member.pos, path, Number.MAX_SAFE_INTEGER, crewMoveOptions(member));
    if (check.ok) return -1;
    return /already on/.test(check.reason) ? -1 : check.at;
}

// ---------------------------------------------------------------------------------------------------------- Interrupts

export interface InterruptOptions {
    /** Whether a known NPC's schedule event stops it (default true; a Wait for that isn't for a turn passes false). */
    schedule?: boolean;
}

/** Goal kinds that are about a crew member: the NPC turning toward the crew (behaviour.ts). */
const TOWARD_CREW: ReadonlySet<string> = new Set(['face', 'watch', 'investigate', 'challenge', 'escort', 'react', 'search']);
const ABOUT_EVIDENCE: ReadonlySet<string> = new Set(['inspect', 'look', 'report']);

/**
 * Why a command (a crew move or the end of a turn) should stop auto-advance, most urgent first, judged on what the
 * crew knows (see the header): `before` the state it was played from, `result` what it did. Empty: carry on.
 */
export function interruptsOf(world: ReadonlyWorld, before: State, result: Pick<CommitResult, 'state' | 'events'>, options: InterruptOptions = {}): Interrupt[] {
    const after = result.state, shown = projectEvents(world, after, result.events, before);
    const out: Interrupt[] = [];
    const add = (i: Interrupt): void => {
        if (!out.some(o => o.kind === i.kind && o.npc === i.npc && o.crew === i.crew)) out.push(i);
    };
    const npcPos = (id: string): Pos | undefined => {
        const n = after.npcs.find(x => x.id === id);
        return n ? { x: n.pos.x, y: n.pos.y } : undefined;
    };
    const who = (id: string): string => npcLabel(world, id), crew = (id: string): string => crewLabel(after, id);
    const at = (id: string): { at?: Pos } => {
        const p = npcPos(id);
        return p ? { at: p } : {};
    };
    for (const e of shown) {
        switch (e.type) {
            case 'carrierStarted': {
                const c = after.carriers.find(x => x.id === e.carrier);
                add({ kind: 'carrier', text: `an alarm is being raised (${e.countdown} turns)`, ...(c ? { npc: c.source, at: { x: c.pos.x, y: c.pos.y } } : {}) });
                break;
            }
            case 'alerted': add({ kind: 'alerted', text: `${who(e.npc)} is alerted`, npc: e.npc, ...at(e.npc) }); break;
            case 'npcStatus':
                if (e.status === 'alerted' || e.status === 'hostile') add({ kind: 'alerted', text: `${who(e.npc)} is alerted`, npc: e.npc, ...at(e.npc) });
                break;
            case 'exposed': add({ kind: 'exposed', text: `${who(e.npc)} made ${crew(e.crew)}`, npc: e.npc, crew: e.crew, ...at(e.npc) }); break;
            case 'challenged': add({ kind: 'challenge', text: `${who(e.npc)} challenged ${crew(e.crew)}`, npc: e.npc, crew: e.crew, ...at(e.npc) }); break;
            case 'moveCut':
                add({
                    kind: 'moveCut', npc: e.npc, crew: e.crew, at: { x: e.at.x, y: e.at.y },
                    text: e.reason === 'bump' ? `${crew(e.crew)} ran into ${who(e.npc)}` : `${crew(e.crew)} spotted ${who(e.npc)}`
                });
                break;
            case 'suspicionRaised': add({ kind: 'suspicion', text: `${who(e.npc)} grew suspicious of ${crew(e.crew)}`, npc: e.npc, crew: e.crew, ...at(e.npc) }); break;
            case 'cameraSaw': add({ kind: 'suspicion', text: `a camera saw ${crew(e.crew)}`, crew: e.crew, at: { x: e.tile.x, y: e.tile.y } }); break;
            case 'evidenceNoticed': add({ kind: 'evidence', text: `${who(e.npc)} noticed something`, npc: e.npc, ...at(e.npc) }); break;
            case 'cameraSawEvidence': add({ kind: 'evidence', text: 'a camera caught something', at: { x: e.tile.x, y: e.tile.y } }); break;
            case 'revealed':
                if (e.what === 'npc' && markerKind(world, before, e.id) === null) add({ kind: 'revealed', text: `spotted ${who(e.id)}`, npc: e.id, ...at(e.id) });
                else if (e.what === 'room') add({ kind: 'revealed', text: `found the ${roomName(e.id)}` });
                else if (e.what === 'camera') {
                    const cam = world.cameras.find(c => c.id === e.id);
                    add({ kind: 'revealed', text: 'spotted a camera', ...(cam ? { at: { x: cam.pos.x, y: cam.pos.y } } : {}) });
                }
                break;
            case 'npcEntered': {
                // Someone whose routine the crew knows coming back is a schedule event, not an arrival.
                const rec = Object.hasOwn(before.knowledge.npcs, e.npc) ? before.knowledge.npcs[e.npc]! : undefined;
                if (!rec?.routine) add({ kind: 'arrival', text: `${who(e.npc)} arrived`, npc: e.npc, at: { x: e.at.x, y: e.at.y } });
                break;
            }
            default: break;
        }
    }
    // An NPC the crew sees or predicts turning toward a crew member, or to evidence: its new intent is on the map.
    for (const npc of after.npcs) {
        if (!isKnownNow(world, after, npc.id)) continue;
        const was = before.npcs.find(n => n.id === npc.id), goal = npc.goal, old = was?.goal;
        if (!goal || (old && old.kind === goal.kind && old.crew === goal.crew && old.evidence === goal.evidence)) continue;
        if (TOWARD_CREW.has(goal.kind) && goal.crew) add({ kind: 'intent', text: `${who(npc.id)} turned toward ${crew(goal.crew)}`, npc: npc.id, crew: goal.crew, ...at(npc.id) });
        else if (TOWARD_CREW.has(goal.kind)) add({ kind: 'intent', text: `${who(npc.id)} is searching`, npc: npc.id, ...at(npc.id) });
        else if (ABOUT_EVIDENCE.has(goal.kind)) add({ kind: 'intent', text: `${who(npc.id)} is going to look at something`, npc: npc.id, ...at(npc.id) });
    }
    // A schedule event of someone whose routine the crew knows (the timeline it has worked out): their block changed.
    if (options.schedule !== false && after.turn !== before.turn) {
        for (const id of sortedIds(before.knowledge.npcs)) {
            if (!before.knowledge.npcs[id]!.routine || !world.people.some(p => p.id === id)) continue;
            const person = personOf(world, id), from = blockIndexAt(person, before.turn), to = blockIndexAt(person, after.turn);
            if (from === to || to < 0) continue;
            add({ kind: 'schedule', text: `${who(id)}: ${person.schedule[to]!.label}`, npc: id, ...at(id) });
        }
    }
    return out.sort((a, b) => URGENCY.indexOf(a.kind) - URGENCY.indexOf(b.kind));
}

// ---------------------------------------------------------------------------------------------------------- Wait for…

/** An upcoming event on the day's schedule that the crew knows of: a block of an NPC whose routine it knows. */
export interface KnownEvent { turn: number; npc: string; label: string }

/** The schedule events the crew knows are coming after this turn (from the routines it has worked out), in order. */
export function knownSchedule(world: ReadonlyWorld, state: State): KnownEvent[] {
    const out: KnownEvent[] = [];
    for (const id of sortedIds(state.knowledge.npcs)) {
        if (!state.knowledge.npcs[id]!.routine) continue;
        const person = world.people.find(p => p.id === id);
        if (!person) continue;
        for (const b of person.schedule) if (b.from > state.turn) out.push({ turn: b.from, npc: id, label: `${npcLabel(world, id)}: ${b.label}` });
    }
    return out.sort((a, b) => a.turn - b.turn || (a.npc < b.npc ? -1 : a.npc > b.npc ? 1 : 0));
}

/** One entry of the "Wait for…" menu. */
export interface WaitOption { target: WaitTarget; label: string }

/**
 * What the crew can wait for now (the HUD's "Wait for…" menu): the next schedule event it knows of and the few after
 * it, each NPC it sees or predicts leaving where it is, each it knows to be away coming back, and, for a known NPC
 * whose walk is on the map, it passing the tile of that walk nearest `near` (the selected crew member).
 */
export function waitOptions(world: ReadonlyWorld, state: State, near?: Pos): WaitOption[] {
    const out: WaitOption[] = [];
    const events = knownSchedule(world, state).filter(e => e.turn <= state.turn + AUTO_TURN_CAP);
    events.slice(0, 3).forEach((e, i) => out.push({ target: { kind: 'turn', turn: e.turn }, label: `${i ? 'Turn' : 'Next event, turn'} ${e.turn}: ${e.label}` }));
    for (const npc of state.npcs) {
        const kind = markerKind(world, state, npc.id);
        if (kind !== 'live' && kind !== 'predicted') continue;
        if (LYING_STATUSES.has(npc.status) || npc.status === 'tied' || npc.status === 'commanded') continue;
        const label = npcLabel(world, npc.id);
        if (!isPresent(npc)) {
            out.push({ target: { kind: 'arrives', npc: npc.id }, label: `Until ${label} is back` });
            continue;
        }
        const rec = state.knowledge.npcs[npc.id]!;
        out.push({ target: { kind: 'leaves', npc: npc.id, room: roomAt(world, rec.at) }, label: `Until ${label} leaves` });
        const walk = npc.intent.path;
        if (near && walk.length) {
            let best = walk[0]!, d = Infinity;
            for (const p of walk) {
                const dx = p.x - near.x, dy = p.y - near.y, dd = dx * dx + dy * dy;
                if (dd < d) { d = dd; best = p; }
            }
            out.push({ target: { kind: 'passes', npc: npc.id, tile: { x: best.x, y: best.y } }, label: `Until ${label} passes` });
        }
    }
    return out;
}

/** The line a stop shows for a target reached. */
function reachedText(world: ReadonlyWorld, target: WaitTarget): string {
    switch (target.kind) {
        case 'turn': return `it's turn ${target.turn}`;
        case 'leaves': return `${npcLabel(world, target.npc)} left`;
        case 'arrives': return `${npcLabel(world, target.npc)} is back`;
        case 'passes': return `${npcLabel(world, target.npc)} passed`;
    }
}

/**
 * Whether a wait is over after a turn: `before` and `result` are the end of the turn just played. A reached target is
 * a stop of kind `target`; an NPC the crew lost track of (no longer seen or predicted) is `lost`. Null: wait on.
 */
export function waitReached(world: ReadonlyWorld, target: WaitTarget, before: State, result: Pick<CommitResult, 'state' | 'events'>): AutoStop | null {
    const after = result.state;
    const done = (at?: Pos): AutoStop => ({ kind: 'target', text: reachedText(world, target), ...('npc' in target ? { npc: target.npc } : {}), ...(at ? { at } : {}) });
    if (target.kind === 'turn') return after.turn >= target.turn ? done() : null;
    const shown = projectEvents(world, after, result.events, before);
    const npc = after.npcs.find(n => n.id === target.npc);
    if (!npc) return { kind: 'lost', text: `no one called ${target.npc}` };
    const kind = markerKind(world, after, npc.id), known = kind === 'live' || kind === 'predicted';
    const rec = Object.hasOwn(after.knowledge.npcs, npc.id) ? after.knowledge.npcs[npc.id]! : undefined;
    const pos = rec ? { x: rec.at.x, y: rec.at.y } : undefined;
    switch (target.kind) {
        case 'leaves': {
            if (shown.some(e => e.type === 'npcLeft' && e.npc === npc.id)) return done(pos);
            if (!known) return { kind: 'lost', text: `lost track of ${npcLabel(world, npc.id)}`, npc: npc.id, ...(pos ? { at: pos } : {}) };
            // A predicted NPC is where its routine has it, so whether it is on the map is what the crew predicts too.
            if (!isPresent(npc) || (pos && roomAt(world, pos) !== target.room)) return done(pos);
            return null;
        }
        case 'arrives': {
            if (shown.some(e => e.type === 'npcEntered' && e.npc === npc.id)) return done(pos);
            return known && isPresent(npc) ? done(pos) : null;
        }
        case 'passes': {
            const crossed = shown.some(e => e.type === 'npcWalked' && e.npc === npc.id && e.path.some(p => samePos(p, target.tile)));
            if (crossed || (known && pos && samePos(pos, target.tile))) return done(pos);
            if (!known) return { kind: 'lost', text: `lost track of ${npcLabel(world, npc.id)}`, npc: npc.id, ...(pos ? { at: pos } : {}) };
            return null;
        }
    }
}

// ---------------------------------------------------------------------------------------------------------- Playing

export interface AutoOptions {
    /** A "Wait for…" target; without one, auto-advance runs until the routes are walked. */
    target?: WaitTarget | null;
    /** Turns this run has played so far (the cap counts from the first). */
    turnsPlayed?: number;
    /** The most turns a run plays (default `AUTO_TURN_CAP`). */
    cap?: number;
    /**
     * Plays a command on `state` (the state the run is at): the engine's `commit` by default. The Session passes its own
     * commit, so every command is autosaved, queued for playback and logged like one the player gave.
     */
    play?: (cmd: Command, state: State) => CommitResult;
}

export interface AutoStepResult {
    state: State;
    /** The routes left to walk. */
    routes: Routes;
    /** Every command played, with what it did, in order. */
    played: { command: Command; result: CommitResult }[];
    /** Turns the run has played, this one included. */
    turnsPlayed: number;
    /** Why to stop, or null to carry on with another step. */
    stop: AutoStop | null;
}

/** The routes with every crew member's walked steps trimmed off and empty ones dropped. */
function liveRoutes(state: State, routes: Readonly<Routes>): Routes {
    const out: Routes = {};
    for (const id of sortedIds(routes)) {
        const member = state.crew.find(c => c.id === id);
        if (!member) continue;
        const left = trimRoute(routes[id]!, member.pos);
        if (left.length) out[id] = left;
    }
    return out;
}

/**
 * Plays one turn of auto-advance from `state`: every crew member with a route walks it (Moves only, in crew order),
 * then the turn ends. Stops before the end of the turn if a move is interrupted or blocked, or when no route is left to
 * walk and nothing is being waited for (`arrived`); stops after it on an interrupt, a reached target, or the cap.
 */
export function autoStep(world: ReadonlyWorld, state: State, routes: Readonly<Routes>, options: AutoOptions = {}): AutoStepResult {
    const play = options.play ?? ((cmd: Command, s: State) => commit(world, s, cmd));
    const target = options.target ?? null, cap = options.cap ?? AUTO_TURN_CAP;
    let turnsPlayed = options.turnsPlayed ?? 0, now = state, left = liveRoutes(state, routes);
    const played: AutoStepResult['played'] = [];
    const out = (stop: AutoStop | null): AutoStepResult => ({ state: now, routes: liveRoutes(now, left), played, turnsPlayed, stop });
    const unavailable = autoAdvanceBlocked(world, now);
    if (unavailable) return out({ kind: 'unavailable', text: unavailable.charAt(0).toLowerCase() + unavailable.slice(1) });
    const run = (cmd: Command): CommitResult => {
        const before = now, result = play(clonePlain(cmd), before);
        played.push({ command: cmd, result });
        now = result.state;
        return result;
    };

    // The crew phase: each crew member walks their route, a Move per action left.
    for (const member of state.crew) {
        for (let guard = 0; guard < world.rules.actionsPerTurn * 4; guard++) {
            const route = left[member.id], me = now.crew.find(c => c.id === member.id)!;
            if (!route?.length || me.actionsLeft < MOVE_ACTIONS) break;
            const leg = routeLeg(world, now, member.id, route);
            if (!leg.path.length) return out({ kind: 'blocked', text: `${crewLabel(now, member.id)} can't go on (${leg.reason ?? 'blocked'})`, crew: member.id, at: { ...me.pos } });
            const before = now;
            try {
                run({ type: 'move', crew: member.id, path: leg.path });
            } catch (e) {
                if (e instanceof IllegalCommand) return out({ kind: 'blocked', text: `${crewLabel(now, member.id)} can't go on (${e.message})`, crew: member.id, at: { ...me.pos } });
                throw e;
            }
            left = liveRoutes(now, left);
            const stop = interruptsOf(world, before, played.at(-1)!.result)[0];
            if (stop) return out(stop);
        }
    }
    if (!target && !sortedIds(left).length) return out({ kind: 'arrived', text: 'route walked' });

    // The world phase.
    const before = now, result = run({ type: 'endTurn' });
    turnsPlayed++;
    const reached = target ? waitReached(world, target, before, result) : null;
    // A turn waited for is a schedule event: reaching it is the target, not an interrupt.
    const stop = interruptsOf(world, before, result, { schedule: !target || (target.kind === 'turn' && !reached) })[0];
    if (stop) return out(stop);
    if (reached) return out(reached);
    if (turnsPlayed >= cap) return out({ kind: 'cap', text: `${turnsPlayed} turns gone by` });
    return out(null);
}

/** Plays auto-advance step by step until it stops (for tests and scripted runs): the last step's result, every command. */
export function autoAdvance(world: ReadonlyWorld, state: State, routes: Readonly<Routes>, options: AutoOptions = {}): AutoStepResult {
    let step = autoStep(world, state, routes, options);
    const played = [...step.played];
    for (let guard = 0; !step.stop && guard < (options.cap ?? AUTO_TURN_CAP) + 1; guard++) {
        step = autoStep(world, step.state, step.routes, { ...options, turnsPlayed: step.turnsPlayed });
        played.push(...step.played);
    }
    return { ...step, played };
}
