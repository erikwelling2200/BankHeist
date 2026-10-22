import type { GlyphName } from '../art/ui/glyphs';
import {
    crewPicture, LYING_STATUSES, neutralised, profilesOf, npcObserver, seenTiles, bandAt, type ActionPreview, type CarrierKind, type Explanation,
    type KnownCamera, type KnownView, type NpcMarker, type PathSafety, type Pos, type ReadonlyWorld, type SafeFloor, type State, type Tint, type TintKind, type Witness
} from '../sim';
import { rolePortrait } from './views';

/*
 * What the world UI layer draws over people (UI.md "Over heads", GAME_DESIGN §16.5, §20.4), worked out from what the
 * crew knows (§8.15): the NPC markers of `knownView` (live ones where they stand, predicted ones where their routine
 * puts them), the carriers the threat ledger shows, and for NPCs the crew sees now their pips, exposure and challenges.
 * Ghosts and NPCs the crew doesn't know get nothing. The scene's overlay (src/scenes/bank/overlay.ts) draws these.
 */

/** A signal colour of the palette (UI.md "Signal palette"); the colour-blind preset swaps each for its own. */
export type Signal = 'safe' | 'amber' | 'red' | 'command' | 'cream';

/** One dark plate: a glyph, and a countdown or a symbol after it. */
export interface PlateVM { glyph: GlyphName; signal: Signal; count?: number; sym?: '?' | '!'; /** A second glyph (Investigating's target pin). */ then?: GlyphName }

/** What one NPC (or a carrier on an object) wears over its head. */
export interface BadgeVM {
    id: string;
    pos: Pos;
    /** Lying down (out cold, tied, face down): the plate sits low, over the body. */
    lying: boolean;
    /** A predicted marker: the plate is drawn faded, as the person is. */
    faded: boolean;
    plates: PlateVM[];
    /** Suspicion pips (0–3) per crew member, in their colour, above the plates. */
    pips: { crew: string; n: number }[];
}

const CARRIER_GLYPHS: Readonly<Record<CarrierKind, GlyphName>> = {
    tellerButton: 'bell', managerButton: 'bell', guardRadio: 'radio', operatorCamera: 'camera', phoneCall: 'phone', escapee: 'run',
    missedCheckIn: 'radio', seismicSensor: 'bell', motionSensor: 'bell', patrolCar: 'bell'
};

/**
 * A guard's radio (§8.11), for a guard who is down: ringing (amber `!`: answer it this crew phase or it is missed), or
 * the world phases to the next call. A guard on his feet answers his own calls: nothing to show.
 */
function radioPlate(state: State, id: string): PlateVM | undefined {
    const call = (state as Partial<State>).radio?.calls[id], npc = state.npcs.find(n => n.id === id);
    if (!call || !npc || !neutralised(state, npc)) return undefined;
    if (call.ringing !== null) return { glyph: 'radio', signal: 'amber', sym: '!' };
    if (state.bank.alarm) return undefined;
    return { glyph: 'radio', signal: 'cream', count: Math.max(1, call.next - state.turn + 1) };
}

/** The status plate (§16.5): none for Calm; `?`, `?` with a pin, `!`, a down arrow, a knot, a crosshair. */
function statusPlate(status: string | undefined): PlateVM | undefined {
    switch (status) {
        case 'curious': return { glyph: 'q', signal: 'amber' };
        case 'investigating': return { glyph: 'q', signal: 'amber', then: 'pin' };
        case 'alerted': return { glyph: 'bang', signal: 'red' };
        case 'hostile': return { glyph: 'cross', signal: 'red' };
        case 'commanded': return { glyph: 'down', signal: 'command' };
        case 'tied': return { glyph: 'knot', signal: 'cream' };
        default: return undefined;
    }
}

