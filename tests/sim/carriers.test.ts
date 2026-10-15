import { describe, expect, it } from 'vitest';
import {
    CARRIERS, carrierPreview, clonePlain, commit, filmedCrew, fixtureWorld, freezeWorld, hashOf, initialState, knownCarriers, knownView, legalActions, panelWorkLeft,
    pendingCarriers, preview, projectCarriers, projectEvents, raiseCarrier, walkingToAlarm, type CarrierKind, type Command, type CrewStart, type Facing, type FixtureOptions, type ObserverClass,
    type PersonDef, type Pos, type ReadonlyWorld, type SimEvent, type State, type World, type WorldObject
} from '../../src/sim';
import { registerTestCommand, scouted, step, testCommand } from './helpers';

/*
 * M1-08: alarm carriers (§9.1), check-ins (§8.11), cameras and the operator (§8.12), the Alarm (§9.2).
 */

const P = (x: number, y: number): Pos => ({ x, y });
const person = (id: string, role: string, observer: ObserverClass, pos: Pos, facing: Facing): PersonDef =>
    ({ id, name: id, role, observer, pos, facing, schedule: [] });
const obj = (id: string, kind: string, pos: Pos, extra: Partial<WorldObject> = {}): WorldObject => ({ id, kind, pos, facing: 's', ...extra });
/** A wall down the edge between columns x and x + 1, every row. */
const wallAfter = (x: number, rows: number) => Array.from({ length: rows }, (_, y) => ({ between: [P(x, y), P(x + 1, y)] as [Pos, Pos] }));

function setup(map: readonly string[], people: PersonDef[], crew: CrewStart[], options: FixtureOptions = {}): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(map, { people, ...options });
    return { world, state: scouted(world, initialState(world, { seed: 3, crew })) };
}

const types = (events: readonly SimEvent[]): string[] => events.map(e => e.type);
const endTurn = (world: ReadonlyWorld, state: State) => step(world, state, { type: 'endTurn' });
const turns = (world: ReadonlyWorld, state: State, n: number): { state: State; events: SimEvent[] } => {
    const events: SimEvent[] = [];
    for (let i = 0; i < n; i++) {
        const r = endTurn(world, state);
        events.push(...r.events);
        state = r.state;
    }
    return { state, events };
};

/** Commits and checks that the preview said exactly the same (§8.8). */
function act(world: ReadonlyWorld, state: State, cmd: Command) {
    const seen = preview(world, state, cmd);
    const done = step(world, state, cmd);
    expect(seen.events).toEqual(done.events);
    expect(hashOf(seen.state)).toBe(hashOf(done.state));
    return done;
}

const disable = (crew: string): Command => ({ type: 'interact', crew, object: 'panel', verb: 'disable' });

// A teller at her window on the right; Jun behind a wall at the alarm panel on the left; Mara, masked, in the lobby.
const tellerBank = (panel = true) => setup(
    ['........', '........', '........'],
    [person('teller', 'teller', 'staff', P(7, 1), 'w')],
    [{ id: 'jun', pos: P(0, 1), items: ['hackingKit'] }, { id: 'mara', pos: P(5, 1), masked: true }],
    { walls: wallAfter(1, 3), objects: panel ? [obj('panel', 'alarmPanel', P(0, 0))] : [] }
);

