import { registerCommandHook, type CommitResult } from '../core/engine';
import { facingToward, inBounds } from '../core/grid';
import { sortedIds } from '../core/json';
import { registerStateCheck } from '../core/save';
import { crewMember, registerRuleDefaults, registerStateInit } from '../core/state';
import type {
    CameraDef, CrewState, DeepReadonly, DoorState, DoorStatus, Facing, Intent, NpcState, NpcStatus, ObserverClass, Pos, ReadonlyWorld, SimEvent, State
} from '../core/types';
import { eventClass } from '../core/undo';
import { crewHasKey, registerMoveHook, registerPlanView } from '../crew/movement';
import type { Profile } from '../data/items';
import { OUTCOME_RANK, UNIFORMS, type Uniform } from '../data/matrix';
import type { NoiseKind } from '../data/noise';
import { bandAt, bandOf, fieldOn, profilesOf, rangeOn, seesOn, type Observer, type SightField, type VisionProfile } from '../geo/cones';
import { buildSightMap, lineOfSight, sightInputs, sightMap, type SightMap } from '../geo/los';
import { doorBetween, doorStatus, LYING_STATUSES } from '../geo/move';
import { inRing, registerNoiseHook, soundRing } from '../geo/sound';
import { liveFeeds } from './cctv';
import { reaction, type Reaction } from './perceive';
import { crewLook, type CrewLook } from './profile';
import { isWarned } from './trespass';
import { isPresent } from './npc/walk';
import { bodyPos, onFloor } from './place';
import { bitsCount, decodeBits, encodeBits } from './knowledgeBits';

/*
 * What the crew knows (GAME_DESIGN §8.8, §8.15, §17.8; implementation plan M1-10). The engine works on the truth; the
 * player sees the bank only through this. Kept in `State.knowledge`, updated after every command (crew actions and the
 * world phase alike, `registerCommandHook`), at every step of a crew move, and on every noise.
 *
 * - **Seen tiles** (the casing layer): every tile any crew member has seen (360°, 13 tiles, darkness halves it; the
 *   `crew` profile of geo/cones.ts), as a compact bitset string (implementation plan §5: the state is copied on every
 *   command).
 * - **Fresh tiles**: the tiles seen since the last world phase ended, reset to what the crew sees at the end of each
 *   world phase and added to by every step and command since. NPCs move only in the world phase, so nobody the crew
 *   doesn't know about stands on a fresh tile during the crew phase (§6 decision 24).
 * - **The blueprint layer** (§17.8) is data from the World: the exterior and the public floor are always known; Staff
 *   and Secure rooms only as outlines, unless the heist bought the Blueprints asset (`World.intel.blueprints`).
 * - **Tile visibility** (decision 44, `tileVisibility`): *hidden*, neither on the blueprint's layout nor ever seen
 *   (opaque dark grey, nothing in it shown, grey in the safe floor and never safe, §8.8); *seen*, a fresh tile (drawn as
 *   it is, people included); *stale*, every other tile (veiled). On a stale tile what doesn't move (the layout,
 *   furniture, cameras) is known; what moves (NPCs, doors) isn't: only the knowledge markers below and the doors as
 *   last seen. A public tile is never hidden.
 * - **NPCs** (§8.15): an NPC is *live* while any crew member sees its tile, and until the next world phase once seen
 *   in this crew phase (NPCs move only in the world phase, so it is still where it was seen); one seen on the way (a crew member's
 *   move, its own walk across the crew's view in the world phase, a bump) is known where it was last seen. Each turn
 *   it is seen counts toward its routine; after `knownRoutineTurns` (3) turns, in stealth and on its routine, its
 *   routine is *known* (for guards, with the Guard rota, `World.intel.guardRota`, from the start and again whenever
 *   they are back on it) and it is shown out of sight as a *predicted* marker: routines are deterministic in stealth,
 *   so the prediction is where its schedule has put it, which is where it is. Once anything knocks it off its routine
 *   (a want, the on-edge flag, a status other than calm or away, a goal not from its schedule) or the bank leaves
 *   stealth, the prediction stops and the routine is forgotten (the rota's aside): a *ghost* at its last known place.
 *   Ghosts (behind `rules.ghosts`, decision 16) stay `ghostTurns` (2) turns after the turn it was last seen or
 *   predicted, then go. NPCs the crew hasn't seen are not shown at all.
 * - **Unknown risk** (hatched grey, §8.8, decisions 24, 43 and 44): a tile that isn't hidden that someone the crew
 *   doesn't know about could see, each from where it could be (`isUnknownRisk`, cached per sight map and tile sets): an
 *   NPC, within its reach, from a tile a person can stand on that isn't fresh (stale or hidden); a camera, within a
 *   camera's reach, from a hidden tile; either looking through every door the crew can't vouch for as if open. There,
 *   at its worst (any class, Alerted, a camera taken as live), it would react to the crew member by the reaction rules
 *   (`unknownWatcher`). Green therefore means nobody, known or not, would do anything about them there.
 * - **Doors**: the status of each door last seen (a tile beside it in view). Doors move: one with no fresh tile beside
 *   it is pictured as last seen, or plain closed if never seen (`knownDoorStatus`), never as it is. Whether a door locks
 *   is layout, known unless only hidden tiles are beside it. A door the crew can't vouch for (`doorDoubt`: not seen this
 *   turn, in a status something unseen could change) makes a verdict it could change unknown: previews count a known
 *   observer whose sight or hearing of the crew it could decide as unknown (`projectEvents`), and the safe floor hatches
 *   such tiles (preview/floor.ts).
 * - **Sound pings**: a loud noise whose ring reaches any crew member is kept with its source tile and turn, in or out of
 *   sight; quiet noises aren't.
 * - **Cameras**: a camera is known from the start on the blueprint's layout (it is in plain view there, and cameras
 *   don't move), elsewhere once its tile has been seen. Its feed status (live, looped, dead) is unknown until
 *   the CCTV room (the room of a `cctvDesk`) is scouted; a camera of unknown status counts as live (§8.8). Once it is,
 *   the view also says which feeds are on the operator's monitors this turn (§8.12). With the CCTV room under control
 *   the crew sees through every camera that isn't looped or dead (`registerLookout`, rules/cameras.ts, §8.15).
 *
 * **Moving in unknown space.** Moves are planned on `crewPicture` (`registerPlanView`): an unseen NPC's tile reads as
 * open, and the move bumps into it; a door not seen this turn is as the crew last saw it, and a move through one found
 * locked stops before it (crew/movement.ts). Someone new coming into view doesn't stop a move (decision 40): the move
 * walks on, and reveals them.
 *
 * **Undo (§6.6).** Whenever something new becomes known (a tile, an NPC in view or out of hiding, a room, a camera, the
 * CCTV feeds, a routine) a `revealed` event is emitted, which blocks undo: a move through known space with nobody new
 * in view stays undoable; a move that shows anything new is final. A move an unseen NPC noticed is final too (its
 * perception check blocks undo), though the player is told nothing about who: `noticedUnseen` says so, for the UI's
 * "something stirred".
 *
 * **The projection** (what the Session, the overlay and the HUD may use; never the raw state):
 * - `knownView(world, state)`: markers (live, predicted, ghost), the seen, fresh and in-view tiles and each tile's
 *   visibility, doors as known, the blueprint, rooms and cameras, pings and the unknown-risk test. The overlay and the
 *   HUD draw only this.
 * - `projectEvents(world, after, events, before, { mode })`: drops events about NPCs (by any field that names one),
 *   cameras and doors the crew doesn't see, and cuts the lists of who heard a noise. `mode: 'preview'` (for
 *   `projectPreview`) judges by `before` only, drops `revealed` and shows a cut move along its drawn path, so a preview
 *   tells nothing the crew doesn't know yet; `'playback'` (the default; world-phase playback and committed actions)
 *   also tells about NPCs seen during the command.
 * - `crewPicture(world, state)` / `knownBlockers(world, state)`: the state as the crew pictures it (its NPCs and doors).
 */

/** The intel a heist bought (§18.2), as far as knowledge needs it. */
export interface Intel {
    /** The Blueprints asset: the full layout, not only the public floor. */
    blueprints?: boolean;
    /** The Guard rota asset: every guard's routine is known from the start. */
    guardRota?: boolean;
}

/** What the crew knows of one NPC it has seen (or was told about). */
export interface NpcKnowledge {
    /** Where it was last seen, or predicted. */
    at: Pos;
    facing: Facing;
    /** The turn it was last seen or predicted (a ghost reads "seen `turn now − turn` turns ago"). */
    turn: number;
    /** In view of a crew member at the last update. */
    live: boolean;
    /** Its routine is known: shown as a predicted marker while out of sight. */
    routine: boolean;
    /** Its routine came with the Guard rota: known again whenever it is back on it. */
    rota: boolean;
    /** How many turns it has been in view (toward a known routine); `watchedTurn` the last one counted. */
    watched: number;
    watchedTurn: number;
    /** `Knowledge.tick` when it was last seen (live or on the way). */
    tick: number;
}

