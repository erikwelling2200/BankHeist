import { describe, expect, it } from 'vitest';
import {
    clonePlain, commit, fixtureWorld, initialState, newTeam, OFFICER_FLASHBANGS, OFFICER_STATS, policeDown, preview, projectPreviewEvents, seenWedges,
    type Command, type CrewStart, type FixtureOptions, type FixtureWall, type Material, type PoliceKind, type PoliceMode, type Pos, type ReadonlyWorld, type SimEvent, type State
} from '../../src/sim';
import { coverAgainst, shotFabric, shotMap } from '../../src/sim/geo/shot';
import { registerTestCommand, testCommand } from './helpers';

/*
 * M3-06, SWAT team play (GAME_DESIGN §13.6 "SWAT: a coordinated team", §11.8, §11.10; decisions 180–186): one plan a
 * world phase, fire and movement, focus fire, flanking, Watch wedges held through the crew phase, flashbangs that land a
 * phase before they go off, timed breaches with a flashbang first, and pulling back from a casualty.
 */

const P = (x: number, y: number): Pos => ({ x, y });

registerTestCommand('testSwatDown', (ctx, cmd) => policeDown(ctx, (cmd as unknown as { unit: string }).unit, true));

const OPEN = Array.from({ length: 5 }, () => '................');
const endTurn = { type: 'endTurn' } as const;
const types = (events: readonly SimEvent[]): string[] => events.map(e => e.type);
const of = <K extends SimEvent['type']>(events: readonly SimEvent[], type: K) => events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);

interface Setup extends FixtureOptions { crew?: CrewStart[]; heat?: number; mode?: PoliceMode }

/** A loud bank after the Alarm, the police in `mode` (9 phases left), no more waves coming; the crew masked. */
function setup(map: readonly string[], options: Setup = {}): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(map, options);
    const s = clonePlain(initialState(world, { seed: 5, crew: options.crew ?? [{ id: 'jun', pos: P(1, 2), items: ['pistol'] }] }));
    for (const c of s.crew) c.loadout.masked = true;
    s.bank.alarm = true;
    s.bank.loud = true;
    s.response = { raised: s.turn - 5, by: 'tellerButton', policeIn: 0, heat: options.heat ?? 12 };
    s.police.sent = 5;
    s.police.mode = { kind: options.mode ?? 'assault', left: 9, since: { turn: s.turn - 1, phase: 'world' }, after: null };
    return { world, state: s };
}

/** A SWAT team `id` of `members` (id, tile, kind), in that order. */
function team(state: State, id: string, members: [string, Pos, PoliceKind?][]): void {
    state.police.teams[id] = newTeam();
    for (const [unit, pos, kind = 'swat'] of members) {
        state.police.units.push({
            id: unit, kind, vehicle: null, staging: null, arrived: state.turn - 3, pos, hp: OFFICER_STATS[kind].hp, leaning: null, suppressed: null, moved: null,
            team: id, watch: null, flashbangs: OFFICER_FLASHBANGS[kind], surprised: null
        });
    }
}

const unit = (state: State, id: string) => state.police.units.find(u => u.id === id)!;
const movedUnits = (events: readonly SimEvent[]): string[] => [...new Set(of(events, 'policeMoved').map(e => e.unit))].sort();

