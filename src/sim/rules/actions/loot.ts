import { cornerEdges, edgeBetween, edgeKey, inBounds, tileAt } from '../../core/grid';
import { sortedIds } from '../../core/json';
import { registerRuleDefaults, registerStateInit } from '../../core/state';
import type { CrewState, DeepReadonly, Pos, ReadonlyWorld, State } from '../../core/types';
import { registerEvents } from '../../core/undo';
import { registerBudgetModifier, registerDashCheck, registerMoveHook } from '../../crew/movement';
import { BRUISER_CARRY_PENALTY, CARRY_WEIGHT, HEAVY_CARRY_PENALTY, HOSTAGE, POCKETS, THROW_RANGE, type CarryWeight } from '../../data/items';
import { HALF_STEPS_PER_TILE } from '../../data/movement';
import { attended, registerEvidenceSource, type Evidence } from '../evidence';
import { inHands, lootObject, lootWeight, syncHands } from '../hands';
import { doorDoubt, registerPreviewSecret } from '../knowledge';
import { inReach, lacksActions, registerAction } from './act';

/*
 * Loot and carrying (§15.1, §8.10). The bank's loot is the World's `loot` objects worth something (drawers, cash bags,
 * crates, the server drive rack: the generator's, `World.objects[].loot`); its live state is `State.loot`, by object id.
 *
 * - **Light** loot (a drawer's cash, jewels) is pocketed, up to `POCKETS` (2) stacks: no penalty, no change of profile,
 *   never thrown or passed, and put down only once a dye pack has ruined it.
 * - **Heavy** loot (a cash bag) is carried in the hands (`Loadout.carrying` 'lootBag', so Armed): −2 tiles per Move,
 *   no Dash. It can be thrown up to 2 tiles (1 action); a teammate standing where it lands with free hands catches it
 *   (free), and can throw it on: bags are **chained**.
 * - **Very heavy** loot (a gold crate, the drive rack: 'lootCrate') and a body (body.ts) halve the Move (a Bruiser's
 *   is one tile less), rule out the Dash and leave only a pistol in hand (command.ts Threat). They can't be thrown, only
 *   **passed** to a teammate in reach (1 action), as can a bag.
 * - **Taking** loot from where the bank keeps it is the illegal act 'takeLoot' (§8.4); picking a bag up off the floor
 *   isn't. A bag or a crate on the floor with no crew member beside it is major evidence (an unattended loot bag, §8.10).
 * - **Dye packs** (§15.1): a drawer the generator marks hides one. The player isn't told: unless the cash is inspected
 *   (1 action on a pocketed stack, which finds and removes it) the pack bursts once its carrier steps out of the
 *   building (`World.building`) and ruins that stack. Previews keep the find and the burst secret
 *   (`registerPreviewSecret`), but the first step that takes cash that may be dyed out (`mayBeDyed`: in a bank with
 *   dye packs, not known clean) is `cashOut`, shown and final whichever it was: such a move may be final for a reason
 *   the player can't know yet, so it is never offered as undoable. A stack that left without bursting is known clean.
 * - What the hands hold is `State.loot` and `CrewState.dragging`; `Loadout.carrying` follows them (rules/hands.ts).
 * - Loot behind a deposit box or its wall (`loot.behind`) is the heist's loot once opened (rules/vault.ts).
 * - A throw never passes a door the crew can't vouch for (decision 44), so its preview and its outcome can't differ.
 *
 * Commands: `takeLoot { crew, loot }`, `dropLoot { crew, loot? }` (the hands, or a ruined stack), `throwLoot { crew, to }`, `pass { crew, to }` (loot or a
 * body), `inspectLoot { crew, loot }`. A throw is decided before anything changes by `throwPlan`, which is also its
 * preview: where it lands and who catches it, nothing hidden and nothing rolled.
 */

