import type { FloorTile } from '../level/plan';
import type { WallKind } from '../level/walls';
import { partsOf, type Layout } from './layout';
import type { GenRoom, Lock, Rect, RoomType } from './model';
import type { Plot } from './plot';
import type { Rng } from './rng';
import { isOpenPair, ROOM_RULES } from './rooms';
import { edgeBetween, edgeKey, MAX_STEP, tilesOf, type Edge, type Site } from './site';

/*
 * Turns a layout into rooms, walls and doors on the site (§17.2 steps 3 and 5). Walls go wherever two rooms meet, in a
 * material that follows from what they are (§14.1): the vault's steel round the vault, concrete round the secure core,
 * plaster between staff rooms, brick outside; the street front gets its piers, windows and doors. Doors follow each
 * room's rules (`rooms.ts`) and the archetype's extra links.
 */

export interface BankOptions {
    rng: Rng;
    /** The old bank headline: metre-thick stone round the vault. */
    oldBank: boolean;
    /** Fortress: soft outer walls. */
    softOutside: boolean;
    /** Neighbours whose party wall with the bank is soft (breachable), by room id. */
    softNeighbours: Set<string>;
}

/** Raised versions of a zone's floor, for rooms on a mezzanine. */
const RAISED: Partial<Record<string, FloorTile>> = { ',': 'j', q: 'h', '.': 'j' };

/** Places the layout's rooms in the plot's bank lot. Returns them in the layout's order. */
export function placeBank(site: Site, plot: Plot, layout: Layout): GenRoom[] {
    return layout.pieces.map(p => {
        const parts = partsOf(p).map(r => ({ x: plot.lot.x + r.x, y: plot.lot.y + r.y, w: r.w, h: r.h }));
        const floor = ROOM_RULES[p.type].floor as FloorTile;
        const room = site.addRoom(p.type, parts, { wing: p.wing, bank: true, floor: p.raised ? RAISED[floor] ?? 'j' : floor });
        if (p.stairs) site.paint({ x: plot.lot.x + p.stairs.x, y: plot.lot.y + p.stairs.y, w: p.stairs.w, h: p.stairs.h }, 'z');
        return room;
    });
}

/**
 * The wall every edge between two rooms gets by default. Undefined: no wall (inside one room, open ground, or an open
 * pair). The street fronts are drawn afterwards over these.
 */
export function defaultWalls(site: Site, opts: BankOptions): void {
    for (let y = 0; y < site.height; y++) for (let x = 0; x < site.width; x++) {
        for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
            const nx = x + dx, ny = y + dy;
            if (!site.inside(nx, ny)) continue;
            const e = edgeBetween({ x, y }, { x: nx, y: ny });
            const kind = wallBetween(site.roomAt(x, y), site.roomAt(nx, ny), opts);
            if (kind) site.setWall(e, kind);
            else site.clearWall(e);
        }
    }
    // Buildings that reach the map's edge are closed there too.
    for (let x = 0; x < site.width; x++) {
        if (isBuilt(site.roomAt(x, site.height - 1))) site.setWall({ run: 'eastWest', tx: x, ty: site.height }, 'concrete');
    }
    for (let y = 0; y < site.height; y++) {
        if (isBuilt(site.roomAt(0, y))) site.setWall({ run: 'northSouth', tx: 0, ty: y }, 'brick');
        if (isBuilt(site.roomAt(site.width - 1, y))) site.setWall({ run: 'northSouth', tx: site.width, ty: y }, 'brick');
    }
}

const isBuilt = (room: GenRoom | undefined): boolean => room !== undefined && room.zone !== 'outdoors';

function wallBetween(a: GenRoom | undefined, b: GenRoom | undefined, opts: BankOptions): WallKind | undefined {
    if (!a || !b) {
        // Off the map: the backs of the buildings across the alley.
        const other = a ?? b;
        return other && other.zone === 'outdoors' ? 'brick' : undefined;
    }
    if (a === b) return undefined;
    if (a.zone === 'outdoors' && b.zone === 'outdoors') return undefined;
    const vault = a.type === 'vault' || b.type === 'vault';
    if (vault) return opts.oldBank ? 'thick' : 'vault';
    const secure = (a.bank && a.zone === 'secure') || (b.bank && b.zone === 'secure');
    if (a.bank && b.bank) {
        if (isOpenPair(a.type, b.type)) return undefined;
        // The CCTV room on its mezzanine looks over the teller line through glass.
        if ((a.type === 'cctvRoom' && b.type === 'tellerLine') || (b.type === 'cctvRoom' && a.type === 'tellerLine')) return 'window';
        return secure ? 'concrete' : 'plaster';
    }
    const bank = a.bank ? a : b.bank ? b : undefined, other = bank === a ? b : a;
    if (bank) {
        if (other.zone === 'outdoors') return secure ? 'concrete' : opts.softOutside ? 'plaster' : 'brick';
        if (secure && !opts.softNeighbours.has(`${other.id}:${bank.id}`)) return 'concrete';
        return opts.softNeighbours.has(other.id) ? 'plaster' : 'brick';
    }
    // Between neighbours: their own partitions inside one building, brick between buildings.
    if (a.zone === 'outdoors' || b.zone === 'outdoors') return 'brick';
    return a.wing === b.wing ? 'plaster' : 'brick';
}

