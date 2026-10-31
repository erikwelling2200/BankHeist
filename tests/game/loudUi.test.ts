import { describe, expect, it } from 'vitest';
import {
    attackCone, clonePlain, fixtureWorld, initialState, OFFICER_FLASHBANGS, OFFICER_STATS, officerMarkers, updateKnowledge, type FixtureOptions, type PersonDef, type PoliceKind,
    type Pos, type ReadonlyWorld, type State
} from '../../src/sim';
import { aimView, breachMarkers, fireSelector, policeMarkers } from '../../src/game/loudUi';

/*
 * M3-09's first half (UI.md "Loud"): the aim view, the police markers and ghosts, the breach markers and the fire
 * selector, all drawn from what the crew knows only.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const person = (id: string, pos: Pos, role = 'customer', observer: PersonDef['observer'] = 'civilian'): PersonDef => ({ id, name: id, role, observer, pos, facing: 's', schedule: [] });
const OPEN = ['............', '............', '............'];

function loud(map: readonly string[], options: FixtureOptions & { jun?: Pos; gun?: string } = {}): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(map, options);
    const state = clonePlain(initialState(world, { seed: 3, crew: [{ id: 'jun', pos: options.jun ?? P(0, 1), items: [options.gun ?? 'assaultRifle'] }] }));
    for (const c of state.crew) c.loadout.masked = true;
    state.bank.alarm = true;
    state.bank.loud = true;
    return { world, state };
}

function officer(state: State, id: string, pos: Pos, kind: PoliceKind = 'patrol'): void {
    state.police.units.push({
        id, kind, vehicle: null, staging: null, arrived: state.turn - 1, pos, hp: OFFICER_STATS[kind].hp, leaning: null, suppressed: null, moved: null,
        team: null, watch: null, flashbangs: OFFICER_FLASHBANGS[kind], surprised: null
    });
}

/** The crew's knowledge brought up to date, as a commit does (`worldPhase`: the phase's end, which resets what is fresh). */
const look = (world: ReadonlyWorld, state: State, worldPhase = false) => updateKnowledge(world, state, () => {}, { worldPhase });

describe('police markers (§13.6, UI.md "Police: announced versus visible")', () => {
    // A reinforced wall between x 5 and 6, rows 0–2: nothing seen or shot through it.
    const walls = [0, 1, 2].map(y => ({ between: [P(5, y), P(6, y)] as [Pos, Pos], material: 'reinforced' as const }));

    it('shows an officer the crew sees, a ghost where it saw one last, and nothing of one it never saw', () => {
        const { world, state } = loud(OPEN, { walls });
        officer(state, 'seen', P(3, 1));
        officer(state, 'unseen', P(8, 1), 'swat');
        look(world, state);
        expect(officerMarkers(world, state)).toEqual([{ id: 'seen', kind: 'patrol', pos: P(3, 1), live: true, seenAgo: 0 }]);
        // Jun steps behind the wall, a world phase passes: the officer he saw is a ghost where he last stood.
        state.crew[0]!.pos = P(9, 1);
        state.turn++;
        look(world, state, true);
        expect(policeMarkers(world, state).map(m => [m.id, m.live, m.seenAgo])).toEqual([['unseen', true, 0], ['seen', false, 1]]);
        // Gone once older than the ghosts' turns.
        state.crew[0]!.pos = P(11, 0);
        state.police.units = state.police.units.filter(u => u.id === 'seen');
        state.turn += world.rules.ghostTurns;
        look(world, state, true);
        expect(officerMarkers(world, state)).toEqual([]);
    });

    it('drops a ghost once the crew sees its tile without the officer, and never follows the officer it lost', () => {
        const { world, state } = loud(OPEN, { walls });
        officer(state, 'o', P(3, 1));
        look(world, state);
        // The officer walks behind the wall: the crew sees its old tile empty; no marker, and none behind the wall.
        state.police.units[0]!.pos = P(8, 1);
        state.turn++;
        look(world, state, true);
        expect(officerMarkers(world, state)).toEqual([]);
        expect(state.knowledge.officers).toEqual({});
    });

    it('marks each breach announced at its door', () => {
        const { world, state } = loud(OPEN, { walls: [{ between: [P(5, 1), P(6, 1)], material: 'soft', door: { id: 'd', lock: 'mechanical', start: 'locked' } }] });
        officer(state, 'o', P(7, 1));
        expect(breachMarkers(world, state)).toEqual([]);
        state.police.breaches.push({ door: 'd', unit: 'o', turn: state.turn });
        expect(breachMarkers(world, state)).toEqual([{ door: 'd', at: { x: 6, y: 1.5 } }]);
    });
});

