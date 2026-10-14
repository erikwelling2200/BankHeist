import { TILE } from '../../level/level';
import { isOffMap, isOutdoors, type Level } from '../../level/plan';
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
    /** Additive layer: warm sunlight falling through glass onto the floor indoors. */
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
    // Nothing to band, as for most of the map: what the rest works out to, without the dither.
    if (value === 0) return 0;
    const scaled = value * bands;
    const lower = Math.floor(scaled);
    const frac = scaled - lower;
    // Only the 20% nearest the step boundary is dithered; the rest stays flat.
    const edge = frac > 0.8 ? (frac - 0.8) / 0.2 : 0;
    return Math.min(bands, lower + (edge > bayer4(x, y) ? 1 : 0)) / bands;
}

/** Glass columns of a segment that let light through; frames and mullions block it. */
function glassAt(kind: WallKind, px: number): boolean {
    if (kind === 'window') return px >= 0 && px <= 14;
    if (kind === 'doorGlass') return px >= 1 && px <= 14;
    return false;
}

/**
 * The fronts on the street: the east-west segments with the street on their south side and a building (the bank or a
 * neighbour) on their north, and the line they stand on.
 */
export function streetFront(level: Level): { walls: Wall[]; line: number } {
    const walls = level.walls.filter(w => {
        if (w.run !== 'eastWest') return false;
        const south = level.tiles[w.ty]?.[w.tx], north = level.tiles[w.ty - 1]?.[w.tx];
        return south !== undefined && north !== undefined && isOutdoors(south) && !isOutdoors(north) && !isOffMap(north);
    });
    if (!walls.length) throw new Error('The level has no street front');
    const line = walls[0]!.ty * TILE;
    if (walls.some(w => w.ty * TILE !== line)) throw new Error('The street front has to run along one line');
    return { walls, line };
}

/**
 * The fronts across the street, facing back at the bank: east-west segments south of the street front with open ground
 * on their north side and a building on their south, and the line they stand on. A plot may have none.
 */
export function farFront(level: Level): { walls: Wall[]; line: number } | undefined {
    const street = streetFront(level).line;
    const walls = level.walls.filter(w => {
        if (w.run !== 'eastWest' || w.ty * TILE <= street) return false;
        const south = level.tiles[w.ty]?.[w.tx], north = level.tiles[w.ty - 1]?.[w.tx];
        return south !== undefined && north !== undefined && isOutdoors(north) && !isOutdoors(south) && !isOffMap(south);
    });
    if (!walls.length) return undefined;
    const line = walls[0]!.ty * TILE;
    if (walls.some(w => w.ty * TILE !== line)) throw new Error('The far front has to run along one line');
    return { walls, line };
}

