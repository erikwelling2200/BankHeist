import { describe, expect, it } from 'vitest';
import {
    blastVehicles, clonePlain, damageVehicle, driveMap, edgeBetween, edgeKey, edgeNow, fixtureWorld, footprint, hashOf, initialState, policeFootprint, preview, previewCertain,
    projectPreviewEvents, ramPlan, resolveShot, roadblockTiles, vehicleReach, type Command, type PersonDef, type PoliceVehicle, type Pos, type Pose, type ReadonlyWorld,
    type SimEvent, type State, type VehicleDef
} from '../../src/sim';
import type { Ctx } from '../../src/sim/core/engine';
import type { FixtureWall } from '../../src/sim/world/fixture';
import { scouted, step } from './helpers';

/*
 * M4-04: vehicles in full (§14.4): ramming walls, people, police cars and the roadblock; vehicle hit points from rams,
 * bullets and blasts, disabled vans and police wrecks; police cars parked on their whole footprint and the Heat 5
 * roadblock in the way of the getaway; the backup car as a second way out. Every ram is checked against its preview.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const of = <K extends SimEvent['type']>(events: readonly SimEvent[], type: K) => events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
const vehicle = (id: string, type: VehicleDef['type'], start: Pose): VehicleDef => {
    const size = type === 'car' ? { width: 2, length: 3 } : { width: 2, length: 4 };
    return { id, type, name: type === 'car' ? 'Backup car' : type === 'ramTruck' ? 'Ram truck' : 'Crew van', ...size, start };
};
const npc = (id: string, pos: Pos): PersonDef => ({ id, name: id, role: 'customer', observer: 'civilian', pos, facing: 's', schedule: [] });

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

/**
 * A bank front: rows 0–3 inside (not drivable), a wall between rows 3 and 4 (Soft unless `materials` says otherwise
 * by x), rows 4–11 the street. The van faces north at (10, 7), its nose 3 tiles short of the wall; Mara at its sliding door.
 */
function front(options: { materials?: Record<number, FixtureWall['material']>; people?: PersonDef[]; doors?: number[]; vehicles?: VehicleDef[]; crew?: { id: string; pos: Pos; traits?: string[] }[] } = {}): { world: ReadonlyWorld; state: State } {
    const map = Array.from({ length: 12 }, () => '.'.repeat(24));
    const drivable = map.map((_, y) => (y >= 4 ? 'd'.repeat(24) : '.'.repeat(24)));
    const walls: FixtureWall[] = Array.from({ length: 24 }, (_, x) => ({
        between: [P(x, 3), P(x, 4)] as [Pos, Pos], material: options.materials?.[x] ?? 'soft',
        ...(options.doors?.includes(x) ? { door: { id: `door${x}`, start: 'closed' as const } } : {})
    }));
    const world = fixtureWorld(map, { drivable, walls, vehicles: options.vehicles ?? [vehicle('van', 'van', { x: 10, y: 7, heading: 'n' })], people: options.people ?? [] });
    const crew = (options.crew ?? [{ id: 'mara', pos: P(12, 8) }, { id: 'jun', pos: P(20, 10) }]).map(c => ({ id: c.id, name: c.id, pos: c.pos, ...(c.traits ? { traits: c.traits } : {}) }));
    return { world, state: scouted(world, initialState(world, { seed: 5, crew })) };
}

/** Mara at the wheel, a new turn. */
function atTheWheel(world: ReadonlyWorld, state: State, id = 'van'): State {
    return run(world, state, { type: 'board', crew: 'mara', vehicle: id }, { type: 'endTurn' }).state;
}

const RAM = { type: 'ram', crew: 'mara', vehicle: 'van' } as const;
const key = (a: Pos, b: Pos): string => edgeKey(edgeBetween(a, b));

