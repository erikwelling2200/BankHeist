import type { Placement } from './space';
import type { Wall, WallKind } from './walls';

/**
 * The lobby of the visual-preview bank: a small city branch, mid-morning. Street along the bottom, public lobby in the
 * middle, the teller area (Staff) behind the counter, the back wall with doors to the staff corridor, and the corridor
 * along the vault's concrete wall at the top.
 *
 * The plan is drawn at double resolution, so walls can stand on the edges between tiles: floor tiles sit at odd
 * columns and odd rows, east-west walls between them at odd columns of even rows, north-south walls at even columns of
 * odd rows, and `+` marks a corner where walls meet.
 *
 * Floor: `,` staff linoleum   `.` lobby marble   `=` carpet runner   `s` sidewalk   `c` curb   `r` road
 *        `l` road with the centre-line dashes   `x` off the map (a neighbour's building, nothing to see)
 * Walls: `-` `|` plaster   `R` reinforced concrete   `d` wood door   `k` keycard steel door
 *        `p` stone pier   `g` window   `D` glass door   `A` through-the-wall ATM
 */
export const LOBBY_PLAN = [
    '                                             ',
    ' x x x x x x x x x x x x x x x x x x x x x x ',
    '                                             ',
    ' x x x x x x x x x x x x x x x x x x x x x x ',
    '  +R+R+R+R+R+R+R+R+R+k+R+R+R+R+R+R+R+R+R+R+  ',
    ' x|, , , , , , , , , , , , , , , , , , , ,|x ',
    '  +                                       +  ',
    ' x|, , , , , , , , , , , , , , , , , , , ,|x ',
    '  +-+-+d+-+-+-+-+-+-+-+-+-+-+-+-+-+-+k+-+-+  ',
    ' x|, , , , , , , , , , , , , , , , , , , ,|x ',
    '  +                                       +  ',
    ' x|, , , , , , , , , , , , , , , , , , , ,|x ',
    '  +                                       +  ',
    ' x|, , , , , , , , , , , , , , , , , , , ,|x ',
    '  +                                       +  ',
    ' x|. . . . . . . . = = . . . . . . . . . .|x ',
    '  +                                       +  ',
    ' x|. . . . . . . . = = . . . . . . . . . .|x ',
    '  +                                       +  ',
    ' xd. . . . . . . . = = . . . . . . . . . .|x ',
    '  +                                       +  ',
    ' x|. . . . . . . . = = . . . . . . . . . .|x ',
    '  +                                       +  ',
    ' x|. . . . . . . . = = . . . . . . . . . .|x ',
    '  +                                       +  ',
    ' x|. . . . . . . . = = . . . . . . . . . .|x ',
    '  +                                       +  ',
    ' x|. . . . . . . . = = . . . . . . . . . .|x ',
    '+p+g+g+g+p+g+g+g+p+D+D+p+g+g+g+p+A+p+g+g+g+p+',
    ' s s s s s s s s s s s s s s s s s s s s s s ',
    '                                             ',
    ' s s s s s s s s s s s s s s s s s s s s s s ',
    '                                             ',
    ' c c c c c c c c c c c c c c c c c c c c c c ',
    '                                             ',
    ' r r r r r r r r r r r r r r r r r r r r r r ',
    '                                             ',
    ' l l l l l l l l l l l l l l l l l l l l l l ',
    '                                             ',
    ' r r r r r r r r r r r r r r r r r r r r r r ',
    '                                             ',
    ' r r r r r r r r r r r r r r r r r r r r r r ',
    '                                             ',
];

export type LobbyTile = ',' | '.' | '=' | 's' | 'c' | 'r' | 'l' | 'x';

const FLOOR = new Set<string>([',', '.', '=', 's', 'c', 'r', 'l', 'x']);
const WALL_KINDS: Record<string, WallKind> = { '-': 'plaster', '|': 'plaster', R: 'concrete', d: 'doorWood', k: 'doorKeycard', p: 'pier', g: 'window', D: 'doorGlass', A: 'atm' };

