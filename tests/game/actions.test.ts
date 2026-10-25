import { describe, expect, it } from 'vitest';
import { actionMenu, menuIsLegal, targetsOf } from '../../src/game/actions';
import { moveRange } from '../../src/game/movement';
import type { UiState } from '../../src/game/session';
import { actionsView, barkText, confirmView, crewCards, describeEvent, doorName } from '../../src/game/views';
import {
    commit, crewPicture, dashRefusal, fixtureWorld, initialState, preview, type Facing, type ObserverClass, type PersonDef, type Pos, type ReadonlyWorld, type SimEvent, type State,
    type WorldObject
} from '../../src/sim';
import { scouted } from '../sim/helpers';

const P = (x: number, y: number): Pos => ({ x, y });
const person = (id: string, role: string, observer: ObserverClass, pos: Pos, facing: Facing): PersonDef => ({ id, name: id, role, observer, pos, facing, schedule: [] });

/** Jun beside a door (east of him) and the clerk (north of him), a dumpster south. */
function scene(): { world: ReadonlyWorld; state: State } {
    const dumpster: WorldObject = { id: 'dumpster-0', kind: 'dumpster', pos: P(4, 5), facing: 's' };
    const map = Array.from({ length: 8 }, (_, y) => (y === 5 ? '....#.......' : '............'));
    const world = fixtureWorld(map, {
        people: [person('clerk', 'clerk', 'staff', P(4, 3), 'n')],
        objects: [dumpster],
        walls: [{ between: [P(4, 4), P(5, 4)], door: { id: 'd', lock: 'mechanical', start: 'closed' } }]
    });
    return { world, state: scouted(world, initialState(world, { seed: 7, crew: [{ id: 'jun', pos: P(4, 4) }] })) };
}

const ids = (world: ReadonlyWorld, state: State, target?: string) => actionMenu(world, state, 'jun', target).map(e => `${e.id}${e.reason ? '!' : ''}`);

