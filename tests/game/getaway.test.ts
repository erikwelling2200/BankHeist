import { describe, expect, it } from 'vitest';
import { actionMenu, getawayDrive, menuIsLegal } from '../../src/game/actions';
import { newHeist } from '../../src/game/heist';
import { hudView, outcomeView } from '../../src/game/views';
import { clonePlain, commit, doorTiles, type State } from '../../src/sim';
import { cachedBank } from '../bankCache';

/* M3-08 in the game: the grid's Get in, Drive and Get out, and the outcome screen's view model. */

const bank = cachedBank({ layout: 31, population: 2, tier: 'small', archetype: 'twoWing' });

describe('the getaway through the action grid', () => {
    it('offers Get in at the van\'s door, then Drive toward the plot\'s edge until it leaves, then the outcome', () => {
        const { world, state } = newHeist(bank);
        const van = world.vehicles![0]!;
        let s: State = clonePlain(state);
        s.crew[0]!.pos = doorTiles(van, van.start)[0]!;
        const menu = actionMenu(world, s, 'mara');
        const board = menu.find(e => e.id === 'board')!;
        expect(board).toMatchObject({ label: 'Get in', command: { type: 'board', crew: 'mara', vehicle: 'van' } });
        expect(board.reason).toBeUndefined();
        expect(menuIsLegal(world, s, 'mara', menu)).toBe(true);
        s = commit(world, s, board.command).state;
        s = commit(world, s, { type: 'endTurn' }).state;
        const aboard = actionMenu(world, s, 'mara');
        expect(aboard.map(e => e.id)).toEqual(['drive', 'getOut']);
        expect(menuIsLegal(world, s, 'mara', aboard)).toBe(true);
        expect(hudView(world, s, { selected: 'mara' } as never).actions[0]).toMatchObject({ id: 'move', enabled: false });
        for (let i = 0; i < 12 && !s.outcome; i++) {
            if (s.crew[0]!.actionsLeft === 0) s = commit(world, s, { type: 'endTurn' }).state;
            const next = getawayDrive(world, s, 'van')!;
            expect(next).not.toBeNull();
            s = commit(world, s, actionMenu(world, s, 'mara').find(e => e.id === 'drive')!.command).state;
        }
        expect(s.outcome).toMatchObject({ result: 'partial', escaped: ['mara'], arrested: ['jun'] });
        const view = outcomeView(world, s)!;
        expect(view).toMatchObject({ result: 'partial', title: 'Partial success', value: 0, target: 75000, payout: 0 });
        expect(view.crew.map(c => [c.name, c.fate])).toEqual([['Mara', 'escaped'], ['Jun', 'arrested']]);
        expect(hudView(world, s, { selected: null } as never).outcome).toEqual(view);
    });

    it('shows no outcome while the heist goes on', () => {
        const { world, state } = newHeist(bank);
        expect(outcomeView(world, state)).toBeNull();
    });
});
