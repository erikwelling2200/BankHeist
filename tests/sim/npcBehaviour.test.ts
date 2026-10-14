import { describe, expect, it } from 'vitest';
import {
    activityAt, assessWorldPhase, commit, fixtureWorld, hashOf, initialState, investigatorOf, nextActivity, nextScheduleTurn, preview,
    sightMap, type Command, type CrewStart, type FixtureWall, type PersonDef, type Pos, type ReadonlyWorld, type ScheduleBlock, type SimEvent, type State
} from '../../src/sim';
import { step } from './helpers';

/*
 * M1-06 scenarios on small fixtures: schedules walked at the routine pace through doors that swing shut behind;
 * Curious, Investigating and the frisk; one investigates, the others watch; the cautious search; the trespass
 * challenge and escort; telling a guard; raising the alarm's intent; leaving and coming back; walks stopped by the crew.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const events = <T extends SimEvent['type']>(list: readonly SimEvent[], type: T): Extract<SimEvent, { type: T }>[] =>
    list.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

const post = (from: number, at: Pos, facing: ScheduleBlock['facing'] = 's', activity: ScheduleBlock['activity'] = 'post'): ScheduleBlock =>
    ({ from, activity, label: activity, room: '', at, facing });

function person(id: string, role: string, observer: PersonDef['observer'], pos: Pos, facing: PersonDef['facing'], schedule: ScheduleBlock[] = []): PersonDef {
    return { id, name: id, role, observer, pos, facing, schedule };
}

/** A public lobby (x < 6) and a staff room (x ≥ 6) with a door between them on row 2. */
function bank(people: PersonDef[], options: { lock?: 'mechanical'; walls?: FixtureWall[] } = {}): ReadonlyWorld {
    const W = 14, H = 6;
    const walls: FixtureWall[] = [];
    for (let y = 0; y < H; y++) {
        walls.push(y === 2 ? { between: [P(5, y), P(6, y)], door: { id: 'd', ...(options.lock ? { lock: options.lock, start: 'locked' as const } : {}) } } : { between: [P(5, y), P(6, y)] });
    }
    const zones = Array.from({ length: H }, () => '......' + 's'.repeat(W - 6));
    return fixtureWorld(zones.map(z => z.replace(/s/g, 's')), { zones, walls: [...walls, ...(options.walls ?? [])], people });
}

const start = (world: ReadonlyWorld, crew: CrewStart[] = []): State => initialState(world, { seed: 1, crew });

