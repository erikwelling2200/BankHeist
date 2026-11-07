import { describe, expect, it } from 'vitest';
import { archetypesFor } from '../../src/gen/generate';
import { TIERS } from '../../src/gen/model';
import {
    commit, crewMoveOptions, fixtureWorld, initialState, pathTo, preview, reachable, safeFloor, stepCost, tileAt, worldFromBank,
    type CrewState, type MoveOptions, type Pos, type ReadonlyWorld, type SimEvent, type State
} from '../../src/sim';
import { cachedBank } from '../bankCache';
import { scouted, step } from './helpers';

/*
 * The way back (§8.6, decision 461, crew/movement.ts `wayBack`): a latched door opens without its key for a crew
 * member going back through it the way they came, so a challenged crew member can always walk out; it never lets
 * anyone in.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const types = (events: readonly SimEvent[]): string[] => events.map(e => e.type);

/**
 * A lobby (x 0–2), a staff corridor behind a mechanical door (x 3–6, rows 0–2), an office off the corridor behind a
 * latched mechanical door (x 7–9). `far` adds a second way into the office from the lobby, along row 3 (layout the crew
 * hasn't seen: it mustn't change anything at the corridor's doors).
 */
function bank(lobbyDoor: 'closed' | 'locked', far = false, teller = false): ReadonlyWorld {
    const wall = (a: Pos, b: Pos, door?: { id: string; start: 'closed' | 'locked' }) =>
        ({ between: [a, b] as [Pos, Pos], ...(door ? { door: { ...door, lock: 'mechanical' as const } } : {}) });
    const walls = [
        ...[0, 1, 2].map(y => wall(P(2, y), P(3, y), y === 1 ? { id: 'lobbyDoor', start: lobbyDoor } : undefined)),
        ...[0, 1, 2].map(y => wall(P(6, y), P(7, y), y === 1 ? { id: 'officeDoor', start: 'locked' } : undefined)),
        ...[3, 4, 5, 6, 7, 8].map(x => wall(P(x, 2), P(x, 3))),
        wall(P(9, 2), P(9, 3), far ? { id: 'farDoor', start: 'closed' } : undefined)
    ];
    return fixtureWorld(['..........', '..........', '..........', '..........'], {
        zones: ['...sssssss', '...sssssss', '...sssssss', '..........'],
        walls,
        people: teller ? [{ id: 'teller', name: 'Kim', role: 'teller', observer: 'staff', pos: P(6, 0), facing: 'w', schedule: [] }] : []
    });
}

const at = (world: ReadonlyWorld, pos: Pos, items: string[] = []): State => scouted(world, initialState(world, { seed: 3, crew: [{ id: 'jun', pos, items }] }));

/** Jun walks into the corridor through the lobby door (unlocked), which latches behind him at the end of the turn. */
function inside(world: ReadonlyWorld): State {
    let state = at(world, P(2, 1));
    state = step(world, state, { type: 'move', crew: 'jun', path: [P(3, 1), P(4, 1)] }).state;
    state = step(world, state, { type: 'endTurn' }).state;
    expect(state.doors.lobbyDoor!.status).toBe('locked');
    return state;
}

