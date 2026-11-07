import { isItem, ITEMS, type DeepReadonly, type Intel } from '../sim';
import type { SideObjectiveKind } from '../gen/objectives';
import { COMPLICATIONS, drawComplications, type ComplicationId } from './complications';
import { escalateChain, refreshContracts, type Contract } from './contracts';
import { countItems, FENCE_CUT, fenced, FRONT_COST, LAUNDER_PER_DAY, MARKET, NERVOUS_FENCE_CUT, sharesOf, STAKES, STARTER_KIT, STARTING_CASH, STARTING_SHARES, type Stakes } from './money';
import { ALL_THRESHOLDS, projectedDay, SQUEEZE, THRESHOLDS, type SqueezeSource } from './squeeze';

/*
 * The campaign (GAME_DESIGN §19, implementation plan M6-01): the days, the Squeeze and its complications, and what the
 * crew knows of each bank as the days pass. Pure and deterministic like the rules (src/sim): a plain-JSON `Campaign`
 * changed only by a `CampaignCommand` through `commitCampaign`, which gives the new campaign and what happened. The
 * game layer (src/game/campaign.ts) saves it and wires it to the planning screen and the Session.
 *
 * A day is spent by a day action (§19.3): a heist (a contract), casing a bank, laying low. Recruiting and shopping take
 * no time. Spending a day adds the Squeeze's daily +2 and lands every threshold it reaches. Starting a heist spends its
 * day at once, so a heist abandoned after a turn has still cost one (decision 441): scouting is never free.
 *
 * Money (§19.4, M6-03): a heist's take comes in once, as it ends, as dirty money less the crew's shares; every day spent
 * launders some of it, the fence any of it at once for a cut. Clean money pays the heist's assets and the gear it takes
 * as it starts (the gear comes back with whoever escapes), intel bought while planning, fronts and the black market.
 *
 * Contracts (§19.3, §19.5, M6-02, src/campaign/contracts.ts): a heist is always one of the day's offers, which names its
 * bank and stakes; it comes off the board as it starts, the chain's other branches add a security step, and its end
 * pays the client's bonus on a Success and counts the side objective it held once its carrier got out.
 */

/** What spends a day (§19.3). */
export type DayAction = 'heist' | 'case' | 'layLow';

/** How a heist ended (the outcome screen's results, §15.5). */
export type HeistResult = 'success' | 'partial' | 'failure';

/** What the crew knew of a bank's day-bound intel when a visit began: what it learns there is what wasn't in this. */
export interface KnownBefore {
    guardRota: boolean;
    routines: string[];
    opportunities: string[];
}

/** The day's heist or casing visit, until the next day action. */
export interface Visit {
    kind: 'heist' | 'case';
    /** The day it was spent on. */
    day: number;
    /** The bank's print (src/game/intel.ts `bankPrint`). */
    bank: string;
    prior: KnownBefore;
    /** How the heist ended, once it has. */
    result?: HeistResult;
    /** A heist's crew, the gear they took and its stakes, as it started (none for a heist started without them). */
    job?: Job;
    /** A heist's contract, as it was taken. */
    contract?: Contract;
    /** The dirty money it brought in once over: its take less the crew's shares. */
    payout?: number;
}

/** What a heist takes in as it starts (§19.4): who goes, with which gear, at which stakes, and what its assets cost. */
export interface Job {
    /** The crew's ids: each takes their share of the take. */
    crew: string[];
    /**
     * The gear each of them carries in (item ids, a count each), by crew id: out of the armoury until they come back
     * with it. Only their own comes back (decision 482): never what they picked up in the bank.
     */
    kits: Record<string, string[]>;
    stakes: Stakes;
}

/** What a visit to a bank taught the crew, and the day it learned it. */
export interface DatedIntel {
    day: number;
    intel: Intel;
    /** Bought, not learned (an intel asset on the planning screen, decision 401): the favours it called in that day. */
    favours?: number;
}

export type CampaignPhase =
    /** Day actions as the player likes, the finale any day. */
    | 'open'
    /** The Raid landed: the forced escape is next (M7-04). */
    | 'raid'
    /** The crew survived the Raid: the finale is next, with every complication drawn so far. */
    | 'finaleDue'
    /** The finale was launched, or the crew lost the Raid: the campaign is over. */
    | 'over';

