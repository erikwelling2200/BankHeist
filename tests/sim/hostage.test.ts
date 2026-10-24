import { describe, expect, it } from 'vitest';
import {
    actionPreview, commit, crewBudget, crewThreat, deserialiseState, npcCanPass, pendingCarriers, personOf, safeFloor, serialiseState, crewLook, dashRefusal, fixtureWorld, initialState, legalActions, preview, reaction, whyNot, type CrewLook, type CrewStart, type FixtureWall,
    type ObserverClass, type PersonDef, type Pos, type ReactionInput, type ReadonlyWorld, type State, type WorldObject, type Zone
} from '../../src/sim';
import { scouted, step } from './helpers';

/*
 * Hostages and disguises (M2-03; §10.6, §10.7, §8.14): zip-ties and the frisk that comes with them (hidden weapons and
 * keycards), the keycard opening a keycard door, escorting, coercing a teller and a key-holder, freeing a tied NPC, the
 * lapses of the armed and the disarmed, changing clothes, and the matrix cells under a uniform.
 */

const P = (x: number, y: number): Pos => ({ x, y });

const person = (id: string, role: string, observer: ObserverClass, pos: Pos, extra: Partial<PersonDef> = {}): PersonDef =>
    ({ id, name: id, role, observer, pos, facing: 'n', schedule: [], ...extra });

// Public floor west, staff floor east of a keycard door at x 6 / 7 (row 2), walled elsewhere.
const MAP = ['..............', '..............', '..............', '..............', '..............'];
const ZONES = ['......ssssssss', '......ssssssss', '......ssssssss', '......ssssssss', '......ssssssss'];
const WALLS: FixtureWall[] = Array.from({ length: 5 }, (_, y) => (y === 2
    ? { between: [P(6, y), P(7, y)] as [Pos, Pos], door: { id: 'staffDoor', lock: 'keycard' as const, start: 'locked' as const } }
    : { between: [P(6, y), P(7, y)] as [Pos, Pos] }));

function setup(people: PersonDef[], crew: CrewStart[], options: { objects?: WorldObject[]; walls?: FixtureWall[] } = {}): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(MAP, { zones: ZONES, walls: options.walls ?? WALLS, people, objects: options.objects ?? [] });
    return { world, state: initialState(world, { seed: 5, crew }) };
}

const npc = (state: State, id: string) => state.npcs.find(n => n.id === id)!;
const member = (state: State, id: string) => state.crew.find(c => c.id === id)!;
const run = (world: ReadonlyWorld, state: State, ...cmds: Parameters<typeof commit>[2][]): State => cmds.reduce((s, c) => step(world, s, c).state, state);
const fresh = (state: State): State => ({ ...state, crew: state.crew.map(c => ({ ...c, actionsLeft: 2 })) });

