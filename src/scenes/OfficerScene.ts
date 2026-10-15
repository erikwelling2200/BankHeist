import Phaser from 'phaser';
import { drawPose, muzzle, OFFICER_FRAME, OFFICER_FRAMES, OFFICER_POSES, type OfficerFrame } from '../art/bank/officer';
import { propArt } from '../art/bank/props';
import { BANK_TILE_INDEX, bankTileset } from '../art/bank/tiles';
import { PAL } from '../art/palette';
import { PixelBitmap } from '../art/PixelBitmap';
import { propSize } from '../level/catalog';
import { TILE } from '../level/constants';
import { baseLine } from '../level/space';
import type { Timeline } from '../logic/timeline';
import { COVER, COVER_PROP, FADE_MS, FLOOR, officerTimeline, VIEW } from './officerSequence';

const KEY = { officer: 'officer', floor: 'officer-floor', cover: 'officer-cover', flash: 'officer-flash', shadow: 'officer-shadow' } as const;

/** A pixel thrown about: a spent case (which stays where it lands until the loop starts over) or a puff of dust. */
interface Particle { dot: Phaser.GameObjects.Rectangle; vx: number; vy: number; z: number; vz: number; life: number }
/** A shot's tracer and the light of its muzzle flash, both gone within a few frames. */
interface Flash { flash: Phaser.GameObjects.Image; tracer: Phaser.GameObjects.Graphics; light: Phaser.GameObjects.Light; life: number }

const FLASH_MS = 70;
/** A bullet crosses the floor in about two frames. */
const TRACER_MS = 50;

/**
 * Plays the police officer's animation preview on a loop (`?scene=officer`): the sequence in `officerSequence.ts`,
 * lit with Light2D like the prop sheet, every frame drawn by `drawPose`. Muzzle flashes light the scene for a frame.
 */
export class OfficerScene extends Phaser.Scene {
    private timeline!: Timeline<OfficerFrame>;
    private officer!: Phaser.GameObjects.Sprite;
    private shadow!: Phaser.GameObjects.Image;
    private fade!: Phaser.GameObjects.Rectangle;
    private elapsed = 0;
    private index = -1;
    private shots = 0;
    private particles: Particle[] = [];
    private flashes: Flash[] = [];

    constructor() {
        super('officer');
    }

    create(): void {
        this.timeline = officerTimeline();
        this.elapsed = 0;
        this.index = -1;
        this.shots = 0;
        this.lights.enable().setAmbientColor(0x8a8898);
        const width = FLOOR.w * TILE, height = FLOOR.h * TILE;
        this.buildTextures(width, height);
        this.add.image(FLOOR.x * TILE, FLOOR.y * TILE, KEY.floor).setOrigin(0, 0).setLighting(true);

        const cover = propArt(COVER_PROP, propSize(COVER_PROP), COVER.facing);
        if (!this.textures.exists(KEY.cover)) cover.lit.addTo(this.textures, KEY.cover);
        this.add.image(COVER.x - cover.originX, baseLine(COVER) - cover.lit.height, KEY.cover).setOrigin(0, 0).setLighting(true).setDepth(baseLine(COVER));

        // The officer is beside the sofa or reaching over it, never behind it, so they always draw on top.
        this.shadow = this.add.image(0, 0, KEY.shadow).setAlpha(0.5).setDepth(1);
        this.officer = this.add.sprite(0, 0, KEY.officer, this.timeline.cels[0]!.frame)
            .setOrigin(OFFICER_FRAME.anchorX / OFFICER_FRAME.width, OFFICER_FRAME.anchorY / OFFICER_FRAME.height)
            .setLighting(true).setDepth(1000);

        // A key light from the front-left and a cool fill from the right, as on the prop sheet.
        this.lights.addLight(VIEW.x - 140, VIEW.y + 40, 320, 0xfff0d8, 0.95, 140);
        this.lights.addLight(VIEW.x + 140, VIEW.y + 60, 240, 0xd8e0ff, 0.3, 120);
        this.fade = this.add.rectangle(FLOOR.x * TILE, FLOOR.y * TILE, width, height, 0x000000).setOrigin(0, 0).setDepth(2000);
        this.cameras.main.setRoundPixels(true).setZoom(VIEW.zoom).centerOn(VIEW.x, VIEW.y);
        this.update(0, 0);
    }

