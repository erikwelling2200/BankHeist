import type { GlyphName } from '../art/ui/glyphs';
import {
    crewPicture, hearing, LYING_STATUSES, soundRing, npcObserver, seenTiles, bandAt, type CarrierKind, type KnownView, type NpcMarker, type Pos, type ReadonlyWorld, type SimEvent,
    type State
} from '../sim';

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
        const carrier = carriers.find(c => c.source === m.id);
        if (carrier) plates.push({ glyph: CARRIER_GLYPHS[carrier.kind] ?? 'bell', signal: 'red', count: carrier.countdown });
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
    // Carriers on objects (a sensor, a panel): their plate where they are.
    for (const c of carriers) {
        if (known.npcs.some(m => m.id === c.source) || state.npcs.some(n => n.id === c.source)) continue;
        out.push({ id: c.id, pos: c.pos, lying: true, faded: false, plates: [{ glyph: CARRIER_GLYPHS[c.kind] ?? 'bell', signal: 'red', count: c.countdown }], pips: [] });
    }
    return out;
}

const lying = (m: NpcMarker): boolean => !!m.status && LYING_STATUSES.has(m.status);

/** Someone inside a noise ring and what they will do about it (UI.md "Rings"): Curious, Investigating or Alerted. */
export interface HearerVM { id: string; pos: Pos; lying: boolean; sym?: '?' | '!'; signal: Signal; /** The one sent to look. */ sent?: boolean }

/**
 * The hearers of the noise a previewed command makes, each with the badge the sim's own `hearing` gives them (the
 * function the outcome runs), from the player's preview: its `noise` event names only hearers the crew knows of. What
 * they see of the act itself is the witnesses' plate, not this.
 */
export function noiseHearers(world: ReadonlyWorld, before: State, known: KnownView, preview: { events: readonly SimEvent[]; state: State }): HearerVM[] {
    const out: HearerVM[] = [];
    for (const e of preview.events) {
        if (e.type !== 'noise') continue;
        // Judged as the noise is made: on the bank before the command (NPCs don't move in the crew phase), with the
        // doors it opened, and only for those the noise event says heard it.
        const ring = soundRing(world, preview.state, e.sources, e.radius);
        for (const h of hearing(world, before, ring, e.kind, e.cause)) {
            const m = known.npcs.find(k => k.id === h.npc);
            if (!m || !e.heard.includes(h.npc) || out.some(o => o.id === h.npc)) continue;
            const alerted = h.status === 'alerted';
            out.push({ id: h.npc, pos: m.pos, lying: lying(m), sym: alerted ? '!' : '?', signal: alerted ? 'red' : 'amber', ...(h.sent ? { sent: true } : {}) });
        }
    }
    return out;
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
