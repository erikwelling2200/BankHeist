import { commit, IllegalCommand, type CommitResult, type PreviewResult } from '../core/engine';
import { samePos } from '../core/grid';
import { clonePlain, sortedIds } from '../core/json';
import { PreviewRollError } from '../core/rng';
import type { Command, DeepReadonly, Pos, ReadonlyWorld, SimEvent, State } from '../core/types';
import { crewBudget, planMoveOptions, planningState } from '../crew/movement';
import { MOVE_ACTIONS } from '../data/movement';
import { LYING_STATUSES, validatePath } from '../geo/move';
import {
    doorDoubt, doorMayRefuse, isKnownNow, knownView, markerKind, mayLookIntoHidden, previewCertain, projectEvents, projectPreviewEvents
} from './knowledge';
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
 *   move command makes). **A Dash is never automatic**: it is noisy, and noise is a decision. Progress is counted by
 *   what was walked (the walked steps come off the front), so a route that loops or doubles back is walked as drawn.
 * - **Never an unsafe step.** Before each Move, auto-advance previews it as the player would (`safeLeg`: the preview
 *   projected through the crew's knowledge) and walks only as far as nothing the player would be warned of happens: a
 *   suspicion pip, an exposure, a challenge, a carrier, a camera sighting. Short of that it stops (`unsafe`) on the tile
 *   it would have stepped on, before committing anything. The world phase may still bring trouble; that stops it after.
 * - **A known NPC in the way**: the crew member waits a turn for them to move on, then auto-advance stops (`blocked`).
 * - **Auto-advance** (`autoStep`) plays one turn: the crew's route moves, then the end of the turn; it stops as soon as
 *   anything interrupts (a crew move's events are checked before the next command, so the player gets the rest of the
 *   crew phase to react); before the end of the turn the caller's `beforeEnd` may hold it (evidence a known NPC or
 *   camera will certainly notice in that world phase: the player gets the crew phase to deal with it). It is
 *   available only while no NPC the crew knows of is Alerted (or Hostile), the bank is neither loud nor alarmed and no
 *   alarm carrier is counting down (`autoAdvanceBlocked`).
 * - **Interrupts** (`interruptsOf`) are a pure function of the state before, the state after and the events between,
 *   judged only on what the crew can know: the events projected through its knowledge (`projectEvents`) and NPCs it
 *   sees or predicts. An NPC the crew doesn't know of can change its mind, walk or start its lunch without stopping
 *   anything; what the player isn't told can't stop the clock either (that would tell them something).
 * - **Wait for…** (`WaitTarget`) ends turns until a chosen event: a turn (the next schedule event the crew knows of),
 *   a known NPC leaving its room or the map, an absent one coming back, or a known NPC's walk crossing a tile ("until
 *   the guard passes"; a doorway is given as a tile beside it). Each is checked after every turn (`waitReached`),
 *   with `AUTO_TURN_CAP` turns at most. A wait walks no routes. While waiting, schedule events of other NPCs don't
 *   interrupt (the player chose what to wait for), nor does a civilian on the public floor coming into view; every
 *   other interrupt does. A Go counts only the schedule events of NPCs near the crew or its routes (`NEAR_TILES`).
 */

/** Each crew member's planned route by crew id: the tiles still to walk, in order, the first next to where they stand. */
export type Routes = Record<string, Pos[]>;

/** The most turns one Go or Wait for plays before it hands back to the player. */
export const AUTO_TURN_CAP = 20;

/** How near (tiles, straight line) an NPC must be to a crew member or a route tile for its schedule to stop a Go. */
export const NEAR_TILES = 12;

/** Why auto-advance stopped (or won't start). The interrupt kinds come first, in order of urgency. */
export type InterruptKind =
    | 'carrier' | 'alerted' | 'exposed' | 'challenge' | 'jam' | 'moveCut' | 'suspicion' | 'intent' | 'evidence' | 'revealed' | 'arrival' | 'schedule';

