import type { Material } from '../core/types';

/*
 * The noise table of §8.9 (plus the noisy actions of §6.3 and §11.11) as data. Quiet noise makes the NPCs who hear it
 * Curious; loud noise makes them Alerted and makes the bank Loud. Walking makes no noise (radius 0) and isn't listed.
 *
 * Where the design gives a range ("Knockout, taser, radio buzz: 2–3"), `min` and `max` keep both ends and the system
 * that makes the noise picks within them (a stronger or weaker version); elsewhere they are equal. The command shout's
 * radius is the shouter's command radius plus `plusCommandRadius` (its `min` and `max` are 0).
 */

export type NoiseKind = 'quiet' | 'loud';

export interface NoiseDef {
    kind: NoiseKind;
    /** Radius in tiles of movement cost (diagonals 1.5), §6 decision 3. */
    min: number;
    max: number;
    /** Added to the command radius instead of a fixed radius (the command shout). */
    plusCommandRadius?: number;
}

const fixed = (kind: NoiseKind, radius: number): NoiseDef => ({ kind, min: radius, max: radius });
const range = (kind: NoiseKind, min: number, max: number): NoiseDef => ({ kind, min, max });

export const NOISES = {
    dash: fixed('quiet', 2),
    lockpick: fixed('quiet', 1),
    zipTie: fixed('quiet', 1),
    glassCutter: fixed('quiet', 1),
    panelWork: fixed('quiet', 1),
    knockout: range('quiet', 2, 3),
    taser: range('quiet', 2, 3),
    radioBuzz: range('quiet', 2, 3),
    /** §6.3, §11.11. */
    meleeStrike: fixed('quiet', 2),
    /** §6.3. */
    flipTable: fixed('quiet', 4),
    /** At the landing tile. */
    noisemaker: fixed('quiet', 3),
    suppressedPistol: fixed('quiet', 3),
    suppressedSmg: fixed('quiet', 4),
    commandShout: { kind: 'loud', min: 0, max: 0, plusCommandRadius: 3 },
    scream: fixed('loud', 6),
    pistol: fixed('loud', 8),
    machinePistol: range('loud', 9, 10),
    smg: range('loud', 9, 10),
    shotgun: fixed('loud', 12),
    assaultRifle: fixed('loud', 14),
    dmr: range('loud', 14, 18),
    lmg: range('loud', 14, 18),
    breachCharge: range('loud', 14, 18),
    shapedCharge: fixed('loud', 18),
    vehicleRam: fixed('loud', 16),
    /** Each world phase it runs. */
    drill: fixed('loud', 6),
    /** Each world phase it burns. */
    thermite: fixed('loud', 6)
} as const satisfies Record<string, NoiseDef>;

export type NoiseSource = keyof typeof NOISES;

/**
 * What a wall segment that sound has to get through does to it (§8.9): Soft walls cost 3 tiles of reach; Reinforced
 * and Vault stop it. Glass (windows, glass doors, curtains, §6 decision 8) counts as Soft: a pane is no thicker than a
 * partition. Teller glass is armoured, so it counts as Reinforced. Boundary (the edge of the map) stops it. A closed
 * door costs 3 whatever it is made of, except a vault door (`geo/sound.ts`).
 */
export const SOUND_WALL_TILES = 3;
export const SOUND_DAMPING: Readonly<Record<Material, 'wall' | 'stops'>> = {
    glass: 'wall', tellerGlass: 'stops', soft: 'wall', reinforced: 'stops', vault: 'stops', boundary: 'stops'
};
