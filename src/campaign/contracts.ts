import { Rng } from '../gen/rng';
import { ARCHETYPES, PLOTS, type Archetype, type PlotKind, type Tier } from '../gen/model';
import { SIDE_OBJECTIVES, type SideObjectiveKind } from '../gen/objectives';
import { TIER_SPECS } from '../gen/tiers';
import { STAKES, type Stakes } from './money';

/*
 * Contracts (GAME_DESIGN §19.3, §19.5; implementation plan M6-02, decisions 500–507): the jobs on offer each day. A
 * contract names one bank exactly (its seed, tier, archetype and plot: what the generator builds from them), the chain
 * it is a branch of, how many security steps the chain has added since (chain escalation), the client's bonus for a
 * Success and, on some, a side objective it "also holds". The board keeps one offer per stakes; each lasts a few days,
 * and a stakes left without one (taken or expired) gets a new one as the next day comes. Every draw comes from the
 * campaign's seed, the day and the stakes, so nothing the player does can draw an offer again.
 */

/** A bank as a contract names it: everything the generator needs to build exactly that bank (§17). */
export interface ContractBank {
    /** `layout-population`, as the address writes it. */
    seed: string;
    tier: Tier;
    archetype: Archetype;
    plot: PlotKind;
}

export interface Contract {
    /** `d<day posted>-<stakes>`: one per stakes a day, so never two alike in a campaign. */
    id: string;
    /** The day it was posted, and the last day it can be taken. */
    posted: number;
    expires: number;
    stakes: Stakes;
    /** The bank chain it is a branch of (`CHAINS`): the bank goes by its name. */
    chain: string;
    bank: ContractBank;
    /** The security steps the chain added after heists on its other branches (§19.3 chain escalation). */
    escalation: number;
    /** The client's bonus for a Success (decision 503), on top of the take. */
    bonus: number;
    /** The side objective it also holds (§19.5), placed in the bank by the generator. */
    objective?: SideObjectiveKind;
}

/** The bank chains whose branches the contracts name (§19.3: a heist on one branch puts the others on guard). */
export const CHAINS: readonly string[] = ['Granite Savings', 'Harbour Trust', 'Meridian Mutual'];

/** The tier a contract's stakes send the crew to (§19.3's typical targets). */
export const STAKES_TIER: Readonly<Record<Stakes, Tier>> = { low: 'small', medium: 'city', high: 'hq' };

/** The client's bonus for a Success, by stakes: a range, in steps of $5k (decision 503). */
export const BONUS: Readonly<Record<Stakes, readonly [number, number]>> = { low: [10000, 20000], medium: [25000, 50000], high: [60000, 120000] };

/** How long an offer stays on the board: the day it is posted and the days after, in all (§19.3: some expire). */
export const CONTRACT_DAYS: readonly [number, number] = [2, 4];

/** The most security steps a chain adds to a branch (decision 502). */
export const MAX_ESCALATION = 2;

/** The chance an offer also holds a side objective, by stakes (§19.5: some contracts). */
export const OBJECTIVE_CHANCE: Readonly<Record<Stakes, number>> = { low: 0.25, medium: 0.5, high: 0.5 };

/** How often a side objective can be offered: once, and once more if missed (§19.5). */
export const OBJECTIVE_OFFERS = 2;

/** The side objectives contracts can hold (the courier van is the armoured car's, not yet a contract's). */
export const OBJECTIVE_KINDS = Object.keys(SIDE_OBJECTIVES) as SideObjectiveKind[];

/**
 * The first low-stakes offer (decision 501): the M1 bank (`PLAY_BANK` in src/boot.ts, a Granite Savings branch already),
 * on the board three days, so a campaign starts on the bank the player learned on.
 */
export const FIRST_CONTRACT: Readonly<Contract> = {
    id: 'd1-low', posted: 1, expires: 3, stakes: 'low', chain: 'Granite Savings', bank: { seed: '31-2', tier: 'small', archetype: 'twoWing', plot: 'stripMallEnd' },
    escalation: 0, bonus: 15000
};

