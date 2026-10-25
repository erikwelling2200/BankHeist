import { HEAVY_ARMOUR_ITEM } from './movement';

/*
 * The weapons' combat numbers (§12.1), the armour (§12.3) and what cover can take (§11.4), as data. The shot geometry
 * (geo/shot.ts) and the shot rules (rules/shot.ts) read them; the profile and Threat stay in data/items.ts.
 *
 * - **Aim** is the arc of bullet 1 in degrees; bullet k flies within Aim + (k − 1) × Recoil (§11.2).
 * - **Moved** multiplies Aim when the shooter moved this turn (none when braced, §6.3 Brace).
 * - **Damage** and **Pierce** per bullet: a hit deals max(0, Damage − max(0, Armour − Pierce)) (§11.5).
 * - **Range** in tiles: a bullet flies on to the last tile whose centre is within it (decision 85).
 * - The taser knocks out what it hits (`knockout`) and deals no damage.
 */

export interface WeaponDef {
    /** Bullet 1's arc, degrees. */
    aim: number;
    /** Degrees added to the arc per later bullet. */
    recoil: number;
    /** The LMG's recoil on its bipod (§6.3 Brace). */
    bracedRecoil?: number;
    /** Bullets per attack: the fire selector fires 1 up to this (§11.1). */
    bullets: number;
    damage: number;
    pierce: number;
    range: number;
    /** Aim's multiplier after moving this turn (§11.2). */
    moved: number;
    /** Rounds in a magazine (§11.11, M3-02). */
    mag: number;
    /** The noise radius of an attack (§8.9). */
    noise: number;
    /** Extra damage per hit on a body within `within` tiles (the pump shotgun's +1 within 3). */
    close?: { within: number; damage: number };
    /** ×1.5 damage against Calm, Curious or Surprised targets (§11.5, the DMR). */
    precision?: true;
    /** Knocks out what it hits instead of dealing damage (the taser). */
    knockout?: true;
    /** It can Brace on a bipod (§6.3, §12.1: the DMR and the LMG). */
    brace?: true;
}

/** §12.1, canonical. Slugs are the pump shotgun's other ammunition (M3-02 picks which is loaded). */
export const WEAPONS = {
    taser: { aim: 2, recoil: 0, bullets: 1, damage: 0, pierce: 0, range: 4, moved: 1, mag: 3, noise: 2, knockout: true },
    pistol: { aim: 5, recoil: 6, bullets: 2, damage: 3, pierce: 0, range: 12, moved: 1, mag: 12, noise: 8 },
    suppressedPistol: { aim: 6, recoil: 6, bullets: 2, damage: 3, pierce: 0, range: 10, moved: 1, mag: 12, noise: 3 },
    machinePistol: { aim: 14, recoil: 3, bullets: 6, damage: 2, pierce: 0, range: 8, moved: 1, mag: 30, noise: 10 },
    smg: { aim: 7, recoil: 2, bullets: 4, damage: 2, pierce: 0, range: 12, moved: 1.25, mag: 30, noise: 9 },
    shotgun: { aim: 20, recoil: 0, bullets: 6, damage: 2, pierce: 0, range: 8, moved: 1, mag: 6, noise: 12, close: { within: 3, damage: 1 } },
    shotgunSlug: { aim: 4, recoil: 0, bullets: 1, damage: 6, pierce: 2, range: 12, moved: 1, mag: 6, noise: 12 },
    assaultRifle: { aim: 2, recoil: 3, bullets: 3, damage: 4, pierce: 1, range: 20, moved: 2, mag: 30, noise: 14 },
    dmr: { aim: 1, recoil: 0, bullets: 1, damage: 9, pierce: 3, range: 30, moved: 6, mag: 5, noise: 18, precision: true, brace: true },
    lmg: { aim: 6, recoil: 2, bracedRecoil: 1, bullets: 10, damage: 3, pierce: 1, range: 20, moved: 2, mag: 100, noise: 18, brace: true }
} as const satisfies Record<string, WeaponDef>;

export type WeaponId = keyof typeof WEAPONS;

