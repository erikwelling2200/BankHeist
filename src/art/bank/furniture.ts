import { TILE } from '../../level/constants';
import type { LevelProp } from '../../level/plan';
import type { Facing, Size } from '../../level/space';
import { PAL, mix } from '../palette';
import { mulberry32 } from '../random';
import { NORMAL, part, roundBands, rows, Turn, View, type Faces, type Part, type PropArt } from './view';

/*
 * The lobby's furniture, each drawn from its catalog box in its own frame: x across its front, y from its back (0) to
 * its front, z up. Boxy furniture is built from parts whose every face is painted by hand; round and organic things
 * (a planter, leaves, a mug, a rope) are drawn as curves.
 */

const W = PAL.walnut, S = PAL.steel, L = PAL.cloth.burgundy;
/** Off-white office plastic, a little grubby in the shade. */
export const PLASTIC = [S[2], mix(PAL.paper[0], S[3], 0.5), PAL.paper[1], PAL.paper[2], PAL.paper[3]] as const;

/** Raised walnut panels a tile wide on a face `h` tall, a brass kick rail along the floor. */
function walnutPanel(w: number, h: number) {
    return (u: number, v: number): number => {
        const z = h - v, px = u % TILE;
        if (z <= 2) return z === 2 ? PAL.brass[3] : PAL.brass[1];
        if (z === h) return W[4];
        const inX = px > 2 && px < 13 && w - u > 2, inZ = z > 4 && z < h - 1;
        if (inX && inZ) return z === h - 2 ? W[4] : W[3];
        if ((px === 2 || px === 13) && z >= 4 && z <= h - 1) return W[1];
        if ((z === 4 || z === h - 1) && px >= 2 && px <= 13) return W[1];
        return W[2];
    };
}

/**
 * The teller counter: a walnut front 1.2m tall, its top the full depth of the row (a walnut work shelf at the back on
 * the teller side, green marble towards the customers, a recessed deal tray under each window). Teller glass 2.2m above
 * the floor stands on the top's front edge between brass posts. Each window has a monitor on the shelf, its screen
 * towards the teller, and an open window a banker's lamp; a closed one has a sign up behind its glass.
 */
