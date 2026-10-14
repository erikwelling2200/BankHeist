import type { LevelProp } from '../level/plan';
import type { Furnisher } from './furnish';
import type { Approach, GenRoom, GetawaySpot, OffMapRoute, PlotExit, Tier } from './model';
import type { Neighbour } from './neighbours';
import type { Nav, P } from './nav';
import type { Furnished } from './parcels';
import type { Plot } from './plot';
import type { Rng } from './rng';
import type { Site } from './site';

/*
 * The ways in (§17.5): at least four approach points from at least three categories (social, covert, forced), at least
 * one covert way reaching the CCTV room or the alarm closet; the off-map routes behind the covert ones (§14.7); the
 * getaway spots, plot exits and police staging (§15.4, §13.4). Each approach's markers go into the world: the ladder
 * up to the roofs and the hatch it comes down through, the manhole and the grate, the vent.
 */

export interface Ways {
    approaches: Approach[];
    routes: OffMapRoute[];
    getaways: GetawaySpot[];
    exits: PlotExit[];
    staging: PlotExit[];
}

interface Ctx {
    site: Site;
    plot: Plot;
    bank: GenRoom[];
    neighbours: Neighbour[];
    furnished: Furnished;
    furnish: Furnisher;
    nav: Nav;
    rng: Rng;
    tier: Tier;
    frontDoorX: number;
    skylight?: P;
    softOutside: boolean;
}

/** Rooms the inside-man plan needs a covert way to (§17.5), best first. */
const COVERT_TARGETS = ['alarmCloset', 'cctvRoom'];

