import { IllegalCommand, registerCommand, type Ctx } from '../core/engine';
import { facingToward } from '../core/grid';
import { crewMember, spendActions } from '../core/state';
import type { CrewState, Pos } from '../core/types';
import { registerEvents } from '../core/undo';
import { DASH_ACTIONS, MOVE_ACTIONS } from '../data/movement';
import { dashBudget, inHeavyArmour, moveBudget, validatePath } from '../geo/move';
import { makeNoise } from '../geo/sound';

/*
 * The crew's simplest actions (§6.3): Move (1 action, 5 tiles, 4 in heavy armour), Dash (2 actions, 10 tiles, a quiet
 * noise of radius 2 where it ends, not in heavy armour) and Wait. A move checks its path with `validatePath`, the same
 * steps the reach overlay uses. It is undoable unless something it triggers reveals something: perception (M1-05)
 * hangs its checks on each step and on the end through `registerMoveHook`, and the events those emit block undo.
 */

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

function walk(ctx: Ctx, member: CrewState, path: readonly Pos[], mode: MoveMode): void {
    const from = member.pos;
    let prev = from;
    for (let i = 0; i < path.length; i++) {
        const p = path[i]!;
        member.facing = facingToward(prev, p) ?? member.facing;
        member.pos = { x: p.x, y: p.y };
        prev = p;
        for (const h of hooks()) h.step?.(ctx, member, path, i, mode);
    }
    ctx.emit({ type: 'moved', crew: member.id, from, to: { x: member.pos.x, y: member.pos.y }, path: path.map(p => ({ x: p.x, y: p.y })) });
    if (mode === 'dash') makeNoise(ctx, 'dash', member.pos, `dash ${member.id}`);
    for (const h of hooks()) h.end?.(ctx, member, path, mode);
}

function check(ctx: Ctx, member: CrewState, path: readonly Pos[], budget: number): void {
    const result = validatePath(ctx.world, ctx.state, member.pos, path, budget, { mover: member.id });
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
    if (inHeavyArmour(member)) throw new IllegalCommand(`${member.name} can't dash in heavy armour`);
    check(ctx, member, cmd.path, dashBudget(ctx.world));
    spendActions(member, DASH_ACTIONS);
    walk(ctx, member, cmd.path, 'dash');
});

registerCommand('wait', (ctx, cmd) => {
    const member = crewMember(ctx.state, cmd.crew);
    member.actionsLeft = 0;
    ctx.emit({ type: 'waited', crew: member.id });
});

registerEvents({
    moved: { undoBlocking: false },
    waited: { undoBlocking: false }
});
