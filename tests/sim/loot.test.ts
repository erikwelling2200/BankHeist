import { describe, expect, it } from 'vitest';
import {
    actionPreview, commit, crewBudget, deserialise, deserialiseState, mayBeDyed, serialise, serialiseState, crewLoot, crewThreat, dashRefusal, decodeBits, encodeBits, evidenceOnMap, fixtureWorld, initialState, legalActions, throwPlan, throwTargets,
    whyNot, type CrewStart, type FixtureWall, type PersonDef, type Pos, type ReadonlyWorld, type State, type WorldObject
} from '../../src/sim';
import { syncHands } from '../../src/sim/rules/hands';
import { step } from './helpers';

/*
 * Loot and carrying (M2-04; §15.1, §8.10): the movement penalties, pockets and hands, throwing, catching and chains,
 * passing (a crate, a body), dye packs, the Very heavy "pistol only", and a bag left on the floor as evidence.
 */

const P = (x: number, y: number): Pos => ({ x, y });

// A bank room (b) with the street (.) south of it, through a gap in the wall.
const FLOOR = ['bbbbbbbbbbbb', 'bbbbbbbbbbbb', 'bbbbbbbbbbbb', 'bbbbbbbbbbbb', '............', '............'];
const MAP = FLOOR.map(r => r.replace(/./g, '.'));

const loot = (id: string, pos: Pos, weight: 'light' | 'heavy' | 'very heavy', value: number, dyePack = false): WorldObject =>
    ({ id, kind: 'loot', pos, facing: 's', name: id, loot: { value, weight, ...(dyePack ? { dyePack: true as const } : {}) } });

const OBJECTS: WorldObject[] = [
    loot('drawer', P(1, 1), 'light', 5000, true),
    loot('drawer2', P(2, 1), 'light', 5000),
    loot('drawer3', P(3, 1), 'light', 5000),
    loot('bag', P(5, 1), 'heavy', 40000),
    loot('crate', P(8, 1), 'very heavy', 120000),
    loot('pc', P(10, 1), 'light', 0)
];

function setup(crew: CrewStart[], options: { walls?: FixtureWall[]; people?: PersonDef[]; map?: string[] } = {}): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(options.map ?? MAP, { rooms: FLOOR, objects: OBJECTS, walls: options.walls ?? [], people: options.people ?? [] });
    return { world, state: initialState(world, { seed: 3, crew }) };
}

const member = (state: State, id: string) => state.crew.find(c => c.id === id)!;
const run = (world: ReadonlyWorld, state: State, ...cmds: Parameters<typeof commit>[2][]): State => cmds.reduce((s, c) => step(world, s, c).state, state);

describe('the bank\'s loot', () => {
    it('leaves out what is behind the deposit boxes\' locks until M2-05', () => {
        const boxes: WorldObject = { id: 'boxes', kind: 'loot', pos: P(6, 1), facing: 's', loot: { value: 30000, weight: 'light', behind: 'depositBoxes' } };
        const world = fixtureWorld(MAP, { rooms: FLOOR, objects: [...OBJECTS, boxes] });
        expect(Object.hasOwn(initialState(world, { seed: 1, crew: [] }).loot, 'boxes')).toBe(false);
    });

    it('shows carried only what the hands hold: a save that says otherwise is refused', () => {
        const { world, state } = setup([{ id: 'mara', pos: P(5, 2) }]);
        const s = run(world, state, { type: 'takeLoot', crew: 'mara', loot: 'bag' });
        expect(deserialise(serialise({ genVersion: 'fixture', world, state: s })).state.crew[0]!.loadout.carrying).toBe('lootBag');
        const forged = { ...state, crew: state.crew.map(c => ({ ...c, loadout: { ...c.loadout, carrying: 'lootBag' } })) };
        expect(() => deserialise(serialise({ genVersion: 'fixture', world, state: forged }))).toThrow(/shows carrying 'lootBag' but holds nothing/);
        // An autosave's state, read with its world: a bag shown while only cash is pocketed is refused too.
        const cash = run(world, { ...state, crew: state.crew.map(c => ({ ...c, pos: P(2, 2) })) }, { type: 'takeLoot', crew: 'mara', loot: 'drawer2' });
        const pocketsOnly = { ...cash, crew: cash.crew.map(c => ({ ...c, loadout: { ...c.loadout, carrying: 'lootBag' } })) };
        expect(() => deserialiseState(serialiseState({ state: pocketsOnly }), world)).toThrow(/shows carrying 'lootBag' but holds nothing/);
        expect(deserialiseState(serialiseState({ state: cash }), world).state.loot.drawer2!.holder).toBe('mara');
    });

    it('is every loot object worth something, where the bank keeps it; a dye pack goes with its drawer', () => {
        const { state } = setup([{ id: 'mara', pos: P(1, 2) }]);
        expect(Object.keys(state.loot).sort()).toEqual(['bag', 'crate', 'drawer', 'drawer2', 'drawer3']);
        expect(state.loot.drawer).toEqual({ holder: null, pos: P(1, 1), taken: false, dyePack: true, inspected: false, ruined: false });
        expect(state.loot.bag!.dyePack).toBe(false);
    });
});

