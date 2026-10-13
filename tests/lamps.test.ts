import { describe, expect, it } from 'vitest';
import { bakeLighting, LampReach, lightBlockers, LIT, tileLight, type Lamp } from '../src/art/bank/lamps';
import { PixelBitmap } from '../src/art/PixelBitmap';
import { TILE } from '../src/level/level';
import { LOBBY_PLAN, parseLobby } from '../src/level/lobby';

const level = parseLobby(LOBBY_PLAN);
const blockers = lightBlockers(level);
const lamp = (tx: number, ty: number, radius = 80): Lamp => {
    const x = tx * TILE, y = ty * TILE;
    return { x, y, z: 40, radius, color: 0xffffff, intensity: 1.5, from: { x, y } };
};
const BACK_WALL = 4 * TILE, FACADE = 14 * TILE;

describe('lamp light', () => {
    it('stops at walls: a lamp in the teller line does not reach the corridor behind the back wall', () => {
        const teller = lamp(10, 5.5), reach = new LampReach(blockers, [teller]);
        expect(reach.reaches(teller, 10 * TILE, BACK_WALL + 8)).toBe(true);
        expect(reach.reaches(teller, 10 * TILE, BACK_WALL - 8)).toBe(false);
    });

    it('goes no further than its radius', () => {
        const small = lamp(10, 9, 20), reach = new LampReach(blockers, [small]);
        expect(reach.reaches(small, 10 * TILE + 10, 9 * TILE)).toBe(true);
        expect(reach.reaches(small, 10 * TILE + 30, 9 * TILE)).toBe(false);
    });

    it('does not show on the sunlit street, even through the glass', () => {
        const front = lamp(10, 13, 80), reach = new LampReach(blockers, [front]);
        expect(reach.reaches(front, 10 * TILE, FACADE - 6)).toBe(true);
        for (let x = 0; x < blockers.width; x += 4) expect(reach.reaches(front, x, FACADE + 6)).toBe(false);
    });

    it('lights a pixel as Light2D would, and not at all where it is blocked', () => {
        const flat = new PixelBitmap(1, 1);
        flat.set(0, 0, 0x808080, 0);
        const over: Lamp = { x: 0.5, y: 0.5, z: 10, radius: 40, color: 0xffffff, intensity: 1, from: { x: 0, y: 0 } };
        const ambient = 0x404040, ambientOnly = Math.round(0x80 * (0x40 / 255));
        const lit = bakeLighting(flat, 0, 0, ambient, [over], () => true);
        // Straight overhead: attenuation 1 - 10²/40², facing 1.
        expect(lit[0]).toBe(Math.min(255, Math.round(0x80 * (0x40 / 255 + (1 - 100 / 1600)))));
        expect(bakeLighting(flat, 0, 0, ambient, [over], () => false)[0]).toBe(ambientOnly);
    });

    it('tells the rules which tiles are lit', () => {
        const corridor = lamp(10, 2.6, 70), lobby = lamp(10, 9, 80);
        const lamps = [corridor, lobby], light = tileLight(level, lamps, new LampReach(blockers, lamps));
        expect(light[2]![10]!).toBeGreaterThanOrEqual(LIT);
        expect(light[9]![10]!).toBeGreaterThanOrEqual(LIT);
        expect(light[15]!.every(l => l === 0)).toBe(true);
        expect(light[20]![10]).toBe(0);
        // A teller-line lamp lights its own row and nothing in the corridor just behind the wall.
        const teller = lamp(10, 4.2, 84), behind = tileLight(level, [teller], new LampReach(blockers, [teller]));
        expect(behind[4]![10]!).toBeGreaterThanOrEqual(LIT);
        expect(behind[3]![10]).toBe(0);
    });
});
