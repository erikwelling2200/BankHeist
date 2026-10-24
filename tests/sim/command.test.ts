import { describe, expect, it } from 'vitest';
import {
    commandPlan, commandRadius, commit, holdPreview, holdTargets, crewThreat, fixtureWorld, initialState, preview, type CrewStart, type Facing, type ObserverClass, type PersonDef,
    type Pos, type ReadonlyWorld, type ScheduleBlock, type State
} from '../../src/sim';
import { step } from './helpers';

/*
 * Crowd control (M2-01; §9.3, §10.1–10.5, §6.3 Mask up): Threat, the command's rings, Commanded pips, Hold, lapses with
 * their telegraphed intents, resisters' shown chances, and GO.
 */

const P = (x: number, y: number): Pos => ({ x, y });

const person = (id: string, role: string, observer: ObserverClass, pos: Pos, facing: Facing = 'n', schedule: ScheduleBlock[] = []): PersonDef =>
    ({ id, name: id, role, observer, pos, facing, schedule });

const FLOOR = Array.from({ length: 9 }, () => '..............');

function setup(people: PersonDef[], crew: CrewStart[], seed = 7): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(FLOOR, { people });
    return { world, state: initialState(world, { seed, crew }) };
}

const npc = (state: State, id: string) => state.npcs.find(n => n.id === id)!;
const endTurn = (world: ReadonlyWorld, state: State) => step(world, state, { type: 'endTurn' }).state;

/** A customer who stands where it is until it leaves by `exit` at turn 99: its way out. */
const customer = (id: string, pos: Pos, exit: Pos = P(13, 4)): PersonDef => person(id, 'customer', 'civilian', pos, 'n', [
    { from: 1, activity: 'wait', label: 'waiting', room: '', at: pos, facing: 'n' },
    { from: 99, activity: 'leave', label: 'leaving', room: '', at: exit }
]);

describe('Threat and the command radius', () => {
    it('is the best weapon in hand, unarmed 1, ×1.5 rounded down on the takeover turn', () => {
        const { world, state } = setup([], [{ id: 'dex', pos: P(1, 1), items: ['lmg'] }, { id: 'mara', pos: P(2, 1) }, { id: 'jun', pos: P(3, 1), items: ['pistol'], packed: [] }]);
        expect(state.crew.map(c => crewThreat(c))).toEqual([6, 1, 3]);
        expect(state.crew.map(c => commandRadius(state, c))).toEqual([6, 1, 3]);
        const go = step(world, state, { type: 'go', crew: 'dex' }).state;
        expect(go.crew.map(c => commandRadius(go, c))).toEqual([9, 1, 4]);
    });
});

