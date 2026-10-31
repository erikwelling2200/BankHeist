import { edgeBetween, edgeKey } from '../core/grid';
import { clonePlain } from '../core/json';
import { defaultRules } from '../core/state';
import { RAISED_HEIGHT } from '../../level/plan';
import { type CameraDef, type ClimbSide, type DoorDef, type DoorStart, type Lock, type Material, type PersonDef, type Pos, type ReadonlyWorld, type Rules, type Tile, type WallEdge, type WorldObject, type Zone } from '../core/types';
import { DEFAULT_COVER_HP } from '../data/weapons';
import { freezeWorld } from './freeze';
import type { KeyLock } from '../../gen/model';
import type { StagingPoint } from '../rules/police';
import type { VehicleDef } from '../geo/drive';

/*
 * Small worlds for unit tests, drawn as text: one character per tile.
 *
 *     .  public floor     s  staff floor     x  secure floor
 *     #  a low object that blocks movement and gives half cover (a desk, a counter)
 *     T  a tall object that blocks movement and sight (a shelf, a column)
 *     ^  raised floor (a mezzanine, the loading dock, §14.7)
 *     /  stairs, and H  a ladder: ground-level climb tiles, the only way onto raised floor. Each leads to the one raised
 *        tile beside it (orthogonally); a climb tile with no raised neighbour, or more than one, is an error.
 *        Raised floor is marked only this way (there is no position list for it), so movement and sight agree on it.
 *
 * Objects stand on public floor unless `zones` (the same grid, in `.`, `s` and `x` only) says otherwise. Walls stand
 * on the edges between two orthogonally neighbouring tiles and are listed apart, each with its material and, for a
 * door, the door's id. The world comes back frozen.
 */

export interface FixtureWall {
    /** The tiles either side of the edge. */
    between: [Pos, Pos];
    material?: Material;
    /** False for a segment that carries sound for free (a fence). */
    blocksSound?: boolean;
    /** A middle-height barrier (sight passes only for a raised end, see geo/los.ts); it doesn't block sight otherwise. */
    midHeight?: boolean;
    door?: { id: string; lock?: Lock; start?: DoorStart };
}

export interface FixtureOptions {
    walls?: readonly FixtureWall[];
    zones?: readonly string[];
    /** Rooms, a grid like the map: each character other than '.' a room of that id (the blueprint outlines non-public ones). */
    rooms?: readonly string[];
    /** Unlit tiles, by position. */
    dark?: readonly Pos[];
    /** Half cover's hit points by position ('#' tiles take `DEFAULT_COVER_HP`); null can't be destroyed (§11.4). */
    cover?: readonly { at: Pos; hp: number | null }[];
    /** Tiles with something of middle height on them (a vehicle), by position. */
    midHeight?: readonly Pos[];
    people?: readonly PersonDef[];
    cameras?: readonly CameraDef[];
    objects?: readonly WorldObject[];
    rules?: Partial<Rules>;
    /** The patrol car's street lane and drive-by turns (rules/checkins.ts). */
    patrol?: { lane: readonly Pos[]; turns: readonly number[] };
    /** The key graph's locks (rules/keys.ts): the vault's code, time lock, drill and thermite; whose cards open which door. */
    locks?: readonly KeyLock[];
    /** The police staging points (rules/police.ts). Absent: no police come. */
    staging?: readonly StagingPoint[];
    /**
     * Where vehicles can drive (§14.4 Drivable): a grid like the map, 'd' for drivable; true for every ground tile with
     * nothing on it. Absent: nowhere.
     */
    drivable?: true | readonly string[];
    /** The crew's vehicles (rules/vehicles.ts). */
    vehicles?: readonly VehicleDef[];
}

const ZONES: Readonly<Record<string, Zone>> = { '.': 'public', s: 'staff', x: 'secure' };
const OBJECTS = new Set(['#', 'T']);
const CLIMB: Readonly<Record<string, 'stairs' | 'ladder'>> = { '/': 'stairs', H: 'ladder' };
const FLOORS = new Set(['^', ...Object.keys(CLIMB)]);
const CLIMB_SIDES: readonly (readonly [ClimbSide, Pos])[] = [['n', { x: 0, y: -1 }], ['e', { x: 1, y: 0 }], ['s', { x: 0, y: 1 }], ['w', { x: -1, y: 0 }]];

/** Materials that let sight through (§8.3: glass doesn't block it, nor do railings and fences). */
const SEE_THROUGH: readonly Material[] = ['glass', 'tellerGlass', 'rail', 'fence'];

