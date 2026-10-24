import { clonePlain, samePlain } from '../core/json';
import { crewMember } from '../core/state';
import type { CrewState, DeepReadonly, Intent, NpcState, Pos, ReadonlyWorld, State } from '../core/types';
import { crewBudget, dashRefusal, planMoveOptions, planningState, type MoveMode } from '../crew/movement';
import { npcObserver, cameraObserver, type Observer } from '../geo/cones';
import { MOVE_ACTIONS } from '../data/movement';
import { NOISES } from '../data/noise';
import { sightInputs, sightMap, type SightMap } from '../geo/los';
import { doorBetween, occupancy, reachable, validatePath, type PathCheck, type ReachTile } from '../geo/move';
import { DEAF_STATUSES, noiseRadius, npcsInside, soundRing, type Ring, type SoundTile } from '../geo/sound';
import { reactToNoise } from '../rules/evidence';
import { isPresent, npcCanPass, personOf, worldWalks } from '../rules/npc/walk';
import { isEyesDown } from '../rules/suspicion';
import {
    doorDoubt, doorMayRefuse, doubtStates, doubtStops, floorKnowledge, narrowDoubt, viewDoubted, viewOpen, type DoorDoubt, type FloorKnowledge
} from '../rules/knowledge';
import {
    applySightings, assessEnd, assessWorldPhase, lookSightings, onePerObserver, posesAlong, sightsAlongWalk, turnLookers, worldPoses, type CertainWalks,
    type PoseAt, type Sighting, type WorldPhaseOptions, type WorldPoses
} from '../rules/perceive';
import { onFloor, placeCrew } from '../rules/place';
import type { CrewLook } from '../rules/profile';
import { addsTo, applyWorldSightings, effectOf, isQuiet, noEffect, scratchCtx, teammateEffects, type Effect, type TeammateEffect } from './effect';
import { previewPicture } from './picture';

/*
 * The safe-floor overlay (GAME_DESIGN §8.8, implementation plan §2.2 and M1-09) and the path under the finger.
 *
 * `safeFloor(world, state, crew)` tints every tile the crew member can reach this action (the Move band, and the Dash
 * band when a dash is allowed) with what committing that move along the reach's path and then ending the turn would do
 * to them, as far as the crew can know: it judges on the crew's picture (`previewPicture`), never on the truth.
 *
 * - **Now** (solid): the move itself. `assessEnd` on every tile of the path, passed or ended on (decision 46), each on
 *   the sight map with the doors the walk has opened so far, each observer once at its worst (`onePerObserver`), exactly
 *   as `assessPath` judges a move (the reach is a tree, so each tile's sightings are worked out once and each node keeps
 *   its path's worst per observer for every path through it). A dash that someone of the picture hears first has them
 *   react (`reactToNoise`, the hearing hook of `makeNoise`, on a copy: their new intents), and those sent to look turn
 *   and see the crew where they stand (`turnLookers`, `lookSightings`, decision 45), as the move hook has them. The
 *   sightings are then applied to the copy by `applySightings`, the one writer, and the effect is read off its events
 *   (`effectOf`).
 * - **Next** (hatched): the coming world phase after that move: `assessWorldPhase` on the state the move leaves (the
 *   doors it opened, what it made the NPCs want and so where they walk now), with every NPC's walk worked out once per
 *   door set (`worldPoses`) and only the walks that change walked again. Applied likewise.
 * - **Knowledge**: a hidden tile (decision 44: neither seen nor on the blueprint's layout) is grey and never safe; a
 *   tile where someone the crew doesn't know about could be watching and would react to this crew member
 *   (`floorKnowledge` with the crew member: `unknownRisk`, `unknownWatcher`, decisions 24, 43 and 44: an NPC on a tile a
 *   person can stand on that isn't fresh, a camera on a hidden tile), or reached past one or through grey, is hatched
 *   grey where the known NPCs leave it green; so is one reached through a door the crew can't vouch for that could
 *   turn out locked against them (`doorMayRefuse`: the move would stop before it).
 * - **Doors the crew can't vouch for** (decision 44, `doorDoubt`: not seen this turn, a status something unseen could
 *   have changed): the picture has them shut (`withDoubtedShut`), so the tint is the certain lower bound: sight and
 *   hearing only grow as doors open, so whatever is seen or heard there is seen or heard however they stand. The coming
 *   world phase's walks don't grow that way: an NPC that reacts to something such a door decides (it could see a tile
 *   passed or ended on through one, `viewDoubted`, or hear a dash differently, `doubtStates`) could walk anywhere, so
 *   none of its world-phase sightings count; one whose walk such a door could stop (`doubtStops`) counts only its steps
 *   before it (`CertainWalks`). Where such a door could make it worse than that (any of those, a known NPC's or camera's
 *   world-phase sight through one, or from beyond a door that could stop it), the tile is `doorRisk`, drawn hatched
 *   over its tint (grey hatched where the certain tint is green); red can't get worse. Certain danger always shows.
 *
 * - **Teammates**: those a dash's noise turns see the rest of the crew too (`lookSightings`); what that does to each
 *   teammate (`teammates`, read off the same events) counts toward the tile as the mover's own now does. The coming
 *   world phase is judged for each teammate too where the move could change it (it touched an NPC, opened a door, or
 *   stands on or leaves a committed path): where they stand, on the state the move leaves, counted where it adds to
 *   what that world phase does to them without the move (`addsTo`), as their `next`. A doubted door that could change
 *   either (the turned NPC's view of them, who hears, their world phase) makes the tile `doorRisk`.
 *
 * The tint is the worse of now (the mover's and every teammate's) and next (the mover's and every teammate's; only when
 * strictly worse, then hatched): red
 * (someone Exposes a crew member, or one who already knows them sees them again: the eye) > camera (a camera sees a
 * `!`, the operator's verify) > trespass (a challenge) > amber (pips, by NPC) > green.
 *
 * Per-state data (the picture, the sight maps per door set, the NPCs' walks, each tile's sightings and knowledge) is
 * worked out once and cached per state object, for the other bands, `pathSafety` and `explain`. `safeFloorJob` works
 * the floor out a slice at a time, so a scene can keep to its frame budget. Measured on generated banks in play
 * (desktop Node, M1-09 review): the Move band p50 1.5–1.9 ms, p99 9–20 ms; with the Dash band p50 2–6 ms, p99 43–90
 * ms, the tail being dashes that NPCs hear (their reactions are worked out tile by tile).
 */

export type TintKind = 'safe' | 'amber' | 'red' | 'trespass' | 'camera' | 'grey' | 'unknownRisk';

/** How a tile is drawn (§8.8). */
export interface Tint {
    kind: TintKind;
    /** It happens in the coming world phase as the NPCs walk their committed paths, not during the move. */
    hatched: boolean;
    /** Pips added this turn (the move and the world phase together), per NPC; a teammate's (`crew`) by the move. */
    pips: { npc: string; pips: number; crew?: string }[];
    /** The eye: someone Exposes the crew member, or one who knows them sees them. */
    eye: boolean;
    /** A camera sees a `!` (with the eye too when an NPC does as well). */
    camera: boolean;
    /** A door the crew can't vouch for could make it worse than this (hatched over it; a green tile is unknown risk). */
    doorRisk: boolean;
    /** The teammates the move does something to, when any (`FloorTile.teammates`). */
    teammates?: string[];
}

export type FloorBand = 'stay' | 'move' | 'dash';

