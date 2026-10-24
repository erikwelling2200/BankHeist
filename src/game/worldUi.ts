import type { GlyphName } from '../art/ui/glyphs';
import {
    commandPreview, crewPicture, LYING_STATUSES, type CommandRings, type CommandTarget, neutralised, profilesOf, npcObserver, seenTiles, bandAt, type ActionPreview, type CarrierKind, type DeepReadonly, type Effect, effectKind, type Explanation, type FloorTile, TINT_RANK,
    type KnownCamera, type KnownView, type MarkerKind, type NpcMarker, type PathSafety, type TileVisibility, VISIBILITY, type Pos, type ReadonlyWorld, type SafeFloor, type Sighting, type State, type TintKind, type Witness
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

/** One dark plate: a glyph, and a countdown (or a resister's "5%") or a symbol after it. */
export interface PlateVM {
    glyph: GlyphName; signal: Signal; count?: number | string; sym?: '?' | '!'; /** A second glyph (Investigating's target pin). */ then?: GlyphName;
    /** Stays when a preview's plate stands in for the state plates (a running carrier's countdown is always shown). */
    keep?: boolean;
}

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

/**
 * What a known NPC's intent telegraphs it will do in the coming world phase (§10.5 lapses, §10.8 panic, §10.9): run for
 * a way out (red runner), hide to phone it in (amber runner to a pin), reach for a weapon (red hand on a gun: it draws
 * in that phase), tackle a crew member beside it. Read from the intent the crew sees (`NpcMarker.intent`), so it shows
 * only once the rules have rolled it, and an armed civilian's reach only once he reaches.
 */
export function intentPlate(m: Pick<NpcMarker, 'intent'>): PlateVM | undefined {
    switch (m.intent?.action?.kind) {
        case 'flee': return { glyph: 'run', signal: 'red' };
        case 'hide': return { glyph: 'run', signal: 'amber', then: 'pin' };
        case 'reachForWeapon': return { glyph: 'hand', signal: 'red', then: 'gun' };
        case 'tackle': return { glyph: 'bang', signal: 'red', then: 'hand' };
        default: return undefined;
    }
}

/** The status plate (§16.5): none for Calm; `?`, `?` with a pin, `!`, a down arrow, a knot, a crosshair. */
function statusPlate(status: string | undefined): PlateVM | undefined {
    switch (status) {
        case 'curious': return { glyph: 'q', signal: 'amber' };
        case 'investigating': return { glyph: 'q', signal: 'amber', then: 'pin' };
        case 'alerted': return { glyph: 'bang', signal: 'red' };
        case 'panicked': return { glyph: 'drops', signal: 'amber' };
        case 'hostile': return { glyph: 'cross', signal: 'red' };
        case 'commanded': return { glyph: 'down', signal: 'command' };
        case 'tied': return { glyph: 'knot', signal: 'cream' };
        default: return undefined;
    }
}

/**
 * Whether an NPC drawn as a marker of `kind` may be drawn on a tile of this visibility (decision 44): the NPC as it is
 * (a live marker) only on one seen this turn; a predicted or ghost marker (what the crew knows or remembers) anywhere,
 * over a hidden tile's block too (its cone and walk clipped to what isn't hidden: `npcCone`, `unhiddenRuns`).
 */
export const npcDrawnOn = (kind: MarkerKind, visibility: TileVisibility): boolean => visibility === 'seen' || kind !== 'live';

const hiddenAt = (known: KnownView, p: Pos): boolean =>
    p.x < 0 || p.y < 0 || p.x >= known.width || p.y >= known.height || VISIBILITY[known.visibility[p.y * known.width + p.x] ?? 0] === 'hidden';

/**
 * A walk from `from` along `path` as it may be drawn (decision 44): only its runs over tiles that aren't hidden, each as
 * a walk from its first tile, so a walk through a hidden room never draws its layout.
 */
export function unhiddenRuns(known: KnownView, from: Pos, path: readonly Pos[]): { from: Pos; path: Pos[] }[] {
    const out: { from: Pos; path: Pos[] }[] = [];
    let run: { from: Pos; path: Pos[] } | null = null;
    for (const p of [from, ...path]) {
        if (hiddenAt(known, p)) { run = null; continue; }
        if (run) run.path.push({ x: p.x, y: p.y });
        else out.push(run = { from: { x: p.x, y: p.y }, path: [] });
    }
    return out.filter(r => r.path.length);
}

/** The NPC markers the scene draws a person for (`npcDrawnOn` where each stands), in the order of `known.npcs`. */
export function npcSprites(known: KnownView): NpcMarker[] {
    return known.npcs.filter(m => npcDrawnOn(m.kind, VISIBILITY[known.visibility[m.pos.y * known.width + m.pos.x] ?? 0]!));
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
        if (carrier) plates.push({ glyph: CARRIER_GLYPHS[carrier.kind] ?? 'bell', signal: carrier.halted ? 'cream' : 'red', count: carrier.countdown, ...(carrier.halted ? {} : { keep: true }) });
        const radio = radioPlate(state, m.id);
        if (radio) plates.push(radio);
        if (live && npc.challenges.length) {
            const soonest = Math.min(...npc.challenges.map(c => c.deadline));
            plates.push({ glyph: 'hand', signal: 'red', count: Math.max(0, soonest - state.turn) });
        } else if (live && npc.warned.length) plates.push({ glyph: 'hand', signal: 'amber' });
        if (live && npc.exposedTo.length) plates.push({ glyph: 'eye', signal: 'red' });
        const status = statusPlate(m.status);
        // Command pips (§10.2) count down on the face-down plate; at 0 it is Twitchy (§10.5).
        if (status && live && npc.command) status.count = npc.command.pips;
        // A carrier's plate already says the NPC is raising the alarm.
        if (status && !(carrier && status.glyph === 'bang')) plates.push(status);
        // Surprised by GO (§9.3): it loses the coming world phase.
        if (live && npc.surprised === state.turn) plates.push({ glyph: 'star', signal: 'cream' });
        // A lapse or a panic reaction its intent telegraphs; a runner's own carrier already says it runs.
        const intent = intentPlate(m);
        if (intent && !(carrier?.kind === 'escapee' && intent.glyph === 'run' && intent.signal === 'red')) plates.push(intent);
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
            else out.push({ ...base, sym: ear.status === 'alerted' || ear.status === 'panicked' ? '!' : '?', signal: ear.status === 'alerted' ? 'red' : 'amber', ...(ear.sent ? { sent: true } : {}) });
        }
    }
    return out;
}

