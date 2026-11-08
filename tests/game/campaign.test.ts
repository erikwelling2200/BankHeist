import { describe, expect, it } from 'vitest';
import { knownBefore, newCampaign, type Campaign } from '../../src/campaign';
import { commit, type TestCommand } from '../campaign/contracted';
import {
    buyCampaignIntel, CAMPAIGN_FORMAT, CAMPAIGN_KEY, campaignAct, campaignHeistRefusal, campaignIntel, campaignJob, campaignKeeper, campaignProblem, campaignPurse,
    deserialiseCampaign, dropCampaignHeist, gearKept, heistUnfinished, loadCampaign, saveCampaign, serialiseCampaign, untaggedKeeper
} from '../../src/game/campaign';
import { BANK_KEY, GEN_VERSION, savedHeist, startHeist, type CampaignTag } from '../../src/game/heist';
import { campaignPrint, intelKey } from '../../src/game/intel';
import { defaultSetup, fitArmoury, gearOf, heistFromSetup, planOptions, setupFromAddress, setupProblems, type HeistSetup } from '../../src/game/plan';
import { HEIST_KEY, MemoryStorage, Session } from '../../src/game';
import { intelOf, SaveFormatError } from '../../src/sim';
import { cachedBank } from '../bankCache';

/*
 * The campaign in the game (M6-01): its save and load, intel kept per campaign day rather than per device, and a
 * campaign heist paying for what it scouts with its day (decision 406's must-do).
 */

const bank = cachedBank({ layout: 31, population: 2, tier: 'small', archetype: 'twoWing' });
const options = planOptions(bank);
const print = campaignPrint(options.world);

/** A campaign heist as the game starts one: the day spent and saved first, then the heist tagged with it. */
function campaignHeist(storage: MemoryStorage, change: (s: HeistSetup) => void = () => {}): { session: Session; tag: CampaignTag } {
    const campaign = loadCampaign(storage)!;
    // As the planning screen opens it: the medium offer's crew of four (§19.3), cut to the armoury.
    const purse = campaignPurse(campaign, options.world, 'medium');
    const setup = fitArmoury(defaultSetup(options, campaignIntel(campaign, options.world), purse.crew), purse);
    change(setup);
    const done = campaignAct(storage, { kind: 'heist', bank: print, contract: campaign.contracts.find(k => k.stakes === 'medium')!.id, ...campaignJob(setup, 'medium') });
    if ('refused' in done) throw new Error(done.refused);
    const tag = { seed: done.campaign.seed, day: done.campaign.visit!.day };
    return { session: startHeist(bank, storage, { keepIntel: campaignKeeper(storage, tag) }, setup, tag), tag };
}

const started = (): MemoryStorage => {
    const storage = new MemoryStorage();
    saveCampaign(storage, newCampaign(11));
    return storage;
};

