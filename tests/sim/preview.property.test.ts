import { describe, expect, it } from 'vitest';
import { archetypesFor } from '../../src/gen/generate';
import { cachedBank } from '../bankCache';
import { PLOTS, TIERS } from '../../src/gen/model';
import { Rng } from '../../src/gen/rng';
import {
    actionPreview, carriersStarted, DEAF_STATUSES, clonePlain, commit, crewBudget, crewMoveOptions, decodeBits, doorDoubt, effectKind, effectOf, encodeBits, explain, FACINGS, hearing,
    isKnownNow, fixtureWorld, initialState, hashOf, legalActions, noiseRadius, npcsInside, onFloor, pathSafety, pendingCarriers, planningState, previewCertain, previewPicture,
    projectCarriers, projectEvents, projectPreviewEvents, safeFloor, safeFloorJob, sightDoubted, soundRing, TINT_RANK, tintOf, validatePath, withDoubtedShut, worldFromBank,
    type CameraDef, type Command, type CrewStart, type DoorStatus, type Effect, type FixtureWall, type FloorTile, type ObserverClass, type PersonDef, type Pos, type ReadonlyWorld,
    type SafeFloor, type ScheduleBlock, type SimEvent, type State, type WorldObject
} from '../../src/sim';
import { dashRing, judgeFor } from '../../src/sim/preview/floor';

/*
 * THE promise of §8.8 (implementation plan §2.2, M1-09): what the safe floor, a drawn path and an action's preview
 * show is what happens. Seeded random play on random fixtures and on generated banks (every tier × archetype, the
 * plots in turn); random legal commands (moves and dashes to a tile of the safe floor or along a random drawn path,
 * and every action `legalActions` offers: doors, knockouts, drags, drops, stashes, panel work, looping, answering,
 * jammers, waits). Before each move the tile's tint is taken; after it, compared:
 *
 * 1. **Same rules.** The move and then the end of the turn are committed on the crew's picture (`previewPicture`, the
 *    state the safe floor judges): the crew-phase effect on the crew member (Exposed, pips per NPC, a challenge, a
 *    camera report, being seen by someone who knows them) and the world phase's must equal the tile's `now` and `next`
 *    exactly. 0 differences, everywhere.
 * 2. **As the crew perceives it.** The real move (and, now and then, the real end of the turn right after it) on the
 *    truth, its effects by the NPCs and cameras the crew knew of: in omniscient runs (the crew knows every NPC and the
 *    CCTV room) they must equal the prediction exactly; otherwise a difference must come from what the crew can't
 *    know (a move cut by someone unseen, an unseen NPC acting on the crew member first or changing a known NPC's walk,
 *    a camera of unknown feed status that is off), and each is counted by class.
 * 3. **Never green but spotted** (decision 24, the fresh-tile rule): a tile shown green never gets the crew member
 *    spotted by anyone, known or not, during the move; in the world phase only the known NPCs' walks are promised, so
 *    unknown NPCs walking in are counted, not failed.
 * 4. **Doors not seen this turn** (decision 44): the safe floor is the same whatever such a door really is (each
 *    floor is judged again with every doubted door flipped); a move cut at a door found locked (`door` cuts, made
 *    likely by lockable doors that NPCs walk through and that relock unseen, and by a scenario of its own) is one the
 *    floor hatched as reached through it (`unknownPath`); a difference on a tile hatched for a door (`doorRisk`) is put
 *    down to it.
 *
 * Before every end of the turn, each crew member's own tile (`stay`) is checked the same way: so every action is
 * followed by a world phase the overlay foresaw. Action previews are checked against their commits (projected events,
 * the carriers they start, the noise's ears), drawn paths against `pathSafety` and the eye, and the dash ring against
 * `soundRing` of the whole path.
 *
 * PREVIEW_PROBE_SCALE=10 npm test -- preview.property runs ten times as much (PREVIEW_PROBE_SEED another sample,
 * PREVIEW_PROBE_VERBOSE=1 prints the counts and the safe floor's timings).
 */

const SCALE = Number(process.env.PREVIEW_PROBE_SCALE ?? 1);
const SEED = Number(process.env.PREVIEW_PROBE_SEED ?? 20261015);
const VERBOSE = !!process.env.PREVIEW_PROBE_VERBOSE;
const FIXTURES = Math.round(40 * SCALE);
const DOOR_RUNS = Math.round(12 * SCALE);
const DOUBT_RUNS = Math.round(24 * SCALE);
const BANK_SEEDS = Number(process.env.PREVIEW_PROBE_BANKS ?? Math.max(1, Math.round(SCALE)));
const FIXTURE_TURNS = 4, BANK_TURNS = Math.round(6 * Math.min(SCALE, 2));
/**
 * Generating the banks takes most of the time (0.4–1.4 s each), so the default run (`npm test`, which must stay under
 * 30 s) leaves out every fourth tier × archetype (a different fourth for each bank seed); scaled runs play them all.
 */
const BANK_SKIP = SCALE > 1 || process.env.PREVIEW_PROBE_BANKS ? 0 : 4;
const W = 14, H = 10;

// ---------------------------------------------------------------------------------------------------------- Worlds

const LOADOUTS: readonly Partial<CrewStart>[] = [
    {}, {}, {}, { items: ['pistol'] }, { items: ['assaultRifle'] }, { masked: true }, { uniform: 'staff' }, { uniform: 'staff', items: ['pistol'] },
    { notoriety: 2 }, { notoriety: 4, items: ['pistol'] }, { items: ['duffel'], packed: ['smg'] }
];

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

/** Three zones split by walls with a door and a pane of glass each, tall and low objects, NPCs of every class, cameras, panels. */
function fixture(rng: Rng): { world: ReadonlyWorld; free: Pos[] } {
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
    const walls: FixtureWall[] = [];
    for (const wx of [4, 9]) {
        const doorY = rng.int(0, H - 1), glassY = rng.int(0, H - 1);
        for (let y = 0; y < H; y++) {
            const between: [Pos, Pos] = [{ x: wx, y }, { x: wx + 1, y }];
            if (y === doorY) {
                const lock = rng.pick(['none', 'none', 'mechanical'] as const);
                walls.push({ between, door: { id: `d${wx}`, lock, start: rng.pick(lock === 'none' ? ['closed', 'open', 'closed'] as const : ['locked', 'open', 'locked'] as const) } });
            } else if (y === glassY) walls.push({ between, material: 'glass' });
            else if (rng.chance(0.85)) walls.push({ between });
        }
    }
    const free: Pos[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!'T#'.includes(map[y]![x]!)) free.push({ x, y });
    const take = (): Pos => free.splice(rng.int(0, free.length - 1), 1)[0]!;
    const people: PersonDef[] = [];
    for (let i = 0, n = rng.int(2, 6); i < n; i++) {
        const observer = rng.pick(['civilian', 'staff', 'enforcer'] as ObserverClass[]);
        const role = observer === 'civilian' ? 'customer' : observer === 'staff' ? rng.pick(['teller', 'manager', 'operator']) : rng.pick(['guard', 'chief']);
        people.push({ id: `n${i}`, name: `n${i}`, role, observer, pos: take(), facing: rng.pick(FACINGS), schedule: randomSchedule(rng, free) });
    }
    const cameras: CameraDef[] = rng.chance(0.5) ? [{ id: 'cam', pos: take(), facings: [rng.pick(FACINGS), rng.pick(FACINGS)], room: null }] : [];
    const objects: WorldObject[] = [];
    if (rng.chance(0.5)) objects.push({ id: 'panel', kind: 'alarmPanel', pos: take(), facing: 's' });
    if (rng.chance(0.5)) {
        const at = take();
        objects.push({ id: 'desk', kind: 'cctvDesk', pos: at, facing: 's', monitors: 1 }, { id: 'rec', kind: 'recorder', pos: at, facing: 's' });
    }
    const rules = { checkInPeriod: 2, dispatchCheckInPeriod: 2, dispatchSilence: 2 };
    return { world: fixtureWorld(map.map(r => r.join('')), { zones: zoneRows, walls, people, cameras, objects, rules }), free };
}