/**
 * The bank's street front along its lot's bottom edge: stone piers, windows on the lobby with the glass doors in the
 * middle, the cash machine in a pier of the ATM room, plain stone in front of the restrooms and staff rooms.
 */
export function bankFront(site: Site, plot: Plot, rooms: GenRoom[], rng: Rng): { door: number } {
    const y = plot.lot.y + plot.lot.h, x0 = plot.lot.x, x1 = plot.lot.x + plot.lot.w;
    const lobby = rooms.filter(r => r.type === 'lobby' && r.y + r.h === y).map(r => ({ r, row: frontRow(site, r) })).sort((a, b) => b.row.w - a.row.w)[0];
    if (!lobby) throw new Error('The lobby has to reach the street');
    const door = lobby.row.x + Math.floor(lobby.row.w / 2) - 1;
    for (let x = x0; x < x1; x++) {
        const room = site.roomAt(x, y - 1)!, e: Edge = { run: 'eastWest', tx: x, ty: y };
        let kind: WallKind = 'pier';
        if (room === lobby.r) kind = x === door || x === door + 1 ? 'doorGlass' : (x - lobby.row.x) % 4 === 0 || x === lobby.row.x + lobby.row.w - 1 ? 'pier' : 'window';
        else if (room.type === 'lobby') kind = 'window';
        else if (room.type === 'atmRoom') kind = x === frontRow(site, room).x + Math.floor(frontRow(site, room).w / 2) ? 'atm' : 'pier';
        else if (room.zone === 'staff' && room.type !== 'loadingBay') kind = (x - room.x) % 3 === 1 && x !== x0 && x !== x1 - 1 ? 'window' : 'pier';
        else if (room.zone === 'secure') kind = 'concrete';
        if (x === x0 || x === x1 - 1) kind = 'pier';
        site.setWall(e, kind);
    }
    site.addDoor(lobby.r, site.roomAt(door, y)!, { run: 'eastWest', tx: door, ty: y }, 'none', 'doorGlass');
    // The red runner from the doors to the counter.
    for (let ry = lobby.r.y; ry < lobby.r.y + lobby.r.h; ry++) for (const rx of [door, door + 1]) if (site.tiles[ry]![rx] === '.' && site.roomAt(rx, ry) === lobby.r) site.tiles[ry]![rx] = '=';
    void rng;
    return { door };
}

/** The run of a room's tiles along its bottom edge, where it meets the street: x and width. */
export function frontRow(site: Site, room: GenRoom): { x: number; w: number } {
    const y = room.y + room.h - 1, xs = site.tilesOfRoom(room).filter(t => t.y === y).map(t => t.x);
    return { x: Math.min(...xs), w: Math.max(...xs) - Math.min(...xs) + 1 };
}

/**
 * Whether a door can stand on this edge: both sides walkable at heights a person can step between, and neither in the
 * teller line's front row, where the counter runs its whole length (its gate is placed on its own, `counterGate`).
 */
function doorable(site: Site, e: Edge): boolean {
    const [p, q] = tilesOf(e);
    const counterRow = (t: { x: number; y: number }) => {
        const room = site.roomAt(t.x, t.y);
        return room?.type === 'tellerLine' && t.y === room.y + room.h - 1;
    };
    return site.inside(p.x, p.y) && site.inside(q.x, q.y) && Math.abs(site.heightAt(p.x, p.y) - site.heightAt(q.x, q.y)) <= MAX_STEP
        && site.tiles[p.y]![p.x] !== 'z' && site.tiles[q.y]![q.x] !== 'z' && !counterRow(p) && !counterRow(q);
}

