import type { LevelPerson, LevelProp, Room } from './plan';

/**
 * The example bank: a city branch mid-block, mid-morning, with its neighbours. Fixed orientation (§17.1): the street
 * along the bottom, the public lobby at the front, the Secure core at the back, an alley behind. A café shares the
 * bank's west wall and a vacant shop its east wall (§17.5). The plan's legend is in `plan.ts`.
 */
export const BANK_PLAN = [
    '                                                                                                                         ',
    ' x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x x ',
    '+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+b+',
    ' a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a ',
    '                                                                                                                         ',
    ' a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a ',
    '                                                                                                                         ',
    ' a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a a ',
    '  +-+-+-+-+-+-+d+-+-+R+R+R+R+R+R+R+R+R+R+V+V+V+V+V+V+V+V+V+V+V+V+V+V+R+R+R+R+R+R+R+R+R+R+R+R+k+R+R+R+-+-+-+-+-+-+d+-+-+  ',
    ' x|t t t t t t t t t|q q q q q qRq q q qVv v v v v v v v v v v v v vVq q q q q q q qRq q q q q q q q|u u u u u u u u u|x ',
    '  +                 +           +       +                           +               +               +                 +  ',
    ' x|t t t t t t t t t|q q q q q qRq q q qVv v v v v v v v v v v v v vVq q q q q q q qRq q q q q q q q|u u u u u u u u u|x ',
    '  +                 +           +       +                           +               +               +                 +  ',
    ' x|t t t t t t t t t|q q q q q qRq q q qVv v v v v v v v v v v v v vVq q q q q q q qRq q q q q q q q|u u u u u u u u u|x ',
    '  +                 +           +       +                           +               +               +                 +  ',
    ' x|t t t t t t t t t|q q q q q qRq q q qVv v v v v v v v v v v v v vVq q q q q q q qRq q q q q q q q|u u u u u u u u u|x ',
    '  +                 +           +       +V+V+V+V+V+V+O+O+V+V+V+V+V+V+               +               +                 +  ',
    ' x|t t t t t t t t t|q q q q q qRq q q qRq q q q q q q q q q q q q qRq q q q q q q qRq q q q q q q q|u u u u u u u u u|x ',
    '  +                 +           +       +                           +               +               +                 +  ',
    ' x|t t t t t t t t t|q q q q q qRq q q qRq q q q q q q q q q q q q qRq q q q q q q qRq q q q q q q q|u u u u u u u u u|x ',
    '  +-+-+-+-+-+-+d+-+-+           +       +                           +               +               +-+-+-+-+d+-+-+-+-+  ',
    ' x|f f f f f f f f f|q q q q q qRq q q qRq q q q q q q q q q q q q qRq q q q q q q qRq q q q q q q q|u u u u u u u u u|x ',
    '  +                 +R+R+k+R+R+R+R+k+R+R+R+R+R+R+R+R+k+R+R+R+R+R+R+R+R+R+R+k+R+R+R+R+R+R+R+k+R+R+R+R+                 +  ',
    ' x|f f f f f f f f f|, , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , ,|u u u u u u u u u|x ',
    '  +                 +                                                                               +                 +  ',
    ' x|f f f f f f f f f|, , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , , ,|u u u u u u u u u|x ',
    '  +                 +-+-+-+-+-+d+-+-+-+-+-+-+k+-+-+-+-+-+-+-+-+-+-+-+-+-+-+k+-+-+-+-+-+-+d+-+-+-+-+-+                 +  ',
    ' x|f f f f f f f f f|, , , , , , , , , ,|, , , , , , , , , , , , , , , , , , , ,|, , , , , , , , , ,|u u u u u u u u u|x ',
    '  +                 +                   +                                       +                   +                 +  ',
    ' x|f f f f f f f f f|, , , , , , , , , ,d, , , , , , , , , , , , , , , , , , , ,d, , , , , , , , , ,|u u u u u u u u u|x ',
    '  +                 +                   +                                       +                   +                 +  ',
    ' x|f f f f f f f f f|, , , , , , , , , ,|, , , , , , , , , , , , , , , , , , , ,|, , , , , , , , , ,|u u u u u u u u u|x ',
    '  +                 +                   +                                       +                   +                 +  ',
    ' x|f f f f f f f f f|, , , , , , , , , ,|. . . . . . . . . = = . . . . . . . . .|, , , , , , , , , ,|u u u u u u u u u|x ',
    '  +                 +                   +                                       +                   +                 +  ',
    ' x|f f f f f f f f f|, , , , , , , , , ,|. . . . . . . . . = = . . . . . . . . .|, , , , , , , , , ,|u u u u u u u u u|x ',
    '  +                 +                   +                                       +-+d+-+-+-+-+-+-+-+-+                 +  ',
    ' x|f f f f f f f f f|, , , , , , , , , ,|. . . . . . . . . = = . . . . . . . . .|, , , ,|, , , , , ,|u u u u u u u u u|x ',
    '  +                 +                   +                                       +       +           +                 +  ',
    ' x|f f f f f f f f f|, , , , , , , , , ,|. . . . . . . . . = = . . . . . . . . .|, , , ,|, , , , , ,|u u u u u u u u u|x ',
    '  +                 +-+d+-+-+-+-+-+-+-+-+                                       +       +           +                 +  ',
    ' x|f f f f f f f f f|, , , ,|t t t t t t|. . . . . . . . . = = . . . . . . . . .|, , , ,k, , , , , ,|u u u u u u u u u|x ',
    '  +                 +       +           +                                       +       +           +                 +  ',
    ' x|f f f f f f f f f|, , , ,|t t t t t t|. . . . . . . . . = = . . . . . . . . .|, , , ,|, , , , , ,|u u u u u u u u u|x ',
    '  +                 +       +           +                                       +       +           +                 +  ',
    ' x|f f f f f f f f f|, , , ,|t t t t t t|. . . . . . . . . = = . . . . . . . . .|, , , ,|, , , , , ,|u u u u u u u u u|x ',
    '  +                 +       +           +                                       +       +-+-+-+-+-+-+                 +  ',
    ' x|f f f f f f f f f|, , , ,|t t t t t td. . . . . . . . . = = . . . . . . . . .|, , , ,|, , , , , ,|u u u u u u u u u|x ',
    '  +                 +       +           +                                       +       +           +                 +  ',
    ' x|f f f f f f f f f|, , , ,|t t t t t t|. . . . . . . . . = = . . . . . . . . .|, , , ,|, , , , , ,|u u u u u u u u u|x ',
    '  +                 +       +           +                                       +       +           +                 +  ',
    ' x|f f f f f f f f f|, , , ,|t t t t t t|. . . . . . . . . = = . . . . . . . . .|, , , ,d, , , , , ,|u u u u u u u u u|x ',
    '  +                 +       +           +                                       +       +           +                 +  ',
    ' x|f f f f f f f f f|, , , ,|t t t t t t|. . . . . . . . . = = . . . . . . . . .|, , , ,|, , , , , ,|u u u u u u u u u|x ',
    '  +                 +       +           +                                       +       +           +                 +  ',
    ' x|f f f f f f f f f|, , , ,|t t t t t t|. . . . . . . . . = = . . . . . . . . .|, , , ,|, , , , , ,|u u u u u u u u u|x ',
    '+P+P+g+g+D+g+g+g+g+P+p+A+p+p+p+g+p+g+p+p+p+g+g+g+p+g+g+g+p+D+D+p+g+g+g+p+g+g+g+p+p+S+p+p+g+p+p+g+p+p+P+B+B+B+H+H+B+B+P+P+',
    ' s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s ',
    '                                                                                                                         ',
    ' s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s s ',
    '                                                                                                                         ',
    ' c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c c ',
    '                                                                                                                         ',
    ' r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r ',
    '                                                                                                                         ',
    ' r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r ',
    '                                                                                                                         ',
    ' l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l l ',
    '                                                                                                                         ',
    ' r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r ',
    '                                                                                                                         ',
    ' r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r r ',
    '                                                                                                                         ',
];