/** Every badge over the people and carriers the crew knows of, in the order of `known.npcs`, then object carriers. */
export function npcBadges(_world: ReadonlyWorld, state: State, known: KnownView): BadgeVM[] {
    const out: BadgeVM[] = [];
    // Every live carrier, as the threat ledger lists them (a countered one is gone).
    const carriers = state.carriers.filter(c => c.halted !== 'countered');
    for (const m of known.npcs) {
        if (m.kind === 'ghost') continue;
        const npc = state.npcs.find(n => n.id === m.id);
        const live = m.kind === 'live' && npc;
        const plates: PlateVM[] = [];
        // The carrier its holder raises (`carrierStarted.holder`, the carrier's `source`).
        const carrier = carriers.find(c => c.source === m.id);
        if (carrier) plates.push({ glyph: CARRIER_GLYPHS[carrier.kind] ?? 'bell', signal: carrier.halted ? 'cream' : 'red', count: carrier.countdown });
        const radio = radioPlate(state, m.id);
        if (radio) plates.push(radio);
        if (live && npc.challenges.length) {
            const soonest = Math.min(...npc.challenges.map(c => c.deadline));
            plates.push({ glyph: 'hand', signal: 'red', count: Math.max(0, soonest - state.turn) });
        } else if (live && npc.warned.length) plates.push({ glyph: 'hand', signal: 'amber' });
        if (live && npc.exposedTo.length) plates.push({ glyph: 'eye', signal: 'red' });
        const status = statusPlate(m.status);
        // A carrier's plate already says the NPC is raising the alarm.
        if (status && !(carrier && status.glyph === 'bang')) plates.push(status);
        const pips = live ? Object.entries(npc.suspicion).filter(([crew, n]) => n > 0 && !npc.exposedTo.includes(crew)).map(([crew, n]) => ({ crew, n }))
            .sort((a, b) => state.crew.findIndex(c => c.id === a.crew) - state.crew.findIndex(c => c.id === b.crew)) : [];
        if (!plates.length && !pips.length) continue;
        out.push({ id: m.id, pos: m.pos, lying: lying(m), faded: m.kind === 'predicted', plates, pips });
    }
    // Carriers held by no NPC (dispatch, the patrol car): their plate where they are. One held by an NPC the crew doesn't
    // know is in the ledger, not on the map: the carrier shows, not who carries it.
    for (const c of carriers) {
        if (state.npcs.some(n => n.id === c.source)) continue;
        out.push({ id: c.id, pos: c.pos, lying: true, faded: false, plates: [{ glyph: CARRIER_GLYPHS[c.kind] ?? 'bell', signal: c.halted ? 'cream' : 'red', count: c.countdown }], pips: [] });
    }
    return out;
}

const lying = (m: NpcMarker): boolean => !!m.status && LYING_STATUSES.has(m.status);

/**
 * Someone inside a noise ring and what they will do about it (UI.md "Rings", §8.9): Curious, Investigating or Alerted;
 * `still` for one face down (commanded, tied) who hears it and doesn't react.
 */
export interface HearerVM { id: string; pos: Pos; lying: boolean; sym?: '?' | '!'; signal: Signal; /** The one sent to look. */ sent?: boolean; still?: boolean }

/**
 * The ears of a previewed command's noises (`actionPreview`'s `noises`, the one projection of the preview: only NPCs the
 * crew knows), where the crew knows each hearer to stand. What they see of the act itself is the witnesses' plate.
 */
export function previewHearers(known: KnownView, preview: ActionPreview): HearerVM[] {
    if (!preview.ok) return [];
    const out: HearerVM[] = [];
    for (const noise of preview.noises) {
        for (const ear of noise.ears) {
            const m = known.npcs.find(k => k.id === ear.npc);
            if (!m || m.kind === 'ghost' || out.some(o => o.id === ear.npc)) continue;
            const base = { id: ear.npc, pos: { x: m.pos.x, y: m.pos.y }, lying: lying(m) };
            if (ear.status === 'still') out.push({ ...base, signal: 'cream', still: true });
            else out.push({ ...base, sym: ear.status === 'alerted' ? '!' : '?', signal: ear.status === 'alerted' ? 'red' : 'amber', ...(ear.sent ? { sent: true } : {}) });
        }
    }
    return out;
}

/** Every tile a previewed command's noises reach (the rings as drawn), or undefined when it makes none. */
export function previewNoise(preview: ActionPreview): Pos[] | undefined {
    if (!preview.ok || !preview.noises.length) return undefined;
    const seen = new Set<string>(), out: Pos[] = [];
    for (const n of preview.noises) {
        for (const t of n.tiles) {
            const k = `${t.x},${t.y}`;
            if (!seen.has(k)) { seen.add(k); out.push({ x: t.x, y: t.y }); }
        }
    }
    return out;
}

/** Someone who would notice a previewed command (§8.4), and what they'd make of it: their plate says so. */
export interface WitnessVM { id: string; pos: Pos; lying: boolean; what: Witness['what']; by: Witness['by']; pips?: number }

/** The witnesses of `actionPreview` (projected: only those the crew knows), where the crew knows them to be. */
export function previewWitnesses(world: ReadonlyWorld, known: KnownView, preview: ActionPreview): WitnessVM[] {
    if (!preview.ok) return [];
    const out: WitnessVM[] = [];
    for (const w of preview.witnesses) {
        if (out.some(o => o.id === w.observer)) continue;
        if (w.by === 'camera') {
            const cam = world.cameras.find(c => c.id === w.observer);
            if (cam) out.push({ id: w.observer, pos: { x: cam.pos.x, y: cam.pos.y }, lying: true, what: w.what, by: 'camera' });
            continue;
        }
        const m = known.npcs.find(k => k.id === w.observer);
        if (m && m.kind !== 'ghost') out.push({ id: w.observer, pos: { x: m.pos.x, y: m.pos.y }, lying: lying(m), what: w.what, by: 'npc', ...(w.pips ? { pips: w.pips } : {}) });
    }
    return out;
}

