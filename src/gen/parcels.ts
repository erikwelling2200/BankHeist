import { TILE } from '../level/level';
import type { LevelProp, PersonFacing } from '../level/plan';
import type { Facing } from '../level/space';
import {
    accent, cctvConsole, cleaningStation, countingTable, deskPair, kitchenette, lockerBank, loose, lounge, managerDesk, meeting, serverRow, sideboard, stacks,
    storage, viewingTable, workstation
} from './activities';
import type { Furnisher, Placed } from './furnish';
import { RoomPlan, type GroupDef, type Kind, type PlacedGroup } from './groups';
import type { GenRoom, Rect, RoomType } from './model';
import type { P } from './nav';
import type { Rng } from './rng';
import type { Site } from './site';
import { tellStories } from './stories';

/*
 * Room parcels (§17.1 layer 2, §17.2 step 5): how each room type is furnished, three styles per type, each a program
 * of functional groups (`activities.ts`) whose number follows the room's floor area, placed by scored candidates
 * (`groups.ts`) after the walks between its doors are kept free. A parcel also places its room's fixed pieces (the
 * counter, the vault console, the cash machine's safe) and marks where people work (stations, with their roles), the
 * silent-alarm buttons, where a camera can hang, the loot, and the spots for roof hatches, floor grates and vents.
 * After every room, a story pass (`stories.ts`) dresses each with a vignette or two of who uses it.
 */

/** Where someone works or waits: a teller's window, the manager's chair, a clerk's desk, a customer's place in the queue. */
export interface Station { tx: number; ty: number; facing: PersonFacing; role: string; room: string }

/** A wall spot a camera can hang on, looking into the room. */
export interface CameraSlot { tx: number; ty: number; facing: Facing; room: string; prop: LevelProp }

/** A vignette the story pass left in a room (lesson 9): what it shows, and where. */
export interface Story { id: string; room: string; tx: number; ty: number; text: string }

export interface Furnished {
    stations: Station[];
    cameraSlots: CameraSlot[];
    /** Silent-alarm stations (§9.1): the teller windows, the manager's desk button, the CCTV console's panel. */
    alarms: { tx: number; ty: number; name: string; room: string }[];
    /** Loot by tile (§15.1). */
    loot: { tx: number; ty: number; name: string; value: number; weight: 'light' | 'heavy' | 'very heavy'; room: string }[];
    /** The inside ends of off-map routes and ducts, placed where a parcel has room for them. */
    grates: { tx: number; ty: number; room: string }[];
    vents: { tx: number; ty: number; room: string }[];
    hatches: { tx: number; ty: number; room: string }[];
    stories: Story[];
}

export const emptyFurnished = (): Furnished => ({ stations: [], cameraSlots: [], alarms: [], loot: [], grates: [], vents: [], hatches: [], stories: [] });

/**
 * One room being furnished. The fixed pieces are measured from the west wall of its largest rectangle (its `frame`), or
 * from its east wall when mirrored; the groups go wherever they score best, the arms of an L included.
 */
export class Parcel extends RoomPlan {
    readonly frame: Rect;

    constructor(room: GenRoom, f: Furnisher, rng: Rng, readonly mirror: boolean, out: Furnished, site: Site) {
        super(room, f, rng, out, site);
        this.frame = room.parts[0]!;
    }

    get w(): number { return this.frame.w; }
    get h(): number { return this.frame.h; }
    /** The frame's north row. */
    get top(): number { return this.frame.y; }
    /** Tiles of floor. */
    get area(): number { return this.site.tilesOfRoom(this.room).length; }

    /** The tile column `dx` tiles in from the parcel's west (east when mirrored), for something `span` tiles wide. */
    x(dx: number, span = 1): number {
        return this.mirror ? this.frame.x + this.frame.w - dx - span : this.frame.x + dx;
    }

    /** Mirrors a prop's facing and side alignment. */
    private flip(p: LevelProp): LevelProp {
        if (!this.mirror) return p;
        const facing = p.facing === 'east' ? 'west' : p.facing === 'west' ? 'east' : p.facing;
        const alignX = p.alignX === 'east' ? 'west' : p.alignX === 'west' ? 'east' : p.alignX;
        return { ...p, ...(facing ? { facing } : {}), ...(alignX ? { alignX } : {}) };
    }

    /** Places a prop `dx` in from the parcel's west and `dy` down from its north wall; `wide` is its width in tiles. */
    put(p: Omit<LevelProp, 'tx' | 'ty'> & { dx: number; dy: number; wide?: number }): boolean {
        const { dx, dy, wide, ...rest } = p;
        const prop = this.flip({ ...rest, tx: this.x(dx, wide ?? 1), ty: this.top + dy } as LevelProp);
        return this.f.try(prop, this.room);
    }

    /** Tries a prop at each column along a row from `from` until one fits. */
    along(p: Omit<LevelProp, 'tx' | 'ty'> & { dy: number; wide?: number }, from = 0, to = this.w): number | undefined {
        for (let dx = from; dx + (p.wide ?? 1) <= to; dx++) if (this.put({ ...p, dx } as never)) return dx;
        return undefined;
    }

