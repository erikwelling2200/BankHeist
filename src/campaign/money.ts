import type { ItemId } from '../sim';

/*
 * Money and gear (GAME_DESIGN §19.4, implementation plan M6-03): the numbers. Loot comes out of a heist as dirty money,
 * less the crew's shares; the safehouse and each front launder some of it every day, and the fence launders any of it
 * at once for a cut. Clean money buys the planning assets, fronts and the black market's gear. Whole dollars throughout.
 */

/** What the safehouse launders each day, and what each front adds (§19.4). */
export const LAUNDER_PER_DAY = 60000;
/** A front (a laundromat, a car wash): its price (§19.4). */
export const FRONT_COST = 150000;
/** The fence's cut, in percent (§19.4), and what the "Nervous fence" complication adds to it (§19.2). */
export const FENCE_CUT = 50;
export const NERVOUS_FENCE_CUT = 15;
/** The clean money a campaign starts with: the sandbox's planning cash (decision 323), so day 1 plans as the sandbox does. */
export const STARTING_CASH = 24000;

/**
 * Each crew member's share of a job, in percent (§19.4: 8–20% each, set at recruitment). The sandbox roster's four
 * until the roster is the campaign's (M6-04): 40% for all four, so a bigger crew means smaller takes.
 */
export const STARTING_SHARES: Readonly<Record<string, number>> = { mara: 10, jun: 8, dex: 10, sol: 12 };

/** The gear a campaign starts with: what the sandbox roster brings by default (src/game/plan.ts `ROSTER`). */
export const STARTER_KIT: Readonly<Partial<Record<ItemId, number>>> = {
    pistol: 2, shotgun: 1, dmr: 1, lightVest: 1, mediumArmour: 1, hackingKit: 1, jammer: 1, breachCharge: 1, flashbang: 1, medkit: 1
};

/** A contract's stakes (§19.3): its contract's (M6-02, src/campaign/contracts.ts `STAKES_TIER`). */
export type Stakes = 'low' | 'medium' | 'high';
export const STAKES: readonly Stakes[] = ['low', 'medium', 'high'];

/**
 * The black market (§19.4's starting prices): what it sells, and which need a contact (its higher tiers: heavy armour,
 * the DMR and the LMG). Only what §19.4 prices is on sale.
 */
export const MARKET: Readonly<Partial<Record<ItemId, { price: number; contact?: true }>>> = {
    pistol: { price: 2000 }, machinePistol: { price: 5000 }, smg: { price: 8000 }, shotgun: { price: 10000 }, assaultRifle: { price: 15000 },
    dmr: { price: 25000, contact: true }, lmg: { price: 40000, contact: true },
    lightVest: { price: 5000 }, mediumArmour: { price: 15000 }, heavyArmour: { price: 40000, contact: true },
    hackingKit: { price: 10000 }, lockpick: { price: 2000 }, drill: { price: 20000 }, breachCharge: { price: 3000 }, shapedCharge: { price: 6000 },
    thermite: { price: 8000 }, flashbang: { price: 1000 }, ammoBag: { price: 2000 }, medkit: { price: 1000 }
};

/** What the crew's shares come to of a take: each one's, floored to the dollar, for those who went. */
export function sharesOf(take: number, crew: readonly string[], shares: Readonly<Record<string, number>>): number {
    return crew.reduce((n, id) => n + Math.floor((take * (shares[id] ?? 0)) / 100), 0);
}

/** What the fence pays in clean money for `amount` dirty at a cut of `cut` percent. */
export const fenced = (amount: number, cut: number): number => Math.floor((amount * (100 - cut)) / 100);

/** A multiset of items, as counts. */
export function countItems(items: readonly string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of items) out[id] = (out[id] ?? 0) + 1;
    return out;
}
