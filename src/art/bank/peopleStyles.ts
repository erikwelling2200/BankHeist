import type { PersonMask } from '../../level/plan';
import { PAL, deepen, mix, type Ramp } from '../palette';
import { PixelBitmap } from '../PixelBitmap';
import { inner, none } from './edges';
import { H, LIGHT_PROXY, PERSON_EDGE, standardPerson, type PersonSpec, type PersonStyle } from './people';

/*
 * Alternative drawing styles for the cast, to compare against the standard one in the real scene: `?people=lean`,
 * `chunky`, `noir` or `hibit` in the address. Every style draws from the same looks (`LOOKS`), so the cast stays the same
 * people; poses (lying down) keep the standard drawing except where a style is a pass over it.
 *
 * STYLE CARD, shared by all of them: the bank's ramps only, light from above and a little left, edges inside the
 * silhouette (never a ring round it), no outlines in black, and a figure about 1.75m tall on its tile.
 */

/** Body proportions of a parametric figure, in pixels on the 16x24 canvas. Widths are even, centred between x = 7 and 8. */
interface Build {
    /** Head width, and face height from the brow to the chin; the hair's crown sits a row above the face. */
    head: number;
    face: number;
    shoulders: number;
    waist: number;
    /** Rows of torso from the shoulders to the belt, and of legs from the belt to the shoes. */
    torso: number;
    legs: number;
    /** Each leg's width, and the arms' thickness. */
    leg: number;
    arm: number;
    /** Rows of neck between the chin and the shoulders (0 for a thick-set build). */
    neck: number;
}

/** About six heads tall: narrow shoulders, a small head and long legs, the proportions of an adult rather than a doll. */
const LEAN: Build = { head: 4, face: 4, shoulders: 6, waist: 6, torso: 7, legs: 8, leg: 2, arm: 1, neck: 1 };
/** About three heads tall and nearly as wide as a tile: Door Kickers: Action Squad's stocky tactical figures. */
const CHUNKY: Build = { head: 6, face: 5, shoulders: 8, waist: 8, torso: 6, legs: 5, leg: 3, arm: 2, neck: 0 };

const span = (w: number): [number, number] => [8 - w / 2, 8 + w / 2 - 1];

/**
 * A figure built from proportions: shoes, legs, torso and arms, neck, head, hair, then the mask and what is carried.
 * Simpler than the standard drawing in its details (one or two marks per garment), so the proportions are what differs.
 */
