import { describe, expect, it } from 'vitest';
import { scouted } from './helpers';
import {
    commit, fixtureWorld, HEAVY_ARMOUR_ITEM, IllegalCommand, initialState, moveBudget, pathTo, preview, reachable, reachAt,
    stepCost, validatePath, type FixtureWall, type PersonDef, type Pos, type ReadonlyWorld, type State
} from '../../src/sim';

const P = (x: number, y: number): Pos => ({ x, y });
const npc = (id: string, pos: Pos): PersonDef => ({ id, name: id, role: 'clerk', observer: 'staff', pos, facing: 's', schedule: [] });
const open = (w: number, h: number): string[] => Array.from({ length: h }, () => '.'.repeat(w));

function setup(map: readonly string[], walls: FixtureWall[] = [], crew: { id: string; pos: Pos; items?: string[] }[] = [{ id: 'jun', pos: P(0, 0) }], people: PersonDef[] = []): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(map, { walls, people });
    // Scouted, so a move that reveals nothing stays undoable (what the crew learns is rules/knowledge.ts's, tested there).
    return { world, state: scouted(world, initialState(world, { seed: 1, crew })) };
}

/** Octile distance in half-steps: what an open floor should cost. */
const octile = (a: Pos, b: Pos): number => {
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
    return 3 * Math.min(dx, dy) + 2 * (Math.max(dx, dy) - Math.min(dx, dy));
};

describe('movement costs', () => {
    it.each([
        ['orthogonal', P(4, 3), 2],
        ['diagonal', P(4, 4), 3],
        ['two diagonals', P(5, 5), 6],
        ['diagonal and straight', P(5, 4), 5],
        ['three diagonals (4.5 tiles)', P(6, 6), 9],
        ['five straight', P(8, 3), 10]
    ])('%s', (_, to, cost) => {
        const { world, state } = setup(open(11, 11), [], [{ id: 'jun', pos: P(3, 3) }]);
        expect(reachAt(reachable(world, state, P(3, 3), 10), to)?.cost).toBe(cost);
    });

    it('reaches exactly the tiles within 5 tiles of octile cost on open floor', () => {
        const { world, state } = setup(open(13, 13), [], [{ id: 'jun', pos: P(6, 6) }]);
        const reach = reachable(world, state, P(6, 6), 10);
        const expected: string[] = [];
        for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) if (octile(P(6, 6), P(x, y)) <= 10) expected.push(`${x},${y}`);
        expect(reach.tiles.map(t => `${t.pos.x},${t.pos.y}`).sort()).toEqual(expected.sort());
        for (const t of reach.tiles) expect(t.cost).toBe(octile(P(6, 6), t.pos));
        // Four diagonals are 6 tiles: out of a Move's reach.
        expect(reachAt(reach, P(10, 10))).toBeUndefined();
    });
});

