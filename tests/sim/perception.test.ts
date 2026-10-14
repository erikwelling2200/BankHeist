import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    assessEnd, assessPath, assessStep, assessWorldPhase, checkLoadout, commit, crewLook, fixtureWorld, friskFinds, hashOf, initialState, preview,
    reaction, sightingsAlong, sightMap, witness, witnessAct, type CameraDef, type Command, type CrewStart, type Facing,
    type FixtureWall, type ObserverClass, type Outcome, type PersonDef, type Pos, type Profile, type ReadonlyWorld, type SimEvent,
    type State, type Zone
} from '../../src/sim';
import { registerTestCommand, step, testCommand } from './helpers';

const P = (x: number, y: number): Pos => ({ x, y });

const ROLES: Record<ObserverClass, string> = { civilian: 'customer', staff: 'teller', enforcer: 'guard' };

const person = (id: string, observer: ObserverClass, pos: Pos, facing: Facing, role = ROLES[observer]): PersonDef =>
    ({ id, name: id, role, observer, pos, facing, schedule: [] });

/** A loadout for each profile (§7.4). */
const LOADOUT: Record<Profile, Partial<CrewStart>> = {
    clean: {},
    concealed: { items: ['pistol'] },
    armed: { items: ['assaultRifle'] },
    heavy: { masked: true }
};

const ZONE_CHAR: Record<Zone, string> = { public: '.', staff: 's', secure: 'x' };

/** An open floor of one zone. */
function floor(zone: Zone, w = 15, h = 15, options: { people?: PersonDef[]; cameras?: CameraDef[]; walls?: FixtureWall[] } = {}): ReadonlyWorld {
    const row = ZONE_CHAR[zone].repeat(w);
    return fixtureWorld(Array.from({ length: h }, () => row), options);
}

/** What one observer does on seeing a crew member ending an action on `tile`: its outcome, or '-'. */
function outcomeOf(world: ReadonlyWorld, state: State, crew: string, tile: Pos, observer: string): Outcome {
    return assessEnd(world, state, sightMap(world, state), crew, tile).find(s => s.observer === observer)?.outcome ?? '-';
}

const events = (list: readonly SimEvent[], type: SimEvent['type']): SimEvent[] => list.filter(e => e.type === type);

// ------------------------------------------------------------------------------------------------- The matrix (§8.4)

type OracleCase = [Zone, 'civ' | 'staff' | 'enf', boolean, Profile, number, number, string];
const ORACLE = JSON.parse(readFileSync(join(__dirname, 'data/rules-py-reactions.json'), 'utf8')) as OracleCase[];
const CLASS: Record<OracleCase[1], ObserverClass> = { civ: 'civilian', staff: 'staff', enf: 'enforcer' };

