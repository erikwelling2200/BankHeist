import { describe, expect, it } from 'vitest';
import { bakeLighting, LampReach, lightBlockers, LIT, tileLight, type Lamp } from '../src/art/bank/lamps';
import { PixelBitmap } from '../src/art/PixelBitmap';
import { TILE } from '../src/level/constants';
import { BANK_PLAN } from '../src/level/bank';
import { parsePlan } from '../src/level/plan';

const level = parsePlan(BANK_PLAN);
const blockers = lightBlockers(level);
const lamp = (tx: number, ty: number, radius = 80): Lamp => {
    const x = tx * TILE, y = ty * TILE;
    return { x, y, z: 40, radius, color: 0xffffff, intensity: 1.5, from: { x, y } };
};
const BACK_WALL = 13 * TILE, FACADE = 28 * TILE;

describe('lamp light', () => {
    it('stops at walls: a lamp in the teller line does not reach the corridor behind the back wall', () => {
        const teller = lamp(30, 14.5), reach = new LampReach(blockers, [teller]);
        expect(reach.reaches(teller, 30 * TILE, BACK_WALL + 8)).toBe(true);
        expect(reach.reaches(teller, 30 * TILE, BACK_WALL - 8)).toBe(false);
    });

    it('goes no further than its radius', () => {
        const small = lamp(30, 20, 20), reach = new LampReach(blockers, [small]);
        expect(reach.reaches(small, 30 * TILE + 10, 20 * TILE)).toBe(true);
        expect(reach.reaches(small, 30 * TILE + 30, 20 * TILE)).toBe(false);
    });

    it('does not show on the sunlit street, even through the glass', () => {
        const front = lamp(30, 26, 80), reach = new LampReach(blockers, [front]);
        expect(reach.reaches(front, 30 * TILE, FACADE - 6)).toBe(true);
        for (let x = 0; x < blockers.width; x += 4) expect(reach.reaches(front, x, FACADE + 6)).toBe(false);
    });

    it('lights a pixel as Light2D would, and not at all where it is blocked', () => {
        const flat = new PixelBitmap(1, 1);
        flat.set(0, 0, 0x808080, 0);
        const over: Lamp = { x: 0.5, y: 0.5, z: 10, radius: 40, color: 0xffffff, intensity: 1, from: { x: 0, y: 0 } };
        const ambient = 0x404040, ambientOnly = Math.round(0x80 * (0x40 / 255));
        const unexposed = () => [1, 1, 1] as const;
        const lit = bakeLighting(flat, 0, 0, ambient, [over], () => true, unexposed);
        // Straight overhead: attenuation 1 - 10²/40², facing 1.
        expect(lit[0]).toBe(Math.min(255, Math.round(0x80 * (0x40 / 255 + (1 - 100 / 1600)))));
        expect(bakeLighting(flat, 0, 0, ambient, [over], () => false, unexposed)[0]).toBe(ambientOnly);
        // Exposure scales what the lamps and ambient give, after the lit colour clamps.
        expect(bakeLighting(flat, 0, 0, ambient, [over], () => false, () => [2, 2, 2])[0]).toBe(Math.round(0x80 * (0x40 / 255) * 2));
    });

    it('tells the rules which tiles are lit', () => {
        const corridor = lamp(30, 11.6, 70), lobby = lamp(30, 20, 80);
        const lamps = [corridor, lobby], light = tileLight(level, lamps, new LampReach(blockers, lamps));
        expect(light[11]![30]!).toBeGreaterThanOrEqual(LIT);
        expect(light[20]![30]!).toBeGreaterThanOrEqual(LIT);
        expect(light[29]!.every(l => l === 0)).toBe(true);
        expect(light[34]![30]).toBe(0);
        // A teller-line lamp lights its own row and nothing in the corridor just behind the wall.
        const teller = lamp(30, 13.2, 84), behind = tileLight(level, [teller], new LampReach(blockers, [teller]));
        expect(behind[13]![30]!).toBeGreaterThanOrEqual(LIT);
        expect(behind[12]![30]).toBe(0);
    });
});
