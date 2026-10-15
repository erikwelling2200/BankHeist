import { describe, expect, it } from 'vitest';
import { archetypesFor, generateBank } from '../../src/gen/generate';
import { PLOTS, TIERS } from '../../src/gen/model';
import { Rng } from '../../src/gen/rng';
import {
    actionPreview, carriersStarted, clonePlain, commit, crewBudget, crewMoveOptions, effectOf, encodeBits, explain, FACINGS, hearing, isKnownNow, fixtureWorld, initialState,
    legalActions, noiseRadius, npcsInside, onFloor, pathSafety, pendingCarriers, planningState, previewPicture, projectCarriers, projectPreviewEvents, safeFloor, soundRing,
    validatePath, worldFromBank, type CameraDef, type Command, type CrewStart, type Effect, type FixtureWall, type FloorTile, type ObserverClass,
    type PersonDef, type Pos, type ReadonlyWorld, type ScheduleBlock, type SimEvent, type State, type WorldObject
} from '../../src/sim';
import { dashRing, judgeFor } from '../../src/sim/preview/floor';
import { decodeBits } from '../../src/sim/rules/knowledgeBits';

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
const BANK_SEEDS = Number(process.env.PREVIEW_PROBE_BANKS ?? Math.max(1, Math.round(SCALE)));
const FIXTURE_TURNS = 4, BANK_TURNS = Math.round(6 * Math.min(SCALE, 2));
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
            if (y === doorY) walls.push({ between, door: { id: `d${wx}`, start: rng.pick(['closed', 'open', 'closed'] as const) } });
            else if (y === glassY) walls.push({ between, material: 'glass' });
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

