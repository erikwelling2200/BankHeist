import type { DeepReadonly, Pos, ReadonlyWorld, State } from '../core/types';
import { DRIFT_TILES, TURN_RADIUS, TURN_SCALE, TURN_STEPS, TURN_TILES, type VehicleType } from '../data/vehicles';

/*
 * Where a vehicle can drive (§14.4): its footprint on the grid, the manoeuvres one Drive is made of and every pose it
 * can reach within its tiles of path, each with the one path the reducer will drive and the tiles that path sweeps.
 * The overlay's highlight, the preview's swept path and the commit all come from `driveReach`, so they can't differ.
 *
 * - **Poses.** A vehicle stands on a rectangle of whole tiles, `width` across and `length` along its heading (one of
 *   the four orthogonal directions); `Pose` is its north-west tile and its heading.
 * - **Manoeuvres** (decision 171): 1 tile forward or back (1 tile of path); a drift, 2 tiles forward or back and 1
 *   across (2: §14.4's 1 sideways for every 2 travelled); a quarter turn left or right, forward or in reverse, its
 *   middle on a quarter circle of `TURN_RADIUS` (the curve's length, `TURN_TILES`). A half turn is two quarter turns.
 * - **Sweeps.** A straight move or a drift sweeps the footprints it passes through. A turn sweeps every tile its body
 *   covers on the way round: the body is placed at every 3° of the curve (`TURN_STEPS`, whole numbers) and a tile
 *   counts when one of its 16 sample points falls inside it. The sweep is worked out once per size, for a vehicle facing
 *   north turning right, and turned and mirrored onto every other turn, in whole numbers. A turn in reverse sweeps
 *   exactly what the forward turn back to where it started sweeps.
 * - **Clear path** (§14.4): every tile a manoeuvre sweeps is clear (the caller decides: drivable, nothing standing,
 *   nobody there) and no wall that stops movement stands between two of them. Off the map's west and east edges the
 *   street goes on (the caller says where): a pose with a tile off the map has left the plot, and is the end of a path.
 * - **Reach**: Dijkstra over poses with whole-tile costs, settled in order of cost, then row, column and heading; a
 *   pose keeps the first parent (in the order of `MANOEUVRES`) that reached it at its lowest cost. Integer arithmetic
 *   only, as everywhere in the rules.
 */

/** The four headings a vehicle can have, clockwise from north. */
export type Heading = 'n' | 'e' | 's' | 'w';
export const HEADINGS: readonly Heading[] = ['n', 'e', 's', 'w'];

/** Where a vehicle stands: the north-west tile of its footprint, and which way its nose points. */
export interface Pose { x: number; y: number; heading: Heading }

/** A crew vehicle as the bank was built with it (§14.4, §15.4): what it is and where it waits from the start. */
export interface VehicleDef {
    id: string;
    type: VehicleType;
    name: string;
    width: number;
    length: number;
    start: Pose;
}

/** A crew vehicle now (§14.4). Who is aboard is `CrewState.aboard`. */
export interface VehicleState {
    pose: Pose;
    /** The crew member in the driver's seat, whose actions a Drive spends; null with nobody aboard. */
    driver: string | null;
    /** The loot in the hold, by id (its `LootState.holder` is the vehicle's id), in the order it was put in. */
    hold: string[];
    /** It drove off the plot (§15.4). */
    gone: boolean;
}

declare module '../core/types' {
    interface World {
        /** The crew's vehicles (§14.4): the van at its getaway spot. Absent: none. */
        vehicles?: VehicleDef[];
    }
    interface State {
        /** The crew's vehicles now, by id. */
        vehicles: Record<string, VehicleState>;
    }
    interface Tile {
        /** A vehicle can drive on it (§14.4 Drivable: the street, lots, sidewalks, open ground). Absent: it can't. */
        drivable?: boolean;
    }
    interface CrewState {
        /** The vehicle they sit in (§14.4), or null on foot. Aboard, they stand on its footprint and act only through it. */
        aboard: string | null;
    }
}

