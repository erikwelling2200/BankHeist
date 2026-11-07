import { describe, expect, it } from 'vitest';
import {
    ALL_THRESHOLDS, campaignRefusal, COMPLICATION_IDS, drawComplications, INTEL_FRESH_DAYS, knownBefore, knownIntel, learnedOf, newCampaign,
    nextStep, projectedDay, RAID_AT, SQUEEZE, THRESHOLDS, timeline, type Campaign, type CampaignEvent
} from '../../src/campaign';
import { commit, contracted, type TestCommand } from './contracted';

/*
 * The campaign's core (M6-01, GAME_DESIGN §19.2, §19.3): days, the Squeeze, its thresholds and complications, the Raid,
 * and intel that ages with the days.
 */

const run = (c: Campaign, ...cmds: TestCommand[]): { campaign: Campaign; events: CampaignEvent[] } => {
    let events: CampaignEvent[] = [];
    for (const cmd of cmds) {
        const done = commit(c, cmd);
        c = done.campaign;
        events = [...events, ...done.events];
    }
    return { campaign: c, events };
};
const days = (n: number): TestCommand[] => Array.from({ length: n }, () => ({ kind: 'layLow' }) as const);

describe('the Squeeze (§19.2)', () => {
    it('has the thresholds and gains §19.2 lists', () => {
        expect(THRESHOLDS).toEqual([8, 15, 21, 26, 30, 33, 36]);
        expect(RAID_AT).toBe(38);
        expect(SQUEEZE).toEqual({ day: 2, notoriety: 1, failedJob: 2, talked: 4, falseTip: -5 });
    });

    it('with only the daily +2, lands the complications on days 4, 8, 11, 13, 15, 17 and 18 and the Raid on day 19', () => {
        const fresh = newCampaign(7);
        expect(timeline(fresh).map(s => s.day)).toEqual([4, 8, 11, 13, 15, 17, 18, 19]);
        // Played out day by day, they land on the days projected.
        const { campaign, events } = run(fresh, ...days(19));
        expect(campaign.landed).toEqual([4, 8, 11, 13, 15, 17, 18, 19]);
        expect(events.filter(e => e.type === 'complication').map(e => (e as { day: number }).day)).toEqual([4, 8, 11, 13, 15, 17, 18]);
        expect(events.filter(e => e.type === 'raid')).toEqual([{ type: 'raid', day: 19 }]);
        expect(campaign.phase).toBe('raid');
        expect(campaign.squeeze).toBe(38);
    });

    it('lands each complication once, in the drawn order, and a jump past two lands both', () => {
        let c = run(newCampaign(3), ...days(3)).campaign;
        expect(c.squeeze).toBe(6);
        // A prisoner talks (+4) and a failed job: 10, then a jump of 8 past 15.
        const r = run(c, { kind: 'squeeze', source: 'talked' }, { kind: 'squeeze', source: 'notoriety', count: 8 });
        c = r.campaign;
        expect(c.squeeze).toBe(18);
        expect(r.events.filter(e => e.type === 'complication').map(e => (e as { id: string }).id)).toEqual(c.complications.slice(0, 2));
        expect(c.landed).toEqual([3, 3]);
    });

    it('the false tip lowers the points once, and never takes a landed complication back', () => {
        let c = run(newCampaign(1), ...days(4)).campaign;
        expect(c.landed).toEqual([4]);
        c = run(c, { kind: 'squeeze', source: 'falseTip' }).campaign;
        expect(c.squeeze).toBe(3);
        expect(c.landed).toEqual([4]);
        expect(campaignRefusal(c, { kind: 'squeeze', source: 'falseTip' })).toBe('The false tip was leaked already');
        // Climbing back past 8 lands nothing again; the next lands at 15.
        c = run(c, ...days(3)).campaign;
        expect(c.squeeze).toBe(9);
        expect(c.landed).toEqual([4]);
        expect(nextStep(c)).toMatchObject({ at: 15, day: projectedDay(15, 9, c.day) });
        // Never below zero.
        expect(run(newCampaign(1), { kind: 'squeeze', source: 'falseTip' }).campaign.squeeze).toBe(0);
    });

    it('moves the projected days forward on the spot when something else adds Squeeze', () => {
        const c = newCampaign(5);
        const later = run(c, { kind: 'squeeze', source: 'talked' }).campaign;
        expect(timeline(later).map(s => s.day)).toEqual([2, 6, 9, 11, 13, 15, 16, 17]);
    });
});

describe('complications (§19.2)', () => {
    it('are drawn from the pool when the campaign starts: one per threshold, no repeats, the same for the same seed', () => {
        const a = drawComplications(42);
        expect(a).toHaveLength(THRESHOLDS.length);
        expect(new Set(a).size).toBe(a.length);
        expect(a.every(id => COMPLICATION_IDS.includes(id))).toBe(true);
        expect(drawComplications(42)).toEqual(a);
        expect(COMPLICATION_IDS).toHaveLength(10);
        // Another seed, another order.
        expect([1, 2, 3, 4, 5].some(s => drawComplications(s).join() !== a.join())).toBe(true);
        expect(newCampaign(42).complications).toEqual(a);
    });

    it('the timeline shows every one, in order, then the Raid', () => {
        const c = newCampaign(9);
        const t = timeline(c);
        expect(t.map(s => s.at)).toEqual(ALL_THRESHOLDS);
        expect(t.slice(0, 7).map(s => s.complication)).toEqual(c.complications);
        expect(t[7]).toMatchObject({ complication: null, name: 'The Raid' });
    });
});

