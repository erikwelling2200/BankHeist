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
    const roomOf = (type: string) => bank.find(r => r.type === type);
    for (const p of people) {
        const routine: RoutineBlock[] = [firstBlock(ctx, p)];
        p.routine = routine;
        const again = (from: number, label: string) => routine.push({ ...routine[0]!, from, label });
        const stand = (from: number, activity: Activity, label: string, at: TilePos | undefined, facing?: Compass) => {
            if (at) routine.push({ from, activity, label, room: ctx.nav.site.roomAt(at.tx, at.ty)?.id ?? '', at, ...(facing ? { facing } : {}) });
            return !!at;
        };
        p.schedule.forEach((b, i) => {
            const activity = EVENTS[b.activity];
            if (!activity || activity === 'closingSweep') return;
            const back = p.schedule[i + 1], turns = back ? back.from - b.from : 1;
            let from = b.from, ok = false;
            if (activity === 'offMap') {
                if (spots.frontExit) routine.push({ from, activity, label: b.activity, room: '', at: spots.frontExit });
                ok = !!spots.frontExit;
            } else if (activity === 'lunch') ok = stand(from, activity, b.activity, spots.spotIn(roomOf('breakRoom')));
            else if (activity === 'shiftChange') {
                from = freeFrom(p, b.from, 1);
                ok = from < b.from + turns && stand(from, activity, b.activity, spots.spotIn(roomOf('breakRoom')));
                if (ok && back) again(back.from, back.activity);
                if (ok) busy.set(p, [...(busy.get(p) ?? []), [from, b.from + turns]]);
                return;
            } else if (activity === 'cashRun' || activity === 'inspection') {
                from = freeFrom(p, b.from, turns);
                const door = spots.vaultDoor;
                ok = !!door && stand(from, activity, b.activity, spots.spotIn(door.room, door.at), door.facing);
                if (ok && from !== b.from) {
                    const e = entry(activity === 'cashRun' ? 'Cash run' : 'Vault inspection', b.from);
                    if (e) e.turn = from;
                    const o = ctx.opportunities.find(o => o.id === 'cash-cart' && o.turn === b.from);
                    if (o && activity === 'cashRun') {
                        o.turn = from;
                        o.text = o.text.replace(`turn ${b.from}`, `turn ${from}`);
                    }
                }
            } else if (activity === 'smokeBreak') ok = stand(from, activity, b.activity, spots.smoke);
            if (!ok) return;
            if (back) again(from + turns, back.activity);
            busy.set(p, [...(busy.get(p) ?? []), [from, from + turns]]);
        });
    }
    // The IT technician's visit (§16.2): the bank's own technician, if one is in today.
    const visit = timeline.find(e => e.name === 'IT technician'), tech = people.find(p => p.role === 'technician');
    const room = roomOf('serverRoom') ?? roomOf('alarmCloset');
    if (visit && tech && room) {
        const at = spots.spotIn(room);
        if (at) {
            tech.routine!.push({ from: visit.turn, activity: 'serviceVisit', label: `service visit to the ${room.name.toLowerCase()}`, room: room.id, at });
            tech.routine!.push({ ...tech.routine![0]!, from: visit.turn + (visit.duration ?? 3), label: 'back at the desk' });
        }
    }
    const close = timeline.find(e => e.name === 'Closing time')?.turn ?? Infinity;
    sweepAtClosing(ctx, people.filter(p => p.schedule.some(b => b.activity === 'closing sweep')), close, spots);
    customerVisits(ctx, spots, close);
    // In order of their turn; a later block on the same turn wins (`sort` keeps their order).
    timeline.sort((a, b) => a.turn - b.turn);
    for (const p of people) p.routine!.sort((a, b) => a.from - b.from);
}

const FACING_OF: Record<PersonFacing, Compass> = { front: 's', back: 'n' };
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
    ctx.people.filter(p => p.role === 'customer').forEach((p, i) => {
                const routine = p.routine!, first = routine[0]!;
                const exit = spots.frontExit;
                let leave = r.int(4, 15), visit = 1;
                for (;;) {
                    const counter = Math.max(visit + 1, leave - r.int(2, 4));
                    const window = spots.windows.length ? spots.windows[(i + visit) % spots.windows.length] : undefined;
                    if (window && counter < leave) routine.push({ from: counter, activity: 'counter', label: 'at the teller window', room: ctx.nav.site.roomAt(window.tx, window.ty)?.id ?? '', at: window, facing: 'n' });
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
 * guard's post, check each, and end back at their posts. The vault (and whatever only it leads to) waits for M2-05.
 */
function sweepAtClosing(ctx: Ctx, guards: GenPerson[], close: number, spots: Places): void {
    if (!guards.length) return;
    const { nav, bank } = ctx;
    const throughOk = (d: Door) => d.lock !== 'vault';
    const start = { x: guards[0]!.tx, y: guards[0]!.ty };
    const stops: P[] = [];
    for (const room of bank) {
        if (room.zone === 'outdoors' || room.type === 'vault') continue;
        const spot = spots.spotIn(room);
        if (spot && nav.path(start, { x: spot.tx, y: spot.ty }, throughOk)) stops.push({ x: spot.tx, y: spot.ty });
    }
    // A walk through them all, each time to the nearest one left.
    const tour: P[] = [];
    for (let here = start; stops.length;) {
        stops.sort((a, b) => d2(a, here) - d2(b, here) || a.y - b.y || a.x - b.x);
        here = stops.shift()!;
        tour.push(here);
    }
    const share = Math.ceil(tour.length / guards.length);
    guards.forEach((g, i) => {
        const mine = tour.slice(i * share, (i + 1) * share);
        const post = { tx: g.tx, ty: g.ty };
        g.routine!.push({ from: close, activity: 'closingSweep', label: 'closing sweep', room: '', route: [...mine.map(at), post], facing: FACING_OF[g.facing] });
    });
}
