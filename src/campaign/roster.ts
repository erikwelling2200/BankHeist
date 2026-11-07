import { Rng } from '../gen/rng';
import { TRAITS, type Trait } from '../sim';
import { CHAINS } from './contracts';
import type { Stakes } from './money';

/*
 * The roster (GAME_DESIGN §19.6, §19.7; implementation plan M6-04, decisions 509–518): the crew the campaign hires,
 * sends on jobs, patches up, bails out and buries. Plain JSON and pure functions, like the rest of src/campaign.
 *
 * - **Recruits** (§19.6): each day offers three, drawn from the campaign's seed and the day: one trait (§7.2), a
 *   personal motive, a share (8–20%, §19.4) and a signing fee ($10–30k). Recruiting takes no time.
 * - **Traits** grow: every two jobs a crew member survives, three traits they haven't got are offered, and the player
 *   picks one (no HP growth, §7.1).
 * - **Injury:** downed during a job, even if revived, a crew member is out for `INJURY_DAYS` days; laying low heals
 *   twice as fast (§19.3).
 * - **Jail:** arrested, they are in jail: a lawyer gets them out (money and days); left there, each day they may talk
 *   (§19.2's +4 Squeeze, and +1 Notoriety for each of the crew who went on that job with them).
 * - **Death:** killed, they are gone, with their gear unless the body was carried out (the gear rules of decision 482).
 * - **Notoriety** (§19.7), 0–5: +2 on arrest (the witnesses and footage are the debrief's, M6-05); −1 for every two
 *   days a crew member at liberty isn't deployed. The rules read it (src/sim/rules/profile.ts): Known crew read one
 *   profile higher to enforcers and cameras, Wanted to everyone. Every gain adds a point of Squeeze (§19.2).
 * - **Motives** (§19.6): met before the finale, a one-time contact (§19.4).
 */

/** A personal motive (§19.6), and how far along it is. */
export type Motive =
    /** "Pay off my $Nk debt": paid from the clean money. */
    | { kind: 'debt'; amount: number; met: boolean }
    /** "Never kill anyone": met after `NEVER_KILL_JOBS` jobs on which nobody died; broken for good by a job on which someone did. */
    | { kind: 'neverKill'; jobs: number; met: boolean; broken: boolean }
    /** "Get even with the bank that foreclosed on me": a Success on a branch of `chain`, with them on the job. */
    | { kind: 'getEven'; chain: string; met: boolean };

export type MotiveKind = Motive['kind'];

/** Where a crew member is: free to go, out injured, in jail, or dead. */
export type CrewStatus = 'ready' | 'injured' | 'jailed' | 'dead';

/** An arrested crew member's time in jail. */
export interface Jail {
    /** The day of the job they were arrested on. */
    day: number;
    /** The others who went on that job: those a prisoner who talks names. */
    named: string[];
    /** The day a lawyer gets them out, once one is hired. */
    out?: number;
    /** They talked (once). */
    talked: boolean;
}

export interface CrewMember {
    /** The four of §3 by name; a recruit `r<day>-<n>`. */
    id: string;
    name: string;
    /** The person's look (src/art/bank/people.ts `LOOKS`): a recruit's follows from the id (`recruitLook`). */
    look: string;
    traits: Trait[];
    /** Their share of every job they go on, in percent (§19.4). */
    share: number;
    /** 0–5 (§19.7). */
    notoriety: number;
    /** Days in a row at liberty and not deployed since Notoriety last decayed (or they last went out). */
    rested: number;
    /** Jobs survived: every second one offers a trait. */
    jobs: number;
    /** The trait offers waiting for a pick, oldest first: three each (fewer when fewer are left). */
    traitOffers: Trait[][];
    motive: Motive | null;
    status: CrewStatus;
    /** Injured: days left out. */
    injured?: number;
    jail?: Jail;
    /** Dead: the day of the job they died on. */
    died?: number;
}

