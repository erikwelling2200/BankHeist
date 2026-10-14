/** A point on the floor, in pixels. */
export type Point = readonly [number, number];

/**
 * One drawing held for `ms`. As it comes up the figure's footing jumps by `step`, then slides by `glide` while it is
 * shown. Stepping suits side-on walks, where the planted foot has to stay on its floor pixel; gliding suits walks
 * towards or away from the camera and slides. `cue` names something that happens as the cel comes up (a shot).
 */
export interface Cel<F extends string = string> {
    frame: F;
    ms: number;
    step?: Point;
    glide?: Point;
    cue?: string;
}

export interface TimelineState<F extends string> {
    /** Which cel is showing. */
    index: number;
    frame: F;
    /** The footing, on whole pixels. */
    x: number;
    y: number;
}

/** Cels repeated `count` times through `frames`, every one held `ms` and moving the same way. */
export function cycle<F extends string>(frames: readonly F[], ms: number, count: number, move: Pick<Cel, 'step' | 'glide'> = {}): Cel<F>[] {
    return Array.from({ length: count }, (_, i) => ({ frame: frames[i % frames.length]!, ms, ...move }));
}

/** A looping sequence of cels from a starting footing. */
export class Timeline<F extends string> {
    readonly duration: number;
    private readonly starts: number[] = [];
    /** The footing as each cel comes up, after its step. */
    private readonly origins: Point[] = [];
    readonly end: Point;

    constructor(readonly cels: readonly Cel<F>[], readonly start: Point) {
        if (!cels.length) throw new Error('A timeline needs at least one cel');
        let t = 0, at = start;
        for (const cel of cels) {
            if (cel.ms <= 0) throw new Error(`Cel '${cel.frame}' has no duration`);
            at = add(at, cel.step ?? [0, 0]);
            this.starts.push(t);
            this.origins.push(at);
            t += cel.ms;
            at = add(at, cel.glide ?? [0, 0]);
        }
        this.duration = t;
        this.end = at;
    }

    /** The cel showing `ms` into the loop and where the figure stands. */
    at(ms: number): TimelineState<F> {
        const t = ((ms % this.duration) + this.duration) % this.duration;
        let lo = 0, hi = this.cels.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (this.starts[mid]! <= t) lo = mid;
            else hi = mid - 1;
        }
        const cel = this.cels[lo]!, origin = this.origins[lo]!, f = (t - this.starts[lo]!) / cel.ms, glide = cel.glide ?? [0, 0];
        return { index: lo, frame: cel.frame, x: Math.round(origin[0] + glide[0] * f), y: Math.round(origin[1] + glide[1] * f) };
    }

    /** When cel `index` comes up, in ms from the start of the loop. */
    startOf(index: number): number {
        const start = this.starts[index];
        if (start === undefined) throw new Error(`No cel ${index}`);
        return start;
    }

    /** Where the footing is while cel `index` comes up. */
    originOf(index: number): Point {
        const origin = this.origins[index];
        if (!origin) throw new Error(`No cel ${index}`);
        return origin;
    }
}

const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
