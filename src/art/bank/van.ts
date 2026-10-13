import { px, TOP_DEPTH, type Facing, type Size } from '../../level/space';
import { mix, PAL } from '../palette';
import type { PropArt } from './model';
import { NORMAL, View } from './view';

/*
 * The crew's panel van, drawn by hand from four sides. All four views take their geometry from one set of
 * measurements (`Shape`), so they agree with each other and with the van's catalog box; what each view shows of that
 * geometry, and how, is composed for that angle.
 *
 * The van's own frame: x across it, y along it from its back (0) to its nose, z up. Facing east the camera (south of
 * it) sees its right side, where the sliding door is; facing west, its left side.
 */

const B = PAL.vanBody, T = PAL.tyre, S = PAL.steel, G = PAL.glass;
const AMBER = PAL.cloth.mustard[3]!, RED = PAL.carpet[3], LAMP = PAL.paper[3];
/** The faded signwriting of a plumbing firm that doesn't exist. */
const LETTERING = mix(B[3]!, PAL.cloth.navy[3]!, 0.55), LETTERING_FAINT = mix(B[3]!, PAL.cloth.navy[3]!, 0.35);

/** One set of measurements every view is drawn from. */
class Shape {
    readonly width: number;
    readonly length: number;
    readonly height: number;
    /** Last row of the flat roof, then the windscreen sloping down to the bonnet, then the bonnet to the nose. */
    readonly roofEnd: number;
    readonly screenEnd: number;
    readonly bonnetZ = px(1.35);
    readonly noseZ = px(1.2);
    readonly wheelR = 4.5;
    readonly rearAxle = 13;
    readonly frontAxle: number;
    /** The cab door's back edge, the sliding door's two edges (on the right side) and the window line. */
    readonly cabDoor: number;
    readonly slideFrom = 25;
    readonly slideTo: number;
    readonly windowBottom = px(1.45);

    constructor(s: Size) {
        this.width = s.w;
        this.length = s.d;
        this.height = s.h;
        this.roofEnd = s.d - 18;
        this.screenEnd = s.d - 10;
        this.frontAxle = s.d - 12;
        this.cabDoor = this.roofEnd - 3;
        this.slideTo = this.cabDoor - 1;
    }

    /** Height of the van's upper surface at y along it: roof, rounded roof front, windscreen, bonnet. */
    top(y: number): number {
        if (y < this.roofEnd) return this.height;
        if (y === this.roofEnd) return this.height - 1;
        if (y <= this.screenEnd) return Math.round(this.height - 1 - ((y - this.roofEnd) * (this.height - 1 - this.bonnetZ)) / (this.screenEnd - this.roofEnd));
        return Math.round(this.bonnetZ - ((y - this.screenEnd) * (this.bonnetZ - this.noseZ)) / (this.length - 1 - this.screenEnd));
    }

    region(y: number): 'roof' | 'screen' | 'bonnet' {
        return y <= this.roofEnd ? 'roof' : y <= this.screenEnd ? 'screen' : 'bonnet';
    }

    /** Distance from a wheel's centre on the side of the van, or Infinity away from the wheels. */
    wheelDistance(y: number, z: number): number {
        const cz = this.wheelR;
        return Math.min(...[this.rearAxle, this.frontAxle].map(a => Math.hypot(y + 0.5 - (a + 0.5), z - 0.5 - cz)));
    }
}

/** Roof colour at a point of the roof: faint ribs across it, a lit edge where it rounds over towards the viewer. */
function roof(y: number, nearEdge: boolean, farEdge: boolean): number {
    if (nearEdge) return B[5]!;
    if (farEdge) return B[3]!;
    return y % 8 === 4 ? mix(B[4]!, B[3]!, 0.5) : B[4]!;
}

/** Windscreen glass: dark, a pale band of sky along its top edge and one diagonal reflection. */
function screenGlass(u: number, v: number, topEdge: boolean): number {
    if (topEdge) return G[3];
    const k = (u + v * 2) % 23;
    return k === 0 || k === 1 ? G[3] : k === 3 ? G[2] : G[0];
}

/** The side panel at height z of a side whose top is at zTop: lit shoulder, gutter shadow, panel, rub strip, sill. */
function sidePanel(z: number, zTop: number): number {
    if (z === zTop) return B[5]!;
    if (z === zTop - 1) return B[2]!;
    if (z >= zTop - 4) return B[4]!;
    if (z === 9) return S[2];
    if (z >= 10) return B[3]!;
    if (z >= 4) return B[2]!;
    return z === 3 ? B[1]! : T[0]!;
}

/**
 * Looking at the van's side: its right side (with the sliding door) when it faces east, nose to the screen's right; its
 * left side when it faces west, nose to the left.
 */