describe('carrying (the movement penalties)', () => {
    it('Light: pocketed, up to 2 stacks, no penalty, no change of profile', () => {
        const { world, state } = setup([{ id: 'mara', pos: P(2, 2) }]);
        const s = run(world, state, { type: 'takeLoot', crew: 'mara', loot: 'drawer' }, { type: 'takeLoot', crew: 'mara', loot: 'drawer2' });
        const mara = member(s, 'mara');
        expect(mara.loadout.carrying).toBeNull();
        expect(crewBudget(world, mara, 'move')).toBe(crewBudget(world, member(state, 'mara'), 'move'));
        const next = { ...s, crew: s.crew.map(c => ({ ...c, actionsLeft: 2 })) };
        expect(whyNot(world, next, { type: 'takeLoot', crew: 'mara', loot: 'drawer3' })).toBe("mara's pockets are full");
        expect(dashRefusal(world, next, 'mara')).toBeNull();
    });

    it('Heavy: in the hands (Armed), −2 tiles a Move, no Dash', () => {
        const { world, state } = setup([{ id: 'mara', pos: P(5, 2) }, { id: 'dex', pos: P(6, 2), items: ['heavyArmour'] }]);
        const s = run(world, state, { type: 'takeLoot', crew: 'mara', loot: 'bag' });
        const mara = member(s, 'mara');
        expect(mara.loadout.carrying).toBe('lootBag');
        // Half-steps: 5 tiles are 10, 3 tiles 6.
        expect(crewBudget(world, mara, 'move')).toBe(6);
        expect(dashRefusal(world, { ...s, crew: s.crew.map(c => ({ ...c, actionsLeft: 2 })) }, 'mara')).toBe("mara can't dash carrying a bag");
        // A move of 4 tiles is now too far; 3 are fine.
        expect(() => commit(world, s, { type: 'move', crew: 'mara', path: [P(4, 2), P(3, 2), P(2, 2), P(1, 2)] })).toThrow();
        expect(commit(world, s, { type: 'move', crew: 'mara', path: [P(4, 2), P(3, 2), P(2, 2)] }).state.crew[0]!.pos).toEqual(P(2, 2));
        // Heavy armour and a bag: 4 − 2 tiles.
        const armoured = run(world, s, { type: 'pass', crew: 'mara', to: 'dex' });
        expect(crewBudget(world, member(armoured, 'dex'), 'move')).toBe(4);
    });

    it('Very heavy: half a Move (a Bruiser one tile less), no Dash, a pistol only', () => {
        const { world, state } = setup([
            { id: 'mara', pos: P(8, 2), items: ['assaultRifle', 'pistol'] },
            { id: 'bo', pos: P(7, 2), traits: ['bruiser'], items: ['machinePistol', 'taser'] }
        ]);
        expect(crewThreat(member(state, 'mara'))).toBe(5);
        const s = run(world, state, { type: 'takeLoot', crew: 'mara', loot: 'crate' });
        const mara = member(s, 'mara');
        expect(mara.loadout.carrying).toBe('lootCrate');
        expect(crewBudget(world, mara, 'move')).toBe(5);
        expect(crewThreat(mara)).toBe(3);
        expect(dashRefusal(world, { ...s, crew: s.crew.map(c => ({ ...c, actionsLeft: 2 })) }, 'mara')).toBe("mara can't dash carrying a crate");
        const passed = run(world, s, { type: 'pass', crew: 'mara', to: 'bo' });
        expect(passed.loot.crate!.holder).toBe('bo');
        expect(member(passed, 'mara').loadout.carrying).toBeNull();
        expect(crewBudget(world, member(passed, 'bo'), 'move')).toBe(8);
        expect(crewThreat(member(passed, 'mara'))).toBe(5);
        // "Pistol only" (§15.1): not a machine pistol or a taser.
        expect(crewThreat(member(state, 'bo'))).toBe(4);
        expect(crewThreat(member(passed, 'bo'))).toBe(1);
    });

    it('hands hold one thing: a bag, a crate or a body', () => {
        const { world, state } = setup([{ id: 'mara', pos: P(6, 2) }]);
        const s = run(world, state, { type: 'takeLoot', crew: 'mara', loot: 'bag' }, { type: 'move', crew: 'mara', path: [P(7, 2)] });
        expect(whyNot(world, { ...s, crew: s.crew.map(c => ({ ...c, actionsLeft: 2 })) }, { type: 'takeLoot', crew: 'mara', loot: 'crate' })).toBe("mara's hands are full");
        expect(s.loot.bag!.holder).toBe('mara');
    });
});

