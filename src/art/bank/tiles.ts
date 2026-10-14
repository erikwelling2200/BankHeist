import { TILE } from '../../level/level';
import { PAL, deepen, mix, step } from '../palette';
import { PixelBitmap } from '../PixelBitmap';
import { mulberry32, valueNoise } from '../random';

/** Every floor tile the bank tileset holds, in a few variants so repeats don't show. Walls stand on the edges between tiles, in `walls.ts`. */
export const BANK_TILE_NAMES = [
    'marble0', 'marble1', 'marble2',
    'runnerLeft', 'runnerRight', 'linoleum0', 'linoleum1',
    'sidewalkTL', 'sidewalkTR', 'sidewalkBL', 'sidewalkBR', 'curb', 'road0', 'road1', 'roadDash', 'roadGap',
    'concrete0', 'concrete1', 'steelPlate', 'whiteTile', 'floorboards0', 'floorboards1', 'dusty0', 'dusty1', 'alley0', 'alley1',
    'granite0', 'granite1', 'officeCarpet0', 'officeCarpet1', 'stairs', 'pavers0', 'pavers1', 'curbFar',
    'mezzanine0', 'mezzanine1', 'garage0', 'garage1', 'garageBay', 'scaffold0', 'scaffold1', 'gravel0', 'gravel1',
    'offMap'
] as const;

export type BankTileName = typeof BANK_TILE_NAMES[number];

type Painter = (b: PixelBitmap, ox: number, rand: () => number) => void;

/**
 * Level marble: a calm cream field (so floor overlays stay readable) with dark green cabochons where four tiles meet,
 * each ringed in brass. Veins wander through the cream from smooth noise.
 */
const marble = (seed: number): Painter => (b, ox, rand) => {
    const noise = valueNoise(mulberry32(seed), 3);
    const veinPhase = rand() * 4;
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const n = noise(x / TILE, y / TILE);
        const vein = Math.abs(Math.sin((x * 0.22 - y * 0.17 + n * 3 + veinPhase) * Math.PI * 0.5)) < 0.06;
        let c = step(PAL.marbleCream, n > 0.6 ? 3 : 2);
        let h = 0.6;
        if (vein) c = mix(step(PAL.marbleCream, 1), c, 0.5);
        if (x === TILE - 1 || y === TILE - 1) { c = mix(step(PAL.marbleCream, 1), step(PAL.marbleCream, 2), 0.45); h = 0.45; }
        const cx = x < TILE / 2 ? 0 : TILE, cy = y < TILE / 2 ? 0 : TILE;
        const d = Math.abs(x + 0.5 - cx) + Math.abs(y + 0.5 - cy);
        if (d < 4.1) { c = d < 2.8 ? step(PAL.marbleGreen, d < 1.2 ? 4 : 3) : mix(PAL.brass[1], step(PAL.marbleCream, 1), 0.5); h = d < 2.8 ? 0.65 : 0.7; }
        b.set(ox + x, y, c, h);
    }
};

const runner = (side: 'left' | 'right'): Painter => (b, ox) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const edge = side === 'left' ? x : TILE - 1 - x;
        // Woven diamonds in two reds, framed by a gold border a couple of pixels in from the edge.
        const diamond = (Math.abs(((x + (side === 'right' ? 8 : 0)) % 8) - 4) + Math.abs((y % 8) - 4)) === 3;
        let c: number = diamond ? PAL.carpet[3] : PAL.carpet[2];
        let h = 0.5;
        if (edge === 0) { c = PAL.carpet[0]; h = 0.3; }
        else if (edge === 2) { c = PAL.brass[2]; h = 0.55; }
        else if (edge === 1 || edge === 3) c = PAL.carpet[1];
        b.set(ox + x, y, c, h);
    }
};

const linoleum: Painter = (b, ox, rand) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const fleck = rand();
        let c = step(PAL.linoleum, 2);
        if (fleck > 0.93) c = step(PAL.linoleum, 3);
        else if (fleck < 0.06) c = step(PAL.linoleum, 1);
        if (y === TILE - 1 || x === TILE - 1) c = mix(step(PAL.linoleum, 1), step(PAL.linoleum, 2), 0.4);
        b.set(ox + x, y, c, 0.5);
    }
};

