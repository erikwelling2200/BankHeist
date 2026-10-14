import { PAL, type Ramp } from '../palette';
import { PixelBitmap } from '../PixelBitmap';
import type { Edge } from './edges';
import { PERSON_EDGE } from './people';

/**
 * A police officer, animated. Every frame is a pose keyed by hand: where the hips, neck, hands and feet are, measured
 * in pixels from the officer's footing (the floor point under them, x right, y down). A small rig paints the pose:
 * legs, arms and torso as limbs of fixed width shaded for light from above and slightly left, the cap and head, shoes
 * and pistol as hand-drawn pieces for each facing. One set of body measurements drives every frame, so the volumes stay
 * the same from frame to frame and only the pose moves, which is what keeps small sprites from boiling.
 *
 * The officer is left-handed, as the people sheet draws the holster on the left hip: facing west the gun side is the
 * side towards the camera. `hands[0]` and `feet[0]` are the left hand and foot.
 */

/** Each frame's canvas; the footing sits at (`anchorX`, `anchorY`), the soles' row and the bottom one, as for the rest of the cast. */
export const OFFICER_FRAME = { width: 40, height: 27, anchorX: 20, anchorY: 26 } as const;

export type Pt = readonly [number, number];
export type Side = 'east' | 'west' | 'north' | 'south';
/** How the pistol is held in the left hand: aimed level, kicked up by a shot, or muzzle up at the chest. */
export type GunHold = 'level' | 'kick' | 'up';

export interface Pose {
    facing: Side;
    /** The pelvis: bottom of the torso and top of the legs. */
    hip: Pt;
    /** Top of the torso; the head sits on it. */
    neck: Pt;
    /** Left and right soles; the shoe is drawn on this row and the one above, the trouser leg ends above that. */
    feet: readonly [Pt, Pt];
    hands: readonly [Pt, Pt];
    /** Knees placed by hand; otherwise each bends forward just enough for the leg to reach its foot. */
    knees?: readonly [Pt | undefined, Pt | undefined];
    /** Out of the holster, in the left hand. */
    gun?: GunHold;
    /** Where the head looks, when not where the body faces. */
    look?: Side;
}

const THIGH = 3.5, SHIN = 3.5, UPPER_ARM = 3.5, FOREARM = 3.5;
/** Light falls from above and a little from the left, as on the rest of the cast. */
const LIGHT: Pt = [-0.6, -0.8];

const navy = PAL.cloth.navy, sky = PAL.cloth.skyShirt, vest = PAL.cloth.charcoal, black = PAL.cloth.black, skin = PAL.skin.tan;

const H = { cap: 1, hair: 0.95, face: 0.93, torso: 0.8, arm: 0.86, gun: 0.9, legs: 0.6, shoes: 0.35 };

/** Hand-drawn pieces: one character per pixel, `.` empty. */
interface Piece { rows: readonly string[]; colors: Readonly<Record<string, [number, number]>> }

const HEAD_COLORS: Piece['colors'] = {
    C: [navy[3]!, H.cap], c: [navy[2]!, H.cap], k: [PAL.cloth.white[1]!, H.cap - 0.02], n: [navy[0]!, H.cap - 0.02], v: [black[0]!, H.cap - 0.03],
    h: [PAL.hair.black[1]!, H.hair], s: [skin[2]!, H.face], S: [skin[3]!, H.face], z: [skin[1]!, H.face - 0.03], e: [PAL.ink, H.face - 0.08]
};

/**
 * The head in its peaked cap, drawn for each way it can look; the bottom row is the neck, which sits on the torso's top
 * row, and column 3 is the middle of the body. The cap band is the chequered police band, the strongest read at this size.
 */
