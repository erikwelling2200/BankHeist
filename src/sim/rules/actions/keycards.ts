import type { DeepReadonly, ReadonlyWorld, State, WorldObject } from '../../core/types';
import { registerInteraction } from './interact';

/*
 * Keycards as things in the bank (§15.2, §17.6; implementation plan M5-04, decision 364). A card is the keys of the
 * person who holds it (rules/keys.ts `cardOpens`): the crew has taken it when its holder's id is in
 * `CrewState.keycards`, from a frisk (rules/actions/hostage.ts) or from where it lies.
 *
 * - A `keycard` object is a card lying somewhere, its holder's (`WorldObject.holder`), there from turn `from` until
 *   `until` (the manager's, in his desk drawer while he is out at lunch: `worldFromBank`, from the generator's
 *   opportunity). **Taking** it (`interact … take`, 1 action, in reach) is the illegal act 'takeLoot': the crew member
 *   has the holder's card, and the holder no longer has it (`NpcState.keycard`), so he comes back to doors he can't
 *   open. It is there only while its holder hasn't lost it some other way (a frisk).
 * - The action grid offers it only when it can be taken (src/game/actions.ts), so a drawer gives nothing away before
 *   lunch.
 */

declare module '../../core/types' {
    interface WorldObject {
        /** A keycard lying somewhere: whose it is. */
        holder?: string;
        /** A keycard lying somewhere: the turn it is put there, and the turn its holder takes it back. */
        from?: number;
        until?: number;
    }
}

/** Why the keycard object can't be taken now, or undefined. */
export function keycardBlocked(state: DeepReadonly<State>, object: DeepReadonly<WorldObject>): string | undefined {
    const taken = Object.hasOwn(state.objects, object.id) ? state.objects[object.id]!.taken : undefined;
    if (taken !== undefined) return 'The keycard is gone';
    const holder = state.npcs.find(n => n.id === object.holder);
    if (!holder?.keycard || (object.from !== undefined && state.turn < object.from) || (object.until !== undefined && state.turn >= object.until)) return 'There is no keycard here';
    return undefined;
}

/** The keycards lying where the crew could take one now. */
export const keycardsHere = (world: ReadonlyWorld, state: State): DeepReadonly<WorldObject>[] =>
    world.objects.filter(o => o.kind === 'keycard' && !keycardBlocked(state, o));

registerInteraction('keycard', {
    take: {
        cost: () => 1,
        illegal: 'takeLoot',
        whyNot: (_world, state, _member, object) => keycardBlocked(state, object),
        run(ctx, member, object) {
            const holder = ctx.state.npcs.find(n => n.id === object.holder)!;
            holder.keycard = false;
            if (!member.keycards.includes(holder.id)) member.keycards = [...member.keycards, holder.id].sort();
            ctx.state.objects[object.id] = { ...ctx.state.objects[object.id], taken: member.id };
            ctx.emit({ type: 'keycardTaken', crew: member.id, npc: holder.id });
        }
    }
});
