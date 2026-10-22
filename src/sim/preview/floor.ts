import { clonePlain, samePlain } from '../core/json';
import { crewMember } from '../core/state';
import type { CrewState, DeepReadonly, Intent, NpcState, Pos, ReadonlyWorld, State } from '../core/types';
import { crewBudget, crewMoveOptions, dashRefusal, planningState, type MoveMode } from '../crew/movement';
import { MOVE_ACTIONS } from '../data/movement';
import { NOISES } from '../data/noise';
import { sightInputs, sightMap, type SightMap } from '../geo/los';
import { doorBetween, occupancy, reachable, validatePath, type PathCheck, type ReachTile } from '../geo/move';
import { DEAF_STATUSES, noiseRadius, npcsInside, soundRing, type Ring, type SoundTile } from '../geo/sound';
import { reactToNoise } from '../rules/evidence';
import { worldWalks } from '../rules/npc/walk';
import { isEyesDown } from '../rules/suspicion';
import { floorKnowledge, type FloorKnowledge } from '../rules/knowledge';
import {
    applySightings, assessEnd, assessStep, assessWorldPhase, posesAlong, sightsAlongWalk, worldPoses, type PoseAt, type Sighting, type WorldPoses
} from '../rules/perceive';
import { onFloor, placeCrew } from '../rules/place';
import type { CrewLook } from '../rules/profile';
import { applyWorldSightings, effectOf, noEffect, scratchCtx, type Effect } from './effect';
import { previewPicture } from './picture';

