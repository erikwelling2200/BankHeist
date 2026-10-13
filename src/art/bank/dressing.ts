import type { Facing, Size } from '../../level/space';
import { PAL } from '../palette';
import { rows, Turn, View, type PropArt } from './view';

/*
 * Things hung on a wall: the crest, the clock, a painting, the notice board, the exit sign, the keycard reader's LED, the
 * ATM's screen and the CCTV camera. Each is drawn from its catalog box in its own frame, its back (y = 0) against the
 * wall.
 */

/** A pixel of a hung picture: its colour, and whether it glows (a lit sign) rather than takes the room's light. */
type Picture = (u: number, v: number) => { c: number; glow?: boolean } | null;

const inDisc = (u: number, v: number, cx: number, cy: number, rx: number, ry: number) => ((u + 0.5 - cx) / rx) ** 2 + ((v + 0.5 - cy) / ry) ** 2 <= 1;

/**
 * A thin piece hung flat on its wall. From the front it is its picture (u across, v down, null outside its outline, so a
 * round clock stays round), with its upper edge catching the light along the top; from behind, the same outline in its
 * plain backing; from the side, its edge: a one-pixel sliver receding along the wall.
 */
function hung(s: Size, facing: Facing, picture: Picture, back: number, edge: number): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const at = (u: number, v: number) => (u >= 0 && u < s.w && v >= 0 && v < s.h ? picture(u, v) : null);
    for (let u = 0; u < s.w; u++) for (let v = 0; v < s.h; v++) {
        const p = at(u, v);
        if (p === null) continue;
        const z = s.h - v, upper = at(u, v - 1) === null;
        if (facing === 'south') {
            if (p.glow) view.glowFace(u, z, p.c);
            else view.face(u, z, p.c);
            if (upper) view.top(u, 0, z, edge);
        } else if (facing === 'north') {
            view.face(s.w - 1 - u, z, back);
            if (upper) view.top(s.w - 1 - u, 0, z, edge);
        } else {
            const [x, y] = t.pixel(u, 0);
            view.face(x, z, upper ? edge : back, y + 1);
        }
    }
    return view.art();
}

export function crest(s: Size, facing: Facing): PropArt {
    // A brass roundel with a columned bank front in relief, flanked by two brass bars.
    const cx = s.w / 2, cy = s.h / 2;
    return hung(s, facing, (u, v) => {
        if (inDisc(u, v, cx, cy, 5.5, 4.2)) {
            const du = Math.round(u - cx + 0.5);
            if (v === Math.round(cy) - 3) return { c: PAL.brass[5] };
            if (v === Math.round(cy) - 2) return { c: Math.abs(du) <= 3 ? PAL.brass[4] : PAL.brass[3] };
            if ([-3, -1, 1, 3].includes(du) && v >= cy - 1 && v < cy + 2) return { c: PAL.brass[4] };
            if (v === Math.round(cy) + 2 && Math.abs(du) <= 4) return { c: PAL.brass[4] };
            return { c: PAL.brass[2] };
        }
        if (inDisc(u, v, cx, cy, 6.5, 5)) return { c: v < cy ? PAL.brass[3] : PAL.brass[1] };
        const bar = Math.floor(cy);
        if ((v === bar || v === bar + 1) && (u < 5 || u >= s.w - 5) && u > 0 && u < s.w - 1) return { c: v === bar ? PAL.brass[4] : PAL.brass[1] };
        return null;
    }, PAL.brass[1], PAL.brass[4]);
}

export function clock(s: Size, facing: Facing): PropArt {
    // A station clock: brass rim, cream face with four ticks, black hands at ten past two, a red second hand.
    const c = s.w / 2, mid = Math.floor(c);
    return hung(s, facing, (u, v) => {
        if (!inDisc(u, v, c, c, c, c)) return null;
        if (!inDisc(u, v, c, c, c - 1, c - 1)) return { c: v < mid ? PAL.brass[4] : PAL.brass[2] };
        if ((u === mid && (v === 1 || v === s.h - 2)) || (v === mid && (u === 1 || u === s.w - 2))) return { c: PAL.steel[2] };
        if (u === mid && v === mid) return { c: PAL.ink };
        if (u === mid && v >= mid - 3 && v < mid) return { c: PAL.ink };
        if (v === mid - 1 && u === mid + 1) return { c: PAL.ink };
        if (v === mid && u > mid && u <= mid + 2) return { c: PAL.ink };
        if (v === mid + 1 && u === mid - 1) return { c: PAL.carpet[4] };
        if (v === mid + 2 && u === mid - 2) return { c: PAL.carpet[4] };
        return { c: v <= 1 ? PAL.paper[2] : PAL.paper[3] };
    }, PAL.brass[1], PAL.brass[4]);
}

