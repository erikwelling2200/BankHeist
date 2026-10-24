import { registerWorldHook, type Ctx } from '../core/engine';
import { samePos } from '../core/grid';
import { crewMember, registerCrewInit } from '../core/state';
import type { DeepReadonly, NpcState, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { panicWeights } from '../data/archetypes';
import { bandAt, crewObserver, fieldOn, npcObserver, type SightField } from '../geo/cones';
import { sightMap, type SightMap } from '../geo/los';
import { reachable } from '../geo/move';
import { inReach, lacksActions, registerAction } from './actions/act';
import { raiseCarrier, registerCarrierCheck } from './carriers';
import { commandNpc, wayOut } from './command';
import { registerPreviewSecret } from './knowledge';
import { reconsider } from './npc/intent';
import { canWalkTo, isPresent, npcMoveOptions, othersTiles, paceBudget, personOf } from './npc/walk';
import { isEyesDown } from './suspicion';
import { canPanic, panicNpc, startPanic, type Panic, type PanicReaction } from './panicState';

/*
 * Panic and the armed civilians (§10.8, §10.9, §16.2 panic weights, §16.4 passers-by, §9.1 the escapee and phone
 * carriers). M2-01's lapses use the same reactions (rules/command.ts).
 *
 * - **Who panics:** civilians (`canPanic`: up, on the map, not face down, not Hostile or already acting on a lapse).
 *   Staff and guards don't: they are Alerted and raise the alarm by role (§10.1). A civilian **panics** when it hears a
 *   loud noise (the hearing hook, rules/evidence.ts: the command shout's panic ring among them) or Exposes a crew member
 *   (what it saw is violence or a crime: suspicion.ts `expose`). Panicking it is Alerted too, drops what it was doing and
 *   stands frozen facing the fright (goal `panic`, the `panicked` badge, §16.5 sweat drops): `NpcState.panic`.
 * - **Spreading** (§10.8): in each world phase, after the walks, a civilian within 3 tiles (Euclidean, r² ≤ 9) of one who
 *   panicked before that world phase, and who sees them (its own sight field), panics too. Judged on the state after
 *   the walks, all at once: panic spreads one ring a world phase.
 * - **The reaction** is picked as the next crew phase begins (the `crewPhase` step, after the lapses: the world phase's
 *   last word, so previews of the world phase stop cleanly before it), shown at once as the intent, and carried out in
 *   the world phase after: a newly panicked NPC never acts in the world phase it panicked in or the one before it was
 *   shown. Odds by archetype (`reactionOdds`, data/archetypes.ts), one chance after another on the `panic` stream:
 *   - **Cower:** stays where it is (still Panicked, easy to command).
 *   - **Flee:** runs for the nearest way out (command.ts `wayOut`), as a lapse's flee: the escapee carrier starts as it
 *     sets off (max(2, ⌈path ÷ 8⌉)). No way out: it cowers.
 *   - **Hide:** runs to the nearest tile within a run (8 tiles) that no crew member sees (`hidingSpot`; none: it cowers)
 *     and, there and still unseen by the crew when it arrives, phones it in: a phone call carrier (2, a mobile, so a
 *     jammer pauses it). Seen as it arrives, it doesn't call: it picks again. Called, it cowers where it hid.
 *   - **Reach for weapon** (§10.9): an NPC with a hidden weapon (`NpcState.armed` 'hidden', the off-duty cop; a frisk
 *     takes it, rules/actions/hostage.ts) always reaches, panicked or lapsing: the intent shows for one world phase,
 *     then he draws and is Hostile (command.ts). No tells before that: he panics like anyone else and rolls his
 *     archetype's odds like anyone else (a preview stops at the same roll), then reaches whatever came up.
 *   - **Tackle** (§16.2 hero): a hero ("Bold", `PersonDef.hero`) next to a crew member (in reach) tackles them;
 *     otherwise he flees where others cower (his cower weight goes to flight). Carried out only if that crew member is
 *     still in reach when the world phase comes: they lose an action of the next crew phase (`CrewState.tackled`). He
 *     then picks again. Heroes resist commands like guards (§10.4, command.ts `isResister`).
 *   - A passer-by (§16.4) always flees.
 * - **Calming down:** a Commanded or tied NPC is no longer Panicked (`commandNpc`; face down otherwise, as intents are
 *   committed); one knocked out neither.
 * - **The escapee's counters** (§9.1): commanding or knocking out the runner (the source), **blocking its route** (a
 *   carrier check: no way to its exit with the crew standing where they stand counters it; the runner, finding the way
 *   blocked as it would set off again, gives up and cowers), and **tackling** it (`tackle { crew, npc }`: 1 action, in
 *   reach, on someone running for it; an illegal act seen on both tiles; it goes face down, Commanded by the tackler).
 *   Barricades and vehicles are M3–M4's.
 */

/** Every reaction a panic or a lapse can pick (§10.5, §10.8), as the odds name them. */
export type Reaction = 'cower' | 'flee' | 'hide' | 'alarm' | 'phone' | 'reach' | 'tackle';

declare module '../core/types' {
    interface CrewState {
        /** Tackled by a hero (§16.2): the turn whose crew phase they lose an action of, or null. */
        tackled: number | null;
    }
    interface CommandMap {
        /** Tackle someone running for it (§9.1 escapee): 1 action, in reach. They go face down. */
        tackle: { crew: string; npc: string };
    }
    interface IntentActionMap {
        /** Frozen with fright (§10.8): its reaction is picked as the next crew phase begins. */
        panic: Record<never, never>;
        /** Cowers where it is (§10.8). */
        cower: Record<never, never>;
        /** Hides out of the crew's sight at the end of its path, and phones it in if still unseen there (§10.8, §9.1). */
        hide: Record<never, never>;
        /** A hero tackles the crew member if they are still in reach (§16.2). */
        tackle: { crew: string };
    }
    interface EventMap {
        /** A panicked NPC picked its reaction (§10.8), shown from now on and carried out in the coming world phase. */
        panicReaction: { npc: string; reaction: Reaction };
        /** A hider reached its spot: `called` when it was out of the crew's sight and phoned it in. */
        hid: { npc: string; called: boolean };
        /** A crew member tackled a runner to the floor (§9.1). */
        tackled: { crew: string; npc: string };
        /** A hero tackled a crew member (§16.2): they lose an action of the next crew phase. */
        heroTackled: { npc: string; crew: string };
        /** A tackled crew member starts the crew phase an action short. */
        actionLost: { crew: string };
    }
}

registerCrewInit('panic', (_world, _start, member) => {
    member.tackled = null;
});

// What a panicked NPC will do is rolled, luck no preview promises: previews never tell it. Playback does, and the
// intent shows it.
registerPreviewSecret('panicReaction');

// ---------------------------------------------------------------------------------------------------------- Reactions

/**
 * The odds an NPC picks its reaction with (§10.5, §10.8, §16.2), each with its weight: an enforcer whose command lapses
 * reaches (or, disarmed, stays down); a hero next to a crew member tackles, and otherwise flees where others cower;
 * everyone else by the archetype's panic column (the staff's own special only in a lapse: staff don't panic). A hidden
 * weapon rolls these odds like anyone (no tells, §10.9), and then reaches whatever came up (`react`, command.ts).
 */
export function reactionOdds(world: ReadonlyWorld, state: State, npc: DeepReadonly<NpcState>): [Reaction, number][] {
    const person = personOf(world, npc.id), weights = panicWeights(person.role, person.observer);
    // An enforcer reaches for his weapon; one a frisk disarmed has nothing to reach for and stays down (decision 66).
    if (!weights) return [[npc.armed !== null ? 'reach' : 'cower', 1]];
    const hero = person.hero === true;
    if (hero && tackleTarget(world, state, npc)) return [['tackle', 1]];
    const options: [Reaction, number][] = [
        ['cower', hero ? 0 : weights.cower], ['flee', weights.flee + (hero ? weights.cower : 0)], ['hide', weights.hide], [weights.via ?? 'alarm', weights.special]
    ];
    return options.filter(([, w]) => w > 0);
}

/** Rolls one of the odds: one chance after another, each the share of what is left, so each is a shown chance (`Dice.odds`). */
export function rollReaction(ctx: Ctx, odds: readonly [Reaction, number][], stream: string, reason: (r: Reaction) => string): Reaction {
    let left = odds.reduce((sum, [, w]) => sum + w, 0);
    for (const [reaction, w] of odds) {
        if (w >= left || ctx.dice.odds(stream, w / left, reason(reaction))) return reaction;
        left -= w;
    }
    return odds[odds.length - 1]![0];
}

/** The crew member a hero next to them would tackle: the first by id in reach, or undefined. */
export function tackleTarget(world: ReadonlyWorld, state: State, npc: DeepReadonly<NpcState>): string | undefined {
    return [...state.crew].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).find(c => inReach(world, state, npc.pos, c.pos) && !samePos(c.pos, npc.pos))?.id;
}

