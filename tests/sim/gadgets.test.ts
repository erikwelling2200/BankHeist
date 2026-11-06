import { describe, expect, it } from 'vitest';
import {
    actionPreview, clonePlain, crewLook, deserialiseState, edgeBetween, edgeKey, fixtureWorld, hashOf, initialState, legalActions, preview, serialiseState, whyNot, type Command, type CrewStart,
    type FixtureOptions, type PersonDef, type Pos, type ReadonlyWorld, type SimEvent, type State
} from '../../src/sim';
import { actionMenu, menuIsLegal, noisemakerTiles } from '../../src/game/actions';
import { gadgetMarkers } from '../../src/game/loudUi';
import { describeEvent } from '../../src/game/views';
import { scouted, step } from './helpers';

/*
 * M4-06, distractions and gadgets (GAME_DESIGN §8.13, §11.11, §12.2; decisions 260–266): the noisemaker, the ammo bag,
 * the reinforcement kit as kit and the suppressed SMG.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const FLOOR = Array.from({ length: 8 }, () => '............');
const person = (id: string, role: string, observer: PersonDef['observer'], pos: Pos, facing: PersonDef['facing']): PersonDef =>
    ({ id, name: id, role, observer, pos, facing, schedule: [] });
const of = <K extends SimEvent['type']>(events: readonly SimEvent[], type: K) => events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
const npc = (state: State, id: string) => state.npcs.find(n => n.id === id)!;
const endTurn = { type: 'endTurn' } as const;

function setup(people: PersonDef[], crew: CrewStart[], options: FixtureOptions = {}): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(FLOOR, { people, ...options });
    return { world, state: clonePlain(initialState(world, { seed: 11, crew })) };
}

/** Commits and checks that the preview said exactly the same. */
function act(world: ReadonlyWorld, state: State, cmd: Command) {
    const seen = preview(world, state, cmd), done = step(world, state, cmd);
    expect(seen.events).toEqual(done.events);
    expect(hashOf(seen.state)).toBe(hashOf(done.state));
    return done;
}

const throwTo = (to: Pos, crew = 'jun'): Command => ({ type: 'throwNoisemaker', crew, to });