describe('days (§19.3)', () => {
    it('a heist, casing and laying low each spend the day, and nothing else does', () => {
        const r = run(newCampaign(1), { kind: 'heist', bank: 'b1' }, { kind: 'heistOver', day: 1, result: 'success' }, { kind: 'case', bank: 'b2' }, { kind: 'layLow' },
            { kind: 'squeeze', source: 'notoriety', count: 2 });
        expect(r.campaign.day).toBe(4);
        expect(r.campaign.days).toEqual([{ day: 1, action: 'heist', bank: 'b1' }, { day: 2, action: 'case', bank: 'b2' }, { day: 3, action: 'layLow' }]);
        expect(r.campaign.squeeze).toBe(8);
        expect(r.events.filter(e => e.type === 'dayPassed')).toHaveLength(3);
    });

    it('a failed job adds 2; a heist abandoned for the next day action is a failed job too', () => {
        const failed = run(newCampaign(1), { kind: 'heist', bank: 'b' }, { kind: 'heistOver', day: 1, result: 'failure' }).campaign;
        expect(failed.squeeze).toBe(4);
        expect(campaignRefusal(failed, { kind: 'heistOver', day: 1, result: 'success' })).toBe('The heist is over already');
        // Abandoned: the next day costs its 2 and the failure's 2.
        const left = run(newCampaign(1), { kind: 'heist', bank: 'b' }, { kind: 'layLow' });
        expect(left.campaign.squeeze).toBe(6);
        expect(left.events).toContainEqual({ type: 'jobFailed', day: 1, abandoned: true });
        // A heist that ended counts once.
        const ended = run(newCampaign(1), { kind: 'heist', bank: 'b' }, { kind: 'heistOver', day: 1, result: 'partial' }, { kind: 'layLow' });
        expect(ended.campaign.squeeze).toBe(4);
        // Only the day's heist can end.
        expect(campaignRefusal(left.campaign, { kind: 'heistOver', day: 1, result: 'success' })).toBe("Not the day's heist");
    });

    it('an abandoned heist settles first: a complication it lands lands, and the day action goes on', () => {
        const r = run(newCampaign(1), ...days(2), { kind: 'heist', bank: 'b' }, { kind: 'layLow' });
        // 4, the heist's day 6, the failure 8 (landing on the heist's day 3), then the day laid low 10.
        expect(r.campaign).toMatchObject({ day: 5, squeeze: 10, landed: [3], visit: null });
        expect(r.events.some(e => e.type === 'stopped')).toBe(false);
    });

    it('an abandoned heist that lands the Raid stops the day action: no day spent, no new visit', () => {
        const before = run(newCampaign(1), ...days(17), { kind: 'heist', bank: 'b' }).campaign;
        expect(before).toMatchObject({ day: 19, squeeze: 36, phase: 'open' });
        for (const cmd of [{ kind: 'heist', bank: 'c' }, { kind: 'case', bank: 'c' }, { kind: 'layLow' }] as TestCommand[]) {
            const r = commit(before, cmd);
            expect(r.campaign).toMatchObject({ day: 19, squeeze: 38, phase: 'raid', visit: { kind: 'heist', day: 18, bank: 'b', result: 'failure' } });
            expect(r.campaign.days).toHaveLength(18);
            expect(r.campaign.landed.at(-1)).toBe(18);
            expect(r.events).toContainEqual({ type: 'raid', day: 18 });
            expect(r.events.at(-1)).toEqual({ type: 'stopped', action: cmd.kind, reason: 'The Raid comes first' });
            expect(r.events.some(e => e.type === 'dayPassed')).toBe(false);
        }
    });

    it('the Raid stops the days: the finale follows it, then the campaign is over', () => {
        const raid = run(newCampaign(1), ...days(19)).campaign;
        expect(campaignRefusal(raid, { kind: 'layLow' })).toBe('The Raid comes first');
        expect(campaignRefusal(raid, contracted(raid, { kind: 'heist', bank: 'b' }))).toBe('The Raid comes first');
        expect(campaignRefusal(raid, { kind: 'finale' })).toBe('The Raid comes first');
        const survived = run(raid, { kind: 'raidOver', survived: true }).campaign;
        expect(survived.phase).toBe('finaleDue');
        expect(campaignRefusal(survived, { kind: 'case', bank: 'b' })).toBe('The finale is due');
        const over = run(survived, { kind: 'finale' }).campaign;
        expect(over.phase).toBe('over');
        expect(campaignRefusal(over, { kind: 'squeeze', source: 'talked' })).toBe('The campaign is over');
        expect(run(raid, { kind: 'raidOver', survived: false }).campaign.phase).toBe('over');
        // The finale any day before.
        expect(run(newCampaign(1), { kind: 'finale' }).campaign.phase).toBe('over');
    });

    it('never changes the campaign it was given', () => {
        const c = newCampaign(1), copy = structuredClone(c);
        commit(c, { kind: 'heist', bank: 'b' });
        expect(c).toEqual(copy);
        expect(() => commit(run(c, ...days(19)).campaign, { kind: 'layLow' })).toThrow('The Raid comes first');
    });
});

