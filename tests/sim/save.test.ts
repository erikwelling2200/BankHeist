import { describe, expect, it } from 'vitest';
import {
    appendRecent, deserialise, hashOf, RECENT_EVENTS, recordUndo, SAVE_FORMAT, serialise, type SimEvent, type State
} from '../../src/sim';
import { play, SCRIPT, smallBank, step } from './helpers';

describe('saving', () => {
    it('round-trips a world, a state, the recent events and the undo stack', () => {
        const { world, state } = smallBank();
        const mid = play(world, state, SCRIPT.slice(0, 4));
        const first = step(world, mid, SCRIPT[4]!);
        const undo = recordUndo([], mid, first.undoable);
        const loaded = deserialise(serialise({ genVersion: 'fixture', world, state: first.state, recent: first.events, undo }));
        expect(loaded.world).toEqual(world);
        expect(Object.isFrozen(loaded.world.tiles)).toBe(true);
        expect(loaded.state).toEqual(first.state);
        expect(loaded.recent).toEqual(first.events);
        expect(loaded.undo).toEqual([mid]);
        expect(loaded.genVersion).toBe('fixture');
    });

    it('keeps only the last few events for the recap', () => {
        const events: SimEvent[] = Array.from({ length: 25 }, (_, i) => ({ type: 'waited', crew: `c${i}` }));
        const recent = appendRecent(events.slice(0, 5), events.slice(5));
        expect(recent).toHaveLength(RECENT_EVENTS);
        expect(recent.at(-1)).toEqual(events.at(-1));
    });

    it('continues a reloaded heist exactly as the original', () => {
        const { world, state } = smallBank();
        const mid = play(world, state, SCRIPT.slice(0, 5));
        const loaded = deserialise(serialise({ genVersion: 'fixture', world, state: mid }));
        const original = play(world, mid, SCRIPT.slice(5)), resumed = play(loaded.world, loaded.state, SCRIPT.slice(5));
        expect(hashOf(resumed)).toBe(hashOf(original));
        expect(hashOf(original)).toBe(hashOf(play(world, state, SCRIPT)));
    });

    it('refuses a save of another format', () => {
        const { world, state } = smallBank();
        const text = serialise({ genVersion: 'fixture', world, state }).replace(`"format":${SAVE_FORMAT}`, '"format":0');
        expect(() => deserialise(text)).toThrow(`format 0, this build reads format ${SAVE_FORMAT}`);
        expect(() => deserialise('not json')).toThrow(/isn't JSON/);
        expect(() => deserialise(`{"format":${SAVE_FORMAT},"genVersion":"x"}`)).toThrow(/no world/);
    });

    it('refuses state that JSON would change', () => {
        const { world, state } = smallBank();
        const bad = (patch: Partial<State>) => () => serialise({ genVersion: 'fixture', world, state: { ...state, ...patch } });
        expect(bad({ nextId: -0 })).toThrow(/-0/);
        expect(bad({ turn: Number.NaN })).toThrow(/NaN/);
        expect(bad({ edges: { a: { blocksMove: undefined } } })).toThrow(/undefined/);
        expect(bad({ rng: new Map() as unknown as Record<string, number> })).toThrow(/Map/);
        expect(() => hashOf({ a: undefined })).toThrow(/undefined/);
    });
});

/*
 * The save's shape: every field name and type of a fully populated save, records collapsed to one entry. If this
 * changes, World, State or Save changed shape: bump SAVE_FORMAT, then record the new hash under the new format.
 * The test only sees fields its sample save fills in: a package that augments IntentActionMap, ObjectState,
 * NpcStatusMap, CarrierKindMap or adds a field must also fill it in below, or a change of shape goes unnoticed.
 */
const SHAPE_HASHES: Record<number, string> = {
    1: '560656ed11263e39',
    2: '1129e267e7efb084'
};

/** Paths whose objects are records by id, not structs. */
const RECORDS = new Set([
    'world.edges', 'world.doors', 'state.doors', 'state.edges', 'state.objects', 'state.cameras', 'state.rng',
    'state.npcs[].suspicion'
]);

/** Two shapes as one: the union of their fields, and "a|b" where a field has two types. */
function merge(a: unknown, b: unknown): unknown {
    if (a === undefined) return b;
    if (Array.isArray(a) && Array.isArray(b)) return a.length || b.length ? [merge(a[0], b[0])] : [];
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
        const ra = a as Record<string, unknown>, rb = b as Record<string, unknown>;
        return Object.fromEntries([...new Set([...Object.keys(ra), ...Object.keys(rb)])].sort().map(k => [k, merge(ra[k], rb[k])]));
    }
    if (b === undefined || JSON.stringify(a) === JSON.stringify(b)) return a;
    return [...new Set([...String(a).split('|'), ...String(b).split('|')])].sort().join('|');
}

function shapeOf(value: unknown, at: string): unknown {
    // Saved undo states have the state's shape.
    const path = at === 'undo[]' ? 'state' : at;
    const child = (k: string): string => (path ? `${path}.${k}` : k);
    if (value === null) return 'null';
    if (Array.isArray(value)) return value.length ? [value.map(v => shapeOf(v, `${path}[]`)).reduce(merge)] : [];
    if (typeof value !== 'object') return typeof value;
    const record = value as Record<string, unknown>;
    if (RECORDS.has(path)) {
        const entries = Object.values(record).map(v => shapeOf(v, child('*')));
        return entries.length ? { '*': entries.reduce(merge) } : {};
    }
    return Object.fromEntries(Object.keys(record).sort().map(k => [k, shapeOf(record[k], child(k))]));
}

describe('the save format', () => {
    it('changes number whenever the save changes shape', () => {
        const { world, state } = smallBank();
        const full: State = play(world, state, SCRIPT);
        full.npcs[0]!.suspicion = { jun: 1 };
        full.npcs[0]!.exposedTo = ['jun'];
        full.npcs[0]!.intent = { path: [{ x: 1, y: 1 }], facing: 'n' };
        full.edges['eastWest 0 1'] = { material: 'soft', blocksMove: false, blocksSight: false };
        full.objects.panel = { disabled: true, open: false };
        full.cameras.cam = { facing: 0, live: true };
        full.crew[0]!.loadout.items = ['pistol'];
        full.dice.push({ turn: 1, stream: 'combat', reason: 'hit', value: 0.5 });
        full.rng.combat = 5;
        full.carriers.push({ id: 'carrier-9', kind: 'tellerButton', source: 'teller', pos: { x: 0, y: 0 }, countdown: 2, started: { turn: 1, phase: 'world' }, halted: null });
        const save = JSON.parse(serialise({
            genVersion: 'fixture',
            world: {
                ...world,
                objects: [{ id: 'panel', kind: 'alarmPanel', pos: { x: 0, y: 0 }, facing: 's' }],
                cameras: [{ id: 'cam', pos: { x: 0, y: 0 }, facings: ['s', 'e'], room: 'lobby' }],
                people: world.people.map(p => ({ ...p, schedule: [{ from: 1, activity: 'work', room: 'lobby' }] })),
                tiles: world.tiles.map((t, i) => (i === 1 ? { ...t, climb: 'stairs' as const } : i ? t : { ...t, room: 'lobby' }))
            },
            state: full,
            recent: [{ type: 'waited', crew: 'jun' }],
            undo: [full]
        })) as Record<string, unknown>;
        const shape = shapeOf(save, '');
        const hash = hashOf(shape);
        expect(hash, `Save shape changed:\n${JSON.stringify(shape, null, 1)}`).toBe(SHAPE_HASHES[SAVE_FORMAT]);
    });
});
