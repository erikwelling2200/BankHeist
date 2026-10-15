import { clonePlain, samePlain } from '../core/json';
import { crewMember } from '../core/state';
import type { CrewState, DeepReadonly, NpcState, Pos, ReadonlyWorld, State } from '../core/types';
import { crewBudget, crewMoveOptions, dashRefusal, planningState, type MoveMode } from '../crew/movement';
import { MOVE_ACTIONS } from '../data/movement';
import { NOISES } from '../data/noise';
import { sightInputs, sightMap, type SightMap } from '../geo/los';
import { doorBetween, reachable, validatePath, type ReachTile } from '../geo/move';
import { DEAF_STATUSES, noiseRadius, npcsInside, soundRing, type Ring } from '../geo/sound';
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
 * - **Knowledge**: a tile nobody has seen is grey and never safe; a tile that someone the crew doesn't know about
 *   could be watching (`floorKnowledge`: `unknownRisk`, decision 24), or reached through one, is hatched grey where the
 *   known NPCs leave it green.
 *
 * The tint is the worse of now and next (next only when strictly worse, then hatched): red (someone Exposes the crew
 * member, or one who already knows them sees them again: the eye) > camera (a camera sees a `!`, the operator's
 * verify) > trespass (a challenge) > amber (pips, by NPC) > green.
 *
 * Per-state data (the picture, the sight maps per door set, the NPCs' walks, each tile's sightings and knowledge) is
 * worked out once and cached per state object, for the other bands, `pathSafety` and `explain`. Measured on generated
 * banks in play (desktop Node, M1-09): the Move band 2 ms median, 5 ms p90 on every tier; a Dash band that NPCs hear
 * costs a reaction per tile (median 0–1.5 ms, p90 15–25 ms, up to ~100 ms beside a crowd), hence `bands`.
 */

export type TintKind = 'safe' | 'amber' | 'red' | 'trespass' | 'camera' | 'grey' | 'unknownRisk';

