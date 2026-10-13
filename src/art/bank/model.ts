import { TOP_DEPTH, type Facing, type Size } from '../../level/space';
import { PixelBitmap } from '../PixelBitmap';

/**
 * Props are small 3D models made of boxes, drawn for any of the four facings by one renderer, so every prop has all
 * four orientations and they always agree with each other.
 *
 * A model lives in its own frame: x runs across its front (left to right as you face it), y from its back (0) to its
 * front (`size.d`), z up from the floor. Facing south, that frame is the world's. The ¾ camera sees, of every box, its
 * top and whichever of its faces points south: the front when the model faces south, the back facing north, its left
 * side (x = 0) facing east and its right side facing west.
 */

/** A face texture: a colour, or a function of (u, v) giving a colour or `null` for a hole. On a side face, u runs left
 *  to right as seen from outside and v down from the top edge; on a top, (u, v) is (x, y) in the model's frame. */
export type Tex = number | ((u: number, v: number) => number | null);

export interface Part {
    x: number; y: number; z: number; w: number; d: number; h: number;
    top?: Tex;
    front?: Tex;
    back?: Tex;
    left?: Tex;
    right?: Tex;
    /** Used for any side face not given its own texture; falls back to `front`. */
    sides?: Tex;
    /** Lit by nothing: screens, bulbs and signs, drawn into the glow layer. */
    glow?: boolean;
    /** Below 255 the part is see-through (glass) and never hides what is behind it. */
    alpha?: number | ((u: number, v: number) => number);
    /** Normal-map height for its top and its faces. */
    bump?: { top: number; face: number };
}

/** A light in the model's frame (z is its height above the floor). */
export interface ModelLight { x: number; y: number; z: number; radius: number; color: number; intensity: number }

/**
 * `upright` models (a row of posts, a rope) are drawn without foreshortening their tops: they have no top worth
 * showing, and each post has to stay on its own floor position.
 */
export interface Model { parts: Part[]; lights?: ModelLight[]; upright?: boolean }

/** A light a prop gives off, in pixels relative to the prop bitmap's top-left corner. */
export interface PropLight { x: number; y: number; radius: number; color: number; intensity: number }

/**
 * A prop drawn for one facing. `lit` responds to scene lights, `glow` is drawn over it unlit. `originX` is the bitmap
 * column of the footprint's west edge (parts may spread wider than the footprint); the bitmap's bottom edge is the
 * footprint's south edge at floor level.
 */
export interface PropArt { lit: PixelBitmap; glow: PixelBitmap; lights: PropLight[]; originX: number }

type Visible = 'front' | 'back' | 'left' | 'right';
const VISIBLE_FACE: Record<Facing, Visible> = { south: 'front', north: 'back', east: 'left', west: 'right' };

/** Turns a point of the model's frame into the world frame of its turned footprint (`size` is the model's own size). */
function turnPoint(x: number, y: number, size: Size, facing: Facing): [number, number] {
    switch (facing) {
        case 'south': return [x, y];
        case 'north': return [size.w - x, size.d - y];
        case 'east': return [y, size.w - x];
        case 'west': return [size.d - y, x];
    }
}

/** A part's box in world axes: its north-west corner and extent. */
function turnPart(p: Part, size: Size, facing: Facing): { x: number; y: number; w: number; d: number } {
    const [ax, ay] = turnPoint(p.x, p.y, size, facing);
    const [bx, by] = turnPoint(p.x + p.w, p.y + p.d, size, facing);
    return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), d: Math.abs(by - ay) };
}

/** The model-frame pixel under a world pixel of the turned footprint. */
function localPixel(wx: number, wy: number, size: Size, facing: Facing): [number, number] {
    switch (facing) {
        case 'south': return [wx, wy];
        case 'north': return [size.w - 1 - wx, size.d - 1 - wy];
        case 'east': return [size.w - 1 - wy, wx];
        case 'west': return [wy, size.d - 1 - wx];
    }
}

function sample(tex: Tex | undefined, u: number, v: number): number | null {
    if (tex === undefined) return null;
    return typeof tex === 'number' ? tex : tex(u, v);
}

interface Write { x: number; y: number; key: number; color: number; height: number; glow: boolean; alpha: number }

