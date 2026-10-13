import type { Facing, Size } from '../../level/space';
import { PAL, mix } from '../palette';
import { hung } from './dressing';
import { part, roundBands, rows, Turn, View, type Faces, type Part, type PropArt } from './view';

/*
 * The neighbours and the alley: the café's tables and counter, its menu board, and the dumpster, generator and roof
 * ladder behind the buildings. Drawn from their catalog boxes in their own frames, like every prop.
 */

const S = PAL.steel, O = PAL.oak, M = PAL.marbleCream;

/** A round café table: a marble top on an iron column and foot, two cups on it. */
export function cafeTable(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { headroom: 2 });
    const [cx, cy] = t.point(s.w / 2, s.d / 2), r = s.w / 2;
    view.cylinder(cx, cy, 2.4, 0, 1, a => (a < 0 ? S[2] : S[1]), () => S[2]);
    view.cylinder(cx, cy, 0.7, 1, s.h - 2, a => (a < 0 ? S[3] : S[1]), null);
    view.cylinder(cx, cy, r, s.h - 1, 1, a => roundBands([M[0], M[1], M[2], M[3], M[4]], a), (a, b) => (a * a + b * b > 0.75 ? M[3] : (a * 3 + b * 5) % 2 > 1.6 ? M[2] : M[4]));
    for (const [ox, oy, c] of [[-1.8, -0.5, PAL.paper[3]], [1.6, 1.2, PAL.paper[3]]] as const) {
        const [x, y] = t.point(s.w / 2 + ox, s.d / 2 + oy);
        view.cylinder(x, y, 0.8, s.h, 1, () => c, () => PAL.walnut[1]);
    }
    view.outline(0.3);
    return view.art();
}

/**
 * The café counter: oak panels under a marble top, the espresso machine (steel and brass, a cup under its group
 * head), a glass case of pastries and the till.
 */
export function cafeCounter(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { headroom: 7 });
    const top = s.h - 1;
    const pastry = [PAL.cloth.mustard[3]!, PAL.terracotta[3], PAL.paper[3], PAL.carpet[4]];
    t.draw(view, [
        [part(0, 0, 0, s.w, s.d, top), {
            front: (u, v) => (v === 0 ? O[4] : v === top - 1 ? O[0] : u % 6 === 0 ? O[1] : v === 1 || v === top - 2 ? O[2] : O[3]),
            back: (u, v) => (v === 0 ? O[3] : u % 8 === 0 ? O[1] : O[2]), sides: rows(v => (v === 0 ? O[4] : O[2])), top: O[3]
        }],
        [part(0, 0, top, s.w, s.d, 1), { top: (u, v) => (v === s.d - 1 ? M[4] : (u + v * 2) % 9 === 0 ? M[2] : M[3]), sides: M[1] }],
        [part(2, 1, s.h, 9, 4, 6), {
            top: S[4], back: S[2], sides: rows(v => (v === 0 ? S[5] : S[3])), corner: 1,
            front: (u, v) => (v === 0 ? S[5] : v === 1 && u > 1 && u < 7 ? PAL.brass[4] : v === 3 && (u === 2 || u === 6) ? S[1] : v === 5 && (u === 2 || u === 6) ? PAL.paper[3] : S[3])
        }],
        [part(14, 3, s.h, 10, 5, 4), {
            top: PAL.glass[4], sides: PAL.glass[4], back: PAL.glass[3], alpha: 120,
            front: (u, v) => (v === 0 || u === 0 || u === 9 ? PAL.glass[5] : v >= 2 ? pastry[(u + v) % pastry.length]! : PAL.glass[4])
        }],
        [part(14, 4, s.h, 10, 3, 2), { top: (u: number) => pastry[u % pastry.length]!, front: (u: number) => pastry[(u + 1) % pastry.length]!, sides: pastry[0]! }],
        [part(s.w - 4, 2, s.h, 3, 3, 3), { top: rows(v => (v === 0 ? PAL.ink : S[2])), front: rows(v => (v === 0 ? PAL.emissive.exitGreen[1] : S[1])), sides: S[1], back: S[1] }]
    ]);
    view.outline(0.3);
    return view.art();
}

