import { TILE } from '../../level/level';
import type { LobbyProp } from '../../level/lobby';
import type { Facing, Size } from '../../level/space';
import { PAL, mix, step } from '../palette';
import { mulberry32 } from '../random';
import { renderModel, type Model, type Part, type PropArt, type Tex } from './model';
import { vanArt } from './van';

export type { PropArt } from './model';

/*
 * Every prop as a small 3D model of boxes in its own frame (see model.ts): x across its front, y from its back (0) to
 * its front (`s.d`), z up. Sizes come from the catalog; the renderer turns a model to any of the four facings.
 */

const box = (x: number, y: number, z: number, w: number, d: number, h: number, faces: Omit<Part, 'x' | 'y' | 'z' | 'w' | 'd' | 'h'>): Part => ({ x, y, z, w, d, h, ...faces });
const none: Tex = () => null;

/** Rectangles painted onto a texture: later ones on top. */
function decals(base: Tex, items: { x: number; y: number; w: number; h: number; c: number }[]): Tex {
    return (u, v) => {
        for (let i = items.length - 1; i >= 0; i--) {
            const r = items[i]!;
            if (u >= r.x && u < r.x + r.w && v >= r.y && v < r.y + r.h) return r.c;
        }
        return typeof base === 'number' ? base : base(u, v);
    };
}

const inEllipse = (u: number, v: number, cx: number, cy: number, rx: number, ry: number) => ((u + 0.5 - cx) / rx) ** 2 + ((v + 0.5 - cy) / ry) ** 2 <= 1;

/** Raised walnut panels on a face, a brass kick rail along the floor. `v` counts down from the top edge. */
function walnutPanel(w: number, h: number): (u: number, v: number) => number {
    return (u, v) => {
        const z = h - v, px = u % TILE;
        if (z <= 2) return z === 2 ? PAL.brass[3] : PAL.brass[1];
        if (z === h) return PAL.walnut[1];
        const inX = px > 2 && px < 13 && w - u > 2, inZ = z > 4 && z < h - 1;
        if (inX && inZ) return z === h - 2 ? PAL.walnut[4] : PAL.walnut[3];
        if ((px === 2 || px === 13) && z >= 4 && z <= h - 1) return PAL.walnut[1];
        if ((z === 4 || z === h - 1) && px >= 2 && px <= 13) return PAL.walnut[1];
        return PAL.walnut[2];
    };
}

/** Plain cabinet back: boards with a darker seam every half tile. */
const boards = (light: number, dark: number): Tex => (u, v) => (u % (TILE / 2) === 0 || v === 0 ? dark : light);

/**
 * The teller counter: a walnut front 1.2m tall, its top the full depth of the row (a walnut work shelf at the back,
 * on the teller side, green marble towards the customers). Teller glass 1.4m tall stands on the top's front edge;
 * each window has a monitor on the shelf, screen towards the teller, and open windows a banker's lamp.
 */
