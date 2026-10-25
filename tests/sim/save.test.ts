import { describe, expect, it } from 'vitest';
import {
    appendRecent, deserialise, deserialiseState, deserialiseWorld, hashOf, RECENT_EVENTS, recordUndo, SAVE_FORMAT, serialise,
    serialiseState, serialiseWorld, type SimEvent, type State
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

    it('saves the world once and the state after every action', () => {
        const { world, state } = smallBank();
        const first = step(world, state, SCRIPT[0]!);
        const undo = recordUndo([], state, first.undoable);
        const loaded = deserialiseWorld(serialiseWorld('fixture', world));
        expect(loaded).toEqual({ genVersion: 'fixture', world });
        const text = serialiseState({ state: first.state, recent: first.events, undo });
        expect(text).not.toContain('tiles');
        const resumed = deserialiseState(text);
        expect(resumed).toEqual({ state: first.state, recent: first.events, undo: [state] });
        expect(Object.isFrozen(resumed.state.crew)).toBe(true);
        expect(() => deserialiseState(text.replace('"nextId"', '"nextIdx"'))).toThrow(/state has no nextId/);
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
 * The save's shape: every field name and type of a fully populated save, records collapsed to one entry. It fails
 * whenever World, State or Save change shape, and prints the new hash. During development SAVE_FORMAT stays put:
 * only the integrator, merging packages, updates the hash below (and bumps SAVE_FORMAT once saves must survive an
 * update). A package never bumps SAVE_FORMAT; it reports the new hash with its change.
 * The test only sees fields its sample save fills in: a package that augments IntentActionMap, ObjectState,
 * NpcStatusMap, CarrierKindMap or adds a field must also fill it in below, or a change of shape goes unnoticed.
 */
const SHAPE_HASHES: Record<number, string> = {
    1: '1e6d9d27dadd6f11'
};

/** Paths whose objects are records by id, not structs. */
const RECORDS = new Set([
    'world.edges', 'world.doors', 'state.doors', 'state.edges', 'state.objects', 'state.cameras', 'state.rng',
    'state.cover', 'state.crew[].arms.guns', 'state.crew[].arms.throwables', 'state.npcs[].suspicion', 'state.npcs[].lastSeen', 'state.npcs[].frisked', 'state.knowledge.npcs', 'state.knowledge.doors', 'state.radio.calls'
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
        full.npcs[0]!.alerted = true;
        full.npcs[0]!.alertCause = 'exposed jun';
        full.npcs[0]!.warned = ['mara'];
        full.npcs[0]!.challenges = [{ crew: 'mara', deadline: 3 }];
        full.npcs[0]!.wants = [{ kind: 'escort', crew: 'mara', tile: { x: 1, y: 1 }, decided: { turn: 1, phase: 'world' }, until: 3 }];
        full.npcs[0]!.lastSeen = { jun: { tile: { x: 0, y: 0 }, turn: 1 } };
        full.npcs[0]!.intent = { path: [{ x: 1, y: 1 }], facing: 'n', action: { kind: 'raiseAlarm', carrier: 'tellerButton', crew: 'jun' } };
        full.npcs[0]!.goal = { kind: 'investigate', crew: 'jun', tile: { x: 1, y: 1 }, block: 0 };
        full.npcs[0]!.route = { block: 0, leg: 1, dir: -1, stalled: 0 };
        full.npcs[0]!.search = { tile: { x: 1, y: 1 }, until: 3 };
        full.npcs[0]!.frisked = { jun: 2 };
        full.npcs[0]!.reported = ['mara'];
        full.npcs[0]!.stashed = 'dumpster-0';
        full.npcs[0]!.outCold = 4;
        full.npcs[0]!.glancedFrom = 'n';
        full.npcs[0]!.noticed = ['body:guard'];
        full.npcs[0]!.command = { pips: 0, by: 'jun' };
        full.npcs[0]!.lapse = { kind: 'flee', exit: { x: 2, y: 2 } };
        full.npcs[0]!.surprised = 1;
        full.npcs[0]!.armed = 'hidden';
        full.npcs[0]!.untying = { by: 'guard', phases: 1 };
        full.npcs[0]!.stripped = true;
        full.crew[0]!.keycards = ['guard'];
        full.npcs[0]!.panic = { since: { turn: 1, phase: 'crew' }, crew: 'jun', tile: { x: 1, y: 1 }, reaction: { kind: 'hide', spot: { x: 2, y: 2 } } };
        full.crew[0]!.tackled = 2;
        full.crew[0]!.holding = 1;
        full.takeover = 1;
        full.held = ['guard'];
        full.npcs[0]!.evidence = { id: 'body:guard', kind: 'body', major: true, tile: { x: 1, y: 1 }, decided: { turn: 1, phase: 'world' } };
        full.npcs[1]!.intent = { path: [], action: { kind: 'tellEvidence', npc: 'teller', evidence: 'body:guard' } };
        full.crew[1]!.dragging = 'guard';
        full.loot = { cash: { holder: 'jun', pos: { x: 0, y: 0 }, taken: true, dyePack: true, inspected: false, ruined: false } };
        full.evidence = [{ id: 'blood-7', kind: 'blood', pos: { x: 1, y: 1 } }];
        full.barked = ['body'];
        full.cameraEvidence = [{ camera: 'cam', evidence: 'body:guard', kind: 'body', tile: { x: 1, y: 1 }, turn: 2, handled: true }];
        full.cameraReports = [{ camera: 'cam', crew: 'jun', tile: { x: 0, y: 0 }, turn: 1, phase: 'crew' }];
        full.crew[0]!.notoriety = 2;
        full.edges['eastWest 0 1'] = { material: 'soft', blocksMove: false, blocksSight: false, blocksSound: false, midHeight: false, shattered: true, hits: 2 };
        full.cover = { '2 1': 3 };
        full.crew[0]!.leaning = { at: { x: 1, y: 0 }, corner: { x: -1, y: -1 } };
        full.npcs[0]!.leaning = { at: { x: 1, y: 0 }, corner: { x: 1, y: 1 } };
        full.shots = [{
            id: 'shot-3', turn: 2, phase: 'crew', rolls: { points: [0.5], covers: [0.25] },
            shot: { shooter: 'jun', weapon: 'pistol', at: { x: 1, y: 1 }, target: 'guard', lean: { x: 1, y: 0 }, turn: 2, bullets: 1, moved: true, braced: false, aimFactor: 1.5, spread: 2 }
        }];
        full.crew[0]!.arms = {
            drawn: 'pistol', guns: { pistol: { load: 'pistol', loaded: 10, spare: 3 } }, throwables: { flashbang: 2 }, swapped: 2, moved: 2, braced: true,
            watch: { at: { x: 1, y: 1 }, arc: 60, lean: { x: 1, y: 0 }, turn: 2 }, aiming: null
        };
        full.npcs[0]!.ammo = { weapon: 'pistol', loaded: 12, spare: 2 };
        full.npcs[0]!.suppressed = { turn: 2, by: 'jun', from: { x: 1, y: 1 }, reacted: false };
        full.npcs[0]!.dazed = 3;
        full.grenades = [{ id: 'smoke-5', kind: 'smoke', by: 'jun', at: { x: 1, y: 1 }, turn: 2 }];
        full.smoke = [{ id: 'smoke-4', at: { x: 1, y: 1 }, tiles: [{ x: 1, y: 1 }], until: 3 }];
        full.flipped = [{ at: { x: 1, y: 1 }, side: 'w' }];
        full.doors.staffDoor = { status: 'open', propped: true, work: 1 };
        full.objects.panel = { disabled: true, open: false, progress: 2, codes: ['manager'], sensorsCut: true };
        full.devices = [{ id: 'drill-4', kind: 'drill', at: 'vault', pos: { x: 1, y: 1 }, crew: 'jun', done: 2, needed: 5, jammed: true, noise: 6 }];
        full.codesKnown = ['whole'];
        full.objects.recorder = { taken: 'jun', destroyed: false };
        full.cameras.cam = { facing: 0, live: true, loopedUntil: 3 };
        full.crew[0]!.loadout = { items: ['pistol', 'duffel'], packed: ['assaultRifle'], uniform: 'staff', masked: false, carrying: 'lootBag' };
        full.dice.push({ turn: 1, kind: 'chance', stream: 'combat', reason: 'hit', value: 0.5, p: 0.7 });
        full.rng.combat = 5;
        full.knowledge.rooms = ['lobby'];
        full.knowledge.cameras = ['cam'];
        full.knowledge.cctv = true;
        full.knowledge.npcs = { guard: { at: { x: 1, y: 1 }, facing: 'e', turn: 2, live: false, routine: true, rota: true, watched: 3, watchedTurn: 2, tick: 4 } };
        full.knowledge.doors = { staffDoor: 'open' };
        full.knowledge.pings = [{ at: { x: 2, y: 2 }, turn: 3, kind: 'loud', cause: 'pistol' }];
        full.carriers.push({ id: 'carrier-9', kind: 'tellerButton', source: 'teller', pos: { x: 0, y: 0 }, countdown: 2, started: { turn: 1, phase: 'world' }, halted: null, about: 'jun', subject: 'guard', line: 'landline' });
        full.crew[0]!.traits = ['steadyHands'];
        full.jammers = [{ id: 'jammer-3', pos: { x: 1, y: 1 }, crew: 'jun', turn: 2 }];
        full.footage = [{ camera: 'cam', crew: 'jun', tile: { x: 1, y: 1 }, turn: 2 }];
        full.response = { raised: 3, by: 'guardRadio', policeIn: 5, heat: 7 };
        full.heat = { owed: [{ cause: 'staffKilled', victim: 'guard' }], policeKilled: 1, releases: [4] };
        full.police = {
            units: [{ id: 'police-5', kind: 'swat', vehicle: 'van-4', staging: 'street-west', arrived: 4, pos: null }, { id: 'police-6', kind: 'patrol', vehicle: null, staging: null, arrived: 3, pos: { x: 1, y: 1 } }],
            vehicles: [
                { id: 'van-4', kind: 'van', label: 'SWAT van', staging: 'street-west', pos: { x: 0, y: 2 }, arrived: 4, status: 'arriving' },
                { id: 'helicopter-7', kind: 'helicopter', label: 'Helicopter', staging: null, pos: { x: 4, y: 1 }, arrived: 5, status: 'parked' }
            ],
            mode: { kind: 'negotiate', left: 2, since: { turn: 4, phase: 'world' }, after: 'contain' }, sent: 2, refills: 0, secured: ['cash']
        };
        full.radio = { calls: { guard: { next: 6, missed: 1, ringing: 4 } }, answers: 1, silentSince: 2, driveBy: 12, heard: 5 };
        const save = JSON.parse(serialise({
            genVersion: 'fixture',
            world: {
                ...world,
                intel: { blueprints: true, guardRota: true },
                patrol: { lane: [{ x: 0, y: 2 }, { x: 1, y: 2 }], turns: [5, 15] },
                stashRooms: ['closet'],
                staging: [{ id: 'street-west', name: 'Main street, west end', pos: { x: 0, y: 2 } }],
                building: ['lobby'],
                locks: [{
                    id: 'vault', name: 'Vault', target: 'd', room: 'lobby', holders: ['guard'], timeLock: { from: 3, until: 5 },
                    social: { kind: 'code', parts: ['whole'], text: 'code' }, technical: { kind: 'drill', phases: 3, noise: 6, sensors: ['seismic'], text: 'drill' },
                    violent: { kind: 'thermite', phases: 3, noise: 6, text: 'thermite' }
                }],
                objects: [
                    { id: 'panel', kind: 'alarmPanel', pos: { x: 0, y: 0 }, facing: 's' },
                    { id: 'desk', kind: 'cctvDesk', pos: { x: 0, y: 0 }, facing: 's', name: 'CCTV desk', room: 'lobby', monitors: 4 },
                    { id: 'cash', kind: 'loot', pos: { x: 0, y: 0 }, facing: 's', loot: { value: 5000, weight: 'light', dyePack: true, behind: 'depositBox' } }
                ],
                cameras: [{ id: 'cam', pos: { x: 0, y: 0 }, facings: ['s', 'e'], room: 'lobby', seesInDark: true }],
                people: world.people.map(p => ({
                    ...p,
                    armed: 'hidden' as const,
                    keycard: true,
                    hero: true as const,
                    schedule: [
                        { from: 3, setOff: 1, activity: 'post' as const, label: 'at post', room: 'lobby', at: { x: 0, y: 0 }, facing: 's' as const },
                        { from: 2, activity: 'patrol' as const, label: 'patrol', room: '', route: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }
                    ]
                })),
                tiles: world.tiles.map((t, i) => (i === 1 ? { ...t, climb: { kind: 'stairs' as const, to: 'n' as const } } : i ? t : { ...t, room: 'lobby', midHeight: true, coverHp: 6, flipHp: 6 })),
                edges: Object.fromEntries(Object.entries({
                    ...world.edges,
                    'eastWest 9 9': { run: 'eastWest', tx: 9, ty: 9, material: 'boundary', blocksSight: false, blocksMove: true, halfCover: true, door: 'd', shattered: false, hits: 0 }
                } as typeof world.edges).map(([k, e]) => [k, { ...e, blocksSound: false, midHeight: false }]))
            },
            state: full,
            recent: [{ type: 'waited', crew: 'jun' }],
            undo: [full]
        })) as Record<string, unknown>;
        const shape = shapeOf(save, '');
        const hash = hashOf(shape);
        expect(hash, `Save shape changed, its hash is now '${hash}':\n${JSON.stringify(shape, null, 1)}`).toBe(SHAPE_HASHES[SAVE_FORMAT]);
    });
});
