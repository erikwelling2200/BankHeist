import type { LoudVM, WedgeVM } from '../../game/loudBoards';
import type { Pos } from '../../sim';
import { drawNumber, numberWidth } from '../../art/ui/glyphs';

/*
 * The loud layer drawn on the world overlay (UI.md "Loud", M3-09; src/game/loudBoards.ts makes it): Watch wedges (the
 * crew's steel blue, the police's red), grenades lying with their radius and fuse, and the driving overlay (every
 * footprint the van can reach tinted, the chosen one bracketed, its swept path drawn, crew left on foot flagged).
 * Hairline strokes over a 1px ink shadow, outlines rather than fills, as the rest of the world UI.
 */

export interface LoudDraw {
    ctx: CanvasRenderingContext2D;
    /** UI pixels per tile. */
    S: number;
    left: (p: Pos) => number;
    top: (p: Pos) => number;
    /** The signal palette (default or colour-blind). */
    pal: { safe: string; amber: string; red: string; command: string; cream: string };
    ink: string;
    /** An inset rounded outline round a set of tiles (the overlay's contour, as the noise ring's). */
    outline: (tiles: Pos[], colour: string, width: number, dash: number[]) => void;
}

/** GO and money's gold (unchanged in the colour-blind preset): a drive off the plot is the getaway. */
const GOLD = '#f2c94c';

const rgba = (hex: string, a: number): string => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** A point in tiles (a tile's middle is +0.5) on the drawing. */
const at = (d: LoudDraw, x: number, y: number): [number, number] => {
    const t = { x: Math.floor(x), y: Math.floor(y) };
    return [d.left(t) + (x - t.x) * d.S, d.top(t) + (y - t.y) * d.S];
};

/** A stroke over its ink shadow, one pixel lower. */
function shadowed(d: LoudDraw, colour: string, width: number, path: () => void, dash: number[] = []): void {
    const { ctx } = d;
    ctx.setLineDash(dash);
    for (const [style, dy] of [[d.ink, 2], [colour, 0]] as const) {
        ctx.save();
        ctx.translate(0, dy);
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.beginPath();
        path();
        ctx.stroke();
        ctx.restore();
    }
    ctx.setLineDash([]);
}

/** A wedge: its two edges and its arc at its reach, a faint fan inside, and a tick where it is aimed. */
function drawWedge(d: LoudDraw, w: WedgeVM): void {
    const { ctx, S } = d, colour = w.side === 'police' ? d.pal.red : d.pal.command;
    const [ox, oy] = at(d, w.from.x + 0.5, w.from.y + 0.5), [ax, ay] = at(d, w.at.x + 0.5, w.at.y + 0.5);
    const aim = Math.atan2(ay - oy, ax - ox), half = (w.arc / 2) * Math.PI / 180, r = w.range * S;
    const sector = () => {
        ctx.moveTo(ox, oy);
        ctx.arc(ox, oy, r, aim - half, aim + half);
        ctx.closePath();
    };
    // A faint fan so the wedge reads as an area; the outline carries it.
    const fan = ctx.createRadialGradient(ox, oy, 0, ox, oy, r);
    fan.addColorStop(0, rgba(colour, w.preview ? 0.22 : 0.16));
    fan.addColorStop(1, rgba(colour, 0));
    ctx.fillStyle = fan;
    ctx.beginPath();
    sector();
    ctx.fill();
    shadowed(d, colour, 2, sector, w.preview ? [6, 4] : []);
    // The aim: a short tick across the middle line at the tile aimed at.
    const dist = Math.hypot(ax - ox, ay - oy);
    if (dist > 0) {
        const nx = -(ay - oy) / dist, ny = (ax - ox) / dist, k = S * 0.3;
        shadowed(d, colour, 2, () => {
            ctx.moveTo(ax - nx * k, ay - ny * k);
            ctx.lineTo(ax + nx * k, ay + ny * k);
        });
    }
}

/** A grenade lying: a dot on its tile, its radius dashed, and its fuse (world phases until it goes off) on a plate. */
function drawGrenade(d: LoudDraw, g: LoudVM['grenades'][number]): void {
    const { ctx, S } = d, colour = g.police ? d.pal.red : d.pal.amber;
    const [x, y] = at(d, g.at.x + 0.5, g.at.y + 0.5), r = (g.radius + 0.5) * S;
    shadowed(d, colour, 2, () => ctx.arc(x, y, r, 0, Math.PI * 2), [5, 4]);
    ctx.fillStyle = colour;
    ctx.strokeStyle = d.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, S * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // The fuse on a dark plate above the grenade, in its colour, in the overlay's digit font.
    const text = String(g.fuse), w = numberWidth(text) + 8, px = Math.round(x - w / 2), py = Math.round(y - S * 0.5 - 16);
    ctx.fillStyle = 'rgba(11, 13, 23, 0.85)';
    ctx.fillRect(px, py, w, 12);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, w - 1, 11);
    drawNumber(ctx, text, px + 4, py + 3, colour);
}