describe('the command', () => {
    it('puts those in the command ring face down with 2 pips, panics the panic ring and makes the bank loud', () => {
        const { world, state } = setup([customer('near', P(5, 4)), customer('far', P(9, 4))], [{ id: 'jun', pos: P(4, 4), items: ['pistol'] }]);
        const plan = commandPlan(world, state, 'jun');
        expect(plan.radius).toBe(3);
        expect(plan.panicRadius).toBe(6);
        expect(plan.targets).toEqual([{ npc: 'near', ring: 'command', outcome: 'complies' }, { npc: 'far', ring: 'panic', outcome: 'panics' }]);
        const seen = preview(world, state, { type: 'command', crew: 'jun' });
        const done = commit(world, state, { type: 'command', crew: 'jun' });
        expect(seen.events).toEqual(done.events);
        expect(npc(done.state, 'near')).toMatchObject({ status: 'commanded', command: { pips: 2, by: 'jun' }, intent: { path: [] } });
        expect(npc(done.state, 'far')).toMatchObject({ alerted: true, status: 'panicked', panic: { reaction: null, crew: null } });
        expect(done.state.bank.loud).toBe(true);
        expect(done.state.crew[0]!.actionsLeft).toBe(1);
        expect(done.undoable).toBe(false);
    });

    it('rolls a resister at its shown chance: 40% alone, 10% with two crew aiming, halved by Intimidating', () => {
        const guard = person('guard', 'lobbyGuard', 'enforcer', P(6, 4));
        const alone = setup([guard], [{ id: 'jun', pos: P(4, 4), items: ['pistol'] }, { id: 'mara', pos: P(12, 8) }]);
        expect(commandPlan(alone.world, alone.state, 'jun').targets).toEqual([{ npc: 'guard', ring: 'command', outcome: 'resists', chance: 0.4 }]);
        const shown = preview(alone.world, alone.state, { type: 'command', crew: 'jun' });
        expect(shown.pending).toEqual({ stream: 'resist', p: 0.4, reason: 'resist guard' });
        const done = commit(alone.world, alone.state, { type: 'command', crew: 'jun' });
        expect(done.rolls.map(r => [r.reason, r.p])).toEqual([['resist guard', 0.4]]);
        const resisted = done.rolls[0]!.value < 0.4;
        expect(npc(done.state, 'guard').status === 'commanded').toBe(!resisted);
        const two = setup([guard], [{ id: 'jun', pos: P(4, 4), items: ['pistol'] }, { id: 'mara', pos: P(8, 4), items: ['shotgun'] }]);
        expect(commandPlan(two.world, two.state, 'jun').targets[0]!.chance).toBe(0.1);
        const bully = setup([guard], [{ id: 'jun', pos: P(4, 4), items: ['pistol'], traits: ['intimidating'] }, { id: 'mara', pos: P(12, 8) }]);
        expect(commandPlan(bully.world, bully.state, 'jun').targets[0]!.chance).toBe(0.2);
    });

    it('is ignored by a Hostile NPC', () => {
        const { world, state } = setup([person('guard', 'lobbyGuard', 'enforcer', P(5, 4))], [{ id: 'jun', pos: P(4, 4), items: ['pistol'] }]);
        npc(state, 'guard').status = 'hostile';
        expect(commandPlan(world, state, 'jun').targets).toEqual([{ npc: 'guard', ring: 'command', outcome: 'ignores' }]);
        expect(npc(commit(world, state, { type: 'command', crew: 'jun' }).state, 'guard').status).toBe('hostile');
    });

    it('counters the button of a teller it puts down: a lapse back to the alarm starts a fresh one, at 2, as telegraphed', () => {
        const teller = person('teller', 'teller', 'staff', P(5, 4), 'n', [{ from: 1, activity: 'window', label: 'window', room: '', at: P(5, 4), facing: 'n' }]);
        let lapsedToAlarm = 0;
        for (let seed = 1; seed < 80; seed++) {
            const { world, state } = setup([teller], [{ id: 'jun', pos: P(4, 4), items: ['pistol'] }, { id: 'mara', pos: P(12, 0) }], seed);
            // Pressed a phase ago: one world phase from the Alarm.
            state.carriers.push({ id: 'c1', kind: 'tellerButton', source: 'teller', pos: P(5, 4), countdown: 1, started: { turn: 0, phase: 'world' }, halted: null });
            const down = commit(world, state, { type: 'command', crew: 'jun' });
            expect(down.state.carriers).toEqual([]);
            expect(down.events).toContainEqual({ type: 'carrierStopped', carrier: 'c1', kind: 'tellerButton', why: 'commanded' });
            const lapsed = step(world, endTurn(world, down.state), { type: 'endTurn' });
            if (!lapsed.events.some(e => e.type === 'lapsed' && e.outcome === 'alarm')) continue;
            lapsedToAlarm++;
            // Nothing comes back: the old button stays countered, and the new press is the intent shown now.
            expect(lapsed.state.carriers).toEqual([]);
            expect(npc(lapsed.state, 'teller').intent.action).toEqual({ kind: 'raiseAlarm', carrier: 'tellerButton', crew: 'jun' });
            const next = step(world, lapsed.state, { type: 'endTurn' });
            expect(next.state.bank.alarm).toBe(false);
            expect(next.events.find(e => e.type === 'carrierStarted')).toMatchObject({ kind: 'tellerButton', holder: 'teller', countdown: 2 });
        }
        expect(lapsedToAlarm).toBeGreaterThan(0);
    });
});