/**
 * Every tile a previewed command's noises reach (the rings as drawn), or undefined when it makes none. With `known`,
 * only those that aren't hidden: sound floods round walls, so a ring over a hidden room would draw its layout.
 */
export function previewNoise(preview: ActionPreview, known?: KnownView): Pos[] | undefined {
    if (!preview.ok || !preview.noises.length) return undefined;
    const seen = new Set<string>(), out: Pos[] = [];
    for (const n of preview.noises) {
        for (const t of n.tiles) {
            const k = `${t.x},${t.y}`;
            if (seen.has(k) || (known && hiddenAt(known, t))) continue;
            seen.add(k);
            out.push({ x: t.x, y: t.y });
        }
    }
    return out;
}

/** The tiles of `tiles` that aren't hidden (decision 44): a band drawn over a hidden room would draw its layout. */
export const unhiddenTiles = (known: KnownView, tiles: readonly Pos[]): Pos[] => tiles.filter(t => !hiddenAt(known, t));

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
    /** It happens in the coming world phase (the corner marker, `next`). */
    hatched: boolean;
    /** Pips added, all NPCs together (amber: drawn as that many squares, at most 3). */
    pips: number;
    eye: boolean;
    camera: boolean;
    /** A door the crew can't vouch for could make it worse than this (hatched grey over the tint; `unknownRisk` is it). */
    doorRisk: boolean;
    /** What the move itself does (the tile's fill and glyph): `kind` and `pips` without the coming world phase. */
    now: PhaseVM;
    /** What the coming world phase then does, when it is worse than the move (the corner marker); `hatched` is it. */
    next?: PhaseVM;
}

/** One phase's verdict on a tile: its tint kind and the pips it adds, all NPCs together. */
export interface PhaseVM { kind: TintKind; pips: number }

