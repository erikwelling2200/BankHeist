import { preview, registerWorldHook, type Ctx } from '../core/engine';
import { facingToward, samePos, tileAt } from '../core/grid';
import { sortedIds } from '../core/json';
import { newId, registerNpcInit, registerRuleDefaults, registerStateInit } from '../core/state';
import type { CarrierKind, Command, DeepReadonly, Intent, NpcState, ObserverClass, Phase, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { NOISES, type NoiseKind, type NoiseSource } from '../data/noise';
import { bandAt, cameraObserver, fieldOn } from '../geo/cones';
import { noiseRadius, npcsInside, registerNoiseHook, soundRing, type Ring } from '../geo/sound';
import { sightMap, type SightMap } from '../geo/los';
import { doorStatus, LYING_STATUSES } from '../geo/move';
import { bodyAway, draggedBy } from './actions/body';
import { decidesFor, pickInvestigator } from './npc/behaviour';
import { activityAt, LEAVING_ACTIVITIES, ROUTE_ACTIVITIES } from './npc/schedule';
import { isPresent } from './npc/walk';
import { queueLook, worldPoses, type WorldPoses } from './perceive';
import { isKnownNow } from './knowledge';
import { reconsider } from './npc/intent';
import { alertNpc, EYES_DOWN } from './suspicion';

/*
 * Evidence (§8.10): NPCs react to things that have changed, not only to people.
 *
 * - **What is evidence** comes from the state (`evidenceOnMap`, sources registered with `registerEvidenceSource`), each
 *   item with a stable id, its kind and the tiles it is seen on:
 *   - minor: a Secure door left open (nobody in the doorway), an empty teller window or a missing colleague (a staff
 *     member or guard who is down, stashed or dragged off while their schedule has them standing somewhere: their spot,
 *     `emptyWindow` for a teller window), a camera not transmitting, lights out (no source until power, M4);
 *   - major: a body (knocked out or dead, not stashed or dragged), a tied person, a hole (a breached door, a wall
 *     opened), and things on the floor (`State.evidence`, `placeEvidence`): a weapon, blood, an unattended loot bag
 *     (no crew member within a tile), a drill. A woken knockout victim reports its own assault (`assault`).
 * - **Who notices.** Only in the world phase (implementation plan §6 decision 26): every NPC looks along the walk it
 *   will take (`worldPoses`, the very poses perception judges the crew on) and notices each item it sees that it hasn't
 *   noticed before (`NpcState.noticed`). Civilians notice only major evidence; staff and enforcers both kinds. Cameras
 *   register major evidence (`State.cameraEvidence`, for the operator, M1-08). Noticing is judged on the state when the
 *   world phase begins, like the crew's sightings, and applied after them, so neither changes the other; what it
 *   makes NPCs want is committed at the end of the phase and telegraphed in the next crew phase (§6.2): the crew always
 *   gets a crew phase to answer (stash the body, close the door, deal with the witness).
 * - **What it does.** Minor: the NPC becomes Curious, and of those who noticed the same thing one investigates (the
 *   nearest of the right role, `pickInvestigator`: goal `inspect`, walking there); the others look (`look`) for one
 *   phase. The investigator goes back to its routine once it stands next to the spot (anything major there it notices
 *   on its own), or after `rules.evidencePhases` (3). Major: the NPC is **Alerted**, and the one sent reports
 *   (`report`): a guard radios where it stands (intent action `reportEvidence` with the `guardRadio` carrier, carried
 *   out by M1-08, which then calls `clearEvidence`), anyone else walks to the nearest guard and tells them
 *   (`tellEvidence`, carried out here: the guard is Alerted and has the evidence to report), or phones it in when no
 *   guard is about (`reportEvidence` with `phoneCall`).
 * - **Noises** (§8.9) are heard as evidence too, at once, in the crew phase and the world phase alike (`hearing`, a
 *   noise hook): a quiet one is minor (`quietNoise`: Curious, the one sent walks to the source, the others face it), a
 *   loud one major (`loudNoise`: Alerted, cause unknown, one reports it). Each hearer's source is the last tile it heard
 *   (a dash's end as far as it carried there, decision 45). In a crew phase the hearers' intents are rewritten at once
 *   (§6.2), so the arrows redraw, and those who look or investigate turn within the command and see what is there; `noiseReactions`
 *   gives the noise ring's ear badges from the same function.
 * - **Per occurrence**: once something is gone (a door shut, a body up again) NPCs forget they noticed it
 *   (`evidence.forget`, as each crew phase begins), so the next time is news; every noise is its own.
 * - **First-time barks** (§8.10): each NPC that notices something emits `bark` with the cause; `first` is true until
 *   the crew has seen an NPC bark that kind of evidence (`State.barked`), for the text naming it.
 * - **The hatched overlay** asks `evidenceWorldPhase`, the same function the world phase applies; about a tile, it
 *   passes the move there (`move`), judged on the move's preview. What the player is shown of it goes through
 *   `projectEvidenceSightings` (NPCs and cameras the crew knows).
 */

/**
 * Minor evidence (§8.10): makes the NPC Curious and sends one to look. `sent` is a guard the operator (or dispatch)
 * sends to look at a spot: a missed check-in's post, major evidence on a monitor (M1-08, `sendToLook`).
 */
export type MinorEvidence = 'secureDoor' | 'emptyWindow' | 'missingColleague' | 'cameraDown' | 'lightsOut' | 'quietNoise' | 'sent';
/** Major evidence (§8.10): makes the NPC Alerted and has one report it. */
export type MajorEvidence = 'body' | 'tied' | 'hole' | 'weapon' | 'blood' | 'lootBag' | 'drill' | 'assault' | 'loudNoise';
export type EvidenceKind = MinorEvidence | MajorEvidence;

export const MAJOR_EVIDENCE: ReadonlySet<EvidenceKind> = new Set<EvidenceKind>(['body', 'tied', 'hole', 'weapon', 'blood', 'lootBag', 'drill', 'assault', 'loudNoise']);

export const isMajor = (kind: EvidenceKind): boolean => MAJOR_EVIDENCE.has(kind);

/** Something on the map an NPC can notice. */
export interface Evidence {
    /** Stable while it lasts ('body:teller', 'door:d1', 'missing:teller', 'hole:<edge>', a placed item's id). */
    id: string;
    kind: EvidenceKind;
    /** The tiles it is seen on (both sides of a door or a hole). The first is where an investigator heads. */
    tiles: Pos[];
    /** The NPC it is about (a body, a missing colleague): that NPC doesn't notice it. */
    about?: string;
}

/** Things left on the floor (§8.10), placed by the actions that leave them (a dropped weapon, a wound, a loot bag). */
export interface PlacedEvidence { id: string; kind: 'weapon' | 'blood' | 'lootBag' | 'drill'; pos: Pos }

/** What an NPC means to do about evidence it noticed. */
export interface EvidenceWant {
    id: string;
    kind: EvidenceKind;
    major: boolean;
    tile: Pos;
    decided: { turn: number; phase: Phase };
}

/**
 * A camera's view of major evidence, waiting for the operator (M1-08): `handled` once the operator saw it on a monitor
 * and sent a guard (rules/cameras.ts). It stays while the evidence does, so the camera doesn't report it again.
 */
export interface CameraEvidence { camera: string; evidence: string; kind: EvidenceKind; tile: Pos; turn: number; handled: boolean }

declare module '../core/types' {
    interface NpcState {
        /** The evidence it is dealing with, or null. */
        evidence: EvidenceWant | null;
        /** Evidence it has noticed (by id): it reacts to each thing once. */
        noticed: string[];
    }
    interface State {
        /** Evidence left on the floor. */
        evidence: PlacedEvidence[];
        /** The kinds of evidence already barked about: later barks are generic (§8.10). */
        barked: string[];
        /** Major evidence cameras saw, for the operator (M1-08). */
        cameraEvidence: CameraEvidence[];
    }
    interface Rules {
        /** World phases an NPC keeps after minor evidence before going back to its routine. */
        evidencePhases: number;
    }
    interface IntentActionMap {
        /** Raises the alarm about evidence (a guard's radio, a phone call; M1-08 carries it out, then `clearEvidence`). */
        reportEvidence: { evidence: string; carrier: CarrierKind };
        /** Tells the guard `npc` about evidence if it ends its walk next to them. */
        tellEvidence: { npc: string; evidence: string };
    }
    interface EventMap {
        /** An NPC noticed evidence (§8.10). */
        evidenceNoticed: { npc: string; evidence: string; kind: string; major: boolean };
        /** An NPC says what it noticed; `first` when that kind is barked for the first time this heist (§8.10). */
        bark: { npc: string; cause: string; evidence: string; first: boolean };
        /** A camera saw major evidence (for the operator, M1-08). */
        cameraSawEvidence: { camera: string; evidence: string; kind: string; tile: Pos };
        /** An NPC told a guard about evidence. */
        toldEvidence: { npc: string; guard: string; evidence: string };
        /** An NPC is done with the evidence: it looked, found nothing more, or gave up. */
        evidenceDropped: { npc: string; evidence: string };
    }
}

registerRuleDefaults({ evidencePhases: 3 });

registerNpcInit('evidence', (_world, _person, npc) => {
    npc.evidence = null;
    npc.noticed = [];
});

registerStateInit('evidence', (_world, state) => {
    state.evidence = [];
    state.barked = [];
    state.cameraEvidence = [];
});

// ---------------------------------------------------------------------------------------------------------- Sources

export type EvidenceSource = (world: ReadonlyWorld, state: State) => Evidence[];

const SOURCES = new Map<string, EvidenceSource>();

/** Adds a source of evidence (lights out with power, M4). Sources run by name. */
export function registerEvidenceSource(name: string, source: EvidenceSource): void {
    if (SOURCES.has(name)) throw new Error(`Evidence source '${name}' already exists`);
    SOURCES.set(name, source);
}

/** Every piece of evidence on the map now, by id. */
export function evidenceOnMap(world: ReadonlyWorld, state: State): Evidence[] {
    const out: Evidence[] = [];
    for (const name of [...SOURCES.keys()].sort()) out.push(...SOURCES.get(name)!(world, state));
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Leaves something on the floor that is evidence (a weapon, blood, a loot bag, a drill). */
export function placeEvidence(ctx: Ctx, kind: PlacedEvidence['kind'], pos: Pos): PlacedEvidence {
    const item: PlacedEvidence = { id: newId(ctx.state, kind), kind, pos: { x: pos.x, y: pos.y } };
    ctx.state.evidence.push(item);
    return item;
}

const sides = (world: ReadonlyWorld, key: string): Pos[] => {
    const e = world.edges[key];
    if (!e) return [];
    return [e.run === 'eastWest' ? { x: e.tx, y: e.ty - 1 } : { x: e.tx - 1, y: e.ty }, { x: e.tx, y: e.ty }].filter(p => !!tileAt(world, p));
};

registerEvidenceSource('bodies', (_world, state) => state.npcs.flatMap((n): Evidence[] => {
    if (!isPresent(n) || bodyAway(state, n)) return [];
    if (n.status === 'unconscious' || n.status === 'dead') return [{ id: `body:${n.id}`, kind: 'body', tiles: [{ ...n.pos }], about: n.id }];
    if (n.status === 'tied') return [{ id: `tied:${n.id}`, kind: 'tied', tiles: [{ ...n.pos }], about: n.id }];
    return [];
}));

registerEvidenceSource('missing', (world, state) => state.npcs.flatMap((n): Evidence[] => {
    const down = EYES_DOWN.has(n.status) && isPresent(n);
    if (!down && !bodyAway(state, n)) return [];
    const person = world.people.find(p => p.id === n.id);
    if (!person || person.observer === 'civilian') return [];
    const now = activityAt(world, n.id, state.turn);
    const at = now?.block.at;
    if (!now || !at || ROUTE_ACTIVITIES.has(now.block.activity) || LEAVING_ACTIVITIES.has(now.block.activity)) return [];
    if (samePos(n.pos, at) && !bodyAway(state, n)) return [];
    return [{ id: `missing:${n.id}`, kind: now.block.activity === 'window' ? 'emptyWindow' : 'missingColleague', tiles: [{ x: at.x, y: at.y }], about: n.id }];
}));

registerEvidenceSource('doors', (world, state) => {
    const out: Evidence[] = [];
    // Someone standing in the doorway holds the door: a body lying there doesn't.
    const standing = new Set<string>([...state.crew.map(c => `${c.pos.x},${c.pos.y}`),
        ...state.npcs.filter(n => isPresent(n) && n.status !== 'unconscious' && n.status !== 'dead').map(n => `${n.pos.x},${n.pos.y}`)]);
    for (const id of sortedIds(world.doors)) {
        const def = world.doors[id]!, status = doorStatus(world, state, id), tiles = sides(world, def.edge);
        if (status === 'breached') { out.push({ id: `hole:${def.edge}`, kind: 'hole', tiles }); continue; }
        if (status !== 'open' || def.start === 'open') continue;
        if (!tiles.some(p => tileAt(world, p)!.zone === 'secure')) continue;
        if (tiles.some(p => standing.has(`${p.x},${p.y}`))) continue;
        out.push({ id: `door:${id}`, kind: 'secureDoor', tiles });
    }
    // A wall opened where there was no door (a hole cut or blown through, §14.2).
    for (const key of sortedIds(state.edges)) {
        const built = world.edges[key];
        if (!built || built.door || !built.blocksMove || state.edges[key]!.blocksMove !== false) continue;
        out.push({ id: `hole:${key}`, kind: 'hole', tiles: sides(world, key) });
    }
    return out;
});

registerEvidenceSource('cameras', (world, state) => world.cameras.flatMap((c): Evidence[] =>
    (state.cameras[c.id]?.live === false ? [{ id: `camera:${c.id}`, kind: 'cameraDown', tiles: [{ ...c.pos }] }] : [])));

registerEvidenceSource('floor', (_world, state) => state.evidence.flatMap((e): Evidence[] => {
    // A loot bag someone of the crew stands by is attended.
    if (e.kind === 'lootBag' && state.crew.some(c => Math.max(Math.abs(c.pos.x - e.pos.x), Math.abs(c.pos.y - e.pos.y)) <= 1)) return [];
    return [{ id: e.id, kind: e.kind, tiles: [{ ...e.pos }] }];
}));

// TODO(M4 power): 'lightsOut' — a room whose lights were cut, once power is in the rules.

// ---------------------------------------------------------------------------------------------------------- Noticing

/** Whether an observer class notices a kind of evidence: civilians only major (§8.10, §8.2). */
export const notices = (observer: ObserverClass, kind: EvidenceKind): boolean => observer !== 'civilian' || isMajor(kind);

/** An NPC or a camera noticing a piece of evidence in the coming world phase. */
export interface EvidenceSighting {
    observer: string;
    by: 'npc' | 'camera';
    evidence: string;
    kind: EvidenceKind;
    major: boolean;
    /** The tile it is seen on. */
    tile: Pos;
}

export interface EvidenceOptions {
    /** The intents the world phase walks (default the committed ones) and its passive group (default as it would freeze). */
    intents?: Readonly<Record<string, DeepReadonly<Intent>>>;
    passive?: readonly string[];
    /** The walks worked out once (`worldPoses` on the same state and sight map). */
    poses?: WorldPoses;
    /**
     * Ask about the world phase after this move or dash (the overlay asking about a tile): judged on its preview's
     * state, with the doors the path opens, what ending there makes NPCs want and any noise it makes.
     */
    move?: Extract<Command, { type: 'move' | 'dash' }>;
}

/**
 * What the coming world phase's noticing finds (see the header): every NPC along the walk it will take and every
 * camera at the facing it pans to, against the evidence on the map, minus what each has noticed already. The world
 * phase applies exactly this; the hatched overlay shows it.
 */
export function evidenceWorldPhase(world: ReadonlyWorld, state: State, sight: SightMap, options: EvidenceOptions = {}): EvidenceSighting[] {
    if (options.move) {
        const after = preview(world, state, options.move).state;
        const rest: EvidenceOptions = {};
        if (options.intents) rest.intents = options.intents;
        if (options.passive) rest.passive = options.passive;
        return evidenceWorldPhase(world, after, sightMap(world, after), rest);
    }
    const items = evidenceOnMap(world, state);
    if (!items.length) return [];
    const poses = options.poses?.sight === sight ? options.poses : worldPoses(world, state, sight, options.intents ?? null, options.passive ?? null);
    const out: EvidenceSighting[] = [];
    for (const npc of state.npcs) {
        const walk = poses.byNpc.get(npc.id), person = world.people.find(p => p.id === npc.id);
        if (!walk || !person) continue;
        const observer = person.observer;
        for (const item of items) {
            if (item.about === npc.id || npc.noticed.includes(item.id) || !notices(observer, item.kind)) continue;
            let seen: Pos | undefined;
            for (const { field } of walk) {
                seen = item.tiles.find(p => bandAt(field, p) !== null);
                if (seen) break;
            }
            if (seen) out.push({ observer: npc.id, by: 'npc', evidence: item.id, kind: item.kind, major: isMajor(item.kind), tile: { x: seen.x, y: seen.y } });
        }
    }
    for (const camera of world.cameras) {
        const pose = cameraObserver(world, state, camera.id, true);
        if (!pose) continue;
        const field = fieldOn(sight, pose);
        for (const item of items) {
            if (!isMajor(item.kind) || state.cameraEvidence.some(r => r.camera === camera.id && r.evidence === item.id)) continue;
            const seen = item.tiles.find(p => bandAt(field, p) !== null);
            if (seen) out.push({ observer: camera.id, by: 'camera', evidence: item.id, kind: item.kind, major: true, tile: { x: seen.x, y: seen.y } });
        }
    }
    return out;
}

/** Gives an NPC evidence to deal with: major outranks minor, and a newer item of the same weight the older one. */
function takeEvidence(ctx: Ctx, npc: NpcState, kind: EvidenceKind, id: string, tile: Pos): void {
    const major = isMajor(kind);
    if (!npc.noticed.includes(id)) npc.noticed.push(id);
    if (major) alertNpc(ctx, npc, `evidence ${kind}`);
    if (npc.evidence && npc.evidence.major && !major) return;
    npc.evidence = { id, kind, major, tile: { x: tile.x, y: tile.y }, decided: { turn: ctx.state.turn, phase: ctx.state.phase } };
}

/** Applies what was noticed (the one writer of evidence wants, with `tellEvidence` and the wake-up). */
export function applyEvidence(ctx: Ctx, sightings: readonly EvidenceSighting[]): void {
    const { state } = ctx;
    for (const s of sightings) {
        if (s.by === 'camera') {
            if (state.cameraEvidence.some(r => r.camera === s.observer && r.evidence === s.evidence)) continue;
            state.cameraEvidence.push({ camera: s.observer, evidence: s.evidence, kind: s.kind, tile: { ...s.tile }, turn: state.turn, handled: false });
            ctx.emit({ type: 'cameraSawEvidence', camera: s.observer, evidence: s.evidence, kind: s.kind, tile: { ...s.tile } });
            continue;
        }
        const npc = state.npcs.find(n => n.id === s.observer);
        if (!npc || EYES_DOWN.has(npc.status) || npc.noticed.includes(s.evidence)) continue;
        ctx.emit({ type: 'evidenceNoticed', npc: npc.id, evidence: s.evidence, kind: s.kind, major: s.major });
        bark(ctx, npc, s.kind, s.evidence);
        takeEvidence(ctx, npc, s.kind, s.evidence, s.tile);
    }
}

/**
 * An NPC says what it noticed. The first bark of a kind names it (§8.10): only one the crew can see or predict uses
 * that up, so the player hears the named version at least once.
 */
function bark(ctx: Ctx, npc: NpcState, kind: EvidenceKind, evidence: string): void {
    const { state } = ctx;
    const first = !state.barked.includes(kind);
    if (first && isKnownNow(ctx.world, state, npc.id)) state.barked.push(kind);
    ctx.emit({ type: 'bark', npc: npc.id, cause: kind, evidence, first });
}

/**
 * Sends an NPC to look at a spot (`sent`, minor: it walks there and looks, §8.11 a missed check-in, §8.12 major evidence
 * on a monitor). Its id names the errand ('checkin:guard:7'); major evidence it is dealing with comes first.
 */
export function sendToLook(ctx: Ctx, npc: NpcState, id: string, tile: Pos): void {
    takeEvidence(ctx, npc, 'sent', id, tile);
}

/** An NPC that woke from a knockout reports its own assault (rules/actions/knockout.ts). */
export function reportAssault(ctx: Ctx, npc: NpcState): void {
    takeEvidence(ctx, npc, 'assault', `assault:${npc.id}`, npc.pos);
}

/** The NPC is done with its evidence (M1-08 calls it once a radio call about it went out). */
export function clearEvidence(ctx: Ctx, npc: NpcState): void {
    if (!npc.evidence) return;
    ctx.emit({ type: 'evidenceDropped', npc: npc.id, evidence: npc.evidence.id });
    npc.evidence = null;
}

/** The carrier a guard's or a phone's evidence report starts (M1-08). */
export const REPORT_CARRIERS: Readonly<Record<'radio' | 'phone', CarrierKind>> = { radio: 'guardRadio', phone: 'phoneCall' };

// Noticing is judged on the state the world phase begins with, like the crew's sightings (perception.world, −100), and
// applied after them, before anyone moves (npcs.passive, 0): an NPC alerted by the crew's sightings doesn't watch closer
// for it, nor one alerted by evidence for the crew's sightings.
const JUDGED = new WeakMap<State, EvidenceSighting[]>();

registerWorldHook('passiveNpcs', 'evidence.judge', (ctx, phase) => {
    const { world, state } = ctx;
    JUDGED.set(state, evidenceWorldPhase(world, state, sightMap(world, state), { intents: phase.intents, passive: phase.passive }));
}, { order: -101 });

registerWorldHook('passiveNpcs', 'evidence.notice', ctx => {
    const found = JUDGED.get(ctx.state);
    JUDGED.delete(ctx.state);
    if (found) applyEvidence(ctx, found);
}, { order: -95 });

// Telling a guard (§8.10 "others go to tell a guard"), once the walks are done: next to the guard where both ended.
registerWorldHook('passiveNpcs', 'evidence.tell', (ctx, phase) => {
    const { state } = ctx;
    for (const id of phase.passive) {
        const action = phase.intents[id]?.action;
        if (action?.kind !== 'tellEvidence') continue;
        const teller = state.npcs.find(n => n.id === id), guard = state.npcs.find(n => n.id === action.npc);
        if (!teller || !guard || !teller.evidence || teller.evidence.id !== action.evidence) continue;
        if (EYES_DOWN.has(teller.status) || EYES_DOWN.has(guard.status) || !isPresent(guard)) continue;
        if (Math.max(Math.abs(teller.pos.x - guard.pos.x), Math.abs(teller.pos.y - guard.pos.y)) > 1) continue;
        ctx.emit({ type: 'toldEvidence', npc: teller.id, guard: guard.id, evidence: action.evidence });
        const ev = teller.evidence;
        teller.evidence = null;
        if (!guard.noticed.includes(ev.id) || !guard.evidence) takeEvidence(ctx, guard, ev.kind, ev.id, ev.tile);
    }
}, { order: 10 });

// Minor evidence runs out (see the header); onlookers look for one phase. Runs with the devices.
registerWorldHook('devices', 'evidence.settle', (ctx, phase) => {
    for (const npc of ctx.state.npcs) {
        const ev = npc.evidence;
        if (!ev || EYES_DOWN.has(npc.status)) continue;
        const goal = npc.goal.kind;
        const near = Math.max(Math.abs(npc.pos.x - ev.tile.x), Math.abs(npc.pos.y - ev.tile.y)) <= 1;
        const done = (goal === 'inspect' && near) || (goal === 'look' && ev.decided.turn < phase.turn)
            || (goal !== 'report' && phase.turn >= ev.decided.turn + ctx.world.rules.evidencePhases);
        if (done) clearEvidence(ctx, npc);
    }
}, { order: 45 });

// Evidence is per occurrence: once something is gone (the door shut, the body up again, the noise over) the NPCs
// forget they noticed it, so the next time it happens is news. Runs as the next crew phase begins.
registerWorldHook('crewPhase', 'evidence.forget', ctx => {
    const { world, state } = ctx;
    const now = new Set(evidenceOnMap(world, state).map(e => e.id));
    for (const npc of state.npcs) {
        const keep = npc.noticed.filter(id => now.has(id));
        if (keep.length !== npc.noticed.length) npc.noticed = keep;
    }
    if (state.cameraEvidence.some(r => !now.has(r.evidence))) state.cameraEvidence = state.cameraEvidence.filter(r => now.has(r.evidence));
});

// ---------------------------------------------------------------------------------------------------------- Hearing

/** What one NPC makes of a noise it heard (§8.9): what it will deal with, and whether it is the one sent to look. */
export interface Hearing {
    npc: string;
    /** The noise, as evidence: one id per noise made. */
    noise: string;
    kind: 'quietNoise' | 'loudNoise';
    /** The last source tile it heard (`Ring.lastHeard`: a dash's last tile whose sound reaches it): where it looks or goes. */
    tile: Pos;
    /** Quiet: it is the one who goes to look (the others turn to face it). Loud: the one who reports it. */
    sent: boolean;
    /** The badge it ends up with for the ear on the noise ring: Curious, Investigating or Alerted. */
    status: 'curious' | 'investigating' | 'alerted';
}

/**
 * What the NPCs who hear a noise make of it (§8.9): a quiet noise makes them Curious and one of them (the nearest of
 * the right role, `pickInvestigator`) goes to the source; a loud one makes them Alerted, cause unknown, and one reports
 * it (a guard's radio, someone telling a guard: the evidence reports, M1-08's carriers). Each hearer's source is the
 * last tile of the noise it heard (`Ring.lastHeard`): the end of a dash as far as it carried there. NPCs face down
 * (commanded, tied) hear but don't react. The noise hook applies exactly this; the noise ring's preview labels each ear
 * with `status`.
 */
export function hearing(world: ReadonlyWorld, state: State, ring: Ring, kind: NoiseKind, cause: string): Hearing[] {
    const noise = `noise:${state.turn}:${state.phase}:${cause}`, ev: EvidenceKind = kind === 'loud' ? 'loudNoise' : 'quietNoise';
    const hearers = npcsInside(state, ring).map(id => state.npcs.find(n => n.id === id)!).filter(n => !EYES_DOWN.has(n.status) && isPresent(n));
    const tileFor = (n: DeepReadonly<NpcState>): Pos => {
        const p = ring.lastHeard({ x: n.pos.x, y: n.pos.y }) ?? ring.sources[ring.sources.length - 1]!;
        return { x: p.x, y: p.y };
    };
    const tiles = new Map(hearers.map(n => [n.id, tileFor(n)]));
    const sent = pickInvestigator(world, hearers.filter(n => decidesFor(n)).map(n => ({ npc: n, tile: tiles.get(n.id)! })));
    return hearers.map(n => ({
        npc: n.id, noise, kind: ev, tile: tiles.get(n.id)!, sent: n.id === sent,
        status: kind === 'loud' || n.alerted ? 'alerted' : n.id === sent ? 'investigating' : 'curious'
    }));
}

/** What a noise from the table would make the NPCs who hear it do: the ring's ear badges, by the same function. */
export function noiseReactions(world: ReadonlyWorld, state: State, what: NoiseSource, sources: Pos | readonly Pos[], cause: string, radius?: number): Hearing[] {
    const ring = soundRing(world, state, sources, noiseRadius(what, radius));
    return hearing(world, state, ring, NOISES[what].kind, cause);
}

/**
 * What hearing a noise does (the `hearing` noise hook): each hearer reacts as `hearing` says, and in a crew phase the
 * hearers' new intents are committed at once and every hearer turns to face its last-heard tile straight away
 * (`queueLook`: the command turns them once its own perception is judged, and what they then see counts, perceive.ts
 * `turnLookers`). Those it sends to look at it or to investigate it (`look`, `inspect`) take it as their goal; one whose
 * stronger want wins (investigating a crew member, a challenge, an escort) only glances: it keeps its goal and in the
 * world phase walks and faces as that want has it. Those face down (`hearing` leaves them out) don't turn. Exported
 * for previews that put a noise on a copy without the rest of `makeNoise` (the safe floor's dash band, M1-09).
 */
export function reactToNoise(ctx: Ctx, ring: Ring, kind: NoiseKind, cause: string): void {
    const heard = hearing(ctx.world, ctx.state, ring, kind, cause);
    if (!heard.length) return;
    for (const h of heard) {
        const npc = ctx.state.npcs.find(n => n.id === h.npc)!;
        if (h.kind === 'loudNoise') alertNpc(ctx, npc, 'noise');
        bark(ctx, npc, h.kind, h.noise);
        takeEvidence(ctx, npc, h.kind, h.noise, h.tile);
    }
    // In a crew phase the hearers' new intents are telegraphed at once (§6.2), and every hearer turns to the noise now.
    reconsider(ctx);
    if (ctx.state.phase !== 'crew') return;
    for (const h of heard) {
        const npc = ctx.state.npcs.find(n => n.id === h.npc)!, facing = facingToward(npc.pos, h.tile);
        if (facing && facing !== npc.facing) queueLook(ctx.state, npc.id, facing);
    }
}

registerNoiseHook('hearing', reactToNoise);

/**
 * What the player may be shown of evidence sightings (a prediction or the overlay): only those of NPCs the crew sees
 * or predicts, and of cameras it knows. The outcome itself is the full truth.
 */
export function projectEvidenceSightings(world: ReadonlyWorld, state: State, sightings: readonly EvidenceSighting[]): EvidenceSighting[] {
    return sightings.filter(s => (s.by === 'npc' ? isKnownNow(world, state, s.observer) : state.knowledge.cameras.includes(s.observer)));
}

/** Whether a lying NPC's body lies where it can be found (not dragged or stashed). */
export const bodyLying = (state: DeepReadonly<State>, npc: DeepReadonly<NpcState>): boolean =>
    LYING_STATUSES.has(npc.status) && isPresent(npc) && npc.stashed === null && !draggedBy(state, npc.id);

registerEvents({
    evidenceNoticed: { undoBlocking: true },
    bark: { undoBlocking: true },
    cameraSawEvidence: { undoBlocking: true },
    toldEvidence: { undoBlocking: true },
    evidenceDropped: { undoBlocking: false }
});
