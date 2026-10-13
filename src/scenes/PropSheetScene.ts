import Phaser from 'phaser';
import { propArt } from '../art/bank/props';
import { PAL } from '../art/palette';
import { CATALOG, propSize } from '../level/catalog';
import { TILE } from '../level/level';
import type { LevelProp } from '../level/plan';
import { FACINGS } from '../level/space';

const GAP = 10;

/** One of every kind of prop, with small parameters where a kind takes them. */
function samples(): LevelProp[] {
    return (Object.keys(CATALOG) as LevelProp['kind'][]).map((kind): LevelProp => {
        switch (kind) {
            case 'counter': return { kind, tx: 0, ty: 0, width: 4, stations: [0, 2], closed: [2], gate: 3 };
            case 'backCounter': return { kind, tx: 0, ty: 0, width: 2 };
            case 'queueRail': return { kind, tx: 0, ty: 0, length: 2 };
            default: return { kind, tx: 0, ty: 0 } as LevelProp;
        }
    });
}

/**
 * A review sheet: every prop in a row, turned to face south, east, north and west (left to right), lit from the
 * front-left on a plain floor with a tile grid for scale. Open it with `?scene=props`.
 */
export class PropSheetScene extends Phaser.Scene {
    private sheetWidth = 0;
    private sheetHeight = 0;

    constructor() {
        super('props');
    }

    create(): void {
        this.lights.enable().setAmbientColor(0x9a98a8);
        const rows = samples().map((p, i) => ({ key: `sheet-${i}`, arts: FACINGS.map(f => propArt(p, propSize(p), f)) }));
        const columns = FACINGS.map((_, c) => Math.max(...rows.map(r => r.arts[c]!.lit.width)) + GAP);
        this.sheetWidth = columns.reduce((a, b) => a + b, GAP);
        const heights = rows.map(r => Math.max(...r.arts.map(a => a.lit.height)) + GAP);
        this.sheetHeight = heights.reduce((a, b) => a + b, GAP);

        this.add.rectangle(0, 0, this.sheetWidth, this.sheetHeight, PAL.linoleum[2]).setOrigin(0, 0);
        const grid = this.add.graphics().lineStyle(1, PAL.linoleum[1], 1);
        for (let x = 0; x <= this.sheetWidth; x += TILE) grid.lineBetween(x + 0.5, 0, x + 0.5, this.sheetHeight);
        for (let y = 0; y <= this.sheetHeight; y += TILE) grid.lineBetween(0, y + 0.5, this.sheetWidth, y + 0.5);

        let top = GAP;
        rows.forEach((row, r) => {
            const bottom = top + heights[r]! - GAP;
            let left = GAP;
            row.arts.forEach((art, c) => {
                const key = `${row.key}-${FACINGS[c]}`;
                if (!this.textures.exists(key)) art.lit.addTo(this.textures, key);
                if (!this.textures.exists(`${key}-glow`)) art.glow.addTo(this.textures, `${key}-glow`);
                const x = left, y = bottom - art.lit.height;
                this.add.image(x, y, key).setOrigin(0, 0).setLighting(true);
                this.add.image(x, y, `${key}-glow`).setOrigin(0, 0);
                left += columns[c]!;
            });
            top += heights[r]!;
        });
        // A key light from the front-left and a fill, so tops and faces read apart in every orientation.
        this.lights.addLight(-40, this.sheetHeight / 2, this.sheetWidth * 2, 0xfff0d8, 0.9, 120);
        this.lights.addLight(this.sheetWidth + 40, this.sheetHeight, this.sheetWidth * 2, 0xd8e0ff, 0.35, 120);
        this.cameras.main.setBounds(0, 0, this.sheetWidth, this.sheetHeight).setRoundPixels(true);
    }

    /** Exposed so automated tests can size the canvas to the whole sheet. */
    get debugState() {
        return { ready: true, width: this.sheetWidth, height: this.sheetHeight };
    }
}
