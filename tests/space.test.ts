import { describe, expect, it } from 'vitest';
import { TILE } from '../src/level/level';
import { boxesOverlap, place, px, type Size } from '../src/level/space';

const cabinet: Size = { w: px(0.95), d: px(0.5), h: px(1.3) };

describe('placing a box', () => {
    it('centres a one-tile object in its tile by default', () => {
        const box = place({ tx: 2, ty: 3 }, cabinet);
        expect(box.x + box.w / 2).toBeCloseTo(2 * TILE + TILE / 2, 0);
        expect(box.y + box.d / 2).toBeCloseTo(3 * TILE + TILE / 2, 0);
    });

    it('pushes an object against a side of its tile', () => {
        const north = place({ tx: 2, ty: 3, alignX: 'east', alignY: 'north' }, cabinet);
        expect(north.y).toBe(3 * TILE);
        expect(north.x + north.w).toBe(3 * TILE);
        const south = place({ tx: 2, ty: 3, alignX: 'west', alignY: 'south' }, cabinet);
        expect(south.x).toBe(2 * TILE);
        expect(south.y + south.d).toBe(4 * TILE);
    });

    it('stands a centred object on the line between the two tiles of its span', () => {
        const table: Size = { w: px(1.2), d: px(0.6), h: px(0.45) };
        const box = place({ tx: 4, ty: 1, span: [2, 1] }, table);
        // An odd width can only be centred to within half a pixel.
        expect(Math.abs(box.x + box.w / 2 - 5 * TILE)).toBeLessThanOrEqual(0.5);
    });

    it('raises mounted things to their elevation and refuses footprints that do not fit', () => {
        expect(place({ tx: 0, ty: 0, elevation: px(1.1) }, cabinet).z).toBe(px(1.1));
        expect(() => place({ tx: 0, ty: 0 }, { w: TILE + 1, d: 4, h: 4 }).w).not.toThrow();
        expect(() => place({ tx: 0, ty: 0, span: [1, 1] }, { w: TILE + 1, d: 4, h: 4 })).toThrow();
    });
});

describe('boxes overlapping', () => {
    const a = { x: 0, y: 0, z: 0, w: 10, d: 10, h: 10 };

    it('counts shared volume but not touching faces', () => {
        expect(boxesOverlap(a, { ...a, x: 5 })).toBe(true);
        expect(boxesOverlap(a, { ...a, x: 10 })).toBe(false);
    });

    it('lets something hang above something else in the same footprint', () => {
        expect(boxesOverlap(a, { ...a, z: 10 })).toBe(false);
        expect(boxesOverlap(a, { ...a, z: 9 })).toBe(true);
    });
});
