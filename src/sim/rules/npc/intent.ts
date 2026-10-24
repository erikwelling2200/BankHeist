import { COMBAT_STATUSES, registerWorldHook, type Ctx } from '../../core/engine';
import { FACING_STEP, FACINGS, facingToward, inBounds, samePos, tileAt } from '../../core/grid';
import { stepCost } from '../../geo/move';
import { clonePlain, samePlain } from '../../core/json';
import { registerStateInit } from '../../core/state';
import type { DeepReadonly, Facing, Intent, NpcState, PersonDef, Pos, ReadonlyWorld, State } from '../../core/types';
import { registerEvents } from '../../core/undo';
import {
    behaviourGoal, comingPhase, decidesFor, evidenceReport, friskSatisfied, quarterTurn, reactionOf, settleFrisks, statusFor, topWant, type Goal, type RouteProgress
} from './behaviour';
import { blockIndexAt, LEAVING_ACTIVITIES, ROUTE_ACTIVITIES, routeMode, wayBackIn } from './schedule';
import { crewTiles, intentEnd, isPresent, npcMoveOptions, othersTiles, personOf, planWalk, type WalkTarget } from './walk';

/*
 * Committed intents (§6.1 step 3, §6.2): at the end of every world phase each NPC commits what it will do in the next
 * one, its path, facing and action, and the crew phase shows it. The world phase carries out exactly those (`act.ts`).
 *
 * - `npcs.intents` (the commitIntents step) decides every NPC in resolution order: its goal (behaviour.ts, else its
 *   schedule), then the walk to it (walk.ts). Each walk ends where no other NPC stands and no earlier NPC's walk ends.
 * - A want formed during the crew phase rewrites the intent at once (`reconsider`, called by perception whenever it
 *   applies sightings in a crew phase), so the telegraph shows during that crew phase and the world phase (perception
 *   included, which judges sightings along the intents frozen at its start) carries out the new one. Only NPCs whose
 *   goal changed are planned again: an untouched intent stays exactly as committed.
 *
 * The routine (no wants): the block of the schedule the coming world phase's turn is in (schedule.ts), so a block
 * starting on turn T is telegraphed in T's crew phase and walked in T's world phase. Standing activities walk to their
 * tile and face their facing; routes walk to the next waypoint, which moves on when the NPC stands on it, or when it
 * couldn't get any closer for two phases (someone stands there); leaving walks to the way out and leaves the map from
 * it or a tile next to it; someone away whose schedule has them back comes in at the tile they left by, or a step
 * from it, once there is room.
 */

declare module '../../core/types' {
    interface EventMap {
        /** An NPC's status badge changed (§16.5). */
        npcStatus: { npc: string; status: NpcStatus };
    }
}

/** The goal an NPC follows when its wants and search give it none: its schedule (mutates its route progress). */
function routineGoal(state: State, npc: NpcState, person: DeepReadonly<PersonDef>): Goal {
    // Committed at the end of a world phase for the next one: the block of the next turn.
    const index = blockIndexAt(person, comingPhase(state));
    if (index < 0) return { kind: 'still' };
    const block = person.schedule[index]!;
    if (!isPresent(npc)) {
        return LEAVING_ACTIVITIES.has(block.activity) ? { kind: 'away', block: index } : { kind: 'enter', block: index, tile: wayBackIn(person, index) };
    }
    if (ROUTE_ACTIVITIES.has(block.activity) && block.route?.length) {
        const route = block.route, once = routeMode(block.activity) === 'once';
        if (!npc.route || npc.route.block !== index) {
            // A route is joined at its start (the closing sweep) or at its nearest waypoint (a patrol picked up again).
            let leg = 0;
            if (!once) {
                let best = Infinity;
                route.forEach((p, i) => {
                    const dx = p.x - npc.pos.x, dy = p.y - npc.pos.y, d = dx * dx + dy * dy;
                    if (d < best) { best = d; leg = i; }
                });
            }
            npc.route = { block: index, leg, dir: 1, stalled: 0 };
        }
        const progress = npc.route;
        for (let k = 0; k < route.length && (samePos(npc.pos, route[progress.leg]!) || progress.stalled >= 2); k++) {
            progress.stalled = 0;
            if (!advance(progress, route.length, once)) break;
        }
        return { kind: 'routine', block: index, tile: { x: route[progress.leg]!.x, y: route[progress.leg]!.y } };
    }
    npc.route = null;
    return { kind: 'routine', block: index, tile: block.at ? { x: block.at.x, y: block.at.y } : { x: npc.pos.x, y: npc.pos.y } };
}

/** Moves on to the next waypoint; false at the end of a route walked once. */
function advance(progress: RouteProgress, length: number, once: boolean): boolean {
    if (length < 2) return false;
    if (once) {
        if (progress.leg >= length - 1) return false;
        progress.leg++;
        return true;
    }
    if (progress.leg + progress.dir < 0 || progress.leg + progress.dir >= length) progress.dir = progress.dir === 1 ? -1 : 1;
    progress.leg += progress.dir;
    return true;
}

