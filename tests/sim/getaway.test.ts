import { describe, expect, it } from 'vitest';
import {
    arrestCrew, bagsSecured, clonePlain, inReach, previewCertain, projectPreviewEvents, tackleTarget, doorTiles, driveMap, drivePath, drivePlan, driveReach, footprint, hashOf, HEADINGS, initialState, MANOEUVRES, manoeuvre, poseKey, preview,
    throwTargets, tileAt, vehicleAt, vehicleReach, whyNot, fixtureWorld, type Command, type PersonDef, type Pos, type Pose, type ReadonlyWorld, type SimEvent,
    type State, type VehicleDef, type WorldObject
} from '../../src/sim';
import { newHeist } from '../../src/game/heist';
import { cachedBank } from '../bankCache';
import { scouted, step } from './helpers';

/*
 * M3-08: the crew's van (§14.4), boarding, the hold, driving with turning curves, leaving the plot and the outcome
 * (§15.4, §15.5). The accept test: the swept path a preview shows is the path the commit drives.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const VAN = { width: 2, length: 4 };
const van = (start: Pose): VehicleDef => ({ id: 'van', type: 'van', name: 'Crew van', ...VAN, start });
const of = <K extends SimEvent['type']>(events: readonly SimEvent[], type: K) => events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
const bag = (id: string, pos: Pos, weight: 'heavy' | 'light' = 'heavy', value = 40000): WorldObject => ({ id, kind: 'loot', pos, facing: 's', loot: { value, weight } });

/** A street 24 tiles wide and 9 deep, all drivable, the van facing west at (10, 3); `walls` across it where asked. */
function street(options: { people?: PersonDef[]; objects?: WorldObject[]; target?: number; crew?: { id: string; pos: Pos; traits?: string[] }[]; map?: string[] } = {}): { world: ReadonlyWorld; state: State } {
    const map = options.map ?? Array.from({ length: 9 }, () => '.'.repeat(24));
    const world = fixtureWorld(map, {
        drivable: true, vehicles: [van({ x: 10, y: 3, heading: 'w' })], people: options.people ?? [], objects: options.objects ?? [],
        rules: { contractTarget: options.target ?? 50000 }
    });
    const crew = (options.crew ?? [{ id: 'mara', pos: P(11, 2) }, { id: 'jun', pos: P(14, 6) }]).map(c => ({ id: c.id, name: c.id, pos: c.pos, ...(c.traits ? { traits: c.traits } : {}) }));
    return { world, state: scouted(world, initialState(world, { seed: 3, crew })) };
}

/** Plays commands, each checked against its preview: the same events and the same state. */
function run(world: ReadonlyWorld, state: State, ...cmds: Command[]): { state: State; events: SimEvent[] } {
    const events: SimEvent[] = [];
    for (const cmd of cmds) {
        const seen = preview(world, state, cmd);
        const done = step(world, state, cmd);
        expect(seen.events).toEqual(done.events);
        expect(hashOf(seen.state)).toBe(hashOf(done.state));
        events.push(...done.events);
        state = done.state;
    }
    return { state, events };
}