const HEADS: Record<Side, Piece> = {
    east: {
        rows: ['.CCCc...', 'cCCccc..', 'knknkvv.', 'hhssss..', 'hzsseSs.', '.hzssz..', '..zs....'],
        colors: HEAD_COLORS
    },
    west: {
        rows: ['..CCCc..', '.cCCccc.', 'vvknknk.', '.Ssssh..', 'sSesszh.', '.zsszh..', '...sz...'],
        colors: HEAD_COLORS
    },
    south: {
        rows: ['.cCCCcc.', '.knknkn.', 'vvvvvvvv', '.zzzzzz.', '.sessez.', '.zsssz..', '...zz...'],
        colors: HEAD_COLORS
    },
    north: {
        rows: ['.cCCCcc.', '.knknkn.', '.hhhhhh.', '.zhhhhz.', '.zzhhzz.', '..zssz..', '...zz...'],
        colors: HEAD_COLORS
    }
};
/** Columns of each head piece that sit over the middle of the torso, front views and side views alike. */
const HEAD_MIDDLE = 3;

const SHOE_COLORS: Piece['colors'] = { F: [black[3]!, H.shoes + 0.05], f: [black[2]!, H.shoes], o: [black[0]!, H.shoes - 0.1] };
/** Shoes around the sole point: two rows, toes pointing the way the officer faces. Column 2 is under the ankle. */
const SHOES: Record<Side, Piece> = {
    east: { rows: ['.FFf.', '.offo'], colors: SHOE_COLORS },
    west: { rows: ['.Fff.', 'offo.'], colors: SHOE_COLORS },
    south: { rows: ['.FFf.', '.ooo.'], colors: SHOE_COLORS },
    north: { rows: ['.Fff.', '.ooo.'], colors: SHOE_COLORS }
};

const GUN_COLORS: Piece['colors'] = { G: [PAL.steel[3], H.gun + 0.05], g: [PAL.steel[1], H.gun] };
/** The pistol around the left hand (column and row of `@`), with the muzzle one pixel past the barrel. */
const GUNS: Record<GunHold | 'levelEast', Piece & { muzzle: Pt }> = {
    level: { rows: ['GGGg', '.g.@'], colors: GUN_COLORS, muzzle: [-4, -1] },
    levelEast: { rows: ['gGGG', '@.g.'], colors: GUN_COLORS, muzzle: [4, -1] },
    kick: { rows: ['GG..', '..Gg', '...@'], colors: GUN_COLORS, muzzle: [-4, -2] },
    up: { rows: ['G', 'G', 'g', '@'], colors: GUN_COLORS, muzzle: [0, -4] }
};

const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const len = (a: Pt): number => Math.hypot(a[0], a[1]);
const forward = (side: Side): Pt => (side === 'east' ? [1, 0] : side === 'west' ? [-1, 0] : [0, 0]);

/**
 * The middle joint of a two-bone limb from `root` to `end`: on the side of `bend` when the limb has to fold to reach,
 * on the straight line when it is stretched out (a limb a pixel too short just reaches; nobody sees it stretch).
 */
export function joint(root: Pt, end: Pt, a: number, b: number, bend: Pt): Pt {
    const d = sub(end, root), dist = len(d);
    if (dist === 0) return add(root, [bend[0] * a, bend[1] * a]);
    const u: Pt = [d[0] / dist, d[1] / dist];
    if (dist >= a + b) return add(root, [u[0] * dist * (a / (a + b)), u[1] * dist * (a / (a + b))]);
    const along = (a * a - b * b + dist * dist) / (2 * dist), off = Math.sqrt(Math.max(0, a * a - along * along));
    let perp: Pt = [-u[1], u[0]];
    if (perp[0] * bend[0] + perp[1] * bend[1] < 0) perp = [-perp[0], -perp[1]];
    return add(root, [u[0] * along + perp[0] * off, u[1] * along + perp[1] * off]);
}

/** A part of the body to paint: pixels and their colours come from a ramp chosen by how much each faces the light. */
interface Limb { from: Pt; to: Pt; width: number; ramp: Ramp; darker: number; height: number; square?: boolean; paint?: (along: number, across: number, tone: number) => [number, number] | undefined }

class Rig {
    readonly bitmap = new PixelBitmap(OFFICER_FRAME.width, OFFICER_FRAME.height);

    private px(p: Pt): Pt {
        return [Math.round(p[0]) + OFFICER_FRAME.anchorX, Math.round(p[1]) + OFFICER_FRAME.anchorY];
    }

