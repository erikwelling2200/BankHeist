import type { Facing, Size } from '../../level/space';
import { PAL } from '../palette';
import { roundBands, rows, Turn, View, type PropArt } from './view';

/*
 * Street furniture, each drawn from its catalog box in its own frame (front towards +y). Round things are round in
 * every view; what changes with the facing is what sticks out of them.
 */

const IRON = PAL.steel;

/** A cast-iron street lamp: a stepped foot, a fluted post, a collar, then a glass lantern under a cap and finial. */
export function streetLamp(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { margin: 2, headroom: 1 });
    const cx = t.w / 2, cy = t.d / 2, lantern = s.h - 9;
    const iron = (s: number) => roundBands([IRON[0], IRON[1], IRON[1], IRON[2], IRON[3]], s);
    view.cylinder(cx, cy, 2, 0, 2, iron, () => IRON[2]);
    view.cylinder(cx, cy, 1.5, 2, 3, iron, () => IRON[3]);
    view.cylinder(cx, cy, 1, 5, lantern - 7, (s, v) => (s < 0 ? (v % 6 === 0 ? IRON[2] : IRON[3]) : IRON[1]), null);
    view.cylinder(cx, cy, 1.5, lantern - 2, 2, iron, () => IRON[3]);
    // The lantern: four glass panes between iron corners, a ledge under it and a pyramid cap over it.
    view.block(-1, -1, lantern - 1, 6, 6, 1, IRON[2], IRON[1]);
    view.block(-1, -1, lantern, 6, 6, 5, null, (u, v) => (u === 0 || u === 5 ? IRON[1] : v === 0 ? IRON[2] : u < 3 ? PAL.glass[4] : PAL.glass[3]));
    view.block(-2, -2, lantern + 5, 8, 8, 1, IRON[3], IRON[1], { corner: 1 });
    view.block(-1, -1, lantern + 6, 6, 6, 1, IRON[3], IRON[2], { corner: 1 });
    view.block(0, 0, lantern + 7, 4, 4, 1, IRON[4], IRON[2], { corner: 1 });
    view.cylinder(cx, cy, 0.6, lantern + 8, 1, () => IRON[3], () => IRON[4]);
    view.outline(0.3);
    return view.art();
}

/**
 * A fire hydrant: a flanged foot, a red barrel, a bonnet and a domed top with its operating nut. Two hose nozzles stick
 * out to its sides and the big pumper nozzle out of its front, so the four views differ by where they point.
 */
export function hydrant(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { margin: 1 });
    const red = PAL.carpet, cx = t.w / 2, cy = t.d / 2;
    const paint = (s: number) => roundBands([red[0], red[1], red[2], red[3], red[4]], s);
    const nozzles = [
        { x: -1, y: s.d / 2 - 0.5, z: 5, c: red[2], cap: red[1] },
        { x: s.w, y: s.d / 2 - 0.5, z: 5, c: red[2], cap: red[1] },
        { x: s.w / 2 - 0.5, y: s.d, z: 4, c: red[3], cap: PAL.brass[3] }
    ].map(n => ({ ...n, at: t.pixel(n.x, n.y) }));
    const nozzle = (n: (typeof nozzles)[number]) => {
        const [x, y] = n.at;
        view.face(x, n.z, n.c, y + 1);
        view.face(x, n.z + 1, n.c, y + 1);
        view.top(x, y, n.z + 1, red[4]);
    };
    for (const n of nozzles.filter(n => n.at[1] < cy)) nozzle(n);
    view.cylinder(cx, cy, 2.5, 0, 1, s => (s < -0.3 ? red[2] : red[1]), () => red[3]);
    view.cylinder(cx, cy, 1.8, 1, s.h - 3, paint, null);
    view.cylinder(cx, cy, 2.2, s.h - 2, 1, s => (s < 0 ? red[3] : red[2]), () => red[4]);
    view.cylinder(cx, cy, 1.4, s.h - 1, 1, paint, (s, t) => (s * s + t * t < 0.2 ? PAL.brass[3] : red[4]));
    for (const n of nozzles.filter(n => n.at[1] >= cy)) nozzle(n);
    // The pumper nozzle's cap faces the camera when the hydrant does.
    if (facing === 'south') view.face(Math.floor(cx), 4, PAL.brass[4], t.d + 1);
    view.outline(0.3);
    return view.art();
}