/** A loud noise the crew heard (§8.15): where from (the source nearest the middle of its sources), when, what. */
export interface Ping { at: Pos; turn: number; kind: NoiseKind; cause: string }

export interface Knowledge {
    /** Every tile a crew member has seen, a bitset string (`knowledgeBits.ts`). */
    seen: string;
    /** The tiles seen since the last world phase ended (see the header), a bitset string. */
    fresh: string;
    /** Counts updates, so the projection can tell what was seen during a command. */
    tick: number;
    /** `tick` at the end of the last world phase: an NPC seen after it is still where it was seen (NPCs move only then). */
    phaseTick: number;
    /** Rooms with a seen tile, sorted. */
    rooms: string[];
    /** Cameras whose tile has been seen, sorted. */
    cameras: string[];
    /** Whether the CCTV room has been scouted: the cameras' feed status is known. */
    cctv: boolean;
    /** Each door's status when last seen, by door id. */
    doors: Record<string, DoorStatus>;
    /** What the crew knows of each NPC it has seen, by NPC id. */
    npcs: Record<string, NpcKnowledge>;
    /** Loud noises heard this turn and the last. */
    pings: Ping[];
}

declare module '../core/types' {
    interface State {
        /** What the crew knows (rules/knowledge.ts). */
        knowledge: Knowledge;
    }
    interface World {
        /** The intel the heist bought (Blueprints, Guard rota). Absent: none. */
        intel?: Intel;
    }
    interface Rules {
        /** Turns an NPC must be in view for its routine to be known (§8.15). */
        knownRoutineTurns: number;
        /** Fading ghosts (decision 16): on by default. */
        ghosts: boolean;
        /** How many turns a ghost stays after the turn it was last seen (§8.15). */
        ghostTurns: number;
        /** How many turns a sound ping stays after the turn it was heard. */
        pingTurns: number;
    }
}

registerRuleDefaults({ knownRoutineTurns: 3, ghosts: true, ghostTurns: 2, pingTurns: 1 });

const tilesOf = (world: ReadonlyWorld): number => world.width * world.height;

// ---------------------------------------------------------------------------------------------------------- Blueprint

/** The blueprint layer (§17.8) of a world: which tiles' layout is known, and which rooms show only as outlines. */
export interface Blueprint {
    /** Per tile, row-major: 1 when its layout is known (the exterior, the public floor, or everything with Blueprints). */
    readonly known: Uint8Array;
    /** Staff and Secure rooms drawn only as outlines (`?` rooms), sorted; empty with Blueprints. */
    readonly outlines: readonly string[];
}

const BLUEPRINTS = new WeakMap<ReadonlyWorld, Blueprint>();

function sharedBlueprint(world: ReadonlyWorld): Blueprint {
    let b = BLUEPRINTS.get(world);
    if (b) return b;
    const all = !!world.intel?.blueprints, known = new Uint8Array(tilesOf(world)), outlines = new Set<string>();
    world.tiles.forEach((t, i) => {
        if (all || t.room === null || t.zone === 'public') known[i] = 1;
        else outlines.add(t.room);
    });
    // A room with any non-public tile is an outline as a whole.
    if (!all) world.tiles.forEach((t, i) => { if (t.room !== null && outlines.has(t.room)) known[i] = 0; });
    BLUEPRINTS.set(world, b = Object.freeze({ known, outlines: Object.freeze([...outlines].sort()) }));
    return b;
}

/** The blueprint layer of a world; `known` is the caller's own copy. */
export function blueprint(world: ReadonlyWorld): Blueprint {
    const b = sharedBlueprint(world);
    return Object.freeze({ known: b.known.slice(), outlines: b.outlines });
}

// ---------------------------------------------------------------------------------------------------------- Doors

interface DoorSides { id: string; a: number; b: number }

const DOOR_SIDES = new WeakMap<ReadonlyWorld, readonly DoorSides[]>();

/** Each door with the indices of the tiles either side of it, in id order. */
function doorSides(world: ReadonlyWorld): readonly DoorSides[] {
    let sides = DOOR_SIDES.get(world);
    if (sides) return sides;
    const out: DoorSides[] = [], w = world.width, n = tilesOf(world);
    for (const id of sortedIds(world.doors)) {
        const edge = world.edges[world.doors[id]!.edge];
        if (!edge) continue;
        const a = edge.run === 'northSouth' ? edge.ty * w + edge.tx - 1 : (edge.ty - 1) * w + edge.tx;
        const b = edge.ty * w + edge.tx;
        out.push({ id, a: a >= 0 && a < n ? a : -1, b: b >= 0 && b < n ? b : -1 });
    }
    DOOR_SIDES.set(world, sides = out);
    return sides;
}

const sideIn = (bits: Uint8Array, d: DoorSides): boolean => (d.a >= 0 && bits[d.a] === 1) || (d.b >= 0 && bits[d.b] === 1);

// ---------------------------------------------------------------------------------------------------------- Visibility

/** How the player sees a tile (see the header, decision 44). */
export type TileVisibility = 'hidden' | 'stale' | 'seen';

/** `TileVisibility` by its code in a visibility map. */
export const VISIBILITY: readonly TileVisibility[] = ['hidden', 'stale', 'seen'];
const HIDDEN = 0, STALE = 1, SEEN = 2;

/** The crew's tile sets decoded, and each tile's visibility code, for the knowledge they were decoded from. */
interface TileSets { seenKey: string; freshKey: string; seen: Uint8Array; fresh: Uint8Array; visibility: Uint8Array }

const TILE_SETS = new WeakMap<ReadonlyWorld, TileSets>();

/** The tile sets of a state's knowledge, decoded once per change (shared: never change them). */
function tileSets(world: ReadonlyWorld, state: State): TileSets {
    const k = state.knowledge, cached = TILE_SETS.get(world);
    if (cached && cached.seenKey === k.seen && cached.freshKey === k.fresh) return cached;
    const n = tilesOf(world), seen = decodeBits(k.seen, n), fresh = decodeBits(k.fresh, n), layout = sharedBlueprint(world).known;
    const visibility = new Uint8Array(n);
    for (let i = 0; i < n; i++) visibility[i] = fresh[i] ? SEEN : seen[i] || layout[i] ? STALE : HIDDEN;
    const sets = { seenKey: k.seen, freshKey: k.fresh, seen, fresh, visibility };
    TILE_SETS.set(world, sets);
    return sets;
}

/** Each tile's visibility code (`VISIBILITY`), row-major; shared, so never change it. */
export const visibilityMap = (world: ReadonlyWorld, state: State): Uint8Array => tileSets(world, state).visibility;

/** How the player sees a tile: hidden, stale (not seen this turn) or seen this turn. Off the map: hidden. */
export function tileVisibility(world: ReadonlyWorld, state: State, p: Pos): TileVisibility {
    return inBounds(world, p) ? VISIBILITY[tileSets(world, state).visibility[p.y * world.width + p.x]!]! : 'hidden';
}

/**
 * A door's status as the crew pictures it: as it is while a tile beside it is seen this turn (nobody else touches a
 * door in the crew phase); else as last seen, or plain closed when never seen. Doors move, so never the truth behind that.
 */
export function knownDoorStatus(world: ReadonlyWorld, state: State, id: string): DoorStatus {
    const d = doorSides(world).find(s => s.id === id);
    if (d && sideIn(tileSets(world, state).fresh, d)) return doorStatus(world, state, id);
    return lastSeen(state.knowledge, id);
}

/** A door as last seen, or plain closed when never seen. */
const lastSeen = (k: DeepReadonly<Knowledge>, id: string): DoorStatus =>
    Object.hasOwn(k.doors, id) ? k.doors[id]! : 'closed';

/**
 * The doors of `state` whose pictured status (by what `knowing` knows: its doors not seen this turn as last seen) isn't
 * their status in `state`, as pictured, or null when every one is.
 */
function picturedDoors(world: ReadonlyWorld, knowing: State, state: State = knowing): Record<string, DoorState> | null {
    const fresh = tileSets(world, knowing).fresh, k = knowing.knowledge;
    let doors: Record<string, DoorState> | null = null;
    for (const d of doorSides(world)) {
        if (sideIn(fresh, d)) continue;
        const pictured = lastSeen(k, d.id);
        if (pictured === doorStatus(world, state, d.id)) continue;
        (doors ??= { ...state.doors })[d.id] = { ...(Object.hasOwn(state.doors, d.id) ? state.doors[d.id] : {}), status: pictured };
    }
    return doors;
}

/** `state` with every door not seen this turn in `knowing` as the crew pictures it (a shallow copy; `state` when none differ). */
export function withPicturedDoors(world: ReadonlyWorld, knowing: State, state: State = knowing): State {
    const doors = picturedDoors(world, knowing, state);
    return doors ? { ...state, doors } : state;
}

// ---------------------------------------------------------------------------------------------------------- Doubted doors

/**
 * Whether the crew can't vouch for a door's pictured status (decision 44): no tile beside it is seen this turn, and its
 * status is one something unseen could have changed (an NPC opens a closed or locked door it walks through; an open
 * leaf door swings shut at the end of a world phase, relocking if it locks). A breached or jammed door stays as it is,
 * and so does an open one that never swings shut (built open, or the vault's).
 */