/*
 * The safe-floor overlay (GAME_DESIGN §8.8, implementation plan §2.2 and M1-09) and the path under the finger.
 *
 * `safeFloor(world, state, crew)` tints every tile the crew member can reach this action (the Move band, and the Dash
 * band when a dash is allowed) with what committing that move along the reach's path and then ending the turn would do
 * to them, as far as the crew can know: it judges on the crew's picture (`previewPicture`), never on the truth.
 *
 * - **Now** (solid): the move itself. `assessStep` on every tile passed (only `!` counts mid-move) and `assessEnd` on
 *   the last, each on the sight map with the doors the walk has opened so far, exactly as `assessPath` judges a move
 *   (the reach is a tree, so each tile's sightings are worked out once and shared by every path through it). A dash
 *   that someone of the picture hears first has them react (`reactToNoise`, the hearing hook of `makeNoise`, on a copy:
 *   their new intents). The sightings are then applied to the copy by `applySightings`, the one writer, and the effect
 *   is read off its events (`effectOf`).
 * - **Next** (hatched): the coming world phase after that move: `assessWorldPhase` on the state the move leaves (the
 *   doors it opened, what it made the NPCs want and so where they walk now), with every NPC's walk worked out once per
 *   door set (`worldPoses`) and only the walks that change walked again. Applied likewise.
 * - **Knowledge**: a tile nobody has seen is grey and never safe; a tile where someone the crew doesn't know about
 *   could be watching and would react to this crew member (`floorKnowledge` with the crew member: `unknownRisk`,
 *   `unknownWatcher`, decisions 24 and 43: an NPC on a tile a person can stand on that isn't fresh, a camera where the
 *   player can't see the layout), or reached past one (passing it: only an unknown `!`) or through grey, is hatched
 *   grey where the known NPCs leave it green.
 *
 * The tint is the worse of now and next (next only when strictly worse, then hatched): red (someone Exposes the crew
 * member, or one who already knows them sees them again: the eye) > camera (a camera sees a `!`, the operator's
 * verify) > trespass (a challenge) > amber (pips, by NPC) > green.
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
    /** Pips added this turn (the move and the world phase together), per NPC. */
    pips: { npc: string; pips: number }[];
    /** The eye: someone Exposes the crew member, or one who knows them sees them. */
    eye: boolean;
    /** A camera sees a `!` (with the eye too when an NPC does as well). */
    camera: boolean;
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
    /** The path passes an unscouted tile, or one where an unknown observer could see a `!`, before this one. */
    unknownPath: boolean;
    /** What the move does to the crew member now (its steps and its end). */
    now: Effect;
    /** What the coming world phase then does; null when the move already Exposes them (red can't get worse). */
    next: Effect | null;
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
 * of the two (hatched when next is strictly worse); the pips are every pip added this turn, per NPC, now and next
 * together; the camera flag is set when a camera reports in either phase that counts toward the kind (now's always).
 */
export function tintOf(now: DeepReadonly<Effect>, next: DeepReadonly<Effect> | null, knowledge: FloorKnowledge, unknownPath: boolean): Tint {
    const a = effectKind(now), b = next ? effectKind(next) : 'safe';
    const hatched = TINT_RANK[b] > TINT_RANK[a], kind = hatched ? b : a;
    const added: Record<string, number> = {};
    for (const e of next ? [now, next] : [now]) for (const id of Object.keys(e.pips)) added[id] = (added[id] ?? 0) + e.pips[id]!;
    const pips = Object.keys(added).sort().map(npc => ({ npc, pips: added[npc]! }));
    if (kind === 'safe') {
        const k: TintKind = knowledge === 'unscouted' ? 'grey' : knowledge === 'unknownRisk' || unknownPath ? 'unknownRisk' : 'safe';
        return { kind: k, hatched: false, pips: [], eye: false, camera: false };
    }
    return { kind, hatched, pips, eye: kind === 'red', camera: now.cameras.length > 0 || (hatched && next!.cameras.length > 0) };
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
    /** What the crew knows of each tile for this crew member, by index × 2 (+1 passing it mid-move), on demand. */
    knowledge: Map<number, FloorKnowledge>;
    /** Tiles from which a dash's noise could reach an NPC of the picture. */
    near: Uint8Array | null;
}

const JUDGES = new WeakMap<State, Map<string, Judge>>();

/** The judge of a crew member in a state (cached per state object, when judging their own look). */
export function judgeFor(world: ReadonlyWorld, state: State, crewId: string, look?: CrewLook): Judge {
    let byCrew = JUDGES.get(state);
    const cached = look ? undefined : byCrew?.get(crewId);
    if (cached?.world === world) return cached;
    const picture = previewPicture(world, state);
    const base: Variant = { doors: [], state: picture, sight: sightMap(world, picture), poses: null, hearers: new Map(), walls: sightInputs(world, picture) };
    const judge: Judge = {
        world, state, picture, crew: crewId, member: crewMember(picture, crewId), look, base, variants: new Map([['', base]]), seen: new Map(),
        knowledge: new Map(), near: null
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

/**
 * `floorKnowledge` of a tile for the judge's crew member and look, once per judge: ending a move there, or passing it
 * mid-move (`step`: only an unknown observer's `!` makes it unknown risk).
 */
function knowledgeAt(judge: Judge, p: DeepReadonly<Pos>, step = false): FloorKnowledge {
    const i = (p.y * judge.world.width + p.x) * 2 + (step ? 1 : 0);
    let k = judge.knowledge.get(i);
    if (!k) {
        const who = { crew: judge.crew, step, ...(judge.look ? { look: judge.look } : {}) };
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

/** Every sighting of ending an action on `tile` in a variant, those that do something (`assessEnd`), cached. */
function endAt(judge: Judge, v: Variant, tile: DeepReadonly<Pos>): Sighting[] {
    const key = `${tile.x},${tile.y} ${v.doors.join(' ')}`;
    let found = judge.seen.get(key);
    if (!found) judge.seen.set(key, found = assessEnd(judge.world, v.state, v.sight, judge.crew, { x: tile.x, y: tile.y }, judge.look ? { look: judge.look } : {}));
    return found;
}

/** Passing `tile` mid-move: only `!` (`assessStep`), asked only where ending there would see a `!` at all. */
function stepAt(judge: Judge, v: Variant, tile: DeepReadonly<Pos>): Sighting[] {
    if (!endAt(judge, v, tile).some(s => s.outcome === '!')) return [];
    return assessStep(judge.world, v.state, v.sight, judge.crew, { x: tile.x, y: tile.y }, judge.look ? { look: judge.look } : {});
}

const NOBODY: readonly string[] = [];

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
    const ring: Ring = { sources: path.map(p => ({ x: p.x, y: p.y })), radius: noiseRadius('dash'), tiles, byIndex: new Map(tiles.map(t => [t.pos.y * world.width + t.pos.x, t])), width: world.width };
    return { ring, hearers: v.state.npcs.filter(n => hearing.has(n.id)).map(n => n.id) };
}

/** What a move to `tile` judged on its way (`steps`, `end`) does now, and what the world phase does after it. */
export interface Judged {
    now: Effect;
    next: Effect | null;
    /** The sightings behind them, for "who and why". */
    nowSightings: Sighting[];
    nextSightings: Sighting[];
    /** NPCs of the picture that hear a dash. */
    heard: string[];
}

/** Judges ending a move (or the turn) on `tile` after `path` in variant `v`. */
export function judgeEnd(judge: Judge, v: Variant, tile: Pos, path: readonly Pos[], mode: MoveMode | 'stay', steps: readonly Sighting[], end: readonly Sighting[]): Judged {
    const { world, crew } = judge;
    const options = judge.look ? { look: judge.look } : {};
    const nowSightings = [...steps, ...end];
    const noise = mode === 'dash' && path.length ? dashRing(judge, v, path) : null;
    if (!nowSightings.length && !noise) {
        // Nothing happens now: the world phase from the state with the doors opened, the crew member on `tile`
        // (`assessWorldPhase` moves them there itself and walks again only the walks that changes).
        const nextSightings = assessWorldPhase(world, v.state, v.sight, crew, tile, { ...options, poses: posesOf(judge, v) });
        const next = nextSightings.length ? applyWorldSightings({ world }, placeCrew(v.state, crew, tile), crew, nextSightings) : noEffect();
        return { now: noEffect(), next, nowSightings, nextSightings, heard: [] };
    }
    // The move's own effects on a copy, in the order the move has them: the dash's noise, then the sightings. Hearing
    // and perception write into the NPCs that hear or see (copied whole), the camera reports and the barks; the intents
    // they rewrite (`reconsider`) replace an NPC's intent, goal and status and touch its route's `stalled`, so every
    // other NPC is copied shallowly with its route.
    const placed = placeCrew(v.state, crew, tile);
    const touched = new Set<string>([...nowSightings.map(s => s.observer), ...(noise?.hearers ?? [])]);
    const scratch: State = {
        ...placed,
        npcs: placed.npcs.map(n => (touched.has(n.id) ? clonePlain(n) : { ...n, route: n.route ? { ...n.route } : n.route })),
        cameraReports: [...placed.cameraReports], barked: [...placed.barked]
    };
    const { ctx, events } = scratchCtx({ world }, scratch);
    if (noise) reactToNoise(ctx, noise.ring, NOISES.dash.kind, `dash ${crew}`);
    applySightings(ctx, nowSightings);
    const now = effectOf(events, crew, v.state);
    const heard = noise?.hearers ?? [];
    if (now.exposed.length || now.watching.length) return { now, next: null, nowSightings, nextSightings: [], heard };
    const nextSightings = assessWorldPhase(world, scratch, v.sight, crew, tile, { ...options, poses: posesAfter(judge, v, scratch, tile) });
    const next = nextSightings.length ? applyWorldSightings({ world }, scratch, crew, nextSightings) : noEffect();
    return { now, next, nowSightings, nextSightings, heard };
}

// ---------------------------------------------------------------------------------------------------------- The floor

interface FloorNode { v: Variant; steps: Sighting[]; unknown: boolean; path: Pos[] }

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
    const reach = reachable(world, onFloor(planningState(world, state)), member.pos, budget, crewMoveOptions(member)).tiles;
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
        if (!t.parent) node = { v: judge.base, steps: [], unknown: false, path: [] };
        else {
            const up = nodes.get(index(t.parent))!, isStart = !up.path.length;
            const passed = isStart ? [] : stepAt(judge, up.v, t.parent);
            node = {
                v: stepVariant(judge, up.v, t.parent, t.pos),
                steps: passed.length ? [...up.steps, ...passed] : up.steps,
                unknown: up.unknown || (!isStart && knowledgeAt(judge, t.parent, true) !== 'scouted'),
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
    const judged = judgeEnd(judge, node.v, pos, node.path, band === 'stay' ? 'stay' : band, node.steps, end);
    const knowledge = knowledgeAt(judge, pos);
    return {
        pos, band, cost: t.cost, path: node.path, knowledge, unknownPath: node.unknown, now: judged.now, next: judged.next,
        tint: tintOf(judged.now, judged.next, knowledge, node.unknown)
    };
}

// ---------------------------------------------------------------------------------------------------------- A drawn path

/** One step of a drawn path. */
export interface PathStep {
    pos: Pos;
    /** The `!`s of passing it mid-move (on the last step: every sighting of ending there). */
    sightings: Sighting[];
    /** What the crew knows of the tile for stopping on it. */
    knowledge: FloorKnowledge;
    /** For passing it mid-move: unknown risk only where someone unknown could see a `!` (decision 24). */
    passing: FloorKnowledge;
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
 * A path the player draws (§8.8 "along the whole drawn path"): the `!`s of each tile passed (only `!` counts mid-move),
 * every sighting at its end, then the coming world phase after it, on the crew's picture. A path within the Move
 * budget is a Move unless `mode` says Dash. The first unsafe step is the first with a `!`, or the end when the end's
 * tint isn't safe. A path dragged onto tiles someone stands on (a mid-drag over a teammate) is judged up to its last
 * tile it can end on; one that can't be walked at all is refused. Each step also says what stopping there would do
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
    const plan = onFloor(planningState(world, state)), moves = crewMoveOptions(member);
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
    let v = judge.base, prev: Pos = member.pos, unknown = false;
    const steps: PathStep[] = [], passed: Sighting[] = [];
    let firstUnsafe: number | null = null;
    path.forEach((p, i) => {
        v = stepVariant(judge, v, prev, p);
        const last = i === path.length - 1, knowledge = knowledgeAt(judge, p);
        const sightings = last ? endAt(judge, v, p) : stepAt(judge, v, p);
        let stop: FloorTile | null = null;
        if (!last && options.stops !== false && free(p)) {
            const prefix = path.slice(0, i + 1);
            const as: MoveMode | null = options.mode === 'dash' ? 'dash' : fits(prefix, moveBudget).ok ? 'move' : 'dash';
            const judged = judgeEnd(judge, v, { x: p.x, y: p.y }, prefix, as, passed, endAt(judge, v, p));
            stop = {
                pos: { x: p.x, y: p.y }, band: as, cost: 0, path: prefix.map(q => ({ x: q.x, y: q.y })), knowledge, unknownPath: unknown,
                now: judged.now, next: judged.next, tint: tintOf(judged.now, judged.next, knowledge, unknown)
            };
            const cost = fits(prefix, dashBudget);
            if (cost.ok) stop.cost = cost.cost;
        }
        if (!last) {
            passed.push(...sightings);
            if (sightings.length && firstUnsafe === null) firstUnsafe = i;
        }
        const passing = knowledgeAt(judge, p, true);
        if (!last && passing !== 'scouted') unknown = true;
        steps.push({ pos: { x: p.x, y: p.y }, sightings, knowledge, passing, stop });
        prev = p;
    });
    const tile = path[path.length - 1]!;
    const judged = judgeEnd(judge, v, { x: tile.x, y: tile.y }, path, mode, passed, steps[steps.length - 1]!.sightings);
    const knowledge = steps[steps.length - 1]!.knowledge;
    const end: FloorTile = {
        pos: { x: tile.x, y: tile.y }, band: mode, cost: check.cost, path: path.map(p => ({ x: p.x, y: p.y })), knowledge, unknownPath: unknown,
        now: judged.now, next: judged.next, tint: tintOf(judged.now, judged.next, knowledge, unknown)
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
 * the hand of a challenge, the eye (an NPC Exposing them, or a camera's `!`, with `camera`), grey for unscouted and
 * unknown; `next` for the hatched world-phase states. The pip state is the most pips any one NPC adds this turn (the
 * move and the world phase together; 2 or more draws two), and `pips` lists them per NPC.
 */
export function overlayTiles(floor: Pick<SafeFloor, 'tiles'>): {
    pos: Pos; state: 'safe' | 'pip1' | 'pip2' | 'challenge' | 'exposed' | 'unscouted' | 'unknown'; next?: boolean; camera?: boolean; pips?: { npc: string; pips: number }[];
}[] {
    return floor.tiles.map(t => {
        const k = t.tint;
        const state = k.kind === 'safe' ? 'safe' : k.kind === 'grey' ? 'unscouted' : k.kind === 'unknownRisk' ? 'unknown'
            : k.kind === 'red' || k.kind === 'camera' ? 'exposed' : k.kind === 'trespass' ? 'challenge'
                : Math.max(...k.pips.map(p => p.pips)) >= 2 ? 'pip2' : 'pip1';
        return {
            pos: { x: t.pos.x, y: t.pos.y }, state, ...(k.hatched ? { next: true } : {}), ...(k.camera ? { camera: true } : {}),
            ...(k.pips.length ? { pips: k.pips.map(p => ({ ...p })) } : {})
        };
    });
}
