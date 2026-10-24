import { describe, expect, it } from 'vitest';
import { evidenceWarnings, foundStop, shownWarnings, unknownWalkers, warningLines } from '../../src/game/evidenceWarning';
import {
    autoStep, clonePlain, commit, encodeBits, fixtureWorld, initialState, isUnknownRisk, type Facing, type FixtureWall, type ObserverClass, type PersonDef, type Pos,
    type ReadonlyWorld, type State
} from '../../src/sim';
import { scouted } from '../sim/helpers';

const P = (x: number, y: number): Pos => ({ x, y });
const person = (id: string, pos: Pos, facing: Facing, observer: ObserverClass, role: string): PersonDef => ({ id, name: id, role, observer, pos, facing, schedule: [] });

/** Knocks out an NPC where it stands, as the knockout does, the crew seeing it this crew phase. */
function knockOut(state: State, id: string): void {
    const npc = state.npcs.find(n => n.id === id)!;
    Object.assign(npc, { status: 'unconscious', outCold: state.turn + 3, intent: { path: [] }, goal: { kind: 'still' }, route: null, search: null });
    state.knowledge.npcs[id] = { at: { ...npc.pos }, facing: npc.facing, turn: state.turn, live: true, routine: false, rota: false, watched: 1, watchedTurn: state.turn, tick: state.knowledge.phaseTick + 1 };
}

/** Only the tiles `fresh` says were seen this turn (everything stays seen). */
function freshOnly(world: ReadonlyWorld, state: State, fresh: (p: Pos) => boolean): void {
    const bits = new Uint8Array(world.width * world.height);
    for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) bits[y * world.width + x] = fresh(P(x, y)) ? 1 : 0;
    state.knowledge.fresh = encodeBits(bits);
}

/** An open lobby `width` wide: a teller, a customer knocked out at (15, 6) or `body`, Jun far off; everything scouted. */
function lobby(options: { width?: number; teller?: [Pos, Facing]; body?: Pos; walls?: FixtureWall[] } = {}) {
    const width = options.width ?? 20, [at, facing] = options.teller ?? [P(15, 1), 'n' as Facing];
    const world = fixtureWorld(Array.from({ length: 9 }, () => '.'.repeat(width)), {
        people: [person('teller', at, facing, 'staff', 'teller'), person('cus', options.body ?? P(15, 6), 's', 'civilian', 'customer')],
        ...(options.walls ? { walls: options.walls } : {})
    });
    const state = clonePlain(scouted(world, initialState(world, { seed: 5, crew: [{ id: 'jun', pos: P(1, 4) }] })));
    for (const n of state.npcs) n.intent = { path: [] };
    knockOut(state, 'cus');
    return { world, state };
}

