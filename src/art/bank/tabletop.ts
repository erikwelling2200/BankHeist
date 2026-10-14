import type { Facing, Size } from '../../level/space';
import { PAL, mix } from '../palette';
import { PLASTIC } from './furniture';
import { CASH } from './rooms';
import { NORMAL, part, roundBands, rows, Turn, View, type PropArt } from './view';

/*
 * The second tier: small things that stand on a desk, a table or a counter, so a room can be dressed for whoever works
 * in it. Each is drawn from its catalog box in its own frame (x across its front, y from its back to its front, z up
 * from the top it stands on); the scene puts it on that top and draws it just after the thing under it.
 */

const S = PAL.steel, K = PAL.cloth.charcoal, C = PAL.cloth.white, W = PAL.walnut;

/** A flat screen on a foot and a short neck, the picture on its front; the foot reaches forward under the screen. */
export function monitor(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const mid = Math.floor(s.w / 2), panel = 2, tall = s.h - panel;
    t.draw(view, [
        [part(mid - 1, 0, 0, 3, s.d, 1), { top: rows(v => (v === s.d - 1 ? K[3]! : K[2]!)), sides: K[1]!, corner: 1 }],
        [part(mid, 0, 1, 1, 1, panel), { sides: K[2]!, top: K[3]! }],
        [part(0, 1, panel, s.w, 1, tall), {
            top: K[3]!, sides: rows(v => (v === 0 ? K[3]! : K[2]!)), corner: 1,
            front: (u, v) => (u === 0 || u === s.w - 1 || v === 0 || v === tall - 1 ? K[1]! : PAL.emissive.screen[0]),
            back: (u, v) => (v === 0 ? K[3]! : Math.abs(u - mid) <= 1 && v > 0 && v < tall - 1 ? K[1]! : K[2]!)
        }]
    ]);
    // The picture: a bright title bar over a page of grey lines, unlit, on whichever view sees the screen.
    if (t.seen === 'front') for (let u = 1; u < s.w - 1; u++) for (let v = 1; v < tall - 1; v++) {
        const c = v === 1 ? (u === 1 ? PAL.emissive.screen[2] : PAL.emissive.screen[1]) : u < s.w - 3 ? PAL.emissive.screen[0] : PAL.emissive.screen[1];
        view.glowFace(u, s.h - v, c, s.d - 1);
    }
    t.light(view, s.w / 2, s.d, panel + 2, 20, 0x7fd8e8, 0.45);
    view.outline(0.3);
    return view.art();
}

/**
 * An arched desk lamp: a round weighted foot at the back, a brass arm curving up and over, a cream enamel dome at its end
 * looking down at the desk in front, the bulb glowing warm under its rim.
 */
export function deskLamp(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const cx = s.w / 2, foot = 1.3, head = s.d - 1.7, B = PAL.brass, E = [PAL.paper[0], PAL.paper[1], PAL.paper[2], PAL.paper[3], PAL.paper[3]];
    const [fx, fy] = t.point(cx, foot), [hx, hy] = t.point(cx, head);
    const drawFoot = () => view.cylinder(fx, fy, 1.3, 0, 1, a => roundBands([B[0], B[1], B[2], B[3], B[4]], a), (a, b) => (a * a + b * b < 0.3 ? B[3] : B[4]));
    // The arm leaves the foot straight up and comes over to the top of the dome: a quarter of an ellipse.
    const drawArm = () => {
        for (let f = 0; f <= 1; f += 0.02) {
            const angle = (f * Math.PI) / 2, [x, y] = t.point(cx, foot + (head - foot) * (1 - Math.cos(angle)));
            const [col, row] = view.project(x, y, 1.5 + (s.h - 1) * Math.sin(angle));
            view.dot(col, row, f > 0.4 && f < 0.85 ? B[5] : B[4], f > 0.5 ? NORMAL.top : NORMAL.face);
        }
    };
    // A dome: a wide rim under a narrower crown, the bulb showing under the rim.
    const drawShade = () => {
        for (const col of [Math.floor(hx - 0.5), Math.floor(hx + 0.5)]) view.glowFace(col, s.h - 3, PAL.emissive.lampWarm[col < hx ? 0 : 1], hy + 0.5);
        view.cylinder(hx, hy, 1.7, s.h - 3, 1, a => roundBands(E, a), null);
        view.cylinder(hx, hy, 1.2, s.h - 2, 1, a => roundBands(E, a), (a, b) => (a < 0 && b < 0.2 ? E[4]! : E[3]!));
    };
    drawFoot();
    // Whichever of the foot and the dome is further from the camera goes first, the arm between them.
    for (const draw of hy < fy ? [drawShade, drawArm] : [drawArm, drawShade]) draw();
    t.light(view, cx, head, s.h - 3, 40, 0xffcf8a, 1.0);
    // A light edge: a heavier one would swallow the one-pixel arm.
    view.outline(0.15);
    return view.art();
}