function proportioned(build: Build): PersonStyle {
    return (spec, facing) => {
        if (spec.pose) return standardPerson(spec, facing);
        const b = new PixelBitmap(16, 24), front = facing === 'front';
        const wide = spec.broad ? 2 : 0;
        const bd = { ...build, shoulders: build.shoulders + wide, waist: build.waist + wide, legs: build.legs - (spec.short ?? 0) };
        const shoeTop = 22, legTop = shoeTop - bd.legs, belt = legTop - 1, torsoTop = belt - bd.torso + 1;
        const chin = torsoTop - 1 - bd.neck, faceTop = chin - bd.face + 1, crown = faceTop - 1;
        const [sl, sr] = span(bd.shoulders), [wl, wr] = span(bd.waist), [hl, hr] = span(bd.head);
        const { skin, top: cloth, legs } = spec;
        const sleeves = spec.topKind === 'police' || spec.topKind === 'tactical' ? spec.under ?? cloth : spec.topKind === 'vest' ? spec.under ?? PAL.cloth.white : cloth;
        const hands = spec.topKind === 'tactical' ? PAL.cloth.black : skin;
        const long = spec.topKind === 'coat' || spec.topKind === 'dress', hem = long ? legTop + Math.ceil(bd.legs / 2) : belt;

        // Shoes and legs: the left leg in the light, the right a step down, a gap between them below the seat.
        const gap = bd.waist - 2 * bd.leg;
        for (let y = legTop; y < shoeTop; y++) {
            const leg = spec.topKind === 'dress' ? skin : legs;
            for (let i = 0; i < bd.leg; i++) {
                b.set(wl + i, y, leg[2]!, H.legs);
                b.set(wr - i, y, leg[1]!, H.legs);
            }
            for (let x = wl + bd.leg; x <= wr - bd.leg; x++) if (y <= legTop + 1 || gap <= 0) b.set(x, y, deepen(leg[1]!, 0.2), H.legs - 0.05);
        }
        for (let i = -1; i < bd.leg; i++) {
            b.set(wl + i + (i < 0 ? 0 : 0), shoeTop, spec.shoes[2]!, H.shoes);
            b.set(wr - i, shoeTop, spec.shoes[1]!, H.shoes);
        }
        for (let x = wl - 1; x <= wr + 1; x++) if (x < wl + bd.leg || x > wr - bd.leg) b.set(x, 23, spec.shoes[0]!, H.shoes - 0.1);

        // Torso, from the shoulders tapering to the waist, a coat or dress carrying on over the legs.
        for (let y = torsoTop; y <= hem; y++) {
            const t = Math.min(1, (y - torsoTop) / Math.max(1, bd.torso - 1));
            const flare = spec.topKind === 'dress' && y > belt ? Math.min(2, y - belt) : 0;
            const l = Math.round(sl + (wl - sl) * t) - flare, r = Math.round(sr + (wr - sr) * t) + flare;
            // Sloping shoulders: the top row is a pixel in each side.
            const slope = y === torsoTop ? 1 : 0;
            for (let x = l + slope; x <= r - slope; x++) b.set(x, y, y === torsoTop ? cloth[3]! : x >= r - 1 ? cloth[1]! : cloth[2]!, H.torso);
        }

        // Arms hang outside the shoulders to the hands, beside the belt.
        const bareFrom = spec.topKind === 'tee' || spec.topKind === 'polo' ? torsoTop + 3 : 99;
        for (let y = torsoTop + 1; y <= belt; y++) for (let i = 0; i < bd.arm; i++) {
            b.set(sl - 1 - i, y, y >= bareFrom ? skin[2]! : y === torsoTop + 1 ? sleeves[3]! : sleeves[2]!, H.arm);
            b.set(sr + 1 + i, y, y >= bareFrom ? skin[1]! : sleeves[1]!, H.arm);
        }
        for (let i = 0; i < bd.arm; i++) {
            b.set(sl - 1 - i, belt + 1, hands[2]!, H.arm);
            b.set(sr + 1 + i, belt + 1, hands[1]!, H.arm);
        }

        garment(b, spec, front, { torsoTop, belt, hem, sl, sr, wl, wr });

        // Neck, face, hair and mask.
        for (let y = chin + 1; y < torsoTop; y++) for (let x = 7; x <= 8; x++) b.set(x, y, skin[1]!, H.face);
        const eyes = faceTop + Math.floor(bd.face / 2) - (bd.face > 4 ? 0 : 1);
        for (let y = faceTop; y <= chin; y++) for (let x = hl; x <= hr; x++) b.set(x, y, y === chin || x === hr ? skin[1]! : skin[2]!, H.face);
        if (front) {
            b.set(hl + 1, eyes, PAL.ink, H.face - 0.1);
            b.set(hr - 1, eyes, PAL.ink, H.face - 0.1);
            if (spec.glasses) { b.set(hl, eyes, PAL.steel[1], H.face + 0.05); b.set(hr, eyes, PAL.steel[1], H.face + 0.05); }
            if (spec.beard && !spec.mask) for (let x = hl; x <= hr; x++) b.set(x, chin, spec.hair[1]!, H.face);
        }
        const head = { hl, hr, crown, faceTop, chin, eyes };
        if (spec.mask === 'balaclava') {
            mask(b, spec, 'balaclava', front, head);
            if (['cap', 'policeCap', 'helmet'].includes(spec.hairStyle)) hair(b, { ...spec, hair: PAL.cloth.black }, front, head);
        } else {
            hair(b, spec, front, head);
            if (spec.mask) mask(b, spec, spec.mask, front, head);
        }
        carry(b, spec, front, { torsoTop, belt, sl, sr });
        PERSON_EDGE(b);
        return b;
    };
}

interface Body { torsoTop: number; belt: number; hem: number; sl: number; sr: number; wl: number; wr: number }

