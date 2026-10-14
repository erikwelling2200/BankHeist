import type { Archetype, Rect, RoomType, Tier, Wing } from './model';
import type { Rng } from './rng';
import { isOpenPair, opensOnto, ROOM_RULES } from './rooms';
import { reshape } from './shapes';
import { TIER_SPECS } from './tiers';

/*
 * The bank's floor plan by archetype (§17.2 step 2): rooms placed as rectangles inside the bank's lot, in the lot's own
 * tiles (x east, y south from the back wall; the street front is the bottom edge). Fixed orientation (§17.1): the
 * vault and the secure core at the back, the lobby at the front, staff rooms between. Doors come later, from each
 * room type's rules (`rooms.ts`); a layout that can't connect is rolled again.
 *
 * Every archetype builds on the same back band: the vault against the back wall with its antechamber in front of it
 * (and a mantrap from the city branch up), secure closets to one side, the service end (loading bay, back door) to
 * the other, and the vault corridor across the whole lot in front of them. They differ in how the front connects to it.
 *
 * The space between is filled by programs (research/procedural-interiors.md, lessons 1 and 4): each strip of the lot
 * (a wing along its corridor, the band behind the teller line, the closets beside the vault) gets the rooms the
 * archetype wants there, each at its type's target area, and space to spare becomes more rooms with jobs (a counting
 * room, a records room, a staff office, a conference room) instead of one stretched hall. A wide strip puts two rooms
 * side by side, the far one entered through its neighbour. Then shape moves (`shapes.ts`) trade corners between
 * neighbours, so not every room is a rectangle.
 */

export interface Piece extends Rect {
    type: RoomType;
    wing: Wing;
    /**
     * The rectangles it is made of, largest first, once a shape move has made it more than one; x, y, w and h are then
     * their bounding box. Absent for a plain rectangle.
     */
    parts?: Rect[];
    /** A raised room (a mezzanine), reached by stairs. */
    raised?: boolean;
    /** Tiles of the room that are stairs, rising north (local coordinates). */
    stairs?: Rect;
}

export interface Layout {
    width: number;
    depth: number;
    pieces: Piece[];
    /** Where daylight falls through a glass roof (the atrium's skylight), if any. */
    skylight?: { x: number; y: number };
    /** Extra connections the archetype wants beyond the room rules (loops, §17.1), by piece index. */
    links: { a: number; b: number; lock: 'none' | 'keycard' | 'mechanical' }[];
}

const piece = (type: RoomType, x: number, y: number, w: number, h: number, wing: Wing, extra: Partial<Piece> = {}): Piece => ({ type, x, y, w, h, wing, ...extra });

/** The rectangles of a piece: its parts, or its own rectangle. */
export const partsOf = (p: Piece): Rect[] => p.parts ?? [{ x: p.x, y: p.y, w: p.w, h: p.h }];

/** A room a program asks for and the least it can be along the strip; how big it gets comes from its type's area. */
interface Want {
    type: RoomType;
    min: number;
    required?: boolean;
    /** How deep it is along the strip, for a room without a target area (the loading bay). */
    size?: number;
}

/**
 * A part of the lot a program fills band by band along `along`, entered from its `inner` side across it: the low or
 * high x when bands run along y, the low or high y when they run along x. `access` is what the inner side opens onto.
 */
interface Strip extends Rect {
    along: 'x' | 'y';
    inner: 'low' | 'high';
    access: RoomType[];
}

/** The rooms a program adds with space to spare: which types, best first, and where among its own rooms they go. */
interface Extra {
    at: number;
    types: RoomType[];
    /** What the far side of a strip opens onto (the teller line in front of the band behind it), for the far room of a pair. */
    outerAccess?: RoomType[];
    /** The first band's least depth, where it has to reach past something (the stairs, the counter) to its door. */
    firstMin?: number;
}

/** One band across a strip: one room the full width, or two side by side, the first on the inner side. */
interface Band { depth: number; min: number; rooms: { type: RoomType; span: number }[] }

/** How wide a strip is before a band holds two rooms side by side, and the least either of them is across. */
const PAIR_FROM = 10;
const SIDE = 4;
/** A band this many times wider than deep reads as a corridor, not a room: it is split in two instead. */
const THIN = 2.5;
/** Jobs a bank can have more than one room for, and how many: the loan officers' offices, the files, the meetings. */
export const REPEATABLE: Partial<Record<RoomType, number>> = { staffOffice: Infinity, recordsRoom: 2, conferenceRoom: 2 };

const ratio = (p: number, q: number) => Math.max(p, q) / Math.min(p, q);

/** Whether `span` by `depth` is within the type's most area (types without one take any). */
const fits = (type: RoomType, span: number, depth: number) => span * depth <= (ROOM_RULES[type].area?.max ?? Infinity);

/** Of `types` that `ok` allows and the bank may have another of (`REPEATABLE`), those it has fewest of first, then best first. */
function extrasFor(ctx: Ctx, types: RoomType[], ok: (t: RoomType) => boolean): RoomType[] {
    const count = (t: RoomType) => ctx.used.get(t) ?? 0;
    return types.filter(t => ok(t) && count(t) < (REPEATABLE[t] ?? 1)).sort((a, b) => count(a) - count(b));
}