/** Sidewalk slabs span 2x2 tiles; `right`/`bottom` say which quarter of the slab this tile is, so seams only run between slabs. */
const sidewalk = (right: boolean, bottom: boolean): Painter => (b, ox, rand) => {
    const noise = valueNoise(rand, 4);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const n = noise(x / TILE, y / TILE) + rand() * 0.12;
        let c = n > 0.78 ? mix(step(PAL.concrete, 4), step(PAL.concrete, 5), 0.5) : n < 0.25 ? mix(step(PAL.concrete, 3), step(PAL.concrete, 4), 0.5) : step(PAL.concrete, 4);
        let h = 0.6;
        if ((right && x === TILE - 1) || (bottom && y === TILE - 1)) { c = step(PAL.concrete, 2); h = 0.3; }
        else if ((!right && x === 0) || (!bottom && y === 0)) c = step(PAL.concrete, 5);
        b.set(ox + x, y, c, h);
    }
    if (rand() < 0.35) {
        let x = 3 + Math.floor(rand() * 10), y = 3 + Math.floor(rand() * 8);
        for (let s = 0; s < 5; s++) {
            b.plot(ox + x, y, step(PAL.concrete, 3), 0.4);
            x += rand() < 0.5 ? 1 : 0;
            y += 1;
        }
    }
};

const curb: Painter = (b, ox, rand) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        let c: number, h: number;
        if (y < 8) { c = step(PAL.concrete, rand() > 0.85 ? 5 : 4); h = 0.6; }
        else if (y < 11) { c = step(PAL.limestone, y === 8 ? 5 : 4); h = 0.75; }
        else if (y < 13) { c = step(PAL.limestone, 1); h = 0.4; }
        else { c = step(PAL.asphalt, y === 13 ? 0 : 1); h = 0.15; }
        if (x === TILE - 1 && y >= 8 && y < 13) c = deepen(c, 0.3);
        b.set(ox + x, y, c, h);
    }
};

const road = (stains: boolean): Painter => (b, ox, rand) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const r = rand();
        b.set(ox + x, y, step(PAL.asphalt, r > 0.9 ? 4 : r < 0.12 ? 1 : 2 + (r > 0.55 ? 1 : 0) * 0.4), 0.4 + r * 0.1);
    }
    if (stains) b.ellipse(ox + 6 + rand() * 4, 6 + rand() * 4, 3, 1.6, PAL.asphalt[1], 0.38);
};

const roadLine = (dash: boolean): Painter => (b, ox, rand) => {
    road(false)(b, ox, rand);
    if (!dash) return;
    for (let x = 2; x < 14; x++) {
        b.set(ox + x, 7, step(PAL.paintLine, rand() > 0.8 ? 0 : 1), 0.5);
        b.set(ox + x, 8, step(PAL.paintLine, rand() > 0.8 ? 0 : 2), 0.5);
    }
};

/** Sealed concrete for the Secure rooms (§8.1): cool grey, trowel marks and the odd stain, a saw cut every two tiles. */
const concrete = (seed: number): Painter => (b, ox, rand) => {
    const noise = valueNoise(mulberry32(seed), 3);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const n = noise(x / TILE, y / TILE) + rand() * 0.1;
        let c = step(PAL.concrete, n > 0.7 ? 3 : n < 0.25 ? 1 : 2);
        if (x === TILE - 1 && seed % 2) c = PAL.concrete[0];
        b.set(ox + x, y, c, 0.5);
    }
};

/** The vault's floor: diamond-tread steel plate, bolted at the corners. */
const steelPlate: Painter = (b, ox) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        let c: number = (x + y * 2) % 6 === 0 || (x * 2 - y + 32) % 6 === 0 ? PAL.steel[3] : PAL.steel[2];
        if (x === TILE - 1 || y === TILE - 1) c = PAL.steel[1];
        if ((x === 1 || x === TILE - 3) && (y === 1 || y === TILE - 3)) c = PAL.steel[4];
        b.set(ox + x, y, c, (x + y * 2) % 6 === 0 ? 0.6 : 0.45);
    }
};

/** Small white tiles with grey grout: the restrooms and the café's kitchen. */
const whiteTile: Painter = (b, ox, rand) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const grout = x % 4 === 3 || y % 4 === 3;
        b.set(ox + x, y, grout ? PAL.cloth.white[0]! : rand() > 0.9 ? PAL.cloth.white[1]! : PAL.cloth.white[2]!, grout ? 0.35 : 0.55);
    }
};