    /** Lines the north wall from `from` with props, skipping what doesn't fit (a door, a column). */
    lineNorth(kinds: LevelProp['kind'][], from = 0): void {
        let dx = from;
        for (const kind of kinds) {
            while (dx < this.w && !this.put({ kind, dx, dy: 0, alignY: 'north' } as never)) dx++;
            dx++;
        }
    }

    /** Wall dressing on the north wall, somewhere between `from` and `to`. */
    hang(kind: LevelProp['kind'], from = 0, to = this.w): boolean {
        const options = this.rng.shuffle(Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i));
        return options.some(dx => this.put({ kind, dx, dy: 0 } as never));
    }

    /** Wall dressing on whichever north wall of the room is nearest `near` (a whiteboard by the meeting table). */
    hangNear(kind: LevelProp['kind'], near: P): boolean {
        const tiles = this.site.tilesOfRoom(this.room).sort((a, b) => Math.abs(a.x - near.x) + Math.abs(a.y - near.y) - Math.abs(b.x - near.x) - Math.abs(b.y - near.y));
        return tiles.some(t => this.f.try({ kind, tx: t.x, ty: t.y } as LevelProp, this.room));
    }

    /**
     * A prop slot: one of `pool`, on any free tile of the room (the whole room, not only its frame), kept to its walls
     * so the room stays walkable, and pushed against the wall it stands by.
     */
    slot(pool: LevelProp['kind'][], edge = true): boolean {
        const inRoom = (x: number, y: number) => this.site.roomAt(x, y) === this.room;
        const tiles = this.site.tilesOfRoom(this.room).filter(t => !edge || !inRoom(t.x - 1, t.y) || !inRoom(t.x + 1, t.y) || !inRoom(t.x, t.y - 1) || !inRoom(t.x, t.y + 1));
        for (const { x, y } of this.rng.shuffle(tiles)) {
            const kind = this.rng.pick(pool);
            const alignX = !inRoom(x - 1, y) ? 'west' : !inRoom(x + 1, y) ? 'east' : undefined;
            const alignY = !inRoom(x, y - 1) ? 'north' : !inRoom(x, y + 1) ? 'south' : undefined;
            if (this.f.try({ kind, tx: x, ty: y, ...(alignX ? { alignX } : {}), ...(alignY ? { alignY } : {}) } as LevelProp, this.room)) return true;
        }
        return false;
    }

    /** Someone's place: kept free, recorded with their role. */
    station(role: string, dx: number, dy: number, facing: PersonFacing): boolean {
        const tx = this.x(dx), ty = this.top + dy;
        if (!this.f.canStand(tx, ty) || this.f.isKept(tx, ty) && !this.isDoorless(tx, ty)) return false;
        if (!this.f.stand(tx, ty)) return false;
        this.out.stations.push({ tx, ty, facing, role, room: this.room.id });
        return true;
    }

    private isDoorless(tx: number, ty: number): boolean {
        return !this.site.doors.some(d => (d.tx === tx && d.ty === ty) || (d.run === 'eastWest' && d.tx === tx && d.ty === ty + 1) || (d.run === 'northSouth' && d.tx === tx + 1 && d.ty === ty));
    }

    /** A camera in a north corner of the frame, looking along the room. */
    cameraCorners(): void {
        for (const [dx, facing, alignX] of [[0, 'east', 'west'], [this.w - 1, 'west', 'east']] as const) {
            const prop = this.flip({ kind: 'camera', tx: this.frame.x + dx, ty: this.top, facing, alignX } as LevelProp);
            this.out.cameraSlots.push({ tx: prop.tx, ty: prop.ty, facing: prop.facing!, room: this.room.id, prop });
        }
    }

    alarm(name: string, dx: number, dy: number): void {
        this.out.alarms.push({ tx: this.x(dx), ty: this.top + dy, name, room: this.room.id });
    }

    loot(name: string, value: number, weight: Furnished['loot'][number]['weight'], dx: number, dy: number): void {
        this.out.loot.push({ tx: this.x(dx), ty: this.top + dy, name, value, weight, room: this.room.id });
    }

    /**
     * Loot on a placed group: on its piece tagged (or of the kind) `on`, or its first piece; at the frame's (dx, dy) when
     * the group didn't go in.
     */
    lootAt(group: PlacedGroup | undefined, on: string | undefined, name: string, value: number, weight: Furnished['loot'][number]['weight'], dx = 0, dy = 0): void {
        const piece = group?.placed.find((b, i) => b && (on === undefined || group.def.pieces[i]!.tag === on || b.prop.kind === on));
        if (piece) this.out.loot.push({ tx: piece.prop.tx, ty: piece.prop.ty, name, value, weight, room: this.room.id });
        else this.loot(name, value, weight, dx, dy);
    }

    /** Keeps the frame's tile (dx, dy) for a hatch, a grate or a vent placed later, and records it. */
    spot(list: 'grates' | 'vents' | 'hatches', dx: number, dy: number): void {
        const tx = this.x(dx), ty = this.top + dy;
        this.reserve(tx, ty);
        this.out[list].push({ tx, ty, room: this.room.id });
    }

    /** Pieces of furniture standing on the room's floor. */
    pieces(): number {
        const middle = (b: Placed) => this.site.roomAt(Math.floor((b.box.x + b.box.w / 2) / TILE), Math.floor((b.box.y + b.box.d / 2) / TILE));
        return this.f.boxes.filter(b => b.box.z === 0 && b.box.h > 0 && middle(b) === this.room).length;
    }

    /**
     * Storage along every wall that has room for it (lesson 8: one storage wall per wall long enough): runs of `kinds`
     * in turn, the longest that fits first, down to `least` long. Not along the south wall, where the camera would only
     * see the backs of the shelves.
     */
    storageWalls(kinds: Kind[], most: number, least = 2, runs = 8): number {
        let placed = 0;
        for (let len = most; len >= least && placed < runs; len--) {
            const run = Array.from({ length: len }, (_, i) => kinds[(i + placed) % kinds.length]!);
            // After a run goes in, another as long, before trying shorter ones.
            if (this.group(storage(run), { facings: ['south', 'east', 'west'] })) { placed++; len++; }
        }
        return placed;
    }

    /** Things against the walls from `pool` until the room has a piece of furniture for every `per` tiles of floor. */
    dense(pool: Kind[], per: number, most = 8): void {
        for (let i = 0; i < most && this.area > per * this.pieces(); i++) if (!this.group(accent(this.rng.pick(pool), 0.5))) break;
    }

    /** The first block of `size` by `size` tiles of open floor (nothing standing on it, nothing kept free), as its tiles. */
    gap(size = 3): P[] | undefined {
        const open = (x: number, y: number) => this.site.roomAt(x, y) === this.room && !this.f.occupied(x, y) && !this.f.isKept(x, y) && !this.reserved.has(`${x},${y}`);
        for (const t of this.site.tilesOfRoom(this.room)) {
            const block: P[] = [];
            for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) block.push({ x: t.x + dx, y: t.y + dy });
            if (block.every(b => open(b.x, b.y))) return block;
        }
        return undefined;
    }

    /**
     * Where a big room still has a stretch of open floor, more of what the room is for, beside it (lesson 8: big rooms
     * fill with more of what they do): the first of `defs` that goes in there, up to `most` times.
     */
    fillGaps(defs: GroupDef[], most = 3): void {
        for (let i = 0; i < most; i++) {
            const gap = this.gap();
            if (!gap || !defs.some(def => this.group(def, { near: gap }))) return;
        }
    }

    /** The middle of a placed group's footprint. */
    static middle(g: PlacedGroup): P {
        return { x: Math.round(g.tiles.reduce((s, t) => s + t.x, 0) / g.tiles.length), y: Math.round(g.tiles.reduce((s, t) => s + t.y, 0) / g.tiles.length) };
    }
}

