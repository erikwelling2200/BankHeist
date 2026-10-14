import type { Level, LevelPerson, LevelProp, Room } from '../level/plan';

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

/** A camera (§8.3, §8.12): where it hangs, which way it looks, and whether it pans. */
export interface GenCamera { id: string; tx: number; ty: number; facing: 'south' | 'north' | 'east' | 'west'; panning: boolean; room: string }

/** What someone does from a turn on (§16.1): a time block. */
export interface ScheduleBlock { from: number; activity: string; room: string }

/** A person of the bank (§16.2) with their place in the population: role, schedule and traits. */
export interface GenPerson extends LevelPerson {
    id: string;
    role: string;
    name: string;
    observer: 'civilian' | 'staff' | 'enforcer';
    schedule: ScheduleBlock[];
    traits: string[];
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
    validation: { results: RuleResult[]; relaxed: string[]; attempts: number };
}
