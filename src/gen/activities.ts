import type { GroupDef, Kind, Piece } from './groups';

/*
 * The functional groups rooms are furnished with (research/procedural-interiors.md, lesson 5): what people do in a bank,
 * each as an anchor and its satellites in the anchor's own frame. The frame's north is the group's back (the wall it
 * stands against, if any), south its front, the room. Things on a top give their middle in pixels in the top's own
 * frame (`u` across its front, `v` from its back): a desk is 20 by 10 pixels, a table 20 by 11, the meeting table 45
 * by 14, the kitchen counter 29 by 8, the CCTV desk 25 by 9.
 *
 * People are drawn standing, so a station is the tile beside the chair, not the chair's own: someone at their desk
 * stands in front of its other half (or has just got up), and an empty desk keeps its chair pushed in.
 */

/**
 * A clerk's desk against a wall: they face the wall, the monitor turned to them over the chair, a lamp or papers on the
 * other half where they stand, a bin beside the desk.
 */
export function workstation(role: string, dress: 'lamp' | 'papers'): GroupDef {
    return {
        name: 'workstation', w: 2, d: 2, wall: true, corner: 0.5,
        pieces: [
            { kind: 'desk', at: [0, 0], facing: 'north', push: ['north'], extra: { bare: true }, tag: 'desk' },
            { kind: 'monitor', at: [0, 0], on: { piece: 0, u: 13.5, v: 6.5 }, facing: 'north' },
            dress === 'lamp' ? { kind: 'deskLamp', at: [0, 0], on: { piece: 0, u: 2.5, v: 5 }, facing: 'north' } : { kind: 'paperStack', at: [0, 0], on: { piece: 0, u: 4, v: 3 }, facing: 'north' },
            { kind: 'officeChair', at: [0, 1], facing: 'north', push: ['north'] },
            { kind: 'bin', at: [2, 0], push: ['north', 'west'], optional: true }
        ],
        clear: [[0, 1], [1, 1]],
        stations: [{ at: [1, 1], role }]
    };
}

/** Two desks front to front in the middle of an open-plan office, a chair and a monitor each side. */
export function deskPair(role: string): GroupDef {
    const side = (y: number, facing: 'north' | 'south'): Piece[] => [
        { kind: 'desk', at: [0, y], facing, push: [facing], extra: { bare: true }, tag: 'desk' }
    ];
    return {
        name: 'deskPair', w: 2, d: 4, wall: false,
        pieces: [
            ...side(1, 'south'), ...side(2, 'north'),
            { kind: 'monitor', at: [0, 0], on: { piece: 0, u: 13.5, v: 6.5 }, facing: 'north' },
            { kind: 'monitor', at: [0, 0], on: { piece: 1, u: 13.5, v: 6.5 }, facing: 'north' },
            { kind: 'paperStack', at: [0, 0], on: { piece: 1, u: 4, v: 3 }, facing: 'north', optional: true },
            { kind: 'officeChair', at: [1, 0], facing: 'south', push: ['south'] },
            { kind: 'officeChair', at: [0, 3], facing: 'north', push: ['north'] }
        ],
        clear: [[0, 0], [1, 0], [0, 3], [1, 3]],
        stations: [{ at: [0, 0], role, facing: 'south' }, { at: [1, 3], role }]
    };
}

/**
 * The manager's desk, facing into the room from in front of a wall: their chair behind it, the monitor and a family
 * photo turned to them, a lamp, two visitors' chairs in front.
 */
export function managerDesk(wall: boolean): GroupDef {
    return {
        name: 'managerDesk', w: 2, d: 3, wall, corner: 0.5,
        pieces: [
            { kind: 'desk', at: [0, 1], extra: { bare: true }, tag: 'desk' },
            { kind: 'officeChair', at: [0, 0], push: ['south'] },
            { kind: 'monitor', at: [0, 0], on: { piece: 0, u: 5, v: 7 }, facing: 'north' },
            { kind: 'photoFrame', at: [0, 0], on: { piece: 0, u: 15, v: 7 }, facing: 'north' },
            { kind: 'deskLamp', at: [0, 0], on: { piece: 0, u: 17.5, v: 2.5 }, facing: 'north' },
            { kind: 'chair', at: [0, 2], facing: 'north', push: ['north'] },
            { kind: 'chair', at: [1, 2], facing: 'north', push: ['north'] },
            { kind: 'plant', at: [-1, 0], push: ['north'], optional: true }
        ],
        // The way round the desk to the manager's chair.
        clear: [[2, 0]],
        stations: [{ at: [1, 0], role: 'manager', facing: 'south' }]
    };
}