    /**
     * Paints a limb as a square brush of `width` dragged along its bone, so a limb keeps its width at every angle. Each
     * pixel is toned by which side of the bone it is on: the side facing the light a step lighter, the far side darker.
     */
    limb(l: Limb): void {
        const lo = -Math.floor(l.width / 2), hi = Math.ceil(l.width / 2) - 1;
        const middle = (lo + hi) / 2;
        const d = sub(l.to, l.from), length = len(d);
        const steps = Math.max(1, Math.ceil(length * 3));
        const seen = new Set<string>();
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const c: Pt = [Math.round(l.from[0] + d[0] * t), Math.round(l.from[1] + d[1] * t)];
            for (let oy = lo; oy <= hi; oy++) for (let ox = lo; ox <= hi; ox++) {
                const p: Pt = [c[0] + ox, c[1] + oy], key = `${p[0]},${p[1]}`;
                if (seen.has(key)) continue;
                seen.add(key);
                // Where the pixel lies along the bone (0 at its root, its length at the end) and across it.
                const along = length ? ((p[0] - l.from[0]) * d[0] + (p[1] - l.from[1]) * d[1]) / length : 0;
                const rel = sub([p[0] - middle, p[1] - middle], l.from);
                // A square-ended part (the torso) stops at its ends instead of rounding past them.
                if (l.square && (along < -0.5 || along > length + 0.5)) continue;
                const across: Pt = length ? sub(rel, [(d[0] * along) / length, (d[1] * along) / length]) : rel;
                const lit = across[0] * LIGHT[0] + across[1] * LIGHT[1];
                const tone = lit > 0.25 ? 1 : lit < -0.25 ? -1 : 0;
                const custom = l.paint?.(along, (across[0] * -d[1] + across[1] * d[0]) / (length || 1), tone);
                const step = Math.max(0, Math.min(l.ramp.length - 1, l.ramp.length - 2 + tone - l.darker));
                const roundness = 1 - Math.min(1, len(across) / Math.max(1, l.width / 2));
                const [x, y] = this.px(p);
                if (custom) this.bitmap.set(x, y, custom[0], custom[1]);
                else this.bitmap.set(x, y, l.ramp[step]!, l.height + 0.12 * roundness);
            }
        }
    }

    /** Stamps a piece with its column `ox`, row `oy` on point `at`. */
    piece(piece: Piece, at: Pt, ox: number, oy: number): void {
        piece.rows.forEach((row, ry) => [...row].forEach((ch, rx) => {
            if (ch === '.' || ch === '@') return;
            const entry = piece.colors[ch];
            if (!entry) throw new Error(`Piece has no colour for '${ch}'`);
            const [x, y] = this.px([at[0] + rx - ox, at[1] + ry - oy]);
            this.bitmap.set(x, y, entry[0], entry[1]);
        }));
    }

    dot(at: Pt, color: number, height: number): void {
        const [x, y] = this.px(at);
        this.bitmap.set(x, y, color, height);
    }
}

/** Where `@` is in a piece. */
function handle(piece: Piece): Pt {
    for (let y = 0; y < piece.rows.length; y++) {
        const x = piece.rows[y]!.indexOf('@');
        if (x >= 0) return [x, y];
    }
    throw new Error('Piece has no handle');
}

/** The pistol piece a pose holds, if it is drawn. */
function gunPiece(pose: Pose): (Piece & { muzzle: Pt }) | undefined {
    if (!pose.gun) return undefined;
    return pose.gun === 'level' && pose.facing === 'east' ? GUNS.levelEast : GUNS[pose.gun];
}

/** The muzzle's position relative to the footing, for placing a flash. */
export function muzzle(pose: Pose): Pt {
    const gun = gunPiece(pose);
    if (!gun) throw new Error('The pose holds no gun');
    return add(pose.hands[0], gun.muzzle);
}