/** How a tile is drawn (§8.8). */
export interface Tint {
    kind: TintKind;
    /** It happens in the coming world phase as the NPCs walk their committed paths, not during the move. */
    hatched: boolean;
    /** Pips added, per NPC (amber, and on the way to red). */
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
    /** The path passes an unscouted or unknown-risk tile before this one. */
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

const RANK: Record<Exclude<TintKind, 'grey' | 'unknownRisk'>, number> = { safe: 0, amber: 1, trespass: 2, camera: 3, red: 4 };

function kindOf(e: DeepReadonly<Effect>): Exclude<TintKind, 'grey' | 'unknownRisk'> {
    if (e.exposed.length || e.watching.length) return 'red';
    if (e.cameras.length) return 'camera';
    if (e.challenged !== null) return 'trespass';
    return Object.keys(e.pips).length ? 'amber' : 'safe';
}

/** The tint of a tile from what happens now and next, and what the crew knows of it and its path. */
export function tintOf(now: DeepReadonly<Effect>, next: DeepReadonly<Effect> | null, knowledge: FloorKnowledge, unknownPath: boolean): Tint {
    const a = kindOf(now), b = next ? kindOf(next) : 'safe';
    const hatched = RANK[b] > RANK[a], e = hatched ? next! : now, kind = hatched ? b : a;
    const pips = Object.keys(e.pips).sort().map(npc => ({ npc, pips: e.pips[npc]! }));
    if (kind === 'safe') {
        const k: TintKind = knowledge === 'unscouted' ? 'grey' : knowledge === 'unknownRisk' || unknownPath ? 'unknownRisk' : 'safe';
        return { kind: k, hatched: false, pips: [], eye: false, camera: false };
    }
    return { kind, hatched, pips, eye: kind === 'red', camera: e.cameras.length > 0 };
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
    /** What the crew knows of each tile, by index (worked out on demand). */
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

/** `floorKnowledge` of a tile, once per judge. */
function knowledgeAt(judge: Judge, p: DeepReadonly<Pos>): FloorKnowledge {
    const i = p.y * judge.world.width + p.x;
    let k = judge.knowledge.get(i);
    if (!k) judge.knowledge.set(i, k = floorKnowledge(judge.world, judge.state, { x: p.x, y: p.y }));
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
    if (!base.paths.has(at(tile)) && !base.paths.has(at(judge.member.pos))
        && scratch.npcs.every(n => looksSame(n) && samePlain(n.intent, before.get(n.id)!.intent))) return base;
    const { walked } = worldWalks(world, scratch, null, null);
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
 * The ring of a dash along `path` and who of the picture hears it, or null when nobody does. Sound floods from every
 * tile of the path at once and reaches each tile at the cost from its nearest source, so the ring of the path is the
 * union of the rings of its tiles (`soundRing` of each, cached per wall state), each tile with the most reach left:
 * who hears it is asked of each tile's ring first, and the union is built only when someone does. The property test
 * checks it against `soundRing` of the whole path (which costs several times as much on a 12-tile dash).
 */
export function dashRing(judge: Judge, v: Variant, path: readonly DeepReadonly<Pos>[]): { ring: Ring; hearers: string[] } | null {
    const { world } = judge;
    const hearing = new Set<string>();
    for (const p of path) for (const id of tileHearers(judge, v, p)) hearing.add(id);
    if (!hearing.size) return null;
    const remaining = new Map<number, number>();
    for (const p of path) {
        for (const t of tileRing(world, v.state, v.walls, p).tiles) {
            const i = t.pos.y * world.width + t.pos.x;
            if ((remaining.get(i) ?? -1) < t.remaining) remaining.set(i, t.remaining);
        }
    }
    const tiles = [...remaining.keys()].sort((a, b) => a - b)
        .map(i => ({ pos: { x: i % world.width, y: (i - (i % world.width)) / world.width }, remaining: remaining.get(i)! }));
    const ring: Ring = {
        sources: path.map(p => ({ x: p.x, y: p.y })), radius: noiseRadius('dash'), tiles,
        byIndex: new Map(tiles.map(t => [t.pos.y * world.width + t.pos.x, t])), width: world.width
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
    // and perception change only the NPCs, the camera reports and the barks (and nothing else of the state is read
    // back), so only those are copied.
    const placed = placeCrew(v.state, crew, tile);
    const scratch: State = { ...placed, npcs: placed.npcs.map(n => clonePlain(n)), cameraReports: [...placed.cameraReports], barked: [...placed.barked] };
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

/** The reach of a crew member with each tile's path judged so far, and the tiles tinted so far (per band). */
interface FloorWork {
    judge: Judge;
    from: Pos;
    reach: { tile: ReachTile; band: FloorBand; node: FloorNode }[];
    tinted: Map<number, FloorTile>;
}

interface FloorNode { v: Variant; steps: Sighting[]; unknown: boolean; path: Pos[] }

const FLOORS = new WeakMap<State, Map<string, { world: ReadonlyWorld; work: FloorWork }>>();

const ALL_BANDS: readonly FloorBand[] = ['stay', 'move', 'dash'];

function floorWork(world: ReadonlyWorld, state: State, crewId: string, options: FloorOptions): FloorWork {
    const plain = options.look === undefined && options.dash === undefined;
    const hit = plain ? FLOORS.get(state)?.get(crewId) : undefined;
    if (hit?.world === world) return hit.work;
    const judge = judgeFor(world, state, crewId, options.look);
    const member = crewMember(state, crewId);
    const moveBudget = member.actionsLeft >= MOVE_ACTIONS ? crewBudget(world, member, 'move') : 0;
    const dash = (options.dash ?? true) && !dashRefusal(world, state, crewId);
    const budget = dash ? Math.max(moveBudget, crewBudget(world, member, 'dash')) : moveBudget;
    const reach = reachable(world, onFloor(planningState(world, state)), member.pos, budget, crewMoveOptions(member));
    const index = (p: Pos): number => p.y * world.width + p.x;
    const nodes = new Map<number, FloorNode>();
    const work: FloorWork = { judge, from: { x: member.pos.x, y: member.pos.y }, reach: [], tinted: new Map() };
    for (const t of reach.tiles) {
        let node: FloorNode;
        if (!t.parent) node = { v: judge.base, steps: [], unknown: false, path: [] };
        else {
            const up = nodes.get(index(t.parent))!, isStart = !up.path.length;
            const passed = isStart ? [] : stepAt(judge, up.v, t.parent);
            node = {
                v: stepVariant(judge, up.v, t.parent, t.pos),
                steps: passed.length ? [...up.steps, ...passed] : up.steps,
                unknown: up.unknown || (!isStart && knowledgeAt(judge, t.parent) !== 'scouted'),
                path: [...up.path, { x: t.pos.x, y: t.pos.y }]
            };
        }
        nodes.set(index(t.pos), node);
        if (t.canEnd) work.reach.push({ tile: t, band: t.parent ? (t.cost <= moveBudget ? 'move' : 'dash') : 'stay', node });
    }
    if (plain) {
        let byCrew = FLOORS.get(state);
        if (!byCrew) FLOORS.set(state, byCrew = new Map());
        byCrew.set(crewId, { world, work });
    }
    return work;
}

/**
 * The safe floor of a crew member (see the header): every tile they can end a Move (or a Dash, when allowed) on, and
 * their own tile, tinted. `bands` limits it to some of them (default all): the work is cached per state object, so a
 * scene can draw the Move band at once and the Dash band a frame later (a dash heard by NPCs is the dearest tile to
 * judge: their reactions are worked out for it) at the cost of one call.
 */
export function safeFloor(world: ReadonlyWorld, state: State, crewId: string, options: FloorOptions & { bands?: readonly FloorBand[] } = {}): SafeFloor {
    const work = floorWork(world, state, crewId, options);
    const bands = options.bands ?? ALL_BANDS, width = world.width, index = (p: Pos): number => p.y * width + p.x;
    const tiles: FloorTile[] = [];
    for (const { tile, band, node } of work.reach) {
        if (!bands.includes(band)) continue;
        const i = index(tile.pos);
        let tinted = work.tinted.get(i);
        if (!tinted) work.tinted.set(i, tinted = floorTile(work.judge, tile, node, band));
        tiles.push(tinted);
    }
    const byIndex = new Map(tiles.map(t => [index(t.pos), t]));
    return { crew: crewId, from: { ...work.from }, tiles, at: p => (p.x < 0 || p.x >= width ? undefined : byIndex.get(index(p))) };
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
    knowledge: FloorKnowledge;
}

export type PathSafety =
    | { ok: false; reason: string; at: number }
    | {
        ok: true;
        mode: MoveMode;
        steps: PathStep[];
        /** The first unsafe step (the eye icon, §8.8), so the player can stop one short; null when the whole path is safe. */
        firstUnsafe: number | null;
        /** The end of the path, judged as the safe floor judges a tile. */
        end: FloorTile;
        /** NPCs the crew knows that hear a dash. */
        heard: string[];
    };

/**
 * A path the player draws (§8.8 "along the whole drawn path"): the `!`s of each tile passed (only `!` counts mid-move),
 * every sighting at its end, then the coming world phase after it, on the crew's picture. A path within the Move
 * budget is a Move unless `mode` says Dash. The first unsafe step is the first with a `!`, or the end when the end's
 * tint isn't safe.
 */
export function pathSafety(world: ReadonlyWorld, state: State, crewId: string, path: readonly Pos[], options: FloorOptions & { mode?: MoveMode } = {}): PathSafety {
    const along = judgePath(world, state, crewId, path, options);
    if (!along.ok) return along;
    const { mode, steps, firstUnsafe, end, judged } = along;
    return { ok: true, mode, steps, firstUnsafe, end, heard: judged.heard };
}

/** `pathSafety` with the sightings behind its end (for "who and why"). */
export function judgePath(
    world: ReadonlyWorld, state: State, crewId: string, path: readonly Pos[], options: FloorOptions & { mode?: MoveMode } = {}
): { ok: false; reason: string; at: number } | { ok: true; mode: MoveMode; steps: PathStep[]; firstUnsafe: number | null; end: FloorTile; judged: Judged } {
    const judge = judgeFor(world, state, crewId, options.look);
    const member = crewMember(state, crewId);
    const plan = onFloor(planningState(world, state)), moves = crewMoveOptions(member);
    const asMove = validatePath(world, plan, member.pos, path, crewBudget(world, member, 'move'), moves);
    const mode: MoveMode = options.mode ?? (asMove.ok ? 'move' : 'dash');
    const check = mode === 'move' ? asMove : validatePath(world, plan, member.pos, path, crewBudget(world, member, 'dash'), moves);
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
        if (!last) {
            passed.push(...sightings);
            if (sightings.length && firstUnsafe === null) firstUnsafe = i;
            if (knowledge !== 'scouted') unknown = true;
        }
        steps.push({ pos: { x: p.x, y: p.y }, sightings, knowledge });
        prev = p;
    });
    const tile = path[path.length - 1]!;
    const judged = judgeEnd(judge, v, { x: tile.x, y: tile.y }, path, mode, passed, steps[steps.length - 1]!.sightings);
    const knowledge = steps[steps.length - 1]!.knowledge;
    const end: FloorTile = {
        pos: { x: tile.x, y: tile.y }, band: mode, cost: check.cost, path: path.map(p => ({ x: p.x, y: p.y })), knowledge, unknownPath: unknown,
        now: judged.now, next: judged.next, tint: tintOf(judged.now, judged.next, knowledge, unknown)
    };
    if (firstUnsafe === null && tintRank(end.tint) > 0) firstUnsafe = path.length - 1;
    return { ok: true, mode, steps, firstUnsafe, end, judged };
}

/** Judges ending the turn where the crew member stands (the `stay` tile), with the sightings behind it. */
export function judgeStay(world: ReadonlyWorld, state: State, crewId: string, options: FloorOptions = {}): Judged {
    const judge = judgeFor(world, state, crewId, options.look);
    return judgeEnd(judge, judge.base, { x: judge.member.pos.x, y: judge.member.pos.y }, [], 'stay', [], []);
}

/** Whether a tint warns of anything (not green, grey or hatched grey). */
export const tintRank = (t: Tint): number => (t.kind === 'safe' || t.kind === 'grey' || t.kind === 'unknownRisk' ? 0 : RANK[t.kind]);

/**
 * The safe floor as the world UI overlay draws it (src/scenes/bank/overlay.ts `safeFloor`): sage, one or two pips,
 * the hand of a challenge, the eye (an NPC Exposing them, or a camera's `!`), grey for unscouted and unknown; `next`
 * for the hatched world-phase states.
 */
export function overlayTiles(floor: SafeFloor): { pos: Pos; state: 'safe' | 'pip1' | 'pip2' | 'challenge' | 'exposed' | 'unscouted' | 'unknown'; next?: boolean; camera?: boolean }[] {
    return floor.tiles.map(t => {
        const k = t.tint;
        const state = k.kind === 'safe' ? 'safe' : k.kind === 'grey' ? 'unscouted' : k.kind === 'unknownRisk' ? 'unknown'
            : k.kind === 'red' || k.kind === 'camera' ? 'exposed' : k.kind === 'trespass' ? 'challenge'
                : Math.max(...k.pips.map(p => p.pips)) >= 2 ? 'pip2' : 'pip1';
        return { pos: { x: t.pos.x, y: t.pos.y }, state, ...(k.hatched ? { next: true } : {}), ...(k.camera ? { camera: true } : {}) };
    });
}
