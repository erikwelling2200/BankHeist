import Phaser from 'phaser';
import { TILE } from '../../level/level';
import type { Pos } from '../../sim';

/**
 * The world UI layer (UI.md "Two layers"), as far as play mode needs it before M1-14: a canvas over the game's at twice
 * the art's resolution (one UI pixel is half an art pixel), redrawn after each frame from where the camera looked. It
 * shows the selected crew member's movement range, XCOM style: the tiles a Move (1 action) reaches in steel blue with a
 * solid edge, those only a Dash (2 actions) reaches beyond them hatched in gold with a dashed edge, so the two read apart
 * without colour too. The range stays while a path is previewed or dragged; the path goes on top, ending on a tile
 * outline in the crew colour (doubled for a dash, with its noise ring dotted in amber); a dragged path's steps past the
 * first bad one are red. It takes no input: taps go through to the map.
 *
 * TODO(M1-14): safe-floor tints and glyphs, the eye icon, noise rings, badges; floor UI under the people.
 */

/** UI pixels per art pixel. */
const UI_SCALE = 2;

export interface OverlayContent {
    /** The crew colour (CSS). */
    colour: string;
    /** The tiles a Move can end on, and those only a Dash reaches. */
    reach?: { move: Pos[]; dash: Pos[]; at?: Pos };
    /** Where the path starts (the crew member's tile) and its steps. */
    from?: Pos;
    path?: Pos[];
    /** A dash: the end is marked twice. */
    dash?: boolean;
    /** The tiles the previewed command's noise reaches (a dash's quiet noise, §6.3). */
    noise?: Pos[];
    /** The index of the first step that can't be taken; it and those after it are drawn red. */
    badFrom?: number;
    /** The NPCs' committed walks for the next world phase: a dotted line and a pin where each ends. */
    intents?: { from: Pos; path: Pos[]; predicted?: boolean }[];
    /** Which tiles the crew has seen (row-major, 1 = seen); the rest are unscouted, drawn grey (§8.15). */
    seen?: { width: number; bits: Uint8Array };
    /** Ghosts: where an NPC was last seen, and how long ago. */
    ghosts?: { pos: Pos; seenAgo: number }[];
    /** Loud noises the crew heard (§8.15). */
    pings?: { at: Pos }[];
}

/** Move's range: steel blue ("your control"), a flat tint and a solid edge. */
const WALK = 'rgba(138, 182, 214, 0.3)';
const WALK_EDGE = 'rgba(138, 182, 214, 0.9)';
/** Dash's band: gold, hatched, with a dashed edge. */
const RUN = 'rgba(242, 201, 76, 0.1)';
const RUN_HATCH = 'rgba(242, 201, 76, 0.42)';
const RUN_EDGE = 'rgba(242, 201, 76, 0.95)';
/** A dash's noise: sodium amber (suspicion), dotted. */
const NOISE = 'rgba(232, 128, 48, 1)';
const NOISE_FILL = 'rgba(226, 162, 64, 0.22)';
const INK = 'rgba(13, 12, 20, 0.85)';
const CREAM = '#f2e6c8';
const RED = '#d44638';
const INTENT = 'rgba(242, 230, 200, 0.7)';
const INTENT_PREDICTED = 'rgba(242, 230, 200, 0.4)';
const UNSCOUTED = 'rgba(96, 98, 110, 0.45)';
const PING = 'rgba(226, 162, 64, 0.8)';

export class WorldOverlay {
    readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private content: OverlayContent | null = null;
    /** What the last drawing was made from: redraw only when the view or the content changes. */
    private drawn = '';
    private readonly onRender = () => this.draw();

