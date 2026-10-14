import { deepen, mix } from '../palette';
import { PixelBitmap } from '../PixelBitmap';
import { TOP_DEPTH, turned, type Facing, type Size } from '../../level/space';

export type Vec3Like = readonly [number, number, number];

/** A light a prop gives off, in pixels relative to the prop bitmap's top-left corner. */
export interface PropLight { x: number; y: number; radius: number; color: number; intensity: number }

/**
 * A prop drawn for one facing. `lit` responds to scene lights, `glow` is drawn over it unlit. `originX` is the bitmap
 * column of the footprint's west edge (a prop may spread wider than its footprint); the bitmap's bottom edge is the
 * footprint's south edge at floor level.
 */
export interface PropArt { lit: PixelBitmap; glow: PixelBitmap; lights: PropLight[]; originX: number }

/**
 * A colour for each pixel of a surface, or `null` for a hole. On a top, (u, v) run across and from the far edge
 * towards the viewer; on a face, across and down from its top edge.
 */
export type Paint = number | ((u: number, v: number) => number | null);

/** A box in the prop's own frame: x across its front, y from its back (0) to its front, z up from the floor. */
export interface Part { x: number; y: number; z: number; w: number; d: number; h: number }

/**
 * How a part looks: its top and its sides (a view shows the top and whichever side points south once the prop is
 * turned), whether it glows or is see-through, and how many pixels its corners are rounded by.
 */
export interface Faces { top?: Paint; front?: Paint; back?: Paint; left?: Paint; right?: Paint; sides?: Paint; glow?: boolean; alpha?: number; corner?: number }

/** How `block` draws: corners cut by `corner` pixels, unlit (`glow`) or see-through (`alpha` below 255). */
export interface BlockOptions { corner?: number; glow?: boolean; alpha?: number }

export interface ViewOptions {
    /** Spare columns either side of the footprint, for mirrors, lamp heads and leaves that reach past it. */
    margin?: number;
    /** Spare rows above the box, for things standing on its top (a lamp on a desk, the glass on a counter). */
    headroom?: number;
    depthScale?: number;
}

const paint = (p: Paint, u: number, v: number): number | null => (typeof p === 'number' ? p : p(u, v));

/** A part of a prop's own frame: x across its front, y from its back, z up; w, d and h its extent. */
export const part = (x: number, y: number, z: number, w: number, d: number, h: number): Part => ({ x, y, z, w, d, h });

/** Bands across a round body by `s` (-1 at its left edge, 1 at its right): dark edges, a highlight a little left of centre. */
export function roundBands(ramp: readonly number[], s: number, highlight = true): number {
    const a = Math.abs(s);
    if (a > 0.75) return ramp[1]!;
    if (highlight && s > -0.55 && s < -0.15) return ramp[ramp.length - 1]!;
    return s > 0.35 ? ramp[2]! : ramp[3]!;
}

/**
 * A soft body, round in plan (a coat on a hook, a slumped sack), standing on view footprint point (cx, cy) from height
 * z: its row k (0 at the bottom, `h` rows) is an ellipse `radii(k)` across the view and into it. Each row shows its front
 * surface, and where the rows above are narrower, its top (a shoulder); normals follow the curve, so it shades round.
 * `paint` colours a pixel by where it is across the body (s, from -1 at the left edge to 1 at the right), its row, and
 * whether it is on a top; null leaves it out.
 */
export function softBody(
    view: View, cx: number, cy: number, z: number, h: number, radii: (k: number) => [number, number], paint: (s: number, k: number, top: boolean) => number | null
): void {
    for (let k = 0; k < h; k++) {
        const [rx, ry] = radii(k);
        if (rx <= 0 || ry <= 0) continue;
        for (let y = Math.floor(cy - ry); y < Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x < Math.ceil(cx + rx); x++) {
            const s = (x + 0.5 - cx) / rx, t = (y + 0.5 - cy) / ry;
            if (s * s + t * t > 1) continue;
            const colour = paint(s, k, true);
            if (colour !== null) view.top(x, y, z + k + 1, colour, norm(s * 0.5, -0.55 + 0.25 * t, 0.8));
        }
        for (let x = Math.floor(cx - rx); x < Math.ceil(cx + rx); x++) {
            const s = (x + 0.5 - cx) / rx;
            if (Math.abs(s) > 1) continue;
            const c = Math.sqrt(1 - s * s), colour = paint(s, k, false);
            if (colour !== null) view.face(x, z + k + 1, colour, cy + c * ry, norm(s * 0.9, 0.45 * c, 0.9 * c + 0.2));
        }
    }
}

