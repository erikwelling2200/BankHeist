import type { PersonFacing } from '../level/plan';
import type { Furnisher } from './furnish';
import type { Activity, Compass, Door, GenPerson, GenRoom, Opportunity, RoutineBlock, TilePos, TimelineEvent } from './model';
import type { Nav, P } from './nav';
import type { Furnished } from './parcels';
import type { Rng } from './rng';

/*
 * The people's day as the rules run it (§16.1, §16.3; src/sim/rules/npc): each person's schedule (population.ts, text
 * blocks with a room) turned into typed blocks with the tile to stand on or the route to walk (`GenPerson.routine`).
 * It adds what the text leaves to the rules: the customers' comings and goings (queue, the teller window, leave, now and
 * then back as the next customer; everyone out at closing), the IT technician's visit, and the closing sweep's route
 * through every room. Everything it rolls comes from its own stream, so the population, the timeline and the look of
 * the bank don't change with it.
 *
 * Each person does one event at a time: an event of one person that would clash with an earlier one of theirs (the
 * manager's inspection during lunch out, the cash run during the shift change) waits until they are free, and its
 * timeline entry and opportunity with it; a group event (the shift change) is joined late or missed.
 */

export interface RoutineCtx {
    nav: Nav;
    furnish: Furnisher;
    /** The bank's own rooms. */
    bank: GenRoom[];
    furnished: Furnished;
    people: GenPerson[];
    timeline: TimelineEvent[];
    opportunities: Opportunity[];
    /** The routines' own stream. */
    rng: Rng;
}
type Ctx = RoutineCtx;

/** The schedule's text events and the typed activity each becomes; the "back to …" blocks end them. */
const EVENTS: Readonly<Record<string, Activity>> = {
    'lunch (out of the building)': 'offMap',
    lunch: 'lunch',
    'shift change': 'shiftChange',
    'cash run to the vault': 'cashRun',
    'vault inspection': 'inspection',
    'smoke break at the alley door': 'smokeBreak',
    'closing sweep': 'closingSweep'
};