describe('taking loot', () => {
    it('from where the bank keeps it is theft (§8.4); off the floor it isn\'t', () => {
        const guard: PersonDef = { id: 'guard', name: 'guard', role: 'guard', observer: 'enforcer', pos: P(5, 3), facing: 'n', schedule: [] };
        const { world, state } = setup([{ id: 'mara', pos: P(5, 2) }], { people: [guard] });
        const r = commit(world, state, { type: 'takeLoot', crew: 'mara', loot: 'bag' });
        expect(r.events.some(e => e.type === 'exposed' && e.npc === 'guard')).toBe(true);
        const quiet = setup([{ id: 'mara', pos: P(5, 2) }]);
        const took = commit(quiet.world, quiet.state, { type: 'takeLoot', crew: 'mara', loot: 'bag' });
        expect(took.undoable).toBe(true);
        const dropped = run(quiet.world, took.state, { type: 'dropLoot', crew: 'mara' });
        expect(dropped.loot.bag).toMatchObject({ holder: null, pos: P(5, 2), taken: true });
        const again = commit(quiet.world, { ...dropped, crew: dropped.crew.map(c => ({ ...c, actionsLeft: 2 })) }, { type: 'takeLoot', crew: 'mara', loot: 'bag' });
        expect(again.state.loot.bag!.holder).toBe('mara');
    });

    it('needs the loot in reach', () => {
        const { world, state } = setup([{ id: 'mara', pos: P(5, 3) }]);
        expect(whyNot(world, state, { type: 'takeLoot', crew: 'mara', loot: 'bag' })).toBe("mara can't reach it from here");
    });
});