function counter(p: Extract<LobbyProp, { kind: 'counter' }>, s: Size): Model {
    const shelf = 6, glass = 28;
    const stations = p.stations.map(st => ({ sx: (st - p.tx) * TILE, closed: p.closed.includes(st) }));
    const gx = (p.gate - p.tx) * TILE;
    const top: Tex = (u, v) => {
        for (const { sx, closed } of stations) {
            if (v >= s.d - 4 && v < s.d - 1 && u >= sx + 4 && u < sx + 12) return PAL.ink;
            if (v === s.d - 5 && u >= sx + 4 && u < sx + 12) return PAL.brass[3];
            if (!closed && v >= s.d - 4 && v < s.d - 2 && u >= sx + 12 && u < sx + 15) return PAL.paper[2];
        }
        if (u === gx || u === gx + TILE - 1) return PAL.ink;
        if (v < shelf) return v === 0 || v === shelf - 1 ? PAL.walnut[1] : PAL.walnut[3];
        if (v === s.d - 1) return PAL.brass[3];
        if ((u * 7 + v * 3) % 23 === 0) return PAL.marbleGreen[4];
        return v === shelf ? PAL.marbleGreen[4] : v < shelf + 3 ? PAL.marbleGreen[2] : PAL.marbleGreen[3];
    };
    const panel = walnutPanel(s.w, s.h);
    const front: Tex = (u, v) => (u === gx || u === gx + TILE - 1 ? PAL.ink : u >= gx + 6 && u < gx + 10 && v === 7 ? PAL.brass[4] : panel(u, v));
    const parts: Part[] = [box(0, 0, 0, s.w, s.d, s.h, { top, front, back: boards(PAL.walnut[3], PAL.walnut[1]), sides: PAL.walnut[2], bump: { top: 0.95, face: 0.65 } })];
    const lights: NonNullable<Model['lights']> = [];
    for (const { sx, closed } of stations) {
        // Monitor on the work shelf, its screen facing the teller (the back of the counter).
        parts.push(box(sx + 12, 1, s.h, 4, 3, 5, { top: PAL.steel[3], sides: PAL.steel[1] }));
        parts.push(box(sx + 12, 0, s.h, 4, 1, 4, { back: (_u, v) => (v === 0 ? PAL.emissive.screen[2] : PAL.emissive.screen[1]), top: PAL.steel[1], sides: PAL.steel[1], glow: !closed }));
        if (!closed) lights.push({ x: sx + 14, y: 0, z: s.h + 3, radius: 22, color: 0x7fd8e8, intensity: 0.8 });
        // Teller glass on the front edge: brass posts and top rail, a faintly tinted pane with two streaks.
        const y = s.d - 1;
        parts.push(box(sx - 2, y, s.h, 1, 1, glass, { sides: PAL.brass[4], top: PAL.brass[5] }));
        parts.push(box(sx + TILE + 1, y, s.h, 1, 1, glass, { sides: PAL.brass[2], top: PAL.brass[5] }));
        parts.push(box(sx - 1, y, s.h + glass - 2, TILE + 2, 1, 2, { sides: (_u, v) => (v === 0 ? PAL.brass[4] : PAL.brass[1]), top: PAL.brass[5] }));
        const streak = (u: number, v: number) => (u + v) % 17 === 0 || (u + v) % 17 === 3;
        parts.push(box(sx - 1, y, s.h, TILE + 2, 1, glass - 2, { sides: (u, v) => (streak(u, v) ? PAL.glass[5] : PAL.glass[4]), top: none, alpha: (u, v) => (streak(u, v) ? 90 : 22) }));
        if (closed) {
            // "Position closed" sign standing in the window, blank on the teller's side.
            parts.push(box(sx + 3, y - 1, s.h + 6, 10, 1, 6, { front: (_u, v) => (v === 2 || v === 3 ? PAL.cloth.burgundy[3]! : v === 5 ? PAL.paper[1] : PAL.paper[3]), sides: PAL.paper[2], top: PAL.paper[3] }));
        } else {
            // Banker's lamp at the front of the top: brass stem, green glass shade glowing warm underneath.
            parts.push(box(sx + 2, s.d - 3, s.h, 1, 1, 3, { sides: PAL.brass[3], top: PAL.brass[4] }));
            parts.push(box(sx, s.d - 4, s.h + 3, 5, 2, 2, { top: PAL.leaf[4], sides: (_u, v) => (v === 1 ? PAL.emissive.lampWarm[0] : PAL.leaf[5]), glow: true }));
            lights.push({ x: sx + 2, y: s.d - 3, z: s.h + 3, radius: 64, color: 0xffcf8a, intensity: 1.5 });
        }
    }
    return { parts, lights };
}

function backCounter(p: Extract<LobbyProp, { kind: 'backCounter' }>, s: Size): Model {
    // A credenza: drawers on its front, clutter on top (paper stacks, a cash tray, a phone).
    const rand = mulberry32(p.tx * 31 + 7);
    const clutter: { x: number; y: number; w: number; h: number; c: number }[] = [];
    for (let i = 0; i < s.w / TILE; i++) {
        const x = i * TILE + 2 + Math.floor(rand() * 6), pick = rand();
        if (pick < 0.4) clutter.push({ x, y: 1, w: 5, h: 3, c: PAL.paper[2] }, { x, y: 1, w: 5, h: 1, c: PAL.paper[3] });
        else if (pick < 0.7) clutter.push({ x, y: 1, w: 7, h: 3, c: PAL.steel[2] }, { x: x + 1, y: 2, w: 5, h: 1, c: PAL.cloth.olive[2]! });
        else clutter.push({ x, y: 2, w: 4, h: 2, c: PAL.ink });
    }
    const top = decals((_u, v) => (v === s.d - 1 ? PAL.walnut[5] : v === 0 ? PAL.walnut[2] : PAL.walnut[4]), clutter);
    const front: Tex = (u, v) => (u % (TILE / 2) === 0 || v === 0 || v === s.h - 1 ? PAL.walnut[1] : v === 3 && u % (TILE / 2) === 3 ? PAL.brass[4] : PAL.walnut[3]);
    return { parts: [box(0, 0, 0, s.w, s.d, s.h, { top, front, back: boards(PAL.walnut[2], PAL.walnut[1]), sides: PAL.walnut[2], bump: { top: 0.9, face: 0.6 } })] };
}