describe('the way back (decision 461)', () => {
    it('opens a latched door without its key for the one who came through it, and only back the way they came', () => {
        const world = bank('closed');
        const state = step(world, inside(world), { type: 'move', crew: 'jun', path: [P(3, 1)] }).state;
        const cmd = { type: 'door', crew: 'jun', door: 'lobbyDoor', action: 'open' } as const;
        const opened = step(world, state, cmd);
        expect(opened.state.doors.lobbyDoor!.status).toBe('open');
        expect(preview(world, state, cmd).events).toEqual(opened.events);
        expect(types(opened.events)).not.toContain('illegalAct');
        // Unlocking still takes the key; the office door, never walked through, stays shut to him.
        expect(() => commit(world, state, { type: 'door', crew: 'jun', door: 'lobbyDoor', action: 'unlock' })).toThrow(/no key/);
        const atOffice = step(world, inside(world), { type: 'move', crew: 'jun', path: [P(5, 1), P(6, 1)] }).state;
        expect(() => commit(world, atOffice, { type: 'door', crew: 'jun', door: 'officeDoor', action: 'open' })).toThrow(/locked/);
    });

    it('walks back out through the latched door, the safe floor reaching past it; back in again is refused', () => {
        const world = bank('closed');
        const state = inside(world);
        expect(safeFloor(world, state, 'jun').at(P(1, 1))).toBeDefined();
        const out = step(world, state, { type: 'move', crew: 'jun', path: [P(3, 1), P(2, 1), P(1, 1)] });
        expect(out.events).toContainEqual({ type: 'doorOpened', door: 'lobbyDoor', by: 'jun' });
        let back = step(world, out.state, { type: 'endTurn' }).state;
        expect(back.doors.lobbyDoor!.status).toBe('locked');
        back = step(world, back, { type: 'move', crew: 'jun', path: [P(2, 1)] }).state;
        expect(() => commit(world, back, { type: 'move', crew: 'jun', path: [P(3, 1)] })).toThrow();
        expect(safeFloor(world, back, 'jun').at(P(4, 1))).toBeUndefined();
    });

    it('lets a challenged crew member behind a latched staff door comply (§8.6): out through it before the deadline', () => {
        const world = bank('closed', false, true);
        let state = at(world, P(2, 1));
        const seen = step(world, state, { type: 'move', crew: 'jun', path: [P(3, 1), P(4, 1)] });
        expect(types(seen.events)).toContain('challenged');
        state = step(world, seen.state, { type: 'endTurn' }).state;
        expect(state.doors.lobbyDoor!.status).toBe('locked');
        // The deadline's crew phase: out through the latched door to the lobby, legally.
        const out = step(world, state, { type: 'move', crew: 'jun', path: [P(3, 1), P(2, 1), P(1, 1)] });
        expect(out.events).toContainEqual({ type: 'doorOpened', door: 'lobbyDoor', by: 'jun' });
        expect(tileAt(world, out.state.crew[0]!.pos)?.zone).toBe('public');
        const ended = step(world, out.state, { type: 'endTurn' });
        const result = ended.events.find(e => e.type === 'challengeEnded') as unknown as { result: string } | undefined;
        expect(result?.result).toBe('complied');
        expect(types(ended.events)).not.toContain('exposed');
    });

    it('depends on nothing the crew hasn\'t seen: the same walk in two banks that differ out of sight', () => {
        const verdicts = [false, true].map(far => {
            const world = bank('closed', far), state = step(world, inside(world), { type: 'move', crew: 'jun', path: [P(3, 1)] }).state;
            const open = (door: string) => { try { commit(world, state, { type: 'door', crew: 'jun', door, action: 'open' }); return true; } catch { return false; } };
            return { lobby: open('lobbyDoor'), floor: safeFloor(world, state, 'jun').tiles.map(t => `${t.pos.x},${t.pos.y}`).sort() };
        });
        expect(verdicts[0]).toEqual(verdicts[1]);
        expect(verdicts[0]!.lobby).toBe(true);
    });
});

/** Every lockable door latched, the vault's as it starts. */
function latched(world: ReadonlyWorld, base: State): State {
    const doors = { ...base.doors };
    for (const id of Object.keys(world.doors)) {
        const def = world.doors[id]!;
        if (def.lock !== 'none' && def.lock !== 'vault') doors[id] = { ...doors[id], status: 'locked' };
    }
    return { ...base, doors };
}

