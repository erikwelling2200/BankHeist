import { TILE } from '../../level/level';
import { isOffMap, isOutdoors, type Lobby } from '../../level/lobby';
import { wallFootprint, type WallKind } from '../../level/walls';
import { PixelBitmap } from '../PixelBitmap';

/*
 * Lamp light, worked out once rather than by the engine's lights, so walls block it. Phaser's Light2D lights have no
 * occlusion: a lamp in the lobby lit the pavement through the shop front. Walls never move, so each lamp's reach is
 * traced against them when the level loads, and everything lit is baked with the same formula Light2D uses (ambient
 * plus, per light, colour × intensity × (1 - d²/r²) × the normal map's facing towards the light), so baked and engine
 * lighting look alike. The same reach answers which tiles are lit for the rules.
 */

/**
 * A light: where it is on screen (x, y, as for a Light2D light) and how high (z), and the floor point its light
 * spreads from, which walls are traced against. For a ceiling lamp that is the point under it; for a lamp on a prop,
 * the prop's footprint.
 */
export interface Lamp { x: number; y: number; z: number; radius: number; color: number; intensity: number; from: { x: number; y: number } }

/** Glass lets light through; every other wall stops it. */
const CLEAR: WallKind[] = ['window', 'doorGlass'];

/**
 * Pixels of the map that stop light (`blocks`: walls other than glass, and tiles off the map) and where lamp light
 * doesn't show (`drowned`: outdoors, where by day the sun drowns it).
 */
export function lightBlockers(level: Lobby): { width: number; height: number; blocks: Uint8Array; drowned: Uint8Array } {
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

/** Which floor pixels each lamp reaches without its light crossing a wall, traced once per lamp. */
export class LampReach {
    private readonly masks = new Map<Lamp, { left: number; top: number; size: number; seen: Uint8Array }>();

    constructor(private readonly blockers: ReturnType<typeof lightBlockers>, lamps: readonly Lamp[]) {
        for (const lamp of lamps) this.masks.set(lamp, this.trace(lamp));
    }

    /** True when the lamp's light reaches floor point (x, y) and shows there. Points outside its radius are never reached. */
    reaches(lamp: Lamp, x: number, y: number): boolean {
        const mask = this.masks.get(lamp);
        if (!mask) throw new Error('A lamp that was never traced');
        const mx = Math.floor(x) - mask.left, my = Math.floor(y) - mask.top;
        return mx >= 0 && my >= 0 && mx < mask.size && my < mask.size && mask.seen[my * mask.size + mx] === 1;
    }

    /** Marches from the lamp's floor point to every pixel in its radius; a blocking pixel on the way (not counting the start) stops it. */
    private trace(lamp: Lamp): { left: number; top: number; size: number; seen: Uint8Array } {
        const { width, height, blocks } = this.blockers;
        const r = Math.ceil(lamp.radius), size = r * 2 + 1, left = Math.floor(lamp.from.x) - r, top = Math.floor(lamp.from.y) - r;
        const seen = new Uint8Array(size * size);
        const { drowned } = this.blockers;
        const blocked = (x: number, y: number) => x < 0 || y < 0 || x >= width || y >= height || blocks[y * width + x] === 1;
        const fx = lamp.from.x, fy = lamp.from.y, start = [Math.floor(fx), Math.floor(fy)] as const;
        for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
            const tx = left + i + 0.5, ty = top + j + 0.5, dx = tx - fx, dy = ty - fy;
            if (dx * dx + dy * dy > lamp.radius * lamp.radius) continue;
            const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2);
            let clear = true;
            for (let s = 1; s <= steps && clear; s++) {
                const px = Math.floor(fx + (dx * s) / steps), py = Math.floor(fy + (dy * s) / steps);
                if (px === start[0] && py === start[1]) continue;
                if (blocked(px, py)) clear = false;
            }
            const px = left + i, py = top + j;
            if (clear && !blocked(px, py) && drowned[py * width + px] !== 1) seen[j * size + i] = 1;
        }
        return { left, top, size, seen };
    }
}

const channels = (c: number) => [((c >> 16) & 0xff) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255] as const;

/**
 * Bakes the lighting of a bitmap drawn with its top-left corner at screen (left, top), as Light2D would light it, but
 * only by the lamps `reaches` lets through for each of its pixels. Returns the lit colours (RGBA, alpha kept). Pass the
 * bitmap's `normals` when relighting it often, as something moving is.
 */
export function bakeLighting(bitmap: PixelBitmap, left: number, top: number, ambient: number, lamps: readonly Lamp[], reaches: (lamp: Lamp, x: number, y: number) => boolean, normals = bitmap.normalMap()): Uint8ClampedArray {
    const out = new Uint8ClampedArray(bitmap.colors);
    const base = channels(ambient);
    const near = lamps.filter(l => l.x + l.radius > left && l.x - l.radius < left + bitmap.width && l.y + l.radius > top && l.y - l.radius < top + bitmap.height);
    const tints = near.map(l => channels(l.color).map(c => c * l.intensity));
    for (let y = 0; y < bitmap.height; y++) for (let x = 0; x < bitmap.width; x++) {
        const i = y * bitmap.width + x;
        if (bitmap.colors[i * 4 + 3] === 0) continue;
        // The normal map is encoded with +Y up; the screen's y runs down.
        const nx = (normals[i * 4]! / 255) * 2 - 1, ny = -((normals[i * 4 + 1]! / 255) * 2 - 1), nz = (normals[i * 4 + 2]! / 255) * 2 - 1;
        const light = [base[0], base[1], base[2]];
        const sx = left + x + 0.5, sy = top + y + 0.5;
        near.forEach((lamp, k) => {
            const dx = lamp.x - sx, dy = lamp.y - sy, dz = lamp.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            const attenuation = 1 - d2 / (lamp.radius * lamp.radius);
            if (attenuation <= 0 || !reaches(lamp, sx, sy)) return;
            const facing = Math.max(0, (nx * dx + ny * dy + nz * dz) / Math.sqrt(d2));
            const tint = tints[k]!;
            for (let c = 0; c < 3; c++) light[c]! += tint[c]! * attenuation * facing;
        });
        for (let c = 0; c < 3; c++) out[i * 4 + c] = bitmap.colors[i * 4 + c]! * light[c]!;
    }
    return out;
}

/**
 * How much lamp light reaches the middle of each tile, on the scale of a lamp's intensity (a flat floor right under a
 * full-strength lamp is about its intensity). For the rules: a tile is lit when this reaches `LIT`.
 */
export function tileLight(level: Lobby, lamps: readonly Lamp[], reach: LampReach): number[][] {
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