describe('schedules', () => {
    it('walk to a post at the routine pace, opening the door, which swings shut behind', () => {
        const world = bank([person('clerk', 'clerk', 'staff', P(1, 2), 'e', [post(1, P(11, 2), 'n')])]);
        let state = start(world);
        // Committed from the start, for the first crew phase to show: 4 tiles.
        expect(state.npcs[0]!.intent).toEqual({ path: [P(2, 2), P(3, 2), P(4, 2), P(5, 2)] });
        state = step(world, state, { type: 'endTurn' }).state;
        expect(state.npcs[0]!.pos).toEqual(P(5, 2));
        const through = step(world, state, { type: 'endTurn' });
        expect(events(through.events, 'doorOpened')).toEqual([{ type: 'doorOpened', door: 'd', by: 'clerk' }]);
        expect(events(through.events, 'doorClosed')).toEqual([{ type: 'doorClosed', door: 'd' }]);
        expect(through.state.npcs[0]!.pos).toEqual(P(9, 2));
        const there = step(world, through.state, { type: 'endTurn' }).state;
        expect(there.npcs[0]!.pos).toEqual(P(11, 2));
        expect(there.npcs[0]!.facing).toBe('n');
        expect(there.npcs[0]!.intent).toEqual({ path: [], facing: 'n' });
    });

    it('keep civilians out of locked doors, while staff carry the key', () => {
        const world = bank([
            person('customer', 'customer', 'civilian', P(1, 1), 's', [post(1, P(11, 1))]),
            person('clerk', 'clerk', 'staff', P(1, 3), 's', [post(1, P(11, 3))])
        ], { lock: 'mechanical' });
        let state = start(world);
        for (let i = 0; i < 5; i++) state = step(world, state, { type: 'endTurn' }).state;
        expect(state.npcs[0]!.pos.x).toBeLessThan(6);
        expect(state.npcs[1]!.pos).toEqual(P(11, 3));
        expect(state.doors.d!.status).toBe('locked');
    });

    it('patrol there and back, and answer what comes next', () => {
        const route = [P(0, 0), P(4, 0)];
        const world = bank([person('guard', 'patrolGuard', 'enforcer', P(0, 0), 's', [
            { from: 1, activity: 'patrol', label: 'patrol', room: '', route },
            post(4, P(0, 5), 'e')
        ])]);
        let state = start(world);
        const seen: Pos[] = [];
        for (let i = 0; i < 6; i++) {
            state = step(world, state, { type: 'endTurn' }).state;
            seen.push(state.npcs[0]!.pos);
        }
        expect(seen.slice(0, 3)).toEqual([P(4, 0), P(0, 0), P(4, 0)]);
        expect(seen.at(-1)).toEqual(P(0, 5));
        expect(activityAt(world, 'guard', 2)!.block.activity).toBe('patrol');
        expect(nextActivity(world, 'guard', 2)).toMatchObject({ index: 1, in: 2 });
        expect(nextScheduleTurn(world, 1)).toBe(4);
    });

    it('take people off the map and bring them back', () => {
        const world = bank([person('customer', 'customer', 'civilian', P(2, 2), 'n', [
            post(1, P(2, 2), 'n', 'queue'),
            { from: 2, activity: 'leave', label: 'leaving', room: '', at: P(0, 5) },
            post(4, P(2, 2), 'n', 'queue')
        ])]);
        let state = start(world);
        state = step(world, state, { type: 'endTurn' }).state;
        const out = step(world, state, { type: 'endTurn' });
        expect(events(out.events, 'npcLeft')).toHaveLength(1);
        state = out.state;
        expect(state.npcs[0]!.status).toBe('away');
        // Away: nowhere on the map. A crew member may stand where they left.
        const crewed = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 4) }] });
        crewed.npcs[0] = { ...state.npcs[0]! };
        expect(commit(world, crewed, { type: 'move', crew: 'jun', path: [P(0, 5)] }).state.crew[0]!.pos).toEqual(P(0, 5));
        // Back on turn 4: in at the way out on turn 4's world phase, then on to the queue.
        state = step(world, state, { type: 'endTurn' }).state;
        expect(state.npcs[0]!.intent).toEqual({ path: [P(0, 5)], action: { kind: 'enter' } });
        const back = step(world, state, { type: 'endTurn' });
        expect(events(back.events, 'npcEntered')).toEqual([{ type: 'npcEntered', npc: 'customer', at: P(0, 5) }]);
        expect(back.state.npcs[0]!.status).toBe('calm');
    });

    it('stop a walk where a crew member stepped onto it, and never share a tile', () => {
        const world = bank([person('customer', 'customer', 'civilian', P(0, 0), 's', [post(1, P(4, 0))])]);
        let state = start(world, [{ id: 'jun', pos: P(2, 1) }]);
        expect(state.npcs[0]!.intent.path).toEqual([P(1, 0), P(2, 0), P(3, 0), P(4, 0)]);
        // Jun steps onto the customer's path after it was committed: nobody minds, so the intent stands.
        state = step(world, state, { type: 'move', crew: 'jun', path: [P(2, 0)] }).state;
        expect(state.npcs[0]!.intent.path).toEqual([P(1, 0), P(2, 0), P(3, 0), P(4, 0)]);
        const result = step(world, state, { type: 'endTurn' });
        expect(events(result.events, 'npcBlocked')).toEqual([{ type: 'npcBlocked', npc: 'customer', at: P(1, 0), next: P(2, 0), by: 'jun' }]);
        expect(result.state.npcs[0]!.pos).toEqual(P(1, 0));
        expect(result.state.npcs[0]!.facing).toBe('e');
        // Next phase it walks round him.
        const round = step(world, result.state, { type: 'endTurn' }).state;
        expect(round.npcs[0]!.pos).toEqual(P(4, 0));
    });
});

