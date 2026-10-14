import { describe, expect, it, vi } from 'vitest';
import {
    crewCards, HEIST_KEY, installDebugHandle, MemoryStorage, PlaybackQueue, PREVIEW_CACHE, registerImportance, Session, threatLedger, UI_KEY, worldKey, type SessionChange, type SimHandle
} from '../../src/game';
import { commit as engineCommit, fixtureWorld, hashOf, IllegalCommand, SaveFormatError, startCarrier, type Command } from '../../src/sim';
import { registerTestCommand, smallBank, testCommand, type TestCommand } from '../sim/helpers';
import { CREW_COLOURS } from '../../src/ui/hud/viewModels';

/** Starts a teller-button carrier: final, since the world reacted. */
registerTestCommand('gameTestAlarm', (ctx, cmd) => {
    startCarrier(ctx, { kind: 'tellerButton', source: 'teller', pos: { x: 7, y: 0 }, countdown: (cmd as { countdown?: number }).countdown ?? 2 });
});
/** Tells the crew something: final. */
registerTestCommand('gameTestScout', (ctx, cmd) => {
    ctx.emit({ type: 'revealed', what: 'room', id: cmd.crew ?? '' });
});
const alarm = (countdown: number): Command => testCommand({ type: 'gameTestAlarm', countdown } as TestCommand);

const MOVE_JUN: Command = { type: 'move', crew: 'jun', path: [{ x: 1, y: 0 }] };
const MOVE_MARA: Command = { type: 'move', crew: 'mara', path: [{ x: 1, y: 2 }] };

function start(storage = new MemoryStorage()): { session: Session; storage: MemoryStorage } {
    const { world, state } = smallBank();
    return { session: Session.start({ world, state, storage, genVersion: 'fixture' }), storage };
}

/** Everything resuming must bring back. */
const fingerprint = (s: Session): string => hashOf({ state: s.state, undo: [...s.undoStack], recent: [...s.recent], ui: s.ui });

