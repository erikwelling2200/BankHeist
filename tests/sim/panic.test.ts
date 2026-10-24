import { describe, expect, it } from 'vitest';
import { cachedBank } from '../bankCache';
import {
    commandPlan, commit, fixtureWorld, initialState, preview, projectEvents, worldFromBank, type CrewStart, type Facing, type ObserverClass, type PersonDef,
    type Pos, type ReadonlyWorld, type SimEvent, type State
} from '../../src/sim';
import { wayOut } from '../../src/sim/rules/command';
import { step } from './helpers';

/*
 * Panic, civilians and armed civilians (M2-02; §10.8, §10.9, §16.2, §16.4, the escapee and phone carriers of §9.1):
 * the panic-spread fixture, reactions picked and shown a world phase before they are carried out, the off-duty cop's
 * telegraphed draw, the hero's tackle, hiding to phone it in, and the escapee's counters (blocking the route, tackling).
 */

const P = (x: number, y: number): Pos => ({ x, y });

/** Someone who stands where they are until they leave by `exit` at turn 99 (their way out). */
const person = (id: string, role: string, observer: ObserverClass, pos: Pos, facing: Facing = 'n', traits: Pick<PersonDef, 'armed' | 'hero'> = {}, exit: Pos = P(13, 0)): PersonDef => ({
    id, name: id, role, observer, pos, facing, ...traits, schedule: [
        { from: 1, activity: 'wait', label: 'waiting', room: '', at: pos, facing },
        { from: 99, activity: 'leave', label: 'leaving', room: '', at: exit }
    ]
});
const customer = (id: string, pos: Pos, facing: Facing = 'n', traits: Pick<PersonDef, 'armed' | 'hero'> = {}): PersonDef => person(id, 'customer', 'civilian', pos, facing, traits);

const OPEN = Array.from({ length: 9 }, () => '..............');

function setup(map: readonly string[], people: PersonDef[], crew: CrewStart[], seed = 7): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(map, { people });
    return { world, state: initialState(world, { seed, crew }) };
}

const npc = (state: State, id: string) => state.npcs.find(n => n.id === id)!;
const endTurn = (world: ReadonlyWorld, state: State) => step(world, state, { type: 'endTurn' });
const of = <K extends SimEvent['type']>(events: readonly SimEvent[], type: K) => events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);

/** Panics an NPC as an exposure would have in this crew phase, frozen, its reaction not yet picked. */
function frighten(state: State, id: string, crew: string | null = null): void {
    const n = npc(state, id);
    n.panic = { since: { turn: state.turn, phase: 'crew' }, crew, tile: { ...n.pos }, reaction: null };
    n.status = 'panicked';
    n.alerted = true;
    n.intent = { path: [], action: { kind: 'panic' } };
    n.goal = { kind: 'panic', tile: { ...n.pos } };
}

