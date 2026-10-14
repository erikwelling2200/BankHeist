import { edgeBetween, edgeKey } from '../core/grid';
import { clonePlain } from '../core/json';
import { defaultRules } from '../core/state';
import { type CameraDef, type DoorDef, type DoorStart, type Lock, type Material, type PersonDef, type Pos, type ReadonlyWorld, type Rules, type Tile, type WallEdge, type WorldObject, type Zone } from '../core/types';
import { freezeWorld } from './freeze';

/*
 * Small worlds for unit tests, drawn as text: one character per tile.
 *
 *     .  public floor     s  staff floor     x  secure floor
 *     #  a low object that blocks movement and gives half cover (a desk, a counter)
 *     T  a tall object that blocks movement and sight (a shelf, a column)
 *
 * Objects stand on public floor unless `zones` (the same grid, in `.`, `s` and `x` only) says otherwise. Walls stand
 * on the edges between two orthogonally neighbouring tiles and are listed apart, each with its material and, for a
 * door, the door's id. The world comes back frozen.
 */

export interface FixtureWall {
    /** The tiles either side of the edge. */
    between: [Pos, Pos];
    material?: Material;
    /** A middle-height barrier (sight passes only for a raised end, see geo/los.ts); it doesn't block sight otherwise. */
    midHeight?: boolean;
    door?: { id: string; lock?: Lock; start?: DoorStart };
}

export interface FixtureOptions {
    walls?: readonly FixtureWall[];
    zones?: readonly string[];
    /** Unlit tiles, by position. */
    dark?: readonly Pos[];
    /** Raised tiles (a mezzanine, a landing), by position. */
    raised?: readonly Pos[];
    /** Tiles with something of middle height on them (a vehicle), by position. */
    midHeight?: readonly Pos[];
    people?: readonly PersonDef[];
    cameras?: readonly CameraDef[];
    objects?: readonly WorldObject[];
    rules?: Partial<Rules>;
}

const ZONES: Readonly<Record<string, Zone>> = { '.': 'public', s: 'staff', x: 'secure' };
const OBJECTS = new Set(['#', 'T']);

/** Materials that let sight through (§8.3: glass doesn't block it). */
const SEE_THROUGH: readonly Material[] = ['glass', 'tellerGlass'];

export function fixtureWorld(map: readonly string[], options: FixtureOptions = {}): ReadonlyWorld {
    const height = map.length, width = map[0]?.length ?? 0;
    if (!width) throw new Error('A fixture needs at least one tile');
    const zones = options.zones;
    if (zones && (zones.length !== height || zones.some(row => row.length !== width))) {
        throw new Error(`The zones grid must be ${width}x${height}, like the map`);
    }
    const tiles: Tile[] = [];
    map.forEach((line, y) => {
        if (line.length !== width) throw new Error(`Fixture row ${y} has length ${line.length}, expected ${width}`);
        [...line].forEach((c, x) => {
            if (!(c in ZONES) && !OBJECTS.has(c)) throw new Error(`Unknown fixture tile '${c}' at (${x}, ${y})`);
            const z = zones ? zones[y]![x]! : c in ZONES ? c : '.';
            const zone = ZONES[z];
            if (!zone) throw new Error(`Unknown zone '${z}' at (${x}, ${y}): zones are '.', 's' and 'x'`);
            tiles.push({ zone, raised: false, lit: true, blocksMove: OBJECTS.has(c), tall: c === 'T', halfCover: c === '#', room: null });
        });
    });
    for (const p of options.dark ?? []) {
        if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) throw new Error(`Dark tile (${p.x}, ${p.y}) is off the map`);
        tiles[p.y * width + p.x]!.lit = false;
    }
    for (const p of options.raised ?? []) {
        if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) throw new Error(`Raised tile (${p.x}, ${p.y}) is off the map`);
        tiles[p.y * width + p.x]!.raised = true;
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
        rules: { ...defaultRules(), ...options.rules }
    });
}
