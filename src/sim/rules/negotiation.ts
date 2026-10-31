import { registerWorldHook, type Ctx } from '../core/engine';
import { sortedIds } from '../core/json';
import { crewMember, registerStateInit } from '../core/state';
import type { CrewState, DeepReadonly, NpcState, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { STALL_PHASES } from '../data/police';
import { lacksActions, registerAction } from './actions/act';
import { inBuilding } from './actions/loot';
import { releaseBody } from './actions/body';
import { wayOut } from './command';
import { releaseBlocked, releaseHeat, releaseRelief } from './heat';
import { reconsider } from './npc/intent';
import { isPresent } from './npc/walk';
import { draggedBy } from './place';
import { exitTile } from './police';
import { alertNpc } from './suspicion';
import { isDown } from './wounds';

/*
 * Negotiation, release and trade (§10.7, §13.4). The police director (rules/police.ts) runs the modes; this is the
 * crew's side of Negotiate.
 *
 * - **The call.** In every crew phase of Negotiate with the negotiator out on scene, the negotiator calls the bank's
 *   phones (`negotiatorCalling`; `negotiatorCalls` as the crew phase begins). The lines ring on every desk, so any crew
 *   member inside the building can pick up (decision 130). One answer a crew phase.
 * - **Answering** (`negotiate { crew, offer }`, 1 action) takes one of the offers (§13.4):
 *   - **Release** a hostage (`npc`): anyone held (Commanded or tied, on the map, not stashed), however far from the
 *     phone. The heat falls at once by `releaseRelief` (−3, capped at Heat 1, tick 0: what the offer shows), and the
 *     hostage gets up, no longer anyone's, and walks out the nearest way out (`wayOut`: the police control every exit
 *     once they are on scene), its path the intent the crew phase shows; it leaves the map there (a `released` lapse,
 *     npc/intent.ts; wounded, it crawls). At most one release a turn and three a heist (`RELEASES_PER_HEIST`, decision
 *     Q17's hard cap, `releaseBlocked`). A hostage walking out can't be taken again: it ignores commands
 *     (rules/command.ts) and can't be knocked out (so nor tied, rules/actions/knockout.ts); it still counts as a
 *     hostage if killed (+5, rules/heat.ts), but never as one escaping (+1).
 *   - **Trade** a hostage for a crew member in police custody (`npc`, `member`): the hostage walks out as for a
 *     release, without the heat (the hostage buys the crew member, not time), and the crew member is handed back at
 *     that way out (the free tile nearest it, as police get out of a car) as the crew phase after the hostage reaches
 *     the police begins (§10.7 "release a hostage to get back"). A hostage killed or downed on the way calls it off
 *     (`tradeOff`): the member stays in custody, to be traded for again. A trade isn't
 *     a release: it counts toward neither cap. Custody is M3-03's `State.custody` (rules/wounds.ts `arrestCrew`): the
 *     member stays in it, off the map, until handed back as they were taken (a downed one still down, its bleed-out
 *     clock having stood while it was away).
 *   - **Stall:** Negotiate lasts `STALL_PHASES` (2) world phases longer. Once a heist.
 *   - **Hang up:** nothing but the action.
 * - **What a released hostage tells.** As it leaves the map, the crew members it saw and where it last saw them go to
 *   the police (`NegotiationState.reports`), which the officers act on (rules/routine.ts); so does a hostage the police
 *   freed, and an escapee once the Alarm is up.
 *
 * Nothing here rolls: an answer's preview is its outcome.
 */

/** What answering the negotiator takes (§13.4). */
export type NegotiationOffer = 'release' | 'trade' | 'stall' | 'hangUp';

/** What a hostage who reached the police told them (§10.7): each crew member it saw, where and when. */
export interface PoliceReport {
    npc: string;
    turn: number;
    seen: { crew: string; tile: Pos; turn: number }[];
}

export interface NegotiationState {
    /** The turn whose crew phase the crew last answered the negotiator in, or null. */
    answered: number | null;
    /** Whether Stall was used (once a heist). */
    stalled: boolean;
    /** Trades made: who comes back from `State.custody` once the hostage `npc` has reached the police, and where. */
    returns: { crew: string; npc: string; at: Pos }[];
    /** What released hostages told the police as they reached them. */
    reports: PoliceReport[];
}

declare module '../core/types' {
    interface State {
        negotiation: NegotiationState;
    }
    interface CommandMap {
        /** Answers the negotiator's call (§13.4): 1 action, one of the offers; `npc` the hostage of a release or trade, `member` who a trade gets back. */
        negotiate: { crew: string; offer: NegotiationOffer; npc?: string; member?: string };
    }
    interface EventMap {
        /** The negotiator is calling the bank's phones this crew phase. */
        negotiatorCalls: { turn: number };
        /** The crew answered with `offer`. */
        negotiated: { crew: string; offer: NegotiationOffer };
        /** A hostage was let go to walk out at `exit`; `relief` the heat it took off (0 for a trade). */
        hostageReleased: { npc: string; crew: string; exit: Pos; relief: number; trade: boolean };
        /** Negotiate runs `by` world phases longer, `left` now. */
        stalled: { by: number; left: number };
        /** A released hostage reached the police and told them what it saw. */
        policeTold: { npc: string };
        /** A trade fell through: its hostage won't reach the police (killed, or down on the way), so the member stays in custody. */
        tradeOff: { crew: string; npc: string };
        /** A crew member traded back from custody, at `at`. */
        crewReturned: { crew: string; at: Pos };
    }
}

registerStateInit('negotiation', (_world, state) => {
    state.negotiation = { answered: null, stalled: false, returns: [], reports: [] };
});

/** Whether the negotiator is calling now (see the header): Negotiate, the negotiator out, not answered this turn. */
export function negotiatorCalling(state: DeepReadonly<State>): boolean {
    return state.phase === 'crew' && state.police.mode?.kind === 'negotiate' && state.negotiation.answered !== state.turn
        && state.police.units.some(u => u.kind === 'negotiator' && u.pos !== null);
}

/** Whether an NPC is a hostage the crew can let go: Commanded or tied, on the map, not stashed away. */
export const releasable = (npc: DeepReadonly<NpcState>): boolean =>
    (npc.status === 'commanded' || npc.status === 'tied') && isPresent(npc) && npc.stashed === null;

/** The way out a hostage would walk to if let go now, or undefined when it has none. */
export function releaseExit(world: ReadonlyWorld, state: State, npc: DeepReadonly<NpcState>): Pos | undefined {
    const led = draggedBy(state, npc.id);
    // A hostage led along stands where its escort does.
    const from = led ? { ...npc, pos: { x: led.pos.x, y: led.pos.y } } : npc;
    return wayOut(world, state, from as DeepReadonly<NpcState>)?.exit;
}

/** What an answer would change, for the offer's label (UI.md "each option's effect shown as a heat or clock delta"). */
export interface OfferEffect {
    /** Heat ticks (negative: falls). */
    heat: number;
    /** Negotiate's world phases. */
    phases: number;
}

export function offerEffect(state: DeepReadonly<State>, offer: NegotiationOffer): OfferEffect {
    if (offer === 'release') return { heat: -releaseRelief(state), phases: 0 };
    if (offer === 'stall') return { heat: 0, phases: STALL_PHASES };
    return { heat: 0, phases: 0 };
}

/** The crew members in custody (`State.custody`) not yet traded for: who a trade can get back. */
export const tradeable = (state: DeepReadonly<State>): string[] =>
    state.custody.map(c => c.crew.id).filter(id => !state.negotiation.returns.some(r => r.crew === id));

/** Why a hostage can't be let go in a release or a trade, or undefined. */
function hostageBlocked(world: ReadonlyWorld, state: State, id: string | undefined): string | undefined {
    const npc = id === undefined ? undefined : state.npcs.find(n => n.id === id);
    if (!npc || !releasable(npc)) return 'Only a hostage the crew holds can be let go';
    if (!releaseExit(world, state, npc)) return 'There is no way out for them to walk to';
    return undefined;
}

registerAction('negotiate', {
    whyNot(world, state, cmd) {
        const member = crewMember(state, cmd.crew);
        const lack = lacksActions(member, 1);
        if (lack) return lack;
        if (!negotiatorCalling(state)) return 'Nobody is calling';
        if (!inBuilding(world, member.pos)) return `${member.name} isn't inside, by a phone`;
        switch (cmd.offer) {
            case 'release':
                return releaseBlocked(state) ?? hostageBlocked(world, state, cmd.npc);
            case 'trade':
                if (cmd.member === undefined || !tradeable(state).includes(cmd.member)) return 'Nobody of the crew is in custody to trade for';
                return hostageBlocked(world, state, cmd.npc);
            case 'stall':
                return state.negotiation.stalled ? 'The negotiator won\'t be stalled again' : undefined;
            case 'hangUp':
                return undefined;
        }
        return 'No such offer';
    },
    candidates(_world, state, member) {
        const hostages = state.npcs.filter(releasable).map(n => n.id);
        return [
            ...hostages.map(npc => ({ type: 'negotiate' as const, crew: member.id, offer: 'release' as const, npc })),
            ...tradeable(state).flatMap(m => hostages.map(npc => ({ type: 'negotiate' as const, crew: member.id, offer: 'trade' as const, npc, member: m }))),
            { type: 'negotiate', crew: member.id, offer: 'stall' },
            { type: 'negotiate', crew: member.id, offer: 'hangUp' }
        ];
    },
    cost: () => 1,
    run(ctx, member, cmd) {
        const { state } = ctx;
        state.negotiation.answered = state.turn;
        ctx.emit({ type: 'negotiated', crew: member.id, offer: cmd.offer });
        if (cmd.offer === 'stall') {
            state.negotiation.stalled = true;
            state.police.mode!.left += STALL_PHASES;
            ctx.emit({ type: 'stalled', by: STALL_PHASES, left: state.police.mode!.left });
        } else if (cmd.offer === 'release' || cmd.offer === 'trade') {
            const trade = cmd.offer === 'trade';
            const relief = trade ? 0 : releaseHeat(ctx);
            const exit = letGo(ctx, member, cmd.npc!, relief, trade);
            if (trade) {
                state.negotiation.returns.push({ crew: cmd.member!, npc: cmd.npc!, at: exit });
            }
        }
    }
});

/** Lets a hostage go: up, no longer led or held, walking out its way out (a `released` lapse). Returns the way out. */
function letGo(ctx: Ctx, member: CrewState, id: string, relief: number, trade: boolean): Pos {
    const { world, state } = ctx;
    const npc = state.npcs.find(n => n.id === id)!;
    const exit = releaseExit(world, state, npc)!;
    const escort = draggedBy(state, npc.id);
    if (escort) {
        npc.pos = { x: escort.pos.x, y: escort.pos.y };
        releaseBody(world, state, state.crew.find(c => c.id === escort.id)!);
    }
    npc.command = null;
    npc.status = 'alerted';
    npc.lapse = { kind: 'released', exit: { x: exit.x, y: exit.y } };
    ctx.emit({ type: 'npcStatus', npc: npc.id, status: 'alerted' });
    alertNpc(ctx, npc, 'released');
    ctx.emit({ type: 'hostageReleased', npc: npc.id, crew: member.id, exit: { x: exit.x, y: exit.y }, relief, trade });
    reconsider(ctx);
    return exit;
}

// What a hostage let go or freed tells the police as it leaves the map (after the walks, npc/act.ts), and an escapee
// running from a command once the Alarm is up (§13.4 Contain: "collect escapees, who tell the police what they saw").
registerWorldHook('passiveNpcs', 'negotiation.told', ctx => {
    const { state } = ctx;
    for (const npc of state.npcs) {
        const telling = npc.lapse?.kind === 'released' || (npc.lapse?.kind === 'flee' && !!state.response);
        if (!telling || isPresent(npc) || state.negotiation.reports.some(r => r.npc === npc.id)) continue;
        const seen = sortedIds(npc.lastSeen).map(crew => ({ crew, tile: { ...npc.lastSeen[crew]!.tile }, turn: npc.lastSeen[crew]!.turn }));
        state.negotiation.reports.push({ npc: npc.id, turn: state.turn, seen });
        ctx.emit({ type: 'policeTold', npc: npc.id });
    }
}, { order: 7 });

// As a crew phase begins: crew traded back are handed over at their way out, and the negotiator calls.
registerWorldHook('crewPhase', 'negotiation.call', ctx => {
    const { world, state } = ctx;
    for (const r of [...state.negotiation.returns]) {
        const npc = state.npcs.find(n => n.id === r.npc);
        const out = !!npc && npc.lapse?.kind === 'released' && !isPresent(npc);
        // Still walking out (up, its lapse its own): the handover waits for it.
        if (npc && npc.lapse?.kind === 'released' && !out && npc.status !== 'dead' && npc.status !== 'unconscious') continue;
        state.negotiation.returns.splice(state.negotiation.returns.indexOf(r), 1);
        if (!out) {
            ctx.emit({ type: 'tradeOff', crew: r.crew, npc: r.npc });
            continue;
        }
        const held = state.custody.find(c => c.crew.id === r.crew);
        if (!held) continue;
        state.custody.splice(state.custody.indexOf(held), 1);
        const member = held.crew;
        // On the free tile nearest the way out; with none free near it, on the way out itself.
        member.pos = exitTile(world, state, r.at) ?? { x: r.at.x, y: r.at.y };
        // Their actions as the crew phase gives them (rules/wounds.ts): none while down.
        member.actionsLeft = isDown(member) ? 0 : world.rules.actionsPerTurn;
        state.crew.push(member);
        ctx.emit({ type: 'crewReturned', crew: member.id, at: { ...member.pos } });
    }
    if (negotiatorCalling(state)) ctx.emit({ type: 'negotiatorCalls', turn: state.turn });
}, { order: 50 });

registerEvents({
    negotiatorCalls: { undoBlocking: false },
    negotiated: { undoBlocking: true },
    hostageReleased: { undoBlocking: true },
    stalled: { undoBlocking: true },
    policeTold: { undoBlocking: true },
    tradeOff: { undoBlocking: true },
    crewReturned: { undoBlocking: true }
});
