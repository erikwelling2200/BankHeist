import { describe, expect, it } from 'vitest';
import {
    campaignRefusal, commitCampaign, CREW_BY_STAKES, crewMember, DEBT, drawRecruits, INJURY_DAYS, LAWYER_COST, LAWYER_DAYS, newCampaign, RECRUIT_LOOKS, RECRUITS_A_DAY,
    recruitLook, ROSTER_MAX, settleFinaleMotives, SIGNING_FEE, SQUEEZE, talks, TRAIT_CHOICES, type Campaign, type CampaignCommand, type CampaignEvent, type CrewFates,
    type CrewMember, type Job, type Stakes
} from '../../src/campaign';
import { deserialiseCampaign, serialiseCampaign } from '../../src/game/campaign';
import { TRAITS } from '../../src/sim';

/*
 * The roster (M6-04, GAME_DESIGN §19.6, §19.7): recruits, crew size by stakes, injuries, jail and a prisoner who talks,
 * death, trait growth, Notoriety and its decay, and motives.
 */

const step = (c: Campaign, cmd: CampaignCommand): Campaign => commitCampaign(c, cmd).campaign;
const run = (c: Campaign, ...cmds: CampaignCommand[]): { campaign: Campaign; events: CampaignEvent[] } => {
    const events: CampaignEvent[] = [];
    for (const cmd of cmds) {
        const done = commitCampaign(c, cmd);
        c = done.campaign;
        events.push(...done.events);
    }
    return { campaign: c, events };
};
const layLow = (c: Campaign, n = 1): Campaign => {
    for (let i = 0; i < n; i++) c = step(c, { kind: 'layLow' });
    return c;
};
const member = (c: Campaign, id: string): CrewMember => crewMember(c, id) as CrewMember;
const job = (crew: string[], stakes: Stakes): Job => ({ crew, kits: Object.fromEntries(crew.map(id => [id, []])), stakes });
const fates = (f: Partial<CrewFates>): CrewFates => ({ escaped: [], arrested: [], dead: [], downed: [], killers: [], ...f });
/** The day's heist on the offer at `stakes` with `crew`, ended with `f`. */
function heist(c: Campaign, crew: string[], f: Partial<CrewFates>, result: 'success' | 'partial' | 'failure' = 'partial', stakes: Stakes = 'low'): { campaign: Campaign; events: CampaignEvent[] } {
    const offer = c.contracts.find(k => k.stakes === stakes)!;
    const started = step(c, { kind: 'heist', bank: 'b', contract: offer.id, job: job(crew, stakes) });
    return commitCampaign(started, { kind: 'heistOver', day: c.day, result, take: 0, crew: fates(f) });
}
const roundTrips = (c: Campaign): void => expect(deserialiseCampaign(serialiseCampaign(c))).toEqual(c);

describe('the roster a campaign starts with', () => {
    it('is the four of §3 with their traits and shares, unknown, ready, and no motive', () => {
        const c = newCampaign(1);
        expect(c.roster.map(m => [m.id, m.share, m.traits])).toEqual([
            ['mara', 10, ['smoothTalker']], ['jun', 8, ['steadyHands']], ['dex', 10, ['intimidating', 'bruiser']], ['sol', 12, ['marksman']]
        ]);
        expect(c.roster.every(m => m.notoriety === 0 && m.status === 'ready' && m.motive === null && m.jobs === 0)).toBe(true);
        roundTrips(c);
    });
});

