import type { Facing, Size } from '../../level/space';
import { PAL, mix } from '../palette';
import { mulberry32 } from '../random';
import { hung } from './dressing';
import { part, roundBands, rows, Turn, View, type Faces, type Part, type PropArt } from './view';

/*
 * Furniture of the bank's back rooms: the vault and the deposit boxes, the server and CCTV rooms, the manager's office,
 * the break room, the restrooms and the closets. Each is drawn from its catalog box in its own frame (x across its
 * front, y from its back to its front, z up), with every visible face painted by hand.
 */

const S = PAL.steel, W = PAL.walnut, O = PAL.oak, C = PAL.cloth.white;
/** Bank-note bundles: grey-green paper with a paler band. */
const CASH = [mix(PAL.leaf[2], PAL.paper[1], 0.45), mix(PAL.leaf[3], PAL.paper[2], 0.5), mix(PAL.leaf[4], PAL.paper[3], 0.55)] as const;
/** A dim CCTV picture: grey-blue, unlit. */
const FEED = [mix(PAL.emissive.screen[0], S[1], 0.5), mix(PAL.emissive.screen[1], S[3], 0.55), mix(PAL.emissive.screen[2], S[5], 0.5)] as const;

/** A wall of safe deposit boxes: small steel doors in rows, two keyholes each (the customer's and the bank's). */
export function depositBoxes(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const front = (u: number, v: number) => {
        if (v === s.h - 1) return S[0];
        if (u % 5 === 0 || v % 4 === 0) return S[1];
        if (v % 4 === 2 && (u % 5 === 2 || u % 5 === 3)) return PAL.brass[3];
        if (v % 4 === 1 && u % 5 === 1) return S[5];
        return u % 5 === 4 ? S[2] : S[3];
    };
    t.draw(view, [[part(0, 0, 0, s.w, s.d, s.h), {
        top: rows(v => (v === s.d - 1 ? S[5] : S[3])), front, back: S[1],
        sides: (u, v) => (v === 0 ? S[4] : v === s.h - 1 ? S[0] : u === 0 || u === s.d - 1 ? S[1] : S[2])
    }]]);
    view.outline(0.3);
    return view.art();
}

/** Steel shelving in the vault: bundled notes on the upper shelves, gold bars on the lowest. */
export function cashShelf(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const parts: [Part, Faces][] = [
        [part(0, 0, 0, s.w, 1, s.h), { sides: S[1], top: S[2] }],
        [part(0, 1, 0, 1, s.d - 1, s.h), { sides: rows(v => (v === 0 ? S[4] : S[2])), front: S[3], top: S[4] }],
        [part(s.w - 1, 1, 0, 1, s.d - 1, s.h), { sides: rows(v => (v === 0 ? S[4] : S[2])), front: S[3], top: S[4] }]
    ];
    for (let shelf = 0; shelf < 4; shelf++) {
        const z = shelf * 6, gold = shelf === 0;
        parts.push([part(1, 1, z, s.w - 2, s.d - 1, 1), { top: S[3], sides: S[1] }]);
        const load = gold ? 3 : 4;
        parts.push([part(1, 1, z + 1, s.w - 2, s.d - 2, load), {
            front: (u, v) => (gold ? (v === 0 ? PAL.brass[5] : u % 4 === 3 ? PAL.brass[1] : PAL.brass[3]) : u % 3 === 2 ? CASH[0] : v === 1 ? PAL.paper[3] : CASH[1]),
            sides: gold ? PAL.brass[2] : CASH[0],
            top: (u: number) => (gold ? (u % 4 === 3 ? PAL.brass[2] : PAL.brass[4]) : u % 3 === 2 ? CASH[1] : CASH[2])
        }]);
    }
    t.draw(view, parts);
    view.outline(0.3);
    return view.art();
}

