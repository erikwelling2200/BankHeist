import { describe, expect, it } from 'vitest';
import { newHeist, startHeist } from '../../src/game/heist';
import {
    ASSETS, defaultSetup, startView, FAVOUR_CAP, heistFromSetup, jammerSpot, loadoutProfile, PLANNING_CASH, planOptions, ROSTER, setupProblems, spent, type HeistSetup
} from '../../src/game/plan';
import { MemoryStorage, Session } from '../../src/game';
import { footprint, jammed, markerKind, tileAt, VEHICLES, type VehicleType } from '../../src/sim';
import { cachedBank } from '../bankCache';

const bank = cachedBank({ layout: 31, population: 2, tier: 'small', archetype: 'twoWing' });
const options = planOptions(bank);
const plan = (change: (s: HeistSetup) => void = () => {}): HeistSetup => {
    const s = defaultSetup(options);
    change(s);
    return s;
};

describe('planning a heist (M4-07, §18)', () => {
    it("opens on §3's four: Mara and Jun on foot by the van, Dex and Sol in it, nothing bought", () => {
        const setup = plan();
        expect(setupProblems(setup, options)).toEqual([]);
        expect(spent(setup)).toEqual({ cash: 0, favours: 0 });
        const { world, state } = heistFromSetup(bank, setup);
        expect(state.crew.map(c => [c.id, c.aboard])).toEqual([['mara', null], ['jun', null], ['dex', 'van'], ['sol', 'van']]);
        // The van stays where the generator parked it, Dex at the wheel, both in its cab.
        expect(world.vehicles).toEqual(newHeist(bank).world.vehicles);
        expect(state.vehicles.van!.driver).toBe('dex');
        expect(state.crew[2]!.pos).toEqual(state.crew[3]!.pos);
        expect(footprint(VEHICLES.van, state.vehicles.van!.pose)).toContainEqual(state.crew[2]!.pos);
        // Those on foot stand where the M1 crew does, with the loadouts the roster brings (zip-ties for everyone).
        expect(state.crew.slice(0, 2).map(c => c.pos)).toEqual(newHeist(bank).state.crew.map(c => c.pos));
        expect(state.crew.map(c => c.loadout.items)).toEqual([
            ['zipTies'], ['zipTies', 'pistol', 'hackingKit', 'jammer'], ['zipTies', 'shotgun', 'mediumArmour', 'breachCharge', 'flashbang'],
            ['zipTies', 'dmr', 'pistol', 'lightVest', 'medkit']
        ]);
        expect(state.crew.map(c => c.traits)).toEqual(ROSTER.map(m => m.traits));
        expect(ROSTER.map(m => loadoutProfile(m.loadout))).toEqual(['clean', 'concealed', 'armed', 'armed']);
    });

    it('parks the backup car and the ram truck at spots of their own, the crew by each', () => {
        const spots = (t: VehicleType) => options.spots[t].map(s => s.id);
        expect(spots('van')).toContain('alley');
        const setup = plan(s => {
            s.vehicles = { van: 'alley', car: 'curb', ramTruck: 'lot' };
            s.crew[0]!.start = { at: 'car', aboard: false };
            s.crew[2]!.start = { at: 'ramTruck', aboard: true };
        });
        expect(setupProblems(setup, options)).toEqual([]);
        expect(spent(setup)).toEqual({ cash: ASSETS.car.cost + ASSETS.ramTruck.cost, favours: 3 });
        const { world, state } = heistFromSetup(bank, setup);
        expect(world.vehicles!.map(v => [v.id, v.type])).toEqual([['van', 'van'], ['ramTruck', 'ramTruck'], ['car', 'car']]);
        const tiles = world.vehicles!.map(v => footprint(v, v.start));
        for (const [i, a] of tiles.entries()) for (const b of tiles.slice(i + 1)) expect(a.some(t => b.some(u => u.x === t.x && u.y === t.y))).toBe(false);
        for (const t of tiles.flat()) expect(tileAt(world, t)!.drivable).toBe(true);
        expect(state.vehicles.ramTruck!.driver).toBe('dex');
        expect(state.vehicles.van!.driver).toBe('sol');
        const car = world.vehicles!.find(v => v.id === 'car')!.start, mara = state.crew[0]!.pos;
        expect(Math.max(Math.abs(mara.x - car.x), Math.abs(mara.y - car.y))).toBeLessThan(6);
        // Not two vehicles on one spot, nor a crew member by one not bought.
        expect(setupProblems(plan(s => { s.vehicles.car = s.vehicles.van; }), options)).toEqual(['Two vehicles in one spot']);
        expect(setupProblems(plan(s => { s.crew[0]!.start = { at: 'car', aboard: false }; }), options)).toEqual(["Mara starts by the backup car, which isn't bought"]);
    });

    it('starts a crew member with a long gun in the rented nest, raised, facing the bank', () => {
        const setup = plan(s => {
            s.nest = true;
            s.crew[3]!.start = { at: 'nest' };
        });
        expect(setupProblems(setup, options)).toEqual([]);
        const { world, state } = heistFromSetup(bank, setup);
        const sol = state.crew.find(c => c.id === 'sol')!;
        expect(tileAt(world, sol.pos)!.raised).toBe(true);
        expect(tileAt(world, sol.pos)!.room).toBe(options.nestRoom!.id);
        expect(sol.facing).toMatch(/^n/);
        expect(setupProblems(plan(s => { s.crew[3]!.start = { at: 'nest' }; }), options)).toEqual(['Sol starts in the nest: rent it first']);
        expect(setupProblems(plan(s => { s.nest = true; s.crew[0]!.start = { at: 'nest' }; }), options)).toEqual(['Mara needs a long gun in the nest']);
    });

    it('runs a pre-placed jammer from turn 1, only outside next to the building', () => {
        const lobby = options.lobby;
        expect(jammerSpot(options, lobby)).toBe(false);
        // The street in front of the bank.
        const at = [...Array(8).keys()].map(dy => ({ x: lobby.x, y: lobby.y + dy })).find(p => jammerSpot(options, p))!;
        expect(at).toBeDefined();
        const { world, state } = heistFromSetup(bank, plan(s => { s.jammer = at; }));
        expect(state.jammers).toEqual([{ id: expect.any(String), pos: at, crew: '', turn: 1 }]);
        expect(jammed(world, state, lobby)).toBe(true);
        expect(setupProblems(plan(s => { s.jammer = lobby; }), options)).toEqual(['The jammer must stand outside, next to the building']);
        // Never inside a neighbour, however near the bank: a mid-block bank between two.
        const midBlock = cachedBank({ layout: 7, population: 3 }), next = planOptions(midBlock), building = next.world.building ?? [];
        const near = (p: { x: number; y: number }) => [-2, -1, 0, 1, 2].some(dy => [-2, -1, 0, 1, 2].some(dx => building.includes(tileAt(next.world, { x: p.x + dx, y: p.y + dy })?.room ?? '')));
        const neighbours = midBlock.rooms.filter(r => r.zone === 'neighbour').flatMap(r => r.parts.flatMap(part =>
            Array.from({ length: part.w * part.h }, (_, i) => ({ x: part.x + (i % part.w), y: part.y + Math.floor(i / part.w) })))).filter(near);
        expect(neighbours.length).toBeGreaterThan(0);
        for (const p of neighbours) expect(jammerSpot(next, p)).toBe(false);
    });

    it('shows the planning map only the NPCs the crew knows at the start, as play does at turn 1', () => {
        const setup = plan();
        const view = startView(bank, setup, options), { world, state } = heistFromSetup(bank, setup);
        expect(Object.keys(view.npcs).sort()).toEqual(state.npcs.filter(n => markerKind(world, state, n.id) !== null).map(n => n.id).sort());
        expect(Object.keys(view.npcs).length).toBeLessThan(state.npcs.length);
        expect(view.vehicles).toEqual(state.vehicles);
    });

    it('keeps to the cash and the favour cap', () => {
        const all = plan(s => {
            s.vehicles = { van: 'curb', car: 'alley', ramTruck: 'lot' };
            s.nest = true;
            s.jammer = { x: options.lobby.x, y: options.lobby.y + 5 };
        });
        expect(spent(all).favours).toBeLessThanOrEqual(FAVOUR_CAP);
        expect(spent(all).cash).toBeGreaterThan(PLANNING_CASH);
        expect(setupProblems(all, options)).toContain(`Not enough cash: $25k of $${PLANNING_CASH / 1000}k`);
        expect(setupProblems(plan(s => { s.crew = []; }), options)).toEqual(['Pick at least one crew member']);
        expect(setupProblems(plan(s => { s.crew[0]!.loadout.gadgets[0] = 'lmg'; }), options)).toEqual(["Mara's loadout has something out of its slot"]);
        expect(() => heistFromSetup(bank, plan(s => { s.crew = []; }))).toThrow(/can't be played/);
    });

    it('saves the planned heist with its world and resumes it as it was', () => {
        const storage = new MemoryStorage();
        const setup = plan(s => {
            s.vehicles = { van: 'alley', car: 'curb' };
            s.crew = s.crew.filter(c => c.id !== 'jun');
        });
        const session = startHeist(bank, storage, {}, setup);
        const resumed = Session.resume(storage)!;
        expect(resumed.world.vehicles).toEqual(session.world.vehicles);
        expect(resumed.state).toEqual(session.state);
        expect(resumed.state.crew.map(c => c.id)).toEqual(['mara', 'dex', 'sol']);
    });

    it('refuses a plan that is not one (an address edited by hand)', () => {
        const bad = (change: (s: any) => void) => {
            const s: any = plan();
            change(s);
            return setupProblems(s, options);
        };
        const cant = (why: string) => [`The plan can't be read: ${why}`];
        expect(bad(s => { s.crew[1].loadout.gadgets = ['jammer', 'jammer', 'jammer']; })).toEqual(cant('jun has two gadget slots'));
        expect(bad(s => { s.crew[1].loadout.gadgets = ['jammer']; })).toEqual(cant('jun has two gadget slots'));
        expect(bad(s => { s.extra = 1; })).toEqual(cant('not a plan'));
        expect(bad(s => { s.crew[0].loadout.cape = 'red'; })).toEqual(cant("mara's loadout is not one"));
        expect(bad(s => { s.crew[0].start.aboard = 'yes'; })).toEqual(cant("mara's start is not one"));
        expect(bad(s => { s.crew[0].start = { at: 'nest', aboard: true }; })).toEqual(cant("mara's start is not one"));
        expect(bad(s => { s.nest = 1; })).toEqual(cant('the nest is neither rented nor not'));
        expect(bad(s => { s.vehicles = {}; })).toEqual(cant('no van'));
        expect(bad(s => { s.vehicles.tank = 'alley'; })).toEqual(cant("no vehicle 'tank'"));
        expect(bad(s => { s.jammer = { x: 1.5, y: 2 }; })).toEqual(cant('the jammer is nowhere'));
        expect(bad(s => { s.crew[0].loadout.primary = 'bazooka'; })).toEqual(cant("mara's loadout is not one"));
        expect(() => heistFromSetup(bank, (() => { const s: any = plan(); s.vehicles = {}; return s; })())).toThrow(/no van/);
    });

    it('shows the planning map only what the free starts see: a paid start scouts nothing before Start', () => {
        // Everyone by the backup car in the alley, Sol in the nest: the map shows what the same starts at the van (by it,
        // and Sol in it) see, not what the bought ones would.
        const paid = plan(s => {
            s.nest = true;
            s.vehicles.car = 'alley';
            for (const c of s.crew) c.start = c.id === 'sol' ? { at: 'nest' } : { at: 'car', aboard: false };
        });
        const view = startView(bank, paid, options);
        const free = heistFromSetup(bank, plan(s => { for (const c of s.crew) c.start = { at: 'van', aboard: c.id === 'sol' }; }));
        const knows = (h: typeof free) => h.state.npcs.filter(n => markerKind(h.world, h.state, n.id) !== null).map(n => n.id).sort();
        expect(Object.keys(view.npcs).sort()).toEqual(knows(free));
        // The heist itself starts with what its own starts see, which differs here.
        expect(knows(heistFromSetup(bank, paid))).not.toEqual(Object.keys(view.npcs).sort());
        expect(Object.keys(view.vehicles).sort()).toEqual(['car', 'van']);
    });
});