describe('Commanded pips, Hold and lapses', () => {
    const commanded = (seed = 7) => {
        const { world, state } = setup([customer('cust', P(2, 4))], [{ id: 'jun', pos: P(1, 4), items: ['pistol'] }, { id: 'mara', pos: P(12, 0) }], seed);
        return { world, state: commit(world, state, { type: 'command', crew: 'jun' }).state };
    };

    it('loses a pip each world phase unless someone holds them', () => {
        const { world, state } = commanded();
        expect(npc(endTurn(world, state), 'cust').command!.pips).toBe(1);
        const held = step(world, state, { type: 'hold', crew: 'jun' });
        expect(held.state.crew[0]!.actionsLeft).toBe(0);
        const after = endTurn(world, held.state);
        expect(npc(after, 'cust').command!.pips).toBe(2);
        expect(after.crew[0]!.holding).toBe(null);
    });

    it('holds on the takeover turn as far as the ×1.5 radius the preview shows', () => {
        const { world, state } = setup([customer('cust', P(8, 4))], [{ id: 'jun', pos: P(4, 4), items: ['pistol'] }, { id: 'mara', pos: P(12, 0) }], 3);
        let s = step(world, state, { type: 'go', crew: 'jun' }).state;
        s = commit(world, s, { type: 'command', crew: 'jun' }).state;
        expect(npc(s, 'cust').command).toEqual({ pips: 2, by: 'jun' });
        // 4 tiles away: outside a pistol's 3, inside the takeover's 4.
        expect(holdTargets(world, s, 'jun')).toEqual(['cust']);
        expect(holdPreview(world, s, 'jun')).toEqual(['cust']);
        s = step(world, s, { type: 'hold', crew: 'jun' }).state;
        const after = step(world, s, { type: 'endTurn' });
        expect(after.events).toContainEqual({ type: 'commandPips', npc: 'cust', pips: 2, held: true });
    });

    it('needs someone face down to hold, and a holder gets no third action from GO', () => {
        const { world, state } = commanded();
        const nobody = setup([customer('cust', P(2, 4))], [{ id: 'jun', pos: P(1, 4) }]);
        expect(() => step(nobody.world, nobody.state, { type: 'hold', crew: 'jun' })).toThrow(/Nobody is face down/);
        const after = endTurn(world, state);
        // The command made the bank loud and GO wants it quiet: the rule is checked on a quiet copy.
        after.bank.loud = false;
        const held = step(world, after, { type: 'hold', crew: 'mara' }).state;
        const go = step(world, held, { type: 'go', crew: 'jun' }).state;
        expect(go.crew.map(c => c.actionsLeft)).toEqual([3, 0]);
    });

    it('rolls a Twitchy intent once the pips run out, shown for a crew phase before it is carried out', () => {
        const seen = new Set<string>();
        for (let seed = 1; seed <= 40; seed++) {
            const { world, state } = commanded(seed);
            const lapsed = endTurn(world, endTurn(world, state));
            const c = npc(lapsed, 'cust');
            if (c.status === 'commanded') {
                // Cowed: stays down at 0 pips, telegraphed.
                seen.add('stayDown');
                expect(c.command!.pips).toBe(0);
                expect(c.intent.action).toEqual({ kind: 'stayDown' });
                continue;
            }
            seen.add('flee');
            expect(c.status).toBe('alerted');
            expect(c.intent.action).toEqual({ kind: 'flee', exit: P(13, 4) });
            expect(lapsed.carriers).toEqual([]);
            // It sets off in the next world phase, and the escapee carrier starts with it.
            const ran = step(world, lapsed, { type: 'endTurn' });
            expect(ran.events.find(e => e.type === 'carrierStarted')).toMatchObject({ kind: 'escapee', holder: 'cust' });
            expect(ran.state.carriers[0]!.countdown).toBeGreaterThanOrEqual(2);
            // Left alone it gets out and stays out; the carrier raises the Alarm.
            let gone = ran.state;
            for (let k = 0; k < 4; k++) gone = endTurn(world, gone);
            expect(npc(gone, 'cust').status).toBe('away');
            expect(gone.bank.alarm).toBe(true);
            // Put down again, it stops running.
            const jun = ran.state.crew[0]!;
            jun.pos = { x: npc(ran.state, 'cust').pos.x - 1, y: npc(ran.state, 'cust').pos.y };
            const down = commit(world, ran.state, { type: 'command', crew: 'jun' });
            expect(down.state.carriers).toEqual([]);
            expect(npc(down.state, 'cust').lapse).toBe(null);
        }
        expect([...seen].sort()).toEqual(['flee', 'stayDown']);
    });

    it('has a guard reach for his weapon, telegraphed, and draw a world phase later', () => {
        const guard = person('guard', 'lobbyGuard', 'enforcer', P(5, 4));
        let found = false;
        for (let seed = 1; seed <= 20 && !found; seed++) {
            const { world, state } = setup([guard], [{ id: 'jun', pos: P(4, 4), items: ['pistol'] }, { id: 'mara', pos: P(12, 0) }], seed);
            const done = commit(world, state, { type: 'command', crew: 'jun' }).state;
            if (npc(done, 'guard').status !== 'commanded') continue;
            found = true;
            const lapsed = endTurn(world, endTurn(world, done));
            expect(npc(lapsed, 'guard').intent.action).toEqual({ kind: 'reachForWeapon', crew: 'jun' });
            expect(commandPlan(world, lapsed, 'jun').targets[0]!.outcome).toBe('ignores');
            const drawn = step(world, lapsed, { type: 'endTurn' });
            expect(drawn.events.some(e => e.type === 'drewWeapon')).toBe(true);
            expect(npc(drawn.state, 'guard').status).toBe('hostile');
        }
        expect(found).toBe(true);
    });

    it('has staff go for the alarm by role, Exposed to whoever put them down', () => {
        const teller = person('teller', 'teller', 'staff', P(5, 4), 'n', [{ from: 1, activity: 'window', label: 'window', room: '', at: P(8, 7), facing: 'n' }]);
        let found = false;
        for (let seed = 1; seed <= 60 && !found; seed++) {
            const { world, state } = setup([teller], [{ id: 'jun', pos: P(4, 4), items: ['pistol'] }, { id: 'mara', pos: P(12, 0) }], seed);
            const lapsed = step(world, endTurn(world, commit(world, state, { type: 'command', crew: 'jun' }).state), { type: 'endTurn' });
            if (!lapsed.events.some(e => e.type === 'lapsed' && e.outcome === 'alarm')) continue;
            found = true;
            const t = npc(lapsed.state, 'teller');
            expect(t.status).toBe('alerted');
            expect(t.exposedTo).toContain('jun');
            expect(t.intent.path.length).toBeGreaterThan(0);
        }
        expect(found).toBe(true);
    });
});

