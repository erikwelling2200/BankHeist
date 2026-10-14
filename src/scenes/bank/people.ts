import type Phaser from 'phaser';
import { bakeLighting } from '../../art/bank/lamps';
import { LOOKS, person, PERSON_HEIGHT } from '../../art/bank/people';
import { PixelBitmap } from '../../art/PixelBitmap';
import { TILE } from '../../level/level';
import type { LevelPerson, PersonFacing as Facing } from '../../level/plan';
import { baseLine, PERSON_SIZE, px, type Box } from '../../level/space';
import { AMBIENT, EVERYWHERE, footprintPoints, type Baker } from './bake';
import { DEPTH, KEY } from './layers';

/** People walk at about 1.4m/s and wait this long at each end of a patrol. */
const WALK_SPEED = px(1.4);
const PATROL_WAIT_MS = 1500;

/**
 * A person on screen: their drawing (and its normals) for each facing, the texture their lit sprite is written into,
 * the image and drop shadow that follow them, where they stand (the middle of their footprint, in map pixels) and,
 * when they patrol, how far along they are.
 */
interface PersonSprite {
    person: LevelPerson;
    views: Record<Facing, { bitmap: PixelBitmap; normals: Uint8ClampedArray }>;
    texture: Phaser.Textures.CanvasTexture;
    image: Phaser.GameObjects.Image;
    shadow: Phaser.GameObjects.Image;
    x: number;
    y: number;
    facing: Facing;
    /** Mean brightness of the lit sprite (0-255), so tests can see the light change. */
    light: number;
    /** A crew member's ground ring in their colour (UI.md "Crew"), under them. */
    ring?: Phaser.GameObjects.Image;
    /** A walk along a line of waypoints (pixels) and back: the leg being walked, how far along it, which way. */
    patrol?: { points: [number, number][]; leg: number; t: number; dir: 1 | -1; wait: number };
}

/**
 * The people in the bank. They stand in the middle of their tile: the sprite's soles on the front edge of their box,
 * centred across it. They move, so they cast nothing into the baked maps (no sun shadow, no gap in a shaft), only their
 * drop shadow, and each has a texture of their own that `move` relights wherever they stand. Someone where `hidden`
 * says (a room the blueprint only outlines) is out of sight.
 */
export class People {
    private readonly sprites: PersonSprite[] = [];

    constructor(private readonly scene: Phaser.Scene, private readonly baker: Baker, private readonly hidden: (x: number, y: number) => boolean) {}

    /**
     * Everyone in the bank, then the crew (play mode): each crew member is a person with a ground ring in their colour
     * (a CSS colour), and follows the bank's people in the order of `move`'s indexes.
     */
    build(people: readonly LevelPerson[], crew: readonly (LevelPerson & { ring: string })[] = []): void {
        const { add, textures } = this.scene;
        if (!textures.exists(KEY.shadow)) {
            const shadow = personShadow();
            this.baker.addPixels(KEY.shadow, shadow.colors, shadow.width, shadow.height);
        }
        if (people.some(p => p.pose) && !textures.exists(KEY.lyingShadow)) {
            const shadow = lyingShadow();
            this.baker.addPixels(KEY.lyingShadow, shadow.colors, shadow.width, shadow.height);
        }
        [...people, ...crew].forEach((p, i) => {
            const look = LOOKS[p.look];
            if (!look) throw new Error(`No look named '${p.look}'`);
            // A mask or a pose set on the person is drawn over their look.
            const spec = { ...look, mask: p.mask ?? look.mask, pose: p.pose ?? look.pose };
            const view = (facing: Facing) => {
                const bitmap = person(spec, facing);
                return { bitmap, normals: bitmap.normalMap() };
            };
            const views = { front: view('front'), back: view('back') };
            const key = `person-${i}`, { width, height } = views.front.bitmap;
            const texture = textures.exists(key) ? (textures.get(key) as Phaser.Textures.CanvasTexture) : textures.createCanvas(key, width, height);
            if (!texture) throw new Error(`Failed to create texture '${key}'`);
            const x = (p.tx + 0.5) * TILE, y = (p.ty + 0.5) * TILE;
            this.sprites.push({
                person: p, views, texture, x, y, facing: p.facing, light: 0,
                image: add.image(0, 0, key).setOrigin(0, 0),
                shadow: add.image(0, 0, p.pose ? KEY.lyingShadow : KEY.shadow).setDepth(DEPTH.shadows).setAlpha(0.55),
                patrol: patrolOf(p, x, y),
                ring: 'ring' in p ? add.image(0, 0, this.ringTexture(i, p.ring as string)).setDepth(DEPTH.shadows + 0.5) : undefined
            });
            this.move(i, x, y);
        });
    }

