import { InvariantError, type Ctx } from '../core/engine';
import type { DeepReadonly, DoorDef, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { doorStatus } from '../geo/move';
import type { CodePart, KeyLock } from '../../gen/model';

/*
 * The key graph as the rules read it (§15.2, the generator's `src/gen/keys.ts`): which cards open which doors, what the
 * vault's code is made of, and when its time lock stands open. A leaf module: the doors, the vault and the hostages all
 * ask it, and it asks nothing of them.
 *
 * - **Cards** (implementation plan decision 75). A door the key graph names opens to the cards of the people who hold
 *   its social key (the CCTV room's: the operator's, a guard's, the manager's; the counting room's; the mantrap's
 *   operator, whose buzzing is M6's); any other keycard or maglock door to any staff or enforcer card, as before. A
 *   card stands for its holder's keys: it opens mechanical locks too. The vault opens to none. NPCs walk their day
 *   through the doors their role passes (rules/npc/walk.ts), as the generator planned it.
 * - **The code** (decision 76) is entered part by part at the vault console (`ObjectState.codes`): one whole code, or
 *   under dual control the manager's half and the head teller's. Who knows a part: the manager the whole code or his
 *   half, the head teller hers; the crew what the manager's PC told them (`State.codesKnown`). A world without a key
 *   graph (the test fixtures) is dual control.
 * - **The time lock** (decision 77): its window is the timeline's (the armoured car's, or its own); codes and Three
 *   Keys' card work only in it; outside it a shut vault door locks again (rules/vault.ts).
 * - **Unlocking** the vault (`unlockVault`): its door goes from locked to closed, to be walked through or opened.
 */

declare module '../core/types' {
    interface World {
        /** The hard locks and their keys (§15.2), from the generator's key graph. Absent: a world without one (fixtures). */
        locks?: KeyLock[];
    }
    interface ObjectState {
        /** At a vault console: the parts of the code entered so far (§15.2, §10.7). */
        codes?: CodePart[];
    }
    interface EventMap {
        /** The vault door unlocked: by its code, or Three Keys' card (`by` the crew member, if any). */
        vaultUnlocked: { door: string; how: 'code' | 'keycard'; by: string | null };
        /** Outside the time lock's window: a shut vault door locks again. */
        timeLockShut: { door: string };
    }
}

/** The lock on a door or room, if the key graph names it. */
export const lockOn = (world: ReadonlyWorld, target: string): DeepReadonly<KeyLock> | undefined => world.locks?.find(l => l.target === target);

/** The vault's lock, if the world has one. */
export const vaultLock = (world: ReadonlyWorld): DeepReadonly<KeyLock> | undefined => world.locks?.find(l => l.id === 'vault');

/** Whose cards open a door the key graph names (see the header), or undefined for any staff or enforcer card. */
function cardHolders(world: ReadonlyWorld, door: DeepReadonly<DoorDef>): readonly string[] | undefined {
    const social = lockOn(world, door.id)?.social;
    if (!social) return undefined;
    if (social.kind === 'keycard' || social.kind === 'buzz') return social.holders;
    return social.kind === 'threeKeys' ? social.keycard : undefined;
}

/** Whether the card (and keys) of the person `holder` opens a locked door (see the header). */
export function cardOpens(world: ReadonlyWorld, holder: string, door: DeepReadonly<DoorDef>): boolean {
    if (door.lock === 'mechanical') return true;
    if (door.lock !== 'keycard' && door.lock !== 'maglock') return false;
    const holders = cardHolders(world, door);
    return !holders || holders.includes(holder);
}

/** The parts the vault's code is entered in (see the header). */
export function codeParts(world: ReadonlyWorld): readonly CodePart[] {
    const vault = vaultLock(world);
    if (!vault) return ['manager', 'headTeller'];
    return vault.social.kind === 'code' ? vault.social.parts : [];
}

/** The part of the vault's code someone of `role` knows, if any. */
export function partOf(world: ReadonlyWorld, role: string): CodePart | undefined {
    const parts = codeParts(world);
    if (parts.includes('whole')) return role === 'manager' ? 'whole' : undefined;
    return parts.find(p => p === role);
}

/** Whether the vault's time lock stands open on `turn` (always, without one). */
export function timeLockOpen(world: ReadonlyWorld, turn: number): boolean {
    const w = vaultLock(world)?.timeLock;
    return !w || (turn >= w.from && turn < w.until);
}

/** Why the vault's code (or its card) can't be used now, or undefined: the time lock, or it is open already. */
export function vaultShut(world: ReadonlyWorld, state: State): string | undefined {
    const vault = vaultLock(world);
    if (vault && doorStatus(world, state, vault.target) !== 'locked') return 'The vault isn\'t locked';
    if (vault?.timeLock && !timeLockOpen(world, state.turn)) {
        return state.turn < vault.timeLock.from ? `The time lock holds the vault shut until turn ${vault.timeLock.from}` : 'The time lock holds the vault shut for the day';
    }
    return undefined;
}

/** The parts of the code entered at a console. */
export const entered = (state: DeepReadonly<State>, console: string): readonly CodePart[] =>
    (Object.hasOwn(state.objects, console) ? state.objects[console]!.codes ?? [] : []);

/** Unlocks the vault door (see the header): callers check that it is locked first. */
export function unlockVault(ctx: Ctx, how: 'code' | 'keycard', by: string | null): void {
    const vault = vaultLock(ctx.world);
    if (!vault || doorStatus(ctx.world, ctx.state, vault.target) !== 'locked') throw new InvariantError('Only a locked vault door unlocks');
    ctx.state.doors[vault.target] = { ...ctx.state.doors[vault.target], status: 'closed' };
    ctx.emit({ type: 'vaultUnlocked', door: vault.target, how, by });
}

/** Enters a part of the code at a console; the last part unlocks the vault. */
export function enterPart(ctx: Ctx, console: string, part: CodePart, by: string | null): void {
    const codes = [...entered(ctx.state, console), part].sort();
    ctx.state.objects[console] = { ...ctx.state.objects[console], codes };
    // A world without a key graph (a fixture) has a console but no vault door to unlock.
    const parts = codeParts(ctx.world);
    if (vaultLock(ctx.world) && parts.every(p => codes.includes(p))) unlockVault(ctx, 'code', by);
}

registerEvents({ vaultUnlocked: { undoBlocking: false }, timeLockShut: { undoBlocking: true } });
