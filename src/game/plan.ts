import type { GeneratedBank, GenRoom } from '../gen/model';
import {
    facingToward, footprint, markerKind, freezeWorld, initialState, ITEMS, maxProfile, newId, tileAt, VEHICLES, wallBetween, worldFromBank, type CrewStart,
    type Facing, type ItemId, type MarkerKind, type Pose, type Pos, type Profile, type ReadonlyWorld, type State, type Trait, type VehicleDef, type VehicleType
} from '../sim';
import { crewStarts } from './heist';

/*
 * Planning a heist (GAME_DESIGN §18, implementation plan M4-07): the crew and their loadouts, where each starts, where
 * the vehicles wait and the assets bought with cash under the favour cap. The planning screen (src/ui/planning) edits a
 * `HeistSetup`; `heistFromSetup` turns it into the heist's World and starting State, as `newHeist` does for the M1 crew.
 *
 * - **Crew** (§7): the roster of §3's four, each with their traits; any of them, at least one, up to the contract's size.
 * - **Loadouts** (§7.3): a primary, a sidearm, armour and two gadgets, any item in the slot, free in the sandbox (the
 *   black market is M6-03's). Zip-ties are fixed. Nothing starts packed: there is no Gear up yet (decision 322).
 * - **Starts** (§18.1): on foot beside a crew vehicle, in one (in its cab, out of sight), or in the sniper nest with a
 *   long gun once it is rented.
 * - **Vehicles** (§18.1, §15.4): the van always, the backup car and the ram truck when bought, each at its own getaway
 *   spot the generator offers, parked where its whole footprint fits nearest the spot (decision 320).
 * - **Assets** (§18.2) with their cash and favour costs: those the rules can carry out so far (`ASSETS`).
 */

/** A member of the sandbox roster: §3's crew, their traits and the loadout they bring unless changed (decision 322). */
export interface RosterMember { id: string; name: string; look: string; traits: Trait[]; loadout: Loadout }

/** A loadout by slot (§7.3): one primary, one sidearm, one armour, two gadgets; null is an empty slot. */
export interface Loadout { primary: ItemId | null; sidearm: ItemId | null; armour: ItemId | null; gadgets: [ItemId | null, ItemId | null] }

export const ROSTER: readonly RosterMember[] = [
    { id: 'mara', name: 'Mara', look: 'crewMara', traits: ['smoothTalker'], loadout: { primary: null, sidearm: null, armour: null, gadgets: [null, null] } },
    { id: 'jun', name: 'Jun', look: 'crewJun', traits: ['steadyHands'], loadout: { primary: null, sidearm: 'pistol', armour: null, gadgets: ['hackingKit', 'jammer'] } },
    { id: 'dex', name: 'Dex', look: 'crewDex', traits: ['intimidating', 'bruiser'], loadout: { primary: 'shotgun', sidearm: null, armour: 'mediumArmour', gadgets: ['breachCharge', 'flashbang'] } },
    { id: 'sol', name: 'Sol', look: 'crewSol', traits: ['marksman'], loadout: { primary: 'dmr', sidearm: 'pistol', armour: 'lightVest', gadgets: ['medkit', null] } }
];

/** The roster member with this id. */
export const rosterMember = (id: string): RosterMember | undefined => ROSTER.find(m => m.id === id);

/** What fills each slot: every item of that slot but the duffel, which holds nothing to take out yet (decision 322). */
export const SLOT_ITEMS: Readonly<Record<'primary' | 'sidearm' | 'armour' | 'gadget', readonly ItemId[]>> = {
    primary: itemsOf('primary'),
    sidearm: itemsOf('sidearm'),
    armour: itemsOf('armour'),
    gadget: itemsOf('gadget').filter(id => id !== 'duffel')
};

function itemsOf(slot: string): ItemId[] {
    return (Object.keys(ITEMS) as ItemId[]).filter(id => ITEMS[id].slot === slot);
}

/** Everyone carries these (§7.3 Fixed): zip-ties, as the rules count them (the phone, mask and scanner are no items yet). */
export const FIXED_ITEMS: readonly ItemId[] = ['zipTies'];