    /**
     * Stands person `index` with the middle of their footprint at map point (x, y), facing `facing`, and relights them:
     * only their own sprite, by the lamps that reach where they now stand. People cast nothing into the baked maps, so
     * nothing else changes.
     */
    move(index: number, x: number, y: number, facing?: Facing): void {
        const p = this.sprites[index];
        if (!p) throw new Error(`No person ${index} in the bank`);
        p.x = x;
        p.y = y;
        if (facing) p.facing = facing;
        const box: Box = { x: Math.round(x - PERSON_SIZE.w / 2), y: Math.round(y - PERSON_SIZE.d / 2), z: 0, ...PERSON_SIZE, facing: 'south' };
        const { bitmap, normals } = p.views[p.facing];
        const left = Math.round(box.x + box.w / 2 - bitmap.width / 2), top = baseLine(box) - PERSON_HEIGHT;
        const lit = bakeLighting(bitmap, left, top, AMBIENT, this.baker.lampsReaching(footprintPoints(box)), EVERYWHERE, this.baker.standingAt(x, y), normals);
        p.texture.context.putImageData(new ImageData(new Uint8ClampedArray(lit), bitmap.width, bitmap.height), 0, 0);
        p.texture.refresh();
        p.image.setPosition(left, top).setDepth(DEPTH.standing + baseLine(box));
        p.shadow.setPosition(box.x + box.w / 2, box.y + box.d / 2 - (p.person.pose ? LYING_SHADOW_RISE : 0));
        p.ring?.setPosition(box.x + box.w / 2, box.y + box.d / 2);
        p.light = meanBrightness(lit);
        this.showIfSeen(p);
    }

    /** Walks everyone on patrol on by `deltaMs`. */
    update(deltaMs: number): void {
        for (const p of this.sprites) if (p.patrol) this.walk(p, deltaMs);
    }

    /** How many people (the crew included) there are. */
    get count(): number {
        return this.sprites.length;
    }

    /** Where person `index` stands (the middle of their footprint, map pixels) and which way they face. */
    at(index: number): { x: number; y: number; facing: Facing } {
        const p = this.sprites[index]!;
        return { x: p.x, y: p.y, facing: p.facing };
    }

    /** Whether map point (x, y) is on person `index`: their drawing or their tile. */
    hit(index: number, x: number, y: number): boolean {
        const p = this.sprites[index];
        if (!p || !p.image.visible) return false;
        const b = p.image.getBounds();
        return (x >= b.x && x < b.right && y >= b.y && y < b.bottom) || (Math.abs(x - p.x) <= TILE / 2 && Math.abs(y - p.y) <= TILE / 2);
    }

    /** A crew member's ring bright (selected) or quiet. */
    highlight(index: number, on: boolean): void {
        this.sprites[index]?.ring?.setAlpha(on ? 1 : 0.55);
    }

    /** Shows or hides everyone by where they stand, after what `hidden` says has changed. */
    reveal(): void {
        for (const p of this.sprites) this.showIfSeen(p);
    }

    /** Each person, where they stand and how brightly they are lit, for tests. */
    get state(): { look: string; x: number; y: number; facing: Facing; light: number; visible: boolean }[] {
        return this.sprites.map(p => ({ look: p.person.look, x: p.x, y: p.y, facing: p.facing, light: p.light, visible: p.image.visible }));
    }

