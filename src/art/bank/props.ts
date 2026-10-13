import { TILE } from '../../level/level';
import type { LobbyProp } from '../../level/lobby';
import { PAL, deepen, mix, step, type Ramp } from '../palette';
import { PixelBitmap } from '../PixelBitmap';
import { mulberry32 } from '../random';

/** A light a prop gives off, in pixels relative to the prop bitmap's top-left corner. */
export interface PropLight { x: number; y: number; radius: number; color: number; intensity: number }

/**
 * A prop's art. `lit` responds to scene lights; `glow` is drawn on top unlit (screens, bulbs, signs). The bitmap's
 * bottom-left corner sits on the bottom-left of the prop's tile, shifted by `offsetX`. `shadow` is the footprint, in
 * the same coordinates, that darkens the floor beneath it.
 */
export interface PropArt {
    lit: PixelBitmap;
    glow?: PixelBitmap;
    offsetX?: number;
    shadow?: { x: number; y: number; w: number; h: number };
    lights?: PropLight[];
    /** Flat on the floor: drawn under people and furniture whatever its row. */
    flat?: boolean;
    /** Hung on the face of the wall in its tile (from the face's top edge), or sat on that wall's cap. */
    mount?: 'face' | 'cap';
    /**
     * Ground depth of the object's footprint, in pixels. Furniture that gives it is pushed back against any wall it
     * borders, so a cabinet stands flush to the wall behind it instead of at the front edge of its tile.
     */
    depth?: number;
}

const glowOf = (b: PixelBitmap) => new PixelBitmap(b.width, b.height);

/** Raised walnut panels on a front face, a brass kick rail along the floor. */
function walnutFront(b: PixelBitmap, x0: number, y0: number, w: number, h: number): void {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
        const px = (x - x0) % TILE;
        const panelEdge = px === 2 || px === 13 || y === y0 + 2 || y === y0 + h - 4;
        const inPanel = px > 2 && px < 13 && y > y0 + 2 && y < y0 + h - 4;
        let c: number = PAL.walnut[2];
        if (inPanel) c = y === y0 + 3 ? PAL.walnut[4] : PAL.walnut[3];
        if (panelEdge && px >= 2 && px <= 13 && y >= y0 + 2 && y <= y0 + h - 4) c = PAL.walnut[1];
        if (y >= y0 + h - 2) c = y === y0 + h - 2 ? PAL.brass[3] : PAL.brass[1];
        if (y === y0) c = PAL.walnut[1];
        b.set(x, y, c, inPanel ? 0.7 : 0.6);
    }
}

/**
 * The teller counter, one sprite across the room. It stands in its own row with a 15px walnut front (a half-height
 * object, well below the 24px walls) and a top the full depth of the tile: green marble on the customer side, a lower
 * walnut work shelf on the teller side. A teller standing in the middle of the row behind shows from the waist up.
 * Teller glass rises from the front edge of the top; monitors sit off to one side so the teller's face stays visible.
 */