describe('panic spreading (the panic-spread fixture)', () => {
    it('spreads one ring a world phase, to civilians within 3 tiles who see a panicked one', () => {
        const { world, state } = setup(OPEN, [
            customer('a', P(2, 4), 'e'),
            // Sees a, 2 tiles away.
            customer('b', P(4, 4), 'w'),
            // Sees b 3 tiles away, but a is 5 away.
            customer('c', P(7, 4), 'w'),
            // Within 3 tiles of a, but looking away.
            customer('d', P(4, 6), 's'),
            // 5 tiles from c: too far.
            customer('e', P(12, 4), 'w'),
            // Staff don't panic: they are Alerted by what they hear, and react by role.
            person('clerk', 'clerk', 'staff', P(3, 3), 'w')
        ], [{ id: 'jun', pos: P(0, 8) }]);
        frighten(state, 'a');
        const first = endTurn(world, state);
        expect(of(first.events, 'panicked')).toEqual([{ type: 'panicked', npc: 'b', cause: 'panic a' }]);
        expect(npc(first.state, 'b')).toMatchObject({ status: 'panicked', alerted: true });
        for (const id of ['c', 'd', 'e', 'clerk']) expect(npc(first.state, id).panic).toBe(null);
        // Both picked their reaction as the crew phase began, and show it.
        expect(of(first.events, 'panicReaction').map(e => e.npc)).toEqual(['a', 'b']);
        const second = endTurn(world, first.state);
        expect(of(second.events, 'panicked').map(e => [e.npc, e.cause])).toEqual([['c', 'panic b']]);
        expect(npc(second.state, 'e').panic).toBe(null);
        expect(npc(second.state, 'd').panic).toBe(null);
    });

    it('panics civilians in a command\'s panic ring, who pick their reaction as the next crew phase begins and act on it a world phase later', () => {
        let shown = 0;
        for (let seed = 1; seed < 40; seed++) {
            const { world, state } = setup(OPEN, [customer('far', P(9, 4))], [{ id: 'jun', pos: P(4, 4), items: ['pistol'] }], seed);
            const shout = commit(world, state, { type: 'command', crew: 'jun' });
            expect(npc(shout.state, 'far')).toMatchObject({ status: 'panicked', panic: { reaction: null }, intent: { path: [] } });
            expect(npc(shout.state, 'far').intent.action).toEqual({ kind: 'panic' });
            // Frozen through the world phase it panicked in.
            const world1 = endTurn(world, shout.state);
            expect(of(world1.events, 'npcWalked').filter(e => e.npc === 'far')).toEqual([]);
            const picked = of(world1.events, 'panicReaction')[0]!;
            expect(picked.npc).toBe('far');
            const shownAction = npc(world1.state, 'far').intent.action?.kind;
            const expected = { cower: 'cower', flee: 'flee', hide: 'hide' }[picked.reaction as 'cower' | 'flee' | 'hide'];
            expect(shownAction).toBe(expected);
            shown++;
        }
        expect(shown).toBeGreaterThan(0);
    });
});

describe('the off-duty cop (§10.9)', () => {
    it('panics like any customer, then always reaches, telegraphed for a world phase before he draws', () => {
        const { world, state } = setup(OPEN, [customer('cop', P(9, 4), 'n', { armed: 'hidden' }), customer('plain', P(9, 6))], [{ id: 'jun', pos: P(4, 4), items: ['pistol'] }]);
        expect(npc(state, 'cop').armed).toBe('hidden');
        // No tells: the rings show him as they show anyone.
        const plan = commandPlan(world, state, 'jun');
        expect(plan.targets.map(t => t.outcome)).toEqual(['panics', 'panics']);
        const shout = commit(world, state, { type: 'command', crew: 'jun' });
        const world1 = endTurn(world, shout.state);
        expect(world1.events).toContainEqual({ type: 'panicReaction', npc: 'cop', reaction: 'reach' });
        expect(of(world1.events, 'drewWeapon')).toEqual([]);
        expect(npc(world1.state, 'cop')).toMatchObject({ status: 'alerted', panic: null, lapse: { kind: 'reach', crew: 'jun' }, intent: { action: { kind: 'reachForWeapon', crew: 'jun' } } });
        // Previews never tell what a panicked NPC picks (the reach would be a tell).
        const foreseen = preview(world, shout.state, { type: 'endTurn' });
        expect(projectEvents(world, shout.state, foreseen.events, shout.state, { mode: 'preview' }).some(e => e.type === 'panicReaction')).toBe(false);
        const world2 = endTurn(world, world1.state);
        expect(world2.events).toContainEqual({ type: 'drewWeapon', npc: 'cop' });
        expect(npc(world2.state, 'cop').status).toBe('hostile');
    });

    it('reaches when his command lapses', () => {
        const { world, state } = setup(OPEN, [customer('cop', P(5, 4), 'n', { armed: 'hidden' })], [{ id: 'jun', pos: P(4, 4), items: ['pistol'] }]);
        let s = commit(world, state, { type: 'command', crew: 'jun' }).state;
        s = endTurn(world, s).state;
        const lapsed = endTurn(world, s);
        expect(lapsed.events).toContainEqual({ type: 'lapsed', npc: 'cop', outcome: 'reachForWeapon' });
        // He rolled as a customer does, so no preview stops anywhere else (no tells).
        expect(lapsed.rolls.filter(r => r.stream === 'lapse').length).toBeGreaterThan(0);
    });
});