const pipsOf = (e: DeepReadonly<Effect> | null): number => (e ? Object.values(e.pips).reduce((n, p) => n + p, 0) : 0);

/**
 * A floor tile as the overlay draws it: its tint, and that tint split into what the move does (`now`, the teammates'
 * share in it) and, when worse, what the coming world phase does (`next`), as the engine's `tintOf` weighs them; a move
 * that does nothing reads as the tile's knowledge (unknown risk, grey) as the tint does.
 */
const tileVM = (t: DeepReadonly<FloorTile>, band: 'move' | 'dash'): FloorTileVM => {
    const tint = t.tint, base = {
        pos: { x: t.pos.x, y: t.pos.y }, band, kind: tint.kind, hatched: tint.hatched, pips: tint.pips.reduce((n, p) => n + p.pips, 0), eye: tint.eye,
        camera: tint.camera, doorRisk: tint.doorRisk
    };
    if (!tint.hatched) return { ...base, now: { kind: tint.kind, pips: base.pips } };
    const moved = t.teammates.reduce<ReturnType<typeof effectKind>>((k, m) => {
        const e = effectKind(m.effect);
        return TINT_RANK[e] > TINT_RANK[k] ? e : k;
    }, effectKind(t.now));
    // A door not seen this turn could make it worse: unknown risk, as the same tile without a next verdict reads.
    const quiet: TintKind = t.knowledge === 'hidden' ? 'grey' : t.knowledge === 'unknownRisk' || t.unknownPath || tint.doorRisk ? 'unknownRisk' : 'safe';
    const nowPips = pipsOf(t.now) + t.teammates.reduce((n, m) => n + pipsOf(m.effect), 0);
    return { ...base, now: { kind: moved === 'safe' ? quiet : moved, pips: nowPips }, next: { kind: tint.kind, pips: pipsOf(t.next) } };
};

/** The safe floor's Move and Dash tiles (the crew member's own tile, `stay`, is under them: not drawn). */
export function floorTiles(floor: { readonly tiles: readonly SafeFloor['tiles'][number][] }): FloorTileVM[] {
    return floor.tiles.flatMap(t => (t.band === 'stay' ? [] : [tileVM(t, t.band)]));
}

/**
 * The crew member's own tile (`stay`): what ending the turn there does, as a floor tile (band `move`, which it is not;
 * the overlay draws it round the person instead of under them), or undefined before it is judged.
 */
export function stayTile(floor: { readonly tiles: readonly SafeFloor['tiles'][number][] }): FloorTileVM | undefined {
    const t = floor.tiles.find(x => x.band === 'stay');
    return t && tileVM(t, 'move');
}

/** The NPCs and cameras an effect names: who Exposes, keeps watching, adds pips, challenges or reports the crew member. */
function effectObservers(e: Effect | null, out: Set<string>): void {
    if (!e) return;
    for (const id of [...e.exposed, ...e.watching, ...Object.keys(e.pips), ...e.cameras]) out.add(id);
    if (e.challenged) out.add(e.challenged);
}

/** Who reacts to a floor tile's move: now and in the coming world phase, to the crew member or a teammate. */
function tileObservers(t: FloorTile, out: Set<string>): void {
    effectObservers(t.now, out);
    effectObservers(t.next, out);
    for (const m of t.teammates) effectObservers(m.effect, out);
}

/**
 * The observers whose cones the overlay shows: those that react to the crew member somewhere it could go. With a
 * path, anyone reacting on any of its steps (decision 46), at its end or in the world phase after, or on the stay tile;
 * without, anyone reacting on any tile of the safe floor (the stay tile among them).
 */
export function reactingObservers(floor: { readonly tiles: readonly FloorTile[] } | undefined, path?: PathSafety): string[] {
    const out = new Set<string>();
    if (path) {
        if (path.ok) {
            for (const step of path.steps) for (const x of step.sightings) out.add(x.observer);
            tileObservers(path.end, out);
        }
        const stay = floor?.tiles.find(t => t.band === 'stay');
        if (stay) tileObservers(stay, out);
    } else for (const t of floor?.tiles ?? []) tileObservers(t, out);
    return [...out];
}

