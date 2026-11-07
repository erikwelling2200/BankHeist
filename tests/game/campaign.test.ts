import { describe, expect, it } from 'vitest';
import { commitCampaign, knownBefore, newCampaign, type Campaign, type CampaignCommand } from '../../src/campaign';
import {
    CAMPAIGN_FORMAT, CAMPAIGN_KEY, campaignAct, campaignHeistRefusal, campaignIntel, campaignKeeper, campaignProblem, deserialiseCampaign, dropCampaignHeist,
    heistUnfinished, loadCampaign, saveCampaign, serialiseCampaign, untaggedKeeper
} from '../../src/game/campaign';
import { BANK_KEY, GEN_VERSION, savedHeist, startHeist, type CampaignTag } from '../../src/game/heist';
import { bankPrint, intelKey } from '../../src/game/intel';
import { defaultSetup, heistFromSetup, planOptions, type HeistSetup } from '../../src/game/plan';
import { HEIST_KEY, MemoryStorage, Session } from '../../src/game';
import { intelOf, SaveFormatError } from '../../src/sim';
import { cachedBank } from '../bankCache';

/*
 * The campaign in the game (M6-01): its save and load, intel kept per campaign day rather than per device, and a
 * campaign heist paying for what it scouts with its day (decision 406's must-do).
 */

const bank = cachedBank({ layout: 31, population: 2, tier: 'small', archetype: 'twoWing' });
const options = planOptions(bank);
const print = bankPrint(options.world);

/** A campaign heist as the game starts one: the day spent and saved first, then the heist tagged with it. */
function campaignHeist(storage: MemoryStorage, change: (s: HeistSetup) => void = () => {}): { session: Session; tag: CampaignTag } {
    const campaign = loadCampaign(storage)!;
    const setup = defaultSetup(options, campaignIntel(campaign, options.world));
    change(setup);
    const done = campaignAct(storage, { kind: 'heist', bank: print });
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
        const cmds: CampaignCommand[] = [{ kind: 'heist', bank: print }, { kind: 'learn', bank: print, day: 1, intel: { routines: ['x'], seen: 'AB' } }, { kind: 'layLow' },
            { kind: 'squeeze', source: 'falseTip' }, { kind: 'case', bank: 'other' }];
        for (const cmd of cmds) c = commitCampaign(c, cmd).campaign;
        const text = serialiseCampaign(c);
        expect(deserialiseCampaign(text)).toEqual(c);
        expect(JSON.parse(text).format).toBe(CAMPAIGN_FORMAT);
        const storage = new MemoryStorage();
        expect(saveCampaign(storage, c)).toBe(true);
        expect(loadCampaign(storage)).toEqual(c);
        // Every day of a whole campaign reads back.
        let all = newCampaign(2);
        for (let i = 0; i < 19; i++) {
            all = commitCampaign(all, { kind: 'layLow' }).campaign;
            expect(campaignProblem(JSON.parse(JSON.stringify(all)))).toBeUndefined();
        }
    });

    it('refuses another format, and anything that is not a campaign', () => {
        const c = newCampaign(1);
        expect(() => deserialiseCampaign(JSON.stringify({ format: CAMPAIGN_FORMAT + 1, campaign: c }))).toThrow(SaveFormatError);
        expect(() => deserialiseCampaign(JSON.stringify({ campaign: c }))).toThrow(/format undefined/);
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
        // The review's probe, as the old rules saved it: a heist abandoned into the Raid, and a day spent after it.
        let raid = newCampaign(1);
        for (let i = 0; i < 17; i++) raid = commitCampaign(raid, { kind: 'layLow' }).campaign;
        raid = commitCampaign(raid, { kind: 'heist', bank: 'b' }).campaign;
        raid = commitCampaign(raid, { kind: 'heist', bank: 'c' }).campaign;
        expect(campaignProblem(raid)).toBeUndefined();
        const after = structuredClone(raid);
        after.days.push({ day: 19, action: 'heist', bank: 'c' });
        after.day = 20;
        after.squeeze = 40;
        after.visit = { kind: 'heist', day: 19, bank: 'c', prior: { guardRota: false, routines: [], opportunities: [] } };
        expect(campaignProblem(after)).toBe('a day was spent after the Raid');
        // A visit that isn't the last day spent.
        let two = commitCampaign(newCampaign(1), { kind: 'heist', bank: 'b' }).campaign;
        two = commitCampaign(two, { kind: 'heistOver', day: 1, result: 'success' }).campaign;
        const visit = two.visit;
        two = commitCampaign(two, { kind: 'layLow' }).campaign;
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
        const done = campaignAct(storage, { kind: 'heist', bank: print });
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
        campaignAct(full, { kind: 'heist', bank: print });
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
        for (let i = 0; i < 17; i++) c = commitCampaign(c, { kind: 'layLow' }).campaign;
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
        expect(campaignHeistRefusal(null, options.world)).toBe('No campaign');
        let c = newCampaign(1);
        for (let i = 0; i < 19; i++) c = commitCampaign(c, { kind: 'layLow' }).campaign;
        expect(campaignHeistRefusal(c, options.world)).toBe('The Raid comes first');
        expect(campaignHeistRefusal(newCampaign(1), options.world)).toBeUndefined();
    });
});
