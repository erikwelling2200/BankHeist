import { describe, expect, it } from 'vitest';
import type { GenerateOptions } from '../../src/gen/generate';
import { cachedBank } from '../bankCache';
import {
    bandAt, cameraObserver, clonePlain, commit, crewLook, crewPicture, decodeBits, explain, pathSafety, reaction, safeFloor, unknownWatcher, unknownWatchers, deserialise, encodeBits, fieldOn, fixtureWorld, floorKnowledge, freezeWorld,
    doorStatus, hashOf, initialState, isKnownNow, knownDoorStatus, tileVisibility, isUnknownRisk, noticedUnseen, pathTo, previewCertain, projectPreviewEvents, SaveFormatError, knownBlockers, knownView, makeNoise, markerKind, npcObserver, planMoveOptions, planRoute, preview, previewPicture, projectEvents, reachable,
    serialise, sightMap, tileAt, updateKnowledge, worldFromBank, withLayoutCameras, interruptsOf, actionPreview, doorDoubt, overlayTiles, previewDanger, safeLeg, sightDoubted, type Command, type FixtureOptions, type PersonDef, type Pos, type ReadonlyWorld,
    type SimEvent, type State, type UnknownOptions, type World
} from '../../src/sim';
import { OUTCOME_RANK } from '../../src/sim/data/matrix';
import { registerTestCommand, scouted, step } from './helpers';
import { floorTiles } from '../../src/game/worldUi';

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
        expect(floorKnowledge(world, state, P(6, 1))).toBe('hidden');
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
        // Nothing is hidden: the staff room is stale, where someone unseen could stand (decision 44).
        expect(tileVisibility(bought, state, P(6, 1))).toBe('stale');
        expect(floorKnowledge(bought, state, P(6, 1))).toBe('unknownRisk');
    });

    it('reveals what lies behind a door, the room, its camera and the CCTV feeds: a final action', () => {
        const { world, state } = build();
        const inside = step(world, state, { type: 'move', crew: 'jun', path: [P(1, 1), P(2, 1)] });
        expect(revealed(inside.events)).toEqual([]);
        expect(inside.undoable).toBe(true);
        // No move is planned into the hidden room: its door is opened first.
        expect(() => commit(world, inside.state, { type: 'move', crew: 'jun', path: [P(3, 1), P(4, 1), P(5, 1)] })).toThrow(/Can't step from \(4, 1\) to \(5, 1\)/);
        const atDoor = step(world, inside.state, { type: 'move', crew: 'jun', path: [P(3, 1), P(4, 1)] });
        expect(revealed(atDoor.events)).toEqual([]);
        const open: Command = { type: 'door', crew: 'jun', door: 'd', action: 'open' };
        const next = step(world, atDoor.state, { type: 'endTurn' }).state;
        const through = step(world, next, open);
        // From the doorway the corners beside the door stay hidden.
        expect(revealed(through.events)).toEqual(['tiles 7', 'room staff', 'camera cam', 'cctv desk']);
        expect(through.undoable).toBe(false);
        expect(knownView(world, through.state).cameras).toEqual([{ id: 'cam', pos: P(7, 0), facings: ['s'], status: 'live', monitored: false }]);
        // Seen from the doorway, the room can be walked into.
        expect(step(world, through.state, { type: 'move', crew: 'jun', path: [P(5, 1), P(6, 1)] }).state.crew[0]!.pos).toEqual(P(6, 1));
        // Before the CCTV room is scouted, a known camera's status is unknown (it counts as live, §8.8).
        const noDesk = freezeWorld({ ...(clonePlain(world) as World), objects: [] });
        const s2 = step(noDesk, initialState(noDesk, { seed: 1, crew: [{ id: 'jun', pos: P(4, 1) }] }), open).state;
        expect(knownView(noDesk, s2).cameras[0]!.status).toBe('unknown');
        // Preview and commit agree on it.
        expect(preview(world, next, open).undoable).toBe(false);
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

    it('walks on when a stranger comes into view, and reveals one only passed on the way', () => {
        // The clerk stands in an alcove off the corridor, seen only from the tile in front of it.
        const world = fixtureWorld(['.........', 'TTTT.TTTT', 'TTTT.TTTT'], { people: [clerk(P(4, 2), { facing: 'n' })] });
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] });
        expect(markerKind(world, state, 'clerk')).toBe(null);
        const path = [P(1, 0), P(2, 0), P(3, 0), P(4, 0), P(5, 0)];
        const moved = step(world, state, { type: 'move', crew: 'jun', path });
        // Someone new comes into view on the way: the move walks on to its end and reveals the clerk (decision 40).
        expect(moved.state.crew[0]!.pos).toEqual(P(5, 0));
        expect(moved.state.crew[0]!.actionsLeft).toBe(1);
        expect(moved.events.some(e => e.type === 'moveCut')).toBe(false);
        expect(revealed(moved.events)).toContain('npc clerk');
        expect(moved.undoable).toBe(false);
        // A preview tells nothing of it: the drawn path, no cut, nothing revealed.
        const pv = preview(world, state, { type: 'move', crew: 'jun', path });
        const shown = projectPreviewEvents(world, state, pv);
        expect(shown).toEqual([{ type: 'moved', crew: 'jun', from: P(0, 0), to: P(5, 0), path }]);
        // Known now (once seen, never a stranger again): walking past it doesn't stop. Out of view it is still where it
        // was until the world phase, then a ghost.
        const on = step(world, moved.state, { type: 'move', crew: 'jun', path: [P(6, 0), P(7, 0), P(8, 0)] }).state;
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
        // The truth: heard and revealed, the dash walked to its end.
        expect(pv.events.map(e => e.type)).toEqual(expect.arrayContaining(['heard', 'revealed']));
        expect(pv.events.some(e => e.type === 'moveCut')).toBe(false);
        const shown = projectPreviewEvents(world, state, pv);
        expect(JSON.stringify(shown)).not.toContain('hidden');
        expect(shown.map(e => e.type)).toEqual(['moved', 'noise']);
        expect(shown[0]).toMatchObject({ to: P(7, 0), path });
        // Played back after the commit, the crew has seen it: it is told.
        const done = step(world, state, { type: 'dash', crew: 'jun', path });
        expect(projectEvents(world, done.state, done.events, state).map(e => e.type)).toEqual(expect.arrayContaining(['heard', 'revealed']));
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

    it('walks on when a stranger comes into view, and bumps into it', () => {
        const r = step(blind, state, { type: 'move', crew: 'jun', path });
        // From (0, 2) the dark tile two steps on is within half range: seen, but the move only stops in front of it.
        expect(r.events).toContainEqual({ type: 'moveCut', crew: 'jun', npc: 'hidden', reason: 'bump', at: P(1, 2), planned: path });
        expect(revealed(r.events)).toContain('npc hidden');
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

describe('tile visibility (decision 44)', () => {
    // A lobby, a wall with a door, a staff room behind it the blueprint only outlines; the lobby runs on out of sight.
    const build = (intel?: World['intel']): { world: ReadonlyWorld; state: State } => {
        const map = ['.....sss' + '.'.repeat(20), '.....sss' + '.'.repeat(20)];
        const walls: FixtureOptions['walls'] = [{ between: [P(4, 0), P(5, 0)] }, { between: [P(4, 1), P(5, 1)], door: { id: 'd' } }];
        const base = fixtureWorld(map, { walls, rooms: ['.....SSS' + '.'.repeat(20), '.....SSS' + '.'.repeat(20)] });
        const world = intel ? freezeWorld({ ...(clonePlain(base) as World), intel }) : base;
        return { world, state: initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 1) }] }) };
    };
    const all = (world: ReadonlyWorld, state: State): Set<string> => {
        const out = new Set<string>();
        for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) out.add(tileVisibility(world, state, P(x, y)));
        return out;
    };

    it('never hides public floor: never seen, it is stale', () => {
        const { world, state } = build();
        expect(tileVisibility(world, state, P(2, 1))).toBe('seen');
        expect(seenAt(world, state, P(27, 0))).toBe(false);
        expect(tileVisibility(world, state, P(27, 0))).toBe('stale');
        expect(floorKnowledge(world, state, P(27, 0))).not.toBe('hidden');
    });

    it('hides a room the blueprint only outlines until it is seen, then it is seen, and stale after the world phase', () => {
        const { world, state } = build();
        expect(tileVisibility(world, state, P(6, 1))).toBe('hidden');
        expect(floorKnowledge(world, state, P(6, 1))).toBe('hidden');
        const opened = step(world, patch(state, s => { s.crew[0]!.pos = P(4, 1); }), { type: 'door', crew: 'jun', door: 'd', action: 'open' }).state;
        const inside = step(world, opened, { type: 'move', crew: 'jun', path: [P(5, 1)] }).state;
        expect(tileVisibility(world, inside, P(6, 1))).toBe('seen');
        // Back out, the door swings shut behind them: the room is no longer seen, but never hidden again.
        const out = step(world, patch(inside, s => { s.crew[0]!.pos = P(0, 0); }), { type: 'endTurn' }).state;
        expect(tileVisibility(world, out, P(6, 1))).toBe('stale');
        expect(knownView(world, out).visibility[1 * world.width + 6]).toBe(1);
    });

    it('leaves hidden tiles out of the safe floor: no move is planned into them', () => {
        // Beside the door: the staff room behind it is hidden, the lobby seen.
        const { world } = build();
        const beside = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(4, 1) }] });
        const floor = safeFloor(world, beside, 'jun');
        expect(floor.tiles.length).toBeGreaterThan(1);
        for (const t of floor.tiles) {
            expect(tileVisibility(world, beside, t.pos), `(${t.pos.x}, ${t.pos.y})`).not.toBe('hidden');
            expect(t.knowledge).not.toBe('hidden');
            expect(t.tint.kind).not.toBe('grey');
        }
        expect(floor.at(P(5, 1))).toBeUndefined();
        expect(pathSafety(world, beside, 'jun', [P(5, 1)]).ok).toBe(false);
        // Public floor round a corner nobody has seen: stale, judged, never grey.
        const corner = fixtureWorld(['.'.repeat(10), ...Array.from({ length: 4 }, () => '.'.repeat(10))], {
            walls: [
                ...Array.from({ length: 9 }, (_, x) => ({ between: [P(x, 0), P(x, 1)] as [Pos, Pos] })),
                ...Array.from({ length: 4 }, (_, i) => ({ between: [P(8, i + 1), P(9, i + 1)] as [Pos, Pos] }))
            ]
        });
        const s = initialState(corner, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] });
        const round = safeFloor(corner, s, 'jun').tiles.filter(t => !seenAt(corner, s, t.pos));
        expect(round.length).toBeGreaterThan(0);
        for (const t of round) {
            expect(t.knowledge).not.toBe('hidden');
            expect(t.tint.kind).not.toBe('grey');
        }
    });

    it('hides nothing with Blueprints', () => {
        const { world, state } = build({ blueprints: true });
        expect(all(world, state).has('hidden')).toBe(false);
        expect(tileVisibility(world, state, P(6, 1))).toBe('stale');
    });
});