/** The café's blackboard menu in a wooden frame, chalked with prices and a steaming cup. */
export function menuBoard(s: Size, facing: Facing): PropArt {
    return hung(s, facing, (u, v) => {
        if (u === 0 || v === 0 || u === s.w - 1 || v === s.h - 1) return { c: v === 0 ? O[4] : O[2] };
        if ((v === 2 || v === 4 || v === 6) && u >= 2 && u <= 9 && (u + v) % 4 !== 0) return { c: PAL.paper[2] };
        if (v >= 2 && v <= 6 && (u === 12 || u === 15) && v > 3) return { c: PAL.paper[3] };
        if (v === 6 && u >= 12 && u <= 15) return { c: PAL.paper[3] };
        if (v === 2 && (u === 13 || u === 14)) return { c: PAL.paper[1] };
        return { c: v === 1 ? mix(PAL.leaf[0], PAL.ink, 0.3) : PAL.leaf[0] };
    }, O[1], O[4]);
}

/** A green steel dumpster on castors, ribbed, its two lids shut, a rubbish bag poking out of one. */
export function dumpster(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { headroom: 1 });
    const G = PAL.leaf, body = s.h - 2;
    const parts: [Part, Faces][] = [];
    for (const [x, y] of [[1, 1], [s.w - 2, 1], [1, s.d - 2], [s.w - 2, s.d - 2]] as const) parts.push([part(x, y, 0, 1, 1, 2), { sides: PAL.ink, top: PAL.ink }]);
    parts.push([part(0, 1, 2, s.w, s.d - 1, body - 2), {
        front: (u, v) => (v === 0 ? G[3] : u % 5 === 2 ? G[1] : v === body - 3 ? G[0] : v === 2 && u >= 8 && u <= 14 ? PAL.paper[2] : G[2]),
        back: G[1], sides: (u, v) => (v === 0 ? G[3] : u % 4 === 1 ? G[1] : G[2]), top: G[2]
    }]);
    parts.push([part(0, 0, body, Math.floor(s.w / 2), s.d, 2), { top: (u, v) => (v === s.d - 1 ? G[3] : u % 4 === 0 ? G[1] : G[2]), sides: G[1], corner: 1 }]);
    parts.push([part(Math.floor(s.w / 2), 0, body, s.w - Math.floor(s.w / 2), s.d, 2), { top: (u, v) => (v === s.d - 1 ? G[3] : u % 4 === 0 ? G[1] : G[2]), sides: G[1], corner: 1 }]);
    parts.push([part(3, 5, s.h, 4, 3, 1), { top: PAL.cloth.black[2]!, sides: PAL.cloth.black[1]!, corner: 1 }]);
    t.draw(view, parts);
    view.outline(0.3);
    return view.art();
}

/** The bank's backup generator: a grey-yellow enclosure on a steel skid, louvred sides, a control panel and an exhaust stack. */
export function generator(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { headroom: 4 });
    const Y = PAL.cloth.mustard, body = s.h - 1;
    t.draw(view, [
        [part(0, 0, 0, s.w, s.d, 1), { top: S[2], sides: S[1] }],
        [part(1, 1, 1, s.w - 2, s.d - 2, body - 1), {
            top: (u, v) => (v === s.d - 3 ? Y[3]! : u % 6 === 0 ? Y[1]! : Y[2]!),
            front: (u, v) => (v === 0 ? Y[3]! : u >= 2 && u <= 5 && v >= 2 && v <= 5 ? (v === 3 && u === 3 ? PAL.emissive.ledGreen : S[1]) : u > 7 && v % 2 === 0 && v < body - 3 ? Y[0]! : Y[2]!),
            sides: (u, v) => (v === 0 ? Y[3]! : v % 2 === 0 && u > 1 && u < s.d - 4 && v < body - 3 ? Y[0]! : Y[1]!),
            back: Y[1]!, corner: 1
        }]
    ]);
    const [ex, ey] = t.point(s.w - 4, 3);
    view.cylinder(ex, ey, 1, s.h, 4, a => (a < 0 ? S[2] : S[1]), () => PAL.ink);
    view.outline(0.3);
    return view.art();
}

/** A steel ladder fixed to a wall, up to the roof: two rails and rungs on brackets. */
export function wallLadder(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const parts: [Part, Faces][] = [
        [part(0, 1, 0, 1, s.d - 1, s.h), { sides: rows(v => (v % 8 === 0 ? S[4] : S[3])), top: S[4], front: S[3] }],
        [part(s.w - 1, 1, 0, 1, s.d - 1, s.h), { sides: rows(v => (v % 8 === 0 ? S[4] : S[2])), top: S[4], front: S[2] }]
    ];
    for (let z = 2; z < s.h; z += 3) parts.push([part(1, s.d - 2, z, s.w - 2, 1, 1), { sides: S[4], top: S[5] }]);
    for (const z of [4, s.h - 4]) for (const x of [0, s.w - 1]) parts.push([part(x, 0, z, 1, 1, 1), { sides: S[1], top: S[2] }]);
    t.draw(view, parts);
    view.outline(0.3);
    return view.art();
}