describe('zip-ties (§10.6)', () => {
    it('ties only someone face down, surprised or out cold, in reach, with a tie left', () => {
        const { world, state } = setup([person('cust', 'customer', 'civilian', P(2, 1))], [{ id: 'mara', pos: P(2, 2) }]);
        expect(whyNot(world, state, { type: 'zipTie', crew: 'mara', npc: 'cust' })).toBe('Only someone face down, surprised or out cold can be tied');
        const down = run(world, state, { type: 'command', crew: 'mara' });
        expect(npc(down, 'cust').status).toBe('commanded');
        const tied = step(world, down, { type: 'zipTie', crew: 'mara', npc: 'cust' });
        expect(npc(tied.state, 'cust')).toMatchObject({ status: 'tied', command: null });
        expect(member(tied.state, 'mara').zipTies).toBe(3);
        expect(tied.events.map(e => e.type)).toContain('zipTied');
        expect(whyNot(world, fresh(tied.state), { type: 'zipTie', crew: 'mara', npc: 'cust' })).toBe('They are tied up already');
        const none = { ...fresh(down), crew: fresh(down).crew.map(c => ({ ...c, zipTies: 0 })) };
        expect(whyNot(world, none, { type: 'zipTie', crew: 'mara', npc: 'cust' })).toBe('mara has no zip-ties left');
    });

    it('ties a knocked-out guard as he lies: he never wakes to act', () => {
        const { world, state } = setup([person('guard', 'guard', 'enforcer', P(2, 1))], [{ id: 'mara', pos: P(2, 2) }]);
        let s = run(world, state, { type: 'knockout', crew: 'mara', npc: 'guard' }, { type: 'zipTie', crew: 'mara', npc: 'guard' });
        expect(npc(s, 'guard')).toMatchObject({ status: 'tied', outCold: null });
        for (let i = 0; i < 6; i++) s = step(world, s, { type: 'endTurn' }).state;
        expect(npc(s, 'guard').status).toBe('tied');
    });

    it('frisks: a hidden weapon is found (never in a preview) and a keycard taken, which opens keycard doors', () => {
        const { world, state } = setup([
            person('cop', 'customer', 'civilian', P(2, 1), { armed: 'hidden' }),
            person('teller', 'teller', 'staff', P(5, 1))
        ], [{ id: 'mara', pos: P(3, 2), items: ['pistol'] }, { id: 'jun', pos: P(6, 2) }]);
        const down = run(world, state, { type: 'command', crew: 'mara' });
        expect(npc(down, 'cop').armed).toBe('hidden');
        expect(npc(down, 'teller')).toMatchObject({ status: 'commanded', keycard: true });
        const shown = actionPreview(world, down, { type: 'zipTie', crew: 'mara', npc: 'cop' });
        const tie = step(world, down, { type: 'zipTie', crew: 'mara', npc: 'cop' });
        expect(tie.events.map(e => e.type)).toContain('hiddenWeaponFound');
        expect(shown.ok && shown.events.map(e => e.type)).toEqual(expect.not.arrayContaining(['hiddenWeaponFound']));
        expect(shown.ok).toBe(true);
        expect(npc(tie.state, 'cop').armed).toBeNull();
        // Jun ties the teller and takes her keycard: the staff door opens to him now.
        expect(whyNot(world, tie.state, { type: 'door', crew: 'jun', door: 'staffDoor', action: 'open' })).toBe('The door is locked');
        const card = step(world, tie.state, { type: 'zipTie', crew: 'jun', npc: 'teller' });
        expect(card.events.map(e => e.type)).toContain('keycardTaken');
        expect(npc(card.state, 'teller').keycard).toBe(false);
        expect(member(card.state, 'jun').keycards).toEqual(['teller']);
        const next = fresh(run(world, card.state, { type: 'endTurn' }));
        expect(whyNot(world, next, { type: 'door', crew: 'jun', door: 'staffDoor', action: 'open' })).toBeUndefined();
        expect(whyNot(world, next, { type: 'door', crew: 'mara', door: 'staffDoor', action: 'open' })).toBe("mara isn't beside the door");
        expect(member(commit(world, next, { type: 'move', crew: 'jun', path: [P(7, 2)] }).state, 'jun').pos).toEqual(P(7, 2));
    });

    it('is an illegal act: a witness Exposes the crew member', () => {
        const { world, state } = setup([person('cust', 'customer', 'civilian', P(2, 1)), person('teller', 'teller', 'staff', P(2, 4), { facing: 'n' })], [{ id: 'mara', pos: P(2, 2) }]);
        const down = { ...state, npcs: state.npcs.map(n => (n.id === 'cust' ? { ...n, status: 'commanded' as const, command: { pips: 2, by: 'mara' } } : n)) };
        const r = commit(world, down, { type: 'zipTie', crew: 'mara', npc: 'cust' });
        expect(npc(r.state, 'teller').exposedTo).toEqual(['mara']);
    });
});

