import { describe, expect, it } from 'vitest';
import { mapZoom, nearestStep, zoomSteps } from '../src/logic/zoom';

describe('camera zoom (§20.1)', () => {
    it('steps in whole numbers between about 11 and 34 tiles high', () => {
        expect(zoomSteps(540, 16)).toEqual([1, 2, 3]);
        expect(nearestStep(zoomSteps(540, 16), 540, 16, 17)).toBe(2);
    });

    it('fits the whole plot on the tactical map, whole-number when it can and smaller than 1 when it must', () => {
        // A 960x704 plot: twice over in a 2560x1440 area, once in 1280x720 short of the top bar, scaled down in 960x480.
        expect(mapZoom(2560, 1440, 960, 704)).toBe(2);
        expect(mapZoom(1280, 720, 960, 704)).toBe(1);
        const z = mapZoom(960, 480, 960, 704);
        expect(z).toBeCloseTo(480 / 704, 6);
        expect(960 * z).toBeLessThanOrEqual(960);
        expect(704 * z).toBeLessThanOrEqual(480);
        expect(() => mapZoom(960, 0, 960, 704)).toThrow();
    });
});
