import { propBox, propSize, propSpan } from '../level/catalog';
import { TILE } from '../level/level';
import type { LevelProp, PersonFacing } from '../level/plan';
import { FACINGS, turned, type Facing } from '../level/space';
import { HANGABLE, type Furnisher, type Placed } from './furnish';
import type { GenRoom } from './model';
import type { P } from './nav';
import type { Furnished, Station } from './parcels';
import type { Rng } from './rng';
import { edgeBetween, tilesOf, type Edge, type Site } from './site';

/*
 * Furnishing by activity (research/procedural-interiors.md, lessons 5–8): a room is furnished with functional groups,
 * each an anchor and its satellites at fixed offsets and facings in the anchor's own frame, placed and turned as one
 * (the chair always faces its desk), with clearance tiles where the group is used (where the chair and the person go,
 * in front of drawers) that the `Furnisher` then keeps free like the tiles in front of doors. Things that stand on the
 * anchor (a monitor, a lamp, a cash counter) go on its top at the right height. Before any group, the shortest walks
 * between a room's doors, and from each door into it, are kept free so the room stays passable.
 *
 * Groups are placed by scored candidates: every tile of the room as the group's corner, each of four facings, mirrored
 * or not; a quick look throws out what can't fit (off the room, on furniture or a kept tile, a wall-backed group with no
 * wall behind it), the rest are scored (backed onto a wall, in a corner, away from the doors, near a partner group, in
 * an arm of the room that has nothing yet) with a little seeded jitter, and the best that the `Furnisher` accepts and
 * that leaves every door, station and clearance tile of the room reachable goes in. Bounded and deterministic.
 */

export type Kind = LevelProp['kind'];

/**
 * One piece of a group, in the group's own frame: x across its front (west to east when it faces south), y from its
 * back (the wall it stands against, if it does) to its front, the room.
 */
export interface Piece {
    kind: Kind;
    /** Its north-west tile in the group's frame (unused for a piece standing on another). */
    at: [number, number];
    /** Which way it faces in the group's frame; south, into the room, by default. */
    facing?: Facing;
    /** Sides of its tiles it is pushed against, in the group's frame (north is the group's back). */
    push?: Facing[];
    /** Fields of its own kind: a bare desk, a counter's width. */
    extra?: Record<string, unknown>;
    /** Left out when it doesn't fit, rather than failing the group. */
    optional?: boolean;
    /** A second-tier thing: on the top of piece `piece`, its middle `u` across and `v` back to front in that piece's own frame (pixels), facing relative to it. */
    on?: { piece: number; u: number; v: number };
    /** A name programs and stories find it by: the group's 'desk', 'table' or 'counter'. */
    tag?: string;
}

export interface GroupDef {
    name: string;
    /** Its footprint in its own frame: `w` across its back, `d` deep; the back row is what stands against a wall. */
    w: number;
    d: number;
    /** Backed onto a wall: a solid wall behind every tile of its back row. Otherwise it stands free in the room. */
    wall: boolean;
    pieces: Piece[];
    /** Tiles kept free for using it, in its frame. */
    clear?: [number, number][];
    /** Where its people stand, in its frame, and the way they look (in its frame; north by default, at the back). */
    stations?: { at: [number, number]; role: string; facing?: Facing }[];
    /** How much it wants a corner: a wall at one end of its back row. */
    corner?: number;
}

/** A group's place: the world tile its own (0, 0) lands on, the way its front faces, and whether it is mirrored. */
export class Frame {
    constructor(readonly x: number, readonly y: number, readonly facing: Facing, readonly mirror: boolean) {}

    /** The world tile of tile (dx, dy) in the group's frame. */
    tile(dx: number, dy: number): P {
        const mx = this.mirror ? -dx : dx;
        switch (this.facing) {
            case 'south': return { x: this.x + mx, y: this.y + dy };
            case 'north': return { x: this.x - mx, y: this.y - dy };
            case 'east': return { x: this.x + dy, y: this.y - mx };
            case 'west': return { x: this.x - dy, y: this.y + mx };
        }
    }

    /** The world direction of direction `f` in the group's frame. */
    dir(f: Facing): Facing {
        return turn(this.mirror ? flip(f) : f, this.facing);
    }

    /** The world tiles of a rectangle in the group's frame. */
    rect(dx: number, dy: number, w: number, d: number): P[] {
        const out: P[] = [];
        for (let y = dy; y < dy + d; y++) for (let x = dx; x < dx + w; x++) out.push(this.tile(x, y));
        return out;
    }
}