/**
 * A table with chairs round it: one or two meeting tables end to end, or a plain table (the break room's, a small
 * meeting's), with a chair at each end where there is room.
 */
export function meeting(tables: number, kind: 'meetingTable' | 'diningTable', name = 'meeting'): GroupDef {
    const span = kind === 'meetingTable' ? 3 : 2, len = tables * span, pieces: Piece[] = [];
    for (let t = 0; t < tables; t++) pieces.push({ kind, at: [1 + t * span, 1], tag: 'table', ...(kind === 'diningTable' ? { extra: { bare: true } } : {}) });
    for (let x = 1; x <= len; x++) {
        pieces.push({ kind: 'chair', at: [x, 0], push: ['south'] });
        pieces.push({ kind: 'chair', at: [x, 2], facing: 'north', push: ['north'] });
    }
    pieces.push({ kind: 'chair', at: [0, 1], facing: 'east', push: ['east'], optional: true }, { kind: 'chair', at: [len + 1, 1], facing: 'west', push: ['west'], optional: true });
    return { name, w: len + 2, d: 3, wall: false, pieces };
}

/** The counting table: two note counters turned to the people counting, a chair each side, a cash cart waiting at its end. */
export function countingTable(): GroupDef {
    return {
        name: 'countingTable', w: 3, d: 3, wall: false,
        pieces: [
            { kind: 'diningTable', at: [0, 1], extra: { bare: true }, tag: 'table' },
            { kind: 'cashCounter', at: [0, 0], on: { piece: 0, u: 15, v: 3 }, facing: 'north' },
            { kind: 'cashCounter', at: [0, 0], on: { piece: 0, u: 15, v: 8 } },
            { kind: 'paperStack', at: [0, 0], on: { piece: 0, u: 5, v: 5.5 }, optional: true },
            { kind: 'chair', at: [0, 0], push: ['south'] },
            { kind: 'chair', at: [0, 2], facing: 'north', push: ['north'] },
            { kind: 'cashCart', at: [2, 1], facing: 'west', optional: true }
        ],
        stations: [{ at: [1, 2], role: 'counter' }, { at: [1, 0], role: 'counter', facing: 'south' }]
    };
}

/** A run of storage along a wall (shelving, filing cabinets, bookshelves, lockers), the floor in front kept for reaching it. */
export function storage(kinds: Kind[], name = 'storage'): GroupDef {
    return {
        name, w: kinds.length, d: 2, wall: true, corner: 1,
        pieces: kinds.map((kind, i): Piece => ({ kind, at: [i, 0], push: ['north'] })),
        clear: kinds.map((_, i): [number, number] => [i, 1])
    };
}

/** Free-standing shelving in the middle of a records room, back to back, an aisle either side: tall cover. */
export function stacks(n: number): GroupDef {
    const pieces: Piece[] = [];
    for (let i = 0; i < n; i++) pieces.push({ kind: 'shelving', at: [i, 1], facing: 'north', push: ['north'] }, { kind: 'shelving', at: [i, 1], push: ['south'] });
    return { name: 'stacks', w: n, d: 3, wall: false, pieces, clear: Array.from({ length: n }, (_, i): [number, number][] => [[i, 0], [i, 2]]).flat() };
}

/** A row of server racks, against a wall or free-standing with an aisle each side. */
export function serverRow(n: number, wall: boolean): GroupDef {
    const y = wall ? 0 : 1;
    return {
        name: 'serverRow', w: n, d: wall ? 2 : 3, wall,
        pieces: Array.from({ length: n }, (_, i): Piece => ({ kind: 'serverRack', at: [i, y], ...(wall ? { push: ['north'] } : {}) })),
        clear: Array.from({ length: n }, (_, i): [number, number][] => (wall ? [[i, 1]] : [[i, 0], [i, 2]])).flat()
    };
}