describe('the reaction matrix', () => {
    // The mockups' rules.py (scripts/ui-mockups/rules.py), run with clear sight on one-zone floors: an observer at the
    // origin facing east, a crew member at each offset, calm and on edge. Its cut-down rules give civilians nothing in
    // the Secure zone; §8.4 doesn't list them there, and ours read the Staff zone's civilian column (tested below).
    const covered = ORACLE.filter(([zone, cls]) => !(zone === 'secure' && cls === 'civ'));

    it('has every case of the oracle', () => {
        expect(covered.length).toBe(ORACLE.length - 48);
        for (const outcome of ['-', '+1', '+2', '!', 'T']) expect(covered.some(c => c[6] === outcome)).toBe(true);
    });

    const worlds = new Map<string, ReadonlyWorld>();
    it.each(covered)('%s, %s observer, on edge %s, %s at (%i, %i): %s', (zone, cls, alerted, profile, dx, dy, expected) => {
        const key = `${zone} ${cls}`;
        let world = worlds.get(key);
        if (!world) worlds.set(key, world = floor(zone, 15, 15, { people: [person('npc', CLASS[cls], P(3, 7), 'e')] }));
        const tile = P(3 + dx, 7 + dy);
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0), ...LOADOUT[profile] }] });
        state.npcs[0]!.alerted = alerted;
        // rules.py measures frisk range as Euclidean 2.2; the rules take Chebyshev 2 (§6 decision 3). (1, 2) is the
        // one oracle offset where they differ and the cell is frisk range: an on-edge guard reading Clean as Concealed.
        const chebyshevOnly = zone === 'public' && cls === 'enf' && alerted && profile === 'clean' && dx === 1 && dy === 2;
        expect(outcomeOf(world, state, 'jun', tile, 'npc')).toBe(chebyshevOnly ? '+1' : expected);
    });

    it('gives civilians in the Secure zone the Staff zone\'s civilian column', () => {
        const world = floor('secure', 9, 9, { people: [person('c', 'civilian', P(1, 4), 'e')] });
        const expected: Record<Profile, Outcome> = { clean: '-', concealed: '-', armed: '!', heavy: '!' };
        for (const profile of ['clean', 'concealed', 'armed', 'heavy'] as const) {
            const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(4, 4), ...LOADOUT[profile] }] });
            expect(outcomeOf(world, state, 'jun', P(4, 4), 'c')).toBe(expected[profile]);
        }
    });

    it('takes frisk range as Chebyshev 2 (§6 decision 3)', () => {
        const world = floor('public', 15, 15, { people: [person('g', 'enforcer', P(3, 7), 'e')] });
        for (const [dx, dy, out] of [[1, 0, '+1'], [2, 0, '+1'], [2, 1, '+1'], [2, 2, '+1'], [3, 0, '-'], [3, 1, '-'], [6, 0, '-']] as const) {
            const tile = P(3 + dx, 7 + dy);
            const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: tile, items: ['pistol'] }] });
            expect(outcomeOf(world, state, 'jun', tile, 'g'), `(${dx}, ${dy})`).toBe(out);
        }
    });

    it('reads Peripheral one step weaker, and needs Core for a trespass', () => {
        const base = {
            look: { profile: 'clean' as Profile, shows: 'nothing', uniform: null }, notoriety: 0, role: 'guard', camera: false,
            alerted: false, chebyshev: 5, warnedByThis: false, warnedByAny: false
        };
        const r = (zone: Zone, profile: Profile, observer: ObserverClass, band: 'core' | 'peripheral') =>
            reaction(floor('public', 1, 1).rules, { ...base, look: { ...base.look, profile }, zone, observer, band }).outcome;
        expect(r('public', 'heavy', 'civilian', 'peripheral')).toBe('+2');
        expect(r('public', 'armed', 'staff', 'peripheral')).toBe('+1');
        expect(r('staff', 'concealed', 'staff', 'peripheral')).toBe('+1');
        expect(r('staff', 'clean', 'staff', 'core')).toBe('T');
        expect(r('staff', 'clean', 'enforcer', 'peripheral')).toBe('-');
        expect(r('secure', 'clean', 'enforcer', 'peripheral')).toBe('+2');
    });

    describe('the staff uniform (§8.4, §8.14)', () => {
        const uniform = (profile: Profile): Partial<CrewStart> => ({ ...LOADOUT[profile], uniform: 'staff' });
        const people = [
            person('teller', 'staff', P(3, 3), 'e'), person('guard', 'enforcer', P(3, 5), 'e'), person('manager', 'staff', P(3, 7), 'e', 'manager'),
            person('chief', 'enforcer', P(3, 9), 'e', 'chief'), person('customer', 'civilian', P(3, 11), 'e')
        ];
        const staffFloor = floor('staff', 15, 15, { people });

        it('makes a Clean crew member read — in the Staff zone, except to the manager and the security chief in Core', () => {
            const tile = P(7, 6);
            const state = initialState(staffFloor, { seed: 1, crew: [{ id: 'jun', pos: tile, ...uniform('clean') }] });
            const out = Object.fromEntries(['teller', 'guard', 'manager', 'chief', 'customer'].map(id => [id, outcomeOf(staffFloor, state, 'jun', tile, id)]));
            expect(out).toEqual({ teller: '-', guard: '-', manager: 'T', chief: 'T', customer: '-' });
            // Without the uniform, staff and enforcers challenge.
            const plain = initialState(staffFloor, { seed: 1, crew: [{ id: 'jun', pos: tile }] });
            expect(['teller', 'guard'].map(id => outcomeOf(staffFloor, plain, 'jun', tile, id))).toEqual(['T', 'T']);
        });

        it('fools the manager in Peripheral view', () => {
            // (2, 4) from the manager facing east is Peripheral, not Core.
            const tile = P(5, 11);
            const state = initialState(staffFloor, { seed: 1, crew: [{ id: 'jun', pos: tile, ...uniform('clean') }] });
            const s = assessEnd(staffFloor, state, sightMap(staffFloor, state), 'jun', tile);
            expect(s.find(x => x.observer === 'manager')).toBeUndefined();
        });

        it('reads Concealed in uniform as Concealed in Public, and the chief sees through it', () => {
            const near = P(5, 5), state = initialState(staffFloor, { seed: 1, crew: [{ id: 'jun', pos: near, ...uniform('concealed') }] });
            expect(outcomeOf(staffFloor, state, 'jun', near, 'teller')).toBe('-');
            expect(outcomeOf(staffFloor, state, 'jun', near, 'guard')).toBe('+1');
            const far = P(8, 5), away = initialState(staffFloor, { seed: 1, crew: [{ id: 'jun', pos: far, ...uniform('concealed') }] });
            expect(outcomeOf(staffFloor, away, 'jun', far, 'guard')).toBe('-');
            const byChief = P(7, 9), seen = initialState(staffFloor, { seed: 1, crew: [{ id: 'jun', pos: byChief, ...uniform('concealed') }] });
            expect(outcomeOf(staffFloor, seen, 'jun', byChief, 'chief')).toBe('!');
            expect(assessEnd(staffFloor, seen, sightMap(staffFloor, seen), 'jun', byChief).find(s => s.observer === 'chief')!.why).toContain('seenThrough');
        });

        it("doesn't help in the Secure zone, and breaks under anything Armed or Heavy", () => {
            const secure = floor('secure', 15, 15, { people });
            const tile = P(7, 3), state = initialState(secure, { seed: 1, crew: [{ id: 'jun', pos: tile, ...uniform('clean') }] });
            expect(outcomeOf(secure, state, 'jun', tile, 'teller')).toBe('!');
            const armed = initialState(staffFloor, { seed: 1, crew: [{ id: 'jun', pos: tile, ...uniform('armed') }] });
            expect(crewLook(armed.crew[0]!).uniform).toBeNull();
            expect(outcomeOf(staffFloor, armed, 'jun', tile, 'customer')).toBe('-');
            expect(outcomeOf(staffFloor, armed, 'jun', tile, 'teller')).toBe('!');
        });
    });

    describe('cameras', () => {
        const cam = (zone: Zone) => floor(zone, 15, 15, { cameras: [{ id: 'cam', pos: P(3, 7), facings: ['e'], room: null }] });
        const camOutcome = (zone: Zone, profile: Profile, tile: Pos) => {
            const world = cam(zone), state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: tile, ...LOADOUT[profile] }] });
            return outcomeOf(world, state, 'jun', tile, 'cam');
        };

        it('register only the ! cells', () => {
            expect(camOutcome('public', 'armed', P(6, 7))).toBe('!');
            expect(camOutcome('public', 'heavy', P(6, 7))).toBe('!');
            expect(camOutcome('public', 'concealed', P(4, 7))).toBe('-');
            expect(camOutcome('staff', 'clean', P(6, 7))).toBe('-');
            expect(camOutcome('staff', 'concealed', P(6, 7))).toBe('!');
            expect(camOutcome('secure', 'clean', P(6, 7))).toBe('!');
        });
    });

    describe('Notoriety (§19.7)', () => {
        const world = floor('public', 15, 15, { people: [person('g', 'enforcer', P(3, 5), 'e'), person('c', 'civilian', P(3, 9), 'e')] });
        const at = (notoriety: number, profile: Profile, tile: Pos, who: string): Outcome => {
            const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: tile, notoriety, ...LOADOUT[profile] }] });
            return outcomeOf(world, state, 'jun', tile, who);
        };

        it('is no step by default', () => {
            expect(at(0, 'clean', P(4, 5), 'g')).toBe('-');
            expect(at(1, 'clean', P(4, 5), 'g')).toBe('-');
        });

        it('makes Known crew read one profile higher to enforcers only', () => {
            expect(at(2, 'clean', P(4, 5), 'g')).toBe('+1');
            expect(at(3, 'clean', P(7, 5), 'g')).toBe('-');
            expect(at(2, 'concealed', P(7, 5), 'g')).toBe('!');
            expect(at(2, 'armed', P(5, 9), 'c')).toBe('+2');
        });

        it('makes Wanted crew read one profile higher to everyone', () => {
            expect(at(4, 'armed', P(5, 9), 'c')).toBe('!');
            expect(at(5, 'concealed', P(5, 9), 'c')).toBe('+2');
        });
    });
});