const turn = (f: Facing, by: Facing): Facing => FACINGS[(FACINGS.indexOf(f) + FACINGS.indexOf(by)) % 4]!;
const flip = (f: Facing): Facing => (f === 'east' ? 'west' : f === 'west' ? 'east' : f);

/** Who stands at a station is drawn from the front or the back: facing the camera's way or away from it. */
export const personFacing = (f: Facing): PersonFacing => (f === 'north' ? 'back' : 'front');

/** A group as placed: where, and the pieces that went in (undefined for an optional one left out). */
export interface PlacedGroup {
    def: GroupDef;
    frame: Frame;
    placed: (Placed | undefined)[];
    /** Its footprint's world tiles. */
    tiles: P[];
    stations: Station[];
}

/** How a program asks for a group: its partner nearby, how many candidates to try. */
export interface GroupOptions {
    /** Tiles it wants to be near (its partner group). */
    near?: P[];
    /** Extra weight for standing away from the doors (a manager's desk faces them from the far side). */
    away?: number;
    /** Only these facings (the way its front points). */
    facings?: Facing[];
    /** Only mirrored, or only not. */
    mirror?: boolean;
}

/** How many of the best candidates are tried with the `Furnisher` before a group gives up. */
const TRIES = 14;

/**
 * A room being furnished: its doors, what must stay reachable, the tiles kept for later (a hatch, a grate), and the
 * groups placed so far.
 */
export class RoomPlan {
    /** The inside tiles of the room's doors and open joins: where people come in. */
    readonly entries: P[] = [];
    /** The step into the room from each of its entries. */
    private readonly inward: P[] = [];
    /** Tiles that must stay reachable from the doors: stations, clearance, the spots kept for hatches and grates. */
    readonly must: P[] = [];
    /** Tiles no group may take (a hatch's or a vent's spot, kept for the ways in). */
    readonly reserved = new Set<string>();
    readonly groups: PlacedGroup[] = [];
    private readonly mine: (x: number, y: number) => boolean;

    constructor(readonly room: GenRoom, readonly f: Furnisher, readonly rng: Rng, readonly out: Furnished, readonly site: Site) {
        this.mine = (x, y) => site.roomAt(x, y) === room;
        const seen = new Set<string>();
        const add = (e: Edge) => {
            const [a, b] = tilesOf(e), [inside, outside] = this.mine(a.x, a.y) ? [a, b] : [b, a];
            if (!this.mine(inside.x, inside.y) || seen.has(`${inside.x},${inside.y}`)) return;
            seen.add(`${inside.x},${inside.y}`);
            this.entries.push(inside);
            this.inward.push({ x: inside.x - outside.x, y: inside.y - outside.y });
        };
        for (const d of site.doors) if (d.a === room.id || d.b === room.id) add(d);
        // Open joins without a door (two corridors that run into each other): the middle of each.
        for (const other of site.neighbours(room)) {
            const open = site.sharedEdges(room, other).filter(e => !site.wallAt(e) && !site.doors.some(d => d.run === e.run && d.tx === e.tx && d.ty === e.ty));
            const e = open[Math.floor(open.length / 2)];
            if (e) add(e);
        }
        this.must.push(...this.entries);
    }

    /** Keeps a tile for something placed later (a hatch, a grate, a vent), so no group takes it. */
    reserve(x: number, y: number): void {
        this.reserved.add(`${x},${y}`);
        this.must.push({ x, y });
    }

    /**
     * Keeps free the walk between each pair of the room's doors, and a step into the room from each door (lesson 6),
     * round what already stands in it. A walk is the shortest that stays off the walls (they are for the furniture)
     * and turns least: a step costs 10, a tile beside a wall 6 more, a turn 1. A door that can't be reached from the
     * first one even now (a room cut in two by a fixed piece) isn't asked to stay reachable.
     */
    walks(): void {
        if (!this.entries.length) throw new Error(`${this.room.id} has no way in to keep a walk from`);
        for (let i = 0; i < this.entries.length; i++) {
            const from = this.walksFrom(this.entries[i]!);
            for (let j = i + 1; j < this.entries.length; j++) for (const t of from(this.entries[j]!)) this.f.keep(t.x, t.y);
            // The tile beyond the door's own, straight on into the room: where whoever comes in steps to.
            const e = this.entries[i]!, step = this.inward[i]!, next = { x: e.x + step.x, y: e.y + step.y };
            if (this.mine(next.x, next.y) && !this.f.blocked(next.x, next.y)) this.f.keep(next.x, next.y);
        }
        const reached = this.distances(this.entries[0]!);
        const ok = (t: P) => reached.has(t.y * this.site.width + t.x);
        this.must.splice(0, this.must.length, ...this.must.filter(ok));
    }