export type StopKind = InterruptKind | 'unavailable' | 'arrived' | 'blocked' | 'unsafe' | 'target' | 'lost' | 'cap' | 'cancelled';

/** A reason to stop: its kind, a line for the player ("the cleaner turned toward Jun"), and who and where, if anyone. */
export interface AutoStop {
    kind: StopKind;
    text: string;
    npc?: string;
    crew?: string;
    at?: Pos;
}

export type Interrupt = AutoStop & { kind: InterruptKind };

const URGENCY: readonly InterruptKind[] = ['carrier', 'alerted', 'exposed', 'challenge', 'jam', 'moveCut', 'suspicion', 'intent', 'evidence', 'revealed', 'arrival', 'schedule'];

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
        if ((npc.status === 'alerted' || npc.status === 'panicked' || npc.status === 'hostile') && isKnownNow(world, state, npc.id)) return `${capital(npcLabel(world, npc.id))} is alerted`;
    }
    return null;
}

// ---------------------------------------------------------------------------------------------------------- Routes

/**
 * The longest start of `route` one Move can walk from `from` (on the crew's picture, with the Move's budget and the
 * move command's own path check), or an empty list when not even its first step can be taken; `reason` says why.
 */
export function routeLeg(world: ReadonlyWorld, state: State, crewId: string, route: readonly Pos[], from?: Pos): { path: Pos[]; reason?: string } {
    const member = state.crew.find(c => c.id === crewId);
    if (!member || !route.length) return { path: [], reason: member ? 'No route' : `No crew member '${crewId}'` };
    const picture = onFloor(planningState(world, state)), start = from ?? member.pos;
    const budget = crewBudget(world, member, 'move'), options = planMoveOptions(world, state, member);
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

/** Events a preview warns the player of (§8.8): a step that would cause one is never taken automatically. */
const UNSAFE_EVENTS: ReadonlySet<string> = new Set(['suspicionRaised', 'exposed', 'challenged', 'carrierStarted', 'cameraSaw']);

/** Why a previewed command is unsafe, from what the player's preview of it shows, or null. */
export function previewDanger(world: ReadonlyWorld, before: State, cmd: Command): { stop: string } | null {
    let events: SimEvent[];
    try {
        events = projectPreviewEvents(world, before, previewCertain(world, before, cmd));
    } catch (e) {
        if (e instanceof IllegalCommand || e instanceof PreviewRollError) return { stop: e.message };
        throw e;
    }
    const bad = events.find(e => UNSAFE_EVENTS.has(e.type));
    if (!bad) return null;
    const who = (e: SimEvent): string => {
        const f = e as unknown as { npc?: string; crew?: string };
        return f.npc ? npcLabel(world, f.npc) : 'someone';
    };
    switch (bad.type) {
        case 'suspicionRaised': return { stop: `${who(bad)} would grow suspicious` };
        case 'exposed': return { stop: `${who(bad)} would make ${crewLabel(before, bad.crew)}` };
        case 'challenged': return { stop: `${who(bad)} would challenge ${crewLabel(before, bad.crew)}` };
        case 'carrierStarted': return { stop: 'it would start an alarm' };
        case 'cameraSaw': return { stop: 'a camera would see it' };
        default: return { stop: 'it would be seen' };
    }
}

/**
 * The part of a Move along `leg` auto-advance may take: its longest start before the first step whose preview warns of
 * anything (`previewDanger`). `unsafeAt` is that step's tile, with why. Each start is previewed from `state` as a Move
 * of its own, as the player would preview it.
 */
export function safeLeg(world: ReadonlyWorld, state: State, crewId: string, leg: readonly Pos[]): { path: Pos[]; unsafeAt?: Pos; why?: string } {
    for (let n = 1; n <= leg.length; n++) {
        const danger = previewDanger(world, state, { type: 'move', crew: crewId, path: leg.slice(0, n).map(p => ({ x: p.x, y: p.y })) });
        // A start that ends on someone (walked past by a longer one) isn't a Move of its own: judge the longer one.
        if (danger && /already on/.test(danger.stop)) continue;
        if (danger) return { path: leg.slice(0, n - 1).map(p => ({ x: p.x, y: p.y })), unsafeAt: { x: leg[n - 1]!.x, y: leg[n - 1]!.y }, why: danger.stop };
    }
    return { path: leg.map(p => ({ x: p.x, y: p.y })) };
}

/** One turn's share of a planned route: the Moves it is walked in, and the turn they are played in. */
export interface RouteLeg { turn: number; path: Pos[] }

/**
 * How a route would be walked as things stand: Move by Move, two to a turn (this turn only as many as the crew member
 * has actions left), each as far as its budget reaches on the crew's picture. `walkable` is how many of the route's
 * tiles the legs cover; the rest can't be planned now (a wall, a locked door, someone in the way).
 */
export function planRoute(world: ReadonlyWorld, state: State, crewId: string, route: readonly Pos[], options: { safety?: boolean } = {}):
    { legs: RouteLeg[]; walkable: number; unsafe: Pos[] } {
    const member = state.crew.find(c => c.id === crewId);
    const legs: RouteLeg[] = [], unsafe: Pos[] = [];
    if (!member) return { legs, walkable: 0, unsafe };
    let at: Pos = member.pos, left = route.map(p => ({ x: p.x, y: p.y })), walked = 0;
    let turn = state.turn, actions = member.actionsLeft;
    // This turn's Moves can be previewed (the next turns' can't: the NPCs will have moved): their unsafe tiles are marked,
    // each Move from where the player's preview of the one before leaves it (`nextLegState`), until that can't be told.
    let previewState: State | null = options.safety ? state : null;
    for (let guard = 0; left.length && guard < AUTO_TURN_CAP * world.rules.actionsPerTurn + 2; guard++) {
        if (actions < MOVE_ACTIONS) {
            turn++;
            actions = world.rules.actionsPerTurn;
            continue;
        }
        const leg = routeLeg(world, state, crewId, left, at);
        if (!leg.path.length) break;
        legs.push({ turn, path: leg.path });
        if (previewState && turn === state.turn) {
            const safe = safeLeg(world, previewState, crewId, leg.path);
            if (safe.unsafeAt) {
                unsafe.push(...leg.path.slice(safe.path.length));
                previewState = null;
            } else previewState = nextLegState(world, state, previewState, crewId, leg.path);
        } else if (turn !== state.turn) previewState = null;
        walked += leg.path.length;
        at = leg.path.at(-1)!;
        left = left.slice(leg.path.length);
        actions -= MOVE_ACTIONS;
    }
    return { legs, walkable: walked, unsafe };
}

/**
 * The state the Move after `leg` is previewed from, as the player's preview of `leg` pictures it (decision 44): its
 * certain preview (`previewCertain`), with what the crew knew before the route (`start`'s knowledge: what the walk would
 * show isn't known yet) and the mover on the leg's last tile (a move cut short by someone unknown shows along its drawn
 * path). Null when what comes after can't be told: the preview shows the move cut short (a known NPC in the way), a door
 * the crew can't vouch for could refuse it (`doorMayRefuse`), or it could look into hidden tiles (something new could
 * come into view, `mayLookIntoHidden`).
 */
function nextLegState(world: ReadonlyWorld, start: State, from: State, crewId: string, leg: readonly Pos[]): State | null {
    const member = from.crew.find(c => c.id === crewId), doubt = doorDoubt(world, from);
    if (!member || !leg.length || mayLookIntoHidden(world, start, leg)) return null;
    let prev: Pos = member.pos;
    for (const p of leg) {
        if (doorMayRefuse(world, doubt, member, prev, p)) return null;
        prev = p;
    }
    const cmd: Command = { type: 'move', crew: crewId, path: leg.map(p => ({ x: p.x, y: p.y })) };
    let result: PreviewResult;
    try {
        result = previewCertain(world, from, cmd);
    } catch (e) {
        if (e instanceof IllegalCommand || e instanceof PreviewRollError) return null;
        throw e;
    }
    if (projectPreviewEvents(world, from, result).some(e => e.type === 'moveCut')) return null;
    const end = leg.at(-1)!;
    const crew = result.state.crew.map(c => (c.id === crewId && !samePos(c.pos, end) ? { ...c, pos: { x: end.x, y: end.y } } : c));
    return { ...result.state, crew, knowledge: start.knowledge };
}

/** The first step of `path` that can't be part of a route at all (a wall, a locked door, off the map), or -1. */
export function routeBreak(world: ReadonlyWorld, state: State, crewId: string, path: readonly Pos[]): number {
    const member = state.crew.find(c => c.id === crewId);
    if (!member || !path.length) return 0;
    // Only the crew's tile counts as somewhere to step from; the budget is the whole route's.
    // NPCs move every turn: only the bank itself (walls, locked doors, furniture) breaks a route.
    const picture = { ...onFloor(planningState(world, state)), npcs: [] };
    const check = validatePath(world, picture, member.pos, path, Number.MAX_SAFE_INTEGER, planMoveOptions(world, state, member));
    if (check.ok) return -1;
    return /already on/.test(check.reason) ? -1 : check.at;
}

// ---------------------------------------------------------------------------------------------------------- Interrupts

export interface InterruptOptions {
    /** Whether a known NPC's schedule event stops it (default true; a Wait for that isn't for a turn passes false). */
    schedule?: boolean;
    /** Only schedule events of NPCs within `NEAR_TILES` of one of these tiles (or in a room with one) count (a Go: the crew and its routes). */
    near?: readonly Pos[];
    /** A civilian on the public floor coming into view isn't news (a Wait). */
    quietCivilians?: boolean;
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
    // Where the crew knows an NPC to be (last seen or predicted), never where it is.
    const npcPos = (id: string): Pos | undefined => {
        const rec = Object.hasOwn(after.knowledge.npcs, id) ? after.knowledge.npcs[id]! : undefined;
        return rec ? { x: rec.at.x, y: rec.at.y } : undefined;
    };
    const who = (id: string): string => npcLabel(world, id), crew = (id: string): string => crewLabel(after, id);
    const at = (id: string): { at?: Pos } => {
        const p = npcPos(id);
        return p ? { at: p } : {};
    };
    for (const e of shown) {
        switch (e.type) {
            case 'carrierStarted':
                add({ kind: 'carrier', text: `an alarm is being raised (${e.countdown} turns)`, ...(e.holder ? { npc: e.holder } : {}), ...(e.pos ? { at: { x: e.pos.x, y: e.pos.y } } : {}) });
                break;
            case 'alerted': add({ kind: 'alerted', text: `${who(e.npc)} is alerted`, npc: e.npc, ...at(e.npc) }); break;
            case 'npcStatus':
                if (e.status === 'alerted' || e.status === 'panicked' || e.status === 'hostile') add({ kind: 'alerted', text: `${who(e.npc)} is alerted`, npc: e.npc, ...at(e.npc) });
                break;
            case 'exposed': add({ kind: 'exposed', text: `${who(e.npc)} made ${crew(e.crew)}`, npc: e.npc, crew: e.crew, ...at(e.npc) }); break;
            case 'challenged': add({ kind: 'challenge', text: `${who(e.npc)} challenged ${crew(e.crew)}`, npc: e.npc, crew: e.crew, ...at(e.npc) }); break;
            case 'moveCut':
                if (e.reason === 'bump') add({ kind: 'moveCut', npc: e.npc, crew: e.crew, at: { x: e.at.x, y: e.at.y }, text: `${crew(e.crew)} ran into ${who(e.npc)}` });
                else add({ kind: 'moveCut', crew: e.crew, at: { x: e.at.x, y: e.at.y }, text: `${crew(e.crew)} found a door ${e.status}` });
                break;
            case 'suspicionRaised': add({ kind: 'suspicion', text: `${who(e.npc)} grew suspicious of ${crew(e.crew)}`, npc: e.npc, crew: e.crew, ...at(e.npc) }); break;
            case 'drillJammed': {
                // A jammed drill stands still until someone fixes it (§15.3): a Wait mustn't sit on it for turns.
                const device = after.devices.find(d => d.id === e.device);
                add({ kind: 'jam', text: 'the drill jammed', ...(device ? { at: { x: device.pos.x, y: device.pos.y } } : {}) });
                break;
            }
            case 'cameraSaw': add({ kind: 'suspicion', text: `a camera saw ${crew(e.crew)}`, crew: e.crew, at: { x: e.tile.x, y: e.tile.y } }); break;
            case 'evidenceNoticed': add({ kind: 'evidence', text: `${who(e.npc)} noticed something`, npc: e.npc, ...at(e.npc) }); break;
            case 'cameraSawEvidence': add({ kind: 'evidence', text: 'a camera caught something', at: { x: e.tile.x, y: e.tile.y } }); break;
            case 'revealed':
                if (e.what === 'npc' && markerKind(world, before, e.id) === null && !(options.quietCivilians && publicCivilian(world, after, e.id))) {
                    add({ kind: 'revealed', text: `spotted ${who(e.id)}`, npc: e.id, ...at(e.id) });
                }
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
        // One the crew didn't see or predict before (unknown, or a ghost) shows its intent anew.
        const fresh = !isKnownNow(world, before, npc.id);
        if (!goal || (!fresh && old && old.kind === goal.kind && old.crew === goal.crew && old.evidence === goal.evidence)) continue;
        if (fresh && !goal.crew) continue;
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
            if (options.near && !nearAny(world, after.knowledge.npcs[id]?.at ?? before.knowledge.npcs[id]!.at, options.near)) continue;
            add({ kind: 'schedule', text: `${who(id)}: ${person.schedule[to]!.label}`, npc: id, ...at(id) });
        }
    }
    return out.sort((a, b) => URGENCY.indexOf(a.kind) - URGENCY.indexOf(b.kind));
}

/** Whether `p` is within `NEAR_TILES` of any of `tiles`, or in the same room as one. */
function nearAny(world: ReadonlyWorld, p: Pos, tiles: readonly Pos[]): boolean {
    const room = roomAt(world, p);
    return tiles.some(t => {
        const dx = t.x - p.x, dy = t.y - p.y;
        return dx * dx + dy * dy <= NEAR_TILES * NEAR_TILES || (room !== null && roomAt(world, t) === room);
    });
}

/** A civilian the crew knows to stand on the public floor (a customer coming in is no news while waiting). */
function publicCivilian(world: ReadonlyWorld, state: State, id: string): boolean {
    const person = world.people.find(p => p.id === id), rec = Object.hasOwn(state.knowledge.npcs, id) ? state.knowledge.npcs[id]! : undefined;
    return !!person && person.observer === 'civilian' && !!rec && world.tiles[rec.at.y * world.width + rec.at.x]?.zone === 'public';
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
            // Last seen out of the room counts, even if it is out of sight now.
            if (pos && roomAt(world, pos) !== target.room) return done(pos);
            if (!known) return { kind: 'lost', text: `lost track of ${npcLabel(world, npc.id)}`, npc: npc.id, ...(pos ? { at: pos } : {}) };
            // A predicted NPC is where its routine has it, so whether it is on the map is what the crew predicts too.
            if (!isPresent(npc)) return done(pos);
            return null;
        }
        case 'arrives': {
            if (shown.some(e => e.type === 'npcEntered' && e.npc === npc.id)) return done(pos);
            return known && isPresent(npc) ? done(pos) : null;
        }
        case 'passes': {
            // Only a crossing the crew could see: the tile in view, or the NPC in view.
            const seeable = kind === 'live' || knownView(world, after).inView[target.tile.y * world.width + target.tile.x] === 1;
            const crossed = seeable && shown.some(e => e.type === 'npcWalked' && e.npc === npc.id && e.path.some(p => samePos(p, target.tile)));
            if (crossed || (known && pos && samePos(pos, target.tile))) return done(pos);
            if (!known) return { kind: 'lost', text: `lost track of ${npcLabel(world, npc.id)}`, npc: npc.id, ...(pos ? { at: pos } : {}) };
            return null;
        }
    }
}

