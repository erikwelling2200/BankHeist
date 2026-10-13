import { TILE } from '../../level/level';
import { isOffMap, isOutdoors, type Lobby } from '../../level/lobby';
import { wallFootprint, type Wall, type WallKind } from '../../level/walls';
import { bayer4 } from '../random';

/** Something standing on the floor: it darkens the floor under it and blocks sun shafts up to its height. */
export interface Occluder { x: number; y: number; w: number; h: number; height: number }

/** An outdoor object that casts a sun shadow: its opaque pixels, placed in map pixels, standing on `base`. */
export interface Caster { left: number; top: number; width: number; height: number; base: number; opaque: (x: number, y: number) => boolean }

export interface LightMaps {
    width: number;
    height: number;
    /** Multiply layer: 255 leaves the floor as is, lower darkens it (ambient occlusion and contact shadows). */
    shade: Uint8ClampedArray;
    /** Additive layer: warm sunlight falling through the façade glass. */
    glow: Uint8ClampedArray;
}

/** The sun is low in the south-east: shafts run up the screen and lean left by this many pixels per pixel. */
export const SUN_SLANT = 0.38;
/** Outdoors, a pixel `h` above the ground casts onto the ground `h * SHADOW_LENGTH` up the screen, leaning with the shafts. */
const SHADOW_LENGTH = 0.6;
const SUN_SHADOW = 0.62;
const SHAFT_LENGTH = 78;
const SUN = [255, 214, 158] as const;

const SHADE_BANDS = [1, 0.92, 0.82, 0.7, 0.58];
/** How much daylight survives indoors, deep in the room and right behind the glass. */
const ROOF_DEEP = 0.37;
const ROOF_WINDOW = 0.47;
const WINDOW_REACH = 80;

/** Quantises `value` (0 = no effect, 1 = full) into `bands` steps, dithering only in a thin strip where steps meet. */
function band(value: number, bands: number, x: number, y: number): number {
    const scaled = value * bands;
    const lower = Math.floor(scaled);
    const frac = scaled - lower;
    // Only the 20% nearest the step boundary is dithered; the rest stays flat.
    const edge = frac > 0.8 ? (frac - 0.8) / 0.2 : 0;
    return Math.min(bands, lower + (edge > bayer4(x, y) ? 1 : 0)) / bands;
}

/** Glass columns in a façade segment that let light through; frames and the window's mullion block it. */
function glassAt(kind: WallKind, px: number): boolean {
    if (kind === 'window') return px >= 1 && px <= 14 && px !== 8;
    if (kind === 'doorGlass') return px >= 1 && px <= 14;
    return false;
}

/** The shop front: the east-west segments with the street on their south side, and the line they stand on. */
export function facade(level: Lobby): { walls: Wall[]; line: number } {
    const walls = level.walls.filter(w => w.run === 'eastWest' && isOutdoors(level.tiles[w.ty]![w.tx]!) && !isOutdoors(level.tiles[w.ty - 1]![w.tx]!));
    if (!walls.length) throw new Error('The level has no shop front');
    return { walls, line: walls[0]!.ty * TILE };
}

/** Pixels taken by walls, and by tiles off the map. */
function solidMask(level: Lobby, width: number, height: number): Uint8Array {
    const mask = new Uint8Array(width * height);
    level.tiles.forEach((row, ty) => row.forEach((t, tx) => {
        if (isOffMap(t)) for (let y = 0; y < TILE; y++) mask.fill(1, (ty * TILE + y) * width + tx * TILE, (ty * TILE + y) * width + tx * TILE + TILE);
    }));
    for (const wall of level.walls) {
        const f = wallFootprint(wall);
        for (let y = Math.max(0, f.y); y < Math.min(height, f.y + f.d); y++) for (let x = Math.max(0, f.x); x < Math.min(width, f.x + f.w); x++) mask[y * width + x] = 1;
    }
    return mask;
}