/** The café's oak floorboards, running east-west, their joints staggered. */
const floorboards = (offset: number): Painter => (b, ox, rand) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const board = Math.floor(y / 4), joint = y % 4 === 3 || (x + board * 5 + offset) % 16 === 0;
        b.set(ox + x, y, joint ? PAL.oak[1] : step(PAL.oak, (board + offset) % 3 === 0 ? 2 : rand() > 0.9 ? 2 : 3), joint ? 0.35 : 0.55);
    }
};

/** A vacant shop's floor: bare screed under a film of dust, scuffed where people walked, a scrap of paper. */
const dusty = (seed: number): Painter => (b, ox, rand) => {
    const noise = valueNoise(mulberry32(seed), 2);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const n = noise(x / TILE, y / TILE);
        b.set(ox + x, y, mix(step(PAL.concrete, n > 0.55 ? 3 : 2), PAL.plywood[2], 0.25 + rand() * 0.08), 0.5);
    }
    if (seed % 2) b.rect(ox + 4 + Math.floor(rand() * 6), 5 + Math.floor(rand() * 6), 3, 2, PAL.paper[1], 0.55);
};

/** The alley's old, patched asphalt: darker than the road, a drain-stain here and there. */
const alley = (stain: boolean): Painter => (b, ox, rand) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const r = rand();
        b.set(ox + x, y, step(PAL.asphalt, r > 0.93 ? 3 : r < 0.2 ? 0 : 1), 0.4 + r * 0.1);
    }
    if (stain) b.ellipse(ox + 5 + rand() * 6, 5 + rand() * 6, 4, 2.5, PAL.asphalt[0], 0.35);
};

/** An office tower's lobby: big slabs of polished dark granite, finely flecked, a hairline joint. */
const granite = (seed: number): Painter => (b, ox, rand) => {
    const noise = valueNoise(mulberry32(seed), 2);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const fleck = rand(), n = noise(x / TILE, y / TILE);
        let c = step(PAL.granite, n > 0.55 ? 2 : 1);
        if (fleck > 0.96) c = step(PAL.granite, 3);
        if (x === TILE - 1 || y === TILE - 1) c = PAL.granite[0];
        b.set(ox + x, y, c, 0.55);
    }
};

/** Office carpet tiles, laid with their pile turned alternately so the squares show. */
const officeCarpet = (turned: boolean): Painter => (b, ox, rand) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const quarter = (x < 8) !== (y < 8) !== turned, pile = quarter ? (x + rand() * 2) % 3 < 1 : (y + rand() * 2) % 3 < 1;
        b.set(ox + x, y, step(PAL.officeCarpet, pile ? 3 : 2), 0.45);
    }
};

/**
 * Stairs climbing to the north, five steps to a tile: each step's tread, its nosing catching the light, and below it the
 * riser, which faces the camera. A flight's tiles all look alike; how high each is comes from the level.
 */
const stairs: Painter = (b, ox) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const k = (y + 1) % 3;
        const c = k === 0 ? PAL.concrete[2] : k === 1 ? PAL.concrete[5] : PAL.concrete[4];
        b.set(ox + x, y, x === 0 || x === TILE - 1 ? PAL.concrete[1] : c, k === 0 ? 0.3 : 0.6);
    }
};

/** A plaza's clay pavers in basket weave: pairs of bricks, alternately lying and standing, a few weathered darker. */
const pavers = (seed: number): Painter => (b, ox, rand) => {
    const shade = Array.from({ length: 8 }, () => (rand() > 0.75 ? 2 : 3));
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const bx = Math.floor(x / 8), by = Math.floor(y / 8), lying = (bx + by + seed) % 2 === 0;
        const i = lying ? Math.floor((y % 8) / 4) : Math.floor((x % 8) / 4);
        const joint = x % 8 === 7 || y % 8 === 7 || (lying ? y % 4 === 3 : x % 4 === 3);
        const c = joint ? mix(PAL.concrete[2], PAL.brick[1], 0.3) : mix(PAL.brick[shade[(by * 2 + bx) * 2 + i]!]!, PAL.concrete[3], 0.45);
        b.set(ox + x, y, c, joint ? 0.35 : 0.55);
    }
};

