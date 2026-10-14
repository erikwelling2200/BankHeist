import type Phaser from 'phaser';
import { bakeLighting } from '../../art/bank/lamps';
import { slabFace, slabMaterial, stairTile } from '../../art/bank/raised';
import { TILE } from '../../level/level';
import type { Level } from '../../level/plan';
import { AMBIENT, EVERYWHERE, type AtlasPiece, type Baker } from './bake';
import { STOREY_STEPS, type Heights } from './heights';
import { DEPTH, KEY, RAISED_DEPTH } from './layers';

/** Edges that leave a raised floor's south side open, so its face shows: none, or a railing or fence on it. */
const OPEN_EDGES = new Set(['rail', 'fence']);

/**
 * Raised floors drawn as what they are, a storey up (§14.7): each raised tile and stair an image of its own, lifted up the
 * screen by its height as its region is drawn now and ordered just after anything on the floor behind its north edge, so
 * the floor behind it hides behind it and whatever stands on it comes after it. Its top is the floor as baked (lit, with
 * its shade), its open south edge shows the storey below it down to the lower floor, and stairs are drawn step by step.
 * Each is baked at every storey step of `STOREY_STEPS`, lit like a wall facing the floor in front of it.
 */
export class RaisedFloors {
    private readonly tiles: { tx: number; ty: number; region: number; image: Phaser.GameObjects.Image; frames: string[] }[] = [];

    constructor(private readonly scene: Phaser.Scene, private readonly level: Level, private readonly heights: Heights) {
        heights.onChange(region => {
            for (const t of this.tiles) if (t.region === region) this.place(t);
        });
    }

    /** `floor` is the floor as baked (RGBA, the whole map), `shade` the shade multiplied over it. */
    build(baker: Baker, floor: Uint8ClampedArray, shade: Uint8ClampedArray): void {
        const { tiles, walls } = this.level, h = this.heights, width = tiles[0]!.length * TILE;
        if (h.count === 0) return;
        const closed = new Set(walls.filter(w => w.run === 'eastWest' && !OPEN_EDGES.has(w.kind)).map(w => `${w.tx} ${w.ty}`));
        const fresh = !this.scene.textures.exists(KEY.raised), pieces: AtlasPiece[] = [];
        const placed: { tx: number; ty: number; region: number; frames: string[] }[] = [];
        tiles.forEach((row, ty) => row.forEach((tile, tx) => {
            const region = h.region(tx, ty);
            if (region < 0) return;
            const below = tiles[ty + 1]?.[tx], open = below !== undefined && !closed.has(`${tx} ${ty + 1}`);
            const x0 = tx * TILE, y0 = ty * TILE;
            // The floor in front of the tile's south edge, which its face looks onto, and the tile itself.
            const front: [number, number][] = [[x0 + 2, y0 + TILE + 0.5], [x0 + 8, y0 + TILE + 0.5], [x0 + 14, y0 + TILE + 0.5]];
            const frames: string[] = [];
            let last: string | undefined, lastKey = '';
            STOREY_STEPS.forEach((_, s) => {
                const lift = h.liftAtStep(tx, ty, s), drop = open ? Math.max(0, lift - h.liftAtStep(tx, ty + 1, s)) : 0;
                const stairs = tile === 'z', key = stairs ? `z${lift}-${drop}` : `${drop}`;
                if (last !== undefined && key === lastKey) { frames.push(last); return; }
                const frame = `${tx}-${ty}-${s}`;
                frames.push((last = frame));
                lastKey = key;
                if (!fresh) return;
                if (stairs) {
                    const art = stairTile(lift, lift - drop, { west: row[tx - 1] !== 'z', east: row[tx + 1] !== 'z' }), points: [number, number][] = [[x0 + 8, y0 + 8], ...front];
                    const rgba = bakeLighting(art, x0, y0 + TILE - art.height, AMBIENT, baker.lampsReaching(points), EVERYWHERE, baker.standingAt(x0 + 8, y0 + 8));
                    pieces.push({ frame, rgba, w: TILE, h: art.height });
                    return;
                }
                const rgba = new Uint8ClampedArray(TILE * (TILE + drop) * 4);
                // The top: the floor as baked, its shade multiplied in, as the shade layer does on the ground.
                for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
                    const from = ((y0 + j) * width + x0 + i) * 4, to = (j * TILE + i) * 4;
                    for (let c = 0; c < 3; c++) rgba[to + c] = Math.round((floor[from + c]! * shade[from + c]!) / 255);
                    rgba[to + 3] = 255;
                }
                if (drop > 0) {
                    const face = slabFace(slabMaterial(tile, below), drop);
                    const lit = bakeLighting(face, x0, y0 + TILE - drop, AMBIENT, baker.lampsReaching(front), EVERYWHERE, baker.standingAt(x0 + 8, y0 + TILE + 0.5));
                    rgba.set(lit, TILE * TILE * 4);
                }
                pieces.push({ frame, rgba, w: TILE, h: TILE + drop });
            });
            placed.push({ tx, ty, region, frames });
        }));
        if (fresh) baker.packAtlas(KEY.raised, pieces);
        for (const p of placed) {
            // Just after anything standing on the floor behind its north edge, and before anything standing on it.
            const image = this.scene.add.image(p.tx * TILE, p.ty * TILE, KEY.raised, p.frames[0]!).setOrigin(0, 0).setDepth(DEPTH.standing + p.ty * TILE + RAISED_DEPTH);
            const t = { ...p, image };
            this.tiles.push(t);
            this.place(t);
        }
    }

    private place(t: RaisedFloors['tiles'][number]): void {
        const s = this.heights.step(t.region);
        t.image.setFrame(t.frames[s]!).setY(t.ty * TILE - this.heights.liftAtStep(t.tx, t.ty, s));
    }
}
