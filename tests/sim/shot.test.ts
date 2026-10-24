import { describe, expect, it } from 'vitest';
import {
    atan2Deg, commit, fixtureWorld, initialState, leanOptions, preview, PreviewRollError, previewShot, resolveShot, rotate, sinCosDeg, traceShot,
    type FixtureOptions, type NpcStatus, type PersonDef, type Pos, type ReadonlyWorld, type Shot, type ShotRolls, type ShotTrace, type State
} from '../../src/sim';
import { registerTestCommand, testCommand } from './helpers';

const P = (x: number, y: number): Pos => ({ x, y });

const person = (id: string, pos: Pos, role = 'customer', observer: PersonDef['observer'] = 'civilian'): PersonDef => ({
    id, name: id, role, observer, pos, facing: 's', schedule: []
});

/** A world from a map, with jun (the shooter) and NPCs, some of them in a given status. */
function setup(map: string[], options: FixtureOptions & { jun?: Pos; items?: string[]; status?: Record<string, NpcStatus> } = {}): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(map, options);
    const state = initialState(world, { seed: 7, crew: [{ id: 'jun', pos: options.jun ?? P(0, 1), items: options.items ?? [] }, { id: 'mara', pos: P(0, map.length - 1) }] });
    for (const [id, status] of Object.entries(options.status ?? {})) state.npcs.find(n => n.id === id)!.status = status;
    return { world, state };
}

const OPEN = ['..............', '..............', '..............'];

/** Points that send every bullet straight down the aim line, and no cover rolls. */
const straight = (n: number, covers: number[] = []): ShotRolls => ({ points: Array.from({ length: n }, () => 0.5), covers });

const hitsOf = (t: ShotTrace): Record<string, number> => Object.fromEntries(t.hits.map(h => [h.id, h.damage]));

describe('angles without Math.sin', () => {
    it('agree with the built-in functions', () => {
        for (let d = -360; d <= 360; d += 7.3) {
            const [s, c] = sinCosDeg(d);
            expect(s).toBeCloseTo(Math.sin((d * Math.PI) / 180), 14);
            expect(c).toBeCloseTo(Math.cos((d * Math.PI) / 180), 14);
        }
        for (const [y, x] of [[1, 2], [-3, 1], [0, -1], [-1, -1], [5, 0], [0.25, 7]] as const) {
            expect(atan2Deg(y, x)).toBeCloseTo((Math.atan2(y, x) * 180) / Math.PI, 12);
        }
        expect(rotate(1, 0, 0)).toEqual([1, 0]);
    });
});

