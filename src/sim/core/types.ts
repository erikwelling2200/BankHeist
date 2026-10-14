/*
 * The rules engine's data (GAME_DESIGN §6, §14.1). Two halves:
 *
 * - `World` is the bank as it was built: the floor, the walls, the doors, the objects, the people's schedules. It never
 *   changes during a heist: rules see it as `ReadonlyWorld`, it is frozen once built (`freezeWorld`), and the save
 *   stores it once.
 * - `State` is everything that changes: whose turn it is, where everyone stands, what they know, which doors are open,
 *   the dice. It is plain JSON (no classes, no Maps, no undefined, no -0; `assertPlainJson` checks) so it can be
 *   copied, hashed and saved after every action (§20.6). What changes about the World (a door, a hole in a wall, a dead
 *   panel) is an override in `State`, keyed like the World's own record.
 *
 * Lists whose order matters (people resolve in order, §6.1) are arrays; lookups by id are records, iterated through
 * `sortedIds`. Open sets are interfaces a later package augments from its own module:
 *
 *     declare module '../core/types' {
 *         interface CommandMap { knockout: { crew: string; npc: string } }
 *         interface NpcStatusMap { surprised: true }
 *     }
 *
 * then registers what goes with it (`registerCommand`, `registerEvents`, `registerWorldHook`).
 */

/** A type and everything in it read-only, all the way down. */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T
    : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

/** A tile position. x grows east, y grows south. */
export interface Pos { x: number; y: number }

/** The eight directions anyone can face, clockwise from north. */
export type Facing = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** The legal status of a floor tile (§8.1). The street and the pavement count as Public. */
export type Zone = 'public' | 'staff' | 'secure';

/**
 * What a wall segment or object is made of (§14.1); decides what passes it and what breaks it (§14.2). A railing and a
 * chain-link fence stop people but let sight, sound and bullets through (a railing is also half cover); Boundary is
 * the plot's edge, which nothing passes or opens.
 */
export type Material = 'glass' | 'tellerGlass' | 'soft' | 'reinforced' | 'vault' | 'rail' | 'fence' | 'boundary';

/** How a door locks (§14.1); the same set as the generator's `Lock`. */
export type Lock = 'none' | 'mechanical' | 'keycard' | 'maglock' | 'vault';

/** Who notices what (§8.2). */
export type ObserverClass = 'civilian' | 'staff' | 'enforcer';

// ---------------------------------------------------------------------------------------------------------- World

/** The orthogonal sides a climb tile can lead to. */
export type ClimbSide = 'n' | 'e' | 's' | 'w';

/** A stair or ladder tile's way up (§14.7). */
export interface Climb {
    kind: 'stairs' | 'ladder';
    /** The side of the raised tile it leads to. */
    to: ClimbSide;
}

