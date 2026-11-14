import { describe, expect, it } from 'vitest';
import {
    campaignRefusal, commitCampaign, crewMember, newCampaign, SQUEEZE, STYLE_BONUS, type Campaign, type CampaignCommand, type CampaignEvent, type CrewFates, type Job, type Stakes
} from '../../src/campaign';
import { deserialiseCampaign, serialiseCampaign } from '../../src/game/campaign';
import type { HeistReport, StyleId } from '../../src/sim';

/*
 * The debrief (M6-05, GAME_DESIGN §15.5, §19.7, §19.8): styles paid once per stakes, Notoriety from witnesses and the
 * tape, and the debrief kept for the last heist.
 */

const step = (c: Campaign, cmd: CampaignCommand): Campaign => commitCampaign(c, cmd).campaign;
const job = (crew: string[], stakes: Stakes): Job => ({ crew, kits: Object.fromEntries(crew.map(id => [id, []])), stakes });
const fates = (f: Partial<CrewFates>): CrewFates => ({ escaped: [], arrested: [], dead: [], downed: [], killers: [], ...f });
const report = (r: Partial<HeistReport>): HeistReport => ({ styles: [], witnessed: [], filmed: [], ...r });
const roundTrips = (c: Campaign): void => expect(deserialiseCampaign(serialiseCampaign(c))).toEqual(c);

/** Lays low until the board has an offer at `stakes`. */
function offering(c: Campaign, stakes: Stakes): Campaign {
    for (let i = 0; i < 20 && !c.contracts.some(k => k.stakes === stakes); i++) c = step(c, { kind: 'layLow' });
    if (!c.contracts.some(k => k.stakes === stakes)) throw new Error(`No ${stakes} offer`);
    return c;
}

interface Ending { result?: 'success' | 'partial' | 'failure'; take?: number; stakes?: Stakes; crew?: string[]; f?: Partial<CrewFates>; r?: Partial<HeistReport>; objectives?: string[] }

/** The day's heist on the offer at its stakes, ended as `e` says (by default: Mara and Jun got away with $100k, a partial). */
function heist(c: Campaign, e: Ending = {}): { campaign: Campaign; events: CampaignEvent[] } {
    const stakes = e.stakes ?? 'low', crew = e.crew ?? ['mara', 'jun'];
    c = offering(c, stakes);
    const offer = c.contracts.find(k => k.stakes === stakes)!;
    const started = step(c, { kind: 'heist', bank: 'b', contract: offer.id, job: job(crew, stakes) });
    return commitCampaign(started, {
        kind: 'heistOver', day: started.visit!.day, result: e.result ?? 'partial', take: e.take ?? 100000, crew: fates(e.f ?? { escaped: crew }), report: report(e.r ?? {}),
        ...(e.objectives ? { objectives: e.objectives } : {})
    });
}