/** A manila folder with loose sheets on it, squared off, a black binder clip and a yellow sticky note on top. */
export function paperStack(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const M = PAL.plywood, P = PAL.paper;
    t.draw(view, [
        [part(1, 0, 0, s.w - 1, s.d, 1), { top: (u, v) => (v === 0 && u >= s.w - 4 ? M[3] : v === s.d - 1 ? M[4] : M[3]), sides: rows(() => M[2]) }],
        [part(0, 1, 1, s.w - 2, s.d - 1, 1), {
            top: (u, v) => (u === 0 && v === 0 ? PAL.ink : u === s.w - 4 && v === 1 ? PAL.cloth.mustard[3]! : v === s.d - 2 ? P[3] : P[2]),
            sides: (u: number) => (u % 2 ? P[1] : P[2])
        }]
    ]);
    view.outline(0.25);
    return view.art();
}

/** A mug of coffee with its handle on its right; its colour from a seed, so a desk's mug isn't the break room's. */
export function mug(s: Size, facing: Facing, seed: number): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { margin: 1 });
    const colours = [PAL.paper[3], PAL.carpet[3], PAL.cloth.navy[3]!, PAL.cloth.teal[3]!, PAL.cloth.mustard[3]!];
    const c = colours[Math.abs(seed) % colours.length]!, dark = mix(c, PAL.ink, 0.3);
    const [x, y] = t.point(s.w / 2, s.d / 2), [hx, hy] = t.point(s.w + 0.5, s.d / 2);
    const handle = () => view.face(Math.floor(hx), s.h, dark, Math.min(hy + 0.5, t.d));
    if (hy <= y) handle();
    view.cylinder(x, y, s.w / 2, 0, s.h, a => (a < 0 ? c : dark), () => W[1]);
    if (hy > y) handle();
    view.outline(0.2);
    return view.art();
}

/** A brass photo frame standing on its strut: a face against a blue sky from the front, card and the strut behind. */
export function photoFrame(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const B = PAL.brass, mid = Math.floor(s.w / 2);
    const rim = (u: number, v: number) => u === 0 || u === s.w - 1 || v === 0 || v === s.h - 1;
    const picture = (u: number, v: number) => (rim(u, v) ? (v === 0 ? B[4] : B[2]) : u === 1 ? PAL.skin.pale[2] : PAL.emissive.sky[0]);
    t.draw(view, [
        [part(mid, 0, 0, 1, 1, s.h - 1), { sides: PAL.plywood[1], top: PAL.plywood[2] }],
        [part(0, 1, 0, s.w, 1, s.h), { front: picture, back: (u, v) => (rim(u, v) ? (v === 0 ? B[4] : B[2]) : PAL.plywood[2]), sides: rows(v => (v === 0 ? B[4] : B[2])), top: B[4] }]
    ]);
    view.outline(0.2);
    return view.art();
}

/**
 * A note counter: a pale grey machine with notes waiting in the hopper on its back, the counted ones in the stacker at
 * its front and a red count glowing in its display.
 */