    update(_time: number, deltaMs: number): void {
        this.elapsed += Math.min(deltaMs, 100);
        const state = this.timeline.at(this.elapsed);
        const loopMs = this.elapsed % this.timeline.duration;
        // Cues of every cel that came up since the last frame, also across the end of the loop.
        const count = this.timeline.cels.length;
        if (state.index !== this.index) {
            // Starting over clears the spent cases.
            if (state.index < this.index) this.clearEffects();
            for (let i = (this.index + 1) % count; ; i = (i + 1) % count) {
                const cue = this.timeline.cels[i]!.cue;
                if (cue === 'shot') this.shoot(this.timeline.cels[i]!.frame, this.timeline.originOf(i));
                if (cue === 'land') this.dust(this.timeline.originOf(i));
                if (i === state.index) break;
            }
            this.index = state.index;
        }
        this.officer.setFrame(state.frame).setPosition(state.x, state.y);
        this.shadow.setPosition(state.x, state.y - 1);
        const fadeIn = 1 - loopMs / FADE_MS, fadeOut = (loopMs - (this.timeline.duration - FADE_MS)) / FADE_MS;
        this.fade.setAlpha(Math.max(0, Math.min(1, Math.max(fadeIn, fadeOut))));
        this.updateEffects(Math.min(deltaMs, 100));
    }

    /**
     * A shot from the pose of `frame` with the footing at `at`: a one-frame muzzle flash (each shot a different shape,
     * so a pair reads as two) and its light on the officer, a tracer to the west, a spent case.
     */
    private shoot(frame: OfficerFrame, at: readonly [number, number]): void {
        this.shots++;
        const [mx, my] = muzzle(OFFICER_POSES[frame]);
        const x = at[0] + mx, y = at[1] + my;
        const flash = this.add.image(x + 1, y, `${KEY.flash}-${this.shots % FLASHES.length}`).setOrigin(1, 0.5).setDepth(1001).setBlendMode(Phaser.BlendModes.ADD);
        const tracer = this.add.graphics().setDepth(1001).setBlendMode(Phaser.BlendModes.ADD);
        tracer.fillStyle(PAL.emissive.lampWarm[0], 0.8).fillRect(FLOOR.x * TILE, y, x - 6 - FLOOR.x * TILE, 1);
        const light = this.lights.addLight(x, y, 40, 0xffd89a, 1.1, 30);
        this.flashes.push({ flash, tracer, light, life: FLASH_MS });
        // The case leaves the ejection port to the shooter's right (north, facing west) and a little back, then drops
        // to the floor and stays.
        this.throw(x + 5, at[1], PAL.brass[4], { vx: 4 + (this.shots % 2) * 2, vy: -14, z: at[1] - y, vz: 30, life: Infinity });
    }

    /** Dust kicked up where the officer lands on his chest. */
    private dust(at: readonly [number, number]): void {
        [-1, 1, -0.4, 0.5].forEach((dir, i) => this.throw(at[0] - 4 + i * 3, at[1], PAL.marbleCream[1], { vx: dir * 14, vy: i % 2 ? 2 : -2, z: 1, vz: 20, life: 350 }));
    }

    private throw(x: number, y: number, color: number, motion: Omit<Particle, 'dot'>): void {
        this.particles.push({ dot: this.add.rectangle(x, y, 1, 1, color).setOrigin(0, 0).setDepth(1002), ...motion });
    }

    private clearEffects(): void {
        for (const f of this.flashes) f.life = 0;
        for (const p of this.particles) p.life = 0;
        this.updateEffects(0);
    }

