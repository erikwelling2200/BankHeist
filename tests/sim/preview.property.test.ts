import { describe, expect, it } from 'vitest';
import { archetypesFor } from '../../src/gen/generate';
import { cachedBank } from '../bankCache';
import { PLOTS, TIERS, type KeyLock } from '../../src/gen/model';
import { Rng } from '../../src/gen/rng';
import {
    actionPreview, partOf, CARRY_WEIGHT, commandPlan, commandPreview, hasLineOfSight, holdTargets, ITEMS, reachable, pathTo, addsTo, carriersStarted, DEAF_STATUSES, clonePlain, commit, crewBudget, crewMoveOptions, decodeBits, doorDoubt, effectKind, effectOf, encodeBits, explain, FACINGS, hearing,
    isKnownNow, fixtureWorld, initialState, hashOf, legalActions, noiseRadius, npcsInside, onFloor, pathSafety, pendingCarriers, planningState, previewCertain, previewPicture,
    projectCarriers, projectEvents, projectPreviewEvents, safeFloor, safeFloorJob, sightDoubted, soundRing, teammateEffects, throwPlan, TINT_RANK, tintOf, validatePath, withDoubtedShut,
    worldFromBank, cornerEdges, edgeBetween, edgeKey, edgeNow, inBounds, throwTargets, tileAt,
    type CameraDef, type Command, type CommitResult, type CrewStart, type DoorStatus, type Effect, type TeammateEffect, type FixtureWall, type FloorTile, type ObserverClass, type PersonDef, type Pos, type ReadonlyWorld,
    type SafeFloor, type ScheduleBlock, type SimEvent, type State, type WorldObject
} from '../../src/sim';
import { dashRing, judgeFor } from '../../src/sim/preview/floor';

/*
 * THE promise of §8.8 (implementation plan §2.2, M1-09): what the safe floor, a drawn path and an action's preview
 * show is what happens. Seeded random play on random fixtures and on generated banks (every tier × archetype, the
 * plots in turn); random legal commands (moves and dashes to a tile of the safe floor or along a random drawn path,
 * and every action `legalActions` offers: doors, knockouts, drags, drops, stashes, panel work, looping, answering,
 * jammers, loot (taking, dropping, throwing, passing, inspecting; a scenario of its own), waits). Before each move the
 * tile's tint is taken; after it, compared:
 *
 * 1. **Same rules.** The move and then the end of the turn are committed on the crew's picture (`previewPicture`, the
 *    state the safe floor judges): the crew-phase effect on the crew member (Exposed, pips per NPC, a challenge, a
 *    camera report, being seen by someone who knows them) and the world phase's must equal the tile's `now` and `next`
 *    exactly, and so must what the move does to each teammate: now (someone its noise turned sees them) and in the world
 *    phase after it, where that adds to the world phase without the move. The tint is the worst effect of the move over
 *    the whole crew, now or (hatched, when strictly worse) next. 0 differences, everywhere.
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
const SEED = Number(process.env.PREVIEW_PROBE_SEED ?? 20261016);
const VERBOSE = !!process.env.PREVIEW_PROBE_VERBOSE;
const FIXTURES = Math.round(40 * SCALE);
const DOOR_RUNS = Math.round(12 * SCALE);
const DOUBT_RUNS = Math.round(24 * SCALE);
const LOOT_RUNS = Math.round(16 * SCALE);
const VAULT_RUNS = Math.round(16 * SCALE);
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
    { uniform: 'guard', items: ['pistol'] }, { notoriety: 2 }, { notoriety: 4, items: ['pistol'] }, { items: ['duffel'], packed: ['smg'] }
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

/**
 * What a move does to each teammate as the floor reads it: now from the move's events; next from the world phase after
 * it (`ended`) where that adds to the world phase without the move (`idle`), when both are given, or wherever `keep`
 * says (a tile that warns of it: whether the move adds to it may hang on a door, what happens after it doesn't).
 */
function matesOf(
    crew: string, before: State, moved: { state: State; events: readonly SimEvent[] }, ended: { events: readonly SimEvent[] } | null,
    idle: { events: readonly SimEvent[] } | null, keep: (crew: string) => boolean = () => false
): TeammateEffect[] {
    const out: TeammateEffect[] = [];
    for (const c of before.crew) {
        if (c.id === crew) continue;
        const effect = effectOf(moved.events, c.id, before);
        const after = ended ? effectOf(ended.events, c.id, moved.state) : null;
        const next = after && idle && !quiet(after) && (keep(c.id) || addsTo(after, effectOf(idle.events, c.id, before))) ? after : undefined;
        if (!quiet(effect) || next) out.push({ crew: c.id, effect, ...(next ? { next } : {}) });
    }
    return out;
}

/**
 * The end of the turn, its events up to the first lapse or panic reaction rolled (§10.5, §10.8; M2-01, M2-02): both
 * are rolled as the next crew phase begins, the world phase's last word, so what follows is luck no preview promises.
 */
function endPhase(world: ReadonlyWorld, state: State): CommitResult {
    return untilRolled(commit(world, state, { type: 'endTurn' }));
}

/** An end of the turn's events up to its first lapse or panic reaction (`endPhase`). */
function untilRolled(r: CommitResult): CommitResult {
    const i = r.events.findIndex(e => e.type === 'lapsed' || e.type === 'panicReaction');
    return i < 0 ? r : { ...r, events: r.events.slice(0, i) };
}

// ---------------------------------------------------------------------------------------------------------- The probe

interface Stats { [k: string]: number }

class Probe {
    failures: string[] = [];
    stats: Stats = {};
    floorMs: Record<string, number[]> = {};
    bump(k: string, n = 1): void { this.stats[k] = (this.stats[k] ?? 0) + n; }
    fail(msg: string): void { if (this.failures.length < 50) this.failures.push(msg); }
}

/** `loot`: the loot scenario, which plays actions half the time, loot ones first, and throws to teammates first. */
interface Run {
    world: ReadonlyWorld; rng: Rng; omniscient: boolean; label: string; tier: string; probe: Probe; stealth?: boolean; loot?: boolean; vault?: boolean;
    /** Each NPC's intended action as the crew phase of `turn` began (`checkTelegraphs`). */
    shown?: { turn: number; actions: Map<string, string> };
}

