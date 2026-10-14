import type { Facing } from '../level/space';
import { accent, loose } from './activities';
import type { Placed } from './furnish';
import { onTop, type GroupDef, type Kind, type PlacedGroup } from './groups';
import type { RoomType } from './model';
import type { P } from './nav';
import type { Parcel } from './parcels';
import type { Rng } from './rng';

/*
 * The story pass (research/procedural-interiors.md, lessons 9–11): after its groups, each room gets one or two vignettes
 * of who uses it and what just happened (coffee and papers on a desk, cash bags waiting by the counting table, a cake
 * in the break room, the cleaner's trolley where the cleaner is), never the same vignette twice in a bank, since
 * repeated small details are noticed before repeated rooms. Some change play: the note with the vault code on a desk is
 * an opportunity found in the documents (§17.6), and the cleaner's trolley is where the cleaner starts their round.
 */

/** Something to stand on a top, with the places on it to try in turn: middles in the top's own frame, in pixels. */
interface Item { kind: Kind; at: [number, number][]; facing?: Facing }

interface Vignette {
    id: string;
    rooms: RoomType[];
    text: string;
    /** Leaves it in the room; where, or undefined when the room can't take it. */
    tell: (p: Parcel) => P | undefined;
}

/** Where things go on a desk (20 by 10 pixels), a table (20 by 11), the meeting table (45 by 14), counters. */
const DESK: [number, number][] = [[8, 2.5], [17.5, 7.5], [16.5, 2.5], [7, 7.5], [3, 2.5]];
const TABLE: [number, number][] = [[10, 5.5], [5, 4], [15, 7], [5, 8], [15, 3]];
const LONG_TABLE: [number, number][] = [[10, 4], [33, 10], [22, 7], [6, 10], [38, 4], [15, 10]];

const DESKS = ['workstation', 'deskPair'];

const VIGNETTES: Vignette[] = [
    {
        id: 'sticky-note', rooms: ['staffOffice', 'tellerLine', 'managerOffice'], text: 'A note by a monitor with the vault code on it',
        tell: p => onGroups(p, [...DESKS, 'managerDesk'], 'desk', [{ kind: 'paperStack', at: DESK, facing: 'north' }])
    },
    {
        id: 'coffee-papers', rooms: ['staffOffice', 'tellerLine', 'recordsRoom', 'atmRoom'], text: 'A half-drunk coffee and a pile of loan files on a desk',
        tell: p => onGroups(p, [...DESKS], 'desk', [{ kind: 'mug', at: DESK }, { kind: 'paperStack', at: DESK, facing: 'north' }])
    },
    {
        id: 'family-photo', rooms: ['staffOffice', 'tellerLine'], text: "Family photos on a clerk's desk",
        tell: p => onGroups(p, DESKS, 'desk', [{ kind: 'photoFrame', at: DESK, facing: 'north' }, { kind: 'mug', at: DESK }])
    },
    {
        id: 'coat-on-stand', rooms: ['staffOffice', 'managerOffice', 'recordsRoom', 'conferenceRoom'], text: 'A coat left on the stand by a desk',
        tell: p => beside(p, [...DESKS, 'managerDesk', 'meeting'], accent('coatStand'))
    },
    {
        id: 'working-late', rooms: ['managerOffice'], text: "Cold coffee and the day's reports on the manager's desk",
        tell: p => onGroups(p, ['managerDesk'], 'desk', [
            { kind: 'mug', at: [[11, 3], [8, 2.5], [3, 6]] }, { kind: 'paperStack', at: [[9.5, 7], [4, 3], [12, 3]], facing: 'north' }
        ])
    },
    {
        id: 'cash-bags', rooms: ['countingRoom', 'antechamber', 'vault'], text: 'Bags of cash waiting to be counted',
        tell: p => beside(p, ['countingTable', 'cashCart', 'storage'], loose('cashBags'))
    },
    {
        id: 'birthday-cake', rooms: ['breakRoom', 'conferenceRoom'], text: 'A birthday cake, a quarter eaten, and mugs round it',
        tell: p => onGroups(p, ['dining', 'smallMeeting', 'meeting'], 'table', [
            { kind: 'cake', at: [[10, 5.5], [22, 7], [8, 5.5], [12, 5.5]] }, { kind: 'mug', at: [...TABLE, ...LONG_TABLE] }, { kind: 'mug', at: [...TABLE, ...LONG_TABLE] }
        ])
    },
    {
        id: 'meeting-notes', rooms: ['conferenceRoom'], text: 'Papers and cold coffee left from the morning meeting',
        tell: p => onGroups(p, ['meeting', 'smallMeeting'], 'table', [
            { kind: 'paperStack', at: [...LONG_TABLE, ...TABLE] }, { kind: 'mug', at: [...LONG_TABLE, ...TABLE] },
            { kind: 'paperStack', at: [...LONG_TABLE, ...TABLE], facing: 'north' }
        ])
    },
    {
        id: 'washing-up', rooms: ['breakRoom'], text: 'Mugs waiting by the sink',
        tell: p => onGroups(p, ['kitchenette'], 'counter', [{ kind: 'mug', at: [[14.5, 5], [15.5, 2.5], [27, 3]] }, { kind: 'mug', at: [[16, 5], [27, 6], [14, 2.5]] }])
    },
    {
        id: 'cold-coffee', rooms: ['cctvRoom'], text: 'A cold coffee by the CCTV monitors',
        tell: p => onGroups(p, ['cctvConsole'], 'desk', [{ kind: 'mug', at: [[21, 6.5], [4, 6.5], [12.5, 7]] }])
    },
    {
        id: 'files-out', rooms: ['recordsRoom'], text: 'Files pulled from the shelves, half sorted',
        tell: p => onGroups(p, ['workstation'], 'desk', [{ kind: 'paperStack', at: DESK }, { kind: 'paperStack', at: DESK, facing: 'east' }])
            ?? beside(p, ['stacks', 'storage'], loose('boxes'))
    },
    {
        id: 'deliveries', rooms: ['atmRoom', 'loadingBay', 'cleanersCloset', 'alarmCloset'], text: 'A delivery stacked by the door, not yet unpacked',
        tell: p => (p.group(loose('boxes'), { near: p.entries, away: -1 }) ? lastTile(p) : undefined)
    },
    {
        id: 'cleaner', rooms: ['staffCorridor', 'restroom', 'breakRoom'], text: "The cleaner's trolley and a wet-floor sign: the cleaner starts here",
        tell: cleaner
    }
];

