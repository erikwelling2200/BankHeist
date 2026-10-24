import type { ObserverClass, Zone } from '../core/types';
import type { Profile } from './items';

/*
 * The reaction matrix of §8.4 as data: what an observer of each class does on seeing a crew member of each profile in
 * each zone, in Core view. `rules/perceive.ts` reads it (`reaction`); nothing else may hold a copy of these cells.
 *
 *     '-'    nothing            '+1', '+2'  suspicion pips
 *     '!'    instantly Exposed  'T'         trespass: a challenge (§8.6)
 *     '+1f'  +1, but only within frisk range (`rules.friskRange`, Chebyshev, §6 decision 3); nothing further away
 *
 * - **Staff zone and the staff uniform.** "Clean, staff uniform" reads — for everyone (the Staff zone counts as Public
 *   under a uniform, §8.14), except the manager and the security chief, who see through it in Core view and read the
 *   no-uniform row (T). `UNIFORMS` says which zones a uniform turns into which, and who sees through it.
 * - **Secure zone.** Staff and enforcers: always '!', uniform or not. Civilians aren't covered by §8.4; they read the
 *   Staff zone's civilian column (they care only about Armed and Heavy, §8.2). The mockups' cut-down rules.py gives
 *   civilians '-' there.
 * - **Peripheral** view is one step weaker (`PERIPHERAL`): ! → +2, +2 → +1, +1 → nothing, and a trespass needs Core.
 * - **Cameras** read the enforcer column and register only '!' (in their Core, which is all they have).
 * - **Illegal acts** are '!' for every observer, in any zone, in Peripheral view too (`ILLEGAL_ACTS`). Changing into a
 *   uniform is one too (§8.14 "out of every NPC's sight", implementation plan §6 decision 61).
 * - **Guard and courier uniforms** (§8.14): the Staff zone reads as Public; in the Secure zone staff give +1 and
 *   enforcers and cameras nothing; any enforcer within frisk range in Core, and the security chief at any range in
 *   Core, sees through it: `!`.
 */

/** A matrix cell. */
export type Cell = '-' | '+1' | '+2' | '!' | 'T' | '+1f';

/** What a sighting does, once frisk range is settled: no '+1f'. */
export type Outcome = Exclude<Cell, '+1f'>;

/** The columns: civilian, staff, enforcer. */
type Row = readonly [civilian: Cell, staff: Cell, enforcer: Cell];

export const OBSERVER_COLUMN: Readonly<Record<ObserverClass, 0 | 1 | 2>> = { civilian: 0, staff: 1, enforcer: 2 };

export const MATRIX: Readonly<Record<Zone, Readonly<Record<Profile, Row>>>> = {
    public: {
        clean: ['-', '-', '-'],
        concealed: ['-', '-', '+1f'],
        armed: ['+2', '+2', '!'],
        heavy: ['!', '!', '!']
    },
    staff: {
        clean: ['-', 'T', 'T'],
        concealed: ['-', '+2', '!'],
        armed: ['!', '!', '!'],
        heavy: ['!', '!', '!']
    },
    secure: {
        clean: ['-', '!', '!'],
        concealed: ['-', '!', '!'],
        armed: ['!', '!', '!'],
        heavy: ['!', '!', '!']
    }
};

/** Peripheral view: one step weaker (§8.4). */
export const PERIPHERAL: Readonly<Record<Cell, Outcome>> = { '!': '+2', '+2': '+1', '+1': '-', '+1f': '-', T: '-', '-': '-' };

/** How strong an outcome is, for "the strongest sighting": ! > +2 > T > +1 > nothing. */
export const OUTCOME_RANK: Readonly<Record<Outcome, number>> = { '-': 0, '+1': 1, T: 2, '+2': 3, '!': 4 };

/** Pips an outcome adds (§8.5). */
export const OUTCOME_PIPS: Readonly<Record<Outcome, number>> = { '-': 0, '+1': 1, '+2': 2, T: 0, '!': 0 };

/** Uniforms (§8.14). Augment to add one; give it an entry in `UNIFORMS`. */
export interface UniformMap { staff: true; guard: true; courier: true }
export type Uniform = keyof UniformMap;

export interface UniformDef {
    /** Zones that read as another zone under this uniform. */
    zoneAs: Readonly<Partial<Record<Zone, Zone>>>;
    /**
     * Cells that read otherwise under this uniform (which holds only over Concealed or less, rules/profile.ts), by the
     * zone and the observer's column: a guard's uniform in the Secure zone is +1 to staff and nothing to enforcers and
     * cameras.
     */
    cells?: Readonly<Partial<Record<Zone, Readonly<Partial<Record<ObserverClass, Cell>>>>>>;
    /** Roles (`PersonDef.role`) who see through it in Core view, at any range. */
    seenThroughBy: readonly string[];
    /** An observer class that sees through it in Core view within frisk range (a guard: "You're not Dave."). */
    seenThroughNear?: ObserverClass;
    /** Seen through, it Exposes at once (`!`); otherwise the tile reads as its own zone (the staff uniform: trespass). */
    exposes?: true;
    /** A holstered pistol (`ItemDef.holsterable`) counts as Clean under it. */
    holsters?: true;
}

/** A guard's uniform and a courier's (§8.14): the courier's works "as guard". */
const GUARD_LIKE: UniformDef = {
    zoneAs: { staff: 'public' },
    cells: { secure: { staff: '+1', enforcer: '-' } },
    seenThroughBy: ['chief'],
    seenThroughNear: 'enforcer',
    exposes: true,
    holsters: true
};

export const UNIFORMS: Readonly<Record<Uniform, UniformDef>> = {
    // The manager is 'manager' and the security chief 'chief' in the generator's population (src/gen/population.ts).
    staff: { zoneAs: { staff: 'public' }, seenThroughBy: ['manager', 'chief'] },
    guard: GUARD_LIKE,
    courier: GUARD_LIKE
};

/** The illegal acts of §8.4: '!' for anyone who sees them, in Core or Peripheral view. */
export const ILLEGAL_ACTS = [
    'lockpick', 'hack', 'zipTie', 'command', 'attack', 'knockout', 'dragBody', 'breach', 'drill', 'plantCharge', 'maskUp',
    'takeLoot', 'pickPocket', 'changeClothes'
] as const;

export type IllegalAct = (typeof ILLEGAL_ACTS)[number];