type ParcelFn = (p: Parcel, ctx: ParcelContext) => void;

/** What the parcels need to know beyond the room: where the counter's gate is, the tier's numbers, the front door. */
export interface ParcelContext {
    gateX: number;
    tellers: number;
    frontDoorX: number;
    metalDetector: boolean;
    motionSensors: boolean;
    dyePacks: boolean;
    vaultClass: string;
    /** The inside tile of the drive-through's teller window, its top half. */
    driveWindow?: { x: number; y: number };
}

const STORE: Kind[] = ['boxes', 'shelving'];

/** The parcels by room type: every type has three styles. */
export const PARCELS: Partial<Record<RoomType, ParcelFn[]>> = {
    tellerLine: [tellerLine('backCounters'), tellerLine('cabinets'), tellerLine('mixed')],
    lobby: [lobby('queue'), lobby('waiting'), lobby('open')],
    restroom: [restroom(2), restroom(3), restroom(1)],
    atmRoom: [atmRoom(0), atmRoom(1), atmRoom(2)],
    managerOffice: [office('desk'), office('meeting'), office('shelves')],
    breakRoom: [breakRoom('table'), breakRoom('lockers'), breakRoom('both')],
    cleanersCloset: [closet(0), closet(1), closet(2)],
    staffCorridor: [corridor(0), corridor(1), corridor(2)],
    cctvRoom: [cctv(0), cctv(1), cctv(2)],
    alarmCloset: [alarmCloset(0), alarmCloset(1), alarmCloset(2)],
    serverRoom: [serverRoom(0), serverRoom(1), serverRoom(2)],
    antechamber: [antechamber(0), antechamber(1), antechamber(2)],
    vault: [vault(0), vault(1), vault(2)],
    depositBoxes: [depositRoom(0), depositRoom(1), depositRoom(2)],
    loadingBay: [loadingBay(0), loadingBay(1), loadingBay(2)],
    mezzanine: [gallery(0), gallery(1), gallery(2)],
    mantrap: [mantrap, mantrap, mantrap],
    countingRoom: [countingRoom(0), countingRoom(1), countingRoom(2)],
    recordsRoom: [records(0), records(1), records(2)],
    staffOffice: [staffOffice(0), staffOffice(1), staffOffice(2)],
    conferenceRoom: [conference(0), conference(1), conference(2)]
};