describe('the bullet trace', () => {
    const shot = (at: Pos, extra: Partial<Shot> = {}): Shot => ({ shooter: 'jun', weapon: 'pistol', at, ...extra });

    it('hits the first standing body on the line, and passes over lying ones', () => {
        const { world, state } = setup(OPEN, { people: [person('guard', P(6, 1), 'lobbyGuard', 'enforcer'), person('cust', P(3, 1))], status: { cust: 'commanded' } });
        const t = traceShot(world, state, shot(P(6, 1)), straight(2));
        expect(hitsOf(t)).toEqual({ guard: 6 });
        expect(t.bullets.map(b => b.stop)).toEqual(['body', 'body']);
        // Aimed at the one lying down, it is hit.
        expect(hitsOf(traceShot(world, state, shot(P(3, 1), { target: 'cust' }), straight(2)))).toEqual({ cust: 6 });
        // Standing up, the customer is in the way.
        state.npcs.find(n => n.id === 'cust')!.status = 'calm';
        expect(hitsOf(traceShot(world, state, shot(P(6, 1)), straight(2)))).toEqual({ cust: 6 });
    });

    it('is half a tile wide: a bullet off its arc keeps flying to range', () => {
        const { world, state } = setup(['......................', '......................', '......................'], { people: [person('guard', P(9, 1), 'lobbyGuard', 'enforcer')] });
        // 9 tiles away the guard covers ±1.6°; bullet 1's arc is ±2.5°.
        const t = traceShot(world, state, shot(P(9, 1)), { points: [0, 0.5], covers: [] });
        expect(t.bullets[0]!.stop).toBe('range');
        expect(t.bullets[0]!.end.x).toBeCloseTo(12, 0);
        expect(t.bullets[1]!.stop).toBe('body');
    });

    it('shatters glass, is stopped by teller glass below Pierce 3, slowed by Soft walls and stopped by Reinforced ones', () => {
        const wall = (material: 'glass' | 'tellerGlass' | 'soft' | 'reinforced') => setup(OPEN, {
            walls: [{ between: [P(2, 1), P(3, 1)], material }], people: [person('cust', P(5, 1))]
        });
        let s = wall('glass');
        let t = traceShot(s.world, s.state, shot(P(5, 1)), straight(2));
        expect(t.bullets[0]!.steps[0]).toMatchObject({ kind: 'wall', material: 'glass', effect: 'shattered' });
        expect(t.bullets[1]!.steps[0]).toMatchObject({ kind: 'body', id: 'cust' });
        expect(t.shattered).toEqual(['northSouth 3 1']);
        s = wall('tellerGlass');
        t = traceShot(s.world, s.state, shot(P(5, 1)), straight(2));
        expect(t.hits).toEqual([]);
        expect(hitsOf(traceShot(s.world, s.state, shot(P(5, 1), { weapon: 'dmr' }), straight(1)))).toEqual({ cust: 13 });
        s = wall('soft');
        expect(hitsOf(traceShot(s.world, s.state, shot(P(5, 1)), straight(2)))).toEqual({});
        expect(hitsOf(traceShot(s.world, s.state, shot(P(5, 1), { weapon: 'assaultRifle' }), straight(3)))).toEqual({ cust: 9 });
        s = wall('reinforced');
        expect(hitsOf(traceShot(s.world, s.state, shot(P(5, 1), { weapon: 'dmr' }), straight(1)))).toEqual({});
    });

    it('shatters teller glass at its 4th hit', () => {
        const { world, state } = setup(OPEN, { walls: [{ between: [P(2, 1), P(3, 1)], material: 'tellerGlass' }], people: [person('cust', P(5, 1))] });
        const t = traceShot(world, state, shot(P(5, 1), { weapon: 'machinePistol' }), straight(6));
        expect(t.bullets.map(b => b.stop)).toEqual(['wall', 'wall', 'wall', 'wall', 'body', 'body']);
        expect(t.bullets[3]!.steps[0]).toMatchObject({ effect: 'stopped', broke: true });
    });

    it('overpenetrates the first body with Pierce 3, and armour and precision change what is dealt', () => {
        const { world, state } = setup(OPEN, {
            people: [person('cust', P(3, 1)), person('guard', P(6, 1), 'lobbyGuard', 'enforcer')], rules: { guardArmour: 1 }, status: { guard: 'alerted' }
        });
        // 9 to the calm customer ×1.5; 6 left for the alerted guard, armour 1 below Pierce 3.
        expect(hitsOf(traceShot(world, state, shot(P(6, 1), { weapon: 'dmr' }), straight(1)))).toEqual({ cust: 13, guard: 6 });
        state.npcs.find(n => n.id === 'cust')!.status = 'commanded';
        // Pistol: 3 − (1 − 0) a bullet; the assault rifle's Pierce 1 meets armour 1.
        expect(hitsOf(traceShot(world, state, shot(P(6, 1)), straight(2)))).toEqual({ guard: 4 });
        expect(hitsOf(traceShot(world, state, shot(P(6, 1), { weapon: 'assaultRifle' }), straight(3)))).toEqual({ guard: 12 });
    });

    it('adds the shotgun\'s +1 within 3 tiles, and the taser knocks out', () => {
        const { world, state } = setup(OPEN, { people: [person('cust', P(3, 1)), person('far', P(5, 1))] });
        expect(hitsOf(traceShot(world, state, shot(P(3, 1), { weapon: 'shotgun' }), straight(6)))).toEqual({ cust: 18 });
        state.npcs.find(n => n.id === 'cust')!.status = 'tied';
        expect(hitsOf(traceShot(world, state, shot(P(5, 1), { weapon: 'shotgun' }), straight(6)))).toEqual({ far: 12 });
        expect(traceShot(world, state, shot(P(5, 1), { weapon: 'taser' }), straight(1)).bullets[0]!.stop).toBe('range');
        const taser = traceShot(world, state, shot(P(3, 1), { weapon: 'taser', target: 'cust' }), straight(1));
        expect(taser.hits).toEqual([{ id: 'cust', hits: 1, damage: 0, knockout: true }]);
    });

    it('meets a hostage held by the arm before its escort', () => {
        const { world, state } = setup(OPEN, { people: [person('cust', P(4, 1))], jun: P(9, 1) });
        const mara = state.crew.find(c => c.id === 'mara')!;
        mara.pos = P(4, 1);
        mara.dragging = 'cust';
        mara.leading = true;
        state.npcs[0]!.status = 'commanded';
        expect(hitsOf(traceShot(world, state, shot(P(4, 1)), straight(2)))).toEqual({ cust: 6 });
        expect(hitsOf(traceShot(world, state, shot(P(4, 1), { weapon: 'dmr' }), straight(1)))).toEqual({ cust: 9, mara: 6 });
    });

    it('stops at a corner unless all four edges and both tiles beside it are clear', () => {
        const { world, state } = setup(['.....', '.....', '.....', '.....'], { jun: P(0, 0), people: [person('cust', P(3, 3))] });
        expect(hitsOf(traceShot(world, state, shot(P(3, 3)), straight(2)))).toEqual({ cust: 6 });
        const walled = setup(['.....', '.....', '.....', '.....'], { jun: P(0, 0), people: [person('cust', P(3, 3))], walls: [{ between: [P(1, 1), P(2, 1)] }] });
        const t = traceShot(walled.world, walled.state, shot(P(3, 3)), straight(2));
        expect(t.bullets[0]!.stop).toBe('corner');
        expect(t.bullets[0]!.steps[0]).toEqual({ kind: 'corner', at: P(2, 2) });
    });

    it('stops at full-height objects, and at middle-height ones unless an end is raised', () => {
        const { world, state } = setup(['..T....', '.......', '.......'], { jun: P(0, 0), midHeight: [P(2, 2)], people: [person('a', P(5, 0)), person('b', P(5, 2))] });
        expect(traceShot(world, state, shot(P(5, 0)), straight(2)).bullets[0]!.steps).toEqual([{ kind: 'object', tile: P(2, 0) }]);
        state.crew[0]!.pos = P(0, 2);
        expect(traceShot(world, state, shot(P(5, 2)), straight(2)).bullets[0]!.stop).toBe('object');
    });
});

