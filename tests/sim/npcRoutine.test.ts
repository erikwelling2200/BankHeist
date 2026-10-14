import { describe, expect, it } from 'vitest';
import { generateBank } from '../../src/gen/generate';
import type { Archetype, Tier } from '../../src/gen/model';
import {
    commit, hashOf, initialState, npcCanPass, paceBudget, reachable, reachAt, worldFromBank, type CrewStart, type Intent, type Pos,
    type ReadonlyWorld, type SimEvent, type State
} from '../../src/sim';

/*
 * M1-06 on generated banks: everyone runs their schedule for a whole day (45 turns) with nobody stuck, never two on
 * one tile or anyone on a blocked tile; every NPC walks exactly the intent it committed the phase before (§6.2);
 * the day's events (lunch, the cash run, the inspection, the closing sweep) start on their turns; and it all replays
 * the same.
 */

const BANKS: { tier: Tier; archetype: Archetype; layout: number; population: number }[] = [
    { tier: 'small', archetype: 'twoWing', layout: 2000, population: 1 },
    { tier: 'small', archetype: 'threeKeys', layout: 31, population: 7 },
    { tier: 'city', archetype: 'atrium', layout: 2000, population: 1 },
    { tier: 'city', archetype: 'mezzanineWatch', layout: 4242, population: 3 },
    { tier: 'hq', archetype: 'fortress', layout: 2000, population: 1 }
];

const TURNS = 90;
/** How many phases an NPC may stand still short of where its routine sends it before it counts as stuck. */
const STUCK = 8;

const key = (p: Pos): string => `${p.x},${p.y}`;

interface Day {
    world: ReadonlyWorld;
    states: State[];
    events: SimEvent[][];
    problems: string[];
}

const DAYS = new Map<string, Day>();

/** A day in a bank, worked out once per test file. */
function runDay(spec: (typeof BANKS)[number]): Day {
    const id = JSON.stringify(spec);
    if (!DAYS.has(id)) DAYS.set(id, playDay(spec));
    return DAYS.get(id)!;
}

function playDay(spec: (typeof BANKS)[number], crew: CrewStart[] = []): Day {
    const bank = generateBank({ ...spec, plot: 'midBlock' });
    const world = worldFromBank(bank);
    let state = initialState(world, { seed: 7, crew });
    const states = [state], events: SimEvent[][] = [], problems: string[] = [];
    const still = new Map<string, number>();
    for (let turn = 1; turn <= TURNS; turn++) {
        const committed = new Map<string, Intent>(state.npcs.map(n => [n.id, n.intent]));
        const before = new Map(state.npcs.map(n => [n.id, n]));
        const result = commit(world, state, { type: 'endTurn' });
        state = result.state;
        states.push(state);
        events.push(result.events);
        // Executed = committed: every walk is the committed path, and nobody else moves.
        const walked = new Map<string, Pos[]>();
        for (const e of result.events) {
            if (e.type === 'npcWalked') walked.set(e.npc, e.path);
            if (e.type === 'npcEntered') walked.set(e.npc, [e.at]);
            if (e.type === 'npcBlocked') problems.push(`turn ${turn}: ${e.npc} blocked at ${key(e.at)}`);
        }
        for (const n of state.npcs) {
            const was = before.get(n.id)!, intent = committed.get(n.id)!;
            const path = walked.get(n.id) ?? [];
            if (key(path.at(-1) ?? was.pos) !== key(n.pos)) problems.push(`turn ${turn}: ${n.id} moved without walking`);
            if (JSON.stringify(path) !== JSON.stringify(intent.path)) problems.push(`turn ${turn}: ${n.id} walked ${JSON.stringify(path)}, committed ${JSON.stringify(intent.path)}`);
        }
        const tiles = new Map<string, string>();
        for (const n of state.npcs) {
            if (n.status === 'away') continue;
            const k = key(n.pos);
            if (tiles.has(k)) problems.push(`turn ${turn}: ${n.id} and ${tiles.get(k)} both on ${k}`);
            tiles.set(k, n.id);
            if (world.tiles[n.pos.y * world.width + n.pos.x]!.blocksMove) problems.push(`turn ${turn}: ${n.id} on a blocked tile ${k}`);
            const goal = n.goal, there = goal.tile && key(goal.tile) === k;
            const moved = key(before.get(n.id)!.pos) !== k;
            const count = goal.kind === 'routine' && !there && !moved ? (still.get(n.id) ?? 0) + 1 : 0;
            still.set(n.id, count);
            if (count === STUCK) problems.push(`turn ${turn}: ${n.id} stuck at ${k} on its way to ${JSON.stringify(goal)}`);
        }
        for (const c of state.crew) if (tiles.has(key(c.pos))) problems.push(`turn ${turn}: ${tiles.get(key(c.pos))} on ${c.id}'s tile`);
    }
    return { world, states, events, problems };
}

