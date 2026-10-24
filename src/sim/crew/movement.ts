import { IllegalCommand, registerCommand, type Ctx } from '../core/engine';
import { facingToward } from '../core/grid';
import { crewMember, spendActions } from '../core/state';
import type { CrewState, DeepReadonly, DoorDef, DoorStatus, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { DASH_ACTIONS, MOVE_ACTIONS } from '../data/movement';
import {
    ABSENT_STATUSES, dashBudget, doorBetween, doorStatus, inHeavyArmour, moveBudget, occupancy, stepCost, validatePath, type MoveOptions
} from '../geo/move';
import { makeNoise } from '../geo/sound';
import { onFloor } from '../rules/place';

/*
 * Move (1 action, 5 tiles, 4 in heavy armour) and Dash (2 actions, 12 tiles, not in heavy armour, a quiet noise of
 * radius 2 from every tile it crosses), §6.3. Carrying something Heavy or Very Heavy (a bag, a crate, a body:
 * rules/actions/loot.ts) shortens the reach and rules out the dash: a package changes the budgets through
 * `registerBudgetModifier`, and the UI asks `crewBudget` and `dashRefusal`, the same numbers the commands use. A move
 * checks its path with `validatePath`, the same steps the reach overlay uses, and opens the doors it walks through. It is undoable unless something it triggers
 * reveals something: perception (M1-05) hangs its checks on each step and on the end through `registerMoveHook`, and
 * the events those emit block undo; so does anyone hearing the dash (`heard`).
 *
 * **Moving in unknown space (§8.15).** A path is planned and checked against the bank as the crew pictures it
 * (`registerPlanView`: rules/knowledge.ts shows only the NPCs the crew sees or predicts, and doors not seen this turn as
 * last seen; hidden tiles are off limits, `planMoveOptions`), so a tile an unseen NPC stands on reads as open, and a door
 * last seen open stays open. The move then finds
 * out: it stops on the step before an NPC standing in its way, or before ending on anyone (`bump`), and on the tile
 * before a door it can't pass after all, one found locked (`door`, decision 44; one found closed it opens on the way);
 * limits (`registerMoveLimit`) can stop it earlier. Someone new coming into view doesn't
 * (decision 40). The stop is always a tile of the drawn path, worked out before the
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
         * stood there (`bump`), or found a door it pictured passable locked or jammed (`door`, with the status found).
         */
        moveCut: { crew: string; at: Pos; planned: Pos[] } & ({ reason: 'bump'; npc: string } | { reason: 'door'; door: string; status: DoorStatus });
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
]);

/** Adds a reason a crew member can't dash (carrying loot or a body: rules/actions/loot.ts). Checks run by name. */
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

/** The tiles a crew plan may not enter (rules/knowledge.ts: the hidden ones), per tile, or null for none. */
export type PlanOffLimits = (world: ReadonlyWorld, state: State) => Uint8Array | null;

let planView: PlanView = (_world, state) => state;
let planOffLimits: PlanOffLimits = () => null;

/** Sets the view moves are planned and checked against, and the tiles they can't enter (one only; knowledge registers it). */
export function registerPlanView(view: PlanView, offLimits?: PlanOffLimits): void {
    planView = view;
    planOffLimits = offLimits ?? (() => null);
}

/** The state a crew move is planned and checked against. */
export const planningState = (world: ReadonlyWorld, state: State): State => planView(world, state);

/**
 * The move options a crew member's planned moves use (`crewMoveOptions` and the tiles off limits as `state`'s crew knows
 * them): every reach, path check and route of a crew plan, and the move command's own check, so they all agree.
 */
export function planMoveOptions(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>): MoveOptions {
    const offLimits = planOffLimits(world, state);
    return offLimits ? { ...crewMoveOptions(member), offLimits } : crewMoveOptions(member);
}

/** Why a move stops short: how many steps of the path it keeps, the reason and the NPC or door. */
export type MoveCut = { keep: number } & ({ reason: 'bump'; npc: string } | { reason: 'door'; door: string; status: DoorStatus });

/** Says where a move stops short, if it does (`path` already cut by the limits before it). */
export type MoveLimit = (ctx: Ctx, member: CrewState, path: readonly Pos[], mode: MoveMode) => MoveCut | undefined;

