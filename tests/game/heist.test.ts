import { describe, expect, it } from 'vitest';
import { crewOrigin, M1_CREW, newHeist, playHeist } from '../../src/game/heist';
import { MemoryStorage } from '../../src/game';
import { generateBank } from '../../src/gen/generate';
import { reachable, tileAt } from '../../src/sim';

const bank = generateBank({ layout: 31, population: 2, tier: 'small', archetype: 'twoWing' });

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

    it('finds room for the crew in every tier and archetype', () => {
        for (const tier of ['small', 'city', 'hq'] as const) for (const archetype of ['twoWing', 'atrium', 'threeKeys', 'fortress', 'mezzanineWatch'] as const) {
            let generated;
            try { generated = generateBank({ layout: 7, population: 1, tier, archetype }); } catch { continue; }
            expect(newHeist(generated).state.crew).toHaveLength(2);
        }
    }, 120000);

    it('resumes the heist of the same bank, and starts afresh for another bank or when asked', () => {
        const storage = new MemoryStorage();
        const first = playHeist(bank, storage).session;
        expect(playHeist(bank, storage).resumed).toBe(true);
        first.commit({ type: 'wait', crew: 'mara' });
        const again = playHeist(bank, storage);
        expect(again.resumed).toBe(true);
        expect(again.session.state.crew[0]!.actionsLeft).toBe(0);
        expect(playHeist(bank, storage, { fresh: true }).resumed).toBe(false);
        const other = generateBank({ layout: 32, population: 2, tier: 'small', archetype: 'twoWing' });
        expect(playHeist(other, storage).resumed).toBe(false);
    });
});