export function cashCounter(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const P = PLASTIC, body = s.h - 1;
    t.draw(view, [
        [part(0, 0, 0, s.w, s.d, body), {
            top: rows(v => (v === s.d - 1 ? P[4] : P[3])),
            front: (u, v) => (v === 0 ? (u === 0 || u === s.w - 1 ? P[3] : S[0]) : u === 0 || u === s.w - 1 ? P[2] : CASH[1]),
            back: rows(v => (v === 0 ? P[3] : P[1])), sides: rows(v => (v === 0 ? P[3] : P[2])), corner: 1
        }],
        [part(0, 0, body, s.w, 2, 1), {
            top: (u: number) => (u === 0 || u === s.w - 1 ? P[3] : u === 1 ? CASH[2] : CASH[1]), sides: rows(() => P[2]),
            front: (u: number) => (u === 0 || u === s.w - 1 ? P[3] : CASH[0])
        }]
    ]);
    if (t.seen === 'front') for (let u = 1; u < s.w - 1; u++) view.glowFace(u, body, u === 1 ? PAL.emissive.ledRed : mix(PAL.emissive.ledRed, PAL.ink, 0.35));
    view.outline(0.3);
    return view.art();
}

/** A white microwave: a dark glass door with its handle, the clock glowing green on the panel beside it, vents behind. */
export function microwave(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const door = s.w - 2;
    t.draw(view, [[part(0, 0, 0, s.w, s.d, s.h), {
        top: rows(v => (v === s.d - 1 ? C[3]! : C[2]!)),
        front: (u, v) => {
            if (v === 0) return C[3]!;
            if (v === s.h - 1) return C[1]!;
            if (u < door) return u === 0 ? C[2]! : v === 1 ? PAL.glass[2] : PAL.ink;
            return u === door ? C[1]! : v === 2 ? S[2] : C[2]!;
        },
        back: (u, v) => (v === 0 ? C[2]! : v === 1 && u > 0 && u < s.w - 1 && u % 2 === 1 ? S[2] : C[1]!),
        sides: rows(v => (v === 0 ? C[3]! : v === s.h - 1 ? C[1]! : C[2]!))
    }]]);
    if (t.seen === 'front') view.glowFace(s.w - 1, s.h - 1, PAL.emissive.exitGreen[1]);
    view.outline(0.3);
    return view.art();
}

/**
 * A round sponge cake iced pink on a white plate, piped round its edge with a cherry on top, a quarter of it eaten: from
 * where the camera sees the gap, the cut shows the cream and the sponge; elsewhere the plate shows through the top.
 */
export function cake(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const [cx, cy] = t.point(s.w / 2, s.d / 2), plate = s.w / 2, r = plate - 0.3, P = PAL.paper, R = PAL.carpet;
    const pink = [mix(R[2], P[1], 0.35), mix(R[3], P[2], 0.45), mix(R[4], P[3], 0.55), mix(R[4], P[3], 0.72)];
    /** The eaten quarter, its front right in the cake's own frame. */
    const eaten = (a: number, b: number) => {
        const [x, y] = t.direction(a, b);
        return x > 0.05 && y > 0.05;
    };
    view.cylinder(cx, cy, plate, 0, 0, null, (a, b) => (a * a + b * b > 0.55 ? C[3]! : C[2]!));
    // Each column shows the cake's nearest point: its iced side on the rim, or a cut face further back where the gap is.
    for (let x = Math.floor(cx - r); x < Math.ceil(cx + r); x++) {
        const a = (x + 0.5 - cx) / r;
        if (Math.abs(a) > 1) continue;
        const rim = Math.sqrt(1 - a * a);
        let b = rim;
        while (b > -rim && eaten(a, b)) b -= 0.05;
        if (eaten(a, b)) continue;
        const cut = b < rim - 0.01;
        for (let k = 1; k <= s.h; k++) {
            const colour = cut ? (k === s.h ? P[3] : PAL.cloth.mustard[3]!) : k === s.h ? pink[3]! : roundBands([pink[0]!, pink[0]!, pink[1]!, pink[2]!, pink[3]!], a);
            view.face(x, k, colour, cy + b * r, cut ? NORMAL.face : NORMAL.slope);
        }
    }
    for (let y = Math.floor(cy - r); y < Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x < Math.ceil(cx + r); x++) {
        const a = (x + 0.5 - cx) / r, b = (y + 0.5 - cy) / r;
        if (a * a + b * b > 1 || eaten(a, b)) continue;
        const edge = a * a + b * b > 0.5;
        view.top(x, y, s.h, Math.abs(a) < 0.3 && Math.abs(b) < 0.3 ? R[3] : edge && (x + y) % 2 === 0 ? P[3] : pink[3]!);
    }
    view.outline(0.2);
    return view.art();
}
