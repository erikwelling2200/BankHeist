import { FACING_STEP } from '../core/grid';
import { registerRuleDefaults } from '../core/state';
import type { CameraDef, CrewState, DeepReadonly, Facing, NpcState, NpcStatus, Pos, ReadonlyWorld, Rules, State } from '../core/types';
import { lineOfSight, sightMap, type SightMap } from './los';

/*
 * Who sees which tile, and how well (GAME_DESIGN §8.3, §8.7 on edge, §8.15; implementation plan §2.3, §6 decisions 3
 * and 5). Perception, the safe-floor overlay and the crew's knowledge all ask these functions, so they agree.
 *
 * A tile is seen when it lies in one of the observer's arcs and the line of sight to it is clear (`los.ts`):
 *
 * - **Range** is Euclidean between tile middles, `dx² + dy² ≤ R²` in integers (decision 3). **Darkness** halves it,
 *   rounded down (6 → 3, 7 → 3): a tile that isn't lit is seen only within half of each arc's range. What counts is
 *   whether the *seen* tile is lit, so a guard in a dark room still sees the lit lobby, but nobody sees far into the
 *   dark.
 * - **Cameras in the dark.** Only cameras built to see in the dark (`CameraDef.seesInDark`: Regional HQ tier and up,
 *   set by the world builder from the tier, §8.3) see an unlit tile, at half range like anyone; the rest are blind on
 *   it.
 * - **Arcs** are centred on one of the eight facings and measured by their half-angle: a tile is inside when the angle
 *   between the facing and the direction to it is at most the half-angle. The test is integer (decision 5): with f the
 *   facing's step and d the offset, `|f × d| ≤ tan(half) · (f · d)` and `f · d > 0`; tan 45° is exactly 1, and tan 35°
 *   and tan 70° are irrational, so no tile ever lies exactly on those edges and the rational thresholds below decide
 *   every tile the same way as the true angle (a test checks every offset out to 40 tiles against `Math.atan2`).
 *   **Boundary rule:** a tile exactly on an arc's edge is inside. That only happens at 45° (the Core arc's edges and
 *   the diagonals of an axis facing, such as (3, 3) for an NPC facing east) and at 180°. The observer's own tile is
 *   always seen, in its best band.
 * - **Bands.** A profile is a list of arcs, each Core or Peripheral; a tile gets the best band of any arc that holds
 *   it. Alerted NPCs list their Peripheral arc as Core (§8.7).
 *
 * For many questions in one evaluation (perception over a path, the safe-floor overlay, the crew's knowledge), take
 * `sightMap(world, state)` once and ask `seesOn` and `fieldOn`; `sees` and `seenTiles` are the one-off forms.
 */

declare module '../core/types' {
    interface Rules {
        /** How far crew members see, all round (§8.15). */
        crewRange: number;
        /** How much further Alerted NPCs see, in both arcs (§8.7: Core 8, Peripheral 10). */
        alertedRangeBonus: number;
    }
    interface CameraDef {
        /** It sees in the dark (Regional HQ tier and up, §8.3), at half range; otherwise it is blind on unlit tiles. */
        seesInDark?: boolean;
    }
}

registerRuleDefaults({ crewRange: 10, alertedRangeBonus: 2 });

/** How well a tile is seen. */
export type Band = 'core' | 'peripheral';

/** The half-angles in use, in degrees: cameras 35 (a 70° arc), Core 45 (90°), Peripheral 70 (140°), all round 180. */
export type HalfAngle = 35 | 45 | 70 | 180;

export interface Arc { band: Band; range: number; half: HalfAngle }

export interface VisionProfile {
    /** Names the profile in debug output: 'calm', 'alerted', 'camera', 'crew'. */
    name: string;
    arcs: readonly Arc[];
    /** Sees nothing on an unlit tile (cameras without `seesInDark`); otherwise darkness halves its ranges. */
    blindInDark: boolean;
}

/**
 * tan(half) as a fraction [numerator, denominator], or null for 180° (everything). 35° and 70° are rounded down at the
 * ninth decimal; no ratio |cross| / dot of tiles within 40 of each other falls between the fraction and the true tangent.
 */
export const ARC_TAN: Readonly<Record<HalfAngle, readonly [number, number] | null>> = {
    35: [700207538, 1_000_000_000],
    45: [1, 1],
    70: [2747477419, 1_000_000_000],
    180: null
};