// ---------------------------------------------------------------------------------------------------------- Playing

export interface AutoOptions {
    /** A "Wait for…" target; without one, auto-advance runs until the routes are walked. A wait walks no routes. */
    target?: WaitTarget | null;
    /** Turns this run has played so far (the cap counts from the first). */
    turnsPlayed?: number;
    /** The most turns a run plays (default `AUTO_TURN_CAP`). */
    cap?: number;
    /** Crew members who waited a turn for a known NPC in their way (from the last step's result). */
    waiting?: readonly string[];
    /**
     * Plays a command on `state` (the state the run is at): the engine's `commit` by default. The Session passes its own
     * commit, so every command is autosaved, queued for playback and logged like one the player gave. `routes` are the
     * routes as they will be once it has been played as planned (for the autosave).
     */
    play?: (cmd: Command, state: State, routes: Routes) => CommitResult;
    /**
     * Asked on the state the turn would end from, before the end of the turn: a stop keeps it from ending (the Session's
     * evidence a known NPC or camera will certainly notice in that world phase, src/game/evidenceWarning.ts).
     */
    beforeEnd?: (state: State) => AutoStop | null;
}

export interface AutoStepResult {
    state: State;
    /** The routes left to walk. */
    routes: Routes;
    /** Every command played, with what it did, in order. */
    played: { command: Command; result: CommitResult }[];
    /** Turns the run has played, this one included. */
    turnsPlayed: number;
    /** Crew members waiting a turn for a known NPC in their way: pass back as `waiting`. */
    waiting: string[];
    /** Why to stop, or null to carry on with another step. */
    stop: AutoStop | null;
}

