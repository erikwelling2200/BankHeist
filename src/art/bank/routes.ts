import type { Facing, Size } from '../../level/space';
import { PAL, mix } from '../palette';
import { hung } from './dressing';
import { part, rows, Turn, View, type Faces, type Part, type PropArt } from './view';

/*
 * The ways in and what guards them: a sewer grate in a utility room's floor, a duct grille, the ladder up to a roof
 * hatch and the daylight under a skylight; a walk-through metal detector and a motion sensor; a parking garage's
 * column and a drive-through's tube terminal. Each is drawn from its catalog box in its own frame (x across its front,
 * y from its back to its front, z up).
 */

const S = PAL.steel;
/** Cast iron: darker and duller than the steel. */
const IRON = [PAL.ink, mix(S[0], PAL.ink, 0.3), S[1], S[2], S[3]] as const;

/**
 * A square cast-iron grate over the sewer, flush with the floor: a frame round it and bars across it with the dark of
 * the shaft between them, a stiffening rib down the middle. The bars run across its own frame, so they turn with it.
 */
export function floorGrate(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, 0, { depthScale: 1 });
    const mid = Math.floor(s.w / 2);
    t.draw(view, [[part(0, 0, 0, s.w, s.d, 0), {
        top: (u, v) => {
            if (u === 0 || v === 0 || u === s.w - 1 || v === s.d - 1) return IRON[2];
            if (u === mid) return IRON[3];
            if (v % 2 === 0) return u === 1 || u === s.w - 2 ? PAL.void : mix(PAL.void, IRON[1], 0.4);
            return u === 1 ? IRON[4] : IRON[3];
        }
    }]]);
    return view.art();
}

/** An air-duct grille low on a wall: a pressed-steel frame and louvres, the dark of the duct between them. */
export function ventGrille(s: Size, facing: Facing): PropArt {
    return hung(s, facing, (u, v) => {
        if (v === 0) return { c: S[4] };
        if (v === s.h - 1) return { c: S[1] };
        if (u === 0 || u === s.w - 1) return { c: v === 2 ? S[5] : S[2] };
        return { c: v % 2 === 1 ? mix(PAL.void, S[0], 0.5) : S[4] };
    }, S[1], S[4]);
}

/** A PIR motion sensor: a white housing, its milky lens, and the red LED that blinks when it sees someone. */
export function motionSensor(s: Size, facing: Facing): PropArt {
    return hung(s, facing, (u, v) => {
        if (v === 0) return { c: u === 0 ? PAL.paper[3] : PAL.paper[2] };
        return u === 0 ? { c: PAL.cloth.white[1]! } : { c: PAL.emissive.ledRed, glow: true };
    }, PAL.paper[1], PAL.paper[3]);
}

/**
 * The inside end of the roof route: a steel ladder fixed to the wall on brackets, its rails rising into the collar of a
 * hatch in the ceiling, which stands out from the wall over it. Seen through the cut-away ceiling, the hatch's lid shows
 * on top: a plate with its hinges along the wall, a handle and a padlock at the near edge.
 */
export function roofHatch(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const collar = 3, top = s.h - collar, left = 2, right = s.w - 3, rail = 2;
    const parts: [Part, Faces][] = [];
    for (const z of [4, top - 5]) for (const x of [left, right]) parts.push([part(x, 0, z, 1, rail, 1), { sides: S[1], top: S[2], front: S[1] }]);
    for (const x of [left, right]) {
        parts.push([part(x, rail, 0, 1, 1, top), { sides: rows(v => (v % 8 === 0 ? S[4] : x === left ? S[3] : S[2])), top: S[4], front: x === left ? S[3] : S[2] }]);
    }
    for (let z = 3; z < top - 1; z += 3) parts.push([part(left + 1, rail, z, right - left - 1, 1, 1), { sides: S[4], top: S[5] }]);
    parts.push([part(0, 0, top, s.w, s.d, collar), {
        top: (u, v) => {
            if (u === 0 || u === s.w - 1 || v === s.d - 1) return S[4];
            if (v === 0) return S[2];
            if (v === 1 && (u === 2 || u === s.w - 3)) return S[1];
            if (v === s.d - 2 && u === Math.floor(s.w / 2)) return S[5];
            if (v === s.d - 2 && u === Math.floor(s.w / 2) + 1) return PAL.brass[3];
            return (u + v) % 5 === 0 ? S[2] : S[3];
        },
        sides: rows(v => (v === 0 ? S[4] : v === collar - 1 ? S[1] : S[2]))
    }]);
    t.draw(view, parts);
    view.outline(0.3);
    return view.art();
}