describe('doors not seen this turn (decision 44)', () => {
    // An L: a corridor along row 0, turning down column 9, walled off from the rest; the door across the column at
    // (9, 3)|(9, 4) is out of sight from the corner (8, 0).
    const build = (lock: 'none' | 'mechanical'): { world: ReadonlyWorld; state: State } => {
        const walls: FixtureOptions['walls'] = [
            ...Array.from({ length: 9 }, (_, x) => ({ between: [P(x, 0), P(x, 1)] as [Pos, Pos] })),
            ...Array.from({ length: 9 }, (_, i) => ({ between: [P(8, i + 1), P(9, i + 1)] as [Pos, Pos] })),
            { between: [P(9, 3), P(9, 4)], door: { id: 'd', lock, start: lock === 'none' ? 'closed' as const : 'locked' as const } }
        ];
        const world = fixtureWorld(Array.from({ length: 10 }, () => '.'.repeat(10)), { walls });
        // Seen open from beside it, then the crew goes round the corner and the world phase shuts it out of sight.
        const opened = patch(initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(9, 2) }] }), s => { s.doors.d = { status: 'open' }; });
        const seen = step(world, opened, { type: 'wait', crew: 'jun' }).state;
        expect(seen.knowledge.doors.d).toBe('open');
        return { world, state: step(world, patch(seen, s => { s.crew[0]!.pos = P(8, 0); }), { type: 'endTurn' }).state };
    };
    const path = [P(9, 0), P(9, 1), P(9, 2), P(9, 3), P(9, 4)];

    it('is pictured as last seen, never as it is', () => {
        const { world, state } = build('mechanical');
        expect(doorStatus(world, state, 'd')).toBe('locked');
        expect(knownView(world, state).doors).toEqual([{ id: 'd', status: 'open', inView: false, fresh: false }]);
        expect(knownDoorStatus(world, state, 'd')).toBe('open');
        expect(crewPicture(world, state).doors.d!.status).toBe('open');
        // Never seen: plain closed, whatever it is.
        const fresh = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] });
        expect(fresh.knowledge.doors.d).toBeUndefined();
        expect(knownDoorStatus(world, fresh, 'd')).toBe('closed');
    });

    it('stops a move before a door found locked: the action spent, final, the preview showing the drawn path', () => {
        const { world, state } = build('mechanical');
        const r = step(world, state, { type: 'move', crew: 'jun', path });
        expect(r.state.crew[0]!.pos).toEqual(P(9, 3));
        expect(r.state.crew[0]!.actionsLeft).toBe(state.crew[0]!.actionsLeft - 1);
        expect(r.events).toContainEqual({ type: 'moveCut', crew: 'jun', reason: 'door', door: 'd', status: 'locked', at: P(9, 3), planned: path });
        expect(r.events.some(e => e.type === 'doorOpened')).toBe(false);
        expect(r.undoable).toBe(false);
        expect(interruptsOf(world, state, r).find(i => i.kind === 'moveCut')?.text).toBe('jun found a door locked');
        // Found: now it is known as it is.
        expect(knownView(world, r.state).doors[0]).toMatchObject({ status: 'locked', inView: true, fresh: true });
        expect(projectEvents(world, r.state, r.events, state)).toContainEqual(expect.objectContaining({ type: 'moveCut', reason: 'door' }));
        const shown = projectPreviewEvents(world, state, previewCertain(world, state, { type: 'move', crew: 'jun', path }));
        expect(shown.find(e => e.type === 'moved')).toMatchObject({ to: P(9, 4), path });
        expect(shown.some(e => e.type === 'moveCut')).toBe(false);
    });

    it('walks through a door found closed, opening it', () => {
        const { world, state } = build('none');
        expect(doorStatus(world, state, 'd')).toBe('closed');
        const r = step(world, state, { type: 'move', crew: 'jun', path });
        expect(r.state.crew[0]!.pos).toEqual(P(9, 4));
        expect(r.events.some(e => e.type === 'moveCut')).toBe(false);
        expect(r.events).toContainEqual({ type: 'doorOpened', door: 'd', by: 'jun' });
    });

    it('hatches every tile reached through a door that could be locked, and only those', () => {
        const locked = build('mechanical');
        const tile = safeFloor(locked.world, locked.state, 'jun').at(P(9, 4))!;
        expect(tile.path).toEqual(path);
        expect(tile.unknownPath).toBe(true);
        expect(tile.tint.kind).toBe('unknownRisk');
        // The tile before the door isn't reached through it.
        expect(safeFloor(locked.world, locked.state, 'jun').at(P(9, 3))!.unknownPath).toBe(false);
        const drawn = pathSafety(locked.world, locked.state, 'jun', path);
        if (!drawn.ok) throw new Error(drawn.reason);
        expect(drawn.steps[3]!.stop!.unknownPath).toBe(false);
        expect(drawn.end.unknownPath).toBe(true);
        expect(explain(locked.world, locked.state, 'jun', P(9, 4)).map(l => l.text)).toContain('On the way: a door not seen this turn could be locked');
        // A door with no lock opens whichever way it stands: nothing to hatch for it.
        const plain = build('none');
        expect(safeFloor(plain.world, plain.state, 'jun').at(P(9, 4))!.unknownPath).toBe(false);
    });

    it('marks the unsafe tiles of a route the same however the door really stands', () => {
        // Leg 1 runs up to the door and through it: a locked one would cut it in the truth, which the marks never show.
        const route = [P(9, 0), ...Array.from({ length: 9 }, (_, i) => P(9, i + 1))];
        const plans = (['none', 'mechanical'] as const).map(lock => {
            const { world, state } = build(lock);
            const plan = planRoute(world, state, 'jun', route, { safety: true });
            return { legs: plan.legs.map(l => `${l.turn}:${l.path.length}`), unsafe: plan.unsafe };
        });
        expect(plans[1]).toEqual(plans[0]);
    });

    it('pictures a door never seen as closed, and hatches a way through it when it could be locked', () => {
        // Two rooms at x 0..9 split by a wall at 4|5 with a door at row 1, walled off from a public hall at x 10..29
        // where jun starts (seeing x >= 16); then jun stands at (3, 1) beside the door, nothing new seen.
        const build = (lock: 'none' | 'mechanical', zone: '.' | 's'): { world: ReadonlyWorld; state: State } => {
            const walls: FixtureOptions['walls'] = [0, 1, 2].flatMap(y => [
                { between: [P(9, y), P(10, y)] as [Pos, Pos] },
                { between: [P(4, y), P(5, y)] as [Pos, Pos], ...(y === 1 ? { door: { id: 'd', lock, start: lock === 'none' ? 'closed' as const : 'locked' as const } } : {}) }
            ]);
            const row = zone.repeat(10) + '.'.repeat(20);
            const world = fixtureWorld([row, row, row], { walls, rooms: Array.from({ length: 3 }, () => (zone === 's' ? 'aaaaabbbbb' : '.'.repeat(10)) + '.'.repeat(20)) });
            const start = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(29, 1) }] });
            return { world, state: patch(start, s => { s.crew[0]!.pos = P(3, 1); }) };
        };
        const reached = (x: { world: ReadonlyWorld; state: State }) => safeFloor(x.world, x.state, 'jun').at(P(6, 1))!;
        // On the layout: whether it locks is known; how it stands isn't.
        const locked = build('mechanical', '.');
        expect(knownDoorStatus(locked.world, locked.state, 'd')).toBe('closed');
        expect(crewPicture(locked.world, locked.state).doors.d!.status).toBe('closed');
        expect(reached(locked).unknownPath).toBe(true);
        expect(step(locked.world, locked.state, { type: 'move', crew: 'jun', path: reached(locked).path }).events)
            .toContainEqual(expect.objectContaining({ type: 'moveCut', reason: 'door', status: 'locked' }));
        expect(reached(build('none', '.')).unknownPath).toBe(false);
        // Between hidden tiles only, even whether it locks is unknown; nothing is planned into them either.
        const hidden = build('none', 's');
        expect(tileVisibility(hidden.world, hidden.state, P(4, 1))).toBe('hidden');
        expect(doorDoubt(hidden.world, hidden.state)?.unknownLock.has('d')).toBe(true);
        expect(safeFloor(hidden.world, hidden.state, 'jun').at(P(6, 1))).toBeUndefined();
    });

    // A corridor split by a wall at 20|21 with a door at row 1 (no lock, built closed, never seen). The rota predicts two
    // guards: one at (24, 1) looking west down row 1 through the doorway, one at (10, 1) looking east. Masked jun saw up to
    // x = 19 from (6, 1) at the end of the world phase and now stands at (16, 1): neither side of the door is fresh.
    const doorway = (door: 'open' | 'closed', seen = false): { world: ReadonlyWorld; state: State } => {
        const walls: FixtureOptions['walls'] = [0, 1, 2].map(y => ({
            between: [P(20, y), P(21, y)] as [Pos, Pos], ...(y === 1 ? { door: { id: 'd', start: 'closed' as const } } : {})
        }));
        const people = [
            clerk(P(24, 1), { id: 'guard', role: 'guard', observer: 'enforcer' }),
            clerk(P(10, 1), { id: 'near', role: 'guard', observer: 'enforcer', facing: 'e', schedule: [{ from: 1, activity: 'post', label: 'post', room: '', at: P(10, 1), facing: 'e' }] })
        ];
        const world = freezeWorld({ ...(clonePlain(fixtureWorld(Array.from({ length: 3 }, () => '.'.repeat(26)), { walls, people })) as World), intel: { guardRota: true } });
        const start = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(6, 1), masked: true }] });
        let state = patch(start, s => {
            s.crew[0]!.pos = P(16, 1);
            s.doors.d = { status: door };
        });
        // What jun sees from there, as after a step.
        if (seen) state = patch(state, s => updateKnowledge(world, s, () => {}));
        return { world, state };
    };

    it('hatches a tile a known NPC could see only through a door not seen this turn, however the door stands', () => {
        const open = doorway('open'), shut = doorway('closed');
        expect(markerKind(open.world, open.state, 'guard')).toBe('predicted');
        expect(knownDoorStatus(open.world, open.state, 'd')).toBe('closed');
        const a = safeFloor(open.world, open.state, 'jun'), b = safeFloor(shut.world, shut.state, 'jun');
        // The floor never tells how the door stands.
        expect(JSON.stringify(a.tiles)).toBe(JSON.stringify(b.tiles));
        const through = a.at(P(19, 1))!;
        expect(through.doorRisk).toBe(true);
        expect(through.tint.kind).toBe('unknownRisk');
        expect(explain(open.world, open.state, 'jun', P(19, 1)).map(l => l.text)).toContain('A door not seen this turn could make it worse');
        // A tile the far guard can't see through the door (out of reach) keeps its verdict: the near guard's eye.
        const aside = a.at(P(13, 1))!;
        expect(aside.doorRisk).toBe(false);
        expect(aside.tint.kind).toBe('red');
        // The truth, either way: the far guard sees jun on (19, 1) through the open door, not through the shut one.
        const move: Command = { type: 'move', crew: 'jun', path: through.path };
        const byGuard = (events: readonly SimEvent[]): boolean => events.some(e => e.type === 'exposed' && e.npc === 'guard');
        expect(byGuard(step(open.world, open.state, move).events)).toBe(true);
        expect(byGuard(step(shut.world, shut.state, move).events)).toBe(false);
        // Nor does the move's preview: it is judged with the door shut, so the far guard never shows through it.
        const shown = (x: { world: ReadonlyWorld; state: State }): SimEvent[] => projectPreviewEvents(x.world, x.state, previewCertain(x.world, x.state, move));
        expect(shown(open)).toEqual(shown(shut));
        expect(byGuard(shown(open))).toBe(false);
    });

    it('shows certain danger through the doubt: red where a known NPC sees the crew in plain view, not hatched', () => {
        // The near guard sees masked jun on (17, 1) in plain view; the far guard could too, through the door.
        const { world, state } = doorway('open'), shut = doorway('closed');
        expect(sightDoubted(world, doorDoubt(world, state)!, P(24, 1), P(17, 1))).toBe(true);
        for (const x of [{ world, state }, shut]) {
            const tile = safeFloor(x.world, x.state, 'jun').at(P(17, 1))!;
            expect(tile.tint).toMatchObject({ kind: 'red', eye: true, doorRisk: false });
            expect(tile.doorRisk).toBe(false);
        }
        const drawn = pathSafety(world, state, 'jun', [P(17, 1)]);
        if (!drawn.ok) throw new Error(drawn.reason);
        expect(drawn.firstUnsafe).toBe(0);
        expect(explain(world, state, 'jun', P(17, 1)).map(l => l.observer)).toContain('near');
        expect(explain(world, state, 'jun', P(17, 1)).map(l => l.text)).not.toContain('A door not seen this turn could make it worse');
    });

    it('hatches a certain warning only where the door could make it worse', () => {
        // Staff floor: a teller at (13, 1) sees armed jun (pips); the far guard could see them through the door (worse).
        const build = (door: 'open' | 'closed'): { world: ReadonlyWorld; state: State } => {
            const walls: FixtureOptions['walls'] = [0, 1, 2].map(y => ({
                between: [P(20, y), P(21, y)] as [Pos, Pos], ...(y === 1 ? { door: { id: 'd', start: 'closed' as const } } : {})
            }));
            const rows = Array.from({ length: 3 }, () => 's'.repeat(26));
            const people = [
                clerk(P(24, 1), { id: 'guard', role: 'guard', observer: 'enforcer' }),
                clerk(P(13, 1), { id: 'teller', role: 'teller', facing: 'e', schedule: [{ from: 1, activity: 'post', label: 'post', room: '', at: P(13, 1), facing: 'e' }] })
            ];
            const world = freezeWorld({ ...(clonePlain(fixtureWorld(rows, { walls, people, zones: rows })) as World), intel: { guardRota: true } });
            const start = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(6, 1), items: ['pistol'] }] });
            return { world, state: patch(start, s => { s.crew[0]!.pos = P(16, 1); s.doors.d = { status: door }; }) };
        };
        const open = build('open'), shut = build('closed');
        const a = safeFloor(open.world, open.state, 'jun'), b = safeFloor(shut.world, shut.state, 'jun');
        expect(JSON.stringify(a.tiles)).toBe(JSON.stringify(b.tiles));
        const tile = a.at(P(20, 1))!;
        expect(tile.tint.kind).toBe('amber');
        expect(tile.tint.pips).toEqual([{ npc: 'teller', pips: 2 }]);
        expect(tile.doorRisk).toBe(true);
        // Worse with the door open: the guard sees jun through it.
        const move: Command = { type: 'move', crew: 'jun', path: tile.path };
        const byGuard = (events: readonly SimEvent[]): boolean => events.some(e => e.type === 'exposed' && e.npc === 'guard');
        expect(byGuard(step(open.world, open.state, move).events)).toBe(true);
        expect(byGuard(step(shut.world, shut.state, move).events)).toBe(false);
        expect(floorTiles(a).find(t => t.pos.x === 20 && t.pos.y === 1)).toMatchObject({ kind: 'amber', doorRisk: true });
        expect(overlayTiles(a).find(t => t.pos.x === 20 && t.pos.y === 1)).toMatchObject({ state: 'pip2', doorRisk: true });
    });

    it('warns of a certain sighting of the mover whoever else a doubted door hides: previews and auto-advance', () => {
        // Masked jun idles at (18, 1), where the guard could see them only through the door; masked mara walks from the
        // far corner into the guard's plain view. Neither side of the door is seen this turn.
        const build = (door: 'open' | 'closed'): { world: ReadonlyWorld; state: State } => {
            const walls: FixtureOptions['walls'] = [0, 1, 2, 3, 4].map(y => ({
                between: [P(20, y), P(21, y)] as [Pos, Pos], ...(y === 1 ? { door: { id: 'd', start: 'closed' as const } } : {})
            }));
            const people = [clerk(P(24, 1), { id: 'guard', role: 'guard', observer: 'enforcer' })];
            const world = freezeWorld({ ...(clonePlain(fixtureWorld(Array.from({ length: 5 }, () => '.'.repeat(26)), { walls, people })) as World), intel: { guardRota: true } });
            const start = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(18, 1), masked: true }, { id: 'mara', pos: P(25, 4), masked: true }] });
            return {
                world, state: patch(start, s => {
                    s.doors.d = { status: door };
                    const fresh = decodeBits(s.knowledge.fresh, world.width * world.height);
                    fresh[1 * world.width + 20] = fresh[1 * world.width + 21] = 0;
                    s.knowledge.fresh = encodeBits(fresh);
                })
            };
        };
        const path = [P(24, 3), P(23, 2)];
        for (const door of ['open', 'closed'] as const) {
            const { world, state } = build(door);
            const d = doorDoubt(world, state)!;
            expect(d.doors.has('d')).toBe(true);
            expect(sightDoubted(world, d, P(24, 1), P(18, 1))).toBe(true);
            expect(sightDoubted(world, d, P(24, 1), P(23, 2))).toBe(false);
            const move: Command = { type: 'move', crew: 'mara', path };
            const shown = actionPreview(world, state, move);
            if (!shown.ok) throw new Error(shown.reason);
            expect(shown.witnesses).toContainEqual(expect.objectContaining({ observer: 'guard', crew: 'mara', what: 'exposed' }));
            expect(shown.witnesses.some(w => w.crew === 'jun')).toBe(false);
            expect(previewDanger(world, state, move)?.stop).toMatch(/would make/);
            expect(safeLeg(world, state, 'mara', path)).toMatchObject({ path: [P(24, 3)], unsafeAt: P(23, 2) });
        }
    });

    it('previews a move through a door that could be locked as stopped before it, the drawn path aside', () => {
        // The doorway with a lock on the door: built closed, never seen. Through it, the far guard sees masked jun on (21, 1).
        const walls: FixtureOptions['walls'] = [0, 1, 2].map(y => ({
            between: [P(20, y), P(21, y)] as [Pos, Pos], ...(y === 1 ? { door: { id: 'd', lock: 'mechanical' as const, start: 'closed' as const } } : {})
        }));
        const people = [clerk(P(24, 1), { id: 'guard', role: 'guard', observer: 'enforcer' })];
        const world = freezeWorld({ ...(clonePlain(fixtureWorld(Array.from({ length: 3 }, () => '.'.repeat(26)), { walls, people })) as World), intel: { guardRota: true } });
        const state = patch(initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(6, 1), masked: true }] }), s => { s.crew[0]!.pos = P(16, 1); });
        expect(markerKind(world, state, 'guard')).toBe('predicted');
        const path = [P(17, 1), P(18, 1), P(19, 1), P(20, 1), P(21, 1)];
        for (const type of ['move', 'dash'] as const) {
            const cmd: Command = { type, crew: 'jun', path };
            // The truth with the door closed: jun walks through it and the guard is alerted.
            expect(step(world, state, cmd).events).toContainEqual(expect.objectContaining({ type: 'alerted', npc: 'guard' }));
            const r = previewCertain(world, state, cmd), shown = projectPreviewEvents(world, state, r);
            // Nothing of what only the steps beyond the door would cause: no witness, no alert, no noise from (21, 1).
            expect(shown.some(e => 'npc' in e && e.npc === 'guard')).toBe(false);
            expect(shown.find(e => e.type === 'moved')).toMatchObject({ to: P(21, 1), path });
            expect(shown.some(e => e.type === 'moveCut' || e.type === 'doorOpened')).toBe(false);
            if (type === 'dash') expect(shown.find(e => e.type === 'noise')).toMatchObject({ sources: path.slice(0, 4) });
            expect(r.state.crew[0]!.pos).toEqual(P(20, 1));
            expect(r.state.doors.d!.status).toBe('closed');
            expect(r.state.knowledge.doors.d).toBeUndefined();
            const a = actionPreview(world, state, cmd);
            if (!a.ok) throw new Error(a.reason);
            expect(a).toMatchObject({ witnesses: [], undoable: true, carriers: { starts: [], worldPhase: [] } });
        }
    });

    it('marks who is sent to look whoever unknown stands behind a door not seen this turn', () => {
        // The doorway with one guard predicted at (18, 2) and, or not, an unknown clerk just behind the door at (21, 1).
        const build = (behind: boolean): { world: ReadonlyWorld; state: State } => {
            const walls: FixtureOptions['walls'] = [0, 1, 2].map(y => ({
                between: [P(20, y), P(21, y)] as [Pos, Pos], ...(y === 1 ? { door: { id: 'd', start: 'closed' as const } } : {})
            }));
            const people = [
                clerk(P(18, 2), { id: 'guard', role: 'guard', observer: 'enforcer', schedule: [{ from: 1, activity: 'post', label: 'post', room: '', at: P(18, 2), facing: 'w' }] }),
                ...(behind ? [clerk(P(21, 1), { facing: 'e', schedule: [{ from: 1, activity: 'post', label: 'post', room: '', at: P(21, 1), facing: 'e' }] })] : [])
            ];
            const world = freezeWorld({ ...(clonePlain(fixtureWorld(Array.from({ length: 3 }, () => '.'.repeat(26)), { walls, people })) as World), intel: { guardRota: true } });
            const state = patch(initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(6, 1), masked: true }] }), s => { s.crew[0]!.pos = P(16, 1); });
            return { world, state };
        };
        const ears = [false, true].map(behind => {
            const { world, state } = build(behind);
            expect(doorDoubt(world, state)?.doors.has('d')).toBe(true);
            expect(markerKind(world, state, 'guard')).not.toBeNull();
            if (behind) expect(markerKind(world, state, 'clerk')).toBeNull();
            const shown = actionPreview(world, state, { type: 'dash', crew: 'jun', path: [P(17, 1), P(18, 1), P(19, 1)] });
            if (!shown.ok) throw new Error(shown.reason);
            return shown.noises.map(n => ({ ears: n.ears, unsure: !!n.sentUnsure }));
        });
        expect(ears[0]).toEqual([{ ears: [expect.objectContaining({ npc: 'guard', sent: true })], unsure: false }]);
        expect(ears[1]).toEqual(ears[0]);
    });

    it('judges by the door as it is once it is seen this turn', () => {
        const { world, state } = doorway('open', true);
        expect(knownDoorStatus(world, state, 'd')).toBe('open');
        const tile = safeFloor(world, state, 'jun').at(P(19, 1))!;
        expect(tile.doorRisk).toBe(false);
        expect(tile.tint.kind).toBe('red');
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
        expect(knownView(world, seen).doors).toEqual([{ id: 'far', status: 'closed', inView: true, fresh: true }]);
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
        // Public floor nobody has seen is stale, never hidden (decision 44): someone unseen could stand on it.
        expect(floorKnowledge(world, s, P(35, 0))).toBe('unknownRisk');
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
                if (tileVisibility(world, state, P(x, y)) === 'hidden') expect(isUnknownRisk(world, state, P(x, y))).toBe(false);
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
            const { world } = build({ items });
            // A staff room the blueprint only outlines, nobody has seen into: hidden.
            const roomed = freezeWorld({ ...(clonePlain(world) as World), tiles: world.tiles.map((t, i) => ({ ...t, room: i % 40 >= 20 ? 'back' : null, zone: i % 40 >= 20 ? 'staff' as const : t.zone })) });
            const s = initialState(roomed, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0), items }] });
            expect(at(roomed, s, P(20, 0))).toBe('hidden');
            expect(unknownWatcher(roomed, s, 'jun', P(20, 0))).toBeNull();
            expect(unknownWatchers(roomed, s, 'jun', P(20, 0))).toEqual([]);
        }
    });
});

