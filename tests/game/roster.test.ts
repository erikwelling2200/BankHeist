import { describe, expect, it } from 'vitest';
import { commitCampaign, drawRecruits, newCampaign, recruitLook, type Campaign } from '../../src/campaign';
import { campaignCrew, campaignKeeper, campaignPurse, crewFates, loadCampaign, saveCampaign } from '../../src/game/campaign';
import { getawayDrive } from '../../src/game/actions';
import { startHeist } from '../../src/game/heist';
import { campaignPrint } from '../../src/game/intel';
import { crewLookOf, defaultSetup, heistFromSetup, planOptions, setupProblems } from '../../src/game/plan';
import { MemoryStorage } from '../../src/game';
import { commit, crewLook, dealHarm, readProfile, startCarrier, type Command, type ReadonlyWorld, type State } from '../../src/sim';
import { leaveOnFoot } from '../../src/sim/rules/getaway';
import { cachedBank } from '../bankCache';
import { registerTestCommand, testCommand } from '../sim/helpers';

/*
 * The roster in the game (M6-04): the planning screen picks from the campaign's crew free to go, a contract's size of
 * them; the heist's crew carry their traits and Notoriety into the rules, which read Known crew one profile higher; and
 * the heist's end tells the campaign what became of each of them.
 */

const bank = cachedBank({ layout: 31, population: 2, tier: 'small', archetype: 'twoWing' });
const options = planOptions(bank);

// The rules' own harm, alarm and leaving on foot, as an attack, a carrier and a route out deal them.
registerTestCommand('rosterHarm', (ctx, cmd) => {
    const c = cmd as unknown as { target: string; by?: string };
    dealHarm(ctx, { target: c.target, by: c.by ?? 'test', cause: 'shot', weapon: 'pistol', hits: 1, damage: 99, lethal: true });
});
registerTestCommand('rosterAlarm', ctx => {
    const m = ctx.state.crew[0]!;
    startCarrier(ctx, { kind: 'tellerButton', source: 'test', pos: m.pos, countdown: ctx.world.rules.minCarrierCountdown });
});
registerTestCommand('rosterLeave', (ctx, cmd) => leaveOnFoot(ctx, ctx.state.crew.find(c => c.id === (cmd as unknown as { crew: string }).crew)!, 'sewer'));
const down = (target: string, by?: string): Command => testCommand({ type: 'rosterHarm', target, ...(by ? { by } : {}) } as never);
const play = (world: ReadonlyWorld, state: State, ...cmds: Command[]): State => cmds.reduce((s, cmd) => commit(world, s, cmd).state, state);

/** A campaign whose day 1 is a low-stakes heist with the default plan, started with its keeper, saved. */
function campaignHeist(seed: number) {
    const storage = new MemoryStorage();
    let c = newCampaign(seed);
    const pool = campaignCrew(c, 'low'), setup = defaultSetup(options, {}, pool);
    const offer = c.contracts.find(k => k.stakes === 'low')!;
    c = commitCampaign(c, { kind: 'heist', bank: campaignPrint(options.world), contract: offer.id, job: { crew: setup.crew.map(m => m.id), kits: Object.fromEntries(setup.crew.map(m => [m.id, []])), stakes: 'low' } }).campaign;
    saveCampaign(storage, c);
    const tag = { seed: c.seed, day: 1 };
    const session = startHeist(bank, storage, { keepIntel: campaignKeeper(storage, tag) }, setup, tag, pool);
    return { storage, tag, session, ids: setup.crew.map(m => m.id) };
}

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

