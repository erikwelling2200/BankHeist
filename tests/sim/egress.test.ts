import { describe, expect, it } from 'vitest';
import { archetypesFor } from '../../src/gen/generate';
import { TIERS } from '../../src/gen/model';
import {
    commit, crewMoveOptions, egressDistance, exitSide, fixtureWorld, IllegalCommand, initialState, preview, safeFloor, stepCost, tileAt, worldFromBank,
    type CrewState, type Pos, type ReadonlyWorld, type SimEvent, type State
} from '../../src/sim';
import { cachedBank } from '../bankCache';
import { step } from './helpers';

/*
 * Exit hardware (§8.6, decision 461, src/sim/geo/egress.ts): a latched door opens without its key from its exit side,
 * the side away from the Public floor, so a challenged crew member can always walk out, and never in.
 */

const P = (x: number, y: number): Pos => ({ x, y });

/**
 * A lobby (x 0–2), a staff corridor behind a latched mechanical door (x 3–6, rows 0–2), an office off the corridor behind
 * a latched mechanical door (x 7–9, rows 0–2: same zone), a secure closet below the corridor behind a latched keycard door
 * (row 3), and a vault beside the closet behind the vault door.
 */
function bank(): ReadonlyWorld {
    const wall = (a: Pos, b: Pos, door?: { id: string; lock: 'mechanical' | 'keycard' | 'vault' }) =>
        ({ between: [a, b] as [Pos, Pos], ...(door ? { door: { ...door, start: 'locked' as const } } : {}), ...(door?.lock === 'vault' ? { material: 'vault' as const } : {}) });
    const walls = [
        ...[0, 1, 2, 3].map(y => wall(P(2, y), P(3, y), y === 1 ? { id: 'lobbyDoor', lock: 'mechanical' } : undefined)),
        ...[0, 1, 2].map(y => wall(P(6, y), P(7, y), y === 1 ? { id: 'officeDoor', lock: 'mechanical' } : undefined)),
        ...[3, 4, 5, 6, 7, 8, 9].map(x => wall(P(x, 2), P(x, 3), x === 4 ? { id: 'closetDoor', lock: 'keycard' } : undefined)),
        wall(P(6, 3), P(7, 3), { id: 'vaultDoor', lock: 'vault' })
    ];
    return fixtureWorld(['..........', '..........', '..........', '..........'], {
        zones: ['...sssssss', '...sssssss', '...sssssss', '...xxxxxxx'],
        rooms: ['lllccccooo', 'lllccccooo', 'lllccccooo', 'lllxxxxvvv'],
        walls,
        people: [{ id: 'teller', name: 'Kim', role: 'teller', observer: 'staff', pos: P(6, 0), facing: 'w', schedule: [] }]
    });
}

const door = (world: ReadonlyWorld, id: string) => world.doors[id]!;
const types = (events: readonly SimEvent[]): string[] => events.map(e => e.type);

function at(world: ReadonlyWorld, pos: Pos): State {
    return initialState(world, { seed: 3, crew: [{ id: 'jun', pos }] });
}