    /** The cheapest walks from `a` (as `walks` costs them): a function giving the tiles of the one to any tile, or none. */
    private walksFrom(a: P): (b: P) => P[] {
        const { width } = this.site, dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
        const byWall = (q: P) => dirs.some(([dx, dy]) => !this.mine(q.x + dx, q.y + dy) || !!this.site.wallAt(edgeBetween(q, { x: q.x + dx, y: q.y + dy })));
        const key = (p: P, d: number) => (p.y * width + p.x) * 4 + d;
        const cost = new Map<number, number>(), prev = new Map<number, number>(), heap = new MinHeap();
        for (let d = 0; d < 4; d++) { cost.set(key(a, d), 0); heap.push(key(a, d), 0); }
        while (heap.size) {
            const { node: k, key: c } = heap.pop();
            if (c > cost.get(k)!) continue;
            const t = Math.floor(k / 4), d = k % 4, p = { x: t % width, y: Math.floor(t / width) };
            for (let nd = 0; nd < 4; nd++) {
                const q = { x: p.x + dirs[nd]![0], y: p.y + dirs[nd]![1] };
                if (!this.mine(q.x, q.y) || this.site.wallAt(edgeBetween(p, q)) || this.f.blocked(q.x, q.y)) continue;
                const nk = key(q, nd), nc = c + 10 + (byWall(q) ? 6 : 0) + (nd === d ? 0 : 1);
                if (nc >= (cost.get(nk) ?? Infinity)) continue;
                cost.set(nk, nc);
                prev.set(nk, k);
                heap.push(nk, nc);
            }
        }
        return b => {
            const ends = [0, 1, 2, 3].map(d => key(b, d)).filter(k => cost.has(k));
            if (!ends.length) return [];
            const out: P[] = [];
            for (let k: number | undefined = ends.reduce((x, y) => (cost.get(y)! < cost.get(x)! ? y : x)); k !== undefined; k = prev.get(k)) {
                const t = Math.floor(k / 4);
                out.push({ x: t % width, y: Math.floor(t / width) });
            }
            return out;
        };
    }