describe('the alarm panel and the wired carriers', () => {
    it('takes 4 actions of hacking, spread across turns, quiet and illegal; Steady Hands takes 2', () => {
        const { world, state } = tellerBank();
        const first = act(world, state, disable('jun'));
        expect(first.state.objects.panel).toEqual({ progress: 1 });
        expect(types(first.events)).toContain('noise');
        expect(first.events.find(e => e.type === 'noise')).toMatchObject({ radius: 1, kind: 'quiet' });
        const second = act(world, first.state, disable('jun'));
        expect(panelWorkLeft(world, second.state, second.state.crew[0]!, 'panel')).toBe(2);
        const next = endTurn(world, second.state).state;
        const third = act(world, act(world, next, disable('jun')).state, disable('jun'));
        expect(third.state.objects.panel!.disabled).toBe(true);
        expect(types(third.events)).toContain('panelDisabled');
        expect(() => commit(world, third.state, disable('jun'))).toThrow();

        const steady = setup(['...'], [], [{ id: 'jun', pos: P(0, 0), items: ['hackingKit'], traits: ['steadyHands'] }], { objects: [obj('panel', 'alarmPanel', P(1, 0))] });
        expect(panelWorkLeft(steady.world, steady.state, steady.state.crew[0]!, 'panel')).toBe(2);
        const done = act(steady.world, act(steady.world, steady.state, disable('jun')).state, disable('jun'));
        expect(done.state.objects.panel!.disabled).toBe(true);

        const noKit = setup(['...'], [], [{ id: 'jun', pos: P(0, 0) }], { objects: [obj('panel', 'alarmPanel', P(1, 0))] });
        expect(() => commit(noKit.world, noKit.state, disable('jun'))).toThrow(/hacking kit/);
        expect(legalActions(noKit.world, noKit.state, 'jun').some(c => c.type === 'interact')).toBe(false);
    });

    it('a teller who sees a masked crew member presses her button: a carrier of 2, then the Alarm and "Police in N"', () => {
        const { world, state } = tellerBank(false);
        const seen = act(world, state, { type: 'wait', crew: 'mara' });
        expect(seen.state.npcs[0]!.intent.action).toEqual({ kind: 'raiseAlarm', carrier: 'tellerButton', crew: 'mara' });
        // The action preview names the carrier the coming world phase would start.
        expect(carrierPreview(world, state, preview(world, state, { type: 'wait', crew: 'mara' })).worldPhase)
            .toEqual([{ kind: 'tellerButton', label: 'Teller button', source: 'teller', pos: P(7, 1), countdown: 2, about: 'mara' }]);
        const w1 = endTurn(world, seen.state);
        expect(w1.events).toContainEqual({ type: 'carrierStarted', carrier: 'carrier-1', kind: 'tellerButton', countdown: 2, holder: 'teller', pos: P(7, 1), about: 'mara' });
        expect(w1.state.carriers[0]!.countdown).toBe(2);
        expect(w1.state.npcs[0]!.reported).toEqual(['mara']);
        const w2 = endTurn(world, w1.state);
        expect(w2.state.carriers[0]!.countdown).toBe(1);
        expect(w2.state.bank.alarm).toBe(false);
        const w3 = endTurn(world, w2.state);
        expect(types(w3.events)).toContain('alarmRaised');
        expect(w3.state.bank.alarm).toBe(true);
        expect(w3.state.response).toEqual({ raised: 3, by: 'tellerButton', policeIn: 6, heat: { level: 1, tick: 0 } });
        expect(endTurn(world, w3.state).state.response!.policeIn).toBe(5);
    });

    it('the panel is dead, so the teller\'s button is dead', () => {
        const { world, state } = tellerBank();
        let s = act(world, act(world, state, disable('jun')).state, disable('jun')).state;
        s = endTurn(world, s).state;
        s = act(world, act(world, s, disable('jun')).state, disable('jun')).state;
        s = act(world, s, { type: 'wait', crew: 'mara' }).state;
        expect(s.npcs[0]!.intent.action?.kind).toBe('raiseAlarm');
        expect(pendingCarriers(world, s)).toEqual([]);
        const w = endTurn(world, s);
        expect(w.events).toContainEqual({ type: 'alarmDead', source: 'teller', kind: 'tellerButton' });
        expect(w.state.carriers).toEqual([]);
        expect(w.state.npcs[0]!.reported).toEqual(['mara']);
        expect(turns(world, w.state, 4).state.bank.alarm).toBe(false);
    });

    it('a dead panel kills a teller\'s carrier mid-countdown', () => {
        const { world, state } = tellerBank();
        let s = act(world, act(world, state, disable('jun')).state, disable('jun')).state;
        s = act(world, s, { type: 'wait', crew: 'mara' }).state;
        s = endTurn(world, s).state;
        expect(s.carriers.map(c => [c.kind, c.countdown])).toEqual([['tellerButton', 2]]);
        s = act(world, s, disable('jun')).state;
        const last = act(world, s, disable('jun'));
        expect(last.events).toContainEqual({ type: 'carrierStopped', carrier: 'carrier-1', kind: 'tellerButton', why: 'panel' });
        expect(last.undoable).toBe(false);
        expect(turns(world, last.state, 4).state.bank.alarm).toBe(false);
    });
});

