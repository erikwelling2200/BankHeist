import { describe, expect, it } from 'vitest';
import type { GenerateOptions } from '../../src/gen/generate';
import { cachedBank } from '../bankCache';
import {
    bandAt, cameraObserver, clonePlain, commit, crewLook, crewPicture, decodeBits, explain, reaction, safeFloor, unknownWatcher, deserialise, encodeBits, fieldOn, fixtureWorld, floorKnowledge, freezeWorld,
    hashOf, initialState, isKnownNow, isUnknownRisk, noticedUnseen, pathTo, projectPreviewEvents, SaveFormatError, knownBlockers, knownView, makeNoise, markerKind, npcObserver, preview, projectEvents, reachable,
    serialise, sightMap, tileAt, updateKnowledge, worldFromBank, type Command, type FixtureOptions, type PersonDef, type Pos, type ReadonlyWorld,
    type SimEvent, type State, type World
} from '../../src/sim';
import { registerTestCommand, scouted, step } from './helpers';

/*
 * M1-10, what the crew knows (§8.8, §8.15, §17.8): seen tiles, live / predicted / ghost NPCs, unknown risk, sound
 * pings, cameras, the `revealed` events that make undo honest, and the projection the player sees through.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const revealed = (events: readonly SimEvent[]): string[] => events.flatMap(e => (e.type === 'revealed' ? [`${e.what} ${e.id}`] : []));
const seenAt = (world: ReadonlyWorld, state: State, p: Pos): boolean => decodeBits(state.knowledge.seen, world.width * world.height)[p.y * world.width + p.x] === 1;

const clerk = (pos: Pos, extra: Partial<PersonDef> = {}): PersonDef => ({
    id: 'clerk', name: 'Ann', role: 'clerk', observer: 'staff', pos, facing: 'w',
    schedule: [{ from: 1, activity: 'post', label: 'at post', room: '', at: pos, facing: 'w' }], ...extra
});

/** Sets a state's fields in a copy, as a scenario needs (teleporting the crew, an NPC's wants). */
function patch(state: State, change: (s: State) => void): State {
    const s = clonePlain(state);
    change(s);
    return s;
}

// A noise of any kind from the table at a tile, for the ping tests.
registerTestCommand('knowledgeTestNoise', (ctx, cmd) => {
    const c = cmd as unknown as { what: 'pistol' | 'lockpick'; at: Pos };
    makeNoise(ctx, c.what, c.at, `test ${c.what}`);
});
const noiseAt = (what: 'pistol' | 'lockpick', at: Pos): Command => ({ type: 'knowledgeTestNoise', what, at } as unknown as Command);

describe('seen tiles and the blueprint', () => {
    // A lobby, a wall with a door, and a staff room behind it.
    const map = ['.....sss', '.....sss', '.....sss'];
    const walls: FixtureOptions['walls'] = [
        { between: [P(4, 0), P(5, 0)] }, { between: [P(4, 1), P(5, 1)], door: { id: 'd' } }, { between: [P(4, 2), P(5, 2)] }
    ];
    const build = (): { world: ReadonlyWorld; state: State } => {
        const base = fixtureWorld(map, { walls, objects: [{ id: 'desk', kind: 'cctvDesk', pos: P(6, 1), facing: 's', room: 'staff' }], cameras: [{ id: 'cam', pos: P(7, 0), facings: ['s'], room: 'staff' }] });
        const world = freezeWorld({ ...(clonePlain(base) as World), tiles: base.tiles.map((t, i) => ({ ...t, room: i % 8 >= 5 ? 'staff' : 'lobby' })) });
        return { world, state: initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 1) }] }) };
    };

    it('knows what the crew sees at the start, and nothing behind the wall', () => {
        const { world, state } = build();
        expect(seenAt(world, state, P(4, 2))).toBe(true);
        expect(seenAt(world, state, P(5, 1))).toBe(false);
        expect(floorKnowledge(world, state, P(6, 1))).toBe('unscouted');
        expect(state.knowledge.rooms).toEqual(['lobby']);
        expect(state.knowledge.cameras).toEqual([]);
        const view = knownView(world, state);
        // The blueprint knows the public floor; the staff room is an outline.
        expect(view.blueprint.outlines).toEqual(['staff']);
        expect(view.blueprint.known[1 * 8 + 6]).toBe(0);
        expect(view.blueprint.known[1 * 8 + 2]).toBe(1);
        expect(view.cameras).toEqual([]);
    });

    it('with Blueprints, knows the layout of every room, but still not what is in it', () => {
        const { world } = build();
        const bought = freezeWorld({ ...(clonePlain(world) as World), intel: { blueprints: true } });
        const state = initialState(bought, { seed: 1, crew: [{ id: 'jun', pos: P(0, 1) }] });
        expect(knownView(bought, state).blueprint.outlines).toEqual([]);
        expect(floorKnowledge(bought, state, P(6, 1))).toBe('unscouted');
    });

    it('reveals what lies behind a door, the room, its camera and the CCTV feeds: a final move', () => {
        const { world, state } = build();
        const inside = step(world, state, { type: 'move', crew: 'jun', path: [P(1, 1), P(2, 1)] });
        expect(revealed(inside.events)).toEqual([]);
        expect(inside.undoable).toBe(true);
        const through = step(world, inside.state, { type: 'move', crew: 'jun', path: [P(3, 1), P(4, 1), P(5, 1)] });
        expect(revealed(through.events)).toEqual(['tiles 9', 'room staff', 'camera cam', 'cctv desk']);
        expect(through.undoable).toBe(false);
        expect(knownView(world, through.state).cameras).toEqual([{ id: 'cam', pos: P(7, 0), facings: ['s'], status: 'live', monitored: false }]);
        // Before the CCTV room is scouted, a known camera's status is unknown (it counts as live, §8.8).
        const noDesk = freezeWorld({ ...(clonePlain(world) as World), objects: [] });
        const s2 = step(noDesk, initialState(noDesk, { seed: 1, crew: [{ id: 'jun', pos: P(4, 1) }] }), { type: 'move', crew: 'jun', path: [P(5, 1)] }).state;
        expect(knownView(noDesk, s2).cameras[0]!.status).toBe('unknown');
        // Preview and commit agree on it.
        expect(preview(world, inside.state, { type: 'move', crew: 'jun', path: [P(3, 1), P(4, 1), P(5, 1)] }).undoable).toBe(false);
    });

    it('stores the tiles compactly and reads them back', () => {
        const bits = new Uint8Array(4801);
        for (let i = 0; i < bits.length; i += 7) bits[i] = 1;
        const text = encodeBits(bits);
        expect(text.length).toBe(801);
        expect([...decodeBits(text, bits.length)]).toEqual([...bits]);
        expect(JSON.stringify(text)).toBe(`"${text}"`);
    });
});