/** Loot as the heist has it (§15.1). */
export interface LootState {
    /** The crew member who has it (pocketed when Light, in the hands otherwise), or null. */
    holder: string | null;
    /** Where it lies while nobody has it: where the bank keeps it until taken, then where it was dropped or landed. */
    pos: Pos;
    /** Taken from where the bank kept it. */
    taken: boolean;
    /** A dye pack still hides in it (the player isn't told). */
    dyePack: boolean;
    /** Known clean (§15.1): looked through (a dye pack in it found and taken out), or carried out without a burst. */
    inspected: boolean;
    /** Ruined by its dye pack: worth nothing. */
    ruined: boolean;
}

declare module '../../core/types' {
    interface State {
        /** The bank's loot by World object id (§15.1). */
        loot: Record<string, LootState>;
    }
    interface Rules {
        /**
         * Whether the bank's tier hides dye packs in its cash (§15.1, `worldFromBank`): what the player knows before
         * casing, so what a preview may go by, whichever stacks hold one.
         */
        dyePacks: boolean;
    }
    interface World {
        /** The rooms of the bank's building (§15.1: a dye pack bursts outside them). Absent: tiles in any room. */
        building?: string[];
    }
    interface CommandMap {
        /** Take loot in reach, from where the bank keeps it or off the floor (1 action): pocketed if Light, else in the hands. */
        takeLoot: { crew: string; loot: string };
        /** Put down the loot in the hands, or the ruined stack `loot`, where the crew member stands (1 action). */
        dropLoot: { crew: string; loot?: string };
        /** Throw the Heavy bag in the hands to `to`, up to 2 tiles (1 action): a teammate there with free hands catches it. */
        throwLoot: { crew: string; to: Pos };
        /** Hand what the hands carry (loot or a body) to the teammate `to` in reach, whose hands are free (1 action). */
        pass: { crew: string; to: string };
        /** Look through loot they have for a dye pack (1 action), and take it out. */
        inspectLoot: { crew: string; loot: string };
    }
    interface EventMap {
        lootTaken: { crew: string; loot: string; from: Pos };
        lootDropped: { crew: string; loot: string; at: Pos };
        /** A bag thrown from `from` to `to`, caught there by `caughtBy` or landed on the floor. */
        lootThrown: { crew: string; loot: string; from: Pos; to: Pos; caughtBy: string | null };
        lootPassed: { crew: string; to: string; loot: string };
        bodyPassed: { crew: string; to: string; npc: string };
        lootInspected: { crew: string; loot: string };
        /**
         * Uninspected cash left the building with its carrier at `at` (§15.1): whether it hid a dye pack is told by a
         * burst a preview doesn't show, so this, which a preview shows, makes the move final either way.
         */
        cashOut: { crew: string; loot: string; at: Pos };
        /** Inspecting found a dye pack and took it out. A preview never shows it. */
        dyePackFound: { crew: string; loot: string };
        /** A dye pack burst as its carrier left the building, ruining the stack. A preview never shows it. */
        dyePackBurst: { crew: string; loot: string; at: Pos };
    }
}

registerRuleDefaults({ dyePacks: false });

registerStateInit('loot', (world, state) => {
    state.loot = {};
    for (const o of world.objects) {
        // Worth nothing (the manager's PC, keys, files) or behind a deposit box or its wall: not loot until opened (vault.ts).
        if (o.kind !== 'loot' || !o.loot || o.loot.value <= 0 || o.loot.behind) continue;
        state.loot[o.id] = { holder: null, pos: { x: o.pos.x, y: o.pos.y }, taken: false, dyePack: !!o.loot.dyePack, inspected: false, ruined: false };
    }
});

/** The loot a crew member has, by id: pocketed and in the hands. */
export const lootOf = (state: DeepReadonly<State>, crewId: string): string[] => sortedIds(state.loot).filter(id => state.loot[id]!.holder === crewId);

/** The Light stacks a crew member has pocketed. */
export const pocketed = (world: ReadonlyWorld, state: DeepReadonly<State>, crewId: string): string[] =>
    lootOf(state, crewId).filter(id => lootWeight(world, id) === 'light');