describe('intel across days (decisions 441, 442)', () => {
    const seen = 'AAAB';
    const visit = (c: Campaign, bank: string, intel: object) => run(c, { kind: 'heist', bank }, { kind: 'learn', bank, day: c.day, intel }).campaign;

    it('is learned only on the day it was spent on, in the bank of that day', () => {
        const c = run(newCampaign(1), { kind: 'heist', bank: 'b' }).campaign;
        expect(campaignRefusal(c, { kind: 'learn', bank: 'other', day: 1, intel: {} })).toBe("Not the day's visit");
        expect(campaignRefusal(c, { kind: 'learn', bank: 'b', day: 2, intel: {} })).toBe("Not the day's visit");
        // Laying low: no visit to learn from.
        expect(campaignRefusal(run(c, { kind: 'layLow' }).campaign, { kind: 'learn', bank: 'b', day: 1, intel: {} })).toBe("Not the day's visit");
    });

    it('keeps the layout for good and the day-bound parts for INTEL_FRESH_DAYS days', () => {
        let c = visit(newCampaign(1), 'b', { seen, blueprints: true, guardRota: true, routines: ['guard1'], opportunities: [{ id: 'o1', how: 'read' }] });
        expect(c.day).toBe(2);
        expect(knownIntel(c, 'b')).toEqual([{ seen, blueprints: true, guardRota: true, routines: ['guard1'], opportunities: [{ id: 'o1', how: 'read' }] }]);
        c = run(c, ...days(INTEL_FRESH_DAYS - 1)).campaign;
        // Learned on day 1, still good on day 1 + INTEL_FRESH_DAYS.
        expect(c.day).toBe(1 + INTEL_FRESH_DAYS);
        expect(knownBefore(c, 'b')).toEqual({ guardRota: true, routines: ['guard1'], opportunities: ['o1'] });
        c = run(c, { kind: 'layLow' }).campaign;
        expect(knownIntel(c, 'b')).toEqual([{ seen, blueprints: true }]);
        expect(knownBefore(c, 'b')).toEqual({ guardRota: false, routines: [], opportunities: [] });
        // The stale parts are gone from the save too, not only hidden.
        expect(c.intel.b).toEqual([{ day: 1, intel: { seen, blueprints: true } }]);
        // Another bank knows nothing.
        expect(knownIntel(c, 'other')).toEqual([]);
    });

    it('what was known before a visit is not learned again: a routine carried in ages from the day it was learned', () => {
        let c = visit(newCampaign(1), 'b', { routines: ['guard1'] });
        c = run(c, { kind: 'layLow' }).campaign;
        // Day 3: a heist that knows guard1 from day 1 and learns guard2.
        c = visit(c, 'b', { routines: ['guard1', 'guard2'], opportunities: [] });
        expect(c.intel.b).toEqual([{ day: 1, intel: { routines: ['guard1'] } }, { day: 3, intel: { routines: ['guard2'] } }]);
        c = run(c, ...days(INTEL_FRESH_DAYS - 1)).campaign;
        expect(c.day).toBe(1 + INTEL_FRESH_DAYS + 2);
        expect(knownBefore(c, 'b').routines).toEqual(['guard2']);
    });

    it('a visit learning more as it goes replaces its own record; an old visit learning late learns nothing fresh', () => {
        let c = run(newCampaign(1), { kind: 'heist', bank: 'b' }).campaign;
        c = run(c, { kind: 'learn', bank: 'b', day: 1, intel: { routines: ['a'] } }, { kind: 'learn', bank: 'b', day: 1, intel: { routines: ['a', 'b'] } }).campaign;
        expect(c.intel.b).toEqual([{ day: 1, intel: { routines: ['a', 'b'] } }]);
        expect(learnedOf({ guardRota: true, routines: ['a', 'b'] }, { guardRota: true, routines: ['a'], opportunities: [] })).toEqual({ routines: ['b'] });
    });

    it('casing a bank is a visit too (its day-bound intel dated the casing day)', () => {
        const c = run(newCampaign(1), { kind: 'case', bank: 'b' }, { kind: 'learn', bank: 'b', day: 1, intel: { routines: ['x'] } }).campaign;
        expect(knownBefore(c, 'b').routines).toEqual(['x']);
        // A casing isn't a heist: it neither ends nor fails.
        expect(campaignRefusal(c, { kind: 'heistOver', day: 1, result: 'failure' })).toBe("Not the day's heist");
        expect(run(c, { kind: 'layLow' }).campaign.squeeze).toBe(4);
    });
});