/** The curb on the far side of the road: the gutter, then the curb's top edge and the sidewalk; its face looks away from us. */
const curbFar: Painter = (b, ox, rand) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        let c: number, h: number;
        if (y < 3) { c = step(PAL.asphalt, y === 2 ? 0 : 1); h = 0.15; }
        else if (y < 6) { c = step(PAL.limestone, y === 3 ? 3 : 4); h = 0.75; }
        else { c = step(PAL.concrete, rand() > 0.85 ? 5 : 4); h = 0.6; }
        if (x === TILE - 1 && y >= 3 && y < 6) c = deepen(c, 0.3);
        b.set(ox + x, y, c, h);
    }
};

/**
 * A staff mezzanine's linoleum: the same flecked sheet flooring as downstairs from a cooler grey-blue batch, so the
 * raised floor reads apart from the ground floor's; `seam` runs a welded seam along the tile's north edge.
 */
const mezzanine = (seam: boolean): Painter => (b, ox, rand) => {
    const tone = (i: number) => mix(step(PAL.linoleum, i), step(PAL.officeCarpet, i + 1), 0.4);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const fleck = rand();
        let c = tone(2);
        if (fleck > 0.93) c = tone(3);
        else if (fleck < 0.06) c = tone(1);
        if (seam && y === 0) c = mix(tone(1), tone(2), 0.5);
        b.set(ox + x, y, c, 0.5);
    }
};

/**
 * A parking garage's power-floated concrete: paler and smoother than the vault's, a faint tyre polish down the middle,
 * now and then an oil drip; `bay` paints the bay line, white with a yellow edge, along the tile's west side.
 */
const garage = (seed: number, oil: boolean, bay: boolean): Painter => (b, ox, rand) => {
    const noise = valueNoise(mulberry32(seed), 2);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const n = noise(x / TILE, y / TILE), r = rand();
        let c = mix(step(PAL.concrete, 3), step(PAL.concrete, 4), 0.2 + n * 0.3);
        if (r > 0.95) c = step(PAL.concrete, 4);
        else if (r < 0.04) c = step(PAL.concrete, 2);
        b.set(ox + x, y, c, 0.5);
    }
    if (oil) {
        const cx = 6 + rand() * 4, cy = 6 + rand() * 4;
        // A soaked-in ring, darker where it is fresh, and a drip beside it.
        b.ellipse(ox + cx, cy, 3.4, 2.3, mix(PAL.concrete[3], PAL.asphalt[3], 0.45), 0.48);
        b.ellipse(ox + cx - 0.4, cy - 0.2, 2, 1.3, mix(PAL.concrete[2], PAL.asphalt[2], 0.5), 0.45);
        b.plot(ox + Math.floor(cx) + 4, Math.floor(cy) + 2, mix(PAL.concrete[3], PAL.asphalt[3], 0.45), 0.48);
    }
    if (bay) for (let y = 0; y < TILE; y++) {
        const worn = rand() > 0.88;
        b.set(ox, y, worn ? mix(PAL.paper[2], PAL.concrete[3], 0.5) : PAL.paper[2], 0.55);
        b.set(ox + 1, y, worn ? mix(PAL.paintLine[1], PAL.concrete[3], 0.5) : PAL.paintLine[1], 0.55);
    }
};

/**
 * Scaffold boards, laid east-west on the tubes: four grey-brown timber boards to a tile, the dark drop below showing in
 * the gaps between them, a steel clip holding each board down at the tube on the tile's west edge. `joint` butts two
 * boards end to end halfway across.
 */
const scaffold = (joint: boolean): Painter => (b, ox, rand) => {
    const timber = (i: number) => mix(step(PAL.plywood, i), step(PAL.concrete, i), 0.4);
    const shades = Array.from({ length: 8 }, () => (rand() > 0.6 ? 3 : 2));
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const board = Math.floor(y / 4), row = y % 4, end = joint && (x === 7 || x === 8);
        const piece = board * 2 + (joint && x > 7 ? 1 : 0);
        let c: number, h: number;
        if (row === 3 || (end && x === 8)) { c = mix(PAL.void, PAL.plywood[0], 0.3); h = 0.1; }
        else {
            c = timber(row === 0 ? shades[piece]! + 1 : row === 2 ? shades[piece]! - 1 : shades[piece]!);
            if (rand() > 0.93) c = timber(1);
            h = row === 0 ? 0.6 : 0.5;
        }
        b.set(ox + x, y, c, h);
    }
    // The tube under the boards' ends, seen in the gaps, and the clips over it.
    for (let board = 0; board < 4; board++) {
        b.set(ox, board * 4 + 3, PAL.steel[2], 0.3);
        b.set(ox + 1, board * 4 + 1, PAL.steel[4], 0.75);
        b.set(ox + 1, board * 4 + 2, PAL.steel[2], 0.7);
    }
};