export function buildLightMaps(level: Lobby, occluders: Occluder[], casters: Caster[]): LightMaps {
    const tiles = level.tiles, rows = tiles.length, cols = tiles[0]!.length;
    const width = cols * TILE, height = rows * TILE;
    const shade = new Uint8ClampedArray(width * height * 4);
    const glow = new Uint8ClampedArray(width * height * 4);
    const solid = solidMask(level, width, height);
    const structureAt = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && solid[y * width + x] === 1;

    // Ambient occlusion: floor darkens close to the foot of walls.
    const ao = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (structureAt(x, y)) continue;
        let d = 6;
        for (let r = 1; r < 6 && d === 6; r++) {
            if (structureAt(x - r, y) || structureAt(x + r, y) || structureAt(x, y - r) || structureAt(x, y + r)) d = r;
        }
        ao[y * width + x] = d >= 6 ? 0 : (6 - d) / 6 * 0.55;
    }
    // Contact shadows under furniture and people: a soft oval over the footprint.
    const footprint = new Float32Array(width * height);
    const blockHeight = new Float32Array(width * height);
    for (const o of occluders) {
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        for (let y = Math.floor(o.y - 2); y < o.y + o.h + 2; y++) for (let x = Math.floor(o.x - 2); x < o.x + o.w + 2; x++) {
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const dx = (x + 0.5 - cx) / (o.w / 2 + 2), dy = (y + 0.5 - cy) / (o.h / 2 + 1.5);
            const r = Math.sqrt(dx * dx + dy * dy);
            if (r < 1) footprint[y * width + x] = Math.max(footprint[y * width + x]!, (1 - r * r) * 0.9 + 0.25);
        }
        for (let y = Math.floor(o.y); y < o.y + o.h; y++) for (let x = Math.floor(o.x); x < o.x + o.w; x++) {
            if (x >= 0 && y >= 0 && x < width && y < height) blockHeight[y * width + x] = Math.max(blockHeight[y * width + x]!, o.height);
        }
    }

    const front = facade(level);
    const facadeY = front.line;
    const glassKind = (x: number) => front.walls.find(w => w.tx === Math.floor(x / TILE))?.kind;
    const outdoors = (x: number, y: number) => {
        const t = tiles[Math.floor(y / TILE)]?.[Math.floor(x / TILE)];
        return t !== undefined && isOutdoors(t);
    };
    const sunShadow = castSunShadows(casters, width, height, (x, y) => outdoors(x, y) && !structureAt(x, y));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const occlusion = Math.min(1, ao[i]! + footprint[i]!);
        const level = band(occlusion, SHADE_BANDS.length - 1, x, y);
        const s = Math.round(255 * SHADE_BANDS[Math.round(level * (SHADE_BANDS.length - 1))]! * (sunShadow[i] ? SUN_SHADOW : 1));
        shade.set([s, s, s, 255], i * 4);

        let sun = 0;
        if (y < facadeY && !structureAt(x, y) && !outdoors(x, y)) {
            const dist = facadeY - y;
            const sx = Math.round(x + dist * SUN_SLANT);
            const kind = glassKind(sx);
            if (dist < SHAFT_LENGTH && kind && glassAt(kind, sx - Math.floor(sx / TILE) * TILE) && !sunBlocked(x, y, dist, blockHeight, width)) {
                const t = dist / SHAFT_LENGTH;
                // The far end of the shaft is the top of the glass, where the blinds stripe it.
                const blinds = t > 0.72 && Math.floor(dist / 2) % 2 === 0;
                sun = blinds ? 0 : t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
            }
        }
        const lit = sun > 0 ? band(sun, 3, x, y) : 0;
        const a = lit * 0.22;
        glow.set([SUN[0] * a, SUN[1] * a, SUN[2] * a, 255], i * 4);
    }
    return { width, height, shade, glow };
}

/**
 * Exposure layer, applied as a 2x multiply over the whole frame (see LobbyScene): 255 doubles a pixel, which is full
 * daylight on the half-exposed street; lower values are the building's own shade indoors, lifting towards the street
 * glass. Rendering at half exposure first leaves lamps headroom before the framebuffer clamps. Everything on screen
 * above `facadeTop`, the top of the shop front as it is drawn, is under the roof; the façade itself faces the street.
 */
export function buildExposure(level: Lobby, facadeTop: number): Uint8ClampedArray {
    const width = level.tiles[0]!.length * TILE, height = level.tiles.length * TILE;
    const facadeY = facade(level).line;
    const exposure = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let r = 1;
        if (y < facadeTop) {
            const near = Math.max(0, 1 - (facadeY - y) / WINDOW_REACH);
            r = ROOF_DEEP + (ROOF_WINDOW - ROOF_DEEP) * band(near, 4, x, y);
        }
        // Indoors stays a touch cool against the warm sun outside.
        const cool = r < 1 ? [0.9, 0.95, 1] : [1, 1, 1];
        exposure.set([255 * r * cool[0]!, 255 * r * cool[1]!, 255 * r * cool[2]!, 255], (y * width + x) * 4);
    }
    return exposure;
}

/** Marches from a floor pixel towards the sun; anything tall enough on the way casts it into shadow. */
function sunBlocked(x: number, y: number, dist: number, blockHeight: Float32Array, width: number): boolean {
    for (let t = 1; t < Math.min(dist, 40); t++) {
        const qx = Math.round(x + t * SUN_SLANT), qy = y + t;
        const h = blockHeight[qy * width + qx];
        if (h && h * 0.9 >= t) return true;
    }
    return false;
}

/** Projects every caster pixel onto the ground along the sun direction; `receives` limits shadows to open ground outdoors. */
function castSunShadows(casters: Caster[], width: number, height: number, receives: (x: number, y: number) => boolean): Uint8Array {
    const mask = new Uint8Array(width * height);
    for (const c of casters) for (let py = 0; py < c.height; py++) for (let px = 0; px < c.width; px++) {
        if (!c.opaque(px, py)) continue;
        const h = c.base - (c.top + py);
        if (h < 1) continue;
        const fy = Math.round(c.base - h * SHADOW_LENGTH);
        const fx = Math.round(c.left + px - h * SHADOW_LENGTH * SUN_SLANT);
        // Fill the column between this pixel's shadow and the one below it, so tall thin casters leave no gaps.
        for (let y = fy; y <= fy + 1; y++) {
            if (fx >= 0 && y >= 0 && fx < width && y < height && receives(fx, y)) mask[y * width + fx] = 1;
        }
    }
    return mask;
}
