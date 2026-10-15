import { describe, expect, it } from 'vitest';
import { actionMenu, menuIsLegal, nextCamera } from '../../src/game/actions';
import { MemoryStorage } from '../../src/game/storage';
import { Session } from '../../src/game/session';
import { bankView, describeEvent, threatLedger } from '../../src/game/views';
import { cameraViews, npcBadges } from '../../src/game/worldUi';
import {
    commit, fixtureWorld, initialState, knownView, type Command, type CrewStart, type Facing, type FixtureOptions, type ObserverClass, type PersonDef, type Pos,
    type ReadonlyWorld, type State, type WorldObject
} from '../../src/sim';
import { scouted } from '../sim/helpers';

/*
 * Play mode's side of M1-08: the alarm panel, the radio, the cameras and the Alarm in the action grid, Confirm, the
 * threat ledger, the state pill and the world overlay.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const person = (id: string, role: string, observer: ObserverClass, pos: Pos, facing: Facing): PersonDef => ({ id, name: id, role, observer, pos, facing, schedule: [] });
const obj = (id: string, kind: string, pos: Pos, extra: Partial<WorldObject> = {}): WorldObject => ({ id, kind, pos, facing: 's', ...extra });
const wallAfter = (x: number, rows: number) => Array.from({ length: rows }, (_, y) => ({ between: [P(x, y), P(x + 1, y)] as [Pos, Pos] }));

function setup(map: readonly string[], people: PersonDef[], crew: CrewStart[], options: FixtureOptions = {}): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(map, { people, ...options });
    return { world, state: scouted(world, initialState(world, { seed: 3, crew })) };
}

const session = (world: ReadonlyWorld, state: State) => Session.start({ world, state, storage: new MemoryStorage(), genVersion: 'fixture' });
const disable: Command = { type: 'interact', crew: 'jun', object: 'panel', verb: 'disable' };

// A teller at her window on the right; Jun behind a wall at the alarm panel; Mara, masked, in the lobby.
const tellerBank = () => setup(
    ['........', '........', '........'],
    [person('teller', 'teller', 'staff', P(7, 1), 'w')],
    [{ id: 'jun', pos: P(0, 1), items: ['hackingKit'] }, { id: 'mara', pos: P(5, 1), masked: true }],
    { walls: wallAfter(1, 3), objects: [obj('panel', 'alarmPanel', P(0, 0))] }
);

describe('the alarm panel in the action grid', () => {
    it('offers Disable panel with its work so far, and Confirm says it stops the wired carriers', () => {
        const { world, state } = tellerBank();
        const entry = () => actionMenu(world, s.state, 'jun').find(e => e.id === 'interact:disable')!;
        const s = session(world, state);
        expect(entry()).toMatchObject({ label: 'Disable panel', icon: 'hack', progress: '0/4' });
        expect(entry().reason).toBeUndefined();
        expect(menuIsLegal(world, s.state, 'jun', actionMenu(world, s.state, 'jun'))).toBe(true);
        s.commit(disable);
        s.commit(disable);
        expect(entry().progress).toBe('2/4');
        s.endTurn();
        // A teller button running: the last action of work kills it.
        s.commit(disable);
        const live = structuredClone(s.state);
        live.carriers.push({ id: 'c-9', kind: 'tellerButton', source: 'teller', pos: P(7, 1), countdown: 2, started: { turn: live.turn, phase: 'world' }, halted: null });
        const t = session(world, live);
        expect(threatLedger(t.state, world).map(r => r.label)).toEqual(['Teller button']);
        expect(threatLedger(t.state, world)[0]).toMatchObject({ portrait: 'teller', countdown: 2 });
        t.select('jun');
        t.setPendingCommand(disable);
        const hud = t.hud();
        expect(hud.actions.find(a => a.id === 'interact:disable')).toMatchObject({ progress: '3/4', enabled: true });
        expect(hud.confirm).toMatchObject({ label: 'DISABLE PANEL', stops: ['Teller button'] });
        const done = t.commit(disable);
        expect(done.state.carriers).toEqual([]);
        expect(t.hud().ledger).toEqual([]);
        expect(describeEvent(world, done.state, done.events.find(e => e.type === 'carrierStopped')!)).toBe('Teller button stopped: the alarm panel is dead');
        const next = commit(world, t.state, { type: 'endTurn' }).state;
        expect(actionMenu(world, next, 'jun').find(e => e.id === 'interact:disable')!.reason).toMatch(/dead already/);
    });

    it('Confirm names the carrier the coming world phase would start, in amber', () => {
        const { world, state } = tellerBank();
        const s = session(world, state);
        s.select('mara');
        s.setPendingCommand({ type: 'wait', crew: 'mara' });
        expect(s.hud().confirm).toMatchObject({ kind: 'costly', starts: ['Teller button (2)'] });
        expect(s.carrierChanges({ type: 'wait', crew: 'mara' })?.worldPhase.map(c => c.kind)).toEqual(['tellerButton']);
        // Once committed, the teller on her way to the button is in the ledger before her carrier starts.
        s.commit({ type: 'wait', crew: 'mara' });
        expect(threatLedger(s.state, world).find(t => t.id === 'walk:teller')).toMatchObject({ kind: 'tellerButton', portrait: 'teller', label: expect.stringMatching(/^Teller button: on the way/) });
    });
});

describe('the Alarm', () => {
    it('turns the pill to "ALARM: police in N" and puts the police in the ledger', () => {
        const { world, state } = tellerBank();
        let s = commit(world, state, { type: 'wait', crew: 'mara' }).state;
        for (let i = 0; i < 3; i++) s = commit(world, s, { type: 'endTurn' }).state;
        expect(s.bank.alarm).toBe(true);
        expect(bankView(s)).toMatchObject({ status: 'alarm', label: 'ALARM: police in 6', policeEta: 6, nextAlarmIn: null, heat: null });
        expect(threatLedger(s, world)).toEqual([expect.objectContaining({ id: 'police', kind: 'reinforcement', countdown: 6 })]);
        s = commit(world, s, { type: 'endTurn' }).state;
        expect(bankView(s).label).toBe('ALARM: police in 5');
    });
});

describe('radio check-ins', () => {
    // A guard tied up on the left, Jun beside him; the operator at the CCTV desk behind a wall on the right.
    const radioBank = () => {
        const built = setup(
            ['..........', '..........', '..........'],
            [person('guard', 'lobbyGuard', 'enforcer', P(1, 1), 's'), person('op', 'operator', 'staff', P(8, 1), 'e')],
            [{ id: 'jun', pos: P(2, 1) }, { id: 'mara', pos: P(7, 2), items: ['hackingKit'] }],
            {
                walls: wallAfter(4, 3), cameras: [{ id: 'cam', pos: P(0, 0), facings: ['se', 'e'], room: null }],
                objects: [obj('desk', 'cctvDesk', P(9, 1), { monitors: 4 }), obj('rec', 'recorder', P(9, 1))]
            }
        );
        built.state.npcs[0]!.status = 'tied';
        built.state.npcs[0]!.intent = { path: [] };
        return built;
    };

    it('lists the next call, then the ringing radio first; the grid offers Answer radio, which stops it', () => {
        const { world, state } = radioBank();
        expect(threatLedger(state, world).find(t => t.kind === 'checkIn')).toMatchObject({ label: 'Check-in: guard', countdown: 6, portrait: 'guard' });
        let s = state;
        for (let i = 0; i < 6; i++) s = commit(world, s, { type: 'endTurn' }).state;
        expect(s.radio.calls.guard!.ringing).toBe(6);
        const ledger = threatLedger(s, world);
        expect(ledger[0]).toMatchObject({ id: 'checkIn:guard', label: 'Radio ringing: guard', countdown: 1, urgent: true });
        // The guard wears his radio: ringing.
        expect(npcBadges(world, s, knownView(world, s)).find(b => b.id === 'guard')!.plates).toContainEqual({ glyph: 'radio', signal: 'amber', sym: '!' });
        const answer = actionMenu(world, s, 'jun').find(e => e.id === 'answer')!;
        expect(answer).toMatchObject({ label: 'Answer radio', command: { type: 'answerRadio', crew: 'jun', npc: 'guard' } });
        expect(answer.reason).toBeUndefined();
        const done = commit(world, s, answer.command);
        expect(done.state.radio.calls.guard!.ringing).toBeNull();
        expect(threatLedger(done.state, world).find(t => t.kind === 'checkIn')).toMatchObject({ label: 'Check-in: guard', countdown: 6 });
        expect(describeEvent(world, done.state, done.events.find(e => e.type === 'radioAnswered')!)).toBe('jun answered guard’s radio');
        // Nothing ringing: no entry.
        expect(actionMenu(world, done.state, 'jun').some(e => e.id === 'answer')).toBe(false);
    });

    it('loops a known camera from the desk and cycles through the known ones', () => {
        const { world, state } = radioBank();
        const s = structuredClone(state);
        s.crew[1]!.pos = P(8, 2);
        s.knowledge.cameras = [];
        s.knowledge.cctv = false;
        expect(actionMenu(world, s, 'mara').some(e => e.id === 'loop')).toBe(false);
        s.knowledge.cameras = ['cam'];
        const loop = actionMenu(world, s, 'mara').find(e => e.id === 'loop')!;
        expect(loop).toMatchObject({ label: 'Loop feed', target: 'cam', command: { type: 'loopFeed', crew: 'mara', object: 'desk', camera: 'cam' } });
        expect(nextCamera(world, s, 'mara', 'cam')).toBe('cam');
        const looped = commit(world, s, loop.command).state;
        // Unknown feed status (the CCTV room not scouted): a camera counts as live; once scouted, a looped one dims.
        expect(cameraViews(world, s, knownView(world, s), true)[0]).toMatchObject({ status: 'unknown', dead: false });
        looped.knowledge.cctv = true;
        const [cam] = cameraViews(world, looped, knownView(world, looped), true);
        expect(cam).toMatchObject({ id: 'cam', status: 'off', loopLeft: 4, dead: false });
        expect(cam!.core.length).toBeGreaterThan(0);
        expect(cameraViews(world, looped, knownView(world, looped), false)[0]!.core).toEqual([]);
    });
});
