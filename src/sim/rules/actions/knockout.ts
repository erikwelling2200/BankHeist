import { registerWorldHook, type Ctx } from '../../core/engine';
import { registerNpcInit, registerRuleDefaults } from '../../core/state';
import type { DeepReadonly, NpcState, Pos, ReadonlyWorld, State } from '../../core/types';
import { registerEvents } from '../../core/undo';
import { HALF_STEPS_PER_TILE } from '../../data/movement';
import { ABSENT_STATUSES, reachable } from '../../geo/move';
import { makeNoise } from '../../geo/sound';
import { reportAssault } from '../evidence';
import { alertNpc } from '../suspicion';
import { inReach, lacksActions, registerAction } from './act';
import { bodyPos, releaseBody } from './body';

/*
 * Knockout (§6.3, §11.10): 1 action, on an NPC in reach (a neighbour with no wall in between, `inReach`) that isn't
 * Hostile, or is Hostile but caught off guard (`registerKnockoutWindow`: Surprised, Suppressed, when they exist), and
 * isn't already down (tied or commanded NPCs are refused: they are face down and compliant). Not while dragging a
 * body. It is an illegal act (§8.4: `!` for anyone who sees the attacker's tile or the victim's) and a quiet noise of
 * radius 2 (§8.9) on the target's tile.
 *
 * The target is **out cold for `rules.knockoutPhases` (4) world phases**: unconscious (eyes down, blind and deaf), its
 * intent cleared at once, so whatever it saw or meant to do it never does (§6.2: a witness dropped in the same crew
 * phase never acts). At the end of the 4th world phase (its devices step) it **wakes Alerted where it lies** (or on the
 * nearest free tile by legal steps, when someone stands there or drags it), let go by whoever dragged it and out of any
 * stash, and reports its own assault like major evidence (rules/evidence.ts `reportAssault`): its intent, committed at
 * the end of that world phase, is telegraphed in the next crew phase.
 */

declare module '../../core/types' {
    interface CommandMap {
        /** Knock out the NPC `npc` in reach (1 action, an illegal act, quiet noise 2). */
        knockout: { crew: string; npc: string };
    }
    interface NpcState {
        /** Knocked out: the turn at the end of whose world phase it wakes, or null. */
        outCold: number | null;
    }
    interface Rules {
        /** World phases a knockout lasts (§11.10). */
        knockoutPhases: number;
    }
    interface EventMap {
        knockedOut: { crew: string; npc: string; wakes: number };
        /** A knocked-out NPC came round, Alerted, at `at`. */
        woke: { npc: string; at: Pos };
    }
}

registerRuleDefaults({ knockoutPhases: 4 });

registerNpcInit('knockout', (_world, _person, npc) => {
    npc.outCold = null;
});

/** Says when a Hostile NPC can still be knocked out (Surprised, Suppressed). */
export type KnockoutWindow = (npc: DeepReadonly<NpcState>) => boolean;

const WINDOWS = new Map<string, KnockoutWindow>();

/** Adds a reason a Hostile NPC can be knocked out after all (§11.10). Windows are asked by name. */
export function registerKnockoutWindow(name: string, opening: KnockoutWindow): void {
    if (WINDOWS.has(name)) throw new Error(`Knockout window '${name}' already exists`);
    WINDOWS.set(name, opening);
}

/** Why this NPC can't be knocked out by anyone now (whoever is in reach), or undefined (§11.10). */
export function knockoutIneligible(npc: DeepReadonly<NpcState>): string | undefined {
    if (ABSENT_STATUSES.has(npc.status)) return 'They aren\'t here';
    if (npc.status === 'unconscious' || npc.status === 'dead') return 'They are already down';
    // Face down and doing as they are told: there is nothing to knock out (and nothing to give back when they wake).
    if (npc.status === 'tied') return 'They are tied up already';
    if (npc.status === 'commanded') return 'They are already on the floor';
    if (npc.status === 'hostile' && ![...WINDOWS.keys()].sort().some(k => WINDOWS.get(k)!(npc))) return 'They are hostile and ready for it';
    return undefined;
}

