import { IllegalCommand, registerCommand, type Ctx } from '../../core/engine';
import { cornerEdges, edgeBetween, edgeKey, FACING_STEP, inBounds, tileAt } from '../../core/grid';
import { actorRefusal, crewMember, edgeNow, spendActions } from '../../core/state';
import type { Command, CommandOf, CommandType, CrewState, DeepReadonly, Pos, ReadonlyWorld, State, Tile } from '../../core/types';
import type { IllegalAct } from '../../data/matrix';
import { vehicleAt } from '../../geo/drive';
import { sightMap } from '../../geo/los';
import { applySightings, lookSightings, perceiveEnd, turnLookers, witness, witnessAct, type Sighting } from '../perceive';

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
 * 5. **Turning to its noise** (§8.9, decision 45): NPCs its noise sent to look turn now (`turnLookers`), so they
 *    witnessed the act as they stood before it, and see the crew as they face after it.
 * 6. **Ending an action in view** (§8.5): `perceiveEnd` on where the crew member stands, with what those who turned see
 *    of the rest of the crew.
 * 7. **Its rolls**, if it has any that a preview shows as a picture (`finish`: an attack's bullets): last, so its preview
 *    shows everything before them.
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
    /**
     * The illegal act it is (§8.4), if any, and the tiles it is seen on (default: the crew member's): anyone who sees
     * any of them witnesses it (a knockout is seen on the attacker's tile and the victim's).
     */
    illegal?: (world: ReadonlyWorld, state: State, cmd: DeepReadonly<CommandOf<K>>) => { act: IllegalAct; tiles?: Pos[] } | undefined;
    /** Does it (after the check and the spend). */
    run(ctx: Ctx, member: CrewState, cmd: CommandOf<K>): void;
    /**
     * What it does last, after the witnesses and the end of the action (step 7): the part that rolls, so that a preview,
     * which stops at the first roll, still shows everything decided before it (an attack's bullets, rules/actions/attack.ts).
     */
    finish?(ctx: Ctx, member: CrewState, cmd: CommandOf<K>): void;
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
        const reason = actorRefusal(member) ?? def.whyNot(ctx.world, ctx.state, cmd as DeepReadonly<CommandOf<K>>);
        if (reason) throw new IllegalCommand(reason);
        const illegal = def.illegal?.(ctx.world, ctx.state, cmd as DeepReadonly<CommandOf<K>>);
        const cost = def.cost(ctx.world, ctx.state, cmd as DeepReadonly<CommandOf<K>>);
        spendActions(member, cost);
        def.run(ctx, member, cmd);
        if (illegal) witnessActOn(ctx, member.id, illegal.act, illegal.tiles ?? [member.pos]);
        // Anyone its noise sent to look turns now, after the act was witnessed, and sees.
        const turned = turnLookers(ctx);
        // An action that spent nothing (waiting with none left) ends nothing in view.
        if (perceive && cost > 0) perceiveEnd(ctx, member.id, turned);
        else if (turned.size) applySightings(ctx, lookSightings(ctx.world, ctx.state, sightMap(ctx.world, ctx.state), turned));
        def.finish?.(ctx, member, cmd);
    }, options.replace ? { replace: true } : {});
    ACTIONS.set(type, {
        whyNot: def.whyNot as Entry['whyNot'],
        ...(def.candidates ? { candidates: def.candidates as Entry['candidates'] } : {})
    });
}

/**
 * The sightings of an illegal act seen on any of `tiles` (§8.4): each observer once, at the first tile it sees. Pure;
 * `witnessActOn` applies exactly this.
 */
export function witnessOn(world: ReadonlyWorld, state: State, crewId: string, act: IllegalAct, tiles: readonly DeepReadonly<Pos>[]): Sighting[] {
    const sight = sightMap(world, state), out: Sighting[] = [], seen = new Set<string>();
    for (const tile of tiles) {
        for (const s of witness(world, state, sight, crewId, act, { x: tile.x, y: tile.y })) {
            if (seen.has(s.observer)) continue;
            seen.add(s.observer);
            out.push(s);
        }
    }
    return out;
}

