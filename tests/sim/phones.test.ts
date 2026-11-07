import { describe, expect, it } from 'vitest';
import {
    actionPreview, carrierVerdict, clonePlain, commit, fixtureWorld, hashOf, initialState, legalActions, preview, projectPreviewEvents, raiseCarrier, whyNot, type Command,
    type CrewStart, type PersonDef, type Pos, type ReadonlyWorld, type SimEvent, type State, type WorldObject
} from '../../src/sim';
import { actionMenu } from '../../src/game/actions';
import { describeEvent } from '../../src/game/views';
import { registerTestCommand, scouted, step, testCommand } from './helpers';

/*
 * M5-04, the generator's content as the rules play it (GAME_DESIGN §8.13, §8.14, §9.1, §15.2, §17.4, §19.5; decisions
 * 360–366): desk phones and their owners, the phone line, the uniform rail, the keycard in the drawer, the intel box,
 * side objectives and the vault sensors' wiring box.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const of = <K extends SimEvent['type']>(events: readonly SimEvent[], type: K) => events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
const npc = (state: State, id: string) => state.npcs.find(n => n.id === id)!;
const endTurn = { type: 'endTurn' } as const;
const staff = (id: string, role: string, pos: Pos, at?: Pos): PersonDef => ({
    id, name: id, role, observer: 'staff', pos, facing: 's',
    schedule: at ? [{ from: 1, activity: 'post', label: 'at post', room: 's', at, facing: 's' }] : []
});

/**
 * Commits and checks that the preview said exactly the same, and that what the player is shown of it (projected on
 * what the crew knows) says the same about undo as the commit.
 */
function act(world: ReadonlyWorld, state: State, cmd: Command) {
    const seen = preview(world, state, cmd), done = step(world, state, cmd), shown = actionPreview(world, state, cmd);
    expect(seen.events).toEqual(done.events);
    expect(hashOf(seen.state)).toBe(hashOf(done.state));
    if (!shown.ok) throw new Error(shown.reason);
    expect(shown.undoable).toBe(done.undoable);
    return done;
}

/*
 * An office floor (staff zone, room 's'): two desks with phones, the clerk's at (10, 1) (her post (10, 2)) and the
 * manager's at (2, 1); the clerk is away at (10, 6), the manager at his post. The phone line in the closet (room 'x').
 */
const FLOOR = Array.from({ length: 8 }, () => '............');
const ZONES = Array.from({ length: 8 }, (_, y) => (y < 7 ? 'ssssssssssss' : 'xxxxxxxxxxxx'));
const ROOMS = ZONES.map(r => r.replace(/x/g, 'c'));
const PHONES: WorldObject[] = [
    { id: 'phone-0', kind: 'deskPhone', pos: P(2, 1), facing: 's', room: 's', owner: 'manager', answerAt: P(2, 2) },
    { id: 'phone-1', kind: 'deskPhone', pos: P(10, 1), facing: 's', room: 's', owner: 'clerk', answerAt: P(10, 2) },
    { id: 'line', kind: 'phoneLine', pos: P(5, 7), facing: 's', room: 'c' }
];

function office(crew: CrewStart[], objects: WorldObject[] = PHONES, rules = {}): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(FLOOR, {
        zones: ZONES, rooms: ROOMS, objects, rules,
        people: [staff('manager', 'manager', P(2, 2), P(2, 2)), staff('clerk', 'clerk', P(10, 6), P(10, 2))]
    });
    return { world, state: clonePlain(initialState(world, { seed: 5, crew })) };
}

const ring = (phone: string, crew = 'jun'): Command => ({ type: 'ringPhone', crew, phone });

