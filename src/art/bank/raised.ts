import { TILE } from '../../level/constants';
import type { FloorTile } from '../../level/plan';
import { PAL, mix } from '../palette';
import { PixelBitmap } from '../PixelBitmap';
import { NORMAL } from './view';
import { paintSupport, type SupportMaterial } from './walls';

/*
 * Raised floors (§14.7), drawn where they are and lifted up the screen by their height, as everything is: a point at
 * height z lands z rows up. A raised tile is its own floor, lifted; where it drops to lower floor on its south side with
 * no wall there (an open edge, a railing at most), it shows the face of what holds it up, from its edge down to the
 * floor below, painted by height like a wall. Stairs are drawn step by step as the flight climbs.
 */

/** What shows under the open south edge of a raised tile: the storey below it, by the floor it carries. */
export function slabMaterial(tile: FloorTile, below: FloorTile | undefined): SupportMaterial {
    if (below === 'z') return 'riser';
    switch (tile) {
        case 'j': return 'plaster';
        case 'k': return 'scaffold';
        case 'z': return 'riser';
        default: return 'concrete';
    }
}

/**
 * The face under a raised tile's open south edge, `height` rows from its edge down to the floor below, a tile wide. Under
 * a scaffold's deck it is in deep shade between the tubes.
 */
export function slabFace(material: SupportMaterial, height: number): PixelBitmap {
    const b = new PixelBitmap(TILE, height);
    paintSupport((u, z, c, h, alpha) => {
        b.set(u, height - z, c, h, alpha);
        b.setNormal(u, height - z, NORMAL.face[0], NORMAL.face[1], NORMAL.face[2]);
    }, material, height);
    if (material === 'scaffold') for (let y = 0; y < height; y++) for (let x = 0; x < TILE; x++) {
        if (!b.opaque(x, y)) b.set(x, y, mix(PAL.concrete[0], PAL.ink, 0.4), 0.1);
    }
    return b;
}

/** Steps a stair tile climbs: five to a tile (about 26cm treads), as the floor tile's own drawing has them. */
const STEPS = 5;

/**
 * A tile of a flight of stairs climbing north, its north edge at `top` and its south edge down at `bottom` (the floor
 * south of it), drawn in the projection: each tread, its nosing catching the light, and the riser below it facing the
 * camera, the stringers either side where the flight ends (a wide flight runs on across tiles). The bitmap's bottom edge is the tile's south edge on the floor below; its top row
 * is the north edge of the highest tread.
 */
export function stairTile(top: number, bottom: number, stringers: { west: boolean; east: boolean } = { west: true, east: true }): PixelBitmap {
    const b = new PixelBitmap(TILE, TILE + top - bottom), rise = (top - bottom) / STEPS;
    const tread = (y: number) => Math.min(STEPS - 1, Math.floor((y * STEPS) / TILE));
    const heightAt = (y: number) => top - Math.round(tread(y) * rise);
    for (let j = 0; j < b.height; j++) for (let x = 0; x < TILE; x++) {
        // Screen row j shows points (y, z) with y - z = j - top: from the top down, the first one under the stairs.
        for (let z = top; z >= bottom - 0.5; z -= 0.5) {
            const y = j - top + z;
            if (y >= TILE) continue;
            if (y < 0) break;
            if (z > heightAt(y) + 0.25) continue;
            const onTread = z > heightAt(y) - 0.75, k = tread(y), front = Math.floor(((k + 1) * TILE) / STEPS) - 1;
            const stringer = (x === 0 && stringers.west) || (x === TILE - 1 && stringers.east);
            const colour = stringer ? PAL.concrete[1] : onTread ? (Math.floor(y) >= front ? PAL.concrete[5] : PAL.concrete[4]) : PAL.concrete[2];
            b.set(x, j, colour, onTread ? 0.6 : 0.3);
            const n = onTread ? NORMAL.top : NORMAL.face;
            b.setNormal(x, j, n[0], n[1], n[2]);
            break;
        }
    }
    return b;
}