describe('the manager phones it in (§16.2 "phone 40")', () => {
    it('rolls the phone, telegraphs the call where she lies, and makes it a world phase later at 2', () => {
        const manager = person('manager', 'manager', 'staff', P(5, 4), 'n', [{ from: 1, activity: 'post', label: 'desk', room: '', at: P(9, 7), facing: 'n' }]);
        let found = false;
        for (let seed = 1; seed <= 60 && !found; seed++) {
            const { world, state } = setup([manager], [{ id: 'jun', pos: P(4, 4), items: ['pistol'] }, { id: 'mara', pos: P(12, 0) }], seed);
            const lapsed = step(world, endTurn(world, commit(world, state, { type: 'command', crew: 'jun' }).state), { type: 'endTurn' });
            if (!lapsed.events.some(e => e.type === 'lapsed' && e.outcome === 'phone')) continue;
            found = true;
            const m = npc(lapsed.state, 'manager');
            expect(m.intent).toEqual({ path: [], action: { kind: 'raiseAlarm', carrier: 'phoneCall', crew: 'jun' } });
            const called = step(world, lapsed.state, { type: 'endTurn' });
            expect(called.events.find(e => e.type === 'carrierStarted')).toMatchObject({ kind: 'phoneCall', holder: 'manager', countdown: 2 });
            // The call made, the lapse is done: she watches, and calls no more.
            expect(npc(called.state, 'manager').lapse).toBe(null);
            expect(npc(called.state, 'manager').intent.action?.kind).not.toBe('raiseAlarm');
        }
        expect(found).toBe(true);
    });
});

