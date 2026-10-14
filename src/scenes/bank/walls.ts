import type Phaser from 'phaser';
import { leafArt, openWallArt, opens, type Hinge } from '../../art/bank/doors';
import { bakeLighting, type Exposure, type Lamp } from '../../art/bank/lamps';
import { farFront, streetFront } from '../../art/bank/lightmap';
import { wallArt, wallLook, wallMargin, type WallLook } from '../../art/bank/walls';
import { TILE } from '../../level/level';
import { isOffMap, type Level } from '../../level/plan';
import { WALL_STEPS, type Box } from '../../level/space';
import { wallFootprint, type Footprint, type Wall } from '../../level/walls';
import { AMBIENT, EVERYWHERE, type AtlasPiece, type Baker } from './bake';
import { DEPTH, KEY } from './layers';

/**
 * Walls the camera looks past are cut down. A wall stands full height while its base line is at least `STAND_ABOVE`
 * pixels above the middle of the screen, and is cut once it is less than `CUT_ABOVE` above it; in between it keeps its
 * height, so nudging the camera doesn't make walls flicker. A changing wall moves one step of `WALL_STEPS` every `STEP_MS`.
 */
const STAND_ABOVE = 16;
const CUT_ABOVE = 4;
const STEP_MS = 40;

/** A wall segment on screen: the step it is drawn at, the step it is heading for, and what hangs on it. */
interface WallSprite {
    wall: Wall;
    look: WallLook;
    /** The lamps that light it and its exposure, kept for drawing its door open. */
    lamps: Lamp[];
    exposure: Exposure;
    image: Phaser.GameObjects.Image;
    /** Its frame in the wall atlas for each of `WALL_STEPS`. */
    frames: string[];
    base: number;
    step: number;
    target: number;
    /** Outer walls with nothing behind them always stand. */
    standing: boolean;
    /** Part of the street front, whose height the cloud shadows' top follows. */
    front: boolean;
    /** Part of the front across the street, whose height the cloud shadows' bottom follows. */
    far: boolean;
    dressing: { top: number; images: Phaser.GameObjects.Image[] }[];
    /** A door, once it has been opened: its doorway and its leaf, each with a frame per step, and whether it is open now. */
    door?: OpenDoor;
}

interface OpenDoor {
    open: boolean;
    gap: Phaser.GameObjects.Image;
    leaf?: Phaser.GameObjects.Image;
    gapFrames: string[];
    leafFrames: string[];
}

/**
 * The bank's walls, one image per segment standing on the edges between tiles, and the heights they are cut to: those
 * north of the middle of the screen stand full height as the backdrop, the rest are cut down so nothing the camera is
 * looking at hides behind them. The tops of the street front and of the front across it are reported as they move, for
 * the cloud shadows that fall on them.
 */
export class Walls {
    private readonly sprites: WallSprite[] = [];
    private clock = 0;
    private baker?: Baker;

    constructor(private readonly scene: Phaser.Scene, private readonly level: Level, private readonly tops: { front: (y: number) => void; far: (y: number) => void }) {}