/** Every crew member's sight (all round, crew range), for telling where nobody of the crew sees. */
function crewFields(world: ReadonlyWorld, state: State, sight: SightMap): SightField[] {
    return state.crew.map(c => fieldOn(sight, crewObserver(world, c)));
}

const unseenBy = (fields: readonly SightField[], p: DeepReadonly<Pos>): boolean => fields.every(f => bandAt(f, { x: p.x, y: p.y }) === null);

/**
 * Where a hider goes (§10.8 hide): the nearest tile it can run to in one world phase (8 tiles, by walking cost, then
 * row-major) that no crew member sees and nobody else stands on or is headed for; its own tile if nobody sees it there.
 * Undefined when there is none.
 */
export function hidingSpot(world: ReadonlyWorld, state: State, npc: DeepReadonly<NpcState>): Pos | undefined {
    const fields = crewFields(world, state, sightMap(world, state)), taken = othersTiles(world, state, npc.id);
    const reach = reachable(world, state, { x: npc.pos.x, y: npc.pos.y }, paceBudget(world, 'run'), npcMoveOptions(world, npc));
    const spot = reach.tiles.find(t => t.canEnd && !taken(t.pos.y * world.width + t.pos.x) && unseenBy(fields, t.pos));
    return spot && { x: spot.pos.x, y: spot.pos.y };
}