/** Paints one pose into a frame-sized bitmap, edged like the rest of the cast. */
export function drawPose(pose: Pose, edge: Edge = PERSON_EDGE): PixelBitmap {
    const rig = new Rig();
    const side = pose.facing === 'east' || pose.facing === 'west';
    // Which of the left and right limbs is nearer the camera: drawn last, a step lighter.
    const nearIsLeft = pose.facing === 'west' || pose.facing === 'north';
    const order = nearIsLeft ? [1, 0] : [0, 1];
    const ahead = forward(pose.facing);
    const axis = sub(pose.neck, pose.hip), axisLength = len(axis);
    const up: Pt = [axis[0] / axisLength, axis[1] / axisLength];
    // Front and back views: legs and shoulders sit apart across the body; side views stack them.
    const hipOf = (i: number): Pt => (side ? pose.hip : add(pose.hip, [((i === 0) === (pose.facing === 'north') ? -2 : 1), 0]));
    const shoulderOf = (i: number): Pt => (side ? add(pose.neck, [-up[0], -up[1]]) : add(pose.neck, [((i === 0) === (pose.facing === 'north') ? -5 : 4), 0]));

    const leg = (i: number) => {
        const near = order[1] === i;
        const foot = pose.feet[i]!, ankle = add(foot, [0, -2]);
        const bend: Pt = side ? ahead : [(i === 0) === (pose.facing === 'north') ? -1 : 1, 0];
        const knee = pose.knees?.[i] ?? joint(hipOf(i), ankle, THIGH, SHIN, bend);
        const darker = near ? 0 : 1;
        rig.limb({ from: hipOf(i), to: knee, width: 3, ramp: navy, darker, height: H.legs + 0.05 });
        rig.limb({ from: knee, to: ankle, width: 3, ramp: navy, darker, height: H.legs });
        rig.piece(SHOES[pose.facing], foot, 2, 1);
    };

    const arm = (i: number) => {
        const near = order[1] === i;
        const shoulder = shoulderOf(i), hand = pose.hands[i]!;
        const back: Pt = side ? [-ahead[0], 0.6] : [(i === 0) === (pose.facing === 'north') ? -1 : 1, 0.5];
        const elbow = joint(shoulder, hand, UPPER_ARM, FOREARM, back);
        const width = side ? 2 : 1, darker = near ? 0 : 1;
        rig.limb({ from: shoulder, to: elbow, width, ramp: sky, darker, height: H.arm });
        const forearm = len(sub(hand, elbow));
        rig.limb({
            from: elbow, to: hand, width, ramp: sky, darker, height: H.arm,
            // The hand: the last pixel of the forearm is bare skin.
            paint: (along, _, tone) => (along > forearm - 0.9 ? [skin[tone > 0 ? 3 : 2 - darker]!, H.arm + 0.05] : undefined)
        });
    };

    const torso = () => {
        const width = side ? 5 : 8;
        const frontSign = pose.facing === 'east' ? 1 : -1;
        rig.limb({
            from: pose.hip, to: pose.neck, width, ramp: vest, darker: 0, height: H.torso, square: true,
            paint: (along, acrossBody, tone) => {
                // Duty belt at the bottom row, a reflective band across the chest, the shirt collar at the top.
                if (along < 0.5) return [tone > 0 ? black[3]! : black[1]!, H.torso + 0.03];
                if (Math.abs(along - (axisLength - 3)) < 0.5) return [tone < 0 ? PAL.cloth.white[1]! : PAL.cloth.white[2]!, H.torso + 0.02];
                if (along > axisLength - 0.5) {
                    if (!side && Math.abs(acrossBody) < 1.1) return [sky[pose.facing === 'south' ? 3 : 2]!, H.torso + 0.04];
                    if (side && acrossBody * frontSign < -0.5) return [sky[2]!, H.torso + 0.04];
                }
                return undefined;
            }
        });
        if (pose.facing === 'south') {
            rig.dot(add(pose.hip, [-1, 0]), PAL.brass[4], H.torso + 0.1);
            rig.dot(add(pose.neck, [1, 2]), PAL.steel[4], H.torso + 0.1);
            rig.dot(add(pose.neck, [-3, 1]), black[0]!, H.torso + 0.1);
        }
        if (side) rig.dot(add(pose.neck, [-up[0] * 2 + ahead[0] * 2, -up[1] * 2]), PAL.steel[4], H.torso + 0.1);
    };

    /** The holster rides on the left hip, the pistol's grip showing above it while it is in. */
    const holster = () => {
        const at = side ? add(pose.hip, [-ahead[0], 0]) : add(pose.hip, [pose.facing === 'south' ? 4 : -5, 0]);
        for (let y = 0; y < 3; y++) rig.dot(add(at, [0, y]), black[0]!, H.torso + 0.08);
        if (!side) for (let y = 0; y < 3; y++) rig.dot(add(at, [pose.facing === 'south' ? 1 : -1, y]), black[1]!, H.torso + 0.06);
        if (!pose.gun) rig.dot(add(at, [0, -1]), PAL.steel[2], H.gun);
    };

    const head = () => {
        const piece = HEADS[pose.look ?? pose.facing];
        rig.piece(piece, pose.neck, HEAD_MIDDLE, piece.rows.length);
    };

    const gun = () => {
        const piece = gunPiece(pose);
        if (!piece) return;
        const [hx, hy] = handle(piece);
        rig.piece(piece, pose.hands[0], hx, hy);
        // The hand closes over the grip.
        rig.dot(pose.hands[0], skin[2]!, H.arm + 0.06);
    };

    // Far limbs first, then the body, then the near limbs over it. The left hip's holster faces the camera only
    // facing west (or south, at the side); facing east it is behind the body.
    leg(order[0]!);
    if (pose.facing === 'east') holster();
    leg(order[1]!);
    if (side) arm(order[0]!);
    torso();
    if (pose.facing !== 'east') holster();
    head();
    if (!side) arm(order[0]!);
    arm(order[1]!);
    gun();
    edge(rig.bitmap);
    return rig.bitmap;
}

