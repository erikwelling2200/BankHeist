import { describe, expect, it } from 'vitest';
import { explainView, floorTiles, npcBadges, npcCone, npcDrawnOn, npcSprites, pathView, previewHearers, previewNoise, previewWitnesses, unhiddenRuns } from '../../src/game/worldUi';
import { actionPreview, clonePlain, commit, explain, fixtureWorld, initialState, knownView, pathSafety, safeFloor, safeFloorJob, type Facing, type MarkerKind, type NpcMarker, type ObserverClass, type PersonDef, type Pos, type State, VISIBILITY } from '../../src/sim';
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

    it('names what each hearer of a knockout will do, and draws an Alerted NPC\'s cones all Core, no wider', () => {
        const { world, state } = scene();
        const view = knownView(world, state);
        const cmd = { type: 'knockout' as const, crew: 'jun', npc: 'ann' };
        const shown = actionPreview(world, state, cmd);
        const hearers = previewHearers(view, shown);
        expect(previewNoise(shown)!.length).toBeGreaterThan(0);
        // Bob, the only other one in earshot, goes to look.
        expect(hearers.find(h => h.id === 'bob')).toMatchObject({ sym: '?', signal: 'amber' });
        expect(hearers.map(h => h.id)).toEqual(expect.arrayContaining(['bob']));
        expect(hearers.every(h => h.id !== 'cy')).toBe(true);
        const calm = npcCone(world, state, view, 'bob')!;
        const alerted = npcCone(world, scene(s => { s.npcs[1]!.alerted = true; s.npcs[1]!.status = 'alerted'; }).state, view, 'bob')!;
        expect(calm.alerted).toBe(false);
        expect(alerted.alerted).toBe(true);
        // Same reach (decision 38): the whole cone is Core.
        const key = (ps: readonly Pos[]): string[] => ps.map(p => `${p.x},${p.y}`).sort();
        expect(alerted.peripheral).toEqual([]);
        expect(calm.peripheral.length).toBeGreaterThan(0);
        expect(key(alerted.core)).toEqual(key([...calm.core, ...calm.peripheral]));
    });

    it('draws the safe floor, a path\'s tints and its eye, and "who and why" from the preview engine', () => {
        // Jun carries a rifle: Ann, facing him, would see it.
        const { world, state } = scene(s => { s.crew[0]!.loadout.items.push('assaultRifle'); });
        const floor = safeFloor(world, state, 'jun'), tiles = floorTiles(floor);
        // A slice at a time: the Move band first, then the rest, ending with the same tiles.
        const job = safeFloorJob(world, clonePlain(state), 'jun');
        while (!job.has(['stay', 'move'])) job.step(0, () => 1);
        expect(job.done).toBe(false);
        while (!job.step(0, () => 1));
        expect(floorTiles(job)).toEqual(tiles);
        // Every tile but the crew member's own, each with the engine's tint.
        expect(tiles.length).toBe(floor.tiles.filter(t => t.band !== 'stay').length);
        for (const t of tiles) expect(t.kind).toBe(floor.at(t.pos)!.tint.kind);
        const warned = floor.tiles.find(t => t.band !== 'stay' && t.tint.kind !== 'safe' && t.tint.kind !== 'grey' && t.tint.kind !== 'unknownRisk');
        expect(warned).toBeDefined();
        const view = pathView(pathSafety(world, state, 'jun', warned!.path))!;
        expect(view.end.kind).toBe(warned!.tint.kind);
        expect(view.eyeAt).not.toBeNull();
        expect(view.steps).toHaveLength(warned!.path.length);
        const why = explainView(world, warned!.pos, explain(world, state, 'jun', warned!.pos), true)!;
        expect(why.lines.length).toBeGreaterThan(0);
        expect(why.lines.every(l => l.observer !== 'cy')).toBe(true);
        expect(why.lines[0]!.text).toMatch(/\w/);
        // Witnesses of a knockout are only NPCs the crew knows of, where it knows them.
        const witnesses = previewWitnesses(world, knownView(world, state), actionPreview(world, state, { type: 'knockout', crew: 'jun', npc: 'ann' }));
        expect(witnesses.every(w => w.id !== 'cy')).toBe(true);
    });
});

