import type { Level, LevelPerson, LevelProp, Room } from '../level/plan';
import type { RoomMetrics } from './metrics';
import type { Furnished, Station, Story } from './parcels';

/*
 * What the procedural bank generator (GAME_DESIGN §17) produces: a level the scene draws like the hand-made one, and
 * everything the design asks a bank to know about itself (who holds which key, how the crew can get in, the day's
 * timeline, what to discover) plus the report of the checks it passed (§17.7).
 */

export type Tier = 'small' | 'city' | 'hq';
export type Archetype = 'twoWing' | 'atrium' | 'threeKeys' | 'fortress' | 'mezzanineWatch';
export type PlotKind = 'midBlock' | 'cornerLot' | 'plazaFront' | 'stripMallEnd';

export const TIERS: readonly Tier[] = ['small', 'city', 'hq'];
export const ARCHETYPES: readonly Archetype[] = ['twoWing', 'atrium', 'threeKeys', 'fortress', 'mezzanineWatch'];
export const PLOTS: readonly PlotKind[] = ['midBlock', 'cornerLot', 'plazaFront', 'stripMallEnd'];

/** The rooms of a bank (§17.4) and of its neighbours (§17.5), and the open ground around them. */
export type RoomType =
    | 'lobby' | 'tellerLine' | 'restroom' | 'atmRoom' | 'managerOffice' | 'breakRoom' | 'cleanersCloset' | 'staffCorridor'
    | 'mantrap' | 'cctvRoom' | 'alarmCloset' | 'serverRoom' | 'antechamber' | 'vault' | 'depositBoxes' | 'loadingBay'
    | 'mezzanine' | 'stairwell' | 'countingRoom' | 'recordsRoom' | 'staffOffice' | 'conferenceRoom'
    | 'cafe' | 'cafeKitchen' | 'vacantShop' | 'vacantBackRoom' | 'garage' | 'buildingSite' | 'towerLobby' | 'towerStairs'
    | 'nest' | 'officeToLet' | 'shop'
    | 'alley' | 'street' | 'sideRoad' | 'plaza' | 'parkingLot' | 'farSidewalk' | 'backLot';

/** Which part of the bank a room is in: the archetype's wings (§17.2). */
export type Wing = 'front' | 'west' | 'east' | 'centre' | 'back' | 'core' | 'mezzanine' | 'outside';

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * A room as the level knows it (`Room`) plus what the generator knows about it. Its x, y, w, h are the bounding box of
 * its `parts`; the site's owner grid says which room each tile is in, and agrees with the parts.
 */
export interface GenRoom extends Room {
    id: string;
    /** The rectangles the room is made of, largest first: one for a plain room, two or three for an L or a notch. */
    parts: Rect[];
    type: RoomType;
    wing: Wing;
    /** Inside the bank's lot (not a neighbour or the street). */
    bank: boolean;
    /** What the briefing shows before casing (§17.8): the public floor and the exterior always, the rest as outlines. */
    known: 'blueprint' | 'outline';
}

/** How a door locks (§14.1), which decides its keys. */
export type Lock = 'none' | 'mechanical' | 'keycard' | 'maglock' | 'vault';

/** A connection between two rooms, or a room and the outside: a door segment on a wall edge, or an open gap. */
export interface Door {
    id: string;
    a: string;
    b: string;
    lock: Lock;
    /** Where it is: the wall segment's run and tile, as in `Wall`. */
    run: 'eastWest' | 'northSouth';
    tx: number;
    ty: number;
    /** A counter gate or an open doorway: no leaf, but still a way between two rooms. */
    open?: boolean;
    /** A locked shortcut between two rooms that were a long walk apart (§17.7 loops): the steps that walk took. */
    detour?: number;
}

/** A hard lock and its three keys (§15.2, §17.2 step 4). */
export interface KeyLock {
    id: string;
    name: string;
    /** The door or object it locks. */
    target: string;
    social: string;
    technical: string;
    violent: string;
    /** People who carry the social key, by id. */
    holders: string[];
}