describe('freeing a tied NPC (§10.6)', () => {
    it('takes a free NPC who knows of it two world phases in reach, the first shown for a crew phase', () => {
        const { world, state } = setup([person('cust', 'customer', 'civilian', P(2, 1)), person('helper', 'customer', 'civilian', P(3, 1))], [{ id: 'mara', pos: P(2, 2) }]);
        const tied = { ...state, npcs: state.npcs.map(n => (n.id === 'cust' ? { ...n, status: 'tied' as const } : n.id === 'helper' ? { ...n, noticed: ['tied:cust'] } : n)) };
        const one = step(world, tied, { type: 'endTurn' });
        expect(one.events).toContainEqual({ type: 'untying', npc: 'cust', by: 'helper', phases: 1 });
        expect(npc(one.state, 'cust').status).toBe('tied');
        const two = step(world, one.state, { type: 'endTurn' });
        expect(two.events).toContainEqual({ type: 'freed', npc: 'cust', by: 'helper' });
        expect(npc(two.state, 'cust')).toMatchObject({ status: 'alerted', alerted: true, untying: null });
    });
});

describe('escort (§10.6)', () => {
    it('leads a Commanded or tied hostage at half movement, as the illegal act command; Drop lets go', () => {
        const { world, state } = setup([person('cust', 'customer', 'civilian', P(2, 1))], [{ id: 'mara', pos: P(2, 2) }]);
        const down = fresh(run(world, state, { type: 'command', crew: 'mara' }));
        const led = run(world, down, { type: 'escort', crew: 'mara', npc: 'cust' });
        const mara = member(led, 'mara');
        expect(mara).toMatchObject({ dragging: 'cust', loadout: { carrying: 'hostage' } });
        expect(crewBudget(world, mara, 'move')).toBe(Math.floor(crewBudget(world, member(state, 'mara'), 'move') / 2));
        // Half movement and nothing else: a Dash at half, a Bruiser halved too, the Threat as before.
        expect(dashRefusal(world, fresh(led), 'mara')).toBeNull();
        expect(crewBudget(world, mara, 'dash')).toBe(Math.floor(crewBudget(world, member(state, 'mara'), 'dash') / 2));
        const bruiser = { ...mara, traits: ['bruiser'] };
        expect(crewBudget(world, bruiser, 'move')).toBe(Math.floor(crewBudget(world, { ...member(state, 'mara'), traits: ['bruiser'] }, 'move') / 2));
        expect(crewThreat({ ...mara, loadout: { ...mara.loadout, items: ['shotgun'] } })).toBe(5);
        expect(crewLook(mara).act).toBe('command');
        const moved = run(world, led, { type: 'move', crew: 'mara', path: [P(3, 2)] });
        const dropped = run(world, fresh(run(world, moved, { type: 'endTurn' })), { type: 'drop', crew: 'mara' });
        expect(npc(dropped, 'cust').pos).toEqual(P(3, 2));
        expect(member(dropped, 'mara').loadout.carrying).toBeNull();
    });

    it('a hostage still only face down can\'t be stashed', () => {
        const { world, state } = setup([person('cust', 'customer', 'civilian', P(2, 1))], [{ id: 'mara', pos: P(2, 2) }],
            { objects: [{ id: 'bin', kind: 'dumpster', pos: P(3, 2), facing: 's' }] });
        const led = run(world, fresh(run(world, state, { type: 'command', crew: 'mara' })), { type: 'escort', crew: 'mara', npc: 'cust' });
        expect(whyNot(world, fresh(led), { type: 'stash', crew: 'mara', at: 'bin' })).toBe('Only someone tied or out cold can be stashed');
    });
});