export function painting(s: Size, facing: Facing): PropArt {
    // A gilt-framed landscape: pale sky, a limestone folly on a green hill, darker ground in front.
    return hung(s, facing, (u, v) => {
        if (u === 0 || v === 0 || u === s.w - 1 || v === s.h - 1) return { c: v === 0 ? PAL.brass[4] : u === 0 ? PAL.brass[3] : PAL.brass[1] };
        const hill = 4 + Math.round(Math.sin(u * 0.5) * 0.8);
        if (u >= 8 && u < 11 && v >= hill - 2 && v < hill + 1) return { c: v === hill - 2 ? PAL.limestone[3] : PAL.limestone[4] };
        if (v < hill) return { c: v === 1 ? PAL.emissive.sky[1] : PAL.emissive.sky[0] };
        return { c: v === hill ? PAL.leaf[4] : v === s.h - 2 ? PAL.leaf[1] : PAL.leaf[3] };
    }, PAL.walnut[1], PAL.brass[4]);
}

export function noticeBoard(s: Size, facing: Facing): PropArt {
    // Cork in a walnut frame, a few notices pinned to it.
    const notes = [
        { x: 1, y: 1, w: 4, h: 5, c: PAL.paper[3] }, { x: 6, y: 2, w: 4, h: 3, c: PAL.paper[2] },
        { x: 8, y: 5, w: 3, h: 2, c: PAL.emissive.sky[1] }, { x: 2, y: 4, w: 3, h: 1, c: PAL.paper[1] }
    ];
    const pins = [[3, 1, PAL.carpet[4]], [7, 2, PAL.cloth.denim[3]!], [9, 5, PAL.carpet[4]]] as const;
    return hung(s, facing, (u, v) => {
        if (u === 0 || v === 0 || u === s.w - 1 || v === s.h - 1) return { c: v === 0 ? PAL.walnut[4] : PAL.walnut[2] };
        for (const [x, y, c] of pins) if (u === x && v === y) return { c };
        for (let i = notes.length - 1; i >= 0; i--) {
            const n = notes[i]!;
            if (u >= n.x && u < n.x + n.w && v >= n.y && v < n.y + n.h) return { c: v === n.y + 1 && u > n.x && u < n.x + n.w - 1 && n.h > 2 ? PAL.paper[0] : n.c };
        }
        return { c: (u * 3 + v * 5) % 7 === 0 ? PAL.terracotta[2] : PAL.terracotta[3] };
    }, PAL.walnut[1], PAL.walnut[4]);
}

export function exitSign(s: Size, facing: Facing): PropArt {
    // A steel-framed box sign: a lit green panel, a pale running figure and an arrow.
    const figure = ['.#....#.', '#.#.####'];
    const art = hung(s, facing, (u, v) => {
        if (u === 0 || v === 0 || u === s.w - 1 || v === s.h - 1) return { c: v === s.h - 1 ? PAL.steel[1] : PAL.steel[2] };
        const mark = figure[v - 1]?.[u - 1] === '#';
        return { c: mark ? PAL.emissive.exitGreen[2] : PAL.emissive.exitGreen[1], glow: true };
    }, PAL.steel[1], PAL.steel[3]);
    if (facing === 'south') art.lights.push({ x: s.w / 2, y: art.lit.height, radius: 34, color: 0x52e08a, intensity: 0.6 });
    return art;
}

export function keycardLed(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    view.glowFace(0, 1, PAL.emissive.ledRed);
    view.light(0, t.d, 0, 14, 0xff4a3a, 0.8);
    return view.art();
}

export function atmScreen(s: Size, facing: Facing): PropArt {
    // The cash machine's screen, set into its fascia: a welcome line and a prompt.
    const art = hung(s, facing, (u, v) => {
        if (v === 1 && u >= 1 && u < 6) return { c: PAL.emissive.screen[2], glow: true };
        if (v === 3 && u >= 1 && u < 4) return { c: PAL.emissive.screen[0], glow: true };
        return { c: PAL.emissive.screen[1], glow: true };
    }, PAL.steel[1], PAL.steel[2]);
    if (facing === 'south') art.lights.push({ x: s.w / 2, y: art.lit.height + 2, radius: 30, color: 0x7fd8e8, intensity: 0.8 });
    return art;
}

/**
 * A box camera on a wall bracket, looking out of the wall (towards its front, +y): an arm from the wall, the housing
 * under a sunshield that overhangs it, the lens at the front, a red tally light on top.
 */
export function camera(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h, { headroom: 1 });
    const housing = PAL.paper, L = s.d;
    t.draw(view, [
        [{ x: 1, y: 0, z: 1, w: 2, d: 2, h: 1 }, { top: PAL.steel[3], sides: PAL.steel[1] }],
        [{ x: 0, y: 2, z: 0, w: s.w, d: L - 3, h: 3 }, { top: housing[3], front: housing[2], back: housing[1], sides: rows(v => (v === 2 ? housing[0] : housing[2])), corner: 1 }],
        [{ x: 1, y: L - 1, z: 0, w: 2, d: 1, h: 2 }, { top: PAL.steel[2], front: (u, v) => (u === 0 && v === 0 ? PAL.glass[3] : PAL.ink), sides: PAL.steel[1] }],
        [{ x: 0, y: 3, z: 3, w: s.w, d: L - 3, h: 1 }, { top: rows(v => (v === L - 4 ? housing[2] : housing[3])), sides: housing[1] }]
    ]);
    const [x, y] = t.pixel(s.w - 1, 3);
    view.glowTop(x, y, s.h, PAL.emissive.ledRed);
    view.outline(0.3);
    return view.art();
}