/** How heavy what a crew member carries in the hands is (a bag, a crate, a body), or null. */
const carryWeight = (member: DeepReadonly<CrewState>): Exclude<CarryWeight, 'light'> | null =>
    (member.loadout.carrying !== null && Object.hasOwn(CARRY_WEIGHT, member.loadout.carrying) ? CARRY_WEIGHT[member.loadout.carrying]! : null);

/** Whether a crew member's hands are free: nothing carried, no body dragged. */
export const handsFree = (member: DeepReadonly<CrewState>): boolean => member.loadout.carrying === null && member.dragging === null;

/** Whether a tile is inside the bank's building (§15.1). */
export function inBuilding(world: ReadonlyWorld, p: DeepReadonly<Pos>): boolean {
    const room = tileAt(world, p)?.room ?? null;
    if (room === null) return false;
    return world.building ? world.building.includes(room) : true;
}

// ---------------------------------------------------------------------------------------------------------- Carrying

// Heavy: −2 tiles a Move (the Dash is ruled out); Very heavy: half, rounded down in half-steps, or a Bruiser's −1 tile.
// Leading a hostage (actions/hostage.ts): half, for everyone, and nothing else (§10.6 "at half movement").
registerBudgetModifier('carrying', (_world, member, _mode, budget) => {
    if (member.loadout.carrying === HOSTAGE) return Math.floor(budget / 2);
    const weight = carryWeight(member);
    if (weight === 'heavy') return Math.max(0, budget - HEAVY_CARRY_PENALTY * HALF_STEPS_PER_TILE);
    if (weight !== 'very heavy') return budget;
    return member.traits.includes('bruiser') ? Math.max(0, budget - BRUISER_CARRY_PENALTY * HALF_STEPS_PER_TILE) : Math.floor(budget / 2);
});

registerDashCheck('carrying', m => {
    if (m.loadout.carrying === HOSTAGE) return undefined;
    if (m.dragging !== null) return `${m.name} can't dash dragging a body`;
    return carryWeight(m) ? `${m.name} can't dash carrying ${m.loadout.carrying === 'lootBag' ? 'a bag' : 'a crate'}` : undefined;
});

// ---------------------------------------------------------------------------------------------------------- Taking

function takeBlocked(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, id: string): string | undefined {
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    if (!Object.hasOwn(state.loot, id)) return `There is no loot called '${id}'`;
    const loot = state.loot[id]!;
    if (loot.holder !== null) return loot.holder === member.id ? `${member.name} has it already` : 'A teammate has it';
    if (loot.ruined) return 'The dye has ruined it';
    if (!inReach(world, state, member.pos, loot.pos)) return `${member.name} can't reach it from here`;
    if (lootWeight(world, id) === 'light') return pocketed(world, state, member.id).length >= POCKETS ? `${member.name}'s pockets are full` : undefined;
    return handsFree(member) ? undefined : `${member.name}'s hands are full`;
}

registerAction('takeLoot', {
    whyNot: (world, state, cmd) => takeBlocked(world, state, state.crew.find(c => c.id === cmd.crew)!, cmd.loot),
    candidates: (_world, state, member) => sortedIds(state.loot).filter(id => state.loot[id]!.holder === null && !state.loot[id]!.ruined).map(id => ({ type: 'takeLoot', crew: member.id, loot: id })),
    cost: () => 1,
    // Taking it from where the bank keeps it is theft; a bag off the floor only shows in the hands.
    illegal: (_world, state, cmd) => (state.loot[cmd.loot]!.taken ? undefined : { act: 'takeLoot' }),
    run(ctx, member, cmd) {
        const loot = ctx.state.loot[cmd.loot]!;
        const from = { x: loot.pos.x, y: loot.pos.y };
        loot.holder = member.id;
        loot.taken = true;
        syncHands(ctx.world, ctx.state, member);
        ctx.emit({ type: 'lootTaken', crew: member.id, loot: cmd.loot, from });
    }
});