function counter(p: Extract<LobbyProp, { kind: 'counter' }>): PropArt {
    const w = p.width * TILE, h = 56;
    const b = new PixelBitmap(w, h), glow = glowOf(b);
    const lights: PropLight[] = [];
    const base = h, frontTop = base - 15, back = frontTop - TILE, shelf = back + 6;
    for (let x = 0; x < w; x++) for (let y = back; y < frontTop; y++) {
        let c: number, ht = 0.95;
        if (y < shelf) { c = y === back ? PAL.walnut[1] : y === shelf - 1 ? PAL.walnut[1] : PAL.walnut[3]; ht = 0.85; }
        else {
            c = y === shelf ? PAL.marbleGreen[4] : y < shelf + 3 ? PAL.marbleGreen[2] : PAL.marbleGreen[3];
            if ((x * 7 + y * 3) % 23 === 0) c = PAL.marbleGreen[4];
        }
        if (y === frontTop - 1) { c = PAL.brass[3]; ht = 1; }
        b.set(x, y, c, ht);
    }
    walnutFront(b, 0, frontTop, w, 15);
    const gx = (p.gate - p.tx) * TILE;
    // The gate: a hinged section with a seam either side.
    for (let y = back; y < base - 2; y++) { b.set(gx, y, PAL.ink, 0.3); b.set(gx + TILE - 1, y, PAL.ink, 0.3); }
    b.rect(gx + 6, frontTop + 7, 4, 1, PAL.brass[4], 0.8);

    for (const st of p.stations) {
        const sx = (st - p.tx) * TILE;
        const closed = p.closed.includes(st);
        // Teller monitor on the work shelf, seen from behind at the far end of the window; its screen lights the teller.
        b.rect(sx + 12, shelf - 4, 4, 5, PAL.steel[1], 0.95);
        b.hline(sx + 12, shelf - 4, 4, PAL.steel[3], 0.97);
        if (!closed) lights.push({ x: sx + 11, y: shelf - 6, radius: 22, color: 0x7fd8e8, intensity: 0.8 });
        // Teller glass across the window: brass posts and top rail, the pane itself only a faint tint and two streaks.
        const glassTop = frontTop - 34;
        for (let y = glassTop; y < frontTop - 1; y++) for (let x = sx - 2; x < sx + TILE + 2; x++) {
            const post = x === sx - 2 || x === sx + TILE + 1;
            if (post) { b.set(x, y, x === sx - 2 ? PAL.brass[4] : PAL.brass[2], 0.95); continue; }
            if (y === glassTop) { b.set(x, y, PAL.brass[4], 0.95); continue; }
            if (y === glassTop + 1) { b.set(x, y, PAL.brass[1], 0.9); continue; }
            const k = (x - sx + (y - glassTop)) % 17;
            if (k === 0 || k === 3) b.set(x, y, PAL.glass[5], 0.9, 90);
            else if (!b.opaque(x, y)) b.set(x, y, PAL.glass[4], 0.9, 22);
        }
        // Speaking holes and the pass-through tray in the counter top.
        b.rect(sx + 4, frontTop - 4, 8, 3, PAL.ink, 0.5);
        b.hline(sx + 4, frontTop - 5, 8, PAL.brass[3], 0.95);
        if (closed) {
            b.rect(sx + 3, glassTop + 18, 10, 6, PAL.paper[3], 0.95);
            b.rect(sx + 4, glassTop + 20, 8, 2, PAL.cloth.burgundy[3]!, 0.95);
            b.hline(sx + 3, glassTop + 24, 10, PAL.paper[1], 0.95);
            b.vline(sx + 5, glassTop + 2, 16, PAL.steel[3], 0.95);
            b.vline(sx + 10, glassTop + 2, 16, PAL.steel[3], 0.95);
        } else {
            // Banker's lamp on the counter: brass stem, green glass shade that glows.
            const lx = sx + 2;
            b.rect(lx + 1, frontTop - 6, 1, 4, PAL.brass[3], 0.9);
            b.rect(lx - 1, frontTop - 8, 5, 2, PAL.leaf[3], 0.95);
            glow.rect(lx - 1, frontTop - 8, 5, 1, PAL.leaf[5], 1);
            glow.set(lx, frontTop - 7, PAL.emissive.lampWarm[1], 1);
            glow.set(lx + 1, frontTop - 7, PAL.emissive.lampWarm[0], 1);
            lights.push({ x: lx + 1, y: frontTop - 6, radius: 64, color: 0xffcf8a, intensity: 1.5 });
            // Deposit slips and a pen on a chain.
            b.rect(sx + 12, frontTop - 4, 3, 2, PAL.paper[2], 0.96);
            b.set(sx + 13, frontTop - 6, PAL.ink, 0.97);
        }
    }
    return { lit: b, glow, lights, shadow: { x: 0, y: base - 2, w, h: 6 } };
}

function backCounter(p: Extract<LobbyProp, { kind: 'backCounter' }>): PropArt {
    // A credenza about 0.9m tall and 0.6m deep: a 6px top over a 10px drawer front.
    const top = 6, front = 10, w = p.width * TILE, h = top + front;
    const b = new PixelBitmap(w, h);
    const rand = mulberry32(p.tx * 31 + 7);
    for (let x = 0; x < w; x++) for (let y = 0; y < top; y++) b.set(x, y, y === top - 1 ? PAL.walnut[5] : y === 0 ? PAL.walnut[2] : PAL.walnut[4], 0.9);
    for (let y = top; y < h; y++) for (let x = 0; x < w; x++) {
        const drawer = x % (TILE / 2) === 0 || y === top || y === h - 1;
        b.set(x, y, drawer ? PAL.walnut[1] : PAL.walnut[3], drawer ? 0.55 : 0.65);
    }
    for (let x = 3; x < w; x += TILE / 2) b.rect(x, top + 3, 2, 1, PAL.brass[4], 0.75);
    // Clutter on top: paper stacks, a cash tray, a phone.
    for (let i = 0; i < p.width; i++) {
        const x = i * TILE + 2 + Math.floor(rand() * 6);
        const pick = rand();
        if (pick < 0.4) { b.rect(x, 1, 5, 3, PAL.paper[2], 0.95); b.hline(x, 1, 5, PAL.paper[3], 0.97); }
        else if (pick < 0.7) { b.rect(x, 1, 7, 3, PAL.steel[2], 0.95); b.rect(x + 1, 2, 5, 1, PAL.cloth.olive[2]!, 0.96); }
        else { b.rect(x, 2, 4, 2, PAL.ink, 0.95); b.set(x + 1, 1, PAL.cloth.black[3]!, 0.97); }
    }
    return { lit: b, depth: top, shadow: { x: 0, y: h - 2, w, h: 4 } };
}

