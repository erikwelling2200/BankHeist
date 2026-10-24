import { registerCrewInit, registerRuleDefaults } from '../core/state';
import type { CrewState, DeepReadonly, ObserverClass, Rules } from '../core/types';
import {
    CARRIED, DUFFEL_ITEM, itemDef, MASK_PROFILE, PACKED_PROFILE, profileRank, raiseProfile, type Profile
} from '../data/items';
import { UNIFORMS, type IllegalAct, type Uniform } from '../data/matrix';

/*
 * A crew member's profile (§7.4): their most conspicuous visible item, raised by Notoriety (§19.7). The profile icon,
 * the safe-floor overlay and every perception check read it from here, so holstering, stowing or dropping something is
 * a visible stealth decision the moment the loadout changes.
 *
 * - `Loadout.items` are the things carried and visible as the item table says (a pistol under a jacket shows as
 *   Concealed); `Loadout.packed` are out of sight in their case or the duffel and show as Concealed at most (§7.3).
 *   Heavy armour slows a crew member only while worn (in `items`, geo/move.ts).
 * - A worn mask makes them Heavy; carrying a loot bag or a body makes them Armed (§7.4). Dragging an NPC's body is
 *   also an illegal act seen on them (`CrewLook.act`, §8.4): `!` for anyone who sees them (perceive.ts `reaction`).
 * - A uniform (§8.14) is clothing: it changes which zone the tile reads as, not the profile. It holds only while the
 *   profile without it is Concealed or less: armour above a light vest, long guns, loot bags, a visible drill and masks
 *   all break it.
 * - **Notoriety** (§19.7) is a rule input carried between heists, 0 by default: Known (2–3) crew read one profile
 *   higher to enforcers and cameras, Wanted (4–5) to everyone. It stacks with an Alerted observer's own step (§8.7);
 *   both cap at Heavy.
 */

declare module '../core/types' {
    interface Loadout {
        /** Items out of sight in their case or the duffel (§7.3): they show as Concealed at most. */
        packed: string[];
        /** The uniform worn (§8.14), or null. */
        uniform: Uniform | null;
        /** The mask is on (§6.3 Mask up): Heavy. */
        masked: boolean;
        /** What is carried in the hands that shows (`CARRIED`: a loot bag, a body), or null. */
        carrying: string | null;
    }
    interface CrewState {
        /** How recognisable this crew member is, 0–5, carried between heists (§19.7). */
        notoriety: number;
    }
    interface Rules {
        /** Notoriety from which enforcers and cameras read a crew member one profile higher (Known, §19.7). */
        knownNotoriety: number;
        /** Notoriety from which everyone reads a crew member one profile higher (Wanted, §19.7). */
        wantedNotoriety: number;
        /** "Within 2 tiles" for frisk range, Chebyshev (§8.4, §6 decision 3). */
        friskRange: number;
    }
}

declare module '../core/state' {
    interface CrewStart {
        packed?: string[];
        uniform?: Uniform;
        masked?: boolean;
        notoriety?: number;
    }
}

registerRuleDefaults({ knownNotoriety: 2, wantedNotoriety: 4, friskRange: 2 });

/** Throws unless a loadout is one the rules can read: known items, packed items with somewhere to go. */
export function checkLoadout(member: DeepReadonly<CrewState>): void {
    const { loadout } = member;
    for (const id of loadout.items) itemDef(id);
    const inDuffel = { longGun: 0, armour: 0 };
    for (const id of loadout.packed) {
        const def = itemDef(id);
        if (def.cased) continue;
        if (!def.duffel) throw new Error(`${member.name} can't pack '${id}': it has no case and doesn't go in a duffel`);
        if (!loadout.items.includes(DUFFEL_ITEM)) throw new Error(`${member.name} packed '${id}' without a duffel`);
        if (++inDuffel[def.duffel] > 1) throw new Error(`${member.name}'s duffel holds one long gun and one armour piece`);
    }
    if (loadout.carrying !== null && !Object.hasOwn(CARRIED, loadout.carrying)) throw new Error(`Nothing called '${loadout.carrying}' can be carried`);
    if (loadout.uniform !== null && !Object.hasOwn(UNIFORMS, loadout.uniform)) throw new Error(`No uniform '${loadout.uniform}'`);
    if (!Number.isInteger(member.notoriety) || member.notoriety < 0 || member.notoriety > 5) throw new Error(`Notoriety is 0–5, not ${member.notoriety}`);
}