/** NPC states that see nothing. */
export const BLIND_STATUSES: readonly NpcStatus[] = ['unconscious', 'dead'];

/**
 * NPC states that see on edge: further, and Peripheral as Core (§8.7). A stopgap until M1-05 makes Alerted a flag of
 * its own (a commanded guard stays Alerted); `npcObserver` takes that flag when it exists.
 */
export const ALERTED_STATUSES: readonly NpcStatus[] = ['alerted', 'hostile'];

export interface VisionProfiles { calm: VisionProfile; alerted: VisionProfile; camera: VisionProfile; darkCamera: VisionProfile; crew: VisionProfile }

/** The vision profiles of §8.3, §8.7 and §8.15 from a bank's rules. */
export function visionProfiles(rules: DeepReadonly<Rules>): VisionProfiles {
    const bonus = rules.alertedRangeBonus;
    const camera: Arc[] = [{ band: 'core', range: rules.cameraRange, half: 35 }];
    return {
        calm: { name: 'calm', blindInDark: false, arcs: [{ band: 'core', range: rules.coreRange, half: 45 }, { band: 'peripheral', range: rules.peripheralRange, half: 70 }] },
        alerted: { name: 'alerted', blindInDark: false, arcs: [{ band: 'core', range: rules.coreRange + bonus, half: 45 }, { band: 'core', range: rules.peripheralRange + bonus, half: 70 }] },
        camera: { name: 'camera', blindInDark: true, arcs: camera },
        darkCamera: { name: 'darkCamera', blindInDark: false, arcs: camera },
        crew: { name: 'crew', blindInDark: false, arcs: [{ band: 'core', range: rules.crewRange, half: 180 }] }
    };
}

/** Someone or something that looks: where from, which way, and with what eyes. */
export interface Observer {
    pos: Pos;
    facing: Facing;
    profile: VisionProfile;
}

/** Whether the offset (dx, dy) lies within `half` degrees of `facing` (see the header for the rule). (0, 0) always does. */
export function inArc(facing: Facing, dx: number, dy: number, half: HalfAngle): boolean {
    if (!dx && !dy) return true;
    const tan = ARC_TAN[half];
    if (!tan) return true;
    const f = FACING_STEP[facing], dot = f.x * dx + f.y * dy;
    if (dot <= 0) return false;
    return Math.abs(f.x * dy - f.y * dx) * tan[1] <= tan[0] * dot;
}

/** The range an arc reaches to on a tile: halved, rounded down, when it isn't lit. */
export const rangeOn = (range: number, lit: boolean): number => (lit ? range : Math.floor(range / 2));

/** The best band of `profile`'s arcs that holds the offset (dx, dy) on a tile lit or not, ignoring walls. */
export function bandOf(profile: VisionProfile, facing: Facing, dx: number, dy: number, lit: boolean): Band | null {
    if (!lit && profile.blindInDark) return null;
    let best: Band | null = null;
    for (const arc of profile.arcs) {
        const r = rangeOn(arc.range, lit);
        if (dx * dx + dy * dy > r * r || !inArc(facing, dx, dy, arc.half)) continue;
        if (arc.band === 'core') return 'core';
        best = 'peripheral';
    }
    return best;
}

// ---------------------------------------------------------------------------------------------------------- Observers

const profilesByWorld = new WeakMap<ReadonlyWorld, VisionProfiles>();

/** The world's vision profiles, built once per world. */
export function profilesOf(world: ReadonlyWorld): VisionProfiles {
    let p = profilesByWorld.get(world);
    if (!p) profilesByWorld.set(world, p = visionProfiles(world.rules));
    return p;
}

/**
 * An NPC as an observer, or null while it sees nothing (out cold, dead). Commanded and tied NPCs still see; whether
 * what they see counts (eyes down, §8.7) is for perception to decide.
 */
export function npcObserver(world: ReadonlyWorld, npc: DeepReadonly<NpcState>): Observer | null {
    if (BLIND_STATUSES.includes(npc.status)) return null;
    const p = profilesOf(world);
    return { pos: npc.pos, facing: npc.facing, profile: ALERTED_STATUSES.includes(npc.status) ? p.alerted : p.calm };
}

/**
 * A camera as an observer, or null when it is dead or looped (not live). `next` gives the facing it pans to in the
 * coming world phase, which is telegraphed (§8.3).
 */
