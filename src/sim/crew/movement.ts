import { IllegalCommand, registerCommand, type Ctx } from '../core/engine';
import { facingToward } from '../core/grid';
import { crewMember, spendActions } from '../core/state';
import type { CrewState, DeepReadonly, DoorDef, DoorStatus, Pos } from '../core/types';
import { registerEvents } from '../core/undo';
import { DASH_ACTIONS, MOVE_ACTIONS } from '../data/movement';
import { dashBudget, doorBetween, doorStatus, inHeavyArmour, moveBudget, validatePath, type MoveOptions } from '../geo/move';
import { makeNoise } from '../geo/sound';

/*
 * Move (1 action, 5 tiles, 4 in heavy armour) and Dash (2 actions, 10 tiles, not in heavy armour, a quiet noise of
 * radius 2 from every tile it crosses), §6.3. A move checks its path with `validatePath`, the same steps the reach
 * overlay uses, and opens the doors it walks through. It is undoable unless something it triggers reveals something:
 * perception (M1-05) hangs its checks on each step and on the end through `registerMoveHook`, and the events those
 * emit block undo; so does anyone hearing the dash (`heard`).
 */

declare module '../core/types' {
    interface CommandMap {
        /** Like move, for 2 actions and up to `dashTiles`, with a quiet noise of radius 2 along its path (§6.3). */
        dash: { crew: string; path: Pos[] };
    }
    interface EventMap {
        /** Someone opened a door by walking through it. Seen or not is perception's business. */
        doorOpened: { door: string; by: string };
    }
}

/** How a crew member moved. */
export type MoveMode = 'move' | 'dash';

export interface MoveHook {
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

function walk(ctx: Ctx, member: CrewState, path: readonly Pos[], mode: MoveMode): void {
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
    ctx.emit({ type: 'moved', crew: member.id, from, to: { x: member.pos.x, y: member.pos.y }, path: copy });
    if (mode === 'dash') makeNoise(ctx, 'dash', copy, `dash ${member.id}`);
    for (const h of hooks()) h.end?.(ctx, member, path, mode);
}

function check(ctx: Ctx, member: CrewState, path: readonly Pos[], budget: number): void {
    const result = validatePath(ctx.world, ctx.state, member.pos, path, budget, crewMoveOptions(member));
    if (!result.ok) throw new IllegalCommand(result.reason);
}

registerCommand('move', (ctx, cmd) => {
    const member = crewMember(ctx.state, cmd.crew);
    check(ctx, member, cmd.path, moveBudget(ctx.world, member));
    spendActions(member, MOVE_ACTIONS);
    walk(ctx, member, cmd.path, 'move');
});

registerCommand('dash', (ctx, cmd) => {
    const member = crewMember(ctx.state, cmd.crew);
    for (const name of [...DASH_CHECKS.keys()].sort()) {
        const reason = DASH_CHECKS.get(name)!(member);
        if (reason) throw new IllegalCommand(reason);
    }
    check(ctx, member, cmd.path, dashBudget(ctx.world));
    spendActions(member, DASH_ACTIONS);
    walk(ctx, member, cmd.path, 'dash');
});

// Opening a door shows what is behind it only to whoever looks: perception decides, so the event itself doesn't block.
registerEvents({ doorOpened: { undoBlocking: false } });