describe('throwing and catching', () => {
    it('lands up to 2 tiles away (Euclidean), over low furniture, not through walls or over tall things', () => {
        const map = MAP.map((r, y) => (y === 2 ? r.slice(0, 4) + '#' + r.slice(5) : y === 1 ? r.slice(0, 7) + 'T' + r.slice(8) : r));
        const { world, state } = setup([{ id: 'mara', pos: P(5, 2) }], { map, walls: [{ between: [P(5, 2), P(5, 3)] }] });
        const s = run(world, state, { type: 'takeLoot', crew: 'mara', loot: 'bag' });
        const targets = throwTargets(world, s, 'mara').map(p => `${p.x},${p.y}`);
        // Over the desk at (4, 2), never onto it.
        expect(targets).toContain('3,2');
        expect(targets).not.toContain('4,2');
        expect(targets).toContain('6,1');
        // (7, 2) is two tiles east; (7, 1) is tall; (6, 3) is behind the wall south.
        expect(targets).toContain('7,2');
        expect(targets).not.toContain('7,1');
        expect(targets).not.toContain('5,3');
        expect(targets).not.toContain('5,4');
        // (7, 3) is √5 away.
        expect(targets).not.toContain('7,3');
        const r = commit(world, s, { type: 'throwLoot', crew: 'mara', to: P(7, 2) });
        expect(r.state.loot.bag).toMatchObject({ holder: null, pos: P(7, 2) });
        expect(member(r.state, 'mara').loadout.carrying).toBeNull();
        expect(r.events.find(e => e.type === 'lootThrown')).toEqual({ type: 'lootThrown', crew: 'mara', loot: 'bag', from: P(5, 2), to: P(7, 2), caughtBy: null });
    });

    it('a teammate with free hands where it lands catches it, and throws it on: a chain', () => {
        const { world, state } = setup([{ id: 'mara', pos: P(5, 2) }, { id: 'jun', pos: P(5, 4) }, { id: 'dex', pos: P(5, 5) }]);
        let s = run(world, state, { type: 'takeLoot', crew: 'mara', loot: 'bag' });
        const plan = throwPlan(world, s, { crew: 'mara', to: P(5, 4) });
        expect(plan).toEqual({ loot: 'bag', from: P(5, 2), to: P(5, 4), catcher: 'jun' });
        const shown = actionPreview(world, s, { type: 'throwLoot', crew: 'mara', to: P(5, 4) });
        const r = commit(world, s, { type: 'throwLoot', crew: 'mara', to: P(5, 4) });
        expect(shown.ok && shown.events).toEqual(r.events);
        s = r.state;
        expect(s.loot.bag!.holder).toBe('jun');
        expect(member(s, 'jun').loadout.carrying).toBe('lootBag');
        expect(member(s, 'jun').actionsLeft).toBe(2);
        s = run(world, s, { type: 'throwLoot', crew: 'jun', to: P(5, 5) });
        expect(s.loot.bag!.holder).toBe('dex');
        // Full hands don't catch: it lands at their feet.
        const full = { ...s, loot: { ...s.loot, crate: { ...s.loot.crate!, holder: 'mara', taken: true } } };
        syncHands(world, full, member(full, 'mara'));
        expect(member(full, 'mara').loadout.carrying).toBe('lootCrate');
        expect(throwPlan(world, full, { crew: 'dex', to: P(5, 3) })).toMatchObject({ catcher: null });
    });

    it('never past a door the crew can\'t vouch for, whichever way it stands (decision 44)', () => {
        const { world, state } = setup([{ id: 'mara', pos: P(5, 2) }], { walls: [{ between: [P(5, 3), P(5, 4)], door: { id: 'gate', start: 'closed' } }] });
        const s = run(world, { ...state, doors: { gate: { status: 'open' } } }, { type: 'takeLoot', crew: 'mara', loot: 'bag' });
        expect(throwPlan(world, s, { crew: 'mara', to: P(5, 4) })).toMatchObject({ to: P(5, 4) });
        // Neither side of the door seen this turn.
        const k = s.knowledge, fresh = decodeBits(k.fresh, world.width * world.height);
        for (const p of [P(5, 3), P(5, 4)]) fresh[p.y * world.width + p.x] = 0;
        const doubted = { ...s, knowledge: { ...k, fresh: encodeBits(fresh), doors: { ...k.doors, gate: 'closed' as const } } };
        for (const status of ['open', 'closed'] as const) {
            const real = { ...doubted, doors: { ...doubted.doors, gate: { status } } };
            expect(throwPlan(world, real, { crew: 'mara', to: P(5, 4) })).toBe("mara can't see the door the bag would fly through");
            expect(throwTargets(world, real, 'mara').some(p => p.y === 4)).toBe(false);
        }
    });

    it('only a bag flies: a crate is passed, Light loot stays pocketed', () => {
        const { world, state } = setup([{ id: 'mara', pos: P(8, 2) }]);
        const s = run(world, state, { type: 'takeLoot', crew: 'mara', loot: 'crate' });
        expect(whyNot(world, s, { type: 'throwLoot', crew: 'mara', to: P(8, 3) })).toBe('Only a bag can be thrown: pass a crate to a teammate');
        expect(legalActions(world, s, 'mara').some(c => c.type === 'throwLoot')).toBe(false);
    });
});

