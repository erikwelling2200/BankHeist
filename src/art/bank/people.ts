import type { PersonMask, PersonPose } from '../../level/plan';
import { PAL, deepen, mix, type Ramp } from '../palette';
import { PixelBitmap } from '../PixelBitmap';
import { inner, type Edge } from './edges';

/** People are 16x24: about four heads tall, feet on the bottom row, so one stands on a tile and overlaps the row above. */
export const PERSON_WIDTH = 16;
export const PERSON_HEIGHT = 24;

/** `policeCap` is the patrol officer's peaked cap (officer.ts), `helmet` a SWAT team's ballistic helmet. */
type HairStyle = 'short' | 'long' | 'bald' | 'bun' | 'ponytail' | 'cap' | 'buzz' | 'policeCap' | 'helmet';
/** Hair styles that are something worn on the head, which stay on over a balaclava. */
const HEADGEAR: readonly HairStyle[] = ['cap', 'policeCap', 'helmet'];
/**
 * `work` is a canvas work jacket worn open over a tee (`under`); `police` the patrol officer's stab vest (`top`) over a
 * shirt (`under`, the sleeves); `tactical` a plate carrier (`top`) over fatigues (`under`, the sleeves), with gloves.
 */
type TopKind = 'suit' | 'shirt' | 'vest' | 'uniform' | 'coat' | 'tee' | 'polo' | 'hoodie' | 'dress' | 'cardigan' | 'bomber' | 'work' | 'police'
    | 'tactical';
type Carry = 'briefcase' | 'duffel' | 'handbag' | 'laptopBag' | 'cashCase' | 'rifle' | 'none';

export interface PersonSpec {
    skin: Ramp;
    hair: Ramp;
    hairStyle: HairStyle;
    top: Ramp;
    topKind: TopKind;
    /** The shirt under a jacket, cardigan or vest. */
    under?: Ramp;
    tie?: Ramp;
    legs: Ramp;
    shoes: Ramp;
    /** Pixels shorter than the tallest build. */
    short?: 0 | 1 | 2;
    carry?: Carry;
    lanyard?: boolean;
    glasses?: boolean;
    beard?: boolean;
    /** A radio earpiece, its coiled lead running down behind the right ear into the collar. */
    earpiece?: boolean;
    /** A heavier build: a pixel broader each side, across the shoulders, arms, legs and shoes. */
    broad?: boolean;
    /** Worn over the face; a balaclava hides the hair too, the others leave it showing. */
    mask?: PersonMask;
    /** Lying face down instead of standing; both facings are then the same drawing. */
    pose?: PersonPose;
}

const H = { hair: 1, face: 0.95, torso: 0.8, arm: 0.85, legs: 0.6, shoes: 0.35 };

/**
 * How the cast's silhouettes are edged: the same inner edge as the furniture, so people and props read as one world.
 * A dark ring outside the figure made them look like stickers on the scene (compared in
 * `docs/pixel-art/examples/character-edges.png`).
 */
export const PERSON_EDGE: Edge = inner(0.3);

/**
 * Draws one person facing the camera (`front`) or away from it (`back`). Clothes are shaded for light from above and
 * slightly left: shoulders take the light, the right side and the arms sit a step darker. `PERSON_EDGE` edges it. A
 * mask goes over the face; someone with a `pose` is drawn lying down instead, the same for both facings.
 */
export function person(spec: PersonSpec, facing: 'front' | 'back', edge: Edge = PERSON_EDGE): PixelBitmap {
    if (spec.pose) return lying(spec, spec.pose, edge);
    const b = new PixelBitmap(PERSON_WIDTH, PERSON_HEIGHT);
    const s = spec.short ?? 0;
    const top = 1 + s;
    const front = facing === 'front';
    const { skin, top: cloth } = spec;
    const longTop = spec.topKind === 'coat' || spec.topKind === 'dress';
    const hemY = spec.topKind === 'dress' ? 18 : spec.topKind === 'coat' ? 18 : 14;
    // The torso's outer columns; the arms hang one outside them.
    const wide = spec.broad ? 1 : 0, left = 4 - wide, right = 11 + wide;
    const sleeves = sleeveRamp(spec), hands = handRamp(spec);

    // Legs and shoes first, so a coat or dress can hang over them.
    for (let y = 15; y <= 21; y++) {
        const leg = spec.topKind === 'dress' ? skin : spec.legs;
        b.rect(5 - wide, y, 3 + wide, 1, leg[2]!, H.legs);
        b.rect(8, y, 3 + wide, 1, leg[1]!, H.legs);
        if (y > 15) b.set(7, y, deepen(leg[1]!, 0.25), H.legs - 0.1);
    }
    if (spec.topKind === 'dress') b.rect(5, 19, 6, 1, deepen(skin[1]!, 0.2), H.legs);
    b.rect(4 - wide, 22, 4 + wide, 1, spec.shoes[2]!, H.shoes);
    b.rect(8, 22, 4 + wide, 1, spec.shoes[1]!, H.shoes);
    b.rect(4 - wide, 23, 8 + 2 * wide, 1, spec.shoes[0]!, H.shoes - 0.1);
    b.set(7, 23, PAL.ink, H.shoes - 0.2);
    b.set(8, 23, PAL.ink, H.shoes - 0.2);

    // Torso, shoulders and arms.
    const torsoTop = top + 6;
    for (let y = torsoTop; y <= hemY; y++) {
        const flare = longTop && y > 14 ? (spec.topKind === 'dress' ? Math.min(2, y - 14) : 0) : 0;
        for (let x = left - flare; x <= right + flare; x++) {
            let c = x >= right - 1 ? cloth[1]! : cloth[2]!;
            if (y === torsoTop) c = cloth[3]!;
            if (y > 14 && spec.topKind === 'coat' && (x === 7 || x === 8)) c = deepen(cloth[1]!, 0.25);
            b.set(x, y, c, H.torso);
        }
    }
    const sleeve = spec.topKind === 'tee' || spec.topKind === 'polo' ? 3 : 7;
    for (let y = torsoTop + 1; y <= 14; y++) {
        const bare = y - torsoTop > sleeve;
        b.set(left - 1, y, bare ? skin[2]! : sleeves[1]!, H.arm);
        b.set(right + 1, y, bare ? skin[1]! : sleeves[0]!, H.arm);
    }
    b.set(left - 1, torsoTop, sleeves[2]!, H.arm);
    b.set(right + 1, torsoTop, sleeves[1]!, H.arm);
    b.set(left - 1, 15, hands[2]!, H.arm);
    b.set(right + 1, 15, hands[1]!, H.arm);

    if (front) frontDetails(b, spec, torsoTop, hemY, left, right);
    else backDetails(b, spec, torsoTop, hemY, left, right);

    // Neck and head.
    b.rect(7, top + 5, 2, 1, skin[1]!, H.face);
    drawFace(b, spec, top, front);
    if (spec.mask === 'balaclava') {
        // A balaclava goes on over the hair, and a cap or helmet over the balaclava.
        drawMask(b, spec, top, front);
        if (HEADGEAR.includes(spec.hairStyle)) drawHair(b, { ...spec, hair: PAL.cloth.black, skin: PAL.cloth.black }, top, front);
    } else {
        drawHair(b, spec, top, front);
        if (spec.mask) drawMask(b, spec, top, front);
    }
    if (spec.earpiece) {
        // The coil shows pale against the neck and the dark collar behind the right ear.
        b.set(11, top + 3, PAL.steel[4], H.face);
        b.set(11, top + 4, PAL.steel[3], H.face);
        b.set(10, top + 5, PAL.steel[4], H.face);
        if (!front) b.set(10, torsoTop, PAL.steel[3], H.torso + 0.05);
    }
    if (spec.carry && spec.carry !== 'none') drawCarry(b, spec, spec.carry, front);
    edge(b);
    return b;
}

