import { describe, expect, it } from 'vitest';
import {
    commit, crewBudget, crewLook, dashRefusal, evidenceOnMap, evidenceWorldPhase, fixtureWorld, hashOf, IllegalCommand, initialState, legalActions,
    preview, registerInteraction, registerKnockoutWindow, sightMap, type Command, type CrewStart, type Facing, type FixtureOptions, type ObserverClass,
    type PersonDef, type Pos, type ReadonlyWorld, type SimEvent, type State, type WorldObject
} from '../../src/sim';
import { scouted, step } from './helpers';

/*
 * The crew actions of M1-07 (§6.1–6.3, §8.10, §11.10): doors, knockout, dragging and stashing bodies, waiting and the
 * generic interact, and the evidence NPCs notice in the world phase.
 */

const P = (x: number, y: number): Pos => ({ x, y });

const person = (id: string, role: string, observer: ObserverClass, pos: Pos, facing: Facing): PersonDef =>
    ({ id, name: id, role, observer, pos, facing, schedule: [] });

const FLOOR = Array.from({ length: 8 }, () => '............');

function setup(people: PersonDef[], crew: CrewStart[], options: FixtureOptions = {}, map: readonly string[] = FLOOR): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(map, { people, ...options });
    return { world, state: initialState(world, { seed: 7, crew }) };
}

const types = (events: readonly SimEvent[]): string[] => events.map(e => e.type);
const npc = (state: State, id: string) => state.npcs.find(n => n.id === id)!;
const endTurn = (world: ReadonlyWorld, state: State) => step(world, state, { type: 'endTurn' });

/** Commits and checks that the preview said exactly the same. */
function act(world: ReadonlyWorld, state: State, cmd: Command) {
    const seen = preview(world, state, cmd);
    const done = step(world, state, cmd);
    expect(seen.events).toEqual(done.events);
    expect(hashOf(seen.state)).toBe(hashOf(done.state));
    return done;
}