describe('a body passed', () => {
    it('goes to a teammate in reach with free hands, and is dragging seen on both', () => {
        const victim: PersonDef = { id: 'teller', name: 'teller', role: 'teller', observer: 'staff', pos: P(4, 2), facing: 'n', schedule: [] };
        const { world, state } = setup([{ id: 'mara', pos: P(3, 2) }, { id: 'jun', pos: P(2, 2) }], { people: [victim] });
        const down = { ...state, npcs: state.npcs.map(n => ({ ...n, status: 'unconscious' as const, outCold: 4 })) };
        const s = run(world, down, { type: 'drag', crew: 'mara', npc: 'teller' }, { type: 'pass', crew: 'mara', to: 'jun' });
        expect(member(s, 'jun')).toMatchObject({ dragging: 'teller', loadout: { carrying: 'body' } });
        expect(member(s, 'mara')).toMatchObject({ dragging: null, loadout: { carrying: null } });
        expect(crewBudget(world, member(s, 'jun'), 'move')).toBe(5);
    });
});

describe('dye packs', () => {
    it('burst once the cash leaves the building, unless it was inspected', () => {
        const { world, state } = setup([{ id: 'mara', pos: P(1, 2) }]);
        const s = run(world, state, { type: 'takeLoot', crew: 'mara', loot: 'drawer' });
        const out = commit(world, s, { type: 'move', crew: 'mara', path: [P(1, 3), P(1, 4), P(1, 5)] });
        expect(out.events.filter(e => e.type === 'dyePackBurst')).toEqual([{ type: 'dyePackBurst', crew: 'mara', loot: 'drawer', at: P(1, 4) }]);
        expect(out.state.loot.drawer).toMatchObject({ ruined: true, dyePack: false });
        expect(crewLoot(world, out.state)).toEqual({ carried: 0, ruined: 5000 });
        expect(out.undoable).toBe(false);
        // The move's preview doesn't tell, but it says the cash might be dyed, and that the move is final.
        const shown = actionPreview(world, s, { type: 'move', crew: 'mara', path: [P(1, 3), P(1, 4), P(1, 5)] });
        expect(shown.ok && shown.events.some(e => e.type === 'dyePackBurst')).toBe(false);
        expect(shown).toMatchObject({ ok: true, undoable: false, mayBeDyed: ['drawer'] });
        // Clean cash it can't tell from dyed: the same preview, and the commit is final too.
        const clean2 = run(world, state, { type: 'takeLoot', crew: 'mara', loot: 'drawer2' });
        const plain = actionPreview(world, clean2, { type: 'move', crew: 'mara', path: [P(1, 3), P(1, 4), P(1, 5)] });
        expect(plain).toMatchObject({ ok: true, undoable: false, mayBeDyed: ['drawer2'] });
        expect(commit(world, clean2, { type: 'move', crew: 'mara', path: [P(1, 3), P(1, 4), P(1, 5)] }).undoable).toBe(false);
        // A ruined stack can be put down, freeing the pocket; cash that isn't can't.
        expect(whyNot(world, out.state, { type: 'dropLoot', crew: 'mara', loot: 'drawer' })).toBe('mara has 0 of 1 actions left');
        const rested = { ...out.state, crew: out.state.crew.map(c => ({ ...c, actionsLeft: 2 })) };
        expect(run(world, rested, { type: 'dropLoot', crew: 'mara', loot: 'drawer' }).loot.drawer).toMatchObject({ holder: null, pos: P(1, 5) });
        expect(whyNot(world, { ...clean2, crew: clean2.crew.map(c => ({ ...c, actionsLeft: 2 })) }, { type: 'dropLoot', crew: 'mara', loot: 'drawer2' })).toBe('Cash stays in the pocket');
        // Inspected first: found and taken out, and the cash leaves clean.
        const looked = commit(world, s, { type: 'inspectLoot', crew: 'mara', loot: 'drawer' });
        expect(looked.events.map(e => e.type)).toEqual(expect.arrayContaining(['lootInspected', 'dyePackFound']));
        const clean = commit(world, { ...looked.state, crew: looked.state.crew.map(c => ({ ...c, actionsLeft: 2 })) }, { type: 'move', crew: 'mara', path: [P(1, 3), P(1, 4)] });
        expect(clean.events.some(e => e.type === 'dyePackBurst' || e.type === 'cashOut')).toBe(false);
        expect(crewLoot(world, clean.state)).toEqual({ carried: 5000, ruined: 0 });
        const inspectShown = actionPreview(world, s, { type: 'inspectLoot', crew: 'mara', loot: 'drawer' });
        expect(inspectShown.ok && inspectShown.events.map(e => e.type)).toEqual(['lootInspected']);
    });
});

