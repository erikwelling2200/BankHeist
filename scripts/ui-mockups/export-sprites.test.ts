import { writeFileSync } from 'fs';
import { test } from 'vitest';
import { LOOKS, standardPerson, type PersonSpec } from '../../src/art/bank/people';
import { PERSON_STYLES } from '../../src/art/bank/peopleStyles';
import type { PersonMask, PersonPose } from '../../src/level/plan';

// Writes unlit sprites of the people that SPRITES (a JSON list of {look, facing, mask?, pose?}) names, in the standard
// drawing and in the hi-bit style, for hibit.py: the game draws at the art's resolution, so double-density people can
// only be previewed by lighting them outside it. Run: npx vitest run --config scripts/ui-mockups/vitest.export.config.ts
test.skipIf(!process.env.SPRITES)('export sprites', () => {
    const wanted = JSON.parse(process.env.SPRITES ?? '[]') as { look: string; facing: 'front' | 'back'; mask?: PersonMask; pose?: PersonPose }[];
    const out = wanted.map(w => {
        const spec: PersonSpec = { ...LOOKS[w.look]!, mask: w.mask, pose: w.pose };
        const pack = (b: { width: number; height: number; colors: Uint8ClampedArray }) => ({ w: b.width, h: b.height, rgba: [...b.colors] });
        return { ...w, standard: pack(standardPerson(spec, w.facing)), hibit: pack(PERSON_STYLES.hibit!(spec, w.facing)) };
    });
    writeFileSync(process.env.SPRITES_OUT ?? 'sprites.json', JSON.stringify(out));
});