/** An intent of a walk, with the facing at its end if it arrives. */
function walkIntent(world: ReadonlyWorld, state: State, npc: DeepReadonly<NpcState>, target: WalkTarget, taken: (i: number) => boolean,
    end: { facing?: Facing | undefined; lookAt?: Pos | undefined; action?: Intent['action']; onArrival?: boolean; within?: number }): Intent {
    const walk = planWalk(world, state, npc, target, taken);
    const intent: Intent = { path: walk.path };
    const last = walk.path[walk.path.length - 1] ?? npc.pos;
    const facing = walk.arrives ? end.facing ?? (end.lookAt ? facingToward(last, end.lookAt) : undefined) : undefined;
    if (facing) intent.facing = facing;
    const there = walk.exact || (end.within !== undefined
        && Math.max(Math.abs(walk.dest.x - target.tile.x), Math.abs(walk.dest.y - target.tile.y)) <= end.within);
    if (end.action && (!end.onArrival || (walk.arrives && there))) intent.action = end.action;
    return intent;
}

/** Plans the intent of a goal. `taken` says where it may not end (`othersTiles`). */
function planGoal(world: ReadonlyWorld, state: State, npc: NpcState, goal: Goal, taken: (i: number) => boolean): Intent {
    const person = personOf(world, npc.id);
    const face = (tile: Pos | undefined): Intent => {
        const facing = tile && facingToward(npc.pos, tile);
        return facing ? { path: [], facing } : { path: [] };
    };
    switch (goal.kind) {
        case 'still':
        case 'away':
            return { path: [] };
        case 'enter': {
            // At the way in, or a step from it when someone stands there.
            const tile = goal.tile!, crew = crewTiles(world, state), options = npcMoveOptions(world, npc);
            const free = (p: Pos): boolean => inBounds(world, p) && !tileAt(world, p)!.blocksMove && !taken(p.y * world.width + p.x)
                && !crew.has(p.y * world.width + p.x);
            const around = FACINGS.map(f => ({ x: tile.x + FACING_STEP[f].x, y: tile.y + FACING_STEP[f].y }))
                .filter(p => inBounds(world, p) && stepCost(world, state, tile, p, options) !== undefined);
            const at = [tile, ...around].find(free);
            return at ? { path: [{ x: at.x, y: at.y }], action: { kind: 'enter' } } : { path: [] };
        }
        case 'routine': {
            const block = person.schedule[goal.block!]!;
            const routeEnd = ROUTE_ACTIVITIES.has(block.activity) && block.route && samePos(goal.tile!, block.route[block.route.length - 1]!) && routeMode(block.activity) === 'once';
            const stands = !ROUTE_ACTIVITIES.has(block.activity) || routeEnd;
            // The way out is a door, not a spot: anyone who reaches it or the tiles around it leaves.
            // The closing sweep goes briskly: every room before the night.
            const pace = block.activity === 'closingSweep' ? 'hurry' : 'walk';
            const intent = walkIntent(world, state, npc, { tile: goal.tile!, pace }, taken, {
                facing: stands ? block.facing : undefined,
                ...(LEAVING_ACTIVITIES.has(block.activity) ? { action: { kind: 'leave' } as const, onArrival: true, within: 1 } : {})
            });
            if (npc.route) npc.route.stalled = intent.path.length || samePos(npc.pos, goal.tile!) ? 0 : npc.route.stalled + 1;
            return intent;
        }
        case 'face':
        case 'watch':
        case 'look':
            return face(goal.tile);
        case 'inspect':
            return walkIntent(world, state, npc, { tile: goal.tile!, pace: 'hurry' }, taken, { lookAt: goal.tile });
        case 'report': {
            const plan = evidenceReport(world, state, npc);
            if (!plan.tile) {
                const intent: Intent = { path: [] };
                if (plan.facing) intent.facing = plan.facing;
                if (plan.action) intent.action = plan.action;
                return intent;
            }
            return walkIntent(world, state, npc, { tile: plan.tile, pace: plan.pace }, taken, {
                lookAt: goal.tile, ...(plan.action ? { action: plan.action, onArrival: plan.onArrival } : {})
            });
        }
        case 'search': {
            // §16.1: it keeps watching where the crew member was for one more phase, then walks there and looks round.
            const search = npc.search!;
            if (search.until > comingPhase(state)) return face(goal.tile);
            // A glance at a noise (decision 45) doesn't turn the search: it goes on from the facing it glanced from.
            if (samePos(npc.pos, search.tile)) return { path: [], facing: quarterTurn(npc.glancedFrom ?? npc.facing) };
            return walkIntent(world, state, npc, { tile: search.tile, pace: 'hurry' }, taken, {});
        }
        case 'investigate': {
            const enforcer = person.observer === 'enforcer';
            return walkIntent(world, state, npc, { tile: goal.tile!, pace: 'hurry' }, taken, {
                lookAt: goal.tile, ...(enforcer ? { action: { kind: 'frisk', crew: goal.crew! } as const, onArrival: false } : {})
            });
        }
        case 'challenge':
            return walkIntent(world, state, npc, { tile: goal.tile!, pace: 'hurry' }, taken, { lookAt: goal.tile });
        case 'escort':
            return walkIntent(world, state, npc, { tile: goal.tile!, pace: 'hurry', keepOut: 'public' }, taken, { lookAt: goal.tile });
        case 'react': {
            const want = topWant(npc)!;
            const plan = reactionOf(world, state, npc, want);
            if (!plan.tile) {
                const intent: Intent = { path: [] };
                if (plan.facing) intent.facing = plan.facing;
                if (plan.action) intent.action = plan.action;
                return intent;
            }
            return walkIntent(world, state, npc, { tile: plan.tile, pace: plan.pace }, taken, {
                facing: plan.facing, lookAt: want.tile, ...(plan.action ? { action: plan.action, onArrival: plan.onArrival } : {})
            });
        }
    }
}