describe('the guard\'s radio', () => {
    // A guard facing the lobby; Mara walks into his view masked; Jun waits beside him.
    const guardBank = () => setup(
        ['........', '........', '........'],
        [person('guard', 'guard', 'enforcer', P(1, 1), 'e')],
        [{ id: 'jun', pos: P(0, 1), items: ['jammer'] }, { id: 'mara', pos: P(6, 1) }]
    );

    it('"Hands up!": he draws and shouts (loud, radius 6), and his radio carrier starts at 2', () => {
        const { world, state } = guardBank();
        const masked = clonePlain(state);
        masked.crew[1]!.loadout.masked = true;
        const seen = act(world, masked, { type: 'wait', crew: 'mara' });
        expect(seen.state.npcs[0]!.intent.action).toEqual({ kind: 'raiseAlarm', carrier: 'guardRadio', crew: 'mara' });
        const w = endTurn(world, seen.state);
        expect(w.events).toContainEqual({ type: 'confronted', npc: 'guard', crew: 'mara' });
        expect(w.events.find(e => e.type === 'noise' && e.cause === 'hands up guard')).toMatchObject({ radius: 6, kind: 'loud' });
        expect(w.state.bank.loud).toBe(true);
        expect(w.state.carriers.map(c => [c.kind, c.countdown, c.source])).toEqual([['guardRadio', 2, 'guard']]);
        // Knocking him out mid-countdown counters it.
        const ko = act(world, w.state, { type: 'knockout', crew: 'jun', npc: 'guard' });
        expect(ko.events).toContainEqual({ type: 'carrierStopped', carrier: 'carrier-1', kind: 'guardRadio', why: 'source down' });
        expect(turns(world, ko.state, 3).state.bank.alarm).toBe(false);
    });

    it('a jammer pauses it while it runs', () => {
        const { world, state } = guardBank();
        const masked = clonePlain(state);
        masked.crew[1]!.loadout.masked = true;
        let s = endTurn(world, act(world, masked, { type: 'wait', crew: 'mara' }).state).state;
        const jam = act(world, s, { type: 'placeJammer', crew: 'jun' });
        expect(types(jam.events)).toEqual(expect.arrayContaining(['jammerPlaced', 'carrierPaused']));
        expect(jam.state.carriers[0]!.halted).toBe('paused');
        s = turns(world, jam.state, 4).state;
        expect(s.bank.alarm).toBe(false);
        expect(s.carriers[0]!.countdown).toBe(2);
    });
});

describe('radio check-ins', () => {
    // The operator at the CCTV desk on the right, behind a wall; a guard tied up on the left, Jun beside him.
    const radioBank = (options: { tied?: boolean } = {}) => {
        const built = setup(
            ['..........', '..........', '..........'],
            [person('guard', 'guard', 'enforcer', P(1, 1), 's'), person('op', 'operator', 'staff', P(8, 1), 'e')],
            [{ id: 'jun', pos: P(2, 1) }, { id: 'mara', pos: P(7, 2), items: ['hackingKit'] }],
            { walls: wallAfter(4, 3), objects: [obj('desk', 'cctvDesk', P(9, 1), { monitors: 4 }), obj('rec', 'recorder', P(9, 1))] }
        );
        if (options.tied ?? true) {
            built.state.npcs[0]!.status = 'tied';
            built.state.npcs[0]!.intent = { path: [] };
        }
        return built;
    };

    it('the operator calls every 6 phases; a downed guard\'s radio buzzes, and missed twice is a carrier', () => {
        const { world, state } = radioBank();
        expect(state.radio.calls).toEqual({ guard: { next: 6, missed: 0, ringing: null } });
        let s = turns(world, state, 5).state;
        const ring = endTurn(world, s);
        expect(types(ring.events)).toContain('checkInRinging');
        expect(ring.events.find(e => e.type === 'noise' && e.cause === 'radio guard')).toMatchObject({ radius: 3, kind: 'quiet' });
        expect(ring.state.radio.calls.guard).toEqual({ next: 12, missed: 0, ringing: 6 });
        expect(legalActions(world, ring.state, 'jun')).toContainEqual({ type: 'answerRadio', crew: 'jun', npc: 'guard' });
        const miss = endTurn(world, ring.state);
        expect(miss.events).toContainEqual({ type: 'checkInMissed', guard: 'guard', missed: 1 });
        s = turns(world, miss.state, 5).state;
        expect(s.radio.calls.guard!.ringing).toBe(12);
        const second = endTurn(world, s);
        expect(second.events).toContainEqual({ type: 'checkInMissed', guard: 'guard', missed: 2 });
        expect(second.state.carriers.map(c => [c.kind, c.countdown, c.source, c.subject])).toEqual([['missedCheckIn', 2, 'op', 'guard']]);
        // Answering the radio now counters it.
        const answered = act(world, second.state, { type: 'answerRadio', crew: 'jun', npc: 'guard' });
        expect(answered.events).toContainEqual({ type: 'carrierStopped', carrier: second.state.carriers[0]!.id, kind: 'missedCheckIn', why: 'answered' });
        expect(answered.state.radio.answers).toBe(1);
        expect(turns(world, answered.state, 3).state.bank.alarm).toBe(false);
        // Unanswered, it raises the Alarm.
        expect(turns(world, second.state, 2).state.bank.alarm).toBe(true);
    });

    it('answering in time keeps the operator happy; 2 answers a heist, +1 per Smooth Talker', () => {
        const { world, state } = radioBank();
        const ring = turns(world, state, 6).state;
        const answered = act(world, ring, { type: 'answerRadio', crew: 'jun', npc: 'guard' });
        expect(answered.undoable).toBe(true);
        const next = endTurn(world, answered.state);
        expect(types(next.events)).not.toContain('checkInMissed');
        const used = clonePlain(ring);
        used.radio.answers = 2;
        expect(() => commit(world, used, { type: 'answerRadio', crew: 'jun', npc: 'guard' })).toThrow(/another answer/);
        used.crew[0]!.traits = ['smoothTalker'];
        expect(() => commit(world, used, { type: 'answerRadio', crew: 'jun', npc: 'guard' })).not.toThrow();
    });

    it('operator knocked out: the calls stop, and dispatch sends a drive-by after 10 silent phases', () => {
        const { world, state } = radioBank({ tied: false });
        const s0 = clonePlain(state);
        s0.crew[1]!.pos = P(8, 2);
        const ko = act(world, s0, { type: 'knockout', crew: 'mara', npc: 'op' });
        const out = clonePlain(ko.state);
        out.npcs[1]!.outCold = 99;
        const nine = turns(world, out, 9);
        expect(types(nine.events)).not.toContain('dispatchLostContact');
        expect(types(nine.events)).not.toContain('checkIn');
        const tenth = endTurn(world, nine.state);
        expect(tenth.events).toContainEqual({ type: 'dispatchLostContact', driveBy: 12 });
    });
});