/** One floor tile and what stands on it (§14.1). Objects that matter to rules beyond these flags are `WorldObject`s. */
export interface Tile {
    zone: Zone;
    /** A raised tile (a mezzanine, a landing): its observers see over low objects (§14.7). */
    raised: boolean;
    /** How high the floor is, in art pixels: 0 on the ground, a storey when raised, between on stairs (§14.7 step limit). */
    floor: number;
    /** A stair or ladder tile (§14.7): ground floor, the only way onto the raised tile on its `to` side. */
    climb?: Climb;
    /** Lit at the start; darkness halves vision (§8.3). */
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

/** What passes an edge. */
export interface EdgeProps {
    material: Material;
    blocksSight: boolean;
    blocksMove: boolean;
}

/**
 * A wall segment on an edge (§14.1). For a door these flags describe it closed; an open or breached door lets
 * everything through (`edgeNow`). Glass blocks movement but not sight.
 */
export interface WallEdge extends Edge, EdgeProps {
    /** The door that stands in this segment, if any. */
    door?: string;
    /** A low segment someone can crouch behind (a railing): half cover (§11.4). Absent for any other. */
    halfCover?: true;
}

/** How a door starts the heist. */
export type DoorStart = 'open' | 'closed' | 'locked';

/** A door as built: where it stands, how it locks and how it starts. Its live state is in `State.doors`. */
export interface DoorDef {
    id: string;
    edge: EdgeKey;
    lock: Lock;
    start: DoorStart;
}

/**
 * Something the crew can interact with (§6.3 Interact): a panel, a console, a drawer, loot. `kind` names what it is;
 * the package that handles a kind gives it its rules, and its live state goes in `State.objects`. `pos` is the tile it
 * stands or hangs on; one on a furniture tile (a console, a desk) is used from a tile next to it.
 */
export interface WorldObject {
    id: string;
    kind: string;
    pos: Pos;
    facing: Facing;
    /** What the player calls it ("Teller window alarm button"), where that isn't just its kind. */
    name?: string;
    /** The room it stands in. */
    room?: string;
    /** Loot (§15.1): what it is worth and how heavy it is to carry. */
    loot?: { value: number; weight: 'light' | 'heavy' | 'very heavy' };
    /** A CCTV desk: how many feeds its operator watches at once (§8.12). */
    monitors?: number;
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

/** The bank as built. Rules only ever see it as `ReadonlyWorld`. */
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

export type ReadonlyWorld = DeepReadonly<World>;

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
 * An NPC's state badges (§16.1). Curious and Investigating follow the highest suspicion it holds (§8.5); Alerted is for
 * the rest of the heist (§8.7); the last four are face down or out (§10). Augment to add one.
 */
export interface NpcStatusMap {
    calm: true; curious: true; investigating: true; alerted: true; hostile: true;
    commanded: true; tied: true; unconscious: true; dead: true;
}
export type NpcStatus = keyof NpcStatusMap;

/** What an NPC does at the end of its intent's path, by kind (raise the alarm, frisk, open a door). Augment to add one. */
export interface IntentActionMap {}
export type IntentAction = { [K in keyof IntentActionMap]: { kind: K } & IntentActionMap[K] }[keyof IntentActionMap];

/**
 * What an NPC will do in the next world phase, drawn on the map (§4 Intent): walk `path` (empty to stay put), then face
 * `facing` and do `action`, if given. Committed at the end of a world phase and carried out in the next (§6.2).
 */
export interface Intent {
    path: Pos[];
    facing?: Facing;
    action?: IntentAction;
}

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

/** A door now: breached is open for good, jammed is shut for good (§14.3). */
export type DoorStatus = 'open' | 'closed' | 'locked' | 'breached' | 'jammed';

export interface DoorState { status: DoorStatus }

/** What a heist changed about an edge (a hole, a shot-out pane); each field overrides the World's. */
export type EdgeState = Partial<EdgeProps>;

/** What a heist changed about an object (a disabled panel, an opened drawer). Augment to add fields. */
export interface ObjectState {
    disabled?: boolean;
    open?: boolean;
}

export interface CameraState {
    /** Which of its `facings` it looks along now. */
    facing: number;
    live: boolean;
}

/** The alarm carriers of §9.1. Augment to add one. */
export interface CarrierKindMap {
    tellerButton: true; managerButton: true; guardRadio: true; operatorCamera: true; phoneCall: true; escapee: true;
    missedCheckIn: true; seismicSensor: true; motionSensor: true; patrolCar: true;
}
export type CarrierKind = keyof CarrierKindMap;

/**
 * Someone or something in the middle of raising the Alarm (§9.1). It goes off when the countdown reaches 0. The
 * devices step ticks it, but never in the world phase that started it, so every carrier is seen at its full countdown.
 */
export interface Carrier {
    id: string;
    kind: CarrierKind;
    /** The NPC or object carrying it. */
    source: string;
    /** Where its icon and countdown are drawn. */
    pos: Pos;
    /** World phases left; starts at `rules.minCarrierCountdown` or more. */
    countdown: number;
    started: { turn: number; phase: Phase };
    /** A paused carrier doesn't tick (its holder is commanded, a jammer runs); a countered one never goes off. */
    halted: 'paused' | 'countered' | null;
}

/** Loud and Alarm are separate (§4): an alarm is silent (§9.2), and a gunshot is loud without calling anyone. */
export interface BankState {
    loud: boolean;
    alarm: boolean;
}

/** One roll of the dice, kept so a heist's luck can be shown. */
export interface DiceRoll {
    turn: number;
    stream: string;
    /** What the roll was for, for the log ("hit jun", "resist"). */
    reason: string;
    /** The raw draw in [0, 1), or the integer for `Dice.int`. */
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
    /** Overrides of the World's edges, by edge key. */
    edges: Record<EdgeKey, EdgeState>;
    /** Overrides of the World's objects, by object id. */
    objects: Record<string, ObjectState>;
    cameras: Record<string, CameraState>;
    carriers: Carrier[];
    /** The heist's seed: a stream starts from it and its name the first time it is rolled. */
    seed: number;
    /** Each named random stream's position, uint32 (see `core/rng.ts`). */
    rng: Record<string, number>;
    /** The last `DICE_WINDOW` rolls; the full log belongs to the session, not the state that is copied every action. */
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