/** Corner brackets round a box of tiles. */
function brackets(d: LoudDraw, tiles: Pos[], colour: string): void {
    if (!tiles.length) return;
    const xs = tiles.map(t => t.x), ys = tiles.map(t => t.y);
    const [x0, y0] = at(d, Math.min(...xs), Math.min(...ys)), [x1, y1] = at(d, Math.max(...xs) + 1, Math.max(...ys) + 1);
    const k = d.S * 0.45, ctx = d.ctx;
    shadowed(d, colour, 3, () => {
        for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]] as const) {
            ctx.moveTo(cx + sx * k, cy);
            ctx.lineTo(cx, cy);
            ctx.lineTo(cx, cy + sy * k);
        }
    });
}

/** The driving overlay. */
function drawDrive(d: LoudDraw, v: NonNullable<LoudVM['drive']>): void {
    const { ctx, S } = d;
    // Every footprint it can reach: a sage outline, faintly tinted (UI.md "Every footprint the van can reach is tinted").
    ctx.fillStyle = rgba(d.pal.safe, 0.12);
    for (const t of v.reach) ctx.fillRect(d.left(t), d.top(t), S, S);
    d.outline(v.reach, rgba(d.pal.safe, 0.9), 1.5, []);
    // The swept path: the tiles it passes over outlined in steel blue, and its middle line, dotted.
    // The path in cream (neutral), apart from the reach's safe colour in either palette (blue and pale blue in the
    // colour-blind one would read as one).
    if (v.swept.length) d.outline(v.swept, rgba(d.pal.cream, 0.9), 2, [4, 3]);
    if (v.path.length > 1) {
        shadowed(d, d.pal.cream, 2, () => v.path.forEach((p, i) => {
            const [x, y] = at(d, p.x, p.y);
            if (i) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
        }), [2, 4]);
    }
    // The chosen footprint: steel blue (your control), red when it can't be reached, gold when the drive leaves the plot.
    const mark = v.refusal ? d.pal.red : v.off ? GOLD : d.pal.command;
    brackets(d, v.chosen, mark);
    // The way it will face: a chevron at the front of the chosen footprint.
    if (v.chosen.length) {
        const xs = v.chosen.map(t => t.x), ys = v.chosen.map(t => t.y);
        const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, y0 = Math.min(...ys), y1 = Math.max(...ys) + 1, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        const [fx, fy] = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }[v.heading] as [number, number];
        const tip = at(d, mx + fx * ((x1 - x0) / 2 - 0.3), my + fy * ((y1 - y0) / 2 - 0.3)), k = S * 0.35;
        shadowed(d, mark, 3, () => {
            ctx.moveTo(tip[0] - fx * k - fy * k, tip[1] - fy * k - fx * k);
            ctx.lineTo(tip[0], tip[1]);
            ctx.lineTo(tip[0] - fx * k + fy * k, tip[1] - fy * k + fx * k);
        });
    }
    // Off the plot (the getaway): two gold chevrons where the van leaves it, pointing the way it goes.
    if (v.exit) {
        const [fx, fy] = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }[v.heading] as [number, number], k = S * 0.4;
        for (const back of [0, 0.45]) {
            const [tx, ty] = at(d, v.exit.x - fx * back, v.exit.y - fy * back);
            shadowed(d, GOLD, 3, () => {
                ctx.moveTo(tx - fx * k - fy * k, ty - fy * k - fx * k);
                ctx.lineTo(tx, ty);
                ctx.lineTo(tx - fx * k + fy * k, ty - fy * k + fx * k);
            });
        }
    }
    // Crew left on foot: a flag over each.
    for (const p of v.onFoot) {
        const [x, y] = at(d, p.x + 0.5, p.y);
        shadowed(d, d.pal.amber, 2, () => {
            ctx.moveTo(x, y - 6);
            ctx.lineTo(x, y - 26);
        });
        ctx.fillStyle = d.pal.amber;
        ctx.strokeStyle = d.ink;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y - 26);
        ctx.lineTo(x + 11, y - 22);
        ctx.lineTo(x, y - 18);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }
}

export function drawBoards(d: LoudDraw, vm: LoudVM): void {
    if (vm.drive) drawDrive(d, vm.drive);
    for (const w of vm.wedges) if (w.side === 'police') drawWedge(d, w);
    for (const w of vm.wedges) if (w.side === 'crew') drawWedge(d, w);
    for (const g of vm.grenades) drawGrenade(d, g);
}