/** Gives every person their `routine`. */
export function planRoutines(ctx: Ctx): void {
    const { bank, people, timeline } = ctx;
    const spots = placesOfTheDay(ctx);
    const busy = new Map<GenPerson, [number, number][]>();
    const freeFrom = (p: GenPerson, from: number, turns: number): number => {
        let t = from;
        for (const [a, b] of [...(busy.get(p) ?? [])].sort((x, y) => x[0] - y[0])) if (t < b && a < t + turns) t = b;
        return t;
    };
    const entry = (name: string, turn: number) => timeline.find(e => e.name === name && e.turn === turn);
    const close = timeline.find(e => e.name === 'Closing time')?.turn ?? Infinity;
    /** The turn nearest `want` someone `way` turns away is free to spend `turns` turns there, before closing. */
    const slot = (p: GenPerson, want: number, way: number, turns: number): number | undefined => {
        for (let d = 0; d < close; d++) {
            for (const t of d ? [want - d, want + d] : [want]) {
                if (t - way < 1 || t + turns > close) continue;
                if (!(busy.get(p) ?? []).some(([a, b]) => a < t + turns && t - way < b)) return t;
            }
        }
        return undefined;
    };
    const roomOf = (type: string) => bank.find(r => r.type === type);
    const backs = new Set<RoutineBlock>();
    const occupy = (p: GenPerson, from: number, to: number) => busy.set(p, [...(busy.get(p) ?? []), [from, to]]);
    for (const p of people) {
        const routine: RoutineBlock[] = [firstBlock(ctx, p)];
        p.routine = routine;
        const home = routine[0]!.at ?? routine[0]!.route?.[0] ?? { tx: p.tx, ty: p.ty };
        const again = (from: number, label: string) => {
            const b = { ...routine[0]!, from, label };
            routine.push(b);
            backs.add(b);
        };
        /** Adds an event block at `at`, setting off in time to be there on `from` (when it can't, it isn't added). */
        let last: TilePos | undefined;
        const event = (from: number, activity: Activity, label: string, at: TilePos | undefined, way: number, facing?: Compass): boolean => {
            if (!at) return false;
            const setOff = from - way;
            last = at;
            routine.push({ from, ...(setOff < from ? { setOff: Math.max(1, setOff) } : {}), activity, label, room: activity === 'offMap' ? '' : ctx.nav.site.roomAt(at.tx, at.ty)?.id ?? '', at, ...(facing ? { facing } : {}) });
            return true;
        };
        const spotOf = (activity: Activity): { at: TilePos | undefined; facing?: Compass } => {
            if (activity === 'offMap') return { at: spots.frontExit };
            if (activity === 'lunch' || activity === 'shiftChange') return { at: spots.spotIn(roomOf('breakRoom')) };
            if (activity === 'smokeBreak') return { at: spots.smoke };
            const door = spots.vaultDoor;
            return door ? { at: spots.spotIn(door.room, door.at), facing: door.facing } : { at: undefined };
        };
        p.schedule.forEach((b, i) => {
            const activity = EVENTS[b.activity];
            if (!activity || activity === 'closingSweep') return;
            const back = p.schedule[i + 1], turns = back ? back.from - b.from : 1;
            const { at, facing } = spotOf(activity);
            // From their post, or from the last event when they may come straight from it; nowhere they can't walk to.
            const ways = at ? [travelTurns(ctx, home, at), last ? travelTurns(ctx, last, at) : 0] : [undefined];
            const way = ways.every(w => w !== undefined) ? Math.max(...(ways as number[])) : undefined;
            if (activity === 'shiftChange' || activity === 'lunch') {
                if (!at || way === undefined) return;
                // A group event: joined late, or missed when they are busy throughout.
                const from = Math.max(freeFrom(p, b.from - way, 1), 1) + way;
                if (from >= b.from + turns || !event(from, activity, b.activity, at, way)) return;
                if (back) again(back.from, back.activity);
                occupy(p, from - way, b.from + turns);
                return;
            }
            // Their own event: at the free turn nearest the one rolled that they can get there by from the start of the
            // day, done before closing; its timeline entry (and its tip) moves with it. An event no turn fits, or with
            // nowhere to happen, is called off and goes from the timeline (a lunch out stays: the rotation still happens).
            const from = at && way !== undefined ? slot(p, b.from, way, turns) : undefined;
            const named: Partial<Record<Activity, [string, string]>> = {
                cashRun: ['Cash run', 'cash-cart'], inspection: ['Vault inspection', ''], offMap: ['Lunch rotation', 'keycard-drawer'],
                smokeBreak: ['Smoke break', 'smoke-break']
            };
            const moved = named[activity];
            if (from === undefined || !at || way === undefined) {
                const e = moved && entry(moved[0], b.from);
                if (e && activity !== 'offMap') timeline.splice(timeline.indexOf(e), 1);
                const o = moved && ctx.opportunities.findIndex(o => o.id === moved[1] && o.turn === b.from);
                if (o !== undefined && o >= 0) ctx.opportunities.splice(o, 1);
                return;
            }
            if (!event(from, activity, b.activity, at, way, facing)) return;
            if (from !== b.from && moved) {
                const e = entry(moved[0], b.from);
                if (e) e.turn = from;
                const o = ctx.opportunities.find(o => o.id === moved[1] && o.turn === b.from);
                if (o) {
                    o.turn = from;
                    o.text = o.text.replace(`turn ${b.from}`, `turn ${from}`);
                }
            }
            if (back) again(from + turns, back.activity);
            occupy(p, from - way, from + turns);
        });
    }
    // The IT technician's visit (§16.2): the bank's own technician, if one is in today; without one there is no visit.
    const visit = timeline.find(e => e.name === 'IT technician'), tech = people.find(p => p.role === 'technician');
    const room = roomOf('serverRoom') ?? roomOf('alarmCloset');
    const spot = visit && tech && room ? spots.spotIn(room) : undefined;
    if (visit && tech && room && spot) {
        const home = tech.routine![0]!.at ?? spot, setOff = visit.turn - (travelTurns(ctx, home, spot) ?? 0);
        tech.routine!.push({ from: visit.turn, ...(setOff < visit.turn ? { setOff: Math.max(1, setOff) } : {}), activity: 'serviceVisit', label: `service visit to the ${room.name.toLowerCase()}`, room: room.id, at: spot });
        const b = { ...tech.routine![0]!, from: visit.turn + (visit.duration ?? 3), label: 'back at the desk' };
        tech.routine!.push(b);
        backs.add(b);
    } else if (visit) {
        timeline.splice(timeline.indexOf(visit), 1);
        const tip = ctx.opportunities.findIndex(o => o.id === 'it-tech');
        if (tip >= 0) ctx.opportunities.splice(tip, 1);
        // Still three to find (§17.6): the manager's PC, which every bank has.
        if (ctx.opportunities.length < 3 && !ctx.opportunities.some(o => o.id === 'manager-pc')) {
            ctx.opportunities.push({ id: 'manager-pc', text: "The manager's PC holds the vault code and the time-lock schedule.", found: 'documents' });
        }
    }
    sweepAtClosing(ctx, people.filter(p => p.schedule.some(b => b.activity === 'closing sweep')), close);
    customerVisits(ctx, spots, close);
    // In order of their turn. A way back to their post on the turn another block starts is no block at all.
    timeline.sort((a, b) => a.turn - b.turn);
    for (const p of people) {
        p.routine = p.routine!.filter(b => !backs.has(b) || !p.routine!.some(o => o !== b && !backs.has(o) && o.from === b.from));
        p.routine.sort((a, b) => a.from - b.from);
    }
}