/** Heights of a body lying on the floor: lower than a standing one's, the head and the hands on it the highest. */
const LYING = { head: 0.58, hands: 0.64, arm: 0.52, torso: 0.5, legs: 0.42, shoes: 0.34 };

/**
 * Someone lying face down with the head to the north, in the same 16x24 canvas so they fill their tile: from above and a
 * little behind, the back of the head, the shoulders and back, the backs of the legs and the heels: 16px from the crown
 * to the soles, about what 1.75m comes to with tops drawn at two thirds of their depth. A commanded hostage (`prone`) has the hands
 * clasped on the back of the head with the elbows out; a `tied` one has the wrists zip-tied at the small of the back.
 * Shaded like the standing cast, light from above and a little left; the heights rise along the spine so the lamps
 * round the back. Carried things are left out; a mask shows as its strap, or the balaclava's knit.
 */
function lying(spec: PersonSpec, pose: PersonPose, edge: Edge): PixelBitmap {
    const b = new PixelBitmap(PERSON_WIDTH, PERSON_HEIGHT);
    const { skin, top: cloth, legs } = spec;
    const wide = spec.broad ? 1 : 0, left = 4 - wide, right = 11 + wide;
    // A waistcoat's back is its own cloth; the arms are the shirt's.
    const sleeves = spec.topKind === 'vest' ? spec.under ?? PAL.cloth.white : sleeveRamp(spec), hands = handRamp(spec);
    const bareForearms = spec.topKind === 'tee' || spec.topKind === 'polo';
    const ridge = (x: number, base: number) => base + 0.08 * (1 - Math.min(1, Math.abs(x - 7.5) / 4.5));
    const px = (x: number, y: number, c: number, base: number) => b.set(x, y, c, ridge(x, base));
    // From the heels up: the soles and heels, three rows of legs, two of the seat, the back up to the shoulders, the head.
    // Shorter people are shorter lying down too, by a shorter back. The bottom row is left for the shadow.
    const heels = 21, waist = heels - 6, crown = 7 + (spec.short ?? 0), shoulders = crown + 4;
    const long = spec.topKind === 'dress' || spec.topKind === 'coat', hem = long ? heels - 2 : waist;

    // The seat and the legs, a little apart at the ankles; the toes are dug into the floor, so the heels and the soles'
    // worn rubber face up and back at the camera.
    for (let y = waist + 1; y < heels; y++) {
        const leg = spec.topKind === 'dress' && y > hem ? skin : legs, seat = y <= waist + 2, apart = y === heels - 1 ? 1 : 0;
        for (let x = left + 1; x <= right - 1; x++) {
            if (!seat && (x === 7 || x === 8) && apart) continue;
            const c = x >= right - 2 ? leg[1]! : y === waist + 1 && x <= left + 2 ? leg[3] ?? leg[2]! : leg[2]!;
            px(x, y, c, LYING.legs);
        }
        if (!seat && !apart) px(7, y, deepen(leg[1]!, 0.25), LYING.legs - 0.06);
    }
    for (const [x0, side] of [[left + 1, 0], [right - 2, 1]] as const) {
        for (let x = x0; x < x0 + 2; x++) {
            px(x, heels, spec.shoes[side ? 1 : 2]!, LYING.shoes);
            px(x, heels + 1, mix(spec.shoes[side ? 1 : 2]!, PAL.steel[2], 0.45), LYING.shoes - 0.04);
        }
    }

    // The back: broad across the shoulders, narrowing to the waist; a coat or dress carries on over the seat.
    for (let y = shoulders; y <= hem; y++) {
        const inset = y > shoulders + 3 ? 1 : 0;
        for (let x = left + inset; x <= right - inset; x++) {
            const c = y === shoulders ? cloth[3]! : x >= right - 1 - inset ? cloth[1]! : cloth[2]!;
            px(x, y, c, LYING.torso);
        }
    }
    const across = (y: number, c: number, from = left, to = right) => { for (let x = from; x <= to; x++) px(x, y, c, LYING.torso + 0.02); };
    switch (spec.topKind) {
        case 'suit':
        case 'coat':
            for (let y = shoulders + 3; y <= hem; y++) px(8, y, cloth[0]!, LYING.torso);
            break;
        case 'hoodie':
            across(shoulders, cloth[3]!, 5, 10);
            across(shoulders + 1, cloth[3]!, 6, 9);
            break;
        case 'uniform':
        case 'work':
            across(shoulders + 2, spec.topKind === 'work' ? cloth[1]! : cloth[3]!, left + 1, right - 1);
            break;
        case 'police':
            across(shoulders, (spec.under ?? PAL.cloth.skyShirt)[2]!, 7, 8);
            across(shoulders + 3, PAL.cloth.white[2]!, left, right - 2);
            across(shoulders + 3, PAL.cloth.white[1]!, right - 1, right);
            break;
        case 'tactical':
            for (let y = shoulders; y <= waist; y++) {
                px(left, y, sleeves[2]!, LYING.torso - 0.04);
                px(right, y, sleeves[1]!, LYING.torso - 0.04);
            }
            across(shoulders + 1, cloth[3]!, 7, 8);
            break;
        default:
            break;
    }
    if (['shirt', 'uniform', 'tee', 'polo', 'bomber', 'police', 'tactical'].includes(spec.topKind)) across(waist, PAL.cloth.black[1]!, left + 1, right - 1);
    if (spec.topKind === 'work') across(waist, cloth[1]!, left + 1, right - 1);

    // The back of the head, and the nape.
    drawLyingHead(b, spec, crown, ridge);

    // The arms, then the hands over the head or the back.
    const sleevePx = (x: number, y: number, side: 0 | 1, bare = false) => px(x, y, bare ? skin[2 - side]! : sleeves[2 - side]!, LYING.arm);
    if (pose === 'prone') {
        // Upper arms out from the shoulders to the elbows, beside the nape; forearms in to the hands on the head.
        for (const side of [0, 1] as const) {
            const out = side ? 1 : -1, sx = side ? right : left;
            sleevePx(sx + out, shoulders, side);
            sleevePx(sx + out, shoulders - 1, side);
            sleevePx(sx + 2 * out, shoulders - 1, side);
            const hand = side ? 10 : 5;
            for (let x = sx + out; x !== hand; x -= out) sleevePx(x, shoulders - 2, side, bareForearms);
            px(hand, crown + 2, hands[2 - side]!, LYING.hands);
        }
        // Fingers laced over the back of the head, low, so the hair shows above them; the nape in their shade.
        for (let x = 6; x <= 9; x++) px(x, crown + 2, x <= 7 ? hands[2]! : hands[1]!, LYING.hands);
        for (let x = 7; x <= 8; x++) px(x, crown + 3, deepen(b.color(x, crown + 3), 0.35), LYING.head - 0.06);
    } else {
        // Upper arms along the sides, forearms folded across the small of the back to the wrists, tied together.
        for (const side of [0, 1] as const) {
            const out = side ? 1 : -1, sx = side ? right : left;
            for (let y = shoulders; y <= waist; y++) sleevePx(sx + out, y, side);
            for (let x = side ? 9 : sx; x <= (side ? sx : 6); x++) sleevePx(x, waist, side, bareForearms);
        }
        px(7, waist, PAL.cloth.white[3]!, LYING.hands + 0.02);
        px(8, waist, PAL.cloth.white[2]!, LYING.hands + 0.02);
        px(7, waist + 1, hands[2]!, LYING.hands);
        px(8, waist + 1, hands[1]!, LYING.hands);
    }
    edge(b);
    // The body is a hand's breadth off the floor: its shadow shows a pixel below its outline, where the floor isn't covered.
    const shadow: [number, number][] = [];
    for (let y = 1; y < b.height; y++) for (let x = 0; x < b.width; x++) if (!b.opaque(x, y) && b.opaque(x, y - 1)) shadow.push([x, y]);
    for (const [x, y] of shadow) b.set(x, y, PAL.void, 0, 110);
    return b;
}