/**
 * A canvas for drawing one view of a prop by hand, in the projection the world uses. The view covers the prop's turned
 * footprint (`w` across the screen, `d` into it) and height `h`. Depth is foreshortened to `depthScale` of itself (by
 * default the world's `TOP_DEPTH`) measured back from the front edge, so the bottom edge is the footprint's south edge at
 * floor level and a point (x, y) at height z lands `(d - y) * depthScale + z` rows above it. Every pixel is drawn
 * deliberately, far things first; the projection only says where a surface is, not what it looks like.
 */
export class View {
    readonly lit: PixelBitmap;
    readonly glow: PixelBitmap;
    readonly margin: number;
    readonly headroom: number;
    readonly depthScale: number;
    private readonly lights: PropLight[] = [];
    /** Rows the footprint's depth takes on screen once tops are foreshortened by `depthScale`. */
    private readonly depthRows: number;

    constructor(readonly w: number, readonly d: number, readonly h: number, options: ViewOptions = {}) {
        this.margin = options.margin ?? 0;
        this.headroom = options.headroom ?? 0;
        this.depthScale = options.depthScale ?? TOP_DEPTH;
        this.depthRows = Math.round(d * this.depthScale);
        this.lit = new PixelBitmap(w + this.margin * 2, this.headroom + this.depthRows + h);
        this.glow = new PixelBitmap(this.lit.width, this.lit.height);
    }

    /** Bitmap row of a point `y` into the footprint at height z; depth is measured from the front edge. */
    private row(y: number, z: number): number {
        return this.headroom + this.h + this.depthRows - Math.round((this.d - y) * this.depthScale + z);
    }

    /** A pixel of a top (upward) surface: footprint pixel (x, y) at height z. */
    top(x: number, y: number, z: number, color: number, normal: Vec3Like = NORMAL.top): void {
        this.put(x, this.row(y, z), color, normal);
    }

    /** A pixel of a south-facing surface standing on line `y` (by default the footprint's south edge): column x, height pixel z (1 is the lowest). */
    face(x: number, z: number, color: number, y = this.d, normal: Vec3Like = NORMAL.face): void {
        this.put(x, this.row(y, z), color, normal);
    }

    /** An unlit pixel (a lamp, a screen) where `top` would put it. */
    glowTop(x: number, y: number, z: number, color: number): void {
        this.putGlow(x, this.row(y, z), color);
    }

    /** An unlit pixel where `face` would put it. */
    glowFace(x: number, z: number, color: number, y = this.d): void {
        this.putGlow(x, this.row(y, z), color);
    }

    /**
     * A box of the view's footprint: its top at z + h and its south face down to z. `corner` cuts that many pixels off
     * each corner of the top and the face's two upper corners, so a box reads as a made thing rather than a voxel.
     */
    block(x: number, y: number, z: number, w: number, d: number, h: number, top: Paint | null, face: Paint | null, options: BlockOptions = {}): void {
        const corner = options.corner ?? 0, glow = options.glow ?? false, alpha = options.alpha ?? 255;
        const cut = (u: number, v: number, across: number, deep: number) => Math.min(u, across - 1 - u) + Math.min(v, deep - 1 - v) < corner;
        if (face !== null) for (let k = 1; k <= h; k++) for (let u = 0; u < w; u++) {
            const v = h - k;
            if (top !== null && v < corner && Math.min(u, w - 1 - u) < corner - v) continue;
            const c = paint(face, u, v);
            if (c === null) continue;
            if (glow) this.glowFace(x + u, z + k, c, y + d);
            else this.put(x + u, this.row(y + d, z + k), c, u === 0 && w > 2 ? NORMAL.left : u === w - 1 && w > 2 ? NORMAL.right : NORMAL.face, alpha);
        }
        if (top !== null) for (let v = 0; v < d; v++) for (let u = 0; u < w; u++) {
            if (cut(u, v, w, d)) continue;
            const c = paint(top, u, v);
            if (c === null) continue;
            if (glow) this.glowTop(x + u, y + v, z + h, c);
            else this.put(x + u, this.row(y + v, z + h), c, NORMAL.top, alpha);
        }
    }

