import {
    campaignRefusal, commitCampaign, COMPLICATION_IDS, favoursToday, knownIntel, STAKES, THRESHOLDS, TIER_STAKES, ALL_THRESHOLDS, type Campaign, type CampaignCommand,
    type CampaignEvent, type IntelAsset, type Job
} from '../campaign';
import { intelOf, isItem, ITEMS, SaveFormatError, stableJson, type DeepReadonly, type Intel, type ReadonlyWorld, type State } from '../sim';
import { savedHeist, type CampaignTag } from './heist';
import { ASSETS, FAVOUR_CAP, gearOf, spent, type HeistSetup, type Purse } from './plan';
import { Session, type IntelKeeper } from './session';
import { bankPrint, intelProblem, mergeIntel } from './intel';
import type { SaveStorage } from './storage';

/*
 * The campaign in the game (implementation plan M6-01): its save beside the heist's, the intel it keeps per bank for
 * the planning screen, and what a campaign heist sends back to it as it is played. The campaign itself is pure
 * (src/campaign); this is where it meets storage and the Session.
 *
 * A campaign heist is tagged with its campaign's seed and day (`CampaignTag`, kept with the saved heist's bank): what
 * it learns goes to that campaign, dated that day, never to the bank's intel on this device that `?plan` reads, and the
 * sandbox's heists never reach the campaign. Nothing in the address is ever a source of either (decision 405).
 */

/** The storage key of the campaign in progress. */
export const CAMPAIGN_KEY = 'campaign';
/** The campaign save's format: a save of another format is refused, as the rules' saves are. 2: money (M6-03). */
export const CAMPAIGN_FORMAT = 2;

