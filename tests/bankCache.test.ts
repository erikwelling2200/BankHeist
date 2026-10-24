import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateBank } from '../src/gen/generate';
import { cachePath, cachedBank, generatorHash, importClosure } from './bankCache';

/*
 * The generated-bank cache (tests/bankCache.ts): keyed by the generator's sources, so a change to any file the
 * generator imports builds the banks afresh, and a cached bank is exactly the one the generator builds.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(file, 'utf8');
/** `read`, with one more line in `changed`. */
const touched = (changed: string) => (file: string) => read(file) + (file === join(ROOT, changed) ? '\n// changed\n' : '');

describe('the bank cache', () => {
    it('follows the generator\'s imports into src/gen and src/level, and no further than it imports', () => {
        const files = importClosure(join(ROOT, 'src/gen/generate.ts')).map(f => relative(ROOT, f).split(sep).join('/'));
        for (const f of ['src/gen/generate.ts', 'src/gen/layout.ts', 'src/gen/validate.ts', 'src/level/catalog.ts', 'src/level/space.ts']) expect(files).toContain(f);
        expect(files.some(f => f.startsWith('src/sim/') || f.startsWith('src/scenes/'))).toBe(false);
    });

    it('is invalidated by a change to any generator file, near or deep, and not by others', () => {
        const now = generatorHash(read);
        expect(generatorHash(read)).toBe(now);
        for (const file of ['src/gen/layout.ts', 'src/gen/validate.ts', 'src/level/space.ts', 'tests/bankCache.ts']) {
            expect(generatorHash(touched(file)), file).not.toBe(now);
            const opts = { layout: 31, population: 2, tier: 'small', archetype: 'twoWing' } as const;
            expect(cachePath(opts, generatorHash(touched(file))), file).not.toBe(cachePath(opts, now));
        }
        expect(generatorHash(touched('src/sim/index.ts'))).toBe(now);
    });

    it('keys a bank by its options, in any order', () => {
        expect(cachePath({ layout: 1, population: 2, tier: 'city', archetype: 'atrium' }, 'h')).toBe(cachePath({ archetype: 'atrium', tier: 'city', population: 2, layout: 1 }, 'h'));
        expect(cachePath({ layout: 1, population: 2 }, 'h')).not.toBe(cachePath({ layout: 1, population: 3 }, 'h'));
        expect(cachePath({ layout: 1, population: 2 }, 'h')).not.toBe(cachePath({ layout: 1, population: 2, plot: 'midBlock' }, 'h'));
    });

    it('hands out the generator\'s own bank, from memory and from disk, frozen', () => {
        const opts = { layout: 31, population: 2, tier: 'small', archetype: 'twoWing' } as const;
        const bank = cachedBank(opts), fresh = generateBank(opts);
        expect(JSON.stringify(bank)).toBe(JSON.stringify(fresh));
        expect(cachedBank({ archetype: 'twoWing', tier: 'small', population: 2, layout: 31 })).toBe(bank);
        expect(Object.isFrozen(bank.people[0])).toBe(true);
        if (process.env.BANK_CACHE !== '0') expect(readFileSync(cachePath(opts), 'utf8')).toBe(JSON.stringify(fresh));
    });
});