function isDoubted(world: ReadonlyWorld, fresh: Uint8Array, k: DeepReadonly<Knowledge>, d: DoorSides): boolean {
    if (sideIn(fresh, d)) return false;
    const def = world.doors[d.id]!, pictured = lastSeen(k, d.id);
    if (pictured === 'breached' || pictured === 'jammed') return false;
    return !(pictured === 'open' && (def.start === 'open' || def.lock === 'vault'));
}

/**
 * What a verdict needs to tell whether it hangs on the doors the crew can't vouch for (`isDoubted`): a sight line or a
 * sound that some status of theirs lets through and another doesn't. Sight only grows as doors open, so whether `b` is
 * in sight from `a` can change with them exactly when it is with every door open and isn't with every door open but the
 * doubted ones (`open`, `shut`); likewise for a sound's reach with the other doors as they are (`doubtStates`).
 */
export interface DoorDoubt {
    /** The doubted doors. */
    doors: ReadonlySet<string>;
    /** Those with only hidden tiles beside them: whether they lock isn't known. */
    unknownLock: ReadonlySet<string>;
    /** Sight with every door open; with every door open but the doubted ones, shut. */
    open: SightMap;
    shut: SightMap;
    /** Per doubted door, the box of its two tiles (x0, y0, x1, y1): a line crosses its edge only through both. */
    boxes: Int32Array;
    /** The furthest any NPC or camera sees, in tiles. */
    reach: number;
}

const DOUBTED = new WeakMap<State, { world: ReadonlyWorld; ids: readonly string[] }>();

/** The ids of the doors the crew can't vouch for in a state (`isDoubted`), in id order. */
function doubtedIds(world: ReadonlyWorld, state: State): readonly string[] {
    const cached = DOUBTED.get(state);
    if (cached?.world === world) return cached.ids;
    const fresh = tileSets(world, state).fresh, ids = doorSides(world).filter(d => isDoubted(world, fresh, state.knowledge, d)).map(d => d.id);
    DOUBTED.set(state, { world, ids });
    return ids;
}

/**
 * `state` with every door the crew can't vouch for open: where someone unknown could see from, whatever those doors
 * really are (unknown risk). `state` itself when there are none.
 */
function doubtedOpen(world: ReadonlyWorld, state: State): State {
    const ids = doubtedIds(world, state);
    if (!ids.length) return state;
    const doors = { ...state.doors };
    for (const id of ids) doors[id] = { ...(Object.hasOwn(state.doors, id) ? state.doors[id] : {}), status: 'open' };
    return { ...state, doors };
}

const DOUBTS = new WeakMap<State, { world: ReadonlyWorld; doubt: DoorDoubt | null }>();

/** The doors the crew can't vouch for in a state and what judging around them needs, or null when there are none. */
export function doorDoubt(world: ReadonlyWorld, state: State): DoorDoubt | null {
    const cached = DOUBTS.get(state);
    if (cached?.world === world) return cached.doubt;
    const w = world.width, ids = new Set(doubtedIds(world, state)), box: number[] = [];
    for (const d of doorSides(world)) {
        // A door on the map's edge has no line across it.
        if (d.a < 0 || d.b < 0 || !ids.has(d.id)) continue;
        box.push(Math.min(d.a % w, d.b % w), Math.min(Math.floor(d.a / w), Math.floor(d.b / w)), Math.max(d.a % w, d.b % w), Math.max(Math.floor(d.a / w), Math.floor(d.b / w)));
    }
    let doubt: DoorDoubt | null = null;
    if (ids.size) {
        const doors = ids, open: Record<string, DoorState> = {}, shut: Record<string, DoorState> = {};
        for (const id of sortedIds(world.doors)) {
            const was = Object.hasOwn(state.doors, id) ? state.doors[id] : {};
            open[id] = { ...was, status: 'open' };
            shut[id] = { ...was, status: doors.has(id) ? 'closed' : 'open' };
        }
        const p = profilesOf(world);
        const reach = Math.max(...[p.calm, p.alerted, p.camera, p.darkCamera].flatMap(x => x.arcs.map(a => a.range)));
        const vis = tileSets(world, state).visibility, unknownLock = new Set<string>();
        for (const d of doorSides(world)) {
            if (ids.has(d.id) && (d.a < 0 || vis[d.a] === HIDDEN) && (d.b < 0 || vis[d.b] === HIDDEN)) unknownLock.add(d.id);
        }
        doubt = {
            doors, unknownLock, open: buildSightMap(world, { ...state, doors: open }), shut: buildSightMap(world, { ...state, doors: shut }),
            boxes: Int32Array.from(box), reach
        };
    }
    DOUBTS.set(state, { world, doubt });
    return doubt;
}

/** Whether some doubted door's edge could lie on the line from `a` to `b` (both its tiles within their box). */
function crossesDoubted(d: DoorDoubt, a: DeepReadonly<Pos>, b: DeepReadonly<Pos>): boolean {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y), box = d.boxes;
    for (let i = 0; i < box.length; i += 4) if (box[i]! >= x0 && box[i + 2]! <= x1 && box[i + 1]! >= y0 && box[i + 3]! <= y1) return true;
    return false;
}

/** Whether a doubted door could decide if `b` is in sight from `a` (within anyone's reach): see `DoorDoubt`. */
export function sightDoubted(d: DoorDoubt, a: DeepReadonly<Pos>, b: DeepReadonly<Pos>): boolean {
    if (Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) > d.reach || !crossesDoubted(d, a, b)) return false;
    return lineOfSight(d.open, a, b) && !lineOfSight(d.shut, a, b);
}

/** Whether a doubted door could decide if an observer as it stands sees `tile` (its arcs and range as well). */
export function viewDoubted(d: DoorDoubt, observer: Observer, tile: DeepReadonly<Pos>): boolean {
    if (!crossesDoubted(d, observer.pos, tile)) return false;
    const p = { x: tile.x, y: tile.y };
    return seesOn(d.open, observer, p) !== null && seesOn(d.shut, observer, p) === null;
}

/**
 * `state` with the doubted doors open and with them shut (closed; locked when they lock), every other door as it is,
 * and those in `keep` (opened on the way, so open whatever they were) as they are too: a sound reaches each tile, in
 * any status of the doubted doors, with no more than `open` leaves and no less than `shut`.
 */
export function doubtStates(world: ReadonlyWorld, state: State, d: DoorDoubt, keep: ReadonlySet<string> = new Set()): { open: State; shut: State } {
    const open = { ...state.doors }, shut = { ...state.doors };
    for (const id of d.doors) {
        if (keep.has(id)) continue;
        const was = Object.hasOwn(state.doors, id) ? state.doors[id] : {};
        open[id] = { ...was, status: 'open' };
        shut[id] = { ...was, status: world.doors[id]!.lock === 'none' ? 'closed' : 'locked' };
    }
    return { open: { ...state, doors: open }, shut: { ...state, doors: shut } };
}

/**
 * Whether a doubted door could refuse `member` the step from `a` to `b`: one with a lock they hold no key to (whether a
 * door locks is part of the layout), or one with only hidden tiles beside it, whose lock the crew can't know.
 */