export type ApproachCategory = 'social' | 'covert' | 'forced';

/** A way into the bank (§17.5): where the crew starts it outside and where it lets them in. */
export interface Approach {
    id: string;
    category: ApproachCategory;
    name: string;
    outside: { tx: number; ty: number };
    inside: { tx: number; ty: number };
    /** The room it lets the crew into. */
    room: string;
}

/** An off-map route (§14.7): a pair of access points and the turns spent in transit. */
export interface OffMapRoute {
    kind: 'roof' | 'sewer';
    outside: { tx: number; ty: number };
    inside: { tx: number; ty: number };
    transit: number;
}

/** A spot a getaway vehicle can wait at from the start (§15.4). */
export interface GetawaySpot { id: string; name: string; tx: number; ty: number; risk: 'police view' | 'hidden' }

/** Where vehicles leave the plot, and where police stage (§13.4). */
export interface PlotExit { id: string; name: string; tx: number; ty: number }

/** The eight compass directions, clockwise from north, as the rules face people and cameras (§6.3). */
export type Compass = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/**
 * A camera (§8.3, §8.12): where it hangs, which way it looks, and whether it pans. A panning camera alternates between
 * the two facings of `pan`, its facing turned 45° either way (anticlockwise first).
 */
export interface GenCamera {
    id: string; tx: number; ty: number; facing: 'south' | 'north' | 'east' | 'west'; panning: boolean; room: string;
    pan?: [Compass, Compass];
}

/** What someone does from a turn on (§16.1): a time block. */
export interface ScheduleBlock { from: number; activity: string; room: string }

/**
 * What someone does in a time block (§16.1–16.3), as the rules run it (`src/sim/rules/npc`); `routines.ts` derives it
 * from the schedule:
 * - standing activities, at `at` facing `facing`: `post` (a desk, a console, a guard post), `window` (teller window duty),
 *   `break` (in the break room), `lunch`, `shiftChange`, `cashRun` and `inspection` (at the vault door), `smokeBreak`
 *   (outside the alley door), `serviceVisit` (the IT technician at the server room or alarm closet), and for customers
 *   `queue`, `wait` (the waiting area, the brochures) and `counter` (at a teller window);
 * - walking ones, along `route`: `patrol` and `sweep` there and back, `closingSweep` once through every room;
 * - leaving: `leave` walks to `at` (outside the front door) and leaves the map; `offMap` is the same for someone who
 *   comes back later (the manager's lunch out). A later block on the map brings them back in at that tile.
 */
export type Activity =
    | 'post' | 'window' | 'break' | 'lunch' | 'shiftChange' | 'cashRun' | 'inspection' | 'smokeBreak' | 'serviceVisit'
    | 'queue' | 'wait' | 'counter' | 'patrol' | 'sweep' | 'closingSweep' | 'leave' | 'offMap';

/** A tile, as the generator gives them. */
export interface TilePos { tx: number; ty: number }

/** A typed time block of someone's routine, in order of `from`; it lasts until the next one. */
export interface RoutineBlock {
    from: number;
    /** When to set off for it, if earlier than `from`: travel time, so they are there on `from`. */
    setOff?: number;
    activity: Activity;
    /** What the briefing and an NPC's card say about it ("lunch (out of the building)"). */
    label: string;
    /** The room it happens in ('' when it has none of its own: a route, the street). */
    room: string;
    /** Where to stand, or for `leave` and `offMap` the tile where they leave the map (and come back in). */
    at?: TilePos;
    /** Which way to face once there. */
    facing?: Compass;
    /** The waypoints of a walking activity, in order, starting where it starts. */
    route?: TilePos[];
}

/**
 * What sets a person apart that nobody sees at a glance (§16.2, §10.9), as data the rules read (`worldFromBank`) and the
 * schedules follow. Each is set only when it applies.
 */
