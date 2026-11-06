import { describe, expect, it } from 'vitest';
import { generateBank } from '../src/gen/generate';
import { initialState, worldFromBank } from '../src/sim';

/*
 * M5-04's hook for side objectives (§19.5, src/gen/objectives.ts): a contract's objectives are placed after the
 * furnishing, so the bank is the same with or without them, and the rules carry them as loot.
 */

describe('side objectives', { timeout: 60000 }, () => {
    it('go into a deposit box or the manager\'s office, and change nothing else', () => {
        const opts = { layout: 4242, population: 7, tier: 'city' as const, archetype: 'twoWing' as const };
        const plain = generateBank(opts), withThem = generateBank({ ...opts, objectives: ['blueprints', 'blackmail'] });
        expect(withThem.props).toEqual(plain.props);
        expect(withThem.people).toEqual(plain.people);
        const extra = withThem.loot.slice(plain.loot.length);
        expect(withThem.loot.slice(0, plain.loot.length)).toEqual(plain.loot);
        const room = (id: string) => withThem.rooms.find(r => r.id === id)!.type;
        expect(extra.map(l => [l.objective, room(l.room), l.behind ?? null, l.lostOnAlarm ?? false, l.value, l.weight])).toEqual([
            ['blueprints', 'depositBoxes', 'depositBoxes', false, 0, 'light'],
            ['blackmail', 'managerOffice', null, true, 0, 'light']
        ]);
        const world = worldFromBank(withThem), state = initialState(world, { seed: 1, crew: [] });
        const objectives = world.objects.filter(o => o.loot?.objective !== undefined);
        expect(objectives.map(o => [o.loot!.objective, o.loot!.behind ?? null])).toEqual([['blackmail', null], ['blueprints', 'depositBox']]);
        // The files are loot from the start; the blueprints once their box is opened.
        expect(objectives.map(o => Object.hasOwn(state.loot, o.id))).toEqual([true, false]);
    });

    it('in a bank without a deposit room, go to the manager\'s office', () => {
        const bank = generateBank({ layout: 77, population: 3, tier: 'small', objectives: ['chiefDirt'] });
        const l = bank.loot.find(x => x.objective === 'chiefDirt')!;
        expect(bank.rooms.find(r => r.id === l.room)!.type).toBe('managerOffice');
        expect(l.behind).toBeUndefined();
    });
});
