import type { Approach, Door, GenCamera, GenRoom, GetawaySpot, OffMapRoute, PlotExit, RuleResult } from './model';
import type { LevelProp } from '../level/plan';
import { MOVE_ACTIONS } from '../sim/data/movement';
import { clonePlain } from '../sim/core/json';
import {
    assessEnd, cameraObserver, commit, crewBudget, crewMember, encodeBits, fieldOn, IllegalCommand, initialState, npcObserver, pathSafety, placeCrew, planMoveOptions, profilesOf,
    safeFloor, sightMap, stepCost, tileAt, type Command, type Facing, type Observer, type Pos, type ReadonlyWorld, type State
} from '../sim';
import { reachesFrom, type Nav, type P } from './nav';
import type { Furnished } from './parcels';
import type { GuardPlan } from './security';
import type { Site } from './site';

/*
 * The checks of §17.7: a seed that fails any of them is rolled again. When too many seeds fail, rules are relaxed in a
 * fixed order (`RELAX_ORDER`): a relaxed rule still runs and is reported, but no longer rejects the bank.
 *
 * What is seen is the rules' own vision (M5-01): the checks that ask it (the guards' overlap, the cameras, the Clean
 * route) run on the rules' World built from the bank and its state on turn 1 (`src/sim`), so the generator and the game
 * never disagree about sight: the arcs and ranges of §8.3, darkness, the corner rule, cameras blind in the dark.
 */

export const RULES = {
    approachesReachVault: 'Every guaranteed approach reaches the vault (at least 4, from 3 categories, one covert to the CCTV room or alarm closet)',
    cleanRoute: 'A Clean-profile stealth route from the lobby to the CCTV room or the alarm closet',
    loops: 'At least 2 loops between Public and Secure space, every zone with at least 2 connections',
    guardOverlap: 'No more than 3 guards can see the same tile',
    usefulCameras: 'Every camera covers a tile someone has to cross',
    alarmsAndExits: "Every silent-alarm station reachable from the lobby, the manager's desk among them; civilian exits within reach of the crowd",
    getaways: 'Getaway spots connect to at least 2 plot exits',
    vaultDepth: 'The vault is at least 2 doors from any Public tile; the CCTV room is not on the vault corridor',
    objectsReachable: 'Every piece of loot and every heist object can be reached by the crew from where they start',
    sewerExit: 'A sewer route: a way off the plot on foot that the helicopter cannot close (§15.4 "Escape is always possible")'
} as const;

export type Rule = keyof typeof RULES;

/** Which rules give way first when too many seeds fail. */
export const RELAX_ORDER: Rule[] = ['guardOverlap', 'usefulCameras', 'alarmsAndExits', 'cleanRoute'];

/**
 * The props the crew acts on in a heist (the rules' objects with a verb: `OBJECT_KINDS` in `src/sim/world/fromBank.ts`,
 * the ways in aside, which `approachesReachVault` checks). The manager's PC is on the desk the office's loot lies on.
 */
export const HEIST_OBJECTS: readonly LevelProp['kind'][] = [
    'alarmPanel', 'breakerPanel', 'cctvDesk', 'vaultConsole', 'serverRack', 'depositBoxes', 'atmBack', 'phoneLine', 'wiringBox', 'uniformRack'
];

/** How far (in steps) the crowd may be from a civilian exit (§17.7's "set distance band"). */
export const EXIT_BAND: [number, number] = [1, 28];

interface Ctx {
    site: Site;
    nav: Nav;
    bank: GenRoom[];
    doors: Door[];
    approaches: Approach[];
    routes: OffMapRoute[];
    cameras: GenCamera[];
    guards: GuardPlan[];
    furnished: Furnished;
    getaways: GetawaySpot[];
    exits: PlotExit[];
    traffic: Set<string>;
    /** The rules' World of this bank (`worldFromBank`): what the checks of sight run on. */
    world: ReadonlyWorld;
}