export function doorMayRefuse(
    world: ReadonlyWorld, d: DoorDoubt | null, member: DeepReadonly<CrewState>, a: DeepReadonly<Pos>, b: DeepReadonly<Pos>
): boolean {
    if (!d || Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return false;
    const door = doorBetween(world, { x: a.x, y: a.y }, { x: b.x, y: b.y });
    if (!door || !d.doors.has(door.id) || crewHasKey(member, door)) return false;
    return door.lock !== 'none' || d.unknownLock.has(door.id);
}

// ---------------------------------------------------------------------------------------------------------- Routines

const ROUTINE_GOALS: ReadonlySet<string> = new Set(['still', 'routine', 'enter', 'away']);

/** Whether an NPC is following its schedule, untouched: what makes its known routine a true prediction. */
export function onRoutine(npc: DeepReadonly<NpcState>): boolean {
    return (npc.status === 'calm' || npc.status === 'away') && !npc.alerted && npc.wants.length === 0 && ROUTINE_GOALS.has(npc.goal.kind);
}

/** Whether the bank is still in stealth: routines are predicted and learnt only then. */
const inStealth = (state: State): boolean => !state.bank.loud && !state.bank.alarm;

// ---------------------------------------------------------------------------------------------------------- Updating

/** An NPC seen on the way, where and facing which way. */
interface Passed { pos: Pos; facing: Facing }

/** What a crew move saw on its way, before the command's end (by draft state). */
interface Pending {
    /** The tiles seen at its steps. */
    bits: Uint8Array;
    npcs: Map<string, Passed>;
}

const PENDING = new WeakMap<State, Pending>();

/** What a crew member sees from a tile: all round, so their facing doesn't matter (one cached field per tile). */
const lookout = (world: ReadonlyWorld, sight: SightMap, member: DeepReadonly<CrewState> | { pos: Pos }): SightField =>
    fieldOn(sight, { pos: member.pos, facing: 'n', profile: profilesOf(world).crew });

/** More eyes the crew sees through besides their own (the cameras, from a controlled CCTV room: rules/cameras.ts). */
export type Lookout = (world: ReadonlyWorld, state: State, sight: SightMap) => SightField[];

const LOOKOUTS = new Map<string, Lookout>();

/** Adds eyes the crew sees through (§8.15): their fields count as the crew's own. Lookouts run by name. */
export function registerLookout(name: string, look: Lookout): void {
    if (LOOKOUTS.has(name)) throw new Error(`Lookout '${name}' already exists`);
    LOOKOUTS.set(name, look);
}

/** The fields of every crew member now, and of whatever else they see through. */
function crewFields(world: ReadonlyWorld, state: State, sight: SightMap): SightField[] {
    const out = state.crew.map(c => lookout(world, sight, c));
    for (const name of [...LOOKOUTS.keys()].sort()) out.push(...LOOKOUTS.get(name)!(world, state, sight));
    return out;
}

const seenBy = (fields: readonly SightField[], p: Pos): boolean => fields.some(f => bandAt(f, p) !== null);

/** ORs the fields into the bits. */
function mark(bits: Uint8Array, fields: readonly SightField[], width: number): void {
    for (const f of fields) for (const p of f.tiles) bits[p.y * width + p.x] = 1;
}

function emptyKnowledge(world: ReadonlyWorld): Knowledge {
    const none = encodeBits(new Uint8Array(tilesOf(world)));
    return { seen: none, fresh: none, tick: 0, phaseTick: 0, rooms: [], cameras: [], cctv: false, doors: {}, npcs: {}, pings: [] };
}

/** NPCs the events show walking across the crew's fields (the world phase), or found by a cut move. */
function passedInEvents(state: State, events: readonly SimEvent[], fields: readonly SightField[], out: Map<string, Passed>): void {
    for (const e of events) {
        if (e.type === 'npcWalked') {
            let prev = e.from;
            for (const p of e.path) {
                if (seenBy(fields, p)) out.set(e.npc, { pos: { x: p.x, y: p.y }, facing: facingToward(prev, p) ?? 'n' });
                prev = p;
            }
        } else if (e.type === 'npcEntered') {
            if (seenBy(fields, e.at)) out.set(e.npc, { pos: { x: e.at.x, y: e.at.y }, facing: 'n' });
        } else if (e.type === 'moveCut' && e.reason === 'bump') {
            const npc = state.npcs.find(n => n.id === e.npc);
            if (npc) out.set(npc.id, { pos: { x: npc.pos.x, y: npc.pos.y }, facing: npc.facing });
        }
    }
}

export interface UpdateOptions {
    /** The command's events so far: NPCs walking across the crew's view, cut moves. */
    events?: readonly SimEvent[];
    /** The update at the end of a world phase: the fresh tiles start again from what the crew sees now. */
    worldPhase?: boolean;
}

/**
 * Brings what the crew knows up to date with the state (what everyone sees now, plus what a move and the events saw
 * on the way), and emits a `revealed` event for each thing that became known. The one writer of `State.knowledge`,
 * besides pings.
 */
export function updateKnowledge(world: ReadonlyWorld, state: State, emit: (event: SimEvent) => void, options: UpdateOptions = {}): void {
    const k = state.knowledge, n = tilesOf(world), sight = sightMap(world, state), fields = crewFields(world, state, sight);
    const pending = PENDING.get(state);
    PENDING.delete(state);
    k.tick++;
    const now = new Uint8Array(n);
    mark(now, fields, world.width);
    if (pending) for (let i = 0; i < n; i++) if (pending.bits[i]) now[i] = 1;
    // Seen ever.
    const before = decodeBits(k.seen, n), seen = before.slice();
    for (let i = 0; i < n; i++) if (now[i]) seen[i] = 1;
    const added = bitsCount(seen) - bitsCount(before);
    if (added) {
        k.seen = encodeBits(seen);
        emit({ type: 'revealed', what: 'tiles', id: String(added) });
        learnRoomsAndCameras(world, k, seen, before, emit);
    }
    // Seen since the last world phase.
    if (options.worldPhase) {
        // The phase ends at this tick; what the crew sees standing now is seen after it (the next tick), so an NPC in
        // view now counts as where it is until the next world phase, even once the crew looks away.
        k.phaseTick = k.tick++;
        const fresh = new Uint8Array(n);
        mark(fresh, fields, world.width);
        k.fresh = encodeBits(fresh);
    } else {
        const old = decodeBits(k.fresh, n);
        let grew = false;
        for (let i = 0; i < n && !grew; i++) if (now[i] && !old[i]) grew = true;
        if (grew) {
            const fresh = old.slice();
            for (let i = 0; i < n; i++) if (now[i]) fresh[i] = 1;
            k.fresh = encodeBits(fresh);
        }
    }
    for (const d of doorSides(world)) {
        if (!sideIn(now, d)) continue;
        const status = doorStatus(world, state, d.id);
        if (k.doors[d.id] !== status) k.doors[d.id] = status;
    }
    const passed = new Map<string, Passed>(pending?.npcs ?? []);
    if (options.events) passedInEvents(state, options.events, fields, passed);
    learnNpcs(world, state, fields, passed, emit, options.worldPhase ?? false);
    const oldest = state.turn - world.rules.pingTurns;
    if (k.pings.some(p => p.turn < oldest)) k.pings = k.pings.filter(p => p.turn >= oldest);
}

function learnRoomsAndCameras(world: ReadonlyWorld, k: Knowledge, bits: Uint8Array, before: Uint8Array, emit: (event: SimEvent) => void): void {
    const rooms = new Set(k.rooms), outline = new Set(sharedBlueprint(world).outlines), fresh: string[] = [];
    for (let i = 0; i < bits.length; i++) {
        if (!bits[i] || before[i]) continue;
        const room = world.tiles[i]!.room;
        if (room !== null && !rooms.has(room)) { rooms.add(room); fresh.push(room); }
    }
    if (fresh.length) {
        k.rooms = [...rooms].sort();
        // A public room's layout was known from the blueprint; casing a staff or secure room reveals it.
        for (const room of fresh.sort()) if (outline.has(room)) emit({ type: 'revealed', what: 'room', id: room });
    }
    const cams = new Set(k.cameras);
    for (const c of world.cameras) {
        if (cams.has(c.id) || !inBounds(world, c.pos)) continue;
        // On the blueprint's layout a camera is in plain view from the start; elsewhere once its tile is seen.
        const i = c.pos.y * world.width + c.pos.x;
        if (!bits[i] && !sharedBlueprint(world).known[i]) continue;
        cams.add(c.id);
        k.cameras = [...cams].sort();
        emit({ type: 'revealed', what: 'camera', id: c.id });
    }
    if (!k.cctv) {
        const desk = world.objects.find(o => o.kind === 'cctvDesk'
            && (o.room ? rooms.has(o.room) : inBounds(world, o.pos) && bits[o.pos.y * world.width + o.pos.x] === 1));
        if (desk) {
            k.cctv = true;
            emit({ type: 'revealed', what: 'cctv', id: desk.id });
        }
    }
}

function learnNpcs(
    world: ReadonlyWorld, state: State, fields: readonly SightField[], passed: ReadonlyMap<string, Passed>, emit: (event: SimEvent) => void, phaseEnd: boolean
): void {
    const k = state.knowledge, rules = world.rules, turn = state.turn, stealth = inStealth(state);
    for (const npc of state.npcs) {
        const pos = bodyPos(state, npc), live = isPresent(npc) && seenBy(fields, pos);
        const on = passed.get(npc.id);
        let rec = Object.hasOwn(k.npcs, npc.id) ? k.npcs[npc.id] : undefined;
        if (!rec && !live && !on) continue;
        const shown = !!rec && (rec.live || rec.routine);
        if (rec?.routine && (!onRoutine(npc) || !stealth)) {
            // Knocked off its routine (or the bank is loud): the prediction stops. Out of sight it is a ghost where it
            // was last predicted.
            rec.routine = false;
            rec.watched = 0;
        }
        if (live || on) {
            if (!shown) emit({ type: 'revealed', what: 'npc', id: npc.id });
            const where = live ? { pos, facing: npc.facing } : on!;
            rec ??= k.npcs[npc.id] = { at: { x: 0, y: 0 }, facing: 'n', turn, live: false, routine: false, rota: false, watched: 0, watchedTurn: 0, tick: 0 };
            rec.at = { x: where.pos.x, y: where.pos.y };
            rec.facing = where.facing;
            rec.turn = turn;
            rec.live = live;
            // Seen where it stands at the end of a world phase, it stays there until the next one (`markerKind`); seen
            // only on its walk during the phase, it may have walked on: that sighting is dated to the phase itself.
            rec.tick = live || !phaseEnd ? k.tick : k.phaseTick;
            if (rec.watchedTurn !== turn) { rec.watched++; rec.watchedTurn = turn; }
        } else if (rec) {
            rec.live = false;
        }
        if (rec && !rec.routine && (rec.rota || rec.watched >= rules.knownRoutineTurns) && onRoutine(npc) && stealth) {
            rec.routine = true;
            emit({ type: 'revealed', what: 'routine', id: npc.id });
        }
        if (rec && !rec.live && rec.routine) {
            // The known routine is the truth while it holds.
            rec.at = { x: npc.pos.x, y: npc.pos.y };
            rec.facing = npc.facing;
            rec.turn = turn;
        }
    }
}

registerStateInit('knowledge', (world, state) => {
    state.knowledge = emptyKnowledge(world);
    if (world.intel?.guardRota) {
        for (const person of world.people) {
            if (person.observer !== 'enforcer') continue;
            state.knowledge.npcs[person.id] = {
                at: { x: person.pos.x, y: person.pos.y }, facing: person.facing, turn: state.turn, live: false, routine: true, rota: true,
                watched: 0, watchedTurn: 0, tick: 0
            };
        }
    }
    // What the crew sees where it starts is known from the start: nothing to reveal, nothing to undo.
    updateKnowledge(world, state, () => {}, { worldPhase: true });
});

// After every command, the world phase included.
registerCommandHook('knowledge', (ctx, cmd, events) =>
    updateKnowledge(ctx.world, ctx.state, e => ctx.emit(e), { events, worldPhase: cmd.type === 'endTurn' }));

// A move sees on its way: every tile and NPC in view at each step counts, not only at its end.
registerMoveHook('knowledge', {
    step(ctx, member) {
        const { world, state } = ctx;
        let pending = PENDING.get(state);
        if (!pending) PENDING.set(state, pending = { bits: new Uint8Array(tilesOf(world)), npcs: new Map() });
        const field = lookout(world, sightMap(world, state), member);
        mark(pending.bits, [field], world.width);
        for (const npc of state.npcs) {
            if (isPresent(npc) && bandAt(field, npc.pos)) pending.npcs.set(npc.id, { pos: { x: npc.pos.x, y: npc.pos.y }, facing: npc.facing });
        }
    }
});

// Moves are planned on the crew's picture.
registerPlanView((world, state) => crewPicture(world, state));

// Loud noises reaching any crew member are heard wherever they come from (§8.15).
registerNoiseHook('knowledge', (ctx, ring, kind, cause) => {
    if (kind !== 'loud' || !ctx.state.crew.some(c => inRing(ring, c.pos)) || !ring.sources.length) return;
    // A noise from many tiles (a dash, a drill's run) pings where its sources centre.
    const s = ring.sources, cx2 = s.reduce((a, p) => a + p.x, 0) * 2, cy2 = s.reduce((a, p) => a + p.y, 0) * 2;
    let at = s[0]!, best = Infinity;
    for (const p of s) {
        const dx = p.x * 2 * s.length - cx2, dy = p.y * 2 * s.length - cy2, d = dx * dx + dy * dy;
        if (d < best) { best = d; at = p; }
    }
    ctx.state.knowledge.pings.push({ at: { x: at.x, y: at.y }, turn: ctx.state.turn, kind, cause });
});

// A loaded state's knowledge must be readable: its tile sets the size of the world, its records whole.
/**
 * `state` with every camera on the blueprint's layout known (a copy; `state` itself when all are): a heist saved before
 * they were known from the start resumes knowing them. Nothing is revealed: they were in plain view all along.
 */
export function withLayoutCameras(world: ReadonlyWorld, state: State): State {
    const k = state.knowledge, layout = sharedBlueprint(world).known;
    const missing = world.cameras.filter(c => inBounds(world, c.pos) && layout[c.pos.y * world.width + c.pos.x] && !k.cameras.includes(c.id));
    if (!missing.length) return state;
    return { ...state, knowledge: { ...k, cameras: [...k.cameras, ...missing.map(c => c.id)].sort() } };
}

registerStateCheck('knowledge', (state, world) => {
    const k = state.knowledge as Partial<Knowledge> | undefined;
    if (!k || typeof k !== 'object') return 'no knowledge';
    for (const key of ['seen', 'fresh'] as const) {
        if (typeof k[key] !== 'string') return `knowledge.${key} isn't a tile set`;
        try {
            decodeBits(k[key], world ? tilesOf(world) : k[key].length * 6);
        } catch (e) {
            return `knowledge.${key}: ${(e as Error).message}`;
        }
    }
    if (typeof k.tick !== 'number' || typeof k.phaseTick !== 'number' || typeof k.cctv !== 'boolean') return 'knowledge has no tick or cctv';
    if (!Array.isArray(k.rooms) || !Array.isArray(k.cameras) || !Array.isArray(k.pings)) return 'knowledge has no rooms, cameras or pings';
    if (!k.doors || typeof k.doors !== 'object' || !k.npcs || typeof k.npcs !== 'object') return 'knowledge has no doors or NPCs';
    for (const id of sortedIds(k.npcs)) {
        const r = k.npcs[id] as Partial<NpcKnowledge> | undefined;
        if (!r || !r.at || typeof r.turn !== 'number' || typeof r.routine !== 'boolean' || typeof r.live !== 'boolean'
            || typeof r.rota !== 'boolean' || typeof r.watched !== 'number' || typeof r.tick !== 'number') return `knowledge of NPC '${id}' is incomplete`;
    }
    return undefined;
});

// ---------------------------------------------------------------------------------------------------------- Unknown risk

/**
 * How far someone the crew doesn't know about could see a tile from, by kind: an NPC, taken Alerted, its longest arc
 * (8); a camera, its profile's (7; the dark camera's when any camera here sees in the dark). On a dark tile half that,
 * and none for a camera that is blind in the dark (-1).
 */
export function unknownReach(world: ReadonlyWorld, by: 'npc' | 'camera', lit = true): number {
    const profile = by === 'npc' ? profilesOf(world).alerted : unknownCamera(world);
    if (!lit && profile.blindInDark) return -1;
    return rangeOn(Math.max(...profile.arcs.map(arc => arc.range)), lit);
}

/** The profile an unknown camera is taken to have: the dark camera's when any camera here sees in the dark. */
function unknownCamera(world: ReadonlyWorld): VisionProfile {
    const profiles = profilesOf(world);
    return world.cameras.some(cam => cam.seesInDark) ? profiles.darkCamera : profiles.camera;
}

/**
 * Unknown space as seen from each tile, worked out on demand: per tile, the nearest place an unknown NPC could stand
 * with a clear line of sight within its reach (`far`), the nearest such within frisk range (`close`), and the nearest
 * place an unknown camera could hang within a camera's reach (`camera`), as tile indices; -1 none, -2 not worked out
 * yet (`nearestUnknown`). With the decoded tile sets and the sight map it is worked out on. Shared by every state with
 * the same walls and sets (keyed), and remembered per state object too, so asking about many tiles of one state doesn't
 * rebuild the key each time. All crew-independent: what a crew member makes of them is `unknownWatcher`.
 */
interface RiskCache {
    key: string; far: Int32Array; close: Int32Array; camera: Int32Array; fresh: Uint8Array; sight: SightMap;
    /** Each tile's visibility code (`visibilityMap`). */
    visibility: Uint8Array;
}

const RISK = new WeakMap<ReadonlyWorld, RiskCache[]>();
const RISK_BY_STATE = new WeakMap<State, { world: ReadonlyWorld; cache: RiskCache }>();
const RISK_KEEP = 4;

function riskCache(world: ReadonlyWorld, state: State): RiskCache {
    const hit = RISK_BY_STATE.get(state);
    if (hit?.world === world) return hit.cache;
    // Seen with the doors the crew can't vouch for open: someone unknown could look through any of them.
    const seenAs = doubtedOpen(world, state), key = `${sightInputs(world, seenAs)}#${state.knowledge.seen}#${state.knowledge.fresh}`;
    let list = RISK.get(world);
    if (!list) RISK.set(world, list = []);
    let cache = list.find(c => c.key === key);
    if (!cache) {
        const n = tilesOf(world), sets = tileSets(world, state);
        cache = {
            key, far: new Int32Array(n).fill(-2), close: new Int32Array(n).fill(-2), camera: new Int32Array(n).fill(-2), fresh: sets.fresh,
            sight: sightMap(world, seenAs), visibility: sets.visibility
        };
        list.unshift(cache);
        if (list.length > RISK_KEEP) list.length = RISK_KEEP;
    }
    RISK_BY_STATE.set(state, { world, cache });
    return cache;
}

/** The offsets within a radius, nearest first (ties in row order): the order unknown space is searched in. */
const OFFSETS = new Map<number, Int32Array>();

function offsetsWithin(r: number): Int32Array {
    let found = OFFSETS.get(r);
    if (found) return found;
    const list: [number, number][] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) list.push([dx, dy]);
    list.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);
    OFFSETS.set(r, found = Int32Array.from(list.flat()));
    return found;
}