function filingCabinet(): PropArt {
    // About 1.3m tall and 0.6m deep: a 6px top over a three-drawer 13px front.
    const top = 6, front = 13, h = top + front;
    const b = new PixelBitmap(TILE, h);
    for (let y = 0; y < h; y++) for (let x = 2; x < 14; x++) {
        let c = step(PAL.steel, x < 4 ? 4 : x > 11 ? 2 : 3);
        if (y < top) c = y === top - 1 ? PAL.steel[5] : PAL.steel[4];
        if (y === top + 4 || y === top + 8) c = PAL.steel[1];
        b.set(x, y, c, y < top ? 1 : 0.7);
    }
    for (const y of [top + 2, top + 6, top + 10]) { b.rect(6, y, 4, 1, PAL.steel[5], 0.8); b.rect(7, y - 1, 2, 1, PAL.paper[3], 0.75); }
    b.rect(4, 1, 5, 3, PAL.paper[2], 1);
    return { lit: b, depth: top, shadow: { x: 2, y: h - 3, w: 12, h: 3 } };
}

function printer(): PropArt {
    // A copier on a low stand: 0.7m stand, the machine on top, 0.6m deep.
    const top = 6, h = 18;
    const b = new PixelBitmap(TILE, h);
    b.rect(2, 9, 12, 9, PAL.walnut[3], 0.6);
    b.rect(2, 9, 12, 1, PAL.walnut[5], 0.8);
    b.rect(3, 2, 10, 7, PAL.paper[1], 0.9);
    b.rect(3, 2, 10, 3, PAL.paper[2], 1);
    b.rect(5, 0, 6, 2, PAL.paper[3], 1);
    b.rect(4, 6, 8, 1, PAL.ink, 0.8);
    b.set(11, 4, PAL.emissive.ledGreen, 1);
    return { lit: b, depth: top, shadow: { x: 2, y: h - 3, w: 12, h: 3 } };
}

function waterCooler(): PropArt {
    // About 1.3m to the top of the bottle and 0.4m deep.
    const h = 18;
    const b = new PixelBitmap(TILE, h);
    b.rect(5, 7, 7, 11, PAL.paper[2], 0.7);
    b.rect(5, 7, 7, 1, PAL.paper[3], 0.9);
    b.rect(11, 7, 1, 11, PAL.paper[1], 0.65);
    b.set(7, 10, PAL.cloth.denim[3]!, 0.8);
    b.set(9, 10, PAL.cloth.burgundy[3]!, 0.8);
    b.rect(6, 1, 5, 6, PAL.glass[3], 0.95);
    b.rect(6, 1, 2, 6, PAL.glass[4], 1);
    b.rect(7, 0, 3, 1, PAL.glass[2], 0.95);
    b.rect(6, 3, 5, 1, PAL.glass[2], 0.9);
    return { lit: b, depth: 4, shadow: { x: 4, y: h - 3, w: 9, h: 3 } };
}

function crest(): PropArt {
    const b = new PixelBitmap(TILE * 2, TILE);
    // A brass roundel with a columned bank front, hung on the plaster.
    b.ellipse(16, 8, 7, 5.5, PAL.brass[1], 0.6);
    b.ellipse(16, 8, 6, 4.5, PAL.brass[3], 0.8);
    b.ellipse(16, 7.6, 5, 3.6, PAL.brass[2], 0.75);
    b.rect(13, 5, 7, 1, PAL.brass[5], 0.9);
    b.set(16, 4, PAL.brass[5], 0.9);
    for (const x of [13, 15, 17, 19]) b.rect(x, 6, 1, 4, PAL.brass[4], 0.9);
    b.rect(12, 10, 9, 1, PAL.brass[4], 0.9);
    b.rect(4, 7, 5, 1, PAL.brass[3], 0.7);
    b.rect(24, 7, 5, 1, PAL.brass[3], 0.7);
    return { lit: b, mount: 'face' };
}

