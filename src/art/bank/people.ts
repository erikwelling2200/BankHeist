import { PAL, deepen, mix, type Ramp } from '../palette';
import { PixelBitmap } from '../PixelBitmap';
import { inner, type Edge } from './edges';

/** People are 16x24: about four heads tall, feet on the bottom row, so one stands on a tile and overlaps the row above. */
export const PERSON_WIDTH = 16;
export const PERSON_HEIGHT = 24;

type HairStyle = 'short' | 'long' | 'bald' | 'bun' | 'ponytail' | 'cap' | 'buzz';
type TopKind = 'suit' | 'shirt' | 'vest' | 'uniform' | 'coat' | 'tee' | 'hoodie' | 'dress' | 'cardigan' | 'bomber';
type Carry = 'briefcase' | 'duffel' | 'handbag' | 'none';

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
 * slightly left: shoulders take the light, the right side and the arms sit a step darker. `PERSON_EDGE` edges it.
 */
export function person(spec: PersonSpec, facing: 'front' | 'back', edge: Edge = PERSON_EDGE): PixelBitmap {
    const b = new PixelBitmap(PERSON_WIDTH, PERSON_HEIGHT);
    const s = spec.short ?? 0;
    const top = 1 + s;
    const front = facing === 'front';
    const { skin, top: cloth } = spec;
    const longTop = spec.topKind === 'coat' || spec.topKind === 'dress';
    const hemY = spec.topKind === 'dress' ? 18 : spec.topKind === 'coat' ? 18 : 14;

    // Legs and shoes first, so a coat or dress can hang over them.
    for (let y = 15; y <= 21; y++) {
        const leg = spec.topKind === 'dress' ? skin : spec.legs;
        b.rect(5, y, 3, 1, leg[2]!, H.legs);
        b.rect(8, y, 3, 1, leg[1]!, H.legs);
        if (y > 15) b.set(7, y, deepen(leg[1]!, 0.25), H.legs - 0.1);
    }
    if (spec.topKind === 'dress') b.rect(5, 19, 6, 1, deepen(skin[1]!, 0.2), H.legs);
    b.rect(4, 22, 4, 1, spec.shoes[2]!, H.shoes);
    b.rect(8, 22, 4, 1, spec.shoes[1]!, H.shoes);
    b.rect(4, 23, 8, 1, spec.shoes[0]!, H.shoes - 0.1);
    b.set(7, 23, PAL.ink, H.shoes - 0.2);
    b.set(8, 23, PAL.ink, H.shoes - 0.2);

    // Torso, shoulders and arms.
    const torsoTop = top + 6;
    for (let y = torsoTop; y <= hemY; y++) {
        const flare = longTop && y > 14 ? (spec.topKind === 'dress' ? Math.min(2, y - 14) : 0) : 0;
        for (let x = 4 - flare; x <= 11 + flare; x++) {
            let c = x <= 5 ? cloth[2]! : x >= 10 ? cloth[1]! : cloth[2]!;
            if (y === torsoTop) c = cloth[3]!;
            if (y > 14 && spec.topKind === 'coat' && (x === 7 || x === 8)) c = deepen(cloth[1]!, 0.25);
            b.set(x, y, c, H.torso);
        }
    }
    const sleeve = spec.topKind === 'tee' ? 3 : 7;
    for (let y = torsoTop + 1; y <= 14; y++) {
        const bare = y - torsoTop > sleeve;
        b.set(3, y, bare ? skin[2]! : cloth[1]!, H.arm);
        b.set(12, y, bare ? skin[1]! : cloth[0]!, H.arm);
    }
    b.set(3, torsoTop, cloth[2]!, H.arm);
    b.set(12, torsoTop, cloth[1]!, H.arm);
    b.set(3, 15, skin[2]!, H.arm);
    b.set(12, 15, skin[1]!, H.arm);

    if (front) frontDetails(b, spec, torsoTop, hemY);
    else backDetails(b, spec, torsoTop, hemY);

    // Neck and head.
    b.rect(7, top + 5, 2, 1, skin[1]!, H.face);
    drawHead(b, spec, top, front);
    if (spec.carry && spec.carry !== 'none') drawCarry(b, spec.carry, front);
    edge(b);
    return b;
}

