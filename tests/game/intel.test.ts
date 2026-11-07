import { describe, expect, it } from 'vitest';
import { startHeist } from '../../src/game/heist';
import { bankPrint, intelKey, intelProblem, intelSummary, loadIntel, mergeIntel, noIntel, recordIntel } from '../../src/game/intel';
import { ASSETS, defaultSetup, heistFromSetup, setupFromAddress, planOptions, setupProblems, spent, startView, type HeistSetup } from '../../src/game/plan';
import { MemoryStorage, Session } from '../../src/game';
import {
    commit, crewPicture, dashBudget, decodeBits, moveBudget, encodeBits, intelOf, markerKind, opportunitiesOf, pathTo, preview, reachable, tileVisibility, visibilityMap, VISIBILITY, type Intel, type ReadonlyWorld, type State
} from '../../src/sim';
import { cachedBank } from '../bankCache';

/*
 * Knowledge across days (M5-03, §17.8, §18.2): the Blueprints and Guard rota assets, the intel a heist leaves for the
 * next in the same bank, and what the planning map may show of both.
 */

const bank = cachedBank({ layout: 31, population: 2, tier: 'small', archetype: 'twoWing' });
const options = planOptions(bank);
const { world: bare } = heistFromSetup(bank, defaultSetup(options));
const tiles = bare.width * bare.height;
const plan = (change: (s: HeistSetup) => void = () => {}, intel: Intel = {}): HeistSetup => {
    const s = defaultSetup(options, intel);
    change(s);
    return s;
};
const hidden = (v: Uint8Array) => v.reduce((n, c) => n + (VISIBILITY[c] === 'hidden' ? 1 : 0), 0);
const known = (world: ReadonlyWorld, state: State) => state.npcs.filter(n => markerKind(world, state, n.id) !== null).map(n => n.id).sort();
const all = (pick: (i: number) => boolean) => {
    const bits = new Uint8Array(tiles);
    for (let i = 0; i < tiles; i++) if (pick(i)) bits[i] = 1;
    return encodeBits(bits);
};
const guards = bare.people.filter(p => p.observer === 'enforcer').map(p => p.id);
const before = (change: (s: HeistSetup) => void) => heistFromSetup(bank, plan(change));
const staffSide = (i: number) => { const t = bare.tiles[i]!; return t.room !== null && t.zone !== 'public' && (bare.building ?? []).includes(t.room); };

