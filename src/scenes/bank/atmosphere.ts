import Phaser from 'phaser';
import { farFront, streetFront } from '../../art/bank/lightmap';
import { PixelBitmap } from '../../art/PixelBitmap';
import { bayer4, mulberry32, valueNoise } from '../../art/random';
import { TILE } from '../../level/level';
import { isOutdoors, type Level } from '../../level/plan';
import type { Baker } from './bake';
import { DEPTH, KEY } from './layers';

/** The cloud shadow pattern's size; it repeats seamlessly. */
const CLOUD_TILE = 256;

/**
 * The air over the bank: slow cloud shadows drifting over the street and the fronts, their top following the fronts'
 * height (across the street they stop at the far front and carry on over the open ground beside it), and dust drifting
 * in the sun shafts just inside the glass. When `still` (for screenshot tests) there is no dust, and the scene doesn't
 * drift the clouds.
 */
export class Atmosphere {
    /** Cloud shadows: a pre-tiled image, shifted and cropped as they drift (a TileSprite showed seams under MULTIPLY). */
    private clouds: Phaser.GameObjects.Image[] = [];
    private drift = { x: 0, y: 0 };
    /** Where the cloud shadows start: the top of the street front, so they fall on it and on the street. */
    private top = 0;
    /**
     * Where they stop: the top of the front across the street, whose face we see from inside. Beyond it they go on only
     * over the open ground (`spans`, pixel ranges across the map) either side of the building.
     */
    private bottom = 0;
    private spans: [number, number][] = [];
    private readonly width: number;
    private readonly height: number;

    constructor(private readonly scene: Phaser.Scene, private readonly level: Level, private readonly still: boolean) {
        this.width = level.tiles[0]!.length * TILE;
        this.height = level.tiles.length * TILE;
    }

    build(baker: Baker): void {
        const { add, textures } = this.scene, front = streetFront(this.level).line;
        if (!textures.exists(KEY.clouds)) {
            const width = this.width + CLOUD_TILE, height = this.height + CLOUD_TILE;
            baker.addPixels(KEY.clouds, tiled(cloudPixels(CLOUD_TILE), CLOUD_TILE, width, height), width, height);
        }
        const far = farFront(this.level), row = far ? this.level.tiles[far.line / TILE]! : [];
        this.spans = [];
        row.forEach((t, x) => {
            if (!isOutdoors(t)) return;
            const span = this.spans.at(-1);
            if (span && span[1] === x * TILE) span[1] += TILE;
            else this.spans.push([x * TILE, (x + 1) * TILE]);
        });
        this.clouds = Array.from({ length: 1 + this.spans.length }, () =>
            add.image(0, 0, KEY.clouds).setOrigin(0, 0).setDepth(DEPTH.clouds).setBlendMode(Phaser.BlendModes.MULTIPLY));
        this.top = front;
        this.bottom = far?.line ?? this.height;
        this.place();

        if (!textures.exists(KEY.mote)) {
            const mote = new PixelBitmap(1, 1);
            mote.set(0, 0, 0xfff2d0, 1);
            baker.addPixels(KEY.mote, mote.colors, 1, 1);
        }
        if (this.still) return;
        add.particles(0, 0, KEY.mote, {
            x: { min: TILE, max: this.width - TILE },
            y: { min: front - 4 * TILE, max: front - 4 },
            lifespan: 5000,
            speedX: { min: -2, max: 2 },
            speedY: { min: -3, max: 1 },
            alpha: { start: 0, end: 0, ease: (t: number) => Math.sin(t * Math.PI) * 0.45 },
            quantity: 1,
            frequency: 60,
            blendMode: Phaser.BlendModes.ADD
        }).setDepth(DEPTH.motes);
    }

    /** Drifts the clouds by `dt` seconds. */
    update(dt: number): void {
        this.drift.x += dt * 4;
        this.drift.y += dt * 1.5;
        this.place();
    }

    /** The street front's top moved to map row `y`. */
    frontTop(y: number): void {
        this.top = y;
        this.place();
    }

    /** The far front's top moved to map row `y`. */
    farTop(y: number): void {
        this.bottom = y;
        this.place();
    }

    /** Shifts the cloud shadows by their drift, within one tile of the pattern, and crops them to the open ground and the fronts. */
    private place(): void {
        if (!this.clouds.length) return;
        const ox = Phaser.Math.Wrap(this.drift.x, 0, CLOUD_TILE), oy = Phaser.Math.Wrap(this.drift.y, 0, CLOUD_TILE);
        const x = ox - CLOUD_TILE, y = oy - CLOUD_TILE;
        const rects = [
            { x: 0, y: this.top, w: this.width, h: this.bottom - this.top },
            ...this.spans.map(([x0, x1]) => ({ x: x0, y: this.bottom, w: x1 - x0, h: this.height - this.bottom }))
        ];
        rects.forEach((r, i) => this.clouds[i]!.setPosition(x, y).setCrop(r.x - x, r.y - y, r.w, r.h));
    }
}

/** RGBA pixels of `width` by `height` covered with copies of `tile`, a square of `size` pixels, from the top-left corner. */
function tiled(tile: Uint8ClampedArray, size: number, width: number, height: number): Uint8ClampedArray {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x += size) {
        const from = ((y % size) * size) * 4;
        pixels.set(tile.subarray(from, from + Math.min(size, width - x) * 4), (y * width + x) * 4);
    }
    return pixels;
}

/** Cloud shadow: two octaves of smooth noise cut into two flat levels, dithered only along the edge; about a third in shadow. */
function cloudPixels(size: number): Uint8ClampedArray {
    const rand = mulberry32(23);
    const broad = valueNoise(rand, 4), fine = valueNoise(rand, 8);
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const n = 0.7 * broad(x / size, y / size) + 0.3 * fine(x / size, y / size);
        const edge = (n - 0.56) / 0.03;
        const inShadow = edge > 1 || (edge > 0 && edge > bayer4(x, y));
        const v = inShadow ? 214 : 255;
        pixels.set([v, v, v - (inShadow ? 4 : 0), 255], (y * size + x) * 4);
    }
    return pixels;
}