function frontDetails(b: PixelBitmap, spec: PersonSpec, torsoTop: number, hemY: number): void {
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
            if (spec.topKind === 'bomber') b.rect(4, 14, 8, 1, cloth[0]!, H.torso);
            else b.set(9, torsoTop + 5, cloth[0]!, H.torso);
            break;
        }
        case 'vest': {
            b.rect(4, torsoTop, 8, 1, under[3]!, H.torso);
            b.set(3, torsoTop + 1, under[2]!, H.arm);
            for (let y = torsoTop + 1; y <= 14; y++) { b.set(3, y, under[2]!, H.arm); b.set(12, y, under[1]!, H.arm); }
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
            b.rect(4, 14, 8, 1, PAL.cloth.black[1]!, H.torso);
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
            b.set(3, torsoTop + 2, PAL.brass[3], H.arm + 0.05);
            b.rect(4, 14, 8, 1, PAL.cloth.black[1]!, H.torso + 0.05);
            b.rect(7, 14, 2, 1, PAL.brass[4], H.torso + 0.1);
            b.rect(11, 14, 2, 3, PAL.cloth.black[0]!, H.torso + 0.1);
            break;
        }
        case 'coat': {
            b.set(6, torsoTop, cloth[3]!, H.torso + 0.05);
            b.set(9, torsoTop, cloth[3]!, H.torso + 0.05);
            b.set(7, torsoTop, under[2]!, H.torso);
            b.set(8, torsoTop, under[2]!, H.torso);
            b.vline(8, torsoTop + 1, hemY - torsoTop, cloth[0]!, H.torso);
            b.rect(4, 13, 8, 1, cloth[1]!, H.torso);
            b.set(7, 13, PAL.brass[2], H.torso + 0.05);
            break;
        }
        case 'hoodie': {
            b.rect(5, torsoTop, 6, 1, cloth[3]!, H.torso + 0.1);
            b.set(7, torsoTop + 1, PAL.cloth.white[2]!, H.torso);
            b.set(8, torsoTop + 2, PAL.cloth.white[2]!, H.torso);
            b.rect(5, 12, 6, 2, cloth[1]!, H.torso);
            b.rect(4, 14, 8, 1, cloth[0]!, H.torso);
            break;
        }
        case 'tee': {
            b.rect(7, torsoTop, 2, 1, cloth[1]!, H.torso);
            b.rect(4, 14, 8, 1, PAL.cloth.black[2]!, H.torso);
            break;
        }
        case 'dress': {
            b.rect(6, torsoTop, 4, 1, spec.skin[2]!, H.face);
            b.rect(4, 13, 8, 1, cloth[0]!, H.torso);
            break;
        }
    }
    if (spec.lanyard) {
        b.set(6, torsoTop + 1, PAL.cloth.burgundy[3]!, H.torso + 0.05);
        b.set(6, torsoTop + 2, PAL.cloth.burgundy[3]!, H.torso + 0.05);
        b.rect(5, torsoTop + 3, 2, 2, PAL.paper[3], H.torso + 0.1);
    }
}

function backDetails(b: PixelBitmap, spec: PersonSpec, torsoTop: number, hemY: number): void {
    const { top: cloth } = spec;
    if (spec.topKind === 'suit' || spec.topKind === 'coat') b.vline(8, torsoTop + 3, hemY - torsoTop - 2, cloth[0]!, H.torso);
    if (spec.topKind === 'hoodie') b.rect(5, torsoTop, 6, 2, cloth[3]!, H.torso + 0.15);
    if (spec.topKind === 'uniform') b.rect(4, torsoTop + 2, 8, 1, cloth[3]!, H.torso + 0.02);
    if (spec.topKind === 'shirt' || spec.topKind === 'uniform' || spec.topKind === 'tee' || spec.topKind === 'bomber') {
        b.rect(4, 14, 8, 1, PAL.cloth.black[1]!, H.torso);
    }
}

function drawHead(b: PixelBitmap, spec: PersonSpec, top: number, front: boolean): void {
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
        if (spec.beard) { b.rect(5, top + 4, 6, 1, hair[1]!, H.face); b.rect(6, top + 5, 4, 1, hair[0]!, H.face); }
        else b.rect(6, top + 5, 4, 1, skin[1]!, H.face);
    } else {
        b.rect(6, top + 5, 4, 1, skin[1]!, H.face);
    }

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

function drawCarry(b: PixelBitmap, carry: Carry, front: boolean): void {
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
    manager: { skin: skin.tan, hair: hair.grey, hairStyle: 'short', top: cloth.navy, topKind: 'suit', tie: cloth.mustard, legs: cloth.navy, shoes: cloth.black, glasses: true, lanyard: true },
    operator: { skin: skin.pale, hair: hair.brown, hairStyle: 'buzz', top: cloth.charcoal, topKind: 'shirt', legs: cloth.charcoal, shoes: cloth.black, lanyard: true, beard: true },
    cleaner: { skin: skin.dark, hair: hair.black, hairStyle: 'bun', top: cloth.teal, topKind: 'uniform', legs: cloth.teal, shoes: cloth.white, short: 1 },
    barista: { skin: skin.brown, hair: hair.auburn, hairStyle: 'ponytail', top: cloth.black, topKind: 'vest', under: cloth.white, legs: cloth.black, shoes: cloth.black, short: 1 }
};
