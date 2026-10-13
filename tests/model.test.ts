import { describe, expect, it } from 'vitest';
import { renderModel, type Model } from '../src/art/bank/model';
import { topRows, type Size } from '../src/level/space';

const RED = 0xff0000, GREEN = 0x00ff00, BLUE = 0x0000ff, YELLOW = 0xffff00, GREY = 0x808080;
const size: Size = { w: 6, d: 3, h: 4 };
const crate: Model = { parts: [{ x: 0, y: 0, z: 0, ...size, top: GREY, front: RED, back: GREEN, left: BLUE, right: YELLOW }] };

describe('rendering a model', () => {
    it('shows the face that points at the camera for each facing, and turns the footprint', () => {
        const cases = [['south', RED, 6], ['north', GREEN, 6], ['east', BLUE, 3], ['west', YELLOW, 3]] as const;
        for (const [facing, colour, width] of cases) {
            const art = renderModel(crate, size, facing);
            expect(art.lit.width, facing).toBe(width);
            expect(art.lit.color(0, art.lit.height - 1), facing).toBe(colour);
            expect(art.lit.color(0, 0), facing).toBe(GREY);
        }
    });

    it('stacks the foreshortened top surface over the face (as tall as the box)', () => {
        const art = renderModel(crate, size, 'south');
        expect(art.lit.height).toBe(topRows(size.d) + size.h);
        expect(art.lit.color(0, topRows(size.d) - 1)).toBe(GREY);
        expect(art.lit.color(0, topRows(size.d))).toBe(RED);
        expect(renderModel(crate, size, 'east').lit.height).toBe(topRows(size.w) + size.h);
    });

    it('keeps something flat on the floor at its full depth', () => {
        const mat: Model = { parts: [{ x: 0, y: 0, z: 0, w: 6, d: 6, h: 0, top: GREY }] };
        expect(renderModel(mat, { w: 6, d: 6, h: 0 }, 'south').lit.height).toBe(6);
    });

    it('hides what is behind a nearer part, whichever way the model faces', () => {
        // A low block at the front, a tall one at the back: from the front the low one covers the tall one's foot.
        const tiered: Model = { parts: [
            { x: 0, y: 0, z: 0, w: 4, d: 2, h: 6, sides: BLUE, top: BLUE },
            { x: 0, y: 2, z: 0, w: 4, d: 2, h: 2, sides: RED, top: RED }
        ] };
        const tieredSize = { w: 4, d: 4, h: 6 };
        const south = renderModel(tiered, tieredSize, 'south');
        expect(south.lit.color(1, south.lit.height - 1)).toBe(RED);
        expect(south.lit.color(1, 0)).toBe(BLUE);
        // Turned to face north the tall block is now in front and hides the low one completely.
        const north = renderModel(tiered, tieredSize, 'north');
        for (let y = 0; y < north.lit.height; y++) expect(north.lit.color(1, y)).not.toBe(RED);
    });

    it('turns lights with the model', () => {
        const lit: Model = { ...crate, lights: [{ x: 1, y: 0, z: 0, radius: 10, color: 0xffffff, intensity: 1 }] };
        const south = renderModel(lit, size, 'south').lights[0]!;
        const north = renderModel(lit, size, 'north').lights[0]!;
        expect(south.x).toBe(1);
        expect(north.x).toBe(size.w - 1);
    });

    it('refuses a model that reaches in front of its footprint at floor level', () => {
        const sticking: Model = { parts: [{ x: 0, y: 0, z: 0, w: 2, d: 5, h: 1, sides: RED, top: RED }] };
        expect(() => renderModel(sticking, { w: 2, d: 3, h: 1 }, 'south')).toThrow();
    });
});
