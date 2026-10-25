import { describe, expect, it } from 'vitest';
import {
    actionPreview, blastTiles, clonePlain, commit, coverAgainst, fixtureWorld, hasLineOfSight, initialState, legalActions, preview, previewShot, shotFabric, shotMap, sightMap, traceShot, whyNot,
    type Command, type FixtureOptions, type NpcStatus, type PersonDef, type Pos, type ReadonlyWorld, type SimEvent, type State
} from '../../src/sim';

/*
 * The weapons and combat actions of M3-02 (GAME_DESIGN §6.3, §11.8–11.11, §12.1–12.2): attacks and the fire selector,
 * the taser, the melee strike, swapping, reloading, scavenging, Brace, Watch, Suppress, fused grenades and flipping a
 * table; and their previews, which stop at the bullets and show everything before them.
 */

const P = (x: number, y: number): Pos => ({ x, y });

const person = (id: string, pos: Pos, role = 'customer', observer: PersonDef['observer'] = 'civilian', extra: Partial<PersonDef> = {}): PersonDef => ({
    id, name: id, role, observer, pos, facing: 's', schedule: [], ...extra
});

interface Setup extends FixtureOptions { jun?: Pos; items?: string[]; mara?: Pos; maraItems?: string[]; status?: Record<string, NpcStatus> }

function setup(map: string[], options: Setup = {}): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(map, options);
    const state = initialState(world, {
        seed: 11, crew: [{ id: 'jun', pos: options.jun ?? P(0, 1), items: options.items ?? ['pistol'] }, { id: 'mara', pos: options.mara ?? P(0, map.length - 1), items: options.maraItems ?? [] }]
    });
    for (const [id, status] of Object.entries(options.status ?? {})) state.npcs.find(n => n.id === id)!.status = status;
    return { world, state };
}

const OPEN = ['................', '................', '................', '................'];
const types = (events: readonly SimEvent[]): string[] => events.map(e => e.type);
const npc = (state: State, id: string) => state.npcs.find(n => n.id === id)!;
const jun = (state: State) => state.crew.find(c => c.id === 'jun')!;