export function cameraObserver(world: ReadonlyWorld, state: State, id: string, next = false): Observer | null {
    const def: DeepReadonly<CameraDef> | undefined = world.cameras.find(c => c.id === id);
    const now = state.cameras[id];
    if (!def || !now || !now.live) return null;
    const facing = def.facings[(now.facing + (next ? 1 : 0)) % def.facings.length]!;
    const p = profilesOf(world);
    return { pos: def.pos, facing, profile: def.seesInDark ? p.darkCamera : p.camera };
}

/** A crew member as an observer: all round, 10 tiles (§8.15). */
export function crewObserver(world: ReadonlyWorld, crew: DeepReadonly<CrewState>): Observer {
    return { pos: crew.pos, facing: crew.facing, profile: profilesOf(world).crew };
}

// ---------------------------------------------------------------------------------------------------------- Seeing

const isLit = (m: SightMap, p: Pos): boolean => m.lit[p.y * m.width + p.x] === 1;

/** How well the observer sees one tile on a sight map: its band, or null when it doesn't. */
export function seesOn(m: SightMap, observer: Observer, tile: Pos): Band | null {
    if (tile.x < 0 || tile.y < 0 || tile.x >= m.width || tile.y >= m.height) return null;
    const { pos } = observer;
    const band = bandOf(observer.profile, observer.facing, tile.x - pos.x, tile.y - pos.y, isLit(m, tile));
    return band && lineOfSight(m, pos, tile) ? band : null;
}

/** How well the observer sees one tile now: 'core', 'peripheral', or null when it doesn't (out of its arcs, or blocked). */
export function sees(world: ReadonlyWorld, state: State, observer: Observer, tile: Pos): Band | null {
    return seesOn(sightMap(world, state), observer, tile);
}

/** Everything an observer sees. Frozen: it is shared by everyone who asks. Read bands with `bandAt`. */
export interface SightField {
    readonly width: number;
    readonly height: number;
    /** The seen tiles, row by row from the north-west. */
    readonly tiles: readonly Readonly<Pos>[];
}

/** Each field's bands per tile, row-major: 0 unseen, 1 Core, 2 Peripheral. Kept out of the field so nobody can write them. */
const BANDS = new WeakMap<SightField, Uint8Array>();

/** The band of a tile in a field. */
export function bandAt(field: SightField, p: Pos): Band | null {
    if (p.x < 0 || p.y < 0 || p.x >= field.width || p.y >= field.height) return null;
    const b = BANDS.get(field)![p.y * field.width + p.x];
    return b === 1 ? 'core' : b === 2 ? 'peripheral' : null;
}

/**
 * Fields already worked out, per sight map, per profile (by identity), by position and facing. Dropped wholesale when
 * full: the content never depends on it.
 */
const FIELDS = new WeakMap<SightMap, WeakMap<VisionProfile, Map<string, SightField>>>();
const MAX_FIELDS = 1024;

/** Every tile the observer sees on a sight map, worked out once per map and observer. */
export function fieldOn(m: SightMap, observer: Observer): SightField {
    const { pos, facing, profile } = observer;
    let byProfile = FIELDS.get(m);
    if (!byProfile) FIELDS.set(m, byProfile = new WeakMap());
    let cache = byProfile.get(profile);
    if (!cache) byProfile.set(profile, cache = new Map());
    const key = `${pos.x} ${pos.y} ${facing}`;
    const known = cache.get(key);
    if (known) return known;
    const bands = new Uint8Array(m.width * m.height), tiles: Pos[] = [];
    const reach = Math.max(0, ...profile.arcs.map(a => a.range));
    for (let y = Math.max(0, pos.y - reach); y <= Math.min(m.height - 1, pos.y + reach); y++) {
        for (let x = Math.max(0, pos.x - reach); x <= Math.min(m.width - 1, pos.x + reach); x++) {
            const band = seesOn(m, observer, { x, y });
            if (!band) continue;
            bands[y * m.width + x] = band === 'core' ? 1 : 2;
            tiles.push(Object.freeze({ x, y }));
        }
    }
    const field: SightField = Object.freeze({ width: m.width, height: m.height, tiles: Object.freeze(tiles) });
    BANDS.set(field, bands);
    if (cache.size >= MAX_FIELDS) cache.clear();
    cache.set(key, field);
    return field;
}

/** Every tile the observer sees now, with its band; for many observers in one evaluation use `sightMap` and `fieldOn`. */
export function seenTiles(world: ReadonlyWorld, state: State, observer: Observer): SightField {
    return fieldOn(sightMap(world, state), observer);
}