describe('dye packs stay secret', () => {
    const zigzag = [P(1, 4), P(1, 3), P(1, 4), P(1, 3), P(1, 4)];
    const carrying = (loot: string) => {
        const { world, state } = setup([{ id: 'mara', pos: P(1, 2) }]);
        const s = run(world, state, { type: 'takeLoot', crew: 'mara', loot });
        return { world, state: { ...s, crew: s.crew.map(c => ({ ...c, pos: P(1, 3), actionsLeft: 2 })) } };
    };

    it('in a preview of any path: dyed and clean cash read the same, out, in and out again', () => {
        const dyed = carrying('drawer'), clean = carrying('drawer2');
        const a = actionPreview(dyed.world, dyed.state, { type: 'move', crew: 'mara', path: zigzag });
        const b = actionPreview(clean.world, clean.state, { type: 'move', crew: 'mara', path: zigzag });
        expect(JSON.stringify(a).replaceAll('drawer2', 'drawer')).toBe(JSON.stringify(b).replaceAll('drawer2', 'drawer'));
        expect(a.ok && a.events.filter(e => e.type === 'cashOut').length).toBe(1);
        // And in what the commit shows: one way out each, a burst only for the dyed.
        const ra = commit(dyed.world, dyed.state, { type: 'move', crew: 'mara', path: zigzag });
        const rb = commit(clean.world, clean.state, { type: 'move', crew: 'mara', path: zigzag });
        expect(ra.events.filter(e => e.type === 'cashOut').length).toBe(1);
        expect(rb.events.filter(e => e.type === 'cashOut').length).toBe(1);
        expect(ra.state.loot.drawer!.ruined).toBe(true);
    });

    it('cash that left the building without bursting is known clean: later ways out aren\'t final', () => {
        const { world, state } = carrying('drawer2');
        const out = commit(world, state, { type: 'move', crew: 'mara', path: [P(1, 4)] }).state;
        expect(out.loot.drawer2).toMatchObject({ inspected: true, ruined: false });
        expect(mayBeDyed(world, out, 'drawer2')).toBe(false);
        const back = commit(world, out, { type: 'move', crew: 'mara', path: [P(1, 3)] }).state;
        const again = { ...back, crew: back.crew.map(c => ({ ...c, actionsLeft: 2 })) };
        expect(commit(world, again, { type: 'move', crew: 'mara', path: [P(1, 4)] }).events.some(e => e.type === 'cashOut')).toBe(false);
    });

    it('only matter in a bank with dye packs', () => {
        const world = fixtureWorld(MAP, { rooms: FLOOR, objects: OBJECTS.map(o => (o.id === 'drawer' ? loot('drawer', P(1, 1), 'light', 5000) : o)) });
        const s = run(world, initialState(world, { seed: 3, crew: [{ id: 'mara', pos: P(1, 2) }] }), { type: 'takeLoot', crew: 'mara', loot: 'drawer' });
        expect(mayBeDyed(world, s, 'drawer')).toBe(false);
        const shown = actionPreview(world, s, { type: 'move', crew: 'mara', path: [P(1, 3), P(1, 4)] });
        expect(shown.ok && shown.events.some(e => e.type === 'cashOut')).toBe(false);
        expect(shown).not.toHaveProperty('mayBeDyed');
    });
});

describe('a bag on the floor', () => {
    it('is an unattended loot bag (major evidence) once no crew member is beside it', () => {
        const { world, state } = setup([{ id: 'mara', pos: P(5, 2) }]);
        const s = run(world, state, { type: 'takeLoot', crew: 'mara', loot: 'bag' }, { type: 'throwLoot', crew: 'mara', to: P(7, 2) });
        expect(evidenceOnMap(world, s).filter(e => e.kind === 'lootBag')).toEqual([{ id: 'loot:bag', kind: 'lootBag', tiles: [P(7, 2)] }]);
        const near = { ...s, crew: s.crew.map(c => ({ ...c, pos: P(6, 2) })) };
        expect(evidenceOnMap(world, near).some(e => e.kind === 'lootBag')).toBe(false);
        // Loot still where the bank keeps it is not evidence.
        expect(evidenceOnMap(world, state).some(e => e.kind === 'lootBag')).toBe(false);
    });
});