describe('ramming a wall (§14.4)', () => {
    it('opens a Soft frontage as wide as the van plus one, stops in the breach and hits everyone across it', () => {
        const { world, state } = front({ people: [npc('clerk', P(11, 2)), npc('teller', P(12, 3)), npc('far', P(14, 3))] });
        const s = atTheWheel(world, state);
        const done = run(world, s, RAM);
        const rammed = of(done.events, 'rammed')[0]!;
        expect(rammed).toMatchObject({ into: 'wall', at: { x: 10, y: 4, heading: 'n' }, doors: [] });
        expect(rammed.gap).toEqual([key(P(10, 3), P(10, 4)), key(P(11, 3), P(11, 4)), key(P(12, 3), P(12, 4))].sort());
        expect(rammed.area).toEqual([P(10, 3), P(11, 3), P(12, 3)]);
        for (const k of rammed.gap) expect(edgeNow(world, done.state, k)).toMatchObject({ blocksMove: false, gap: true });
        expect(edgeNow(world, done.state, key(P(13, 3), P(13, 4)))!.blocksMove).toBe(true);
        // The run: 3 tiles straight on, its nose against the gap.
        expect(of(done.events, 'driven')[0]).toMatchObject({ cost: 3, to: { x: 10, y: 4, heading: 'n' }, off: false });
        expect(done.state.vehicles.van!.pose).toEqual({ x: 10, y: 4, heading: 'n' });
        // The teller across the gap is hit; the clerk a row further in and the far one aren't.
        expect(of(done.events, 'harmed').map(h => [h.target, h.damage, h.cause])).toEqual([['teller', 6, 'ram']]);
        expect(of(done.events, 'vehicleDamaged')).toEqual([{ type: 'vehicleDamaged', vehicle: 'van', police: false, damage: 10, hp: 20, cause: 'ram' }]);
        expect(of(done.events, 'noise')[0]).toMatchObject({ radius: 16, kind: 'loud' });
        expect(done.state.bank.loud).toBe(true);
        expect(done.state.crew[0]!.actionsLeft).toBe(1);
    });

    it('breaches a door in the way and takes its barricade with it', () => {
        const { world, state } = front({ doors: [11] });
        const s = clonePlain(atTheWheel(world, state));
        s.edges[key(P(11, 3), P(11, 4))] = { ...(s.edges[key(P(11, 3), P(11, 4))] ?? {}), barricade: 2 } as never;
        const done = run(world, s, RAM);
        expect(of(done.events, 'rammed')[0]!.doors).toEqual(['door11']);
        expect(done.state.doors.door11!.status).toBe('breached');
        expect(done.state.edges[key(P(11, 3), P(11, 4))]?.barricade).toBeUndefined();
    });

    it('opens the extra segment on the left when the right one is harder, and stops dead against Reinforced', () => {
        const left = front({ materials: { 12: 'reinforced' } });
        const a = run(left.world, atTheWheel(left.world, left.state), RAM);
        expect(of(a.events, 'rammed')[0]!.gap).toEqual([key(P(9, 3), P(9, 4)), key(P(10, 3), P(10, 4)), key(P(11, 3), P(11, 4))].sort());
        const hard = front({ materials: { 11: 'reinforced' }, people: [npc('teller', P(10, 3))] });
        const b = run(hard.world, atTheWheel(hard.world, hard.state), RAM);
        expect(of(b.events, 'rammed')[0]).toMatchObject({ into: 'hard', gap: [], area: [] });
        expect(edgeNow(hard.world, b.state, key(P(10, 3), P(10, 4)))!.blocksMove).toBe(true);
        expect(of(b.events, 'harmed')).toEqual([]);
        expect(b.state.vehicles.van!.pose).toEqual({ x: 10, y: 4, heading: 'n' });
        expect(b.state.vehicles.van!.hp).toBe(20);
    });

    it('takes half the damage with a Wheelman, half again in the ram truck', () => {
        const wheel = front({ crew: [{ id: 'mara', pos: P(12, 8), traits: ['wheelman'] }] });
        expect(run(wheel.world, atTheWheel(wheel.world, wheel.state), RAM).state.vehicles.van!.hp).toBe(25);
        const truck = front({ vehicles: [vehicle('van', 'ramTruck', { x: 10, y: 7, heading: 'n' })], crew: [{ id: 'mara', pos: P(12, 8), traits: ['wheelman'] }] });
        const s = atTheWheel(truck.world, truck.state);
        expect(s.vehicles.van!.hp).toBe(40);
        expect(run(truck.world, s, RAM).state.vehicles.van!.hp).toBe(38);
    });

    it('refuses a ram that would disable the crew\'s last way out, and lets a spare vehicle take its full damage (decision 281)', () => {
        const { world, state } = front();
        const s = clonePlain(atTheWheel(world, state));
        s.vehicles.van!.hp = 10;
        expect(ramPlan(world, s, RAM)).toMatch(/last way out/);
        expect(() => step(world, s, RAM)).toThrow(/last way out/);
        s.vehicles.van!.hp = 11;
        expect(run(world, s, RAM).state.vehicles.van!.hp).toBe(1);
        // With the backup car still able to drive, the van may be rammed to a standstill.
        const two = front({ vehicles: [vehicle('van', 'van', { x: 10, y: 7, heading: 'n' }), vehicle('car', 'car', { x: 16, y: 7, heading: 'n' })] });
        const t = clonePlain(atTheWheel(two.world, two.state));
        t.vehicles.van!.hp = 10;
        const done = run(two.world, t, RAM);
        expect(done.state.vehicles.van!.hp).toBe(0);
        expect(of(done.events, 'vehicleDisabled')).toHaveLength(1);
    });

    it('hits the living across the breach, not the dead nor the stashed', () => {
        const { world, state } = front({ people: [npc('teller', P(10, 3)), npc('body', P(11, 3))] });
        const s = clonePlain(atTheWheel(world, state));
        s.npcs.find(n => n.id === 'body')!.status = 'dead';
        expect(of(run(world, s, RAM).events, 'harmed').map(h => h.target)).toEqual(['teller']);
    });

    it('previews the ram with whoever is unseen beyond the wall set aside, and the commit hits them', () => {
        const make = (inside: boolean) => {
            const { world, state } = front({ people: inside ? [npc('teller', P(11, 3))] : [] });
            const s = clonePlain(atTheWheel(world, state));
            if (inside) delete s.knowledge.npcs.teller;
            return { world, state: s };
        };
        const a = make(true), b = make(false);
        const pa = previewCertain(a.world, a.state, RAM), pb = previewCertain(b.world, b.state, RAM);
        expect(projectPreviewEvents(a.world, a.state, pa)).toEqual(projectPreviewEvents(b.world, b.state, pb));
        expect(pa.state.vehicles).toEqual(pb.state.vehicles);
        expect(pa.state.npcs).toEqual(a.state.npcs);
        const done = step(a.world, a.state, RAM);
        expect(of(done.events, 'driveCut')).toEqual([]);
        expect(of(done.events, 'harmed').map(h => [h.target, h.damage])).toEqual([['teller', 6]]);
        expect(done.state.vehicles.van!.pose).toEqual(pb.state.vehicles.van!.pose);
    });

    it('needs 2 clear tiles of run-up and something to ram within one Drive', () => {
        const { world, state } = front({ vehicles: [vehicle('van', 'van', { x: 10, y: 5, heading: 'n' })], crew: [{ id: 'mara', pos: P(12, 6) }] });
        const s = atTheWheel(world, state);
        expect(ramPlan(world, s, RAM)).toMatch(/run-up/);
        const away = clonePlain(s);
        away.vehicles.van!.pose = { x: 14, y: 6, heading: 'e' };
        expect(ramPlan(world, away, RAM)).toMatch(/Nothing to ram/);
        const west = clonePlain(s);
        west.vehicles.van!.pose = { x: 6, y: 6, heading: 'w' };
        expect(ramPlan(world, west, RAM)).toMatch(/Nothing to ram/);
        expect(() => step(world, west, RAM)).toThrow(/Nothing to ram/);
    });
});

