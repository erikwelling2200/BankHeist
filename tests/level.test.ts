import { describe, expect, it } from 'vitest';
import { LEVEL1, parseLevel, TILE } from '../src/level/level';
import { hasLineOfSight } from '../src/logic/vision';

describe('parseLevel', () => {
    const level = parseLevel(LEVEL1);
    const isWall = (x: number, y: number) => level.walls[Math.floor(y / TILE)]?.[Math.floor(x / TILE)] ?? true;

    it('finds the start, exit and gold', () => {
        expect(level.playerStart).toEqual({ x: 3 * TILE + 8, y: 4 * TILE + 8 });
        expect(level.gold.length).toBeGreaterThan(0);
    });

    it('rejects ragged rows', () => expect(() => parseLevel(['#P#', '#E'])).toThrow());

    it('gives every guard a patrol whose legs never cross a wall', () => {
        expect(level.patrols.length).toBeGreaterThan(0);
        for (const patrol of level.patrols) {
            patrol.forEach((p, i) => expect(hasLineOfSight(p, patrol[(i + 1) % patrol.length]!, isWall, 2)).toBe(true));
        }
    });

    it('is enclosed by walls', () => {
        expect(level.walls[0]!.every(Boolean)).toBe(true);
        expect(level.walls.at(-1)!.every(Boolean)).toBe(true);
        expect(level.walls.every(row => row[0] && row.at(-1))).toBe(true);
    });
});
