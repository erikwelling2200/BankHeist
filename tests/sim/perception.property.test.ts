import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/gen/rng';
import {
    assessPath, assessWorldPhase, commit, crewMoveOptions, dueChallenge, EYES_DOWN, FACINGS, fixtureWorld, initialState, moveBudget,
    sightMap, validatePath, type CameraDef, type CrewStart, type FixtureWall, type Intent, type ObserverClass, type PersonDef, type Pos,
    type ReadonlyWorld, type ScheduleBlock, type Sighting, type State
} from '../../src/sim';

/*
 * The promise of §8.8 for perception: what the shared assessments say a move or a world phase does is what it does.
 * Random worlds (three zones split by walls with a door and a pane of glass each, tall and low objects, a raised strip,
 * NPCs of every class with random walks, some on edge or commanded, then on random schedules and following their
 * suspicion, M1-06; sometimes a panning camera), random crew loadouts and random moves. Before each move,
 * `assessPath`; before each world phase, `assessWorldPhase` for every crew member where they stand (frisks and guards
 * told included); then the real outcome is compared with the prediction, NPC by NPC: exposure, challenges and pips.
 * Every NPC walks the intent it committed: all of it, or its start when a crew member stands in the way.
 * Whether a move stays undoable is predicted too (it does exactly when nothing would act).
 *
 * PERCEPTION_PROBE_WORLDS=2000 npm test -- perception.property runs a larger sample.
 */

const WORLDS = Number(process.env.PERCEPTION_PROBE_WORLDS ?? 120);
const W = 14, H = 10;

const LOADOUTS: readonly Partial<CrewStart>[] = [
    {}, {}, { items: ['pistol'] }, { items: ['assaultRifle'] }, { masked: true }, { uniform: 'staff' }, { uniform: 'staff', items: ['pistol'] },
    { notoriety: 2 }, { notoriety: 4, items: ['pistol'] }, { items: ['duffel'], packed: ['smg'] }
];

interface Built { world: ReadonlyWorld; free: Pos[] }

function makeWorld(rng: Rng): Built {
    const zones = ['.', 's', 'x'] as const;
    const z = [rng.pick(zones), rng.pick(zones), rng.pick(zones)];
    const map: string[][] = [], zoneRows: string[] = [];
    for (let y = 0; y < H; y++) {
        const row: string[] = [];
        let zr = '';
        for (let x = 0; x < W; x++) {
            const zone = z[x < 5 ? 0 : x < 10 ? 1 : 2]!, r = rng.next();
            row.push(r < 0.05 ? 'T' : r < 0.08 ? '#' : zone);
            zr += zone;
        }
        map.push(row);
        zoneRows.push(zr);
    }
    if (rng.chance(0.5)) {
        const y = rng.int(1, H - 3);
        map[y]![2] = '^';
        map[y]![3] = '^';
        map[y + 1]![2] = '/';
    }
    const walls: FixtureWall[] = [];
    for (const wx of [4, 9]) {
        const doorY = rng.int(0, H - 1), glassY = rng.int(0, H - 1);
        for (let y = 0; y < H; y++) {
            const between: [Pos, Pos] = [{ x: wx, y }, { x: wx + 1, y }];
            if (y === doorY) walls.push({ between, door: { id: `d${wx}`, start: rng.pick(['closed', 'open', 'closed'] as const) } });
            else if (y === glassY) walls.push({ between, material: 'glass' });
            else if (rng.chance(0.85)) walls.push({ between });
        }
    }
    const free: Pos[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!'T#^/'.includes(map[y]![x]!)) free.push({ x, y });
    const take = (): Pos => free.splice(rng.int(0, free.length - 1), 1)[0]!;
    const people: PersonDef[] = [];
    for (let i = 0, n = rng.int(2, 6); i < n; i++) {
        const observer = rng.pick(['civilian', 'staff', 'enforcer'] as ObserverClass[]);
        const role = observer === 'civilian' ? 'customer' : observer === 'staff' ? rng.pick(['teller', 'manager']) : rng.pick(['guard', 'chief']);
        people.push({ id: `n${i}`, name: `n${i}`, role, observer, pos: take(), facing: rng.pick(FACINGS), schedule: randomSchedule(rng, free) });
    }
    const cameras: CameraDef[] = rng.chance(0.5) ? [{ id: 'cam', pos: take(), facings: [rng.pick(FACINGS), rng.pick(FACINGS)], room: null }] : [];
    return { world: fixtureWorld(map.map(r => r.join('')), { zones: zoneRows, walls, people, cameras }), free };
}

