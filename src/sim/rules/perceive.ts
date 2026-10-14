import { registerWorldHook, type Ctx } from '../core/engine';
import { facingToward, tileAt } from '../core/grid';
import { clonePlain, samePlain } from '../core/json';
import { Dice } from '../core/rng';
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
import { bandAt, cameraObserver, fieldOn, npcObserver, type Band, type Observer, type SightField } from '../geo/cones';
import { sightMap, type SightMap } from '../geo/los';
import { doorBetween, doorStatus } from '../geo/move';
import { npcActSightings } from './npc/act';
import { placeCrew } from './place';
import { reconsider } from './npc/intent';
import { worldWalks } from './npc/walk';
import { crewLook, readProfile, type CrewLook } from './profile';
import { addSuspicion, expose, isEyesDown, isExposedTo, markSeen, refreshWant } from './suspicion';
import { challenge, deadlineOutcome, hasWarned, isWarned } from './trespass';

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
 * - `assessPath(world, state, crew, path)`: a whole move: `assessStep` on the tiles it passes and `assessEnd` on the
 *   last, with the doors the walk opens (`sightsAlongWalk`). The move applies exactly this.
 * - `sightingsAlong(world, state, sight, npc, crew, tile)`: the world phase. The NPC walks its committed intent (its
 *   standing pose, then each step facing along it, then its final facing; doors it walks through open for the rest of
 *   the walk) and adds its strongest sighting of the crew member once. `assessWorldPhase` is that for every NPC plus
 *   the cameras at the facing they pan to (M1-08 must pan them exactly one step per world phase), plus a trespass
 *   deadline falling due (`deadlineOutcome`): the hatched overlay. `worldPoses` works out every walk once for many
 *   tiles.
 * - `witness(world, state, sight, crew, act, tile)`: an illegal act (§8.4) is `!` for anyone who sees it, Core or
 *   Peripheral.
 *
 * All of them are pure: they take the sight map once (`sightMap(world, state)`) and read fields with `fieldOn`, return
 * structured `Sighting`s (who, from where, which cell, why) and change nothing. `applySightings` is the one place that
 * turns sightings into suspicion, exposure, challenges and camera reports. NPCs never act on them in the crew phase
 * (§6.2): they form wants (suspicion.ts) that the world phase carries out; in a crew phase the NPCs whose wants changed
 * commit their new intent at once (npc/intent.ts `reconsider`), so it is telegraphed before the world phase.
 *
 * **Within one move** every sighting is judged against the state before the move, with the doors the walk opens
 * (`assessPath`), and applied together at the end, so a guard who Exposes the crew member mid-move doesn't read the
 * end tile on edge: the overlay judges every tile of a path against the same state.
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
    | 'illegal' | 'cameraOnly' | 'trespass' | 'frisk' | 'told';

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
    // An illegal act seen on them (dragging a body): `!` for anyone, in any zone, Core and Peripheral (§8.4).
    if (input.look.act !== undefined) return { profile: input.look.profile, readAs: input.zone, cell: '!', outcome: '!', why: ['illegal'] };
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
    // Not for cameras: they register only `!` cells (§8.4), and the operator doesn't know who was warned.
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
    /** How well it is seen; null when it isn't (a trespass deadline Exposes whoever didn't leave, seen or not). */
    band: Band | null;
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
    /** The walks worked out once (`worldPoses`); used unless `intent` is given. */
    poses?: WorldPoses;
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
    tile: Pos, act?: IllegalAct, field?: SightField
): Sighting | null {
    const band = bandAt(field ?? fieldOn(sight, pose), tile);
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

/** Where an NPC looks from at one moment of its walk, the sight map then (with the doors it opened so far) and what it sees. */
export interface PoseAt { pose: Observer; sight: SightMap; field: SightField }

/**
 * The sight map after each step of a walk from `from` along `path`: a closed or locked door the walker crosses is open
 * from that step on (whoever walks through a door opens it). Only the walker's own doors: in the world phase each
 * NPC's walk is judged with the doors *it* opens, never another NPC's (they walk at once, and nobody's sightings may
 * depend on the order). The one copy of this rule, for crew moves (`assessPath`) and NPC walks (`posesAlong`).
 */
export function sightsAlongWalk(world: ReadonlyWorld, state: State, sight: SightMap, from: DeepReadonly<Pos>, path: readonly DeepReadonly<Pos>[]): SightMap[] {
    const out: SightMap[] = [];
    let map = sight, prev: DeepReadonly<Pos> = from;
    let opened: Record<string, DoorState> | null = null;
    for (const p of path) {
        if (Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y) === 1) {
            const door = doorBetween(world, prev, p);
            if (door) {
                const status = opened && Object.hasOwn(opened, door.id) ? opened[door.id]!.status : doorStatus(world, state, door.id);
                if (status === 'closed' || status === 'locked') {
                    opened = { ...(opened ?? state.doors), [door.id]: { ...state.doors[door.id], status: 'open' } };
                    map = sightMap(world, { ...state, doors: opened });
                }
            }
        }
        out.push(map);
        prev = p;
    }
    return out;
}