describe('the NPCs drawn (decision 44)', () => {
    it('draws an NPC as it is only on a tile seen this turn, and a predicted or remembered one anywhere, hidden tiles too', () => {
        const { world, state } = scene();
        const view = knownView(world, state), at = (p: Pos) => p.y * view.width + p.x;
        const ann = view.npcs.find(m => m.id === 'ann')!;
        const marker = (id: string, kind: MarkerKind, pos: Pos): NpcMarker => ({ ...ann, id, kind, pos });
        const npcs = [
            marker('seen', 'live', P(1, 1)), marker('liveStale', 'live', P(2, 1)), marker('predicted', 'predicted', P(3, 1)),
            marker('ghost', 'ghost', P(4, 1)), marker('ghostHidden', 'ghost', P(5, 1)), marker('predictedHidden', 'predicted', P(6, 1)),
            marker('liveHidden', 'live', P(7, 1))
        ];
        const visibility = new Uint8Array(view.visibility.length).fill(2);
        for (const p of [P(2, 1), P(3, 1), P(4, 1)]) visibility[at(p)] = 1;
        for (const p of [P(5, 1), P(6, 1), P(7, 1)]) visibility[at(p)] = 0;
        expect(npcSprites({ ...view, npcs, visibility }).map(m => m.id)).toEqual(['seen', 'predicted', 'ghost', 'ghostHidden', 'predictedHidden']);
        expect(npcDrawnOn('live', 'stale')).toBe(false);
        expect(npcDrawnOn('live', 'hidden')).toBe(false);
        expect(npcDrawnOn('ghost', 'hidden')).toBe(true);
    });

    it('draws a cone and a walk only over tiles that are not hidden', () => {
        const { world, state } = scene();
        const view = knownView(world, state), ann = view.npcs.find(m => m.id === 'ann')!;
        const full = npcCone(world, state, view, 'ann')!;
        const tiles = [...full.core, ...full.peripheral];
        expect(tiles.length).toBeGreaterThan(1);
        // Hide every other tile of the cone, and the NPC's own: the marker stays, the cone keeps only the rest.
        const visibility = view.visibility.slice(), hide = tiles.filter((_, i) => i % 2 === 0);
        for (const p of [...hide, ann.pos]) visibility[p.y * view.width + p.x] = 0;
        const clipped = npcCone(world, state, { ...view, visibility }, 'ann')!;
        const key = (p: Pos) => `${p.x},${p.y}`, hidden = new Set(hide.map(key));
        expect([...clipped.core, ...clipped.peripheral].map(key).sort()).toEqual(tiles.filter(p => !hidden.has(key(p))).map(key).sort());
        expect(npcSprites({ ...view, visibility }).some(m => m.id === 'ann')).toBe(ann.kind !== 'live');
        // A walk through a hidden tile is drawn as the runs either side of it.
        const walk = unhiddenRuns({ ...view, visibility: (() => { const v = view.visibility.slice().fill(2); v[P(3, 1).y * view.width + 3] = 0; return v; })() },
            P(0, 1), [P(1, 1), P(2, 1), P(3, 1), P(4, 1), P(5, 1)]);
        expect(walk).toEqual([{ from: P(0, 1), path: [P(1, 1), P(2, 1)] }, { from: P(4, 1), path: [P(5, 1)] }]);
    });

    it('never draws an NPC as it is off the tiles seen this turn, through a world phase', () => {
        const { world, state } = scene();
        const after = commit(world, state, { type: 'endTurn' }).state, view = knownView(world, after);
        for (const m of npcSprites(view)) {
            const v = VISIBILITY[view.visibility[m.pos.y * view.width + m.pos.x]!];
            if (m.kind === 'live') expect(v).toBe('seen');
        }
    });
});