/** The back of a lying person's head from above, by hair style or headgear, with a mask's strap or knit over it. */
function drawLyingHead(b: PixelBitmap, spec: PersonSpec, crown: number, ridge: (x: number, base: number) => number): void {
    const { skin, hair } = spec;
    const px = (x: number, y: number, c: number, raise = 0) => b.set(x, y, c, ridge(x, LYING.head + raise));
    const head = (body: number, light: number, shade: number) => {
        for (let x = 6; x <= 9; x++) px(x, crown, x <= 7 ? light : body);
        for (let y = crown + 1; y <= crown + 2; y++) for (let x = 5; x <= 10; x++) px(x, y, x === 10 ? shade : x === 6 && y === crown + 1 ? light : body);
    };
    const nape = crown + 3;
    if (spec.mask === 'balaclava') {
        head(PAL.cloth.black[2]!, PAL.cloth.black[3]!, PAL.cloth.black[1]!);
        for (let x = 6; x <= 9; x++) px(x, nape, PAL.cloth.black[1]!, -0.04);
        // A cap or helmet stays on over it.
        if (!HEADGEAR.includes(spec.hairStyle)) return;
    }
    switch (spec.hairStyle) {
        case 'bald':
            head(skin[2]!, skin[3]!, skin[1]!);
            for (const x of [5, 10]) px(x, crown + 2, x === 10 ? hair[0]! : hair[1]!);
            break;
        case 'cap':
            head(spec.top[1]!, spec.top[2]!, spec.top[0]!);
            break;
        case 'policeCap':
            head(PAL.cloth.navy[2]!, PAL.cloth.navy[3]!, PAL.cloth.navy[1]!);
            for (let x = 5; x <= 10; x++) px(x, crown + 2, x % 2 ? PAL.cloth.white[1]! : PAL.cloth.navy[0]!);
            break;
        case 'helmet':
            head(PAL.steel[1], PAL.steel[2], PAL.steel[0]);
            for (let x = 4; x <= 11; x++) px(x, crown + 2, x === 4 ? PAL.steel[1] : PAL.steel[0], -0.02);
            break;
        default: {
            const body = spec.hairStyle === 'buzz' ? mix(hair[1]!, skin[2]!, 0.35) : hair[1]!;
            head(body, hair[2]!, hair[0]!);
            if (spec.hairStyle === 'bun') { px(7, crown + 1, hair[2]!, 0.06); px(8, crown + 1, hair[1]!, 0.06); px(7, crown + 2, hair[0]!, 0.04); }
            break;
        }
    }
    if (spec.mask === 'balaclava') return;
    // The nape: skin between the hair and the collar, or long hair spread over the shoulders, or a ponytail lying on the back.
    for (let x = 6; x <= 9; x++) px(x, nape, x === 6 || x === 9 ? hair[0]! : skin[1]!, -0.06);
    if (spec.hairStyle === 'long') for (let y = nape; y <= nape + 2; y++) for (let x = 5; x <= 10; x++) px(x, y, x >= 9 || y === nape + 2 ? hair[0]! : hair[1]!, -0.04);
    if (spec.hairStyle === 'ponytail') for (let y = nape; y <= nape + 2; y++) { px(7, y, hair[1]!, -0.02); px(8, y, hair[0]!, -0.02); }
    // A mask's strap round the back of the head; the respirator's filters lie either side of it.
    if (spec.mask === 'hockey') for (let x = 5; x <= 10; x++) px(x, crown + 1, PAL.cloth.white[0]!, 0.02);
    if (spec.mask === 'skull') { for (let x = 5; x <= 10; x++) px(x, crown + 2, PAL.cloth.black[2]!, 0.02); px(7, nape, PAL.cloth.black[2]!, 0.02); }
    if (spec.mask === 'respirator') {
        for (let x = 5; x <= 10; x++) px(x, crown + 1, PAL.cloth.black[2]!, 0.02);
        px(4, crown + 2, PAL.cloth.beige[2]!, -0.02);
        px(11, crown + 2, PAL.cloth.beige[1]!, -0.02);
    }
    if (spec.mask === 'hockey') { px(4, crown + 2, PAL.cloth.white[2]!, -0.02); px(11, crown + 2, PAL.cloth.white[1]!, -0.02); }
}