describe('doors', () => {
    const doorWorld = (start: 'closed' | 'locked' | 'open' = 'closed', lock: 'none' | 'mechanical' = 'mechanical') => setup(
        [person('guard', 'guard', 'enforcer', P(11, 7), 'e')],
        [{ id: 'jun', pos: P(4, 2) }],
        { walls: [{ between: [P(4, 2), P(5, 2)], door: { id: 'd', lock, start } }] }
    );

    it('open and close from a tile beside them, for 1 action each', () => {
        const { world, state } = doorWorld();
        const opened = act(world, state, { type: 'door', crew: 'jun', door: 'd', action: 'open' });
        expect(opened.state.doors.d!.status).toBe('open');
        expect(opened.state.crew[0]!.actionsLeft).toBe(1);
        expect(opened.events[0]).toEqual({ type: 'doorOpened', door: 'd', by: 'jun' });
        const closed = act(world, opened.state, { type: 'door', crew: 'jun', door: 'd', action: 'close' });
        expect(closed.state.doors.d!.status).toBe('closed');
        expect(closed.events[0]).toEqual({ type: 'doorClosed', door: 'd', by: 'jun' });
        expect(() => commit(world, closed.state, { type: 'door', crew: 'jun', door: 'd', action: 'open' })).toThrow(/0 of 1 actions/);
    });

    it('refuse from afar, and what the door doesn\'t allow', () => {
        const { world, state } = doorWorld();
        const away = { ...state, crew: [{ ...state.crew[0]!, pos: P(3, 2) }] };
        expect(() => commit(world, away, { type: 'door', crew: 'jun', door: 'd', action: 'open' })).toThrow(/isn't beside the door/);
        expect(() => commit(world, state, { type: 'door', crew: 'jun', door: 'd', action: 'close' })).toThrow(/already shut/);
        expect(() => commit(world, state, { type: 'door', crew: 'jun', door: 'd', action: 'unlock' })).toThrow(IllegalCommand);
        expect(() => commit(world, state, { type: 'door', crew: 'jun', door: 'nope', action: 'open' })).toThrow(/No door/);
    });

    it('lock without a key, but never unlock or open a locked door without one', () => {
        const { world, state } = doorWorld();
        const locked = act(world, state, { type: 'door', crew: 'jun', door: 'd', action: 'lock' });
        expect(locked.state.doors.d!.status).toBe('locked');
        expect(locked.events[0]).toEqual({ type: 'doorLocked', door: 'd', by: 'jun' });
        expect(() => commit(world, locked.state, { type: 'door', crew: 'jun', door: 'd', action: 'open' })).toThrow(/locked/);
        expect(() => commit(world, locked.state, { type: 'door', crew: 'jun', door: 'd', action: 'unlock' })).toThrow(/no key/);
        expect(() => commit(world, locked.state, { type: 'door', crew: 'jun', door: 'd', action: 'lock' })).toThrow(/already locked/);
        const plain = doorWorld('closed', 'none');
        expect(() => commit(plain.world, plain.state, { type: 'door', crew: 'jun', door: 'd', action: 'lock' })).toThrow(/no lock/);
        const open = doorWorld('open');
        expect(() => commit(open.world, open.state, { type: 'door', crew: 'jun', door: 'd', action: 'lock' })).toThrow(/Close the door first/);
    });

    it('can be taken back when nothing new was seen and nobody noticed', () => {
        const { world, state } = doorWorld('open');
        const known = scouted(world, state);
        expect(act(world, known, { type: 'door', crew: 'jun', door: 'd', action: 'close' }).undoable).toBe(true);
        // Opening a door onto unscouted floor reveals it: final.
        const fresh = doorWorld();
        expect(act(fresh.world, fresh.state, { type: 'door', crew: 'jun', door: 'd', action: 'open' }).undoable).toBe(false);
    });

    it('are offered by legalActions only where they can be used', () => {
        const { world, state } = doorWorld();
        expect(legalActions(world, state, 'jun')).toEqual([
            { type: 'door', crew: 'jun', door: 'd', action: 'open' },
            { type: 'door', crew: 'jun', door: 'd', action: 'lock' },
            { type: 'wait', crew: 'jun' }
        ]);
    });
});

describe('knockout', () => {
    // The guard faces north, away from Jun standing south of it.
    const pair = (options: FixtureOptions = {}) =>
        setup([person('guard', 'guard', 'enforcer', P(5, 3), 'n')], [{ id: 'jun', pos: P(5, 4) }, { id: 'mara', pos: P(0, 7) }], options);

    it('drops an NPC in reach for 1 action: unconscious, its intent cleared, a quiet noise of radius 2, final', () => {
        const { world, state } = pair();
        const done = act(world, state, { type: 'knockout', crew: 'jun', npc: 'guard' });
        const g = npc(done.state, 'guard');
        expect(g.status).toBe('unconscious');
        expect(g.intent).toEqual({ path: [] });
        expect(g.outCold).toBe(4);
        expect(done.state.crew[0]!.actionsLeft).toBe(1);
        expect(types(done.events).slice(0, 3)).toEqual(['knockedOut', 'npcStatus', 'noise']);
        expect(done.events.find(e => e.type === 'noise')).toMatchObject({ radius: 2, kind: 'quiet', sources: [P(5, 3)] });
        expect(done.undoable).toBe(false);
    });

    it('needs the NPC in reach, not through a wall, not already down, not hostile unless caught off guard', () => {
        const { world, state } = pair();
        expect(() => commit(world, state, { type: 'knockout', crew: 'mara', npc: 'guard' })).toThrow(/can't reach/);
        const walled = pair({ walls: [{ between: [P(5, 3), P(5, 4)] }] });
        expect(() => commit(walled.world, walled.state, { type: 'knockout', crew: 'jun', npc: 'guard' })).toThrow(/can't reach/);
        const down = commit(world, state, { type: 'knockout', crew: 'jun', npc: 'guard' }).state;
        expect(() => commit(world, down, { type: 'knockout', crew: 'jun', npc: 'guard' })).toThrow(/already down/);
        const hostile = structuredClone(state);
        npc(hostile, 'guard').status = 'hostile';
        expect(() => commit(world, hostile, { type: 'knockout', crew: 'jun', npc: 'guard' })).toThrow(/hostile/);
        // A Hostile NPC caught off guard (Surprised, Suppressed: a later package's window) can be.
        registerKnockoutWindow('test.surprised', n => n.alertCause === 'test surprised');
        npc(hostile, 'guard').alertCause = 'test surprised';
        expect(commit(world, hostile, { type: 'knockout', crew: 'jun', npc: 'guard' }).state.npcs[0]!.status).toBe('unconscious');
    });

    it('is an illegal act: anyone who sees it Exposes the crew member', () => {
        const { world, state } = setup(
            [person('guard', 'guard', 'enforcer', P(5, 3), 'n'), person('teller', 'teller', 'staff', P(9, 4), 'w')],
            [{ id: 'jun', pos: P(5, 4) }]
        );
        const done = act(world, state, { type: 'knockout', crew: 'jun', npc: 'guard' });
        expect(npc(done.state, 'teller').exposedTo).toEqual(['jun']);
        expect(done.events).toContainEqual({ type: 'exposed', npc: 'teller', crew: 'jun', why: ['illegal'] });
    });

    it('lasts 4 world phases, then the NPC wakes Alerted where it lies and reports its assault', () => {
        const { world, state } = pair();
        let s = commit(world, state, { type: 'knockout', crew: 'jun', npc: 'guard' }).state;
        // Jun steps away so the guard has room.
        s = commit(world, s, { type: 'move', crew: 'jun', path: [P(6, 5)] }).state;
        for (let i = 0; i < 3; i++) {
            s = endTurn(world, s).state;
            expect(npc(s, 'guard').status).toBe('unconscious');
        }
        const woke = endTurn(world, s);
        const g = npc(woke.state, 'guard');
        expect(woke.events).toContainEqual({ type: 'woke', npc: 'guard', at: P(5, 3) });
        expect(g.status).toBe('alerted');
        expect(g.pos).toEqual(P(5, 3));
        expect(g.alerted).toBe(true);
        expect(g.alertCause).toBe('knocked out');
        expect(g.outCold).toBeNull();
        expect(g.goal.kind).toBe('report');
        expect(g.intent.action).toEqual({ kind: 'reportEvidence', evidence: 'assault:guard', carrier: 'guardRadio' });
    });
});

describe('the double takedown (§6.2)', () => {
    // The guard sees Jun's rifle and Exposes him; before the world phase Mara drops the guard: it never acts.
    const scene = () => setup(
        [person('guard', 'guard', 'enforcer', P(2, 2), 'e')],
        [{ id: 'jun', pos: P(5, 2), items: ['assaultRifle'] }, { id: 'mara', pos: P(2, 3) }]
    );

    it('a witness dropped in the same crew phase never acts on what it saw', () => {
        const { world, state } = scene();
        const seen = act(world, state, { type: 'wait', crew: 'jun' }).state;
        const guard = npc(seen, 'guard');
        expect(guard.exposedTo).toEqual(['jun']);
        expect(guard.intent.action).toEqual({ kind: 'raiseAlarm', carrier: 'guardRadio', crew: 'jun' });
        // Left alone, it carries out its radio call in the world phase (M1-08's hook): its intent is frozen with it.
        const dropped = act(world, seen, { type: 'knockout', crew: 'mara', npc: 'guard' }).state;
        expect(npc(dropped, 'guard').intent).toEqual({ path: [] });
        const world1 = endTurn(world, dropped);
        expect(world1.events.filter(e => 'npc' in e && e.npc === 'guard').map(e => e.type)).toEqual([]);
        expect(npc(world1.state, 'guard').status).toBe('unconscious');
        expect(npc(world1.state, 'guard').intent).toEqual({ path: [] });
        expect(world1.state.carriers).toEqual([]);
    });
});

describe('dragging and stashing bodies', () => {
    const dumpster: WorldObject = { id: 'dumpster-0', kind: 'dumpster', pos: P(4, 5), facing: 's' };
    const map = FLOOR.map((row, y) => (y === 5 ? `${row.slice(0, 4)}#${row.slice(5)}` : row));
    const scene = (tellerFacing: Facing = 'e') => setup(
        [person('clerk', 'clerk', 'staff', P(5, 3), 'n'), person('teller', 'teller', 'staff', P(9, 3), tellerFacing),
            person('guard', 'guard', 'enforcer', P(0, 7), 'sw')],
        [{ id: 'jun', pos: P(5, 4) }],
        { objects: [dumpster] },
        map
    );

    it('drag a body: half the reach, no dash, Armed, the body following every step', () => {
        const { world, state } = scene();
        let s = commit(world, state, { type: 'knockout', crew: 'jun', npc: 'clerk' }).state;
        const lifted = act(world, s, { type: 'drag', crew: 'jun', npc: 'clerk' });
        expect(lifted.events).toContainEqual({ type: 'bodyLifted', crew: 'jun', npc: 'clerk' });
        s = lifted.state;
        const jun = s.crew[0]!;
        expect(jun.dragging).toBe('clerk');
        expect(crewLook(jun).profile).toBe('armed');
        expect(npc(s, 'clerk').pos).toEqual(P(5, 4));
        s = endTurn(world, s).state;
        expect(crewBudget(world, s.crew[0]!, 'move')).toBe(5);
        expect(dashRefusal(world, s, 'jun')).toMatch(/dragging a body/);
        expect(() => commit(world, s, { type: 'dash', crew: 'jun', path: [P(6, 4)] })).toThrow(/dragging a body/);
        expect(() => commit(world, s, { type: 'move', crew: 'jun', path: [P(6, 4), P(7, 4), P(8, 4)] })).toThrow(/out of reach/);
        s = commit(world, s, { type: 'move', crew: 'jun', path: [P(6, 4), P(7, 4)] }).state;
        expect(npc(s, 'clerk').pos).toEqual(P(7, 4));
        const dropped = act(world, s, { type: 'drop', crew: 'jun' });
        expect(dropped.state.crew[0]!.dragging).toBeNull();
        expect(dropped.state.crew[0]!.loadout.carrying).toBeNull();
        expect(crewBudget(world, dropped.state.crew[0]!, 'move')).toBe(10);
        expect(() => commit(world, state, { type: 'drag', crew: 'jun', npc: 'clerk' })).toThrow(/Only a body/);
    });

    it('stash it in reach of a dumpster: it is no evidence any more', () => {
        const { world, state } = scene();
        let s = commit(world, state, { type: 'knockout', crew: 'jun', npc: 'clerk' }).state;
        s = commit(world, s, { type: 'drag', crew: 'jun', npc: 'clerk' }).state;
        expect(evidenceOnMap(world, s)).toEqual([]);
        s = endTurn(world, s).state;
        expect(() => commit(world, s, { type: 'stash', crew: 'jun' })).toThrow(/nowhere here/);
        const stashed = act(world, s, { type: 'stash', crew: 'jun', at: 'dumpster-0' });
        expect(stashed.events).toContainEqual({ type: 'bodyStashed', crew: 'jun', npc: 'clerk', stash: 'dumpster-0', at: P(5, 4) });
        s = stashed.state;
        expect(npc(s, 'clerk').stashed).toBe('dumpster-0');
        expect(s.crew[0]!.dragging).toBeNull();
        expect(evidenceOnMap(world, s)).toEqual([]);
        // The teller turns to look where the body lay: nothing to notice.
        npc(s, 'teller').intent = { path: [], facing: 'w' };
        s = commit(world, s, { type: 'move', crew: 'jun', path: [P(6, 5), P(7, 6)] }).state;
        expect(evidenceWorldPhase(world, s, sightMap(world, s))).toEqual([]);
        expect(types(endTurn(world, s).events)).not.toContain('evidenceNoticed');
    });

    it('stash it anywhere in a stash room', () => {
        const world = fixtureWorld(FLOOR, { people: [person('clerk', 'clerk', 'staff', P(5, 3), 'n')] });
        const closet = { ...world, stashRooms: ['closet'], tiles: world.tiles.map(t => ({ ...t, room: 'closet' })) } as ReadonlyWorld;
        let s = initialState(closet, { seed: 1, crew: [{ id: 'jun', pos: P(5, 4) }] });
        s = commit(closet, s, { type: 'knockout', crew: 'jun', npc: 'clerk' }).state;
        s = commit(closet, s, { type: 'drag', crew: 'jun', npc: 'clerk' }).state;
        s = endTurn(closet, s).state;
        expect(commit(closet, s, { type: 'stash', crew: 'jun' }).state.npcs[0]!.stashed).toBe('closet');
    });
});

describe('evidence (§8.10)', () => {
    const scene = () => setup(
        [person('clerk', 'clerk', 'staff', P(5, 3), 'n'), person('teller', 'teller', 'staff', P(9, 3), 'e'),
            person('guard', 'guard', 'enforcer', P(0, 7), 'sw')],
        [{ id: 'jun', pos: P(5, 4) }]
    );

    it('a body seen in the world phase: Alerted, a first-time bark, then off to tell a guard, who radios', () => {
        const { world, state } = scene();
        let s = commit(world, state, { type: 'knockout', crew: 'jun', npc: 'clerk' }).state;
        s = commit(world, s, { type: 'move', crew: 'jun', path: [P(5, 5), P(5, 6)] }).state;
        // Nobody saw it happen; in the world phase the teller turns round.
        npc(s, 'teller').intent = { path: [], facing: 'w' };
        const predicted = evidenceWorldPhase(world, s, sightMap(world, s));
        expect(predicted).toEqual([{ observer: 'teller', by: 'npc', evidence: 'body:clerk', kind: 'body', major: true, tile: P(5, 3) }]);
        const phase = endTurn(world, s);
        expect(phase.events).toContainEqual({ type: 'evidenceNoticed', npc: 'teller', evidence: 'body:clerk', kind: 'body', major: true });
        expect(phase.events).toContainEqual({ type: 'bark', npc: 'teller', cause: 'body', evidence: 'body:clerk', first: true });
        s = phase.state;
        const teller = npc(s, 'teller');
        expect(teller.alerted).toBe(true);
        expect(teller.status).toBe('alerted');
        expect(teller.goal).toEqual({ kind: 'report', evidence: 'body:clerk', tile: P(5, 3) });
        expect(teller.intent.action).toEqual({ kind: 'tellEvidence', npc: 'guard', evidence: 'body:clerk' });
        let told = false;
        for (let i = 0; i < 4 && !told; i++) {
            const next = endTurn(world, s);
            told = next.events.some(e => e.type === 'toldEvidence');
            s = next.state;
        }
        expect(told).toBe(true);
        expect(npc(s, 'teller').evidence).toBeNull();
        const guard = npc(s, 'guard');
        expect(guard.alerted).toBe(true);
        expect(guard.goal.kind).toBe('report');
        expect(guard.intent.action).toEqual({ kind: 'reportEvidence', evidence: 'body:clerk', carrier: 'guardRadio' });
        // Each noticed once.
        expect(guard.noticed).toContain('body:clerk');
    });

    it('later barks about the same kind are generic', () => {
        const { world, state } = setup(
            [person('a', 'clerk', 'staff', P(5, 3), 'n'), person('b', 'clerk', 'staff', P(3, 3), 'n'), person('teller', 'teller', 'staff', P(9, 3), 'w')],
            [{ id: 'jun', pos: P(4, 0) }]
        );
        const s = structuredClone(state);
        for (const id of ['a', 'b']) { npc(s, id).status = 'unconscious'; npc(s, id).outCold = 9; }
        const phase = endTurn(world, s);
        const barks = phase.events.filter(e => e.type === 'bark');
        expect(barks).toEqual([
            { type: 'bark', npc: 'teller', cause: 'body', evidence: 'body:a', first: true },
            { type: 'bark', npc: 'teller', cause: 'body', evidence: 'body:b', first: false }
        ]);
        expect(phase.state.barked).toEqual(['body']);
    });

    it('a Secure door left open: one investigates, the others look, then back to routine', () => {
        const map = FLOOR.map(row => `${row.slice(0, 7)}xxxxx`);
        const { world, state } = setup(
            [person('guard', 'guard', 'enforcer', P(2, 2), 'e'), person('clerk', 'clerk', 'staff', P(2, 4), 'e'), person('kid', 'customer', 'civilian', P(2, 6), 'e')],
            [{ id: 'jun', pos: P(6, 2) }],
            { walls: [{ between: [P(6, 2), P(7, 2)], door: { id: 'vault', start: 'closed' } }] },
            map
        );
        let s = commit(world, state, { type: 'door', crew: 'jun', door: 'vault', action: 'open' }).state;
        s = commit(world, s, { type: 'move', crew: 'jun', path: [P(5, 3)] }).state;
        expect(evidenceOnMap(world, s)).toEqual([{ id: 'door:vault', kind: 'secureDoor', tiles: [P(6, 2), P(7, 2)] }]);
        const predicted = evidenceWorldPhase(world, s, sightMap(world, s));
        const phase = endTurn(world, s);
        const noticed = phase.events.filter(e => e.type === 'evidenceNoticed');
        // The customer doesn't care about minor evidence.
        expect(noticed.map(e => e.npc)).toEqual(['guard', 'clerk']);
        expect(predicted.map(p => p.observer)).toEqual(['guard', 'clerk']);
        s = phase.state;
        expect([npc(s, 'guard').goal.kind, npc(s, 'guard').status]).toEqual(['inspect', 'investigating']);
        expect([npc(s, 'clerk').goal.kind, npc(s, 'clerk').status]).toEqual(['look', 'curious']);
        expect(npc(s, 'guard').alerted).toBe(false);
        // The guard walks over; the clerk looks for one phase.
        const next = endTurn(world, s);
        expect(next.events).toContainEqual({ type: 'evidenceDropped', npc: 'guard', evidence: 'door:vault' });
        expect(next.events).toContainEqual({ type: 'evidenceDropped', npc: 'clerk', evidence: 'door:vault' });
        expect(npc(next.state, 'guard').goal.kind).toBe('still');
        expect(npc(next.state, 'guard').status).toBe('calm');
        // Noticed once: the door closed itself, and it isn't news again.
        expect(npc(next.state, 'guard').noticed).toEqual(['door:vault']);
    });

    it('a missing colleague at their window, and a dead camera, are minor evidence', () => {
        const world = fixtureWorld(FLOOR, {
            people: [{ ...person('teller', 'teller', 'staff', P(5, 3), 'n'), schedule: [{ from: 1, activity: 'window', label: 'window', room: '', at: P(5, 3), facing: 'n' }] }],
            cameras: [{ id: 'cam', pos: P(0, 0), facings: ['se'], room: null }]
        });
        const s = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(5, 4) }] });
        const out = commit(world, s, { type: 'knockout', crew: 'jun', npc: 'teller' }).state;
        out.crew[0]!.pos = P(6, 5);
        out.cameras.cam!.live = false;
        const dragged = commit(world, { ...out, crew: [{ ...out.crew[0]!, pos: P(5, 4) }] }, { type: 'drag', crew: 'jun', npc: 'teller' }).state;
        expect(evidenceOnMap(world, dragged).map(e => [e.id, e.kind])).toEqual([['camera:cam', 'cameraDown'], ['missing:teller', 'emptyWindow']]);
        expect(evidenceOnMap(world, out).map(e => e.id)).toEqual(['body:teller', 'camera:cam']);
    });
});