/** The items a loadout carries, fixed ones first. */
export const loadoutItems = (l: Loadout): ItemId[] =>
    [...FIXED_ITEMS, ...[l.primary, l.sidearm, l.armour, ...l.gadgets].filter((id): id is ItemId => id !== null)];

/** How a loadout shows at the start (§7.4): its most conspicuous item, unmasked and unpacked. */
export const loadoutProfile = (l: Loadout): Profile => loadoutItems(l).reduce<Profile>((p, id) => maxProfile(p, ITEMS[id].profile), 'clean');

/** A long gun: what the sniper nest needs (§18.1). */
export const hasLongGun = (l: Loadout): boolean => l.primary !== null && ITEMS[l.primary].slot === 'primary';

/** Where a crew member starts: beside or in a crew vehicle, or in the rented nest. */
export type StartPick = { at: VehicleType; aboard: boolean } | { at: 'nest' };

export interface CrewPlan { id: string; loadout: Loadout; start: StartPick }

/** The planning assets the rules can carry out so far (§18.2), with their cost in cash and favours. */
export const ASSETS = {
    ramTruck: { name: 'Ram truck', short: 'Ram', cost: 8000, favours: 2 },
    car: { name: 'Backup car', short: 'Car', cost: 6000, favours: 1 },
    nest: { name: 'Sniper nest rental', short: 'Nest', cost: 6000, favours: 2 },
    jammer: { name: 'Jammer pre-placed', short: 'Jammer', cost: 5000, favours: 2 }
} as const satisfies Record<string, { name: string; short: string; cost: number; favours: number }>;

export type AssetId = keyof typeof ASSETS;

/** "You can only call in so many favours before someone notices" (§18.1). */
export const FAVOUR_CAP = 8;
/** The sandbox's cash for assets until the campaign's money (M6-03; decision 323). */
export const PLANNING_CASH = 24000;
/** The contract's crew size (§7.2: usually 4). */
export const CREW_SIZE = 4;
/** How near the building a pre-placed jammer stands (§18.2 "next to the building"), in tiles (Chebyshev). */
export const JAMMER_REACH = 2;

/** What the planning screen hands the game: a heist's crew, starts, vehicles and assets. */
export interface HeistSetup {
    crew: CrewPlan[];
    /** The getaway spot (`GeneratedBank.getaways` id) of each crew vehicle: the van always, the others when bought. */
    vehicles: Partial<Record<VehicleType, string>> & { van: string };
    /** Where the pre-placed jammer runs from (§18.2), or null. */
    jammer: Pos | null;
    /** The sniper nest is rented (§18.2). */
    nest: boolean;
}

/** The assets a setup buys. */
export function assetsOf(setup: HeistSetup): AssetId[] {
    const out: AssetId[] = [];
    if (setup.vehicles.ramTruck !== undefined) out.push('ramTruck');
    if (setup.vehicles.car !== undefined) out.push('car');
    if (setup.nest) out.push('nest');
    if (setup.jammer) out.push('jammer');
    return out;
}

/** The cash and favours a setup spends. */
export function spent(setup: HeistSetup): { cash: number; favours: number } {
    const assets = assetsOf(setup);
    return { cash: assets.reduce((n, a) => n + ASSETS[a].cost, 0), favours: assets.reduce((n, a) => n + ASSETS[a].favours, 0) };
}

/** A getaway spot a vehicle can wait at, and the pose it is parked in there. */
export interface Spot { id: string; name: string; risk: 'police view' | 'hidden'; pose: Pose }

/** What a bank offers the plan: each vehicle's spots, the nest's tiles and where a jammer may go. */
export interface PlanOptions {
    world: ReadonlyWorld;
    spots: Readonly<Record<VehicleType, readonly Spot[]>>;
    /** The nest's free tiles, nearest the bank first; none without a nest. */
    nest: Pos[];
    nestRoom: GenRoom | null;
    /** The middle of the bank's lobby, which the crew face. */
    lobby: Pos;
    /** The rooms that are open ground outside (the street, the alley, lots): where a jammer may stand. */
    outdoors: readonly string[];
}

