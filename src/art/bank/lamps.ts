import { TILE } from '../../level/constants';
import { isOffMap, isOutdoors, type Level, type Room } from '../../level/plan';
import { wallFootprint, type WallKind } from '../../level/walls';
import { PixelBitmap } from '../PixelBitmap';

/*
 * Lamp light, worked out once rather than by the engine's lights, so walls block it. Phaser's Light2D lights have no
 * occlusion: a lamp in the lobby lit the pavement through the shop front. Walls never move, so each lamp's reach is
 * traced against them once, a pixel at a time as it is first needed, and everything lit is baked with the same formula
 * Light2D uses (ambient plus, per light, colour × intensity × (1 - d²/r²) × the normal map's facing towards the light),
 * so baked and engine lighting look alike. The same reach answers which tiles are lit for the rules.
 */

/**
 * A light: where it is on screen (x, y, as for a Light2D light) and how high (z), and the floor point its light
 * spreads from, which walls are traced against. For a ceiling lamp that is the point under it; for a lamp on a prop,
 * the prop's footprint.
 */
export interface Lamp { x: number; y: number; z: number; radius: number; color: number; intensity: number; from: { x: number; y: number } }

/** Glass and see-through walls (a railing, a fence) let light through; every other wall stops it. */
const CLEAR: WallKind[] = ['window', 'doorGlass', 'curtain', 'doorTower', 'rail', 'fence', 'tellerWindow'];

/**
 * Pixels of the map that stop light (`blocks`: walls other than glass, and tiles off the map) and where lamp light
 * doesn't show (`drowned`: outdoors, where by day the sun drowns it).
 */
export function lightBlockers(level: Level): { width: number; height: number; blocks: Uint8Array; drowned: Uint8Array } {
    const width = level.tiles[0]!.length * TILE, height = level.tiles.length * TILE;
    const blocks = new Uint8Array(width * height), drowned = new Uint8Array(width * height);
    level.tiles.forEach((row, ty) => row.forEach((t, tx) => {
        const mask = isOffMap(t) ? blocks : isOutdoors(t) ? drowned : undefined;
        if (mask) for (let y = 0; y < TILE; y++) mask.fill(1, (ty * TILE + y) * width + tx * TILE, (ty * TILE + y) * width + (tx + 1) * TILE);
    }));
    for (const wall of level.walls) {
        if (CLEAR.includes(wall.kind)) continue;
        const f = wallFootprint(wall);
        for (let y = Math.max(0, f.y); y < Math.min(height, f.y + f.d); y++) blocks.fill(1, y * width + Math.max(0, f.x), y * width + Math.min(width, f.x + f.w));
    }
    return { width, height, blocks, drowned };
}

/**
 * Which floor pixels a lamp reaches: a square of `size` pixels round its floor point, its corner at (left, top), each
 * pixel 0 until it is first asked about, then `REACHED` or `UNREACHED`; and, per block of `BLOCK` pixels, whether the
 * block is open to the lamp (see `LampReach`).
 */
interface ReachMask { lamp: Lamp; left: number; top: number; size: number; seen: Uint8Array; open: Int8Array; ray: Ray }

/** A ray from a lamp's floor point (fx, fy) by (dx, dy) in `steps` steps, and the pixel it starts on. */
interface Ray { fx: number; fy: number; dx: number; dy: number; steps: number; startX: number; startY: number; startBlocked: number }

const REACHED = 1, UNREACHED = 2;
/** Below this many steps a stretch of a ray is marched pixel by pixel rather than split again. */
const MARCH_STEPS = 6;
/** Pixels round a lamp are traced in square blocks of this size. */
const BLOCK = 8;

/**
 * Which floor pixels each lamp reaches without its light crossing a wall. A ray marches from the lamp's floor point to the
 * pixel; rather than visit every step, it asks a summed-area table whether the rectangle round a stretch of steps holds a
 * blocking pixel, and splits only the stretches that do. A ray's steps never leave the rectangle round its ends, so the
 * answer is the same as marching all of them, at a fraction of the cost. A pixel is traced the first time it is asked
 * about, and only then: the light of a lamp hung high fades out well inside its radius, and no one asks past that.
 */
