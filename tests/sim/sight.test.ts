import { describe, expect, it } from 'vitest';
import { generateBank } from '../../src/gen/generate';
import { Nav } from '../../src/gen/nav';
import { Rng } from '../../src/gen/rng';
import type { Site } from '../../src/gen/site';
import type { TileGrids } from '../../src/level/tileProps';
import {
    bandAt, fieldOn, sightInputs, buildSightMap, cameraObserver, crewObserver, edgeKey, edgeNow, FACINGS, fixtureWorld, hasLineOfSight, inArc,
    initialState, lineOfSight, npcObserver, profilesOf, sees, seenTiles, sightMap, type Facing, type FixtureWall, type HalfAngle,
    type NpcState, type Observer, type Pos, type ReadonlyWorld, type State
} from '../../src/sim';
import { smallBank } from './helpers';

const P = (x: number, y: number): Pos => ({ x, y });
const at = (world: ReadonlyWorld): State => initialState(world, { seed: 1, crew: [] });
const los = (world: ReadonlyWorld, a: Pos, b: Pos, state = at(world)): boolean => hasLineOfSight(world, state, a, b);
const open = (n: number): string[] => Array.from({ length: n }, () => '.'.repeat(n));

/** A random fixture: full-height objects, desks, walls of soft and glass, doors in every state. */
function randomFixture(rng: Rng, maxSize = 14): { world: ReadonlyWorld; state: State; map: string[] } {
    const w = rng.int(3, maxSize), h = rng.int(3, maxSize);
    const map = Array.from({ length: h }, () => Array.from({ length: w }, () => (rng.chance(0.08) ? 'T' : rng.chance(0.05) ? '#' : '.')).join(''));
    const walls: FixtureWall[] = [];
    let doors = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        for (const b of [P(x + 1, y), P(x, y + 1)]) {
            if (b.x >= w || b.y >= h || !rng.chance(0.14)) continue;
            const wall: FixtureWall = { between: [P(x, y), b], material: rng.chance(0.2) ? 'glass' : 'soft' };
            if (rng.chance(0.25)) wall.door = { id: `d${doors++}`, start: rng.pick(['open', 'closed', 'locked'] as const) };
            walls.push(wall);
        }
    }
    const world = fixtureWorld(map, { walls });
    return { world, state: at(world), map };
}