    /**
     * Walks a patrolling person along their waypoints and back, waiting at each end; they are moved (and relit) only when
     * they cross a pixel or turn.
     */
    private walk(p: PersonSprite, deltaMs: number): void {
        const patrol = p.patrol!;
        if (patrol.wait > 0) {
            patrol.wait -= deltaMs;
            return;
        }
        const leg = (i: number): [[number, number], [number, number]] => [patrol.points[i]!, patrol.points[i + 1]!];
        let [[fx, fy], [tx, ty]] = leg(patrol.leg);
        patrol.t += (patrol.dir * WALK_SPEED * deltaMs) / 1000 / Math.max(1, Math.hypot(tx - fx, ty - fy));
        if (patrol.t > 1 || patrol.t < 0) {
            const next = patrol.leg + patrol.dir;
            if (patrol.t > 1 && next < patrol.points.length - 1) { patrol.leg = next; patrol.t = 0; }
            else if (patrol.t < 0 && patrol.leg > 0) { patrol.leg -= 1; patrol.t = 1; }
            else {
                // The end of the line: turn round and wait.
                patrol.t = Math.min(1, Math.max(0, patrol.t));
                patrol.dir = patrol.dir === 1 ? -1 : 1;
                patrol.wait = PATROL_WAIT_MS;
            }
            [[fx, fy], [tx, ty]] = leg(patrol.leg);
        }
        const heading = patrol.dir * (ty - fy);
        const x = Math.round(fx + (tx - fx) * patrol.t), y = Math.round(fy + (ty - fy) * patrol.t);
        const facing: Facing = heading > 0 ? 'front' : heading < 0 ? 'back' : p.facing;
        if (x !== p.x || y !== p.y || facing !== p.facing) this.move(this.sprites.indexOf(p), x, y, facing);
    }

    /** Hides a person standing where `hidden` says; called whenever they move. */
    private showIfSeen(p: PersonSprite): void {
        const hidden = this.hidden(p.x, p.y);
        p.image.setVisible(!hidden);
        p.shadow.setVisible(!hidden);
        p.ring?.setVisible(!hidden);
    }

    /** A ground ring in `colour`, an ellipse two pixels thick round a person's feet, with an ink edge outside. */
    private ringTexture(index: number, colour: string): string {
        const key = `person-ring-${index}`;
        if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
        const w = RING.w, h = RING.h, rgba = new Uint8ClampedArray(w * h * 4);
        const c = parseInt(colour.replace('#', ''), 16), rgb = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
        const inside = (x: number, y: number, rx: number, ry: number) => ((x + 0.5 - w / 2) / rx) ** 2 + ((y + 0.5 - h / 2) / ry) ** 2 <= 1;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4, outer = inside(x, y, w / 2, h / 2), ring = inside(x, y, w / 2 - 1, h / 2 - 1), hole = inside(x, y, w / 2 - 2.6, h / 2 - 2);
            if (!outer || hole) continue;
            if (ring) rgba.set([...rgb, 235], i);
            else rgba.set([13, 12, 20, 150], i);
        }
        this.baker.addPixels(key, rgba, w, h);
        return key;
    }
}

/** A person's patrol as pixel waypoints: their tile, then their route's tiles or their patrol's end. */
function patrolOf(p: LevelPerson, x: number, y: number): PersonSprite['patrol'] {
    const tiles = p.route ?? (p.patrol ? [p.patrol] : undefined);
    if (!tiles?.length) return undefined;
    const points: [number, number][] = [[x, y], ...tiles.map((t): [number, number] => [(t.tx + 0.5) * TILE, (t.ty + 0.5) * TILE])];
    return { points, leg: 0, t: 0, dir: 1, wait: PATROL_WAIT_MS };
}

/** A crew member's ground ring: a little wider than their shadow, foreshortened like the floor. */
const RING = { w: 18, h: 9 };

/** Mean brightness (0-255) of the opaque pixels of RGBA colours. */
function meanBrightness(rgba: Uint8ClampedArray): number {
    let total = 0, count = 0;
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3]! > 0) { total += (rgba[i]! + rgba[i + 1]! + rgba[i + 2]!) / 3; count++; }
    return count ? total / count : 0;
}

function personShadow(): PixelBitmap {
    const b = new PixelBitmap(12, 5);
    b.ellipse(6, 2.5, 6, 2.5, 0x0d0c14, 0);
    return b;
}

/** How far up from their footprint's middle the shadow of someone lying down sits: under the middle of the body. */
const LYING_SHADOW_RISE = 5;

/** Someone lying down shades the floor along the whole body, not in a pool at the feet. */
function lyingShadow(): PixelBitmap {
    const b = new PixelBitmap(12, 15);
    b.ellipse(6, 7.5, 6, 7.5, 0x0d0c14, 0);
    return b;
}