function clock(): PropArt {
    const b = new PixelBitmap(TILE, TILE);
    b.ellipse(8, 8, 5, 5, PAL.brass[2], 0.8);
    b.ellipse(8, 8, 4, 4, PAL.paper[3], 0.75);
    b.vline(8, 5, 3, PAL.ink, 0.8);
    b.hline(8, 8, 3, PAL.ink, 0.8);
    b.set(8, 8, PAL.cloth.burgundy[3]!, 0.85);
    b.set(8, 3, PAL.brass[5], 0.9);
    return { lit: b, mount: 'face' };
}

function painting(): PropArt {
    const b = new PixelBitmap(TILE, TILE);
    b.rect(1, 4, 14, 9, PAL.brass[2], 0.75);
    b.rect(2, 5, 12, 7, PAL.emissive.sky[0], 0.6);
    b.rect(2, 9, 12, 3, PAL.leaf[3], 0.62);
    b.rect(2, 11, 12, 1, PAL.leaf[2], 0.62);
    b.rect(8, 7, 3, 2, PAL.limestone[4], 0.62);
    b.rect(8, 6, 3, 1, PAL.terracotta[2], 0.62);
    b.hline(1, 4, 14, PAL.brass[4], 0.8);
    return { lit: b, mount: 'face' };
}

function noticeBoard(): PropArt {
    const b = new PixelBitmap(TILE, TILE);
    b.rect(2, 4, 12, 8, PAL.terracotta[3], 0.65);
    b.rect(2, 4, 12, 1, PAL.walnut[4], 0.8);
    b.rect(3, 5, 4, 5, PAL.paper[3], 0.7);
    b.rect(8, 6, 4, 3, PAL.paper[2], 0.7);
    b.rect(9, 9, 3, 2, PAL.emissive.sky[1], 0.7);
    b.set(5, 5, PAL.cloth.burgundy[3]!, 0.8);
    b.set(10, 6, PAL.cloth.denim[3]!, 0.8);
    return { lit: b, mount: 'face' };
}

function exitSign(): PropArt {
    const b = new PixelBitmap(TILE, TILE), glow = glowOf(b);
    // Above the door frame, in the strip of wall between the door and the top of the face.
    b.rect(3, 0, 10, 5, PAL.steel[1], 0.8);
    glow.rect(4, 1, 8, 3, PAL.emissive.exitGreen[1], 1);
    glow.rect(5, 2, 2, 1, PAL.emissive.exitGreen[2], 1);
    glow.rect(8, 2, 3, 1, PAL.emissive.exitGreen[2], 1);
    return { lit: b, glow, mount: 'face', lights: [{ x: 8, y: 5, radius: 34, color: 0x52e08a, intensity: 0.6 }] };
}

function keycardLed(): PropArt {
    const b = new PixelBitmap(TILE, TILE), glow = glowOf(b);
    glow.set(14, 12, PAL.emissive.ledRed, 1);
    return { lit: b, glow, mount: 'face', lights: [{ x: 14, y: 12, radius: 14, color: 0xff4a3a, intensity: 0.8 }] };
}

function atmScreen(): PropArt {
    const b = new PixelBitmap(TILE, TILE), glow = glowOf(b);
    glow.rect(4, 8, 8, 4, PAL.emissive.screen[1], 1);
    glow.rect(5, 9, 5, 1, PAL.emissive.screen[2], 1);
    glow.rect(5, 11, 3, 1, PAL.emissive.screen[0], 1);
    return { lit: b, glow, mount: 'face', lights: [{ x: 8, y: 14, radius: 30, color: 0x7fd8e8, intensity: 0.8 }] };
}

