import { TILE } from '../../level/level';
import { WALL_HEIGHT } from '../../level/space';
import { WALL_THICKNESS, type Wall, type WallKind } from '../../level/walls';
import { PAL, mix, step } from '../palette';
import { PixelBitmap } from '../PixelBitmap';
import { mulberry32 } from '../random';

/*
 * Wall segments, drawn at whatever height the camera has them at (see `WALL_STEPS`). Everything on a face is placed by
 * its height above the floor, so cutting a wall lower only takes rows off its top. The top of a wall is always where it
 * is cut, so it shows the wall in section, darker than any finished surface and hatched like an architect's plan: that
 * is what tells a full wall from half cover, whatever its height. Walls follow the floor grid and their tops are not
 * foreshortened.
 */

/** Paints one pixel of a wall's face: column u, height z above the floor (1 is the lowest). */
type FacePaint = (u: number, z: number, c: number, height: number, alpha?: number) => void;
/** Paints one pixel of its section: u across the wall's run, v through its thickness from the north. */
type SectionPaint = (u: number, v: number, c: number) => void;

interface Painter {
    /** The cut top. For a north-south segment u runs down its length and v across its thickness, west to east. */
    section: (put: SectionPaint, t: number, length: number, rand: () => number) => void;
    /** The south face, `TILE` wide; a north-south segment shows only the end of its run, `t` wide, sampled from it. */
    face: (put: FacePaint, rand: () => number) => void;
}

const F = WALL_HEIGHT;

/** Plaster skins on a brick core, the core hatched diagonally. */
const plasterSection: Painter['section'] = (put, t, length) => {
    for (let v = 0; v < t; v++) for (let u = 0; u < length; u++) {
        const skin = v === 0 || v === t - 1;
        put(u, v, skin ? (v === t - 1 ? PAL.plaster[3] : PAL.plaster[1]) : (u + v) % 3 === 0 ? PAL.terracotta[1] : PAL.terracotta[0]);
    }
};

/** Concrete stippled with aggregate between two painted skins. */
const concreteSection: Painter['section'] = (put, t, length, rand) => {
    for (let v = 0; v < t; v++) for (let u = 0; u < length; u++) {
        const skin = v === 0 || v === t - 1;
        put(u, v, skin ? (v === t - 1 ? PAL.concrete[4] : PAL.concrete[2]) : rand() > 0.75 ? PAL.concrete[2] : PAL.concrete[1]);
    }
};

/** A door cut through: the jambs in the wall's section at its ends, the leaf in between. */
const doorSection = (leaf: number, edge: number): Painter['section'] => (put, t, length, rand) => {
    plasterSection(put, t, length, rand);
    for (let u = 2; u < length - 2; u++) for (let v = 0; v < t; v++) put(u, v, v === t - 1 ? edge : leaf);
};

/** The shop front's limestone, its street side lit. */
const stoneSection: Painter['section'] = (put, t, length) => {
    for (let v = 0; v < t; v++) for (let u = 0; u < length; u++) put(u, v, v === t - 1 ? PAL.limestone[5] : (u + v) % 4 === 0 ? PAL.limestone[1] : PAL.limestone[2]);
};

/** Glass between its frames: a thin bright line of pane in dark wood. */
const glassSection: Painter['section'] = (put, t, length) => {
    for (let v = 0; v < t; v++) for (let u = 0; u < length; u++) {
        const frame = u === 0 || u === length - 1 || u === TILE / 2;
        put(u, v, frame ? PAL.walnut[1] : v === Math.floor(t / 2) ? PAL.glass[4] : v === t - 1 ? PAL.limestone[4] : PAL.walnut[1]);
    }
};

/** Inside the bank: plaster above a walnut wainscot with a brass chair rail and a dark skirting board. */
const interiorFace: Painter['face'] = (put, rand) => {
    for (let z = 1; z <= F; z++) for (let u = 0; u < TILE; u++) {
        if (z <= 3) put(u, z, PAL.walnut[0], 0.5);
        else if (z <= 10) put(u, z, u % 8 === 0 ? PAL.walnut[1] : u % 8 === 1 ? PAL.walnut[4] : PAL.walnut[3], 0.5);
        else if (z === 11) put(u, z, PAL.brass[3], 0.7);
        else put(u, z, step(PAL.plaster, rand() > 0.92 ? 4 : 3), 0.5);
    }
};