/** Picks the edge for a door among `edges`: away from the ends of the wall where possible, near its middle. */
function doorEdge(site: Site, edges: Edge[], rng: Rng, width = 1): Edge[] | undefined {
    const ok = edges.filter(e => doorable(site, e));
    const runs: Edge[][] = [];
    for (const e of ok) {
        const run = runs.at(-1), last = run?.at(-1);
        if (run && last && last.run === e.run && (e.run === 'eastWest' ? last.ty === e.ty && last.tx + 1 === e.tx : last.tx === e.tx && last.ty + 1 === e.ty)) run.push(e);
        else runs.push([e]);
    }
    const choices: Edge[][] = [];
    for (const run of runs) {
        const inner = run.length > width + 1 ? run.slice(1, run.length - 1) : run;
        for (let i = 0; i + width <= inner.length; i++) choices.push(inner.slice(i, i + width));
    }
    if (!choices.length) return undefined;
    // Near the middle of the longest stretch, with a little wobble.
    const mid = (choices.length - 1) / 2, spread = Math.max(1, Math.floor(choices.length / 4));
    return choices[Math.max(0, Math.min(choices.length - 1, Math.round(mid) + rng.int(-spread, spread)))];
}

/** Staff rooms a second door off the lobby may lead into, best first: each leads on into the staff side. */
const STAFF_DOOR: RoomType[] = ['staffCorridor', 'breakRoom', 'atmRoom', 'managerOffice'];

const DOOR_KIND: Record<Lock, WallKind> = { none: 'doorWood', mechanical: 'doorWood', keycard: 'doorKeycard', maglock: 'doorKeycard', vault: 'vaultDoor' };

/** Puts a door between two rooms on the best edge they share; false if they can't have one. */
export function connect(site: Site, a: GenRoom, b: GenRoom, lock: Lock, rng: Rng, open = false): boolean {
    const edges = site.sharedEdges(a, b);
    if (open) {
        if (!edges.length) return false;
        for (const e of edges) site.clearWall(e);
        const e = doorEdge(site, edges, rng) ?? [edges[Math.floor(edges.length / 2)]!];
        site.addDoor(a, b, e[0]!, 'none', undefined);
        return true;
    }
    const width = lock === 'vault' ? 2 : 1;
    const chosen = doorEdge(site, edges, rng, width);
    if (!chosen) return false;
    for (const e of chosen) site.setWall(e, DOOR_KIND[lock]);
    site.addDoor(a, b, chosen[0]!, lock, DOOR_KIND[lock]);
    return true;
}

/**
 * The bank's doors: every room to the first room it may open onto (its type's rules), the archetype's links, the vault
 * door, the counter gate, the back door and the loading bay's shutter. Fails when a room can't be reached.
 */
/** Why the last door pass failed, for debugging. */
export let doorFailure = '';