function camera(): PropArt {
    // Mounted on the side wall's cap, body reaching out over the lobby.
    const b = new PixelBitmap(TILE * 2, TILE), glow = glowOf(b);
    b.rect(18, 3, 4, 2, PAL.steel[2], 0.9);
    b.rect(12, 4, 8, 4, PAL.paper[2], 1);
    b.rect(12, 4, 8, 1, PAL.paper[3], 1);
    b.rect(10, 5, 2, 3, PAL.ink, 0.95);
    b.set(10, 6, PAL.glass[3], 1);
    b.rect(12, 7, 8, 1, PAL.paper[0], 0.9);
    glow.set(19, 5, PAL.emissive.ledRed, 1);
    return { lit: b, glow, offsetX: -TILE, mount: 'cap' };
}

function queueRail(p: Extract<LobbyProp, { kind: 'queueRail' }>): PropArt {
    // Headroom above the first post for its finial; posts stand in the middle of their tiles.
    const pad = 8, h = p.length * TILE + pad;
    const b = new PixelBitmap(TILE, h);
    const cx = 8;
    for (let i = 0; i < p.length; i++) {
        const foot = pad + i * TILE + TILE / 2 + 1;
        // Weighted base, polished post, round finial.
        b.rect(cx - 2, foot, 5, 1, PAL.brass[1], 0.4);
        b.rect(cx - 1, foot - 1, 3, 1, PAL.brass[3], 0.5);
        b.rect(cx, foot - 10, 1, 9, PAL.brass[4], 0.95);
        b.rect(cx + 1, foot - 10, 1, 9, PAL.brass[2], 0.9);
        b.rect(cx, foot - 12, 2, 2, PAL.brass[5], 1);
        if (i < p.length - 1) {
            // Velvet rope hanging between this post and the next, sagging away from the viewer.
            for (let y = foot - 10; y < foot + TILE - 10; y++) {
                const t = (y - (foot - 10)) / TILE;
                const sag = Math.round(Math.sin(t * Math.PI) * 2);
                b.set(cx - 1 + (sag > 1 ? -1 : 0), y, t > 0.15 && t < 0.85 ? PAL.carpet[3] : PAL.carpet[2], 0.85);
            }
        }
    }
    return { lit: b, shadow: { x: 5, y: h - 8, w: 6, h: 2 } };
}

function mat(): PropArt {
    const b = new PixelBitmap(TILE * 2, TILE);
    for (let y = 2; y < 14; y++) for (let x = 1; x < 31; x++) {
        const border = y === 2 || y === 13 || x === 1 || x === 30;
        b.set(x, y, border ? PAL.brass[1] : ((x + y) % 2 ? PAL.asphalt[2] : PAL.asphalt[3]), 0.35);
    }
    return { lit: b, flat: true };
}

function writingDesk(): PropArt {
    const w = TILE * 2, h = 26;
    const b = new PixelBitmap(w, h), glow = glowOf(b);
    // A high island table: marble top on a walnut plinth, slips and chained pens on top.
    for (let x = 1; x < w - 1; x++) for (let y = 4; y < 9; y++) b.set(x, y, y === 4 ? PAL.marbleGreen[4] : y === 8 ? PAL.marbleGreen[1] : PAL.marbleGreen[3], 0.95);
    walnutFront(b, 3, 9, w - 6, 17);
    b.rect(4, 5, 4, 2, PAL.paper[3], 1);
    b.rect(9, 5, 3, 2, PAL.paper[2], 1);
    b.rect(20, 5, 4, 2, PAL.paper[3], 1);
    b.set(14, 6, PAL.ink, 1);
    b.set(26, 5, PAL.ink, 1);
    b.rect(15, 0, 1, 5, PAL.brass[3], 1);
    b.rect(13, 0, 5, 2, PAL.leaf[3], 1);
    glow.rect(13, 1, 5, 1, PAL.leaf[5], 1);
    return { lit: b, glow, lights: [{ x: 15, y: 3, radius: 48, color: 0xffcf8a, intensity: 1.4 }], shadow: { x: 2, y: h - 3, w: w - 4, h: 5 } };
}

