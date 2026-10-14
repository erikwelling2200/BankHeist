import type { WallKind } from '../level/walls';
import type { Furnisher } from './furnish';
import type { Door, GenRoom } from './model';
import { edgeBetween, edgeKey, MAX_STEP, type Site } from './site';

/*
 * Moving and seeing on the generated level (§14.1): walls stop movement and sight along their edge, doors let people
 * through (whatever their lock: the keys exist, §15.2), glass and railings let sight through, furniture that stands
 * in the way blocks a tile, and nobody climbs more than a step without stairs. Used to lay out routes and patrols and
 * to check the rules of §17.7.
 */

export interface P { x: number; y: number }

/** What sight passes through (§8.3): glass, railings, a chain-link fence; closed doors and walls block it. */
const SEE_THROUGH: readonly WallKind[] = ['window', 'doorGlass', 'curtain', 'doorTower', 'rail', 'fence', 'tellerWindow'];

export class Nav {
    private readonly blockedTiles: Uint8Array;
    private readonly doorAt = new Map<string, Door>();

    constructor(readonly site: Site, furnish: Furnisher, gate?: P) {
        const { width, height } = site;
        this.blockedTiles = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            if (site.owner[y]![x]! < 0 || (furnish.blocked(x, y) && !(gate && gate.x === x && gate.y === y))) this.blockedTiles[y * width + x] = 1;
        }
        for (const d of site.doors) this.doorAt.set(edgeKey(d), d);
    }

    walkable(x: number, y: number): boolean {
        return this.site.inside(x, y) && !this.blockedTiles[y * this.site.width + x];
    }

    /** The door on the edge between two neighbouring tiles, if there is one. */
    door(a: P, b: P): Door | undefined {
        return this.doorAt.get(edgeKey(edgeBetween(a, b)));
    }

    /** Whether a person can step from `a` to its neighbour `b`; `through` decides which doors they may use. */
    step(a: P, b: P, through: (d: Door) => boolean = () => true): boolean {
        if (!this.walkable(b.x, b.y) || !this.walkable(a.x, a.y)) return false;
        if (Math.abs(this.site.heightAt(a.x, a.y) - this.site.heightAt(b.x, b.y)) > MAX_STEP) return false;
        const e = edgeBetween(a, b), wall = this.site.wallAt(e), door = this.doorAt.get(edgeKey(e));
        if (door) return through(door);
        return !wall;
    }

    /**
     * Breadth-first distances from `starts`. A door crossing costs `doorCost` extra (0 for plain distance; set it high
     * and read `doors` to count the fewest doors).
     */
    distances(starts: P[], opts: { through?: (d: Door) => boolean; doorCost?: number } = {}): { dist: Int32Array; doors: Int32Array } {
        const { width, height } = this.site, through = opts.through ?? (() => true);
        const dist = new Int32Array(width * height).fill(-1), doors = new Int32Array(width * height).fill(-1);
        // Zero-one search on (doors crossed, then steps): a deque of tiles in a buffer twice the map's size.
        const n = width * height, buffer = new Int32Array(4 * n + 8);
        let head = 2 * n + 4, tail = head;
        for (const s of starts) if (this.walkable(s.x, s.y)) { dist[s.y * width + s.x] = 0; doors[s.y * width + s.x] = 0; buffer[tail++] = s.y * width + s.x; }
        const byDoors = (opts.doorCost ?? 0) > 0;
        while (head < tail) {
            const i = buffer[head++]!, x = i % width, y = Math.floor(i / width);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= width || ny >= height || !this.step({ x, y }, { x: nx, y: ny }, through)) continue;
                const j = ny * width + nx, crossed = this.door({ x, y }, { x: nx, y: ny }) ? 1 : 0;
                const nd = doors[i]! + crossed, ns = dist[i]! + 1;
                const better = doors[j] === -1 || (byDoors ? nd < doors[j]! || (nd === doors[j]! && ns < dist[j]!) : ns < dist[j]!);
                if (!better) continue;
                doors[j] = nd;
                dist[j] = ns;
                if (byDoors && !crossed) buffer[--head] = j;
                else if (tail < buffer.length) buffer[tail++] = j;
            }
        }
        return { dist, doors };
    }

    /** A shortest path from `a` to `b` (tile by tile), or undefined. */
    path(a: P, b: P, through?: (d: Door) => boolean): P[] | undefined {
        const { dist } = this.distances([b], { through });
        const width = this.site.width;
        if (dist[a.y * width + a.x] === -1) return undefined;
        const out: P[] = [a];
        let cur = a;
        while (cur.x !== b.x || cur.y !== b.y) {
            const d = dist[cur.y * width + cur.x]!;
            const next = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([dx, dy]) => ({ x: cur.x + dx, y: cur.y + dy }))
                .find(n => this.site.inside(n.x, n.y) && dist[n.y * width + n.x] === d - 1 && this.step(cur, n, through ?? (() => true)));
            if (!next) return undefined;
            out.push(next);
            cur = next;
        }
        return out;
    }

    /** The walkable tiles of a room. */
    tilesOf(room: GenRoom): P[] {
        const out: P[] = [];
        for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) if (this.walkable(x, y) && this.site.roomAt(x, y) === room) out.push({ x, y });
        return out;
    }

    /**
     * Whether an observer at `from` sees tile `to` (§8.3): the line between their middles crosses no wall that blocks
     * sight, and no full-height furniture (low furniture doesn't block, and nothing does for an observer up high).
     */
    sees(from: P, to: P, tall: (x: number, y: number) => boolean): boolean {
        const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) * 3;
        let prev = { x: from.x, y: from.y };
        for (let i = 1; i <= steps; i++) {
            const t = i / steps, x = Math.round(from.x + (to.x - from.x) * t), y = Math.round(from.y + (to.y - from.y) * t);
            if (x === prev.x && y === prev.y) continue;
            // A diagonal step crosses two edges; both have to be clear.
            const mids = x !== prev.x && y !== prev.y ? [[{ x: prev.x, y: prev.y }, { x, y: prev.y }, { x, y }], [{ x: prev.x, y: prev.y }, { x: prev.x, y }, { x, y }]] : [[prev, { x, y }]];
            const clear = mids.some(chain => chain.every((p, k) => k === 0 || this.seeThrough(chain[k - 1]!, p)));
            if (!clear) return false;
            if ((x !== to.x || y !== to.y) && tall(x, y)) return false;
            prev = { x, y };
        }
        return true;
    }

    private seeThrough(a: P, b: P): boolean {
        if (!this.site.inside(b.x, b.y) || this.site.owner[b.y]![b.x]! < 0) return false;
        const wall = this.site.wallAt(edgeBetween(a, b));
        return !wall || SEE_THROUGH.includes(wall.kind);
    }
}
