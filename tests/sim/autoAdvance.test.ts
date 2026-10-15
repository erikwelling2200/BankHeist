import { describe, expect, it } from 'vitest';
import { generateBank } from '../../src/gen/generate';
import { newHeist } from '../../src/game/heist';
import {
    autoAdvance, autoAdvanceBlocked, autoStep, clonePlain, commit, fixtureWorld, hashOf, initialState, interruptsOf, isKnownNow, knownSchedule,
    planRoute, routeBreak, waitOptions, waitReached, type PersonDef, type Pos, type ReadonlyWorld, type ScheduleBlock, type SimEvent, type State
} from '../../src/sim';
import { scouted, testEvent } from './helpers';

const P = (x: number, y: number): Pos => ({ x, y });
const row = (y: number, from: number, to: number): Pos[] => Array.from({ length: to - from + 1 }, (_, i) => P(from + i, y));

const post = (at: Pos, from = 1, facing: ScheduleBlock['facing'] = 'w'): ScheduleBlock => ({ from, activity: 'post', label: 'at post', room: '', at, facing });
const person = (id: string, role: string, pos: Pos, schedule: ScheduleBlock[], extra: Partial<PersonDef> = {}): PersonDef =>
    ({ id, name: id, role, observer: 'staff', pos, facing: 'w', schedule, ...extra });

/**
 * A long public street (row 0) and a staff back room behind a tall wall (row 2), joined at the far east end: the crew
 * walks the street; whoever is in the back room is out of sight unless the crew knows their routine.
 */
function street(people: PersonDef[]): ReadonlyWorld {
    return fixtureWorld([
        '........................',
        'TTTTTTTTTTTTTTTTTTTTTTT.',
        'sssssssssssssssssssssss.'
    ], { zones: ['........................', '.......................s', 'sssssssssssssssssssssss.'], people });
}

const start = (world: ReadonlyWorld, crew = [{ id: 'jun', name: 'Jun', pos: P(0, 0), facing: 'e' as const }]): State => initialState(world, { seed: 9, crew });

/** What the crew would know of an NPC: forget it (the crew never saw it). */
function forget(state: State, id: string): State {
    const s = clonePlain(state);
    delete s.knowledge.npcs[id];
    return s;
}

describe('auto-advance: routes', () => {
    it('walks a multi-turn route two Moves a turn and stops when it is walked, with nothing to interrupt', () => {
        const world = street([]);
        const state = scouted(world, start(world));
        const route = row(0, 1, 18);
        const plan = planRoute(world, state, 'jun', route);
        // 5 tiles a Move, two Moves a turn: 18 tiles over two turns.
        expect(plan.walkable).toBe(18);
        expect(plan.legs.map(l => [l.turn, l.path.length])).toEqual([[1, 5], [1, 5], [2, 5], [2, 3]]);
        const run = autoAdvance(world, state, { jun: route });
        expect(run.stop).toMatchObject({ kind: 'arrived' });
        expect(run.state.crew[0]!.pos).toEqual(P(18, 0));
        expect(run.turnsPlayed).toBe(1);
        // Moves only: a Dash is never automatic.
        expect(run.played.map(p => p.command.type)).toEqual(['move', 'move', 'endTurn', 'move', 'move']);
    });

    it('replays the same route to the same state', () => {
        const world = street([person('clerk', 'clerk', P(10, 2), [post(P(10, 2)), { from: 3, activity: 'break', label: 'break', room: '', at: P(4, 2), facing: 'n' }])]);
        const state = scouted(world, start(world));
        const route = [...row(0, 1, 23), P(23, 1), P(23, 2), ...row(2, 15, 22).reverse()];
        const a = autoAdvance(world, state, { jun: route }, { cap: 6 });
        const b = autoAdvance(world, clonePlain(state), { jun: clonePlain(route) }, { cap: 6 });
        expect(hashOf(a.state)).toBe(hashOf(b.state));
        expect(a.played.map(p => p.command)).toEqual(b.played.map(p => p.command));
        expect(a.stop).toEqual(b.stop);
    });

    it('cuts a dragged route at a wall, but not at an NPC (they move)', () => {
        const world = street([person('clerk', 'clerk', P(3, 0), [post(P(3, 0))])]);
        const state = scouted(world, start(world));
        expect(routeBreak(world, state, 'jun', row(0, 1, 6))).toBe(-1);
        expect(routeBreak(world, state, 'jun', [P(1, 0), P(1, 1)])).toBe(1);
    });

    it('stops when the route is blocked by someone the crew knows stands there', () => {
        const world = street([person('clerk', 'clerk', P(3, 0), [post(P(3, 0))])]);
        const run = autoAdvance(world, scouted(world, start(world)), { jun: row(0, 1, 6) });
        expect(run.stop?.kind).toBe('blocked');
        expect(run.state.crew[0]!.pos).toEqual(P(2, 0));
    });

    it('is unavailable while an NPC the crew knows of is Alerted, but not for one it doesn’t know', () => {
        const world = street([person('clerk', 'clerk', P(10, 2), [post(P(10, 2))])]);
        const s = clonePlain(scouted(world, start(world)));
        s.npcs[0]!.status = 'alerted';
        expect(autoAdvanceBlocked(world, s)).toMatch(/clerk is alerted/);
        expect(autoStep(world, s, { jun: row(0, 1, 4) }).stop?.kind).toBe('unavailable');
        expect(autoAdvanceBlocked(world, forget(s, 'clerk'))).toBeNull();
        const loud = clonePlain(s);
        loud.npcs[0]!.status = 'calm';
        loud.bank.loud = true;
        expect(autoAdvanceBlocked(world, loud)).toMatch(/loud/);
    });
});

