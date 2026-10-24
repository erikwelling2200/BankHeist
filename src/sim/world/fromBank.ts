import type { GeneratedBank, GenRoom, RoutineBlock } from '../../gen/model';
import { CATALOG } from '../../level/catalog';
import { floorHeight, RAISED_HEIGHT, type LevelProp, type PersonFacing } from '../../level/plan';
import type { Facing as PropFacing } from '../../level/space';
import { blocksMoveAt, HALF_COVER_HEIGHT, isTall, placeProp, propTileGrids, tilesOfBox, wallLookup, type WallAt } from '../../level/tileProps';
import { edgeKey } from '../core/grid';
import { clonePlain } from '../core/json';
import { defaultRules } from '../core/state';
import {
    type CameraDef, type DoorDef, type Facing, type ObserverClass, type PersonDef, type ReadonlyWorld, type ScheduleBlock, type Tile,
    type WallEdge, type WorldObject, type Zone
} from '../core/types';
import { COVER_HP, DEFAULT_COVER_HP } from '../data/weapons';
import { freezeWorld } from './freeze';
import { DOOR_KINDS, WALL_MATERIALS } from './materials';

/*
 * The rules' World from a generated bank (§14.1, §17), built once when a heist starts. Everything comes from what the
 * generator hands out, through the same pieces it used itself, so the two agree:
 *
 * - tiles: the zone of their room (the street and the neighbours count as Public, implementation plan §6.7), raised and
 *   floor height from the floor (a flight of stairs is ground floor; its top step is the climb onto the landing), lit unless the room has no light and is indoors (§6.10: the baked lamps are art, not
 *   rules), and what the furniture does from `src/level/tileProps.ts`, the grids the generator's `Nav` reads. Tiles
 *   off the map are walls of nothing: no room, blocked and tall. A half-cover tile takes its prop's hit points
 *   (`COVER_HP`, §11.4), the sturdiest where props share a tile; none where one can't be destroyed.
 * - edges: every wall segment, with its material from `materials.ts` and the door that stands in it.
 * - doors: every door with a leaf (open doorways and counter gates are gaps, not doors): closed, or locked if it has a
 *   lock (§6.9).
 * - objects: the props the rules act on (panels, consoles, hatches, dumpsters; `OBJECT_KINDS`), the CCTV desk's recorder, the
 *   manager's PC, the alarm buttons that start a §9.1 carrier, and the loot; the deposit boxes' loot becomes the wall's
 *   haul (Heavy, drilled) and its boxes (Light, picked one by one), rules/vault.ts.
 * - locks: the key graph's, as the generator made it (rules/keys.ts).
 * - stash rooms: the cleaner's closet, where a body can be hidden (§8.10); the building: the bank's rooms under its
 *   roof, which a dye pack's cash must not leave (§15.1).
 * - people: their role, observer class and schedule (the typed `routine` with its tiles, run by rules/npc), and a hidden
 *   weapon on an off-duty cop (rules/actions/hostage.ts; everyone else carries what their class does); cameras with
 *   their facings, two for a panning one.
 * - the patrol car's lane along the main street and the timeline's drive-by turns (rules/checkins.ts), and the police
 *   arrival time of the bank's tier (`rules.policeEta`, §9.2), whether it hides dye packs (`rules.dyePacks`, §15.1),
 *   and its guards' armour (`rules.guardArmour`: 1 from City tier, §12.3).
 */

/**
 * The hit points of the half cover on each tile (§11.4), from the props that give it there, as `tileGrids` finds them:
 * the sturdiest prop's, Infinity for one that can't be destroyed, 0 where no prop gives cover.
 */
function coverHitPoints(width: number, height: number, props: readonly LevelProp[], wallOn: WallAt): Float64Array {
    const hp = new Float64Array(width * height);
    for (const prop of props) {
        const placed = placeProp(prop, wallOn);
        if (isTall(placed.box) || placed.box.z !== 0 || placed.box.h < HALF_COVER_HEIGHT) continue;
        const own = Object.hasOwn(COVER_HP, prop.kind) ? COVER_HP[prop.kind]! : DEFAULT_COVER_HP;
        for (const { x, y } of tilesOfBox(placed.box)) {
            if (x < 0 || y < 0 || x >= width || y >= height || !blocksMoveAt(placed, x, y)) continue;
            hp[y * width + x] = Math.max(hp[y * width + x]!, own ?? Infinity);
        }
    }
    return hp;
}

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
    wallLadder: 'ladder',
    // The back lot's generator: the building's backup power (§14.1 Powered).
    generator: 'generator',
    // Somewhere to stash a body (§8.10, rules/actions/body.ts).
    dumpster: 'dumpster'
};