describe('ramming what stands in the street', () => {
    /** The van facing west at (14, 6) on an open street, Mara at the wheel. */
    function street(people: PersonDef[] = []): { world: ReadonlyWorld; state: State } {
        const { world, state } = front({ vehicles: [vehicle('van', 'van', { x: 14, y: 6, heading: 'w' })], crew: [{ id: 'mara', pos: P(15, 5) }, { id: 'jun', pos: P(20, 10) }], people });
        return { world, state: atTheWheel(world, state) };
    }
    const car = (id: string, pos: Pos, hp = 20): PoliceVehicle => ({ id, kind: 'car', label: 'Police car', staging: null, pos, arrived: 0, status: 'parked', hp });

    it('shoves a police car out of its lane, damages it, and the way is clear', () => {
        const { world, state } = street();
        const s = clonePlain(state);
        s.police.vehicles.push(car('car-90', P(9, 6)));
        expect(driveMap(world, s, 'van').tile(P(10, 7))).toBe('blocked');
        const done = run(world, s, RAM);
        expect(of(done.events, 'rammed')[0]).toMatchObject({ into: 'police', rammed: ['car-90'], at: { x: 12, y: 6, heading: 'w' } });
        // Facing west its right is north: slid 2 north, clear of the lane.
        expect(of(done.events, 'vehicleShoved')).toEqual([{ type: 'vehicleShoved', vehicle: 'car-90', from: P(9, 6), to: P(9, 4) }]);
        expect(done.state.police.vehicles[0]).toMatchObject({ pos: P(9, 4), hp: 10, status: 'parked' });
        expect(driveMap(world, done.state, 'van').tile(P(10, 7))).toBe('clear');
        expect(ramPlan(world, done.state, RAM)).toMatch(/Nothing to ram/);
    });

    it('wrecks a police car at 0, still shoved aside; boxed in, it is shunted ahead, or off the street when that fails too', () => {
        const { world, state } = street();
        const s = clonePlain(state);
        s.police.vehicles.push(car('car-90', P(9, 6), 8));
        const done = run(world, s, RAM);
        expect(of(done.events, 'policeWrecked')).toHaveLength(1);
        expect(done.state.police.vehicles[0]).toMatchObject({ status: 'wreck', hp: 0, pos: P(9, 4) });
        // Boxed in north and south by two more: no room to shove it aside, so it is shunted 3 tiles ahead.
        const ahead = clonePlain(state);
        ahead.police.vehicles.push(car('car-90', P(9, 6)), car('car-91', P(9, 4)), car('car-92', P(9, 8)));
        const c = run(world, ahead, RAM);
        expect(of(c.events, 'vehicleShoved')).toEqual([{ type: 'vehicleShoved', vehicle: 'car-90', from: P(9, 6), to: P(6, 6) }]);
        expect(ramPlan(world, c.state, RAM)).toMatchObject({ into: 'police', run: 3 });
        // Shunted past the plot's west edge: pushed clear off the street, the lane open, its officers out at staging.
        const boxed = clonePlain(state);
        boxed.vehicles.van!.pose = { x: 8, y: 6, heading: 'w' };
        boxed.police.vehicles.push({ ...car('car-90', P(1, 6)), staging: 'west' }, car('car-91', P(1, 4)), car('car-92', P(1, 8)));
        boxed.police.units.push({ id: 'police-1', kind: 'patrol', vehicle: 'car-90', staging: 'west', arrived: 0, pos: null, hp: 6, leaning: null, suppressed: null, moved: null, team: null, watch: null, flashbangs: 0, surprised: null });
        const b = run(world, boxed, RAM);
        expect(of(b.events, 'vehicleShoved')).toEqual([{ type: 'vehicleShoved', vehicle: 'car-90', from: P(1, 6), to: null }]);
        expect(b.state.police.vehicles.map(v => v.id)).toEqual(['car-91', 'car-92']);
        expect(b.state.police.units[0]!.vehicle).toBeNull();
        expect(driveMap(world, b.state, 'van').tile(P(2, 7))).toBe('clear');
    });

    it('knocks roadblock pieces in its lane away', () => {
        const { world, state } = street();
        const s = clonePlain(state);
        s.police.roadblock = [P(8, 4), P(8, 5), P(8, 6), P(8, 7), P(8, 8)];
        const done = run(world, s, RAM);
        expect(of(done.events, 'roadblockCleared')).toEqual([{ type: 'roadblockCleared', tiles: [P(8, 6), P(8, 7)] }]);
        expect(done.state.police.roadblock).toEqual([P(8, 4), P(8, 5), P(8, 8)]);
    });

    it('hits someone it can see standing where it can\'t drive, never cut by them', () => {
        const map = Array.from({ length: 12 }, () => '.'.repeat(24));
        const drivable = map.map((_, y) => (y >= 4 ? 'd'.repeat(24).split('').map((c, x) => (x === 10 && y === 7 ? '.' : c)).join('') : '.'.repeat(24)));
        const world = fixtureWorld(map, { drivable, vehicles: [vehicle('van', 'van', { x: 14, y: 6, heading: 'w' })] });
        let s = scouted(world, initialState(world, { seed: 5, crew: [{ id: 'mara', name: 'mara', pos: P(15, 5) }, { id: 'jun', name: 'jun', pos: P(10, 7) }] }));
        s = atTheWheel(world, s);
        const plan = ramPlan(world, s, RAM);
        expect(plan).toMatchObject({ into: 'person', people: ['jun'] });
        const done = run(world, s, RAM);
        expect(of(done.events, 'driveCut')).toEqual([]);
        expect(of(done.events, 'harmed').map(h => h.target)).toEqual(['jun']);
    });

    it('hits someone it can see in its way and stops before them', () => {
        const { world, state } = street();
        const s = clonePlain(state);
        s.crew[1]!.pos = P(10, 7);
        const done = run(world, s, RAM);
        expect(of(done.events, 'rammed')[0]).toMatchObject({ into: 'person', at: { x: 11, y: 6, heading: 'w' } });
        expect(of(done.events, 'harmed').map(h => [h.target, h.damage])).toEqual([['jun', 6]]);
    });

    it('is cut short by someone unseen in its run-up, and previewed as the ram with nobody there', () => {
        const make = (walker: boolean) => {
            const { world, state } = street(walker ? [npc('walker', P(11, 7))] : []);
            const s = clonePlain(state);
            s.police.vehicles.push(car('car-90', P(5, 6)));
            if (walker) {
                s.npcs[0]!.pos = P(11, 7);
                delete s.knowledge.npcs.walker;
            }
            return { world, state: s };
        };
        const a = make(true), b = make(false);
        const pa = previewCertain(a.world, a.state, RAM), pb = previewCertain(b.world, b.state, RAM);
        expect(projectPreviewEvents(a.world, a.state, pa)).toEqual(projectPreviewEvents(b.world, b.state, pb));
        expect(pa.state.vehicles).toEqual(pb.state.vehicles);
        expect(pa.state.police.vehicles).toEqual(pb.state.police.vehicles);
        expect(of(pb.events, 'rammed')).toHaveLength(1);
        // The commit meets the walker: it stops before them, nothing rammed, final.
        const done = step(a.world, a.state, RAM);
        expect(of(done.events, 'driveCut')).toEqual([{ type: 'driveCut', vehicle: 'van', by: 'walker', at: P(11, 7) }]);
        expect(of(done.events, 'rammed')).toEqual([]);
        expect(done.state.vehicles.van!.pose).toEqual({ x: 12, y: 6, heading: 'w' });
        expect(done.state.police.vehicles[0]!.hp).toBe(20);
        expect(done.undoable).toBe(false);
    });
});