export interface Campaign {
    seed: number;
    /** The day now, not yet spent; day 1 first. */
    day: number;
    squeeze: number;
    /** The complications in the order they land, one per threshold before the Raid. */
    complications: ComplicationId[];
    /** The day each threshold landed on, in order; the eighth is the Raid. Never taken back (the false tip lowers only the points). */
    landed: number[];
    /** The "Leak a false tip" side job is done (once per campaign). */
    falseTip: boolean;
    phase: CampaignPhase;
    /** Each day spent, in order. */
    days: { day: number; action: DayAction; bank?: string }[];
    /** The last heist or casing visit, or null. */
    visit: Visit | null;
    /** What visits taught the crew, per bank print, oldest first. */
    intel: Record<string, DatedIntel[]>;
    /** Money (§19.4), whole dollars: clean to spend, dirty waiting to be laundered. */
    money: { clean: number; dirty: number };
    /** Fronts bought: each launders as much again as the safehouse every day. */
    fronts: number;
    /** Contacts made: one per successful high-stakes job; the first opens the black market's higher tiers. */
    contacts: number;
    /** The gear the crew owns and has at the safehouse, by item id: how many. */
    armoury: Record<string, number>;
    /** Each crew member's share of a job, in percent, by id (set at recruitment). */
    shares: Record<string, number>;
    /** The offers on the board today, by stakes (§19.3). */
    contracts: Contract[];
    /** Heists started per bank chain: each puts the chain's other branches a security step up. */
    hits: Record<string, number>;
    /** The side objectives brought out (§19.5), in order: the finale's advantages. */
    advantages: SideObjectiveKind[];
    /** How many offers have held each side objective (once, and once more if missed). */
    objectiveOffers: Record<string, number>;
}

export type CampaignCommand =
    /** Spends the day on the offered `contract`'s heist in its bank (the print): from the moment it starts, paying `cost` for its assets. */
    | { kind: 'heist'; bank: string; contract: string; job?: Job; cost?: number }
    /** Spends the day casing the bank (the visit itself is M6-07's). */
    | { kind: 'case'; bank: string }
    /** Spends the day laying low. */
    | { kind: 'layLow' }
    /** What the visit of `day` to `bank` has learned so far (the heist's whole intel; what was known before is left out). */
    | { kind: 'learn'; bank: string; day: number; intel: Intel }
    /**
     * The heist of `day` ended: the loot's value that left (`take`), by crew id the gear each who escaped still carries
     * unused (`kept`), and the side objectives that left with them (`objectives`).
     */
    | { kind: 'heistOver'; day: number; result: HeistResult; take?: number; kept?: Record<string, string[]>; objectives?: string[] }
    /** An intel asset bought on the planning screen for the bank's heist (decision 401): paid now, known from now. */
    | { kind: 'buyIntel'; bank: string; asset: IntelAsset; cost: number; favours: number }
    /** Gear from the black market, into the armoury. */
    | { kind: 'buy'; item: string; count?: number }
    /** A front: more laundered each day. */
    | { kind: 'buyFront' }
    /** Dirty money through the fence, clean at once less its cut. */
    | { kind: 'fence'; amount: number }
    /** Squeeze from elsewhere: crew members who gained Notoriety (`count`), a prisoner who talked, the false tip. */
    | { kind: 'squeeze'; source: Exclude<SqueezeSource, 'day' | 'failedJob'>; count?: number }
    /** The Raid was played. */
    | { kind: 'raidOver'; survived: boolean }
    /** The finale is launched: the campaign ends (M7). */
    | { kind: 'finale' };

export type CampaignEvent =
    | { type: 'dayPassed'; day: number; action: DayAction }
    | { type: 'squeeze'; source: SqueezeSource; points: number; total: number }
    | { type: 'complication'; id: ComplicationId; at: number; day: number }
    | { type: 'raid'; day: number }
    | { type: 'jobFailed'; day: number; abandoned: boolean }
    | { type: 'learned'; bank: string; day: number }
    | { type: 'phase'; phase: CampaignPhase }
    /** The day action didn't happen: the heist it abandoned landed the Raid (decision 446). No day was spent. */
    | { type: 'stopped'; action: DayAction; reason: string }
    /** Clean money went: on a heist's assets, intel, gear or a front. */
    | { type: 'spent'; on: 'heist' | 'intel' | 'gear' | 'front'; amount: number; clean: number }
    /** A heist's take came in: its value, the client's bonus, the crew's shares, and the dirty money left. */
    | { type: 'paid'; day: number; take: number; bonus: number; shares: number; dirty: number }
    /** The board changed as a day came: offers posted and offers expired, by id. */
    | { type: 'offers'; posted: string[]; expired: string[] }
    /** A side objective came out with the crew (§19.5): a finale advantage. */
    | { type: 'objective'; objective: SideObjectiveKind; day: number }
    | { type: 'laundered'; amount: number; clean: number; dirty: number }
    | { type: 'fenced'; amount: number; paid: number; cut: number }
    | { type: 'contact'; contacts: number }
    /** The armoury changed: gear bought or back from a heist (`added`), or taken into one (`removed`). */
    | { type: 'gear'; added: Record<string, number>; removed: Record<string, number> };