export function fixtureWorld(map: readonly string[], options: FixtureOptions = {}): ReadonlyWorld {
    const height = map.length, width = map[0]?.length ?? 0;
    if (!width) throw new Error('A fixture needs at least one tile');
    const zones = options.zones, rooms = options.rooms;
    const drivable = options.drivable;
    for (const [name, grid] of [['zones', zones], ['rooms', rooms], ['drivable', drivable === true ? undefined : drivable]] as const) {
        if (grid && (grid.length !== height || grid.some(row => row.length !== width))) throw new Error(`The ${name} grid must be ${width}x${height}, like the map`);
    }
    const tiles: Tile[] = [];
    map.forEach((line, y) => {
        if (line.length !== width) throw new Error(`Fixture row ${y} has length ${line.length}, expected ${width}`);
        [...line].forEach((c, x) => {
            if (!(c in ZONES) && !OBJECTS.has(c) && !FLOORS.has(c)) throw new Error(`Unknown fixture tile '${c}' at (${x}, ${y})`);
            const z = zones ? zones[y]![x]! : c in ZONES ? c : '.';
            const zone = ZONES[z];
            if (!zone) throw new Error(`Unknown zone '${z}' at (${x}, ${y}): zones are '.', 's' and 'x'`);
            const tile: Tile = { zone, raised: c === '^', floor: c === '^' ? RAISED_HEIGHT : 0, lit: true, blocksMove: OBJECTS.has(c), tall: c === 'T', halfCover: c === '#', room: rooms && rooms[y]![x] !== '.' ? rooms[y]![x]! : null };
            if (c === '#') tile.coverHp = DEFAULT_COVER_HP;
            if (drivable) tile.drivable = drivable === true ? !OBJECTS.has(c) && !FLOORS.has(c) : drivable[y]![x] === 'd';
            tiles.push(tile);
        });
    });
    map.forEach((line, y) => [...line].forEach((c, x) => {
        const kind = CLIMB[c];
        if (!kind) return;
        const sides = CLIMB_SIDES.filter(([, d]) => map[y + d.y]?.[x + d.x] === '^');
        if (sides.length !== 1) throw new Error(`The climb tile at (${x}, ${y}) needs exactly one raised neighbour, not ${sides.length}`);
        tiles[y * width + x]!.climb = { kind, to: sides[0]![0] };
    }));
    for (const p of options.dark ?? []) {
        if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) throw new Error(`Dark tile (${p.x}, ${p.y}) is off the map`);
        tiles[p.y * width + p.x]!.lit = false;
    }
    for (const { at, hp } of options.cover ?? []) {
        const tile = tiles[at.y * width + at.x];
        if (!tile?.halfCover || at.x < 0 || at.x >= width) throw new Error(`No half cover at (${at.x}, ${at.y})`);
        if (hp === null) delete tile.coverHp;
        else tile.coverHp = hp;
    }
    for (const p of options.midHeight ?? []) {
        if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) throw new Error(`Middle-height tile (${p.x}, ${p.y}) is off the map`);
        tiles[p.y * width + p.x]!.midHeight = true;
    }

    const edges: Record<string, WallEdge> = {}, doors: Record<string, DoorDef> = {};
    for (const wall of options.walls ?? []) {
        const [a, b] = wall.between;
        for (const p of [a, b]) if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) throw new Error(`Wall tile (${p.x}, ${p.y}) is off the map`);
        const edge = edgeBetween(a, b), key = edgeKey(edge), material = wall.material ?? 'soft';
        if (edges[key]) throw new Error(`Two walls on the edge '${key}'`);
        const built: WallEdge = { ...edge, material, blocksSight: !wall.midHeight && !SEE_THROUGH.includes(material), blocksMove: true };
        if (material === 'rail') built.halfCover = true;
        if (wall.blocksSound !== undefined) built.blocksSound = wall.blocksSound;
        if (wall.midHeight) built.midHeight = true;
        if (wall.door) {
            const { id, lock = 'none', start = 'closed' } = wall.door;
            if (doors[id]) throw new Error(`Two doors with the id '${id}'`);
            built.door = id;
            doors[id] = { id, edge: key, lock, start };
        }
        edges[key] = built;
    }

    return freezeWorld({
        width, height, tiles, edges, doors,
        // Copies, so freezing the world doesn't freeze the caller's definitions.
        objects: clonePlain([...(options.objects ?? [])]),
        people: clonePlain([...(options.people ?? [])]),
        cameras: clonePlain([...(options.cameras ?? [])]),
        rules: { ...defaultRules(), ...options.rules },
        ...(options.patrol ? { patrol: { lane: clonePlain([...options.patrol.lane]), turns: [...options.patrol.turns] } } : {}),
        ...(options.locks ? { locks: clonePlain([...options.locks]) } : {}),
        ...(options.staging ? { staging: clonePlain([...options.staging]) } : {}),
        ...(options.vehicles ? { vehicles: clonePlain([...options.vehicles]) } : {})
    });
}