function crewFor(rng: Rng, n: number, pick: () => Pos): CrewStart[] {
    return Array.from({ length: n }, (_, i) => {
        const loadout = rng.pick(LOADOUTS), gadget = rng.chance(0.5) ? ['hackingKit'] : rng.chance(0.15) ? ['jammer'] : [];
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

interface Run { world: ReadonlyWorld; rng: Rng; omniscient: boolean; label: string; tier: string; probe: Probe }

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
    let oNext: Effect | null = null;
    if (tile.next) {
        const o2 = commit(world, o1.state, { type: 'endTurn' });
        oNext = effectOf(o2.events, crew, o1.state);
        if (show(oNext) !== show(tile.next)) probe.fail(`${at}: next ${show(tile.next)}, the rules on the picture ${show(oNext)}`);
    }
    probe.bump('oracle checks');
    // 2. The truth, as the crew perceives it.
    const r = commit(world, state, cmd);
    const tNowAll = effectOf(r.events, crew, state), tNow = known(tNowAll, npcs, cameras);
    const cut = r.events.some(e => e.type === 'moveCut');
    if (cut) probe.bump('truth: move cut by someone unseen');
    else if (show(tNow) !== show(tile.now)) {
        const why = classify(run, state, tile.now, tNow, tNowAll, npcs, cameras);
        if (why) probe.bump(`truth now differs: ${why}`);
        else probe.fail(`${at}: now ${show(tile.now)}, the truth ${show(tNow)} (all ${show(tNowAll)})`);
    } else probe.bump('truth now equal');
    // 3. Never green but spotted, during the move.
    if (tile.tint.kind === 'safe') {
        probe.bump('green moves');
        if (!quiet(tNowAll)) {
            probe.bump('green but spotted now');
            const who = [...tNowAll.exposed, ...tNowAll.watching, ...Object.keys(tNowAll.pips)].map(id => {
                const n = state.npcs.find(x => x.id === id)!, k = state.knowledge.npcs[id];
                return `${id} at ${JSON.stringify(n.pos)} ${n.status} known ${JSON.stringify(k)} fresh ${decodeBits(state.knowledge.fresh, world.width * world.height)[n.pos.y * world.width + n.pos.x]} phaseTick ${state.knowledge.phaseTick} tick ${state.knowledge.tick} turn ${state.turn}`;
            });
            probe.fail(`${at}: green, but the move got them spotted: ${show(tNowAll)} path ${JSON.stringify(tile.path)} from ${JSON.stringify(state.crew.find(c => c.id === crew)!.pos)} ${who.join('; ')} events ${JSON.stringify(r.events.filter(e => 'npc' in e || e.type === 'moved'))}`);
        }
    }
    if (!endTurn || cut) return r.state;
    const e = commit(world, r.state, { type: 'endTurn' });
    checkWorldPhase(run, state, crew, tile, r.state, e.events, npcs, cameras, at);
    return e.state;
}

/** The world phase that followed a prediction, on the truth. */
function checkWorldPhase(
    run: Run, judged: State, crew: string, tile: FloorTile, before: State, events: readonly SimEvent[], npcs: ReadonlySet<string>, cameras: ReadonlySet<string>, at: string
): void {
    const { probe } = run;
    const all = effectOf(events, crew, before), seen = known(all, npcs, cameras);
    if (tile.next) {
        if (show(seen) !== show(tile.next)) {
            const why = classify(run, judged, tile.next, seen, all, npcs, cameras);
            if (why) probe.bump(`truth next differs: ${why}`);
            else probe.fail(`${at}: next ${show(tile.next)}, the truth ${show(seen)} (all ${show(all)})`);
        } else probe.bump('truth next equal');
    }
    if (tile.tint.kind === 'safe' && tile.next) {
        probe.bump('green world phases');
        if (!quiet(all)) {
            const byUnknown = hidden(all, npcs, cameras);
            probe.bump(byUnknown ? 'green but spotted next: by someone the crew does not know' : 'green but spotted next: by a known NPC');
            if (!byUnknown) probe.fail(`${at}: green, but the world phase got them spotted by someone known: ${show(all)}`);
        }
    }
}

/** Why the truth may differ from the picture's prediction: only what the crew can't know. Null: it may not. */
function classify(run: Run, state: State, predicted: Effect, seen: Effect, all: Effect, npcs: ReadonlySet<string>, cameras: ReadonlySet<string>): string | null {
    if (run.omniscient) return null;
    const camerasOnly = show({ ...predicted, cameras: [] }) === show({ ...seen, cameras: [] });
    if (camerasOnly && predicted.cameras.every(id => seen.cameras.includes(id) || !state.knowledge.cctv)) return 'a camera of unknown feed status is off';
    if (hidden(all, npcs, cameras)) return 'someone unseen acted on them too';
    const unknownNpcs = state.npcs.some(n => !npcs.has(n.id) && n.status !== 'away');
    return unknownNpcs ? 'unseen NPCs changed the known ones\' walks' : null;
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
        const moves = floor.tiles.filter(t => t.band !== 'stay');
        if (!moves.length) return state;
        // Interesting tiles first now and then: every tint gets played.
        const warm = moves.filter(t => t.tint.kind !== 'safe' && t.tint.kind !== 'unknownRisk' && t.tint.kind !== 'grey');
        const tile = warm.length && rng.chance(0.5) ? rng.pick(warm) : rng.pick(moves);
        probe.bump(`tint ${tile.tint.kind}${tile.tint.hatched ? ' hatched' : ''}`);
        probe.bump(`band ${tile.band}`);
        checkExplain(run, state, member.id, tile);
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
    const options = legalActions(world, state, member.id).filter(c => c.type !== 'wait' || rng.chance(0.3));
    if (!options.length) return state;
    const kinds = [...new Set(options.map(c => c.type))];
    const kind = rng.pick(kinds);
    const cmd = rng.pick(options.filter(c => c.type === kind));
    const shown = actionPreview(world, state, cmd);
    const r = commit(world, state, cmd);
    probe.bump('commands');
    probe.bump(`command ${cmd.type}`);
    if (!shown.ok) { probe.fail(`${run.label}: ${cmd.type} refused in preview, committed`); return r.state; }
    const projected = projectPreviewEvents(world, state, r);
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
        // When everyone who heard it is known, the badges are what the hearers make of it in the truth.
        const truth = r.events.find(e => e.type === 'noise' && e.cause === noise.cause) as Extract<SimEvent, { type: 'noise' }> | undefined;
        if (truth && truth.heard.every(id => knownNpcs.has(id))) {
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
        const o = effectOf(oracle.events, crew, picture);
        if (show(o) !== show(tile.next)) probe.fail(`${run.label} t${state.turn} stay ${crew}: next ${show(tile.next)}, the rules on the picture ${show(o)}`);
        probe.bump('stay checks');
    }
    const pending = projectCarriers(world, state, pendingCarriers(world, state));
    const r = commit(world, state, { type: 'endTurn' });
    const started = projectCarriers(world, state, carriersStarted(r.events));
    if (JSON.stringify(pending) !== JSON.stringify(started)) probe.fail(`${run.label} t${state.turn}: hatched carriers ${JSON.stringify(pending)}, started ${JSON.stringify(started)}`);
    for (const { crew, tile } of stays) checkWorldPhase(run, state, crew, tile, state, r.events, npcs, cameras, `${run.label} t${state.turn} stay ${crew}`);
    return r.state;
}

/** The eye sits on the first step with a `!`, or on the end when the end isn't safe; nothing before it acts. */
function checkEye(run: Run, ps: Extract<ReturnType<typeof pathSafety>, { ok: true }>, path: readonly Pos[]): void {
    const firstBang = ps.steps.findIndex((s, i) => i < path.length - 1 && s.sightings.length > 0);
    const warns = !['safe', 'grey', 'unknownRisk'].includes(ps.end.tint.kind);
    const expected = firstBang >= 0 ? firstBang : warns ? path.length - 1 : null;
    if (ps.firstUnsafe !== expected) run.probe.fail(`${run.label}: eye at ${ps.firstUnsafe}, expected ${expected}`);
    if (ps.steps.some((s, i) => i < path.length - 1 && s.sightings.some(x => x.outcome !== '!'))) run.probe.fail(`${run.label}: a mid-move step counts more than a '!'`);
    if (ps.firstUnsafe !== null) run.probe.bump('eyes');
}

/** "Who and why" names only observers the crew knows, and something for every warning tint. */
function checkExplain(run: Run, state: State, crew: string, tile: FloorTile): void {
    if (!run.rng.chance(0.15)) return;
    const { world, probe } = run;
    const lines = explain(world, state, crew, tile.pos);
    const warns = !['safe', 'grey', 'unknownRisk'].includes(tile.tint.kind);
    if (warns && !lines.some(l => l.observer !== null)) probe.fail(`${run.label}: ${tile.tint.kind} at ${JSON.stringify(tile.pos)} with nobody to explain it`);
    for (const l of lines) {
        if (l.by === 'npc' && !isKnownNow(world, state, l.observer!)) probe.fail(`${run.label}: explain names ${l.observer}, unknown to the crew`);
        if (l.by === 'camera' && !state.knowledge.cameras.includes(l.observer!)) probe.fail(`${run.label}: explain names camera ${l.observer}, unknown to the crew`);
    }
    if (tile.tint.kind === 'safe' && lines.length) probe.fail(`${run.label}: a green tile explains ${JSON.stringify(lines)}`);
    if (lines.length) probe.bump('explanations');
}

/** The dash's ring as the safe floor builds it (the union of its tiles' rings) is `soundRing` of the whole path, and so are its hearers. */
function checkRing(run: Run, state: State, crew: string, path: readonly Pos[]): void {
    if (!run.rng.chance(0.3)) return;
    const judge = judgeFor(run.world, state, crew);
    const mine = dashRing(judge, judge.base, path);
    const real = soundRing(run.world, judge.base.state, path, noiseRadius('dash')), whole = npcsInside(judge.base.state, real);
    if (mine && JSON.stringify(real) !== JSON.stringify(mine.ring)) run.probe.fail(`${run.label}: the dash ring of ${JSON.stringify(path)} differs from soundRing`);
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
        let combo = 0;
        for (let s = 0; s < BANK_SEEDS; s++) for (const tier of TIERS) for (const archetype of archetypesFor(tier)) {
            seeds++;
            const plot = PLOTS[combo++ % PLOTS.length]!;
            const world = worldFromBank(generateBank({ layout: 4100 + s * 97, population: s + 11, tier, archetype, plot }));
            const brng = new Rng(SEED + 7919 * combo);
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
            const state = initialState(world, { seed: s, crew: crewFor(brng, 3, pick) });
            const run: Run = { world, rng: brng, omniscient: (combo + s) % 2 === 0, label: `${tier}/${archetype}/${plot}/${s}`, tier, probe };
            play(run, state, BANK_TURNS, true);
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
        for (const type of ['door', 'knockout', 'drag', 'interact']) expect(st[`command ${type}`] ?? 0, type).toBeGreaterThan(0);
    }, 600_000);
});
