import { describe, expect, it } from 'vitest';
import {
    deepFreeze, Dice, DICE_WINDOW, hashOf, IllegalCommand, popUndo, preview, PreviewRollError, recordUndo,
    registerCommand, registerEvents, registerWorldHook, worldHooks, WORLD_STEPS, type State, type UndoStack
} from '../../src/sim';
import { play, SCRIPT, smallBank, step } from './helpers';

declare module '../../src/sim/core/types' {
    interface CommandMap {
        testSwallow: { crew: string };
        testOdds: { crew: string };
    }
    interface EventMap { testTried: { crew: string } }
}

// Something in the world phase rolls, so the script exercises the dice like the real systems will.
registerWorldHook('devices', 'test.dice', ctx => {
    for (const npc of ctx.state.npcs) if (ctx.dice.chance('test', 0.5, `turn ${npc.id}`)) npc.facing = npc.facing === 'n' ? 's' : 'n';
}, { order: 10 });

// A reducer that tries to hide a roll from the preview.
registerCommand('testSwallow', (ctx, cmd) => {
    try {
        ctx.dice.int('combat', 1, 6, 'hit');
    } catch {
        ctx.state.crew.find(c => c.id === cmd.crew)!.actionsLeft = 0;
    }
});

// A reducer that shows its odds: an event, then a roll.
registerCommand('testOdds', (ctx, cmd) => {
    ctx.emit({ type: 'testTried', crew: cmd.crew });
    if (ctx.dice.odds('resist', 0.25, 'resist')) ctx.state.crew.find(c => c.id === cmd.crew)!.actionsLeft = 0;
});
registerEvents({ testTried: { undoBlocking: false } });

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
        expect(() => preview(world, state, { type: 'testSwallow', crew: 'jun' })).toThrow(PreviewRollError);
        expect(step(world, state, { type: 'testSwallow', crew: 'jun' }).undoable).toBe(false);
    });

    it('stops a preview at a roll it shows the odds of, and rolls on commit', () => {
        const { world, state } = smallBank();
        const seen = preview(world, state, { type: 'testOdds', crew: 'jun' });
        expect(seen.pending).toEqual({ stream: 'resist', p: 0.25, reason: 'resist' });
        expect(seen.events).toEqual([{ type: 'testTried', crew: 'jun' }]);
        expect(seen.undoable).toBe(false);
        const done = step(world, state, { type: 'testOdds', crew: 'jun' });
        expect(done.state.dice).toHaveLength(1);
        expect(done.undoable).toBe(false);
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
        expect(() => registerCommand('wait', () => {})).toThrow(/already has a reducer/);
        expect(() => registerWorldHook('devices', 'test.dice', () => {})).toThrow(/already in step/);
        expect(() => registerWorldHook('nowhere' as 'devices', 'x', () => {})).toThrow(/No world-phase step/);
        expect(() => registerEvents({ moved: { undoBlocking: true } })).toThrow(/already classified/);
        registerEvents({ moved: { undoBlocking: false } });
    });

    it('runs the world phase in the order of §6.1 and starts the next crew phase', () => {
        expect(WORLD_STEPS).toEqual(['passiveNpcs', 'combatNpcs', 'devices', 'commitIntents', 'crewPhase']);
        expect(worldHooks()).toEqual({
            passiveNpcs: ['npcs.passive'], combatNpcs: ['npcs.combat'], devices: ['devices.carriers', 'test.dice'],
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
