import { TILE } from '../../level/level';
import { PAL, mix, step } from '../palette';
import { PixelBitmap } from '../PixelBitmap';
import { mulberry32 } from '../random';
import { BLOCK_HEIGHT, THIN_CAP, WALL_HEIGHT } from './geometry';

export const WALL_BLOCK_NAMES = ['cap', 'sideDoor', 'face', 'doorWood', 'doorKeycard', 'pier', 'window', 'doorGlassLeft', 'doorGlassRight', 'atm'] as const;
export type WallBlockName = typeof WALL_BLOCK_NAMES[number];

/** Paints one block; `face(x, y, ...)` writes in face coordinates (0..23 down from the face's top edge). */
type Painter = (cap: (x: number, y: number, c: number, h: number, a?: number) => void, face: (x: number, y: number, c: number, h: number, a?: number) => void, rand: () => number) => void;

const F = WALL_HEIGHT;

/** Interior walls are solid masonry: a dark plaster cap the full depth of the tile. */
const solidCap: Painter = (cap, _face, rand) => {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) cap(x, y, y === TILE - 1 ? PAL.plaster[2] : rand() > 0.9 ? PAL.plaster[1] : PAL.plaster[0], 1);
};

/** The shop front is a thin wall: a limestone coping along its street edge, the rest of the tile is floor behind it. */
const thinCap: Painter = (cap) => {
    const coping = [PAL.limestone[2], PAL.limestone[5], PAL.limestone[4], PAL.limestone[1]];
    for (let x = 0; x < TILE; x++) coping.forEach((c, i) => cap(x, TILE - THIN_CAP + i, c, i === THIN_CAP - 1 ? 0.9 : 1));
};

/** Interior face: plaster above a walnut wainscot with a brass chair rail and a dark skirting board. */
const interiorFace: Painter = (cap, face, rand) => {
    solidCap(cap, face, rand);
    for (let y = 0; y < F; y++) for (let x = 0; x < TILE; x++) {
        let c: number, h = 0.5;
        if (y === 0) c = PAL.plaster[2];
        else if (y < 13) c = step(PAL.plaster, rand() > 0.92 ? 4 : 3);
        else if (y === 13) { c = PAL.brass[3]; h = 0.7; }
        else if (y < 21) c = (x % 8 === 0) ? PAL.walnut[1] : (x % 8 === 1 ? PAL.walnut[4] : PAL.walnut[3]);
        else c = PAL.walnut[0];
        face(x, y, c, h);
    }
};

const DOOR_TOP = 6;

const doorWood: Painter = (cap, face, rand) => {
    interiorFace(cap, face, rand);
    for (let y = DOOR_TOP; y < F; y++) for (let x = 2; x < 14; x++) {
        const frame = x === 2 || x === 13 || y === DOOR_TOP;
        const panel = (x === 5 || x === 10) && y > DOOR_TOP + 2 && y < F - 2;
        face(x, y, frame ? PAL.walnut[1] : panel ? PAL.walnut[2] : PAL.walnut[4], frame ? 0.7 : 0.55);
    }
    for (let x = 6; x < 10; x++) { face(x, DOOR_TOP + 3, PAL.brass[4], 0.7); face(x, DOOR_TOP + 4, PAL.brass[3], 0.7); }
    face(11, 15, PAL.brass[5], 0.8);
};

/** Steel staff door with a wired-glass vision panel; the card reader sits on the frame at (14, 12), its LED a glow sprite. */
const doorKeycard: Painter = (cap, face, rand) => {
    interiorFace(cap, face, rand);
    for (let y = DOOR_TOP; y < F; y++) for (let x = 2; x < 14; x++) {
        const frame = x === 2 || x === 13 || y === DOOR_TOP;
        face(x, y, frame ? PAL.steel[1] : step(PAL.steel, x < 7 ? 3 : 2), frame ? 0.7 : 0.55);
    }
    for (let y = 9; y < 13; y++) for (let x = 5; x < 11; x++) face(x, y, y === 9 ? PAL.glass[3] : PAL.glass[1], 0.5);
    face(11, 15, PAL.steel[5], 0.8);
    face(11, 16, PAL.steel[5], 0.8);
    for (let y = 11; y < 14; y++) { face(14, y, PAL.steel[0], 0.8); face(15, y, PAL.steel[1], 0.8); }
};

/** A door in a side wall, seen from above: a gap in the cap with the door leaf standing open against the jamb. */
const sideDoor: Painter = (cap, face, rand) => {
    solidCap(cap, face, rand);
    for (let y = 2; y < 14; y++) for (let x = 3; x < 13; x++) cap(x, y, step(PAL.marbleCream, 1), 0.3);
    for (let y = 2; y < 14; y++) { cap(3, y, PAL.walnut[5], 1); cap(4, y, PAL.walnut[3], 0.95); }
};

/** Limestone in courses with a darker plinth; the building's face to the street. */
const stoneFace = (face: (x: number, y: number, c: number, h: number) => void, rand: () => number) => {
    for (let y = 0; y < F; y++) for (let x = 0; x < TILE; x++) {
        const course = Math.floor(y / 4);
        const joint = y % 4 === 3 || (x + (course % 2) * 8) % 16 === 0;
        let c = joint ? PAL.limestone[2] : step(PAL.limestone, rand() > 0.85 ? 5 : 4);
        if (y === 0) c = PAL.limestone[5];
        if (y >= F - 3) c = y === F - 3 ? PAL.limestone[3] : PAL.limestone[2];
        face(x, y, c, joint ? 0.4 : 0.7);
    }
};

