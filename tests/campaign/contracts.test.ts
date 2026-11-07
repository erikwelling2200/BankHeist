import { describe, expect, it } from 'vitest';
import {
    BONUS, campaignRefusal, CHAINS, commitCampaign, CONTRACT_DAYS, FIRST_CONTRACT, MAX_ESCALATION, newCampaign, OBJECTIVE_KINDS, OBJECTIVE_OFFERS, sharesOf, STAKES,
    STAKES_TIER, type Campaign, type CampaignCommand, type Job, type Stakes
} from '../../src/campaign';
import { ARCHETYPES, PLOTS } from '../../src/gen/model';
import { TIER_SPECS } from '../../src/gen/tiers';

/*
 * Contracts (M6-02, GAME_DESIGN §19.3, §19.5): the board by stakes, refreshing and expiring with the days, chain
 * escalation, the client's bonus and side objectives. A heist is only ever an offered contract's.
 */

const job = (stakes: Stakes): Job => ({ crew: ['mara', 'jun'], kits: { mara: [], jun: [] }, stakes });
const offer = (c: Campaign, stakes: Stakes) => c.contracts.find(k => k.stakes === stakes)!;
const heist = (c: Campaign, stakes: Stakes, bank = 'b'): CampaignCommand => ({ kind: 'heist', bank, contract: offer(c, stakes).id, job: job(stakes) });
const step = (c: Campaign, cmd: CampaignCommand): Campaign => commitCampaign(c, cmd).campaign;
const layLow = (c: Campaign, n = 1): Campaign => {
    for (let i = 0; i < n; i++) c = step(c, { kind: 'layLow' });
    return c;
};

describe('the board (§19.3)', () => {
    it('offers one contract per stakes, the first low one the M1 bank, the rest drawn from the seed', () => {
        const c = newCampaign(7);
        expect(c.contracts.map(k => k.stakes)).toEqual(STAKES);
        expect(offer(c, 'low')).toEqual(FIRST_CONTRACT);
        expect(newCampaign(7).contracts).toEqual(c.contracts);
        expect(newCampaign(8).contracts.slice(1)).not.toEqual(c.contracts.slice(1));
        for (const k of c.contracts) expect(k.bank.tier).toBe(STAKES_TIER[k.stakes]);
    });

    it('refreshes as the days pass: expired offers go, each stakes gets a new one, every offer a real bank', () => {
        let c = newCampaign(3);
        const ids = new Set(c.contracts.map(k => k.id));
        for (let day = 2; day <= 18; day++) {
            c = layLow(c);
            expect(c.day).toBe(day);
            expect(c.contracts.map(k => k.stakes)).toEqual(STAKES);
            for (const k of c.contracts) {
                expect(k.posted).toBeLessThanOrEqual(day);
                expect(k.expires).toBeGreaterThanOrEqual(day);
                expect(k.expires - k.posted + 1).toBeLessThanOrEqual(CONTRACT_DAYS[1]);
                expect(k.bank.tier).toBe(STAKES_TIER[k.stakes]);
                expect(ARCHETYPES).toContain(k.bank.archetype);
                expect(k.bank.archetype === 'mezzanineWatch' && !TIER_SPECS[k.bank.tier].operator).toBe(false);
                expect(PLOTS).toContain(k.bank.plot);
                expect(k.bank.seed).toMatch(/^\d+-\d+$/);
                expect(CHAINS).toContain(k.chain);
                expect(k.bonus).toBeGreaterThanOrEqual(BONUS[k.stakes][0]);
                expect(k.bonus).toBeLessThanOrEqual(BONUS[k.stakes][1]);
                expect(k.bonus % 5000).toBe(0);
                ids.add(k.id);
            }
        }
        // Some expired untaken along the way: more offers were posted than the three of day 1.
        expect(ids.size).toBeGreaterThan(6);
    });

    it('is the same whatever is done that spends no day: shopping, the fence, intel bought', () => {
        const c = newCampaign(5);
        const shopped = step(step(c, { kind: 'buy', item: 'medkit' }), { kind: 'buyIntel', bank: 'b', asset: 'guardRota', cost: 3000, favours: 1 });
        expect(shopped.contracts).toEqual(c.contracts);
        expect(layLow(shopped).contracts).toEqual(layLow(c).contracts);
    });
});

