import { TILE } from '../../level/level';
import type { LobbyProp } from '../../level/lobby';
import { px, type Size } from '../../level/space';
import { PAL, deepen, mix, step, type Ramp } from '../palette';
import { PixelBitmap } from '../PixelBitmap';
import { mulberry32 } from '../random';

/** A light a prop gives off, in pixels relative to the prop bitmap's top-left corner. */
export interface PropLight { x: number; y: number; radius: number; color: number; intensity: number }

/**
 * A prop's art for its box (see `space.ts`). `lit` responds to scene lights; `glow` is drawn on top unlit (screens,
 * bulbs, signs). `originX` is the bitmap column of the footprint's west edge, for art that spreads wider than its
 * footprint; the bitmap's bottom edge is always the box's front edge at the box's own floor level.
 */
export interface PropArt {
    lit: PixelBitmap;
    glow?: PixelBitmap;
    lights?: PropLight[];
    originX?: number;
}

/**
 * Drawing surface for one box. Points are given as (x across from the west edge, gy back-to-front from the north edge,
 * z up from the box's floor); `row(gy, z)` is where such a point lands. `headroom` adds rows above the box for parts that
 * rise higher than it (teller glass, a lamp), `margin` adds columns either side for parts that spread wider (leaves).
 */
class BoxArt {
    readonly lit: PixelBitmap;
    readonly glow: PixelBitmap;
    readonly lights: PropLight[] = [];

    constructor(readonly s: Size, readonly headroom = 0, readonly margin = 0) {
        this.lit = new PixelBitmap(s.w + margin * 2, headroom + s.h + s.d);
        this.glow = new PixelBitmap(this.lit.width, this.lit.height);
    }

    row(gy: number, z: number): number {
        return this.headroom + this.s.h + gy - z;
    }

    col(x: number): number {
        return this.margin + x;
    }

    /** Paints the box's top surface and its front face with the given colour functions (x, and depth or height). */
    block(top: (x: number, gy: number) => number, front: (x: number, z: number) => number, heights = { top: 1, front: 0.7 }): void {
        const { w, d, h } = this.s;
        for (let gy = 0; gy < d; gy++) for (let x = 0; x < w; x++) this.lit.set(this.col(x), this.row(gy, h), top(x, gy), heights.top);
        for (let z = h; z > 0; z--) for (let x = 0; x < w; x++) this.lit.set(this.col(x), this.row(d, z), front(x, z), heights.front);
    }

    art(): PropArt {
        return { lit: this.lit, glow: this.glow, lights: this.lights, originX: this.margin };
    }
}

/** Raised walnut panels on a front face, a brass kick rail along the floor. */
function walnutPanel(x: number, z: number, w: number, h: number): number {
    const px = x % TILE;
    if (z <= 2) return z === 2 ? PAL.brass[3] : PAL.brass[1];
    if (z === h) return PAL.walnut[1];
    const inX = px > 2 && px < 13 && w - x > 2, inZ = z > 4 && z < h - 1;
    if (inX && inZ) return z === h - 2 ? PAL.walnut[4] : PAL.walnut[3];
    if ((px === 2 || px === 13) && z >= 4 && z <= h - 1) return PAL.walnut[1];
    if ((z === 4 || z === h - 1) && px >= 2 && px <= 13) return PAL.walnut[1];
    return PAL.walnut[2];
}

/**
 * The teller counter, one sprite across the room: a walnut front 1.2m tall, the top the full depth of its row (a
 * walnut work shelf on the teller side, green marble on the customer side). Teller glass rises 1.4m above the front
 * edge of the top; a teller standing in the middle of the row behind shows from the waist up.
 */
