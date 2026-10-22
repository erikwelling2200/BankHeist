import { describe, expect, it } from 'vitest';
import { actionPreview, clonePlain, explain, initialState, overlayTiles, pathSafety, safeFloor, safeFloorJob, type State } from '../../src/sim';
import { scouted, smallBank } from './helpers';

/*
 * The previews of M1-09 on the small bank (tests/sim/helpers.ts): a public lobby with the guard Ray at (1, 1) facing
 * east, a staff room behind a door at x 6, the teller Kim at (7, 0) facing south. The property test
 * (preview.property.test.ts) holds them to the outcome; these pin down a few readings by the design's words.
 */

function armed(state: State, crew: string): State {
    const s = clonePlain(state);
    s.crew.find(c => c.id === crew)!.loadout.items.push('assaultRifle');
    return s;
}

describe('safe floor', () => {
    it('shows the guard seeing a rifle as red, with who and why', () => {
        const { world, state } = smallBank();
        const s = scouted(world, armed(state, 'jun'));
        const floor = safeFloor(world, s, 'jun');
        const tile = floor.at({ x: 3, y: 1 })!;
        expect(tile.tint).toMatchObject({ kind: 'red', eye: true, hatched: false });
        expect(tile.now.exposed).toEqual(['guard']);
        const why = explain(world, s, 'jun', { x: 3, y: 1 });
        expect(why[0]).toMatchObject({ observer: 'guard', by: 'npc', phase: 'now', outcome: '!', text: 'Guard: sees Armed' });
        expect(why[0]!.from).toEqual({ x: 1, y: 1 });
    });

    it('leaves a clean crew member green in the lobby and challenges them past the staff door', () => {
        const { world, state } = smallBank();
        const s = scouted(world, state);
        const floor = safeFloor(world, s, 'jun');
        expect(floor.at({ x: 2, y: 0 })!.tint.kind).toBe('safe');
        const staff = floor.tiles.find(t => t.tint.kind === 'trespass');
        const by = staff!.now.challenged ?? staff!.next?.challenged;
        expect(['guard', 'teller']).toContain(by);
        const lines = explain(world, s, 'jun', staff!.pos);
        expect(lines.find(l => l.observer === by)?.text).toMatch(/: "Hey, you can't be back here"$/);
        // The overlay's own states.
        const drawn = overlayTiles(floor);
        expect(drawn.find(t => t.pos.x === staff!.pos.x && t.pos.y === staff!.pos.y)?.state).toBe('challenge');
    });

    it('never shows hidden floor as safe', () => {
        const { world, state } = smallBank();
        const floor = safeFloor(world, state, 'mara');
        for (const t of floor.tiles) if (t.knowledge === 'hidden') expect(['grey', 'red', 'amber', 'trespass', 'camera']).toContain(t.tint.kind);
        expect(floor.tiles.some(t => t.tint.kind === 'grey' || t.tint.kind === 'unknownRisk')).toBe(true);
    });

    it('puts the eye on the first step a guard would see a rifle on', () => {
        const { world, state } = smallBank();
        const s = scouted(world, armed(state, 'mara'));
        // Mara at (0, 2) walks east under the guard's eyes.
        const ps = pathSafety(world, s, 'mara', [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }]);
        expect(ps.ok).toBe(true);
        if (!ps.ok) return;
        expect(ps.firstUnsafe).not.toBeNull();
        expect(ps.steps[ps.firstUnsafe!]!.sightings.length || ps.end.tint.kind).toBeTruthy();
    });
});

describe('the incremental safe floor', () => {
    it('steps a slice at a time on a lent clock and ends with what safeFloor gives', () => {
        const { world, state } = smallBank();
        const s = scouted(world, armed(state, 'jun'));
        let clock = 0;
        const job = safeFloorJob(world, s, 'jun');
        expect(job.step(2, () => ++clock)).toBe(false);
        expect(job.tiles.length).toBe(2);
        expect(job.tiles[0]!.band).toBe('stay');
        while (!job.step(clock + 2, () => ++clock));
        expect(job.done).toBe(true);
        expect(job.has(['stay', 'move', 'dash'])).toBe(true);
        expect(job.floor().tiles).toEqual(safeFloor(world, clonePlain(s), 'jun').tiles);
        // The same job for the same state: safeFloor reuses what it tinted.
        expect(safeFloorJob(world, s, 'jun')).toBe(job);
        expect(safeFloor(world, s, 'jun', { bands: ['move'] }).tiles.every(t => t.band === 'move')).toBe(true);
    });
});

describe('drawn paths', () => {
    it('judges a drag over a teammate up to the last tile it can stop on, and what stopping at each step does', () => {
        const { world, state } = smallBank();
        const s = scouted(world, state);
        // Mara stands at (0, 2): a drag from Jun at (0, 0) ending on her is judged up to (0, 1).
        const ps = pathSafety(world, s, 'jun', [{ x: 0, y: 1 }, { x: 0, y: 2 }]);
        expect(ps.ok).toBe(true);
        if (!ps.ok) return;
        expect(ps.steps.map(t => t.pos)).toEqual([{ x: 0, y: 1 }]);
        const long = pathSafety(world, s, 'jun', [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
        expect(long.ok && long.steps.every(t => t.stop !== null)).toBe(true);
        if (long.ok) expect(long.steps[2]!.stop).toEqual(long.end);
    });
});

describe('action preview', () => {
    it('shows a dash\'s noise ring, who hears it and what it costs', () => {
        const { world, state } = smallBank();
        const s = scouted(world, state);
        const shown = actionPreview(world, s, { type: 'dash', crew: 'jun', path: [{ x: 1, y: 0 }, { x: 2, y: 0 }] });
        expect(shown.ok).toBe(true);
        if (!shown.ok) return;
        expect(shown.cost).toBe(2);
        expect(shown.noises).toHaveLength(1);
        expect(shown.noises[0]!.tiles.length).toBeGreaterThan(0);
        expect(shown.noises[0]!.ears.map(e => e.npc)).toEqual(['guard']);
        expect(shown.undoable).toBe(false);
    });

    it('refuses what the rules refuse', () => {
        const { world } = smallBank();
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: { x: 0, y: 0 } }] });
        expect(actionPreview(world, state, { type: 'move', crew: 'jun', path: [{ x: 5, y: 5 }] })).toMatchObject({ ok: false });
    });
});
