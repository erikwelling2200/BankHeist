import { registerCommandHook, type Ctx } from '../core/engine';
import { inBounds } from '../core/grid';
import { sortedIds } from '../core/json';
import { registerRuleDefaults, registerStateInit } from '../core/state';
import type { CameraDef, CrewState, DeepReadonly, Facing, Intent, NpcState, NpcStatus, Pos, ReadonlyWorld, SimEvent, State } from '../core/types';
import { registerMoveHook } from '../crew/movement';
import type { NoiseKind } from '../data/noise';
import { bandAt, crewObserver, fieldOn, rangeOn, type SightField } from '../geo/cones';
import { lineOfSight, sightInputs, sightMap, type SightMap } from '../geo/los';
import { LYING_STATUSES } from '../geo/move';
import { inRing, registerNoiseHook } from '../geo/sound';
import { isPresent } from './npc/walk';
import { bitsCount, decodeBits, encodeBits } from './knowledgeBits';

/*
 * What the crew knows (GAME_DESIGN §8.8, §8.15, §17.8; implementation plan M1-10). The engine works on the truth; the
 * player sees the bank only through this. Kept in `State.knowledge`, updated after every command (crew actions and the
 * world phase alike, `registerCommandHook`), after every step of a crew move, and on every noise.
 *
 * - **Seen tiles** (the casing layer): every tile any crew member has seen (360°, 10 tiles, darkness halves it; the
 *   `crew` profile of geo/cones.ts), as a compact bitset string (implementation plan §5: the state is copied on every
 *   command). Tiles never seen are grey, "no data", and never safe (§8.8).
 * - **The blueprint layer** (§17.8) is data from the World: the exterior and the public floor are always known; Staff
 *   and Secure rooms only as outlines, unless the heist bought the Blueprints asset (`World.intel.blueprints`). It is
 *   the floor plan, not scouting: a blueprint tile nobody has seen is still grey in the safe floor.
 * - **NPCs** (§8.15): an NPC is *live* while any crew member sees its tile. Each turn it is in view counts toward its
 *   routine; after `knownRoutineTurns` (3) turns, in stealth and on its routine, its routine is *known* (or from the
 *   start, for guards, with the Guard rota, `World.intel.guardRota`) and it is shown out of sight as a *predicted*
 *   marker: routines are deterministic in stealth, so the prediction is where its schedule has put it, which is where
 *   it is. Once anything knocks it off its routine (a want, a search, the on-edge flag, a status other than calm or
 *   away) the prediction stops and it is forgotten as a routine: a *ghost* at its last known place. Ghosts (behind
 *   `rules.ghosts`, decision 16) stay `ghostTurns` (2) turns after the turn it was last seen or predicted, then go.
 *   NPCs the crew hasn't seen are not shown at all.
 * - **Unknown risk** (hatched grey, §8.8): a seen tile that a tile nobody has seen could see within any NPC's or
 *   camera's reach, so someone the crew doesn't know about could be watching it. Worked out per tile on demand and
 *   cached per sight map and seen set (`unknownRisk`).
 * - **Sound pings**: a loud noise whose ring reaches any crew member is kept with its source tile and turn, in or out of
 *   sight; quiet noises aren't.
 * - **Cameras**: a camera is known once its tile has been seen. Its feed status (live, looped, dead) is unknown until
 *   the CCTV room (the room of a `cctvDesk`) is scouted; a camera of unknown status counts as live (§8.8).
 *
 * **Undo (§6.6).** Whenever something new becomes known (a tile, an NPC in view or out of hiding, a room, a camera, the
 * CCTV feeds, a routine) a `revealed` event is emitted, which blocks undo: a move through known space with nobody new
 * in view stays undoable; a move that shows anything new is final.
 *
 * **The projection** (what the Session, the overlay and the HUD may use; never the raw state):
 * - `knownView(world, state)`: the markers (live, predicted, ghost), the seen and in-view tiles, the blueprint, the
 *   known rooms and cameras, the pings and the unknown-risk test. The overlay and the HUD draw only this.
 * - `projectEvents(world, state, events, before?)`: the events with those about NPCs (and cameras) the crew doesn't
 *   see dropped, and the lists of who heard a noise cut to the ones it sees. Call sites: `projectPreview` in
 *   src/game/session.ts (before `confirmView` colours Confirm), and world-phase playback (the camera visits and
 *   `describeEvent` lines), with `before` the state the command started from.
 * - `crewPicture(world, state)` / `knownBlockers(world, state)`: the state as the crew pictures it, with only the NPCs
 *   it sees or predicts, for reach, tap snapping and drag validation (src/scenes/bank/sim.ts, `sim.path` in
 *   src/game/debug.ts): a tile an unseen NPC stands on reads as open; the commit says what happens.
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
    /** How many turns it has been in view (toward a known routine); `watchedTurn` the last one counted. */
    watched: number;
    watchedTurn: number;
}

