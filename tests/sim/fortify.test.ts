import { describe, expect, it } from 'vitest';
import {
    clonePlain, commit, coverAgainst, deserialiseState, edgeBetween, edgeKey, edgeNow, fixtureWorld, hasLineOfSight, initialState, legalActions, OFFICER_STATS, patrolSightings, preview,
    reachable, serialiseState, shotFabric, shotMap, whyNot, type Command, type CrewStart, type FixtureOptions, type FixtureWall, type PersonDef, type PoliceKind, type Pos, type ReadonlyWorld,
    type SimEvent, type State
} from '../../src/sim';
import { actionMenu, menuIsLegal } from '../../src/game/actions';
import { describeEvent, threatLedger } from '../../src/game/views';

/*
 * M4-02, fortifying (GAME_DESIGN §14.3, §13.5; decisions 220–226): barricades on doors and windows, reinforcing Soft
 * walls and doors, blinds, and the police breaking barricades announced a phase ahead, like a breach.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const OPEN = Array.from({ length: 5 }, () => '................');
const endTurn = { type: 'endTurn' } as const;
const types = (events: readonly SimEvent[]): string[] => events.map(e => e.type);
const of = <K extends SimEvent['type']>(events: readonly SimEvent[], type: K) => events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
const key = (a: Pos, b: Pos): string => edgeKey(edgeBetween(a, b));
const fortify = (crew: string, edge: string, action: Extract<Command, { type: 'fortify' }>['action']): Command => ({ type: 'fortify', crew, edge, action });
const person = (id: string, pos: Pos, role = 'teller', observer: PersonDef['observer'] = 'staff'): PersonDef => ({ id, name: id, role, observer, pos, facing: 'w', schedule: [] });

/** A wall down the map between x = 5 and 6 with a door at row 2 (`lock`, `start`) and a window at row 0. */
function divided(lock: 'none' | 'mechanical' = 'none', start: 'closed' | 'locked' = 'closed'): FixtureWall[] {
    return [0, 1, 2, 3, 4].map(y => ({
        between: [P(5, y), P(6, y)] as [Pos, Pos],
        material: y === 0 ? 'glass' as const : 'soft' as const,
        ...(y === 2 ? { door: { id: 'd', lock, start } } : {})
    }));
}
const DOOR = key(P(5, 2), P(6, 2)), WINDOW = key(P(5, 0), P(6, 0)), WALL = key(P(5, 3), P(6, 3));

interface Setup extends FixtureOptions { crew?: CrewStart[] }

function quiet(options: Setup = {}): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(OPEN, { walls: divided(), ...options });
    return { world, state: clonePlain(initialState(world, { seed: 3, crew: options.crew ?? [{ id: 'jun', pos: P(5, 2), items: ['reinforcementKit'] }] })) };
}

/** A loud bank in Assault at `heat`, Jun known at (1, 2), an officer of `kind` at (9, 2). */
function loud(options: { heat?: number; kind?: PoliceKind; lock?: 'none' | 'mechanical'; start?: 'closed' | 'locked' } = {}): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(OPEN, { walls: divided(options.lock, options.start) });
    const s = clonePlain(initialState(world, { seed: 5, crew: [{ id: 'jun', pos: P(5, 2), items: ['pistol', 'reinforcementKit'] }] }));
    s.crew[0]!.loadout.masked = true;
    s.bank.alarm = true;
    s.bank.loud = true;
    s.response = { raised: s.turn - 5, by: 'tellerButton', policeIn: 0, heat: options.heat ?? 12 };
    s.police.sent = 5;
    s.police.mode = { kind: 'assault', left: 9, since: { turn: s.turn - 1, phase: 'world' }, after: null };
    s.police.known.jun = { tile: P(1, 2), turn: 0, down: false };
    const kind = options.kind ?? 'patrol';
    s.police.units.push({
        id: 'cop', kind, vehicle: null, staging: null, arrived: s.turn - 3, pos: P(9, 2), hp: OFFICER_STATS[kind].hp, leaning: null, suppressed: null, moved: null,
        team: null, watch: null, flashbangs: 0, surprised: null
    });
    return { world, state: s };
}