/** The antechamber's console: a steel desk under a raised panel with two screens and the time-lock keypad. */
export function vaultConsole(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const desk = s.h - 5;
    t.draw(view, [
        [part(0, 0, 0, s.w, 3, s.h), { top: S[2], front: rows(v => (v === 0 ? S[3] : S[1])), back: S[1], sides: S[1] }],
        [part(0, 3, 0, s.w, s.d - 3, desk), {
            top: (u, v) => (v === s.d - 4 ? S[4] : u >= 12 && u < 16 && v > 0 && v < 4 ? ((u + v) % 2 ? S[1] : S[4]) : S[3]),
            front: (u, v) => (v === 0 ? S[4] : u % 6 === 0 ? S[1] : v === 3 && u % 6 === 3 ? S[5] : S[2]), sides: S[2], back: S[1]
        }],
        [part(2, 2, desk + 1, 5, 1, 3), { front: rows(v => (v === 0 ? PAL.emissive.screen[2] : PAL.emissive.screen[1])), sides: S[1], top: S[1], glow: true }],
        [part(9, 2, desk + 1, 5, 1, 3), { front: (u, v) => (v === 1 && u > 0 && u < 4 ? PAL.emissive.ledGreen : PAL.emissive.screen[0]), sides: S[1], top: S[1], glow: true }]
    ]);
    t.light(view, s.w / 2, 3, desk + 3, 30, 0x7fd8e8, 0.7);
    view.outline(0.3);
    return view.art();
}

/** A server rack: a black cabinet with a perforated door, its status lights showing through. */
export function serverRack(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const K = PAL.cloth.black;
    t.draw(view, [[part(0, 0, 0, s.w, s.d, s.h), {
        top: rows(v => (v === s.d - 1 ? S[2] : K[2]!)),
        front: (u, v) => (u === 0 || u === s.w - 1 || v === 0 || v === s.h - 1 ? S[1] : (u + v) % 2 === 0 ? K[0]! : K[2]!),
        back: (u, v) => (v % 3 === 1 && u > 1 && u < s.w - 2 ? S[2] : K[1]!),
        sides: (u, v) => (v === 0 ? S[2] : v % 6 === 3 && u > 1 && u < s.d - 2 ? K[0]! : K[1]!),
        corner: 1
    }]]);
    // Status lights through the front door.
    if (facing === 'south') {
        const rand = mulberry32(17);
        for (let z = 3; z < s.h - 2; z += 2) for (let x = 2; x < s.w - 2; x += 2) if (rand() > 0.55) view.glowFace(x, z, rand() > 0.7 ? PAL.cloth.mustard[3]! : PAL.emissive.ledGreen);
    }
    view.outline(0.25);
    return view.art();
}

/** A steel cash trolley: two drawers, a push bar at the back, four castors. */
export function cashCart(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const parts: [Part, Faces][] = [];
    for (const [x, y] of [[0, 0], [s.w - 1, 0], [0, s.d - 1], [s.w - 1, s.d - 1]] as const) parts.push([part(x, y, 0, 1, 1, 2), { sides: PAL.ink, top: PAL.ink }]);
    parts.push([part(0, 0, 2, s.w, s.d, s.h - 4), {
        top: (u, v) => (v === s.d - 1 ? S[5] : v > 1 && v < s.d - 2 && u > 0 && u < s.w - 1 ? CASH[1] : S[4]),
        front: (u, v) => (v === 0 ? S[5] : v === 4 ? S[1] : (v === 2 || v === 6) && u > 2 && u < s.w - 3 ? S[5] : S[3]),
        sides: rows(v => (v === 0 ? S[4] : S[2]))
    }]);
    parts.push([part(0, 0, s.h - 2, 1, 1, 2), { sides: S[2], top: S[4] }], [part(s.w - 1, 0, s.h - 2, 1, 1, 2), { sides: S[2], top: S[4] }]);
    parts.push([part(0, 0, s.h - 1, s.w, 1, 1), { sides: S[4], top: S[5] }]);
    t.draw(view, parts);
    view.outline(0.3);
    return view.art();
}

