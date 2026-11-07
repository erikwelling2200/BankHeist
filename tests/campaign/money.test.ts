import { describe, expect, it } from 'vitest';
import {
    campaignRefusal, commitCampaign, CampaignRefused, drawComplications, favoursToday, fenceCut, FRONT_COST, knownBefore, knownIntel, LAUNDER_PER_DAY, MARKET, newCampaign,
    sharesOf, STARTER_KIT, STARTING_CASH, STARTING_SHARES, type Campaign, type CampaignCommand, type CampaignEvent, type Job
} from '../../src/campaign';
import { FIXED_ITEMS, loadoutItems, ROSTER } from '../../src/game/plan';

/*
 * Money and gear in the campaign (M6-03, GAME_DESIGN §19.4): a heist's take as dirty money less the crew's shares,
 * laundering by the day and through the fence, fronts, the armoury and the black market, contacts, and intel bought
 * while planning. Nothing is counted twice, and nothing is had for free.
 */

const run = (c: Campaign, ...cmds: CampaignCommand[]): { campaign: Campaign; events: CampaignEvent[] } => {
    let events: CampaignEvent[] = [];
    for (const cmd of cmds) {
        const done = commitCampaign(c, cmd);
        c = done.campaign;
        events = [...events, ...done.events];
    }
    return { campaign: c, events };
};

const ALL: Job = { crew: ['mara', 'jun', 'dex', 'sol'], gear: ['pistol', 'shotgun', 'mediumArmour', 'breachCharge'], stakes: 'medium' };
const heist = (job: Job = ALL, cost = 0): CampaignCommand => ({ kind: 'heist', bank: 'b', job, cost });
/** A campaign with money to spend. */
const rich = (clean: number, dirty = 0): Campaign => ({ ...newCampaign(9), money: { clean, dirty } });

describe('a new campaign', () => {
    it("starts with the sandbox's cash, the roster's own gear and its shares", () => {
        const c = newCampaign(1);
        expect(c.money).toEqual({ clean: STARTING_CASH, dirty: 0 });
        expect(STARTING_CASH).toBe(24000);
        expect({ fronts: c.fronts, contacts: c.contacts }).toEqual({ fronts: 0, contacts: 0 });
        // The armoury is exactly what the roster brings by default, so the default plan is playable on day 1.
        const kit: Record<string, number> = {};
        for (const m of ROSTER) for (const id of loadoutItems(m.loadout).filter(id => !FIXED_ITEMS.includes(id))) kit[id] = (kit[id] ?? 0) + 1;
        expect(c.armoury).toEqual(kit);
        expect(STARTER_KIT).toEqual(kit);
        expect(Object.keys(c.shares).sort()).toEqual(ROSTER.map(m => m.id).sort());
        expect(Object.values(STARTING_SHARES).every(n => n >= 8 && n <= 20)).toBe(true);
    });
});