describe('the campaign save', () => {
    it('round-trips: a campaign played a few days reads back the same', () => {
        let c: Campaign = newCampaign(5);
        const cmds: TestCommand[] = [{ kind: 'heist', bank: print }, { kind: 'learn', bank: print, day: 1, intel: { routines: ['x'], seen: 'AB' } }, { kind: 'layLow' },
            { kind: 'squeeze', source: 'falseTip' }, { kind: 'case', bank: 'other' }];
        for (const cmd of cmds) c = commit(c, cmd).campaign;
        const text = serialiseCampaign(c);
        expect(deserialiseCampaign(text)).toEqual(c);
        expect(JSON.parse(text).format).toBe(CAMPAIGN_FORMAT);
        const storage = new MemoryStorage();
        expect(saveCampaign(storage, c)).toBe(true);
        expect(loadCampaign(storage)).toEqual(c);
        // Every day of a whole campaign reads back.
        let all = newCampaign(2);
        for (let i = 0; i < 19; i++) {
            all = commit(all, { kind: 'layLow' }).campaign;
            expect(campaignProblem(JSON.parse(JSON.stringify(all)))).toBeUndefined();
        }
    });

    it('refuses another format, and anything that is not a campaign', () => {
        const c = newCampaign(1);
        expect(() => deserialiseCampaign(JSON.stringify({ format: CAMPAIGN_FORMAT + 1, campaign: c }))).toThrow(SaveFormatError);
        expect(() => deserialiseCampaign(JSON.stringify({ campaign: c }))).toThrow(/format undefined/);
        // An M6-01 save (format 1, no money) is refused: the page offers a new campaign.
        expect(CAMPAIGN_FORMAT).toBe(4);
        expect(() => deserialiseCampaign(JSON.stringify({ format: 1, campaign: c }))).toThrow(SaveFormatError);
        // An M6-03 save (format 2, no contracts) is refused like any other.
        expect(() => deserialiseCampaign(JSON.stringify({ format: 2, campaign: c }))).toThrow(SaveFormatError);
        // An M6-02 save (format 3, shares and no roster) too.
        expect(() => deserialiseCampaign(JSON.stringify({ format: 3, campaign: c }))).toThrow(SaveFormatError);
        expect(() => deserialiseCampaign('not json')).toThrow(SaveFormatError);
        const broken = (change: (v: Record<string, unknown>) => void) => {
            const v = structuredClone(c) as unknown as Record<string, unknown>;
            change(v);
            return campaignProblem(v);
        };
        expect(broken(v => { v.extra = 1; })).toBe('a campaign with other fields');
        expect(broken(v => { delete v.visit; })).toBe('a campaign with other fields');
        expect(broken(v => { v.day = 0; })).toBe('the day is no day');
        expect(broken(v => { v.squeeze = 1.5; })).toBe('the Squeeze is no count');
        expect(broken(v => { v.complications = ['snitch', 'snitch', 'snitch', 'snitch', 'snitch', 'snitch', 'snitch']; })).toBe('the complications are not a draw');
        expect(broken(v => { v.squeeze = 9; })).toBe('a threshold reached has not landed');
        expect(broken(v => { v.phase = 'raid'; })).toBe("the phase isn't the Raid's");
        // Days spent that aren't the days before today: a day can't be given back by editing the save.
        expect(broken(v => { v.day = 3; })).toBe('the days spent are not the days before today');
        expect(broken(v => { v.visit = { kind: 'heist', day: 1, bank: print, prior: { guardRota: false, routines: [], opportunities: [] } }; })).toBe('the visit is not a day spent');
        expect(broken(v => { v.intel = { b: [{ day: 1, intel: {} }] }; })).toBe('the intel is not dated intel');
        // Money (M6-03): whole dollars, gear that is gear, shares that are shares, a payout only for a job that ended well.
        expect(broken(v => { v.intel = { b: [{ day: 1, intel: { guardRota: true }, favours: 1 }] }; })).toBeUndefined();
        expect(broken(v => { v.intel = { b: [{ day: 2, intel: { guardRota: true }, favours: 1 }] }; })).toBe('the intel is not dated intel');
        expect(broken(v => { v.money = { clean: -1, dirty: 0 }; })).toBe('the money is no money');
        expect(broken(v => { v.money = { clean: 1.5, dirty: 0 }; })).toBe('the money is no money');
        expect(broken(v => { delete (v.money as Record<string, unknown>).dirty; })).toBe('the money is no money');
        expect(broken(v => { v.fronts = -1; })).toBe('the fronts or contacts are no count');
        expect(broken(v => { v.armoury = { zipTies: 3 }; })).toBe('the armoury is not gear');
        expect(broken(v => { v.armoury = { pistol: 0 }; })).toBe('the armoury is not gear');
        expect(broken(v => { v.armoury = { goldBar: 1 }; })).toBe('the armoury is not gear');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const crew = (change: (r: any[]) => void) => broken(v => change(v.roster as any[]));
        // The roster (M6-04): crew members of their shape, each once, no more alive than the most, the job's crew among them.
        expect(crew(r => { r[0].share = 101; })).toBe("Mara's share is no share");
        expect(crew(r => { r[0].notoriety = 6; })).toBe("Mara's record is no record");
        expect(crew(r => { r[0].traits = ['smoothTalker', 'smoothTalker']; })).toBe("Mara's traits are not traits");
        expect(crew(r => { r[0].traitOffers = [['flying']]; })).toBe("Mara's traits are not traits");
        expect(crew(r => { r[0].status = 'injured'; })).toBe("Mara's injury is no injury");
        expect(crew(r => { r[0].status = 'jailed'; })).toBe("Mara's jail is no jail");
        expect(crew(r => { r[0].status = 'dead'; r[0].died = 1; })).toBe("Mara's death is no death");
        expect(crew(r => { r[0].motive = { kind: 'debt', amount: -5, met: false }; })).toBe("Mara's motive is none");
        expect(crew(r => { r[1].id = 'mara'; })).toBe('two crew members are one');
        expect(crew(r => { delete r[0].rested; })).toBe('a crew member with other fields');
        expect(crew(r => { for (let i = 0; i < 5; i++) r.push({ ...r[0], id: `x${i}` }); })).toBe('the roster is over full');
        expect(broken(v => { v.roster = {}; })).toBe('the roster is no roster');
        const job = { crew: ['mara', 'jun'], kits: { mara: ['pistol'], jun: [] }, stakes: 'low' };
        let paid = commit(c, { kind: 'heist', bank: 'b', job: job as never }).campaign;
        expect(campaignProblem(paid)).toBeUndefined();
        expect(campaignProblem({ ...paid, visit: { ...paid.visit!, job: { ...job, kits: { mara: ['mask'] } } } } as never)).toBe("the visit's job is no job");
        expect(campaignProblem({ ...paid, visit: { ...paid.visit!, job: { ...job, kits: { jun: ['pistol'] } } } } as never)).toBe("the visit's job is no job");
        expect(campaignProblem({ ...paid, visit: { ...paid.visit!, payout: 10 } })).toBe('the payout is no payout');
        paid = commit(paid, { kind: 'heistOver', day: 1, result: 'success', take: 1000 }).campaign;
        expect(campaignProblem(paid)).toBeUndefined();
        expect(campaignProblem({ ...paid, visit: { ...paid.visit!, result: 'failure' } })).toBe('the payout is no payout');
        // The review's probe, as the old rules saved it: a heist abandoned into the Raid, and a day spent after it.
        let raid = newCampaign(1);
        for (let i = 0; i < 17; i++) raid = commit(raid, { kind: 'layLow' }).campaign;
        raid = commit(raid, { kind: 'heist', bank: 'b' }).campaign;
        raid = commit(raid, { kind: 'heist', bank: 'c' }).campaign;
        expect(campaignProblem(raid)).toBeUndefined();
        const after = structuredClone(raid);
        after.days.push({ day: 19, action: 'heist', bank: 'c' });
        after.day = 20;
        after.squeeze = 40;
        after.visit = { kind: 'heist', day: 19, bank: 'c', prior: { guardRota: false, routines: [], opportunities: [] } };
        expect(campaignProblem(after)).toBe('a day was spent after the Raid');
        // A visit that isn't the last day spent.
        let two = commit(newCampaign(1), { kind: 'heist', bank: 'b' }).campaign;
        two = commit(two, { kind: 'heistOver', day: 1, result: 'success' }).campaign;
        const visit = two.visit;
        two = commit(two, { kind: 'layLow' }).campaign;
        expect(campaignProblem({ ...two, visit })).toBe('the visit is not the last day spent');
        // A broken save loads as none, and says why.
        const storage = new MemoryStorage();
        storage.set(CAMPAIGN_KEY, JSON.stringify({ format: CAMPAIGN_FORMAT, campaign: { ...c, day: 2 } }));
        expect(loadCampaign(storage)).toBeNull();
    });

    it('acts on the saved campaign and saves it, or refuses and changes nothing', () => {
        const storage = new MemoryStorage();
        expect(campaignAct(storage, { kind: 'layLow' })).toEqual({ refused: 'No campaign' });
        saveCampaign(storage, newCampaign(1));
        expect(campaignAct(storage, { kind: 'layLow' })).toMatchObject({ campaign: { day: 2, squeeze: 2 } });
        expect(loadCampaign(storage)).toMatchObject({ day: 2 });
        const before = storage.get(CAMPAIGN_KEY);
        expect(campaignAct(storage, { kind: 'raidOver', survived: true })).toEqual({ refused: 'No raid' });
        expect(storage.get(CAMPAIGN_KEY)).toBe(before);
    });
});