describe('NPC routines on generated banks', () => {
    for (const spec of BANKS) {
        it(`run a day in a ${spec.tier} ${spec.archetype} bank with nobody stuck or sharing a tile`, () => {
            const day = runDay(spec);
            expect(day.problems).toEqual([]);
            // People actually walk their day.
            const walks = day.events.flat().filter(e => e.type === 'npcWalked').length;
            expect(walks).toBeGreaterThan(TURNS);
        }, 60_000);
    }

    it('have people at their events on the timeline\'s turn, for as long as they last', () => {
        const EVENTS = ['lunch', 'cashRun', 'inspection', 'offMap', 'shiftChange', 'smokeBreak', 'serviceVisit'];
        const all: string[] = [];
        const missed: string[] = [];
        for (const spec of BANKS) {
            const day = runDay(spec);
            for (const person of day.world.people) {
                person.schedule.forEach((block, index) => {
                    if (!EVENTS.includes(block.activity)) return;
                    const next = person.schedule[index + 1];
                    const until = next ? next.setOff ?? next.from : TURNS;
                    if (block.from < 2 || until > TURNS) return;
                    // From the crew phase of its turn to the end of it, they are there (away, for lunch out).
                    for (let turn = block.from; turn < until; turn++) {
                        const npc = day.states[turn - 1]!.npcs.find(n => n.id === person.id)!;
                        const there = block.activity === 'offMap' ? npc.status === 'away' : key(npc.pos) === key(block.at!);
                        if (!there) {
                            missed.push(`${spec.tier} ${spec.archetype} ${person.id} ${block.activity} turn ${turn} (${block.from}–${until}) at ${key(npc.pos)}`);
                            return;
                        }
                    }
                    all.push(block.activity);
                });
            }
            // The closing sweep starts at closing, and is done in good time (the guards back at their posts).
            const sweeps = day.world.people.filter(p => p.schedule.some(b => b.activity === 'closingSweep'));
            expect(sweeps.length, `${spec.tier} ${spec.archetype}`).toBeGreaterThan(0);
            for (const guard of sweeps) {
                const block = guard.schedule.find(b => b.activity === 'closingSweep')!;
                expect(day.states[block.from - 1]!.npcs.find(n => n.id === guard.id)!.goal.block).toBe(guard.schedule.indexOf(block));
                const post = block.route!.at(-1)!;
                const done = day.states.slice(block.from).findIndex(s => key(s.npcs.find(n => n.id === guard.id)!.pos) === key(post));
                expect(done, `${spec.tier} ${spec.archetype} ${guard.id} sweep`).toBeGreaterThanOrEqual(0);
                // As fast as the walk allows: the cost of the route from where it starts, at the hurried pace, plus a phase
                // at each stop (a phase's walk ends there), and two to spare. Nobody stalls on the way.
                const start = day.states[block.from - 1]!;
                const options = { ignorePeople: true, canPassDoor: npcCanPass(guard) };
                let cost = 0, at: Pos = start.npcs.find(n => n.id === guard.id)!.pos;
                for (const stop of block.route!) {
                    cost += reachAt(reachable(day.world, start, at, day.world.width * day.world.height * 3, options), stop)!.cost;
                    at = stop;
                }
                const bound = Math.ceil(cost / paceBudget(day.world, 'hurry')) + block.route!.length + 2;
                expect(done, `${spec.tier} ${spec.archetype} ${guard.id} sweep`).toBeLessThanOrEqual(bound);
            }
        }
        expect(missed).toEqual([]);
        for (const activity of ['lunch', 'cashRun', 'inspection', 'shiftChange']) expect(all, activity).toContain(activity);
    }, 120_000);

    it('send people where their schedule says', () => {
        const day = runDay(BANKS[2]!);
        const arrived = (id: string, tile: Pos, from: number, to: number): boolean =>
            day.states.slice(from - 1, to).some(s => s.npcs.some(n => n.id === id && key(n.pos) === key(tile)));
        let checked = 0;
        for (const person of day.world.people) {
            person.schedule.forEach((block, i) => {
                const start = block.setOff ?? block.from, after = person.schedule[i + 1];
                const next = after ? after.setOff ?? after.from : TURNS;
                // Coming back in from the street takes its own time.
                const fromOutside = i > 0 && ['leave', 'offMap'].includes(person.schedule[i - 1]!.activity);
                if (!block.at || next - start < 4 || next > TURNS || fromOutside || block.activity === 'leave' || block.activity === 'offMap') return;
                // Walking at 4 tiles a phase, anyone gets anywhere in a bank this size within a few turns.
                expect(arrived(person.id, block.at, start, next), `${person.id} to ${block.activity} at ${key(block.at)} turns ${start}–${next}`).toBe(true);
                checked++;
            });
        }
        expect(checked).toBeGreaterThan(10);
        // Customers leave and come back; the closing sweep empties the bank of customers.
        const last = day.states.at(-1)!;
        const customers = last.npcs.filter(n => day.world.people.find(p => p.id === n.id)!.role === 'customer');
        expect(customers.length).toBeGreaterThan(0);
        expect(customers.every(n => n.status === 'away')).toBe(true);
        expect(day.events.flat().some(e => e.type === 'npcEntered')).toBe(true);
    }, 60_000);

    it('replay the same day exactly', () => {
        const a = runDay(BANKS[1]!), b = playDay(BANKS[1]!);
        expect(hashOf(a.states.at(-1)!)).toBe(hashOf(b.states.at(-1)!));
        expect(a.states.map(s => hashOf(s.npcs))).toEqual(b.states.map(s => hashOf(s.npcs)));
    }, 60_000);
});
