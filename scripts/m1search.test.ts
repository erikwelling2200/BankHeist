import { appendFileSync } from 'node:fs';
import { test } from 'vitest';
import { M1_INSIDE, M1_OPENING } from '../e2e/m1Run';
import { MemoryStorage } from '../src/game';
import { AutoRun, waitMenu } from '../src/game/autoAdvance';
import { startHeist } from '../src/game/heist';
import { generateBank } from '../src/gen/generate';
import { commit, effectKind, effectOf, preview, safeFloor, TINT_RANK, type Command, type CommitResult, type Pos, type ReadonlyWorld, type State } from '../src/sim';

/*
 * The M1 run's search (e2e/m1Run.ts), for when a rule change breaks the recording. It plays the run headlessly as the
 * M1 test in e2e/play.spec.ts does (the same commands, safe-floor paths and checks: every move green, its Now true, the
 * world phase quiet and its Next true), says on which turn the recording diverges, and then searches a turn at a time
 * from the start of turn `M1_FROM` (default: the turn it diverges) to the start of turn 70, where the test's ending
 * (the guard in the closet's doorway, the red hatched step, the knockout, the panel) must play. Each turn's options are
 * waiting and every one or two of Jun's Moves to green tiles; states that differ only in what the crew knows are merged,
 * and the `M1_BEAM` (250) cheapest are kept, cheapest being the fewest turns changed from the recording. Prints the
 * whole new M1_INSIDE on success.
 *
 *   NODE_OPTIONS=--max-old-space-size=4096 M1_FROM=35 npx vitest run --config scripts/vitest.m1search.config.ts
 *
 * About 20 minutes from turn 35. On Windows run it from PowerShell (`$env:M1_FROM='35'`): Git Bash paths break vitest's
 * root. `M1_LOG=<file>` also appends the progress there, as it goes; `M1_FROM=33,30` tries each start in turn.
 */

const ACCEPTED = ['safe', 'unknownRisk', 'grey'];
const HEARD = ['suspicionRaised', 'exposed', 'challenged', 'cameraSaw', 'alarmAttempt'];
const BEAM = Number(process.env.M1_BEAM ?? 250), SLACK = Number(process.env.M1_SLACK ?? 4), END = 70;

const log = (line: string) => {
    console.log(line);
    if (process.env.M1_LOG) appendFileSync(process.env.M1_LOG, `${line}\n`);
};
/** JSON with sorted keys, so two outcomes compare as the test's `toEqual` does. */
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
/** A state without what the crew knows and the dice log: two states with the same key play the same from here. */
const keyOf = (s: State): string => { const { knowledge: _k, dice: _d, ...rest } = s as State & { knowledge?: unknown }; return JSON.stringify(rest); };
const isQuiet = (s: State) => !s.bank.alarm && !s.bank.loud && !s.carriers.length && s.npcs.every(n => n.status !== 'alerted' && n.status !== 'hostile');

interface Move { crew: string; x: number; y: number }
const parse = (spec: string): Move[] => spec.split(' ').filter(Boolean).map(m => {
    const [crew, at] = m.split(':');
    const [x, y] = at!.split(',').map(Number);
    return { crew: crew!, x: x!, y: y! };
});

type Tile = ReturnType<typeof safeFloor>['tiles'][number];
const floorTile = (world: ReadonlyWorld, s: State, crew: string, x: number, y: number): Tile | undefined =>
    safeFloor(world, s, crew, { bands: ['move'] }).tiles.find(t => t.band === 'move' && t.pos.x === x && t.pos.y === y);

/** Moves committed once per state and tile, so the state after one is the same object and its safe floor stays cached. */
const moves = new WeakMap<State, Map<string, CommitResult>>();
function moveTo(world: ReadonlyWorld, s: State, crew: string, tile: Tile): CommitResult {
    let byTile = moves.get(s);
    if (!byTile) moves.set(s, (byTile = new Map()));
    const key = `${crew}:${tile.pos.x},${tile.pos.y}`;
    let r = byTile.get(key);
    if (!r) byTile.set(key, (r = commit(world, s, { type: 'move', crew, path: tile.path as Pos[] })));
    return r;
}
/** World phases played this turn of the search, by the state they start from: the same start plays the same. */
const ends = new Map<string, CommitResult>();

