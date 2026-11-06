import type { Ctx } from '../core/engine';
import type { DeepReadonly, Pos, State } from '../core/types';

/*
 * What happens as an NPC or an officer steps onto a tile in the world phase (M4-01: a tripwire goes off). The walks
 * (rules/npc/act.ts for the passive group, rules/routine.ts for fighters) call `steppedOn` after each step, and ask
 * `stopsWalk` first: a passive walk stops on such a tile. Packages register what they do here, so the walks don't
 * import them (charges.ts reaches most of the rules).
 */

export type StepHook = (ctx: Ctx, by: string, at: DeepReadonly<Pos>) => void;
export type StepStop = (state: DeepReadonly<State>, at: DeepReadonly<Pos>) => boolean;

const HOOKS = new Map<string, StepHook>(), STOPS = new Map<string, StepStop>();

/** Adds what a step onto a tile sets off, and whether a walk stops there. Run by name. */
export function registerStepHook(name: string, hook: StepHook, stops: StepStop): void {
    if (HOOKS.has(name)) throw new Error(`Step hook '${name}' already exists`);
    HOOKS.set(name, hook);
    STOPS.set(name, stops);
}

/** Whether a walk stops on `at` (something there goes off as it is stepped on). */
export const stopsWalk = (state: DeepReadonly<State>, at: DeepReadonly<Pos>): boolean => [...STOPS.values()].some(s => s(state, at));

/** `by` stepped onto `at`. */
export function steppedOn(ctx: Ctx, by: string, at: DeepReadonly<Pos>): void {
    for (const name of [...HOOKS.keys()].sort()) HOOKS.get(name)!(ctx, by, at);
}
