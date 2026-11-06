import { describe, expect, it } from 'vitest';
import { actionMenu, menuIsLegal } from '../../src/game/actions';
import { chargeViews } from '../../src/game/loudBoards';
import { commit, fixtureWorld, initialState, type Pos, type WorldObject } from '../../src/sim';

/* M4-01 in the game: the charge entries of the grid, and the preview of what a charge would hit and destroy. */

const P = (x: number, y: number): Pos => ({ x, y });
const MAP = ['........', '........', '........', '........'];
const walls = [0, 1, 2, 3].map(y => ({ between: [P(3, y), P(4, y)] as [Pos, Pos], material: 'soft' as const }));
const bag = (id: string, pos: Pos): WorldObject => ({ id, kind: 'loot', pos, facing: 's', name: id, loot: { value: 5000, weight: 'heavy' } });

function setup(rooms?: string[]) {
    const world = fixtureWorld(MAP, { walls, objects: [bag('bag', P(4, 2))], ...(rooms ? { rooms, zones: rooms.map(r => r.replace(/a/g, 's')) } : {}) });
    const state = initialState(world, { seed: 2, crew: [{ id: 'jun', pos: P(3, 1), items: ['breachCharge', 'tripwire'] }] });
    state.crew[0]!.facing = 'e';
    return { world, state };
}

describe('charges in the game', () => {
    it('offers a breach charge on the wall faced, with the count, and a tripwire only once loud (on their own tile: the one faced is past the wall)', () => {
        const { world, state } = setup();
        const menu = actionMenu(world, state, 'jun');
        const entry = menu.find(e => e.id === 'charge:breachCharge')!;
        expect(entry.label).toBe('Breach charge (2)');
        expect(entry.command).toEqual({ type: 'placeCharge', crew: 'jun', item: 'breachCharge', edge: 'northSouth 4 1' });
        expect(menu.some(e => e.id === 'tripwire')).toBe(false);
        expect(menuIsLegal(world, state, 'jun', menu)).toBe(true);
        state.bank.loud = true;
        expect(actionMenu(world, state, 'jun').find(e => e.id === 'tripwire')!.command).toEqual({ type: 'placeTripwire', crew: 'jun', at: P(3, 1) });
    });

    it('previews the far side and the loot lost, as it goes off, and shows only what the crew has a picture of', () => {
        const { world, state } = setup();
        const cmd = { type: 'placeCharge' as const, crew: 'jun', item: 'breachCharge', edge: 'northSouth 4 1' };
        expect(chargeViews(world, state, cmd)).toEqual([{ kind: 'breachCharge', at: { x: 4, y: 1.5 }, tiles: [P(4, 0), P(4, 1), P(4, 2)], loot: [P(4, 2)], fuse: 1, preview: true }]);
        const set = commit(world, state, cmd).state;
        expect(chargeViews(world, set, null)).toMatchObject([{ loot: [P(4, 2)], fuse: 1 }]);
        expect(commit(world, set, { type: 'endTurn' }).state.loot.bag!.ruined).toBe(true);
        // The far side a room nobody has seen into (hidden): none of it drawn.
        const hidden = setup(['....aaaa', '....aaaa', '....aaaa', '....aaaa']);
        expect(chargeViews(hidden.world, hidden.state, cmd)).toMatchObject([{ tiles: [], loot: [] }]);
    });
});