/** Where an NPC looks from while it carries out an intent: where it stands, each step facing along it, then its final facing. */
export function posesAlong(world: ReadonlyWorld, state: State, sight: SightMap, npc: DeepReadonly<NpcState>, intent: DeepReadonly<Intent>): PoseAt[] {
    const start = npcObserver(world, npc);
    if (!start) return [];
    const at = (pose: Observer, map: SightMap): PoseAt => ({ pose, sight: map, field: fieldOn(map, pose) });
    const out: PoseAt[] = [at(start, sight)];
    const maps = sightsAlongWalk(world, state, sight, npc.pos, intent.path);
    let prev: DeepReadonly<Pos> = npc.pos, facing = npc.facing, map = sight;
    intent.path.forEach((p, i) => {
        facing = facingToward(prev, p) ?? facing;
        map = maps[i]!;
        out.push(at({ pos: { x: p.x, y: p.y }, facing, profile: start.profile }, map));
        prev = p;
    });
    if (intent.facing && intent.facing !== facing) out.push(at({ pos: { x: prev.x, y: prev.y }, facing: intent.facing, profile: start.profile }, map));
    return out;
}

/**
 * Every NPC's walk through the coming world phase, worked out once per evaluation: the overlay asks about hundreds of
 * tiles against the same walks, so it takes this once (per state and sight map) and passes it in. Eyes-down NPCs have
 * no walk to look from. The walks are as they will be carried out (npc/walk.ts `worldWalks`): an NPC a crew member
 * stands in front of, or a door locked since, stops there and looks only from where it gets to.
 */
export interface WorldPoses {
    readonly sight: SightMap;
    readonly byNpc: ReadonlyMap<string, readonly PoseAt[]>;
    /** The intents as walked, by NPC. */
    readonly walked: Readonly<Record<string, DeepReadonly<Intent>>>;
    /** Every tile on a committed path, by index: only a crew member on one of them can change a walk. */
    readonly paths: ReadonlySet<number>;
}

/**
 * Every NPC's poses for the coming world phase, along its committed intent (`intents`, default `npc.intent`) as it will
 * be walked, with the crew where they stand.
 */
export function worldPoses(
    world: ReadonlyWorld, state: State, sight: SightMap, intents: Readonly<Record<string, DeepReadonly<Intent>>> | null = null,
    passive: readonly string[] | null = null
): WorldPoses {
    const { walked } = worldWalks(world, state, intents, passive);
    const byNpc = new Map<string, readonly PoseAt[]>(), paths = new Set<number>();
    for (const npc of state.npcs) {
        const intent = intents && Object.hasOwn(intents, npc.id) ? intents[npc.id]! : npc.intent;
        for (const p of intent.path) paths.add(p.y * world.width + p.x);
        if (isEyesDown(npc)) continue;
        byNpc.set(npc.id, posesAlong(world, state, sight, npc, walked[npc.id]!));
    }
    return { sight, byNpc, walked, paths };
}