/** What the board needs of the campaign: its seed and day, the board, the heists per chain and the objectives so far. */
export interface ContractBoard {
    seed: number;
    day: number;
    contracts: Contract[];
    hits: Record<string, number>;
    advantages: SideObjectiveKind[];
    objectiveOffers: Record<string, number>;
    /** The day's heist: the side objective its contract holds is in play until it ends. */
    visit: { contract?: Contract; result?: string } | null;
}

/** The archetypes a tier's bank can be (Mezzanine Watch needs an operator, as the generator's `archetypesFor`). */
const archetypesOf = (tier: Tier): Archetype[] => ARCHETYPES.filter(a => a !== 'mezzanineWatch' || TIER_SPECS[tier].operator);

/** The offer posted for `stakes` on the board's day: the same for the same campaign, day and stakes. */
export function drawContract(board: ContractBoard, stakes: Stakes): Contract {
    const rng = new Rng(board.seed).fork(`contract-${board.day}-${stakes}`);
    const tier = STAKES_TIER[stakes];
    const bank: ContractBank = {
        seed: `${rng.fork('layout').int(1, 999999)}-${rng.fork('population').int(0, 999)}`,
        tier, archetype: rng.fork('archetype').pick(archetypesOf(tier)), plot: rng.fork('plot').pick(PLOTS)
    };
    const chain = rng.fork('chain').pick(CHAINS);
    const [low, high] = BONUS[stakes];
    const bonus = rng.fork('bonus').int(low / 5000, high / 5000) * 5000;
    const expires = board.day + rng.fork('days').int(...CONTRACT_DAYS) - 1;
    // A side objective not yet had, not on the board or in a heist going on, and offered fewer than twice (§19.5).
    const playing = board.visit && !board.visit.result ? board.visit.contract?.objective : undefined;
    const open = OBJECTIVE_KINDS.filter(k => !board.advantages.includes(k) && (board.objectiveOffers[k] ?? 0) < OBJECTIVE_OFFERS && !board.contracts.some(c => c.objective === k)
        && k !== playing);
    const holds = rng.fork('objective');
    const objective = open.length && holds.chance(OBJECTIVE_CHANCE[stakes]) ? holds.pick(open) : undefined;
    return {
        id: `d${board.day}-${stakes}`, posted: board.day, expires, stakes, chain, bank, escalation: Math.min(MAX_ESCALATION, board.hits[chain] ?? 0), bonus,
        ...(objective ? { objective } : {})
    };
}

/**
 * The board on its day (§19.3: contracts refresh as days pass): the offers that expired dropped, and a new one for each
 * stakes left without. Day 1's low stakes is `FIRST_CONTRACT`. What was posted and what expired, by id.
 */
export function refreshContracts(board: ContractBoard): { posted: string[]; expired: string[] } {
    const expired = board.contracts.filter(c => c.expires < board.day).map(c => c.id);
    board.contracts = board.contracts.filter(c => c.expires >= board.day);
    const posted: string[] = [];
    for (const stakes of STAKES) {
        if (board.contracts.some(c => c.stakes === stakes)) continue;
        const offer = board.day === 1 && stakes === 'low' ? structuredClone(FIRST_CONTRACT) as Contract : drawContract(board, stakes);
        if (offer.objective) board.objectiveOffers[offer.objective] = (board.objectiveOffers[offer.objective] ?? 0) + 1;
        board.contracts.push(offer);
        posted.push(offer.id);
    }
    board.contracts.sort((a, b) => STAKES.indexOf(a.stakes) - STAKES.indexOf(b.stakes));
    return { posted, expired };
}

/**
 * A heist on a branch of a chain (§19.3 chain escalation): the chain's other branches on the board add a security step,
 * and so do the branches it posts from now on.
 */
export function escalateChain(board: ContractBoard, chain: string): void {
    board.hits[chain] = (board.hits[chain] ?? 0) + 1;
    for (const c of board.contracts) if (c.chain === chain) c.escalation = Math.min(MAX_ESCALATION, c.escalation + 1);
}
