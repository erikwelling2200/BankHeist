import { describe, expect, it } from 'vitest';
import { wallArt, wallLook } from '../src/art/bank/walls';
import { TILE } from '../src/level/level';
import { LOBBY_PLAN, parseLobby } from '../src/level/lobby';
import { WALL_STEPS } from '../src/level/space';
import { WALL_THICKNESS } from '../src/level/walls';

const { walls } = parseLobby(LOBBY_PLAN);

describe('wall art', () => {
    it('draws every segment of the lobby at every height, standing on its footprint', () => {
        for (const wall of walls) for (const height of WALL_STEPS) {
            const art = wallArt(wall, wallLook(wall, walls), height), t = WALL_THICKNESS[wall.kind];
            const label = `${wall.kind} ${wall.run} at ${wall.tx},${wall.ty}, ${height} high`;
            if (wall.run === 'eastWest') {
                expect([art.width, art.height], label).toEqual([TILE, t + height]);
            } else {
                expect([art.width, art.height], label).toEqual([t, TILE + height]);
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

    it('tells the two leaves of the glass doors apart', () => {
        const doors = walls.filter(w => w.kind === 'doorGlass');
        expect(doors.map(d => wallLook(d, walls))).toEqual(['doorGlassLeft', 'doorGlassRight']);
    });
});
