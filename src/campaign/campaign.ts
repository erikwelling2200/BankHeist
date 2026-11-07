import type { Intel } from '../sim';
import { COMPLICATIONS, drawComplications, type ComplicationId } from './complications';
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
}

/** What a visit to a bank taught the crew, and the day it learned it. */
export interface DatedIntel {
    day: number;
    intel: Intel;
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
}

export type CampaignCommand =
    /** Spends the day on a heist in the bank (its print): from the moment it starts. */
    | { kind: 'heist'; bank: string }
    /** Spends the day casing the bank (the visit itself is M6-07's). */
    | { kind: 'case'; bank: string }
    /** Spends the day laying low. */
    | { kind: 'layLow' }
    /** What the visit of `day` to `bank` has learned so far (the heist's whole intel; what was known before is left out). */
    | { kind: 'learn'; bank: string; day: number; intel: Intel }
    /** The heist of `day` ended. */
    | { kind: 'heistOver'; day: number; result: HeistResult }
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
    | { type: 'phase'; phase: CampaignPhase };

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
    return {
        seed: seed >>> 0, day: 1, squeeze: 0, complications: drawComplications(seed >>> 0), landed: [], falseTip: false, phase: 'open',
        days: [], visit: null, intel: {}
    };
}

/** Why `cmd` can't be done now, or undefined. */
export function campaignRefusal(c: Campaign, cmd: CampaignCommand): string | undefined {
    switch (cmd.kind) {
        case 'heist': case 'case': case 'layLow':
            if (c.phase !== 'open') return c.phase === 'over' ? 'The campaign is over' : c.phase === 'raid' ? 'The Raid comes first' : 'The finale is due';
            if (cmd.kind !== 'layLow' && !cmd.bank) return 'No bank';
            return undefined;
        case 'learn':
            if (!c.visit || c.visit.day !== cmd.day || c.visit.bank !== cmd.bank) return "Not the day's visit";
            return undefined;
        case 'heistOver':
            if (!c.visit || c.visit.kind !== 'heist' || c.visit.day !== cmd.day) return "Not the day's heist";
            if (c.visit.result) return 'The heist is over already';
            return undefined;
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
            }
            const day = c.day;
            c.visit = cmd.kind === 'layLow' ? null : { kind: cmd.kind, day, bank: cmd.bank, prior: knownBefore(campaign, cmd.bank) };
            c.days.push({ day, action: cmd.kind, ...(cmd.kind !== 'layLow' ? { bank: cmd.bank } : {}) });
            events.push({ type: 'dayPassed', day, action: cmd.kind });
            add('day', SQUEEZE.day);
            c.day = day + 1;
            pruneIntel(c);
            break;
        }
        case 'learn': {
            const v = c.visit!;
            const records = c.intel[cmd.bank] ??= [];
            const record = { day: v.day, intel: learnedOf(cmd.intel, v.prior) };
            const at = records.findIndex(r => r.day === v.day);
            if (at >= 0) records[at] = record;
            else records.push(record);
            records.sort((a, b) => a.day - b.day);
            pruneIntel(c);
            if (!c.intel[cmd.bank]?.length) delete c.intel[cmd.bank];
            events.push({ type: 'learned', bank: cmd.bank, day: v.day });
            break;
        }
        case 'heistOver':
            c.visit!.result = cmd.result;
            if (cmd.result === 'failure') {
                events.push({ type: 'jobFailed', day: cmd.day, abandoned: false });
                add('failedJob', SQUEEZE.failedJob);
            }
            break;
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
        const kept = records.map(r => (intelFresh(r.day, c.day) ? r : { day: r.day, intel: layoutOf(r.intel) })).filter(r => Object.keys(r.intel).length > 0);
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
