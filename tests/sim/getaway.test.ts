import { describe, expect, it } from 'vitest';
import {
    bagsSecured, clonePlain, doorTiles, driveMap, drivePath, drivePlan, driveReach, footprint, hashOf, HEADINGS, initialState, MANOEUVRES, manoeuvre, poseKey, preview,
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

    it('turns in reverse along the forward turn back, sweeping the same tiles', () => {
        for (const heading of HEADINGS) {
            const pose: Pose = { x: 10, y: 10, heading };
            for (const [rev, fwd] of [['reverseLeft', 'turnLeft'], ['reverseRight', 'turnRight']] as const) {
                const back = manoeuvre(VAN, pose, rev);
                const again = manoeuvre(VAN, back.end, fwd);
                expect(again.end).toEqual(pose);
                expect(back.tiles).toEqual(again.tiles);
            }
            // Mirror images: a left turn's sweep is the right turn's reflected across the vehicle's length.
            expect(manoeuvre(VAN, pose, 'turnLeft').tiles.length).toBe(manoeuvre(VAN, pose, 'turnRight').tiles.length);
        }
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