/** The alarm panel by the closet door: a grey box, a green status line, a keypad and a red armed light. */
export function alarmPanel(s: Size, facing: Facing): PropArt {
    return hung(s, facing, (u, v) => {
        if (u === 0 || v === 0 || u === s.w - 1 || v === s.h - 1) return { c: v === 0 ? S[4] : S[2] };
        if (v === 1 && u < s.w - 2) return { c: PAL.emissive.exitGreen[1], glow: true };
        if (v === 1) return { c: PAL.emissive.ledRed, glow: true };
        if (v >= 3 && v <= 5 && u >= 1 && u <= 4) return { c: (u + v) % 2 ? S[5] : S[1] };
        return { c: S[3] };
    }, S[1], S[4]);
}

/** The breaker cabinet: a grey steel door on two hinges, its latch and a yellow warning triangle. */
export function breakerPanel(s: Size, facing: Facing): PropArt {
    const mid = Math.floor(s.w / 2);
    return hung(s, facing, (u, v) => {
        if (u === 0 || v === 0 || u === s.w - 1 || v === s.h - 1) return { c: v === 0 ? S[4] : S[1] };
        if (u === 1 && (v === 2 || v === s.h - 3)) return { c: S[5] };
        if (u === s.w - 2 && v === Math.floor(s.h / 2)) return { c: S[5] };
        const tri = v >= 2 && v <= 4 && Math.abs(u - mid) <= v - 2;
        if (tri) return { c: v === 4 && u === mid ? PAL.ink : PAL.cloth.mustard[3]! };
        return { c: u === 2 ? S[2] : S[3] };
    }, S[1], S[3]);
}

/**
 * The CCTV operator's desk: a dark laminate top, four monitors cycling the feeds (towards the operator, at the
 * front), a keyboard and the recorder humming under it.
 */
export function cctvDesk(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { headroom: 1 });
    const top = 9, rand = mulberry32(5);
    const parts: [Part, Faces][] = [
        [part(0, 2, 0, s.w, s.d - 2, top), {
            top: (u, v) => (v === s.d - 3 ? S[3] : v === s.d - 5 && u > 8 && u < 16 ? S[4] : S[1]),
            front: (u, v) => (v === 0 ? S[3] : u > 1 && u < 8 && v > 2 && v < 7 ? (v === 4 ? PAL.emissive.ledGreen : PAL.cloth.black[1]!) : S[1]),
            sides: S[1], back: S[0]
        }]
    ];
    for (let i = 0; i < 4; i++) {
        const shade = Math.floor(rand() * 3);
        parts.push([part(1 + i * 6, 0, top, 5, 2, 5), { top: S[1], back: S[1], sides: S[0], corner: 1 }]);
        parts.push([part(1 + i * 6, 2, top + 1, 5, 1, 3), {
            front: (u, v) => (v === 0 && u === 4 ? PAL.emissive.ledRed : (u + v + i) % 4 === 0 ? FEED[2] : FEED[(shade + v) % 2]!), sides: S[0], top: S[0], glow: true
        }]);
    }
    t.draw(view, parts);
    t.light(view, s.w / 2, s.d, top + 3, 40, 0x9ec8d8, 0.6);
    view.outline(0.3);
    return view.art();
}