describe('a heist is an offered contract', () => {
    it('is refused without one on the board, at other stakes, or taken twice (another tab)', () => {
        const c = newCampaign(1);
        expect(campaignRefusal(c, { kind: 'heist', bank: 'b', contract: 'd9-high', job: job('high') })).toBe('Not on offer');
        expect(campaignRefusal(c, { kind: 'heist', bank: 'b', contract: '', job: job('low') })).toBe('Not on offer');
        expect(campaignRefusal(c, { kind: 'heist', bank: 'b', contract: offer(c, 'low').id, job: job('high') })).toBe("Not the contract's stakes");
        expect(campaignRefusal(c, heist(c, 'high'))).toBeUndefined();
        const taken = step(c, heist(c, 'low'));
        expect(taken.contracts.map(k => k.stakes)).toEqual(['low', 'medium', 'high']);
        expect(taken.contracts.some(k => k.id === FIRST_CONTRACT.id)).toBe(false);
        expect(taken.visit?.contract).toEqual(FIRST_CONTRACT);
        // Day 2: the same contract can't be taken again.
        expect(campaignRefusal(taken, { kind: 'heist', bank: 'b', contract: FIRST_CONTRACT.id })).toBe('Not on offer');
    });

    it('expires: the last day it can be taken is its own', () => {
        let c = newCampaign(1);
        c = layLow(c, 2);
        expect(offer(c, 'low').id).toBe(FIRST_CONTRACT.id);
        c = layLow(c);
        expect(c.contracts.some(k => k.id === FIRST_CONTRACT.id)).toBe(false);
    });

    it('abandoned, gives nothing back: the contract stays taken', () => {
        const c = newCampaign(1), id = offer(c, 'medium').id;
        const left = layLow(step(c, heist(c, 'medium')));
        expect(left.visit).toBeNull();
        expect(left.contracts.some(k => k.id === id)).toBe(false);
    });
});

describe('chain escalation (§19.3)', () => {
    it("puts the chain's other branches a security step up, the board's and those posted later, to at most the cap", () => {
        let c = newCampaign(1);
        const chain = offer(c, 'low').chain;
        // The other offers made of the same chain, to see them escalate.
        c = { ...c, contracts: c.contracts.map(k => ({ ...k, chain })) };
        c = step(c, heist(c, 'low'));
        expect(c.hits).toEqual({ [chain]: 1 });
        expect(c.contracts.filter(k => k.posted === 1).map(k => k.escalation)).toEqual([1, 1]);
        // A new branch of the chain is posted on guard already.
        for (let i = 0; i < 20 && c.phase === 'open'; i++) {
            for (const k of c.contracts) if (k.chain === chain) expect(k.escalation).toBe(Math.min(MAX_ESCALATION, c.hits[chain]!));
            const next = c.contracts.find(k => k.chain === chain);
            c = next ? step(c, { kind: 'heist', bank: 'b', contract: next.id }) : layLow(c);
        }
        expect(c.hits[chain]!).toBeGreaterThan(MAX_ESCALATION);
    });
});

describe('the payout (§19.3, §19.4)', () => {
    const withBonus = (result: 'success' | 'partial' | 'failure') => {
        const c = newCampaign(1), k = offer(c, 'medium');
        const r = commitCampaign(step(c, heist(c, 'medium')), { kind: 'heistOver', day: 1, result, take: 100000 });
        return { k, r };
    };

    it("pays the client's bonus on a Success, once, the crew taking their shares of it", () => {
        const { k, r } = withBonus('success');
        const shares = sharesOf(100000 + k.bonus, ['mara', 'jun'], r.campaign.shares);
        expect(r.events).toContainEqual({ type: 'paid', day: 1, take: 100000, bonus: k.bonus, shares, dirty: 100000 + k.bonus - shares });
        expect(r.campaign.visit?.payout).toBe(100000 + k.bonus - shares);
        expect(campaignRefusal(r.campaign, { kind: 'heistOver', day: 1, result: 'success', take: 100000 })).toBe('The heist is over already');
    });

    it('pays no bonus on a Partial, and nothing on a failure', () => {
        expect(withBonus('partial').r.events).toContainEqual(expect.objectContaining({ type: 'paid', bonus: 0 }));
        expect(withBonus('failure').r.campaign.money.dirty).toBe(0);
    });
});

