import type { AimBodyVM, AimVM, BreachVM, ShieldVM } from '../../game/loudUi';
import type { Signal } from '../../game/worldUi';
import type { Pos } from '../../sim';

/*
 * The loud layer of the world overlay (UI.md "Loud", "In the cone and in cover", M3-09), drawn in the overlay's UI pixels
 * with its hairlines over a 1px ink drop shadow:
 *
 * - **Shot cones**, nested arcs, one per bullet (§11.2): the widest outermost and faintest, bullet 1 innermost and
 *   brightest, each outlined (never filled) from the shooter to where its bullets stop; the reach a bullet gains once
 *   this attack has broken glass or worn cover through, dashed; a crosshair on the aim point.
 * - **Bodies in the cone** wear an outlined marker over the head: a red diamond for a hostile, a pale circle for a
 *   civilian, a blue triangle for the crew; dashed when reached only once something breaks.
 * - **Cover** against the shot: a light-blue bar with end ticks and a soft glow on the side of the tile facing the
 *   shooter, a dashed grey line when flanked, a notch where this attack could break it, a `?` where it may be gone.
 * - **Breaches** announced for the next world phase: a red bracketed plate with a charge's flash on the door.
 * - **The acting unit** of a world phase in a firefight: red corner brackets round its tile.
 */

export interface LoudContent {
    aim?: AimVM;
    breaches?: BreachVM[];
    /** The unit acting now in a world phase's playback: bracketed in red. */
    acting?: Pos;
}

export interface Frame {
    left: (p: Pos) => number;
    top: (p: Pos) => number;
    mid: (p: Pos) => [number, number];
    /** UI pixels per tile. */
    S: number;
    pal: Record<Signal, string>;
}

const INK = 'rgba(13, 12, 20, 0.85)';
const CREAM = '#f2e6c8';
/** Cover's light blue (UI.md "Signal palette"; the same in the colour-blind preset). */
const COVER = '#acd8f4';
const FLANKED = '#8a8894';
/** How far above a tile's top edge a standing head reaches (UI pixels), as the overlay's `HEAD`. */
const HEAD = 30;

const rgba = (hex: string, a: number): string => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** Strokes `path` twice: the ink drop shadow 2px down, then the colour. */
function inked(ctx: CanvasRenderingContext2D, colour: string, width: number, path: (dy: number) => void, dash: number[] = []): void {
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    for (const [style, dy] of [[INK, 2], [colour, 0]] as const) {
        ctx.strokeStyle = style;
        ctx.beginPath();
        path(dy);
        ctx.stroke();
    }
    ctx.setLineDash([]);
}

/** The distance bullets fly at `angle` off the aim line, from the outline's samples (sorted by angle). */
function reachAt(outline: readonly [number, number][], angle: number): number {
    if (!outline.length) return 0;
    if (angle <= outline[0]![0]) return outline[0]![1];
    for (let i = 1; i < outline.length; i++) {
        const [a1, d1] = outline[i]!, [a0, d0] = outline[i - 1]!;
        if (angle <= a1) return a1 - a0 < 1e-9 ? d1 : d0 + ((d1 - d0) * (angle - a0)) / (a1 - a0);
    }
    return outline[outline.length - 1]![1];
}

/** The cone, its bodies' markers and their cover. */
export function drawLoud(ctx: CanvasRenderingContext2D, c: LoudContent, f: Frame): void {
    if (c.aim) drawAim(ctx, c.aim, f);
    for (const b of c.breaches ?? []) drawBreach(ctx, b, f);
    if (c.acting) drawActing(ctx, c.acting, f, f.pal.red);
}