function counter(p: Extract<LobbyProp, { kind: 'counter' }>, s: Size): PropArt {
    const glassHeight = 28;
    const a = new BoxArt(s, glassHeight);
    const shelf = 6;
    a.block((x, gy) => {
        if (gy < shelf) return gy === 0 || gy === shelf - 1 ? PAL.walnut[1] : PAL.walnut[3];
        if (gy === s.d - 1) return PAL.brass[3];
        if ((x * 7 + gy * 3) % 23 === 0) return PAL.marbleGreen[4];
        return gy === shelf ? PAL.marbleGreen[4] : gy < shelf + 3 ? PAL.marbleGreen[2] : PAL.marbleGreen[3];
    }, (x, z) => walnutPanel(x, z, s.w, s.h), { top: 0.95, front: 0.65 });
    const b = a.lit, glow = a.glow;
    const gx = (p.gate - p.tx) * TILE;
    // The gate: a hinged section with a seam either side.
    for (let y = a.row(0, s.h); y < a.row(s.d, 2); y++) { b.set(gx, y, PAL.ink, 0.3); b.set(gx + TILE - 1, y, PAL.ink, 0.3); }
    b.rect(gx + 6, a.row(s.d, 8), 4, 1, PAL.brass[4], 0.8);

    const surface = (gy: number) => a.row(gy, s.h);
    for (const st of p.stations) {
        const sx = (st - p.tx) * TILE;
        const closed = p.closed.includes(st);
        // Teller monitor on the work shelf, seen from behind at the east end of the window; it lights the teller.
        b.rect(sx + 12, surface(3) - 4, 4, 5, PAL.steel[1], 0.95);
        b.hline(sx + 12, surface(3) - 4, 4, PAL.steel[3], 0.97);
        if (!closed) a.lights.push({ x: sx + 11, y: surface(3) - 6, radius: 22, color: 0x7fd8e8, intensity: 0.8 });
        // Teller glass along the front edge of the top: brass posts and rail, the pane a faint tint with two streaks.
        const base = surface(s.d - 1), glassTop = base - glassHeight;
        for (let y = glassTop; y < base; y++) for (let x = sx - 2; x < sx + TILE + 2; x++) {
            if (x === sx - 2 || x === sx + TILE + 1) { b.set(x, y, x === sx - 2 ? PAL.brass[4] : PAL.brass[2], 0.95); continue; }
            if (y === glassTop) { b.set(x, y, PAL.brass[4], 0.95); continue; }
            if (y === glassTop + 1) { b.set(x, y, PAL.brass[1], 0.9); continue; }
            const k = (x - sx + (y - glassTop)) % 17;
            if (k === 0 || k === 3) b.set(x, y, PAL.glass[5], 0.9, 90);
            else if (!b.opaque(x, y)) b.set(x, y, PAL.glass[4], 0.9, 22);
        }
        // The pass-through tray in the counter top.
        b.rect(sx + 4, surface(s.d - 4), 8, 3, PAL.ink, 0.5);
        b.hline(sx + 4, surface(s.d - 5), 8, PAL.brass[3], 0.95);
        if (closed) {
            b.rect(sx + 3, glassTop + 12, 10, 6, PAL.paper[3], 0.95);
            b.rect(sx + 4, glassTop + 14, 8, 2, PAL.cloth.burgundy[3]!, 0.95);
            b.hline(sx + 3, glassTop + 18, 10, PAL.paper[1], 0.95);
            b.vline(sx + 5, glassTop + 2, 10, PAL.steel[3], 0.95);
            b.vline(sx + 10, glassTop + 2, 10, PAL.steel[3], 0.95);
        } else {
            // Banker's lamp at the front of the top: brass stem, green glass shade that glows.
            const lx = sx + 2, ly = surface(s.d - 3);
            b.rect(lx + 1, ly - 3, 1, 3, PAL.brass[3], 0.9);
            b.rect(lx - 1, ly - 5, 5, 2, PAL.leaf[3], 0.95);
            glow.rect(lx - 1, ly - 5, 5, 1, PAL.leaf[5], 1);
            glow.set(lx, ly - 4, PAL.emissive.lampWarm[1], 1);
            glow.set(lx + 1, ly - 4, PAL.emissive.lampWarm[0], 1);
            a.lights.push({ x: lx + 1, y: ly - 3, radius: 64, color: 0xffcf8a, intensity: 1.5 });
            // Deposit slips and a pen on a chain.
            b.rect(sx + 12, surface(s.d - 4), 3, 2, PAL.paper[2], 0.96);
            b.set(sx + 13, surface(s.d - 5), PAL.ink, 0.97);
        }
    }
    return a.art();
}

