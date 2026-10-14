import { IllegalCommand, registerWorldHook, type Ctx } from '../core/engine';
import { newId } from '../core/state';
import { registerEvents } from '../core/undo';
import type { Carrier, CarrierKind, Pos } from '../core/types';

/*
 * Alarm carriers (§9.1), as far as the engine's promise needs them: every carrier starts at a countdown of at least
 * `rules.minCarrierCountdown`, the devices step ticks it once per world phase but never in the phase that started it,
 * and the Alarm is raised when one reaches 0. So a carrier is always seen at its full countdown for a whole crew phase.
 * Who starts carriers and how they are countered comes with M1-08.
 */

export function startCarrier(ctx: Ctx, carrier: { kind: CarrierKind; source: string; pos: Pos; countdown: number }): Carrier {
    const min = ctx.world.rules.minCarrierCountdown;
    if (carrier.countdown < min) throw new IllegalCommand(`A carrier's countdown is at least ${min}, not ${carrier.countdown}`);
    const { state } = ctx;
    const started: Carrier = {
        id: newId(state, 'carrier'),
        kind: carrier.kind,
        source: carrier.source,
        pos: { x: carrier.pos.x, y: carrier.pos.y },
        countdown: carrier.countdown,
        started: { turn: state.turn, phase: state.phase },
        halted: null
    };
    state.carriers.push(started);
    ctx.emit({ type: 'carrierStarted', carrier: started.id, kind: started.kind, countdown: started.countdown });
    return started;
}

registerWorldHook('devices', 'devices.carriers', (ctx, phase) => {
    const { state } = ctx;
    for (const carrier of [...state.carriers]) {
        if (carrier.halted) continue;
        if (carrier.started.turn === phase.turn && carrier.started.phase === 'world') continue;
        carrier.countdown--;
        ctx.emit({ type: 'carrierTicked', carrier: carrier.id, countdown: carrier.countdown });
        if (carrier.countdown > 0) continue;
        state.carriers.splice(state.carriers.indexOf(carrier), 1);
        state.bank.alarm = true;
        ctx.emit({ type: 'alarmRaised', carrier: carrier.id });
    }
});

registerEvents({
    carrierStarted: { undoBlocking: true },
    carrierTicked: { undoBlocking: true },
    alarmRaised: { undoBlocking: true }
});