/** The detector's moulded panels: a pale warm grey. */
const PANEL = [S[1], S[2], mix(S[3], PAL.paper[1], 0.5), mix(S[4], PAL.paper[2], 0.5), mix(S[5], PAL.paper[3], 0.5)] as const;

/**
 * A walk-through metal detector: two thin, deep side panels on the floor, open between them, joined by a head box with
 * the control display on its front and two status LEDs on top (green lit, red dark). The zone lights run up the panels'
 * front edges.
 */
export function metalDetector(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const head = 3, panelH = s.h - head, pw = 2;
    const panel = (x: number): [Part, Faces] => [part(x, 0, 0, pw, s.d, panelH), {
        top: PANEL[3],
        front: (u, v) => (v === panelH - 1 ? S[1] : u === (x === 0 ? 1 : 0) ? PANEL[2] : PANEL[3]),
        back: rows(v => (v === panelH - 1 ? S[1] : PANEL[2])),
        sides: (u, v) => {
            if (v === panelH - 1) return S[1];
            if (u === 0 || u === s.d - 1) return PANEL[1];
            if (v === 3 && u >= 2 && u <= 4) return PAL.cloth.navy[3]!;
            if (v === Math.floor(panelH / 2)) return PANEL[2];
            return PANEL[3];
        }
    }];
    t.draw(view, [
        panel(0), panel(s.w - pw),
        [part(0, 1, panelH, s.w, s.d - 2, head), {
            top: rows(v => (v === s.d - 3 ? PANEL[4] : PANEL[3])),
            front: (u, v) => (v === 0 ? PANEL[4] : v === 1 && u >= 4 && u < s.w - 4 ? PAL.ink : v === head - 1 ? PANEL[1] : PANEL[2]),
            back: rows(v => (v === 0 ? PANEL[3] : PANEL[1])),
            sides: rows(v => (v === 0 ? PANEL[3] : PANEL[1])),
            corner: 1
        }]
    ]);
    const [gx, gy] = t.pixel(Math.floor(s.w / 2) - 1, Math.floor(s.d / 2));
    const [rx, ry] = t.pixel(Math.floor(s.w / 2) + 1, Math.floor(s.d / 2));
    view.glowTop(gx, gy, s.h, PAL.emissive.ledGreen);
    view.top(rx, ry, s.h, PAL.carpet[2]);
    if (t.seen === 'front') {
        for (let u = 5; u < s.w - 5; u++) view.glowFace(u, panelH + 2, PAL.emissive.screen[1]);
    }
    if (t.seen === 'front' || t.seen === 'back') {
        for (let z = 5; z < panelH - 2; z += 4) {
            view.glowFace(1, z, PAL.emissive.exitGreen[1]);
            view.glowFace(t.w - 2, z, PAL.emissive.exitGreen[1]);
        }
    }
    view.outline(0.3);
    return view.art();
}

/** Bay-number glyphs, three pixels wide and five high. */
const DIGITS: Record<string, string[]> = {
    '1': ['.#.', '##.', '.#.', '.#.', '###'],
    '2': ['##.', '..#', '.#.', '#..', '###'],
    '3': ['##.', '..#', '.#.', '..#', '##.'],
    '4': ['#.#', '#.#', '###', '..#', '..#'],
    '5': ['###', '#..', '##.', '..#', '##.'],
    '6': ['.##', '#..', '###', '#.#', '###'],
    '7': ['###', '..#', '.#.', '.#.', '.#.'],
    '8': ['###', '#.#', '###', '#.#', '###'],
    '9': ['###', '#.#', '###', '..#', '##.']
};

/**
 * A parking garage's square concrete column, cut off at the top like a wall, in section: tie holes from its formwork,
 * a white band with its bay number in navy at eye height, and yellow and black chevrons round its foot where bumpers hit
 * it. Square, so every side shows the same.
 */