function backCounter(p: Extract<LobbyProp, { kind: 'backCounter' }>, s: Size): PropArt {
    const a = new BoxArt(s);
    const rand = mulberry32(p.tx * 31 + 7);
    a.block((_x, gy) => gy === s.d - 1 ? PAL.walnut[5] : gy === 0 ? PAL.walnut[2] : PAL.walnut[4],
        (x, z) => (x % (TILE / 2) === 0 || z === s.h || z === 1) ? PAL.walnut[1] : (z === s.h - 3 && x % (TILE / 2) === 3) ? PAL.brass[4] : PAL.walnut[3],
        { top: 0.9, front: 0.6 });
    // Clutter on top: paper stacks, a cash tray, a phone.
    const top = a.row(0, s.h);
    for (let i = 0; i < s.w / TILE; i++) {
        const x = i * TILE + 2 + Math.floor(rand() * 6);
        const pick = rand();
        if (pick < 0.4) { a.lit.rect(x, top + 1, 5, 3, PAL.paper[2], 0.95); a.lit.hline(x, top + 1, 5, PAL.paper[3], 0.97); }
        else if (pick < 0.7) { a.lit.rect(x, top + 1, 7, 3, PAL.steel[2], 0.95); a.lit.rect(x + 1, top + 2, 5, 1, PAL.cloth.olive[2]!, 0.96); }
        else { a.lit.rect(x, top + 2, 4, 2, PAL.ink, 0.95); a.lit.set(x + 1, top + 1, PAL.cloth.black[3]!, 0.97); }
    }
    return a.art();
}

function filingCabinet(s: Size): PropArt {
    const a = new BoxArt(s);
    // Three drawers, each with a handle and a label card.
    const drawer = Math.floor(s.h / 3);
    a.block((_x, gy) => gy === s.d - 1 ? PAL.steel[5] : PAL.steel[4], (x, z) => {
        if (z % drawer === 0 && z < s.h) return PAL.steel[1];
        const inDrawer = (s.h - z) % drawer;
        if (inDrawer === 2 && x >= 4 && x < s.w - 4) return PAL.steel[5];
        if (inDrawer === 1 && x >= 5 && x < s.w - 5) return PAL.paper[3];
        return step(PAL.steel, x < 2 ? 4 : x > s.w - 3 ? 2 : 3);
    }, { top: 1, front: 0.7 });
    a.lit.rect(2, a.row(1, s.h), 5, 3, PAL.paper[2], 1);
    return a.art();
}

function printer(s: Size): PropArt {
    // A copier on a low stand: the machine is the top 0.5m of the box, the stand below it.
    const a = new BoxArt(s);
    const machine = 6;
    a.block((_x, gy) => gy < 2 ? PAL.paper[3] : PAL.paper[2], (x, z) => {
        if (z > s.h - machine) return z === s.h - 2 && x > 1 && x < s.w - 2 ? PAL.ink : PAL.paper[1];
        return z === s.h - machine ? PAL.walnut[5] : PAL.walnut[3];
    }, { top: 1, front: 0.75 });
    a.lit.set(s.w - 2, a.row(s.d, s.h - 1), PAL.emissive.ledGreen, 1);
    return a.art();
}

function waterCooler(s: Size): PropArt {
    // White body to 0.85m, the blue bottle above it.
    const a = new BoxArt(s);
    const body = coolerBody(s);
    a.block((_x, gy) => gy === s.d - 1 ? PAL.glass[4] : PAL.glass[3], (x, z) => {
        if (z > body) return x < 2 ? PAL.glass[4] : z === body + 2 ? PAL.glass[2] : PAL.glass[3];
        if (z === body) return PAL.paper[3];
        if (z === body - 3 && (x === 1 || x === 3)) return x === 1 ? PAL.cloth.denim[3]! : PAL.cloth.burgundy[3]!;
        return x === s.w - 1 ? PAL.paper[1] : PAL.paper[2];
    }, { top: 0.95, front: 0.7 });
    return a.art();
}

/** The cooler's white body is about two thirds of its height, the bottle the rest. */
const coolerBody = (s: Size) => Math.round(s.h * 0.65);

function crest(s: Size): PropArt {
    // A brass roundel with a columned bank front, flanked by two brass bars.
    const a = new BoxArt(s);
    const b = a.lit, cx = s.w / 2, cy = a.row(1, s.h / 2);
    b.ellipse(cx, cy, 6.5, 5, PAL.brass[1], 0.6);
    b.ellipse(cx, cy, 5.5, 4, PAL.brass[3], 0.8);
    b.rect(Math.round(cx) - 3, Math.round(cy) - 3, 7, 1, PAL.brass[5], 0.9);
    for (const dx of [-3, -1, 1, 3]) b.rect(Math.round(cx) + dx, Math.round(cy) - 2, 1, 4, PAL.brass[4], 0.9);
    b.rect(Math.round(cx) - 4, Math.round(cy) + 2, 9, 1, PAL.brass[4], 0.9);
    b.rect(0, Math.round(cy), 5, 1, PAL.brass[3], 0.7);
    b.rect(s.w - 5, Math.round(cy), 5, 1, PAL.brass[3], 0.7);
    return a.art();
}

