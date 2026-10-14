import { registerWorldHook, type Ctx } from '../core/engine';
import { sortedIds } from '../core/json';
import { registerNpcInit, registerStateInit } from '../core/state';
import type { DeepReadonly, NpcState, NpcStatus, Phase, Pos, State } from '../core/types';
import { registerEvents } from '../core/undo';

/*
 * What NPCs know about the crew (§8.5, §8.7): suspicion pips, exposure, the Alerted flag, the last place they saw each
 * crew member, and what they want to do about it. Perception (`perceive.ts`) and trespass (`trespass.ts`) change it
 * only through the functions here.
 *
 * - **Pips** are 0–3 per crew member (`NpcState.suspicion`; a missing entry is 0). Reaching 3 Exposes.
 * - **Exposed** (`NpcState.exposedTo`) is permanent (§8.7): the pips stay at 3 and never decay.
 * - **Alerted** (`NpcState.alerted`, with `alertCause`) is a flag of its own, not a status: a commanded guard stays
 *   Alerted. An Alerted NPC is on edge: it sees further (geo/cones.ts) and reads everyone one profile higher (§8.7).
 *   Whoever makes an NPC Hostile sets it too.
 * - **Eyes down** (§8.7): commanded and tied NPCs are face down, out cold or dead ones see nothing; none of them build
 *   suspicion or Expose anyone while they stay that way (`EYES_DOWN`).
 * - **Decay**: −1 pip at the end of each world phase in which the NPC didn't see that crew member, in that turn's crew
 *   phase or its world phase (`lastSeen`). A sighting that reads "nothing" in the world phase still counts as seeing.
 * - **Wants** are the hand-off to the NPC behaviour (M1-06): one per crew member the NPC cares about, the strongest
 *   of react (Exposed: react by role, §16.2) > challenge (§8.6) > escort (after a challenge was complied with) >
 *   investigate (2 pips) > face (1 pip). This module never moves anyone; the behaviour turns wants into committed
 *   intents. `decided` says when a want was formed: one formed in a crew phase is acted on in that turn's world phase,
 *   one formed in a world phase only in the next (§6.2).
 */

/** What an NPC wants to do about a crew member (§8.5–8.7). */
export type WantKind = 'react' | 'challenge' | 'escort' | 'investigate' | 'face';

export interface Want {
    kind: WantKind;
    crew: string;
    /** Where the crew member was last seen: the tile to face, walk to or react toward. */
    tile: Pos;
    decided: { turn: number; phase: Phase };
    /**
     * An escort ends after the world phase of this turn (§8.6): set at the deadline's world phase (following the crew
     * member to the boundary) with `until` one turn later, so it also watches through the next world phase.
     */
    until?: number;
}

/** A trespass challenge an NPC has made (§8.6): the crew member must end the crew phase of `deadline` on Public floor. */
export interface Challenge { crew: string; deadline: number }

/** Where and when an NPC last saw a crew member. */
export interface LastSeen { tile: Pos; turn: number }

/** A camera's `!` (§8.4) waiting for the operator (M1-08: verify, then the operator carrier). */
export interface CameraReport { camera: string; crew: string; tile: Pos; turn: number; phase: Phase }

declare module '../core/types' {
    interface NpcState {
        /** What made it Alerted ('exposed jun', 'violence', 'noise'), or null while it isn't. */
        alertCause: string | null;
        /** Crew members it challenged who complied (§8.6): a second offence Exposes them. */
        warned: string[];
        /** Its pending trespass challenges, by crew member. */
        challenges: Challenge[];
        /** What it wants to do next, one per crew member, by crew id. */
        wants: Want[];
        /** Where and when it last saw each crew member (with an effect in a crew phase, at all in a world phase). */
        lastSeen: Record<string, LastSeen>;
    }
    interface State {
        /** Camera sightings of a `!` not yet handled by the operator (M1-08 consumes them). */
        cameraReports: CameraReport[];
    }
    interface EventMap {
        /** An NPC gained pips on a crew member: `added`, now `total`, and why (`perceive.ts` Why). */
        suspicionRaised: { npc: string; crew: string; added: number; total: number; why: string[] };
        /** An NPC lost a pip on a crew member it didn't see this turn. */
        suspicionDecayed: { npc: string; crew: string; total: number };
        /** An NPC now knows a crew member is a criminal (§8.7). */
        exposed: { npc: string; crew: string; why: string[] };
        /** An NPC became Alerted (§8.7). */
        alerted: { npc: string; cause: string };
    }
}

/** NPC states that don't build suspicion or Expose anyone (§8.7 eyes down; out cold and dead see nothing at all). */
export const EYES_DOWN: ReadonlySet<NpcStatus> = new Set<NpcStatus>(['commanded', 'tied', 'unconscious', 'dead']);

export const isEyesDown = (npc: DeepReadonly<NpcState>): boolean => EYES_DOWN.has(npc.status);

export const MAX_PIPS = 3;

registerNpcInit('suspicion', (_world, _person, npc) => {
    npc.alerted = false;
    npc.alertCause = null;
    npc.warned = [];
    npc.challenges = [];
    npc.wants = [];
    npc.lastSeen = {};
});

registerStateInit('suspicion', (_world, state) => {
    state.cameraReports = [];
});

export const pipsOf = (npc: DeepReadonly<NpcState>, crew: string): number =>
    (Object.hasOwn(npc.suspicion, crew) ? npc.suspicion[crew]! : 0);

export const isExposedTo = (npc: DeepReadonly<NpcState>, crew: string): boolean => npc.exposedTo.includes(crew);