describe('exit hardware (decision 461)', () => {
    it('lets out from the side away from the Public floor, never in: between zones the higher, between equals the farther', () => {
        const world = bank();
        expect(exitSide(world, door(world, 'lobbyDoor'), P(3, 1))).toBe(true);
        expect(exitSide(world, door(world, 'lobbyDoor'), P(2, 1))).toBe(false);
        expect(exitSide(world, door(world, 'officeDoor'), P(7, 1))).toBe(true);
        expect(exitSide(world, door(world, 'officeDoor'), P(6, 1))).toBe(false);
        expect(exitSide(world, door(world, 'closetDoor'), P(4, 3))).toBe(true);
        expect(exitSide(world, door(world, 'closetDoor'), P(4, 2))).toBe(false);
        // The vault door has no exit hardware, and a tile not beside a door isn't its side.
        expect(exitSide(world, door(world, 'vaultDoor'), P(7, 3))).toBe(false);
        expect(exitSide(world, door(world, 'lobbyDoor'), P(5, 1))).toBe(false);
        const d = egressDistance(world);
        expect(d[1 * world.width + 0]).toBe(0);
        expect(d[1 * world.width + 3]).toBe(1);
        // Behind the vault door: no way out for anyone.
        expect(d[3 * world.width + 8]).toBe(-1);
    });

    it('opens a latched door from its exit side without the key, and from the other side not', () => {
        const world = bank();
        const inside = at(world, P(3, 1));
        const opened = step(world, inside, { type: 'door', crew: 'jun', door: 'lobbyDoor', action: 'open' });
        expect(opened.state.doors.lobbyDoor!.status).toBe('open');
        expect(preview(world, inside, { type: 'door', crew: 'jun', door: 'lobbyDoor', action: 'open' }).events).toEqual(opened.events);
        // It isn't an illegal act: nobody's `!`.
        expect(types(opened.events)).not.toContain('illegalAct');
        const outside = at(world, P(2, 1));
        expect(() => commit(world, outside, { type: 'door', crew: 'jun', door: 'lobbyDoor', action: 'open' })).toThrow(/locked/);
        // Unlocking still takes the key.
        expect(() => commit(world, inside, { type: 'door', crew: 'jun', door: 'lobbyDoor', action: 'unlock' })).toThrow(/no key/);
    });

    it('walks out through a latched door, and the safe floor reaches past it; walking in is refused', () => {
        const world = bank();
        const inside = at(world, P(3, 1));
        const out = step(world, inside, { type: 'move', crew: 'jun', path: [P(2, 1), P(1, 1)] });
        expect(out.state.crew[0]!.pos).toEqual(P(1, 1));
        expect(out.events.some(e => e.type === 'doorOpened')).toBe(true);
        expect(safeFloor(world, inside, 'jun').at(P(1, 1))).toBeDefined();
        const outside = at(world, P(2, 1));
        expect(() => commit(world, outside, { type: 'move', crew: 'jun', path: [P(3, 1), P(4, 1)] })).toThrow(IllegalCommand);
        expect(safeFloor(world, outside, 'jun').at(P(4, 1))).toBeUndefined();
    });

    it('lets a challenged crew member behind a latched staff door comply (§8.6): out through it before the deadline', () => {
        const world = bank();
        // Jun waits in the corridor in the teller's sight: "Hey, you can't be back here."
        let state = at(world, P(4, 1));
        const seen = step(world, state, { type: 'wait', crew: 'jun' });
        expect(types(seen.events)).toContain('challenged');
        state = step(world, seen.state, { type: 'endTurn' }).state;
        // The next crew phase, the deadline: out through the latched door to the lobby, legally.
        state = step(world, state, { type: 'move', crew: 'jun', path: [P(3, 1), P(2, 1), P(1, 1)] }).state;
        expect(tileAt(world, state.crew[0]!.pos)?.zone).toBe('public');
        const ended = step(world, state, { type: 'endTurn' });
        const result = ended.events.find(e => e.type === 'challengeEnded') as unknown as { result: string } | undefined;
        expect(result?.result).toBe('complied');
        expect(types(ended.events)).not.toContain('exposed');
    });
});

describe('a way out from anywhere in a generated bank (decision 461)', { timeout: 120000 }, () => {
    /**
     * The tiles from which a Clean crew member without a key gets to the Public floor, every lockable door latched (a
     * reverse flood from the Public floor over `stepCost` with the crew's move options), against those it would with
     * every door open but the vault's.
     */
    for (const tier of TIERS) for (const archetype of archetypesFor(tier)) {
        it(`${tier} ${archetype}`, () => {
            const generated = cachedBank({ layout: 1000, population: 0, tier, archetype }), world = worldFromBank(generated);
            const latched: State = initialState(world, { seed: 1, crew: [] });
            const open: State = { ...latched, doors: { ...latched.doors } };
            for (const id of Object.keys(world.doors)) {
                const def = world.doors[id]!;
                latched.doors[id] = { ...latched.doors[id], status: def.lock === 'none' ? 'closed' : 'locked' };
                open.doors[id] = { ...open.doors[id], status: def.lock === 'vault' ? 'locked' : 'open' };
            }
            const member = { id: 'jun', keycards: [] as string[] } as unknown as CrewState;
            const flood = (state: State): Uint8Array => {
                const w = world.width, reach = new Uint8Array(w * world.height), queue: Pos[] = [];
                world.tiles.forEach((t, i) => { if (t.zone === 'public' && !t.blocksMove) { reach[i] = 1; queue.push(P(i % w, Math.floor(i / w))); } });
                const options = crewMoveOptions(world, member);
                for (let q = 0; q < queue.length; q++) {
                    const a = queue[q]!;
                    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                        const b = P(a.x + dx, a.y + dy);
                        if ((!dx && !dy) || !tileAt(world, b) || reach[b.y * w + b.x]) continue;
                        if (stepCost(world, state, b, a, options) === undefined) continue;
                        reach[b.y * w + b.x] = 1;
                        queue.push(b);
                    }
                }
                return reach;
            };
            const free = flood(open), out = flood(latched);
            const stuck = world.tiles.flatMap((t, i) => (free[i] && !out[i] && t.room ? [`${i % world.width},${Math.floor(i / world.width)}`] : []));
            expect(stuck).toEqual([]);
            // The sample has latched doors to get through.
            expect(world.tiles.some((t, i) => t.zone !== 'public' && free[i])).toBe(true);
        });
    }
});
