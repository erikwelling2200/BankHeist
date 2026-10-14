import { describe, expect, it } from 'vitest';
import { edgeBetween as genEdgeBetween, edgeKey as genEdgeKey } from '../../src/gen/site';
import {
    cornerEdges, edgeBetween, edgeKey, edgeNow, FACINGS, facingToward, fixtureWorld, initialState, tileAt, wallBetween
} from '../../src/sim';
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
        expect(world.doors.staffDoor).toMatchObject({ lock: 'mechanical', start: 'closed', edge: edgeKey(door) });
        expect(state.doors.staffDoor).toEqual({ status: 'closed' });
        expect(wallBetween(world, { x: 7, y: 1 }, { x: 7, y: 2 })).toMatchObject({ material: 'glass', blocksSight: false });
        expect(wallBetween(world, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeUndefined();
        for (const [a, b] of [[{ x: 3, y: 4 }, { x: 4, y: 4 }], [{ x: 3, y: 5 }, { x: 3, y: 4 }]] as const) {
            expect(edgeKey(edgeBetween(a, b))).toBe(genEdgeKey(genEdgeBetween(a, b)));
        }
    });

    it('reads an edge as it is now: overrides and open doors', () => {
        const { world, state } = smallBank();
        const key = edgeKey(edgeBetween({ x: 5, y: 1 }, { x: 6, y: 1 })), wall = edgeKey(edgeBetween({ x: 5, y: 0 }, { x: 6, y: 0 }));
        expect(edgeNow(world, state, key)).toEqual({ material: 'soft', blocksSight: true, blocksMove: true });
        expect(edgeNow(world, { ...state, doors: { staffDoor: { status: 'breached' } } }, key)).toMatchObject({ blocksMove: false, blocksSight: false });
        expect(edgeNow(world, { ...state, edges: { [wall]: { blocksMove: false } } }, wall)).toMatchObject({ blocksMove: false, blocksSight: true });
        expect(edgeNow(world, state, edgeKey(edgeBetween({ x: 0, y: 0 }, { x: 1, y: 0 })))).toBeUndefined();
    });

    it('rejects bad fixtures and bad starts', () => {
        expect(() => fixtureWorld(['..'], { zones: ['.#'] })).toThrow(/Unknown zone/);
        expect(() => fixtureWorld(['..'], { zones: ['...'] })).toThrow(/zones grid/);
        expect(() => fixtureWorld(['..'], { dark: [{ x: 2, y: 0 }] })).toThrow(/off the map/);
        const wall = { between: [{ x: 0, y: 0 }, { x: 1, y: 0 }] as [{ x: number; y: number }, { x: number; y: number }] };
        expect(() => fixtureWorld(['..'], { walls: [wall, wall] })).toThrow(/Two walls/);
        expect(() => fixtureWorld(['.?'])).toThrow(/Unknown fixture tile/);
        const { world } = smallBank();
        expect(() => initialState(world, { seed: 1, crew: [{ id: 'teller', pos: { x: 0, y: 0 } }] })).toThrow(/Two people/);
        expect(() => initialState(world, { seed: 1, crew: [{ id: 'jun', pos: { x: 0, y: 3 } }] })).toThrow(/off the map/);
    });
});

describe('the grid', () => {
    it('turns a direction into one of eight facings, as the nearest 45° sector', () => {
        const o = { x: 0, y: 0 };
        expect([[0, -3], [2, -2], [5, 1], [1, 1], [0, 4], [-1, 1], [-3, 0], [-2, -2]].map(([x, y]) => facingToward(o, { x: x!, y: y! })))
            .toEqual(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
        expect(facingToward(o, o)).toBeUndefined();
        // Against the angle (only here, in a test: the rules never use trigonometry).
        for (let x = -12; x <= 12; x++) for (let y = -12; y <= 12; y++) {
            if (!x && !y) continue;
            const sector = Math.round(Math.atan2(y, x) / (Math.PI / 4) + 2);
            expect(facingToward(o, { x, y })).toBe(FACINGS[((sector % 8) + 8) % 8]);
        }
    });

    it('finds edges only between neighbours, and the edges round a cut corner', () => {
        expect(() => edgeBetween({ x: 0, y: 0 }, { x: 1, y: 1 })).toThrow(/share no edge/);
        expect(() => edgeBetween({ x: 0, y: 0 }, { x: 0, y: 0 })).toThrow(/share no edge/);
        expect(() => edgeBetween({ x: 0, y: 0 }, { x: 2, y: 0 })).toThrow(/share no edge/);
        const corner = cornerEdges({ x: 2, y: 2 }, { x: 3, y: 1 }).map(edgeKey);
        expect(corner).toEqual(['northSouth 3 2', 'eastWest 2 2', 'eastWest 3 2', 'northSouth 3 1']);
        expect(new Set(corner).size).toBe(4);
        expect(() => cornerEdges({ x: 0, y: 0 }, { x: 1, y: 0 })).toThrow(/diagonal/);
    });
});
