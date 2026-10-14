import { describe, expect, it } from 'vitest';
import { noiseHearers, npcBadges, npcCone } from '../../src/game/worldUi';
import { clonePlain, fixtureWorld, initialState, knownView, preview, type Facing, type ObserverClass, type PersonDef, type Pos, type State } from '../../src/sim';
import { scouted } from '../sim/helpers';

const P = (x: number, y: number): Pos => ({ x, y });
const person = (id: string, pos: Pos, facing: Facing, observer: ObserverClass = 'staff'): PersonDef => ({ id, name: id, role: 'clerk', observer, pos, facing, schedule: [] });

function scene(change: (s: State) => void = () => {}) {
    const world = fixtureWorld(Array.from({ length: 9 }, () => '............'), {
        people: [person('ann', P(5, 2), 's'), person('bob', P(7, 3), 'w'), person('cy', P(10, 8), 'n')]
    });
    const state = clonePlain(scouted(world, initialState(world, { seed: 3, crew: [{ id: 'jun', pos: P(5, 3) }] })));
    // The crew sees Ann and Bob now; Cy, far off, it doesn't know.
    for (const n of state.npcs.filter(n => n.id !== 'cy')) {
        state.knowledge.npcs[n.id] = { at: { ...n.pos }, facing: n.facing, turn: state.turn, live: true, routine: false, rota: false, watched: 1, watchedTurn: state.turn, tick: state.knowledge.phaseTick + 1 };
    }
    delete state.knowledge.npcs.cy;
    change(state);
    return { world, state };
}

describe('the world UI over heads', () => {
    it('wears each state as a plate with its own glyph, pips per crew member, carriers with their countdown', () => {
        const { world, state } = scene(s => {
            s.npcs[0]!.status = 'curious';
            s.npcs[0]!.suspicion = { jun: 2 };
            s.npcs[1]!.status = 'alerted';
            s.npcs[1]!.exposedTo = ['jun'];
            s.carriers.push({ id: 'c1', kind: 'guardRadio', source: 'bob', pos: P(7, 3), countdown: 2, started: { turn: 1, phase: 'crew' }, halted: null });
        });
        const view = knownView(world, state), badges = npcBadges(world, state, view);
        const ann = badges.find(b => b.id === 'ann')!, bob = badges.find(b => b.id === 'bob')!;
        expect(ann.plates).toEqual([{ glyph: 'q', signal: 'amber' }]);
        expect(ann.pips).toEqual([{ crew: 'jun', n: 2 }]);
        // The carrier says it all: no `!` beside it; the exposure shows as an eye.
        expect(bob.plates).toEqual([{ glyph: 'radio', signal: 'red', count: 2 }, { glyph: 'eye', signal: 'red' }]);
        // Nobody the crew doesn't know wears anything.
        expect(badges.every(b => view.npcs.some(m => m.id === b.id))).toBe(true);
    });

    it('names what each hearer of a knockout will do, and draws an Alerted NPC\'s cones wider', () => {
        const { world, state } = scene();
        const view = knownView(world, state);
        const cmd = { type: 'knockout' as const, crew: 'jun', npc: 'ann' };
        const hearers = noiseHearers(world, state, view, preview(world, state, cmd));
        // Bob, the only other one in earshot, goes to look.
        expect(hearers.find(h => h.id === 'bob')).toMatchObject({ sym: '?', signal: 'amber' });
        expect(hearers.map(h => h.id)).toEqual(expect.arrayContaining(['bob']));
        expect(hearers.every(h => h.id !== 'cy')).toBe(true);
        const calm = npcCone(world, state, view, 'bob')!;
        const alerted = npcCone(world, scene(s => { s.npcs[1]!.alerted = true; s.npcs[1]!.status = 'alerted'; }).state, view, 'bob')!;
        expect(calm.alerted).toBe(false);
        expect(alerted.alerted).toBe(true);
        expect(alerted.core.length + alerted.peripheral.length).toBeGreaterThan(calm.core.length + calm.peripheral.length);
    });
});