    /** Steps from `from` to every tile of the room a person can walk to, round the walls and the furniture. */
    private distances(from: P): Map<number, number> {
        const { width } = this.site, dist = new Map<number, number>([[from.y * width + from.x, 0]]), queue = [from];
        for (let i = 0; i < queue.length; i++) {
            const p = queue[i]!, d = dist.get(p.y * width + p.x)!;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const q = { x: p.x + dx, y: p.y + dy }, k = q.y * width + q.x;
                if (dist.has(k) || !this.mine(q.x, q.y) || this.site.wallAt(edgeBetween(p, q)) || this.f.blocked(q.x, q.y)) continue;
                dist.set(k, d + 1);
                queue.push(q);
            }
        }
        return dist;
    }

    /** Places the best-scoring group of `def` the room can take, or nothing. */
    group(def: GroupDef, opts: GroupOptions = {}): PlacedGroup | undefined {
        const candidates: { frame: Frame; score: number }[] = [];
        const tiles = this.site.tilesOfRoom(this.room);
        for (const facing of opts.facings ?? FACINGS) for (const mirror of opts.mirror === undefined ? [false, true] : [opts.mirror]) for (const t of tiles) {
            const frame = new Frame(t.x, t.y, facing, mirror);
            const score = this.score(def, frame, opts);
            if (score !== undefined) candidates.push({ frame, score: score + this.rng.next() * 0.8 });
        }
        candidates.sort((a, b) => b.score - a.score);
        for (const { frame } of candidates.slice(0, TRIES)) {
            // Without its optional pieces when they would close it in (a plant beside the chair the manager gets out by).
            const placed = this.place(def, frame, true) ?? this.place(def, frame, false);
            if (placed) return placed;
        }
        return undefined;
    }

    /** Places up to `count` groups of `def`; how many went in. */
    groupsOf(def: GroupDef, count: number, opts: GroupOptions = {}): number {
        let n = 0;
        while (n < count && this.group(def, opts)) n++;
        return n;
    }

    /** A candidate's score, or undefined when a quick look shows it can't fit. */
    private score(def: GroupDef, frame: Frame, opts: GroupOptions): number | undefined {
        const free = (p: P, standing: boolean) => this.mine(p.x, p.y) && !this.f.occupied(p.x, p.y) && !this.reserved.has(`${p.x},${p.y}`)
            && (!standing || (!this.f.isKept(p.x, p.y) && !this.f.isStanding(p.x, p.y)));
        for (const piece of def.pieces) {
            if (piece.optional || piece.on) continue;
            if (!this.pieceTiles(piece, frame).every(p => free(p, true))) return undefined;
        }
        for (const [dx, dy] of def.clear ?? []) if (!free(frame.tile(dx, dy), false)) return undefined;
        for (const s of def.stations ?? []) if (!free(frame.tile(...s.at), false) || this.f.isStanding(frame.tile(...s.at).x, frame.tile(...s.at).y)) return undefined;
        let score = 0;
        if (def.wall) {
            for (let x = 0; x < def.w; x++) if (!this.solid(frame.tile(x, -1), frame.tile(x, 0))) return undefined;
            score += 2;
        }
        if (def.corner && (this.solid(frame.tile(-1, 0), frame.tile(0, 0)) || this.solid(frame.tile(def.w, 0), frame.tile(def.w - 1, 0)))) score += def.corner;
        const foot = frame.rect(0, 0, def.w, def.d);
        // Away from the doors, up to four steps.
        const toDoor = Math.min(...foot.map(p => Math.min(...this.entries.map(e => Math.abs(e.x - p.x) + Math.abs(e.y - p.y)))));
        score += (opts.away ?? (def.wall ? 0.5 : 0.15)) * Math.min(4, toDoor);
        // Against the south wall a group shows the camera its back (the walls in front are cut down, the furniture isn't):
        // storage and the like would rather stand along the other walls.
        if (def.wall && !def.stations?.length && frame.facing === 'north') score -= 0.8;
        if (opts.near?.length) score -= 0.4 * Math.min(...foot.map(p => Math.min(...opts.near!.map(q => Math.abs(q.x - p.x) + Math.abs(q.y - p.y)))));
        // A free-standing group stands in the middle of its part of the room, clear of the walls.
        const part = this.partOf(frame.tile(0, 0));
        if (!def.wall) {
            const r = this.room.parts[part]!, cx = foot.reduce((s, p) => s + p.x, 0) / foot.length, cy = foot.reduce((s, p) => s + p.y, 0) / foot.length;
            score -= 0.3 * Math.hypot(cx - (r.x + (r.w - 1) / 2), cy - (r.y + (r.h - 1) / 2));
        }
        // People are drawn from the front or the back, so stations read best facing north or south.
        if (def.stations?.length && (frame.facing === 'north' || frame.facing === 'south')) score += 0.5;
        // An arm of an L with nothing in it yet draws the next group (lesson 11: the arm is a place, not left over).
        if (this.room.parts.length > 1) score += 1.5 / (1 + this.groups.filter(g => this.partOf(g.frame.tile(0, 0)) === part).length);
        return score;
    }

    private partOf(p: P): number {
        return Math.max(0, this.room.parts.findIndex(r => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h));
    }

    /** Whether the edge between two neighbouring tiles is a solid wall a group can back onto (not a door or glass). */
    solid(outside: P, inside: P): boolean {
        const e = edgeBetween(outside, inside), wall = this.site.wallAt(e);
        return !!wall && HANGABLE.includes(wall.kind) && !this.site.doors.some(d => d.run === e.run && d.tx === e.tx && d.ty === e.ty);
    }

    /** The world tiles a floor piece takes. */
    private pieceTiles(piece: Piece, frame: Frame): P[] {
        const span = propSpan({ kind: piece.kind, tx: 0, ty: 0, facing: piece.facing ?? 'south', ...piece.extra } as LevelProp);
        return frame.rect(piece.at[0], piece.at[1], span.w, span.d);
    }

    /** A piece as a level prop at its place in the world (a second-tier one on the top of `under`). */
    prop(piece: Piece, frame: Frame, under?: Placed): LevelProp {
        if (piece.on) {
            if (!under) throw new Error(`A ${piece.kind} needs piece ${piece.on.piece} under it`);
            return onTop(piece.kind, under, piece.on.u, piece.on.v, frame.mirror, piece.facing ?? 'south', piece.extra);
        }
        const tiles = this.pieceTiles(piece, frame);
        const pushed = (piece.push ?? []).map(s => frame.dir(s));
        const alignX = pushed.find(s => s === 'east' || s === 'west') ?? 'center', alignY = pushed.find(s => s === 'north' || s === 'south') ?? 'center';
        return {
            kind: piece.kind, tx: Math.min(...tiles.map(t => t.x)), ty: Math.min(...tiles.map(t => t.y)), facing: frame.dir(piece.facing ?? 'south'),
            alignX, alignY, ...piece.extra
        } as LevelProp;
    }

    /** Tries one candidate: every piece it needs, its stations and clearance, and the room still walkable; or nothing. */
    private place(def: GroupDef, frame: Frame, optional: boolean): PlacedGroup | undefined {
        const mark = this.f.mark(), placed: (Placed | undefined)[] = [];
        const fail = () => {
            this.f.rollback(mark);
            return undefined;
        };
        for (const piece of def.pieces) {
            const under = piece.on ? placed[piece.on.piece] : undefined;
            if ((piece.on && !under) || (piece.optional && !optional)) {
                if (!piece.optional) return fail();
                placed.push(undefined);
                continue;
            }
            const prop = this.prop(piece, frame, under);
            if (this.f.try(prop, this.room)) placed.push(this.f.boxes.at(-1)!);
            else if (piece.optional) placed.push(undefined);
            else return fail();
        }
        const stations: Station[] = [];
        for (const s of def.stations ?? []) {
            const t = frame.tile(...s.at);
            if (!this.f.stand(t.x, t.y)) return fail();
            stations.push({ tx: t.x, ty: t.y, facing: personFacing(frame.dir(s.facing ?? 'north')), role: s.role, room: this.room.id });
        }
        const clear = (def.clear ?? []).map(([dx, dy]) => frame.tile(dx, dy));
        for (const t of clear) this.f.keep(t.x, t.y);
        // Clearance the group's own chair stands on is for using it, not for walking through.
        const open = clear.filter(t => !this.f.blocked(t.x, t.y));
        if (!this.reachable([...stations.map(s => ({ x: s.tx, y: s.ty })), ...open])) return fail();
        this.must.push(...stations.map(s => ({ x: s.tx, y: s.ty })), ...open);
        this.out.stations.push(...stations);
        const group = { def, frame, placed, tiles: frame.rect(0, 0, def.w, def.d), stations };
        this.groups.push(group);
        return group;
    }

    /** Whether every tile that must stay reachable (the other doors among them, and `extra`) still is, from its first door. */
    reachable(extra: P[] = []): boolean {
        const { width } = this.site, seen = this.distances(this.entries[0]!);
        return [...this.must, ...extra].every(t => seen.has(t.y * width + t.x));
    }
}