const QUIET: readonly Partial<CrewStart>[] = [{}, {}, { uniform: 'staff' }];

function crewFor(rng: Rng, n: number, pick: () => Pos, stealth = false): CrewStart[] {
    return Array.from({ length: n }, (_, i) => {
        const loadout = rng.pick(stealth ? QUIET : LOADOUTS), gadget = rng.chance(0.5) ? ['hackingKit'] : rng.chance(0.15) ? ['jammer'] : [];
        return { id: `c${i}`, pos: pick(), ...loadout, items: [...(loadout.items ?? []), ...gadget], ...(rng.chance(0.2) ? { traits: [rng.pick(['steadyHands', 'smoothTalker'])] } : {}) };
    });
}

/** The crew knows everything: every tile seen this phase, every NPC where it is and its routine, the cameras and the CCTV room. */
function omniscient(world: ReadonlyWorld, state: State): State {
    const s = clonePlain(state);
    const k = s.knowledge;
    k.seen = k.fresh = encodeBits(new Uint8Array(world.width * world.height).fill(1));
    k.cameras = world.cameras.map(c => c.id).sort();
    k.cctv = true;
    for (const n of s.npcs) {
        k.npcs[n.id] = { at: { ...n.pos }, facing: n.facing, turn: s.turn, live: true, routine: true, rota: false, watched: 3, watchedTurn: s.turn, tick: k.tick + 1 };
    }
    return s;
}

// ---------------------------------------------------------------------------------------------------------- Effects

/** The NPCs the crew sees or predicts: the only ones the picture puts on the map. */
const knownIds = (world: ReadonlyWorld, state: State): Set<string> => new Set(state.npcs.filter(n => isKnownNow(world, state, n.id)).map(n => n.id));

const quiet = (e: Effect): boolean => !e.exposed.length && !e.watching.length && !e.cameras.length && e.challenged === null && !Object.keys(e.pips).length;
const show = (e: Effect | null): string => JSON.stringify(e);

/** An effect restricted to the observers the crew knew of (the NPCs of its picture and the cameras it knows). */
function known(e: Effect, npcs: ReadonlySet<string>, cameras: ReadonlySet<string>): Effect {
    const pips: Record<string, number> = {};
    for (const id of Object.keys(e.pips)) if (npcs.has(id)) pips[id] = e.pips[id]!;
    return {
        exposed: e.exposed.filter(id => npcs.has(id)), watching: e.watching.filter(id => npcs.has(id)), pips,
        challenged: e.challenged !== null && npcs.has(e.challenged) ? e.challenged : null, cameras: e.cameras.filter(id => cameras.has(id))
    };
}

/**
 * An effect without the NPCs whose world-phase sightings a tile counts only as far as certain (`unsure`: they react to
 * what a door in doubt decides, or such a door could stop their walk), which the oracle walks in full.
 */
const sure = (e: Effect, tile: FloorTile, npcs: ReadonlySet<string>, cameras: ReadonlySet<string>): Effect =>
    (tile.unsure.length ? known(e, new Set([...npcs].filter(id => !tile.unsure.includes(id))), cameras) : e);

const hidden = (e: Effect, npcs: ReadonlySet<string>, cameras: ReadonlySet<string>): boolean =>
    e.exposed.some(id => !npcs.has(id)) || e.watching.some(id => !npcs.has(id)) || Object.keys(e.pips).some(id => !npcs.has(id))
    || (e.challenged !== null && !npcs.has(e.challenged)) || e.cameras.some(id => !cameras.has(id));

// ---------------------------------------------------------------------------------------------------------- The probe

interface Stats { [k: string]: number }

class Probe {
    failures: string[] = [];
    stats: Stats = {};
    floorMs: Record<string, number[]> = {};
    bump(k: string, n = 1): void { this.stats[k] = (this.stats[k] ?? 0) + n; }
    fail(msg: string): void { if (this.failures.length < 50) this.failures.push(msg); }
}

interface Run { world: ReadonlyWorld; rng: Rng; omniscient: boolean; label: string; tier: string; probe: Probe; stealth?: boolean }

/** Checks a tile's prediction (`now`, and `next` when the turn ends right after) against the picture's oracle and the truth. */
function checkMove(run: Run, state: State, crew: string, cmd: Extract<Command, { type: 'move' | 'dash' }>, tile: FloorTile, endTurn: boolean): State {
    const { world, probe } = run;
    const picture = previewPicture(world, state);
    const npcs = knownIds(world, state), cameras = new Set(world.cameras.filter(c => picture.cameras[c.id]?.live).map(c => c.id));
    const at = `${run.label} t${state.turn} ${cmd.type} ${crew}→${JSON.stringify(tile.pos)} [${tile.tint.kind}${tile.tint.hatched ? ' hatched' : ''}]`;
    // 1. Same rules: the move and the world phase on the picture.
    const o1 = commit(world, picture, cmd);
    const oNow = effectOf(o1.events, crew, picture);
    if (show(oNow) !== show(tile.now)) probe.fail(`${at}: now ${show(tile.now)}, the rules on the picture ${show(oNow)}`);
    // A dash's noise turns the known NPCs it sends to look at once (decision 45): what they see is in `now`.
    const turned = picture.npcs.filter(n => o1.state.npcs.find(m => m.id === n.id)?.facing !== n.facing).map(n => n.id);
    if (turned.length) {
        probe.bump('moves turning a known NPC');
        if (turned.some(id => observersOf(tile.now).includes(id))) probe.bump('moves seen by an NPC they turned');
    }
    const o2 = tile.next || endTurn ? commit(world, o1.state, { type: 'endTurn' }) : null;
    if (tile.next) {
        const oNext = sure(effectOf(o2!.events, crew, o1.state), tile, npcs, cameras);
        if (show(oNext) !== show(sure(tile.next, tile, npcs, cameras))) probe.fail(`${at}: next ${show(tile.next)}, the rules on the picture ${show(oNext)}`);
    }
    probe.bump('oracle checks');
    // 2. The truth, as the crew perceives it.
    const r = commit(world, state, cmd);
    checkCertainEvents(run, state, cmd, crew, r);
    const tNowAll = effectOf(r.events, crew, state), tNow = known(tNowAll, npcs, cameras);
    const cutBy = r.events.find((e): e is Extract<SimEvent, { type: 'moveCut' }> => e.type === 'moveCut'), cut = !!cutBy;
    if (cutBy?.reason === 'door') {
        // M2: the floor never vouches for a path through a door that could be locked.
        probe.bump('truth: move cut by a door');
        if (!tile.unknownPath) probe.fail(`${at}: cut at door ${cutBy.door} (${cutBy.status}), but the path wasn't hatched`);
    } else if (cut) probe.bump('truth: move cut by someone unseen');
    else if (show(tNow) !== show(tile.now)) {
        const runs: Runs = { truth: { before: state, after: r.state, events: r.events }, picture: { before: picture, after: o1.state, events: o1.events } };
        const why = classify(run, state, crew, tile.now, tNow, tNowAll, npcs, cameras, runs, tile);
        if (why) probe.bump(`truth now differs: ${why}`);
        else probe.fail(`${at}: now ${show(tile.now)}, the truth ${show(tNow)} (all ${show(tNowAll)})`);
    } else probe.bump('truth now equal');
    // 3. Never green but spotted, during the move.
    if (tile.tint.kind === 'safe') {
        probe.bump('green moves');
        if (!quiet(tNowAll)) {
            probe.bump('green but spotted now');
            probe.fail(`${at}: green, but the move got them spotted: ${show(tNowAll)} path ${JSON.stringify(tile.path)}`);
        }
    }
    if (!endTurn || cut) return r.state;
    const e = commit(world, r.state, { type: 'endTurn' });
    checkWorldPhase(run, state, crew, tile, r.state, e, npcs, cameras, at, { before: o1.state, after: o2!.state, events: o2!.events });
    return e.state;
}

