import { registerWorldHook, type Ctx } from '../core/engine';
import { tileAt } from '../core/grid';
import type { DeepReadonly, NpcState, Pos, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { expose, isEyesDown, isExposedTo, refreshWant, setEscort } from './suspicion';

/*
 * Trespass: the challenge (§8.6), as a state machine on the challenger. Its walking is the NPC behaviour's (M1-06),
 * from the `challenge` and `escort` wants.
 *
 * 1. **Challenge**: a `T` sighting (perceive.ts: a Clean crew member without a uniform, seen in Core in the Staff zone
 *    by staff or an enforcer) adds `{ crew, deadline }` to the challenger's `challenges`. A crew member has at most one
 *    challenge pending: another `T` while one is pending does nothing.
 * 2. **Deadline**: the crew member must end the crew phase of turn `deadline` on a Public tile. Challenged in a crew
 *    phase, that is the next turn's crew phase (after one world phase in which the challenger walks over); challenged
 *    in a world phase, there is one more crew phase first, so the challenger still gets its world phase.
 * 3. At the start of that turn's world phase (after the world phase's sightings, so the hatched overlay stays exact):
 *    - on a Public tile: **complied**. The crew member is Warned by the challenger for the rest of the heist, and the
 *      challenger escorts (follows to the boundary, then watches) for that world phase and the next;
 *    - anywhere else (still in Staff, hiding out of sight, deeper in): **Exposed** to the challenger;
 *    - a challenger that is eyes down by then (knocked out, commanded, tied) drops the challenge.
 * 4. **Second offence** (perceive.ts): a Warned crew member's `T`, seen by an NPC that warned them or by any enforcer,
 *    is a `!` instead.
 */

declare module '../core/types' {
    interface EventMap {
        /** "Hey, you can't be back here." The crew member must end the crew phase of `deadline` on Public floor. */
        challenged: { npc: string; crew: string; deadline: number };
        /** A challenge reached its deadline: complied (Warned), failed (Exposed) or dropped (the challenger is down). */
        challengeEnded: { npc: string; crew: string; result: 'complied' | 'failed' | 'dropped' };
        /** The crew member is Warned by this NPC for the rest of the heist (§8.6). */
        warned: { npc: string; crew: string };
    }
}

/** The NPC challenging a crew member now, if any. */
export function challengerOf(state: State, crew: string): NpcState | undefined {
    return state.npcs.find(n => n.challenges.some(c => c.crew === crew));
}

/** Whether this NPC warned the crew member. */
export const hasWarned = (npc: DeepReadonly<NpcState>, crew: string): boolean => npc.warned.includes(crew);

/** Whether any NPC warned the crew member. */
export const isWarned = (state: DeepReadonly<State>, crew: string): boolean => state.npcs.some(n => n.warned.includes(crew));

/** The turn whose crew phase a challenge made now must end on Public floor (see the header). */
export const challengeDeadline = (state: State): number => state.turn + (state.phase === 'crew' ? 1 : 2);

/** The NPC challenges the crew member (§8.6), unless it already knows them or someone is challenging them already. */
export function challenge(ctx: Ctx, npc: NpcState, crew: string, tile: Pos): void {
    const { state } = ctx;
    if (isExposedTo(npc, crew) || challengerOf(state, crew)) return;
    const deadline = challengeDeadline(state);
    npc.challenges.push({ crew, deadline });
    ctx.emit({ type: 'challenged', npc: npc.id, crew, deadline });
    refreshWant(state, npc, crew, tile);
}

registerWorldHook('passiveNpcs', 'trespass.deadlines', (ctx, phase) => {
    const { world, state } = ctx;
    for (const npc of state.npcs) {
        for (const ch of [...npc.challenges]) {
            if (ch.deadline > phase.turn) continue;
            npc.challenges.splice(npc.challenges.indexOf(ch), 1);
            const member = state.crew.find(c => c.id === ch.crew);
            if (!member) continue;
            if (isEyesDown(npc)) {
                ctx.emit({ type: 'challengeEnded', npc: npc.id, crew: ch.crew, result: 'dropped' });
                refreshWant(state, npc, ch.crew);
            } else if (tileAt(world, member.pos)?.zone === 'public') {
                ctx.emit({ type: 'challengeEnded', npc: npc.id, crew: ch.crew, result: 'complied' });
                if (!hasWarned(npc, ch.crew)) {
                    npc.warned.push(ch.crew);
                    ctx.emit({ type: 'warned', npc: npc.id, crew: ch.crew });
                }
                setEscort(state, npc, ch.crew, member.pos, phase.turn + 1);
            } else {
                ctx.emit({ type: 'challengeEnded', npc: npc.id, crew: ch.crew, result: 'failed' });
                expose(ctx, npc, ch.crew, ['trespass'], member.pos);
            }
        }
    }
}, { order: -90 });

registerEvents({
    challenged: { undoBlocking: true },
    challengeEnded: { undoBlocking: true },
    warned: { undoBlocking: true }
});
