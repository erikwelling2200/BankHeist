import { TILE } from '../../level/level';
import { PAL, deepen, mix, step } from '../palette';
import { PixelBitmap } from '../PixelBitmap';
import { mulberry32, valueNoise } from '../random';

/** Every tile the bank tileset holds. Floors come in a few variants so repeats don't show. */
export const BANK_TILE_NAMES = [
    'marble0', 'marble1', 'marble2',
    'runnerLeft', 'runnerRight', 'linoleum0', 'linoleum1',
    'sidewalkTL', 'sidewalkTR', 'sidewalkBL', 'sidewalkBR', 'curb', 'road0', 'road1', 'roadDash', 'roadGap',
    'wallCap', 'wallFace', 'doorWood', 'doorKeycard', 'sideDoor',
    'pier', 'window', 'doorGlassLeft', 'doorGlassRight', 'atm'
] as const;

export type BankTileName = typeof BANK_TILE_NAMES[number];

type Painter = (b: PixelBitmap, ox: number, rand: () => number) => void;

/** Height of the wall top seen at an angle along the top of every face, so faces join the cap above them. */
export const FACE_LIP = 3;

/**
 * Lobby marble: a calm cream field (so floor overlays stay readable) with dark green cabochons where four tiles meet,
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

/** The cap: the top of a wall seen from above. Dark, so rooms read as lit pockets between solid mass. */
const wallCap: Painter = (b, ox, rand) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) b.set(ox + x, y, rand() > 0.9 ? PAL.plaster[1] : PAL.plaster[0], 1);
};

function lip(b: PixelBitmap, ox: number): void {
    for (let x = 0; x < TILE; x++) {
        b.set(ox + x, 0, PAL.plaster[0], 1);
        b.set(ox + x, 1, PAL.plaster[0], 1);
        b.set(ox + x, 2, PAL.plaster[2], 0.95);
    }
}

/** Interior face: plaster above a walnut wainscot with a brass chair rail and a dark skirting board. */
const wallFace: Painter = (b, ox, rand) => {
    for (let y = FACE_LIP; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        let c: number, h = 0.5;
        if (y < 9) c = step(PAL.plaster, rand() > 0.92 ? 4 : 3);
        else if (y === 9) { c = PAL.brass[3]; h = 0.7; }
        else if (y < 14) c = (x % 8 === 0) ? PAL.walnut[1] : (x % 8 === 1 ? PAL.walnut[4] : PAL.walnut[3]);
        else c = PAL.walnut[0];
        b.set(ox + x, y, c, h);
    }
    lip(b, ox);
};

const doorWood: Painter = (b, ox, rand) => {
    wallFace(b, ox, rand);
    for (let y = FACE_LIP; y < TILE; y++) for (let x = 2; x < 14; x++) {
        const frame = x === 2 || x === 13 || y === FACE_LIP;
        const panel = (x === 5 || x === 10) && y > 5 && y < 14;
        b.set(ox + x, y, frame ? PAL.walnut[1] : panel ? PAL.walnut[2] : PAL.walnut[4], frame ? 0.7 : 0.55);
    }
    b.rect(ox + 6, 5, 4, 2, PAL.brass[4], 0.7);
    b.set(ox + 11, 10, PAL.brass[5], 0.8);
};

const doorKeycard: Painter = (b, ox, rand) => {
    wallFace(b, ox, rand);
    for (let y = FACE_LIP; y < TILE; y++) for (let x = 2; x < 14; x++) {
        const frame = x === 2 || x === 13 || y === FACE_LIP;
        b.set(ox + x, y, frame ? PAL.steel[1] : step(PAL.steel, x < 7 ? 3 : 2), frame ? 0.7 : 0.55);
    }
    b.rect(ox + 5, 5, 6, 3, PAL.glass[1], 0.5);
    b.hline(ox + 5, 5, 6, PAL.glass[3], 0.5);
    b.vline(ox + 11, 9, 2, PAL.steel[5], 0.8);
    // Keycard reader on the frame; its LED is an emissive sprite placed by the scene.
    b.rect(ox + 14, 7, 2, 3, PAL.steel[0], 0.8);
};

/** A door in a side wall, seen from above: an opening in the cap with the door leaf standing open against the jamb. */
const sideDoor: Painter = (b, ox, rand) => {
    wallCap(b, ox, rand);
    for (let y = 3; y < 13; y++) for (let x = 4; x < 12; x++) b.set(ox + x, y, step(PAL.marbleCream, 2), 0.4);
    b.rect(ox + 4, 3, 2, 10, PAL.walnut[3], 0.9);
    b.vline(ox + 4, 3, 10, PAL.walnut[5], 1);
};

/** Façade pieces face the street: limestone blocks under a cornice, the building's top edge drawn as the lip. */
function facadeLip(b: PixelBitmap, ox: number): void {
    for (let x = 0; x < TILE; x++) {
        b.set(ox + x, 0, PAL.limestone[1], 1);
        b.set(ox + x, 1, PAL.limestone[5], 1);
        b.set(ox + x, 2, PAL.limestone[3], 0.9);
        b.set(ox + x, 3, PAL.limestone[1], 0.8);
    }
}

