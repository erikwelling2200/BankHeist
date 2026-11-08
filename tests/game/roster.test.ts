import { describe, expect, it } from 'vitest';
import { commitCampaign, drawRecruits, newCampaign, recruitLook, type Campaign } from '../../src/campaign';
import { campaignCrew, campaignKeeper, campaignPurse, crewFates, loadCampaign, saveCampaign } from '../../src/game/campaign';
import { startHeist } from '../../src/game/heist';
import { campaignPrint } from '../../src/game/intel';
import { crewLookOf, defaultSetup, heistFromSetup, planOptions, setupProblems } from '../../src/game/plan';
import { MemoryStorage } from '../../src/game';
import { crewLook, readProfile } from '../../src/sim';
import { cachedBank } from '../bankCache';

/*
 * The roster in the game (M6-04): the planning screen picks from the campaign's crew free to go, a contract's size of
 * them; the heist's crew carry their traits and Notoriety into the rules, which read Known crew one profile higher; and
 * the heist's end tells the campaign what became of each of them.
 */

const bank = cachedBank({ layout: 31, population: 2, tier: 'small', archetype: 'twoWing' });
const options = planOptions(bank);

/** A campaign with a recruit hired, Mara Known and Dex out injured. */
function campaign(): Campaign {
    let c: Campaign = { ...newCampaign(5), money: { clean: 100000, dirty: 0 } };
    const r = drawRecruits(5, 1)[0]!;
    c = commitCampaign(c, { kind: 'recruit', id: r.id }).campaign;
    c.roster = c.roster.map(m => (m.id === 'mara' ? { ...m, notoriety: 3 } : m.id === 'dex' ? { ...m, status: 'injured' as const, injured: 2 } : m));
    return c;
}

describe("the campaign's crew in planning", () => {
    it('is those free to go, a contract\'s size of them, the four with their usual loadouts and a recruit with none', () => {
        const c = campaign(), recruit = c.roster.at(-1)!;
        const low = campaignCrew(c, 'low');
        expect(low.size).toEqual([2, 3]);
        expect(low.roster.map(m => m.id)).toEqual(['mara', 'jun', 'sol', recruit.id]);
        expect(low.roster[0]).toMatchObject({ notoriety: 3, traits: ['smoothTalker'] });
        expect(low.roster.at(-1)).toMatchObject({ name: recruit.name, look: recruitLook(recruit.id), loadout: { primary: null, sidearm: null, armour: null, gadgets: [null, null] } });
        expect(crewLookOf(recruit.id)).toBe(recruitLook(recruit.id));
        // The default plan takes as many as the contract does, in roster order.
        const purse = campaignPurse(c, options.world, 'low');
        const setup = defaultSetup(options, {}, purse.crew);
        expect(setup.crew.map(m => m.id)).toEqual(['mara', 'jun', 'sol']);
        expect(setupProblems(setup, options, { ...purse, armoury: undefined })).toEqual([]);
        // Too few, too many, or someone out injured: refused.
        expect(setupProblems({ ...setup, crew: setup.crew.slice(0, 1) }, options, { ...purse, armoury: undefined })).toContain('The contract takes 2 at least');
        const four = defaultSetup(options, {}, campaignCrew(c, 'medium'));
        expect(four.crew).toHaveLength(4);
        expect(setupProblems(four, options, { ...purse, armoury: undefined })).toContain('The contract takes 3 at most');
        const dex = defaultSetup(options).crew.find(m => m.id === 'dex')!;
        expect(setupProblems({ ...setup, crew: [setup.crew[0]!, dex] }, options, { ...purse, armoury: undefined })).toContain("No one else called 'dex'");
    });
});

describe("the crew's Notoriety and traits in the rules (§19.7: profile.ts)", () => {
    it('carries them into the heist: Known crew read one profile higher to enforcers and cameras', () => {
        const c = campaign(), recruit = c.roster.at(-1)!, pool = campaignCrew(c, 'low');
        const setup = defaultSetup(options, {}, pool);
        setup.crew = setup.crew.filter(m => m.id !== 'sol');
        setup.crew.push({ id: recruit.id, loadout: pool.roster.at(-1)!.loadout, start: { at: 'van', aboard: true } });
        const { world, state } = heistFromSetup(bank, setup, options, pool);
        const mara = state.crew.find(m => m.id === 'mara')!, them = state.crew.find(m => m.id === recruit.id)!;
        expect(mara.notoriety).toBe(3);
        expect(them).toMatchObject({ name: recruit.name, traits: recruit.traits, notoriety: 0 });
        // Mara walks in Clean, but an enforcer reads her as Concealed; a teller doesn't. The recruit reads Clean.
        expect(crewLook(mara).profile).toBe('clean');
        expect(readProfile(world.rules, crewLook(mara), mara.notoriety, 'enforcer', false)).toBe('concealed');
        expect(readProfile(world.rules, crewLook(mara), mara.notoriety, 'civilian', false)).toBe('clean');
        expect(readProfile(world.rules, crewLook(them), them.notoriety, 'enforcer', false)).toBe('clean');
        // The sandbox's four are unknown.
        expect(heistFromSetup(bank, defaultSetup(options), options).state.crew.every(m => m.notoriety === 0)).toBe(true);
    });
});

describe("the heist's end for its crew", () => {
    it('tells the campaign who got away, went down, was arrested, died or killed', () => {
        const storage = new MemoryStorage();
        let c = newCampaign(7);
        const pool = campaignCrew(c, 'low'), setup = defaultSetup(options, {}, pool);
        const offer = c.contracts.find(k => k.stakes === 'low')!;
        c = commitCampaign(c, { kind: 'heist', bank: campaignPrint(options.world), contract: offer.id, job: { crew: setup.crew.map(m => m.id), kits: Object.fromEntries(setup.crew.map(m => [m.id, []])), stakes: 'low' } }).campaign;
        saveCampaign(storage, c);
        const tag = { seed: c.seed, day: 1 };
        const session = startHeist(bank, storage, { keepIntel: campaignKeeper(storage, tag) }, setup, tag, pool);
        const s = session.state;
        const [mara, jun, dex] = ['mara', 'jun', 'dex'].map(id => s.crew.find(m => m.id === id)!);
        const ended = {
            ...s,
            crew: [{ ...dex!, wounds: { ...dex!.wounds, dead: true } }],
            escaped: [{ crew: { ...mara!, wounds: { ...mara!.wounds, wentDown: true, kills: 1 } }, vehicle: 'van', turn: 4 }],
            custody: [{ crew: jun!, by: 'police-1', turn: 4 }],
            npcs: s.npcs.map((n, i) => (i === 0 ? { ...n, status: 'dead' as const } : n)),
            outcome: { result: 'partial', turn: 4, vehicle: 'van', escaped: ['mara'], arrested: ['jun'], dead: ['dex'], loot: [], value: 0, ruined: 0, target: 1, heat: 3 }
        } as typeof s;
        expect(crewFates(ended)).toEqual({ escaped: ['mara'], arrested: ['jun'], dead: ['dex'], downed: ['mara'], killers: ['mara'] });
        campaignKeeper(storage, tag)(session.world, ended);
        const after = loadCampaign(storage)!;
        expect(after.roster.map(m => [m.id, m.status])).toEqual([['mara', 'injured'], ['jun', 'jailed'], ['dex', 'dead'], ['sol', 'ready']]);
        expect(after.roster.find(m => m.id === 'jun')!.notoriety).toBe(2);
    });
});