export class LampReach {
    private readonly masks = new Map<Lamp, ReachMask>();
    /** Blocking pixels in the rectangle from the map's corner to each pixel, in a grid one wider and taller than the map. */
    private readonly sums: Int32Array;

    constructor(private readonly blockers: ReturnType<typeof lightBlockers>, lamps: readonly Lamp[]) {
        this.sums = summedArea(blockers.blocks, blockers.width, blockers.height);
        for (const lamp of lamps) {
            const r = Math.ceil(lamp.radius), size = r * 2 + 1, blocks = Math.ceil(size / BLOCK);
            const ray: Ray = { fx: lamp.from.x, fy: lamp.from.y, dx: 0, dy: 0, steps: 0, startX: Math.floor(lamp.from.x), startY: Math.floor(lamp.from.y), startBlocked: 0 };
            ray.startBlocked = this.blocked(ray.startX, ray.startY) ? 1 : 0;
            const mask = { lamp, left: ray.startX - r, top: ray.startY - r, size, seen: new Uint8Array(size * size), open: new Int8Array(blocks * blocks).fill(-1), ray };
            this.masks.set(lamp, mask);
        }
    }

    /** True when the lamp's light reaches floor point (x, y) and shows there. Points outside its radius are never reached. */
    reaches(lamp: Lamp, x: number, y: number): boolean {
        const mask = this.mask(lamp);
        const mx = Math.floor(x) - mask.left, my = Math.floor(y) - mask.top;
        return mx >= 0 && my >= 0 && mx < mask.size && my < mask.size && this.reachesPixel(mask, mx, my);
    }

    /** The lamp's reach, for code that tests many points against it with `reachesPixel`. */
    mask(lamp: Lamp): ReachMask {
        const mask = this.masks.get(lamp);
        if (!mask) throw new Error('A lamp that was never traced');
        return mask;
    }

    /** Whether the lamp reaches pixel (i, j) of its mask, tracing it if this is the first time it is asked. */
    reachesPixel(mask: ReachMask, i: number, j: number): boolean {
        const at = j * mask.size + i;
        if (mask.seen[at] === 0) mask.seen[at] = this.trace(mask, i, j) ? REACHED : UNREACHED;
        return mask.seen[at] === REACHED;
    }

    /** Marches from the lamp's floor point to pixel (i, j) of its mask; a blocking pixel on the way (not counting the start) stops it. */
    private trace(mask: ReachMask, i: number, j: number): boolean {
        const { width, height, blocks, drowned } = this.blockers, { lamp, ray } = mask;
        const px = mask.left + i, py = mask.top + j, dx = px + 0.5 - ray.fx, dy = py + 0.5 - ray.fy;
        if (dx * dx + dy * dy > lamp.radius * lamp.radius) return false;
        if (px < 0 || py < 0 || px >= width || py >= height || blocks[py * width + px] === 1 || drowned[py * width + px] === 1) return false;
        // A block of pixels whose rectangle with the start (and a pixel's margin) holds no wall is open: every ray into it
        // is clear, unmarched. That is most of a lamp's own room.
        const b = Math.floor(j / BLOCK) * Math.ceil(mask.size / BLOCK) + Math.floor(i / BLOCK);
        if (mask.open[b] === -1) {
            const x0 = Math.min(mask.left + i - (i % BLOCK) - 1, ray.startX), x1 = Math.max(mask.left + i - (i % BLOCK) + BLOCK, ray.startX);
            const y0 = Math.min(mask.top + j - (j % BLOCK) - 1, ray.startY), y1 = Math.max(mask.top + j - (j % BLOCK) + BLOCK, ray.startY);
            mask.open[b] = this.wallsIn(ray, x0, y0, x1, y1) === 0 ? 1 : 0;
        }
        if (mask.open[b] === 1) return true;
        ray.dx = dx;
        ray.dy = dy;
        ray.steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2);
        return ray.steps < 1 || this.clear(ray, 1, ray.steps);
    }

    /** Blocking pixels in the rectangle (x0, y0) to (x1, y1), the ray's start not counting; off the map, more than none. */
    private wallsIn(ray: Ray, x0: number, y0: number, x1: number, y1: number): number {
        const { width, height } = this.blockers;
        if (x0 < 0 || y0 < 0 || x1 >= width || y1 >= height) return Infinity;
        const row = width + 1, sums = this.sums;
        const count = sums[(y1 + 1) * row + x1 + 1]! - sums[y0 * row + x1 + 1]! - sums[(y1 + 1) * row + x0]! + sums[y0 * row + x0]!;
        return ray.startX >= x0 && ray.startX <= x1 && ray.startY >= y0 && ray.startY <= y1 ? count - ray.startBlocked : count;
    }

    private blocked(x: number, y: number): boolean {
        const { width, height, blocks } = this.blockers;
        return x < 0 || y < 0 || x >= width || y >= height || blocks[y * width + x] === 1;
    }

    /** Whether steps `from` to `to` of the ray all miss blocking pixels, the pixel it starts on not counting. */
    private clear(ray: Ray, from: number, to: number): boolean {
        const ax = Math.floor(ray.fx + (ray.dx * from) / ray.steps), ay = Math.floor(ray.fy + (ray.dy * from) / ray.steps);
        const bx = Math.floor(ray.fx + (ray.dx * to) / ray.steps), by = Math.floor(ray.fy + (ray.dy * to) / ray.steps);
        // Off the map counts as blocked, which the table doesn't know: such a stretch is split or marched.
        if (this.wallsIn(ray, Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)) === 0) return true;
        if (to - from < MARCH_STEPS) {
            for (let s = from; s <= to; s++) {
                const px = Math.floor(ray.fx + (ray.dx * s) / ray.steps), py = Math.floor(ray.fy + (ray.dy * s) / ray.steps);
                if (px === ray.startX && py === ray.startY) continue;
                if (this.blocked(px, py)) return false;
            }
            return true;
        }
        const mid = (from + to) >> 1;
        return this.clear(ray, from, mid) && this.clear(ray, mid + 1, to);
    }
}

