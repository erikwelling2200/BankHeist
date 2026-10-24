import { describe, expect, it } from 'vitest';
import {
    assessEnd, assessPath, commit, facingToward, effectOf, explain, fixtureWorld, hashOf, initialState, pathSafety, preview, safeFloor, sightMap, soundRing,
    type CameraDef, type Command, type CrewStart, type Facing, type FixtureWall, type ObserverClass, type PersonDef, type Pos, type ReadonlyWorld,
    type SimEvent, type State
} from '../../src/sim';
import { pathView } from '../../src/game/worldUi';
import { scouted, step } from './helpers';

/*
 * Decision 45 (§8.9): a hearer reacts toward the last tile of a noise it heard, and one sent to look turns at once and
 * sees. Decision 46 (§8.5): passing through an observer's view during a move counts as ending there, once per observer
 * at its worst.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const ROLES: Record<ObserverClass, string> = { civilian: 'customer', staff: 'teller', enforcer: 'guard' };
const person = (id: string, observer: ObserverClass, pos: Pos, facing: Facing): PersonDef =>
    ({ id, name: id, role: ROLES[observer], observer, pos, facing, schedule: [{ from: 1, activity: 'post', label: 'post', room: '', at: pos, facing }] });

function setup(rows: readonly string[], people: PersonDef[], crew: CrewStart[], extra: { walls?: FixtureWall[]; cameras?: CameraDef[] } = {}): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(rows, { people, zones: [...rows], ...extra });
    return { world, state: scouted(world, initialState(world, { seed: 1, crew })) };
}

const npcOf = (state: State, id: string) => state.npcs.find(n => n.id === id)!;
const events = (list: readonly SimEvent[], type: SimEvent['type']): SimEvent[] => list.filter(e => e.type === type);

describe('the last tile heard (decision 45)', () => {
    it('is the last source whose sound reaches the hearer, not the nearest, on a dash that loops back', () => {
        // The dash passes beside the clerk first (5, 4), loops away out of earshot and back within it at (7, 4), then
        // leaves it for good.
        const { world, state } = setup(Array.from({ length: 9 }, () => '.'.repeat(14)), [person('n', 'staff', P(5, 5), 'w')], [{ id: 'jun', pos: P(4, 3) }]);
        const path = [P(5, 4), P(6, 3), P(7, 3), P(7, 4), P(8, 4), P(9, 4), P(10, 4)];
        const ring = soundRing(world, state, path, 2);
        expect(ring.lastHeard(P(5, 5))).toEqual(P(7, 4));
        const r = step(world, state, { type: 'dash', crew: 'jun', path });
        const n = npcOf(r.state, 'n');
        // The only hearer: the one sent, to the last tile it heard.
        expect(n.evidence).toMatchObject({ kind: 'quietNoise', tile: P(7, 4) });
        expect(n.goal).toMatchObject({ kind: 'inspect', tile: P(7, 4) });
    });

    it('changes with a door between a source and the hearer', () => {
        // A door between (6, 0) and (7, 0), nothing else: the dash's (7, 0) carries to the clerk at (5, 0) only through
        // it open; (7, 1) carries round it either way.
        const walls: FixtureWall[] = [{ between: [P(6, 0), P(7, 0)], door: { id: 'd', start: 'closed' } }];
        const path = [P(4, 1), P(5, 1), P(6, 1), P(7, 1), P(7, 0), P(8, 0)];
        const heard = (status: 'open' | 'closed'): Pos => {
            const { world, state } = setup(Array.from({ length: 3 }, () => '.'.repeat(12)), [person('n', 'staff', P(5, 0), 'w')], [{ id: 'jun', pos: P(3, 1) }], { walls });
            const s: State = { ...state, doors: { ...state.doors, d: { status } } };
            expect(soundRing(world, s, path, 2).lastHeard(P(5, 0))).toEqual(status === 'open' ? P(7, 0) : P(7, 1));
            return npcOf(step(world, s, { type: 'dash', crew: 'jun', path }).state, 'n').evidence!.tile;
        };
        expect(heard('open')).toEqual(P(7, 0));
        expect(heard('closed')).toEqual(P(7, 1));
    });
});

describe('looking at a noise (decision 45)', () => {
    // A staff floor: two tellers facing away from row 3, Concealed jun dashing along it. Both hear the last tile (8, 3);
    // t1 (first) is sent, t2 looks: both turn at once and see jun at the end, (9, 3).
    const build = () => setup(Array.from({ length: 7 }, () => 's'.repeat(15)), [person('t1', 'staff', P(7, 1), 'n'), person('t2', 'staff', P(7, 5), 's')],
        [{ id: 'jun', pos: P(2, 3), items: ['pistol'] }]);
    const dash: Command = { type: 'dash', crew: 'jun', path: [P(3, 3), P(4, 3), P(5, 3), P(6, 3), P(7, 3), P(8, 3), P(9, 3)] };

    it('turns the one who looks and the one sent within the dash, and what they then see costs pips at once', () => {
        const { world, state } = build();
        // Facing away, neither sees any tile of the dash.
        expect(assessPath(world, state, 'jun', dash.path)).toEqual([]);
        const r = step(world, state, dash);
        const t1 = npcOf(r.state, 't1'), t2 = npcOf(r.state, 't2');
        expect(t1.evidence).toMatchObject({ kind: 'quietNoise', tile: P(8, 3) });
        expect(t1.facing).toBe(facingToward(P(7, 1), P(8, 3)));
        // It turned to the noise now, not in the world phase, and hasn't moved; what it saw then gives it a want of its own.
        expect(t2.evidence).toMatchObject({ kind: 'quietNoise', tile: P(8, 3) });
        expect(t2.facing).toBe(facingToward(P(7, 5), P(8, 3)));
        expect(t2.facing).not.toBe('s');
        expect(t2.pos).toEqual(P(7, 5));
        expect([t1.goal.kind, t2.goal.kind]).toEqual(['investigate', 'watch']);
        expect(events(r.events, 'suspicionRaised').map(e => (e as { npc: string }).npc).sort()).toEqual(['t1', 't2']);
        expect(t2.suspicion.jun).toBeGreaterThan(0);
        // The same as the end of an action there, seen as it faces now.
        expect(assessEnd(world, r.state, sightMap(world, r.state), 'jun', P(9, 3)).map(s => s.observer)).toContain('t2');
    });

    it('is previewed exactly: the preview, the safe floor, a drawn path and "who and why" agree with the commit', () => {
        const { world, state } = build();
        const shown = preview(world, state, dash), done = commit(world, state, dash);
        expect(shown.events).toEqual(done.events);
        expect(hashOf(shown.state)).toBe(hashOf(done.state));
        const tile = safeFloor(world, state, 'jun').at(P(9, 3))!;
        expect(tile.band).toBe('dash');
        expect(JSON.stringify(tile.path)).toBe(JSON.stringify(dash.path));
        expect(tile.now).toEqual(effectOf(done.events, 'jun', state));
        expect(Object.keys(tile.now.pips).sort()).toEqual(['t1', 't2']);
        expect(tile.tint.kind).not.toBe('safe');
        const drawn = pathSafety(world, state, 'jun', dash.path, { mode: 'dash' });
        if (!drawn.ok) throw new Error(drawn.reason);
        expect(drawn.end.now).toEqual(tile.now);
        expect(drawn.heard).toEqual(['t1', 't2']);
        expect(explain(world, state, 'jun', P(9, 3)).filter(l => l.phase === 'now').map(l => l.observer).sort()).toEqual(['t1', 't2']);
    });

    it('sees the rest of the crew too', () => {
        // Mara stands behind t2, where it turns to.
        const { world, state } = setup(Array.from({ length: 7 }, () => 's'.repeat(15)), [person('t1', 'staff', P(7, 1), 'n'), person('t2', 'staff', P(7, 5), 's')],
            [{ id: 'jun', pos: P(2, 3), items: ['pistol'] }, { id: 'mara', pos: P(8, 4), items: ['pistol'] }]);
        expect(assessEnd(world, state, sightMap(world, state), 'mara', P(8, 4))).toEqual([]);
        const r = step(world, state, dash);
        expect(npcOf(r.state, 't2').suspicion.mara).toBeGreaterThan(0);
        expect(events(r.events, 'suspicionRaised').filter(e => (e as { npc: string }).npc === 't2').map(e => (e as { crew: string }).crew).sort())
            .toEqual(['jun', 'mara']);
    });

    it('looks for a phase, then goes back to its routine', () => {
        // Clean on public floor: nobody minds what they see.
        const { world, state } = setup(Array.from({ length: 7 }, () => '.'.repeat(15)), [person('t1', 'staff', P(7, 1), 'n'), person('t2', 'staff', P(7, 5), 's')],
            [{ id: 'jun', pos: P(2, 3) }]);
        const r = step(world, state, dash);
        expect(npcOf(r.state, 't2').facing).not.toBe('s');
        expect(events(r.events, 'suspicionRaised')).toEqual([]);
        expect(npcOf(r.state, 't2').goal.kind).toBe('look');
        let s = r.state;
        for (let k = 0; k < 4; k++) s = step(world, s, { type: 'endTurn' }).state;
        expect(npcOf(s, 't2').evidence).toBeNull();
        expect(npcOf(s, 't2').goal.kind).toBe('routine');
        expect(npcOf(s, 't2').intent.facing).toBe('s');
    });
});

describe('investigating a noise (decision 45)', () => {
    // One clerk facing away from row 3 hears Concealed jun dash along it: the only hearer, it is sent to investigate its
    // last tile heard (8, 3), turns to it at once and sees jun at the end (9, 3); it walks there in the world phase.
    const build = () => setup(Array.from({ length: 7 }, () => 's'.repeat(15)), [person('t1', 'staff', P(7, 1), 'n')], [{ id: 'jun', pos: P(2, 3), items: ['pistol'] }]);
    const dash: Command = { type: 'dash', crew: 'jun', path: [P(3, 3), P(4, 3), P(5, 3), P(6, 3), P(7, 3), P(8, 3), P(9, 3)] };

    it('turns the investigator within the dash, and what it sees costs pips at once', () => {
        const { world, state } = build();
        expect(assessPath(world, state, 'jun', dash.path)).toEqual([]);
        const r = step(world, state, dash);
        const t1 = npcOf(r.state, 't1');
        expect(t1.evidence).toMatchObject({ kind: 'quietNoise', tile: P(8, 3) });
        expect(t1.facing).toBe(facingToward(P(7, 1), P(8, 3)));
        expect(t1.pos).toEqual(P(7, 1));
        expect(events(r.events, 'suspicionRaised')).toEqual([expect.objectContaining({ npc: 't1', crew: 'jun' })]);
    });

    it('is previewed exactly', () => {
        const { world, state } = build();
        const shown = preview(world, state, dash), done = commit(world, state, dash);
        expect(shown.events).toEqual(done.events);
        expect(hashOf(shown.state)).toBe(hashOf(done.state));
        const tile = safeFloor(world, state, 'jun').at(P(9, 3))!;
        expect(JSON.stringify(tile.path)).toBe(JSON.stringify(dash.path));
        expect(tile.now).toEqual(effectOf(done.events, 'jun', state));
        expect(Object.keys(tile.now.pips)).toEqual(['t1']);
    });
});

describe('passing through view (decision 46)', () => {
    // A staff room; the teller at (7, 2) faces west: Concealed jun in its Core is +2, in its Peripheral +1.
    const rows = Array.from({ length: 5 }, () => 's'.repeat(12));

    it('reacts once, as if the move ended on the worst tile, though it ends out of view', () => {
        const { world, state } = setup(rows, [person('teller', 'staff', P(7, 2), 'w')], [{ id: 'jun', pos: P(4, 1), items: ['pistol'] }]);
        // Down through its Core (+2), its Peripheral (+1) and out of view beside it: the end (7, 4) it can't see.
        const path = [P(4, 2), P(5, 3), P(6, 4), P(7, 4)];
        expect(assessEnd(world, state, sightMap(world, state), 'jun', P(7, 4))).toEqual([]);
        const judged = assessPath(world, state, 'jun', path);
        expect(judged.map(s => [s.observer, s.outcome, s.tile])).toEqual([['teller', '+2', P(5, 3)]]);
        const moved = step(world, state, { type: 'move', crew: 'jun', path });
        const stopped = step(world, state, { type: 'move', crew: 'jun', path: path.slice(0, 2) });
        expect(npcOf(moved.state, 'teller').suspicion).toEqual(npcOf(stopped.state, 'teller').suspicion);
        expect(npcOf(moved.state, 'teller').suspicion).toEqual({ jun: 2 });
        expect(events(moved.events, 'perceptionCheck')).toHaveLength(1);
        expect(events(moved.events, 'suspicionRaised')).toHaveLength(1);
    });

    it('has a camera crossed mid-move report once', () => {
        // A camera at (5, 0) looking south; armed jun dashes across its view and ends out of it at (1, 4).
        const cameras: CameraDef[] = [{ id: 'cam', pos: P(5, 0), facings: ['s'], room: null }];
        const { world, state } = setup(Array.from({ length: 7 }, () => '.'.repeat(12)), [], [{ id: 'jun', pos: P(9, 1), items: ['assaultRifle'] }], { cameras });
        const path = [P(8, 2), P(7, 3), P(6, 4), P(5, 4), P(4, 4), P(3, 4), P(2, 4), P(1, 4)];
        expect(assessEnd(world, state, sightMap(world, state), 'jun', P(1, 4))).toEqual([]);
        const r = step(world, state, { type: 'dash', crew: 'jun', path });
        expect(events(r.events, 'cameraSaw')).toHaveLength(1);
        expect(r.state.cameraReports).toHaveLength(1);
        expect(assessPath(world, state, 'jun', path).filter(s => s.observer === 'cam')).toHaveLength(1);
    });

    it('tints the safe floor and a drawn path through it: the tile beyond, and the eye where the view is crossed', () => {
        // The teller at (7, 3) faces north: (4, 3) beside it is out of view, (5, 2) in its Peripheral (+1), (6, 1) in its Core (+2).
        const { world, state } = setup(rows, [person('teller', 'staff', P(7, 3), 'n')], [{ id: 'jun', pos: P(3, 4), items: ['pistol'] }]);
        const path = [P(4, 3), P(5, 2), P(6, 1)];
        const drawn = pathSafety(world, state, 'jun', path, { mode: 'move' });
        if (!drawn.ok) throw new Error(drawn.reason);
        expect(drawn.firstUnsafe).toBe(1);
        expect(drawn.end.now.pips).toEqual({ teller: 2 });
        expect(drawn.end.tint.kind).not.toBe('safe');
        const view = pathView(drawn)!;
        expect(view.steps.map(s => s.kind).slice(0, 2)).toEqual(['safe', 'amber']);
        // The same path from the safe floor reads the same; stopping before the view is crossed doesn't.
        const floor = safeFloor(world, state, 'jun');
        const tile = floor.at(P(6, 4))!;
        if (JSON.stringify(tile.path) === JSON.stringify(path)) expect(tile.now).toEqual(drawn.end.now);
        expect(drawn.steps[0]!.stop!.now.pips).toEqual({});
    });
});