const FACING_OF: Record<PersonFacing, Compass> = { front: 's', back: 'n' };

/** NPCs' routine walk per world phase, in tiles (implementation plan §6 decision 4). */
const WALK_TILES = 4;

/**
 * Turns it takes to walk from one tile to another at the routine pace, with some to spare (doors, people in the way),
 * so whoever sets off that early is there on time; 0 when already there, undefined when there is no way there.
 */
function travelTurns(ctx: Ctx, from: TilePos, to: TilePos): number | undefined {
    if (from.tx === to.tx && from.ty === to.ty) return 0;
    // Not through the vault, which the rules keep NPCs out of (M2-05).
    const path = ctx.nav.path({ x: from.tx, y: from.ty }, { x: to.tx, y: to.ty }, d => d.lock !== 'vault');
    // Two turns to spare, and another every 12 tiles: a long way crosses more doors and people, and the rules' way
    // can be longer than this one.
    return path ? Math.ceil((path.length - 1) / WALK_TILES) + 2 + Math.floor((path.length - 1) / 12) : undefined;
}
const at = (p: P): TilePos => ({ tx: p.x, ty: p.y });
const d2 = (a: P, b: P) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
/** The two tiles either side of a door: north or west first. */
const doorSides = (d: Door): [P, P] => (d.run === 'eastWest' ? [{ x: d.tx, y: d.ty - 1 }, { x: d.tx, y: d.ty }] : [{ x: d.tx - 1, y: d.ty }, { x: d.tx, y: d.ty }]);
/** The compass facing from a tile to its neighbour. */
const toward = (from: P, to: P): Compass => (to.y < from.y ? 'n' : to.y > from.y ? 's' : to.x > from.x ? 'e' : 'w');

/** Where the day's events take people, worked out once per bank. */
interface Places {
    /** A free tile in a room, near `near` (its middle by default), not handed out before if the room has another. */
    spotIn(room: GenRoom | undefined, near?: TilePos): TilePos | undefined;
    /** The street tile outside the bank's front door, where people leave the map and come back in. */
    frontExit?: TilePos;
    /** In front of the vault door (the rules keep NPCs out of the vault until M2-05's time lock): the room, the tile, the facing. */
    vaultDoor?: { room: GenRoom; at: TilePos; facing: Compass };
    /** Outside the alley (or back) door, for the operator's smoke. */
    smoke?: TilePos;
    /** The customers' side of each open teller window. */
    windows: TilePos[];
}