describe('styles (§19.8)', () => {
    it('pay a share of the take each, once per stakes, after the crew have taken theirs', () => {
        const styles: StyleId[] = ['ghost', 'cleanHands'];
        const first = heist(newCampaign(1), { r: { styles } });
        const d = first.campaign.debrief!;
        const each = (100000 * STYLE_BONUS) / 100;
        expect(d.styles).toEqual(styles.map(style => ({ style, reward: 'money', amount: each })));
        expect(d.styleBonus).toBe(2 * each);
        // Mara 10% and Jun 8% of the take, not of the styles' bonus.
        expect(d.shares).toBe(18000);
        expect(d.payout).toBe(100000 - 18000 + 2 * each);
        expect(first.campaign.money.dirty).toBe(d.payout);
        expect(first.events).toContainEqual({ type: 'paid', day: d.day, take: 100000, bonus: 0, shares: 18000, styles: 2 * each, dirty: d.payout });
        expect(first.campaign.styles.low).toEqual(styles);
        roundTrips(first.campaign);

        // Again at low stakes: listed, paid before, nothing more. At medium stakes: paid again.
        const again = heist(first.campaign, { r: { styles: ['ghost', 'greedy'] } });
        expect(again.campaign.debrief!.styles).toEqual([{ style: 'ghost', reward: 'paidBefore', amount: 0 }, { style: 'greedy', reward: 'money', amount: each }]);
        const medium = heist(again.campaign, { stakes: 'medium', crew: ['mara', 'jun', 'dex'], r: { styles: ['ghost'] } });
        expect(medium.campaign.debrief!.styles).toEqual([{ style: 'ghost', reward: 'money', amount: each }]);
        expect(medium.campaign.styles).toEqual({ low: ['ghost', 'cleanHands', 'greedy'], medium: ['ghost'], high: [] });
    });

    it('pay a contact each on a high-stakes job', () => {
        const done = heist(newCampaign(1), { stakes: 'high', crew: ['mara', 'jun', 'dex', 'sol'], result: 'partial', r: { styles: ['cowboys', 'fortress'] } });
        expect(done.campaign.debrief!.styles).toEqual([{ style: 'cowboys', reward: 'contact', amount: 0 }, { style: 'fortress', reward: 'contact', amount: 0 }]);
        expect(done.campaign.contacts).toBe(2);
        expect(done.campaign.debrief).toMatchObject({ contacts: 2, styleBonus: 0 });
        expect(done.events.filter(e => e.type === 'style')).toHaveLength(2);
    });

    it('pay nothing on a failure, and a style with nothing to pay is not used up', () => {
        const failed = heist(newCampaign(1), { result: 'failure', take: 0, f: { arrested: ['mara', 'jun'] }, r: { styles: ['ghost'] } });
        expect(failed.campaign.debrief).toMatchObject({ result: 'failure', styles: [], payout: 0 });
        expect(failed.campaign.styles.low).toEqual([]);
        const empty = heist(newCampaign(1), { take: 0, r: { styles: ['ghost'] } });
        expect(empty.campaign.debrief!.styles).toEqual([{ style: 'ghost', reward: 'nothing', amount: 0 }]);
        expect(empty.campaign.styles.low).toEqual([]);
    });

    it('refuse a report that is not one', () => {
        let c = offering(newCampaign(1), 'low');
        c = step(c, { kind: 'heist', bank: 'b', contract: c.contracts.find(k => k.stakes === 'low')!.id, job: job(['mara', 'jun'], 'low') });
        const over = (r: unknown): CampaignCommand => ({ kind: 'heistOver', day: c.visit!.day, result: 'partial', report: r as HeistReport });
        expect(campaignRefusal(c, over({ styles: ['ghost', 'ghost'], witnessed: [], filmed: [] }))).toBe('No report');
        expect(campaignRefusal(c, over({ styles: ['speedrun'], witnessed: [], filmed: [] }))).toBe('No report');
        expect(campaignRefusal(c, over({ styles: [], witnessed: [1], filmed: [] }))).toBe('No report');
        expect(campaignRefusal(c, over(report({})))).toBeUndefined();
        expect(campaignRefusal(c, { kind: 'learn', bank: 'b', day: c.visit!.day, intel: {}, report: { styles: [] } as never })).toBe('No report');
    });
});

