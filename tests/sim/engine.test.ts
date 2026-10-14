import { describe, expect, it } from 'vitest';
import {
    assertPlainJson, deepFreeze, Dice, DICE_WINDOW, hashOf, IllegalCommand, InvariantError, popUndo, preview,
    PreviewRollError, recordUndo, registerCommand, registerEvents, registerWorldHook, worldHooks, WORLD_STEPS, type State, type UndoStack
} from '../../src/sim';
import { play, registerTestCommand, registerTestEvents, SCRIPT, smallBank, step, testCommand, testEvent } from './helpers';

// Something in the world phase rolls, so the script exercises the dice like the real systems will.
registerWorldHook('devices', 'test.dice', ctx => {
    for (const npc of ctx.state.npcs) if (ctx.dice.chance('test', 0.5, `turn ${npc.id}`)) npc.facing = npc.facing === 'n' ? 's' : 'n';
}, { order: 10 });

// A reducer that tries to hide a roll from the preview.
registerTestCommand('testSwallow', (ctx, cmd) => {
    try {
        ctx.dice.int('combat', 1, 6, 'hit');
    } catch {
        ctx.state.crew.find(c => c.id === cmd.crew)!.actionsLeft = 0;
    }
});

// A reducer that shows its odds: an event, then a roll.
registerTestCommand('testOdds', (ctx, cmd) => {
    ctx.emit(testEvent({ type: 'testTried', crew: cmd.crew! }));
    if (ctx.dice.odds('resist', 0.25, 'resist')) ctx.state.crew.find(c => c.id === cmd.crew)!.actionsLeft = 0;
});
registerTestEvents({ testTried: { undoBlocking: false } });

// A reducer that refuses after rolling, one that moves an NPC without saying so, and one that writes to its command.
registerTestCommand('testRollThenIllegal', ctx => {
    ctx.dice.next('combat', 'hit');
    throw new IllegalCommand('too late');
});
registerTestCommand('testNudge', ctx => {
    ctx.state.npcs[0]!.facing = 'w';
    ctx.emit(testEvent({ type: 'testTried', crew: 'jun' }));
});
registerTestCommand('testWriteCommand', (_ctx, cmd) => {
    cmd.crew = 'someone else';
});

// Reducers that catch the preview's stop and carry on: to a second roll, or to an error the commit wouldn't raise.
registerTestCommand('testOddsTwice', ctx => {
    try {
        ctx.dice.odds('resist', 0.5, 'first');
    } catch { /* hiding the stop */ }
    ctx.dice.odds('resist', 0.5, 'second');
});
registerTestCommand('testOddsThenIllegal', ctx => {
    try {
        ctx.dice.odds('resist', 0.5, 'first');
    } catch {
        throw new IllegalCommand('not allowed');
    }
});

