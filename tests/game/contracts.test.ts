import { describe, expect, it } from 'vitest';
import { commitCampaign, escalateChain, FIRST_CONTRACT, newCampaign, type Contract } from '../../src/campaign';
import {
    buyCampaignIntel, campaignCrew, campaignIntel, campaignProblem, contractAddress, contractBankRefusal, loadCampaign, objectivesOut, saveCampaign, startContractHeist
} from '../../src/game/campaign';
import { bankPrint, campaignPrint } from '../../src/game/intel';
import { bankAddress, sameAddress, savedHeist, BANK_KEY } from '../../src/game/heist';
import { heistFromSetup, defaultSetup, planOptions } from '../../src/game/plan';
import { HEIST_KEY, MemoryStorage } from '../../src/game';
import { parseSeed, type GenerateOptions } from '../../src/gen/generate';
import { TIER_SPECS } from '../../src/gen/tiers';
import { worldFromBank } from '../../src/sim';
import { cachedBank } from '../bankCache';

/*
 * Contracts in the game (M6-02): a contract's bank is built exactly from its terms, and a campaign heist starts only in
 * the bank of a contract on offer, whatever the address names (the M6-03 review's MAJOR: the address picked the bank and
 * so the stakes).
 */

/** What the generator builds a contract's bank from, as the address carries it (src/bankSource.ts). */
const optionsOf = (k: Contract): GenerateOptions => ({
    ...parseSeed(k.bank.seed), tier: k.bank.tier, archetype: k.bank.archetype, plot: k.bank.plot, chain: k.chain,
    ...(k.escalation ? { escalation: k.escalation } : {}), ...(k.objective ? { objectives: [k.objective] } : {})
});

const plain = cachedBank({ layout: 31, population: 2, tier: 'small', archetype: 'twoWing' });
const first = cachedBank(optionsOf(FIRST_CONTRACT as Contract));

describe("a contract's bank", () => {
    it('the first is the M1 bank, a Granite Savings branch already: only its address names the chain', () => {
        expect(first.name).toBe(plain.name);
        expect(first.name.startsWith('Granite Savings')).toBe(true);
        expect(first.props).toEqual(plain.props);
        expect(first.policeEta).toBe(plain.policeEta);
        expect(bankAddress(first)).toEqual(contractAddress(FIRST_CONTRACT));
        expect(bankAddress(plain)).toEqual({ seed: '31-2', tier: 'small', archetype: 'twoWing', plot: 'stripMallEnd' });
    });

    it('a chain on guard and a side objective: the police come sooner, the objective is placed, nothing else changes', () => {
        const k: Contract = { ...FIRST_CONTRACT, chain: 'Harbour Trust', escalation: 2, objective: 'blackmail' };
        const bank = cachedBank(optionsOf(k));
        expect(bank.policeEta).toBe(TIER_SPECS.small.policeEta - 2);
        expect(bank.name).toMatch(/^Harbour Trust, /);
        expect(bank.props).toEqual(plain.props);
        expect(bank.people).toEqual(plain.people);
        expect(bank.loot.filter(l => l.objective)).toHaveLength(1);
        expect(bankAddress(bank)).toEqual(contractAddress(k));
        expect(worldFromBank(bank).rules.policeEta).toBe(6);
        // A side objective the crew got away with counts; one left behind doesn't.
        const world = worldFromBank(bank), { state } = heistFromSetup(bank, defaultSetup(planOptions(bank, world)));
        const files = world.objects.find(o => o.loot?.objective === 'blackmail')!;
        const outcome = { result: 'partial', turn: 3, vehicle: 'van', escaped: [], arrested: [], dead: [], loot: [files.id], value: 0, ruined: 0, target: 1, heat: 0 } as const;
        expect(objectivesOut(world, { ...state, outcome: { ...outcome, escaped: [...outcome.escaped], arrested: [], dead: [], loot: [files.id] } })).toEqual(['blackmail']);
        expect(objectivesOut(world, { ...state, outcome: { ...outcome, escaped: [], arrested: [], dead: [], loot: [] } })).toEqual([]);
    });

    it('is saved with the heist and resumed in the same bank (the address keeps its terms)', () => {
        const storage = new MemoryStorage();
        storage.set(HEIST_KEY, '{}');
        storage.set(BANK_KEY, JSON.stringify({ address: contractAddress(FIRST_CONTRACT), name: first.name }));
        expect(sameAddress(savedHeist(storage)!.address, bankAddress(first))).toBe(true);
        expect(sameAddress(savedHeist(storage)!.address, bankAddress(plain))).toBe(false);
    });
});

