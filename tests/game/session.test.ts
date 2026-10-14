import { describe, expect, it } from 'vitest';
import {
    crewCards, HEIST_KEY, installDebugHandle, MemoryStorage, PlaybackQueue, registerImportance, Session, threatLedger, worldKey, type SessionChange, type SimHandle
} from '../../src/game';
import { commit as engineCommit, hashOf, IllegalCommand, registerCommand, SaveFormatError, startCarrier, type Command } from '../../src/sim';
import { smallBank } from '../sim/helpers';

declare module '../../src/sim/core/types' {
    interface CommandMap {
        /** Starts a teller-button carrier: final, since the world reacted. */
        gameTestAlarm: { countdown: number };
        /** Tells the crew something: final. */
        gameTestScout: { crew: string };
    }
}

registerCommand('gameTestAlarm', (ctx, cmd) => {
    startCarrier(ctx, { kind: 'tellerButton', source: 'teller', pos: { x: 7, y: 0 }, countdown: cmd.countdown });
});
registerCommand('gameTestScout', (ctx, cmd) => {
    ctx.emit({ type: 'revealed', what: 'room', id: cmd.crew });
});

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
        const scout = session.commit({ type: 'gameTestScout', crew: 'jun' });
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
        expect(() => session.preview(MOVE_JUN)).toThrow(/isn't next to/);
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
        session.commit({ type: 'gameTestAlarm', countdown: 3 });
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
        start(storage);
        storage.set(HEIST_KEY, storage.get(HEIST_KEY)!.replace(/"format":\d+/, '"format":0'));
        expect(() => Session.resume(storage)).toThrow(SaveFormatError);
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
        session.commit({ type: 'gameTestAlarm', countdown: 2 });
        session.commit(MOVE_MARA);
        const recap = Session.resume(storage)!.recap();
        expect(recap.turn).toBe(1);
        expect(recap.recent.map(r => r.event.type)).toEqual(['waited', 'carrierStarted', 'moved']);
        expect(recap.recent[2]!.text).toBe('mara moved to (1, 2)');
        expect(recap.bank).toEqual({ status: 'quiet', label: 'QUIET: alarm in 2', nextAlarmIn: 2 });
        expect(recap.crew).toEqual([
            { id: 'jun', name: 'jun', status: 'done', actionsLeft: 0, exposed: false },
            { id: 'mara', name: 'mara', status: 'ready', actionsLeft: 1, exposed: false }
        ]);
        expect(recap.threats.map(t => t.countdown)).toEqual([2]);
        session.endTurn();
        session.endTurn();
        expect(session.recap().bank.status).toBe('alarm');
        expect(session.recap().recent.at(-1)!.event).toEqual({ type: 'phaseStarted', phase: 'crew', turn: 3 });
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
});

describe('the playback queue', () => {
    it('queues the events of each commit with their importance', () => {
        const { session } = start();
        session.commit(MOVE_JUN);
        session.commit({ type: 'gameTestAlarm', countdown: 2 });
        session.endTurn();
        const items = session.playback.drain();
        expect(items.map(i => [i.event.type, i.important])).toEqual([
            ['moved', null], ['carrierStarted', 'carrier'], ['phaseStarted', null], ['carrierTicked', 'carrier'], ['phaseStarted', null]
        ]);
        expect(items.map(i => i.seq)).toEqual([0, 1, 2, 3, 4]);
        expect(session.playback.length).toBe(0);
    });

    it('lets a package mark its events important, and drops playback on undo', () => {
        registerImportance('moved', e => (e.to.x > 5 ? 'arrival' : null));
        try {
            const { session } = start();
            session.commit({ type: 'move', crew: 'jun', path: [{ x: 1, y: 0 }] });
            expect(session.playback.peek()!.important).toBeNull();
            session.undo();
            expect(session.playback.length).toBe(0);
            const queue = new PlaybackQueue();
            queue.push([{ type: 'moved', crew: 'jun', from: { x: 5, y: 0 }, to: { x: 6, y: 0 } }], session.state);
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
        session.commit({ type: 'gameTestAlarm', countdown: 4 });
        session.commit({ type: 'gameTestAlarm', countdown: 2 });
        session.select('jun');
        session.commit(MOVE_JUN);
        const hud = session.hud();
        expect(hud.turn).toBe(1);
        expect(hud.selected).toBe('jun');
        expect(hud.crew[0]).toEqual({ id: 'jun', name: 'jun', actionsLeft: 1, actionsMax: 2, selected: true, profile: 'unknown', exposedTo: [], hp: null });
        expect(hud.crew[1]!.selected).toBe(false);
        expect(hud.threats.map(t => [t.id, t.countdown])).toEqual([['carrier-2', 2], ['carrier-1', 4]]);
        const paused = { ...session.state, carriers: session.state.carriers.map(c => (c.countdown === 2 ? { ...c, halted: 'paused' as const } : c)) };
        expect(threatLedger(paused).map(t => t.id)).toEqual(['carrier-1', 'carrier-2']);
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
        remove();
        expect(target.sim).toBeUndefined();
    });
});
