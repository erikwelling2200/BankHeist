import { describe, expect, it } from 'vitest';
import { actionMenu } from '../../src/game/actions';
import { newHeist } from '../../src/game/heist';
import { driveView, loudView, negotiatorView, posesCovering } from '../../src/game/loudBoards';
import { bankView } from '../../src/game/views';
import {
    clonePlain, commit, doorTiles, fixtureWorld, footprint, initialState, knownView, newTeam, OFFICER_FLASHBANGS, OFFICER_STATS,
    vehicleReach, type CrewStart, type PoliceKind, type Pos, type ReadonlyWorld, type State
} from '../../src/sim';
import { cachedBank } from '../bankCache';

/* M3-09's loud layer in the game: wedges, grenades, the negotiator's dialog and the driving overlay, told only what the crew knows. */

const P = (x: number, y: number): Pos => ({ x, y });

function loud(map: readonly string[], crew: CrewStart[], mode: 'assault' | 'contain' | 'negotiate' = 'contain'): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(map);
    const s = clonePlain(initialState(world, { seed: 5, crew }));
    for (const c of s.crew) c.loadout.masked = true;
    s.bank.alarm = true;
    s.bank.loud = true;
    s.response = { raised: s.turn - 5, by: 'tellerButton', policeIn: 0, heat: 12 };
    s.police.sent = 5;
    s.police.mode = { kind: mode, left: 9, since: { turn: s.turn - 1, phase: 'world' }, after: null };
    return { world, state: s };
}

function officer(state: State, id: string, pos: Pos, kind: PoliceKind = 'swat'): void {
    state.police.teams.t ??= newTeam();
    state.police.units.push({
        id, kind, vehicle: null, staging: null, arrived: state.turn - 3, pos, hp: OFFICER_STATS[kind].hp, leaning: null, suppressed: null, moved: null,
        team: 't', watch: null, flashbangs: OFFICER_FLASHBANGS[kind], surprised: null
    });
}

const PILLARS = ['...T............', '...T............', '................', '...T............', '...T............'];

describe('wedges and grenades', () => {
    function covered() {
        const { world, state } = loud(PILLARS, [{ id: 'jun', pos: P(1, 0), items: ['pistol'] }]);
        officer(state, 'a', P(10, 2));
        state.police.known.jun = { tile: P(1, 1), turn: 0, down: false };
        return { world, state: commit(world, state, { type: 'endTurn' }).state };
    }

    it('draws a police wedge only while the crew sees its officer', () => {
        const { world, state } = covered();
        expect(state.police.units[0]!.watch).not.toBeNull();
        expect(loudView(world, state, knownView(world, state), null)?.wedges ?? []).toEqual([]);
        const seen = commit(world, state, { type: 'move', crew: 'jun', path: [P(1, 1), P(2, 2)] }).state;
        const vm = loudView(world, seen, knownView(world, seen), null)!;
        expect(vm.wedges).toEqual([{ side: 'police', by: 'a', from: P(10, 2), at: P(1, 1), arc: 45, range: 10 }]);
    });

    it('a crew Watch previewed is a steel-blue preview wedge, and once set a wedge of its own', () => {
        const { world, state } = loud(['................'], [{ id: 'jun', pos: P(1, 0), items: ['pistol'] }]);
        officer(state, 'a', P(8, 0));
        const watch = actionMenu(world, state, 'jun').find(e => e.id === 'watch')!;
        expect(watch.reason).toBeUndefined();
        const vm = loudView(world, state, knownView(world, state), watch.command)!;
        expect(vm.wedges).toMatchObject([{ side: 'crew', by: 'jun', from: P(1, 0), at: P(8, 0), preview: true }]);
        const set = commit(world, state, watch.command).state;
        expect(loudView(world, set, knownView(world, set), null)!.wedges).toMatchObject([{ side: 'crew', by: 'jun', at: P(8, 0) }]);
        expect(loudView(world, set, knownView(world, set), null)!.wedges[0]!.preview).toBeUndefined();
    });

    it('shows a police grenade where the crew sees it land, with its fuse, and not one out of sight', () => {
        const { world, state } = loud(PILLARS, [{ id: 'jun', pos: P(1, 2), items: ['pistol'] }]);
        officer(state, 'a', P(10, 2));
        state.grenades.push({ id: 'g1', kind: 'flashbang', by: 'a', at: P(5, 2), turn: state.turn });
        const s = commit(world, state, { type: 'move', crew: 'jun', path: [P(2, 2)] }).state;
        const vm = loudView(world, s, knownView(world, s), null)!;
        expect(vm.grenades).toEqual([{ at: P(5, 2), kind: 'flashbang', radius: expect.any(Number), police: true, fuse: 1 }]);
        // Behind the pillar from where Jun stands, and not seen this turn: not told.
        const hid = clonePlain(s);
        hid.grenades[0]!.at = P(4, 0);
        const view = knownView(world, hid);
        const told = view.inView[4] === 1 || view.fresh[4] === 1;
        expect((loudView(world, hid, view, null)?.grenades ?? []).length).toBe(told ? 1 : 0);
    });
});

