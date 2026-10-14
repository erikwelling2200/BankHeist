import type { LevelProp, PersonFacing } from '../level/plan';
import type { Facing } from '../level/space';
import type { Furnisher } from './furnish';
import type { GenRoom, Rect, RoomType } from './model';
import type { Rng } from './rng';
import type { Site } from './site';

/*
 * Room parcels (§17.1 layer 2, §17.2 step 5): hand-authored furnishings for each room type, three or more per type,
 * each also mirrored east to west, so a room type comes in six or more variants. A parcel places its fixed pieces
 * (the counter, the vault console, the CCTV desk) and its prop slots, which take random cover from a pool (a plant, a
 * filing cabinet, boxes). It also marks where people work (stations), the silent-alarm buttons, where a camera can
 * hang, and the loot.
 */

/** Where someone works or waits: a teller's window, the manager's chair, a customer's place in the queue. */
export interface Station { tx: number; ty: number; facing: PersonFacing; role: string; room: string }

/** A wall spot a camera can hang on, looking into the room. */
export interface CameraSlot { tx: number; ty: number; facing: Facing; room: string; prop: LevelProp }

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
}

export const emptyFurnished = (): Furnished => ({ stations: [], cameraSlots: [], alarms: [], loot: [], grates: [], vents: [], hatches: [] });

/**
 * One room being furnished: positions are measured from the west wall of its largest rectangle (its `frame`), or from
 * its east wall when mirrored. The rest of an L-shaped room is furnished through its prop slots.
 */
class Parcel {
    readonly frame: Rect;

    constructor(readonly room: GenRoom, readonly f: Furnisher, readonly rng: Rng, readonly mirror: boolean, readonly out: Furnished, readonly site: Site) {
        this.frame = room.parts[0]!;
    }