/** The rooms, west to east and back to front. */
export const BANK_ROOMS: Room[] = [
    { name: 'alley', zone: 'outdoors', x: 0, y: 1, w: 60, h: 3, light: 'none' },
    { name: 'café kitchen', zone: 'neighbour', x: 1, y: 4, w: 9, h: 6, light: 'cool' },
    { name: 'café', zone: 'neighbour', x: 1, y: 10, w: 9, h: 18, light: 'warm' },
    { name: 'electrical closet', zone: 'secure', x: 10, y: 4, w: 6, h: 7, light: 'dim' },
    { name: 'server room', zone: 'secure', x: 16, y: 4, w: 4, h: 7, light: 'cool' },
    { name: 'vault', zone: 'secure', x: 20, y: 4, w: 14, h: 4, light: 'cool' },
    { name: 'vault antechamber', zone: 'secure', x: 20, y: 8, w: 14, h: 3, light: 'cool' },
    { name: 'deposit-box room', zone: 'secure', x: 34, y: 4, w: 8, h: 7, light: 'cool' },
    { name: 'back hall', zone: 'secure', x: 42, y: 4, w: 8, h: 7, light: 'dim' },
    { name: 'staff corridor', zone: 'staff', x: 10, y: 11, w: 40, h: 2, light: 'cool' },
    { name: "manager's office", zone: 'staff', x: 10, y: 13, w: 10, h: 7, light: 'warm' },
    { name: 'ATM service room', zone: 'staff', x: 10, y: 20, w: 4, h: 8, light: 'dim' },
    { name: 'restrooms', zone: 'public', x: 14, y: 20, w: 6, h: 8, light: 'cool' },
    { name: 'teller line', zone: 'staff', x: 20, y: 13, w: 20, h: 3, light: 'bright' },
    { name: 'lobby', zone: 'public', x: 20, y: 16, w: 20, h: 12, light: 'warm' },
    { name: 'break room', zone: 'staff', x: 40, y: 13, w: 10, h: 5, light: 'warm' },
    { name: 'staff passage', zone: 'staff', x: 40, y: 18, w: 4, h: 10, light: 'dim' },
    { name: 'CCTV room', zone: 'secure', x: 44, y: 18, w: 6, h: 5, light: 'dim' },
    { name: "cleaner's closet", zone: 'staff', x: 44, y: 23, w: 6, h: 5, light: 'dim' },
    { name: 'vacant back room', zone: 'neighbour', x: 50, y: 4, w: 9, h: 6, light: 'none' },
    { name: 'vacant shop', zone: 'neighbour', x: 50, y: 10, w: 9, h: 18, light: 'none' },
    { name: 'street', zone: 'outdoors', x: 0, y: 28, w: 60, h: 8, light: 'none' }
];