/** The poses with one crew member moved onto `tile`: only the walks that changes are worked out again. */
function posesWith(world: ReadonlyWorld, state: State, poses: WorldPoses, crewId: string, tile: Pos): WorldPoses {
    const member = crewMember(state, crewId);
    const at = (p: DeepReadonly<Pos>): number => p.y * world.width + p.x;
    if ((member.pos.x === tile.x && member.pos.y === tile.y) || (!poses.paths.has(at(tile)) && !poses.paths.has(at(member.pos)))) return poses;
    const { walked } = worldWalks(world, state, null, null, { crew: crewId, tile });
    const byNpc = new Map(poses.byNpc);
    for (const npc of state.npcs) {
        if (isEyesDown(npc) || samePlain(walked[npc.id], poses.walked[npc.id])) continue;
        byNpc.set(npc.id, posesAlong(world, state, poses.sight, npc, walked[npc.id]!));
    }
    return { sight: poses.sight, byNpc, walked, paths: poses.paths };
}

const stronger = (a: Sighting | null, b: Sighting | null): Sighting | null =>
    (!a ? b : !b ? a : OUTCOME_RANK[b.outcome] > OUTCOME_RANK[a.outcome] ? b : a);

function strongestAlong(
    world: ReadonlyWorld, state: State, w: Watcher, poses: readonly PoseAt[], member: DeepReadonly<CrewState>, look: CrewLook, tile: Pos
): Sighting | null {
    let best: Sighting | null = null;
    for (const { pose, sight: map, field } of poses) {
        if (!bandAt(field, tile)) continue;
        best = stronger(best, sightingFrom(world, state, map, w, pose, member, look, tile, undefined, field));
        if (best?.outcome === '!') break;
    }
    return best;
}

/**
 * The world phase (§8.5): the NPC's strongest sighting of the crew member on `tile` while it carries out its committed
 * intent, or null if it never sees them. A sighting that does nothing (outcome '-') is still returned: it still counts
 * as seeing the crew member (no decay). Pass `poses` (from `worldPoses` on the same state and sight map) when asking
 * about many tiles.
 */
export function sightingsAlong(
    world: ReadonlyWorld, state: State, sight: SightMap, npcId: string, crewId: string, tile: Pos, options: AlongOptions = {}
): Sighting | null {
    const npc = state.npcs.find(n => n.id === npcId);
    if (!npc || isEyesDown(npc)) return null;
    const member = crewMember(state, crewId), look = options.look ?? crewLook(member);
    const poses = options.intent === undefined && options.poses?.sight === sight ? options.poses.byNpc.get(npcId) ?? []
        : posesAlong(world, state, sight, npc, options.intent ?? npc.intent);
    return strongestAlong(world, state, npcWatcher(world, npc), poses, member, look, tile);
}

/** Every sighting of the coming world phase, including those that do nothing; cameras look where they pan to (§8.3). */
function worldSightings(world: ReadonlyWorld, state: State, poses: WorldPoses, crewId: string, tile: Pos, look: CrewLook | undefined): Sighting[] {
    const out: Sighting[] = [];
    const member = crewMember(state, crewId), seen = look ?? crewLook(member);
    for (const npc of state.npcs) {
        const walk = poses.byNpc.get(npc.id);
        if (!walk) continue;
        const s = strongestAlong(world, state, npcWatcher(world, npc), walk, member, seen, tile);
        if (s) out.push(s);
    }
    for (const camera of world.cameras) {
        const pose = cameraObserver(world, state, camera.id, true);
        if (!pose) continue;
        const s = sightingFrom(world, state, poses.sight, cameraWatcher(camera.id), pose, member, seen, tile);
        if (s && s.outcome === '!') out.push(s);
    }
    return out;
}

export interface WorldPhaseOptions extends AssessOptions {
    /** The NPCs' walks, from `worldPoses` on the same state and sight map: work them out once for many tiles. */
    poses?: WorldPoses;
}

/**
 * What the coming world phase does to a crew member standing on `tile` (the hatched overlay), had they just moved there:
 * when ending the move there is itself seen, that is applied first (to a copy) with the intents it rewrites. Then the
 * sightings that act, along the walks as they will be taken with the crew member on `tile`,
 * then the trespass deadline if one falls due (`deadlineOutcome`, trespass.ts, which the deadline hook uses too), then
 * what the NPCs' committed actions do at the end of their walks (a frisk, a guard told: `npcActSightings`, npc/act.ts,
 * the same walks the act step takes).
 */
