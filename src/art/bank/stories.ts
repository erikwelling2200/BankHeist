import type { Facing, Size } from '../../level/space';
import { PAL, mix } from '../palette';
import { NORMAL, norm, part, roundBands, rows, softBody, Turn, View, type Faces, type Part, type PropArt, type Vec3Like } from './view';

/*
 * Furniture that says what a staff room is for and what just happened in it: the conference room's long table, the
 * manager's coat stand, cash bags waiting to be counted, the cleaner's trolley and the sign they put out. Drawn from
 * their catalog boxes in their own frames, like every prop; soft and round things (a coat, a sack) as curves.
 */

const S = PAL.steel, W = PAL.walnut;

/**
 * A conference room's long walnut table: a veneered top with rounded ends on two panel legs joined by a stretcher, a
 * steel power box flush in the middle of the top.
 */
export function meetingTable(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const slab = 2, legs = s.h - slab, inset = 6, mid = Math.floor(s.w / 2), box = Math.floor(s.d / 2) - 1;
    const parts: [Part, Faces][] = [];
    for (const x of [inset, s.w - inset - 2]) parts.push([part(x, 3, 0, 2, s.d - 6, legs), {
        front: rows(v => (v === legs - 1 ? W[1] : W[2])), back: W[1], top: W[2],
        sides: (u, v) => (v === legs - 1 || u === 0 || u === s.d - 7 ? W[1] : v === 0 ? W[3] : W[2])
    }]);
    parts.push([part(inset + 2, Math.floor(s.d / 2), legs - 3, s.w - inset * 2 - 4, 1, 2), { sides: rows(v => (v === 0 ? W[3] : W[1])), top: W[2] }]);
    parts.push([part(0, 0, legs, s.w, s.d, slab), {
        top: (u, v) => {
            if (v === s.d - 1) return W[5];
            if (v === 0) return W[3];
            if (u >= mid - 2 && u < mid + 2 && v >= box && v < box + 2) return u === mid - 1 && v === box + 1 ? PAL.ink : v === box ? S[2] : S[3];
            // Veneer: long streaks of darker grain along the table, two rows deep so they survive the foreshortening.
            const band = Math.floor(v / 4);
            return v % 4 !== 0 && v % 4 !== 3 && (Math.floor((u + band * 5) / 7) * 3 + band) % 4 === 0 ? W[3] : W[4];
        },
        sides: rows(v => (v === 0 ? W[4] : W[2])), corner: 3
    }]);
    t.draw(view, parts);
    view.outline(0.3);
    return view.art();
}

/**
 * A bentwood coat stand: a round foot, a turned walnut pole, four brass hooks curling up at the top, and a camel coat
 * hung by its loop from the front hook, its back against the pole. From the front the camera sees the coat's buttons
 * and belt, from behind its back vent through the pole, from the sides a sleeve.
 */