/** One tile of the safe floor. */
export interface FloorTile {
    pos: Pos;
    /** `stay`: the crew member's own tile, ending the turn without moving. */
    band: FloorBand;
    /** Half-steps from the crew member. */
    cost: number;
    /** The path the tint judges (the reach's cheapest path; empty for `stay`). */
    path: Pos[];
    /** The tile's own knowledge (§8.15). */
    knowledge: FloorKnowledge;
    /**
     * The path passes a hidden tile, or one an unknown observer could react to the crew member on, before this one, or
     * goes through a door the crew can't vouch for that could be locked against them.
     */
    unknownPath: boolean;
    /** A door the crew can't vouch for could make it worse than the tint, which is certain (see the header). */
    doorRisk: boolean;
    /** NPCs whose world-phase sightings count only as far as they are certain (`CertainWalks`): skipped or cut short. */
    unsure: string[];
    /** What the move does to the crew member now (its steps and its end). */
    now: Effect;
    /** What the coming world phase then does; null when the move already Exposes them (red can't get worse). */
    next: Effect | null;
    /** What the move does to the rest of the crew (now and in the world phase), each teammate it touches. */
    teammates: TeammateEffect[];
    tint: Tint;
}

export interface SafeFloor {
    crew: string;
    from: Pos;
    /** Every tile the crew member can end a move on (and their own), in reach order. */
    tiles: FloorTile[];
    at(p: Pos): FloorTile | undefined;
}

export interface FloorOptions {
    /** Judge this look instead of the crew member's own (a loadout change being previewed). */
    look?: CrewLook;
    /** Include the Dash band (default: when a dash is allowed). */
    dash?: boolean;
}

// ---------------------------------------------------------------------------------------------------------- Tints

/** How bad each tint kind is (grey and unknown risk aren't outcomes): the tint is the worse of now and next by it. */
export const TINT_RANK: Readonly<Record<Exclude<TintKind, 'grey' | 'unknownRisk'>, number>> = { safe: 0, amber: 1, trespass: 2, camera: 3, red: 4 };

/** The tint kind an outcome reads as (a `now` or `next` effect, or what really happened). */
export function effectKind(e: DeepReadonly<Effect>): Exclude<TintKind, 'grey' | 'unknownRisk'> {
    if (e.exposed.length || e.watching.length) return 'red';
    if (e.cameras.length) return 'camera';
    if (e.challenged !== null) return 'trespass';
    return Object.keys(e.pips).length ? 'amber' : 'safe';
}

/**
 * The tint of a tile from what happens now and next, and what the crew knows of it and its path. The kind is the worse
 * of now and next, each the worst of the mover's and `teammates`' (hatched when next is strictly worse); the pips are
 * every pip added this turn, per NPC, now and next together, then the teammates' (with `crew`); the camera flag is set
 * when a camera reports in either phase that counts toward the kind (now's always). `now`, `next` and `teammates` are certain
 * (see the header); with `doubt` a door the crew can't vouch for could change them, which makes the tint `doorRisk`
 * unless it is red already (nothing worse) or grey, and a green tile unknown risk.
 */
export function tintOf(
    now: DeepReadonly<Effect>, next: DeepReadonly<Effect> | null, knowledge: FloorKnowledge, unknownPath: boolean, doubt = false,
    teammates: readonly DeepReadonly<TeammateEffect>[] = []
): Tint {
    const worst = (k: ReturnType<typeof effectKind>, e: DeepReadonly<Effect> | undefined): ReturnType<typeof effectKind> => {
        const m = e ? effectKind(e) : 'safe';
        return TINT_RANK[m] > TINT_RANK[k] ? m : k;
    };
    const a = teammates.reduce((k, t) => worst(k, t.effect), effectKind(now));
    const b = teammates.reduce((k, t) => worst(k, t.next), next ? effectKind(next) : 'safe');
    const hatched = TINT_RANK[b] > TINT_RANK[a], kind = hatched ? b : a;
    const sum = (list: readonly (DeepReadonly<Effect> | null | undefined)[]): Record<string, number> => {
        const added: Record<string, number> = {};
        for (const e of list) if (e) for (const id of Object.keys(e.pips)) added[id] = (added[id] ?? 0) + e.pips[id]!;
        return added;
    };
    const own = sum([now, next]);
    const pips: Tint['pips'] = Object.keys(own).sort().map(npc => ({ npc, pips: own[npc]! }));
    for (const t of teammates) {
        const theirs = sum([t.effect, t.next]);
        for (const npc of Object.keys(theirs).sort()) pips.push({ npc, pips: theirs[npc]!, crew: t.crew });
    }
    if (kind === 'safe') {
        const k: TintKind = knowledge === 'hidden' ? 'grey' : knowledge === 'unknownRisk' || unknownPath || doubt ? 'unknownRisk' : 'safe';
        return { kind: k, hatched: false, pips: [], eye: false, camera: false, doorRisk: doubt && k !== 'grey' };
    }
    const camera = now.cameras.length > 0 || teammates.some(t => t.effect.cameras.length > 0)
        || (hatched && (!!next?.cameras.length || teammates.some(t => !!t.next?.cameras.length)));
    return {
        kind, hatched, pips, eye: kind === 'red', camera, doorRisk: doubt && kind !== 'red',
        ...(teammates.length ? { teammates: teammates.map(t => t.crew) } : {})
    };
}

// ---------------------------------------------------------------------------------------------------------- Judging

/** The state with some doors opened by the crew member's walk: its sight map, its NPCs' walks and the dash's rings. */
interface Variant {
    doors: readonly string[];
    state: State;
    sight: SightMap;
    poses: WorldPoses | null;
    /** The NPCs of the picture a dash's noise from a tile reaches, by tile index. */
    hearers: Map<number, readonly string[]>;
    /** The walls and doors as they stand (`sightInputs`): what a ring depends on. */
    walls: string;
    /** The doubted doors open and shut, the rest as here (`doubtStates`), with their walls: a dash's reach either way. */
    doubtRings?: { open: State; shut: State; openWalls: string; shutWalls: string };
    /** Per tile index: whether a doubted door could change the world phase after ending there (`nextDoubted`). */
    nextDoubt?: Map<number, boolean>;
    /** The judge's doubt without the doors this variant opened (`narrowDoubt`); undefined until asked. */
    doubt?: DoorDoubt | null;
    /** Per tile index: the doubters whose view of it a doubted door could decide (`nowDoubted`). */
    nowDoubt?: Map<number, readonly string[]>;
    /** Per committed intent: how many of its steps the NPC surely walks, -1 for all (`cutSteps`). */
    cuts?: WeakMap<object, number>;
}

/** Everything worked out once per state and crew member. */
export interface Judge {
    world: ReadonlyWorld;
    /** The truth (for knowledge only). */
    state: State;
    picture: State;
    crew: string;
    member: DeepReadonly<CrewState>;
    look: CrewLook | undefined;
    base: Variant;
    variants: Map<string, Variant>;
    /** The steps' and ends' sightings, by tile and door set. */
    seen: Map<string, Sighting[]>;
    /** What the crew knows of each tile for this crew member, by index, on demand. */
    knowledge: Map<number, FloorKnowledge>;
    /** Tiles from which a dash's noise could reach an NPC of the picture. */
    near: Uint8Array | null;
    /** The doors the crew can't vouch for (`doorDoubt`), or null when there are none. */
    doubt: DoorDoubt | null;
    /** The picture's observers as they stand (NPCs that look, live cameras) within reach of a doubted door, by id. */
    doubters: { id: string; o: Observer }[];
}

const JUDGES = new WeakMap<State, Map<string, Judge>>();