/**
 * Where someone the crew doesn't know about could be (decisions 43 and 44): an NPC on a tile that isn't fresh (stale or
 * hidden) and that a person can stand on (not furniture: what movement can't enter, `blocksMove`); a camera on a hidden
 * tile (a camera anywhere else would be known, and cameras don't move).
 */
function unknownNpcAt(world: ReadonlyWorld, c: RiskCache, j: number): boolean {
    return !c.fresh[j] && !world.tiles[j]!.blocksMove;
}

const unknownCameraAt = (c: RiskCache, j: number): boolean => c.visibility[j] === HIDDEN;

/**
 * The nearest place someone unknown sees `p` from, worked out once per cache: an NPC's (`far`), an NPC's within frisk
 * range (`close`), or a camera's (`camera`), each within its own reach.
 */
function nearestUnknown(world: ReadonlyWorld, c: RiskCache, p: Pos, kind: 'far' | 'close' | 'camera'): number {
    const w = world.width, i = p.y * w + p.x, memo = c[kind];
    if (memo[i] !== -2) return memo[i]!;
    let found = -1;
    const r = c.visibility[i] !== HIDDEN ? unknownReach(world, kind === 'camera' ? 'camera' : 'npc', world.tiles[i]!.lit) : -1;
    if (r >= 0) {
        const offsets = offsetsWithin(r), frisk = kind === 'close' ? world.rules.friskRange : Infinity;
        for (let k = 0; k < offsets.length; k += 2) {
            const dx = offsets[k]!, dy = offsets[k + 1]!, x = p.x + dx, y = p.y + dy;
            if (Math.max(Math.abs(dx), Math.abs(dy)) > frisk || x < 0 || y < 0 || x >= w || y >= world.height) continue;
            const j = y * w + x;
            if (kind === 'camera' ? !unknownCameraAt(c, j) : !unknownNpcAt(world, c, j)) continue;
            // Someone could stand on a stale tile itself.
            if ((!dx && !dy) || lineOfSight(c.sight, { x, y }, p)) { found = j; break; }
        }
    }
    memo[i] = found;
    return found;
}