describe('a heist pays as it starts and is paid as it ends', () => {
    it('pays its assets and takes its gear out of the armoury as it starts', () => {
        const { campaign: c, events } = run(newCampaign(1), heist(ALL, 14000));
        expect(c.money.clean).toBe(10000);
        expect(c.armoury).toEqual({ pistol: 1, dmr: 1, lightVest: 1, hackingKit: 1, jammer: 1, flashbang: 1, medkit: 1 });
        expect(c.visit?.job).toEqual(ALL);
        expect(events).toContainEqual({ type: 'spent', on: 'heist', amount: 14000, clean: 10000 });
    });

    it("refuses a heist beyond the money, the armoury or the crew", () => {
        const c = newCampaign(1);
        expect(campaignRefusal(c, heist(ALL, 25000))).toBe('Not enough money');
        expect(campaignRefusal(c, heist({ ...ALL, gear: ['shotgun', 'shotgun'] }))).toBe('Not enough shotgun in the armoury');
        expect(campaignRefusal(c, heist({ ...ALL, gear: ['lmg'] }))).toBe('Not enough lmg in the armoury');
        expect(campaignRefusal(c, heist({ ...ALL, gear: ['zipTies'] }))).toBe('Not gear');
        expect(campaignRefusal(c, heist({ ...ALL, gear: ['__proto__'] }))).toBe('Not gear');
        expect(campaignRefusal(c, heist({ ...ALL, crew: ['mara', 'mara'] }))).toBe('Not the crew');
        expect(campaignRefusal(c, heist({ ...ALL, crew: ['eve'] }))).toBe('Not the crew');
        expect(campaignRefusal(c, heist({ ...ALL, crew: [] }))).toBe('Not the crew');
        expect(campaignRefusal(c, heist(ALL, -1))).toBe('No price');
        expect(() => commitCampaign(c, heist(ALL, 25000))).toThrow(CampaignRefused);
    });

    it("brings its take in once, as dirty money less every crew member's share, and the gear that came back", () => {
        let c = run(newCampaign(1), heist()).campaign;
        const take = 123457, shares = sharesOf(take, ALL.crew, c.shares);
        // Each share floored to the dollar: 10%, 8%, 10% and 12%.
        expect(shares).toBe(12345 + 9876 + 12345 + 14814);
        const r = run(c, { kind: 'heistOver', day: 1, result: 'partial', take, kept: ['pistol', 'shotgun', 'shotgun', 'lmg'] });
        c = r.campaign;
        expect(c.money.dirty).toBe(take - shares);
        expect(c.visit?.payout).toBe(take - shares);
        expect(r.events).toContainEqual({ type: 'paid', day: 1, take, shares, dirty: take - shares });
        // Back: what went in and came out, never more than went in (a guard's gun is no one's to keep); the armour and
        // the charge stayed behind.
        expect(c.armoury.pistol).toBe(2);
        expect(c.armoury.shotgun).toBe(1);
        expect(c.armoury.lmg).toBeUndefined();
        expect(c.armoury.mediumArmour).toBeUndefined();
        expect(c.armoury.breachCharge).toBeUndefined();
        // Never twice.
        expect(campaignRefusal(c, { kind: 'heistOver', day: 1, result: 'success', take })).toBe('The heist is over already');
        expect(campaignRefusal(run(newCampaign(1), heist()).campaign, { kind: 'heistOver', day: 1, result: 'success', take: -5 })).toBe('No take');
    });

    it('a failure brings nothing in and loses the gear brought in (§19.3)', () => {
        const c = run(newCampaign(1), heist(), { kind: 'heistOver', day: 1, result: 'failure', take: 50000, kept: ['pistol'] }).campaign;
        expect(c.money).toEqual({ clean: STARTING_CASH, dirty: 0 });
        expect(c.visit?.payout).toBeUndefined();
        expect(c.armoury.shotgun).toBeUndefined();
        expect(c.armoury.pistol).toBe(1);
    });

    it('an abandoned heist brings nothing in and its gear is lost', () => {
        const c = run(newCampaign(1), heist(), { kind: 'layLow' }).campaign;
        expect(c.days[0]!.action).toBe('heist');
        expect(c.visit).toBeNull();
        expect(c.money.dirty).toBe(0);
        expect(c.armoury.shotgun).toBeUndefined();
    });

    it("a heist stopped by the Raid its abandoned one brought spends nothing", () => {
        // Squeeze 36 on day 18: the abandoned job's +2 lands the Raid, and the new heist doesn't start.
        let c = newCampaign(4);
        for (let i = 0; i < 17; i++) c = commitCampaign(c, { kind: 'layLow' }).campaign;
        c = commitCampaign(c, heist({ ...ALL, gear: ['pistol'] })).campaign;
        expect(c.squeeze).toBe(36);
        const r = run(c, heist({ ...ALL, gear: ['dmr'] }, 5000));
        expect(r.events.some(e => e.type === 'stopped')).toBe(true);
        expect(r.campaign.money.clean).toBe(c.money.clean);
        expect(r.campaign.armoury.dmr).toBe(1);
    });
});

