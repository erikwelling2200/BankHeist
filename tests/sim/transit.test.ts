import { describe, expect, it } from 'vitest';
import {
    clonePlain, commit, deserialiseState, fixtureWorld, heistOver, initialState, legalActions, occupancy, OFFICER_STATS, preview, routeExit, serialiseState, tackleTarget,
    whyNot, type AccessRoute, type FixtureOptions, type PersonDef, type Pos, type SimEvent, type State
} from '../../src/sim';

/*
 * M4-05, off-map routes (GAME_DESIGN §14.7): going in at either end, the transit track, coming out at the far end,
 * nobody seeing or shooting the crew member while they are gone, Light loot only, and the helicopter closing the roof.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const OPEN = Array.from({ length: 5 }, () => '................');
const endTurn = { type: 'endTurn' } as const;
const of = <K extends SimEvent['type']>(events: readonly SimEvent[], type: K) => events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);

const ROOF: AccessRoute = { id: 'roof', kind: 'roof', name: 'Roof route', outside: P(1, 2), inside: P(14, 2), transit: 2 };
const SEWER: AccessRoute = { id: 'sewer', kind: 'sewer', name: 'Sewer', outside: P(1, 4), inside: P(14, 0), transit: 3 };

function setup(options: FixtureOptions = {}, at: Pos = P(1, 2)): { world: ReturnType<typeof fixtureWorld>; state: State } {
    const world = fixtureWorld(OPEN, { routes: [ROOF, SEWER], ...options });
    const state = clonePlain(initialState(world, { seed: 3, crew: [{ id: 'jun', pos: at, items: ['pistol'] }, { id: 'mara', pos: P(8, 0) }] }));
    return { world, state };
}

const enter = (route = 'roof') => ({ type: 'enterRoute', crew: 'jun', route }) as const;
const jun = (s: State) => s.crew.find(c => c.id === 'jun')!;

describe('off-map routes (§14.7)', () => {
    it('take a crew member off the map for the route\'s turns, and put them out at the far end', () => {
        const { world, state } = setup();
        expect(legalActions(world, state, 'jun')).toContainEqual(enter());
        // Out of reach of the sewer's ends: not offered.
        expect(legalActions(world, state, 'jun')).not.toContainEqual(enter('sewer'));
        const r = commit(world, state, enter());
        expect(of(r.events, 'routeEntered')).toEqual([{ type: 'routeEntered', crew: 'jun', route: 'roof', from: P(1, 2), inward: true, turns: 2, escape: false }]);
        expect(jun(r.state).transit).toEqual({ route: 'roof', inward: true, left: 2, from: P(1, 2), escape: false });
        expect(jun(r.state).actionsLeft).toBe(0);
        // Can't act while gone; nothing in the grid.
        expect(legalActions(world, r.state, 'jun')).toEqual([]);
        expect(() => commit(world, r.state, { type: 'move', crew: 'jun', path: [P(2, 2)] })).toThrow(/in transit/);
        // Undoable: nothing saw it.
        expect(r.undoable).toBe(true);
        // A preview is the outcome.
        expect(preview(world, state, enter()).state).toEqual(r.state);

        const one = commit(world, r.state, endTurn);
        expect(jun(one.state).transit?.left).toBe(1);
        expect(jun(one.state).actionsLeft).toBe(0);
        expect(of(one.events, 'routeLeft')).toEqual([]);
        const two = commit(world, one.state, endTurn);
        expect(of(two.events, 'routeLeft')).toEqual([{ type: 'routeLeft', crew: 'jun', route: 'roof', at: P(14, 2), inward: true }]);
        expect(jun(two.state)).toMatchObject({ pos: P(14, 2), transit: null, actionsLeft: 2 });
    });

    it('come out on the nearest free tile when someone stands on the far end, and go back the other way', () => {
        const { world, state } = setup({}, P(14, 2));
        // Beside the inside end (in reach): heading out.
        state.crew.find(c => c.id === 'mara')!.pos = P(1, 2);
        jun(state).pos = P(13, 2);
        let s = commit(world, state, enter()).state;
        expect(jun(s).transit).toMatchObject({ inward: false, from: P(13, 2) });
        s = commit(world, s, endTurn).state;
        const out = commit(world, s, endTurn);
        const at = of(out.events, 'routeLeft')[0]!.at;
        expect(at).not.toEqual(P(1, 2));
        expect(Math.max(Math.abs(at.x - 1), Math.abs(at.y - 2))).toBe(1);
    });

    it('take nothing heavier than Light, nor a body', () => {
        const objects = [{ id: 'bag', kind: 'loot', pos: P(1, 2), facing: 's' as const, loot: { value: 10000, weight: 'heavy' as const } }];
        const { world, state } = setup({ objects });
        state.loot.bag = { ...state.loot.bag!, holder: 'jun', taken: true };
        jun(state).loadout.carrying = 'lootBag';
        expect(() => commit(world, state, enter())).toThrow(/heavier than Light/);
        expect(legalActions(world, state, 'jun')).not.toContainEqual(enter());
    });

    it('are closed over the roof while the helicopter is over the plot, and it forces back anyone up there', () => {
        const { world, state } = setup();
        const heli = { id: 'helicopter-1', kind: 'helicopter' as const, label: 'Helicopter', staging: null, pos: P(8, 2), arrived: 0, status: 'parked' as const, hp: 10 };
        const closed = clonePlain(state);
        closed.police.vehicles.push(heli);
        expect(() => commit(world, closed, enter())).toThrow(/helicopter/);
        // The sewer stays open.
        closed.crew.find(c => c.id === 'jun')!.pos = P(1, 3);
        expect(() => commit(world, closed, enter('sewer'))).not.toThrow();

        const gone = commit(world, state, enter()).state;
        gone.police.vehicles.push(heli);
        const back = commit(world, gone, endTurn);
        expect(of(back.events, 'routeTurnedBack')).toEqual([{ type: 'routeTurnedBack', crew: 'jun', route: 'roof', at: P(1, 2) }]);
        expect(jun(back.state)).toMatchObject({ pos: P(1, 2), transit: null });
    });

    it('hide the crew member from the police and from bullets while gone', () => {
        const { world, state } = setup();
        jun(state).loadout.masked = true;
        state.bank.alarm = true;
        state.bank.loud = true;
        state.response = { raised: state.turn - 5, by: 'tellerButton', policeIn: 0, heat: 5 };
        state.police.sent = 5;
        state.police.mode = { kind: 'contain', left: 9, since: { turn: state.turn - 1, phase: 'world' }, after: null };
        state.police.units.push({ id: 'cop', kind: 'patrol', vehicle: null, staging: null, arrived: 0, pos: P(5, 2), hp: OFFICER_STATS.patrol.hp, leaning: null, suppressed: null, moved: null, team: null, watch: null, flashbangs: 0, surprised: null });
        // Mara stays out of its sight.
        state.crew.find(c => c.id === 'mara')!.loadout.masked = false;
        const seen = commit(world, state, endTurn);
        expect(of(seen.events, 'fighterFired').map(e => e.target)).toEqual(['jun']);
        const gone = commit(world, commit(world, state, enter()).state, endTurn);
        expect(of(gone.events, 'fighterFired')).toEqual([]);
        // Nor does anyone stand in the way of the tile they left.
        expect(gone.state.police.units[0]!.pos).toBeDefined();
    });

    it('take a crew member off the plot for good with Escape, and end the heist once nobody else is playing (§15.4)', () => {
        const objects = [{ id: 'cash', kind: 'loot', pos: P(1, 2), facing: 's' as const, loot: { value: 5000, weight: 'light' as const } }];
        const { world, state } = setup({ objects, rules: { contractTarget: 4000 } });
        state.loot.cash = { ...state.loot.cash!, holder: 'jun', taken: true };
        const escape = { type: 'enterRoute', crew: 'jun', route: 'roof', escape: true } as const;
        expect(legalActions(world, state, 'jun')).toContainEqual(escape);
        let s = commit(world, state, escape).state;
        // Mara goes too, by the sewer.
        s.crew.find(c => c.id === 'mara')!.pos = P(2, 4);
        s = commit(world, s, { type: 'enterRoute', crew: 'mara', route: 'sewer', escape: true }).state;
        s = commit(world, s, endTurn).state;
        const two = commit(world, s, endTurn);
        expect(of(two.events, 'routeEscaped')).toEqual([{ type: 'routeEscaped', crew: 'jun', route: 'roof' }]);
        expect(two.state.outcome).toBeNull();
        // Out of play for good, with what they carry (decision 286).
        expect(two.state.crew.map(c => c.id)).toEqual(['mara']);
        expect(two.state.escaped).toMatchObject([{ crew: { id: 'jun' }, vehicle: null, route: 'roof' }]);
        const three = commit(world, two.state, endTurn);
        expect(of(three.events, 'routeEscaped').map(e => e.crew)).toEqual(['mara']);
        expect(three.state.outcome).toMatchObject({ result: 'success', vehicle: null, escaped: ['jun', 'mara'], loot: ['cash'], value: 5000 });
        expect(of(three.events, 'heistEnded')).toHaveLength(1);
    });

    it('count a crew member away on foot as escaped when the rest are dead', () => {
        const { world, state } = setup();
        let s = commit(world, state, { type: 'enterRoute', crew: 'jun', route: 'roof', escape: true }).state;
        s.crew.find(c => c.id === 'mara')!.wounds.dead = true;
        s = commit(world, s, endTurn).state;
        const r = commit(world, s, endTurn);
        expect(r.state.outcome).toMatchObject({ result: 'success', escaped: ['jun'], dead: ['mara'] });
    });

    it('can\'t be used again in the crew phase right after coming out (review)', () => {
        const { world, state } = setup();
        let s = commit(world, state, enter()).state;
        s = commit(world, s, endTurn).state;
        s = commit(world, s, endTurn).state;
        expect(jun(s)).toMatchObject({ pos: P(14, 2), transit: null, cameOut: s.turn });
        expect(whyNot(world, s, enter())).toMatch(/just come out/);
        expect(legalActions(world, s, 'jun')).not.toContainEqual(enter());
        // A turn later the way is open again.
        s = commit(world, s, endTurn).state;
        expect(whyNot(world, s, enter())).toBeUndefined();
    });

    it('leave a crew member in transit in nobody\'s way and nobody\'s reach: no pass, no catch, no tackle (review)', () => {
        const objects = [{ id: 'bag', kind: 'loot', pos: P(2, 2), facing: 's' as const, loot: { value: 10000, weight: 'heavy' as const } }];
        const { world, state } = setup({ objects });
        const mara = state.crew.find(c => c.id === 'mara')!;
        mara.pos = P(2, 2);
        state.loot.bag = { ...state.loot.bag!, holder: 'mara', taken: true };
        mara.loadout.carrying = 'lootBag';
        const s = commit(world, state, enter('roof')).state;
        const pass = { type: 'pass', crew: 'mara', to: 'jun' } as const;
        expect(whyNot(world, s, pass)).toMatch(/in transit/);
        expect(() => commit(world, s, pass)).toThrow(/in transit/);
        expect(legalActions(world, s, 'mara')).not.toContainEqual(pass);
        // Thrown onto the tile Jun left: it lands on the floor, nobody catches it.
        const thrown = commit(world, s, { type: 'throwLoot', crew: 'mara', to: P(1, 2) });
        expect(thrown.state.loot.bag!.holder).toBeNull();
        // Nobody stands on the tile he left.
        expect(occupancy(world, s).has(2 * world.width + 1)).toBe(false);
        const hero: PersonDef = { id: 'hero', name: 'hero', role: 'customer', observer: 'civilian', pos: P(1, 1), facing: 's', schedule: [{ from: 1, activity: 'wait', label: 'waiting', room: '', at: P(1, 1), facing: 's' }] };
        const w2 = fixtureWorld(OPEN, { routes: [ROOF, SEWER], people: [hero] });
        const s2 = commit(w2, clonePlain(initialState(w2, { seed: 3, crew: [{ id: 'jun', pos: P(1, 2) }] })), enter()).state;
        expect(tackleTarget(w2, s2, s2.npcs[0]!)).toBeUndefined();
    });

    it('come out in the room of the far end, never through a wall or a door, past anyone standing at the end (review)', () => {
        const rooms = OPEN.map(() => 'aaaaaaaaaaaaabbb');
        const walls = [0, 1, 2, 3, 4].map(y => ({ between: [P(12, y), P(13, y)] as [Pos, Pos], material: 'reinforced' as const }));
        const { world, state } = setup({ rooms, walls });
        // Mara on the inside end: Jun comes out beside her, in her room.
        state.crew.find(c => c.id === 'mara')!.pos = P(14, 2);
        let s = commit(world, state, enter()).state;
        expect(routeExit(world, s, 'jun', ROOF.inside)!.x).toBeGreaterThanOrEqual(13);
        // With the room full there is nowhere: none.
        const full = clonePlain(s);
        for (let y = 0; y < 5; y++) for (let x = 13; x < 16; x++) full.crew.push({ ...clonePlain(full.crew[1]!), id: `x${x}${y}`, pos: P(x, y) });
        expect(routeExit(world, full, 'jun', ROOF.inside)).toBeNull();

        // Someone standing on the hatch moves them on to the next tile; a body lying there doesn't.
        const person: PersonDef = { id: 'ann', name: 'ann', role: 'customer', observer: 'civilian', pos: P(14, 2), facing: 's', schedule: [{ from: 1, activity: 'wait', label: 'waiting', room: '', at: P(14, 2), facing: 's' }] };
        const held = setup({ rooms, walls, people: [person] });
        s = commit(held.world, held.state, enter()).state;
        s = commit(held.world, s, endTurn).state;
        const lying = clonePlain(s);
        const r = commit(held.world, s, endTurn);
        const out = of(r.events, 'routeLeft')[0]!.at;
        expect(out).not.toEqual(P(14, 2));
        expect(out.x).toBeGreaterThanOrEqual(13);
        lying.npcs[0]!.status = 'unconscious';
        expect(of(commit(held.world, lying, endTurn).events, 'routeLeft')[0]!.at).toEqual(P(14, 2));
        // Turned back by the helicopter onto a tile someone stands on: moved on as well, never held.
        const back = setup({ rooms, walls, people: [{ ...person, pos: P(1, 2), schedule: [{ ...person.schedule[0]!, at: P(1, 2) }] }] });
        const gone = commit(back.world, back.state, enter()).state;
        gone.police.vehicles.push({ id: 'h', kind: 'helicopter', label: 'Helicopter', staging: null, pos: P(8, 2), arrived: 0, status: 'parked', hp: 10 });
        const t = commit(back.world, gone, endTurn);
        expect(of(t.events, 'routeTurnedBack')[0]!.at).not.toEqual(P(1, 2));
        expect(of(t.events, 'routeHeld')).toEqual([]);
    });

    it('settle a dye pack on the way out of the building, by either kind of leaving (review)', () => {
        const rooms = OPEN.map(() => 'oooooooobbbbbbbb');
        const objects = [{ id: 'cash', kind: 'loot', pos: P(14, 2), facing: 's' as const, loot: { value: 5000, weight: 'light' as const, dyePack: true as const } }];
        for (const escape of [false, true]) {
            const { world, state } = setup({ rooms, building: ['b'], objects, rules: { dyePacks: true } }, P(14, 2));
            state.loot.cash = { ...state.loot.cash!, holder: 'jun', taken: true };
            let s = commit(world, state, { type: 'enterRoute', crew: 'jun', route: 'roof', ...(escape ? { escape } : {}) }).state;
            s = commit(world, s, endTurn).state;
            const r = commit(world, s, endTurn);
            expect(of(r.events, 'dyePackBurst').map(e => e.loot)).toEqual(['cash']);
            expect(r.state.loot.cash!.ruined).toBe(true);
        }
    });

    it('end the heist after the last vehicle only when those left behind have no way out on foot (review)', () => {
        const gone = (world: ReturnType<typeof fixtureWorld>) => {
            const s = clonePlain(initialState(world, { seed: 3, crew: [{ id: 'jun', pos: P(1, 2) }] }));
            s.vehicles = { van: { pose: { x: 0, y: 0, heading: 'n' }, driver: null, hold: [], gone: true, hp: 0 } } as unknown as State['vehicles'];
            s.escaped = [{ crew: clonePlain(s.crew[0]!), vehicle: 'van', turn: 1 }];
            s.escaped[0]!.crew.id = 'mara';
            return s;
        };
        const none = fixtureWorld(OPEN);
        expect(heistOver(none, gone(none))).toBe(true);
        const routes = fixtureWorld(OPEN, { routes: [ROOF, SEWER] });
        const s = gone(routes);
        expect(heistOver(routes, s)).toBe(false);
        // The helicopter closes the roof, not the sewer.
        s.police.vehicles.push({ id: 'h', kind: 'helicopter', label: 'Helicopter', staging: null, pos: P(8, 2), arrived: 0, status: 'parked', hp: 10 });
        expect(heistOver(routes, s)).toBe(false);
        const roofOnly = fixtureWorld(OPEN, { routes: [ROOF] }), r = gone(roofOnly);
        r.police.vehicles.push(clonePlain(s.police.vehicles[0]!));
        expect(heistOver(roofOnly, r)).toBe(true);
        // While someone is still on a route out it never ends.
        r.crew[0]!.transit = { route: 'roof', inward: true, left: 1, from: P(1, 2), escape: true };
        expect(heistOver(roofOnly, r)).toBe(false);
    });

    it('survive a save, and a save from before is refused', () => {
        const { world, state } = setup();
        const s = commit(world, state, enter()).state;
        expect(deserialiseState(serialiseState({ state: s }), world).state).toEqual(s);
        const old = JSON.parse(serialiseState({ state: s })) as { state: { crew: Record<string, unknown>[] } };
        for (const c of old.state.crew) delete c.transit;
        expect(() => deserialiseState(JSON.stringify(old), world)).toThrow(/transit/);
    });
});