describe('a vehicle on the grid', () => {
    it('stands on its 2×4 footprint, with its sliding door on its right and its rear doors behind', () => {
        const pose: Pose = { x: 10, y: 3, heading: 'w' };
        expect(footprint(VAN, pose)).toEqual([P(10, 3), P(11, 3), P(12, 3), P(13, 3), P(10, 4), P(11, 4), P(12, 4), P(13, 4)]);
        // Facing west its right is north; its rear is east.
        expect(doorTiles(VAN, pose)).toEqual([P(11, 2), P(12, 2), P(14, 4), P(14, 3)]);
        expect(doorTiles(VAN, { x: 5, y: 5, heading: 'n' })).toEqual([P(7, 6), P(7, 7), P(5, 9), P(6, 9)]);
    });

    it('blocks movement and sight where it stands now, not where it was built', () => {
        const { world, state } = street();
        expect(vehicleAt(world, state, P(12, 4))).toBe('van');
        expect(vehicleAt(world, state, P(14, 4))).toBeUndefined();
        expect(tileAt(world, P(12, 4))!.blocksMove).toBe(false);
        const moved = clonePlain(state);
        moved.vehicles.van!.pose = { x: 2, y: 3, heading: 'w' };
        expect(vehicleAt(world, moved, P(12, 4))).toBeUndefined();
        expect(vehicleAt(world, moved, P(2, 4))).toBe('van');
    });

    it('turns as a real curve: a quarter right from north ends up and to the right facing east, a half turn beside it facing south', () => {
        const north: Pose = { x: 5, y: 5, heading: 'n' };
        const quarter = manoeuvre(VAN, north, 'turnRight');
        expect(quarter.end).toEqual({ x: 6, y: 4, heading: 'e' });
        expect(quarter.cost).toBe(3);
        const half = manoeuvre(VAN, quarter.end, 'turnRight');
        expect(half.end).toEqual({ x: 9, y: 5, heading: 's' });
        expect(manoeuvre(VAN, north, 'turnLeft').end).toEqual({ x: 2, y: 4, heading: 'w' });
        // The sweep covers both footprints and the curve between, not the far corner the curve never reaches.
        const swept = new Set(quarter.tiles.map(t => `${t.x},${t.y}`));
        for (const t of [...footprint(VAN, north), ...footprint(VAN, quarter.end)]) expect(swept.has(`${t.x},${t.y}`)).toBe(true);
        expect(swept.has('9,8')).toBe(false);
    });

    it('turns in reverse as worked out by hand: a north-facing van backing its tail right ends down and to the right, facing west', () => {
        // Its middle (11, 12) moves 2 back (south) and 2 right (east) to (13, 14); its nose ends pointing west.
        const back = manoeuvre(VAN, { x: 10, y: 10, heading: 'n' }, 'reverseRight');
        expect(back.end).toEqual({ x: 11, y: 13, heading: 'w' });
        const swept = new Set(back.tiles.map(t => `${t.x},${t.y}`));
        for (const t of [...footprint(VAN, { x: 10, y: 10, heading: 'n' }), ...footprint(VAN, back.end)]) expect(swept.has(`${t.x},${t.y}`)).toBe(true);
        // Nothing ahead of the nose, nor beyond the curve (the nose swings out left as the tail goes right).
        for (const t of ['10,9', '11,9', '15,10', '8,12']) expect(swept.has(t)).toBe(false);
        expect(manoeuvre(VAN, { x: 10, y: 10, heading: 'n' }, 'reverseLeft').end).toEqual({ x: 7, y: 13, heading: 'e' });
    });

    it('sweeps the tiles a body turning on the curve covers, by an independent floating-point sampling', () => {
        // The van's body at every 0.25° of a quarter turn right from north at (0, 0), 64 points a tile, in floats.
        const W = 2, L = 4, R = 2, px = W / 2 + R, py = L / 2, hit = new Set<string>();
        for (let k = 0; k <= 360; k++) {
            const a = (k / 360) * (Math.PI / 2), c = Math.cos(a), sn = Math.sin(a), mx = px - R * c, my = py - R * sn;
            for (let ty = -6; ty <= 8; ty++) for (let tx = -6; tx <= 8; tx++) {
                if (hit.has(`${tx},${ty}`)) continue;
                for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
                    const dx = tx + (i + 0.5) / 8 - mx, dy = ty + (j + 0.5) / 8 - my;
                    if (Math.abs(dx * sn - dy * c) < L / 2 && Math.abs(dx * c + dy * sn) < W / 2) hit.add(`${tx},${ty}`);
                }
            }
        }
        const swept = new Set(manoeuvre(VAN, { x: 0, y: 0, heading: 'n' }, 'turnRight').tiles.map(t => `${t.x},${t.y}`));
        expect([...hit].filter(t => !swept.has(t))).toEqual([]);
        expect([...swept].filter(t => !hit.has(t))).toEqual([]);
    });

    it('drifts 1 tile across for 2 along, for 2 tiles of path', () => {
        const d = manoeuvre(VAN, { x: 10, y: 3, heading: 'w' }, 'driftRight');
        expect(d.end).toEqual({ x: 8, y: 2, heading: 'w' });
        expect(d.cost).toBe(2);
    });
});