function placesOfTheDay(ctx: Ctx): Places {
    const { nav, furnish, bank, furnished } = ctx, site = nav.site;
    const free = (x: number, y: number) => nav.walkable(x, y) && furnish.canStand(x, y);
    const handed = new Set<string>();
    const spotIn = (room: GenRoom | undefined, near?: TilePos): TilePos | undefined => {
        if (!room) return undefined;
        const c = near ? { x: near.tx, y: near.ty } : { x: room.x + (room.w - 1) / 2, y: room.y + (room.h - 1) / 2 };
        const tiles = nav.tilesOf(room).filter(p => free(p.x, p.y)).sort((a, b) => d2(a, c) - d2(b, c) || a.y - b.y || a.x - b.x);
        const pick = tiles.find(p => !handed.has(`${p.x},${p.y}`)) ?? tiles[0];
        if (pick) handed.add(`${pick.x},${pick.y}`);
        return pick && at(pick);
    };
    const inBank = new Set(bank.map(r => r.id));
    const outdoors = (id: string) => site.room(id).zone === 'outdoors';
    /** The tile on `side`'s room's side of a door, or the nearest free one in that room. */
    const sideOf = (d: Door, room: string): TilePos | undefined => {
        const tile = doorSides(d).find(p => site.roomAt(p.x, p.y)?.id === room);
        if (!tile) return undefined;
        return free(tile.x, tile.y) ? at(tile) : spotIn(site.room(room), at(tile));
    };
    const lobbies = new Set(bank.filter(r => r.type === 'lobby').map(r => r.id));
    const front = site.doors.find(d => !d.open && ((lobbies.has(d.a) && outdoors(d.b)) || (lobbies.has(d.b) && outdoors(d.a))));
    const frontExit = front && sideOf(front, lobbies.has(front.a) ? front.b : front.a);
    const vault = bank.find(r => r.type === 'vault');
    const vaultDoors = vault ? site.doors.filter(d => d.a === vault.id || d.b === vault.id).sort((a, b) => Number(b.lock === 'vault') - Number(a.lock === 'vault')) : [];
    let vaultDoor: Places['vaultDoor'];
    for (const d of vaultDoors) {
        const other = d.a === vault!.id ? d.b : d.a, sides = doorSides(d);
        const outside = sides.find(p => site.roomAt(p.x, p.y)?.id === other), inside = sides.find(p => p !== outside)!;
        const spot = outside && (free(outside.x, outside.y) ? at(outside) : spotIn(site.room(other), at(outside)));
        if (outside && spot) {
            vaultDoor = { room: site.room(other), at: spot, facing: toward(outside, inside) };
            break;
        }
    }
    // The smoke break: outside a door from the bank to the alley or the back, else to any outdoors but the front's.
    const BACK = ['alley', 'backLot', 'parkingLot', 'sideRoad'];
    const backDoors = site.doors.filter(d => !d.open && d !== front && ((inBank.has(d.a) && outdoors(d.b)) || (inBank.has(d.b) && outdoors(d.a))));
    const back = backDoors.find(d => BACK.includes(site.room(inBank.has(d.a) ? d.b : d.a).type)) ?? backDoors[0];
    const smoke = back && sideOf(back, inBank.has(back.a) ? back.b : back.a);
    const windows = furnished.stations.filter(s => s.role === 'teller').map(s => ({ x: s.tx, y: s.ty + 2 }))
        .filter(p => free(p.x, p.y) && lobbies.has(site.roomAt(p.x, p.y)?.id ?? '')).map(at);
    return { spotIn, ...(frontExit ? { frontExit } : {}), ...(vaultDoor ? { vaultDoor } : {}), ...(smoke ? { smoke } : {}), windows };
}

/** What someone does from the start (turn 1): their post, their route, the queue. */
function firstBlock(ctx: Ctx, p: GenPerson): RoutineBlock {
    const room = ctx.nav.site.roomAt(p.tx, p.ty)?.id ?? '';
    const here = { tx: p.tx, ty: p.ty }, facing = FACING_OF[p.facing];
    if (p.route) {
        const route = [here, ...p.route.map(r => ({ tx: r.tx, ty: r.ty }))];
        return p.role === 'cleaner' ? { from: 1, activity: 'sweep', label: 'sweeping the staff corridors', room, route }
            : { from: 1, activity: 'patrol', label: 'patrol', room, route };
    }
    if (p.patrol) return { from: 1, activity: 'patrol', label: 'walking down the street', room, route: [here, { tx: p.patrol.tx, ty: p.patrol.ty }] };
    if (p.role === 'customer') {
        const queueing = ctx.furnished.stations.some(s => s.role === 'queue' && s.tx === p.tx && s.ty === p.ty);
        return { from: 1, activity: queueing ? 'queue' : 'wait', label: 'queue, then the teller window, then leave', room, at: here, facing };
    }
    const window = (p.role === 'teller' || p.role === 'headTeller') && !p.traits.includes('on break');
    if (p.traits.includes('on break')) return { from: 1, activity: 'break', label: 'on break', room, at: here, facing };
    return { from: 1, activity: window ? 'window' : 'post', label: window ? 'at the window' : 'at post', room, at: here, facing };
}

/**
 * The customers' day (§16.2: queue, the teller window, leave, 8–15 turns): each is at the window a few turns before
 * leaving, some come back later as the next customer, and everyone still in leaves at closing. Rolled from the
 * `routines` stream.
 */
