import {
    bitsCount, decodeBits, encodeBits, hashOf, opportunitiesOf, stableJson, type DeepReadonly, type FoundHow, type Intel, type ReadonlyWorld
} from '../sim';
import type { SaveStorage } from './storage';

/*
 * Knowledge across days (GAME_DESIGN §17.8, implementation plan M5-03): what the crew knows of a bank before a heist
 * in it. The rules' `Intel` (src/sim/rules/knowledge.ts) is the record: the intel bought (Blueprints, Guard rota) and the
 * casing of earlier heists (the tiles seen, the routines learned, the opportunities found). Plain JSON, kept per bank in
 * the save storage under `intelKey`: the Session writes it as a heist goes on (`recordIntel`, merged into what was
 * there), the planning screen reads it (`loadIntel`) and hands it to the plan (`HeistSetup.intel`), which starts the
 * heist knowing it. Days are the campaign's (M6-01): here a bank's intel only grows.
 *
 * A record is read only for the very bank it was made in (`bankPrint`: the World as the generator built it, without the
 * plan's vehicles and intel), so a generator change that rebuilds a bank under the same address never shows yesterday's
 * layout over today's: nothing the player sees is ever wrong (§17.8).
 */

/** The storage key of a bank's intel. */
export const intelKey = (world: ReadonlyWorld): string => `intel:${bankPrint(world)}`;

const PRINTS = new WeakMap<ReadonlyWorld, string>();

/** What identifies a bank: a hash of its World but for what a plan adds (the vehicles where they wait, the intel). */
export function bankPrint(world: ReadonlyWorld): string {
    let print = PRINTS.get(world);
    if (print === undefined) {
        print = hashOf(Object.fromEntries(Object.entries(world).filter(([k]) => k !== 'vehicles' && k !== 'intel')));
        PRINTS.set(world, print);
    }
    return print;
}

const HOWS: readonly FoundHow[] = ['overheard', 'read', 'intel'];

/**
 * Why `value` isn't intel about `world`, or undefined: only the record's own fields, each of its type; the tiles a
 * tile set of this world's size, the routines its people, the opportunities its own, each once.
 */
export function intelProblem(value: unknown, world: ReadonlyWorld): string | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'not intel';
    const v = value as Record<string, unknown>;
    if (!Object.keys(v).every(k => ['blueprints', 'guardRota', 'seen', 'routines', 'opportunities'].includes(k))) return 'intel with something else in it';
    if (v.blueprints !== undefined && typeof v.blueprints !== 'boolean') return 'the blueprints are neither bought nor not';
    if (v.guardRota !== undefined && typeof v.guardRota !== 'boolean') return 'the guard rota is neither bought nor not';
    if (v.seen !== undefined) {
        if (typeof v.seen !== 'string') return "the tiles seen aren't a tile set";
        try {
            decodeBits(v.seen, world.width * world.height);
        } catch {
            return "the tiles seen aren't this bank's";
        }
    }
    const people = new Set(world.people.map(p => p.id));
    if (v.routines !== undefined && (!Array.isArray(v.routines) || !v.routines.every(id => typeof id === 'string' && people.has(id))
        || new Set(v.routines).size !== v.routines.length)) return "the routines aren't this bank's people";
    const ids = new Set(opportunitiesOf(world).map(o => o.id));
    if (v.opportunities !== undefined) {
        if (!Array.isArray(v.opportunities)) return 'the opportunities found are not a list';
        const seen = new Set<string>();
        for (const o of v.opportunities as unknown[]) {
            const r = o as Record<string, unknown> | null;
            if (typeof r !== 'object' || r === null || !Object.keys(r).every(k => k === 'id' || k === 'how') || typeof r.id !== 'string'
                || !ids.has(r.id) || seen.has(r.id) || !HOWS.includes(r.how as FoundHow)) return "an opportunity found isn't this bank's";
            seen.add(r.id);
        }
    }
    return undefined;
}

/** Whether the intel tells nothing at all. */
export const noIntel = (intel: DeepReadonly<Intel>): boolean =>
    !intel.blueprints && !intel.guardRota && !intel.routines?.length && !intel.opportunities?.length && intelTiles(intel) === 0;

