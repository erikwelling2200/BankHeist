import { registerCommandGate, registerCommandHook, type Ctx } from '../core/engine';
import { sortedIds } from '../core/json';
import { registerRuleDefaults, registerStateInit } from '../core/state';
import { registerStateCheck } from '../core/save';
import type { CrewState, DeepReadonly, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { lootObject } from './hands';
import { heatOf } from './heat';
import { registerLeaveHook } from './vehicles';
import { forgetCrew, isDown } from './wounds';

/*
 * Leaving the plot and how the heist ends (§15.4, §15.5).
 *
 * - **Leaving.** The driver drives the vehicle off a plot edge (rules/vehicles.ts): everyone aboard escapes with what
 *   they carry and what is in the hold, and are out of play from then on (`State.escaped`, decision 286: no rule on
 *   the map sees, bleeds, arrests or counts them). With one crew vehicle that ends the heist (decision 177): crew left behind are
 *   arrested, alive or down, and the dead stay dead. With a second (the backup car, decision 284) the heist goes on while
 *   someone is still up on the plot and a crew vehicle that can drive (not disabled) is still there; it ends when the
 *   last such vehicle leaves or nobody up is left behind.
 * - **Failure** (§15.5): every crew member not away is out for good, dead or in custody, checked after every command:
 *   the heist ends there (a Success or Partial if some got away earlier). A crew all down is played on until each is
 *   arrested or has bled out (decision 177). "None can still escape" otherwise (every vehicle disabled and nobody able
 *   to leave on foot) waits: an off-map route is the way out on foot (below).
 * - **On foot** (§15.4, M4-05, decision 303): a crew member who takes an off-map route off the plot (rules/transit.ts
 *   `escape`) is out of play as its transit ends (`leaveOnFoot`), escaped with what they carry, as if in a vehicle that
 *   left; while one is still on the way out, a vehicle leaving doesn't end the heist.
 * - **The outcome** (`State.outcome`): Success when the loot that left (not ruined) is at least the contract's target
 *   (`rules.contractTarget`) and someone escaped, Partial when someone escaped below it, Failure when nobody did. Its
 *   debrief data: who escaped, was arrested or died, the loot that left and its value, what dye packs ruined of what the
 *   crew had, the target and the heat. The payout (§19.4 shares, §19.8 style) is the campaign's (M6): here it is the
 *   value that left.
 * - Once the heist has ended no command is given (`registerCommandGate`), `endTurn` included.
 */

export type OutcomeResult = 'success' | 'partial' | 'failure';

/** A crew member who left the plot (decision 286): as they were, the vehicle they left in and the turn. */
/** A crew member who got away: in `vehicle`, or on foot by the off-map route `route` (vehicle null, M4-05). */
export interface Escaped { crew: CrewState; vehicle: string | null; route?: string; turn: number }

/** How the heist ended (§15.5): the debrief's data. */
export interface HeistOutcome {
    result: OutcomeResult;
    /** The turn it ended in. */
    turn: number;
    /** The vehicle that left the plot, or null when nobody got away. */
    vehicle: string | null;
    /** Crew ids: away in the vehicle, arrested (left behind or taken earlier), dead. */
    escaped: string[];
    arrested: string[];
    dead: string[];
    /** The loot that left the map and wasn't ruined, by id, and its value. */
    loot: string[];
    value: number;
    /** The value of what dye packs ruined among the loot the crew had (§15.5 "minus dye-pack losses"). */
    ruined: number;
    /** The contract's target (§15.1). */
    target: number;
    /** The heat level at the end, 0 if the Alarm never went off. */
    heat: number;
}

declare module '../core/types' {
    interface State {
        /** How the heist ended, or null while it goes on (§15.5). */
        outcome: HeistOutcome | null;
        /**
         * The crew who have left the plot in a vehicle (decision 286): out of play, as they were when they left, in the
         * order they left. Their loot keeps them as its holder.
         */
        escaped: Escaped[];
    }
    interface Rules {
        /** The loot that must leave in the getaway for a Success (§15.1, §15.5): the contract's target. */
        contractTarget: number;
    }
    interface EventMap {
        /** The heist is over (§15.5): the outcome is in `State.outcome`. */
        heistEnded: { result: OutcomeResult; value: number; target: number; escaped: string[] };
        /** Crew members left the plot aboard `vehicle`: out of play from now on (decision 286). */
        crewEscaped: { vehicle: string; crew: string[] };
    }
}

registerRuleDefaults({ contractTarget: 0 });

registerStateInit('outcome', (_world, state) => {
    state.outcome = null;
    state.escaped = [];
});

// A save from before M4-04 has no escaped crew.
registerStateCheck('escaped', raw => (Array.isArray((raw as { escaped?: unknown }).escaped) ? undefined : 'no escaped crew (a save from before M4-04)'));

const valueOf = (world: ReadonlyWorld, id: string): number => lootObject(world, id).loot.value;

/** The crew vehicles that have left the plot (with `also`, one leaving now). */
const goneVehicles = (state: DeepReadonly<State>, also: string | null): string[] => sortedIds(state.vehicles).filter(id => state.vehicles[id]!.gone || id === also);

/**
 * The heist's outcome were it to end now, with the crew aboard every vehicle that has left and aboard `vehicle` away
 * (null: none leaving now).
 */
export function outcomeNow(world: ReadonlyWorld, state: DeepReadonly<State>, vehicle: string | null): HeistOutcome {
    // Everyone aboard leaves with the vehicle, and what they carry with them; the dead among them count only as dead.
    const left = goneVehicles(state, vehicle);
    const aboard = [...state.escaped.map(e => e.crew), ...state.crew.filter(c => c.aboard !== null && left.includes(c.aboard))];
    const escaped = aboard.filter(c => !c.wounds.dead).map(c => c.id);
    const away = new Set<string>([...aboard.map(c => c.id), ...left]);
    const dead = [...state.crew, ...state.escaped.map(e => e.crew)].filter(c => c.wounds.dead).map(c => c.id);
    const arrested = [...state.crew.filter(c => !away.has(c.id) && !c.wounds.dead).map(c => c.id), ...state.custody.map(c => c.crew.id)];
    const loot: string[] = [];
    let value = 0, ruined = 0;
    for (const id of sortedIds(state.loot)) {
        const l = state.loot[id]!;
        if (l.holder === null) continue;
        if (l.ruined) ruined += valueOf(world, id);
        else if (away.has(l.holder)) {
            loot.push(id);
            value += valueOf(world, id);
        }
    }
    const target = world.rules.contractTarget;
    const result: OutcomeResult = !escaped.length ? 'failure' : value >= target ? 'success' : 'partial';
    return { result, turn: state.turn, vehicle, escaped, arrested, dead, loot, value, ruined, target, heat: state.response ? heatOf(state.response.heat).level : 0 };
}

function end(ctx: Ctx, vehicle: string | null): void {
    const outcome = outcomeNow(ctx.world, ctx.state, vehicle);
    ctx.state.outcome = outcome;
    ctx.emit({ type: 'heistEnded', result: outcome.result, value: outcome.value, target: outcome.target, escaped: [...outcome.escaped] });
}

// A drive off the plot (rules/vehicles.ts): the vehicle and everyone aboard are away; the heist is over unless someone
// up is left behind with a crew vehicle that can still drive (see the header).
registerLeaveHook('getaway', (ctx, vehicle) => {
    const { state } = ctx;
    state.vehicles[vehicle]!.gone = true;
    // Everyone aboard is out of play from now on (decision 286): off the crew, forgotten by every rule on the map.
    const leaving = state.crew.filter(c => c.aboard === vehicle);
    for (const member of leaving) {
        state.crew.splice(state.crew.indexOf(member), 1);
        state.escaped.push({ crew: member, vehicle, turn: state.turn });
        forgetCrew(state, member.id);
    }
    if (leaving.length) ctx.emit({ type: 'crewEscaped', vehicle, crew: leaving.map(c => c.id) });
    const behind = state.crew.some(c => !isDown(c) && !leavingOnFoot(c));
    const ride = sortedIds(state.vehicles).some(id => !state.vehicles[id]!.gone && state.vehicles[id]!.hp > 0);
    // Someone on their way out by a route is let finish it: the heist ends once they are away (`crewOut`).
    if ((!behind || !ride) && !state.crew.some(leavingOnFoot)) end(ctx, vehicle);
});

/** Whether a crew member is on an off-map route out of the plot (rules/transit.ts `escape`). */
const leavingOnFoot = (c: DeepReadonly<CrewState>): boolean => !!c.transit?.escape;

/**
 * A crew member at the end of a route off the plot (§15.4): out of play from now on, as those who drive off are
 * (decision 286), with what they carry. rules/transit.ts calls it; `crewOut` then ends the heist once nobody is left.
 */
export function leaveOnFoot(ctx: Ctx, member: CrewState, route: string): void {
    const { state } = ctx;
    state.crew.splice(state.crew.indexOf(member), 1);
    state.escaped.push({ crew: member, vehicle: null, route, turn: state.turn });
    forgetCrew(state, member.id);
}

/**
 * Whether the crew is out for good (§15.5 Failure): every one dead, in custody or away. A downed crew member with nobody up
 * is still played out, arrested or bled out within a few world phases, so the debrief tells which (decision 177). A
 * heist with no crew at all (a test of the world alone) never fails.
 */
export const crewOut = (state: DeepReadonly<State>): boolean =>
    (state.crew.length > 0 || state.custody.length > 0 || state.escaped.length > 0) && state.crew.every(c => c.wounds.dead);

// After every command (the world phase too): a crew that is all out has failed.
registerCommandHook('getaway.failure', ctx => {
    if (ctx.state.outcome === null && crewOut(ctx.state)) end(ctx, null);
}, { order: 50 });

registerCommandGate('getaway', (_world, state) => (state.outcome ? 'The heist is over' : undefined));

registerEvents({
    heistEnded: { undoBlocking: true },
    crewEscaped: { undoBlocking: true }
});
