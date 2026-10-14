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
    it('previews a dash past a hidden clerk without giving the clerk away', () => {
        const world = fixtureWorld(['............', 'TTTTTT.TTTTT', '............'], { people: [clerk(P(6, 2), { id: 'hidden', facing: 'n' })] });
        const s = session(world, initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] }));
        const path = [P(1, 0), P(2, 0), P(3, 0), P(4, 0), P(5, 0), P(6, 0), P(7, 0)];
        const shown = s.playerPreview({ type: 'dash', crew: 'jun', path });
        expect(JSON.stringify(shown.events)).not.toContain('hidden');
        // Played for real, the cut is told, the camera visits it, and the log says why the crew stopped.
        s.commit({ type: 'dash', crew: 'jun', path });
        const cut = s.recent.find(e => e.type === 'moveCut')!;
        expect(cut).toBeDefined();
        expect(importance(cut, s.state)).toBe('surprise');
        expect(describeEvent(s.world, s.state, cut)).toMatch(/stopped at/);
    });

    it('says a commit was noticed by someone unseen, so Undo greys out with a hint', () => {
        const world = fixtureWorld(['.........'], { people: [clerk(P(7, 0), { id: 'hidden' })], dark: [P(6, 0), P(7, 0), P(8, 0)], zones: ['sssssssss'] });
        const state = clonePlain(initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] }));
        state.knowledge.seen = encodeBits(new Uint8Array(9).fill(1));
        const s = session(world, state), changes: SessionChange[] = [];
        s.subscribe(c => changes.push(c));
        s.commit({ type: 'move', crew: 'jun', path: [P(1, 0)] });
        expect(changes.at(-1)).toMatchObject({ kind: 'commit', noticedUnseen: true });
        expect(s.canUndo).toBe(false);
    });
});