const LOOT_COMMANDS = new Set(['takeLoot', 'dropLoot', 'throwLoot', 'pass', 'inspectLoot']);
const VAULT_COMMANDS = new Set(['drill', 'thermite', 'fixDrill', 'interact', 'door', 'coerce', 'takeLoot']);

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
    const oMates = teammateEffects(o1.events, crew, picture), nowOf = (list: readonly TeammateEffect[]): string =>
        JSON.stringify(list.filter(t => !quiet(t.effect)).map(t => ({ crew: t.crew, effect: t.effect })));
    if (nowOf(oMates) !== nowOf(tile.teammates)) probe.fail(`${at}: teammates now ${nowOf(tile.teammates)}, the rules on the picture ${nowOf(oMates)}`);
    if (oMates.length) probe.bump('moves that do something to a teammate');
    // The tint is the worst of the move over the whole crew (hatched: next, strictly worse).
    const worst = Math.max(...picture.crew.map(c => TINT_RANK[effectKind(effectOf(o1.events, c.id, picture))]));
    const rank = tile.tint.kind in TINT_RANK ? TINT_RANK[tile.tint.kind as keyof typeof TINT_RANK] : 0;
    if (tile.tint.hatched ? rank <= worst : rank !== worst) probe.fail(`${at}: tint ${tile.tint.kind}, the worst over the crew now ranks ${worst}`);
    // A dash's noise turns the known NPCs it sends to look at once (decision 45): what they see is in `now`.
    const turned = picture.npcs.filter(n => o1.state.npcs.find(m => m.id === n.id)?.facing !== n.facing).map(n => n.id);
    if (turned.length) {
        probe.bump('moves turning a known NPC');
        if (turned.some(id => observersOf(tile.now).includes(id))) probe.bump('moves seen by an NPC they turned');
    }
    const o2 = tile.next || endTurn ? endPhase(world, o1.state) : null;
    if (tile.next) {
        const oNext = sure(effectOf(o2!.events, crew, o1.state), tile, npcs, cameras);
        if (show(oNext) !== show(sure(tile.next, tile, npcs, cameras))) probe.fail(`${at}: next ${show(tile.next)}, the rules on the picture ${show(oNext)}`);
        // The teammates' world phase after the move, where it adds to the one without it (exact unless a walk is unsure).
        const mates = matesOf(crew, picture, o1, o2, endPhase(world, picture));
        if (mates.some(t => t.next)) probe.bump('moves that make a teammate\'s world phase worse');
        if (tile.unsure.length) probe.bump('teammate world phases with unsure walks');
        else {
            if (JSON.stringify(mates) !== JSON.stringify(tile.teammates)) probe.fail(`${at}: teammates ${JSON.stringify(tile.teammates)}, the rules on the picture ${JSON.stringify(mates)}`);
            // The worst over the crew of now and next.
            const nowRank = Math.max(...picture.crew.map(c => TINT_RANK[effectKind(effectOf(o1.events, c.id, picture))]));
            const nextRank = Math.max(TINT_RANK[effectKind(oNext)], ...mates.map(t => (t.next ? TINT_RANK[effectKind(t.next)] : 0)));
            if (rank !== Math.max(nowRank, nextRank)) probe.fail(`${at}: tint ${tile.tint.kind}, the worst over the crew ranks ${Math.max(nowRank, nextRank)}`);
        }
    }
    probe.bump('oracle checks');
    // 2. The truth, as the crew perceives it.
    const r = commit(world, state, cmd);
    checkCertainEvents(run, state, cmd, crew, r);
    const tNowAll = effectOf(r.events, crew, state), tNow = known(tNowAll, npcs, cameras);
    const cutBy = r.events.find((e): e is Extract<SimEvent, { type: 'moveCut' }> => e.type === 'moveCut'), cut = !!cutBy;
    // The teammates, as the crew perceives it: exact when the crew knows everything and no door is in doubt.
    for (const mate of state.crew) {
        if (mate.id === crew) continue;
        const want = tile.teammates.find(t => t.crew === mate.id)?.effect ?? null;
        const got = known(effectOf(r.events, mate.id, state), npcs, cameras);
        if (want ? show(got) === show(want) : quiet(got)) continue;
        if (run.omniscient && !cut && !doorDoubt(world, state)) probe.fail(`${at}: teammate ${mate.id} ${show(want)}, the truth ${show(got)}`);
        else probe.bump('truth teammate differs');
    }
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
    const full = commit(world, r.state, { type: 'endTurn' });
    checkTelegraphs(run, r.state, full);
    const e = untilRolled(full);
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
    if (state.devices.some(d => d.jammed)) probe.bump('drill jams');
    if (run.omniscient) state = omniscient(world, state);
    const ready = state.crew.filter(c => c.actionsLeft > 0);
    if (!ready.length) return state;
    const member = rng.pick(ready);
    const roll = (run.loot || run.vault) && rng.chance(0.5) ? 0.7 : rng.next();
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
            if (!validatePath(world, plan, member.pos, trial, crewBudget(world, member, 'dash'), crewMoveOptions(world, member)).ok) continue;
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
    // The takeover (M2-01) only where the crew knows everyone: the picture then holds every NPC, so who complies, resists
    // and hears is the truth's (an unknown NPC missing from the picture changes who is sent to look, an artefact of it).
    const options = legalActions(world, state, member.id).filter(c => (c.type !== 'wait' || rng.chance(0.3)) && !(run.stealth && (c.type === 'knockout' || (c.type === 'door' && (c.action === 'pick' || c.action === 'hack'))))
        && (!TAKEOVER.has(c.type) || (run.omniscient && !run.stealth)));
    if (!options.length) return state;
    const favoured = run.loot ? LOOT_COMMANDS : run.vault ? VAULT_COMMANDS : undefined;
    const kinds = [...new Set(options.map(c => c.type))], looting = kinds.filter(k => favoured?.has(k));
    // Doors and interactions are offered rarely: take each the first few times it is, so every sample plays them.
    const rare = RARE_COMMANDS.find(k => kinds.includes(k) && (probe.stats[`command ${k}`] ?? 0) < 5);
    const kind = rare ?? (looting.length && rng.chance(0.7) ? rng.pick(looting) : rng.pick(kinds));
    const ofKind = options.filter(c => c.type === kind);
    const toMates = ofKind.filter(c => c.type === 'throwLoot' && state.crew.some(m => m.pos.x === c.to.x && m.pos.y === c.to.y));
    const cmd = run.loot && toMates.length && rng.chance(0.5) ? rng.pick(toMates) : rng.pick(ofKind);
    const shown = actionPreview(world, state, cmd);
    const r = commit(world, state, cmd);
    probe.bump('commands');
    probe.bump(`command ${cmd.type}`);
    if (!shown.ok) { probe.fail(`${run.label}: ${cmd.type} refused in preview, committed`); return r.state; }
    if (cmd.type === 'command') checkCommand(run, state, cmd.crew, r);
    if (cmd.type === 'throwLoot') checkThrow(run, state, cmd, r, shown);
    // A preview that stopped at a roll (a resister's chance) shows the odds, not the rest: `checkCommand` covers it.
    if (shown.odds) {
        probe.bump('previews stopped at a roll');
        return r.state;
    }
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

/**
 * A crew member's command radius from the weapon table (§10.1, §12.1), worked out here: the best Threat in hand (only
 * a pistol with a Very heavy carry, §15.1), unarmed 1, ×1.5 rounded down on the takeover turn.
 */
function tableRadius(state: State, member: State['crew'][number]): number {
    const carrying = member.loadout.carrying, pistolOnly = carrying !== null && (CARRY_WEIGHT as Record<string, string>)[carrying] === 'very heavy';
    const table = ITEMS as Record<string, { threat?: number; pistol?: true }>;
    const threat = Math.max(1, ...member.loadout.items.map(id => (!pistolOnly || table[id]?.pistol ? table[id]?.threat ?? 0 : 0)));
    return state.takeover === state.turn ? Math.floor(threat * 1.5) : threat;
}

/** Where an NPC is: a hostage led along (M2-03) with whoever leads it. */
const whereIs = (state: State, n: State['npcs'][number]): Pos => state.crew.find(c => c.dragging === n.id)?.pos ?? n.pos;