/** The world phase that followed a prediction, on the truth (and the same world phase on the picture). */
function checkWorldPhase(
    run: Run, judged: State, crew: string, tile: FloorTile, before: State, truth: { state: State; events: readonly SimEvent[] }, npcs: ReadonlySet<string>,
    cameras: ReadonlySet<string>, at: string, picture: Runs['picture']
): void {
    const { probe } = run;
    const all = effectOf(truth.events, crew, before), seen = known(all, npcs, cameras);
    if (tile.next) {
        if (show(seen) !== show(tile.next)) {
            const runs: Runs = { truth: { before, after: truth.state, events: truth.events }, picture };
            const why = classify(run, judged, crew, tile.next, seen, all, npcs, cameras, runs, tile);
            if (why) probe.bump(`truth next differs: ${why}`);
            else probe.fail(`${at}: next ${show(tile.next)}, the truth ${show(seen)} (all ${show(all)})`);
        } else probe.bump('truth next equal');
    }
    if (tile.tint.kind === 'safe' && tile.next) {
        probe.bump('green world phases');
        if (!quiet(all)) {
            const byUnknown = hidden(all, npcs, cameras);
            probe.bump(byUnknown ? 'green but spotted next: by someone the crew does not know' : 'green but spotted next: by a known NPC');
            if (!byUnknown && show(seen) !== show(tile.next)) {
                const runs: Runs = { truth: { before, after: truth.state, events: truth.events }, picture };
                if (!classify(run, judged, crew, tile.next, seen, all, npcs, cameras, runs, tile)) probe.fail(`${at}: green, but the world phase got them spotted by someone known: ${show(all)}`);
            }
        }
    }
}

/** The known NPCs as they stand: where, how, and what they mean to do. */
const snap = (s: State, ids: ReadonlySet<string>): string =>
    JSON.stringify(s.npcs.filter(n => ids.has(n.id)).map(n => [n.id, n.pos, n.status, n.alerted, n.facing, n.intent, n.wants, n.exposedTo, n.suspicion]));

/** The walks the known NPCs took in a world phase. */
const walksOf = (events: readonly SimEvent[], ids: ReadonlySet<string>): string =>
    JSON.stringify(events.flatMap(e => (e.type === 'npcWalked' && ids.has(e.npc) ? [[e.npc, e.path]] : [])));

/** The truth and the picture's run of the same commands, to tell what the unknown NPCs changed. */
interface Runs { truth: { before: State; after: State; events: readonly SimEvent[] }; picture: { before: State; after: State; events: readonly SimEvent[] } }

/**
 * Why the truth may differ from the picture's prediction: only what the crew can't know. Null: it may not. A difference
 * is put down to NPCs the crew doesn't know only when they acted on the crew member themselves, told a known NPC, or
 * left a known NPC walking or standing otherwise than on the picture.
 */
function classify(
    run: Run, state: State, crew: string, predicted: Effect, seen: Effect, all: Effect, npcs: ReadonlySet<string>, cameras: ReadonlySet<string>, runs: Runs,
    tile?: FloorTile
): string | null {
    if (tile?.doorRisk && doorDoubt(run.world, state)) return 'a door not seen this turn decides it (hatched)';
    const tint = (e: Effect): FloorTile['tint'] => tintOf(e, null, 'scouted', false);
    if (doorDoubt(run.world, state) && effectKind(predicted) === 'red' && atLeast(tint(seen), tint(predicted))) return 'red for certain, a door not seen this turn adds to it';
    if (run.omniscient) return null;
    const camerasOnly = show({ ...predicted, cameras: [] }) === show({ ...seen, cameras: [] });
    if (camerasOnly && predicted.cameras.every(id => seen.cameras.includes(id) || !state.knowledge.cctv)) return 'a camera of unknown feed status is off';
    if (runs.truth.events.some(e => e.type === 'told' && e.crew === crew && !npcs.has(e.npc))) return 'someone unseen told a known NPC';
    if (hidden(all, npcs, cameras)) return 'someone unseen acted on them too';
    const changed = snap(runs.truth.before, npcs) !== snap(runs.picture.before, npcs) || snap(runs.truth.after, npcs) !== snap(runs.picture.after, npcs)
        || walksOf(runs.truth.events, npcs) !== walksOf(runs.picture.events, npcs);
    return changed ? 'unseen NPCs changed how known ones walked or stood' : null;
}