/** Pixels taken by walls, and by tiles off the map. */
function solidMask(level: Level, width: number, height: number): Uint8Array {
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

export function buildLightMaps(level: Level, occluders: Occluder[], casters: Caster[]): LightMaps {
    const tiles = level.tiles, rows = tiles.length, cols = tiles[0]!.length;
    const width = cols * TILE, height = rows * TILE;
    const shade = new Uint8ClampedArray(width * height * 4);
    const glow = new Uint8ClampedArray(width * height * 4);
    const solid = solidMask(level, width, height);
    const structureAt = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && solid[y * width + x] === 1;

    // Ambient occlusion: floor darkens close to the foot of walls.
    const ao = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (solid[i] === 1) continue;
        let d = 6;
        if (x >= 5 && y >= 5 && x < width - 5 && y < height - 5) {
            // Away from the map's edge every neighbour is on it: read them straight, as this runs for every pixel.
            for (let r = 1; r < 6 && d === 6; r++) if (solid[i - r] === 1 || solid[i + r] === 1 || solid[i - r * width] === 1 || solid[i + r * width] === 1) d = r;
        } else {
            for (let r = 1; r < 6 && d === 6; r++) {
                if (structureAt(x - r, y) || structureAt(x + r, y) || structureAt(x, y - r) || structureAt(x, y + r)) d = r;
            }
        }
        ao[i] = d >= 6 ? 0 : (6 - d) / 6 * 0.55;
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

    const outdoors = (x: number, y: number) => {
        const t = tiles[Math.floor(y / TILE)]?.[Math.floor(x / TILE)];
        return t !== undefined && isOutdoors(t);
    };
    // Glass the sun can come through (1) and its frames (2); every other wall pixel is in `solid`.
    const glass = new Uint8Array(width * height);
    for (const wall of level.walls) {
        if (wall.kind !== 'window' && wall.kind !== 'doorGlass') continue;
        const f = wallFootprint(wall);
        for (let y = Math.max(0, f.y); y < Math.min(height, f.y + f.d); y++) for (let x = Math.max(0, f.x); x < Math.min(width, f.x + f.w); x++) {
            glass[y * width + x] = wall.run === 'eastWest' && glassAt(wall.kind, x - f.x) ? 1 : 2;
        }
    }
    // How far each floor pixel indoors is from the glass the sun reaches it through (0: no sun). Traced back from every
    // pane column of glass with the street south of it, away from the sun, until a wall or furniture-free floor runs out.
    const shaft = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (glass[y * width + x] !== 1 || glass[(y - 1) * width + x] === 1 || !outdoors(x, y + 3)) continue;
        for (let t = 1; t <= SHAFT_LENGTH; t++) {
            const px = Math.round(x - t * SUN_SLANT), py = y - t;
            if (px < 0 || py < 0) break;
            const i = py * width + px;
            if (solid[i] === 1 || glass[i] !== 0) break;
            if (!shaft[i] || t < shaft[i]!) shaft[i] = t;
        }
    }
    const sunShadow = castSunShadows(casters, width, height, (x, y) => outdoors(x, y) && !structureAt(x, y));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const occlusion = Math.min(1, ao[i]! + footprint[i]!);
        const level = band(occlusion, SHADE_BANDS.length - 1, x, y);
        const s = Math.round(255 * SHADE_BANDS[Math.round(level * (SHADE_BANDS.length - 1))]! * (sunShadow[i] ? SUN_SHADOW : 1));
        shade[i * 4] = shade[i * 4 + 1] = shade[i * 4 + 2] = s;
        shade[i * 4 + 3] = 255;

        let sun = 0;
        const dist = structureAt(x, y) || outdoors(x, y) ? 0 : shaft[i]!;
        if (dist > 0) {
            if (!sunBlocked(x, y, dist, blockHeight, width)) {
                const t = dist / SHAFT_LENGTH;
                // The far end of the shaft is the top of the glass, where the blinds stripe it.
                const blinds = t > 0.72 && Math.floor(dist / 2) % 2 === 0;
                sun = blinds ? 0 : t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
            }
        }
        const lit = sun > 0 ? band(sun, 3, x, y) : 0;
        const a = lit * 0.22;
        glow[i * 4] = SUN[0] * a;
        glow[i * 4 + 1] = SUN[1] * a;
        glow[i * 4 + 2] = SUN[2] * a;
        glow[i * 4 + 3] = 255;
    }
    return { width, height, shade, glow };
}

/**
 * Exposure: how bright the eye sees each floor point, as an RGB factor. Everything is lit at half exposure (ambient is
 * half the sun on the street), so outdoors is doubled; indoors is the building's shade, lifting towards the street
 * glass and a touch cool against the warm sun outside. Baked into every texture (lamps.ts) at the floor point it stands
 * on, so a wall's face takes the exposure of the side it faces, however tall it is drawn.
 */
export function buildExposure(level: Level): { width: number; height: number; rgb: Float32Array } {
    const width = level.tiles[0]!.length * TILE, height = level.tiles.length * TILE;
    const front = streetFront(level).line, far = farFront(level)?.line;
    const rgb = new Float32Array(width * height * 3).fill(2);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (isOutdoors(level.tiles[Math.floor(y / TILE)]![Math.floor(x / TILE)]!)) continue;
        // Lifted towards the glass on the street: the bank's front below, the far front above a building across the street.
        const near = y < front ? Math.max(0, 1 - (front - y) / WINDOW_REACH) : far !== undefined && y >= far ? Math.max(0, 1 - (y - far) / WINDOW_REACH) : 0;
        const r = 2 * (ROOF_DEEP + (ROOF_WINDOW - ROOF_DEEP) * band(near, 4, x, y)), i = (y * width + x) * 3;
        rgb[i] = r * 0.9;
        rgb[i + 1] = r * 0.95;
        rgb[i + 2] = r;
    }
    return { width, height, rgb };
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