/** The manager's desk: walnut pedestals with drawers, a leather inlay, papers, a banker's lamp and a monitor facing the chair behind it. */
export function desk(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { headroom: 7 });
    const legs = s.h - 2, ped = 6;
    const drawers = (u: number, v: number) => (v === 0 ? W[4] : v % 3 === 0 ? W[1] : v % 3 === 1 && (u === 2 || u === 3) ? PAL.brass[4] : W[3]);
    t.draw(view, [
        [part(0, 1, 0, ped, s.d - 2, legs), { front: drawers, back: W[2], sides: rows(v => (v === 0 ? W[3] : W[2])), top: W[2] }],
        [part(s.w - ped, 1, 0, ped, s.d - 2, legs), { front: drawers, back: W[2], sides: rows(v => (v === 0 ? W[3] : W[2])), top: W[2] }],
        [part(ped, 1, 1, s.w - ped * 2, 1, legs - 1), { sides: W[2], back: W[2], front: W[1] }],
        [part(0, 0, legs, s.w, s.d, 2), {
            top: (u, v) => (v === s.d - 1 ? W[5] : u > 2 && u < s.w - 3 && v > 1 && v < s.d - 2 ? (v === 2 ? PAL.leaf[2] : PAL.leaf[1]) : W[4]),
            sides: rows(v => (v === 0 ? W[4] : W[2])), corner: 1
        }],
        [part(3, 4, s.h, 5, 3, 0), { top: rows(v => (v === 0 ? PAL.paper[2] : PAL.paper[3])) }],
        [part(12, 1, s.h, 1, 1, 4), { sides: S[1], top: S[1] }],
        [part(10, 1, s.h + 3, 6, 1, 4), { back: rows(v => (v === 0 ? PAL.emissive.screen[2] : PAL.emissive.screen[1])), front: S[1], sides: S[0], top: S[1], glow: facing === 'north' }],
        [part(s.w - 4, 2, s.h, 1, 1, 4), { sides: PAL.brass[3], top: PAL.brass[4] }],
        [part(s.w - 6, 1, s.h + 4, 5, 2, 2), { top: PAL.leaf[4], sides: rows(v => (v === 1 ? PAL.emissive.lampWarm[0] : PAL.leaf[5])), glow: true, corner: 1 }]
    ]);
    t.light(view, s.w - 3.5, 2, s.h + 4, 44, 0xffcf8a, 1.2);
    view.outline(0.3);
    return view.art();
}

/** A swivel office chair facing the way it faces: five-star foot, gas column, cushioned seat, curved back, armrests. */
export function officeChair(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const K = PAL.cloth.charcoal, seat = 5;
    const cx = s.w / 2, cy = s.d / 2 + 1;
    const [vx, vy] = t.point(cx, cy);
    view.cylinder(vx, vy, 3.2, 0, 1, a => (a < 0 ? S[2] : S[1]), (a, b) => (Math.abs(a) < 0.25 || Math.abs(b) < 0.3 ? S[2] : null));
    view.cylinder(vx, vy, 0.8, 1, seat - 1, a => (a < 0 ? S[4] : S[2]), null);
    t.draw(view, [
        [part(1, 2, seat, s.w - 2, s.d - 3, 1), { top: rows(v => (v === s.d - 4 ? K[3]! : K[2]!)), sides: K[1]!, corner: 1 }],
        [part(1, 1, seat + 1, s.w - 2, 2, s.h - seat - 1), { top: K[3]!, front: rows(v => (v === 0 ? K[3]! : K[2]!)), back: K[1]!, sides: K[1]!, corner: 1 }],
        [part(0, 3, seat + 2, 1, s.d - 5, 1), { top: K[2]!, sides: K[0]! }],
        [part(s.w - 1, 3, seat + 2, 1, s.d - 5, 1), { top: K[2]!, sides: K[0]! }]
    ]);
    view.outline(0.3);
    return view.art();
}

/** Coloured spines along a shelf `w` wide: book heights, colours and the odd gap from a seed. */
function spines(seed: number, w: number): (u: number, v: number) => number | null {
    const rand = mulberry32(seed), colours = [PAL.carpet[2], PAL.cloth.navy[3]!, PAL.leaf[3], PAL.cloth.mustard[2]!, PAL.paper[2], PAL.cloth.burgundy[3]!, W[3]];
    const books = Array.from({ length: w }, () => ({ top: Math.floor(rand() * 2), c: colours[Math.floor(rand() * colours.length)]!, gap: rand() > 0.9 }));
    return (u, v) => {
        const b = books[u]!;
        if (b.gap || v < b.top) return null;
        return v === b.top ? mix(b.c, 0xffffff, 0.2) : u % 2 ? b.c : mix(b.c, PAL.ink, 0.25);
    };
}

