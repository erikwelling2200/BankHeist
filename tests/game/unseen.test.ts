import { describe, expect, it } from 'vitest';
import { describeEvent, MemoryStorage, Session, type SessionChange } from '../../src/game';
import { importance } from '../../src/game/playback';
import { clonePlain, encodeBits, fixtureWorld, initialState, type PersonDef, type Pos, type State } from '../../src/sim';

const P = (x: number, y: number): Pos => ({ x, y });
const clerk = (pos: Pos, extra: Partial<PersonDef> = {}): PersonDef => ({
    id: 'clerk', name: 'Ann', role: 'clerk', observer: 'staff', pos, facing: 'w',
    schedule: [{ from: 1, activity: 'post', label: 'at post', room: '', at: pos, facing: 'w' }], ...extra
});

const session = (world: ReturnType<typeof fixtureWorld>, state: State): Session =>
    Session.start({ world, state, storage: new MemoryStorage(), genVersion: 'fixture' });

describe('the session and NPCs the crew doesn’t know', () => {
    it('previews a move into a hidden clerk without giving the clerk away', () => {
        // The clerk stands on a dark tile past the shelves, out of the crew's sight until the move is next to it.
        const world = fixtureWorld(['.....', '.TTT.', '.....'], { people: [clerk(P(2, 2), { id: 'hidden', facing: 'n' })], dark: [P(2, 2)] });
        const s = session(world, initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] }));
        const path = [P(0, 1), P(0, 2), P(1, 2), P(2, 2), P(3, 2)];
        const shown = s.playerPreview({ type: 'move', crew: 'jun', path });
        expect(JSON.stringify(shown.events)).not.toContain('hidden');
        // Played for real, the bump is told, the camera visits it, and the log says why the crew stopped.
        s.commit({ type: 'move', crew: 'jun', path });
        const cut = s.recent.find(e => e.type === 'moveCut')!;
        expect(cut).toBeDefined();
        expect(importance(cut, s.state)).toBe('surprise');
        expect(describeEvent(s.world, s.state, cut)).toMatch(/stopped at/);
    });

    it('says a commit was noticed by someone unseen, so Undo greys out with a hint', () => {
        // The clerk stands in the dark, out of the crew's halved sight (13 / 2 = 6), and, on edge, sees Jun 7 tiles off
        // in the light with its whole cone as Core.
        const world = fixtureWorld(['..........'], { people: [clerk(P(8, 0), { id: 'hidden' })], dark: [P(7, 0), P(8, 0), P(9, 0)], zones: ['ssssssssss'] });
        const state = clonePlain(initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] }));
        state.knowledge.seen = encodeBits(new Uint8Array(10).fill(1));
        state.npcs[0]!.alerted = true;
        const s = session(world, state), changes: SessionChange[] = [];
        s.subscribe(c => changes.push(c));
        s.commit({ type: 'move', crew: 'jun', path: [P(1, 0)] });
        expect(changes.at(-1)).toMatchObject({ kind: 'commit', noticedUnseen: true });
        expect(s.canUndo).toBe(false);
    });
});