/** An illegal act seen on any of `tiles`: every observer who sees one of them Exposes the crew member. */
export function witnessActOn(ctx: Ctx, crewId: string, act: IllegalAct, tiles: readonly DeepReadonly<Pos>[]): void {
    if (tiles.length === 1) return witnessAct(ctx, crewId, act, { x: tiles[0]!.x, y: tiles[0]!.y });
    applySightings(ctx, witnessOn(ctx.world, ctx.state, crewId, act, tiles));
}

/** Why a crew action command isn't allowed now (as its reducer would refuse it), or undefined. */
export function whyNot(world: ReadonlyWorld, state: State, cmd: DeepReadonly<Command>): string | undefined {
    const entry = ACTIONS.get(cmd.type);
    if (!entry) return undefined;
    const member = state.crew.find(c => c.id === crewOf(cmd));
    if (!member) return `No crew member '${crewOf(cmd)}'`;
    return actorRefusal(member) ?? entry.whyNot(world, state, cmd);
}

/**
 * Every action command (besides moving) a crew member could give now and the rules allow: open or close a door
 * beside them, knock out an NPC next to them, drag, drop or stash a body, interact with an object in reach, wait. The
 * UI offers these; the random player of the property tests plays them. In action type order, then as each lists them.
 */
export function legalActions(world: ReadonlyWorld, state: State, crewId: string): Command[] {
    const member = state.crew.find(c => c.id === crewId);
    if (!member || actorRefusal(member)) return [];
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

/** Whether `a` and `b` (neighbours) are on one level: the same height, or a climb tile leading to the other (§14.7). */
function sameLevel(world: ReadonlyWorld, a: Pos, b: Pos): boolean {
    const ta = tileAt(world, a)!, tb = tileAt(world, b)!;
    if (ta.raised === tb.raised) return true;
    const leads = (t: DeepReadonly<Tile>, p: Pos, q: Pos): boolean => !!t.climb && p.x + FACING_STEP[t.climb.to].x === q.x && p.y + FACING_STEP[t.climb.to].y === q.y;
    return leads(ta, a, b) || leads(tb, b, a);
}

/** Whether a wall that blocks movement now stands on the edge between two orthogonal neighbours. */
const wallBetweenNow = (world: ReadonlyWorld, state: State, a: Pos, b: Pos): boolean => !!edgeNow(world, state, edgeKey(edgeBetween(a, b)))?.blocksMove;

/**
 * Whether someone on `from` can reach something on `to` with their hands (a person, a body, an object on a furniture
 * tile): the same tile, or a neighbour they could step to but for what stands there: no wall in between (for a
 * diagonal, none on the corner's four edges, like a diagonal step, §6.3) and on the same level (not across a storey's
 * ledge, only up or down a climb, §14.7). Furniture on `to` doesn't matter; a closed door or a pane of glass does, and
 * so does a crew vehicle on either tile.
 */
export function inReach(world: ReadonlyWorld, state: State, from: DeepReadonly<Pos>, to: DeepReadonly<Pos>): boolean {
    if (!inBounds(world, from) || !inBounds(world, to)) return false;
    // Nobody reaches into a crew vehicle or out of it: its doors are shut (decision 174). Only the crew aboard and its
    // hold stand on its footprint.
    if (vehicleAt(world, state, from) !== undefined || vehicleAt(world, state, to) !== undefined) return false;
    const dx = to.x - from.x, dy = to.y - from.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
    if (!dx && !dy) return true;
    const a = { x: from.x, y: from.y }, b = { x: to.x, y: to.y };
    if (!sameLevel(world, a, b)) return false;
    if (!dx || !dy) return !wallBetweenNow(world, state, a, b);
    return cornerEdges(a, b).every(e => !edgeNow(world, state, edgeKey(e))?.blocksMove);
}