describe('NPCs: live, known routines, predicted markers and ghosts', () => {
    // A long corridor: the clerk stands at its post 5 tiles from the crew, who can step 24 tiles away to lose sight.
    const corridor = (options: FixtureOptions = {}): { world: ReadonlyWorld; state: State } => {
        const world = fixtureWorld(['.'.repeat(30)], { people: [clerk(P(5, 0))], ...options });
        return { world, state: initialState(world, { seed: 3, crew: [{ id: 'jun', pos: P(0, 0) }] }) };
    };
    const away = (s: State): State => patch(s, x => { x.crew[0]!.pos = P(29, 0); });
    const knockOff = (s: State): State => patch(s, x => {
        x.npcs[0]!.wants = [{ kind: 'face', crew: 'jun', tile: P(0, 0), decided: { turn: x.turn, phase: 'crew' } }];
    });

    it('tags a routine after 3 turns in view, and predicts it out of sight', () => {
        const { world, state } = corridor();
        expect(markerKind(world, state, 'clerk')).toBe('live');
        const t2 = step(world, state, { type: 'endTurn' });
        expect(state.knowledge.npcs.clerk!.watched).toBe(1);
        expect(t2.state.knowledge.npcs.clerk).toMatchObject({ watched: 2, routine: false });
        // Out of sight for a world phase before 3 turns: a ghost, not a prediction.
        expect(markerKind(world, step(world, away(t2.state), { type: 'endTurn' }).state, 'clerk')).toBe('ghost');
        const t3 = step(world, t2.state, { type: 'endTurn' });
        expect(revealed(t3.events)).toContain('routine clerk');
        expect(t3.state.knowledge.npcs.clerk).toMatchObject({ watched: 3, routine: true });
        const gone = step(world, away(t3.state), { type: 'endTurn' });
        // The far end of the corridor is new; the clerk going out of view tells nothing.
        expect(revealed(gone.events)).toEqual(['tiles 14']);
        const view = knownView(world, gone.state);
        expect(view.npcs).toEqual([expect.objectContaining({ id: 'clerk', kind: 'predicted', pos: P(5, 0), seenAgo: 0, status: 'calm' })]);
        // Predicted NPCs count like visible ones; unseen ones don't.
        expect(knownBlockers(world, gone.state)).toEqual([P(5, 0)]);
    });

    it('knows guards’ routines from the start with the Guard rota', () => {
        const guard = clerk(P(20, 0), { id: 'guard', role: 'guard', observer: 'enforcer' });
        const { world, state } = corridor({ people: [clerk(P(5, 0)), guard] });
        expect(markerKind(world, state, 'guard')).toBe(null);
        const rota = freezeWorld({ ...(clonePlain(world) as World), intel: { guardRota: true } });
        const s = initialState(rota, { seed: 3, crew: [{ id: 'jun', pos: P(0, 0) }] });
        expect(markerKind(rota, s, 'guard')).toBe('predicted');
        expect(markerKind(rota, s, 'clerk')).toBe('live');
    });

    it('turns a predicted NPC knocked off its routine into a ghost that fades after 2 turns', () => {
        const { world, state } = corridor();
        const tagged = step(world, step(world, state, { type: 'endTurn' }).state, { type: 'endTurn' }).state;
        const out = step(world, away(tagged), { type: 'endTurn' }).state;
        expect(markerKind(world, out, 'clerk')).toBe('predicted');
        const knocked = step(world, knockOff(out), { type: 'wait', crew: 'jun' }).state;
        expect(knocked.knowledge.npcs.clerk).toMatchObject({ routine: false, watched: 0, live: false });
        expect(knownView(world, knocked).npcs).toEqual([{ id: 'clerk', kind: 'ghost', pos: P(5, 0), facing: 'w', seenAgo: 0 }]);
        // Out of the crew's sight it may do what it likes: the ghost stays where it was last known.
        const a = step(world, knocked, { type: 'endTurn' }).state;
        expect(knownView(world, a).npcs).toEqual([expect.objectContaining({ kind: 'ghost', pos: P(5, 0), seenAgo: 1 })]);
        const b = step(world, a, { type: 'endTurn' }).state;
        expect(markerKind(world, b, 'clerk')).toBe('ghost');
        const c = step(world, b, { type: 'endTurn' }).state;
        expect(markerKind(world, c, 'clerk')).toBe(null);
        expect(knownView(world, c).npcs).toEqual([]);
        expect(knownBlockers(world, c)).toEqual([]);
    });

    it('drops ghosts at once when the setting is off', () => {
        const { world, state } = corridor({ rules: { ghosts: false } });
        expect(markerKind(world, step(world, away(state), { type: 'endTurn' }).state, 'clerk')).toBe(null);
    });

    it('keeps an NPC seen as the world phase ended live until the next one, wherever the crew looks (decision 24)', () => {
        const { world, state } = corridor({ rules: { ghosts: false } });
        // Seen at the start, it hasn't moved: looking away in the crew phase doesn't lose it.
        const looked = step(world, away(state), { type: 'wait', crew: 'jun' }).state;
        expect(looked.knowledge.npcs.clerk!.live).toBe(false);
        expect(markerKind(world, looked, 'clerk')).toBe('live');
        expect(knownBlockers(world, looked)).toEqual([P(5, 0)]);
    });

    it('stops a move where a stranger comes into view, and reveals one only passed on the way', () => {
        // The clerk stands in an alcove off the corridor, seen only from the tile in front of it.
        const world = fixtureWorld(['.........', 'TTTT.TTTT', 'TTTT.TTTT'], { people: [clerk(P(4, 2), { facing: 'n' })] });
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] });
        expect(markerKind(world, state, 'clerk')).toBe(null);
        const path = [P(1, 0), P(2, 0), P(3, 0), P(4, 0), P(5, 0)];
        const moved = step(world, state, { type: 'move', crew: 'jun', path });
        // Someone new: the move stops where the clerk came into view, the action spent.
        expect(moved.state.crew[0]!.pos).toEqual(P(4, 0));
        expect(moved.state.crew[0]!.actionsLeft).toBe(1);
        expect(moved.events).toContainEqual({ type: 'moveCut', crew: 'jun', npc: 'clerk', reason: 'spotted', at: P(4, 0), planned: path });
        expect(revealed(moved.events)).toContain('npc clerk');
        expect(moved.undoable).toBe(false);
        // A preview tells nothing of it: the drawn path, no cut, nothing revealed.
        const pv = preview(world, state, { type: 'move', crew: 'jun', path });
        const shown = projectPreviewEvents(world, state, pv);
        expect(shown).toEqual([{ type: 'moved', crew: 'jun', from: P(0, 0), to: P(5, 0), path }]);
        // Known now (once seen, never a stranger again): walking past it doesn't stop. Out of view it is still where it
        // was until the world phase, then a ghost.
        const on = step(world, moved.state, { type: 'move', crew: 'jun', path: [P(5, 0), P(6, 0), P(7, 0), P(8, 0)] }).state;
        expect(knownView(world, on).npcs).toEqual([expect.objectContaining({ id: 'clerk', kind: 'live', pos: P(4, 2) })]);
        expect(markerKind(world, step(world, on, { type: 'endTurn' }).state, 'clerk')).toBe('ghost');
        // Forgotten long ago, then passed on the way (seen only from (4, 0)): revealed, a ghost where it was passed.
        const old = patch(state, s => { s.knowledge.npcs.clerk = { at: P(4, 2), facing: 'n', turn: -5, live: false, routine: false, rota: false, watched: 1, watchedTurn: -5, tick: 0 }; });
        const past = step(world, old, { type: 'move', crew: 'jun', path });
        expect(past.state.crew[0]!.pos).toEqual(P(5, 0));
        expect(revealed(past.events)).toContain('npc clerk');
        expect(markerKind(world, step(world, past.state, { type: 'endTurn' }).state, 'clerk')).toBe('ghost');
        // In playback, its events from that move are told even though it is out of view at the end.
        const told: SimEvent[] = [...past.events, { type: 'npcStatus', npc: 'clerk', status: 'curious' }];
        expect(projectEvents(world, past.state, told, old).at(-1)).toEqual({ type: 'npcStatus', npc: 'clerk', status: 'curious' });
    });

    it('sees NPCs crossing the crew’s view in the world phase', () => {
        // The walker goes along row 0 past the end of the shaft the crew looks up from (4, 5).
        const world = fixtureWorld(['.........', 'TTTT.TTTT', 'TTTT.TTTT', 'TTTT.TTTT', 'TTTT.TTTT', 'TTTT.TTTT'], {
            people: [{
                id: 'walker', name: 'W', role: 'clerk', observer: 'staff', pos: P(1, 0), facing: 'e',
                schedule: [{ from: 1, activity: 'post', label: 'a', room: '', at: P(1, 0), facing: 'e' }, { from: 2, activity: 'post', label: 'b', room: '', at: P(8, 0), facing: 'e' }]
            }]
        });
        let s = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(4, 5) }] });
        expect(markerKind(world, s, 'walker')).toBe(null);
        const seen: string[] = [];
        for (let i = 0; i < 3 && !seen.length; i++) {
            const r = step(world, s, { type: 'endTurn' });
            s = r.state;
            seen.push(...revealed(r.events).filter(x => x.startsWith('npc')));
        }
        expect(seen).toEqual(['npc walker']);
        expect(s.knowledge.npcs.walker).toMatchObject({ at: P(4, 0), watched: 1, live: false });
        expect(markerKind(world, s, 'walker')).toBe('ghost');
    });
});

