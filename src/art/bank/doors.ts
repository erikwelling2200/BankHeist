import { TILE } from '../../level/constants';
import { WALL_HEIGHT } from '../../level/space';
import { WALL_THICKNESS, wallFootprint, type Wall } from '../../level/walls';
import { PAL, deepen, mix } from '../palette';
import { PixelBitmap } from '../PixelBitmap';
import { norm, type Vec3Like } from './view';
import { DOOR_SILL, faceColours, wallArt, wallHeight, wallMargin, type WallLook } from './walls';

/*
 * Open doors (§6.9), drawn in the world's projection like everything else: a point at floor position (x, y) and height
 * z lands on screen at (x, y - z). An open door is two things: the wall segment with its doorway cut out of it (the
 * floor beyond shows through, a sill across the threshold), and the leaf, a real slab about 0.9m wide, 2m tall and a few
 * centimetres thick, swung open on its hinge into the tile beside the wall. Both are cut down with the wall: a leaf in a
 * cut wall stands only as high as the wall, its top in section. A closed door is the wall's own art.
 *
 * The leaf is drawn by finding, for every pixel, the first point of the slab the camera's ray meets, from the top down:
 * its top (or its cut), its broad face (painted with the door's own face, the side the camera saw while it was shut),
 * its free edge, or for the vault's round door its rim. Seen from the south a leaf swung a full 90° in an east-west wall
 * would be edge-on, a line, so those stand open at `EAST_WEST_SWING`: far enough to read as open, and turned enough for
 * the face to show. A leaf in a north-south wall swings a full 90° and faces the camera.
 */

const F = WALL_HEIGHT;

/** How far a leaf in an east-west wall stands open, in degrees from shut: nearly square to the wall, its face still in view. */
export const EAST_WEST_SWING = 72;
/** The vault's round door stands open less far, so its face, the bolt wheel at its middle, stays in view beside its rim. */
export const VAULT_SWING = 60;

/** Which way a door's leaf swings: into the tile south or north of an east-west wall, east or west of a north-south one. */
export type Swing = 'south' | 'north' | 'east' | 'west';
/** Which jamb it hangs on: the west or east one of an east-west wall, the north or south one of a north-south wall. */
export type Hinge = 'west' | 'east' | 'north' | 'south';

/** A doorway in a segment's face: the columns u0..u1 (inclusive), up to `top`, its exact shape, and what fills it. */
interface Opening {
    u0: number;
    u1: number;
    top: number;
    inside: (u: number, z: number) => boolean;
    /** The leaf that swings, glass, the vault's round door, or nothing (a shutter rolls up, the vault's other half). */
    leaf: 'leaf' | 'glass' | 'vault' | 'none';
}

const rect = (u0: number, u1: number, top: number, leaf: Opening['leaf']): Opening => ({ u0, u1, top, leaf, inside: (u, z) => u >= u0 && u <= u1 && z >= 1 && z <= top });

/** The vault door's radius and the height of its middle, as `vaultDoor` in walls.ts paints it. */
const VAULT_R = 10.5;
const VAULT_CZ = 12;
const VAULT_THICK = WALL_THICKNESS.vaultDoor;

/** The doorway each kind of door leaves in its segment when open, inside its frame. */
export function opening(look: WallLook): Opening | undefined {
    switch (look) {
        case 'doorWood': case 'doorKeycard': return rect(3, 12, F - 2, 'leaf');
        case 'doorService': case 'doorBack': return rect(3, 12, F - 3, 'leaf');
        case 'doorGlassLeft': case 'doorGlassRight': return rect(0, TILE - 1, F - 8, 'glass');
        case 'doorTower': return rect(0, TILE - 1, F - 3, 'glass');
        case 'shutter': return rect(1, TILE - 2, F - 5, 'none');
        case 'vaultDoorLeft': case 'vaultDoorRight': {
            const cx = look === 'vaultDoorLeft' ? TILE : 0;
            const inside = (u: number, z: number) => Math.hypot(u + 0.5 - cx, z - 0.5 - VAULT_CZ) <= VAULT_R;
            return look === 'vaultDoorLeft'
                ? { u0: Math.floor(cx - VAULT_R), u1: TILE - 1, top: Math.ceil(VAULT_CZ + VAULT_R), inside, leaf: 'vault' }
                : { u0: 0, u1: Math.ceil(VAULT_R) - 1, top: Math.ceil(VAULT_CZ + VAULT_R), inside, leaf: 'none' };
        }
        default: return undefined;
    }
}