export function validate(ctx: Ctx): RuleResult[] {
    const { site, nav, bank, doors } = ctx;
    const ofType = (t: string) => bank.filter(r => r.type === t);
    const tiles = (rooms: GenRoom[]) => rooms.flatMap(r => nav.tilesOf(r));
    const vault = tiles(ofType('vault'));
    const lobby = tiles(ofType('lobby'));
    const result = (rule: Rule, ok: boolean, detail: string): RuleResult => ({ rule: RULES[rule], ok, detail });
    const results: RuleResult[] = [];

    // Every approach reaches the vault (through any door: every lock has its keys).
    const fromVault = nav.distances(vault).dist, at = (p: P) => fromVault[p.y * site.width + p.x]!;
    const stuck = ctx.approaches.filter(a => at({ x: a.inside.tx, y: a.inside.ty }) < 0);
    const categories = new Set(ctx.approaches.map(a => a.category));
    // At least one covert way reaches the CCTV room or the alarm closet, which the inside-man plan needs (§17.5).
    const coreRooms = new Set(bank.filter(r => r.type === 'cctvRoom' || r.type === 'alarmCloset').map(r => r.id));
    const toCore = nav.distances(tiles(bank.filter(r => coreRooms.has(r.id)))).dist;
    const covertToCore = ctx.approaches.some(a => a.category === 'covert' && (coreRooms.has(a.room) || toCore[a.inside.ty * site.width + a.inside.tx]! >= 0));
    results.push(result('approachesReachVault', !stuck.length && ctx.approaches.length >= 4 && categories.size >= 3 && covertToCore,
        `${ctx.approaches.length} approaches in ${categories.size} categories${covertToCore ? ', a covert one reaching the CCTV room or alarm closet' : ', no covert way to the CCTV room or alarm closet'}${stuck.length ? `; cut off: ${stuck.map(a => a.name).join(', ')}` : ''}`));

    // A sewer route (§14.7, §15.4): the on-foot way off the plot that stays open under the helicopter, from a grate
    // the crew can reach from the vault.
    const sewer = ctx.routes.find(r => r.kind === 'sewer' && at({ x: r.inside.tx, y: r.inside.ty }) >= 0);
    results.push(result('sewerExit', !!sewer, sewer ? 'a sewer route from the vault side' : 'no sewer route the crew can reach'));

    // A Clean-profile route, on the turn-1 safe floor (see `cleanRoute`).
    const turnOne = initialState(ctx.world, { seed: 0, crew: [] });
    const route = cleanRoute(ctx.world, bank, doors);
    results.push(result('cleanRoute', !!route, route ? `walks to the ${route.to} in ${route.moves.length} moves the safe floor shows green` : 'no route the safe floor shows green and the rules let a Clean crew member walk'));

    // Loops: two door-disjoint ways from the Public rooms to the Secure ones, and every zone connected at least twice.
    const flow = maxFlow(bank, doors, r => r.zone === 'public', r => r.zone === 'secure');
    const zones = ['public', 'staff', 'secure'] as const;
    const links = zones.map(z => doors.filter(d => {
        const a = site.rooms.find(r => r.id === d.a)!, b = site.rooms.find(r => r.id === d.b)!;
        return (a.bank || b.bank) && (a.zone === z) !== (b.zone === z);
    }).length);
    results.push(result('loops', flow >= 2 && links.every(n => n >= 2), `${flow} disjoint ways from Public to Secure; connections per zone ${zones.map((z, i) => `${z} ${links[i]}`).join(', ')}`));

    // Guards: how many can see each tile from their posts and along their routes, with the rules' calm eyes (§8.3).
    const sight = sightMap(ctx.world, turnOne), calm = profilesOf(ctx.world).calm;
    const seenBy = new Map<number, Set<number>>();
    ctx.guards.forEach((g, i) => {
        for (const pose of guardPoses(g)) for (const t of fieldOn(sight, { ...pose, profile: calm }).tiles) {
            const k = t.y * site.width + t.x;
            if (!seenBy.has(k)) seenBy.set(k, new Set());
            seenBy.get(k)!.add(i);
        }
    });
    const most = Math.max(0, ...[...seenBy.values()].map(s => s.size));
    results.push(result('guardOverlap', most <= 3, `at most ${most} guards see one tile`));

    // Cameras: each covers a tile people have to cross, as the rules have it look (both facings of a panning one).
    const pointless = pointlessCameras(ctx.world, turnOne, ctx.traffic);
    results.push(result('usefulCameras', !pointless.length, `${ctx.cameras.length} cameras${pointless.length ? `, ${pointless.length} pointless` : ''}`));

    // Silent-alarm stations reachable from the lobby; the crowd within the band of an exit.
    const fromLobby = nav.distances(lobby).dist;
    // An alarm on the wall is reached from the tile in front of it.
    const reached = (a: { tx: number; ty: number }) => [[0, 0], [0, 1], [1, 0], [-1, 0], [0, -1]].some(([dx, dy]) => (fromLobby[(a.ty + dy!) * site.width + a.tx + dx!] ?? -1) >= 0);
    const unreachable = ctx.furnished.alarms.filter(a => !reached(a));
    const exitTiles = doors.filter(d => {
        const a = site.rooms.find(r => r.id === d.a)!, b = site.rooms.find(r => r.id === d.b)!;
        return (a.zone === 'public' && b.zone === 'outdoors') || (b.zone === 'public' && a.zone === 'outdoors');
    }).map(d => (d.run === 'eastWest' ? { x: d.tx, y: d.ty - 1 } : { x: d.tx - 1, y: d.ty }));
    const toExit = nav.distances(exitTiles).dist;
    const far = lobby.filter(p => {
        const d = toExit[p.y * site.width + p.x]!;
        return d < EXIT_BAND[0] - 1 || d > EXIT_BAND[1] || d < 0;
    });
    // Every manager's office has its desk, with the desk button (and the PC the rules read).
    const deskless = ofType('managerOffice').filter(r => !ctx.furnished.alarms.some(a => a.room === r.id && a.name === "Manager's desk button"));
    results.push(result('alarmsAndExits', !unreachable.length && !far.length && !deskless.length,
        `${ctx.furnished.alarms.length} alarm stations${unreachable.length ? `, ${unreachable.length} unreachable` : ''}${deskless.length ? `, ${deskless.length} manager's office without its desk` : ''}; ${far.length} crowd tiles outside the exit band`));

    // Getaway spots: by road, alley or garage to at least two plot exits.
    const drivable = (x: number, y: number) => ['r', 'l', 'a', 'p', 'c', 'e'].includes(site.tiles[y]?.[x] ?? 'x');
    const reach = (from: P) => {
        const seen = new Set<string>([`${from.x},${from.y}`]), queue = [from];
        while (queue.length) {
            const p = queue.shift()!;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const q = { x: p.x + dx, y: p.y + dy }, k = `${q.x},${q.y}`;
                if (seen.has(k) || !site.inside(q.x, q.y) || !drivable(q.x, q.y) || site.wallAt({ ...(dx ? { run: 'northSouth' as const, tx: Math.max(p.x, q.x), ty: p.y } : { run: 'eastWest' as const, tx: p.x, ty: Math.max(p.y, q.y) }) })) continue;
                seen.add(k);
                queue.push(q);
            }
        }
        return ctx.exits.filter(e => seen.has(`${e.tx},${e.ty}`)).length;
    };
    const stranded = ctx.getaways.filter(g => reach({ x: g.tx, y: g.ty }) < 2);
    results.push(result('getaways', ctx.getaways.length > 0 && !stranded.length, `${ctx.getaways.length} spots${stranded.length ? `; stranded: ${stranded.map(g => g.name).join(', ')}` : ''}`));

    // The vault behind at least two doors from the public floor; the CCTV room off the vault corridor.
    const doorsFromPublic = nav.distances(tiles(bank.filter(r => r.zone === 'public')), { doorCost: 1 }).doors;
    const nearest = Math.min(...vault.map(p => doorsFromPublic[p.y * site.width + p.x]!).filter(d => d >= 0));
    const coreIds = new Set(bank.filter(r => ['antechamber', 'mantrap', 'vault'].includes(r.type)).map(r => r.id));
    const vaultCorridors = new Set(doors.filter(d => coreIds.has(d.a) !== coreIds.has(d.b)).map(d => (coreIds.has(d.a) ? d.b : d.a)));
    const cctv = ofType('cctvRoom').map(r => r.id);
    const onCorridor = doors.some(d => (cctv.includes(d.a) && vaultCorridors.has(d.b)) || (cctv.includes(d.b) && vaultCorridors.has(d.a)));
    results.push(result('vaultDepth', nearest >= 2 && !onCorridor, `${Number.isFinite(nearest) ? nearest : 'no'} doors from the public floor to the vault${onCorridor ? '; the CCTV room opens onto the vault corridor' : ''}`));

    // The loot and the heist objects: each reached (as the rules' `inReach`) from a tile the crew can walk to from their
    // van, through every door (no keys yet: a locked door is one more to open), with nobody in the way.
    const fromCrew = nav.distances([crewStart(ctx)]).dist;
    const takeable = (t: P) => reachesFrom(site, t).some(a => fromCrew[a.y * site.width + a.x]! >= 0);
    const things = [
        ...ctx.furnished.loot.map(l => ({ what: l.name, room: l.room, x: l.tx, y: l.ty })),
        ...site.props.filter(p => HEIST_OBJECTS.includes(p.kind)).map(p => ({ what: p.kind, room: site.roomAt(p.tx, p.ty)?.id, x: p.tx, y: p.ty }))
    ];
    const cutOff = things.filter(t => !takeable(t));
    results.push(result('objectsReachable', !cutOff.length, `${things.length} pieces of loot and objects${cutOff.length ? `; out of reach: ${cutOff.map(t => `${t.what} in ${t.room} at ${t.x},${t.y}`).join(', ')}` : ''}`));
    return results;
}

/** The cameras of a world that see no `traffic` tile in either of their facings, as the rules have them look in `state`. */
export function pointlessCameras(world: ReadonlyWorld, state: State, traffic: ReadonlySet<string>): string[] {
    const sight = sightMap(world, state);
    const covers = (o: Observer | null) => !!o && fieldOn(sight, o).tiles.some(t => traffic.has(`${t.x},${t.y}`));
    return world.cameras.filter(c => !covers(cameraObserver(world, state, c.id)) && !covers(cameraObserver(world, state, c.id, true))).map(c => c.id);
}

const FACING_OF: Record<GuardPlan['facing'], Facing> = { front: 's', back: 'n' };

/**
 * Where a guard looks from: its post, facing as posted, then every tile of its route out and back, facing the way it
 * walks (the legs run straight between the route's corners).
 */
function guardPoses(g: GuardPlan): { pos: Pos; facing: Facing }[] {
    const post = { x: g.tx, y: g.ty }, out: { pos: Pos; facing: Facing }[] = [{ pos: post, facing: FACING_OF[g.facing] }];
    let at = post;
    for (const corner of [...g.route, ...g.route.slice(0, -1).reverse(), post]) {
        while (at.x !== corner.x || at.y !== corner.y) {
            const dx = Math.sign(corner.x - at.x), dy = dx ? 0 : Math.sign(corner.y - at.y);
            at = { x: at.x + dx, y: at.y + dy };
            out.push({ pos: at, facing: dx > 0 ? 'e' : dx < 0 ? 'w' : dy > 0 ? 's' : 'n' });
        }
    }
    return out;
}

/** The crew member who walks the Clean route: nothing on them, so Clean (§7.4). */
const WALKER = 'walker';

/** How many floors the Clean route's search tries before it gives up. */
const ROUTE_TRIES = 20;

/** The eight steps round a tile. */
const AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

/** What walking the Clean route may not cause (as auto-advance stops on them, src/sim/rules/autoAdvance.ts). */
const SPOTTED: ReadonlySet<string> = new Set(['exposed', 'challenged', 'cameraSaw', 'carrierStarted']);

/** A Clean route: the goal room's type, and the Moves that walk there from the lobby (the first tile, then each Move's path). */
export interface CleanRoute { to: string; from: Pos; moves: Pos[][] }

/**
 * The Clean route (§17.7, decision 342): from the lobby to the CCTV room or the alarm closet, Moves the safe floor
 * (§8.8) shows green for a Clean crew member from turn 1 on, played through the rules. The route is the bank's, not a
 * crew's: the walker knows the whole bank (every tile seen, every NPC, the cameras and their feeds), so the floor judges
 * the truth, and holds the key graph's keys (§15.2) to every lock on the way but the vault's and the mantrap's.
 *
 * The quiet tiles of turn 1 (nobody reacts to the walker standing there then, `assessEnd`) are only a guide: the search
 * walks out from the goal over them (the rules' `stepCost`), and without such a way from the lobby it gives up (stricter
 * than it need be: a tile watched on turn 1 may be clear a turn later, so such a bank is rolled again).
 * The shortest such way is then walked through the rules (`commit`), turn by turn: each Move the longest start of what
 * is left that the path under the finger (`pathSafety`) shows green on the bank as it stands then, two a turn, and the
 * end of each turn played. Where that fails, floors (`safeFloor`) on the turn-1 state find other candidates, best first
 * along the quiet tiles (`ROUTE_TRIES` at most), each played through the rules the same way. A route counts only if
 * nobody Exposes or challenges the walker, no camera sees them, no alarm starts and no Move is refused or cut short,
 * up to the world phase after its last Move.
 */
export function cleanRoute(world: ReadonlyWorld, rooms: readonly GenRoom[], doors: readonly Door[]): CleanRoute | null {
    const width = world.width;
    const npcAt = new Set(world.people.map(p => p.pos.y * width + p.pos.x));
    const tilesOf = (types: readonly string[]): Pos[] => {
        const ids = new Set(rooms.filter(r => types.includes(r.type)).map(r => r.id)), out: Pos[] = [];
        world.tiles.forEach((t, i) => { if (t.room && ids.has(t.room) && !t.blocksMove) out.push({ x: i % width, y: Math.floor(i / width) }); });
        return out;
    };
    const goal = new Map(rooms.filter(r => r.type === 'cctvRoom' || r.type === 'alarmCloset').map(r => [r.id, r.type]));
    const lobby = tilesOf(['lobby']).filter(p => !tileAt(world, p)!.raised && !npcAt.has(p.y * width + p.x));
    if (!goal.size || !lobby.length) return null;
    const base = initialState(world, { seed: 0, crew: [{ id: WALKER, pos: lobby[0]! }] });
    const mantraps = new Set(rooms.filter(r => r.type === 'mantrap').map(r => r.id));
    const kept = new Set(doors.filter(d => d.lock === 'vault' || mantraps.has(d.a) || mantraps.has(d.b)).map(d => d.id));
    for (const id of Object.keys(base.doors)) if (base.doors[id]!.status === 'locked' && !kept.has(id)) base.doors[id]!.status = 'closed';
    knowAll(world, base);
    // The quiet tiles on turn 1 (nobody reacts to the walker there), and the steps from each to the goal over them.
    const sight = sightMap(world, base), options = planMoveOptions(world, base, crewMember(base, WALKER));
    // Only a tile someone or something looks at can draw a reaction: the rest need no asking.
    const watched = new Uint8Array(world.width * world.height);
    const looks = [...base.npcs.map(n => npcObserver(world, n)), ...world.cameras.map(c => cameraObserver(world, base, c.id))];
    for (const o of looks) if (o) for (const t of fieldOn(sight, o).tiles) watched[t.y * width + t.x] = 1;
    const known = new Int8Array(world.width * world.height).fill(-1);
    const quiet = (p: Pos) => {
        const i = p.y * width + p.x;
        if (known[i] === -1) known[i] = tileAt(world, p)?.room && (!watched[i] || !assessEnd(world, base, sight, WALKER, p).length) ? 1 : 0;
        return known[i] === 1;
    };
    const toGoal = new Int32Array(world.width * world.height).fill(-1), queue: Pos[] = [];
    for (const p of tilesOf(['cctvRoom', 'alarmCloset'])) if (quiet(p)) { toGoal[p.y * width + p.x] = 0; queue.push(p); }
    for (let head = 0; head < queue.length; head++) {
        const q = queue[head]!;
        for (const [dx, dy] of AROUND) {
            const p = { x: q.x + dx, y: q.y + dy }, i = p.y * width + p.x;
            if (!tileAt(world, p) || toGoal[i] !== -1 || !quiet(p) || stepCost(world, base, p, q, options) === undefined) continue;
            toGoal[i] = toGoal[q.y * width + q.x]! + 1;
            queue.push(p);
        }
    }
    const cost = (p: Pos) => toGoal[p.y * width + p.x]!;
    const first = lobby.filter(p => cost(p) >= 0).sort((a, b) => cost(a) - cost(b))[0];
    if (!first) return null;
    const goalAt = (p: Pos) => goal.get(tileAt(world, p)!.room ?? '');
    const walked = (moves: Pos[][]): CleanRoute | null => (walks(world, placeCrew(base, WALKER, first), moves) ? { to: goalAt(moves.at(-1)!.at(-1)!)!, from: first, moves } : null);
    // First the shortest quiet way, walked through the rules turn by turn, each Move the longest the path under the
    // finger shows green as the bank stands then.
    const way: Pos[] = [];
    for (let at = first; cost(at) > 0;) {
        const next = AROUND.map(([dx, dy]) => ({ x: at.x + dx, y: at.y + dy }))
            .find(p => tileAt(world, p) && cost(p) === cost(at) - 1 && stepCost(world, base, at, p, options) !== undefined)!;
        way.push(next);
        at = next;
    }
    const straight = walkWay(world, placeCrew(base, WALKER, first), way);
    if (straight) return { to: goalAt(straight.at(-1)!.at(-1)!)!, from: first, moves: straight };
    // Otherwise floor by floor, best first along the quiet tiles: each tile a green Move reaches, by index, with the
    // Move that reached it and where that Move set off.
    const open = [first], via = new Map<number, { from: number; path: Pos[] } | null>([[first.y * width + first.x, null]]);
    const movesTo = (i: number): Pos[][] => {
        const out: Pos[][] = [];
        for (let step = via.get(i); step; step = via.get(step.from)) out.unshift(step.path);
        return out;
    };
    for (let tries = 0; tries < ROUTE_TRIES && open.length; tries++) {
        open.sort((a, b) => cost(a) - cost(b));
        const from = open.shift()!, fromIndex = from.y * width + from.x;
        for (const t of safeFloor(world, placeCrew(base, WALKER, from), WALKER, { dash: false, bands: ['move'] }).tiles) {
            const i = t.pos.y * width + t.pos.x;
            if (t.tint.kind !== 'safe' || via.has(i) || cost(t.pos) < 0) continue;
            via.set(i, { from: fromIndex, path: t.path.map(p => ({ x: p.x, y: p.y })) });
            if (!goalAt(t.pos)) open.push(t.pos);
            else {
                // The next candidate if this one can't be walked.
                const route = walked(movesTo(i));
                if (route) return route;
            }
        }
    }
    return null;
}

/** The walker knows everything, the state as it is now (as the preview property test's omniscient runs). */
function knowAll(world: ReadonlyWorld, state: State): State {
    const k = state.knowledge;
    k.seen = k.fresh = encodeBits(new Uint8Array(world.width * world.height).fill(1));
    k.cameras = world.cameras.map(c => c.id).sort();
    k.cctv = true;
    k.npcs = {};
    for (const n of state.npcs) k.npcs[n.id] = { at: { ...n.pos }, facing: n.facing, turn: state.turn, live: true, routine: true, rota: false, watched: 3, watchedTurn: state.turn, tick: k.tick + 1 };
    return state;
}

/**
 * Walks `way` from where the walker stands in `state` through the rules, Move by Move, each the longest start of what is
 * left that the path under the finger (`pathSafety`) shows green on the bank as it stands then, ending the turn after
 * two; the Moves, or null when one would not be green or the walk is spotted or stopped (`walks`).
 */
function walkWay(world: ReadonlyWorld, state: State, way: readonly Pos[]): Pos[][] | null {
    const longest = Math.floor(crewBudget(world, crewMember(state, WALKER), 'move') / 2), moves: Pos[][] = [];
    let left = [...way];
    while (left.length) {
        if (crewMember(state, WALKER).actionsLeft < MOVE_ACTIONS) {
            const ended = played(world, state, { type: 'endTurn' });
            if (!ended) return null;
            state = ended;
        }
        const now = knowAll(world, clonePlain(state));
        let n = Math.min(longest, left.length);
        for (; n > 0; n--) {
            const judged = pathSafety(world, now, WALKER, left.slice(0, n), { mode: 'move', stops: false, dash: false });
            // Green, and not cut short by someone standing at its end.
            const end = left[n - 1]!;
            if (judged.ok && judged.firstUnsafe === null && judged.end.tint.kind === 'safe' && judged.end.pos.x === end.x && judged.end.pos.y === end.y) break;
        }
        if (!n) return null;
        const path = left.slice(0, n), next = played(world, state, { type: 'move', crew: WALKER, path });
        const there = next && crewMember(next, WALKER).pos;
        if (!next || there!.x !== path.at(-1)!.x || there!.y !== path.at(-1)!.y) return null;
        state = next;
        moves.push(path);
        left = left.slice(n);
    }
    return played(world, state, { type: 'endTurn' }) ? moves : null;
}

/** The state after `cmd`, or null when the rules refuse it or it spots the walker (`SPOTTED`). */
function played(world: ReadonlyWorld, state: State, cmd: Command): State | null {
    try {
        const result = commit(world, state, cmd);
        return result.events.some(e => SPOTTED.has(e.type)) ? null : result.state;
    } catch (e) {
        if (e instanceof IllegalCommand) return null;
        throw e;
    }
}

/** Whether the walker, from where it stands in `state`, walks `moves` through the rules without being spotted or stopped. */
function walks(world: ReadonlyWorld, state: State | null, moves: readonly Pos[][]): boolean {
    for (const path of moves) {
        if (state && crewMember(state, WALKER).actionsLeft < MOVE_ACTIONS) state = played(world, state, { type: 'endTurn' });
        state = state && played(world, state, { type: 'move', crew: WALKER, path });
        const at = state && crewMember(state, WALKER).pos, end = path.at(-1)!;
        if (!at || at.x !== end.x || at.y !== end.y) return false;
    }
    return !!state && !!played(world, state, { type: 'endTurn' });
}

/** Where the crew starts (`crewOrigin` in `src/game/heist.ts`): by the van at the curb, the first getaway, or the lobby. */
function crewStart(ctx: Ctx): P {
    const { site, nav } = ctx, spot = ctx.getaways.find(g => g.id === 'curb') ?? ctx.getaways[0];
    const lobby = ctx.bank.find(r => r.type === 'lobby') ?? ctx.bank[0]!;
    const origin = spot ? { x: spot.tx, y: spot.ty } : { x: lobby.x + Math.floor(lobby.w / 2), y: lobby.y + lobby.h };
    // The nearest walkable ground-floor tile, by rings round it (as `crewStarts`).
    for (let r = 0; r < Math.max(site.width, site.height); r++) {
        for (let y = origin.y - r; y <= origin.y + r; y++) for (let x = origin.x - r; x <= origin.x + r; x++) {
            if (Math.max(Math.abs(x - origin.x), Math.abs(y - origin.y)) === r && nav.walkable(x, y) && site.heightAt(x, y) === 0) return { x, y };
        }
    }
    return origin;
}

/** The most door-disjoint ways from the `from` rooms to the `to` rooms: each door carries one way (§17.7 loops). */
export function maxFlow(rooms: GenRoom[], doors: Door[], from: (r: GenRoom) => boolean, to: (r: GenRoom) => boolean): number {
    const ids = new Set(rooms.map(r => r.id));
    const edges = doors.filter(d => ids.has(d.a) && ids.has(d.b));
    const source = new Set(rooms.filter(from).map(r => r.id)), sink = new Set(rooms.filter(to).map(r => r.id));
    // Each door is an undirected edge of capacity 1; augment along breadth-first paths until none are left.
    const cap = new Map<string, number>();
    const key = (a: string, b: string) => `${a}|${b}`;
    for (const e of edges) { cap.set(key(e.a, e.b), (cap.get(key(e.a, e.b)) ?? 0) + 1); cap.set(key(e.b, e.a), (cap.get(key(e.b, e.a)) ?? 0) + 1); }
    const neighbours = new Map<string, string[]>();
    for (const e of edges) { (neighbours.get(e.a) ?? neighbours.set(e.a, []).get(e.a)!).push(e.b); (neighbours.get(e.b) ?? neighbours.set(e.b, []).get(e.b)!).push(e.a); }
    let flow = 0;
    for (;;) {
        const prev = new Map<string, string>(), queue = [...source];
        for (const s of source) prev.set(s, '');
        let end: string | undefined;
        while (queue.length && !end) {
            const a = queue.shift()!;
            for (const b of neighbours.get(a) ?? []) {
                if (prev.has(b) || (cap.get(key(a, b)) ?? 0) <= 0) continue;
                prev.set(b, a);
                if (sink.has(b)) { end = b; break; }
                queue.push(b);
            }
        }
        if (!end) return flow;
        for (let b = end; prev.get(b); b = prev.get(b)!) {
            const a = prev.get(b)!;
            cap.set(key(a, b), cap.get(key(a, b))! - 1);
            cap.set(key(b, a), (cap.get(key(b, a)) ?? 0) + 1);
        }
        flow++;
    }
}