/** Records that an NPC saw a crew member on `tile` now. */
export function markSeen(state: State, npc: NpcState, crew: string, tile: Pos): void {
    npc.lastSeen[crew] = { tile: { x: tile.x, y: tile.y }, turn: state.turn };
}

/** Makes an NPC Alerted, for the rest of the heist (§8.7). Does nothing if it already is. */
export function alertNpc(ctx: Ctx, npc: NpcState, cause: string): void {
    if (npc.alerted) return;
    npc.alerted = true;
    npc.alertCause = cause;
    ctx.emit({ type: 'alerted', npc: npc.id, cause });
}

/** Recomputes what an NPC wants about one crew member from what it knows (see the header). */
export function refreshWant(state: State, npc: NpcState, crew: string, tile?: Pos): void {
    const i = npc.wants.findIndex(w => w.crew === crew), current = i >= 0 ? npc.wants[i] : undefined;
    const seen = Object.hasOwn(npc.lastSeen, crew) ? npc.lastSeen[crew]!.tile : undefined;
    const where = tile ?? seen ?? current?.tile ?? npc.pos;
    const pips = pipsOf(npc, crew);
    const kind: WantKind | null = isExposedTo(npc, crew) ? 'react'
        : npc.challenges.some(c => c.crew === crew) ? 'challenge'
            : current?.kind === 'escort' ? 'escort'
                : pips >= 2 ? 'investigate' : pips === 1 ? 'face' : null;
    if (!kind) {
        if (current) npc.wants.splice(i, 1);
        return;
    }
    if (current && current.kind === kind && (kind === 'escort' || (current.tile.x === where.x && current.tile.y === where.y))) return;
    const want: Want = { kind, crew, tile: { x: where.x, y: where.y }, decided: { turn: state.turn, phase: state.phase } };
    if (current) npc.wants[i] = want;
    else {
        npc.wants.push(want);
        npc.wants.sort((a, b) => (a.crew < b.crew ? -1 : a.crew > b.crew ? 1 : 0));
    }
}

/** Sets an escort want (§8.6 after compliance) that lasts until the world phase of turn `until`; reacting outranks it. */
export function setEscort(state: State, npc: NpcState, crew: string, tile: Pos, until: number): void {
    const want: Want = { kind: 'escort', crew, tile: { x: tile.x, y: tile.y }, decided: { turn: state.turn, phase: state.phase }, until };
    const i = npc.wants.findIndex(w => w.crew === crew);
    if (i >= 0 && npc.wants[i]!.kind === 'react') return;
    if (i >= 0) npc.wants[i] = want;
    else {
        npc.wants.push(want);
        npc.wants.sort((a, b) => (a.crew < b.crew ? -1 : a.crew > b.crew ? 1 : 0));
    }
}

/** The NPC now knows the crew member is a criminal (§8.7): pips to 3, Alerted, wants to react. Idempotent. */
export function expose(ctx: Ctx, npc: NpcState, crew: string, why: readonly string[], tile?: Pos): void {
    if (isExposedTo(npc, crew)) return;
    npc.exposedTo.push(crew);
    npc.suspicion[crew] = MAX_PIPS;
    npc.challenges = npc.challenges.filter(c => c.crew !== crew);
    ctx.emit({ type: 'exposed', npc: npc.id, crew, why: [...why] });
    alertNpc(ctx, npc, `exposed ${crew}`);
    refreshWant(ctx.state, npc, crew, tile);
}

/** Adds pips (§8.5); reaching 3 Exposes. Nothing once Exposed. */
export function addSuspicion(ctx: Ctx, npc: NpcState, crew: string, pips: number, why: readonly string[], tile?: Pos): void {
    if (pips <= 0 || isExposedTo(npc, crew)) return;
    const total = Math.min(MAX_PIPS, pipsOf(npc, crew) + pips);
    npc.suspicion[crew] = total;
    ctx.emit({ type: 'suspicionRaised', npc: npc.id, crew, added: pips, total, why: [...why] });
    if (total >= MAX_PIPS) expose(ctx, npc, crew, [...why, 'pips'], tile);
    else refreshWant(ctx.state, npc, crew, tile);
}

// Decay (§8.5), and escorts that have run their course. Runs with the devices, after everyone has acted and looked.
registerWorldHook('devices', 'perception.decay', (ctx, phase) => {
    const { state } = ctx;
    for (const npc of state.npcs) {
        for (const crew of sortedIds(npc.suspicion)) {
            if (isExposedTo(npc, crew)) continue;
            const seen = Object.hasOwn(npc.lastSeen, crew) && npc.lastSeen[crew]!.turn === phase.turn;
            if (seen) continue;
            const total = pipsOf(npc, crew) - 1;
            if (total > 0) npc.suspicion[crew] = total;
            else delete npc.suspicion[crew];
            ctx.emit({ type: 'suspicionDecayed', npc: npc.id, crew, total: Math.max(0, total) });
            refreshWant(state, npc, crew);
        }
        for (const want of [...npc.wants]) {
            if (want.until === undefined || want.until > phase.turn) continue;
            npc.wants.splice(npc.wants.indexOf(want), 1);
            refreshWant(state, npc, want.crew);
        }
    }
}, { order: 40 });

registerEvents({
    suspicionRaised: { undoBlocking: true },
    exposed: { undoBlocking: true },
    alerted: { undoBlocking: true },
    // Only in the world phase, which is final anyway.
    suspicionDecayed: { undoBlocking: false }
});
