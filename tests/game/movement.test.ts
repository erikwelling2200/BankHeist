import { describe, expect, it } from 'vitest';
import { moveAlong, moveRange, moveTo } from '../../src/game/movement';
import type { UiState } from '../../src/game/session';
import { actionsView, confirmView } from '../../src/game/views';
import { commit, dashRefusal, fixtureWorld, HEAVY_ARMOUR_ITEM, initialState, type Pos, type ReadonlyWorld, type State } from '../../src/sim';
import { scouted } from '../sim/helpers';

const P = (x: number, y: number): Pos => ({ x, y });

/** A corridor 20 tiles long, Jun at its west end. */
function corridor(items: string[] = []): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(['....................']);
    return { world, state: scouted(world, initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0), items }] })) };
}

const along = (n: number): Pos[] => Array.from({ length: n }, (_, i) => P(i + 1, 0));

describe('movement as the player picks it', () => {
    it('shows Move\'s tiles and, beyond them, those only a Dash reaches; a tap picks by distance', () => {
        const { world, state } = corridor(), jun = state.crew[0]!;
        expect(dashRefusal(world, state, 'jun')).toBeNull();
        const range = moveRange(world, state, jun, true);
        expect(range.walk.map(p => p.x)).toEqual([1, 2, 3, 4, 5]);
        expect(range.run.map(p => p.x)).toEqual([6, 7, 8, 9, 10, 11, 12]);
        const near = moveTo(range, jun, P(3, 0))!, far = moveTo(range, jun, P(12, 0))!;
        expect(near.type).toBe('move');
        expect(far.type).toBe('dash');
        expect(moveTo(range, jun, P(13, 0))).toBeUndefined();
        // What the range promises is what a commit does: 1 action for the near tile, 2 for the far one.
        expect(commit(world, state, near).state.crew[0]!.actionsLeft).toBe(1);
        expect(commit(world, state, far).state.crew[0]!.actionsLeft).toBe(0);
    });

    it('picks Move or Dash for a drawn path by its cost, and says where one too long goes wrong', () => {
        const { world, state } = corridor(), jun = state.crew[0]!, range = moveRange(world, state, jun, true);
        expect(moveAlong(world, state, jun, range, along(5)).command?.type).toBe('move');
        expect(moveAlong(world, state, jun, range, along(6)).command?.type).toBe('dash');
        expect(moveAlong(world, state, jun, range, along(14)).badFrom).toBe(12);
    });

    it('has no Dash band with one action left or in heavy armour, by the sim\'s own rules', () => {
        const { world, state } = corridor([HEAVY_ARMOUR_ITEM]), jun = state.crew[0]!;
        const reason = dashRefusal(world, state, 'jun');
        expect(reason).toMatch(/heavy armour/);
        const heavy = moveRange(world, state, jun, !reason);
        expect([heavy.walk.length, heavy.run.length]).toEqual([4, 0]);
        const plain = corridor(), tired = commit(plain.world, plain.state, { type: 'move', crew: 'jun', path: along(1) }).state;
        expect(dashRefusal(plain.world, tired, 'jun')).toMatch(/1 of 2 actions/);
        expect(moveRange(plain.world, tired, tired.crew[0]!, false).run).toEqual([]);
    });

    it('shows movement as one grid entry, and Confirm costs a Dash 2 pips', () => {
        const { world, state } = corridor();
        const ui: UiState = { selected: 'jun', camera: null, pendingCommand: { type: 'dash', crew: 'jun', path: along(8) } };
        expect(actionsView(world, state, ui).map(a => [a.id, a.label, a.cost, !!a.selected])).toEqual([
            ['move', 'Dash', 2, true], ['wait', 'Wait', 0, false], ['command', 'Command', 1, false], ['mask', 'Mask up', 1, false], ['go', 'GO', 0, false]
        ]);
        expect(confirmView(ui)).toMatchObject({ label: 'DASH', cost: 2, enabled: true });
        expect(confirmView({ ...ui, pendingCommand: { type: 'move', crew: 'jun', path: along(2) } })).toMatchObject({ label: 'MOVE', cost: 1 });
    });
});