describe('undo', () => {
    it('keeps pure moves through known space undoable and makes revealing moves final', () => {
        const world = fixtureWorld(['.'.repeat(24)]);
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] });
        const known = step(world, state, { type: 'move', crew: 'jun', path: [P(1, 0)] });
        expect(known.events.map(e => e.type)).toEqual(['moved', 'revealed']);
        expect(known.undoable).toBe(false);
        const back = step(world, known.state, { type: 'move', crew: 'jun', path: [P(0, 0)] });
        expect(back.events.map(e => e.type)).toEqual(['moved']);
        expect(back.undoable).toBe(true);
    });
});

describe('sound pings', () => {
    const world = fixtureWorld(['.'.repeat(40), '.'.repeat(40)], { walls: [{ between: [P(20, 0), P(20, 1)] }] });
    const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] });

    it('records loud noises within hearing, wherever they come from', () => {
        const shot = step(world, state, noiseAt('pistol', P(7, 1))).state;
        expect(shot.knowledge.pings).toEqual([{ at: P(7, 1), turn: 1, kind: 'loud', cause: 'test pistol' }]);
        expect(knownView(world, shot).pings).toHaveLength(1);
        // It fades after a turn.
        const later = step(world, step(world, shot, { type: 'endTurn' }).state, { type: 'endTurn' }).state;
        expect(later.knowledge.pings).toEqual([]);
    });

    it('ignores quiet noises and loud ones out of earshot', () => {
        expect(step(world, state, noiseAt('lockpick', P(1, 0))).state.knowledge.pings).toEqual([]);
        expect(step(world, state, noiseAt('pistol', P(30, 0))).state.knowledge.pings).toEqual([]);
    });
});