/** A witness's plate: the eye in the colour of what they make of it, a hand for a challenge, the camera's `!`. */
export function witnessPlate(w: WitnessVM): PlateVM {
    switch (w.what) {
        case 'exposed': return { glyph: 'eye', signal: 'red', sym: '!' };
        case 'camera': return { glyph: 'camera', signal: 'red', sym: '!' };
        case 'challenge': return { glyph: 'hand', signal: 'amber' };
        case 'pips': return { glyph: 'eye', signal: 'amber', ...(w.pips ? { count: w.pips } : {}) };
        default: return { glyph: 'eye', signal: 'cream' };
    }
}

// ---------------------------------------------------------------------------------------------------------- Safe floor

/** One tile of the safe floor as the overlay draws it (UI.md "Safe floor", §8.8). */
export interface FloorTileVM {
    pos: Pos;
    band: 'move' | 'dash';
    kind: TintKind;
    /** It happens in the coming world phase (hatched). */
    hatched: boolean;
    /** Pips added, all NPCs together (amber: drawn as that many squares, at most 3). */
    pips: number;
    eye: boolean;
    camera: boolean;
}

const tintVM = (pos: Pos, band: 'move' | 'dash', t: Tint): FloorTileVM => ({
    pos: { x: pos.x, y: pos.y }, band, kind: t.kind, hatched: t.hatched, pips: t.pips.reduce((n, p) => n + p.pips, 0), eye: t.eye, camera: t.camera
});

/** The safe floor's Move and Dash tiles (the crew member's own tile, `stay`, is under them: not drawn). */
export function floorTiles(floor: { readonly tiles: readonly SafeFloor['tiles'][number][] }): FloorTileVM[] {
    return floor.tiles.flatMap(t => (t.band === 'stay' ? [] : [tintVM(t.pos, t.band, t.tint)]));
}

/** One step of a drawn path, tinted (§8.8 "along the whole drawn path"). */
export interface PathStepVM { pos: Pos; kind: TintKind; hatched: boolean }

/** A drawn or previewed path judged by `pathSafety`: each step's tint, the eye on the first unsafe step, the end's tile. */
export interface PathVM { steps: PathStepVM[]; eyeAt: number | null; end: FloorTileVM }

/**
 * Each step passed is red where someone would see a `!` (only `!` counts mid-move; a camera's is the camera's), else
 * what the crew knows of it; the end is tinted as the safe floor tints it (hatched when the world phase does it).
 */
export function pathView(safety: PathSafety): PathVM | undefined {
    if (!safety.ok) return undefined;
    const last = safety.steps.length - 1;
    const steps = safety.steps.map((s, i): PathStepVM => {
        if (i === last) return { pos: { ...s.pos }, kind: safety.end.tint.kind, hatched: safety.end.tint.hatched };
        const kind: TintKind = s.sightings.length ? (s.sightings.every(x => x.by === 'camera') ? 'camera' : 'red')
            : s.passing === 'unscouted' ? 'grey' : s.passing === 'unknownRisk' ? 'unknownRisk' : 'safe';
        return { pos: { ...s.pos }, kind, hatched: false };
    });
    return { steps, eyeAt: safety.firstUnsafe, end: tintVM(safety.end.pos, safety.mode, safety.end.tint) };
}

/** "Who and why" (§8.8): a tag on a long-pressed tile, one line per observer, and their sightlines drawn on the map. */
export interface ExplainVM {
    tile: Pos;
    lines: { observer: string | null; by: Explanation['by']; portrait?: string; icon?: 'camera' | 'unknown'; text: string; phase: 'now' | 'next'; outcome: Explanation['outcome']; from: Pos | null; to: Pos }[];
}

/** The explanation of a tile; `inFloor` says the tile is one the crew member can reach (a quiet line when nobody notices). */
export function explainView(world: ReadonlyWorld, tile: Pos, entries: readonly Explanation[], inFloor: boolean): ExplainVM | undefined {
    if (!entries.length && !inFloor) return undefined;
    const lines: ExplainVM['lines'] = entries.map(e => {
        const person = e.by === 'npc' ? world.people.find(p => p.id === e.observer) : undefined, portrait = person && rolePortrait(person.role);
        return {
            observer: e.observer, by: e.by, ...(portrait ? { portrait } : {}), ...(e.by === 'camera' ? { icon: 'camera' as const } : e.by === 'unknown' ? { icon: 'unknown' as const } : {}),
            text: e.phase === 'next' ? `Next phase: ${e.text}` : e.text, phase: e.phase, outcome: e.outcome, from: e.from ? { ...e.from } : null, to: { ...e.to }
        };
    });
    if (!lines.length) lines.push({ observer: null, by: 'unknown', text: 'Nobody the crew knows of would notice, now or next phase', phase: 'now', outcome: '-', from: null, to: { ...tile } });
    return { tile: { ...tile }, lines };
}