/** A loud noise the crew heard (§8.15). */
export interface Ping { at: Pos; turn: number; kind: NoiseKind; cause: string }

export interface Knowledge {
    /** Every tile a crew member has seen, a bitset string (`knowledgeBits.ts`). */
    seen: string;
    /** Rooms with a seen tile, sorted. */
    rooms: string[];
    /** Cameras whose tile has been seen, sorted. */
    cameras: string[];
    /** Whether the CCTV room has been scouted: the cameras' feed status is known. */
    cctv: boolean;
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

// ---------------------------------------------------------------------------------------------------------- Blueprint

/** The blueprint layer (§17.8) of a world: which tiles' layout is known, and which rooms show only as outlines. */
export interface Blueprint {
    /** Per tile, row-major: 1 when its layout is known (the exterior, the public floor, or everything with Blueprints). */
    readonly known: Uint8Array;
    /** Staff and Secure rooms drawn only as outlines (`?` rooms), sorted; empty with Blueprints. */
    readonly outlines: readonly string[];
}

const BLUEPRINTS = new WeakMap<ReadonlyWorld, Blueprint>();

export function blueprint(world: ReadonlyWorld): Blueprint {
    let b = BLUEPRINTS.get(world);
    if (b) return b;
    const all = !!world.intel?.blueprints, known = new Uint8Array(world.width * world.height), outlines = new Set<string>();
    world.tiles.forEach((t, i) => {
        if (all || t.room === null || t.zone === 'public') known[i] = 1;
        else outlines.add(t.room);
    });
    // A room with any non-public tile is an outline as a whole.
    if (!all) world.tiles.forEach((t, i) => { if (t.room !== null && outlines.has(t.room)) known[i] = 0; });
    BLUEPRINTS.set(world, b = Object.freeze({ known, outlines: Object.freeze([...outlines].sort()) }));
    return b;
}

// ---------------------------------------------------------------------------------------------------------- Routines

const ROUTINE_GOALS: ReadonlySet<string> = new Set(['still', 'routine', 'enter', 'away']);

/** Whether an NPC is following its schedule, untouched: what makes its known routine a true prediction. */
export function onRoutine(npc: DeepReadonly<NpcState>): boolean {
    return (npc.status === 'calm' || npc.status === 'away') && !npc.alerted && npc.wants.length === 0 && ROUTINE_GOALS.has(npc.goal.kind);
}

/** Whether the bank is still in stealth: routines can be learnt only then. */
const inStealth = (state: State): boolean => !state.bank.loud && !state.bank.alarm;

// ---------------------------------------------------------------------------------------------------------- Updating

/** What a crew move saw on its way, before the command's end (by draft state). */
interface Pending {
    bits: Uint8Array;
    /** NPCs seen mid-move, where and facing which way. */
    npcs: Map<string, { pos: Pos; facing: Facing }>;
}

const PENDING = new WeakMap<State, Pending>();

/** What a crew member sees from where they stand: all round, so their facing doesn't matter (one cached field per tile). */
const lookout = (world: ReadonlyWorld, sight: SightMap, member: DeepReadonly<CrewState>): SightField =>
    fieldOn(sight, { ...crewObserver(world, member), facing: 'n' });

/** The fields of every crew member now. */
function crewFields(world: ReadonlyWorld, state: State, sight: SightMap): SightField[] {
    return state.crew.map(c => lookout(world, sight, c));
}

const seenBy = (fields: readonly SightField[], p: Pos): boolean => fields.some(f => bandAt(f, p) !== null);

/** ORs the fields into the bits; returns how many tiles were new. */
function mark(bits: Uint8Array, fields: readonly SightField[], width: number): number {
    let added = 0;
    for (const f of fields) {
        for (const p of f.tiles) {
            const i = p.y * width + p.x;
            if (!bits[i]) { bits[i] = 1; added++; }
        }
    }
    return added;
}

function emptyKnowledge(world: ReadonlyWorld): Knowledge {
    return { seen: encodeBits(new Uint8Array(world.width * world.height)), rooms: [], cameras: [], cctv: false, npcs: {}, pings: [] };
}

/**
 * Brings what the crew knows up to date with the state (what everyone sees now, plus what a move saw on its way), and
 * emits a `revealed` event for each thing that became known. The one writer of `State.knowledge`, besides pings.
 */
export function updateKnowledge(world: ReadonlyWorld, state: State, emit: (event: SimEvent) => void): void {
    const k = state.knowledge, sight = sightMap(world, state), fields = crewFields(world, state, sight);
    const pending = PENDING.get(state);
    PENDING.delete(state);
    const before = decodeBits(k.seen, world.width * world.height);
    const bits = pending ? pending.bits : before.slice();
    const marked = mark(bits, fields, world.width), added = pending ? bitsCount(bits) - bitsCount(before) : marked;
    if (added) {
        k.seen = encodeBits(bits);
        emit({ type: 'revealed', what: 'tiles', id: String(added) });
        learnRoomsAndCameras(world, k, bits, before, emit);
    }
    learnNpcs(world, state, fields, pending, emit);
    const oldest = state.turn - world.rules.pingTurns;
    if (k.pings.some(p => p.turn < oldest)) k.pings = k.pings.filter(p => p.turn >= oldest);
}

function learnRoomsAndCameras(world: ReadonlyWorld, k: Knowledge, bits: Uint8Array, before: Uint8Array, emit: (event: SimEvent) => void): void {
    const rooms = new Set(k.rooms), bp = blueprint(world), outline = new Set(bp.outlines), fresh: string[] = [];
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

function learnNpcs(world: ReadonlyWorld, state: State, fields: readonly SightField[], pending: Pending | undefined, emit: (event: SimEvent) => void): void {
    const k = state.knowledge, rules = world.rules, turn = state.turn;
    for (const npc of state.npcs) {
        const live = isPresent(npc) && seenBy(fields, npc.pos);
        const passed = pending?.npcs.get(npc.id);
        let rec = Object.hasOwn(k.npcs, npc.id) ? k.npcs[npc.id] : undefined;
        if (!rec && !live && !passed) continue;
        const shown = !!rec && (rec.live || rec.routine);
        if (rec?.routine && !onRoutine(npc)) {
            // Knocked off its routine: the prediction stops. Out of sight it is a ghost where it was last predicted.
            rec.routine = false;
            rec.watched = 0;
        }
        if (live || passed) {
            if (!shown) emit({ type: 'revealed', what: 'npc', id: npc.id });
            const where = live ? npc : passed!;
            rec ??= k.npcs[npc.id] = { at: { x: 0, y: 0 }, facing: 'n', turn, live: false, routine: false, watched: 0, watchedTurn: 0 };
            rec.at = { x: where.pos.x, y: where.pos.y };
            rec.facing = where.facing;
            rec.turn = turn;
            rec.live = live;
            if (rec.watchedTurn !== turn) { rec.watched++; rec.watchedTurn = turn; }
            if (!rec.routine && rec.watched >= rules.knownRoutineTurns && onRoutine(npc) && inStealth(state)) {
                rec.routine = true;
                emit({ type: 'revealed', what: 'routine', id: npc.id });
            }
        } else if (rec) {
            rec.live = false;
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
                at: { x: person.pos.x, y: person.pos.y }, facing: person.facing, turn: state.turn, live: false, routine: true,
                watched: world.rules.knownRoutineTurns, watchedTurn: 0
            };
        }
    }
    // What the crew sees where it starts is known from the start: nothing to reveal, nothing to undo.
    updateKnowledge(world, state, () => {});
});