function clock(s: Size): PropArt {
    const a = new BoxArt(s);
    const b = a.lit, c = (s.w - 1) / 2, cy = a.row(1, s.h / 2);
    b.ellipse(c + 0.5, cy, s.w / 2, s.h / 2, PAL.brass[2], 0.8);
    b.ellipse(c + 0.5, cy, s.w / 2 - 1, s.h / 2 - 1, PAL.paper[3], 0.75);
    b.vline(Math.round(c), Math.round(cy) - 3, 3, PAL.ink, 0.8);
    b.hline(Math.round(c), Math.round(cy), 3, PAL.ink, 0.8);
    b.set(Math.round(c), Math.round(cy), PAL.cloth.burgundy[3]!, 0.85);
    return a.art();
}

function painting(s: Size): PropArt {
    const a = new BoxArt(s);
    const b = a.lit, top = a.row(1, s.h);
    b.rect(0, top, s.w, s.h, PAL.brass[2], 0.75);
    b.rect(1, top + 1, s.w - 2, s.h - 2, PAL.emissive.sky[0], 0.6);
    b.rect(1, top + 4, s.w - 2, s.h - 5, PAL.leaf[3], 0.62);
    b.rect(1, top + s.h - 2, s.w - 2, 1, PAL.leaf[2], 0.62);
    b.rect(7, top + 2, 3, 2, PAL.limestone[4], 0.62);
    b.hline(0, top, s.w, PAL.brass[4], 0.8);
    return a.art();
}

function noticeBoard(s: Size): PropArt {
    const a = new BoxArt(s);
    const b = a.lit, top = a.row(1, s.h);
    b.rect(0, top, s.w, s.h, PAL.terracotta[3], 0.65);
    b.hline(0, top, s.w, PAL.walnut[4], 0.8);
    b.rect(1, top + 1, 4, 5, PAL.paper[3], 0.7);
    b.rect(6, top + 2, 4, 3, PAL.paper[2], 0.7);
    b.rect(8, top + 5, 3, 2, PAL.emissive.sky[1], 0.7);
    b.set(3, top + 1, PAL.cloth.burgundy[3]!, 0.8);
    return a.art();
}

function exitSign(s: Size): PropArt {
    const a = new BoxArt(s);
    const top = a.row(1, s.h);
    a.lit.rect(0, top, s.w, s.h, PAL.steel[1], 0.8);
    a.glow.rect(1, top + 1, s.w - 2, s.h - 2, PAL.emissive.exitGreen[1], 1);
    a.glow.rect(2, top + 1, 2, 1, PAL.emissive.exitGreen[2], 1);
    a.glow.rect(5, top + 2, 3, 1, PAL.emissive.exitGreen[2], 1);
    a.lights.push({ x: s.w / 2, y: top + s.h, radius: 34, color: 0x52e08a, intensity: 0.6 });
    return a.art();
}

function keycardLed(s: Size): PropArt {
    const a = new BoxArt(s);
    const y = a.row(1, s.h);
    a.glow.set(0, y, PAL.emissive.ledRed, 1);
    a.lights.push({ x: 0, y, radius: 14, color: 0xff4a3a, intensity: 0.8 });
    return a.art();
}

function atmScreen(s: Size): PropArt {
    const a = new BoxArt(s);
    const top = a.row(1, s.h);
    a.glow.rect(0, top, s.w, s.h, PAL.emissive.screen[1], 1);
    a.glow.rect(1, top + 1, 5, 1, PAL.emissive.screen[2], 1);
    a.glow.rect(1, top + 3, 3, 1, PAL.emissive.screen[0], 1);
    a.lights.push({ x: s.w / 2, y: top + s.h + 2, radius: 30, color: 0x7fd8e8, intensity: 0.8 });
    return a.art();
}

function camera(s: Size): PropArt {
    // A box camera on a bracket from the east wall, its lens looking west and down into the lobby.
    const a = new BoxArt(s);
    a.block((x, gy) => (gy === 0 ? PAL.paper[2] : x === s.w - 1 ? PAL.steel[2] : PAL.paper[3]), (x, z) => (x < 2 ? (z === 2 ? PAL.glass[3] : PAL.ink) : z === 1 ? PAL.paper[0] : PAL.paper[2]));
    a.glow.set(s.w - 3, a.row(s.d, s.h), PAL.emissive.ledRed, 1);
    return a.art();
}