function sofa(): PropArt {
    const w = TILE * 3, h = 24;
    const b = new PixelBitmap(w, h);
    const leather = PAL.walnut;
    // Chesterfield: buttoned back, two seat cushions, rolled arms.
    for (let y = 2; y < 12; y++) for (let x = 3; x < w - 3; x++) {
        const button = (x % 6 === 0) && (y === 5 || y === 9);
        b.set(x, y, button ? leather[1] : y === 2 ? leather[5] : y < 5 ? leather[4] : leather[3], 0.85);
    }
    for (let y = 12; y < 18; y++) for (let x = 4; x < w - 4; x++) b.set(x, y, y === 12 ? leather[5] : x === w / 2 ? leather[1] : leather[4], 0.7);
    for (let y = 18; y < 22; y++) for (let x = 4; x < w - 4; x++) b.set(x, y, leather[2], 0.6);
    for (const ax of [0, w - 5]) for (let y = 6; y < 22; y++) for (let x = ax; x < ax + 5; x++) {
        b.set(x, y, y === 6 ? leather[5] : y < 9 ? leather[4] : leather[3], 0.9);
    }
    b.rect(5, 22, 2, 2, PAL.walnut[0], 0.3);
    b.rect(w - 7, 22, 2, 2, PAL.walnut[0], 0.3);
    return { lit: b, shadow: { x: 1, y: h - 3, w: w - 2, h: 5 } };
}

function coffeeTable(): PropArt {
    const w = TILE * 2, h = 16;
    const b = new PixelBitmap(w, h);
    for (let y = 3; y < 9; y++) for (let x = 2; x < w - 2; x++) b.set(x, y, y === 3 ? PAL.walnut[5] : y === 8 ? PAL.walnut[2] : PAL.walnut[4], 0.8);
    b.rect(3, 9, 2, 6, PAL.walnut[1], 0.5);
    b.rect(w - 5, 9, 2, 6, PAL.walnut[1], 0.5);
    b.rect(5, 4, 7, 3, PAL.cloth.denim[3]!, 0.85);
    b.rect(6, 5, 5, 1, PAL.paper[3], 0.86);
    b.rect(14, 4, 6, 3, PAL.paper[2], 0.85);
    b.ellipse(24, 5, 2.5, 1.6, PAL.paper[3], 0.9);
    b.set(24, 5, PAL.walnut[1], 0.9);
    return { lit: b, offsetX: TILE / 2, shadow: { x: 2, y: h - 4, w: w - 4, h: 5 } };
}

function plant(seed: number): PropArt {
    const h = 34;
    const b = new PixelBitmap(TILE, h);
    const rand = mulberry32(seed);
    // Brass planter.
    for (let y = h - 10; y < h; y++) for (let x = 3; x < 13; x++) {
        const taper = y > h - 3 ? 1 : 0;
        if (x < 3 + taper || x > 12 - taper) continue;
        b.set(x, y, y === h - 10 ? PAL.brass[5] : x < 6 ? PAL.brass[4] : x > 10 ? PAL.brass[1] : PAL.brass[3], 0.8);
    }
    b.rect(4, h - 10, 8, 1, PAL.terracotta[0], 0.7);
    // Rubber plant: broad leaves fanning out, lighter on top.
    const leaves: [number, number][] = [];
    for (let i = 0; i < 14; i++) leaves.push([3 + rand() * 10, 2 + rand() * (h - 14)]);
    leaves.sort((a, c) => a[1] - c[1]);
    b.vline(8, 6, h - 16, PAL.leaf[1], 0.8);
    for (const [lx, ly] of leaves) {
        const tone = ly < 10 ? 4 : ly < 16 ? 3 : 2;
        b.ellipse(lx, ly, 2.6, 1.6, step(PAL.leaf, tone), 1);
        b.plot(Math.round(lx - 1), Math.round(ly - 1), step(PAL.leaf, tone + 1), 1);
    }
    return { lit: b, shadow: { x: 3, y: h - 3, w: 10, h: 4 } };
}

function brochureRack(): PropArt {
    // About 1.5m tall and 0.3m deep, its shelves of leaflets facing the room.
    const top = 3, h = 18;
    const b = new PixelBitmap(TILE, h);
    b.rect(3, 0, 10, h, PAL.walnut[2], 0.6);
    b.rect(3, 0, 10, top, PAL.walnut[4], 0.8);
    const colors = [PAL.cloth.denim[3]!, PAL.paper[3], PAL.cloth.burgundy[3]!, PAL.cloth.teal[3]!, PAL.cloth.mustard[3]!, PAL.paper[2]];
    for (let row = 0; row < 3; row++) for (let col = 0; col < 2; col++) {
        const y = top + 1 + row * 5;
        b.rect(4 + col * 5, y, 3, 3, colors[row * 2 + col]!, 0.75);
        b.hline(4 + col * 5, y, 3, mix(colors[row * 2 + col]!, 0xffffff, 0.3), 0.77);
        b.hline(4 + col * 5, y + 3, 4, PAL.walnut[1], 0.7);
    }
    return { lit: b, depth: top, shadow: { x: 3, y: h - 3, w: 10, h: 3 } };
}

