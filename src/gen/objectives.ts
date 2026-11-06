import type { GenRoom } from './model';
import type { Furnished, Loot } from './parcels';

/*
 * Side objectives in a bank contract (§19.3, §19.5; implementation plan M5-04, decision 365): the hook the campaign's
 * contracts (M6-02) place them through. A contract that "also holds" one passes its kind to `generateBank`
 * (`GenerateOptions.objectives`); it is placed like any other loot, after the rooms are furnished, so the rest of the
 * bank comes out the same with or without it:
 *
 * - in a deposit box (the blueprints, the security chief's dirt): one more box on the deposit room's wall, opened as the
 *   others are (picked, or with the rest when the wall is drilled), in the manager's office where the bank has no
 *   deposit room;
 * - in the manager's office (the blackmail material in the files, half the code in the safe): at the manager's desk,
 *   moved or locked away once the Alarm fires (`lostOnAlarm`).
 *
 * Each is Light, worth nothing at the fence and pocketed like a stack of cash; the rules count it once its carrier gets
 * out (`Loot.objective` names it).
 */

export type SideObjectiveKind = 'blueprints' | 'blackmail' | 'halfCode' | 'chiefDirt';

export const SIDE_OBJECTIVES: Readonly<Record<SideObjectiveKind, { name: string; where: 'depositBox' | 'managerOffice'; lostOnAlarm: boolean }>> = {
    blueprints: { name: "The depot's blueprints", where: 'depositBox', lostOnAlarm: false },
    blackmail: { name: 'Blackmail material', where: 'managerOffice', lostOnAlarm: true },
    halfCode: { name: "Half the depot's code", where: 'managerOffice', lostOnAlarm: true },
    chiefDirt: { name: "The security chief's dirt", where: 'depositBox', lostOnAlarm: false }
};

/** The manager's PC: the loot the office's parcel leaves on the desk. */
const MANAGER_DESK = "Manager's PC (vault code, time-lock schedule)";

/** Places the contract's side objectives in a furnished bank (see the header); throws when one has nowhere to go. */
export function placeObjectives(furnished: Furnished, rooms: readonly GenRoom[], kinds: readonly SideObjectiveKind[]): void {
    const boxes = furnished.loot.find(l => l.behind === 'depositBoxes' && rooms.find(r => r.id === l.room)?.type === 'depositBoxes');
    const desk = furnished.loot.find(l => l.name === MANAGER_DESK);
    for (const kind of kinds) {
        const spec = SIDE_OBJECTIVES[kind], at = spec.where === 'depositBox' && boxes ? boxes : desk;
        if (!at) throw new Error(`No place for the side objective '${kind}': the bank has no manager's desk`);
        const loot: Loot = { tx: at.tx, ty: at.ty, name: spec.name, value: 0, weight: 'light', room: at.room, objective: kind };
        if (at === boxes) loot.behind = 'depositBoxes';
        if (spec.lostOnAlarm) loot.lostOnAlarm = true;
        furnished.loot.push(loot);
    }
}
