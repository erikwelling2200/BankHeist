import { describe, expect, it } from 'vitest';
import {
    cameraObserver, clonePlain, commit, deserialiseState, doorStatus, evidenceOnMap, fixtureWorld, generatorAt, initialState, legalActions, litNow, npcObserver, preview, reachable, sees,
    serialiseState, sightMap, vaultShut, whyNot, type Command, type CrewStart, type FixtureOptions, type FixtureWall, type PersonDef, type Pos, type ReadonlyWorld, type SimEvent, type State,
    type WorldObject
} from '../../src/sim';
import { actionMenu, menuIsLegal } from '../../src/game/actions';
import { describeEvent } from '../../src/game/views';
import { seesTile } from '../../src/sim/rules/routine';

/*
 * M4-03, the power grid (GAME_DESIGN §8.13, §14.6; decisions 240–246): the breaker and the generator, the building
 * going dark (sight halved), the cameras off, staff maglocks released, the vault console dark, and lights out as minor
 * evidence everyone in the building notices.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const endTurn = { type: 'endTurn' } as const;
const of = <K extends SimEvent['type']>(events: readonly SimEvent[], type: K) => events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
const use = (crew: string, object: string, verb: string): Command => ({ type: 'interact', crew, object, verb });
const person = (id: string, pos: Pos, role = 'guard', observer: PersonDef['observer'] = 'enforcer', facing: PersonDef['facing'] = 'w'): PersonDef =>
    ({ id, name: id, role, observer, pos, facing, schedule: [] });

/** A 16×5 lot: the building (room 'b', x 0–11) and the back lot outdoors (room 'o', x 12–15) with the generator. */
const MAP = Array.from({ length: 5 }, () => '................');
const ROOMS = Array.from({ length: 5 }, () => 'bbbbbbbbbbbboooo');
const OBJECTS: WorldObject[] = [
    { id: 'breaker', kind: 'breakerPanel', pos: P(1, 0), facing: 's', room: 'b' },
    { id: 'gen', kind: 'generator', pos: P(14, 0), facing: 's', room: 'o' }
];

interface Setup extends FixtureOptions { crew?: CrewStart[] }

function lot(options: Setup = {}): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(MAP, { rooms: ROOMS, building: ['b'], objects: OBJECTS, ...options });
    return { world, state: clonePlain(initialState(world, { seed: 4, crew: options.crew ?? [{ id: 'jun', pos: P(1, 1), items: [] }, { id: 'mara', pos: P(14, 1), items: [] }] })) };
}

/** A command's commit, checked against its preview. */
function same(world: ReadonlyWorld, state: State, cmd: Command): ReturnType<typeof commit> {
    const shown = preview(world, state, cmd), done = commit(world, state, cmd);
    expect(shown.events).toEqual(done.events);
    expect(shown.state).toEqual(done.state);
    return done;
}

const rested = (state: State): State => ({ ...state, crew: state.crew.map(c => ({ ...c, actionsLeft: 2 })) });