describe('recruits (§19.6)', () => {
    it('are three a day from the seed and the day: one trait, a motive, a share of 8–20% and a fee of $10–30k', () => {
        const day1 = drawRecruits(5, 1);
        expect(day1).toHaveLength(RECRUITS_A_DAY);
        expect(drawRecruits(5, 1)).toEqual(day1);
        expect(drawRecruits(5, 2)).not.toEqual(day1);
        expect(drawRecruits(6, 1)).not.toEqual(day1);
        for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) for (const r of drawRecruits(seed, 3)) {
            expect(TRAITS).toContain(r.trait);
            expect(r.share).toBeGreaterThanOrEqual(8);
            expect(r.share).toBeLessThanOrEqual(20);
            expect(r.fee % 5000).toBe(0);
            expect(r.fee).toBeGreaterThanOrEqual(SIGNING_FEE[0]);
            expect(r.fee).toBeLessThanOrEqual(SIGNING_FEE[1]);
            expect(RECRUIT_LOOKS).toContain(r.look);
            expect(r.look).toBe(recruitLook(r.id));
            if (r.motive.kind === 'debt') expect(r.motive.amount).toBeGreaterThanOrEqual(DEBT[0]);
        }
        expect(new Set(day1.map(r => r.name)).size).toBe(RECRUITS_A_DAY);
    });

    it('join for their fee, with no time spent, once; never another day\'s, nor past the roster\'s room or the money', () => {
        const c = { ...newCampaign(5), money: { clean: 100000, dirty: 0 } }, r = drawRecruits(5, 1)[0]!;
        const { campaign: d, events } = run(c, { kind: 'recruit', id: r.id });
        expect(d.day).toBe(1);
        expect(d.money.clean).toBe(100000 - r.fee);
        expect(events).toContainEqual({ type: 'spent', on: 'recruit', amount: r.fee, clean: 100000 - r.fee });
        expect(member(d, r.id)).toMatchObject({ name: r.name, traits: [r.trait], share: r.share, motive: r.motive, notoriety: 0, status: 'ready' });
        expect(campaignRefusal(d, { kind: 'recruit', id: r.id })).toBe('Hired already');
        expect(campaignRefusal(c, { kind: 'recruit', id: drawRecruits(5, 2)[0]!.id })).toBe('Not on offer');
        expect(campaignRefusal({ ...c, money: { clean: r.fee - 1, dirty: 0 } }, { kind: 'recruit', id: r.id })).toBe('Not enough money');
        const full = { ...c, roster: [...c.roster, ...[1, 2, 3, 4].map(i => ({ ...c.roster[0]!, id: `x${i}` }))] };
        expect(full.roster).toHaveLength(ROSTER_MAX);
        expect(campaignRefusal(full, { kind: 'recruit', id: r.id })).toBe('The roster is full');
        // The dead leave room.
        const mourning = { ...full, roster: full.roster.map(m => (m.id === 'x1' ? { ...m, status: 'dead' as const, died: 1 } : m)) };
        expect(campaignRefusal(mourning, { kind: 'recruit', id: r.id })).toBeUndefined();
        // A recruit goes on a job and takes their share.
        const rich = { ...d, money: { clean: 1e6, dirty: 0 } };
        const r2 = heist(rich, ['mara', r.id], {}, 'partial');
        expect(r2.campaign.visit!.job!.crew).toContain(r.id);
        roundTrips(r2.campaign);
    });
});

describe('the crew a job takes (§19.3)', () => {
    it('is the contract\'s size by stakes, of those free to go', () => {
        const c = newCampaign(1);
        const cmd = (crew: string[], stakes: Stakes): CampaignCommand => ({ kind: 'heist', bank: 'b', contract: c.contracts.find(k => k.stakes === stakes)!.id, job: job(crew, stakes) });
        expect(CREW_BY_STAKES).toEqual({ low: [2, 3], medium: [3, 4], high: [4, 5] });
        expect(campaignRefusal(c, cmd(['mara'], 'low'))).toBe('The contract takes 2–3');
        expect(campaignRefusal(c, cmd(['mara', 'jun', 'dex', 'sol'], 'low'))).toBe('The contract takes 2–3');
        expect(campaignRefusal(c, cmd(['mara', 'jun'], 'low'))).toBeUndefined();
        expect(campaignRefusal(c, cmd(['mara', 'jun'], 'medium'))).toBe('The contract takes 3–4');
        expect(campaignRefusal(c, cmd(['mara', 'jun', 'dex'], 'high'))).toBe('The contract takes 4–5');
        expect(campaignRefusal(c, cmd(['mara', 'jun', 'dex', 'sol'], 'high'))).toBeUndefined();
        expect(campaignRefusal(c, cmd(['mara', 'eve'], 'low'))).toBe('Not the crew');
        const hurt = { ...c, roster: c.roster.map(m => (m.id === 'jun' ? { ...m, status: 'injured' as const, injured: 2 } : m)) };
        expect(campaignRefusal(hurt, cmd(['mara', 'jun'], 'low'))).toBe('Jun is injured');
    });
});