/** One turn with the M1 test's checks: the state after its world phase, or why it fails them. */
function playTurn(world: ReadonlyWorld, state: State, turn: Move[]): { state: State } | { fail: string } {
    let s = state, last: { tile: Tile; now: ReturnType<typeof effectOf> } | null = null;
    for (const m of turn) {
        const tile = floorTile(world, s, m.crew, m.x, m.y);
        if (!tile) return { fail: `no Move to ${m.x},${m.y}` };
        if (!ACCEPTED.includes(tile.tint.kind)) return { fail: `${m.x},${m.y} is ${tile.tint.kind}` };
        const r = moveTo(world, s, m.crew, tile), now = effectOf(r.events, m.crew, s), at = r.state.crew.find(c => c.id === m.crew)!.pos;
        if (r.events.some(e => e.type === 'moveCut') || at.x !== m.x || at.y !== m.y) return { fail: `cut short of ${m.x},${m.y}` };
        if (!same(now, tile.now)) return { fail: `${m.x},${m.y}: Now differs` };
        s = r.state;
        last = { tile, now };
    }
    const key = keyOf(s);
    let r = ends.get(key);
    if (!r) ends.set(key, (r = commit(world, s, { type: 'endTurn' })));
    if (!isQuiet(r.state)) return { fail: 'not quiet' };
    const heard = r.events.filter(e => HEARD.includes(e.type));
    if (heard.length) return { fail: heard.map(e => e.type).join(', ') };
    const lastCrew = turn.at(-1)?.crew;
    if (last && lastCrew) {
        const next = effectOf(r.events, lastCrew, s);
        if (last.tile.next !== null && !same(next, last.tile.next)) return { fail: 'Next differs' };
        const happened = [effectKind(last.now), effectKind(next)].sort((a, b) => TINT_RANK[b] - TINT_RANK[a])[0];
        const kind = last.tile.tint.kind === 'unknownRisk' || last.tile.tint.kind === 'grey' ? 'safe' : last.tile.tint.kind;
        if (happened !== kind) return { fail: `${kind} tint, ${happened} happened` };
    }
    return { state: r.state };
}