describe('auto-advance: interrupts', () => {
    const world = street([person('clerk', 'clerk', P(10, 2), [post(P(10, 2))]), person('ghost', 'cleaner', P(20, 2), [post(P(20, 2))])]);
    const known = forget(scouted(world, start(world)), 'ghost');
    const after = (s: State): State => ({ ...s, turn: s.turn });
    const kinds = (events: SimEvent[], before = known, state = after(known)) => interruptsOf(world, before, { state, events }).map(i => i.kind);

    it('stops on nothing when nothing happens', () => {
        expect(kinds([testEvent({ type: 'moved', crew: 'jun', from: P(0, 0), to: P(1, 0), path: [P(1, 0)] })])).toEqual([]);
        expect(kinds([testEvent({ type: 'revealed', what: 'tiles', id: '12' })])).toEqual([]);
    });

    it.each([
        ['carrier', { type: 'carrierStarted', carrier: 'carrier-1', kind: 'tellerButton', countdown: 2 }],
        ['alerted', { type: 'alerted', npc: 'clerk', cause: 'x' }],
        ['alerted', { type: 'npcStatus', npc: 'clerk', status: 'alerted' }],
        ['exposed', { type: 'exposed', npc: 'clerk', crew: 'jun', why: [] }],
        ['challenge', { type: 'challenged', npc: 'clerk', crew: 'jun', deadline: 3 }],
        ['moveCut', { type: 'moveCut', crew: 'jun', npc: 'clerk', reason: 'bump', at: P(1, 0), planned: [P(1, 0), P(2, 0)] }],
        ['suspicion', { type: 'suspicionRaised', npc: 'clerk', crew: 'jun', added: 1, total: 1, why: [] }],
        ['evidence', { type: 'evidenceNoticed', npc: 'clerk', evidence: 'blood-1', kind: 'blood', major: true }],
        ['revealed', { type: 'revealed', what: 'room', id: 'vault-1' }]
    ] as const)('stops on %s', (kind, event) => {
        expect(kinds([testEvent(event as unknown as { type: string })])[0]).toBe(kind);
    });

    it.each([
        ['alerted', { type: 'alerted', npc: 'ghost', cause: 'x' }],
        ['exposed', { type: 'exposed', npc: 'ghost', crew: 'jun', why: [] }],
        ['suspicion', { type: 'suspicionRaised', npc: 'ghost', crew: 'jun', added: 1, total: 1, why: [] }],
        ['evidence', { type: 'evidenceNoticed', npc: 'ghost', evidence: 'blood-1', kind: 'blood', major: true }],
        ['arrival', { type: 'npcEntered', npc: 'ghost', at: P(23, 2) }]
    ] as const)('doesn’t stop on %s of an NPC the crew doesn’t know of', (_kind, event) => {
        expect(kinds([testEvent(event as unknown as { type: string })])).toEqual([]);
    });

    it('stops on a new NPC revealed, not on one seen before', () => {
        const ev = testEvent({ type: 'revealed', what: 'npc', id: 'ghost' });
        const seen = clonePlain(known);
        seen.knowledge.npcs.ghost = { at: P(20, 2), facing: 'w', turn: 1, live: true, routine: false, rota: false, watched: 1, watchedTurn: 1, tick: seen.knowledge.tick + 1 };
        expect(kinds([ev], known, seen)).toEqual(['revealed']);
        expect(kinds([ev], seen, seen)).toEqual([]);
    });

    it('stops on an arrival of someone whose routine the crew doesn’t know, once they are seen', () => {
        const seen = clonePlain(known);
        seen.knowledge.npcs.ghost = { at: P(23, 2), facing: 'w', turn: 1, live: true, routine: false, rota: false, watched: 1, watchedTurn: 1, tick: seen.knowledge.tick + 1 };
        expect(kinds([testEvent({ type: 'npcEntered', npc: 'ghost', at: P(23, 2) })], known, seen)).toEqual(['arrival']);
        // A known routine's return is a schedule event, not an arrival.
        expect(kinds([testEvent({ type: 'npcEntered', npc: 'clerk', at: P(23, 2) })])).toEqual([]);
    });

    it('stops when an NPC the crew sees turns toward a crew member, with a line naming them', () => {
        const turned = clonePlain(known);
        turned.npcs[0]!.goal = { kind: 'face', crew: 'jun', tile: P(0, 0) };
        const stops = interruptsOf(world, known, { state: turned, events: [] });
        expect(stops.map(s => s.kind)).toEqual(['intent']);
        expect(stops[0]!.text).toBe('the clerk turned toward Jun');
        // The same change in an NPC the crew doesn't know of says nothing.
        const unseen = clonePlain(known);
        unseen.npcs[1]!.goal = { kind: 'face', crew: 'jun', tile: P(0, 0) };
        expect(interruptsOf(world, known, { state: unseen, events: [] })).toEqual([]);
    });

    it('stops on a schedule event of a routine the crew knows, not of one it doesn’t', () => {
        const w = street([
            person('clerk', 'clerk', P(10, 2), [post(P(10, 2)), { from: 3, activity: 'break', label: 'break', room: '', at: P(12, 2), facing: 'n' }]),
            person('ghost', 'cleaner', P(20, 2), [post(P(20, 2)), { from: 2, activity: 'break', label: 'break', room: '', at: P(18, 2), facing: 'n' }])
        ]);
        let state = forget(scouted(w, start(w)), 'ghost');
        const first = autoStep(w, state, {}, { target: { kind: 'turn', turn: 10 } });
        // Turn 2: only the unknown cleaner's break starts. Nothing stops.
        expect(first.stop).toBeNull();
        state = first.state;
        const second = autoStep(w, state, {}, { target: { kind: 'turn', turn: 10 } });
        expect(second.stop).toMatchObject({ kind: 'schedule', npc: 'clerk', text: 'the clerk: break' });
        expect(knownSchedule(w, forget(scouted(w, start(w)), 'ghost'))).toEqual([{ turn: 3, npc: 'clerk', label: 'the clerk: break' }]);
    });

    it('stops a real move cut short by someone the crew had never seen', () => {
        const w = fixtureWorld(['............', 'TTTTTT.TTTTT', '............'], { people: [person('hidden', 'clerk', P(6, 2), [post(P(6, 2), 1, 'n')], { facing: 'n' })] });
        const state = start(w);
        const run = autoAdvance(w, state, { jun: row(0, 1, 11) });
        expect(['moveCut', 'revealed']).toContain(run.stop?.kind);
        expect(run.state.crew[0]!.pos.x).toBeLessThan(11);
    });
});