const pier: Painter = (cap, face, rand) => {
    thinCap(cap, face, rand);
    stoneFace(face, rand);
};

/**
 * Glass is drawn partly see-through, so the lobby floor behind the shop front shows; frames and blinds are solid. From
 * the sunny street the interior looks darker than outside, so the tint is strong and the reflections sparse.
 */
const GLASS_ALPHA = 190;
const REFLECTION_ALPHA = 140;

const windowBlock: Painter = (cap, face, rand) => {
    thinCap(cap, face, rand);
    for (let y = 0; y < F; y++) for (let x = 0; x < TILE; x++) {
        if (y >= F - 4) { face(x, y, y === F - 4 ? PAL.limestone[5] : PAL.limestone[3], 0.75); continue; }
        if (y < 2) { face(x, y, y === 0 ? PAL.limestone[5] : PAL.limestone[3], 0.8); continue; }
        // One slim mullion per tile; the stone piers frame each run of windows.
        if (y === 2 || x === TILE - 1) { face(x, y, PAL.walnut[1], 0.7); continue; }
        // Blinds half-drawn at the top, then glass with the sky's reflection streaking across it.
        if (y < 6) { face(x, y, y % 2 === 0 ? PAL.paper[1] : PAL.paper[0], 0.55); continue; }
        const streak = (x - y + 32) % 13 === 0;
        face(x, y, streak ? PAL.glass[3] : PAL.glass[0], 0.5, streak ? REFLECTION_ALPHA : GLASS_ALPHA);
    }
};

const glyphs: Record<string, string[]> = { B: ['##.', '###', '##.'], A: ['.#.', '###', '#.#'], N: ['#.#', '###', '#.#'], K: ['#.#', '##.', '#.#'] };

const doorGlass = (side: 'left' | 'right'): Painter => (cap, face, rand) => {
    thinCap(cap, face, rand);
    for (let y = 0; y < F; y++) for (let x = 0; x < TILE; x++) {
        const inner = side === 'left' ? TILE - 1 - x : x;
        if (y < 2) { face(x, y, y === 0 ? PAL.limestone[5] : PAL.limestone[3], 0.8); continue; }
        if (y === 2 || y === 7 || y === F - 1 || inner === 0 || inner === TILE - 1) { face(x, y, PAL.walnut[1], 0.7); continue; }
        // Transom with gold leaf, then the door's glass.
        if (y < 7) { face(x, y, PAL.glass[0], 0.5); continue; }
        const streak = (x - y + 32) % 11 === 0;
        face(x, y, streak ? PAL.glass[3] : PAL.glass[0], 0.5, streak ? REFLECTION_ALPHA : GLASS_ALPHA);
    }
    const word = side === 'left' ? 'BA' : 'NK';
    [...word].forEach((ch, i) => glyphs[ch]!.forEach((row, gy) => [...row].forEach((on, gx) => {
        if (on === '#') face((side === 'left' ? 8 : 1) + i * 4 + gx, 3 + gy, gy === 0 ? PAL.brass[5] : PAL.brass[4], 0.6);
    })));
    // Brass push bar towards the meeting stiles.
    const bx = side === 'left' ? 11 : 2;
    for (let x = bx; x < bx + 3; x++) { face(x, 14, PAL.brass[5], 0.8); face(x, 15, PAL.brass[2], 0.75); }
};

/** Through-the-wall ATM in a stone pier; its screen at face (4..11, 8..11) is a glow sprite. */
const atm: Painter = (cap, face, rand) => {
    pier(cap, face, rand);
    for (let y = 5; y < 19; y++) for (let x = 2; x < 14; x++) {
        let c: number = y === 5 || x === 2 || x === 13 ? PAL.steel[1] : PAL.steel[3];
        if (y === 6 && x > 2 && x < 13) c = PAL.steel[4];
        if (y >= 7 && y <= 12 && x >= 4 && x <= 11) c = PAL.steel[0];
        if (y === 15 && x >= 5 && x <= 10) c = PAL.steel[5];
        if (y === 17 && x >= 4 && x <= 11) c = mix(PAL.steel[2], PAL.ink, 0.4);
        face(x, y, c, y === 5 ? 0.9 : 0.8);
    }
};

const PAINTERS: Record<WallBlockName, Painter> = {
    cap: solidCap, sideDoor, face: interiorFace, doorWood, doorKeycard,
    pier, window: windowBlock, doorGlassLeft: doorGlass('left'), doorGlassRight: doorGlass('right'), atm
};

export const WALL_BLOCK_INDEX = Object.fromEntries(WALL_BLOCK_NAMES.map((n, i) => [n, i])) as Record<WallBlockName, number>;

/** Paints every wall block side by side, each 16 wide and `BLOCK_HEIGHT` tall: cap on top, face below. */
export function bankWalls(): PixelBitmap {
    const bitmap = new PixelBitmap(TILE * WALL_BLOCK_NAMES.length, BLOCK_HEIGHT);
    const rand = mulberry32(777);
    WALL_BLOCK_NAMES.forEach((name, i) => {
        const ox = i * TILE;
        const cap = (x: number, y: number, c: number, h: number, a = 255) => bitmap.set(ox + x, y, c, h, a);
        const face = (x: number, y: number, c: number, h: number, a = 255) => bitmap.set(ox + x, TILE + y, c, h, a);
        PAINTERS[name](cap, face, rand);
    });
    return bitmap;
}