/** A steel bollard with a domed head and a reflective band. */
export function bollard(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    view.cylinder(t.w / 2, t.d / 2, t.w / 2, 0, s.h - 1, (s, v) => (v === 2 || v === 3 ? (s < 0.3 ? PAL.paper[3] : PAL.paper[1]) : s < 0 ? IRON[3] : IRON[2]), null);
    view.cylinder(t.w / 2, t.d / 2, t.w / 2 - 0.4, s.h - 1, 1, s => (s < 0 ? IRON[4] : IRON[3]), () => IRON[5]);
    view.outline(0.3);
    return view.art();
}

/** A newspaper vending box on a post: the day's front page behind its window, a coin slot, the masthead on its sides. */
export function newsBox(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const body = PAL.cloth.teal, legs = 3, h = s.h - legs;
    const front = (u: number, v: number) => {
        if (v === 0) return body[3]!;
        if (v >= 2 && v < 8 && u >= 1 && u < s.w - 1) {
            if (v === 2) return PAL.glass[3];
            if (v === 3) return u < s.w - 2 ? PAL.ink : PAL.paper[2];
            if (v >= 5 && u <= 2) return PAL.steel[2];
            return v % 2 ? PAL.paper[1] : PAL.paper[2];
        }
        if (v === 9 && u === s.w - 2) return PAL.steel[4];
        if (v === 9 && u >= 1 && u <= 3) return body[1]!;
        return body[2]!;
    };
    const side = (u: number, v: number) => (v === 0 ? body[3]! : v >= 2 && v <= 3 && u >= 1 && u < s.d - 1 ? (v === 2 ? PAL.paper[3] : PAL.carpet[3]) : body[1]!);
    t.draw(view, [
        [{ x: 2, y: 2, z: 0, w: 3, d: 2, h: legs }, { top: IRON[1], sides: (u: number) => (u === 0 ? IRON[3] : IRON[1]) }],
        [{ x: 0, y: 0, z: legs, w: s.w, d: s.d, h }, { top: rows(v => (v === s.d - 1 ? body[3]! : v === 1 ? PAL.ink : body[2]!)), front, back: rows(v => (v === 0 ? body[2]! : body[1]!)), sides: side, corner: 1 }]
    ]);
    view.outline(0.3);
    return view.art();
}

/** A round slatted litter bin in green paint on a cast foot, its liner showing at the mouth. */
export function streetBin(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const g = PAL.leaf, r = t.w / 2;
    view.cylinder(r, t.d / 2, r, 0, 2, s => (s < 0 ? IRON[2] : IRON[1]), null);
    const body = s.h - 2;
    view.cylinder(r, t.d / 2, r, 2, body, (across, v) => {
        if (v === 0) return across < 0 ? g[4] : g[3];
        if (v === body - 1) return g[1];
        const slat = Math.floor((across + 1) * r * 0.99) % 2 === 0;
        return slat ? (Math.abs(across) > 0.7 ? g[1] : across < -0.1 ? g[3] : g[2]) : g[1];
    }, (across, deep) => {
        const d = across * across + deep * deep;
        return d > 0.6 ? (deep < 0 ? g[3] : g[4]) : d > 0.35 ? PAL.steel[2] : PAL.ink;
    });
    view.outline(0.3);
    return view.art();
}

/** A cast-iron manhole cover flush with the road: a raised rim, ribs across it and two lifting slots, turned with the facing. */
export function manhole(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, 0, { depthScale: 1 });
    const r = s.w / 2;
    for (let y = 0; y < s.d; y++) for (let x = 0; x < s.w; x++) {
        const d = Math.hypot(x + 0.5 - r, y + 0.5 - r);
        if (d > r) continue;
        let c: number = d > r - 1 ? IRON[0] : y % 2 === 0 ? IRON[2] : IRON[1];
        if ((x === 2 || x === s.w - 3) && y === Math.floor(r)) c = PAL.ink;
        const [vx, vy] = t.pixel(x, y);
        view.top(vx, vy, 0, c);
    }
    return view.art();
}
