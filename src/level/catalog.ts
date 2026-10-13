import { TILE } from './level';
import type { LobbyProp } from './lobby';
import { place, px, type AlignX, type AlignY, type Box, type Size } from './space';

/**
 * Every kind of object's real size and where it stands by default. Sizes are real-world dimensions turned into pixels
 * (`px` takes metres), so a cabinet, a counter and a person keep their proportions to each other and to the walls.
 * A level entry can override the alignment or span; the size is the object's own.
 */
interface ItemSpec { size: (p: LobbyProp) => Size; alignX?: AlignX; alignY?: AlignY; span?: (p: LobbyProp) => [number, number]; elevation?: number }

const fixed = (w: number, d: number, h: number) => () => ({ w: px(w), d: px(d), h: px(h) });
const widthOf = (p: LobbyProp) => ('width' in p ? p.width : 1);

export const CATALOG: Record<LobbyProp['kind'], ItemSpec> = {
    // Teller counter: the whole row deep, 1.2m tall; the teller glass above it is part of its art, not its box.
    counter: { size: p => ({ w: widthOf(p) * TILE, d: TILE, h: px(1.2) }), alignX: 'west', alignY: 'north' },
    // Credenza along the back wall: 0.5m deep, 0.9m tall, as long as its tiles.
    backCounter: { size: p => ({ w: widthOf(p) * TILE, d: px(0.5), h: px(0.9) }), alignX: 'west', alignY: 'north' },
    filingCabinet: { size: fixed(0.95, 0.5, 1.3), alignY: 'north' },
    printer: { size: fixed(0.95, 0.5, 1.1), alignY: 'north' },
    waterCooler: { size: fixed(0.4, 0.4, 1.3), alignY: 'north' },
    // Wall dressing: a thin slab on the floor tile in front of its wall, aligned north, raised to where it hangs.
    crest: { size: fixed(2.0, 0.08, 0.8), alignY: 'north', span: () => [2, 1], elevation: px(0.9) },
    clock: { size: fixed(0.7, 0.08, 0.7), alignY: 'north', elevation: px(1.1) },
    painting: { size: fixed(1.1, 0.08, 0.7), alignY: 'north', elevation: px(0.95) },
    noticeBoard: { size: fixed(1.0, 0.08, 0.65), alignY: 'north', elevation: px(0.95) },
    exitSign: { size: fixed(0.8, 0.08, 0.3), alignY: 'north', elevation: px(1.6) },
    // The card reader's LED, beside the staff door at handle height.
    keycardLed: { size: fixed(0.08, 0.08, 0.08), alignX: 'east', alignY: 'north', elevation: px(1.0) },
    // The ATM's screen, on the street side of the shop front.
    atmScreen: { size: fixed(0.6, 0.08, 0.3), alignY: 'north', elevation: px(1.1) },
    camera: { size: fixed(0.6, 0.3, 0.3), alignX: 'east', elevation: px(1.8) },
    // A run of stanchions from the middle of its first tile to the middle of its last: posts 0.95m tall.
    queueRail: { size: p => ({ w: px(0.3), d: ('length' in p ? p.length - 1 : 0) * TILE + px(0.3), h: px(0.95) }), span: p => [1, 'length' in p ? p.length : 1] },
    mat: { size: fixed(2.2, 1.0, 0), span: () => [2, 1] },
    writingDesk: { size: fixed(2.1, 0.6, 1.1), span: () => [2, 1] },
    sofa: { size: fixed(2.3, 0.9, 0.85), span: () => [2, 1] },
    coffeeTable: { size: fixed(1.2, 0.6, 0.45), span: () => [2, 1] },
    // A rubber plant in a 0.5m planter; its leaves spread wider than the planter but stand on that footprint.
    plant: { size: fixed(0.5, 0.5, 1.7) },
    brochureRack: { size: fixed(0.8, 0.3, 1.5) },
    bin: { size: fixed(0.35, 0.35, 0.6) },
    // Street furniture along the kerb stands at the south edge of the sidewalk; things against the shop front, north.
    streetLamp: { size: fixed(0.3, 0.3, 4.0), alignY: 'south' },
    hydrant: { size: fixed(0.4, 0.4, 0.75), alignY: 'south' },
    bollard: { size: fixed(0.25, 0.25, 0.9), alignY: 'south' },
    newsBox: { size: fixed(0.55, 0.45, 1.1), alignY: 'north' },
    streetBin: { size: fixed(0.55, 0.55, 1.0), alignY: 'north' },
    manhole: { size: fixed(0.7, 0.7, 0) },
    // Panel van parked against the kerb: 5.3m long, 2m wide, 2.3m tall.
    van: { size: fixed(5.3, 2.0, 2.3), alignX: 'west', alignY: 'north', span: () => [5, 2] }
};

/** Where a prop stands in the world, from its catalog entry and the level's overrides. */
export function propBox(p: LobbyProp): Box {
    const spec = CATALOG[p.kind];
    const size = spec.size(p);
    return place({
        tx: p.tx,
        ty: p.ty,
        span: p.span ?? spec.span?.(p),
        alignX: p.alignX ?? spec.alignX,
        alignY: p.alignY ?? spec.alignY,
        elevation: spec.elevation
    }, size);
}