export function assessWorldPhase(world: ReadonlyWorld, state: State, sight: SightMap, crewId: string, tile: Pos, options: WorldPhaseOptions = {}): Sighting[] {
    const member = crewMember(state, crewId);
    if (member.pos.x !== tile.x || member.pos.y !== tile.y) {
        // Ending a move there is seen first, and what that makes NPCs want rewrites their intents at once (§6.2):
        // the world phase that follows is judged on that state.
        const end = assessEnd(world, state, sight, crewId, tile, options);
        if (end.length) {
            // The crew member (and any body they drag) on the tile, on a copy.
            const scratch = clonePlain(placeCrew(state, crewId, tile));
            applySightings({ world, state: scratch, dice: new Dice(scratch, 'preview'), emit: () => {} }, end);
            return assessWorldPhase(world, scratch, sightMap(world, scratch), crewId, tile, options.look ? { look: options.look } : {});
        }
    }
    const base = options.poses?.sight === sight ? options.poses : worldPoses(world, state, sight);
    const poses = posesWith(world, state, base, crewId, tile);
    const out = worldSightings(world, state, poses, crewId, tile, options.look).filter(s => s.outcome !== '-');
    const deadline = deadlineOutcome(world, state, crewId, tile, options.look);
    if (deadline) out.push(deadline);
    out.push(...npcActSightings(world, state, crewId, tile, options.look));
    return out;
}

/** What a move does (§8.5): the `!`s of the tiles it passes and every observer's value at its end. */
export interface PathAssessment { steps: Sighting[]; end: Sighting[] }

/**
 * A crew move along `path` from where the crew member stands: `assessStep` on each tile but the last, with the doors
 * the walk has opened so far (`sightsAlongWalk`), and `assessEnd` on the last, all against the state before the move.
 * The move itself applies exactly this (the `perception` move hook).
 */
export function assessPath(world: ReadonlyWorld, state: State, crewId: string, path: readonly Pos[], options: AssessOptions = {}): PathAssessment {
    const member = crewMember(state, crewId);
    const maps = sightsAlongWalk(world, state, sightMap(world, state), member.pos, path);
    const steps: Sighting[] = [];
    let end: Sighting[] = [];
    path.forEach((p, i) => {
        if (i < path.length - 1) steps.push(...assessStep(world, state, maps[i]!, crewId, p, options));
        else end = assessEnd(world, state, maps[i]!, crewId, p, options);
    });
    return { steps, end };
}

// ---------------------------------------------------------------------------------------------------------- Applying

/**
 * Turns sightings into suspicion, exposure, challenges and camera reports, in order. The only place that does. A
 * camera that sees the same crew member more than once in one call (two tiles of a move) reports it once.
 */
export function applySightings(ctx: Ctx, sightings: readonly Sighting[]): void {
    const { state } = ctx;
    const cameraSeen = new Set<string>();
    for (const s of sightings) {
        if (s.by === 'camera') {
            const key = `${s.observer} ${s.crew}`;
            if (s.outcome !== '!' || cameraSeen.has(key)) continue;
            cameraSeen.add(key);
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
    // In a crew phase a changed want rewrites the NPC's intent at once (§6.2): the telegraph shows now.
    reconsider(ctx);
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

// A move is judged as a whole before its first step (`assessPath`) and applied once it is over.
const PENDING = new WeakMap<State, PathAssessment>();

registerMoveHook('perception', {
    start(ctx, member, path) {
        PENDING.set(ctx.state, assessPath(ctx.world, ctx.state, member.id, path));
    },
    end(ctx) {
        const found = PENDING.get(ctx.state);
        PENDING.delete(ctx.state);
        if (found) applySightings(ctx, [...found.steps, ...found.end]);
    }
});

// The world phase's sightings (§8.5): every NPC along its committed intent, judged before anyone moves, then applied.
// The trespass deadlines follow (trespass.ts, order −90), judged by the same `deadlineOutcome` the overlay uses.
registerWorldHook('passiveNpcs', 'perception.world', (ctx, phase) => {
    const { world, state } = ctx;
    const poses = worldPoses(world, state, sightMap(world, state), phase.intents, phase.passive);
    const found: Sighting[] = [];
    for (const member of state.crew) found.push(...worldSightings(world, state, poses, member.id, member.pos, undefined));
    applySightings(ctx, found);
}, { order: -100 });

registerEvents({ cameraSaw: { undoBlocking: true } });
