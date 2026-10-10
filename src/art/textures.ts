import Phaser from 'phaser';
import { buildNormalMap } from '../logic/normalMap';
import { TILE } from '../level/level';
import { EXIT, GOLD, GUARD, LAMP, ROBBER, type SpriteDef } from './sprites';

export const TEX = { robber: 'robber', guard: 'guard', gold: 'gold', lamp: 'lamp', exit: 'exit', tiles: 'tiles', mote: 'mote' } as const;

/** Tile indices inside the generated `tiles` tileset. */
export const TILE_INDEX = { floorA: 0, floorB: 1, wallTop: 2, wallFace: 3 } as const;

/** A colour + height bitmap that is turned into a Phaser texture with a linked normal map. */
class PixelBitmap {
    readonly colors: Uint8ClampedArray;
    readonly heights: Float32Array;

    constructor(readonly width: number, readonly height: number) {
        this.colors = new Uint8ClampedArray(width * height * 4);
        this.heights = new Float32Array(width * height);
    }

    set(x: number, y: number, color: number, height: number): void {
        const i = y * this.width + x;
        this.colors.set([(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff, 255], i * 4);
        this.heights[i] = height;
    }

    addTo(textures: Phaser.Textures.TextureManager, key: string): void {
        const color = toCanvas(this.colors, this.width, this.height);
        const normal = toCanvas(buildNormalMap(this.heights, this.width, this.height), this.width, this.height);
        const texture = textures.addCanvas(key, color);
        if (!texture) throw new Error(`Failed to create texture '${key}'`);
        texture.setDataSource(normal);
    }
}

function toCanvas(pixels: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
    return canvas;
}

function spriteBitmap(def: SpriteDef): PixelBitmap {
    const bitmap = new PixelBitmap(def.rows[0]!.length, def.rows.length);
    def.rows.forEach((row, y) => [...row].forEach((c, x) => {
        if (c === '.') return;
        const entry = def.palette[c];
        if (!entry) throw new Error(`Sprite palette has no entry for '${c}'`);
        bitmap.set(x, y, entry.color, entry.height);
    }));
    return bitmap;
}

/** Deterministic PRNG so generated art is identical on every load. */
function mulberry32(seed: number): () => number {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Smooth, tileable 2D value noise over a `cells` x `cells` lattice; inputs in [0, 1) wrap. */
function valueNoise(rand: () => number, cells: number): (u: number, v: number) => number {
    const lattice = Array.from({ length: cells * cells }, rand);
    const at = (x: number, y: number) => lattice[((y % cells) * cells) + (x % cells)]!;
    const smooth = (t: number) => t * t * (3 - 2 * t);
    return (u, v) => {
        const x = u * cells, y = v * cells;
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const tx = smooth(x - x0), ty = smooth(y - y0);
        const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
        const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
        return top * (1 - ty) + bottom * ty;
    };
}

function shade(color: number, amount: number): number {
    const c = (shift: number) => Math.max(0, Math.min(255, Math.round(((color >> shift) & 0xff) * amount)));
    return (c(16) << 16) | (c(8) << 8) | c(0);
}

function tilesetBitmap(): PixelBitmap {
    const count = Object.keys(TILE_INDEX).length;
    const bitmap = new PixelBitmap(TILE * count, TILE);
    const rand = mulberry32(1337);
    const draw = (index: number, pixel: (x: number, y: number) => [number, number]) => {
        for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
            const [color, height] = pixel(x, y);
            bitmap.set(index * TILE + x, y, color, height);
        }
    };
    // Marble floor: two tones so the map can checker them, wandering veins from smooth noise, darker grout on the edges.
    const noise = valueNoise(rand, 4);
    const marble = (base: number) => (x: number, y: number): [number, number] => {
        if (x === 0 || y === 0) return [shade(base, 0.55), 0.1];
        const vein = Math.abs(Math.sin((x * 0.25 + y * 0.15 + noise(x / TILE, y / TILE) * 2.5) * Math.PI)) < 0.12;
        return [shade(base, vein ? 0.78 : 0.96 + rand() * 0.06), vein ? 0.45 : 0.6];
    };
    draw(TILE_INDEX.floorA, marble(0x6e6a78));
    draw(TILE_INDEX.floorB, marble(0x55515f));
    // Wall top: dark stone seen from above.
    draw(TILE_INDEX.wallTop, (x, y) => {
        const edge = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1;
        return [shade(0x2a2433, edge ? 0.7 : 0.9 + rand() * 0.15), edge ? 0.6 : 0.8];
    });
    // Wall face: brick courses, offset every other row.
    draw(TILE_INDEX.wallFace, (x, y) => {
        const row = Math.floor(y / 4);
        const mortar = y % 4 === 3 || (x + (row % 2) * 4) % 8 === 7;
        if (y < 2) return [0x1e1a26, 0.9];
        return mortar ? [0x231d2a, 0.2] : [shade(0x5a3a3a, 0.85 + rand() * 0.25), 0.7];
    });
    return bitmap;
}

/** Generates every texture the game uses. Later on these can be swapped for real art files with `-n` normal maps loaded in a preload scene. */
export function createTextures(textures: Phaser.Textures.TextureManager): void {
    spriteBitmap(ROBBER).addTo(textures, TEX.robber);
    spriteBitmap(GUARD).addTo(textures, TEX.guard);
    spriteBitmap(GOLD).addTo(textures, TEX.gold);
    spriteBitmap(LAMP).addTo(textures, TEX.lamp);
    spriteBitmap(EXIT).addTo(textures, TEX.exit);
    tilesetBitmap().addTo(textures, TEX.tiles);
    const mote = new PixelBitmap(1, 1);
    mote.set(0, 0, 0xffffff, 1);
    mote.addTo(textures, TEX.mote);
}
