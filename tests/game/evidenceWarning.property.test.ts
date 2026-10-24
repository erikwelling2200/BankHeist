import { describe, expect, it } from 'vitest';
import { evidenceWarnings, type EvidenceWarning } from '../../src/game/evidenceWarning';
import { archetypesFor } from '../../src/gen/generate';
import { TIERS } from '../../src/gen/model';
import { Rng } from '../../src/gen/rng';
import {
    clonePlain, commit, FACINGS, fixtureWorld, IllegalCommand, initialState, previewPicture, safeFloor, tileVisibility, worldFromBank, type CameraDef, type FixtureWall,
    type ObserverClass, type PersonDef, type Pos, type ReadonlyWorld, type ScheduleBlock, type SimEvent, type State
} from '../../src/sim';
import { cachedBank } from '../bankCache';

/*
 * The promise of the evidence warning (src/game/evidenceWarning.ts): random play on random fixtures and generated banks,
 * bodies knocked out at random tiles the crew sees this turn (known, as a knockout leaves them), then before each end
 * of the turn the warning is taken and the world phase run on the truth and on the crew's picture:
 *
 * - **Never unwarned**: evidence the crew knows of that the world phase notices (any NPC or camera, known or not) is
 *   always shown, certain or uncertain.
 * - **Certain is certain**: every certain finder notices it on the picture (the same rules), and on the truth too (a
 *   camera only once the CCTV room is scouted: an unknown feed counts as live).
 *
 * EVIDENCE_PROBE_SCALE=10 runs ten times as much.
 */

const SCALE = Number(process.env.EVIDENCE_PROBE_SCALE ?? 1);
const SEED = Number(process.env.EVIDENCE_PROBE_SEED ?? 20261024);
const FIXTURES = Math.round(30 * SCALE), BANKS = Math.max(1, Math.round(2 * SCALE)), TURNS = 4;
const W = 16, H = 10;

interface Tally { checks: number; certain: number; uncertain: number; none: number; noticed: number; failures: string[] }

function schedule(rng: Rng, free: readonly Pos[]): ScheduleBlock[] {
    const out: ScheduleBlock[] = [];
    for (let from = 1; from <= 5; from += rng.int(1, 2)) {
        out.push(rng.chance(0.4)
            ? { from, activity: 'post', label: 'post', room: '', at: rng.pick(free), facing: rng.pick(FACINGS) }
            : { from, activity: 'patrol', label: 'patrol', room: '', route: [rng.pick(free), rng.pick(free), rng.pick(free)] });
    }
    return out;
}

/** Three rooms split by walls with a door (some lockable) and a pane of glass each, NPCs of every class, a camera at times. */
function fixture(rng: Rng): { world: ReadonlyWorld; free: Pos[] } {
    const zones = ['.', 's', 'x'] as const, z = [rng.pick(zones), rng.pick(zones), rng.pick(zones)];
    const map: string[] = [], zoneRows: string[] = [];
    for (let y = 0; y < H; y++) {
        let row = '', zr = '';
        for (let x = 0; x < W; x++) {
            const zone = z[x < 6 ? 0 : x < 11 ? 1 : 2]!, r = rng.next();
            row += r < 0.04 ? 'T' : r < 0.07 ? '#' : zone;
            zr += zone;
        }
        map.push(row);
        zoneRows.push(zr);
    }
    const walls: FixtureWall[] = [];
    for (const wx of [5, 10]) {
        const doorY = rng.int(0, H - 1), glassY = rng.int(0, H - 1);
        for (let y = 0; y < H; y++) {
            const between: [Pos, Pos] = [{ x: wx, y }, { x: wx + 1, y }];
            if (y === doorY) {
                const lock = rng.pick(['none', 'none', 'mechanical'] as const);
                walls.push({ between, door: { id: `d${wx}`, lock, start: rng.pick(lock === 'none' ? ['closed', 'open'] as const : ['locked', 'open'] as const) } });
            } else if (y === glassY) walls.push({ between, material: 'glass' });
            else if (rng.chance(0.85)) walls.push({ between });
        }
    }
    const free: Pos[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!'T#'.includes(map[y]![x]!)) free.push({ x, y });
    const pool = [...free], take = (): Pos => pool.splice(rng.int(0, pool.length - 1), 1)[0]!;
    const people: PersonDef[] = [];
    for (let i = 0, n = rng.int(3, 7); i < n; i++) {
        const observer = rng.pick(['civilian', 'staff', 'enforcer'] as ObserverClass[]);
        const role = observer === 'civilian' ? 'customer' : observer === 'staff' ? 'teller' : 'guard';
        people.push({ id: `n${i}`, name: `n${i}`, role, observer, pos: take(), facing: rng.pick(FACINGS), schedule: schedule(rng, free) });
    }
    const cameras: CameraDef[] = rng.chance(0.5) ? [{ id: 'cam', pos: take(), facings: [rng.pick(FACINGS), rng.pick(FACINGS)], room: null }] : [];
    const rules = { checkInPeriod: 3, dispatchCheckInPeriod: 3, dispatchSilence: 3 };
    return { world: fixtureWorld(map, { zones: zoneRows, walls, people, cameras, rules }), free };
}

