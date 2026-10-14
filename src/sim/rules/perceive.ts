import { registerWorldHook, type Ctx } from '../core/engine';
import { facingToward, tileAt } from '../core/grid';
import { stableJson } from '../core/json';
import { crewMember } from '../core/state';
import type {
    CrewState, DeepReadonly, DoorState, Intent, NpcState, ObserverClass, PersonDef, Pos, ReadonlyWorld, Rules, State, Zone
} from '../core/types';
import { registerEvents } from '../core/undo';
import { registerMoveHook } from '../crew/movement';
import { profileRank, type Profile } from '../data/items';
import {
    MATRIX, OBSERVER_COLUMN, OUTCOME_RANK, PERIPHERAL, UNIFORMS, type Cell, type IllegalAct, type Outcome
} from '../data/matrix';
import { bandAt, cameraObserver, fieldOn, npcObserver, type Band, type Observer } from '../geo/cones';
import { sightMap, type SightMap } from '../geo/los';
import { doorBetween, doorStatus } from '../geo/move';
import { crewLook, readProfile, type CrewLook } from './profile';
import { addSuspicion, expose, isEyesDown, isExposedTo, markSeen, refreshWant } from './suspicion';
import { challenge, hasWarned, isWarned } from './trespass';

/*
 * Perception (§8.2–8.7): who notices a crew member, and what it does about it. These are the only copies of the
 * rules: a crew move, the world phase, every later action and the safe-floor overlay (M1-09) all call the functions
 * below, the same way, so what the overlay promises is what happens (§8.8, implementation plan §2.2).
 *
 * - `reaction` is the §8.4 matrix lookup for one observer and one sighting, with every modifier: Notoriety and on edge
 *   raise the profile; a uniform turns the Staff zone into Public unless the manager or security chief sees through it
 *   in Core; frisk range; Peripheral one step weaker; a Warned crew member's second offence; cameras only `!`.
 * - `assessStep(world, state, sight, crew, tile)`: a tile passed in the middle of a move. Only `!` counts (§8.5).
 * - `assessEnd(world, state, sight, crew, tile)`: ending an action on a tile: every observer's matrix value.
 * - `sightingsAlong(world, state, sight, npc, crew, tile)`: the world phase. The NPC walks its committed intent (its
 *   standing pose, then each step facing along it, then its final facing; doors it walks through open for the rest of
 *   the walk) and adds its strongest sighting of the crew member once. `assessWorldPhase` is that for every NPC plus
 *   the cameras at the facing they pan to: the hatched overlay.
 * - `witness(world, state, sight, crew, act, tile)`: an illegal act (§8.4) is `!` for anyone who sees it, Core or
 *   Peripheral.
 *
 * All of them are pure: they take the sight map once (`sightMap(world, state)`) and read fields with `fieldOn`, return
 * structured `Sighting`s (who, from where, which cell, why) and change nothing. `applySightings` is the one place that
 * turns sightings into suspicion, exposure, challenges and camera reports. NPCs never act on them in the crew phase
 * (§6.2): they form wants (suspicion.ts) that the world phase carries out.
 *
 * **Within one move** every sighting is judged against the NPCs as they were when the move began, with the doors the
 * walk opens: the steps and the end are collected and applied together at the end, so a guard who Exposes the crew
 * member mid-move doesn't read the end tile on edge (the overlay judges every tile of a path against the same state).
 * **Within one world phase** likewise: every sighting is judged first, then all are applied.
 *
 * Seeing without effect: in a crew phase it changes nothing and isn't a perception check (the overlay showed it green,
 * so undo stays free); in the world phase it still counts as having seen the crew member, which stops decay.
 */

declare module '../core/types' {
    interface EventMap {
        /** A camera registered a `!` (§8.4, §8.12): a report for the operator (M1-08). */
        cameraSaw: { camera: string; crew: string; tile: Pos; why: string[] };
    }
}

/** Why a sighting came out as it did, for "who and why" (§8.8). */
export type Why =
    | 'onEdge' | 'notoriety' | 'uniform' | 'seenThrough' | 'friskRange' | 'outOfFriskRange' | 'peripheral' | 'secondOffence'
    | 'illegal' | 'cameraOnly';