/** One step of a drawn path, tinted (§8.8 "along the whole drawn path"); `doorRisk` as on `FloorTileVM`. */
export interface PathStepVM { pos: Pos; kind: TintKind; hatched: boolean; doorRisk: boolean }

/** A drawn or previewed path judged by `pathSafety`: each step's tint, the eye on the first unsafe step, the end's tile. */
export interface PathVM { steps: PathStepVM[]; eyeAt: number | null; end: FloorTileVM }

/** How a step passed reads from the sightings there (decision 46: as if the move ended there), or null for none. */
function seenKind(sightings: readonly Sighting[]): TintKind | null {
    if (!sightings.length) return null;
    if (sightings.some(x => x.by === 'npc' && (x.outcome === '!' || x.known))) return 'red';
    if (sightings.some(x => x.by === 'camera')) return 'camera';
    return sightings.some(x => x.outcome === 'T') && !sightings.some(x => x.outcome === '+1' || x.outcome === '+2') ? 'trespass' : 'amber';
}

/**
 * Each step passed is tinted by who would react to the crew member there for certain, as if the move ended there
 * (decision 46): red for a `!` or someone who knows them, a camera's `!` the camera's, a challenge the hand, pips amber;
 * else unknown risk where a door the crew can't vouch for could let someone known react (`doubted`), else what the crew
 * knows of it; the end is tinted as the safe floor tints it (the corner marker when the world phase does it). A certain warning
 * short of red that a door could make worse is `doorRisk`.
 */
export function pathView(safety: PathSafety): PathVM | undefined {
    if (!safety.ok) return undefined;
    const last = safety.steps.length - 1;
    const steps = safety.steps.map((s, i): PathStepVM => {
        if (i === last) return { pos: { ...s.pos }, kind: safety.end.tint.kind, hatched: safety.end.tint.hatched, doorRisk: safety.end.tint.doorRisk };
        const seen = seenKind(s.sightings);
        const kind: TintKind = seen ?? (s.doubted ? 'unknownRisk' : s.knowledge === 'hidden' ? 'grey' : s.knowledge === 'unknownRisk' ? 'unknownRisk' : 'safe');
        return { pos: { ...s.pos }, kind, hatched: false, doorRisk: s.doubted && kind !== 'red' };
    });
    return { steps, eyeAt: safety.firstUnsafe, end: tileVM(safety.end, safety.mode) };
}

/** "Who and why" (§8.8): a tag on a long-pressed tile, one line per observer, and their sightlines drawn on the map. */
export interface ExplainVM {
    tile: Pos;
    lines: {
        observer: string | null; by: Explanation['by']; portrait?: string; icon?: 'camera' | 'unknown'; text: string; phase: 'now' | 'next'; outcome: Explanation['outcome'];
        from: Pos | null; to: Pos;
        /** Unknown risk: where someone unknown could watch from, the worst first, and the tile each would see. */
        watchers?: { from: Pos; to: Pos }[];
    }[];
}

/** The explanation of a tile; `inFloor` says the tile is one the crew member can reach (a quiet line when nobody notices). */
export function explainView(world: ReadonlyWorld, tile: Pos, entries: readonly Explanation[], inFloor: boolean): ExplainVM | undefined {
    if (!entries.length && !inFloor) return undefined;
    const lines: ExplainVM['lines'] = entries.map(e => {
        const person = e.by === 'npc' ? world.people.find(p => p.id === e.observer) : undefined, portrait = person && rolePortrait(person.role);
        return {
            observer: e.observer, by: e.by, ...(portrait ? { portrait } : {}), ...(e.by === 'camera' ? { icon: 'camera' as const } : e.by === 'unknown' ? { icon: 'unknown' as const } : {}),
            text: e.phase === 'next' ? `Next phase: ${e.text}` : e.text, phase: e.phase, outcome: e.outcome, from: e.from ? { ...e.from } : null, to: { ...e.to },
            ...(e.watchers ? { watchers: e.watchers.map(w => ({ from: { ...w.from }, to: { ...w.to } })) } : {})
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
        // Not over hidden tiles: walls and furniture clip a cone, and would draw the hidden layout (decision 44).
        if ((t.x === m.pos.x && t.y === m.pos.y) || hiddenAt(known, t)) continue;
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

/**
 * The cameras the crew knows of (`known.cameras`); with `cones`, the tiles each watches, on the crew's picture, none
 * over hidden tiles (walls and furniture clip a cone, and would draw the hidden layout, as `npcCone`).
 */
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
            if ((t.x === def.pos.x && t.y === def.pos.y) || hiddenAt(known, t)) continue;
            (bandAt(f, t) === 'core' ? vm.core : vm.peripheral).push({ x: t.x, y: t.y });
        }
        if (def.facings.length > 1 && loopLeft === undefined) {
            vm.next = field(now.facing + 1).tiles.filter(t => (t.x !== def.pos.x || t.y !== def.pos.y) && !hiddenAt(known, t)).map(t => ({ x: t.x, y: t.y }));
        }
        return vm;
    });
}