describe('the intel assets (§18.2)', () => {
    it('cost what §18.2 says and are counted with the rest', () => {
        expect(ASSETS.blueprints).toMatchObject({ cost: 2000, favours: 1 });
        expect(ASSETS.guardRota).toMatchObject({ cost: 3000, favours: 1 });
        expect(spent(plan(s => { s.blueprints = true; s.guardRota = true; }))).toEqual({ cash: 5000, favours: 2 });
        // Known from an earlier heist, they are not bought again.
        expect(setupProblems(plan(s => { s.blueprints = true; }, { blueprints: true }), options)).toEqual(['The crew has the blueprints already']);
        expect(setupProblems(plan(s => { s.guardRota = true; }, { guardRota: true }), options)).toEqual(['The crew has the guard rota already']);
    });

    it('Blueprints: the whole layout is known from the start, and the planning map shows it', () => {
        const without = startView(bank, plan(), options), withIt = startView(bank, plan(s => { s.blueprints = true; }), options);
        expect(hidden(without.visibility)).toBeGreaterThan(0);
        expect(hidden(withIt.visibility)).toBe(0);
        const { world, state } = heistFromSetup(bank, plan(s => { s.blueprints = true; }));
        expect(world.intel).toEqual({ blueprints: true });
        expect(heistFromSetup(bank, plan()).world.intel).toEqual({});
        expect(state.knowledge.rooms).toEqual(before(s => { s.blueprints = false; }).state.knowledge.rooms);
        // The layout, never who is in it: the same NPCs as without.
        expect(Object.keys(withIt.npcs).sort()).toEqual(Object.keys(without.npcs).sort());
    });

    it('Guard rota: every guard is predicted from the start, and the planning map shows them', () => {
        const without = startView(bank, plan(), options), withIt = startView(bank, plan(s => { s.guardRota = true; }), options);
        expect(guards.length).toBeGreaterThan(0);
        for (const g of guards) expect(withIt.npcs[g]).toMatch(/live|predicted/);
        expect(Object.keys(withIt.npcs).filter(id => !guards.includes(id)).sort()).toEqual(Object.keys(without.npcs).filter(id => !guards.includes(id)).sort());
        // No room is shown by it: the layout stays as the blueprint has it.
        expect(withIt.visibility).toEqual(without.visibility);
    });

    it('a paid start still scouts nothing on the planning map, with intel too (decision 328)', () => {
        const intel: Intel = { routines: [guards[0]!] };
        const paid = plan(s => {
            s.nest = true;
            s.guardRota = true;
            for (const c of s.crew) c.start = c.id === 'sol' ? { at: 'nest' } : { at: 'van', aboard: true };
        }, intel);
        const view = startView(bank, paid, options);
        // Worked out apart: the same crew all in the van, nothing rented, the same intel and the rota.
        const free = heistFromSetup(bank, plan(s => {
            s.guardRota = true;
            for (const c of s.crew) c.start = { at: 'van', aboard: true };
        }, intel));
        expect(Object.keys(view.npcs).sort()).toEqual(known(free.world, free.state));
        expect([...view.visibility]).toEqual([...visibilityMap(free.world, free.state)]);
        // The heist itself, from the nest, knows more at once: what the map must not show before Start.
        const real = heistFromSetup(bank, paid);
        expect([...visibilityMap(real.world, real.state)]).not.toEqual([...view.visibility]);
        expect(free.world.intel).toEqual({ guardRota: true, routines: [guards[0]] });
    });
});