export function bankDoors(site: Site, plot: Plot, layout: Layout, rooms: GenRoom[], rng: Rng): boolean {
    const bank = new Set(rooms);
    for (const room of rooms) {
        const rule = ROOM_RULES[room.type];
        if (!rule.opensOnto.length) continue;
        const around = site.neighbours(room).filter(r => bank.has(r));
        let done = false;
        for (const type of rule.opensOnto) {
            for (const other of around.filter(r => r.type === type)) {
                if (isOpenPair(room.type, other.type)) { done = true; break; }
                if (connect(site, room, other, rule.lock, rng)) { done = true; break; }
            }
            if (done) break;
        }
        if (!done) { doorFailure = `${room.type} can't open onto ${rule.opensOnto.join('/')} (touches ${around.map(r => r.type).join(', ')})`; return false; }
    }
    for (const link of layout.links) {
        const a = rooms[link.a]!, b = rooms[link.b]!;
        if (isOpenPair(a.type, b.type)) {
            if (!site.doors.some(d => (d.a === a.id && d.b === b.id) || (d.a === b.id && d.b === a.id))) connect(site, a, b, 'none', rng, true);
        } else if (!connect(site, a, b, link.lock, rng)) { doorFailure = `link ${a.type}-${b.type} failed`; return false; }
    }
    // A second way off the public floor into the staff side, if the archetype gave only the counter gate (§17.1
    // loops): a keycard door from the lobby into the staff room beside it that leads on.
    const isPublic = (r: GenRoom) => r.zone === 'public';
    const crossings = () => site.doors.filter(d => {
        const a = site.room(d.a), b = site.room(d.b);
        return bank.has(a) && bank.has(b) && isPublic(a) !== isPublic(b);
    }).length;
    if (crossings() < 1) {
        for (const lobby of rooms.filter(r => r.type === 'lobby')) {
            const next = site.neighbours(lobby).filter(r => bank.has(r) && !isPublic(r) && !isOpenPair('lobby', r.type))
                .sort((a, b) => STAFF_DOOR.indexOf(a.type) - STAFF_DOOR.indexOf(b.type)).find(r => STAFF_DOOR.includes(r.type));
            if (next && connect(site, lobby, next, 'keycard', rng)) break;
        }
    }
    // Open pairs meet without a wall; record one opening between each so the room graph knows they connect.
    for (const room of rooms) for (const other of site.neighbours(room).filter(r => bank.has(r) && isOpenPair(room.type, r.type))) {
        // The counter's only way through is its gate (`counterGate`).
        if ([room.type, other.type].includes('lobby') && [room.type, other.type].includes('tellerLine')) continue;
        if (rooms.indexOf(other) < rooms.indexOf(room)) continue;
        if (!site.doors.some(d => (d.a === room.id && d.b === other.id) || (d.a === other.id && d.b === room.id))) connect(site, room, other, 'none', rng, true);
    }
    // The back door and the loading bay's shutter onto the alley.
    const backY = plot.lot.y, alley = site.roomAt(plot.lot.x, backY - 1)!;
    const service = rooms.filter(r => r.y === backY && (r.type === 'loadingBay' || r.type === 'staffCorridor'));
    const bay = service.find(r => r.type === 'loadingBay');
    if (bay) {
        const edges = site.sharedEdges(bay, alley), shutter = doorEdge(site, edges, rng, 2);
        if (!shutter) return false;
        for (const e of shutter) site.setWall(e, 'shutter');
        site.addDoor(bay, alley, shutter[0]!, 'mechanical', 'shutter');
    }
    const backRoom = service.find(r => r.type === 'staffCorridor') ?? bay;
    if (!backRoom) return false;
    const backEdges = site.sharedEdges(backRoom, alley).filter(e => site.wallAt(e)?.kind !== 'shutter');
    const back = doorEdge(site, backEdges, rng);
    if (!back) return false;
    site.setWall(back[0]!, 'doorBack');
    site.addDoor(backRoom, alley, back[0]!, 'keycard', 'doorBack');
    // Every room of the bank is reachable from outside, not just given a door: rooms whose rules point at each other
    // (a conference room and a records room) can otherwise open only into each other. Such a room gets a door to a
    // reachable neighbour, locked as its rules say, until every room is reached or none can be.
    let lonely = unreachable(site, rooms);
    while (lonely.length) {
        const linked = lonely.some(room => {
            // Only a door the rules allow either way round, and never into a secure room: their doors are hard locks.
            const allowed = (r: GenRoom) => ROOM_RULES[room.type].opensOnto.includes(r.type) || ROOM_RULES[r.type].opensOnto.includes(room.type);
            const reached = site.neighbours(room).filter(r => bank.has(r) && !lonely.includes(r) && r.zone !== 'secure' && room.zone !== 'secure' && allowed(r));
            return reached.some(r => connect(site, room, r, ROOM_RULES[room.type].lock, rng));
        });
        if (!linked) break;
        lonely = unreachable(site, rooms);
    }
    if (lonely.length) doorFailure = `unreachable: ${lonely.map(r => r.type).join(', ')}`;
    return !lonely.length;
}

/** The bank rooms no chain of doors and openings leads to from outside the bank. */
export function unreachable(site: Site, rooms: GenRoom[]): GenRoom[] {
    const inBank = new Set(rooms.map(r => r.id)), reached = new Set(site.rooms.filter(r => !inBank.has(r.id)).map(r => r.id));
    for (let grew = true; grew;) {
        grew = false;
        for (const d of site.doors) for (const [from, to] of [[d.a, d.b], [d.b, d.a]] as const) {
            if (reached.has(from) && !reached.has(to)) { reached.add(to); grew = true; }
        }
    }
    return rooms.filter(r => !reached.has(r.id));
}

/** Rooms a shortcut never leads into: the core, rooms behind a hard lock (their one door is the lock), the public floor, the counter and the stairs. */
const NO_SHORTCUT: RoomType[] = ['vault', 'antechamber', 'mantrap', 'cctvRoom', 'countingRoom', 'lobby', 'restroom', 'tellerLine', 'stairwell', 'mezzanine'];

/** How many steps the walk between two rooms that share a wall must take before a door between them is worth it. */
export const SHORTCUT_DETOUR = 20;
/** The most shortcuts a bank gets. */
const SHORTCUTS = 2;