/**
 * A building site's ground: compacted grey-brown hardcore, speckled with grit and a few pebbles catching the light;
 * `ruts` presses a pair of tyre tracks into it, north to south.
 */
const gravel = (ruts: boolean): Painter => (b, ox, rand) => {
    const ground = (i: number) => mix(step(PAL.concrete, i), step(PAL.plywood, i), 0.35);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const r = rand();
        b.set(ox + x, y, ground(r > 0.9 ? 4 : r > 0.62 ? 3 : r < 0.14 ? 1 : 2), 0.4 + r * 0.15);
    }
    // A site dumper's wheels, about 0.9m apart: each rut's west wall in shadow, tread marks across its floor.
    const rut = (x: number) => (x >= 1 && x <= 3) || (x >= 12 && x <= 14);
    if (ruts) for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        if (!rut(x)) continue;
        const wall = x === 1 || x === 12, tread = (y + x) % 3 === 0;
        b.set(ox + x, y, wall ? ground(0) : tread ? ground(1) : mix(ground(1), ground(2), 0.5), wall ? 0.2 : 0.3);
    }
    for (let i = 0; i < (ruts ? 3 : 5); i++) {
        const x = 1 + Math.floor(rand() * 13), y = 1 + Math.floor(rand() * 13);
        if (ruts && (rut(x) || rut(x + 1))) continue;
        b.set(ox + x, y, ground(5), 0.8);
        b.set(ox + x + 1, y, ground(3), 0.7);
        b.set(ox + x, y + 1, ground(1), 0.4);
        b.set(ox + x + 1, y + 1, ground(0), 0.35);
    }
};

/** Off the map (a neighbour's building): dark and hatched like the walls' sections, so it reads as solid, not as floor. */
const offMap: Painter = (b, ox) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) b.set(ox + x, y, (x + y) % 4 === 0 ? deepen(PAL.plaster[1], 0.3) : deepen(PAL.plaster[0], 0.3), 1);
};

const PAINTERS: Record<BankTileName, Painter> = {
    marble0: marble(11), marble1: marble(12), marble2: marble(13),
    runnerLeft: runner('left'), runnerRight: runner('right'), linoleum0: linoleum, linoleum1: linoleum,
    sidewalkTL: sidewalk(false, false), sidewalkTR: sidewalk(true, false), sidewalkBL: sidewalk(false, true), sidewalkBR: sidewalk(true, true), curb,
    road0: road(false), road1: road(true), roadDash: roadLine(true), roadGap: roadLine(false),
    concrete0: concrete(21), concrete1: concrete(22), steelPlate, whiteTile, floorboards0: floorboards(0), floorboards1: floorboards(7),
    dusty0: dusty(41), dusty1: dusty(42), alley0: alley(false), alley1: alley(true),
    granite0: granite(51), granite1: granite(52), officeCarpet0: officeCarpet(false), officeCarpet1: officeCarpet(true), stairs,
    pavers0: pavers(0), pavers1: pavers(4), curbFar,
    mezzanine0: mezzanine(false), mezzanine1: mezzanine(true), garage0: garage(71, false, false), garage1: garage(72, true, false),
    garageBay: garage(73, false, true), scaffold0: scaffold(false), scaffold1: scaffold(true), gravel0: gravel(false), gravel1: gravel(true),
    offMap
};

export const BANK_TILE_INDEX = Object.fromEntries(BANK_TILE_NAMES.map((n, i) => [n, i])) as Record<BankTileName, number>;

/** Paints the whole tileset as one strip, one 16px tile per name in `BANK_TILE_NAMES` order. */
export function bankTileset(): PixelBitmap {
    const bitmap = new PixelBitmap(TILE * BANK_TILE_NAMES.length, TILE);
    const rand = mulberry32(4242);
    BANK_TILE_NAMES.forEach((name, i) => PAINTERS[name](bitmap, i * TILE, rand));
    return bitmap;
}