describe('a campaign heist starts only in an offered contract\'s bank', () => {
    const c = newCampaign(1);
    const world = (b: typeof plain) => planOptions(b).world;

    it("takes the offered contract's own bank", () => {
        expect(contractBankRefusal(c, FIRST_CONTRACT.id, first, world(first))).toBeUndefined();
    });

    it('refuses a crafted `?plan&campaign&seed=…&tier=hq`: no contract, or a contract and another bank', () => {
        const hq = cachedBank({ layout: 31, population: 2, tier: 'hq' });
        expect(contractBankRefusal(c, null, hq, world(hq))).toBe('Not on offer');
        expect(contractBankRefusal(c, 'd1-hq', hq, world(hq))).toBe('Not on offer');
        // Even the high-stakes offer's id with a bank of the player's choosing is refused.
        const high = c.contracts.find(k => k.stakes === 'high')!;
        expect(contractBankRefusal(c, high.id, hq, world(hq))).toBe("Not the contract's bank");
        expect(contractBankRefusal(c, FIRST_CONTRACT.id, hq, world(hq))).toBe("Not the contract's bank");
        // The M1 bank without its chain, or with a security step it hasn't got, is not the contract's either.
        expect(contractBankRefusal(c, FIRST_CONTRACT.id, plain, world(plain))).toBe("Not the contract's bank");
        expect(contractBankRefusal(null, FIRST_CONTRACT.id, first, world(first))).toBe('No campaign');
    });

    it('refuses a contract taken already (a second tab, a reload after Start)', () => {
        const taken = commitCampaign(c, { kind: 'heist', bank: 'b', contract: FIRST_CONTRACT.id }).campaign;
        expect(contractBankRefusal(taken, FIRST_CONTRACT.id, first, world(first))).toBe('Not on offer');
    });

    it("keeps the save's story: a heist is a contract's, taken off the board, at its stakes", () => {
        const taken = commitCampaign(c, { kind: 'heist', bank: 'b', contract: FIRST_CONTRACT.id, job: { crew: ['mara', 'jun'], kits: { mara: [], jun: [] }, stakes: 'low' } }).campaign;
        expect(campaignProblem(taken)).toBeUndefined();
        const broken = (change: (v: any) => void) => {
            const v = structuredClone(taken) as any;
            change(v);
            return campaignProblem(v);
        };
        expect(broken(v => { delete v.visit.contract; })).toBe("the visit's heist is no contract's");
        expect(broken(v => { v.visit.job.stakes = 'high'; })).toBe("the visit's job is not at its contract's stakes");
        expect(broken(v => { v.contracts.push(v.visit.contract); v.contracts[0].stakes = 'medium'; })).toBe('two contracts on the board have the same stakes');
        expect(broken(v => { v.contracts[0].bank.tier = 'vault'; })).toBe("the contract's bank is no bank");
        expect(broken(v => { v.contracts[0].escalation = 9; })).toBe('the contract has no terms');
        expect(broken(v => { v.contracts[0].posted = 3; v.contracts[0].expires = 4; })).toBe('a contract on the board is not on offer today');
        expect(broken(v => { v.advantages = ['blueprints', 'blueprints']; })).toBe('the advantages are not side objectives');
        expect(broken(v => { v.objectiveOffers = { blueprints: 3 }; })).toBe('the side objectives offered are no counts');
        expect(broken(v => { v.hits = { Nowhere: 1 }; })).toBe('the heists per chain are no counts');
    });
});

describe('Start checks the campaign as saved then (the M6-02 review)', () => {
    const setup = () => defaultSetup(planOptions(first), {}, campaignCrew(newCampaign(1), 'low'));

    it("refuses when another tab put the contract's chain on guard since the page loaded", () => {
        const storage = new MemoryStorage();
        saveCampaign(storage, newCampaign(1));
        // Another tab: a heist on another Granite Savings branch puts this offer a security step up.
        const other = loadCampaign(storage)!;
        escalateChain(other, FIRST_CONTRACT.chain);
        saveCampaign(storage, other);
        const done = startContractHeist(storage, FIRST_CONTRACT.id, first, planOptions(first).world, setup());
        expect(done).toEqual({ refused: "Not the contract's bank" });
        // Nothing was spent.
        expect(loadCampaign(storage)!.day).toBe(1);
    });

    it('refuses a contract another tab took, and starts one still offered in its own bank', () => {
        const storage = new MemoryStorage();
        saveCampaign(storage, commitCampaign(newCampaign(1), { kind: 'heist', bank: 'b', contract: FIRST_CONTRACT.id }).campaign);
        expect(startContractHeist(storage, FIRST_CONTRACT.id, first, planOptions(first).world, setup())).toEqual({ refused: 'Not on offer' });
        saveCampaign(storage, newCampaign(1));
        const done = startContractHeist(storage, FIRST_CONTRACT.id, first, planOptions(first).world, setup());
        expect('refused' in done).toBe(false);
        expect(loadCampaign(storage)!.visit!.contract!.id).toBe(FIRST_CONTRACT.id);
    });
});

describe('intel bought for a contract survives its chain going on guard (decision 485)', () => {
    it("keys the campaign's intel by the bank without the police's arrival time", () => {
        const guarded = cachedBank(optionsOf({ ...FIRST_CONTRACT, escalation: 1 } as Contract));
        const before = planOptions(first).world, after = planOptions(guarded).world;
        expect(after.rules.policeEta).toBeLessThan(before.rules.policeEta);
        expect(bankPrint(after)).not.toBe(bankPrint(before));
        expect(campaignPrint(after)).toBe(campaignPrint(before));
        // A bank with another layout is still another print.
        expect(campaignPrint(planOptions(cachedBank({ layout: 32, population: 2, tier: 'small', archetype: 'twoWing' })).world)).not.toBe(campaignPrint(before));

        const storage = new MemoryStorage();
        saveCampaign(storage, newCampaign(1));
        expect('refused' in buyCampaignIntel(storage, before, 'blueprints')).toBe(false);
        // Another branch of the chain is hit: the offer goes a step up, and its bank is the guarded one.
        const c = loadCampaign(storage)!;
        escalateChain(c, FIRST_CONTRACT.chain);
        expect(c.contracts[0]!.escalation).toBe(1);
        expect(campaignIntel(c, after).blueprints).toBe(true);
        // Paid once: buying it again is refused.
        saveCampaign(storage, c);
        expect(buyCampaignIntel(storage, after, 'blueprints')).toEqual({ refused: 'Known already' });
    });
});