/** One crew command chosen at random (a move or dash to a safe-floor tile, a drawn path, or an action), checked. */
function playOne(run: Run, state: State, timing: boolean): State {
    const { world, rng, probe } = run;
    if (run.omniscient) state = omniscient(world, state);
    const ready = state.crew.filter(c => c.actionsLeft > 0);
    if (!ready.length) return state;
    const member = rng.pick(ready);
    const roll = rng.next();
    if (roll < 0.55) {
        const t0 = performance.now();
        const floor = safeFloor(world, state, member.id);
        if (timing) (probe.floorMs[run.tier] ??= []).push(performance.now() - t0);
        checkFlipped(run, state, member.id, floor);
        checkDoorVariants(run, state, member.id, floor, 1);
        const moves = floor.tiles.filter(t => t.band !== 'stay');
        if (!moves.length) return state;
        // Interesting tiles first now and then: every tint gets played.
        const warm = moves.filter(t => t.tint.kind !== 'safe' && t.tint.kind !== 'unknownRisk' && t.tint.kind !== 'grey');
        const calm = moves.filter(t => !warm.includes(t));
        const tile = warm.length && rng.chance(run.stealth ? 0.08 : 0.5) ? rng.pick(warm) : run.stealth && calm.length ? rng.pick(calm) : rng.pick(moves);
        probe.bump(`tint ${tile.tint.kind}${tile.tint.hatched ? ' hatched' : ''}`);
        probe.bump(`band ${tile.band}`);
        checkExplain(run, state, member.id, tile);
        checkDrag(run, state, member.id, tile);
        const cmd = { type: tile.band === 'dash' ? 'dash' as const : 'move' as const, crew: member.id, path: tile.path };
        if (tile.band === 'dash') checkRing(run, state, member.id, tile.path);
        probe.bump('commands');
        probe.bump(`command ${cmd.type}`);
        return checkMove(run, state, member.id, cmd, tile, rng.chance(0.35));
    }
    if (roll < 0.7) {
        // A drawn path: a random walk, judged step by step.
        const plan = onFloor(planningState(world, state));
        const path: Pos[] = [];
        let at = member.pos;
        for (let i = 0, n = rng.int(1, 10); i < n; i++) {
            const d = rng.pick(FACINGS.map(f => f));
            const step = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] }[d]!;
            const p = { x: at.x + step[0]!, y: at.y + step[1]! };
            const trial = [...path, p];
            if (!validatePath(world, plan, member.pos, trial, crewBudget(world, member, 'dash'), crewMoveOptions(member)).ok) continue;
            path.push(p);
            at = p;
        }
        if (!path.length) return state;
        const ps = pathSafety(world, state, member.id, path);
        if (!ps.ok) return state;
        probe.bump('drawn paths');
        checkEye(run, ps, path);
        // The same path from the safe floor reads the same.
        const same = safeFloor(world, state, member.id).at(path[path.length - 1]!);
        if (same && same.band === ps.mode && JSON.stringify(same.path) === JSON.stringify(path) && show(same.now) + show(same.next) !== show(ps.end.now) + show(ps.end.next)) {
            probe.fail(`${run.label}: pathSafety and safeFloor disagree on ${JSON.stringify(path)}`);
        }
        probe.bump('commands');
        probe.bump(`command ${ps.mode}`);
        return checkMove(run, state, member.id, { type: ps.mode, crew: member.id, path }, ps.end, rng.chance(0.35));
    }
    const options = legalActions(world, state, member.id).filter(c => (c.type !== 'wait' || rng.chance(0.3)) && !(run.stealth && c.type === 'knockout'));
    if (!options.length) return state;
    const kinds = [...new Set(options.map(c => c.type))];
    const kind = rng.pick(kinds);
    const cmd = rng.pick(options.filter(c => c.type === kind));
    const shown = actionPreview(world, state, cmd);
    const r = commit(world, state, cmd);
    probe.bump('commands');
    probe.bump(`command ${cmd.type}`);
    if (!shown.ok) { probe.fail(`${run.label}: ${cmd.type} refused in preview, committed`); return r.state; }
    checkCertainEvents(run, state, cmd, member.id, r);
    // The same rules: the commit with the doors the crew can't vouch for shut, as the preview judges it.
    const projected = projectPreviewEvents(world, state, commit(world, withDoubtedShut(world, state), cmd));
    if (JSON.stringify(shown.events) !== JSON.stringify(projected)) probe.fail(`${run.label}: ${cmd.type} preview events differ from its commit`);
    const started = projectCarriers(world, state, carriersStarted(r.events));
    if (JSON.stringify(shown.carriers.starts) !== JSON.stringify(started)) probe.fail(`${run.label}: ${cmd.type} carriers shown ${JSON.stringify(shown.carriers.starts)}, started ${JSON.stringify(started)}`);
    if (shown.carriers.starts.length) probe.bump('action previews starting a carrier');
    const knownNpcs = knownIds(world, state);
    for (const noise of shown.noises) {
        probe.bump('noise previews');
        const heard = projected.flatMap(e => (e.type === 'heard' && e.cause === noise.cause ? e.npcs : [])).filter(id => knownNpcs.has(id));
        const ears = noise.ears.map(e => e.npc);
        if (JSON.stringify(ears) !== JSON.stringify(heard)) probe.fail(`${run.label}: ${cmd.type} ears ${JSON.stringify(ears)}, heard ${JSON.stringify(heard)}`);
        if (ears.length) probe.bump('ears');
        // When everyone who heard it is known, the badges are what the hearers make of it in the truth (no door in doubt).
        const truth = r.events.find(e => e.type === 'noise' && e.cause === noise.cause) as Extract<SimEvent, { type: 'noise' }> | undefined;
        if (truth && truth.heard.every(id => knownNpcs.has(id)) && !doorDoubt(world, state)) {
            const ring = soundRing(world, r.state, noise.sources, noise.radius);
            const able = new Set(truth.heard);
            const real = hearing(world, { ...state, npcs: state.npcs.filter(n => !able.has(n.id) ? !npcsInside({ ...state, npcs: [n] }, ring).length : true) }, ring, noise.kind, noise.cause);
            for (const ear of noise.ears) {
                const h = real.find(x => x.npc === ear.npc);
                const want = h ? `${h.status} ${h.sent}` : 'still false';
                if (`${ear.status} ${ear.sent}` !== want) probe.fail(`${run.label}: ${cmd.type} ear of ${ear.npc} reads ${ear.status}/${ear.sent}, the truth ${want}`);
            }
            probe.bump('ear badges checked');
        }
    }
    if (shown.cost !== member.actionsLeft - r.state.crew.find(c => c.id === member.id)!.actionsLeft) probe.fail(`${run.label}: ${cmd.type} cost differs`);
    return r.state;
}

/** Ends the turn, having checked each crew member's own tile (`stay`): the world phase as the overlay foresaw it. */
function endTurn(run: Run, state: State): State {
    const { world, probe } = run;
    if (run.omniscient) state = omniscient(world, state);
    const picture = previewPicture(world, state);
    const npcs = knownIds(world, state), cameras = new Set(world.cameras.filter(c => picture.cameras[c.id]?.live).map(c => c.id));
    const stays = state.crew.map(c => ({ crew: c.id, tile: safeFloor(world, state, c.id).at(c.pos)! }));
    const oracle = commit(world, picture, { type: 'endTurn' });
    for (const { crew, tile } of stays) {
        const o = sure(effectOf(oracle.events, crew, picture), tile, npcs, cameras);
        if (show(o) !== show(sure(tile.next!, tile, npcs, cameras))) probe.fail(`${run.label} t${state.turn} stay ${crew}: next ${show(tile.next)}, the rules on the picture ${show(o)}`);
        probe.bump('stay checks');
    }
    const pending = projectCarriers(world, state, pendingCarriers(world, state));
    const r = commit(world, state, { type: 'endTurn' });
    const started = projectCarriers(world, state, carriersStarted(r.events));
    if (JSON.stringify(pending) !== JSON.stringify(started)) probe.fail(`${run.label} t${state.turn}: hatched carriers ${JSON.stringify(pending)}, started ${JSON.stringify(started)}`);
    const pic = { before: picture, after: oracle.state, events: oracle.events };
    for (const { crew, tile } of stays) checkWorldPhase(run, state, crew, tile, state, r, npcs, cameras, `${run.label} t${state.turn} stay ${crew}`, pic);
    return r.state;
}

/**
 * The safe floor never tells how a door the crew can't vouch for stands (decision 44): judged again with every such
 * door flipped (open to shut, shut to open), it reads the same.
 */
function checkFlipped(run: Run, state: State, crew: string, floor: SafeFloor): void {
    const doubt = doorDoubt(run.world, state);
    if (!doubt) return;
    const flipped = clonePlain(state);
    for (const id of doubt.doors) {
        const was = flipped.doors[id]?.status ?? run.world.doors[id]!.start;
        flipped.doors[id] = { ...flipped.doors[id], status: was === 'open' ? (run.world.doors[id]!.lock === 'none' ? 'closed' : 'locked') : 'open' };
    }
    const other = safeFloor(run.world, flipped, crew);
    if (JSON.stringify(other.tiles) !== JSON.stringify(floor.tiles)) {
        const i = floor.tiles.findIndex((t, k) => JSON.stringify(t) !== JSON.stringify(other.tiles[k]));
        run.probe.fail(`${run.label} t${state.turn}: the floor of ${crew} changes with doors ${[...doubt.doors].join(' ')} flipped, at ${JSON.stringify(floor.tiles[i]?.pos)}`);
    }
    run.probe.bump('floors checked with doubted doors flipped');
    if (floor.tiles.some(t => t.doorRisk)) run.probe.bump('floors with door risk');
}

/** `state` with each of `ids` set to `status(id)`. */
function withDoors(state: State, ids: Iterable<string>, status: (id: string) => DoorStatus): State {
    const doors = { ...state.doors };
    for (const id of ids) doors[id] = { ...doors[id], status: status(id) };
    return { ...state, doors };
}

