import { describe, expect, it } from 'vitest';
import { IllegalCommand, registerWorldHook, startCarrier, type Intent, type State } from '../../src/sim';
import { smallBank, step } from './helpers';

/*
 * The world phase's two structural promises: a carrier is seen at its full countdown (§9.1), and NPCs carry out the
 * intents the crew saw, not anything decided since (§6.2).
 */

const seen: { step: string; turn: number; intents: Record<string, Intent> }[] = [];

registerWorldHook('passiveNpcs', 'test.passive', (ctx, phase) => {
    seen.push({ step: 'passive', turn: phase.turn, intents: structuredClone(phase.intents) as Record<string, Intent> });
    // An act step that decides something new: neither it nor the next step may act on it this phase.
    for (const npc of ctx.state.npcs) npc.intent = { path: [], facing: 'n' };
    expect(() => { (phase.intents as Record<string, Intent>).teller = { path: [] }; }).toThrow();
    // A carrier started by a reaction, and one at the bare minimum.
    const teller = ctx.state.npcs[0]!;
    startCarrier(ctx, { kind: 'tellerButton', source: teller.id, pos: teller.pos, countdown: ctx.world.rules.minCarrierCountdown });
});

registerWorldHook('combatNpcs', 'test.combat', (ctx, phase) => {
    seen.push({ step: 'combat', turn: phase.turn, intents: structuredClone(phase.intents) as Record<string, Intent> });
    if (phase.turn === 2) startCarrier(ctx, { kind: 'guardRadio', source: 'guard', pos: { x: 1, y: 1 }, countdown: 3 });
});

registerWorldHook('commitIntents', 'test.intents', (ctx, phase) => {
    for (const npc of ctx.state.npcs) npc.intent = { path: [{ x: phase.turn, y: 0 }], facing: 'e' };
});

describe('the world phase', () => {
    it('never shows a new carrier below its minimum countdown, and raises the Alarm when one runs out', () => {
        let { world, state } = smallBank();
        const min = world.rules.minCarrierCountdown;
        for (let turn = 1; turn <= 6; turn++) {
            const result = step(world, state, { type: 'endTurn' });
            for (const c of result.state.carriers.filter(c => c.started.turn === state.turn)) expect(c.countdown).toBeGreaterThanOrEqual(min);
            const raised = result.events.filter(e => e.type === 'alarmRaised');
            if (raised.length) expect(result.state.bank.alarm).toBe(true);
            state = result.state;
        }
        expect(state.bank.alarm).toBe(true);
    });

    it('raises the Alarm exactly when the countdown says', () => {
        let { world, state } = smallBank();
        const alarms: number[] = [];
        for (let i = 0; i < 4; i++) {
            const result = step(world, state, { type: 'endTurn' });
            if (result.events.some(e => e.type === 'alarmRaised')) alarms.push(state.turn);
            state = result.state;
        }
        // Started in world phase 1 at 2: ticks to 1 in phase 2, goes off in phase 3. The crew saw 2, then 1.
        expect(alarms[0]).toBe(3);
    });

    it('refuses a carrier below the minimum', () => {
        const { world, state } = smallBank();
        registerWorldHook('devices', 'test.short', ctx => {
            if (ctx.state.turn === 99) startCarrier(ctx, { kind: 'phoneCall', source: 'teller', pos: { x: 0, y: 0 }, countdown: 1 });
        });
        const late: State = { ...state, turn: 99 };
        expect(() => step(world, late, { type: 'endTurn' })).toThrow(IllegalCommand);
    });

    it('carries out the intents the last world phase committed, whatever the act steps decide', () => {
        seen.length = 0;
        let { world, state } = smallBank();
        const committed: Record<string, Intent>[] = [];
        for (let i = 0; i < 3; i++) {
            committed.push(Object.fromEntries(state.npcs.map(n => [n.id, structuredClone(n.intent)])));
            state = step(world, state, { type: 'endTurn' }).state;
        }
        expect(seen).toHaveLength(6);
        seen.forEach((s, i) => expect(s.intents).toEqual(committed[Math.floor(i / 2)]));
        expect(seen[2]!.intents.teller).toEqual({ path: [{ x: 1, y: 0 }], facing: 'e' });
    });
});