/** One or two marks per kind of top: an open front, a collar, a badge and duty belt, pouches, a hood. */
function garment(b: PixelBitmap, spec: PersonSpec, front: boolean, { torsoTop, belt, hem, sl, sr, wl, wr }: Body): void {
    const cloth = spec.top, under = spec.under ?? PAL.cloth.white, beltRow = (c: number) => { for (let x = wl; x <= wr; x++) b.set(x, belt, c, H.torso + 0.03); };
    if (!front) {
        if (spec.topKind === 'hoodie') for (let x = 6; x <= 9; x++) b.set(x, torsoTop, cloth[3]!, H.torso + 0.1);
        if (spec.topKind === 'suit' || spec.topKind === 'coat') for (let y = torsoTop + 2; y <= hem; y++) b.set(8, y, cloth[0]!, H.torso);
        if (['shirt', 'uniform', 'tee', 'polo', 'bomber', 'police', 'tactical', 'work'].includes(spec.topKind)) beltRow(PAL.cloth.black[1]!);
        if (spec.topKind === 'police') for (let x = sl; x <= sr; x++) b.set(x, torsoTop + 3, PAL.cloth.white[x >= sr - 1 ? 1 : 2]!, H.torso + 0.02);
        return;
    }
    switch (spec.topKind) {
        case 'suit':
        case 'cardigan':
        case 'bomber':
        case 'work':
        case 'coat': {
            // An open front: the shirt or tee in a V, a tie down it.
            const shirt = spec.topKind === 'work' ? spec.under ?? PAL.cloth.charcoal : under;
            for (let y = torsoTop; y <= torsoTop + 2; y++) for (let x = 7 - (2 - (y - torsoTop)) + 1; x <= 8 + (2 - (y - torsoTop)) - 1; x++) b.set(x, y, shirt[3]!, H.torso + 0.02);
            if (spec.topKind !== 'suit' && spec.topKind !== 'coat') for (let y = torsoTop + 3; y < belt; y++) { b.set(7, y, shirt[2]!, H.torso); b.set(8, y, shirt[1]!, H.torso); }
            if (spec.topKind === 'coat') for (let y = torsoTop + 3; y <= hem; y++) b.set(8, y, cloth[0]!, H.torso);
            if (spec.tie) for (let y = torsoTop; y <= torsoTop + 3; y++) b.set(7, y, spec.tie[2]!, H.torso + 0.05);
            if (spec.topKind === 'bomber') beltRow(cloth[0]!);
            break;
        }
        case 'vest':
            for (let y = torsoTop + 1; y < belt; y++) b.set(8, y, cloth[0]!, H.torso);
            b.set(7, torsoTop, under[3]!, H.torso); b.set(8, torsoTop, under[3]!, H.torso);
            if (spec.tie) for (let y = torsoTop + 1; y <= torsoTop + 2; y++) b.set(7, y, spec.tie[2]!, H.torso + 0.05);
            break;
        case 'shirt':
        case 'tee':
        case 'polo':
            b.set(7, torsoTop, cloth[1]!, H.torso); b.set(8, torsoTop, cloth[1]!, H.torso);
            if (spec.tie) for (let y = torsoTop + 1; y <= torsoTop + 3; y++) b.set(7, y, spec.tie[2]!, H.torso + 0.05);
            beltRow(PAL.cloth.black[spec.topKind === 'shirt' ? 1 : 2]!);
            break;
        case 'hoodie':
            for (let x = 6; x <= 9; x++) b.set(x, torsoTop, cloth[3]!, H.torso + 0.1);
            for (let x = 6; x <= 9; x++) b.set(x, belt - 1, cloth[1]!, H.torso);
            break;
        case 'dress':
            for (let x = 6; x <= 9; x++) b.set(x, torsoTop, spec.skin[2]!, H.face);
            break;
        case 'uniform':
        case 'police':
            b.set(sr - 1, torsoTop + 2, PAL.brass[4], H.torso + 0.1);
            b.set(sl + 1, torsoTop + 1, PAL.cloth.black[0]!, H.torso + 0.1);
            if (spec.topKind === 'police') for (let x = sl; x <= sr; x++) b.set(x, torsoTop + 3, PAL.cloth.white[x >= sr - 1 ? 1 : 2]!, H.torso + 0.02);
            beltRow(PAL.cloth.black[1]!);
            b.set(7, belt, PAL.brass[4], H.torso + 0.1); b.set(8, belt, PAL.brass[3], H.torso + 0.1);
            break;
        case 'tactical':
            for (let x = sl + 1; x <= sr - 1; x += 2) { b.set(x, torsoTop + 3, cloth[3]!, H.torso + 0.12); b.set(x, torsoTop + 4, cloth[1]!, H.torso + 0.1); }
            for (let y = torsoTop; y <= belt; y++) { b.set(sl, y, (spec.under ?? PAL.cloth.charcoal)[2]!, H.torso - 0.04); b.set(sr, y, (spec.under ?? PAL.cloth.charcoal)[1]!, H.torso - 0.04); }
            beltRow(PAL.cloth.black[1]!);
            break;
    }
    if (spec.lanyard) { b.set(sl + 1, torsoTop + 1, PAL.cloth.burgundy[3]!, H.torso + 0.05); b.set(sl + 1, torsoTop + 2, PAL.paper[3], H.torso + 0.1); }
}