/**
 * Whether a vehicle can be parked in `pose` from the start: every tile of it on the map, drivable, open, on the ground
 * and with nobody standing there, and no wall across it.
 */
function parks(world: ReadonlyWorld, type: VehicleType, pose: Pose): boolean {
    const tiles = footprint(VEHICLES[type], pose);
    const people = new Set(world.people.map(p => `${p.pos.x},${p.pos.y}`));
    for (const t of tiles) {
        const tile = tileAt(world, t);
        if (!tile || !tile.drivable || tile.blocksMove || tile.raised || tile.climb || people.has(`${t.x},${t.y}`)) return false;
        for (const n of [{ x: t.x + 1, y: t.y }, { x: t.x, y: t.y + 1 }]) {
            if (tiles.some(u => u.x === n.x && u.y === n.y) && wallBetween(world, t, n)?.blocksMove) return false;
        }
    }
    return true;
}

/**
 * Where a vehicle waits at a getaway spot (decision 320): the pose whose north-west tile is nearest the spot (the
 * generator's own van there is the first tried), lying along the street (west, then east) before across it.
 */
function spotPose(world: ReadonlyWorld, type: VehicleType, at: Pos): Pose | undefined {
    const offsets: Pos[] = [];
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) offsets.push({ x: dx, y: dy });
    offsets.sort((a, b) => Math.max(Math.abs(a.x), Math.abs(a.y)) - Math.max(Math.abs(b.x), Math.abs(b.y)) || Math.abs(a.x) + Math.abs(a.y) - Math.abs(b.x) - Math.abs(b.y));
    for (const o of offsets) for (const heading of ['w', 'e', 'n', 's'] as const) {
        const pose = { x: at.x + o.x, y: at.y + o.y, heading };
        if (parks(world, type, pose)) return pose;
    }
    return undefined;
}

/** What `bank` offers a plan. */
export function planOptions(bank: GeneratedBank, world: ReadonlyWorld = worldFromBank(bank)): PlanOptions {
    const spots = {} as Record<VehicleType, Spot[]>;
    const van = world.vehicles?.find(v => v.id === 'van');
    for (const type of Object.keys(VEHICLES) as VehicleType[]) {
        spots[type] = [];
        for (const g of bank.getaways) {
            // The van keeps the generator's pose at its own spot.
            const own = type === 'van' && van && van.start.x === g.tx && van.start.y === g.ty ? { ...van.start } : undefined;
            const pose = own ?? spotPose(world, type, { x: g.tx, y: g.ty });
            if (pose) spots[type].push({ id: g.id, name: g.name, risk: g.risk, pose });
        }
    }
    const lobbyRoom = bank.rooms.find(r => r.type === 'lobby') ?? bank.rooms[0]!;
    const lobby = { x: lobbyRoom.x + Math.floor(lobbyRoom.w / 2), y: lobbyRoom.y + Math.floor(lobbyRoom.h / 2) };
    const nestRoom = bank.rooms.find(r => r.type === 'nest') ?? null;
    const nest: Pos[] = [];
    if (nestRoom) {
        const people = world.people.map(p => p.pos);
        for (const part of nestRoom.parts) for (let y = part.y; y < part.y + part.h; y++) for (let x = part.x; x < part.x + part.w; x++) {
            const tile = tileAt(world, { x, y });
            if (tile && tile.room && !tile.blocksMove && !people.some(p => p.x === x && p.y === y)) nest.push({ x, y });
        }
        const d = (p: Pos) => Math.abs(p.x - lobby.x) + Math.abs(p.y - lobby.y);
        nest.sort((a, b) => d(a) - d(b) || a.y - b.y || a.x - b.x);
    }
    return { world, spots, nest, nestRoom, lobby, outdoors: bank.rooms.filter(r => r.zone === 'outdoors').map(r => r.id) };
}

/**
 * Whether a pre-placed jammer may stand on `p` (§18.2 "next to the building"): open ground outdoors (not in the bank or
 * a neighbour), within reach of the bank's building.
 */