export const isWeapon = (id: string): id is WeaponId => Object.hasOwn(WEAPONS, id);

export function weaponDef(id: string): WeaponDef {
    if (!isWeapon(id)) throw new Error(`No weapon '${id}'`);
    return WEAPONS[id];
}

/** The pierce that passes the first body with this much less damage (§11.6 overpenetration). */
export const OVERPENETRATION = { pierce: 3, loss: 3 } as const;

/** The pierce teller glass lets through, and the hits after which it shatters (§11.4, §11.6). */
export const TELLER_GLASS = { pierce: 3, hits: 4 } as const;

/** A Soft wall or a wooden door: Pierce at least 1 passes it with 1 damage less (§11.6). */
export const SOFT_WALL = { pierce: 1, loss: 1 } as const;

/** The chance half cover blocks a bullet that would hit (§11.4). */
export const COVER_BLOCK = 0.5;

/** The DMR's precision bonus (§11.5), applied to the damage a hit deals, rounded down. */
export const PRECISION = 1.5;

/** The crew's armour pieces (§12.3), worn when in `Loadout.items` (not packed). */
export const CREW_ARMOUR: Readonly<Record<string, number>> = { lightVest: 1, mediumArmour: 2, [HEAVY_ARMOUR_ITEM]: 3 };

/**
 * NPC armour by role (§12.3): 'guard' is `rules.guardArmour` (0, 1 from City tier). Anyone not listed has none
 * (civilians, staff, the off-duty cop). The police roles join with M3-04.
 */
export const NPC_ARMOUR: Readonly<Record<string, number | 'guard'>> = {
    lobbyGuard: 'guard', patrolGuard: 'guard', guard: 'guard', courier: 'guard', chief: 1, officer: 1, swat: 2, shieldSwat: 2
};

/**
 * What a half-cover prop takes before it breaks (§11.4: desk 6, planter 4, counter 10), by the generator's prop kind;
 * null can't be destroyed. A kind not listed takes `DEFAULT_COVER_HP`.
 */
export const COVER_HP: Readonly<Record<string, number | null>> = {
    desk: 6, writingDesk: 6, cctvDesk: 6, diningTable: 6, meetingTable: 6, cafeTable: 6, sofa: 6, bench: 6,
    plant: 4, boxes: 4, printer: 4, cleaningTrolley: 4, newsBox: 4, streetBin: 4, chair: 3, officeChair: 3, mopBucket: 2,
    counter: 10, backCounter: 10, cafeCounter: 10, kitchenCounter: 10, vaultConsole: 10, filingCabinet: 8, dumpster: 10, generator: 10,
    hydrant: null, bollard: null
};

export const DEFAULT_COVER_HP = 6;

// ---------------------------------------------------------------------------------------------------------- M3-02

/*
 * The weapons in the crew's hands (§11.8–11.11, §12.1, §12.2; implementation plan M3-02, decisions 93–108):
 *
 * - **Loads.** A weapon item fires one of the table's rows: its own, or the pump shotgun's slugs (`LOADS`). Reloading
 *   picks the load; both come from the same spare magazines (decision 94).
 * - **Spares** (§11.11): 3 spare magazines per weapon; the taser's 3 cartridges are its only load.
 * - **Watch** (§11.8): the widest wedge per weapon; a volley is half the Bullets rounded up, Aim ×1.5 (×1 at 15° or
 *   narrower).
 * - **Suppress** (§11.9): the LMG's wedge of up to 60°, every bullet with its spread doubled, 2 actions.
 * - **Throwables** (§12.2): how many come in a kit item, how far they are thrown and what they reach.
 */

/** The rows of the weapon table a weapon item can fire (the pump shotgun: buckshot or slugs). */
export const LOADS: Readonly<Record<string, readonly WeaponId[]>> = { shotgun: ['shotgun', 'shotgunSlug'] };

/** The rows a weapon item fires: its own (or its loads). */
export const loadsOf = (item: string): readonly WeaponId[] => (Object.hasOwn(LOADS, item) ? LOADS[item]! : isWeapon(item) ? [item] : []);

