import { sortedIds } from '../core/json';
import { registerStateCheck } from '../core/save';
import type { CrewState, DeepReadonly, ReadonlyWorld, State, WorldObject } from '../core/types';
import { HOSTAGE, LOOT_CARRY, type CarryWeight } from '../data/items';

/*
 * What a crew member's hands hold (§15.1, §8.10) has one source of truth: the body they drag (`CrewState.dragging`,
 * actions/body.ts) or the loot that isn't Light whose holder they are (`State.loot`, actions/loot.ts). The look of it,
 * `Loadout.carrying` ('body', 'hostage', 'lootBag', 'lootCrate': what the profile reads, §7.4), is derived from those by
 * `syncHands`, the only thing that writes it, after every change to them; a save whose `carrying` disagrees is refused.
 * So nothing can be shown carried that can't be put down. Kept apart from the actions so both can import it.
 */

/** The World object of a piece of loot. */
export function lootObject(world: ReadonlyWorld, id: string): DeepReadonly<WorldObject> & { loot: NonNullable<WorldObject['loot']> } {
    const o = world.objects.find(x => x.id === id);
    if (!o?.loot) throw new Error(`No loot '${id}'`);
    return o as DeepReadonly<WorldObject> & { loot: NonNullable<WorldObject['loot']> };
}

export const lootWeight = (world: ReadonlyWorld, id: string): CarryWeight => lootObject(world, id).loot.weight;

/** The loot in a crew member's hands (Heavy or Very heavy), if any. */
export function inHands(world: ReadonlyWorld, state: DeepReadonly<State>, crewId: string): string | undefined {
    for (const id of sortedIds(state.loot)) if (state.loot[id]!.holder === crewId && lootWeight(world, id) !== 'light') return id;
    return undefined;
}

/** What a crew member's hands show carrying, from the body they drag or the loot in them: `Loadout.carrying`'s value. */
export function handsCarry(world: ReadonlyWorld, state: DeepReadonly<State>, member: DeepReadonly<CrewState>): string | null {
    if (member.dragging !== null) return member.leading ? HOSTAGE : 'body';
    const id = inHands(world, state, member.id);
    return id === undefined ? null : LOOT_CARRY[lootWeight(world, id) as Exclude<CarryWeight, 'light'>];
}

/** Sets `Loadout.carrying` from what the hands hold: call it after changing `dragging` or a loot's holder. */
export function syncHands(world: ReadonlyWorld, state: State, member: CrewState): void {
    member.loadout.carrying = handsCarry(world, state, member);
}

registerStateCheck('hands', (raw, world) => {
    const state = raw as unknown as State;
    if (!Array.isArray(state.crew) || !state.loot) return 'there is no crew or loot to check the hands against';
    for (const c of state.crew) {
        const shown = c.loadout.carrying;
        // With the world, exactly; an autosave's state alone (its world saved apart) can't weigh loot, only tell a
        // body from loot and loot from nothing.
        const holds = sortedIds(state.loot).some(id => state.loot[id]!.holder === c.id);
        const held = world ? handsCarry(world, state, c) : c.dragging !== null ? (c.leading ? HOSTAGE : 'body') : holds && shown !== 'body' && shown !== HOSTAGE ? shown : null;
        if (shown !== held) return `${c.id} shows carrying '${shown}' but holds ${held ?? 'nothing'}`;
    }
    return undefined;
});