function side(shape: Shape, right: boolean, k: number): View {
    const v = new View(shape.length, shape.width, shape.height, 0, k);
    const X = (y: number) => (right ? y : shape.length - 1 - y);
    const toNose = right ? NORMAL.right : NORMAL.left;
    // The upper surfaces, seen across the van's width.
    for (let y = 0; y < shape.length; y++) {
        const z = shape.top(y), region = shape.region(y);
        for (let across = 0; across < shape.width; across++) {
            const near = across === shape.width - 1, far = across === 0;
            if (region === 'roof') v.top(X(y), across, z, roof(y, near, far));
            else if (region === 'screen') {
                const pillar = across < 2 || across > shape.width - 3;
                v.top(X(y), across, z, pillar ? B[3]! : screenGlass(across, y, across === 2), toNose);
            } else v.top(X(y), across, z, near ? B[5]! : across === Math.floor(shape.width / 2) ? B[5]! : B[4]!);
        }
    }
    // The side itself.
    for (let y = 0; y < shape.length; y++) {
        const zTop = shape.top(y), x = X(y);
        for (let z = zTop; z >= 1; z--) {
            const wheel = shape.wheelDistance(y, z);
            let c: number | null = sidePanel(z, zTop);
            let normal = z === zTop ? NORMAL.slope : NORMAL.face;
            // Cab window, its front edge following the windscreen.
            if (y > shape.cabDoor && z >= shape.windowBottom && z <= zTop - 2) c = z === zTop - 2 ? G[3] : screenGlass(y, z, false);
            if (y === shape.cabDoor && z >= 4 && z < zTop - 1) c = B[2]!;
            if (y === shape.cabDoor + 1 && z === 14) c = S[1];
            if (right) {
                if ((y === shape.slideFrom || y === shape.slideTo) && z >= 4 && z < zTop - 1) c = B[2]!;
                if (z === 24 && y > shape.slideFrom && y < shape.slideTo) c = B[2]!;
                if (z === 15 && (y === shape.slideTo - 2 || y === shape.slideTo - 3)) c = S[1];
            } else if (y === 8 && z === 14) c = B[2]!;
            // Signwriting along the cargo box: a swoosh and a line of lettering.
            if (z === 19 && y >= 5 && y < 24) c = LETTERING;
            if (z === 20 && y >= 8 && y < 22) c = LETTERING;
            if (z === 16 && y >= 5 && y < 20 && y % 3 !== 2) c = LETTERING_FAINT;
            // Lights, bumpers, then the wheels in their arches.
            if (y === 0 && z >= 12 && z <= 18) c = z <= 13 ? AMBER : RED;
            if (y >= shape.length - 2 && z >= 10 && z <= 12) c = LAMP;
            if (y === shape.length - 1 && z === 9) c = AMBER;
            if ((y <= 2 || y >= shape.length - 4) && z >= 2 && z <= 5) c = z === 5 ? S[3] : S[1];
            if (wheel <= shape.wheelR + 1.1 && z >= 3) { c = B[1]!; normal = NORMAL.face; }
            if (wheel <= shape.wheelR) c = wheel <= 2.4 ? (wheel <= 0.8 ? S[1] : S[3]) : T[1]!;
            if (wheel <= shape.wheelR && wheel > shape.wheelR - 1 && z > 5) c = T[2]!;
            if (c !== null) v.face(x, z, c, shape.width, normal);
        }
    }
    // Wing mirror, standing out from the side by the windscreen.
    const mirrorY = shape.roofEnd + 2;
    for (const z of [20, 21, 22]) {
        v.face(X(mirrorY), z, z === 21 ? G[3] : S[1], shape.width + 2);
        v.face(X(mirrorY + 1), z, S[1], shape.width + 2);
    }
    v.top(X(mirrorY), shape.width + 1, 23, S[2]);
    v.top(X(mirrorY + 1), shape.width + 1, 23, S[2]);
    v.outline();
    return v;
}

