import { describe, expect, it } from 'vitest';
import { RAIL_HEIGHT, wallArt, wallLook, wallMargin } from '../src/art/bank/walls';
import { TILE } from '../src/level/constants';
import { BANK_PLAN } from '../src/level/bank';
import { parsePlan } from '../src/level/plan';
import { WALL_STEPS } from '../src/level/space';
import { WALL_THICKNESS } from '../src/level/walls';

const { walls } = parsePlan(BANK_PLAN);

describe('wall art', () => {
    it('draws every segment of the plot at every height, standing on its footprint', () => {
        for (const wall of walls) for (const height of WALL_STEPS) {
            const art = wallArt(wall, wallLook(wall, walls), height), t = WALL_THICKNESS[wall.kind];
            const label = `${wall.kind} ${wall.run} at ${wall.tx},${wall.ty}, ${height} high`;
            // A railing stands at its own height, however far walls are cut.
            const h = wall.kind === 'rail' ? RAIL_HEIGHT : height;
            if (wall.run === 'eastWest') {
                expect([art.width, art.height], label).toEqual([TILE, t + h]);
            } else {
                expect([art.width, art.height], label).toEqual([t + 2 * wallMargin(wall), TILE + h]);
            }
        }
    });

    it('cuts a wall lower by taking rows off the top of its face, so what stays matches the full wall', () => {
        const wall = walls.find(w => w.kind === 'doorWood' && w.run === 'eastWest')!, look = wallLook(wall, walls);
        const full = wallArt(wall, look, WALL_STEPS.at(-1)!), cut = wallArt(wall, look, WALL_STEPS[0]);
        const t = WALL_THICKNESS[wall.kind];
        for (let z = 1; z <= WALL_STEPS[0]; z++) for (let u = 0; u < TILE; u++) {
            expect(cut.color(u, cut.height - z)).toBe(full.color(u, full.height - z));
        }
        // The section on top is the same at any height.
        for (let v = 0; v < t; v++) for (let u = 0; u < TILE; u++) expect(cut.color(u, v)).toBe(full.color(u, v));
    });

    it('tells the two leaves of a glass double door, and the two halves of the vault door, apart', () => {
        const pair = (kind: 'doorGlass' | 'vaultDoor') => walls.filter(w => w.kind === kind && walls.some(o => o.kind === kind && Math.abs(o.tx - w.tx) === 1 && o.ty === w.ty));
        expect(pair('doorGlass').map(d => wallLook(d, walls))).toEqual(['doorGlassLeft', 'doorGlassRight']);
        expect(pair('vaultDoor').map(d => wallLook(d, walls))).toEqual(['vaultDoorLeft', 'vaultDoorRight']);
    });

    it('shows a door in a north-south wall by its casings and handles, which stand proud of both faces', () => {
        const wall = walls.find(w => w.kind === 'doorWood' && w.run === 'northSouth')!, m = wallMargin(wall);
        expect(m).toBeGreaterThan(0);
        const art = wallArt(wall, wallLook(wall, walls), WALL_STEPS.at(-1)!), t = WALL_THICKNESS[wall.kind];
        const column = (x: number) => Array.from({ length: art.height }, (_, y) => art.opaque(x, y)).filter(Boolean).length;
        // The casing's jambs stand a door's height on both sides of the wall; a plain wall has nothing there.
        expect(column(m - 1)).toBeGreaterThan(WALL_STEPS.at(-1)! - 2);
        expect(column(m + t)).toBeGreaterThan(WALL_STEPS.at(-1)! - 2);
        expect(column(0)).toBeGreaterThan(0);
        const plain = walls.find(w => w.kind === 'plaster' && w.run === 'northSouth')!;
        expect(wallMargin(plain)).toBe(0);
    });
});
