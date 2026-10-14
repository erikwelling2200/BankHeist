import { BANK_TILE_INDEX, bankTileset, type BankTileName } from '../../art/bank/tiles';
import { doorSill } from '../../art/bank/walls';
import { deepen, mix, PAL } from '../../art/palette';
import { PixelBitmap } from '../../art/PixelBitmap';
import { TILE } from '../../level/level';
import { floorHeight, type Level } from '../../level/plan';
import { wallFootprint } from '../../level/walls';
import { bakeLighting } from '../../art/bank/lamps';
import { AMBIENT, type Baker } from './bake';
import { DEPTH, KEY } from './layers';
import type { PlacedProp } from './props';

/** How much the floor darkens beside the east or west edge of a raised floor, from the foot of the drop outwards. */
const EDGE_SHADOW = [0.55, 0.4, 0.27, 0.15, 0.06];

/**
 * The floor as one image: every tile, with flat props (mats, a manhole cover) laid into it, lit per pixel by the lamps
 * that reach it and exposed for indoors or out. Returns it as baked, for the raised floors (raised.ts), which are drawn
 * lifted from it.
 */
export function addFloor(baker: Baker, level: Level, flat: PlacedProp[]): Uint8ClampedArray {
    const tiles = bankTileset(), floor = new PixelBitmap(level.tiles[0]!.length * TILE, level.tiles.length * TILE);
    // Copied a tile row at a time, the floor being a million pixels or more; every one is opaque.
    level.tiles.forEach((row, y) => row.forEach((_, x) => {
        const index = BANK_TILE_INDEX[tileName(level, x, y)];
        for (let j = 0; j < TILE; j++) {
            const from = j * tiles.width + index * TILE, to = (y * TILE + j) * floor.width + x * TILE;
            floor.colors.set(tiles.colors.subarray(from * 4, (from + TILE) * 4), to * 4);
            floor.heights.set(tiles.heights.subarray(from, from + TILE), to);
            for (let i = 0; i < TILE; i++) floor.colors[(to + i) * 4 + 3] = 255;
        }
    }));
    // Thresholds under the doors in north-south walls: seen side-on, the door itself barely shows.
    for (const wall of level.walls) {
        const sill = doorSill(wall), f = wallFootprint(wall);
        if (sill !== undefined) for (let y = f.y + 1; y < f.y + f.d - 1; y++) for (let x = f.x - 3; x < f.x + f.w + 3; x++) {
            const edge = x === f.x - 3 || x === f.x + f.w + 2 || y === f.y + f.d - 2;
            floor.set(x, y, edge ? mix(sill, PAL.ink, 0.45) : sill, 1);
        }
    }
    drawRaisedEdges(level, floor);
    for (const { art, left, top } of flat) floor.stamp(art.lit, left, top);
    const rgba = bakeLighting(floor, 0, 0, AMBIENT, baker.lamps, baker.reach, baker.exposure);
    if (!baker.scene.textures.exists(KEY.floor)) baker.addPixels(KEY.floor, rgba, floor.width, floor.height);
    baker.scene.add.image(0, 0, KEY.floor).setOrigin(0, 0).setDepth(DEPTH.floor);
    return rgba;
}