/** What `dropLoot` puts down: the named ruined stack, else what the hands hold; or why it can't. */
function dropped(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, id: string | undefined): string | { id: string } {
    if (id === undefined) {
        const held = inHands(world, state, member.id);
        return held === undefined ? `${member.name} has nothing in their hands to put down` : { id: held };
    }
    const loot = Object.hasOwn(state.loot, id) ? state.loot[id]! : undefined;
    if (loot?.holder !== member.id) return `${member.name} doesn't have it`;
    // Cash stays pocketed (§15.1) unless the dye has ruined it: then it is only a weight.
    if (lootWeight(world, id) === 'light' && !loot.ruined) return 'Cash stays in the pocket';
    return { id };
}

registerAction('dropLoot', {
    whyNot(world, state, cmd) {
        const member = state.crew.find(c => c.id === cmd.crew)!;
        const what = dropped(world, state, member, cmd.loot);
        return lacksActions(member, 1) ?? (typeof what === 'string' ? what : undefined);
    },
    candidates: (_world, state, member) => [
        { type: 'dropLoot' as const, crew: member.id },
        ...lootOf(state, member.id).filter(id => state.loot[id]!.ruined).map(id => ({ type: 'dropLoot' as const, crew: member.id, loot: id }))
    ],
    cost: () => 1,
    run(ctx, member, cmd) {
        const { id } = dropped(ctx.world, ctx.state, member, cmd.loot) as { id: string }, loot = ctx.state.loot[id]!;
        loot.holder = null;
        loot.pos = { x: member.pos.x, y: member.pos.y };
        syncHands(ctx.world, ctx.state, member);
        ctx.emit({ type: 'lootDropped', crew: member.id, loot: id, at: { x: member.pos.x, y: member.pos.y } });
    }
});

// ---------------------------------------------------------------------------------------------------------- Throwing

/** A throw as it will happen (§15.1): the bag, where it flies from and to, and the teammate who catches it, if any. */
export interface ThrowPlan {
    loot: string;
    from: Pos;
    to: Pos;
    /** The teammate standing on `to` with free hands, who catches it; null: it lands on the floor there. */
    catcher: string | null;
}

/**
 * Whether a bag thrown from `from` flies to `to`: within `THROW_RANGE` (Euclidean, decision 53), every hop as a hand
 * reaches (no wall, closed door or glass between, on one level, `inReach`), over low furniture but not over anything
 * tall, landing on a tile one could stand on.
 */
function throwFlies(world: ReadonlyWorld, state: State, from: DeepReadonly<Pos>, to: DeepReadonly<Pos>): boolean {
    const dx = to.x - from.x, dy = to.y - from.y, d2 = dx * dx + dy * dy;
    if (!d2 || d2 > THROW_RANGE * THROW_RANGE || !inBounds(world, to) || tileAt(world, to)!.blocksMove) return false;
    if (Math.max(Math.abs(dx), Math.abs(dy)) === 1) return inReach(world, state, from, to);
    // Two tiles in a straight line: over the tile between.
    const mid = { x: from.x + dx / 2, y: from.y + dy / 2 };
    return !tileAt(world, mid)!.tall && inReach(world, state, from, mid) && inReach(world, state, mid, to);
}

/** The edges a throw from `from` to `to` (in range: one step, or two in a line) crosses: each hop's, a diagonal's corner. */
function flightEdges(from: DeepReadonly<Pos>, to: DeepReadonly<Pos>): string[] {
    const a = { x: from.x, y: from.y }, b = { x: to.x, y: to.y }, dx = b.x - a.x, dy = b.y - a.y;
    if (dx && dy) return cornerEdges(a, b).map(edgeKey);
    if (Math.abs(dx) + Math.abs(dy) === 1) return [edgeKey(edgeBetween(a, b))];
    const mid = { x: a.x + dx / 2, y: a.y + dy / 2 };
    return [edgeKey(edgeBetween(a, mid)), edgeKey(edgeBetween(mid, b))];
}