test('the M1 run: where it diverges, and a continuation under the current rules', () => {
    const session = startHeist(generateBank({ layout: 31, population: 2, tier: 'small', archetype: 'twoWing' }), new MemoryStorage());
    const world = session.world;
    for (const spec of M1_OPENING) {
        const r = playTurn(world, session.state, parse(spec));
        if ('fail' in r) throw new Error(`The opening fails on turn ${session.state.turn}: ${r.fail}`);
        for (const m of parse(spec)) session.commit({ type: 'move', crew: m.crew, path: floorTile(world, session.state, m.crew, m.x, m.y)!.path as Pos[] });
        session.endTurn();
    }
    // "Wait for…" to turn 10, as the test does.
    while (session.state.turn < 10) {
        const option = waitMenu(session).filter(o => o.target.kind === 'turn' && o.target.turn <= 10).at(-1);
        if (!option) session.endTurn();
        else for (const run = new AutoRun(session, option.target); !run.step();) { /* a turn at a time */ }
    }
    // The recording's state at the start of each turn it plays.
    const states: State[] = [session.state];
    for (const [i, spec] of M1_INSIDE.entries()) {
        const r = playTurn(world, states[i]!, parse(spec));
        if ('fail' in r) { log(`The recording diverges on turn ${10 + i} ('${spec}'): ${r.fail}`); break; }
        states.push(r.state);
    }

    const panel = world.objects.find(o => o.kind === 'alarmPanel')!.id;
    const quietEnd = (s: State): State | null => {
        const r = commit(world, s, { type: 'endTurn' });
        return isQuiet(r.state) && !r.events.some(e => HEARD.includes(e.type)) ? r.state : null;
    };
    /** The test's ending from the start of turn 70: null when it plays, else why not. */
    const ending = (s: State): string | null => {
        const guard = s.npcs.find(n => n.id === 'lobbyGuard-8')!;
        if (guard.pos.x !== 45 || guard.pos.y !== 10 || s.doors['door-3']?.status !== 'open') return 'the guard is not in the closet doorway';
        const tile = floorTile(world, s, 'jun', 45, 11);
        if (!tile || tile.tint.kind !== 'red' || !tile.tint.hatched) return 'the step to 45,11 is not red and hatched';
        const step = commit(world, s, { type: 'move', crew: 'jun', path: tile.path as Pos[] });
        if (step.events.some(e => e.type === 'moveCut') || !same(effectOf(step.events, 'jun', s), tile.now)) return 'the step';
        const ko = { type: 'knockout', crew: 'jun', npc: 'lobbyGuard-8' } as Command;
        const shown = preview(world, step.state, ko), done = commit(world, step.state, ko);
        if (!same([shown.events, shown.undoable], [done.events, done.undoable]) || !done.events.some(e => e.type === 'knockedOut')) return 'the knockout';
        let e = quietEnd(done.state);
        if (!e) return 'the world phase after the knockout';
        const walk = playTurn(world, e, parse('jun:45,6 jun:45,5'));
        if ('fail' in walk) return `the walk to the panel: ${walk.fail}`;
        e = walk.state;
        for (let i = 0; i < 2; i++) e = commit(world, e, { type: 'interact', crew: 'jun', object: panel, verb: 'disable' } as Command).state;
        if (!same(e.objects[panel], { progress: 4, disabled: true })) return 'the panel';
        e = quietEnd(e);
        return e?.turn === 73 ? null : 'the last world phase';
    };
    if (states.length > M1_INSIDE.length) {
        log(`The recording plays to turn ${states.at(-1)!.turn}; the ending: ${ending(states.at(-1)!) ?? 'plays'}.`);
        return;
    }

    interface Node { state: State; cost: number; specs: string[] }
    const greens = (s: State): Pos[] => safeFloor(world, s, 'jun', { bands: ['move'] }).tiles
        .filter(t => t.band === 'move' && ACCEPTED.includes(t.tint.kind) && !same(t.pos, s.crew.find(c => c.id === 'jun')!.pos)).map(t => t.pos);
    const search = (from: number): Node | null => {
        let layer: Node[] = [{ state: states[from - 10]!, cost: 0, specs: [] }];
        const started = Date.now();
        while (layer[0]!.state.turn < END) {
            const turn = layer[0]!.state.turn, recorded = M1_INSIDE[turn - 10] ?? '', best = new Map<string, Node>();
            ends.clear();
            const offer = (n: Node, spec: string) => {
                const r = playTurn(world, n.state, parse(spec));
                if ('fail' in r) return;
                const key = keyOf(r.state), cost = n.cost + (spec === recorded ? 0 : 1), old = best.get(key);
                if (!old || cost < old.cost) best.set(key, { state: r.state, cost, specs: [...n.specs, spec] });
            };
            for (const n of layer) {
                offer(n, '');
                if (recorded) offer(n, recorded);
                for (const a of greens(n.state)) {
                    const one = `jun:${a.x},${a.y}`;
                    offer(n, one);
                    const mid = moveTo(world, n.state, 'jun', floorTile(world, n.state, 'jun', a.x, a.y)!).state;
                    if (mid.crew.find(c => c.id === 'jun')!.actionsLeft) for (const b of greens(mid)) offer(n, `${one} jun:${b.x},${b.y}`);
                }
                // The moves tried from this state, and their safe floors, aren't needed again.
                moves.delete(n.state);
            }
            layer = [...best.values()].sort((a, b) => a.cost - b.cost).slice(0, BEAM);
            layer = layer.filter(n => n.cost <= layer[0]!.cost + SLACK);
            log(`  turn ${turn + 1}: ${layer.length} states, the cheapest ${layer[0]?.cost ?? '-'} turns changed, ${Math.round((Date.now() - started) / 1000)} s`);
            if (!layer.length) return null;
        }
        const why = new Map<string, number>();
        for (const n of layer) {
            const reason = ending(n.state);
            if (!reason) return n;
            why.set(reason, (why.get(reason) ?? 0) + 1);
        }
        log(`  no ending plays at turn ${END}: ${stable([...why])}`);
        return null;
    };
    const fails = 10 + states.length - 1;
    for (const from of (process.env.M1_FROM ?? String(fails)).split(',').map(Number)) {
        log(`Searching from turn ${from}`);
        const found = search(from);
        if (!found) continue;
        const run = [...M1_INSIDE.slice(0, from - 10), ...found.specs];
        log(`Found, ${found.cost} turns changed (${run.flatMap((s, i) => (s === M1_INSIDE[i] ? [] : [`turn ${10 + i}: '${M1_INSIDE[i]}' -> '${s}'`])).join('; ')}).`);
        log(`M1_INSIDE = ${JSON.stringify(run)}`);
        return;
    }
    log('No continuation found.');
}, 4 * 3600_000);