export function counter(p: Extract<LevelProp, { kind: 'counter' }>, s: Size, facing: Facing): PropArt {
    const glass = 28, shelf = 6;
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { headroom: glass + 1, margin: 2 });
    const stations = p.stations.map(st => ({ sx: (st - p.tx) * TILE, closed: p.closed.includes(st) }));
    const gx = (p.gate - p.tx) * TILE;
    const top = (u: number, v: number): number => {
        for (const { sx } of stations) {
            if (v >= s.d - 4 && v < s.d - 1 && u >= sx + 4 && u < sx + 12) return v === s.d - 4 ? W[0] : PAL.ink;
            if (v === s.d - 5 && u >= sx + 4 && u < sx + 12) return PAL.brass[3];
            if (v >= 2 && v < 4 && u >= sx + 3 && u < sx + 9) return v === 2 ? S[2] : S[1];
        }
        if (u === gx || u === gx + TILE - 1) return PAL.ink;
        if (v < shelf) return v === shelf - 1 ? W[1] : v === 0 ? W[2] : W[4];
        if (v === s.d - 1) return PAL.brass[4];
        if ((u * 7 + v * 3) % 23 === 0) return PAL.marbleGreen[4];
        return v === shelf ? PAL.marbleGreen[4] : v < shelf + 3 ? PAL.marbleGreen[2] : PAL.marbleGreen[3];
    };
    const panel = walnutPanel(s.w, s.h);
    const front = (u: number, v: number) => (u === gx || u === gx + TILE - 1 ? PAL.ink : u >= gx + 6 && u < gx + 10 && v === 7 ? PAL.brass[4] : panel(u, v));
    /** The teller side: a knee hole under each window, drawers beside it, plain boards elsewhere. `u` runs from the counter's east end. */
    const back = (u: number, v: number) => {
        const x = s.w - 1 - u;
        if (v === 0) return W[4];
        if (v === s.h - 1) return W[0];
        for (const { sx } of stations) {
            if (x >= sx + 3 && x < sx + 13 && v >= 3) return v === 3 ? W[1] : W[0];
            if ((x === sx + 14 || x === sx + 1) && v % 4 === 2) return PAL.brass[3];
        }
        return x % 8 === 0 || v % 4 === 0 ? W[1] : W[2];
    };
    const end = (u: number, v: number) => (v === 0 ? W[4] : v >= s.h - 2 ? (v === s.h - 2 ? PAL.brass[3] : PAL.brass[1]) : u === 0 || u === s.d - 1 || v === 1 ? W[2] : W[3]);
    const parts: [Part, Faces][] = [[part(0, 0, 0, s.w, s.d, s.h), { top, front, back, sides: end }]];
    for (const { sx, closed } of stations) {
        // The monitor on the work shelf, its screen on its back, towards the teller.
        parts.push([part(sx + 11, 1, s.h, 4, 3, 5), { top: S[3], front: rows(v => (v === 0 ? S[3] : S[2])), sides: S[2], back: S[1], corner: 1 }]);
        parts.push([part(sx + 11, 0, s.h + 1, 4, 1, 4), { top: S[1], sides: S[1], back: (u, v) => (closed ? S[0] : v === 0 ? PAL.emissive.screen[2] : u === 0 ? PAL.emissive.screen[0] : PAL.emissive.screen[1]), glow: !closed }]);
        if (!closed) t.light(view, sx + 13, 0, s.h + 3, 22, 0x7fd8e8, 0.8);
        // Teller glass on the front edge: brass posts, a top rail and a faint pane between.
        const y = s.d - 1;
        parts.push([part(sx - 2, y, s.h, 1, 1, glass), { sides: PAL.brass[4], left: PAL.brass[2], top: PAL.brass[5] }]);
        parts.push([part(sx + TILE + 1, y, s.h, 1, 1, glass), { sides: PAL.brass[2], right: PAL.brass[4], top: PAL.brass[5] }]);
        parts.push([part(sx - 1, y, s.h, TILE + 2, 1, glass - 2), { sides: (u, v) => ((u + v) % 17 < 2 ? PAL.glass[5] : PAL.glass[4]), top: PAL.glass[4], alpha: 40 }]);
        parts.push([part(sx - 1, y, s.h + glass - 2, TILE + 2, 1, 2), { sides: rows(v => (v === 0 ? PAL.brass[4] : PAL.brass[1])), top: PAL.brass[5] }]);
        if (closed) {
            // "Position closed": a card standing behind the glass, its lettering towards the customers.
            parts.push([part(sx + 3, s.d - 3, s.h, 10, 1, 6), { front: rows(v => (v === 2 || v === 3 ? L[3]! : v === 5 ? PAL.paper[1] : PAL.paper[3])), sides: PAL.paper[1], top: PAL.paper[3] }]);
        } else {
            // A banker's lamp: a brass stem, a green glass shade glowing warm underneath.
            parts.push([part(sx + 2, s.d - 3, s.h, 1, 1, 3), { sides: PAL.brass[3], top: PAL.brass[4] }]);
            parts.push([part(sx, s.d - 4, s.h + 3, 5, 2, 2), { top: PAL.leaf[4], sides: rows(v => (v === 1 ? PAL.emissive.lampWarm[0] : PAL.leaf[5])), glow: true, corner: 1 }]);
            t.light(view, sx + 2.5, s.d - 3, s.h + 3, 64, 0xffcf8a, 1.5);
        }
    }
    t.draw(view, parts);
    return view.art();
}