describe('desk phones (§8.13)', () => {
    it('rung from another desk phone, sends its owner walking to answer it, telegraphed now; back to work once there', () => {
        const { world, state } = office([{ id: 'jun', pos: P(3, 2) }]);
        const done = act(world, state, ring('phone-1'));
        expect(of(done.events, 'phoneRang')).toEqual([{ type: 'phoneRang', crew: 'jun', phone: 'phone-1', remote: false }]);
        const clerk = npc(done.state, 'clerk');
        expect([clerk.goal.kind, clerk.evidence?.tile, clerk.alerted]).toEqual(['inspect', P(10, 2), false]);
        expect(clerk.intent.path.length).toBeGreaterThan(0);
        expect(done.state.crew[0]!.actionsLeft).toBe(1);
        expect(describeEvent(world, done.state, of(done.events, 'phoneRang')[0]!)).toBe('jun rang a desk phone');
        let s = done.state;
        for (let i = 0; i < 3 && npc(s, 'clerk').evidence; i++) s = step(world, s, endTurn).state;
        expect(Math.max(Math.abs(npc(s, 'clerk').pos.x - 10), Math.abs(npc(s, 'clerk').pos.y - 2))).toBeLessThanOrEqual(1);
        expect(npc(s, 'clerk').evidence).toBeNull();
    });

    it('needs another phone in reach or a hacking kit, and rings remotely as a hack', () => {
        const { world, state } = office([{ id: 'jun', pos: P(6, 4) }, { id: 'mara', pos: P(6, 5), items: ['hackingKit'] }, { id: 'kim', pos: P(10, 2) }]);
        expect(whyNot(world, state, ring('phone-1'))).toBe('jun needs another desk phone in reach, or a hacking kit');
        // Kim stands at the clerk's own phone: there is no other in reach to ring it from.
        expect(whyNot(world, state, ring('phone-1', 'kim'))).toBe('kim needs another desk phone in reach, or a hacking kit');
        expect(whyNot(world, state, ring('phone-0', 'kim'))).toBeUndefined();
        const done = act(world, state, ring('phone-1', 'mara'));
        expect(of(done.events, 'phoneRang')[0]!.remote).toBe(true);
        expect(legalActions(world, state, 'mara').filter(c => c.type === 'ringPhone').length).toBe(2);
        expect(whyNot(world, state, { type: 'ringPhone', crew: 'mara', phone: 'line' })).toBe('There is no desk phone there');
    });

    it('is final whether or not a hidden owner comes, and the projected preview says so', () => {
        // A wall between Jun and the clerk's end of the floor.
        const world = fixtureWorld(FLOOR, {
            zones: ZONES, rooms: ROOMS, objects: PHONES, walls: Array.from({ length: 7 }, (_, y) => ({ between: [P(7, y), P(8, y)] as [Pos, Pos] })),
            people: [staff('manager', 'manager', P(2, 2), P(2, 2)), staff('clerk', 'clerk', P(10, 6), P(10, 2))]
        });
        const state = clonePlain(initialState(world, { seed: 5, crew: [{ id: 'jun', pos: P(3, 2), items: ['hackingKit'] }] }));
        // The clerk is unseen: present (she comes) or away (nobody comes), the ring reads the same and is final.
        const present = act(world, state, ring('phone-1'));
        expect(npc(present.state, 'clerk').goal.kind).toBe('inspect');
        const gone = clonePlain(state);
        npc(gone, 'clerk').status = 'away';
        const absent = act(world, gone, ring('phone-1'));
        expect([present.undoable, absent.undoable]).toEqual([false, false]);
        const tell = (r: ReturnType<typeof actionPreview>) => (r.ok ? { undoable: r.undoable, events: r.events.map(e => e.type) } : r);
        expect(tell(actionPreview(world, state, ring('phone-1')))).toEqual(tell(actionPreview(world, gone, ring('phone-1'))));
    });

    it('doesn\'t take an owner off what they are dealing with, and rings again only after its pause', () => {
        const { world, state } = office([{ id: 'jun', pos: P(3, 2) }]);
        const busy = clonePlain(state);
        npc(busy, 'clerk').evidence = { id: 'noise:x', kind: 'quietNoise', major: false, tile: P(6, 6), decided: { turn: 1, phase: 'crew' } };
        const done = act(world, busy, ring('phone-1'));
        expect(npc(done.state, 'clerk').evidence?.id).toBe('noise:x');
        // Rung once, the same phone waits `phoneRingPhases` turns; another phone doesn't.
        expect(whyNot(world, done.state, ring('phone-1'))).toBe(`It was rung lately: again from turn ${1 + world.rules.phoneRingPhases}`);
        let s = done.state;
        for (let i = 0; i < world.rules.phoneRingPhases; i++) s = commit(world, s, endTurn).state;
        const later = clonePlain(s);
        later.crew[0]!.pos = P(3, 2);
        expect(whyNot(world, later, ring('phone-1'))).toBeUndefined();
    });

    it('rings a phone nobody works at like any other, final and paused, and rings from it too', () => {
        const spare: WorldObject = { id: 'phone-2', kind: 'deskPhone', pos: P(6, 1), facing: 's', room: 's' };
        const { world, state } = office([{ id: 'jun', pos: P(6, 2) }], [...PHONES, spare]);
        const s = scouted(world, state);
        // The grid offers it and the other phones from it, as at an owned desk.
        expect(actionMenu(world, s, 'jun', 'phone-1').find(e => e.id === 'ring')?.reason).toBeUndefined();
        const from = act(world, state, ring('phone-1'));
        expect(npc(from.state, 'clerk').goal.kind).toBe('inspect');
        const { world: w2, state: s2 } = office([{ id: 'jun', pos: P(3, 2) }], [...PHONES, spare]);
        const done = act(w2, s2, ring('phone-2'));
        expect(done.undoable).toBe(false);
        expect(done.state.npcs.map(n => n.evidence)).toEqual(s2.npcs.map(n => n.evidence));
        expect(whyNot(w2, done.state, ring('phone-2'))).toMatch(/rung lately/);
        expect(actionMenu(w2, scouted(w2, s2), 'jun', 'phone-2').some(e => e.id === 'ring' && e.target === 'phone-2')).toBe(true);
    });

    it('brings nobody whose owner is down, and the grid offers it for the phone tapped', () => {
        const { world, state } = office([{ id: 'jun', pos: P(3, 2), items: ['hackingKit'] }]);
        const down = clonePlain(state);
        npc(down, 'clerk').status = 'unconscious';
        const done = act(world, down, ring('phone-1'));
        expect(npc(done.state, 'clerk').evidence).toBeNull();
        const menu = actionMenu(world, scouted(world, state), 'jun', 'phone-1');
        expect(menu.find(e => e.id === 'ring')).toMatchObject({ label: 'Ring phone', target: 'phone-1', command: ring('phone-1') });
    });
});