/** A recruit on offer today (§19.6): who they are and what they cost. */
export interface Recruit {
    id: string;
    name: string;
    look: string;
    trait: Trait;
    motive: Motive;
    share: number;
    fee: number;
}

/** The crew size a contract takes, by stakes (§19.3's table): the fewest and the most. */
export const CREW_BY_STAKES: Readonly<Record<Stakes, readonly [number, number]>> = { low: [2, 3], medium: [3, 4], high: [4, 5] };
/** The most crew members alive on the roster (decision 510). */
export const ROSTER_MAX = 8;
/** Recruits offered a day. */
export const RECRUITS_A_DAY = 3;
/** A recruit's share, percent, and signing fee in $5k steps (§19.4). */
export const RECRUIT_SHARE: readonly [number, number] = [8, 20];
export const SIGNING_FEE: readonly [number, number] = [10000, 30000];
/** Days out after being downed on a job (§19.6), and how many a day of laying low heals (§19.3). */
export const INJURY_DAYS = 3;
export const LAY_LOW_HEALS = 2;
/** A lawyer: the price, and the days until they are out (§19.6 "money and days"). */
export const LAWYER_COST = 40000;
export const LAWYER_DAYS = 2;
/** The chance a prisoner without a lawyer talks, each day that passes (once). */
export const TALK_CHANCE = 1 / 3;
/** Notoriety (§19.7): the most, the gain on arrest, the gain for each named by a prisoner who talks, and the days to decay one. */
export const MAX_NOTORIETY = 5;
export const ARREST_NOTORIETY = 2;
export const NAMED_NOTORIETY = 1;
export const DECAY_DAYS = 2;
/** A trait offered every this many jobs survived, this many to choose from (§7.2). */
export const TRAIT_EVERY = 2;
export const TRAIT_CHOICES = 3;
/** "Never kill anyone": clean jobs to meet it. A debt: its range, in $10k steps. */
export const NEVER_KILL_JOBS = 3;
export const DEBT: readonly [number, number] = [40000, 80000];

/**
 * The four of §3 the campaign starts with: their traits (as the sandbox's roster, src/game/plan.ts `ROSTER`) and the
 * shares the money's first version fixed (decision 480: 40% together). Not recruits, so no motive and no fee.
 */
export const STARTING_ROSTER: readonly Readonly<CrewMember>[] = [
    { id: 'mara', name: 'Mara', look: 'crewMara', traits: ['smoothTalker'], share: 10 },
    { id: 'jun', name: 'Jun', look: 'crewJun', traits: ['steadyHands'], share: 8 },
    { id: 'dex', name: 'Dex', look: 'crewDex', traits: ['intimidating', 'bruiser'], share: 10 },
    { id: 'sol', name: 'Sol', look: 'crewSol', traits: ['marksman'], share: 12 }
].map(m => ({ ...m, traits: m.traits as Trait[], notoriety: 0, rested: 0, jobs: 0, traitOffers: [], motive: null, status: 'ready' as const }));

/** What recruits wear: the lobby's customers' clothes (crew look like customers on purpose, src/art/bank/people.ts). */
export const RECRUIT_LOOKS: readonly string[] = ['customerCasual', 'customerHoodie', 'customerCoat', 'customerDress', 'customerSuit', 'passerby'];

const RECRUIT_NAMES: readonly string[] = [
    'Ana', 'Bo', 'Cass', 'Dario', 'Edie', 'Faro', 'Gus', 'Hana', 'Ilse', 'Jojo', 'Kit', 'Lev', 'Mina', 'Nico', 'Odile', 'Pax', 'Quinn', 'Rafa', 'Sade', 'Teo',
    'Ula', 'Vik', 'Wren', 'Xavi', 'Yara', 'Zeb', 'Bram', 'Coco', 'Duke', 'Esme', 'Fitz', 'Gia'
];

/** A recruit's look, from their id: the same wherever it is asked (the campaign page, the planning screen, the bank). */
export function recruitLook(id: string): string {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return RECRUIT_LOOKS[h % RECRUIT_LOOKS.length]!;
}