function queueRail(p: Extract<LobbyProp, { kind: 'queueRail' }>, s: Size): PropArt {
    // Posts on the footprint's centre line, one in the middle of each tile, a velvet rope sagging between them.
    const a = new BoxArt(s);
    const b = a.lit, cx = Math.floor(s.w / 2);
    for (let i = 0; i < p.length; i++) {
        const gy = Math.floor(s.w / 2) + i * TILE;
        b.rect(cx - 2, a.row(gy, 0), 4, 1, PAL.brass[1], 0.4);
        b.rect(cx - 1, a.row(gy, 1), 3, 1, PAL.brass[3], 0.5);
        for (let z = 2; z < s.h - 1; z++) { b.set(cx - 1, a.row(gy, z), PAL.brass[4], 0.95); b.set(cx, a.row(gy, z), PAL.brass[2], 0.9); }
        b.rect(cx - 1, a.row(gy, s.h), 2, 2, PAL.brass[5], 1);
        if (i === p.length - 1) continue;
        // The rope leaves each post just below its finial and dips 2px (in height) midway to the next.
        for (let t = 0; t <= TILE; t++) {
            const sag = Math.round(Math.sin((t / TILE) * Math.PI) * 2);
            b.set(cx - 2, a.row(gy + t, s.h - 2 - sag), t > 2 && t < TILE - 2 ? PAL.carpet[3] : PAL.carpet[2], 0.85);
        }
    }
    return a.art();
}

function mat(s: Size): PropArt {
    const a = new BoxArt(s);
    for (let gy = 0; gy < s.d; gy++) for (let x = 0; x < s.w; x++) {
        const border = gy === 0 || gy === s.d - 1 || x === 0 || x === s.w - 1;
        a.lit.set(x, a.row(gy, 0), border ? PAL.brass[1] : ((x + gy) % 2 ? PAL.asphalt[2] : PAL.asphalt[3]), 0.35);
    }
    return a.art();
}

function writingDesk(s: Size): PropArt {
    // A standing island: green marble top on a walnut plinth, slips and chained pens, a banker's lamp in the middle.
    const lampHeight = 6;
    const a = new BoxArt(s, lampHeight);
    a.block((_x, gy) => gy === 0 ? PAL.marbleGreen[1] : gy === s.d - 1 ? PAL.marbleGreen[4] : PAL.marbleGreen[3], (x, z) => walnutPanel(x, z, s.w, s.h), { top: 0.95, front: 0.6 });
    const b = a.lit, top = a.row(0, s.h);
    b.rect(2, top + 2, 4, 2, PAL.paper[3], 1);
    b.rect(7, top + 3, 3, 2, PAL.paper[2], 1);
    b.rect(s.w - 7, top + 2, 4, 2, PAL.paper[3], 1);
    b.set(11, top + 4, PAL.ink, 1);
    const lx = Math.floor(s.w / 2), ly = a.row(3, s.h);
    b.rect(lx, ly - lampHeight + 1, 1, lampHeight - 1, PAL.brass[3], 1);
    b.rect(lx - 2, ly - lampHeight, 5, 2, PAL.leaf[3], 1);
    a.glow.rect(lx - 2, ly - lampHeight + 1, 5, 1, PAL.leaf[5], 1);
    a.lights.push({ x: lx, y: ly - lampHeight + 2, radius: 48, color: 0xffcf8a, intensity: 1.4 });
    return a.art();
}