function frontDetails(b: PixelBitmap, spec: PersonSpec, torsoTop: number, hemY: number, left: number, right: number): void {
    const { top: cloth } = spec;
    const under = spec.under ?? PAL.cloth.white;
    switch (spec.topKind) {
        case 'suit':
        case 'cardigan':
        case 'bomber': {
            // Open front: the shirt shows in a V, lapels a step darker.
            for (let y = torsoTop; y <= torsoTop + 3; y++) {
                const w = Math.max(1, 3 - (y - torsoTop));
                for (let x = 8 - w; x < 8 + w; x++) b.set(x, y, under[3]!, H.torso + 0.02);
                b.set(8 - w - 1, y, cloth[1]!, H.torso);
                b.set(8 + w, y, cloth[1]!, H.torso);
            }
            if (spec.topKind !== 'suit') b.rect(7, torsoTop + 4, 2, 14 - torsoTop - 4, under[2]!, H.torso);
            if (spec.tie) {
                b.set(7, torsoTop, spec.tie[3]!, H.torso + 0.05);
                b.set(8, torsoTop, spec.tie[2]!, H.torso + 0.05);
                b.rect(7, torsoTop + 1, 2, 4, spec.tie[2]!, H.torso + 0.05);
                b.set(8, torsoTop + 2, spec.tie[1]!, H.torso + 0.05);
            }
            if (spec.topKind === 'bomber') b.rect(left, 14, right - left + 1, 1, cloth[0]!, H.torso);
            else b.set(9, torsoTop + 5, cloth[0]!, H.torso);
            break;
        }
        case 'vest': {
            b.rect(left, torsoTop, right - left + 1, 1, under[3]!, H.torso);
            for (let y = torsoTop + 1; y <= 14; y++) { b.set(left - 1, y, under[2]!, H.arm); b.set(right + 1, y, under[1]!, H.arm); }
            b.set(7, torsoTop, under[3]!, H.torso);
            b.set(8, torsoTop, under[3]!, H.torso);
            b.vline(8, torsoTop + 1, 13 - torsoTop, cloth[0]!, H.torso);
            if (spec.tie) b.rect(7, torsoTop + 1, 1, 3, spec.tie[2]!, H.torso + 0.05);
            break;
        }
        case 'shirt': {
            b.set(7, torsoTop, cloth[3]!, H.torso);
            b.set(6, torsoTop, mix(cloth[3]!, 0xffffff, 0.2), H.torso + 0.02);
            b.set(9, torsoTop, mix(cloth[3]!, 0xffffff, 0.2), H.torso + 0.02);
            b.vline(8, torsoTop + 1, 13 - torsoTop, cloth[1]!, H.torso);
            if (spec.tie) b.rect(7, torsoTop + 1, 1, 4, spec.tie[2]!, H.torso + 0.05);
            b.rect(left, 14, right - left + 1, 1, PAL.cloth.black[1]!, H.torso);
            break;
        }
        case 'uniform': {
            b.set(6, torsoTop, cloth[3]!, H.torso + 0.02);
            b.set(9, torsoTop, cloth[3]!, H.torso + 0.02);
            b.vline(8, torsoTop + 1, 13 - torsoTop, cloth[1]!, H.torso);
            // Badge on the chest, shoulder radio, duty belt with a brass buckle and a holster on the hip.
            b.rect(9, torsoTop + 2, 2, 2, PAL.brass[4], H.torso + 0.1);
            b.set(9, torsoTop + 2, PAL.brass[5], H.torso + 0.12);
            b.rect(5, torsoTop + 1, 1, 2, PAL.cloth.black[0]!, H.torso + 0.1);
            b.set(left - 1, torsoTop + 2, PAL.brass[3], H.arm + 0.05);
            b.rect(left, 14, right - left + 1, 1, PAL.cloth.black[1]!, H.torso + 0.05);
            b.rect(7, 14, 2, 1, PAL.brass[4], H.torso + 0.1);
            b.rect(right, 14, 2, 3, PAL.cloth.black[0]!, H.torso + 0.1);
            break;
        }
        case 'coat': {
            b.set(6, torsoTop, cloth[3]!, H.torso + 0.05);
            b.set(9, torsoTop, cloth[3]!, H.torso + 0.05);
            b.set(7, torsoTop, under[2]!, H.torso);
            b.set(8, torsoTop, under[2]!, H.torso);
            b.vline(8, torsoTop + 1, hemY - torsoTop, cloth[0]!, H.torso);
            b.rect(left, 13, right - left + 1, 1, cloth[1]!, H.torso);
            b.set(7, 13, PAL.brass[2], H.torso + 0.05);
            break;
        }
        case 'hoodie': {
            b.rect(5, torsoTop, 6, 1, cloth[3]!, H.torso + 0.1);
            b.set(7, torsoTop + 1, PAL.cloth.white[2]!, H.torso);
            b.set(8, torsoTop + 2, PAL.cloth.white[2]!, H.torso);
            b.rect(5, 12, 6, 2, cloth[1]!, H.torso);
            b.rect(left, 14, right - left + 1, 1, cloth[0]!, H.torso);
            break;
        }
        case 'polo': {
            // A turned-down collar either side of a short buttoned placket.
            b.set(6, torsoTop, cloth[3]!, H.torso + 0.05);
            b.set(9, torsoTop, cloth[3]!, H.torso + 0.05);
            b.set(7, torsoTop, cloth[0]!, H.torso);
            b.set(8, torsoTop, cloth[0]!, H.torso);
            b.vline(8, torsoTop + 1, 2, cloth[1]!, H.torso);
            b.set(8, torsoTop + 1, PAL.cloth.white[2]!, H.torso + 0.02);
            b.rect(left, 14, right - left + 1, 1, PAL.cloth.black[2]!, H.torso);
            break;
        }
        case 'tee': {
            b.rect(7, torsoTop, 2, 1, cloth[1]!, H.torso);
            b.rect(left, 14, right - left + 1, 1, PAL.cloth.black[2]!, H.torso);
            break;
        }
        case 'dress': {
            b.rect(6, torsoTop, 4, 1, spec.skin[2]!, H.face);
            b.rect(left, 13, right - left + 1, 1, cloth[0]!, H.torso);
            break;
        }
        case 'work': {
            // Hanging open over a dark tee: the jacket's edges a step darker, a cord collar, flapped chest pockets.
            const tee = spec.under ?? PAL.cloth.charcoal;
            b.rect(7, torsoTop, 2, 14 - torsoTop, tee[2]!, H.torso - 0.02);
            b.rect(7, torsoTop, 2, 1, tee[1]!, H.torso - 0.02);
            b.vline(6, torsoTop + 1, 13 - torsoTop, cloth[1]!, H.torso);
            b.vline(9, torsoTop + 1, 13 - torsoTop, cloth[0]!, H.torso);
            b.set(6, torsoTop, cloth[3]!, H.torso + 0.06);
            b.set(9, torsoTop, cloth[2]!, H.torso + 0.06);
            b.set(left + 1, torsoTop + 2, cloth[3]!, H.torso + 0.04);
            b.set(right - 1, torsoTop + 2, cloth[2]!, H.torso + 0.04);
            b.set(left + 1, torsoTop + 3, cloth[1]!, H.torso + 0.02);
            b.set(right - 1, torsoTop + 3, cloth[0]!, H.torso + 0.02);
            b.rect(left, 14, right - left + 1, 1, cloth[1]!, H.torso);
            b.rect(7, 14, 2, 1, tee[1]!, H.torso);
            break;
        }
        case 'police': {
            // The patrol officer's (officer.ts): the shirt's collar in the stab vest, a badge catching the light, a radio on
            // the shoulder, a reflective band across the chest, the duty belt and the holster on the left hip.
            const shirt = spec.under ?? PAL.cloth.skyShirt;
            b.rect(7, torsoTop, 2, 1, shirt[3]!, H.torso + 0.04);
            b.set(6, torsoTop, shirt[2]!, H.torso + 0.03);
            b.set(9, torsoTop + 1, PAL.steel[5], H.torso + 0.12);
            b.set(9, torsoTop + 2, PAL.steel[3], H.torso + 0.1);
            b.rect(5, torsoTop + 1, 1, 2, PAL.cloth.black[0]!, H.torso + 0.1);
            b.rect(left, torsoTop + 4, right - left - 1, 1, PAL.cloth.white[2]!, H.torso + 0.02);
            b.rect(right - 1, torsoTop + 4, 2, 1, PAL.cloth.white[1]!, H.torso + 0.02);
            b.rect(left, 14, right - left + 1, 1, PAL.cloth.black[1]!, H.torso + 0.05);
            b.rect(7, 14, 2, 1, PAL.brass[4], H.torso + 0.1);
            b.rect(right, 14, 2, 3, PAL.cloth.black[0]!, H.torso + 0.1);
            b.set(right, 13, PAL.steel[2], H.torso + 0.1);
            break;
        }
        case 'tactical': {
            // A plate carrier: the fatigues show at the sides and the collar, a row of magazine pouches on the front plate,
            // a belt and a holster strapped to the left thigh.
            const fatigues = spec.under ?? PAL.cloth.charcoal;
            b.vline(left, torsoTop, 15 - torsoTop, fatigues[2]!, H.torso - 0.04);
            b.vline(right, torsoTop, 15 - torsoTop, fatigues[1]!, H.torso - 0.04);
            b.rect(7, torsoTop, 2, 1, fatigues[2]!, H.torso - 0.02);
            for (const x of [5, 7, 9]) {
                b.rect(x, 11, 2, 2, cloth[2]!, H.torso + 0.12);
                b.hline(x, 11, 2, cloth[3]!, H.torso + 0.14);
                b.set(x + 1, 12, cloth[1]!, H.torso + 0.1);
            }
            b.rect(left, 14, right - left + 1, 1, PAL.cloth.black[1]!, H.torso + 0.05);
            b.rect(9, 15, 2, 3, PAL.cloth.black[1]!, H.legs + 0.1);
            b.set(9, 15, PAL.cloth.black[3]!, H.legs + 0.12);
            break;
        }
    }
    if (spec.lanyard) {
        b.set(6, torsoTop + 1, PAL.cloth.burgundy[3]!, H.torso + 0.05);
        b.set(6, torsoTop + 2, PAL.cloth.burgundy[3]!, H.torso + 0.05);
        b.rect(5, torsoTop + 3, 2, 2, PAL.paper[3], H.torso + 0.1);
    }
}