describe('aim mode (§11.2, §11.7, UI.md "Shot cones")', () => {
    // A soft wall between x 5 and 6: a rifle's bullets pass it, but nobody sees through it.
    const walls = [0, 1, 2].map(y => ({ between: [P(5, y), P(6, y)] as [Pos, Pos], material: 'soft' as const }));

    it('nests an arc per bullet and marks only the people the crew knows of', () => {
        const { world, state } = loud(OPEN, { walls, people: [person('cust', P(3, 0)), person('hidden', P(9, 1))] });
        look(world, state);
        // Fired down the row at the bare floor: the truth reaches the one behind the wall; the crew's cone never names them.
        const blind = { type: 'attack', crew: 'jun', at: P(4, 1) } as const;
        expect(attackCone(world, state, blind)?.bodies.map(b => b.id)).toContain('hidden');
        expect(aimView(world, state, blind)!.bodies.map(b => b.id)).not.toContain('hidden');
        const cmd = { type: 'attack', crew: 'jun', at: P(3, 0), target: 'cust' } as const;
        const aim = aimView(world, state, cmd)!;
        expect(aim.bodies.map(b => b.id)).toEqual(['cust']);
        expect(aim.bodies[0]).toMatchObject({ kind: 'civilian', pos: P(3, 0) });
        // One arc per bullet, widening; the cone stops nowhere past its range.
        expect(aim.arcs.length).toBe(3);
        expect([...aim.arcs].sort((a, b) => a - b)).toEqual(aim.arcs);
        for (const [, d] of aim.outline) expect(d).toBeGreaterThan(0);
        expect(Math.max(...aim.outline.map(([, d]) => d))).toBeLessThanOrEqual(20 + 1e-6);
        // The fire selector narrows it.
        expect(fireSelector(state, cmd)).toEqual({ max: 3, bullets: 3 });
        expect(aimView(world, state, { ...cmd, bullets: 1 })!.arcs.length).toBe(1);
    });

    it('shows a shield on the side facing the shooter, flanked from the side', () => {
        const map = ['............', '.....#......', '............'];
        const { world, state } = loud(map, { people: [person('guard', P(6, 1), 'lobbyGuard', 'enforcer')] });
        state.npcs[0]!.status = 'hostile';
        look(world, state);
        const front = aimView(world, state, { type: 'attack', crew: 'jun', at: P(6, 1), target: 'guard' })!;
        expect(front.bodies[0]).toMatchObject({ id: 'guard', kind: 'hostile', shield: { state: 'covered', side: 'w' } });
    });

    it('dashes who a later bullet reaches once teller glass breaks, and how much further it flies', () => {
        const { world, state } = loud(OPEN, { gun: 'lmg', walls: [{ between: [P(2, 1), P(3, 1)], material: 'tellerGlass' }], people: [person('teller', P(5, 1), 'teller', 'staff')] });
        look(world, state);
        const aim = aimView(world, state, { type: 'attack', crew: 'jun', at: P(5, 1), target: 'teller' })!;
        expect(aim.bodies).toMatchObject([{ id: 'teller', ifBroken: true }]);
        expect(aim.broken.length).toBeGreaterThan(0);
        const glass = Math.min(...aim.outline.map(([, d]) => d)), past = Math.max(...aim.broken.flat().map(([, d]) => d));
        expect(past).toBeGreaterThan(glass);
    });

    it('has no cone for a command that fires nothing or is refused', () => {
        const { world, state } = loud(OPEN);
        look(world, state);
        expect(aimView(world, state, { type: 'wait', crew: 'jun' } as never)).toBeUndefined();
        expect(aimView(world, state, { type: 'attack', crew: 'jun', at: P(3, 1), target: 'nobody' })).toBeUndefined();
    });
});