export interface ReactionInput {
    look: CrewLook;
    notoriety: number;
    observer: ObserverClass;
    /** The NPC's role (`PersonDef.role`), for who sees through a uniform; null for a camera. */
    role: string | null;
    camera: boolean;
    alerted: boolean;
    band: Band;
    /** The seen tile's zone. */
    zone: Zone;
    /** Chebyshev distance from the observer to the seen tile (frisk range). */
    chebyshev: number;
    /** This observer warned the crew member (§8.6). */
    warnedByThis: boolean;
    /** Someone warned the crew member. */
    warnedByAny: boolean;
}

export interface Reaction {
    /** The profile as this observer reads it. */
    profile: Profile;
    /** The zone the tile reads as (Public for Staff under a staff uniform). */
    readAs: Zone;
    /** The matrix cell (Core). */
    cell: Cell;
    /** What the sighting does. */
    outcome: Outcome;
    why: Why[];
}

/** One observer's reading of one sighting (§8.4). The matrix lives in data/matrix.ts; this is its only reader. */
export function reaction(rules: DeepReadonly<Rules>, input: ReactionInput): Reaction {
    const why: Why[] = [];
    const reader: ObserverClass = input.camera ? 'enforcer' : input.observer;
    const plain = readProfile(rules, input.look, input.notoriety, reader, false);
    if (profileRank(plain) > profileRank(input.look.profile)) why.push('notoriety');
    const profile = readProfile(rules, input.look, input.notoriety, reader, input.alerted && !input.camera);
    if (profileRank(profile) > profileRank(plain)) why.push('onEdge');
    let readAs = input.zone;
    const uniform = input.look.uniform;
    if (uniform !== null) {
        const def = UNIFORMS[uniform], as = def.zoneAs[input.zone];
        if (as !== undefined) {
            if (!input.camera && input.band === 'core' && input.role !== null && def.seenThroughBy.includes(input.role)) why.push('seenThrough');
            else {
                readAs = as;
                why.push('uniform');
            }
        }
    }
    const cell = MATRIX[readAs][profile][OBSERVER_COLUMN[reader]];
    let outcome: Outcome;
    if (cell === '+1f') {
        const near = input.chebyshev <= rules.friskRange;
        outcome = near ? '+1' : '-';
        why.push(near ? 'friskRange' : 'outOfFriskRange');
    } else outcome = cell;
    if (input.band === 'peripheral') {
        const weaker = PERIPHERAL[outcome];
        if (weaker !== outcome) why.push('peripheral');
        outcome = weaker;
    }
    if (outcome === 'T' && !input.camera && (input.warnedByThis || (input.observer === 'enforcer' && input.warnedByAny))) {
        outcome = '!';
        why.push('secondOffence');
    }
    if (input.camera && outcome !== '!') {
        if (outcome !== '-') why.push('cameraOnly');
        outcome = '-';
    }
    return { profile, readAs, cell, outcome, why };
}

/** One observer seeing one crew member on one tile, and what it does: the "who and why" of the overlay. */
export interface Sighting {
    /** The NPC's or camera's id. */
    observer: string;
    by: 'npc' | 'camera';
    crew: string;
    /** Where the crew member is seen. */
    tile: Pos;
    /** Where the observer stands (on its walk, for `sightingsAlong`). */
    from: Pos;
    band: Band;
    /** The tile's zone, and the zone it reads as. */
    zone: Zone;
    readAs: Zone;
    profile: Profile;
    cell: Cell;
    outcome: Outcome;
    why: Why[];
    /** The illegal act seen, for `witness`. */
    act?: IllegalAct;
    /** The NPC already knows this crew member (Exposed): the sighting can't make it worse. */
    known: boolean;
}

export interface AssessOptions {
    /** Judge this look instead of the crew member's own (a loadout change being previewed). */
    look?: CrewLook;
}

export interface AlongOptions extends AssessOptions {
    /** Walk this intent instead of the NPC's committed one. */
    intent?: DeepReadonly<Intent>;
}

// ---------------------------------------------------------------------------------------------------------- Observers

const PEOPLE = new WeakMap<ReadonlyWorld, Map<string, DeepReadonly<PersonDef>>>();

