/*
 * Movement numbers (§6.3) that aren't per-bank `Rules`. Costs are kept in half-steps so a diagonal (1.5 tiles) stays
 * an integer: an orthogonal step is 2, a diagonal 3, and a reach of N tiles is a budget of 2N.
 */

export const HALF_STEPS_PER_TILE = 2;
export const ORTHOGONAL_COST = 2;
export const DIAGONAL_COST = 3;

/** Actions each movement costs (§6.3). */
export const MOVE_ACTIONS = 1;
export const DASH_ACTIONS = 2;

/**
 * The loadout item that is heavy armour: Move reaches `rules.heavyMoveTiles` and Dash isn't allowed (§6.3), while it
 * is worn (in `Loadout.items`, not packed). Its entry in the item table is `ITEMS.heavyArmour` (data/items.ts).
 */
export const HEAVY_ARMOUR_ITEM = 'heavyArmour';