describe('the heat strip', () => {
    it('gives the police mode with its phases left, and the next arrival\'s level, icon and phases', () => {
        const { world, state } = loud(['................'], [{ id: 'jun', pos: P(1, 0), items: ['pistol'] }], 'assault');
        const heat = bankView(state, false, world).heat!;
        expect(heat.mode).toEqual({ now: 'assault', left: 9, next: expect.any(String) });
    });
});

describe('the negotiator dialog', () => {
    it('lists the four offers, with what each does and why one can\'t be given', () => {
        const { world, state } = loud(['................'], [{ id: 'jun', pos: P(1, 0), items: ['pistol'] }], 'negotiate');
        officer(state, 'n', P(12, 0), 'negotiator');
        const vm = negotiatorView(world, state, 'jun');
        expect(vm).not.toBeNull();
        expect(vm!.offers.map(o => o.offer)).toEqual(['release', 'trade', 'stall', 'hangUp']);
        expect(vm!.offers.find(o => o.offer === 'stall')).toMatchObject({ id: 'negotiate:stall', effect: expect.stringMatching(/^\+\d turns$/) });
        expect(vm!.offers.find(o => o.offer === 'trade')!.reason).toBeTruthy();
        expect(vm!.offers.find(o => o.offer === 'release')!.reason).toBeTruthy();
        // Nobody calling in Assault.
        const assault = clonePlain(state);
        assault.police.mode!.kind = 'assault';
        expect(negotiatorView(world, assault, 'jun')).toBeNull();
    });
});

describe('the driving overlay', () => {
    const bank = cachedBank({ layout: 31, population: 2, tier: 'small', archetype: 'twoWing' });

    it('tints every reachable footprint, brackets the chosen one and draws the path the drive will take', () => {
        const { world, state } = newHeist(bank);
        const van = world.vehicles![0]!;
        let s: State = clonePlain(state);
        s.crew[0]!.pos = doorTiles(van, van.start)[0]!;
        s = commit(world, s, { type: 'board', crew: 'mara', vehicle: 'van' }).state;
        const drive = actionMenu(world, s, 'mara').find(e => e.id === 'drive')!;
        expect(drive.command.type).toBe('drive');
        const cmd = drive.command as Extract<typeof drive.command, { type: 'drive' }>;
        const vm = driveView(world, s, cmd)!;
        expect(vm.refusal).toBeUndefined();
        expect(vm.chosen).toEqual(footprint(van, cmd.to).filter(t => t.x >= 0 && t.x < world.width));
        expect(vm.swept.length).toBeGreaterThan(0);
        expect(vm.path.length).toBeGreaterThan(1);
        // Every footprint of the reach is tinted; Jun, left on foot, is flagged.
        const reach = vehicleReach(world, s, 'van')!;
        const tinted = new Set(vm.reach.map(t => `${t.x},${t.y}`));
        for (const n of reach.nodes.values()) for (const t of footprint(van, n.pose)) if (t.x >= 0 && t.x < world.width) expect(tinted.has(`${t.x},${t.y}`)).toBe(true);
        expect(vm.onFoot).toEqual([s.crew[1]!.pos]);
        // A tap on a tile picks a pose over it the drive can reach, and that drive's preview is its commit.
        const tile = vm.reach.find(t => !vm.chosen.some(c => c.x === t.x && c.y === t.y) && !footprint(van, s.vehicles.van!.pose).some(c => c.x === t.x && c.y === t.y))!;
        const pose = posesCovering(world, s, 'van', tile)[0]!;
        expect(footprint(van, pose).some(t => t.x === tile.x && t.y === tile.y)).toBe(true);
        const r = commit(world, s, { ...cmd, to: pose });
        expect(r.state.vehicles.van!.pose).toEqual(pose);
    });

    it('plans on what the crew knows: an NPC it doesn\'t see doesn\'t shrink the reach', () => {
        const { world, state } = newHeist(bank);
        const van = world.vehicles![0]!;
        let s: State = clonePlain(state);
        s.crew[0]!.pos = doorTiles(van, van.start)[0]!;
        s = commit(world, s, { type: 'board', crew: 'mara', vehicle: 'van' }).state;
        const cmd = actionMenu(world, s, 'mara').find(e => e.id === 'drive')!.command as never;
        const before = driveView(world, s, cmd)!;
        // Someone the crew has never seen stands on a tile the reach covers.
        const hidden = clonePlain(s), npc = hidden.npcs[0]!, tile = before.reach.find(t => !hidden.crew.some(c => c.pos.x === t.x && c.pos.y === t.y))!;
        npc.pos = { ...tile };
        npc.status = 'idle' as never;
        delete hidden.knowledge.npcs[npc.id];
        const after = driveView(world, hidden, cmd)!;
        expect(after.reach).toEqual(before.reach);
    });
});