function backDetails(b: PixelBitmap, spec: PersonSpec, torsoTop: number, hemY: number, left: number, right: number): void {
    const { top: cloth } = spec;
    if (spec.topKind === 'suit' || spec.topKind === 'coat') b.vline(8, torsoTop + 3, hemY - torsoTop - 2, cloth[0]!, H.torso);
    if (spec.topKind === 'hoodie') b.rect(5, torsoTop, 6, 2, cloth[3]!, H.torso + 0.15);
    if (spec.topKind === 'uniform') b.rect(left, torsoTop + 2, right - left + 1, 1, cloth[3]!, H.torso + 0.02);
    if (spec.topKind === 'polo') b.rect(5, torsoTop, 6, 1, cloth[3]!, H.torso + 0.05);
    if (spec.topKind === 'shirt' || spec.topKind === 'uniform' || spec.topKind === 'tee' || spec.topKind === 'polo' || spec.topKind === 'bomber') {
        b.rect(left, 14, right - left + 1, 1, PAL.cloth.black[1]!, H.torso);
    }
    if (spec.topKind === 'work') {
        // The yoke's seam across the shoulders and the waistband.
        b.rect(left, torsoTop + 2, right - left + 1, 1, cloth[1]!, H.torso);
        b.rect(left, 14, right - left + 1, 1, cloth[1]!, H.torso);
    }
    if (spec.topKind === 'police') {
        b.rect(7, torsoTop, 2, 1, (spec.under ?? PAL.cloth.skyShirt)[2]!, H.torso + 0.04);
        b.rect(left, torsoTop + 4, right - left - 1, 1, PAL.cloth.white[2]!, H.torso + 0.02);
        b.rect(right - 1, torsoTop + 4, 2, 1, PAL.cloth.white[1]!, H.torso + 0.02);
        b.rect(left, 14, right - left + 1, 1, PAL.cloth.black[1]!, H.torso + 0.05);
        b.rect(left - 1, 14, 2, 3, PAL.cloth.black[0]!, H.torso + 0.1);
    }
    if (spec.topKind === 'tactical') {
        // The back plate, with a drag handle at the top.
        const fatigues = spec.under ?? PAL.cloth.charcoal;
        b.vline(left, torsoTop, 15 - torsoTop, fatigues[2]!, H.torso - 0.04);
        b.vline(right, torsoTop, 15 - torsoTop, fatigues[1]!, H.torso - 0.04);
        b.rect(7, torsoTop + 1, 2, 1, cloth[3]!, H.torso + 0.12);
        b.rect(left + 1, 13, right - left - 1, 1, cloth[1]!, H.torso);
        b.rect(left, 14, right - left + 1, 1, PAL.cloth.black[1]!, H.torso + 0.05);
        b.rect(5, 15, 2, 3, PAL.cloth.black[1]!, H.legs + 0.1);
    }
}

/** The ramp the arms are drawn in: the shirt or fatigues under a vest, otherwise the top's own. */
function sleeveRamp(spec: PersonSpec): Ramp {
    return spec.topKind === 'police' || spec.topKind === 'tactical' ? spec.under ?? spec.top : spec.top;
}

/** Bare hands, or a SWAT team's black gloves. */
function handRamp(spec: PersonSpec): Ramp {
    return spec.topKind === 'tactical' ? PAL.cloth.black : spec.skin;
}

