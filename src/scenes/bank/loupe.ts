import Phaser from 'phaser';
import type { WorldOverlay } from './overlay';

/** The loupe's size on the page (CSS pixels), how much it magnifies, and how far above the finger it sits. */
const SIZE = 120, MAGNIFY = 2, LIFT = 28;

/**
 * Aim mode's loupe (UI.md "Touch grammar": "Drag in aim mode … the loupe sits above the finger"): a round window above
 * the finger showing the aim point and what is round it, magnified, with the world UI (the cone, markers, cover) over
 * the game's picture, so the finger never hides what it aims at. Painted from the game's canvas and the overlay's just
 * after each frame is drawn (POST_RENDER, after the overlay's own drawing), so the WebGL picture is still there to copy.
 */
export class Loupe {
    readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    /** The aim point (map pixels), while shown. */
    private at: { x: number; y: number } | null = null;
    private readonly onRender = () => this.paint();

    constructor(private readonly scene: Phaser.Scene, private readonly overlay: WorldOverlay) {
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'aim-loupe';
        const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
        this.canvas.width = this.canvas.height = SIZE * dpr;
        Object.assign(this.canvas.style, { width: `${SIZE}px`, height: `${SIZE}px` });
        this.canvas.hidden = true;
        this.ctx = this.canvas.getContext('2d')!;
        this.ctx.imageSmoothingEnabled = false;
        document.body.append(this.canvas);
        scene.game.events.on(Phaser.Core.Events.POST_RENDER, this.onRender);
        scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    }

    /** Shows the loupe on map point (x, y), above the finger at page point (fx, fy). */
    show(x: number, y: number, fx: number, fy: number): void {
        this.at = { x, y };
        const left = Math.min(window.innerWidth - SIZE - 4, Math.max(4, fx - SIZE / 2));
        const top = fy - SIZE - LIFT >= 4 ? fy - SIZE - LIFT : fy + LIFT;
        Object.assign(this.canvas.style, { left: `${left}px`, top: `${top}px` });
        this.canvas.hidden = false;
    }

    hide(): void {
        this.at = null;
        this.canvas.hidden = true;
    }

    get shown(): boolean {
        return this.at !== null;
    }

    private paint(): void {
        if (!this.at) return;
        const { ctx, canvas } = this, W = canvas.width, [cx, cy] = this.overlay.toPage(this.at.x, this.at.y), half = SIZE / MAGNIFY / 2;
        ctx.fillStyle = '#0b0d17';
        ctx.fillRect(0, 0, W, W);
        // The same page square from each canvas: the game's picture, then the world UI over it.
        for (const source of [this.scene.game.canvas, this.overlay.canvas]) {
            const r = source.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            const kx = source.width / r.width, ky = source.height / r.height;
            ctx.drawImage(source, (cx - half - r.left) * kx, (cy - half - r.top) * ky, 2 * half * kx, 2 * half * ky, 0, 0, W, W);
        }
        // A fine crosshair on the aim point.
        ctx.strokeStyle = 'rgba(242, 230, 200, 0.9)';
        ctx.lineWidth = Math.max(1, W / SIZE);
        const m = W / 2, a = W * 0.06, b = W * 0.16;
        ctx.beginPath();
        ctx.moveTo(m - b, m); ctx.lineTo(m - a, m);
        ctx.moveTo(m + a, m); ctx.lineTo(m + b, m);
        ctx.moveTo(m, m - b); ctx.lineTo(m, m - a);
        ctx.moveTo(m, m + a); ctx.lineTo(m, m + b);
        ctx.stroke();
    }

    private destroy(): void {
        this.scene.game.events.off(Phaser.Core.Events.POST_RENDER, this.onRender);
        this.canvas.remove();
    }
}