describe('blocked walks', () => {
    it('limit what an NPC sees to where it gets, in the overlay and the outcome alike', () => {
        // A guard walks east along row 1; the street (row 0) is open to it only through the gap at x = 5.
        const walls: FixtureWall[] = [];
        for (let x = 0; x < 20; x++) if (x !== 5) walls.push({ between: [P(x, 1), P(x, 2)] });
        const world = fixtureWorld(['....................', '....................', 'ssssssssssssssssssss'], {
            walls, people: [person('g', 'guard', 'enforcer', P(1, 1), 'e', [{ from: 1, activity: 'patrol', label: 'patrol', room: '', route: [P(1, 1), P(5, 1)] }])]
        });
        let state = start(world, [{ id: 'gun', pos: P(10, 0), items: ['assaultRifle'] }, { id: 'blocker', pos: P(6, 0) }]);
        // Unblocked, the guard would see the rifle from the end of its walk.
        expect(assessWorldPhase(world, state, sightMap(world, state), 'gun', P(10, 0)).map(s => s.observer)).toEqual(['g']);
        // Someone steps into its way: it stops short, and sees nothing.
        state = step(world, state, { type: 'move', crew: 'blocker', path: [P(5, 0), P(4, 0), P(3, 1)] }).state;
        expect(assessWorldPhase(world, state, sightMap(world, state), 'gun', P(10, 0))).toEqual([]);
        const r = step(world, state, { type: 'endTurn' });
        expect(events(r.events, 'npcBlocked')).toEqual([{ type: 'npcBlocked', npc: 'g', at: P(2, 1), next: P(3, 1), by: 'blocker' }]);
        expect(r.state.npcs[0]!.exposedTo).toEqual([]);
    });
});

