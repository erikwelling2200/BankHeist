import type { WeaponId } from './weapons';

/*
 * The police's canonical tables (§13.1–13.4) as data: the heat events and their ticks, the force on scene at each
 * heat level, the vehicles that bring it, the greed scaling and the director's rhythm. The rules that use them are
 * rules/heat.ts (the track) and rules/police.ts (the director).
 */

/** Ticks per heat level (§13.1): 5 reach Heat 2, 10 Heat 3, 15 Heat 4, 20 Heat 5. */
export const TICKS_PER_LEVEL = 5;
/** The highest heat level (§13.1); past it every `TICKS_PER_LEVEL` ticks sends reinforcements. */
export const MAX_HEAT = 5;

/** What changes the heat (§13.2), and by how many ticks. */
export type HeatCause = 'phase' | 'staffKilled' | 'firstPoliceKilled' | 'policeKilled' | 'civilianKilled' | 'vaultWork' | 'hostageEscaped' | 'release' | 'witnessedKills';

/** The canonical heat events (§13.2): ticks and what the HUD calls them. */
export const HEAT_EVENTS: Readonly<Record<HeatCause, { ticks: number; label: string }>> = {
    phase: { ticks: 1, label: 'A world phase after the Alarm' },
    staffKilled: { ticks: 1, label: 'A guard or staff member killed, witnessed' },
    firstPoliceKilled: { ticks: 3, label: 'The first police officer killed' },
    policeKilled: { ticks: 1, label: 'A police officer killed' },
    civilianKilled: { ticks: 5, label: 'A civilian or hostage killed' },
    vaultWork: { ticks: 1, label: 'Drilling or burning a Class II+ vault' },
    hostageEscaped: { ticks: 1, label: 'A hostage escaped to the police' },
    release: { ticks: -3, label: 'A hostage released' },
    /** The kills witnessed before the Alarm, as one lump when it fires: the sum of their own ticks, passed as `by`. */
    witnessedKills: { ticks: 0, label: 'Kills witnessed before the Alarm' }
};

/** Releases that lower the heat (§13.2: once per turn, three times per heist). */
export const RELEASES_PER_HEIST = 3;

/** A police unit's kind (§13.3): one officer each; a SWAT team is 4 of them, one with a shield. */
export type PoliceKind = 'patrol' | 'negotiator' | 'swat' | 'swatShield' | 'heavy' | 'sniper';

/** The kinds in the order waves load them. */
export const POLICE_KINDS: readonly PoliceKind[] = ['patrol', 'negotiator', 'swatShield', 'swat', 'heavy', 'sniper'];

export const POLICE_LABELS: Readonly<Record<PoliceKind, string>> = {
    patrol: 'Patrol officer', negotiator: 'Negotiator', swat: 'SWAT officer', swatShield: 'SWAT shield', heavy: 'Heavy SWAT', sniper: 'Sniper'
};

/**
 * The force on scene by heat level (§13.3), one officer per unit: 2 cars of patrol officers at Heat 1, 8 officers and
 * the negotiator at 2, a SWAT team (one shield) at 3, a second team and 2 sniper teams of 2 at 4, a heavy team (2 heavy,
 * 2 SWAT) at 5. The helicopter (`HELICOPTER_FROM`) is a vehicle, not a unit.
 */
export const FORCE: Readonly<Record<number, Readonly<Record<PoliceKind, number>>>> = {
    1: { patrol: 4, negotiator: 0, swatShield: 0, swat: 0, heavy: 0, sniper: 0 },
    2: { patrol: 8, negotiator: 1, swatShield: 0, swat: 0, heavy: 0, sniper: 0 },
    3: { patrol: 8, negotiator: 1, swatShield: 1, swat: 3, heavy: 0, sniper: 0 },
    4: { patrol: 8, negotiator: 1, swatShield: 2, swat: 6, heavy: 0, sniper: 4 },
    5: { patrol: 8, negotiator: 1, swatShield: 2, swat: 8, heavy: 2, sniper: 4 }
};

/** The heat level from which the helicopter hovers over the plot (§13.3). */
export const HELICOPTER_FROM = 4;