/** Counts a room of type `t` into the bank. */
const use = (ctx: Ctx, t: RoomType) => ctx.used.set(t, (ctx.used.get(t) ?? 0) + 1);

/**
 * Two rooms side by side across a band `w` wide, at one of `depths`: the split that keeps both nearest their target
 * areas and nearest square, within their most areas.
 */
function pairDims(w: number, depths: number[], inner: RoomType, outer: RoomType): { depth: number; span: number } | undefined {
    const a = ROOM_RULES[inner].area, b = ROOM_RULES[outer].area;
    let best: { depth: number; span: number; cost: number } | undefined;
    for (const d of depths) for (let si = SIDE; si <= w - SIDE; si++) {
        if (!fits(inner, si, d) || !fits(outer, w - si, d)) continue;
        const off = (a ? Math.abs(si * d - a.target) / a.target : 0) + (b ? Math.abs((w - si) * d - b.target) / b.target : 0);
        const cost = off + 0.4 * (ratio(si, d) + ratio(w - si, d) - 2);
        if (!best || cost < best.cost) best = { depth: d, span: si, cost };
    }
    return best;
}

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

/**
 * The band for one of a program's rooms: the full width at its target area, or, where that is too big or too thin,
 * two rooms side by side: the room on the inner side with an extra one beyond it that opens onto it (or onto what
 * lies beyond), else the room beyond an extra one it can open onto.
 */
function bandFor(ctx: Ctx, want: Want, w: number, strip: Strip, extra: Extra, least = want.min): Band | undefined {
    const area = ROOM_RULES[want.type].area;
    if (!area) return { depth: Math.max(least, want.size ?? least), min: least, rooms: [{ type: want.type, span: w }] };
    const most = Math.floor(area.max / w), full = Math.max(least, Math.min(most, Math.round(area.target / w)));
    const fitsFull = most >= least;
    if (w >= 2 * SIDE && (!fitsFull || (w >= PAIR_FROM && w / full > THIN))) {
        const depths = range(Math.max(3, least), 8);
        for (const outer of extrasFor(ctx, extra.types, t => opensOnto(t, want.type) || (extra.outerAccess ?? []).some(a => opensOnto(t, a)))) {
            const beside = pairDims(w, depths, want.type, outer);
            if (!beside) continue;
            use(ctx, outer);
            return { depth: beside.depth, min: least, rooms: [{ type: want.type, span: beside.span }, { type: outer, span: w - beside.span }] };
        }
        for (const inner of extrasFor(ctx, extra.types, t => strip.access.some(a => opensOnto(t, a)) && opensOnto(want.type, t))) {
            const behind = pairDims(w, depths, inner, want.type);
            if (!behind) continue;
            use(ctx, inner);
            return { depth: behind.depth, min: least, rooms: [{ type: inner, span: behind.span }, { type: want.type, span: w - behind.span }] };
        }
    }
    return fitsFull ? { depth: full, min: least, rooms: [{ type: want.type, span: w }] } : undefined;
}

/**
 * An extra band where `left` tiles along the strip are to spare: a room with a job that can open onto the strip's
 * inner side, the full width, or with a second beside it in a wide strip. It takes all that is left when less than
 * a room would be left after it.
 */
function extraBand(ctx: Ctx, w: number, left: number, strip: Strip, extra: Extra, least = 3): Band | undefined {
    const settle = (d: number) => (left - d > 0 && left - d < 3 ? [left, left - 3] : [d]).filter(x => x >= least && x <= left);
    for (const first of extrasFor(ctx, extra.types, t => strip.access.some(a => opensOnto(t, a)))) {
        const area = ROOM_RULES[first].area!;
        if (w < PAIR_FROM && Math.floor(area.max / w) >= 3) {
            const d = Math.min(left, Math.max(least, Math.min(Math.floor(area.max / w), Math.round(area.target / w))));
            const depth = settle(d).find(x => fits(first, w, x));
            if (depth === undefined) continue;
            use(ctx, first);
            return { depth, min: least, rooms: [{ type: first, span: w }] };
        }
        if (w < 2 * SIDE) continue;
        use(ctx, first);
        for (const second of extrasFor(ctx, extra.types, t => opensOnto(t, first) || (extra.outerAccess ?? []).some(a => opensOnto(t, a)))) {
            const best = pairDims(w, range(least, Math.max(least, Math.min(left, 7))), first, second);
            for (const d of best ? settle(best.depth) : []) {
                const dims = pairDims(w, [d], first, second);
                if (!dims) continue;
                use(ctx, second);
                return { depth: d, min: least, rooms: [{ type: first, span: dims.span }, { type: second, span: w - dims.span }] };
            }
        }
        ctx.used.set(first, ctx.used.get(first)! - 1);
    }
    return undefined;
}

/**
 * Deepens a band by a tile if its rooms stay within their most areas, moving the split between two side by side if
 * that is what it takes.
 */
function deepen(band: Band, w: number): boolean {
    const d = band.depth + 1, [p, q] = band.rooms;
    if (!q) {
        if (!fits(p!.type, p!.span, d)) return false;
    } else {
        const spans = range(SIDE, w - SIDE).sort((a, b) => Math.abs(a - p!.span) - Math.abs(b - p!.span));
        const span = spans.find(si => fits(p!.type, si, d) && fits(q.type, w - si, d));
        if (span === undefined) return false;
        p!.span = span;
        q.span = w - span;
    }
    band.depth = d;
    return true;
}