    /**
     * One image per wall segment, standing on its footprint's south edge and ordered by it. Each segment is baked at each
     * of its heights, lit by the lamps on its open sides and exposed for the side it faces; all of them share one atlas.
     */
    build(baker: Baker): void {
        this.baker = baker;
        const { tiles, walls } = this.level;
        const { walls: front, line } = streetFront(this.level), far = farFront(this.level)?.walls ?? [];
        const fresh = !this.scene.textures.exists(KEY.walls);
        const pieces: AtlasPiece[] = [];
        const placed = walls.map((wall, i) => {
            const look = wallLook(wall, walls), f = wallFootprint(wall), base = f.y + f.d;
            const sides = wallSides(wall, f), lamps = baker.lampsReaching(sides);
            const [ex, ey] = sides.find(([x, y]) => !isOffMap(tiles[Math.floor(y / TILE)]?.[Math.floor(x / TILE)] ?? 'x')) ?? sides[0]!;
            const exposure = baker.standingAt(ex, ey);
            const frames = WALL_STEPS.map(height => {
                const frame = `${i}-${height}`;
                if (fresh) {
                    const art = wallArt(wall, look, height);
                    const rgba = bakeLighting(art, f.x - wallMargin(wall), base - art.height, AMBIENT, lamps, EVERYWHERE, exposure);
                    pieces.push({ frame, rgba, w: art.width, h: art.height });
                }
                return frame;
            });
            return { wall, look, lamps, exposure, f, base, frames };
        });
        if (fresh) baker.packAtlas(KEY.walls, pieces);
        for (const { wall, look, lamps, exposure, f, base, frames } of placed) {
            const image = this.scene.add.image(f.x - wallMargin(wall), base, KEY.walls, frames[0]!).setOrigin(0, 1).setDepth(DEPTH.standing + base);
            const north = wall.run === 'eastWest' ? tiles[wall.ty - 1]?.[wall.tx] : undefined;
            // The fronts on the street, and the piers at its ends that front tiles off the map, move as one.
            const isFront = front.includes(wall) || (wall.run === 'eastWest' && wall.ty * TILE === line);
            this.sprites.push({
                wall, look, lamps, exposure, image, frames, base, step: 0, target: 0, dressing: [],
                standing: !isFront && (north === undefined || isOffMap(north)),
                front: isFront,
                far: far.includes(wall)
            });
        }
    }

    /** Dressing hung on the face of an east-west wall goes out of view while that wall is cut below its top. */
    hang(box: Box, images: Phaser.GameObjects.Image[]): void {
        const wall = this.sprites.find(w => w.wall.run === 'eastWest' && w.base === box.y && w.image.x < box.x + box.w && w.image.x + TILE > box.x);
        if (!wall) throw new Error(`Nothing to hang the dressing at (${box.x}, ${box.y}) on`);
        wall.dressing.push({ top: box.z + box.h, images });
    }

    /**
     * Picks each wall's height from where the camera looks, the map row `middle` in the middle of the screen (on the
     * tactical map every wall is cut, so the plan reads), and moves changing walls a step towards it every `STEP_MS`.
     */
    update(deltaMs: number, middle: number, onMap: boolean): void {
        const top = WALL_STEPS.length - 1;
        for (const w of this.sprites) {
            if (w.standing) w.target = top;
            else if (onMap) w.target = 0;
            else if (w.base < middle - STAND_ABOVE) w.target = top;
            else if (w.base > middle - CUT_ABOVE) w.target = 0;
        }
        this.clock += deltaMs;
        while (this.clock >= STEP_MS) {
            this.clock -= STEP_MS;
            let moving = false;
            for (const w of this.sprites) if (w.step !== w.target) {
                this.setStep(w, w.step + Math.sign(w.target - w.step));
                moving = true;
            }
            if (!moving) this.clock = 0;
        }
    }

    /** Puts every wall at the height it is heading for at once, as when the bank first shows. */
    settle(): void {
        for (const w of this.sprites) this.setStep(w, w.target);
    }

    /** Whether every wall has reached the height the view asks of it. */
    get settled(): boolean {
        return this.sprites.every(w => w.step === w.target);
    }

    /** Each segment and the height it is drawn at, for tests. */
    get state(): { kind: Wall['kind']; run: Wall['run']; tx: number; ty: number; height: number }[] {
        return this.sprites.map(w => ({ kind: w.wall.kind, run: w.wall.run, tx: w.wall.tx, ty: w.wall.ty, height: WALL_STEPS[w.step]! }));
    }

    /**
     * Shows the door on the segment at tile edge (`run`, tx, ty) open or closed (play mode, §6.9). Open, the segment is
     * drawn with its doorway cut out of it and the floor beyond showing through, and the leaf stands swung open on its
     * hinge, both in the world's projection and cut down with the wall (doors.ts). They are drawn the first time the
     * door opens. Closed is the wall's own art, so a bank that never opens a door looks exactly as before.
     */
    setDoorOpen(run: Wall['run'], tx: number, ty: number, open: boolean): void {
        const w = this.sprites.find(s => s.wall.run === run && s.wall.tx === tx && s.wall.ty === ty);
        if (!w) throw new Error(`No wall segment at ${run} ${tx},${ty} to open`);
        if (!opens(w.look) || (!open && !w.door)) return;
        const door = (w.door ??= this.drawDoor(w, this.sprites.indexOf(w)));
        door.open = open;
        w.image.setVisible(!open);
        door.gap.setVisible(open);
        door.leaf?.setVisible(open);
        this.showDressing(w);
    }