describe('attacking', () => {
    it('fires the drawn weapon: the rounds, the action, the noise and Loud, then the bullets and their harm', () => {
        const { world, state } = setup(OPEN, { people: [person('guard', P(4, 1), 'lobbyGuard', 'enforcer')] });
        const cmd: Command = { type: 'attack', crew: 'jun', at: P(4, 1), target: 'guard' };
        const r = commit(world, state, cmd);
        expect(jun(r.state).arms.guns.pistol!.loaded).toBe(10);
        expect(jun(r.state).actionsLeft).toBe(1);
        expect(r.state.bank.loud).toBe(true);
        expect(r.undoable).toBe(false);
        const order = types(r.events);
        expect(order.slice(0, 3)).toEqual(['attacked', 'noise', 'heard']);
        expect(order.indexOf('wentLoud')).toBeLessThan(order.indexOf('shotFired'));
        const fired = r.events.find(e => e.type === 'shotFired')!;
        const harmed = r.events.filter((e): e is Extract<SimEvent, { type: 'harmed' }> => e.type === 'harmed');
        if (fired.type === 'shotFired') expect(harmed.map(h => [h.target, h.damage])).toEqual(fired.hits.map(h => [h.id, h.damage]));
        expect(r.state.shots).toHaveLength(1);
        expect(r.state.shots[0]!.shot).toMatchObject({ shooter: 'jun', weapon: 'pistol', bullets: 2, moved: false, braced: false });
    });

    it('previews everything up to the bullets, which it shows as a cone, never an outcome', () => {
        const { world, state } = setup(OPEN, { people: [person('guard', P(4, 1), 'lobbyGuard', 'enforcer')] });
        const cmd: Command = { type: 'attack', crew: 'jun', at: P(4, 1), target: 'guard' };
        const seen = preview(world, state, cmd), real = commit(world, state, cmd);
        expect(seen.pending).toEqual({ stream: 'combat', p: null, reason: 'attack jun' });
        // Up to the stop, the preview is the commit.
        expect(seen.events).toEqual(real.events.slice(0, seen.events.length));
        expect(types(seen.events)).not.toContain('shotFired');
        // The guard sees it: the witness comes before the bullets, so the preview tells it.
        expect(types(seen.events)).toContain('exposed');
        expect(seen.state.crew[0]!.arms.aiming).toMatchObject({ mode: 'attack', shot: { target: 'guard' } });
        expect(real.state.crew[0]!.arms.aiming).toBeNull();
        const shown = actionPreview(world, state, cmd);
        expect(shown.ok && shown.noises.map(n => [n.kind, n.radius])).toEqual([['loud', 8]]);
        expect(shown.ok && shown.undoable).toBe(false);
        // The cone: what the commit's rolled points did, the preview's fan shows.
        const record = real.state.shots[0]!;
        const trace = traceShot(world, state, record.shot, record.rolls), fan = previewShot(world, state, record.shot);
        for (const b of trace.bullets) {
            const segment = fan.fan.find(s => b.offset >= s.from && b.offset <= s.to)!;
            expect(segment.steps.filter(s => s.kind === 'body').map(s => s.kind === 'body' && s.id)).toEqual(b.steps.filter(s => s.kind === 'body').map(s => s.kind === 'body' && s.id));
        }
    });

    it('fires 1 up to the Bullets with the selector, no more than the magazine holds', () => {
        const { world, state } = setup(OPEN, { items: ['smg'], people: [person('guard', P(5, 1), 'lobbyGuard', 'enforcer')] });
        const one = commit(world, state, { type: 'attack', crew: 'jun', at: P(5, 1), bullets: 1 });
        expect(one.state.shots[0]!.rolls.points).toHaveLength(1);
        expect(jun(one.state).arms.guns.smg!.loaded).toBe(29);
        const low = clonePlain(state);
        jun(low).arms.guns.smg!.loaded = 3;
        expect(whyNot(world, low, { type: 'attack', crew: 'jun', at: P(5, 1), bullets: 4 })).toMatch(/3 rounds left/);
        // Unasked, it fires what is left.
        expect(commit(world, low, { type: 'attack', crew: 'jun', at: P(5, 1) }).state.shots[0]!.rolls.points).toHaveLength(3);
        jun(low).arms.guns.smg!.loaded = 0;
        expect(whyNot(world, low, { type: 'attack', crew: 'jun', at: P(5, 1) })).toMatch(/empty/);
        expect(whyNot(world, state, { type: 'attack', crew: 'jun', at: P(5, 1), bullets: 5 })).toMatch(/1 to 4 bullets/);
    });

    it('costs the LMG 2 actions, applies the moving penalty after a move, and none braced', () => {
        const { world, state } = setup(OPEN, { items: ['lmg'], people: [person('guard', P(8, 1), 'lobbyGuard', 'enforcer')] });
        expect(actionPreview(world, state, { type: 'attack', crew: 'jun', at: P(8, 1) })).toMatchObject({ ok: true, cost: 2 });
        const moved = commit(world, state, { type: 'move', crew: 'jun', path: [P(1, 1)] }).state;
        expect(whyNot(world, moved, { type: 'attack', crew: 'jun', at: P(8, 1) })).toMatch(/1 of 2 actions/);
        const next = commit(world, commit(world, moved, { type: 'endTurn' }).state, { type: 'brace', crew: 'jun' }).state;
        expect(jun(next).arms.braced).toBe(true);
        // A brace is their last action: the next turn they fire braced.
        const fresh = commit(world, next, { type: 'endTurn' }).state;
        const shot = commit(world, fresh, { type: 'attack', crew: 'jun', at: P(8, 1) }).state.shots[0]!.shot;
        expect(shot).toMatchObject({ braced: true, moved: false });
        const walked = commit(world, commit(world, fresh, { type: 'move', crew: 'jun', path: [P(1, 2)] }).state, { type: 'endTurn' }).state;
        expect(jun(walked).arms.braced).toBe(false);
        expect(jun(moved).arms.moved).toBe(moved.turn);
    });

    it('knocks out with the taser, not through armour 2, and quietly', () => {
        // Two tiles off a body spans ±7°, the dart's arc ±1°: it always lands.
        const { world, state } = setup(OPEN, { items: ['taser'], people: [person('guard', P(2, 1), 'lobbyGuard', 'enforcer'), person('swat', P(2, 3), 'swat', 'enforcer')], status: { guard: 'hostile' } });
        const r = commit(world, state, { type: 'attack', crew: 'jun', at: P(2, 1), target: 'guard' });
        expect(r.events.find(e => e.type === 'tased')).toEqual({ type: 'tased', crew: 'jun', npc: 'guard', stopped: false });
        expect(npc(r.state, 'guard').status).toBe('unconscious');
        expect(types(r.events)).not.toContain('harmed');
        expect(r.state.bank.loud).toBe(false);
        expect(r.events.find(e => e.type === 'noise')).toMatchObject({ kind: 'quiet', radius: 2 });
        expect(jun(r.state).arms.guns.taser).toMatchObject({ loaded: 2, spare: 0 });
        const armoured = commit(world, state, { type: 'attack', crew: 'jun', at: P(2, 3), target: 'swat' });
        expect(armoured.events.find(e => e.type === 'tased')).toEqual({ type: 'tased', crew: 'jun', npc: 'swat', stopped: true });
        expect(npc(armoured.state, 'swat').status).not.toBe('unconscious');
    });

    it('fires from the lean tile while leaning out, and braces only a weapon with a bipod', () => {
        const { world, state } = setup(['......', '......', '......'], { jun: P(0, 1), walls: [{ between: [P(0, 0), P(0, 1)] }], people: [person('guard', P(4, 0), 'lobbyGuard', 'enforcer')] });
        const first = commit(world, state, { type: 'attack', crew: 'jun', at: P(4, 0), target: 'guard', lean: P(1, 1) });
        expect(jun(first.state).leaning?.at).toEqual(P(1, 1));
        const second = commit(world, first.state, { type: 'attack', crew: 'jun', at: P(4, 0), target: 'guard' });
        expect(second.state.shots[1]!.shot.lean).toEqual(P(1, 1));
        const pistol = clonePlain(state);
        jun(pistol).arms.braced = true;
        expect(commit(world, pistol, { type: 'attack', crew: 'jun', at: P(4, 0), target: 'guard' }).state.shots[0]!.shot.braced).toBe(false);
        expect(whyNot(world, state, { type: 'brace', crew: 'jun' })).toMatch(/no bipod/);
    });

    it('offers attacks on whoever is up, in range and in sight', () => {
        const { world, state } = setup(['......', '......', '......'], { jun: P(0, 1), people: [person('a', P(4, 1)), person('b', P(5, 2))], status: { b: 'commanded' } });
        expect(legalActions(world, state, 'jun').filter(c => c.type === 'attack')).toEqual([{ type: 'attack', crew: 'jun', at: P(4, 1), target: 'a' }]);
        const unarmed = setup(['......', '......'], { items: [], jun: P(0, 0), people: [person('a', P(4, 0))] });
        expect(legalActions(unarmed.world, unarmed.state, 'jun').some(c => c.type === 'attack')).toBe(false);
    });
});