const PHASES = ['open', 'raid', 'finaleDue', 'over'];
const ACTIONS = ['heist', 'case', 'layLow'];
const RESULTS = ['success', 'partial', 'failure'];
const INTEL_KEYS = ['blueprints', 'guardRota', 'seen', 'routines', 'opportunities'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isDay = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1;
const exactKeys = (v: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean =>
    required.every(k => k in v) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const whole = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const gear = (v: unknown): v is string[] => strings(v) && v.every(id => isItem(id) && ITEMS[id].slot !== 'fixed');

/**
 * Why `value` isn't a campaign, or undefined: exactly a `Campaign`'s fields, each of its type, and a story that holds
 * together (the days spent before today, the thresholds landed those the Squeeze reached, the phase they make). The
 * intel's own records are checked against their bank when read (`campaignIntel`).
 */
export function campaignProblem(value: unknown): string | undefined {
    if (!isRecord(value)) return 'not a campaign';
    const v = value;
    if (!exactKeys(v, ['seed', 'day', 'squeeze', 'complications', 'landed', 'falseTip', 'phase', 'days', 'visit', 'intel', 'money', 'fronts', 'contacts', 'armoury', 'shares'])) {
        return 'a campaign with other fields';
    }
    if (!Number.isInteger(v.seed) || (v.seed as number) < 0 || (v.seed as number) > 0xffffffff) return 'the seed is no seed';
    if (!isDay(v.day)) return 'the day is no day';
    if (!Number.isInteger(v.squeeze) || (v.squeeze as number) < 0) return 'the Squeeze is no count';
    const comps = v.complications;
    if (!strings(comps) || comps.length !== THRESHOLDS.length || !comps.every(id => (COMPLICATION_IDS as string[]).includes(id)) || new Set(comps).size !== comps.length) {
        return 'the complications are not a draw';
    }
    const landed = v.landed;
    if (!Array.isArray(landed) || landed.length > ALL_THRESHOLDS.length || !landed.every((d, i) => isDay(d) && d <= (v.day as number) && (i === 0 || d >= landed[i - 1]))) {
        return 'the thresholds landed are not days';
    }
    if (landed.length < ALL_THRESHOLDS.filter(t => t <= (v.squeeze as number)).length) return 'a threshold reached has not landed';
    if (typeof v.falseTip !== 'boolean') return 'the false tip is neither leaked nor not';
    if (!PHASES.includes(v.phase as string)) return 'the phase is no phase';
    const raided = landed.length === ALL_THRESHOLDS.length;
    if ((v.phase === 'open' && raided) || ((v.phase === 'raid' || v.phase === 'finaleDue') && !raided)) return "the phase isn't the Raid's";
    const days = v.days;
    if (!Array.isArray(days) || days.length !== (v.day as number) - 1) return 'the days spent are not the days before today';
    // No day is spent after the Raid lands (decision 446): it lands on the last day spent.
    if (raided && landed[ALL_THRESHOLDS.length - 1] !== Math.max(1, days.length)) return 'a day was spent after the Raid';
    for (const [i, d] of days.entries()) {
        if (!isRecord(d) || !exactKeys(d, ['day', 'action'], ['bank']) || d.day !== i + 1 || !ACTIONS.includes(d.action as string)
            || (d.action === 'layLow') !== (d.bank === undefined) || (d.bank !== undefined && typeof d.bank !== 'string')) return 'a day spent is no day action';
    }
    if (v.visit !== null) {
        const s = v.visit;
        if (!isRecord(s) || !exactKeys(s, ['kind', 'day', 'bank', 'prior'], ['result', 'job', 'payout']) || !['heist', 'case'].includes(s.kind as string) || !isDay(s.day)
            || typeof s.bank !== 'string' || (s.result !== undefined && (s.kind !== 'heist' || !RESULTS.includes(s.result as string)))) return 'the visit is no visit';
        const j = s.job;
        if (j !== undefined && (s.kind !== 'heist' || !isRecord(j) || !exactKeys(j, ['crew', 'kits', 'stakes']) || !strings(j.crew) || !isRecord(j.kits)
            || !exactKeys(j.kits, j.crew) || !Object.values(j.kits).every(gear) || !STAKES.includes(j.stakes as never))) return "the visit's job is no job";
        // A take is paid in once, as a job ends other than in failure.
        if (s.payout !== undefined && (!whole(s.payout) || j === undefined || s.result === undefined || s.result === 'failure')) return 'the payout is no payout';
        const spent = days[(s.day as number) - 1] as Record<string, unknown> | undefined;
        if (!spent || spent.action !== s.kind || spent.bank !== s.bank) return 'the visit is not a day spent';
        if (s.day !== days.length) return 'the visit is not the last day spent';
        const p = s.prior;
        if (!isRecord(p) || !exactKeys(p, ['guardRota', 'routines', 'opportunities']) || typeof p.guardRota !== 'boolean' || !strings(p.routines)
            || !strings(p.opportunities)) return 'what the visit knew before is not intel';
    }
    if (!isRecord(v.intel)) return 'the intel is not per bank';
    for (const records of Object.values(v.intel)) {
        // Learned on a day spent; bought (with its favours) on a day spent or today.
        if (!Array.isArray(records) || !records.every(r => isRecord(r) && exactKeys(r, ['day', 'intel'], ['favours']) && isDay(r.day)
            && (r.favours === undefined ? r.day < (v.day as number) : whole(r.favours) && r.day <= (v.day as number))
            && isRecord(r.intel) && Object.keys(r.intel).every(k => INTEL_KEYS.includes(k)))) return 'the intel is not dated intel';
    }
    const m = v.money;
    if (!isRecord(m) || !exactKeys(m, ['clean', 'dirty']) || !whole(m.clean) || !whole(m.dirty)) return 'the money is no money';
    if (!whole(v.fronts) || !whole(v.contacts)) return 'the fronts or contacts are no count';
    if (!isRecord(v.armoury) || !Object.entries(v.armoury).every(([id, n]) => gear([id]) && Number.isInteger(n) && (n as number) >= 1)) return 'the armoury is not gear';
    if (!isRecord(v.shares) || !Object.values(v.shares).every(n => whole(n) && n <= 100)) return 'the shares are not shares';
    return undefined;
}

export function serialiseCampaign(campaign: DeepReadonly<Campaign>): string {
    return stableJson({ format: CAMPAIGN_FORMAT, campaign });
}

/** The campaign in a save. Throws `SaveFormatError` for another format or anything that isn't a campaign. */
export function deserialiseCampaign(text: string): Campaign {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        throw new SaveFormatError("The campaign save isn't JSON");
    }
    if (!isRecord(data)) throw new SaveFormatError("The campaign save isn't one");
    if (data.format !== CAMPAIGN_FORMAT) throw new SaveFormatError(`The campaign save has format ${String(data.format)}, this build reads format ${CAMPAIGN_FORMAT}`);
    if (!exactKeys(data, ['format', 'campaign'])) throw new SaveFormatError("The campaign save isn't one");
    const problem = campaignProblem(data.campaign);
    if (problem) throw new SaveFormatError(`The campaign save is broken: ${problem}`);
    return data.campaign as Campaign;
}

/** Why the last `loadCampaign` found none (null when there simply was none, or it worked). */
export let lastCampaignError: unknown = null;

/** The campaign in progress on this device, or null (none, or one that can't be read: `lastCampaignError` says why). */
export function loadCampaign(storage: SaveStorage): Campaign | null {
    lastCampaignError = null;
    try {
        const text = storage.get(CAMPAIGN_KEY);
        return text === null ? null : deserialiseCampaign(text);
    } catch (e) {
        lastCampaignError = e;
        return null;
    }
}

/** Saves the campaign; false when it can't be stored (a full quota). */
export function saveCampaign(storage: SaveStorage, campaign: DeepReadonly<Campaign>): boolean {
    try {
        storage.set(CAMPAIGN_KEY, serialiseCampaign(campaign));
        return true;
    } catch {
        return false;
    }
}

/**
 * Does `cmd` to the saved campaign and saves the result: the new campaign and what happened, or why not (no campaign,
 * refused, or it couldn't be saved: then nothing happened, so no day is ever spent unsaved).
 */
export function campaignAct(storage: SaveStorage, cmd: CampaignCommand): { campaign: Campaign; events: CampaignEvent[] } | { refused: string } {
    const campaign = loadCampaign(storage);
    if (!campaign) return { refused: 'No campaign' };
    const refused = campaignRefusal(campaign, cmd);
    if (refused) return { refused };
    const done = commitCampaign(campaign, cmd);
    return saveCampaign(storage, done.campaign) ? done : { refused: "The campaign couldn't be saved" };
}

/** What the campaign's crew knows of this bank today (§17.8 aged by days, decision 442): its records merged, each read as this bank's. */
export function campaignIntel(campaign: DeepReadonly<Campaign>, world: ReadonlyWorld): Intel {
    return knownIntel(campaign as Campaign, bankPrint(world)).filter(i => intelProblem(i, world) === undefined).reduce<Intel>((a, b) => mergeIntel(a, b, world), {});
}

/**
 * What the campaign's plan of the day may spend in a bank (M6-03): its clean money, the favours the intel bought there
 * today left under the cap (§18.1), and the armoury's gear.
 */
export function campaignPurse(campaign: DeepReadonly<Campaign>, world: ReadonlyWorld): Purse {
    return { cash: campaign.money.clean, favours: FAVOUR_CAP - favoursToday(campaign, bankPrint(world)), armoury: { ...campaign.armoury } };
}

/** What a plan takes on as the campaign's heist (§19.4): its crew, their gear, the stakes of the bank's tier, and its assets' cost. */
export function campaignJob(setup: HeistSetup, tier: string): { job: Job; cost: number } {
    const kits = Object.fromEntries(setup.crew.map(c => [c.id, gearOf({ ...setup, crew: [c] })]));
    return { job: { crew: setup.crew.map(c => c.id), kits, stakes: TIER_STAKES[tier] ?? 'low' }, cost: spent(setup).cash };
}

/**
 * Buys an intel asset for the campaign's heist in a bank (decision 401 in the campaign): paid from the campaign's money
 * and saved at once, known from then on, so reloading the planning page neither forgets nor charges it again.
 */
export function buyCampaignIntel(storage: SaveStorage, world: ReadonlyWorld, asset: IntelAsset): ReturnType<typeof campaignAct> {
    return campaignAct(storage, { kind: 'buyIntel', bank: bankPrint(world), asset, cost: ASSETS[asset].cost, favours: ASSETS[asset].favours });
}

/** A heist's take as the campaign counts it: the loot's value that left, in whole dollars, never negative. */
const takeOf = (state: DeepReadonly<State>): number => {
    const value = state.outcome?.value ?? 0;
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
};

/**
 * The gear each crew member who escaped carries out of a heist, by crew id (their loadouts but the fixed items): what
 * may come back to the armoury (the campaign takes back only their own kit). A medkit comes back only unused: a crew
 * member's medkits share their uses (`wounds.medkits`, `rules.medkitUses` a kit), so only the whole kits' worth left.
 */
export function gearKept(world: ReadonlyWorld, state: DeepReadonly<State>): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const { crew } of state.escaped) {
        const items = crew.loadout.items.filter(id => isItem(id) && ITEMS[id].slot !== 'fixed');
        const kits = items.filter(id => id === 'medkit').length;
        const unused = Math.min(kits, Math.floor(crew.wounds.medkits / Math.max(1, world.rules.medkitUses)));
        out[crew.id] = [...items.filter(id => id !== 'medkit'), ...Array.from({ length: unused }, () => 'medkit')];
    }
    return out;
}