describe('the rules engine', () => {
    it('plays the same commands to the same state', () => {
        const a = smallBank(), b = smallBank();
        const endA = play(a.world, a.state, SCRIPT), endB = play(b.world, b.state, SCRIPT);
        expect(endA.turn).toBe(4);
        expect(endA.dice.length).toBe(6);
        expect(hashOf(endA)).toBe(hashOf(endB));
        expect(endA).toEqual(endB);
    });

    it('rolls differently from another seed', () => {
        const a = smallBank(), b = smallBank();
        const endA = play(a.world, a.state, SCRIPT), endB = play(b.world, { ...b.state, seed: 99 }, SCRIPT);
        expect(endA.dice.map(d => d.value)).not.toEqual(endB.dice.map(d => d.value));
    });

    it('never changes the state it is given, and freezes the world', () => {
        const { world, state } = smallBank();
        expect(Object.isFrozen(world.tiles[0])).toBe(true);
        expect(Object.isFrozen(world.edges)).toBe(true);
        let s = state;
        for (const cmd of SCRIPT) {
            const before = hashOf(s);
            deepFreeze(s);
            const next = step(world, s, cmd).state;
            expect(hashOf(s)).toBe(before);
            s = next;
        }
    });

    it('hands out events that are copies, not parts of the state', () => {
        const { world, state } = smallBank();
        const result = step(world, state, SCRIPT[0]!);
        const moved = result.events[0]!;
        expect(moved.type === 'moved' && moved.to).not.toBe(result.state.crew[0]!.pos);
    });

    it('previews without changing the state, and the preview is the outcome', () => {
        const { world, state } = smallBank();
        deepFreeze(state);
        const cmd = SCRIPT[0]!;
        const seen = preview(world, state, cmd), done = step(world, state, cmd);
        expect(seen.events).toEqual(done.events);
        expect(seen.undoable).toBe(done.undoable);
        expect(hashOf(seen.state)).toBe(hashOf(done.state));
        expect(state.crew[0]!.pos).toEqual({ x: 0, y: 0 });
    });

    it('throws when a preview would roll, even if the reducer catches it', () => {
        const { world, state } = smallBank();
        expect(() => preview(world, state, { type: 'endTurn' })).toThrow(PreviewRollError);
        expect(() => new Dice(structuredClone(state), 'preview').int('combat', 1, 6, 'hit')).toThrow(PreviewRollError);
        expect(() => preview(world, state, testCommand({ type: 'testSwallow', crew: 'jun' }))).toThrow(PreviewRollError);
        expect(step(world, state, testCommand({ type: 'testSwallow', crew: 'jun' })).undoable).toBe(false);
    });

    it('stops a preview at a roll it shows the odds of, and rolls on commit', () => {
        const { world, state } = smallBank();
        const seen = preview(world, state, testCommand({ type: 'testOdds', crew: 'jun' }));
        expect(seen.pending).toEqual({ stream: 'resist', p: 0.25, reason: 'resist' });
        expect(seen.events).toEqual([{ type: 'testTried', crew: 'jun' }]);
        expect(seen.undoable).toBe(false);
        const done = step(world, state, testCommand({ type: 'testOdds', crew: 'jun' }));
        expect(done.state.dice).toHaveLength(1);
        expect(done.rolls).toEqual(done.state.dice);
        expect(done.undoable).toBe(false);
        expect(() => preview(world, state, testCommand({ type: 'testOddsTwice', crew: 'jun' }))).toThrow(PreviewRollError);
        expect(() => preview(world, state, testCommand({ type: 'testOddsThenIllegal', crew: 'jun' }))).toThrow(InvariantError);
        expect(step(world, state, testCommand({ type: 'testOddsThenIllegal', crew: 'jun' })).rolls).toHaveLength(1);
        expect(() => new Dice(structuredClone(state), 'commit').odds('resist', 1.5, 'bad')).toThrow(/between 0 and 1/);
    });

    it('returns every roll of a command, beyond the window the state keeps', () => {
        const { world, state } = smallBank();
        // Clones with no person in the world: out cold, so perception (which needs their observer class) skips them.
        const many = { ...state, npcs: Array.from({ length: 40 }, (_, i) => ({ ...state.npcs[0]!, id: `n${i}`, status: 'unconscious' as const })) };
        const result = step(world, many, { type: 'endTurn' });
        expect(result.rolls).toHaveLength(40);
        expect(result.state.dice).toEqual(result.rolls.slice(-DICE_WINDOW));
    });

    it('logs rolls in a bounded window and keeps each stream to itself', () => {
        const { state } = smallBank();
        const a = structuredClone(state), dice = new Dice(a, 'commit');
        const first = dice.next('combat', 'hit');
        dice.int('panic', 1, 6, 'flee');
        expect(new Dice(structuredClone(state), 'commit').next('combat', 'hit')).toBe(first);
        expect(a.dice.map(d => d.stream)).toEqual(['combat', 'panic']);
        expect(Object.keys(a.rng).sort()).toEqual(['combat', 'panic']);
        for (let i = 0; i < 100; i++) dice.next('combat', 'spam');
        expect(a.dice).toHaveLength(DICE_WINDOW);
    });

    it('refuses illegal commands', () => {
        const { world, state } = smallBank();
        expect(() => step(world, state, { type: 'move', crew: 'nobody', path: [{ x: 1, y: 0 }] })).toThrow(IllegalCommand);
        expect(() => step(world, state, { type: 'move', crew: 'jun', path: [{ x: 3, y: 0 }] })).toThrow(IllegalCommand);
        const tired = play(world, state, [SCRIPT[0]!, { type: 'move', crew: 'jun', path: [{ x: 3, y: 0 }] }]);
        expect(tired.crew[0]!.actionsLeft).toBe(0);
        expect(() => step(world, tired, { type: 'move', crew: 'jun', path: [{ x: 4, y: 0 }] })).toThrow(IllegalCommand);
    });

    it('guards its registries', () => {
        expect(() => registerCommand('wait', () => {})).toThrow(/already registered/);
        expect(() => registerWorldHook('devices', 'test.dice', () => {})).toThrow(/already registered/);
        expect(() => registerWorldHook('devices', 'test.nothing', () => {}, { replace: true })).toThrow(/no World hook/);
        expect(() => registerWorldHook('nowhere' as 'devices', 'x', () => {})).toThrow(/No world-phase step/);
        expect(() => registerEvents({ moved: { undoBlocking: true } })).toThrow(/already classified/);
        registerEvents({ moved: { undoBlocking: false } });
    });

    it('runs the world phase in the order of §6.1 and starts the next crew phase', () => {
        expect(WORLD_STEPS).toEqual(['passiveNpcs', 'combatNpcs', 'devices', 'commitIntents', 'crewPhase']);
        expect(worldHooks()).toEqual({
            passiveNpcs: ['perception.world', 'trespass.deadlines', 'npcs.passive'], combatNpcs: ['npcs.combat'],
            devices: ['devices.carriers', 'test.dice', 'perception.decay', 'doors.swingShut'],
            commitIntents: ['npcs.intents'], crewPhase: ['crew.actions']
        });
        const { world, state } = smallBank();
        const { state: next, events } = step(world, play(world, state, [SCRIPT[2]!]), { type: 'endTurn' });
        expect(next.turn).toBe(2);
        expect(next.phase).toBe('crew');
        expect(next.crew.map(c => c.actionsLeft)).toEqual([2, 2]);
        expect(events.filter(e => e.type === 'phaseStarted')).toEqual([
            { type: 'phaseStarted', phase: 'world', turn: 1 },
            { type: 'phaseStarted', phase: 'crew', turn: 2 }
        ]);
    });
});

