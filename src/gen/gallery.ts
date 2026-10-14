import type { LevelPerson } from '../level/plan';
import type { BankData } from '../level/bankData';
import { connect, defaultWalls, railings } from './build';
import { Furnisher } from './furnish';
import type { GenRoom, Rect, RoomType } from './model';
import { furnishBank, type Station } from './parcels';
import { Rng } from './rng';
import { ROOM_RULES } from './rooms';
import { Site } from './site';

/*
 * The room gallery (`?scene=rooms`): every room type the generator furnishes, side by side in a few sizes and shapes,
 * furnished by the same parcels and the same Furnisher as a generated bank and staffed at the stations the parcels
 * mark. One screen to check a furnishing change on, instead of hunting through seeds for the room.
 */

/** The rooms shown, one row each: everything a bank furnishes except the public floor and the ways between rooms. */
export const GALLERY_TYPES: RoomType[] = [
    'managerOffice', 'staffOffice', 'conferenceRoom', 'recordsRoom', 'breakRoom', 'cleanersCloset', 'atmRoom', 'restroom',
    'cctvRoom', 'alarmCloset', 'serverRoom', 'countingRoom', 'depositBoxes', 'antechamber', 'vault', 'mantrap', 'loadingBay'
];

/** The variants per type, in columns: small, the program's target, the most it may have, and an L at the target. */
export const GALLERY_VARIANTS = ['small', 'target', 'largest', 'L-shaped'] as const;
export type GalleryVariant = (typeof GALLERY_VARIANTS)[number];

/** Where each room of the gallery is, for tests and screenshot scripts. */
export interface GalleryCell { type: RoomType; variant: GalleryVariant; room: string; x: number; y: number; w: number; h: number }

const CORRIDOR = 2;
/** Who stands at a station, by its role. */
const LOOK_OF: Record<string, string> = {
    manager: 'manager', operator: 'operator', teller: 'teller', driveTeller: 'tellerB', staff: 'tellerB', queue: 'customerSuit', customer: 'customerCoat',
    clerk: 'officeWorker', counter: 'headTeller', archivist: 'officeWorker', cleaner: 'cleaner', technician: 'itTech', guard: 'guard'
};

/** The gallery as a bank the scene can draw, with where each room is. Deterministic: `seed` picks the parcels. */
export function roomGallery(seed = 1): { data: BankData; cells: GalleryCell[] } {
    // The types in two blocks side by side, so the gallery is about as wide as it is tall.
    const blocks = [GALLERY_TYPES.slice(0, Math.ceil(GALLERY_TYPES.length / 2)), GALLERY_TYPES.slice(Math.ceil(GALLERY_TYPES.length / 2))];
    const sizes = new Map(GALLERY_TYPES.map(type => [type, GALLERY_VARIANTS.map(variant => size(type, variant))]));
    const columnWidths = GALLERY_VARIANTS.map((_, c) => Math.max(...GALLERY_TYPES.map(type => sizes.get(type)![c]!.w)));
    const blockWidth = columnWidths.reduce((s, w) => s + w + CORRIDOR, 0);
    const rowHeight = (type: RoomType) => Math.max(...sizes.get(type)!.map(s => s.h));
    const blockHeights = blocks.map(types => types.reduce((s, type) => s + rowHeight(type) + CORRIDOR, 0));
    const width = CORRIDOR + blocks.length * blockWidth, height = CORRIDOR + Math.max(...blockHeights) + 3;
    const site = new Site(width, height);
    const cells: GalleryCell[] = [];
    const rooms: GenRoom[] = [];
    blocks.forEach((types, b) => {
        let y = CORRIDOR;
        for (const type of types) {
            let x = CORRIDOR + b * blockWidth;
            GALLERY_VARIANTS.forEach((variant, c) => {
                const { w, h } = sizes.get(type)![c]!, parts = shape(x, y + rowHeight(type) - h, w, h, variant);
                const room = site.addRoom(type, parts, { wing: 'centre', bank: true, name: `${ROOM_RULES[type].name} (${variant})` });
                rooms.push(room);
                cells.push({ type, variant, room: room.id, x: room.x, y: room.y, w: room.w, h: room.h });
                x += columnWidths[c]! + CORRIDOR;
            });
            y += rowHeight(type) + CORRIDOR;
        }
    });
    // Corridor everywhere else, as one room per gap so each stays a rectangle; side by side they open into each other.
    // Dimly lit: they are only the space between the exhibits.
    const corridors: GenRoom[] = [];
    for (let ty = 0; ty < height - 3; ty++) for (let tx = 0; tx < width; tx++) {
        if (site.owner[ty]![tx]! >= 0) continue;
        let w = 1;
        while (tx + w < width && site.owner[ty]![tx + w]! < 0) w++;
        const corridor = site.addRoom('staffCorridor', { x: tx, y: ty, w, h: 1 }, { wing: 'centre', bank: true });
        corridor.light = 'none';
        corridors.push(corridor);
        tx += w - 1;
    }
    // A street along the bottom, so the scene has its street front and daylight.
    site.addRoom('street', { x: 0, y: height - 3, w: width, h: 3 });
    const rng = new Rng(seed);
    defaultWalls(site, { rng, oldBank: false, softOutside: false, softNeighbours: new Set() });
    for (const room of rooms) {
        const below = corridors.filter(c => site.sharedEdges(room, c).some(e => e.run === 'eastWest' && e.ty === room.y + room.h));
        if (!below.some(c => connect(site, room, c, ROOM_RULES[room.type].lock, rng.fork(room.id)))) throw new Error(`No door for ${room.name} at ${room.x},${room.y}`);
    }
    railings(site);
    const furnish = new Furnisher(site);
    const furnished = furnishBank(site, rooms, furnish, rng.fork('parcels'), {
        gateX: -1, tellers: 0, frontDoorX: -1, metalDetector: false, motionSensors: true, dyePacks: false, vaultClass: 'II'
    });
    const people = furnished.stations.map((s: Station): LevelPerson => ({ look: LOOK_OF[s.role] ?? 'officeWorker', tx: s.tx, ty: s.ty, facing: s.facing }));
    return { data: { level: site.level(), rooms: site.rooms, props: site.props, people, focus: { tx: cells[0]!.x + 3, ty: cells[0]!.y + 2 } }, cells };
}

/** A variant's size from the type's area in the room programs: near square, at least three tiles each way. */
function size(type: RoomType, variant: GalleryVariant): { w: number; h: number } {
    const area = ROOM_RULES[type].area ?? { target: 24, max: 36 };
    const want = variant === 'small' ? Math.max(9, Math.round(area.target * 0.6)) : variant === 'largest' ? area.max : area.target;
    const w = Math.max(3, Math.round(Math.sqrt(want * 1.25))), h = Math.max(3, Math.round(want / w));
    return variant === 'L-shaped' ? { w: Math.max(w, 5), h: Math.max(h, 5) } : { w, h };
}

/** The rectangles of a variant: one, or an L (the full-width front, and the back's west part), largest first. */
function shape(x: number, y: number, w: number, h: number, variant: GalleryVariant): Rect[] {
    if (variant !== 'L-shaped') return [{ x, y, w, h }];
    const notchW = Math.floor(w / 2), notchH = Math.floor(h / 2);
    const front = { x, y: y + notchH, w, h: h - notchH }, back = { x, y, w: w - notchW, h: notchH };
    return front.w * front.h >= back.w * back.h ? [front, back] : [back, front];
}