function customerVisits(ctx: Ctx, spots: Places, close: number): void {
    const r = ctx.rng;
    // When each window is taken: a customer goes to a free one, and queues on until one is.
    const taken = spots.windows.map(() => [] as [number, number][]);
    const freeWindow = (from: number, to: number, first: number): number => {
        for (let k = 0; k < spots.windows.length; k++) {
            const w = (first + k) % spots.windows.length;
            if (!taken[w]!.some(([a, b]) => a < to && from < b)) return w;
        }
        return -1;
    };
    ctx.people.filter(p => p.role === 'customer').forEach((p, i) => {
        const routine = p.routine!, first = routine[0]!;
        const exit = spots.frontExit;
        let leave = r.int(4, 15), visit = 1;
        for (;;) {
            const queue = first.at ?? { tx: p.tx, ty: p.ty };
            for (let counter = Math.max(visit + 1, leave - r.int(2, 4)); counter < leave - 1; counter++) {
                const w = spots.windows.length ? freeWindow(counter, leave, i + visit) : -1;
                if (w < 0) continue;
                const window = spots.windows[w]!, setOff = counter - (travelTurns(ctx, queue, window) ?? 0);
                taken[w]!.push([setOff, leave]);
                routine.push({ from: counter, ...(setOff < counter ? { setOff: Math.max(visit, setOff) } : {}), activity: 'counter', label: 'at the teller window', room: ctx.nav.site.roomAt(window.tx, window.ty)?.id ?? '', at: window, facing: 'n' });
                break;
            }
            if (!exit || leave >= close) break;
            routine.push({ from: leave, activity: 'leave', label: 'leaving', room: '', at: exit });
            // The next customer through the door, now and then (the same person, for the rules).
            visit = leave + r.int(3, 8);
            if (visit >= close - 6 || !r.chance(0.6)) return;
            routine.push({ ...first, from: visit, label: 'another customer: queue, the teller window, leave' });
            leave = visit + r.int(6, 12);
        }
        if (exit) routine.push({ from: close, activity: 'leave', label: 'closing: customers leave', room: '', at: exit });
    });
}

/**
 * The closing sweep (§16.3): the guards split the bank's rooms between them, in the order of a walk from the first
 * guard's post (each time to the nearest room left, by the way there), look into each from just inside, and end back
 * at their posts. The vault (and whatever only it leads to) waits for M2-05.
 */
function sweepAtClosing(ctx: Ctx, guards: GenPerson[], close: number): void {
    if (!guards.length) return;
    const { nav, bank, furnish } = ctx;
    const throughOk = (d: Door) => d.lock !== 'vault';
    const start = { x: guards[0]!.tx, y: guards[0]!.ty };
    // Each room is checked from just inside it: its free tile nearest the way in.
    const rooms = bank.filter(r => r.zone !== 'outdoors' && r.type !== 'vault')
        .map(r => nav.tilesOf(r).filter(p => furnish.canStand(p.x, p.y)))
        .filter(tiles => tiles.length);
    const tour: P[] = [], cost: number[] = [];
    for (let here = start; rooms.length;) {
        const { dist } = nav.distances([here], { through: throughOk });
        let best: { room: number; tile: P; d: number } | undefined;
        rooms.forEach((tiles, room) => {
            for (const p of tiles) {
                const d = dist[p.y * nav.site.width + p.x]!;
                if (d >= 0 && (!best || d < best.d)) best = { room, tile: p, d };
            }
        });
        // What can't be reached without the vault waits for M2-05.
        if (!best) break;
        rooms.splice(best.room, 1);
        here = best.tile;
        tour.push(here);
        cost.push((cost.at(-1) ?? 0) + best.d);
    }
    // Shared out by the walking it takes, a stretch of the tour each, to the guard posted nearest its start.
    const total = cost.at(-1) ?? 0, left = [...guards];
    const stretches = guards.map((_, i) => tour.filter((__, k) => Math.min(guards.length - 1, Math.floor((cost[k]! * guards.length) / (total + 1))) === i));
    stretches.forEach(mine => {
        const first = mine[0] ?? start;
        left.sort((a, b) => d2({ x: a.tx, y: a.ty }, first) - d2({ x: b.tx, y: b.ty }, first));
        const g = left.shift()!;
        const post = { tx: g.tx, ty: g.ty };
        g.routine!.push({ from: close, activity: 'closingSweep', label: 'closing sweep', room: '', route: [...mine.map(at), post], facing: FACING_OF[g.facing] });
    });
}
