import type { GeneratedBank } from '../gen/model';
import {
    initialState, reachable, tileAt, vehicleAt, worldFromBank, type CrewStart, type Facing, type Pos, type ReadonlyWorld, type State
} from '../sim';
import { seedText } from '../gen/generate';
import { heistFromSetup, type HeistSetup } from './plan';
import { HEIST_KEY, Session, type ResumeOptions } from './session';
import type { SaveStorage } from './storage';

/*
 * A heist in a generated bank (implementation plan M1-13, M1-16): the World built from the bank, and the crew of two
 * starting beside their van. The game (`/`) asks for it; resuming picks up the autosaved heist when it was played
 * in this same bank.
 */

/** The generator's version as saves name it; a save of another version is still read, the world being in the save. */
export const GEN_VERSION = 'gen-1';

/**
 * The M1 crew: two, with placeholder loadouts until the planning screen, as GAME_DESIGN §3 has them: Mara (Smooth
 * Talker) has the zip-ties and nothing that shows, so she walks in Clean; Jun (Steady Hands) carries the hacking kit
 * (the alarm panel, a looped feed, §9.1), the jammer (§12.2) and a pistol under his jacket: Concealed, two gadgets.
 */
export const M1_CREW: readonly { id: string; name: string; look: string; items: string[]; traits: string[] }[] = [
    { id: 'mara', name: 'Mara', look: 'crewMara', items: ['zipTies'], traits: ['smoothTalker'] },
    { id: 'jun', name: 'Jun', look: 'crewJun', items: ['pistol', 'duffel', 'hackingKit', 'jammer'], traits: ['steadyHands'] }
];

/** The tile the crew starts beside: the crew van at the curb, or else the first getaway spot, or else the lobby's door. */
export function crewOrigin(bank: GeneratedBank): Pos {
    const spot = bank.getaways.find(g => g.id === 'curb') ?? bank.getaways[0];
    if (spot) return { x: spot.tx, y: spot.ty };
    const lobby = bank.rooms.find(r => r.type === 'lobby') ?? bank.rooms[0]!;
    return { x: lobby.x + Math.floor(lobby.w / 2), y: lobby.y + lobby.h };
}

/** Whether someone can stand on `p` at the start: walkable ground floor in the plot, no vehicle, nobody there. */
function free(world: ReadonlyWorld, state: State, taken: readonly Pos[], p: Pos): boolean {
    const tile = tileAt(world, p);
    return !!tile && !!tile.room && !tile.blocksMove && !tile.raised && vehicleAt(world, state, p) === undefined && !taken.some(q => q.x === p.x && q.y === p.y);
}

/**
 * Where each crew member starts: the free tile nearest the van (by rings round it, row-major within a ring), then each
 * next one the free tile nearest the first that can be walked to from it, beside it rather than behind it, so the crew
 * stands together on open ground. `taken`: tiles others already start on.
 */
export function crewStarts(world: ReadonlyWorld, origin: Pos, count: number, taken: readonly Pos[] = []): Pos[] {
    const npcs = [...world.people.map(p => p.pos), ...taken];
    // An empty bank but for the NPCs and the vehicles where they wait.
    const empty = initialState(world, { seed: 0, crew: [] });
    let first: Pos | undefined;
    for (let r = 0; r < Math.max(world.width, world.height) && !first; r++) {
        for (let y = origin.y - r; y <= origin.y + r && !first; y++) for (let x = origin.x - r; x <= origin.x + r && !first; x++) {
            if (Math.max(Math.abs(x - origin.x), Math.abs(y - origin.y)) === r && free(world, empty, npcs, { x, y })) first = { x, y };
        }
    }
    if (!first) throw new Error('No free tile for the crew to start on');
    const starts = [first];
    // The others: the cheapest tiles to walk to from the first, on an empty bank but for the NPCs.
    const probe = initialState(world, { seed: 0, crew: [{ id: 'probe', pos: first }] });
    const reach = reachable(world, probe, first, 40, { mover: 'probe' });
    // Side by side rather than one behind the other, so neither hides the other: nearest first, then the same row.
    const order = [...reach.tiles].sort((a, b) => a.cost - b.cost || Math.abs(a.pos.y - first!.y) - Math.abs(b.pos.y - first!.y));
    for (const t of order) {
        if (starts.length >= count) break;
        if (t.canEnd && free(world, empty, [...npcs, ...starts], t.pos)) starts.push({ x: t.pos.x, y: t.pos.y });
    }
    if (starts.length < count) throw new Error(`Only ${starts.length} of ${count} crew members have somewhere to start`);
    return starts;
}

