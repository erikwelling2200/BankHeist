import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The rules engine stays pure (§6): no renderer, no browser, no clock, no unseeded randomness. Anything it needs from
 * outside comes in through its arguments.
 */

const ROOT = join(__dirname, '../../src/sim');
const FORBIDDEN: readonly [string, RegExp][] = [
    ['phaser', /phaser/i],
    ['window', /\bwindow\b/],
    ['document', /\bdocument\b/],
    ['Math.random', /Math\.random/],
    ['Date', /\bDate\b/]
];

function files(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
    });
}

describe('src/sim', () => {
    it('touches no renderer, browser, clock or unseeded randomness', () => {
        const found: string[] = [];
        const all = files(ROOT);
        expect(all.length).toBeGreaterThan(5);
        for (const path of all) {
            const text = readFileSync(path, 'utf8');
            for (const [name, pattern] of FORBIDDEN) if (pattern.test(text)) found.push(`${path.slice(ROOT.length + 1)}: ${name}`);
        }
        expect(found).toEqual([]);
    });
});