/**
 * Whether a tile that isn't hidden can be seen from unknown space, with a clear line of sight: a tile a person can stand
 * on that isn't fresh (not seen since the last world phase, the tile itself included) within an NPC's reach, or a
 * hidden tile within a camera's (each halved when the tile is dark; none for a camera blind in the dark), so someone the
 * crew doesn't know about could be there and see it. Hidden tiles are grey, not this. Whether that matters to a crew
 * member is `unknownWatcher` (decision 24): this is the geometry alone.
 */
export function isUnknownRisk(world: ReadonlyWorld, state: State, p: Pos): boolean {
    if (!inBounds(world, p)) return false;
    const c = riskCache(world, state);
    return nearestUnknown(world, c, p, 'far') >= 0 || nearestUnknown(world, c, p, 'camera') >= 0;
}

/** Someone the crew doesn't know about who could react to a crew member on a tile, at worst (decision 24). */
export interface UnknownWatcher {
    by: 'npc' | 'camera';
    /** The observer class it is taken to be (a camera reads as an enforcer). */
    observer: ObserverClass;
    /** The role it is taken to have (one who sees through a uniform), or null. */
    role: string | null;
    /** A tile it could look from: unknown space with a clear line of sight. */
    from: Pos;
    /** What it would do, by the reaction rules (perceive.ts `reaction`); `reaction.profile` is the profile it reads. */
    reaction: Reaction;
    /** The crew member's own profile, as the HUD shows it. */
    profile: Profile;
}

export interface UnknownOptions {
    /** Judge this look instead of the crew member's own (a loadout change being previewed). */
    look?: CrewLook;
    /** A tile passed in the middle of a move: only `!` counts (§8.5). */
    step?: boolean;
}

/**
 * The unknown NPCs taken as the worst case: every class, and every role that sees through a uniform as the class it
 * has in this bank's roster (any class, if nobody here has it). Per world.
 */
const UNKNOWN_NPCS = new WeakMap<ReadonlyWorld, readonly { observer: ObserverClass; role: string | null }[]>();

function unknownNpcs(world: ReadonlyWorld): readonly { observer: ObserverClass; role: string | null }[] {
    let found = UNKNOWN_NPCS.get(world);
    if (found) return found;
    const classes: readonly ObserverClass[] = ['enforcer', 'staff', 'civilian'];
    const list: { observer: ObserverClass; role: string | null }[] = classes.map(observer => ({ observer, role: null }));
    for (const role of new Set(sortedIds(UNIFORMS).flatMap(u => UNIFORMS[u as Uniform].seenThroughBy))) {
        const as = [...new Set(world.people.filter(p => p.role === role).map(p => p.observer))];
        for (const observer of as.length ? as : classes) list.push({ observer, role });
    }
    UNKNOWN_NPCS.set(world, found = list);
    return found;
}

/**
 * Whether anyone the crew doesn't know about could react to this crew member on `p` (hatched grey, §8.8, decision
 * 24), and the worst such: `p` isn't hidden, and a place an unknown NPC could stand or an unknown camera hang
 * (`isUnknownRisk`'s unknown space, `p` itself included for an NPC) sees it, from where that observer, at its worst,
 * would do something by the very rules perception
 * uses (`reaction`: the matrix, the profile as read, uniforms, Notoriety, frisk range). At its worst means any class
 * (and the manager or the security chief, who see through a uniform), Alerted (one profile higher; both arcs Core,
 * reaching 6 and 8), facing the tile; or a camera of unknown status, taken as live. The distance from that tile
 * decides the band and frisk range. Trespass counts; on a tile passed mid-move (`step`) only `!` does. Null when
 * nobody unknown could change anything there, or `p` is hidden (grey, which is never safe anyway).
 *
 * A reaction only grows as the observer comes nearer (a nearer tile is in every band and range a further one is) and
 * within frisk range, so the worst is that of the nearest NPC's place in sight, of the nearest within frisk range, or of
 * the nearest camera's place: each worked out once per tile and shared by every crew member (`nearestUnknown`). On a
 * tie the NPC's nearest place wins, then its nearest within frisk range, then the camera.
 */
export function unknownWatcher(world: ReadonlyWorld, state: State, crewId: string, p: Pos, options: UnknownOptions = {}): UnknownWatcher | null {
    if (!inBounds(world, p)) return null;
    const c = riskCache(world, state), far = nearestUnknown(world, c, p, 'far'), camera = nearestUnknown(world, c, p, 'camera');
    if (far < 0 && camera < 0) return null;
    const close = far < 0 ? -1 : nearestUnknown(world, c, p, 'close'), worst = worstFrom(world, state, crewId, p, options);
    let best: UnknownWatcher | null = null;
    const look = (q: number, npc: boolean): void => {
        const w = worst({ x: q % world.width, y: Math.floor(q / world.width) }, npc, !npc);
        if (w && (!best || OUTCOME_RANK[w.reaction.outcome] > OUTCOME_RANK[best.reaction.outcome])) best = w;
    };
    if (far >= 0) look(far, true);
    if (close >= 0 && close !== far) look(close, true);
    if (camera >= 0) look(camera, false);
    return best;
}

/**
 * Every tile someone unknown could react to this crew member on `p` from, each with the worst there, nearest first:
 * `unknownWatcher`'s searches without stopping at the nearest (an NPC's places and a camera's, each within its reach
 * of `p` and in sight of it), judged by the same worst case. Non-empty exactly when `unknownWatcher`
 * finds someone, whose `from` is among them. On demand: for the one tile held (§8.8 "who and why").
 */
export function unknownWatchers(world: ReadonlyWorld, state: State, crewId: string, p: Pos, options: UnknownOptions = {}): UnknownWatcher[] {
    if (!inBounds(world, p)) return [];
    const c = riskCache(world, state), w = world.width;
    if (c.visibility[p.y * w + p.x] === HIDDEN) return [];
    const lit = world.tiles[p.y * w + p.x]!.lit, npcs = unknownReach(world, 'npc', lit), cameras = unknownReach(world, 'camera', lit);
    const offsets = offsetsWithin(Math.max(npcs, cameras)), worst = worstFrom(world, state, crewId, p, options);
    const out: UnknownWatcher[] = [];
    for (let k = 0; k < offsets.length; k += 2) {
        const dx = offsets[k]!, dy = offsets[k + 1]!, x = p.x + dx, y = p.y + dy;
        if (x < 0 || y < 0 || x >= w || y >= world.height) continue;
        const j = y * w + x, d = dx * dx + dy * dy;
        const npc = d <= npcs * npcs && unknownNpcAt(world, c, j), camera = d <= cameras * cameras && unknownCameraAt(c, j);
        if (!npc && !camera) continue;
        // Someone could stand on a stale tile itself.
        if ((dx || dy) && !lineOfSight(c.sight, { x, y }, p)) continue;
        const found = worst({ x, y }, npc, camera);
        if (found) out.push(found);
    }
    return out;
}

/**
 * The worst an unknown observer on a given tile could do to this crew member on `p`, or null (`unknownWatcher`): an
 * NPC there when `npc`, a camera when `cam`, the NPCs judged first.
 */