/** The vault side of the corridor: painted concrete block, a darker dado and a yellow safety line. */
const concreteFace: Painter['face'] = put => {
    for (let z = 1; z <= F; z++) for (let u = 0; u < TILE; u++) {
        if (z <= 2) put(u, z, PAL.concrete[1], 0.5);
        else if (z <= 9) put(u, z, z === 9 ? PAL.concrete[3] : PAL.concrete[2], 0.5);
        else if (z === 10) put(u, z, PAL.cloth.mustard[3]!, 0.6);
        else {
            const course = Math.floor((z - 11) / 4), joint = (z - 11) % 4 === 3 || (u + (course % 2) * 8) % 16 === 0;
            put(u, z, joint ? PAL.concrete[3] : PAL.concrete[4], joint ? 0.4 : 0.6);
        }
    }
};

/** Doors are about 2m tall, taller than the cut, so they reach from the floor to the top of a full wall. */
const doorWood: Painter['face'] = (put, rand) => {
    interiorFace(put, rand);
    for (let z = 1; z <= F - 1; z++) for (let u = 2; u < 14; u++) {
        const frame = u === 2 || u === 13 || z === F - 1;
        const panel = (u === 5 || u === 10) && z > 2 && z < F - 3;
        put(u, z, frame ? PAL.walnut[1] : panel ? PAL.walnut[2] : PAL.walnut[4], frame ? 0.7 : 0.55);
    }
    for (let u = 6; u < 10; u++) { put(u, F - 4, PAL.brass[4], 0.7); put(u, F - 5, PAL.brass[3], 0.7); }
    put(11, 9, PAL.brass[5], 0.8);
};

/** A steel staff door with a wired-glass vision panel and a card reader on its frame (its LED is a prop). */
const doorKeycard: Painter['face'] = (put, rand) => {
    interiorFace(put, rand);
    for (let z = 1; z <= F - 1; z++) for (let u = 2; u < 14; u++) {
        const frame = u === 2 || u === 13 || z === F - 1;
        put(u, z, frame ? PAL.steel[1] : step(PAL.steel, u < 7 ? 3 : 2), frame ? 0.7 : 0.55);
    }
    for (let z = 12; z <= 15; z++) for (let u = 5; u < 11; u++) put(u, z, z === 15 ? PAL.glass[3] : PAL.glass[1], 0.5);
    put(11, 9, PAL.steel[5], 0.8);
    put(11, 8, PAL.steel[5], 0.8);
    for (let z = 11; z <= 13; z++) { put(14, z, PAL.steel[0], 0.8); put(15, z, PAL.steel[1], 0.8); }
};

/** Limestone in courses with a darker plinth: the building's face to the street. */
const stoneFace: Painter['face'] = (put, rand) => {
    for (let z = 1; z <= F; z++) for (let u = 0; u < TILE; u++) {
        const course = Math.floor((F - z) / 4);
        const joint = (F - z) % 4 === 3 || (u + (course % 2) * 8) % 16 === 0;
        let c = joint ? PAL.limestone[2] : step(PAL.limestone, rand() > 0.85 ? 5 : 4);
        if (z <= 3) c = z === 3 ? PAL.limestone[3] : PAL.limestone[2];
        put(u, z, c, joint ? 0.4 : 0.7);
    }
};

/**
 * Glass is partly see-through, so the lobby floor behind the shop front shows; frames and blinds are solid. From the
 * sunny street the interior looks darker than outside, so the tint is strong and the reflections sparse.
 */
const GLASS_ALPHA = 190;
const REFLECTION_ALPHA = 140;

const windowFace: Painter['face'] = put => {
    for (let z = 1; z <= F; z++) for (let u = 0; u < TILE; u++) {
        if (z <= 4) { put(u, z, z === 4 ? PAL.limestone[5] : PAL.limestone[3], 0.75); continue; }
        if (z >= F - 1) { put(u, z, z === F ? PAL.limestone[5] : PAL.limestone[3], 0.8); continue; }
        // One slim mullion per tile; the stone piers frame each run of windows.
        if (z === F - 2 || u === TILE - 1) { put(u, z, PAL.walnut[1], 0.7); continue; }
        // Blinds half drawn at the top, then glass with the sky's reflection streaking across it.
        if (z >= F - 5) { put(u, z, z % 2 === 0 ? PAL.paper[1] : PAL.paper[0], 0.55); continue; }
        const streak = (u + z + 8) % 13 === 0;
        put(u, z, streak ? PAL.glass[3] : PAL.glass[0], 0.5, streak ? REFLECTION_ALPHA : GLASS_ALPHA);
    }
};

const glyphs: Record<string, string[]> = { B: ['##.', '###', '##.'], A: ['.#.', '###', '#.#'], N: ['#.#', '###', '#.#'], K: ['#.#', '##.', '#.#'] };

