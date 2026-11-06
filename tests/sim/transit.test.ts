import { describe, expect, it } from 'vitest';
import {
    clonePlain, commit, deserialiseState, fixtureWorld, initialState, legalActions, OFFICER_STATS, preview, serialiseState,
    type AccessRoute, type FixtureOptions, type Pos, type SimEvent, type State
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

    it('survive a save, and a save from before is refused', () => {
        const { world, state } = setup();
        const s = commit(world, state, enter()).state;
        expect(deserialiseState(serialiseState({ state: s }), world).state).toEqual(s);
        const old = JSON.parse(serialiseState({ state: s })) as { state: { crew: Record<string, unknown>[] } };
        for (const c of old.state.crew) delete c.transit;
        expect(() => deserialiseState(JSON.stringify(old), world)).toThrow(/transit/);
    });
});