/**
 * Fills a strip with a program: the `wants` in order along it, each at its target area, and extra rooms with jobs
 * where space is left (`extra`), rather than stretching one room to fill it. Optional wants are left out, the last
 * first, while the rest don't fit; undefined when the required ones don't, or the space can't be shared out within the
 * rooms' most areas.
 */
function program(ctx: Ctx, strip: Strip, wing: Wing, wants: Want[], extra: Extra, raised = false): Piece[] | undefined {
    const used = new Map(ctx.used);
    for (let kept = [...wants]; ;) {
        const pieces = fill(ctx, strip, wing, kept, extra, raised);
        if (pieces) return pieces;
        const i = kept.map(r => !r.required).lastIndexOf(true);
        if (i < 0) return undefined;
        kept = kept.filter((_, k) => k !== i);
        ctx.used = new Map(used);
    }
}

/** One try at a program with the wants it keeps; `layoutFailure` says why it didn't fit. */
function fill(ctx: Ctx, strip: Strip, wing: Wing, kept: Want[], extra: Extra, raised: boolean): Piece[] | undefined {
    const L = strip.along === 'y' ? strip.h : strip.w, w = strip.along === 'y' ? strip.w : strip.h;
    const fail = (why: string) => {
        layoutFailure = `${wing} program ${kept.map(r => r.type).join('/')} in ${w} across, ${L} along: ${why}`;
        return undefined;
    };
    if (kept.reduce((s, r) => s + r.min, 0) > L) return fail('the rooms are too deep');
    for (const want of kept) use(ctx, want.type);
    // The first band reaches as far as its door needs (past the stairs, past the counter to the gallery).
    const at = Math.min(extra.at, kept.length), need = extra.firstMin ?? 0;
    const own: Band[] = [];
    for (const [i, want] of kept.entries()) {
        const band = bandFor(ctx, want, w, strip, extra, i === 0 && at > 0 ? Math.max(want.min, need) : want.min);
        if (!band) return fail(`no band for the ${want.type}`);
        own.push(band);
    }
    // Squeeze the bands towards their least depth, the last first, until they fit.
    let left = L - own.reduce((s, b) => s + b.depth, 0);
    for (let i = own.length - 1; i >= 0 && left < 0; i--) {
        const cut = Math.min(-left, own[i]!.depth - own[i]!.min);
        own[i]!.depth -= cut;
        left += cut;
    }
    if (left < 0) return fail('the rooms are too deep');
    const extras: Band[] = [];
    while (left >= 3) {
        const band = extraBand(ctx, w, left, strip, extra, !extras.length && at === 0 ? Math.max(3, need) : 3);
        if (!band) break;
        extras.push(band);
        left -= band.depth;
    }
    let bands = [...own.slice(0, at), ...extras, ...own.slice(at)];
    if (!bands.length) return left ? fail('nothing to fill it') : [];
    // Should the first band still be short of its door, it takes what is left, or depth from the bands after it.
    const first = bands[0]!, short = "the first room can't reach its door";
    for (; first.depth < need && left > 0; left--) if (!deepen(first, w)) return fail(short);
    for (let i = bands.length - 1; i > 0 && first.depth < need; i--) {
        while (first.depth < need && bands[i]!.depth > bands[i]!.min) {
            if (!deepen(first, w)) return fail(short);
            bands[i]!.depth--;
        }
    }
    if (first.depth < need) return fail(short);
    // A tile or two left over goes to the bands that can take it within their most areas, the extra rooms first; when
    // none can, the bands that can spare it give up what one more room needs.
    const order = [...extras, ...[...own].reverse()];
    for (let squeezed = false; left > 0;) {
        const band = order.find(b => deepen(b, w));
        if (band) {
            left--;
            order.push(...order.splice(order.indexOf(band), 1));
            continue;
        }
        if (squeezed) return fail(`${left} left over`);
        squeezed = true;
        const given: [Band, number][] = [];
        for (let i = bands.length - 1, want = 3 - left; i >= (need ? 1 : 0) && want > 0; i--) {
            const give = Math.min(want, bands[i]!.depth - bands[i]!.min);
            if (give <= 0) continue;
            bands[i]!.depth -= give;
            want -= give;
            given.push([bands[i]!, give]);
        }
        const more = given.reduce((s, [, g]) => s + g, 0) + left === 3 ? extraBand(ctx, w, 3, strip, extra) : undefined;
        if (!more) {
            for (const [b, g] of given) b.depth += g;
            return fail(`${left} left over after ${bands.map(b => `${b.rooms.map(r => `${r.type} ${r.span}`).join(' | ')} × ${b.depth}`).join(', ')}`);
        }
        extras.push(more);
        bands = [...own.slice(0, at), ...extras, ...own.slice(at)];
        left = 0;
    }
    const pieces: Piece[] = [];
    let u = 0;
    for (const band of bands) {
        let v = 0;
        for (const room of band.rooms) {
            const across = strip.inner === 'low' ? v : w - v - room.span;
            pieces.push(strip.along === 'y'
                ? piece(room.type, strip.x + across, strip.y + u, room.span, band.depth, wing, raised ? { raised } : {})
                : piece(room.type, strip.x + u, strip.y + across, band.depth, room.span, wing, raised ? { raised } : {}));
            v += room.span;
        }
        u += band.depth;
    }
    return pieces;
}