/** The intel assets (§18.2) the campaign pays for as they are bought. */
export type IntelAsset = 'blueprints' | 'guardRota';

export class CampaignRefused extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CampaignRefused';
    }
}

/** How long day-bound intel holds (decision 442): learned on day d, it is still good on day d + 3, gone after. */
export const INTEL_FRESH_DAYS = 3;

/** A new campaign on day 1: the complications drawn from `seed`. */
export function newCampaign(seed: number): Campaign {
    const c: Campaign = {
        seed: seed >>> 0, day: 1, squeeze: 0, complications: drawComplications(seed >>> 0), landed: [], falseTip: false, phase: 'open',
        days: [], visit: null, intel: {},
        money: { clean: STARTING_CASH, dirty: 0 }, fronts: 0, contacts: 0, armoury: { ...STARTER_KIT } as Record<string, number>, shares: { ...STARTING_SHARES },
        contracts: [], hits: {}, advantages: [], objectiveOffers: {}
    };
    refreshContracts(c);
    return c;
}

/** The offer on today's board with this id, or undefined. */
export const offered = (c: DeepReadonly<Campaign>, id: string | null | undefined): DeepReadonly<Contract> | undefined => c.contracts.find(k => k.id === id);

const whole = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;

/** Why the armoury can't give `gear`, or undefined. */
function gearRefusal(c: Campaign, gear: readonly string[]): string | undefined {
    if (gear.some(id => !isItem(id) || ITEMS[id].slot === 'fixed')) return 'Not gear';
    for (const [id, n] of Object.entries(countItems(gear))) if ((Object.hasOwn(c.armoury, id) ? c.armoury[id]! : 0) < n) return `Not enough ${id} in the armoury`;
    return undefined;
}

/**
 * Why a heist's job can't be taken on, or undefined: an offer on today's board, at its stakes; the crew who have shares,
 * the gear in the armoury, the cash.
 */
function jobRefusal(c: Campaign, contract: string, job: Job | undefined, cost: number | undefined): string | undefined {
    const offer = offered(c, contract);
    if (!offer) return 'Not on offer';
    if (cost !== undefined && !whole(cost)) return 'No price';
    if ((cost ?? 0) > c.money.clean) return 'Not enough money';
    if (!job) return undefined;
    if (!job.crew.length || new Set(job.crew).size !== job.crew.length || job.crew.some(id => !Object.hasOwn(c.shares, id))) return 'Not the crew';
    if (!STAKES.includes(job.stakes)) return 'No stakes';
    if (job.stakes !== offer.stakes) return "Not the contract's stakes";
    const ids = Object.keys(job.kits);
    if (ids.length !== job.crew.length || ids.some(id => !job.crew.includes(id))) return 'Not the crew';
    return gearRefusal(c, jobGear(job));
}

/** All the gear a job takes in, every kit together. */
export const jobGear = (job: DeepReadonly<Job>): string[] => job.crew.flatMap(id => job.kits[id] ?? []);

/** The fence's cut now, in percent: more once the "Nervous fence" complication has landed (§19.2). */
export const fenceCut = (c: DeepReadonly<Campaign>): number => FENCE_CUT + (landedComplications(c).includes('nervousFence') ? NERVOUS_FENCE_CUT : 0);

/** The complications landed so far, in order. */
export const landedComplications = (c: DeepReadonly<Campaign>): ComplicationId[] => c.complications.slice(0, Math.min(c.landed.length, THRESHOLDS.length));

