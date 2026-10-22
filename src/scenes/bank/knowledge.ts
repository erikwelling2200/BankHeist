import type Phaser from 'phaser';
import type { BankData } from '../../level/bankData';
import { TILE } from '../../level/constants';
import type { Heights } from './heights';
import { DEPTH } from './layers';
import type { ShownProp } from './props';

/** A question mark, five pixels by seven, for rooms the blueprint doesn't show. */
const QUESTION = [' ### ', '#   #', '    #', '   # ', '  #  ', '     ', '  #  '];
/** The block over what the player can't see, and its outline. */
const BLOCK = 0x1b1d27, EDGE = 0x8f866f;

/**
 * The knowledge layer (§17.8). In the viewer, while only what the blueprint knows is shown (`show`), the rooms it shows
 * only as outlines are drawn as grey blocks with a `?`, and the people in them are hidden as they walk. In play
 * (`showHidden`, decision 44), every hidden tile is an opaque block outlined where it meets what the player knows, a
 * room still wholly hidden carries the `?`, and the props on hidden tiles aren't drawn (play mode hides the people).
 * Unknown is drawn as unknown, never as empty.
 */
export class Knowledge {
    private overlay?: Phaser.GameObjects.Graphics;
    /** Whether only what the blueprint knows is shown. */
    private blueprintOnly = false;
    /** Play: the hidden tiles' block, and the hidden tiles (row-major, 1 = hidden) it was drawn for. */
    private veil?: Phaser.GameObjects.Graphics;
    private hidden?: { width: number; bits: Uint8Array };
    private props: readonly ShownProp[] = [];

    constructor(private readonly scene: Phaser.Scene, private readonly outlines: NonNullable<BankData['outlines']>, private readonly heights?: Heights) {
        // A raised room's block goes up and down with its floor.
        heights?.onChange(() => {
            if (this.blueprintOnly) this.show(false);
            if (this.hidden) this.drawHidden(this.hidden.width, this.hidden.bits);
        });
    }

    /** The props on screen, so play can leave those on hidden tiles undrawn. */
    trackProps(props: readonly ShownProp[]): void {
        this.props = props;
    }

    /** Shows everything (`full`) or only what the blueprint knows. */
    show(full: boolean): void {
        this.overlay?.destroy();
        this.overlay = undefined;
        this.blueprintOnly = !full;
        if (full) return;
        const g = this.scene.add.graphics().setDepth(DEPTH.knowledge);
        for (const r of this.outlines) {
            const inside = (x: number, y: number) => r.parts.some(p => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
            // A raised room is drawn lifted: its block is too, down over the face of the storey under it.
            const lift = (x: number, y: number) => this.heights?.lift(x, y) ?? 0;
            for (const p of r.parts) g.fillStyle(BLOCK, 0.94).fillRect(p.x * TILE, p.y * TILE - lift(p.x, p.y), p.w * TILE, p.h * TILE + lift(p.x, p.y + p.h - 1));
            // The outline follows the room's shape: a pixel line inside every edge of a tile with no room beyond it.
            g.fillStyle(EDGE, 0.9);
            for (const p of r.parts) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
                const top = y * TILE - lift(x, y);
                if (!inside(x, y - 1)) g.fillRect(x * TILE, top, TILE, 1);
                if (!inside(x, y + 1)) g.fillRect(x * TILE, top + TILE - 1, TILE, 1);
                if (!inside(x - 1, y)) g.fillRect(x * TILE, top, 1, TILE);
                if (!inside(x + 1, y)) g.fillRect((x + 1) * TILE - 1, top, 1, TILE);
            }
            this.question(g, r);
        }
        this.overlay = g;
    }

    /**
     * Play (decision 44): draws the tiles whose visibility code is hidden (0) as opaque blocks, and hides the props on
     * them. Drawn again only when the hidden tiles change; true when they did.
     */
    showHidden(visibility: Uint8Array, width: number): boolean {
        const bits = visibility.map(v => (v === 0 ? 1 : 0)), was = this.hidden;
        if (was && was.width === width && was.bits.length === bits.length && was.bits.every((b, i) => b === bits[i])) return false;
        this.hidden = { width, bits };
        this.drawHidden(width, bits);
        const at = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < width && bits[ty * width + tx] === 1;
        for (const p of this.props) {
            const gone = at(p.tx, p.ty);
            for (const image of p.images) {
                // Its own alpha (a glow's pass is faint), kept before it is first hidden.
                if (image.getData('alpha') === undefined) image.setData('alpha', image.alpha);
                image.setAlpha(gone ? 0 : (image.getData('alpha') as number));
            }
        }
        return true;
    }

    private drawHidden(width: number, bits: Uint8Array): void {
        this.veil?.destroy();
        const g = (this.veil = this.scene.add.graphics().setDepth(DEPTH.knowledge)), height = bits.length / width;
        const hidden = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && bits[y * width + x] === 1;
        const lift = (x: number, y: number) => this.heights?.lift(x, y) ?? 0;
        g.fillStyle(BLOCK, 1);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            if (!hidden(x, y)) continue;
            // A raised tile's block reaches down over the face of the storey under it, unless the block below does.
            const up = lift(x, y), below = hidden(x, y + 1) ? lift(x, y + 1) : 0;
            g.fillRect(x * TILE, y * TILE - up, TILE, TILE + Math.max(0, up - below));
        }
        g.fillStyle(EDGE, 0.9);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            if (!hidden(x, y)) continue;
            const top = y * TILE - lift(x, y);
            if (!hidden(x, y - 1)) g.fillRect(x * TILE, top, TILE, 1);
            if (!hidden(x, y + 1)) g.fillRect(x * TILE, top + TILE - 1, TILE, 1);
            if (!hidden(x - 1, y)) g.fillRect(x * TILE, top, 1, TILE);
            if (!hidden(x + 1, y)) g.fillRect((x + 1) * TILE - 1, top, 1, TILE);
        }
        // A room nobody has seen into yet keeps its question mark.
        const whole = (p: { x: number; y: number; w: number; h: number }): boolean => {
            for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (!hidden(x, y)) return false;
            return true;
        };
        for (const r of this.outlines) if (r.parts.every(whole)) this.question(g, r);
    }

    /** A pixel question mark in the middle of a room's largest rectangle. */
    private question(g: Phaser.GameObjects.Graphics, r: NonNullable<BankData['outlines']>[number]): void {
        const lift = (x: number, y: number) => this.heights?.lift(x, y) ?? 0;
        const main = r.parts[0]!, cx = Math.floor((main.x + main.w / 2) * TILE) - 5, cy = Math.floor((main.y + main.h / 2) * TILE) - 7 - lift(main.x, main.y);
        g.fillStyle(EDGE, 1);
        QUESTION.forEach((row, y) => [...row].forEach((c, x) => c === '#' && g.fillRect(cx + x * 2, cy + y * 2, 2, 2)));
    }

    /** Whether someone standing at map point (x, y) is out of sight: in a room the blueprint only outlines, while only it shows. */
    hides(x: number, y: number): boolean {
        const inside = (r: { x: number; y: number; w: number; h: number }) => x >= r.x * TILE && x < (r.x + r.w) * TILE && y >= r.y * TILE && y < (r.y + r.h) * TILE;
        return this.blueprintOnly && this.outlines.some(r => r.parts.some(inside));
    }
}