/** The judge of a crew member in a state (cached per state object, when judging their own look). */
export function judgeFor(world: ReadonlyWorld, state: State, crewId: string, look?: CrewLook): Judge {
    let byCrew = JUDGES.get(state);
    const cached = look ? undefined : byCrew?.get(crewId);
    if (cached?.world === world) return cached;
    const picture = previewPicture(world, state), doubt = doorDoubt(world, state);
    const base: Variant = { doors: [], state: picture, sight: sightMap(world, picture), poses: null, hearers: new Map(), walls: sightInputs(world, picture) };
    const judge: Judge = {
        world, state, picture, crew: crewId, member: crewMember(picture, crewId), look, base, variants: new Map([['', base]]), seen: new Map(),
        knowledge: new Map(), near: null, doubt, doubters: doubt ? doubtersOf(world, picture, doubt) : []
    };
    if (!look) {
        if (!byCrew) JUDGES.set(state, byCrew = new Map());
        byCrew.set(crewId, judge);
    }
    return judge;
}

/** The variant after stepping from `from` to `to`: a closed or locked door crossed opens (`sightsAlongWalk`). */
function stepVariant(judge: Judge, v: Variant, from: DeepReadonly<Pos>, to: DeepReadonly<Pos>): Variant {
    const [map] = sightsAlongWalk(judge.world, v.state, v.sight, from, [to]);
    if (map === v.sight) return v;
    const door = doorBetween(judge.world, from, to)!;
    const doors = [...v.doors, door.id].sort(), key = doors.join(' ');
    let next = judge.variants.get(key);
    if (!next) {
        const state: State = { ...v.state, doors: { ...v.state.doors, [door.id]: { ...v.state.doors[door.id], status: 'open' } } };
        next = { doors, state, sight: map!, poses: null, hearers: new Map(), walls: sightInputs(judge.world, state) };
        judge.variants.set(key, next);
    }
    return next;
}

/** `floorKnowledge` of a tile for the judge's crew member and look, once per judge: passing it or ending a move there. */
function knowledgeAt(judge: Judge, p: DeepReadonly<Pos>): FloorKnowledge {
    const i = p.y * judge.world.width + p.x;
    let k = judge.knowledge.get(i);
    if (!k) {
        const who = { crew: judge.crew, ...(judge.look ? { look: judge.look } : {}) };
        judge.knowledge.set(i, k = floorKnowledge(judge.world, judge.state, { x: p.x, y: p.y }, who));
    }
    return k;
}

const posesOf = (judge: Judge, v: Variant): WorldPoses => (v.poses ??= worldPoses(judge.world, v.state, v.sight));

/**
 * `worldPoses` of a scratch state that differs from the variant's only in what the move made its NPCs want: the walks
 * are resolved again (`worldWalks`), and an NPC's poses are reused when its walk and the way it looks are unchanged.
 * The same poses `worldPoses(world, scratch, sight)` gives (the property test checks it on a sample).
 */
export function posesAfter(judge: Judge, v: Variant, scratch: State, tile: Pos): WorldPoses {
    const base = posesOf(judge, v), { world } = judge;
    const before = new Map(v.state.npcs.map(n => [n.id, n]));
    const looksSame = (npc: DeepReadonly<NpcState>): boolean => {
        const old = before.get(npc.id);
        return !!old && old.status === npc.status && old.alerted === npc.alerted && old.facing === npc.facing && old.pos.x === npc.pos.x
            && old.pos.y === npc.pos.y;
    };
    // Nobody changed and the crew member's two tiles are on nobody's path: the walks are the variant's (`posesWith`).
    const at = (p: DeepReadonly<Pos>): number => p.y * world.width + p.x;
    const changed = scratch.npcs.filter(n => !samePlain(n.intent, before.get(n.id)!.intent));
    const offPaths = !base.paths.has(at(tile)) && !base.paths.has(at(judge.member.pos));
    if (offPaths && !changed.length && scratch.npcs.every(looksSame)) return base;
    let walked: Record<string, DeepReadonly<Intent>>;
    if (offPaths && changed.every(n => !n.intent.path.length && !before.get(n.id)!.intent.path.length && n.status === before.get(n.id)!.status)) {
        // Only standing NPCs turned (a look, a face): they walk nowhere and end where they stand, as before, so nobody
        // else's walk changes (`resolveWalks`), and a standing NPC walks its intent as it is.
        walked = { ...base.walked };
        for (const n of changed) walked[n.id] = n.intent;
    } else walked = worldWalks(world, scratch, null, null).walked;
    const byNpc = new Map<string, readonly PoseAt[]>(), paths = new Set<number>();
    for (const npc of scratch.npcs) {
        for (const p of npc.intent.path) paths.add(at(p));
        if (isEyesDown(npc)) continue;
        const reuse = base.byNpc.get(npc.id);
        byNpc.set(npc.id, reuse && looksSame(npc) && samePlain(walked[npc.id], base.walked[npc.id]) ? reuse : posesAlong(world, scratch, v.sight, npc, walked[npc.id]!));
    }
    return { sight: v.sight, byNpc, walked, paths };
}

/** Every sighting of passing or ending an action on `tile` in a variant, those that do something (`assessEnd`), cached. */
function endAt(judge: Judge, v: Variant, tile: DeepReadonly<Pos>): Sighting[] {
    const key = `${tile.x},${tile.y} ${v.doors.join(' ')}`;
    let found = judge.seen.get(key);
    if (!found) judge.seen.set(key, found = assessEnd(judge.world, v.state, v.sight, judge.crew, { x: tile.x, y: tile.y }, judge.look ? { look: judge.look } : {}));
    return found;
}

const NOBODY: readonly string[] = [];
const NONE: readonly Sighting[] = [];

/** One tile's dash ring (it depends on the walls and doors alone), per world and wall state: shared by every state. */
const RINGS = new WeakMap<ReadonlyWorld, { key: string; rings: Map<number, Ring> }[]>();

function tileRing(world: ReadonlyWorld, state: State, key: string, p: DeepReadonly<Pos>): Ring {
    let list = RINGS.get(world);
    if (!list) RINGS.set(world, list = []);
    let entry = list.find(e => e.key === key);
    if (!entry) {
        list.unshift(entry = { key, rings: new Map() });
        if (list.length > 32) list.length = 32;
    }
    const i = p.y * world.width + p.x;
    let ring = entry.rings.get(i);
    if (!ring) entry.rings.set(i, ring = soundRing(world, state, { x: p.x, y: p.y }, noiseRadius('dash')));
    return ring;
}

/**
 * The tiles a dash's noise from one tile could carry to someone of the picture: within its radius of an NPC that can
 * hear (a step costs at least a tile's worth, so sound never gets further than its radius in either axis).
 */
function nearHearing(judge: Judge): Uint8Array {
    if (judge.near) return judge.near;
    const { world } = judge, r = noiseRadius('dash'), near = new Uint8Array(world.width * world.height);
    for (const n of judge.picture.npcs) {
        if (DEAF_STATUSES.has(n.status)) continue;
        for (let y = Math.max(0, n.pos.y - r); y <= Math.min(world.height - 1, n.pos.y + r); y++) {
            for (let x = Math.max(0, n.pos.x - r); x <= Math.min(world.width - 1, n.pos.x + r); x++) near[y * world.width + x] = 1;
        }
    }
    return judge.near = near;
}