export interface PersonTraits {
    /** A concealed weapon: the off-duty cop among the customers (§10.9). No tells; `hidden` keeps him off the briefing. */
    armed?: true;
    /** Bold (§16.2 hero): resists a command, flees while others cower, tackles a crew member next to him. */
    hero?: true;
    /** In debt: can be bribed to stay off the alarm (an opportunity, §17.6). */
    bribable?: true;
    /** On a break at the start (the break room's teller). */
    onBreak?: true;
    /** Works the drive-through window. */
    driveThrough?: true;
    /** Radios in to dispatch (a guard's check-ins, §8.11). */
    radio?: true;
}

/** A person of the bank (§16.2) with their place in the population: role, schedule and traits. */
export interface GenPerson extends LevelPerson {
    id: string;
    role: string;
    name: string;
    observer: 'civilian' | 'staff' | 'enforcer';
    schedule: ScheduleBlock[];
    /** The schedule as typed blocks with their tiles, for the rules (`routines.ts`). */
    routine?: RoutineBlock[];
    traits: PersonTraits;
    /** Hidden from the briefing until discovered (an off-duty cop looks like a customer, §16.2). */
    hidden?: boolean;
}

/** One entry on the bank's timeline (§16.3). */
export interface TimelineEvent { turn: number; name: string; detail: string; duration?: number }

/** An opportunity (§17.6): what it is, when, and how it is found. */
export interface Opportunity { id: string; text: string; found: 'eavesdropping' | 'documents' | 'intel'; turn?: number }

/** A headline feature (§17.6). */
export type Headline =
    | 'atriumSkylight' | 'mezzanineCctv' | 'scaffoldingNextDoor' | 'armouredCar' | 'managerLate' | 'oldBank' | 'mallBank'
    | 'driveThrough';

export const HEADLINE_NAMES: Record<Headline, string> = {
    atriumSkylight: 'A glass atrium roof (skylight entry)',
    mezzanineCctv: 'A mezzanine CCTV room overlooking the floor',
    scaffoldingNextDoor: 'Scaffolding next door',
    armouredCar: 'An armoured-car delivery mid-heist',
    managerLate: 'A manager working late',
    oldBank: 'An old bank: a round vault door and metre-thick walls',
    mallBank: 'A bank in a mall: crowds and many exits',
    driveThrough: 'A drive-through teller lane'
};

/** A rule of §17.7 and how it went. */
export interface RuleResult { rule: string; ok: boolean; detail: string }

export interface GeneratedBank {
    seed: { layout: number; population: number };
    name: string;
    tier: Tier;
    archetype: Archetype;
    plot: PlotKind;
    headlines: Headline[];
    vaultClass: 'M' | 'I' | 'II' | 'III';
    timeLock: boolean;
    dualControl: boolean;
    policeEta: number;
    level: Level;
    rooms: GenRoom[];
    doors: Door[];
    props: LevelProp[];
    people: GenPerson[];
    cameras: GenCamera[];
    locks: KeyLock[];
    approaches: Approach[];
    routes: OffMapRoute[];
    getaways: GetawaySpot[];
    exits: PlotExit[];
    staging: PlotExit[];
    neighbours: string[];
    timeline: TimelineEvent[];
    opportunities: Opportunity[];
    intel: string[];
    /** Where people work or wait (the parcels' stations, with their roles). */
    stations: Station[];
    /** Silent-alarm stations (§9.1): teller windows, the manager's desk button, the CCTV console's panel. */
    alarms: Furnished['alarms'];
    /** Loot by tile (§15.1). */
    loot: Furnished['loot'];
    /** Spots the parcels left for the inside ends of the sewer, duct and roof routes. */
    grates: Furnished['grates'];
    vents: Furnished['vents'];
    hatches: Furnished['hatches'];
    /** How many monitors the CCTV operator watches the cameras on (§8.12); 0 without an operator. */
    monitors: number;
    /** The vignettes the story pass left in the rooms (who uses them, what just happened). */
    stories: Story[];
    /** The checks of §17.7, and per room how full it is, how much cover it has and how much of it its doors see. */
    validation: { results: RuleResult[]; relaxed: string[]; attempts: number; metrics: RoomMetrics[] };
}