function sofa(s: Size): PropArt {
    // Oxblood leather Chesterfield: a 0.25m deep tufted back to the full height, the seat at 0.45m, rolled arms at 0.6m,
    // short walnut feet with a gap under the seat.
    const a = new BoxArt(s);
    const b = a.lit, leather = PAL.cloth.burgundy, shine = mix(leather[3]!, 0xffffff, 0.18);
    const back = 3, seat = 6, arm = 8, armW = 4, feet = 1;
    for (let gy = 0; gy < back; gy++) for (let x = armW; x < s.w - armW; x++) b.set(x, a.row(gy, s.h), gy === back - 1 ? shine : leather[3]!, 0.95);
    for (let z = s.h - 1; z > seat; z--) for (let x = armW; x < s.w - armW; x++) {
        const tuft = (x + (z % 4 === 0 ? 2 : 0)) % 4 === 1 && z % 2 === 0;
        b.set(x, a.row(back, z), tuft ? leather[0]! : leather[2]!, 0.85);
    }
    // Two seat cushions, their front edges catching the light.
    for (let gy = back; gy < s.d; gy++) for (let x = armW; x < s.w - armW; x++) {
        const split = x === Math.floor(s.w / 2);
        b.set(x, a.row(gy, seat), split ? leather[1]! : gy === s.d - 1 ? shine : leather[3]!, 0.75);
    }
    for (let z = seat; z > feet; z--) for (let x = armW; x < s.w - armW; x++) b.set(x, a.row(s.d, z), z === seat ? leather[2]! : leather[1]!, 0.6);
    for (const ax of [0, s.w - armW]) {
        for (let gy = 0; gy < s.d; gy++) for (let x = ax; x < ax + armW; x++) b.set(x, a.row(gy, arm), x === ax + 1 || x === ax + 2 ? shine : leather[3]!, 0.9);
        for (let z = arm; z > feet; z--) for (let x = ax; x < ax + armW; x++) b.set(x, a.row(s.d, z), z === arm ? leather[3]! : leather[2]!, 0.8);
        // Rolled arm: round off its outer top corners.
        const outer = ax === 0 ? ax : ax + armW - 1;
        b.clear(outer, a.row(0, arm));
        b.clear(outer, a.row(s.d, arm));
        b.set(ax === 0 ? ax + 1 : ax + armW - 2, a.row(s.d, feet), PAL.walnut[1], 0.3);
    }
    return a.art();
}

function coffeeTable(s: Size): PropArt {
    // A 4px walnut top on four legs; magazines, papers and a cup on top.
    const a = new BoxArt(s);
    const b = a.lit;
    for (let gy = 0; gy < s.d; gy++) for (let x = 0; x < s.w; x++) b.set(x, a.row(gy, s.h), gy === s.d - 1 ? PAL.walnut[5] : PAL.walnut[4], 0.8);
    for (let x = 0; x < s.w; x++) b.set(x, a.row(s.d, s.h), PAL.walnut[2], 0.75);
    for (let z = s.h - 1; z > 0; z--) for (const x of [1, s.w - 2]) b.set(x, a.row(s.d, z), PAL.walnut[1], 0.5);
    const top = a.row(0, s.h);
    b.rect(1, top + 2, 5, 3, PAL.cloth.denim[3]!, 0.85);
    b.rect(2, top + 3, 3, 1, PAL.paper[3], 0.86);
    b.rect(7, top + 1, 4, 3, PAL.paper[2], 0.85);
    b.set(12, top + 3, PAL.paper[3], 0.9);
    return a.art();
}

function plant(s: Size, seed: number): PropArt {
    // A brass planter 0.5m tall filling the footprint; a rubber plant above it whose leaves spread 4px past either side.
    const spread = 4;
    const a = new BoxArt(s, 0, spread);
    const b = a.lit, rand = mulberry32(seed), pot = 6;
    for (let gy = 0; gy < s.d; gy++) for (let x = 0; x < s.w; x++) b.set(a.col(x), a.row(gy, pot), gy < 2 ? PAL.terracotta[0] : PAL.brass[5], 0.8);
    for (let z = pot; z > 0; z--) for (let x = 0; x < s.w; x++) b.set(a.col(x), a.row(s.d, z), x < 2 ? PAL.brass[4] : x > s.w - 2 ? PAL.brass[1] : PAL.brass[3], 0.8);
    // Leaves on the stem above the planter's centre, lighter towards the top.
    const cx = a.col(s.w / 2), stemBase = a.row(s.d / 2, pot);
    b.vline(Math.floor(cx), a.row(s.d / 2, s.h - 2), stemBase - a.row(s.d / 2, s.h - 2), PAL.leaf[1], 0.8);
    const leaves: [number, number][] = [];
    for (let i = 0; i < 12; i++) leaves.push([cx - spread - 1 + rand() * (s.w + spread * 2 - 2), a.row(s.d / 2, pot + 2 + rand() * (s.h - pot - 3))]);
    leaves.sort((p, q) => p[1] - q[1]);
    const topRow = a.row(s.d / 2, s.h);
    for (const [lx, ly] of leaves) {
        const tone = ly - topRow < 5 ? 4 : ly - topRow < 10 ? 3 : 2;
        b.ellipse(lx, ly, 2.4, 1.5, step(PAL.leaf, tone), 1);
        b.plot(Math.round(lx - 1), Math.round(ly - 1), step(PAL.leaf, tone + 1), 1);
    }
    return a.art();
}