// ------------------------------------------------------------------------------------------------- Profiles (§7.4)

describe('the profile', () => {
    const world = floor('public', 3, 3);
    const look = (start: Partial<CrewStart>) => crewLook(initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0), ...start }] }).crew[0]!);

    it('is the most conspicuous visible item', () => {
        expect(look({})).toEqual({ profile: 'clean', shows: 'nothing', uniform: null });
        expect(look({ items: ['taser', 'zipTies', 'hackingKit'] }).profile).toBe('clean');
        expect(look({ items: ['lockpick', 'pistol', 'lightVest'] })).toEqual({ profile: 'concealed', shows: 'pistol', uniform: null });
        expect(look({ items: ['pistol', 'mediumArmour'] }).shows).toBe('mediumArmour');
        expect(look({ items: ['lmg'] }).profile).toBe('heavy');
        expect(look({ items: ['heavyArmour'] }).profile).toBe('heavy');
        expect(look({ items: ['drill'] }).profile).toBe('armed');
    });

    it('counts packed items as their case or the duffel', () => {
        expect(look({ packed: ['dmr'] })).toEqual({ profile: 'concealed', shows: 'packed:dmr', uniform: null });
        expect(look({ items: ['dmr'] }).profile).toBe('armed');
        expect(look({ items: ['duffel'], packed: ['assaultRifle', 'heavyArmour'] }).profile).toBe('concealed');
        expect(() => look({ packed: ['assaultRifle'] })).toThrow(/without a duffel/);
        expect(() => look({ items: ['duffel'], packed: ['assaultRifle', 'smg'] })).toThrow(/one long gun/);
        expect(() => look({ packed: ['pistol'] })).toThrow(/can't pack/);
        expect(() => look({ items: ['banana'] })).toThrow(/No item/);
    });

    it('is Heavy with the mask on and Armed carrying a bag or a body', () => {
        expect(look({ masked: true })).toEqual({ profile: 'heavy', shows: 'mask', uniform: null });
        expect(look({ carrying: 'body' }).profile).toBe('armed');
        expect(look({ carrying: 'lootBag', uniform: 'staff' })).toEqual({ profile: 'armed', shows: 'carrying:lootBag', uniform: null });
        expect(look({ items: ['pistol'], uniform: 'staff' }).uniform).toBe('staff');
        expect(() => look({ notoriety: 6 })).toThrow(/Notoriety/);
    });

    it('lets a frisk find anything that isn\'t Clean, shown or packed', () => {
        const member = (start: Partial<CrewStart>) => initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0), ...start }] }).crew[0]!;
        expect(friskFinds(member({ items: ['lockpick'] }))).toBe(false);
        expect(friskFinds(member({ items: ['pistol'] }))).toBe(true);
        expect(friskFinds(member({ packed: ['dmr'] }))).toBe(true);
        expect(friskFinds(member({ items: ['duffel'] }))).toBe(false);
        expect(friskFinds(member({ items: ['duffel'], packed: ['smg'] }))).toBe(true);
        expect(() => checkLoadout(member({}))).not.toThrow();
    });
});