function filingCabinet(s: Size): Model {
    // Three drawers, each with a handle and a label card.
    const drawer = Math.floor(s.h / 3);
    const front: Tex = (u, v) => {
        const z = s.h - v;
        if (z % drawer === 0 && z < s.h) return PAL.steel[1];
        const inDrawer = v % drawer;
        if (inDrawer === 2 && u >= 4 && u < s.w - 4) return PAL.steel[5];
        if (inDrawer === 1 && u >= 5 && u < s.w - 5) return PAL.paper[3];
        return step(PAL.steel, u < 2 ? 4 : u > s.w - 3 ? 2 : 3);
    };
    const top = decals((_u, v) => (v === s.d - 1 ? PAL.steel[5] : PAL.steel[4]), [{ x: 2, y: 1, w: 5, h: 3, c: PAL.paper[2] }]);
    return { parts: [box(0, 0, 0, s.w, s.d, s.h, { top, front, sides: PAL.steel[3], back: PAL.steel[2] })] };
}

function printer(s: Size): Model {
    // A copier (the top 0.5m) on a walnut stand, its paper slot and status light on the front.
    const machine = 6, stand = s.h - machine;
    return {
        parts: [
            box(0, 0, 0, s.w, s.d, stand, { top: PAL.walnut[5], front: (_u, v) => (v === 0 ? PAL.walnut[5] : PAL.walnut[3]), sides: PAL.walnut[3], back: PAL.walnut[2] }),
            box(0, 0, stand, s.w, s.d, machine, { top: (_u, v) => (v < 2 ? PAL.paper[3] : PAL.paper[2]), front: (u, v) => (v === 4 && u > 1 && u < s.w - 2 ? PAL.ink : PAL.paper[1]), sides: PAL.paper[1], back: PAL.paper[0] }),
            box(s.w - 2, s.d - 1, s.h - 2, 1, 1, 1, { sides: PAL.emissive.ledGreen, top: PAL.emissive.ledGreen, glow: true })
        ]
    };
}

function waterCooler(s: Size): Model {
    // White body to two thirds of its height with two taps on the front, the blue bottle above.
    const body = Math.round(s.h * 0.65);
    return {
        parts: [
            box(0, 0, 0, s.w, s.d, body, {
                top: PAL.paper[3],
                front: (u, v) => (v === 3 && u === 1 ? PAL.cloth.denim[3]! : v === 3 && u === 3 ? PAL.cloth.burgundy[3]! : u === s.w - 1 ? PAL.paper[1] : PAL.paper[2]),
                sides: PAL.paper[1]
            }),
            box(1, 1, body, s.w - 2, s.d - 2, s.h - body, { top: PAL.glass[2], sides: (u, v) => (u === 0 ? PAL.glass[4] : v === 2 ? PAL.glass[2] : PAL.glass[3]) })
        ]
    };
}

/** Wall dressing is a thin slab: its face shows facing away from the wall, an edge seen from the side. */
function slab(s: Size, front: Tex, edge: number, glow = false): Model {
    return { parts: [box(0, 0, 0, s.w, s.d, s.h, { front, back: edge, sides: edge, top: edge, glow })] };
}