/**
 * What a campaign heist does after each save (`SessionOptions.keepIntel`): what it has learned goes to its campaign day,
 * and its end, once, to the campaign (a failure is a failed job, §19.2). Every save from the first counts: the day is
 * spent at the start (decision 441). When the saved campaign is no longer the one it was played for, or its day is
 * over (a day action came after it, perhaps in another tab), the heist is dropped (`'drop'`): it sends nothing and is
 * saved no more, and so once its result is in (it ended, or a day action abandoned it into the Raid). A campaign that
 * can't be read drops nothing.
 */
export function campaignKeeper(storage: SaveStorage, tag: CampaignTag): IntelKeeper {
    let kept: string | null = null;
    return (world, state) => {
        const campaign = loadCampaign(storage);
        if (!campaign) return lastCampaignError === null ? 'drop' : undefined;
        const bank = bankPrint(world);
        if (campaign.seed !== tag.seed || campaign.visit?.day !== tag.day || campaign.visit.bank !== bank) return 'drop';
        // Its result is in already (it ended, or was abandoned into the Raid): it learns nothing more for the campaign.
        if (campaign.visit.result) return 'drop';
        const intel = intelOf(world, state), text = stableJson(intel), ended = state.outcome?.result;
        let next = campaign;
        if (text !== kept) next = commitCampaign(next, { kind: 'learn', bank, day: tag.day, intel }).campaign;
        // Its end, with its take and the gear that came back: once, since a visit with a result takes no other (and drops the heist).
        if (ended && next.visit?.kind === 'heist' && !next.visit.result) {
            next = commitCampaign(next, { kind: 'heistOver', day: tag.day, result: ended, take: takeOf(state), kept: gearKept(world, state) }).campaign;
        }
        if (next !== campaign && saveCampaign(storage, next)) kept = text;
        return undefined;
    };
}