/** A schedule of the kinds the generator writes (M1-06): standing somewhere, or a route there and back, changing now and then. */
function randomSchedule(rng: Rng, free: readonly Pos[]): ScheduleBlock[] {
    const out: ScheduleBlock[] = [];
    for (let from = 1; from <= 4; from += rng.int(1, 3)) {
        const kind = rng.int(0, 2);
        if (kind === 0) continue;
        out.push(kind === 1
            ? { from, activity: 'post', label: 'post', room: '', at: rng.pick(free), facing: rng.pick(FACINGS) }
            : { from, activity: 'patrol', label: 'patrol', room: '', route: [rng.pick(free), rng.pick(free), rng.pick(free)] });
    }
    return out;
}

function randomPath(rng: Rng, world: ReadonlyWorld, from: Pos, steps: number, occupied: Set<string>): Pos[] {
    const path: Pos[] = [];
    let at = from;
    for (let i = 0; i < steps; i++) {
        const [dx, dy] = rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]] as const);
        const p = { x: at.x + dx, y: at.y + dy };
        if (p.x < 0 || p.y < 0 || p.x >= world.width || p.y >= world.height) continue;
        if (world.tiles[p.y * world.width + p.x]!.blocksMove || occupied.has(`${p.x},${p.y}`)) continue;
        path.push(p);
        at = p;
    }
    return path;
}

type Effect = Record<string, { exposed: boolean; pips: number; challenged: boolean }>;

function effectOf(state: State, crew: string): Effect {
    const out: Effect = {};
    for (const n of state.npcs) out[n.id] = { exposed: n.exposedTo.includes(crew), pips: n.suspicion[crew] ?? 0, challenged: n.challenges.some(c => c.crew === crew) };
    return out;
}

/** What the sightings do, by the design's words (§8.5–8.7), independently of how the rules apply them. */
function predict(state: State, crew: string, sightings: readonly Sighting[]): Effect {
    const e = effectOf(state, crew);
    // A crew member has at most one challenge pending; exposure ends the exposer's, and then another NPC may challenge.
    const challenged = (): boolean => Object.values(e).some(x => x.challenged);
    for (const s of sightings) {
        if (s.by === 'camera') continue;
        const npc = state.npcs.find(n => n.id === s.observer)!;
        const x = e[s.observer]!;
        if (EYES_DOWN.has(npc.status) || x.exposed) continue;
        if (s.outcome === '!') Object.assign(x, { exposed: true, pips: 3, challenged: false });
        else if (s.outcome === '+1' || s.outcome === '+2') {
            x.pips = Math.min(3, x.pips + (s.outcome === '+1' ? 1 : 2));
            if (x.pips >= 3) Object.assign(x, { exposed: true, challenged: false });
        } else if (s.outcome === 'T' && !challenged()) x.challenged = true;
    }
    return e;
}

const occupiedBy = (state: State): Set<string> => new Set([...state.npcs, ...state.crew].map(p => `${p.pos.x},${p.pos.y}`));