/**
 * Every frame's pose. Walking east the body moves 3px a frame and the planted foot slides back 3px a frame, so it stays
 * put on the floor; the swing foot lifts on the way through. Walking north (away from the camera) the feet alternate
 * stepping up, the far foot drawn higher.
 */
export const OFFICER_POSES = {
    // Six-frame walk east: contact, down, passing, for each foot. The arms swing against the legs.
    walkEast0: { facing: 'east', hip: [0, -9], neck: [0, -16], feet: [[-5, 0], [4, 0]], hands: [[3, -9], [-3, -9]] },
    walkEast1: { facing: 'east', hip: [0, -8], neck: [0, -15], feet: [[-2, -1], [1, 0]], hands: [[2, -8], [-2, -8]] },
    walkEast2: { facing: 'east', hip: [0, -9], neck: [0, -16], feet: [[1, -2], [-2, 0]], hands: [[1, -8], [-1, -8]] },
    walkEast3: { facing: 'east', hip: [0, -9], neck: [0, -16], feet: [[4, 0], [-5, 0]], hands: [[-3, -9], [3, -9]] },
    walkEast4: { facing: 'east', hip: [0, -8], neck: [0, -15], feet: [[1, 0], [-2, -1]], hands: [[-2, -8], [2, -8]] },
    walkEast5: { facing: 'east', hip: [0, -9], neck: [0, -16], feet: [[-2, 0], [1, -2]], hands: [[-1, -8], [1, -8]] },
    standEast: { facing: 'east', hip: [0, -9], neck: [0, -16], feet: [[-1, 0], [1, 0]], hands: [[0, -8], [0, -8]] },

    // Four-frame walk north: step, down, step, down.
    walkNorth0: { facing: 'north', hip: [0, -9], neck: [0, -16], feet: [[-2, -2], [1, 0]], hands: [[-5, -8], [4, -9]] },
    walkNorth1: { facing: 'north', hip: [0, -8], neck: [0, -15], feet: [[-2, 0], [1, 0]], hands: [[-5, -7], [4, -7]] },
    walkNorth2: { facing: 'north', hip: [0, -9], neck: [0, -16], feet: [[-2, 0], [1, -2]], hands: [[-5, -9], [4, -8]] },
    standNorth: { facing: 'north', hip: [0, -9], neck: [0, -16], feet: [[-2, 0], [1, 0]], hands: [[-5, -8], [4, -8]] },

    // The draw: hand to the grip with the shoulders dipping (the tell), clear the holster, hands meet at the chest, punch out.
    standWest: { facing: 'west', hip: [0, -9], neck: [0, -16], feet: [[1, 0], [-1, 0]], hands: [[0, -8], [0, -8]] },
    drawWest0: { facing: 'west', hip: [0, -9], neck: [0, -15], feet: [[1, 0], [-1, 0]], hands: [[1, -10], [-1, -11]] },
    drawWest1: { facing: 'west', hip: [0, -9], neck: [0, -16], feet: [[2, 0], [-2, 0]], hands: [[0, -12], [-2, -12]], gun: 'level' },
    drawWest2: { facing: 'west', hip: [0, -9], neck: [0, -16], feet: [[2, 0], [-2, 0]], hands: [[-3, -13], [-3, -13]], gun: 'level' },
    aimWest: { facing: 'west', hip: [0, -9], neck: [-1, -16], feet: [[2, 0], [-2, 0]], hands: [[-7, -14], [-7, -14]], gun: 'level' },
    kickWest: { facing: 'west', hip: [0, -9], neck: [0, -16], feet: [[2, 0], [-2, 0]], hands: [[-6, -15], [-6, -15]], gun: 'kick' },

    // The dive: crouch, push off, fly flat, land on the chest and slide, spin round, sit with the back to the cover.
    crouchWest: { facing: 'west', hip: [1, -6], neck: [-2, -13], feet: [[2, 0], [-2, 0]], hands: [[-4, -11], [-4, -11]], gun: 'level' },
    launchWest: { facing: 'west', hip: [0, -7], neck: [-6, -12], feet: [[5, -1], [3, 0]], hands: [[-12, -13], [-12, -13]], gun: 'level' },
    flyWest: { facing: 'west', hip: [0, -6], neck: [-7, -7], feet: [[7, -4], [7, -5]], hands: [[-14, -8], [-14, -8]], gun: 'level' },
    landWest: { facing: 'west', hip: [0, -3], neck: [-7, -3], feet: [[7, 0], [7, -1]], hands: [[-11, -4], [-11, -4]], gun: 'level' },
    turnSouth: { facing: 'south', hip: [0, -5], neck: [0, -12], feet: [[2, 0], [-2, 0]], hands: [[1, -9], [-1, -9]], gun: 'up' },
    coverEast: { facing: 'east', hip: [0, -3], neck: [-1, -10], feet: [[5, 0], [5, 0]], knees: [[3, -6], [3, -6]], hands: [[2, -8], [2, -8]], gun: 'up' },
    coverEastBreath: { facing: 'east', hip: [0, -3], neck: [-1, -9], feet: [[5, 0], [5, 0]], knees: [[3, -6], [3, -6]], hands: [[2, -7], [2, -7]], gun: 'up' },
    coverEastLook: { facing: 'east', hip: [0, -3], neck: [-1, -10], feet: [[5, 0], [5, 0]], knees: [[3, -6], [3, -6]], hands: [[2, -8], [2, -8]], gun: 'up', look: 'west' },

    // Over the top: onto a knee facing the cover, rise, aim across its top.
    kneelWest: { facing: 'west', hip: [1, -6], neck: [0, -13], feet: [[5, 0], [-3, 0]], knees: [[2, -1], [-3, -5]], hands: [[-2, -10], [-2, -10]], gun: 'up' },
    riseWest: { facing: 'west', hip: [1, -7], neck: [-1, -14], feet: [[5, 0], [-3, 0]], knees: [[2, -2], [-3, -6]], hands: [[-6, -13], [-6, -13]], gun: 'level' },
    overAimWest: { facing: 'west', hip: [1, -8], neck: [-1, -15], feet: [[5, 0], [-3, 0]], knees: [[3, -3], [-3, -6]], hands: [[-8, -14], [-8, -14]], gun: 'level' },
    overKickWest: { facing: 'west', hip: [1, -8], neck: [0, -15], feet: [[5, 0], [-3, 0]], knees: [[3, -3], [-3, -6]], hands: [[-7, -15], [-7, -15]], gun: 'kick' }
} as const satisfies Record<string, Pose>;

export type OfficerFrame = keyof typeof OFFICER_POSES;
export const OFFICER_FRAMES = Object.keys(OFFICER_POSES) as OfficerFrame[];