/** An NPC's vision as the crew can know it (long-press, §20.4): its tiles by band, and whether it is on edge. */
export interface ConeVM { id: string; from: Pos; core: Pos[]; peripheral: Pos[]; alerted: boolean }

/**
 * The cones of a known NPC (live or predicted), from where the crew knows it to stand and face, on the crew's picture
 * of the bank: the same sight rules perception uses (`seenTiles`). Undefined for one the crew doesn't know, or that
 * sees nothing (out cold).
 */
export function npcCone(world: ReadonlyWorld, state: State, known: KnownView, id: string): ConeVM | undefined {
    const m = known.npcs.find(k => k.id === id), npc = state.npcs.find(n => n.id === id);
    if (!m || m.kind === 'ghost' || !npc) return undefined;
    const observer = npcObserver(world, { ...npc, pos: m.pos, facing: m.facing, status: m.status ?? npc.status });
    if (!observer) return undefined;
    const field = seenTiles(world, crewPicture(world, state), observer), core: Pos[] = [], peripheral: Pos[] = [];
    for (const t of field.tiles) {
        if (t.x === m.pos.x && t.y === m.pos.y) continue;
        (bandAt(field, t) === 'core' ? core : peripheral).push({ x: t.x, y: t.y });
    }
    return { id, from: m.pos, core, peripheral, alerted: npc.alerted };
}

/**
 * A camera the crew knows of (§8.12, §8.15), as the overlay draws it: where it is, what the crew knows of its feed and,
 * when its cones are asked for, the tiles it watches now (and, for a panning one, those of its next facing: the
 * telegraph). A camera whose feed status is unknown (the CCTV room not scouted) counts as live (§8.8); a looped feed is
 * dimmed with the phases its loop has left; a dead one watches nothing.
 */
export interface CameraVM {
    id: string;
    pos: Pos;
    status: KnownCamera['status'];
    /** On the operator's monitors this turn (known once the CCTV room is scouted). */
    monitored: boolean;
    /** World phases its loop has left, if looped. */
    loopLeft?: number;
    /** Dead: off and not looped. */
    dead: boolean;
    core: Pos[];
    peripheral: Pos[];
    /** A panning camera's next facing's tiles (all bands). */
    next?: Pos[];
}

/** The cameras the crew knows of (`known.cameras`); with `cones`, the tiles each watches, on the crew's picture. */
export function cameraViews(world: ReadonlyWorld, state: State, known: KnownView, cones: boolean): CameraVM[] {
    const picture = cones ? crewPicture(world, state) : undefined;
    const profiles = profilesOf(world);
    return known.cameras.map(cam => {
        const def = world.cameras.find(c => c.id === cam.id)!, now = state.cameras[cam.id];
        const loopLeft = cam.loopedUntil !== undefined ? Math.max(1, cam.loopedUntil - state.turn + 1) : undefined;
        const dead = cam.status === 'off' && loopLeft === undefined;
        const vm: CameraVM = { id: cam.id, pos: { x: cam.pos.x, y: cam.pos.y }, status: cam.status, monitored: !!cam.monitored, dead, core: [], peripheral: [], ...(loopLeft ? { loopLeft } : {}) };
        if (!picture || dead || !now) return vm;
        // Drawn from where it points, as if live: an unknown feed counts as live, and a looped one shows what it will watch again.
        const profile = (def as { seesInDark?: boolean }).seesInDark ? profiles.darkCamera : profiles.camera;
        const field = (k: number) => seenTiles(world, picture, { pos: def.pos, facing: def.facings[k % def.facings.length]!, profile });
        const f = field(now.facing);
        for (const t of f.tiles) {
            if (t.x === def.pos.x && t.y === def.pos.y) continue;
            (bandAt(f, t) === 'core' ? vm.core : vm.peripheral).push({ x: t.x, y: t.y });
        }
        if (def.facings.length > 1 && loopLeft === undefined) vm.next = field(now.facing + 1).tiles.filter(t => t.x !== def.pos.x || t.y !== def.pos.y).map(t => ({ x: t.x, y: t.y }));
        return vm;
    });
}