describe('the projection', () => {
    // Crew walk along row 0; a wall of shelves hides row 2, where the hidden clerk hears the dash. The teller is in view.
    const world = fixtureWorld(['............', 'TTTTTTTTTTTT', '............'], {
        people: [clerk(P(3, 2), { id: 'hidden' }), clerk(P(6, 0), { id: 'teller', facing: 'e' })]
    });
    const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] });

    it('hides NPCs the crew has not seen, and the events about them', () => {
        expect(knownView(world, state).npcs.map(n => n.id)).toEqual(['teller']);
        const dash = step(world, state, { type: 'dash', crew: 'jun', path: [P(1, 0), P(2, 0), P(3, 0)] });
        expect(dash.events).toContainEqual(expect.objectContaining({ type: 'heard', npcs: ['hidden'] }));
        const shown = projectEvents(world, dash.state, dash.events, state);
        expect(shown.some(e => e.type === 'heard')).toBe(false);
        expect(shown.find(e => e.type === 'noise')).toMatchObject({ heard: [] });
        expect(shown.some(e => 'npc' in e && e.npc === 'hidden')).toBe(false);
        expect(knownView(world, dash.state).npcs.map(n => n.id)).toEqual(['teller']);
        // Events about the teller pass.
        const told: SimEvent[] = [{ type: 'npcStatus', npc: 'teller', status: 'curious' }, { type: 'npcStatus', npc: 'hidden', status: 'curious' }];
        expect(projectEvents(world, state, told)).toEqual([told[0]]);
    });

    it('plans moves against the crew’s picture: an unseen NPC’s tile reads open', () => {
        const blind = fixtureWorld(['.....', '.TTT.', '.....'], { people: [clerk(P(2, 2), { id: 'hidden', facing: 'n' })], dark: [P(2, 2)] });
        const s = initialState(blind, { seed: 1, crew: [{ id: 'jun', pos: P(2, 0) }] });
        expect(markerKind(blind, s, 'hidden')).toBe(null);
        const truth = reachable(blind, s, P(2, 0), 20, { mover: 'jun' });
        const picture = reachable(blind, crewPicture(blind, s), P(2, 0), 20, { mover: 'jun' });
        const canEnd = (r: typeof truth, p: Pos): boolean => r.tiles.some(t => t.pos.x === p.x && t.pos.y === p.y && t.canEnd);
        expect(canEnd(truth, P(2, 2))).toBe(false);
        expect(canEnd(picture, P(2, 2))).toBe(true);
        expect(knownBlockers(blind, s)).toEqual([]);
    });
});

describe('previews tell nothing new', () => {
    it('drops what a preview would give away about an NPC the crew doesn’t know', () => {
        // Corridor on row 0; shelves on row 1 with a gap at x = 6; the hidden clerk stands behind the gap.
        const world = fixtureWorld(['............', 'TTTTTT.TTTTT', '............'], { people: [clerk(P(6, 2), { id: 'hidden', facing: 'n' })] });
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] });
        const path = [P(1, 0), P(2, 0), P(3, 0), P(4, 0), P(5, 0), P(6, 0), P(7, 0)];
        const pv = preview(world, state, { type: 'dash', crew: 'jun', path });
        // The truth: heard, cut where it came into view, revealed.
        expect(pv.events.map(e => e.type)).toEqual(expect.arrayContaining(['heard', 'moveCut', 'revealed']));
        const shown = projectPreviewEvents(world, state, pv);
        expect(JSON.stringify(shown)).not.toContain('hidden');
        expect(shown.map(e => e.type)).toEqual(['moved', 'noise']);
        expect(shown[0]).toMatchObject({ to: P(7, 0), path });
        // Played back after the commit, the crew has seen it: it is told.
        const done = step(world, state, { type: 'dash', crew: 'jun', path });
        expect(projectEvents(world, done.state, done.events, state).map(e => e.type)).toEqual(expect.arrayContaining(['heard', 'moveCut']));
    });

    it('says when an unseen NPC noticed a move, without saying who', () => {
        // The clerk stands in the dark at the far end: on edge, it sees the crew in the lit corridor 7 tiles off with its
        // whole cone as Core; the crew sees only 6 tiles into the dark (13 halved), so it can't see the clerk.
        const dark = [P(7, 0), P(8, 0), P(9, 0)];
        const world = fixtureWorld(['..........'], { people: [clerk(P(8, 0), { id: 'hidden' })], dark, zones: ['ssssssssss'] });
        // Every tile known already (the clerk's dark corner included, earlier), so the move reveals nothing.
        const state = patch(initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] }), s => {
            s.knowledge.seen = encodeBits(new Uint8Array(10).fill(1));
            s.npcs[0]!.alerted = true;
        });
        expect(markerKind(world, state, 'hidden')).toBe(null);
        const r = step(world, state, { type: 'move', crew: 'jun', path: [P(1, 0)] });
        expect(revealed(r.events)).toEqual([]);
        expect(r.undoable).toBe(false);
        expect(projectEvents(world, r.state, r.events, state).some(e => JSON.stringify(e).includes('hidden'))).toBe(false);
        expect(noticedUnseen(world, state, r)).toBe(true);
        const quiet = step(world, scouted(world, state), { type: 'wait', crew: 'jun' });
        expect(noticedUnseen(world, state, quiet)).toBe(false);
    });
});