export function coatStand(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { margin: 1 });
    const mid = s.w / 2, pole = s.h - 2, hookZ = s.h - 3, hem = 6, len = hookZ - 1 - hem;
    const [cx, cy] = t.point(mid, s.d / 2);
    const wood = (a: number) => roundBands([W[1], W[2], W[3], W[4], W[5]], a);
    const B = PAL.cloth.beige, coatRamp = [B[0]!, B[1]!, B[2]!, B[3]!, mix(B[3]!, 0xffffff, 0.15)];
    const belt = Math.round(len * 0.42), collar = len - 3;
    const coatPaint = (a: number, k: number, onTop: boolean): number => {
        if (onTop) return k >= collar ? B[3]! : B[2]!;
        const base = roundBands(coatRamp, a), centre = Math.abs(a) < 0.18;
        if (k === belt) return centre && t.seen === 'front' ? PAL.brass[3] : B[1]!;
        // From the front or behind, the sleeves hang down either side of the body to their cuffs.
        const sleeve = (t.seen === 'front' || t.seen === 'back') && k >= belt - 1 && k < collar && Math.abs(Math.abs(a) - 0.68) < 0.1;
        if (t.seen === 'front') {
            if (k >= collar) return Math.abs(a) < 0.45 ? (centre ? B[1]! : B[3]!) : base;
            if (centre || sleeve) return B[1]!;
            if ((k === belt + 2 || k === belt + 4) && Math.abs(a + 0.4) < 0.15) return W[1];
        } else if (t.seen === 'back') {
            if ((centre && k < 4) || sleeve) return B[1]!;
        } else if (k > belt - 2 && k < collar && Math.abs(Math.abs(a) - 0.4) < 0.12) {
            // Seen from a side, the sleeve hangs down the middle of the coat.
            return B[1]!;
        }
        return base;
    };
    // Narrow at the collar where it hangs off the hook, round over the shoulders, then falling a little wider to the hem.
    const across = (k: number) => {
        const f = k / (len - 1);
        return f > 0.82 ? 1 + 1.6 * Math.sqrt(Math.max(0, 1 - ((f - 0.82) / 0.2) ** 2)) : 2.9 - 0.35 * f;
    };
    const deep = (k: number) => (k / (len - 1) > 0.9 ? 0.7 : 1.1 + 0.3 * (1 - k / (len - 1)));
    const sideOn = facing === 'east' || facing === 'west';
    const [kx, ky] = t.point(mid, s.d / 2 + 1.6);
    const items: { y: number; draw: () => void }[] = [
        { y: cy, draw: () => {
            view.cylinder(cx, cy, 0.6, 1, pole - 1, wood, null);
            view.cylinder(cx, cy, 0.9, pole, 1, wood, (a, b) => (a < 0 && b < 0 ? W[5] : W[4]));
        } },
        { y: ky + 0.01, draw: () => softBody(view, kx, ky, hem, len, k => (sideOn ? [deep(k), across(k)] : [across(k), deep(k)]), coatPaint) }
    ];
    // Each hook leaves the pole, dips and curls back up to a brass knob.
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
        const [, tipY] = t.point(mid + dx * 2.5, s.d / 2 + dy * 2.5);
        items.push({ y: tipY, draw: () => {
            for (let f = 0; f <= 1; f += 0.04) {
                const r = 0.6 + 1.9 * f, [x, y] = t.point(mid + dx * r, s.d / 2 + dy * r);
                const [col, row] = view.project(x, y, hookZ - 2.4 * f + 2.4 * f ** 3 + 0.5);
                view.dot(col, row, f > 0.85 ? PAL.brass[4] : PAL.brass[2], f > 0.85 ? NORMAL.top : NORMAL.face);
            }
        } });
    }
    view.cylinder(cx, cy, 2.6, 0, 1, wood, (a, b) => (a * a + b * b > 0.5 ? W[4] : W[3]));
    view.cylinder(cx, cy, 1.1, 1, 1, wood, () => W[4]);
    for (const item of items.sort((a, b) => a.y - b.y)) item.draw();
    view.outline(0.3);
    return view.art();
}

/**
 * Canvas deposit bags slumped on the floor waiting to be counted: a big white one and a smaller one upright, tied at the
 * neck with a cord and a red seal and stamped in blue with the bank's mark, a navy one lying against them in front.
 */