/** The NPCs of a variant's picture that a dash's noise from one tile reaches. */
function tileHearers(judge: Judge, v: Variant, p: DeepReadonly<Pos>): readonly string[] {
    const i = p.y * judge.world.width + p.x;
    if (!nearHearing(judge)[i]) return NOBODY;
    let found = v.hearers.get(i);
    if (!found) v.hearers.set(i, found = npcsInside(v.state, tileRing(judge.world, v.state, v.walls, p)));
    return found;
}

/**
 * The ring of a dash along `path` as hearing reads it, and who of the picture hears it, or null when nobody does.
 * Sound floods from every tile of the path at once and reaches each tile at the cost from its nearest source, so the
 * ring of the path is the union of the rings of its tiles (`soundRing` of each, cached per wall state). Hearing reads a
 * ring only through its sources and whether an NPC's tile is in it (`npcsInside`), so the ring built here holds just
 * the tiles NPCs of the picture stand on: what `soundRing` of the whole path has there, at a fraction of its cost. The
 * property test checks it against `soundRing` of the whole path on those tiles, and the hearers it gives.
 */
export function dashRing(judge: Judge, v: Variant, path: readonly DeepReadonly<Pos>[]): { ring: Ring; hearers: string[] } | null {
    const { world } = judge;
    const hearing = new Set<string>();
    for (const p of path) for (const id of tileHearers(judge, v, p)) hearing.add(id);
    if (!hearing.size) return null;
    const stand = new Set(v.state.npcs.map(n => n.pos.y * world.width + n.pos.x));
    const byIndex = new Map<number, SoundTile>();
    for (const p of path) {
        if (!nearHearing(judge)[p.y * world.width + p.x]) continue;
        for (const t of tileRing(world, v.state, v.walls, p).tiles) {
            const i = t.pos.y * world.width + t.pos.x;
            if (!stand.has(i)) continue;
            const had = byIndex.get(i);
            if (!had || had.remaining < t.remaining) byIndex.set(i, t);
        }
    }
    const tiles = [...byIndex.keys()].sort((a, b) => a - b).map(i => byIndex.get(i)!);
    const near = nearHearing(judge);
    // The last tile of the path whose own ring reaches `p`: what `soundRing` of the whole path says too.
    const lastHeard = (p: Pos): Pos | undefined => {
        const i = p.y * world.width + p.x;
        for (let k = path.length - 1; k >= 0; k--) {
            const q = path[k]!;
            if (near[q.y * world.width + q.x] && tileRing(world, v.state, v.walls, q).byIndex.has(i)) return { x: q.x, y: q.y };
        }
        return undefined;
    };
    const ring: Ring = {
        sources: path.map(p => ({ x: p.x, y: p.y })), radius: noiseRadius('dash'), tiles, byIndex: new Map(tiles.map(t => [t.pos.y * world.width + t.pos.x, t])),
        width: world.width, lastHeard
    };
    return { ring, hearers: v.state.npcs.filter(n => hearing.has(n.id)).map(n => n.id) };
}

/** What a move to `tile` judged on its way (`steps`, `end`) does now, and what the world phase does after it. */
export interface Judged {
    now: Effect;
    next: Effect | null;
    /** The sightings behind them, for "who and why". */
    nowSightings: Sighting[];
    nextSightings: Sighting[];
    /** What the move does to the rest of the crew (`FloorTile.teammates`), and the sightings behind it, now and next. */
    teammates: TeammateEffect[];
    teammateSightings: Sighting[];
    teammateNextSightings: Sighting[];
    /** NPCs of the picture that hear a dash. */
    heard: string[];
    /** A door the crew can't vouch for could change what happens, now or in the world phase (see the header). */
    doubt: boolean;
    /** NPCs whose world-phase sightings count only as far as they are certain (`CertainWalks`). */
    unsure: string[];
}

/**
 * Judges ending a move (or the turn) on `tile` after `path` in variant `v`. `passed`: the observers whose view of a tile
 * passed on the way a doubted door could decide (`nowDoubted`).
 */
export function judgeEnd(
    judge: Judge, v: Variant, tile: Pos, path: readonly Pos[], mode: MoveMode | 'stay', steps: readonly Sighting[], end: readonly Sighting[],
    passed: readonly string[] = NOBODY
): Judged {
    const { world, crew } = judge;
    const sightings = onePerObserver([...steps, ...end]);
    const noise = mode === 'dash' && path.length ? dashRing(judge, v, path) : null;
    // Who could react to something a doubted door decides: they could see a tile passed or this one, or hear the dash
    // (then every hearer: who is sent to look depends on who hears), or turn to it and see a crew member through one.
    const atEnd = mode === 'stay' ? NOBODY : nowDoubted(judge, v, tile), heardDoubt = mode === 'dash' && path.length ? dashDoubted(judge, v, path) : NOBODY;
    const skip = new Set([...passed, ...atEnd, ...heardDoubt, ...(heardDoubt.length ? noise?.hearers ?? [] : [])]);
    // The world phase's options, once `skip` is complete.
    const optionsOf = (): WorldPhaseOptions => {
        const certain = judge.doubt ? certainWalks(judge, v, skip) : undefined;
        return { ...(judge.look ? { look: judge.look } : {}), ...(certain ? { certain } : {}) };
    };
    if (!sightings.length && !noise) {
        const nowDoubt = skip.size > 0, options = optionsOf();
        // Nothing happens now: the world phase from the state with the doors opened, the crew member on `tile`
        // (`assessWorldPhase` moves them there itself and walks again only the walks that changes).
        const poses = posesOf(judge, v);
        const nextSightings = assessWorldPhase(world, v.state, v.sight, crew, tile, { ...options, poses });
        const next = nextSightings.length ? applyWorldSightings({ world }, placeCrew(v.state, crew, tile), crew, nextSightings) : noEffect();
        let doubt = nowDoubt || nextDoubted(judge, v, v.state, tile, poses);
        // The teammates' world phase changes only with a door the move opened or a walk it changes.
        const paths = poses.paths, at = (p: DeepReadonly<Pos>): number => p.y * world.width + p.x;
        const mates = v.doors.length || paths.has(at(tile)) || paths.has(at(judge.member.pos))
            ? teammatesNext(judge, v, placeCrew(v.state, crew, tile), tile, [], options) : null;
        doubt ||= !!mates?.doubt;
        return {
            now: noEffect(), next, nowSightings: sightings, nextSightings, teammates: mates?.teammates ?? [], teammateSightings: [],
            teammateNextSightings: mates?.sightings ?? [], heard: [], doubt, unsure: unsureOf(judge, v, v.state, skip)
        };
    }
    // The move's own effects on a copy, in the order the move has them: the dash's noise, those it sends to look turning
    // and seeing, then the sightings. Hearing and perception write into the NPCs that hear or see (copied whole), the
    // camera reports and the barks; the intents they rewrite (`reconsider`) replace an NPC's intent, goal and status and
    // touch its route's `stalled`, so every other NPC is copied shallowly with its route.
    const placed = placeCrew(v.state, crew, tile);
    const touched = new Set<string>([...sightings.map(s => s.observer), ...(noise?.hearers ?? [])]);
    const scratch: State = {
        ...placed,
        npcs: placed.npcs.map(n => (touched.has(n.id) ? clonePlain(n) : { ...n, route: n.route ? { ...n.route } : n.route })),
        cameraReports: [...placed.cameraReports], barked: [...placed.barked]
    };
    const { ctx, events } = scratchCtx({ world }, scratch);
    if (noise) reactToNoise(ctx, noise.ring, NOISES.dash.kind, `dash ${crew}`);
    const turned = turnLookers(ctx);
    const all = turned.size ? onePerObserver([...sightings, ...lookSightings(world, scratch, v.sight, turned)]) : sightings;
    const d = turned.size ? doubtOf(judge, v) : null;
    if (d) {
        for (const id of turned) {
            const o = npcObserver(world, scratch.npcs.find(n => n.id === id)!);
            if (o && scratch.crew.some(c => viewDoubted(world, d, o, c.pos))) skip.add(id);
        }
    }
    const nowDoubt = skip.size > 0;
    applySightings(ctx, all);
    const nowSightings = turned.size ? all.filter(s => s.crew === crew) : all;
    const now = effectOf(events, crew, v.state);
    // Only those its noise turned see the rest of the crew.
    const teammates = turned.size ? teammateEffects(events, crew, v.state) : [];
    const teammateSightings = teammates.length ? all.filter(s => s.crew !== crew) : [];
    const heard = noise?.hearers ?? [];
    if (now.exposed.length || now.watching.length) {
        return { now, next: null, nowSightings, nextSightings: [], teammates, teammateSightings, teammateNextSightings: [], heard, doubt: nowDoubt, unsure: [] };
    }
    const poses = posesAfter(judge, v, scratch, tile), options = optionsOf();
    const nextSightings = assessWorldPhase(world, scratch, v.sight, crew, tile, { ...options, poses });
    const next = nextSightings.length ? applyWorldSightings({ world }, scratch, crew, nextSightings) : noEffect();
    const mates = teammatesNext(judge, v, scratch, tile, teammates, options, poses);
    const doubt = nowDoubt || nextDoubted(judge, v, scratch, tile, poses) || mates.doubt;
    return {
        now, next, nowSightings, nextSightings, teammates: mates.teammates, teammateSightings, teammateNextSightings: mates.sightings, heard, doubt,
        unsure: unsureOf(judge, v, scratch, skip)
    };
}