/** A walnut credenza along the back wall: paired doors on its front, papers, a cash tray and a phone on top. */
export function backCounter(p: Extract<LevelProp, { kind: 'backCounter' }>, s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { headroom: 2 });
    const front = (u: number, v: number) => {
        const door = u % 8, knob = Math.floor(u / 8) % 2 === 0 ? 6 : 1;
        if (v === 0) return W[4];
        if (v === s.h - 1) return W[0];
        if (door === 0) return W[1];
        if (v === 3 && door === knob) return PAL.brass[4];
        if (door >= 2 && door <= 6 && v >= 2 && v <= s.h - 3) return v === 2 ? W[2] : W[3];
        return W[2];
    };
    const parts: [Part, Faces][] = [[part(0, 0, 0, s.w, s.d, s.h), {
        top: (u, v) => (v === s.d - 1 ? W[5] : v === 0 ? W[2] : (u * 3 + v * 7) % 13 === 0 ? W[3] : W[4]),
        front,
        back: (u, v) => (u % 8 === 0 || v === 0 ? W[1] : W[2]),
        sides: (u, v) => (v === 0 ? W[4] : v === s.h - 1 ? W[0] : u === 0 || u === s.d - 1 ? W[2] : W[3])
    }]];
    const rand = mulberry32(p.tx * 31 + 7);
    for (let i = 0; i < s.w / TILE; i++) {
        // Papers, a cash tray or a phone, kept on the top however short the credenza is.
        const start = i * TILE + 2 + Math.floor(rand() * 5), pick = rand();
        const x = Math.min(start, s.w - (pick < 0.4 ? 5 : pick < 0.7 ? 7 : 4) - 1);
        if (pick < 0.4) parts.push([part(x, 1, s.h, 5, 3, 1), { top: rows(v => (v === 0 ? PAL.paper[2] : PAL.paper[3])), sides: (u: number) => (u % 2 ? PAL.paper[1] : PAL.paper[2]) }]);
        else if (pick < 0.7) parts.push([part(x, 1, s.h, 7, 3, 1), { top: (u, v) => (u % 2 === 0 ? S[1] : v === 1 ? PAL.cloth.olive[3]! : S[3]), sides: S[2] }]);
        else {
            parts.push([part(x, 2, s.h, 4, 2, 1), { top: (u, v) => (v === 1 && u < 3 ? S[2] : PAL.ink), sides: PAL.ink }]);
            parts.push([part(x, 1, s.h + 1, 4, 1, 1), { top: S[1], sides: PAL.ink, corner: 0 }]);
        }
    }
    t.draw(view, parts);
    view.outline(0.25);
    return view.art();
}

/** A four-drawer steel filing cabinet: label cards and cup handles on its front, a stack of files on top. */
export function filingCabinet(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { headroom: 1 });
    const front = (u: number, v: number) => {
        if (v === s.h - 1) return S[0];
        const r = v % 4;
        if (r === 3) return S[1];
        if (r === 0) return u === s.w - 1 ? S[3] : S[4];
        if (r === 1 && u >= 4 && u < 8) return u === 4 || u === 7 ? S[2] : PAL.paper[3];
        if (r === 2 && u >= 4 && u < 8) return u === 4 ? S[4] : S[5];
        return u === 0 ? S[4] : u === s.w - 1 ? S[2] : S[3];
    };
    t.draw(view, [
        [part(0, 0, 0, s.w, s.d, s.h), {
            top: rows(v => (v === s.d - 1 ? S[5] : v === 0 ? S[3] : S[4])),
            front,
            back: (u, v) => (v === 0 ? S[3] : u === Math.floor(s.w / 2) ? S[1] : S[2]),
            sides: rows(v => (v === 0 ? S[4] : v === s.h - 1 ? S[0] : v === 7 ? S[2] : S[3]))
        }],
        [part(2, 1, s.h, 5, 3, 1), { top: rows(v => (v === 2 ? PAL.paper[2] : PAL.paper[3])), sides: (u: number) => (u % 2 ? PAL.cloth.mustard[3]! : PAL.paper[1]) }]
    ]);
    view.outline(0.3);
    return view.art();
}

/**
 * A floor-standing copier: two paper drawers, the body with its output slot, the scanner lid on top and a control panel
 * at its front right with a little green screen and a ready light.
 */
export function printer(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { headroom: 1 });
    const P = PLASTIC, trays = 7, body = 4, lid = s.h - trays - body - 1;
    t.draw(view, [
        [part(0, 0, 0, s.w, s.d, trays), {
            top: P[3],
            front: (u, v) => (v === trays - 1 ? S[1] : v === 3 ? P[1] : (v === 1 || v === 4) && u >= 4 && u < 8 ? S[1] : v === 0 ? P[3] : P[2]),
            back: rows(v => (v === trays - 1 ? S[1] : P[1])),
            sides: rows(v => (v === trays - 1 ? S[1] : v === 3 ? P[1] : P[2]))
        }],
        [part(0, 0, trays, s.w, s.d, body), {
            top: P[3],
            front: (u, v) => (v === 1 && u >= 1 && u < 8 ? PAL.ink : v === 2 && u >= 2 && u < 7 ? PAL.paper[3] : v === 0 ? P[4] : P[2]),
            back: (u, v) => (v === 2 && u === 2 ? PAL.ink : P[1]),
            sides: (u, v) => (v === 1 && u % 2 === 0 ? P[1] : v === 0 ? P[4] : P[2])
        }],
        [part(0, 1, trays + body, s.w, s.d - 1, lid), { top: rows(v => (v === 0 ? P[2] : P[4])), sides: rows(v => (v === 0 ? P[4] : P[2])), back: P[1], corner: 1 }],
        [part(7, 3, trays + body + lid, 4, 2, 1), { top: (u, v) => (v === 0 ? S[2] : u < 2 ? S[0] : S[1]), sides: S[1] }]
    ]);
    const [sx, sy] = t.pixel(7, 4), [lx, ly] = t.pixel(10, 4);
    view.glowTop(sx, sy, s.h, PAL.emissive.screen[1]);
    view.glowTop(lx, ly, s.h, PAL.emissive.ledGreen);
    view.outline(0.3);
    return view.art();
}

