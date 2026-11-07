/*
 * The Squeeze, the campaign clock (GAME_DESIGN §19.2): a points track whose thresholds each land a complication on the
 * finale or the city, closer and closer together, and the Raid at the last. Plain numbers and pure functions.
 */

/** Where each complication lands, in order: the gaps shrink from 8 to 3 (§19.2). */
export const THRESHOLDS: readonly number[] = [8, 15, 21, 26, 30, 33, 36];
/** The final threshold: the task force raids the safehouse (§19.2 "The Raid"). */
export const RAID_AT = 38;

/** What adds to the Squeeze, and how much (§19.2's table). */
export const SQUEEZE = {
    /** Each day that passes. */
    day: 2,
    /** Each crew member who gained Notoriety. */
    notoriety: 1,
    /** A failed job (an abandoned one included, decision 443). */
    failedJob: 2,
    /** An arrested crew member talks. */
    talked: 4,
    /** The "Leak a false tip" side job, once per campaign. */
    falseTip: -5
} as const;

export type SqueezeSource = keyof typeof SQUEEZE;

/** Every threshold, the Raid's last. */
export const ALL_THRESHOLDS: readonly number[] = [...THRESHOLDS, RAID_AT];

/**
 * The day a threshold lands on with nothing but the daily gain: the day whose passing takes the Squeeze from `squeeze`
 * (on the unspent day `day`) to `at` or past it. `day` itself when it is reached already.
 */
export function projectedDay(at: number, squeeze: number, day: number): number {
    const days = Math.max(0, Math.ceil((at - squeeze) / SQUEEZE.day));
    return day + Math.max(0, days - 1);
}