/** A vehicle's size: tiles across and along it. */
export interface VehicleSize { width: number; length: number }

const index = (h: Heading): number => HEADINGS.indexOf(h);

/** (x, y) turned clockwise `k` quarter turns (y grows south). */
function rotate(x: number, y: number, k: number): [number, number] {
    let a = x, b = y;
    for (let i = 0; i < ((k % 4) + 4) % 4; i++) [a, b] = [-b, a];
    return [a, b];
}

/** The footprint's extent along x and y for a heading. */
const dims = (size: VehicleSize, h: Heading): [number, number] => (h === 'n' || h === 's' ? [size.width, size.length] : [size.length, size.width]);

/** Twice the middle of a pose's footprint: whole numbers whatever its size. */
function middle2(size: VehicleSize, pose: DeepReadonly<Pose>): [number, number] {
    const [w, l] = dims(size, pose.heading);
    return [2 * pose.x + w, 2 * pose.y + l];
}

/** The pose whose footprint's middle (doubled) is `m2`, heading `h`. */
function fromMiddle2(size: VehicleSize, m2: readonly [number, number], h: Heading): Pose {
    const [w, l] = dims(size, h);
    return { x: (m2[0] - w) / 2, y: (m2[1] - l) / 2, heading: h };
}

/** The tiles of a pose's footprint, row-major. */
export function footprint(size: VehicleSize, pose: DeepReadonly<Pose>): Pos[] {
    const [w, l] = dims(size, pose.heading), out: Pos[] = [];
    for (let y = pose.y; y < pose.y + l; y++) for (let x = pose.x; x < pose.x + w; x++) out.push({ x, y });
    return out;
}

/** The vehicle (not gone) whose footprint covers `p`, if any (geo/drive.ts's rectangle, without building it). */
export function vehicleAt(world: ReadonlyWorld, state: DeepReadonly<State>, p: DeepReadonly<Pos>): string | undefined {
    for (const def of world.vehicles ?? []) {
        const v = state.vehicles?.[def.id];
        if (!v || v.gone) continue;
        const across = v.pose.heading === 'n' || v.pose.heading === 's';
        const w = across ? def.width : def.length, l = across ? def.length : def.width;
        if (p.x >= v.pose.x && p.x < v.pose.x + w && p.y >= v.pose.y && p.y < v.pose.y + l) return def.id;
    }
    return undefined;
}

/** One tile forward along a heading, and one to its right. */
export const forwardOf = (h: Heading): Pos => { const [x, y] = rotate(0, -1, index(h)); return { x, y }; };
export const rightOf = (h: Heading): Pos => { const [x, y] = rotate(1, 0, index(h)); return { x, y }; };

/**
 * A tile given in the vehicle's own frame (facing north with its north-west tile at (0, 0): x across to its right, y
 * back from its nose) where it is for `pose`; `mirror` takes it to the other side first.
 */
function place(size: VehicleSize, pose: DeepReadonly<Pose>, t: Pos, mirror = false): Pos {
    const m = middle2(size, pose), ux = 2 * t.x + 1 - size.width, uy = 2 * t.y + 1 - size.length;
    const [rx, ry] = rotate(mirror ? -ux : ux, uy, index(pose.heading));
    return { x: (m[0] + rx - 1) / 2, y: (m[1] + ry - 1) / 2 };
}

/**
 * The tiles a vehicle's doors open onto (§14.4): the sliding door on its right side (the tiles beside the second and
 * third tiles back from the nose) and the rear doors (the tiles behind it). Getting in and out is from these, in that
 * order.
 */
export function doorTiles(size: VehicleSize, pose: DeepReadonly<Pose>): Pos[] {
    const out: Pos[] = [];
    for (let along = 1; along <= Math.min(2, size.length - 2); along++) out.push(place(size, pose, { x: size.width, y: along }));
    for (let across = 0; across < size.width; across++) out.push(place(size, pose, { x: across, y: size.length }));
    return out;
}

// ---------------------------------------------------------------------------------------------------------- Turns

