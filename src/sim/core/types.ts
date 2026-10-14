/*
 * The rules engine's data (GAME_DESIGN §6, §14.1). Two halves:
 *
 * - `World` is the bank as it was built: the floor, the walls, the doors, the objects, the people's schedules. It never
 *   changes during a heist, so every function takes it read-only and the save stores it once.
 * - `State` is everything that changes: whose turn it is, where everyone stands, what they know, which doors are open,
 *   the dice. It is plain JSON (no classes, no Maps, no functions) so it can be copied with `structuredClone`, hashed
 *   and saved after every action (§20.6).
 *
 * Lists whose order matters (people resolve in order, §6.1) are arrays; lookups by id are records. Commands and events
 * are open unions: a later package adds its own by augmenting `CommandMap` or `EventMap`
 *
 *     declare module '../core/types' { interface CommandMap { knockout: { crew: string; npc: string } } }
 *
 * and registering a reducer (`registerCommand`) or the event's undo class (`registerEvents`) from its own module.
 */

/** A tile position. x grows east, y grows south. */
export interface Pos { x: number; y: number }

/** The eight directions anyone can face, clockwise from north. */
export type Facing = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** The legal status of a floor tile (§8.1). The street and the pavement count as Public. */
export type Zone = 'public' | 'staff' | 'secure';

/** What a wall segment or object is made of (§14.1); decides what passes it and what breaks it (§14.2). */
export type Material = 'glass' | 'tellerGlass' | 'soft' | 'reinforced' | 'vault' | 'boundary';

/** How a door locks (§14.1); the same set as the generator's `Lock`. */
export type Lock = 'none' | 'mechanical' | 'keycard' | 'maglock' | 'vault';

/** Who notices what (§8.2). */
export type ObserverClass = 'civilian' | 'staff' | 'enforcer';

// ---------------------------------------------------------------------------------------------------------- World

/** One floor tile and what stands on it (§14.1). Objects that matter to rules beyond these flags are `WorldObject`s. */
export interface Tile {
    zone: Zone;
    /** A raised tile (a mezzanine, a landing): its observers see over low objects (§14.7). */
    raised: boolean;
    /** Lit at the start; darkness halves vision (§8.3). Power cuts change it through `State` later, not here. */
    lit: boolean;
    /** Something stands on it that nobody walks through (a desk, a counter, a column). */
    blocksMove: boolean;
    /** What stands on it is full height and blocks sight (a shelf, a column). */
    tall: boolean;
    /** What stands on it gives half cover (§11.4). */
    halfCover: boolean;
    /** The room it belongs to, or null outside the bank. */
    room: string | null;
}

/** A wall edge, as the generator keys them (`src/gen/site.ts`): the run and the tile south or east of it. */
export interface Edge { run: 'eastWest' | 'northSouth'; tx: number; ty: number }

/** The key of an edge: `"<run> <tx> <ty>"`, the same string `src/gen/site.ts` uses. */
export type EdgeKey = string;

/**
 * A wall segment on an edge (§14.1). For a door these flags describe it closed; an open door lets everything through.
 * Glass blocks movement but not sight.
 */
export interface WallEdge extends Edge {
    material: Material;
    blocksSight: boolean;
    blocksMove: boolean;
    /** The door that stands in this segment, if any. */
    door?: string;
}

/** A door as built: where it stands, how it locks and how it starts the heist. Its live state is in `State.doors`. */
export interface DoorDef {
    id: string;
    edge: EdgeKey;
    lock: Lock;
    open: boolean;
    locked: boolean;
}

/**
 * Something the crew can interact with (§6.3 Interact): a panel, a console, a drawer, loot. `kind` names what it is;
 * the package that handles a kind gives it its rules and, where it needs them, its own fields.
 */
export interface WorldObject {
    id: string;
    kind: string;
    pos: Pos;
    facing: Facing;
}

/** What someone does from a turn on (§16.3), as the generator writes schedules. */
export interface ScheduleBlock { from: number; activity: string; room: string }

/** An NPC as the bank was built with them (§16.2): who they are and their day. Where they are now is in `State.npcs`. */
export interface PersonDef {
    id: string;
    name: string;
    role: string;
    observer: ObserverClass;
    pos: Pos;
    facing: Facing;
    schedule: ScheduleBlock[];
}

/** A camera (§8.3): fixed with one facing, or panning between two. */
export interface CameraDef {
    id: string;
    pos: Pos;
    facings: [Facing] | [Facing, Facing];
    room: string | null;
}

/** The numbers of the rules that a bank or a difficulty might change (§6.3, §8.3, §9.1). */
export interface Rules {
    actionsPerTurn: number;
    moveTiles: number;
    coreRange: number;
    peripheralRange: number;
    cameraRange: number;
    minCarrierCountdown: number;
}

export const DEFAULT_RULES: Readonly<Rules> = {
    actionsPerTurn: 2,
    moveTiles: 5,
    coreRange: 6,
    peripheralRange: 8,
    cameraRange: 7,
    minCarrierCountdown: 2
};

/** The bank as built. Never changes during a heist. */
export interface World {
    width: number;
    height: number;
    /** Row-major: the tile at (x, y) is `tiles[y * width + x]`. */
    tiles: Tile[];
    edges: Record<EdgeKey, WallEdge>;
    doors: Record<string, DoorDef>;
    objects: WorldObject[];
    people: PersonDef[];
    cameras: CameraDef[];
    rules: Rules;
}

