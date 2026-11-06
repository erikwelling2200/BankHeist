import { describe, expect, it } from 'vitest';
import {
    chargeBlast, commit, coverAgainst, edgeNow, fixtureWorld, initialState, lineOfSight, legalActions, preview, scorchTiles, shotFabric, shotMap, sightMap, stepCost, whyNot,
    type Command, type FixtureOptions, type PersonDef, type Pos, type ReadonlyWorld, type SimEvent, type State, type WorldObject
} from '../../src/sim';

/*
 * Charges, gaps and explosions (M4-01, GAME_DESIGN §12.2, §14.2): breach and shaped charges on walls and doors, the gap
 * they leave (movement, sight, sound, bullets), the far side's damage, the loot lost (as `chargeBlast`, the preview,
 * says), debris cover, tripwires, and thermite scorching the loot by the vault door.
 */

const P = (x: number, y: number): Pos => ({ x, y });

const person = (id: string, pos: Pos, role = 'customer', observer: PersonDef['observer'] = 'civilian'): PersonDef => ({
    id, name: id, role, observer, pos, facing: 's', schedule: []
});
const loot = (id: string, pos: Pos): WorldObject => ({ id, kind: 'loot', pos, facing: 's', name: id, loot: { value: 5000, weight: 'heavy' } });

function setup(map: string[], options: FixtureOptions & { jun?: Pos; items?: string[] } = {}): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(map, options);
    const state = initialState(world, { seed: 3, crew: [{ id: 'jun', pos: options.jun ?? P(2, 1), items: options.items ?? ['breachCharge', 'shapedCharge', 'tripwire'] }] });
    return { world, state };
}

// A wall along x = 3|4 for rows 0–3; jun at (3, 1) beside it, facing east.
const MAP = ['........', '........', '........', '........'];
const wall = (material: 'soft' | 'reinforced' | 'glass' | 'vault', door?: string) =>
    [0, 1, 2, 3].map(y => ({ between: [P(3, y), P(4, y)] as [Pos, Pos], material, ...(door && y === 1 ? { door: { id: door } } : {}) }));
const EDGE = 'northSouth 4 1';
const jun = (state: State) => state.crew.find(c => c.id === 'jun')!;
const types = (events: readonly SimEvent[]): string[] => events.map(e => e.type);
const place = (item = 'breachCharge', edge = EDGE): Command => ({ type: 'placeCharge', crew: 'jun', item, edge });