const MOVE_LIMITS = new Map<string, MoveLimit>();

/** Adds a named limit to every crew move; limits run by name after the bump and the locked door. */
export function registerMoveLimit(name: string, limit: MoveLimit, options: { replace?: boolean } = {}): void {
    if (MOVE_LIMITS.has(name) && !options.replace) throw new Error(`Move limit '${name}' already exists; pass replace: true to change it`);
    MOVE_LIMITS.set(name, limit);
}

/** The bump: the step before the first NPC standing on the path, or before the last tile when anyone is on it. */
const bump: MoveLimit = (ctx, member, path) => {
    const { world } = ctx, state = onFloor(ctx.state);
    const people = occupancy(world, state, { mover: member.id });
    for (let i = 0; i < path.length; i++) {
        const p = path[i]!, who = people.get(p.y * world.width + p.x);
        if (!who || who === 'none') continue;
        const npc = state.npcs.find(n => n.pos.x === p.x && n.pos.y === p.y && !ABSENT_STATUSES.has(n.status));
        if (npc && (who === 'blocking' || i === path.length - 1)) return { keep: i, npc: npc.id, reason: 'bump' };
    }
    return undefined;
};

/**
 * A door the crew pictured passable but can't pass (rules/knowledge.ts `crewPicture`: a door not seen this turn is as last
 * seen): the tile before the first step the truth doesn't allow. A door found closed instead of open is opened on the way.
 */
const lockedDoor: MoveLimit = (ctx, member, path) => {
    const { world } = ctx, state = onFloor(ctx.state), options = crewMoveOptions(member);
    let prev: Pos = member.pos;
    for (let i = 0; i < path.length; i++) {
        const p = path[i]!, door = Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y) === 1 ? doorBetween(world, prev, p) : undefined;
        if (door && stepCost(world, state, prev, p, options) === undefined) return { keep: i, reason: 'door', door: door.id, status: doorStatus(world, state, door.id) };
        prev = p;
    }
    return undefined;
};

/** The part of the path the move walks, and why it stops short (see the header). */
function cutPath(ctx: Ctx, member: CrewState, path: readonly Pos[], mode: MoveMode): { walked: Pos[]; cut: MoveCut | undefined } {
    let keep = path.length, cut: MoveCut | undefined;
    for (const limit of [bump, lockedDoor, ...[...MOVE_LIMITS.keys()].sort().map(k => MOVE_LIMITS.get(k)!)]) {
        const found = limit(ctx, member, path.slice(0, keep), mode);
        if (found && found.keep < keep) { keep = found.keep; cut = found; }
    }
    if (cut) {
        // Nobody ends a move on anyone's tile: back up to one free.
        const people = occupancy(ctx.world, onFloor(ctx.state), { mover: member.id });
        while (keep > 0 && (people.get(path[keep - 1]!.y * ctx.world.width + path[keep - 1]!.x) ?? 'none') !== 'none') keep--;
    }
    return { walked: path.slice(0, keep).map(p => ({ x: p.x, y: p.y })), cut };
}

/**
 * Whether a crew member holds the key to a locked door: a keycard door with a keycard taken in a frisk
 * (rules/actions/hostage.ts; any keycard opens any keycard door until the key graph names whose opens which, M2-05,
 * implementation plan §6 decision 60). Mechanical keys, maglocks and the vault arrive with the key graph.
 */
export function crewHasKey(member: DeepReadonly<CrewState>, door: DeepReadonly<DoorDef>): boolean {
    return door.lock === 'keycard' && member.keycards.length > 0;
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
        const { keep: _keep, ...why } = cut;
        ctx.emit({ type: 'moveCut', crew: member.id, ...why, at: { x: member.pos.x, y: member.pos.y }, planned: planned.map(p => ({ x: p.x, y: p.y })) });
    }
    if (mode === 'dash' && copy.length) makeNoise(ctx, 'dash', copy, `dash ${member.id}`);
    for (const h of hooks()) h.end?.(ctx, member, path, mode);
}

function check(ctx: Ctx, member: CrewState, path: readonly Pos[], budget: number): void {
    const result = validatePath(ctx.world, onFloor(planningState(ctx.world, ctx.state)), member.pos, path, budget, planMoveOptions(ctx.world, ctx.state, member));
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
