import { describe, expect, it } from 'vitest';
import { actionMenu, menuIsLegal, targetsOf } from '../../src/game/actions';
import { moveRange } from '../../src/game/movement';
import type { UiState } from '../../src/game/session';
import { actionsView, barkText, confirmView, describeEvent, doorName } from '../../src/game/views';
import {
    commit, crewPicture, dashRefusal, fixtureWorld, initialState, preview, type Facing, type ObserverClass, type PersonDef, type Pos, type ReadonlyWorld, type State,
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
    it('offers what the sim allows where the crew member stands, for the tapped target', () => {
        const { world, state } = scene();
        expect(targetsOf(world, state, 'jun')).toEqual({ doors: ['d'], npcs: ['clerk'], objects: ['dumpster-0'], cameras: [] });
        expect(ids(world, state)).toEqual(['door:open', 'door:lock', 'knockout', 'wait']);
        expect(menuIsLegal(world, state, 'jun', actionMenu(world, state, 'jun'))).toBe(true);
        // Locked: Unlock shows, refused with the sim's own reason.
        const locked = commit(world, state, { type: 'door', crew: 'jun', door: 'd', action: 'lock' }).state;
        const menu = actionMenu(world, locked, 'jun');
        expect(menu.find(e => e.id === 'door:unlock')?.reason).toMatch(/no key/);
        expect(menu.find(e => e.id === 'door:open')?.reason).toMatch(/locked/);
    });

    it('knocks out, then drags (half reach, no dash band) and stashes in the dumpster', () => {
        const { world, state } = scene();
        let s = commit(world, state, { type: 'knockout', crew: 'jun', npc: 'clerk' }).state;
        expect(ids(world, s, 'clerk')).toContain('drag');
        s = commit(world, s, { type: 'drag', crew: 'jun', npc: 'clerk' }).state;
        s = commit(world, s, { type: 'endTurn' }).state;
        expect(ids(world, s)).toEqual(['door:open', 'door:lock', 'drop', 'stash', 'wait']);
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