/** The routes of crew members in the state, empty ones dropped, copied. */
function liveRoutes(state: State, routes: Readonly<Routes>): Routes {
    const out: Routes = {};
    for (const id of sortedIds(routes)) {
        if (!state.crew.some(c => c.id === id) || !routes[id]!.length) continue;
        out[id] = routes[id]!.map(p => ({ x: p.x, y: p.y }));
    }
    return out;
}

/** The routes with `walked` steps of `crew`'s taken off the front. */
function advance(routes: Readonly<Routes>, crew: string, walked: number): Routes {
    const out: Routes = { ...routes };
    const left = (routes[crew] ?? []).slice(walked);
    if (left.length) out[crew] = left;
    else delete out[crew];
    return out;
}

/** How far a committed move went: the steps of its `moved` event (fewer than planned when it was cut short). */
const stepsWalked = (result: CommitResult, crew: string): number => {
    const moved = result.events.find(e => e.type === 'moved' && e.crew === crew);
    return moved && moved.type === 'moved' ? moved.path.length : 0;
};

/** A known NPC (seen or predicted) stands in the way: worth waiting a turn for. */
const npcInTheWay = (reason: string | undefined): boolean => !!reason && /^Someone (stands|is already) on/.test(reason);

/**
 * Plays one turn of auto-advance from `state`: every crew member with a route walks it (Moves only, in crew order,
 * never an unsafe step), then the turn ends. Stops before the end of the turn if a move is interrupted, unsafe or
 * blocked, or when no route is left to walk and nothing is being waited for (`arrived`); stops after it on an
 * interrupt, a reached target, or the cap.
 */
