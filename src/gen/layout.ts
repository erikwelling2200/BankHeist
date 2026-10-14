import type { Archetype, Rect, RoomType, Tier, Wing } from './model';
import type { Rng } from './rng';
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
 */

export interface Piece extends Rect {
    type: RoomType;
    wing: Wing;
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

interface Stacked { type: RoomType; min: number; pref: number; required?: boolean; stretch?: boolean }

/**
 * Stacks rooms down a column from y0 to y1, each at its preferred height; the room marked `stretch` (else the last)
 * takes up what is left. Optional rooms that don't fit are left out; when a required one doesn't, the stack fails.
 */
function stack(x: number, y0: number, y1: number, w: number, wing: Wing, rooms: Stacked[]): Piece[] | undefined {
    const room = y1 - y0;
    // Drop optional rooms, last first, until the minimums fit.
    const kept = [...rooms];
    while (kept.reduce((s, r) => s + r.min, 0) > room) {
        const i = kept.map(r => !r.required).lastIndexOf(true);
        if (i < 0) return undefined;
        kept.splice(i, 1);
    }
    if (!kept.length) return [];
    const heights = kept.map(r => r.min);
    let left = room - heights.reduce((s, h) => s + h, 0);
    kept.forEach((r, i) => {
        const more = Math.min(left, r.pref - r.min);
        heights[i]! += more;
        left -= more;
    });
    const stretch = Math.max(0, kept.findIndex(r => r.stretch));
    heights[kept.some(r => r.stretch) ? stretch : kept.length - 1]! += left;
    let y = y0;
    return kept.map((r, i) => {
        const p = piece(r.type, x, y, w, heights[i]!, wing);
        y += heights[i]!;
        return p;
    });
}

interface Ctx { rng: Rng; tier: Tier; W: number; D: number; oldBank: boolean }

/**
 * The back band: the vault against the back wall, its antechamber (and a mantrap) in front of it, then secure closets
 * on one side and the service end on the other; the vault corridor runs across the lot in front of it all.
 */
function backBand(ctx: Ctx, vx: number, vw: number): { pieces: Piece[]; hb: number } {
    const { rng, tier, W } = ctx, spec = TIER_SPECS[tier];
    const vd = tier === 'small' ? 4 : 5, ad = 3, hb = vd + ad;
    const pieces: Piece[] = [piece('vault', vx, 0, vw, vd, 'core')];
    if (spec.mantrap) {
        const left = rng.chance(0.5);
        pieces.push(piece('mantrap', left ? vx : vx + vw - 2, vd, 2, ad, 'core'));
        pieces.push(piece('antechamber', left ? vx + 2 : vx, vd, vw - 2, ad, 'core'));
    } else pieces.push(piece('antechamber', vx, vd, vw, ad, 'core'));
    // West of the vault: the alarm closet and, from the city branch up, the server room.
    const west = tier === 'small' ? [{ type: 'alarmCloset' as const, w: vx }] : [{ type: 'alarmCloset' as const, w: Math.min(6, Math.max(4, Math.floor(vx / 2))) }, { type: 'serverRoom' as const, w: 0 }];
    let x = 0;
    for (const [i, r] of west.entries()) {
        const w = i === west.length - 1 ? vx - x : r.w;
        if (w < 3) continue;
        pieces.push(piece(r.type, x, 0, w, hb, 'back'));
        x += w;
    }
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
    const { pieces, hb } = backBand(ctx, vx, vw);
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
    const restH = rng.int(4, 5);
    const managerFront = variant === 'threeKeys';
    // The west wing: rooms along the outside, its corridor along the lobby, the restrooms across the front.
    // The east wing: the CCTV room in another wing than the vault, the break room, the ATM room on the front. The
    // room at the top of a wing touches the vault corridor, so the CCTV room never goes there (§17.7).
    const breakInMiddle = mb >= 4 && !mezzanine;
    const westRooms: Stacked[] = [{ type: 'managerOffice', min: 4, pref: 6, required: true, stretch: true }, ...(breakInMiddle ? [] : [{ type: 'cleanersCloset' as const, min: 3, pref: 3 }])];
    const west = stack(0, top, D - restH, rw, 'west', managerFront ? westRooms.reverse() : westRooms);
    const east = stack(W - rw, top, D, rw, 'east', [
        breakInMiddle ? { type: 'cleanersCloset', min: 3, pref: 3, required: true } : { type: 'breakRoom', min: 4, pref: 5, required: true },
        ...(spec.operator && !mezzanine ? [{ type: 'cctvRoom' as const, min: 4, pref: 5, required: true }] : []),
        { type: 'atmRoom', min: 3, pref: 4, stretch: true }
    ]);
    if (!west || !east) return undefined;
    pieces.push(...west, ...east);
    pieces.push(piece('restroom', 0, D - restH, ww, restH, 'west'));
    const westCorridor = pieces.push(piece('staffCorridor', rw, top, 2, D - restH - top, 'west')) - 1;
    const eastCorridor = pieces.push(piece('staffCorridor', W - ww, top, 2, D - top, 'east')) - 1;
    const links: Layout['links'] = [];
    const teller = pieces.push(piece('tellerLine', ww, tellerY, cw, 3, 'front')) - 1;
    if (mezzanine) {
        // Behind the teller line: the stairs up from it, the raised CCTV room looking over it, the break room beside.
        const cctvW = Math.min(8, cw - 6), stairsX = ww + rng.int(0, 1) * (cw - 2);
        const cctvX = stairsX === ww ? ww + 2 : ww + cw - 2 - cctvW;
        const stairs = pieces.push(piece('stairwell', stairsX, top, 2, mb, 'mezzanine', { stairs: { x: stairsX, y: top + mb - 3, w: 2, h: 3 }, raised: true })) - 1;
        pieces.push(piece('cctvRoom', cctvX, top, cctvW, mb, 'mezzanine', { raised: true }));
        const restX = stairsX === ww ? cctvX + cctvW : ww, restW = cw - 2 - cctvW;
        if (restW > 0) pieces.push(piece(restW >= 4 ? 'breakRoom' : 'staffCorridor', restX, top, restW, mb, 'centre'));
        links.push({ a: stairs, b: teller, lock: 'none' });
    } else if (mb >= 4) pieces.push(piece('breakRoom', ww, top, cw, mb, 'centre'));
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
    const { pieces, hb } = backBand(ctx, vx, vw);
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
    const upstairs = stack(ox, top, upTo, ow, side, [
        { type: 'managerOffice', min: 4, pref: 6, required: true, stretch: true },
        { type: 'cleanersCloset', min: 3, pref: 3 }
    ]);
    const below = stack(ox, upTo, D, ow, side, [{ type: 'restroom', min: 4, pref: 5, required: true, stretch: true }]);
    const other = side === 'west' ? 'east' : 'west';
    const ground = stack(side === 'west' ? W - ow : 0, top, D, ow, other, [
        { type: 'breakRoom', min: 4, pref: 5, required: true, stretch: true },
        ...(spec.operator ? [{ type: 'cctvRoom' as const, min: 4, pref: 5, required: true }] : []),
        { type: 'atmRoom', min: 3, pref: 4 }
    ]);
    if (!upstairs || !below || !ground) return undefined;
    for (const p of upstairs) p.raised = true;
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
    if (coreW < vw + 4) return undefined;
    const vx = coreX + Math.floor((coreW - vw) / 2) + rng.int(-1, 1);
    const coreH = vd + 3;
    const pieces: Piece[] = [piece('vault', vx, 0, vw, vd, 'core')];
    if (spec.mantrap) {
        const left = rng.chance(0.5);
        pieces.push(piece('mantrap', left ? vx : vx + vw - 2, vd, 2, 3, 'core'), piece('antechamber', left ? vx + 2 : vx, vd, vw - 2, 3, 'core'));
    } else pieces.push(piece('antechamber', vx, vd, vw, 3, 'core'));
    // The rest of the core block beside the vault, behind the same walls.
    pieces.push(piece(spec.operator ? 'serverRoom' : 'alarmCloset', coreX, 0, vx - coreX, coreH, 'core'));
    pieces.push(piece(spec.operator ? 'depositBoxes' : 'staffCorridor', vx + vw, 0, coreX + coreW - vx - vw, coreH, 'core'));
    const cw = W - 2 * ow;
    const tellerY = Math.max(coreH + ring + 4, D - rng.int(11, 13));
    // The ring: corridors down both sides of the core to the teller line, and across the front of the core.
    pieces.push(piece('staffCorridor', ow, 0, ring, tellerY, 'west'), piece('staffCorridor', W - ow - ring, 0, ring, tellerY, 'east'));
    pieces.push(piece('staffCorridor', coreX, coreH, coreW, ring, 'centre'));
    const top = coreH + ring;
    if (tellerY - top >= 4) {
        const half = Math.floor(coreW / 2);
        pieces.push(piece('breakRoom', coreX, top, half, tellerY - top, 'centre'), piece('cleanersCloset', coreX + half, top, coreW - half, tellerY - top, 'centre'));
    } else return undefined;
    // Outside the ring: the alarm closet and the loading bay at the back corners, offices down the sides.
    const westRooms = stack(0, 0, D, ow, 'west', [
        { type: 'alarmCloset', min: 4, pref: 5, required: spec.operator },
        { type: 'managerOffice', min: 4, pref: 6, required: true, stretch: true },
        { type: 'restroom', min: 4, pref: 5, required: true }
    ]);
    const eastRooms = stack(W - ow, 0, D, ow, 'east', [
        { type: tier === 'small' ? 'staffCorridor' : 'loadingBay', min: 5, pref: 6, required: true },
        ...(spec.operator ? [{ type: 'cctvRoom' as const, min: 4, pref: 5, required: true }] : []),
        { type: 'breakRoom', min: 4, pref: 5 },
        { type: 'atmRoom', min: 3, pref: 4, stretch: true }
    ]);
    if (!westRooms || !eastRooms) return undefined;
    pieces.push(...westRooms, ...eastRooms);
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
    const ctx: Ctx = { rng, tier, W, D, oldBank };
    const layout = archetype === 'atrium' ? atrium(ctx) : archetype === 'fortress' ? fortress(ctx) : twoWing(ctx, archetype);
    if (!layout) return undefined;
    // Mirror half the banks east to west, so wings and closets swap sides.
    if (rng.chance(0.5)) mirror(layout);
    if (overlapsOrGaps(layout)) {
        layoutFailure = `${archetype}: rooms overlap or leave gaps (${layout.pieces.map(p => `${p.type}@${p.x},${p.y} ${p.w}x${p.h}`).join(' ')})`;
        return undefined;
    }
    return layout;
}

function mirror(layout: Layout): void {
    const W = layout.width;
    for (const p of layout.pieces) {
        p.x = W - p.x - p.w;
        if (p.stairs) p.stairs.x = W - p.stairs.x - p.stairs.w;
        p.wing = p.wing === 'west' ? 'east' : p.wing === 'east' ? 'west' : p.wing;
    }
    if (layout.skylight) layout.skylight.x = W - layout.skylight.x - 2;
}

/** True unless the pieces tile the lot exactly: every tile in one room, none in two. */
function overlapsOrGaps(layout: Layout): boolean {
    const seen = new Uint8Array(layout.width * layout.depth);
    for (const p of layout.pieces) {
        if (p.x < 0 || p.y < 0 || p.x + p.w > layout.width || p.y + p.h > layout.depth) return true;
        // Stairs lie inside the room they climb out of; the stairwell piece is that room.
        for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
            const i = y * layout.width + x;
            if (seen[i]) return true;
            seen[i] = 1;
        }
    }
    return seen.some(v => v !== 1);
}
