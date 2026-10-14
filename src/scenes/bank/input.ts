import Phaser from 'phaser';

/**
 * Play mode's taps and drags on the map (UI.md "Touch grammar"): a tap is a press that neither moves nor lasts; a drag
 * that starts where `claim` says (on the selected crew member) draws a path instead of panning; a press held still is a
 * long-press. Every other drag, and any pinch, is the camera's. Points are map pixels.
 */

/** How far (CSS pixels) a finger may move and still tap, and how long a press may last. */
const TAP_SLOP = 10;
const LONG_PRESS_MS = 450;

export interface MapGestures {
    /** A tap at map point (x, y). */
    tap(x: number, y: number): void;
    /** A press starting at (x, y): true claims the drag that follows as a path. */
    claim(x: number, y: number): boolean;
    /** The claimed drag moved to (x, y). */
    drag(x: number, y: number): void;
    /** The claimed drag ended (`cancelled` when a second finger turned it into a pinch). */
    release(cancelled: boolean): void;
    /** A press held still at (x, y): "why" (UI.md). */
    longPress?(x: number, y: number): void;
}

export class MapInput {
    private down?: { id: number; x: number; y: number; at: number; moved: boolean; claimed: boolean; screenX: number; screenY: number };
    /** The pointers down now, by id: a set, so an up the page never delivered can't leave a phantom finger behind. */
    private readonly fingers = new Set<number>();
    /** The long-press timer, in wall-clock time: what the finger feels, however slowly the game's frames come. */
    private longTimer?: number;

    constructor(scene: Phaser.Scene, private readonly gestures: MapGestures) {
        const { input } = scene;
        input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
        input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
        input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
        input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
        scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.clearTimeout(this.longTimer));
    }

    /** Whether a path is being drawn: the camera mustn't pan meanwhile. */
    get drawing(): boolean {
        return !!this.down?.claimed;
    }

    private onDown(p: Phaser.Input.Pointer): void {
        this.fingers.add(p.id);
        if (this.fingers.size > 1 || p.rightButtonDown()) {
            this.cancel();
            return;
        }
        const { x, y } = this.css(p);
        this.down = { id: p.id, x: p.worldX, y: p.worldY, at: performance.now(), moved: false, claimed: this.gestures.claim(p.worldX, p.worldY), screenX: x, screenY: y };
        window.clearTimeout(this.longTimer);
        this.longTimer = window.setTimeout(() => {
            const d = this.down;
            if (d && !d.moved && !d.claimed) {
                this.gestures.longPress?.(d.x, d.y);
                this.down = undefined;
            }
        }, LONG_PRESS_MS);
    }

    private onMove(p: Phaser.Input.Pointer): void {
        const d = this.down;
        if (!d || d.id !== p.id || !p.isDown) return;
        const { x, y } = this.css(p);
        if (Math.hypot(x - d.screenX, y - d.screenY) > TAP_SLOP) d.moved = true;
        if (d.claimed && d.moved) this.gestures.drag(p.worldX, p.worldY);
    }

    private onUp(p: Phaser.Input.Pointer): void {
        this.fingers.delete(p.id);
        const d = this.down;
        window.clearTimeout(this.longTimer);
        if (!d || d.id !== p.id) return;
        this.down = undefined;
        if (d.claimed && d.moved) {
            this.gestures.release(false);
            return;
        }
        if (d.claimed) this.gestures.release(true);
        if (!d.moved && performance.now() - d.at < LONG_PRESS_MS) this.gestures.tap(d.x, d.y);
    }

    private cancel(): void {
        if (this.down?.claimed) this.gestures.release(true);
        this.down = undefined;
        window.clearTimeout(this.longTimer);
    }

    /** The pointer in CSS pixels: a finger's slop doesn't depend on the zoom. */
    private css(p: Phaser.Input.Pointer): { x: number; y: number } {
        const e = p.event as MouseEvent | TouchEvent | undefined;
        if (e && 'changedTouches' in e) {
            const t = [...e.touches, ...e.changedTouches].find(t => t.identifier === p.identifier);
            if (t) return { x: t.clientX, y: t.clientY };
        }
        if (e && 'clientX' in e) return { x: e.clientX, y: e.clientY };
        return { x: p.x, y: p.y };
    }
}