/** Whether tint `got` warns of at least what `want` does: its kind, its eye, and (short of red) each NPC's pips. */
function atLeast(got: FloorTile['tint'], want: FloorTile['tint']): boolean {
    const rank = (k: string): number => (k in TINT_RANK ? TINT_RANK[k as keyof typeof TINT_RANK] : 0);
    if (rank(got.kind) < rank(want.kind) || (want.eye && !got.eye)) return false;
    return got.kind === 'red' || want.pips.every(p => (got.pips.find(q => q.npc === p.npc)?.pips ?? 0) >= p.pips);
}

/**
 * (a), (b) The tint is certain whatever the doors the crew can't vouch for are (decision 44): a sample of the floor's
 * tiles (door-risk ones first; none reached through a door that could refuse the crew, none hidden) is played on the
 * picture with those doors all open, all shut and as they really are. A tile without door risk reads exactly the same
 * in each (a red one may gain observers: nothing is worse); one with it warns of at least its tint in each (its kind,
 * eye and pips): door risk never stands in for a certain warning.
 */
function checkDoorVariants(run: Run, state: State, crew: string, floor: SafeFloor, sample: number): void {
    const { world, probe } = run;
    const d = doorDoubt(world, state);
    if (!d) return;
    const picture = previewPicture(world, state);
    const variants: [string, State][] = [
        ['open', withDoors(picture, d.doors, () => 'open')],
        ['shut', withDoors(picture, d.doors, id => (world.doors[id]!.lock === 'none' ? 'closed' : 'locked'))],
        ['real', withDoors(picture, d.doors, id => state.doors[id]?.status ?? world.doors[id]!.start)]
    ];
    const tiles = floor.tiles.filter(t => t.band !== 'stay' && !t.unknownPath && t.knowledge !== 'hidden');
    // Spread over the floor without the run's dice, so the rest of the sample plays as it did.
    const picked = [tiles.filter(t => t.doorRisk), tiles.filter(t => !t.doorRisk)].flatMap(from => {
        const n = Math.min(sample, from.length);
        return Array.from({ length: n }, (_, i) => from[Math.floor(((i + 0.5) * from.length) / n)]!);
    });
    for (const tile of picked) {
        const cmd: Command = { type: tile.band === 'dash' ? 'dash' : 'move', crew, path: tile.path };
        if (tile.doorRisk && tile.tint.kind !== 'unknownRisk') probe.bump('door risk tiles with a certain warning');
        for (const [name, s] of variants) {
            const r = commit(world, s, cmd);
            if (r.events.some(e => e.type === 'moveCut')) { probe.bump('door variants cut'); continue; }
            const now = effectOf(r.events, crew, s);
            const next = tile.next ? effectOf(commit(world, r.state, { type: 'endTurn' }).events, crew, r.state) : null;
            const got = tintOf(now, next, 'scouted', false), at = `${run.label} t${state.turn} ${crew}→${JSON.stringify(tile.pos)} doors ${name}`;
            probe.bump('door variants checked');
            if (tile.doorRisk) {
                if (!atLeast(got, tile.tint)) probe.fail(`${at}: door risk over ${JSON.stringify(tile.tint)}, but only ${JSON.stringify(got)} happens`);
                else if (effectKind(now) !== effectKind(tile.now) || JSON.stringify(got) !== JSON.stringify(tile.tint)) probe.bump('door variants worse than a door-risk tint');
            } else if (tile.tint.kind === 'red') {
                if (!atLeast(got, tile.tint)) probe.fail(`${at}: red, but ${JSON.stringify(got)} happens`);
            } else if (show(now) !== show(tile.now) || (tile.next && show(next) !== show(tile.next))) {
                probe.fail(`${at}: no door risk, now ${show(tile.now)} next ${show(tile.next)}, but ${show(now)} ${show(next)} happens`);
            }
        }
    }
}

/** The perception events about crew member `crew` (who saw them, how), by observer. */
function perceivedBy(events: readonly SimEvent[], crew: string): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const e of events) {
        if (!['exposed', 'suspicionRaised', 'challenged', 'cameraSaw', 'perceptionCheck'].includes(e.type)) continue;
        const f = e as unknown as { npc?: string; camera?: string; crew: string };
        if (f.crew !== crew) continue;
        const who = f.npc ?? f.camera!;
        out.set(who, [...(out.get(who) ?? []), JSON.stringify(e)]);
    }
    return out;
}

/**
 * (c) A certain sighting is never dropped (decision 44): the preview of `cmd` (`previewCertain`, projected) tells the
 * same of every observer the crew knows whose every line to the crew member's tiles is clear of the doors it can't
 * vouch for (`sightDoubted`) as the truth's commit, projected alike; and it never shows anyone else seeing them when
 * the truth doesn't. Commands with a noise (hearing couples observers) and moves cut short are left out.
 */
function checkCertainEvents(run: Run, state: State, cmd: Command, crew: string, truth: { state: State; events: readonly SimEvent[] }): void {
    const { world, probe } = run;
    const d = doorDoubt(world, state);
    if (!d || truth.events.some(e => e.type === 'noise' || e.type === 'moveCut')) return;
    let shown: SimEvent[];
    try {
        shown = projectPreviewEvents(world, state, previewCertain(world, state, cmd));
    } catch {
        return;
    }
    const told = projectEvents(world, truth.state, truth.events, state, { mode: 'preview' });
    const member = state.crew.find(c => c.id === crew)!;
    const tiles: Pos[] = [member.pos, ...truth.events.flatMap(e => (e.type === 'moved' && e.crew === crew ? e.path : []))];
    const a = perceivedBy(shown, crew), b = perceivedBy(told, crew);
    const watchers = [
        ...state.npcs.filter(n => isKnownNow(world, state, n.id)).map(n => ({ id: n.id, pos: n.pos })),
        ...world.cameras.filter(c => state.knowledge.cameras.includes(c.id)).map(c => ({ id: c.id, pos: c.pos }))
    ];
    for (const w of watchers) {
        const x = JSON.stringify(a.get(w.id) ?? []), y = JSON.stringify(b.get(w.id) ?? []);
        if (!tiles.some(t => sightDoubted(world, d, w.pos, t))) {
            probe.bump('certain observers compared');
            if (b.has(w.id)) probe.bump('certain sightings kept');
            if (x !== y) probe.fail(`${run.label} t${state.turn}: ${cmd.type} preview tells ${x} of ${w.id} seeing ${crew}, the truth ${y} (no door in doubt between)`);
        } else if (a.has(w.id) && !b.has(w.id)) probe.fail(`${run.label} t${state.turn}: ${cmd.type} preview shows ${w.id} seeing ${crew}, the truth doesn't`);
    }
}

/**
 * The eye sits on the first step passed that anyone reacts to (decision 46: passing counts as ending there, pips and
 * challenges too), or on the end when the end isn't safe; nothing before it acts.
 */
function checkEye(run: Run, ps: Extract<ReturnType<typeof pathSafety>, { ok: true }>, path: readonly Pos[]): void {
    const firstSeen = ps.steps.findIndex((s, i) => i < path.length - 1 && s.sightings.length > 0);
    const warns = !['safe', 'grey', 'unknownRisk'].includes(ps.end.tint.kind);
    const expected = firstSeen >= 0 ? firstSeen : warns ? path.length - 1 : null;
    if (ps.firstUnsafe !== expected) run.probe.fail(`${run.label}: eye at ${ps.firstUnsafe}, expected ${expected}`);
    if (ps.steps.some((s, i) => i < path.length - 1 && s.sightings.some(x => x.outcome === '-'))) run.probe.fail(`${run.label}: a step passed counts a sighting that does nothing`);
    if (firstSeen >= 0 && ps.steps[firstSeen]!.sightings.every(x => x.outcome !== '!')) run.probe.bump('eyes mid-path short of a !');
    if (ps.firstUnsafe !== null) run.probe.bump('eyes');
}