/** The sweep of a quarter turn right for a vehicle facing north with its north-west tile at (0, 0), by size. */
const TURN_SWEEPS = new Map<string, readonly Pos[]>();

/**
 * The tiles a quarter turn right sweeps, for a vehicle facing north at (0, 0) (see the header). Units of 1/8 tile; the
 * curve's angles scaled by `TURN_SCALE`, so every product is a whole number well inside a double's exact range.
 */
function canonicalSweep(size: VehicleSize): readonly Pos[] {
    const key = `${size.width}x${size.length}`;
    const known = TURN_SWEEPS.get(key);
    if (known) return known;
    const S = TURN_SCALE, U = 8, R = TURN_RADIUS * U, halfW = (size.width * U) / 2, halfL = (size.length * U) / 2;
    // The pivot: R to the right of the footprint's middle.
    const px = halfW + R, py = halfL;
    const out: Pos[] = [];
    const reach = TURN_RADIUS + size.length + size.width;
    for (let ty = -reach; ty <= size.length + reach; ty++) {
        for (let tx = -reach; tx <= size.width + reach; tx++) {
            let hit = false;
            for (const [c, s] of TURN_STEPS) {
                // The body's middle at this angle, scaled by S; forward is (s, −c), right is (c, s).
                const mx = px * S - R * c, my = py * S - R * s;
                for (let i = 0; i < 4 && !hit; i++) for (let j = 0; j < 4 && !hit; j++) {
                    const dx = (tx * U + 1 + 2 * i) * S - mx, dy = (ty * U + 1 + 2 * j) * S - my;
                    const along = dx * s - dy * c, across = dx * c + dy * s;
                    hit = Math.abs(along) < halfL * S * S && Math.abs(across) < halfW * S * S;
                }
                if (hit) break;
            }
            if (hit) out.push({ x: tx, y: ty });
        }
    }
    TURN_SWEEPS.set(key, out);
    return out;
}

/** A manoeuvre's result: where it ends, the tiles it sweeps (row-major), and its tiles of path. */
export interface Swept { end: Pose; tiles: Pos[]; cost: number }

/** A quarter turn forward, to the right (`side` 1) or the left (−1). */
function forwardTurn(size: VehicleSize, pose: DeepReadonly<Pose>, side: 1 | -1): Swept {
    const k = index(pose.heading), f = forwardOf(pose.heading), r = rightOf(pose.heading), m = middle2(size, pose);
    // A left turn is the right turn mirrored across the vehicle's length.
    const tiles = canonicalSweep(size).map(t => place(size, pose, t, side === -1));
    const d = 2 * TURN_RADIUS;
    const end = fromMiddle2(size, [m[0] + d * f.x + side * d * r.x, m[1] + d * f.y + side * d * r.y], HEADINGS[(k + side + 4) % 4]!);
    return { end, tiles: rowMajor(tiles), cost: TURN_TILES };
}

/** A quarter turn in reverse, its tail swinging right (`side` 1) or left (−1): the forward turn back, the other way round. */
function reverseTurn(size: VehicleSize, pose: DeepReadonly<Pose>, side: 1 | -1): Swept {
    const k = index(pose.heading), f = forwardOf(pose.heading), r = rightOf(pose.heading), m = middle2(size, pose), d = 2 * TURN_RADIUS;
    const end = fromMiddle2(size, [m[0] - d * f.x + side * d * r.x, m[1] - d * f.y + side * d * r.y], HEADINGS[(k - side + 4) % 4]!);
    return { end, tiles: forwardTurn(size, end, side).tiles, cost: TURN_TILES };
}