/** The generator's `Nav` over the same walls and full-height tiles as a World. */
function navOf(world: ReadonlyWorld, state: State, map: readonly string[]): { nav: Nav; tall: (x: number, y: number) => boolean } {
    const { width, height } = world;
    const site = {
        width, height, doors: [],
        owner: Array.from({ length: height }, () => Array<number>(width).fill(0)),
        inside: (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height,
        wallAt: (e: { run: 'eastWest' | 'northSouth'; tx: number; ty: number }) => {
            const wall = edgeNow(world, state, edgeKey(e));
            return wall && { ...e, kind: wall.blocksSight ? 'plaster' : 'window' };
        }
    } as unknown as Site;
    return { nav: new Nav(site, { width, height, blocked: new Uint8Array(width * height), tall: new Uint8Array(width * height), halfCover: new Uint8Array(width * height) } satisfies TileGrids), tall: (x, y) => map[y]![x] === 'T' };
}

/** Whether the exact line between two tile middles passes through a grid corner. */
function throughCorner(a: Pos, b: Pos): boolean {
    const nx = Math.abs(b.x - a.x), ny = Math.abs(b.y - a.y);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if ((2 * i + 1) * ny === (2 * j + 1) * nx) return true;
    return false;
}

/** Whether `Nav.sees`'s sampled walk takes a step that changes both coordinates (where it lets either way round pass). */
function navStepsDiagonally(a: Pos, b: Pos): boolean {
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 3;
    let prev = a;
    for (let i = 1; i <= steps; i++) {
        const t = i / steps, p = P(Math.round(a.x + (b.x - a.x) * t), Math.round(a.y + (b.y - a.y) * t));
        if (p.x !== prev.x && p.y !== prev.y) return true;
        prev = p;
    }
    return false;
}

describe('line of sight', () => {
    it('is symmetric on random fixtures', () => {
        const rng = new Rng(2024);
        let checked = 0, blocked = 0;
        for (let n = 0; n < 60; n++) {
            const { world, state } = randomFixture(rng);
            const m = buildSightMap(world, state);
            for (let ay = 0; ay < world.height; ay++) for (let ax = 0; ax < world.width; ax++) {
                for (let by = ay; by < world.height; by++) for (let bx = 0; bx < world.width; bx++) {
                    const a = P(ax, ay), b = P(bx, by), ab = lineOfSight(m, a, b);
                    if (ab !== lineOfSight(m, b, a)) expect.fail(`(${ax}, ${ay}) and (${bx}, ${by}) disagree on fixture ${n}`);
                    checked++;
                    if (!ab) blocked++;
                }
            }
        }
        expect(checked).toBeGreaterThan(100_000);
        // The fixtures are neither all open nor all walled.
        expect(blocked / checked).toBeGreaterThan(0.2);
        expect(blocked / checked).toBeLessThan(0.8);
    });

    it('sees itself and nothing off the map', () => {
        const world = fixtureWorld(['T.']);
        expect(los(world, P(0, 0), P(0, 0))).toBe(true);
        expect(los(world, P(0, 0), P(2, 0))).toBe(false);
        expect(los(world, P(-1, 0), P(1, 0))).toBe(false);
    });

    it('is blocked by walls and full-height objects, but not at either end, and passes glass', () => {
        const world = fixtureWorld(['..T..', '.....', '.....'], {
            walls: [{ between: [P(2, 1), P(3, 1)] }, { between: [P(2, 2), P(3, 2)], material: 'glass' }]
        });
        expect(los(world, P(0, 0), P(4, 0))).toBe(false); // a shelf between
        expect(los(world, P(0, 0), P(2, 0))).toBe(true); // the shelf itself is seen
        expect(los(world, P(0, 1), P(4, 1))).toBe(false); // a wall
        expect(los(world, P(0, 2), P(4, 2))).toBe(true); // glass
        const teller = fixtureWorld(['...'], { walls: [{ between: [P(0, 0), P(1, 0)], material: 'tellerGlass' }] });
        expect(los(teller, P(0, 0), P(2, 0))).toBe(true);
    });

    it('passes a fence and a railing, which block movement, and only the railing gives half cover', () => {
        const world = fixtureWorld(['...'], { walls: [{ between: [P(0, 0), P(1, 0)], material: 'fence' }, { between: [P(1, 0), P(2, 0)], material: 'rail' }] });
        expect(los(world, P(0, 0), P(2, 0))).toBe(true);
        const [fence, rail] = [world.edges['northSouth 1 0'], world.edges['northSouth 2 0']];
        expect([fence?.blocksMove, fence?.halfCover, rail?.blocksMove, rail?.halfCover]).toEqual([true, undefined, true, true]);
    });

    it('is blocked by a closed or locked door and passes an open or breached one', () => {
        const world = fixtureWorld(['...'], { walls: [{ between: [P(0, 0), P(1, 0)], door: { id: 'door', start: 'closed' } }] });
        const state = at(world);
        const as = (status: State['doors'][string]['status']): State => ({ ...state, doors: { door: { status } } });
        expect(los(world, P(0, 0), P(2, 0), as('closed'))).toBe(false);
        expect(los(world, P(0, 0), P(2, 0), as('locked'))).toBe(false);
        expect(los(world, P(0, 0), P(2, 0), as('jammed'))).toBe(false);
        expect(los(world, P(0, 0), P(2, 0), as('open'))).toBe(true);
        expect(los(world, P(0, 0), P(2, 0), as('breached'))).toBe(true);
        // And back: the reused sight map follows the door.
        expect(los(world, P(0, 0), P(2, 0), as('closed'))).toBe(false);
        // A glass door blocks nothing even closed; a hole knocked in a wall lets sight through.
        const glass = fixtureWorld(['..'], { walls: [{ between: [P(0, 0), P(1, 0)], material: 'glass', door: { id: 'g' } }] });
        expect(los(glass, P(0, 0), P(1, 0))).toBe(true);
        const wall = fixtureWorld(['..'], { walls: [{ between: [P(0, 0), P(1, 0)] }] }), key = edgeKey({ run: 'northSouth', tx: 1, ty: 0 });
        expect(los(wall, P(0, 0), P(1, 0))).toBe(false);
        expect(los(wall, P(0, 0), P(1, 0), { ...at(wall), edges: { [key]: { blocksSight: false } } })).toBe(true);
    });

    it('never exposes someone standing next to a corner (§11.4)', () => {
        // A wall on the east side of column 2, rows 0–2, ending at the corner between tiles (2, 2), (3, 2), (2, 3) and (3, 3).
        const world = fixtureWorld(open(7), { walls: [0, 1, 2].map(y => ({ between: [P(2, y), P(3, y)] as [Pos, Pos] })) });
        const hider = P(2, 2), m = sightMap(world, at(world));
        // Hidden from everywhere round the corner: east of the wall and not below its end.
        for (let y = 0; y <= 3; y++) for (let x = 3; x < 7; x++) expect(lineOfSight(m, P(x, y), hider), `(${x}, ${y})`).toBe(false);
        // Seen once the line clears the end of the wall.
        expect(lineOfSight(m, P(3, 4), hider)).toBe(true);
        expect(lineOfSight(m, P(6, 6), P(2, 3))).toBe(true);
        // The diagonal neighbour across the wall's end: one way round is open, so the generator's Nav would see it.
        const { nav, tall } = navOf(world, at(world), open(7));
        expect(nav.sees(P(3, 3), hider, tall)).toBe(true);
        expect(lineOfSight(m, P(3, 3), hider)).toBe(false);
    });

    it('needs both ways round a corner clear: a pillar touched at its corner hides, one passed beside does not', () => {
        const world = fixtureWorld(['......', '..T...', '......', '......', '......']), m = sightMap(world, at(world));
        // Exactly diagonal past the pillar's corner.
        expect(lineOfSight(m, P(1, 0), P(4, 3))).toBe(false);
        expect(lineOfSight(m, P(3, 0), P(0, 3))).toBe(false);
        expect(lineOfSight(m, P(0, 0), P(4, 4))).toBe(false);
        // A line that meets a corner beside the pillar further along.
        expect(lineOfSight(m, P(0, 2), P(5, 1))).toBe(false);
        // Diagonal with no pillar at its corners.
        expect(lineOfSight(m, P(0, 1), P(3, 4))).toBe(true);
        // Close past the pillar without touching it.
        expect(lineOfSight(m, P(0, 0), P(3, 4))).toBe(true);
        expect(lineOfSight(m, P(5, 3), P(0, 1))).toBe(true);
        // Straight through it.
        expect(lineOfSight(m, P(0, 1), P(5, 1))).toBe(false);
    });

    it('lets a raised observer see over a desk, but not over a wall or a shelf (§14.7)', () => {
        const world = fixtureWorld(['^#.', '^#.', '^T.', '^..'], { walls: [{ between: [P(0, 3), P(1, 3)] }] });
        expect(los(world, P(0, 0), P(2, 0))).toBe(true); // over the desk
        expect(los(world, P(0, 2), P(2, 2))).toBe(false); // the shelf
        expect(los(world, P(0, 3), P(2, 3))).toBe(false); // the wall
        // Low objects block nobody (people stand taller than a desk): a ground observer sees over it too.
        expect(los(world, P(2, 0), P(2, 1))).toBe(true);
        expect(los(world, P(2, 1), P(0, 1))).toBe(true);
    });

    it('agrees with the generator\'s Nav.sees except where Nav lets either way round a corner pass (decision 6)', () => {
        const rng = new Rng(77);
        let same = 0, cornerDiffs = 0, sampleDiffs = 0;
        const compare = (world: ReadonlyWorld, map: readonly string[], pairs: number): void => {
            const state = at(world), m = sightMap(world, state), { nav, tall } = navOf(world, state, map);
            for (let k = 0; k < pairs; k++) {
                const a = P(rng.int(0, world.width - 1), rng.int(0, world.height - 1)), b = P(rng.int(0, world.width - 1), rng.int(0, world.height - 1));
                const mine = lineOfSight(m, a, b), theirs = nav.sees(a, b, tall);
                if (mine === theirs) { same++; continue; }
                // The sight rule is the stricter one, only where Nav's walk steps diagonally: through a corner, or where
                // its floating-point samples of the line change both coordinates at once.
                expect(mine, `(${a.x}, ${a.y}) to (${b.x}, ${b.y})`).toBe(false);
                expect(navStepsDiagonally(a, b), `(${a.x}, ${a.y}) to (${b.x}, ${b.y})`).toBe(true);
                if (throughCorner(a, b)) cornerDiffs++; else sampleDiffs++;
            }
        };
        for (let n = 0; n < 150; n++) {
            const { world, map } = randomFixture(rng, 20);
            compare(world, map, 200);
        }
        // And on the walls of a generated bank.
        const bank = generateBank({ layout: 4242, population: 7 }), tiles = bank.level.tiles;
        const height = tiles.length, width = tiles[0]!.length;
        const seeThrough = new Set(['window', 'doorGlass', 'curtain', 'doorTower', 'rail', 'fence', 'tellerWindow']);
        const walls: FixtureWall[] = bank.level.walls.flatMap(w => {
            const a = w.run === 'northSouth' ? P(w.tx - 1, w.ty) : P(w.tx, w.ty - 1), b = P(w.tx, w.ty);
            if (a.x < 0 || a.y < 0 || b.x >= width || b.y >= height) return [];
            return [{ between: [a, b], material: seeThrough.has(w.kind) ? 'glass' : 'soft' }];
        });
        expect(walls.length).toBeGreaterThan(100);
        const generated = Array.from({ length: height }, () => '.'.repeat(width));
        compare(fixtureWorld(generated, { walls }), generated, 20_000);
        expect(same).toBeGreaterThan(40_000);
        expect(cornerDiffs).toBeGreaterThan(0);
        expect(sampleDiffs).toBeGreaterThan(0);
        // Mostly the same answer.
        expect((cornerDiffs + sampleDiffs) / same).toBeLessThan(0.15);
    });
});

describe('cones', () => {
    const HALVES: HalfAngle[] = [35, 45, 70, 180];

    it('puts every tile within 40 in the same arcs as the true angle, a tile on the edge inside', () => {
        const angleOf = (f: Facing): number => FACINGS.indexOf(f) * 45 - 90;
        for (const facing of FACINGS) for (const half of HALVES) {
            for (let dy = -40; dy <= 40; dy++) for (let dx = -40; dx <= 40; dx++) {
                if (!dx && !dy) { expect(inArc(facing, 0, 0, half)).toBe(true); continue; }
                // Only here, in a test: the rules never use trigonometry.
                let d = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI - angleOf(facing)) % 360;
                if (d > 180) d = 360 - d;
                const expected = d <= half + 1e-9;
                if (inArc(facing, dx, dy, half) !== expected) expect.fail(`${facing} ${half}° (${dx}, ${dy}) is ${d}°`);
                // Only 45° (and 180°) ever has a tile exactly on its edge.
                if (Math.abs(d - half) < 1e-9) expect([45, 180]).toContain(half);
            }
        }
    });

    it('decides the documented edge cases', () => {
        expect(inArc('e', 3, 3, 45)).toBe(true); // exactly on the Core edge: inside
        expect(inArc('e', 3, -3, 45)).toBe(true);
        expect(inArc('e', 3, 4, 45)).toBe(false);
        expect(inArc('ne', 0, -5, 45)).toBe(true); // a diagonal facing's Core edges are the axes
        expect(inArc('ne', -1, -5, 45)).toBe(false);
        expect(inArc('e', 1, 2, 70)).toBe(true); // 63.4°
        expect(inArc('e', 1, 3, 70)).toBe(false); // 71.6°
        expect(inArc('e', 10, 7, 35)).toBe(true); // 34.99°
        expect(inArc('e', 7, 5, 35)).toBe(false); // 35.5°
        expect(inArc('e', 0, 3, 70)).toBe(false);
        expect(inArc('e', -3, 0, 180)).toBe(true);
    });

    const world = fixtureWorld(open(25));
    const look = (name: 'calm' | 'alerted' | 'camera' | 'darkCamera' | 'crew', facing: Facing = 'e'): Observer => ({ pos: P(12, 12), facing, profile: profilesOf(world)[name] });
    const band = (o: Observer, dx: number, dy: number, w = world): string | null => sees(w, at(w), o, P(o.pos.x + dx, o.pos.y + dy));

    it('gives calm NPCs a Core of 6 tiles and 90°, a Peripheral of 8 and 140°, by Euclidean distance', () => {
        const calm = look('calm');
        expect([0, 1, 6, 7, 8, 9].map(d => band(calm, d, 0))).toEqual(['core', 'core', 'core', 'peripheral', 'peripheral', null]);
        expect(band(calm, 4, 4)).toBe('core'); // 32 ≤ 36, on the 45° edge
        expect(band(calm, 5, 4)).toBe('peripheral'); // 41 > 36
        expect(band(calm, 5, 6)).toBe('peripheral'); // 50°, 61 ≤ 64
        expect(band(calm, 6, 6)).toBe(null); // 72 > 64
        expect(band(calm, 2, 4)).toBe('peripheral'); // 63.4°
        expect(band(calm, 1, 4)).toBe(null); // 76°
        expect(band(calm, -1, 0)).toBe(null); // behind
        expect(band(look('calm', 'sw'), -4, 4)).toBe('core');
    });

    it('lets Alerted NPCs see 2 further and Peripheral as Core (§8.7)', () => {
        expect(world.rules.alertedRangeBonus).toBe(2);
        const alerted = look('alerted');
        expect([8, 9, 10, 11].map(d => band(alerted, d, 0))).toEqual(['core', 'core', 'core', null]);
        expect(band(alerted, 2, 4)).toBe('core');
        expect(band(alerted, 1, 4)).toBe(null);
    });

    it('gives cameras a Core of 7 tiles and 70°, and crew all round to 10', () => {
        const camera = look('camera');
        expect([7, 8].map(d => band(camera, d, 0))).toEqual(['core', null]);
        expect(band(camera, 5, 3)).toBe('core'); // 31°
        expect(band(camera, 4, 3)).toBe(null); // 36.9°
        const crew = look('crew');
        expect([band(crew, -10, 0), band(crew, 0, 10), band(crew, 6, -8), band(crew, -7, -8), band(crew, 11, 0)]).toEqual(['core', 'core', 'core', null, null]);
    });

    it('halves every range on a dark tile, rounded down', () => {
        const dark: Pos[] = [];
        for (let x = 0; x < 25; x++) dark.push(P(x, 12));
        const dim = fixtureWorld(open(25), { dark });
        const o = (name: 'calm' | 'alerted' | 'camera' | 'darkCamera' | 'crew'): Observer => ({ pos: P(12, 12), facing: 'e', profile: profilesOf(dim)[name] });
        expect([3, 4, 5].map(d => band(o('calm'), d, 0, dim))).toEqual(['core', 'peripheral', null]);
        expect([5, 6].map(d => band(o('alerted'), d, 0, dim))).toEqual(['core', null]);
        // Cameras below Regional HQ are blind in the dark; the rest see half as far.
        expect([1, 3, 4].map(d => band(o('camera'), d, 0, dim))).toEqual([null, null, null]);
        expect([3, 4].map(d => band(o('darkCamera'), d, 0, dim))).toEqual(['core', null]);
        expect(band(o('camera'), 5, 1, dim)).toBe('core');
        expect([-5, -6].map(d => band(o('crew'), d, 0, dim))).toEqual(['core', null]);
        // A lit tile next to the dark row is seen as far as ever.
        expect(band(o('calm'), 5, 1, dim)).toBe('core');
    });

    it('needs a clear line as well as an arc', () => {
        const walled = fixtureWorld(open(25), { walls: [{ between: [P(14, 12), P(15, 12)] }] });
        const calm = { pos: P(12, 12), facing: 'e' as Facing, profile: profilesOf(walled).calm };
        expect(band(calm, 2, 0, walled)).toBe('core');
        expect(band(calm, 3, 0, walled)).toBe(null);
    });
});