describe('a SWAT team plan (§13.6)', () => {
    it('moves half the team while the other half covers the known position with Watch wedges', () => {
        const { world, state } = setup(OPEN, { crew: [{ id: 'jun', pos: P(0, 2), items: ['pistol'] }] });
        team(state, 't', [['a', P(14, 1), 'swatShield'], ['b', P(15, 1)], ['c', P(14, 3)], ['d', P(15, 3)]]);
        state.police.known.jun = { tile: P(0, 2), turn: 0, down: false };
        const r = commit(world, state, endTurn), plan = r.state.police.teams.t!;
        expect(plan.planned).toBe(state.turn);
        expect(plan.movers.length).toBe(2);
        expect(movedUnits(r.events)).toEqual([...plan.movers].sort());
        // The coverers lock the angle on where the crew was last seen: the gun's Watch arc (AR 45°, the shield's pistol 60°).
        const coverers = ['a', 'b', 'c', 'd'].filter(id => !plan.movers.includes(id));
        for (const id of coverers) expect(unit(r.state, id).watch).toMatchObject({ at: P(0, 2), arc: unit(r.state, id).kind === 'swatShield' ? 60 : 45, turn: state.turn, tripped: null });
        expect(of(r.events, 'policeWatching').map(e => e.unit).sort()).toEqual(coverers.sort());
        // The next phase the halves swap.
        const next = commit(world, r.state, endTurn).state.police.teams.t!;
        expect(next.movers.sort()).toEqual(coverers.sort());
    });

    it('focuses fire on one target by priority: the one out in the open before the nearer one in cover', () => {
        const map = ['................', '.......#........', '................', '................', '................'];
        const { world, state } = setup(map, {
            mode: 'contain',
            crew: [{ id: 'jun', pos: P(6, 1), items: ['pistol'] }, { id: 'mara', pos: P(3, 3), items: ['pistol'] }]
        });
        team(state, 't', [['a', P(12, 1)], ['b', P(12, 3)]]);
        const r = commit(world, state, endTurn);
        expect(r.state.police.teams.t!.focus).toBe('mara');
        const fired = of(r.events, 'fighterFired');
        expect(fired.length).toBeGreaterThan(0);
        expect(new Set(fired.map(e => e.target))).toEqual(new Set(['mara']));
    });

    it('a mover flanks: it fires from where the target has no cover against it', () => {
        // Jun behind a counter facing east; the team comes from the east.
        const map = ['................', '................', '..#.............', '................', '................'];
        const { world, state } = setup(map, { crew: [{ id: 'jun', pos: P(1, 2), items: ['pistol'] }] });
        team(state, 't', [['a', P(5, 2)]]);
        const sMap = shotMap(world, state), fabric = shotFabric(world, state, sMap, state.cover);
        const body = { id: 'jun', pos: P(1, 2), standing: true, shield: false, armour: 0, precise: false };
        expect(coverAgainst(sMap, fabric, body, P(5, 2))).not.toBeNull();
        const r = commit(world, state, endTurn);
        const fired = of(r.events, 'fighterFired');
        expect(fired.map(e => e.shooter)).toEqual(['a']);
        expect(coverAgainst(sMap, fabric, body, unit(r.state, 'a').pos!)).toBeNull();
    });
});

describe('police Watch wedges (§13.6 "locking down angles", §11.8)', () => {
    // Jun hides behind the pillar at (3, 0)–(3, 1); the gap in the pillars is row 2.
    const PILLARS = ['...T............', '...T............', '................', '...T............', '...T............'];

    function covered() {
        const { world, state } = setup(PILLARS, { mode: 'contain', crew: [{ id: 'jun', pos: P(1, 0), items: ['pistol'] }] });
        team(state, 't', [['a', P(10, 2)]]);
        // Last seen behind the pillar, where the officer can't see.
        state.police.known.jun = { tile: P(1, 1), turn: 0, down: false };
        const r = commit(world, state, endTurn);
        return { world, state: r.state, events: r.events };
    }

    it('are set on the known position and held through the crew phase; crossing one draws its volley as the world phase starts', () => {
        const { world, state, events } = covered();
        expect(of(events, 'policeWatching')).toEqual([{ type: 'policeWatching', unit: 'a', at: P(1, 1), arc: 45 }]);
        // Jun steps out into the gap: the wedge takes him there.
        const moved = commit(world, state, { type: 'move', crew: 'jun', path: [P(1, 1), P(2, 2)] }).state;
        expect(unit(moved, 'a').watch!.tripped).toEqual({ crew: 'jun', at: P(2, 2) });
        // Stepping back behind the pillar doesn't save him: the volley is aimed where he crossed.
        const back = commit(world, moved, { type: 'move', crew: 'jun', path: [P(1, 1)] }).state;
        const r = commit(world, back, endTurn);
        const first = of(r.events, 'fighterFired')[0]!;
        expect(first).toMatchObject({ shooter: 'a', target: 'jun', weapon: 'assaultRifle', bullets: 2, at: P(2, 2) });
        expect(r.state.shots.at(-1)!.shot).toMatchObject({ shooter: 'a', at: P(2, 2), aimFactor: 1.5 });
        // The wedge came down with its volley; a new one is set as the officer acts.
        expect(types(r.events).indexOf('fighterFired')).toBeLessThan(types(r.events).lastIndexOf('policeWatching'));
    });

    it('a move that stays out of the wedge trips nothing, and the wedge fires at nobody', () => {
        const { world, state } = covered();
        const moved = commit(world, state, { type: 'move', crew: 'jun', path: [P(0, 0)] }).state;
        expect(unit(moved, 'a').watch!.tripped).toBeNull();
        expect(of(commit(world, moved, endTurn).events, 'fighterFired')).toEqual([]);
    });

    it('tell the crew nothing of a hidden officer: the move previews the same, and its wedge isn\'t shown', () => {
        const { world, state } = covered();
        expect(seenWedges(world, state)).toEqual([]);
        const gone = clonePlain(state);
        gone.police.units = [];
        const cmd: Command = { type: 'move', crew: 'jun', path: [P(1, 1), P(2, 2)] };
        const a = preview(world, state, cmd), b = preview(world, gone, cmd);
        expect(a.undoable).toBe(b.undoable);
        expect(projectPreviewEvents(world, state, a)).toEqual(projectPreviewEvents(world, gone, b));
        // In sight, it is shown.
        const seen = commit(world, state, { type: 'move', crew: 'jun', path: [P(1, 1), P(2, 2)] }).state;
        expect(seenWedges(world, seen)).toEqual([{ unit: 'a', at: P(1, 1), arc: 45 }]);
    });

    it('come down in Negotiate, where the police hold fire', () => {
        const { world, state } = covered();
        const talks = clonePlain(state);
        talks.police.mode = { kind: 'negotiate', left: 3, since: { turn: talks.turn - 1, phase: 'world' }, after: 'contain' };
        const moved = commit(world, talks, { type: 'move', crew: 'jun', path: [P(1, 1), P(2, 2)] }).state;
        expect(of(commit(world, moved, endTurn).events, 'fighterFired')).toEqual([]);
    });
});

