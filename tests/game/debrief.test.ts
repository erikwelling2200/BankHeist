import { describe, expect, it } from 'vitest';
import { commitCampaign, newCampaign, type Campaign } from '../../src/campaign';
import { campaignCrew, campaignKeeper, campaignProblem, loadCampaign, saveCampaign } from '../../src/game/campaign';
import { startHeist } from '../../src/game/heist';
import { campaignPrint } from '../../src/game/intel';
import { defaultSetup, planOptions } from '../../src/game/plan';
import { MemoryStorage } from '../../src/game';
import { heistReport } from '../../src/sim';
import { cachedBank } from '../bankCache';

/*
 * The debrief in the game (M6-05): the keeper sends the rules' report with the heist's end (and with every save, for an
 * abandoned heist), the campaign keeps the debrief, and the save checks it.
 */

const bank = cachedBank({ layout: 31, population: 2, tier: 'small', archetype: 'twoWing' });
const options = planOptions(bank);

/** A campaign whose day 1 is a low-stakes heist in the M1 bank, saved, and its session. */
function played() {
    const storage = new MemoryStorage();
    let c = newCampaign(7);
    const pool = campaignCrew(c, 'low'), setup = defaultSetup(options, {}, pool);
    const offer = c.contracts.find(k => k.stakes === 'low')!;
    c = commitCampaign(c, { kind: 'heist', bank: campaignPrint(options.world), contract: offer.id, job: { crew: setup.crew.map(m => m.id), kits: Object.fromEntries(setup.crew.map(m => [m.id, []])), stakes: 'low' } }).campaign;
    saveCampaign(storage, c);
    const tag = { seed: c.seed, day: 1 };
    const session = startHeist(bank, storage, { keepIntel: campaignKeeper(storage, tag) }, setup, tag, pool);
    return { storage, tag, session, crew: setup.crew.map(m => m.id) };
}

describe("the heist's report to the campaign", () => {
    it("sends the styles and who a living witness saw, and the campaign's debrief and Notoriety follow", () => {
        const { storage, tag, session, crew } = played();
        const s = session.state, witness = s.npcs.find(n => n.status !== 'dead')!;
        const ended = {
            ...s,
            crew: [],
            escaped: s.crew.map(m => ({ crew: m, vehicle: 'van', turn: 4 })),
            record: { ...s.record, witnesses: [{ npc: witness.id, crew: 'mara' }] },
            outcome: { result: 'success', turn: 4, vehicle: 'van', escaped: crew, arrested: [], dead: [], loot: [], value: 200000, ruined: 0, target: 75000, heat: 0 }
        } as typeof s;
        const report = heistReport(session.world, ended);
        expect(report).toEqual({ styles: ['ghost', 'cleanHands', 'smoothOperator', 'greedy'], witnessed: ['mara'], filmed: [] });
        campaignKeeper(storage, tag)(session.world, ended);
        const c = loadCampaign(storage)!;
        expect(c.debrief).toMatchObject({ day: 1, result: 'success', take: 200000, styleBonus: 4 * 20000 });
        expect(c.debrief!.styles.map(x => x.style)).toEqual(report.styles);
        expect(c.debrief!.crew.find(m => m.id === 'mara')).toMatchObject({ witnessed: true, notoriety: 1, gained: 1 });
        expect(c.roster.find(m => m.id === 'mara')!.notoriety).toBe(1);
        expect(c.styles.low).toEqual(report.styles);
    });

    it("keeps an unfinished heist's report on the visit, for an abandoned heist", () => {
        const { storage, tag, session } = played();
        const s = session.state, witness = s.npcs.find(n => n.status !== 'dead')!;
        campaignKeeper(storage, tag)(session.world, { ...s, record: { ...s.record, witnesses: [{ npc: witness.id, crew: 'jun' }] } } as typeof s);
        expect(loadCampaign(storage)!.visit!.report).toMatchObject({ witnessed: ['jun'] });
    });
});

describe('the save of the debrief', () => {
    it('refuses styles paid twice, a debrief that does not add up, and a report that is none', () => {
        const { storage, tag, session } = played();
        const s = session.state;
        campaignKeeper(storage, tag)(session.world, { ...s, outcome: { result: 'partial', turn: 4, vehicle: 'van', escaped: ['mara'], arrested: [], dead: [], loot: [], value: 1000, ruined: 0, target: 75000, heat: 0 } } as typeof s);
        const c = loadCampaign(storage)!;
        expect(c.debrief).not.toBeNull();
        expect(campaignProblem(c)).toBeUndefined();
        const broken = (change: (v: Campaign) => void): string | undefined => {
            const v = structuredClone(c);
            change(v);
            return campaignProblem(v);
        };
        expect(broken(v => { v.styles.low = ['ghost', 'ghost']; })).toBe('the styles paid are not styles');
        expect(broken(v => { delete (v.styles as Partial<Campaign['styles']>).high; })).toBe('the styles paid are not styles');
        expect(broken(v => { v.debrief!.styleBonus += 1; })).toBe("the debrief's styles don't add up");
        expect(broken(v => { v.debrief!.styles.push({ style: 'ghost', reward: 'money', amount: 0 }); })).toBe("the debrief's styles are not styles");
        expect(broken(v => { v.debrief!.day = v.day; })).toBe('the debrief is of no heist');
        expect(broken(v => { v.debrief!.crew[0]!.fate = 'gone' as never; })).toBe("the debrief's crew are no crew");
        expect(broken(v => { (v.debrief as unknown as Record<string, unknown>).extra = 1; })).toBe('a debrief with other fields');
        expect(broken(v => { v.visit!.report = { styles: ['nope'], witnessed: [], filmed: [] } as never; })).toBe("the visit's report is none");
    });
});
