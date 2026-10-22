import { registerCommandHook, type CommitResult } from '../core/engine';
import { facingToward, inBounds } from '../core/grid';
import { sortedIds } from '../core/json';
import { registerStateCheck } from '../core/save';
import { crewMember, registerRuleDefaults, registerStateInit } from '../core/state';
import type {
    CameraDef, CrewState, DeepReadonly, DoorStatus, Facing, Intent, NpcState, NpcStatus, ObserverClass, Pos, ReadonlyWorld, SimEvent, State
} from '../core/types';
import { eventClass } from '../core/undo';
import { registerMoveHook, registerMoveLimit, registerPlanView } from '../crew/movement';
import type { Profile } from '../data/items';
import { OUTCOME_RANK, UNIFORMS, type Uniform } from '../data/matrix';
import type { NoiseKind } from '../data/noise';
import { bandAt, bandOf, fieldOn, profilesOf, rangeOn, type SightField } from '../geo/cones';
import { lineOfSight, sightInputs, sightMap, type SightMap } from '../geo/los';
import { doorStatus, LYING_STATUSES } from '../geo/move';
import { inRing, registerNoiseHook } from '../geo/sound';
import { liveFeeds } from './cctv';
import { reaction, sightsAlongWalk, type Reaction } from './perceive';
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
 * - **Seen tiles** (the casing layer): every tile any crew member has seen (360°, 10 tiles, darkness halves it; the
 *   `crew` profile of geo/cones.ts), as a compact bitset string (implementation plan §5: the state is copied on every
 *   command). Tiles never seen are grey, "no data", and never safe (§8.8).
 * - **Fresh tiles**: the tiles seen since the last world phase ended, reset to what the crew sees at the end of each
 *   world phase and added to by every step and command since. NPCs move only in the world phase, so nobody the crew
 *   doesn't know about stands on a fresh tile during the crew phase (§6 decision 24).
 * - **The blueprint layer** (§17.8) is data from the World: the exterior and the public floor are always known; Staff
 *   and Secure rooms only as outlines, unless the heist bought the Blueprints asset (`World.intel.blueprints`). It is
 *   the floor plan, not scouting: a blueprint tile nobody has seen is still grey in the safe floor.
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
 * - **Unknown risk** (hatched grey, §8.8, decision 24): a seen tile that a tile that isn't fresh could see within any
 *   NPC's or camera's reach (`isUnknownRisk`, cached per sight map and fresh set), where someone the crew doesn't know
 *   about, at its worst (any class, Alerted, a camera taken as live), would react to the crew member by the reaction
 *   rules (`unknownWatcher`). Green therefore means nobody, known or not, would do anything about them there.
 * - **Doors**: the status of each door last seen (a tile beside it in view).
 * - **Sound pings**: a loud noise whose ring reaches any crew member is kept with its source tile and turn, in or out of
 *   sight; quiet noises aren't.
 * - **Cameras**: a camera is known once its tile has been seen. Its feed status (live, looped, dead) is unknown until
 *   the CCTV room (the room of a `cctvDesk`) is scouted; a camera of unknown status counts as live (§8.8). Once it is,
 *   the view also says which feeds are on the operator's monitors this turn (§8.12). With the CCTV room under control
 *   the crew sees through every camera that isn't looped or dead (`registerLookout`, rules/cameras.ts, §8.15).
 *
 * **Moving in unknown space.** Moves are planned on `crewPicture` (`registerPlanView`): an unseen NPC's tile reads as
 * open, and the move bumps into it (crew/movement.ts). A move also stops at the step where an NPC the crew has never
 * seen comes into view (`registerMoveLimit('knowledge')`), the action spent.
 *
 * **Undo (§6.6).** Whenever something new becomes known (a tile, an NPC in view or out of hiding, a room, a camera, the
 * CCTV feeds, a routine) a `revealed` event is emitted, which blocks undo: a move through known space with nobody new
 * in view stays undoable; a move that shows anything new is final. A move an unseen NPC noticed is final too (its
 * perception check blocks undo), though the player is told nothing about who: `noticedUnseen` says so, for the UI's
 * "something stirred".
 *
 * **The projection** (what the Session, the overlay and the HUD may use; never the raw state):
 * - `knownView(world, state)`: markers (live, predicted, ghost), the seen, fresh and in-view tiles, doors as known,
 *   the blueprint, rooms and cameras, pings and the unknown-risk test. The overlay and the HUD draw only this.
 * - `projectEvents(world, after, events, before, { mode })`: drops events about NPCs (by any field that names one),
 *   cameras and doors the crew doesn't see, and cuts the lists of who heard a noise. `mode: 'preview'` (for
 *   `projectPreview`) judges by `before` only, drops `revealed` and shows a cut move along its drawn path, so a preview
 *   tells nothing the crew doesn't know yet; `'playback'` (the default; world-phase playback and committed actions)
 *   also tells about NPCs seen during the command.
 * - `crewPicture(world, state)` / `knownBlockers(world, state)`: the state as the crew pictures it.
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
        } else if (e.type === 'moveCut') {
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
        if (cams.has(c.id) || !inBounds(world, c.pos) || !bits[c.pos.y * world.width + c.pos.x]) continue;
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

// A move stops at the step where someone the crew has never seen comes into view (§8.15): there is a new person to
// think about. Worked out before the first step, on the doors as the walk will open them.
registerMoveLimit('knowledge', (ctx, member, path) => {
    const { world, state } = ctx;
    const strangers = state.npcs.filter(n => isPresent(n) && !Object.hasOwn(state.knowledge.npcs, n.id));
    if (!strangers.length || !path.length) return undefined;
    const maps = sightsAlongWalk(world, state, sightMap(world, state), member.pos, path);
    for (let i = 0; i < path.length; i++) {
        const field = lookout(world, maps[i]!, { pos: path[i]! });
        const seen = strangers.find(n => bandAt(field, n.pos) !== null);
        if (seen) return { keep: i + 1, npc: seen.id, reason: 'spotted' };
    }
    return undefined;
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

/** The furthest anyone the crew doesn't know about could see: an Alerted NPC's Peripheral arc, or a camera. */
export function unknownReach(world: ReadonlyWorld): number {
    const r = world.rules;
    return Math.max(r.peripheralRange + r.alertedRangeBonus, r.coreRange + r.alertedRangeBonus, r.cameraRange);
}

/**
 * Unknown space as seen from each tile, worked out on demand: per tile, the nearest tile that isn't fresh with a clear
 * line of sight within reach (`far`), and the nearest such within frisk range (`close`), as tile indices; -1 none, -2
 * not worked out yet. With the decoded tile sets and the sight map it is worked out on. Shared by every state with the
 * same walls and sets (keyed), and remembered per state object too, so asking about many tiles of one state doesn't
 * rebuild the key each time. Both crew-independent: what a crew member makes of them is `unknownWatcher`.
 */
interface RiskCache { key: string; far: Int32Array; close: Int32Array; seen: Uint8Array; fresh: Uint8Array; sight: SightMap }

const RISK = new WeakMap<ReadonlyWorld, RiskCache[]>();
const RISK_BY_STATE = new WeakMap<State, { world: ReadonlyWorld; cache: RiskCache }>();
const RISK_KEEP = 4;

function riskCache(world: ReadonlyWorld, state: State): RiskCache {
    const hit = RISK_BY_STATE.get(state);
    if (hit?.world === world) return hit.cache;
    const key = `${sightInputs(world, state)}#${state.knowledge.seen}#${state.knowledge.fresh}`;
    let list = RISK.get(world);
    if (!list) RISK.set(world, list = []);
    let cache = list.find(c => c.key === key);
    if (!cache) {
        const n = tilesOf(world);
        cache = {
            key, far: new Int32Array(n).fill(-2), close: new Int32Array(n).fill(-2), seen: decodeBits(state.knowledge.seen, n),
            fresh: decodeBits(state.knowledge.fresh, n), sight: sightMap(world, state)
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

/** The nearest tile that isn't fresh and sees `p` (within frisk range, with `close`), worked out once per cache. */
function nearestUnknown(world: ReadonlyWorld, c: RiskCache, p: Pos, close: boolean): number {
    const w = world.width, i = p.y * w + p.x, memo = close ? c.close : c.far;
    if (memo[i] !== -2) return memo[i]!;
    let found = -1;
    if (c.seen[i]) {
        const r = rangeOn(unknownReach(world), world.tiles[i]!.lit), offsets = offsetsWithin(r), frisk = world.rules.friskRange;
        for (let k = 0; k < offsets.length; k += 2) {
            const dx = offsets[k]!, dy = offsets[k + 1]!, x = p.x + dx, y = p.y + dy;
            if (close && Math.max(Math.abs(dx), Math.abs(dy)) > frisk) continue;
            if (x < 0 || y < 0 || x >= w || y >= world.height || c.fresh[y * w + x]) continue;
            // Someone could stand on a stale tile itself.
            if ((!dx && !dy) || lineOfSight(c.sight, { x, y }, p)) { found = y * w + x; break; }
        }
    }
    memo[i] = found;
    return found;
}

/**
 * Whether a seen tile can be seen from unknown space: a tile that isn't fresh (not seen since the last world phase,
 * the tile itself included) lies within reach of it (halved when it is dark) with a clear line of sight, so someone the
 * crew doesn't know about could stand there and see it. Unseen tiles are grey, not this. Whether that matters to a
 * crew member is `unknownWatcher` (decision 24): this is the geometry alone.
 */
export function isUnknownRisk(world: ReadonlyWorld, state: State, p: Pos): boolean {
    return inBounds(world, p) && nearestUnknown(world, riskCache(world, state), p, false) >= 0;
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
 * 24), and the worst such: `p` is seen, and a tile that isn't fresh (`isUnknownRisk`'s unknown space, `p` itself
 * included) sees it, from where an unknown observer, at its worst, would do something by the very rules perception
 * uses (`reaction`: the matrix, the profile as read, uniforms, Notoriety, frisk range). At its worst means any class
 * (and the manager or the security chief, who see through a uniform), Alerted (one profile higher; both arcs Core,
 * reaching 8 and 10), facing the tile; or a camera of unknown status, taken as live. The distance from that tile
 * decides the band and frisk range. Trespass counts; on a tile passed mid-move (`step`) only `!` does. Null when
 * nobody unknown could change anything there, or `p` is unseen (grey, which is never safe anyway).
 *
 * A reaction only grows as the observer comes nearer (a nearer tile is in every band and range a further one is) and
 * within frisk range, so the worst is that of the nearest unknown tile in sight, or of the nearest within frisk range:
 * both worked out once per tile and shared by every crew member (`nearestUnknown`).
 */
export function unknownWatcher(world: ReadonlyWorld, state: State, crewId: string, p: Pos, options: UnknownOptions = {}): UnknownWatcher | null {
    if (!inBounds(world, p)) return null;
    const c = riskCache(world, state), far = nearestUnknown(world, c, p, false);
    if (far < 0) return null;
    const member = crewMember(state, crewId), look = options.look ?? crewLook(member), rules = world.rules;
    const tile = world.tiles[p.y * world.width + p.x]!, profiles = profilesOf(world);
    const camera = world.cameras.some(cam => cam.seesInDark) ? profiles.darkCamera : profiles.camera;
    const warnedByAny = isWarned(state, crewId);
    let best: UnknownWatcher | null = null;
    const consider = (from: Pos, by: 'npc' | 'camera', observer: ObserverClass, role: string | null, facing: Facing, chebyshev: number): void => {
        const dx = p.x - from.x, dy = p.y - from.y;
        const band = bandOf(by === 'npc' ? profiles.alerted : camera, facing, dx, dy, tile.lit);
        if (!band) return;
        const r = reaction(rules, {
            look, notoriety: member.notoriety, observer, role, camera: by === 'camera', alerted: by === 'npc', band, zone: tile.zone, chebyshev,
            warnedByThis: false, warnedByAny
        });
        if (options.step ? r.outcome !== '!' : r.outcome === '-') return;
        if (!best || OUTCOME_RANK[r.outcome] > OUTCOME_RANK[best.reaction.outcome]) best = { by, observer, role, from, reaction: r, profile: look.profile };
    };
    const close = nearestUnknown(world, c, p, true);
    for (const q of close >= 0 && close !== far ? [far, close] : [far]) {
        const from = { x: q % world.width, y: Math.floor(q / world.width) };
        const facing = facingToward(from, p) ?? 'n', chebyshev = Math.max(Math.abs(p.x - from.x), Math.abs(p.y - from.y));
        for (const n of unknownNpcs(world)) consider(from, 'npc', n.observer, n.role, facing, chebyshev);
        consider(from, 'camera', 'enforcer', null, facing, chebyshev);
    }
    return best;
}

/**
 * What the crew knows of a floor tile, for the safe floor (§8.8): `unscouted` is grey and never safe; `unknownRisk` is
 * hatched grey (a tile the crew's known NPCs leave green still reads hatched grey); `scouted` is judged by the known
 * NPCs alone. Without `crew` it is the geometry (`isUnknownRisk`: someone unknown could see the tile); with it, only
 * where someone unknown could react to that crew member there (`unknownWatcher`, decision 24).
 */
export type FloorKnowledge = 'unscouted' | 'unknownRisk' | 'scouted';

export function floorKnowledge(world: ReadonlyWorld, state: State, p: Pos, crew?: UnknownOptions & { crew: string }): FloorKnowledge {
    if (!inBounds(world, p) || !riskCache(world, state).seen[p.y * world.width + p.x]) return 'unscouted';
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

/** A door as the crew knows it: its status when last seen, and whether a crew member sees it now. */
export interface KnownDoor { id: string; status: DoorStatus; inView: boolean }

/** What the player may see (§8.15, §17.8): the overlay and the HUD draw only this. */
export interface KnownView {
    width: number;
    height: number;
    /** Per tile, row-major: 1 once seen by the crew (the casing layer). Anything else is grey: no data. */
    seen: Uint8Array;
    /** Per tile, row-major: 1 when seen since the last world phase (nobody unknown stands there). */
    fresh: Uint8Array;
    /** Per tile, row-major: 1 while a crew member sees it now. */
    inView: Uint8Array;
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
    const doors: KnownDoor[] = [];
    for (const d of doorSides(world)) {
        if (!Object.hasOwn(k.doors, d.id)) continue;
        const visible = sideIn(inView, d);
        doors.push({ id: d.id, status: visible ? doorStatus(world, state, d.id) : k.doors[d.id]!, inView: visible });
    }
    return {
        width: world.width, height: world.height,
        seen: decodeBits(k.seen, n).slice(), fresh: decodeBits(k.fresh, n).slice(), inView, blueprint: blueprint(world), rooms: k.rooms,
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
 * The events the player is told (§8.15): those naming an NPC (in any of `PERSON_FIELDS`) the crew doesn't know, a
 * camera it doesn't know, or a door nobody of the crew sees (unless a crew member opened it) are dropped; the NPCs who
 * heard a noise are cut to the known ones. See `ProjectOptions` for the two modes.
 */
export function projectEvents(world: ReadonlyWorld, state: State, events: readonly SimEvent[], before?: State, options: ProjectOptions = {}): SimEvent[] {
    const preview = options.mode === 'preview';
    const base = preview ? before ?? state : state;
    const npcIds = new Set(state.npcs.map(n => n.id)), crewIds = new Set(state.crew.map(c => c.id));
    const seenDuring = (id: string): boolean => !!before && Object.hasOwn(state.knowledge.npcs, id) && state.knowledge.npcs[id]!.tick > before.knowledge.tick;
    const known = (id: string): boolean => preview
        ? isKnownNow(world, base, id)
        : isKnownNow(world, state, id) || (!!before && isKnownNow(world, before, id)) || seenDuring(id);
    const cameras = new Set(preview ? base.knowledge.cameras : [...state.knowledge.cameras, ...(before?.knowledge.cameras ?? [])]);
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
    // A preview shows a move cut short by someone unknown along the path the player drew.
    const hiddenCuts = preview ? events.filter((e): e is Extract<SimEvent, { type: 'moveCut' }> => e.type === 'moveCut' && !known(e.npc)) : [];
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
 * The state as the crew pictures it: only the NPCs it sees or predicts are on the map (a shallow copy; don't change
 * it). Moves are planned and checked on it (crew/movement.ts), and so should reach, tap snapping and drag validation
 * be; a tile an unseen NPC stands on reads as open, and the move bumps into whoever is there.
 */
export function crewPicture(world: ReadonlyWorld, state: State): State {
    // Dragged bodies are with their draggers, not on the floor.
    const floor = onFloor(state);
    const npcs = floor.npcs.filter(n => isKnownNow(world, state, n.id));
    return npcs.length === state.npcs.length ? state : { ...state, npcs };
}

/** The ids of the NPCs the crew knows of in any way (live, predicted or ghost), sorted. */
export function knownNpcIds(world: ReadonlyWorld, state: State): string[] {
    return sortedIds(state.knowledge.npcs).filter(id => markerKind(world, state, id) !== null);
}