/**
 * The teammates' world phase after the move (see the header): for each crew member but the mover, on `s` (the state
 * the move leaves, the mover on `tile`) where they stand, kept as their `next` where it adds to what the picture's own
 * world phase does to them (`addsTo`, judged with the same certain walks); `now` the teammates the move itself touched.
 * `doubt` when a doubted door could change a teammate's world phase there, with the move or without it (`nextDoubted`).
 */
function teammatesNext(
    judge: Judge, v: Variant, s: State, tile: Pos, now: readonly TeammateEffect[], options: WorldPhaseOptions, poses = posesAfter(judge, v, s, tile)
): { teammates: TeammateEffect[]; sightings: Sighting[]; doubt: boolean } {
    const { world } = judge, base = judge.base, certain = options.certain ? { certain: options.certain } : {};
    const out: TeammateEffect[] = [], sightings: Sighting[] = [];
    let doubt = false;
    for (const c of s.crew) {
        if (c.id === judge.crew) continue;
        const p = { x: c.pos.x, y: c.pos.y }, had = now.find(t => t.crew === c.id);
        const found = assessWorldPhase(world, s, v.sight, c.id, p, { ...certain, poses });
        const after = found.length ? applyWorldSightings({ world }, s, c.id, found) : noEffect();
        let next: Effect | undefined;
        if (!isQuiet(after)) {
            const without = assessWorldPhase(world, base.state, base.sight, c.id, p, { ...certain, poses: posesOf(judge, base) });
            const before = without.length ? applyWorldSightings({ world }, base.state, c.id, without) : noEffect();
            if (addsTo(after, before)) {
                next = after;
                sightings.push(...found);
            }
        }
        // A doubted door could change their world phase after the move, or without it (whether the move adds to it).
        if (judge.doubt && (nextDoubted(judge, v, s, p, poses) || nextDoubted(judge, base, base.state, p, posesOf(judge, base)))) doubt = true;
        if (had || next) out.push({ crew: c.id, effect: had?.effect ?? noEffect(), ...(next ? { next } : {}) });
    }
    return { teammates: out, sightings, doubt };
}

// ---------------------------------------------------------------------------------------------------------- Doors in doubt

/** Whether a doubted door's tiles are within `r` tiles (Chebyshev) of `p`. */
function doubtedWithin(d: DoorDoubt, p: DeepReadonly<Pos>, r: number): boolean {
    for (let i = 0; i < d.boxes.length; i += 4) {
        const dx = Math.max(d.boxes[i]! - p.x, p.x - d.boxes[i + 2]!, 0), dy = Math.max(d.boxes[i + 1]! - p.y, p.y - d.boxes[i + 3]!, 0);
        if (Math.max(dx, dy) <= r) return true;
    }
    return false;
}

/** The picture's observers as they stand (NPCs that look, live cameras) with a doubted door within their reach. */
function doubtersOf(world: ReadonlyWorld, picture: State, d: DoorDoubt): { id: string; o: Observer }[] {
    const out: { id: string; o: Observer }[] = [];
    for (const npc of picture.npcs) {
        const o = isPresent(npc) && !isEyesDown(npc) ? npcObserver(world, npc) : null;
        if (o && doubtedWithin(d, o.pos, d.reach)) out.push({ id: npc.id, o });
    }
    for (const camera of world.cameras) {
        const o = cameraObserver(world, picture, camera.id);
        if (o && doubtedWithin(d, o.pos, d.reach)) out.push({ id: camera.id, o });
    }
    return out;
}

/** The judge's doubt as the variant's doors stand: a doubted door it opened on the way is open whatever it was. */
const doubtOf = (judge: Judge, v: Variant): DoorDoubt | null =>
    (v.doubt === undefined ? (v.doubt = judge.doubt ? narrowDoubt(judge.world, judge.doubt, v.state) : null) : v.doubt);

/**
 * The observers of the picture whose reaction to the crew member on `tile` during the crew phase a doubted door could
 * decide (as `v` stands): they would see them there, passing or ending on it, through one and do something about it
 * (`assessEnd`).
 */
function nowDoubted(judge: Judge, v: Variant, tile: DeepReadonly<Pos>): readonly string[] {
    const d = doubtOf(judge, v);
    if (!d) return NOBODY;
    const i = tile.y * judge.world.width + tile.x, memo = (v.nowDoubt ??= new Map());
    let found = memo.get(i);
    if (found === undefined) {
        let ids = judge.doubters.filter(x => viewDoubted(judge.world, d, x.o, tile)).map(x => x.id);
        if (ids.length) {
            const p = { x: tile.x, y: tile.y }, options = judge.look ? { look: judge.look } : {};
            const acts = assessEnd(judge.world, v.state, d.open, judge.crew, p, options);
            ids = ids.filter(id => acts.some(s => s.observer === id));
        }
        memo.set(i, found = ids.length ? ids : NOBODY);
    }
    return found;
}

/**
 * How many steps of its committed intent an NPC of `v` surely walks: those before the first door a doubted door could
 * stop it at (`doubtStops`), or undefined when none could. Cached per intent.
 */
function cutSteps(judge: Judge, v: Variant, npc: DeepReadonly<NpcState>): number | undefined {
    const d = doubtOf(judge, v);
    if (!d || !npc.intent.path.length || !isPresent(npc)) return undefined;
    const memo = (v.cuts ??= new WeakMap()), hit = memo.get(npc.intent);
    if (hit !== undefined) return hit < 0 ? undefined : hit;
    const pass = npcCanPass(personOf(judge.world, npc.id));
    let prev: DeepReadonly<Pos> = npc.pos, k = -1;
    for (let i = 0; i < npc.intent.path.length && k < 0; i++) {
        const p = npc.intent.path[i]!;
        if (doubtStops(judge.world, d, prev, p, pass)) k = i;
        prev = p;
    }
    memo.set(npc.intent, k);
    return k < 0 ? undefined : k;
}