export function renderModel(model: Model, size: Size, facing: Facing): PropArt {
    const writes: Write[] = [];
    const face = VISIBLE_FACE[facing];
    const turnedSize = facing === 'east' || facing === 'west' ? { w: size.d, d: size.w } : size;
    // Tops are foreshortened back from the front edge (see TOP_DEPTH); something flat on the floor is the floor and is not.
    const flat = model.parts.every(p => p.z === 0 && p.h === 0);
    const k = flat || model.upright ? 1 : TOP_DEPTH, depthRows = Math.round(turnedSize.d * k);
    const row = (worldY: number, z: number) => depthRows - Math.round((turnedSize.d - worldY) * k) - z;
    for (const part of model.parts) {
        const box = turnPart(part, size, facing);
        const top = part.z + part.h;
        const bump = part.bump ?? { top: 1, face: 0.7 };
        const alphaAt = (u: number, v: number) => (part.alpha === undefined ? 255 : typeof part.alpha === 'number' ? part.alpha : part.alpha(u, v));
        // Top: every pixel of the footprint at the part's top height. Screen row = world y - height.
        for (let j = 0; j < box.d; j++) for (let i = 0; i < box.w; i++) {
            const [lx, ly] = localPixel(box.x + i, box.y + j, size, facing);
            const u = lx - part.x, v = ly - part.y;
            const c = sample(part.top, u, v);
            if (c !== null) writes.push({ x: box.x + i, y: row(box.y + j, top), key: box.y + j + top, color: c, height: bump.top, glow: !!part.glow, alpha: alphaAt(u, v) });
        }
        // The face pointing at the camera, on the part's south edge, from its top down to its bottom.
        const tex = part[face] ?? part.sides ?? part.front;
        const south = box.y + box.d;
        for (let k = 1; k <= part.h; k++) for (let i = 0; i < box.w; i++) {
            const z = part.z + k, v = part.h - k;
            const c = sample(tex, i, v);
            if (c !== null) writes.push({ x: box.x + i, y: row(south, z), key: south + z, color: c, height: bump.face, glow: !!part.glow, alpha: alphaAt(i, v) });
        }
    }
    if (!writes.length) throw new Error('A model drew nothing');

    const minX = Math.min(0, ...writes.map(w => w.x)), maxX = Math.max(turnedSize.w - 1, ...writes.map(w => w.x));
    const minY = Math.min(...writes.map(w => w.y)), maxY = Math.max(...writes.map(w => w.y));
    if (maxY > depthRows - 1) throw new Error(`A model reaches ${maxY - depthRows + 1}px in front of its footprint at floor level`);
    const lit = new PixelBitmap(maxX - minX + 1, depthRows - minY);
    const glow = new PixelBitmap(lit.width, lit.height);
    const depth = new Float32Array(lit.width * lit.height).fill(-Infinity);
    const at = (w: Write) => [w.x - minX, w.y - minY] as const;

    // Solid pixels first, nearest wins (larger key = further south and higher, so closer to the camera).
    for (const w of writes.filter(w => w.alpha >= 255)) {
        const [x, y] = at(w), i = y * lit.width + x;
        if (w.key < depth[i]!) continue;
        depth[i] = w.key;
        if (w.glow) { glow.set(x, y, w.color, w.height); lit.clear(x, y); }
        else { lit.set(x, y, w.color, w.height); glow.clear(x, y); }
    }
    // See-through pixels over whatever is behind them, never over what is in front.
    for (const w of writes.filter(w => w.alpha < 255)) {
        const [x, y] = at(w), i = y * lit.width + x;
        if (w.key < depth[i]!) continue;
        if (lit.opaque(x, y)) lit.set(x, y, blend(lit.color(x, y), w.color, w.alpha / 255), lit.heightAt(x, y));
        else lit.set(x, y, w.color, w.height, w.alpha);
    }

    const lights = (model.lights ?? []).map(l => {
        const [wx, wy] = turnPoint(l.x, l.y, size, facing);
        return { x: wx - minX, y: depthRows - (turnedSize.d - wy) * k - l.z - minY, radius: l.radius, color: l.color, intensity: l.intensity };
    });
    return { lit, glow, lights, originX: -minX };
}

function blend(under: number, over: number, t: number): number {
    const c = (shift: number) => Math.round(((under >> shift) & 0xff) * (1 - t) + ((over >> shift) & 0xff) * t);
    return (c(16) << 16) | (c(8) << 8) | c(0);
}