/** Steps from tile `from` to tile `to` through the doors and openings there are (stairs included), or -1. */
function walk(site: Site, from: { x: number; y: number }, to: { x: number; y: number }): number {
    const doors = new Set(site.doors.map(d => edgeKey(d))), dist = new Int32Array(site.width * site.height).fill(-1);
    const queue = [from.y * site.width + from.x];
    dist[queue[0]!] = 0;
    for (let head = 0; head < queue.length; head++) {
        const i = queue[head]!, x = i % site.width, y = Math.floor(i / site.width);
        if (x === to.x && y === to.y) return dist[i]!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = x + dx, ny = y + dy, j = ny * site.width + nx;
            if (!site.inside(nx, ny) || dist[j] !== -1 || site.owner[ny]![nx]! < 0) continue;
            const e = edgeBetween({ x, y }, { x: nx, y: ny });
            if ((site.wallAt(e) && !doors.has(edgeKey(e))) || Math.abs(site.heightAt(x, y) - site.heightAt(nx, ny)) > MAX_STEP) continue;
            dist[j] = dist[i]! + 1;
            queue.push(j);
        }
    }
    return -1;
}

/**
 * Locked shortcuts (research/procedural-interiors.md, lesson 12): where two rooms of the bank share a wall but the walk
 * between them through the doors they have is long, a door in that wall (a keycard door into a secure room, a lock
 * otherwise) closes another loop; never between rooms already close. The longest walk first, measured again after
 * each door. A shortcut records the walk it saves as its `detour`.
 */
export function shortcuts(site: Site, rooms: GenRoom[], rng: Rng): void {
    for (let n = 0; n < SHORTCUTS; n++) {
        let best: { a: GenRoom; b: GenRoom; edge: Edge; steps: number } | undefined;
        for (const [i, a] of rooms.entries()) for (const b of rooms.slice(i + 1)) {
            if (NO_SHORTCUT.includes(a.type) || NO_SHORTCUT.includes(b.type) || isOpenPair(a.type, b.type)) continue;
            if (site.doors.some(d => (d.a === a.id && d.b === b.id) || (d.a === b.id && d.b === a.id))) continue;
            const edges = site.sharedEdges(a, b);
            const edge = edges.length >= 3 ? doorEdge(site, edges, rng)?.[0] : undefined;
            if (!edge) continue;
            const [p, q] = tilesOf(edge), steps = walk(site, p, q);
            if (steps >= SHORTCUT_DETOUR && (!best || steps > best.steps)) best = { a, b, edge, steps };
        }
        if (!best) return;
        const lock: Lock = best.a.zone === 'secure' || best.b.zone === 'secure' ? 'keycard' : 'mechanical';
        site.setWall(best.edge, DOOR_KIND[lock]);
        site.addDoor(best.a, best.b, best.edge, lock, DOOR_KIND[lock]).detour = best.steps;
    }
}

/** The counter gate: the opening in the counter from the lobby into the teller line, at one end of it. */
export function counterGate(site: Site, rooms: GenRoom[], rng: Rng): { teller: GenRoom; gateX: number } {
    const teller = rooms.find(r => r.type === 'tellerLine')!;
    const lobby = rooms.filter(r => r.type === 'lobby').find(l => site.sharedEdges(teller, l).length)!;
    const edges = site.sharedEdges(teller, lobby).filter(e => e.run === 'eastWest');
    const end = rng.chance(0.5) ? edges[1]! : edges[edges.length - 2]!;
    site.addDoor(teller, lobby, end, 'none', undefined);
    return { teller, gateX: end.tx };
}

/**
 * Railings along every open edge where the floor drops more than a step: the mezzanine's edge, the sides of the stairs,
 * a scaffold's open side (§14.7). The foot of a flight stays open.
 */
export function railings(site: Site): void {
    for (let y = 0; y < site.height; y++) for (let x = 0; x < site.width; x++) {
        for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
            const nx = x + dx, ny = y + dy;
            if (!site.inside(nx, ny) || site.owner[y]![x] === -1 || site.owner[ny]![nx] === -1) continue;
            const e = edgeBetween({ x, y }, { x: nx, y: ny });
            if (site.wallAt(e)) continue;
            if (Math.abs(site.heightAt(x, y) - site.heightAt(nx, ny)) > MAX_STEP) site.setWall(e, 'rail');
        }
    }
}

/** Rect helper: the tiles of a rect as a list. */
export function tilesIn(r: Rect): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y });
    return out;
}
