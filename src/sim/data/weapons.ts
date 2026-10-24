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
