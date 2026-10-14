import type { GeneratedBank, GenRoom } from '../../gen/model';
import { CATALOG } from '../../level/catalog';
import { floorHeight, RAISED_HEIGHT, type LevelProp, type PersonFacing } from '../../level/plan';
import type { Facing as PropFacing } from '../../level/space';
import { propTileGrids, wallLookup } from '../../level/tileProps';
import { edgeKey } from '../core/grid';
import {
    DEFAULT_RULES, type CameraDef, type DoorDef, type Facing, type ObserverClass, type PersonDef, type ReadonlyWorld, type Tile,
    type WallEdge, type WorldObject, type Zone
} from '../core/types';
import { freezeWorld } from './freeze';
import { DOOR_KINDS, WALL_MATERIALS } from './materials';

/*
 * The rules' World from a generated bank (§14.1, §17), built once when a heist starts. Everything comes from what the
 * generator hands out, through the same pieces it used itself, so the two agree:
 *
 * - tiles: the zone of their room (the street and the neighbours count as Public, implementation plan §6.7), raised and
 *   floor height from the floor, lit unless the room has no light and is indoors (§6.10: the baked lamps are art, not
 *   rules), and what the furniture does from `src/level/tileProps.ts`, the grids the generator's `Nav` reads. Tiles
 *   off the map are walls of nothing: no room, blocked and tall.
 * - edges: every wall segment, with its material from `materials.ts` and the door that stands in it.
 * - doors: every door with a leaf (open doorways and counter gates are gaps, not doors): closed, or locked if it has a
 *   lock (§6.9).
 * - objects: the props the rules act on (panels, consoles, hatches; `OBJECT_KINDS`), the alarm stations and the loot.
 * - people: their role, observer class and schedule (as the generator writes it; M1-06 compiles it); cameras with
 *   their facings, two for a panning one.
 */

/** A person's facing as drawn (front is toward the camera, south) to the rules' eight. */
const PERSON_FACING: Record<PersonFacing, Facing> = { front: 's', back: 'n' };
const PROP_FACING: Record<PropFacing, Facing> = { north: 'n', east: 'e', south: 's', west: 'w' };

/** The prop kinds the rules act on, and the object kind each becomes. Everything else is furniture: tiles only. */
export const OBJECT_KINDS: Partial<Record<LevelProp['kind'], string>> = {
    alarmPanel: 'alarmPanel',
    breakerPanel: 'breakerPanel',
    // The operator's console and the footage recorder (§8.12).
    cctvDesk: 'cctvDesk',
    vaultConsole: 'vaultConsole',
    serverRack: 'serverRack',
    depositBoxes: 'depositBoxes',
    atmBack: 'atmSafe',
    filingCabinet: 'filingCabinet',
    lockers: 'lockers',
    metalDetector: 'metalDetector',
    motionSensor: 'motionSensor',
    roofHatch: 'roofHatch',
    floorGrate: 'floorGrate',
    ventGrille: 'vent',
    manhole: 'manhole',
    skylight: 'skylight',
    wallLadder: 'ladder'
};

const zoneOf = (room: GenRoom): Zone => (room.zone === 'outdoors' || room.zone === 'neighbour' ? 'public' : room.zone);
const litOf = (room: GenRoom): boolean => room.light !== 'none' || room.zone === 'outdoors';