/** The Commanded NPCs a hold keeps this world phase (§10.3), worked out here: within a holder's radius and sight. */
function heldByHolds(world: ReadonlyWorld, state: State): Set<string> {
    const out = new Set<string>();
    for (const c of state.crew) {
        if (c.holding !== state.turn) continue;
        const radius = tableRadius(state, c);
        for (const n of state.npcs) {
            const at = whereIs(state, n), dx = at.x - c.pos.x, dy = at.y - c.pos.y;
            if (n.command !== null && dx * dx + dy * dy <= radius * radius && hasLineOfSight(world, state, c.pos, at)) out.add(n.id);
        }
    }
    return out;
}

/** Actions offered too rarely for the floors to rest on chance (`playOne` takes each the first few times). */
const RARE_COMMANDS: readonly Command['type'][] = ['door', 'interact', 'fixDrill'];

/** The takeover's commands (M2-01). */
const TAKEOVER = new Set(['command', 'go', 'maskUp', 'hold']);
/** The hostages' commands (M2-03), played in the takeover game. */
const HOSTAGE_COMMANDS = new Set(['zipTie', 'escort', 'coerce']);

/**
 * The command's rings (§10.1) are its outcome for everything not rolled, and a resister's shown chance is the chance
 * rolled with (M2-01): every NPC `commandPlan` (and its projection, `commandPreview`) puts in a ring does what it says.
 */
function checkCommand(run: Run, state: State, crew: string, r: CommitResult): void {
    const { world, probe } = run;
    const plan = commandPlan(world, state, crew), shown = commandPreview(world, state, crew);
    for (const e of r.events) if (e.type === 'panicked') probe.bump('panicked');
    const known = plan.targets.filter(t => isKnownNow(world, state, t.npc));
    if (JSON.stringify(shown.targets) !== JSON.stringify(known)) probe.fail(`${run.label}: command preview ${JSON.stringify(shown.targets)}, known ${JSON.stringify(known)}`);
    const noise = r.events.find(e => e.type === 'noise' && e.cause === `command ${crew}`) as Extract<SimEvent, { type: 'noise' }> | undefined;
    if (noise?.radius !== plan.panicRadius) probe.fail(`${run.label}: the shout's radius ${noise?.radius}, shown ${plan.panicRadius}`);
    const ring = soundRing(world, state, state.crew.find(c => c.id === crew)!.pos, plan.panicRadius);
    const inCommand = new Set(plan.commandTiles.map(p => `${p.x},${p.y}`));
    if (JSON.stringify(ring.tiles.map(t => t.pos).filter(p => !inCommand.has(`${p.x},${p.y}`))) !== JSON.stringify(plan.panicTiles)) probe.fail(`${run.label}: panic ring tiles differ`);
    // The ring itself, worked out here from the weapon table and line of sight, not from the rules' own helpers.
    const member = state.crew.find(c => c.id === crew)!;
    const radius = tableRadius(state, member);
    if (plan.radius !== radius) probe.fail(`${run.label}: command radius ${plan.radius}, the weapon table says ${radius}`);
    for (const n of state.npcs) {
        const at = whereIs(state, n), dx = at.x - member.pos.x, dy = at.y - member.pos.y;
        const inside = dx * dx + dy * dy <= radius * radius && hasLineOfSight(world, state, member.pos, at);
        const t = plan.targets.find(x => x.npc === n.id);
        if (t && (t.ring === 'command') !== inside) probe.fail(`${run.label}: ${n.id} in the ${t.ring} ring, within reach ${inside}`);
    }
    const after = (id: string) => r.state.npcs.find(n => n.id === id)!, was = (id: string) => state.npcs.find(n => n.id === id)!;
    const commanded = (id: string) => after(id).status === 'commanded' && after(id).command?.pips === world.rules.commandPips && after(id).command?.by === crew;
    for (const t of plan.targets) {
        probe.bump(`command ${t.ring} ${t.outcome}`);
        if (t.outcome === 'complies' && !commanded(t.npc)) probe.fail(`${run.label}: ${t.npc} shown complying, is ${after(t.npc).status}`);
        if (t.outcome === 'ignores' && after(t.npc).status === 'commanded') probe.fail(`${run.label}: ${t.npc} shown ignoring, commanded`);
        if (t.outcome === 'still' && after(t.npc).status !== was(t.npc).status) probe.fail(`${run.label}: ${t.npc} face down, changed`);
        if (t.outcome === 'alerted' && !after(t.npc).alerted) probe.fail(`${run.label}: ${t.npc} in the panic ring, not Alerted`);
        if (t.outcome === 'panics' && after(t.npc).panic === null) probe.fail(`${run.label}: ${t.npc} shown panicking, is ${after(t.npc).status}`);
        if (t.outcome === 'alerted' && after(t.npc).panic !== null && was(t.npc).panic === null) probe.fail(`${run.label}: ${t.npc} shown alerted, panicked`);
        if (t.outcome === 'resists') {
            const roll = r.rolls.find(x => x.reason === `resist ${t.npc}`);
            if (!roll || roll.p !== t.chance) probe.fail(`${run.label}: ${t.npc} shown ${t.chance} to resist, rolled ${roll?.p}`);
            else if ((roll.value < t.chance!) === commanded(t.npc)) probe.fail(`${run.label}: ${t.npc} rolled ${roll.value} against ${roll.p}, commanded ${commanded(t.npc)}`);
        }
    }
    // Nobody outside the command ring goes face down.
    const ringed = new Set(plan.targets.filter(t => t.ring === 'command').map(t => t.npc));
    for (const n of r.state.npcs) if (!ringed.has(n.id) && n.status === 'commanded' && was(n.id).status !== 'commanded') probe.fail(`${run.label}: ${n.id} commanded outside the ring`);
    if (r.rolls.some(x => !x.reason.startsWith('resist '))) probe.fail(`${run.label}: a command rolled something besides resisting`);
}

/**
 * Where a bag thrown to `to` lands and who catches it, worked out here from the design (§15.1 and decisions 53, 44), not
 * from the rules' code: the thrower's hands hold a Heavy bag; `to` is 1 to 2 tiles away (r² ≤ 4) on a tile one could
 * stand on; each hop of the flight (one step, a diagonal's four corner edges, or two steps in a line over a tile that
 * isn't tall) crosses no wall, closed door or glass as they stand now and no door the crew can't vouch for, on one
 * level; a teammate standing on `to` with nothing in the hands catches it. Null: it can't be thrown there.
 */
function expectedThrow(world: ReadonlyWorld, state: State, crew: string, to: Pos): { loot: string; catcher: string | null } | null {
    const member = state.crew.find(c => c.id === crew)!, from = member.pos;
    const weight = (id: string) => world.objects.find(o => o.id === id)!.loot!.weight;
    const holds = (id: string) => Object.keys(state.loot).sort().filter(l => state.loot[l]!.holder === id && weight(l) !== 'light');
    const bag = holds(crew)[0];
    if (bag === undefined || weight(bag) !== 'heavy' || member.dragging !== null) return null;
    const dx = to.x - from.x, dy = to.y - from.y, d2 = dx * dx + dy * dy;
    if (d2 < 1 || d2 > 4 || !inBounds(world, to) || tileAt(world, to)!.blocksMove) return null;
    const doubt = doorDoubt(world, state);
    const clear = (key: string) => !edgeNow(world, state, key)?.blocksMove && !(doubt && world.edges[key]?.door && doubt.doors.has(world.edges[key]!.door!));
    const level = (a: Pos, b: Pos) => tileAt(world, a)!.raised === tileAt(world, b)!.raised;
    const hop = (a: Pos, b: Pos) => level(a, b) && (a.x !== b.x && a.y !== b.y ? cornerEdges(a, b).map(edgeKey) : [edgeKey(edgeBetween(a, b))]).every(clear);
    if (d2 === 4) {
        const mid = { x: from.x + dx / 2, y: from.y + dy / 2 };
        if (tileAt(world, mid)!.tall || !hop(from, mid) || !hop(mid, to)) return null;
    } else if (!hop(from, to)) return null;
    const mate = state.crew.find(c => c.id !== crew && c.pos.x === to.x && c.pos.y === to.y);
    return { loot: bag, catcher: mate && mate.dragging === null && !holds(mate.id).length ? mate.id : null };
}