/** A water cooler: a white cabinet with two taps over a drip tray on its front, a blue bottle upside down on top. */
export function waterCooler(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { margin: 1 });
    const C = PAL.cloth.white, G = PAL.glass, body = 10;
    t.draw(view, [[part(0, 0, 0, s.w, s.d, body), {
        top: rows(v => (v === s.d - 1 ? C[3] : C[2])),
        front: (u, v) => (v === 0 ? C[3] : v === body - 1 ? C[0] : v === 3 && u >= 1 && u <= 3 ? S[1] : v === 6 && u >= 1 && u <= 3 ? S[2] : u === s.w - 1 ? C[1] : C[2]),
        back: (u, v) => (v > 2 && v < 8 && v % 2 === 0 && u > 0 && u < s.w - 1 ? S[1] : v === body - 1 ? C[0] : C[1]),
        sides: rows(v => (v === 0 ? C[3] : v === body - 1 ? C[0] : C[2])),
        corner: 1
    }]]);
    const cx = t.w / 2, cy = t.d / 2;
    view.cylinder(cx, cy, 2.3, body, 4, (s, v) => (v === 0 ? G[3] : roundBands([G[0], G[1], G[2], G[3], G[5]], s)), (s, t) => (s * s + t * t > 0.5 ? G[3] : G[4]));
    view.cylinder(cx, cy, 1.6, body + 4, s.h - body - 4, s => (s < -0.2 ? G[4] : G[2]), () => G[4]);
    // The taps stick out of the front: cold on the left, hot on the right.
    for (const [x, c] of [[1, PAL.cloth.denim[3]!], [3, PAL.carpet[4]]] as const) {
        const [vx, vy] = t.pixel(x, s.d);
        if (facing !== 'north') view.face(vx, 6, c, vy + 1);
    }
    view.outline(0.25);
    return view.art();
}

/** A walnut brochure rack: a back panel between two cheeks, three shelves of leaflets facing out. */
export function brochureRack(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const colours = [PAL.cloth.denim[3]!, PAL.paper[3], L[3]!, PAL.cloth.teal[3]!, PAL.cloth.mustard[3]!, PAL.paper[2]];
    const parts: [Part, Faces][] = [
        [part(0, 0, 0, s.w, 1, s.h - 1), { sides: W[2], back: (u, v) => (v === 6 || v === 12 ? W[1] : u === 0 || u === s.w - 1 ? W[1] : W[2]), top: W[4] }],
        [part(0, 1, 0, 1, s.d - 1, s.h - 1), { sides: rows(v => (v === 0 ? W[4] : W[2])), front: W[3], top: W[4] }],
        [part(s.w - 1, 1, 0, 1, s.d - 1, s.h - 1), { sides: rows(v => (v === 0 ? W[4] : W[2])), front: W[3], top: W[4] }],
        [part(0, 0, s.h - 1, s.w, s.d, 1), { top: rows(v => (v === s.d - 1 ? W[5] : W[4])), sides: W[3], corner: 1 }]
    ];
    for (let shelf = 0; shelf < 3; shelf++) {
        const z = shelf * 6;
        parts.push([part(1, 1, z, s.w - 2, s.d - 1, 1), { top: W[4], sides: W[1] }]);
        for (let col = 0; col < 2; col++) {
            const c = colours[shelf * 2 + col]!, light = mix(c, 0xffffff, 0.3);
            parts.push([part(1 + col * 4, 1, z + 1, 4, 2, 4), { front: (u, v) => (v === 0 ? light : v === 1 && u > 0 && u < 3 ? PAL.paper[3] : c), sides: c, back: c, top: light }]);
        }
    }
    t.draw(view, parts);
    view.outline(0.3);
    return view.art();
}