/**
 * Starts what a panic or a lapse picked (`reaction` of cower, flee, hide or tackle; reaching is command.ts's): the NPC
 * is Panicked with it. Flight without a way out, and hiding without a spot, cower. Returns what it does.
 */
export function startReaction(ctx: Ctx, npc: NpcState, reaction: 'cower' | 'flee' | 'hide' | 'tackle', crew: string | null): PanicReaction['kind'] {
    const { world, state } = ctx;
    const panic: Panic = npc.panic ?? startPanic(ctx, crew, npc.pos);
    npc.panic = panic;
    if (reaction === 'flee') {
        const out = wayOut(world, state, npc);
        if (out) {
            npc.lapse = { kind: 'flee', exit: out.exit };
            panic.reaction = { kind: 'flee' };
            return 'flee';
        }
    } else if (reaction === 'hide') {
        const spot = hidingSpot(world, state, npc);
        if (spot) {
            panic.reaction = { kind: 'hide', spot };
            return 'hide';
        }
    } else if (reaction === 'tackle') {
        const target = tackleTarget(world, state, npc);
        if (target) {
            panic.reaction = { kind: 'tackle', crew: target };
            return 'tackle';
        }
    }
    panic.reaction = { kind: 'cower' };
    return 'cower';
}

/** Picks a panicked NPC's reaction (see the header). */
function react(ctx: Ctx, npc: NpcState): void {
    const { world, state } = ctx;
    const rolled = rollReaction(ctx, reactionOdds(world, state, npc), 'panic', r => `panic ${npc.id} ${r}`);
    // The off-duty cop rolled like anyone, so no preview tells him apart; he reaches whatever came up (§10.9).
    const picked = npc.armed === 'hidden' ? 'reach' : rolled;
    if (picked === 'reach') {
        // §10.9: telegraphed for one world phase, then he draws (command.ts). A gunman isn't panicking any more.
        const crew = npc.panic!.crew ?? nearestCrew(state, npc);
        npc.panic = null;
        npc.lapse = { kind: 'reach', crew };
        ctx.emit({ type: 'panicReaction', npc: npc.id, reaction: 'reach' });
        return;
    }
    // Civilians have no special of their own (staff never panic): anything else cowers.
    const wanted = picked === 'flee' || picked === 'hide' || picked === 'tackle' ? picked : 'cower';
    ctx.emit({ type: 'panicReaction', npc: npc.id, reaction: startReaction(ctx, npc, wanted, npc.panic!.crew) });
}