/** The recruits drawn for `day` (§19.6): the same for the same campaign and day, whoever has been hired since. */
export function drawRecruits(seed: number, day: number): Recruit[] {
    const rng = new Rng(seed).fork(`recruits-${day}`);
    const names = rng.fork('names').shuffle(RECRUIT_NAMES);
    return Array.from({ length: RECRUITS_A_DAY }, (_, i) => {
        const r = rng.fork(`recruit-${i}`), id = `r${day}-${i + 1}`;
        return {
            id, name: names[i]!, look: recruitLook(id), trait: r.fork('trait').pick(TRAITS), motive: drawMotive(r.fork('motive')),
            share: r.fork('share').int(...RECRUIT_SHARE), fee: r.fork('fee').int(SIGNING_FEE[0] / 5000, SIGNING_FEE[1] / 5000) * 5000
        };
    });
}

function drawMotive(rng: Rng): Motive {
    const kind = rng.fork('kind').pick<MotiveKind>(['debt', 'neverKill', 'getEven']);
    if (kind === 'debt') return { kind, amount: rng.fork('amount').int(DEBT[0] / 10000, DEBT[1] / 10000) * 10000, met: false };
    if (kind === 'neverKill') return { kind, jobs: 0, met: false, broken: false };
    return { kind, chain: rng.fork('chain').pick(CHAINS), met: false };
}

/** A recruit as they join the roster. */
export const hired = (r: Recruit): CrewMember => ({
    id: r.id, name: r.name, look: r.look, traits: [r.trait], share: r.share, notoriety: 0, rested: 0, jobs: 0, traitOffers: [], motive: structuredClone(r.motive), status: 'ready'
});

/** What a motive asks, as the campaign page says it. */
export function motiveText(m: Motive): string {
    switch (m.kind) {
        case 'debt': return `Pay off my $${m.amount / 1000}k debt`;
        case 'neverKill': return 'Never kill anyone';
        case 'getEven': return `Get even with ${m.chain}, who foreclosed on me`;
    }
}

/** Notoriety's band (§19.7). */
export const notorietyBand = (n: number): 'Unknown' | 'Known' | 'Wanted' => (n >= 4 ? 'Wanted' : n >= 2 ? 'Known' : 'Unknown');

/** Notoriety gained: halved (rounded down) for the Forgettable (§7.2), and never past the most. The points gained. */
export function gainNotoriety(m: CrewMember, amount: number): number {
    const gain = Math.min(MAX_NOTORIETY - m.notoriety, m.traits.includes('forgettable') ? Math.floor(amount / 2) : amount);
    if (gain <= 0) return 0;
    m.notoriety += gain;
    return gain;
}

/** The three (or fewer) traits offered to `m` for their `n`th pick: ones they haven't got, from the seed. */
export function traitOffer(seed: number, m: CrewMember, n: number): Trait[] {
    const open = TRAITS.filter(t => !m.traits.includes(t));
    return new Rng(seed).fork(`traits-${m.id}-${n}`).shuffle(open).slice(0, TRAIT_CHOICES);
}

/** Whether a prisoner without a lawyer talks on the day `day` passes. */
export const talks = (seed: number, id: string, day: number): boolean => new Rng(seed).fork(`talk-${id}-${day}`).chance(TALK_CHANCE);

/** The shares of the roster, by id. */
export const sharesOfRoster = (roster: readonly CrewMember[]): Record<string, number> => Object.fromEntries(roster.map(m => [m.id, m.share]));

/** Those on the roster free to go on a job: not injured, in jail or dead. */
export const readyCrew = (roster: readonly CrewMember[]): CrewMember[] => roster.filter(m => m.status === 'ready');

/** Those on the roster alive (counted against `ROSTER_MAX`). */
export const livingCrew = (roster: readonly CrewMember[]): CrewMember[] => roster.filter(m => m.status !== 'dead');