export function jammerSpot(options: PlanOptions, p: Pos): boolean {
    const { world } = options, tile = tileAt(world, p), building = world.building ?? [];
    if (!tile || !tile.room || tile.blocksMove || tile.raised || !options.outdoors.includes(tile.room)) return false;
    if (world.people.some(n => n.pos.x === p.x && n.pos.y === p.y)) return false;
    for (let dy = -JAMMER_REACH; dy <= JAMMER_REACH; dy++) for (let dx = -JAMMER_REACH; dx <= JAMMER_REACH; dx++) {
        const near = tileAt(world, { x: p.x + dx, y: p.y + dy });
        if (near?.room && building.includes(near.room)) return true;
    }
    return false;
}

/** The plan the screen opens with: §3's four, two walking up from the van, two waiting in it; nothing bought. */
export function defaultSetup(options: PlanOptions): HeistSetup {
    const van = options.spots.van[0];
    if (!van) throw new Error('This bank has no spot for the van');
    return {
        crew: ROSTER.map(m => ({ id: m.id, loadout: structuredClone(m.loadout), start: { at: 'van', aboard: m.id === 'dex' || m.id === 'sol' } })),
        vehicles: { van: van.id },
        jammer: null,
        nest: false
    };
}

/** Why a setup can't be played, as the screen says it; empty when it can. */
export function setupProblems(setup: HeistSetup, options: PlanOptions): string[] {
    const out: string[] = [];
    if (!setup.crew.length) out.push('Pick at least one crew member');
    if (setup.crew.length > CREW_SIZE) out.push(`The contract takes ${CREW_SIZE} at most`);
    const { cash, favours } = spent(setup);
    if (cash > PLANNING_CASH) out.push(`Not enough cash: $${cash / 1000}k of $${PLANNING_CASH / 1000}k`);
    if (favours > FAVOUR_CAP) out.push(`Too many favours: ${favours} of ${FAVOUR_CAP}`);
    const parked: Pos[][] = [];
    for (const [type, spot] of Object.entries(setup.vehicles) as [VehicleType, string][]) {
        const at = options.spots[type].find(s => s.id === spot);
        if (!at) { out.push(`The ${VEHICLES[type].name.toLowerCase()} can't wait there`); continue; }
        const tiles = footprint(VEHICLES[type], at.pose);
        if (parked.some(other => other.some(t => tiles.some(u => u.x === t.x && u.y === t.y)))) out.push('Two vehicles in one spot');
        parked.push(tiles);
    }
    const ids = new Set<string>();
    for (const c of setup.crew) {
        const m = rosterMember(c.id);
        if (!m || ids.has(c.id)) { out.push(`No one else called '${c.id}'`); continue; }
        ids.add(c.id);
        const { loadout } = c;
        const slots: [ItemId | null, readonly ItemId[]][] = [[loadout.primary, SLOT_ITEMS.primary], [loadout.sidearm, SLOT_ITEMS.sidearm], [loadout.armour, SLOT_ITEMS.armour], ...loadout.gadgets.map(g => [g, SLOT_ITEMS.gadget] as [ItemId | null, readonly ItemId[]])];
        if (slots.some(([id, allowed]) => id !== null && !allowed.includes(id))) out.push(`${m.name}'s loadout has something out of its slot`);
        if (c.start.at === 'nest') {
            if (!setup.nest) out.push(`${m.name} starts in the nest: rent it first`);
            else if (!hasLongGun(loadout)) out.push(`${m.name} needs a long gun in the nest`);
        } else if (setup.vehicles[c.start.at] === undefined) out.push(`${m.name} starts by the ${VEHICLES[c.start.at].name.toLowerCase()}, which isn't bought`);
    }
    const inNest = setup.crew.filter(c => c.start.at === 'nest').length;
    if (setup.nest && inNest > options.nest.length) out.push('The nest has no room for everyone');
    if (setup.nest && !options.nestRoom) out.push('This bank has no nest to rent');
    if (setup.jammer && !jammerSpot(options, setup.jammer)) out.push('The jammer must stand outside, next to the building');
    return out;
}

/** The ids each crew vehicle has in the rules. */
const VEHICLE_IDS: Readonly<Record<VehicleType, string>> = { van: 'van', car: 'car', ramTruck: 'ramTruck' };

