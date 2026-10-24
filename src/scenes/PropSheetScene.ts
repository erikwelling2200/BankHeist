import Phaser from 'phaser';
import { LOOKS, PERSON_HEADINGS, personViews } from '../art/bank/people';
import { propArt, type PropArt } from '../art/bank/props';
import { Turn } from '../art/bank/view';
import { PAL } from '../art/palette';
import { PixelBitmap } from '../art/PixelBitmap';
import { CATALOG, propBox, propSize } from '../level/catalog';
import { TILE } from '../level/constants';
import type { LevelProp } from '../level/plan';
import { baseLine, drawLine, FACINGS, frontRow, GLOW_DEPTH, PERSON_SIZE, supportOf, turned, type Box, type Facing } from '../level/space';

const GAP = 10;
/** The tallest a block of rows gets before the sheet starts another beside it. */
const MAX_BLOCK_HEIGHT = 1100;

/** A prop drawn on the sheet: its art, the box it fills and where it comes in the drawing order. */
interface Piece { art: PropArt; box: Box; order: number; under?: Box }

/** One row of the sheet: a name and the same thing turned to face south, east, north and west (people: all eight ways). */
interface Row { label: string; cells: Piece[][] }

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

/** A thing on a top: where its middle is in the own frame of what it stands on, and which way it faces in that frame. */
interface OnTop { kind: LevelProp['kind']; x: number; y: number; facing: Facing }

/** The whole second tier in a row along a meeting table, fronts towards the table's front. */
const ON_TABLE: OnTop[] = [
    { kind: 'monitor', x: 5.5, y: 8.5, facing: 'south' }, { kind: 'deskLamp', x: 11, y: 8.5, facing: 'south' },
    { kind: 'paperStack', x: 16.5, y: 9, facing: 'south' }, { kind: 'mug', x: 21, y: 9, facing: 'south' },
    { kind: 'photoFrame', x: 24.5, y: 9, facing: 'south' }, { kind: 'cashCounter', x: 29.5, y: 9, facing: 'south' },
    { kind: 'microwave', x: 35, y: 9, facing: 'south' }, { kind: 'cake', x: 41, y: 9, facing: 'south' }
];

/** A manager's desk with its own monitor, lamp and papers, and a photo turned to the chair, a note counter and a mug. */
const ON_DESK: OnTop[] = [
    { kind: 'cashCounter', x: 10.5, y: 7.5, facing: 'north' }, { kind: 'photoFrame', x: 14, y: 5, facing: 'north' }, { kind: 'mug', x: 17.5, y: 7.5, facing: 'south' }
];

/** A single prop standing on the floor, its footprint's north-west corner at the origin. */
function alone(p: LevelProp, facing: Facing): Piece[] {
    const size = propSize(p), box = { x: 0, y: 0, z: 0, ...turned(size, facing), facing };
    return [{ art: propArt(p, size, facing), box, order: baseLine(box) }];
}

/**
 * A table turned to `facing` with things standing on its top, placed by their boxes as a level would place them and
 * ordered with the scene's own rule, so the sheet shows how a dressed desk looks in the bank.
 */
function dressed(under: LevelProp, items: OnTop[], facing: Facing): Piece[] {
    const support = propBox({ ...under, facing }, []), t = new Turn(propSize(under), facing);
    const pieces: Piece[] = [{ art: propArt(under, propSize(under), facing), box: support, order: baseLine(support) }];
    for (const item of items) {
        const own = FACINGS[(FACINGS.indexOf(item.facing) + FACINGS.indexOf(facing)) % 4]!;
        const p = { kind: item.kind, tx: 0, ty: 0, facing: own, elevation: support.h } as LevelProp, size = propSize(p), footprint = turned(size, own);
        const [x, y] = t.point(item.x, item.y);
        const box = { x: Math.round(support.x + x - footprint.w / 2), y: Math.round(support.y + y - footprint.d / 2), z: support.z + support.h, ...footprint, facing: own };
        const under = supportOf(box, [support]);
        pieces.push({ art: propArt(p, size, own), box, under, order: drawLine(box, under) });
    }
    return pieces;
}

/** Every look of the cast standing in their box, turned s, se, e, ne, n, nw, w, sw (left to right). */
function cast(): Row[] {
    return Object.entries(LOOKS).map(([label, spec]) => {
        const views = personViews(spec), box: Box = { x: 0, y: 0, z: 0, ...PERSON_SIZE, facing: 'south' };
        return {
            label, cells: PERSON_HEADINGS.map(h => {
                const lit = views[h], art = { lit, glow: new PixelBitmap(lit.width, lit.height), lights: [], originX: Math.round(lit.width / 2 - box.w / 2) };
                return [{ art, box, order: baseLine(box) }];
            })
        };
    });
}

/**
 * A review sheet: every prop in a row, turned to face south, east, north and west (left to right), lit from the
 * front-left on a plain floor with a tile grid for scale; at the end, the second tier standing on a meeting table and a
 * desk. Open it with `?scene=props`; `?scene=props&cast` shows the cast instead, each look in its eight headings.
 */
export class PropSheetScene extends Phaser.Scene {
    private sheetWidth = 0;
    private sheetHeight = 0;
    private layout: { label: string; top: number; bottom: number; cells: [number, number][] }[] = [];

    constructor() {
        super('props');
    }

