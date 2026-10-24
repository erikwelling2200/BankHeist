import type { ReadonlyWorld, State } from '../core/types';
import { commandPlan, holdTargets, type CommandPlan, type CommandTarget } from '../rules/command';
import { doorDoubt, doubtStates, isKnownNow } from '../rules/knowledge';
import { previewPicture } from './picture';

/*
 * The command's two rings as the player sees them (§10.1, UI.md "Rings": the blue command ring, the amber panic ring
 * beyond it, each NPC's outcome on its head and a resister's chance as a number). It is `commandPlan`, the very reading
 * the command's reducer applies, judged on the preview's picture (`previewPicture`, decision 44): only the NPCs the crew
 * sees or predicts, and every door it can't vouch for shut, so neither the rings nor anyone's outcome tells how such a
 * door stands. Sight and sound only grow as doors open: what the picture shows is certain. A known NPC whose outcome
 * those doors could change (judged with them all open as well) is `unsure`, and its outcome isn't shown as certain.
 * A resister's chance is the one the commit rolls with.
 */

export interface CommandRings extends CommandPlan {
    /** Known NPCs whose outcome a door the crew can't vouch for could change (or put them in a ring at all). */
    unsure: string[];
}

const sameTarget = (a: CommandTarget | undefined, b: CommandTarget | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);

export function commandPreview(world: ReadonlyWorld, state: State, crewId: string): CommandRings {
    const picture = previewPicture(world, state), plan = commandPlan(world, picture, crewId);
    const targets = plan.targets.filter(t => isKnownNow(world, state, t.npc));
    const doubt = doorDoubt(world, state);
    if (!doubt) return { ...plan, targets, unsure: [] };
    const open = commandPlan(world, doubtStates(world, picture, doubt).open, crewId).targets.filter(t => isKnownNow(world, state, t.npc));
    const ids = [...new Set([...targets, ...open].map(t => t.npc))];
    const unsure = ids.filter(id => !sameTarget(targets.find(t => t.npc === id), open.find(t => t.npc === id)));
    return { ...plan, targets: targets.filter(t => !unsure.includes(t.npc)), unsure };
}

/**
 * The Commanded NPCs the crew knows of that a hold by this crew member would keep down for certain (§10.3): its ring on
 * the picture, the doors it can't vouch for shut (a hold through one of them is no promise either way).
 */
export function holdPreview(world: ReadonlyWorld, state: State, crewId: string): string[] {
    return holdTargets(world, previewPicture(world, state), crewId).filter(id => isKnownNow(world, state, id));
}
