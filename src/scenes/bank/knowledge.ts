import type Phaser from 'phaser';
import type { BankData } from '../../level/bankData';
import { TILE } from '../../level/level';
import type { Heights } from './heights';
import { DEPTH } from './layers';

/** A question mark, five pixels by seven, for rooms the blueprint doesn't show. */
const QUESTION = [' ### ', '#   #', '    #', '   # ', '  #  ', '     ', '  #  '];

/**
 * The knowledge layer (§17.8): while only what the blueprint knows is shown, the rooms it shows only as outlines are
 * drawn as grey blocks with a `?`, and the people in them are hidden as they walk. Unknown is drawn as unknown, never
 * as empty.
 */
export class Knowledge {
    private overlay?: Phaser.GameObjects.Graphics;
    /** Whether only what the blueprint knows is shown. */
    private blueprintOnly = false;

    constructor(private readonly scene: Phaser.Scene, private readonly outlines: NonNullable<BankData['outlines']>, private readonly heights?: Heights) {
        // A raised room's block goes up and down with its floor.
        heights?.onChange(() => this.blueprintOnly && this.show(false));
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
            for (const p of r.parts) g.fillStyle(0x1b1d27, 0.94).fillRect(p.x * TILE, p.y * TILE - lift(p.x, p.y), p.w * TILE, p.h * TILE + lift(p.x, p.y + p.h - 1));
            // The outline follows the room's shape: a pixel line inside every edge of a tile with no room beyond it.
            g.fillStyle(0x8f866f, 0.9);
            for (const p of r.parts) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
                const top = y * TILE - lift(x, y);
                if (!inside(x, y - 1)) g.fillRect(x * TILE, top, TILE, 1);
                if (!inside(x, y + 1)) g.fillRect(x * TILE, top + TILE - 1, TILE, 1);
                if (!inside(x - 1, y)) g.fillRect(x * TILE, top, 1, TILE);
                if (!inside(x + 1, y)) g.fillRect((x + 1) * TILE - 1, top, 1, TILE);
            }
            // A pixel question mark in the middle of the room's largest rectangle.
            const main = r.parts[0]!, cx = Math.floor((main.x + main.w / 2) * TILE) - 5, cy = Math.floor((main.y + main.h / 2) * TILE) - 7 - lift(main.x, main.y);
            g.fillStyle(0x8f866f, 1);
            QUESTION.forEach((row, y) => [...row].forEach((c, x) => c === '#' && g.fillRect(cx + x * 2, cy + y * 2, 2, 2)));
        }
        this.overlay = g;
    }

    /** Whether someone standing at map point (x, y) is out of sight: in a room the blueprint only outlines, while only it shows. */
    hides(x: number, y: number): boolean {
        const inside = (r: { x: number; y: number; w: number; h: number }) => x >= r.x * TILE && x < (r.x + r.w) * TILE && y >= r.y * TILE && y < (r.y + r.h) * TILE;
        return this.blueprintOnly && this.outlines.some(r => r.parts.some(inside));
    }
}
