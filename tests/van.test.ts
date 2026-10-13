import { describe, expect, it } from 'vitest';
import { vanArt } from '../src/art/bank/van';
import { propSize } from '../src/level/catalog';
import { FACINGS, topRows, turned } from '../src/level/space';

describe('the hand-drawn van', () => {
    const size = propSize({ kind: 'van', tx: 0, ty: 0 });

    it('fits each view to the van box turned that way', () => {
        for (const facing of FACINGS) {
            const art = vanArt(size, facing);
            const footprint = turned(size, facing);
            // Wing mirrors may stand out past the sides; the body spans the footprint and stands on its south edge.
            expect(art.lit.width - art.originX * 2, facing).toBe(footprint.w);
            expect(art.lit.height, facing).toBe(topRows(footprint.d) + size.h);
            const bottom = art.lit.height - 1;
            expect(art.lit.opaque(art.originX + 1, bottom) || art.lit.opaque(art.originX + Math.floor(footprint.w / 2), bottom), facing).toBe(true);
        }
    });

    it('shows the sliding door only on its right side', () => {
        const right = vanArt(size, 'east'), left = vanArt(size, 'west');
        expect(right.lit.colors).not.toEqual(left.lit.colors);
        // The two sides are not mirror images of each other.
        const mirrored = (x: number, y: number) => left.lit.color(left.lit.width - 1 - x, y);
        let differences = 0;
        for (let y = 0; y < right.lit.height; y++) for (let x = 0; x < right.lit.width; x++) if (right.lit.color(x, y) !== mirrored(x, y)) differences++;
        expect(differences).toBeGreaterThan(10);
    });
});