describe('the breaker and the generator (§8.13)', () => {
    it('cutting the mains darkens the building for three world phases, then the generator starts as the crew phase begins', () => {
        const { world, state } = lot();
        expect(legalActions(world, state, 'jun')).toContainEqual(use('jun', 'breaker', 'cut'));
        expect(whyNot(world, state, use('jun', 'breaker', 'reset'))).toBe('The mains are on');
        const cut = same(world, state, use('jun', 'breaker', 'cut'));
        expect(cut.state.crew[0]!.actionsLeft).toBe(1);
        expect(cut.state.power).toEqual({ breaker: false, generator: 'standby', cutAt: state.turn, outSince: state.turn });
        expect(of(cut.events, 'powerOut')).toEqual([{ type: 'powerOut', generatorAt: state.turn + 3 }]);
        expect(generatorAt(world, cut.state)).toBe(state.turn + 3);
        expect(whyNot(world, cut.state, use('jun', 'breaker', 'cut'))).toBe('The mains are off already');
        // The building is dark; the back lot isn't.
        expect(litNow(world, cut.state, P(3, 2))).toBe(false);
        expect(litNow(world, cut.state, P(13, 2))).toBe(true);
        const sight = sightMap(world, cut.state);
        expect(sight.lit[2 * 16 + 3]).toBe(0);
        expect(sight.lit[2 * 16 + 13]).toBe(1);

        let s = cut.state;
        for (let i = 0; i < 2; i++) {
            const r = commit(world, s, endTurn);
            expect(of(r.events, 'powerBack')).toEqual([]);
            s = r.state;
        }
        // The end of turn's preview shows the generator starting, as it will.
        const back = same(world, s, endTurn);
        expect(back.state.turn).toBe(state.turn + 3);
        expect(back.events.map(e => e.type)).toEqual(expect.arrayContaining(['generatorStarted', 'powerBack']));
        expect(back.state.power).toEqual({ breaker: false, generator: 'running', cutAt: state.turn, outSince: null });
        expect(litNow(world, back.state, P(3, 2))).toBe(true);
        // Resetting the mains stands the generator by again.
        const reset = same(world, { ...rested(back.state) }, use('jun', 'breaker', 'reset'));
        expect(reset.state.power).toEqual({ breaker: true, generator: 'standby', cutAt: null, outSince: null });
        expect(of(reset.events, 'powerBack')).toEqual([]);
    });

    it('a disabled generator keeps the dark; disabling a running one puts the lights out again; resetting brings them back', () => {
        const { world, state } = lot();
        const off = same(world, state, use('mara', 'gen', 'disable'));
        expect(off.state.power.generator).toBe('disabled');
        expect(of(off.events, 'powerOut')).toEqual([]);
        expect(whyNot(world, off.state, use('mara', 'gen', 'disable'))).toBe('The generator is disabled already');
        const cut = same(world, off.state, use('jun', 'breaker', 'cut'));
        expect(of(cut.events, 'powerOut')).toEqual([{ type: 'powerOut', generatorAt: null }]);
        let s = cut.state;
        for (let i = 0; i < 5; i++) s = commit(world, s, endTurn).state;
        expect(litNow(world, s, P(3, 2))).toBe(false);
        const back = same(world, rested(s), use('jun', 'breaker', 'reset'));
        expect(of(back.events, 'powerBack')).toHaveLength(1);

        // Cut, wait for the generator, then disable it: dark again, a new outage.
        const { state: fresh } = lot();
        let t = commit(world, fresh, use('jun', 'breaker', 'cut')).state;
        for (let i = 0; i < 3; i++) t = commit(world, t, endTurn).state;
        expect(t.power.generator).toBe('running');
        const again = same(world, t, use('mara', 'gen', 'disable'));
        expect(of(again.events, 'powerOut')).toEqual([{ type: 'powerOut', generatorAt: null }]);
        expect(again.state.power.outSince).toBe(t.turn);
    });

    it('a bank without a generator has no backup', () => {
        const { world, state } = lot({ objects: [OBJECTS[0]!] });
        const cut = commit(world, state, use('jun', 'breaker', 'cut'));
        expect(of(cut.events, 'powerOut')).toEqual([{ type: 'powerOut', generatorAt: null }]);
        let s = cut.state;
        for (let i = 0; i < 4; i++) s = commit(world, s, endTurn).state;
        expect(litNow(world, s, P(3, 2))).toBe(false);
    });

    it('is an illegal act a staff member sees', () => {
        const { world, state } = lot({ people: [person('teller', P(3, 1), 'teller', 'staff')] });
        const r = commit(world, state, use('jun', 'breaker', 'cut'));
        expect(r.state.npcs[0]!.suspicion.jun ?? 0).toBeGreaterThan(0);
    });
});

describe('the dark (§14.6)', () => {
    it('halves sight on the building\'s tiles: a guard 5 tiles off sees a crew member only with the lights on', () => {
        const { world, state } = lot({ people: [person('guard', P(8, 2))] });
        const guard = npcObserver(world, state.npcs[0]!)!;
        expect(sees(world, state, guard, P(3, 2))).not.toBeNull();
        const cut = commit(world, state, use('jun', 'breaker', 'cut')).state;
        expect(sees(world, cut, guard, P(3, 2))).toBeNull();
        expect(sees(world, cut, guard, P(6, 2))).not.toBeNull();
    });

    it('halves combat sight too: the police see half as far onto a dark tile (§14.6)', () => {
        const { world, state } = lot();
        expect(seesTile(world, state, P(11, 2), P(3, 2))).toBe(true);
        const cut = commit(world, state, use('jun', 'breaker', 'cut')).state;
        expect(seesTile(world, cut, P(11, 2), P(3, 2))).toBe(false);
        expect(seesTile(world, cut, P(11, 2), P(7, 2))).toBe(true);
        // Onto the lit back lot as far as ever.
        expect(seesTile(world, cut, P(3, 2), P(12, 2))).toBe(true);
    });

    it('turns every camera off, whatever its tier', () => {
        const { world, state } = lot({ cameras: [{ id: 'cam', pos: P(9, 0), facings: ['s', 'w'], room: 'b', seesInDark: true }] });
        expect(cameraObserver(world, state, 'cam')).not.toBeNull();
        const cut = commit(world, state, use('jun', 'breaker', 'cut'));
        expect(cameraObserver(world, cut.state, 'cam')).toBeNull();
        // Nor does it pan in the dark.
        const after = commit(world, cut.state, endTurn);
        expect(of(after.events, 'cameraPanned')).toEqual([]);
        expect(after.state.cameras.cam!.facing).toBe(0);
    });

    it('releases staff doors\' maglocks while out; a Secure door stays locked', () => {
        const walls: FixtureWall[] = [
            ...[0, 1, 2, 3, 4].map(y => ({ between: [P(4, y), P(5, y)] as [Pos, Pos], ...(y === 2 ? { door: { id: 'staff', lock: 'keycard' as const, start: 'locked' as const } } : {}) })),
            ...[0, 1, 2, 3, 4].map(y => ({ between: [P(8, y), P(9, y)] as [Pos, Pos], ...(y === 2 ? { door: { id: 'secure', lock: 'keycard' as const, start: 'locked' as const } } : {}) }))
        ];
        const zones = Array.from({ length: 5 }, () => 'sssssssssxxx....');
        const { world, state } = lot({ walls, zones, crew: [{ id: 'jun', pos: P(1, 1), items: [] }, { id: 'mara', pos: P(4, 2), items: [] }] });
        expect(doorStatus(world, state, 'staff')).toBe('locked');
        const cut = commit(world, state, use('jun', 'breaker', 'cut')).state;
        expect(doorStatus(world, cut, 'staff')).toBe('closed');
        expect(doorStatus(world, cut, 'secure')).toBe('locked');
        expect(whyNot(world, cut, { type: 'door', crew: 'mara', door: 'staff', action: 'open' })).toBeUndefined();
        expect(whyNot(world, cut, { type: 'door', crew: 'mara', door: 'staff', action: 'lock' })).toBe('The maglock has no power');
        // Walked through without a card.
        const reach = reachable(world, cut, P(4, 2), 6, { mover: 'mara', canPassDoor: (_d, status) => status === 'closed' });
        expect(reach.tiles.some(t => t.pos.x === 5 && t.pos.y === 2)).toBe(true);
        // The power back, it holds again.
        const back = commit(world, rested(cut), use('jun', 'breaker', 'reset')).state;
        expect(doorStatus(world, back, 'staff')).toBe('locked');
    });

    it('darkens the vault console: no code during an outage', () => {
        const { world, state } = lot();
        expect(vaultShut(world, state)).toBeUndefined();
        const cut = commit(world, state, use('jun', 'breaker', 'cut')).state;
        expect(vaultShut(world, cut)).toBe('The console is dark: the power is out');
    });
});