// ------------------------------------------------------------------------------------------------- On edge, eyes down

describe('on edge (§8.7)', () => {
    it('reads every crew member one profile higher and sees further', () => {
        const world = floor('public', 15, 15, { people: [person('t', 'staff', P(1, 7), 'e')] });
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(3, 7), items: ['pistol'] }, { id: 'mara', pos: P(8, 7) }] });
        expect(outcomeOf(world, state, 'jun', P(3, 7), 't')).toBe('-');
        state.npcs[0]!.alerted = true;
        // Concealed reads as Armed: +2 from a teller; and 7 tiles away is now in its (wider) Core.
        expect(outcomeOf(world, state, 'jun', P(3, 7), 't')).toBe('+2');
        expect(assessEnd(world, state, sightMap(world, state), 'mara', P(8, 7))).toEqual([]);
        expect(outcomeOf(world, state, 'jun', P(8, 7), 't')).toBe('+2');
        const s = assessEnd(world, state, sightMap(world, state), 'jun', P(8, 7))[0]!;
        expect(s.band).toBe('core');
        expect(s.why).toContain('onEdge');
    });

    it('stays when commanded: a commanded guard is Alerted but eyes down', () => {
        const world = floor('public', 15, 15, { people: [person('g', 'enforcer', P(1, 7), 'e')] });
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(4, 7), items: ['assaultRifle'] }] });
        state.npcs[0]!.alerted = true;
        state.npcs[0]!.status = 'commanded';
        expect(assessEnd(world, state, sightMap(world, state), 'jun', P(4, 7))).toEqual([]);
        expect(state.npcs[0]!.alerted).toBe(true);
    });
});

describe('eyes down (§8.7)', () => {
    it.each(['commanded', 'tied', 'unconscious', 'dead'] as const)('%s NPCs build no suspicion and Expose nobody', status => {
        const world = floor('public', 15, 15, { people: [person('g', 'enforcer', P(1, 7), 'e')] });
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(3, 7), items: ['assaultRifle'] }] });
        state.npcs[0]!.status = status;
        const sight = sightMap(world, state);
        expect(assessEnd(world, state, sight, 'jun', P(3, 7))).toEqual([]);
        expect(assessStep(world, state, sight, 'jun', P(3, 7))).toEqual([]);
        expect(witness(world, state, sight, 'jun', 'knockout', P(3, 7))).toEqual([]);
        expect(sightingsAlong(world, state, sight, 'g', 'jun', P(3, 7))).toBeNull();
        const after = step(world, state, { type: 'endTurn' }).state;
        expect(after.npcs[0]!.exposedTo).toEqual([]);
    });
});

// ------------------------------------------------------------------------------------------------- Illegal acts

registerTestCommand('testKnockout', (ctx, cmd) => witnessAct(ctx, cmd.crew!, 'knockout'));

describe('illegal acts (§8.4)', () => {
    it('are ! for anyone who sees them, in Peripheral view too, and for cameras', () => {
        const world = floor('public', 15, 15, {
            people: [person('c', 'civilian', P(3, 7), 'e'), person('away', 'staff', P(13, 7), 'e')],
            cameras: [{ id: 'cam', pos: P(3, 6), facings: ['se'], room: null }]
        });
        // (2, 4) from the civilian is Peripheral.
        const tile = P(5, 11), state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: tile }] });
        const seen = witness(world, state, sightMap(world, state), 'jun', 'zipTie', tile);
        expect(seen.map(s => [s.observer, s.band, s.outcome, s.act])).toEqual([['c', 'peripheral', '!', 'zipTie'], ['cam', 'core', '!', 'zipTie']]);
        const result = commit(world, state, testCommand({ type: 'testKnockout', crew: 'jun' }));
        expect(result.state.npcs[0]!.exposedTo).toEqual(['jun']);
        expect(result.state.npcs[0]!.alerted).toBe(true);
        expect(result.state.npcs[1]!.exposedTo).toEqual([]);
        expect(result.state.cameraReports).toEqual([{ camera: 'cam', crew: 'jun', tile, turn: 1, phase: 'crew' }]);
        expect(result.undoable).toBe(false);
    });
});

// ------------------------------------------------------------------------------------------------- Moves (§8.5)