describe('vehicle damage (§14.4, decision 280)', () => {
    const ctxOf = (world: ReadonlyWorld, state: State, events: SimEvent[]): Ctx => ({ world, state, dice: { next: () => 0.5 } as never, emit: (e: SimEvent) => void events.push(e) } as Ctx);

    it('takes armour off every bullet and blast, and is disabled at 0: no drive, no ram, but the crew can get out', () => {
        const { world, state } = front();
        const s = clonePlain(atTheWheel(world, state)), events: SimEvent[] = [];
        damageVehicle(ctxOf(world, s, events), 'van', [6, 6, 1], 'shot');
        expect(s.vehicles.van!.hp).toBe(22);
        blastVehicles(ctxOf(world, s, events), [P(11, 10)], 6);
        expect(s.vehicles.van!.hp).toBe(18);
        damageVehicle(ctxOf(world, s, events), 'van', { ram: 30 }, 'ram');
        expect(s.vehicles.van!.hp).toBe(0);
        expect(of(events, 'vehicleDisabled')).toEqual([{ type: 'vehicleDisabled', vehicle: 'van' }]);
        expect(vehicleReach(world, s, 'van')).toBeNull();
        expect(() => step(world, s, { type: 'drive', crew: 'mara', vehicle: 'van', to: { x: 10, y: 6, heading: 'n' } })).toThrow(/disabled/);
        expect(ramPlan(world, s, RAM)).toMatch(/disabled/);
        expect(run(world, s, { type: 'getOut', crew: 'mara', to: P(12, 8) }).state.crew[0]!.aboard).toBeNull();
    });

    it('is hit by bullets that stop on it', () => {
        const { world, state } = front({ people: [npc('target', P(10, 4))], crew: [{ id: 'mara', pos: P(10, 11) }, { id: 'jun', pos: P(20, 10) }] });
        const s = clonePlain(state), events: SimEvent[] = [];
        resolveShot(ctxOf(world, s, events), { shooter: 'mara', weapon: 'pistol', at: P(10, 4) });
        expect(of(events, 'vehicleDamaged')).toMatchObject([{ vehicle: 'van', police: false, cause: 'shot' }]);
        expect(s.vehicles.van!.hp).toBeLessThan(30);
    });
});