/**
 * The heist a setup plays (§18.1): the World with the crew's vehicles where the plan parks them, and the crew at their
 * starts with their loadouts, the jammer running from turn 1. Throws for a setup with problems (`setupProblems`).
 */
export function heistFromSetup(bank: GeneratedBank, setup: HeistSetup, options: PlanOptions = planOptions(bank)): { world: ReadonlyWorld; state: State } {
    const built = options.world;
    const problems = setupProblems(setup, options);
    if (problems.length) throw new Error(`The plan can't be played: ${problems.join('; ')}`);
    const vehicles: VehicleDef[] = (Object.keys(VEHICLES) as VehicleType[]).filter(t => setup.vehicles[t] !== undefined).map(type => {
        const spot = options.spots[type].find(s => s.id === setup.vehicles[type])!, spec = VEHICLES[type];
        return { id: VEHICLE_IDS[type], type, name: spec.name, width: spec.width, length: spec.length, start: { ...spot.pose } };
    });
    const world = freezeWorld({ ...built, vehicles } as typeof built);
    const crew: CrewStart[] = [];
    const start = (c: CrewPlan, pos: Pos, facing: Facing, aboard?: string): void => {
        const m = rosterMember(c.id)!;
        crew.push({ id: m.id, name: m.name, pos, facing, items: loadoutItems(c.loadout), traits: [...m.traits], ...(aboard ? { aboard } : {}) });
    };
    // In roster order, so each keeps their colour and number key.
    const order = [...setup.crew].sort((a, b) => ROSTER.findIndex(m => m.id === a.id) - ROSTER.findIndex(m => m.id === b.id));
    const placed = new Map<string, { pos: Pos; facing: Facing; aboard?: string }>();
    // On foot by each vehicle: the free tiles nearest it, as the M1 crew stands by the van (`crewStarts`), facing the bank.
    for (const v of vehicles) {
        const walkers = order.filter(c => c.start.at === v.type && !c.start.aboard);
        if (walkers.length) {
            const tiles = crewStarts(world, { x: v.start.x, y: v.start.y }, walkers.length, [...placed.values()].map(p => p.pos));
            walkers.forEach((c, i) => placed.set(c.id, { pos: tiles[i]!, facing: facingToward(tiles[i]!, options.lobby) ?? 'n' }));
        }
        // Aboard: the rules seat them in the cab (rules/vehicles.ts); they stand on its footprint till then.
        for (const c of order) if (c.start.at === v.type && c.start.aboard) placed.set(c.id, { pos: { x: v.start.x, y: v.start.y }, facing: 'n', aboard: v.id });
    }
    order.filter(c => c.start.at === 'nest').forEach((c, i) => {
        const pos = options.nest[i]!;
        placed.set(c.id, { pos, facing: facingToward(pos, options.lobby) ?? 'n' });
    });
    for (const c of order) {
        const p = placed.get(c.id)!;
        start(c, p.pos, p.facing, p.aboard);
    }
    const state = initialState(world, { seed: (bank.seed.layout * 1000 + bank.seed.population) >>> 0, crew });
    if (setup.jammer) state.jammers.push({ id: newId(state, 'jammer'), pos: { ...setup.jammer }, crew: '', turn: state.turn });
    return { world, state };
}

/**
 * What the crew knows at the start of a planned heist (§17.8, decision 328): each NPC the crew sees or predicts as the
 * heist starts, by how the play scene draws it (`markerKind`), and the vehicles where they wait. The planning map shows
 * only these, as play does at turn 1.
 */
export function startView(bank: GeneratedBank, setup: HeistSetup, options: PlanOptions): { npcs: Record<string, MarkerKind>; vehicles: State['vehicles'] } {
    const { world, state } = heistFromSetup(bank, setup, options);
    const npcs: Record<string, MarkerKind> = {};
    for (const n of state.npcs) {
        const kind = markerKind(world, state, n.id);
        if (kind) npcs[n.id] = kind;
    }
    return { npcs, vehicles: state.vehicles };
}
