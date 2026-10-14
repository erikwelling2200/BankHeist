import type { LevelProp, PersonFacing } from '../level/plan';
import type { Facing } from '../level/space';
import type { Furnisher } from './furnish';
import type { GenRoom, RoomType } from './model';
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

/** One room being furnished: positions are measured from its west wall, or from its east wall when mirrored. */
class Parcel {
    constructor(readonly room: GenRoom, readonly f: Furnisher, readonly rng: Rng, readonly mirror: boolean, readonly out: Furnished, readonly site: Site) {}

    get w(): number { return this.room.w; }
    get h(): number { return this.room.h; }

    /** The tile column `dx` tiles in from the parcel's west (east when mirrored), for something `span` tiles wide. */
    x(dx: number, span = 1): number {
        return this.mirror ? this.room.x + this.room.w - dx - span : this.room.x + dx;
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
        const prop = this.flip({ ...rest, tx: this.x(dx, wide ?? 1), ty: this.room.y + dy } as LevelProp);
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

    /** A prop slot: one of `pool`, on any free tile of the room, kept off the middle so the room stays walkable. */
    slot(pool: LevelProp['kind'][], edge = true): boolean {
        const tiles: [number, number][] = [];
        for (let dy = 0; dy < this.h; dy++) for (let dx = 0; dx < this.w; dx++) {
            const onEdge = dx === 0 || dy === 0 || dx === this.w - 1 || dy === this.h - 1;
            if (!edge || onEdge) tiles.push([dx, dy]);
        }
        for (const [dx, dy] of this.rng.shuffle(tiles)) {
            const kind = this.rng.pick(pool);
            const alignX = dx === 0 ? 'west' : dx === this.w - 1 ? 'east' : undefined;
            const alignY = dy === 0 ? 'north' : dy === this.h - 1 ? 'south' : undefined;
            if (this.put({ kind, dx, dy, ...(alignX ? { alignX } : {}), ...(alignY ? { alignY } : {}) } as never)) return true;
        }
        return false;
    }

    /** Someone's place: kept free, recorded with their role. */
    station(role: string, dx: number, dy: number, facing: PersonFacing): boolean {
        const tx = this.x(dx), ty = this.room.y + dy;
        if (!this.f.canStand(tx, ty) || this.f.isKept(tx, ty) && !this.isDoorless(tx, ty)) return false;
        if (!this.f.stand(tx, ty)) return false;
        this.out.stations.push({ tx, ty, facing, role, room: this.room.id });
        return true;
    }

    private isDoorless(tx: number, ty: number): boolean {
        return !this.site.doors.some(d => (d.tx === tx && d.ty === ty) || (d.run === 'eastWest' && d.tx === tx && d.ty === ty + 1) || (d.run === 'northSouth' && d.tx === tx + 1 && d.ty === ty));
    }

    /** A camera in a north corner, looking along the room. */
    cameraCorners(): void {
        for (const [dx, facing, alignX] of [[0, 'east', 'west'], [this.w - 1, 'west', 'east']] as const) {
            const tx = this.x(dx), prop = this.flip({ kind: 'camera', tx: this.room.x + dx, ty: this.room.y, facing, alignX } as LevelProp);
            void tx;
            this.out.cameraSlots.push({ tx: prop.tx, ty: prop.ty, facing: prop.facing!, room: this.room.id, prop });
        }
    }

    alarm(name: string, dx: number, dy: number): void {
        this.out.alarms.push({ tx: this.x(dx), ty: this.room.y + dy, name, room: this.room.id });
    }

    loot(name: string, value: number, weight: Furnished['loot'][number]['weight'], dx: number, dy: number): void {
        this.out.loot.push({ tx: this.x(dx), ty: this.room.y + dy, name, value, weight, room: this.room.id });
    }
}

type ParcelFn = (p: Parcel, ctx: ParcelContext) => void;

/** What the parcels need to know beyond the room: where the counter's gate is, the tier's numbers, the front door. */
export interface ParcelContext { gateX: number; tellers: number; frontDoorX: number; metalDetector: boolean; motionSensors: boolean; dyePacks: boolean; vaultClass: string }

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
    mantrap: [mantrap, mantrap, mantrap]
};