describe('walls and corners', () => {
    // A wall on the edge between (0,0) and (0,1) that ends at the corner the four tiles (0..1, 0..1) share.
    const stub: FixtureWall[] = [{ between: [P(0, 0), P(0, 1)] }];

    it.each([
        ['through the wall', P(0, 0), P(0, 1), undefined],
        ['cutting the corner where it ends', P(0, 0), P(1, 1), undefined],
        ['cutting the same corner the other way', P(1, 0), P(0, 1), undefined],
        ['beside the wall', P(1, 0), P(1, 1), 2],
        ['a diagonal clear of it', P(1, 1), P(2, 2), 3],
        ['round its end', P(1, 1), P(0, 1), 2]
    ])('%s', (_, a, b, cost) => {
        const { world, state } = setup(open(3, 3), stub);
        expect(stepCost(world, state, a, b)).toBe(cost);
    });

    it('goes round the end of a wall at the cost of the detour', () => {
        const { world, state } = setup(open(3, 3), stub);
        expect(reachAt(reachable(world, state, P(0, 0), 10), P(0, 1))?.cost).toBe(6);
    });

    it('treats doors by their state, and never cuts through a door frame', () => {
        const door = (start: 'open' | 'closed' | 'locked'): FixtureWall[] => [{ between: [P(0, 0), P(0, 1)], door: { id: 'd', lock: 'mechanical', start } }];
        const shut = setup(open(3, 3), door('closed')), opened = setup(open(3, 3), door('open'));
        expect(stepCost(shut.world, shut.state, P(0, 0), P(0, 1))).toBeUndefined();
        expect(stepCost(opened.world, opened.state, P(0, 0), P(0, 1))).toBe(2);
        expect(stepCost(opened.world, opened.state, P(0, 0), P(1, 1))).toBeUndefined();
        // Who may pass a closed or locked door is the caller's to say; a jammed door never opens.
        const locked = setup(open(3, 3), door('locked'));
        const withKey = { canPassDoor: () => true };
        expect(stepCost(locked.world, locked.state, P(0, 0), P(0, 1), withKey)).toBe(2);
        locked.state.doors.d = { status: 'jammed' };
        expect(stepCost(locked.world, locked.state, P(0, 0), P(0, 1), withKey)).toBeUndefined();
        locked.state.doors.d = { status: 'breached' };
        expect(stepCost(locked.world, locked.state, P(0, 0), P(0, 1))).toBe(2);
        // A breached door leaves no frame to catch on.
        expect(stepCost(locked.world, locked.state, P(0, 0), P(1, 1))).toBe(3);
    });

    it('steps through a hole made in a wall', () => {
        const { world, state } = setup(open(3, 3), stub);
        state.edges['eastWest 0 1'] = { blocksMove: false, blocksSight: false };
        expect(stepCost(world, state, P(0, 0), P(0, 1))).toBe(2);
    });

    it('never enters furniture, but may pass its corner', () => {
        const { world, state } = setup(['...', '.#.', '...']);
        expect(stepCost(world, state, P(0, 1), P(1, 1))).toBeUndefined();
        expect(stepCost(world, state, P(0, 1), P(1, 0))).toBe(3);
    });
});

describe('height (§14.7)', () => {
    // Stairs at (1,1) lead east onto the raised (2,1); the ladder at (2,2) leads north onto it too.
    const map = ['..^^', './^.', '..H.'];

    it.each([
        ['floor to raised floor', P(1, 0), P(2, 0), undefined],
        ['floor to raised floor beside the stairs', P(3, 1), P(2, 1), undefined],
        ['floor to stairs', P(0, 1), P(1, 1), 2],
        ['stairs up', P(1, 1), P(2, 1), 2],
        ['stairs down', P(2, 1), P(1, 1), 2],
        ['along raised floor', P(2, 0), P(3, 0), 2],
        ['stairs up diagonally', P(1, 1), P(2, 0), undefined],
        ['ladder up', P(2, 2), P(2, 1), 2],
        ['off the ladder sideways', P(2, 2), P(3, 2), 2]
    ])('%s', (_, a, b, cost) => {
        const { world, state } = setup(map);
        expect(stepCost(world, state, a, b)).toBe(cost);
    });

    it('gives each climb tile the one raised tile it leads to', () => {
        const { world } = setup(map);
        expect(world.tiles[1 * 4 + 1]!.climb).toEqual({ kind: 'stairs', to: 'e' });
        expect(world.tiles[2 * 4 + 2]!.climb).toEqual({ kind: 'ladder', to: 'n' });
        expect(() => fixtureWorld(['^/^'])).toThrow(/exactly one raised neighbour/);
        expect(() => fixtureWorld(['./.'])).toThrow(/exactly one raised neighbour/);
    });
});