function drawFace(b: PixelBitmap, spec: PersonSpec, top: number, front: boolean): void {
    const { skin, hair } = spec;
    // Face block, lit from above: forehead light, jaw a step down.
    for (let y = top + 1; y <= top + 4; y++) for (let x = 5; x <= 10; x++) {
        b.set(x, y, y === top + 4 || x === 10 ? skin[1]! : skin[2]!, H.face);
    }
    if (front) {
        b.set(6, top + 3, PAL.ink, H.face - 0.1);
        b.set(9, top + 3, PAL.ink, H.face - 0.1);
        b.set(7, top + 4, skin[1]!, H.face);
        if (spec.glasses) { b.rect(5, top + 3, 2, 1, PAL.steel[1], H.face + 0.05); b.rect(9, top + 3, 2, 1, PAL.steel[1], H.face + 0.05); b.set(8, top + 3, PAL.steel[2], H.face); }
        if (spec.beard && !spec.mask) { b.rect(5, top + 4, 6, 1, hair[1]!, H.face); b.rect(6, top + 5, 4, 1, hair[0]!, H.face); }
        else b.rect(6, top + 5, 4, 1, skin[1]!, H.face);
    } else {
        b.rect(6, top + 5, 4, 1, skin[1]!, H.face);
    }
}

function drawHair(b: PixelBitmap, spec: PersonSpec, top: number, front: boolean): void {
    const { skin, hair } = spec;
    const hairPx = (x: number, y: number, c = hair[1]!) => b.set(x, y, c, H.hair);
    switch (spec.hairStyle) {
        case 'bald':
            b.set(7, top, skin[3]!, H.hair);
            b.set(8, top, skin[2]!, H.hair);
            b.rect(6, top, 1, 1, skin[2]!, H.hair);
            b.set(9, top, skin[2]!, H.hair);
            if (front) { hairPx(5, top + 2); hairPx(10, top + 2, hair[0]!); }
            else b.rect(5, top + 2, 6, 2, hair[1]!, H.hair);
            break;
        case 'cap': {
            const cap = spec.top;
            b.rect(5, top - 1, 6, 1, cap[2]!, H.hair);
            b.rect(5, top, 6, 1, cap[1]!, H.hair);
            b.set(6, top - 1, cap[3]!, H.hair);
            if (front) b.rect(4, top + 1, 8, 1, PAL.cloth.black[0]!, H.hair);
            else { b.rect(5, top + 1, 6, 3, hair[1]!, H.hair); b.rect(5, top + 1, 6, 1, cap[1]!, H.hair); }
            b.set(7, top, PAL.brass[4], H.hair + 0.05);
            break;
        }
        case 'policeCap': {
            // The officer's colours (officer.ts): a navy crown flaring out over the chequered band, the strongest read at
            // this size, and a black peak.
            const navy = PAL.cloth.navy;
            b.rect(4, top - 1, 8, 1, navy[2]!, H.hair);
            b.rect(5, top - 1, 2, 1, navy[3]!, H.hair + 0.02);
            b.set(11, top - 1, navy[1]!, H.hair);
            for (let x = 5; x <= 10; x++) b.set(x, top, x % 2 ? PAL.cloth.white[1]! : navy[0]!, H.hair - 0.02);
            if (front) { b.rect(5, top + 1, 6, 1, PAL.cloth.black[0]!, H.hair - 0.03); b.set(5, top + 1, PAL.cloth.black[2]!, H.hair - 0.03); }
            else { b.rect(5, top + 1, 6, 3, hair[1]!, H.hair); b.rect(6, top + 4, 4, 1, skin[1]!, H.face); }
            break;
        }
        case 'helmet': {
            // A dark ballistic helmet: a dome a pixel wider than the head each side, coming down over the ears, a chin
            // strap. From behind it hides the head down to the nape.
            const shell = PAL.steel;
            b.rect(5, top - 1, 6, 1, shell[1], H.hair + 0.05);
            b.rect(6, top - 1, 2, 1, shell[2], H.hair + 0.08);
            b.rect(4, top, 8, 1, shell[1], H.hair + 0.02);
            b.set(5, top, shell[2], H.hair + 0.05);
            b.set(11, top, shell[0], H.hair);
            b.rect(4, top + 1, 8, 1, shell[0], H.hair - 0.02);
            b.set(4, top + 1, shell[1], H.hair - 0.02);
            b.set(4, top + 2, shell[0], H.hair - 0.04);
            b.set(11, top + 2, shell[0], H.hair - 0.04);
            if (front) {
                b.set(5, top + 4, PAL.cloth.black[1]!, H.face);
                b.set(10, top + 4, PAL.cloth.black[1]!, H.face);
            } else {
                b.rect(5, top + 2, 6, 1, shell[0], H.hair - 0.04);
                b.rect(5, top + 3, 6, 1, hair[0]!, H.hair - 0.1);
                b.rect(6, top + 4, 4, 1, skin[1]!, H.face);
                b.set(8, top, PAL.steel[3], H.hair + 0.1);
            }
            break;
        }
        default: {
            b.rect(6, top - 1, 4, 1, hair[2]!, H.hair);
            b.rect(5, top, 6, 1, hair[1]!, H.hair);
            b.set(6, top, hair[2]!, H.hair);
            b.set(7, top, hair[2]!, H.hair);
            if (front) {
                b.rect(5, top + 1, 6, 1, hair[1]!, H.hair);
                b.set(6, top + 1, hair[2]!, H.hair);
                hairPx(5, top + 2);
                hairPx(10, top + 2, hair[0]!);
                if (spec.hairStyle === 'buzz') { b.rect(6, top + 1, 4, 1, mix(hair[1]!, skin[2]!, 0.4), H.hair); }
            } else {
                b.rect(5, top + 1, 6, 4, hair[1]!, H.hair);
                b.rect(6, top + 1, 2, 1, hair[2]!, H.hair);
                b.rect(5, top + 4, 6, 1, hair[0]!, H.hair);
                if (spec.hairStyle === 'buzz' || spec.hairStyle === 'short') b.rect(6, top + 4, 4, 1, skin[1]!, H.face);
            }
            if (spec.hairStyle === 'long') {
                b.rect(4, top + 1, 1, 6, hair[1]!, H.hair);
                b.rect(11, top + 1, 1, 6, hair[0]!, H.hair);
                if (!front) b.rect(5, top + 5, 6, 3, hair[1]!, H.hair);
            }
            if (spec.hairStyle === 'bun') { b.rect(7, top - 2, 2, 1, hair[1]!, H.hair); }
            if (spec.hairStyle === 'ponytail') {
                if (front) b.set(11, top + 2, hair[0]!, H.hair);
                else { b.rect(7, top + 5, 2, 3, hair[1]!, H.hair); b.set(7, top + 5, hair[2]!, H.hair); }
            }
            break;
        }
    }
}