function tellerLine(style: 'backCounters' | 'cabinets' | 'mixed'): ParcelFn {
    return (p, ctx) => {
        const { room } = p, row = room.y + room.h - 1;
        // The counter along the front row where it meets the lobby (the atrium's gallery takes the rest of it, behind its
        // railing), a window every four tiles, the gate where the doors put it.
        const lobby = p.site.rooms.find(r => r.type === 'lobby' && r.bank && p.site.sharedEdges(room, r).some(e => e.run === 'eastWest'))!;
        const front = p.site.sharedEdges(room, lobby).filter(e => e.run === 'eastWest').map(e => e.tx);
        const x0 = Math.min(...front), x1 = Math.max(...front) + 1;
        const windows: number[] = [];
        for (let x = x0 + 2; x < x1 - 2; x += 4) if (Math.abs(x - ctx.gateX) > 1) windows.push(x);
        const open = windows.slice(0, Math.max(1, ctx.tellers));
        const counter: LevelProp = { kind: 'counter', tx: x0, ty: row, width: x1 - x0, stations: windows, closed: windows.filter(x => !open.includes(x)), gate: ctx.gateX };
        if (!p.f.try(counter, room)) throw new Error(`The teller counter doesn't fit the front row of ${room.id}`);
        for (const x of open) {
            if (p.f.stand(x, row - 1)) p.out.stations.push({ tx: x, ty: row - 1, facing: 'front', role: 'teller', room: room.id });
            p.out.alarms.push({ tx: x, ty: row - 1, name: 'Teller window alarm button', room: room.id });
            p.out.loot.push({ tx: x, ty: row - 1, name: ctx.dyePacks && x === open[0] ? 'Cash drawer (dye pack)' : 'Cash drawer', value: 5000, weight: 'light', room: room.id });
        }
        p.walks();
        if (style === 'backCounters') p.lineNorth(['backCounter', 'printer', 'backCounter', 'filingCabinet'], 1);
        else if (style === 'cabinets') p.lineNorth(['filingCabinet', 'filingCabinet', 'printer', 'waterCooler', 'filingCabinet'], 1);
        else p.lineNorth(['printer', 'filingCabinet', 'waterCooler'], 2);
        // A deep teller line has a back office: the head teller's and the clerks' desks behind the windows.
        if (p.h >= 4) p.groupsOf(workstation('clerk', style === 'cabinets' ? 'papers' : 'lamp'), Math.max(1, Math.floor((p.area - 20) / 14)));
        if (p.h >= 7) p.group(deskPair('clerk'));
        // The tellers' trolleys for the cash run, and filing along the side walls.
        p.groupsOf(accent('cashCart'), p.area >= 40 ? 2 : 1);
        p.fillGaps([workstation('clerk', 'papers'), storage(['filingCabinet', 'filingCabinet']), accent('plant')]);
        p.dense(['filingCabinet', 'plant', 'waterCooler', 'printer', 'filingCabinet'], 9, 12);
        for (const kind of ['crest', 'clock', 'painting'] as const) p.hang(kind);
        p.cameraCorners();
    };
}