export interface Lobby { tiles: LobbyTile[][]; walls: Wall[] }

export function parseLobby(plan: string[]): Lobby {
    const width = plan[0]!.length;
    if (width % 2 === 0 || plan.length % 2 === 0) throw new Error('A plan has walls round its edge: an odd number of rows and columns');
    const tiles: LobbyTile[][] = [], walls: Wall[] = [];
    plan.forEach((line, gy) => {
        if (line.length !== width) throw new Error(`Plan row ${gy} has length ${line.length}, expected ${width}`);
        [...line].forEach((c, gx) => {
            const tx = Math.floor(gx / 2), ty = Math.floor(gy / 2);
            if (gx % 2 === 1 && gy % 2 === 1) {
                if (!FLOOR.has(c)) throw new Error(`Unknown floor '${c}' at tile (${tx}, ${ty})`);
                (tiles[ty] ??= [])[tx] = c as LobbyTile;
            } else if (gx % 2 === 0 && gy % 2 === 0) {
                if (c !== '+' && c !== ' ') throw new Error(`Expected a corner at plan (${gx}, ${gy}), found '${c}'`);
            } else if (c !== ' ') {
                const kind = WALL_KINDS[c];
                if (!kind) throw new Error(`Unknown wall '${c}' at plan (${gx}, ${gy})`);
                walls.push(gy % 2 === 0 ? { kind, run: 'eastWest', tx, ty: gy / 2 } : { kind, run: 'northSouth', tx: gx / 2, ty });
            }
        });
    });
    return { tiles, walls };
}

/** Tiles off the map: no one goes there and nothing is drawn on them. */
export const isOffMap = (tile: LobbyTile): boolean => tile === 'x';

/** Tiles under the open sky. */
export const isOutdoors = (tile: LobbyTile): boolean => tile === 's' || tile === 'c' || tile === 'r' || tile === 'l';

/**
 * Static furniture and dressing. `tx`/`ty` is the north-west tile of the tiles the object occupies; its size, default
 * facing, alignment and elevation come from `CATALOG` (catalog.ts), and an entry can override facing, alignment or span.
 */
type Placed = { tx: number; ty: number } & Partial<Pick<Placement, 'span' | 'alignX' | 'alignY' | 'facing'>>;

export type LobbyProp = Placed & (
    | { kind: 'counter'; width: number; stations: number[]; closed: number[]; gate: number }
    | { kind: 'backCounter'; width: number }
    | { kind: 'queueRail'; length: number }
    | { kind: 'writingDesk' | 'sofa' | 'coffeeTable' | 'plant' | 'waterCooler' | 'bin' | 'brochureRack' | 'mat' }
    | { kind: 'clock' | 'crest' | 'painting' | 'noticeBoard' | 'exitSign' | 'keycardLed' | 'atmScreen' | 'camera' }
    | { kind: 'filingCabinet' | 'printer' }
    | { kind: 'streetLamp' | 'hydrant' | 'newsBox' | 'streetBin' | 'manhole' | 'bollard' }
    | { kind: 'van' }
);