export function pillar(s: Size, facing: Facing, bay = 4): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    // The band from about 1.4m to 1.8m up: eye height from a driver's seat and on foot.
    const glyph = DIGITS[String(bay)] ?? DIGITS['4']!, band = [17, 23] as const;
    const face = (w: number) => (u: number, v: number): number => {
        const z = s.h - v;
        if (z <= 6) return z === 6 ? PAL.cloth.black[2]! : (u + z) % 4 < 2 ? PAL.cloth.mustard[3]! : PAL.cloth.black[1]!;
        if (z >= band[0] && z <= band[1]) {
            const g = glyph[band[1] - 1 - z]?.[u - Math.floor((w - 3) / 2)];
            if (g === '#') return PAL.cloth.navy[2]!;
            return z === band[1] ? PAL.cloth.white[3]! : PAL.cloth.white[2]!;
        }
        if ((u === 1 || u === w - 2) && z % 9 === 0) return PAL.concrete[1];
        return z === s.h - 1 ? PAL.concrete[2] : (u * 7 + z * 3) % 13 === 0 ? PAL.concrete[4] : PAL.concrete[3];
    };
    t.draw(view, [[part(0, 0, 0, s.w, s.d, s.h), {
        top: (u, v) => ((u + v) % 3 === 0 ? PAL.concrete[2] : PAL.concrete[1]),
        front: face(s.w), back: face(s.w), sides: face(s.d)
    }]]);
    view.outline(0.25);
    return view.art();
}

/**
 * A drive-through's pneumatic-tube terminal: a steel post on a base plate, and on it the blue head with the open
 * canister bay (a clear carrier with a red cap waiting in it), the call button lit green and a speaker grille. Its back
 * is a plain access panel.
 */
export function tubeTerminal(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, s.h);
    const B = PAL.cloth.denim, headZ = 9, headH = s.h - headZ;
    t.draw(view, [
        [part(1, 1, 0, s.w - 2, s.d - 2, 1), { top: S[2], sides: S[1] }],
        [part(2, 1, 1, 2, 2, headZ - 1), { sides: (u: number) => (u === 0 ? S[4] : S[2]), top: S[3] }],
        [part(0, 0, headZ, s.w, s.d, headH), {
            top: rows(v => (v === s.d - 1 ? B[3]! : v === 0 ? B[1]! : B[2]!)),
            front: (u, v) => {
                if (v === 0) return B[3]!;
                if (v === headH - 1) return B[0]!;
                if (u >= 1 && u <= 3 && v >= 1 && v <= 4) {
                    if (u === 2) return v === 1 ? PAL.carpet[3] : PAL.glass[4];
                    return v === 1 ? PAL.carpet[1] : PAL.glass[1];
                }
                if (u === 4 && v === 5) return PAL.ink;
                if (u === 4 && v === 4) return S[1];
                return u === 0 ? B[3]! : B[2]!;
            },
            back: (u, v) => (v === 0 ? B[2]! : (u === 1 || u === s.w - 2) && (v === 1 || v === headH - 2) ? S[4] : B[1]!),
            sides: (u, v) => (v === 0 ? B[3]! : u === 0 ? B[2]! : B[1]!),
            corner: 1
        }]
    ]);
    if (t.seen === 'front') view.glowFace(4, headZ + headH - 2, PAL.emissive.ledGreen);
    view.outline(0.3);
    return view.art();
}

/** Daylight as it lands, warm white. */
const DAYLIGHT = mix(PAL.emissive.sky[1], PAL.emissive.lampWarm[1], 0.5);

/**
 * The inside end of a skylight: the daylight falling through the roof light onto the floor, a pale square in six panes,
 * crossed by the shadows of its frame, its edge broken where light and shade meet. Drawn see-through, so the floor
 * shows under it: only brighter where the light falls, a little darker under the frame.
 */
export function skylight(s: Size, facing: Facing): PropArt {
    const t = new Turn(s, facing), view = new View(t.w, t.d, 0, { depthScale: 1 });
    const cols = [0, Math.floor(s.w / 2), s.w - 1], rowsAt = [0, Math.floor(s.d / 3), Math.floor((2 * s.d) / 3), s.d - 1];
    const bar = (u: number, v: number) => cols.includes(u) || rowsAt.includes(v);
    const rim = (u: number, v: number) => u === 1 || v === 1 || u === s.w - 2 || v === s.d - 2;
    const whole = part(0, 0, 0, s.w, s.d, 0);
    t.draw(view, [[whole, { top: (u, v) => (bar(u, v) || (rim(u, v) && (u + v) % 2 === 0) ? null : DAYLIGHT), alpha: 95 }]]);
    t.draw(view, [[whole, { top: (u, v) => (rim(u, v) && !bar(u, v) && (u + v) % 2 === 0 ? DAYLIGHT : null), alpha: 40 }]]);
    t.draw(view, [[whole, { top: (u, v) => (bar(u, v) ? PAL.ink : null), alpha: 45 }]]);
    return view.art();
}