/** The crew member nearest an NPC (Euclidean, then by id). */
function nearestCrew(state: State, npc: DeepReadonly<NpcState>): string {
    let best: { id: string; d: number } | undefined;
    for (const c of state.crew) {
        const dx = c.pos.x - npc.pos.x, dy = c.pos.y - npc.pos.y, d = dx * dx + dy * dy;
        if (!best || d < best.d || (d === best.d && c.id < best.id)) best = { id: c.id, d };
    }
    return best!.id;
}

// ---------------------------------------------------------------------------------------------------------- Escapees

/** Whether the crew, standing where they stand, block every way from a runner to its exit (or a tile next to it). */
export const routeBlocked = (world: ReadonlyWorld, state: State, npc: DeepReadonly<NpcState>, exit: DeepReadonly<Pos>): boolean => !canWalkTo(world, state, npc, exit);

// Block the route (§9.1): an escapee whose runner can't get to its exit past the crew is countered.
registerCarrierCheck('route', (world, state, carrier) => {
    if (carrier.kind !== 'escapee') return null;
    const npc = state.npcs.find(n => n.id === carrier.source);
    if (!npc || !isPresent(npc) || npc.lapse?.kind !== 'flee') return null;
    return routeBlocked(world, state as unknown as State, npc, npc.lapse.exit) ? { halt: 'countered', why: 'route blocked' } : null;
});

/** Why a crew member can't tackle this NPC now (§9.1), or undefined. */
export function tackleBlocked(world: ReadonlyWorld, state: State, crewId: string, npcId: string): string | undefined {
    const member = crewMember(state, crewId);
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    if (member.dragging !== null) return `${member.name}'s hands are full`;
    const npc = state.npcs.find(n => n.id === npcId);
    if (!npc) return `No one called '${npcId}'`;
    if (!isPresent(npc) || isEyesDown(npc) || npc.lapse?.kind !== 'flee') return 'Only someone running for it can be tackled';
    if (!inReach(world, state, member.pos, npc.pos)) return `${member.name} can't reach them from here`;
    return undefined;
}

registerAction('tackle', {
    whyNot: (world, state, cmd) => tackleBlocked(world, state, cmd.crew, cmd.npc),
    candidates: (_world, state, member) => state.npcs.filter(n => n.lapse?.kind === 'flee').map(n => ({ type: 'tackle', crew: member.id, npc: n.id })),
    cost: () => 1,
    // Seen on either tile, like a knockout.
    illegal: (_world, state, cmd) => ({
        act: 'attack',
        tiles: [crewMember(state, cmd.crew).pos, state.npcs.find(n => n.id === cmd.npc)!.pos].map(p => ({ x: p.x, y: p.y }))
    }),
    run(ctx, member, cmd) {
        const npc = ctx.state.npcs.find(n => n.id === cmd.npc)!;
        ctx.emit({ type: 'tackled', crew: member.id, npc: npc.id });
        commandNpc(ctx, npc, member.id, ctx.world.rules.commandPips);
    }
});

// ---------------------------------------------------------------------------------------------------------- The world phase

/** Whether a panic began before this world phase (it spreads from the world phase after it began). */
const before = (since: Panic['since'], turn: number): boolean => since.turn < turn || since.phase === 'crew';

/**
 * Hiding and a hero's tackle (see the header), from the intents frozen at the start of the world phase, after the walks
 * and with the other alarms (passiveNpcs order 5).
 */
