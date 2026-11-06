import Phaser from 'phaser';
import { lightLeft, lightLeftMap, type Lamp } from '../../art/bank/lamps';
import { TILE } from '../../level/constants';
import { AMBIENT, footprintPoints, type Baker } from './bake';
import { DEPTH, KEY } from './layers';
import type { People } from './people';
import type { ShownProp } from './props';
import type { Walls } from './walls';

/**
 * The emergency lighting's cast over what is left (§8.13 "emergency lights only", visual-preview.md's open question): a
 * cool, low light, so the building reads as dark beside the street by day.
 */
const EMERGENCY: readonly [number, number, number] = [0.62, 0.66, 0.84];

/** Where the floor's power-cut shade is drawn: over the floor's own shade, under the sun's shafts (daylight stays). */
const SHADE_DEPTH = DEPTH.shade + 0.5;

/** An RGB factor (0–1 each) as a Phaser tint. */
const tintOf = ([r, g, b]: readonly number[]): number =>
    (Math.round(Math.min(1, r!) * 255) << 16) | (Math.round(Math.min(1, g!) * 255) << 8) | Math.round(Math.min(1, b!) * 255);

/**
 * The bank with the power out (§14.6; implementation plan M4-03, decision 246): the lamps of `electric` go out over the
 * building's tiles (`dark`) without baking it again, which would be the whole wait of building the bank. What each
 * lamp gave is worked out with the bake's own formula, for a floor facing up, and taken away by multiplying:
 *
 * - the floor by a shade map, drawn over it (under the sun's shafts, which are daylight);
 * - each prop and wall segment by a tint, the light left where it stands (its footprint, the floor beside the wall);
 * - people, who are relit as they move anyway, by lighting them again without the lamps (`Baker.off`);
 * - the glow of every powered prop (screens, lamp shades) is put out; the exit signs are on the battery.
 *
 * The shade map is made the first time the power goes out (`timings['power cut']` says how long it took) and kept; the
 * power back, everything is as it was baked.
 */
export class PowerCut {
    private out = false;
    private shade?: Phaser.GameObjects.Image;
    /** Each glow's own alpha, to put it back. */
    private readonly alphas = new Map<Phaser.GameObjects.Image, number>();
    /** How long making the shade map and tinting everything took the first time, in ms. */
    built?: number;

    /** The powered lamps in the building: those whose light spreads from one of its tiles (next door keeps its own). */
    private readonly electric: ReadonlySet<Lamp>;

    constructor(
        private readonly scene: Phaser.Scene, private readonly baker: Baker, powered: ReadonlySet<Lamp>,
        private readonly parts: { walls: Walls; people: People; props: readonly ShownProp[]; width: number; height: number; dark: (tx: number, ty: number) => boolean }
    ) {
        this.electric = new Set([...powered].filter(l => parts.dark(Math.floor(l.from.x / TILE), Math.floor(l.from.y / TILE))));
    }

    /** Whether the power is out as drawn. */
    get isOut(): boolean {
        return this.out;
    }

    /** Draws the bank with the power out or back on. */
    set(out: boolean): void {
        if (out === this.out) return;
        this.out = out;
        const started = performance.now();
        const { walls, people, props, dark } = this.parts;
        if (out && !this.shade) this.shade = this.makeShade();
        this.shade?.setVisible(out);
        this.baker.off = out ? this.electric : undefined;
        const tileOf = (x: number, y: number) => dark(Math.floor(x / TILE), Math.floor(y / TILE));
        walls.shade(out ? (lamps, points) => (points.some(([x, y]) => tileOf(x, y)) ? tintOf(lightLeft(points, lamps, this.electric, AMBIENT, EMERGENCY)) : null) : null);
        for (const prop of props) {
            const points = footprintPoints(prop.box), inside = out && points.some(([x, y]) => tileOf(x, y));
            const lamps = inside ? this.baker.lamps.filter(l => points.some(([x, y]) => this.baker.reach.reaches(l, x, y))) : [];
            const tint = inside ? tintOf(lightLeft(points, lamps, this.electric, AMBIENT, EMERGENCY)) : null;
            for (const image of prop.images) {
                if (prop.glows.includes(image)) {
                    // By alpha, not visibility, which the walls use to hide what hangs on a cut wall.
                    if (!this.alphas.has(image)) this.alphas.set(image, image.alpha);
                    image.setAlpha(inside && !prop.battery ? 0 : this.alphas.get(image)!);
                }
                else if (tint === null) image.clearTint();
                else image.setTint(tint);
            }
        }
        people.relight();
        this.built ??= performance.now() - started;
    }

    /** The floor's shade: the light left on each floor pixel of the building, as a multiply. */
    private makeShade(): Phaser.GameObjects.Image {
        const { width, height, dark } = this.parts, key = `${KEY.floor}-power-cut`;
        if (!this.scene.textures.exists(key)) {
            this.baker.addPixels(key, lightLeftMap(width, height, this.baker.lamps, this.electric, AMBIENT, EMERGENCY, this.baker.reach, dark), width, height);
        }
        return this.scene.add.image(0, 0, key).setOrigin(0, 0).setDepth(SHADE_DEPTH).setBlendMode(Phaser.BlendModes.MULTIPLY);
    }
}