describe('laundering (§19.4)', () => {
    it('launders $60k a day at the safehouse, and $60k more for each front', () => {
        let c = rich(200000, 200000);
        let r = run(c, { kind: 'layLow' });
        expect(r.campaign.money).toEqual({ clean: 260000, dirty: 140000 });
        expect(r.events).toContainEqual({ type: 'laundered', amount: LAUNDER_PER_DAY, clean: 260000, dirty: 140000 });
        c = run(c, { kind: 'buyFront' }).campaign;
        expect(c.fronts).toBe(1);
        expect(c.money.clean).toBe(200000 - FRONT_COST);
        r = run(c, { kind: 'layLow' }, { kind: 'layLow' });
        expect(r.campaign.money).toEqual({ clean: 50000 + 200000, dirty: 0 });
        // A heist's day launders too, before its take comes in (as the day starts).
        expect(run(rich(0, 10000), heist({ ...ALL, gear: [] })).campaign.money).toEqual({ clean: 10000, dirty: 0 });
    });

    it('a front needs its price in clean money', () => {
        expect(campaignRefusal(rich(FRONT_COST - 1, 10 ** 6), { kind: 'buyFront' })).toBe('Not enough money');
    });
});

describe('the fence (§19.4)', () => {
    it('launders at once for half, never more than the dirty money there is', () => {
        const r = run(rich(0, 100001), { kind: 'fence', amount: 100001 });
        expect(r.campaign.money).toEqual({ clean: 50000, dirty: 0 });
        expect(r.events).toContainEqual({ type: 'fenced', amount: 100001, paid: 50000, cut: 50 });
        const c = rich(0, 1000);
        expect(campaignRefusal(c, { kind: 'fence', amount: 1001 })).toBe('Not that much dirty money');
        expect(campaignRefusal(c, { kind: 'fence', amount: 0 })).toBe('Nothing to fence');
        expect(campaignRefusal(c, { kind: 'fence', amount: 0.5 })).toBe('Nothing to fence');
    });

    it('takes 15% more once the "Nervous fence" complication has landed (§19.2)', () => {
        let seed = 0;
        while (drawComplications(seed)[0] !== 'nervousFence') seed++;
        let c: Campaign = { ...newCampaign(seed), money: { clean: 0, dirty: 10 ** 6 } };
        expect(fenceCut(c)).toBe(50);
        for (let i = 0; i < 3; i++) c = commitCampaign(c, { kind: 'layLow' }).campaign;
        expect(fenceCut(c)).toBe(50);
        c = commitCampaign(c, { kind: 'layLow' }).campaign;
        expect(c.landed).toEqual([4]);
        expect(fenceCut(c)).toBe(65);
        expect(commitCampaign(c, { kind: 'fence', amount: 1000 }).campaign.money.clean).toBe(c.money.clean + 350);
    });
});

describe('the black market and contacts (§19.4)', () => {
    it("sells §19.4's list at its prices into the armoury, with clean money", () => {
        expect(Object.fromEntries(Object.entries(MARKET).map(([id, o]) => [id, o!.price]))).toEqual({
            pistol: 2000, machinePistol: 5000, smg: 8000, shotgun: 10000, assaultRifle: 15000, dmr: 25000, lmg: 40000, lightVest: 5000, mediumArmour: 15000,
            heavyArmour: 40000, hackingKit: 10000, lockpick: 2000, drill: 20000, breachCharge: 3000, shapedCharge: 6000, thermite: 8000, flashbang: 1000,
            ammoBag: 2000, medkit: 1000
        });
        const r = run(newCampaign(1), { kind: 'buy', item: 'smg', count: 2 });
        expect(r.campaign.money.clean).toBe(STARTING_CASH - 16000);
        expect(r.campaign.armoury.smg).toBe(2);
        expect(campaignRefusal(r.campaign, { kind: 'buy', item: 'assaultRifle' })).toBe('Not enough money');
        expect(campaignRefusal(r.campaign, { kind: 'buy', item: 'zipTies' })).toBe('Not on sale');
        expect(campaignRefusal(r.campaign, { kind: 'buy', item: 'toString' })).toBe('Not on sale');
        expect(campaignRefusal(r.campaign, { kind: 'buy', item: 'pistol', count: 0 })).toBe('None');
        // Dirty money buys nothing.
        expect(campaignRefusal(rich(0, 10 ** 6), { kind: 'buy', item: 'pistol' })).toBe('Not enough money');
    });

    it('opens its higher tiers with the first contact: one per successful high-stakes job', () => {
        const c = rich(10 ** 6);
        for (const item of ['heavyArmour', 'dmr', 'lmg']) expect(campaignRefusal(c, { kind: 'buy', item })).toBe('Needs a contact');
        const high: Job = { crew: ['mara'], gear: [], stakes: 'high' };
        // A partial success, or a medium-stakes success, makes no contact.
        expect(run(c, heist(high), { kind: 'heistOver', day: 1, result: 'partial', take: 1 }).campaign.contacts).toBe(0);
        expect(run(c, heist({ ...high, stakes: 'medium' }), { kind: 'heistOver', day: 1, result: 'success', take: 1 }).campaign.contacts).toBe(0);
        const r = run(c, heist(high), { kind: 'heistOver', day: 1, result: 'success', take: 300000 });
        expect(r.campaign.contacts).toBe(1);
        expect(r.events).toContainEqual({ type: 'contact', contacts: 1 });
        expect(campaignRefusal(r.campaign, { kind: 'buy', item: 'lmg' })).toBeUndefined();
    });

    it('trades nothing once the campaign is over', () => {
        const over = commitCampaign(rich(10 ** 6, 10 ** 6), { kind: 'finale' }).campaign;
        for (const cmd of [{ kind: 'buy', item: 'pistol' }, { kind: 'buyFront' }, { kind: 'fence', amount: 1 }] as CampaignCommand[]) {
            expect(campaignRefusal(over, cmd)).toBe('The campaign is over');
        }
    });
});