/** What of the world phase is certain (`CertainWalks`): `skip` reacts to something a doubted door decides. */
function certainWalks(judge: Judge, v: Variant, skip: ReadonlySet<string>): CertainWalks {
    return { skip, steps: npc => cutSteps(judge, v, npc) };
}

/** The NPCs of `s` whose world-phase sightings count only as far as they are certain: `skip`, and those cut short. */
function unsureOf(judge: Judge, v: Variant, s: State, skip: ReadonlySet<string>): string[] {
    if (!judge.doubt) return [];
    const out = new Set([...skip].filter(id => s.npcs.some(n => n.id === id)));
    for (const npc of s.npcs) if (cutSteps(judge, v, npc) !== undefined) out.add(npc.id);
    return [...out].sort();
}

/**
 * Whether a doubted door could make the coming world phase worse for the crew member on `tile` than its certain part,
 * from `s` (the variant's state, cached in `v`, or a scratch copy) and its walks `poses`: an NPC sees `tile` through one
 * from a pose of its walk (as it faces then; every other door counted open, as it opens those it walks through), a
 * live camera does where it pans to, or an NPC one could stop could see it from beyond that door or acts on the crew
 * member at the end of its walk. Who reacts to something one decides is the caller's (`nowDoubted`, `dashDoubted`).
 */
function nextDoubted(judge: Judge, v: Variant, s: State, tile: DeepReadonly<Pos>, poses: WorldPoses): boolean {
    const d = doubtOf(judge, v);
    if (!d) return false;
    const i = tile.y * judge.world.width + tile.x, memo = s === v.state ? (v.nextDoubt ??= new Map()) : null;
    const hit = memo?.get(i);
    if (hit !== undefined) return hit;
    const { world } = judge;
    let found = world.cameras.some(c => {
        const pose = cameraObserver(world, s, c.id, true);
        return pose !== null && viewDoubted(world, d, pose, tile);
    });
    for (const npc of s.npcs) {
        if (found) break;
        const walk = poses.byNpc.get(npc.id);
        if (!walk || !isPresent(npc)) continue;
        const k = cutSteps(judge, v, npc);
        if (k === undefined) {
            found = walk.some(p => viewDoubted(world, d, p.pose, tile, true));
            continue;
        }
        // Up to the door as walked; beyond it, as it would walk on were the door open.
        const kind = npc.intent.action?.kind;
        if ((kind === 'frisk' || kind === 'tell') && npc.intent.action!.crew === judge.crew) { found = true; break; }
        const along = posesAlong(world, s, v.sight, npc, npc.intent);
        found = along.some((p, j) => (j <= k ? viewDoubted(world, d, p.pose, tile, true) : viewOpen(world, d, p.pose, tile)));
    }
    memo?.set(i, found);
    return found;
}

/**
 * The NPCs of the picture whose hearing of a dash along `path` a doubted door could change (whether, how loud, or the
 * last tile heard, decision 45): the reach at its tile with the doubted doors open and with them shut (the other doors
 * as the walk leaves them) differs. Only a tile with a doubted door within the dash's radius rings differently.
 */
function dashDoubted(judge: Judge, v: Variant, path: readonly DeepReadonly<Pos>[]): readonly string[] {
    const d = doubtOf(judge, v);
    if (!d) return NOBODY;
    const { world } = judge, r = noiseRadius('dash'), near = nearHearing(judge);
    const heard = path.filter(p => near[p.y * world.width + p.x]);
    if (!heard.some(p => doubtedWithin(d, p, r))) return NOBODY;
    if (!v.doubtRings) {
        const { open, shut } = doubtStates(world, v.state, d, new Set(v.doors));
        v.doubtRings = { open, shut, openWalls: sightInputs(world, open), shutWalls: sightInputs(world, shut) };
    }
    const x = v.doubtRings, loud = new Map<number, [number, number]>(), last = new Map<number, [number, number]>();
    heard.forEach((p, k) => {
        const own = doubtedWithin(d, p, r) ? null : tileRing(world, v.state, v.walls, p);
        const a = own ?? tileRing(world, x.open, x.openWalls, p), b = own ?? tileRing(world, x.shut, x.shutWalls, p);
        for (const n of v.state.npcs) {
            if (DEAF_STATUSES.has(n.status)) continue;
            const i = n.pos.y * world.width + n.pos.x, was = loud.get(i) ?? [-1, -1], end = last.get(i) ?? [-1, -1];
            loud.set(i, [Math.max(was[0], a.byIndex.get(i)?.remaining ?? -1), Math.max(was[1], b.byIndex.get(i)?.remaining ?? -1)]);
            last.set(i, [a.byIndex.has(i) ? k : end[0], b.byIndex.has(i) ? k : end[1]]);
        }
    });
    const out = v.state.npcs.filter(n => {
        const i = n.pos.y * world.width + n.pos.x, l = loud.get(i), e = last.get(i);
        return (!!l && l[0] !== l[1]) || (!!e && e[0] !== e[1]);
    }).map(n => n.id);
    return out.length ? out : NOBODY;
}

// ---------------------------------------------------------------------------------------------------------- The floor

/** A tile of the reach as its path leaves it: `unsure`, who could see a tile passed on the way through a doubted door. */
interface FloorNode { v: Variant; steps: Sighting[]; unknown: boolean; unsure: readonly string[]; path: Pos[] }

/** `a` and `b` as one list (`a` itself when `b` adds nobody). */
function joined(a: readonly string[], b: readonly string[]): readonly string[] {
    const more = b.filter(id => !a.includes(id));
    return more.length ? [...a, ...more] : a;
}

/**
 * A safe floor worked out a slice at a time (the scene's frame budget): `step(deadline, now)` tints tiles in reach
 * order (the crew member's own tile, the Move band, then the Dash band: the dearest, a dash heard by NPCs is judged
 * with their reactions) until `now()` reaches `deadline` (the rules read no clock: the caller lends one), and returns
 * whether it is done; `step()` finishes it. `tiles` are those tinted so far, `floor()` them as a `SafeFloor`. One job
 * per state object and crew member (`safeFloorJob` returns the same job again), shared with `safeFloor`.
 */
export interface FloorJob {
    readonly crew: string;
    readonly from: Pos;
    readonly done: boolean;
    /** The tiles tinted so far, in reach order. */
    readonly tiles: readonly FloorTile[];
    /** Whether every tile of these bands is tinted. */
    has(bands: readonly FloorBand[]): boolean;
    step(deadline?: number, now?: () => number): boolean;
    floor(bands?: readonly FloorBand[]): SafeFloor;
}

/** The job with what `safeFloor` needs to step it only as far as some bands. */
interface Job extends FloorJob {
    /** Tints every tile up to reach index `i`. */
    upTo(i: number): void;
    /** The reach index of each band's last tile (-1: none). */
    last: Record<FloorBand, number>;
}

const FLOORS = new WeakMap<State, Map<string, { world: ReadonlyWorld; job: Job }>>();

const ALL_BANDS: readonly FloorBand[] = ['stay', 'move', 'dash'];

/** The incremental safe floor of a crew member (see `FloorJob`); cached per state object when judging their own look. */
export function safeFloorJob(world: ReadonlyWorld, state: State, crewId: string, options: FloorOptions = {}): FloorJob {
    return jobFor(world, state, crewId, options);
}

