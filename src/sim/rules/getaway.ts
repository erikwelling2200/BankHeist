import { registerCommandGate, registerCommandHook, type Ctx } from '../core/engine';
import { sortedIds } from '../core/json';
import { registerRuleDefaults, registerStateInit } from '../core/state';
import type { DeepReadonly, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { lootObject } from './hands';
import { heatOf } from './heat';
import { onLeavingPlot } from './vehicles';

/*
 * Leaving the plot and how the heist ends (§15.4, §15.5).
 *
 * - **Leaving.** The driver drives the vehicle off a plot edge (rules/vehicles.ts): everyone aboard escapes with what
 *   they carry and what is in the hold. The crew's one vehicle leaving ends the heist (decision 177): crew left behind
 *   are arrested, alive or down, and the dead stay dead.
 * - **Failure** (§15.5): every crew member is out for good, dead or in custody, checked after every command: the
 *   heist ends there. A crew all down is played on until each is arrested or has bled out (decision 177). "None can still escape" otherwise (a van that can't
 *   leave) waits for ramming and the backup car (M4).
 * - **The outcome** (`State.outcome`): Success when the loot that left (not ruined) is at least the contract's target
 *   (`rules.contractTarget`) and someone escaped, Partial when someone escaped below it, Failure when nobody did. Its
 *   debrief data: who escaped, was arrested or died, the loot that left and its value, what dye packs ruined of what the
 *   crew had, the target and the heat. The payout (§19.4 shares, §19.8 style) is the campaign's (M6): here it is the
 *   value that left.
 * - Once the heist has ended no command is given (`registerCommandGate`), `endTurn` included.
 */

export type OutcomeResult = 'success' | 'partial' | 'failure';

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
    }
    interface Rules {
        /** The loot that must leave in the getaway for a Success (§15.1, §15.5): the contract's target. */
        contractTarget: number;
    }
    interface EventMap {
        /** The heist is over (§15.5): the outcome is in `State.outcome`. */
        heistEnded: { result: OutcomeResult; value: number; target: number; escaped: string[] };
    }
}

registerRuleDefaults({ contractTarget: 0 });

registerStateInit('outcome', (_world, state) => {
    state.outcome = null;
});

const valueOf = (world: ReadonlyWorld, id: string): number => lootObject(world, id).loot.value;

/** The heist's outcome were it to end now with the crew aboard `vehicle` away (null: nobody gets away). */
export function outcomeNow(world: ReadonlyWorld, state: DeepReadonly<State>, vehicle: string | null): HeistOutcome {
    const escaped = vehicle === null ? [] : state.crew.filter(c => c.aboard === vehicle).map(c => c.id);
    const away = new Set<string>([...escaped, ...(vehicle === null ? [] : [vehicle])]);
    const dead = state.crew.filter(c => c.wounds.dead).map(c => c.id);
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

// A drive off the plot (rules/vehicles.ts): the vehicle and everyone aboard are away, and the heist is over.
onLeavingPlot((ctx, vehicle) => {
    ctx.state.vehicles[vehicle]!.gone = true;
    end(ctx, vehicle);
});

/**
 * Whether the crew is out for good (§15.5 Failure): every one dead or in custody. A downed crew member with nobody up
 * is still played out, arrested or bled out within a few world phases, so the debrief tells which (decision 177). A
 * heist with no crew at all (a test of the world alone) never fails.
 */
export const crewOut = (state: DeepReadonly<State>): boolean => (state.crew.length > 0 || state.custody.length > 0) && state.crew.every(c => c.wounds.dead);

// After every command (the world phase too): a crew that is all out has failed.
registerCommandHook('getaway.failure', ctx => {
    if (ctx.state.outcome === null && crewOut(ctx.state)) end(ctx, null);
}, { order: 50 });

registerCommandGate('getaway', (_world, state) => (state.outcome ? 'The heist is over' : undefined));

registerEvents({
    heistEnded: { undoBlocking: true }
});