function brochureRack(s: Size): PropArt {
    // Three shelves of leaflets on its front face.
    const a = new BoxArt(s);
    a.block(() => PAL.walnut[4], () => PAL.walnut[2], { top: 0.8, front: 0.6 });
    const colors = [PAL.cloth.denim[3]!, PAL.paper[3], PAL.cloth.burgundy[3]!, PAL.cloth.teal[3]!, PAL.cloth.mustard[3]!, PAL.paper[2]];
    for (let shelf = 0; shelf < 3; shelf++) for (let col = 0; col < 2; col++) {
        const y = a.row(s.d, s.h - 1 - shelf * 6), x = 1 + col * 5, c = colors[shelf * 2 + col]!;
        a.lit.rect(x, y, 3, 4, c, 0.75);
        a.lit.hline(x, y, 3, mix(c, 0xffffff, 0.3), 0.77);
        a.lit.hline(x - 1, y + 4, 5, PAL.walnut[1], 0.7);
    }
    return a.art();
}

function bin(s: Size): PropArt {
    const a = new BoxArt(s);
    a.block((_x, gy) => (gy === 0 || gy === s.d - 1 ? PAL.brass[5] : PAL.ink), (x, z) => (z === s.h ? PAL.brass[5] : x === 0 ? PAL.brass[4] : x === s.w - 1 ? PAL.brass[1] : PAL.brass[3]), { top: 0.6, front: 0.8 });
    return a.art();
}

function streetLamp(s: Size): PropArt {
    // A cast-iron post with a lantern head 0.6m across at the top, unlit by day.
    const spread = 2;
    const a = new BoxArt(s, 0, spread);
    const b = a.lit, iron = PAL.steel, cx = a.col(1), mid = Math.floor(s.d / 2);
    b.rect(a.col(0), a.row(mid, 2), s.w, 3, iron[1], 0.5);
    for (let z = 2; z < s.h - 6; z++) { b.set(cx, a.row(mid, z), iron[3], 0.95); b.set(cx + 1, a.row(mid, z), iron[2], 0.9); }
    const head = a.row(mid, s.h);
    b.rect(a.col(-2), head + 1, 8, 2, iron[1], 1);
    b.rect(a.col(-1), head + 3, 6, 5, PAL.glass[3], 1);
    b.rect(a.col(-1), head + 3, 2, 5, PAL.glass[4], 1);
    b.rect(a.col(-1), head + 8, 6, 1, iron[1], 1);
    b.rect(a.col(0), head, 4, 1, iron[2], 1);
    return a.art();
}

function hydrant(s: Size): PropArt {
    // A red barrel with a domed cap and two side nozzles reaching 1px past the footprint.
    const a = new BoxArt(s, 0, 1);
    const red = PAL.carpet;
    a.block((_x, gy) => (gy === 0 ? red[3] : red[4]), (x, z) => (z === 1 ? red[1] : x === 0 ? red[4] : x === s.w - 1 ? red[1] : red[3]), { top: 0.9, front: 0.75 });
    const y = a.row(s.d, s.h - 3);
    a.lit.set(a.col(-1), y, red[2], 0.7);
    a.lit.set(a.col(s.w), y, red[1], 0.7);
    return a.art();
}

function newsBox(s: Size): PropArt {
    // A vending box on short legs, the day's front page behind its window.
    const a = new BoxArt(s);
    const body = PAL.cloth.teal, legs = 3;
    a.block((_x, gy) => (gy === s.d - 1 ? body[3]! : body[2]!), (x, z) => {
        if (z <= legs) return PAL.steel[1];
        if (z > s.h - 7 && z < s.h - 1 && x > 0 && x < s.w - 1) return z === s.h - 2 ? PAL.ink : PAL.paper[2];
        return body[2]!;
    }, { top: 0.9, front: 0.75 });
    // Clear the gap between the legs.
    for (let z = legs; z > 0; z--) for (let x = 1; x < s.w - 1; x++) a.lit.clear(x, a.row(s.d, z));
    return a.art();
}

function streetBin(s: Size): PropArt {
    const a = new BoxArt(s);
    const body = PAL.leaf;
    a.block((_x, gy) => (gy === 0 || gy === s.d - 1 ? body[3] : PAL.ink), (x, z) => (z === s.h ? body[3] : x % 3 === 0 ? body[1] : body[2]), { top: 0.9, front: 0.75 });
    return a.art();
}

function bollard(s: Size): PropArt {
    const a = new BoxArt(s);
    a.block(() => PAL.steel[4], (x, z) => (z === s.h - 2 ? PAL.brass[3] : x === 0 ? PAL.steel[4] : PAL.steel[2]), { top: 1, front: 0.8 });
    return a.art();
}