/**
 * `unknownWatchers` agrees with `unknownWatcher` on `p`: someone iff anyone, the worst's tile among them, and nothing
 * worse than the worst anywhere. Returns how many it found.
 */
function watchersAgree(world: ReadonlyWorld, state: State, crew: string, p: Pos, options: UnknownOptions = {}): number {
    const w = unknownWatcher(world, state, crew, p, options), all = unknownWatchers(world, state, crew, p, options);
    const where = `${crew} at (${p.x}, ${p.y})${options.step ? ' mid-move' : ''}`;
    expect(all.length > 0, where).toBe(!!w);
    if (w) {
        expect(all.some(a => a.from.x === w.from.x && a.from.y === w.from.y), where).toBe(true);
        expect(Math.max(...all.map(a => OUTCOME_RANK[a.reaction.outcome])), where).toBe(OUTCOME_RANK[w.reaction.outcome]);
        expect(isUnknownRisk(world, state, p), where).toBe(true);
    }
    // An NPC only on a tile not fresh, off known furniture (anywhere hidden); a camera only on a tile never seen.
    const n = world.width * world.height, seen = decodeBits(state.knowledge.seen, n), fresh = decodeBits(state.knowledge.fresh, n);
    for (const a of all) {
        const j = a.from.y * world.width + a.from.x, hidden = tileVisibility(world, state, a.from) === 'hidden';
        if (a.by === 'npc') expect(!fresh[j] && (hidden || !world.tiles[j]!.blocksMove), `${where} from (${a.from.x}, ${a.from.y})`).toBe(true);
        else expect(seen[j], `${where} from (${a.from.x}, ${a.from.y})`).toBe(0);
    }
    return all.length;
}