describe('moving in unknown space', () => {
    // The crew can't see the dark tile (2, 2) from row 0, past the shelves, until it is next to it.
    const blind = fixtureWorld(['.....', '.TTT.', '.....'], { people: [clerk(P(2, 2), { id: 'hidden', facing: 'n' })], dark: [P(2, 2)] });
    const state = initialState(blind, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] }), stranger = state;
    const path = [P(0, 1), P(0, 2), P(1, 2), P(2, 2), P(3, 2)];

    it('stops where a stranger comes into view on the way', () => {
        const r = step(blind, state, { type: 'move', crew: 'jun', path });
        // From (0, 2) the dark tile two steps on is within half range.
        expect(r.events).toContainEqual({ type: 'moveCut', crew: 'jun', npc: 'hidden', reason: 'spotted', at: P(0, 2), planned: path });
    });

    it('plans through an unseen NPC’s tile and bumps into it', () => {
        // Seen long ago, forgotten: no stranger, but not where the crew can plan around it either.
        const state = patch(stranger, s => { s.knowledge.npcs.hidden = { at: P(4, 0), facing: 'n', turn: -5, live: false, routine: false, rota: false, watched: 1, watchedTurn: -5, tick: 0 }; });
        expect(markerKind(blind, state, 'hidden')).toBe(null);
        // Known, it would be in the way: a move through it is refused.
        const known = patch(state, s => { s.knowledge.npcs.hidden = { at: P(2, 2), facing: 'n', turn: 1, live: true, routine: false, rota: false, watched: 1, watchedTurn: 1, tick: 9 }; });
        expect(() => preview(blind, known, { type: 'move', crew: 'jun', path })).toThrow(/./);
        const r = step(blind, state, { type: 'move', crew: 'jun', path });
        expect(r.state.crew[0]!.pos).toEqual(P(1, 2));
        expect(r.state.crew[0]!.actionsLeft).toBe(1);
        expect(r.events).toContainEqual({ type: 'moveCut', crew: 'jun', npc: 'hidden', reason: 'bump', at: P(1, 2), planned: path });
        expect(markerKind(blind, r.state, 'hidden')).toBe('live');
        expect(r.undoable).toBe(false);
        // The preview shows the drawn path: the crew can't know.
        const shown = projectPreviewEvents(blind, state, preview(blind, state, { type: 'move', crew: 'jun', path }));
        expect(shown.find(e => e.type === 'moved')).toMatchObject({ to: P(3, 2), path });
        expect(JSON.stringify(shown)).not.toContain('hidden');
        expect(shown.some(e => e.type === 'moveCut' || e.type === 'revealed')).toBe(false);
    });

    it('bumps before the first step when the NPC stands right there', () => {
        const next = patch(state, s => {
            s.crew[0]!.pos = P(1, 2);
            s.knowledge.npcs.hidden = { at: P(4, 0), facing: 'n', turn: -5, live: false, routine: false, rota: false, watched: 1, watchedTurn: -5, tick: 0 };
        });
        const r = step(blind, next, { type: 'move', crew: 'jun', path: [P(2, 2), P(3, 2)] });
        expect(r.state.crew[0]!.pos).toEqual(P(1, 2));
        expect(r.events.some(e => e.type === 'moved')).toBe(false);
        expect(r.events).toContainEqual(expect.objectContaining({ type: 'moveCut', reason: 'bump', at: P(1, 2) }));
    });
});

describe('doors and other names in events', () => {
    // Two rooms: the crew's, and a closed one behind a wall with a door on its far side the crew can't see.
    const world = fixtureWorld(['....s....', '....s....'], {
        walls: [{ between: [P(3, 0), P(4, 0)] }, { between: [P(3, 1), P(4, 1)] }, { between: [P(4, 0), P(5, 0)] }, { between: [P(4, 1), P(5, 1)], door: { id: 'far' } }],
        people: [clerk(P(5, 1), { id: 'hidden' })]
    });
    const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] });

    it('drops events naming an unknown NPC in any field, and doors out of sight', () => {
        const events: SimEvent[] = [
            { type: 'doorOpened', door: 'far', by: 'hidden' },
            { type: 'doorClosed', door: 'far' },
            { type: 'npcBlocked', npc: 'x', at: P(0, 0), next: P(1, 0), by: 'hidden' } as unknown as SimEvent,
            { type: 'waited', crew: 'jun' }
        ];
        expect(projectEvents(world, state, events)).toEqual([{ type: 'waited', crew: 'jun' }]);
        expect(knownView(world, state).doors).toEqual([]);
        const near = patch(state, s => { s.crew[0]!.pos = P(6, 0); });
        const seen = step(world, near, { type: 'wait', crew: 'jun' }).state;
        expect(knownView(world, seen).doors).toEqual([{ id: 'far', status: 'closed', inView: true }]);
        expect(projectEvents(world, seen, [{ type: 'doorClosed', door: 'far' }])).toEqual([{ type: 'doorClosed', door: 'far' }]);
    });
});

describe('routines and the bank going loud', () => {
    const corridor = (options: FixtureOptions = {}): { world: ReadonlyWorld; state: State } => {
        const world = fixtureWorld(['.'.repeat(30)], { people: [clerk(P(5, 0), { id: 'guard', role: 'guard', observer: 'enforcer' })], ...options });
        return { world, state: initialState(world, { seed: 3, crew: [{ id: 'jun', pos: P(25, 0) }] }) };
    };

    it('stops every prediction once the bank is loud', () => {
        const { world } = corridor();
        const rota = freezeWorld({ ...(clonePlain(world) as World), intel: { guardRota: true } });
        const s = initialState(rota, { seed: 3, crew: [{ id: 'jun', pos: P(25, 0) }] });
        expect(markerKind(rota, s, 'guard')).toBe('predicted');
        const loud = step(rota, patch(s, x => { x.bank.loud = true; }), { type: 'wait', crew: 'jun' }).state;
        expect(markerKind(rota, loud, 'guard')).toBe('ghost');
    });

    it('keeps the Guard rota through a knock-off: the routine is known again once it is back on it', () => {
        const { world } = corridor();
        const rota = freezeWorld({ ...(clonePlain(world) as World), intel: { guardRota: true } });
        const s = initialState(rota, { seed: 3, crew: [{ id: 'jun', pos: P(25, 0) }] });
        const off = step(rota, patch(s, x => { x.npcs[0]!.wants = [{ kind: 'face', crew: 'jun', tile: P(25, 0), decided: { turn: 1, phase: 'crew' } }]; }), { type: 'wait', crew: 'jun' }).state;
        expect(markerKind(rota, off, 'guard')).toBe('ghost');
        // Waiting in view is a perception check (rules/actions/wait.ts), which re-planned the guard to face jun (Curious): put it back.
        const back = step(rota, patch(off, x => { x.npcs[0]!.wants = []; x.npcs[0]!.goal = { kind: 'still' }; x.npcs[0]!.status = 'calm'; }), { type: 'wait', crew: 'jun' });
        expect(markerKind(rota, back.state, 'guard')).toBe('predicted');
        expect(revealed(back.events)).toEqual(['routine guard']);
    });
});