interface Ctx {
    rng: Rng;
    tier: Tier;
    W: number;
    D: number;
    oldBank: boolean;
    /** How many rooms of each type the bank has so far, so extra rooms are different jobs where they can be. */
    used: Map<RoomType, number>;
}

/** Extra rooms by where they go, best first: offices along a wing, a counting room by the vault or behind the counter. */
const WING_EXTRAS: RoomType[] = ['staffOffice', 'conferenceRoom', 'recordsRoom'];
const CORE_EXTRAS: RoomType[] = ['countingRoom', 'recordsRoom'];
const MIDDLE_EXTRAS: RoomType[] = ['countingRoom', 'conferenceRoom', 'staffOffice', 'recordsRoom'];

/**
 * The back band: the vault against the back wall, its antechamber (and a mantrap) in front of it, then secure closets
 * on one side and the service end on the other; the vault corridor runs across the lot in front of it all.
 */
function backBand(ctx: Ctx, vx: number, vw: number): { pieces: Piece[]; hb: number } | undefined {
    const { rng, tier, W } = ctx;
    const spec = TIER_SPECS[tier];
    const vd = tier === 'small' ? 4 : 5, ad = 3, hb = vd + ad;
    const pieces: Piece[] = [piece('vault', vx, 0, vw, vd, 'core')];
    if (spec.mantrap) {
        const left = rng.chance(0.5);
        pieces.push(piece('mantrap', left ? vx : vx + vw - 2, vd, 2, ad, 'core'));
        pieces.push(piece('antechamber', left ? vx + 2 : vx, vd, vw - 2, ad, 'core'));
    } else pieces.push(piece('antechamber', vx, vd, vw, ad, 'core'));
    // West of the vault: the alarm closet and, from the city branch up, the server room; space to spare becomes a
    // counting room beside the vault, or the records.
    const wants: Want[] = [{ type: 'alarmCloset', min: 4, required: true }, ...(tier === 'small' ? [] : [{ type: 'serverRoom' as const, min: 4 }])];
    const west = program(ctx, { x: 0, y: 0, w: vx, h: hb, along: 'x', inner: 'high', access: ['staffCorridor'] }, 'back', wants, { at: wants.length, types: CORE_EXTRAS });
    if (!west) return undefined;
    pieces.push(...west);
    // East of it: the deposit boxes beside the antechamber, then the service end with the back door.
    const ex = vx + vw, eastW = W - ex;
    if (tier === 'small') pieces.push(piece('staffCorridor', ex, 0, eastW, hb, 'back'));
    else {
        const boxes = Math.max(4, Math.min(8, eastW - 6));
        pieces.push(piece('depositBoxes', ex, 0, boxes, hb, 'core'));
        pieces.push(piece('loadingBay', ex + boxes, 0, eastW - boxes, hb, 'back'));
    }
    pieces.push(piece('staffCorridor', 0, hb, W, 2, 'back'));
    return { pieces, hb };
}

/** The vault's width by tier, and where it stands: in the middle, nudged. */
function vaultSpan(ctx: Ctx, from: number, to: number): [number, number] {
    const vw = ctx.tier === 'small' ? 8 : ctx.tier === 'city' ? 10 : 12;
    const mid = Math.round((from + to - vw) / 2) + ctx.rng.int(-2, 2);
    return [Math.max(from + 7, Math.min(to - vw - 9, mid)), vw];
}

/** The lobby's depth and the band left between it and the vault corridor for middle rooms. */
function frontDepths(ctx: Ctx, top: number): { mb: number; ld: number } {
    const room = ctx.D - top - 3;
    let ld = Math.min(room, ctx.rng.int(8, 11));
    let mb = room - ld;
    if (mb > 0 && mb < 4) { ld += mb; mb = 0; }
    return { mb, ld };
}

/**
 * Two Wing: public and service routes both reach the vault corridor. A wing either side of the lobby, each with its own
 * corridor along the lobby, meeting the vault corridor at the back: the lobby opens into one of them, the teller line
 * into both, so there are two ways from the public floor to the secure core.
 *
 * Three Keys moves the manager's office to the front of its wing, as far from the CCTV room as the lot allows; Mezzanine
 * Watch lifts the CCTV room onto a mezzanine behind the teller line, behind glass, reached by stairs from it.
 */