/**
 * A 12x12 open floor, every tile seen and fresh but those given: `stale` seen and not fresh, `unseen` never seen; `#`
 * where `furniture` says. Public, but for a staff room `a` (an outline on the blueprint) where x >= 8 or y >= 10. jun
 * Armed (a rifle) at (0, 0).
 */
function staged(spec: { stale?: Pos[]; unseen?: Pos[]; furniture?: Pos[]; rules?: FixtureOptions['rules'] }): { world: ReadonlyWorld; state: State } {
    const grid = (f: (x: number, y: number) => string): string[] => Array.from({ length: 12 }, (_, y) => Array.from({ length: 12 }, (_, x) => f(x, y)).join(''));
    const inRoom = (x: number, y: number): boolean => x >= 8 || y >= 10;
    const rows = grid((x, y) => (spec.furniture?.some(f => f.x === x && f.y === y) ? '#' : '.'));
    const world = fixtureWorld(rows, {
        zones: grid((x, y) => (inRoom(x, y) ? 's' : '.')), rooms: grid((x, y) => (inRoom(x, y) ? 'a' : '.')), ...(spec.rules ? { rules: spec.rules } : {})
    });
    const n = world.width * world.height, seen = new Uint8Array(n).fill(1), fresh = new Uint8Array(n).fill(1);
    for (const p of spec.stale ?? []) fresh[p.y * 12 + p.x] = 0;
    for (const p of spec.unseen ?? []) seen[p.y * 12 + p.x] = fresh[p.y * 12 + p.x] = 0;
    const state = patch(initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0), items: ['assaultRifle'] }] }), x => {
        x.knowledge.seen = encodeBits(seen);
        x.knowledge.fresh = encodeBits(fresh);
    });
    return { world, state };
}

