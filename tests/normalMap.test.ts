import { describe, expect, it } from 'vitest';
import { buildNormalMap } from '../src/logic/normalMap';

describe('buildNormalMap', () => {
    it('points a flat interior straight out of the screen', () => {
        const heights = new Float32Array(9).fill(1);
        const n = buildNormalMap(heights, 3, 3);
        const centre = 4 * 4;
        expect([n[centre], n[centre + 1], n[centre + 2]]).toEqual([128, 128, 255]);
    });

    it('tilts a left edge towards -X', () => {
        const heights = new Float32Array(9).fill(1);
        expect(buildNormalMap(heights, 3, 3)[3 * 4]!).toBeLessThan(128);
    });
});