function manhole(s: Size): PropArt {
    const a = new BoxArt(s);
    const r = s.w / 2, cy = a.row(s.d / 2, 0);
    a.lit.ellipse(r, cy, r, s.d / 2, PAL.steel[0], 0.3);
    a.lit.ellipse(r, cy, r - 1, s.d / 2 - 1, PAL.steel[1], 0.4);
    for (let x = 2; x < s.w - 2; x += 2) a.lit.vline(x, Math.round(cy) - 2, 4, PAL.steel[2], 0.45);
    return a.art();
}

function van(s: Size): PropArt {
    // The crew's panel van against the kerb, nose to the west. The cargo box is the full height; the cab at the front
    // is lower (1.9m) with a bonnet (1.1m) ahead of it. The near side faces the street, wheels at its foot.
    const a = new BoxArt(s);
    const b = a.lit, body: Ramp = PAL.concrete;
    const bonnet = 11, cab = 18, bonnetZ = px(1.1), cabZ = px(1.9);
    const heightAt = (x: number) => (x < bonnet ? bonnetZ : x < cab ? cabZ : s.h);
    for (let x = 0; x < s.w; x++) {
        const z = heightAt(x);
        for (let gy = 0; gy < s.d; gy++) {
            const windscreen = x >= bonnet && x < bonnet + 3;
            b.set(x, a.row(gy, z), windscreen ? PAL.glass[2] : gy === 0 ? body[3]! : gy === s.d - 1 ? body[4]! : body[5]!, 1);
        }
        for (let zz = z; zz > 0; zz--) {
            let c = step(body, zz > z - 2 ? 3 : zz < 6 ? 1 : 2);
            if (x === 0 || x === s.w - 1) c = body[1]!;
            b.set(x, a.row(s.d, zz), c, 0.75);
        }
    }
    // Roof: stiffening ribs across the cargo box and a gutter along its street edge.
    for (let x = cab + 4; x < s.w - 2; x += 6) for (let gy = 1; gy < s.d - 1; gy++) b.set(x, a.row(gy, s.h), body[3]!, 0.95);
    b.hline(cab, a.row(s.d - 2, s.h), s.w - cab, body[2]!, 0.9);
    // Cab side window, panel seams, the sliding door's handle and faded signwriting for a plumber that doesn't exist.
    b.rect(bonnet + 1, a.row(s.d, cabZ - 2), cab - bonnet - 2, 6, PAL.glass[1], 0.8);
    b.hline(bonnet + 1, a.row(s.d, cabZ - 2), cab - bonnet - 2, PAL.glass[3], 0.82);
    b.vline(cab + 1, a.row(s.d, s.h - 1), s.h - 3, body[1]!, 0.7);
    b.vline(48, a.row(s.d, s.h - 1), s.h - 3, body[1]!, 0.7);
    b.rect(44, a.row(s.d, 14), 3, 1, PAL.steel[1], 0.8);
    b.rect(24, a.row(s.d, 20), 18, 2, mix(body[2]!, PAL.cloth.navy[3]!, 0.6), 0.76);
    b.rect(24, a.row(s.d, 16), 12, 1, mix(body[2]!, PAL.cloth.navy[3]!, 0.4), 0.76);
    b.rect(0, a.row(s.d, 8), 2, 2, PAL.paper[3], 0.85);
    b.rect(s.w - 2, a.row(s.d, 10), 2, 3, PAL.carpet[3], 0.85);
    b.rect(0, a.row(s.d, 4), s.w, 2, PAL.steel[1], 0.6);
    // Wheels: 0.7m across, their hubs at axle height on the near side.
    for (const wx of [8, s.w - 12]) {
        const cy = a.row(s.d, 4);
        b.ellipse(wx, cy, 4.5, 4.5, PAL.ink, 0.5);
        b.ellipse(wx, cy, 2.2, 2.2, PAL.steel[3], 0.6);
        b.set(wx, cy, PAL.steel[1], 0.6);
    }
    b.each((x, y, c, ht) => (y > a.row(s.d, 8) && y < a.row(s.d, 3) && x > 0 && x < s.w - 1 ? [deepen(c, 0.12), ht] : undefined));
    return a.art();
}

/** Draws a prop for its catalog size; the scene places the result by its box. */
export function propArt(p: LobbyProp, s: Size): PropArt {
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
        case 'van': return van(s);
    }
}