    /**
     * A round column standing on footprint point (cx, cy) with radius r, from z up to z + h. `side` colours its body by
     * `s`, from -1 at its left edge to 1 at its right, and `v` rows down from its top; `top` colours its upper disc by
     * (s, t), with t from -1 at the far edge to 1 at the near one. Normals follow the curve, so the engine's lights shade
     * it round; the paint only carries the material.
     */
    cylinder(cx: number, cy: number, r: number, z: number, h: number, side: ((s: number, v: number) => number | null) | null, top: ((s: number, t: number) => number | null) | null, options: { glow?: boolean } = {}): void {
        const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r) - 1;
        if (side !== null) for (let x = x0; x <= x1; x++) {
            const s = (x + 0.5 - cx) / r;
            if (Math.abs(s) > 1) continue;
            const c = Math.sqrt(1 - s * s), front = cy + c * r;
            const normal: Vec3Like = norm(s * 0.9, 0.45 * c, 0.9 * c + 0.2);
            for (let k = 1; k <= h; k++) {
                const colour = side(s, h - k);
                if (colour === null) continue;
                if (options.glow) this.glowFace(x, z + k, colour, front);
                else this.face(x, z + k, colour, front, normal);
            }
        }
        if (top !== null) for (let y = Math.floor(cy - r); y < Math.ceil(cy + r); y++) for (let x = x0; x <= x1; x++) {
            const s = (x + 0.5 - cx) / r, t = (y + 0.5 - cy) / r;
            if (s * s + t * t > 1) continue;
            const colour = top(s, t);
            if (colour === null) continue;
            if (options.glow) this.glowTop(x, y, z + h, colour);
            else this.top(x, y, z + h, colour);
        }
    }

    /** Where footprint point (x, y) at height z lands: its column (from the footprint's west edge) and bitmap row. */
    project(x: number, y: number, z: number): [number, number] {
        return [Math.floor(x), this.row(y, z)];
    }

    /** A lit pixel at a column and bitmap row from `project`, for freehand shapes: leaves, a sagging rope. */
    dot(x: number, row: number, color: number, normal: Vec3Like = NORMAL.face): void {
        this.put(x, row, color, normal);
    }

    /** A light the prop gives off, at footprint point (x, y) and height z. */
    light(x: number, y: number, z: number, radius: number, color: number, intensity: number): void {
        this.lights.push({ x: x + this.margin, y: this.row(y, z), radius, color, intensity });
    }

    /** Paints a lit pixel; below full `alpha` it tints what is already there, or stays see-through over nothing. */
    private put(x: number, row: number, color: number, normal: Vec3Like, alpha = 255): void {
        const bx = x + this.margin;
        if (alpha < 255) {
            if (this.lit.opaque(bx, row)) this.lit.set(bx, row, mix(this.lit.color(bx, row), color, alpha / 255), 1);
            else this.lit.set(bx, row, color, 1, alpha);
            return;
        }
        this.lit.set(bx, row, color, 1);
        this.lit.setNormal(bx, row, normal[0], normal[1], normal[2]);
        if (this.glow.opaque(bx, row)) this.glow.clear(bx, row);
    }

    private putGlow(x: number, row: number, color: number): void {
        const bx = x + this.margin;
        this.glow.set(bx, row, color, 1);
        if (this.lit.opaque(bx, row)) this.lit.clear(bx, row);
    }

    /**
     * Sel-out outline: pixels on the silhouette's sides and bottom take a darker shade of their own colour, so the shape
     * reads against any floor; its top edge stays light, as the light comes from above.
     */
    outline(amount = 0.4): void {
        const b = this.lit, edge: [number, number][] = [];
        const solid = (x: number, y: number) => b.opaque(x, y) || this.glow.opaque(x, y);
        for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
            if (!b.opaque(x, y)) continue;
            if (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y + 1)) edge.push([x, y]);
        }
        for (const [x, y] of edge) {
            const i = (y * b.width + x) * 3;
            const normal = [b.normals[i]!, b.normals[i + 1]!, b.normals[i + 2]!] as const;
            b.set(x, y, deepen(b.color(x, y), amount), 1);
            b.setNormal(x, y, normal[0], normal[1], normal[2]);
        }
    }

    art(): PropArt {
        return { lit: this.lit, glow: this.glow, lights: this.lights, originX: this.margin };
    }
}

/**
 * A prop's own frame turned to a facing: maps its points into the view of its turned footprint, and says which of its
 * sides the camera sees. Lets a prop keep one set of measurements and one top-down pattern for all four views.
 */
export class Turn {
    readonly w: number;
    readonly d: number;
    /** The side of the prop that points south, at the camera. */
    readonly seen: 'front' | 'back' | 'left' | 'right';

    constructor(readonly size: Size, readonly facing: Facing) {
        ({ w: this.w, d: this.d } = turned(size, facing));
        this.seen = ({ south: 'front', north: 'back', east: 'left', west: 'right' } as const)[facing];
    }

    /** View footprint position of own-frame point (x, y). */
    point(x: number, y: number): [number, number] {
        const { w, d } = this.size;
        switch (this.facing) {
            case 'south': return [x, y];
            case 'north': return [w - x, d - y];
            case 'east': return [y, w - x];
            case 'west': return [d - y, x];
        }
    }