describe('intel across heists (M5-03)', () => {
    it('a heist leaves what it saw, the routines it learned and what it found', () => {
        const storage = new MemoryStorage();
        const session = startHeist(bank, storage, {}, plan());
        for (let i = 0; i < 4; i++) session.commit({ type: 'endTurn' });
        const intel = intelOf(session.world, session.state);
        expect(intel.seen).toBe(session.state.knowledge.seen);
        expect(intel.routines).toEqual(session.state.knowledge.routines ?? []);
        expect(loadIntel(storage, session.world)).toEqual(mergeIntel({}, intel, session.world));
        // The record is plain JSON of this bank, and reads as such.
        expect(intelProblem(JSON.parse(JSON.stringify(intel)), session.world)).toBeUndefined();
        expect(bankPrint(session.world)).toBe(bankPrint(options.world));
        // Resumed, the heist keeps adding to the same record.
        const resumed = Session.resume(storage)!;
        expect(intelKey(resumed.world)).toBe(intelKey(session.world));
    });

    it('the next heist starts knowing it: the layout seen, the routines, the finds; never who stands where', () => {
        const opportunity = opportunitiesOf(bare).find(o => o.id === 'keycard-drawer') ?? opportunitiesOf(bare)[0]!;
        const routine = bare.people.find(p => p.observer !== 'enforcer' && bare.tiles[p.pos.y * bare.width + p.pos.x]!.zone !== 'public')!;
        const intel: Intel = { seen: all(staffSide), routines: [routine.id], opportunities: [{ id: opportunity.id, how: 'read' }] };
        const { world, state } = heistFromSetup(bank, plan(() => {}, intel));
        const before = heistFromSetup(bank, plan());
        // The staff side is known (stale), not hidden, and its cameras with it; no feed status.
        for (let i = 0; i < tiles; i++) if (staffSide(i)) expect(tileVisibility(world, state, { x: i % world.width, y: Math.floor(i / world.width) })).not.toBe('hidden');
        expect(state.knowledge.cameras.length).toBeGreaterThanOrEqual(before.state.knowledge.cameras.length);
        expect(state.knowledge.cctv).toBe(false);
        // Only the routine learned shows besides what the starts see: the staff side's people stay unknown.
        expect(known(world, state)).toEqual([...new Set([...known(before.world, before.state), routine.id])].sort());
        expect(markerKind(world, state, routine.id)).toMatch(/live|predicted/);
        // The find is in the journal from the start.
        expect(state.opportunitiesFound).toEqual([{ id: opportunity.id, how: 'read', turn: 0 }]);
        expect(state.knowledge.routines).toEqual([routine.id]);
        // And the heist's own intel holds it all again.
        const after = intelOf(world, state);
        const seenAfter = decodeBits(after.seen!, tiles), seenBefore = decodeBits(intel.seen!, tiles);
        expect(seenBefore.every((v, i) => !v || seenAfter[i] === 1)).toBe(true);
        expect(after.routines).toEqual([routine.id]);
        expect(after.opportunities).toEqual(intel.opportunities);
    });

    it("the CCTV room cased before tells nothing of today's feeds until it is seen again", () => {
        // A bank with a CCTV room (the pinned small one has none).
        const big = cachedBank({ layout: 7, population: 3 }), opts = planOptions(big), w = opts.world;
        const desk = w.objects.find(o => o.kind === 'cctvDesk')!;
        expect(desk?.room).toBeTruthy();
        const bits = new Uint8Array(w.width * w.height);
        w.tiles.forEach((t, i) => { if (t.room === desk.room) bits[i] = 1; });
        const { world, state } = heistFromSetup(big, defaultSetup(opts, { seen: encodeBits(bits) }), opts);
        expect(state.knowledge.rooms).toContain(desk.room);
        expect(state.knowledge.cctv).toBe(false);
        // A turn later, from the van, still not.
        expect(commit(world, state, { type: 'endTurn' }).state.knowledge.cctv).toBe(false);
    });

    it('previews still agree with the outcome on a heist that starts with intel', () => {
        const intel: Intel = { seen: all(() => true), routines: guards.slice(0, 1), blueprints: true };
        const { world, state } = heistFromSetup(bank, plan(s => { s.guardRota = true; }, intel));
        const wait = { type: 'wait' as const, crew: 'mara' };
        expect(preview(world, state, wait).state).toEqual(commit(world, state, wait).state);
        // A move as far as Mara goes through tiles the intel knows only as stale: the preview is the outcome.
        const mara = state.crew.find(c => c.id === 'mara')!, reach = reachable(world, crewPicture(world, state), mara.pos, dashBudget(world), { mover: 'mara' });
        const far = [...reach.tiles].filter(t => t.canEnd && tileVisibility(world, state, t.pos) === 'stale').sort((a, b) => b.cost - a.cost)[0]!;
        const move = { type: far.cost > moveBudget(world, mara) ? 'dash' as const : 'move' as const, crew: 'mara', path: pathTo(reach, far.pos)! };
        expect(move.path.length).toBeGreaterThan(1);
        const previewed = preview(world, state, move), done = commit(world, state, move);
        expect(previewed.state).toEqual(done.state);
        expect(done.state.crew.find(c => c.id === 'mara')!.pos).toEqual(far.pos);
    });

    it('the address is never a source of intel: only what this device keeps for the bank counts', () => {
        const forged = plan(s => { s.intel = { blueprints: true, guardRota: true, seen: all(() => true), routines: bare.people.map(p => p.id) }; });
        const text = JSON.stringify(forged);
        // Nothing kept: the claim is ignored, and the heist starts knowing nothing it didn't pay for here.
        const setup = setupFromAddress(text, options, {})!;
        expect(setup.intel).toEqual({});
        expect(heistFromSetup(bank, setup).world.intel).toEqual({});
        // What is kept is what counts, whatever the address says.
        const kept: Intel = { routines: [guards[0]!] };
        expect(setupFromAddress(text, options, kept)!.intel).toEqual(kept);
        // Assets bought in the plan are paid in it.
        expect(spent(setupFromAddress(JSON.stringify(plan(s => { s.blueprints = true; })), options, {})!)).toEqual({ cash: 2000, favours: 1 });
        expect(setupFromAddress('{', options, {})).toBeUndefined();
    });

    it('only a planned heist, once its first turn is played, adds to the bank\'s intel', () => {
        const storage = new MemoryStorage();
        const unplanned = startHeist(bank, storage);
        unplanned.commit({ type: 'endTurn' });
        expect(storage.get(intelKey(unplanned.world))).toBeNull();
        const planned = startHeist(bank, storage, {}, plan());
        expect(storage.get(intelKey(planned.world))).toBeNull();
        planned.commit({ type: 'endTurn' });
        expect(loadIntel(storage, planned.world).seen).toBe(planned.state.knowledge.seen);
    });

    it('merges records: bought once, bought; every tile, routine and find of either, in order', () => {
        const a: Intel = { blueprints: true, seen: all(i => i % 2 === 0), routines: ['b'], opportunities: [{ id: 'x', how: 'read' }] };
        const b: Intel = { guardRota: true, seen: all(i => i % 3 === 0), routines: ['a', 'b'], opportunities: [{ id: 'y', how: 'overheard' }, { id: 'x', how: 'intel' }] };
        const m = mergeIntel(a, b, bare);
        expect(m.blueprints && m.guardRota).toBe(true);
        expect([...decodeBits(m.seen!, tiles)].every((v, i) => v === (i % 2 === 0 || i % 3 === 0 ? 1 : 0))).toBe(true);
        expect(m.routines).toEqual(['a', 'b']);
        expect(m.opportunities).toEqual([{ id: 'x', how: 'read' }, { id: 'y', how: 'overheard' }]);
        expect(noIntel({})).toBe(true);
        expect(noIntel({ seen: all(() => false) })).toBe(true);
        expect(noIntel(m)).toBe(false);
    });

    it("never reads another bank's record, nor one that isn't intel", () => {
        const storage = new MemoryStorage();
        recordIntel(storage, bare, { routines: [guards[0]!] });
        expect(loadIntel(storage, bare)).toEqual({ routines: [guards[0]] });
        const other = cachedBank({ layout: 32, population: 2, tier: 'small', archetype: 'twoWing' });
        expect(loadIntel(storage, planOptions(other).world)).toEqual({});
        storage.set(intelKey(bare), JSON.stringify({ routines: ['nobody'] }));
        expect(loadIntel(storage, bare)).toEqual({});
        expect(intelProblem({ seen: 'AAAA' }, bare)).toMatch(/this bank's/);
        expect(intelProblem({ opportunities: [{ id: 'nothing', how: 'read' }] }, bare)).toMatch(/isn't this bank's/);
        expect(intelProblem({ extra: 1 }, bare)).toMatch(/something else/);
        // A plan carrying such intel is sent back to planning.
        expect(setupProblems(plan(s => { s.intel = { routines: ['nobody'] }; }), options)[0]).toMatch(/The intel can't be read/);
    });

    it('the planning summary says only what the intel holds', () => {
        expect(intelSummary(bare, {})).toEqual({ blueprints: false, guardRota: false, rooms: 0, routines: [], finds: [] });
        const o = opportunitiesOf(bare)[0]!;
        const sum = intelSummary(bare, { guardRota: true, seen: all(staffSide), routines: [guards[0]!], opportunities: [{ id: o.id, how: 'overheard' }] });
        expect(sum.rooms).toBeGreaterThan(0);
        const g = bare.people.find(p => p.id === guards[0])!;
        expect(sum.routines).toEqual([{ id: g.id, name: g.name, role: g.role }]);
        expect(sum.finds).toEqual([{ id: o.id, text: o.text, how: 'overheard' }]);
    });
});
