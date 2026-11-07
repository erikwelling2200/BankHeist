import { describe, expect, it } from 'vitest';
import { botSetup, BOT_CREW, playBot } from '../../src/game/bot';
import { heistFromSetup } from '../../src/game/plan';
import type { GenerateOptions } from '../../src/gen/generate';
import { tileAt } from '../../src/sim';
import { cachedBank } from '../bankCache';

/*
 * The playability bot (M5-05, decisions 420–424): a Clean infiltrator playing from the heist's real start on what the
 * crew knows. It must reach the alarm closet or the CCTV room unexposed in these banks: the pinned M1 bank and a few
 * the sweep finds it gets through, with the Blueprints (§18.2) and without.
 */

/** `PLAY_BANK` in src/boot.ts. */
const PLAY: GenerateOptions = { layout: 31, population: 2, tier: 'small', archetype: 'twoWing' };

const WITH_BLUEPRINTS: GenerateOptions[] = [
    PLAY,
    { layout: 1000, population: 0, tier: 'small', archetype: 'fortress', plot: 'midBlock' },
    { layout: 1000, population: 0, tier: 'city', archetype: 'mezzanineWatch', plot: 'midBlock' },
    { layout: 1000, population: 0, tier: 'hq', archetype: 'mezzanineWatch', plot: 'plazaFront' }
];

const COLD: GenerateOptions[] = [{ layout: 1000, population: 0, tier: 'hq', archetype: 'mezzanineWatch', plot: 'midBlock' }];

const name = (o: GenerateOptions) => `${o.layout}-${o.population} ${o.tier} ${o.archetype}${o.plot ? ` ${o.plot}` : ''}`;

describe('the playability bot (M5-05)', { timeout: 120000 }, () => {
    it('starts as a planned heist does: one Clean crew member on foot by the van, outside the bank', () => {
        const bank = cachedBank(PLAY), { state } = heistFromSetup(bank, botSetup(bank));
        expect(state.crew.map(c => c.id)).toEqual([BOT_CREW]);
        const jun = state.crew[0]!;
        expect(jun.loadout.items).toEqual(['zipTies', 'lockpick', 'hackingKit']);
        expect(jun.keycards).toEqual([]);
        const room = bank.rooms.find(r => r.id === tileAt(heistFromSetup(bank, botSetup(bank)).world, jun.pos)?.room);
        expect(room?.bank).toBeFalsy();
    });

    for (const options of WITH_BLUEPRINTS) {
        it(`gets to the alarm closet or the CCTV room unexposed with the Blueprints: ${name(options)}`, () => {
            const run = playBot(cachedBank(options), { blueprints: true });
            expect(run.ok, `${run.why}\n${run.log.join(' | ')}`).toBe(true);
            expect(['alarmCloset', 'cctvRoom']).toContain(run.goal);
        });
    }

    for (const options of COLD) {
        it(`gets there unexposed knowing only the public floor, exploring the rest: ${name(options)}`, () => {
            const run = playBot(cachedBank(options));
            expect(run.ok, `${run.why}\n${run.log.join(' | ')}`).toBe(true);
        });
    }

    it('plays the same every time', () => {
        const bank = cachedBank(PLAY);
        expect(playBot(bank)).toEqual(playBot(bank));
    });
});