describe('coercion (§10.7)', () => {
    const drawer: WorldObject = { id: 'drawer', kind: 'loot', pos: P(3, 0), facing: 's', name: 'Cash drawer', loot: { value: 5000, weight: 'light' } };
    const vault: WorldObject = { id: 'console', kind: 'vaultConsole', pos: P(9, 0), facing: 's' };

    it('makes a face-down teller open their drawer across the window: the cash is pocketed', () => {
        const glass: FixtureWall[] = [...WALLS, ...Array.from({ length: 6 }, (_, x) => ({ between: [P(x, 1), P(x, 2)] as [Pos, Pos], material: 'tellerGlass' as const }))];
        const other: WorldObject = { ...drawer, id: 'drawer2', pos: P(4, 0) };
        const window = (at: Pos) => ({ schedule: [{ from: 1, activity: 'window' as const, label: 'window', room: '', at, facing: 's' as const }] });
        const { world, state } = setup([person('teller', 'teller', 'staff', P(3, 1), window(P(3, 1))), person('next', 'teller', 'staff', P(5, 0), window(P(5, 0)))],
            [{ id: 'mara', pos: P(3, 2) }], { objects: [drawer, other], walls: glass });
        const down = fresh(run(world, state, { type: 'command', crew: 'mara' }));
        expect(whyNot(world, down, { type: 'takeLoot', crew: 'mara', loot: 'drawer' })).toBe("mara can't reach it from here");
        expect(legalActions(world, down, 'mara')).toContainEqual({ type: 'coerce', crew: 'mara', npc: 'teller', at: 'drawer' });
        const r = step(world, down, { type: 'coerce', crew: 'mara', npc: 'teller', at: 'drawer' });
        expect(r.state.loot.drawer).toMatchObject({ holder: 'mara', taken: true });
        expect(preview(world, down, { type: 'coerce', crew: 'mara', npc: 'teller', at: 'drawer' }).events).toEqual(r.events);
        // Only their own drawer: the next window's is in their reach, but not theirs.
        expect(whyNot(world, down, { type: 'coerce', crew: 'mara', npc: 'teller', at: 'drawer2' })).toBe('It isn\'t their drawer');
    });

    it('has a key-holder enter their part of the vault code at the console, once; others know none', () => {
        const { world, state } = setup([person('manager', 'manager', 'staff', P(9, 1)), person('cleaner', 'cleaner', 'staff', P(10, 1))],
            [{ id: 'mara', pos: P(9, 2), items: ['pistol'] }], { objects: [vault] });
        const down = fresh(run(world, state, { type: 'command', crew: 'mara' }));
        expect(whyNot(world, down, { type: 'coerce', crew: 'mara', npc: 'cleaner', at: 'console' })).toBe('They don\'t know any part of the code');
        const r = run(world, down, { type: 'coerce', crew: 'mara', npc: 'manager', at: 'console' });
        expect(r.objects.console!.codes).toEqual(['manager']);
        expect(whyNot(world, fresh(r), { type: 'coerce', crew: 'mara', npc: 'manager', at: 'console' })).toBe('They have entered their part already');
    });
});

describe('lapses of the armed and the disarmed (§10.5, §10.9)', () => {
    it('an armed civilian always reaches for his weapon; nothing tells him apart until then', () => {
        const { world, state } = setup([person('cop', 'customer', 'civilian', P(2, 1), { armed: 'hidden' })], [{ id: 'mara', pos: P(2, 2) }]);
        let s: State = run(world, state, { type: 'command', crew: 'mara' });
        let lapsed;
        for (let i = 0; i < 3 && !lapsed; i++) {
            const r = step(world, s, { type: 'endTurn' });
            lapsed = r.events.find(e => e.type === 'lapsed');
            s = r.state;
        }
        expect(lapsed).toEqual({ type: 'lapsed', npc: 'cop', outcome: 'reachForWeapon' });
    });
});