/** Sums of `mask` over the rectangle from (0, 0) up to each pixel, exclusive, in a grid one wider and taller than it. */
function summedArea(mask: Uint8Array, width: number, height: number): Int32Array {
    const row = width + 1, sums = new Int32Array(row * (height + 1));
    for (let y = 0; y < height; y++) {
        let line = 0;
        for (let x = 0; x < width; x++) {
            line += mask[y * width + x]!;
            sums[(y + 1) * row + x + 1] = sums[y * row + x + 1]! + line;
        }
    }
    return sums;
}

const channels = (c: number) => [((c >> 16) & 0xff) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255] as const;

/** An RGB exposure factor at a screen point (see `buildExposure`). */
export type Exposure = (x: number, y: number) => readonly [number, number, number];

/** An exposure for every floor pixel, three factors each (`buildExposure`); a point off the map takes the nearest edge's. */
export interface ExposureMap { width: number; height: number; rgb: Float32Array }

/** Which lamps light a point: a test per lamp and point, or the lamps' traced reach itself. */
export type Reach = ((lamp: Lamp, x: number, y: number) => boolean) | LampReach;

/** Lamps are sorted into square cells of this size, so each pixel only weighs the lamps that can reach it. */
const CELL = 32;

/**
 * Bakes the lighting of a bitmap drawn with its top-left corner at screen (left, top), as Light2D would light it, but
 * only by the lamps `reaches` lets through for each of its pixels, then exposes it (`exposure`). The lit colour clamps
 * before exposure, as the framebuffer did when lighting ran at half exposure on the GPU. Returns RGBA, alpha kept. Pass
 * the bitmap's `normals` when relighting it often, as something moving is; without them, only the pixels a lamp falls
 * on have their normal worked out. Something standing lit the same all over is baked fastest by passing only the lamps
 * that reach it and a `reaches` that lets them all through.
 */
