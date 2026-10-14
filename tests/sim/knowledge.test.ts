import { describe, expect, it } from 'vitest';
import { generateBank } from '../../src/gen/generate';
import {
    cameraObserver, clonePlain, commit, crewPicture, decodeBits, deserialise, encodeBits, fieldOn, fixtureWorld, floorKnowledge, freezeWorld,
    hashOf, initialState, isUnknownRisk, pathTo, knownBlockers, knownView, makeNoise, markerKind, npcObserver, preview, projectEvents, reachable,
    serialise, sightMap, tileAt, updateKnowledge, worldFromBank, type Command, type FixtureOptions, type PersonDef, type Pos, type ReadonlyWorld,
    type SimEvent, type State, type World
} from '../../src/sim';
import { registerTestCommand, step } from './helpers';

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
        expect(knownView(world, through.state).cameras).toEqual([{ id: 'cam', pos: P(7, 0), facings: ['s'], status: 'live' }]);
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
        // Out of sight before 3 turns: a ghost, not a prediction.
        expect(markerKind(world, step(world, away(t2.state), { type: 'wait', crew: 'jun' }).state, 'clerk')).toBe('ghost');
        const t3 = step(world, t2.state, { type: 'endTurn' });
        expect(revealed(t3.events)).toContain('routine clerk');
        expect(t3.state.knowledge.npcs.clerk).toMatchObject({ watched: 3, routine: true });
        const gone = step(world, away(t3.state), { type: 'wait', crew: 'jun' });
        // The far end of the corridor is new; the clerk going out of view tells nothing.
        expect(revealed(gone.events)).toEqual(['tiles 11']);
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
        const out = step(world, away(tagged), { type: 'wait', crew: 'jun' }).state;
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
        expect(markerKind(world, step(world, away(state), { type: 'wait', crew: 'jun' }).state, 'clerk')).toBe(null);
    });

    it('reveals an NPC that comes into view, even one only passed on the way', () => {
        // The clerk stands in an alcove off the corridor, seen only from the tiles in front of it.
        const world = fixtureWorld(['.........', 'TTTT.TTTT', 'TTTT.TTTT'], { people: [clerk(P(4, 2), { facing: 'n' })] });
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }] });
        expect(markerKind(world, state, 'clerk')).toBe(null);
        const moved = step(world, state, { type: 'move', crew: 'jun', path: [P(1, 0), P(2, 0), P(3, 0), P(4, 0), P(5, 0)] });
        expect(revealed(moved.events)).toContain('npc clerk');
        expect(moved.undoable).toBe(false);
        // A crew member at (8, 0) can't see into the alcove; it was seen on the way, so it is a ghost now.
        const on = step(world, patch(moved.state, s => { s.crew[0]!.actionsLeft = 2; }), { type: 'move', crew: 'jun', path: [P(6, 0), P(7, 0), P(8, 0)] }).state;
        expect(knownView(world, on).npcs).toEqual([expect.objectContaining({ id: 'clerk', kind: 'ghost', pos: P(4, 2) })]);
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

describe('unknown risk', () => {
    it('is never safe where an unseen NPC could watch: every seen tile an NPC in unscouted space sees is hatched grey', () => {
        let checked = 0;
        for (const bankSpec of [
            { tier: 'small' as const, archetype: 'twoWing' as const, layout: 2000, population: 1 },
            { tier: 'city' as const, archetype: 'atrium' as const, layout: 2000, population: 1 }
        ]) {
            const { world, state } = generatedHeist(bankSpec, 2);
            const sight = sightMap(world, state);
            const observers = [
                ...state.npcs.flatMap(n => (seenAt(world, state, n.pos) ? [] : [npcObserver(world, { ...n, alerted: true })])),
                ...world.cameras.flatMap(c => (seenAt(world, state, c.pos) ? [] : [cameraObserver(world, state, c.id)]))
            ];
            for (const o of observers) {
                if (!o) continue;
                for (const t of fieldOn(sight, o).tiles) {
                    const k = floorKnowledge(world, state, t);
                    expect(k, `(${t.x}, ${t.y}) seen by an unknown observer at (${o.pos.x}, ${o.pos.y})`).not.toBe('scouted');
                    checked++;
                }
            }
            // Grey is never anything but grey.
            for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
                if (!seenAt(world, state, P(x, y))) expect(isUnknownRisk(world, state, P(x, y))).toBe(false);
            }
        }
        expect(checked).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------------------------------------- Generated banks

function generatedHeist(spec: { tier: 'small' | 'city' | 'hq'; archetype: Parameters<typeof generateBank>[0]['archetype']; layout: number; population: number }, crewCount: number): { world: ReadonlyWorld; state: State } {
    const bank = generateBank({ ...spec, plot: 'midBlock' });
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

    it('updates in under 2 ms after a move with 4 crew', () => {
        const { world, state } = generatedHeist(spec, 4);
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
        console.log(`one fresh crew field ${fieldMs.toFixed(3)} ms; knowledge update over ${samples.length} moves: mean ${mean.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms; whole ${route.length}-tile move commit ${moveMs.toFixed(2)} ms (${move.events.length} events)`);
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