// ---------------------------------------------------------------------------------------------------------- Takeover

/** A previewed command's two rings (§10.1, UI.md "Rings"), as the overlay draws them, and each known NPC's outcome. */
export interface RingsOverlayVM {
    /** The command ring: within the radius in line of sight (steel blue). */
    command: Pos[];
    /** The panic ring beyond it: the rest of the shout's noise (amber). */
    panic: Pos[];
    /** Over each NPC the crew knows of in either ring: what it will do, standing in for its state plate. */
    outcomes: { id: string; pos: Pos; lying: boolean; plate: PlateVM }[];
}

/** An outcome's plate: face down (with the pips it would have), a resister's chance, ignores it, panics, alerted, still. */
function outcomePlate(state: State, commandPips: number, t: CommandTarget): PlateVM {
    switch (t.outcome) {
        case 'complies': {
            const npc = state.npcs.find(n => n.id === t.npc);
            return { glyph: 'down', signal: 'command', count: Math.max(commandPips, npc?.command?.pips ?? 0) };
        }
        case 'resists': return { glyph: 'down', signal: 'amber', count: `${Math.round((t.chance ?? 0) * 100)}%` };
        case 'ignores': return { glyph: 'cross', signal: 'red' };
        case 'panics': return { glyph: 'drops', signal: 'amber' };
        case 'alerted': return { glyph: 'bang', signal: 'red' };
        default: return { glyph: 'down', signal: 'cream' };
    }
}

/**
 * The rings of `plan` (`commandPreview`: only NPCs the crew knows of, judged with the doors it can't vouch for shut) over what isn't hidden (sound and sight round a
 * hidden room would draw its layout), each known NPC's outcome where the crew knows it to stand.
 */
export function commandRings(world: ReadonlyWorld, state: State, known: KnownView, plan: CommandRings): RingsOverlayVM {
    const outcomes: RingsOverlayVM['outcomes'] = [];
    const at = (id: string, plate: PlateVM) => {
        const m = known.npcs.find(k => k.id === id);
        if (m && m.kind !== 'ghost') outcomes.push({ id, pos: { x: m.pos.x, y: m.pos.y }, lying: lying(m), plate });
    };
    for (const t of plan.targets) at(t.npc, outcomePlate(state, world.rules.commandPips, t));
    // A door the crew can't vouch for decides what these do: a `?`, never a promise.
    for (const id of plan.unsure) at(id, { glyph: 'down', signal: 'cream', sym: '?' });
    return { command: unhiddenTiles(known, plan.commandTiles), panic: unhiddenTiles(known, plan.panicTiles), outcomes };
}

/** A hold's ring (§10.3): the command ring of a crew member holding the room this turn, or of a hold previewed. */
export interface HoldRingVM { crew: string; tiles: Pos[]; preview: boolean }

/** The rings of everyone holding this turn (`CrewState.holding`), over what isn't hidden. */
export function holdRings(world: ReadonlyWorld, state: State, known: KnownView): HoldRingVM[] {
    return state.crew.filter(c => c.holding === state.turn).map(c => ({ crew: c.id, tiles: unhiddenTiles(known, commandPreview(world, state, c.id).commandTiles), preview: false }));
}