/** Where a crew member's bag goes thrown to `to`, or why it can't be (whatever actions they have left). */
function aim(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, to: DeepReadonly<Pos>): ThrowPlan | string {
    const id = inHands(world, state, member.id);
    if (id === undefined) return `${member.name} has no bag to throw`;
    if (lootWeight(world, id) !== 'heavy') return 'Only a bag can be thrown: pass a crate to a teammate';
    const dx = to.x - member.pos.x, dy = to.y - member.pos.y, d2 = dx * dx + dy * dy;
    if (!d2 || d2 > THROW_RANGE * THROW_RANGE || !inBounds(world, to)) return `A bag can't be thrown that far`;
    // Never past a door the crew can't vouch for (decision 44): how it stands would decide the throw, and the preview.
    const doubt = doorDoubt(world, state);
    if (doubt && flightEdges(member.pos, to).some(k => !!world.edges[k]?.door && doubt.doors.has(world.edges[k]!.door!))) {
        return `${member.name} can't see the door the bag would fly through`;
    }
    if (!throwFlies(world, state, member.pos, to)) return `A bag can't be thrown there from where ${member.name} stands`;
    const mate = state.crew.find(c => c.id !== member.id && c.pos.x === to.x && c.pos.y === to.y);
    return { loot: id, from: { x: member.pos.x, y: member.pos.y }, to: { x: to.x, y: to.y }, catcher: mate && handsFree(mate) ? mate.id : null };
}

/**
 * The throw a command makes, or why it can't be made. The reducer applies exactly this (paying its action changes
 * nothing it depends on); it is also its preview.
 */
export function throwPlan(world: ReadonlyWorld, state: State, cmd: DeepReadonly<{ crew: string; to: Pos }>): ThrowPlan | string {
    const member = state.crew.find(c => c.id === cmd.crew);
    if (!member) return `No crew member '${cmd.crew}'`;
    return lacksActions(member, 1) ?? aim(world, state, member, cmd.to);
}

/** The tiles a crew member could throw the bag in their hands to now, in row order. */
export function throwTargets(world: ReadonlyWorld, state: State, crewId: string): Pos[] {
    const member = state.crew.find(c => c.id === crewId);
    if (!member) return [];
    const out: Pos[] = [];
    for (let dy = -THROW_RANGE; dy <= THROW_RANGE; dy++) {
        for (let dx = -THROW_RANGE; dx <= THROW_RANGE; dx++) {
            const to = { x: member.pos.x + dx, y: member.pos.y + dy };
            if (typeof throwPlan(world, state, { crew: crewId, to }) !== 'string') out.push(to);
        }
    }
    return out;
}

registerAction('throwLoot', {
    whyNot(world, state, cmd) {
        const plan = throwPlan(world, state, cmd);
        return typeof plan === 'string' ? plan : undefined;
    },
    candidates: (world, state, member) => (inHands(world, state, member.id) === undefined ? [] : throwTargets(world, state, member.id).map(to => ({ type: 'throwLoot', crew: member.id, to }))),
    cost: () => 1,
    run(ctx, member, cmd) {
        const plan = aim(ctx.world, ctx.state, member, cmd.to);
        if (typeof plan === 'string') throw new Error(`A throw checked and paid for failed: ${plan}`);
        const loot = ctx.state.loot[plan.loot]!;
        loot.holder = plan.catcher;
        if (plan.catcher === null) loot.pos = { ...plan.to };
        syncHands(ctx.world, ctx.state, member);
        if (plan.catcher !== null) syncHands(ctx.world, ctx.state, ctx.state.crew.find(c => c.id === plan.catcher)!);
        ctx.emit({ type: 'lootThrown', crew: member.id, loot: plan.loot, from: plan.from, to: plan.to, caughtBy: plan.catcher });
    }
});

// ---------------------------------------------------------------------------------------------------------- Passing

