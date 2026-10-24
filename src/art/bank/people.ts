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
 * One person standing, turned to `heading`, or lying down if they have a `pose` (the same drawing every way). The rig
 * (`Turned`) wraps the front and back drawings round the body's sections, so all eight views share one set of
 * measurements; eyes, glasses, nose, shoes, holster and carried things are placed per heading. `PERSON_EDGE` edges it.
 */
export function person(spec: PersonSpec, heading: PersonHeading, edge: Edge = PERSON_EDGE): PixelBitmap {
    if (spec.pose) return lying(spec, spec.pose, edge);
    return turned(spec, { front: flat(spec, true), back: flat(spec, false) }, heading, edge);
}

/** Every heading's drawing of one person, the front and back drawings made once. */
export function personViews(spec: PersonSpec, edge: Edge = PERSON_EDGE): Record<PersonHeading, PixelBitmap> {
    if (spec.pose) {
        const b = lying(spec, spec.pose, edge);
        return Object.fromEntries(PERSON_HEADINGS.map(h => [h, b])) as Record<PersonHeading, PixelBitmap>;
    }
    const tex = { front: flat(spec, true), back: flat(spec, false) };
    return Object.fromEntries(PERSON_HEADINGS.map(h => [h, turned(spec, tex, h, edge)])) as Record<PersonHeading, PixelBitmap>;
}

/**
 * The front (`front`) or back drawing a turned person is wrapped from: drawn flat, every part in its own base tone (the
 * rig shades the side away from the light per heading), without eyes, glasses, shoes, holster or carried bags, which
 * the rig places per heading.
 */