/** Looking at the nose: roof, windscreen and bonnet from above, then the front with its grille and lamps. */
function front(shape: Shape, k: number): View {
    const v = new View(shape.width, shape.length, shape.height, 2, k);
    const W = shape.width, mid = Math.floor(W / 2);
    for (let y = 0; y < shape.length; y++) {
        const z = shape.top(y), region = shape.region(y);
        // Where the surface slopes down faster than it runs forward, each row covers several screen lines.
        const lowest = y + 1 < shape.length ? Math.min(z, shape.top(y + 1)) : z;
        for (let zz = z; zz >= lowest; zz--) for (let x = 0; x < W; x++) {
            const edge = x === 0 || x === W - 1;
            const normal = x === 0 ? NORMAL.left : x === W - 1 ? NORMAL.right : region === 'screen' ? NORMAL.slope : NORMAL.top;
            let c: number;
            if (region === 'roof') c = edge ? B[3]! : roof(y, y === shape.roofEnd, y === 0);
            else if (region === 'screen') {
                const pillar = x < 2 || x > W - 3;
                c = pillar ? B[3]! : screenGlass(x, y - zz, y === shape.roofEnd + 1 && zz === z);
                // Wipers parked along the bottom of the glass.
                if (y === shape.screenEnd && zz === lowest && ((x >= 4 && x < 11) || (x >= 14 && x < 21))) c = T[1]!;
            } else c = edge ? B[3]! : y === shape.length - 1 ? B[5]! : x === mid ? B[5]! : B[4]!;
            v.top(x, y, zz, c, normal);
        }
    }
    // Mirrors, sticking out either side by the windscreen.
    const mirrorY = shape.roofEnd + 2;
    for (const x of [-2, -1, W, W + 1]) {
        v.top(x, mirrorY, 23, S[2]);
        for (const z of [20, 21, 22]) v.face(x, z, z === 21 && (x === -2 || x === W + 1) ? G[3] : S[1], mirrorY + 2);
    }
    // The front face, from the bonnet's lip down to the road.
    for (let z = shape.noseZ; z >= 1; z--) for (let x = 0; x < W; x++) {
        const corner = (x === 0 || x === W - 1) && z === shape.noseZ;
        if (corner) continue;
        let c: number = z === shape.noseZ ? B[5]! : z >= 13 ? B[3]! : z >= 6 ? B[2]! : z >= 2 ? (z === 5 ? S[3] : S[1]) : T[0]!;
        if (z >= 10 && z <= 12 && (x <= 3 || x >= W - 4)) c = x === 0 || x === W - 1 ? B[3]! : LAMP;
        if (z === 9 && (x === 1 || x === 2 || x === W - 2 || x === W - 3)) c = AMBER;
        if (z >= 8 && z <= 12 && x >= 6 && x <= W - 7) c = z % 2 === 0 ? S[0] : S[1];
        if (z === 11 && x === mid) c = PAL.brass[4];
        if ((z === 3 || z === 4) && x >= mid - 3 && x <= mid + 3) c = (z === 3 && (x - mid) % 2 === 0 && x !== mid - 3 && x !== mid + 3) ? PAL.ink : LAMP;
        v.face(x, z, c, shape.length, x === 0 ? NORMAL.left : x === W - 1 ? NORMAL.right : NORMAL.face);
    }
    v.outline();
    return v;
}

/** Looking at the back: a sliver of bonnet beyond the roof, the long roof, then the rear doors. */
function rear(shape: Shape, k: number): View {
    const v = new View(shape.width, shape.length, shape.height, 2, k);
    const W = shape.width, mid = Math.floor(W / 2), L = shape.length;
    // Far to near: world row 0 is the nose. The windscreen faces away from the camera, so only bonnet and roof show.
    for (let row = 0; row < L; row++) {
        const y = L - 1 - row, region = shape.region(y), z = shape.top(y);
        if (region === 'screen') continue;
        for (let x = 0; x < W; x++) {
            const edge = x === 0 || x === W - 1;
            const normal = x === 0 ? NORMAL.left : x === W - 1 ? NORMAL.right : NORMAL.top;
            const c = edge ? B[3]! : region === 'roof' ? roof(y, y === 0, y === shape.roofEnd) : B[4]!;
            v.top(W - 1 - x, row, z, c, normal);
        }
    }
    // The backs of the mirrors, past the roof's far corners.
    const mirrorRow = L - 1 - (shape.roofEnd + 2);
    for (const x of [-2, -1, W, W + 1]) for (const z of [20, 21, 22]) v.face(x, z, S[1], mirrorRow);
    // Rear doors: split down the middle, windows high up, lamps on the corners, the bumper and plate at the bottom.
    for (let z = shape.height; z >= 1; z--) for (let x = 0; x < W; x++) {
        const corner = (x === 0 || x === W - 1) && z === shape.height;
        if (corner) continue;
        let c: number = z === shape.height ? B[5]! : z === shape.height - 1 ? B[2]! : z >= 10 ? B[3]! : z >= 6 ? B[2]! : z >= 2 ? (z === 5 ? S[3] : S[1]) : T[0]!;
        if (x === mid && z >= 6 && z < shape.height - 1) c = B[2]!;
        if ((x === 0 || x === W - 1) && z >= 6) c = B[3]!;
        if (z >= 19 && z <= 25 && ((x >= 2 && x <= mid - 2) || (x >= mid + 2 && x <= W - 3))) c = z === 25 ? G[3] : screenGlass(x, -z, false);
        if (z >= 12 && z <= 18 && (x <= 1 || x >= W - 2)) c = z <= 13 ? AMBER : z === 14 ? LAMP : RED;
        if (z === 14 && (x === mid - 1 || x === mid + 1)) c = S[1];
        if ((z === 7 || z === 8) && x >= mid - 3 && x <= mid + 3) c = z === 7 && (x - mid) % 2 === 0 && x !== mid - 3 && x !== mid + 3 ? PAL.ink : LAMP;
        v.face(x, z, c, L, x === 0 ? NORMAL.left : x === W - 1 ? NORMAL.right : NORMAL.face);
    }
    v.outline();
    return v;
}

/** The van seen facing `facing` (its nose's direction); `s` is its catalog size in its own frame. */
export function vanArt(s: Size, facing: Facing, depthScale = TOP_DEPTH): PropArt {
    const shape = new Shape(s);
    switch (facing) {
        case 'south': return front(shape, depthScale).art();
        case 'north': return rear(shape, depthScale).art();
        case 'east': return side(shape, true, depthScale).art();
        case 'west': return side(shape, false, depthScale).art();
    }
}