describe('observers', () => {
    const npc = (status: NpcState['status'], facing: Facing = 's', alerted = false): NpcState => ({
        id: 'guard', pos: P(4, 0), facing, status, suspicion: {}, exposedTo: [], intent: { path: [] }, alerted,
        alertCause: null, warned: [], challenges: [], wants: [], lastSeen: {}
    });

    it('build NPCs, cameras and crew from the state', () => {
        const world = fixtureWorld(open(9), { cameras: [{ id: 'cam', pos: P(0, 0), facings: ['e', 's'], room: null }] });
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(8, 8), facing: 'n' }] });
        expect(npcObserver(world, npc('calm'))!.profile.name).toBe('calm');
        expect(npcObserver(world, npc('curious'))!.profile.name).toBe('calm');
        // Alerted is a flag of its own (§8.7): a commanded guard stays on edge, a status alone doesn't make one.
        expect(npcObserver(world, npc('calm', 's', true))!.profile.name).toBe('alerted');
        expect(npcObserver(world, npc('commanded', 's', true))!.profile.name).toBe('alerted');
        expect(npcObserver(world, npc('hostile'))!.profile.name).toBe('calm');
        expect(npcObserver(world, npc('unconscious'))).toBeNull();
        expect(npcObserver(world, npc('dead'))).toBeNull();

        const now = cameraObserver(world, state, 'cam')!, next = cameraObserver(world, state, 'cam', true)!;
        expect([now.facing, next.facing]).toEqual(['e', 's']);
        expect(sees(world, state, now, P(6, 0))).toBe('core');
        expect(sees(world, state, now, P(0, 6))).toBe(null);
        expect(sees(world, state, next, P(0, 6))).toBe('core');
        const panned = { ...state, cameras: { cam: { facing: 1, live: true } } };
        expect([cameraObserver(world, panned, 'cam')!.facing, cameraObserver(world, panned, 'cam', true)!.facing]).toEqual(['s', 'e']);
        expect(cameraObserver(world, { ...state, cameras: { cam: { facing: 0, live: false } } }, 'cam')).toBeNull();
        expect(cameraObserver(world, state, 'nope')).toBeNull();

        const crew = crewObserver(world, state.crew[0]!);
        expect(sees(world, state, crew, P(8, 0))).toBe('core'); // behind its facing: crew see all round
    });

    it('list exactly the tiles the single check sees, the same every time', () => {
        const rng = new Rng(9);
        for (let n = 0; n < 20; n++) {
            const { world, state } = randomFixture(rng);
            for (const alerted of [false, true]) {
                const o = npcObserver(world, { ...npc('calm', rng.pick(FACINGS), alerted), pos: P(rng.int(0, world.width - 1), rng.int(0, world.height - 1)) })!;
                const field = seenTiles(world, state, o), listed = new Set(field.tiles.map(p => `${p.x},${p.y}`));
                expect(seenTiles(world, state, o)).toBe(field);
                for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
                    const single = sees(world, state, o, P(x, y));
                    expect(bandAt(field, P(x, y))).toBe(single);
                    expect(listed.has(`${x},${y}`)).toBe(single !== null);
                }
                // Row by row from the north-west.
                const order = field.tiles.map(p => p.y * world.width + p.x);
                expect(order).toEqual([...order].sort((a, b) => a - b));
                expect(field.tiles[0]).toBeDefined();
            }
        }
    });
});