describe('a crew move', () => {
    // A lobby (x 0–4) and a staff area (x 5–9); a teller behind the line looks west over both.
    const lobby = (people: PersonDef[] = [person('teller', 'staff', P(7, 2), 'w')], extra: { walls?: FixtureWall[]; cameras?: CameraDef[] } = {}) =>
        fixtureWorld(['.....sssss', '.....sssss', '.....sssss', '.....sssss', '.....sssss'], { people, ...extra });

    it('counts only ! cells mid-move, and the matrix value at the end', () => {
        const world = lobby();
        let state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(9, 0), items: ['pistol'] }] });
        // Through the teller's Core (Concealed in Staff: +2, which doesn't count mid-move) to its Peripheral view (+1).
        const past = step(world, state, { type: 'move', crew: 'jun', path: [P(8, 1), P(7, 1), P(6, 1), P(6, 0)] });
        expect(past.state.npcs[0]!.suspicion).toEqual({ jun: 1 });
        // ...but walking on, out of its view, adds nothing more.
        state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(5, 4), items: ['pistol'] }] });
        const by = step(world, state, { type: 'move', crew: 'jun', path: [P(6, 3), P(7, 3), P(8, 3), P(9, 3)] });
        expect(by.state.npcs[0]!.suspicion).toEqual({});
        expect(by.undoable).toBe(true);
    });

    it("can't walk a rifle past a guard", () => {
        const world = lobby([person('guard', 'enforcer', P(2, 0), 's')]);
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 3), items: ['assaultRifle'] }] });
        const sight = sightMap(world, state);
        expect(assessStep(world, state, sight, 'jun', P(2, 3)).map(s => s.outcome)).toEqual(['!']);
        const result = step(world, state, { type: 'move', crew: 'jun', path: [P(1, 3), P(2, 3), P(3, 3), P(4, 4)] });
        expect(result.state.npcs[0]!.exposedTo).toEqual(['jun']);
        expect(events(result.events, 'exposed')).toEqual([{ type: 'exposed', npc: 'guard', crew: 'jun', why: [] }]);
        expect(result.state.npcs[0]!.wants.map(w => [w.kind, w.crew])).toEqual([['react', 'jun']]);
        expect(result.undoable).toBe(false);
    });

    it('stays undoable when nobody minds, and emits checks that block undo when someone does', () => {
        const world = lobby([person('guard', 'enforcer', P(2, 0), 's')]);
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 3) }, { id: 'mara', pos: P(0, 4), items: ['pistol'] }] });
        const clean = step(world, state, { type: 'move', crew: 'jun', path: [P(1, 3), P(2, 3)] });
        expect(clean.undoable).toBe(true);
        expect(clean.events.map(e => e.type)).toEqual(['moved']);
        const concealed = step(world, state, { type: 'move', crew: 'mara', path: [P(1, 3), P(2, 2)] });
        expect(concealed.events.map(e => e.type)).toEqual(['moved', 'perceptionCheck', 'suspicionRaised']);
        expect(events(concealed.events, 'suspicionRaised')).toEqual([{ type: 'suspicionRaised', npc: 'guard', crew: 'mara', added: 1, total: 1, why: ['friskRange'] }]);
        expect(concealed.undoable).toBe(false);
    });

    it('judges the whole move against the NPCs as the move began, with the doors it opens', () => {
        // A door between the lobby and a staff room; the teller inside looks at the door.
        const walls: FixtureWall[] = [
            { between: [P(4, 0), P(5, 0)] }, { between: [P(4, 1), P(5, 1)] }, { between: [P(4, 2), P(5, 2)], door: { id: 'd' } },
            { between: [P(4, 3), P(5, 3)] }, { between: [P(4, 4), P(5, 4)] }
        ];
        const world = lobby([person('teller', 'staff', P(8, 2), 'w')], { walls });
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(2, 2), items: ['assaultRifle'] }] });
        const sight = sightMap(world, state);
        // With the door shut the teller sees nothing of the lobby.
        expect(assessEnd(world, state, sight, 'jun', P(3, 2))).toEqual([]);
        const result = step(world, state, { type: 'move', crew: 'jun', path: [P(3, 2), P(4, 2)] });
        expect(result.state.doors.d!.status).toBe('closed');
        const through = step(world, state, { type: 'move', crew: 'jun', path: [P(3, 2), P(4, 2), P(5, 2), P(4, 2)] });
        expect(through.state.doors.d!.status).toBe('open');
        // Mid-move in Staff and back in the lobby at the end, seen through the open door: Exposed (Armed in Staff mid-move).
        expect(through.state.npcs[0]!.exposedTo).toEqual(['jun']);
        expect(events(through.events, 'perceptionCheck')).toHaveLength(2);
    });

    it('is judged as a whole by assessPath, which a camera reports once', () => {
        const world = lobby([person('guard', 'enforcer', P(2, 0), 's')], { cameras: [{ id: 'cam', pos: P(0, 0), facings: ['se'], room: null }] });
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 3), items: ['assaultRifle'] }] });
        const path = [P(1, 3), P(2, 3), P(3, 3)];
        const judged = assessPath(world, state, 'jun', path);
        expect(judged.steps.map(s => [s.observer, s.tile])).toEqual([['guard', P(1, 3)], ['cam', P(1, 3)], ['guard', P(2, 3)], ['cam', P(2, 3)]]);
        expect(judged.end.map(s => s.observer)).toEqual(['guard', 'cam']);
        const result = step(world, state, { type: 'move', crew: 'jun', path });
        expect(events(result.events, 'cameraSaw')).toHaveLength(1);
        expect(result.state.cameraReports).toHaveLength(1);
    });

    it('previews exactly what it commits', () => {
        const world = lobby([person('teller', 'staff', P(7, 2), 'w'), person('guard', 'enforcer', P(2, 0), 's')]);
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 2), items: ['pistol'] }] });
        const cmd: Command = { type: 'move', crew: 'jun', path: [P(1, 2), P(2, 2), P(3, 2), P(4, 2), P(5, 2)] };
        const shown = preview(world, state, cmd), done = commit(world, state, cmd);
        expect(shown.events).toEqual(done.events);
        expect(hashOf(shown.state)).toBe(hashOf(done.state));
    });
});