export function bakeLighting(
    bitmap: PixelBitmap, left: number, top: number, ambient: number, lamps: readonly Lamp[], reaches: Reach, exposure: Exposure | ExposureMap, normals?: Uint8ClampedArray
): Uint8ClampedArray {
    const { width, height, colors } = bitmap, out = new Uint8ClampedArray(colors);
    const [baseR, baseG, baseB] = channels(ambient);
    // The inner loop runs per pixel and lamp, so each lamp's terms sit in flat arrays, indexed by its place in `lamps`.
    const n = lamps.length, lx = new Float64Array(n), ly = new Float64Array(n), lz = new Float64Array(n), r2 = new Float64Array(n);
    const tintR = new Float64Array(n), tintG = new Float64Array(n), tintB = new Float64Array(n);
    lamps.forEach((l, k) => {
        lx[k] = l.x;
        ly[k] = l.y;
        lz[k] = l.z;
        r2[k] = l.radius * l.radius;
        [tintR[k], tintG[k], tintB[k]] = channels(l.color).map(c => c * l.intensity) as [number, number, number];
    });
    const masks = reaches instanceof LampReach ? lamps.map(l => reaches.mask(l)) : undefined;
    const test = reaches instanceof LampReach ? undefined : reaches;
    const cols = Math.ceil(width / CELL), cells: number[][] = [];
    for (let cy = 0; cy < Math.ceil(height / CELL); cy++) for (let cx = 0; cx < cols; cx++) {
        const x0 = left + cx * CELL, y0 = top + cy * CELL, cell: number[] = [];
        lamps.forEach((l, k) => {
            if (l.x + l.radius > x0 && l.x - l.radius < x0 + CELL && l.y + l.radius > y0 && l.y - l.radius < y0 + CELL) cell.push(k);
        });
        cells.push(cell);
    }
    const map = typeof exposure === 'function' ? undefined : exposure, normal = new Uint8ClampedArray(4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (colors[i * 4 + 3] === 0) continue;
        // The normal, once a lamp falls on the pixel. The normal map is encoded with +Y up; the screen's y runs down.
        let nx = NaN, ny = NaN, nz = NaN;
        let lightR = baseR, lightG = baseG, lightB = baseB;
        const sx = left + x + 0.5, sy = top + y + 0.5;
        for (const k of cells[Math.floor(y / CELL) * cols + Math.floor(x / CELL)]!) {
            const dx = lx[k]! - sx, dy = ly[k]! - sy, dz = lz[k]!;
            const d2 = dx * dx + dy * dy + dz * dz;
            const attenuation = 1 - d2 / r2[k]!;
            if (attenuation <= 0) continue;
            if (masks) {
                const m = masks[k]!, mx = Math.floor(sx) - m.left, my = Math.floor(sy) - m.top;
                if (mx < 0 || my < 0 || mx >= m.size || my >= m.size || !(reaches as LampReach).reachesPixel(m, mx, my)) continue;
            } else if (!test!(lamps[k]!, sx, sy)) continue;
            if (Number.isNaN(nx)) {
                const from = normals ?? normal, at = normals ? i * 4 : 0;
                if (!normals) bitmap.normalAt(x, y, normal, 0);
                nx = (from[at]! / 255) * 2 - 1;
                ny = -((from[at + 1]! / 255) * 2 - 1);
                nz = (from[at + 2]! / 255) * 2 - 1;
            }
            const facing = Math.max(0, (nx * dx + ny * dy + nz * dz) / Math.sqrt(d2));
            lightR += tintR[k]! * attenuation * facing;
            lightG += tintG[k]! * attenuation * facing;
            lightB += tintB[k]! * attenuation * facing;
        }
        let er: number, eg: number, eb: number;
        if (map) {
            const e = (Math.min(map.height - 1, Math.max(0, Math.floor(sy))) * map.width + Math.min(map.width - 1, Math.max(0, Math.floor(sx)))) * 3;
            er = map.rgb[e]!;
            eg = map.rgb[e + 1]!;
            eb = map.rgb[e + 2]!;
        } else {
            const e = (exposure as Exposure)(sx, sy);
            er = e[0];
            eg = e[1];
            eb = e[2];
        }
        out[i * 4] = Math.min(255, colors[i * 4]! * lightR) * er;
        out[i * 4 + 1] = Math.min(255, colors[i * 4 + 1]! * lightG) * eg;
        out[i * 4 + 2] = Math.min(255, colors[i * 4 + 2]! * lightB) * eb;
    }
    return out;
}