describe('an abandoned heist (decision 513: before the alarm the crew walk away; after it, anyone still inside is arrested)', () => {
    const abandon = (storage: MemoryStorage) => commitCampaign(loadCampaign(storage)!, { kind: 'layLow' });
    const statuses = (c: Campaign, ids: string[]) => ids.map(id => c.roster.find(m => m.id === id)!.status);
    const endTurn: Command = { type: 'endTurn' };
    const alarm = testCommand({ type: 'rosterAlarm' } as never);
    const raised = (world: ReadonlyWorld, s: State): State => {
        for (let i = 0; i < 6 && !s.bank.alarm; i++) s = commit(world, s, endTurn).state;
        expect(s.bank.alarm).toBe(true);
        return s;
    };
    /** Puts a crew member at a route's way in (test-only), then takes it off the plot by the rules' Enter route. */
    registerTestCommand('rosterToRoute', (ctx, cmd) => {
        const m = ctx.state.crew.find(c => c.id === (cmd as unknown as { crew: string }).crew)!;
        m.pos = { ...ctx.world.routes![0]!.outside };
    });

    it('before the alarm: everyone walks away, the downed carried out, priced as walking away empty-handed (decision 488)', () => {
        const { storage, tag, session, ids } = campaignHeist(7);
        const [a, b, c] = ids as [string, string, string];
        const s = play(session.world, session.state, down(a, b));
        expect(s.bank.alarm).toBe(false);
        expect(crewFates(s)).toEqual({ escaped: [a, b, c], arrested: [], dead: [], downed: [a], killers: [] });
        campaignKeeper(storage, tag)(session.world, s);
        const before = loadCampaign(storage)!;
        const { campaign: d, events } = abandon(storage);
        expect(d.days.at(-1)).toMatchObject({ action: 'layLow' });
        expect(events).not.toContainEqual(expect.objectContaining({ type: 'jobFailed' }));
        expect(events.filter(e => e.type === 'squeeze').map(e => e.type === 'squeeze' && e.source)).toEqual(['day']);
        expect(statuses(d, ids)).toEqual(['injured', 'ready', 'ready']);
        expect(d.roster.filter(m => ids.includes(m.id)).every(m => m.jobs === 1)).toBe(true);
        expect(d.debrief).toMatchObject({ result: 'partial', abandoned: true });
        // Their kits come back to the armoury, as a drive-off's would.
        const kits = Object.values(before.visit!.job!.kits).flat();
        for (const id of new Set(kits)) expect((d.armoury[id] ?? 0) - (before.armoury[id] ?? 0)).toBe(kits.filter(k => k === id).length);
    });

    it('before the alarm, with the crew all down and nobody away: each bleeds out, a teammate\'s kill, never their own', () => {
        const { storage, tag, session, ids } = campaignHeist(7);
        const [a, b, c] = ids as [string, string, string];
        const s = play(session.world, session.state, down(a, b), down(b), down(c, c));
        expect(s.bank.alarm).toBe(false);
        const fates = crewFates(s);
        // Mara is Jun's kill; Dex downed himself, so nobody's.
        expect(fates).toEqual({ escaped: [], arrested: [], dead: [a, b, c], downed: [], killers: [b] });
        // What End Turn would have made of them.
        let played = s;
        for (let i = 0; i < 10 && !played.outcome; i++) played = commit(session.world, played, endTurn).state;
        expect(played.outcome).toMatchObject({ result: 'failure', escaped: [], arrested: [] });
        expect(crewFates(played)).toEqual(fates);
        campaignKeeper(storage, tag)(session.world, s);
        const { campaign: d, events } = abandon(storage);
        expect(statuses(d, ids)).toEqual(['dead', 'dead', 'dead']);
        expect(events).toContainEqual({ type: 'jobFailed', day: 1, abandoned: true });
    });

    it('before the alarm, with one away on foot and the rest down: the downed are carried out, not left to die', () => {
        const { session, ids } = campaignHeist(7);
        const [a, b, c] = ids as [string, string, string];
        const s = play(session.world, session.state, testCommand({ type: 'rosterLeave', crew: c } as never), down(a), down(b));
        expect(s.outcome).toBeNull();
        expect(crewFates(s)).toEqual({ escaped: [c, a, b], arrested: [], dead: [], downed: [a, b], killers: [] });
    });

    it('after the alarm: those still on the plot are arrested, up or down; those driven off or on a route out are free', () => {
        const { storage, tag, session, ids } = campaignHeist(7);
        const [a, b, c] = ids as [string, string, string];
        const world = session.world;
        // Dex drives off alone; Mara is downed by Jun, who stands.
        let s = play(world, session.state, down(a, b), alarm);
        for (let i = 0; i < 10 && !s.vehicles.van!.gone; i++) {
            s = commit(world, s, { type: 'drive', crew: c, vehicle: 'van', to: getawayDrive(world, s, 'van')!.to }).state;
            if (!s.vehicles.van!.gone) s = commit(world, s, endTurn).state;
        }
        s = raised(world, s);
        expect(s.escaped.map(e => e.crew.id)).toEqual([c]);
        expect(s.outcome).toBeNull();
        expect(crewFates(s)).toEqual({ escaped: [c], arrested: [a, b], dead: [], downed: [], killers: [] });
        // Jun on a route off the plot instead: free.
        const fled = play(world, s, testCommand({ type: 'rosterToRoute', crew: b } as never), { type: 'enterRoute', crew: b, route: world.routes![0]!.id, escape: true });
        expect(fled.crew.find(m => m.id === b)!.transit).toMatchObject({ escape: true });
        expect(crewFates(fled)).toEqual({ escaped: [c, b], arrested: [a], dead: [], downed: [], killers: [] });
        campaignKeeper(storage, tag)(world, s);
        const { campaign: d, events } = abandon(storage);
        expect(statuses(d, ids)).toEqual(['jailed', 'jailed', 'ready']);
        expect(events).toContainEqual({ type: 'jobFailed', day: 1, abandoned: true });
    });

    it('after the alarm, with the crew all down and nobody away: dead, not arrested', () => {
        const { session, ids } = campaignHeist(7);
        const [a, b, c] = ids as [string, string, string];
        const s = raised(session.world, play(session.world, session.state, alarm, down(a), down(b), down(c, a)));
        expect(crewFates(s)).toMatchObject({ escaped: [], arrested: [], dead: [a, b, c], killers: [a] });
    });
});