/** What the safehouse and the fronts launder each day. */
export const launderPerDay = (c: DeepReadonly<Campaign>): number => LAUNDER_PER_DAY * (1 + c.fronts);

/** The favours the intel bought today for a bank called in: the plan's cap counts them (§18.1). */
export const favoursToday = (c: DeepReadonly<Campaign>, bank: string): number =>
    (c.intel[bank] ?? []).reduce((n, r) => n + (r.day === c.day ? r.favours ?? 0 : 0), 0);

/** Why `cmd` can't be done now, or undefined. */
export function campaignRefusal(c: Campaign, cmd: CampaignCommand): string | undefined {
    switch (cmd.kind) {
        case 'heist': case 'case': case 'layLow':
            if (c.phase !== 'open') return c.phase === 'over' ? 'The campaign is over' : c.phase === 'raid' ? 'The Raid comes first' : 'The finale is due';
            if (cmd.kind !== 'layLow' && !cmd.bank) return 'No bank';
            return cmd.kind === 'heist' ? jobRefusal(c, cmd.contract, cmd.job, cmd.cost) : undefined;
        case 'learn':
            if (!c.visit || c.visit.day !== cmd.day || c.visit.bank !== cmd.bank) return "Not the day's visit";
            return undefined;
        case 'heistOver':
            if (!c.visit || c.visit.kind !== 'heist' || c.visit.day !== cmd.day) return "Not the day's heist";
            if (c.visit.result) return 'The heist is over already';
            if (cmd.take !== undefined && !whole(cmd.take)) return 'No take';
            if (cmd.objectives !== undefined && !(Array.isArray(cmd.objectives) && cmd.objectives.every(k => typeof k === 'string'))) return 'No objectives';
            return undefined;
        case 'buyIntel': {
            if (c.phase !== 'open') return 'No heist to plan';
            if (!cmd.bank) return 'No bank';
            if (cmd.asset !== 'blueprints' && cmd.asset !== 'guardRota') return 'No such intel';
            if (!whole(cmd.cost) || !whole(cmd.favours)) return 'No price';
            const known = knownIntel(c, cmd.bank);
            if (known.some(i => i[cmd.asset])) return 'Known already';
            return cmd.cost > c.money.clean ? 'Not enough money' : undefined;
        }
        case 'buy': {
            if (c.phase === 'over') return 'The campaign is over';
            const offer = Object.hasOwn(MARKET, cmd.item) ? MARKET[cmd.item as keyof typeof MARKET] : undefined;
            if (!offer) return 'Not on sale';
            if (cmd.count !== undefined && (!Number.isInteger(cmd.count) || cmd.count < 1)) return 'None';
            if (offer.contact && c.contacts < 1) return 'Needs a contact';
            return offer.price * (cmd.count ?? 1) > c.money.clean ? 'Not enough money' : undefined;
        }
        case 'buyFront':
            if (c.phase === 'over') return 'The campaign is over';
            return FRONT_COST > c.money.clean ? 'Not enough money' : undefined;
        case 'fence':
            if (c.phase === 'over') return 'The campaign is over';
            if (!Number.isInteger(cmd.amount) || cmd.amount < 1) return 'Nothing to fence';
            return cmd.amount > c.money.dirty ? 'Not that much dirty money' : undefined;
        case 'squeeze':
            if (c.phase === 'over') return 'The campaign is over';
            if (cmd.source === 'falseTip' && c.falseTip) return 'The false tip was leaked already';
            if (cmd.count !== undefined && (!Number.isInteger(cmd.count) || cmd.count < 1)) return 'Nobody';
            return undefined;
        case 'raidOver':
            return c.phase === 'raid' ? undefined : 'No raid';
        case 'finale':
            return c.phase === 'open' || c.phase === 'finaleDue' ? undefined : c.phase === 'raid' ? 'The Raid comes first' : 'The campaign is over';
    }
}