/** What one deposit box holds (§15.1: a Light stack, as a drawer's $5k): the generator's deposit loot split by it. */
export const DEPOSIT_BOX_VALUE = 5000;

/** Rooms a body can be stashed anywhere in (§8.10, `World.stashRooms`). */
export const STASH_ROOMS: readonly GenRoom['type'][] = ['cleanersCloset'];

/** The most a person climbs between neighbouring tiles without stairs: a step of a flight (as `src/gen/site.ts`). */
const MAX_STEP = RAISED_HEIGHT / 3;

/**
 * Alarm stations that start no carrier of §9.1: the alarm closet's panel (an object of its own) and the CCTV console's
 * button (the operator verifies through the cameras instead).
 */
export const NOT_CARRIERS: ReadonlySet<string> = new Set(['Alarm panel', 'CCTV console panic button']);

/** A schedule block in the rules' terms: tiles as positions. */
function scheduleBlock(b: RoutineBlock): ScheduleBlock {
    const out: ScheduleBlock = { from: b.from, activity: b.activity, label: b.label, room: b.room };
    if (b.setOff !== undefined) out.setOff = b.setOff;
    if (b.at) out.at = { x: b.at.tx, y: b.at.ty };
    if (b.facing) out.facing = b.facing;
    if (b.route) out.route = b.route.map(t => ({ x: t.tx, y: t.ty }));
    return out;
}

const zoneOf = (room: GenRoom): Zone => (room.zone === 'outdoors' || room.zone === 'neighbour' ? 'public' : room.zone);
const litOf = (room: GenRoom): boolean => room.light !== 'none' || room.zone === 'outdoors';