/** The kitchenette: the counter with its sink and a microwave on it, the fridge beside it, a water cooler at its end. */
export function kitchenette(station?: string): GroupDef {
    return {
        name: 'kitchenette', w: 3, d: 2, wall: true, corner: 1,
        pieces: [
            { kind: 'kitchenCounter', at: [0, 0], push: ['north'], extra: { bare: true }, tag: 'counter' },
            { kind: 'microwave', at: [0, 0], on: { piece: 0, u: 21, v: 3.5 } },
            { kind: 'fridge', at: [2, 0], push: ['north', 'west'] },
            { kind: 'waterCooler', at: [-1, 0], push: ['north', 'east'], optional: true }
        ],
        clear: [[0, 1], [1, 1], [2, 1]],
        ...(station ? { stations: [{ at: [0, 1] as [number, number], role: station }] } : {})
    };
}

/** A sofa against a wall with a coffee table in front of it, a plant at its end. */
export function lounge(): GroupDef {
    return {
        name: 'lounge', w: 2, d: 2, wall: true,
        pieces: [
            { kind: 'sofa', at: [0, 0], push: ['north'] },
            { kind: 'coffeeTable', at: [0, 1] },
            { kind: 'plant', at: [2, 0], push: ['north'], optional: true }
        ]
    };
}

/** A bank of staff lockers with a coat stand at its end. */
export function lockerBank(n: number): GroupDef {
    const run = storage(Array.from({ length: n }, (): Kind => 'lockers'), 'lockers');
    return { ...run, pieces: [...run.pieces, { kind: 'coatStand', at: [n, 0], optional: true }] };
}

/** The cleaner's station: shelving with the supplies, the mop bucket beside it. */
export function cleaningStation(): GroupDef {
    return {
        name: 'cleaning', w: 2, d: 2, wall: true, corner: 1,
        pieces: [
            { kind: 'shelving', at: [0, 0], push: ['north'] },
            { kind: 'mopBucket', at: [1, 0], push: ['north'] },
            { kind: 'boxes', at: [2, 0], push: ['north'], optional: true }
        ],
        clear: [[0, 1], [1, 1]]
    };
}

/** The CCTV operator's console against a wall, their chair, the footage recorder's rack beside it. */
export function cctvConsole(): GroupDef {
    return {
        name: 'cctvConsole', w: 2, d: 2, wall: true,
        pieces: [
            { kind: 'cctvDesk', at: [0, 0], push: ['north'], tag: 'desk' },
            { kind: 'officeChair', at: [0, 1], facing: 'north', push: ['north'] },
            { kind: 'serverRack', at: [2, 0], push: ['north'], optional: true, tag: 'recorder' }
        ],
        clear: [[0, 1], [1, 1]],
        stations: [{ at: [1, 1], role: 'operator' }]
    };
}

/** A table to open a deposit box at, a chair at it. */
export function viewingTable(): GroupDef {
    return {
        name: 'viewing', w: 2, d: 2, wall: false,
        pieces: [
            { kind: 'diningTable', at: [0, 0], extra: { bare: true }, tag: 'table' },
            { kind: 'chair', at: [0, 1], facing: 'north', push: ['north'] }
        ],
        clear: [[1, 1]]
    };
}

/** A single thing against a wall (a plant, a cabinet, a cash cart), the floor in front of it kept when it is used from there. */
export function accent(kind: Kind, corner = 0, used = false): GroupDef {
    return { name: kind, w: 1, d: used ? 2 : 1, wall: true, corner, pieces: [{ kind, at: [0, 0], push: ['north'] }], ...(used ? { clear: [[0, 1] as [number, number]] } : {}) };
}

/** A sideboard (a low credenza) along a wall, for the conference room's water and the files. */
export function sideboard(): GroupDef {
    return { name: 'sideboard', w: 2, d: 1, wall: true, pieces: [{ kind: 'backCounter', at: [0, 0], push: ['north'], extra: { width: 2 }, tag: 'counter' }] };
}
