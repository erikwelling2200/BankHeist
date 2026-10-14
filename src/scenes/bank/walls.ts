import type Phaser from 'phaser';
import { bakeLighting } from '../../art/bank/lamps';
import { farFront, streetFront } from '../../art/bank/lightmap';
import { wallArt, wallLook, wallMargin } from '../../art/bank/walls';
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

    constructor(private readonly scene: Phaser.Scene, private readonly level: Level, private readonly tops: { front: (y: number) => void; far: (y: number) => void }) {}

    /**
     * One image per wall segment, standing on its footprint's south edge and ordered by it. Each segment is baked at each
     * of its heights, lit by the lamps on its open sides and exposed for the side it faces; all of them share one atlas.
     */
    build(baker: Baker): void {
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
            return { wall, f, base, frames };
        });
        if (fresh) baker.packAtlas(KEY.walls, pieces);
        for (const { wall, f, base, frames } of placed) {
            const image = this.scene.add.image(f.x - wallMargin(wall), base, KEY.walls, frames[0]!).setOrigin(0, 1).setDepth(DEPTH.standing + base);
            const north = wall.run === 'eastWest' ? tiles[wall.ty - 1]?.[wall.tx] : undefined;
            // The fronts on the street, and the piers at its ends that front tiles off the map, move as one.
            const isFront = front.includes(wall) || (wall.run === 'eastWest' && wall.ty * TILE === line);
            this.sprites.push({
                wall, image, frames, base, step: 0, target: 0, dressing: [],
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

    private setStep(w: WallSprite, step: number): void {
        w.step = step;
        const height = WALL_STEPS[step]!;
        w.image.setFrame(w.frames[step]!);
        for (const d of w.dressing) for (const image of d.images) image.setVisible(d.top <= height);
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