export function autoStep(world: ReadonlyWorld, state: State, routes: Readonly<Routes>, options: AutoOptions = {}): AutoStepResult {
    const play = options.play ?? ((cmd: Command, s: State) => commit(world, s, cmd));
    const target = options.target ?? null, cap = options.cap ?? AUTO_TURN_CAP;
    let turnsPlayed = options.turnsPlayed ?? 0, now = state, left = liveRoutes(state, routes);
    const waited = new Set(options.waiting ?? []), waiting: string[] = [];
    const played: AutoStepResult['played'] = [];
    const out = (stop: AutoStop | null): AutoStepResult => ({ state: now, routes: liveRoutes(now, left), played, turnsPlayed, waiting, stop });
    const unavailable = autoAdvanceBlocked(world, now);
    if (unavailable) return out({ kind: 'unavailable', text: unavailable.charAt(0).toLowerCase() + unavailable.slice(1) });
    const run = (cmd: Command, routesAfter: Routes): CommitResult => {
        const before = now, result = play(clonePlain(cmd), before, liveRoutes(before, routesAfter));
        played.push({ command: cmd, result });
        now = result.state;
        return result;
    };
    const blocked = (crew: string, why: string, at: Pos): AutoStepResult => out({ kind: 'blocked', text: `${crewLabel(now, crew)} can't go on (${why})`, crew, at: { ...at } });

    // The crew phase (not while waiting for something): each crew member walks their route, a Move per action left.
    for (const member of target ? [] : state.crew) {
        for (let guard = 0; guard < world.rules.actionsPerTurn * 4; guard++) {
            const route = left[member.id], me = now.crew.find(c => c.id === member.id)!;
            if (!route?.length || me.actionsLeft < MOVE_ACTIONS) break;
            const leg = routeLeg(world, now, member.id, route);
            if (!leg.path.length) {
                // Someone the crew knows of stands in the way: they will likely move on; give them a turn.
                if (npcInTheWay(leg.reason) && !waited.has(member.id)) { waiting.push(member.id); break; }
                return blocked(member.id, leg.reason ?? 'blocked', me.pos);
            }
            const safe = safeLeg(world, now, member.id, leg.path);
            const before = now;
            if (safe.path.length) {
                try {
                    run({ type: 'move', crew: member.id, path: safe.path }, advance(left, member.id, safe.path.length));
                } catch (e) {
                    if (e instanceof IllegalCommand) return blocked(member.id, e.message, me.pos);
                    throw e;
                }
                left = advance(left, member.id, stepsWalked(played.at(-1)!.result, member.id));
                const stop = interruptsOf(world, before, played.at(-1)!.result)[0];
                if (stop) return out(stop);
            }
            if (safe.unsafeAt) return out({ kind: 'unsafe', text: `${crewLabel(now, member.id)} stopped: ${safe.why ?? 'the next step is unsafe'}`, crew: member.id, at: safe.unsafeAt });
        }
    }
    if (!target && !sortedIds(left).length) return out({ kind: 'arrived', text: 'route walked' });

    // The world phase, unless something the player would be warned of happens in it for certain.
    const held = options.beforeEnd?.(now);
    if (held) return out(held);
    const before = now, result = run({ type: 'endTurn' }, left);
    turnsPlayed++;
    const reached = target ? waitReached(world, target, before, result) : null;
    // A turn waited for is a schedule event: reaching it is the target, not an interrupt. A Go counts only schedule
    // events near the crew and the routes.
    const near = [...now.crew.map(c => c.pos), ...sortedIds(left).flatMap(id => left[id]!)];
    const stop = interruptsOf(world, before, result, {
        schedule: !target || (target.kind === 'turn' && !reached), ...(target ? { quietCivilians: true } : { near })
    })[0];
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
        step = autoStep(world, step.state, step.routes, { ...options, turnsPlayed: step.turnsPlayed, waiting: step.waiting });
        played.push(...step.played);
    }
    return { ...step, played };
}