const observersOf = (e: Effect | null): string[] =>
    (e ? [...e.exposed, ...e.watching, ...Object.keys(e.pips), ...(e.challenged ? [e.challenged] : []), ...e.cameras] : []);

/** "Who and why" names exactly the observers behind the tile's effects (all known to the crew), in the right phase. */
function checkExplain(run: Run, state: State, crew: string, tile: FloorTile): void {
    if (!run.rng.chance(0.25)) return;
    const { world, probe } = run;
    const lines = explain(world, state, crew, tile.pos);
    const named = [...new Set(lines.flatMap(l => (l.observer ? [l.observer] : [])))].sort();
    const want = [...new Set([...observersOf(tile.now), ...observersOf(tile.next)])].sort();
    if (JSON.stringify(named) !== JSON.stringify(want)) probe.fail(`${run.label}: explain names ${JSON.stringify(named)}, the effects ${JSON.stringify(want)} at ${JSON.stringify(tile.pos)}`);
    for (const l of lines) {
        if (l.observer === null) continue;
        if (!observersOf(l.phase === 'now' ? tile.now : tile.next).includes(l.observer)) probe.fail(`${run.label}: explain puts ${l.observer} in the wrong phase (${l.phase})`);
        if (l.by === 'npc' && !isKnownNow(world, state, l.observer)) probe.fail(`${run.label}: explain names ${l.observer}, unknown to the crew`);
        if (l.by === 'camera' && !state.knowledge.cameras.includes(l.observer)) probe.fail(`${run.label}: explain names camera ${l.observer}, unknown to the crew`);
    }
    const vouched = tile.knowledge === 'scouted' && !tile.unknownPath && !tile.doorRisk;
    if (vouched !== !lines.some(l => l.observer === null)) probe.fail(`${run.label}: explain's knowledge line at ${JSON.stringify(tile.pos)} (${tile.knowledge})`);
    if (lines.length) probe.bump('explanations');
}

/**
 * Dragging the floor tile's path a step at a time: each prefix judged by `pathSafety` reads as the floor's tile there
 * when the floor reaches it by the same path, and so does the stop a full path shows at each step. The incremental
 * job, stepped a few tiles at a time, tints exactly what `safeFloor` does; neither changes the state it is given.
 */
function checkDrag(run: Run, state: State, crew: string, tile: FloorTile): void {
    if (!run.rng.chance(0.2)) return;
    const { world, probe } = run;
    const floor = safeFloor(world, state, crew);
    const mode = tile.band === 'dash' ? { mode: 'dash' as const } : {};
    const full = pathSafety(world, state, crew, tile.path, mode);
    if (!full.ok) { probe.fail(`${run.label}: the floor's own path to ${JSON.stringify(tile.pos)} is refused: ${full.reason}`); return; }
    for (let k = 1; k <= tile.path.length; k++) {
        const prefix = tile.path.slice(0, k), at = floor.at(prefix[k - 1]!), stop = full.steps[k - 1]!.stop;
        if (!at || JSON.stringify(at.path) !== JSON.stringify(prefix)) continue;
        const ps = pathSafety(world, state, crew, prefix, at.band === 'dash' ? { mode: 'dash' } : {});
        const read = (t: FloorTile | null | undefined): string => (t ? show(t.now) + show(t.next) + JSON.stringify(t.tint) : 'none');
        if (ps.ok && ps.mode === at.band && read(ps.end) !== read(at)) probe.fail(`${run.label}: drag prefix to ${JSON.stringify(at.pos)} reads ${read(ps.end)}, the floor ${read(at)}`);
        if (stop && stop.band === at.band && read(stop) !== read(at)) probe.fail(`${run.label}: the stop at ${JSON.stringify(at.pos)} reads ${read(stop)}, the floor ${read(at)}`);
        probe.bump('drag prefixes checked');
    }
    const copy = clonePlain(state), before = hashOf(copy);
    const job = safeFloorJob(world, copy, crew);
    let ticks = 0, slices = 0;
    while (!job.step(3, () => ticks++)) slices++;
    if (JSON.stringify(job.tiles) !== JSON.stringify(floor.tiles)) probe.fail(`${run.label}: the stepped job tints differently from safeFloor`);
    if (hashOf(copy) !== before) probe.fail(`${run.label}: the safe floor changed the state it was given`);
    probe.bump('jobs stepped', slices + 1);
}

/** The tile of `path` nearest `p` (the first of equals). */
function nearestOf(path: readonly Pos[], p: Pos): Pos {
    let best = path[0]!, d = Infinity;
    for (const q of path) {
        const e = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
        if (e < d) { d = e; best = q; }
    }
    return { x: best.x, y: best.y };
}

/** The dash's ring as the safe floor builds it (the union of its tiles' rings, on NPCs' tiles) is `soundRing` of the whole path there, and so are its hearers. */
function checkRing(run: Run, state: State, crew: string, path: readonly Pos[]): void {
    if (!run.rng.chance(0.3)) return;
    const judge = judgeFor(run.world, state, crew);
    const mine = dashRing(judge, judge.base, path);
    const real = soundRing(run.world, judge.base.state, path, noiseRadius('dash')), whole = npcsInside(judge.base.state, real);
    // The safe floor's ring holds only the tiles NPCs stand on: those must read as in `soundRing` of the whole path.
    if (mine) {
        for (const n of judge.base.state.npcs.filter(x => !DEAF_STATUSES.has(x.status))) {
            const a = real.byIndex.get(n.pos.y * run.world.width + n.pos.x), b = mine.ring.byIndex.get(n.pos.y * run.world.width + n.pos.x);
            if (JSON.stringify(a) !== JSON.stringify(b)) run.probe.fail(`${run.label}: the dash ring of ${JSON.stringify(path)} differs from soundRing at ${n.id}`);
            // The last tile each hearer heard (decision 45) too.
            if (JSON.stringify(real.lastHeard(n.pos)) !== JSON.stringify(mine.ring.lastHeard(n.pos))) run.probe.fail(`${run.label}: the dash ring's last tile heard at ${n.id} differs`);
            else if (a && JSON.stringify(real.lastHeard(n.pos)) !== JSON.stringify(nearestOf(path, n.pos))) run.probe.bump('hearers whose last tile heard is not the nearest');
        }
        if (JSON.stringify(real.sources) !== JSON.stringify(mine.ring.sources)) run.probe.fail(`${run.label}: the dash ring's sources differ`);
    }
    if (JSON.stringify(mine?.hearers ?? []) !== JSON.stringify(whole)) run.probe.fail(`${run.label}: the dash along ${JSON.stringify(path)} is heard by ${JSON.stringify(whole)}, not ${JSON.stringify(mine?.hearers)}`);
    run.probe.bump('rings checked');
}

function play(run: Run, start: State, turns: number, timing: boolean): void {
    let state = start;
    for (let turn = 0; turn < turns && !state.bank.alarm; turn++) {
        for (let k = 0; k < 5; k++) {
            try {
                state = playOne(run, state, timing);
            } catch (e) {
                run.probe.fail(`${run.label} t${state.turn}: ${(e as Error).stack ?? e}`);
                return;
            }
        }
        state = endTurn(run, state);
        run.probe.bump('turns played');
    }
    if (state.bank.alarm) run.probe.bump('games ended by the alarm');
}