describe('unknown risk', () => {
    it('reads hatched grey from tiles not seen since the world phase, not only from tiles never seen', () => {
        // The stranger has walked onto tiles the crew saw earlier and has since left behind.
        const world = fixtureWorld(['.'.repeat(40)], { people: [clerk(P(39, 0), { id: 'stranger' })] });
        let s = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] });
        s = step(world, patch(s, x => { x.crew[0]!.pos = P(17, 0); }), { type: 'wait', crew: 'jun' }).state;
        // Fresh this crew phase: 0..30. After a world phase only what the crew sees now (4..30) is fresh.
        expect(floorKnowledge(world, s, P(2, 0))).toBe('scouted');
        s = step(world, s, { type: 'endTurn' }).state;
        expect(floorKnowledge(world, s, P(2, 0))).toBe('unknownRisk');
        // Within reach (8) of the stale tiles: 3 is 8 away from 11; 12 is 9 from 3 and 19 from 31.
        expect(floorKnowledge(world, s, P(11, 0))).toBe('unknownRisk');
        expect(floorKnowledge(world, s, P(12, 0))).toBe('scouted');
        // Walking back makes them fresh again.
        s = step(world, patch(s, x => { x.crew[0]!.pos = P(0, 0); }), { type: 'wait', crew: 'jun' }).state;
        expect(floorKnowledge(world, s, P(2, 0))).toBe('scouted');
        expect(floorKnowledge(world, s, P(35, 0))).toBe('unscouted');
    });

    it('is never green where an NPC the crew doesn’t see or predict could watch, through a played heist', () => {
        let checked = 0;
        for (const bankSpec of [
            { tier: 'small' as const, archetype: 'twoWing' as const, layout: 2000, population: 1 },
            { tier: 'city' as const, archetype: 'atrium' as const, layout: 2000, population: 1 }
        ]) {
            let { world, state } = generatedHeist(bankSpec, 2);
            for (let turn = 0; turn < 4; turn++) {
                // Each crew member walks as far as it can toward the bank, then the world phase.
                for (const c of state.crew) {
                    const reach = reachable(world, crewPicture(world, state), c.pos, 10, { mover: c.id });
                    const to = reach.tiles.filter(t => t.canEnd).sort((a, b) => a.pos.y - b.pos.y || a.cost - b.cost)[0];
                    const path = to && pathTo(reach, to.pos);
                    if (path?.length) state = commit(world, state, { type: 'move', crew: c.id, path }).state;
                }
                for (const when of ['crew phase', 'after the world phase']) {
                    const sight = sightMap(world, state);
                    const observers = [
                        ...state.npcs.flatMap(n => (isKnownNow(world, state, n.id) ? [] : [npcObserver(world, { ...n, alerted: true })])),
                        ...world.cameras.flatMap(c => (state.knowledge.cameras.includes(c.id) ? [] : [cameraObserver(world, state, c.id)]))
                    ];
                    for (const o of observers) {
                        if (!o) continue;
                        const npc = state.npcs.find(n => n.pos.x === o.pos.x && n.pos.y === o.pos.y && o.profile.name === 'alerted');
                        const person = npc && world.people.find(p => p.id === npc.id)!;
                        const field = fieldOn(sight, o);
                        for (const t of field.tiles) {
                            expect(floorKnowledge(world, state, t), `${when}: (${t.x}, ${t.y}) seen from (${o.pos.x}, ${o.pos.y})`).not.toBe('scouted');
                            checked++;
                            // Green for a crew member means this unknown observer, Alerted, would do nothing to them there.
                            for (const c of state.crew) {
                                if (floorKnowledge(world, state, t, { crew: c.id }) !== 'scouted') continue;
                                const r = reaction(world.rules, {
                                    look: crewLook(c), notoriety: c.notoriety, observer: person?.observer ?? 'enforcer', role: person?.role ?? null, camera: !person,
                                    alerted: !!person, band: bandAt(field, t)!, zone: tileAt(world, t)!.zone,
                                    chebyshev: Math.max(Math.abs(t.x - o.pos.x), Math.abs(t.y - o.pos.y)), warnedByThis: false, warnedByAny: false
                                });
                                expect(r.outcome, `${c.id} green at (${t.x}, ${t.y}) seen from (${o.pos.x}, ${o.pos.y})`).toBe('-');
                            }
                        }
                    }
                    if (when === 'crew phase') state = commit(world, state, { type: 'endTurn' }).state;
                }
            }
            for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
                if (!seenAt(world, state, P(x, y))) expect(isUnknownRisk(world, state, P(x, y))).toBe(false);
            }
        }
        expect(checked).toBeGreaterThan(0);
    });
});