/** A small brass waste-paper bin. */
export function bin(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const B = PAL.brass, r = t.w / 2;
    view.cylinder(r, t.d / 2, r, 0, s.h, (s, v) => (v === 0 ? B[5] : roundBands([B[0], B[1], B[2], B[3], B[5]], s)), (s, t) => (s * s + t * t > 0.45 ? B[4] : PAL.ink));
    view.outline(0.3);
    return view.art();
}

/**
 * A rubber plant in a brass planter. Its leaves come off the stem in a spiral, so the four views are four sides of
 * the same plant: leaves turned towards the camera show their lit upper side, leaves turned away their darker edge.
 */
export function plant(s: Size, facing: Facing, seed: number): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { margin: 7, headroom: 5 });
    const pot = 6, B = PAL.brass, G = PAL.leaf, rand = mulberry32(seed);
    const [cx, cy] = t.point(s.w / 2, s.d / 2);
    const leaves = Array.from({ length: 18 }, (_, i) => {
        const angle = i * 2.4 + rand() * 0.6;
        const [ex, ey] = t.point(s.w / 2 + Math.cos(angle), s.d / 2 + Math.sin(angle));
        const top = i > 14, length = top ? 4 : 5 + Math.floor(rand() * 3);
        return { dx: ex - cx, dy: ey - cy, z: pot + 3 + i * ((s.h - pot - 5) / 17), length, rise: top ? 1.2 : 0.3 };
    });
    /**
     * A broad oval leaf off the stem, lying nearly flat and tilting up: its upper half (on screen) lit, its lower half
     * and midrib darker, a glint at its tip. Leaves turned away from the camera sit a step darker.
     */
    const drawLeaf = (leaf: (typeof leaves)[number]) => {
        const k = view.depthScale, half = leaf.length / 2;
        const [baseCol, baseRow] = view.project(cx, cy, leaf.z);
        const centre = [baseCol + 0.5 + leaf.dx * (half + 0.5), baseRow + 0.5 + (leaf.dy * k - leaf.rise) * (half + 0.5)];
        const width = 2.1, along = [leaf.dx * half, (leaf.dy * k - leaf.rise) * half];
        // Seen from above, a flat leaf keeps some breadth whichever way it points.
        const across = [-leaf.dy * width || 0.01, leaf.dx * width * k + (leaf.dx < 0 ? -0.5 : 0.5)];
        const det = along[0]! * across[1]! - along[1]! * across[0]!;
        const shade = leaf.dy < -0.3 ? -1 : leaf.dy > 0.3 ? 1 : 0, upper = across[1]! < 0 ? 1 : -1;
        const reach = Math.ceil(half + 2);
        for (let row = Math.floor(centre[1]! - reach); row <= centre[1]! + reach; row++) for (let col = Math.floor(centre[0]! - reach); col <= centre[0]! + reach; col++) {
            const px = col + 0.5 - centre[0]!, py = row + 0.5 - centre[1]!;
            const a = (px * across[1]! - py * across[0]!) / det, b = (along[0]! * py - along[1]! * px) / det;
            if (a * a + b * b > 1) continue;
            let c = G[3 + shade]!;
            if (b * upper > 0.25) c = G[4 + shade]!;
            if (Math.abs(b) < 0.25 && a < 0.6) c = G[2 + shade]!;
            if (b * upper < -0.55) c = G[2 + shade]!;
            if (a > 0.7 && b * upper > 0) c = G[5]!;
            view.dot(col, row, c, b * upper > 0 ? NORMAL.top : NORMAL.face);
        }
    };
    const far = leaves.filter(l => l.dy <= 0), near = leaves.filter(l => l.dy > 0);
    view.cylinder(cx, cy, s.w / 2, 0, pot, (s, v) => (v === 0 ? B[5] : v === pot - 1 ? B[1] : roundBands([B[0], B[1], B[2], B[3], B[5]], s)), (s, t) => (s * s + t * t > 0.55 ? B[4] : PAL.terracotta[0]));
    for (const leaf of far.sort((a, b) => a.z - b.z)) drawLeaf(leaf);
    view.cylinder(cx, cy, 0.6, pot, s.h - pot - 3, () => G[1], null);
    for (const leaf of near.sort((a, b) => a.dy - b.dy || a.z - b.z)) drawLeaf(leaf);
    // The newest leaf still furled in its red sheath at the top of the stem.
    const [tipCol, tipRow] = view.project(cx, cy, s.h - 2);
    view.dot(tipCol, tipRow, PAL.terracotta[3]);
    view.dot(tipCol, tipRow - 1, PAL.terracotta[2]);
    view.outline(0.35);
    return view.art();
}