describe('heroes (§16.2)', () => {
    it('resist a command at the shown chance', () => {
        const { world, state } = setup(OPEN, [customer('bold', P(5, 4), 'n', { hero: true })], [{ id: 'jun', pos: P(4, 4), items: ['pistol'] }]);
        expect(commandPlan(world, state, 'jun').targets).toEqual([{ npc: 'bold', ring: 'command', outcome: 'resists', chance: 0.4 }]);
    });

    it('tackle a crew member beside them, telegraphed: one who stays loses an action, one who steps away doesn\'t', () => {
        const { world, state } = setup(OPEN, [customer('bold', P(5, 4), 'w', { hero: true })], [{ id: 'jun', pos: P(4, 4) }, { id: 'mara', pos: P(12, 8) }]);
        frighten(state, 'bold', 'jun');
        const shown = endTurn(world, state);
        expect(shown.events).toContainEqual({ type: 'panicReaction', npc: 'bold', reaction: 'tackle' });
        expect(npc(shown.state, 'bold').intent).toMatchObject({ path: [], action: { kind: 'tackle', crew: 'jun' } });
        expect(of(shown.events, 'heroTackled')).toEqual([]);
        // Jun stays.
        const tackled = endTurn(world, shown.state);
        expect(tackled.events).toContainEqual({ type: 'heroTackled', npc: 'bold', crew: 'jun' });
        expect(tackled.events).toContainEqual({ type: 'actionLost', crew: 'jun' });
        expect(tackled.state.crew.find(c => c.id === 'jun')!.actionsLeft).toBe(1);
        // Jun steps away instead: the tackle misses, and the hero, nobody in reach, runs for it.
        const away = commit(world, shown.state, { type: 'move', crew: 'jun', path: [P(3, 4), P(2, 4)] }).state;
        const missed = endTurn(world, away);
        expect(of(missed.events, 'heroTackled')).toEqual([]);
        expect(missed.state.crew.find(c => c.id === 'jun')!.actionsLeft).toBe(2);
        expect(missed.events).toContainEqual({ type: 'panicReaction', npc: 'bold', reaction: 'flee' });
    });
});

describe('hiding to phone it in', () => {
    // A shelf to hide behind.
    const MAP = ['..............', '..............', '..........T...', '..........T...', '..........T...', '..............', '..............', '..............', '..............'];

    it('runs out of the crew\'s sight and calls (a carrier at 2), unless the crew sees the spot as it arrives', () => {
        let hid = 0, seen = 0;
        for (let seed = 1; seed < 200 && (!hid || !seen); seed++) {
            const { world, state } = setup(MAP, [customer('cust', P(9, 3))], [{ id: 'jun', pos: P(4, 3), items: ['pistol'] }, { id: 'mara', pos: P(4, 7) }], seed);
            const shout = commit(world, state, { type: 'command', crew: 'jun' }).state;
            const picked = endTurn(world, shout);
            if (!picked.events.some(e => e.type === 'panicReaction' && e.reaction === 'hide')) continue;
            const c = npc(picked.state, 'cust'), reaction = c.panic!.reaction!;
            expect(reaction.kind).toBe('hide');
            const spot = (reaction as { spot: Pos }).spot;
            expect(spot.x).toBeGreaterThan(10);
            expect(c.intent.action).toEqual({ kind: 'hide' });
            if (!hid) {
                const done = endTurn(world, picked.state);
                expect(done.events).toContainEqual({ type: 'hid', npc: 'cust', called: true });
                expect(of(done.events, 'carrierStarted')).toMatchObject([{ kind: 'phoneCall', holder: 'cust', countdown: 2 }]);
                hid++;
            } else {
                // Mara stands where she sees the spot as it arrives: no call.
                const looking = { ...picked.state, crew: picked.state.crew.map(m => (m.id === 'mara' ? { ...m, pos: { x: spot.x + 2, y: spot.y + 2 } } : m)) };
                const done = endTurn(world, looking);
                expect(done.events).toContainEqual({ type: 'hid', npc: 'cust', called: false });
                expect(of(done.events, 'carrierStarted')).toEqual([]);
                seen++;
            }
        }
        expect(hid).toBe(1);
        expect(seen).toBe(1);
    });
});