/** Jun steps back to (1, 2), out of the way, with his actions spent. */
function stepBack(state: State): State {
    const s = clonePlain(state);
    s.crew[0]!.pos = P(1, 2);
    return s;
}

describe('barricades (§14.3)', () => {
    it('block a door for everyone and its sight, for 1 action, and come down again with Clear', () => {
        const { world, state } = quiet({ crew: [{ id: 'jun', pos: P(5, 2), items: [] }, { id: 'mara', pos: P(6, 1), items: [] }] });
        state.doors.d = { status: 'open' };
        expect(whyNot(world, state, fortify('jun', DOOR, 'barricade'))).toMatch(/Close the door first/);
        state.doors.d = { status: 'closed' };
        const r = commit(world, state, fortify('jun', DOOR, 'barricade'));
        expect(r.state.edges[DOOR]).toEqual({ barricade: 2 });
        expect(r.state.crew[0]!.actionsLeft).toBe(1);
        expect(of(r.events, 'barricaded')).toEqual([{ type: 'barricaded', crew: 'jun', edge: DOOR }]);
        expect(r.events.find(e => e.type === 'noise')).toMatchObject({ kind: 'quiet', radius: 4 });
        // Nobody opens it or walks through it, from either side.
        expect(whyNot(world, r.state, { type: 'door', crew: 'jun', door: 'd', action: 'open' })).toMatch(/barricaded/);
        const reach = reachable(world, r.state, P(6, 1), 40, { mover: 'mara', canPassDoor: () => true });
        expect(reach.tiles.some(t => t.pos.x <= 5)).toBe(false);
        // An open door barricaded since would still block: the barricade wins over the door (edgeNow).
        const opened = clonePlain(r.state);
        opened.doors.d = { status: 'open' };
        expect(edgeNow(world, opened, DOOR)).toMatchObject({ blocksMove: true, blocksSight: true });
        expect(whyNot(world, r.state, fortify('jun', DOOR, 'barricade'))).toMatch(/already/);
        const cleared = commit(world, r.state, fortify('jun', DOOR, 'clear'));
        expect(cleared.state.edges[DOOR]).toBeUndefined();
        const rested = clonePlain(cleared.state);
        rested.crew[0]!.actionsLeft = 2;
        expect(whyNot(world, rested, { type: 'door', crew: 'jun', door: 'd', action: 'open' })).toBeUndefined();
    });

    it('on a window block sight, and bullets pass as half cover for the tiles either side', () => {
        const { world, state } = quiet({ crew: [{ id: 'jun', pos: P(5, 0), items: [] }] });
        expect(hasLineOfSight(world, state, P(3, 0), P(9, 0))).toBe(true);
        const body = { id: 'x', pos: P(5, 0), standing: true, shield: false, armour: 0, precise: false };
        const before = shotMap(world, state);
        expect(coverAgainst(before, shotFabric(world, state, before, state.cover), body, P(9, 0))).toBeNull();
        const r = commit(world, state, fortify('jun', WINDOW, 'barricade'));
        expect(hasLineOfSight(world, r.state, P(3, 0), P(9, 0))).toBe(false);
        const map = shotMap(world, r.state);
        expect(coverAgainst(map, shotFabric(world, r.state, map, r.state.cover), body, P(9, 0))).toMatchObject({ kind: 'edge', at: WINDOW });
        expect(coverAgainst(map, shotFabric(world, r.state, map, r.state.cover), { ...body, pos: P(6, 0) }, P(1, 0))).toMatchObject({ kind: 'edge', at: WINDOW });
    });

    it('need a door or a window, free hands, and the vault door is not one', () => {
        const { world, state } = quiet({ crew: [{ id: 'jun', pos: P(5, 3), items: [] }] });
        expect(whyNot(world, state, fortify('jun', WALL, 'barricade'))).toMatch(/door or a window/);
        expect(whyNot(world, state, fortify('jun', DOOR, 'barricade'))).toMatch(/isn't beside/);
        const held = clonePlain(state);
        held.crew[0]!.pos = P(5, 2);
        held.crew[0]!.loadout.carrying = 'lootBag';
        expect(whyNot(world, held, fortify('jun', DOOR, 'barricade'))).toMatch(/hands are full/);
        const vault = fixtureWorld(OPEN, { walls: [{ between: [P(5, 2), P(6, 2)], material: 'vault', door: { id: 'v', lock: 'vault', start: 'locked' } }] });
        const s = initialState(vault, { seed: 1, crew: [{ id: 'jun', pos: P(5, 2) }] });
        expect(whyNot(vault, s, fortify('jun', DOOR, 'barricade'))).toMatch(/vault/);
    });

    it('are suspicious to whoever sees them put up in stealth', () => {
        const { world, state } = quiet({ crew: [{ id: 'jun', pos: P(5, 0), items: [] }], people: [person('teller', P(8, 0))] });
        const r = commit(world, state, fortify('jun', WINDOW, 'barricade'));
        expect(r.events.find(e => e.type === 'suspicionRaised')).toMatchObject({ npc: 'teller', crew: 'jun', added: 2, why: ['barricade'] });
    });
});

describe('reinforcing (§14.3)', () => {
    it('makes a Soft wall Reinforced for 2 actions and a kit use: bullets stop there', () => {
        const { world, state } = quiet({ crew: [{ id: 'jun', pos: P(5, 3), items: ['reinforcementKit'] }] });
        expect(state.crew[0]!.reinforcements).toBe(2);
        const r = commit(world, state, fortify('jun', WALL, 'reinforce'));
        expect(r.state.crew[0]!.actionsLeft).toBe(0);
        expect(r.state.crew[0]!.reinforcements).toBe(1);
        expect(edgeNow(world, r.state, WALL)).toMatchObject({ material: 'reinforced', reinforced: true });
        expect(shotMap(world, r.state).edges.find(e => e.key === WALL)!.material).toBe('reinforced');
        expect(whyNot(world, r.state, fortify('jun', WALL, 'reinforce'))).toMatch(/actions left/);
        const next = clonePlain(r.state);
        next.crew[0]!.actionsLeft = 2;
        expect(whyNot(world, next, fortify('jun', WALL, 'reinforce'))).toMatch(/reinforced already/);
        next.crew[0]!.reinforcements = 0;
        next.crew[0]!.pos = P(5, 4);
        expect(whyNot(world, next, fortify('jun', key(P(5, 4), P(6, 4)), 'reinforce'))).toMatch(/no reinforcement kit/);
    });

    it('bars a door shut and refuses glass', () => {
        const { world, state } = quiet();
        const r = commit(world, state, fortify('jun', DOOR, 'reinforce'));
        r.state.crew[0]!.actionsLeft = 2;
        expect(whyNot(world, r.state, { type: 'door', crew: 'jun', door: 'd', action: 'open' })).toMatch(/reinforced shut/);
        expect(reachable(world, r.state, P(5, 2), 40, { mover: 'jun', canPassDoor: () => true }).tiles.some(t => t.pos.x >= 6)).toBe(false);
        const glass = clonePlain(state);
        glass.crew[0]!.pos = P(5, 0);
        expect(whyNot(world, glass, fortify('jun', WINDOW, 'reinforce'))).toMatch(/Soft/);
    });
});

describe('blinds (§14.3)', () => {
    // The street is row 4; the bank's front wall has one window, at x = 2.
    const front: FixtureWall[] = [0, 1, 2, 3, 4, 5].map(x => ({ between: [P(x, 3), P(x, 4)] as [Pos, Pos], material: x === 2 ? 'glass' as const : 'soft' as const }));
    const PANE = key(P(2, 3), P(2, 4));

    it('block the patrol car’s view from the street, quietly, and go up again', () => {
        const world = fixtureWorld(['......', '......', '......', '......', '......'], { walls: front, patrol: { lane: [0, 1, 2, 3, 4, 5].map(x => P(x, 4)), turns: [3] } });
        const state = clonePlain(initialState(world, { seed: 2, crew: [{ id: 'jun', pos: P(2, 3), items: [] }] }));
        state.crew[0]!.loadout.masked = true;
        expect(patrolSightings(world, state)).toMatchObject({ crew: 'jun' });
        const r = commit(world, state, fortify('jun', PANE, 'lowerBlinds'));
        expect(r.state.edges[PANE]).toEqual({ blinds: true });
        expect(types(r.events)).not.toContain('noise');
        expect(patrolSightings(world, r.state)).toBeNull();
        expect(whyNot(world, r.state, fortify('jun', PANE, 'lowerBlinds'))).toMatch(/down already/);
        const up = commit(world, r.state, fortify('jun', PANE, 'raiseBlinds'));
        expect(up.state.edges[PANE]).toBeUndefined();
        expect(whyNot(world, state, fortify('jun', key(P(1, 3), P(1, 4)), 'lowerBlinds'))).toMatch(/isn't beside|window/);
    });
});

describe('the police break barricades, announced like breaches (§13.5)', () => {
    it('an officer stops at a barricaded door, announces, strikes it twice a phase apart, each announced, then walks through', () => {
        const { world, state } = loud();
        const barred = stepBack(commit(world, state, fortify('jun', DOOR, 'barricade')).state);
        const one = commit(world, barred, endTurn);
        expect(of(one.events, 'breachAnnounced')).toEqual([{ type: 'breachAnnounced', door: 'd', unit: 'cop' }]);
        expect(one.state.police.units[0]!.pos).toEqual(P(6, 2));
        expect(threatLedger(one.state, world)).toContainEqual(expect.objectContaining({ id: 'breach:d', label: expect.stringMatching(/Barricade struck next phase/) }));
        const two = commit(world, one.state, endTurn);
        expect(of(two.events, 'barricadeStruck')).toEqual([{ type: 'barricadeStruck', door: 'd', edge: DOOR, unit: 'cop', left: 1 }]);
        expect(two.state.edges[DOOR]).toEqual({ barricade: 1 });
        // The strike that clears the way is announced through a crew phase too.
        expect(two.state.police.breaches).toEqual([{ door: 'd', unit: 'cop', turn: two.state.turn - 1 }]);
        expect(types(two.events)).not.toContain('doorBreached');
        const three = commit(world, two.state, endTurn);
        expect(of(three.events, 'barricadeStruck')).toEqual([{ type: 'barricadeStruck', door: 'd', edge: DOOR, unit: 'cop', left: 0 }]);
        expect(three.state.edges[DOOR]).toBeUndefined();
        expect(three.state.police.breaches).toEqual([]);
        expect(describeEvent(world, three.state, of(three.events, 'barricadeStruck')[0]!)).toMatch(/broke the barricade/);
        // The door behind was only closed: the officer walks on through it.
        const four = commit(world, three.state, endTurn);
        expect(four.state.police.units[0]!.pos!.x).toBeLessThan(6);
    });

    it('a barricade on a locked door goes first, then the door is breached, each announced', () => {
        const { world, state } = loud({ lock: 'mechanical', start: 'locked' });
        let s = stepBack(commit(world, state, fortify('jun', DOOR, 'barricade')).state);
        const seen: string[] = [];
        for (let k = 0; k < 6 && s.doors.d?.status !== 'breached'; k++) {
            const r = commit(world, s, endTurn);
            seen.push(...types(r.events).filter(t => t === 'breachAnnounced' || t === 'barricadeStruck' || t === 'doorBreached'));
            s = r.state;
        }
        expect(seen).toEqual(['breachAnnounced', 'barricadeStruck', 'breachAnnounced', 'barricadeStruck', 'breachAnnounced', 'doorBreached']);
    });

    it('below Heat 3 they leave a barricade be', () => {
        const { world, state } = loud({ heat: 5 });
        const barred = stepBack(commit(world, state, fortify('jun', DOOR, 'barricade')).state);
        const r = commit(world, barred, endTurn);
        expect(types(r.events)).not.toContain('breachAnnounced');
    });

    it('only heavy SWAT open a reinforced door, which goes with the breach', () => {
        const patrol = loud();
        const shut = stepBack(commit(patrol.world, patrol.state, fortify('jun', DOOR, 'reinforce')).state);
        const r = commit(patrol.world, shut, endTurn);
        expect(types(r.events)).not.toContain('breachAnnounced');
        const heavy = loud({ kind: 'heavy' });
        let s = stepBack(commit(heavy.world, heavy.state, fortify('jun', DOOR, 'reinforce')).state);
        const one = commit(heavy.world, s, endTurn);
        expect(of(one.events, 'breachAnnounced')).toEqual([{ type: 'breachAnnounced', door: 'd', unit: 'cop' }]);
        s = commit(heavy.world, one.state, endTurn).state;
        expect(s.doors.d!.status).toBe('breached');
        expect(s.edges[DOOR]).toBeUndefined();
    });

    it('a door reinforced after a patrol officer announced its breach: called off', () => {
        const { world, state } = loud({ lock: 'mechanical', start: 'locked' });
        const one = commit(world, stepBack(state), endTurn);
        expect(types(one.events)).toContain('breachAnnounced');
        const back = clonePlain(one.state);
        back.crew[0]!.pos = P(5, 2);
        const shut = stepBack(commit(world, back, fortify('jun', DOOR, 'reinforce')).state);
        const two = commit(world, shut, endTurn);
        expect(of(two.events, 'breachCalledOff')).toEqual([{ type: 'breachCalledOff', door: 'd', unit: 'cop' }]);
        expect(two.state.doors.d?.status ?? 'locked').toBe('locked');
    });
});

describe('fortifying in the engine and the grid', () => {
    it('previews exactly as it commits, is in legalActions, and saves', () => {
        const { world, state } = quiet();
        for (const cmd of [fortify('jun', DOOR, 'barricade'), fortify('jun', DOOR, 'reinforce')]) {
            const p = preview(world, state, cmd), c = commit(world, state, cmd);
            expect(p.state).toEqual(c.state);
            expect(p.events).toEqual(c.events);
        }
        expect(legalActions(world, state, 'jun')).toContainEqual(fortify('jun', DOOR, 'barricade'));
        const r = commit(world, state, fortify('jun', DOOR, 'barricade'));
        expect(deserialiseState(serialiseState({ state: r.state }), world).state).toEqual(r.state);
        const old = clonePlain(r.state) as Partial<State['crew'][number]> & State;
        delete (old.crew[0] as Partial<State['crew'][number]>).reinforcements;
        expect(() => deserialiseState(serialiseState({ state: old }), world)).toThrow(/reinforcements/);
    });

    it('offers Barricade and Reinforce on the door, Blinds and Barricade on a window, and Clear once barricaded', () => {
        const { world, state } = quiet();
        const menu = actionMenu(world, state, 'jun');
        expect(menu.map(e => e.id)).toEqual(expect.arrayContaining(['fortify:barricade', 'fortify:reinforce']));
        expect(menuIsLegal(world, state, 'jun', menu)).toBe(true);
        const r = commit(world, state, fortify('jun', DOOR, 'barricade'));
        expect(actionMenu(world, r.state, 'jun').map(e => e.id)).toContain('fortify:clear');
        const atWindow = clonePlain(state);
        atWindow.crew[0]!.pos = P(5, 0);
        expect(actionMenu(world, atWindow, 'jun').map(e => e.label)).toEqual(expect.arrayContaining(['Blinds down', 'Barricade']));
    });
});