/** One generated bank played with a crew of three placed near its people. */
function playBank(probe: Probe, tier: (typeof TIERS)[number], archetype: string, plot: (typeof PLOTS)[number], s: number, combo: number, turns: number, stealth = false): void {
    const world = worldFromBank(cachedBank({ layout: 4100 + s * 97, population: s + 11, tier, archetype: archetype as never, plot }));
    const brng = new Rng(SEED + 7919 * (combo + 1) + s);
    const free: Pos[] = [];
    world.tiles.forEach((t, i) => { if (!t.blocksMove && t.room !== null) free.push({ x: i % world.width, y: Math.floor(i / world.width) }); });
    const taken = new Set(world.people.map(p => `${p.pos.x},${p.pos.y}`));
    const pick = (): Pos => {
        const near = brng.pick(world.people).pos;
        const cands = free.filter(p => !taken.has(`${p.x},${p.y}`) && Math.max(Math.abs(p.x - near.x), Math.abs(p.y - near.y)) <= 4);
        const p = brng.pick(cands.length ? cands : free.filter(q => !taken.has(`${q.x},${q.y}`)));
        taken.add(`${p.x},${p.y}`);
        return p;
    };
    const state = initialState(world, { seed: s, crew: crewFor(brng, 3, pick, stealth) });
    const run: Run = { world, rng: brng, omniscient: stealth ? combo % 4 === 0 : (combo + s) % 2 === 0, label: `${tier}/${archetype}/${plot}/${s}`, tier, probe, stealth };
    play(run, state, turns, true);
}

/**
 * Moves through a lockable door the crew saw open and walked away from (decision 44): a corridor and a room behind a
 * wall with a mechanical door at a random row, NPCs of every class on both sides. The crew sees the door open, is
 * far out of sight of it while the world phase relocks it, and is put back near it (nothing new seen); then each crew
 * member moves to a floor tile reached through it, checked as any move (cut there unless it stood open), and the game
 * plays on.
 */
function playDoorCuts(probe: Probe, rng: Rng, n: number): void {
    const WIDTH = 26, HEIGHT = 6;
    const doorY = rng.int(1, HEIGHT - 2);
    const walls: FixtureWall[] = Array.from({ length: HEIGHT }, (_, y) => ({
        between: [{ x: 7, y }, { x: 8, y }] as [Pos, Pos], ...(y === doorY ? { door: { id: 'gate', lock: 'mechanical' as const, start: 'locked' as const } } : {})
    }));
    const free: Pos[] = [];
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) free.push({ x, y });
    // Keep the doorway and the crew's corners clear.
    const keep = new Set([`7,${doorY}`, `8,${doorY}`, `5,${doorY}`, `4,${doorY}`, '25,0', '25,1']);
    const pool = free.filter(p => !keep.has(`${p.x},${p.y}`));
    const take = (): Pos => pool.splice(rng.int(0, pool.length - 1), 1)[0]!;
    const people: PersonDef[] = [];
    for (let i = 0, count = rng.int(1, 4); i < count; i++) {
        const observer = rng.pick(['civilian', 'staff', 'enforcer'] as ObserverClass[]);
        const role = observer === 'civilian' ? 'customer' : observer === 'staff' ? 'teller' : 'guard';
        const at = take();
        people.push({ id: `n${i}`, name: `n${i}`, role, observer, pos: at, facing: rng.pick(FACINGS), schedule: randomSchedule(rng, free) });
    }
    const world = fixtureWorld(Array.from({ length: HEIGHT }, () => '.'.repeat(WIDTH)), { walls, people, rules: { checkInPeriod: 2, dispatchCheckInPeriod: 2, dispatchSilence: 2 } });
    const crew = crewFor(rng, 2, () => ({ x: 7, y: doorY }), true).map((c, i) => ({ ...c, pos: i ? { x: 6, y: doorY } : { x: 7, y: doorY } }));
    let state = initialState(world, { seed: n, crew });
    // Seen open from beside it; then the crew is in the far corner while the world phase shuts and relocks it.
    const put = (s: State, a: Pos, b: Pos): State => {
        const out = clonePlain(s);
        out.crew[0]!.pos = a;
        out.crew[1]!.pos = b;
        return out;
    };
    state = commit(world, (() => { const s = clonePlain(state); s.doors.gate = { status: 'open' }; return s; })(), { type: 'wait', crew: 'c0' }).state;
    state = commit(world, put(state, { x: 25, y: 0 }, { x: 25, y: 1 }), { type: 'endTurn' }).state;
    state = put(state, { x: 5, y: doorY }, { x: 4, y: doorY });
    const run: Run = { world, rng, omniscient: false, label: `door cuts ${n}`, tier: 'fixture', probe, stealth: true };
    for (const member of state.crew) {
        if (state.bank.alarm) break;
        const floor = safeFloor(world, state, member.id);
        checkFlipped(run, state, member.id, floor);
        const through = floor.tiles.filter(t => t.band !== 'stay' && t.path.some(p => p.x >= 8));
        if (!through.length) continue;
        const tile = rng.pick(through);
        probe.bump('door scenario moves');
        state = checkMove(run, state, member.id, { type: tile.band === 'dash' ? 'dash' : 'move', crew: member.id, path: tile.path }, tile, false);
    }
    play(run, state, 2, false);
}

/**
 * The crew knows every NPC and camera, but neither side of `door` is seen this turn: the door is in doubt, as last seen
 * `seen`, whatever it really is (`real`, when given).
 */
function doubting(world: ReadonlyWorld, state: State, door: readonly [Pos, Pos], seen: DoorStatus, real?: DoorStatus): State {
    const s = omniscient(world, state), k = s.knowledge;
    const fresh = decodeBits(k.fresh, world.width * world.height);
    for (const p of door) fresh[p.y * world.width + p.x] = 0;
    k.fresh = encodeBits(fresh);
    k.doors = { ...k.doors, gate: seen };
    if (real) s.doors.gate = { ...s.doors.gate, status: real };
    return s;
}

/**
 * Doors in doubt with everyone known (decision 44): a corridor split by a wall (a pane or two of glass) with one door,
 * lockable or not, NPCs of every class on both sides, some walking through it, and a crew in any loadout. Before each crew member's turn neither
 * side of the door is seen (`doubting`, as last seen and as it really is drawn at random), so every floor is judged
 * with the door in doubt: checked against each of its states (`checkDoorVariants`) and flipped, then a move (to a
 * door-risk tile half the time) is played and checked as any other, its preview included (`checkCertainEvents`).
 */