function bin(): PropArt {
    const b = new PixelBitmap(TILE, 14);
    for (let y = 2; y < 14; y++) for (let x = 4; x < 12; x++) b.set(x, y, y === 2 ? PAL.brass[5] : x < 6 ? PAL.brass[4] : x > 9 ? PAL.brass[1] : PAL.brass[3], 0.8);
    b.rect(5, 2, 6, 1, PAL.ink, 0.5);
    return { lit: b, shadow: { x: 4, y: 12, w: 8, h: 3 } };
}

function streetLamp(): PropArt {
    const h = 60;
    const b = new PixelBitmap(TILE, h);
    const iron = PAL.steel;
    b.rect(5, h - 4, 6, 4, iron[1], 0.5);
    b.rect(6, h - 6, 4, 2, iron[2], 0.6);
    b.rect(7, 10, 2, h - 16, iron[2], 0.9);
    b.vline(7, 10, h - 16, iron[3], 0.95);
    // Lantern head, unlit by day.
    b.rect(4, 2, 8, 2, iron[1], 1);
    b.rect(5, 4, 6, 5, PAL.glass[3], 1);
    b.rect(5, 4, 2, 5, PAL.glass[4], 1);
    b.rect(5, 9, 6, 1, iron[1], 1);
    b.rect(6, 0, 4, 2, iron[2], 1);
    return { lit: b, shadow: { x: 4, y: h - 3, w: 8, h: 3 } };
}

function hydrant(): PropArt {
    const b = new PixelBitmap(TILE, 14);
    const red = PAL.carpet;
    b.rect(5, 3, 6, 10, red[3], 0.75);
    b.rect(5, 3, 2, 10, red[4], 0.8);
    b.rect(10, 3, 1, 10, red[1], 0.7);
    b.rect(6, 1, 4, 2, red[4], 0.9);
    b.rect(3, 6, 2, 2, red[2], 0.7);
    b.rect(11, 6, 2, 2, red[1], 0.7);
    b.rect(4, 12, 8, 2, red[1], 0.5);
    return { lit: b, shadow: { x: 4, y: 11, w: 8, h: 4 } };
}

function newsBox(): PropArt {
    const b = new PixelBitmap(TILE, 20);
    const body = PAL.cloth.teal;
    b.rect(2, 2, 12, 15, body[2]!, 0.75);
    b.rect(2, 2, 12, 1, body[3]!, 0.9);
    b.rect(3, 5, 10, 5, PAL.glass[2], 0.8);
    b.rect(4, 6, 8, 3, PAL.paper[2], 0.78);
    b.hline(4, 6, 8, PAL.ink, 0.79);
    b.rect(3, 12, 10, 2, body[1]!, 0.7);
    b.rect(3, 17, 2, 3, PAL.steel[1], 0.4);
    b.rect(11, 17, 2, 3, PAL.steel[1], 0.4);
    return { lit: b, shadow: { x: 2, y: 17, w: 12, h: 4 } };
}

function streetBin(): PropArt {
    const b = new PixelBitmap(TILE, 18);
    const body = PAL.leaf;
    for (let y = 3; y < 18; y++) for (let x = 3; x < 13; x++) b.set(x, y, x % 3 === 0 ? body[1] : y < 5 ? body[3] : body[2], 0.75);
    b.rect(2, 2, 12, 2, body[3], 0.95);
    b.rect(5, 4, 6, 1, PAL.ink, 0.6);
    return { lit: b, shadow: { x: 3, y: 15, w: 10, h: 4 } };
}

function bollard(): PropArt {
    const b = new PixelBitmap(TILE, 12);
    b.rect(6, 2, 4, 10, PAL.steel[2], 0.8);
    b.rect(6, 2, 1, 10, PAL.steel[4], 0.85);
    b.rect(6, 1, 4, 1, PAL.steel[4], 1);
    b.rect(6, 4, 4, 1, PAL.brass[3], 0.85);
    return { lit: b, shadow: { x: 5, y: 10, w: 6, h: 3 } };
}

function manhole(): PropArt {
    const b = new PixelBitmap(TILE, TILE);
    b.ellipse(8, 8, 6, 4.5, PAL.steel[0], 0.3);
    b.ellipse(8, 8, 5, 3.6, PAL.steel[1], 0.4);
    for (let x = 4; x < 13; x += 2) b.vline(x, 6, 4, PAL.steel[2], 0.45);
    return { lit: b, flat: true };
}

