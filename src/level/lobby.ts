/**
 * The lobby of the visual-preview bank: a small city branch, mid-morning. Street along the bottom, public lobby in the
 * middle, the teller area (Staff) behind the counter and the back wall with the doors to the manager's office and the
 * staff corridor at the top. Walls are one tile; a wall whose south neighbour is open shows its face.
 *
 * Tile legend:
 *   `#` wall          `d` wood office door (face)   `k` keycard staff door (face)   `w` restroom door in a side wall
 *   `,` staff linoleum   `.` lobby marble   `=` carpet runner
 *   `p` façade stone pier   `g` façade window   `D` façade glass door   `A` through-the-wall ATM
 *   `s` sidewalk   `c` curb   `r` road   `l` road with the centre-line dashes
 */
export const LOBBY_TILES = [
    '######################',
    '###d##############k###',
    '#,,,,,,,,,,,,,,,,,,,,#',
    '#,,,,,,,,,,,,,,,,,,,,#',
    '#,,,,,,,,,,,,,,,,,,,,#',
    '#........==..........#',
    '#........==..........#',
    'w........==..........#',
    '#........==..........#',
    '#........==..........#',
    '#........==..........#',
    '#........==..........#',
    'pgggpgggpDDpgggpApgggp',
    'ssssssssssssssssssssss',
    'ssssssssssssssssssssss',
    'cccccccccccccccccccccc',
    'rrrrrrrrrrrrrrrrrrrrrr',
    'llllllllllllllllllllll',
    'rrrrrrrrrrrrrrrrrrrrrr',
    'rrrrrrrrrrrrrrrrrrrrrr'
];

export type LobbyTile = '#' | 'd' | 'k' | 'w' | ',' | '.' | '=' | 'p' | 'g' | 'D' | 'A' | 's' | 'c' | 'r' | 'l';

const TILE_CHARS = new Set<string>(['#', 'd', 'k', 'w', ',', '.', '=', 'p', 'g', 'D', 'A', 's', 'c', 'r', 'l']);
const BLOCKING = new Set<LobbyTile>(['#', 'd', 'k', 'w', 'p', 'g', 'D', 'A']);

export function parseLobby(rows: string[]): LobbyTile[][] {
    const width = rows[0]!.length;
    return rows.map((row, y) => {
        if (row.length !== width) throw new Error(`Lobby row ${y} has length ${row.length}, expected ${width}`);
        return [...row].map((c, x) => {
            if (!TILE_CHARS.has(c)) throw new Error(`Unknown lobby tile '${c}' at (${x}, ${y})`);
            return c as LobbyTile;
        });
    });
}

/** Walls, doors and the façade: the tiles the renderer draws as a top cap or a face rather than floor. */
export function isStructure(tile: LobbyTile): boolean {
    return BLOCKING.has(tile);
}

/** Static furniture and dressing, placed by tile. `tx`/`ty` is the tile the object stands on (its base row). */
export type LobbyProp =
    | { kind: 'counter'; tx: number; ty: number; width: number; stations: number[]; closed: number[]; gate: number }
    | { kind: 'backCounter'; tx: number; ty: number; width: number }
    | { kind: 'queueRail'; tx: number; ty: number; length: number }
    | { kind: 'writingDesk' | 'sofa' | 'coffeeTable'; tx: number; ty: number }
    | { kind: 'plant' | 'waterCooler' | 'bin' | 'brochureRack' | 'mat'; tx: number; ty: number }
    | { kind: 'clock' | 'crest' | 'painting' | 'noticeBoard' | 'exitSign' | 'keycardLed' | 'atmScreen' | 'camera'; tx: number; ty: number }
    | { kind: 'filingCabinet' | 'printer'; tx: number; ty: number }
    | { kind: 'streetLamp' | 'hydrant' | 'newsBox' | 'streetBin' | 'manhole' | 'bollard'; tx: number; ty: number }
    | { kind: 'van'; tx: number; ty: number };

export const LOBBY_PROPS: LobbyProp[] = [
    { kind: 'backCounter', tx: 1, ty: 2, width: 4 },
    { kind: 'filingCabinet', tx: 6, ty: 2 },
    { kind: 'filingCabinet', tx: 7, ty: 2 },
    { kind: 'printer', tx: 9, ty: 2 },
    { kind: 'backCounter', tx: 12, ty: 2, width: 4 },
    { kind: 'waterCooler', tx: 20, ty: 2 },
    { kind: 'counter', tx: 1, ty: 4, width: 20, stations: [3, 7, 11, 15], closed: [11], gate: 19 },
    { kind: 'crest', tx: 9, ty: 1 },
    { kind: 'clock', tx: 13, ty: 1 },
    { kind: 'noticeBoard', tx: 16, ty: 1 },
    { kind: 'painting', tx: 6, ty: 1 },
    { kind: 'exitSign', tx: 18, ty: 0 },
    { kind: 'keycardLed', tx: 18, ty: 1 },
    { kind: 'atmScreen', tx: 16, ty: 12 },
    { kind: 'camera', tx: 21, ty: 5 },

    { kind: 'queueRail', tx: 8, ty: 6, length: 4 },
    { kind: 'queueRail', tx: 11, ty: 6, length: 4 },
    { kind: 'mat', tx: 9, ty: 11 },
    { kind: 'writingDesk', tx: 3, ty: 8 },
    { kind: 'sofa', tx: 15, ty: 7 },
    { kind: 'coffeeTable', tx: 15, ty: 9 },
    { kind: 'plant', tx: 1, ty: 5 },
    { kind: 'plant', tx: 20, ty: 5 },
    { kind: 'plant', tx: 19, ty: 11 },
    { kind: 'brochureRack', tx: 1, ty: 10 },
    { kind: 'bin', tx: 7, ty: 11 },

    { kind: 'streetLamp', tx: 5, ty: 14 },
    { kind: 'streetLamp', tx: 17, ty: 14 },
    { kind: 'hydrant', tx: 13, ty: 14 },
    { kind: 'newsBox', tx: 2, ty: 13 },
    { kind: 'streetBin', tx: 12, ty: 13 },
    { kind: 'bollard', tx: 8, ty: 14 },
    { kind: 'bollard', tx: 11, ty: 14 },
    { kind: 'van', tx: 1, ty: 17 },
    { kind: 'manhole', tx: 14, ty: 18 }
];

export type Facing = 'front' | 'back';

/** People are placed by tile and named after the archetype they are drawn as. */
export interface LobbyPerson { look: string; tx: number; ty: number; facing: Facing }

export const LOBBY_PEOPLE: LobbyPerson[] = [
    { look: 'teller', tx: 3, ty: 3, facing: 'front' },
    { look: 'tellerB', tx: 7, ty: 3, facing: 'front' },
    { look: 'headTeller', tx: 15, ty: 3, facing: 'front' },
    { look: 'guard', tx: 13, ty: 10, facing: 'front' },
    { look: 'customerSuit', tx: 3, ty: 5, facing: 'back' },
    { look: 'customerCoat', tx: 7, ty: 5, facing: 'back' },
    { look: 'customerDress', tx: 15, ty: 5, facing: 'back' },
    { look: 'customerCasual', tx: 9, ty: 7, facing: 'back' },
    { look: 'crewMara', tx: 10, ty: 8, facing: 'back' },
    { look: 'customerOld', tx: 4, ty: 9, facing: 'back' },
    { look: 'crewJun', tx: 17, ty: 10, facing: 'front' },
    { look: 'passerby', tx: 6, ty: 13, facing: 'front' },
    { look: 'customerHoodie', tx: 16, ty: 13, facing: 'back' }
];
