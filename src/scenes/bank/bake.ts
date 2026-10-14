import Phaser from 'phaser';
import { bakeLighting, type Exposure, type ExposureMap, type Lamp, type LampReach, type Reach } from '../../art/bank/lamps';
import { buildLightMaps, type Caster, type Occluder } from '../../art/bank/lightmap';
import type { PixelBitmap } from '../../art/PixelBitmap';
import type { Level } from '../../level/plan';
import type { Box } from '../../level/space';
import { DEPTH, KEY } from './layers';

/**
 * Mid-morning. Everything is lit at half exposure, ambient being half the sun on the street, and baked (lamps.ts):
 * lamps blocked by walls, then exposed for where each thing stands, outdoors doubled and indoors the building's shade.
 */
export const AMBIENT = 0x8a8274;

/** Lets every lamp it is given light every pixel: for something standing, baked with the lamps that reach where it stands. */
export const EVERYWHERE = () => true;

const ATLAS_WIDTH = 1024;

/** A piece of an atlas: its frame name and its RGBA pixels. */
export interface AtlasPiece { frame: string; rgba: Uint8ClampedArray; w: number; h: number }

/**
 * Bakes a bank's textures: lit on the CPU with Light2D's formula by the lamps that reach each pixel past the walls,
 * exposed for where each thing stands, and uploaded straight from memory.
 */
export class Baker {
    constructor(private readonly scene: Phaser.Scene, readonly lamps: readonly Lamp[], readonly reach: LampReach, readonly exposure: ExposureMap) {}

    /** The exposure at a floor point (clamped to the map). */
    exposureAt(x: number, y: number): readonly [number, number, number] {
        const { width, height, rgb } = this.exposure;
        const i = (Math.min(height - 1, Math.max(0, Math.floor(y))) * width + Math.min(width - 1, Math.max(0, Math.floor(x)))) * 3;
        return [rgb[i]!, rgb[i + 1]!, rgb[i + 2]!];
    }

    /** The exposure of something standing at floor point (x, y), the same for all of it however tall it is drawn. */
    standingAt(x: number, y: number): Exposure {
        const e = this.exposureAt(x, y);
        return () => e;
    }

    /**
     * The lamps reaching any of `points` on the floor, in order: how a standing object is lit, by what can see where it
     * stands. Baked with `EVERYWHERE`, they light all of it.
     */
    lampsReaching(points: [number, number][]): Lamp[] {
        return this.lamps.filter(lamp => points.some(([x, y]) => this.reach.reaches(lamp, x, y)));
    }

    /**
     * Makes texture `key`: `bitmap` drawn at (left, top), lit the way Light2D would light it by those of `lamps` that
     * `reaches` lets through, then exposed.
     */
    bake(key: string, bitmap: PixelBitmap, left: number, top: number, lamps: readonly Lamp[], reaches: Reach, exposure: Exposure | ExposureMap): string {
        if (!this.scene.textures.exists(key)) this.addPixels(key, bakeLighting(bitmap, left, top, AMBIENT, lamps, reaches, exposure), bitmap.width, bitmap.height);
        return key;
    }

    addBaked(key: string, bitmap: PixelBitmap, left: number, top: number, lamps: readonly Lamp[], reaches: Reach, exposure: Exposure | ExposureMap): Phaser.GameObjects.Image {
        return this.scene.add.image(left, top, this.bake(key, bitmap, left, top, lamps, reaches, exposure)).setOrigin(0, 0);
    }

    /**
     * Makes texture `key` from RGBA pixels, uploaded straight from memory. A canvas would cost a copy in and, on upload, a
     * copy back out: with hundreds of baked textures that was a third of the time a bank took to appear. The pixels go up
     * premultiplied by their alpha and rounded as a canvas would store them, since WebGL's own premultiplying truncates.
     */
    addPixels(key: string, rgba: Uint8ClampedArray, width: number, height: number): Phaser.Textures.Texture {
        const renderer = this.scene.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
        const texture = this.scene.textures.addGLTexture(key, renderer.createUint8ArrayTexture(premultiplied(rgba), width, height, false, true));
        if (!texture) throw new Error(`Failed to create texture '${key}'`);
        return texture;
    }