/** A mask's colours and heights by key: knit, skin through the eye slot, the goalie mask, the bandana, rubber and filters. */
const MASK_COLORS: Readonly<Record<string, [number, number]>> = {
    K: [PAL.cloth.black[3]!, H.hair + 0.04], k: [PAL.cloth.black[2]!, H.hair], j: [PAL.cloth.black[1]!, H.hair - 0.02],
    s: [PAL.ink, H.face - 0.04], e: [PAL.ink, H.face - 0.1],
    W: [PAL.cloth.white[3]!, H.face + 0.08], w: [PAL.cloth.white[2]!, H.face + 0.06], g: [PAL.cloth.white[1]!, H.face + 0.04],
    o: [deepen(PAL.cloth.white[0]!, 0.4), H.face - 0.04], x: [mix(PAL.cloth.white[2]!, PAL.plywood[1], 0.45), H.face + 0.06],
    t: [PAL.cloth.white[0]!, H.hair + 0.02],
    B: [PAL.cloth.black[2]!, H.face + 0.04], b: [PAL.cloth.black[1]!, H.face + 0.02], P: [PAL.paper[1], H.face + 0.05], p: [PAL.paper[0], H.face + 0.04],
    r: [PAL.cloth.black[2]!, H.face + 0.06], v: [PAL.steel[2], H.face + 0.1],
    C: [PAL.cloth.beige[3]!, H.face + 0.14], c: [PAL.cloth.beige[2]!, H.face + 0.12], d: [PAL.cloth.beige[1]!, H.face + 0.1]
};

/**
 * The crew's masks, front and back: one string per row from `top - 1` (the crown) down, the first column at x = 4, `.`
 * leaving what is under it. The head is columns 5-10 from the crown to the chin at `top + 5`; a filter canister sits
 * past it each side, and the bandana's point hangs over the chest. `s` in the balaclava's eye slot takes the wearer's skin.
 */
const MASKS: Record<PersonMask, { front: readonly string[]; back: readonly string[] }> = {
    // Black knit over the whole head and down into the collar, one slot for the eyes.
    balaclava: {
        front: ['..KKkk....', '.KKkkkj...', '.kkkkkj...', '.kssssj...', '.kessej...', '.kkkkkj...', '..kkjj....'],
        back: ['..KKkk....', '.KKkkkj...', '.kkkkkj...', '.kkkkkj...', '.kkkkkj...', '.kkkkjj...', '..jjjj....']
    },
    // An off-white goalie's mask over the face, eye and breathing holes, a little grime; elastic straps behind, its rim
    // showing either side of the head.
    hockey: {
        front: ['..........', '..........', '..WWww....', '.WWwwwx...', '.Wewweg...', '.wowwog...', '..xwgg....'],
        back: ['..........', '..........', '..........', '.tttttt...', 'W......g..', 'gttttttg..', '..........']
    },
    // A black bandana over the nose and mouth, printed with a skull's pale jaw, its point over the chest; knotted behind.
    skull: {
        front: ['..........', '..........', '..........', '..........', '..........', '.BPpPpb...', '.BpBBpb...', '..BppB....', '...Bb.....'],
        back: ['..........', '..........', '..........', '..........', '.BBBBBb...', '...Bb.....', '...b......', '....b.....']
    },
    // A dark rubber half-mask over the nose and mouth, a filter canister either side and the valve in the middle.
    respirator: {
        front: ['..........', '..........', '..........', '..........', '...rr.....', 'CCrrrrCc..', 'ccrvvrcd..'],
        back: ['..........', '..........', '..........', '.rrrrrr...', '..........', 'Crrrrrrc..', 'c......d..']
    }
};

function drawMask(b: PixelBitmap, spec: PersonSpec, top: number, front: boolean): void {
    const rows = MASKS[spec.mask!][front ? 'front' : 'back'];
    rows.forEach((row, ry) => [...row].forEach((key, rx) => {
        if (key === '.') return;
        const entry = MASK_COLORS[key];
        if (!entry) throw new Error(`Mask has no colour for '${key}'`);
        const color = key === 's' ? spec.skin[2]! : entry[0];
        b.set(4 + rx, top - 1 + ry, color, entry[1]);
    }));
}

function drawCarry(b: PixelBitmap, spec: PersonSpec, carry: Carry, front: boolean): void {
    switch (carry) {
        case 'briefcase':
            b.rect(12, 16, 4, 3, PAL.walnut[1], 0.7);
            b.hline(12, 16, 4, PAL.walnut[3], 0.75);
            b.set(13, 15, PAL.brass[3], 0.7);
            break;
        case 'handbag':
            b.rect(1, 13, 3, 3, PAL.cloth.burgundy[2]!, 0.7);
            b.hline(1, 13, 3, PAL.cloth.burgundy[3]!, 0.75);
            b.set(2, 12, PAL.brass[3], 0.7);
            break;
        case 'duffel': {
            // Strap across the chest, bag riding on the hip opposite the strap's shoulder.
            const strap = PAL.cloth.black[2]!;
            if (front) for (let i = 0; i < 6; i++) b.set(5 + i, 8 + i, strap, 0.9);
            const bx = front ? 10 : 1;
            b.rect(bx, 13, 5, 4, PAL.cloth.olive[1]!, 0.75);
            b.hline(bx, 13, 5, PAL.cloth.olive[2]!, 0.8);
            b.hline(bx + 1, 15, 3, PAL.cloth.olive[0]!, 0.7);
            break;
        }
        case 'laptopBag': {
            // A slim black messenger bag on a strap across the body: a flap with a buckle, riding on the hip.
            const strap = PAL.cloth.black[3]!;
            if (front) for (let i = 0; i < 6; i++) b.set(10 - i, 8 + i, strap, 0.9);
            const bx = front ? 1 : 11;
            b.rect(bx, 13, 4, 4, PAL.cloth.black[1]!, 0.72);
            b.hline(bx, 13, 4, PAL.cloth.black[3]!, 0.78);
            b.hline(bx, 14, 4, PAL.cloth.black[2]!, 0.76);
            b.set(bx + 2, 15, PAL.steel[3], 0.8);
            break;
        }
        case 'cashCase':
            // An armoured courier's steel cash case, chained to the wrist.
            b.rect(12, 16, 4, 4, PAL.steel[3], 0.75);
            b.hline(12, 16, 4, PAL.steel[5], 0.8);
            b.vline(15, 17, 3, PAL.steel[2], 0.7);
            b.set(13, 18, PAL.cloth.mustard[3]!, 0.8);
            b.set(12, 15, PAL.steel[4], 0.75);
            break;
        case 'rifle': {
            // A carbine across the chest at the low ready: the stock in the right shoulder, the muzzle down past the left
            // hip, the right hand on the grip and the left under the handguard; the arms bend in to hold it. From behind
            // only the muzzle shows, past the left arm.
            const dark = PAL.cloth.black[0]!, height = H.arm + 0.1;
            if (!front) {
                b.set(2, 14, dark, height);
                b.set(1, 15, dark, height);
                break;
            }
            const sleeves = sleeveRamp(spec), hands = handRamp(spec);
            for (let y = 11; y <= 15; y++) b.clear(3, y);
            for (let y = 13; y <= 15; y++) b.clear(12, y);
            // From x = 3, y = 9: `L` the gun's lit top, `D` its dark underside and magazine, `a` the forearm, `g` `h` the hands.
            const colors: Record<string, [number, number]> = {
                L: [PAL.steel[3], height + 0.04], D: [dark, height], a: [sleeves[1]!, H.arm + 0.04], g: [hands[2]!, height + 0.06], h: [hands[1]!, height + 0.06]
            };
            ['.LL.........', 'aDDLL.......', '.aagDLL.....', '.....DDLLh..', '.....D..DLL.', '...........D'].forEach((row, ry) => [...row].forEach((key, rx) => {
                const entry = colors[key];
                if (entry) b.set(3 + rx, 9 + ry, entry[0], entry[1]);
            }));
            break;
        }
        case 'none':
            break;
    }
}