describe('wall charges', () => {
    it('are set beside a wall they can open, lie a crew phase and go off as the world phase starts', () => {
        const { world, state } = setup(MAP, { walls: wall('soft'), jun: P(3, 1), people: [person('cust', P(4, 2)), person('far', P(7, 3))] });
        state.crew[0]!.facing = 'e';
        expect(legalActions(world, state, 'jun')).toContainEqual(place());
        const set = commit(world, state, place());
        expect(set.events.find(e => e.type === 'chargePlaced')).toMatchObject({ kind: 'breachCharge', edge: EDGE, from: P(3, 1) });
        expect(jun(set.state).charges.breachCharge).toBe(1);
        expect(jun(set.state).actionsLeft).toBe(1);
        // Still a wall until the world phase.
        expect(edgeNow(world, set.state, EDGE)!.blocksMove).toBe(true);
        expect(whyNot(world, set.state, place())).toMatch(/already/);
        const off = commit(world, set.state, { type: 'endTurn' });
        // As the world phase starts, before anyone walks.
        expect(types(off.events)).toContain('chargeWentOff');
        const went = off.events.find(e => e.type === 'chargeWentOff')!;
        expect(went).toMatchObject({ door: null, tiles: [P(4, 0), P(4, 1), P(4, 2)] });
        // The far side takes 4, the near side nothing; the bank went loud on a noise of 14.
        expect(off.events.filter(e => e.type === 'harmed').map(e => e.type === 'harmed' && [e.target, e.damage, e.cause])).toEqual([['cust', 4, 'blast']]);
        expect(off.state.bank.loud).toBe(true);
        expect(off.events.find(e => e.type === 'noise' && e.cause.startsWith('breachCharge'))).toMatchObject({ radius: 14, kind: 'loud' });
        expect(off.state.charges).toEqual([]);
    });

    it('leave a gap that movement, sight, sound and bullets pass', () => {
        const { world, state } = setup(MAP, { walls: wall('soft'), jun: P(3, 1) });
        expect(stepCost(world, state, P(3, 1), P(4, 1))).toBeUndefined();
        expect(lineOfSight(sightMap(world, state), P(2, 1), P(6, 1))).toBe(false);
        const off = commit(world, commit(world, state, place()).state, { type: 'endTurn' }).state;
        expect(off.edges[EDGE]).toMatchObject({ gap: true, blocksMove: false, blocksSight: false, blocksSound: false });
        expect(stepCost(world, off, P(3, 1), P(4, 1))).toBe(2);
        expect(lineOfSight(sightMap(world, off), P(2, 1), P(6, 1))).toBe(true);
        const map = shotMap(world, off);
        expect(map.edges.find(e => e.key === EDGE)!.open).toBe(true);
        // The walls beside it still stand.
        expect(edgeNow(world, off, 'northSouth 4 0')!.blocksMove).toBe(true);
    });

    it('open only what their material allows; a door is breached', () => {
        const hard = setup(MAP, { walls: wall('reinforced'), jun: P(3, 1) });
        expect(whyNot(hard.world, hard.state, place())).toMatch(/can't open reinforced/);
        expect(whyNot(hard.world, hard.state, place('shapedCharge'))).toBeUndefined();
        const vault = setup(MAP, { walls: wall('vault'), jun: P(3, 1) });
        expect(whyNot(vault.world, vault.state, place('shapedCharge'))).toMatch(/can't open vault/);
        expect(whyNot(hard.world, hard.state, place('breachCharge', 'northSouth 4 3'))).toMatch(/isn't beside/);
        const door = setup(MAP, { walls: wall('soft', 'office'), jun: P(3, 1) });
        const off = commit(door.world, commit(door.world, door.state, place()).state, { type: 'endTurn' });
        expect(off.events.find(e => e.type === 'chargeWentOff')).toMatchObject({ door: 'office' });
        expect(off.state.doors.office!.status).toBe('breached');
        expect(off.state.edges[EDGE]).toBeUndefined();
        // An open door needs no charge.
        door.state.doors.office = { status: 'open' };
        expect(whyNot(door.world, door.state, place())).toMatch(/open already/);
    });

    it('take a barricade on the door with it (M4-02)', () => {
        const { world, state } = setup(MAP, { walls: wall('soft', 'office'), jun: P(3, 1) });
        state.edges[EDGE] = { barricade: 2 };
        expect(whyNot(world, state, place())).toBeUndefined();
        const off = commit(world, commit(world, state, place()).state, { type: 'endTurn' }).state;
        expect(off.doors.office!.status).toBe('breached');
        expect(edgeNow(world, off, EDGE)!.blocksMove).toBe(false);
    });

    it('destroy the loot within a tile of the gap, as the preview says, and spare loot further off or in the hands', () => {
        const objects = [loot('near', P(3, 2)), loot('far', P(4, 0)), loot('away', P(6, 1)), loot('behind', P(2, 1))];
        const { world, state } = setup(MAP, { walls: wall('soft'), jun: P(3, 1), objects });
        const set = commit(world, state, place()).state;
        const shown = chargeBlast(world, set, 'breachCharge', EDGE, P(3, 1));
        expect(shown.loot).toEqual(['far', 'near']);
        const off = commit(world, set, { type: 'endTurn' });
        const lost = off.events.filter((e): e is Extract<SimEvent, { type: 'lootDestroyed' }> => e.type === 'lootDestroyed').map(e => e.loot).sort();
        expect(lost).toEqual(shown.loot);
        expect(off.state.loot.near!.ruined).toBe(true);
        expect(off.state.loot.away!.ruined).toBe(false);
        expect(off.state.loot.behind!.ruined).toBe(false);
    });

    it('a shaped charge leaves debris across the gap: half cover nothing shoots away', () => {
        const { world, state } = setup(MAP, { walls: wall('reinforced'), jun: P(3, 1), people: [person('guard', P(4, 1), 'lobbyGuard', 'enforcer')] });
        const off = commit(world, commit(world, state, place('shapedCharge')).state, { type: 'endTurn' });
        expect(off.state.debris).toEqual([P(4, 1)]);
        expect(off.events.filter(e => e.type === 'harmed').map(e => e.type === 'harmed' && e.damage)).toEqual([6]);
        expect(off.events.find(e => e.type === 'noise' && e.cause.startsWith('shapedCharge'))).toMatchObject({ radius: 18 });
        // Someone at (5, 1) shot at from the far east is covered by the debris on (4, 1)… from the west.
        const map = shotMap(world, off.state), fabric = shotFabric(world, off.state, map, off.state.cover);
        expect(coverAgainst(map, fabric, { id: 'x', pos: P(5, 1), standing: true, shield: false, armour: 0, precise: false }, P(1, 1))).toMatchObject({ kind: 'tile', at: '4 1' });
        expect(coverAgainst(map, fabric, { id: 'x', pos: P(5, 1), standing: true, shield: false, armour: 0, precise: false }, P(7, 1))).toBeNull();
    });

    it('are refused with their hands full or none left, and the last one takes the item off them', () => {
        const { world, state } = setup(MAP, { walls: wall('reinforced'), jun: P(3, 1), items: ['shapedCharge'] });
        const set = commit(world, state, place('shapedCharge')).state;
        expect(jun(set).loadout.items).not.toContain('shapedCharge');
        expect(whyNot(world, set, place('shapedCharge', 'northSouth 4 0'))).toMatch(/no shapedCharge/);
    });

    it('preview the placing as the commit does it', () => {
        const { world, state } = setup(MAP, { walls: wall('soft'), jun: P(3, 1) });
        expect(preview(world, state, place()).events).toEqual(commit(world, state, place()).events);
    });
});

describe('tripwires', () => {
    it('are laid once the bank is loud and go off as an NPC steps on them, its walk stopping there', () => {
        const { world, state } = setup(MAP, { jun: P(0, 0), people: [person('cust', P(1, 2))] });
        const lay: Command = { type: 'placeTripwire', crew: 'jun', at: P(1, 1) };
        expect(whyNot(world, state, lay)).toMatch(/loud/);
        state.bank.loud = true;
        expect(whyNot(world, state, { ...lay, at: P(3, 3) })).toMatch(/tile or the next/);
        const laid = commit(world, state, lay).state;
        expect(laid.tripwires).toEqual([{ id: expect.any(String), by: 'jun', at: P(1, 1) }]);
        expect(jun(laid).charges.tripwire).toBe(1);
        // The customer walks north over it.
        laid.npcs[0]!.intent = { path: [P(1, 1), P(1, 0)] };
        const off = commit(world, laid, { type: 'endTurn' });
        expect(off.events.find(e => e.type === 'npcWalked')).toMatchObject({ npc: 'cust', path: [P(1, 1)] });
        expect(off.events.find(e => e.type === 'tripwireWentOff')).toMatchObject({ by: 'cust', at: P(1, 1) });
        // Radius 1 (Euclidean): the customer, and jun beside it on (0, 0) is outside it (a diagonal is √2).
        expect(off.events.filter(e => e.type === 'harmed').map(e => e.type === 'harmed' && [e.target, e.damage])).toEqual([['cust', 6]]);
        expect(off.state.tripwires).toEqual([]);
    });
});

describe('thermite', () => {
    it('scorches the loot within a tile of the vault door each phase it burns', () => {
        const { world, state } = setup(MAP, { walls: wall('vault', 'vault'), jun: P(3, 1) });
        expect(scorchTiles(world, state, 'vault')).toEqual([P(3, 0), P(4, 0), P(3, 1), P(4, 1), P(3, 2), P(4, 2)]);
    });
});