function personOf(world: ReadonlyWorld, id: string): DeepReadonly<PersonDef> {
    let people = PEOPLE.get(world);
    if (!people) PEOPLE.set(world, people = new Map(world.people.map(p => [p.id, p])));
    const person = people.get(id);
    if (!person) throw new Error(`NPC '${id}' has no person in the world`);
    return person;
}

/** Who looks, as perception needs it. */
interface Watcher {
    id: string;
    by: 'npc' | 'camera';
    observer: ObserverClass;
    role: string | null;
    alerted: boolean;
    npc: DeepReadonly<NpcState> | null;
}

const npcWatcher = (world: ReadonlyWorld, npc: DeepReadonly<NpcState>): Watcher => {
    const person = personOf(world, npc.id);
    return { id: npc.id, by: 'npc', observer: person.observer, role: person.role, alerted: npc.alerted, npc };
};

const cameraWatcher = (id: string): Watcher => ({ id, by: 'camera', observer: 'enforcer', role: null, alerted: false, npc: null });

function sightingFrom(
    world: ReadonlyWorld, state: State, sight: SightMap, w: Watcher, pose: Observer, member: DeepReadonly<CrewState>, look: CrewLook,
    tile: Pos, act?: IllegalAct
): Sighting | null {
    const band = bandAt(fieldOn(sight, pose), tile);
    if (!band) return null;
    const zone = tileAt(world, tile)!.zone;
    const known = w.npc !== null && isExposedTo(w.npc, member.id);
    const base = { observer: w.id, by: w.by, crew: member.id, tile: { x: tile.x, y: tile.y }, from: { x: pose.pos.x, y: pose.pos.y }, band, zone, known };
    if (act !== undefined) {
        return { ...base, readAs: zone, profile: look.profile, cell: '!', outcome: '!', why: ['illegal'], act };
    }
    const r = reaction(world.rules, {
        look,
        notoriety: member.notoriety,
        observer: w.observer,
        role: w.role,
        camera: w.by === 'camera',
        alerted: w.alerted,
        band,
        zone,
        chebyshev: Math.max(Math.abs(tile.x - pose.pos.x), Math.abs(tile.y - pose.pos.y)),
        warnedByThis: w.npc !== null && hasWarned(w.npc, member.id),
        warnedByAny: isWarned(state, member.id)
    });
    return { ...base, readAs: r.readAs, profile: r.profile, cell: r.cell, outcome: r.outcome, why: r.why };
}

