import type { FloorTile } from '../level/plan';
import type { PlotKind, Rect, Tier } from './model';
import type { Rng } from './rng';
import { Site } from './site';

/*
 * The city-block templates (§17.2 step 1): the main street along the bottom, an alley (or service road) along the top,
 * the bank's lot in the building band between them with 2–4 neighbour slots around it. Every template keeps the bank's
 * front and its neighbours' on one line, facing the street.
 *
 *   row 0          off the map: the backs of the buildings across the alley
 *   rows 1-3       the alley (a service road behind a strip mall)
 *   building band  neighbours and the bank's lot, as deep as the bank
 *   front          a plaza (plaza front) or a parking lot (strip-mall end), on some plots
 *   street         two rows of sidewalk, the curb, five rows of road
 *   far side       the far curb and sidewalk, then a row of buildings (the office tower), on some plots
 */

export type NeighbourKind = 'cafe' | 'vacantShop' | 'garage' | 'buildingSite' | 'shop' | 'tower';

/** A neighbour slot: where a neighbour goes and which side of the bank it is on. */
export interface Slot { side: 'west' | 'east' | 'across'; rect: Rect; kind: NeighbourKind }

export interface Plot {
    kind: PlotKind;
    site: Site;
    /** The bank's lot: the interior, from the back wall to the street front. */
    lot: Rect;
    slots: Slot[];
    alley: Rect;
    /** The rows of the street: sidewalk, curb and road. */
    sidewalkY: number;
    roadY: number;
    /** A side road (corner lot) or back lot (strip-mall end) beside the bank, if any. */
    side?: Rect;
    /** The plaza or parking lot between the fronts and the sidewalk, if any. */
    forecourt?: Rect;
    farSidewalkY?: number;
}

const ALLEY_Y = 1, ALLEY_H = 3, BAND_Y = ALLEY_Y + ALLEY_H, SIDE_ROAD = 6;

/** Picks the neighbours for a plot's side slots: no two alike side by side, and a building site if asked for. */
function sideKinds(rng: Rng, kind: PlotKind, count: number, wantSite: boolean): NeighbourKind[] {
    const pool: NeighbourKind[] = kind === 'stripMallEnd' ? ['cafe', 'vacantShop', 'shop'] : ['cafe', 'vacantShop', 'garage', 'buildingSite'];
    const out = rng.shuffle(pool).slice(0, count);
    while (out.length < count) out.push(rng.pick(pool));
    if (wantSite && !out.includes('buildingSite')) out[out.length - 1] = 'buildingSite';
    return out;
}

/**
 * Lays out the plot around a bank lot `bankW` by `bankD`: sizes the map, places the lot, the neighbour slots and the
 * open ground, and paints the open ground. Neighbours and the bank are built into their rects afterwards.
 */
export function composePlot(rng: Rng, kind: PlotKind, tier: Tier, bankW: number, bankD: number, opts: { site: boolean; across: boolean }): Plot {
    void tier;
    const sides: ('west' | 'east')[] = kind === 'cornerLot' ? ['west'] : kind === 'stripMallEnd' ? ['west', 'west'] : ['west', 'east'];
    const kinds = sideKinds(rng, kind, sides.length, opts.site);
    const widths = sides.map(() => (kind === 'stripMallEnd' ? rng.int(7, 9) : rng.int(9, 12)));
    const westW = widths.filter((_, i) => sides[i] === 'west').reduce((s, w) => s + w, 0);
    const eastW = kind === 'cornerLot' || kind === 'stripMallEnd' ? SIDE_ROAD : widths[sides.indexOf('east')]!;
    const width = westW + bankW + eastW;
    const forecourtH = kind === 'plazaFront' ? 3 : kind === 'stripMallEnd' ? 5 : 0;
    const frontY = BAND_Y + bankD, sidewalkY = frontY + forecourtH, roadY = sidewalkY + 3;
    const across = opts.across;
    const farY = roadY + 5, height = across ? farY + 3 + 5 : roadY + 5;
    const site = new Site(width, height);

    // The open ground: the alley along the top, the street along the bottom, and what the template adds.
    const alley = { x: 0, y: ALLEY_Y, w: width, h: ALLEY_H };
    site.addRoom(kind === 'stripMallEnd' ? 'alley' : 'alley', alley, { name: kind === 'stripMallEnd' ? 'Service road' : 'Alley' });
    const street = site.addRoom('street', { x: 0, y: sidewalkY, w: width, h: 8 });
    void street;
    paintRows(site, 0, sidewalkY, width, ['s', 's', 'c', 'r', 'r', 'l', 'r', 'r']);
    let forecourt: Rect | undefined;
    if (forecourtH) {
        forecourt = { x: 0, y: frontY, w: width, h: forecourtH };
        site.addRoom(kind === 'plazaFront' ? 'plaza' : 'parkingLot', forecourt);
    }
    let side: Rect | undefined;
    const lot = { x: westW, y: BAND_Y, w: bankW, h: bankD };
    if (kind === 'cornerLot') {
        // The side road: a sidewalk along the bank, then the road, from the alley down to the main street.
        side = { x: westW + bankW, y: BAND_Y, w: SIDE_ROAD, h: bankD + forecourtH };
        site.addRoom('sideRoad', side);
        for (let y = side.y; y < side.y + side.h; y++) for (let x = side.x; x < side.x + side.w; x++) site.tiles[y]![x] = x - side.x < 2 ? 's' : 'r';
    } else if (kind === 'stripMallEnd') {
        side = { x: westW + bankW, y: BAND_Y, w: SIDE_ROAD, h: bankD };
        site.addRoom('backLot', side);
    }
    let farSidewalkY: number | undefined;
    if (across) {
        farSidewalkY = farY;
        site.addRoom('farSidewalk', { x: 0, y: farY, w: width, h: 3 });
        paintRows(site, 0, farY, width, ['c', 's', 's']);
    }

    const slots: Slot[] = [];
    let x = 0;
    sides.forEach((s, i) => {
        if (s !== 'west') return;
        slots.push({ side: 'west', rect: { x, y: BAND_Y, w: widths[i]!, h: bankD }, kind: kinds[i]! });
        x += widths[i]!;
    });
    const east = sides.indexOf('east');
    if (east >= 0) slots.push({ side: 'east', rect: { x: westW + bankW, y: BAND_Y, w: eastW, h: bankD }, kind: kinds[east]! });
    if (across) slots.push({ side: 'across', rect: { x: 0, y: farY + 3, w: width, h: 5 }, kind: 'tower' });
    return { kind, site, lot, slots, alley, sidewalkY, roadY, side, forecourt, farSidewalkY };
}

function paintRows(site: Site, x: number, y: number, w: number, rows: FloorTile[]): void {
    rows.forEach((t, i) => site.paint({ x, y: y + i, w, h: 1 }, t));
}