function lobby(style: 'queue' | 'waiting' | 'open'): ParcelFn {
    return (p, ctx) => {
        const { room } = p, frame = p.frame;
        const front = frame.y + frame.h - 1;
        // A lobby in two pieces (the atrium) gets one set of fittings: the queue where it meets the counter, the mat
        // and the detector where the doors are, the seating in the piece with the doors.
        const teller = p.site.rooms.find(r => r.type === 'tellerLine' && r.bank)!;
        const atCounter = p.site.sharedEdges(room, teller).length > 0;
        const atDoors = p.site.doors.some(d => (d.a === room.id || d.b === room.id) && d.run === 'eastWest' && d.tx === ctx.frontDoorX && d.ty === front + 1);
        if (atDoors) {
            p.f.try({ kind: 'mat', tx: ctx.frontDoorX, ty: front }, room);
            if (ctx.metalDetector) p.f.try({ kind: 'metalDetector', tx: ctx.frontDoorX, ty: front - 2, span: [2, 1] }, room);
        }
        if (atCounter) {
            // The row in front of the counter stays free for the customers at the windows.
            for (const e of p.site.sharedEdges(room, teller)) if (e.run === 'eastWest') p.f.keep(e.tx, e.ty);
            // Queue rails from the counter, either side of the runner, with customers in the queue.
            const qx = Math.min(Math.max(ctx.frontDoorX, frame.x + 1), frame.x + frame.w - 6) - 1;
            if (style !== 'open') {
                p.f.try({ kind: 'queueRail', tx: qx, ty: frame.y + 1, length: 4, facing: 'east' }, room);
                p.f.try({ kind: 'queueRail', tx: qx + 3, ty: frame.y + 1, length: 4, facing: 'west' }, room);
            }
            for (let i = 0; i < 4; i++) {
                const dx = qx + 1 - frame.x + (i % 2), dy = 1 + Math.floor(i / 2);
                p.station('queue', p.mirror ? frame.w - 1 - dx : dx, dy, 'back');
            }
            p.put({ kind: 'writingDesk', dx: p.w - 4, dy: 2, wide: 2 }) || p.put({ kind: 'writingDesk', dx: 2, dy: 2, wide: 2 });
        }
        // A walk from the street doors to each of the lobby's other doors (the counter gate, the restrooms, the staff doors)
        // stays free of the seating and the cover that go in next.
        p.walks(true);
        if (style !== 'open' && atDoors) {
            // The sofa and its coffee table go in together, at the first spot along either side wall with room for both.
            const spots = [1, p.w - 3].flatMap(dx => Array.from({ length: Math.max(1, p.h - 5) }, (_, i) => ({ dx, dy: Math.max(2, p.h - 5) - i })));
            spots.some(({ dx, dy }) => {
                const mark = p.f.mark();
                if (p.put({ kind: 'sofa', dx, dy }) && p.put({ kind: 'coffeeTable', dx, dy: dy + 2 })) return true;
                p.f.rollback(mark);
                return false;
            });
        }
        p.put({ kind: 'brochureRack', dx: 0, dy: p.h - 3, facing: 'east', alignX: 'west' });
        p.put({ kind: 'plant', dx: 0, dy: 0, alignX: 'west', alignY: 'north' });
        p.put({ kind: 'plant', dx: p.w - 1, dy: p.h - 1, alignX: 'east' });
        p.put({ kind: 'bin', dx: p.w - 2, dy: p.h - 1 });
        for (let i = 0; i < (style === 'waiting' ? 3 : 1); i++) p.slot(['plant', 'bin', 'brochureRack']);
        // Customers waiting, writing, looking at the brochures.
        for (const [dx, dy] of [[p.w - 3, 3], [2, p.h - 3], [Math.floor(p.w / 2) + 3, p.h - 4], [3, 4]] as const) p.station('customer', dx, dy, 'back');
        p.cameraCorners();
    };
}

function restroom(stalls: number): ParcelFn {
    return p => {
        for (let i = 0; i < Math.min(stalls, p.w - 2); i++) p.put({ kind: 'toilet', dx: 1 + i * 2, dy: 0 });
        p.put({ kind: 'washbasin', dx: 0, dy: p.h - 2, facing: 'east', alignX: 'west', alignY: 'center' });
        p.put({ kind: 'washbasin', dx: 0, dy: p.h - 3, facing: 'east', alignX: 'west', alignY: 'center' });
        p.put({ kind: 'bin', dx: p.w - 1, dy: p.h - 1 });
        if (stalls === 1) p.slot(['boxes', 'mopBucket']);
    };
}

/** The ATM service room: the cash machine's safe, the refill cart with the cassettes, stock on shelves. */
function atmRoom(style: number): ParcelFn {
    return p => {
        const { room } = p;
        // The cash machine's back, against the front wall behind the ATM in the pier.
        const atm = p.site.tilesOfRoom(room).map(t => p.site.wallAt({ run: 'eastWest', tx: t.x, ty: t.y + 1 })).find(w => w?.kind === 'atm');
        if (atm) p.f.try({ kind: 'atmBack', tx: atm.tx, ty: atm.ty - 1, alignY: 'south' }, room);
        p.walks();
        const cart = p.group(accent('cashCart'), atm ? { near: [{ x: atm.tx, y: atm.ty - 1 }] } : {});
        p.lootAt(cart, 'cashCart', 'ATM cash cassettes', 20000, 'heavy', 1, 1);
        p.storageWalls(style === 1 ? ['shelving'] : STORE, 3, 1, 1 + style);
        if (style === 2) p.group(workstation('technician', 'papers'));
        p.fillGaps([loose(style === 1 ? 'cashCart' : 'boxes'), storage(STORE)]);
        p.dense(['boxes', 'shelving', 'cashCart'], 8);
        p.cameraCorners();
    };
}

/** The manager's office: the desk facing the door from across the room, shelves of files, a sofa or a small meeting table. */
function office(style: 'desk' | 'meeting' | 'shelves'): ParcelFn {
    return p => {
        p.walks();
        const desk = p.group(managerDesk(true), { away: 1.2, faceDoor: 2 }) ?? p.group(managerDesk(false), { away: 1.2, faceDoor: 2 });
        const manager = desk?.stations[0];
        if (manager) p.out.alarms.push({ tx: manager.tx, ty: manager.ty, name: "Manager's desk button", room: p.room.id });
        p.lootAt(desk, 'desk', "Manager's PC (vault code, time-lock schedule)", 0, 'light');
        if (style === 'shelves') p.storageWalls(['bookshelf', 'bookshelf', 'filingCabinet'], 4, 2, 2);
        else p.group(storage(style === 'desk' ? ['bookshelf', 'filingCabinet'] : ['filingCabinet', 'bookshelf', 'bookshelf']));
        if (style === 'meeting' && p.area >= 26) p.group(meeting(1, 'diningTable', 'smallMeeting'), desk ? { near: desk.tiles } : {});
        else if (p.area >= 28) p.group(lounge());
        p.group(accent('coatStand', 1));
        p.fillGaps([meeting(1, 'diningTable', 'smallMeeting'), lounge(), storage(['bookshelf', 'filingCabinet']), accent('plant')]);
        p.hang('painting');
        p.dense(['plant', 'filingCabinet', 'bookshelf'], 8);
    };
}