describe('disguises (§8.14)', () => {
    it('take 2 actions: a downed guard\'s uniform (stripped once) or a staff uniform from the staff lockers', () => {
        const lockers: WorldObject = { id: 'lockers', kind: 'lockers', pos: P(9, 1), facing: 's' };
        const { world, state } = setup([person('guard', 'guard', 'enforcer', P(2, 1))], [{ id: 'mara', pos: P(2, 2) }, { id: 'jun', pos: P(9, 2) }], { objects: [lockers] });
        expect(whyNot(world, state, { type: 'changeClothes', crew: 'mara', from: 'guard' })).toBe('Only a guard knocked out or tied can be stripped');
        const out = fresh(run(world, state, { type: 'knockout', crew: 'mara', npc: 'guard' }));
        const strip = step(world, out, { type: 'changeClothes', crew: 'mara', from: 'guard' });
        expect(strip.events.map(e => e.type)).toEqual(expect.arrayContaining(['changedClothes', 'guardStripped']));
        expect(strip.undoable).toBe(false);
        const changed = strip.state;
        expect(member(changed, 'mara')).toMatchObject({ actionsLeft: 0, loadout: { uniform: 'guard' } });
        expect(npc(changed, 'guard').stripped).toBe(true);
        expect(whyNot(world, fresh(changed), { type: 'changeClothes', crew: 'jun', from: 'guard' })).toBe('Their uniform is gone already');
        expect(member(run(world, changed, { type: 'changeClothes', crew: 'jun', from: 'lockers' }), 'jun').loadout.uniform).toBe('staff');
    });

    it('holster a pistol as Clean under a guard\'s uniform, until something breaks it', () => {
        const { state } = setup([], [{ id: 'a', pos: P(1, 1), items: ['pistol'], uniform: 'guard' }, { id: 'b', pos: P(2, 1), items: ['pistol'], uniform: 'staff' },
            { id: 'c', pos: P(3, 1), items: ['pistol', 'assaultRifle'], uniform: 'guard' }]);
        expect(state.crew.map(c => [crewLook(c).profile, crewLook(c).uniform])).toEqual([['clean', 'guard'], ['concealed', 'staff'], ['armed', null]]);
    });

    describe('change the matrix cells', () => {
        const look = (uniform: CrewLook['uniform'], profile: CrewLook['profile'] = 'clean'): CrewLook => ({ profile, shows: 'nothing', uniform });
        const { world } = setup([], [{ id: 'a', pos: P(1, 1) }]);
        const read = (l: CrewLook, zone: Zone, observer: ObserverClass, extra: Partial<ReactionInput> = {}): string => reaction(world.rules, {
            look: l, notoriety: 0, observer, role: null, camera: false, alerted: false, band: 'core', zone, chebyshev: 5, warnedByThis: false, warnedByAny: false, ...extra
        }).outcome;

        it('guard: the Staff zone reads as Public', () => {
            expect(read(look(null), 'staff', 'enforcer')).toBe('T');
            expect(read(look('guard'), 'staff', 'enforcer')).toBe('-');
            expect(read(look('guard'), 'staff', 'staff')).toBe('-');
        });

        it('guard: in the Secure zone staff give +1 instead of !, cameras and enforcers ignore them', () => {
            expect(read(look(null), 'secure', 'staff')).toBe('!');
            expect(read(look('guard'), 'secure', 'staff')).toBe('+1');
            expect(read(look('guard', 'concealed'), 'secure', 'staff')).toBe('+1');
            expect(read(look('guard'), 'secure', 'enforcer', { camera: true })).toBe('-');
            expect(read(look('guard'), 'secure', 'enforcer')).toBe('-');
            // A staff uniform doesn't help there.
            expect(read(look('staff'), 'secure', 'staff')).toBe('!');
        });

        it('guard: seen through by any guard within 2 tiles in Core, and by the security chief at any range in Core: !', () => {
            expect(read(look('guard'), 'staff', 'enforcer', { chebyshev: 2 })).toBe('!');
            expect(read(look('guard'), 'public', 'enforcer', { chebyshev: 1 })).toBe('!');
            expect(read(look('guard'), 'staff', 'enforcer', { chebyshev: 2, band: 'peripheral' })).toBe('-');
            expect(read(look('guard'), 'secure', 'enforcer', { role: 'chief', chebyshev: 6 })).toBe('!');
            expect(read(look('guard'), 'secure', 'staff', { role: 'manager', chebyshev: 6 })).toBe('+1');
        });

        it('staff: seen through by the manager and the security chief in Core (trespass), as before', () => {
            expect(read(look('staff'), 'staff', 'staff')).toBe('-');
            expect(read(look('staff'), 'staff', 'staff', { role: 'manager' })).toBe('T');
            expect(read(look('staff'), 'staff', 'enforcer', { chebyshev: 1 })).toBe('-');
        });

        it('courier: as guard', () => {
            expect(read(look('courier'), 'secure', 'staff')).toBe('+1');
            expect(read(look('courier'), 'staff', 'enforcer', { chebyshev: 1 })).toBe('!');
        });
    });
});