function passBlocked(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, to: string): string | undefined {
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    if (member.dragging === null && inHands(world, state, member.id) === undefined) return `${member.name} has nothing in their hands to pass`;
    const mate = state.crew.find(c => c.id === to);
    if (!mate || mate.id === member.id) return `No teammate called '${to}'`;
    if (!handsFree(mate)) return `${mate.name}'s hands are full`;
    return inReach(world, state, member.pos, mate.pos) ? undefined : `${mate.name} is out of reach`;
}

registerAction('pass', {
    whyNot: (world, state, cmd) => passBlocked(world, state, state.crew.find(c => c.id === cmd.crew)!, cmd.to),
    candidates: (world, state, member) => (member.dragging === null && inHands(world, state, member.id) === undefined
        ? []
        : state.crew.filter(c => c.id !== member.id).map(c => ({ type: 'pass' as const, crew: member.id, to: c.id }))),
    cost: () => 1,
    // Handing over a body is dragging it, seen on both of them (§8.4, decision 27).
    illegal(_world, state, cmd) {
        const member = state.crew.find(c => c.id === cmd.crew)!, mate = state.crew.find(c => c.id === cmd.to)!;
        if (member.dragging === null) return undefined;
        return { act: member.loadout.carrying === HOSTAGE ? 'command' : 'dragBody', tiles: [member.pos, mate.pos] };
    },
    run(ctx, member, cmd) {
        const mate = ctx.state.crew.find(c => c.id === cmd.to)!, npc = member.dragging, id = inHands(ctx.world, ctx.state, member.id);
        if (npc !== null) {
            mate.dragging = npc;
            mate.leading = member.leading;
            member.dragging = null;
            member.leading = false;
        } else ctx.state.loot[id!]!.holder = mate.id;
        syncHands(ctx.world, ctx.state, member);
        syncHands(ctx.world, ctx.state, mate);
        ctx.emit(npc !== null ? { type: 'bodyPassed', crew: member.id, to: mate.id, npc } : { type: 'lootPassed', crew: member.id, to: mate.id, loot: id! });
    }
});

// ---------------------------------------------------------------------------------------------------------- Dye packs

registerAction('inspectLoot', {
    whyNot(world, state, cmd) {
        const member = state.crew.find(c => c.id === cmd.crew)!;
        const lack = lacksActions(member, 1);
        if (lack) return lack;
        const loot = Object.hasOwn(state.loot, cmd.loot) ? state.loot[cmd.loot]! : undefined;
        if (loot?.holder !== member.id) return `${member.name} doesn't have it`;
        if (lootWeight(world, cmd.loot) !== 'light') return 'Only a stack of cash can hide a dye pack';
        if (loot.ruined) return 'The dye pack has ruined it';
        return loot.inspected ? 'It is known to be clean' : undefined;
    },
    candidates: (world, state, member) => pocketed(world, state, member.id).map(id => ({ type: 'inspectLoot', crew: member.id, loot: id })),
    cost: () => 1,
    run(ctx, member, cmd) {
        const loot = ctx.state.loot[cmd.loot]!;
        loot.inspected = true;
        ctx.emit({ type: 'lootInspected', crew: member.id, loot: cmd.loot });
        if (!loot.dyePack) return;
        loot.dyePack = false;
        ctx.emit({ type: 'dyePackFound', crew: member.id, loot: cmd.loot });
    }
});

/**
 * Whether a stack might still hide a dye pack as far as the player can tell (§15.1): taken cash in a bank with dye
 * packs, neither known clean (`inspected`: looked through, or carried out once without a burst) nor ruined. Carrying it
 * out of the building makes a move final, burst or not (`cashOut`); the view can mark it.
 */
export function mayBeDyed(world: ReadonlyWorld, state: DeepReadonly<State>, id: string): boolean {
    const loot = state.loot[id]!;
    return loot.taken && !loot.inspected && !loot.ruined && lootWeight(world, id) === 'light' && world.rules.dyePacks;
}