describe('perception previews (property)', () => {
    it(`match the outcome over ${WORLDS} random worlds`, () => {
        const rng = new Rng(20261014);
        const failures: string[] = [];
        let moves = 0, acting = 0, deadlines = 0, worldActing = 0, walked = 0, frisks = 0, preCases = 0;
        for (let w = 0; w < WORLDS; w++) {
            const { world, free } = makeWorld(rng);
            const crew = [0, 1].map(i => ({ id: `c${i}`, pos: free.splice(rng.int(0, free.length - 1), 1)[0]!, ...rng.pick(LOADOUTS) }));
            let state = initialState(world, { seed: w, crew });
            for (const npc of state.npcs) {
                npc.alerted = rng.chance(0.25);
                if (rng.chance(0.1)) npc.status = 'commanded';
                const path = randomPath(rng, world, npc.pos, rng.int(0, 4), occupiedBy(state));
                npc.intent = rng.chance(0.5) ? { path, facing: rng.pick(FACINGS) } : { path };
            }
            for (let turn = 0; turn < 4; turn++) {
                // The hatched overlay of the turn's last move, taken before it: its tile's world phase.
                let lastPre: { crew: string; found: Sighting[] } | undefined;
                for (let k = 0; k < 3; k++) {
                    const member = rng.pick(state.crew);
                    if (member.actionsLeft < 1) continue;
                    const path = randomPath(rng, world, member.pos, rng.int(1, 6), occupiedBy(state));
                    if (!path.length || !validatePath(world, state, member.pos, path, moveBudget(world, member), crewMoveOptions(member)).ok) continue;
                    const judged = assessPath(world, state, member.id, path);
                    const all = [...judged.steps, ...judged.end];
                    const expected = predict(state, member.id, all);
                    const pre = { crew: member.id, found: assessWorldPhase(world, state, sightMap(world, state), member.id, path[path.length - 1]!) };
                    const result = commit(world, state, { type: 'move', crew: member.id, path });
                    // The overlay knows the tile, not the way there: a door the move leaves open is the path's (M1-09).
                    lastPre = result.events.some(e => e.type === 'doorOpened') ? undefined : pre;
                    moves++;
                    const quiet = !all.some(s => s.outcome !== '-');
                    if (!quiet) acting++;
                    const got = effectOf(result.state, member.id);
                    if (JSON.stringify(got) !== JSON.stringify(expected)) failures.push(`world ${w} move ${JSON.stringify(path)}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
                    // Seeing something new (rules/knowledge.ts) makes a quiet move final too.
                    const revealed = result.events.some(e => e.type === 'revealed');
                    if ((quiet && !revealed) !== result.undoable) failures.push(`world ${w} move ${JSON.stringify(path)}: undoable ${result.undoable}, predicted ${quiet && !revealed}`);
                    state = result.state;
                }
                const sight = sightMap(world, state);
                const before: Record<string, Effect> = {}, expected: Record<string, Effect> = {};
                for (const c of state.crew) {
                    const found = assessWorldPhase(world, state, sight, c.id, c.pos);
                    if (found.length) worldActing++;
                    if (found.some(s => s.why.includes('trespass'))) deadlines++;
                    if (found.some(s => s.why.includes('frisk') || s.why.includes('told'))) frisks++;
                    before[c.id] = effectOf(state, c.id);
                    expected[c.id] = predict(state, c.id, found);
                    // A challenge falling due ends, whatever its outcome.
                    const due = dueChallenge(state, c.id);
                    if (due) expected[c.id]![due.npc.id]!.challenged = false;
                }
                if (lastPre) {
                    expected.pre = predict(state, lastPre.crew, lastPre.found);
                    const due = dueChallenge(state, lastPre.crew);
                    if (due) expected.pre[due.npc.id]!.challenged = false;
                    before.pre = effectOf(state, lastPre.crew);
                    preCases++;
                }
                const committed: Record<string, Intent> = Object.fromEntries(state.npcs.map(n => [n.id, n.intent]));
                const result = commit(world, state, { type: 'endTurn' });
                // Every NPC walks its committed intent: all of it, or the start of it when the crew stood in its way.
                const blocked = new Set(result.events.flatMap(e => (e.type === 'npcBlocked' ? [e.npc] : [])));
                for (const e of result.events) {
                    if (e.type !== 'npcWalked') continue;
                    walked++;
                    const path = committed[e.npc]!.path;
                    const ok = blocked.has(e.npc) ? e.path.length < path.length && JSON.stringify(path.slice(0, e.path.length)) === JSON.stringify(e.path)
                        : JSON.stringify(path) === JSON.stringify(e.path);
                    if (!ok) failures.push(`world ${w} turn ${turn} ${e.npc}: walked ${JSON.stringify(e.path)}, committed ${JSON.stringify(path)}`);
                }
                const checks = [...state.crew.map(c => ({ key: c.id, crew: c.id })), ...(lastPre ? [{ key: 'pre', crew: lastPre.crew }] : [])];
                for (const c of checks) {
                    const got = effectOf(result.state, c.crew);
                    for (const id of Object.keys(got)) {
                        const g = got[id]!, e = expected[c.key]![id]!, b = before[c.key]![id]!;
                        // Pips that weren't raised may decay; raised ones must be exactly as predicted.
                        const pipsWrong = e.pips > b.pips ? g.pips !== e.pips : g.pips > b.pips;
                        if (g.exposed !== e.exposed || g.challenged !== e.challenged || pipsWrong) {
                            failures.push(`world ${w} turn ${turn} ${c.key}/${id}: before ${JSON.stringify(b)}, expected ${JSON.stringify(e)}, got ${JSON.stringify(g)}`);
                        }
                    }
                }
                state = result.state;
            }
        }
        expect(failures.slice(0, 10)).toEqual([]);
        // The sample has to exercise the rules, not only quiet floors.
        expect(moves).toBeGreaterThan(WORLDS * 3);
        expect(acting).toBeGreaterThan(WORLDS / 4);
        expect(worldActing).toBeGreaterThan(WORLDS / 4);
        expect(deadlines).toBeGreaterThan(0);
        // NPCs walk their schedules and their investigations, and the overlay foresees frisks.
        expect(walked).toBeGreaterThan(WORLDS);
        expect(frisks).toBeGreaterThan(0);
        expect(preCases).toBeGreaterThan(WORLDS * 2);
    }, Math.max(10_000, WORLDS * 20));
});