export function cashBags(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { margin: 1 });
    const P = PAL.paper, N = PAL.cloth.navy;
    const canvas = [P[0], P[1], P[2], P[3]], navy = [N[1]!, N[2]!, N[3]!, mix(N[3]!, 0xffffff, 0.2)];
    // Each bag: its middle in the own frame, its half-width and half-depth, and how full each row is from the floor up;
    // an upright bag pinches to its neck under a flared tuft.
    const bags = [
        { x: 3.6, y: 3.0, a: 3.0, b: 2.4, rows: [0.85, 1, 1, 0.85, 0.35, 0.6], ramp: canvas, mark: mix(N[3]!, P[2], 0.3) },
        { x: 8.4, y: 2.0, a: 1.9, b: 1.6, rows: [0.9, 1, 0.7, 0.3, 0.55], ramp: canvas, mark: mix(N[3]!, P[2], 0.3) },
        { x: 7.6, y: 5.0, a: 2.8, b: 1.6, rows: [1, 0.95, 0.65], ramp: navy, mark: P[2] }
    ].map(bag => ({ ...bag, at: t.point(bag.x, bag.y) }));
    for (const bag of bags.sort((p, q) => p.at[1] - q.at[1])) {
        const [rx, ry] = facing === 'east' || facing === 'west' ? [bag.b, bag.a] : [bag.a, bag.b];
        const neck = bag.rows.length - 2, upright = bag.rows[neck]! < 0.5, R = bag.ramp;
        softBody(view, bag.at[0], bag.at[1], 0, bag.rows.length, k => [rx * bag.rows[k]!, ry * bag.rows[k]!], (a, k, onTop) => {
            if (upright && k === neck) return Math.abs(a) < 0.4 ? PAL.carpet[4] : S[1];
            if (upright && k > neck) return a < 0 ? R[3]! : R[2]!;
            if (!onTop && k === 2 && Math.abs(a + 0.1) < 0.3) return bag.mark;
            // Three soft tones, lit from the left and above, so a bag reads as one lump rather than a stack of rings.
            return a < -0.1 || (onTop && a < 0.4) ? R[3]! : a < 0.55 ? R[2]! : R[1]!;
        });
    }
    view.outline(0.3);
    return view.art();
}

/**
 * The cleaner's trolley: grey plastic on castors, a caddy of shelves with toilet rolls, a bottle and a box, spray bottles
 * on its top, and a yellow mop bucket with its wringer, the mop standing in it.
 */
export function cleaningTrolley(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { margin: 1 });
    const Y = PAL.cloth.mustard, deck = 2, caddy = 5, shelf = 11, tall = shelf - deck;
    const parts: [Part, Faces][] = [];
    for (const [x, y] of [[0, 0], [s.w - 1, 0], [0, s.d - 1], [s.w - 1, s.d - 1]] as const) parts.push([part(x, y, 0, 1, 1, 1), { sides: PAL.ink, top: PAL.ink }]);
    parts.push([part(0, 0, 1, s.w, s.d, 1), { top: rows(v => (v === s.d - 1 ? S[4] : S[3])), sides: S[2] }]);
    t.draw(view, parts);
    const front = (u: number, v: number) => {
        if (v === 0) return S[4];
        if (v === tall - 1) return S[2];
        if (u === 0 || u === caddy - 1 || v === 4) return S[3];
        if (v < 4) return u === 3 ? (v === 1 ? PAL.cloth.denim[3]! : PAL.cloth.denim[2]!) : v === 1 ? PAL.paper[3] : PAL.paper[2];
        return v >= 6 && u < 3 ? (v === 6 ? PAL.plywood[4] : PAL.plywood[3]) : S[0];
    };
    const drawCaddy = () => {
        t.draw(view, [
            [part(0, 0, deck, caddy, s.d, tall), {
                front, back: rows(v => (v === 0 ? S[4] : S[2])), sides: rows(v => (v === 0 ? S[4] : v === 4 ? S[3] : S[2])), top: rows(v => (v === s.d - 1 ? S[4] : S[3]))
            }],
            [part(0, 3, shelf, 2, 2, 0), { top: Y[3]! }]
        ]);
        // Spray bottles on top: a blue one and a green one, each with a white trigger head.
        const bottles = [{ x: 1.4, y: 1.6, h: 3, ramp: PAL.cloth.denim }, { x: 3.4, y: 3.6, h: 2, ramp: PAL.leaf.slice(2) }].map(b => ({ ...b, at: t.point(b.x, b.y) }));
        for (const { at, h, ramp } of bottles.sort((p, q) => p.at[1] - q.at[1])) {
            view.cylinder(at[0], at[1], 0.8, shelf, h, a => (a < 0 ? ramp[3]! : ramp[2]!), () => ramp[3]!);
            view.cylinder(at[0], at[1], 0.5, shelf + h, 1, () => PAL.paper[3], () => PAL.paper[3]);
        }
    };
    const bx = 9.4, by = s.d / 2, [vx, vy] = t.point(bx, by);
    const drawBucket = () => {
        view.cylinder(vx, vy, 2.5, deck, 5, (a, v) => (v === 0 ? Y[3]! : roundBands([Y[0]!, Y[1]!, Y[2]!, Y[3]!, mix(Y[3]!, 0xffffff, 0.3)], a)),
            (a, b) => (a * a + b * b > 0.55 ? Y[3]! : (Math.round(a * 4) + Math.round(b * 3)) % 2 === 0 ? PAL.paper[1] : PAL.cloth.teal[1]!));
        t.draw(view, [[part(8, 0, deck + 5, 3, 2, 2), { top: S[3], sides: rows(v => (v === 0 ? S[4] : S[2])) }]]);
        // The mop's handle leans back out of the bucket.
        for (let z = deck + 5; z <= s.h; z++) {
            const f = (z - deck - 5) / (s.h - deck - 5), [hx, hy] = t.point(bx + 0.4 + f, by + 0.4 - f * 1.6);
            const [col, row] = view.project(hx, hy, z);
            view.dot(col, row, z >= s.h - 1 ? PAL.cloth.denim[3]! : PAL.oak[3]);
        }
    };
    const [, caddyY] = t.point(caddy / 2, s.d / 2);
    for (const draw of caddyY < vy ? [drawCaddy, drawBucket] : [drawBucket, drawCaddy]) draw();
    view.outline(0.3);
    return view.art();
}