export const BANK_PROPS: LevelProp[] = [
    // The alley: the café's dumpster, the bank's generator, the ladder to the roofs, the sewer manhole.
    { kind: 'dumpster', tx: 3, ty: 3 },
    { kind: 'boxes', tx: 9, ty: 3, alignY: 'south' },
    { kind: 'streetBin', tx: 18, ty: 1 },
    { kind: 'manhole', tx: 30, ty: 2 },
    { kind: 'wallLadder', tx: 38, ty: 3 },
    { kind: 'generator', tx: 42, ty: 3 },
    { kind: 'boxes', tx: 58, ty: 3, alignY: 'south' },

    // The café: its kitchen, the counter and menu, tables inside and on the pavement.
    { kind: 'kitchenCounter', tx: 1, ty: 4 },
    { kind: 'fridge', tx: 3, ty: 4 },
    { kind: 'shelving', tx: 5, ty: 4 },
    { kind: 'boxes', tx: 9, ty: 8 },
    { kind: 'cafeCounter', tx: 1, ty: 10 },
    { kind: 'menuBoard', tx: 3, ty: 10 },
    { kind: 'plant', tx: 9, ty: 10, alignX: 'east', alignY: 'north' },
    ...[14, 18, 22].flatMap(ty => [3, 7].flatMap((tx): LevelProp[] => [
        { kind: 'cafeTable', tx, ty },
        { kind: 'chair', tx: tx - 1, ty, facing: 'east' },
        { kind: 'chair', tx: tx + 1, ty, facing: 'west' }
    ])),
    { kind: 'cafeTable', tx: 3, ty: 29 },
    { kind: 'chair', tx: 2, ty: 29, facing: 'east' },
    { kind: 'chair', tx: 4, ty: 29, facing: 'west' },

    // The electrical closet: the breaker cabinet and the alarm panel, spares on a shelf.
    { kind: 'breakerPanel', tx: 11, ty: 4 },
    { kind: 'alarmPanel', tx: 13, ty: 4 },
    { kind: 'shelving', tx: 15, ty: 4 },
    { kind: 'boxes', tx: 10, ty: 9 },
    // The server room.
    { kind: 'serverRack', tx: 16, ty: 4 },
    { kind: 'serverRack', tx: 18, ty: 4 },
    { kind: 'serverRack', tx: 19, ty: 4 },
    // The vault: cash and gold on shelves along its back, a trolley by the door.
    ...[21, 22, 23, 24, 29, 30, 31, 32].map((tx): LevelProp => ({ kind: 'cashShelf', tx, ty: 4 })),
    { kind: 'cashCart', tx: 25, ty: 6 },
    // The antechamber: the console against the vault wall, a camera on the door.
    { kind: 'vaultConsole', tx: 30, ty: 8 },
    { kind: 'camera', tx: 20, ty: 8, facing: 'east', alignX: 'west' },
    // The deposit-box room: walls of boxes and a table to open them at.
    ...[35, 36, 38, 39, 40, 41].map((tx): LevelProp => ({ kind: 'depositBoxes', tx, ty: 4 })),
    { kind: 'diningTable', tx: 37, ty: 7 },
    // The back hall: deliveries and the cash trolley's parking spot, a camera on the back door.
    { kind: 'cashCart', tx: 43, ty: 5 },
    { kind: 'boxes', tx: 48, ty: 4, alignY: 'north' },
    { kind: 'boxes', tx: 48, ty: 6 },
    { kind: 'camera', tx: 49, ty: 4, facing: 'west', alignX: 'east' },

    // The staff corridor: readers on the keycard doors, a notice board, a clock, a camera at each end.
    ...[12, 17, 26, 37, 45].map((tx): LevelProp => ({ kind: 'keycardLed', tx, ty: 11 })),
    { kind: 'noticeBoard', tx: 31, ty: 11 },
    { kind: 'clock', tx: 34, ty: 11 },
    { kind: 'camera', tx: 10, ty: 11, facing: 'east', alignX: 'west' },
    { kind: 'camera', tx: 49, ty: 11, facing: 'west', alignX: 'east' },

    // The manager's office: the desk and its chair, bookcases, a cabinet, chairs for visitors.
    { kind: 'bookshelf', tx: 10, ty: 13 },
    { kind: 'bookshelf', tx: 11, ty: 13 },
    { kind: 'painting', tx: 16, ty: 13 },
    { kind: 'filingCabinet', tx: 17, ty: 13 },
    { kind: 'plant', tx: 19, ty: 13, alignX: 'east', alignY: 'north' },
    { kind: 'desk', tx: 13, ty: 15 },
    { kind: 'officeChair', tx: 14, ty: 14 },
    { kind: 'chair', tx: 13, ty: 17, facing: 'north' },
    { kind: 'chair', tx: 14, ty: 17, facing: 'north' },
    // The ATM service room: the cash machine's safe against the front, a trolley.
    { kind: 'atmBack', tx: 11, ty: 27 },
    { kind: 'cashCart', tx: 12, ty: 23 },
    { kind: 'boxes', tx: 13, ty: 20, alignY: 'north' },
    // The restrooms: two toilets, two basins.
    { kind: 'toilet', tx: 15, ty: 20 },
    { kind: 'toilet', tx: 17, ty: 20 },
    { kind: 'washbasin', tx: 14, ty: 24, facing: 'east', alignX: 'west', alignY: 'center' },
    { kind: 'washbasin', tx: 14, ty: 25, facing: 'east', alignX: 'west', alignY: 'center' },
    { kind: 'bin', tx: 18, ty: 26 },

    // The teller line, against the back wall.
    { kind: 'plant', tx: 20, ty: 13, alignX: 'west', alignY: 'north' },
    { kind: 'keycardLed', tx: 22, ty: 13 },
    { kind: 'backCounter', tx: 23, ty: 13, width: 4 },
    { kind: 'painting', tx: 27, ty: 13 },
    { kind: 'filingCabinet', tx: 28, ty: 13 },
    { kind: 'filingCabinet', tx: 29, ty: 13 },
    { kind: 'printer', tx: 30, ty: 13 },
    { kind: 'crest', tx: 31, ty: 13 },
    { kind: 'backCounter', tx: 33, ty: 13, width: 3 },
    { kind: 'clock', tx: 34, ty: 13 },
    { kind: 'exitSign', tx: 36, ty: 13, alignX: 'east' },
    { kind: 'keycardLed', tx: 37, ty: 13 },
    { kind: 'waterCooler', tx: 39, ty: 13, alignX: 'east' },
    { kind: 'counter', tx: 20, ty: 15, width: 20, stations: [23, 27, 31, 35], closed: [31], gate: 38 },

    // The lobby.
    { kind: 'camera', tx: 39, ty: 16, facing: 'west', alignX: 'east' },
    { kind: 'plant', tx: 20, ty: 16, alignX: 'west', alignY: 'north' },
    { kind: 'queueRail', tx: 28, ty: 17, length: 4, facing: 'east' },
    { kind: 'queueRail', tx: 31, ty: 17, length: 4, facing: 'west' },
    { kind: 'sofa', tx: 35, ty: 19 },
    { kind: 'coffeeTable', tx: 35, ty: 21 },
    { kind: 'writingDesk', tx: 23, ty: 20 },
    { kind: 'brochureRack', tx: 20, ty: 25, facing: 'east', alignX: 'west' },
    { kind: 'bin', tx: 27, ty: 27 },
    { kind: 'mat', tx: 29, ty: 27 },
    { kind: 'plant', tx: 39, ty: 27, alignX: 'east' },

    // The break room: a table and chairs, the kitchenette, a fridge, lockers.
    { kind: 'lockers', tx: 41, ty: 13 },
    { kind: 'lockers', tx: 42, ty: 13 },
    { kind: 'kitchenCounter', tx: 46, ty: 13 },
    { kind: 'fridge', tx: 48, ty: 13 },
    { kind: 'diningTable', tx: 44, ty: 15 },
    { kind: 'chair', tx: 43, ty: 15, facing: 'east' },
    { kind: 'chair', tx: 46, ty: 15, facing: 'west' },
    // The staff passage to the service door.
    { kind: 'camera', tx: 40, ty: 18, facing: 'east', alignX: 'west' },
    { kind: 'noticeBoard', tx: 42, ty: 18 },
    // The CCTV room: the operator's desk and chair, the recorder rack.
    { kind: 'cctvDesk', tx: 46, ty: 18 },
    { kind: 'officeChair', tx: 46, ty: 19, facing: 'north' },
    { kind: 'serverRack', tx: 49, ty: 18 },
    { kind: 'filingCabinet', tx: 44, ty: 22, facing: 'east', alignX: 'west', alignY: 'center' },
    // The cleaner's closet.
    { kind: 'shelving', tx: 45, ty: 23 },
    { kind: 'shelving', tx: 46, ty: 23 },
    { kind: 'mopBucket', tx: 48, ty: 25 },
    { kind: 'boxes', tx: 48, ty: 27 },

    // The vacant shop next door: left-behind boxes and shelving, an old chair.
    { kind: 'shelving', tx: 52, ty: 4 },
    { kind: 'boxes', tx: 51, ty: 6 },
    { kind: 'boxes', tx: 57, ty: 8 },
    { kind: 'boxes', tx: 53, ty: 14 },
    { kind: 'boxes', tx: 56, ty: 20 },
    { kind: 'chair', tx: 52, ty: 22, facing: 'east' },
    { kind: 'bin', tx: 57, ty: 26 },

    // The street.
    { kind: 'atmScreen', tx: 11, ty: 28 },
    ...[6, 24, 42, 56].map((tx): LevelProp => ({ kind: 'streetLamp', tx, ty: 29 })),
    { kind: 'bollard', tx: 27, ty: 29 },
    { kind: 'bollard', tx: 32, ty: 29 },
    { kind: 'hydrant', tx: 36, ty: 29 },
    { kind: 'newsBox', tx: 21, ty: 29, alignY: 'south' },
    { kind: 'streetBin', tx: 39, ty: 29, alignY: 'south' },
    { kind: 'van', tx: 14, ty: 31 },
    { kind: 'manhole', tx: 44, ty: 33 }
];