    create(): void {
        this.lights.enable().setAmbientColor(0x9a98a8);
        const rows: Row[] = new URLSearchParams(location.search).has('cast') ? cast() : [
            ...samples().map(p => ({ label: p.kind, cells: FACINGS.map(f => alone(p, f)) })),
            { label: 'meetingTable dressed', cells: FACINGS.map(f => dressed({ kind: 'meetingTable', tx: 0, ty: 0 }, ON_TABLE, f)) },
            { label: 'desk dressed', cells: FACINGS.map(f => dressed({ kind: 'desk', tx: 0, ty: 0 }, ON_DESK, f)) }
        ];
        // Each cell's extent round its pieces' bitmaps, in the coordinates their boxes stand in.
        const bounds = rows.map(r => r.cells.map(pieces => {
            const lefts = pieces.map(({ art, box }) => box.x - art.originX), tops = pieces.map(({ art, box, under }) => frontRow(box, under) - art.lit.height);
            return {
                left: Math.min(...lefts), top: Math.min(...tops),
                right: Math.max(...pieces.map(({ art }, i) => lefts[i]! + art.lit.width)), bottom: Math.max(...pieces.map(({ art }, i) => tops[i]! + art.lit.height))
            };
        }));
        const columns = rows[0]!.cells.map((_, c) => Math.max(...bounds.map(r => r[c]!.right - r[c]!.left)) + GAP);
        const heights = bounds.map(r => Math.max(...r.map(b => b.bottom - b.top)) + GAP);
        // Rows run down in blocks side by side, so the sheet shot at three screen pixels to one stays inside a canvas.
        const blockWidth = columns.reduce((a, b) => a + b, 0), total = heights.reduce((a, b) => a + b, 0);
        const blocks = Math.ceil(total / MAX_BLOCK_HEIGHT), target = total / blocks;
        const blockOf: number[] = [];
        heights.reduce((above, h, r) => {
            const block = Math.min(blocks - 1, Math.floor((above + h / 2) / target));
            blockOf[r] = block;
            return above + h;
        }, 0);
        this.sheetWidth = GAP + blocks * blockWidth;
        this.sheetHeight = GAP + Math.max(...Array.from({ length: blocks }, (_, b) => heights.filter((_, r) => blockOf[r] === b).reduce((a, h) => a + h, 0)));

        this.add.rectangle(0, 0, this.sheetWidth, this.sheetHeight, PAL.linoleum[2]).setOrigin(0, 0);
        const grid = this.add.graphics().lineStyle(1, PAL.linoleum[1], 1);
        for (let x = 0; x <= this.sheetWidth; x += TILE) grid.lineBetween(x + 0.5, 0, x + 0.5, this.sheetHeight);
        for (let y = 0; y <= this.sheetHeight; y += TILE) grid.lineBetween(0, y + 0.5, this.sheetWidth, y + 0.5);

        const tops = Array.from({ length: blocks }, () => GAP);
        let key = 0;
        this.layout = [];
        rows.forEach((row, r) => {
            const block = blockOf[r]!, top = tops[block]!, bottom = top + heights[r]! - GAP, cells: [number, number][] = [];
            let left = GAP + block * blockWidth;
            row.cells.forEach((pieces, c) => {
                const b = bounds[r]![c]!, dx = left - b.left, dy = bottom - b.bottom;
                for (const { art, box, order, under } of pieces) {
                    const name = `sheet-${key++}`, x = dx + box.x - art.originX, y = dy + frontRow(box, under) - art.lit.height;
                    if (!this.textures.exists(name)) art.lit.addTo(this.textures, name);
                    if (!this.textures.exists(`${name}-glow`)) art.glow.addTo(this.textures, `${name}-glow`);
                    // Above the floor and its grid, in the order the bank draws them.
                    this.add.image(x, y, name).setOrigin(0, 0).setLighting(true).setDepth(1 + order);
                    this.add.image(x, y, `${name}-glow`).setOrigin(0, 0).setDepth(1 + order + GLOW_DEPTH);
                }
                cells.push([left, left + b.right - b.left]);
                left += columns[c]!;
            });
            this.layout.push({ label: row.label, top, bottom, cells });
            tops[block] = top + heights[r]!;
        });
        // A key light from the front-left and a fill, so tops and faces read apart in every orientation.
        this.lights.addLight(-40, this.sheetHeight / 2, this.sheetWidth * 2, 0xfff0d8, 0.9, 120);
        this.lights.addLight(this.sheetWidth + 40, this.sheetHeight, this.sheetWidth * 2, 0xd8e0ff, 0.35, 120);
        // The game is as big as the sheet, so the whole sheet is in view. EXPAND sizes the canvas from the game config, and
        // would undo a plain `setGameSize`.
        const config = this.game.config as unknown as { width: number; height: number };
        config.width = this.sheetWidth;
        config.height = this.sheetHeight;
        this.scale.refresh();
        this.cameras.main.setSize(this.sheetWidth, this.sheetHeight).setBounds(0, 0, this.sheetWidth, this.sheetHeight).setRoundPixels(true);
    }

    /** Exposed so automated tests can size the canvas to the whole sheet and find each row's cells on it. */
    get debugState() {
        return { ready: true, width: this.sheetWidth, height: this.sheetHeight, rows: this.layout };
    }
}