describe('review fixes', () => {
    const twoGuards = () => setup(
        ['..........', '..........', '..........'],
        [person('ga', 'guard', 'enforcer', P(1, 0), 's'), person('gb', 'guard', 'enforcer', P(1, 2), 'n'), person('op', 'operator', 'staff', P(8, 1), 'e')],
        [{ id: 'jun', pos: P(2, 1) }, { id: 'mara', pos: P(8, 2) }],
        { walls: wallAfter(4, 3), objects: [obj('desk', 'cctvDesk', P(9, 1), { monitors: 4 })] }
    );
    const down = (s: State, id: string, status: 'tied' | 'unconscious' = 'tied') => {
        const n = s.npcs.find(x => x.id === id)!;
        n.status = status;
        n.intent = { path: [] };
        if (status === 'unconscious') n.outCold = 99;
    };

    it('the operator neutralised while a second call rings: no missed check-in, dispatch\'s silence instead', () => {
        const { world, state } = twoGuards();
        const s = clonePlain(state);
        down(s, 'ga');
        down(s, 'gb');
        s.radio.calls.ga = { next: 1, missed: 1, ringing: null };
        s.radio.calls.gb = { next: 99, missed: 0, ringing: null };
        const ring = endTurn(world, s);
        expect(ring.state.radio.calls.ga!.ringing).toBe(1);
        const after = clonePlain(ring.state);
        down(after, 'op', 'unconscious');
        const quiet = endTurn(world, after);
        expect(types(quiet.events)).not.toContain('checkInMissed');
        expect(quiet.state.carriers).toEqual([]);
        expect(quiet.state.radio.calls.ga!.ringing).toBe(null);
        const later = turns(world, quiet.state, 9);
        expect(types(later.events)).toContain('dispatchLostContact');
        expect(later.state.bank.alarm).toBe(false);
    });

    it('missed check-ins are one carrier per guard, at the CCTV desk; answering one leaves the other', () => {
        const { world, state } = twoGuards();
        const s = clonePlain(state);
        for (const g of ['ga', 'gb']) { down(s, g); s.radio.calls[g] = { next: 1, missed: 1, ringing: null }; }
        const missed = turns(world, s, 2).state;
        expect(missed.carriers.map(c => [c.kind, c.source, c.subject, c.pos])).toEqual([['missedCheckIn', 'op', 'ga', P(9, 1)], ['missedCheckIn', 'op', 'gb', P(9, 1)]]);
        const answered = act(world, missed, { type: 'answerRadio', crew: 'jun', npc: 'ga' });
        expect(answered.state.carriers.map(c => c.subject)).toEqual(['gb']);
    });

    it('a carrier of a holder the crew doesn\'t know is shown without holder or place', () => {
        const { world } = tellerBank(false);
        const blind = initialState(world, { seed: 3, crew: [{ id: 'jun', pos: P(0, 1) }, { id: 'mara', pos: P(5, 1), masked: true }] });
        // Mara is seen by a teller the crew has never laid eyes on (she stands in the dark of a wall here).
        const s = clonePlain(blind);
        s.knowledge.npcs = {};
        const seen = step(world, s, { type: 'wait', crew: 'mara' }).state;
        seen.knowledge.npcs = {};
        const w = endTurn(world, seen);
        const truth = w.events.find(e => e.type === 'carrierStarted');
        expect(truth).toMatchObject({ holder: 'teller', pos: P(7, 1) });
        const hidden = clonePlain(w.state);
        hidden.knowledge.npcs = {};
        const shown = projectEvents(world, hidden, w.events).find(e => e.type === 'carrierStarted');
        expect(shown).toMatchObject({ kind: 'tellerButton', countdown: 2, holder: null, pos: null, about: 'mara' });
        expect(knownCarriers(world, hidden)).toEqual([{ id: 'carrier-1', kind: 'tellerButton', label: 'Teller button', source: null, pos: null, countdown: 2, halted: null, about: 'mara' }]);
        expect(projectCarriers(world, hidden, pendingCarriers(world, seen))).toEqual([{ kind: 'tellerButton', label: 'Teller button', source: null, pos: null, countdown: 2, about: 'mara' }]);
        expect(knownCarriers(world, scouted(world, w.state))[0]).toMatchObject({ source: 'teller', pos: P(7, 1) });
    });

    it('a teller walking to her button shows in the ledger with an ETA, which the walk keeps', () => {
        const teller: PersonDef = { ...person('teller', 'teller', 'staff', P(9, 1), 'w'), schedule: [{ from: 1, activity: 'window', label: 'window', room: '', at: P(9, 1), facing: 'w' }] };
        const { world, state } = setup(['..............', '..............', '..............'], [teller], [{ id: 'mara', pos: P(7, 1), masked: true }]);
        // Away from her window when Mara shows up.
        const s = clonePlain(state);
        s.npcs[0]!.pos = P(2, 0);
        s.npcs[0]!.facing = 'e';
        s.npcs[0]!.intent = { path: [] };
        const seen = step(world, scouted(world, s), { type: 'wait', crew: 'mara' }).state;
        const walks = walkingToAlarm(world, seen);
        expect(walks).toHaveLength(1);
        expect(walks[0]).toMatchObject({ npc: 'teller', kind: 'tellerButton', pos: P(9, 1), about: 'mara' });
        const eta = walks[0]!.eta;
        expect(eta).toBeGreaterThan(1);
        expect(walks[0]!.alarmIn).toBe(eta + 2);
        let t = seen, phases = 0;
        while (phases < 6) {
            const r = endTurn(world, t);
            phases++;
            t = r.state;
            if (types(r.events).includes('carrierStarted')) break;
        }
        expect(phases).toBe(eta);
        const hidden = clonePlain(seen);
        hidden.knowledge.npcs = {};
        expect(walkingToAlarm(world, hidden)[0]).toMatchObject({ npc: null, pos: null, eta });
    });

    it('a landline call isn\'t jammed; a mobile is', () => {
        const tech: PersonDef = { ...person('tech', 'technician', 'staff', P(4, 1), 'w'), schedule: [{ from: 1, activity: 'post', label: 'desk', room: '', at: P(4, 1), facing: 'w' }] };
        const { world, state } = setup(['........', '........', '........'], [tech], [{ id: 'mara', pos: P(2, 1), masked: true, items: ['jammer'] }]);
        const atDesk = endTurn(world, step(world, state, { type: 'wait', crew: 'mara' }).state).state;
        expect(atDesk.carriers.map(c => [c.kind, c.line])).toEqual([['phoneCall', 'landline']]);
        // Mara has no actions left this turn's world phase is over: a new turn, she places the jammer.
        const jammed = act(world, atDesk, { type: 'placeJammer', crew: 'mara' });
        expect(jammed.state.carriers[0]!.halted).toBe(null);
        const away = clonePlain(state);
        away.npcs[0]!.pos = P(5, 2);
        away.npcs[0]!.intent = { path: [] };
        const mobile = endTurn(world, step(world, away, { type: 'wait', crew: 'mara' }).state).state;
        expect(mobile.carriers.map(c => [c.kind, c.line])).toEqual([['phoneCall', undefined]]);
        expect(act(world, mobile, { type: 'placeJammer', crew: 'mara' }).state.carriers[0]!.halted).toBe('paused');
    });

    it('an operator verifying stays at his desk', () => {
        const op: PersonDef = {
            ...person('op', 'operator', 'staff', P(8, 1), 'e'),
            schedule: [{ from: 1, activity: 'post', label: 'desk', room: '', at: P(8, 1), facing: 'e' }, { from: 2, activity: 'post', label: 'break', room: '', at: P(8, 2), facing: 's' }]
        };
        const { world, state } = setup(['..........', '..........', '..........'], [op], [{ id: 'jun', pos: P(4, 2), masked: true }], {
            walls: wallAfter(6, 3), cameras: [{ id: 'cam', pos: P(0, 0), facings: ['se'], room: null }], objects: [obj('desk', 'cctvDesk', P(9, 1), { monitors: 1 })]
        });
        const w = endTurn(world, step(world, state, { type: 'move', crew: 'jun', path: [P(3, 2)] }).state);
        expect(w.state.carriers.map(c => [c.kind, c.pos])).toEqual([['operatorCamera', P(9, 1)]]);
        expect(w.state.npcs[0]!.intent.path).toEqual([]);
    });

    it('carrierPreview names a carrier whose countdown or crew member a command changes', () => {
        const { world, state } = tellerBank(false);
        const r = preview(world, state, { type: 'wait', crew: 'mara' });
        expect(carrierPreview(world, r.state, r).worldPhase).toEqual([]);
    });
});