/** The break room: the kitchenette (someone making coffee), a table or two with chairs, lockers, a sofa when there is room. */
function breakRoom(style: 'table' | 'lockers' | 'both'): ParcelFn {
    return p => {
        p.walks();
        const kitchen = p.group(kitchenette('staff'));
        if (style !== 'lockers' || p.area >= 24) p.groupsOf(meeting(1, 'diningTable', 'dining'), p.area >= 44 ? 2 : 1, kitchen ? { near: kitchen.tiles } : {});
        if (style !== 'table') p.group(lockerBank(p.area >= 30 ? 3 : 2)) ?? p.group(lockerBank(2));
        if (style !== 'lockers' && p.area >= 34) p.group(lounge());
        p.fillGaps([meeting(1, 'diningTable', 'dining'), lounge(), lockerBank(2), accent('plant')]);
        p.hang('noticeBoard');
        p.dense(['plant', 'waterCooler', 'coatStand', 'lockers'], 8);
        p.cameraCorners();
    };
}

/** The cleaner's closet: their station of supplies and the mop, stock on shelves, the sewer grate in the floor. */
function closet(style: number): ParcelFn {
    return p => {
        p.spot('grates', 1, p.h - 1);
        p.walks();
        const station = p.group(cleaningStation());
        if (style === 1) p.group(storage(['lockers']));
        p.storageWalls(STORE, 2, 1, style + 1);
        p.lootAt(station, undefined, 'Back-door keys', 0, 'light');
        p.dense(STORE, 5);
    };
}

function corridor(style: number): ParcelFn {
    return p => {
        if (p.w > p.h) {
            p.hang('noticeBoard');
            if (style !== 1) p.hang('clock');
            if (style === 2) p.hang('painting');
        }
        p.cameraCorners();
        // Keycard readers beside the keycard doors in the corridor's walls (§8.15: what matters for play stays shown).
        for (const d of p.site.doors.filter(d => d.lock === 'keycard' && d.run === 'eastWest' && (d.a === p.room.id || d.b === p.room.id))) {
            p.f.try({ kind: 'keycardLed', tx: d.tx + 1, ty: d.ty, alignX: 'west' }) || p.f.try({ kind: 'keycardLed', tx: d.tx - 1, ty: d.ty, alignX: 'east' });
        }
        p.spot('hatches', p.w - 1, 0);
    };
}

/** The CCTV room: the operator's console and its recorder, the files, a second desk for whoever relieves them. */
function cctv(style: number): ParcelFn {
    return p => {
        p.spot('hatches', 0, 0);
        p.walks();
        const console = p.group(cctvConsole());
        const operator = console?.stations[0];
        if (operator) p.out.alarms.push({ tx: operator.tx, ty: operator.ty, name: 'CCTV console panic button', room: p.room.id });
        p.lootAt(console, 'recorder', 'Footage recorder', 0, 'light', p.w - 1, 0);
        p.group(storage(style === 1 ? ['filingCabinet', 'boxes'] : ['filingCabinet', 'filingCabinet']));
        if (style !== 0) p.hang('noticeBoard');
        if (style === 2 && p.area >= 30) p.group(workstation('guard', 'papers'));
        // The guards' room as much as the operator's: their lockers, a table to brief at.
        if (p.area >= 32) p.group(lockerBank(2));
        if (p.area >= 40) p.group(meeting(1, 'diningTable', 'briefing'));
        p.fillGaps([lockerBank(2), storage(['filingCabinet', 'boxes']), loose('boxes')]);
        p.dense(['filingCabinet', 'boxes', 'serverRack'], 8);
    };
}

/** The alarm and electrical closet: the panels on the wall, spares on shelving. */
function alarmCloset(style: number): ParcelFn {
    return p => {
        p.hang('alarmPanel') && p.alarm('Alarm panel', 0, 0);
        p.hang('breakerPanel');
        p.spot('grates', 1, p.h - 1);
        p.spot('hatches', 0, 0);
        p.walks();
        // The alarm's batteries and the phone-line rack, spares on shelving.
        if (p.area >= 20) p.group(serverRow(2, true), { facings: ['south', 'east', 'west'] });
        p.storageWalls(style === 1 ? ['shelving', 'boxes'] : ['shelving'], 3, 1, 2 + style);
        p.fillGaps([serverRow(2, false), loose('boxes')]);
        p.dense(STORE, 7);
    };
}

