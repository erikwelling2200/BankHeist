import { describe, expect, it } from 'vitest';
import { BANK_KEY, bankAddress, crewOrigin, M1_CREW, newHeist, playPlan, savedHeist, startHeist } from '../../src/game/heist';
import { crewCards, MemoryStorage, Session } from '../../src/game';
import { cachedBank } from '../bankCache';
import { reachable, tileAt } from '../../src/sim';
import { syncHands } from '../../src/sim/rules/hands';

const bank = cachedBank({ layout: 31, population: 2, tier: 'small', archetype: 'twoWing' });

describe('a heist in a generated bank', () => {
    it('starts the crew of two beside the van, on free tiles they can walk between', () => {
        const { world, state } = newHeist(bank);
        expect(state.crew.map(c => c.name)).toEqual(M1_CREW.map(c => c.name));
        const origin = crewOrigin(bank);
        for (const c of state.crew) {
            const tile = tileAt(world, c.pos)!;
            expect(tile.blocksMove).toBe(false);
            expect(tile.room).not.toBeNull();
            expect(Math.max(Math.abs(c.pos.x - origin.x), Math.abs(c.pos.y - origin.y))).toBeLessThan(8);
            expect(state.npcs.some(n => n.pos.x === c.pos.x && n.pos.y === c.pos.y)).toBe(false);
        }
        const [a, b] = state.crew;
        expect(a!.pos).not.toEqual(b!.pos);
        expect(reachable(world, state, a!.pos, 40, { mover: a!.id }).byIndex.has(b!.pos.y * world.width + b!.pos.x)).toBe(true);
        expect(state.npcs).toHaveLength(bank.people.length);
    });

    it('walks Mara in Clean and Jun Concealed with the hacking kit and the jammer (§3), as the crew cards show', () => {
        const { world, state } = newHeist(bank);
        const [mara, jun] = state.crew;
        expect(mara!.loadout.items).toEqual(['zipTies']);
        expect(jun!.loadout.items).toEqual(expect.arrayContaining(['pistol', 'hackingKit', 'jammer']));
        expect(crewCards(world, state, null).map(c => [c.id, c.profile, c.portrait])).toEqual([['mara', 'clean', 'mara'], ['jun', 'concealed', 'jun']]);
        // The cards follow the loadout: a mask (Heavy, the masked portrait), a loot bag (Armed, the bag badge).
        const changed = structuredClone(state);
        changed.crew[0]!.loadout.masked = true;
        // The bank's cash being counted, in Jun's hands.
        const bag = Object.keys(changed.loot).find(id => world.objects.find(o => o.id === id)!.loot!.weight === 'heavy')!;
        changed.loot[bag]!.holder = 'jun';
        changed.loot[bag]!.taken = true;
        syncHands(world, changed, changed.crew[1]!);
        expect(crewCards(world, changed, null).map(c => [c.profile, c.portrait, c.carrying])).toEqual([['heavy', 'mara-m', null], ['armed', 'jun', 'loot']]);
    });

    it('starts with what the crew sees fresh (decision 24), and resumes with the same fresh tiles', () => {
        const storage = new MemoryStorage();
        const session = startHeist(bank, storage), k = session.state.knowledge;
        expect(k.fresh).toBe(k.seen);
        expect(k.fresh).toMatch(/[^A]/);
        expect(Session.resume(storage)!.state.knowledge.fresh).toBe(k.fresh);
    });

    it('finds room for the crew in every tier and archetype', () => {
        for (const tier of ['small', 'city', 'hq'] as const) for (const archetype of ['twoWing', 'atrium', 'threeKeys', 'fortress', 'mezzanineWatch'] as const) {
            let generated;
            try { generated = cachedBank({ layout: 7, population: 1, tier, archetype }); } catch { continue; }
            expect(newHeist(generated).state.crew).toHaveLength(2);
        }
    }, 120000);

    it('remembers the bank of the saved heist, and plans resuming or asking before overwriting it', () => {
        const storage = new MemoryStorage();
        const here = bankAddress(bank);
        expect(playPlan(savedHeist(storage), { seeded: true, fresh: false }, here)).toBe('new');
        const session = startHeist(bank, storage);
        session.commit({ type: 'wait', crew: 'mara' });
        const saved = savedHeist(storage)!;
        expect(saved.address).toEqual(here);
        expect(saved.name).toBe(bank.name);
        expect(playPlan(saved, { seeded: false, fresh: false }, { ...here, seed: '1-1' })).toBe('resume');
        expect(playPlan(saved, { seeded: true, fresh: false }, here)).toBe('resume');
        expect(playPlan(saved, { seeded: true, fresh: false }, { ...here, seed: '1-1' })).toBe('ask');
        expect(playPlan(saved, { seeded: false, fresh: true }, here)).toBe('ask');
        expect(Session.resume(storage)!.state.crew[0]!.actionsLeft).toBe(0);
        storage.set(BANK_KEY, '{oops');
        expect(savedHeist(storage)).toEqual({ address: null, name: null });
    });
});