describe('the phone line (§9.1)', () => {
    registerTestCommand('test.landline', ctx => {
        raiseCarrier(ctx, { kind: 'phoneCall', source: 'clerk', pos: P(10, 6), line: 'landline' });
    });
    registerTestCommand('test.mobile', ctx => {
        raiseCarrier(ctx, { kind: 'phoneCall', source: 'manager', pos: P(2, 2) });
    });

    it('cut, kills a landline call under way and the next one, not a mobile; dispatch notices after its phases', () => {
        const { world, state } = office([{ id: 'jun', pos: P(5, 6) }], PHONES, { phoneLineNoticed: 3 });
        const calling = step(world, state, testCommand({ type: 'test.landline' })).state;
        expect(calling.carriers.map(c => [c.kind, c.line])).toEqual([['phoneCall', 'landline']]);
        const cut = act(world, calling, { type: 'interact', crew: 'jun', object: 'line', verb: 'cut' });
        expect(of(cut.events, 'phoneLineCut')).toEqual([{ type: 'phoneLineCut', crew: 'jun', object: 'line' }]);
        expect(cut.events).toContainEqual(expect.objectContaining({ type: 'carrierStopped', kind: 'phoneCall', why: 'phone line cut' }));
        expect(cut.state.carriers).toEqual([]);
        expect(whyNot(world, cut.state, { type: 'interact', crew: 'jun', object: 'line', verb: 'cut' })).toBe('The line is cut already');
        const again = step(world, cut.state, testCommand({ type: 'test.landline' }));
        expect(of(again.events, 'lineDead')).toEqual([{ type: 'lineDead', source: 'clerk' }]);
        const mobile = step(world, again.state, testCommand({ type: 'test.mobile' })).state;
        expect(mobile.carriers.map(c => c.kind)).toEqual(['phoneCall']);
        expect(carrierVerdict(world, mobile, mobile.carriers[0]!)).toBeNull();
        // Desk phones are dead too.
        expect(whyNot(world, cut.state, ring('phone-0'))).toBe('The phone line is dead');
        // Cut on turn 1: the third world phase from it is dispatch's (nobody about to raise the Alarm meanwhile).
        let s = clonePlain(cut.state), noticed: SimEvent[] = [];
        for (const n of s.npcs) n.status = 'away';
        for (let i = 0; i < 4 && !noticed.length; i++) {
            const r = commit(world, s, endTurn);
            s = r.state;
            noticed = of(r.events, 'deadLineNoticed');
            if (noticed.length) expect(r.state.turn - 1).toBe(3);
        }
        expect(noticed).toEqual([{ type: 'deadLineNoticed', driveBy: 3 + world.rules.driveByLead }]);
        expect(s.radio.driveBy).toBe(3 + world.rules.driveByLead);
    });
});