/** The server room: rows of racks with an aisle each side, more along the walls, the vent and the grate. */
function serverRoom(style: number): ParcelFn {
    return p => {
        p.spot('vents', 0, 0);
        p.spot('grates', p.w - 1, p.h - 1);
        p.walks();
        const rows = Math.max(1, Math.floor(p.area / 16));
        let placed = 0, first: PlacedGroup | undefined;
        for (let n = Math.min(5, p.w - 2); n >= 2 && placed < rows; n--) {
            const row = p.group(serverRow(n, style === 1));
            if (row) { placed++; n++; first ??= row; }
        }
        p.storageWalls(['serverRack'], 3, 1, style === 2 ? 3 : 1);
        p.fillGaps([serverRow(3, false), serverRow(2, false), loose('boxes')]);
        p.lootAt(first, undefined, 'Server drive rack', 15000, 'very heavy', 1, 1);
        p.dense(['serverRack', 'boxes', 'shelving'], 7);
    };
}

function antechamber(style: number): ParcelFn {
    return (p, ctx) => {
        const dx = style === 1 ? 1 : Math.max(0, p.w - 3);
        p.put({ kind: 'vaultConsole', dx, dy: 0, wide: 2, alignY: 'north' }) || p.along({ kind: 'vaultConsole', dy: 1, wide: 2 });
        if (style !== 2) p.put({ kind: 'cashCart', dx: style === 1 ? p.w - 1 : 0, dy: p.h - 1 });
        if (ctx.motionSensors) p.hang('motionSensor');
        p.walks();
        // Cash in transit between the vault and the counter waits here: carts and a cash shelf.
        p.storageWalls(['cashShelf'], 2, 1, 1);
        p.group(loose('cashCart'));
        p.fillGaps([loose('cashCart')], 2);
        p.dense(['cashCart', 'cashShelf', 'cashCart'], 8);
        p.cameraCorners();
    };
}

/** The vault: cash shelving and deposit boxes along every wall, carts waiting in the middle. */
function vault(style: number): ParcelFn {
    return (p, ctx) => {
        p.walks();
        const kinds: Kind[] = style === 1 ? ['depositBoxes', 'cashShelf'] : style === 2 ? ['cashShelf'] : ['cashShelf', 'cashShelf', 'depositBoxes'];
        p.storageWalls(kinds, Math.max(2, p.w), 1);
        p.groupsOf(loose('cashCart'), p.area >= 40 ? 2 : 1);
        p.fillGaps([loose('cashCart')], 2);
        if (ctx.motionSensors) p.hang('motionSensor');
        p.loot(`Vault cash (class ${ctx.vaultClass})`, 40000, 'heavy', 1, 1);
        p.loot('Gold crate', 120000, 'very heavy', Math.floor(p.w / 2), 1);
    };
}

/** The deposit-box room: walls of boxes, a table to open one at. */
function depositRoom(style: number): ParcelFn {
    return p => {
        p.walks();
        p.storageWalls(['depositBoxes'], Math.max(2, p.w), style === 1 ? 2 : 1);
        p.group(viewingTable());
        if (style === 2) p.group(accent('chair'));
        p.fillGaps([viewingTable(), storage(['depositBoxes', 'depositBoxes']), accent('plant')]);
        p.loot('Deposit boxes (jewels, one holds intel)', 30000, 'light', 0, 0);
        p.dense(['depositBoxes', 'plant'], 8);
        p.cameraCorners();
    };
}

function loadingBay(style: number): ParcelFn {
    return p => {
        p.spot('grates', p.w - 2, p.h - 1);
        p.walks();
        p.group(accent('cashCart'));
        p.storageWalls(['boxes', 'boxes', 'shelving'], 3, 1, 2 + style);
        p.cameraCorners();
    };
}

function gallery(style: number): ParcelFn {
    return p => {
        if (style !== 2) p.put({ kind: 'plant', dx: 0, dy: 0, alignY: 'north' });
        if (style === 1) p.put({ kind: 'plant', dx: 0, dy: p.h - 1 });
    };
}

function mantrap(p: Parcel): void {
    p.cameraCorners();
}

/** The counting room: one counting table, two in a big room, cash waiting in carts and on shelves round it. */
function countingRoom(style: number): ParcelFn {
    return p => {
        p.walks();
        const table = p.group(countingTable());
        p.lootAt(table, 'table', 'Cash being counted', 25000, 'heavy', 1, 1);
        if (p.area >= 36) p.group(countingTable(), table ? { near: table.tiles } : {});
        p.group(storage(style === 2 ? ['filingCabinet', 'cashShelf', 'cashShelf'] : ['cashShelf', 'shelving']));
        p.groupsOf(accent('cashCart'), style === 1 ? 2 : 1, table ? { near: table.tiles } : {});
        p.fillGaps([countingTable(), loose('cashCart')]);
        p.dense(['cashCart', 'boxes', 'filingCabinet'], 8);
        p.cameraCorners();
    };
}