function crest(s: Size): Model {
    // A brass roundel with a columned bank front, flanked by two brass bars.
    const cx = s.w / 2, cy = s.h / 2;
    return slab(s, (u, v) => {
        if (inEllipse(u, v, cx, cy, 5.5, 4)) {
            const du = Math.round(u - cx + 0.5);
            if (v === Math.round(cy) - 3) return PAL.brass[5];
            if ([-3, -1, 1, 3].includes(du) && v >= cy - 2 && v < cy + 2) return PAL.brass[4];
            return PAL.brass[3];
        }
        if (inEllipse(u, v, cx, cy, 6.5, 5)) return PAL.brass[1];
        if (v === Math.floor(cy) && (u < 5 || u >= s.w - 5)) return PAL.brass[3];
        return null;
    }, PAL.brass[2]);
}

function clock(s: Size): Model {
    const c = s.w / 2;
    return slab(s, (u, v) => {
        if (!inEllipse(u, v, c, c, c, c)) return null;
        if (!inEllipse(u, v, c, c, c - 1, c - 1)) return PAL.brass[2];
        const cu = Math.floor(c), cv = Math.floor(c);
        if (u === cu && v === cv) return PAL.cloth.burgundy[3]!;
        if ((u === cu && v >= cv - 3 && v < cv) || (v === cv && u > cu && u <= cu + 2)) return PAL.ink;
        return PAL.paper[3];
    }, PAL.brass[2]);
}

function painting(s: Size): Model {
    return slab(s, (u, v) => {
        if (u === 0 || v === 0 || u === s.w - 1 || v === s.h - 1) return v === 0 ? PAL.brass[4] : PAL.brass[2];
        if (u >= 7 && u < 10 && v >= 2 && v < 4) return PAL.limestone[4];
        return v < 4 ? PAL.emissive.sky[0] : v === s.h - 2 ? PAL.leaf[2] : PAL.leaf[3];
    }, PAL.brass[2]);
}

function noticeBoard(s: Size): Model {
    return slab(s, decals((_u, v) => (v === 0 ? PAL.walnut[4] : PAL.terracotta[3]), [
        { x: 1, y: 1, w: 4, h: 5, c: PAL.paper[3] }, { x: 6, y: 2, w: 4, h: 3, c: PAL.paper[2] },
        { x: 8, y: 5, w: 3, h: 2, c: PAL.emissive.sky[1] }, { x: 3, y: 1, w: 1, h: 1, c: PAL.cloth.burgundy[3]! }
    ]), PAL.walnut[3]);
}

function exitSign(s: Size): Model {
    // A steel box, its lit panel on the front.
    return {
        parts: [
            box(0, 0, 0, s.w, s.d, s.h, { sides: PAL.steel[1], top: PAL.steel[1] }),
            box(1, 0, 1, s.w - 2, s.d, s.h - 2, { front: (u, v) => ((v === 0 && u >= 1 && u < 3) || (v === 1 && u >= 4 && u < 7) ? PAL.emissive.exitGreen[2] : PAL.emissive.exitGreen[1]), back: none, sides: none, top: none, glow: true })
        ],
        lights: [{ x: s.w / 2, y: s.d, z: 0, radius: 34, color: 0x52e08a, intensity: 0.6 }]
    };
}

function keycardLed(s: Size): Model {
    return { parts: [box(0, 0, 0, s.w, s.d, s.h, { sides: PAL.emissive.ledRed, top: PAL.emissive.ledRed, glow: true })], lights: [{ x: 0, y: s.d, z: 0, radius: 14, color: 0xff4a3a, intensity: 0.8 }] };
}

function atmScreen(s: Size): Model {
    const screen: Tex = (u, v) => (v === 1 && u >= 1 && u < 6 ? PAL.emissive.screen[2] : v === 3 && u >= 1 && u < 4 ? PAL.emissive.screen[0] : PAL.emissive.screen[1]);
    return { parts: [box(0, 0, 0, s.w, s.d, s.h, { front: screen, back: PAL.steel[1], sides: PAL.steel[1], top: PAL.steel[1], glow: true })], lights: [{ x: s.w / 2, y: s.d + 2, z: 0, radius: 30, color: 0x7fd8e8, intensity: 0.8 }] };
}