registerCrewInit('profile', (_world, start, member) => {
    member.loadout.packed = [...(start.packed ?? [])];
    member.loadout.uniform = start.uniform ?? null;
    member.loadout.masked = start.masked ?? false;
    // Empty hands: what they carry follows what they take and drag (rules/hands.ts).
    member.loadout.carrying = null;
    member.notoriety = start.notoriety ?? 0;
    checkLoadout(member);
});

/** How a crew member looks: the profile from what shows, what shows most, and the uniform if it holds. */
export interface CrewLook {
    profile: Profile;
    /** What sets the profile: an item id, 'packed:<item>', 'mask', 'carrying:<thing>', or 'nothing'. */
    shows: string;
    /** The uniform worn, if it holds (§8.14); null otherwise. */
    uniform: Uniform | null;
    /**
     * An illegal act seen on them whatever else shows (§8.4): dragging a body (rules/actions/body.ts). `!` for every
     * observer, in any zone, Core and Peripheral, mid-move too. Absent when none.
     */
    act?: IllegalAct;
}

/** A crew member's look from their loadout (§7.4). The first item of the highest profile, in loadout order, is named. */
export function crewLook(member: DeepReadonly<CrewState>): CrewLook {
    const { loadout } = member;
    let profile: Profile = 'clean', shows = 'nothing';
    const consider = (p: Profile, what: string): void => {
        if (profileRank(p) > profileRank(profile)) {
            profile = p;
            shows = what;
        }
    };
    for (const id of loadout.items) consider(itemDef(id).profile, id);
    for (const id of loadout.packed) {
        const own = itemDef(id).profile;
        consider(profileRank(own) > profileRank(PACKED_PROFILE) ? PACKED_PROFILE : own, `packed:${id}`);
    }
    if (loadout.carrying !== null) consider(CARRIED[loadout.carrying] ?? 'armed', `carrying:${loadout.carrying}`);
    if (loadout.masked) consider(MASK_PROFILE, 'mask');
    const uniform = loadout.uniform !== null && profileRank(profile) <= profileRank('concealed') ? loadout.uniform : null;
    // Dragging an NPC's body is an illegal act for as long as it lasts (carrying a downed crew member is only Armed).
    return member.dragging ? { profile, shows, uniform, act: 'dragBody' } : { profile, shows, uniform };
}

/** A crew member's profile as the HUD shows it (§7.4): before any observer's reading. */
export const crewProfile = (member: DeepReadonly<CrewState>): Profile => crewLook(member).profile;

/** How many profiles higher Notoriety makes a crew member read to an observer (§19.7). Cameras count as enforcers. */
export function notorietySteps(rules: DeepReadonly<Rules>, notoriety: number, observer: ObserverClass): number {
    if (notoriety >= rules.wantedNotoriety) return 1;
    if (notoriety >= rules.knownNotoriety && observer === 'enforcer') return 1;
    return 0;
}

/** The profile an observer reads: Notoriety's step, then on edge's (§8.7), capped at Heavy. */
export function readProfile(rules: DeepReadonly<Rules>, look: CrewLook, notoriety: number, observer: ObserverClass, alerted: boolean): Profile {
    return raiseProfile(look.profile, notorietySteps(rules, notoriety, observer) + (alerted ? 1 : 0));
}

/** Whether a frisk finds something (§8.5, §10.6): any item that isn't Clean, shown or packed. An empty duffel is just a bag. */
export function friskFinds(member: DeepReadonly<CrewState>): boolean {
    const { items, packed } = member.loadout;
    return packed.length > 0 || items.some(id => id !== DUFFEL_ITEM && itemDef(id).profile !== 'clean');
}
