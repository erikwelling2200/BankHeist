import { TILE } from '../../level/level';
import { px, WALL_HEIGHT } from '../../level/space';
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

/** The sill under a door's leaf: the threshold its leaf closes on, laid into the floor through the wall. */
export const DOOR_SILL: Partial<Record<WallKind, number>> = {
    doorWood: PAL.oak[4], doorKeycard: PAL.steel[4], doorBack: PAL.concrete[4], doorService: PAL.limestone[3], doorGlass: PAL.limestone[3],
    doorTower: PAL.steel[4], vaultDoor: PAL.steel[3], shutter: PAL.concrete[3]
};

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
const doorSection = (leaf: number, edge: number, wall: Painter['section'] = plasterSection): Painter['section'] => (put, t, length, rand) => {
    wall(put, t, length, rand);
    for (let u = 2; u < length - 2; u++) for (let v = 0; v < t; v++) put(u, v, v === t - 1 ? edge : leaf);
};

/** The shop front's limestone, its street side lit. */
const stoneSection: Painter['section'] = (put, t, length) => {
    for (let v = 0; v < t; v++) for (let u = 0; u < length; u++) put(u, v, v === t - 1 ? PAL.limestone[5] : (u + v) % 4 === 0 ? PAL.limestone[1] : PAL.limestone[2]);
};

/** Brick laid in stretcher bond, the core hatched. */
const brickSection: Painter['section'] = (put, t, length) => {
    for (let v = 0; v < t; v++) for (let u = 0; u < length; u++) put(u, v, v === t - 1 ? PAL.brick[4] : (u + v) % 3 === 0 ? PAL.brick[1] : PAL.brick[2]);
};