export const BANK_PEOPLE: LevelPerson[] = [
    // Staff.
    { look: 'guard', tx: 11, ty: 12, facing: 'front', patrol: { tx: 48, ty: 12 } },
    { look: 'manager', tx: 13, ty: 14, facing: 'front' },
    { look: 'teller', tx: 23, ty: 14, facing: 'front' },
    { look: 'tellerB', tx: 27, ty: 14, facing: 'front' },
    { look: 'headTeller', tx: 35, ty: 14, facing: 'front' },
    { look: 'operator', tx: 47, ty: 20, facing: 'back' },
    { look: 'cleaner', tx: 42, ty: 22, facing: 'back' },
    { look: 'teller', tx: 48, ty: 16, facing: 'front' },
    { look: 'guard', tx: 33, ty: 26, facing: 'back', patrol: { tx: 33, ty: 18 } },
    // Customers, with two of the crew among them.
    { look: 'customerSuit', tx: 23, ty: 16, facing: 'back' },
    { look: 'customerCoat', tx: 27, ty: 16, facing: 'back' },
    { look: 'customerDress', tx: 35, ty: 16, facing: 'back' },
    { look: 'customerCasual', tx: 30, ty: 19, facing: 'back' },
    { look: 'crewMara', tx: 29, ty: 22, facing: 'back' },
    { look: 'customerOld', tx: 24, ty: 22, facing: 'back' },
    { look: 'crewJun', tx: 37, ty: 24, facing: 'front' },
    // The café.
    { look: 'barista', tx: 2, ty: 11, facing: 'front' },
    { look: 'customerHoodie', tx: 5, ty: 18, facing: 'front' },
    { look: 'customerCoat', tx: 8, ty: 23, facing: 'back' },
    // The street.
    { look: 'passerby', tx: 1, ty: 28, facing: 'front', patrol: { tx: 58, ty: 28 } }
];