/**
 * A yellow A-frame wet floor sign: two panels leaning together, a handle cut through the top, a black warning triangle
 * and a line of lettering printed on both. Each panel is drawn point by point where it stands, back to front, so from
 * the side it is the A and from the front or behind a printed panel.
 */
export function wetFloorSign(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const M = PAL.cloth.mustard, Y = [M[1]!, M[2]!, mix(M[3]!, PAL.brass[4], 0.6), PAL.brass[4]], ink = mix(PAL.ink, M[1]!, 0.25);
    const apex = s.d / 2, last = s.w - 1;
    // A handle cut through the top, a black warning triangle and a line of lettering, printed on both panels.
    const edge = (u: number) => u === 0 || u === last, faint = mix(ink, Y[2]!, 0.45);
    const print = (u: number, v: number): number | null => {
        if (v === 0) return edge(u) ? null : Y[3]!;
        if (v === 1) return edge(u) ? Y[2]! : Y[0]!;
        if (v === 3) return edge(u) ? Y[2]! : faint;
        if (v === 4) return edge(u) ? faint : ink;
        if (v === 6) return u === last ? Y[2]! : faint;
        if (v === s.h - 1) return Y[1]!;
        return Y[2]!;
    };
    const [ox, oy] = t.point(0, 0);
    const dots: { y: number; z: number; col: number; row: number; colour: number; normal: Vec3Like }[] = [];
    for (const side of [-1, 1]) {
        // The panel's outward normal leans out and up; turned into the view, it says how the panel catches the light.
        const [nx, ny] = t.point(0, side), normal = norm((nx - ox) * 0.8, (ny - oy) * 0.45 - (apex / s.h) * 0.55, 0.85);
        for (let z = 0.25; z < s.h; z += 0.5) for (let x = 0.25; x < s.w; x += 0.5) {
            const [vx, vy] = t.point(x, apex + side * apex * (1 - z / s.h));
            const colour = print(Math.floor(side > 0 ? x : s.w - x), Math.floor(s.h - z));
            if (colour === null) continue;
            const [col, row] = view.project(vx, vy, z + 0.5);
            dots.push({ y: vy, z, col, row, colour, normal });
        }
    }
    for (const d of dots.sort((a, b) => a.y - b.y || a.z - b.z)) view.dot(d.col, d.row, d.colour, d.normal);
    view.outline(0.25);
    return view.art();
}