describe('police cars and the roadblock in the way of the getaway (decisions 283, 285)', () => {
    it('park on their whole footprint, along the street, clear of the van and of each other', () => {
        const map = Array.from({ length: 9 }, () => '.'.repeat(24));
        const world = fixtureWorld(map, {
            drivable: true, vehicles: [vehicle('van', 'van', { x: 3, y: 3, heading: 'w' })], rules: { policeEta: 1 },
            staging: [{ id: 'west', name: 'West', pos: P(0, 4) }]
        });
        let s = scouted(world, initialState(world, { seed: 3, crew: [{ id: 'mara', pos: P(4, 2) }] }));
        s = clonePlain(run(world, s, { type: 'board', crew: 'mara', vehicle: 'van' }).state);
        s.bank.alarm = true;
        s.response = { raised: s.turn - 1, by: 'tellerButton', policeIn: 1, heat: 9 };
        const after = run(world, s, { type: 'endTurn' }, { type: 'endTurn' }).state;
        const cars = after.police.vehicles.filter(v => v.kind !== 'helicopter');
        expect(cars.length).toBeGreaterThan(1);
        const taken = new Set(footprint({ width: 2, length: 4 }, after.vehicles.van!.pose).map(t => `${t.x},${t.y}`));
        for (const v of cars) {
            expect(v.hp).toBeGreaterThan(0);
            for (const t of policeFootprint(v)) {
                expect(taken.has(`${t.x},${t.y}`)).toBe(false);
                taken.add(`${t.x},${t.y}`);
                expect(driveMap(world, after, 'van').tile(t)).toBe('blocked');
            }
        }
    });

    it('puts the Heat 5 roadblock across the street at a staging point, round whoever stands there', () => {
        const map = Array.from({ length: 12 }, () => '.'.repeat(10));
        const drivable = map.map((_, y) => (y >= 2 && y <= 9 ? 'd'.repeat(10) : '.'.repeat(10)));
        const world = fixtureWorld(map, { drivable, staging: [{ id: 'west', name: 'West', pos: P(0, 5) }] });
        const s = initialState(world, { seed: 3, crew: [{ id: 'mara', pos: P(0, 6) }] });
        expect(roadblockTiles(world, s, P(0, 5))).toEqual([P(0, 2), P(0, 3), P(0, 4), P(0, 5), P(0, 7), P(0, 8)]);
    });
});

