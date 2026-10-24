import { HEAVY_ARMOUR_ITEM } from './movement';

/*
 * What the crew carries (§7.3) and how it looks (§7.4), from the weapon table (§12.1), the throwables, charges and
 * gadgets (§12.2) and the crew's armour (§12.3). Only what the profile needs so far: each item's slot and the profile
 * it shows. The combat numbers (aim, recoil, damage, threat, magazine) join the weapons when combat does (M2, M3).
 *
 * - **Profile** is how conspicuous an item is when it is visible (§7.4): Clean, Concealed (under a jacket, a closed
 *   duffel), Armed (a visible long gun) or Heavy (an LMG, heavy armour).
 * - **Packed** items are out of sight (`Loadout.packed`): a long gun or armour in the duffel, or a DMR in its case.
 *   A packed item shows as at most `packed`: the case or the duffel is Concealed (§7.3, §12.1 "Concealed when cased").
 *   An item with `cased` carries its own case; anything else needs a duffel, which holds one long gun and one armour
 *   piece (§7.3).
 * - **Holstered** pistols count as Clean under a guard's uniform (§8.14, rules/profile.ts `crewLook`).
 * - **Threat** (§12.1 Thr) is a weapon's command radius in tiles (§10.1); unarmed is `UNARMED_THREAT`.
 */

export type Profile = 'clean' | 'concealed' | 'armed' | 'heavy';

/** The profiles from least to most conspicuous (§7.4). */
export const PROFILES: readonly Profile[] = ['clean', 'concealed', 'armed', 'heavy'];

export const profileRank = (p: Profile): number => PROFILES.indexOf(p);

/** The profile `steps` higher, capped at Heavy (on edge, Notoriety). */
export const raiseProfile = (p: Profile, steps: number): Profile => PROFILES[Math.min(PROFILES.length - 1, profileRank(p) + steps)]!;

/** The more conspicuous of two profiles. */
export const maxProfile = (a: Profile, b: Profile): Profile => (profileRank(b) > profileRank(a) ? b : a);

/** Loadout slots (§7.3). */
export type Slot = 'primary' | 'sidearm' | 'armour' | 'gadget' | 'fixed';

export interface ItemDef {
    slot: Slot;
    /** How it shows when visible (§7.4). */
    profile: Profile;
    /** It has its own case and may be packed without a duffel (the DMR). */
    cased?: boolean;
    /** It may go in the duffel (long guns and armour, §7.3). */
    duffel?: 'longGun' | 'armour';
    /** A pistol that counts as Clean when holstered under a guard's uniform (§8.14). */
    holsterable?: boolean;
    /** A weapon's Threat (§12.1): the radius in tiles of a command given with it in hand (§10.1). */
    threat?: number;
    /** A pistol: the one weapon in hand with a Very heavy carry (§15.1 "pistol only"). */
    pistol?: true;
}

/** What a packed item shows as, at most: its case or the duffel (§7.3). */
export const PACKED_PROFILE: Profile = 'concealed';

/** The duffel gadget (§7.3): holds one long gun and one armour piece. */
export const DUFFEL_ITEM = 'duffel';

