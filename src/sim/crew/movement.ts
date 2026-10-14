import { IllegalCommand, registerCommand, type Ctx } from '../core/engine';
import { facingToward } from '../core/grid';
import { crewMember, spendActions } from '../core/state';
import type { CrewState, DeepReadonly, DoorDef, DoorStatus, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { DASH_ACTIONS, MOVE_ACTIONS } from '../data/movement';
import {
    ABSENT_STATUSES, dashBudget, doorBetween, doorStatus, inHeavyArmour, moveBudget, occupancy, validatePath, type MoveOptions
} from '../geo/move';
import { makeNoise } from '../geo/sound';

/*
 * Move (1 action, 5 tiles, 4 in heavy armour) and Dash (2 actions, 12 tiles, not in heavy armour, a quiet noise of
 * radius 2 from every tile it crosses), §6.3. Carrying something Very Heavy (a body, rules/actions/body.ts) halves the
 * reach and rules out the dash: a package changes the budgets through `registerBudgetModifier`, and the UI asks
 * `crewBudget` and `dashRefusal`, the same numbers the commands use. A move checks its path with `validatePath`, the
 * same steps the reach overlay uses, and opens the doors it walks through. It is undoable unless something it triggers
 * reveals something: perception (M1-05) hangs its checks on each step and on the end through `registerMoveHook`, and
 * the events those emit block undo; so does anyone hearing the dash (`heard`).
 *
 * **Moving in unknown space (§8.15).** A path is planned and checked against the bank as the crew pictures it
 * (`registerPlanView`: rules/knowledge.ts shows only the NPCs the crew sees or predicts), so a tile an unseen NPC stands
 * on reads as open. The move then finds out: it stops on the step before an NPC standing in its way, or before ending
 * on anyone (`bump`), and limits (`registerMoveLimit`, e.g. knowledge stopping at the step where an NPC the crew has
 * never seen comes into view) can stop it earlier. The stop is always a tile of the drawn path, worked out before the
 * first step, so perception judges exactly the tiles walked; the action is spent and a `moveCut` event says why. A
 * preview (the truth) shows the stop; what the player is shown of it is the projection's business (projectEvents in
 * preview mode keeps the drawn path): the preview can't promise the whole path through unknown space.
 */

declare module '../core/types' {
    interface CommandMap {
        /** Like move, for 2 actions and up to `dashTiles`, with a quiet noise of radius 2 along its path (§6.3). */
        dash: { crew: string; path: Pos[] };
    }
    interface EventMap {
        /** Someone opened a door by walking through it. Seen or not is perception's business. */
        doorOpened: { door: string; by: string };
        /**
         * A crew move stopped short of the drawn path (`planned`) at `at`: it bumped into an NPC the crew didn't know
         * stood there (`bump`), or an NPC it had never seen came into view (`spotted`).
         */
        moveCut: { crew: string; npc: string; reason: 'bump' | 'spotted'; at: Pos; planned: Pos[] };
    }
}

/** How a crew member moved. */
export type MoveMode = 'move' | 'dash';

export interface MoveHook {
    /** Before the first step, with the state as it was before the move (the path is already checked). */
    start?: (ctx: Ctx, member: CrewState, path: readonly Pos[], mode: MoveMode) => void;
    /** After the mover stands on `path[index]` (facing along the step), before the next step. */
    step?: (ctx: Ctx, member: CrewState, path: readonly Pos[], index: number, mode: MoveMode) => void;
    /** After the move is over (the moved event and any noise emitted). */
    end?: (ctx: Ctx, member: CrewState, path: readonly Pos[], mode: MoveMode) => void;
}

const MOVE_HOOKS = new Map<string, MoveHook>();

/** Adds a named hook to every crew move. Hooks run by name. A second hook of the same name throws unless it says `replace`. */
export function registerMoveHook(name: string, hook: MoveHook, options: { replace?: boolean } = {}): void {
    if (MOVE_HOOKS.has(name) && !options.replace) throw new Error(`Move hook '${name}' already exists; pass replace: true to change it`);
    MOVE_HOOKS.set(name, hook);
}

const hooks = (): MoveHook[] => [...MOVE_HOOKS.keys()].sort().map(k => MOVE_HOOKS.get(k)!);

/** Why a crew member can't dash right now, or undefined. Augmented by `registerDashCheck`. */
export type DashCheck = (member: DeepReadonly<CrewState>) => string | undefined;

const DASH_CHECKS = new Map<string, DashCheck>([
    ['heavyArmour', m => (inHeavyArmour(m) ? `${m.name} can't dash in heavy armour` : undefined)]
    // TODO(M2 carrying): 'heavyLoot' — no Dash while carrying Heavy loot (§6.3); the carry package registers it.
]);

/** Adds a reason a crew member can't dash (carrying Heavy loot, M2). Checks run by name. */
export function registerDashCheck(name: string, check: DashCheck): void {
    if (DASH_CHECKS.has(name)) throw new Error(`Dash check '${name}' already exists`);
    DASH_CHECKS.set(name, check);
}

/** Changes a crew member's Move or Dash budget in half-steps (carrying a body halves it). */
export type BudgetModifier = (world: ReadonlyWorld, member: DeepReadonly<CrewState>, mode: MoveMode, budget: number) => number;

const BUDGET_MODIFIERS = new Map<string, BudgetModifier>();

/** Adds a named budget modifier; modifiers run by name. */
export function registerBudgetModifier(name: string, modifier: BudgetModifier): void {
    if (BUDGET_MODIFIERS.has(name)) throw new Error(`Budget modifier '${name}' already exists`);
    BUDGET_MODIFIERS.set(name, modifier);
}

/**
 * A crew member's budget in half-steps for a Move or a Dash, with every modifier: what the move and dash commands
 * check paths against, and what the reach overlay should draw (rather than geo/move.ts `moveBudget`/`dashBudget`).
 */
export function crewBudget(world: ReadonlyWorld, member: DeepReadonly<CrewState>, mode: MoveMode): number {
    let budget = mode === 'dash' ? dashBudget(world) : moveBudget(world, member);
    for (const name of [...BUDGET_MODIFIERS.keys()].sort()) budget = BUDGET_MODIFIERS.get(name)!(world, member, mode, budget);
    return budget;
}

/**
 * Why a crew member can't dash now (fewer than 2 actions left, heavy armour, carrying a body, …), or null when they
 * may: the dash command refuses with exactly this, so the UI can grey the dash band without a preview.
 */
export function dashRefusal(_world: ReadonlyWorld, state: State, crewId: string): string | null {
    const member = state.crew.find(c => c.id === crewId);
    if (!member) return `No crew member '${crewId}'`;
    if (member.actionsLeft < DASH_ACTIONS) return `${member.name} has ${member.actionsLeft} of ${DASH_ACTIONS} actions left`;
    for (const name of [...DASH_CHECKS.keys()].sort()) {
        const reason = DASH_CHECKS.get(name)!(member);
        if (reason) return reason;
    }
    return null;
}

/** The bank as the crew plans a move against (rules/knowledge.ts: only the NPCs it sees or predicts). Default: the truth. */
export type PlanView = (world: ReadonlyWorld, state: State) => State;

let planView: PlanView = (_world, state) => state;

/** Sets the view moves are planned and checked against (one only; knowledge registers it). */
export function registerPlanView(view: PlanView): void {
    planView = view;
}

/** The state a crew move is planned and checked against. */
export const planningState = (world: ReadonlyWorld, state: State): State => planView(world, state);

/** Why a move stops short: how many steps of the path it keeps, the NPC and the reason. */
export interface MoveCut { keep: number; npc: string; reason: 'bump' | 'spotted' }

/** Says where a move stops short, if it does (`path` already cut by the limits before it). */
export type MoveLimit = (ctx: Ctx, member: CrewState, path: readonly Pos[], mode: MoveMode) => MoveCut | undefined;

const MOVE_LIMITS = new Map<string, MoveLimit>();

/** Adds a named limit to every crew move; limits run by name after the bump. */
export function registerMoveLimit(name: string, limit: MoveLimit, options: { replace?: boolean } = {}): void {
    if (MOVE_LIMITS.has(name) && !options.replace) throw new Error(`Move limit '${name}' already exists; pass replace: true to change it`);
    MOVE_LIMITS.set(name, limit);
}

/** The bump: the step before the first NPC standing on the path, or before the last tile when anyone is on it. */
const bump: MoveLimit = (ctx, member, path) => {
    const { world, state } = ctx;
    const people = occupancy(world, state, { mover: member.id });
    for (let i = 0; i < path.length; i++) {
        const p = path[i]!, who = people.get(p.y * world.width + p.x);
        if (!who || who === 'none') continue;
        const npc = state.npcs.find(n => n.pos.x === p.x && n.pos.y === p.y && !ABSENT_STATUSES.has(n.status));
        if (npc && (who === 'blocking' || i === path.length - 1)) return { keep: i, npc: npc.id, reason: 'bump' };
    }
    return undefined;
};

/** The part of the path the move walks, and why it stops short (see the header). */
function cutPath(ctx: Ctx, member: CrewState, path: readonly Pos[], mode: MoveMode): { walked: Pos[]; cut: MoveCut | undefined } {
    let keep = path.length, cut: MoveCut | undefined;
    for (const limit of [bump, ...[...MOVE_LIMITS.keys()].sort().map(k => MOVE_LIMITS.get(k)!)]) {
        const found = limit(ctx, member, path.slice(0, keep), mode);
        if (found && found.keep < keep) { keep = found.keep; cut = found; }
    }
    if (cut) {
        // Nobody ends a move on anyone's tile: back up to one free.
        const people = occupancy(ctx.world, ctx.state, { mover: member.id });
        while (keep > 0 && (people.get(path[keep - 1]!.y * ctx.world.width + path[keep - 1]!.x) ?? 'none') !== 'none') keep--;
    }
    return { walked: path.slice(0, keep).map(p => ({ x: p.x, y: p.y })), cut };
}

/** Whether a crew member holds the key to a locked door. Keys arrive with the key graph (M1-06/M1-07): none yet. */
export function crewHasKey(_member: DeepReadonly<CrewState>, _door: DeepReadonly<DoorDef>): boolean {
    return false;
}

/** The doors a crew member walks through, opening them: closed ones, and locked ones they hold the key to. */
export function crewMoveOptions(member: DeepReadonly<CrewState>): MoveOptions {
    return {
        mover: member.id,
        canPassDoor: (door: DeepReadonly<DoorDef>, status: DoorStatus) => status === 'closed' || (status === 'locked' && crewHasKey(member, door))
    };
}

function walk(ctx: Ctx, member: CrewState, planned: readonly Pos[], mode: MoveMode): void {
    const { walked: path, cut } = cutPath(ctx, member, planned, mode);
    for (const h of hooks()) h.start?.(ctx, member, path, mode);
    const from = member.pos;
    let prev = from;
    for (let i = 0; i < path.length; i++) {
        const p = path[i]!;
        const door = Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y) === 1 ? doorBetween(ctx.world, prev, p) : undefined;
        if (door) {
            const status = doorStatus(ctx.world, ctx.state, door.id);
            if (status === 'closed' || status === 'locked') {
                ctx.state.doors[door.id] = { ...ctx.state.doors[door.id], status: 'open' };
                ctx.emit({ type: 'doorOpened', door: door.id, by: member.id });
            }
        }
        member.facing = facingToward(prev, p) ?? member.facing;
        member.pos = { x: p.x, y: p.y };
        prev = p;
        for (const h of hooks()) h.step?.(ctx, member, path, i, mode);
    }
    const copy = path.map(p => ({ x: p.x, y: p.y }));
    if (copy.length) ctx.emit({ type: 'moved', crew: member.id, from, to: { x: member.pos.x, y: member.pos.y }, path: copy });
    if (cut) {
        ctx.emit({
            type: 'moveCut', crew: member.id, npc: cut.npc, reason: cut.reason, at: { x: member.pos.x, y: member.pos.y },
            planned: planned.map(p => ({ x: p.x, y: p.y }))
        });
    }
    if (mode === 'dash' && copy.length) makeNoise(ctx, 'dash', copy, `dash ${member.id}`);
    for (const h of hooks()) h.end?.(ctx, member, path, mode);
}

function check(ctx: Ctx, member: CrewState, path: readonly Pos[], budget: number): void {
    const result = validatePath(ctx.world, planningState(ctx.world, ctx.state), member.pos, path, budget, crewMoveOptions(member));
    if (!result.ok) throw new IllegalCommand(result.reason);
}

registerCommand('move', (ctx, cmd) => {
    const member = crewMember(ctx.state, cmd.crew);
    check(ctx, member, cmd.path, crewBudget(ctx.world, member, 'move'));
    spendActions(member, MOVE_ACTIONS);
    walk(ctx, member, cmd.path, 'move');
});

registerCommand('dash', (ctx, cmd) => {
    const member = crewMember(ctx.state, cmd.crew);
    const refused = dashRefusal(ctx.world, ctx.state, member.id);
    if (refused) throw new IllegalCommand(refused);
    check(ctx, member, cmd.path, crewBudget(ctx.world, member, 'dash'));
    spendActions(member, DASH_ACTIONS);
    walk(ctx, member, cmd.path, 'dash');
});

// Opening a door shows what is behind it only to whoever looks: perception decides, so the event itself doesn't block.
registerEvents({ doorOpened: { undoBlocking: false }, moveCut: { undoBlocking: true } });
