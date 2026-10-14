import { describe, expect, it } from 'vitest';
import { edgeBetween as genEdgeBetween, edgeKey as genEdgeKey } from '../../src/gen/site';
import { edgeBetween, edgeKey, facingToward, tileAt, wallBetween } from '../../src/sim';
import { smallBank } from './helpers';

describe('the fixture world', () => {
    it('reads zones and objects from the map', () => {
        const { world } = smallBank();
        expect([world.width, world.height]).toEqual([9, 3]);
        expect(tileAt(world, { x: 0, y: 0 })!.zone).toBe('public');
        expect(tileAt(world, { x: 6, y: 0 })!.zone).toBe('staff');
        expect(tileAt(world, { x: 8, y: 2 })!.zone).toBe('secure');
        expect(tileAt(world, { x: 2, y: 1 })).toMatchObject({ blocksMove: true, halfCover: true, tall: false });
        expect(tileAt(world, { x: 7, y: 1 })).toMatchObject({ blocksMove: true, tall: true, zone: 'staff' });
        expect(tileAt(world, { x: 9, y: 0 })).toBeUndefined();
    });

    it('puts walls and doors on edges, keyed like the generator', () => {
        const { world, state } = smallBank();
        const door = wallBetween(world, { x: 6, y: 1 }, { x: 5, y: 1 })!;
        expect(door).toMatchObject({ material: 'soft', blocksMove: true, blocksSight: true, door: 'staffDoor' });
        expect(world.doors.staffDoor).toMatchObject({ lock: 'mechanical', open: false, edge: edgeKey(door) });
        expect(state.doors.staffDoor).toEqual({ open: false, locked: false });
        expect(wallBetween(world, { x: 7, y: 1 }, { x: 7, y: 2 })).toMatchObject({ material: 'glass', blocksSight: false });
        expect(wallBetween(world, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeUndefined();
        for (const [a, b] of [[{ x: 3, y: 4 }, { x: 4, y: 4 }], [{ x: 3, y: 5 }, { x: 3, y: 4 }]] as const) {
            expect(edgeKey(edgeBetween(a, b))).toBe(genEdgeKey(genEdgeBetween(a, b)));
        }
    });

    it('turns a direction into one of eight facings', () => {
        const o = { x: 0, y: 0 };
        expect([[0, -3], [2, -2], [5, 1], [1, 1], [0, 4], [-1, 1], [-3, 0], [-2, -2]].map(([x, y]) => facingToward(o, { x: x!, y: y! })))
            .toEqual(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
        expect(facingToward(o, o)).toBeUndefined();
    });
});
