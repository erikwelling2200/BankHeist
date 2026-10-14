import Phaser from 'phaser';
import { TILE } from '../../level/level';
import type { Pos } from '../../sim';

/**
 * The world UI layer (UI.md "Two layers"), as far as play mode needs it before M1-14: a canvas over the game's at twice
 * the art's resolution (one UI pixel is half an art pixel), redrawn after each frame from where the camera looked. It
 * shows the selected crew member's reach (faint) and the previewed or dragged path, ending on a tile outline in their
 * colour; a dragged path's steps past the first bad one are red. It takes no input: taps go through to the map.
 *
 * TODO(M1-14): safe-floor tints and glyphs, the eye icon, noise rings, badges; floor UI under the people.
 */

/** UI pixels per art pixel. */
const UI_SCALE = 2;

export interface OverlayContent {
    /** The crew colour (CSS). */
    colour: string;
    /** The tiles within Move's reach, and those only Dash reaches. */
    reach?: { move: Pos[]; dash: Pos[] };
    /** Where the path starts (the crew member's tile) and its steps. */
    from?: Pos;
    path?: Pos[];
    /** A dash: the end is marked twice. */
    dash?: boolean;
    /** The index of the first step that can't be taken; it and those after it are drawn red. */
    badFrom?: number;
    /** The NPCs' committed walks for the next world phase: a dotted line and a pin where each ends. */
    intents?: { from: Pos; path: Pos[] }[];
}

const SAGE = 'rgba(128, 190, 138, 0.16)';
const SAGE_EDGE = 'rgba(128, 190, 138, 0.35)';
const CREAM_FAINT = 'rgba(242, 230, 200, 0.07)';
const INK = 'rgba(13, 12, 20, 0.85)';
const CREAM = '#f2e6c8';
const RED = '#d44638';
const INTENT = 'rgba(242, 230, 200, 0.7)';

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
    get state(): { path: Pos[]; reach: number; dash: boolean; intents: number } {
        return { path: this.content?.path ?? [], reach: this.content?.reach?.move.length ?? 0, dash: !!this.content?.dash, intents: this.content?.intents?.length ?? 0 };
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

        if (c.reach) {
            ctx.fillStyle = CREAM_FAINT;
            for (const p of c.reach.dash) ctx.fillRect(left(p) + 1, top(p) + 1, S - 2, S - 2);
            ctx.fillStyle = SAGE;
            for (const p of c.reach.move) ctx.fillRect(left(p) + 1, top(p) + 1, S - 2, S - 2);
            // The edge of Move's reach, so where a step costs a second action shows.
            const inMove = new Set(c.reach.move.map(p => `${p.x},${p.y}`));
            ctx.fillStyle = SAGE_EDGE;
            for (const p of c.reach.move) {
                const x = left(p), y = top(p);
                if (!inMove.has(`${p.x},${p.y - 1}`)) ctx.fillRect(x, y, S, 2);
                if (!inMove.has(`${p.x},${p.y + 1}`)) ctx.fillRect(x, y + S - 2, S, 2);
                if (!inMove.has(`${p.x - 1},${p.y}`)) ctx.fillRect(x, y, 2, S);
                if (!inMove.has(`${p.x + 1},${p.y}`)) ctx.fillRect(x + S - 2, y, 2, S);
            }
        }

        for (const intent of c.intents ?? []) {
            const points = [intent.from, ...intent.path].map(mid);
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            for (const [colour, dy] of [[INK, 2], [INTENT, 0]] as const) {
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