/** A walnut bookcase: four shelves of ledgers and binders. */
export function bookshelf(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const parts: [Part, Faces][] = [
        [part(0, 0, 0, s.w, 1, s.h - 1), { sides: W[1], back: W[2], top: W[3] }],
        [part(0, 1, 0, 1, s.d - 1, s.h - 1), { sides: rows(v => (v === 0 ? W[4] : W[2])), front: W[3], top: W[4] }],
        [part(s.w - 1, 1, 0, 1, s.d - 1, s.h - 1), { sides: rows(v => (v === 0 ? W[4] : W[2])), front: W[3], top: W[4] }],
        [part(0, 0, s.h - 1, s.w, s.d, 1), { top: rows(v => (v === s.d - 1 ? W[5] : W[4])), sides: W[3], corner: 1 }]
    ];
    for (let shelf = 0; shelf < 4; shelf++) {
        const z = shelf * 6;
        parts.push([part(1, 1, z, s.w - 2, s.d - 1, 1), { top: W[4], sides: W[1] }]);
        parts.push([part(1, 1, z + 1, s.w - 2, s.d - 2, 5), { front: spines(shelf * 7 + 3, s.w - 2), sides: W[1], top: W[2] }]);
    }
    t.draw(view, parts);
    view.outline(0.3);
    return view.art();
}

/** A row of three grey-blue staff lockers: vents at the top, a handle and a name card on each door. */
export function lockers(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const L = [mix(S[1], PAL.cloth.denim[1]!, 0.5), mix(S[2], PAL.cloth.denim[2]!, 0.5), mix(S[3], PAL.cloth.denim[3]!, 0.5), mix(S[4], PAL.cloth.denim[3]!, 0.4)];
    const front = (u: number, v: number) => {
        const door = u % 5;
        if (door === 0 || v === s.h - 1) return L[0]!;
        if (v >= 2 && v <= 4 && v % 2 === 0 && door > 0 && door < 4) return L[0]!;
        if (v === 11 && door === 3) return S[5];
        if (v === 7 && (door === 1 || door === 2)) return PAL.paper[3];
        return door === 4 ? L[1]! : L[2]!;
    };
    t.draw(view, [[part(0, 0, 0, s.w, s.d, s.h), { top: rows(v => (v === s.d - 1 ? L[3]! : L[2]!)), front, back: L[1]!, sides: rows(v => (v === 0 ? L[3]! : L[1]!)) }]]);
    view.outline(0.3);
    return view.art();
}

/** Steel shelving loaded with supplies: paper towels, bottles of cleaner, boxes. */
export function shelving(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const parts: [Part, Faces][] = [];
    for (const x of [0, s.w - 1]) for (const y of [0, s.d - 1]) parts.push([part(x, y, 0, 1, 1, s.h), { sides: S[2], top: S[4] }]);
    const rand = mulberry32(31);
    const goods = [PAL.paper[3], PAL.cloth.denim[3]!, PAL.cloth.mustard[3]!, PAL.plywood[3], PAL.leaf[4], PAL.carpet[3]];
    for (let shelf = 0; shelf < 4; shelf++) {
        const z = shelf * 6 + (shelf === 3 ? -1 : 0);
        parts.push([part(0, 0, z, s.w, s.d, 1), { top: (u: number) => (u % 4 === 0 ? S[2] : S[3]), sides: S[2] }]);
        if (shelf === 3) continue;
        let x = 1;
        while (x < s.w - 2) {
            const w = 2 + Math.floor(rand() * 3), h = 2 + Math.floor(rand() * 3), c = goods[Math.floor(rand() * goods.length)]!;
            if (x + w > s.w - 1) break;
            parts.push([part(x, 1, z + 1, w, s.d - 2, h), { front: rows(v => (v === 0 ? mix(c, 0xffffff, 0.25) : c)), sides: mix(c, PAL.ink, 0.25), top: mix(c, 0xffffff, 0.25) }]);
            x += w + (rand() > 0.6 ? 1 : 0);
        }
    }
    t.draw(view, parts);
    view.outline(0.3);
    return view.art();
}

