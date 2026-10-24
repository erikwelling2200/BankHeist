import { describe, expect, it } from 'vitest';
import {
    defaultRules, deserialiseState, fixtureWorld, initialState, registerCrewInit, registerNpcInit,
    registerRuleDefaults, registerStateInit, registerWorldHook, serialiseState, worldHooks, type State
} from '../../src/sim';
import { registerTestCommand, smallBank, step, testCommand } from './helpers';

/*
 * How packages plug in from their own modules, whatever order they are imported in. This file registers real systems
 * over the engine's placeholders, so it runs on its own module instances (vitest isolates each test file).
 */

describe('registering systems', () => {
    it("lets a real command take a placeholder's place, and never the other way round", () => {
        // A command of its own: the engine's placeholder 'move' is already filled in by the movement package.
        const { world, state } = smallBank();
        const cmd = testCommand({ type: 'testPlaced', crew: 'jun' });
        registerTestCommand('testPlaced', () => { throw new Error('a stub'); }, { placeholder: true });
        registerTestCommand('testPlaced', ctx => { ctx.state.crew[0]!.actionsLeft = 0; });
        expect(step(world, state, cmd).state.crew[0]!.actionsLeft).toBe(0);
        registerTestCommand('testPlaced', () => { throw new Error('a stub'); }, { placeholder: true });
        expect(step(world, state, cmd).state.crew[0]!.actionsLeft).toBe(0);
        expect(() => registerTestCommand('testPlaced', () => {})).toThrow(/already registered/);
        registerTestCommand('testPlaced', ctx => { ctx.state.crew[0]!.actionsLeft = 1; }, { replace: true });
        expect(step(world, state, cmd).state.crew[0]!.actionsLeft).toBe(1);
        // And the real move took the engine's placeholder's place.
        expect(() => step(world, state, { type: 'move', crew: 'jun', path: [{ x: 3, y: 0 }] })).toThrow(/Can't step/);
    });

    it("fills in the engine's placeholder hooks under their names", () => {
        registerWorldHook('combatNpcs', 'npcs.combat', ctx => { ctx.state.npcs[0]!.facing = 'w'; });
        expect(worldHooks().combatNpcs).toEqual(['npcs.combat']);
        expect(worldHooks().passiveNpcs).toEqual(['knowledge.freshBefore', 'evidence.judge', 'perception.world', 'evidence.notice', 'cameras.operator', 'trespass.deadlines', 'npcs.passive', 'alarms.raise', 'evidence.tell']);
        const { world, state } = smallBank();
        expect(step(world, state, { type: 'endTurn' }).state.npcs[0]!.facing).toBe('w');
    });

    it('runs inits in order of name and takes rule defaults', () => {
        const order: string[] = [];
        registerStateInit('b.second', (_w, s) => { order.push('b'); (s as State & { extra?: number }).extra = s.npcs.length; });
        registerStateInit('a.first', () => { order.push('a'); });
        registerNpcInit('test.npc', (_w, person, npc) => { npc.facing = person.role === 'guard' ? 'n' : npc.facing; });
        registerCrewInit('test.crew', (_w, start, member) => { member.name = start.id.toUpperCase(); });
        expect(() => registerStateInit('a.first', () => {})).toThrow(/already/);
        expect(() => registerRuleDefaults({ coreRange: 7 })).toThrow(/already has a default/);

        const { world, state } = smallBank();
        expect(order).toEqual(['a', 'b']);
        expect((state as State & { extra?: number }).extra).toBe(2);
        expect(state.npcs.find(n => n.id === 'guard')!.facing).toBe('n');
        expect(state.crew[0]!.name).toBe('JUN');
        expect(world.rules).toEqual(defaultRules());
        // A save without a package's state field is refused: the keys come from a fresh state.
        const text = serialiseState({ state: initialState(fixtureWorld(['.']), { seed: 1, crew: [] }) });
        expect(() => deserialiseState(text.replace('"extra"', '"other"'))).toThrow(/has no extra/);
    });

    it("takes a package's rule defaults, once", () => {
        const extra = { testRange: 4 } as never;
        registerRuleDefaults(extra);
        registerRuleDefaults(extra);
        expect((defaultRules() as unknown as { testRange: number }).testRange).toBe(4);
        expect(() => registerRuleDefaults({ testRange: 5 } as never)).toThrow(/already has a default/);
    });
});