/** Why a crew member can't knock out this NPC now, or undefined. */
export function knockoutBlocked(world: ReadonlyWorld, state: State, crewId: string, npcId: string): string | undefined {
    const member = state.crew.find(c => c.id === crewId);
    if (!member) return `No crew member '${crewId}'`;
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    if (member.dragging !== null) return `${member.name}'s hands are full`;
    const npc = state.npcs.find(n => n.id === npcId);
    if (!npc) return `No one called '${npcId}'`;
    const why = knockoutIneligible(npc);
    if (why) return why;
    if (state.crew.some(c => c.dragging === npcId)) return 'They are being dragged';
    if (!inReach(world, state, member.pos, npc.pos)) return `${member.name} can't reach them from here`;
    return undefined;
}

registerAction('knockout', {
    whyNot: (world, state, cmd) => knockoutBlocked(world, state, cmd.crew, cmd.npc),
    candidates: (_world, state, member) => state.npcs.map(n => ({ type: 'knockout', crew: member.id, npc: n.id })),
    cost: () => 1,
    // Seen on either tile: whoever sees the attacker or the victim.
    illegal: (_world, state, cmd) => ({
        act: 'knockout',
        tiles: [state.crew.find(c => c.id === cmd.crew)!.pos, state.npcs.find(n => n.id === cmd.npc)!.pos].map(p => ({ x: p.x, y: p.y }))
    }),
    run(ctx, member, cmd) {
        const npc = ctx.state.npcs.find(n => n.id === cmd.npc)!;
        knockOut(ctx, npc, member.id);
        makeNoise(ctx, 'knockout', npc.pos, `knockout ${npc.id}`);
    }
});

/**
 * Puts an NPC out cold for `rules.knockoutPhases` world phases (see the header), by a crew member's hands or a taser's
 * dart (rules/actions/attack.ts). The noise is the caller's.
 */
export function knockOut(ctx: Ctx, npc: NpcState, by: string): void {
    const { state, world } = ctx;
    npc.status = 'unconscious';
    npc.outCold = state.turn + world.rules.knockoutPhases - 1;
    // It never acts on anything it saw or meant to do (§6.2).
    npc.intent = { path: [] };
    npc.goal = { kind: 'still' };
    npc.route = null;
    npc.search = null;
    npc.lapse = null;
    npc.panic = null;
    ctx.emit({ type: 'knockedOut', crew: by, npc: npc.id, wakes: npc.outCold });
    ctx.emit({ type: 'npcStatus', npc: npc.id, status: 'unconscious' });
}

/**
 * Where someone coming round at `p` gets up: `p` if nobody stands or lies there, else the nearest tile by NPC steps
 * from it (`stepCost`: never across a wall, a closed door or a ledge; then row-major) that is free, within 4 tiles. If
 * there is none, `p`.
 */
function wakeTile(world: ReadonlyWorld, state: State, npcId: string, p: Pos): Pos {
    const taken = new Set<number>();
    for (const c of state.crew) taken.add(c.pos.y * world.width + c.pos.x);
    for (const n of state.npcs) if (n.id !== npcId && !ABSENT_STATUSES.has(n.status)) {
        const at = bodyPos(state, n);
        taken.add(at.y * world.width + at.x);
    }
    const reach = reachable(world, state, p, 4 * HALF_STEPS_PER_TILE, { ignorePeople: true });
    const free = reach.tiles.find(t => !taken.has(t.pos.y * world.width + t.pos.x));
    return free ? { x: free.pos.x, y: free.pos.y } : p;
}

// Waking up (§11.10), with the devices, after everyone has acted: Alerted where it lies, reporting its assault.
registerWorldHook('devices', 'knockout.wake', (ctx, phase) => {
    const { world, state } = ctx;
    for (const npc of state.npcs) {
        if (npc.outCold === null || npc.outCold > phase.turn) continue;
        npc.outCold = null;
        if (npc.status !== 'unconscious') continue;
        const where = bodyPos(state, npc), dragger = state.crew.find(c => c.dragging === npc.id);
        if (dragger) releaseBody(world, state, dragger);
        npc.stashed = null;
        npc.pos = wakeTile(world, state, npc.id, where);
        npc.status = 'alerted';
        ctx.emit({ type: 'woke', npc: npc.id, at: { x: npc.pos.x, y: npc.pos.y } });
        ctx.emit({ type: 'npcStatus', npc: npc.id, status: 'alerted' });
        alertNpc(ctx, npc, 'knocked out');
        reportAssault(ctx, npc);
    }
}, { order: 44 });

registerEvents({ knockedOut: { undoBlocking: true }, woke: { undoBlocking: true } });