describe('lights out (§8.13 minor evidence bank-wide)', () => {
    it('every staff member and guard in the building notices it, unseen; a guard walks to the breaker, the others look', () => {
        const people = [
            person('guard', P(10, 4), 'guard', 'enforcer', 'e'),
            person('teller', P(9, 0), 'teller', 'staff', 'e'),
            person('customer', P(8, 4), 'customer', 'civilian', 'e'),
            person('smoker', P(15, 4), 'teller', 'staff', 'e')
        ];
        const { world, state } = lot({ people });
        const cut = commit(world, state, use('jun', 'breaker', 'cut')).state;
        expect(evidenceOnMap(world, cut)).toEqual([{ id: `lightsOut:${state.turn}`, kind: 'lightsOut', tiles: [P(1, 0)], everywhere: true }]);
        const world1 = commit(world, cut, endTurn);
        const noticed = of(world1.events, 'evidenceNoticed').map(e => e.npc).sort();
        expect(noticed).toEqual(['guard', 'teller']);
        const npc = (id: string) => world1.state.npcs.find(n => n.id === id)!;
        expect(npc('guard').goal).toMatchObject({ kind: 'inspect', tile: P(1, 0) });
        expect(npc('guard').intent.path.length).toBeGreaterThan(0);
        expect(npc('teller').goal).toMatchObject({ kind: 'look' });
        expect(npc('customer').evidence).toBeNull();
        expect(npc('smoker').evidence).toBeNull();
        // Once the generator is on, it is gone and forgotten.
        let s = world1.state;
        for (let i = 0; i < 2; i++) s = commit(world, s, endTurn).state;
        expect(evidenceOnMap(world, s)).toEqual([]);
        expect(s.npcs.every(n => !n.noticed.some(id => id.startsWith('lightsOut')))).toBe(true);
    });
});

describe('the power grid in the game', () => {
    it('saves and loads, and refuses a save from before it', () => {
        const { world, state } = lot();
        const cut = commit(world, state, use('jun', 'breaker', 'cut')).state;
        expect(deserialiseState(serialiseState({ state: cut }), world).state).toEqual(cut);
        const old = clonePlain(cut) as Partial<State>;
        delete old.power;
        expect(() => deserialiseState(serialiseState({ state: old as State }), world)).toThrow(/power/);
    });

    it('offers Cut power, Restore power and Disable generator on the grid, each legal, and tells them in the recap', () => {
        const { world, state } = lot();
        const menu = actionMenu(world, state, 'jun');
        expect(menu.find(e => e.id === 'interact:cut')).toMatchObject({ label: 'Cut power' });
        expect(menuIsLegal(world, state, 'jun', menu)).toBe(true);
        const gen = actionMenu(world, state, 'mara').find(e => e.id === 'interact:disable');
        expect(gen).toMatchObject({ label: 'Disable generator' });
        const cut = commit(world, state, use('jun', 'breaker', 'cut'));
        expect(cut.events.map(e => describeEvent(world, cut.state, e))).toEqual(expect.arrayContaining(['jun cut the power', `Lights out: the generator starts on turn ${state.turn + 3}`]));
        expect(actionMenu(world, cut.state, 'jun').find(e => e.id === 'interact:reset')).toMatchObject({ label: 'Restore power' });
    });
});
