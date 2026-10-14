import { registerWorldHook } from '../../core/engine';
import { FACING_STEP, FACINGS, inBounds, tileAt } from '../../core/grid';
import { registerNpcInit, registerRuleDefaults } from '../../core/state';
import type { DeepReadonly, NpcState, Pos, ReadonlyWorld, State } from '../../core/types';
import { registerEvents } from '../../core/undo';
import { ABSENT_STATUSES } from '../../geo/move';
import { makeNoise } from '../../geo/sound';
import { reportAssault } from '../evidence';
import { alertNpc } from '../suspicion';
import { inReach, lacksActions, registerAction } from './act';
import { releaseBody } from './body';

/*
 * Knockout (§6.3, §11.10): 1 action, on an NPC in reach (a neighbour with no wall in between, `inReach`) that isn't
 * Hostile, or is Hostile but caught off guard (`registerKnockoutWindow`: Surprised, Suppressed, when they exist). It is
 * an illegal act (§8.4: `!` for anyone who sees it) and a quiet noise of radius 2 (§8.9) on the target's tile.
 *
 * The target is **out cold for `rules.knockoutPhases` (4) world phases**: unconscious (eyes down, blind and deaf), its
 * intent cleared at once, so whatever it saw or meant to do it never does (§6.2: a witness dropped in the same crew
 * phase never acts). At the end of the 4th world phase (its devices step) it **wakes Alerted where it lies** (or on the
 * nearest free tile, when someone stands there or it was being dragged), let go by whoever dragged it and out of any
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
    if (npc.status === 'hostile' && ![...WINDOWS.keys()].sort().some(k => WINDOWS.get(k)!(npc))) return 'They are hostile and ready for it';
    return undefined;
}

/** Why a crew member can't knock out this NPC now, or undefined. */
export function knockoutBlocked(world: ReadonlyWorld, state: State, crewId: string, npcId: string): string | undefined {
    const member = state.crew.find(c => c.id === crewId);
    if (!member) return `No crew member '${crewId}'`;
    const lack = lacksActions(member, 1);
    if (lack) return lack;
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
    illegal: () => ({ act: 'knockout' }),
    run(ctx, member, cmd) {
        const { state, world } = ctx;
        const npc = state.npcs.find(n => n.id === cmd.npc)!;
        npc.status = 'unconscious';
        npc.outCold = state.turn + world.rules.knockoutPhases - 1;
        // It never acts on anything it saw or meant to do (§6.2).
        npc.intent = { path: [] };
        npc.goal = { kind: 'still' };
        npc.route = null;
        npc.search = null;
        ctx.emit({ type: 'knockedOut', crew: member.id, npc: npc.id, wakes: npc.outCold });
        ctx.emit({ type: 'npcStatus', npc: npc.id, status: 'unconscious' });
        makeNoise(ctx, 'knockout', npc.pos, `knockout ${npc.id}`);
    }
});

/** The tile nearest `p` (itself first, then its neighbours in facing order) nobody stands on and anyone may stand on. */
function freeTileNear(world: ReadonlyWorld, state: State, npcId: string, p: Pos): Pos {
    const taken = (q: Pos): boolean => state.crew.some(c => c.pos.x === q.x && c.pos.y === q.y)
        || state.npcs.some(n => n.id !== npcId && !ABSENT_STATUSES.has(n.status) && n.pos.x === q.x && n.pos.y === q.y);
    const ok = (q: Pos): boolean => inBounds(world, q) && !tileAt(world, q)!.blocksMove && !taken(q);
    if (ok(p)) return p;
    for (let r = 1; r <= 3; r++) {
        for (const f of FACINGS) {
            const q = { x: p.x + FACING_STEP[f].x * r, y: p.y + FACING_STEP[f].y * r };
            if (ok(q)) return q;
        }
    }
    return p;
}

// Waking up (§11.10), with the devices, after everyone has acted: Alerted where it lies, reporting its assault.
registerWorldHook('devices', 'knockout.wake', (ctx, phase) => {
    const { world, state } = ctx;
    for (const npc of state.npcs) {
        if (npc.outCold === null || npc.outCold > phase.turn) continue;
        npc.outCold = null;
        if (npc.status !== 'unconscious') continue;
        const dragger = state.crew.find(c => c.dragging === npc.id);
        if (dragger) releaseBody(state, dragger);
        npc.stashed = null;
        npc.pos = freeTileNear(world, state, npc.id, npc.pos);
        npc.status = 'alerted';
        ctx.emit({ type: 'woke', npc: npc.id, at: { x: npc.pos.x, y: npc.pos.y } });
        ctx.emit({ type: 'npcStatus', npc: npc.id, status: 'alerted' });
        alertNpc(ctx, npc, 'knocked out');
        reportAssault(ctx, npc);
    }
}, { order: 44 });

registerEvents({ knockedOut: { undoBlocking: true }, woke: { undoBlocking: true } });