// After every command, the world phase included.
registerCommandHook('knowledge', ctx => updateKnowledge(ctx.world, ctx.state, e => ctx.emit(e)));

// A move sees on its way: every tile and NPC in view at each step counts, not only at its end.
registerMoveHook('knowledge', {
    step(ctx, member) {
        const { world, state } = ctx;
        let pending = PENDING.get(state);
        if (!pending) PENDING.set(state, pending = { bits: decodeBits(state.knowledge.seen, world.width * world.height).slice(), npcs: new Map() });
        const field = lookout(world, sightMap(world, state), member);
        mark(pending.bits, [field], world.width);
        for (const npc of state.npcs) {
            if (isPresent(npc) && bandAt(field, npc.pos)) pending.npcs.set(npc.id, { pos: { x: npc.pos.x, y: npc.pos.y }, facing: npc.facing });
        }
    }
});

// Loud noises reaching any crew member are heard wherever they come from (§8.15).
registerNoiseHook('knowledge', (ctx: Ctx, ring, kind, cause) => {
    if (kind !== 'loud' || !ctx.state.crew.some(c => inRing(ring, c.pos))) return;
    const at = ring.sources[0];
    if (at) ctx.state.knowledge.pings.push({ at: { x: at.x, y: at.y }, turn: ctx.state.turn, kind, cause });
});