// ---------------------------------------------------------------------------------------------------------- State

/** Placeholder until the loadout package (§7.3): the items a crew member brought. */
export interface Loadout { items: string[] }

export interface CrewState {
    id: string;
    name: string;
    pos: Pos;
    facing: Facing;
    actionsLeft: number;
    loadout: Loadout;
}

/**
 * An NPC's state badge (§16.1). Curious and Investigating follow the highest suspicion it holds (§8.5); Alerted is for
 * the rest of the heist (§8.7); the last four are face down or out (§10).
 */
export type NpcStatus = 'calm' | 'curious' | 'investigating' | 'alerted' | 'hostile' | 'commanded' | 'tied' | 'unconscious' | 'dead';

/** What an NPC will do in the next world phase, drawn on the map (§4 Intent). More kinds come with their packages. */
export type Intent =
    | { kind: 'idle' }
    | { kind: 'move'; path: Pos[] }
    | { kind: 'face'; facing: Facing };

export interface NpcState {
    id: string;
    pos: Pos;
    facing: Facing;
    status: NpcStatus;
    /** 0–3 pips per crew member, by crew id (§8.5). A missing entry is 0. */
    suspicion: Record<string, number>;
    /** The crew members this NPC knows to be criminals (§8.7). Only ever grows. */
    exposedTo: string[];
    intent: Intent;
}

export interface DoorState { open: boolean; locked: boolean }

export interface CameraState {
    /** Which of its `facings` it looks along now. */
    facing: number;
    live: boolean;
}

/** The alarm carriers of §9.1. */
export type CarrierKind =
    | 'tellerButton' | 'managerButton' | 'guardRadio' | 'operatorCamera' | 'phoneCall' | 'escapee' | 'missedCheckIn'
    | 'seismicSensor' | 'motionSensor' | 'patrolCar';

/** Someone or something in the middle of raising the Alarm (§9.1). It goes off when the countdown reaches 0. */
export interface Carrier {
    id: string;
    kind: CarrierKind;
    /** The NPC or object carrying it. */
    source: string;
    /** World phases left, shown on the map; starts at `rules.minCarrierCountdown` or more. */
    countdown: number;
}

/** Loud and Alarm are separate (§4): an alarm is silent (§9.2), and a gunshot is loud without calling anyone. */
export interface BankState {
    loud: boolean;
    alarm: boolean;
}

/** One roll of the dice, kept so a heist can be audited and its luck shown. */
export interface DiceRoll {
    turn: number;
    stream: string;
    /** What the roll was for, for the log ("hit jun", "resist"). */
    reason: string;
    value: number;
}

export type Phase = 'crew' | 'world';

/** Everything that changes during a heist. Plain JSON. */
export interface State {
    turn: number;
    /** Always 'crew' between commands: the world phase runs inside the `endTurn` command. */
    phase: Phase;
    bank: BankState;
    crew: CrewState[];
    /** In resolution order (§6.1). */
    npcs: NpcState[];
    doors: Record<string, DoorState>;
    cameras: Record<string, CameraState>;
    carriers: Carrier[];
    /** The heist's seed: a stream starts from it and its name the first time it is rolled. */
    seed: number;
    /** Each named random stream's position, uint32 (see `core/rng.ts`). */
    rng: Record<string, number>;
    dice: DiceRoll[];
    /** The next number for ids made during play (carriers, evidence), so they are the same on every replay. */
    nextId: number;
}

// ---------------------------------------------------------------------------------------------------------- Commands

/** Every command's fields by its type. Augment it to add a command. */
export interface CommandMap {
    /** A stub until the movement package: walks `path` (each step one tile, the last the destination) for 1 action. */
    move: { crew: string; path: Pos[] };
    /** The crew member is done for this turn: spends their remaining actions. */
    wait: { crew: string };
    /** Ends the crew phase and plays the world phase (§6.1). */
    endTurn: Record<never, never>;
}

export type CommandType = keyof CommandMap;
export type Command = { [K in CommandType]: { type: K } & CommandMap[K] }[CommandType];
export type CommandOf<K extends CommandType> = Extract<Command, { type: K }>;

// ---------------------------------------------------------------------------------------------------------- Events

/** Every event's fields by its type. Augment it to add an event, and classify it with `registerEvents`. */
export interface EventMap {
    moved: { crew: string; from: Pos; to: Pos };
    waited: { crew: string };
    phaseStarted: { phase: Phase; turn: number };
    /** Something on the map became known to the crew: a room, a person, a key (§8.15). */
    revealed: { what: string; id: string };
    /** An NPC checked whether it saw or heard a crew member (§8.5). */
    perceptionCheck: { npc: string; crew: string };
    carrierStarted: { carrier: string; kind: CarrierKind; countdown: number };
    carrierTicked: { carrier: string; countdown: number };
    alarmRaised: { carrier: string };
    wentLoud: { cause: string };
}

export type EventType = keyof EventMap;
export type SimEvent = { [K in EventType]: { type: K } & EventMap[K] }[EventType];
export type EventOf<K extends EventType> = Extract<SimEvent, { type: K }>;