describe('SWAT kit (§13.6 "using their kit", §11.10)', () => {
    it('a flashbang on clustered crew lands a phase before it goes off, and costs the crew their Watch', () => {
        const { world, state } = setup(OPEN, {
            crew: [{ id: 'jun', pos: P(4, 2), items: ['pistol'] }, { id: 'mara', pos: P(4, 3), items: ['pistol'] }]
        });
        team(state, 't', [['a', P(9, 2)]]);
        const r = commit(world, state, endTurn);
        const landed = of(r.events, 'policeGrenade');
        expect(landed).toHaveLength(1);
        expect(landed[0]).toMatchObject({ kind: 'flashbang', radius: 2 });
        expect(types(r.events)).not.toContain('grenadeWentOff');
        expect(r.state.grenades).toEqual([{ id: landed[0]!.grenade, kind: 'flashbang', by: 'a', at: landed[0]!.at, turn: state.turn + 1 }]);
        expect(unit(r.state, 'a').flashbangs).toBe(0);
        // The crew phase: Mara stays and watches, Jun gets out of its reach.
        let s = commit(world, r.state, { type: 'move', crew: 'jun', path: [P(3, 2), P(2, 2), P(1, 2)] }).state;
        s = commit(world, s, { type: 'watch', crew: 'mara', at: P(9, 2), arc: 60 }).state;
        const off = commit(world, s, endTurn);
        expect(of(off.events, 'grenadeWentOff').map(e => e.grenade)).toEqual([landed[0]!.grenade]);
        expect(of(off.events, 'crewFlashed').map(e => e.crew)).toEqual(['mara']);
        expect(of(off.events, 'watchEnded')[0]).toEqual({ type: 'watchEnded', crew: 'mara', fired: false });
        expect(of(off.events, 'attacked').filter(e => e.mode === 'watch')).toEqual([]);
    });

    it('a crew flashbang costs an officer its phase', () => {
        const { world, state } = setup(OPEN, { crew: [{ id: 'jun', pos: P(4, 2), items: ['pistol', 'flashbang'] }] });
        team(state, 't', [['a', P(8, 2)]]);
        const thrown = commit(world, state, { type: 'throwGrenade', crew: 'jun', item: 'flashbang', to: P(8, 2) }).state;
        const r = commit(world, thrown, endTurn);
        expect(of(r.events, 'officerFlashed')).toEqual([{ type: 'officerFlashed', unit: 'a', by: 'jun' }]);
        expect(of(r.events, 'fighterFired')).toEqual([]);
        expect(of(r.events, 'policeMoved')).toEqual([]);
    });
});

/** A wall down between columns 5 and 6 with two locked doors, at rows 1 and 3. */
const TWO_DOORS: FixtureWall[] = [0, 1, 2, 3, 4].map(y => ({
    between: [P(5, y), P(6, y)] as [Pos, Pos], material: (y === 1 || y === 3 ? 'doorWood' : 'plaster') as Material,
    ...(y === 1 || y === 3 ? { door: { id: `d${y}`, lock: 'mechanical' as const, start: 'locked' as const } } : {})
}));