/** Knocks out an NPC on a tile the crew sees this turn, as the knockout leaves it: the crew saw it go down. */
function bodyAt(world: ReadonlyWorld, state: State, rng: Rng): void {
    const up = state.npcs.filter(n => n.status !== 'away' && n.status !== 'unconscious' && n.status !== 'dead' && n.status !== 'tied' && n.stashed === null);
    if (!up.length) return;
    const npc = rng.pick(up), taken = new Set([...state.crew.map(c => `${c.pos.x},${c.pos.y}`), ...state.npcs.filter(n => n !== npc).map(n => `${n.pos.x},${n.pos.y}`)]);
    // Half the time near someone else, so known walks pass by.
    const near = rng.chance(0.5) ? rng.pick(state.npcs).pos : null;
    const tiles: Pos[] = [];
    for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
        const p = { x, y };
        if (world.tiles[y * world.width + x]!.blocksMove || taken.has(`${x},${y}`) || tileVisibility(world, state, p) !== 'seen') continue;
        if (near && Math.max(Math.abs(x - near.x), Math.abs(y - near.y)) > 6) continue;
        tiles.push(p);
    }
    if (!tiles.length) return;
    const at = rng.pick(tiles);
    Object.assign(npc, { pos: at, status: rng.chance(0.85) ? 'unconscious' : 'tied', outCold: state.turn + 3, intent: { path: [] }, goal: { kind: 'still' }, route: null, search: null });
    if (npc.status === 'tied') npc.outCold = null;
    state.knowledge.npcs[npc.id] = { at: { ...at }, facing: npc.facing, turn: state.turn, live: true, routine: false, rota: false, watched: 1, watchedTurn: state.turn, tick: state.knowledge.phaseTick + 1 };
}

const noticed = (events: readonly SimEvent[]): { by: string; evidence: string }[] => events.flatMap(e =>
    e.type === 'evidenceNoticed' ? [{ by: e.npc, evidence: e.evidence }] : e.type === 'cameraSawEvidence' ? [{ by: e.camera, evidence: e.evidence }] : []);

/** The warning against the world phase on the truth and on the picture. */
function check(world: ReadonlyWorld, state: State, label: string, t: Tally): void {
    const warnings = evidenceWarnings(world, state), byId = new Map<string, EvidenceWarning>(warnings.map(w => [w.id, w]));
    if (!warnings.length) return;
    t.checks++;
    for (const w of warnings) t[w.level]++;
    const truth = noticed(commit(world, state, { type: 'endTurn' }).events), picture = noticed(commit(world, previewPicture(world, state), { type: 'endTurn' }).events);
    for (const n of truth) {
        const w = byId.get(n.evidence);
        if (!w) continue;
        t.noticed++;
        if (w.level === 'none') t.failures.push(`${label}: ${n.by} noticed ${n.evidence} at (${w.pos.x}, ${w.pos.y}), shown without a warning`);
    }
    for (const w of warnings) for (const f of w.certain) {
        if (!picture.some(n => n.by === f.id && n.evidence === w.id)) t.failures.push(`${label}: ${f.id} certain to find ${w.id}, not on the picture`);
        if ((f.by === 'npc' || state.knowledge.cctv) && !truth.some(n => n.by === f.id && n.evidence === w.id)) t.failures.push(`${label}: ${f.id} certain to find ${w.id}, not in truth`);
    }
}