describe('suspicion and search', () => {
    /** An open public floor with a guard on it. */
    const floor = (people: PersonDef[], dark: Pos[] = []): ReadonlyWorld =>
        fixtureWorld(Array.from({ length: 15 }, () => '.'.repeat(15)), { people, dark });

    it('rewrite the intent in the crew phase, the same in a preview', () => {
        const world = floor([person('g', 'guard', 'enforcer', P(3, 7), 'e')]);
        const state = start(world, [{ id: 'jun', pos: P(4, 9), items: ['pistol'] }]);
        const cmd: Command = { type: 'move', crew: 'jun', path: [P(4, 8)] };
        const shown = preview(world, state, cmd), done = commit(world, state, cmd);
        expect(hashOf(shown.state)).toBe(hashOf(done.state));
        expect(done.state.npcs[0]!.intent).toEqual({ path: [], facing: 'se' });
        expect(done.undoable).toBe(false);
    });

    it('frisk next to the crew member: Exposed if anything is Concealed, and the overlay shows it', () => {
        const world = floor([person('g', 'guard', 'enforcer', P(5, 5), 'n')]);
        for (const [items, found] of [[['pistol'], true], [[], false]] as const) {
            const state = start(world, [{ id: 'jun', pos: P(5, 6), items: [...items] }]);
            // Behind the guard, unseen: only the frisk can find him.
            const npc = state.npcs[0]!;
            npc.suspicion = { jun: 2 };
            npc.wants = [{ kind: 'investigate', crew: 'jun', tile: P(5, 7), decided: { turn: 1, phase: 'crew' } }];
            npc.lastSeen = { jun: { tile: P(5, 7), turn: 1 } };
            npc.intent = { path: [], facing: 'n', action: { kind: 'frisk', crew: 'jun' } };
            const shown = assessWorldPhase(world, state, sightMap(world, state), 'jun', P(5, 6));
            expect(shown.map(s => [s.observer, s.outcome, s.why])).toEqual(found ? [['g', '!', ['frisk']]] : []);
            // Out of reach, no frisk.
            expect(assessWorldPhase(world, state, sightMap(world, state), 'jun', P(5, 8))).toEqual([]);
            const result = step(world, state, { type: 'endTurn' });
            expect(events(result.events, 'frisked')).toEqual([{ type: 'frisked', npc: 'g', crew: 'jun', found }]);
            const g = result.state.npcs[0]!;
            expect(g.exposedTo).toEqual(found ? ['jun'] : []);
            if (!found) {
                // Satisfied: it watches instead of investigating again, until its suspicion rises; no search either.
                expect(g.frisked).toEqual({ jun: 2 });
                expect(g.goal.kind).toBe('watch');
                expect(g.intent.action).toBeUndefined();
                expect(g.search).toBeNull();
            }
        }
    });

    it('send one to investigate, the nearest of the right role, while the others watch', () => {
        const world = floor([
            person('teller', 'teller', 'staff', P(6, 6), 'n'),
            person('far', 'guard', 'enforcer', P(13, 13), 'n'),
            person('near', 'guard', 'enforcer', P(9, 9), 'n')
        ]);
        let state = start(world, [{ id: 'jun', pos: P(0, 0) }]);
        for (const npc of state.npcs) {
            npc.suspicion = { jun: 2 };
            npc.wants = [{ kind: 'investigate', crew: 'jun', tile: P(4, 4), decided: { turn: 1, phase: 'crew' } }];
            npc.lastSeen = { jun: { tile: P(4, 4), turn: 1 } };
        }
        expect(investigatorOf(world, state, 'jun')).toBe('near');
        state = step(world, state, { type: 'endTurn' }).state;
        expect(state.npcs.map(n => [n.id, n.goal.kind, n.status])).toEqual([
            ['teller', 'watch', 'curious'], ['far', 'watch', 'curious'], ['near', 'investigate', 'investigating']
        ]);
        // Hurried, 5 tiles: two diagonals and the third onto the teller's tile, where it can't stop.
        expect(state.npcs[2]!.intent.path).toEqual([P(8, 8), P(7, 7)]);
        expect(state.npcs[2]!.intent.action).toEqual({ kind: 'frisk', crew: 'jun' });
        expect(state.npcs[0]!.intent).toEqual({ path: [], facing: 'nw' });
        // Handing the investigation over starts no search: the nearest guard goes down, and the far one takes over.
        state.npcs[2]!.status = 'unconscious';
        state.npcs[1]!.lastSeen = { jun: { tile: P(4, 4), turn: state.turn } };
        state = step(world, state, { type: 'endTurn' }).state;
        expect(state.npcs[1]!.goal.kind).toBe('investigate');
        expect(state.npcs[2]!.search).toBeNull();
        expect(state.npcs[2]!.goal).toEqual({ kind: 'still' });
    });

    it('search a lost trail: watch it one more phase, then walk to the last known tile, then back to routine', () => {
        const world = floor([person('g', 'guard', 'enforcer', P(7, 7), 'n', [post(1, P(7, 7), 'n')])]);
        let state = start(world, [{ id: 'jun', pos: P(0, 14) }]);
        const g = () => state.npcs[0]!;
        g().suspicion = { jun: 2 };
        g().wants = [{ kind: 'investigate', crew: 'jun', tile: P(7, 2), decided: { turn: 1, phase: 'crew' } }];
        g().goal = { kind: 'investigate', crew: 'jun', tile: P(7, 2) };
        // Unseen this phase: its suspicion falls to 1, and it searches.
        state = step(world, state, { type: 'endTurn' }).state;
        expect(g().search).toEqual({ tile: P(7, 2), until: 3 });
        expect(g().intent).toEqual({ path: [], facing: 'n' });
        state = step(world, state, { type: 'endTurn' }).state;
        expect(g().intent.path.at(-1)).toEqual(P(7, 2));
        expect(g().status).toBe('investigating');
        state = step(world, state, { type: 'endTurn' }).state;
        expect(g().search).toBeNull();
        expect(g().goal.kind).toBe('routine');
    });
});