describe('interact', () => {
    registerInteraction('testPanel', {
        disable: {
            cost: () => 2,
            illegal: 'hack',
            whyNot: (_w, state, _m, o) => (state.objects[o.id]?.disabled ? 'Already off' : undefined),
            run(ctx, _member, object) {
                ctx.state.objects[object.id] = { ...ctx.state.objects[object.id], disabled: true };
            }
        }
    });
    const panel: WorldObject = { id: 'panel', kind: 'testPanel', pos: P(3, 0), facing: 's' };
    const scene = () => setup([person('teller', 'teller', 'staff', P(6, 1), 'w')], [{ id: 'jun', pos: P(3, 1) }], { objects: [panel] });

    it('dispatches to the handler of the object\'s kind, with its cost and its illegal act', () => {
        const { world, state } = scene();
        expect(legalActions(world, state, 'jun')).toContainEqual({ type: 'interact', crew: 'jun', object: 'panel', verb: 'disable' });
        const done = act(world, state, { type: 'interact', crew: 'jun', object: 'panel', verb: 'disable' });
        expect(done.state.objects.panel!.disabled).toBe(true);
        expect(done.state.crew[0]!.actionsLeft).toBe(0);
        expect(npc(done.state, 'teller').exposedTo).toEqual(['jun']);
        expect(() => commit(world, state, { type: 'interact', crew: 'jun', object: 'panel', verb: 'kick' })).toThrow(/Can't kick/);
        const far = { ...state, crew: [{ ...state.crew[0]!, pos: P(3, 3) }] };
        expect(() => commit(world, far, { type: 'interact', crew: 'jun', object: 'panel', verb: 'disable' })).toThrow(/can't reach/);
    });
});

describe('the crew phase', () => {
    it('interleaves crew members, 2 actions each, given back by the world phase', () => {
        const { world, state } = setup([], [{ id: 'jun', pos: P(0, 0) }, { id: 'mara', pos: P(0, 2) }]);
        let s = commit(world, state, { type: 'move', crew: 'jun', path: [P(1, 0)] }).state;
        s = commit(world, s, { type: 'move', crew: 'mara', path: [P(1, 2)] }).state;
        s = commit(world, s, { type: 'move', crew: 'jun', path: [P(2, 0)] }).state;
        expect(s.crew.map(c => c.actionsLeft)).toEqual([0, 1]);
        expect(() => commit(world, s, { type: 'move', crew: 'jun', path: [P(3, 0)] })).toThrow(/0 of 1 actions/);
        s = endTurn(world, s).state;
        expect(s.crew.map(c => c.actionsLeft)).toEqual([2, 2]);
    });

    it('waiting in view is ending an action in view; out of view it can be taken back', () => {
        const { world, state } = setup([person('teller', 'teller', 'staff', P(4, 0), 's')], [{ id: 'jun', pos: P(4, 2), items: ['assaultRifle'] }, { id: 'mara', pos: P(11, 7) }]);
        const known = scouted(world, state);
        const seen = act(world, known, { type: 'wait', crew: 'jun' });
        expect(seen.events).toContainEqual({ type: 'perceptionCheck', npc: 'teller', crew: 'jun' });
        expect(seen.undoable).toBe(false);
        const quiet = act(world, known, { type: 'wait', crew: 'mara' });
        expect(quiet.undoable).toBe(true);
        expect(quiet.state.crew[1]!.actionsLeft).toBe(0);
    });

    it('is deterministic: the same commands give the same states', () => {
        const run = (): string[] => {
            const { world, state } = setup(
                [person('guard', 'guard', 'enforcer', P(5, 3), 'n'), person('teller', 'teller', 'staff', P(9, 3), 'w')],
                [{ id: 'jun', pos: P(5, 4) }]
            );
            const script: Command[] = [
                { type: 'knockout', crew: 'jun', npc: 'guard' }, { type: 'drag', crew: 'jun', npc: 'guard' }, { type: 'endTurn' },
                { type: 'move', crew: 'jun', path: [P(4, 5), P(3, 5)] }, { type: 'drop', crew: 'jun' }, { type: 'endTurn' },
                { type: 'endTurn' }, { type: 'endTurn' }, { type: 'endTurn' }
            ];
            const hashes: string[] = [];
            let s = state;
            for (const cmd of script) {
                s = act(world, s, cmd).state;
                hashes.push(hashOf(s));
            }
            return hashes;
        };
        expect(run()).toEqual(run());
    });
});