/** Tiles in row order, each once. */
function rowMajor(tiles: readonly Pos[]): Pos[] {
    const seen = new Set<string>(), out: Pos[] = [];
    for (const t of tiles) {
        const k = `${t.x},${t.y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ x: t.x, y: t.y });
    }
    return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

const shifted = (pose: DeepReadonly<Pose>, dx: number, dy: number): Pose => ({ x: pose.x + dx, y: pose.y + dy, heading: pose.heading });

/** A straight move or a drift through the given offsets (whole tiles), sweeping each footprint on the way. */
function straight(size: VehicleSize, pose: DeepReadonly<Pose>, offsets: readonly Pos[], cost: number): Swept {
    const tiles = [pose, ...offsets.map(o => shifted(pose, o.x, o.y))].flatMap(p => footprint(size, p));
    const last = offsets[offsets.length - 1]!;
    return { end: shifted(pose, last.x, last.y), tiles: rowMajor(tiles), cost };
}

/** The manoeuvres, in the order a reach tries them: straight, drifts, turns (see the header). */
export const MANOEUVRES = ['forward', 'back', 'driftLeft', 'driftRight', 'backLeft', 'backRight', 'turnLeft', 'turnRight', 'reverseLeft', 'reverseRight'] as const;
export type Manoeuvre = (typeof MANOEUVRES)[number];

/** Where a manoeuvre takes a vehicle and what it sweeps on the way (clear or not). */
export function manoeuvre(size: VehicleSize, pose: DeepReadonly<Pose>, m: Manoeuvre): Swept {
    const f = forwardOf(pose.heading), r = rightOf(pose.heading);
    const at = (along: number, across: number): Pos => ({ x: f.x * along + r.x * across, y: f.y * along + r.y * across });
    switch (m) {
        case 'forward': return straight(size, pose, [at(1, 0)], 1);
        case 'back': return straight(size, pose, [at(-1, 0)], 1);
        case 'driftLeft': return straight(size, pose, [at(1, 0), at(1, -1), at(2, -1)], DRIFT_TILES);
        case 'driftRight': return straight(size, pose, [at(1, 0), at(1, 1), at(2, 1)], DRIFT_TILES);
        case 'backLeft': return straight(size, pose, [at(-1, 0), at(-1, -1), at(-2, -1)], DRIFT_TILES);
        case 'backRight': return straight(size, pose, [at(-1, 0), at(-1, 1), at(-2, 1)], DRIFT_TILES);
        case 'turnLeft': return forwardTurn(size, pose, -1);
        case 'turnRight': return forwardTurn(size, pose, 1);
        case 'reverseLeft': return reverseTurn(size, pose, -1);
        case 'reverseRight': return reverseTurn(size, pose, 1);
    }
}

// ---------------------------------------------------------------------------------------------------------- Reach

/** What a tile is to a vehicle: clear to drive on, off the plot where the street goes on, or in the way. */
export type DriveTile = 'clear' | 'off' | 'blocked';

/** How a reach sees the map: each tile (on the map or off it), and whether a wall stops movement between two neighbours. */
export interface DriveMap {
    tile(p: Pos): DriveTile;
    wall(a: Pos, b: Pos): boolean;
}

/** One pose reached: its cost, the pose before it and the manoeuvre from there, what that swept, and whether it left the plot. */
export interface DriveNode {
    pose: Pose;
    cost: number;
    parent: string | null;
    via: Manoeuvre | null;
    swept: Pos[];
    off: boolean;
}

export interface DriveReach {
    from: Pose;
    budget: number;
    /** Every pose reached by key (`poseKey`), the start first, in the order settled. */
    nodes: Map<string, DriveNode>;
}

export const poseKey = (p: DeepReadonly<Pose>): string => `${p.x},${p.y},${p.heading}`;

/** A manoeuvre from any pose of one heading, worked out once: its end and sweep relative to the start's tile. */
interface Template {
    via: Manoeuvre;
    dx: number;
    dy: number;
    heading: Heading;
    cost: number;
    tiles: readonly Pos[];
    /** The pairs of swept tiles that are orthogonal neighbours (indices into `tiles`): a wall between them stops it. */
    pairs: readonly (readonly [number, number])[];
    /** The end footprint's tiles, relative: one off the plot ends the path there. */
    end: readonly Pos[];
}

const TEMPLATES = new Map<string, Readonly<Record<Heading, readonly Template[]>>>();

/** Every manoeuvre from each heading, relative to the start's north-west tile (see `Template`). */
function templates(size: VehicleSize): Readonly<Record<Heading, readonly Template[]>> {
    const key = `${size.width}x${size.length}`;
    const known = TEMPLATES.get(key);
    if (known) return known;
    const out = {} as Record<Heading, Template[]>;
    for (const heading of HEADINGS) {
        out[heading] = MANOEUVRES.map(via => {
            const step = manoeuvre(size, { x: 0, y: 0, heading }, via);
            const at = new Map(step.tiles.map((t, i) => [`${t.x},${t.y}`, i]));
            const pairs: [number, number][] = [];
            step.tiles.forEach((t, i) => {
                for (const n of [`${t.x + 1},${t.y}`, `${t.x},${t.y + 1}`]) if (at.has(n)) pairs.push([i, at.get(n)!]);
            });
            return { via, dx: step.end.x, dy: step.end.y, heading: step.end.heading, cost: step.cost, tiles: step.tiles, pairs, end: footprint(size, step.end) };
        });
    }
    TEMPLATES.set(key, out);
    return out;
}

/** Every pose within `budget` tiles of path from `from` (see the header). */
export function driveReach(size: VehicleSize, from: DeepReadonly<Pose>, budget: number, map: DriveMap): DriveReach {
    const start: DriveNode = { pose: { x: from.x, y: from.y, heading: from.heading }, cost: 0, parent: null, via: null, swept: [], off: false };
    const nodes = new Map<string, DriveNode>(), best = new Map<string, DriveNode>([[poseKey(start.pose), start]]);
    const buckets: string[][] = [[poseKey(start.pose)]];
    const all = templates(size);
    const order = (a: string, b: string): number => {
        const p = best.get(a)!.pose, q = best.get(b)!.pose;
        return p.y - q.y || p.x - q.x || index(p.heading) - index(q.heading);
    };
    for (let cost = 0; cost <= budget; cost++) {
        const bucket = buckets[cost];
        if (!bucket) continue;
        bucket.sort(order);
        for (const key of bucket) {
            const node = best.get(key)!;
            if (nodes.has(key) || node.cost !== cost) continue;
            nodes.set(key, node);
            // A pose off the plot is where the path ends: the vehicle has gone.
            if (node.off) continue;
            const { x, y } = node.pose;
            for (const t of all[node.pose.heading]) {
                const next = cost + t.cost, end: Pose = { x: x + t.dx, y: y + t.dy, heading: t.heading }, k = poseKey(end);
                if (next > budget || nodes.has(k)) continue;
                const known = best.get(k);
                if (known && known.cost <= next) continue;
                const swept = t.tiles.map(p => ({ x: x + p.x, y: y + p.y }));
                if (swept.some(p => map.tile(p) === 'blocked') || t.pairs.some(([i, j]) => map.wall(swept[i]!, swept[j]!))) continue;
                const off = t.end.some(p => map.tile({ x: x + p.x, y: y + p.y }) === 'off');
                best.set(k, { pose: end, cost: next, parent: key, via: t.via, swept, off });
                (buckets[next] ??= []).push(k);
            }
        }
    }
    return { from: start.pose, budget, nodes };
}

/** A drive to one pose of a reach: the poses after each manoeuvre, the tiles swept on the way (row-major), its cost. */
export interface DrivePath { poses: Pose[]; swept: Pos[]; cost: number; off: boolean }

export function drivePath(reach: DriveReach, to: DeepReadonly<Pose>): DrivePath | undefined {
    const end = reach.nodes.get(poseKey(to));
    if (!end || !end.parent) return undefined;
    const poses: Pose[] = [], swept: Pos[] = [];
    for (let n: DriveNode | undefined = end; n?.parent; n = reach.nodes.get(n.parent)) {
        poses.push({ ...n.pose });
        swept.push(...n.swept);
    }
    return { poses: poses.reverse(), swept: rowMajor(swept), cost: end.cost, off: end.off };
}