    constructor(private readonly scene: Phaser.Scene) {
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'world-overlay';
        Object.assign(this.canvas.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2', imageRendering: 'pixelated' });
        this.ctx = this.canvas.getContext('2d')!;
        document.body.append(this.canvas);
        scene.game.events.on(Phaser.Core.Events.POST_RENDER, this.onRender);
        scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    }

    set(content: OverlayContent | null): void {
        this.content = content;
        this.drawn = '';
    }

    /** The path shown, for tests. */
    get state(): { path: Pos[]; reach: number; dashReach: number; range: { walk: Pos[]; run: Pos[] }; dash: boolean; noise: number; intents: number } {
        const c = this.content;
        return {
            path: c?.path ?? [], reach: c?.reach?.move.length ?? 0, dashReach: c?.reach?.dash.length ?? 0,
            range: { walk: c?.reach?.move ?? [], run: c?.reach?.dash ?? [] }, dash: !!c?.dash, noise: c?.noise?.length ?? 0,
            intents: c?.intents?.length ?? 0
        };
    }

    destroy(): void {
        this.scene.game.events.off(Phaser.Core.Events.POST_RENDER, this.onRender);
        this.canvas.remove();
    }

    /** Draws over the frame just rendered: sized and placed over the game's canvas, shifted by the camera's view. */
    private draw(): void {
        const game = this.scene.game, cam = this.scene.cameras.main, box = game.canvas.getBoundingClientRect();
        const w = Math.round(this.scene.scale.width * UI_SCALE), h = Math.round(this.scene.scale.height * UI_SCALE);
        const vx = Math.round(cam.worldView.x), vy = Math.round(cam.worldView.y);
        const key = `${w}x${h}@${vx},${vy}:${box.left},${box.top},${box.width},${box.height}`;
        if (key === this.drawn) return;
        this.drawn = key;
        const { canvas, ctx } = this;
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        Object.assign(canvas.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
        ctx.clearRect(0, 0, w, h);
        const c = this.content;
        if (!c) return;
        const S = TILE * UI_SCALE;
        const left = (p: Pos) => (p.x * TILE - vx) * UI_SCALE, top = (p: Pos) => (p.y * TILE - vy) * UI_SCALE;
        const mid = (p: Pos): [number, number] => [left(p) + S / 2, top(p) + S / 2];

        if (c.seen) {
            // Unscouted: a grey veil over every tile in view the crew hasn't seen.
            const { width, bits } = c.seen, height = bits.length / width;
            ctx.fillStyle = UNSCOUTED;
            const x0 = Math.max(0, Math.floor(vx / TILE)), y0 = Math.max(0, Math.floor(vy / TILE));
            const x1 = Math.min(width - 1, Math.floor((vx + w / UI_SCALE) / TILE)), y1 = Math.min(height - 1, Math.floor((vy + h / UI_SCALE) / TILE));
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!bits[y * width + x]) ctx.fillRect(left({ x, y }), top({ x, y }), S, S);
        }

        for (const p of c.pings ?? []) {
            const [x, y] = mid(p.at);
            ctx.lineWidth = 2;
            for (const r of [10, 20]) {
                ctx.strokeStyle = INK;
                ctx.beginPath();
                ctx.arc(x, y + 2, r, 0, Math.PI * 2);
                ctx.stroke();
                ctx.strokeStyle = PING;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        /** Each side of a tile in `tiles` that `inside` doesn't continue past: the set's outline, a side at a time. */
        const outline = (tiles: Pos[], inside: (x: number, y: number) => boolean, draw: (x0: number, y0: number, x1: number, y1: number) => void) => {
            for (const p of tiles) {
                const x = left(p), y = top(p);
                if (!inside(p.x, p.y - 1)) draw(x, y, x + S, y);
                if (!inside(p.x, p.y + 1)) draw(x, y + S, x + S, y + S);
                if (!inside(p.x - 1, p.y)) draw(x, y, x, y + S);
                if (!inside(p.x + 1, p.y)) draw(x + S, y, x + S, y + S);
            }
        };
        const has = (tiles: Pos[]) => {
            const set = new Set(tiles.map(p => `${p.x},${p.y}`));
            return (x: number, y: number) => set.has(`${x},${y}`);
        };
        /** Strokes an outline in `colour` over a 1px ink drop shadow (UI.md "Visual language"). */
        const stroke = (tiles: Pos[], inside: (x: number, y: number) => boolean, colour: string, width: number, dash: number[]) => {
            ctx.lineWidth = width;
            ctx.setLineDash(dash);
            for (const [style, dy] of [[INK, 2], [colour, 0]] as const) {
                ctx.strokeStyle = style;
                ctx.beginPath();
                outline(tiles, inside, (x0, y0, x1, y1) => {
                    ctx.moveTo(x0, y0 + dy);
                    ctx.lineTo(x1, y1 + dy);
                });
                ctx.stroke();
            }
            ctx.setLineDash([]);
        };

        if (c.reach) {
            // The mover's own tile counts as inside, so the edge doesn't box them in.
            const { move, dash, at } = c.reach, inMove = has([...move, ...(at ? [at] : [])]), inAll = has([...move, ...dash, ...(at ? [at] : [])]);
            // Dash's band: a faint tint and a diagonal hatch, so it reads apart from Move's without its colour.
            ctx.fillStyle = RUN;
            for (const p of dash) ctx.fillRect(left(p), top(p), S, S);
            ctx.fillStyle = RUN_HATCH;
            for (const p of dash) {
                const x = left(p), y = top(p);
                // Lines at 45°, every 8 UI pixels, continuing across neighbouring tiles.
                for (let k = 0; k < S; k++) {
                    const off = (((x + y + S - 1 - k) % 8) + 8) % 8;
                    for (let t = (8 - off) % 8; t < S; t += 8) ctx.fillRect(x + t, y + S - 1 - k, 1, 1);
                }
            }
            ctx.fillStyle = WALK;
            for (const p of move) ctx.fillRect(left(p), top(p), S, S);
            // The range's outer edge, dashed gold; then Move's edge, solid steel blue: where a step costs a second action.
            stroke(dash, inAll, RUN_EDGE, 2, [6, 4]);
            stroke(move, inMove, WALK_EDGE, 2, []);
        }

        if (c.noise?.length) {
            ctx.fillStyle = NOISE_FILL;
            for (const p of c.noise) ctx.fillRect(left(p), top(p), S, S);
            stroke(c.noise, has(c.noise), NOISE, 3, [2, 2]);
        }

        for (const intent of c.intents ?? []) {
            const points = [intent.from, ...intent.path].map(mid);
            ctx.lineWidth = 2;
            ctx.setLineDash(intent.predicted ? [2, 6] : [4, 4]);
            for (const [colour, dy] of [[INK, 2], [intent.predicted ? INTENT_PREDICTED : INTENT, 0]] as const) {
                ctx.strokeStyle = colour;
                ctx.beginPath();
                points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y + dy) : ctx.moveTo(x, y + dy)));
                ctx.stroke();
            }
            ctx.setLineDash([]);
            // The pin: a ring where the walk ends.
            const [x, y] = points.at(-1)!;
            ctx.strokeStyle = INK;
            ctx.strokeRect(x - 4, y - 3, 8, 8);
            ctx.strokeStyle = INTENT;
            ctx.strokeRect(x - 4, y - 5, 8, 8);
        }

        ctx.font = '600 10px ui-monospace, Menlo, Consolas, monospace';
        ctx.textAlign = 'center';
        for (const g of c.ghosts ?? []) {
            const [x] = mid(g.pos), y = top(g.pos) - 30, text = `seen ${g.seenAgo} turn${g.seenAgo === 1 ? '' : 's'} ago`;
            ctx.fillStyle = INK;
            ctx.fillText(text, x, y + 2);
            ctx.fillStyle = INTENT;
            ctx.fillText(text, x, y);
        }

        if (c.from && c.path?.length) {
            const points = [c.from, ...c.path].map(mid), bad = c.badFrom ?? Infinity;
            const segment = (i: number, colour: string, dy: number) => {
                ctx.strokeStyle = colour;
                ctx.beginPath();
                ctx.moveTo(points[i]![0], points[i]![1] + dy);
                ctx.lineTo(points[i + 1]![0], points[i + 1]![1] + dy);
                ctx.stroke();
            };
            ctx.lineWidth = 2;
            ctx.lineCap = 'square';
            // A hairline with a 1px ink drop shadow (UI.md "Visual language").
            for (let i = 0; i < points.length - 1; i++) segment(i, INK, 2);
            for (let i = 0; i < points.length - 1; i++) segment(i, i >= bad ? RED : CREAM, 0);
            for (let i = 1; i < points.length - 1; i++) {
                const [x, y] = points[i]!;
                ctx.fillStyle = INK;
                ctx.fillRect(x - 2, y, 4, 4);
                ctx.fillStyle = i - 1 >= bad ? RED : CREAM;
                ctx.fillRect(x - 2, y - 2, 4, 4);
            }
            const end = c.path.at(-1)!, x = left(end), y = top(end), endColour = c.path.length - 1 >= bad ? RED : c.colour;
            ctx.strokeStyle = INK;
            ctx.strokeRect(x + 3, y + 4, S - 6, S - 6);
            ctx.strokeStyle = endColour;
            ctx.strokeRect(x + 3, y + 3, S - 6, S - 6);
            if (c.dash) ctx.strokeRect(x + 7, y + 7, S - 14, S - 14);
        }
    }
}