describe('a job\'s end for its crew (§19.6, §19.7)', () => {
    it('puts those who went down out injured, revived or not; the days heal them, laying low twice as fast', () => {
        const { campaign: c, events } = heist(newCampaign(1), ['mara', 'jun'], { escaped: ['mara', 'jun'], downed: ['jun'] });
        expect(member(c, 'jun')).toMatchObject({ status: 'injured', injured: INJURY_DAYS });
        expect(member(c, 'mara').status).toBe('ready');
        expect(events).toContainEqual({ type: 'injured', crew: 'jun', days: INJURY_DAYS });
        roundTrips(c);
        // Not on the next job.
        expect(campaignRefusal(c, { kind: 'heist', bank: 'b', contract: c.contracts[0]!.id, job: job(['mara', 'jun'], c.contracts[0]!.stakes) })).toBe('Jun is injured');
        // A lay-low heals two days, another one or two more.
        const d = layLow(c);
        expect(member(d, 'jun')).toMatchObject({ status: 'injured', injured: 1 });
        const { campaign: e, events: healed } = run(d, { kind: 'layLow' });
        expect(member(e, 'jun').status).toBe('ready');
        expect(member(e, 'jun').injured).toBeUndefined();
        expect(healed).toContainEqual({ type: 'healed', crew: 'jun' });
        roundTrips(e);
    });

    it('kills the dead for good: no job, no growth', () => {
        const { campaign: c, events } = heist(newCampaign(1), ['mara', 'jun'], { escaped: ['mara'], dead: ['jun'] });
        expect(member(c, 'jun')).toMatchObject({ status: 'dead', died: 1, jobs: 0 });
        expect(member(c, 'mara').jobs).toBe(1);
        expect(events).toContainEqual({ type: 'killed', crew: 'jun' });
        expect(campaignRefusal(c, { kind: 'heist', bank: 'b', contract: c.contracts[0]!.id, job: job(['mara', 'jun'], c.contracts[0]!.stakes) })).toBe('Jun is dead');
        roundTrips(layLow(c, 3));
    });

    it('jails the arrested with +2 Notoriety (+1 Squeeze each), the Forgettable +1', () => {
        let c = newCampaign(1);
        c = { ...c, roster: c.roster.map(m => (m.id === 'jun' ? { ...m, traits: [...m.traits, 'forgettable' as const] } : m)) };
        const { campaign: d, events } = heist(c, ['mara', 'jun'], { arrested: ['mara', 'jun'] }, 'failure');
        expect(member(d, 'mara')).toMatchObject({ status: 'jailed', notoriety: 2, jail: { day: 1, named: ['jun'], talked: false } });
        expect(member(d, 'jun')).toMatchObject({ status: 'jailed', notoriety: 1, jail: { day: 1, named: ['mara'], talked: false } });
        expect(events.filter(e => e.type === 'squeeze' && e.source === 'notoriety')).toHaveLength(2);
        // The day (+2), the failed job (+2), each who gained Notoriety (+1 each).
        expect(d.squeeze).toBe(SQUEEZE.day + SQUEEZE.failedJob + 2 * SQUEEZE.notoriety);
        roundTrips(d);
    });
});

describe('jail (§19.6)', () => {
    /** Mara jailed on day 1 after a job with Jun. */
    const jailed = (seed: number): Campaign => heist(newCampaign(seed), ['mara', 'jun'], { escaped: ['jun'], arrested: ['mara'] }).campaign;

    it('a prisoner left there may talk, once: +4 Squeeze, and +1 Notoriety (and Squeeze) for each named', () => {
        // A campaign whose prisoner talks on some day: found from the seed, as the rules roll it.
        const seed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find(s => talks(s, 'mara', 2) && !talks(s, 'mara', 1))!;
        expect(seed).toBeDefined();
        const c = jailed(seed);
        const before = c.squeeze;
        const { campaign: d, events } = run(c, { kind: 'layLow' });
        expect(events).toContainEqual({ type: 'talked', crew: 'mara', named: ['jun'] });
        expect(member(d, 'mara').jail!.talked).toBe(true);
        expect(member(d, 'jun').notoriety).toBe(1);
        expect(d.squeeze).toBe(before + SQUEEZE.day + SQUEEZE.talked + SQUEEZE.notoriety);
        // Never twice.
        let e = d;
        for (let i = 0; i < 5 && e.phase === 'open'; i++) {
            const r = run(e, { kind: 'layLow' });
            expect(r.events.some(x => x.type === 'talked')).toBe(false);
            e = r.campaign;
        }
        roundTrips(d);
    });

    it('a lawyer gets them out in two days for $40k, and they never talk', () => {
        const c = { ...jailed(3), money: { clean: 100000, dirty: 0 } };
        expect(campaignRefusal(c, { kind: 'lawyer', crew: 'jun' })).toBe('Not in jail');
        const { campaign: d, events } = run(c, { kind: 'lawyer', crew: 'mara' });
        expect(d.money.clean).toBe(100000 - LAWYER_COST);
        expect(events).toContainEqual({ type: 'spent', on: 'lawyer', amount: LAWYER_COST, clean: 100000 - LAWYER_COST });
        expect(member(d, 'mara').jail!.out).toBe(d.day + LAWYER_DAYS);
        expect(campaignRefusal(d, { kind: 'lawyer', crew: 'mara' })).toBe('A lawyer is on it');
        const e = layLow(d);
        expect(member(e, 'mara').status).toBe('jailed');
        const { campaign: f, events: out } = run(e, { kind: 'layLow' });
        expect(member(f, 'mara').status).toBe('ready');
        expect(out).toContainEqual({ type: 'released', crew: 'mara' });
        expect([...events, ...out].some(x => x.type === 'talked')).toBe(false);
        expect(campaignRefusal({ ...c, money: { clean: LAWYER_COST - 1, dirty: 0 } }, { kind: 'lawyer', crew: 'mara' })).toBe('Not enough money');
        roundTrips(f);
    });
});