// ---------------------------------------------------------------------------------------------------------- Unknown risk

/** The furthest anyone the crew doesn't know about could see: an Alerted NPC's Peripheral arc, or a camera. */
export function unknownReach(world: ReadonlyWorld): number {
    const r = world.rules;
    return Math.max(r.peripheralRange + r.alertedRangeBonus, r.coreRange + r.alertedRangeBonus, r.cameraRange);
}

/** Whether tiles are unknown risk, by tile: -1 not worked out yet, 0 no, 1 yes. */
interface RiskCache { key: string; memo: Int8Array }

const RISK = new WeakMap<ReadonlyWorld, RiskCache[]>();
const RISK_KEEP = 4;

function riskMemo(world: ReadonlyWorld, state: State): Int8Array {
    const key = `${sightInputs(world, state)}#${state.knowledge.seen}`;
    let list = RISK.get(world);
    if (!list) RISK.set(world, list = []);
    const i = list.findIndex(c => c.key === key);
    if (i >= 0) return list[i]!.memo;
    const memo = new Int8Array(world.width * world.height).fill(-1);
    list.unshift({ key, memo });
    if (list.length > RISK_KEEP) list.length = RISK_KEEP;
    return memo;
}

/**
 * Whether a seen tile is unknown risk (hatched grey, §8.8): a tile nobody has seen lies within reach of it (halved when
 * it is dark) with a clear line of sight. Unseen tiles are grey, not unknown risk: they have no data at all.
 */
export function isUnknownRisk(world: ReadonlyWorld, state: State, p: Pos): boolean {
    if (!inBounds(world, p)) return false;
    const w = world.width, i = p.y * w + p.x, memo = riskMemo(world, state);
    if (memo[i] !== -1) return memo[i] === 1;
    const bits = decodeBits(state.knowledge.seen, w * world.height), sight = sightMap(world, state);
    let risk = false;
    if (bits[i]) {
        const r = rangeOn(unknownReach(world), world.tiles[i]!.lit);
        for (let y = Math.max(0, p.y - r); y <= Math.min(world.height - 1, p.y + r) && !risk; y++) {
            for (let x = Math.max(0, p.x - r); x <= Math.min(w - 1, p.x + r); x++) {
                const dx = x - p.x, dy = y - p.y;
                if (bits[y * w + x] || dx * dx + dy * dy > r * r) continue;
                if (lineOfSight(sight, { x, y }, p)) { risk = true; break; }
            }
        }
    }
    memo[i] = risk ? 1 : 0;
    return risk;
}

/**
 * What the crew knows of a floor tile, for the safe floor (§8.8): `unscouted` is grey and never safe; `unknownRisk` is
 * hatched grey (a tile the crew's known NPCs leave green still reads hatched grey); `scouted` is judged by the known
 * NPCs alone.
 */
export type FloorKnowledge = 'unscouted' | 'unknownRisk' | 'scouted';

export function floorKnowledge(world: ReadonlyWorld, state: State, p: Pos): FloorKnowledge {
    if (!inBounds(world, p) || !decodeBits(state.knowledge.seen, world.width * world.height)[p.y * world.width + p.x]) return 'unscouted';
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
    /** Unknown until the CCTV room is scouted; an unknown one counts as live (§8.8). */
    status: 'live' | 'off' | 'unknown';
}