describe('Wait for…', () => {
    const clerkDay: ScheduleBlock[] = [
        post(P(10, 2)),
        { from: 3, activity: 'leave', label: 'lunch (out of the building)', room: '', at: P(23, 2) },
        { from: 12, activity: 'post', label: 'at post', room: '', at: P(10, 2), facing: 'w' }
    ];

    it('waits for the next schedule event the crew knows of', () => {
        const world = street([person('clerk', 'clerk', P(10, 2), clerkDay)]);
        const state = scouted(world, start(world));
        const options = waitOptions(world, state, P(0, 0));
        expect(options[0]).toMatchObject({ target: { kind: 'turn', turn: 3 } });
        const run = autoAdvance(world, state, {}, { target: options[0]!.target });
        expect(run.stop).toMatchObject({ kind: 'target' });
        expect(run.state.turn).toBe(3);
        // An NPC the crew has never seen puts nothing on its timeline.
        expect(knownSchedule(world, forget(state, 'clerk'))).toEqual([]);
    });

    it('waits until a known NPC leaves, then until they are back', () => {
        const world = street([person('clerk', 'clerk', P(10, 2), clerkDay)]);
        const state = scouted(world, start(world));
        const leaves = waitOptions(world, state).find(o => o.target.kind === 'leaves')!;
        expect(leaves.label).toBe('Until the clerk leaves');
        const out = autoAdvance(world, state, {}, { target: leaves.target });
        expect(out.stop).toMatchObject({ kind: 'target', text: 'the clerk left' });
        expect(out.state.npcs[0]!.status).toBe('away');
        const back = waitOptions(world, out.state).find(o => o.target.kind === 'arrives')!;
        expect(back.label).toBe('Until the clerk is back');
        const run = autoAdvance(world, out.state, {}, { target: back.target });
        expect(run.stop).toMatchObject({ kind: 'target', text: 'the clerk is back' });
        expect(run.state.npcs[0]!.status).not.toBe('away');
    });

    it('waits until the guard passes a tile', () => {
        const route = [P(4, 2), P(20, 2)];
        const world = street([person('guard', 'guard', P(4, 2), [{ from: 1, activity: 'patrol', label: 'patrol', room: '', route }], { observer: 'enforcer' })]);
        let state = scouted(world, start(world));
        state = commit(world, state, { type: 'endTurn' }).state;
        const passes = waitOptions(world, state, P(12, 0)).find(o => o.target.kind === 'passes');
        expect(passes).toBeDefined();
        const target = { kind: 'passes' as const, npc: 'guard', tile: P(15, 2) };
        const run = autoAdvance(world, state, {}, { target });
        expect(run.stop).toMatchObject({ kind: 'target', text: 'the guard passed' });
        expect(run.state.npcs[0]!.pos.x).toBeGreaterThanOrEqual(15);
    });

    it('gives up after the turn cap', () => {
        const world = street([person('clerk', 'clerk', P(10, 2), [post(P(10, 2))])]);
        const state = scouted(world, start(world));
        const run = autoAdvance(world, state, {}, { target: { kind: 'leaves', npc: 'clerk', room: null }, cap: 5 });
        expect(run.stop).toMatchObject({ kind: 'cap' });
        expect(run.state.turn).toBe(6);
    });

    it('stops with "lost" when the NPC waited for can no longer be seen or predicted', () => {
        const world = street([person('clerk', 'clerk', P(10, 2), [post(P(10, 2))])]);
        const state = forget(scouted(world, start(world)), 'clerk');
        const stop = waitReached(world, { kind: 'leaves', npc: 'clerk', room: null }, state, { state, events: [] });
        expect(stop?.kind).toBe('lost');
    });
});