function camera(s: Size): Model {
    // A box camera on a bracket from the wall behind it, its lens on the front, a red tally light on top at the back.
    return {
        parts: [
            box(2, 0, 1, 2, 1, 2, { sides: PAL.steel[2], top: PAL.steel[3] }),
            box(0, 1, 0, s.w, s.d - 1, s.h, {
                top: (_u, v) => (v === 0 ? PAL.paper[2] : PAL.paper[3]),
                front: (u, v) => (u >= 3 && u < 5 && v >= 1 && v < 3 ? (u === 3 && v === 1 ? PAL.glass[3] : PAL.ink) : PAL.paper[2]),
                sides: (_u, v) => (v === s.h - 1 ? PAL.paper[0] : PAL.paper[2])
            }),
            box(s.w - 2, 1, s.h, 1, 1, 1, { sides: PAL.emissive.ledRed, top: PAL.emissive.ledRed, glow: true })
        ]
    };
}

/**
 * A run of stanchions along its width: a post 0.95m tall in the middle of each tile, a velvet rope sagging between
 * them. Facing east or west the run goes north-south.
 */
function queueRail(p: Extract<LobbyProp, { kind: 'queueRail' }>, s: Size): Model {
    const parts: Part[] = [];
    const cy = Math.floor(s.d / 2) - 1;
    for (let i = 0; i < p.length; i++) {
        const x = i * TILE;
        parts.push(box(x, 0, 0, 4, 4, 1, { top: PAL.brass[3], sides: PAL.brass[1] }));
        parts.push(box(x + 1, cy, 1, 2, 2, s.h - 3, { top: PAL.brass[4], sides: u => (u === 0 ? PAL.brass[4] : PAL.brass[2]) }));
        parts.push(box(x + 1, cy, s.h - 2, 2, 2, 2, { top: PAL.brass[5], sides: PAL.brass[4] }));
        if (i === p.length - 1) continue;
        for (let t = 3; t < TILE + 1; t++) {
            const sag = Math.round(Math.sin(((t - 2) / (TILE - 2)) * Math.PI) * 2);
            const c = t > 4 && t < TILE - 2 ? PAL.carpet[3] : PAL.carpet[2];
            parts.push(box(x + t, cy, s.h - 4 - sag, 1, 1, 1, { top: c, sides: PAL.carpet[2] }));
        }
    }
    return { parts, upright: true };
}

function mat(s: Size): Model {
    const top: Tex = (u, v) => (u === 0 || v === 0 || u === s.w - 1 || v === s.d - 1 ? PAL.brass[1] : (u + v) % 2 ? PAL.asphalt[2] : PAL.asphalt[3]);
    return { parts: [box(0, 0, 0, s.w, s.d, 0, { top, bump: { top: 0.35, face: 0.35 } })] };
}

function writingDesk(s: Size): Model {
    // A standing island: a walnut plinth under a green marble top, slips and a pen on top, a banker's lamp in the middle.
    const slabH = 2, plinth = s.h - slabH, lx = Math.floor(s.w / 2) - 2;
    const top = decals((_u, v) => (v === 0 ? PAL.marbleGreen[1] : v === s.d - 1 ? PAL.marbleGreen[4] : PAL.marbleGreen[3]), [
        { x: 2, y: 2, w: 4, h: 2, c: PAL.paper[3] }, { x: 7, y: 3, w: 3, h: 2, c: PAL.paper[2] }, { x: s.w - 7, y: 2, w: 4, h: 2, c: PAL.paper[3] }, { x: 11, y: 5, w: 1, h: 1, c: PAL.ink }
    ]);
    return {
        parts: [
            box(2, 1, 0, s.w - 4, s.d - 2, plinth, { front: walnutPanel(s.w - 4, plinth), back: walnutPanel(s.w - 4, plinth), sides: PAL.walnut[2], top: PAL.walnut[2], bump: { top: 0.6, face: 0.6 } }),
            box(0, 0, plinth, s.w, s.d, slabH, { top, sides: (_u, v) => (v === 0 ? PAL.marbleGreen[4] : PAL.marbleGreen[1]), bump: { top: 0.95, face: 0.9 } }),
            box(lx + 2, 3, s.h, 1, 1, 5, { sides: PAL.brass[3], top: PAL.brass[4] }),
            box(lx, 2, s.h + 5, 5, 3, 2, { top: PAL.leaf[4], sides: (_u, v) => (v === 1 ? PAL.emissive.lampWarm[0] : PAL.leaf[5]), glow: true })
        ],
        lights: [{ x: lx + 2, y: 3, z: s.h + 5, radius: 48, color: 0xffcf8a, intensity: 1.4 }]
    };
}

