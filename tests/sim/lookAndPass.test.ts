import { describe, expect, it } from 'vitest';
import {
    actionPreview, assessEnd, assessPath, clonePlain, commandHooks, commit, doorDoubt, facingToward, effectOf, explain, fixtureWorld, hashOf, initialState,
    makeNoise, pathSafety, preview, registerCommandHook, safeFloor, sightMap, soundRing, type CameraDef, type Command, type CrewStart, type Facing,
    type FixtureWall, type ObserverClass, type PersonDef, type Pos, type ReadonlyWorld, type SimEvent, type State
} from '../../src/sim';
import { pathView } from '../../src/game/worldUi';
import { registerTestCommand, scouted, step, testCommand } from './helpers';

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
        // The safe floor tints jun's tile with what the dash does to Mara too, and "who and why" names her.
        const tile = safeFloor(world, state, 'jun').at(P(9, 3))!;
        expect(JSON.stringify(tile.path)).toBe(JSON.stringify(dash.path));
        expect(tile.teammates).toEqual([{ crew: 'mara', effect: effectOf(r.events, 'mara', state) }]);
        expect(tile.tint.teammates).toEqual(['mara']);
        const mara = effectOf(r.events, 'mara', state), name = state.crew.find(c => c.id === 'mara')!.name;
        expect(tile.tint.pips.filter(p => p.crew === 'mara').map(p => [p.npc, p.pips])).toEqual(Object.entries(mara.pips).sort());
        expect(explain(world, state, 'jun', P(9, 3)).filter(l => l.crew === 'mara').map(l => l.text).sort())
            .toEqual(Object.entries(mara.pips).sort().map(([, n]) => `${name}: +${n} (teller)`));
    });

    it('tints a tile by what the move does to a teammate alone', () => {
        // Clean jun dashes on public floor (nobody minds them); t2 turns to the noise and sees armed Mara on staff floor.
        const rows = ['.'.repeat(15), '.'.repeat(15), '.'.repeat(15), '.'.repeat(15), 's'.repeat(15), 's'.repeat(15), 's'.repeat(15)];
        const { world, state } = setup(rows, [person('t1', 'staff', P(7, 1), 'n'), person('t2', 'staff', P(7, 5), 's')],
            [{ id: 'jun', pos: P(2, 3) }, { id: 'mara', pos: P(8, 4), items: ['pistol'] }]);
        const done = commit(world, state, dash);
        expect(effectOf(done.events, 'jun', state).pips).toEqual({});
        const mara = effectOf(done.events, 'mara', state);
        expect(Object.keys(mara.pips).length + mara.exposed.length).toBeGreaterThan(0);
        const tile = safeFloor(world, state, 'jun').at(P(9, 3))!;
        expect(tile.now.pips).toEqual({});
        expect(tile.teammates).toEqual([{ crew: 'mara', effect: mara }]);
        expect(tile.tint.kind).not.toBe('safe');
        const drawn = pathSafety(world, state, 'jun', dash.path, { mode: 'dash' });
        if (!drawn.ok) throw new Error(drawn.reason);
        expect(drawn.end.tint).toEqual(tile.tint);
        expect(drawn.firstUnsafe).toBe(dash.path.length - 1);
    });

    it('turns and sees for a noise made outside an action, before every other command hook', () => {
        // A test command that only makes a dash's noise: the `hearing` hook turns t2, and its sightings are applied before
        // any hook of the default order runs (here one whose name sorts before 'hearing').
        let seen: number | undefined;
        registerTestCommand('testNoise', ctx => { makeNoise(ctx, 'dash', dash.path, 'test'); });
        registerCommandHook('aa.probe', ctx => { seen = ctx.state.npcs.find(n => n.id === 't2')?.suspicion.mara; });
        const order = commandHooks();
        expect(order.indexOf('hearing')).toBeLessThan(Math.min(...['aa.probe', 'cameras', 'carriers', 'knowledge'].map(h => order.indexOf(h))));
        const { world, state } = setup(Array.from({ length: 7 }, () => 's'.repeat(15)), [person('t1', 'staff', P(7, 1), 'n'), person('t2', 'staff', P(7, 5), 's')],
            [{ id: 'jun', pos: P(2, 3) }, { id: 'mara', pos: P(8, 4), items: ['pistol'] }]);
        const r = step(world, state, testCommand({ type: 'testNoise' }));
        expect(npcOf(r.state, 't2').facing).not.toBe('s');
        expect(npcOf(r.state, 't2').suspicion.mara).toBeGreaterThan(0);
        expect(seen).toBe(npcOf(r.state, 't2').suspicion.mara);
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

describe('the marker of an NPC a noise turns out of sight (decision 45)', () => {
    // A clerk seen earlier this crew phase, out of sight now behind a screen that carries sound: a dash turns it.
    const W = 12, H = 4;
    const screen: FixtureWall[] = Array.from({ length: W }, (_, x) => ({ between: [P(x, 2), P(x, 3)] as [Pos, Pos], blocksSound: false }));
    const path = [P(3, 3), P(4, 3), P(5, 3), P(6, 3), P(7, 3), P(8, 3), P(9, 3)];
    const build = (clerk: Pos, door: [Pos, Pos] | null, status: 'open' | 'closed') => {
        const walls: FixtureWall[] = [...screen, ...(door ? [{ between: door, door: { id: 'd', start: 'closed' as const } }] : [])];
        const world = fixtureWorld(Array.from({ length: H }, () => '.'.repeat(W)), { walls, people: [person('clerk', 'staff', clerk, 'w')] });
        const s = clonePlain(initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(2, 3) }] }));
        if (door) s.doors.d = { status };
        s.knowledge.npcs.clerk = {
            at: { ...clerk }, facing: 'w', turn: s.turn, live: true, routine: false, rota: false, watched: 1, watchedTurn: s.turn, tick: s.knowledge.phaseTick + 1
        };
        return { world, state: s };
    };
    const cmd: Command = { type: 'dash', crew: 'jun', path };

    it('takes the turned facing when no door could change it', () => {
        const { world, state } = build(P(6, 1), null, 'closed');
        const r = commit(world, state, cmd);
        expect(npcOf(r.state, 'clerk').facing).not.toBe('w');
        expect(r.state.knowledge.npcs.clerk!.facing).toBe(npcOf(r.state, 'clerk').facing);
        expect(preview(world, state, cmd).state.knowledge.npcs.clerk!.facing).toBe(r.state.knowledge.npcs.clerk!.facing);
    });

    it('keeps the facing last seen when a door the crew cannot vouch for decides where it turns', () => {
        // Every layout where the door decides the last tile heard: the crew's knowledge is the same either way.
        const doors: [Pos, Pos][] = [];
        for (let x = 1; x < W - 1; x++) for (let y = 0; y < 3; y++) { doors.push([P(x, y), P(x + 1, y)]); if (y < 2) doors.push([P(x, y), P(x, y + 1)]); }
        let decided = 0;
        for (const door of doors) for (let cx = 0; cx < W; cx++) for (let cy = 0; cy < 3; cy++) {
            const clerk = P(cx, cy);
            if ((door[0].x === cx && door[0].y === cy) || (door[1].x === cx && door[1].y === cy)) continue;
            const o = build(clerk, door, 'open'), c = build(clerk, door, 'closed');
            const ho = soundRing(o.world, o.state, path, 2).lastHeard(clerk), hc = soundRing(c.world, c.state, path, 2).lastHeard(clerk);
            if (!ho || !hc || (ho.x === hc.x && ho.y === hc.y) || !doorDoubt(o.world, o.state)?.doors.has('d')) continue;
            const ro = commit(o.world, o.state, cmd), rc = commit(c.world, c.state, cmd);
            if (npcOf(ro.state, 'clerk').facing === npcOf(rc.state, 'clerk').facing) continue;
            decided++;
            expect(ro.state.knowledge.npcs.clerk!.facing, JSON.stringify({ door, clerk })).toBe(rc.state.knowledge.npcs.clerk!.facing);
            expect(JSON.stringify(actionPreview(o.world, o.state, cmd))).toBe(JSON.stringify(actionPreview(c.world, c.state, cmd)));
        }
        expect(decided).toBeGreaterThan(0);
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
        // The worst reaction (+2, in its Core at (5, 3)), at the last tile it reacts to jun on (its Peripheral, (6, 4)).
        expect(judged.map(s => [s.observer, s.outcome, s.tile])).toEqual([['teller', '+2', P(6, 4)]]);
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

describe('a glance at a noise (decision 45)', () => {
    // The teller at (7, 2) faces west over staff floor; a screen between rows 3 and 4 blocks sight but carries sound.
    const rows = Array.from({ length: 8 }, () => 's'.repeat(15));
    const walls: FixtureWall[] = Array.from({ length: 15 }, (_, x) => ({ between: [P(x, 3), P(x, 4)] as [Pos, Pos], blocksSound: false }));
    const build = () => setup(rows, [person('t', 'staff', P(7, 2), 'w')], [{ id: 'mara', pos: P(4, 1), items: ['pistol'] }, { id: 'jun', pos: P(13, 5) }], { walls });

    it('turns an NPC busy investigating for the crew phase; it keeps its want and walks it in the world phase', () => {
        const { world, state } = build();
        // Mara steps into its Core: +2, Investigating.
        const seen = step(world, state, { type: 'move', crew: 'mara', path: [P(4, 2), P(5, 3)] }).state;
        expect(npcOf(seen, 't').suspicion.mara).toBe(2);
        const goal = npcOf(seen, 't').goal.kind;
        expect(goal).toBe('investigate');
        // Jun dashes behind the screen: the teller glances at the noise at once, its want unchanged.
        const dash: Command = { type: 'dash', crew: 'jun', path: [P(12, 4), P(11, 4), P(10, 4), P(9, 4), P(8, 4)] };
        const shown = preview(world, seen, dash), heard = step(world, seen, dash);
        expect(shown.events).toEqual(heard.events);
        expect(hashOf(shown.state)).toBe(hashOf(heard.state));
        const t = npcOf(heard.state, 't');
        expect(t.facing).not.toBe('w');
        expect(t.goal.kind).toBe(goal);
        expect(t.suspicion.mara).toBe(2);
        // Mara walks out through what was its cone, unseen.
        const out: Command = { type: 'move', crew: 'mara', path: [P(4, 3), P(3, 3), P(2, 2)] };
        const quiet = preview(world, heard.state, out), left = step(world, heard.state, out);
        expect(quiet.events).toEqual(left.events);
        expect(effectOf(left.events, 'mara', heard.state).pips).toEqual({});
        expect(safeFloor(world, heard.state, 'mara').at(P(2, 2))?.now.pips).toEqual({});
        // The world phase: it carries on toward Mara's last known tile.
        const before = Math.max(Math.abs(t.pos.x - 5), Math.abs(t.pos.y - 3));
        const after = npcOf(step(world, left.state, { type: 'endTurn' }).state, 't');
        expect(Math.max(Math.abs(after.pos.x - 5), Math.abs(after.pos.y - 3))).toBeLessThan(before);
    });
});