describe('a campaign heist (decision 406: casing is paid in days)', () => {
    it('spends its day as it starts: abandoned after a turn, the day is gone and the job failed', () => {
        const storage = started();
        const { session, tag } = campaignHeist(storage);
        expect(tag.day).toBe(1);
        expect(loadCampaign(storage)).toMatchObject({ day: 2, squeeze: 2, visit: { kind: 'heist', day: 1, bank: print } });
        expect(savedHeist(storage)?.campaign).toEqual(tag);
        session.commit({ type: 'endTurn' });
        // Abandoned: the next day action counts the failed job, and the saved heist is dropped.
        expect(heistUnfinished(loadCampaign(storage)!)).toBe(true);
        expect(campaignAct(storage, { kind: 'layLow' })).toMatchObject({ campaign: { day: 3, squeeze: 6 } });
        dropCampaignHeist(storage, tag.seed);
        expect(storage.get(HEIST_KEY)).toBeNull();
    });

    it("keeps what it learns in its campaign day, never in the device's intel, and the next plan starts with it", () => {
        const storage = started();
        const { session } = campaignHeist(storage);
        for (let i = 0; i < 3; i++) session.commit({ type: 'endTurn' });
        expect(storage.get(intelKey(session.world))).toBeNull();
        const c = loadCampaign(storage)!;
        expect(c.intel[print]).toHaveLength(1);
        expect(c.intel[print]![0]!.day).toBe(1);
        const intel = intelOf(session.world, session.state);
        expect(c.intel[print]![0]!.intel.seen).toBe(intel.seen);
        expect(knownBefore(c, print).routines).toEqual(intel.routines ?? []);
        // The next day's plan knows it.
        expect(campaignIntel(c, options.world).seen).toBe(intel.seen);
        // Resumed, it keeps sending to the same day.
        const resumed = Session.resume(storage, { keepIntel: campaignKeeper(storage, savedHeist(storage)!.campaign!) })!;
        resumed.commit({ type: 'endTurn' });
        expect(loadCampaign(storage)!.intel[print]).toHaveLength(1);
    });

    it("a sandbox heist never reaches the campaign, and an old day's heist sends nothing once its day is over", () => {
        const storage = started();
        const sandbox = startHeist(bank, storage, {}, defaultSetup(options));
        sandbox.commit({ type: 'endTurn' });
        sandbox.commit({ type: 'endTurn' });
        expect(storage.get(intelKey(sandbox.world))).not.toBeNull();
        expect(loadCampaign(storage)!.intel).toEqual({});
        expect(campaignIntel(loadCampaign(storage)!, options.world)).toEqual({});
        // A campaign heist, then a day laid low: playing on in the old heist learns nothing for the campaign.
        const { session, tag } = campaignHeist(storage);
        campaignAct(storage, { kind: 'layLow' });
        const before = loadCampaign(storage)!;
        session.commit({ type: 'endTurn' });
        session.commit({ type: 'endTurn' });
        expect(loadCampaign(storage)).toEqual(before);
        expect(tag.day).toBe(1);
        // As a tab still open on it would: the heist is dropped at its next save, and saves nothing more.
        expect(storage.get(HEIST_KEY)).toBeNull();
        session.commit({ type: 'endTurn' });
        expect(storage.get(HEIST_KEY)).toBeNull();
    });

    it('a heist that really ends in failure, through the Session, is a failed job counted once', () => {
        const storage = started();
        const done = campaignAct(storage, { kind: 'heist', bank: print, contract: 'd1-low' });
        if ('refused' in done) throw new Error(done.refused);
        const tag = { seed: done.campaign.seed, day: 1 };
        // Every crew member dead: the next turn's end ends the heist, a failure (§15.5).
        const { world, state } = heistFromSetup(bank, defaultSetup(options));
        for (const c of state.crew) c.wounds = { ...c.wounds, hp: 0, dead: true };
        const session = Session.start({ world, state, storage, genVersion: GEN_VERSION, keepIntel: campaignKeeper(storage, tag) });
        session.commit({ type: 'endTurn' });
        expect(session.state.outcome?.result).toBe('failure');
        expect(loadCampaign(storage)).toMatchObject({ squeeze: 4, visit: { result: 'failure' } });
        session.save();
        expect(loadCampaign(storage)!.squeeze).toBe(4);
    });

    it('a routine learned is dated its day: it ages from then, and knowing it again in a later heist renews nothing', () => {
        const storage = started();
        // The Guard rota bought: every guard's routine is learned on day 1.
        const { session } = campaignHeist(storage, s => { s.guardRota = true; });
        session.commit({ type: 'endTurn' });
        const learned = intelOf(session.world, session.state).routines ?? [];
        expect(learned.length).toBeGreaterThan(0);
        let c = loadCampaign(storage)!;
        expect(c.intel[print]![0]).toMatchObject({ day: 1, intel: { guardRota: true, routines: learned } });
        expect(knownBefore(c, print)).toMatchObject({ guardRota: true, routines: learned });
        // Day 3: a heist that starts knowing them learns nothing new about them.
        campaignAct(storage, { kind: 'layLow' });
        const second = campaignHeist(storage).session;
        second.commit({ type: 'endTurn' });
        c = loadCampaign(storage)!;
        const today = c.intel[print]!.find(r => r.day === 3)!;
        expect(today.intel.guardRota).toBeUndefined();
        expect((today.intel.routines ?? []).filter(id => learned.includes(id))).toEqual([]);
        // Past INTEL_FRESH_DAYS after day 1 they are gone.
        for (let i = 0; i < 2; i++) campaignAct(storage, { kind: 'layLow' });
        expect(loadCampaign(storage)!.day).toBe(6);
        expect(knownBefore(loadCampaign(storage)!, print).guardRota).toBe(false);
        expect(knownBefore(loadCampaign(storage)!, print).routines.filter(id => learned.includes(id) && !(today.intel.routines ?? []).includes(id))).toEqual([]);
    });

    it('a campaign heist is tagged before it is saved; untagged in the campaign day\'s bank, it sends nothing to the device', () => {
        const storage = started();
        const { session, tag } = campaignHeist(storage);
        expect(JSON.parse(storage.get(BANK_KEY)!).campaign).toEqual(tag);
        // A full quota on the bank entry: a campaign heist doesn't start untagged.
        const full = started();
        campaignAct(full, { kind: 'heist', bank: print, contract: 'd1-low' });
        const set = full.set.bind(full);
        full.set = (key, value) => { if (key === BANK_KEY) throw new Error('quota'); set(key, value); };
        expect(() => startHeist(bank, full, {}, defaultSetup(options), { seed: 11, day: 1 })).toThrow('quota');
        // Its tag lost, the heist resumed as the game resumes an untagged one keeps nothing on the device.
        storage.set(BANK_KEY, JSON.stringify({ address: savedHeist(storage)!.address }));
        session.retire();
        const resumed = Session.resume(storage, { keepIntel: untaggedKeeper(storage) })!;
        resumed.commit({ type: 'endTurn' });
        resumed.commit({ type: 'endTurn' });
        expect(storage.get(intelKey(resumed.world))).toBeNull();
    });

    it('a heist abandoned into the Raid is dropped, and sends nothing more to the campaign', () => {
        const storage = new MemoryStorage();
        let c = newCampaign(11);
        for (let i = 0; i < 17; i++) c = commit(c, { kind: 'layLow' }).campaign;
        saveCampaign(storage, c);
        const { session } = campaignHeist(storage);
        // The next day action abandons it: its +2 lands the Raid and the action stops.
        const done = campaignAct(storage, { kind: 'layLow' });
        expect(done).toMatchObject({ campaign: { phase: 'raid', visit: { day: 18, result: 'failure' } } });
        const before = loadCampaign(storage)!;
        // Still open in a tab (or resumed from `/`): its next save drops it and the campaign is left as it was.
        session.commit({ type: 'endTurn' });
        session.commit({ type: 'endTurn' });
        expect(storage.get(HEIST_KEY)).toBeNull();
        expect(loadCampaign(storage)).toEqual(before);
        // Once dropped by the page (`dropCampaignHeist`) there is nothing to resume.
        dropCampaignHeist(storage, 11);
        expect(Session.resume(storage)).toBeNull();
    });

    it('a heist that ended in failure is a failed job, counted once', () => {
        const storage = started();
        const { session, tag } = campaignHeist(storage);
        const keep = campaignKeeper(storage, tag);
        const failed = { ...session.state, outcome: { ...(session.state.outcome ?? {}), result: 'failure' } } as typeof session.state;
        keep(session.world, failed);
        expect(loadCampaign(storage)).toMatchObject({ squeeze: 4, visit: { result: 'failure' } });
        keep(session.world, failed);
        expect(loadCampaign(storage)!.squeeze).toBe(4);
        // And the next day doesn't count it again.
        expect(campaignAct(storage, { kind: 'layLow' })).toMatchObject({ campaign: { squeeze: 6 } });
    });

    it('no heist can be planned without a campaign, or once the days have stopped', () => {
        expect(campaignHeistRefusal(null, options.world, 'd1-low')).toBe('No campaign');
        let c = newCampaign(1);
        for (let i = 0; i < 19; i++) c = commit(c, { kind: 'layLow' }).campaign;
        expect(campaignHeistRefusal(c, options.world, c.contracts[0]!.id)).toBe('The Raid comes first');
        expect(campaignHeistRefusal(newCampaign(1), options.world, 'd1-low')).toBeUndefined();
    });
});