describe('Notoriety from witnesses and the tape (§19.7)', () => {
    it('adds a point for a witness who lived and one for the tape, each gainer a point of Squeeze', () => {
        const done = heist(newCampaign(1), { crew: ['mara', 'jun'], r: { witnessed: ['mara', 'jun'], filmed: ['mara'] } });
        const c = done.campaign;
        expect(crewMember(c, 'mara')!.notoriety).toBe(2);
        expect(crewMember(c, 'jun')!.notoriety).toBe(1);
        expect(done.events.filter(e => e.type === 'squeeze' && e.source === 'notoriety')).toHaveLength(2);
        expect(c.debrief!.crew).toEqual([
            { id: 'mara', name: 'Mara', fate: 'escaped', injured: 0, witnessed: true, filmed: true, notoriety: 2, gained: 2 },
            { id: 'jun', name: 'Jun', fate: 'escaped', injured: 0, witnessed: true, filmed: false, notoriety: 1, gained: 1 }
        ]);
        expect(c.debrief!.squeeze).toBe(2 * SQUEEZE.notoriety);
    });

    it('adds them to the arrest as one gain (the Forgettable halve the whole), capped at 5; the dead gain none', () => {
        let c = newCampaign(1);
        c = { ...c, roster: c.roster.map(m => (m.id === 'jun' ? { ...m, traits: [...m.traits, 'forgettable' as const] } : m)) };
        const done = heist(c, {
            crew: ['mara', 'jun', 'dex'], stakes: 'medium', f: { escaped: ['dex', 'jun'], arrested: ['mara'] }, r: { witnessed: ['mara', 'jun', 'dex'], filmed: ['mara', 'jun', 'dex'] }
        });
        // Mara, arrested: 2 + 1 + 1. Jun, Forgettable: (1 + 1) / 2, not half of each. Dex: 1 + 1.
        expect(['mara', 'jun', 'dex'].map(id => crewMember(done.campaign, id)!.notoriety)).toEqual([4, 1, 2]);
        const capped = heist({ ...newCampaign(1), roster: newCampaign(1).roster.map(m => ({ ...m, notoriety: m.id === 'mara' ? 4 : 0 })) },
            { f: { arrested: ['mara'], escaped: ['jun'] }, r: { witnessed: ['mara'] } });
        expect(crewMember(capped.campaign, 'mara')!.notoriety).toBe(5);
        expect(capped.campaign.debrief!.crew[0]).toMatchObject({ fate: 'arrested', notoriety: 5, gained: 1 });
        const dead = heist(newCampaign(1), { f: { dead: ['mara'], escaped: ['jun'] }, r: { witnessed: ['mara'], filmed: ['mara'] } });
        expect(crewMember(dead.campaign, 'mara')!.notoriety).toBe(0);
        expect(dead.campaign.debrief!.crew[0]).toMatchObject({ fate: 'dead', witnessed: false, filmed: false, gained: 0 });
    });

    it('stands for an abandoned heist, as its last save had it', () => {
        let c = offering(newCampaign(1), 'low');
        c = step(c, { kind: 'heist', bank: 'b', contract: c.contracts.find(k => k.stakes === 'low')!.id, job: job(['mara', 'jun'], 'low') });
        c = step(c, { kind: 'learn', bank: 'b', day: c.visit!.day, intel: {}, crew: fates({ downed: ['jun'] }), report: report({ styles: ['ghost'], filmed: ['mara'] }) });
        const left = step(c, { kind: 'layLow' });
        expect(crewMember(left, 'mara')!.notoriety).toBe(1);
        expect(left.debrief).toMatchObject({ abandoned: true, result: 'failure', styles: [], payout: 0 });
        expect(left.debrief!.crew.map(m => [m.id, m.fate, m.filmed, m.injured])).toEqual([['mara', 'left', true, 0], ['jun', 'left', false, 3]]);
        roundTrips(left);
    });
});

describe('the debrief (§15.5, UI.md)', () => {
    it("tells the contract, its side objective, each crew member's fate and injury, and is kept until the next heist ends", () => {
        let c = newCampaign(1);
        // Find an offer that holds a side objective, laying low as needed.
        for (let i = 0; i < 30 && !c.contracts.some(k => k.objective); i++) c = step(c, { kind: 'layLow' });
        const offer = c.contracts.find(k => k.objective)!;
        expect(offer).toBeDefined();
        const done = heist(c, {
            stakes: offer.stakes, crew: offer.stakes === 'low' ? ['mara', 'jun'] : offer.stakes === 'medium' ? ['mara', 'jun', 'dex'] : ['mara', 'jun', 'dex', 'sol'], result: 'success',
            f: { escaped: ['mara', 'jun', 'dex', 'sol'], downed: ['jun'] }, objectives: [offer.objective!]
        });
        const d = done.campaign.debrief!;
        expect(d.contract).toEqual(offer);
        expect(d.objective).toEqual({ kind: offer.objective, out: true });
        expect(d.bonus).toBe(offer.bonus);
        expect(d.payout).toBe(d.take + d.bonus - d.shares + d.styleBonus);
        expect(d.crew.find(m => m.id === 'jun')).toMatchObject({ fate: 'escaped', injured: 3 });
        // Days pass: still the last heist's debrief.
        const later = step(step(done.campaign, { kind: 'layLow' }), { kind: 'layLow' });
        expect(later.debrief).toEqual(d);
        roundTrips(later);
    });
});