/**
 * A new heist's World and State for a generated bank: the plan's (`setup`, §18), or else the M1 crew beside the van,
 * facing the bank (north).
 */
export function newHeist(bank: GeneratedBank, setup?: HeistSetup): { world: ReadonlyWorld; state: State } {
    if (setup) return heistFromSetup(bank, setup);
    const world = worldFromBank(bank);
    const starts = crewStarts(world, crewOrigin(bank), M1_CREW.length);
    const facing: Facing = 'n';
    const crew: CrewStart[] = M1_CREW.map((c, i) => ({ id: c.id, name: c.name, pos: starts[i]!, facing, items: [...c.items], traits: [...c.traits] }));
    const state = initialState(world, { seed: (bank.seed.layout * 1000 + bank.seed.population) >>> 0, crew });
    return { world, state };
}

/** The storage key of the address of the bank the saved heist is played in, so the game can rebuild it to resume. */
export const BANK_KEY = 'bank';

/** What names a generated bank in the address (`?seed=…&tier=…&archetype=…&plot=…`). */
export interface BankAddress { seed: string; tier: string; archetype: string; plot: string }

export const bankAddress = (bank: GeneratedBank): BankAddress =>
    ({ seed: seedText(bank.seed), tier: bank.tier, archetype: bank.archetype, plot: bank.plot });

export const sameAddress = (a: BankAddress | null | undefined, b: BankAddress | null | undefined): boolean =>
    !!a && !!b && a.seed === b.seed && a.tier === b.tier && a.archetype === b.archetype && a.plot === b.plot;

/** Which campaign's day a heist belongs to (M6-01, src/game/campaign.ts): its campaign's seed and the day it was spent on. */
export interface CampaignTag { seed: number; day: number }

/**
 * The heist saved in `storage`, if there is one: its bank's address and name (null for a save from before they were
 * kept), and the campaign day it is played on (null for a heist outside the campaign).
 */
export function savedHeist(storage: SaveStorage): { address: BankAddress | null; name: string | null; campaign: CampaignTag | null } | null {
    if (storage.get(HEIST_KEY) === null) return null;
    try {
        const data = JSON.parse(storage.get(BANK_KEY) ?? 'null') as { address?: BankAddress; name?: string; campaign?: CampaignTag } | null;
        const a = data?.address, t = data?.campaign;
        const ok = !!a && ['seed', 'tier', 'archetype', 'plot'].every(k => typeof (a as unknown as Record<string, unknown>)[k] === 'string');
        const tagged = !!t && Number.isInteger(t.seed) && Number.isInteger(t.day);
        return {
            address: ok ? { seed: a!.seed, tier: a!.tier, archetype: a!.archetype, plot: a!.plot } : null, name: typeof data?.name === 'string' ? data.name : null,
            campaign: tagged ? { seed: t!.seed, day: t!.day } : null
        };
    } catch {
        return { address: null, name: null, campaign: null };
    }
}

/**
 * A new heist in `bank` (as planned, with `setup`), replacing any heist saved in `storage`; call it only with the
 * player's consent if there is one. `campaign` tags it as that campaign day's heist.
 */
export function startHeist(bank: GeneratedBank, storage: SaveStorage, options: ResumeOptions = {}, setup?: HeistSetup, campaign?: CampaignTag): Session {
    const { world, state } = newHeist(bank, setup);
    // The bank entry, tag and all, goes first and in one write replacing the old one, so the heist is never saved under
    // another heist's tag, or a campaign heist without its own (it would then send what it learns to the wrong place).
    try {
        storage.set(BANK_KEY, JSON.stringify({ address: bankAddress(bank), name: bank.name, ...(campaign ? { campaign } : {}) }));
    } catch (e) {
        // A full quota: an old tag must not stay on the new heist, and a campaign heist doesn't start untagged.
        try {
            storage.remove(BANK_KEY);
        } catch { /* nothing more to do */ }
        if (campaign) throw e;
    }
    const session = Session.start({ world, state, storage, genVersion: GEN_VERSION, ...options });
    return session;
}

/**
 * What the game does about a saved heist: resume it, start a new one (nothing to lose), or ask before overwriting. Without
 * a seed in the address the saved heist resumes, whatever its bank; with the saved bank's own address it resumes too;
 * another bank, or `fresh` (`&new`), overwrites it only with the player's consent.
 */
export function playPlan(saved: ReturnType<typeof savedHeist>, request: { seeded: boolean; fresh: boolean }, target: BankAddress): 'resume' | 'new' | 'ask' {
    if (!saved) return 'new';
    if (request.fresh) return 'ask';
    if (!request.seeded || sameAddress(saved.address, target)) return 'resume';
    return 'ask';
}