describe('the melee strike', () => {
    it('deals 3 to anyone up in reach, fighting or not, armour counting, quietly', () => {
        const { world, state } = setup(OPEN, { people: [person('guard', P(1, 1), 'lobbyGuard', 'enforcer'), person('chief', P(0, 2), 'chief', 'enforcer')], status: { guard: 'hostile' } });
        const r = commit(world, state, { type: 'strike', crew: 'jun', npc: 'guard' });
        expect(r.events.find(e => e.type === 'harmed')).toMatchObject({ target: 'guard', by: 'jun', cause: 'strike', damage: 3, lethal: true });
        expect(r.events.find(e => e.type === 'noise')).toMatchObject({ kind: 'quiet', radius: 2 });
        expect(r.state.bank.loud).toBe(false);
        // The security chief's armour 1 takes one off.
        expect(commit(world, state, { type: 'strike', crew: 'jun', npc: 'chief' }).events.find(e => e.type === 'harmed')).toMatchObject({ damage: 2 });
        expect(whyNot(world, state, { type: 'strike', crew: 'mara', npc: 'guard' })).toMatch(/can't reach/);
        // Never rolled: the preview is the commit.
        expect(preview(world, state, { type: 'strike', crew: 'jun', npc: 'guard' }).events).toEqual(r.events);
    });
});

describe('ammunition and weapons', () => {
    it('swaps free once a turn, then for an action', () => {
        const { world, state } = setup(OPEN, { items: ['assaultRifle', 'pistol'] });
        expect(jun(state).arms.drawn).toBe('assaultRifle');
        const a = commit(world, state, { type: 'swap', crew: 'jun', to: 'pistol' });
        expect(jun(a.state)).toMatchObject({ actionsLeft: 2, arms: { drawn: 'pistol' } });
        const b = commit(world, a.state, { type: 'swap', crew: 'jun', to: 'assaultRifle' });
        expect(jun(b.state).actionsLeft).toBe(1);
        expect(b.events).toEqual([{ type: 'swapped', crew: 'jun', to: 'assaultRifle', free: false }]);
        expect(whyNot(world, state, { type: 'swap', crew: 'jun', to: 'dmr' })).toMatch(/no dmr/);
    });

    it('reloads from a spare magazine for an action, the pump with shells or slugs', () => {
        const { world, state } = setup(OPEN, { items: ['shotgun'] });
        expect(whyNot(world, state, { type: 'reload', crew: 'jun' })).toMatch(/loaded/);
        const slugs = commit(world, state, { type: 'reload', crew: 'jun', load: 'shotgunSlug' });
        expect(jun(slugs.state).arms.guns.shotgun).toEqual({ load: 'shotgunSlug', loaded: 6, spare: 2 });
        expect(slugs.undoable).toBe(true);
        expect(whyNot(world, state, { type: 'reload', crew: 'jun', load: 'dmr' })).toMatch(/doesn't take/);
        const dry = clonePlain(state);
        jun(dry).arms.guns.shotgun!.spare = 0;
        jun(dry).arms.guns.shotgun!.loaded = 0;
        expect(whyNot(world, dry, { type: 'reload', crew: 'jun' })).toMatch(/no spare/);
    });

    it('scavenges a downed guard: the weapon with its magazine, or the magazines for the same gun', () => {
        const { world, state } = setup(OPEN, { items: [], maraItems: ['pistol'], mara: P(2, 2), people: [person('guard', P(1, 1), 'lobbyGuard', 'enforcer')], status: { guard: 'unconscious' } });
        expect(npc(state, 'guard').ammo).toEqual({ weapon: 'pistol', loaded: 12, spare: 2 });
        const took = commit(world, state, { type: 'scavenge', crew: 'jun', npc: 'guard', take: 'weapon' });
        expect(jun(took.state).loadout.items).toContain('pistol');
        expect(jun(took.state).arms).toMatchObject({ drawn: 'pistol', guns: { pistol: { loaded: 12, spare: 0 } } });
        expect(npc(took.state, 'guard')).toMatchObject({ armed: null, ammo: { loaded: 0, spare: 2 } });
        expect(whyNot(world, took.state, { type: 'scavenge', crew: 'jun', npc: 'guard', take: 'weapon' })).toMatch(/gone/);
        const mags = commit(world, took.state, { type: 'scavenge', crew: 'mara', npc: 'guard', take: 'ammo' });
        expect(mags.state.crew[1]!.arms.guns.pistol!.spare).toBe(5);
        const up = clonePlain(state);
        npc(up, 'guard').status = 'calm';
        expect(whyNot(world, up, { type: 'scavenge', crew: 'jun', npc: 'guard', take: 'weapon' })).toMatch(/someone down/);
    });

    it('hands a spare magazine to a teammate in reach with the same gun', () => {
        const { world, state } = setup(OPEN, { items: ['pistol'], maraItems: ['pistol'], mara: P(1, 1) });
        const r = commit(world, state, { type: 'handMag', crew: 'jun', to: 'mara' });
        expect(r.state.crew.map(c => c.arms.guns.pistol!.spare)).toEqual([2, 4]);
        const far = setup(OPEN, { maraItems: ['pistol'] });
        expect(whyNot(far.world, far.state, { type: 'handMag', crew: 'jun', to: 'mara' })).toMatch(/out of reach/);
    });
});

describe('Watch', () => {
    it('holds a wedge through the world phase, and fires a volley at the first Hostile that acts in it', () => {
        // The off-duty cop reaching for his gun draws it in the world phase: an act, in the wedge.
        const { world, state } = setup(OPEN, { people: [person('cop', P(5, 1), 'customer', 'civilian', { armed: 'hidden' })] });
        const cop = npc(state, 'cop');
        cop.lapse = { kind: 'reach', crew: 'jun' };
        cop.intent = { path: [], action: { kind: 'reachForWeapon', crew: 'jun' } };
        expect(whyNot(world, state, { type: 'watch', crew: 'jun', at: P(5, 1), arc: 61 })).toMatch(/1° to 60°/);
        const set = commit(world, state, { type: 'watch', crew: 'jun', at: P(5, 1), arc: 30 });
        expect(jun(set.state)).toMatchObject({ actionsLeft: 0, arms: { watch: { at: P(5, 1), arc: 30, turn: 1 } } });
        const phase = commit(world, set.state, { type: 'endTurn' });
        const order = types(phase.events);
        expect(order.indexOf('drewWeapon')).toBeGreaterThanOrEqual(0);
        expect(order.indexOf('attacked')).toBeGreaterThan(order.indexOf('drewWeapon'));
        expect(phase.events.find(e => e.type === 'attacked')).toMatchObject({ mode: 'watch', target: 'cop', bullets: 1 });
        expect(phase.state.shots[0]!.shot.aimFactor).toBe(1.5);
        expect(jun(phase.state).arms.watch).toBeNull();
        // An endTurn preview stops cleanly at the volley.
        expect(preview(world, set.state, { type: 'endTurn' }).pending).toMatchObject({ stream: 'combat', p: null });
    });

    it("ends unfired as the next crew phase begins, and the DMR's narrow wedge fires at Aim ×1", () => {
        const { world, state } = setup(OPEN, { items: ['dmr'], people: [person('guard', P(6, 1), 'lobbyGuard', 'enforcer')] });
        expect(whyNot(world, state, { type: 'watch', crew: 'jun', at: P(6, 1), arc: 16 })).toMatch(/1° to 15°/);
        const set = commit(world, state, { type: 'watch', crew: 'jun', at: P(6, 1), arc: 15 });
        const quiet = commit(world, set.state, { type: 'endTurn' });
        expect(quiet.events.find(e => e.type === 'watchEnded')).toEqual({ type: 'watchEnded', crew: 'jun', fired: false });
        // A guard who draws (an act) in the wedge.
        const drawing = clonePlain(set.state);
        npc(drawing, 'guard').lapse = { kind: 'reach', crew: 'jun' };
        npc(drawing, 'guard').intent = { path: [], action: { kind: 'reachForWeapon', crew: 'jun' } };
        const r = commit(world, drawing, { type: 'endTurn' });
        expect(r.state.shots[0]?.shot.aimFactor).toBe(1);
    });

    it('shouts down a runner through the wedge inside the Threat radius instead of shooting', () => {
        const { world, state } = setup(OPEN, { people: [person('runner', P(3, 3))] });
        const set = commit(world, state, { type: 'watch', crew: 'jun', at: P(3, 0), arc: 60 });
        const runner = npc(set.state, 'runner');
        runner.status = 'alerted';
        runner.lapse = { kind: 'flee', exit: P(3, 0) };
        runner.intent = { path: [P(3, 2), P(3, 1)], action: { kind: 'flee', exit: P(3, 0) } };
        const r = commit(world, set.state, { type: 'endTurn' });
        expect(r.events.find(e => e.type === 'shoutedDown')).toEqual({ type: 'shoutedDown', crew: 'jun', npc: 'runner' });
        expect(npc(r.state, 'runner').status).toBe('commanded');
        expect(types(r.events)).not.toContain('shotFired');
    });
});

describe('Suppress', () => {
    it('suppresses the Hostile in its wedge, puts civilians down, and fires every bullet with the spread doubled', () => {
        const { world, state } = setup(['..........', '..........', '..........'], {
            items: ['lmg'], people: [person('guard', P(6, 1), 'lobbyGuard', 'enforcer'), person('cust', P(5, 0)), person('out', P(1, 2))], status: { guard: 'hostile' }
        });
        expect(whyNot(world, state, { type: 'suppress', crew: 'jun', at: P(6, 1), arc: 90 })).toMatch(/1° to 60°/);
        const seen = preview(world, state, { type: 'suppress', crew: 'jun', at: P(6, 1) });
        expect(seen.events.filter(e => e.type === 'suppressedNpc' || e.type === 'commanded').map(e => e.type === 'suppressedNpc' || e.type === 'commanded' ? e.npc : '')).toEqual(['guard', 'cust']);
        const r = commit(world, state, { type: 'suppress', crew: 'jun', at: P(6, 1) });
        expect(jun(r.state).actionsLeft).toBe(0);
        expect(npc(r.state, 'guard').suppressed).toMatchObject({ turn: 1, by: 'jun', from: P(6, 1) });
        expect(npc(r.state, 'cust').command).toMatchObject({ pips: 2, by: 'jun' });
        expect(npc(r.state, 'out').status).not.toBe('commanded');
        const shot = r.state.shots[0]!.shot;
        expect(shot).toMatchObject({ weapon: 'lmg', bullets: 10, spread: 2 });
        // A suppressed Hostile can be knocked out; the suppression lasts the world phase.
        const beside = clonePlain(r.state);
        beside.crew[1]!.pos = P(5, 1);
        beside.crew[1]!.actionsLeft = 2;
        expect(whyNot(world, beside, { type: 'knockout', crew: 'mara', npc: 'guard' })).toBeUndefined();
        expect(npc(commit(world, r.state, { type: 'endTurn' }).state, 'guard').suppressed).toBeNull();
        expect(whyNot(world, setup(OPEN).state, { type: 'suppress', crew: 'jun', at: P(4, 1) })).toMatch(/Only an LMG/);
    });
});

describe('grenades', () => {
    it('land at once and go off as the world phase starts: a flashbang surprises everyone near and puts civilians down', () => {
        const { world, state } = setup(OPEN, {
            items: ['flashbang'], people: [person('guard', P(5, 1), 'lobbyGuard', 'enforcer'), person('cust', P(6, 2)), person('far', P(12, 1))]
        });
        npc(state, 'guard').intent = { path: [P(5, 2), P(5, 3)] };
        expect(whyNot(world, state, { type: 'throwGrenade', crew: 'jun', item: 'flashbang', to: P(5, 1) })).toMatch(/loud/);
        state.bank.loud = true;
        const thrown = commit(world, state, { type: 'throwGrenade', crew: 'jun', item: 'flashbang', to: P(5, 1) });
        expect(thrown.events.find(e => e.type === 'grenadeLanded')).toMatchObject({ kind: 'flashbang', at: P(5, 1), radius: 2 });
        expect(thrown.state.grenades).toHaveLength(1);
        expect(jun(thrown.state).arms.throwables.flashbang).toBe(1);
        expect(npc(thrown.state, 'guard').surprised).toBeNull();
        const r = commit(world, thrown.state, { type: 'endTurn' });
        expect(types(r.events).indexOf('grenadeWentOff')).toBe(1);
        expect(npc(r.state, 'guard').pos).toEqual(P(5, 1));
        expect(r.events.filter(e => e.type === 'flashed').map(e => e.type === 'flashed' && e.npc)).toEqual(['guard', 'cust']);
        expect(npc(r.state, 'cust').status).toBe('commanded');
        expect(r.events.find(e => e.type === 'noise')).toMatchObject({ kind: 'loud', radius: 14 });
        expect(r.state.grenades).toEqual([]);
        // The last one takes the item off them.
        const second = commit(world, thrown.state, { type: 'throwGrenade', crew: 'jun', item: 'flashbang', to: P(4, 3) }).state;
        expect(jun(second).loadout.items).not.toContain('flashbang');
        jun(second).actionsLeft = 2;
        expect(whyNot(world, second, { type: 'throwGrenade', crew: 'jun', item: 'flashbang', to: P(4, 3) })).toMatch(/no flashbang/);
        expect(whyNot(world, state, { type: 'throwGrenade', crew: 'jun', item: 'flashbang', to: P(12, 1) })).toMatch(/can't be thrown/);
    });

    it('fill the tiles a smoke grenade reaches, blocking sight for 3 world phases', () => {
        const { world, state } = setup(['..........', '..........', '..........'], { items: ['smoke'], people: [person('guard', P(9, 1), 'lobbyGuard', 'enforcer')] });
        expect(hasLineOfSight(world, state, P(0, 1), P(9, 1))).toBe(true);
        state.bank.alarm = true;
        let s = commit(world, state, { type: 'throwGrenade', crew: 'jun', item: 'smoke', to: P(4, 1) }).state;
        s = commit(world, s, { type: 'endTurn' }).state;
        expect(s.smoke).toHaveLength(1);
        expect(s.smoke[0]!.tiles).toEqual(blastTiles(world, sightMap(world, state), P(4, 1), 2));
        expect(hasLineOfSight(world, s, P(0, 1), P(9, 1))).toBe(false);
        s = commit(world, s, { type: 'endTurn' }).state;
        expect(s.smoke).toHaveLength(1);
        const cleared = commit(world, s, { type: 'endTurn' });
        expect(types(cleared.events)).toContain('smokeCleared');
        expect(hasLineOfSight(world, cleared.state, P(0, 1), P(9, 1))).toBe(true);
    });
});

describe('flipping a table', () => {
    it('makes a low table half cover with its hit points, noisily, and suspicious to whoever sees it in stealth', () => {
        const base = setup(OPEN, { people: [person('teller', P(4, 3), 'teller', 'staff')] });
        const world: ReadonlyWorld = { ...base.world, tiles: base.world.tiles.map((t, i) => (i === 1 * base.world.width + 1 ? { ...t, blocksMove: true, flipHp: 6 } : t)) };
        const state = initialState(world, { seed: 11, crew: [{ id: 'jun', pos: P(0, 1), items: [] }, { id: 'mara', pos: P(0, 3) }] });
        npc(state, 'teller').facing = 'nw';
        const tableIndex = 1 * world.width + 1;
        expect(shotFabric(world, state, shotMap(world, state), state.cover).cover[tableIndex]).toBe(-1);
        const r = commit(world, state, { type: 'flipTable', crew: 'jun', at: P(1, 1) });
        expect(r.state.flipped).toEqual([{ at: P(1, 1), side: 'w' }]);
        const map = shotMap(world, r.state), fabric = shotFabric(world, r.state, map, r.state.cover);
        expect(fabric.cover[tableIndex]).toBe(6);
        // Its arc faces away from the flipper: it covers jun's side against shots from the east, not someone east of it.
        const body = (pos: Pos) => ({ id: 'x', pos, standing: true, shield: false, armour: 0, precise: false });
        expect(coverAgainst(map, fabric, body(P(0, 1)), P(6, 1))).toMatchObject({ kind: 'tile', at: '1 1' });
        expect(coverAgainst(map, fabric, body(P(2, 1)), P(0, 2) as Pos)).toBeNull();
        expect(coverAgainst(map, fabric, body(P(2, 1)), P(0, 1))).toBeNull();
        expect(r.events.find(e => e.type === 'noise')).toMatchObject({ kind: 'quiet', radius: 4 });
        expect(r.events.find(e => e.type === 'suspicionRaised')).toMatchObject({ npc: 'teller', crew: 'jun', added: 2 });
        expect(whyNot(world, r.state, { type: 'flipTable', crew: 'jun', at: P(1, 1) })).toMatch(/flipped already/);
        expect(whyNot(world, state, { type: 'flipTable', crew: 'jun', at: P(2, 2) })).toMatch(/no table/);
    });
});
