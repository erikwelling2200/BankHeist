import Phaser from 'phaser';
import { PixelBitmap } from './PixelBitmap';
import { mulberry32, valueNoise } from './random';
import { TILE } from '../level/level';
import { EXIT, GOLD, GUARD, LAMP, ROBBER, type SpriteDef } from './sprites';

export const TEX = { robber: 'robber', guard: 'guard', gold: 'gold', lamp: 'lamp', exit: 'exit', tiles: 'tiles', mote: 'mote' } as const;

/** Tile indices inside the generated `tiles` tileset. */
export const TILE_INDEX = { floorA: 0, floorB: 1, wallTop: 2, wallFace: 3 } as const;

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