describe('Notoriety (§19.7)', () => {
    it('decays one for every two days a crew member at liberty isn\'t deployed; going out starts the count again', () => {
        let c = newCampaign(1);
        c = { ...c, roster: c.roster.map(m => ({ ...m, notoriety: 3 })) };
        const d = layLow(c);
        expect(member(d, 'mara').notoriety).toBe(3);
        const { campaign: e, events } = run(d, { kind: 'layLow' });
        expect(e.roster.map(m => m.notoriety)).toEqual([2, 2, 2, 2]);
        expect(events).toContainEqual({ type: 'notoriety', crew: 'mara', notoriety: 2, change: -1 });
        // Day 3: Mara and Jun go out; Dex and Sol rest. Day 4: everyone rests, Dex's second day. Mara's count started again.
        const f = heist(e, ['mara', 'jun'], { escaped: ['mara', 'jun'] }).campaign;
        expect([member(f, 'mara').notoriety, member(f, 'dex').notoriety]).toEqual([2, 2]);
        const g = layLow(f);
        expect([member(g, 'mara').notoriety, member(g, 'dex').notoriety]).toEqual([2, 1]);
        expect(member(layLow(g), 'mara').notoriety).toBe(1);
        // Never below 0.
        expect(layLow(c, 10).roster.every(m => m.notoriety === 0)).toBe(true);
        roundTrips(g);
    });

    it('doesn\'t decay in jail', () => {
        const c = heist(newCampaign(3), ['mara', 'jun'], { escaped: ['jun'], arrested: ['mara'] }).campaign;
        expect(member(c, 'mara').notoriety).toBe(2);
        expect(member(layLow(c, 4), 'mara').notoriety).toBe(2);
    });
});

describe('traits grow (§7.2, §19.6)', () => {
    it('every two jobs survived offer three not had; the player picks one', () => {
        let c = { ...newCampaign(2), money: { clean: 1e6, dirty: 0 } };
        c = heist(c, ['mara', 'jun'], { escaped: ['mara', 'jun'] }).campaign;
        expect(member(c, 'mara').traitOffers).toEqual([]);
        const { campaign: d, events } = heist(c, ['mara', 'jun'], { escaped: ['mara', 'jun'] });
        const offer = member(d, 'mara').traitOffers[0]!;
        expect(offer).toHaveLength(TRAIT_CHOICES);
        expect(offer).not.toContain('smoothTalker');
        expect(new Set(offer).size).toBe(TRAIT_CHOICES);
        expect(events).toContainEqual({ type: 'traitOffered', crew: 'mara', traits: offer });
        roundTrips(d);
        const notOffered = TRAITS.find(t => !offer.includes(t) && t !== 'smoothTalker')!;
        expect(campaignRefusal(d, { kind: 'pickTrait', crew: 'mara', trait: notOffered })).toBe('Not offered');
        const { campaign: e, events: picked } = run(d, { kind: 'pickTrait', crew: 'mara', trait: offer[1]! });
        expect(member(e, 'mara').traits).toEqual(['smoothTalker', offer[1]]);
        expect(member(e, 'mara').traitOffers).toEqual([]);
        expect(picked).toEqual([{ type: 'trait', crew: 'mara', trait: offer[1] }]);
        expect(campaignRefusal(e, { kind: 'pickTrait', crew: 'mara', trait: offer[0]! })).toBe('Not offered');
        // The arrested survived too; the dead didn't.
        const f = heist(heist(e, ['dex', 'sol'], { escaped: ['dex', 'sol'] }).campaign, ['dex', 'sol'], { arrested: ['dex'], dead: ['sol'] }, 'failure').campaign;
        expect(member(f, 'dex').traitOffers).toHaveLength(1);
        expect(member(f, 'sol').traitOffers).toHaveLength(0);
    });
});