/** A yellow mop bucket with its wringer, the mop's handle leaning out of it. */
export function mopBucket(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { margin: 2 });
    const Y = PAL.cloth.mustard, [cx, cy] = t.point(s.w / 2, s.d / 2);
    view.cylinder(cx, cy, s.w / 2, 0, 5, (a, v) => (v === 0 ? Y[3]! : roundBands([Y[0]!, Y[1]!, Y[2]!, Y[3]!, mix(Y[3]!, 0xffffff, 0.3)], a)), (a, b) => (a * a + b * b > 0.5 ? Y[3]! : PAL.cloth.teal[1]!));
    view.block(Math.floor(cx) - 1, Math.floor(cy) - 2, 5, 3, 2, 2, S[3], S[2]);
    // The handle leans from the bucket towards the back left.
    for (let z = 6; z <= s.h; z++) {
        const f = (z - 6) / (s.h - 6), [hx, hy] = t.point(s.w / 2 - f * 1.5, s.d / 2 - f * 1.5);
        const [col, row] = view.project(hx, hy, z);
        view.dot(col, row, z === s.h ? PAL.cloth.denim[3]! : O[3]);
    }
    view.outline(0.3);
    return view.art();
}

/** The cash machine from the inside: a steel safe cabinet with a service door, a combination dial and a vent. */
export function atmBack(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const front = (u: number, v: number) => {
        if (v === s.h - 1) return S[0];
        if (u === 1 || u === s.w - 2 || v === 1 || v === s.h - 3) return S[1];
        if (v >= 3 && v <= 5 && u >= 3 && u <= 7 && v % 2 === 1) return S[1];
        const d = Math.hypot(u + 0.5 - s.w / 2, v + 0.5 - 11);
        if (d < 1.5) return S[5];
        if (d < 2.5) return S[1];
        return u < 3 ? S[4] : S[3];
    };
    t.draw(view, [[part(0, 0, 0, s.w, s.d, s.h), { top: rows(v => (v === s.d - 1 ? S[5] : S[3])), front, back: S[1], sides: rows(v => (v === 0 ? S[4] : S[2])), corner: 1 }]]);
    view.outline(0.3);
    return view.art();
}

/** A stack of cardboard boxes, taped shut, one with a shipping label. */
export function boxes(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const B = PAL.plywood;
    const box = (labelled: boolean): Faces => ({
        top: (u: number, v: number) => (u === 2 || v === 2 ? B[1] : B[4]),
        front: (u, v) => (v === 0 ? B[4] : labelled && u >= 1 && u <= 3 && v >= 2 && v <= 3 ? PAL.paper[3] : u % 7 === 6 ? B[1] : B[3]),
        sides: rows(v => (v === 0 ? B[3] : B[2]))
    });
    t.draw(view, [
        [part(0, 3, 0, 8, 7, 7), box(true)],
        [part(8, 4, 0, 5, 6, 5), box(false)],
        [part(1, 4, 7, 6, 5, 6), box(false)]
    ]);
    view.outline(0.3);
    return view.art();
}