function drawAim(ctx: CanvasRenderingContext2D, aim: AimVM, f: Frame): void {
    const { mid, S, pal } = f, [ox, oy] = mid(aim.origin);
    const outline = [...aim.outline].sort((a, b) => a[0] - b[0]);
    const point = (angle: number, d: number): [number, number] => {
        const t = aim.aim + (angle * Math.PI) / 180;
        return [ox + Math.cos(t) * d * S, oy + Math.sin(t) * d * S];
    };
    // Widest first, so bullet 1's bright arc lies on top.
    const n = aim.arcs.length;
    for (let i = n - 1; i >= 0; i--) {
        const half = aim.arcs[i]! / 2, lo = aim.turn - half, hi = aim.turn + half;
        const angles = [lo, ...outline.map(([a]) => a).filter(a => a > lo && a < hi), hi];
        const strength = n === 1 ? 0.95 : 0.95 - (0.6 * i) / (n - 1);
        inked(ctx, rgba(CREAM, strength), i === 0 ? 2 : 1, dy => {
            ctx.moveTo(ox, oy + dy);
            for (const a of angles) {
                const [x, y] = point(a, reachAt(outline, a));
                ctx.lineTo(x, y + dy);
            }
            ctx.lineTo(ox, oy + dy);
        });
    }
    // Past what this attack could break: how much further a later bullet may fly, dashed.
    for (const piece of aim.broken) {
        const sorted = [...piece].sort((a, b) => a[0] - b[0]);
        inked(ctx, rgba(CREAM, 0.6), 1, dy => {
            sorted.forEach(([a, d], i) => {
                const [x, y] = point(a, d);
                if (i === 0) ctx.moveTo(x, y + dy);
                else ctx.lineTo(x, y + dy);
            });
            if (sorted.length === 1) {
                const [a, d] = sorted[0]!, [x0, y0] = point(a, reachAt(outline, a)), [x1, y1] = point(a, d);
                ctx.moveTo(x0, y0 + dy);
                ctx.lineTo(x1, y1 + dy);
            }
        }, [3, 3]);
    }
    // The aim point: a small crosshair.
    const [ax, ay] = mid(aim.at), r = S * 0.22;
    inked(ctx, rgba(pal.red, 0.9), 2, dy => {
        ctx.moveTo(ax - r, ay + dy);
        ctx.lineTo(ax - r / 3, ay + dy);
        ctx.moveTo(ax + r / 3, ay + dy);
        ctx.lineTo(ax + r, ay + dy);
        ctx.moveTo(ax, ay - r + dy);
        ctx.lineTo(ax, ay - r / 3 + dy);
        ctx.moveTo(ax, ay + r / 3 + dy);
        ctx.lineTo(ax, ay + r + dy);
    });
    for (const b of aim.bodies) {
        if (b.shield) drawShield(ctx, b.pos, b.shield, f);
        drawBodyMarker(ctx, b, f);
    }
}

/** The marker over a head in the cone (UI.md "In the cone and in cover"). */
function drawBodyMarker(ctx: CanvasRenderingContext2D, b: AimBodyVM, f: Frame): void {
    const [x] = f.mid(b.pos), y = f.top(b.pos) - HEAD - 6, r = 5;
    const colour = b.kind === 'hostile' ? f.pal.red : b.kind === 'crew' ? f.pal.command : CREAM;
    inked(ctx, colour, 2, dy => {
        if (b.kind === 'hostile') {
            ctx.moveTo(x, y - r + dy);
            ctx.lineTo(x + r, y + dy);
            ctx.lineTo(x, y + r + dy);
            ctx.lineTo(x - r, y + dy);
            ctx.closePath();
        } else if (b.kind === 'crew') {
            ctx.moveTo(x, y + r + dy);
            ctx.lineTo(x + r, y - r + dy);
            ctx.lineTo(x - r, y - r + dy);
            ctx.closePath();
        } else ctx.arc(x, y + dy, r, 0, Math.PI * 2);
    }, b.ifBroken ? [2, 2] : []);
}

