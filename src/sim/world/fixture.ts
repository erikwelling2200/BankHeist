import { edgeBetween, edgeKey } from '../core/grid';
import { DEFAULT_RULES, type CameraDef, type DoorDef, type Lock, type Material, type PersonDef, type Pos, type Rules, type Tile, type WallEdge, type World, type WorldObject, type Zone } from '../core/types';

/*
 * Small worlds for unit tests, drawn as text: one character per tile.
 *
 *     .  public floor     s  staff floor     x  secure floor
 *     #  a low object that blocks movement and gives half cover (a desk, a counter)
 *     T  a tall object that blocks movement and sight (a shelf, a column)
 *
 * Objects stand on public floor unless `zones` (the same grid, in `.`, `s` and `x`) says otherwise. Walls stand on the
 * edges between two orthogonally neighbouring tiles and are listed apart, each with its material and, for a door, the
 * door's id.
 */

export interface FixtureWall {
    /** The tiles either side of the edge. */
    between: [Pos, Pos];
    material?: Material;
    door?: { id: string; lock?: Lock; open?: boolean; locked?: boolean };
}

export interface FixtureOptions {
    walls?: readonly FixtureWall[];
    zones?: readonly string[];
    /** Unlit tiles, by position. */
    dark?: readonly Pos[];
    people?: readonly PersonDef[];
    cameras?: readonly CameraDef[];
    objects?: readonly WorldObject[];
    rules?: Partial<Rules>;
}

const ZONES: Record<string, Zone> = { '.': 'public', s: 'staff', x: 'secure' };

/** Materials that let sight through (§8.3: glass doesn't block it). */
const SEE_THROUGH: readonly Material[] = ['glass', 'tellerGlass'];

export function fixtureWorld(map: readonly string[], options: FixtureOptions = {}): World {
    const height = map.length, width = map[0]?.length ?? 0;
    if (!width) throw new Error('A fixture needs at least one tile');
    const tiles: Tile[] = [];
    map.forEach((line, y) => {
        if (line.length !== width) throw new Error(`Fixture row ${y} has length ${line.length}, expected ${width}`);
        [...line].forEach((c, x) => {
            const zoneChar = options.zones?.[y]?.[x] ?? (c in ZONES ? c : '.');
            const zone = ZONES[zoneChar];
            if (!zone || !(c in ZONES || c === '#' || c === 'T')) throw new Error(`Unknown fixture tile '${c}' at (${x}, ${y})`);
            tiles.push({
                zone,
                raised: false,
                lit: true,
                blocksMove: c === '#' || c === 'T',
                tall: c === 'T',
                halfCover: c === '#',
                room: null
            });
        });
    });
    for (const p of options.dark ?? []) tiles[p.y * width + p.x]!.lit = false;

    const edges: Record<string, WallEdge> = {}, doors: Record<string, DoorDef> = {};
    for (const wall of options.walls ?? []) {
        const [a, b] = wall.between;
        if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) throw new Error(`(${a.x}, ${a.y}) and (${b.x}, ${b.y}) share no edge`);
        const edge = edgeBetween(a, b), key = edgeKey(edge), material = wall.material ?? 'soft';
        edges[key] = { ...edge, material, blocksSight: !SEE_THROUGH.includes(material), blocksMove: true };
        if (wall.door) {
            const { id, lock = 'none', open = false, locked = false } = wall.door;
            edges[key].door = id;
            doors[id] = { id, edge: key, lock, open, locked };
        }
    }

    return {
        width, height, tiles, edges, doors,
        objects: [...(options.objects ?? [])],
        people: [...(options.people ?? [])],
        cameras: [...(options.cameras ?? [])],
        rules: { ...DEFAULT_RULES, ...options.rules }
    };
}
