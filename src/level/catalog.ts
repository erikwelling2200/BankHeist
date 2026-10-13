import { TILE } from './level';
import type { LevelProp } from './plan';
import { place, px, spanOf, type AlignX, type AlignY, type Box, type Facing, type Size } from './space';
import { wallInsets, type Wall } from './walls';

/**
 * Every kind of object's real size and where it stands by default. Sizes are real-world dimensions turned into pixels
 * (`px` takes metres), so a cabinet, a counter and a person keep their proportions to each other and to the walls.
 * Size and span are in the object's own frame (across its front, back to front, up); `facing` turns both. A level
 * entry can override the facing, alignment or span; the size is the object's own.
 */
interface ItemSpec { size: (p: LevelProp) => Size; facing?: Facing; alignX?: AlignX; alignY?: AlignY; span?: (p: LevelProp) => [number, number]; elevation?: number }

const fixed = (w: number, d: number, h: number) => () => ({ w: px(w), d: px(d), h: px(h) });
const widthOf = (p: LevelProp) => ('width' in p ? p.width : 1);

export const CATALOG: Record<LevelProp['kind'], ItemSpec> = {
    // Teller counter: the whole row deep, 1.2m tall, its tiles' length less a hand's width so it fits between the walls;
    // the teller glass above it is part of its art, not its box.
    counter: { size: p => ({ w: widthOf(p) * TILE - px(0.3), d: TILE, h: px(1.2) }), alignX: 'west', alignY: 'north' },
    // Credenza along the back wall: 0.5m deep, 0.9m tall, a little shorter than its tiles.
    backCounter: { size: p => ({ w: widthOf(p) * TILE - px(0.3), d: px(0.5), h: px(0.9) }), alignX: 'west', alignY: 'north' },
    filingCabinet: { size: fixed(0.95, 0.5, 1.3), alignY: 'north' },
    printer: { size: fixed(0.95, 0.5, 1.1), alignY: 'north' },
    waterCooler: { size: fixed(0.4, 0.4, 1.3), alignY: 'north' },
    // Wall dressing: a thin slab against the face of the wall on its tile's north edge, raised to where it hangs.
    crest: { size: fixed(2.0, 0.08, 0.8), alignY: 'north', span: () => [2, 1], elevation: px(0.9) },
    clock: { size: fixed(0.7, 0.08, 0.7), alignY: 'north', elevation: px(1.1) },
    painting: { size: fixed(1.1, 0.08, 0.7), alignY: 'north', elevation: px(0.95) },
    noticeBoard: { size: fixed(1.0, 0.08, 0.65), alignY: 'north', elevation: px(0.95) },
    exitSign: { size: fixed(0.8, 0.08, 0.3), alignY: 'north', elevation: px(1.6) },
    // The card reader's LED, beside the staff door at handle height.
    keycardLed: { size: fixed(0.08, 0.08, 0.08), alignX: 'east', alignY: 'north', elevation: px(1.0) },
    // The ATM's screen, on the street side of the shop front.
    atmScreen: { size: fixed(0.6, 0.08, 0.3), alignY: 'north', elevation: px(1.1) },
    // A box camera on a wall bracket, its housing longer than it is wide, looking out of the wall it hangs on.
    camera: { size: fixed(0.3, 0.6, 0.3), elevation: px(1.8) },
    // A run of stanchions across its width, from the middle of its first tile to the middle of its last: posts 0.95m
    // tall. Facing east or west the run goes north-south.
    queueRail: { size: p => ({ w: ('length' in p ? p.length - 1 : 0) * TILE + px(0.3), d: px(0.3), h: px(0.95) }), span: p => ['length' in p ? p.length : 1, 1] },
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
    // Panel van: 2m wide across its nose, 5.3m long, 2.3m tall; parked nose to the west against the kerb.
    van: { size: fixed(2.0, 5.3, 2.3), facing: 'west', alignX: 'west', alignY: 'north', span: () => [2, 5] },

    // The Secure rooms: deposit boxes and cash shelving against the walls, the antechamber's console, server racks.
    depositBoxes: { size: fixed(1.0, 0.5, 1.9), alignY: 'north' },
    cashShelf: { size: fixed(1.0, 0.5, 1.8), alignY: 'north' },
    vaultConsole: { size: fixed(1.4, 0.7, 1.2), alignY: 'north' },
    serverRack: { size: fixed(0.6, 1.0, 2.0), alignY: 'north' },
    cashCart: { size: fixed(0.6, 0.9, 1.0) },
    alarmPanel: { size: fixed(0.5, 0.08, 0.6), alignY: 'north', elevation: px(1.1) },
    breakerPanel: { size: fixed(0.7, 0.15, 0.9), alignY: 'north', elevation: px(0.8) },
    // The staff rooms.
    cctvDesk: { size: fixed(2.0, 0.7, 1.2), alignY: 'north', span: () => [2, 1] },
    desk: { size: fixed(1.6, 0.8, 0.75), span: () => [2, 1] },
    officeChair: { size: fixed(0.6, 0.6, 1.0) },
    bookshelf: { size: fixed(1.0, 0.35, 1.9), alignY: 'north' },
    lockers: { size: fixed(1.0, 0.5, 1.9), alignY: 'north' },
    shelving: { size: fixed(1.0, 0.45, 1.8), alignY: 'north' },
    mopBucket: { size: fixed(0.4, 0.4, 1.2) },
    // The cash machine's safe, inside, against the back of the shop front.
    atmBack: { size: fixed(0.9, 0.8, 1.6), alignY: 'south' },
    boxes: { size: fixed(1.0, 0.8, 1.0) },
    diningTable: { size: fixed(1.6, 0.9, 0.75), span: () => [2, 1] },
    chair: { size: fixed(0.45, 0.45, 0.9) },
    fridge: { size: fixed(0.7, 0.7, 1.8), alignY: 'north' },
    kitchenCounter: { size: fixed(2.35, 0.6, 0.9), alignY: 'north', span: () => [2, 1] },
    toilet: { size: fixed(0.4, 0.7, 0.8), alignY: 'north' },
    washbasin: { size: fixed(0.6, 0.45, 0.85), alignY: 'north' },
    // The café next door.
    cafeTable: { size: fixed(0.7, 0.7, 0.75) },
    cafeCounter: { size: fixed(2.35, 0.7, 1.05), alignY: 'north', span: () => [2, 1] },
    menuBoard: { size: fixed(1.4, 0.08, 0.7), alignY: 'north', span: () => [2, 1], elevation: px(1.1) },
    // The alley: a dumpster and the generator against the backs of the buildings, a ladder up to the roofs.
    dumpster: { size: fixed(1.8, 1.0, 1.3), alignY: 'south', span: () => [2, 1] },
    generator: { size: fixed(1.6, 0.9, 1.2), alignY: 'south', span: () => [2, 1] },
    wallLadder: { size: fixed(0.5, 0.2, 1.9), facing: 'north', alignY: 'south' }
};

/** A prop's size in its own frame. */
export const propSize = (p: LevelProp): Size => CATALOG[p.kind].size(p);

/**
 * Where a prop stands in the world, from its catalog entry and the level's overrides. Pushed against a side of its
 * tiles, it stands against the face of the level's wall there.
 */
export function propBox(p: LevelProp, walls: readonly Wall[]): Box {
    const spec = CATALOG[p.kind];
    const size = spec.size(p);
    const placement = {
        facing: p.facing ?? spec.facing,
        tx: p.tx,
        ty: p.ty,
        span: p.span ?? spec.span?.(p),
        alignX: p.alignX ?? spec.alignX,
        alignY: p.alignY ?? spec.alignY,
        elevation: spec.elevation
    };
    const span = spanOf(placement, size);
    return place(placement, size, wallInsets(walls, span.tx, span.ty, span.w, span.d));
}