type Emit = Ctx['emit'];

/** Sets a status this module owns, telling the crew phase when it changes. */
function setStatus(emit: Emit, npc: NpcState, goal: Goal): void {
    const status = statusFor(npc, goal);
    if (status === npc.status) return;
    npc.status = status;
    emit({ type: 'npcStatus', npc: npc.id, status });
}

/**
 * Decides one NPC's goal for the coming world phase: its wants, its search, else its schedule. Every NPC's own
 * housekeeping (`settle`) is done first, so each goal is judged on the same state the crew phase will see.
 */
function decide(world: ReadonlyWorld, state: State, npc: NpcState): Goal {
    let goal = behaviourGoal(world, state, npc);
    // Lost the trail (§16.1): an investigator whose suspicion fell below 2 searches for two phases, then goes back. A
    // clean frisk, or another NPC sent in its place, is no lost trail: it only watches.
    const was = npc.goal;
    if (was.kind === 'investigate' && (!goal || goal.kind === 'face') && !npc.search && !friskSatisfied(npc, was.crew!)) {
        npc.search = { tile: was.tile ?? { x: npc.pos.x, y: npc.pos.y }, until: state.turn + world.rules.searchPhases };
        goal = behaviourGoal(world, state, npc);
    }
    return goal ?? routineGoal(state, npc, personOf(world, npc.id));
}

/** Forgets what has run out: clean frisks below its suspicion now, a search that is over. */
function settle(state: State, npc: NpcState): void {
    settleFrisks(npc);
    if (npc.search && npc.search.until < comingPhase(state)) npc.search = null;
}

/** Every NPC commits its intent for the coming world phase, in resolution order (see the header). */
function commitAll(world: ReadonlyWorld, state: State, emit: Emit): void {
    const deciding = state.npcs.filter(decidesFor);
    for (const npc of state.npcs) {
        // Eyes down: they stay put and forget what they were doing. Combat decides its own (§13.6).
        if (!decidesFor(npc) && isPresent(npc) && !COMBAT_STATUSES.has(npc.status)) {
            npc.intent = { path: [] };
            npc.goal = { kind: 'still' };
            npc.route = null;
            npc.search = null;
        }
    }
    for (const npc of deciding) settle(state, npc);
    const goals = new Map(deciding.map(npc => [npc.id, decide(world, state, npc)]));
    const ends: Record<string, Intent> = {};
    for (const npc of state.npcs) ends[npc.id] = { path: [] };
    for (const npc of deciding) {
        const goal = goals.get(npc.id)!;
        // Only NPCs planned before this one have committed: the others are judged by where they stand.
        const intent = planGoal(world, state, npc, goal, othersTiles(world, state, npc.id, ends));
        npc.intent = intent;
        npc.goal = goal;
        ends[npc.id] = intent;
        setStatus(emit, npc, goal);
    }
}

registerWorldHook('commitIntents', 'npcs.intents', ctx => commitAll(ctx.world, ctx.state, ctx.emit));

// The heist starts with every NPC's first intent committed, for the first crew phase to show.
registerStateInit('npcIntents', (world, state) => commitAll(world, state, () => {}));

/**
 * A crew phase changed what NPCs want (perception calls this after applying sightings): every NPC whose goal is now
 * different commits a new intent at once (§6.2, M1-05's note), in resolution order. Others keep theirs exactly.
 */
export function reconsider(ctx: Ctx): void {
    const { world, state } = ctx;
    if (state.phase !== 'crew') return;
    for (const npc of state.npcs) {
        if (!decidesFor(npc)) continue;
        const goal = behaviourGoal(world, state, npc);
        if (!goal || samePlain(goal, npc.goal)) continue;
        npc.intent = planGoal(world, state, npc, goal, othersTiles(world, state, npc.id));
        npc.goal = clonePlain(goal);
        setStatus(ctx.emit, npc, goal);
    }
}

/** Where an NPC's committed intent leaves it, if carried out in full. */
export const committedEnd = (npc: DeepReadonly<NpcState>): Pos => intentEnd(npc, npc.intent);

registerEvents({ npcStatus: { undoBlocking: true } });