describe('side objectives (§19.5)', () => {
    /** A campaign whose medium offer holds `objective`. */
    const holding = (objective: (typeof OBJECTIVE_KINDS)[number]): Campaign => {
        const c = newCampaign(1);
        return { ...c, contracts: c.contracts.map(k => (k.stakes === 'medium' ? { ...k, objective } : k)) };
    };

    it("count once the carrier gets out, even on a failed job; only the contract's own, and once", () => {
        let c = holding('blackmail');
        c = step(c, heist(c, 'medium'));
        const r = commitCampaign(c, { kind: 'heistOver', day: 1, result: 'failure', objectives: ['blackmail', 'halfCode'] });
        expect(r.campaign.advantages).toEqual(['blackmail']);
        expect(r.events).toContainEqual({ type: 'objective', objective: 'blackmail', day: 1 });
        // Not brought out: nothing.
        let d = holding('blueprints');
        d = step(d, heist(d, 'medium'));
        expect(step(d, { kind: 'heistOver', day: 1, result: 'success', take: 0, objectives: [] }).advantages).toEqual([]);
    });

    it('are never offered while one is on the board or once had, and counted as offered', () => {
        for (const seed of [1, 2, 3, 4]) {
            let c = newCampaign(seed);
            const seen: Record<string, number> = {};
            const posted = new Set<string>();
            for (let i = 0; i < 18 && c.phase === 'open'; i++) {
                const on = c.contracts.flatMap(k => (k.objective ? [k.objective] : []));
                expect(new Set(on).size).toBe(on.length);
                for (const k of c.contracts) {
                    if (!k.objective || posted.has(k.id)) continue;
                    posted.add(k.id);
                    seen[k.objective] = (seen[k.objective] ?? 0) + 1;
                }
                // Take whichever offer holds one, and bring it out.
                const holds = c.contracts.find(k => k.objective);
                if (holds) {
                    c = step(c, { kind: 'heist', bank: 'b', contract: holds.id });
                    c = step(c, { kind: 'heistOver', day: c.day - 1, result: 'success', take: 0, objectives: [holds.objective!] });
                    for (const k of c.contracts) expect(c.advantages).not.toContain(k.objective);
                } else c = layLow(c);
            }
            expect(c.objectiveOffers).toEqual(seen);
        }
    });

    it('missed twice (let expire or left in the bank), one is never offered a third time', () => {
        // Every objective is missed: the offers holding one are let expire, or taken and the objective left behind.
        // Over a whole campaign there are more offers with an objective than the kinds' two chances each, so the cap bites.
        let capped = 0;
        for (const seed of [1, 2, 3, 4, 5, 6]) {
            let c = newCampaign(seed);
            const offers: Record<string, string[]> = {};
            const posted = new Set<string>();
            let missedByHeist = false;
            for (let i = 0; i < 30 && c.phase === 'open'; i++) {
                for (const k of c.contracts) {
                    if (!k.objective || posted.has(k.id)) continue;
                    posted.add(k.id);
                    (offers[k.objective] ??= []).push(k.id);
                    // Never a third offer of the same objective.
                    expect(offers[k.objective]!.length).toBeLessThanOrEqual(OBJECTIVE_OFFERS);
                }
                const holds = c.contracts.find(k => k.objective);
                if (holds && !missedByHeist && c.squeeze < 30) {
                    // Taken once, and the objective left in the bank: missed.
                    missedByHeist = true;
                    c = step(c, { kind: 'heist', bank: 'b', contract: holds.id });
                    c = step(c, { kind: 'heistOver', day: c.day - 1, result: 'success', take: 0, objectives: [] });
                } else c = layLow(c);
            }
            expect(c.advantages).toEqual([]);
            capped += Object.values(offers).filter(ids => ids.length === OBJECTIVE_OFFERS).length;
        }
        // The cap was reached (and so tested) more than once.
        expect(capped).toBeGreaterThan(2);
    });
});