/** Plays `turns` turns: each crew member moves to a random tile of its Move band, bodies go down, then the check and the end of the turn. */
function play(world: ReadonlyWorld, start: State, rng: Rng, label: string, t: Tally): void {
    let state = start;
    for (let turn = 0; turn < TURNS && !state.bank.alarm && state.phase === 'crew'; turn++) {
        for (const member of state.crew) {
            const tiles = safeFloor(world, state, member.id, { bands: ['move'] }).tiles.filter(x => x.band === 'move' && x.path.length);
            if (!tiles.length || rng.chance(0.25)) continue;
            try {
                state = commit(world, state, { type: 'move', crew: member.id, path: rng.pick(tiles).path }).state;
            } catch (e) {
                if (!(e instanceof IllegalCommand)) throw e;
            }
        }
        const s = clonePlain(state);
        for (let i = rng.int(1, 3); i > 0; i--) bodyAt(world, s, rng);
        check(world, s, `${label} turn ${turn}`, t);
        state = commit(world, s, { type: 'endTurn' }).state;
    }
}

describe('the evidence warning (property)', () => {
    it('never leaves evidence the world phase notices unwarned, and a certain finder always finds it', () => {
        const t: Tally = { checks: 0, certain: 0, uncertain: 0, none: 0, noticed: 0, failures: [] };
        const rng = new Rng(SEED);
        for (let i = 0; i < FIXTURES; i++) {
            const { world, free } = fixture(rng);
            const taken = new Set(world.people.map(p => `${p.pos.x},${p.pos.y}`)), spots = free.filter(p => !taken.has(`${p.x},${p.y}`));
            const crew = [0, 1].map(k => ({ id: `c${k}`, pos: spots.splice(rng.int(0, spots.length - 1), 1)[0]! }));
            play(world, initialState(world, { seed: i, crew }), rng, `fixture ${i}`, t);
        }
        for (let b = 0; b < BANKS; b++) {
            const tier = TIERS[b % TIERS.length]!, archetype = archetypesFor(tier)[b % archetypesFor(tier).length]!;
            const world = worldFromBank(cachedBank({ layout: 5200 + b * 37, population: b + 3, tier, archetype, plot: 'midBlock' }));
            const brng = new Rng(SEED + b), free: Pos[] = [];
            world.tiles.forEach((tile, i) => { if (!tile.blocksMove && tile.room !== null) free.push({ x: i % world.width, y: Math.floor(i / world.width) }); });
            const taken = new Set(world.people.map(p => `${p.pos.x},${p.pos.y}`));
            const crew = [0, 1, 2].map(k => {
                const near = brng.pick(world.people).pos;
                const c = free.filter(p => !taken.has(`${p.x},${p.y}`) && Math.max(Math.abs(p.x - near.x), Math.abs(p.y - near.y)) <= 5);
                const pos = brng.pick(c.length ? c : free);
                taken.add(`${pos.x},${pos.y}`);
                return { id: `c${k}`, pos };
            });
            play(world, initialState(world, { seed: b, crew }), brng, `${tier}/${archetype}`, t);
        }
        if (process.env.EVIDENCE_PROBE_VERBOSE) process.stderr.write(`${JSON.stringify({ ...t, failures: t.failures.length })}\n`);
        expect(t.failures.slice(0, 10)).toEqual([]);
        // It saw each kind of verdict, and the world phase noticing shown evidence.
        expect(t.certain).toBeGreaterThan(0);
        expect(t.uncertain).toBeGreaterThan(0);
        expect(t.none).toBeGreaterThan(0);
        expect(t.noticed).toBeGreaterThan(0);
    }, 120_000);
});
