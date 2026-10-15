import { describe, expect, it } from 'vitest';
import { AutoRun, autoBarView, MemoryStorage, routeViews, Session, stopLine, waitMenu } from '../../src/game';
import { autoAdvance, fixtureWorld, hashOf, initialState, type Pos, type ScheduleBlock } from '../../src/sim';
import { scouted } from '../sim/helpers';

const P = (x: number, y: number): Pos => ({ x, y });
const row = (y: number, from: number, to: number): Pos[] => Array.from({ length: to - from + 1 }, (_, i) => P(from + i, y));

const day: ScheduleBlock[] = [
    { from: 1, activity: 'post', label: 'at post', room: '', at: P(10, 2), facing: 'w' },
    { from: 3, activity: 'break', label: 'break', room: '', at: P(14, 2), facing: 'n' }
];

function street() {
    const world = fixtureWorld(['........................', 'TTTTTTTTTTTTTTTTTTTTTTT.', 'sssssssssssssssssssssss.'], {
        zones: ['........................', '.......................s', 'sssssssssssssssssssssss.'],
        people: [{ id: 'clerk', name: 'Ann', role: 'clerk', observer: 'staff', pos: P(10, 2), facing: 'w', schedule: day }]
    });
    const state = scouted(world, initialState(world, { seed: 3, crew: [{ id: 'jun', name: 'Jun', pos: P(0, 0), facing: 'e' }] }));
    return { world, state };
}

const begin = (storage = new MemoryStorage()) => {
    const { world, state } = street();
    return { session: Session.start({ world, state, storage, genVersion: 'fixture' }), storage };
};

describe('auto-advance in the session', () => {
    it('keeps routes with the UI, saves them and resumes them', () => {
        const { session, storage } = begin();
        session.setRoute('jun', row(0, 1, 18));
        expect(session.routes.jun).toHaveLength(18);
        session.save();
        expect(Session.resume(storage)!.routes.jun).toEqual(row(0, 1, 18));
        // The overlay's view: the route split into turns, two Moves a turn.
        expect(routeViews(session)[0]!.legs.map(l => l.turn)).toEqual([1, 1, 2, 2]);
    });

    it('drops a route when its crew member is moved by hand', () => {
        const { session } = begin();
        session.setRoute('jun', row(0, 1, 18));
        session.commit({ type: 'move', crew: 'jun', path: [P(1, 0)] });
        expect(session.routes.jun).toBeUndefined();
    });

    it('plays a turn through its own commits (queued, autosaved) and keeps the rest of the route', () => {
        const { session } = begin();
        session.setRoute('jun', row(0, 1, 18));
        const step = session.autoStep();
        expect(step.stop).toBeNull();
        expect(session.state.turn).toBe(2);
        expect(session.state.crew[0]!.pos).toEqual(P(10, 0));
        expect(session.routes.jun).toEqual(row(0, 11, 18));
        expect(session.playback.pending().some(i => i.event.type === 'moved')).toBe(true);
        expect(session.canUndo).toBe(false);
    });

    it('waits for the schedule event it knows, then runs to the same state as the rules alone', () => {
        const { session } = begin();
        const menu = waitMenu(session);
        expect(menu[0]!.label).toBe('Next event, turn 3: the clerk: break');
        const wait = new AutoRun(session, menu[0]!.target, menu[0]!.label);
        let done = wait.step();
        for (let i = 0; !done && i < 10; i++) done = wait.step();
        expect(stopLine(done!)).toBe("Done: it's turn 3");
        expect(session.state.turn).toBe(3);

        const from = session.state;
        session.setRoute('jun', row(0, 1, 23));
        const run = new AutoRun(session);
        let stop = run.step();
        for (let i = 0; !stop && i < 10; i++) stop = run.step();
        expect(stop).toMatchObject({ kind: 'arrived' });
        expect(stopLine(stop!)).toBe('Route walked');
        const alone = autoAdvance(session.world, from, { jun: row(0, 1, 23) });
        expect(hashOf(session.state)).toBe(hashOf(alone.state));
        expect(session.state.crew[0]!.pos).toEqual(P(23, 0));
    });

    it('stops a Go on a schedule event the crew knows of', () => {
        const { session } = begin();
        session.setRoute('jun', row(0, 1, 23));
        const run = new AutoRun(session);
        let stop = run.step();
        for (let i = 0; !stop && i < 10; i++) stop = run.step();
        expect(stopLine(stop!)).toBe('Stopped: the clerk: break');
        expect(session.routes.jun).toEqual(row(0, 21, 23));
    });

    it('shows Go only with a route, and says why it stopped', () => {
        const { session } = begin();
        expect(autoBarView(session, null, null).go).toMatchObject({ enabled: false });
        session.setRoute('jun', row(0, 1, 18));
        expect(autoBarView(session, null, null).go.enabled).toBe(true);
        const run = new AutoRun(session);
        expect(autoBarView(session, run, null)).toMatchObject({ running: true, status: 'Auto-advance: turn 1' });
        const stop = run.cancel();
        expect(autoBarView(session, null, stop)).toMatchObject({ running: false, status: 'Stopped', alert: false });
        // A wait leaves the routes alone, and the menu says so.
        expect(autoBarView(session, null, null).wait.note).toMatch(/stays put/);
    });

    it('saves the routes left with each auto commit, and resumes the last stop', () => {
        const { session, storage } = begin();
        session.setRoute('jun', row(0, 1, 18));
        const step = session.autoStep({ cap: 1 });
        // Auto-advance's own commits saved the routes as they were after each one.
        expect(Session.resume(storage)!.routes.jun).toEqual(row(0, 11, 18));
        session.setAutoStop(step.stop);
        session.save();
        expect(Session.resume(storage)!.ui.autoStop).toEqual(step.stop);

    });

    it('restores the routes on undo', () => {
        const { session } = begin();
        session.setRoute('jun', row(0, 1, 18));
        session.commit({ type: 'move', crew: 'jun', path: [P(1, 0)] });
        expect(session.routes.jun).toBeUndefined();
        expect(session.undo()).toBe(true);
        expect(session.routes.jun).toEqual(row(0, 1, 18));
    });
});
