import { px, type Facing, type Size } from '../../level/space';
import { PAL, mix } from '../palette';
import { mulberry32 } from '../random';
import { hung } from './dressing';
import { NORMAL, part, roundBands, rows, Turn, View, type Faces, type Part, type PropArt } from './view';

/*
 * The neighbours and the alley: the café's tables and counter, its menu board, and the dumpster, generator and roof
 * ladder behind the buildings; the plazas' trees and benches across the street, and the sniper's rifle case. Drawn from
 * their catalog boxes in their own frames, like every prop.
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

/**
 * A street tree: a grey-brown trunk and a round crown of leaf clumps. Each clump is its own small dome, lit from the
 * upper left, and the crown darkens towards its underside and its back, so it reads as a ball of foliage rather than a
 * flat disc. The clumps are scattered over the crown in the tree's own frame, so each facing shows another side of it.
 */
export function tree(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { margin: 2, headroom: 1 });
    const G = PAL.leaf, B = PAL.concrete, rand = mulberry32(31);
    const [cx, cy] = t.point(s.w / 2, s.d / 2);
    // The crown starts a head above the pavement and rounds off at the tree's full height.
    const radius = s.w / 2 - 1, crownZ = px(1.9), crownHigh = s.h - crownZ - 1;
    view.cylinder(cx, cy, 1.7, 0, crownZ + 6, a => (a < -0.35 ? B[3] : a > 0.45 ? B[0] : B[1]), null);
    // Two boughs leaving the trunk under the crown, seen where the clumps leave gaps.
    for (const [ox, oy] of [[-4, 1], [4, -1]] as const) for (let k = 0; k <= 5; k++) {
        const [x, y] = t.point(s.w / 2 + (ox * k) / 5, s.d / 2 + (oy * k) / 5);
        const [col, row] = view.project(x, y, crownZ + 2 + k);
        view.dot(col, row, B[1]);
    }
    const clumps = Array.from({ length: 90 }, () => {
        // Spread over the crown's surface, a little inside it, more of them up top where the light is.
        const a = rand() * Math.PI * 2, up = Math.sqrt(rand()) * 1.7 - 0.7, r = Math.sqrt(Math.max(0, 1 - up * up)) * (0.72 + rand() * 0.22);
        const [x, y] = t.point(s.w / 2 + Math.cos(a) * r * radius, s.d / 2 + Math.sin(a) * r * radius);
        return { x, y, z: crownZ + crownHigh * 0.5 + up * crownHigh * 0.42, size: 3.4 + rand() * 2, up, depth: 0 };
    });
    // Back to front: further north and lower first.
    for (const c of clumps) c.depth = c.y + c.z * 0.6;
    for (const c of clumps.sort((a, b) => a.depth - b.depth)) {
        const [col, row] = view.project(c.x, c.y, c.z), front = (c.y - cy) / radius;
        for (let j = -Math.ceil(c.size); j <= Math.ceil(c.size); j++) for (let i = -Math.ceil(c.size); i <= Math.ceil(c.size); i++) {
            const d = Math.hypot(i, j * 1.15) / c.size;
            if (d > 1) continue;
            // Light from the upper left on the clump, plus the crown's own roundness: lit above, dark below and behind.
            const light = (-i - j * 1.4) / c.size * 0.45 + c.up * 0.5 + front * 0.15 - d * 0.2;
            const shade = light > 0.55 ? 5 : light > 0.25 ? 4 : light > -0.1 ? 3 : light > -0.45 ? 2 : 1;
            const ramp = G[shade]!;
            view.dot(col + i, row + j, d > 0.85 && shade > 2 ? G[shade - 1]! : ramp, light > 0.25 ? NORMAL.top : NORMAL.face);
        }
    }
    view.outline(0.3);
    return view.art();
}

/** A park bench: oak slats on cast-iron ends, a slatted backrest along its back. */
export function bench(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { headroom: 1 });
    const O = PAL.oak, iron = PAL.steel, seat = 5;
    const end = (x: number): [Part, Faces][] => [
        [part(x, 2, 0, 1, s.d - 2, seat), { sides: iron[0], top: iron[1], front: iron[1] }],
        [part(x, 0, 0, 1, 2, s.h), { sides: iron[0], top: iron[2], front: iron[1] }]
    ];
    t.draw(view, [
        ...end(1), ...end(s.w - 2),
        [part(0, 2, seat, s.w, s.d - 2, 1), { top: rows(v => (v % 2 ? O[2] : O[4])), front: O[1], sides: O[1] }],
        [part(0, 0, seat + 2, s.w, 1, s.h - seat - 2), { front: rows(v => (v % 2 ? O[1] : O[3])), back: O[1], top: O[4], sides: O[1] }]
    ]);
    view.outline(0.3);
    return view.art();
}

/**
 * A hard rifle case lying open on the floor: its lid flat behind it, egg-crate foam in both halves, the rifle in its
 * cut-out (stock, receiver with the scope on top, the long barrel, a folded bipod), a box of rounds beside it.
 */
export function rifleCase(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { headroom: 2 });
    const K = PAL.ink, foam = PAL.concrete, S = PAL.steel, lid = 5;
    const crate = (u: number, v: number) => ((u + v) % 2 ? foam[1] : foam[0]);
    const rifle = (u: number, v: number): number | null => {
        if (v === 2 && u >= 2 && u <= 4) return PAL.walnut[2];
        if (v === 3 && u >= 1 && u <= 5) return PAL.walnut[1];
        if (v === 2 && u >= 5 && u <= 8) return S[1];
        if (v === 1 && u >= 6 && u <= 8) return S[3];
        if (v === 2 && u >= 9 && u <= s.w - 2) return S[2];
        if (v === 3 && u === 10) return S[1];
        return null;
    };
    t.draw(view, [
        [part(0, 0, 0, s.w, lid, 1), { top: (u, v) => (u === 0 || u === s.w - 1 || v === 0 ? K : crate(u, v)), sides: K, front: K }],
        [part(0, lid, 0, s.w, s.d - lid, s.h), {
            top: (u, v) => (u === 0 || u === s.w - 1 || v === 0 || v === s.d - lid - 1 ? mix(K, S[1], 0.4) : rifle(u, v) ?? crate(u, v)),
            front: (u, v) => (u === 3 || u === s.w - 4 ? S[2] : v === 0 ? mix(K, S[1], 0.3) : K), sides: K
        }],
        [part(s.w - 4, 1, 1, 3, 2, 1), { top: PAL.brass[3], sides: PAL.brass[1] }]
    ]);
    return view.art();
}