function van(): PropArt {
    // The crew's panel van at the kerb, nose to the left: roof seen from above, the near side facing the street.
    const w = TILE * 5, h = 44;
    const b = new PixelBitmap(w, h);
    const body: Ramp = PAL.concrete;
    const roofTop = 2, sideTop = 14, sideBottom = h - 8;
    for (let y = roofTop; y < sideTop; y++) for (let x = 6; x < w - 2; x++) b.set(x, y, y === roofTop ? body[5]! : y > sideTop - 3 ? body[3]! : body[4]!, 1);
    // Cab: shorter roof and a windscreen sloping to the bonnet.
    for (let y = sideTop - 6; y < sideTop; y++) for (let x = 1; x < 8; x++) b.set(x, y, x + (sideTop - y) < 8 ? PAL.glass[2] : body[4]!, 0.95);
    for (let y = sideTop; y < sideBottom; y++) for (let x = 1; x < w - 2; x++) {
        let c = step(body, y < sideTop + 2 ? 4 : y > sideBottom - 4 ? 2 : 3);
        if (x === 1 || x === w - 3) c = body[1]!;
        b.set(x, y, c, 0.75);
    }
    b.rect(3, sideTop + 1, 13, 7, PAL.glass[1], 0.8);
    b.rect(3, sideTop + 1, 13, 1, PAL.glass[3], 0.82);
    b.rect(4, sideTop + 2, 3, 5, PAL.glass[4], 0.82);
    b.vline(18, sideTop, sideBottom - sideTop - 1, body[1]!, 0.7);
    b.vline(48, sideTop, sideBottom - sideTop - 1, body[1]!, 0.7);
    b.rect(44, sideTop + 9, 3, 1, PAL.steel[1], 0.8);
    // Faded signwriting on the panel: a plumber that doesn't exist.
    b.rect(24, sideTop + 7, 18, 2, mix(body[2]!, PAL.cloth.navy[3]!, 0.6), 0.76);
    b.rect(24, sideTop + 10, 12, 1, mix(body[2]!, PAL.cloth.navy[3]!, 0.4), 0.76);
    b.rect(1, sideBottom - 6, 3, 2, PAL.paper[3], 0.85);
    b.rect(w - 4, sideBottom - 7, 2, 3, PAL.carpet[3], 0.85);
    b.rect(0, sideBottom - 3, w - 1, 2, PAL.steel[1], 0.6);
    for (const wx of [10, w - 16]) {
        b.ellipse(wx, sideBottom + 2, 6, 5, PAL.ink, 0.5);
        b.ellipse(wx, sideBottom + 2, 3, 2.5, PAL.steel[3], 0.6);
        b.set(wx, sideBottom + 2, PAL.steel[1], 0.6);
    }
    b.each((x, y, c, ht) => (y > sideBottom - 6 && y < sideBottom && x > 1 && x < w - 3 ? [deepen(c, 0.12), ht] : undefined));
    return { lit: b, shadow: { x: 0, y: h - 6, w, h: 7 } };
}

export function propArt(p: LobbyProp): PropArt {
    switch (p.kind) {
        case 'counter': return counter(p);
        case 'backCounter': return backCounter(p);
        case 'filingCabinet': return filingCabinet();
        case 'printer': return printer();
        case 'waterCooler': return waterCooler();
        case 'crest': return crest();
        case 'clock': return clock();
        case 'painting': return painting();
        case 'noticeBoard': return noticeBoard();
        case 'exitSign': return exitSign();
        case 'keycardLed': return keycardLed();
        case 'atmScreen': return atmScreen();
        case 'camera': return camera();
        case 'queueRail': return queueRail(p);
        case 'mat': return mat();
        case 'writingDesk': return writingDesk();
        case 'sofa': return sofa();
        case 'coffeeTable': return coffeeTable();
        case 'plant': return plant(p.tx * 13 + p.ty * 7);
        case 'brochureRack': return brochureRack();
        case 'bin': return bin();
        case 'streetLamp': return streetLamp();
        case 'hydrant': return hydrant();
        case 'newsBox': return newsBox();
        case 'streetBin': return streetBin();
        case 'bollard': return bollard();
        case 'manhole': return manhole();
        case 'van': return van();
    }
}
