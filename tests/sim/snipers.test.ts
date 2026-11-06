import { describe, expect, it } from 'vitest';
import {
    clonePlain, commit, fixtureWorld, initialState, OFFICER_STATS, projectEvents, sniperLasers, sniperPosts,
    type FixtureWall, type PersonDef, type PoliceMode, type Pos, type SimEvent, type State
} from '../../src/sim';

/*
 * M4-05, police snipers (GAME_DESIGN §13.4–13.6, §14.5, §14.7): posts outside the building that see its windows,
 * raised first; the laser a world phase before the shot; the shot only at the one lasered, still in sight, and never
 * through a standing bystander; the laser always told.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const endTurn = { type: 'endTurn' } as const;
const of = <K extends SimEvent['type']>(events: readonly SimEvent[], type: K) => events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);

// The bank (b, columns 0–6) behind a glass front; outside (o), a raised floor in the corner with its two stairs.
const MAP = ['..............^^', '..............^^', '..............//', '................', '................'];
const ROOMS = MAP.map(() => 'bbbbbbbooooooooo');
const GLASS: FixtureWall[] = [0, 1, 2, 3, 4].map(y => ({ between: [P(6, y), P(7, y)] as [Pos, Pos], material: 'glass' as const }));
// A wall inside the bank to hide behind, between columns 1 and 2, open at row 4.
const INNER: FixtureWall[] = [0, 1, 2, 3].map(y => ({ between: [P(1, y), P(2, y)] as [Pos, Pos], material: 'reinforced' as const }));

const person = (id: string, pos: Pos): PersonDef => ({
    id, name: id, role: 'customer', observer: 'civilian', pos, facing: 'n',
    schedule: [{ from: 1, activity: 'wait', label: 'waiting', room: '', at: pos, facing: 'n' }]
});

function setup(options: { people?: PersonDef[]; mode?: PoliceMode; jun?: Pos } = {}): { world: ReturnType<typeof fixtureWorld>; state: State } {
    const world = fixtureWorld(MAP, {
        rooms: ROOMS, building: ['b'], walls: [...GLASS, ...INNER], people: options.people ?? [],
        staging: [{ id: 'st', name: 'Street end', pos: P(15, 4) }]
    });
    const s = clonePlain(initialState(world, { seed: 5, crew: [{ id: 'jun', pos: options.jun ?? P(4, 2), items: ['pistol'] }] }));
    for (const c of s.crew) c.loadout.masked = true;
    s.bank.alarm = true;
    s.bank.loud = true;
    s.response = { raised: s.turn - 5, by: 'tellerButton', policeIn: 0, heat: 5 };
    s.police.sent = 5;
    s.police.mode = { kind: options.mode ?? 'contain', left: 9, since: { turn: s.turn - 1, phase: 'world' }, after: null };
    return { world, state: s };
}

function sniper(state: State, id: string, pos: Pos | null): void {
    state.police.units.push({
        id, kind: 'sniper', vehicle: null, staging: 'st', arrived: state.turn - 3, pos, hp: OFFICER_STATS.sniper.hp, leaning: null, suppressed: null, moved: null,
        team: null, watch: null, flashbangs: 0, surprised: null
    });
}

const unit = (s: State, id: string) => s.police.units.find(u => u.id === id)!;

describe('police snipers', () => {
    it('walk in to the best post outside the building: raised, seeing the windows, nearest their staging point', () => {
        const { world, state } = setup();
        const posts = sniperPosts(world);
        expect(posts[0]!.raised).toBe(true);
        expect(posts.every(p => p.pos.x >= 7)).toBe(true);
        sniper(state, 's1', null);
        sniper(state, 's2', null);
        const r = commit(world, state, endTurn);
        expect(of(r.events, 'policeDeployed').map(e => [e.unit, e.pos])).toEqual([['s1', P(15, 1)], ['s2', P(14, 1)]]);
        // A world without a building has no posts: they stay by their staging point.
        expect(sniperPosts(fixtureWorld(MAP))).toEqual([]);
    });

    it('put the laser on a crew member in sight a world phase before they fire, and fire if they are still there', () => {
        const { world, state } = setup();
        sniper(state, 's1', P(15, 1));
        const aim = commit(world, state, endTurn);
        expect(of(aim.events, 'sniperAimed')).toEqual([{ type: 'sniperAimed', sniper: 's1', from: P(15, 1), target: 'jun', at: P(4, 2) }]);
        expect(of(aim.events, 'fighterFired')).toEqual([]);
        expect(unit(aim.state, 's1').laser).toEqual({ target: 'jun', at: P(4, 2), turn: 1 });
        expect(sniperLasers(aim.state)).toEqual([{ sniper: 's1', from: P(15, 1), target: 'jun', at: P(4, 2), turn: 1 }]);
        // Told even though the sniper is beyond the crew's sight (§13.6): the line is visible from anywhere.
        expect(of(projectEvents(world, aim.state, aim.events, state), 'sniperAimed')).toHaveLength(1);
        // Jun moves but stays in view: the shot comes.
        const moved = commit(world, aim.state, { type: 'move', crew: 'jun', path: [P(4, 3)] }).state;
        const shot = commit(world, moved, endTurn);
        expect(of(shot.events, 'fighterFired')).toEqual([{ type: 'fighterFired', shooter: 's1', target: 'jun', weapon: 'dmr', bullets: 1, at: P(4, 3) }]);
    });

    it('lose the shot when the crew member gets out of sight in the crew phase', () => {
        const { world, state } = setup({ jun: P(2, 4) });
        sniper(state, 's1', P(15, 1));
        const aim = commit(world, state, endTurn);
        expect(unit(aim.state, 's1').laser?.target).toBe('jun');
        // Behind the inner wall.
        const hidden = commit(world, aim.state, { type: 'move', crew: 'jun', path: [P(1, 4), P(0, 3), P(0, 2)] }).state;
        const r = commit(world, hidden, endTurn);
        expect(of(r.events, 'fighterFired')).toEqual([]);
        expect(of(r.events, 'sniperAimOff')).toEqual([{ type: 'sniperAimOff', sniper: 's1' }]);
        expect(unit(r.state, 's1').laser).toBeUndefined();
    });

    it('hold fire in Negotiate, the laser still on', () => {
        const talks = setup({ mode: 'negotiate' });
        sniper(talks.state, 's1', P(15, 1));
        const a = commit(talks.world, talks.state, endTurn);
        expect(of(a.events, 'sniperAimed')).toHaveLength(1);
        expect(of(commit(talks.world, a.state, endTurn).events, 'fighterFired')).toEqual([]);
    });

    it('hold fire with a bystander in the line', () => {
        const { world, state } = setup({ people: [person('ann', P(5, 2))], jun: P(3, 2) });
        sniper(state, 's1', P(13, 2));
        // From (13, 2) on the ground, straight along row 2: Ann at (5, 2) stands in front of Jun at (3, 2).
        state.police.units[0]!.laser = { target: 'jun', at: P(3, 2), turn: 0 };
        const r = commit(world, state, endTurn);
        expect(of(r.events, 'fighterFired')).toEqual([]);
        expect(of(r.events, 'heldFire')).toEqual([{ type: 'heldFire', shooter: 's1', target: 'jun', why: 'body', blockers: ['ann'] }]);
    });
});