describe('every tile an unknown observer could react from', () => {
    const xs = (list: readonly { from: Pos }[]): number[] => list.map(w => w.from.x);

    it('finds the stale tiles in reach and sight, halved on a dark tile, stopped by a wall', () => {
        // jun on (6, 0) sees the dark (7, 0) beside it, then walks to (17, 0): after the world phase only 4..30 (lit) is
        // fresh, so 0..3 and the dark tile are stale. Armed in Public: `!` to an Alerted guard from any of them.
        const world = fixtureWorld(['.'.repeat(40)], { dark: [P(7, 0)] });
        let s = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(6, 0), items: ['assaultRifle'] }] });
        s = step(world, patch(s, x => { x.crew[0]!.pos = P(17, 0); }), { type: 'wait', crew: 'jun' }).state;
        s = step(world, s, { type: 'endTurn' }).state;
        expect(xs(unknownWatchers(world, s, 'jun', P(8, 0)))).toEqual([7, 3, 2, 1, 0]);
        expect(xs(unknownWatchers(world, s, 'jun', P(9, 0)))).toEqual([7, 3, 2, 1]);
        // On the dark tile the reach halves to 4, and the tile itself counts.
        expect(xs(unknownWatchers(world, s, 'jun', P(7, 0)))).toEqual([7, 3]);
        expect(unknownWatchers(world, s, 'jun', P(16, 0))).toEqual([]);
        // A wall between 14 and 15: only 14 sees past it, of the unseen street east of jun's 13 tiles.
        const walled = fixtureWorld(['.'.repeat(40)], { walls: [{ between: [P(14, 0), P(15, 0)] }] });
        const w = initialState(walled, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0), items: ['assaultRifle'] }] });
        expect(xs(unknownWatchers(walled, w, 'jun', P(10, 0)))).toEqual([14]);
        const open = fixtureWorld(['.'.repeat(40)]);
        expect(xs(unknownWatchers(open, initialState(open, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0), items: ['assaultRifle'] }] }), 'jun', P(10, 0))))
            .toEqual([14, 15, 16, 17, 18]);
        for (const x of [7, 8, 9, 10, 16]) watchersAgree(world, s, 'jun', P(x, 0));
    });

    it('keeps only the tiles a reaction comes from: Clean in Public, within frisk range', () => {
        const world = fixtureWorld(['.'.repeat(40)]);
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] });
        const near = unknownWatchers(world, state, 'jun', P(12, 0));
        expect(near.length).toBeGreaterThan(0);
        expect(near.every(w => Math.abs(w.from.x - 12) <= world.rules.friskRange && w.reaction.outcome === '+1')).toBe(true);
        expect(unknownWatchers(world, state, 'jun', P(7, 0))).toEqual([]);
        // Mid-move only `!` counts, and a pip isn't one.
        expect(unknownWatchers(world, state, 'jun', P(12, 0), { step: true })).toEqual([]);
    });

    it('picks the worst on a tie as before: an NPC over a camera, the nearest over the nearest within frisk range', () => {
        // Frisk range 3: the nearest unseen tile to (4, 4) is (8, 4), 4 away (Chebyshev 4); the nearest within frisk
        // range is (7, 7), 4.2 away (Chebyshev 3). Armed in Public: `!` from both, to a guard and a camera alike.
        const { world, state } = staged({ unseen: [P(8, 4), P(7, 7)], rules: { friskRange: 3 } });
        const all = unknownWatchers(world, state, 'jun', P(4, 4));
        expect(all.map(w => [w.from, w.reaction.outcome])).toEqual([[P(8, 4), '!'], [P(7, 7), '!']]);
        // A camera there would see `!` too (in its core, 4 away): the guard, judged first, keeps the tie.
        expect(world.rules.cameraRange).toBeGreaterThanOrEqual(4);
        const camera = reaction(world.rules, {
            look: crewLook(state.crew[0]!), notoriety: 0, observer: 'enforcer', role: null, camera: true, alerted: false, band: 'core', zone: 'public',
            chebyshev: 4, warnedByThis: false, warnedByAny: false
        });
        expect(camera.outcome).toBe('!');
        expect(unknownWatcher(world, state, 'jun', P(4, 4))).toMatchObject({ by: 'npc', observer: 'enforcer', from: P(8, 4) });
    });

    it('puts nobody on known furniture, anyone anywhere hidden, and a camera only where the player can\'t see the layout', () => {
        // From (4, 4) in Public: (8, 4) is 4 away, within an NPC's reach (8) and a camera's (7); (4, 11) is 7 away,
        // (11, 7) 7.6, (11, 8) 8.1, all in the staff room the blueprint outlines; (2, 4) is 2 away, on the blueprint.
        const at = (spec: Parameters<typeof staged>[0]) => {
            const { world, state } = staged(spec);
            watchersAgree(world, state, 'jun', P(4, 4));
            return { risk: isUnknownRisk(world, state, P(4, 4)), w: unknownWatcher(world, state, 'jun', P(4, 4)), all: unknownWatchers(world, state, 'jun', P(4, 4)) };
        };
        // A stale floor tile: an NPC could stand there, a camera can't hang there (the crew saw the tile: no camera).
        expect(at({ stale: [P(8, 4)] }).w).toMatchObject({ by: 'npc', from: P(8, 4) });
        expect(at({ stale: [P(8, 4)] }).all.map(a => a.by)).toEqual(['npc']);
        // A stale desk: nobody stands on it, and its neighbours aren't hatched for it.
        expect(at({ stale: [P(8, 4)], furniture: [P(8, 4)] })).toEqual({ risk: false, w: null, all: [] });
        const { world, state } = staged({ stale: [P(8, 4)], furniture: [P(8, 4)] });
        for (const p of [P(7, 4), P(8, 5), P(9, 3)]) expect(floorKnowledge(world, state, p, { crew: 'jun' }), `(${p.x}, ${p.y})`).toBe('scouted');
        // A desk never seen in the outlined room isn't known: someone could stand there (judged before a camera, which
        // could hang there too: mounted, so furniture doesn't stop one).
        expect(at({ unseen: [P(8, 4)], furniture: [P(8, 4)] }).w).toMatchObject({ by: 'npc', from: P(8, 4) });
        // A desk never seen on the blueprint's public floor: a camera there would be in plain view, nobody stands on it.
        expect(at({ unseen: [P(2, 4)], furniture: [P(2, 4)] })).toEqual({ risk: false, w: null, all: [] });
        // ...but an NPC could stand on an unseen floor tile there.
        expect(at({ unseen: [P(2, 4)] }).w).toMatchObject({ by: 'npc', from: P(2, 4) });
        // Each kind has its own reach: an NPC's 8 reaches (4, 11) and (11, 7), a camera's 7 only (4, 11); 8.1 is past both.
        expect(at({ unseen: [P(4, 11)], furniture: [P(4, 11)] }).w).toMatchObject({ by: 'npc', from: P(4, 11) });
        expect(at({ unseen: [P(11, 8)] }).risk).toBe(false);
        expect(at({ stale: [P(11, 7)] }).w).toMatchObject({ by: 'npc', from: P(11, 7) });
        expect(at({ unseen: [P(11, 7)], furniture: [P(11, 7)] }).w).toMatchObject({ by: 'npc', from: P(11, 7) });
        expect(at({ stale: [P(11, 7)], furniture: [P(11, 7)] }).w).toBeNull();
    });

    it('knows a camera on the blueprint\'s layout from the start, and one in an outlined room once seen', () => {
        // jun sees x 0..4 (a wall after 4); 5..9 is public, on the blueprint; 10 on a staff room behind a second wall.
        const wall = (x: number) => [0, 1, 2].map(y => ({ between: [P(x, y), P(x + 1, y)] as [Pos, Pos] }));
        const world = fixtureWorld(['.'.repeat(16), '.'.repeat(16), '.'.repeat(16)], {
            walls: [...wall(4), ...wall(9)], zones: Array(3).fill('.'.repeat(10) + 's'.repeat(6)), rooms: Array(3).fill('.'.repeat(10) + 'a'.repeat(6)),
            cameras: [{ id: 'public', pos: P(7, 1), facings: ['w'], room: null }, { id: 'staff', pos: P(12, 1), facings: ['w'], room: 'a' }]
        });
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 1) }] });
        expect(seenAt(world, state, P(7, 1))).toBe(false);
        expect(state.knowledge.cameras).toEqual(['public']);
        // Its feed status unknown, it counts as live in every preview; the unseen one isn't there for them.
        const picture = previewPicture(world, state);
        expect(picture.cameras['public']!.live).toBe(true);
        expect(picture.cameras['staff']!.live).toBe(false);
        expect(knownView(world, state).cameras.map(c => [c.id, c.status])).toEqual([['public', 'unknown']]);
        // A heist saved before layout cameras were known from the start resumes knowing them, the staff one still not.
        const old = patch(state, s => { s.knowledge.cameras = []; });
        expect(withLayoutCameras(world, old).knowledge.cameras).toEqual(['public']);
        expect(withLayoutCameras(world, state)).toBe(state);
    });

    it('agrees with the worst on fixture worlds', () => {
        let found = 0;
        for (const start of [{}, { items: ['pistol'] }, { items: ['assaultRifle'] }, { notoriety: 2 }, { uniform: 'staff' }]) {
            const world = fixtureWorld(['.'.repeat(40), '.'.repeat(40)], { zones: ['.'.repeat(40), '.....sss' + '.'.repeat(32)], dark: [P(9, 1)] });
            const state = patch(initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0), items: start.items ?? [] }] }), x => {
                x.crew[0]!.notoriety = start.notoriety ?? 0;
                if (start.uniform) x.crew[0]!.loadout.uniform = start.uniform as never;
            });
            for (let y = 0; y < 2; y++) for (let x = 0; x < 40; x++) for (const step of [false, true]) found += watchersAgree(world, state, 'jun', P(x, y), { step });
        }
        expect(found).toBeGreaterThan(0);
    });

    it.each([
        { tier: 'city' as const, archetype: 'atrium' as const, layout: 2000, population: 1 },
        { tier: 'small' as const, archetype: 'twoWing' as const, layout: 2000, population: 1 }
    ])('agrees with the worst on a generated bank, through a played turn ($tier)', bank => {
        let { world, state } = generatedHeist(bank, 2);
        let found = 0;
        for (let turn = 0; turn < 2; turn++) {
            for (const c of state.crew) {
                const reach = reachable(world, crewPicture(world, state), c.pos, 10, { mover: c.id });
                for (const t of reach.tiles) for (const step of [false, true]) found += watchersAgree(world, state, c.id, t.pos, { step });
                const to = reach.tiles.filter(t => t.canEnd).sort((a, b) => a.pos.y - b.pos.y || a.cost - b.cost)[0];
                const path = to && pathTo(reach, to.pos);
                if (path?.length) state = commit(world, state, { type: 'move', crew: c.id, path }).state;
            }
            state = commit(world, state, { type: 'endTurn' }).state;
        }
        expect(found).toBeGreaterThan(0);
    });

    it('names every watcher of a hatched tile in its explanation, the worst first', () => {
        const world = fixtureWorld(['.'.repeat(40)]);
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0), items: ['assaultRifle'] }] });
        const lines = explain(world, state, 'jun', P(7, 0));
        expect(lines[0]!.watchers).toEqual([{ from: P(14, 0), to: P(7, 0) }, { from: P(15, 0), to: P(7, 0) }]);
        // The way there passes tiles an unseen guard could also see: their watchers, each with the tile it would see.
        const way = lines[1]!.watchers!;
        expect(way.length).toBeGreaterThan(0);
        expect(way[0]!.from).toEqual(unknownWatcher(world, state, 'jun', lines[1]!.to, { step: true })!.from);
        expect(way.every(w => w.to.x < 7 && w.from.x >= 14)).toBe(true);
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