// ------------------------------------------------------------------------------------------------- Pips (§8.5)

describe('suspicion pips', () => {
    const world = floor('public', 15, 15, { people: [person('g', 'enforcer', P(3, 7), 'e')] });

    it('turn Curious, then Investigating, and decay when unseen', () => {
        let state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(4, 9), items: ['pistol'] }] });
        // One step into frisk range and Core: +1, Curious.
        state = step(world, state, { type: 'move', crew: 'jun', path: [P(4, 8)] }).state;
        expect(state.npcs[0]!.suspicion).toEqual({ jun: 1 });
        expect(state.npcs[0]!.wants).toEqual([{ kind: 'face', crew: 'jun', tile: P(4, 8), decided: { turn: 1, phase: 'crew' } }]);
        // The world phase: the guard stands and still sees him: +1 more, Investigating.
        const world1 = step(world, state, { type: 'endTurn' });
        state = world1.state;
        expect(state.npcs[0]!.suspicion).toEqual({ jun: 2 });
        expect(state.npcs[0]!.wants.map(w => w.kind)).toEqual(['investigate']);
        expect(state.npcs[0]!.wants[0]!.decided).toEqual({ turn: 1, phase: 'world' });
        // Out of sight behind the guard: one pip a world phase.
        state = step(world, state, { type: 'move', crew: 'jun', path: [P(3, 8), P(2, 8)] }).state;
        expect(state.npcs[0]!.suspicion).toEqual({ jun: 2 });
        const world2 = step(world, state, { type: 'endTurn' });
        expect(world2.state.npcs[0]!.suspicion).toEqual({ jun: 1 });
        expect(events(world2.events, 'suspicionDecayed')).toEqual([{ type: 'suspicionDecayed', npc: 'g', crew: 'jun', total: 1 }]);
        expect(world2.state.npcs[0]!.wants.map(w => w.kind)).toEqual(['face']);
        const world3 = step(world, world2.state, { type: 'endTurn' }).state;
        expect(world3.npcs[0]!.suspicion).toEqual({});
        expect(world3.npcs[0]!.wants).toEqual([]);
    });

    it('Expose at 3, for good', () => {
        let state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(4, 7), items: ['pistol'] }] });
        for (let i = 0; i < 3; i++) state = step(world, state, { type: 'endTurn' }).state;
        expect(state.npcs[0]!.exposedTo).toEqual(['jun']);
        expect(state.npcs[0]!.suspicion).toEqual({ jun: 3 });
        expect(state.npcs[0]!.alerted).toBe(true);
        expect(state.npcs[0]!.alertCause).toBe('exposed jun');
        state = step(world, state, { type: 'move', crew: 'jun', path: [P(3, 8), P(2, 8)] }).state;
        for (let i = 0; i < 3; i++) state = step(world, state, { type: 'endTurn' }).state;
        expect(state.npcs[0]!.suspicion).toEqual({ jun: 3 });
        expect(state.npcs[0]!.exposedTo).toEqual(['jun']);
    });
});

// ------------------------------------------------------------------------------------------------- The world phase

