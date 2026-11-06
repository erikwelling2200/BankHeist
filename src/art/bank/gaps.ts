import { TILE } from '../../level/constants';
import { WALL_THICKNESS, type Wall, type WallKind } from '../../level/walls';
import { PAL, deepen } from '../palette';
import { PixelBitmap } from '../PixelBitmap';
import { wallArt, wallHeight, wallMargin, type WallLook } from './walls';

/*
 * A gap blown through a wall segment (M4-01, §14.2), drawn in the world's projection as the open doorway is
 * (doors.ts): the segment's own art at its cut with a ragged hole through it from the floor to its top, the floor beyond
 * showing through, broken stubs left at either end of the segment (their torn edges darker), and rubble of the wall's
 * own material lying on its footprint. The stubs follow the wall's real thickness and its cut height, since the hole is
 * cut out of the wall's own bitmap at each step; a north-south segment, seen edge-on, loses the middle of its section.
 */

/** The rubble's colours, by what the wall is built of: plaster's dust and chunks, brick's red, concrete's grey, glass's shards. */
function rubble(kind: WallKind): readonly number[] {
    if (kind === 'brick' || kind === 'brickPier') return [PAL.brick[2], PAL.brick[3], PAL.brick[4], PAL.concrete[3]];
    if (kind === 'concrete' || kind === 'pier' || kind === 'atm' || kind === 'thick' || kind === 'doorService' || kind === 'doorBack' || kind === 'doorKeycard') {
        return [PAL.concrete[2], PAL.concrete[3], PAL.concrete[4], PAL.steel[2]];
    }
    if (kind === 'window' || kind === 'doorGlass' || kind === 'curtain' || kind === 'doorTower' || kind === 'tellerWindow') return [PAL.glass[3], PAL.glass[4], PAL.glass[5], PAL.steel[3]];
    if (kind === 'doorWood' || kind === 'boarded' || kind === 'shutter') return [PAL.walnut[2], PAL.walnut[3], PAL.plaster[3], PAL.plaster[4]];
    return [PAL.plaster[2], PAL.plaster[3], PAL.plaster[4], PAL.concrete[4]];
}

/** A small fixed hash of a segment and a number, in [0, 1): the same gap every time it is drawn. */
function jitter(wall: Wall, k: number): number {
    let h = (wall.tx * 73856093) ^ (wall.ty * 19349663) ^ (k * 83492791) ^ (wall.run === 'eastWest' ? 0x5bd1e995 : 0);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** The hole's columns at height z along the run: from `lo` to `hi` inclusive, ragged, a stub of 1–3 pixels at either end. */
function holeAt(wall: Wall, z: number): [number, number] {
    const band = Math.floor(z / 3);
    return [1 + Math.floor(jitter(wall, band) * 3), TILE - 2 - Math.floor(jitter(wall, band + 101) * 3)];
}

/**
 * The segment cut at `cut` with a gap blown through it: same size and place as `wallArt`, so it stands in for the
 * segment's image at each step of the cut.
 */
export function gapWallArt(wall: Wall, look: WallLook, cut: number): PixelBitmap {
    const art = wallArt(wall, look, cut), height = wallHeight(wall.kind, cut), t = WALL_THICKNESS[wall.kind];
    const colours = rubble(wall.kind);
    const chunk = (k: number): number => colours[Math.floor(jitter(wall, k) * colours.length)]!;
    if (wall.run === 'eastWest') {
        const top = t;
        for (let z = 1; z <= height; z++) {
            const [lo, hi] = holeAt(wall, z), row = top + height - z;
            for (let u = lo; u <= hi; u++) art.clear(u, row);
            // The torn ends: the stubs' last columns darker.
            for (const u of [lo - 1, hi + 1]) if (art.opaque(u, row)) art.set(u, row, deepen(art.color(u, row), 0.35), 1);
        }
        // Through the section too: the hole runs to the wall's top, so nothing spans it.
        const [lo, hi] = holeAt(wall, height);
        for (let u = lo; u <= hi; u++) for (let v = 0; v < top; v++) art.clear(u, v);
        for (const u of [lo - 1, hi + 1]) for (let v = 0; v < top; v++) if (art.opaque(u, v)) art.set(u, v, deepen(art.color(u, v), 0.25), 1);
        // Rubble on the footprint at floor level (the last `t` rows), and a low heap a few pixels high in the hole.
        for (let u = 0; u < TILE; u++) {
            const heap = Math.floor(jitter(wall, 200 + u) * 3);
            for (let v = 0; v < t; v++) {
                const row = height + v;
                if (row >= art.height || art.opaque(u, row)) continue;
                if (jitter(wall, 300 + u * 7 + v) < 0.7) art.set(u, row, chunk(400 + u * 5 + v), 1 + heap);
            }
            for (let z = 1; z <= Math.min(heap, height - 1); z++) {
                const row = top + height - z;
                if (!art.opaque(u, row)) art.set(u, row, chunk(500 + u * 3 + z), z + 1);
            }
        }
        return art;
    }
    // North-south, edge-on: the section loses its middle, and rubble lies where its footprint meets the floor.
    const m = wallMargin(wall);
    const [lo, hi] = holeAt(wall, height);
    for (let u = lo; u <= hi; u++) for (let v = 0; v < t; v++) art.clear(m + v, u);
    for (const u of [lo - 1, hi + 1]) for (let v = 0; v < t; v++) if (art.opaque(m + v, u)) art.set(m + v, u, deepen(art.color(m + v, u), 0.3), 1);
    for (let u = lo; u <= hi; u++) for (let v = -1; v <= t; v++) {
        const x = m + v, row = u + height;
        if (x < 0 || x >= art.width || row >= art.height || art.opaque(x, row)) continue;
        if (jitter(wall, 600 + u * 5 + v) < 0.65) art.set(x, row, chunk(700 + u * 3 + v), 1);
    }
    return art;
}

/**
 * The debris a shaped charge leaves on the floor across its gap (§12.2: half cover): a low heap of the wall's own
 * material, about 0.6 m high, filling most of its tile, drawn in the world's projection (its top foreshortened). Its
 * bottom edge is the tile's south edge; it is `TILE` wide.
 */
export function debrisArt(wall: Wall): PixelBitmap {
    const colours = rubble(wall.kind), H = 7, D = 10;
    const art = new PixelBitmap(TILE, D + H);
    const chunk = (k: number): number => colours[Math.floor(jitter(wall, k) * colours.length)]!;
    // A heap: for each column a height that rises to the middle, ragged; its face lit by its slope.
    for (let u = 1; u < TILE - 1; u++) {
        const mid = 1 - Math.abs(u + 0.5 - TILE / 2) / (TILE / 2);
        const h = Math.max(1, Math.round(H * mid * (0.7 + 0.3 * jitter(wall, 800 + u))));
        for (let v = 2; v < D; v++) {
            const depth = 1 - Math.abs(v + 0.5 - D / 2) / (D / 2), z = Math.round(h * Math.min(1, depth * 1.6));
            if (z <= 0) continue;
            // The heap's top at depth row v and height z lands on row v + H - z; its south face below it.
            const row = v + H - z;
            art.set(u, row, chunk(900 + u * 11 + v), z);
            for (let r = row + 1; r <= v + H && r < art.height; r++) if (!art.opaque(u, r)) art.set(u, r, deepen(chunk(1000 + u * 7 + r), 0.25), Math.max(0, z - (r - row)));
        }
    }
    return art;
}