function flat(spec: PersonSpec, front: boolean): PixelBitmap {
    const b = new PixelBitmap(PERSON_WIDTH, PERSON_HEIGHT);
    const s = spec.short ?? 0;
    const top = 1 + s;
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
        b.rect(8, y, 3 + wide, 1, leg[2]!, H.legs);
        if (y > 15) b.set(7, y, deepen(leg[1]!, 0.25), H.legs - 0.1);
    }
    if (spec.topKind === 'dress') b.rect(5, 19, 6, 1, deepen(skin[1]!, 0.2), H.legs);

    // Torso, shoulders and arms.
    const torsoTop = top + 6;
    for (let y = torsoTop; y <= hemY; y++) {
        const flare = longTop && y > 14 ? (spec.topKind === 'dress' ? Math.min(2, y - 14) : 0) : 0;
        for (let x = left - flare; x <= right + flare; x++) {
            let c = cloth[2]!;
            if (y === torsoTop) c = cloth[3]!;
            if (y > 14 && spec.topKind === 'coat' && (x === 7 || x === 8)) c = deepen(cloth[1]!, 0.25);
            b.set(x, y, c, H.torso);
        }
    }
    const sleeve = spec.topKind === 'tee' || spec.topKind === 'polo' ? 3 : 7;
    for (let y = torsoTop + 1; y <= 14; y++) {
        const bare = y - torsoTop > sleeve;
        b.set(left - 1, y, bare ? skin[2]! : sleeves[1]!, H.arm);
        b.set(right + 1, y, bare ? skin[2]! : sleeves[1]!, H.arm);
    }
    b.set(left - 1, torsoTop, sleeves[2]!, H.arm);
    b.set(right + 1, torsoTop, sleeves[2]!, H.arm);
    b.set(left - 1, 15, hands[2]!, H.arm);
    b.set(right + 1, 15, hands[2]!, H.arm);

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
        // The right ear is on the left of the front drawing and the right of the back one.
        const ear = front ? 4 : 11, lead = front ? 5 : 10;
        b.set(ear, top + 3, PAL.steel[4], H.face);
        b.set(ear, top + 4, PAL.steel[3], H.face);
        b.set(lead, top + 5, PAL.steel[4], H.face);
        if (!front) b.set(10, torsoTop, PAL.steel[3], H.torso + 0.05);
    }
    if (spec.carry === 'duffel' || spec.carry === 'laptopBag') drawStrap(b, spec.carry, front);
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
            for (let y = torsoTop + 1; y <= 14; y++) { b.set(left - 1, y, under[2]!, H.arm); b.set(right + 1, y, under[2]!, H.arm); }
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
        b.set(x, y, y === top + 4 ? skin[1]! : skin[2]!, H.face);
    }
    if (front) {
        b.set(7, top + 4, skin[1]!, H.face);
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

/** A bag's strap across the chest, front only: the duffel's from the right shoulder, the laptop bag's from the left. */
function drawStrap(b: PixelBitmap, carry: 'duffel' | 'laptopBag', front: boolean): void {
    if (!front) return;
    if (carry === 'duffel') for (let i = 0; i < 6; i++) b.set(5 + i, 8 + i, PAL.cloth.black[2]!, 0.9);
    else for (let i = 0; i < 6; i++) b.set(10 - i, 8 + i, PAL.cloth.black[3]!, 0.9);
}

/** The eight ways a person can face, as the rules' `Facing`: clockwise from north. */
export type PersonHeading = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
/** In the order previews show them: facing the camera, then turning to the right, round to facing away and back. */
export const PERSON_HEADINGS: readonly PersonHeading[] = ['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw'];
const CLOCKWISE: readonly PersonHeading[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
/** How far each heading is turned from facing the camera, in degrees, towards the east. */
const TURN: Record<PersonHeading, number> = { s: 0, se: 45, e: 90, ne: 135, n: 180, nw: 225, w: 270, sw: 315 };

/** The heading of a step by (dx, dy), to the nearest of the eight; standing still keeps `current`. */
export function headingOf(dx: number, dy: number, current: PersonHeading): PersonHeading {
    if (!dx && !dy) return current;
    return CLOCKWISE[(Math.round(Math.atan2(dx, -dy) / (Math.PI / 4)) + 8) % 8]!;
}

/** The middle line of the canvas: the body's axis falls between columns 7 and 8. */
const MID = 8;
const W = PERSON_WIDTH, LAST = W - 1;

/** Parts of the body the rig keeps apart, for the shading after painting. */
const PART = { torso: 0, head: 1, armR: 2, armL: 3, legR: 4, legL: 5, gear: 6 } as const;

/**
 * One row of a body part, an ellipse in the person's own frame: `across` to their left, `fwd` the way they face, both
 * in pixels from the body's axis. `bF` and `bB` are its depth in front and behind (a cap's peak juts forward), `aB`
 * its half-width behind when that differs (a ponytail showing past one side of the face only); `cols`
 * the columns of the front drawing it is painted from (the back drawing's are their mirror).
 */
interface Section { y: number; cA: number; cF: number; a: number; aB?: number; bF: number; bB: number; cols: readonly [number, number]; part: number }

/** A box hung on the body (a holster, a bag), in the same frame, over rows `y0`-`y1`. */
interface Block {
    a0: number; a1: number; f0: number; f1: number; y0: number; y1: number;
    /** Its colour and height on row `y`; `shaded` when the face seen points away from the light. */
    paint: (y: number, shaded: boolean) => [number, number] | undefined;
}

/** Every material's ramp, to darken a pixel one step down its own ramp. */
const RAMPS: readonly Ramp[] = (() => {
    const out: Ramp[] = [];
    const walk = (v: unknown): void => {
        if (Array.isArray(v)) out.push(v as Ramp);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(PAL.cloth);
    walk(PAL.skin);
    walk(PAL.hair);
    walk(PAL);
    return out;
})();

/** One step darker along the colour's own ramp, or towards ink if it is on none. */
function darker(c: number): number {
    for (const r of RAMPS) {
        const i = r.indexOf(c);
        if (i > 0) return r[i - 1]!;
        if (i === 0) break;
    }
    return deepen(c, 0.25);
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Paints body parts turned to a heading, nearest surface first, onto a person-sized bitmap. */
class Turned {
    readonly b = new PixelBitmap(PERSON_WIDTH, PERSON_HEIGHT);
    readonly cos: number;
    readonly sin: number;
    private readonly z = new Float32Array(PERSON_WIDTH * PERSON_HEIGHT).fill(-Infinity);
    readonly part = new Int8Array(PERSON_WIDTH * PERSON_HEIGHT).fill(-1);
    /** Per part and row, the columns its outline covers in this view. */
    readonly extent = new Map<string, [number, number]>();

    constructor(readonly heading: PersonHeading) {
        const t = (TURN[heading] * Math.PI) / 180, snap = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
        this.cos = snap(Math.cos(t));
        this.sin = snap(Math.sin(t));
    }

    /** Screen x (from the axis) of a point in the person's frame. */
    x(across: number, fwd: number): number {
        return across * this.cos + fwd * this.sin;
    }

    /** How near the camera a point in the person's frame is. */
    depth(across: number, fwd: number): number {
        return -across * this.sin + fwd * this.cos;
    }

    paint(col: number, y: number, z: number, color: number, height: number, part: number): void {
        if (col < 0 || col > LAST || y < 0 || y >= PERSON_HEIGHT) return;
        const i = y * W + col;
        if (z <= this.z[i]!) return;
        this.z[i] = z;
        this.part[i] = part;
        this.b.set(col, y, color, height);
    }

    /** Paints a section from the drawing on whichever side of the body each column sees. */
    wrap(s: Section, tex: Drawings): void {
        for (let col = 0; col < W; col++) {
            const hit = this.meet(s, col + 0.5 - MID);
            if (!hit) continue;
            const key = `${s.part}:${s.y}`, e = this.extent.get(key);
            this.extent.set(key, e ? [Math.min(e[0], col), Math.max(e[1], col)] : [col, col]);
            const [c0, c1] = s.cols, t = hit.front ? tex.front : tex.back;
            let src = hit.front ? clamp(MID + Math.floor(hit.across), c0, c1) : clamp(MID + Math.floor(-hit.across), LAST - c1, LAST - c0);
            // Inside the skull (columns 5-10 in every view), a pixel only one side drawn fills from the next one in.
            if (!t.opaque(src, s.y) && s.part === PART.head && col >= 5 && col <= 10) src += src < MID ? 1 : -1;
            if (t.opaque(src, s.y)) this.paint(col, s.y, hit.z, t.color(src, s.y), t.heightAt(src, s.y), s.part);
        }
    }

    /** Where the line of sight through screen x `X` first meets the section's outline, if it does. */
    private meet(s: Section, X: number): { across: number; z: number; front: boolean } | undefined {
        let best: { across: number; z: number; front: boolean } | undefined;
        for (const half of [1, -1]) {
            const b = half > 0 ? s.bF : s.bB, a = half > 0 ? s.a : s.aB ?? s.a, x0 = this.x(s.cA, s.cF);
            const R = Math.hypot(a * this.cos, b * this.sin), t = (X - x0) / R;
            if (!(Math.abs(t) < 1)) continue;
            const alpha = Math.atan2(b * this.sin, a * this.cos);
            for (const phi of [Math.asin(t) - alpha, Math.PI - Math.asin(t) - alpha]) {
                const c = Math.cos(phi);
                if (half > 0 ? c < -1e-9 : c > 1e-9) continue;
                const across = s.cA + a * Math.sin(phi), z = this.depth(across, s.cF + b * c);
                if (!best || z > best.z) best = { across, z, front: half > 0 };
            }
        }
        return best;
    }

    /**
     * Paints a box hung on the body. It is mounted on the surface under it, so it draws over that (`bias`), but the body
     * still hides it when it hangs on the far side.
     */
    block(k: Block, bias = 2): void {
        const corners: [number, number][] = [[k.a0, k.f0], [k.a1, k.f0], [k.a1, k.f1], [k.a0, k.f1]];
        // Outward normals of the faces between consecutive corners: behind, the left side, in front, the right side.
        const normals: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
        const xs = corners.map(([a, f]) => this.x(a, f)), zs = corners.map(([a, f]) => this.depth(a, f));
        for (let col = 0; col < W; col++) {
            const X = col + 0.5 - MID;
            if (!(X > Math.min(...xs) && X < Math.max(...xs))) continue;
            let z = -Infinity, face = 0;
            for (let i = 0; i < 4; i++) {
                const j = (i + 1) % 4, xi = xs[i]!, xj = xs[j]!;
                if ((xi - X) * (xj - X) > 0) continue;
                const at = xi === xj ? Math.max(zs[i]!, zs[j]!) : zs[i]! + ((X - xi) / (xj - xi)) * (zs[j]! - zs[i]!);
                if (at > z) {
                    z = at;
                    face = i;
                }
            }
            const [na, nf] = normals[face]!, shaded = this.x(na, nf) > 0.3;
            for (let y = k.y0; y <= k.y1; y++) {
                const c = k.paint(y, shaded);
                if (c) this.paint(col, y, z + bias, c[0], c[1], PART.gear);
            }
        }
    }

    /** One pixel at a point in the person's frame. */
    dot(across: number, fwd: number, y: number, color: number, height: number, bias = 0, part: number = PART.gear): void {
        this.paint(MID + Math.floor(this.x(across, fwd)), y, this.depth(across, fwd) + bias, color, height, part);
    }

    /** Whether, of a pair of limbs at `across` ±`side`, the left one reads as further from the light: the far one, else the right. */
    darkerIsLeft(side: number): boolean {
        const key = (a: number) => this.x(a, 0) - 2 * this.depth(a, 0);
        return key(side) > key(-side);
    }
}

/** The front and back drawings a turned person is wrapped from. */
interface Drawings { front: PixelBitmap; back: PixelBitmap }

/** Eye columns per heading (row `top + 3`), on the standard head (columns 5-10); the headings facing away show none. */
const EYES: Partial<Record<PersonHeading, readonly number[]>> = { s: [6, 9], se: [8, 10], e: [10], sw: [5, 7], w: [5] };
/** Glasses on the eye row from column 4: `L` a lens, `B` the bridge, `T` a temple running back to the ear. */
const GLASSES: Partial<Record<PersonHeading, string>> = { s: '.LL.BLL.', se: '...LLBL.', e: '....TTL.', sw: '.LBLL...', w: '.LTT....' };
/** In profile the nose stands a pixel proud of the face, a row under the eye. */
const NOSE: Partial<Record<PersonHeading, number>> = { e: 11, w: 4 };

/**
 * Shoes per heading: the two rows under the legs, `L` and `R` the uppers of the feet on the screen's left and right,
 * `N` the near foot in profile (the far one hidden behind it), `o` the soles, `i` the shadow between the feet.
 */
const SHOES: Record<PersonHeading, readonly [string, string]> = {
    s: ['....LLLLRRRR....', '....oooiiooo....'],
    se: ['.....LLLRRRR....', '.....ooioooo....'],
    e: ['......NNNNN.....', '......oooooo....'],
    ne: ['.....LLLLRRR....', '.....ooooiooo...'],
    n: ['....LLLLRRRR....', '....oooiiooo....'],
    nw: ['....LLLRRRR.....', '...oooioooo.....'],
    w: ['.....NNNNN......', '....oooooo......'],
    sw: ['....LLLLRRR.....', '....ooooioo.....']
};

/** Paints a standing person turned to `heading` from their front and back drawings. */
function turned(spec: PersonSpec, tex: Drawings, heading: PersonHeading, edge: Edge): PixelBitmap {
    const r = new Turned(heading), { skin } = spec;
    const top = 1 + (spec.short ?? 0), torsoTop = top + 6;
    const wide = spec.broad ? 1 : 0, left = 4 - wide, right = 11 + wide;
    const hemY = spec.topKind === 'coat' || spec.topKind === 'dress' ? 18 : 14;
    // The front drawing's eyes go: the rig puts them where each heading sees them. A mask's eye holes go with them.
    for (const x of [6, 9]) if (tex.front.color(x, top + 3) === PAL.ink) tex.front.set(x, top + 3, tex.front.color(7, top + 3), tex.front.heightAt(7, top + 3));

    // Legs: a pair of columns either side of the axis, a little deeper than wide.
    const leg = 1.5 + wide / 2, rifle = spec.carry === 'rifle';
    for (let y = 15; y <= 21; y++) {
        r.wrap({ y, cA: -leg, cF: 0, a: leg, bF: 1.75, bB: 1.75, cols: [5 - wide, 7], part: PART.legR }, tex);
        r.wrap({ y, cA: leg, cF: 0, a: leg, bF: 1.75, bB: 1.75, cols: [8, 10 + wide], part: PART.legL }, tex);
    }
    // The torso, flaring at a dress's hem, and the arms hanging at its sides.
    for (let y = torsoTop; y <= hemY; y++) {
        const flare = spec.topKind === 'dress' && y > 14 ? Math.min(2, y - 14) : 0, half = 4 + wide + flare, depth = 2.5 + wide / 2 + flare / 2;
        r.wrap({ y, cA: 0, cF: 0, a: half, bF: depth, bB: depth, cols: [left - flare, right + flare], part: PART.torso }, tex);
    }
    const arm = 4.5 + wide;
    for (let y = torsoTop; y <= 15; y++) {
        if (!rifle || y <= 10) r.wrap({ y, cA: -arm, cF: 0, a: 0.5, bF: 1, bB: 1, cols: [left - 1, left - 1], part: PART.armR }, tex);
        if (!rifle || y <= 11) r.wrap({ y, cA: arm, cF: 0, a: 0.5, bF: 1, bB: 1, cols: [right + 1, right + 1], part: PART.armL }, tex);
    }
    // The head, row by row as wide as the drawings make it: a hat's brim or long hair wider than the skull.
    for (let y = top - 2; y < torsoTop; y++) {
        const half = (t: PixelBitmap) => {
            let a = 0;
            for (let x = 0; x < W; x++) if (t.opaque(x, y)) a = Math.max(a, x < MID ? MID - x : x + 1 - MID);
            return a;
        };
        const aF = half(tex.front), aB = half(tex.back), a = aF || aB;
        if (!a) continue;
        let b = Math.min(a, 3), bF = b, cF = 0;
        if (spec.hairStyle === 'bun' && y === top - 2) {
            cF = -1;
            b = bF = 1.2;
        }
        if (spec.hairStyle === 'cap' && y === top + 1) bF = a + 0.5;
        if (spec.hairStyle === 'policeCap' && y === top + 1) bF = 4;
        if (spec.hairStyle === 'helmet' && y <= top + 2) b = bF = a;
        r.wrap({ y, cA: 0, cF, a, aB: aB || a, bF, bB: b, cols: [3, 12], part: PART.head }, tex);
    }
    gear(r, spec, wide, arm);

    // Face: eyes, glasses and the nose where this heading sees them, on the head only.
    const onHead = (x: number, y: number) => r.part[y * W + x] === PART.head;
    if (!spec.glasses) for (const x of EYES[heading] ?? []) if (onHead(x, top + 3)) r.b.set(x, top + 3, PAL.ink, H.face - 0.1);
    const glasses = spec.glasses ? GLASSES[heading] : undefined;
    if (glasses) [...glasses].forEach((k, i) => {
        if (k === '.' || !onHead(4 + i, top + 3)) return;
        r.b.set(4 + i, top + 3, k === 'L' ? PAL.steel[1] : PAL.steel[2], k === 'L' ? H.face + 0.05 : k === 'B' ? H.face : H.face + 0.02);
    });
    const nose = NOSE[heading];
    if (nose !== undefined && !spec.mask && onHead(nose === 11 ? 10 : 5, top + 4)) r.paint(nose, top + 4, Infinity, skin[1]!, H.face, PART.head);

    shade(r, spec, top, torsoTop, hemY, arm, leg);
    shoes(r, spec, wide, leg);
    edge(r.b);
    return r.b;
}

/**
 * Light from above and a little left, as on the drawings: the two columns of the torso furthest right and the head's
 * last column a step darker, and of each pair of limbs the one further from the light.
 */
function shade(r: Turned, spec: PersonSpec, top: number, torsoTop: number, hemY: number, arm: number, leg: number): void {
    const cloth = spec.top, legs = spec.topKind === 'dress' ? spec.skin : spec.legs;
    const at = (x: number, y: number) => r.part[y * W + x];
    for (let y = torsoTop; y <= hemY; y++) {
        const e = r.extent.get(`${PART.torso}:${y}`);
        if (e) for (let x = e[1] - 1; x <= e[1]; x++) if (at(x, y) === PART.torso && r.b.color(x, y) === cloth[2]) r.b.set(x, y, cloth[1]!, r.b.heightAt(x, y));
    }
    // The skull is round, so its last column is 10 in every view, inside long hair or an earpiece.
    for (let y = top + 1; y <= top + 3; y++) if (at(10, y) === PART.head && r.b.color(10, y) === spec.skin[2]) r.b.set(10, y, spec.skin[1]!, r.b.heightAt(10, y));
    const darkArm = r.darkerIsLeft(arm) ? PART.armL : PART.armR, darkLeg = r.darkerIsLeft(leg) ? PART.legL : PART.legR;
    for (let y = 0; y < PERSON_HEIGHT; y++) for (let x = 0; x < W; x++) {
        if (at(x, y) === darkArm) r.b.set(x, y, darker(r.b.color(x, y)), r.b.heightAt(x, y));
        if (at(x, y) === darkLeg && r.b.color(x, y) === legs[2]) r.b.set(x, y, legs[1]!, r.b.heightAt(x, y));
    }
}

/** The shoes under the legs, from the heading's piece; a broad build's a pixel wider each side. */
function shoes(r: Turned, spec: PersonSpec, wide: number, leg: number): void {
    // The darker foot is the darker leg's; `L` and `R` are by screen side.
    const rightDark = r.darkerIsLeft(leg) === r.x(leg, 0) > r.x(-leg, 0);
    SHOES[r.heading].forEach((row, i) => {
        const y = 22 + i, keys = [...row];
        if (wide) {
            const l = keys.findIndex(k => k !== '.'), rr = keys.length - 1 - [...keys].reverse().findIndex(k => k !== '.');
            keys[l - 1] = keys[l]!;
            keys[rr + 1] = keys[rr]!;
        }
        keys.forEach((k, x) => {
            if (k === '.') return;
            if (k === 'o') r.b.set(x, y, spec.shoes[0]!, H.shoes - 0.1);
            else if (k === 'i') r.b.set(x, y, PAL.ink, H.shoes - 0.2);
            else r.b.set(x, y, k === 'N' || (k === 'L') === rightDark ? spec.shoes[2]! : spec.shoes[1]!, H.shoes);
        });
    });
}

/** What hangs on the body: the holster on the left hip, carried bags, the carbine, each in the person's own frame. */
function gear(r: Turned, spec: PersonSpec, wide: number, arm: number): void {
    const black = PAL.cloth.black, hip = 3 + wide, hand = arm + 0.5;
    const solid = (c: number, h: number) => (): [number, number] => [c, h];
    // A box's top row a step lit, its far-from-the-light face a step dark.
    const ramped = (ramp: Ramp, body: number, topRow: number, lit: number, height: number) => (y: number, shaded: boolean): [number, number] =>
        y === topRow ? [ramp[lit]!, height + 0.05] : [ramp[shaded ? Math.max(0, body - 1) : body]!, height];
    if (spec.topKind === 'uniform' || spec.topKind === 'police') {
        r.block({ a0: hip, a1: hip + 2, f0: -2.5, f1: -0.5, y0: 14, y1: 16, paint: solid(black[0]!, H.torso + 0.1) });
        if (spec.topKind === 'police') r.block({ a0: hip, a1: hip + 1, f0: -1.5, f1: -0.5, y0: 13, y1: 13, paint: solid(PAL.steel[2], H.torso + 0.1) });
    }
    switch (spec.carry) {
        case 'briefcase':
            // In the left hand, its broad side along the body.
            r.block({ a0: hand - 1, a1: hand + 2, f0: -1.8, f1: 1.8, y0: 16, y1: 18, paint: ramped(PAL.walnut, 1, 16, 3, 0.7) });
            r.block({ a0: hand, a1: hand + 1, f0: -0.5, f1: 0.5, y0: 15, y1: 15, paint: solid(PAL.brass[3], 0.7) });
            break;
        case 'cashCase':
            // An armoured courier's steel case, chained to the left wrist.
            r.block({ a0: hand - 1, a1: hand + 3, f0: -1.5, f1: 1.5, y0: 16, y1: 19, paint: ramped(PAL.steel, 3, 16, 5, 0.75) });
            r.block({ a0: hand - 1, a1: hand, f0: -0.5, f1: 0.5, y0: 15, y1: 15, paint: solid(PAL.steel[4], 0.75) });
            break;
        case 'handbag':
            // Hung on the right forearm.
            r.block({ a0: -hand - 2.5, a1: -hand + 0.5, f0: -1, f1: 1, y0: 13, y1: 15, paint: ramped(PAL.cloth.burgundy, 2, 13, 3, 0.7) }, 2.2);
            r.block({ a0: -hand - 1.5, a1: -hand - 0.5, f0: -0.5, f1: 0.5, y0: 12, y1: 12, paint: solid(PAL.brass[3], 0.7) }, 2.2);
            break;
        case 'duffel':
            // On the left hip, its strap over the right shoulder.
            r.block({
                a0: 2.2 + wide, a1: 6.8 + wide, f0: -2, f1: 2, y0: 13, y1: 16,
                paint: (y, shaded) => (y === 13 ? [PAL.cloth.olive[2]!, 0.8] : y === 15 ? [PAL.cloth.olive[0]!, 0.7] : [PAL.cloth.olive[shaded ? 0 : 1]!, 0.75])
            });
            break;
        case 'laptopBag':
            // A slim messenger bag on the right hip, a flap and a buckle, its strap over the left shoulder.
            r.block({
                a0: -6.8 - wide, a1: -3.2 - wide, f0: -1, f1: 1.4, y0: 13, y1: 16,
                paint: y => (y === 13 ? [black[3]!, 0.78] : y === 14 ? [black[2]!, 0.76] : y === 15 ? [PAL.steel[3], 0.8] : [black[1]!, 0.72])
            });
            break;
        case 'rifle': {
            // A carbine across the chest at the low ready: the stock in the right shoulder, the muzzle down past the left
            // hip; the right hand on the grip, the left under the handguard. Its lit top a row above its dark underside.
            const sleeves = sleeveRamp(spec), hands = handRamp(spec), h = H.arm + 0.1;
            for (let u = 0; u <= 9; u++) {
                const across = -3.5 + u, fwd = 3.2 + u * 0.05, y = 9 + Math.floor(u / 2);
                r.dot(across, fwd, y, PAL.steel[3], h + 0.04, 0.2);
                r.dot(across, fwd, y + 1, black[0]!, h);
            }
            r.dot(6.5, 3.7, 14, black[0]!, h);
            r.dot(0.5, 3.4, 13, black[0]!, h);
            r.dot(-3.5, 1.5, 11, sleeves[1]!, H.arm + 0.04, 0, PART.armR);
            r.dot(-2.5, 2.5, 11, sleeves[1]!, H.arm + 0.04, 0, PART.armR);
            r.dot(-1.5, 3.6, 11, hands[2]!, h + 0.06, 1);
            r.dot(4.5, 1.5, 12, hands[1]!, h + 0.06, 1);
            break;
        }
        default:
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