/**
 * An oxblood leather Chesterfield on short walnut feet: a tufted back the full width, rolled arms a little lower, two
 * seat cushions between them, a shadowed gap under it all.
 */
export function sofa(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const shine = mix(L[3]!, 0xffffff, 0.18), back = 3, arm = 4, seat = 6, armTop = 8, inner = s.w - arm * 2;
    const tufted = (u: number, v: number) => (v === 0 ? shine : (u + (v % 4 < 2 ? 0 : 2)) % 4 === 0 && v % 2 === 1 ? L[0]! : L[2]!);
    const parts: [Part, Faces][] = [
        [part(0, 0, 1, s.w, back, s.h - 1), {
            top: rows(v => (v === back - 1 ? shine : L[3]!)), front: tufted,
            back: (u, v) => (v === 0 ? L[3]! : u % 8 === 4 ? L[1]! : L[2]!), sides: rows(v => (v === 0 ? L[3]! : L[2]!)), corner: 1
        }],
        [part(arm, back, 1, inner, s.d - back, seat - 1), {
            top: (u, v) => (u === Math.floor(inner / 2) ? L[1]! : v === s.d - back - 1 ? shine : L[3]!),
            front: rows(v => (v === 0 ? L[3]! : v === seat - 2 ? L[1]! : L[2]!))
        }]
    ];
    for (const x of [0, s.w - arm]) {
        parts.push([part(x, back, 1, arm, s.d - back, armTop - 1), {
            top: (u: number) => (u === 1 || u === 2 ? shine : L[3]!),
            front: (u, v) => (v === 0 ? shine : v === 1 && (u === 1 || u === 2) ? L[0]! : L[2]!),
            back: L[2]!,
            sides: rows(v => (v === 0 ? shine : v === 1 ? L[1]! : L[2]!)),
            corner: 1
        }]);
    }
    for (const [x, y] of [[1, 1], [s.w - 2, 1], [1, s.d - 2], [s.w - 2, s.d - 2]] as const) parts.push([part(x, y, 0, 1, 1, 1), { top: W[1], sides: W[1] }]);
    t.draw(view, parts);
    view.outline(0.35);
    return view.art();
}

/** A low walnut coffee table on four legs; two magazines and a coffee cup on it. */
export function coffeeTable(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { headroom: 2, margin: 1 });
    const legs = s.h - 2, parts: [Part, Faces][] = [];
    for (const [x, y] of [[1, 1], [s.w - 2, 1], [1, s.d - 2], [s.w - 2, s.d - 2]] as const) parts.push([part(x, y, 0, 1, 1, legs), { sides: W[1], top: W[1] }]);
    parts.push([part(0, 0, legs, s.w, s.d, 2), { top: (u, v) => (v === s.d - 1 ? W[5] : (u + v * 3) % 9 === 0 ? W[3] : W[4]), sides: rows(v => (v === 0 ? W[3] : W[1])), corner: 1 }]);
    parts.push([part(1, 2, s.h, 5, 4, 0), { top: (u, v) => (v === 0 ? PAL.paper[3] : u === 4 ? PAL.paper[2] : PAL.cloth.denim[3]!) }]);
    parts.push([part(6, 1, s.h, 4, 3, 0), { top: (u, v) => (v === 1 && u > 0 ? PAL.paper[1] : PAL.paper[3]) }]);
    t.draw(view, parts);
    // The cup: a round white body, the coffee dark inside its rim, a handle on its right.
    const [x, y] = t.point(12.5, 3.5);
    view.cylinder(x, y, 1, s.h, 2, s => (s < 0 ? PAL.paper[3] : PAL.paper[2]), () => W[1]);
    const [hx, hy] = t.pixel(13, 3);
    view.face(hx + (facing === 'north' ? -1 : 1), s.h + 1, PAL.paper[2], hy + 1);
    view.outline(0.3);
    return view.art();
}