/**
 * The cash that may be dyed (`mayBeDyed`) a crew member would carry out of the building along `path` from `from`: all of
 * it once a step leaves the building, none otherwise. For a move the preview cuts at a door that could refuse it
 * (knowledge.ts `doubtedCut`), whose `cashOut` beyond the door no preview shows; it reads only the path and what the
 * player knows of the stacks, so dyed and clean cash read the same.
 */
export function carriedOut(world: ReadonlyWorld, state: DeepReadonly<State>, crewId: string, from: DeepReadonly<Pos>, path: readonly DeepReadonly<Pos>[]): string[] {
    let prev = from;
    for (const p of path) {
        if (inBuilding(world, prev) && !inBuilding(world, p)) return lootOf(state, crewId).filter(id => mayBeDyed(world, state, id));
        prev = p;
    }
    return [];
}

// Stepping out of the building with cash that may be dyed: `cashOut` for each such stack; a hidden pack bursts and ruins
// it (§15.1), and a stack without one is known clean from then on. Either way the stack is settled at its first way
// out, so `cashOut` comes once per stack whichever it was: a preview of any path tells dyed cash from clean by nothing.
registerMoveHook('loot', {
    step(ctx, member, path, index, _mode, from) {
        const at = path[index]!, before = index > 0 ? path[index - 1]! : from;
        if (inBuilding(ctx.world, at) || !inBuilding(ctx.world, before)) return;
        for (const id of lootOf(ctx.state, member.id)) {
            if (!mayBeDyed(ctx.world, ctx.state, id)) continue;
            ctx.emit({ type: 'cashOut', crew: member.id, loot: id, at: { x: at.x, y: at.y } });
            const loot = ctx.state.loot[id]!;
            if (!loot.dyePack) {
                loot.inspected = true;
                continue;
            }
            loot.dyePack = false;
            loot.ruined = true;
            ctx.emit({ type: 'dyePackBurst', crew: member.id, loot: id, at: { x: at.x, y: at.y } });
        }
    }
});

// The player isn't told of a dye pack until it is found or bursts: a preview shows neither.
registerPreviewSecret('dyePackFound');
registerPreviewSecret('dyePackBurst');

// ---------------------------------------------------------------------------------------------------------- Evidence

// A bag or a crate on the floor with nobody of the crew beside it is an unattended loot bag (§8.10); a ruined stack of
// cash put down is only litter.
registerEvidenceSource('loot', (world, state) => sortedIds(state.loot).flatMap((id): Evidence[] => {
    const loot = state.loot[id]!;
    if (loot.holder !== null || !loot.taken || lootWeight(world, id) === 'light' || attended(state, loot.pos)) return [];
    return [{ id: `loot:${id}`, kind: 'lootBag', tiles: [{ x: loot.pos.x, y: loot.pos.y }] }];
}));

// ---------------------------------------------------------------------------------------------------------- Value

/** What the crew has of the loot (§15.1, §15.5): the value it carries, and what dye packs ruined. */
export function crewLoot(world: ReadonlyWorld, state: DeepReadonly<State>): { carried: number; ruined: number } {
    let carried = 0, ruined = 0;
    for (const id of sortedIds(state.loot)) {
        const loot = state.loot[id]!, value = lootObject(world, id).loot.value;
        if (loot.holder === null) continue;
        if (loot.ruined) ruined += value;
        else carried += value;
    }
    return { carried, ruined };
}

registerEvents({
    // Nothing about anyone changes unseen: taking, putting down, throwing and passing can be taken back.
    lootTaken: { undoBlocking: false },
    lootDropped: { undoBlocking: false },
    lootThrown: { undoBlocking: false },
    lootPassed: { undoBlocking: false },
    bodyPassed: { undoBlocking: false },
    // What inspecting finds, or a burst, tells the player something.
    lootInspected: { undoBlocking: true },
    cashOut: { undoBlocking: true },
    dyePackFound: { undoBlocking: true },
    dyePackBurst: { undoBlocking: true }
});