function playDoubtedDoors(probe: Probe, rng: Rng, n: number): void {
    const WIDTH = 20, HEIGHT = 7, wx = rng.int(6, 12), doorY = rng.int(1, HEIGHT - 2);
    const lock = rng.pick(['none', 'none', 'mechanical'] as const);
    const walls: FixtureWall[] = Array.from({ length: HEIGHT }, (_, y): FixtureWall => {
        const between: [Pos, Pos] = [{ x: wx, y }, { x: wx + 1, y }];
        if (y === doorY) return { between, door: { id: 'gate', lock, start: lock === 'none' ? 'closed' : 'locked' } };
        return rng.chance(0.12) ? { between, material: 'glass' } : { between };
    });
    const free: Pos[] = [];
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) free.push({ x, y });
    const pool = free.filter(p => p.y !== doorY || (p.x !== wx && p.x !== wx + 1));
    const take = (left?: boolean): Pos => {
        const from = pool.filter(p => left === undefined || (p.x <= wx) === left);
        const p = rng.pick(from);
        pool.splice(pool.indexOf(p), 1);
        return p;
    };
    const people: PersonDef[] = [];
    for (let i = 0, count = rng.int(2, 5); i < count; i++) {
        const observer = rng.pick(['civilian', 'staff', 'enforcer'] as ObserverClass[]);
        const role = observer === 'civilian' ? 'customer' : observer === 'staff' ? 'teller' : 'guard';
        people.push({ id: `n${i}`, name: `n${i}`, role, observer, pos: take(i % 2 === 0), facing: rng.pick(FACINGS), schedule: randomSchedule(rng, free) });
    }
    const near = rng.pick(['.', '.', 's']), far = rng.pick(['.', 's', 's']);
    const zones = Array.from({ length: HEIGHT }, () => near.repeat(wx + 1) + far.repeat(WIDTH - wx - 1));
    const world = fixtureWorld(Array.from({ length: HEIGHT }, (_, y) => zones[y]!), { walls, people, rules: { checkInPeriod: 2, dispatchCheckInPeriod: 2, dispatchSilence: 2 } });
    let state = initialState(world, { seed: n, crew: crewFor(rng, 2, () => take(true)) });
    const run: Run = { world, rng, omniscient: false, label: `doubted door ${n}`, tier: 'fixture', probe, stealth: true };
    const door = [{ x: wx, y: doorY }, { x: wx + 1, y: doorY }] as const, statuses: DoorStatus[] = lock === 'none' ? ['open', 'closed'] : ['open', 'locked'];
    for (let round = 0; round < 3 && !state.bank.alarm; round++) {
        for (const id of state.crew.map(c => c.id)) {
            if (state.bank.alarm) break;
            state = doubting(world, state, door, rng.pick(statuses), rng.pick(statuses));
            const member = state.crew.find(c => c.id === id)!;
            if (member.actionsLeft < 1) continue;
            const floor = safeFloor(world, state, id);
            checkFlipped(run, state, id, floor);
            checkDoorVariants(run, state, id, floor, 3);
            const moves = floor.tiles.filter(t => t.band !== 'stay');
            if (!moves.length) continue;
            const risky = moves.filter(t => t.doorRisk);
            const tile = risky.length && rng.chance(0.5) ? rng.pick(risky) : rng.pick(moves);
            probe.bump('doubted door moves');
            if (tile.doorRisk) probe.bump('doubted door moves to door-risk tiles');
            state = checkMove(run, state, id, { type: tile.band === 'dash' ? 'dash' : 'move', crew: id, path: tile.path }, tile, rng.chance(0.4));
        }
        if (!state.bank.alarm) state = endTurn(run, doubting(world, state, door, rng.pick(statuses)));
    }
}

describe('previews (property, §8.8)', () => {
    it('show what happens: the safe floor, drawn paths, "who and why" and action previews', () => {
        const probe = new Probe();
        const rng = new Rng(SEED);
        let seeds = 0;
        for (let w = 0; w < FIXTURES; w++, seeds++) {
            const { world, free } = fixture(rng);
            const take = (): Pos => free.splice(rng.int(0, free.length - 1), 1)[0]!;
            const state = initialState(world, { seed: w, crew: crewFor(rng, 2, take) });
            for (const npc of state.npcs) {
                npc.alerted = rng.chance(0.2);
                if (rng.chance(0.08)) npc.status = 'commanded';
            }
            const run: Run = { world, rng, omniscient: w % 2 === 0, label: `fixture ${w}`, tier: 'fixture', probe };
            play(run, state, FIXTURE_TURNS, true);
        }
        for (let n = 0; n < DOOR_RUNS; n++, seeds++) playDoorCuts(probe, rng, n);
        // Its own stream, so the rest of the sample stays as it was.
        const drng = new Rng(SEED + 4441);
        for (let n = 0; n < DOUBT_RUNS; n++, seeds++) playDoubtedDoors(probe, drng, n);
        let combo = 0;
        for (let s = 0; s < BANK_SEEDS; s++) for (const tier of TIERS) for (const archetype of archetypesFor(tier)) {
            if (BANK_SKIP && (combo + s) % BANK_SKIP === BANK_SKIP - 1) {
                combo++;
                continue;
            }
            seeds++;
            playBank(probe, tier, archetype, PLOTS[combo % PLOTS.length]!, s, combo++, BANK_TURNS);
        }
        const st = probe.stats;
        if (VERBOSE) {
            const pct = (xs: number[], q: number): string => (xs.sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))] ?? 0).toFixed(1);
            const timing = Object.fromEntries(Object.entries(probe.floorMs).map(([t, xs]) => [t, `n ${xs.length} median ${pct(xs, 0.5)} p90 ${pct(xs, 0.9)} p99 ${pct(xs, 0.99)} ms`]));
            console.log(JSON.stringify({ seeds, stats: Object.fromEntries(Object.entries(st).sort()), timing }, null, 1));
        }
        if (VERBOSE) for (const f of probe.failures) console.log('FAIL', f);
        expect(probe.failures).toEqual([]);
        // The sample has to exercise the promise: every tint, both bands, hatched outcomes, eyes, noises and the actions.
        expect(st.commands ?? 0).toBeGreaterThan(400 * SCALE);
        for (const k of ['tint safe', 'tint amber', 'tint red', 'tint unknownRisk', 'band move', 'band dash', 'eyes', 'ears', 'explanations', 'truth next equal', 'green world phases']) {
            expect(st[k] ?? 0, k).toBeGreaterThan(0);
        }
        expect((st['tint amber hatched'] ?? 0) + (st['tint red hatched'] ?? 0) + (st['tint trespass hatched'] ?? 0), 'hatched').toBeGreaterThan(0);
        expect((st['tint trespass'] ?? 0) + (st['tint trespass hatched'] ?? 0), 'trespass').toBeGreaterThan(0);
        for (const k of [
            'truth: move cut by a door', 'floors checked with doubted doors flipped', 'floors with door risk', 'door variants checked', 'door risk tiles with a certain warning',
            'doubted door moves to door-risk tiles', 'certain sightings kept', 'eyes mid-path short of a !', 'moves turning a known NPC',
            'moves seen by an NPC they turned', 'hearers whose last tile heard is not the nearest'
        ]) expect(st[k] ?? 0, k).toBeGreaterThan(0);
        for (const type of ['door', 'knockout', 'drag', 'interact']) expect(st[`command ${type}`] ?? 0, type).toBeGreaterThan(0);
    }, 600_000);
    // Long games (the reviewer's harness): a quiet crew (no weapons, no knockouts, mostly calm tiles) plays on while
    // routines get known, ghosts come and go and NPCs drift off what the crew saw.
    // PREVIEW_LONG_GAMES banks (default 2) of PREVIEW_LONG_TURNS turns (default 25), every tier × archetype in turn.
    it('show what happens in long games', () => {
        const probe = new Probe();
        const combos = TIERS.flatMap(tier => archetypesFor(tier).map(archetype => ({ tier, archetype })));
        const games = Number(process.env.PREVIEW_LONG_GAMES ?? 2), turns = Number(process.env.PREVIEW_LONG_TURNS ?? 25);
        for (let g = 0; g < games; g++) {
            const { tier, archetype } = combos[(g * 5) % combos.length]!;
            playBank(probe, tier, archetype, PLOTS[g % PLOTS.length]!, 100 + g, g + 1, turns, true);
        }
        if (VERBOSE) {
            console.log(JSON.stringify(Object.fromEntries(Object.entries(probe.stats).sort()), null, 1));
            for (const f of probe.failures) console.log('FAIL', f);
        }
        expect(probe.failures).toEqual([]);
        expect(probe.stats.commands ?? 0).toBeGreaterThan(games * turns * 2);
    }, 600_000);
});