/** Does `cmd`: the new campaign (the old one is left as it was) and what happened. Throws `CampaignRefused`. */
export function commitCampaign(campaign: Campaign, cmd: CampaignCommand): { campaign: Campaign; events: CampaignEvent[] } {
    const refused = campaignRefusal(campaign, cmd);
    if (refused) throw new CampaignRefused(refused);
    const c = structuredClone(campaign), events: CampaignEvent[] = [];
    const add = (source: SqueezeSource, points: number): void => {
        c.squeeze = Math.max(0, c.squeeze + points);
        events.push({ type: 'squeeze', source, points, total: c.squeeze });
        land(c, events);
    };
    switch (cmd.kind) {
        case 'heist': case 'case': case 'layLow': {
            // A heist left unfinished when the next day comes was abandoned: a failed job (decision 443).
            const v = c.visit;
            if (v?.kind === 'heist' && !v.result) {
                v.result = 'failure';
                events.push({ type: 'jobFailed', day: v.day, abandoned: true });
                add('failedJob', SQUEEZE.failedJob);
                // The failure is settled first: if it landed the Raid, the day action doesn't happen (decision 446).
                const stopped = campaignRefusal(c, cmd);
                if (stopped) {
                    events.push({ type: 'stopped', action: cmd.kind, reason: stopped });
                    break;
                }
            }
            const day = c.day;
            const visit: Visit | null = cmd.kind === 'layLow' ? null : { kind: cmd.kind, day, bank: cmd.bank, prior: knownBefore(campaign, cmd.bank) };
            c.visit = visit;
            if (cmd.kind === 'heist') {
                // The contract comes off the board as it starts (abandoning it gives nothing back), and its chain is on guard.
                const contract = offered(c, cmd.contract) as Contract;
                c.contracts = c.contracts.filter(k => k !== contract);
                visit!.contract = contract;
                escalateChain(c, contract.chain);
                // The assets are paid and the gear taken as it starts: a heist left after a turn has cost them too.
                if (cmd.cost) spend(c, events, 'heist', cmd.cost);
                if (cmd.job) {
                    visit!.job = structuredClone(cmd.job);
                    takeGear(c, events, jobGear(cmd.job));
                }
            }
            c.days.push({ day, action: cmd.kind, ...(cmd.kind !== 'layLow' ? { bank: cmd.bank } : {}) });
            events.push({ type: 'dayPassed', day, action: cmd.kind });
            add('day', SQUEEZE.day);
            launder(c, events);
            c.day = day + 1;
            pruneIntel(c);
            const board = refreshContracts(c);
            if (board.posted.length || board.expired.length) events.push({ type: 'offers', ...board });
            break;
        }
        case 'learn': {
            const v = c.visit!;
            const records = c.intel[cmd.bank] ??= [];
            const record = { day: v.day, intel: learnedOf(cmd.intel, v.prior) };
            const at = records.findIndex(r => r.day === v.day && r.favours === undefined);
            if (at >= 0) records[at] = record;
            else records.push(record);
            records.sort((a, b) => a.day - b.day);
            pruneIntel(c);
            if (!c.intel[cmd.bank]?.length) delete c.intel[cmd.bank];
            events.push({ type: 'learned', bank: cmd.bank, day: v.day });
            break;
        }
        case 'heistOver': {
            const v = c.visit!;
            v.result = cmd.result;
            // The side objective counts once its carrier got out, even if the job failed (§19.5); only the contract's own.
            const objective = v.contract?.objective;
            if (objective && (cmd.objectives ?? []).includes(objective) && !c.advantages.includes(objective)) {
                c.advantages.push(objective);
                events.push({ type: 'objective', objective, day: v.day });
            }
            if (cmd.result === 'failure') {
                // Failure loses the gear brought in (§19.3), and there is no take.
                events.push({ type: 'jobFailed', day: cmd.day, abandoned: false });
                add('failedJob', SQUEEZE.failedJob);
            } else if (v.job) {
                // The client's bonus on a Success (decision 503): part of the job, so the crew take their shares of it too.
                const take = cmd.take ?? 0, bonus = cmd.result === 'success' ? v.contract?.bonus ?? 0 : 0, shares = sharesOf(take + bonus, v.job.crew, c.shares);
                v.payout = Math.max(0, take + bonus - shares);
                c.money.dirty += v.payout;
                events.push({ type: 'paid', day: v.day, take, bonus, shares, dirty: c.money.dirty });
                returnGear(c, events, v.job, cmd.kept ?? {});
                if (cmd.result === 'success' && v.job.stakes === 'high') {
                    c.contacts += 1;
                    events.push({ type: 'contact', contacts: c.contacts });
                }
            }
            break;
        }
        case 'buyIntel': {
            spend(c, events, 'intel', cmd.cost);
            const records = c.intel[cmd.bank] ??= [];
            const today = records.find(r => r.day === c.day && r.favours !== undefined);
            if (today) {
                today.intel[cmd.asset] = true;
                today.favours! += cmd.favours;
            } else {
                records.push({ day: c.day, intel: { [cmd.asset]: true }, favours: cmd.favours });
                records.sort((a, b) => a.day - b.day);
            }
            break;
        }
        case 'buy': {
            const count = cmd.count ?? 1;
            spend(c, events, 'gear', MARKET[cmd.item as keyof typeof MARKET]!.price * count);
            c.armoury[cmd.item] = (c.armoury[cmd.item] ?? 0) + count;
            events.push({ type: 'gear', added: { [cmd.item]: count }, removed: {} });
            break;
        }
        case 'buyFront':
            spend(c, events, 'front', FRONT_COST);
            c.fronts += 1;
            break;
        case 'fence': {
            const cut = fenceCut(c), paid = fenced(cmd.amount, cut);
            c.money.dirty -= cmd.amount;
            c.money.clean += paid;
            events.push({ type: 'fenced', amount: cmd.amount, paid, cut });
            break;
        }
        case 'squeeze':
            if (cmd.source === 'falseTip') c.falseTip = true;
            add(cmd.source, SQUEEZE[cmd.source] * (cmd.source === 'falseTip' ? 1 : cmd.count ?? 1));
            break;
        case 'raidOver':
            setPhase(c, events, cmd.survived ? 'finaleDue' : 'over');
            break;
        case 'finale':
            setPhase(c, events, 'over');
            break;
    }
    return { campaign: c, events };
}