/**
 * A throw's preview is its outcome (M2-04, §15.1), against the design worked out here (`expectedThrow`): the tiles the
 * rules let the bag be thrown to are exactly those, and the committed throw and its action preview land it where it
 * says and give it to whom it says; `throwPlan` (what the scene draws the arc from) says the same.
 */
function checkThrow(run: Run, state: State, cmd: Extract<Command, { type: 'throwLoot' }>, r: CommitResult, shown: ReturnType<typeof actionPreview>): void {
    const { world, probe } = run;
    const member = state.crew.find(c => c.id === cmd.crew)!;
    const square: Pos[] = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) square.push({ x: member.pos.x + dx, y: member.pos.y + dy });
    const offered = new Set(throwTargets(world, state, cmd.crew).map(p => `${p.x},${p.y}`));
    for (const p of square) {
        // Off the map has no tile to judge: the rules must not offer it.
        const want = inBounds(world, p) ? expectedThrow(world, state, cmd.crew, p) !== null : false;
        if (want !== offered.has(`${p.x},${p.y}`)) probe.fail(`${run.label}: a throw to ${p.x},${p.y} is ${offered.has(`${p.x},${p.y}`) ? '' : 'not '}offered, the design says ${want ? '' : 'not '}so`);
    }
    const expected = expectedThrow(world, state, cmd.crew, cmd.to);
    if (!expected) { probe.fail(`${run.label}: a throw to ${JSON.stringify(cmd.to)} committed that the design refuses`); return; }
    const want = JSON.stringify({ type: 'lootThrown', crew: cmd.crew, loot: expected.loot, from: member.pos, to: cmd.to, caughtBy: expected.catcher });
    const thrown = (events: readonly SimEvent[]) => events.filter(e => e.type === 'lootThrown').map(e => JSON.stringify(e));
    if (JSON.stringify(thrown(r.events)) !== JSON.stringify([want])) probe.fail(`${run.label}: throw expected ${want}, committed ${JSON.stringify(thrown(r.events))}`);
    if (shown.ok && JSON.stringify(thrown(shown.events)) !== JSON.stringify([want])) probe.fail(`${run.label}: throw shown ${JSON.stringify(thrown(shown.events))}, expected ${want}`);
    const plan = throwPlan(world, state, cmd);
    if (typeof plan === 'string' || plan.catcher !== expected.catcher || plan.loot !== expected.loot) probe.fail(`${run.label}: throwPlan ${JSON.stringify(plan)}, expected ${want}`);
    const bag = r.state.loot[expected.loot]!;
    if (bag.holder !== expected.catcher || (expected.catcher === null && (bag.pos.x !== cmd.to.x || bag.pos.y !== cmd.to.y))) probe.fail(`${run.label}: the bag ended ${JSON.stringify(bag)}, expected ${want}`);
    const catcher = expected.catcher && r.state.crew.find(c => c.id === expected.catcher)!;
    if (catcher && (catcher.loadout.carrying !== 'lootBag' || catcher.actionsLeft !== state.crew.find(c => c.id === expected.catcher)!.actionsLeft)) probe.fail(`${run.label}: ${expected.catcher} caught it wrong`);
    if (r.state.crew.find(c => c.id === cmd.crew)!.loadout.carrying !== null) probe.fail(`${run.label}: the thrower still carries something`);
    probe.bump(expected.catcher ? 'throws caught' : 'throws landed');
}

/** Ends the turn, having checked each crew member's own tile (`stay`): the world phase as the overlay foresaw it. */
function endTurn(run: Run, state: State): State {
    const { world, probe } = run;
    if (run.omniscient) state = omniscient(world, state);
    const picture = previewPicture(world, state);
    const npcs = knownIds(world, state), cameras = new Set(world.cameras.filter(c => picture.cameras[c.id]?.live).map(c => c.id));
    const stays = state.crew.map(c => ({ crew: c.id, tile: safeFloor(world, state, c.id).at(c.pos)! }));
    const oracle = endPhase(world, picture);
    for (const { crew, tile } of stays) {
        const o = sure(effectOf(oracle.events, crew, picture), tile, npcs, cameras);
        if (show(o) !== show(sure(tile.next!, tile, npcs, cameras))) probe.fail(`${run.label} t${state.turn} stay ${crew}: next ${show(tile.next)}, the rules on the picture ${show(o)}`);
        probe.bump('stay checks');
    }
    const pending = projectCarriers(world, state, pendingCarriers(world, state));
    // Hold (§10.3): who is within a holder's ring as the crew phase ends is exactly who keeps their pips; the ring the
    // preview draws (`holdTargets`) is that too.
    const held = heldByHolds(world, state);
    const shown = new Set(state.crew.filter(c => c.holding === state.turn).flatMap(c => holdTargets(world, state, c.id)));
    if ([...held].sort().join() !== [...shown].sort().join()) probe.fail(`${run.label} t${state.turn}: hold ring ${[...shown]}, within reach ${[...held]}`);
    const r = endPhase(world, state);
    const done = commit(world, state, { type: 'endTurn' });
    // A jam rolled here, or one rolled by an end of turn played elsewhere (a move's) and still standing.
    if (done.events.some(e => e.type === 'drillJammed') || state.devices.some(d => d.jammed)) probe.bump('drill jams');
    checkTelegraphs(run, state, done);
    // An escapee raises the Alarm only once its runner is off the map (§9.1: it got out).
    for (const e of r.events) {
        if (e.type !== 'alarmRaised') continue;
        const c = state.carriers.find(x => x.id === e.carrier), runner = c?.kind === 'escapee' ? r.state.npcs.find(n => n.id === c.source) : undefined;
        if (c?.kind === 'escapee') probe.bump('escapee alarms');
        if (runner && runner.status !== 'away') probe.fail(`${run.label} t${state.turn}: an escapee's Alarm with ${runner.id} still on the map`);
    }
    for (const e of r.events) {
        if (e.type !== 'commandPips') continue;
        probe.bump(e.held ? 'commanded held' : 'commanded not held');
        if (e.held !== held.has(e.npc)) probe.fail(`${run.label} t${state.turn}: ${e.npc} held ${e.held}, the hold ring says ${held.has(e.npc)}`);
    }
    const started = projectCarriers(world, state, carriersStarted(r.events));
    if (JSON.stringify(pending) !== JSON.stringify(started)) probe.fail(`${run.label} t${state.turn}: hatched carriers ${JSON.stringify(pending)}, started ${JSON.stringify(started)}`);
    const pic = { before: picture, after: oracle.state, events: oracle.events };
    for (const { crew, tile } of stays) checkWorldPhase(run, state, crew, tile, state, r, npcs, cameras, `${run.label} t${state.turn} stay ${crew}`, pic);
    return r.state;
}