    /** The open doorway and leaf of a door segment, baked at each step of `WALL_STEPS` and lit as its wall is. */
    private drawDoor(w: WallSprite, index: number): OpenDoor {
        const key = `${KEY.walls}-door-${index}`, f = wallFootprint(w.wall), margin = wallMargin(w.wall), baker = this.baker!;
        const hinge = this.hingeOf(w);
        const gaps = WALL_STEPS.map(height => openWallArt(w.wall, w.look, height));
        const leaves = WALL_STEPS.map(height => leafArt(w.wall, w.look, height, hinge));
        const fresh = !this.scene.textures.exists(key), pieces: AtlasPiece[] = [];
        const gapFrames = gaps.map((art, step) => {
            const frame = `gap-${step}`;
            if (fresh) pieces.push({ frame, rgba: bakeLighting(art, f.x - margin, w.base - art.height, AMBIENT, w.lamps, EVERYWHERE, w.exposure), w: art.width, h: art.height });
            return frame;
        });
        const leafFrames = leaves.map((leaf, step) => {
            const frame = `leaf-${step}`;
            if (leaf && fresh) pieces.push({ frame, rgba: bakeLighting(leaf.bitmap, leaf.left, leaf.top, AMBIENT, w.lamps, EVERYWHERE, w.exposure), w: leaf.bitmap.width, h: leaf.bitmap.height });
            return frame;
        });
        if (fresh) baker.packAtlas(key, pieces, pieces.reduce((sum, p) => sum + p.w + 1, 0));
        const gap = this.scene.add.image(w.image.x, w.image.y, key, gapFrames[w.step]!).setOrigin(0, 1).setDepth(w.image.depth);
        const first = leaves[0];
        // Every step's leaf has the same footprint, so the same bottom edge: only its top is cut lower.
        const leaf = first && this.scene.add.image(first.left, first.top + first.bitmap.height, key, leafFrames[w.step]!).setOrigin(0, 1).setDepth(DEPTH.standing + first.base);
        return { open: false, gap, leaf, gapFrames, leafFrames };
    }

    /** The jamb a leaf hangs on: the west one, but the east one for the right-hand leaf of a pair of doors. */
    private hingeOf(w: WallSprite): Hinge {
        const { wall } = w;
        if (wall.run === 'northSouth') return 'north';
        if (w.look === 'doorGlassRight') return 'east';
        const westIsSame = this.level.walls.some(o => o.kind === wall.kind && o.run === wall.run && o.tx === wall.tx - 1 && o.ty === wall.ty);
        return wall.kind === 'doorTower' && westIsSame ? 'east' : 'west';
    }

    /** Dressing on a segment shows while the wall stands tall enough to hold it, and goes with its door when that opens. */
    private showDressing(w: WallSprite): void {
        const open = w.door?.open ?? false, height = WALL_STEPS[w.step]!;
        for (const d of w.dressing) for (const image of d.images) image.setVisible(!open && d.top <= height);
    }

    private setStep(w: WallSprite, step: number): void {
        w.step = step;
        const height = WALL_STEPS[step]!;
        w.image.setFrame(w.frames[step]!);
        if (w.door) {
            w.door.gap.setFrame(w.door.gapFrames[step]!);
            w.door.leaf?.setFrame(w.door.leafFrames[step]!);
        }
        this.showDressing(w);
        // Cloud shadows fall on the street and the fronts, not on the floor seen over a cut-down front, nor on the inside
        // of the front across the street.
        if (w.front) this.tops.front(wallFootprint(w.wall).y - height);
        if (w.far) this.tops.far(wallFootprint(w.wall).y - height);
    }
}

/** Floor points beside a wall segment: in front of an east-west wall, either side (east first) of a north-south one. */
function wallSides(wall: Wall, f: Footprint): [number, number][] {
    if (wall.run === 'eastWest') return [2, 8, 14].map(u => [f.x + u, f.y + f.d + 0.5]);
    return [[f.x + f.w + 0.5, f.y + 8], [f.x - 0.5, f.y + 8]];
}