describe('trespass', () => {
    it('walks the challenger over, then escorts to the boundary and goes back to its post', () => {
        const world = bank([person('clerk', 'clerk', 'staff', P(12, 2), 'w', [post(1, P(12, 2), 'w')])]);
        let state = start(world, [{ id: 'jun', pos: P(4, 2) }]);
        // Through the door into the staff room, in the clerk's view: challenged.
        let r = step(world, state, { type: 'move', crew: 'jun', path: [P(5, 2), P(6, 2), P(7, 2)] });
        expect(events(r.events, 'challenged')).toHaveLength(1);
        state = r.state;
        const clerk = () => state.npcs[0]!;
        expect(clerk().goal).toEqual({ kind: 'challenge', crew: 'jun', tile: P(7, 2) });
        expect(clerk().status).toBe('investigating');
        expect(clerk().intent.path.length).toBeGreaterThan(0);
        expect(clerk().intent.facing).toBe('w');
        state = step(world, state, { type: 'endTurn' }).state;
        expect(clerk().pos.x).toBeLessThan(12);
        // Jun complies: back to the lobby before the deadline.
        state = step(world, state, { type: 'move', crew: 'jun', path: [P(6, 2), P(5, 2), P(4, 2)] }).state;
        r = step(world, state, { type: 'endTurn' });
        expect(events(r.events, 'challengeEnded')[0]!.result).toBe('complied');
        state = r.state;
        expect(clerk().goal.kind).toBe('escort');
        // Follows to the boundary and never onto the Public floor.
        expect(clerk().intent.path.every(p => p.x >= 6)).toBe(true);
        state = step(world, state, { type: 'endTurn' }).state;
        expect(clerk().pos.x).toBeGreaterThanOrEqual(6);
        // The escort is over: back to the post.
        expect(clerk().goal.kind).toBe('routine');
        for (let i = 0; i < 3; i++) state = step(world, state, { type: 'endTurn' }).state;
        expect(clerk().pos).toEqual(P(12, 2));
        expect(clerk().status).toBe('calm');
    });
});

describe('reactions', () => {
    it('send staff without a button to tell the nearest guard, who is Exposed too', () => {
        const world = bank([
            person('cleaner', 'cleaner', 'staff', P(8, 2), 'w', [post(1, P(8, 2), 'w')]),
            person('guard', 'patrolGuard', 'enforcer', P(13, 5), 'e', [post(1, P(13, 5), 'e')])
        ]);
        let state = start(world, [{ id: 'jun', pos: P(4, 2), items: ['assaultRifle'] }]);
        // An assault rifle seen in the staff room: Exposed at once; the cleaner sets off for the guard at once.
        state = step(world, state, { type: 'move', crew: 'jun', path: [P(5, 2), P(6, 2)] }).state;
        expect(state.npcs[0]!.exposedTo).toEqual(['jun']);
        expect(state.npcs[0]!.intent.action).toEqual({ kind: 'tell', npc: 'guard', crew: 'jun' });
        expect(state.npcs[0]!.status).toBe('alerted');
        state = step(world, state, { type: 'move', crew: 'jun', path: [P(5, 2), P(4, 2), P(3, 2)] }).state;
        let told: SimEvent[] = [];
        for (let i = 0; i < 4 && !told.length; i++) {
            const r = step(world, state, { type: 'endTurn' });
            told = events(r.events, 'told');
            state = r.state;
        }
        expect(told).toEqual([{ type: 'told', npc: 'cleaner', guard: 'guard', crew: 'jun' }]);
        expect(state.npcs[1]!.exposedTo).toEqual(['jun']);
        expect(state.npcs[0]!.reported).toEqual(['jun']);
        // The guard reacts by role: a radio call where it stands (M1-08 starts the carrier).
        expect(state.npcs[1]!.intent.action).toEqual({ kind: 'raiseAlarm', carrier: 'guardRadio', crew: 'jun' });
    });

    it('send a teller to the window, and commit the alarm only once there', () => {
        const world = bank([person('teller', 'teller', 'staff', P(7, 0), 's', [post(1, P(13, 5), 'w', 'window')])]);
        let state = start(world, [{ id: 'jun', pos: P(3, 3), items: ['assaultRifle'] }]);
        state = step(world, state, { type: 'move', crew: 'jun', path: [P(4, 2), P(5, 2), P(6, 2)] }).state;
        expect(state.npcs[0]!.exposedTo).toEqual(['jun']);
        const teller = () => state.npcs[0]!;
        // Too far to reach the window this phase: the walk is telegraphed, the alarm not yet.
        expect(teller().goal.kind).toBe('react');
        expect(teller().intent.path.length).toBeGreaterThan(0);
        expect(teller().intent.action).toBeUndefined();
        state = step(world, state, { type: 'endTurn' }).state;
        expect(teller().intent.path.at(-1)).toEqual(P(13, 5));
        expect(teller().intent.action).toEqual({ kind: 'raiseAlarm', carrier: 'tellerButton', crew: 'jun' });
    });
});