describe('known gaps', () => {
    // The passing patrol car has one counter until combat (M3) lets the crew take both officers down (§9.1). When M3
    // makes it work, this fails: update the plan's note and the carriers table, then delete this test.
    it('the patrol car: only the jammer until M3', () => {
        expect(CARRIERS.patrolCar.counters.filter(c => c.now === true).map(c => c.name)).toEqual(['jammer']);
        expect(CARRIERS.patrolCar.counters.find(c => c.name === 'take both officers down')!.now).toBe('M3');
    });
    it.todo('M3: taking both patrol officers down counters the patrol car mid-countdown');
});

describe('the patrol drive-by', () => {
    it('officers see a masked crew member through the street: the patrol car carrier', () => {
        const built = setup(['........', '........', '........'], [], [{ id: 'jun', pos: P(4, 0), masked: true }]);
        const world = freezeWorld({ ...(clonePlain(built.world) as World), patrol: { lane: [0, 1, 2, 3, 4, 5, 6, 7].map(x => P(x, 2)), turns: [2] } });
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(4, 0), masked: true }] });
        const first = endTurn(world, state);
        expect(types(first.events)).not.toContain('patrolPassed');
        expect(pendingCarriers(world, first.state).map(c => c.kind)).toEqual(['patrolCar']);
        const pass = endTurn(world, first.state);
        expect(pass.events).toContainEqual({ type: 'patrolPassed', saw: 'jun' });
        expect(pass.state.carriers.map(c => [c.kind, c.countdown, c.about])).toEqual([['patrolCar', 2, 'jun']]);
        const unmasked = clonePlain(first.state);
        unmasked.crew[0]!.loadout.masked = false;
        expect(endTurn(world, unmasked).events).toContainEqual({ type: 'patrolPassed', saw: null });
    });
});