interface Head { hl: number; hr: number; crown: number; faceTop: number; chin: number; eyes: number }

/** Hair or headgear over the crown and down the sides; from behind it covers the head to the nape. */
function hair(b: PixelBitmap, spec: PersonSpec, front: boolean, { hl, hr, crown, faceTop, chin }: Head): void {
    const { hair: h, skin } = spec, px = (x: number, y: number, c: number, raise = 0) => b.set(x, y, c, H.hair + raise);
    const row = (y: number, c: number, from = hl, to = hr, raise = 0) => { for (let x = from; x <= to; x++) px(x, y, c, raise); };
    const back = () => { for (let y = faceTop; y < chin; y++) row(y, y === chin - 1 ? h[0]! : h[1]!); for (let x = hl + 1; x < hr; x++) b.set(x, chin, skin[1]!, H.face); };
    switch (spec.hairStyle) {
        case 'cap':
            row(crown, spec.top[2]!); px(hl + 1, crown, spec.top[3]!);
            if (front) row(faceTop, PAL.cloth.black[0]!, hl - 1, hr + 1, -0.02); else back();
            px(Math.floor((hl + hr) / 2), crown, PAL.brass[4], 0.05);
            return;
        case 'policeCap':
            row(crown - 1, PAL.cloth.navy[2]!, hl - 1, hr + 1); px(hl, crown - 1, PAL.cloth.navy[3]!);
            for (let x = hl; x <= hr; x++) px(x, crown, x % 2 ? PAL.cloth.white[1]! : PAL.cloth.navy[0]!, -0.02);
            if (front) row(faceTop, PAL.cloth.black[0]!, hl, hr, -0.03); else back();
            return;
        case 'helmet':
            row(crown - 1, PAL.steel[1], hl, hr, 0.05); px(hl + 1, crown - 1, PAL.steel[2], 0.08);
            row(crown, PAL.steel[1], hl - 1, hr + 1); row(faceTop, PAL.steel[0], hl - 1, hr + 1, -0.02);
            px(hl - 1, faceTop + 1, PAL.steel[0], -0.04); px(hr + 1, faceTop + 1, PAL.steel[0], -0.04);
            if (!front) back();
            return;
        case 'bald':
            row(crown, skin[2]!, hl + 1, hr - 1); px(hl + 1, crown, skin[3]!);
            if (front) { px(hl, faceTop + 1, h[1]!); px(hr, faceTop + 1, h[0]!); } else for (let x = hl; x <= hr; x++) px(x, chin - 1, h[1]!);
            return;
        default:
            row(crown, h[1]!); px(hl, crown, h[2]!); px(hl + 1, crown, h[2]!);
            if (spec.hairStyle === 'buzz') row(crown, mix(h[1]!, skin[2]!, 0.35));
            if (front) { row(faceTop, spec.hairStyle === 'buzz' ? mix(h[1]!, skin[2]!, 0.35) : h[1]!); px(hl, faceTop, h[2]!); }
            else back();
            if (spec.hairStyle === 'long') for (let y = faceTop; y <= chin + 2; y++) { px(hl - 1, y, h[1]!); px(hr + 1, y, h[0]!); }
            if (spec.hairStyle === 'bun') { px(7, crown - 1, h[1]!); px(8, crown - 1, h[0]!); }
            if (spec.hairStyle === 'ponytail') {
                if (front) px(hr + 1, faceTop + 1, h[0]!);
                else for (let y = chin; y <= chin + 2; y++) { px(7, y, h[1]!); px(8, y, h[0]!); }
            }
    }
}

