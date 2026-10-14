import { describe, expect, it } from 'vitest';
import {
    commit, deserialise, Dice, hashOf, IllegalCommand, popUndo, preview, PreviewRollError, recordUndo, registerWorldHook,
    serialise, worldHooks, WORLD_STEPS, type Command, type State, type UndoStack, type World
} from '../../src/sim';
import { deepFreeze, SCRIPT, smallBank } from './helpers';

// Something in the world phase rolls, so the script exercises the dice like the real systems will.
registerWorldHook('devices', 'test.dice', ctx => {
    for (const npc of ctx.state.npcs) if (ctx.dice.chance('test', 0.5, `turn ${npc.id}`)) npc.facing = npc.facing === 'n' ? 's' : 'n';
});

function play(world: World, state: State, commands: readonly Command[]): State {
    return commands.reduce((s, cmd) => commit(world, s, cmd).state, state);
}

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

    it('never changes the state it is given', () => {
        const { world, state } = smallBank();
        deepFreeze(world);
        const before = hashOf(state);
        deepFreeze(state);
        for (const cmd of SCRIPT.slice(0, 3)) commit(world, state, cmd);
        commit(world, state, { type: 'endTurn' });
        expect(hashOf(state)).toBe(before);
    });

    it('previews without changing the state, and the preview is the outcome', () => {
        const { world, state } = smallBank();
        deepFreeze(state);
        const cmd = SCRIPT[0]!;
        const seen = preview(world, state, cmd), done = commit(world, state, cmd);
        expect(seen.events).toEqual(done.events);
        expect(hashOf(seen.state)).toBe(hashOf(done.state));
        expect(state.crew[0]!.pos).toEqual({ x: 0, y: 0 });
    });

    it('throws when a preview would roll', () => {
        const { world, state } = smallBank();
        expect(() => preview(world, state, { type: 'endTurn' })).toThrow(PreviewRollError);
        expect(() => new Dice(structuredClone(state), 'preview').int('combat', 1, 6, 'hit')).toThrow(PreviewRollError);
    });

    it('logs every roll and keeps each stream to itself', () => {
        const { state } = smallBank();
        const a = structuredClone(state), dice = new Dice(a, 'commit');
        const first = dice.next('combat', 'hit');
        dice.int('panic', 1, 6, 'flee');
        const b = structuredClone(state);
        expect(new Dice(b, 'commit').next('combat', 'hit')).toBe(first);
        expect(a.dice.map(d => d.stream)).toEqual(['combat', 'panic']);
        expect(Object.keys(a.rng).sort()).toEqual(['combat', 'panic']);
    });

    it('refuses illegal commands', () => {
        const { world, state } = smallBank();
        expect(() => commit(world, state, { type: 'move', crew: 'nobody', path: [{ x: 1, y: 0 }] })).toThrow(IllegalCommand);
        expect(() => commit(world, state, { type: 'move', crew: 'jun', path: [{ x: 3, y: 0 }] })).toThrow(IllegalCommand);
        const tired = play(world, state, [SCRIPT[0]!, { type: 'move', crew: 'jun', path: [{ x: 3, y: 0 }] }]);
        expect(tired.crew[0]!.actionsLeft).toBe(0);
        expect(() => commit(world, tired, { type: 'move', crew: 'jun', path: [{ x: 4, y: 0 }] })).toThrow(IllegalCommand);
    });

    it('runs the world phase in the order of §6.1 and starts the next crew phase', () => {
        expect(WORLD_STEPS).toEqual(['passiveNpcs', 'combatNpcs', 'devices', 'commitIntents']);
        expect(worldHooks()).toEqual({
            passiveNpcs: ['npcs.passive'], combatNpcs: ['npcs.combat'], devices: ['devices.carriers', 'test.dice'],
            commitIntents: ['npcs.intents']
        });
        const { world, state } = smallBank();
        const { state: next, events } = commit(world, play(world, state, [SCRIPT[2]!]), { type: 'endTurn' });
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
        let stack: UndoStack = [], s = state;
        for (const cmd of SCRIPT.slice(0, 3)) {
            const result = commit(world, s, cmd);
            expect(result.undoable).toBe(true);
            stack = recordUndo(stack, s, result.undoable);
            s = result.state;
        }
        const undone = popUndo(stack)!;
        expect(undone.state.crew[0]!.actionsLeft).toBe(1);
        expect(hashOf(popUndo(popUndo(undone.stack)!.stack)!.state)).toBe(hashOf(state));

        const ended = commit(world, s, { type: 'endTurn' });
        expect(ended.undoable).toBe(false);
        expect(recordUndo(stack, s, ended.undoable)).toEqual([]);
        expect(popUndo([])).toBeUndefined();
    });
});

describe('saving', () => {
    it('round-trips a world and a state', () => {
        const { world, state } = smallBank();
        const mid = play(world, state, SCRIPT.slice(0, 4));
        const loaded = deserialise(serialise(world, mid));
        expect(loaded.world).toEqual(world);
        expect(loaded.state).toEqual(mid);
    });

    it('continues a reloaded heist exactly as the original', () => {
        const { world, state } = smallBank();
        const mid = play(world, state, SCRIPT.slice(0, 5));
        const loaded = deserialise(serialise(world, mid));
        const original = play(world, mid, SCRIPT.slice(5)), resumed = play(loaded.world, loaded.state, SCRIPT.slice(5));
        expect(hashOf(resumed)).toBe(hashOf(original));
        expect(hashOf(original)).toBe(hashOf(play(world, state, SCRIPT)));
    });

    it('refuses a save of another format', () => {
        const { world, state } = smallBank();
        const text = serialise(world, state).replace('"format":1', '"format":0');
        expect(() => deserialise(text)).toThrow(/format 0, this build reads format 1/);
        expect(() => deserialise('not json')).toThrow(/isn't JSON/);
        expect(() => deserialise('{"format":1}')).toThrow(/no world/);
    });
});