describe('the escapee (§9.1, §16.4)', () => {
    // A wall of shelves with one gap at (12, 2); the way out is at (13, 0).
    const MAP = ['..............', '..............', 'TTTTTTTTTTTT.T', '..............', '..............', '..............', '..............', '..............', '..............'];
    const passer = person('walker', 'passer-by', 'civilian', P(1, 8), 'n');

    /** The passer-by panicked by Jun's shout, its flight picked (passers-by always flee) and walked once. */
    function running(): { world: ReadonlyWorld; state: State } {
        const { world, state } = setup(MAP, [passer], [{ id: 'jun', pos: P(1, 4), items: ['pistol'] }, { id: 'mara', pos: P(10, 4) }]);
        const shout = commit(world, state, { type: 'command', crew: 'jun' }).state;
        const picked = endTurn(world, shout);
        expect(picked.events).toContainEqual({ type: 'panicReaction', npc: 'walker', reaction: 'flee' });
        expect(picked.rolls.filter(r => r.stream === 'panic')).toEqual([]);
        expect(npc(picked.state, 'walker').intent.action).toEqual({ kind: 'flee', exit: P(13, 0) });
        const off = endTurn(world, picked.state);
        expect(of(off.events, 'carrierStarted')).toMatchObject([{ kind: 'escapee', holder: 'walker' }]);
        return { world, state: off.state };
    }

    it('is countered by blocking the route, and the runner gives up and cowers', () => {
        const { world, state } = running();
        const block = commit(world, state, { type: 'move', crew: 'mara', path: [P(11, 3), P(12, 2)] });
        expect(of(block.events, 'carrierStopped')).toMatchObject([{ kind: 'escapee', why: 'route blocked' }]);
        const after = endTurn(world, block.state);
        expect(after.events).toContainEqual({ type: 'gaveUp', npc: 'walker' });
        expect(of(after.events, 'carrierStarted')).toEqual([]);
        expect(npc(after.state, 'walker')).toMatchObject({ status: 'panicked', lapse: null, panic: { reaction: { kind: 'cower' } } });
    });

    it('runs for another way out when the crew cut off its own, and is countered only with none left', () => {
        // Gaps at (0, 2) and (12, 2), into two bays; ways out at (0, 0) (a clerk's, nearer) and (13, 0).
        const map = ['......T.......', '......T.......', '.TTTTTTTTTTT.T', ...MAP.slice(3)];
        const clerk = person('clerk', 'clerk', 'staff', P(13, 8), 'n', {}, P(0, 0));
        const { world, state } = setup(map, [passer, clerk], [{ id: 'jun', pos: P(1, 4), items: ['pistol'] }, { id: 'mara', pos: P(2, 4) }]);
        const picked = endTurn(world, commit(world, state, { type: 'command', crew: 'jun' }).state).state;
        expect(npc(picked, 'walker').lapse).toEqual({ kind: 'flee', exit: P(0, 0) });
        const blocked = commit(world, picked, { type: 'move', crew: 'mara', path: [P(1, 3), P(0, 2)] }).state;
        const off = endTurn(world, blocked);
        expect(npc(off.state, 'walker').lapse).toEqual({ kind: 'flee', exit: P(13, 0) });
        expect(of(off.events, 'carrierStarted')).toMatchObject([{ kind: 'escapee', holder: 'walker' }]);
        expect(of(off.events, 'gaveUp')).toEqual([]);
    });

    it('is countered by a tackle: 1 action, in reach, and the runner goes face down', () => {
        const { world, state } = running();
        const at = npc(state, 'walker').pos;
        // Put Mara beside the runner.
        const s = { ...state, crew: state.crew.map(c => (c.id === 'mara' ? { ...c, pos: { x: at.x + 1, y: at.y } } : c)) };
        const r = commit(world, s, { type: 'tackle', crew: 'mara', npc: 'walker' });
        expect(r.events).toContainEqual({ type: 'tackled', crew: 'mara', npc: 'walker' });
        expect(of(r.events, 'carrierStopped')).toMatchObject([{ kind: 'escapee', why: 'commanded' }]);
        expect(npc(r.state, 'walker')).toMatchObject({ status: 'commanded', command: { pips: 2, by: 'mara' }, panic: null, lapse: null });
        expect(r.state.crew.find(c => c.id === 'mara')!.actionsLeft).toBe(1);
        expect(() => commit(world, state, { type: 'tackle', crew: 'jun', npc: 'walker' })).toThrow(/can't reach/);
    });
});

describe('structured traits from the generator', () => {
    it('give the rules the off-duty cop\'s weapon and the hero', () => {
        let armed = 0;
        for (let population = 1; population < 8; population++) {
            const bank = cachedBank({ layout: 3000, population, tier: 'small', archetype: 'twoWing', plot: 'midBlock' });
            for (const p of bank.people) {
                expect(typeof p.traits).toBe('object');
                if (p.traits.armed) expect(p.hidden).toBe(true);
            }
            const world = worldFromBank(bank), state = initialState(world, { seed: 1, crew: [] });
            for (const p of bank.people) {
                const def = world.people.find(d => d.id === p.id)!;
                expect(def.armed === 'hidden').toBe(!!p.traits.armed);
                expect(!!def.hero).toBe(!!p.traits.hero);
                expect(npc(state, p.id).armed === 'hidden').toBe(!!p.traits.armed);
                if (p.traits.armed) armed++;
            }
        }
        expect(armed).toBeGreaterThan(0);
    }, 120_000);
});

describe('the way out (a runner\'s exit)', () => {
    it('is worked out afresh for each NPC: one without a keycard is never told the way a keycard holder was', () => {
        // A wall with a locked keycard door between the runners and the nearer way out (7, 0); the other is at (0, 8).
        const walls = Array.from({ length: 14 }, (_, x) => ({ between: [P(x, 3), P(x, 4)] as [Pos, Pos], ...(x === 7 ? { door: { id: 'd', lock: 'keycard' as const, start: 'locked' as const } } : {}) }));
        const staff = (id: string, exit: Pos, keycard: boolean): PersonDef => ({ ...person(id, 'clerk', 'staff', P(7, 6), 'n', {}, exit), keycard });
        const world = fixtureWorld(OPEN, { walls, people: [staff('card', P(7, 0), true), { ...staff('none', P(0, 8), false), pos: P(6, 6) }] });
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(13, 8) }] });
        // Both asked from the same tile.
        const at = (s: State, id: string) => ({ ...npc(s, id), pos: P(7, 6) });
        const fresh = wayOut(world, state, at(state, 'none'));
        const holder = wayOut(world, state, at(state, 'card'));
        expect(holder?.exit).toEqual(P(7, 0));
        expect(fresh?.exit).toEqual(P(0, 8));
        expect(wayOut(world, state, at(state, 'none'))).toEqual(fresh);
    });
});