export function worldFromBank(bank: GeneratedBank): ReadonlyWorld {
    const { tiles: floors, walls } = bank.level;
    const height = floors.length, width = floors[0]?.length ?? 0;
    const wallOn = wallLookup(walls);
    const grids = propTileGrids(width, height, bank.props, wallOn);
    const coverHp = coverHitPoints(width, height, bank.props, wallOn);

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
        const tile: Tile = {
            zone: zoneOf(room), raised: floor === RAISED_HEIGHT, floor, lit: litOf(room),
            blocksMove: grids.blocked[i] === 1, tall: grids.tall[i] === 1, halfCover: grids.halfCover[i] === 1, room: room.id
        };
        if (tile.halfCover && Number.isFinite(coverHp[i]!)) tile.coverHp = coverHp[i]! || DEFAULT_COVER_HP;
        tiles.push(tile);
    }

    // Stairs (§14.7): the flight is ground floor, and its top step leads onto the raised landing beside it.
    const SIDES = [['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0]] as const;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const tile = tiles[y * width + x]!;
        if (tile.raised || !tile.room || floors[y]![x] !== 'z') continue;
        for (const [to, dx, dy] of SIDES) {
            const nx = x + dx, ny = y + dy, next = nx >= 0 && ny >= 0 && nx < width && ny < height ? tiles[ny * width + nx]! : undefined;
            if (!next?.raised || !next.room || next.floor - tile.floor > MAX_STEP) continue;
            // Up through a doorway or a door, not through a wall or a railing.
            const wall = wallOn(dx ? { run: 'northSouth', tx: Math.max(x, nx), ty: y } : { run: 'eastWest', tx: x, ty: Math.max(y, ny) });
            if (wall && !DOOR_KINDS.includes(wall.kind)) continue;
            tile.climb = { kind: 'stairs', to };
            break;
        }
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
    // The CCTV desk holds the footage recorder (§8.12): 1 action to destroy or take it.
    for (const o of objects.filter(o => o.kind === 'cctvDesk')) add('recorder', o.pos.x, o.pos.y, o.facing);
    // A manager's PC: the desk in the manager's office (documents, the camera feeds' log-in).
    for (const prop of bank.props) {
        if (prop.kind !== 'desk' || bank.rooms.find(r => r.id === roomAt(prop.tx, prop.ty))?.type !== 'managerOffice') continue;
        add('managerPc', prop.tx, prop.ty, PROP_FACING[prop.facing ?? 'south']);
    }
    for (const a of bank.alarms) if (!NOT_CARRIERS.has(a.name)) add('alarmButton', a.tx, a.ty, 's', { name: a.name });
    // The deposit boxes (§15.3, decision 78): the wall's haul where the generator put its loot, and the boxes, one Light
    // stack each, after the rest of the loot (so no other loot's id moves).
    const boxes: (typeof bank.loot)[number][] = [];
    for (const l of bank.loot) {
        if (l.behind === 'depositBoxes') {
            boxes.push(l);
            add('loot', l.tx, l.ty, 's', { name: 'Deposit-box haul', loot: { value: l.value, weight: 'heavy', behind: 'depositWall' } });
            continue;
        }
        add('loot', l.tx, l.ty, 's', { name: l.name, loot: { value: l.value, weight: l.weight, ...(l.dyePack ? { dyePack: true as const } : {}) } });
    }
    for (const l of boxes) {
        const n = Math.max(1, Math.round(l.value / DEPOSIT_BOX_VALUE));
        for (let k = 0; k < n; k++) add('loot', l.tx, l.ty, 's', { name: 'Deposit box', loot: { value: Math.floor(l.value / n), weight: 'light', behind: 'depositBox' } });
    }

    const people: PersonDef[] = bank.people.map(p => ({
        id: p.id, name: p.name, role: p.role, observer: p.observer satisfies ObserverClass, pos: { x: p.tx, y: p.ty },
        facing: PERSON_FACING[p.facing], schedule: (p.routine ?? []).map(scheduleBlock),
        // An off-duty cop among the customers (§10.9): a hidden pistol, found only by a frisk.
        ...(p.traits.armed ? { armed: 'hidden' as const } : {}),
        // A hero (§16.2): resists a command, flees or tackles.
        ...(p.traits.hero ? { hero: true as const } : {})
    }));
    const cameras: CameraDef[] = bank.cameras.map(c => ({
        id: c.id, pos: { x: c.tx, y: c.ty }, facings: c.pan ? [c.pan[0], c.pan[1]] : [PROP_FACING[c.facing]], room: c.room
    }));

    const stashRooms = bank.rooms.filter(r => STASH_ROOMS.includes(r.type)).map(r => r.id).sort();
    // The bank's building: the rooms of its lot under a roof (a dye pack bursts once its cash leaves them, §15.1).
    const building = bank.rooms.filter(r => r.bank && r.zone !== 'outdoors').map(r => r.id).sort();
    // The patrol car's lane (§16.3, §16.4): the main street from its west end to its east end, on the street's tiles.
    const west = bank.exits.find(e => e.id === 'street-west'), east = bank.exits.find(e => e.id === 'street-east');
    const lane: { x: number; y: number }[] = [];
    if (west && east && west.ty === east.ty) {
        for (let x = Math.min(west.tx, east.tx); x <= Math.max(west.tx, east.tx); x++) if (x >= 0 && x < width && tiles[west.ty * width + x]?.room) lane.push({ x, y: west.ty });
    }
    const patrol = { lane, turns: bank.timeline.filter(t => t.name === 'Patrol drive-by').map(t => t.turn).sort((a, b) => a - b) };
    // Police in N (§9.2), dye packs or none (§15.1) and the guards' armour (§12.3) by the bank's tier.
    const rules = { ...defaultRules(), policeEta: bank.policeEta, dyePacks: bank.dyePacks, guardArmour: bank.tier === 'small' ? 0 : 1 };
    // The key graph (§15.2): the rules read its keys (rules/keys.ts).
    const locks = clonePlain(bank.locks);
    return freezeWorld({ width, height, tiles, edges, doors, objects, people, cameras, rules, stashRooms, building, locks, ...(lane.length ? { patrol } : {}) });
}