export const ITEMS = {
    // Weapons (§12.1). Unarmed is no item.
    taser: { slot: 'sidearm', profile: 'clean', threat: 2 },
    pistol: { slot: 'sidearm', profile: 'concealed', holsterable: true, threat: 3, pistol: true },
    suppressedPistol: { slot: 'sidearm', profile: 'concealed', holsterable: true, threat: 3, pistol: true },
    machinePistol: { slot: 'sidearm', profile: 'concealed', threat: 4 },
    smg: { slot: 'primary', profile: 'armed', duffel: 'longGun', threat: 4 },
    shotgun: { slot: 'primary', profile: 'armed', duffel: 'longGun', threat: 5 },
    assaultRifle: { slot: 'primary', profile: 'armed', duffel: 'longGun', threat: 5 },
    dmr: { slot: 'primary', profile: 'armed', duffel: 'longGun', cased: true, threat: 5 },
    lmg: { slot: 'primary', profile: 'heavy', duffel: 'longGun', threat: 6 },
    // Armour (§12.3).
    lightVest: { slot: 'armour', profile: 'concealed', duffel: 'armour' },
    mediumArmour: { slot: 'armour', profile: 'armed', duffel: 'armour' },
    [HEAVY_ARMOUR_ITEM]: { slot: 'armour', profile: 'heavy', duffel: 'armour' },
    // Throwables, charges and gadgets (§12.2).
    flashbang: { slot: 'gadget', profile: 'concealed' },
    smoke: { slot: 'gadget', profile: 'concealed' },
    noisemaker: { slot: 'gadget', profile: 'clean' },
    breachCharge: { slot: 'gadget', profile: 'concealed' },
    shapedCharge: { slot: 'gadget', profile: 'concealed' },
    thermite: { slot: 'gadget', profile: 'armed' },
    drill: { slot: 'gadget', profile: 'armed' },
    tripwire: { slot: 'gadget', profile: 'concealed' },
    jammer: { slot: 'gadget', profile: 'concealed' },
    hackingKit: { slot: 'gadget', profile: 'clean' },
    lockpick: { slot: 'gadget', profile: 'clean' },
    glassCutter: { slot: 'gadget', profile: 'clean' },
    medkit: { slot: 'gadget', profile: 'clean' },
    [DUFFEL_ITEM]: { slot: 'gadget', profile: 'concealed' },
    ammoBag: { slot: 'gadget', profile: 'concealed' },
    reinforcementKit: { slot: 'gadget', profile: 'concealed' },
    // Everyone carries these (§7.3). The mask counts only when worn (`Loadout.masked`).
    zipTies: { slot: 'fixed', profile: 'clean' },
    phone: { slot: 'fixed', profile: 'clean' },
    mask: { slot: 'fixed', profile: 'clean' },
    scanner: { slot: 'fixed', profile: 'clean' }
} as const satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEMS;

export const isItem = (id: string): id is ItemId => Object.hasOwn(ITEMS, id);

export function itemDef(id: string): ItemDef {
    if (!isItem(id)) throw new Error(`No item '${id}'`);
    return ITEMS[id];
}

/** Unarmed's Threat (§12.1): a bare-handed command reaches the tiles next to the shouter. */
export const UNARMED_THREAT = 1;

/** Wearing a mask sets the profile to Heavy (§6.3, §7.4). */
export const MASK_PROFILE: Profile = 'heavy';

/** A hostage led by the arm (§10.6 escort): in the hands like a body, `Loadout.carrying`. */
export const HOSTAGE = 'hostage';

/** Things carried in the hands that show (§7.4): a loot bag, a loot crate, a body, a hostage led along. */
export const CARRIED: Readonly<Record<string, Profile>> = {
    lootBag: 'armed',
    lootCrate: 'armed',
    body: 'armed',
    [HOSTAGE]: 'armed'
};

/** How heavy loot is to carry (§15.1): Light is pocketed, Heavy and Very heavy are carried in the hands. */
export type CarryWeight = 'light' | 'heavy' | 'very heavy';

/**
 * How heavy each thing carried in the hands is (§15.1): a bag Heavy, a crate or a body Very heavy; a hostage led along
 * too, "at half movement" (§10.6).
 */
export const CARRY_WEIGHT: Readonly<Record<string, Exclude<CarryWeight, 'light'>>> = {
    lootBag: 'heavy',
    lootCrate: 'very heavy',
    body: 'very heavy',
    [HOSTAGE]: 'very heavy'
};

/** Zip-ties each crew member brings (§7.3, §10.6). */
export const ZIP_TIES = 4;

/** What the hands carry for loot of each weight (`Loadout.carrying`). */
export const LOOT_CARRY: Readonly<Record<Exclude<CarryWeight, 'light'>, string>> = { heavy: 'lootBag', 'very heavy': 'lootCrate' };

/** Light loot a crew member can pocket (§15.1: up to 2 stacks). */
export const POCKETS = 2;

/** Tiles of movement a Heavy carry costs per Move (§15.1: −2), and a Bruiser's Very heavy one (§7.2: −1). */
export const HEAVY_CARRY_PENALTY = 2;
export const BRUISER_CARRY_PENALTY = 1;

/** How far a Heavy bag is thrown (§15.1: 2 tiles), Euclidean like the command ring (decision 53). */
export const THROW_RANGE = 2;