describe('timed breaches (§13.6)', () => {
    it('stack at two doors and are announced together, blown in the same phase with a flashbang first, the team holding', () => {
        const { world, state } = setup(OPEN, { walls: TWO_DOORS, crew: [{ id: 'jun', pos: P(1, 2), items: ['pistol'] }] });
        team(state, 't', [['a', P(7, 1)], ['b', P(7, 3)]]);
        state.police.known.jun = { tile: P(1, 2), turn: 0, down: false };
        // Each member alone moves in its phase: a stacks first (b covers), and waits; b stacks next phase.
        let s = state, announced: SimEvent[] = [], phases = 0;
        while (!announced.length && phases < 4) {
            const r = commit(world, s, endTurn);
            announced = of(r.events, 'breachAnnounced');
            s = r.state;
            phases++;
        }
        expect(announced.length).toBeGreaterThan(0);
        const markers = s.police.breaches;
        expect(markers.every(b => b.turn === s.turn - 1)).toBe(true);
        // Next world phase: every marker blown, each by its officer, a flashbang thrown through, nobody moving on.
        const r = commit(world, s, endTurn);
        expect(of(r.events, 'doorBreached').map(e => [e.door, e.unit]).sort()).toEqual(markers.map(b => [b.door, b.unit]).sort());
        // A flashbang through at least one of them (a second where it would catch the first's officer isn't thrown).
        expect(of(r.events, 'policeGrenade').length).toBeGreaterThan(0);
        expect(r.state.police.teams.t!.movers).toEqual([]);
        expect(of(r.events, 'policeMoved')).toEqual([]);
    });

    it('a member stacked alone waits a phase, then announces', () => {
        const { world, state } = setup(OPEN, { walls: TWO_DOORS, crew: [{ id: 'jun', pos: P(1, 1), items: ['pistol'] }] });
        team(state, 't', [['a', P(6, 1)], ['b', P(15, 4)]]);
        state.police.known.jun = { tile: P(1, 1), turn: 0, down: false };
        state.police.teams.t!.stack = [];
        let s = state;
        let first: SimEvent[] = [];
        for (let k = 0; k < 3 && !first.length; k++) {
            const r = commit(world, s, endTurn);
            first = of(r.events, 'breachAnnounced');
            if (!first.length) expect(r.state.police.teams.t!.stack.length).toBeLessThanOrEqual(1);
            s = r.state;
        }
        expect(first).toEqual([{ type: 'breachAnnounced', door: 'd1', unit: 'a' }]);
    });
});

describe('casualties (§13.6)', () => {
    it('a member down: the team pulls back a step and covers, then re-plans', () => {
        const { world, state } = setup(OPEN, { crew: [{ id: 'jun', pos: P(0, 2), items: ['pistol'] }] });
        team(state, 't', [['a', P(12, 1)], ['b', P(13, 2)], ['c', P(12, 3)]]);
        state.police.known.jun = { tile: P(0, 2), turn: 0, down: false };
        const down = commit(world, state, testCommand({ type: 'testSwatDown', unit: 'c' } as never)).state;
        expect(down.police.teams.t!.lost).toBe(down.turn);
        const r = commit(world, down, endTurn), plan = r.state.police.teams.t!;
        expect(plan.pulling).toBe(true);
        expect(plan.movers).toEqual([]);
        // Each one step back (east, away from the crew), then covering.
        for (const id of ['a', 'b']) {
            const was = unit(down, id).pos!, now = unit(r.state, id).pos!;
            expect(Math.max(Math.abs(now.x - was.x), Math.abs(now.y - was.y))).toBe(1);
            expect(now.x).toBeGreaterThan(was.x);
            expect(unit(r.state, id).watch).toMatchObject({ at: P(0, 2) });
        }
        const again = commit(world, r.state, endTurn).state.police.teams.t!;
        expect(again.pulling).toBe(false);
        expect(again.movers.length).toBe(1);
    });

    it('a team with nobody left is gone', () => {
        const { world, state } = setup(OPEN);
        team(state, 't', [['a', P(12, 1)]]);
        expect(commit(world, state, testCommand({ type: 'testSwatDown', unit: 'a' } as never)).state.police.teams).toEqual({});
    });
});