function jobFor(world: ReadonlyWorld, state: State, crewId: string, options: FloorOptions): Job {
    const plain = options.look === undefined && options.dash === undefined;
    const hit = plain ? FLOORS.get(state)?.get(crewId) : undefined;
    if (hit?.world === world) return hit.job;
    const judge = judgeFor(world, state, crewId, options.look);
    const member = crewMember(state, crewId);
    const moveBudget = member.actionsLeft >= MOVE_ACTIONS ? crewBudget(world, member, 'move') : 0;
    const dash = (options.dash ?? true) && !dashRefusal(world, state, crewId);
    const budget = dash ? Math.max(moveBudget, crewBudget(world, member, 'dash')) : moveBudget;
    const reach = reachable(world, onFloor(planningState(world, state)), member.pos, budget, planMoveOptions(world, state, member)).tiles;
    const width = world.width, index = (p: Pos): number => p.y * width + p.x;
    const nodes = new Map<number, FloorNode>(), tiles: FloorTile[] = [];
    const bandOf = (t: ReachTile): FloorBand => (t.parent ? (t.cost <= moveBudget ? 'move' : 'dash') : 'stay');
    // Reach order is by cost, so every band's tiles come before the next band's.
    const lastOf = (band: FloorBand): number => {
        for (let i = reach.length - 1; i >= 0; i--) if (bandOf(reach[i]!) === band) return i;
        return -1;
    };
    const last: Record<FloorBand, number> = { stay: lastOf('stay'), move: lastOf('move'), dash: lastOf('dash') };
    let cursor = 0;
    const one = (): void => {
        const t = reach[cursor++]!;
        let node: FloorNode;
        if (!t.parent) node = { v: judge.base, steps: [], unknown: false, unsure: NOBODY, path: [] };
        else {
            const up = nodes.get(index(t.parent))!, isStart = !up.path.length;
            const passed = isStart ? NONE : endAt(judge, up.v, t.parent);
            node = {
                v: stepVariant(judge, up.v, t.parent, t.pos),
                steps: passed.length ? onePerObserver([...up.steps, ...passed]) : up.steps,
                unknown: up.unknown || (!isStart && knowledgeAt(judge, t.parent) !== 'scouted')
                    || doorMayRefuse(judge.world, judge.doubt, judge.member, t.parent, t.pos),
                unsure: isStart ? up.unsure : joined(up.unsure, nowDoubted(judge, up.v, t.parent)),
                path: [...up.path, { x: t.pos.x, y: t.pos.y }]
            };
        }
        nodes.set(index(t.pos), node);
        if (t.canEnd) tiles.push(floorTile(judge, t, node, bandOf(t)));
    };
    const job: Job = {
        last,
        upTo(i) { while (cursor <= i && cursor < reach.length) one(); },
        crew: crewId, from: { x: member.pos.x, y: member.pos.y }, tiles,
        get done() { return cursor >= reach.length; },
        has: bands => bands.every(b => cursor > last[b]),
        step(deadline, now) {
            while (cursor < reach.length) {
                one();
                if (now && deadline !== undefined && now() >= deadline) break;
            }
            return cursor >= reach.length;
        },
        floor(bands = ALL_BANDS) {
            const shown = tiles.filter(t => bands.includes(t.band));
            const byIndex = new Map(shown.map(t => [index(t.pos), t]));
            return { crew: crewId, from: { x: member.pos.x, y: member.pos.y }, tiles: shown, at: p => (p.x < 0 || p.x >= width ? undefined : byIndex.get(index(p))) };
        }
    };
    if (plain) {
        let byCrew = FLOORS.get(state);
        if (!byCrew) FLOORS.set(state, byCrew = new Map());
        byCrew.set(crewId, { world, job });
    }
    return job;
}

/**
 * The safe floor of a crew member (see the header): every tile they can end a Move (or a Dash, when allowed) on, and
 * their own tile, tinted. `bands` limits it to some of them (default all), stepping the shared job (`safeFloorJob`)
 * only as far as they need: the Move band comes before the Dash band, so it costs nothing extra to ask for it first.
 */
export function safeFloor(world: ReadonlyWorld, state: State, crewId: string, options: FloorOptions & { bands?: readonly FloorBand[] } = {}): SafeFloor {
    const job = jobFor(world, state, crewId, options);
    const bands = options.bands ?? ALL_BANDS;
    job.upTo(Math.max(-1, ...bands.map(b => job.last[b])));
    return job.floor(bands);
}

function floorTile(judge: Judge, t: ReachTile, node: FloorNode, band: FloorBand): FloorTile {
    const pos = { x: t.pos.x, y: t.pos.y };
    const end = band === 'stay' ? [] : endAt(judge, node.v, pos);
    const judged = judgeEnd(judge, node.v, pos, node.path, band === 'stay' ? 'stay' : band, node.steps, end, node.unsure);
    const knowledge = knowledgeAt(judge, pos), tint = tintOf(judged.now, judged.next, knowledge, node.unknown, judged.doubt, judged.teammates);
    return {
        pos, band, cost: t.cost, path: node.path, knowledge, unknownPath: node.unknown, now: judged.now, next: judged.next,
        teammates: judged.teammates, doorRisk: tint.doorRisk, unsure: judged.unsure, tint
    };
}

// ---------------------------------------------------------------------------------------------------------- A drawn path

/** One step of a drawn path. */
export interface PathStep {
    pos: Pos;
    /**
     * Every sighting of the crew member on it that does something, passing it or ending there alike (decision 46); the
     * move counts each observer once, at its worst along the path.
     */
    sightings: Sighting[];
    /** What the crew knows of the tile for passing or stopping on it. */
    knowledge: FloorKnowledge;
    /** A door the crew can't vouch for could let someone the crew knows react to the crew member here. */
    doubted: boolean;
    /**
     * Stopping here instead (the path cut after this step), judged as a floor tile: so a path stopped one short of the
     * eye shows its own colour. Null where the move can't end (someone stands there), or with `stops: false`.
     */
    stop: FloorTile | null;
}

export type PathSafety =
    | { ok: false; reason: string; at: number }
    | {
        ok: true;
        mode: MoveMode;
        /** The steps judged: the drawn path, without any tiles at its end it can't stop on (someone stands there). */
        steps: PathStep[];
        /** The first unsafe step (the eye icon, §8.8), so the player can stop one short; null when the whole path is safe. */
        firstUnsafe: number | null;
        /** The end of the path judged, as the safe floor judges a tile. */
        end: FloorTile;
        /** NPCs the crew knows that hear a dash. */
        heard: string[];
    };

/**
 * A path the player draws (§8.8 "along the whole drawn path"): the sightings of each tile, passed or ended on (decision
 * 46: each observer once, at its worst), then the coming world phase after it, on the crew's picture. A path within the
 * Move budget is a Move unless `mode` says Dash. The first unsafe step is the first tile passed that anyone reacts to,
 * or the end when the end's tint isn't safe. A path dragged onto tiles someone stands on (a mid-drag over a teammate)
 * is judged up to its last tile it can end on; one that can't be walked at all is refused. Each step also says what stopping there would do
 * (`stop`), unless `stops: false`.
 */
export function pathSafety(world: ReadonlyWorld, state: State, crewId: string, path: readonly Pos[], options: PathOptions = {}): PathSafety {
    const along = judgePath(world, state, crewId, path, options);
    if (!along.ok) return along;
    const { mode, steps, firstUnsafe, end, judged } = along;
    return { ok: true, mode, steps, firstUnsafe, end, heard: judged.heard };
}