/** Every sighting of the crew member on `tile` by the NPCs where they stand and the cameras where they look now. */
function sightingsNow(world: ReadonlyWorld, state: State, sight: SightMap, crewId: string, tile: Pos, look: CrewLook | undefined, act?: IllegalAct): Sighting[] {
    const member = crewMember(state, crewId), seen = look ?? crewLook(member);
    const out: Sighting[] = [];
    for (const npc of state.npcs) {
        if (isEyesDown(npc)) continue;
        const pose = npcObserver(world, npc);
        if (!pose) continue;
        const s = sightingFrom(world, state, sight, npcWatcher(world, npc), pose, member, seen, tile, act);
        if (s) out.push(s);
    }
    for (const camera of world.cameras) {
        const pose = cameraObserver(world, state, camera.id);
        if (!pose) continue;
        const s = sightingFrom(world, state, sight, cameraWatcher(camera.id), pose, member, seen, tile, act);
        if (s) out.push(s);
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------- Assessing

/** A tile passed in the middle of a move (§8.5): only `!` counts. */
export function assessStep(world: ReadonlyWorld, state: State, sight: SightMap, crewId: string, tile: Pos, options: AssessOptions = {}): Sighting[] {
    return sightingsNow(world, state, sight, crewId, tile, options.look).filter(s => s.outcome === '!');
}

/** Ending an action on a tile in view (§8.5): every observer's matrix value that does something. */
export function assessEnd(world: ReadonlyWorld, state: State, sight: SightMap, crewId: string, tile: Pos, options: AssessOptions = {}): Sighting[] {
    return sightingsNow(world, state, sight, crewId, tile, options.look).filter(s => s.outcome !== '-');
}

/** An illegal act on `tile` (§8.4): `!` for every NPC that sees it, Core or Peripheral, and every camera. */
export function witness(world: ReadonlyWorld, state: State, sight: SightMap, crewId: string, act: IllegalAct, tile: Pos): Sighting[] {
    return sightingsNow(world, state, sight, crewId, tile, undefined, act);
}

interface PoseAt { pose: Observer; sight: SightMap }

const POSES = new WeakMap<SightMap, Map<string, PoseAt[]>>();
const MAX_POSES = 512;

/**
 * Where an NPC looks from while it carries out an intent: where it stands, each step facing along it, then its final
 * facing. A closed or locked door it walks through stays open for the rest of the walk (sight passes it).
 */
export function posesAlong(world: ReadonlyWorld, state: State, sight: SightMap, npc: DeepReadonly<NpcState>, intent: DeepReadonly<Intent>): readonly PoseAt[] {
    const start = npcObserver(world, npc);
    if (!start) return [];
    let cache = POSES.get(sight);
    if (!cache) POSES.set(sight, cache = new Map());
    const key = `${npc.id} ${npc.pos.x},${npc.pos.y} ${npc.facing} ${start.profile.name} ${stableJson(intent)}`;
    const known = cache.get(key);
    if (known) return known;
    const out: PoseAt[] = [{ pose: start, sight }];
    let map = sight, prev = npc.pos, facing = npc.facing;
    let opened: Record<string, DoorState> | null = null;
    for (const p of intent.path) {
        if (Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y) === 1) {
            const door = doorBetween(world, prev, p);
            const status = door && (opened && Object.hasOwn(opened, door.id) ? opened[door.id]!.status : doorStatus(world, state, door.id));
            if (door && (status === 'closed' || status === 'locked')) {
                opened = { ...(opened ?? state.doors), [door.id]: { ...state.doors[door.id], status: 'open' } };
                map = sightMap(world, { ...state, doors: opened });
            }
        }
        facing = facingToward(prev, p) ?? facing;
        out.push({ pose: { pos: { x: p.x, y: p.y }, facing, profile: start.profile }, sight: map });
        prev = p;
    }
    if (intent.facing && intent.facing !== facing) out.push({ pose: { pos: { x: prev.x, y: prev.y }, facing: intent.facing, profile: start.profile }, sight: map });
    if (cache.size >= MAX_POSES) cache.clear();
    cache.set(key, out);
    return out;
}

const stronger = (a: Sighting | null, b: Sighting | null): Sighting | null =>
    (!a ? b : !b ? a : OUTCOME_RANK[b.outcome] > OUTCOME_RANK[a.outcome] ? b : a);

/**
 * The world phase (§8.5): the NPC's strongest sighting of the crew member on `tile` while it carries out its committed
 * intent, or null if it never sees them. A sighting that does nothing (outcome '-') is still returned: it still counts
 * as seeing the crew member (no decay).
 */
export function sightingsAlong(
    world: ReadonlyWorld, state: State, sight: SightMap, npcId: string, crewId: string, tile: Pos, options: AlongOptions = {}
): Sighting | null {
    const npc = state.npcs.find(n => n.id === npcId);
    if (!npc || isEyesDown(npc)) return null;
    const member = crewMember(state, crewId), look = options.look ?? crewLook(member), w = npcWatcher(world, npc);
    let best: Sighting | null = null;
    for (const { pose, sight: map } of posesAlong(world, state, sight, npc, options.intent ?? npc.intent)) {
        best = stronger(best, sightingFrom(world, state, map, w, pose, member, look, tile));
        if (best?.outcome === '!') break;
    }
    return best;
}

/** Every sighting of the coming world phase, including those that do nothing; cameras look where they pan to (§8.3). */
function worldSightings(
    world: ReadonlyWorld, state: State, sight: SightMap, crewId: string, tile: Pos, intents: Readonly<Record<string, DeepReadonly<Intent>>> | null,
    look: CrewLook | undefined
): Sighting[] {
    const out: Sighting[] = [];
    for (const npc of state.npcs) {
        const intent = intents && Object.hasOwn(intents, npc.id) ? intents[npc.id]! : npc.intent;
        const s = sightingsAlong(world, state, sight, npc.id, crewId, tile, look ? { intent, look } : { intent });
        if (s) out.push(s);
    }
    const member = crewMember(state, crewId), seen = look ?? crewLook(member);
    for (const camera of world.cameras) {
        const pose = cameraObserver(world, state, camera.id, true);
        if (!pose) continue;
        const s = sightingFrom(world, state, sight, cameraWatcher(camera.id), pose, member, seen, tile);
        if (s && s.outcome === '!') out.push(s);
    }
    return out;
}

/** What the coming world phase does to a crew member standing on `tile` (the hatched overlay): sightings that act. */
export function assessWorldPhase(world: ReadonlyWorld, state: State, sight: SightMap, crewId: string, tile: Pos, options: AssessOptions = {}): Sighting[] {
    return worldSightings(world, state, sight, crewId, tile, null, options.look).filter(s => s.outcome !== '-');
}

// ---------------------------------------------------------------------------------------------------------- Applying

/** Turns sightings into suspicion, exposure, challenges and camera reports, in order. The only place that does. */
export function applySightings(ctx: Ctx, sightings: readonly Sighting[]): void {
    const { state } = ctx;
    for (const s of sightings) {
        if (s.by === 'camera') {
            if (s.outcome !== '!') continue;
            if (!state.cameraReports.some(r => r.camera === s.observer && r.crew === s.crew)) {
                state.cameraReports.push({ camera: s.observer, crew: s.crew, tile: { x: s.tile.x, y: s.tile.y }, turn: state.turn, phase: state.phase });
            }
            ctx.emit({ type: 'cameraSaw', camera: s.observer, crew: s.crew, tile: { x: s.tile.x, y: s.tile.y }, why: [...s.why] });
            continue;
        }
        const npc = state.npcs.find(n => n.id === s.observer);
        if (!npc || isEyesDown(npc)) continue;
        markSeen(state, npc, s.crew, s.tile);
        if (s.outcome !== '-') ctx.emit({ type: 'perceptionCheck', npc: npc.id, crew: s.crew });
        if (s.outcome === '!') expose(ctx, npc, s.crew, s.why, s.tile);
        else if (s.outcome === '+1' || s.outcome === '+2') addSuspicion(ctx, npc, s.crew, s.outcome === '+1' ? 1 : 2, s.why, s.tile);
        else if (s.outcome === 'T') challenge(ctx, npc, s.crew, s.tile);
        refreshWant(state, npc, s.crew, s.tile);
    }
}

/** A crew member ended an action where they stand (§8.5). Every action calls this after it is done (M1-07). */
export function perceiveEnd(ctx: Ctx, crewId: string): void {
    const member = crewMember(ctx.state, crewId);
    applySightings(ctx, assessEnd(ctx.world, ctx.state, sightMap(ctx.world, ctx.state), crewId, member.pos));
}

/** A crew member commits an illegal act on `tile` (their own by default): every action that is one calls this. */
export function witnessAct(ctx: Ctx, crewId: string, act: IllegalAct, tile?: Pos): void {
    const member = crewMember(ctx.state, crewId);
    applySightings(ctx, witness(ctx.world, ctx.state, sightMap(ctx.world, ctx.state), crewId, act, tile ?? member.pos));
}

// The steps of a move are judged as the mover passes them (with the doors the walk opened), and applied with the end.
const PENDING = new WeakMap<State, Sighting[]>();

registerMoveHook('perception', {
    step(ctx, member, path, index) {
        if (index === path.length - 1) return;
        const found = assessStep(ctx.world, ctx.state, sightMap(ctx.world, ctx.state), member.id, member.pos);
        if (!found.length) return;
        const pending = PENDING.get(ctx.state) ?? [];
        PENDING.set(ctx.state, [...pending, ...found]);
    },
    end(ctx, member) {
        const steps = PENDING.get(ctx.state) ?? [];
        PENDING.delete(ctx.state);
        applySightings(ctx, [...steps, ...assessEnd(ctx.world, ctx.state, sightMap(ctx.world, ctx.state), member.id, member.pos)]);
    }
});

// The world phase's sightings (§8.5): every NPC along its committed intent, judged before anyone moves, then applied.
registerWorldHook('passiveNpcs', 'perception.world', (ctx, phase) => {
    const { world, state } = ctx;
    const sight = sightMap(world, state);
    const found: Sighting[] = [];
    for (const member of state.crew) found.push(...worldSightings(world, state, sight, member.id, member.pos, phase.intents, undefined));
    applySightings(ctx, found);
}, { order: -100 });

registerEvents({ cameraSaw: { undoBlocking: true } });