/** The vault's steel: two plates with a dark filling, riveted through. */
const vaultSection: Painter['section'] = (put, t, length) => {
    for (let v = 0; v < t; v++) for (let u = 0; u < length; u++) {
        const skin = v === 0 || v === t - 1;
        put(u, v, skin ? (v === t - 1 ? PAL.steel[4] : PAL.steel[2]) : u % 4 === 1 && v === Math.floor(t / 2) ? PAL.steel[3] : PAL.steel[0]);
    }
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

/** Brick in stretcher bond, each brick its own shade, over a concrete plinth: the outside of a building. */
const brickFace: Painter['face'] = (put, rand) => {
    const shades = Array.from({ length: 64 }, () => (rand() > 0.8 ? 3 : rand() > 0.5 ? 2 : rand() > 0.15 ? 3 : 1));
    for (let z = 1; z <= F; z++) for (let u = 0; u < TILE; u++) {
        if (z <= 2) { put(u, z, z === 2 ? PAL.concrete[3] : PAL.concrete[2], 0.5); continue; }
        const course = Math.floor((z - 3) / 3), mortar = (z - 3) % 3 === 2 || (u + (course % 2) * 4) % 8 === 0;
        put(u, z, mortar ? PAL.concrete[2] : PAL.brick[shades[(course * 3 + Math.floor((u + (course % 2) * 4) / 8)) % 64]!]!, mortar ? 0.35 : 0.65);
    }
};

/** Riveted steel plates with a dark kick plate: the vault from the antechamber. */
const vaultFace: Painter['face'] = put => {
    for (let z = 1; z <= F; z++) for (let u = 0; u < TILE; u++) {
        if (z <= 2) { put(u, z, PAL.steel[1], 0.5); continue; }
        const seamU = u % 8 === 0, seamZ = (z - 3) % 7 === 6;
        const rivet = (u % 8 === 2 || u % 8 === 6) && ((z - 3) % 7 === 0 || (z - 3) % 7 === 5);
        put(u, z, seamU || seamZ ? PAL.steel[1] : rivet ? PAL.steel[5] : (z - 3) % 7 === 5 ? PAL.steel[3] : PAL.steel[2], rivet ? 0.9 : 0.6);
    }
};

/**
 * One half of the round vault door, centred on the line between the two segments: a riveted rim, the polished door,
 * the bolt-wheel at its middle.
 */
const vaultDoor = (side: 'left' | 'right'): Painter['face'] => (put, rand) => {
    vaultFace(put, rand);
    const cx = side === 'left' ? TILE : 0, cz = 12;
    for (let z = 1; z <= F; z++) for (let u = 0; u < TILE; u++) {
        const d = Math.hypot(u + 0.5 - cx, z - 0.5 - cz);
        if (d > 11.5) continue;
        let c: number = d > 10.5 ? PAL.steel[1] : d > 9.5 ? (Math.round(Math.atan2(z - cz, u - cx) * 4) % 2 ? PAL.steel[5] : PAL.steel[3]) : PAL.steel[3];
        if (d <= 9.5 && z > cz + 3) c = PAL.steel[4];
        if (d <= 4.5 && d > 3.5) c = PAL.brass[3];
        if (d <= 4.5 && (Math.abs(u + 0.5 - cx) < 1 || Math.abs(z - 0.5 - cz) < 1)) c = PAL.brass[4];
        if (d <= 1) c = PAL.brass[5];
        put(u, z, c, d > 10.5 ? 0.5 : 0.85);
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

/** A steel service door in the stone front, with a push bar and a keypad. */
const doorService: Painter['face'] = (put, rand) => {
    stoneFace(put, rand);
    for (let z = 1; z <= F - 2; z++) for (let u = 2; u < 14; u++) {
        const frame = u === 2 || u === 13 || z === F - 2;
        put(u, z, frame ? PAL.steel[1] : step(PAL.steel, u < 6 ? 3 : 2), frame ? 0.7 : 0.55);
    }
    for (let u = 4; u < 12; u++) put(u, 10, PAL.steel[5], 0.8);
    put(14, 12, PAL.ink, 0.8);
    put(14, 13, PAL.emissive.ledGreen, 0.8);
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

/** A brick pier between a neighbour's windows, a stone band at its top. */
const brickPier: Painter['face'] = (put, rand) => {
    brickFace(put, rand);
    for (let u = 0; u < TILE; u++) { put(u, F, PAL.limestone[5], 0.8); put(u, F - 1, PAL.limestone[3], 0.8); }
};

/** A shop window boarded up with plywood: brick reveals, three sheets nailed across, a faded "to let" card. */
const boarded: Painter['face'] = (put, rand) => {
    brickPier(put, rand);
    for (let z = 4; z <= F - 3; z++) for (let u = 1; u < TILE - 1; u++) {
        const sheet = Math.floor((z - 4) / 6), seam = (z - 4) % 6 === 5;
        const nail = (u === 2 || u === TILE - 3) && (z - 4) % 6 === 1;
        put(u, z, seam ? PAL.plywood[1] : nail ? PAL.steel[1] : step(PAL.plywood, sheet % 2 ? 2 : 3), 0.6);
    }
    for (let z = 12; z <= 15; z++) for (let u = 5; u < 11; u++) put(u, z, z === 15 ? PAL.paper[1] : z === 13 && u > 5 && u < 10 ? PAL.carpet[2] : PAL.paper[2], 0.65);
};

/** A rolling steel shutter pulled down over the shop door: ribbed slats under its box, a padlock, a scrawl of paint. */
const shutter: Painter['face'] = (put, rand) => {
    brickPier(put, rand);
    for (let z = 1; z <= F - 2; z++) for (let u = 1; u < TILE - 1; u++) {
        let c: number = z >= F - 4 ? PAL.steel[1] : z % 2 ? PAL.steel[3] : PAL.steel[2];
        if (z === 1) c = PAL.steel[0];
        if (z >= 7 && z <= 9 && u >= 3 && u <= 11 && (u + z) % 3 !== 0) c = z === 8 ? PAL.cloth.teal[3]! : PAL.carpet[3];
        put(u, z, c, z % 2 ? 0.6 : 0.5);
    }
    put(8, 3, PAL.brass[3], 0.8);
};

/** An office tower's curtain wall in section: aluminium mullions, the glass between them. */
const curtainSection: Painter['section'] = (put, t, length) => {
    for (let v = 0; v < t; v++) for (let u = 0; u < length; u++) put(u, v, u % 8 === 0 ? PAL.steel[3] : v === Math.floor(t / 2) ? PAL.glass[4] : PAL.steel[1]);
};

/**
 * The curtain wall from inside: floor-to-ceiling glass in aluminium mullions, a transom at door height and a grey sill
 * at the floor. Daylight from the street makes the glass pale; the sidewalk behind shows through it.
 */
const curtainFace: Painter['face'] = put => {
    for (let z = 1; z <= F; z++) for (let u = 0; u < TILE; u++) {
        if (z <= 2) { put(u, z, z === 2 ? PAL.steel[4] : PAL.steel[2], 0.7); continue; }
        if (u % 8 === 0 || z === F - 3) { put(u, z, u % 8 === 0 ? PAL.steel[3] : PAL.steel[4], 0.75); continue; }
        const streak = (u - z + 40) % 9 === 0;
        put(u, z, streak ? PAL.glass[5] : PAL.glass[3], 0.5, streak ? REFLECTION_ALPHA : 120);
    }
};

/** One leaf of the tower's glass doors: an aluminium frame, a push bar across, the glass. */
const doorTower: Painter['face'] = put => {
    for (let z = 1; z <= F; z++) for (let u = 0; u < TILE; u++) {
        if (z >= F - 2 || z === 1 || u <= 1 || u >= TILE - 2) { put(u, z, z === F ? PAL.steel[5] : u === 1 || u === TILE - 2 ? PAL.steel[4] : PAL.steel[2], 0.75); continue; }
        if (z === 9 && u >= 3 && u <= TILE - 4) { put(u, z, PAL.steel[5], 0.85); continue; }
        const streak = (u - z + 40) % 9 === 0;
        put(u, z, streak ? PAL.glass[5] : PAL.glass[3], 0.5, streak ? REFLECTION_ALPHA : 110);
    }
};

/** A railing's height: a metre, so it never needs cutting down. */
export const RAIL_HEIGHT = px(1.0);

/** The handrail's top. */
const railSection: Painter['section'] = (put, t, length) => {
    for (let v = 0; v < t; v++) for (let u = 0; u < length; u++) put(u, v, PAL.steel[5]);
};

/** A steel railing across the view: posts every quarter tile, a mid-rail, the handrail on top; open between them. */
const railFace: Painter['face'] = put => {
    for (let z = 1; z <= RAIL_HEIGHT; z++) for (let u = 0; u < TILE; u++) {
        if (z === RAIL_HEIGHT) put(u, z, PAL.steel[4], 0.8);
        else if (z === 6) put(u, z, PAL.steel[3], 0.7);
        else if (u % 4 === 1) put(u, z, u % 8 === 1 ? PAL.steel[3] : PAL.steel[2], 0.7);
    }
};

/** A building site's fence: a little taller than a full wall, so like the railing it is never cut down. */
export const FENCE_HEIGHT = px(2.0);

/** The fence's top tube, a clamp over the post at each panel's end. */
const fenceSection: Painter['section'] = (put, t, length) => {
    for (let v = 0; v < t; v++) for (let u = 0; u < length; u++) put(u, v, u === 1 ? PAL.steel[5] : PAL.steel[4]);
};

/** Chain-link mesh is see-through: a tint of galvanised wire over whatever stands behind it. */
const MESH_ALPHA = 175;
const mesh = (u: number, z: number) => (u + z) % 4 === 0 || (u - z + 64) % 4 === 0;

/**
 * A chain-link site fence across the view: a galvanised post in a concrete foot at each panel's end, the top tube, a
 * tension wire low down, and the diamond mesh between them, open in the middle of every diamond.
 */
const fenceFace: Painter['face'] = put => {
    const H = FENCE_HEIGHT;
    for (let z = 1; z <= H; z++) for (let u = 0; u < TILE; u++) {
        if (z <= 2 && u <= 2) put(u, z, z === 2 ? PAL.concrete[4] : u === 2 ? PAL.concrete[1] : PAL.concrete[2], 0.6);
        else if (u === 1) put(u, z, z % 6 === 0 ? PAL.steel[5] : PAL.steel[3], 0.75);
        else if (z === H) put(u, z, PAL.steel[4], 0.8);
        else if (z === H - 1) put(u, z, PAL.steel[2], 0.7);
        else if (z === 3) put(u, z, PAL.steel[2], 0.6, MESH_ALPHA);
        else if (mesh(u, z)) put(u, z, z > H - 6 ? PAL.steel[4] : PAL.steel[3], 0.6, MESH_ALPHA);
    }
};

/**
 * The fence running north-south, seen end-on: its mesh is edge-on, a faint line; the post at the north end of each
 * panel and the top tube along it show as they do on the railing (run position u, height z lands on row u + height + 1 - z).
 */
function sideFence(bitmap: PixelBitmap, m: number, height: number): void {
    const row = (u: number, z: number) => u + height + 1 - z;
    for (let u = 0; u < TILE; u++) for (let z = 3; z < height; z += 2) bitmap.set(m, row(u, z), PAL.steel[3], 0.6, MESH_ALPHA);
    for (let z = 1; z <= height; z++) bitmap.set(m, row(1, z), z <= 2 ? PAL.concrete[3] : PAL.steel[3], 0.75);
    for (let u = 0; u < TILE; u++) bitmap.set(m, row(u, height), u === 1 ? PAL.steel[5] : PAL.steel[4], 0.8);
}

/**
 * A steel back door in brick: a concrete lintel over it, the leaf painted a dull green with a kick plate, hinges on its
 * west side and a pull handle on its east side; the keypad, its LED lit, on the brick beside it.
 */
const doorBack: Painter['face'] = (put, rand) => {
    brickFace(put, rand);
    const paint = (i: number) => mix(PAL.leaf[i]!, PAL.steel[i]!, 0.55);
    for (let u = 1; u < 15; u++) for (const z of [F - 1, F]) put(u, z, z === F ? PAL.concrete[4] : PAL.concrete[2], 0.7);
    for (let z = 1; z <= F - 2; z++) for (let u = 2; u < 14; u++) {
        const frame = u === 2 || u === 13 || z === F - 2;
        let c = frame ? PAL.steel[1] : z <= 2 ? PAL.steel[3] : paint(u < 6 ? 3 : 2);
        if (!frame && z === 3) c = PAL.steel[1];
        if (u === 3 && (z === 5 || z === F - 5)) c = PAL.steel[4];
        put(u, z, c, frame ? 0.7 : 0.55);
    }
    for (let z = 8; z <= 12; z++) put(11, z, z === 12 ? PAL.steel[5] : PAL.steel[4], 0.85);
    put(10, 8, PAL.steel[1], 0.8);
    put(10, 12, PAL.steel[1], 0.8);
    for (let z = 11; z <= 14; z++) { put(14, z, z === 14 ? PAL.steel[4] : PAL.steel[2], 0.8); put(15, z, PAL.steel[1], 0.8); }
    put(14, 13, PAL.emissive.ledGreen, 0.8);
};

/** Dressed stone a little warmer than the shop front's limestone. */
const ashlar = (i: number) => mix(PAL.limestone[i]!, PAL.marbleCream[Math.min(4, i)]!, 0.35);

/** An old bank's metre-thick wall in section: a skin of ashlar each side, the rubble core between them, hatched. */
const thickSection: Painter['section'] = (put, t, length, rand) => {
    const stones = Array.from({ length: 64 }, () => (rand() > 0.5 ? 2 : rand() > 0.4 ? 1 : 3));
    for (let v = 0; v < t; v++) for (let u = 0; u < length; u++) {
        if (v <= 1 || v >= t - 2) {
            const joint = (u + (v <= 1 ? 0 : 6)) % 12 === 0;
            put(u, v, joint ? ashlar(0) : v === t - 1 ? ashlar(5) : v === 0 ? ashlar(1) : ashlar(2));
            continue;
        }
        // Rubble: rough stones about four pixels by two, bedded in dark lime mortar.
        const course = Math.floor((v - 2) / 3), shift = (course * 5) % 4, stone = Math.floor((u + shift) / 4);
        const mortar = (v - 2) % 3 === 2 || (u + shift) % 4 === 0;
        const c = mortar ? PAL.plaster[0] : step(PAL.limestone, stones[(course * 7 + stone) % 64]!);
        put(u, v, mix(c, PAL.ink, (u + v) % 4 === 0 ? 0.4 : 0.22));
    }
};

/**
 * Its face: big ashlar blocks in courses six pixels high, every other course set half a block over, each block drafted
 * (lit along its top, shadowed under it) over a projecting plinth.
 */
const thickFace: Painter['face'] = (put, rand) => {
    const shades = Array.from({ length: 32 }, () => (rand() > 0.7 ? 4 : 3));
    for (let z = 1; z <= F; z++) for (let u = 0; u < TILE; u++) {
        if (z <= 4) { put(u, z, z === 4 ? ashlar(5) : z === 3 ? ashlar(3) : ashlar(2), z === 4 ? 0.85 : 0.6); continue; }
        const course = Math.floor((z - 5) / 6), k = (z - 5) % 6, shift = (course % 2) * 6;
        const block = Math.floor((u + shift) / 12), head = (u + shift) % 12 === 0;
        let c: number, h = 0.7;
        if (k === 0 || head) { c = ashlar(1); h = 0.35; }
        else if (k === 1) c = ashlar(2);
        else if (k === 5) { c = ashlar(5); h = 0.8; }
        else c = (u * 3 + z * 5) % 11 === 0 ? ashlar(2) : ashlar(shades[(course * 3 + block) % 32]!);
        put(u, z, c, h);
    }
};

/** The drive-through window in section: brick at its ends, the glass between the frame's two steel lips. */
const tellerSection: Painter['section'] = (put, t, length, rand) => {
    brickSection(put, t, length, rand);
    for (let u = 3; u < length - 3; u++) for (let v = 0; v < t; v++) put(u, v, v === Math.floor(t / 2) ? PAL.glass[4] : v === t - 1 ? PAL.steel[4] : PAL.steel[1]);
};

/**
 * A drive-through teller window in brick: a steel surround, a sliding glass window in two panes (the near one latched,
 * a speak-through grille set in the other), a ledge, and under it the deal drawer that slides out to the car.
 */
const tellerWindow: Painter['face'] = (put, rand) => {
    brickFace(put, rand);
    for (let u = 1; u < 15; u++) put(u, 21, PAL.concrete[4], 0.75);
    for (let z = 4; z <= 20; z++) for (let u = 2; u < 14; u++) {
        const edge = u === 2 || u === 13 || z === 4 || z === 20;
        if (edge) { put(u, z, z === 20 ? PAL.steel[3] : PAL.steel[1], 0.75); continue; }
        if (z === 10) { put(u, z, PAL.steel[5], 0.85); continue; }
        if (z === 9) { put(u, z, PAL.steel[1], 0.6); continue; }
        if (z < 9) {
            // The deal drawer: its lip lit, a recessed pull, dark gaps round it in the steel panel.
            const drawer = u >= 4 && u <= 11 && z >= 5 && z <= 7;
            const gap = (u === 4 || u === 11) && z >= 5 && z <= 7;
            put(u, z, gap ? PAL.steel[0] : drawer ? (z === 7 ? PAL.steel[4] : z === 6 && u >= 7 && u <= 8 ? PAL.steel[1] : PAL.steel[3]) : PAL.steel[2], drawer ? 0.75 : 0.6);
            continue;
        }
        if (u === 8 || z === 19) { put(u, z, PAL.steel[2], 0.7); continue; }
        if (u === 7 && z <= 18) { put(u, z, PAL.steel[1], 0.65); continue; }
        // The speak-through: a round grille of holes in the west pane.
        const dx = u - 4.5, dz = z - 14.5;
        if (dx * dx + dz * dz <= 2.6) { put(u, z, (u + z) % 2 ? PAL.steel[1] : PAL.steel[4], 0.7); continue; }
        if (u === 11 && z === 14) { put(u, z, PAL.steel[5], 0.8); continue; }
        const streak = (u + z + 6) % 9 === 0;
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

const PAINTERS: Record<Exclude<WallKind, 'doorGlass' | 'vaultDoor'>, Painter> & Record<'doorGlassLeft' | 'doorGlassRight' | 'vaultDoorLeft' | 'vaultDoorRight', Painter> = {
    plaster: { section: plasterSection, face: interiorFace },
    concrete: { section: concreteSection, face: concreteFace },
    vault: { section: vaultSection, face: vaultFace },
    vaultDoorLeft: { section: vaultSection, face: vaultDoor('left') },
    vaultDoorRight: { section: vaultSection, face: vaultDoor('right') },
    brick: { section: brickSection, face: brickFace },
    doorService: { section: stoneSection, face: doorService },
    brickPier: { section: brickSection, face: brickPier },
    boarded: { section: brickSection, face: boarded },
    shutter: { section: brickSection, face: shutter },
    doorWood: { section: doorSection(PAL.walnut[3], PAL.walnut[5]), face: doorWood },
    doorKeycard: { section: doorSection(PAL.steel[2], PAL.steel[4]), face: doorKeycard },
    pier: { section: stoneSection, face: stoneFace },
    window: { section: glassSection, face: windowFace },
    doorGlassLeft: { section: glassSection, face: doorGlass('left') },
    doorGlassRight: { section: glassSection, face: doorGlass('right') },
    atm: { section: stoneSection, face: atmFace },
    curtain: { section: curtainSection, face: curtainFace },
    doorTower: { section: curtainSection, face: doorTower },
    rail: { section: railSection, face: railFace },
    fence: { section: fenceSection, face: fenceFace },
    doorBack: { section: doorSection(PAL.steel[2], PAL.steel[4], brickSection), face: doorBack },
    thick: { section: thickSection, face: thickFace },
    tellerWindow: { section: tellerSection, face: tellerWindow }
};

export type WallLook = keyof typeof PAINTERS;

/** Which drawing a segment takes: its kind, except that the two leaves of a glass double door, and the two halves of the vault door, differ. */
export function wallLook(wall: Wall, walls: readonly Wall[]): WallLook {
    if (wall.kind !== 'doorGlass' && wall.kind !== 'vaultDoor') return wall.kind;
    const westIsSame = walls.some(w => w.kind === wall.kind && w.run === wall.run && w.tx === wall.tx - 1 && w.ty === wall.ty);
    if (wall.kind === 'vaultDoor') return westIsSame ? 'vaultDoorRight' : 'vaultDoorLeft';
    return westIsSame ? 'doorGlassRight' : 'doorGlassLeft';
}

/** Doors whose casings and handles stand proud of the wall: seen side-on, they are what shows the door. */
const SIDE_DOORS: Partial<Record<WallKind, { casing: number; edge: number; handle: number; sill: number }>> = {
    doorWood: { casing: PAL.walnut[1], edge: PAL.walnut[4], handle: PAL.brass[5], sill: PAL.oak[4] },
    doorKeycard: { casing: PAL.steel[1], edge: PAL.steel[4], handle: PAL.steel[5], sill: PAL.steel[4] },
    doorBack: { casing: PAL.steel[1], edge: PAL.steel[3], handle: PAL.steel[5], sill: PAL.concrete[4] }
};

/** The threshold under a north-south door, laid into the floor a little wider than the wall: its colour, if it has one. */
export function doorSill(wall: Wall): number | undefined {
    return wall.run === 'northSouth' ? SIDE_DOORS[wall.kind]?.sill : undefined;
}

/**
 * How far a segment's art reaches past its footprint on each side: a north-south door's casing and handles, and a
 * north-south railing's handrail and posts, drawn wider than the pixel its footprint is so it reads as a railing.
 */
export function wallMargin(wall: Wall): number {
    if (wall.run !== 'northSouth') return 0;
    return SIDE_DOORS[wall.kind] ? 3 : wall.kind === 'rail' ? 2 : 0;
}

/**
 * A wall segment cut at `height`. East-west: its section (as deep as the wall is thick) over its face. North-south:
 * its section a tile long, then the end of its face, which the next segment of the run covers. The bitmap's bottom edge
 * is the segment's south edge at floor level; it reaches `wallMargin` past the footprint on each side.
 */
export function wallArt(wall: Wall, look: WallLook, cut: number): PixelBitmap {
    const height = wallHeight(wall.kind, cut);
    const t = WALL_THICKNESS[wall.kind], painter = PAINTERS[look], rand = mulberry32(look.length * 97 + t);
    const eastWest = wall.run === 'eastWest', m = wallMargin(wall);
    const top = eastWest ? t : TILE, bitmap = new PixelBitmap(eastWest ? TILE : t + 2 * m, top + height);
    painter.section((u, v, c) => (eastWest ? bitmap.set(u, v, c, 1) : bitmap.set(m + v, u, c, 1)), t, TILE, rand);
    painter.face((u, z, c, h, alpha) => {
        if (z > height) return;
        if (eastWest) bitmap.set(u, top + height - z, c, h, alpha);
        else if (u < t) bitmap.set(m + u, top + height - z, c, h, alpha);
    }, rand);
    const door = SIDE_DOORS[wall.kind];
    if (!eastWest && door) sideDoor(bitmap, door, t, m, height);
    if (!eastWest && wall.kind === 'rail') sideRail(bitmap, m, height);
    if (!eastWest && wall.kind === 'fence') sideFence(bitmap, m, height);
    return bitmap;
}

/**
 * The colours, heights and alphas a segment's face painter puts at each column u and height z (1 to `WALL_HEIGHT`), the
 * same as `wallArt` paints them: for drawing a door's leaf, swung open, with its own face.
 */
export function faceColours(wall: Wall, look: WallLook): (u: number, z: number) => { c: number; h: number; a: number } | undefined {
    const t = WALL_THICKNESS[wall.kind], painter = PAINTERS[look], rand = mulberry32(look.length * 97 + t);
    painter.section(() => undefined, t, TILE, rand);
    const grid = new Map<number, { c: number; h: number; a: number }>();
    painter.face((u, z, c, h, alpha) => { grid.set(z * TILE + u, { c, h, a: alpha ?? 255 }); }, rand);
    return (u, z) => grid.get(z * TILE + u);
}

/**
 * How tall a segment stands when walls are cut to `cut`: a railing is lower than any cut and a site fence is see-through,
 * so both always stand at their own height.
 */
export function wallHeight(kind: WallKind, cut: number): number {
    return kind === 'rail' ? RAIL_HEIGHT : kind === 'fence' ? FENCE_HEIGHT : cut;
}

/**
 * A railing running north-south, seen end-on: every part of it lines up in one column, so it is drawn wider than it is
 * (`wallMargin`) to read. Its posts stand every quarter tile, as on the railing across the view; a point at run
 * position u and height z lands on row u + height + 1 - z, so each post drops from the handrail a step further down
 * the screen the further south it stands, to a foot plate on the floor. Over them runs the handrail's top, two pixels
 * wide and lit from the west, with each post's cap standing proud of it, so from above it reads as rail and posts.
 */
function sideRail(bitmap: PixelBitmap, m: number, height: number): void {
    const row = (u: number, z: number) => u + height + 1 - z, posts = [1, 5, 9, 13];
    for (const u of posts) {
        for (let z = 2; z < height; z++) {
            bitmap.set(m - 1, row(u, z), PAL.steel[3], 0.7);
            bitmap.set(m, row(u, z), PAL.steel[1], 0.6);
        }
        for (let x = m - 2; x <= m + 1; x++) bitmap.set(x, row(u, 1), x === m - 2 ? PAL.steel[4] : x === m + 1 ? PAL.steel[1] : PAL.steel[3], 0.4);
    }
    for (let v = 0; v <= TILE; v++) {
        bitmap.set(m - 1, v, PAL.steel[5], 0.8);
        bitmap.set(m, v, PAL.steel[3], 0.75);
    }
    for (const u of posts) {
        const v = row(u, height);
        [PAL.steel[4], PAL.steel[5], PAL.steel[4], PAL.steel[1]].forEach((c, i) => bitmap.set(m - 2 + i, v, c, 0.9));
    }
}

/**
 * A door in a north-south wall, seen side-on: its leaf is edge-on and hidden in the wall, so what shows are the casings
 * round it on both faces (the jambs from the floor up, the head across the top) and a handle on each side. A point at
 * run position u (north to south), height z, lands on bitmap row u + height + 1 - z; nearer (more southern) parts are
 * drawn last.
 */
function sideDoor(bitmap: PixelBitmap, door: { casing: number; edge: number; handle: number; sill: number }, t: number, m: number, height: number): void {
    const doorTop = Math.min(height, F - 1), row = (u: number, z: number) => u + height + 1 - z;
    // Two pixels of casing on each face: the outer one dark, the one against the wall catching the light.
    const sides: [number, boolean][] = [[m - 2, false], [m - 1, true], [m + t, true], [m + t + 1, false]];
    for (let u = 1; u <= 14; u++) for (const [x, inner] of sides) {
        const jamb = u <= 2 || u >= 13, c = inner ? door.edge : door.casing;
        // The head casing across the top, when the wall is tall enough to show it; the jambs below it.
        if (doorTop === F - 1) bitmap.set(x, row(u, doorTop), c, 0.8);
        if (jamb) for (let z = 1; z <= doorTop; z++) bitmap.set(x, row(u, z), u === 2 || u === 13 ? door.casing : c, 0.75);
    }
    // Handles at waist height, a little way in from the latch-side jamb, sticking out past the casing.
    if (height >= 9) for (const x of [m - 3, m - 2, m + t + 1, m + t + 2]) bitmap.set(x, row(10, 9), door.handle, 0.9);
}