/**
 * No NPC acts without a telegraphed intent (§10.9, §10.8, the design's hard promise; M2-02): every draw, hero's tackle,
 * hider's call and runner's escapee in a world phase is the intent its NPC showed through the whole crew phase before
 * it (as the crew phase began, `run.shown`, and still as it ends).
 */
function checkTelegraphs(run: Run, before: State, r: CommitResult): void {
    const { probe } = run;
    const expect = (npc: string, kind: string, what: string): void => {
        // As the crew phase began: every way a run ends a turn records it, and so does its start (`began`).
        const began = run.shown?.turn === before.turn ? run.shown.actions : undefined;
        if (!began) probe.fail(`${run.label} t${before.turn}: no record of the crew phase's start to check ${npc}'s ${what} against`);
        const start = began?.get(npc), end = before.npcs.find(n => n.id === npc)?.intent.action?.kind;
        probe.bump(`telegraphed ${what}`);
        if (start !== kind || end !== kind) probe.fail(`${run.label} t${before.turn}: ${npc} ${what} without one telegraphed phase (shown ${start} then ${end})`);
    };
    for (const e of r.events) {
        if (e.type === 'drewWeapon') expect(e.npc, 'reachForWeapon', 'draw');
        else if (e.type === 'heroTackled') expect(e.npc, 'tackle', 'tackle');
        else if (e.type === 'hid' && e.called) expect(e.npc, 'hide', 'call');
        else if (e.type === 'carrierStarted' && e.kind === 'escapee' && e.holder) expect(e.holder, 'flee', 'escape');
        else if (e.type === 'panicReaction') probe.bump(`panic reaction ${e.reaction}`);
        else if (e.type === 'panicked') probe.bump('panicked');
    }
    began(run, r.state);
}