describe('cameras and the operator', () => {
    // A camera in the lobby looking east; the operator at his desk behind a wall, a server rack in the back room.
    const camBank = () => setup(
        ['..........', '..........', '..........'],
        [person('op', 'operator', 'staff', P(8, 1), 'e')],
        [{ id: 'jun', pos: P(4, 2), masked: true }, { id: 'mara', pos: P(0, 2), items: ['hackingKit'] }],
        {
            walls: wallAfter(6, 3),
            cameras: [{ id: 'cam', pos: P(0, 0), facings: ['se'], room: null }],
            objects: [obj('desk', 'cctvDesk', P(9, 1), { monitors: 1 }), obj('rec', 'recorder', P(9, 1)), obj('rack', 'serverRack', P(0, 1))]
        }
    );

    it('a live camera that sees a `!` makes the operator verify in the world phase: a carrier of 2', () => {
        const { world, state } = camBank();
        const seen = act(world, state, { type: 'move', crew: 'jun', path: [P(3, 2)] });
        expect(types(seen.events)).toContain('cameraSaw');
        expect(seen.state.carriers).toEqual([]);
        expect(pendingCarriers(world, seen.state).map(c => [c.kind, c.source, c.countdown])).toEqual([['operatorCamera', 'op', 2]]);
        const w = endTurn(world, seen.state);
        expect(w.events).toContainEqual({ type: 'operatorVerifies', npc: 'op', camera: 'cam', crew: 'jun' });
        expect(w.state.carriers.map(c => [c.kind, c.countdown])).toEqual([['operatorCamera', 2]]);
        expect(w.state.cameraReports).toEqual([]);
    });

    it('looped feed: the camera shows nothing for 4 phases, then comes back', () => {
        const { world, state } = camBank();
        const loop = act(world, state, { type: 'loopFeed', crew: 'mara', object: 'rack', camera: 'cam' });
        expect(loop.state.cameras.cam!.loopedUntil).toBe(4);
        const seen = act(world, loop.state, { type: 'move', crew: 'jun', path: [P(3, 2)] });
        expect(types(seen.events)).not.toContain('cameraSaw');
        let s = endTurn(world, seen.state).state;
        expect(s.carriers).toEqual([]);
        s = turns(world, s, 2).state;
        expect(s.cameras.cam!.loopedUntil).toBe(4);
        const back = endTurn(world, s);
        expect(back.events).toContainEqual({ type: 'feedRestored', camera: 'cam' });
        expect(back.state.cameras.cam!.loopedUntil).toBe(null);
        expect(() => commit(world, loop.state, { type: 'loopFeed', crew: 'mara', object: 'rack', camera: 'cam' })).toThrow(/looped already/);
    });

    it('a camera off the monitors reports nothing; the operator watches one feed a turn among several', () => {
        const { world } = camBank();
        const two = freezeWorld({ ...(clonePlain(world) as World), cameras: [...clonePlain(world.cameras) as World['cameras'], { id: 'cam2', pos: P(5, 0), facings: ['s'], room: null }] });
        const s = scouted(two, initialState(two, { seed: 3, crew: [{ id: 'jun', pos: P(4, 2), masked: true }] }));
        // Turn 1 shows cam (index 0); cam2 sees nothing of Jun at (3, 2), cam does: verified.
        const t1 = endTurn(two, step(two, s, { type: 'move', crew: 'jun', path: [P(3, 2)] }).state);
        expect(types(t1.events)).toContain('operatorVerifies');
        // Turn 2 shows cam2: cam's report goes nowhere.
        const fresh = clonePlain(s);
        fresh.turn = 2;
        const t2 = endTurn(two, step(two, fresh, { type: 'move', crew: 'jun', path: [P(3, 2)] }).state);
        expect(types(t2.events)).not.toContain('operatorVerifies');
        expect(t2.state.carriers).toEqual([]);
    });

    it('panning cameras turn one step each world phase', () => {
        const { world } = camBank();
        const pan = freezeWorld({ ...(clonePlain(world) as World), cameras: [{ id: 'cam', pos: P(0, 0), facings: ['e', 's'], room: null }] });
        const s = initialState(pan, { seed: 1, crew: [{ id: 'jun', pos: P(4, 2) }] });
        const one = endTurn(pan, s);
        expect(one.state.cameras.cam!.facing).toBe(1);
        expect(endTurn(pan, one.state).state.cameras.cam!.facing).toBe(0);
    });

    it('recorder taken: the footage of an unmasked illegal act is gone', () => {
        const built = setup(
            ['......', '......', '......'],
            [person('cust', 'customer', 'civilian', P(2, 2), 'w')],
            [{ id: 'jun', pos: P(3, 2) }, { id: 'mara', pos: P(4, 1) }],
            { cameras: [{ id: 'cam', pos: P(0, 0), facings: ['se'], room: null }], objects: [obj('desk', 'cctvDesk', P(5, 0), { monitors: 1 }), obj('rec', 'recorder', P(5, 0))] }
        );
        const { world, state } = built;
        const ko = act(world, state, { type: 'knockout', crew: 'jun', npc: 'cust' });
        expect(ko.events).toContainEqual({ type: 'footageRecorded', camera: 'cam', crew: 'jun' });
        expect(filmedCrew(world, ko.state)).toEqual(['jun']);
        const taken = act(world, ko.state, { type: 'interact', crew: 'mara', object: 'rec', verb: 'take' });
        expect(taken.state.objects.rec).toEqual({ taken: 'mara' });
        expect(filmedCrew(world, taken.state)).toEqual([]);
        expect(() => commit(world, taken.state, { type: 'interact', crew: 'mara', object: 'rec', verb: 'destroy' })).toThrow(/gone/);
    });

    it('with the operator down and a crew member at the desk, the crew sees through the cameras', () => {
        const { world } = camBank();
        const blind = initialState(world, { seed: 3, crew: [{ id: 'jun', pos: P(9, 0) }, { id: 'mara', pos: P(9, 2) }] });
        blind.npcs[0]!.status = 'tied';
        const r = step(world, blind, { type: 'wait', crew: 'mara' });
        // The lobby west of the wall is seen through the camera.
        expect(knownView(world, r.state).inView[1 * world.width + 2]).toBe(1);
        const watched = initialState(world, { seed: 3, crew: [{ id: 'jun', pos: P(9, 0) }, { id: 'mara', pos: P(9, 2) }] });
        expect(knownView(world, step(world, watched, { type: 'wait', crew: 'mara' }).state).inView[1 * world.width + 2]).toBe(0);
    });
});