/** The four masks, drawn to the head's size: knit with an eye slot, a goalie's mask, a printed bandana, a respirator. */
function mask(b: PixelBitmap, spec: PersonSpec, kind: PersonMask, front: boolean, { hl, hr, crown, faceTop, chin, eyes }: Head): void {
    const px = (x: number, y: number, c: number, raise = 0) => b.set(x, y, c, H.face + raise);
    const black = PAL.cloth.black, white = PAL.cloth.white;
    if (kind === 'balaclava') {
        for (let y = crown; y <= chin + 1; y++) for (let x = hl; x <= hr; x++) {
            if (y === chin + 1 && (x === hl || x === hr)) continue;
            px(x, y, y === crown && x <= hl + 1 ? black[3]! : x === hr ? black[1]! : black[2]!, 0.05);
        }
        if (front) for (let x = hl; x <= hr; x++) px(x, eyes, x === hl + 1 || x === hr - 1 ? PAL.ink : spec.skin[2]!, -0.04);
        return;
    }
    if (!front) {
        // A strap round the back of the head, or the bandana's knot.
        for (let x = hl; x <= hr; x++) px(x, eyes, kind === 'hockey' ? white[0]! : black[2]!, 0.02);
        if (kind === 'respirator') { px(hl - 1, chin - 1, PAL.cloth.beige[2]!); px(hr + 1, chin - 1, PAL.cloth.beige[1]!); }
        return;
    }
    if (kind === 'hockey') {
        for (let y = faceTop; y <= chin; y++) for (let x = hl; x <= hr; x++) px(x, y, x === hr ? white[1]! : y === faceTop ? white[3]! : white[2]!, 0.06);
        px(hl + 1, eyes, PAL.ink, -0.1); px(hr - 1, eyes, PAL.ink, -0.1);
        if (chin - eyes >= 2) { px(hl + 1, chin, deepen(white[0]!, 0.3)); px(hr - 1, chin, deepen(white[0]!, 0.3)); }
        return;
    }
    if (kind === 'skull') {
        for (let y = eyes + 1; y <= chin + 1; y++) for (let x = hl; x <= hr; x++) {
            if (y === chin + 1 && (x === hl || x === hr)) continue;
            px(x, y, (y === eyes + 2 || y === chin) && x % 2 === 0 && x > hl && x < hr ? PAL.paper[1] : x === hr ? black[1]! : black[2]!, 0.04);
        }
        return;
    }
    for (let y = eyes + 1; y <= chin; y++) for (let x = hl + 1; x <= hr - 1; x++) px(x, y, black[2]!, 0.06);
    px(Math.floor((hl + hr) / 2), chin, PAL.steel[2], 0.1);
    px(hl, chin, PAL.cloth.beige[3]!, 0.14); px(hr, chin, PAL.cloth.beige[2]!, 0.12);
}

/** What is carried, kept to a shape and a colour: a bag at the hip, a case in the hand, a carbine across the chest. */
function carry(b: PixelBitmap, spec: PersonSpec, front: boolean, { torsoTop, belt, sl, sr }: { torsoTop: number; belt: number; sl: number; sr: number }): void {
    const box = (x: number, y: number, w: number, h: number, ramp: Ramp | readonly number[]) => {
        for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) b.set(xx, yy, yy === y ? ramp[2]! : ramp[1]!, 0.75);
    };
    switch (spec.carry) {
        case 'briefcase': box(sr + 1, belt + 1, 3, 3, PAL.walnut); break;
        case 'handbag': box(sl - 3, belt - 2, 3, 3, PAL.cloth.burgundy); break;
        case 'cashCase': box(sr + 1, belt + 1, 3, 3, PAL.steel); break;
        case 'laptopBag': box(front ? sl - 2 : sr, belt - 1, 3, 3, PAL.cloth.black); break;
        case 'duffel':
            if (front) for (let i = 0; i < belt - torsoTop; i++) b.set(sl + 1 + i, torsoTop + 1 + i, PAL.cloth.black[2]!, 0.9);
            box(front ? sr - 1 : sl - 2, belt - 1, 4, 3, PAL.cloth.olive);
            break;
        case 'rifle':
            if (front) for (let i = 0; i <= sr - sl + 1; i++) b.set(sr + 1 - i, torsoTop + 1 + Math.floor(i * 0.6), i % 3 ? PAL.cloth.black[0]! : PAL.steel[3], H.arm + 0.12);
            else b.set(sl - 2, belt, PAL.cloth.black[0]!, H.arm + 0.1);
            break;
        default:
    }
}