export interface PathOptions extends FloorOptions {
    mode?: MoveMode;
    /** Judge stopping at every step too (default true). */
    stops?: boolean;
}

/** `pathSafety` with the sightings behind its end (for "who and why"). */
export function judgePath(
    world: ReadonlyWorld, state: State, crewId: string, drawn: readonly Pos[], options: PathOptions = {}
): { ok: false; reason: string; at: number } | { ok: true; mode: MoveMode; steps: PathStep[]; firstUnsafe: number | null; end: FloorTile; judged: Judged } {
    const judge = judgeFor(world, state, crewId, options.look);
    const member = crewMember(state, crewId);
    const plan = onFloor(planningState(world, state)), moves = planMoveOptions(world, state, member);
    const moveBudget = crewBudget(world, member, 'move'), dashBudget = crewBudget(world, member, 'dash');
    const people = occupancy(world, plan, moves);
    const free = (p: Pos): boolean => (people.get(p.y * world.width + p.x) ?? 'none') === 'none';
    // A drag that ends on someone (a teammate it may pass) is judged up to the last tile it can end on.
    let path = drawn;
    const first = validatePath(world, plan, member.pos, path, options.mode === 'move' ? moveBudget : dashBudget, moves);
    if (!first.ok && first.at === path.length - 1 && !free(path[path.length - 1]!)) {
        let k = path.length;
        while (k > 1 && !free(path[k - 1]!)) k--;
        path = path.slice(0, k);
    }
    const fits = (p: readonly Pos[], budget: number): PathCheck => validatePath(world, plan, member.pos, p, budget, moves);
    const asMove = fits(path, moveBudget);
    const mode: MoveMode = options.mode ?? (asMove.ok ? 'move' : 'dash');
    const check = mode === 'move' ? asMove : fits(path, dashBudget);
    if (!check.ok) return check;
    const refused = mode === 'dash' ? dashRefusal(world, state, crewId) : member.actionsLeft < MOVE_ACTIONS ? `${member.name} has no actions left` : null;
    if (refused) return { ok: false, reason: refused, at: 0 };
    let v = judge.base, prev: Pos = member.pos, unknown = false, unsure: readonly string[] = NOBODY;
    const steps: PathStep[] = [], passed: Sighting[] = [];
    let firstUnsafe: number | null = null;
    path.forEach((p, i) => {
        if (doorMayRefuse(world, judge.doubt, judge.member, prev, p)) unknown = true;
        v = stepVariant(judge, v, prev, p);
        const last = i === path.length - 1, knowledge = knowledgeAt(judge, p), here = nowDoubted(judge, v, p), doubted = here.length > 0;
        const sightings = endAt(judge, v, p);
        let stop: FloorTile | null = null;
        if (!last && options.stops !== false && free(p)) {
            const prefix = path.slice(0, i + 1);
            const as: MoveMode | null = options.mode === 'dash' ? 'dash' : fits(prefix, moveBudget).ok ? 'move' : 'dash';
            const judged = judgeEnd(judge, v, { x: p.x, y: p.y }, prefix, as, passed, endAt(judge, v, p), unsure);
            const tint = tintOf(judged.now, judged.next, knowledge, unknown, judged.doubt, judged.teammates);
            stop = {
                pos: { x: p.x, y: p.y }, band: as, cost: 0, path: prefix.map(q => ({ x: q.x, y: q.y })), knowledge, unknownPath: unknown,
                now: judged.now, next: judged.next, teammates: judged.teammates, doorRisk: tint.doorRisk, unsure: judged.unsure, tint
            };
            const cost = fits(prefix, dashBudget);
            if (cost.ok) stop.cost = cost.cost;
        }
        if (!last) {
            passed.push(...sightings);
            if (sightings.length && firstUnsafe === null) firstUnsafe = i;
        }
        if (!last && knowledge !== 'scouted') unknown = true;
        if (!last) unsure = joined(unsure, here);
        steps.push({ pos: { x: p.x, y: p.y }, sightings, knowledge, doubted, stop });
        prev = p;
    });
    const tile = path[path.length - 1]!;
    const judged = judgeEnd(judge, v, { x: tile.x, y: tile.y }, path, mode, passed, steps[steps.length - 1]!.sightings, unsure);
    const knowledge = steps[steps.length - 1]!.knowledge;
    const tint = tintOf(judged.now, judged.next, knowledge, unknown, judged.doubt, judged.teammates);
    const end: FloorTile = {
        pos: { x: tile.x, y: tile.y }, band: mode, cost: check.cost, path: path.map(p => ({ x: p.x, y: p.y })), knowledge, unknownPath: unknown,
        now: judged.now, next: judged.next, teammates: judged.teammates, doorRisk: tint.doorRisk, unsure: judged.unsure, tint
    };
    steps[steps.length - 1]!.stop = end;
    if (firstUnsafe === null && tintRank(end.tint) > 0) firstUnsafe = path.length - 1;
    return { ok: true, mode, steps, firstUnsafe, end, judged };
}

/** Judges ending the turn where the crew member stands (the `stay` tile), with the sightings behind it. */
export function judgeStay(world: ReadonlyWorld, state: State, crewId: string, options: FloorOptions = {}): Judged {
    const judge = judgeFor(world, state, crewId, options.look);
    return judgeEnd(judge, judge.base, { x: judge.member.pos.x, y: judge.member.pos.y }, [], 'stay', [], []);
}

/** Whether a tint warns of anything (not green, grey or hatched grey). */
export const tintRank = (t: Tint): number => (t.kind === 'safe' || t.kind === 'grey' || t.kind === 'unknownRisk' ? 0 : TINT_RANK[t.kind]);

/**
 * The safe floor as the world UI overlay draws it (src/scenes/bank/overlay.ts `safeFloor`): sage, one or two pips,
 * the hand of a challenge, the eye (an NPC Exposing them, or a camera's `!`, with `camera`), grey for hidden and
 * unknown; `next` for the hatched world-phase states; `doorRisk` where a door the crew can't vouch for could make a
 * warning worse (hatched over it). The pip state is the most pips any one NPC adds to one crew member this turn (the
 * move and the world phase together; 2 or more draws two), and `pips` lists them per NPC (a teammate's with `crew`);
 * `teammates` names the teammates the move does something to.
 */
export function overlayTiles(floor: Pick<SafeFloor, 'tiles'>): {
    pos: Pos; state: 'safe' | 'pip1' | 'pip2' | 'challenge' | 'exposed' | 'hidden' | 'unknown'; next?: boolean; camera?: boolean;
    pips?: { npc: string; pips: number; crew?: string }[]; doorRisk?: boolean; teammates?: string[];
}[] {
    return floor.tiles.map(t => {
        const k = t.tint;
        const state = k.kind === 'safe' ? 'safe' : k.kind === 'grey' ? 'hidden' : k.kind === 'unknownRisk' ? 'unknown'
            : k.kind === 'red' || k.kind === 'camera' ? 'exposed' : k.kind === 'trespass' ? 'challenge'
                : Math.max(...k.pips.map(p => p.pips)) >= 2 ? 'pip2' : 'pip1';
        return {
            pos: { x: t.pos.x, y: t.pos.y }, state, ...(k.hatched ? { next: true } : {}), ...(k.camera ? { camera: true } : {}),
            ...(k.pips.length ? { pips: k.pips.map(p => ({ ...p })) } : {}), ...(k.doorRisk && state !== 'unknown' ? { doorRisk: true } : {}),
            ...(k.teammates ? { teammates: [...k.teammates] } : {})
        };
    });
}