describe('intel bought while planning (decision 401 in the campaign)', () => {
    const rota: CampaignCommand = { kind: 'buyIntel', bank: 'b', asset: 'guardRota', cost: 3000, favours: 1 };
    const plans: CampaignCommand = { kind: 'buyIntel', bank: 'b', asset: 'blueprints', cost: 2000, favours: 1 };

    it('is paid at once and known from then on: never bought twice', () => {
        const r = run(newCampaign(1), rota, plans);
        const c = r.campaign;
        expect(c.money.clean).toBe(STARTING_CASH - 5000);
        expect(r.events.filter(e => e.type === 'spent')).toEqual([
            { type: 'spent', on: 'intel', amount: 3000, clean: 21000 }, { type: 'spent', on: 'intel', amount: 2000, clean: 19000 }
        ]);
        expect(knownIntel(c, 'b')).toEqual([{ guardRota: true, blueprints: true }]);
        expect(favoursToday(c, 'b')).toBe(2);
        expect(favoursToday(c, 'other')).toBe(0);
        expect(campaignRefusal(c, rota)).toBe('Known already');
        expect(campaignRefusal(c, plans)).toBe('Known already');
        expect(campaignRefusal(rich(2999), rota)).toBe('Not enough money');
    });

    it("isn't overwritten by what the day's heist learns, which leaves out what it was bought knowing", () => {
        let c = run(newCampaign(1), rota, heist()).campaign;
        expect(knownBefore(c, 'b').guardRota).toBe(true);
        c = commitCampaign(c, { kind: 'learn', bank: 'b', day: 1, intel: { guardRota: true, routines: ['x'] } }).campaign;
        expect(c.intel.b).toEqual([{ day: 1, intel: { guardRota: true }, favours: 1 }, { day: 1, intel: { routines: ['x'] } }]);
        // The favours were today's: tomorrow's plan has the whole cap.
        expect(favoursToday(c, 'b')).toBe(0);
    });

    it('a bought rota ages like a learned one: gone after three days, and buyable again', () => {
        let c = run(newCampaign(1), rota, plans).campaign;
        for (let i = 0; i < 4; i++) c = commitCampaign(c, { kind: 'layLow' }).campaign;
        expect(knownIntel(c, 'b')).toEqual([{ blueprints: true }]);
        expect(campaignRefusal(c, rota)).toBeUndefined();
        expect(campaignRefusal(c, plans)).toBe('Known already');
    });

    it('is bought only while heists can be planned', () => {
        let c = newCampaign(1);
        for (let i = 0; i < 19; i++) c = commitCampaign(c, { kind: 'layLow' }).campaign;
        expect(campaignRefusal(c, rota)).toBe('No heist to plan');
    });
});