// ---------------------------------------------------------------------------------------------------------- Every kind

// A test command that starts a carrier of a kind from a source (the starters of later milestones: sensors, escapees).
registerTestCommand('test.startCarrier', (ctx, cmd) => {
    const c = cmd as unknown as { kind: CarrierKind; source: string; pos: Pos; subject?: string };
    raiseCarrier(ctx, { kind: c.kind, source: c.source, pos: c.pos, ...(c.subject ? { subject: c.subject } : {}) });
});

/** A carrier of each kind, from its usual source, and the counter M1 has for it, played mid-countdown. */
const KINDS: Record<CarrierKind, { role: string; observer: ObserverClass; counter: 'knockout' | 'panel' | 'answer' | 'jammer' }> = {
    tellerButton: { role: 'teller', observer: 'staff', counter: 'panel' },
    managerButton: { role: 'manager', observer: 'staff', counter: 'knockout' },
    guardRadio: { role: 'guard', observer: 'enforcer', counter: 'knockout' },
    operatorCamera: { role: 'operator', observer: 'staff', counter: 'knockout' },
    phoneCall: { role: 'teller', observer: 'staff', counter: 'knockout' },
    escapee: { role: 'customer', observer: 'civilian', counter: 'knockout' },
    missedCheckIn: { role: 'operator', observer: 'staff', counter: 'answer' },
    seismicSensor: { role: 'vault', observer: 'staff', counter: 'panel' },
    motionSensor: { role: 'vault', observer: 'staff', counter: 'panel' },
    patrolCar: { role: 'patrol', observer: 'staff', counter: 'jammer' }
};