    /** Packs baked pieces into one texture in rows, a pixel apart, each a named frame. */
    packAtlas(key: string, pieces: AtlasPiece[]): void {
        let x = 0, y = 0, row = 0;
        const spots = pieces.map(p => {
            if (x + p.w > ATLAS_WIDTH) {
                x = 0;
                y += row + 1;
                row = 0;
            }
            const spot = { x, y };
            x += p.w + 1;
            row = Math.max(row, p.h);
            return spot;
        });
        const pixels = new Uint8ClampedArray(ATLAS_WIDTH * (y + row) * 4);
        pieces.forEach((p, i) => {
            const { x, y } = spots[i]!;
            for (let j = 0; j < p.h; j++) pixels.set(p.rgba.subarray(j * p.w * 4, (j + 1) * p.w * 4), ((y + j) * ATLAS_WIDTH + x) * 4);
        });
        const texture = this.addPixels(key, pixels, ATLAS_WIDTH, y + row);
        pieces.forEach((p, i) => texture.add(p.frame, 0, spots[i]!.x, spots[i]!.y, p.w, p.h));
    }

    /**
     * The shade (ambient occlusion, contact and sun shadows) multiplied over the floor, and the sun shafts through the
     * street glass added to it and, faintly, over everything.
     */
    addLightMaps(level: Level, occluders: Occluder[], casters: Caster[]): void {
        const maps = buildLightMaps(level, occluders, casters), { add, textures } = this.scene;
        if (!textures.exists(KEY.shade)) this.addPixels(KEY.shade, maps.shade, maps.width, maps.height);
        if (!textures.exists(KEY.glow)) this.addPixels(KEY.glow, maps.glow, maps.width, maps.height);
        add.image(0, 0, KEY.shade).setOrigin(0, 0).setDepth(DEPTH.shade).setBlendMode(Phaser.BlendModes.MULTIPLY);
        add.image(0, 0, KEY.glow).setOrigin(0, 0).setDepth(DEPTH.sunFloor).setBlendMode(Phaser.BlendModes.ADD);
        // The same shafts, faint, over everything: the light in the air that also falls on people standing in it.
        add.image(0, 0, KEY.glow).setOrigin(0, 0).setDepth(DEPTH.haze).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.35);
    }
}

/**
 * A restarted scene draws another bank (the generator bar regenerates in the page), so the textures baked for the last
 * one go; what doesn't depend on the bank (a dust mote, a person's drop shadows) stays. Its images were destroyed when
 * the scene shut down.
 */
export function forgetLastBank(textures: Phaser.Textures.TextureManager): void {
    const keep: string[] = [KEY.mote, KEY.shadow, KEY.lyingShadow];
    for (const key of textures.getTextureKeys()) if ((key.startsWith('bank-') || key.startsWith('person-')) && !keep.includes(key)) textures.remove(key);
}

/** Floor points across a footprint: its middle and towards each end, so a long counter is lit by lamps along it. */
export function footprintPoints(box: Box): [number, number][] {
    const y = box.y + box.d / 2;
    return [[box.x + box.w / 2, y], [box.x + Math.min(4, box.w / 2), y], [box.x + box.w - Math.min(4, box.w / 2), y]];
}

/**
 * RGBA pixels with each colour multiplied by its alpha, rounded to the nearest as a canvas does when it stores them
 * (`putImageData`). Opaque pixels, most of them, stay as they are; when all are, the same memory is returned.
 */
function premultiplied(rgba: Uint8ClampedArray): Uint8Array {
    let out: Uint8Array | undefined;
    for (let i = 3; i < rgba.length; i += 4) {
        const a = rgba[i]!;
        if (a === 255) continue;
        out ??= new Uint8Array(rgba);
        for (let c = i - 3; c < i; c++) {
            const product = rgba[c]! * a + 128;
            out[c] = (product + (product >> 8)) >> 8;
        }
    }
    return out ?? new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.length);
}
