import type { DeepReadonly, NpcState, ReadonlyWorld, State, WorldObject } from '../core/types';
import { draggedBy } from './place';
import { isPresent, personOf } from './npc/walk';

/*
 * Who watches the cameras (§8.11, §8.12): pure queries that the operator's rules (cameras.ts), the check-ins
 * (checkins.ts) and what the crew knows (knowledge.ts) share, kept apart so none of them imports another.
 *
 * - **The CCTV desk** is the `cctvDesk` object (the console, with `monitors` screens) in the CCTV room.
 * - **The operator** is the NPC of role `operator`. **Attentive**: on the map, not face down or out, and at the desk
 *   (on a tile in reach of it, Chebyshev 1). **Neutralised**: out cold, dead, tied, commanded, or stashed or dragged
 *   off: gone for good as far as the calls go (away on a smoke break is not neutralised, only absent).
 * - **The monitors** (§8.12, implementation plan decision 18) show `monitors` of the cameras at a time, cycling
 *   round-robin each turn over the cameras in id order: in turn T the feeds from index ((T − 1) × M) mod C on. With
 *   as many monitors as cameras, every feed is up. The same in a turn's crew phase and its world phase.
 */

/** NPC statuses that take an operator or a guard out of the game for good, as far as radios go. */
export const NEUTRALISED = new Set(['unconscious', 'dead', 'tied', 'commanded']);

/** The bank's CCTV desk, if it has one. */
export const cctvDesk = (world: ReadonlyWorld): DeepReadonly<WorldObject> | undefined => world.objects.find(o => o.kind === 'cctvDesk');

/** The NPC ids of the bank's operators (§16.2 CCTV operator), in resolution order. */
export const operatorIds = (world: ReadonlyWorld): string[] => world.people.filter(p => p.role === 'operator').map(p => p.id);

/** Whether an NPC is down for good (see the header): face down, out, dead, or hidden away as a body. */
export function neutralised(state: DeepReadonly<State>, npc: DeepReadonly<NpcState>): boolean {
    return NEUTRALISED.has(npc.status) || npc.stashed !== null || !!draggedBy(state, npc.id);
}

/** Whether an NPC is at the CCTV desk: present, not face down or out, on a tile in reach of the desk. */
export function atDesk(world: ReadonlyWorld, state: DeepReadonly<State>, npc: DeepReadonly<NpcState>): boolean {
    const desk = cctvDesk(world);
    if (!desk || !isPresent(npc) || neutralised(state, npc)) return false;
    return Math.max(Math.abs(npc.pos.x - desk.pos.x), Math.abs(npc.pos.y - desk.pos.y)) <= 1;
}

/** The operator watching the monitors now (§8.12: present and attentive), if any. */
export function attentiveOperator(world: ReadonlyWorld, state: DeepReadonly<State>): DeepReadonly<NpcState> | undefined {
    for (const id of operatorIds(world)) {
        const npc = state.npcs.find(n => n.id === id);
        if (npc && atDesk(world, state, npc) && npc.status !== 'hostile') return npc;
    }
    return undefined;
}

/** Whether every operator of the bank is neutralised (none: false, the bank has no operator to lose). */
export function operatorGone(world: ReadonlyWorld, state: DeepReadonly<State>): boolean {
    const ids = operatorIds(world);
    return ids.length > 0 && ids.every(id => {
        const npc = state.npcs.find(n => n.id === id);
        return !npc || neutralised(state, npc);
    });
}

/** The camera ids on the operator's monitors in a turn (see the header); none without a desk or monitors. */
export function feedsAt(world: ReadonlyWorld, turn: number): string[] {
    const desk = cctvDesk(world), m = desk?.monitors ?? 0;
    const ids = world.cameras.map(c => c.id).sort();
    if (!m || !ids.length) return [];
    if (m >= ids.length) return ids;
    const start = (((turn - 1) * m) % ids.length + ids.length) % ids.length;
    const out: string[] = [];
    for (let k = 0; k < m; k++) out.push(ids[(start + k) % ids.length]!);
    return out.sort();
}

/** The camera ids on the monitors this turn. */
export const liveFeeds = (world: ReadonlyWorld, state: DeepReadonly<State>): string[] => feedsAt(world, state.turn);

/**
 * Whether the crew controls the CCTV room (§8.15): no operator left to watch (every one neutralised, or none at all)
 * and a crew member at the desk. Then the crew sees what every camera sees, except looped and dead ones.
 */
export function cctvControlled(world: ReadonlyWorld, state: DeepReadonly<State>): boolean {
    const desk = cctvDesk(world);
    if (!desk) return false;
    const watched = operatorIds(world).some(id => {
        const npc = state.npcs.find(n => n.id === id);
        return !!npc && !neutralised(state, npc);
    });
    if (watched) return false;
    return state.crew.some(c => Math.max(Math.abs(c.pos.x - desk.pos.x), Math.abs(c.pos.y - desk.pos.y)) <= 1);
}

/** The NPC ids of the guards (enforcers on the bank's staff list), sorted: who the operator calls (§8.11). */
export const guardIds = (world: ReadonlyWorld): string[] => world.people.filter(p => p.observer === 'enforcer').map(p => p.id).sort();

/** Whether an NPC is a guard of the bank. */
export const isGuard = (world: ReadonlyWorld, id: string): boolean => personOf(world, id).observer === 'enforcer';
