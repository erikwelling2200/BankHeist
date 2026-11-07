import { describe, expect, it } from 'vitest';
import { commitCampaign, knownBefore, newCampaign, type Campaign, type CampaignCommand } from '../../src/campaign';
import {
    CAMPAIGN_FORMAT, CAMPAIGN_KEY, campaignAct, campaignHeistRefusal, campaignIntel, campaignKeeper, campaignProblem, deserialiseCampaign, dropCampaignHeist,
    heistUnfinished, loadCampaign, saveCampaign, serialiseCampaign
} from '../../src/game/campaign';
import { savedHeist, startHeist, type CampaignTag } from '../../src/game/heist';
import { bankPrint, intelKey } from '../../src/game/intel';
import { defaultSetup, planOptions } from '../../src/game/plan';
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
function campaignHeist(storage: MemoryStorage): { session: Session; tag: CampaignTag } {
    const campaign = loadCampaign(storage)!;
    const setup = defaultSetup(options, campaignIntel(campaign, options.world));
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