/** Spare magazines a crew member carries per weapon (§11.11), by weapon item; anything else `SPARE_MAGS`. */
export const SPARE_MAGS = 3;
export const SPARES_OF: Readonly<Record<string, number>> = { taser: 0 };

/** The weapons that cost 2 actions to fire (§6.3: the LMG). */
export const HEAVY_FIRE: ReadonlySet<string> = new Set(['lmg']);

/** The widest Watch wedge per weapon row (§11.8), degrees. */
export const WATCH_ARC: Readonly<Record<string, number>> = {
    taser: 60, pistol: 60, suppressedPistol: 60, machinePistol: 60, smg: 60, shotgun: 60, shotgunSlug: 60, lmg: 60, assaultRifle: 45, dmr: 15
};

/** A Watch volley's Aim (§11.8): ×1.5, or ×1 when the wedge is `WATCH_NARROW` degrees or narrower. */
export const WATCH_AIM = 1.5;
export const WATCH_NARROW = 15;

/** Suppress (§11.9): the wedge's widest arc, the spread's multiplier and its cost in actions. */
export const SUPPRESS = { arc: 60, spread: 2, cost: 2, pips: 2, weapons: ['lmg'] as readonly string[] } as const;

/** A suppressed NPC's Aim multiplier (§11.9), for its own shots (M3-05). */
export const SUPPRESSED_AIM = 1.5;

/** The weapons that can Brace (§6.3): the DMR and the LMG on their bipods. */
export const BRACEABLE: ReadonlySet<string> = new Set(['dmr', 'lmg']);

/** Melee strike (§11.11): adjacent, 3 damage, Pierce 0, lethal. */
export const STRIKE = { damage: 3, pierce: 0 } as const;

/** The taser's dart doesn't knock out through this much armour or more (§11.10). */
export const TASER_STOPPED_BY = 2;

/** The NPCs' guns (§12.3) by role: guards, couriers and an off-duty cop carry a pistol; police join with M3-04. */
export const NPC_GUN: Readonly<Record<string, WeaponId>> = {};
export const DEFAULT_NPC_GUN: WeaponId = 'pistol';
/** Spare magazines an armed NPC carries (decision 95). */
export const NPC_SPARE_MAGS = 2;

/** A throwable (§12.2): per kit item, how far it is thrown (Euclidean, tiles) and the radius it reaches as it goes off. */
export interface ThrowableDef { count: number; range: number; radius: number }

export const THROWABLES = {
    flashbang: { count: 2, range: 6, radius: 2 },
    smoke: { count: 2, range: 6, radius: 2 }
} as const satisfies Record<string, ThrowableDef>;

export type ThrowableId = keyof typeof THROWABLES;

export const isThrowable = (id: string): id is ThrowableId => Object.hasOwn(THROWABLES, id);

/** World phases a smoke cloud blocks sight (§12.2: 3). */
export const SMOKE_PHASES = 3;

/**
 * The props that can be flipped into improvised cover (§11.4: tables, light desks, café tables), by the generator's
 * prop kind. A flipped one keeps its hit points (`COVER_HP`, a wooden table 6).
 */
export const FLIPPABLE: ReadonlySet<string> = new Set(['cafeTable', 'coffeeTable', 'diningTable', 'desk', 'writingDesk']);

/** Pips anyone who sees a table flipped during stealth gains of the flipper (§11.4). */
export const FLIP_PIPS = 2;

// ---------------------------------------------------------------------------------------------------------- M3-03

/** An NPC's hit points by role (§12.3); an armed civilian (the off-duty cop) `ARMED_NPC_HP`, anyone else `DEFAULT_NPC_HP`. */
export const NPC_HP: Readonly<Record<string, number>> = {
    lobbyGuard: 5, patrolGuard: 5, guard: 5, courier: 5, chief: 6, officer: 6, sniper: 6, swat: 7, shieldSwat: 7, heavySwat: 12
};
export const ARMED_NPC_HP = 5;
export const DEFAULT_NPC_HP = 3;