/**
 * Noir: the standard drawing with the clothes pushed dark and grey, so a figure is first a silhouette against the floor;
 * skin, metal, brass and reflective trim keep their value and catch the lamps.
 */
const noir: PersonStyle = (spec, facing) => {
    const b = standardPerson(spec, facing), keep = new Set<number>([...Object.values(PAL.skin).flat(), ...PAL.brass, ...PAL.steel.slice(3)]);
    b.each((x, y, color, height) => {
        if (!b.opaque(x, y) || keep.has(color)) return;
        const r = (color >> 16) & 255, g = (color >> 8) & 255, bl = color & 255, grey = (r * 3 + g * 6 + bl) / 10;
        if (grey > 175) return;
        const desaturated = mix(color, (grey << 16) | (grey << 8) | grey, 0.55);
        return [mix(desaturated, PAL.void, 0.42), height];
    });
    return b;
};

/**
 * Hi-bit: twice the pixels in the same 16x24 place (32x48 drawn at half scale), from the standard drawing smoothed by
 * EPX and refined where size matters most: eyes with a pupil and a brow, a nose and a mouth, so faces and masks read.
 * Lit through the standard drawing (`LIGHT_PROXY`).
 */
const hiBit: PersonStyle = (spec, facing) => {
    const base = standardPerson(spec, facing, none), b = epx(base);
    if (facing === 'front' && !spec.pose && !spec.mask) {
        const top = 2 * (1 + (spec.short ?? 0)), skin = spec.skin;
        for (const [x, pupil] of [[12, 13], [18, 18]] as const) {
            for (let dx = 0; dx < 2; dx++) { b.set(x + dx, top + 6, skin[1]!, H.face - 0.04); b.set(x + dx, top + 7, PAL.cloth.white[2]!, H.face - 0.06); }
            b.set(pupil, top + 7, PAL.ink, H.face - 0.1);
            for (let dx = 0; dx < 2; dx++) b.set(x + dx, top + 5, deepen(spec.hair[1]!, 0.2), H.face + 0.02);
        }
        b.set(16, top + 8, skin[1]!, H.face + 0.04);
        b.set(16, top + 9, deepen(skin[1]!, 0.25), H.face);
        for (let x = 14; x <= 17; x++) b.set(x, top + 11, deepen(skin[1]!, x === 14 || x === 17 ? 0.2 : 0.4), H.face - 0.04);
    }
    inner(0.3)(b);
    LIGHT_PROXY.set(b, standardPerson(spec, facing));
    return b;
};

/** EPX (Scale2x): doubles a drawing, rounding its diagonals instead of making blocks; heights travel with the colours. */
function epx(src: PixelBitmap): PixelBitmap {
    const out = new PixelBitmap(src.width * 2, src.height * 2);
    const at = (x: number, y: number): [number, number, boolean] => src.inBounds(x, y) && src.opaque(x, y) ? [src.color(x, y), src.heightAt(x, y), true] : [-1, 0, false];
    const same = (a: [number, number, boolean], c: [number, number, boolean]) => a[0] === c[0];
    for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
        const p = at(x, y), a = at(x, y - 1), bb = at(x + 1, y), c = at(x - 1, y), d = at(x, y + 1);
        const quads = [
            same(c, a) && !same(c, d) && !same(a, bb) ? a : p, same(a, bb) && !same(a, c) && !same(bb, d) ? bb : p,
            same(c, d) && !same(c, a) && !same(d, bb) ? c : p, same(d, bb) && !same(bb, a) && !same(d, c) ? d : p
        ];
        quads.forEach(([color, height, opaque], q) => { if (opaque) out.set(2 * x + (q % 2), 2 * y + (q >> 1), color, height); });
    }
    return out;
}

export const PERSON_STYLES: Record<string, PersonStyle> = { lean: proportioned(LEAN), chunky: proportioned(CHUNKY), noir, hibit: hiBit };