registerWorldHook('passiveNpcs', 'panic.act', (ctx, phase) => {
    const { world, state } = ctx;
    let fields: SightField[] | undefined;
    for (const id of phase.passive) {
        const action = phase.intents[id]?.action;
        if (action?.kind !== 'hide' && action?.kind !== 'tackle') continue;
        const npc = state.npcs.find(n => n.id === id)!, reaction = npc.panic?.reaction;
        if (isEyesDown(npc) || !isPresent(npc) || !reaction) continue;
        if (action.kind === 'hide' && reaction.kind === 'hide') {
            if (!samePos(npc.pos, reaction.spot)) continue;
            fields ??= crewFields(world, state, sightMap(world, state));
            const called = unseenBy(fields, npc.pos);
            ctx.emit({ type: 'hid', npc: npc.id, called });
            if (called) {
                raiseCarrier(ctx, { kind: 'phoneCall', source: npc.id, pos: npc.pos, ...(npc.panic!.crew !== null ? { about: npc.panic!.crew } : {}) });
                npc.panic!.reaction = { kind: 'cower' };
            } else npc.panic!.reaction = null;
        } else if (action.kind === 'tackle' && reaction.kind === 'tackle' && reaction.crew === action.crew) {
            const member = state.crew.find(c => c.id === action.crew)!;
            npc.panic!.reaction = null;
            if (!inReach(world, state, npc.pos, member.pos)) continue;
            member.tackled = state.turn + 1;
            ctx.emit({ type: 'heroTackled', npc: npc.id, crew: member.id });
        }
    }
}, { order: 5 });

// Panic spreads (§10.8), after the walks and what the NPCs did at their ends: one ring a world phase.
registerWorldHook('passiveNpcs', 'panic.spread', (ctx, phase) => {
    const { world, state } = ctx;
    const spreaders = state.npcs.filter(n => n.panic !== null && before(n.panic.since, phase.turn) && isPresent(n) && !isEyesDown(n));
    if (!spreaders.length) return;
    const sight = sightMap(world, state), caught: [NpcState, NpcState][] = [];
    for (const npc of state.npcs) {
        if (npc.panic || !canPanic(world, npc)) continue;
        const eye = npcObserver(world, npc);
        if (!eye) continue;
        const field = fieldOn(sight, eye);
        const from = spreaders.find(s => {
            const dx = s.pos.x - npc.pos.x, dy = s.pos.y - npc.pos.y;
            return s.id !== npc.id && dx * dx + dy * dy <= 9 && bandAt(field, s.pos) !== null;
        });
        if (from) caught.push([npc, from]);
    }
    for (const [npc, from] of caught) panicNpc(ctx, npc, `panic ${from.id}`, from.panic!.crew, from.pos);
}, { order: 8 });

// Face down, out cold or gone: no longer panicking (§10.8).
registerWorldHook('commitIntents', 'panic.calm', ctx => {
    for (const npc of ctx.state.npcs) if (npc.panic && isEyesDown(npc)) npc.panic = null;
}, { order: -45 });

// The reactions (§10.8), as the next crew phase begins, after the lapses: shown in this crew phase, done in its world phase.
registerWorldHook('crewPhase', 'panic.react', ctx => {
    const picking = ctx.state.npcs.filter(n => n.panic !== null && n.panic.reaction === null && isPresent(n) && !isEyesDown(n));
    for (const npc of picking) react(ctx, npc);
    if (picking.length) reconsider(ctx);
}, { order: 110 });

// A hero's tackle costs the crew member an action of this crew phase (§16.2), once their actions are back.
registerWorldHook('crewPhase', 'panic.tackled', ctx => {
    for (const member of ctx.state.crew) {
        if (member.tackled === null || member.tackled > ctx.state.turn) continue;
        member.tackled = null;
        member.actionsLeft = Math.max(0, member.actionsLeft - 1);
        ctx.emit({ type: 'actionLost', crew: member.id });
    }
}, { order: 10 });

registerEvents({
    panicReaction: { undoBlocking: true },
    hid: { undoBlocking: true },
    tackled: { undoBlocking: true },
    heroTackled: { undoBlocking: true },
    actionLost: { undoBlocking: true }
});