describe('the uniform rail (§8.14)', () => {
    it('gives a staff uniform in the Staff zone, out of sight', () => {
        const rack: WorldObject = { id: 'rack', kind: 'uniformRack', pos: P(6, 0), facing: 's', room: 's' };
        const { world, state } = office([{ id: 'jun', pos: P(6, 1) }], [rack]);
        const s = clonePlain(state);
        for (const n of s.npcs) n.status = 'away';
        const done = act(world, s, { type: 'changeClothes', crew: 'jun', from: 'rack' });
        expect(done.state.crew[0]!.loadout.uniform).toBe('staff');
    });
});

describe('the keycard in the drawer (§17.6)', () => {
    const card: WorldObject = { id: 'card', kind: 'keycard', pos: P(2, 1), facing: 's', room: 's', holder: 'manager', from: 3, until: 6 };
    const take: Command = { type: 'interact', crew: 'jun', object: 'card', verb: 'take' };

    it('lies there only from lunch until the manager is back, and is the manager\'s card once taken', () => {
        const { world, state } = office([{ id: 'jun', pos: P(3, 2) }], [card]);
        expect(whyNot(world, state, take)).toBe('There is no keycard here');
        expect(actionMenu(world, scouted(world, state), 'jun').some(e => e.id === 'takeKeycard')).toBe(false);
        const lunch = clonePlain(state);
        lunch.turn = 3;
        // Knocked out before he could leave, he never put it in the drawer.
        npc(lunch, 'manager').status = 'unconscious';
        expect(whyNot(world, lunch, take)).toBe('There is no keycard here');
        npc(lunch, 'manager').status = 'away';
        expect(actionMenu(world, scouted(world, lunch), 'jun').find(e => e.id === 'takeKeycard')?.command).toEqual(take);
        const done = act(world, lunch, take);
        expect(done.undoable).toBe(false);
        expect(done.state.crew[0]!.keycards).toEqual(['manager']);
        expect(npc(done.state, 'manager').keycard).toBe(false);
        expect(whyNot(world, done.state, take)).toBe('The keycard is gone');
        const back = clonePlain(lunch);
        back.turn = 6;
        expect(whyNot(world, back, take)).toBe('There is no keycard here');
        // Frisked off him before lunch, it never reaches the drawer.
        npc(lunch, 'manager').keycard = false;
        expect(whyNot(world, lunch, take)).toBe('There is no keycard here');
    });
});

/** A deposit room (secure, room 'd'): a wall of boxes, its haul, three boxes (the second holds the intel), and one more box with a side objective. */
function depositRoom(extra: WorldObject[] = []): { world: ReadonlyWorld; state: State } {
    const objects: WorldObject[] = [
        { id: 'wall', kind: 'depositBoxes', pos: P(1, 0), facing: 's', room: 'd' },
        { id: 'haul', kind: 'loot', pos: P(1, 1), facing: 's', room: 'd', loot: { value: 15000, weight: 'heavy', behind: 'depositWall' } },
        { id: 'box-0', kind: 'loot', pos: P(1, 1), facing: 's', room: 'd', loot: { value: 5000, weight: 'light', behind: 'depositBox' } },
        { id: 'box-1', kind: 'loot', pos: P(1, 1), facing: 's', room: 'd', loot: { value: 5000, weight: 'light', behind: 'depositBox', intel: true } },
        { id: 'box-2', kind: 'loot', pos: P(1, 1), facing: 's', room: 'd', loot: { value: 0, weight: 'light', behind: 'depositBox', objective: 'blueprints' } },
        ...extra
    ];
    const world = fixtureWorld(['......', '......', '......'], { zones: ['xxxxxx', 'xxxxxx', 'xxxxxx'], rooms: ['dddddd', 'dddddd', 'dddddd'], objects });
    return { world, state: clonePlain(initialState(world, { seed: 9, crew: [{ id: 'jun', pos: P(1, 1), items: ['lockpick', 'drill'], traits: ['steadyHands'] }] })) };
}