function twoWing(ctx: Ctx, variant: 'twoWing' | 'threeKeys' | 'mezzanineWatch'): Layout | undefined {
    const { rng, tier, W, D } = ctx, spec = TIER_SPECS[tier];
    const [vx, vw] = vaultSpan(ctx, 0, W);
    const back = backBand(ctx, vx, vw);
    if (!back) return undefined;
    const { pieces, hb } = back;
    const top = hb + 2;
    const lw = Math.min(W - 16, rng.int(14, 18)), ww = Math.floor((W - lw) / 2), cw = W - 2 * ww;
    const mezzanine = variant === 'mezzanineWatch';
    if (mezzanine && !spec.operator) return undefined;
    let { mb } = frontDepths(ctx, top);
    // The mezzanine needs a band behind the teller line, three steps deep at least.
    if (mezzanine && mb < 4) mb = 4;
    if (D - top - mb - 3 < 7) return undefined;
    const tellerY = top + mb, lobbyY = tellerY + 3;
    const rw = ww - 2;
    // The restrooms across the front of the west wing, shallower the wider the wing, so they stay restrooms, not a hall.
    const restH = Math.max(3, Math.min(5, Math.round(30 / ww) + rng.int(0, 1)));
    const managerFront = variant === 'threeKeys';
    // The west wing: rooms along the outside, its corridor along the lobby, the restrooms across the front.
    // The east wing: the CCTV room in another wing than the vault, the break room, the ATM room on the front. The
    // room at the top of a wing touches the vault corridor, so the CCTV room never goes there (§17.7).
    // The break room goes in the middle band when there is one (beside the mezzanine's CCTV room and stairs, when
    // there is room left there), and the wings get the cleaner's closet instead.
    const breakInMiddle = mezzanine ? cw - 2 - Math.min(8, cw - 6) >= 4 : mb >= 4;
    const westWants: Want[] = [{ type: 'managerOffice', min: 4, required: true }, ...(breakInMiddle ? [] : [{ type: 'cleanersCloset' as const, min: 3 }])];
    if (managerFront) westWants.reverse();
    const wingStrip = (x: number, h: number, inner: Strip['inner']): Strip => ({ x, y: top, w: rw, h, along: 'y', inner, access: ['staffCorridor'] });
    const west = program(ctx, wingStrip(0, D - restH - top, 'high'), 'west', westWants, { at: managerFront ? westWants.length - 1 : 1, types: WING_EXTRAS });
    const eastWants: Want[] = [
        breakInMiddle ? { type: 'cleanersCloset', min: 3, required: true } : { type: 'breakRoom', min: 4, required: true },
        ...(spec.operator && !mezzanine ? [{ type: 'cctvRoom' as const, min: 4, required: true }] : []),
        { type: 'atmRoom', min: 3 }
    ];
    const east = program(ctx, wingStrip(W - rw, D - top, 'low'), 'east', eastWants, { at: eastWants.length - 1, types: WING_EXTRAS });
    if (!west || !east) return undefined;
    pieces.push(...west, ...east);
    pieces.push(piece('restroom', 0, D - restH, ww, restH, 'west'));
    const westCorridor = pieces.push(piece('staffCorridor', rw, top, 2, D - restH - top, 'west')) - 1;
    const eastCorridor = pieces.push(piece('staffCorridor', W - ww, top, 2, D - top, 'east')) - 1;
    const links: Layout['links'] = [];
    const teller = pieces.push(piece('tellerLine', ww, tellerY, cw, 3, 'front')) - 1;
    if (mezzanine) {
        // Behind the teller line: the stairs up from it, the raised CCTV room looking over it, the break room beside.
        // In a deep band the raised rooms keep to the front, and rooms off the vault corridor take the space behind.
        const cctvW = Math.min(8, cw - 6), stairsX = ww + rng.int(0, 1) * (cw - 2);
        const cctvX = stairsX === ww ? ww + 2 : ww + cw - 2 - cctvW;
        const md = mb >= 7 ? Math.min(rng.int(5, 6), mb - 3) : mb, front = top + mb - md;
        const stairs = pieces.push(piece('stairwell', stairsX, front, 2, md, 'mezzanine', { stairs: { x: stairsX, y: top + mb - 3, w: 2, h: 3 }, raised: true })) - 1;
        pieces.push(piece('cctvRoom', cctvX, front, cctvW, md, 'mezzanine', { raised: true }));
        if (front > top) {
            const behind = program(ctx, { x: Math.min(stairsX, cctvX), y: top, w: 2 + cctvW, h: front - top, along: 'x', inner: 'low', access: ['staffCorridor'] }, 'centre', [], { at: 0, types: MIDDLE_EXTRAS });
            if (!behind?.length) return undefined;
            pieces.push(...behind);
        }
        const restX = stairsX === ww ? cctvX + cctvW : ww, restW = cw - 2 - cctvW;
        if (restW >= 4) {
            const rest = program(ctx, { x: restX, y: top, w: restW, h: mb, along: 'y', inner: restX === ww ? 'low' : 'high', access: ['staffCorridor'] }, 'centre',
                [{ type: 'breakRoom', min: 4, required: true }], { at: 1, types: MIDDLE_EXTRAS });
            if (!rest) return undefined;
            pieces.push(...rest);
        } else if (restW > 0) pieces.push(piece('staffCorridor', restX, top, restW, mb, 'centre'));
        links.push({ a: stairs, b: teller, lock: 'none' });
    } else if (mb >= 4) {
        const middle = program(ctx, { x: ww, y: top, w: cw, h: mb, along: 'x', inner: 'low', access: ['staffCorridor'] }, 'centre',
            [{ type: 'breakRoom', min: 4, required: true }], { at: rng.int(0, 1), types: MIDDLE_EXTRAS, outerAccess: ['tellerLine'] });
        if (!middle) return undefined;
        pieces.push(...middle);
    }
    const lobby = pieces.push(piece('lobby', ww, lobbyY, cw, D - lobbyY, 'front')) - 1;
    links.push({ a: lobby, b: rng.chance(0.5) ? eastCorridor : westCorridor, lock: 'keycard' });
    return finish({ width: W, depth: D, pieces, links });
}

