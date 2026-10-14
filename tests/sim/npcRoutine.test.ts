import { describe, expect, it } from 'vitest';
import { generateBank } from '../../src/gen/generate';
import type { Archetype, Tier } from '../../src/gen/model';
import {
    commit, hashOf, initialState, worldFromBank, type CrewStart, type Intent, type Pos, type ReadonlyWorld, type SimEvent, type State
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

const TURNS = 45;
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

    it('start the day\'s events on their turns', () => {
        const all: string[] = [];
        for (const spec of BANKS) {
            const day = runDay(spec);
            const checked = new Set<string>();
            for (const person of day.world.people) {
                person.schedule.forEach((block, index) => {
                    if (block.from < 2 || block.from > TURNS || !['lunch', 'cashRun', 'inspection', 'closingSweep', 'offMap', 'shiftChange', 'smokeBreak'].includes(block.activity)) return;
                    // A block that starts on turn T is the intent committed for T's world phase: shown in T's crew phase.
                    const state = day.states[block.from - 1]!;
                    expect(state.turn).toBe(block.from);
                    const npc = state.npcs.find(n => n.id === person.id)!;
                    const later = person.schedule.findIndex((b, i) => i > index && b.from === block.from);
                    if (later >= 0) return;
                    expect(npc.goal.block, `${person.id} ${block.activity} on turn ${block.from}`).toBe(index);
                    checked.add(block.activity);
                });
            }
            expect(checked.has('closingSweep'), `${spec.tier} ${spec.archetype}`).toBe(true);
            expect(checked.has('lunch') || checked.has('offMap'), `${spec.tier} ${spec.archetype}: lunch`).toBe(true);
            expect(checked.has('shiftChange'), `${spec.tier} ${spec.archetype}: shift change`).toBe(true);
            all.push(...checked);
        }
        // Across the sample: the cash run and the manager's inspection too.
        expect(all).toContain('cashRun');
        expect(all).toContain('inspection');
    }, 120_000);

    it('send people where their schedule says', () => {
        const day = runDay(BANKS[2]!);
        const arrived = (id: string, tile: Pos, from: number, to: number): boolean =>
            day.states.slice(from - 1, to).some(s => s.npcs.some(n => n.id === id && key(n.pos) === key(tile)));
        let checked = 0;
        for (const person of day.world.people) {
            person.schedule.forEach((block, i) => {
                const next = person.schedule[i + 1]?.from ?? TURNS;
                if (!block.at || next - block.from < 4 || next > TURNS || block.activity === 'leave' || block.activity === 'offMap') return;
                // Walking at 4 tiles a phase, anyone gets anywhere in a bank this size within a few turns.
                expect(arrived(person.id, block.at, block.from, next), `${person.id} to ${block.activity} at ${key(block.at)} turns ${block.from}–${next}`).toBe(true);
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
