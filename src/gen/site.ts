import { floorHeight, RAISED_HEIGHT, type FloorTile, type Level, type LevelProp } from '../level/plan';
import type { Wall, WallKind } from '../level/walls';
import type { Door, GenRoom, Lock, Rect, RoomType, Wing } from './model';
import { ROOM_RULES } from './rooms';

/** A wall edge: the run and tile, as a `Wall` has them. */
export interface Edge { run: 'eastWest' | 'northSouth'; tx: number; ty: number }

export const edgeKey = (e: Edge): string => `${e.run} ${e.tx} ${e.ty}`;

/** The edge between two neighbouring tiles. */
export function edgeBetween(a: { x: number; y: number }, b: { x: number; y: number }): Edge {
    if (a.y === b.y) return { run: 'northSouth', tx: Math.max(a.x, b.x), ty: a.y };
    return { run: 'eastWest', tx: a.x, ty: Math.max(a.y, b.y) };
}

/** The two tiles either side of an edge: north then south, or west then east. */
export function tilesOf(e: Edge): [{ x: number; y: number }, { x: number; y: number }] {
    return e.run === 'eastWest' ? [{ x: e.tx, y: e.ty - 1 }, { x: e.tx, y: e.ty }] : [{ x: e.tx - 1, y: e.ty }, { x: e.tx, y: e.ty }];
}

/** The smallest rectangle round `parts`. */
export function boundingBox(parts: readonly Rect[]): Rect {
    if (!parts.length) throw new Error('A shape needs at least one part');
    const x = Math.min(...parts.map(p => p.x)), y = Math.min(...parts.map(p => p.y));
    return { x, y, w: Math.max(...parts.map(p => p.x + p.w)) - x, h: Math.max(...parts.map(p => p.y + p.h)) - y };
}

/** The most a person climbs between neighbouring tiles without stairs: a step of a flight. */
export const MAX_STEP = RAISED_HEIGHT / 3;

/**
 * The generator's workspace: the floor, which room owns each tile, the walls by edge, the doors and the props, built up
 * stage by stage and then handed out as a `Level`.
 */
export class Site {
    readonly tiles: FloorTile[][];
    /** The index in `rooms` of the room each tile belongs to, or -1 off the map. */
    readonly owner: number[][];
    readonly rooms: GenRoom[] = [];
    readonly walls = new Map<string, Wall>();
    readonly doors: Door[] = [];
    readonly props: LevelProp[] = [];

    constructor(readonly width: number, readonly height: number) {
        this.tiles = Array.from({ length: height }, () => Array.from({ length: width }, (): FloorTile => 'x'));
        this.owner = Array.from({ length: height }, () => Array.from({ length: width }, () => -1));
    }

    /**
     * Adds a room over `shape` (a rectangle, or the rectangles of an L or a notch, largest first), painting its floor
     * with its type's floor (or `floor`).
     */
    addRoom(type: RoomType, shape: Rect | Rect[], opts: { wing?: Wing; bank?: boolean; floor?: FloorTile; name?: string; known?: GenRoom['known'] } = {}): GenRoom {
        const rule = ROOM_RULES[type], index = this.rooms.length, parts = Array.isArray(shape) ? shape.map(p => ({ ...p })) : [{ ...shape }];
        const room: GenRoom = {
            id: `${type}-${index}`, type, name: opts.name ?? rule.name, zone: rule.zone, light: rule.light, ...boundingBox(parts), parts, wing: opts.wing ?? 'outside',
            bank: opts.bank ?? false, known: opts.known ?? (rule.zone === 'public' || rule.zone === 'outdoors' || !opts.bank ? 'blueprint' : 'outline')
        };
        this.rooms.push(room);
        for (const part of parts) this.paint(part, opts.floor ?? (rule.floor as FloorTile), index);
        return room;
    }

    /** The tiles of a room, row by row. */
    tilesOfRoom(room: GenRoom): { x: number; y: number }[] {
        const out: { x: number; y: number }[] = [], index = this.rooms.indexOf(room);
        for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) if (this.owner[y]![x] === index) out.push({ x, y });
        return out;
    }

    /** The rooms that share at least one edge with `room`. */
    neighbours(room: GenRoom): GenRoom[] {
        const seen = new Set<GenRoom>();
        for (const t of this.tilesOfRoom(room)) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const other = this.roomAt(t.x + dx, t.y + dy);
            if (other && other !== room) seen.add(other);
        }
        return [...seen];
    }

    /** Paints a floor over `rect`, optionally handing the tiles to room `index`. */
    paint(rect: Rect, floor: FloorTile, index?: number): void {
        for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
            if (!this.inside(x, y)) throw new Error(`Tile ${x},${y} is off the site`);
            this.tiles[y]![x] = floor;
            if (index !== undefined) this.owner[y]![x] = index;
        }
    }

    inside(x: number, y: number): boolean {
        return x >= 0 && y >= 0 && x < this.width && y < this.height;
    }

    roomAt(x: number, y: number): GenRoom | undefined {
        const i = this.inside(x, y) ? this.owner[y]![x]! : -1;
        return i >= 0 ? this.rooms[i] : undefined;
    }

    heightAt(x: number, y: number): number {
        return floorHeight(this.tiles, x, y);
    }

    wallAt(e: Edge): Wall | undefined {
        return this.walls.get(edgeKey(e));
    }

    setWall(e: Edge, kind: WallKind): void {
        this.walls.set(edgeKey(e), { kind, ...e });
    }

    clearWall(e: Edge): void {
        this.walls.delete(edgeKey(e));
    }

    /** Every edge between room `a` and room `b`, west to east or north to south along it. */
    sharedEdges(a: GenRoom, b: GenRoom): Edge[] {
        const out: Edge[] = [];
        const ia = this.rooms.indexOf(a), ib = this.rooms.indexOf(b);
        for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
            if (this.owner[y]![x] !== ia) continue;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                if (this.inside(x + dx, y + dy) && this.owner[y + dy]![x + dx] === ib) out.push(edgeBetween({ x, y }, { x: x + dx, y: y + dy }));
            }
        }
        return out.sort((p, q) => p.ty - q.ty || p.tx - q.tx);
    }

    /** Records a door between rooms `a` and `b` on edge `e`, with the wall kind that draws it (none for an opening). */
    addDoor(a: GenRoom, b: GenRoom, e: Edge, lock: Lock, kind: WallKind | undefined): Door {
        const door: Door = { id: `door-${this.doors.length}`, a: a.id, b: b.id, lock, ...e, ...(kind ? {} : { open: true }) };
        if (kind) this.setWall(e, kind);
        else this.clearWall(e);
        this.doors.push(door);
        return door;
    }

    room(id: string): GenRoom {
        const room = this.rooms.find(r => r.id === id);
        if (!room) throw new Error(`No room ${id}`);
        return room;
    }

    level(): Level {
        return { tiles: this.tiles.map(r => [...r]), walls: [...this.walls.values()].sort((a, b) => a.ty - b.ty || a.tx - b.tx || (a.run < b.run ? -1 : 1)) };
    }
}