function worstFrom(world: ReadonlyWorld, state: State, crewId: string, p: Pos, options: UnknownOptions): (from: Pos, npc: boolean, cam: boolean) => UnknownWatcher | null {
    const member = crewMember(state, crewId), look = options.look ?? crewLook(member), rules = world.rules;
    const tile = world.tiles[p.y * world.width + p.x]!, profiles = profilesOf(world), camera = unknownCamera(world);
    const warnedByAny = isWarned(state, crewId);
    return (from, npc, cam) => {
        let best: UnknownWatcher | null = null;
        const facing = facingToward(from, p) ?? 'n', chebyshev = Math.max(Math.abs(p.x - from.x), Math.abs(p.y - from.y));
        const dx = p.x - from.x, dy = p.y - from.y;
        const consider = (by: 'npc' | 'camera', observer: ObserverClass, role: string | null): void => {
            const band = bandOf(by === 'npc' ? profiles.alerted : camera, facing, dx, dy, tile.lit);
            if (!band) return;
            const r = reaction(rules, {
                look, notoriety: member.notoriety, observer, role, camera: by === 'camera', alerted: by === 'npc', band, zone: tile.zone, chebyshev,
                warnedByThis: false, warnedByAny
            });
            if (options.step ? r.outcome !== '!' : r.outcome === '-') return;
            if (!best || OUTCOME_RANK[r.outcome] > OUTCOME_RANK[best.reaction.outcome]) best = { by, observer, role, from, reaction: r, profile: look.profile };
        };
        if (npc) for (const n of unknownNpcs(world)) consider('npc', n.observer, n.role);
        if (cam) consider('camera', 'enforcer', null);
        return best;
    };
}

/**
 * What the crew knows of a floor tile, for the safe floor (§8.8): `hidden` (decision 44) is grey and never safe;
 * `unknownRisk` is hatched grey (a tile the crew's known NPCs leave green still reads hatched grey); `scouted` is judged
 * by the known NPCs alone. Without `crew` it is the geometry (`isUnknownRisk`: someone unknown could see the tile); with it, only
 * where someone unknown could react to that crew member there (`unknownWatcher`, decision 24).
 */
export type FloorKnowledge = 'hidden' | 'unknownRisk' | 'scouted';

export function floorKnowledge(world: ReadonlyWorld, state: State, p: Pos, crew?: UnknownOptions & { crew: string }): FloorKnowledge {
    if (!inBounds(world, p) || riskCache(world, state).visibility[p.y * world.width + p.x] === HIDDEN) return 'hidden';
    if (crew) return unknownWatcher(world, state, crew.crew, p, crew) ? 'unknownRisk' : 'scouted';
    return isUnknownRisk(world, state, p) ? 'unknownRisk' : 'scouted';
}

// ---------------------------------------------------------------------------------------------------------- Projection

export type MarkerKind = 'live' | 'predicted' | 'ghost';

/** An NPC as the player may see it. */
export interface NpcMarker {
    id: string;
    kind: MarkerKind;
    pos: Pos;
    facing: Facing;
    /** Turns since it was last seen (a ghost's "seen 1 turn ago"); 0 for live and predicted ones. */
    seenAgo: number;
    /** Live and predicted: its status badge and the intent it telegraphs (a predicted marker's route). */
    status?: NpcStatus;
    intent?: DeepReadonly<Intent>;
}

export interface KnownCamera {
    id: string;
    pos: Pos;
    facings: DeepReadonly<CameraDef['facings']>;
    /** Unknown until the CCTV room is scouted; an unknown one counts as live (§8.8). A looped feed is off. */
    status: 'live' | 'off' | 'unknown';
    /** Once the CCTV room is scouted (§8.12): whether its feed is on the operator's monitors this turn. */
    monitored?: boolean;
    /** Once the CCTV room is scouted: the turn whose world phase is the last of its loop, if looped. */
    loopedUntil?: number;
}

/**
 * A door as the crew knows it: its status when last seen, whether a crew member sees it now, and whether a tile beside
 * it was seen this turn (else its status may have changed since: decision 44).
 */
export interface KnownDoor { id: string; status: DoorStatus; inView: boolean; fresh: boolean }

/** What the player may see (§8.15, §17.8): the overlay and the HUD draw only this. */
export interface KnownView {
    width: number;
    height: number;
    /** Per tile, row-major: 1 once seen by the crew (the casing layer). */
    seen: Uint8Array;
    /** Per tile, row-major: 1 when seen since the last world phase (nobody unknown stands there). */
    fresh: Uint8Array;
    /** Per tile, row-major: 1 while a crew member sees it now. */
    inView: Uint8Array;
    /** Per tile, row-major: its visibility code (`VISIBILITY`: hidden, stale, seen this turn). */
    visibility: Uint8Array;
    blueprint: Blueprint;
    rooms: readonly string[];
    npcs: NpcMarker[];
    cameras: KnownCamera[];
    doors: KnownDoor[];
    pings: readonly Ping[];
    /** Whether a tile is unknown risk (hatched grey); worked out on demand, cached. */
    unknownRisk(p: Pos): boolean;
}

/** How the crew knows of an NPC now, or null when it doesn't show at all. */
export function markerKind(world: ReadonlyWorld, state: State, id: string): MarkerKind | null {
    const rec = Object.hasOwn(state.knowledge.npcs, id) ? state.knowledge.npcs[id]! : undefined;
    if (!rec) return null;
    // Seen since the last world phase: it hasn't moved since, so it is where it was seen.
    if (rec.live || rec.tick > state.knowledge.phaseTick) return 'live';
    if (rec.routine) return 'predicted';
    const r = world.rules;
    return r.ghosts && state.turn - rec.turn <= r.ghostTurns ? 'ghost' : null;
}

/** Whether the crew sees or predicts an NPC now: what it plans around, and whose events it is told. */
export const isKnownNow = (world: ReadonlyWorld, state: State, id: string): boolean => {
    const kind = markerKind(world, state, id);
    return kind === 'live' || kind === 'predicted';
};

export function knownView(world: ReadonlyWorld, state: State): KnownView {
    const k = state.knowledge, n = tilesOf(world), sight = sightMap(world, state);
    const inView = new Uint8Array(n);
    mark(inView, crewFields(world, state, sight), world.width);
    const npcs: NpcMarker[] = [];
    for (const npc of state.npcs) {
        const kind = markerKind(world, state, npc.id);
        if (!kind) continue;
        const rec = k.npcs[npc.id]!;
        // A predicted NPC that has left the map isn't drawn; its routine stays known.
        if (kind === 'predicted' && !isPresent(npc)) continue;
        const marker: NpcMarker = { id: npc.id, kind, pos: { x: rec.at.x, y: rec.at.y }, facing: rec.facing, seenAgo: state.turn - rec.turn };
        if (kind !== 'ghost') { marker.status = npc.status; marker.intent = npc.intent; }
        npcs.push(marker);
    }
    const cameras: KnownCamera[] = [], feeds = liveFeeds(world, state);
    for (const id of k.cameras) {
        const def = world.cameras.find(c => c.id === id);
        if (!def) continue;
        const now = state.cameras[id];
        const status = !k.cctv ? 'unknown' : now?.live && now.loopedUntil === null ? 'live' : 'off';
        const cam: KnownCamera = { id, pos: { x: def.pos.x, y: def.pos.y }, facings: def.facings, status };
        if (k.cctv) {
            cam.monitored = feeds.includes(id);
            if (now && now.loopedUntil !== null) cam.loopedUntil = now.loopedUntil;
        }
        cameras.push(cam);
    }
    const doors: KnownDoor[] = [], sets = tileSets(world, state);
    for (const d of doorSides(world)) {
        if (!Object.hasOwn(k.doors, d.id)) continue;
        const visible = sideIn(inView, d);
        doors.push({ id: d.id, status: visible ? doorStatus(world, state, d.id) : k.doors[d.id]!, inView: visible, fresh: sideIn(sets.fresh, d) });
    }
    return {
        width: world.width, height: world.height,
        seen: sets.seen.slice(), fresh: sets.fresh.slice(), inView, visibility: sets.visibility.slice(), blueprint: blueprint(world), rooms: k.rooms,
        npcs, cameras, doors, pings: k.pings,
        unknownRisk: p => isUnknownRisk(world, state, p)
    };
}

/** Fields of an event that may name an NPC (a door opened `by` one, a guard told, a walk stopped `by` one). */
const PERSON_FIELDS = ['npc', 'by', 'guard', 'source', 'observer'] as const;

export interface ProjectOptions {
    /**
     * `playback` (default): what the player is told after a command or a world phase; an NPC is known if the crew sees
     * or predicts it before or after, or saw it during the command. `preview`: what a preview may tell, judged by the
     * state before the command alone; `revealed` events are dropped and a move cut short by someone unknown is shown
     * along its drawn path.
     */
    mode?: 'playback' | 'preview';
}