describe('half cover', () => {
    // Jun shoots from the west; the customer stands east of a desk.
    const map = ['.........', '....#....', '.........'];
    const shot: Shot = { shooter: 'jun', weapon: 'pistol', at: P(5, 1) };

    it('blocks a covered hit on a roll below 0.5 and takes its damage until it breaks', () => {
        const { world, state } = setup(map, { people: [person('cust', P(5, 1))] });
        const t = traceShot(world, state, shot, straight(2, [0.2, 0.3]));
        expect(t.hits).toEqual([]);
        expect(t.bullets[0]!.steps[0]).toMatchObject({ kind: 'body', effect: 'blocked', cover: { kind: 'tile', at: '4 1', hp: 3 } });
        expect(t.bullets[1]!.steps[0]).toMatchObject({ effect: 'blocked', cover: { hp: 0, destroyed: true } });
        expect(hitsOf(traceShot(world, state, shot, straight(2, [0.6, 0.2])))).toEqual({ cust: 3 });
        // The preview's shield: covered, and this attack could break it.
        expect(previewShot(world, state, shot).bodies).toEqual([{ id: 'cust', crew: false, first: true, through: false, cover: { state: 'covered', kind: 'tile', at: '4 1', hp: 6, mayBreak: true } }]);
    });

    it('covers within the 90° arc facing it, edges included, and is flanked outside it', () => {
        const { world, state } = setup(['.........', '.........', '.........', '....#....', '.........', '.........'], { jun: P(0, 0), people: [person('cust', P(4, 4))] });
        // From (0, 0) to (4, 4): exactly 45° off the desk's north, covered.
        expect(previewShot(world, state, { ...shot, at: P(4, 4) }).bodies[0]!.cover).toMatchObject({ state: 'covered' });
        state.crew[0]!.pos = P(0, 5);
        expect(previewShot(world, state, { ...shot, at: P(4, 4) }).bodies[0]!.cover).toEqual({ state: 'flanked' });
    });

    it('is ignored by a shooter on raised floor, and a railing covers from below', () => {
        const { world, state } = setup(['^^.......', '^^..#....', '/........'], { jun: P(1, 1), people: [person('cust', P(5, 1))] });
        expect(previewShot(world, state, { ...shot, at: P(5, 1) }).bodies[0]!.cover).toBeNull();
        const railed = setup(['.........', '...^.....', '.........'], { jun: P(0, 1), walls: [{ between: [P(2, 1), P(3, 1)], material: 'rail' }], people: [person('cust', P(3, 1))] });
        expect(previewShot(railed.world, railed.state, { ...shot, at: P(3, 1) }).bodies[0]!.cover).toMatchObject({ state: 'covered', kind: 'edge', hp: null });
    });
});