describe('evidence the coming world phase notices', () => {
    it('warns for certain of a body on a known NPC\'s walk, names the finder, and holds auto-advance before the world phase', () => {
        const { world, state } = lobby();
        // The teller turns south on its first step: the body is in front of it.
        state.npcs.find(n => n.id === 'teller')!.intent = { path: [P(15, 2)], facing: 's' };
        const [w] = evidenceWarnings(world, state);
        expect(w).toMatchObject({ id: 'body:cus', kind: 'body', pos: P(15, 6), level: 'certain', about: 'cus' });
        expect(w!.certain).toEqual([{ id: 'teller', by: 'npc', from: P(15, 2) }]);
        expect(warningLines(world, w!)[0]).toMatchObject({ observer: 'teller', text: 'Next phase: Teller finds the body', phase: 'next', outcome: '!', from: P(15, 2), to: P(15, 6) });
        // The world phase does find it.
        const after = commit(world, state, { type: 'endTurn' });
        expect(after.events.some(e => e.type === 'evidenceNoticed' && e.npc === 'teller' && e.evidence === 'body:cus')).toBe(true);
        // A wait would end the turn: it stops before it instead, nothing played.
        const stop = foundStop(world, state)!;
        expect(stop).toMatchObject({ kind: 'evidence', text: 'the teller would find the body', npc: 'teller', at: P(15, 6) });
        const step = autoStep(world, state, {}, { target: { kind: 'turn', turn: state.turn + 3 }, beforeEnd: s => foundStop(world, s) });
        expect(step.stop).toEqual(stop);
        expect(step.played).toEqual([]);
    });

    it('shows nothing for a body nobody known or unknown could see, nor for a stashed one', () => {
        const { world, state } = lobby();
        expect(evidenceWarnings(world, state)).toMatchObject([{ id: 'body:cus', level: 'none', certain: [], doubted: [], unknown: false }]);
        expect(shownWarnings(world, state)).toEqual([]);
        expect(foundStop(world, state)).toBeNull();
        expect(commit(world, state, { type: 'endTurn' }).events.some(e => e.type === 'evidenceNoticed')).toBe(false);
        const stashed = clonePlain(state);
        stashed.npcs.find(n => n.id === 'cus')!.stashed = 'closet';
        stashed.npcs.find(n => n.id === 'teller')!.intent = { path: [P(15, 2)], facing: 's' };
        expect(evidenceWarnings(world, stashed)).toEqual([]);
    });

    it('is uncertain where only someone unknown could see it: standing in unknown space, or walking there first', () => {
        // Not seen this turn from x = 10 on: someone could stand there, within 8 of the body.
        const near = lobby({ body: P(8, 4) });
        freshOnly(near.world, near.state, p => p.x <= 9);
        expect(evidenceWarnings(near.world, near.state)).toMatchObject([{ level: 'uncertain', certain: [], doubted: [], unknown: true }]);
        // 12 tiles from unknown space: nobody stands in sight of it, but someone could walk 8 tiles and see it.
        const far = lobby({ width: 30, body: P(2, 4), teller: [P(27, 1), 'e'] });
        freshOnly(far.world, far.state, p => p.x <= 13);
        expect(isUnknownRisk(far.world, far.state, P(2, 4))).toBe(false);
        expect(unknownWalkers(far.world, far.state, P(2, 4))).toBe(true);
        expect(shownWarnings(far.world, far.state)).toMatchObject([{ level: 'uncertain', unknown: true }]);
        const line = warningLines(far.world, shownWarnings(far.world, far.state)[0]!);
        expect(line).toMatchObject([{ observer: null, by: 'unknown', text: 'Next phase: someone unseen could find the body', outcome: '-' }]);
        // Out of any walk's reach: nothing.
        const clear = lobby({ width: 30, body: P(2, 4), teller: [P(27, 1), 'e'] });
        freshOnly(clear.world, clear.state, p => p.x <= 20);
        expect(evidenceWarnings(clear.world, clear.state)).toMatchObject([{ level: 'none' }]);
    });

    it('takes a known NPC who would see it through a door not seen this turn as uncertain, and certain once the door is seen', () => {
        const walls: FixtureWall[] = Array.from({ length: 9 }, (_, y) => ({ between: [P(10, y), P(11, y)] as [Pos, Pos], ...(y === 3 ? { door: { id: 'd', lock: 'none' as const } } : {}) }));
        const make = () => {
            const s = lobby({ walls, teller: [P(14, 3), 'w'], body: P(7, 3) });
            s.state.doors.d = { status: 'open' };
            s.state.knowledge.doors.d = 'open';
            return s;
        };
        const doubted = make();
        freshOnly(doubted.world, doubted.state, p => p.x <= 8);
        const [w] = evidenceWarnings(doubted.world, doubted.state);
        expect(w).toMatchObject({ level: 'uncertain', certain: [] });
        expect(w!.doubted.map(f => f.id)).toEqual(['teller']);
        expect(warningLines(doubted.world, w!)[0]!.text).toBe('Next phase: Teller could find the body (a door not seen this turn)');
        expect(foundStop(doubted.world, doubted.state)).toBeNull();
        // Seen standing open this turn: the teller sees the body through it for certain.
        const seen = make();
        expect(evidenceWarnings(seen.world, seen.state)).toMatchObject([{ level: 'certain', certain: [{ id: 'teller', by: 'npc', from: P(14, 3) }] }]);
    });
});