describe('motives (§19.6): met, a contact', () => {
    /** A campaign whose first crew member has `motive`. */
    const motivated = (motive: CrewMember['motive']): Campaign => {
        const c = newCampaign(4);
        return { ...c, money: { clean: 1e6, dirty: 0 }, roster: c.roster.map(m => (m.id === 'mara' ? { ...m, motive } : m)) };
    };

    it('a debt, paid from the clean money', () => {
        const c = motivated({ kind: 'debt', amount: 60000, met: false });
        const { campaign: d, events } = run(c, { kind: 'payDebt', crew: 'mara' });
        expect(d.money.clean).toBe(1e6 - 60000);
        expect(d.contacts).toBe(1);
        expect(events).toContainEqual({ type: 'motive', crew: 'mara', motive: 'debt', met: true });
        expect(campaignRefusal(d, { kind: 'payDebt', crew: 'mara' })).toBe('Paid already');
        expect(campaignRefusal(d, { kind: 'payDebt', crew: 'jun' })).toBe('No debt');
        expect(campaignRefusal({ ...c, money: { clean: 59999, dirty: 0 } }, { kind: 'payDebt', crew: 'mara' })).toBe('Not enough money');
        roundTrips(d);
    });

    it('never kill anyone (decision 509): settled at the finale; their own kill breaks it, a teammate\'s doesn\'t', () => {
        let c = motivated({ kind: 'neverKill', met: false, broken: false });
        // Jun kills on Mara's job: hers still holds. Nothing is paid before the finale.
        c = heist(c, ['mara', 'jun'], { escaped: ['mara', 'jun'], killers: ['jun'] }).campaign;
        expect(member(c, 'mara').motive).toEqual({ kind: 'neverKill', met: false, broken: false });
        expect(c.contacts).toBe(0);
        const { campaign: d, events } = settleFinaleMotives(c);
        expect(d.contacts).toBe(1);
        expect(member(d, 'mara').motive!.met).toBe(true);
        expect(events).toContainEqual({ type: 'motive', crew: 'mara', motive: 'neverKill', met: true });
        roundTrips(d);
        // Her own kill breaks it for good: the finale pays nothing.
        const { campaign: broken, events: told } = heist(c, ['mara', 'jun'], { escaped: ['mara', 'jun'], killers: ['mara'] });
        expect(member(broken, 'mara').motive).toMatchObject({ broken: true, met: false });
        expect(told).toContainEqual({ type: 'motive', crew: 'mara', motive: 'neverKill', met: false });
        expect(settleFinaleMotives(heist(broken, ['mara', 'jun'], { escaped: ['mara', 'jun'] }).campaign).campaign.contacts).toBe(0);
        // The dead are paid nothing.
        const dead = heist(c, ['mara', 'jun'], { escaped: ['jun'], dead: ['mara'] }).campaign;
        expect(settleFinaleMotives(dead).campaign.contacts).toBe(0);
        roundTrips(broken);
    });

    it('get even: a clean getaway from a branch of that chain, with them on the job', () => {
        const c = motivated({ kind: 'getEven', chain: 'Granite Savings', met: false });
        // Day 1's low offer is a Granite Savings branch.
        expect(c.contracts[0]!.chain).toBe('Granite Savings');
        expect(heist(c, ['mara', 'jun'], { escaped: ['mara', 'jun'] }, 'partial').campaign.contacts).toBe(0);
        expect(heist(c, ['jun', 'dex'], { escaped: ['jun', 'dex'] }, 'success').campaign.contacts).toBe(0);
        const { campaign: d } = heist(c, ['mara', 'jun'], { escaped: ['mara', 'jun'] }, 'success');
        expect(d.contacts).toBe(1);
        expect(member(d, 'mara').motive!.met).toBe(true);
    });
});

describe('an abandoned job', () => {
    it('settles nobody: no fates, no growth (the job failed, the crew came home)', () => {
        const c = newCampaign(1);
        const started = step(c, { kind: 'heist', bank: 'b', contract: c.contracts[0]!.id, job: job(['mara', 'jun'], 'low') });
        const d = layLow(started);
        expect(d.roster.every(m => m.status === 'ready' && m.jobs === 0)).toBe(true);
    });
});
