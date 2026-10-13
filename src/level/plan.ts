import type { Placement } from './space';
import type { Wall, WallKind } from './walls';

/*
 * A level's plan, drawn at double resolution so walls can stand on the edges between tiles: floor tiles sit at odd
 * columns and odd rows, east-west walls between them at odd columns of even rows, north-south walls at even columns of
 * odd rows, and `+` marks a corner where walls meet.
 *
 * Floor: `,` staff linoleum   `.` lobby marble   `=` carpet runner   `q` concrete (Secure)   `v` steel plate (the vault)
 *        `t` small white tiles (restrooms, the café kitchen)   `f` café floorboards   `u` a vacant shop's dusty floor
 *        `s` sidewalk   `c` curb   `r` road   `l` road with the centre-line dashes   `a` alley
 *        `x` off the map (a neighbour's building, nothing to see)
 * Walls: `-` `|` plaster (Soft)   `R` concrete (Reinforced)   `V` the vault's steel   `O` the vault door
 *        `b` brick (outside walls)   `d` wood door   `k` keycard steel door   `S` steel service door in a front
 *        `p` stone pier   `P` brick pier   `g` window   `D` glass door   `A` through-the-wall ATM   `B` boarded-up window
 *        `H` rolling shutter
 */

export type FloorTile = ',' | '.' | '=' | 'q' | 'v' | 't' | 'f' | 'u' | 's' | 'c' | 'r' | 'l' | 'a' | 'x';

const FLOOR = new Set<string>([',', '.', '=', 'q', 'v', 't', 'f', 'u', 's', 'c', 'r', 'l', 'a', 'x']);
const WALL_KINDS: Record<string, WallKind> = {
    '-': 'plaster', '|': 'plaster', R: 'concrete', V: 'vault', O: 'vaultDoor', b: 'brick', d: 'doorWood', k: 'doorKeycard',
    S: 'doorService', p: 'pier', P: 'brickPier', g: 'window', D: 'doorGlass', A: 'atm', B: 'boarded', H: 'shutter'
};

export interface Level { tiles: FloorTile[][]; walls: Wall[] }

export function parsePlan(plan: readonly string[]): Level {
    const width = plan[0]!.length;
    if (width % 2 === 0 || plan.length % 2 === 0) throw new Error('A plan has walls round its edge: an odd number of rows and columns');
    const tiles: FloorTile[][] = [], walls: Wall[] = [];
    plan.forEach((line, gy) => {
        if (line.length !== width) throw new Error(`Plan row ${gy} has length ${line.length}, expected ${width}`);
        [...line].forEach((c, gx) => {
            const tx = Math.floor(gx / 2), ty = Math.floor(gy / 2);
            if (gx % 2 === 1 && gy % 2 === 1) {
                if (!FLOOR.has(c)) throw new Error(`Unknown floor '${c}' at tile (${tx}, ${ty})`);
                (tiles[ty] ??= [])[tx] = c as FloorTile;
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
export const isOffMap = (tile: FloorTile): boolean => tile === 'x';

/** Tiles under the open sky. */
export const isOutdoors = (tile: FloorTile): boolean => tile === 's' || tile === 'c' || tile === 'r' || tile === 'l' || tile === 'a';

/**
 * A room: a rectangle of tiles, its zone (§8.1) and how it is lit. Lamps are hung from the rooms (`roomLamps`); rooms
 * also name the plan's parts for the reader and the tests.
 */
export interface Room {
    name: string;
    zone: 'public' | 'staff' | 'secure' | 'neighbour' | 'outdoors';
    x: number;
    y: number;
    w: number;
    h: number;
    /** Warm ceiling lamps, bright ones (the teller line), cool strip lights, a single dim bulb, or none (outdoors by day). */
    light: 'warm' | 'bright' | 'cool' | 'dim' | 'none';
}

/**
 * Static furniture and dressing. `tx`/`ty` is the north-west tile of the tiles the object occupies; its size, default
 * facing, alignment and elevation come from `CATALOG` (catalog.ts), and an entry can override facing, alignment or span.
 */
type Placed = { tx: number; ty: number } & Partial<Pick<Placement, 'span' | 'alignX' | 'alignY' | 'facing'>>;

export type LevelProp = Placed & (
    | { kind: 'counter'; width: number; stations: number[]; closed: number[]; gate: number }
    | { kind: 'backCounter'; width: number }
    | { kind: 'queueRail'; length: number }
    | { kind: 'writingDesk' | 'sofa' | 'coffeeTable' | 'plant' | 'waterCooler' | 'bin' | 'brochureRack' | 'mat' }
    | { kind: 'clock' | 'crest' | 'painting' | 'noticeBoard' | 'exitSign' | 'keycardLed' | 'atmScreen' | 'camera' }
    | { kind: 'filingCabinet' | 'printer' }
    | { kind: 'streetLamp' | 'hydrant' | 'newsBox' | 'streetBin' | 'manhole' | 'bollard' }
    | { kind: 'van' }
    | { kind: 'depositBoxes' | 'cashShelf' | 'vaultConsole' | 'serverRack' | 'cashCart' }
    | { kind: 'alarmPanel' | 'breakerPanel' | 'menuBoard' | 'wallLadder' }
    | { kind: 'cctvDesk' | 'desk' | 'officeChair' | 'bookshelf' | 'lockers' | 'shelving' | 'mopBucket' | 'atmBack' | 'boxes' }
    | { kind: 'diningTable' | 'chair' | 'fridge' | 'kitchenCounter' | 'toilet' | 'washbasin' }
    | { kind: 'cafeTable' | 'cafeCounter' }
    | { kind: 'dumpster' | 'generator' }
);

export type PersonFacing = 'front' | 'back';

/**
 * People stand in the middle of their tile (`PERSON_SIZE`) and are named after the archetype they are drawn as. A
 * person with a `patrol` walks in a straight line to that tile and back, pausing at each end.
 */
export interface LevelPerson { look: string; tx: number; ty: number; facing: PersonFacing; patrol?: { tx: number; ty: number } }