/**
 * Atrium: a big central lobby ringed by offices that open onto it, and a mezzanine along one side reached by stairs
 * from the floor, under a glass roof. Staff cross the public floor to get anywhere, which makes it a social-stealth
 * bank; an office's back door onto the vault corridor closes the second loop.
 */
function atrium(ctx: Ctx): Layout | undefined {
    const { rng, tier, W, D } = ctx, spec = TIER_SPECS[tier];
    const [vx, vw] = vaultSpan(ctx, 0, W);
    const back = backBand(ctx, vx, vw);
    if (!back) return undefined;
    const { pieces, hb } = back;
    const top = hb + 2;
    // The wings widen on a big lot so the lobby stays about 16 to 20 tiles across (§17.3).
    const ow = Math.max(rng.int(6, 8), Math.ceil((W - 20) / 2)), cw = W - 2 * ow;
    if (cw < 16) return undefined;
    const lobbyY = top + 3;
    if (D - lobbyY < 8) return undefined;
    // The mezzanine: a raised gallery along one side of the lobby, its stairs at its front end, rising to it. The
    // offices on that side are upstairs too and open off the gallery; the restrooms below them open onto the floor.
    const side = rng.chance(0.5) ? 'west' : 'east', mw = 2, mh = rng.int(3, Math.max(3, Math.min(7, D - lobbyY - 5)));
    const upTo = lobbyY + mh, ox = side === 'west' ? 0 : W - ow, gx = side === 'west' ? ow : ow + cw - mw;
    const other = side === 'west' ? 'east' : 'west';
    const wing = (x: number, y: number, h: number, inner: Strip['inner'], access: RoomType): Strip => ({ x, y, w: ow, h, along: 'y', inner, access: [access] });
    const inward = side === 'west' ? 'high' : 'low', outward = side === 'west' ? 'low' : 'high';
    // Upstairs, the first room reaches past the teller line to the gallery; downstairs, past the stairs to the floor.
    const upstairs = program(ctx, wing(ox, top, upTo - top, inward, 'mezzanine'), side, [{ type: 'managerOffice', min: 4, required: true }, { type: 'cleanersCloset', min: 3 }],
        { at: 1, types: ['conferenceRoom', 'recordsRoom', 'staffOffice'], firstMin: lobbyY - top + 2 }, true);
    const below = program(ctx, wing(ox, upTo, D - upTo, inward, 'lobby'), side, [{ type: 'restroom', min: 3, required: true }], { at: 0, types: WING_EXTRAS, firstMin: 4 });
    const ground = program(ctx, wing(side === 'west' ? W - ow : 0, top, D - top, outward, 'lobby'), other, [
        { type: 'breakRoom', min: 4, required: true },
        ...(spec.operator ? [{ type: 'cctvRoom' as const, min: 4, required: true }] : []),
        { type: 'atmRoom', min: 3 }
    ], { at: spec.operator ? 2 : 1, types: WING_EXTRAS });
    if (!upstairs || !below || !ground) return undefined;
    pieces.push(...upstairs, ...below, ...ground);
    pieces.push(piece('tellerLine', ow, top, cw, 3, 'front'));
    pieces.push(piece('mezzanine', gx, lobbyY, mw, mh, 'mezzanine', { raised: true }));
    const stairs = pieces.push(piece('stairwell', gx, upTo, mw, 3, 'mezzanine', { stairs: { x: gx, y: upTo, w: mw, h: 3 } })) - 1;
    const lobby = pieces.push(piece('lobby', side === 'west' ? ow + mw : ow, lobbyY, cw - mw, mh + 3, 'front')) - 1;
    const front = pieces.push(piece('lobby', ow, upTo + 3, cw, D - upTo - 3, 'front')) - 1;
    // The break room at the top of the ground-floor wing opens onto the vault corridor (its own rule) and onto the
    // lobby too: the second way from the floor to the core.
    const backOffice = pieces.findIndex(p => p.wing === other && p.y === top);
    const links: Layout['links'] = [{ a: stairs, b: front, lock: 'none' }, { a: lobby, b: front, lock: 'none' }, { a: backOffice, b: lobby, lock: 'keycard' }];
    const l = pieces[front]!;
    return finish({ width: W, depth: D, pieces, links, skylight: { x: l.x + Math.floor(l.w / 2) - 1, y: lobbyY + Math.floor((D - lobbyY) / 2) - 1 } });
}

/**
 * Fortress: one hardened core with many breachable outer walls. The secure rooms sit together in a concrete block at
 * the back middle, entered through the mantrap (or one keycard door); a ring corridor runs round the core, and the
 * offices along the outside have soft exterior walls.
 */