describe('people', () => {
    const line = (): { world: ReadonlyWorld; state: State } =>
        setup(['......'], [], [{ id: 'jun', pos: P(0, 0) }, { id: 'mara', pos: P(1, 0) }], [npc('guard', P(3, 0)), npc('cleaner', P(4, 0))]);

    it('passes through crew but never ends on them, and never passes a standing NPC', () => {
        const { world, state } = line();
        const reach = reachable(world, state, P(0, 0), 10, { mover: 'jun' });
        expect(reachAt(reach, P(1, 0))?.canEnd).toBe(false);
        expect(reachAt(reach, P(2, 0))?.canEnd).toBe(true);
        expect(reachAt(reach, P(3, 0))).toBeUndefined();
        expect(reachAt(reach, P(5, 0))).toBeUndefined();
        expect(pathTo(reach, P(1, 0))).toBeUndefined();
        expect(pathTo(reach, P(2, 0))).toEqual([P(1, 0), P(2, 0)]);
    });

    it('lets an NPC pass NPCs but not crew', () => {
        const { world, state } = line();
        const reach = reachable(world, state, P(3, 0), 10, { mover: 'guard' });
        expect(reachAt(reach, P(4, 0))?.canEnd).toBe(false);
        expect(reachAt(reach, P(5, 0))?.canEnd).toBe(true);
        expect(reachAt(reach, P(2, 0))?.canEnd).toBe(true);
        expect(reachAt(reach, P(1, 0))).toBeUndefined();
    });

    it('steps over an NPC lying down', () => {
        const { world, state } = line();
        state.npcs[0]!.status = 'tied';
        const reach = reachable(world, state, P(0, 0), 10, { mover: 'jun' });
        expect(reachAt(reach, P(3, 0))?.canEnd).toBe(false);
        expect(reachAt(reach, P(4, 0))).toBeUndefined();
        expect(validatePath(world, state, P(0, 0), [P(1, 0), P(2, 0), P(3, 0)], 10, { mover: 'jun' })).toMatchObject({ ok: false, at: 2 });
    });
});

describe('paths', () => {
    it('breaks ties the same way every time', () => {
        const { world, state } = setup(open(6, 6));
        const a = reachable(world, state, P(0, 0), 10), b = reachable(world, state, P(0, 0), 10);
        expect(a.tiles).toEqual(b.tiles);
        // Two cheapest paths of 2.5 tiles each: the tile settled first wins (cost, then row-major, then n, ne, e, …).
        expect(pathTo(a, P(2, 1))).toEqual([P(1, 0), P(2, 1)]);
        expect(pathTo(a, P(1, 2))).toEqual([P(0, 1), P(1, 2)]);
        expect(pathTo(a, P(4, 2))).toEqual([P(1, 0), P(2, 0), P(3, 1), P(4, 2)]);
        // A dragged path may take the other one.
        expect(validatePath(world, state, P(0, 0), [P(1, 1), P(2, 1)], 10)).toEqual({ ok: true, cost: 5 });
    });

    it.each([
        ['an empty path', [], 0],
        ['a jump', [P(2, 0)], 0],
        ['off the map', [P(-1, 0)], 0],
        ['too far for a Move', [P(1, 1), P(2, 2), P(3, 3), P(4, 4)], 3]
    ])('refuses %s', (_, path, at) => {
        const { world, state } = setup(open(6, 6));
        expect(validatePath(world, state, P(0, 0), path, 10)).toMatchObject({ ok: false, at });
    });
});

