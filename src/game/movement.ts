import {
    crewBudget, DASH_ACTIONS, MOVE_ACTIONS, pathTo, planMoveOptions, reachable, reachAt, validatePath, type Command, type Pos, type Reach, type ReadonlyWorld,
    type State
} from '../sim';

/*
 * Movement as the player picks it (§6.3, XCOM style): one range, with Move's tiles (1 action) and the tiles only Dash
 * reaches (2 actions) beyond them; a tile or a drawn path is a Move when it fits Move's budget, else a Dash. The range
 * and the costs are the sim's own (`reachable`, `validatePath`, `crewBudget` with its modifiers, such as dragging a body,
 * and `dashRefusal`), so what the overlay shows is what a commit of the same command does.
 */

/** A crew member, as the state holds them (read-only). */
type Member = Parameters<typeof crewBudget>[1];

export interface MoveRange {
    /** Every tile within the larger budget, with the cheapest path to each. */
    reach: Reach;
    /** Move's budget in half-steps, or null when no action is left. */
    move: number | null;
    /** Dash's, or null when the member can't dash now. */
    dash: number | null;
    /** The tiles a Move can end on, and those only a Dash reaches. */
    walk: Pos[];
    run: Pos[];
}

/**
 * The selected crew member's range on `picture` (the crew's picture of the state, §8.15). `canDash` is the sim's
 * `dashRefusal` coming back null.
 */
export function moveRange(world: ReadonlyWorld, picture: State, member: Member, canDash: boolean): MoveRange {
    const move = member.actionsLeft >= MOVE_ACTIONS ? crewBudget(world, member, 'move') : null;
    const dash = canDash && member.actionsLeft >= DASH_ACTIONS ? crewBudget(world, member, 'dash') : null;
    const reach = reachable(world, picture, member.pos, Math.max(move ?? 0, dash ?? 0), planMoveOptions(world, picture, member));
    const walk: Pos[] = [], run: Pos[] = [];
    for (const t of reach.tiles) {
        if (!t.canEnd || t.cost === 0) continue;
        const kind = moveKind({ move, dash }, t.cost);
        if (kind === 'move') walk.push(t.pos);
        else if (kind === 'dash') run.push(t.pos);
    }
    return { reach, move, dash, walk, run };
}

/** Which movement a path of `cost` half-steps is: the cheaper one that reaches. */
export function moveKind(range: Pick<MoveRange, 'move' | 'dash'>, cost: number): 'move' | 'dash' | undefined {
    if (range.move !== null && cost <= range.move) return 'move';
    if (range.dash !== null && cost <= range.dash) return 'dash';
    return undefined;
}

/** The command a tap on `to` gives: the cheapest path there, as a Move or a Dash by its cost. */
export function moveTo(range: MoveRange, member: Member, to: Pos): Command | undefined {
    const tile = reachAt(range.reach, to);
    if (!tile?.canEnd || tile.cost === 0) return undefined;
    const type = moveKind(range, tile.cost), path = pathTo(range.reach, to);
    return type && path ? { type, crew: member.id, path } : undefined;
}

/** A drawn path: a Move when it fits Move's budget, else a Dash; or the index of its first step neither allows. */
export function moveAlong(world: ReadonlyWorld, picture: State, member: Member, range: Pick<MoveRange, 'move' | 'dash'>, path: readonly Pos[]):
    { command: Command; badFrom?: undefined } | { command?: undefined; badFrom: number } {
    const budget = Math.max(range.move ?? 0, range.dash ?? 0);
    const check = validatePath(world, picture, member.pos, path, budget, planMoveOptions(world, picture, member));
    if (!check.ok) return { badFrom: check.at };
    const type = moveKind(range, check.cost);
    return type ? { command: { type, crew: member.id, path: path.map(p => ({ x: p.x, y: p.y })) } } : { badFrom: 0 };
}