/** A shield on the side of the tile facing the shooter. */
function drawShield(ctx: CanvasRenderingContext2D, p: Pos, s: ShieldVM, f: Frame): void {
    const l = f.left(p), t = f.top(p), S = f.S, inset = 3, tick = 4;
    const [x0, y0, x1, y1, nx, ny] = s.side === 'n' ? [l + inset, t + 1, l + S - inset, t + 1, 0, 1]
        : s.side === 's' ? [l + inset, t + S - 1, l + S - inset, t + S - 1, 0, -1]
            : s.side === 'w' ? [l + 1, t + inset, l + 1, t + S - inset, 1, 0]
                : [l + S - 1, t + inset, l + S - 1, t + S - inset, -1, 0];
    if (s.state === 'flanked') {
        inked(ctx, FLANKED, 2, dy => {
            ctx.moveTo(x0, y0 + dy);
            ctx.lineTo(x1, y1 + dy);
        }, [3, 3]);
        return;
    }
    const colour = s.mayBeGone ? rgba(COVER, 0.6) : COVER;
    // The soft glow, then the bar with its end ticks.
    ctx.lineWidth = 8;
    ctx.strokeStyle = rgba(COVER, 0.18);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    inked(ctx, colour, 4, dy => {
        ctx.moveTo(x0, y0 + dy);
        ctx.lineTo(x1, y1 + dy);
    }, s.mayBeGone ? [5, 3] : []);
    inked(ctx, colour, 2, dy => {
        ctx.moveTo(x0, y0 + dy);
        ctx.lineTo(x0 + nx * tick, y0 + ny * tick + dy);
        ctx.moveTo(x1, y1 + dy);
        ctx.lineTo(x1 + nx * tick, y1 + ny * tick + dy);
    });
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (s.mayBreak) {
        // The crack: an ink notch through the bar's middle.
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 2 * ny - 3 * nx, cy - 2 * nx - 3 * ny);
        ctx.lineTo(cx + 2 * ny, cy + 2 * nx);
        ctx.lineTo(cx - 2 * ny + 3 * nx, cy - 2 * nx + 3 * ny);
        ctx.stroke();
    }
    if (s.mayBeGone) {
        ctx.font = '600 10px ui-monospace, Menlo, Consolas, monospace';
        ctx.textAlign = 'center';
        const qx = cx + nx * 9, qy = cy + ny * 9 + 4;
        ctx.fillStyle = INK;
        ctx.fillText('?', qx, qy + 1);
        ctx.fillStyle = COVER;
        ctx.fillText('?', qx, qy);
    }
}

/** A breach announced on a door (its edge's middle, in tiles): a red plate with the charge's flash, bracketed. */
function drawBreach(ctx: CanvasRenderingContext2D, b: BreachVM, f: Frame): void {
    const x = f.left(b.at), y = f.top(b.at), red = f.pal.red, w = 14, h = 12;
    // Corner brackets round the doorway.
    const R = f.S * 0.6, k = 6;
    inked(ctx, red, 2, dy => {
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
            ctx.moveTo(x + sx * R, y + sy * R - sy * k + dy);
            ctx.lineTo(x + sx * R, y + sy * R + dy);
            ctx.lineTo(x + sx * R - sx * k, y + sy * R + dy);
        }
    });
    ctx.fillStyle = 'rgba(12, 11, 15, 0.86)';
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.strokeStyle = rgba(red, 0.92);
    ctx.lineWidth = 1;
    ctx.strokeRect(x - w / 2 + 0.5, y - h / 2 + 0.5, w - 1, h - 1);
    // The flash: an eight-pointed burst.
    ctx.strokeStyle = red;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4, r0 = 1.5, r1 = i % 2 ? 3 : 4.5;
        ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
        ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
    }
    ctx.stroke();
}

/** Red corner brackets round the tile of the unit acting now (UI.md "World phase in a firefight"). */
function drawActing(ctx: CanvasRenderingContext2D, p: Pos, f: Frame, red: string): void {
    const l = f.left(p) - 4, t = f.top(p) - HEAD - 4, r = f.left(p) + f.S + 4, b = f.top(p) + f.S + 2, k = 7;
    inked(ctx, red, 2, dy => {
        ctx.moveTo(l, t + k + dy); ctx.lineTo(l, t + dy); ctx.lineTo(l + k, t + dy);
        ctx.moveTo(r - k, t + dy); ctx.lineTo(r, t + dy); ctx.lineTo(r, t + k + dy);
        ctx.moveTo(r, b - k + dy); ctx.lineTo(r, b + dy); ctx.lineTo(r - k, b + dy);
        ctx.moveTo(l + k, b + dy); ctx.lineTo(l, b + dy); ctx.lineTo(l, b - k + dy);
    });
}