/** One leaf of the glass double doors, "BA" or "NK" in gold leaf on its transom. */
const doorGlass = (side: 'left' | 'right'): Painter['face'] => put => {
    for (let z = 1; z <= F; z++) for (let u = 0; u < TILE; u++) {
        const inner = side === 'left' ? TILE - 1 - u : u;
        if (z >= F - 1) { put(u, z, z === F ? PAL.limestone[5] : PAL.limestone[3], 0.8); continue; }
        if (z === F - 2 || z === F - 7 || z === 1 || inner === 0 || inner === TILE - 1) { put(u, z, PAL.walnut[1], 0.7); continue; }
        if (z > F - 7) { put(u, z, PAL.glass[0], 0.5); continue; }
        const streak = (u + z + 8) % 11 === 0;
        put(u, z, streak ? PAL.glass[3] : PAL.glass[0], 0.5, streak ? REFLECTION_ALPHA : GLASS_ALPHA);
    }
    [...(side === 'left' ? 'BA' : 'NK')].forEach((ch, i) => glyphs[ch]!.forEach((row, gy) => [...row].forEach((on, gx) => {
        if (on === '#') put((side === 'left' ? 8 : 1) + i * 4 + gx, F - 3 - gy, gy === 0 ? PAL.brass[5] : PAL.brass[4], 0.6);
    })));
    const bx = side === 'left' ? 11 : 2;
    for (let u = bx; u < bx + 3; u++) { put(u, 10, PAL.brass[5], 0.8); put(u, 9, PAL.brass[2], 0.75); }
};

/** A through-the-wall cash machine in a stone pier; its screen is a glowing prop over the dark panel. */
const atmFace: Painter['face'] = (put, rand) => {
    stoneFace(put, rand);
    for (let z = 6; z <= 19; z++) for (let u = 2; u < 14; u++) {
        let c: number = z === 19 || u === 2 || u === 13 ? PAL.steel[1] : PAL.steel[3];
        if (z === 18 && u > 2 && u < 13) c = PAL.steel[4];
        if (z >= 12 && z <= 17 && u >= 4 && u <= 11) c = PAL.steel[0];
        if (z === 9 && u >= 5 && u <= 10) c = PAL.steel[5];
        if (z === 7 && u >= 4 && u <= 11) c = mix(PAL.steel[2], PAL.ink, 0.4);
        put(u, z, c, z === 19 ? 0.9 : 0.8);
    }
};

const PAINTERS: Record<Exclude<WallKind, 'doorGlass'>, Painter> & { doorGlassLeft: Painter; doorGlassRight: Painter } = {
    plaster: { section: plasterSection, face: interiorFace },
    concrete: { section: concreteSection, face: concreteFace },
    doorWood: { section: doorSection(PAL.walnut[3], PAL.walnut[5]), face: doorWood },
    doorKeycard: { section: doorSection(PAL.steel[2], PAL.steel[4]), face: doorKeycard },
    pier: { section: stoneSection, face: stoneFace },
    window: { section: glassSection, face: windowFace },
    doorGlassLeft: { section: glassSection, face: doorGlass('left') },
    doorGlassRight: { section: glassSection, face: doorGlass('right') },
    atm: { section: stoneSection, face: atmFace }
};

/** Which drawing a segment takes: its kind, except that the two leaves of a glass double door differ. */
export type WallLook = keyof typeof PAINTERS;

export function wallLook(wall: Wall, walls: readonly Wall[]): WallLook {
    if (wall.kind !== 'doorGlass') return wall.kind;
    const westIsDoor = walls.some(w => w.kind === 'doorGlass' && w.run === wall.run && w.tx === wall.tx - 1 && w.ty === wall.ty);
    return westIsDoor ? 'doorGlassRight' : 'doorGlassLeft';
}

/**
 * A wall segment cut at `height`. East-west: its section (as deep as the wall is thick) over its face. North-south:
 * its section a tile long, then the end of its face, which the next segment of the run covers. The bitmap's bottom edge
 * is the segment's south edge at floor level.
 */
export function wallArt(wall: Wall, look: WallLook, height: number): PixelBitmap {
    const t = WALL_THICKNESS[wall.kind], painter = PAINTERS[look], rand = mulberry32(look.length * 97 + t);
    const eastWest = wall.run === 'eastWest';
    const top = eastWest ? t : TILE, bitmap = new PixelBitmap(eastWest ? TILE : t, top + height);
    painter.section((u, v, c) => (eastWest ? bitmap.set(u, v, c, 1) : bitmap.set(v, u, c, 1)), t, TILE, rand);
    painter.face((u, z, c, h, alpha) => {
        if (z > height) return;
        if (eastWest) bitmap.set(u, top + height - z, c, h, alpha);
        else if (u < t) bitmap.set(u, top + height - z, c, h, alpha);
    }, rand);
    return bitmap;
}