describe('every carrier kind', () => {
    const kinds = Object.keys(CARRIERS) as CarrierKind[];

    it('is listed with its counters, at least two, one of them working now', () => {
        expect(kinds.sort()).toEqual((Object.keys(KINDS) as CarrierKind[]).sort());
        for (const k of kinds) {
            expect(CARRIERS[k].counters.length, k).toBeGreaterThanOrEqual(2);
            expect(CARRIERS[k].counters.some(c => c.now === true), k).toBe(true);
        }
    });

    for (const kind of Object.keys(KINDS) as CarrierKind[]) {
        it(`${kind}: starts at 2 or more and has a counter that works mid-countdown`, () => {
            const spec = KINDS[kind];
            const npcSource = spec.role !== 'vault' && spec.role !== 'patrol';
            const people = [
                ...(npcSource ? [person('src', spec.role, spec.observer, P(3, 1), 'n')] : []),
                person('guard', 'guard', 'enforcer', P(1, 2), 'n')
            ];
            const { world, state } = setup(['......', '......', '......'], people,
                [{ id: 'jun', pos: P(2, 1), items: ['hackingKit', 'jammer'], traits: ['steadyHands'] }],
                { objects: [obj('panel', 'alarmPanel', P(1, 0))] });
            const s0 = clonePlain(state);
            // The guard is down, his radio ringing: the subject of a missed check-in.
            const guard = s0.npcs.find(n => n.id === 'guard')!;
            guard.status = 'tied';
            guard.intent = { path: [] };
            const source = npcSource ? 'src' : spec.role;
            const start = testCommand({ type: 'test.startCarrier', kind, source, pos: P(3, 1), subject: 'guard' } as never);
            const started = step(world, s0, start);
            const event = started.events.find(e => e.type === 'carrierStarted');
            expect(event && event.type === 'carrierStarted' && event.countdown, kind).toBeGreaterThanOrEqual(world.rules.minCarrierCountdown);
            // Unanswered, it raises the Alarm.
            expect(turns(world, started.state, 2).state.bank.alarm, kind).toBe(true);
            // Mid-countdown (after a tick), the counter.
            let s = endTurn(world, started.state).state;
            expect(s.carriers[0]!.countdown, kind).toBe(1);
            const counter: Command[] = spec.counter === 'knockout' ? [{ type: 'knockout', crew: 'jun', npc: 'src' }]
                : spec.counter === 'panel' ? [disable('jun'), disable('jun')]
                    : spec.counter === 'answer' ? [{ type: 'answerRadio', crew: 'jun', npc: 'guard' }]
                        : [{ type: 'placeJammer', crew: 'jun' }];
            for (const cmd of counter) s = act(world, s, cmd).state;
            expect(s.carriers.every(c => c.halted !== null) || s.carriers.length === 0, kind).toBe(true);
            expect(turns(world, s, 3).state.bank.alarm, kind).toBe(false);
        });
    }
});