/** Records each NPC's intended action as a crew phase begins (a run's start, every end of the turn): `checkTelegraphs`. */
function began(run: Run, state: State): void {
    run.shown = { turn: state.turn, actions: new Map(state.npcs.flatMap(n => (n.intent.action ? [[n.id, n.intent.action.kind] as [string, string]] : []))) };
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
            const ended = tile.next ? endPhase(world, r.state) : null;
            const warned = (id: string): boolean => !!tile.teammates.find(t => t.crew === id)?.next;
            const now = effectOf(r.events, crew, s), mates = matesOf(crew, s, r, ended, ended ? endPhase(world, s) : null, warned);
            const next = ended ? effectOf(ended.events, crew, r.state) : null;
            const got = tintOf(now, next, 'scouted', false, false, mates), at = `${run.label} t${state.turn} ${crew}→${JSON.stringify(tile.pos)} doors ${name}`;
            probe.bump('door variants checked');
            if (tile.doorRisk) {
                if (!atLeast(got, tile.tint)) probe.fail(`${at}: door risk over ${JSON.stringify(tile.tint)}, but only ${JSON.stringify(got)} happens`);
                else if (effectKind(now) !== effectKind(tile.now) || JSON.stringify(got) !== JSON.stringify(tile.tint)) probe.bump('door variants worse than a door-risk tint');
            } else if (tile.tint.kind === 'red') {
                if (!atLeast(got, tile.tint)) probe.fail(`${at}: red (now ${show(tile.now)} next ${show(tile.next)} teammates ${JSON.stringify(tile.teammates)}), but ${JSON.stringify(got)} happens (teammates ${JSON.stringify(mates)})`);
            } else if (show(now) !== show(tile.now) || (tile.next && show(next) !== show(tile.next)) || JSON.stringify(mates) !== JSON.stringify(tile.teammates)) {
                probe.fail(`${at}: no door risk, now ${show(tile.now)} next ${show(tile.next)} teammates ${JSON.stringify(tile.teammates)}, but ${show(now)} ${show(next)} ${JSON.stringify(mates)} happens`);
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
    // Each crew member's lines name exactly who does something to them (a teammate's: `crew`).
    for (const who of [crew, ...tile.teammates.map(t => t.crew)]) {
        const mate = tile.teammates.find(t => t.crew === who), now = mate ? mate.effect : tile.now, next = mate ? mate.next ?? null : tile.next;
        const mine = lines.filter(l => (l.crew ?? crew) === who);
        const named = [...new Set(mine.flatMap(l => (l.observer ? [l.observer] : [])))].sort();
        const want = [...new Set([...observersOf(now), ...observersOf(next)])].sort();
        if (JSON.stringify(named) !== JSON.stringify(want)) probe.fail(`${run.label}: explain names ${JSON.stringify(named)} for ${who}, the effects ${JSON.stringify(want)} at ${JSON.stringify(tile.pos)}`);
        for (const l of mine) {
            if (l.observer !== null && !observersOf(l.phase === 'now' ? now : next).includes(l.observer)) probe.fail(`${run.label}: explain puts ${l.observer} in the wrong phase (${l.phase}) for ${who}`);
        }
    }
    if (lines.some(l => l.crew !== undefined && !tile.teammates.some(t => t.crew === l.crew))) probe.fail(`${run.label}: explain names a teammate the tile doesn't`);
    for (const l of lines) {
        if (l.observer === null) continue;
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
function playBank(
    probe: Probe, tier: (typeof TIERS)[number], archetype: string, plot: (typeof PLOTS)[number], s: number, combo: number, turns: number, stealth = false, seed = SEED
): void {
    const world = worldFromBank(cachedBank({ layout: 4100 + s * 97, population: s + 11, tier, archetype: archetype as never, plot }));
    const brng = new Rng(seed + 7919 * (combo + 1) + s);
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
    began(run, state);
    play(run, state, turns, true);
}

/**
 * Loot (M2-04, §15.1): the crew of three starts round a heap of loot (two bags, a crate, two drawers' cash, one with a
 * dye pack) in a bank room south of which lies the street, past a wall with gaps and a door, with NPCs of every class
 * about; the random player then takes, drops, throws, catches, passes and inspects among its moves, and walks the cash
 * out.
 */
function playLoot(probe: Probe, rng: Rng, n: number): void {
    const WIDTH = 14, HEIGHT = 9, STREET = 6;
    const rooms = Array.from({ length: HEIGHT }, (_, y) => (y < STREET ? 'b' : '.').repeat(WIDTH));
    const map = Array.from({ length: HEIGHT }, (_, y) => Array.from({ length: WIDTH }, (_, x) => (y < STREET - 1 && rng.chance(0.06) && (x < 3 || x > 10) ? rng.pick(['#', 'T']) : '.')).join(''));
    const walls: FixtureWall[] = [];
    // Gaps, panes of glass and one door to the street, so a throw can meet a door the crew can't vouch for.
    const doorX = rng.pick([1, 5, 9]);
    for (let x = 0; x < WIDTH; x++) {
        const between: [Pos, Pos] = [{ x, y: STREET - 1 }, { x, y: STREET }];
        if (x === doorX) walls.push({ between, door: { id: 'street-door', start: rng.pick(['open', 'closed'] as const) } });
        else if (x % 4 !== 1) walls.push({ between, ...(x % 4 === 2 ? { material: 'glass' as const } : {}) });
    }
    const free: Pos[] = [];
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) if (map[y]![x] === '.') free.push({ x, y });
    const at = (x: number, y: number): Pos => free.splice(free.findIndex(p => p.x === x && p.y === y), 1)[0]!;
    const cx = rng.int(4, 9), cy = rng.int(1, 3);
    const heap: [number, number, 'light' | 'heavy' | 'very heavy', number, boolean][] = [
        [cx - 1, cy - 1, 'heavy', 40000, false], [cx + 1, cy - 1, 'heavy', 20000, false], [cx, cy + 1, 'very heavy', 120000, false],
        [cx - 1, cy + 1, 'light', 5000, true], [cx + 1, cy + 1, 'light', 5000, false]
    ];
    const objects: WorldObject[] = heap.map(([x, y, weight, value, dye], i) => ({ id: `loot-${i}`, kind: 'loot', pos: at(x, y), facing: 's', loot: { value, weight, ...(dye ? { dyePack: true as const } : {}) } }));
    const crew = [at(cx, cy), at(cx - 1, cy), at(cx + 1, cy)].map((pos, i) => ({ id: `c${i}`, pos, ...(i === 2 && rng.chance(0.5) ? { traits: ['bruiser'] } : {}) }));
    const take = (): Pos => free.splice(rng.int(0, free.length - 1), 1)[0]!;
    const people: PersonDef[] = [];
    for (let i = 0, count = rng.int(1, 3); i < count; i++) {
        const observer = rng.pick(['civilian', 'staff', 'enforcer'] as ObserverClass[]);
        const role = observer === 'civilian' ? 'customer' : observer === 'staff' ? 'teller' : 'guard';
        people.push({ id: `n${i}`, name: `n${i}`, role, observer, pos: take(), facing: rng.pick(FACINGS), schedule: randomSchedule(rng, free) });
    }
    const world = fixtureWorld(map, { rooms, walls, people, objects, rules: { checkInPeriod: 2, dispatchCheckInPeriod: 2, dispatchSilence: 2, dyePacks: true } });
    const state = initialState(world, { seed: n, crew });
    play({ world, rng, omniscient: n % 2 === 0, label: `loot ${n}`, tier: 'fixture', probe, loot: true }, state, FIXTURE_TURNS + 2, false);
}

/**
 * Vault access (M2-05, §15.2, §15.3): an antechamber with the console, the manager's PC and a wall of deposit boxes, a
 * card-reader door and a picked lock, before a vault of a random kind (a code, dual control or Three Keys, a time lock
 * or none, sensors or none); a crew with the drill, thermite, a lockpick and a hacking kit, NPCs of every class about
 * (the key-holders among them). The random player sets the drill and the charge, fixes jams, hacks, picks and enters
 * codes among its moves; jams (more likely here, 40%) are rolled as the crew phase begins, so the world phase's
 * preview stops at their odds.
 */
function playVault(probe: Probe, rng: Rng, n: number): void {
    const map = ['..........', '..........', '..........', '..........', '..........', '..........'];
    const rooms = ['aaaaaavvvv', 'aaaaaavvvv', 'aaaaaavvvv', 'aaaaaavvvv', 'ssssssvvvv', 'ssssssvvvv'];
    const walls: FixtureWall[] = [
        ...Array.from({ length: 6 }, (_, y) => (y === 1 ? { between: [{ x: 5, y }, { x: 6, y }] as [Pos, Pos], material: 'vault' as const, door: { id: 'vaultDoor', lock: 'vault' as const, start: 'locked' as const } }
            : { between: [{ x: 5, y }, { x: 6, y }] as [Pos, Pos], material: 'vault' as const })),
        ...Array.from({ length: 6 }, (_, x) => (x === 1 ? { between: [{ x, y: 3 }, { x, y: 4 }] as [Pos, Pos], door: { id: 'reader', lock: 'keycard' as const, start: 'locked' as const } }
            : x === 4 ? { between: [{ x, y: 3 }, { x, y: 4 }] as [Pos, Pos], door: { id: 'office', lock: 'mechanical' as const, start: 'locked' as const } } : { between: [{ x, y: 3 }, { x, y: 4 }] as [Pos, Pos] }))
    ];
    const objects: WorldObject[] = [
        { id: 'console', kind: 'vaultConsole', pos: { x: 2, y: 0 }, facing: 's', room: 'a' },
        { id: 'pc', kind: 'managerPc', pos: { x: 0, y: 5 }, facing: 's', room: 's' },
        { id: 'boxes', kind: 'depositBoxes', pos: { x: 0, y: 0 }, facing: 's', room: 'a' },
        { id: 'haul', kind: 'loot', pos: { x: 0, y: 1 }, facing: 's', room: 'a', loot: { value: 10000, weight: 'heavy', behind: 'depositWall' } },
        { id: 'box-0', kind: 'loot', pos: { x: 0, y: 1 }, facing: 's', room: 'a', loot: { value: 5000, weight: 'light', behind: 'depositBox' } },
        { id: 'box-1', kind: 'loot', pos: { x: 0, y: 1 }, facing: 's', room: 'a', loot: { value: 5000, weight: 'light', behind: 'depositBox' } },
        { id: 'gold', kind: 'loot', pos: { x: 8, y: 2 }, facing: 's', room: 'v', loot: { value: 120000, weight: 'very heavy' } },
        { id: 'sensor', kind: 'motionSensor', pos: { x: 9, y: 0 }, facing: 's', room: 'v' }
    ];
    const social = rng.pick(['code', 'dual', 'threeKeys'] as const);
    const from = rng.int(1, 4);
    const lock: KeyLock = {
        id: 'vault', name: 'Vault', target: 'vaultDoor', room: 'v', holders: ['manager', 'head'],
        social: social === 'code' ? { kind: 'code', parts: ['whole'], text: '' } : social === 'dual' ? { kind: 'code', parts: ['headTeller', 'manager'], text: '' } : { kind: 'threeKeys', keycard: ['manager'], text: '' },
        technical: { kind: 'drill', phases: rng.int(3, 6), noise: 6, sensors: rng.pick([[], ['seismic'], ['seismic', 'motion']] as ('seismic' | 'motion')[][]), text: '' },
        violent: { kind: 'thermite', phases: rng.int(2, 3), noise: 6, text: '' },
        ...(social === 'threeKeys' || rng.chance(0.5) ? { timeLock: { from, until: from + 2 } } : {})
    };
    const free: Pos[] = [];
    for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) if (!objects.some(o => o.kind !== 'loot' && o.pos.x === x && o.pos.y === y)) free.push({ x, y });
    const at = (x: number, y: number): Pos => free.splice(free.findIndex(p => p.x === x && p.y === y), 1)[0]!;
    const crew: CrewStart[] = [
        { id: 'c0', pos: at(5, 1), items: ['drill', 'thermite', 'pistol'] },
        { id: 'c1', pos: at(3, 2), items: ['hackingKit'] },
        { id: 'c2', pos: at(1, 2), items: ['lockpick', 'hackingKit', 'zipTies'], traits: ['steadyHands'] }
    ];
    const take = (): Pos => free.splice(rng.int(0, free.length - 1), 1)[0]!;
    const people: PersonDef[] = [
        { id: 'manager', name: 'manager', role: 'manager', observer: 'staff', pos: at(3, 0), facing: 's', schedule: [] },
        { id: 'head', name: 'head', role: 'headTeller', observer: 'staff', pos: at(2, 1), facing: 's', schedule: [] }
    ];
    for (let i = 0, count = rng.int(0, 2); i < count; i++) {
        const observer = rng.pick(['civilian', 'staff', 'enforcer'] as ObserverClass[]);
        people.push({ id: `n${i}`, name: `n${i}`, role: observer === 'civilian' ? 'customer' : observer === 'staff' ? 'teller' : 'guard', observer, pos: take(), facing: rng.pick(FACINGS), schedule: randomSchedule(rng, free) });
    }
    const world = fixtureWorld(map, { zones: ['xxxxxxxxxx', 'xxxxxxxxxx', 'xxxxxxxxxx', 'xxxxxxxxxx', 'ssssssxxxx', 'ssssssxxxx'], rooms, walls, people, objects, locks: [lock], rules: { drillJamChance: 0.4 } });
    let state = initialState(world, { seed: n, crew });
    // Often the takeover's shout first (c0's pistol reaches the key-holders), so codes get coerced; now and then the
    // crew starts knowing what the manager's PC tells, as if hacked already.
    if (rng.chance(0.6)) state = commit(world, state, { type: 'command', crew: 'c0' }).state;
    const pcPart = partOf(world, 'manager');
    if (pcPart && rng.chance(0.3)) state = { ...state, codesKnown: [pcPart] };
    play({ world, rng, omniscient: n % 2 === 0, label: `vault ${n} ${social}`, tier: 'fixture', probe, vault: true }, state, FIXTURE_TURNS + 3, false);
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
    began(run, state);
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
    began(run, state);
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

/**
 * The takeover on an open floor (M2-01): a crowd and a guard round two armed crew, GO now and then, commands from
 * wherever the crew walks to, holds, and turns going by so commands lapse, guards reach for their weapons and the
 * commanded are put down again. Every command is checked against its rings (`checkCommand`), every hold against its
 * ring (`endTurn`), and the floor and the world phase as everywhere else.
 */
function takeoverGame(probe: Probe, n: number): void {
    const rng = new Rng(SEED + 7919 * n);
    const taken = new Set<string>(), free = (): Pos => {
        for (;;) {
            const p = { x: rng.int(0, 13), y: rng.int(0, 9) }, k = `${p.x},${p.y}`;
            if (!taken.has(k)) { taken.add(k); return p; }
        }
    };
    const exit = { x: 13, y: 9 };
    taken.add('13,9');
    // Shelves to hide behind, and a bay behind a row of them, open at its top (M2-02).
    const map = ['..............', '..........T...', '..........T...', '..........T...', '..........T...', '..........T...', '...TT.....T...', '..............', '..............', '..............'];
    map.forEach((row, y) => [...row].forEach((c, x) => { if (c === 'T') taken.add(`${x},${y}`); }));
    const people: PersonDef[] = [];
    // M2-02: an off-duty cop, a hero and a passer-by among them.
    const roles: [string, ObserverClass, Pick<PersonDef, 'armed' | 'hero'>?][] = [
        ['customer', 'civilian'], ['customer', 'civilian'], ['customer', 'civilian'], ['lobbyGuard', 'enforcer'], ['teller', 'staff'], ['manager', 'staff'],
        ['customer', 'civilian', { armed: 'hidden' }], ['customer', 'civilian', { hero: true }], ['passer-by', 'civilian']
    ];
    roles.forEach(([role, observer, traits], i) => {
        const at = free();
        people.push({ id: `n${i}`, name: `n${i}`, role, observer, pos: at, facing: rng.pick(FACINGS), ...(traits ?? {}), schedule: [
            { from: 1, activity: role === 'teller' ? 'window' : role === 'manager' ? 'post' : 'wait', label: 'stands', room: '', at, facing: 'n' },
            { from: 99, activity: 'leave', label: 'leaves', room: '', at: exit }
        ] });
    });
    const world = fixtureWorld(map, { people });
    const weapons = ['pistol', 'shotgun', 'lmg', 'smg'];
    // In half the games c1 starts beside the hero and stays there, so tackles happen (M2-02).
    const hero = people.find(p => p.hero)!, beside = { x: hero.pos.x + (hero.pos.x < 13 ? 1 : -1), y: hero.pos.y };
    const anchored = !taken.has(`${beside.x},${beside.y}`) && rng.chance(0.5);
    const c1 = anchored ? (taken.add(`${beside.x},${beside.y}`), beside) : free();
    let state = omniscient(world, initialState(world, { seed: n, crew: [
        { id: 'c0', pos: free(), items: [rng.pick(weapons)], ...(rng.chance(0.3) ? { traits: ['intimidating'] } : {}) },
        { id: 'c1', pos: c1, items: [rng.pick(weapons)] }
    ] }));
    const run: Run = { world, rng, omniscient: true, label: `takeover ${n}`, tier: 'fixture', probe };
    began(run, state);
    for (let turn = 0; turn < 6 && !state.bank.alarm; turn++) {
        if (rng.chance(0.25) && !state.bank.loud) state = commit(world, state, { type: 'go', crew: 'c0' }).state;
        // A hero about to tackle someone is mostly let be, so the tackle happens (M2-02).
        const tackling = state.npcs.some(x => x.intent.action?.kind === 'tackle') && rng.chance(0.8);
        for (const id of ['c0', 'c1']) {
            let member = state.crew.find(c => c.id === id)!;
            if (!tackling && !(anchored && id === 'c1') && rng.chance(0.6) && member.actionsLeft > 0) {
                const reach = reachable(world, state, member.pos, crewBudget(world, member, 'move'), crewMoveOptions(world, member));
                const ends = reach.tiles.filter(t => t.canEnd && t.cost > 0);
                const path = ends.length ? pathTo(reach, rng.pick(ends).pos) : undefined;
                if (path?.length) state = commit(world, state, { type: 'move', crew: id, path }).state;
            }
            member = state.crew.find(c => c.id === id)!;
            if (member.actionsLeft > 0 && !tackling) {
                const r = commit(world, state, { type: 'command', crew: id });
                probe.bump('commands');
                checkCommand(run, state, id, r);
                state = r.state;
            }
            member = state.crew.find(c => c.id === id)!;
            // The hostages (M2-03): tie, lead, coerce whoever is face down in reach; each preview is its commit.
            const hostage = legalActions(world, state, id).filter(c => HOSTAGE_COMMANDS.has(c.type));
            if (member.actionsLeft > 0 && hostage.length && rng.chance(0.6)) {
                const cmd = rng.pick(hostage), shown = actionPreview(world, state, cmd), r = commit(world, state, cmd);
                probe.bump(`command ${cmd.type}`);
                const projected = projectPreviewEvents(world, state, commit(world, withDoubtedShut(world, state), cmd));
                if (!shown.ok || JSON.stringify(shown.events) !== JSON.stringify(projected)) probe.fail(`takeover ${n}: ${cmd.type} preview events differ from its commit`);
                if (shown.ok && shown.events.some(e => e.type === 'hiddenWeaponFound')) probe.fail(`takeover ${n}: a preview told of a hidden weapon`);
                state = r.state;
                member = state.crew.find(c => c.id === id)!;
            }
            if (member.actionsLeft > 0 && rng.chance(0.5) && state.npcs.some(x => x.command !== null)) state = commit(world, state, { type: 'hold', crew: id }).state;
        }
        state = endTurn(run, state);
    }
}

/**
 * Runners and a crew in the way (M2-02, §9.1): a passer-by panicked by a shout runs for the way out beyond a wall with
 * two gaps, while a crew member stands in one gap or the other, or elsewhere, turn by turn. Every end of the turn is
 * checked as everywhere (`endTurn`): no escapee raises the Alarm with its runner still on the map, whatever the crew's
 * standing in the way did to its route.
 */
function escapeeGame(probe: Probe, n: number): void {
    const rng = new Rng(SEED + 104729 * n);
    const gaps = [rng.int(0, 5), rng.int(7, 12)];
    const map = Array.from({ length: 10 }, (_, y) => (y === 3 ? [...'TTTTTTTTTTTTTT'].map((c, x) => (gaps.includes(x) ? '.' : c)).join('') : '..............'));
    const exit = { x: 13, y: 0 };
    const at = { x: rng.int(0, 13), y: rng.int(6, 9) };
    const people: PersonDef[] = [{ id: 'walker', name: 'walker', role: 'passer-by', observer: 'civilian', pos: at, facing: 'n', schedule: [
        { from: 1, activity: 'wait', label: 'stands', room: '', at, facing: 'n' }, { from: 99, activity: 'leave', label: 'leaves', room: '', at: exit }
    ] }];
    const world = fixtureWorld(map, { people });
    const shouter = { x: at.x < 7 ? at.x + 4 : at.x - 4, y: at.y };
    let state = omniscient(world, initialState(world, { seed: n, crew: [{ id: 'c0', pos: shouter, items: ['pistol'] }, { id: 'c1', pos: { x: gaps[1]!, y: 5 } }] }));
    const run: Run = { world, rng, omniscient: true, label: `escapee ${n}`, tier: 'fixture', probe };
    began(run, state);
    state = commit(world, state, { type: 'command', crew: 'c0' }).state;
    for (let turn = 0; turn < 8 && !state.bank.alarm; turn++) {
        const c1 = state.crew.find(c => c.id === 'c1')!;
        const to = rng.chance(0.6) ? { x: rng.pick(gaps), y: 3 } : { x: rng.int(0, 13), y: rng.int(4, 9) };
        const reach = reachable(world, state, c1.pos, crewBudget(world, c1, 'move'), crewMoveOptions(world, c1));
        const path = pathTo(reach, to);
        if (path?.length) state = commit(world, state, { type: 'move', crew: 'c1', path }).state;
        state = endTurn(run, state);
    }
}

describe('previews (property, §8.8)', () => {
    it('show the takeover as it happens: the command rings, resisters\' chances and holds (M2-01)', () => {
        const probe = new Probe();
        const games = Math.max(30, Math.round(30 * SCALE));
        for (let n = 0; n < games; n++) {
            try {
                takeoverGame(probe, n);
            } catch (e) {
                probe.fail(`takeover ${n}: ${(e as Error).stack ?? e}`);
            }
        }
        if (VERBOSE) console.log(JSON.stringify(probe.stats, null, 1));
        expect(probe.failures).toEqual([]);
        // Every outcome of the rings, and holds that keep and that don't.
        for (const k of ['command command complies', 'command command resists', 'command panic alerted', 'command panic panics', 'commanded held', 'commanded not held', 'panicked']) {
            expect(probe.stats[k] ?? 0, k).toBeGreaterThan(5);
        }
        for (const k of ['command zipTie', 'command escort']) expect(probe.stats[k] ?? 0, k).toBeGreaterThan(5);
        // M2-02: every panic reaction, and each telegraphed act it leads to (checked by `checkTelegraphs`).
        for (const k of ['panic reaction cower', 'panic reaction flee', 'panic reaction hide', 'panic reaction reach', 'telegraphed draw', 'telegraphed escape', 'telegraphed tackle', 'telegraphed call']) {
            expect(probe.stats[k] ?? 0, k).toBeGreaterThan(0);
        }
        // Runners with the crew in the way (M2-02): escapee alarms happen, never with the runner inside (`endTurn`).
        for (let n = 0; n < games; n++) {
            try {
                escapeeGame(probe, n);
            } catch (e) {
                probe.fail(`escapee ${n}: ${(e as Error).stack ?? e}`);
            }
        }
        expect(probe.failures).toEqual([]);
        expect(probe.stats['escapee alarms'] ?? 0, 'escapee alarms').toBeGreaterThan(0);
        // A guard whose command lapsed reaches for his weapon and ignores the next one.
        expect(probe.stats['command command ignores'] ?? 0).toBeGreaterThan(0);
    }, 300_000);

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
            began(run, state);
            play(run, state, FIXTURE_TURNS, true);
        }
        for (let n = 0; n < DOOR_RUNS; n++, seeds++) playDoorCuts(probe, rng, n);
        // Its own stream, so the rest of the sample stays as it was.
        const drng = new Rng(SEED + 4441);
        for (let n = 0; n < DOUBT_RUNS; n++, seeds++) playDoubtedDoors(probe, drng, n);
        // Its own stream too.
        const lrng = new Rng(SEED + 7717);
        for (let n = 0; n < LOOT_RUNS; n++, seeds++) playLoot(probe, lrng, n);
        // Its own stream too.
        const vrng = new Rng(SEED + 9973);
        for (let n = 0; n < VAULT_RUNS; n++, seeds++) playVault(probe, vrng, n);
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
            'moves seen by an NPC they turned', 'hearers whose last tile heard is not the nearest', 'moves that do something to a teammate',
            'moves that make a teammate\'s world phase worse'
        ]) expect(st[k] ?? 0, k).toBeGreaterThan(0);
        for (const type of ['door', 'knockout', 'drag', 'interact', 'takeLoot', 'dropLoot', 'pass', 'inspectLoot', 'drill', 'thermite', 'coerce', 'fixDrill', 'takeDrill']) expect(st[`command ${type}`] ?? 0, type).toBeGreaterThan(0);
        expect(st['drill jams'] ?? 0, 'drill jams').toBeGreaterThan(0);
        for (const k of ['throws caught', 'throws landed']) expect(st[k] ?? 0, k).toBeGreaterThan(0);
    }, 600_000);
    // Long games (the reviewer's harness): a quiet crew (no weapons, no knockouts, no lock work, mostly calm tiles) plays on while
    // routines get known, ghosts come and go and NPCs drift off what the crew saw.
    // PREVIEW_LONG_GAMES banks (default 2) of PREVIEW_LONG_TURNS turns (default 25), every tier × archetype in turn.
    it('show what happens in long games', () => {
        const probe = new Probe();
        const combos = TIERS.flatMap(tier => archetypesFor(tier).map(archetype => ({ tier, archetype })));
        const games = Number(process.env.PREVIEW_LONG_GAMES ?? 2), turns = Number(process.env.PREVIEW_LONG_TURNS ?? 25);
        // Their own stream (PREVIEW_LONG_SEED), apart from the sample's.
        const seed = Number(process.env.PREVIEW_LONG_SEED ?? 20261015);
        for (let g = 0; g < games; g++) {
            const { tier, archetype } = combos[(g * 5) % combos.length]!;
            playBank(probe, tier, archetype, PLOTS[g % PLOTS.length]!, 100 + g, g + 1, turns, true, seed);
        }
        if (VERBOSE) {
            console.log(JSON.stringify(Object.fromEntries(Object.entries(probe.stats).sort()), null, 1));
            for (const f of probe.failures) console.log('FAIL', f);
        }
        expect(probe.failures).toEqual([]);
        expect(probe.stats.commands ?? 0).toBeGreaterThan(games * turns * 2);
    }, 600_000);
});