/** Whether a segment is a door that opens. */
export const opens = (look: WallLook): boolean => opening(look) !== undefined;

/**
 * The segment cut at `cut` with its doorway open: the opening cleared out of its face (and out of its section, where the
 * doorway reaches the cut), the sill laid across the threshold. Same size and place as `wallArt`.
 */
export function openWallArt(wall: Wall, look: WallLook, cut: number): PixelBitmap {
    const art = wallArt(wall, look, cut), o = opening(look);
    if (!o) return art;
    const height = wallHeight(wall.kind, cut), t = WALL_THICKNESS[wall.kind], sill = DOOR_SILL[wall.kind] ?? PAL.concrete[3];
    if (wall.run === 'eastWest') {
        for (let u = o.u0; u <= o.u1; u++) {
            for (let z = 1; z <= Math.min(height, o.top); z++) if (o.inside(u, z)) art.clear(u, t + height - z);
            // Through the cut, if the doorway reaches it: no lintel left over it.
            if (o.inside(u, height) || (height <= o.top && o.inside(u, Math.min(height, o.top)))) for (let v = 0; v < t; v++) art.clear(u, v);
            // The sill, on the floor under the wall's footprint: the rows the footprint takes at floor level.
            if (o.inside(u, Math.max(1, Math.min(2, o.top)))) for (let v = 0; v < t; v++) {
                const edge = v === t - 1 ? deepen(sill, 0.15) : v === 0 ? deepen(sill, 0.3) : sill;
                if (!art.opaque(u, height + v)) art.set(u, height + v, edge, 0.3);
            }
        }
    } else if (height <= o.top) {
        // A north-south door is edge-on: open, it shows as a gap in the cut wall's section; a full wall's lintel hides it.
        const m = wallMargin(wall);
        for (let u = o.u0; u <= o.u1; u++) for (let v = 0; v < t; v++) art.clear(m + v, u);
    }
    return art;
}

/** A leaf drawn open: its pixels, where its top-left lands on the map, and the line it is ordered by (its nearest edge). */
export interface LeafArt { bitmap: PixelBitmap; left: number; top: number; base: number }

/**
 * The leaf of a door segment swung open, cut to the wall's height at `cut`. `hinge` and `swing` say how it hangs; by
 * default a leaf in an east-west wall swings south, towards the camera, and one in a north-south wall east, both hung on
 * the west (or north) jamb, or the east jamb for the right-hand leaf of a pair. Undefined for a door with no leaf to show.
 */