describe('the move and dash commands', () => {
    const corridor = (items: string[] = []): { world: ReadonlyWorld; state: State } =>
        setup(['.............'], [], [{ id: 'jun', pos: P(0, 0), items }], [npc('teller', P(12, 0))]);
    const along = (n: number): Pos[] => Array.from({ length: n }, (_, i) => P(i + 1, 0));

    it('moves up to 5 tiles for 1 action, undoably', () => {
        const { world, state } = corridor();
        const result = commit(world, state, { type: 'move', crew: 'jun', path: along(5) });
        expect(result.state.crew[0]!.pos).toEqual(P(5, 0));
        expect(result.state.crew[0]!.actionsLeft).toBe(1);
        expect(result.state.crew[0]!.facing).toBe('e');
        expect(result.events).toEqual([{ type: 'moved', crew: 'jun', from: P(0, 0), to: P(5, 0), path: along(5) }]);
        expect(result.undoable).toBe(true);
        expect(() => commit(world, state, { type: 'move', crew: 'jun', path: along(6) })).toThrow(IllegalCommand);
    });

    it('moves 4 tiles in heavy armour, and refuses to dash', () => {
        const { world, state } = corridor([HEAVY_ARMOUR_ITEM]);
        expect(moveBudget(world, state.crew[0]!)).toBe(8);
        expect(commit(world, state, { type: 'move', crew: 'jun', path: along(4) }).state.crew[0]!.pos).toEqual(P(4, 0));
        expect(() => commit(world, state, { type: 'move', crew: 'jun', path: along(5) })).toThrow(IllegalCommand);
        expect(() => commit(world, state, { type: 'dash', crew: 'jun', path: along(2) })).toThrow(/heavy armour/);
    });

    it('dashes up to 10 tiles for 2 actions, with a quiet noise of radius 2 along its path', () => {
        const { world, state } = corridor();
        const result = commit(world, state, { type: 'dash', crew: 'jun', path: along(10) });
        expect(result.state.crew[0]!.pos).toEqual(P(10, 0));
        expect(result.state.crew[0]!.actionsLeft).toBe(0);
        expect(result.events.slice(1)).toEqual([
            { type: 'noise', sources: along(10), radius: 2, kind: 'quiet', cause: 'dash jun', heard: ['teller'] },
            { type: 'heard', cause: 'dash jun', kind: 'quiet', npcs: ['teller'] }
        ]);
        // Someone heard it: it can't be taken back.
        expect(result.undoable).toBe(false);
        expect(preview(world, state, { type: 'dash', crew: 'jun', path: along(10) }).events).toEqual(result.events);
        expect(() => commit(world, state, { type: 'dash', crew: 'jun', path: along(11) })).toThrow(IllegalCommand);
        const short = commit(world, state, { type: 'dash', crew: 'jun', path: along(3) });
        expect(short.events.slice(1)).toEqual([{ type: 'noise', sources: along(3), radius: 2, kind: 'quiet', cause: 'dash jun', heard: [] }]);
        expect(short.undoable).toBe(true);
        const tired = commit(world, state, { type: 'move', crew: 'jun', path: along(1) }).state;
        expect(() => commit(world, tired, { type: 'dash', crew: 'jun', path: [P(2, 0)] })).toThrow(/actions left/);
    });

    it('is heard from every tile of the dash, not only where it ends', () => {
        // The clerk stands beside the start; the dash ends 8 tiles away.
        const world = fixtureWorld(['..........', '..........'], { people: [npc('clerk', P(1, 1))] });
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] });
        const result = commit(world, state, { type: 'dash', crew: 'jun', path: along(8) });
        expect(result.events.at(-1)).toEqual({ type: 'heard', cause: 'dash jun', kind: 'quiet', npcs: ['clerk'] });
    });

    // TODO(M2 carrying): register the 'heavyLoot' dash check (registerDashCheck) and fill this in.
    it.skip('refuses to dash carrying Heavy loot (§6.3)', () => {});
});

describe('doors on the way', () => {
    const room = (start: 'closed' | 'locked', lock: 'none' | 'mechanical' = 'none'): { world: ReadonlyWorld; state: State } =>
        setup(open(4, 2), [{ between: [P(1, 0), P(2, 0)], door: { id: 'd', lock, start } }]);

    it('opens a closed door it walks through, and refuses a locked one without the key', () => {
        const { world, state } = room('closed');
        const result = commit(world, state, { type: 'move', crew: 'jun', path: [P(1, 0), P(2, 0), P(3, 0)] });
        expect(result.state.doors.d!.status).toBe('open');
        expect(result.events[0]).toEqual({ type: 'doorOpened', door: 'd', by: 'jun' });
        expect(result.undoable).toBe(true);
        const locked = room('locked', 'mechanical');
        expect(() => commit(locked.world, locked.state, { type: 'move', crew: 'jun', path: [P(1, 0), P(2, 0)] })).toThrow(IllegalCommand);
    });

    it('swings shut at the end of the world phase, unless propped or someone stands in the doorway', () => {
        const { world, state } = room('closed', 'mechanical');
        const through = commit(world, state, { type: 'move', crew: 'jun', path: [P(1, 0), P(2, 0), P(3, 0)] }).state;
        const shut = commit(world, through, { type: 'endTurn' });
        expect(shut.state.doors.d!.status).toBe('locked');
        expect(shut.events).toContainEqual({ type: 'doorClosed', door: 'd' });
        const doorway = commit(world, state, { type: 'move', crew: 'jun', path: [P(1, 0), P(2, 0)] }).state;
        expect(commit(world, doorway, { type: 'endTurn' }).state.doors.d!.status).toBe('open');
        const propped = { ...through, doors: { d: { status: 'open' as const, propped: true } } };
        expect(commit(world, propped, { type: 'endTurn' }).state.doors.d!.status).toBe('open');
    });
});