export function worldFromBank(bank: GeneratedBank): ReadonlyWorld {
    const { tiles: floors, walls } = bank.level;
    const height = floors.length, width = floors[0]?.length ?? 0;
    const grids = propTileGrids(width, height, bank.props, wallLookup(walls));

    // Which room each tile is in: the rooms' parts tile the map (the generator's owner grid, §17).
    const owner: (GenRoom | undefined)[] = new Array<GenRoom | undefined>(width * height).fill(undefined);
    for (const room of bank.rooms) for (const part of room.parts) {
        for (let y = part.y; y < part.y + part.h; y++) for (let x = part.x; x < part.x + part.w; x++) owner[y * width + x] = room;
    }
    const tiles: Tile[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * width + x, room = owner[i];
        if (!room) {
            tiles.push({ zone: 'public', raised: false, floor: 0, lit: false, blocksMove: true, tall: true, halfCover: false, room: null });
            continue;
        }
        const floor = floorHeight(floors, x, y);
        tiles.push({
            zone: zoneOf(room), raised: floor === RAISED_HEIGHT, floor, lit: litOf(room),
            blocksMove: grids.blocked[i] === 1, tall: grids.tall[i] === 1, halfCover: grids.halfCover[i] === 1, room: room.id
        });
    }

    const doorAt = new Map(bank.doors.filter(d => !d.open).map(d => [edgeKey(d), d]));
    const edges: Record<string, WallEdge> = {}, doors: Record<string, DoorDef> = {};
    for (const wall of walls) {
        const key = edgeKey(wall), m = WALL_MATERIALS[wall.kind], door = doorAt.get(key);
        const edge: WallEdge = { run: wall.run, tx: wall.tx, ty: wall.ty, material: m.material, blocksSight: m.blocksSight, blocksMove: m.blocksMove };
        if (m.halfCover) edge.halfCover = true;
        if (door) {
            edge.door = door.id;
            doors[door.id] = { id: door.id, edge: key, lock: door.lock, start: door.lock === 'none' ? 'closed' : 'locked' };
        }
        edges[key] = edge;
    }
    // A double door (the front's glass doors, the vault door) is one door over several segments: the generator records
    // one of them, and the leaves beside it of the same kind open with it.
    const kindAt = new Map(walls.map(w => [edgeKey(w), w.kind]));
    for (const wall of walls) {
        const key = edgeKey(wall);
        if (edges[key]!.door || !DOOR_KINDS.includes(wall.kind)) continue;
        const along = (k: number) => edgeKey(wall.run === 'eastWest' ? { run: wall.run, tx: wall.tx + k, ty: wall.ty } : { run: wall.run, tx: wall.tx, ty: wall.ty + k });
        let id: string | undefined;
        for (const dir of [-1, 1]) for (let k = dir; !id && kindAt.get(along(k)) === wall.kind; k += dir) id = edges[along(k)]!.door;
        if (!id) {
            id = `door-${key.replace(/ /g, '-')}`;
            doors[id] = { id, edge: key, lock: 'none', start: 'closed' };
        }
        edges[key]!.door = id;
    }

    const roomAt = (x: number, y: number): string | undefined => owner[y * width + x]?.id;
    const objects: WorldObject[] = [];
    const counts = new Map<string, number>();
    const add = (kind: string, x: number, y: number, facing: Facing, extra: Partial<WorldObject> = {}): void => {
        const n = counts.get(kind) ?? 0;
        counts.set(kind, n + 1);
        const room = roomAt(x, y);
        objects.push({ id: `${kind}-${n}`, kind, pos: { x, y }, facing, ...(room ? { room } : {}), ...extra });
    };
    for (const prop of bank.props) {
        const kind = OBJECT_KINDS[prop.kind];
        if (!kind) continue;
        add(kind, prop.tx, prop.ty, PROP_FACING[prop.facing ?? CATALOG[prop.kind].facing ?? 'south'], kind === 'cctvDesk' ? { monitors: bank.monitors } : {});
    }
    // A manager's PC: the desk in the manager's office (documents, the camera feeds' log-in).
    for (const prop of bank.props) {
        if (prop.kind !== 'desk' || bank.rooms.find(r => r.id === roomAt(prop.tx, prop.ty))?.type !== 'managerOffice') continue;
        add('managerPc', prop.tx, prop.ty, PROP_FACING[prop.facing ?? 'south']);
    }
    for (const a of bank.alarms) add('alarmButton', a.tx, a.ty, 's', { name: a.name });
    for (const l of bank.loot) add('loot', l.tx, l.ty, 's', { name: l.name, loot: { value: l.value, weight: l.weight } });

    const people: PersonDef[] = bank.people.map(p => ({
        id: p.id, name: p.name, role: p.role, observer: p.observer satisfies ObserverClass, pos: { x: p.tx, y: p.ty },
        facing: PERSON_FACING[p.facing], schedule: p.schedule.map(b => ({ from: b.from, activity: b.activity, room: b.room }))
    }));
    const cameras: CameraDef[] = bank.cameras.map(c => ({
        id: c.id, pos: { x: c.tx, y: c.ty }, facings: c.pan ? [c.pan[0], c.pan[1]] : [PROP_FACING[c.facing]], room: c.room
    }));

    return freezeWorld({ width, height, tiles, edges, doors, objects, people, cameras, rules: { ...DEFAULT_RULES } });
}