describe('leaning', () => {
    // Jun stands south of a wall that ends at x = 3; he can lean east to (3, 2) past its end.
    const map = ['......', '......', '......', '......'];
    const walls = [0, 1, 2].map(x => ({ between: [P(x, 1), P(x, 2)] as [Pos, Pos], material: 'reinforced' as const }));

    it('offers the open tile beside a corner, with the corner toward the wall', () => {
        const { world, state } = setup(map, { jun: P(2, 2), walls, people: [person('cust', P(4, 0))] });
        expect(leanOptions(world, state, 'jun')).toEqual([{ at: P(3, 2), corner: P(-1, -1) }]);
        // Not from his own tile: the line runs through the wall's end; leaning out, the customer is in the open.
        const t = traceShot(world, state, { shooter: 'jun', weapon: 'pistol', at: P(4, 0) }, straight(2));
        expect(t.bullets[0]!.stop).toBe('corner');
        expect(hitsOf(traceShot(world, state, { shooter: 'jun', weapon: 'pistol', at: P(4, 0), lean: P(3, 2) }, straight(2)))).toEqual({ cust: 6 });
        expect(() => traceShot(world, state, { shooter: 'jun', weapon: 'pistol', at: P(4, 0), lean: P(2, 3) }, straight(2))).toThrow(/lean/);
    });

    it('puts the leaner on the lean tile, with half cover from the corner', () => {
        const { world, state } = setup(map, { jun: P(2, 2), walls, people: [person('guard', P(3, 0), 'lobbyGuard', 'enforcer'), person('cust', P(5, 2))] });
        state.crew[0]!.leaning = { at: P(3, 2), corner: P(-1, -1) };
        const guard = { shooter: 'guard', weapon: 'pistol', at: P(3, 2) };
        expect(previewShot(world, state, guard).bodies).toMatchObject([{ id: 'jun', cover: { state: 'covered', kind: 'lean' } }]);
        expect(previewShot(world, state, { ...guard, shooter: 'cust' }).bodies).toMatchObject([{ id: 'jun', cover: { state: 'flanked' } }]);
    });

    it('ends with the next crew phase or a move', () => {
        const { world, state } = setup(map, { jun: P(2, 2), walls });
        state.crew[0]!.leaning = { at: P(3, 2), corner: P(-1, -1) };
        const moved = commit(world, state, { type: 'move', crew: 'jun', path: [P(2, 3)] }).state;
        expect(moved.crew[0]!.leaning).toBeNull();
        const ended = commit(world, state, { type: 'endTurn' }).state;
        expect(ended.crew[0]!.leaning).toBeNull();
    });
});

registerTestCommand('testShoot', (ctx, cmd) => {
    resolveShot(ctx, (cmd as unknown as { shot: Shot }).shot);
});

describe('resolving a shot', () => {
    const map = ['.........', '..#.#....', '.........'];

    it('rolls on the combat stream, keeps the rolls and writes what broke', () => {
        const { world, state } = setup(map, {
            walls: [{ between: [P(1, 1), P(2, 1)], material: 'glass' }], people: [person('cust', P(5, 1))]
        });
        const shot: Shot = { shooter: 'jun', weapon: 'machinePistol', at: P(5, 1) };
        const result = commit(world, state, testCommand({ type: 'testShoot', shot } as never));
        const record = result.state.shots[0]!;
        expect(record.shot).toEqual(shot);
        expect(record.rolls.points).toHaveLength(6);
        expect(result.rolls.every(r => r.stream === 'combat')).toBe(true);
        expect(result.undoable).toBe(false);
        // The same rolls on the state before give the same outcome.
        const fired = result.events.find(e => e.type === 'shotFired')!;
        const again = traceShot(world, state, shot, record.rolls);
        expect(fired).toMatchObject({ bullets: again.bullets, hits: again.hits });
        if (again.shattered.length) expect(result.state.edges['northSouth 2 1']).toMatchObject({ shattered: true, blocksSound: false });
        for (const b of again.bullets) for (const s of b.steps) {
            if (s.kind === 'body' && s.cover?.hp !== undefined && s.effect === 'blocked') expect(result.state.cover[s.cover.at]).toBeDefined();
        }
        // A preview can't roll.
        expect(() => preview(world, state, testCommand({ type: 'testShoot', shot } as never))).toThrow(PreviewRollError);
    });

    it('refuses an impossible shot before any roll', () => {
        const { world, state } = setup(map);
        expect(() => commit(world, state, testCommand({ type: 'testShoot', shot: { shooter: 'jun', weapon: 'pistol', at: P(0, 1) } } as never))).toThrow(/somewhere to aim/);
        expect(() => commit(world, state, testCommand({ type: 'testShoot', shot: { shooter: 'jun', weapon: 'pistol', at: P(4, 1), bullets: 3 } } as never))).toThrow(/1 to 2/);
        expect(() => commit(world, state, testCommand({ type: 'testShoot', shot: { shooter: 'jun', weapon: 'mask', at: P(4, 1) } } as never))).toThrow(/no weapon/);
    });
});