/**
 * The customers' writing desk: a standing island, a walnut plinth panelled on both long sides under a green marble top,
 * deposit slips and a chained pen on it and a banker's lamp in the middle.
 */
export function writingDesk(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { headroom: 8 });
    const slab = 2, plinth = s.h - slab, lx = Math.floor(s.w / 2) - 2, M = PAL.marbleGreen;
    const panel = walnutPanel(s.w - 4, plinth);
    t.draw(view, [
        [part(2, 1, 0, s.w - 4, s.d - 2, plinth), { front: panel, back: panel, sides: rows(v => (v >= plinth - 2 ? PAL.brass[1] : W[2])), top: W[2] }],
        [part(0, 0, plinth, s.w, s.d, slab), { top: (u, v) => (v === s.d - 1 ? M[4] : (u * 5 + v * 3) % 17 === 0 ? M[4] : M[3]), sides: rows(v => (v === 0 ? M[4] : M[1])), corner: 1 }],
        [part(2, 2, s.h, 4, 2, 0), { top: PAL.paper[3] }],
        [part(s.w - 6, 2, s.h, 4, 2, 0), { top: PAL.paper[3] }],
        [part(7, 4, s.h, 3, 1, 0), { top: (u: number) => (u === 0 ? PAL.ink : PAL.brass[3]) }],
        [part(lx + 2, 3, s.h, 1, 1, 5), { sides: PAL.brass[3], top: PAL.brass[4] }],
        [part(lx, 2, s.h + 5, 5, 2, 2), { top: PAL.leaf[4], sides: rows(v => (v === 1 ? PAL.emissive.lampWarm[0] : PAL.leaf[5])), glow: true, corner: 1 }]
    ]);
    t.light(view, lx + 2.5, 3, s.h + 5, 48, 0xffcf8a, 1.4);
    view.outline(0.3);
    return view.art();
}

/**
 * A run of brass stanchions along its width, one in the middle of each tile, a velvet rope sagging between each pair.
 * Facing east or west the run goes north-south. Drawn without foreshortening, so each post stays on its floor position.
 */
export function queueRail(p: Extract<LevelProp, { kind: 'queueRail' }>, s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { depthScale: 1 });
    const B = PAL.brass, oy = s.d / 2;
    const items: { y: number; draw: () => void }[] = [];
    for (let i = 0; i < p.length; i++) {
        const [x, y] = t.point(i * TILE + 2, oy);
        items.push({
            y,
            draw: () => {
                view.cylinder(x, y, 2, 0, 1, s => (s < 0 ? B[3] : B[2]), (s, t) => (s * s + t * t < 0.3 ? B[2] : B[4]));
                view.cylinder(x, y, 1, 1, s.h - 3, s => (s < 0 ? B[4] : B[2]), null);
                view.cylinder(x, y, 1.2, s.h - 2, 2, s => (s < 0 ? B[5] : B[3]), () => B[5]);
            }
        });
        if (i === p.length - 1) continue;
        const [, ya] = t.point(i * TILE + 3, oy), [, yb] = t.point((i + 1) * TILE + 1, oy);
        items.push({
            y: (ya + yb) / 2,
            draw: () => {
                for (let f = 0; f <= 1; f += 0.02) {
                    const [rx, ry] = t.point(i * TILE + 3 + f * (TILE - 2), oy);
                    const [col, row] = view.project(rx, ry, s.h - 3 - Math.sin(f * Math.PI) * 2);
                    view.dot(col, row, f > 0.15 && f < 0.85 ? PAL.carpet[3] : PAL.carpet[2]);
                }
            }
        });
    }
    for (const item of items.sort((a, b) => a.y - b.y)) item.draw();
    return view.art();
}

/** A ribbed rubber entrance mat with a brass edge, flat on the floor; the ribs run across its width. */
export function mat(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, 0, { depthScale: 1 });
    for (let y = 0; y < s.d; y++) for (let x = 0; x < s.w; x++) {
        const edge = x === 0 || y === 0 || x === s.w - 1 || y === s.d - 1;
        const [vx, vy] = t.pixel(x, y);
        view.top(vx, vy, 0, edge ? PAL.brass[1] : y % 2 ? PAL.asphalt[2] : PAL.asphalt[3]);
    }
    return view.art();
}