export function leafArt(wall: Wall, look: WallLook, cut: number, hinge?: Hinge, swing?: Swing): LeafArt | undefined {
    const o = opening(look);
    if (!o || o.leaf === 'none') return undefined;
    const f = wallFootprint(wall), eastWest = wall.run === 'eastWest';
    const side = hinge ?? (eastWest ? (look === 'doorGlassRight' ? 'east' : 'west') : 'north');
    const way = swing ?? (eastWest ? 'south' : 'east');
    if (eastWest !== (side === 'west' || side === 'east') || eastWest !== (way === 'south' || way === 'north')) {
        throw new Error(`A ${wall.run} door hangs on its ${eastWest ? 'west or east' : 'north or south'} jamb and swings ${eastWest ? 'south or north' : 'east or west'}`);
    }
    const vault = o.leaf === 'vault';
    const W = vault ? 2 * VAULT_R : o.u1 - o.u0 + 1, T = vault ? VAULT_THICK : 2;
    const H = vault ? VAULT_CZ + VAULT_R : o.top, C = Math.min(H, wallHeight(wall.kind, cut));
    const angle = ((vault ? VAULT_SWING : !eastWest ? 90 : EAST_WEST_SWING) * Math.PI) / 180, s = Math.sin(angle), c = Math.abs(Math.cos(angle)) < 1e-9 ? 0 : Math.cos(angle);
    // The hinge's place on the floor and the leaf's direction from it.
    let hx: number, hy: number, dir: [number, number];
    const atU0 = side === 'west' || side === 'north';
    if (eastWest) {
        const u = vault ? TILE - VAULT_R : atU0 ? o.u0 : o.u1 + 1;
        hx = f.x + u;
        hy = way === 'south' ? f.y + f.d : f.y;
        dir = [atU0 ? c : -c, way === 'south' ? s : -s];
    } else {
        hx = way === 'east' ? f.x + f.w : f.x;
        hy = f.y + (atU0 ? o.u0 : o.u1 + 1);
        dir = [way === 'east' ? s : -s, atU0 ? c : -c];
    }
    // The face the camera sees: the side of the leaf turned towards the south, which faced the camera while it was shut.
    const perps: [number, number][] = [[-dir[1], dir[0]], [dir[1], -dir[0]]];
    perps.sort((p, q) => q[1] - p[1] || (atU0 ? p[0] - q[0] : q[0] - p[0]));
    const seen = perps[0]!, k: [number, number] = [-seen[0], -seen[1]];
    const shape = vault ? (a: number, z: number) => (a - VAULT_R) ** 2 + (z - VAULT_CZ) ** 2 <= VAULT_R * VAULT_R : () => true;

    const corners = [[0, 0], [W, 0], [0, T], [W, T]].map(([a, b]) => [hx + a! * dir[0] + b! * k[0], hy + a! * dir[1] + b! * k[1]] as const);
    const left = Math.floor(Math.min(...corners.map(p => p[0]))) - 1, right = Math.ceil(Math.max(...corners.map(p => p[0]))) + 1;
    const near = Math.ceil(Math.max(...corners.map(p => p[1]))), far = Math.floor(Math.min(...corners.map(p => p[1])));
    const top = far - Math.ceil(C) - 1, bitmap = new PixelBitmap(right - left, near + 1 - top);

    const face = faceColours(wall, look), paint = vault ? vaultPaint : leafPaint(face, atU0 ? (a: number) => o.u0 + a : (a: number) => o.u1 - a, o.leaf === 'glass');
    const STEP = 0.25;
    const at = (x: number, y: number, z: number) => {
        const rx = x - hx, ry = y - hy, a = rx * dir[0] + ry * dir[1], b = rx * k[0] + ry * k[1];
        return { a, b, inside: a >= 0 && a < W && b >= 0 && b < T && z > 0 && z <= C && shape(a, z) };
    };
    for (let j = 0; j < bitmap.height; j++) for (let i = 0; i < bitmap.width; i++) {
        const x = left + i + 0.5, row = top + j + 0.5;
        // From the top down: the first point of the leaf the ray from the camera meets.
        for (let z = C - STEP / 2; z > 0; z -= STEP) {
            const p = at(x, row + z, z);
            if (!p.inside) continue;
            const before = z + STEP > C ? undefined : at(x, row + z + STEP, z + STEP);
            let surface: Surface, normal: Vec3Like;
            if (!before && (C < H || !vault)) {
                surface = C < H ? 'cut' : 'top';
                normal = toScreen(0, 0, 1);
            } else if (!before) {
                surface = 'rim';
                normal = toScreen(0, 0, 1);
            } else if (before.b < 0 || before.b >= T) {
                surface = 'face';
                normal = toScreen(seen[0], seen[1], 0);
            } else if (before.a < 0 || before.a >= W) {
                surface = 'edge';
                normal = before.a >= W ? toScreen(dir[0], dir[1], 0) : toScreen(-dir[0], -dir[1], 0);
            } else {
                surface = 'rim';
                const ra = (p.a - VAULT_R) / VAULT_R, rz = (z - VAULT_CZ) / VAULT_R;
                normal = toScreen(ra * dir[0], ra * dir[1], rz);
            }
            const px = paint(surface, p.a, z, p.b, T, i + j);
            if (px) {
                bitmap.set(i, j, px.c, px.h, px.alpha ?? 255);
                bitmap.setNormal(i, j, normal[0], normal[1], normal[2]);
            }
            break;
        }
    }
    return { bitmap, left, top, base: near };
}