describe('more sight rules', () => {
    it('hides someone beside a doorway from a line that grazes the door jamb', () => {
        // A wall between columns 2 and 3, with an open door in row 2.
        const walls: FixtureWall[] = [0, 1, 2, 3, 4].map(y => ({ between: [P(2, y), P(3, y)], ...(y === 2 ? { door: { id: 'door', start: 'open' as const } } : {}) }));
        const world = fixtureWorld(open(6).slice(0, 5), { walls }), state = at(world), m = sightMap(world, state);
        expect(lineOfSight(m, P(0, 2), P(5, 2))).toBe(true); // straight through the doorway
        expect(lineOfSight(m, P(2, 2), P(3, 1))).toBe(false); // round the jamb, diagonally
        expect(lineOfSight(m, P(2, 2), P(3, 3))).toBe(false);
        expect(lineOfSight(m, P(1, 0), P(4, 3))).toBe(false); // exactly through the jamb's corner
        expect(lineOfSight(m, P(1, 1), P(4, 3))).toBe(true); // through the doorway off the corners
        const shut = { ...state, doors: { door: { status: 'closed' as const } } };
        expect(hasLineOfSight(world, shut, P(0, 2), P(5, 2))).toBe(false);
    });

    it('lets something of middle height block the ground but not a line with a raised end', () => {
        const world = fixtureWorld(['.....', '^....', '....^'], {
            midHeight: [P(2, 0)],
            walls: [{ between: [P(1, 1), P(2, 1)], midHeight: true }, { between: [P(1, 2), P(2, 2)], midHeight: true, door: { id: 'gate', start: 'closed' } }]
        });
        const state = at(world), m = sightMap(world, state);
        expect(lineOfSight(m, P(0, 0), P(4, 0))).toBe(false); // a van between two people on the ground
        expect(lineOfSight(m, P(0, 0), P(2, 0))).toBe(true); // the van itself is seen
        expect(lineOfSight(m, P(0, 1), P(4, 1))).toBe(true); // from a raised tile over a middle-height edge
        expect(lineOfSight(m, P(4, 1), P(0, 1))).toBe(true); // and back: the ground sees a raised tile over it
        expect(lineOfSight(m, P(1, 1), P(3, 1))).toBe(false); // ground to ground
        expect(lineOfSight(m, P(0, 2), P(4, 2))).toBe(true); // raised end
        expect(lineOfSight(m, P(0, 2), P(3, 2))).toBe(false);
        expect(lineOfSight(sightMap(world, { ...state, doors: { gate: { status: 'open' } } }), P(0, 2), P(3, 2))).toBe(true);
    });

    it('rebuilds the sight map when any of its inputs changes, and reuses it while none does', () => {
        const { world, state } = smallBank();
        const base = sightMap(world, state);
        expect(sightMap(world, structuredClone(state))).toBe(base);
        const door = { ...state, doors: { ...state.doors, staffDoor: { status: 'open' as const } } };
        const edge = { ...state, edges: { [edgeKey({ run: 'northSouth', tx: 6, ty: 0 })]: { blocksSight: false } } };
        const keys = new Set([state, door, edge].map(s => sightInputs(world, s)));
        expect(keys.size).toBe(3);
        expect(sightMap(world, door)).not.toBe(base);
        expect(lineOfSight(sightMap(world, door), P(5, 1), P(6, 1))).toBe(true);
        expect(sightMap(world, edge)).not.toBe(base);
        expect(lineOfSight(sightMap(world, edge), P(5, 0), P(6, 0))).toBe(true);
        // Up to four maps are kept: a preview alternating with the real state rebuilds neither.
        expect(sightMap(world, state)).toBe(base);
        expect(lineOfSight(sightMap(world, state), P(5, 0), P(6, 0))).toBe(false);
    });

    it('caches fields by the profile itself, and hands them out frozen', () => {
        const world = fixtureWorld(open(12)), state = at(world), m = sightMap(world, state);
        const calm = profilesOf(world).calm, narrow = { ...calm, arcs: [{ band: 'core' as const, range: 2, half: 45 as const }] };
        const wide = fieldOn(m, { pos: P(6, 6), facing: 'e', profile: calm }), small = fieldOn(m, { pos: P(6, 6), facing: 'e', profile: narrow });
        expect(small).not.toBe(wide);
        expect(small.tiles.length).toBeLessThan(wide.tiles.length);
        expect(Object.isFrozen(wide) && Object.isFrozen(wide.tiles) && Object.isFrozen(wide.tiles[0])).toBe(true);
        expect(() => { (wide.tiles as Pos[]).push(P(0, 0)); }).toThrow();
    });

    it('takes a camera\'s night vision from its definition', () => {
        const cameras = [{ id: 'cheap', pos: P(0, 0), facings: ['e'] as ['e'], room: null }, { id: 'hq', pos: P(0, 1), facings: ['e'] as ['e'], room: null, seesInDark: true }];
        const world = fixtureWorld(['......', '......'], { cameras, dark: [P(2, 0), P(2, 1)] });
        const state = at(world);
        expect(sees(world, state, cameraObserver(world, state, 'cheap')!, P(2, 0))).toBe(null);
        expect(sees(world, state, cameraObserver(world, state, 'cheap')!, P(4, 0))).toBe('core');
        expect(sees(world, state, cameraObserver(world, state, 'hq')!, P(2, 1))).toBe('core');
    });
});
