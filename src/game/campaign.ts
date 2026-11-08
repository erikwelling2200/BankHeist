import {
    campaignRefusal, CHAINS, offered, commitCampaign, COMPLICATION_IDS, CREW_BY_STAKES, DECAY_DAYS, favoursToday, knownIntel, MAX_ESCALATION, MAX_NOTORIETY, OBJECTIVE_KINDS,
    OBJECTIVE_OFFERS, readyCrew, ROSTER_MAX, STAKES, THRESHOLDS, ALL_THRESHOLDS, type Campaign, type CampaignCommand, type CampaignEvent, type Contract, type CrewFates,
    type CrewMember, type IntelAsset, type Job, type Stakes
} from '../campaign';
import { ARCHETYPES, PLOTS, TIERS, type GeneratedBank } from '../gen/model';
import { intelOf, isItem, ITEMS, SaveFormatError, stableJson, TRAITS, type DeepReadonly, type Intel, type ReadonlyWorld, type State } from '../sim';
import { bankAddress, sameAddress, savedHeist, type BankAddress, type CampaignTag } from './heist';
import { ASSETS, FAVOUR_CAP, gearOf, rosterMember, spent, type CrewPool, type HeistSetup, type Purse, type RosterMember } from './plan';
import { Session, type IntelKeeper } from './session';
import { campaignPrint, intelProblem, mergeIntel } from './intel';
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
/**
 * The campaign save's format: a save of another format is refused, as the rules' saves are. 2: money (M6-03); 3:
 * contracts (M6-02); 4: the roster (M6-04).
 */
export const CAMPAIGN_FORMAT = 4;

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
const among = (list: readonly string[], v: unknown): boolean => typeof v === 'string' && list.includes(v);

/** Why `value` isn't a contract (src/campaign/contracts.ts), or undefined: its fields, each of its type. */
function contractProblem(value: unknown): string | undefined {
    if (!isRecord(value) || !exactKeys(value, ['id', 'posted', 'expires', 'stakes', 'chain', 'bank', 'escalation', 'bonus'], ['objective'])) return 'a contract with other fields';
    const k = value, b = k.bank;
    if (typeof k.id !== 'string' || !isDay(k.posted) || !isDay(k.expires) || (k.expires as number) < (k.posted as number)) return "the contract's days are not days";
    if (!among(STAKES, k.stakes) || !among(CHAINS, k.chain) || !whole(k.escalation) || (k.escalation as number) > MAX_ESCALATION || !whole(k.bonus)) return 'the contract has no terms';
    if (k.objective !== undefined && !among(OBJECTIVE_KINDS, k.objective)) return "the contract's side objective is none";
    if (!isRecord(b) || !exactKeys(b, ['seed', 'tier', 'archetype', 'plot']) || typeof b.seed !== 'string' || !/^\d+-\d+$/.test(b.seed) || !among(TIERS, b.tier)
        || !among(ARCHETYPES, b.archetype) || !among(PLOTS, b.plot)) return "the contract's bank is no bank";
    return undefined;
}

const STATUSES = ['ready', 'injured', 'jailed', 'dead'];
const traits = (v: unknown): boolean => strings(v) && v.every(t => (TRAITS as readonly string[]).includes(t)) && new Set(v).size === v.length;

