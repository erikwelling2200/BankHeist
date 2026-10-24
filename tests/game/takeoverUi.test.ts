import { describe, expect, it } from 'vitest';
import type { UiState } from '../../src/game/session';
import { hudView, takeoverAtHand, threatLedger } from '../../src/game/views';
import { commandRings, holdRings, intentPlate, npcBadges } from '../../src/game/worldUi';
import { clonePlain, commandPlan, commandPreview, commit, doorDoubt, fixtureWorld, freezeWorld, holdPreview, holdTargets, initialState, knownView, preview, type Command, type FixtureOptions, type World, type Facing, type ObserverClass, type PersonDef, type Pos, type State } from '../../src/sim';
import { scouted } from '../sim/helpers';

/*
 * The M2 interface's view models (M2-06): the GO rail, the command's rings and outcomes, holds, lapses, the drill in the
 * ledger, loot. Everything shown comes from the rules' own readings, and only for NPCs the crew knows of.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const person = (id: string, pos: Pos, facing: Facing, observer: ObserverClass = 'civilian', role = 'customer'): PersonDef => ({ id, name: id, role, observer, pos, facing, schedule: [] });

function scene(change: (s: State) => void = () => {}) {
    const world = fixtureWorld(Array.from({ length: 9 }, () => '............'), {
        people: [person('ann', P(5, 1), 's'), person('bob', P(8, 3), 'w', 'enforcer', 'lobbyGuard'), person('cy', P(11, 8), 'n')]
    });
    const state = clonePlain(scouted(world, initialState(world, { seed: 3, crew: [{ id: 'jun', pos: P(5, 3), items: ['assaultRifle'] }] })));
    // The crew sees Ann and Bob; Cy it doesn't know.
    for (const n of state.npcs.filter(n => n.id !== 'cy')) {
        state.knowledge.npcs[n.id] = { at: { ...n.pos }, facing: n.facing, turn: state.turn, live: true, routine: false, rota: false, watched: 1, watchedTurn: state.turn, tick: state.knowledge.phaseTick + 1 };
    }
    delete state.knowledge.npcs.cy;
    change(state);
    return { world, state };
}

const ui = (pendingCommand: Command | null): UiState => ({ selected: 'jun', camera: null, pendingCommand });

describe('GO and the command rings', () => {
    it('GO previewed turns the rail gold with the crew as GO leaves them, before anything is committed', () => {
        const { world, state } = scene(), go = { type: 'go' as const, crew: 'jun' };
        const vm = hudView(world, state, ui(go), { goPreview: preview(world, state, go).state });
        expect(vm.goRail).toBe('preview');
        expect(vm.bank.go).toBe(true);
        expect(vm.crew[0]).toMatchObject({ actionsLeft: 3, actionsMax: 3, portrait: 'jun-m' });
        expect(vm.confirm).toMatchObject({ kind: 'go', label: 'GO', cost: 0 });
        // A rifle with people round it: the takeover is at hand, and GO heads the grid, wide and gold (decision 84).
        expect(vm.actions[0]).toMatchObject({ id: 'go', go: true, wide: true, selected: true });
        // Unarmed, it keeps its place at the end, gold but narrow, dropped first from a full grid.
        const unarmed = clonePlain(state);
        unarmed.crew[0]!.loadout.items = [];
        expect(hudView(world, unarmed, ui(null)).actions.at(-1)).toMatchObject({ id: 'go', go: true });
        expect(hudView(world, unarmed, ui(null)).actions.at(-1)!.wide).toBeUndefined();
        expect(state.takeover).toBeNull();
        const after = commit(world, state, go).state;
        expect(hudView(world, after, ui(null)).goRail).toBe('on');
    });

    it('brings GO up wide only with a weapon in hand and someone in sight who could still be put face down (decision 84)', () => {
        // The rifle, Ann 2 tiles off and Bob 3: at hand.
        expect(takeoverAtHand(...Object.values(scene()) as [World, State])).toBe(true);
        // Unarmed (Threat 1, a radius of 1 on the takeover turn), with Ann right beside Jun: no weapon, no takeover.
        const beside = scene(s => {
            s.crew[0]!.loadout.items = [];
            s.npcs.find(n => n.id === 'ann')!.pos = P(5, 2);
            s.knowledge.npcs.ann!.at = P(5, 2);
        });
        expect(takeoverAtHand(beside.world, beside.state)).toBe(false);
        // Everyone known already face down, tied or out cold: nobody left to take over.
        for (const status of ['commanded', 'tied', 'unconscious'] as const) {
            const down = scene(s => {
                for (const n of s.npcs) Object.assign(n, { status, ...(status === 'commanded' ? { command: { pips: 2, by: 'jun' } } : {}) });
            });
            expect(takeoverAtHand(down.world, down.state), status).toBe(false);
        }
        // Ann behind a wall, in the radius but out of sight (Bob gone): not at hand either.
        const walls: FixtureOptions['walls'] = Array.from({ length: 12 }, (_, x) => ({ between: [P(x, 1), P(x, 2)] as [Pos, Pos] }));
        const world = fixtureWorld(Array.from({ length: 9 }, () => '............'), { walls, people: [person('ann', P(5, 1), 's')] });
        const state = clonePlain(scouted(world, initialState(world, { seed: 3, crew: [{ id: 'jun', pos: P(5, 3), items: ['assaultRifle'] }] })));
        state.knowledge.npcs.ann = { at: P(5, 1), facing: 's', turn: state.turn, live: true, routine: false, rota: false, watched: 1, watchedTurn: state.turn, tick: state.knowledge.phaseTick + 1 };
        expect(takeoverAtHand(world, state)).toBe(false);
        state.crew[0]!.pos = P(5, 2);
        expect(takeoverAtHand(world, clonePlain(state))).toBe(false);
    });

    it('the shout shows both rings, an outcome over each known NPC and the resister\'s chance, in steel blue', () => {
        const { world, state } = scene();
        const plan = commandPreview(world, state, 'jun'), view = knownView(world, state);
        const rings = commandRings(world, state, view, plan);
        expect(rings.command.length).toBeGreaterThan(0);
        // Nobody the crew doesn't know.
        expect(rings.outcomes.map(o => o.id).sort()).toEqual(['ann', 'bob']);
        const bob = plan.targets.find(t => t.npc === 'bob')!;
        expect(bob.outcome).toBe('resists');
        expect(rings.outcomes.find(o => o.id === 'bob')!.plate).toEqual({ glyph: 'down', signal: 'amber', count: `${Math.round(bob.chance! * 100)}%` });
        expect(rings.outcomes.find(o => o.id === 'ann')!.plate).toEqual({ glyph: 'down', signal: 'command', count: world.rules.commandPips });
        const vm = hudView(world, state, ui({ type: 'command', crew: 'jun' }), { rings: plan });
        expect(vm.confirm.kind).toBe('command');
        expect(vm.rings).toEqual({ kind: 'command', down: 1, panics: 0, alerted: 0, ignores: 0, unsure: 0, resisters: [{ id: 'bob', name: 'bob', portrait: 'guard', chance: bob.chance }] });
    });

    it('the commands lapse in the ledger, paused while a hold keeps them, and the hold\'s ring stays drawn', () => {
        const { world, state } = scene();
        const down = commit(world, state, { type: 'command', crew: 'jun' }).state;
        const ann = down.npcs.find(n => n.id === 'ann')!;
        expect(ann.status).toBe('commanded');
        expect(threatLedger(down, world).find(t => t.id === 'lapse:jun')).toMatchObject({ kind: 'lapse', countdown: ann.command!.pips, halted: null });
        const held = commit(world, down, { type: 'hold', crew: 'jun' }).state;
        expect(threatLedger(held, world).find(t => t.id === 'lapse:jun')).toMatchObject({ halted: 'paused' });
        const rings = holdRings(world, held, knownView(world, held));
        expect(rings).toHaveLength(1);
        expect(rings[0]!.tiles).toEqual(commandPreview(world, held, 'jun').commandTiles);
    });
});

describe('a door the crew can\'t vouch for (decision 44)', () => {
    // A wall between x 20 and 21 with door d at y 1, open or shut for real; Jun (with a rifle) moved to (16, 1) after the
    // door was last seen, so it is doubted; the guard predicted at (18, 2), a customer the crew saw just past the door.
    const build = (status: 'open' | 'closed') => {
        const walls: FixtureOptions['walls'] = [0, 1, 2].map(y => ({ between: [P(20, y), P(21, y)] as [Pos, Pos], ...(y === 1 ? { door: { id: 'd', start: status } } : {}) }));
        const people: PersonDef[] = [
            { ...person('guard', P(18, 2), 'w', 'enforcer', 'lobbyGuard'), schedule: [{ from: 1, activity: 'post', label: 'post', room: '', at: P(18, 2), facing: 'w' }] },
            { ...person('cus', P(23, 1), 'w'), schedule: [{ from: 1, activity: 'post', label: 'post', room: '', at: P(23, 1), facing: 'w' }] }
        ];
        const world = freezeWorld({ ...(clonePlain(fixtureWorld(Array.from({ length: 3 }, () => '.'.repeat(26)), { walls, people })) as World), intel: { guardRota: true } });
        const state = clonePlain(initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(6, 1), masked: true, items: ['assaultRifle'] }] }));
        state.crew[0]!.pos = P(16, 1);
        return { world, state };
    };

    it('draws the same rings, outcomes and hold whether the door is truly open or shut', () => {
        const open = build('open'), shut = build('closed');
        expect(doorDoubt(open.world, open.state)?.doors.has('d')).toBe(true);
        expect(doorDoubt(shut.world, shut.state)?.doors.has('d')).toBe(true);
        // The truth differs: the shout carries through the open door.
        expect(commandPlan(open.world, open.state, 'jun').panicTiles).not.toEqual(commandPlan(shut.world, shut.state, 'jun').panicTiles);
        const shown = [open, shut].map(({ world, state }) => {
            const plan = commandPreview(world, state, 'jun');
            return { plan, rings: commandRings(world, state, knownView(world, state), plan), hud: hudView(world, state, ui({ type: 'command', crew: 'jun' }), { rings: plan }).rings, hold: holdPreview(world, state, 'jun') };
        });
        expect(shown[0]).toEqual(shown[1]);
    });

    it('marks a hold through it unsure, in the rings and the lapse row, whether it truly keeps them down or not', () => {
        // The customer face down, Jun 4 tiles off on this side of the door and holding the room.
        const shown = (['open', 'closed'] as const).map(status => {
            const { world, state } = build(status);
            state.crew[0]!.pos = P(19, 1);
            state.crew[0]!.holding = state.turn;
            Object.assign(state.npcs.find(n => n.id === 'cus')!, { status: 'commanded', command: { pips: 2, by: 'jun' }, intent: { path: [] } });
            // Put down by Jun and seen face down there.
            state.knowledge.npcs.cus = { at: P(23, 1), facing: 'w', turn: state.turn, live: true, routine: false, rota: false, watched: 1, watchedTurn: state.turn, tick: state.knowledge.phaseTick + 1 };
            const truth = holdTargets(world, state, 'jun');
            return { truth, hold: holdPreview(world, state, 'jun'), hud: hudView(world, state, ui({ type: 'hold', crew: 'jun' }), { rings: holdPreview(world, state, 'jun') }).rings,
                row: threatLedger(state, world).find(t => t.id === 'lapse:jun') };
        });
        // The truth differs (the hold reaches through the open door only), what is shown doesn't: a `?`, never a promise.
        expect(shown.map(s => s.truth)).toEqual([['cus'], []]);
        for (const s of shown) {
            expect(s.hold).toEqual({ held: [], unsure: ['cus'] });
            expect(s.hud).toMatchObject({ kind: 'hold', down: 0, unsure: 1 });
            expect(s.row).toMatchObject({ label: 'Lapses?: 1 face down (jun)', halted: null });
        }
    });
});

describe('lapses, drills and loot', () => {
    it('a known NPC\'s intent shows what its lapse rolled: a red runner, a hand on a gun, a hider', () => {
        expect(intentPlate({ intent: { path: [P(1, 1)], action: { kind: 'flee', exit: P(0, 0) } } })).toEqual({ glyph: 'run', signal: 'red' });
        expect(intentPlate({ intent: { path: [], action: { kind: 'reachForWeapon', crew: 'jun' } } })).toEqual({ glyph: 'hand', signal: 'red', then: 'gun' });
        expect(intentPlate({ intent: { path: [P(1, 1)], action: { kind: 'hide' } } })).toEqual({ glyph: 'run', signal: 'amber', then: 'pin' });
        expect(intentPlate({ intent: { path: [] } })).toBeUndefined();
    });

    it('GO\'s surprise shows as a star over those it caught', () => {
        const { world, state } = scene();
        const after = commit(world, state, { type: 'go', crew: 'jun' }).state;
        const badges = npcBadges(world, after, knownView(world, after));
        expect(badges.find(b => b.id === 'ann')!.plates).toContainEqual({ glyph: 'star', signal: 'cream' });
    });

    it('lists a drill with its work and jam odds, and a jammed one as wanting the crew', () => {
        const { world, state } = scene(s => {
            s.devices = [{ id: 'drill-1', kind: 'drill', at: 'door', pos: P(2, 2), crew: 'jun', done: 3, needed: 8, jammed: false, noise: 6 }];
        });
        expect(threatLedger(state, world).find(t => t.id === 'device:drill-1')).toMatchObject({ kind: 'drill', countdown: 5, label: `Drill 3/8: jams ${Math.round(world.rules.drillJamChance * 100)}%` });
        state.devices[0]!.jammed = true;
        // Jammed: stalled (no countdown runs), and wanting the crew, it sorts with the running clocks.
        expect(threatLedger(state, world).find(t => t.id === 'device:drill-1')).toMatchObject({ label: 'Drill jammed: fix it (3/8)', halted: 'paused', urgent: true });
    });

    it('shows no loot counter until the crew carries some', () => {
        const { world, state } = scene();
        expect(hudView(world, state, ui(null)).loot).toBeNull();
    });
});