/** The tiles a crew member steps from to the Public floor (a reverse flood over `stepCost`). */
function toPublic(world: ReadonlyWorld, state: State, options: MoveOptions): Uint8Array {
    const w = world.width, reach = new Uint8Array(w * world.height), queue: Pos[] = [];
    world.tiles.forEach((t, i) => { if (t.zone === 'public' && !t.blocksMove) { reach[i] = 1; queue.push(P(i % w, Math.floor(i / w))); } });
    for (let q = 0; q < queue.length; q++) {
        const a = queue[q]!;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const b = P(a.x + dx, a.y + dy);
            if ((!dx && !dy) || !tileAt(world, b) || reach[b.y * w + b.x] || stepCost(world, state, b, a, options) === undefined) continue;
            reach[b.y * w + b.x] = 1;
            queue.push(b);
        }
    }
    return reach;
}

describe('generated banks (decision 461)', { timeout: 300000 }, () => {
    for (const tier of TIERS) for (const archetype of archetypesFor(tier)) {
        it(`${tier} ${archetype}: lets nobody in, and lets anyone back out the way they came`, () => {
            for (const layout of [1000, 1001, 1002]) {
                const base = worldFromBank(cachedBank({ layout, population: 0, tier, archetype }));
                // Nobody in: with no key, the Public floor reaches no tile more than it does without the way back.
                const fresh = latched(base, initialState(base, { seed: 1, crew: [] }));
                const member = { id: 'jun', keycards: [] as string[] } as unknown as CrewState;
                const w = base.width, from = (options: MoveOptions): Uint8Array => {
                    const reach = new Uint8Array(w * base.height), queue: Pos[] = [];
                    base.tiles.forEach((t, i) => { if (t.zone === 'public' && !t.blocksMove) { reach[i] = 1; queue.push(P(i % w, Math.floor(i / w))); } });
                    for (let q = 0; q < queue.length; q++) {
                        const a = queue[q]!;
                        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                            const b = P(a.x + dx, a.y + dy);
                            if ((!dx && !dy) || !tileAt(base, b) || reach[b.y * w + b.x] || stepCost(base, fresh, a, b, options) === undefined) continue;
                            reach[b.y * w + b.x] = 1;
                            queue.push(b);
                        }
                    }
                    return reach;
                };
                const withWayBack = from(crewMoveOptions(base, member));
                const plain = from({ mover: 'jun', canPassDoor: (_door, status) => status === 'closed' });
                expect([...withWayBack].join(''), `${layout} ${tier} ${archetype}`).toBe([...plain].join(''));

                // Back out: walk in as far as the doors unlocked allow, let every lock latch, and the way back is open.
                const world = { ...base, rules: { ...base.rules, moveTiles: 4000 } } as ReadonlyWorld;
                const start = world.tiles.findIndex(t => t.zone === 'public' && !!t.room && !t.blocksMove);
                const open: State = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(start % w, Math.floor(start / w)) }] });
                for (const id of Object.keys(world.doors)) if (world.doors[id]!.lock !== 'vault') open.doors[id] = { ...open.doors[id], status: 'closed' };
                const state = scouted(world, open), jun = state.crew[0]!;
                const reach = reachable(world, state, jun.pos, 4000 * 2, crewMoveOptions(world, jun));
                const deep = reach.tiles.filter(t => t.canEnd && tileAt(world, t.pos)?.zone !== 'public').sort((a, b) => b.cost - a.cost).slice(0, 3);
                expect(deep.length).toBeGreaterThan(0);
                for (const t of deep) {
                    const walked = commit(world, state, { type: 'move', crew: 'jun', path: pathTo(reach, t.pos)! }).state;
                    const shut = latched(world, walked), there = shut.crew[0]!;
                    expect(Object.keys(there.cameThrough ?? {}).length, 'doors walked through').toBeGreaterThan(0);
                    const out = toPublic(world, shut, { ...crewMoveOptions(world, there), ignorePeople: true });
                    expect(out[there.pos.y * w + there.pos.x], `${layout} ${tier} ${archetype} from ${there.pos.x},${there.pos.y}`).toBe(1);
                }
            }
        });
    }
});