describe('M2-03 review', () => {
    /** A customer at (2, 1), armed or not, surprised by GO (commanded for one phase) beside Mara: the same scene. */
    const scene = (armed: boolean) => {
        const extra = armed ? { armed: 'hidden' as const } : {};
        const { world, state } = setup([person('cust', 'customer', 'civilian', P(2, 1), {
            ...extra, schedule: [{ from: 1, activity: 'wait', label: 'waiting', room: '', at: P(2, 1), facing: 'n' }, { from: 99, activity: 'leave', label: 'leaving', room: '', at: P(0, 4) }]
        })], [{ id: 'mara', pos: P(2, 2) }]);
        return { world, state: run(world, state, { type: 'go', crew: 'mara' }) };
    };

    it('an armed civilian\'s lapse is previewed exactly as an unarmed one\'s: the same roll stops it', () => {
        const a = scene(true), b = scene(false);
        expect(npc(a.state, 'cust').command).toEqual(npc(b.state, 'cust').command);
        const pa = preview(a.world, a.state, { type: 'endTurn' }), pb = preview(b.world, b.state, { type: 'endTurn' });
        expect(pa.pending).toBeDefined();
        expect(pa.pending).toEqual(pb.pending);
        expect(pa.events).toEqual(pb.events);
        expect(pendingCarriers(a.world, a.state)).toEqual(pendingCarriers(b.world, b.state));
        const wa = preview(a.world, a.state, { type: 'wait', crew: 'mara' }), wb = preview(b.world, b.state, { type: 'wait', crew: 'mara' });
        expect(wa.events).toEqual(wb.events);
        // The commit: the armed one always reaches, whatever the dice.
        const ra = commit(a.world, a.state, { type: 'endTurn' });
        expect(ra.events.find(e => e.type === 'lapsed')).toEqual({ type: 'lapsed', npc: 'cust', outcome: 'reachForWeapon' });
        expect(ra.rolls.map(r => r.reason)).toEqual(commit(b.world, b.state, { type: 'endTurn' }).rolls.map(r => r.reason));
    });

    it('a guard a frisk disarmed stays down when his command lapses; armed, he reaches', () => {
        const { world, state } = setup([person('guard', 'guard', 'enforcer', P(2, 1))], [{ id: 'mara', pos: P(2, 2), items: ['pistol'] }], {});
        const down = { ...state, npcs: state.npcs.map(n => ({ ...n, status: 'commanded' as const, command: { pips: 1, by: 'mara' } })) };
        const lapse = (s: State) => step(world, s, { type: 'endTurn' }).events.find(e => e.type === 'lapsed');
        expect(lapse(down)).toEqual({ type: 'lapsed', npc: 'guard', outcome: 'reachForWeapon' });
        expect(lapse({ ...down, npcs: down.npcs.map(n => ({ ...n, armed: null })) })).toEqual({ type: 'lapsed', npc: 'guard', outcome: 'stayDown' });
    });

    it('a frisk takes a guard\'s holstered pistol, and a frisked NPC no longer passes keycard doors', () => {
        const { world, state } = setup([person('guard', 'guard', 'enforcer', P(5, 1))], [{ id: 'mara', pos: P(5, 2), items: ['pistol'] }]);
        const down = run(world, state, { type: 'command', crew: 'mara' });
        const knocked = npc(down, 'guard').status === 'commanded' ? down : run(world, fresh(down), { type: 'knockout', crew: 'mara', npc: 'guard' });
        const r = step(world, fresh(knocked), { type: 'zipTie', crew: 'mara', npc: 'guard' });
        expect(r.events).toContainEqual({ type: 'weaponTaken', crew: 'mara', npc: 'guard' });
        const door = world.doors.staffDoor!;
        expect(npcCanPass(personOf(world, 'guard'), npc(knocked, 'guard'))(door, 'locked')).toBe(true);
        expect(npcCanPass(personOf(world, 'guard'), npc(r.state, 'guard'))(door, 'locked')).toBe(false);
        expect(npcCanPass(personOf(world, 'guard'), npc(r.state, 'guard'))({ ...door, lock: 'mechanical' }, 'locked')).toBe(true);
    });

    it('changing clothes is refused in sight of an NPC the crew sees', () => {
        const lockers: WorldObject = { id: 'lockers', kind: 'lockers', pos: P(9, 1), facing: 's' };
        const { world, state } = setup([person('teller', 'teller', 'staff', P(9, 4), { facing: 'n' })], [{ id: 'jun', pos: P(9, 2) }], { objects: [lockers] });
        const seen = { ...state, knowledge: { ...state.knowledge, npcs: { teller: { at: P(9, 4), facing: 'n' as const, turn: 1, live: true, routine: false, rota: false, watched: 0, watchedTurn: 1, tick: state.knowledge.tick } } } };
        expect(whyNot(world, seen, { type: 'changeClothes', crew: 'jun', from: 'lockers' })).toBe('teller would see jun change');
        const away = { ...seen, npcs: seen.npcs.map(n => ({ ...n, facing: 's' as const })) };
        expect(whyNot(world, { ...away, knowledge: { ...away.knowledge, npcs: { teller: { ...seen.knowledge.npcs.teller!, facing: 's' as const } } } }, { type: 'changeClothes', crew: 'jun', from: 'lockers' })).toBeUndefined();
    });

    it('a guard\'s uniform through real perception and the safe floor: staff ignore it on Staff floor, a guard close by sees through it', () => {
        const world = fixtureWorld(MAP, { zones: ZONES.map(r => r.replace(/\./g, 's')), people: [
            person('teller', 'teller', 'staff', P(2, 0), { facing: 's' }), person('guard', 'guard', 'enforcer', P(10, 0), { facing: 's' })
        ] });
        const state = scouted(world, initialState(world, { seed: 5, crew: [{ id: 'mara', pos: P(2, 4), items: ['pistol'], uniform: 'guard' }] }));
        const floor = safeFloor(world, state, 'mara');
        expect(floor.at(P(2, 3))!.tint.kind).toBe('safe');
        const near = commit(world, state, { type: 'move', crew: 'mara', path: [P(2, 3)] });
        expect(npc(near.state, 'teller').exposedTo).toEqual([]);
        expect(npc(near.state, 'teller').suspicion).toEqual({});
        // Within 2 tiles of the guard, in his Core: "You're not Dave."
        const dave = { ...state, crew: state.crew.map(c => ({ ...c, pos: P(10, 4) })) };
        expect(safeFloor(world, dave, 'mara').at(P(10, 2))!.tint.kind).toBe('red');
        const busted = commit(world, dave, { type: 'move', crew: 'mara', path: [P(10, 3), P(10, 2)] });
        expect(npc(busted.state, 'guard').exposedTo).toEqual(['mara']);
    });

    it('refuses a save from before a package added a field (a crew member\'s zip-ties, an NPC\'s keycard)', () => {
        const { world, state } = setup([person('cust', 'customer', 'civilian', P(2, 1))], [{ id: 'mara', pos: P(2, 2) }]);
        const text = serialiseState({ state, recent: [], undo: [] });
        expect(() => deserialiseState(text, world)).not.toThrow();
        const old = JSON.parse(text) as { state: State };
        delete (old.state.crew[0] as Partial<State['crew'][number]>).zipTies;
        expect(() => deserialiseState(JSON.stringify(old), world)).toThrow(/crew\[0\] has no zipTies/);
        const older = JSON.parse(text) as { state: State };
        delete (older.state.npcs[0] as Partial<State['npcs'][number]>).keycard;
        expect(() => deserialiseState(JSON.stringify(older), world)).toThrow(/npcs\[0\] has no keycard/);
    });
});