const pier: Painter = (b, ox, rand) => {
    for (let y = 4; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const course = Math.floor((y - 4) / 4);
        const joint = (y - 4) % 4 === 3 || (x + (course % 2) * 8) % 16 === 0;
        b.set(ox + x, y, joint ? PAL.limestone[2] : step(PAL.limestone, rand() > 0.85 ? 5 : 4), joint ? 0.4 : 0.7);
    }
    b.hline(ox, TILE - 1, TILE, PAL.limestone[1], 0.5);
    facadeLip(b, ox);
};

/** Shop-front glass: a stone sill, bronze frame, blinds half down and the sky reflected in streaks. */
const windowTile: Painter = (b, ox) => {
    for (let y = 4; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        let c: number, h = 0.5;
        if (y >= 14) { c = y === 14 ? PAL.limestone[5] : PAL.limestone[3]; h = 0.75; }
        else if (y === 4 || x === 0 || x === TILE - 1) { c = PAL.walnut[1]; h = 0.7; }
        else if (y === 5) { c = PAL.paper[1]; h = 0.55; }
        else {
            // Dark interior behind the glass, with the sky and the street's reflection streaking across it.
            const k = (x - y + 32) % 12;
            const streak = k < 2 || k === 5;
            c = streak ? PAL.glass[3] : y > 10 ? PAL.glass[1] : PAL.glass[0];
        }
        b.set(ox + x, y, c, h);
    }
    b.vline(ox + 8, 6, 8, PAL.walnut[1], 0.6);
    facadeLip(b, ox);
};

const doorGlass = (side: 'left' | 'right'): Painter => (b, ox) => {
    for (let y = 4; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const inner = side === 'left' ? TILE - 1 - x : x;
        let c: number, h = 0.5;
        if (y === 4 || y === 8 || inner === 0 || inner === TILE - 1 || y === TILE - 1) { c = PAL.walnut[1]; h = 0.7; }
        else if (y < 8) c = PAL.glass[0];
        else {
            const streak = ((x - y + 32) % 9 < 2);
            c = streak ? PAL.glass[3] : y > 11 ? PAL.glass[1] : PAL.glass[0];
        }
        b.set(ox + x, y, c, h);
    }
    // Gold leaf on the transom: "BA" over the left door, "NK" over the right, in a 3x3 face.
    const glyphs: Record<string, string[]> = { B: ['##.', '###', '##.'], A: ['.#.', '###', '#.#'], N: ['#.#', '###', '#.#'], K: ['#.#', '##.', '#.#'] };
    const word = side === 'left' ? 'BA' : 'NK';
    [...word].forEach((ch, i) => glyphs[ch]!.forEach((row, gy) => [...row].forEach((on, gx) => {
        if (on === '#') b.set(ox + (side === 'left' ? 8 : 1) + i * 4 + gx, 5 + gy, gy === 0 ? PAL.brass[5] : PAL.brass[4], 0.6);
    })));
    // Brass push bar towards the meeting stiles.
    const bx = side === 'left' ? 11 : 2;
    b.rect(ox + bx, 10, 3, 1, PAL.brass[5], 0.8);
    b.rect(ox + bx, 11, 3, 1, PAL.brass[2], 0.75);
    facadeLip(b, ox);
};

const atm: Painter = (b, ox, rand) => {
    pier(b, ox, rand);
    b.rect(ox + 2, 5, 12, 10, PAL.steel[1], 0.8);
    b.rect(ox + 3, 6, 10, 8, PAL.steel[3], 0.85);
    b.rect(ox + 4, 7, 8, 4, PAL.steel[0], 0.7);
    b.rect(ox + 5, 12, 6, 1, PAL.steel[5], 0.9);
    b.hline(ox + 3, 6, 10, PAL.steel[4], 0.9);
};

const PAINTERS: Record<BankTileName, Painter> = {
    marble0: marble(11), marble1: marble(12), marble2: marble(13),
    runnerLeft: runner('left'), runnerRight: runner('right'), linoleum0: linoleum, linoleum1: linoleum,
    sidewalkTL: sidewalk(false, false), sidewalkTR: sidewalk(true, false), sidewalkBL: sidewalk(false, true), sidewalkBR: sidewalk(true, true), curb,
    road0: road(false), road1: road(true), roadDash: roadLine(true), roadGap: roadLine(false),
    wallCap, wallFace, doorWood, doorKeycard, sideDoor,
    pier, window: windowTile, doorGlassLeft: doorGlass('left'), doorGlassRight: doorGlass('right'), atm
};

export const BANK_TILE_INDEX = Object.fromEntries(BANK_TILE_NAMES.map((n, i) => [n, i])) as Record<BankTileName, number>;

/** Paints the whole tileset as one strip, one 16px tile per name in `BANK_TILE_NAMES` order. */
export function bankTileset(): PixelBitmap {
    const bitmap = new PixelBitmap(TILE * BANK_TILE_NAMES.length, TILE);
    const rand = mulberry32(4242);
    BANK_TILE_NAMES.forEach((name, i) => PAINTERS[name](bitmap, i * TILE, rand));
    return bitmap;
}
