import type { DeepReadonly, NpcState, ReadonlyWorld } from '../core/types';
import { ARMED_NPC_HP, DEFAULT_NPC_HP, NPC_HP } from '../data/weapons';

/*
 * An NPC's hit points and whether it is wounded (§11.12, §12.3): the state of rules/wounds.ts, kept apart from its
 * hooks and actions so that the NPCs' behaviour (npc/behaviour.ts: the wounded crawl for a way out) can read it
 * without loading them. See rules/wounds.ts for the rules.
 */

/** An NPC's full hit points (§12.3), by role: an armed civilian (the off-duty cop) 5, anyone else unlisted 3. */
export function npcMaxHp(world: ReadonlyWorld, id: string): number {
    const person = world.people.find(p => p.id === id);
    if (!person) return DEFAULT_NPC_HP;
    if (Object.hasOwn(NPC_HP, person.role)) return NPC_HP[person.role]!;
    return person.armed ? ARMED_NPC_HP : DEFAULT_NPC_HP;
}

/** Wounded (§11.12): alive, half its hit points or less. */
export function isWounded(world: ReadonlyWorld, npc: DeepReadonly<NpcState>): boolean {
    return npc.status !== 'dead' && npc.hp * 2 <= npcMaxHp(world, npc.id);
}
