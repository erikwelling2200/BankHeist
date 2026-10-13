import type Phaser from 'phaser';
import { buildNormalMap } from '../logic/normalMap';

/**
 * A colour + height bitmap that is turned into a Phaser texture with a linked normal map. Unpainted pixels stay
 * transparent. The normal map comes from the heights, except where a pixel was given its own normal (`setNormal`),
 * as rendered 3D props do.
 */
export class PixelBitmap {
    readonly colors: Uint8ClampedArray;
    readonly heights: Float32Array;
    /** Explicit screen-space normals, three per pixel (x right, y down, z towards the viewer); NaN where unset. */
    readonly normals: Float32Array;

    constructor(readonly width: number, readonly height: number) {
        this.colors = new Uint8ClampedArray(width * height * 4);
        this.heights = new Float32Array(width * height);
        this.normals = new Float32Array(width * height * 3).fill(NaN);
    }

    setNormal(x: number, y: number, nx: number, ny: number, nz: number): void {
        this.normals.set([nx, ny, nz], (y * this.width + x) * 3);
    }

    inBounds(x: number, y: number): boolean {
        return x >= 0 && y >= 0 && x < this.width && y < this.height;
    }

    set(x: number, y: number, color: number, height: number, alpha = 255): void {
        if (!this.inBounds(x, y)) throw new Error(`Pixel (${x}, ${y}) is outside a ${this.width}x${this.height} bitmap`);
        const i = y * this.width + x;
        this.colors.set([(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff, alpha], i * 4);
        this.heights[i] = height;
    }

    /** Paints a pixel if it lies on the bitmap; shapes that run off the edge are clipped. */
    plot(x: number, y: number, color: number, height: number, alpha = 255): void {
        if (this.inBounds(x, y)) this.set(x, y, color, height, alpha);
    }

    color(x: number, y: number): number {
        const i = (y * this.width + x) * 4;
        return (this.colors[i]! << 16) | (this.colors[i + 1]! << 8) | this.colors[i + 2]!;
    }

    heightAt(x: number, y: number): number {
        return this.heights[y * this.width + x]!;
    }

    opaque(x: number, y: number): boolean {
        return this.inBounds(x, y) && this.colors[(y * this.width + x) * 4 + 3]! > 0;
    }

    clear(x: number, y: number): void {
        const i = y * this.width + x;
        this.colors.fill(0, i * 4, i * 4 + 4);
        this.heights[i] = 0;
        this.normals.fill(NaN, i * 3, i * 3 + 3);
    }

    rect(x: number, y: number, w: number, h: number, color: number, height: number): void {
        for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) this.plot(px, py, color, height);
    }

    hline(x: number, y: number, w: number, color: number, height: number): void {
        this.rect(x, y, w, 1, color, height);
    }

    vline(x: number, y: number, h: number, color: number, height: number): void {
        this.rect(x, y, 1, h, color, height);
    }

    ellipse(cx: number, cy: number, rx: number, ry: number, color: number, height: number): void {
        for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
            const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
            if (dx * dx + dy * dy <= 1) this.plot(x, y, color, height);
        }
    }

    /** Copies the opaque pixels of `source` onto this bitmap with its top-left corner at (left, top): colour, height and normal. */
    stamp(source: PixelBitmap, left: number, top: number): void {
        for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
            if (!source.opaque(x, y)) continue;
            const i = (y * source.width + x) * 3;
            this.set(left + x, top + y, source.color(x, y), source.heightAt(x, y));
            this.setNormal(left + x, top + y, source.normals[i]!, source.normals[i + 1]!, source.normals[i + 2]!);
        }
    }

    /** Runs `paint` for every opaque pixel, letting it recolour the pixel. */
    each(paint: (x: number, y: number, color: number, height: number) => [number, number] | void): void {
        for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
            if (!this.opaque(x, y)) continue;
            const result = paint(x, y, this.color(x, y), this.heightAt(x, y));
            if (result) this.set(x, y, result[0], result[1]);
        }
    }

    addTo(textures: Phaser.Textures.TextureManager, key: string): Phaser.Textures.Texture {
        const color = toCanvas(this.colors, this.width, this.height);
        const normal = toCanvas(this.normalMap(), this.width, this.height);
        const texture = textures.addCanvas(key, color);
        if (!texture) throw new Error(`Failed to create texture '${key}'`);
        texture.setDataSource(normal);
        return texture;
    }

    /** RGBA normal map: from the heights, overridden by explicit normals (encoded the same way, +Y up for WebGL). */
    normalMap(): Uint8ClampedArray {
        const map = buildNormalMap(this.heights, this.width, this.height);
        for (let i = 0; i < this.width * this.height; i++) {
            const nx = this.normals[i * 3]!;
            if (Number.isNaN(nx)) continue;
            map[i * 4] = Math.round((nx * 0.5 + 0.5) * 255);
            map[i * 4 + 1] = Math.round((-this.normals[i * 3 + 1]! * 0.5 + 0.5) * 255);
            map[i * 4 + 2] = Math.round((this.normals[i * 3 + 2]! * 0.5 + 0.5) * 255);
        }
        return map;
    }
}

export function toCanvas(pixels: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    return canvas;
}