describe('unknown risk for a crew member (decision 24)', () => {
    // A street: jun at its west end sees 13 tiles, so (14, 0) on is unseen and anyone could stand there. A staff strip
    // round x 6 in the second row.
    const build = (start: { items?: string[]; notoriety?: number } = {}): { world: ReadonlyWorld; state: State } => {
        const world = fixtureWorld(['.'.repeat(40), '.'.repeat(40)], { zones: ['.'.repeat(40), '.....sss' + '.'.repeat(32)] });
        const state = patch(initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0), items: start.items ?? [] }] }), x => {
            x.crew[0]!.notoriety = start.notoriety ?? 0;
        });
        return { world, state };
    };
    const at = (world: ReadonlyWorld, state: State, p: Pos): string => floorKnowledge(world, state, p, { crew: 'jun' });

    it('leaves a Clean crew member green in Public near unscouted space, out of frisk range', () => {
        const { world, state } = build();
        // Within reach of the unseen street, so someone unseen could see it...
        expect(floorKnowledge(world, state, P(7, 0))).toBe('unknownRisk');
        expect(isUnknownRisk(world, state, P(7, 0))).toBe(true);
        // ...but nobody would do anything about Clean in Public, even Alerted (Clean reads as Concealed: an enforcer's +1 within 2).
        expect(at(world, state, P(7, 0))).toBe('scouted');
        expect(at(world, state, P(10, 0))).toBe('scouted');
        const floor = safeFloor(world, state, 'jun');
        expect(floor.at(P(6, 0))!.tint.kind).toBe('safe');
        expect(floor.tiles.filter(t => t.pos.y === 0 && t.pos.x <= 10).every(t => t.tint.kind === 'safe')).toBe(true);
        expect(explain(world, state, 'jun', P(6, 0))).toEqual([]);
        // Within frisk range of the unseen street an Alerted guard reading Concealed would add a pip.
        expect(at(world, state, P(12, 0))).toBe('unknownRisk');
        expect(unknownWatcher(world, state, 'jun', P(12, 0))!.reaction).toMatchObject({ outcome: '+1', profile: 'concealed' });
    });

    it('hatches Concealed near unscouted space, where an unseen guard could frisk or read it as Armed', () => {
        const { world, state } = build({ items: ['pistol'] });
        expect(at(world, state, P(12, 0))).toBe('unknownRisk');
        expect(at(world, state, P(7, 0))).toBe('unknownRisk');
        const w = unknownWatcher(world, state, 'jun', P(7, 0))!;
        expect(w).toMatchObject({ by: 'npc', observer: 'enforcer', reaction: { outcome: '!', profile: 'armed' } });
    });

    it('hatches Armed in Public, and says why', () => {
        const { world, state } = build({ items: ['assaultRifle'] });
        expect(at(world, state, P(7, 0))).toBe('unknownRisk');
        expect(safeFloor(world, state, 'jun').at(P(7, 0))!.tint.kind).toBe('unknownRisk');
        const lines = explain(world, state, 'jun', P(7, 0));
        expect(lines.map(l => [l.observer, l.by, l.text])).toEqual([
            [null, 'unknown', 'An unseen guard could see you here (Armed)'], [null, 'unknown', 'An unseen guard could see you on the way (Armed)']
        ]);
        // Mid-move only `!` counts: Armed in Public is `!` to an Alerted guard, so a path past it is unknown too.
        expect(unknownWatcher(world, state, 'jun', P(7, 0), { step: true })).not.toBeNull();
    });

    it('hatches Clean without a uniform in the Staff zone', () => {
        const { world, state } = build();
        expect(at(world, state, P(6, 1))).toBe('unknownRisk');
        expect(at(world, state, P(3, 1))).toBe('scouted');
        // A trespass to anyone of staff; an Alerted guard reads Clean as Concealed, which is `!` back here, mid-move too.
        expect(unknownWatcher(world, state, 'jun', P(6, 1))!.reaction).toMatchObject({ outcome: '!', readAs: 'staff' });
        expect(unknownWatcher(world, state, 'jun', P(6, 1), { step: true })).not.toBeNull();
        expect(explain(world, state, 'jun', P(6, 1))[0]!.text).toBe('An unseen guard could see you here (Clean, Staff zone)');
        // In a staff uniform the zone reads as Public, but the manager or the security chief sees through it in Core:
        // with nobody of the roster to say which class they are, either is taken as anyone, and it is still `!`.
        const dressed = patch(state, x => { x.crew[0]!.loadout.uniform = 'staff'; });
        expect(unknownWatcher(world, dressed, 'jun', P(6, 1))!.reaction).toMatchObject({ outcome: '!', why: expect.arrayContaining(['seenThrough']) });
        expect(explain(world, dressed, 'jun', P(6, 1))[0]!.text).toMatch(/^An unseen (manager|security chief) could see you here \(Clean, Staff zone\)$/);
        // The uniform does help against the rest: out in Public it changes nothing, and the floor reads as before.
        expect(at(world, dressed, P(4, 0))).toBe('scouted');
    });

    it('raises it with Notoriety', () => {
        expect(at(build().world, build().state, P(7, 0))).toBe('scouted');
        for (const notoriety of [2, 4]) {
            const { world, state } = build({ notoriety });
            expect(at(world, state, P(7, 0)), `Notoriety ${notoriety}`).toBe('unknownRisk');
            expect(unknownWatcher(world, state, 'jun', P(7, 0))!.reaction.why).toContain('notoriety');
        }
    });

    it('keeps grey grey, whatever the crew member carries', () => {
        for (const items of [[], ['assaultRifle']]) {
            const { world, state } = build({ items });
            expect(at(world, state, P(20, 0))).toBe('unscouted');
            expect(unknownWatcher(world, state, 'jun', P(20, 0))).toBeNull();
        }
    });
});

describe('sound pings and storage', () => {
    it('pings a noise from many tiles where its sources centre', () => {
        registerTestCommand('knowledgeTestLine', ctx => { makeNoise(ctx, 'pistol', [P(2, 0), P(3, 0), P(4, 0), P(5, 0), P(6, 0)], 'test line'); });
        const world = fixtureWorld(['.'.repeat(12)]);
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] });
        expect(step(world, state, { type: 'knowledgeTestLine' } as unknown as Command).state.knowledge.pings[0]!.at).toEqual(P(4, 0));
    });

    it('has one string per tile set, and refuses a broken one at load', () => {
        expect(() => decodeBits(encodeBits(new Uint8Array(7)).slice(0, -1) + '/', 7)).toThrow(/past its 7 tiles/);
        const world = fixtureWorld(['.'.repeat(12)]);
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] });
        const text = serialise({ genVersion: 'test', world, state });
        expect(deserialise(text).state.knowledge).toEqual(state.knowledge);
        const broken = text.replace(`"seen":"${state.knowledge.seen}"`, `"seen":"${state.knowledge.seen}A"`);
        expect(() => deserialise(broken)).toThrow(SaveFormatError);
        expect(() => deserialise(text.replace('"phaseTick":', '"phaseTickX":'))).toThrow(SaveFormatError);
    });
});