/** A room's vignettes, one or two each, none twice in the bank; the rooms in a seeded order. */
export function tellStories(parcels: Parcel[], rng: Rng): void {
    const told = new Set<string>();
    for (const p of rng.shuffle(parcels)) {
        const want = rng.chance(0.5) ? 2 : 1;
        let n = 0;
        for (const v of rng.shuffle(VIGNETTES.filter(v => v.rooms.includes(p.room.type) && !told.has(v.id)))) {
            if (n >= want) break;
            const at = v.tell(p);
            if (!at) continue;
            told.add(v.id);
            p.out.stories.push({ id: v.id, room: p.room.id, tx: at.x, ty: at.y, text: v.text });
            n++;
        }
    }
}

/**
 * Stands `items` on the tagged top of one of the room's groups named `names`, each at the first of its places that is
 * free, all or none; where, or undefined.
 */
function onGroups(p: Parcel, names: string[], tag: string, items: Item[]): P | undefined {
    for (const g of p.rng.shuffle(p.groups.filter(g => names.includes(g.def.name)))) {
        for (const under of tops(g, tag)) {
            const mark = p.f.mark();
            const fits = (item: Item) => item.at.some(([u, v]) => p.f.try(onTop(item.kind, under, u, v, g.frame.mirror, item.facing ?? 'south'), p.room));
            if (items.every(fits)) return { x: under.prop.tx, y: under.prop.ty };
            p.f.rollback(mark);
        }
    }
    return undefined;
}

/** The pieces tagged `tag` of a group that went in. */
const tops = (g: PlacedGroup, tag: string): Placed[] => g.placed.filter((b, i): b is Placed => !!b && g.def.pieces[i]!.tag === tag);

/** `def` near one of the room's groups named `names` (or pieces of that kind); where, or undefined. */
function beside(p: Parcel, names: string[], def: GroupDef): P | undefined {
    const near = p.groups.filter(g => names.includes(g.def.name) || g.placed.some(b => b && names.includes(b.prop.kind)));
    if (!near.length) return undefined;
    return p.group(def, { near: p.rng.pick(near).tiles }) ? lastTile(p) : undefined;
}

const lastTile = (p: Parcel): P => {
    const g = p.groups.at(-1)!;
    return g.tiles[0]!;
};

/**
 * The cleaner at work: their trolley against a wall, a wet-floor sign out on the floor beside it, and a station for the
 * cleaner, who starts their round from here.
 */
function cleaner(p: Parcel): P | undefined {
    const def: GroupDef = {
        name: 'cleanerAtWork', w: 2, d: 2, wall: true,
        pieces: [{ kind: 'cleaningTrolley', at: [0, 0], push: ['north'] }, { kind: 'wetFloorSign', at: [1, 1] }],
        stations: [{ at: [1, 0], role: 'cleaner', facing: 'west' }]
    };
    return p.group(def)?.tiles[0];
}
