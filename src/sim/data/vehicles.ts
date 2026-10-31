/*
 * The getaway's numbers (§14.4, §15.4, §15.5) as data: the crew's vehicles, how far they drive, the curve a turn takes
 * and the contract's target. The rules that use them are geo/drive.ts (where a vehicle can go) and rules/vehicles.ts
 * (driving, boarding, the hold) and rules/getaway.ts (leaving the plot and the outcome).
 */

/** What the rules know of a kind of vehicle: its footprint across and along it, in tiles (§14.4). */
export interface VehicleSpec { name: string; width: number; length: number }

/** The crew's vehicles (§14.4). Only the van in M3; the ram truck and the backup car are planning assets (M4). */
export const VEHICLES = {
    van: { name: 'Crew van', width: 2, length: 4 }
} as const satisfies Record<string, VehicleSpec>;

export type VehicleType = keyof typeof VEHICLES;

/** Tiles of path one Drive (1 action) covers (§14.4), and with a Wheelman driving. */
export const DRIVE_TILES = 8;
export const WHEELMAN_DRIVE_TILES = 16;

/**
 * A quarter turn (decision 171): the middle of the vehicle follows a quarter circle of this radius, in tiles, about a
 * point beside it, and the curve costs its length rounded to whole tiles (π·2/2 ≈ 3). A 180° turn is two of them and
 * ends beside where it began, two tiles clear of it, facing back (§14.4).
 */
export const TURN_RADIUS = 2;
export const TURN_TILES = 3;

/** A drift (§14.4: 1 tile sideways for every 2 travelled): 2 tiles forward or back and 1 across, for 2 tiles of path. */
export const DRIFT_TILES = 2;

/**
 * The turn's sweep, worked out once from whole numbers (decision 171): the angles a quarter turn is sampled at, every
 * 3°, as cos and sin scaled by 10000. No trigonometry runs in the rules, so every engine sweeps the same tiles.
 */
export const TURN_STEPS: readonly (readonly [number, number])[] = [
    [10000, 0], [9986, 523], [9945, 1045], [9877, 1564], [9781, 2079], [9659, 2588], [9511, 3090], [9336, 3584], [9135, 4067], [8910, 4540], [8660, 5000],
    [8387, 5446], [8090, 5878], [7771, 6293], [7431, 6691], [7071, 7071], [6691, 7431], [6293, 7771], [5878, 8090], [5446, 8387], [5000, 8660],
    [4540, 8910], [4067, 9135], [3584, 9336], [3090, 9511], [2588, 9659], [2079, 9781], [1564, 9877], [1045, 9945], [523, 9986], [0, 10000]
];
export const TURN_SCALE = 10000;

/**
 * The contract's target by the bank's tier (§15.1, §15.5; decision 175): the loot that must leave in the getaway for a
 * Success. §3's City branch asks $150k; the campaign's contracts set their own (M6).
 */
export const CONTRACT_TARGETS: Readonly<Record<string, number>> = { small: 75000, city: 150000, hq: 200000 };
