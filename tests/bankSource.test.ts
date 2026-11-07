import { describe, expect, it, vi } from 'vitest';
import { generateFromParams } from '../src/bankSource';
import type { GenerateOptions } from '../src/gen/generate';
import type { GeneratedBank } from '../src/gen/model';

/*
 * The bank the address names (src/bankSource.ts): picks that can't go together are dropped in the sandbox, a side
 * objective with no place in the bank included (the M6-02 review: `?view&…&objectives=blackmail` threw uncaught); a
 * contract's bank keeps its terms.
 */

/** A generator that can't place blackmail, and can't build the tier `small` with the archetype `mezzanineWatch`. */
function fake(): { generate: (o: GenerateOptions) => GeneratedBank; calls: GenerateOptions[] } {
    const calls: GenerateOptions[] = [];
    return {
        calls,
        generate: o => {
            calls.push(o);
            if (o.objectives?.includes('blackmail')) throw new Error("No place for the side objective 'blackmail': the bank has no manager's desk");
            if (o.tier === 'small' && o.archetype === 'mezzanineWatch') throw new Error('No operator');
            return { seed: { layout: o.layout, population: o.population } } as GeneratedBank;
        }
    };
}

describe('the address\'s bank', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    it('in the viewer, drops a side objective the bank has no place for, keeping the other picks', () => {
        const params = new URLSearchParams('view&seed=12-3&tier=city&objectives=blackmail');
        const { generate, calls } = fake();
        expect(generateFromParams(params, generate).seed).toEqual({ layout: 12, population: 3 });
        expect(calls.at(-1)).toMatchObject({ tier: 'city' });
        expect(calls.at(-1)!.objectives).toBeUndefined();
        expect(params.has('objectives')).toBe(false);
        expect(params.get('tier')).toBe('city');
    });

    it('drops the tier and then the objective when neither fits', () => {
        const params = new URLSearchParams('view&seed=12-3&tier=small&archetype=mezzanineWatch&objectives=blackmail');
        const { generate, calls } = fake();
        generateFromParams(params, generate);
        expect(calls).toHaveLength(4);
        expect(params.has('tier')).toBe(false);
        expect(params.has('objectives')).toBe(false);
    });

    it("keeps a contract's terms on the campaign's pages: that bank or none", () => {
        const params = new URLSearchParams('plan&campaign&contract=d1-low&seed=12-3&tier=city&objectives=blackmail');
        const { generate, calls } = fake();
        expect(() => generateFromParams(params, generate)).toThrow(/manager's desk/);
        expect(calls.every(o => o.objectives?.includes('blackmail'))).toBe(true);
        expect(params.get('objectives')).toBe('blackmail');
    });
});