/** The break room's table: an oak veneer top on four legs, two mugs and a folded newspaper. */
export function diningTable(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { headroom: 2 });
    const legs = s.h - 2, parts: [Part, Faces][] = [];
    for (const [x, y] of [[1, 1], [s.w - 2, 1], [1, s.d - 2], [s.w - 2, s.d - 2]] as const) parts.push([part(x, y, 0, 1, 1, legs), { sides: S[2], top: S[2] }]);
    parts.push([part(0, 0, legs, s.w, s.d, 2), { top: (u, v) => (v === s.d - 1 ? O[4] : (u * 3 + v) % 11 === 0 ? O[2] : O[3]), sides: rows(v => (v === 0 ? O[3] : O[1])), corner: 1 }]);
    parts.push([part(4, 3, s.h, 6, 4, 0), { top: (u, v) => (v === 0 ? PAL.ink : u === 3 ? PAL.paper[1] : PAL.paper[2]) }]);
    t.draw(view, parts);
    for (const [mx, my, c] of [[13.5, 4.5, PAL.paper[3]], [15.5, 7.5, PAL.carpet[3]]] as const) {
        const [x, y] = t.point(mx, my);
        view.cylinder(x, y, 1, s.h, 2, a => (a < 0 ? c : mix(c, PAL.ink, 0.2)), () => W[0]);
    }
    view.outline(0.3);
    return view.art();
}

/** A plain wooden chair: four legs, a seat, a slatted back at its rear. */
export function chair(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const seat = 5, parts: [Part, Faces][] = [];
    for (const [x, y] of [[0, 0], [s.w - 1, 0], [0, s.d - 1], [s.w - 1, s.d - 1]] as const) parts.push([part(x, y, 0, 1, 1, seat - 1), { sides: O[1], top: O[1] }]);
    parts.push([part(0, 0, seat - 1, s.w, s.d, 1), { top: rows(v => (v === s.d - 1 ? O[4] : O[3])), sides: O[2], corner: 1 }]);
    parts.push([part(0, 0, seat, s.w, 1, s.h - seat), { front: (u, v) => (v === 0 ? O[4] : u === 0 || u === s.w - 1 ? O[2] : v === 2 ? O[3] : null), back: (u, v) => (v === 0 || u === 0 || u === s.w - 1 || v === 2 ? O[2] : null), sides: O[2], top: O[4] }]);
    t.draw(view, parts);
    view.outline(0.35);
    return view.art();
}

/** A white fridge-freezer, its freezer door above, chrome handles and a note stuck on with a magnet. */
export function fridge(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const freezer = 15;
    const front = (u: number, v: number) => {
        const z = s.h - v;
        if (z === freezer || v === s.h - 1) return C[1]!;
        if (u === s.w - 2 && (z === freezer + 3 || z === freezer + 4 || z === freezer - 3 || z === freezer - 4 || z === freezer - 5)) return S[5];
        if (u >= 2 && u <= 4 && z >= 9 && z <= 11) return z === 11 ? PAL.carpet[3] : PAL.paper[3];
        return u === 0 ? C[3]! : u === s.w - 1 ? C[1]! : C[2]!;
    };
    t.draw(view, [[part(0, 0, 0, s.w, s.d, s.h), { top: rows(v => (v === s.d - 1 ? C[3]! : C[2]!)), front, back: C[0]!, sides: rows(v => (v === 0 ? C[3]! : C[1]!)), corner: 1 }]]);
    view.outline(0.3);
    return view.art();
}

/**
 * The break room's kitchenette: white cupboards under a dark worktop, a steel sink with its tap, a microwave with its
 * clock glowing, and a kettle.
 */
