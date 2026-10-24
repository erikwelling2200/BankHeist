import { describe, expect, it } from 'vitest';
import type { UiState } from '../../src/game/session';
import { hudView, threatLedger } from '../../src/game/views';
import { commandRings, holdRings, intentPlate, npcBadges } from '../../src/game/worldUi';
import { clonePlain, commandPreview, commit, fixtureWorld, initialState, knownView, preview, type Command, type Facing, type ObserverClass, type PersonDef, type Pos, type State } from '../../src/sim';
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
        // GO heads the grid, wide and gold.
        expect(vm.actions[0]).toMatchObject({ id: 'go', go: true, selected: true });
        expect(state.takeover).toBeNull();
        const after = commit(world, state, go).state;
        expect(hudView(world, after, ui(null)).goRail).toBe('on');
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
        expect(vm.rings).toEqual({ kind: 'command', down: 1, panics: 0, alerted: 0, ignores: 0, resisters: [{ id: 'bob', name: 'bob', portrait: 'guard', chance: bob.chance }] });
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
            s.devices = [{ id: 'drill-1', kind: 'drill', at: 'door', pos: P(2, 2), crew: 'jun', done: 3, needed: 8, jammed: false }];
        });
        expect(threatLedger(state, world).find(t => t.id === 'device:drill-1')).toMatchObject({ kind: 'drill', countdown: 5, label: `Drill 3/8: jams ${Math.round(world.rules.drillJamChance * 100)}%` });
        state.devices[0]!.jammed = true;
        expect(threatLedger(state, world).find(t => t.id === 'device:drill-1')).toMatchObject({ label: 'Drill jammed (3/8): fix it', urgent: true });
    });

    it('shows no loot counter until the crew carries some', () => {
        const { world, state } = scene();
        expect(hudView(world, state, ui(null)).loot).toBeNull();
    });
});