/** What the player may see (§8.15, §17.8): the overlay and the HUD draw only this. */
export interface KnownView {
    width: number;
    height: number;
    /** Per tile, row-major: 1 once seen by the crew (the casing layer). Anything else is grey: no data. */
    seen: Uint8Array;
    /** Per tile, row-major: 1 while a crew member sees it now. */
    inView: Uint8Array;
    blueprint: Blueprint;
    rooms: readonly string[];
    npcs: NpcMarker[];
    cameras: KnownCamera[];
    pings: readonly Ping[];
    /** Whether a tile is unknown risk (hatched grey); worked out on demand, cached. */
    unknownRisk(p: Pos): boolean;
}

/** How the crew knows of an NPC now, or null when it doesn't show at all. */
export function markerKind(world: ReadonlyWorld, state: State, id: string): MarkerKind | null {
    const rec = Object.hasOwn(state.knowledge.npcs, id) ? state.knowledge.npcs[id]! : undefined;
    if (!rec) return null;
    if (rec.live) return 'live';
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
    const k = state.knowledge, n = world.width * world.height, sight = sightMap(world, state);
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
    const cameras: KnownCamera[] = [];
    for (const id of k.cameras) {
        const def = world.cameras.find(c => c.id === id);
        if (!def) continue;
        const status = !k.cctv ? 'unknown' : state.cameras[id]?.live ? 'live' : 'off';
        cameras.push({ id, pos: { x: def.pos.x, y: def.pos.y }, facings: def.facings, status });
    }
    return {
        width: world.width, height: world.height,
        seen: decodeBits(k.seen, n).slice(), inView, blueprint: blueprint(world), rooms: k.rooms, npcs, cameras, pings: k.pings,
        unknownRisk: p => isUnknownRisk(world, state, p)
    };
}

/** Events that name an NPC, by the field that does. */
const NPC_FIELDS = ['npc'] as const;

/**
 * The events the player is told (§8.15): those about an NPC the crew neither sees nor predicts (in `state`, or in
 * `before` when given: an NPC walking out of view is still seen leaving) are dropped, and so are those about a camera it
 * doesn't know. The NPCs who heard a noise are cut to the ones it sees. Everything else passes.
 */
export function projectEvents(world: ReadonlyWorld, state: State, events: readonly SimEvent[], before?: State): SimEvent[] {
    const known = (id: string): boolean => isKnownNow(world, state, id) || (!!before && isKnownNow(world, before, id));
    const cameras = new Set([...state.knowledge.cameras, ...(before?.knowledge.cameras ?? [])]);
    const out: SimEvent[] = [];
    for (const e of events) {
        const fields = e as unknown as Record<string, unknown>;
        if (NPC_FIELDS.some(f => typeof fields[f] === 'string' && !known(fields[f] as string))) continue;
        if (typeof fields.camera === 'string' && !cameras.has(fields.camera)) continue;
        if (e.type === 'heard') {
            const npcs = e.npcs.filter(known);
            if (npcs.length) out.push({ ...e, npcs });
            continue;
        }
        if (e.type === 'noise') { out.push({ ...e, heard: e.heard.filter(known) }); continue; }
        if (e.type === 'told' && !known(e.guard)) continue;
        out.push(e);
    }
    return out;
}

/** The tiles of standing NPCs the crew sees or predicts: the only NPCs a planned move goes round. */
export function knownBlockers(world: ReadonlyWorld, state: State): Pos[] {
    return state.npcs.filter(n => isPresent(n) && !LYING_STATUSES.has(n.status) && isKnownNow(world, state, n.id))
        .map(n => ({ x: n.pos.x, y: n.pos.y }));
}

/**
 * The state as the crew pictures it: only the NPCs it sees or predicts are on the map (a shallow copy; don't change
 * it). Pass it to `reachable`, `pathTo` and `validatePath` for reach, tap snapping and drag validation, so a tile an
 * unseen NPC stands on reads as open; the real commit runs on the true state.
 */
export function crewPicture(world: ReadonlyWorld, state: State): State {
    const npcs = state.npcs.filter(n => isKnownNow(world, state, n.id));
    return npcs.length === state.npcs.length ? state : { ...state, npcs };
}

/** The ids of the NPCs the crew knows of in any way (live, predicted or ghost), sorted. */
export function knownNpcIds(world: ReadonlyWorld, state: State): string[] {
    return sortedIds(state.knowledge.npcs).filter(id => markerKind(world, state, id) !== null);
}