describe('the intel box and side objectives (§17.4, §19.5)', () => {
    const pick: Command = { type: 'interact', crew: 'jun', object: 'wall', verb: 'pick' };

    it('finds the intel in its box, which no preview tells; opening any box is final', () => {
        const { world, state } = depositRoom();
        const one = act(world, state, pick);
        expect(of(one.events, 'intelFound')).toEqual([]);
        expect(one.undoable).toBe(false);
        const shown = preview(world, one.state, pick), two = commit(world, one.state, pick);
        expect(of(two.events, 'intelFound')).toEqual([{ type: 'intelFound', crew: 'jun', object: 'box-1' }]);
        expect(two.state.intelFound).toEqual(['box-1']);
        expect(projectPreviewEvents(world, one.state, shown).some(e => e.type === 'intelFound')).toBe(false);
        expect(describeEvent(world, two.state, of(two.events, 'intelFound')[0]!)).toBe('jun found intel in a deposit box');
    });

    it('opens a side objective\'s box like any other: Light, worth nothing, and taken into the pocket', () => {
        const { world, state } = depositRoom();
        let s = state;
        for (let i = 0; i < 3; i++) {
            s = commit(world, s, pick).state;
            if (s.crew[0]!.actionsLeft < 1) s = commit(world, s, endTurn).state;
        }
        expect(Object.hasOwn(s.loot, 'box-2')).toBe(true);
        const taken = act(world, s, { type: 'takeLoot', crew: 'jun', loot: 'box-2' });
        expect(taken.state.loot['box-2']!.holder).toBe('jun');
    });

    it('comes open with a drilled wall, the intel with it', () => {
        const { world, state } = depositRoom();
        let s = commit(world, state, { type: 'drill', crew: 'jun', at: 'wall' }).state;
        const events: SimEvent[] = [];
        for (let i = 0; i < 6 && !Object.hasOwn(s.loot, 'haul'); i++) {
            const r = commit(world, s, endTurn);
            events.push(...r.events);
            s = r.state;
        }
        expect(Object.keys(s.loot).sort()).toEqual(['box-2', 'haul']);
        expect(of(events, 'intelFound')).toEqual([{ type: 'intelFound', crew: null, object: 'box-1' }]);
    });

    it('a side objective the Alarm moves is out of reach once it fires, unless taken', () => {
        const files: WorldObject = { id: 'files', kind: 'loot', pos: P(3, 1), facing: 's', room: 'd', loot: { value: 0, weight: 'light', objective: 'blackmail', lostOnAlarm: true } };
        const { world, state } = depositRoom([files]);
        expect(Object.hasOwn(state.loot, 'files')).toBe(true);
        const near = clonePlain(state);
        near.crew[0]!.pos = P(3, 2);
        const take: Command = { type: 'takeLoot', crew: 'jun', loot: 'files' };
        expect(whyNot(world, near, take)).toBeUndefined();
        near.bank.alarm = true;
        expect(whyNot(world, near, take)).toBe('It was moved when the Alarm went off');
    });
});

describe('the vault sensors\' wiring box (§9.1)', () => {
    const lock = {
        id: 'vault', name: 'Vault', target: 'vaultDoor', room: 'v', holders: [],
        social: { kind: 'code' as const, parts: ['whole' as const], text: '' },
        technical: { kind: 'drill' as const, phases: 3, noise: 6, sensors: ['seismic' as const], text: '' },
        violent: { kind: 'thermite' as const, phases: 2, noise: 6, text: '' }
    };
    const objects: WorldObject[] = [
        { id: 'console', kind: 'vaultConsole', pos: P(1, 0), facing: 's', room: 'a' },
        { id: 'wiring', kind: 'wiringBox', pos: P(3, 0), facing: 's', room: 'a' }
    ];

    it('cuts the sensors there; the console sends the crew to it', () => {
        const world = fixtureWorld(['......', '......'], {
            zones: ['xxxxxx', 'xxxxxx'], rooms: ['aaaavv', 'aaaavv'], objects, locks: [lock],
            walls: [{ between: [P(3, 1), P(4, 1)], material: 'vault', door: { id: 'vaultDoor', lock: 'vault', start: 'locked' } }, { between: [P(3, 0), P(4, 0)], material: 'vault' }]
        });
        const state = initialState(world, { seed: 2, crew: [{ id: 'jun', pos: P(2, 1), items: ['hackingKit'], traits: ['steadyHands'] }] });
        expect(whyNot(world, state, { type: 'interact', crew: 'jun', object: 'console', verb: 'sensors' })).toBe('The sensors are wired at the wiring box');
        let s = state;
        for (let i = 0; i < 2; i++) s = act(world, s, { type: 'interact', crew: 'jun', object: 'wiring', verb: 'sensors' }).state;
        expect(s.objects.wiring?.sensorsCut).toBe(true);
        expect(whyNot(world, s, { type: 'interact', crew: 'jun', object: 'wiring', verb: 'sensors' })).toMatch(/cut already|actions/);
    });
});