function fortress(ctx: Ctx): Layout | undefined {
    const { rng, tier, W, D } = ctx, spec = TIER_SPECS[tier];
    const vw = tier === 'small' ? 8 : tier === 'city' ? 10 : 12, vd = tier === 'small' ? 4 : 5;
    const ow = rng.int(6, 8), ring = 2;
    const coreX = ow + ring, coreW = W - 2 * (ow + ring);
    // The vault in the middle of the core, nudged, leaving room for a room beside it (the alarm closet or the server
    // room west, the deposit boxes east), never a sliver.
    const free = coreW - vw, mid = Math.floor(free / 2);
    const sides = (west: number) => west >= SIDE && west <= free && (free - west === 0 || free - west >= (spec.operator ? SIDE : 2));
    const near = [mid - 1, mid, mid + 1].filter(sides), wests = near.length ? near : [SIDE, free].filter(sides);
    if (!wests.length) return undefined;
    const vx = coreX + rng.pick(wests);
    const coreH = vd + 3;
    const pieces: Piece[] = [piece('vault', vx, 0, vw, vd, 'core')];
    if (spec.mantrap) {
        const left = rng.chance(0.5);
        pieces.push(piece('mantrap', left ? vx : vx + vw - 2, vd, 2, 3, 'core'), piece('antechamber', left ? vx + 2 : vx, vd, vw - 2, 3, 'core'));
    } else pieces.push(piece('antechamber', vx, vd, vw, 3, 'core'));
    // The rest of the core block beside the vault, behind the same walls: space to spare there is a counting room.
    const core = (x: number, w: number, type: RoomType, at: number): Piece[] | undefined =>
        program(ctx, { x, y: 0, w, h: coreH, along: 'x', inner: 'high', access: ['staffCorridor'] }, 'core', [{ type, min: SIDE, required: true }], { at, types: CORE_EXTRAS });
    const coreWest = core(coreX, vx - coreX, spec.operator ? 'serverRoom' : 'alarmCloset', 1);
    const coreEast = spec.operator ? core(vx + vw, coreX + coreW - vx - vw, 'depositBoxes', 1) : [piece('staffCorridor', vx + vw, 0, coreX + coreW - vx - vw, coreH, 'core')];
    if (!coreWest || !coreEast) return undefined;
    pieces.push(...coreWest, ...coreEast);
    const cw = W - 2 * ow;
    const tellerY = Math.max(coreH + ring + 4, D - rng.int(11, 13));
    // The ring: corridors down both sides of the core to the teller line, and across the front of the core.
    pieces.push(piece('staffCorridor', ow, 0, ring, tellerY, 'west'), piece('staffCorridor', W - ow - ring, 0, ring, tellerY, 'east'));
    pieces.push(piece('staffCorridor', coreX, coreH, coreW, ring, 'centre'));
    const top = coreH + ring;
    if (tellerY - top < 4) return undefined;
    // Between the core and the counter: the break room (and, with the alarm closet in the core, the cleaner's
    // closet), and more rooms with jobs where there is space, a counting room among them, opening onto the counter.
    const centre = program(ctx, { x: coreX, y: top, w: coreW, h: tellerY - top, along: 'x', inner: 'low', access: ['staffCorridor'] }, 'centre',
        [{ type: 'breakRoom', min: 4, required: true }, ...(spec.operator ? [{ type: 'cleanersCloset' as const, min: 3 }] : [])],
        { at: 1, types: ['conferenceRoom', 'staffOffice', 'countingRoom', 'recordsRoom'], outerAccess: ['tellerLine'] });
    // Outside the ring: the alarm closet (in the core when there is no server room) and the loading bay at the back
    // corners, offices down the sides.
    const side = (x: number, inner: Strip['inner']): Strip => ({ x, y: 0, w: ow, h: D, along: 'y', inner, access: ['staffCorridor', 'tellerLine', 'lobby'] });
    const westRooms = program(ctx, side(0, 'high'), 'west', [
        spec.operator ? { type: 'alarmCloset', min: 4, required: true } : { type: 'cleanersCloset', min: 3 },
        { type: 'managerOffice', min: 4, required: true },
        { type: 'restroom', min: 4, required: true }
    ], { at: 2, types: WING_EXTRAS });
    const eastRooms = program(ctx, side(W - ow, 'low'), 'east', [
        { type: tier === 'small' ? 'staffCorridor' : 'loadingBay', min: 5, size: 6, required: true },
        ...(spec.operator ? [{ type: 'cctvRoom' as const, min: 4, required: true }] : []),
        { type: 'atmRoom', min: 3 }
    ], { at: spec.operator ? 2 : 1, types: WING_EXTRAS });
    if (!centre || !westRooms || !eastRooms) return undefined;
    pieces.push(...centre, ...westRooms, ...eastRooms);
    pieces.push(piece('tellerLine', ow, tellerY, cw, 3, 'front'));
    pieces.push(piece('lobby', ow, tellerY + 3, cw, D - tellerY - 3, 'front'));
    return finish({ width: W, depth: D, pieces, links: [] });
}

/** Drops pieces of zero size; the links index the pieces as they were, so they are moved along. */
function finish(layout: Layout): Layout {
    const keep = layout.pieces.map(p => p.w > 0 && p.h > 0), index = new Map<number, number>();
    let n = 0;
    keep.forEach((k, i) => k && index.set(i, n++));
    return {
        ...layout,
        pieces: layout.pieces.filter((_, i) => keep[i]),
        links: layout.links.filter(l => index.has(l.a) && index.has(l.b)).map(l => ({ ...l, a: index.get(l.a)!, b: index.get(l.b)! }))
    };
}