/** How many tiles the intel's casing saw. */
export function intelTiles(intel: DeepReadonly<Intel>): number {
    // Any length that reads the set counts the same tiles.
    return intel.seen === undefined ? 0 : bitsCount(decodeBits(intel.seen, intel.seen.length * 6));
}

/** Two records of the same bank as one: bought once, bought; every tile, routine and opportunity of either, in order. */
export function mergeIntel(a: DeepReadonly<Intel>, b: DeepReadonly<Intel>, world: ReadonlyWorld): Intel {
    const n = world.width * world.height;
    const seen = a.seen === undefined ? b.seen : b.seen === undefined ? a.seen : (() => {
        const x = decodeBits(a.seen!, n).slice(), y = decodeBits(b.seen!, n);
        for (let i = 0; i < n; i++) if (y[i]) x[i] = 1;
        return encodeBits(x);
    })();
    const routines = [...new Set([...(a.routines ?? []), ...(b.routines ?? [])])].sort();
    const opportunities = [...(a.opportunities ?? [])].map(o => ({ id: o.id, how: o.how }));
    for (const o of b.opportunities ?? []) if (!opportunities.some(x => x.id === o.id)) opportunities.push({ id: o.id, how: o.how });
    return {
        ...(a.blueprints || b.blueprints ? { blueprints: true } : {}),
        ...(a.guardRota || b.guardRota ? { guardRota: true } : {}),
        ...(seen !== undefined ? { seen } : {}),
        ...(routines.length ? { routines } : {}),
        ...(opportunities.length ? { opportunities } : {})
    };
}

/** The intel kept for this bank, or none when there is none or it can't be read as this bank's. */
export function loadIntel(storage: SaveStorage, world: ReadonlyWorld): Intel {
    try {
        const value: unknown = JSON.parse(storage.get(intelKey(world)) ?? 'null');
        return value !== null && intelProblem(value, world) === undefined ? value as Intel : {};
    } catch {
        return {};
    }
}

/**
 * Adds what `intel` tells to what is kept for this bank (`mergeIntel`), and keeps it. Returns the stored text, or null
 * when nothing could be stored (a full quota: the heist matters more).
 */
export function recordIntel(storage: SaveStorage, world: ReadonlyWorld, intel: DeepReadonly<Intel>): string | null {
    try {
        const text = stableJson(mergeIntel(loadIntel(storage, world), intel, world));
        if (storage.get(intelKey(world)) !== text) storage.set(intelKey(world), text);
        return text;
    } catch {
        return null;
    }
}

/** What the planning screen says of a bank's intel (§17.8, M5-03). */
export interface IntelSummary {
    blueprints: boolean;
    guardRota: boolean;
    /** The rooms of the bank's building that earlier heists saw into. */
    rooms: number;
    /** The NPCs whose routine is known, in the bank's people's order. */
    routines: { id: string; name: string; role: string }[];
    /** The opportunities found, in the order found: what the journal says, and how. */
    finds: { id: string; text: string; how: FoundHow }[];
}

/** What `intel` tells of `world`, as the planning screen lists it: only what the intel itself holds. */
export function intelSummary(world: ReadonlyWorld, intel: DeepReadonly<Intel>): IntelSummary {
    const building = new Set(world.building ?? []), rooms = new Set<string>();
    if (intel.seen !== undefined) {
        const seen = decodeBits(intel.seen, world.width * world.height);
        world.tiles.forEach((t, i) => { if (seen[i] && t.room !== null && building.has(t.room)) rooms.add(t.room); });
    }
    const routines = new Set(intel.routines ?? []);
    return {
        blueprints: !!intel.blueprints,
        guardRota: !!intel.guardRota,
        rooms: rooms.size,
        routines: world.people.filter(p => routines.has(p.id)).map(p => ({ id: p.id, name: p.name, role: p.role })),
        finds: (intel.opportunities ?? []).flatMap(o => {
            const def = opportunitiesOf(world).find(d => d.id === o.id);
            return def ? [{ id: o.id, text: def.text, how: o.how }] : [];
        })
    };
}