function spend(c: Campaign, events: CampaignEvent[], on: 'heist' | 'intel' | 'gear' | 'front', amount: number): void {
    c.money.clean -= amount;
    events.push({ type: 'spent', on, amount, clean: c.money.clean });
}

/** Each day spent launders what the safehouse and the fronts can of the dirty money (§19.4). */
function launder(c: Campaign, events: CampaignEvent[]): void {
    const amount = Math.min(c.money.dirty, launderPerDay(c));
    if (amount <= 0) return;
    c.money.dirty -= amount;
    c.money.clean += amount;
    events.push({ type: 'laundered', amount, clean: c.money.clean, dirty: c.money.dirty });
}

/** Takes a heist's gear out of the armoury: it is in the field until those who carry it come back. */
function takeGear(c: Campaign, events: CampaignEvent[], gear: readonly string[]): void {
    if (!gear.length) return;
    for (const id of gear) {
        c.armoury[id]! -= 1;
        if (c.armoury[id] === 0) delete c.armoury[id];
    }
    events.push({ type: 'gear', added: {}, removed: countItems(gear) });
}

/**
 * Puts back what came back of a heist's gear: crew member by crew member, what each who escaped still carries of their
 * own kit, never more of an item than they took in. A gun picked up in the bank isn't the crew's to keep, and doesn't
 * stand in for one lost (decision 482). The rest was used, dropped or taken with whoever stayed.
 */
function returnGear(c: Campaign, events: CampaignEvent[], job: Job, kept: Readonly<Record<string, readonly string[]>>): void {
    const added: Record<string, number> = {};
    for (const who of job.crew) {
        if (!Object.hasOwn(kept, who) || !Array.isArray(kept[who])) continue;
        const back = countItems(kept[who]!.filter(isItem));
        for (const [id, n] of Object.entries(countItems(job.kits[who] ?? []))) {
            const k = Math.min(n, Object.hasOwn(back, id) ? back[id]! : 0);
            if (!k) continue;
            c.armoury[id] = (c.armoury[id] ?? 0) + k;
            added[id] = (added[id] ?? 0) + k;
        }
    }
    if (Object.keys(added).length) events.push({ type: 'gear', added, removed: {} });
}

function setPhase(c: Campaign, events: CampaignEvent[], phase: CampaignPhase): void {
    c.phase = phase;
    events.push({ type: 'phase', phase });
}

/** Lands every threshold the Squeeze has reached and that hadn't landed, on the last day spent; the Raid at 38. */
function land(c: Campaign, events: CampaignEvent[]): void {
    const day = Math.max(1, c.days.at(-1)?.day ?? c.day);
    while (c.landed.length < ALL_THRESHOLDS.length && c.squeeze >= ALL_THRESHOLDS[c.landed.length]!) {
        const i = c.landed.length;
        c.landed.push(day);
        if (i < THRESHOLDS.length) events.push({ type: 'complication', id: c.complications[i]!, at: THRESHOLDS[i]!, day });
        else {
            events.push({ type: 'raid', day });
            if (c.phase === 'open') setPhase(c, events, 'raid');
        }
    }
}