function sofa(s: Size): Model {
    // Oxblood leather Chesterfield: a 0.25m deep tufted back to the full height, two seat cushions at 0.45m, rolled arms
    // at 0.6m, and short walnut feet with a gap under the seat.
    const leather = PAL.cloth.burgundy, shine = mix(leather[3]!, 0xffffff, 0.18);
    const back = 3, seat = 6, arm = 8, armW = 4, inner = s.w - armW * 2;
    const tufted: Tex = (u, v) => ((u + (v % 4 === 0 ? 2 : 0)) % 4 === 1 && v % 2 === 1 ? leather[0]! : leather[2]!);
    /** An arm's face seen from the front or back: a foot at its outer corner, the gap under the seat beside it. */
    const armEnd = (foot: number): Tex => (u, v) => (v === arm - 1 ? (u === foot ? PAL.walnut[1] : null) : v === 0 ? leather[3]! : leather[2]!);
    /** An arm's outer side: feet at both ends, the rolled top catching the light. */
    const armOuter: Tex = (u, v) => (v === arm - 1 ? (u === 1 || u === s.d - 2 ? PAL.walnut[1] : null) : v === 0 ? shine : leather[2]!);
    const armTop = (outer: number): Tex => (u, v) => (u === outer && (v === 0 || v === s.d - 1) ? null : u === 1 || u === 2 ? shine : leather[3]!);
    return {
        parts: [
            box(armW, 0, 0, inner, back, s.h, { top: (_u, v) => (v === back - 1 ? shine : leather[3]!), front: tufted, back: leather[2]!, sides: leather[2]! }),
            box(armW, back, 0, inner, s.d - back, seat, {
                top: (u, v) => (u === Math.floor(inner / 2) ? leather[1]! : v === s.d - back - 1 ? shine : leather[3]!),
                sides: (_u, v) => (v === seat - 1 ? null : v === 0 ? leather[2]! : leather[1]!)
            }),
            box(0, 0, 0, armW, s.d, arm, { top: armTop(0), front: armEnd(1), back: armEnd(armW - 2), left: armOuter, right: leather[2]! }),
            box(s.w - armW, 0, 0, armW, s.d, arm, { top: armTop(armW - 1), front: armEnd(armW - 2), back: armEnd(1), right: armOuter, left: leather[2]! })
        ]
    };
}

function coffeeTable(s: Size): Model {
    // A walnut top on four legs; magazines, papers and a cup on top.
    const legs = s.h - 2;
    const top = decals((_u, v) => (v === s.d - 1 ? PAL.walnut[5] : PAL.walnut[4]), [
        { x: 1, y: 2, w: 5, h: 3, c: PAL.cloth.denim[3]! }, { x: 2, y: 3, w: 3, h: 1, c: PAL.paper[3] }, { x: 7, y: 1, w: 4, h: 3, c: PAL.paper[2] }, { x: 12, y: 3, w: 1, h: 1, c: PAL.paper[3] }
    ]);
    const parts = [box(0, 0, legs, s.w, s.d, 2, { top, sides: (_u, v) => (v === 0 ? PAL.walnut[3] : PAL.walnut[2]), bump: { top: 0.8, face: 0.75 } })];
    for (const [x, y] of [[0, 0], [s.w - 1, 0], [0, s.d - 1], [s.w - 1, s.d - 1]] as const) parts.push(box(x, y, 0, 1, 1, legs, { sides: PAL.walnut[1], top: PAL.walnut[1] }));
    return { parts };
}