describe('auto-advance in a generated bank', () => {
    const bank = generateBank({ tier: 'small', archetype: 'twoWing', layout: 2000, population: 1, plot: 'midBlock' });
    const { world, state } = newHeist(bank);

    it('never stops on, or names, an NPC the crew doesn’t know of', () => {
        let s = state;
        for (let turn = 0; turn < 30; turn++) {
            const before = s, result = commit(world, s, { type: 'endTurn' });
            for (const stop of interruptsOf(world, before, result)) {
                if (stop.npc) expect(isKnownNow(world, result.state, stop.npc) || isKnownNow(world, before, stop.npc) || stop.kind === 'revealed').toBe(true);
            }
            s = result.state;
        }
    });

    it('waits through quiet turns and replays the same', () => {
        const target = { kind: 'turn' as const, turn: 8 };
        const a = autoAdvance(world, state, {}, { target });
        const b = autoAdvance(world, clonePlain(state), {}, { target });
        expect(a.stop).not.toBeNull();
        expect(a.stop).toEqual(b.stop);
        expect(hashOf(a.state)).toBe(hashOf(b.state));
    });

    it('walks a route toward the bank and stops for a reason the crew can see', () => {
        const jun = state.crew.find(c => c.id === 'jun')!;
        const route: Pos[] = [];
        let at = jun.pos;
        for (let i = 0; i < 12; i++) {
            const next = P(at.x, at.y - 1);
            if (routeBreak(world, state, 'jun', [...route, next]) !== -1) break;
            route.push(next);
            at = next;
        }
        expect(route.length).toBeGreaterThan(0);
        const run = autoAdvance(world, state, { jun: route });
        expect(run.stop).not.toBeNull();
        const again = autoAdvance(world, clonePlain(state), { jun: clonePlain(route) });
        expect(hashOf(run.state)).toBe(hashOf(again.state));
        if (run.stop!.kind === 'arrived') expect(run.state.crew.find(c => c.id === 'jun')!.pos).toEqual(route.at(-1));
    });
});