    private updateEffects(deltaMs: number): void {
        const dt = deltaMs / 1000;
        this.flashes = this.flashes.filter(f => {
            f.life -= deltaMs;
            f.tracer.setAlpha(Math.max(0, (f.life - (FLASH_MS - TRACER_MS)) / TRACER_MS));
            if (f.life > 0) return true;
            f.flash.destroy();
            f.tracer.destroy();
            this.lights.removeLight(f.light);
            return false;
        });
        this.particles = this.particles.filter(p => {
            p.life -= deltaMs;
            if (p.z > 0 || p.vz > 0) {
                p.vz -= 400 * dt;
                p.z = Math.max(0, p.z + p.vz * dt);
                p.dot.x += p.vx * dt;
                p.dot.y += p.vy * dt;
                if (p.z === 0) { p.vz = p.vz < -40 ? -p.vz * 0.3 : 0; p.vx *= 0.4; p.vy = 0; }
            }
            // Drawn at its height above the floor point under it, on whole pixels.
            p.dot.setDisplayOrigin(0, Math.round(p.z));
            p.dot.setAlpha(Math.min(1, p.life / 200));
            if (p.life > 0) return true;
            p.dot.destroy();
            return false;
        });
    }

    private buildTextures(width: number, height: number): void {
        if (!this.textures.exists(KEY.officer)) {
            const sheet = new PixelBitmap(OFFICER_FRAME.width * OFFICER_FRAMES.length, OFFICER_FRAME.height);
            OFFICER_FRAMES.forEach((name, i) => sheet.stamp(drawPose(OFFICER_POSES[name]), i * OFFICER_FRAME.width, 0));
            const texture = sheet.addTo(this.textures, KEY.officer);
            OFFICER_FRAMES.forEach((name, i) => texture.add(name, 0, i * OFFICER_FRAME.width, 0, OFFICER_FRAME.width, OFFICER_FRAME.height));
        }
        if (!this.textures.exists(KEY.floor)) floorBitmap(width, height).addTo(this.textures, KEY.floor);
        FLASHES.forEach((rows, i) => { if (!this.textures.exists(`${KEY.flash}-${i}`)) muzzleFlash(rows).addTo(this.textures, `${KEY.flash}-${i}`); });
        if (!this.textures.exists(KEY.shadow)) {
            const b = new PixelBitmap(12, 5);
            b.ellipse(6, 2.5, 6, 2.5, PAL.void, 0);
            b.addTo(this.textures, KEY.shadow);
        }
    }

    /** Exposed for automated tests. */
    get debugState() {
        const state = this.timeline.at(this.elapsed);
        return { frame: state.frame, x: state.x, y: state.y, index: state.index, elapsed: this.elapsed, duration: this.timeline.duration, shots: this.shots };
    }

    /** Jumps the loop to `ms` and holds it there, for screenshots of chosen beats. */
    seek(ms: number): void {
        this.clearEffects();
        this.elapsed = ms;
        // Comes up on the cel at `ms` afresh, so a shot fired there shows its flash.
        this.index = (this.timeline.at(ms).index + this.timeline.cels.length - 1) % this.timeline.cels.length;
        this.update(0, 0);
        this.scene.pause();
    }
}

/** The lobby's marble, its three variants scattered so the repeat doesn't show. */
function floorBitmap(width: number, height: number): PixelBitmap {
    const tiles = bankTileset(), floor = new PixelBitmap(width, height);
    const variants = [BANK_TILE_INDEX.marble0, BANK_TILE_INDEX.marble1, BANK_TILE_INDEX.marble2];
    for (let ty = 0; ty < height / TILE; ty++) for (let tx = 0; tx < width / TILE; tx++) {
        const index = variants[(tx * 7 + ty * 13 + ((tx * ty) % 5)) % variants.length]!;
        for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
            floor.set(tx * TILE + x, ty * TILE + y, tiles.color(index * TILE + x, y), tiles.heightAt(index * TILE + x, y));
        }
    }
    return floor;
}

/** Muzzle flashes pointing west, white at the muzzle and orange at their tips; drawn additive and unlit. */
const FLASHES = [
    ['..o..', 'oyyW.', 'yWWWW', 'oyyW.', '..o..'],
    ['o....', '.yyW.', 'oyWWW', '..yW.', '.o...']
];

function muzzleFlash(rows: readonly string[]): PixelBitmap {
    const colors: Record<string, number> = { W: PAL.emissive.lampWarm[1], y: PAL.emissive.lampWarm[0], o: 0xd8783a };
    const b = new PixelBitmap(rows[0]!.length, rows.length);
    rows.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.') b.set(x, y, colors[c]!, 1); }));
    return b;
}