describe('the world phase', () => {
    it('adds once what an NPC sees along its committed path, as the hatched preview said', () => {
        const world = floor('public', 10, 3, { people: [person('g', 'enforcer', P(0, 1), 'n')] });
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(6, 1), items: ['assaultRifle'] }] });
        state.npcs[0]!.intent = { path: [P(1, 1)], facing: 'e' };
        const sight = sightMap(world, state);
        expect(assessEnd(world, state, sight, 'jun', P(6, 1))).toEqual([]);
        const hatched = assessWorldPhase(world, state, sight, 'jun', P(6, 1));
        expect(hatched.map(s => [s.observer, s.outcome, s.from])).toEqual([['g', '!', P(1, 1)]]);
        const result = step(world, state, { type: 'endTurn' });
        expect(result.state.npcs[0]!.exposedTo).toEqual(['jun']);
        expect(events(result.events, 'perceptionCheck')).toHaveLength(1);
    });

    it('takes the strongest sighting along the path once', () => {
        const world = floor('public', 12, 3, { people: [person('t', 'staff', P(0, 1), 'e')] });
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(9, 1), items: ['assaultRifle'] }] });
        state.npcs[0]!.intent = { path: [P(1, 1), P(2, 1), P(3, 1), P(4, 1)] };
        const s = sightingsAlong(world, state, sightMap(world, state), 't', 'jun', P(9, 1))!;
        expect([s.outcome, s.from]).toEqual(['+2', P(3, 1)]);
        const result = step(world, state, { type: 'endTurn' });
        expect(result.state.npcs[0]!.suspicion).toEqual({ jun: 2 });
    });

    it('sees through the doors an NPC walks through', () => {
        const walls: FixtureWall[] = [
            { between: [P(2, 0), P(3, 0)] }, { between: [P(2, 1), P(3, 1)], door: { id: 'd' } }, { between: [P(2, 2), P(3, 2)] }
        ];
        const world = floor('public', 10, 3, { people: [person('g', 'enforcer', P(4, 1), 'w')], walls });
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 1), items: ['assaultRifle'] }] });
        const sight = sightMap(world, state);
        state.npcs[0]!.intent = { path: [P(3, 1), P(2, 1)], facing: 'e' };
        expect(sightingsAlong(world, state, sight, 'g', 'jun', P(0, 1))!.from).toEqual(P(2, 1));
        // Back through the door: standing at (2, 1) it sees west past where the door was; facing east afterwards, nothing.
        const back = { ...state, crew: [{ ...state.crew[0]!, pos: P(6, 1) }] };
        expect(sightingsAlong(world, back, sight, 'g', 'jun', P(6, 1))!.from).toEqual(P(2, 1));
        expect(sightingsAlong(world, back, sight, 'g', 'jun', P(6, 1), { intent: { path: [] } })).toBeNull();
    });
});

// ------------------------------------------------------------------------------------------------- Trespass (§8.6)

