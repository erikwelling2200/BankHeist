import type { ReadonlyWorld, State } from '../core/types';
import { commandPlan, holdTargets, type CommandPlan } from '../rules/command';
import { isKnownNow } from '../rules/knowledge';

/*
 * The command's two rings as the player sees them (§10.1, UI.md "Rings": the blue command ring, the amber panic ring
 * beyond it, each NPC's outcome on its head and a resister's chance as a number). It is `commandPlan`, the very reading
 * the command's reducer applies, with only the NPCs the crew sees or predicts (§8.15): the rings themselves are
 * geometry, the people in them are what the crew knows. A resister's chance is the one the commit rolls with.
 */

export function commandPreview(world: ReadonlyWorld, state: State, crewId: string): CommandPlan {
    const plan = commandPlan(world, state, crewId);
    return { ...plan, targets: plan.targets.filter(t => isKnownNow(world, state, t.npc)) };
}

/** The Commanded NPCs the crew knows of that a hold by this crew member would keep down (§10.3): its ring. */
export function holdPreview(world: ReadonlyWorld, state: State, crewId: string): string[] {
    return holdTargets(world, state, crewId).filter(id => isKnownNow(world, state, id));
}