describe('the noisemaker (§8.13)', () => {
    const lure = () => setup([person('guard', 'guard', 'enforcer', P(9, 7), 'e'), person('clerk', 'clerk', 'staff', P(9, 2), 'e')], [{ id: 'jun', pos: P(2, 2), items: ['noisemaker'] }]);

    it('comes 3 to a kit item, and is Clean', () => {
        const { state } = lure();
        expect(state.crew[0]!.arms.throwables).toEqual({ noisemaker: 3 });
        expect(crewLook(state.crew[0]!).profile).toBe('clean');
    });

    it('sounds as it lands: a quiet noise of 3, the guard in reach sent to look and walking there now, the clerk out of reach', () => {
        const { world, state } = lure();
        const to = P(7, 5);
        const shown = actionPreview(world, scouted(world, state), throwTo(to));
        if (!shown.ok) throw new Error(shown.reason);
        expect(shown.noises.map(n => [n.kind, n.radius, n.sources])).toEqual([['quiet', 3, [to]]]);
        expect(shown.noises[0]!.ears).toEqual([{ npc: 'guard', status: 'investigating', sent: true }]);
        const done = act(world, state, throwTo(to));
        expect(of(done.events, 'noisemakerLanded')).toEqual([{ type: 'noisemakerLanded', crew: 'jun', at: to, left: 2 }]);
        expect(done.events.find(e => e.type === 'noise')).toMatchObject({ kind: 'quiet', radius: 3, sources: [to], heard: ['guard'] });
        expect(npc(done.state, 'clerk').evidence).toBeNull();
        const guard = npc(done.state, 'guard');
        expect([guard.goal.kind, guard.status, guard.alerted]).toEqual(['inspect', 'investigating', false]);
        // Telegraphed in this crew phase: the walk toward the noise is its intent now, and it faces it.
        expect(guard.intent.path.length).toBeGreaterThan(0);
        expect(guard.facing).not.toBe('e');
        expect(done.state.crew[0]!.arms.throwables.noisemaker).toBe(2);
        expect(done.state.crew[0]!.actionsLeft).toBe(1);
        expect(done.state.bank.loud).toBe(false);
        expect(describeEvent(world, done.state, of(done.events, 'noisemakerLanded')[0]!)).toBe('jun threw a noisemaker');
    });

    it('holds the one sent until it stands by the spot, then lets it go back', () => {
        const { world, state } = lure();
        let s = step(world, state, throwTo(P(7, 5))).state;
        const near = (st: State) => Math.max(Math.abs(npc(st, 'guard').pos.x - 7), Math.abs(npc(st, 'guard').pos.y - 5)) <= 1;
        s = step(world, s, endTurn).state;
        expect(near(s)).toBe(true);
        expect(npc(s, 'guard').evidence).toBeNull();
        expect(npc(s, 'guard').goal.kind).not.toBe('inspect');
    });

    it('is refused out of range, out of sight, onto a full-height tile, with the hands full or none left', () => {
        const { world, state } = setup([], [{ id: 'jun', pos: P(0, 2), items: ['noisemaker'] }], {
            walls: [0, 1, 2, 3, 4, 5, 6, 7].map(y => ({ between: [P(3, y), P(4, y)] as [Pos, Pos] }))
        });
        expect(whyNot(world, state, throwTo(P(2, 7)))).toBeUndefined();
        expect(whyNot(world, state, throwTo(P(0, 2)))).toMatch(/can't be thrown there/);
        expect(whyNot(world, state, throwTo(P(2, 9)))).toMatch(/can't be thrown there/);
        expect(whyNot(world, state, throwTo(P(5, 2)))).toMatch(/can't see where it would land/);
        const full = clonePlain(state);
        full.crew[0]!.loadout.carrying = 'lootBag';
        expect(whyNot(world, full, throwTo(P(2, 2)))).toMatch(/hands are full/);
        const none = clonePlain(state);
        none.crew[0]!.arms.throwables = {};
        expect(whyNot(world, none, throwTo(P(2, 2)))).toMatch(/no noisemaker left/);
        expect(legalActions(world, none, 'jun').some(c => c.type === 'throwNoisemaker')).toBe(false);
        expect(legalActions(world, state, 'jun')).toContainEqual(throwTo(P(2, 7)));
    });

    it('goes over a railing but never through intact glass or a shut door, though the thrower sees through them; nor does a grenade', () => {
        const wall = (material: 'glass' | 'rail') => [0, 1, 2, 3, 4, 5, 6, 7].map(y => ({ between: [P(3, y), P(4, y)] as [Pos, Pos], material }));
        const glass = setup([], [{ id: 'jun', pos: P(1, 2), items: ['noisemaker', 'flashbang'] }], { walls: wall('glass') });
        expect(whyNot(glass.world, glass.state, throwTo(P(2, 2)))).toBeUndefined();
        expect(whyNot(glass.world, glass.state, throwTo(P(5, 2)))).toMatch(/Glass or a door is in the way/);
        expect(legalActions(glass.world, glass.state, 'jun').some(c => c.type === 'throwNoisemaker' && c.to.x > 3)).toBe(false);
        const loud = clonePlain(glass.state);
        loud.bank.loud = true;
        expect(whyNot(glass.world, loud, { type: 'throwGrenade', crew: 'jun', item: 'flashbang', to: P(5, 2) })).toMatch(/Glass or a door is in the way/);
        expect(whyNot(glass.world, loud, { type: 'throwGrenade', crew: 'jun', item: 'flashbang', to: P(2, 3) })).toBeUndefined();
        const rail = setup([], [{ id: 'jun', pos: P(1, 2), items: ['noisemaker'] }], { walls: wall('rail') });
        expect(whyNot(rail.world, rail.state, throwTo(P(5, 2)))).toBeUndefined();
    });

    it('seen thrown in a quiet bank, it costs a pip with whoever saw it', () => {
        const { world, state } = setup([person('clerk', 'clerk', 'staff', P(6, 2), 'w')], [{ id: 'jun', pos: P(2, 2), items: ['noisemaker'] }]);
        const done = act(world, state, throwTo(P(2, 7)));
        expect(of(done.events, 'suspicionRaised')).toEqual([expect.objectContaining({ npc: 'clerk', crew: 'jun', added: 1, why: ['noisemaker'] })]);
        const loud = clonePlain(state);
        loud.bank.loud = true;
        expect(of(step(world, loud, throwTo(P(2, 7))).events, 'suspicionRaised').filter(e => e.why.includes('noisemaker'))).toEqual([]);
    });

    it('two kits are six throws, and the sixth takes both items off', () => {
        const { world, state } = setup([], [{ id: 'jun', pos: P(0, 2), items: ['noisemaker', 'noisemaker'] }]);
        expect(state.crew[0]!.arms.throwables.noisemaker).toBe(6);
        let s = state;
        for (let i = 0; i < 6; i++) {
            s = step(world, s, throwTo(P(3, 2))).state;
            if (s.crew[0]!.actionsLeft === 0) s = step(world, s, endTurn).state;
        }
        expect(s.crew[0]!.loadout.items).toEqual([]);
    });

    it('the last one takes the item off', () => {
        const { world, state } = setup([], [{ id: 'jun', pos: P(0, 2), items: ['noisemaker', 'pistol'] }]);
        let s = state;
        for (let i = 0; i < 3; i++) {
            s = step(world, s, throwTo(P(3, 2))).state;
            if (s.crew[0]!.actionsLeft === 0) s = step(world, s, endTurn).state;
        }
        expect(s.crew[0]!.arms.throwables.noisemaker).toBeUndefined();
        expect(s.crew[0]!.loadout.items).toEqual(['pistol']);
        expect(whyNot(world, s, throwTo(P(3, 2)))).toMatch(/no noisemaker left/);
    });

    it('is on the grid with its count, thrown ahead to a tile the crew sees, and a legal command', () => {
        const { world, state } = lure();
        const s = scouted(world, state);
        s.crew[0]!.facing = 'e';
        const entry = actionMenu(world, s, 'jun').find(e => e.id === 'noisemaker')!;
        expect(entry.label).toBe('Noisemaker (3)');
        expect(entry.command).toEqual(throwTo(P(8, 2)));
        expect(menuIsLegal(world, s, 'jun', actionMenu(world, s, 'jun'))).toBe(true);
        const legal = legalActions(world, s, 'jun').map(c => JSON.stringify(c));
        for (const p of noisemakerTiles(world, s, 'jun')) expect(legal).toContain(JSON.stringify(throwTo(p)));
    });
});

describe('the ammo bag (§11.11)', () => {
    function loud(): { world: ReadonlyWorld; state: State } {
        const { world, state } = setup([], [{ id: 'jun', pos: P(2, 2), items: ['pistol', 'ammoBag'] }, { id: 'mara', pos: P(3, 3), items: ['smg', 'pistol'] }]);
        state.bank.loud = true;
        state.bank.alarm = true;
        return { world, state };
    }
    const drop: Command = { type: 'dropAmmoBag', crew: 'jun' };

    it('is put down only once the bank is loud, on the tile, for 1 action, the item off', () => {
        const { world, state } = loud();
        const quiet = clonePlain(state);
        quiet.bank.loud = false;
        expect(whyNot(world, quiet, drop)).toMatch(/when the bank is loud/);
        expect(whyNot(world, state, { type: 'dropAmmoBag', crew: 'mara' })).toMatch(/no ammo bag/);
        const done = act(world, state, drop);
        expect(done.state.ammoBags).toEqual([{ id: expect.any(String), at: P(2, 2), uses: 4, by: 'jun' }]);
        expect(done.state.crew[0]!.loadout.items).toEqual(['pistol']);
        expect(done.state.crew[0]!.actionsLeft).toBe(1);
        expect(gadgetMarkers(world, done.state)).toEqual([{ kind: 'ammoBag', at: P(2, 2), uses: 4 }]);
    });

    it('tops up every gun of whoever is in reach, a use each; the last use leaves nothing', () => {
        const { world, state } = loud();
        let s = step(world, state, drop).state;
        const bag = s.ammoBags[0]!.id, refill = (crew: string): Command => ({ type: 'refillAmmo', crew, bag });
        expect(whyNot(world, s, refill('mara'))).toMatch(/spare magazines are full/);
        s.crew[1]!.arms.guns.smg!.spare = 0;
        s.crew[1]!.arms.guns.pistol!.spare = 2;
        expect(legalActions(world, s, 'mara')).toContainEqual(refill('mara'));
        const done = act(world, s, refill('mara'));
        expect([done.state.crew[1]!.arms.guns.smg!.spare, done.state.crew[1]!.arms.guns.pistol!.spare]).toEqual([3, 3]);
        expect(of(done.events, 'ammoRefilled')).toEqual([{ type: 'ammoRefilled', crew: 'mara', bag, magazines: 4, left: 3 }]);
        s = clonePlain(done.state);
        s.ammoBags[0]!.uses = 1;
        s.crew[1]!.pos = P(6, 6);
        s.crew[1]!.arms.guns.smg!.spare = 1;
        expect(whyNot(world, s, refill('mara'))).toMatch(/can't reach the ammo bag/);
        s.crew[0]!.arms.guns.pistol!.spare = 0;
        const last = step(world, s, refill('jun'));
        expect(last.state.ammoBags).toEqual([]);
        expect(describeEvent(world, last.state, of(last.events, 'ammoRefilled')[0]!)).toMatch(/it is empty/);
    });

    it('survives a save', () => {
        const { world, state } = loud();
        const s = step(world, state, drop).state;
        expect(deserialiseState(serialiseState({ state: s }), world).state).toEqual(s);
    });
});

describe('the reinforcement kit as kit (§12.2)', () => {
    it('comes off once its two uses are spent, one kit at a time', () => {
        const DOOR_WALLS = [0, 1, 2, 3].map(y => ({ between: [P(5, y), P(6, y)] as [Pos, Pos], material: 'soft' as const }));
        const { world, state } = setup([], [{ id: 'jun', pos: P(5, 1), items: ['reinforcementKit', 'reinforcementKit'] }], { walls: DOOR_WALLS });
        expect(state.crew[0]!.reinforcements).toBe(4);
        let s = state;
        const kits = () => s.crew[0]!.loadout.items.filter(i => i === 'reinforcementKit').length;
        const counts: number[] = [];
        for (const y of [0, 1, 2, 3]) {
            s = clonePlain(s);
            s.crew[0]!.pos = P(5, y);
            s.crew[0]!.actionsLeft = 2;
            const edge = edgeKey(edgeBetween(P(5, y), P(6, y)));
            s = step(world, s, { type: 'fortify', crew: 'jun', edge, action: 'reinforce' }).state;
            counts.push(kits());
        }
        expect(counts).toEqual([2, 1, 1, 0]);
        expect(s.crew[0]!.reinforcements).toBe(0);
    });
});

describe('the suppressed SMG (§12.1)', () => {
    it('fires as the SMG with a quiet noise of 4, and shows Armed', () => {
        const { world, state } = setup([person('guard', 'guard', 'enforcer', P(6, 2), 'w')], [{ id: 'jun', pos: P(2, 2), items: ['suppressedSmg'] }]);
        expect(crewLook(state.crew[0]!).profile).toBe('armed');
        expect(state.crew[0]!.arms.guns.suppressedSmg).toEqual({ load: 'suppressedSmg', loaded: 30, spare: 3 });
        const fired = step(world, state, { type: 'attack', crew: 'jun', at: P(6, 2), target: 'guard', bullets: 1 });
        expect(fired.events.find(e => e.type === 'noise')).toMatchObject({ kind: 'quiet', radius: 4 });
        expect(fired.state.bank.loud).toBe(false);
    });
});