/** Ceiling lights by kind: colour, intensity, height, and how far one reaches for the spacing it is hung at. */
const LIGHTS: Record<Exclude<Room['light'], 'none'>, { color: number; intensity: number; z: number; reach: number }> = {
    warm: { color: 0xffd8b0, intensity: 1.3, z: 48, reach: 0.85 },
    bright: { color: 0xffdcb8, intensity: 1.6, z: 50, reach: 0.95 },
    cool: { color: 0xdde6ff, intensity: 1.1, z: 40, reach: 0.85 },
    dim: { color: 0xffc890, intensity: 0.8, z: 36, reach: 0.75 }
};

/**
 * Ceiling lamps for every lit room, hung on a grid about five tiles apart and reaching about as far as their spacing,
 * so pools overlap a little and leave darker floor between them. A room made of several rectangles (an L, a room with
 * a notch) gets a grid in each, so every lamp hangs over the room's own floor and none over its neighbour's.
 */
export function roomLamps(rooms: readonly Room[]): Lamp[] {
    return rooms.flatMap(room => {
        if (room.light === 'none') return [];
        const kind = LIGHTS[room.light];
        return (room.parts ?? [room]).flatMap(part => {
            const nx = Math.max(1, Math.round(part.w / 5)), ny = Math.max(1, Math.round(part.h / 5));
            const cellW = part.w / nx, cellH = part.h / ny;
            const radius = Math.min(80, Math.max(40, Math.max(cellW, cellH) * TILE * kind.reach));
            return Array.from({ length: nx * ny }, (_, k) => {
                const x = (part.x + cellW * ((k % nx) + 0.5)) * TILE, y = (part.y + cellH * (Math.floor(k / nx) + 0.5)) * TILE;
                return { x, y, z: kind.z, radius, color: kind.color, intensity: kind.intensity, from: { x, y } };
            });
        });
    });
}

/**
 * Daylight bouncing off the floor just inside the street glass: a soft patch two tiles in behind each run of windows.
 * Behind the bank's front (`side` north: the building lies north of the line) it is warm and leans up and to the left
 * with the sun; behind a front facing away from the sun it is cool sky light.
 */
export function windowPatches(level: Level, line: number, side: 'north' | 'south' = 'north'): Lamp[] {
    const glass = level.walls.filter(w => w.run === 'eastWest' && w.ty * TILE === line && GLASS.includes(w.kind)).map(w => w.tx).sort((a, b) => a - b);
    const runs: number[][] = [];
    for (const tx of glass) {
        const run = runs.at(-1);
        if (run && run.at(-1) === tx - 1) run.push(tx);
        else runs.push([tx]);
    }
    // Sunlight through the bank's front lands warm; a front facing away from the sun lets in cool sky light.
    const into = side === 'north' ? -1 : 1, color = side === 'north' ? 0xffd9a0 : 0xd8e4ff;
    return runs.map(run => {
        const lean = side === 'north' ? 20 : 0, x = ((run[0]! + run.at(-1)! + 1) / 2) * TILE - lean, y = line + into * 2 * TILE;
        return { x, y, z: 30, radius: 52, color, intensity: side === 'north' ? 0.6 : 0.45, from: { x: x + lean, y: y - into * 8 } };
    });
}

/** Glass in a front: windows, glass doors, curtain walls and a drive-through's teller window. */
const GLASS: WallKind[] = ['window', 'doorGlass', 'curtain', 'doorTower', 'tellerWindow'];

/**
 * How much lamp light reaches the middle of each tile, on the scale of a lamp's intensity (a flat floor right under a
 * full-strength lamp is about its intensity). For the rules: a tile is lit when this reaches `LIT`.
 */
export function tileLight(level: Level, lamps: readonly Lamp[], reach: LampReach): number[][] {
    return level.tiles.map((row, ty) => row.map((_, tx) => {
        const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
        let total = 0;
        for (const lamp of lamps) {
            const dx = lamp.x - x, dy = lamp.y - y, d2 = dx * dx + dy * dy + lamp.z * lamp.z;
            const attenuation = 1 - d2 / (lamp.radius * lamp.radius);
            if (attenuation > 0 && reach.reaches(lamp, x, y)) total += lamp.intensity * attenuation * (lamp.z / Math.sqrt(d2));
        }
        return total;
    }));
}

export const LIT = 0.25;