/**
 * A second-tier prop on the top of `under`: its middle `u` across and `v` from the back of `under`'s own frame (mirrored
 * with its group), facing `facing` relative to it, at the height of its top.
 */
export function onTop(kind: Kind, under: Placed, u: number, v: number, mirror: boolean, facing: Facing, extra: Record<string, unknown> = {}): LevelProp {
    const b = under.box, own = propSize(under.prop), fs = b.facing;
    const mu = mirror ? own.w - u : u;
    const [cx, cy] = fs === 'south' ? [b.x + mu, b.y + v] : fs === 'north' ? [b.x + own.w - mu, b.y + own.d - v] : fs === 'east' ? [b.x + v, b.y + own.w - mu] : [b.x + own.d - v, b.y + mu];
    const world = turn(mirror ? flip(facing) : facing, fs);
    const base = { kind, tx: Math.floor(cx / TILE), ty: Math.floor(cy / TILE), facing: world, elevation: b.z + b.h, alignX: 'center', alignY: 'center', ...extra } as LevelProp;
    const size = turned(propSize(base), world), at = propBox(base, []);
    return { ...base, offset: [Math.round(cx - size.w / 2) - at.x, Math.round(cy - size.d / 2) - at.y] };
}

/** A binary min-heap of numbers by key, for the walks; stale entries are skipped by the caller. */
class MinHeap {
    private readonly nodes: number[] = [];
    private readonly keys: number[] = [];

    get size(): number {
        return this.nodes.length;
    }

    push(node: number, key: number): void {
        let i = this.nodes.length;
        this.nodes.push(node);
        this.keys.push(key);
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.keys[parent]! <= key) break;
            this.nodes[i] = this.nodes[parent]!;
            this.keys[i] = this.keys[parent]!;
            i = parent;
        }
        this.nodes[i] = node;
        this.keys[i] = key;
    }

    pop(): { node: number; key: number } {
        const top = { node: this.nodes[0]!, key: this.keys[0]! };
        const node = this.nodes.pop()!, key = this.keys.pop()!;
        if (!this.nodes.length) return top;
        let i = 0;
        for (;;) {
            let child = 2 * i + 1;
            if (child >= this.nodes.length) break;
            if (child + 1 < this.nodes.length && this.keys[child + 1]! < this.keys[child]!) child++;
            if (this.keys[child]! >= key) break;
            this.nodes[i] = this.nodes[child]!;
            this.keys[i] = this.keys[child]!;
            i = child;
        }
        this.nodes[i] = node;
        this.keys[i] = key;
        return top;
    }
}