/** Why `value` isn't a crew member (src/campaign/roster.ts), or undefined. */
function memberProblem(value: unknown, day: number): string | undefined {
    if (!isRecord(value) || !exactKeys(value, ['id', 'name', 'look', 'traits', 'share', 'notoriety', 'rested', 'jobs', 'traitOffers', 'motive', 'status'],
        ['injured', 'jail', 'died'])) return 'a crew member with other fields';
    const m = value;
    if (typeof m.id !== 'string' || !m.id || typeof m.name !== 'string' || typeof m.look !== 'string') return 'a crew member is no one';
    if (!traits(m.traits) || !Array.isArray(m.traitOffers) || !m.traitOffers.every(o => traits(o) && (o as string[]).length > 0)) return `${m.name}'s traits are not traits`;
    if (!whole(m.share) || (m.share as number) > 100) return `${m.name}'s share is no share`;
    if (!whole(m.notoriety) || (m.notoriety as number) > MAX_NOTORIETY || !whole(m.rested) || (m.rested as number) >= DECAY_DAYS || !whole(m.jobs)) return `${m.name}'s record is no record`;
    if (!STATUSES.includes(m.status as string)) return `${m.name} is nowhere`;
    if ((m.status === 'injured') !== (m.injured !== undefined) || (m.injured !== undefined && !isDay(m.injured))) return `${m.name}'s injury is no injury`;
    if ((m.status === 'dead') !== (m.died !== undefined) || (m.died !== undefined && !(isDay(m.died) && (m.died as number) < day))) return `${m.name}'s death is no death`;
    if ((m.status === 'jailed') !== (m.jail !== undefined)) return `${m.name}'s jail is no jail`;
    const j = m.jail;
    if (j !== undefined && (!isRecord(j) || !exactKeys(j, ['day', 'named', 'talked'], ['out']) || !isDay(j.day) || (j.day as number) >= day || !strings(j.named)
        || typeof j.talked !== 'boolean' || (j.out !== undefined && !isDay(j.out)))) return `${m.name}'s jail is no jail`;
    const o = m.motive;
    if (o !== null) {
        if (!isRecord(o) || typeof o.met !== 'boolean') return `${m.name}'s motive is none`;
        const ok = o.kind === 'debt' ? exactKeys(o, ['kind', 'amount', 'met']) && whole(o.amount) && (o.amount as number) > 0
            : o.kind === 'neverKill' ? exactKeys(o, ['kind', 'met', 'broken']) && typeof o.broken === 'boolean' && !(o.met && o.broken)
                : o.kind === 'getEven' ? exactKeys(o, ['kind', 'chain', 'met']) && among(CHAINS, o.chain) : false;
        if (!ok) return `${m.name}'s motive is none`;
    }
    return undefined;
}

/** Why `value` isn't a roster, or undefined: crew members, each once, no more alive than `ROSTER_MAX`. */
function rosterProblem(value: unknown, day: number): string | undefined {
    if (!Array.isArray(value)) return 'the roster is no roster';
    for (const m of value) {
        const problem = memberProblem(m, day);
        if (problem) return problem;
    }
    const roster = value as CrewMember[];
    if (new Set(roster.map(m => m.id)).size !== roster.length) return 'two crew members are one';
    if (roster.filter(m => m.status !== 'dead').length > ROSTER_MAX) return 'the roster is over full';
    return undefined;
}

/**
 * Why `value` isn't a campaign, or undefined: exactly a `Campaign`'s fields, each of its type, and a story that holds
 * together (the days spent before today, the thresholds landed those the Squeeze reached, the phase they make). The
 * intel's own records are checked against their bank when read (`campaignIntel`).
 */