describe('the game session', () => {
    it('commits as the engine does and keeps undo by its undoable flag', () => {
        const { session } = start();
        const { world, state } = smallBank();
        const expected = engineCommit(world, state, MOVE_JUN);
        const result = session.commit(MOVE_JUN);
        expect(result.undoable).toBe(true);
        expect(hashOf(session.state)).toBe(hashOf(expected.state));
        expect(session.undoStack).toHaveLength(1);
        session.commit(MOVE_MARA);
        expect(session.undoStack).toHaveLength(2);

        expect(session.undo()).toBe(true);
        expect(session.state.crew.find(c => c.id === 'mara')!.pos).toEqual({ x: 0, y: 2 });
        expect(session.undo()).toBe(true);
        expect(hashOf(session.state)).toBe(hashOf(state));
        expect(session.recent).toEqual([]);
        expect(session.undo()).toBe(false);
    });

    it('empties the undo stack after a final action', () => {
        const { session } = start();
        session.commit(MOVE_JUN);
        const scout = session.commit(testCommand({ type: 'gameTestScout', crew: 'jun' }));
        expect(scout.undoable).toBe(false);
        expect(session.canUndo).toBe(false);
        expect(session.undo()).toBe(false);
        session.commit(MOVE_MARA);
        session.endTurn();
        expect(session.canUndo).toBe(false);
        expect(session.state.turn).toBe(2);
    });

    it('refuses an illegal command without changing anything', () => {
        const { session, storage } = start();
        const before = fingerprint(session), writes = storage.writesOf(HEIST_KEY);
        expect(() => session.commit({ type: 'move', crew: 'nobody', path: [{ x: 1, y: 0 }] })).toThrow(IllegalCommand);
        expect(fingerprint(session)).toBe(before);
        expect(storage.writesOf(HEIST_KEY)).toBe(writes);
    });

    it('caches previews per state and command, and they match the commit', () => {
        const { session } = start();
        const a = session.preview(MOVE_JUN);
        expect(session.playerPreview(MOVE_JUN).events).toEqual(a.events);
        expect(session.preview({ type: 'move', crew: 'jun', path: [{ x: 1, y: 0 }] })).toBe(a);
        expect(Object.isFrozen(a.state)).toBe(true);
        expect(() => session.preview({ type: 'wait', crew: 'nobody' })).toThrow(IllegalCommand);
        expect(() => session.preview({ type: 'wait', crew: 'nobody' })).toThrow(IllegalCommand);
        const done = session.commit(MOVE_JUN);
        expect(hashOf(done.state)).toBe(hashOf(a.state));
        expect(done.events).toEqual(a.events);
        expect(() => session.preview(MOVE_JUN)).toThrow(IllegalCommand);
    });

    it('autosaves after every commit, undo and end of turn, and writes the world once', () => {
        const { session, storage } = start();
        expect(storage.writesOf(HEIST_KEY)).toBe(1);
        session.commit(MOVE_JUN);
        expect(storage.writesOf(HEIST_KEY)).toBe(2);
        session.undo();
        expect(storage.writesOf(HEIST_KEY)).toBe(3);
        session.commit(MOVE_JUN);
        session.endTurn();
        session.commit(MOVE_MARA);
        expect(storage.writesOf(HEIST_KEY)).toBe(6);
        expect(storage.writesOf(worldKey(session.worldId))).toBe(1);
        expect(storage.data.get(HEIST_KEY)).not.toContain('"tiles"');
        // Resuming and playing on doesn't write the world again.
        const resumed = Session.resume(storage)!;
        resumed.commit({ type: 'wait', crew: 'jun' });
        expect(storage.writesOf(worldKey(session.worldId))).toBe(1);
        expect(storage.writesOf(HEIST_KEY)).toBe(7);
    });

    it('replaces the world of an older heist', () => {
        const storage = new MemoryStorage();
        storage.set(worldKey('old'), '{}');
        const { session } = start(storage);
        expect(storage.keys().sort()).toEqual([HEIST_KEY, worldKey(session.worldId)].sort());
    });

    it('resumes exactly: state, undo stack, recent events, selection and camera', () => {
        const { session, storage } = start();
        session.commit(alarm(3));
        session.commit(MOVE_JUN);
        session.commit(MOVE_MARA);
        session.select('mara');
        session.setCamera({ x: 3.5, y: 1.25, zoom: 4 });
        session.save();

        const resumed = Session.resume(storage)!;
        expect(resumed).not.toBeNull();
        expect(fingerprint(resumed)).toBe(fingerprint(session));
        expect(resumed.selected).toBe('mara');
        expect(resumed.camera).toEqual({ x: 3.5, y: 1.25, zoom: 4 });
        expect(resumed.worldId).toBe(session.worldId);
        expect(hashOf(resumed.world)).toBe(hashOf(session.world));
        expect(Object.isFrozen(resumed.world.tiles)).toBe(true);
        // Undo works across the reload, and both continue identically.
        expect(resumed.undo()).toBe(true);
        session.undo();
        expect(fingerprint(resumed)).toBe(fingerprint(session));
        resumed.endTurn();
        session.endTurn();
        expect(hashOf(resumed.state)).toBe(hashOf(session.state));
    });

    it('resumes nothing from an empty storage and refuses another format', () => {
        const storage = new MemoryStorage();
        expect(Session.resume(storage)).toBeNull();
        expect(Session.lastResumeError).toBeNull();
        const { session } = start(storage);
        const good = storage.get(HEIST_KEY)!;
        storage.set(HEIST_KEY, good.replace(/"format":\d+/, '"format":0'));
        expect(Session.resume(storage)).toBeNull();
        expect(Session.lastResumeError).toBeInstanceOf(SaveFormatError);
        // A world that isn't the one the heist was played in, or no world at all.
        storage.set(HEIST_KEY, good);
        const world = storage.get(worldKey(session.worldId))!;
        storage.set(worldKey(session.worldId), world.replace('"actionsPerTurn":2', '"actionsPerTurn":3'));
        expect(Session.resume(storage)).toBeNull();
        expect(String(Session.lastResumeError)).toMatch(/isn't the world/);
        storage.remove(worldKey(session.worldId));
        expect(Session.resume(storage)).toBeNull();
        expect(String(Session.lastResumeError)).toMatch(/missing/);
        storage.set(worldKey(session.worldId), world);
        expect(Session.resume(storage)).not.toBeNull();
    });

    it('never leaves a heist pointing at a world it deleted', () => {
        const storage = new MemoryStorage();
        const old = start(storage).session;
        old.commit(MOVE_JUN);
        // A new heist on another world whose world write fails (a full quota).
        const set = storage.set.bind(storage);
        storage.set = (key, value) => {
            if (key.startsWith('world:')) throw new Error('quota');
            set(key, value);
        };
        const { state } = smallBank();
        const other = Session.start({ world: fixtureWorld(['...']), state: { ...state, crew: [] }, storage, genVersion: 'fixture' });
        expect(other.lastSaveError).toBeInstanceOf(Error);
        expect(storage.get(HEIST_KEY)).toBeNull();
        expect(storage.get(worldKey(old.worldId))).not.toBeNull();
        expect(Session.resume(storage)).toBeNull();
        expect(Session.lastResumeError).toBeNull();
    });

    it('hands out frozen state, results and events', () => {
        const { session } = start();
        const result = session.commit(MOVE_JUN);
        expect(Object.isFrozen(session.state.crew[0]!.pos)).toBe(true);
        expect(Object.isFrozen(result.events[0])).toBe(true);
        expect(Object.isFrozen(session.recent)).toBe(true);
        expect(Object.isFrozen(session.undoStack[0]!.crew)).toBe(true);
        expect(Object.isFrozen(session.playback.peek()!.event)).toBe(true);
        expect(() => { session.state.crew[0]!.actionsLeft = 9; }).toThrow(TypeError);
    });

    it('writes UI changes alone, debounced, and resumes them', () => {
        vi.useFakeTimers();
        try {
            const { session, storage } = start();
            session.commit(MOVE_JUN);
            const heistWrites = storage.writesOf(HEIST_KEY);
            session.select('mara');
            session.setCamera({ x: 1, y: 2, zoom: 3 });
            session.setPendingCommand(MOVE_MARA);
            expect(storage.writesOf(UI_KEY)).toBe(0);
            vi.advanceTimersByTime(1000);
            expect(storage.writesOf(UI_KEY)).toBe(1);
            expect(storage.writesOf(HEIST_KEY)).toBe(heistWrites);
            const resumed = Session.resume(storage)!;
            expect(resumed.ui).toEqual({ selected: 'mara', camera: { x: 1, y: 2, zoom: 3 }, pendingCommand: MOVE_MARA });
            // A commit clears the pending command; the heist save then carries the UI, and an older UI entry is ignored.
            session.commit(MOVE_MARA);
            expect(session.pendingCommand).toBeNull();
            expect(Session.resume(storage)!.ui).toEqual({ selected: 'mara', camera: { x: 1, y: 2, zoom: 3 }, pendingCommand: null });
        } finally {
            vi.useRealTimers();
        }
    });

    it('drops a saved UI that no longer fits, and an undo stack without its events', () => {
        const { session, storage } = start();
        session.commit(MOVE_JUN);
        const heist = JSON.parse(storage.get(HEIST_KEY)!) as Record<string, unknown>;
        storage.set(HEIST_KEY, JSON.stringify({ ...heist, ui: { selected: 'ghost', camera: { x: 'a', y: 0, zoom: 1 }, pendingCommand: 5 }, undoRecent: [] }));
        const resumed = Session.resume(storage)!;
        expect(resumed.ui).toEqual({ selected: null, camera: null, pendingCommand: null });
        expect(resumed.canUndo).toBe(false);
        expect(hashOf(resumed.state)).toBe(hashOf(session.state));
    });

    it('keeps playing when the storage is full', () => {
        const { session, storage } = start();
        storage.set = () => { throw new Error('quota'); };
        session.commit(MOVE_JUN);
        expect(session.lastSaveError).toBeInstanceOf(Error);
        expect(session.state.crew[0]!.pos).toEqual({ x: 1, y: 0 });
    });

    it('recaps the last three events, the bank, the turn and the crew', () => {
        const { session, storage } = start();
        session.commit({ type: 'wait', crew: 'jun' });
        session.commit(alarm(2));
        session.commit(MOVE_MARA);
        const recap = Session.resume(storage)!.recap();
        expect(recap.turn).toBe(1);
        expect(recap.events).toEqual([
            { turn: 1, text: 'jun waited' },
            { turn: 1, text: 'Teller button: alarm in 2' },
            { turn: 1, text: 'mara moved to (1, 2)' }
        ]);
        expect(recap.bank).toEqual({ status: 'quiet', label: 'QUIET: alarm in 2', nextAlarmIn: 2 });
        expect(recap.crew).toEqual([
            { id: 'jun', name: 'jun', colour: CREW_COLOURS[0], portrait: 'jun', status: 'done', actionsLeft: 0, exposed: false, hp: null },
            { id: 'mara', name: 'mara', colour: CREW_COLOURS[1], portrait: 'mara', status: 'ready', actionsLeft: 1, exposed: false, hp: null }
        ]);
        expect(recap.threats.map(t => t.countdown)).toEqual([2]);
        session.endTurn();
        session.endTurn();
        expect(session.recap().bank.status).toBe('alarm');
        expect(session.recap().events.at(-1)).toEqual({ turn: 3, text: 'Turn 3' });
        expect(session.recap().events.map(e => e.turn)).toEqual([2, 2, 3]);
    });

    it('records each recent event\'s turn as it is appended, and keeps it through undo and resume', () => {
        const { session, storage } = start();
        session.commit({ type: 'wait', crew: 'jun' });
        session.endTurn();
        session.commit(MOVE_MARA);
        const turns = [...session.recentTurns];
        expect(turns).toHaveLength(session.recent.length);
        expect(turns[0]).toBe(1);
        expect(turns.at(-1)).toBe(2);
        expect(Session.resume(storage)!.recentTurns).toEqual(turns);
        const resumed = Session.resume(storage)!;
        resumed.undo();
        expect(resumed.recentTurns).toEqual(turns.slice(0, -1));
        expect(resumed.recap().events.at(-1)!.turn).toBe(2);
    });

    it('tells subscribers what changed, and stops when they unsubscribe', () => {
        const { session } = start();
        const seen: SessionChange['kind'][] = [];
        const off = session.subscribe(change => seen.push(change.kind));
        session.commit(MOVE_JUN);
        session.undo();
        session.select('jun');
        session.endTurn();
        off();
        session.commit(MOVE_JUN);
        expect(seen).toEqual(['commit', 'undo', 'ui', 'endTurn']);
    });

    it('reports a listener that throws, and tells changes made inside a listener after the current one', () => {
        const errors: unknown[] = [];
        const { world, state } = smallBank();
        const session = Session.start({ world, state, storage: new MemoryStorage(), genVersion: 'fixture', onListenerError: e => errors.push(e) });
        const seen: string[] = [];
        session.subscribe(change => {
            seen.push(`a:${change.kind}`);
            if (change.kind === 'commit') session.select('jun');
        });
        session.subscribe(change => {
            seen.push(`b:${change.kind}`);
            throw new Error('boom');
        });
        expect(() => session.commit(MOVE_JUN)).not.toThrow();
        expect(seen).toEqual(['a:commit', 'b:commit', 'a:ui', 'b:ui']);
        expect(errors).toHaveLength(2);
    });

    it('keeps the most recent previews', () => {
        const { session } = start();
        const first = session.preview(MOVE_JUN);
        for (let i = 0; i < PREVIEW_CACHE; i++) session.preview({ type: 'move', crew: 'mara', path: [{ x: 1, y: 2 }], extra: i } as Command);
        expect(session.preview(MOVE_JUN)).not.toBe(first);
        const again = session.preview(MOVE_JUN);
        expect(session.preview(MOVE_JUN)).toBe(again);
    });
});

describe('the playback queue', () => {
    it('queues the events of each commit with their importance', () => {
        const { session } = start();
        session.commit(MOVE_JUN);
        session.commit(alarm(2));
        session.endTurn();
        const items = session.playback.drain();
        expect(items.map(i => [i.event.type, i.important])).toEqual([
            ['moved', null], ['carrierStarted', 'carrier'], ['phaseStarted', null], ['carrierTicked', 'carrier'], ['phaseStarted', null]
        ]);
        expect(items.map(i => i.seq)).toEqual([0, 1, 2, 3, 4]);
        // The world phase belongs to the turn that ended until the next crew phase starts.
        expect(items.map(i => i.turn)).toEqual([1, 1, 1, 1, 2]);
        expect(session.playback.pending()).toEqual([]);
        expect(session.playback.length).toBe(0);
    });

    it('lets a package mark its events important, and drops playback on undo', () => {
        registerImportance('moved', e => (e.to.x > 5 ? 'arrival' : null));
        try {
            const { session } = start();
            session.commit({ type: 'move', crew: 'jun', path: [{ x: 1, y: 0 }] });
            expect(session.playback.peek()!.important).toBeNull();
            session.commit(MOVE_MARA);
            session.undo();
            expect(session.playback.pending().map(i => i.event.type)).toEqual(['moved']);
            expect(session.playback.peek()!.event).toMatchObject({ crew: 'jun' });
            const queue = new PlaybackQueue();
            queue.push([{ type: 'moved', crew: 'jun', from: { x: 5, y: 0 }, to: { x: 6, y: 0 }, path: [{ x: 6, y: 0 }] }], session.state);
            expect(queue.next()!.important).toBe('arrival');
            queue.speed = '2x';
            expect(queue.duration(400)).toBe(200);
            queue.speed = 'instant';
            expect(queue.duration(400)).toBe(0);
        } finally {
            registerImportance('moved', () => null);
        }
    });
});

describe('the HUD view models', () => {
    it('shows the turn, the bank, the crew rail and the threat ledger by urgency', () => {
        const { session } = start();
        session.commit(alarm(4));
        session.commit(alarm(2));
        session.select('jun');
        session.commit(MOVE_JUN);
        const hud = session.hud();
        expect(hud.turn).toBe(1);
        expect(hud.selected).toBe('jun');
        expect(hud.crew[0]).toEqual({ id: 'jun', name: 'jun', colour: CREW_COLOURS[0], portrait: 'jun', actionsLeft: 1, actionsMax: 2, selected: true, profile: 'unknown', exposedTo: [], hp: null });
        expect(hud.crew[1]!.selected).toBe(false);
        expect(hud.crew[1]!.colour).toBe(CREW_COLOURS[1]);
        expect(hud.undoEnabled).toBe(true);
        expect(hud.ledger.map(t => [t.id, t.countdown])).toEqual([['carrier-2', 2], ['carrier-1', 4]]);
        expect(hud.ledger[0]).toMatchObject({ kind: 'tellerButton', label: 'Teller button', countdown: 2, halted: null });
        expect(hud.ledger[0]!.label).not.toMatch(/\d/);
        const paused = { ...session.state, carriers: session.state.carriers.map(c => (c.countdown === 2 ? { ...c, halted: 'paused' as const } : c)) };
        expect(threatLedger(paused).map(t => [t.id, t.halted])).toEqual([['carrier-1', null], ['carrier-2', 'paused']]);
        const exposed = structuredClone(session.state);
        exposed.npcs[0]!.exposedTo = ['jun'];
        expect(crewCards(session.world, exposed, null).map(c => c.exposedTo)).toEqual([['teller'], []]);
    });
});

describe('the debug handle', () => {
    it('is live', () => {
        const { session } = start();
        const target: { sim?: SimHandle } = {};
        const remove = installDebugHandle(session, target);
        const sim = target.sim!;
        sim.commit(MOVE_JUN);
        expect(sim.state).toBe(session.state);
        expect(sim.state.crew[0]!.pos).toEqual({ x: 1, y: 0 });
        expect(sim.preview(MOVE_MARA).undoable).toBe(true);
        expect(sim.undo()).toBe(true);
        expect(sim.state.crew[0]!.pos).toEqual({ x: 0, y: 0 });
        sim.endTurn();
        expect(sim.state.turn).toBe(2);
        expect(sim.world).toBe(session.world);
        const path = sim.path('jun', { x: 1, y: 0 })!;
        expect(path.at(-1)).toEqual({ x: 1, y: 0 });
        expect(sim.commit({ type: 'move', crew: 'jun', path }).state.crew[0]!.pos).toEqual({ x: 1, y: 0 });
        expect(sim.path('jun', { x: 99, y: 99 })).toBeUndefined();
        remove();
        expect(target.sim).toBeUndefined();
    });
});