type Surface = 'top' | 'cut' | 'face' | 'edge' | 'rim';
type Paint = (surface: Surface, a: number, z: number, b: number, thick: number, parity: number) => { c: number; h: number; alpha?: number } | undefined;

/**
 * A world direction as a screen-space normal (x right, y down the screen, z towards the viewer): east is right, south
 * the way a south face points (`NORMAL.face`) and up the way a top does (`NORMAL.top`).
 */
function toScreen(x: number, y: number, z: number): Vec3Like {
    return norm(x, y * 0.45 - z * 0.55, y * 0.9 + z * 0.85 + 0.02);
}

/**
 * A door leaf's surfaces: its face is the door's own face, column by column from the hinge; its free edge and top are
 * the frame's colour, the top lit; a cut through it is dark, as walls show their section.
 */
function leafPaint(face: ReturnType<typeof faceColours>, column: (a: number) => number, glass: boolean): Paint {
    return (surface, a, z) => {
        const u = Math.min(TILE - 1, Math.max(0, Math.floor(column(Math.min(a, TILE - 0.01)))));
        const zi = Math.max(1, Math.min(F, Math.ceil(z)));
        const here = face(u, zi) ?? face(u, Math.max(1, zi - 1));
        const frame = glass ? PAL.steel[3] : here ? deepen(here.c, 0.2) : PAL.walnut[1];
        switch (surface) {
            case 'face': return here ? { c: here.c, h: here.h, alpha: here.a } : { c: frame, h: 0.6 };
            case 'edge': return { c: glass ? PAL.steel[4] : mix(frame, PAL.paper[1], 0.2), h: 0.7 };
            case 'top': return { c: glass ? PAL.steel[5] : mix(frame, PAL.paper[1], 0.3), h: 0.8 };
            case 'cut': return { c: glass ? PAL.steel[1] : deepen(frame, 0.35), h: 0.5 };
            case 'rim': return { c: frame, h: 0.6 };
        }
    };
}

/**
 * The vault's round door, open: a drum of polished steel a hand's breadth thick, seen by its rim, with its locking bolts
 * in two rings round it and a dark seam at each face; cut down, its section is the dark steel of the vault's walls.
 */
const vaultPaint: Paint = (surface, a, z, b, thick, parity) => {
    if (surface === 'cut' || surface === 'top') return { c: parity % 3 === 0 ? PAL.steel[1] : PAL.steel[0], h: 0.5 };
    if (surface === 'face') return vaultFace(a, z);
    if (b < 1 || b >= thick - 1) return { c: PAL.steel[1], h: 0.5 };
    const turn = (Math.atan2(z - VAULT_CZ, a - VAULT_R) / (2 * Math.PI) + 1) * 14, bolt = Math.abs((turn % 1) - 0.5) < 0.22;
    const ring = Math.floor(b) === 2 || Math.floor(b) === thick - 3;
    if (ring && bolt) return { c: PAL.steel[5], h: 0.95 };
    if (ring) return { c: PAL.steel[2], h: 0.55 };
    return { c: Math.floor(b) % 2 ? PAL.steel[3] : PAL.steel[4], h: 0.75 };
};

/** The vault door's face, as `vaultDoor` in walls.ts paints it shut: the bolt ring, the polished door, the brass wheel. */
function vaultFace(a: number, z: number): { c: number; h: number } {
    const du = a - VAULT_R, dz = z - VAULT_CZ, d = Math.hypot(du, dz);
    if (d > 9.5) return { c: Math.round(Math.atan2(dz, du) * 4) % 2 ? PAL.steel[5] : PAL.steel[3], h: 0.85 };
    if (d <= 1) return { c: PAL.brass[5], h: 0.9 };
    if (d <= 4.5 && (Math.abs(du) < 1 || Math.abs(dz) < 1)) return { c: PAL.brass[4], h: 0.85 };
    if (d <= 4.5 && d > 3.5) return { c: PAL.brass[3], h: 0.85 };
    return { c: dz > 3 ? PAL.steel[4] : PAL.steel[3], h: 0.85 };
}