// ---------------------------------------------------------------------------------------------------------- Generated banks

function generatedHeist(spec: { tier: 'small' | 'city' | 'hq'; archetype: GenerateOptions['archetype']; layout: number; population: number }, crewCount: number): { world: ReadonlyWorld; state: State } {
    const bank = cachedBank({ ...spec, plot: 'midBlock' });
    const world = worldFromBank(bank);
    const spot = bank.getaways.find(g => g.id === 'curb') ?? bank.getaways[0]!;
    const taken = new Set(world.people.map(p => `${p.pos.x},${p.pos.y}`));
    let first: Pos | undefined;
    for (let r = 0; !first && r < 40; r++) {
        for (let y = spot.ty - r; y <= spot.ty + r && !first; y++) for (let x = spot.tx - r; x <= spot.tx + r && !first; x++) {
            const t = tileAt(world, P(x, y));
            if (t && t.room && !t.blocksMove && !t.raised && !taken.has(`${x},${y}`)) first = P(x, y);
        }
    }
    const probe = initialState(world, { seed: 0, crew: [{ id: 'probe', pos: first! }] });
    const reach = reachable(world, probe, first!, 40, { mover: 'probe' });
    const starts = [first!, ...reach.tiles.filter(t => t.canEnd && !taken.has(`${t.pos.x},${t.pos.y}`) && (t.pos.x !== first!.x || t.pos.y !== first!.y))
        .sort((a, b) => a.cost - b.cost).slice(0, crewCount - 1).map(t => t.pos)];
    return { world, state: initialState(world, { seed: 5, crew: starts.map((pos, i) => ({ id: `c${i}`, pos, facing: 'n' as const })) }) };
}

describe('on a generated bank', () => {
    const spec = { tier: 'city' as const, archetype: 'atrium' as const, layout: 2000, population: 1 };

    it.each([spec, { tier: 'hq' as const, archetype: 'atrium' as const, layout: 2000, population: 1 }])('updates in under 2 ms after a move with 4 crew ($tier)', bank => {
        const { world, state } = generatedHeist(bank, 4);
        // Every reachable tile of the first crew member, each a fresh place to look from (no cached field).
        const reach = reachable(world, state, state.crew[0]!.pos, 60, { mover: 'c0' }).tiles.filter(t => t.canEnd).map(t => t.pos);
        const samples: number[] = [];
        let s = state;
        for (const pos of reach.slice(0, 200)) {
            const moved = patch(s, x => { x.crew[0]!.pos = pos; });
            const t0 = performance.now();
            updateKnowledge(world, moved, () => {});
            samples.push(performance.now() - t0);
            s = moved;
        }
        samples.sort((a, b) => a - b);
        const mean = samples.reduce((a, b) => a + b, 0) / samples.length, p95 = samples[Math.floor(samples.length * 0.95)]!;
        // A whole 5-step move: the field at each step plus the update.
        const path = reachable(world, state, state.crew[1]!.pos, 10, { mover: 'c1' });
        const far = path.tiles.filter(t => t.canEnd).sort((a, b) => b.cost - a.cost)[0]!;
        const route = pathTo(path, far.pos)!;
        const t1 = performance.now();
        const move = commit(world, state, { type: 'move', crew: 'c1', path: route });
        const moveMs = performance.now() - t1;
        // What each further step of a move costs: the crew member's field from a tile not looked from before.
        const fresh = reachable(world, state, state.crew[2]!.pos, 60, { mover: 'c2' }).tiles.slice(0, 200), sight = sightMap(world, state);
        const t3 = performance.now();
        for (const t of fresh) fieldOn(sight, { pos: t.pos, facing: 'n', profile: { name: 'probe', blindInDark: false, arcs: [{ band: 'core', range: world.rules.crewRange, half: 180 }] } });
        const fieldMs = (performance.now() - t3) / fresh.length;
        console.log(`${bank.tier}: one fresh crew field ${fieldMs.toFixed(3)} ms; knowledge update over ${samples.length} moves: mean ${mean.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms; whole ${route.length}-tile move commit ${moveMs.toFixed(2)} ms (${move.events.length} events)`);
        expect(mean).toBeLessThan(2);
        // Unknown risk for every reachable tile of a crew member, as the overlay would ask.
        const t2 = performance.now();
        for (const t of reachable(world, state, state.crew[0]!.pos, 10, { mover: 'c0' }).tiles) isUnknownRisk(world, state, t.pos);
        console.log(`unknown risk over a move's reach: ${(performance.now() - t2).toFixed(2)} ms`);
    });

    it('is deterministic and survives a save', () => {
        const { world, state } = generatedHeist(spec, 4);
        const commands: Command[] = [];
        const reach = reachable(world, state, state.crew[0]!.pos, 10, { mover: 'c0' });
        const route = pathTo(reach, reach.tiles.filter(t => t.canEnd).at(-1)!.pos)!;
        commands.push({ type: 'move', crew: 'c0', path: route }, { type: 'endTurn' }, { type: 'endTurn' }, { type: 'endTurn' }, { type: 'endTurn' });
        const run = (s: State, cmds: readonly Command[]): State => cmds.reduce((x, c) => commit(world, x, c).state, s);
        const a = run(state, commands), b = run(state, commands);
        expect(hashOf(a)).toBe(hashOf(b));
        expect(Object.keys(a.knowledge.npcs).length).toBeGreaterThan(0);
        const mid = run(state, commands.slice(0, 2));
        const loaded = deserialise(serialise({ genVersion: 'test', world, state: mid }));
        expect(loaded.state.knowledge).toEqual(mid.knowledge);
        expect(hashOf(run(loaded.state, commands.slice(2)))).toBe(hashOf(a));
        // Compact: the seen set is one short string.
        expect(typeof a.knowledge.seen).toBe('string');
        expect(a.knowledge.seen.length).toBe(Math.ceil(world.width * world.height / 6));
    });
});