/** The records room: free-standing stacks down the middle, storage along every wall, maybe the archivist's desk. */
function records(style: number): ParcelFn {
    return p => {
        p.walks();
        if (style === 2) p.group(workstation('archivist', 'papers'));
        for (let i = 0, n = Math.min(4, p.w - 2); i < (p.area >= 40 ? 2 : 1) && n >= 2; i++) {
            while (n >= 2 && !p.group(stacks(n))) n--;
        }
        p.storageWalls(style === 1 ? ['filingCabinet', 'filingCabinet', 'shelving'] : ['shelving', 'shelving', 'filingCabinet'], 5, 1);
        p.fillGaps([stacks(3), stacks(2), loose('boxes')]);
        p.loot('Loan files and the branch records (intel)', 0, 'light', 0, 0);
        p.dense(['boxes', 'filingCabinet'], 6);
    };
}

/**
 * The staff office: the loan officers' desks, one per eleven tiles or so, along the walls and (in a big room) front to
 * front in the middle; filing and the printer along a wall.
 */
function staffOffice(style: number): ParcelFn {
    return p => {
        p.walks();
        const want = Math.max(2, Math.round(p.area / 11));
        let desks = 0;
        if (style !== 1 && Math.min(p.w, p.h) >= 6) for (let i = 0; i < 2 && desks + 2 <= want; i++) if (p.group(deskPair('clerk'))) desks += 2;
        for (let i = 0; desks < want && i < want; i++) if (p.group(workstation('clerk', (i + style) % 2 ? 'lamp' : 'papers'))) desks++;
        // The loan files: cabinets and a bookcase of binders by the printer (a storage wall is cover, lesson 11).
        p.group(storage(style === 1 ? ['filingCabinet', 'printer', 'bookshelf'] : ['bookshelf', 'filingCabinet', 'printer']))
            ?? p.group(storage(['bookshelf', 'printer']));
        p.group(accent('plant', 1));
        p.fillGaps([deskPair('clerk'), workstation('clerk', 'lamp'), storage(['filingCabinet', 'bookshelf']), accent('plant')]);
        p.hang(style === 0 ? 'noticeBoard' : 'clock');
        p.dense(['plant', 'filingCabinet', 'waterCooler', 'coatStand', 'bookshelf'], 8);
        p.cameraCorners();
    };
}

/**
 * The conference room: a meeting table with chairs round it (a plain table in a small room), the whiteboard on the wall
 * by it, a sideboard or bookcases, and in a big room a sofa to wait on.
 */
function conference(style: number): ParcelFn {
    return p => {
        p.walks();
        const options = p.area < 30 && style === 2 ? [meeting(1, 'diningTable')] : [meeting(1, 'meetingTable'), meeting(1, 'diningTable')];
        let table: PlacedGroup | undefined;
        for (const def of options) if ((table = p.group(def))) break;
        if (table) p.hangNear('whiteboard', Parcel.middle(table));
        if (style === 1) p.group(storage(['bookshelf', 'bookshelf']));
        else p.group(sideboard());
        if (style === 2) p.group(storage(['bookshelf', 'filingCabinet']));
        if (p.area >= 40) p.group(lounge());
        p.group(accent('coatStand', 1));
        p.fillGaps([lounge(), storage(['bookshelf', 'bookshelf']), accent('plant')]);
        p.hang('painting');
        p.dense(['plant', 'bookshelf', 'waterCooler'], 9);
    };
}

/** Furnishes every bank room with one of its type's parcels, mirrored at random, then tells each room's story. */
export function furnishBank(site: Site, rooms: GenRoom[], furnish: Furnisher, rng: Rng, ctx: ParcelContext): Furnished {
    const out = emptyFurnished();
    if (ctx.driveWindow) driveThrough(site, furnish, ctx.driveWindow, out);
    // The rooms with fixed pieces first, so the slots fill in round them.
    const order: RoomType[] = ['tellerLine', 'antechamber', 'vault', 'cctvRoom', 'managerOffice', 'atmRoom', 'lobby'];
    const sorted = [...rooms].sort((a, b) => rank(order, a.type) - rank(order, b.type));
    const parcels: Parcel[] = [];
    for (const room of sorted) {
        const fns = PARCELS[room.type];
        if (!fns) continue;
        const pick = rng.fork(room.id);
        const parcel = new Parcel(room, furnish, pick, pick.chance(0.5), out, site);
        pick.pick(fns)(parcel, ctx);
        parcels.push(parcel);
    }
    tellStories(parcels, rng.fork('stories'));
    return out;
}

/**
 * The drive-through's station (its counter went in with the window), before the room's own parcel: the teller behind
 * the counter, with the alarm button and a cash drawer.
 */
function driveThrough(site: Site, furnish: Furnisher, window: { x: number; y: number }, out: Furnished): void {
    const room = site.roomAt(window.x, window.y)!;
    const teller = { tx: window.x - 1, ty: window.y };
    if (!furnish.stand(teller.tx, teller.ty)) throw new Error(`No room for the drive-through teller in ${room.type}`);
    out.stations.push({ ...teller, facing: 'front', role: 'driveTeller', room: room.id });
    out.alarms.push({ ...teller, name: 'Drive-through alarm button', room: room.id });
    out.loot.push({ ...teller, name: 'Drive-through cash drawer', value: 4000, weight: 'light', room: room.id });
}

const rank = (order: RoomType[], t: RoomType) => (order.includes(t) ? order.indexOf(t) : order.length);