export const LOBBY_PROPS: LobbyProp[] = [
    // Staff corridor, along the vault's concrete wall: the vault door's reader, a notice board, a clock and a camera
    // watching the door.
    { kind: 'keycardLed', tx: 10, ty: 2 },
    { kind: 'noticeBoard', tx: 6, ty: 2 },
    { kind: 'clock', tx: 14, ty: 2 },
    { kind: 'filingCabinet', tx: 16, ty: 2 },
    { kind: 'bin', tx: 12, ty: 2, alignY: 'north' },
    { kind: 'camera', tx: 1, ty: 2, facing: 'east', alignX: 'west' },
    { kind: 'plant', tx: 20, ty: 3, alignX: 'east', alignY: 'south' },

    // Teller line, against the back wall.
    { kind: 'backCounter', tx: 1, ty: 4, width: 4 },
    { kind: 'painting', tx: 5, ty: 4 },
    { kind: 'filingCabinet', tx: 6, ty: 4 },
    { kind: 'filingCabinet', tx: 7, ty: 4 },
    { kind: 'printer', tx: 8, ty: 4 },
    { kind: 'crest', tx: 9, ty: 4 },
    { kind: 'backCounter', tx: 12, ty: 4, width: 4 },
    { kind: 'clock', tx: 13, ty: 4 },
    { kind: 'noticeBoard', tx: 16, ty: 4 },
    { kind: 'exitSign', tx: 17, ty: 4, alignX: 'east' },
    { kind: 'keycardLed', tx: 18, ty: 4 },
    { kind: 'waterCooler', tx: 20, ty: 4, alignX: 'east' },
    { kind: 'counter', tx: 1, ty: 6, width: 20, stations: [3, 7, 11, 15], closed: [11], gate: 19 },

    // Lobby.
    { kind: 'camera', tx: 20, ty: 7, facing: 'west', alignX: 'east' },
    { kind: 'plant', tx: 1, ty: 7, alignX: 'west', alignY: 'north' },
    { kind: 'plant', tx: 20, ty: 7, alignX: 'east', alignY: 'north' },
    { kind: 'queueRail', tx: 8, ty: 8, length: 4, facing: 'east' },
    { kind: 'queueRail', tx: 11, ty: 8, length: 4, facing: 'west' },
    { kind: 'sofa', tx: 15, ty: 9 },
    { kind: 'writingDesk', tx: 3, ty: 10 },
    { kind: 'coffeeTable', tx: 15, ty: 11 },
    { kind: 'brochureRack', tx: 1, ty: 12, facing: 'east', alignX: 'west' },
    { kind: 'bin', tx: 7, ty: 13 },
    { kind: 'mat', tx: 9, ty: 13 },
    { kind: 'plant', tx: 20, ty: 13, alignX: 'east' },

    // Street.
    { kind: 'atmScreen', tx: 16, ty: 14 },
    { kind: 'newsBox', tx: 2, ty: 14 },
    { kind: 'streetBin', tx: 12, ty: 14 },
    { kind: 'streetLamp', tx: 5, ty: 15 },
    { kind: 'streetLamp', tx: 17, ty: 15 },
    { kind: 'bollard', tx: 8, ty: 15 },
    { kind: 'bollard', tx: 11, ty: 15 },
    { kind: 'hydrant', tx: 13, ty: 15 },
    { kind: 'van', tx: 1, ty: 17 },
    { kind: 'manhole', tx: 14, ty: 19 }
];

export type Facing = 'front' | 'back';

/** People stand in the middle of their tile (`PERSON_SIZE`) and are named after the archetype they are drawn as. */
export interface LobbyPerson { look: string; tx: number; ty: number; facing: Facing }

export const LOBBY_PEOPLE: LobbyPerson[] = [
    { look: 'tellerB', tx: 8, ty: 3, facing: 'back' },
    { look: 'teller', tx: 3, ty: 5, facing: 'front' },
    { look: 'tellerB', tx: 7, ty: 5, facing: 'front' },
    { look: 'headTeller', tx: 15, ty: 5, facing: 'front' },
    { look: 'guard', tx: 13, ty: 12, facing: 'front' },
    { look: 'customerSuit', tx: 3, ty: 7, facing: 'back' },
    { look: 'customerCoat', tx: 7, ty: 7, facing: 'back' },
    { look: 'customerDress', tx: 15, ty: 7, facing: 'back' },
    { look: 'customerCasual', tx: 9, ty: 9, facing: 'back' },
    { look: 'crewMara', tx: 10, ty: 10, facing: 'back' },
    { look: 'customerOld', tx: 4, ty: 11, facing: 'back' },
    { look: 'crewJun', tx: 17, ty: 12, facing: 'front' },
    { look: 'passerby', tx: 6, ty: 14, facing: 'front' },
    { look: 'customerHoodie', tx: 16, ty: 14, facing: 'back' }
];
