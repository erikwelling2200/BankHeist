import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/gen/rng';
import {
    brokenFabric, commit, copyFabric, NO_COVER, fixtureWorld, IllegalCommand, initialState, LYING_STATUSES, leanOptions, previewShot, resolveShot, shotScene, traceBullet, traceShot,
    WEAPONS, worldFromBank, type BulletTrace, type Fabric, type FanSegment, type FixtureWall, type ShotMap, type NpcStatus, type Pos, type ReadonlyWorld, type Shot, type ShotStep, type State
} from '../../src/sim';
import { cachedBank } from '../bankCache';
import { registerTestCommand, testCommand } from './helpers';

/*
 * M3-01's promise (§11.7, implementation plan M3-01 Accept): for the same rolled points the preview's trace is the
 * outcome's. Two checks, over random shots in fixtures and generated banks, with lying, led, leaning and armoured
 * people, damaged cover, shattered panes, teller glass and every weapon:
 *
 * - `resolveShot` (rolled through the engine) equals `traceShot` on the state before with the rolls it kept;
 * - the preview's fan: a bullet anywhere in a segment (bullet 1 as resolved, and random angles) meets what the
 *   segment says, cover aside (the fan never lets cover block; a blocked bullet's path is the segment's up to it).
 *
 * Then the §12.1 expected-hits table against the fan's geometry: a warning when a cell is off, never a failure.
 */

registerTestCommand('propertyShoot', (ctx, cmd) => {
    resolveShot(ctx, (cmd as unknown as { shot: Shot }).shot);
});

const STATUSES: NpcStatus[] = ['calm', 'curious', 'alerted', 'hostile', 'commanded', 'tied', 'unconscious', 'dead'];
const ARMOUR = ['lightVest', 'mediumArmour', 'heavyArmour'];

/**
 * Steps as the fan and the outcome must agree on them: cover's roll and what it took left out, which hit breaks the
 * teller glass, and plain glass, which every bullet passes and only the first shatters.
 */
const plain = (steps: readonly ShotStep[]): unknown[] => steps.filter(s => !(s.kind === 'wall' && s.material === 'glass')).map(step => (step.kind === 'wall' ? { ...step, broke: undefined } : step.kind !== 'body' ? step
    : { kind: 'body', id: step.id, covered: !!step.cover, ...(step.effect === 'blocked' ? {} : { effect: step.effect, damage: step.damage }) }));