/** The floor of every tile; walls stand on top of it along the edges. */
function tileName(level: Level, x: number, y: number): BankTileName {
    const tiles = level.tiles, t = tiles[y]![x]!;
    const variant = (n: number) => (Math.imul(x * 73856093 ^ y * 19349663, 0x9e3779b1) >>> 0) % n;
    switch (t) {
        case 'x': return 'offMap';
        case ',': return (['linoleum0', 'linoleum1'] as const)[variant(2)]!;
        case '.': return (['marble0', 'marble1', 'marble2'] as const)[variant(3)]!;
        case '=': return tiles[y]![x - 1] === '=' ? 'runnerRight' : 'runnerLeft';
        case 'q': return variant(2) ? 'concrete1' : 'concrete0';
        case 'v': return 'steelPlate';
        case 't': return 'whiteTile';
        case 'f': return y % 2 ? 'floorboards1' : 'floorboards0';
        case 'u': return variant(2) ? 'dusty1' : 'dusty0';
        case 'a': return variant(6) === 0 ? 'alley1' : 'alley0';
        case 's': return (['sidewalkTL', 'sidewalkTR', 'sidewalkBL', 'sidewalkBR'] as const)[(x % 2) + (y % 2) * 2]!;
        case 'c': return tiles[y - 1]?.[x] === 'r' ? 'curbFar' : 'curb';
        case 'm': return variant(2) ? 'granite1' : 'granite0';
        case 'n': return (x + y) % 2 ? 'officeCarpet1' : 'officeCarpet0';
        case 'h': return variant(2) ? 'concrete1' : 'concrete0';
        case 'z': return 'stairs';
        case 'y': return variant(2) ? 'pavers1' : 'pavers0';
        case 'r': return variant(5) === 0 ? 'road1' : 'road0';
        case 'l': return x % 2 === 0 ? 'roadDash' : 'roadGap';
        case 'j': return variant(2) ? 'mezzanine1' : 'mezzanine0';
        // A bay is three tiles wide (about 3.8m), its line along the west edge of its first tile.
        case 'p': return x % 3 === 0 ? 'garageBay' : variant(4) === 0 ? 'garage1' : 'garage0';
        case 'k': return variant(3) === 0 ? 'scaffold1' : 'scaffold0';
        // The site dumper's tracks run the length of the site, every few columns.
        case 'e': return x % 5 === 2 ? 'gravel1' : 'gravel0';
    }
}

/**
 * The edges of raised tiles and stairs where they drop to lower floor with no wall between (§14.7): the raised tile
 * catches the light along its lip, and the lower floor is in its shadow, at the foot of its south face and softly beside
 * its east or west side. The raised tiles themselves are drawn lifted, from this floor (raised.ts).
 */
function drawRaisedEdges(level: Level, floor: PixelBitmap): void {
    const { tiles, walls } = level;
    const closed = new Set(walls.filter(w => w.kind !== 'rail').map(w => `${w.run} ${w.tx} ${w.ty}`));
    const shadow = (x: number, y: number, amount: number) => floor.set(x, y, deepen(floor.color(x, y), amount), 0.3);
    tiles.forEach((row, ty) => row.forEach((_, tx) => {
        const h = floorHeight(tiles, tx, ty);
        if (!h) return;
        const lower = (nx: number, ny: number) => tiles[ny]?.[nx] !== undefined && floorHeight(tiles, nx, ny) < h;
        const x0 = tx * TILE, y0 = ty * TILE;
        // Within a flight, the steps drawn on the tiles already show the climb.
        const flight = tiles[ty]![tx] === 'z' && tiles[ty + 1]?.[tx] === 'z';
        // Its face, lifted with it, is drawn with it (raised.ts); at its foot, the lower floor is in its shadow.
        if (lower(tx, ty + 1) && !flight && !closed.has(`eastWest ${tx} ${ty + 1}`)) {
            for (let x = x0; x < x0 + TILE; x++) {
                shadow(x, y0 + TILE, 0.45);
                shadow(x, y0 + TILE + 1, 0.2);
            }
        }
        for (const [dx, edge] of [[-1, tx], [1, tx + 1]] as const) {
            if (!lower(tx + dx, ty) || closed.has(`northSouth ${edge} ${ty}`)) continue;
            // Seen from above the drop itself is edge-on, so what shows it is a lit lip two pixels wide on the
            // slab and a shadow on the floor below, darkest at its foot and fading over five pixels.
            const lip = dx < 0 ? x0 : x0 + TILE - 1, foot = dx < 0 ? x0 - 1 : x0 + TILE;
            for (let y = y0; y < y0 + TILE; y++) {
                floor.set(lip - dx, y, mix(floor.color(lip - dx, y), PAL.concrete[5], 0.45), 0.6);
                floor.set(lip, y, PAL.concrete[5], 0.8);
                EDGE_SHADOW.forEach((amount, k) => shadow(foot + k * dx, y, amount));
            }
        }
        if (lower(tx, ty - 1) && !closed.has(`eastWest ${tx} ${ty}`)) for (let x = x0; x < x0 + TILE; x++) floor.set(x, y0, PAL.concrete[5], 0.8);
    }));
}