function plant(s: Size, seed: number): Model {
    // A brass planter 0.5m tall filling the footprint; a rubber plant above it, its leaves spreading past the planter.
    const pot = 6, rand = mulberry32(seed);
    const parts: Part[] = [
        box(0, 0, 0, s.w, s.d, pot, {
            top: (u, v) => (u === 0 || v === 0 || u === s.w - 1 || v === s.d - 1 ? PAL.brass[5] : PAL.terracotta[0]),
            sides: u => (u < 2 ? PAL.brass[4] : u > s.w - 2 ? PAL.brass[1] : PAL.brass[3]),
            bump: { top: 0.8, face: 0.8 }
        }),
        box(Math.floor(s.w / 2) - 1, Math.floor(s.d / 2) - 1, pot, 2, 2, s.h - pot - 2, { sides: PAL.leaf[1], top: PAL.leaf[2] })
    ];
    for (let i = 0; i < 16; i++) {
        const x = -4 + Math.floor(rand() * (s.w + 6)), y = -2 + Math.floor(rand() * (s.d + 2)), z = pot + 2 + Math.floor(rand() * (s.h - pot - 3));
        const tone = z > s.h - 6 ? 4 : z > s.h - 11 ? 3 : 2;
        parts.push(box(x, y, z, 3, 2, 1, { top: step(PAL.leaf, tone + 1), sides: step(PAL.leaf, tone) }));
    }
    return { parts };
}

function brochureRack(s: Size): Model {
    // A back panel with side cheeks and three shelves of leaflets facing out.
    const colors = [PAL.cloth.denim[3]!, PAL.paper[3], PAL.cloth.burgundy[3]!, PAL.cloth.teal[3]!, PAL.cloth.mustard[3]!, PAL.paper[2]];
    const parts: Part[] = [
        box(0, 0, 0, s.w, 1, s.h, { sides: PAL.walnut[2], top: PAL.walnut[4] }),
        box(0, 1, 0, 1, s.d - 1, s.h, { sides: PAL.walnut[2], top: PAL.walnut[4] }),
        box(s.w - 1, 1, 0, 1, s.d - 1, s.h, { sides: PAL.walnut[2], top: PAL.walnut[4] })
    ];
    for (let shelf = 0; shelf < 3; shelf++) {
        const z = 1 + shelf * 6;
        parts.push(box(1, 1, z, s.w - 2, s.d - 1, 1, { top: PAL.walnut[4], sides: PAL.walnut[1] }));
        for (let col = 0; col < 2; col++) {
            const c = colors[shelf * 2 + col]!;
            parts.push(box(1 + col * 4, 1, z + 1, 3, 1, 4, { front: (_u, v) => (v === 0 ? mix(c, 0xffffff, 0.3) : c), sides: c, top: mix(c, 0xffffff, 0.3) }));
        }
    }
    return { parts };
}

function bin(s: Size): Model {
    const top: Tex = (u, v) => (u === 0 || v === 0 || u === s.w - 1 || v === s.d - 1 ? PAL.brass[5] : PAL.ink);
    return { parts: [box(0, 0, 0, s.w, s.d, s.h, { top, sides: (u, v) => (v === 0 ? PAL.brass[5] : u === 0 ? PAL.brass[4] : u === s.w - 1 ? PAL.brass[1] : PAL.brass[3]), bump: { top: 0.6, face: 0.8 } })] };
}

function streetLamp(s: Size): Model {
    // A cast-iron post with a lantern head 0.6m across at the top, unlit by day.
    const iron = PAL.steel, head = s.h - 7;
    return {
        parts: [
            box(0, 0, 0, s.w, s.d, 3, { top: iron[2], sides: iron[1] }),
            box(1, 1, 3, 2, 2, head - 3, { top: iron[3], sides: u => (u === 0 ? iron[3] : iron[2]) }),
            box(-1, -1, head, 6, 6, 1, { top: iron[2], sides: iron[1] }),
            box(-1, -1, head + 1, 6, 6, 5, { top: PAL.glass[3], sides: u => (u === 0 || u === 5 ? iron[1] : u < 3 ? PAL.glass[4] : PAL.glass[3]) }),
            box(-2, -2, head + 6, 8, 8, 1, { top: iron[2], sides: iron[1] })
        ]
    };
}

function hydrant(s: Size): Model {
    // A red barrel with a domed cap, a nozzle on each side and the big pumper nozzle on its front.
    const red = PAL.carpet;
    return {
        parts: [
            box(0, 0, 0, s.w, s.d, s.h - 2, { top: red[4], sides: (u, v) => (v === s.h - 3 ? red[1] : u === 0 ? red[4] : u === s.w - 1 ? red[1] : red[3]), bump: { top: 0.9, face: 0.75 } }),
            box(1, 1, s.h - 2, s.w - 2, s.d - 2, 2, { top: red[4], sides: red[3] }),
            box(-1, 2, 4, 1, 1, 1, { sides: red[2], top: red[3] }),
            box(s.w, 2, 4, 1, 1, 1, { sides: red[2], top: red[3] }),
            box(2, s.d - 1, 3, 1, 1, 2, { sides: red[2], top: red[3] })
        ]
    };
}