describe('the action grid', () => {
    it('offers Zip-tie and Lead on someone face down (M2-03)', () => {
        const { world, state } = scene();
        const down = commit(world, state, { type: 'command', crew: 'jun' }).state;
        // Loud now: Strike joins, after Hold (M3-02).
        expect(ids(world, down)).toEqual(['door:open', 'door:lock', 'knockout!', 'zipTie', 'escort', 'wait', 'command', 'hold', 'strike', 'mask']);
        expect(menuIsLegal(world, down, 'jun', actionMenu(world, down, 'jun'))).toBe(true);
        const tied = commit(world, down, actionMenu(world, down, 'jun').find(e => e.id === 'zipTie')!.command);
        expect(tied.state.npcs[0]!.status).toBe('tied');
        expect(describeEvent(world, tied.state, { type: 'zipTied', crew: 'jun', npc: 'clerk' })).toBe('jun zip-tied clerk');
    });

    it('offers the combat actions the sim allows, after the takeover in stealth and after Command and Hold once loud (M3-02)', () => {
        const map = Array.from({ length: 6 }, () => '..........');
        const world = fixtureWorld(map, { people: [person('guard', 'lobbyGuard', 'enforcer', P(6, 2), 'w'), person('cust', 'customer', 'civilian', P(8, 4), 'w')] });
        const state = scouted(world, initialState(world, { seed: 7, crew: [{ id: 'jun', pos: P(2, 2), items: ['pistol', 'taser', 'flashbang'] }] }));
        expect(ids(world, state)).toEqual(['wait', 'command', 'mask', 'go', 'attack', 'swap']);
        const loud = { ...state, bank: { loud: true, alarm: false } };
        loud.crew = state.crew.map(c => ({ ...c, arms: { ...c.arms, guns: { ...c.arms.guns, pistol: { ...c.arms.guns.pistol!, loaded: 4 } } } }));
        expect(ids(world, loud, 'cust')).toEqual(['wait', 'command', 'attack', 'reload', 'swap', 'watch', 'throw:flashbang', 'mask']);
        const menu = actionMenu(world, loud, 'jun', 'cust');
        expect(menu.find(e => e.id === 'attack')).toMatchObject({ label: 'Fire (4)', target: 'cust', command: { type: 'attack', crew: 'jun', at: P(8, 4), target: 'cust' } });
        expect(menuIsLegal(world, loud, 'jun', menu)).toBe(true);
        const ui: UiState = { selected: 'jun', camera: null, pendingCommand: null };
        expect(actionsView(world, loud, ui).find(a => a.id === 'swap')).toMatchObject({ cost: 0, enabled: true });
        expect(describeEvent(world, loud, { type: 'attacked', crew: 'jun', weapon: 'pistol', bullets: 2, at: P(6, 2), target: 'guard', mode: 'attack' })).toBe('jun fired at guard');
    });

    it('offers what the sim allows where the crew member stands, for the tapped target', () => {
        const { world, state } = scene();
        expect(targetsOf(world, state, 'jun')).toEqual({ doors: ['d'], npcs: ['clerk'], objects: ['dumpster-0'], cameras: [], loot: [] });
        expect(ids(world, state)).toEqual(['door:open', 'door:lock', 'knockout', 'wait', 'command', 'mask', 'go']);
        expect(menuIsLegal(world, state, 'jun', actionMenu(world, state, 'jun'))).toBe(true);
        // Locked: Unlock shows, refused with the sim's own reason.
        const locked = commit(world, state, { type: 'door', crew: 'jun', door: 'd', action: 'lock' }).state;
        const menu = actionMenu(world, locked, 'jun');
        expect(menu.find(e => e.id === 'door:unlock')?.reason).toMatch(/no key/);
        expect(menu.find(e => e.id === 'door:open')?.reason).toMatch(/locked/);
    });

    it('takes a bag, throws it to a teammate in range, who passes it on (M2-04)', () => {
        const bag: WorldObject = { id: 'loot-0', kind: 'loot', pos: P(2, 1), facing: 's', name: 'Cash bag', loot: { value: 40000, weight: 'heavy' } };
        const cash: WorldObject = { id: 'loot-1', kind: 'loot', pos: P(1, 2), facing: 's', name: 'Cash drawer', loot: { value: 5000, weight: 'light' } };
        const world = fixtureWorld(Array.from({ length: 6 }, () => '........'), { objects: [bag, cash] });
        let s = scouted(world, initialState(world, { seed: 7, crew: [{ id: 'jun', pos: P(2, 2) }, { id: 'mara', pos: P(4, 2) }, { id: 'dex', pos: P(5, 2) }] }));
        expect(targetsOf(world, s, 'jun').loot).toEqual(['loot-0', 'loot-1']);
        expect(actionMenu(world, s, 'jun', 'loot-1').find(e => e.id === 'take')).toMatchObject({ label: 'Take cash', command: { type: 'takeLoot', crew: 'jun', loot: 'loot-1' } });
        s = commit(world, s, actionMenu(world, s, 'jun').find(e => e.id === 'take')!.command).state;
        expect(crewCards(world, s, 'jun')[0]!.carrying).toBe('loot');
        const menu = actionMenu(world, s, 'jun');
        expect(menuIsLegal(world, s, 'jun', menu)).toBe(true);
        expect(menu.map(e => e.id)).toEqual(expect.arrayContaining(['putDown', 'throw']));
        const thrown = menu.find(e => e.id === 'throw')!;
        expect(thrown).toMatchObject({ label: 'Throw to mara', command: { type: 'throwLoot', crew: 'jun', to: P(4, 2) } });
        s = commit(world, s, thrown.command).state;
        expect(s.loot['loot-0']!.holder).toBe('mara');
        const pass = actionMenu(world, s, 'mara').find(e => e.id === 'pass')!;
        expect(pass).toMatchObject({ label: 'Pass to dex', command: { type: 'pass', crew: 'mara', to: 'dex' } });
        expect(describeEvent(world, s, { type: 'lootThrown', crew: 'jun', loot: 'loot-0', from: P(2, 2), to: P(4, 2), caughtBy: 'mara' })).toBe('jun threw the bag to mara');
    });

    it('knocks out, then drags (half reach, no dash band) and stashes in the dumpster', () => {
        const { world, state } = scene();
        let s = commit(world, state, { type: 'knockout', crew: 'jun', npc: 'clerk' }).state;
        expect(ids(world, s, 'clerk')).toContain('drag');
        expect(crewCards(world, s, 'jun')[0]!.profile).toBe('clean');
        s = commit(world, s, { type: 'drag', crew: 'jun', npc: 'clerk' }).state;
        // Dragging a body reads Armed on the crew card (§7.4), the moment it starts.
        expect(crewCards(world, s, 'jun')[0]!.profile).toBe('armed');
        s = commit(world, s, { type: 'endTurn' }).state;
        expect(ids(world, s)).toEqual(['door:open', 'door:lock', 'drop', 'stash', 'wait', 'command', 'mask', 'go']);
        const jun = s.crew[0]!, range = moveRange(world, crewPicture(world, s), jun, dashRefusal(world, s, 'jun') === null);
        expect(range.dash).toBeNull();
        expect(range.run).toEqual([]);
        // Half of Move's 10 half-steps: the reach the commit allows.
        expect(range.move).toBe(5);
        expect(range.walk.every(p => Math.max(Math.abs(p.x - jun.pos.x), Math.abs(p.y - jun.pos.y)) <= 2)).toBe(true);
        const stash = actionMenu(world, s, 'jun').find(e => e.id === 'stash')!;
        expect(stash.command).toEqual({ type: 'stash', crew: 'jun', at: 'dumpster-0' });
        const done = commit(world, s, stash.command);
        expect(done.state.npcs[0]!.stashed).toBe('dumpster-0');
        expect(describeEvent(world, done.state, done.events.find(e => e.type === 'bodyStashed')!)).toBe('jun hid clerk in the dumpster');
    });

    it('tells a door cut by the status found then, not as the door stands now', () => {
        const { world, state } = scene();
        const cut: SimEvent = { type: 'moveCut', crew: 'jun', reason: 'door', door: 'd', status: 'locked', at: P(4, 4), planned: [P(5, 4)] };
        // The door has since been opened: the line still says what jun found.
        const now = { ...state, doors: { ...state.doors, d: { status: 'open' as const } } };
        expect(describeEvent(world, now, cut)).toBe(`jun found ${doorName(world, 'd')} locked and stopped at (4, 4)`);
    });

    it('costs each entry from its preview, and Confirm warns of an illegal act', () => {
        const { world, state } = scene();
        const ui: UiState = { selected: 'jun', camera: null, pendingCommand: { type: 'knockout', crew: 'jun', npc: 'clerk' } };
        const costOf = (cmd: Parameters<typeof preview>[2]) => {
            try { return 2 - preview(world, state, cmd).state.crew[0]!.actionsLeft; } catch { return undefined; }
        };
        const grid = actionsView(world, state, ui, { costOf });
        expect(grid.find(a => a.id === 'knockout')).toMatchObject({ cost: 1, enabled: true, selected: true });
        expect(grid.find(a => a.id === 'move')).toMatchObject({ selected: false });
        const events = preview(world, state, ui.pendingCommand!).events;
        expect(confirmView(ui, events, costOf)).toMatchObject({ label: 'KNOCKOUT', kind: 'costly', cost: 1 });
    });

    it('names doors by the room they guard, and barks name the evidence the first time', () => {
        const { world, state } = scene();
        expect(doorName(world, 'd')).toMatch(/door$/);
        expect(barkText(world, state, { type: 'bark', npc: 'clerk', cause: 'body', evidence: 'body:x', first: true })).toMatch(/down/);
        expect(barkText(world, state, { type: 'bark', npc: 'clerk', cause: 'body', evidence: 'body:x', first: false })).toBe('Hey! Over here!');
    });
});
