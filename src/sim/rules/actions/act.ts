import { IllegalCommand, registerCommand, type Ctx } from '../../core/engine';
import { cornerEdges, edgeBetween, edgeKey, inBounds } from '../../core/grid';
import { crewMember, edgeNow, spendActions } from '../../core/state';
import type { Command, CommandOf, CommandType, CrewState, DeepReadonly, Pos, ReadonlyWorld, State } from '../../core/types';
import type { IllegalAct } from '../../data/matrix';
import { perceiveEnd, witnessAct } from '../perceive';

/*
 * The crew phase's bookkeeping (§6.1, §6.3): every crew member has `rules.actionsPerTurn` (2) actions a turn, spent in
 * any order and interleaved between crew members (Jun, then Mara, then Jun again); the world phase gives them back
 * (engine.ts `crew.actions`). Actions are spent only through `spendActions` (core/state.ts), and every action command
 * but Move and Dash (crew/movement.ts, whose perception is the move hook's) is registered with `registerAction`, whose
 * reducer always takes the same steps:
 *
 * 1. **Legality before anything else** (`whyNot`): a command the rules don't allow throws `IllegalCommand` before it
 *    changes anything or rolls a die, so a preview and the commit refuse alike. Each action registers its check with
 *    `registerAction`, which is also what `legalActions` asks: the UI offers exactly the commands that would pass.
 * 2. **Spend** the action's cost (`spendActions`).
 * 3. **Do it.**
 * 4. **Witnesses** (§8.4): an illegal act is `!` for everyone who sees it, Core or Peripheral (`witnessAct`), on the
 *    state after the act (a knocked-out guard doesn't witness its own knockout).
 * 5. **Ending an action in view** (§8.5): `perceiveEnd` on where the crew member stands.
 *
 * What NPCs witness is recorded at once but acted on only in the world phase (§6.2): perception rewrites their intents
 * now, and a witness dropped in the same crew phase never acts (its intent is cleared, knockout.ts).
 */

/** One action: whether it is allowed now (a reason when it isn't), and what it does once allowed and paid for. */
export interface ActionDef<K extends CommandType> {
    /** Why the command isn't allowed now, or undefined. Pure: the reducer and `legalActions` both ask it. */
    whyNot(world: ReadonlyWorld, state: State, cmd: DeepReadonly<CommandOf<K>>): string | undefined;
    /** Every command of this type the crew member could try now (the candidates `legalActions` filters). */
    candidates?(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>): CommandOf<K>[];
    /** Actions it costs. */
    cost(world: ReadonlyWorld, state: State, cmd: DeepReadonly<CommandOf<K>>): number;
    /** The illegal act it is (§8.4), if any, and where it is seen (default: the crew member's tile). */
    illegal?: (world: ReadonlyWorld, state: State, cmd: DeepReadonly<CommandOf<K>>) => { act: IllegalAct; tile?: Pos } | undefined;
    /** Does it (after the check and the spend). */
    run(ctx: Ctx, member: CrewState, cmd: CommandOf<K>): void;
}

interface Entry {
    whyNot: ActionDef<CommandType>['whyNot'];
    candidates?: ActionDef<CommandType>['candidates'];
}

const ACTIONS = new Map<string, Entry>();

/** Which crew member a command is for (every action command has `crew`). */
const crewOf = (cmd: DeepReadonly<Command>): string => (cmd as { crew?: string }).crew ?? '';

/**
 * Registers a crew action command: its reducer runs the steps of the header in order. `options.perceive` false leaves
 * the end-of-action check to the action itself.
 */
export function registerAction<K extends CommandType>(type: K, def: ActionDef<K>, options: { perceive?: boolean; replace?: boolean } = {}): void {
    const perceive = options.perceive ?? true;
    registerCommand(type, (ctx, cmd) => {
        const member = crewMember(ctx.state, crewOf(cmd as DeepReadonly<Command>));
        const reason = def.whyNot(ctx.world, ctx.state, cmd as DeepReadonly<CommandOf<K>>);
        if (reason) throw new IllegalCommand(reason);
        const illegal = def.illegal?.(ctx.world, ctx.state, cmd as DeepReadonly<CommandOf<K>>);
        const cost = def.cost(ctx.world, ctx.state, cmd as DeepReadonly<CommandOf<K>>);
        spendActions(member, cost);
        def.run(ctx, member, cmd);
        if (illegal) witnessAct(ctx, member.id, illegal.act, illegal.tile);
        // An action that spent nothing (waiting with none left) ends nothing in view.
        if (perceive && cost > 0) perceiveEnd(ctx, member.id);
    }, options.replace ? { replace: true } : {});
    ACTIONS.set(type, {
        whyNot: def.whyNot as Entry['whyNot'],
        ...(def.candidates ? { candidates: def.candidates as Entry['candidates'] } : {})
    });
}

/** Why a crew action command isn't allowed now (as its reducer would refuse it), or undefined. */
export function whyNot(world: ReadonlyWorld, state: State, cmd: DeepReadonly<Command>): string | undefined {
    const entry = ACTIONS.get(cmd.type);
    if (!entry) return undefined;
    const member = state.crew.find(c => c.id === crewOf(cmd));
    if (!member) return `No crew member '${crewOf(cmd)}'`;
    return entry.whyNot(world, state, cmd);
}

/**
 * Every action command (besides moving) a crew member could give now and the rules allow: open or close a door
 * beside them, knock out an NPC next to them, drag, drop or stash a body, interact with an object in reach, wait. The
 * UI offers these; the random player of the property tests plays them. In action type order, then as each lists them.
 */
export function legalActions(world: ReadonlyWorld, state: State, crewId: string): Command[] {
    const member = state.crew.find(c => c.id === crewId);
    if (!member) return [];
    const out: Command[] = [];
    for (const type of [...ACTIONS.keys()].sort()) {
        const entry = ACTIONS.get(type)!;
        for (const cmd of entry.candidates?.(world, state, member) ?? []) if (!entry.whyNot(world, state, cmd)) out.push(cmd);
    }
    return out;
}

/** Whether a crew member has at least `cost` actions left: the first check of every action. */
export function lacksActions(member: DeepReadonly<CrewState>, cost: number): string | undefined {
    return member.actionsLeft < cost ? `${member.name} has ${member.actionsLeft} of ${cost} actions left` : undefined;
}

/** Whether a wall that blocks movement now stands on the edge between two orthogonal neighbours. */
const wallBetweenNow = (world: ReadonlyWorld, state: State, a: Pos, b: Pos): boolean => !!edgeNow(world, state, edgeKey(edgeBetween(a, b)))?.blocksMove;

/**
 * Whether someone on `from` can reach something on `to` with their hands (a person, a body, an object on a furniture
 * tile): the same tile, or a neighbour with no wall in between (for a diagonal, none on the corner's four edges, like
 * a diagonal step, §6.3). Furniture on `to` doesn't matter; a closed door or a pane of glass does.
 */
export function inReach(world: ReadonlyWorld, state: State, from: DeepReadonly<Pos>, to: DeepReadonly<Pos>): boolean {
    if (!inBounds(world, from) || !inBounds(world, to)) return false;
    const dx = to.x - from.x, dy = to.y - from.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
    if (!dx && !dy) return true;
    const a = { x: from.x, y: from.y }, b = { x: to.x, y: to.y };
    if (!dx || !dy) return !wallBetweenNow(world, state, a, b);
    return cornerEdges(a, b).every(e => !edgeNow(world, state, edgeKey(e))?.blocksMove);
}