export function campaignProblem(value: unknown): string | undefined {
    if (!isRecord(value)) return 'not a campaign';
    const v = value;
    if (!exactKeys(v, ['seed', 'day', 'squeeze', 'complications', 'landed', 'falseTip', 'phase', 'days', 'visit', 'intel', 'money', 'fronts', 'contacts', 'armoury', 'roster',
        'contracts', 'hits', 'advantages', 'objectiveOffers'])) {
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
        if (!isRecord(s) || !exactKeys(s, ['kind', 'day', 'bank', 'prior'], ['result', 'job', 'payout', 'contract']) || !['heist', 'case'].includes(s.kind as string) || !isDay(s.day)
            || typeof s.bank !== 'string' || (s.result !== undefined && (s.kind !== 'heist' || !RESULTS.includes(s.result as string)))) return 'the visit is no visit';
        const j = s.job;
        if (j !== undefined && (s.kind !== 'heist' || !isRecord(j) || !exactKeys(j, ['crew', 'kits', 'stakes']) || !strings(j.crew) || !isRecord(j.kits)
            || !exactKeys(j.kits, j.crew) || !Object.values(j.kits).every(gear) || !STAKES.includes(j.stakes as never))) return "the visit's job is no job";
        // A take is paid in once, as a job ends other than in failure.
        if (s.payout !== undefined && (!whole(s.payout) || j === undefined || s.result === undefined || s.result === 'failure')) return 'the payout is no payout';
        const spent = days[(s.day as number) - 1] as Record<string, unknown> | undefined;
        if (!spent || spent.action !== s.kind || spent.bank !== s.bank) return 'the visit is not a day spent';
        if (s.day !== days.length) return 'the visit is not the last day spent';
        // A heist is a contract's (M6-02): taken that day, at the job's stakes.
        if (s.kind === 'heist' && s.contract === undefined) return "the visit's heist is no contract's";
        if (s.contract !== undefined) {
            const problem = contractProblem(s.contract), k = s.contract as Record<string, unknown>;
            if (problem || s.kind !== 'heist') return problem ?? "the visit's contract is no heist's";
            if ((k.posted as number) > (s.day as number) || (k.expires as number) < (s.day as number)) return "the visit's contract wasn't on offer that day";
            if (isRecord(j) && j.stakes !== k.stakes) return "the visit's job is not at its contract's stakes";
        }
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
    const roster = rosterProblem(v.roster, v.day as number);
    if (roster) return roster;
    // A heist's crew are on the roster.
    const crew = isRecord(v.visit) && isRecord(v.visit.job) ? v.visit.job.crew as string[] : [];
    if (crew.some(id => !(v.roster as CrewMember[]).some(m => m.id === id))) return "the visit's crew are not the roster's";
    // The board (M6-02): today's offers, one per stakes at most, each with its own id.
    const board = v.contracts;
    if (!Array.isArray(board)) return 'the contracts are no board';
    for (const k of board) {
        const problem = contractProblem(k);
        if (problem) return problem;
        if ((k as Contract).posted > (v.day as number) || (k as Contract).expires < (v.day as number)) return 'a contract on the board is not on offer today';
    }
    if (new Set(board.map(k => (k as Contract).stakes)).size !== board.length) return 'two contracts on the board have the same stakes';
    const taken = isRecord(v.visit) && isRecord(v.visit.contract) ? v.visit.contract.id : undefined;
    if (taken !== undefined && board.some(k => (k as Contract).id === taken)) return 'the contract taken is still on offer';
    if (!isRecord(v.hits) || !Object.entries(v.hits).every(([k, n]) => among(CHAINS, k) && whole(n))) return 'the heists per chain are no counts';
    const got = v.advantages;
    if (!strings(got) || !got.every(k => among(OBJECTIVE_KINDS, k)) || new Set(got).size !== got.length) return 'the advantages are not side objectives';
    if (!isRecord(v.objectiveOffers) || !Object.entries(v.objectiveOffers).every(([k, n]) => among(OBJECTIVE_KINDS, k) && Number.isInteger(n) && (n as number) >= 1
        && (n as number) <= OBJECTIVE_OFFERS)) return 'the side objectives offered are no counts';
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
 * refused, or it couldn't be saved: then nothing happened, so no day is ever spent unsaved). `guard` checks the campaign as
 * it is saved now, before the rules do (another tab may have changed it since the page read it).
 */
export function campaignAct(storage: SaveStorage, cmd: CampaignCommand, guard?: (campaign: Campaign) => string | undefined): { campaign: Campaign; events: CampaignEvent[] } | { refused: string } {
    const campaign = loadCampaign(storage);
    if (!campaign) return { refused: 'No campaign' };
    const refused = guard?.(campaign) ?? campaignRefusal(campaign, cmd);
    if (refused) return { refused };
    const done = commitCampaign(campaign, cmd);
    return saveCampaign(storage, done.campaign) ? done : { refused: "The campaign couldn't be saved" };
}

/** What the campaign's crew knows of this bank today (§17.8 aged by days, decision 442): its records merged, each read as this bank's. */
export function campaignIntel(campaign: DeepReadonly<Campaign>, world: ReadonlyWorld): Intel {
    return knownIntel(campaign as Campaign, campaignPrint(world)).filter(i => intelProblem(i, world) === undefined).reduce<Intel>((a, b) => mergeIntel(a, b, world), {});
}

/**
 * What the campaign's plan of the day may spend in a bank (M6-03): its clean money, the favours the intel bought there
 * today left under the cap (§18.1), the armoury's gear, and its crew (M6-04): the roster's members free to go, a
 * contract's size of them (`stakes`; any number without).
 */
export function campaignPurse(campaign: DeepReadonly<Campaign>, world: ReadonlyWorld, stakes?: Stakes): Purse {
    return { cash: campaign.money.clean, favours: FAVOUR_CAP - favoursToday(campaign, campaignPrint(world)), armoury: { ...campaign.armoury }, crew: campaignCrew(campaign, stakes) };
}

/** An empty loadout: what a recruit brings (§19.4: gear is the armoury's). */
const EMPTY_LOADOUT = { primary: null, sidearm: null, armour: null, gadgets: [null, null] as [null, null] };

/**
 * The campaign's crew as the planning screen and the heist take them (M6-04): those on the roster free to go, with their
 * traits and Notoriety (which the rules read, src/sim/rules/profile.ts), each of the four of §3 with the loadout they
 * bring by default, a recruit with none; a contract's size of them.
 */
export function campaignCrew(campaign: DeepReadonly<Campaign>, stakes?: Stakes): CrewPool {
    const roster: RosterMember[] = readyCrew(campaign.roster as CrewMember[]).map(m => ({
        id: m.id, name: m.name, look: m.look, traits: [...m.traits], loadout: structuredClone(rosterMember(m.id)?.loadout ?? EMPTY_LOADOUT), notoriety: m.notoriety
    }));
    return { roster, size: stakes ? CREW_BY_STAKES[stakes] : [1, ROSTER_MAX] };
}

/** What a plan takes on as the campaign's heist (§19.4): its crew, their gear, its contract's stakes, and its assets' cost. */
export function campaignJob(setup: HeistSetup, stakes: Stakes): { job: Job; cost: number } {
    const kits = Object.fromEntries(setup.crew.map(c => [c.id, gearOf({ ...setup, crew: [c] })]));
    return { job: { crew: setup.crew.map(c => c.id), kits, stakes }, cost: spent(setup).cash };
}

/** The address of a contract's bank (M6-02): what the generator builds it from, its chain, security steps and side objective. */
export function contractAddress(contract: DeepReadonly<Contract>): BankAddress {
    return {
        ...contract.bank, chain: contract.chain, ...(contract.escalation ? { escalation: String(contract.escalation) } : {}),
        ...(contract.objective ? { objectives: contract.objective } : {})
    };
}

/**
 * Buys an intel asset for the campaign's heist in a bank (decision 401 in the campaign): paid from the campaign's money
 * and saved at once, known from then on, so reloading the planning page neither forgets nor charges it again.
 */
export function buyCampaignIntel(storage: SaveStorage, world: ReadonlyWorld, asset: IntelAsset): ReturnType<typeof campaignAct> {
    return campaignAct(storage, { kind: 'buyIntel', bank: campaignPrint(world), asset, cost: ASSETS[asset].cost, favours: ASSETS[asset].favours });
}

/** A heist's take as the campaign counts it: the loot's value that left, in whole dollars, never negative. */
const takeOf = (state: DeepReadonly<State>): number => {
    const value = state.outcome?.value ?? 0;
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
};

/** The side objectives (§19.5) among the loot that left with the crew: each counts once its carrier got out. */
export function objectivesOut(world: ReadonlyWorld, state: DeepReadonly<State>): string[] {
    const out = new Set(state.outcome?.loot ?? []);
    return world.objects.flatMap(o => (out.has(o.id) && o.loot?.objective !== undefined ? [o.loot.objective] : []));
}

/**
 * What became of the heist's crew (§19.6), from the rules' outcome: who got away, was arrested or died, who among those
 * who got away went down on the way (`wounds.wentDown`, revived or not), and who killed someone themselves (`wounds.kills`).
 */
export function crewFates(state: DeepReadonly<State>): CrewFates {
    const o = state.outcome;
    const everyone = [...state.crew, ...state.escaped.map(e => e.crew), ...state.custody.map(c => c.crew)];
    const escaped = [...(o?.escaped ?? [])];
    return {
        escaped, arrested: [...(o?.arrested ?? [])], dead: [...(o?.dead ?? [])],
        downed: [...new Set(everyone.filter(c => c.wounds.wentDown === true && escaped.includes(c.id)).map(c => c.id))],
        killers: [...new Set(everyone.filter(c => (c.wounds.kills ?? 0) > 0).map(c => c.id))]
    };
}

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
        const bank = campaignPrint(world);
        if (campaign.seed !== tag.seed || campaign.visit?.day !== tag.day || campaign.visit.bank !== bank) return 'drop';
        // Its result is in already (it ended, or was abandoned into the Raid): it learns nothing more for the campaign.
        if (campaign.visit.result) return 'drop';
        const intel = intelOf(world, state), text = stableJson(intel), ended = state.outcome?.result;
        let next = campaign;
        if (text !== kept) next = commitCampaign(next, { kind: 'learn', bank, day: tag.day, intel }).campaign;
        // Its end, with its take and the gear that came back: once, since a visit with a result takes no other (and drops the heist).
        if (ended && next.visit?.kind === 'heist' && !next.visit.result) {
            next = commitCampaign(next, {
                kind: 'heistOver', day: tag.day, result: ended, take: takeOf(state), kept: gearKept(world, state), objectives: objectivesOut(world, state),
                crew: crewFates(state)
            }).campaign;
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
        return campaign && heistUnfinished(campaign) && campaign.visit!.bank === campaignPrint(world) ? undefined : 'device';
    };
}

/** Why the campaign day's heist on the offered contract can't start in a bank, or undefined. */
export function campaignHeistRefusal(campaign: Campaign | null, world: ReadonlyWorld, contract: string): string | undefined {
    if (!campaign) return 'No campaign';
    return campaignRefusal(campaign, { kind: 'heist', bank: campaignPrint(world), contract });
}

/**
 * Why a campaign heist can't start in this bank (M6-02), or undefined: `contract` is on today's board, the bank is
 * exactly the one it names (seed, tier, archetype, plot, chain, security steps and side objective), and the rules
 * would take it. The address never picks the bank or the stakes: a bank it names that no offer does is refused.
 */
export function contractBankRefusal(campaign: Campaign | null, contract: string | null, bank: GeneratedBank, world: ReadonlyWorld): string | undefined {
    if (!campaign) return 'No campaign';
    const offer = offered(campaign, contract);
    if (!offer) return 'Not on offer';
    if (!sameAddress(contractAddress(offer), bankAddress(bank))) return "Not the contract's bank";
    return campaignHeistRefusal(campaign, world, offer.id);
}

/**
 * Spends the day on an offered contract's heist in `bank` as planned (Start on `?plan&campaign`, decisions 481, 504):
 * checked against the campaign as saved at that moment, not as the page loaded it, so a contract whose chain another tab
 * put on guard since (its bank is no longer the one built) or that another tab took is refused (the M6-02 review).
 */
export function startContractHeist(storage: SaveStorage, contract: string, bank: GeneratedBank, world: ReadonlyWorld, setup: HeistSetup): ReturnType<typeof campaignAct> {
    const now = loadCampaign(storage), offer = now ? offered(now, contract) : undefined;
    if (!offer) return { refused: now ? 'Not on offer' : 'No campaign' };
    return campaignAct(storage, { kind: 'heist', bank: campaignPrint(world), contract, ...campaignJob(setup, offer.stakes) }, c => contractBankRefusal(c, contract, bank, world));
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