function tellerLine(style: 'backCounters' | 'cabinets' | 'mixed'): ParcelFn {
    return (p, ctx) => {
        const { room } = p, row = room.y + room.h - 1;
        // The counter along the front row, a window every four tiles, the gate where the doors put it.
        const windows: number[] = [];
        for (let x = room.x + 2; x < room.x + room.w - 2; x += 4) if (Math.abs(x - ctx.gateX) > 1) windows.push(x);
        const open = windows.slice(0, Math.max(1, ctx.tellers));
        const counter: LevelProp = { kind: 'counter', tx: room.x, ty: row, width: room.w, stations: windows, closed: windows.filter(x => !open.includes(x)), gate: ctx.gateX };
        p.f.try(counter, room);
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
        const { room } = p;
        const front = room.y + room.h - 1;
        p.f.try({ kind: 'mat', tx: ctx.frontDoorX, ty: front }, room);
        if (ctx.metalDetector) p.f.try({ kind: 'metalDetector', tx: ctx.frontDoorX, ty: front - 2, span: [2, 1] }, room);
        // Queue rails from the counter, either side of the runner, with customers in the queue.
        if (style !== 'open') {
            const qx = ctx.frontDoorX - 1;
            p.f.try({ kind: 'queueRail', tx: qx, ty: room.y + 1, length: 4, facing: 'east' }, room);
            p.f.try({ kind: 'queueRail', tx: qx + 3, ty: room.y + 1, length: 4, facing: 'west' }, room);
        }
        for (let i = 0; i < 4; i++) {
            const dx = ctx.frontDoorX - room.x + (i % 2), dy = 1 + Math.floor(i / 2);
            p.station('queue', p.mirror ? room.w - 1 - dx : dx, dy, 'back');
        }
        if (style !== 'open') {
            p.put({ kind: 'sofa', dx: 1, dy: Math.max(2, room.h - 5) });
            p.put({ kind: 'coffeeTable', dx: 1, dy: Math.max(2, room.h - 5) + 2 });
        }
        p.put({ kind: 'writingDesk', dx: room.w - 4, dy: 2, wide: 2 }) || p.put({ kind: 'writingDesk', dx: 2, dy: 2, wide: 2 });
        p.put({ kind: 'brochureRack', dx: 0, dy: room.h - 3, facing: 'east', alignX: 'west' });
        p.put({ kind: 'plant', dx: 0, dy: 0, alignX: 'west', alignY: 'north' });
        p.put({ kind: 'plant', dx: room.w - 1, dy: room.h - 1, alignX: 'east' });
        p.put({ kind: 'bin', dx: room.w - 2, dy: room.h - 1 });
        for (let i = 0; i < (style === 'waiting' ? 3 : 1); i++) p.slot(['plant', 'bin', 'brochureRack']);
        // Customers waiting, writing, looking at the brochures.
        for (const [dx, dy] of [[room.w - 3, 3], [2, room.h - 3], [Math.floor(room.w / 2) + 3, room.h - 4], [3, 4]] as const) p.station('customer', dx, dy, 'back');
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
        const atm = p.site.walls.get(`eastWest ${room.x + Math.floor(room.w / 2)} ${room.y + room.h}`);
        if (atm?.kind === 'atm') p.f.try({ kind: 'atmBack', tx: atm.tx, ty: room.y + room.h - 1, alignY: 'south' }, room);
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
        p.out.grates.push({ tx: p.x(1), ty: p.room.y + p.h - 1, room: p.room.id });
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
        p.out.hatches.push({ tx: p.x(p.w - 1), ty: p.room.y, room: p.room.id });
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
        p.out.hatches.push({ tx: p.x(0), ty: p.room.y, room: p.room.id });
    };
}

function alarmCloset(style: number): ParcelFn {
    return p => {
        p.hang('alarmPanel') && p.alarm('Alarm panel', 0, 0);
        p.hang('breakerPanel');
        if (style !== 1) p.lineNorth(['shelving'], p.w - 1);
        p.slot(STORE);
        p.out.grates.push({ tx: p.x(1), ty: p.room.y + p.h - 1, room: p.room.id });
        p.out.hatches.push({ tx: p.x(0), ty: p.room.y, room: p.room.id });
        if (style === 2) p.slot(STORE);
    };
}

function serverRoom(style: number): ParcelFn {
    return p => {
        for (let dx = 1; dx < p.w - 1; dx += style === 1 ? 2 : 3) p.put({ kind: 'serverRack', dx, dy: 1 }) || p.put({ kind: 'serverRack', dx, dy: 0, alignY: 'north' });
        p.out.vents.push({ tx: p.x(0), ty: p.room.y, room: p.room.id });
        p.loot('Server drive rack', 15000, 'very heavy', 1, 1);
        p.out.grates.push({ tx: p.x(p.w - 1), ty: p.room.y + p.h - 1, room: p.room.id });
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
        p.out.grates.push({ tx: p.x(p.w - 2), ty: p.room.y + p.h - 1, room: p.room.id });
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

/** Furnishes every bank room with one of its type's parcels, mirrored at random. */
export function furnishBank(site: Site, rooms: GenRoom[], furnish: Furnisher, rng: Rng, ctx: ParcelContext): Furnished {
    const out = emptyFurnished();
    // The rooms with fixed pieces first, so the slots fill in round them.
    const order: RoomType[] = ['tellerLine', 'antechamber', 'vault', 'cctvRoom', 'managerOffice', 'atmRoom', 'lobby'];
    const sorted = [...rooms].sort((a, b) => rank(order, a.type) - rank(order, b.type));
    for (const room of sorted) {
        const parcels = PARCELS[room.type];
        if (!parcels) continue;
        const pick = rng.fork(room.id);
        const parcel = new Parcel(room, furnish, pick, pick.chance(0.5), out, site);
        pick.pick(parcels)(parcel, ctx);
    }
    return out;
}

const rank = (order: RoomType[], t: RoomType) => (order.includes(t) ? order.indexOf(t) : order.length);

export { COVER };