/** Whether intel learned on `learned` is still good on `today` (decision 442). */
export const intelFresh = (learned: number, today: number): boolean => today - learned <= INTEL_FRESH_DAYS;

/** The parts of intel that hold for good: the layout (the Blueprints, the tiles seen). The building doesn't change. */
function layoutOf(intel: Intel): Intel {
    return { ...(intel.blueprints ? { blueprints: true } : {}), ...(intel.seen !== undefined ? { seen: intel.seen } : {}) };
}

/** Drops what has gone stale from every record, and the records left with nothing. */
function pruneIntel(c: Campaign): void {
    for (const [bank, records] of Object.entries(c.intel)) {
        const kept = records.map(r => (intelFresh(r.day, c.day) ? r : { ...r, intel: layoutOf(r.intel) })).filter(r => Object.keys(r.intel).length > 0);
        if (kept.length) c.intel[bank] = kept;
        else delete c.intel[bank];
    }
}

/**
 * What the crew knows of a bank today, record by record (the game merges them with the bank's World): every layout ever
 * seen, and the day-bound parts (the Guard rota, the routines, the opportunities found) learned in the last
 * `INTEL_FRESH_DAYS` days. Routines change, staff rotate and a rota is redrawn: older ones are dropped, never shown
 * wrong (§17.8).
 */
export function knownIntel(c: Campaign, bank: string): Intel[] {
    return (c.intel[bank] ?? []).map(r => (intelFresh(r.day, c.day) ? structuredClone(r.intel) : layoutOf(r.intel))).filter(i => Object.keys(i).length > 0);
}

/** The day-bound intel known of a bank today, as a visit starting now begins with it. */
export function knownBefore(c: Campaign, bank: string): KnownBefore {
    const known = knownIntel(c, bank);
    return {
        guardRota: known.some(i => i.guardRota),
        routines: [...new Set(known.flatMap(i => i.routines ?? []))].sort(),
        opportunities: [...new Set(known.flatMap(i => (i.opportunities ?? []).map(o => o.id)))]
    };
}

/**
 * What a visit learned: its intel without the day-bound parts known before it began, so knowing them again doesn't make
 * them new (decision 442: a routine carried in from earlier ages from the day it was learned).
 */
export function learnedOf(intel: Intel, prior: KnownBefore): Intel {
    const routines = (intel.routines ?? []).filter(id => !prior.routines.includes(id));
    const opportunities = (intel.opportunities ?? []).filter(o => !prior.opportunities.includes(o.id)).map(o => ({ id: o.id, how: o.how }));
    return {
        ...layoutOf(intel),
        ...(intel.guardRota && !prior.guardRota ? { guardRota: true } : {}),
        ...(routines.length ? { routines } : {}),
        ...(opportunities.length ? { opportunities } : {})
    };
}

/** One step of the Squeeze timeline (§19.2): a complication or the Raid, its threshold and the day it landed or will land. */
export interface TimelineStep {
    at: number;
    /** The complication, or null for the Raid. */
    complication: ComplicationId | null;
    name: string;
    text: string;
    landed: boolean;
    /** The day it landed on, or the day it lands on if nothing but the days adds Squeeze. */
    day: number;
}

/** The whole Squeeze timeline (§19.2: always on the city map), in order. */
export function timeline(c: Campaign): TimelineStep[] {
    // Days still to come: from the current unspent day once the campaign is open; a Raid or a finale due has no more days.
    return ALL_THRESHOLDS.map((at, i) => {
        const id = i < THRESHOLDS.length ? c.complications[i]! : null;
        const landed = i < c.landed.length;
        return {
            at, complication: id, name: id ? COMPLICATIONS[id].name : 'The Raid',
            text: id ? COMPLICATIONS[id].text : 'The task force raids the safehouse: a forced escape, then the finale the next day.',
            landed, day: landed ? c.landed[i]! : projectedDay(at, c.squeeze, c.day)
        };
    });
}

/** The next step of the timeline still to land, or undefined. */
export const nextStep = (c: Campaign): TimelineStep | undefined => timeline(c).find(s => !s.landed);
