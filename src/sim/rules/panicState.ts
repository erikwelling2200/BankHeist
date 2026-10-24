import type { Ctx } from '../core/engine';
import { registerNpcInit } from '../core/state';
import type { DeepReadonly, NpcState, Phase, Pos, ReadonlyWorld } from '../core/types';
import { registerEvents } from '../core/undo';
import { isPresent, personOf } from './npc/walk';
import { alertNpc, isEyesDown } from './suspicion';

/*
 * Who is panicking (§10.8) and who would: the state of rules/panic.ts, kept apart from its reactions and hooks so the
 * modules that set panic off (suspicion.ts on an exposure, evidence.ts on a loud noise) can reach it without loading
 * the actions. See rules/panic.ts for the rules.
 */

/** What a panicked NPC does about it (§10.8). Flight is a lapse's (`NpcState.lapse`), recorded here as `flee`. */
export type PanicReaction = { kind: 'cower' } | { kind: 'flee' } | { kind: 'hide'; spot: Pos } | { kind: 'tackle'; crew: string };

/** A panicking NPC (§10.8). */
export interface Panic {
    /** When it panicked: it spreads panic from the next world phase on. */
    since: { turn: number; phase: Phase };
    /** The crew member it panicked about, when there was one (an exposure, a shout); null for a noise from nowhere. */
    crew: string | null;
    /** What frightened it: it faces it while frozen. */
    tile: Pos;
    /** Picked as the next crew phase begins; null until then (frozen). */
    reaction: PanicReaction | null;
}

declare module '../core/types' {
    interface NpcStatusMap {
        /** Panicked (§10.8): frozen, cowering, hiding or running; never face down. */
        panicked: true;
    }
    interface NpcState {
        /** Panicking (§10.8), or null. */
        panic: Panic | null;
    }
    interface EventMap {
        /** A civilian panicked (§10.8): `cause` is a noise, an exposure or another's panic (`panic <npc>`). */
        panicked: { npc: string; cause: string };
        /** A runner found its way out blocked by the crew (§9.1) and cowers. */
        gaveUp: { npc: string };
    }
}

registerNpcInit('panic', (_world, _person, npc) => {
    npc.panic = null;
});

/** Whether an NPC panics at a fright now: a civilian up and about, not Hostile, not already acting on a lapse. */
export function canPanic(world: ReadonlyWorld, npc: DeepReadonly<NpcState>): boolean {
    return personOf(world, npc.id).observer === 'civilian' && isPresent(npc) && !isEyesDown(npc) && npc.status !== 'hostile' && npc.lapse === null;
}

/** Whether a fright now leaves the NPC Panicked: it panics, or already does. The hearing badge and the panic ring use it. */
export const panicsAt = (world: ReadonlyWorld, npc: DeepReadonly<NpcState>): boolean => npc.panic !== null || canPanic(world, npc);

/** A new panic, frozen until its reaction is picked (or with `reaction` already). */
export function startPanic(ctx: Ctx, crew: string | null, tile: Pos, reaction: PanicReaction | null = null): Panic {
    return { since: { turn: ctx.state.turn, phase: ctx.state.phase }, crew, tile: { x: tile.x, y: tile.y }, reaction };
}

/** Panics a civilian (rules/panic.ts): Alerted, frozen facing the fright. Nothing to anyone else, or to one panicking. */
export function panicNpc(ctx: Ctx, npc: NpcState, cause: string, crew: string | null, tile: Pos): void {
    if (npc.panic || !canPanic(ctx.world, npc)) return;
    npc.panic = startPanic(ctx, crew, tile);
    ctx.emit({ type: 'panicked', npc: npc.id, cause });
    alertNpc(ctx, npc, cause);
}

/** A runner whose way out is blocked (§9.1) gives up and cowers where it is. */
export function giveUp(ctx: Ctx, npc: NpcState): void {
    npc.lapse = null;
    npc.panic = startPanic(ctx, null, npc.pos, { kind: 'cower' });
    ctx.emit({ type: 'gaveUp', npc: npc.id });
}

registerEvents({ panicked: { undoBlocking: true }, gaveUp: { undoBlocking: true } });
