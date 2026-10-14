import type { Rng } from './rng';
import type { Tier } from './model';

/**
 * The bank tiers (§17.3): interior size, security and the vault. Difficulty adds new kinds of security, not just bigger
 * numbers (§17.1): the city branch brings the operator, the mantrap and dual control; the regional HQ the security
 * chief, motion sensors and the metal detector.
 */
export interface TierSpec {
    name: string;
    /** The interior, in tiles: wide, and deep from the back wall to the street front. */
    width: [number, number];
    depth: [number, number];
    guards: [number, number];
    chief: boolean;
    cameras: [number, number];
    operator: boolean;
    monitors: number;
    vaultClasses: ('M' | 'I' | 'II' | 'III')[];
    /** Chance the vault has a time lock; dual control means two people each hold half the code. */
    timeLock: number;
    dualControl: boolean;
    tellers: [number, number];
    mantrap: boolean;
    motionSensors: boolean;
    metalDetector: boolean;
    dyePacks: boolean;
    armouredCar: number;
    policeEta: number;
}

export const TIER_SPECS: Record<Tier, TierSpec> = {
    small: {
        name: 'Small branch', width: [30, 34], depth: [20, 22], guards: [1, 1], chief: false, cameras: [2, 4], operator: false, monitors: 0,
        vaultClasses: ['M'], timeLock: 1, dualControl: false, tellers: [2, 3], mantrap: false, motionSensors: false, metalDetector: false,
        dyePacks: false, armouredCar: 0, policeEta: 8
    },
    city: {
        name: 'City branch', width: [38, 42], depth: [26, 28], guards: [2, 2], chief: false, cameras: [6, 8], operator: true, monitors: 4,
        vaultClasses: ['I', 'II'], timeLock: 0.5, dualControl: true, tellers: [3, 4], mantrap: true, motionSensors: false, metalDetector: false,
        dyePacks: true, armouredCar: 0.4, policeEta: 6
    },
    hq: {
        name: 'Regional HQ', width: [46, 48], depth: [30, 32], guards: [3, 4], chief: true, cameras: [10, 12], operator: true, monitors: 6,
        vaultClasses: ['II', 'III'], timeLock: 1, dualControl: true, tellers: [5, 6], mantrap: true, motionSensors: true, metalDetector: true,
        dyePacks: true, armouredCar: 1, policeEta: 4
    }
};

/** Drill time by vault class (§15.3). */
export const DRILL_PHASES = { M: 3, I: 5, II: 8, III: 12 } as const;

export function rollTier(rng: Rng): Tier {
    return rng.weighted<Tier>([['small', 3], ['city', 4], ['hq', 2]]);
}