describe('the engine\'s guards', () => {
    it('treats a refusal after a roll as a bug', () => {
        const { world, state } = smallBank();
        expect(() => step(world, state, testCommand({ type: 'testRollThenIllegal' }))).toThrow(InvariantError);
    });

    it('never lets an action that changed an NPC be undone, whatever its events', () => {
        const { world, state } = smallBank();
        const result = step(world, state, testCommand({ type: 'testNudge' }));
        expect(result.events).toEqual([{ type: 'testTried', crew: 'jun' }]);
        expect(result.undoable).toBe(false);
    });

    it('gives the reducer its own frozen copy of the command', () => {
        const { world, state } = smallBank();
        const cmd = testCommand({ type: 'testWriteCommand', crew: 'jun' });
        expect(() => step(world, state, cmd)).toThrow(TypeError);
        expect(Object.isFrozen(cmd)).toBe(false);
    });

    it('logs what kind of roll each was, and its odds', () => {
        const { world, state } = smallBank();
        const rolls = step(world, state, testCommand({ type: 'testOdds', crew: 'jun' })).rolls;
        expect(rolls).toEqual([{ turn: 1, kind: 'odds', stream: 'resist', reason: 'resist', value: rolls[0]!.value, p: 0.25 }]);
        const dice = new Dice(structuredClone(state), 'commit');
        dice.int('a', 1, 6, 'x');
        expect(() => dice.next('toString', 'x')).toThrow(/can't name a random stream/);
    });

    it('rejects keys a record would find on its prototype', () => {
        expect(() => assertPlainJson({ suspicion: { constructor: 1 } })).toThrow(/reserved key 'constructor'/);
        expect(() => assertPlainJson(JSON.parse('{"__proto__": 1}'))).toThrow(/reserved key/);
    });
});

describe('undo', () => {
    it('takes back a move but never the end of a turn', () => {
        const { world, state } = smallBank();
        let stack: UndoStack = [], s: State = state;
        for (const cmd of SCRIPT.slice(0, 3)) {
            const result = step(world, s, cmd);
            expect(result.undoable).toBe(true);
            stack = recordUndo(stack, s, result.undoable);
            s = result.state;
        }
        const undone = popUndo(stack)!;
        expect(undone.state.crew[0]!.actionsLeft).toBe(1);
        expect(hashOf(popUndo(popUndo(undone.stack)!.stack)!.state)).toBe(hashOf(state));

        const ended = step(world, s, { type: 'endTurn' });
        expect(ended.undoable).toBe(false);
        expect(recordUndo(stack, s, ended.undoable)).toEqual([]);
        expect(popUndo([])).toBeUndefined();
    });
});