describe('nothing shown comes from what stands on a hidden tile (decision 44)', () => {
    // Staff rooms a|b (x 0..9) behind a wall from a public hall; jun stands at (3, 1) in room a, room b behind the
    // closed door d hidden; a desk at (7, 1) in room b, or not.
    const rooms = (desk: boolean): { world: ReadonlyWorld; state: State } => {
        const walls: FixtureOptions['walls'] = [0, 1, 2].flatMap(y => [
            { between: [P(9, y), P(10, y)] as [Pos, Pos] },
            { between: [P(4, y), P(5, y)] as [Pos, Pos], ...(y === 1 ? { door: { id: 'd', start: 'closed' as const } } : {}) }
        ]);
        const row = (y: number) => (desk && y === 1 ? 'sssssss#ss' : 'ssssssssss') + '.'.repeat(20);
        const zone = 's'.repeat(10) + '.'.repeat(20);
        const world = fixtureWorld([row(0), row(1), row(2)], { walls, zones: [zone, zone, zone], rooms: Array.from({ length: 3 }, () => 'aaaaabbbbb' + '.'.repeat(20)) });
        const start = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(29, 1) }] });
        return { world, state: patch(start, s => { s.crew[0]!.pos = P(3, 1); }) };
    };

    it('plans no move into hidden tiles, so the safe floor never outlines their furniture', () => {
        const shapes = [false, true].map(desk => {
            const { world, state } = rooms(desk);
            expect(tileVisibility(world, state, P(7, 1))).toBe('hidden');
            const tiles = floorTiles(safeFloor(world, state, 'jun'));
            expect(tiles.filter(t => tileVisibility(world, state, t.pos) === 'hidden')).toEqual([]);
            expect(pathTo(reachable(world, crewPicture(world, state), P(3, 1), 40, planMoveOptions(world, state, state.crew[0]!)), P(6, 1))).toBeUndefined();
            return tiles.map(t => `${t.pos.x},${t.pos.y}`).sort().join(' ');
        });
        expect(shapes[1]).toBe(shapes[0]);
    });

    // A public hall (x 0..9) seen by jun, a closed doorway at (9, 1)|(10, 1) never seen into a hidden staff room
    // (x 10..19); a desk at (12, 1), or not. The hall's last column is stale, so the door can't be vouched for.
    const hall = (desk: boolean): { world: ReadonlyWorld; state: State } => {
        const walls: FixtureOptions['walls'] = [0, 1, 2].map(y => ({ between: [P(9, y), P(10, y)] as [Pos, Pos], ...(y === 1 ? { door: { id: 'd', start: 'closed' as const } } : {}) }));
        const row = (y: number) => '.'.repeat(10) + (desk && y === 1 ? 'ss#sssssss' : 'ssssssssss');
        const zone = 's'.repeat(20);
        const world = fixtureWorld([row(0), row(1), row(2)], { walls, zones: [zone, zone, zone], rooms: Array.from({ length: 3 }, () => '.'.repeat(10) + 'b'.repeat(10)) });
        const start = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 1) }] });
        return {
            world, state: patch(start, s => {
                const f = decodeBits(s.knowledge.fresh, world.width * world.height);
                for (const y of [0, 1, 2]) f[y * world.width + 9] = 0;
                s.knowledge.fresh = encodeBits(f);
            })
        };
    };

    it('puts unknown observers anywhere on a hidden tile and sees across what stands there', () => {
        const found = [false, true].map(desk => {
            const { world, state } = hall(desk);
            expect(tileVisibility(world, state, P(12, 1))).toBe('hidden');
            expect(doorDoubt(world, state)?.doors.has('d')).toBe(true);
            watchersAgree(world, state, 'jun', P(8, 1));
            return [P(8, 1), P(8, 0)].map(p => unknownWatchers(world, state, 'jun', p).map(w => `${w.from.x},${w.from.y}`).sort().join(' '));
        });
        expect(found[1]).toEqual(found[0]);
        // The desk's own tile is among them: nobody knows it is there.
        expect(found[1]![0]!.split(' ')).toContain('12,1');
    });
});