    get w(): number { return this.frame.w; }
    get h(): number { return this.frame.h; }
    /** The frame's north row. */
    get top(): number { return this.frame.y; }

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

const COVER: LevelProp['kind'][] = ['plant', 'filingCabinet', 'waterCooler'];
const STORE: LevelProp['kind'][] = ['boxes', 'shelving'];

/** The parcels by room type: every type has three or more, each also mirrored. */
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
        if (style === 'backCounters') p.lineNorth(['backCounter', 'printer', 'backCounter', 'filingCabinet'], 1);
        else if (style === 'cabinets') p.lineNorth(['filingCabinet', 'filingCabinet', 'printer', 'waterCooler', 'filingCabinet'], 1);
        else p.lineNorth(['printer', 'filingCabinet', 'waterCooler'], 2);
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
        if (style !== 'open' && atDoors) {
            p.put({ kind: 'sofa', dx: 1, dy: Math.max(2, p.h - 5) });
            p.put({ kind: 'coffeeTable', dx: 1, dy: Math.max(2, p.h - 5) + 2 });
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

function atmRoom(style: number): ParcelFn {
    return p => {
        const { room } = p;
        // The cash machine's back, against the front wall behind the ATM in the pier.
        const atm = p.site.tilesOfRoom(room).map(t => p.site.wallAt({ run: 'eastWest', tx: t.x, ty: t.y + 1 })).find(w => w?.kind === 'atm');
        if (atm) p.f.try({ kind: 'atmBack', tx: atm.tx, ty: atm.ty - 1, alignY: 'south' }, room);
        p.put({ kind: 'cashCart', dx: 1, dy: 1 + style % 2 });
        p.loot('ATM cash cassettes', 20000, 'heavy', 1, 1);
        p.slot(STORE);
        if (style === 2) p.slot(STORE);
        p.cameraCorners();
    };
}

function office(style: 'desk' | 'meeting' | 'shelves'): ParcelFn {
    return p => {
        const cx = Math.max(1, Math.floor(p.w / 2) - 1), cy = Math.min(2, p.h - 2);
        if (p.put({ kind: 'desk', dx: cx, dy: cy, wide: 2 })) {
            p.station('manager', cx, cy - 1, 'front');
            p.alarm("Manager's desk button", cx, cy - 1);
            p.put({ kind: 'chair', dx: cx, dy: cy + 1, facing: 'north' });
            if (style === 'meeting') p.put({ kind: 'chair', dx: cx + 1, dy: cy + 1, facing: 'north' });
        }
        p.lineNorth(style === 'shelves' ? ['bookshelf', 'bookshelf', 'filingCabinet', 'bookshelf'] : ['bookshelf', 'filingCabinet'], 0);
        p.hang('painting');
        p.slot(['plant', 'filingCabinet']);
        p.loot("Manager's PC (vault code, time-lock schedule)", 0, 'light', cx, cy);
    };
}

function breakRoom(style: 'table' | 'lockers' | 'both'): ParcelFn {
    return p => {
        p.lineNorth(style === 'lockers' ? ['lockers', 'lockers', 'lockers', 'fridge'] : ['kitchenCounter', 'fridge', 'lockers', 'lockers'], 0);
        if (style !== 'lockers' || p.h >= 5) {
            const dx = Math.max(1, Math.floor(p.w / 2) - 1), dy = Math.min(p.h - 2, 2);
            if (p.put({ kind: 'diningTable', dx, dy, wide: 2 })) {
                p.put({ kind: 'chair', dx: dx - 1, dy, facing: 'east' });
                p.put({ kind: 'chair', dx: dx + 2, dy, facing: 'west' });
            }
        }
        p.hang('noticeBoard');
        p.slot(['waterCooler', 'plant']);
        p.station('staff', 1, p.h - 1, 'back');
        p.cameraCorners();
    };
}

function closet(style: number): ParcelFn {
    return p => {
        p.lineNorth(style === 1 ? ['shelving', 'lockers'] : ['shelving', 'shelving'], 0);
        p.put({ kind: 'mopBucket', dx: p.w - 1, dy: p.h - 1 });
        if (style !== 0) p.slot(STORE);
        p.out.grates.push({ tx: p.x(1), ty: p.top + p.h - 1, room: p.room.id });
        p.loot('Back-door keys', 0, 'light', 0, 0);
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
        p.out.hatches.push({ tx: p.x(p.w - 1), ty: p.top, room: p.room.id });
    };
}

function cctv(style: number): ParcelFn {
    return p => {
        const dx = Math.max(0, Math.floor(p.w / 2) - 1);
        if (p.put({ kind: 'cctvDesk', dx, dy: 0, wide: 2, alignY: 'north' })) {
            p.station('operator', dx, 1, 'back');
            p.alarm('CCTV console panic button', dx, 1);
        }
        p.put({ kind: 'serverRack', dx: p.w - 1, dy: 0, alignY: 'north' });
        p.loot('Footage recorder', 0, 'light', p.w - 1, 0);
        if (style !== 0) p.hang('noticeBoard');
        if (style === 2) p.slot(['filingCabinet', 'boxes']);
        p.out.hatches.push({ tx: p.x(0), ty: p.top, room: p.room.id });
    };
}

function alarmCloset(style: number): ParcelFn {
    return p => {
        p.hang('alarmPanel') && p.alarm('Alarm panel', 0, 0);
        p.hang('breakerPanel');
        if (style !== 1) p.lineNorth(['shelving'], p.w - 1);
        p.slot(STORE);
        p.out.grates.push({ tx: p.x(1), ty: p.top + p.h - 1, room: p.room.id });
        p.out.hatches.push({ tx: p.x(0), ty: p.top, room: p.room.id });
        if (style === 2) p.slot(STORE);
    };
}

function serverRoom(style: number): ParcelFn {
    return p => {
        for (let dx = 1; dx < p.w - 1; dx += style === 1 ? 2 : 3) p.put({ kind: 'serverRack', dx, dy: 1 }) || p.put({ kind: 'serverRack', dx, dy: 0, alignY: 'north' });
        p.out.vents.push({ tx: p.x(0), ty: p.top, room: p.room.id });
        p.loot('Server drive rack', 15000, 'very heavy', 1, 1);
        p.out.grates.push({ tx: p.x(p.w - 1), ty: p.top + p.h - 1, room: p.room.id });
    };
}

function antechamber(style: number): ParcelFn {
    return (p, ctx) => {
        const dx = style === 1 ? 1 : Math.max(0, p.w - 3);
        p.put({ kind: 'vaultConsole', dx, dy: 0, wide: 2, alignY: 'north' }) || p.along({ kind: 'vaultConsole', dy: 1, wide: 2 });
        if (style !== 2) p.put({ kind: 'cashCart', dx: style === 1 ? p.w - 1 : 0, dy: p.h - 1 });
        if (ctx.motionSensors) p.hang('motionSensor');
        p.cameraCorners();
    };
}

function vault(style: number): ParcelFn {
    return (p, ctx) => {
        const kinds: LevelProp['kind'][] = style === 1 ? ['depositBoxes', 'cashShelf'] : style === 2 ? ['cashShelf'] : ['cashShelf', 'cashShelf', 'depositBoxes'];
        for (let dx = 0; dx < p.w; dx++) p.put({ kind: kinds[dx % kinds.length]!, dx, dy: 0, alignY: 'north' });
        p.put({ kind: 'cashCart', dx: Math.floor(p.w / 2), dy: p.h - 2 });
        if (ctx.motionSensors) p.hang('motionSensor');
        p.loot(`Vault cash (class ${ctx.vaultClass})`, 40000, 'heavy', 1, 1);
        p.loot('Gold crate', 120000, 'very heavy', Math.floor(p.w / 2), 1);
    };
}

function depositRoom(style: number): ParcelFn {
    return p => {
        for (let dx = 0; dx < p.w; dx++) if (style !== 1 || dx % 3 !== 2) p.put({ kind: 'depositBoxes', dx, dy: 0, alignY: 'north' });
        p.put({ kind: 'diningTable', dx: Math.max(1, Math.floor(p.w / 2) - 1), dy: Math.min(p.h - 2, 3), wide: 2 });
        if (style === 2) p.put({ kind: 'chair', dx: 0, dy: 3, facing: 'east' });
        p.loot('Deposit boxes (jewels, one holds intel)', 30000, 'light', 0, 0);
        p.cameraCorners();
    };
}

function loadingBay(style: number): ParcelFn {
    return p => {
        p.put({ kind: 'cashCart', dx: 1, dy: p.h - 2 });
        for (let i = 0; i < 2 + style; i++) p.slot(STORE);
        p.out.grates.push({ tx: p.x(p.w - 2), ty: p.top + p.h - 1, room: p.room.id });
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

/**
 * The counting room (interim, until furnishing by activity): a counting table with the cash on it and the counters'
 * chairs, cash carts waiting, storage along the north wall.
 */
function countingRoom(style: number): ParcelFn {
    return p => {
        const dx = Math.max(1, Math.floor(p.w / 2) - 1), dy = Math.min(p.h - 2, 2);
        if (p.put({ kind: 'diningTable', dx, dy, wide: 2 })) {
            p.put({ kind: 'chair', dx: dx - 1, dy, facing: 'east' });
            if (style !== 1) p.put({ kind: 'chair', dx: dx + 2, dy, facing: 'west' });
            p.loot('Cash being counted', 25000, 'heavy', dx, dy);
        }
        p.lineNorth(style === 2 ? ['filingCabinet', 'shelving', 'shelving'] : ['shelving', 'filingCabinet'], 0);
        p.put({ kind: 'cashCart', dx: 0, dy: p.h - 1 }) || p.slot(['cashCart']);
        if (style !== 0) p.slot(['cashCart', 'boxes']);
        p.cameraCorners();
    };
}

/** The records room (interim): storage walls of shelving and filing cabinets, the files that hold intel (§17.6). */
function records(style: number): ParcelFn {
    return p => {
        p.lineNorth(style === 1 ? ['filingCabinet', 'filingCabinet', 'shelving', 'filingCabinet'] : ['shelving', 'shelving', 'filingCabinet', 'shelving'], 0);
        // A second storage wall across the room, where it is deep enough to walk behind.
        if (p.h >= 5 && style !== 2) for (let dx = 1; dx < p.w - 1; dx++) p.put({ kind: 'shelving', dx, dy: 2 });
        if (style === 2) p.put({ kind: 'desk', dx: Math.max(0, p.w - 3), dy: p.h - 2, wide: 2 }) && p.put({ kind: 'chair', dx: Math.max(0, p.w - 3), dy: p.h - 1, facing: 'north' });
        p.slot(['boxes', 'filingCabinet']);
        p.loot('Loan files and the branch records (intel)', 0, 'light', 0, 0);
    };
}

/** The staff office (interim): the loan officers' desks in rows, each with its chair, filing along the north wall. */
function staffOffice(style: number): ParcelFn {
    return p => {
        p.lineNorth(style === 1 ? ['filingCabinet', 'printer', 'filingCabinet'] : ['filingCabinet', 'filingCabinet', 'waterCooler'], 0);
        for (let dy = 2; dy + 1 < p.h; dy += 3) for (let dx = 1 + (style === 2 ? 1 : 0); dx + 2 <= p.w; dx += 4) {
            if (p.put({ kind: 'desk', dx, dy, wide: 2 })) p.put({ kind: 'chair', dx, dy: dy + 1, facing: 'north' });
        }
        p.hang(style === 0 ? 'noticeBoard' : 'clock');
        p.slot(['plant', 'filingCabinet']);
        p.cameraCorners();
    };
}

/** The conference room (interim): a meeting table (dining tables end to end) with chairs down both sides. */
function conference(style: number): ParcelFn {
    return p => {
        const tables = p.w >= 8 && style !== 1 ? 2 : 1, dx = Math.max(1, Math.floor((p.w - 2 * tables) / 2)), dy = Math.max(1, Math.floor(p.h / 2) - 1);
        for (let t = 0; t < tables; t++) if (p.put({ kind: 'diningTable', dx: dx + 2 * t, dy, wide: 2 })) {
            for (const side of [0, 1]) {
                p.put({ kind: 'chair', dx: dx + 2 * t + side, dy: dy - 1, facing: 'south' });
                p.put({ kind: 'chair', dx: dx + 2 * t + side, dy: dy + 1, facing: 'north' });
            }
        }
        p.lineNorth(style === 2 ? ['bookshelf', 'bookshelf'] : ['bookshelf'], 0);
        p.hang('painting');
        p.slot(['plant', 'waterCooler']);
    };
}

/** Furnishes every bank room with one of its type's parcels, mirrored at random. */
export function furnishBank(site: Site, rooms: GenRoom[], furnish: Furnisher, rng: Rng, ctx: ParcelContext): Furnished {
    const out = emptyFurnished();
    if (ctx.driveWindow) driveThrough(site, furnish, ctx.driveWindow, out);
    // The rooms with fixed pieces first, so the slots fill in round them.
    const order: RoomType[] = ['tellerLine', 'antechamber', 'vault', 'cctvRoom', 'managerOffice', 'atmRoom', 'lobby'];
    const sorted = [...rooms].sort((a, b) => rank(order, a.type) - rank(order, b.type));
    for (const room of sorted) {
        const parcels = PARCELS[room.type];
        if (!parcels) continue;
        const pick = rng.fork(room.id);
        const parcel = new Parcel(room, furnish, pick, pick.chance(0.5), out, site);
        pick.pick(parcels)(parcel, ctx);
        fill(parcel);
    }
    return out;
}

/** What fills out a room stretched past its parcel's size, by type: more of what the room already holds. */
const FILL: Partial<Record<RoomType, LevelProp['kind'][]>> = {
    managerOffice: ['filingCabinet', 'bookshelf', 'plant'],
    breakRoom: ['lockers', 'plant', 'waterCooler'],
    atmRoom: STORE,
    cleanersCloset: STORE,
    alarmCloset: STORE,
    loadingBay: ['boxes', 'boxes', 'shelving'],
    restroom: ['bin'],
    cctvRoom: ['filingCabinet', 'boxes'],
    countingRoom: ['boxes', 'filingCabinet'],
    recordsRoom: ['filingCabinet', 'shelving', 'boxes'],
    staffOffice: ['filingCabinet', 'plant', 'printer'],
    conferenceRoom: ['plant', 'bookshelf']
};

/**
 * A parcel is laid out for a room of its type's usual size; a bigger room gets a second table where it has one, and
 * cover along its walls for every ten tiles over twenty.
 */
function fill(p: Parcel): void {
    const pool = FILL[p.room.type];
    if (!pool) return;
    if (p.h >= 8 && (p.room.type === 'breakRoom' || p.room.type === 'managerOffice')) {
        const dx = Math.max(1, Math.floor(p.w / 2) - 1), dy = p.h - 3;
        if (p.put({ kind: 'diningTable', dx, dy, wide: 2 })) {
            p.put({ kind: 'chair', dx: dx - 1, dy, facing: 'east' });
            p.put({ kind: 'chair', dx: dx + 2, dy, facing: 'west' });
        }
    }
    const extra = Math.min(6, Math.floor((p.site.tilesOfRoom(p.room).length - 20) / 10));
    for (let i = 0; i < extra; i++) p.slot(pool);
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

export { COVER };