describe('a runner at the way out', () => {
    it('stays on the map for the crew phase its escapee carrier is first seen in', () => {
        let found = false;
        for (let seed = 1; seed <= 40 && !found; seed++) {
            // Two tiles from the way out: one world phase's run gets it there.
            const { world, state } = setup([customer('cust', P(11, 4))], [{ id: 'jun', pos: P(10, 4), items: ['pistol'] }, { id: 'mara', pos: P(0, 0) }], seed);
            const lapsed = endTurn(world, endTurn(world, commit(world, state, { type: 'command', crew: 'jun' }).state));
            if (npc(lapsed, 'cust').intent.action?.kind !== 'flee') continue;
            found = true;
            const ran = step(world, lapsed, { type: 'endTurn' });
            expect(ran.state.carriers.map(c => [c.kind, c.countdown])).toEqual([['escapee', 2]]);
            expect(npc(ran.state, 'cust').status).toBe('alerted');
            // Still there to be put down again: that counters it.
            ran.state.crew[0]!.pos = { x: npc(ran.state, 'cust').pos.x - 1, y: npc(ran.state, 'cust').pos.y };
            expect(commit(world, ran.state, { type: 'command', crew: 'jun' }).state.carriers).toEqual([]);
            // Left alone, it is gone the phase after.
            expect(npc(endTurn(world, ran.state), 'cust').status).toBe('away');
        }
        expect(found).toBe(true);
    });
});

describe('GO', () => {
    it('masks everyone, gives a third action, surprises the calm and puts surprised civilians down for a phase', () => {
        const guard = person('guard', 'lobbyGuard', 'enforcer', P(10, 4));
        const { world, state } = setup([guard, customer('cust', P(2, 2))], [{ id: 'jun', pos: P(4, 4), items: ['pistol'] }, { id: 'mara', pos: P(6, 6) }]);
        const go = step(world, state, { type: 'go', crew: 'jun' });
        expect(go.state.takeover).toBe(1);
        expect(go.state.crew.map(c => [c.actionsLeft, c.loadout.masked])).toEqual([[3, true], [3, true]]);
        expect(npc(go.state, 'guard').surprised).toBe(1);
        expect(npc(go.state, 'cust')).toMatchObject({ status: 'commanded', command: { pips: 1 } });
        expect(commandPlan(world, go.state, 'jun').targets.find(t => t.npc === 'guard')).toMatchObject({ ring: 'panic' });
        // Surprised: a 10% resister for a command reaching him, and he loses the world phase.
        go.state.crew[0]!.pos = P(8, 4);
        expect(commandPlan(world, go.state, 'jun').targets.find(t => t.npc === 'guard')?.chance).toBe(0.1);
        expect(() => step(world, go.state, { type: 'go', crew: 'mara' })).toThrow(/once per heist/);
        const next = endTurn(world, go.state);
        expect(npc(next, 'guard').surprised).toBe(null);
    });

    it('is refused once the bank is loud; masking up costs an action otherwise', () => {
        const { world, state } = setup([], [{ id: 'jun', pos: P(4, 4) }]);
        const masked = step(world, state, { type: 'maskUp', crew: 'jun' }).state;
        expect(masked.crew[0]!.actionsLeft).toBe(1);
        expect(masked.crew[0]!.loadout.masked).toBe(true);
        state.bank.loud = true;
        expect(() => step(world, state, { type: 'go', crew: 'jun' })).toThrow(/loud/);
    });
});