describe('who a noise sends to look', () => {
    it('marks sent the one NPC the commit sends, whoever is already investigating', () => {
        // Guard a is sent by jun's dash; mara's dash is heard by a and by b, nearer: b is sent, a goes back to looking.
        const guard = (id: string, pos: Pos): PersonDef => clerk(pos, {
            id, role: 'guard', observer: 'enforcer', facing: 's', schedule: [{ from: 1, activity: 'post', label: 'post', room: '', at: pos, facing: 's' }]
        });
        const world = fixtureWorld(Array.from({ length: 3 }, () => '.'.repeat(30)), { people: [guard('a', P(12, 0)), guard('b', P(15, 1))] });
        const start = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(8, 0) }, { id: 'mara', pos: P(16, 2) }] });
        const state = step(world, start, { type: 'dash', crew: 'jun', path: [P(9, 0), P(10, 0), P(11, 0)] }).state;
        expect(state.npcs.find(n => n.id === 'a')!.status).toBe('investigating');
        const dash: Command = { type: 'dash', crew: 'mara', path: [P(15, 2), P(14, 2), P(13, 2)] };
        const shown = actionPreview(world, state, dash);
        if (!shown.ok) throw new Error(shown.reason);
        expect(shown.noises.map(n => n.ears)).toEqual([[{ npc: 'a', status: 'curious', sent: false }, { npc: 'b', status: 'investigating', sent: true }]]);
        const after = step(world, state, dash).state;
        expect(after.npcs.map(n => [n.id, n.status, n.goal.kind])).toEqual([['a', 'curious', 'look'], ['b', 'investigating', 'inspect']]);
    });
});