function newsBox(s: Size): Model {
    // A vending box on short legs, the day's front page behind the window on its front.
    const legs = 3, body = PAL.cloth.teal;
    const parts: Part[] = [box(0, 0, legs, s.w, s.d, s.h - legs, {
        top: (_u, v) => (v === s.d - 1 ? body[3]! : body[2]!),
        front: (u, v) => (v >= 1 && v < 6 && u > 0 && u < s.w - 1 ? (v === 1 ? PAL.ink : PAL.paper[2]) : v === 0 ? body[3]! : body[2]!),
        sides: body[1]!
    })];
    for (const [x, y] of [[0, 0], [s.w - 1, 0], [0, s.d - 1], [s.w - 1, s.d - 1]] as const) parts.push(box(x, y, 0, 1, 1, legs, { sides: PAL.steel[1], top: PAL.steel[1] }));
    return { parts };
}

function streetBin(s: Size): Model {
    const body = PAL.leaf;
    const top: Tex = (u, v) => (u === 0 || v === 0 || u === s.w - 1 || v === s.d - 1 ? body[3] : PAL.ink);
    return { parts: [box(0, 0, 0, s.w, s.d, s.h, { top, sides: (u, v) => (v === 0 ? body[3] : u % 3 === 0 ? body[1] : body[2]) })] };
}

function bollard(s: Size): Model {
    return { parts: [box(0, 0, 0, s.w, s.d, s.h, { top: PAL.steel[4], sides: (u, v) => (v === 2 ? PAL.brass[3] : u === 0 ? PAL.steel[4] : PAL.steel[2]), bump: { top: 1, face: 0.8 } })] };
}

function manhole(s: Size): Model {
    const r = s.w / 2;
    const top: Tex = (u, v) => (!inEllipse(u, v, r, r, r, r) ? null : !inEllipse(u, v, r, r, r - 1, r - 1) ? PAL.steel[0] : u % 2 === 0 && Math.abs(v + 0.5 - r) < 2 ? PAL.steel[2] : PAL.steel[1]);
    return { parts: [box(0, 0, 0, s.w, s.d, 0, { top, bump: { top: 0.4, face: 0.4 } })] };
}

/** Props built as box models; the van is drawn by hand (van.ts). */
function model(p: Exclude<LobbyProp, { kind: 'van' }>, s: Size): Model {
    switch (p.kind) {
        case 'counter': return counter(p, s);
        case 'backCounter': return backCounter(p, s);
        case 'filingCabinet': return filingCabinet(s);
        case 'printer': return printer(s);
        case 'waterCooler': return waterCooler(s);
        case 'crest': return crest(s);
        case 'clock': return clock(s);
        case 'painting': return painting(s);
        case 'noticeBoard': return noticeBoard(s);
        case 'exitSign': return exitSign(s);
        case 'keycardLed': return keycardLed(s);
        case 'atmScreen': return atmScreen(s);
        case 'camera': return camera(s);
        case 'queueRail': return queueRail(p, s);
        case 'mat': return mat(s);
        case 'writingDesk': return writingDesk(s);
        case 'sofa': return sofa(s);
        case 'coffeeTable': return coffeeTable(s);
        case 'plant': return plant(s, p.tx * 13 + p.ty * 7);
        case 'brochureRack': return brochureRack(s);
        case 'bin': return bin(s);
        case 'streetLamp': return streetLamp(s);
        case 'hydrant': return hydrant(s);
        case 'newsBox': return newsBox(s);
        case 'streetBin': return streetBin(s);
        case 'bollard': return bollard(s);
        case 'manhole': return manhole(s);
    }
}

/** Draws a prop of catalog size `s` (in its own frame) turned to `facing`. */
export function propArt(p: LobbyProp, s: Size, facing: Facing): PropArt {
    if (p.kind === 'van') return vanArt(s, facing);
    return renderModel(model(p, s), s, facing);
}