/** Why the last layout failed, for debugging. */
export let layoutFailure = '';

/** Lays out a bank of the tier and archetype in a lot `W` by `D`; undefined when this roll doesn't work out. */
export function layoutBank(rng: Rng, tier: Tier, archetype: Archetype, W: number, D: number, oldBank: boolean): Layout | undefined {
    const ctx: Ctx = { rng, tier, W, D, oldBank, used: new Map() };
    layoutFailure = `${archetype}: the lot is too small for it`;
    const layout = archetype === 'atrium' ? atrium(ctx) : archetype === 'fortress' ? fortress(ctx) : twoWing(ctx, archetype);
    if (!layout) return undefined;
    // Mirror half the banks east to west, so wings and closets swap sides.
    if (rng.chance(0.5)) mirror(layout);
    if (overlapsOrGaps(layout)) {
        layoutFailure = `${archetype}: rooms overlap or leave gaps (${layout.pieces.map(p => `${p.type}@${p.x},${p.y} ${p.w}x${p.h}`).join(' ')})`;
        return undefined;
    }
    const closed = doorless(layout);
    if (closed) {
        layoutFailure = `${archetype}: ${closed}`;
        return undefined;
    }
    reshape(layout, rng.fork('shapes'));
    return layout;
}

function mirror(layout: Layout): void {
    const W = layout.width;
    for (const p of layout.pieces) {
        p.x = W - p.x - p.w;
        for (const part of p.parts ?? []) part.x = W - part.x - part.w;
        if (p.stairs) p.stairs.x = W - p.stairs.x - p.stairs.w;
        p.wing = p.wing === 'west' ? 'east' : p.wing === 'east' ? 'west' : p.wing;
    }
    if (layout.skylight) layout.skylight.x = W - layout.skylight.x - 2;
}

/** Which piece each tile of the lot is in (-1 for none), from the pieces' parts. */
export function ownerGrid(layout: Layout): Int16Array {
    const grid = new Int16Array(layout.width * layout.depth).fill(-1);
    layout.pieces.forEach((p, i) => {
        for (const r of partsOf(p)) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) grid[y * layout.width + x] = i;
    });
    return grid;
}

/** True unless the pieces tile the lot exactly: every tile in one room, none in two. */
function overlapsOrGaps(layout: Layout): boolean {
    const seen = new Uint8Array(layout.width * layout.depth);
    for (const p of layout.pieces) for (const r of partsOf(p)) {
        if (r.x < 0 || r.y < 0 || r.x + r.w > layout.width || r.y + r.h > layout.depth) return true;
        // Stairs lie inside the room they climb out of; the stairwell piece is that room.
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
            const i = y * layout.width + x;
            if (seen[i]) return true;
            seen[i] = 1;
        }
    }
    return seen.some(v => v !== 1);
}

/**
 * Edges a door could stand on between each pair of pieces, keyed `a b` (both ways): neighbouring tiles on one level,
 * neither of them stairs. Open pairs meet along any edge, stairs or not.
 */
export function sharedEdges(layout: Layout, grid: Int16Array): Map<string, number> {
    const { width: W, depth: D, pieces } = layout, stairs = new Uint8Array(W * D), out = new Map<string, number>();
    for (const p of pieces) if (p.stairs) for (let y = p.stairs.y; y < p.stairs.y + p.stairs.h; y++) for (let x = p.stairs.x; x < p.stairs.x + p.stairs.w; x++) stairs[y * W + x] = 1;
    const add = (k: string) => out.set(k, (out.get(k) ?? 0) + 1);
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        if (x + dx >= W || y + dy >= D) continue;
        const i = grid[y * W + x]!, j = grid[(y + dy) * W + x + dx]!;
        if (i === j || i < 0 || j < 0) continue;
        const a = pieces[i]!, b = pieces[j]!;
        const door = !!a.raised === !!b.raised && !stairs[y * W + x] && !stairs[(y + dy) * W + x + dx];
        if (door || isOpenPair(a.type, b.type)) { add(`${i} ${j}`); add(`${j} ${i}`); }
    }
    return out;
}

/**
 * Why a layout can't have its doors, if it can't: a room that touches none of the rooms its rules let it open onto, or
 * an archetype link between rooms that don't meet. `bankDoors` would find the same later; finding it here is cheaper.
 */
export function doorless(layout: Layout, grid = ownerGrid(layout)): string | undefined {
    const shared = sharedEdges(layout, grid), { pieces } = layout;
    for (const [i, p] of pieces.entries()) {
        if (!ROOM_RULES[p.type].opensOnto.length) continue;
        if (!pieces.some((q, j) => shared.has(`${i} ${j}`) && opensOnto(p.type, q.type))) return `${p.type} at ${p.x},${p.y} can't open onto ${ROOM_RULES[p.type].opensOnto.join('/')}`;
    }
    for (const l of layout.links) if (!shared.has(`${l.a} ${l.b}`)) return `link ${pieces[l.a]!.type}-${pieces[l.b]!.type} doesn't meet`;
    return undefined;
}