    /** The own-frame direction of view direction (dx, dy): the inverse of `point`'s turn, without its offset. */
    direction(dx: number, dy: number): [number, number] {
        switch (this.facing) {
            case 'south': return [dx, dy];
            case 'north': return [-dx, -dy];
            case 'east': return [-dy, dx];
            case 'west': return [dy, -dx];
        }
    }

    /** A part of the own frame as a box of the view's footprint. */
    box(p: Part): Part {
        const [ax, ay] = this.point(p.x, p.y), [bx, by] = this.point(p.x + p.w, p.y + p.d);
        return { x: Math.min(ax, bx), y: Math.min(ay, by), z: p.z, w: Math.abs(bx - ax), d: Math.abs(by - ay), h: p.h };
    }

    /** Own-frame offset (u, v) within part `p` of the pixel at offset (i, j) within its turned box. */
    local(p: Part, i: number, j: number): [number, number] {
        switch (this.facing) {
            case 'south': return [i, j];
            case 'north': return [p.w - 1 - i, p.d - 1 - j];
            case 'east': return [p.w - 1 - j, i];
            case 'west': return [j, p.d - 1 - i];
        }
    }

    /** View footprint pixel of own-frame pixel (x, y). */
    pixel(x: number, y: number): [number, number] {
        const [vx, vy] = this.point(x + 0.5, y + 0.5);
        return [Math.floor(vx), Math.floor(vy)];
    }

    /** A light at own-frame point (x, y), height z. */
    light(view: View, x: number, y: number, z: number, radius: number, color: number, intensity: number): void {
        const [vx, vy] = this.point(x, y);
        view.light(vx, vy, z, radius, color, intensity);
    }

    /**
     * Draws own-frame parts so nearer ones cover further ones: a part goes after anything it stands on and anything
     * wholly behind it. Each shows its top in its own (u, v), and of its sides the one facing the camera, painted with u
     * running left to right as seen from outside.
     */
    draw(view: View, parts: [Part, Faces][]): void {
        const items = parts.map(([p, faces]) => ({ p, faces, b: this.box(p) }));
        for (const { p, faces, b } of paintersOrder(items)) {
            const top = faces.top;
            const side = faces[this.seen] ?? faces.sides ?? faces.front;
            view.block(b.x, b.y, b.z, b.w, b.d, b.h,
                top === undefined ? null : (i, j) => { const [u, v] = this.local(p, i, j); return paint(top, u, v); },
                side ?? null, { corner: faces.corner, glow: faces.glow, alpha: faces.alpha });
        }
    }
}

/** Orders turned boxes for painting: a box comes after one it stands on, and after one wholly behind it that it overlaps across the screen. */
function paintersOrder<T extends { b: Part }>(items: T[]): T[] {
    const across = (a: Part, b: Part) => a.x < b.x + b.w && b.x < a.x + a.w;
    const deep = (a: Part, b: Part) => a.y < b.y + b.d && b.y < a.y + a.d;
    const before = (a: Part, b: Part) => across(a, b) && ((deep(a, b) && a.z + a.h <= b.z) || (!deep(a, b) && a.y + a.d <= b.y));
    const done = new Set<T>(), out: T[] = [];
    const byBase = [...items].sort((a, b) => a.b.y + a.b.d - (b.b.y + b.b.d) || a.b.z - b.b.z);
    while (out.length < items.length) {
        const ready = byBase.find(t => !done.has(t) && byBase.every(o => o === t || done.has(o) || !before(o.b, t.b))) ?? byBase.find(t => !done.has(t))!;
        done.add(ready);
        out.push(ready);
    }
    return out;
}

/** A unit vector along (x, y, z). */
export const norm = (x: number, y: number, z: number): Vec3Like => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
};

/**
 * Screen-space normals (x right, y down the screen, z towards the viewer) for the surfaces a view is made of. The camera
 * looks north and down, so a top leans towards the top of the screen and a south face towards the bottom.
 */
export const NORMAL = {
    top: norm(0, -0.55, 0.85),
    face: norm(0, 0.45, 0.9),
    /** A rounded edge or a surface turned towards the screen's left or right. */
    left: norm(-0.6, 0, 0.8),
    right: norm(0.6, 0, 0.8),
    /** Between a top and a face: a shoulder, a sloping windscreen. */
    slope: norm(0, -0.1, 1)
} as const;

/** A paint that only changes down a surface: row by row on a face, from the far edge to the near one on a top. */
export const rows = (paint: (v: number) => number | null): Paint => (...uv: [number, number]) => paint(uv[1]);