export function placeWays(ctx: Ctx): Ways {
    const { site, plot, bank, furnished, furnish, rng } = ctx;
    const approaches: Approach[] = [], routes: OffMapRoute[] = [];
    const roomAt = (p: P) => site.roomAt(p.x, p.y)!;
    // Where a way in actually puts someone: the nearest tile of that room they can stand on (a ladder or furniture
    // can take the marker's own tile).
    const entry = (p: P): P => {
        const room = roomAt(p);
        const free = (t: P) => ctx.nav.walkable(t.x, t.y) && !furnish.blocked(t.x, t.y);
        if (free(p)) return p;
        return ctx.nav.tilesOf(room).filter(free).sort((a, b) => Math.abs(a.x - p.x) + Math.abs(a.y - p.y) - Math.abs(b.x - p.x) - Math.abs(b.y - p.y))[0] ?? p;
    };
    const add = (category: Approach['category'], name: string, outside: P, at: P) => {
        const inside = entry(at);
        approaches.push({ id: `approach-${approaches.length}`, category, name, outside: { tx: outside.x, ty: outside.y }, inside: { tx: inside.x, ty: inside.y }, room: roomAt(inside).id });
    };
    const backY = plot.lot.y, alleyRow = backY - 1, frontY = plot.lot.y + plot.lot.h;
    const roomType = (id: string) => site.rooms.find(r => r.id === id)?.type ?? '';
    const prefer = <T extends { room: string }>(list: T[], types: string[]) => [...list].sort((a, b) => rank(types, roomType(a.room)) - rank(types, roomType(b.room)));

    // Social: the front door in opening hours, and the staff door at the back with a keycard.
    const frontInside = { x: ctx.frontDoorX, y: frontY - 1 }, frontOutside = { x: ctx.frontDoorX, y: frontY };
    add('social', 'Front door (opening hours)', frontOutside, frontInside);
    const back = site.doors.find(d => d.run === 'eastWest' && d.ty === backY && site.wallAt(d)?.kind === 'doorBack' && bank.some(r => r.id === d.a || r.id === d.b));
    if (back) add('social', 'Staff door from the alley (keycard)', { x: back.tx, y: back.ty - 1 }, { x: back.tx, y: back.ty });

    // Covert: the roof route, down a hatch (or the atrium's skylight) from a ladder in the alley or the scaffolding.
    const scaffold = ctx.neighbours.find(n => n.scaffoldTop)?.scaffoldTop;
    let ladder: P | undefined = scaffold;
    if (!ladder) {
        for (const dx of rng.shuffle(Array.from({ length: plot.lot.w - 2 }, (_, i) => i + 1))) {
            const x = plot.lot.x + dx;
            if (site.doors.some(d => d.run === 'eastWest' && d.ty === backY && Math.abs(d.tx - x) <= 1)) continue;
            if (furnish.try({ kind: 'wallLadder', tx: x, ty: alleyRow })) { ladder = { x, y: alleyRow }; break; }
        }
    }
    let hatch: P | undefined;
    if (ctx.skylight && furnish.try({ kind: 'skylight', tx: ctx.skylight.x, ty: ctx.skylight.y })) hatch = { x: ctx.skylight.x, y: ctx.skylight.y };
    const hatches = prefer(furnished.hatches, [...COVERT_TARGETS, 'staffCorridor']);
    let hatchTarget: P | undefined;
    for (const h of hatches) if (furnish.try({ kind: 'roofHatch', tx: h.tx, ty: h.ty, alignY: 'north' } as LevelProp, roomAt({ x: h.tx, y: h.ty }))) { hatchTarget = { x: h.tx, y: h.ty }; break; }
    if (ladder) {
        for (const inside of [hatch, hatchTarget].filter((p): p is P => !!p)) {
            const isSkylight = inside === hatch;
            add('covert', isSkylight ? 'Roof route, down through the skylight' : `Roof route, down the hatch in the ${roomAt(inside).name.toLowerCase()}`, ladder, inside);
            routes.push({ kind: 'roof', outside: { tx: ladder.x, ty: ladder.y }, inside: { tx: inside.x, ty: inside.y }, transit: 2 });
        }
    }
    // The sewer: a manhole in the road in front of the bank, a grate in a utility room.
    const grates = prefer(furnished.grates, [...COVERT_TARGETS, 'cleanersCloset', 'loadingBay', 'serverRoom']);
    let manhole: P | undefined;
    for (const dx of rng.shuffle(Array.from({ length: plot.lot.w }, (_, i) => i))) {
        const x = plot.lot.x + dx, y = plot.roadY + 1;
        if (furnish.try({ kind: 'manhole', tx: x, ty: y })) { manhole = { x, y }; break; }
    }
    if (manhole) for (const g of grates) {
        if (!furnish.try({ kind: 'floorGrate', tx: g.tx, ty: g.ty }, roomAt({ x: g.tx, y: g.ty }))) continue;
        add('covert', `Sewer, up through the grate in the ${roomAt({ x: g.tx, y: g.ty }).name.toLowerCase()}`, manhole, { x: g.tx, y: g.ty });
        routes.push({ kind: 'sewer', outside: { tx: manhole.x, ty: manhole.y }, inside: { tx: g.tx, ty: g.ty }, transit: 3 });
        break;
    }
    // An air duct from the roof into the server room.
    if (ladder) for (const v of furnished.vents) {
        if (!furnish.try({ kind: 'ventGrille', tx: v.tx, ty: v.ty } as LevelProp)) continue;
        const inside = ctx.nav.tilesOf(roomAt({ x: v.tx, y: v.ty }))[0];
        if (inside) add('covert', 'Air duct from the roof into the server room', ladder, inside);
        break;
    }

    // Forced: ram the glass front, the loading bay's shutter, a soft wall from next door.
    const lobby = roomAt(frontInside), window = Array.from({ length: lobby.w }, (_, i) => lobby.x + i).find(x => site.roomAt(x, frontY - 1) === lobby && site.wallAt({ run: 'eastWest', tx: x, ty: frontY })?.kind === 'window');
    if (window) add('forced', 'Vehicle ram through the glass front', { x: window, y: plot.roadY }, { x: window, y: frontY - 1 });
    const shutter = site.doors.find(d => site.wallAt(d)?.kind === 'shutter' && bank.some(r => r.id === d.a || r.id === d.b));
    if (shutter) add('forced', "The loading bay's shutter (rammable)", { x: shutter.tx, y: shutter.ty - 1 }, { x: shutter.tx, y: shutter.ty });
    for (const n of ctx.neighbours.filter(n => n.party && n.soft)) {
        const party = n.party!;
        const edge = bank.flatMap(r => site.sharedEdges(party, r)).find(e => site.wallAt(e)?.kind === 'plaster');
        if (!edge) continue;
        const [a, b] = edge.run === 'northSouth' ? [{ x: edge.tx - 1, y: edge.ty }, { x: edge.tx, y: edge.ty }] : [{ x: edge.tx, y: edge.ty - 1 }, { x: edge.tx, y: edge.ty }];
        const [outside, inside] = roomAt(a) === party ? [a, b] : [b, a];
        add('forced', `Breach the soft wall from the ${party.name.toLowerCase()}`, outside, inside);
    }
    if (ctx.softOutside) {
        const soft = Array.from({ length: plot.lot.w }, (_, i) => plot.lot.x + i).map(x => ({ x, r: site.roomAt(x, backY) }))
            .find(t => t.r && bank.includes(t.r) && site.wallAt({ run: 'eastWest', tx: t.x, ty: backY })?.kind === 'plaster');
        if (soft) add('forced', 'Breach a soft outer wall from the alley', { x: soft.x, y: alleyRow }, { x: soft.x, y: backY });
    }

    // The bank's generator in the back lot (§17.4), against its back wall.
    for (const dx of rng.shuffle(Array.from({ length: plot.lot.w - 2 }, (_, i) => i))) if (furnish.try({ kind: 'generator', tx: plot.lot.x + dx, ty: alleyRow, alignY: 'south' })) break;

    // Getaway spots (§15.4): at the curb in police view, out the back, hidden in a garage next door.
    const getaways: GetawaySpot[] = [];
    const curbX = plot.lot.x + (rng.chance(0.5) ? 1 : plot.lot.w - 7);
    if (furnish.try({ kind: 'van', tx: curbX, ty: plot.roadY })) getaways.push({ id: 'curb', name: 'At the curb in front of the bank', tx: curbX, ty: plot.roadY, risk: 'police view' });
    getaways.push({ id: 'alley', name: 'In the alley behind the bank', tx: plot.lot.x + Math.floor(plot.lot.w / 2), ty: 2, risk: 'hidden' });
    for (const n of ctx.neighbours) if (n.hiddenSpot) getaways.push({ id: `garage-${n.slot.side}`, name: 'Inside the parking garage next door', tx: n.hiddenSpot.x, ty: n.hiddenSpot.y, risk: 'hidden' });
    if (plot.side && plot.kind === 'cornerLot') getaways.push({ id: 'side', name: 'On the side road', tx: plot.side.x + 3, ty: plot.side.y + 2, risk: 'police view' });
    if (plot.forecourt && plot.kind === 'stripMallEnd') getaways.push({ id: 'lot', name: 'In the parking lot', tx: plot.lot.x + 2, ty: plot.forecourt.y + 2, risk: 'police view' });

    const W = site.width;
    const exits: PlotExit[] = [
        { id: 'street-west', name: 'Main street, west end', tx: 0, ty: plot.roadY + 1 },
        { id: 'street-east', name: 'Main street, east end', tx: W - 1, ty: plot.roadY + 1 },
        { id: 'alley-west', name: 'Alley, west end', tx: 0, ty: 2 },
        { id: 'alley-east', name: 'Alley, east end', tx: W - 1, ty: 2 }
    ];
    const staging = [exits[0]!, exits[1]!, { id: 'alley-mouth', name: 'The alley mouth', tx: 0, ty: 2 }];
    return { approaches, routes, getaways, exits, staging };
}

const rank = (order: string[], t: string) => (order.includes(t) ? order.indexOf(t) : order.length);