/**
 * The keeper of a resumed heist that carries no campaign tag: the device's intel as usual (`'device'`), unless the
 * campaign's day is an unfinished heist in this very bank. That may be the campaign's heist with its tag lost, and
 * what it learns must not reach the sandbox's free intel either.
 */
export function untaggedKeeper(storage: SaveStorage): IntelKeeper {
    return world => {
        const campaign = loadCampaign(storage);
        return campaign && heistUnfinished(campaign) && campaign.visit!.bank === bankPrint(world) ? undefined : 'device';
    };
}

/** The tag of the campaign day's heist about to start in a bank, or why it can't start. */
export function campaignHeistRefusal(campaign: Campaign | null, world: ReadonlyWorld): string | undefined {
    if (!campaign) return 'No campaign';
    return campaignRefusal(campaign, { kind: 'heist', bank: bankPrint(world) });
}

/** Whether the campaign's day was spent on a heist that hasn't ended: the next day action abandons it (decision 443). */
export const heistUnfinished = (campaign: DeepReadonly<Campaign>): boolean => campaign.visit?.kind === 'heist' && !campaign.visit.result;

/**
 * Forgets the saved heist when it is one of this campaign's (its day is over: a day action came after it, or a new
 * campaign replaces this one), so it can't be played on, or send what it learns, once its day is gone.
 */
export function dropCampaignHeist(storage: SaveStorage, seed: number): void {
    if (savedHeist(storage)?.campaign?.seed === seed) Session.clear(storage);
}