export function kitchenCounter(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { headroom: 6 });
    const base = s.h - 1, K = PAL.cloth.charcoal;
    t.draw(view, [
        [part(0, 0, 0, s.w, s.d, base), {
            front: (u, v) => (v === 0 ? C[3]! : v === base - 1 ? PAL.ink : u % 8 === 0 ? C[0]! : v === 2 && u % 8 === 6 ? S[5] : C[2]!),
            back: C[0]!, sides: rows(v => (v === 0 ? C[3]! : C[1]!)), top: C[2]!
        }],
        [part(0, 0, base, s.w, s.d, 1), {
            top: (u, v) => (u >= 4 && u < 12 && v >= 2 && v < s.d - 1 ? (v === 2 ? S[1] : S[3]) : v === s.d - 1 ? K[3]! : K[2]!), sides: K[1]!
        }],
        [part(7, 0, s.h, 1, 2, 3), { sides: S[4], top: S[5] }],
        [part(7, 1, s.h + 2, 1, 2, 1), { sides: S[4], top: S[5] }],
        [part(17, 0, s.h, 8, 6, 5), {
            top: C[3]!, back: C[1]!, sides: C[1]!, corner: 1,
            front: (u, v) => (u === 0 || u === 7 || v === 0 || v === 4 ? C[2]! : u === 6 ? (v === 1 ? PAL.emissive.exitGreen[1] : S[2]) : u < 5 ? (v === 1 ? PAL.glass[2] : PAL.ink) : C[2]!)
        }]
    ]);
    const [kx, ky] = t.point(s.w - 3.5, s.d / 2);
    view.cylinder(kx, ky, 1.4, s.h, 3, a => roundBands([S[0], S[1], S[2], S[3], S[5]], a), () => S[1]);
    view.outline(0.3);
    return view.art();
}

/** A white toilet against the wall: the cistern at the back, the bowl with its seat in front. */
export function toilet(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const cistern = 3;
    t.draw(view, [[part(0, 0, 0, s.w, cistern, s.h), { top: rows(v => (v === cistern - 1 ? C[3]! : C[2]!)), front: rows(v => (v === 0 ? C[3]! : C[2]!)), sides: C[1]!, back: C[1]!, corner: 1 }]]);
    const [bx, by] = t.point(s.w / 2, cistern + (s.d - cistern) / 2);
    const r = Math.min(s.w, s.d - cistern) / 2;
    const [rx, ry] = facing === 'east' || facing === 'west' ? [(s.d - cistern) / 2, s.w / 2] : [s.w / 2, (s.d - cistern) / 2];
    for (let z = 1; z <= 5; z++) view.cylinder(bx, by, z < 3 ? r * 0.7 : Math.min(rx, ry), z - 1, 1, a => (z === 5 ? C[3]! : a < 0 ? C[2]! : C[1]!), null);
    view.cylinder(bx, by, Math.min(rx, ry), 5, 0, null, (a, b) => (a * a + b * b < 0.35 ? PAL.glass[2] : C[3]!));
    view.outline(0.3);
    return view.art();
}

/** A pedestal washbasin with a chrome tap, a mirror on the wall above it. */
export function washbasin(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { headroom: 9 });
    const [px, py] = t.point(s.w / 2, s.d / 2);
    view.cylinder(px, py, 1.2, 0, s.h - 3, a => (a < 0 ? C[2]! : C[1]!), null);
    t.draw(view, [
        [part(0, 0, s.h - 3, s.w, s.d, 3), { top: (u, v) => (u > 0 && u < s.w - 1 && v > 0 && v < s.d - 1 ? (v === 1 ? C[1]! : PAL.glass[3]) : C[3]!), front: rows(v => (v === 0 ? C[3]! : C[2]!)), sides: C[1]!, corner: 1 }],
        [part(Math.floor(s.w / 2), 0, s.h, 1, 2, 2), { sides: S[4], top: S[5] }],
        [part(1, 0, s.h + 3, s.w - 2, 1, 6), { front: (u, v) => (u === 0 || v === 0 || u === s.w - 3 || v === 5 ? S[3] : (u + v) % 5 === 0 ? PAL.glass[5] : PAL.glass[3]), back: S[2], sides: S[3], top: S[4] }]
    ]);
    view.outline(0.3);
    return view.art();
}