/** Whether a bullet's trace is what a fan path says: the same steps, or a prefix ending where cover blocked it. */
function agrees(path: { steps: ShotStep[]; stop: string }, bullet: BulletTrace): boolean {
    const a = plain(path.steps), b = plain(bullet.steps);
    if (bullet.stop === 'cover') {
        const n = b.length;
        return n <= a.length && JSON.stringify(a.slice(0, n - 1)) === JSON.stringify(b.slice(0, n - 1)) && (a[n - 1] as { id?: string }).id === (b[n - 1] as { id?: string }).id;
    }
    return path.stop === bullet.stop && JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Steps reduced to what breakage can't change: panes left out (one broken earlier leaves no step), bodies whole but for
 * their cover (worn away on the broken path).
 */
const unbroken = (steps: readonly ShotStep[]): unknown[] => steps
    .filter(s => !(s.kind === 'wall' && (s.material === 'glass' || s.material === 'tellerGlass')))
    .map(s => (s.kind === 'body' ? { id: s.id, effect: s.effect, damage: s.damage } : s));

/**
 * Whether a bullet part of the way between the fabric as it stood and as it could stand broken meets the broken path:
 * all of it, with the same stop; or stopped short by teller glass not yet broken, a prefix; or blocked by cover still
 * standing, a prefix to that body.
 */
function onTheWay(path: { steps: ShotStep[]; stop: string }, bullet: BulletTrace): boolean {
    const a = unbroken(path.steps), b = unbroken(bullet.steps), last = bullet.steps[bullet.steps.length - 1];
    const prefix = (n: number): boolean => n <= a.length && JSON.stringify(a.slice(0, n)) === JSON.stringify(b.slice(0, n));
    if (bullet.stop === 'cover') return prefix(b.length - 1) && (a[b.length - 1] as { id?: string } | undefined)?.id === (b[b.length - 1] as { id: string }).id;
    if (bullet.stop === 'wall' && last?.kind === 'wall' && last.material === 'tellerGlass') return prefix(b.length);
    return path.stop === bullet.stop && a.length === b.length && prefix(b.length);
}

/** What breakage changes in a fabric: teller glass shattered (plain glass changes nothing) and cover gone. */
const breakage = (map: ShotMap, f: Fabric): string =>
    `${map.edges.map((e, i) => (e.material === 'glass' ? '' : f.shattered[i])).join('')}|${[...f.cover].map(c => (c === NO_COVER ? 0 : 1)).join('')}`;

/** The segment strictly holding an angle, away from its edges; undefined on an edge. */
const segmentAt = (fan: readonly FanSegment[], angle: number): FanSegment | undefined => fan.find(s => angle > s.from + 1e-7 && angle < s.to - 1e-7);

interface Tally { broken: number; shots: number; refused: number; bullets: number; checked: number; walls: number; bodies: number; covered: number; blocked: number; through: number; corners: number }

function randomShots(world: ReadonlyWorld, base: State, rng: Rng, shots: number, tally: Tally): void {
    const free: Pos[] = [];
    world.tiles.forEach((t, i) => { if (!t.blocksMove) free.push({ x: i % world.width, y: Math.floor(i / world.width) }); });
    for (let n = 0; n < shots; n++) {
        const state = structuredClone(base);
        for (const npc of state.npcs) if (rng.chance(0.3)) npc.status = rng.pick(STATUSES);
        for (const c of state.crew) {
            c.loadout.items = rng.chance(0.5) ? [rng.pick(ARMOUR)] : [];
            const leans = leanOptions(world, state, c.id);
            if (leans.length && rng.chance(0.5)) c.leaning = rng.pick(leans);
        }
        // A led hostage now and then: the first crew member leads someone face down beside them.
        const lead = state.npcs.find(npc => LYING_STATUSES.has(npc.status) && npc.status !== 'dead');
        if (lead && rng.chance(0.3)) {
            const c = state.crew[0]!;
            c.dragging = lead.id;
            c.leading = true;
            lead.status = 'commanded';
        }
        world.tiles.forEach((t, i) => {
            if (t.halfCover && t.coverHp !== undefined && rng.chance(0.2)) state.cover[`${i % world.width} ${Math.floor(i / world.width)}`] = rng.int(0, t.coverHp - 1);
        });
        const people = [...state.crew.map(c => c.id), ...state.npcs.filter(p => p.status !== 'away').map(p => p.id)];
        const shooter = rng.pick(people);
        const weapon = rng.pick(Object.keys(WEAPONS));
        const w = WEAPONS[weapon as keyof typeof WEAPONS];
        const me = state.crew.find(c => c.id === shooter)?.pos ?? state.npcs.find(p => p.id === shooter)!.pos;
        const near = free.filter(p => (p.x - me.x) ** 2 + (p.y - me.y) ** 2 <= (w.range + 2) ** 2);
        // Half the time at someone in range, as a tap would aim.
        const inRange = [...state.crew, ...state.npcs].filter(p => p.id !== shooter && (p.pos.x - me.x) ** 2 + (p.pos.y - me.y) ** 2 <= w.range ** 2 && (p.pos.x !== me.x || p.pos.y !== me.y));
        const at = inRange.length && rng.chance(0.5) ? { ...rng.pick(inRange).pos } : rng.pick(near.length ? near : free);
        const shot: Shot = { shooter, weapon, at };
        // Fine aim near the line, or anywhere round the circle (the fan may pass ±180°).
        if (rng.chance(0.3)) shot.turn = rng.int(-12, 12);
        else if (rng.chance(0.2)) shot.turn = rng.chance(0.3) ? rng.pick([180, -180, 179, -179, 178, -175]) : rng.int(-180, 180);
        if (rng.chance(0.3)) shot.bullets = rng.int(1, w.bullets);
        if (rng.chance(0.3)) shot.moved = true;
        if ('brace' in w && rng.chance(0.4)) shot.braced = true;
        const crewMember = state.crew.find(c => c.id === shooter);
        if (crewMember) {
            const leans = leanOptions(world, state, shooter);
            if (leans.length && rng.chance(0.4)) shot.lean = rng.pick(leans).at;
        }
        const targets = [...state.crew, ...state.npcs].filter(p => p.id !== shooter && p.pos.x === at.x && p.pos.y === at.y && !('dragging' in p && p.dragging));
        if (targets.length && rng.chance(0.5)) shot.target = targets[0]!.id;
        let previewed;
        try {
            shotScene(world, state, shot);
            previewed = previewShot(world, state, shot);
        } catch (e) {
            if (!(e instanceof IllegalCommand)) throw e;
            tally.refused++;
            continue;
        }
        tally.shots++;
        const result = commit(world, state, testCommand({ type: 'propertyShoot', shot } as never));
        const record = result.state.shots[result.state.shots.length - 1]!;
        const fired = result.events.find(e => e.type === 'shotFired')!;
        const again = traceShot(world, state, shot, record.rolls);
        expect(fired).toMatchObject({ bullets: again.bullets, hits: again.hits });
        for (const b of again.bullets) {
            tally.bullets++;
            for (const s of b.steps) {
                if (s.kind === 'wall') tally.walls++;
                if (s.kind === 'corner') tally.corners++;
                if (s.kind === 'body') {
                    tally.bodies++;
                    if (s.cover) tally.covered++;
                    if (s.effect === 'blocked') tally.blocked++;
                    if (s.effect === 'through') tally.through++;
                }
            }
        }
        // Every bullet as resolved, replayed through the fabric as the earlier ones left it: what it met is what its
        // segment says as the fabric stood, or as it could stand broken, or a part of the way to that; and nobody it
        // hits is missing from the preview's bodies.
        const scene = shotScene(world, state, shot);
        const fabric = copyFabric(scene.fabric), broken = brokenFabric(scene.map, scene.fabric, again.bullets.length, scene.bullet);
        const before = breakage(scene.map, scene.fabric), allBroken = breakage(scene.map, broken);
        const previewedIds = new Set(previewed.bodies.map(b => b.id));
        let cover = 0;
        again.bullets.forEach((b, k) => {
            const now = breakage(scene.map, fabric);
            expect(traceBullet(scene, fabric, b.offset, () => record.rolls.covers[cover++]!)).toEqual(b);
            for (const s of b.steps) if (s.kind === 'body' && s.effect !== 'blocked') expect(previewedIds.has(s.id), `${s.id} hit unpreviewed`).toBe(true);
            const segment = segmentAt(previewed.fan, b.offset);
            if (!segment) return;
            tally.checked++;
            const why = `bullet ${k + 1} at ${b.offset}° ${JSON.stringify(b.steps)} vs ${JSON.stringify(segment)}`;
            if (now === before) expect(agrees(segment, b), why).toBe(true);
            else if (now === allBroken) expect(agrees(segment.broken ?? segment, b), why).toBe(true);
            else expect(onTheWay(segment.broken ?? segment, b), why).toBe(true);
            if (now !== before) tally.broken++;
        });
        // Random angles over the widest arc.
        for (let k = 0; k < 6; k++) {
            const angle = previewed.fan[0]!.from + rng.next() * (previewed.fan[previewed.fan.length - 1]!.to - previewed.fan[0]!.from);
            const seg = segmentAt(previewed.fan, angle);
            if (!seg) continue;
            const bullet = traceBullet(scene, copyFabric(scene.fabric), angle, () => 0.99);
            tally.checked++;
            expect(agrees(seg, bullet), `at ${angle}° ${JSON.stringify(bullet.steps)} vs ${JSON.stringify(seg)}`).toBe(true);
        }
    }
}

const tally = (): Tally => ({ broken: 0, shots: 0, refused: 0, bullets: 0, checked: 0, walls: 0, bodies: 0, covered: 0, blocked: 0, through: 0, corners: 0 });

/** Building three generated banks on a cold bank cache takes several seconds (as tests/generator.test.ts allows). */
const HEAVY = 60000;

describe('shot previews are the outcome (M3-01)', { timeout: HEAVY }, () => {
    it('in a fixture with every material', () => {
        const map = [
            '..............',
            '..#....T......',
            '.....#........',
            '...........#..',
            '..^^..........',
            '..^^.....#....'
        ];
        const walls: FixtureWall[] = [
            { between: [{ x: 4, y: 0 }, { x: 5, y: 0 }], material: 'glass' },
            { between: [{ x: 4, y: 1 }, { x: 5, y: 1 }], material: 'tellerGlass' },
            { between: [{ x: 4, y: 2 }, { x: 5, y: 2 }], material: 'soft' },
            { between: [{ x: 4, y: 3 }, { x: 5, y: 3 }], material: 'reinforced' },
            { between: [{ x: 8, y: 2 }, { x: 8, y: 3 }], material: 'soft', door: { id: 'd' } },
            { between: [{ x: 9, y: 2 }, { x: 9, y: 3 }], material: 'glass' },
            { between: [{ x: 10, y: 2 }, { x: 10, y: 3 }], material: 'rail' },
            { between: [{ x: 11, y: 2 }, { x: 11, y: 3 }], material: 'fence' as const }
        ];
        // Most of them beside half cover.
        const spots = [{ x: 3, y: 1 }, { x: 6, y: 2 }, { x: 11, y: 4 }, { x: 10, y: 5 }, { x: 8, y: 0 }, { x: 12, y: 2 }];
        const people = spots.map((pos, i) => ({
            id: `p${i}`, name: `p${i}`, role: i % 2 ? 'lobbyGuard' : 'customer', observer: (i % 2 ? 'enforcer' : 'civilian') as 'enforcer' | 'civilian', pos, facing: 's' as const, schedule: []
        }));
        const t = tally();
        for (let seed = 1; seed <= 6; seed++) {
            const world = fixtureWorld(map, { walls, people, midHeight: [{ x: 12, y: 4 }], rules: { guardArmour: seed % 2 } });
            const state = initialState(world, { seed, crew: [{ id: 'jun', pos: { x: 0, y: 2 } }, { id: 'mara', pos: { x: 13, y: 1 } }, { id: 'kit', pos: { x: 3, y: 4 } }] });
            randomShots(world, state, new Rng(seed * 31), 60, t);
        }
        expect(t.checked).toBeGreaterThan(1000);
        expect(t.walls && t.bodies && t.covered && t.blocked && t.through && t.broken).toBeTruthy();
    });

    it('in generated banks', () => {
        const t = tally();
        for (const [i, tier] of (['small', 'city', 'hq'] as const).entries()) {
            const world = worldFromBank(cachedBank({ layout: 3100 + i * 41, population: 17 + i, tier }));
            const rng = new Rng(901 + i);
            const free: Pos[] = [];
            world.tiles.forEach((tile, k) => { if (!tile.blocksMove && tile.room !== null) free.push({ x: k % world.width, y: Math.floor(k / world.width) }); });
            const taken = new Set(world.people.map(p => `${p.pos.x},${p.pos.y}`));
            const crew = ['jun', 'mara', 'kit'].map(id => {
                const near = rng.pick(world.people).pos;
                const options = free.filter(p => !taken.has(`${p.x},${p.y}`) && Math.abs(p.x - near.x) + Math.abs(p.y - near.y) <= 5);
                const pos = rng.pick(options.length ? options : free);
                taken.add(`${pos.x},${pos.y}`);
                return { id, pos };
            });
            randomShots(world, initialState(world, { seed: i + 1, crew }), rng, 80, t);
        }
        expect(t.checked).toBeGreaterThan(1000);
        expect(t.walls && t.bodies && t.covered).toBeTruthy();
    });
});

describe('the §12.1 expected hits (tuning, warning only)', () => {
    /** Expected hits against a standing target with no cover at 2 / 5 / 9 / 14 tiles; AR fires 2 rounds. */
    const TABLE: Record<string, { bullets?: number; hits: [number, number, number, number] }> = {
        pistol: { hits: [2.0, 1.6, 1.0, 0.6] },
        machinePistol: { hits: [4.2, 1.7, 0.9, 0.6] },
        smg: { hits: [4.0, 2.4, 1.3, 0.9] },
        shotgun: { hits: [4.3, 1.7, 1.0, 0.6] },
        assaultRifle: { bullets: 2, hits: [2.0, 2.0, 1.6, 1.4] },
        dmr: { hits: [1.0, 1.0, 1.0, 1.0] },
        lmg: { hits: [8.6, 4.6, 2.6, 1.6] }
    };
    const DISTANCES = [2, 5, 9, 14] as const;

    it('matches the cone model within tolerance', () => {
        const world = fixtureWorld(['.'.repeat(32), '.'.repeat(32), '.'.repeat(32)], { people: [{ id: 'dummy', name: 'dummy', role: 'customer', observer: 'civilian', pos: { x: 2, y: 1 }, facing: 'w', schedule: [] }] });
        const off: string[] = [];
        for (const [weapon, row] of Object.entries(TABLE)) {
            DISTANCES.forEach((d, i) => {
                const range = WEAPONS[weapon as keyof typeof WEAPONS].range;
                if (d > range) return;
                const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: { x: 2 + d, y: 1 } }] });
                const shot: Shot = { shooter: 'jun', weapon, at: { x: 2, y: 1 }, ...(row.bullets ? { bullets: row.bullets } : {}) };
                const p = previewShot(world, state, shot);
                // Each bullet's chance to hit: how much of its arc the fan's segments that hit the target cover.
                const expected = p.arcs.reduce((sum, arc) => {
                    const lo = p.turn - arc / 2, hi = p.turn + arc / 2;
                    const on = p.fan.filter(s => s.steps.some(x => x.kind === 'body' && x.id === 'dummy'))
                        .reduce((a, s) => a + Math.max(0, Math.min(hi, s.to) - Math.max(lo, s.from)), 0);
                    return sum + on / arc;
                }, 0);
                // The same from resolved shots: uniform points through `traceShot`, so a wrong fan can't hide here.
                const rng = new Rng(d * 101 + i), samples = 2000;
                let hits = 0;
                for (let n = 0; n < samples; n++) {
                    const t = traceShot(world, state, shot, { points: p.arcs.map(() => rng.next()), covers: [] });
                    hits += t.hits.find(h => h.id === 'dummy')?.hits ?? 0;
                }
                const resolved = hits / samples, want = row.hits[i]!;
                expect(Math.abs(resolved - expected), `${weapon} at ${d}: resolved ${resolved}, fan ${expected}`).toBeLessThan(0.12);
                if (Math.abs(resolved - want) > Math.max(0.15, want * 0.1)) off.push(`${weapon} at ${d}: ${resolved.toFixed(2)} (table ${want})`);
            });
        }
        if (off.length) console.warn(`§12.1 expected hits off the table:\n  ${off.join('\n  ')}`);
    });
});