/** Whether the tiles beside a door are seen by the crew in a state. */
function doorInView(world: ReadonlyWorld, state: State, door: string): boolean {
    const d = doorSides(world).find(s => s.id === door);
    if (!d) return false;
    const fields = crewFields(world, state, sightMap(world, state));
    const at = (i: number): Pos => ({ x: i % world.width, y: (i - (i % world.width)) / world.width });
    return (d.a >= 0 && seenBy(fields, at(d.a))) || (d.b >= 0 && seenBy(fields, at(d.b)));
}

/**
 * The NPCs and cameras the crew knows in `before` whose seeing or hearing of the crew during a command could hang on a
 * door it can't vouch for (`doorDoubt`): a line from where one stood (or walked) to a tile a crew member stood on or was
 * to walk (`sightDoubted`), or a noise's reach at an NPC's tile (`doubtStates`). Neither depends on what the doubted
 * doors really are.
 */
function doubtedWatchers(world: ReadonlyWorld, before: State, after: State, events: readonly SimEvent[]): Set<string> {
    const out = new Set<string>(), d = doorDoubt(world, before);
    if (!d) return out;
    const crewTiles: Pos[] = before.crew.map(c => ({ x: c.pos.x, y: c.pos.y })), walks = new Map<string, Pos[]>(), keep = new Set<string>();
    const crewIds = new Set(before.crew.map(c => c.id));
    for (const e of events) {
        if (e.type === 'moved') crewTiles.push(...e.path);
        else if (e.type === 'moveCut') crewTiles.push(...e.planned);
        else if (e.type === 'npcWalked') walks.set(e.npc, [...(walks.get(e.npc) ?? []), ...e.path]);
        else if (e.type === 'doorOpened' && crewIds.has(e.by)) keep.add(e.door);
    }
    const seen = (from: readonly DeepReadonly<Pos>[]): boolean => from.some(q => crewTiles.some(c => sightDoubted(d, q, c)));
    for (const npc of before.npcs) {
        if (!isPresent(npc) || !isKnownNow(world, before, npc.id)) continue;
        if (seen([npc.pos, ...(walks.get(npc.id) ?? [])])) out.add(npc.id);
    }
    for (const id of before.knowledge.cameras) {
        const def = world.cameras.find(c => c.id === id);
        if (def && seen([def.pos])) out.add(id);
    }
    for (const e of events) {
        if (e.type !== 'noise') continue;
        const { open, shut } = doubtStates(world, after, d, keep);
        const a = soundRing(world, open, e.sources, e.radius), b = soundRing(world, shut, e.sources, e.radius);
        for (const npc of before.npcs) {
            const i = npc.pos.y * world.width + npc.pos.x;
            if (isKnownNow(world, before, npc.id) && a.byIndex.get(i)?.remaining !== b.byIndex.get(i)?.remaining) out.add(npc.id);
        }
    }
    return out;
}

/**
 * The events the player is told (§8.15): those naming an NPC (in any of `PERSON_FIELDS`) the crew doesn't know, a
 * camera it doesn't know, or a door nobody of the crew sees (unless a crew member opened it) are dropped; the NPCs who
 * heard a noise are cut to the known ones. See `ProjectOptions` for the two modes.
 */
export function projectEvents(world: ReadonlyWorld, state: State, events: readonly SimEvent[], before?: State, options: ProjectOptions = {}): SimEvent[] {
    const preview = options.mode === 'preview';
    const base = preview ? before ?? state : state;
    const npcIds = new Set(state.npcs.map(n => n.id)), crewIds = new Set(state.crew.map(c => c.id));
    const seenDuring = (id: string): boolean => !!before && Object.hasOwn(state.knowledge.npcs, id) && state.knowledge.npcs[id]!.tick > before.knowledge.tick;
    // A preview can't tell what an NPC or a camera the crew knows does when a door it can't vouch for decides whether
    // they see or hear the crew: for this command they are as unknown (decision 44).
    const doubted = preview ? doubtedWatchers(world, base, state, events) : null;
    const known = (id: string): boolean => preview
        ? isKnownNow(world, base, id) && !doubted!.has(id)
        : isKnownNow(world, state, id) || (!!before && isKnownNow(world, before, id)) || seenDuring(id);
    const cameras = new Set(preview ? base.knowledge.cameras.filter(id => !doubted!.has(id)) : [...state.knowledge.cameras, ...(before?.knowledge.cameras ?? [])]);
    const doorSeen = new Map<string, boolean>();
    const seesDoor = (door: string): boolean => {
        let v = doorSeen.get(door);
        if (v === undefined) {
            v = preview ? doorInView(world, base, door) : doorInView(world, state, door) || (!!before && doorInView(world, before, door));
            doorSeen.set(door, v);
        }
        return v;
    };
    const out: SimEvent[] = [];
    // A preview shows a move cut short by someone unknown, or by a door found locked (one the crew pictured otherwise:
    // never one it knows), along the path the player drew.
    const hiddenCuts = preview
        ? events.filter((e): e is Extract<SimEvent, { type: 'moveCut' }> => e.type === 'moveCut' && (e.reason === 'door' || !known(e.npc)))
        : [];
    for (const e of events) {
        if (preview && e.type === 'revealed') continue;
        // Every carrier is shown (§9.1), but not who holds it or where when the crew doesn't know them.
        if (e.type === 'carrierStarted') {
            out.push(e.holder !== null && npcIds.has(e.holder) && !known(e.holder) ? { ...e, holder: null, pos: null } : e);
            continue;
        }
        const fields = e as unknown as Record<string, unknown>;
        if (PERSON_FIELDS.some(f => typeof fields[f] === 'string' && npcIds.has(fields[f] as string) && !known(fields[f] as string))) continue;
        if (typeof fields.camera === 'string' && !cameras.has(fields.camera)) continue;
        if (typeof fields.door === 'string' && !(typeof fields.by === 'string' && crewIds.has(fields.by)) && !seesDoor(fields.door)) continue;
        if (e.type === 'heard') {
            const npcs = e.npcs.filter(known);
            if (npcs.length) out.push({ ...e, npcs });
            continue;
        }
        if (e.type === 'noise') { out.push({ ...e, heard: e.heard.filter(known) }); continue; }
        if (e.type === 'moved') {
            const cut = hiddenCuts.find(c => c.crew === e.crew);
            if (cut) { out.push({ ...e, to: { ...cut.planned.at(-1)! }, path: cut.planned.map(p => ({ ...p })) }); continue; }
        }
        out.push(e);
    }
    // A move cut before its first step has no `moved` event to stretch.
    for (const cut of hiddenCuts) {
        if (out.some(e => e.type === 'moved' && e.crew === cut.crew)) continue;
        const from = before?.crew.find(c => c.id === cut.crew)?.pos ?? cut.at;
        out.unshift({ type: 'moved', crew: cut.crew, from: { ...from }, to: { ...cut.planned.at(-1)! }, path: cut.planned.map(p => ({ ...p })) });
    }
    return out;
}

/** `projectEvents` in preview mode for a previewed command from `before` (what `projectPreview` should call). */
export const projectPreviewEvents = (world: ReadonlyWorld, before: State, result: Pick<CommitResult, 'state' | 'events'>): SimEvent[] =>
    projectEvents(world, result.state, result.events, before, { mode: 'preview' });

/**
 * Whether a committed action is final for a reason the player isn't told: an NPC the crew doesn't know noticed it
 * (an undo-blocking event about it was projected away). The UI can say "something stirred" instead of nothing.
 */
export function noticedUnseen(world: ReadonlyWorld, before: State, result: Pick<CommitResult, 'state' | 'events' | 'undoable'>): boolean {
    if (result.undoable) return false;
    const shown = new Set(projectEvents(world, result.state, result.events, before));
    return result.events.some(e => !shown.has(e) && eventClass(e.type).undoBlocking);
}

/** The tiles of standing NPCs the crew sees or predicts: the only NPCs a planned move goes round. */
export function knownBlockers(world: ReadonlyWorld, state: State): Pos[] {
    return state.npcs.filter(n => isPresent(n) && !LYING_STATUSES.has(n.status) && isKnownNow(world, state, n.id))
        .map(n => ({ x: n.pos.x, y: n.pos.y }));
}

/**
 * The state as the crew pictures it: only the NPCs it sees or predicts are on the map, and each door not seen this
 * turn is as last seen (`knownDoorStatus`; a shallow copy, don't change it). Moves are planned and checked on it
 * (crew/movement.ts), and so should reach, tap snapping and drag validation be; a tile an unseen NPC stands on reads as
 * open, and the move bumps into whoever is there; a door pictured open or closed but locked stops the move before it.
 */
export function crewPicture(world: ReadonlyWorld, state: State): State {
    // Dragged bodies are with their draggers, not on the floor.
    const floor = onFloor(state);
    const npcs = floor.npcs.filter(n => isKnownNow(world, state, n.id)), doors = picturedDoors(world, state);
    const base = npcs.length === state.npcs.length ? state : { ...state, npcs };
    return doors ? { ...base, doors } : base;
}

/** The ids of the NPCs the crew knows of in any way (live, predicted or ghost), sorted. */
export function knownNpcIds(world: ReadonlyWorld, state: State): string[] {
    return sortedIds(state.knowledge.npcs).filter(id => markerKind(world, state, id) !== null);
}