const skin = PAL.skin, hair = PAL.hair, cloth = PAL.cloth;

/** The cast of the lobby, one spec per look. Crew look like customers on purpose: Clean profiles blend in. */
export const LOOKS: Record<string, PersonSpec> = {
    teller: { skin: skin.tan, hair: hair.brown, hairStyle: 'bun', top: cloth.skyShirt, topKind: 'shirt', legs: cloth.charcoal, shoes: cloth.black, short: 1, lanyard: true },
    tellerB: { skin: skin.dark, hair: hair.black, hairStyle: 'buzz', top: cloth.navy, topKind: 'vest', under: cloth.white, tie: cloth.burgundy, legs: cloth.charcoal, shoes: cloth.black, lanyard: true },
    headTeller: { skin: skin.pale, hair: hair.grey, hairStyle: 'short', top: cloth.charcoal, topKind: 'cardigan', under: cloth.white, legs: cloth.charcoal, shoes: cloth.black, glasses: true, lanyard: true, short: 1 },
    guard: { skin: skin.brown, hair: hair.black, hairStyle: 'cap', top: cloth.guard, topKind: 'uniform', legs: cloth.guard, shoes: cloth.black },
    customerSuit: { skin: skin.pale, hair: hair.brown, hairStyle: 'short', top: cloth.charcoal, topKind: 'suit', tie: cloth.burgundy, legs: cloth.charcoal, shoes: cloth.black, carry: 'briefcase' },
    customerCoat: { skin: skin.tan, hair: hair.black, hairStyle: 'long', top: cloth.beige, topKind: 'coat', legs: cloth.charcoal, shoes: cloth.black, short: 1, carry: 'handbag' },
    customerDress: { skin: skin.brown, hair: hair.black, hairStyle: 'bun', top: cloth.burgundy, topKind: 'dress', legs: cloth.burgundy, shoes: cloth.black, short: 2 },
    customerCasual: { skin: skin.pale, hair: hair.blond, hairStyle: 'short', top: cloth.white, topKind: 'tee', legs: cloth.denim, shoes: cloth.charcoal, beard: true },
    customerOld: { skin: skin.pale, hair: hair.grey, hairStyle: 'bald', top: cloth.olive, topKind: 'coat', legs: cloth.charcoal, shoes: cloth.black, short: 2 },
    customerHoodie: { skin: skin.dark, hair: hair.black, hairStyle: 'buzz', top: cloth.mustard, topKind: 'hoodie', legs: cloth.denim, shoes: cloth.white },
    passerby: { skin: skin.tan, hair: hair.auburn, hairStyle: 'long', top: cloth.teal, topKind: 'coat', legs: cloth.black, shoes: cloth.black, short: 1, carry: 'handbag' },
    crewMara: { skin: skin.pale, hair: hair.auburn, hairStyle: 'ponytail', top: cloth.olive, topKind: 'bomber', under: cloth.charcoal, legs: cloth.black, shoes: cloth.black, short: 1 },
    crewJun: { skin: skin.tan, hair: hair.black, hairStyle: 'short', top: cloth.black, topKind: 'bomber', under: cloth.charcoal, legs: cloth.denim, shoes: cloth.black, carry: 'duffel' },
    crewSol: { skin: skin.brown, hair: hair.black, hairStyle: 'buzz', top: cloth.olive, topKind: 'hoodie', legs: cloth.charcoal, shoes: cloth.black, beard: true },
    // The Heavy: the broadest build, a worn brown work jacket over a dark tee, a fair buzz cut and beard.
    crewDex: {
        skin: skin.pale, hair: hair.blond, hairStyle: 'buzz', top: cloth.duck, topKind: 'work', under: cloth.charcoal, legs: cloth.charcoal, shoes: cloth.black,
        beard: true, broad: true
    },
    manager: { skin: skin.tan, hair: hair.grey, hairStyle: 'short', top: cloth.navy, topKind: 'suit', tie: cloth.mustard, legs: cloth.navy, shoes: cloth.black, glasses: true, lanyard: true },
    operator: { skin: skin.pale, hair: hair.brown, hairStyle: 'buzz', top: cloth.charcoal, topKind: 'shirt', legs: cloth.charcoal, shoes: cloth.black, lanyard: true, beard: true },
    cleaner: { skin: skin.dark, hair: hair.black, hairStyle: 'bun', top: cloth.teal, topKind: 'uniform', legs: cloth.teal, shoes: cloth.white, short: 1 },
    itTech: { skin: skin.brown, hair: hair.black, hairStyle: 'short', top: cloth.teal, topKind: 'polo', legs: cloth.beige, shoes: cloth.charcoal, glasses: true, lanyard: true, carry: 'laptopBag' },
    securityChief: { skin: skin.dark, hair: hair.grey, hairStyle: 'buzz', top: cloth.black, topKind: 'suit', under: cloth.white, tie: cloth.charcoal, legs: cloth.black, shoes: cloth.black, earpiece: true, lanyard: true },
    officeWorker: { skin: skin.pale, hair: hair.blond, hairStyle: 'long', top: cloth.burgundy, topKind: 'cardigan', under: cloth.white, legs: cloth.charcoal, shoes: cloth.black, short: 1, lanyard: true },
    courier: { skin: skin.tan, hair: hair.brown, hairStyle: 'cap', top: cloth.grey, topKind: 'uniform', legs: cloth.grey, shoes: cloth.black, carry: 'cashCase' },
    barista: { skin: skin.brown, hair: hair.auburn, hairStyle: 'ponytail', top: cloth.black, topKind: 'vest', under: cloth.white, legs: cloth.black, shoes: cloth.black, short: 1 },
    // The police, dressed as the animated officer (officer.ts): a stab vest over a pale blue shirt, navy trousers, the cap.
    police: { skin: skin.tan, hair: hair.black, hairStyle: 'policeCap', top: cloth.charcoal, topKind: 'police', under: cloth.skyShirt, legs: cloth.navy, shoes: cloth.black },
    // SWAT: helmet, a plate carrier over charcoal fatigues, gloves, a carbine across the chest.
    swat: {
        skin: skin.pale, hair: hair.brown, hairStyle: 'helmet', top: cloth.grey, topKind: 'tactical', under: cloth.charcoal, legs: cloth.charcoal, shoes: cloth.black,
        carry: 'rifle'
    }
};
