import { describe, expect, it } from 'vitest';
import {
    fixtureWorld, initialState, inRing, noiseRadius, NOISES, npcsInside, soundRing, type FixtureWall, type Material, type PersonDef,
    type Pos, type ReadonlyWorld, type State
} from '../../src/sim';

const P = (x: number, y: number): Pos => ({ x, y });
const npc = (id: string, pos: Pos): PersonDef => ({ id, name: id, role: 'clerk', observer: 'staff', pos, facing: 's', schedule: [] });

function setup(map: readonly string[], walls: FixtureWall[] = [], people: PersonDef[] = []): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(map, { walls, people });
    return { world, state: initialState(world, { seed: 1, crew: [] }) };
}

/** How far east along a one-row corridor a sound from its west end reaches. */
function reachEast(wall: FixtureWall | undefined, radius: number): number {
    const { world, state } = setup(['....................'], wall ? [wall] : []);
    return Math.max(...soundRing(world, state, P(0, 0), radius).tiles.map(t => t.pos.x));
}

// The wall in the corridor stands between x = 2 and x = 3.
const at2: [Pos, Pos] = [P(2, 0), P(3, 0)];
const door = (start: 'open' | 'closed' | 'locked', material: Material = 'soft'): FixtureWall => ({ between: at2, material, door: { id: 'd', start } });
const wall = (material: Material, extra: Partial<FixtureWall> = {}): FixtureWall => ({ between: at2, material, ...extra });

describe('the noise flood (§8.9)', () => {
    it.each([
        ['no wall', undefined, 8],
        ['an open door', door('open'), 8],
        ['a closed door', door('closed'), 5],
        ['a locked door', door('locked'), 5],
        ['a closed steel door', door('closed', 'reinforced'), 5],
        ['a Soft wall', wall('soft'), 5],
        ['a glass wall', wall('glass'), 5],
        ['teller glass', wall('tellerGlass'), 2],
        ['a fence', wall('reinforced', { blocksSound: false }), 8],
        ['a Reinforced wall', wall('reinforced'), 2],
        ['a Vault wall', wall('vault'), 2],
        ['a closed vault door', door('closed', 'vault'), 2]
    ])('radius 8 past %s reaches x = %s', (_, w, x) => {
        expect(reachEast(w, 8)).toBe(x);
    });

    it('reaches nothing past a closed door when it has fewer than 3 tiles of reach left there', () => {
        expect(reachEast(door('closed'), 5)).toBe(2);
        expect(reachEast(door('closed'), 6)).toBe(3);
    });

    it('passes a breached door and a hole for free', () => {
        const breached = setup(['..........'], [door('closed')]);
        breached.state.doors.d = { status: 'breached' };
        expect(soundRing(breached.world, breached.state, P(0, 0), 6).tiles.length).toBe(7);
        const holed = setup(['..........'], [wall('reinforced')]);
        holed.state.edges['northSouth 3 0'] = { blocksMove: false, blocksSight: false, blocksSound: false };
        expect(soundRing(holed.world, holed.state, P(0, 0), 6).tiles.length).toBe(7);
    });

    it('rounds a diagonal down: radius 1 reaches the eight neighbours, radius 0 only its tile', () => {
        const { world, state } = setup(['.....', '.....', '.....']);
        expect(soundRing(world, state, P(2, 1), 1).tiles.length).toBe(9);
        expect(soundRing(world, state, P(2, 1), 0).tiles.map(t => t.pos)).toEqual([P(2, 1)]);
    });

    it('floods from several tiles at once', () => {
        const { world, state } = setup(['..........']);
        expect(soundRing(world, state, [P(2, 0), P(7, 0)], 1).tiles.map(t => t.pos.x)).toEqual([1, 2, 3, 6, 7, 8]);
    });

    it('reaches exactly the tiles within its radius of movement cost, rounded down, on open floor', () => {
        const { world, state } = setup(Array.from({ length: 9 }, () => '.........'));
        const ring = soundRing(world, state, P(4, 4), 2);
        const expected: Pos[] = [];
        for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
            const dx = Math.abs(x - 4), dy = Math.abs(y - 4);
            // Octile cost in half-steps; 2.5 tiles rounds down to 2.
            if (3 * Math.min(dx, dy) + 2 * (Math.max(dx, dy) - Math.min(dx, dy)) <= 5) expected.push(P(x, y));
        }
        expect(ring.tiles.map(t => t.pos)).toEqual(expected);
        expect(inRing(ring, P(6, 5))).toBe(true);
        expect(inRing(ring, P(6, 6))).toBe(false);
    });

    it('rings through a closed door exactly 3 tiles shorter on the far side', () => {
        // Two rooms split by a Reinforced wall along x = 4|5, so the only way through is a wooden door at y = 2.
        const map = Array.from({ length: 5 }, () => '..........');
        const walls = (start: 'open' | 'closed'): FixtureWall[] => [0, 1, 2, 3, 4].map(y => ({
            between: [P(4, y), P(5, y)] as [Pos, Pos], ...(y === 2 ? { door: { id: 'd', start } } : { material: 'reinforced' as const })
        }));
        const opened = setup(map, walls('open')), closed = setup(map, walls('closed'));
        const a = soundRing(opened.world, opened.state, P(2, 2), 9), b = soundRing(closed.world, closed.state, P(2, 2), 9);
        let far = 0;
        for (const t of a.tiles) {
            const other = b.byIndex.get(t.pos.y * a.width + t.pos.x);
            if (t.pos.x <= 4) expect(other?.remaining).toBe(t.remaining);
            else {
                // Beyond the door, every tile has 3 tiles (6 half-steps) less reach left, and those that had less are gone.
                expect(other?.remaining).toBe(t.remaining >= 6 ? t.remaining - 6 : undefined);
                if (other) far++;
            }
        }
        expect(far).toBeGreaterThan(0);
        expect(b.tiles.length).toBeLessThan(a.tiles.length);
    });

    it('never slips diagonally past the end of a wall', () => {
        // A Vault wall between (0,0) and (0,1); the tile under it is reached only round its end (3 tiles).
        const { world, state } = setup(['...', '...'], [{ between: [P(0, 0), P(0, 1)], material: 'vault' }]);
        expect(soundRing(world, state, P(0, 0), 2).byIndex.get(1 * 3 + 0)).toBeUndefined();
        expect(soundRing(world, state, P(0, 0), 3).byIndex.get(1 * 3 + 0)?.remaining).toBe(1);
    });

    it('ignores furniture', () => {
        const { world, state } = setup(['.T#..']);
        expect(soundRing(world, state, P(0, 0), 4).tiles.length).toBe(5);
    });

    it('lists the NPCs inside who can hear, in resolution order', () => {
        const { world, state } = setup(['.......'], [], [npc('far', P(6, 0)), npc('b', P(2, 0)), npc('a', P(1, 0)), npc('out', P(1, 0))]);
        state.npcs[3]!.status = 'unconscious';
        const ring = soundRing(world, state, P(0, 0), NOISES.dash.min);
        expect(npcsInside(state, ring)).toEqual(['b', 'a']);
    });

    it('needs the radius of a command shout, and keeps others within their range', () => {
        expect(() => noiseRadius('commandShout')).toThrow(/command radius/);
        expect(noiseRadius('commandShout', 7)).toBe(7);
        expect(noiseRadius('knockout')).toBe(2);
        expect(() => noiseRadius('knockout', 4)).toThrow(/2–3/);
    });
});