describe('boarding and the hold', () => {
    it('gets in from a door tile for 1 action, the bag in hand into the hold, and takes the driver\'s seat', () => {
        const { world, state } = street({ objects: [bag('cash', P(11, 2))] });
        let s = run(world, state, { type: 'takeLoot', crew: 'mara', loot: 'cash' }).state;
        expect(whyNot(world, s, { type: 'board', crew: 'jun', vehicle: 'van' })).toMatch(/isn't at a door/);
        const done = run(world, s, { type: 'board', crew: 'mara', vehicle: 'van' });
        s = done.state;
        expect(of(done.events, 'stowed')).toEqual([{ type: 'stowed', crew: 'mara', vehicle: 'van', loot: 'cash' }]);
        expect(of(done.events, 'boarded')[0]).toMatchObject({ crew: 'mara', driver: true });
        const mara = s.crew.find(c => c.id === 'mara')!;
        expect(mara.aboard).toBe('van');
        expect(mara.actionsLeft).toBe(0);
        expect(mara.loadout.carrying).toBeNull();
        expect(s.loot.cash!.holder).toBe('van');
        expect(s.vehicles.van!.hold).toEqual(['cash']);
        expect(s.vehicles.van!.driver).toBe('mara');
        // A bag in the van is secured (§13.3 greed).
        expect(bagsSecured(world, s)).toBe(1);
    });

    it('acts only through the vehicle while aboard, and gets out onto a free door tile', () => {
        const { world, state } = street();
        let s = run(world, state, { type: 'board', crew: 'mara', vehicle: 'van' }, { type: 'endTurn' }).state;
        expect(whyNot(world, s, { type: 'wait', crew: 'mara' })).toMatch(/in a vehicle/);
        expect(() => preview(world, s, { type: 'getOut', crew: 'mara', to: P(9, 3) })).toThrow(/can't get out there/);
        const out = run(world, s, { type: 'getOut', crew: 'mara', to: P(14, 3) });
        s = out.state;
        expect(s.crew.find(c => c.id === 'mara')).toMatchObject({ aboard: null, pos: P(14, 3), actionsLeft: 1 });
        expect(of(out.events, 'driverChanged')).toEqual([{ type: 'driverChanged', vehicle: 'van', driver: null }]);
    });

    it('stows a bag from a door tile without getting in', () => {
        const { world, state } = street({ objects: [bag('cash', P(14, 4))], crew: [{ id: 'jun', pos: P(14, 4) }] });
        const held = run(world, state, { type: 'takeLoot', crew: 'jun', loot: 'cash' }).state;
        // Nothing is thrown onto it: a bag goes in through a door.
        expect(throwTargets(world, held, 'jun').some(t => vehicleAt(world, held, t) !== undefined)).toBe(false);
        const s = run(world, held, { type: 'stow', crew: 'jun', vehicle: 'van' }).state;
        expect(s.loot.cash!.holder).toBe('van');
        expect(s.crew[0]!.aboard).toBeNull();
    });
});

describe('driving', () => {
    it('reaches poses within 8 tiles of path (a Wheelman 16), and the swept path a preview shows is the one the commit drives', () => {
        const { world, state } = street({ people: [{ id: 'walker', name: 'walker', role: 'customer', observer: 'civilian', pos: P(5, 4), facing: 's', schedule: [] }] });
        const s = run(world, state, { type: 'board', crew: 'mara', vehicle: 'van' }, { type: 'endTurn' }).state;
        const reach = vehicleReach(world, s, 'van')!;
        expect(reach.budget).toBe(8);
        const poses = [...reach.nodes.values()].filter(n => n.parent !== null);
        expect(poses.length).toBeGreaterThan(50);
        expect(new Set(poses.map(n => n.pose.heading))).toEqual(new Set(HEADINGS));
        let checked = 0;
        for (const node of poses) {
            const cmd = { type: 'drive' as const, crew: 'mara', vehicle: 'van', to: node.pose };
            const plan = drivePath(reach, node.pose)!;
            // Nobody is driven over: the walker's tile is never swept.
            expect(plan.swept.some(t => t.x === 5 && t.y === 4)).toBe(false);
            if (checked++ % 23) continue;
            expect(drivePlan(world, s, cmd)).toEqual(plan);
            const seen = preview(world, s, cmd), done = step(world, s, cmd);
            const shown = of(seen.events, 'driven')[0]!, driven = of(done.events, 'driven')[0]!;
            expect(shown.swept).toEqual(plan.swept);
            expect(driven.swept).toEqual(shown.swept);
            // Independently of the reach: the path is a chain of manoeuvres, its sweep their union, every tile of it
            // drivable and empty, and no wall between two of them.
            let at: Pose = { ...s.vehicles.van!.pose };
            const union = new Set<string>();
            for (const next of driven.path) {
                const m = MANOEUVRES.find(k => poseKey(manoeuvre(VAN, at, k).end) === poseKey(next));
                expect(m, `a manoeuvre from ${poseKey(at)} to ${poseKey(next)}`).toBeDefined();
                for (const t of manoeuvre(VAN, at, m!).tiles) union.add(`${t.x},${t.y}`);
                at = next;
            }
            expect(driven.swept.map(t => `${t.x},${t.y}`).sort()).toEqual([...union].sort());
            for (const t of driven.swept) {
                if (t.x < 0 || t.x >= world.width) continue;
                expect(tileAt(world, t)!.drivable).toBe(true);
                expect(s.npcs.some(n => n.pos.x === t.x && n.pos.y === t.y) || s.crew.some(c => !c.aboard && c.pos.x === t.x && c.pos.y === t.y)).toBe(false);
            }
            expect(driven.path).toEqual(plan.poses);
            expect(done.state.vehicles.van!.pose).toEqual(node.pose);
            expect(hashOf(seen.state)).toBe(hashOf(done.state));
            // Mara rides along on the footprint.
            if (!driven.off) expect(vehicleAt(world, done.state, done.state.crew.find(c => c.id === 'mara')!.pos)).toBe('van');
        }
        const wheel = street({ crew: [{ id: 'mara', pos: P(11, 2), traits: ['wheelman'] }] });
        const ws = run(wheel.world, wheel.state, { type: 'board', crew: 'mara', vehicle: 'van' }, { type: 'endTurn' }).state;
        expect(vehicleReach(wheel.world, ws, 'van')!.budget).toBe(16);
    });

    it('goes no further than its path allows and never through a wall', () => {
        // A wall across the street west of the van, with a gap too narrow for it.
        const walls = Array.from({ length: 9 }, (_, y) => y).filter(y => y !== 4).map(y => ({ between: [P(6, y), P(7, y)] as [Pos, Pos] }));
        const world = fixtureWorld(Array.from({ length: 9 }, () => '.'.repeat(24)), { drivable: true, vehicles: [van({ x: 10, y: 3, heading: 'w' })], walls });
        const state = scouted(world, initialState(world, { seed: 3, crew: [{ id: 'mara', pos: P(11, 2) }] }));
        const s = run(world, state, { type: 'board', crew: 'mara', vehicle: 'van' }, { type: 'endTurn' }).state;
        const reach = vehicleReach(world, s, 'van')!;
        for (const node of reach.nodes.values()) for (const t of footprint(VAN, node.pose)) expect(t.x).toBeGreaterThanOrEqual(7);
        expect(drivePlan(world, s, { crew: 'mara', vehicle: 'van', to: { x: 2, y: 3, heading: 'w' } })).toMatch(/can't get there/);
    });

    it('refuses anyone but the driver, a pose out of reach and the pose it is in', () => {
        const { world, state } = street();
        const s = run(world, state, { type: 'board', crew: 'mara', vehicle: 'van' }, { type: 'endTurn' }).state;
        expect(drivePlan(world, s, { crew: 'jun', vehicle: 'van', to: { x: 9, y: 3, heading: 'w' } })).toMatch(/driver's seat/);
        expect(drivePlan(world, s, { crew: 'mara', vehicle: 'van', to: { x: 10, y: 3, heading: 'w' } })).toMatch(/there already/);
        expect(drivePlan(world, s, { crew: 'mara', vehicle: 'van', to: { x: 0, y: 3, heading: 'w' } })).toMatch(/can't get there/);
        expect(typeof drivePlan(world, s, { crew: 'mara', vehicle: 'van', to: { x: 9, y: 3, heading: 'w' } })).toBe('object');
    });

    it('finds every pose by the same rule as the manoeuvres it is made of', () => {
        const all = driveReach(VAN, { x: 20, y: 20, heading: 'n' }, 8, { tile: () => 'clear', wall: () => false });
        for (const node of all.nodes.values()) {
            if (!node.parent) continue;
            const parent = all.nodes.get(node.parent)!;
            expect(poseKey(manoeuvre(VAN, parent.pose, node.via!).end)).toBe(poseKey(node.pose));
            expect(node.cost).toBe(parent.cost + manoeuvre(VAN, parent.pose, node.via!).cost);
        }
        expect(MANOEUVRES).toHaveLength(10);
    });
});

describe('the seat and the doors (decisions 174, 191)', () => {
    /** Both aboard, Mara at the wheel. */
    function bothAboard(): { world: ReadonlyWorld; state: State } {
        const { world, state } = street({ crew: [{ id: 'mara', pos: P(11, 2) }, { id: 'jun', pos: P(12, 2) }] });
        return { world, state: run(world, state, { type: 'board', crew: 'mara', vehicle: 'van' }, { type: 'board', crew: 'jun', vehicle: 'van' }, { type: 'endTurn' }).state };
    }

    it('passes the wheel on when its driver goes down, dies or is taken, and lets anyone getting in take a free one', () => {
        const { world, state } = bothAboard();
        expect(state.vehicles.van!.driver).toBe('mara');
        const down = clonePlain(state);
        down.crew[0]!.wounds = { ...down.crew[0]!.wounds, hp: 0, downed: { left: 3, turn: 1, phase: 'crew' } };
        const after = run(world, down, { type: 'endTurn' });
        expect(after.state.vehicles.van!.driver).toBe('jun');
        expect(of(after.events, 'driverChanged')).toEqual([{ type: 'driverChanged', vehicle: 'van', driver: 'jun' }]);
        expect(vehicleReach(world, after.state, 'van')).not.toBeNull();
        // Taken from the seat (an arrest forgets them): the seat is free, nothing crashes.
        const taken = clonePlain(state);
        arrestCrew({ world, state: taken, dice: undefined as never, emit: () => {} }, 'mara', 'police-1');
        expect(taken.vehicles.van!.driver).toBeNull();
        expect(vehicleReach(world, taken, 'van')).toBeNull();
        expect(run(world, taken, { type: 'endTurn' }).state.vehicles.van!.driver).toBe('jun');
        // Alone with a downed driver, someone getting in takes the wheel.
        const solo = street({ crew: [{ id: 'mara', pos: P(11, 2) }, { id: 'jun', pos: P(12, 2) }] });
        let s = run(solo.world, solo.state, { type: 'board', crew: 'mara', vehicle: 'van' }).state;
        s.crew[0]!.wounds = { ...s.crew[0]!.wounds, hp: 0, downed: { left: 3, turn: 1, phase: 'crew' } };
        s = run(solo.world, s, { type: 'endTurn' }).state;
        expect(s.vehicles.van!.driver).toBeNull();
        const boarded = run(solo.world, s, { type: 'board', crew: 'jun', vehicle: 'van' });
        expect(of(boarded.events, 'boarded')[0]).toMatchObject({ crew: 'jun', driver: true });
        expect(boarded.state.vehicles.van!.driver).toBe('jun');
    });

    it('keeps the crew aboard out of reach: no arrest, no tackle, no hand through the doors', () => {
        const { world, state } = bothAboard();
        const s = clonePlain(state);
        const mara = s.crew[0]!;
        mara.wounds = { ...mara.wounds, hp: 0, downed: { left: 3, turn: 1, phase: 'crew' } };
        // An officer on foot right beside the cab.
        const beside = P(mara.pos.x - 1, mara.pos.y);
        s.police.units.push({ id: 'police-1', kind: 'patrol', vehicle: null, staging: null, arrived: -3, pos: beside, hp: 6, leaning: null, suppressed: null, moved: null, team: null, watch: null, flashbangs: 0, surprised: null });
        expect(inReach(world, s, beside, mara.pos)).toBe(false);
        const after = run(world, s, { type: 'endTurn' }).state;
        expect(after.custody).toEqual([]);
        expect(after.crew.find(c => c.id === 'mara')!.aboard).toBe('van');
        // A hero beside the van tackles nobody inside it.
        const hero = { ...s.npcs[0] ?? { id: 'h', pos: beside, facing: 's', status: 'calm', suspicion: {}, exposedTo: [], intent: { path: [] } }, pos: beside } as never;
        expect(tackleTarget(world, s, hero)).toBeUndefined();
    });

    it('sits the crew in the cab, looking the way the van points', () => {
        const { world, state } = bothAboard();
        for (const c of state.crew) expect(c).toMatchObject({ pos: P(10, 4), facing: 'w' });
        expect(vehicleAt(world, state, P(10, 4))).toBe('van');
    });
});

describe('police vehicles and the van (decision 193)', () => {
    it('park beside the van, never inside it, and the van can still drive', () => {
        const world = fixtureWorld(Array.from({ length: 9 }, () => '.'.repeat(24)), {
            drivable: true, vehicles: [van({ x: 10, y: 3, heading: 'w' })], rules: { policeEta: 1 },
            // A staging point right under the van.
            staging: [{ id: 'kerb', name: 'The kerb', pos: P(11, 4) }]
        });
        let s = scouted(world, initialState(world, { seed: 3, crew: [{ id: 'mara', pos: P(11, 2) }] }));
        s = run(world, s, { type: 'board', crew: 'mara', vehicle: 'van' }).state;
        s = clonePlain(s);
        s.bank.alarm = true;
        s.response = { raised: s.turn - 1, by: 'tellerButton', policeIn: 1, heat: 0 };
        const after = run(world, s, { type: 'endTurn' }, { type: 'endTurn' }).state;
        expect(after.police.vehicles.length).toBeGreaterThan(0);
        for (const v of after.police.vehicles) expect(vehicleAt(world, after, v.pos)).toBeUndefined();
        for (const u of after.police.units) if (u.pos) expect(vehicleAt(world, after, u.pos)).toBeUndefined();
        expect([...vehicleReach(world, after, 'van')!.nodes.values()].length).toBeGreaterThan(1);
        // Whatever stands on its own footprint (it can't), the van's way out isn't shut by it.
        const odd = clonePlain(after);
        odd.police.vehicles.push({ ...odd.police.vehicles[0]!, id: 'car-99', pos: P(12, 3) });
        expect([...vehicleReach(world, odd, 'van')!.nodes.values()].length).toBeGreaterThan(1);
    });
});

describe('driving on what the crew knows (decision 192)', () => {
    it('plans round the people it sees, through those it doesn\'t, and stops short of one it meets', () => {
        const walker: PersonDef = { id: 'walker', name: 'walker', role: 'customer', observer: 'civilian', pos: P(6, 4), facing: 's', schedule: [] };
        const { world, state } = street({ people: [walker] });
        let s = run(world, state, { type: 'board', crew: 'mara', vehicle: 'van' }, { type: 'endTurn' }).state;
        s = clonePlain(s);
        // The crew has lost sight of the walker, who stands in the van's way west.
        s.npcs[0]!.pos = P(6, 4);
        delete s.knowledge.npcs.walker;
        const to: Pose = { x: 2, y: 3, heading: 'w' };
        const plan = drivePlan(world, s, { crew: 'mara', vehicle: 'van', to });
        expect(typeof plan).toBe('object');
        const done = step(world, s, { type: 'drive', crew: 'mara', vehicle: 'van', to });
        expect(of(done.events, 'driveCut')).toEqual([{ type: 'driveCut', vehicle: 'van', by: 'walker', at: P(6, 4) }]);
        expect(done.undoable).toBe(false);
        const stopped = done.state.vehicles.van!.pose;
        expect(footprint(VAN, stopped).some(t => t.x === 6 && t.y === 4)).toBe(false);
        // Where the planned path was before the manoeuvre that met the walker, short of where it was going.
        expect((plan as { poses: Pose[] }).poses.some(p => poseKey(p) === poseKey(stopped))).toBe(true);
        expect(poseKey(stopped)).not.toBe(poseKey(to));
        expect(done.state.crew[0]!.actionsLeft).toBe(1);
    });

    it('previews a drive into someone unseen exactly as the same drive with nobody there, while the commit is cut', () => {
        const to: Pose = { x: 2, y: 3, heading: 'w' };
        /** The van boarded, the walker (if any) in its way west and out of the crew's knowledge. */
        const world2 = (withWalker: boolean) => {
            const people: PersonDef[] = withWalker ? [{ id: 'walker', name: 'walker', role: 'customer', observer: 'civilian', pos: P(6, 4), facing: 's', schedule: [] }] : [];
            const { world, state } = street({ people });
            const s = clonePlain(run(world, state, { type: 'board', crew: 'mara', vehicle: 'van' }, { type: 'endTurn' }).state);
            if (withWalker) {
                s.npcs[0]!.pos = P(6, 4);
                delete s.knowledge.npcs.walker;
            }
            return { world, state: s };
        };
        const a = world2(true), b = world2(false), cmd = { type: 'drive' as const, crew: 'mara', vehicle: 'van', to };
        const pa = previewCertain(a.world, a.state, cmd), pb = previewCertain(b.world, b.state, cmd);
        expect(projectPreviewEvents(a.world, a.state, pa)).toEqual(projectPreviewEvents(b.world, b.state, pb));
        expect(pa.events).toEqual(pb.events);
        expect(pa.state.vehicles).toEqual(pb.state.vehicles);
        expect(pa.state.crew).toEqual(pb.state.crew);
        expect(pa.undoable).toBe(pb.undoable);
        expect(pa.state.vehicles.van!.pose).toEqual(to);
        // The walker is put back where it stood in the previewed state.
        expect(pa.state.npcs).toEqual(a.state.npcs);
        // The commit meets the walker: cut short, the tiles driven counted, and final.
        const done = step(a.world, a.state, cmd);
        expect(of(done.events, 'driveCut')).toHaveLength(1);
        const driven = of(done.events, 'driven')[0]!;
        expect(driven.cost).toBeLessThan(of(pb.events, 'driven')[0]!.cost);
        expect(done.state.vehicles.van!.pose).not.toEqual(to);
        expect(done.undoable).toBe(false);
    });
});

describe('leaving the plot and the outcome', () => {
    /** Mara at the wheel with the bag in the hold, the van driven to the west edge. */
    function toTheEdge(target: number): { world: ReadonlyWorld; state: State } {
        const { world, state } = street({ objects: [bag('cash', P(11, 2), 'heavy', 60000)], target });
        let s = run(world, state, { type: 'takeLoot', crew: 'mara', loot: 'cash' }, { type: 'board', crew: 'mara', vehicle: 'van' }, { type: 'endTurn' }).state;
        s = run(world, s, { type: 'drive', crew: 'mara', vehicle: 'van', to: { x: 2, y: 3, heading: 'w' } }).state;
        return { world, state: s };
    }

    it('drives off a plot edge: the crew aboard escape with the hold, those left behind are arrested', () => {
        const { world, state } = toTheEdge(50000);
        const reach = vehicleReach(world, state, 'van')!;
        const off = [...reach.nodes.values()].find(n => n.off)!;
        expect(off.pose.x).toBeLessThan(0);
        const done = run(world, state, { type: 'drive', crew: 'mara', vehicle: 'van', to: off.pose });
        expect(of(done.events, 'heistEnded')).toEqual([{ type: 'heistEnded', result: 'success', value: 60000, target: 50000, escaped: ['mara'] }]);
        expect(done.state.vehicles.van!.gone).toBe(true);
        expect(done.state.outcome).toMatchObject({ result: 'success', escaped: ['mara'], arrested: ['jun'], dead: [], loot: ['cash'], value: 60000, target: 50000, vehicle: 'van' });
        // The heist is over: nothing more, not even the end of the turn.
        expect(() => preview(world, done.state, { type: 'endTurn' })).toThrow(/over/);
    });

    it('counts a crew member who died aboard as dead, not as away, but takes what they carried', () => {
        const { world, state } = toTheEdge(50000);
        const s = clonePlain(state);
        s.custody = [];
        s.crew.find(c => c.id === 'jun')!.aboard = 'van';
        s.crew.find(c => c.id === 'jun')!.wounds = { ...s.crew.find(c => c.id === 'jun')!.wounds, hp: 0, dead: true };
        const off = [...vehicleReach(world, s, 'van')!.nodes.values()].find(n => n.off)!;
        expect(run(world, s, { type: 'drive', crew: 'mara', vehicle: 'van', to: off.pose }).state.outcome).toMatchObject({ escaped: ['mara'], dead: ['jun'], arrested: [] });
    });

        it('is a Partial below the target', () => {
        const { world, state } = toTheEdge(100000);
        const off = [...vehicleReach(world, state, 'van')!.nodes.values()].find(n => n.off)!;
        expect(run(world, state, { type: 'drive', crew: 'mara', vehicle: 'van', to: off.pose }).state.outcome).toMatchObject({ result: 'partial', value: 60000 });
    });

    it('fails once every crew member is dead or taken, not while one is down', () => {
        const { world, state } = street();
        const s = clonePlain(state);
        for (const c of s.crew) c.wounds = { ...c.wounds, hp: 0, downed: { left: 3, turn: 1, phase: 'crew' } };
        expect(run(world, s, { type: 'endTurn' }).state.outcome).toBeNull();
        s.crew[0]!.wounds = { ...s.crew[0]!.wounds, downed: null, dead: true };
        s.custody.push({ crew: s.crew.splice(1, 1)[0]!, by: 'police-1', turn: 1 });
        const done = run(world, s, { type: 'endTurn' });
        expect(done.state.outcome).toMatchObject({ result: 'failure', escaped: [], vehicle: null, value: 0, dead: ['mara'], arrested: ['jun'] });
        expect(of(done.events, 'heistEnded')).toHaveLength(1);
    });
});

describe('the van of a generated bank', () => {
    const bank = cachedBank({ layout: 31, population: 2, tier: 'small', archetype: 'twoWing' });

    it('waits where the generator parked it, on street the crew can\'t walk through, and can leave the plot', () => {
        const { world, state } = newHeist(bank);
        const def = world.vehicles!.find(v => v.id === 'van')!;
        const prop = bank.props.find(p => p.kind === 'van')!;
        expect(def.start).toEqual({ x: prop.tx, y: prop.ty, heading: 'w' });
        for (const t of footprint(def, def.start)) {
            expect(tileAt(world, t)).toMatchObject({ drivable: true, blocksMove: false });
            expect(vehicleAt(world, state, t)).toBe('van');
            expect(state.crew.some(c => c.pos.x === t.x && c.pos.y === t.y)).toBe(false);
        }
        expect(world.rules.contractTarget).toBe(75000);
        // With nobody in the way, the street leads off the plot.
        const empty = initialState(world, { seed: 0, crew: [] });
        const reach = driveReach(def, def.start, 60, driveMap(world, empty, 'van'));
        expect([...reach.nodes.values()].some(n => n.off)).toBe(true);
    });
});