describe('the backup car: a second way out (decision 284)', () => {
    function twoRides(): { world: ReadonlyWorld; state: State } {
        const map = Array.from({ length: 9 }, () => '.'.repeat(24));
        const world = fixtureWorld(map, {
            drivable: true, vehicles: [vehicle('van', 'van', { x: 2, y: 1, heading: 'w' }), vehicle('car', 'car', { x: 2, y: 5, heading: 'w' })], rules: { contractTarget: 1 }
        });
        let s = scouted(world, initialState(world, { seed: 3, crew: [{ id: 'mara', pos: P(3, 0) }, { id: 'jun', pos: P(3, 4) }] }));
        s = run(world, s, { type: 'board', crew: 'mara', vehicle: 'van' }, { type: 'board', crew: 'jun', vehicle: 'car' }, { type: 'endTurn' }).state;
        return { world, state: s };
    }
    const offPose = (world: ReadonlyWorld, s: State, id: string): Pose => [...vehicleReach(world, s, id)!.nodes.values()].find(n => n.off)!.pose;

    it('keeps the heist going while someone up is left with a vehicle, and ends it as the last one leaves', () => {
        const { world, state } = twoRides();
        expect(state.vehicles.car!.hp).toBe(20);
        const first = run(world, state, { type: 'drive', crew: 'mara', vehicle: 'van', to: offPose(world, state, 'van') });
        expect(first.state.vehicles.van!.gone).toBe(true);
        expect(first.state.outcome).toBeNull();
        expect(of(first.events, 'heistEnded')).toEqual([]);
        const second = run(world, first.state, { type: 'drive', crew: 'jun', vehicle: 'car', to: offPose(world, first.state, 'car') });
        expect(second.state.outcome).toMatchObject({ result: 'partial', escaped: ['mara', 'jun'], arrested: [], vehicle: 'car' });
    });

    it('ends as the first leaves when nobody up is left behind, or the other vehicle is disabled', () => {
        const { world, state } = twoRides();
        const s = clonePlain(state);
        s.vehicles.car!.hp = 0;
        const done = run(world, s, { type: 'drive', crew: 'mara', vehicle: 'van', to: offPose(world, s, 'van') });
        expect(done.state.outcome).toMatchObject({ escaped: ['mara'], arrested: ['jun'], vehicle: 'van' });
    });

    it('takes those who left out of play: nobody bleeds, dies or is arrested off the plot (decision 286)', () => {
        const { world, state } = twoRides();
        const s = clonePlain(state);
        // Mara leaves hurt at 1 HP, bleeding; Jun stays on the plot in the car.
        s.crew[0]!.wounds = { ...s.crew[0]!.wounds, hp: 1 };
        let after = run(world, s, { type: 'drive', crew: 'mara', vehicle: 'van', to: offPose(world, s, 'van') });
        expect(of(after.events, 'crewEscaped')).toEqual([{ type: 'crewEscaped', vehicle: 'van', crew: ['mara'] }]);
        expect(after.state.crew.map(c => c.id)).toEqual(['jun']);
        expect(after.state.escaped.map(e => [e.crew.id, e.vehicle, e.crew.wounds.hp])).toEqual([['mara', 'van', 1]]);
        let t = after.state;
        for (let i = 0; i < 20; i++) t = step(world, t, { type: 'endTurn' }).state;
        expect(t.escaped[0]!.crew.wounds).toMatchObject({ hp: 1, dead: false, downed: null });
        expect(t.custody).toEqual([]);
        after = run(world, t, { type: 'drive', crew: 'jun', vehicle: 'car', to: offPose(world, t, 'car') });
        expect(after.state.outcome).toMatchObject({ escaped: ['mara', 'jun'], dead: [], arrested: [] });
    });

    it('ends once everyone left behind is dead, with those away escaped', () => {
        const { world, state } = twoRides();
        const first = run(world, state, { type: 'drive', crew: 'mara', vehicle: 'van', to: offPose(world, state, 'van') }).state;
        const s = clonePlain(first);
        s.crew.find(c => c.id === 'jun')!.wounds = { ...s.crew.find(c => c.id === 'jun')!.wounds, hp: 0, dead: true };
        const done = run(world, s, { type: 'endTurn' });
        expect(done.state.outcome).toMatchObject({ escaped: ['mara'], dead: ['jun'], vehicle: null });
        expect(done.state.outcome!.result).not.toBe('failure');
    });
});