describe('trespass', () => {
    // A lobby (x 0–4) and a staff area (x 5–9); the teller behind the line looks west.
    const map = ['.....sssss', '.....sssss', '.....sssss', '.....sssss', '.....sssss'];
    const lobby = (people: PersonDef[] = [person('teller', 'staff', P(7, 2), 'w')]) => fixtureWorld(map, { people });
    const into: Command = { type: 'move', crew: 'jun', path: [P(3, 2), P(4, 2), P(5, 2)] };
    const out: Command = { type: 'move', crew: 'jun', path: [P(4, 2), P(3, 2)] };

    function challenged(world = lobby()) {
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(2, 2) }] });
        const result = step(world, state, into);
        return { world, result };
    }

    it('challenges a Clean crew member in the Staff zone, with a deadline of the next crew phase', () => {
        const { result } = challenged();
        expect(events(result.events, 'challenged')).toEqual([{ type: 'challenged', npc: 'teller', crew: 'jun', deadline: 2 }]);
        expect(result.state.npcs[0]!.challenges).toEqual([{ crew: 'jun', deadline: 2 }]);
        expect(result.state.npcs[0]!.wants.map(w => [w.kind, w.tile])).toEqual([['challenge', P(5, 2)]]);
        expect(result.undoable).toBe(false);
    });

    it('warns a crew member who complies, and Exposes them on a second offence', () => {
        const { world, result } = challenged();
        let state = step(world, result.state, { type: 'endTurn' }).state;
        expect(state.npcs[0]!.challenges).toEqual([{ crew: 'jun', deadline: 2 }]);
        state = step(world, state, out).state;
        const deadline = step(world, state, { type: 'endTurn' });
        expect(events(deadline.events, 'challengeEnded')).toEqual([{ type: 'challengeEnded', npc: 'teller', crew: 'jun', result: 'complied' }]);
        state = deadline.state;
        expect(state.npcs[0]!.warned).toEqual(['jun']);
        expect(state.npcs[0]!.exposedTo).toEqual([]);
        expect(state.npcs[0]!.wants.map(w => [w.kind, w.until])).toEqual([['escort', 3]]);
        // The escort lasts one more world phase.
        const after = step(world, state, { type: 'endTurn' }).state;
        expect(after.npcs[0]!.wants).toEqual([]);
        // Back in: Exposed at once, no challenge.
        const again = step(world, state, { type: 'move', crew: 'jun', path: [P(4, 2), P(5, 2)] });
        expect(events(again.events, 'challenged')).toEqual([]);
        expect(again.state.npcs[0]!.exposedTo).toEqual(['jun']);
        expect(events(again.events, 'exposed')[0]).toMatchObject({ why: ['secondOffence'] });
    });

    it('treats a second offence seen by any enforcer as Exposure, but another staff member only challenges', () => {
        const world = lobby([person('teller', 'staff', P(7, 2), 'w'), person('guard', 'enforcer', P(9, 4), 'nw'), person('clerk', 'staff', P(9, 0), 'sw')]);
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(6, 4) }] });
        state.npcs[0]!.warned = ['jun'];
        const sight = sightMap(world, state);
        expect(outcomeOf(world, state, 'jun', P(6, 4), 'guard')).toBe('!');
        const s = assessEnd(world, state, sight, 'jun', P(6, 1)).map(x => [x.observer, x.outcome]);
        expect(s).toEqual([['teller', '!'], ['guard', '!'], ['clerk', 'T']]);
    });

    it('Exposes a crew member who stays in the Staff zone', () => {
        const { world, result } = challenged();
        let state = step(world, result.state, { type: 'endTurn' }).state;
        state = step(world, state, { type: 'wait', crew: 'jun' }).state;
        const deadline = step(world, state, { type: 'endTurn' });
        expect(events(deadline.events, 'challengeEnded')).toEqual([{ type: 'challengeEnded', npc: 'teller', crew: 'jun', result: 'failed' }]);
        expect(deadline.state.npcs[0]!.exposedTo).toEqual(['jun']);
        expect(events(deadline.events, 'exposed')[0]).toMatchObject({ why: ['trespass'] });
    });

    it('Exposes a crew member who hides out of sight', () => {
        const { world, result } = challenged();
        let state = step(world, result.state, { type: 'endTurn' }).state;
        // Behind the teller, who looks west.
        state = step(world, state, { type: 'move', crew: 'jun', path: [P(6, 1), P(7, 1), P(8, 1), P(9, 1)] }).state;
        const sight = sightMap(world, state);
        expect(assessEnd(world, state, sight, 'jun', P(9, 1))).toEqual([]);
        // The hatched overlay shows the deadline: red anywhere off Public floor, seen or not; nothing on Public floor.
        expect(assessWorldPhase(world, state, sight, 'jun', P(9, 1)).map(s => [s.observer, s.outcome, s.band, s.why])).toEqual([['teller', '!', null, ['trespass']]]);
        expect(assessWorldPhase(world, state, sight, 'jun', P(2, 1))).toEqual([]);
        const deadline = step(world, state, { type: 'endTurn' });
        expect(deadline.state.npcs[0]!.exposedTo).toEqual(['jun']);
    });

    it('drops the challenge when the challenger is down by the deadline', () => {
        const { world, result } = challenged();
        let state = step(world, result.state, { type: 'endTurn' }).state;
        state = { ...state, npcs: [{ ...state.npcs[0]!, status: 'unconscious' }] };
        const deadline = step(world, state, { type: 'endTurn' });
        expect(events(deadline.events, 'challengeEnded')).toEqual([{ type: 'challengeEnded', npc: 'teller', crew: 'jun', result: 'dropped' }]);
        expect(deadline.state.npcs[0]!.exposedTo).toEqual([]);
        expect(deadline.state.npcs[0]!.challenges).toEqual([]);
    });

    it('gives a challenge made in the world phase a whole crew phase first', () => {
        const world = lobby([person('teller', 'staff', P(7, 2), 'n')]);
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(5, 2) }] });
        state.npcs[0]!.intent = { path: [], facing: 'w' };
        const result = step(world, state, { type: 'endTurn' });
        expect(events(result.events, 'challenged')).toEqual([{ type: 'challenged', npc: 'teller', crew: 'jun', deadline: 3 }]);
    });

    it('needs Core view and no uniform', () => {
        const world = lobby();
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(2, 2), uniform: 'staff' }] });
        expect(events(step(world, state, into).events, 'challenged')).toEqual([]);
    });
});

// ------------------------------------------------------------------------------------------------- Determinism

describe('perception', () => {
    it('plays the same every time', () => {
        const world = fixtureWorld(['.....sssss', '.....sssss', '.....sssss', '.....sssss', '.....sssss'], {
            people: [person('teller', 'staff', P(7, 2), 'w'), person('guard', 'enforcer', P(2, 0), 's'), person('c', 'civilian', P(0, 4), 'ne')],
            cameras: [{ id: 'cam', pos: P(9, 4), facings: ['nw', 'w'], room: null }]
        });
        const script: Command[] = [
            { type: 'move', crew: 'jun', path: [P(3, 2), P(4, 2), P(5, 2)] },
            { type: 'move', crew: 'mara', path: [P(1, 3), P(2, 3)] },
            { type: 'endTurn' },
            { type: 'move', crew: 'jun', path: [P(6, 3), P(7, 3)] },
            { type: 'endTurn' },
            { type: 'endTurn' },
            { type: 'endTurn' }
        ];
        const run = (): { hash: string; events: SimEvent[] } => {
            let state = initialState(world, {
                seed: 7, crew: [{ id: 'jun', pos: P(2, 2) }, { id: 'mara', pos: P(0, 3), items: ['pistol'] }, { id: 'kai', pos: P(7, 4), items: ['pistol'] }]
            });
            const all: SimEvent[] = [];
            for (const cmd of script) {
                const r = step(world, state, cmd);
                all.push(...r.events);
                state = r.state;
            }
            return { hash: hashOf(state), events: all };
        };
        const a = run(), b = run();
        expect(a.hash).toBe(b.hash);
        expect(a.events).toEqual(b.events);
        for (const type of ['challenged', 'suspicionRaised', 'exposed', 'cameraSaw'] as const) expect(events(a.events, type).length, type).toBeGreaterThan(0);
    });
});