describe("the campaign's money in planning and play (M6-03)", () => {
    it("plans with the campaign's money, favours and armoury; the sandbox keeps its $24k and free gear", () => {
        const storage = started();
        const purse = campaignPurse(loadCampaign(storage)!, options.world);
        expect(purse).toMatchObject({ cash: 24000, favours: 8 });
        const setup = defaultSetup(options);
        expect(setupProblems(setup, options, purse)).toEqual([]);
        // Gear the armoury doesn't hold: refused in the campaign, free in the sandbox.
        setup.crew[0]!.loadout.primary = 'lmg';
        expect(setupProblems(setup, options, purse)).toEqual(['The armoury has 0 lmg, the plan takes 1']);
        expect(setupProblems(setup, options)).toEqual([]);
        // Cut to the armoury, the plan opens playable.
        expect(gearOf(fitArmoury(structuredClone(setup), purse))).not.toContain('lmg');
        expect(fitArmoury(structuredClone(setup))).toEqual(setup);
        // Assets beyond the campaign's money.
        const poor = { ...purse, cash: 5000 };
        const base = defaultSetup(options);
        const spot = options.spots.ramTruck.find(s => setupProblems({ ...base, vehicles: { ...base.vehicles, ramTruck: s.id } }, options).length === 0);
        expect(spot).toBeDefined();
        const ram = { ...base, vehicles: { ...base.vehicles, ramTruck: spot!.id } };
        {
            expect(setupProblems(ram, options, poor)).toContain('Not enough cash: $8k of $5k');
            // From the address too: an edited plan plays only within the purse.
            expect(setupFromAddress(JSON.stringify(ram), options, {}, poor)).toBeUndefined();
            expect(setupProblems(ram, options)).toEqual([]);
            expect(setupFromAddress(JSON.stringify(ram), options, {})).toBeDefined();
        }
    });

    it('buys intel from the campaign at once: paid, saved, known on reload, and its favours count against the cap', () => {
        const storage = started();
        const done = buyCampaignIntel(storage, options.world, 'guardRota');
        if ('refused' in done) throw new Error(done.refused);
        // Reloading the planning page: the rota is known, free, and can't be bought or charged again.
        const c = loadCampaign(storage)!;
        expect(c.money.clean).toBe(21000);
        expect(campaignIntel(c, options.world).guardRota).toBe(true);
        expect(campaignPurse(c, options.world)).toMatchObject({ cash: 21000, favours: 7 });
        expect(buyCampaignIntel(storage, options.world, 'guardRota')).toEqual({ refused: 'Known already' });
        expect(loadCampaign(storage)!.money.clean).toBe(21000);
        const setup = defaultSetup(options, campaignIntel(c, options.world));
        expect(setupProblems({ ...setup, guardRota: true }, options, campaignPurse(c, options.world))).toContain('The crew has the guard rota already');
        // An address claiming the rota as bought again is refused; one that doesn't plays knowing it.
        expect(setupFromAddress(JSON.stringify({ ...setup, guardRota: true }), options, campaignIntel(c, options.world), campaignPurse(c, options.world))).toBeUndefined();
        expect(setupFromAddress(JSON.stringify({ ...setup, intel: {} }), options, campaignIntel(c, options.world), campaignPurse(c, options.world))?.intel.guardRota).toBe(true);
    });

    it("pays the plan's assets and takes its gear as the heist starts, and an abandoned one gives neither back", () => {
        const storage = started();
        const { tag } = campaignHeist(storage, s => { s.nest = false; });
        expect(tag.day).toBe(1);
        const c = loadCampaign(storage)!;
        const setup = defaultSetup(options);
        expect(c.visit!.job).toEqual({ crew: ['mara', 'jun', 'dex', 'sol'], kits: Object.fromEntries(setup.crew.map(m => [m.id, gearOf({ ...setup, crew: [m] })])), stakes: 'medium' });
        expect(c.visit!.job!.kits.dex).toEqual(['shotgun', 'mediumArmour', 'breachCharge', 'flashbang']);
        expect(c.armoury).toEqual({});
        expect(campaignAct(storage, { kind: 'layLow' })).toMatchObject({ campaign: { armoury: {}, money: { clean: 24000, dirty: 0 } } });
    });

    it("brings the take in once as the heist ends, less the crew's shares, with the gear those who escaped carry", () => {
        const storage = started();
        const { session, tag } = campaignHeist(storage);
        const keep = campaignKeeper(storage, tag);
        // Sol escaped with his kit and a shotgun off a guard; the rest were taken, Dex's shotgun with them.
        const sol = { ...session.state.crew.find(c => c.id === 'sol')! };
        sol.loadout = { ...sol.loadout, items: [...sol.loadout.items, 'shotgun'] };
        const ended = {
            ...session.state, crew: session.state.crew.filter(c => c.id !== 'sol'), escaped: [{ crew: sol, vehicle: 'van', turn: 3 }],
            outcome: { result: 'partial', turn: 3, vehicle: 'van', escaped: ['sol'], arrested: ['mara', 'jun', 'dex'], dead: [], loot: [], value: 50000, ruined: 0, target: 75000, heat: 2 }
        } as typeof session.state;
        expect(gearKept(session.world, ended).sol!.sort()).toEqual(['dmr', 'lightVest', 'medkit', 'pistol', 'shotgun']);
        // A medkit comes back only unused: one use spent and the kit is gone (2 uses a kit).
        const used = (medkits: number) => ({ ...ended, escaped: [{ ...ended.escaped[0]!, crew: { ...sol, wounds: { ...sol.wounds, medkits } } }] }) as typeof ended;
        expect(sol.wounds.medkits).toBe(2);
        expect(gearKept(session.world, used(1)).sol).not.toContain('medkit');
        expect(gearKept(session.world, used(0)).sol).not.toContain('medkit');
        keep(session.world, ended);
        let c = loadCampaign(storage)!;
        expect(c.visit).toMatchObject({ result: 'partial', payout: 30000 });
        expect(c.money).toEqual({ clean: 24000, dirty: 30000 });
        expect(c.armoury).toEqual({ dmr: 1, lightVest: 1, medkit: 1, pistol: 1 });
        // Saved again, resumed, or reloaded: counted once (the heist is dropped).
        expect(keep(session.world, ended)).toBe('drop');
        expect(campaignKeeper(storage, tag)(session.world, ended)).toBe('drop');
        expect(loadCampaign(storage)!.money.dirty).toBe(30000);
        // The next day launders it.
        c = (campaignAct(storage, { kind: 'layLow' }) as { campaign: typeof c }).campaign;
        expect(c.money).toEqual({ clean: 54000, dirty: 0 });
    });

    it("a heist's start is refused when the campaign's money no longer covers it (spent in another tab)", () => {
        const storage = started();
        expect(campaignAct(storage, { kind: 'buy', item: 'smg', count: 2 })).toMatchObject({ campaign: { money: { clean: 8000 } } });
        // A plan checked against yesterday's purse: $9k of assets.
        const job = campaignJob(defaultSetup(options), 'low');
        expect(campaignAct(storage, { kind: 'heist', bank: print, contract: 'd1-low', ...job, cost: 9000 })).toEqual({ refused: 'Not enough money' });
        expect(loadCampaign(storage)).toMatchObject({ day: 1, money: { clean: 8000 }, armoury: { smg: 2, pistol: 2 } });
    });
});
