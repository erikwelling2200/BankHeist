import { TILE } from '../../level/level';
import { floorHeight, RAISED_HEIGHT, type Level } from '../../level/plan';
import { CUT_HEIGHT } from '../../level/space';

/**
 * How high a raised storey is drawn, lowest first: cut down to a plinth the height walls are cut to, half way, and a full
 * storey. Raised floors are drawn where they are, lifted up the screen by their height (a point at height z lands z rows
 * up), so a storey hides the floor behind it as a wall does; like walls, they step between these heights.
 */
export const STOREY_STEPS = [CUT_HEIGHT, Math.round((CUT_HEIGHT + RAISED_HEIGHT) / 2), RAISED_HEIGHT] as const;

/**
 * A raised region stands a full storey while the middle of the screen is no more than `STAND_BEHIND` pixels north of its
 * north edge (the camera looks at it, or past it to the south, and it is the backdrop), and is cut down once the middle
 * is more than `CUT_BEHIND` north of it (the camera looks at the floor it would hide). In between it keeps its height.
 */
const STAND_BEHIND = 8;
const CUT_BEHIND = 2 * TILE;
const STEP_MS = 40;

/** A block of raised tiles and stairs that touch: the north edge of its northernmost row, and its step. */
interface Region { north: number; step: number; target: number }

/**
 * The raised floors (§14.7): mezzanines, landings, upper floors across the street, scaffolding, and the stairs up to
 * them, each block of touching tiles a region. Everything standing on a region (its floor, walls, props, people) is drawn
 * lifted by its height as the region is drawn now: a full storey while the camera looks at it or past it, cut down to a
 * plinth while it looks at the floor north of it, which a full storey would hide, and on the tactical map, so the plan
 * reads. Listeners hear when a region changes step.
 */
export class Heights {
    private readonly regions: Region[] = [];
    /** The region of each tile, row by row, or -1 on the ground. */
    private readonly regionOf: Int32Array;
    private readonly heights: Float32Array;
    private readonly width: number;
    private readonly listeners: ((region: number) => void)[] = [];
    private clock = 0;

    constructor(level: Level) {
        const { tiles } = level, width = (this.width = tiles[0]!.length), height = tiles.length;
        this.regionOf = new Int32Array(width * height).fill(-1);
        this.heights = new Float32Array(width * height);
        tiles.forEach((row, y) => row.forEach((_, x) => (this.heights[y * width + x] = floorHeight(tiles, x, y))));
        for (let i = 0; i < width * height; i++) {
            if (this.heights[i] === 0 || this.regionOf[i] !== -1) continue;
            const id = this.regions.length, queue = [i];
            let north = Infinity;
            this.regionOf[i] = id;
            while (queue.length) {
                const j = queue.pop()!, x = j % width, y = Math.floor(j / width);
                north = Math.min(north, y * TILE);
                for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                    const k = ny * width + nx;
                    if (this.heights[k] !== 0 && this.regionOf[k] === -1) {
                        this.regionOf[k] = id;
                        queue.push(k);
                    }
                }
            }
            const top = STOREY_STEPS.length - 1;
            this.regions.push({ north, step: top, target: top });
        }
    }

    /** How many regions there are; each is numbered from 0. */
    get count(): number {
        return this.regions.length;
    }

    /** The region tile (tx, ty) belongs to, or -1 for the ground (and off the map). */
    region(tx: number, ty: number): number {
        if (tx < 0 || ty < 0 || tx >= this.width) return -1;
        return this.regionOf[ty * this.width + tx] ?? -1;
    }

    /** The step region `r` is drawn at now. */
    step(r: number): number {
        return this.regions[r]!.step;
    }

    /** Its real height (pixels), the storey's for a raised tile, part of it on a stair. */
    floor(tx: number, ty: number): number {
        if (tx < 0 || ty < 0 || tx >= this.width) return 0;
        return this.heights[ty * this.width + tx] ?? 0;
    }

    /** How far up the screen tile (tx, ty) is drawn when its region is at `step`: its height, scaled with the storey. */
    liftAtStep(tx: number, ty: number, step: number): number {
        const h = this.floor(tx, ty);
        return h === 0 ? 0 : Math.round((h * STOREY_STEPS[step]!) / RAISED_HEIGHT);
    }

    /** How far up the screen tile (tx, ty), and anything standing on it, is drawn now. */
    lift(tx: number, ty: number): number {
        const r = this.region(tx, ty);
        return r < 0 ? 0 : this.liftAtStep(tx, ty, this.regions[r]!.step);
    }

    /** The same for map point (x, y), in pixels. */
    liftAt(x: number, y: number): number {
        return this.lift(Math.floor(x / TILE), Math.floor(y / TILE));
    }

    /** Calls `listener` with a region's number whenever it changes step. */
    onChange(listener: (region: number) => void): void {
        this.listeners.push(listener);
    }

    /**
     * Picks each region's step from where the camera looks, the map row `middle` in the middle of the screen, and moves
     * changing regions a step towards it every `STEP_MS`, as walls are cut.
     */
    update(deltaMs: number, middle: number, onMap: boolean): void {
        const top = STOREY_STEPS.length - 1;
        for (const r of this.regions) {
            if (onMap) r.target = 0;
            else if (middle > r.north - STAND_BEHIND) r.target = top;
            else if (middle < r.north - CUT_BEHIND) r.target = 0;
        }
        this.clock += deltaMs;
        while (this.clock >= STEP_MS) {
            this.clock -= STEP_MS;
            let moving = false;
            this.regions.forEach((r, i) => {
                if (r.step === r.target) return;
                this.setStep(i, r.step + Math.sign(r.target - r.step));
                moving = true;
            });
            if (!moving) this.clock = 0;
        }
    }

    /** Puts every region at the step it is heading for at once. */
    settle(): void {
        this.regions.forEach((r, i) => r.step !== r.target && this.setStep(i, r.target));
    }

    get settled(): boolean {
        return this.regions.every(r => r.step === r.target);
    }

    /** Each region's north edge and the storey height it is drawn at, for tests. */
    get state(): { north: number; storey: number }[] {
        return this.regions.map(r => ({ north: r.north / TILE, storey: STOREY_STEPS[r.step]! }));
    }

    private setStep(region: number, step: number): void {
        this.regions[region]!.step = step;
        for (const listener of this.listeners) listener(region);
    }
}