/** Greed (§13.3): the force grows by this many percent per bag secured, up to `GREED_CAP` percent. */
export const GREED_PER_BAG = 10;
export const GREED_CAP = 50;
/** Kinds greed doesn't scale: there is one negotiator. */
export const UNSCALED: ReadonlySet<PoliceKind> = new Set<PoliceKind>(['negotiator']);

/** Patrol officers per perimeter car, and perimeter cars per staging point at most (§13.4). */
export const CAR_SEATS = 2;
export const CARS_PER_STAGING = 2;
/** Units a transport van brings: a SWAT team (§13.6). */
export const VAN_SEATS = 4;
/** Who rides together in a van: a SWAT van carries the assault teams, a police van everyone else. */
export const SWAT_KINDS: ReadonlySet<PoliceKind> = new Set<PoliceKind>(['swatShield', 'swat', 'heavy']);

/** The director's modes (§13.4). */
export type PoliceMode = 'contain' | 'negotiate' | 'assault' | 'regroup';

export const MODE_LABELS: Readonly<Record<PoliceMode, string>> = { contain: 'Contain', negotiate: 'Negotiate', assault: 'Assault', regroup: 'Regroup' };

/** Contain's length on scene (§13.4), and after a Regroup with no hostages held. */
export const CONTAIN_PHASES = 3;
export const CONTAIN_AGAIN_PHASES = 1;
/** Negotiate: 2, +1 per hostage held, at most +6. */
export const NEGOTIATE_PHASES = 2;
export const NEGOTIATE_HOSTAGE_CAP = 6;
/** Assault: 4, +1 per heat level above 2. */
export const ASSAULT_PHASES = 4;
/** Regroup: 3, 2 from Heat 4. */
export const REGROUP_PHASES = 3;
export const REGROUP_PHASES_HIGH = 2;
/** Stall (§13.4): Negotiate runs this many world phases longer, once a heist. */
export const STALL_PHASES = 2;

/** An officer's combat numbers (§12.3): hit points, armour and the gun it fires (none: the negotiator doesn't fight). */
export interface OfficerStats { hp: number; armour: number; weapon: WeaponId | null }

/**
 * §12.3 by kind. A patrol officer carries a pistol (the table's "or shotgun" waits for kit by unit, M3-06); the shield's
 * frontal shield and the snipers' raised positions are M3-06's.
 */
export const OFFICER_STATS: Readonly<Record<PoliceKind, OfficerStats>> = {
    patrol: { hp: 6, armour: 1, weapon: 'pistol' },
    negotiator: { hp: 6, armour: 1, weapon: null },
    swat: { hp: 7, armour: 2, weapon: 'assaultRifle' },
    swatShield: { hp: 7, armour: 2, weapon: 'pistol' },
    heavy: { hp: 12, armour: 3, weapon: 'lmg' },
    sniper: { hp: 6, armour: 1, weapon: 'dmr' }
};

/**
 * The kinds that fight (§13.6): by the simple routine, or a SWAT van's team by its team play (rules/swat.ts); snipers
 * wait for their nests.
 */
export const ROUTINE_KINDS: ReadonlySet<PoliceKind> = new Set<PoliceKind>(['patrol', 'swat', 'swatShield', 'heavy']);

/**
 * Flashbangs each officer carries (§13.3: police have them from Heat 2, §13.6 "using their kit"): SWAT one each, the
 * heavy none. Patrol officers' are deferred (M3-06's notes).
 */
export const OFFICER_FLASHBANGS: Readonly<Record<PoliceKind, number>> = { patrol: 0, negotiator: 0, swat: 1, swatShield: 1, heavy: 0, sniper: 0 };

/** How heavy a weapon a SWAT team reads a crew member's drawn gun as (§13.6 target priority, last): by weapon row. */
export const WEAPON_WEIGHT: Readonly<Record<string, number>> = {
    lmg: 5, dmr: 4, assaultRifle: 4, shotgun: 3, shotgunSlug: 3, smg: 2, machinePistol: 2, pistol: 1, suppressedPistol: 1, taser: 0
};

/** How far an officer (or a fighting guard) sees in combat, in tiles, all round (decision 151). */
export const COMBAT_SIGHT = 10;

/** The heat level from which officers breach locked doors (§13.4: at Heat 1–2 only open or unlocked ones). */
export const BREACH_FROM = 3;
