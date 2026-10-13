import { deepen } from '../palette';
import { PixelBitmap } from '../PixelBitmap';
import { TOP_DEPTH } from '../../level/space';
import type { PropArt } from './model';

export type Vec3Like = readonly [number, number, number];

/**
 * A canvas for drawing one view of a prop by hand, in the projection the world uses. The view covers the prop's turned
 * footprint (`w` across the screen, `d` into it) and height `h`. Depth is foreshortened to `depthScale` of itself (by
 * default the world's `TOP_DEPTH`) measured back from the front edge, so the bottom edge is the footprint's south edge at
 * floor level and a point (x, y) at height z lands `(d - y) * depthScale + z` rows above it. Every pixel is drawn
 * deliberately; the projection only says where a surface is, not what it looks like.
 */
export class View {
    readonly lit: PixelBitmap;
    readonly glow: PixelBitmap;

    /** Rows the footprint's depth takes on screen once tops are foreshortened by `depthScale`. */
    private readonly depthRows: number;

    constructor(readonly w: number, readonly d: number, readonly h: number, readonly margin = 0, readonly depthScale = TOP_DEPTH) {
        this.depthRows = Math.round(d * depthScale);
        this.lit = new PixelBitmap(w + margin * 2, this.depthRows + h);
        this.glow = new PixelBitmap(this.lit.width, this.lit.height);
    }

    /** A pixel of a top (upward) surface: footprint pixel (x, y) at height z. */
    top(x: number, y: number, z: number, color: number, normal: Vec3Like = NORMAL.top): void {
        this.put(x, this.row(y, z), color, normal);
    }

    /** Screen row (before the height offset) of a point `y` into the footprint at height z; depth is measured from the front edge. */
    private row(y: number, z: number): number {
        return this.depthRows - Math.round((this.d - y) * this.depthScale) - z;
    }

    /** A pixel of a south-facing surface standing on line `y` (by default the footprint's south edge): column x, height pixel z (1 is the lowest). */
    face(x: number, z: number, color: number, y = this.d, normal: Vec3Like = NORMAL.face): void {
        this.put(x, this.row(y, z), color, normal);
    }

    /** An unlit pixel (a lamp, a screen) at the same place `face` would put it. */
    glowFace(x: number, z: number, color: number, y = this.d): void {
        const [bx, by] = [x + this.margin, this.row(y, z) + this.h];
        this.glow.set(bx, by, color, 1);
        this.lit.clear(bx, by);
    }

    private put(x: number, row: number, color: number, normal: Vec3Like): void {
        const bx = x + this.margin, by = row + this.h;
        this.lit.set(bx, by, color, 1);
        this.lit.setNormal(bx, by, normal[0], normal[1], normal[2]);
    }

    /**
     * Sel-out outline: pixels on the silhouette's sides and bottom take a darker shade of their own colour, so the shape
     * reads against any floor; its top edge stays light, as the light comes from above.
     */
    outline(): void {
        const b = this.lit, edge: [number, number][] = [];
        for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
            if (!b.opaque(x, y)) continue;
            if (!b.opaque(x - 1, y) || !b.opaque(x + 1, y) || !b.opaque(x, y + 1)) edge.push([x, y]);
        }
        for (const [x, y] of edge) {
            const i = (y * b.width + x) * 3;
            b.set(x, y, deepen(b.color(x, y), 0.4), 1);
            b.setNormal(x, y, b.normals[i]!, b.normals[i + 1]!, b.normals[i + 2]!);
        }
    }

    art(lights: PropArt['lights'] = []): PropArt {
        return { lit: this.lit, glow: this.glow, lights, originX: this.margin };
    }
}

const n = (x: number, y: number, z: number): Vec3Like => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
};

/**
 * Screen-space normals (x right, y down the screen, z towards the viewer) for the surfaces a view is made of. The camera
 * looks north and down, so a top leans towards the top of the screen and a south face towards the bottom.
 */
export const NORMAL = {
    top: n(0, -0.55, 0.85),
    face: n(0, 0.45, 0.9),
    /** A rounded edge or a surface turned towards the screen's left or right. */
    left: n(-0.6, 0, 0.8),
    right: n(0.6, 0, 0.8),
    /** Between a top and a face: a shoulder, a sloping windscreen. */
    slope: n(0, -0.1, 1)
} as const;
