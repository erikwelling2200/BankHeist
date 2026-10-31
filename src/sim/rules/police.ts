import { registerCommandHook, registerWorldHook, type Ctx } from '../core/engine';
import { FACING_STEP, inBounds, tileAt } from '../core/grid';
import { sortedIds } from '../core/json';
import { newId, registerStateInit } from '../core/state';
import type { DeepReadonly, Phase, Pos, ReadonlyWorld, State } from '../core/types';
import { registerStateCheck } from '../core/save';
import { registerEvents } from '../core/undo';
import {
    ASSAULT_PHASES, CAR_SEATS, CARS_PER_STAGING, MAX_HEAT, TICKS_PER_LEVEL, CONTAIN_AGAIN_PHASES, CONTAIN_PHASES, FORCE, GREED_CAP, GREED_PER_BAG, HELICOPTER_FROM, MODE_LABELS,
    NEGOTIATE_HOSTAGE_CAP, NEGOTIATE_PHASES, OFFICER_STATS, POLICE_KINDS, REGROUP_PHASES, REGROUP_PHASES_HIGH, SWAT_KINDS, UNSCALED, VAN_SEATS, type PoliceKind, type PoliceMode
} from '../data/police';
import { ABSENT_STATUSES, stepCost } from '../geo/move';
import { inBuilding } from './actions/loot';
import { lootWeight } from './hands';
import type { Lean } from './shot';
import { addHeat, heatAhead, heatOf, phasesUntilHeat } from './heat';

/*
 * The police director (§13.3, §13.4): who comes, in what, where to, and the rhythm they keep once on scene. Police
 * movement and fighting are rules/routine.ts (M3-05) and M3-06 (SWAT); here the units are state at their staging points.
 *
 * - **Staging points** are the generator's (`GeneratedBank.staging`: the main street's two ends and the alley mouth),
 *   `World.staging`. A bank without them (a test fixture) gets no police.
 * - **Waves.** When "Police in N" reaches 0 the first wave brings the force of every level reached so far; after that
 *   each heat level reached brings that level's force, and past Heat 5 every 5 ticks does the same (§13.1). A wave is
 *   what is missing from the level's strength (`FORCE`, scaled by greed): new units, and refills of every lost one.
 *   Units already there stay even when heat falls (§13.1), and nothing refills between steps (§13.3). A level reached
 *   between world phases (a kill in the crew phase) sends its wave in the next world phase's devices step. Steps only
 *   go up: a level fallen from (a release) and reached again is not a new step, and neither is a refill threshold.
 * - **Greed** (§13.3): +10% per bag secured, at most +50%, rounded half up, for every kind but the negotiator. A bag
 *   secured is a Heavy or Very heavy loot item that has been carried or thrown out of the building, not ruined
 *   (`PoliceState.secured`, kept after every command: taking it back inside doesn't unsecure it). The van's hold is
 *   M3-08's.
 * - **Vehicles** (§13.4) appear at their staging point at the end of the world phase of their wave, with the siren
 *   marker (`policeArriving`); their units get out in the next world phase (`policeDeployed`), on the free tiles nearest
 *   it. Patrol officers come 2 to a **perimeter car**, which parks and stays: at most 2 per staging point (a wreck frees
 *   its slot, M3-08). The rest come in **transport vans** of 4: a SWAT van carries a team (a shield and three, or the
 *   heavy pair and two), a police van the others; vans unload in the next phase and drive off in the one after.
 *   **Snipers** walk in on foot (§13.4), two to a team, and are at their staging point a phase after their wave like
 *   everyone else (their raised positions are M3-06's). The **helicopter** comes at Heat 4 and hovers over the plot. Where each goes is fixed by the state, not rolled: a car to the point with the most free
 *   slots, a van to the point with the fewest cars and vans of its wave, ties in the generator's order (the vans on
 *   the street now don't count: they leave before the next wave, so the forecast holds). `planWave` is the one function
 *   for the wave sent and for the HUD's "Heat 3 in 2: SWAT van, the alley mouth" (`nextWave`).
 * - **Modes** (§13.4): Contain (3) once the first units are out, then Negotiate (2 + 1 per hostage, at most +6) when the
 *   negotiator is on scene, else straight to Assault (4, +1 per heat level above 2), then Regroup (3; 2 from Heat 4),
 *   then Negotiate again if hostages are held and the negotiator is there, else Contain (1) and on to Assault. A mode
 *   counts down once per world phase from the one after it began, and the next begins when it reaches 0, announced
 *   with its length (`policeMode`). Shooting police during Negotiate starts an immediate Assault (`policeHit`, which
 *   `policeDown` calls for a kill).
 *   Answering the negotiator and Stall are rules/negotiation.ts's; the hostage kill that police see is deferred (M3-05's notes).
 * - **Units** aren't NPCs: they are `State.police.units`, each a kind, the vehicle it rides in (or on foot) until it
 *   gets out, then its tile, which nobody else may step onto (geo/move.ts `occupancy`). One that finds no free tile
 *   stays aboard until it does. rules/routine.ts (M3-05) gives them sight, movement and fire, M3-06 SWAT team play; `policeDown` takes one off the force.
 *
 * Nothing here rolls or decides anything that isn't on the table: the breaches that §13.6 announces a phase ahead are
 * rules/routine.ts's, and police decide movement and targets when they act.
 */

/** A police staging point (§13.4): where vehicles park and units get out. */
export interface StagingPoint { id: string; name: string; pos: Pos }

export type VehicleKind = 'car' | 'van' | 'helicopter';
/** How a group of a wave comes: in a vehicle, or on foot (snipers). */
export type ArrivalKind = VehicleKind | 'foot';

/** A police vehicle on the street (§13.4). */
export interface PoliceVehicle {
    id: string;
    kind: VehicleKind;
    /** A van's label: 'SWAT van' or 'Police van'. */
    label: string;
    /** Its staging point, or null for the helicopter (over the plot). */
    staging: string | null;
    pos: Pos;
    /** The turn whose world phase it arrived in; its units get out in the next. */
    arrived: number;
    /** Arriving (the siren marker), its units out (a van then drives off), or parked for good (a car, the helicopter). */
    status: 'arriving' | 'unloaded' | 'parked';
}

/** One police officer (§13.3). */
export interface PoliceUnit {
    id: string;
    kind: PoliceKind;
    /** The vehicle it rides in, until it gets out; null on foot or once out. */
    vehicle: string | null;
    /** The staging point it came to. */
    staging: string | null;
    /** The turn whose world phase its wave came in; it is out from the next. */
    arrived: number;
    /** Its tile once out, else null. */
    pos: Pos | null;
    /** Hit points left (§12.3, `OFFICER_STATS`); at 0 it is down (rules/routine.ts). */
    hp: number;
    /** Leaning out past a corner until the next world phase or a move (§11.4), or null. */
    leaning: Lean | null;
    /** Suppressed by a crew member's LMG for the world phase of `turn` (§11.9), as an NPC is (`NpcState.suppressed`). */
    suppressed: { turn: number; by: string; from: Pos; reacted: boolean } | null;
    /** The turn of the world phase it last walked in, or null: an arrest needs it to have stood there since (decision 157). */
    moved: number | null;
}

/**
 * What the police know of a crew member (§13.6): where and when last seen or told, and whether down then; `tile` null
 * once an officer saw that place empty (at `turn`), so a report older than that doesn't bring it back.
 */
export interface PoliceSighting { tile: Pos | null; turn: number; down: boolean }

/** A breach announced a phase ahead (§13.4, §13.6): `unit` breaches `door` in the world phase after `turn`'s. */
export interface Breach { door: string; unit: string; turn: number }

export interface PoliceState {
    units: PoliceUnit[];
    vehicles: PoliceVehicle[];
    /**
     * The director's mode on scene: its world phases left, when it began (it counts down from the next world phase, as
     * a carrier does) and the mode it followed; null until the first units are out.
     */
    mode: { kind: PoliceMode; left: number; since: { turn: number; phase: Phase }; after: PoliceMode | null } | null;
    /** The heat level whose force was last sent (0 until the first arrival). */
    sent: number;
    /** The refills past Heat 5 sent (§13.1). */
    refills: number;
    /** The bags (loot ids) that have left the building, for greed (§13.3). */
    secured: string[];
    /** What the police know of each crew member, by crew id (rules/routine.ts). */
    known: Record<string, PoliceSighting>;
    /** Breaches announced, carried out in the next world phase (rules/routine.ts). */
    breaches: Breach[];
}

declare module '../core/types' {
    interface World {
        /** The police staging points (§13.4), from the generator's. Absent: no police come. */
        staging?: StagingPoint[];
    }
    interface State {
        police: PoliceState;
    }
    interface EventMap {
        /** A police vehicle at its staging point with the siren marker: its units get out next world phase. */
        policeArriving: { vehicle: string; kind: VehicleKind; label: string; staging: string | null; pos: Pos; units: number; level: number; reason: WaveReason };
        /** Officers walking in on foot to a staging point (snipers): there next world phase. */
        policeOnFoot: { units: string[]; kind: PoliceKind; staging: string; pos: Pos; level: number; reason: WaveReason };
        /** A police officer got out of `vehicle` (null: on foot) at `pos`. */
        policeDeployed: { unit: string; kind: PoliceKind; vehicle: string | null; pos: Pos };
        /** A police officer was hit (shot at and struck): ends Negotiate (§13.4). */
        policeHit: { unit: string };
        /** A transport van drove off. */
        vehicleLeft: { vehicle: string };
        /** The director's next mode, for `phases` world phases (§13.4). */
        policeMode: { mode: PoliceMode; phases: number; level: number };
        /** A police officer is off the force: killed or otherwise out (M3-03, M3-05). */
        policeDown: { unit: string; kind: PoliceKind; killed: boolean };
    }
}

/** Why a wave comes: the first arrival, a heat level reached, a refill past Heat 5. */
export type WaveReason = 'arrival' | 'level' | 'refill';

registerStateInit('police', (_world, state) => {
    state.police = { units: [], vehicles: [], mode: null, sent: 0, refills: 0, secured: [], known: {}, breaches: [] };
});

// ---------------------------------------------------------------------------------------------------------- The force

/** The bags out of the building now: Heavy or Very heavy, taken, not ruined, with their carrier or on the ground. */
function bagsOut(world: ReadonlyWorld, state: DeepReadonly<State>): string[] {
    return sortedIds(state.loot).filter(id => {
        const loot = state.loot[id]!;
        if (!loot.taken || loot.ruined || lootWeight(world, id) === 'light') return false;
        const holder = loot.holder === null ? undefined : state.crew.find(c => c.id === loot.holder);
        return !inBuilding(world, holder ? holder.pos : loot.pos);
    });
}

/** Bags secured (§13.3 greed; see the header): out of the building once, not ruined since. */
export function bagsSecured(world: ReadonlyWorld, state: DeepReadonly<State>): number {
    const ids = new Set([...state.police.secured, ...bagsOut(world, state)]);
    return [...ids].filter(id => !state.loot[id]?.ruined).length;
}

// Greed keeps every bag that has been out (see the header).
registerCommandHook('police.secured', ctx => {
    const { world, state } = ctx;
    const out = bagsOut(world, state).filter(id => !state.police.secured.includes(id));
    if (out.length) state.police.secured = [...state.police.secured, ...out].sort();
});

/** The greed scaling now, in percent (§13.3). */
export const greedPercent = (world: ReadonlyWorld, state: DeepReadonly<State>): number => Math.min(GREED_CAP, GREED_PER_BAG * bagsSecured(world, state));

/** A level's strength by kind (§13.3), scaled by greed: rounded half up, in whole numbers. */
export function strength(level: number, greed: number): Record<PoliceKind, number> {
    const base = FORCE[Math.max(1, Math.min(5, level))]!;
    const out = {} as Record<PoliceKind, number>;
    for (const kind of POLICE_KINDS) out[kind] = UNSCALED.has(kind) ? base[kind] : Math.floor((base[kind] * (100 + greed) + 50) / 100);
    return out;
}

/** A group a wave would send: in what (or on foot), where it goes and who comes. */
export interface PlannedVehicle { kind: ArrivalKind; label: string; staging: StagingPoint | null; units: PoliceKind[] }

const LABELS: Readonly<Record<ArrivalKind, string>> = { car: 'Police car', van: 'Police van', helicopter: 'Helicopter', foot: 'Sniper team' };

/** The vans' loads: SWAT teams (a shield and three, the heavy pair and two), then everyone else but snipers, 4 a van. */
function vanLoads(missing: Readonly<Record<PoliceKind, number>>): { swat: boolean; units: PoliceKind[] }[] {
    const left = { ...missing }, loads: { swat: boolean; units: PoliceKind[] }[] = [];
    const take = (kind: PoliceKind, n: number): PoliceKind[] => {
        const k = Math.min(n, left[kind]);
        left[kind] -= k;
        return Array.from({ length: k }, () => kind);
    };
    while (left.swatShield > 0) {
        const team = take('swatShield', 1);
        loads.push({ swat: true, units: [...team, ...take('swat', VAN_SEATS - team.length)] });
    }
    while (left.heavy > 0) {
        const team = take('heavy', 2);
        loads.push({ swat: true, units: [...team, ...take('swat', VAN_SEATS - team.length)] });
    }
    while (left.swat > 0) loads.push({ swat: true, units: take('swat', VAN_SEATS) });
    const rest = POLICE_KINDS.filter(k => !SWAT_KINDS.has(k) && k !== 'sniper').flatMap(k => take(k, left[k]));
    for (let i = 0; i < rest.length; i += VAN_SEATS) loads.push({ swat: false, units: rest.slice(i, i + VAN_SEATS) });
    return loads;
}

/**
 * The vehicles a wave to `level` sends now (see the header): the units missing from the level's strength, by car while
 * a staging point has a slot, then by van, and the helicopter from Heat 4. Pure: the wave sent and the HUD's forecast.
 */
export function planWave(world: ReadonlyWorld, state: DeepReadonly<State>, level: number): PlannedVehicle[] {
    const points = world.staging ?? [];
    if (!points.length) return [];
    const target = strength(level, greedPercent(world, state));
    const missing = {} as Record<PoliceKind, number>;
    for (const kind of POLICE_KINDS) missing[kind] = Math.max(0, target[kind] - state.police.units.filter(u => u.kind === kind).length);
    const cars = new Map<string, number>(), vehicles = new Map<string, number>();
    for (const p of points) {
        cars.set(p.id, 0);
        vehicles.set(p.id, 0);
    }
    // Only the cars that stay count: a van on the street now is gone before the wave it is weighed for.
    for (const v of state.police.vehicles) {
        if (v.kind !== 'car' || v.staging === null || !vehicles.has(v.staging)) continue;
        vehicles.set(v.staging, vehicles.get(v.staging)! + 1);
        cars.set(v.staging, cars.get(v.staging)! + 1);
    }
    const out: PlannedVehicle[] = [];
    const send = (kind: ArrivalKind, label: string, staging: StagingPoint | null, units: PoliceKind[]): void => {
        out.push({ kind, label, staging, units });
        if (!staging) return;
        vehicles.set(staging.id, vehicles.get(staging.id)! + 1);
        if (kind === 'car') cars.set(staging.id, cars.get(staging.id)! + 1);
    };
    // The perimeter cars: patrol officers two to a car, to the point with the most free slots.
    while (missing.patrol > 0) {
        const free = points.filter(p => cars.get(p.id)! < CARS_PER_STAGING);
        if (!free.length) break;
        const to = free.reduce((a, b) => (cars.get(b.id)! < cars.get(a.id)! ? b : a));
        const seats = Math.min(CAR_SEATS, missing.patrol);
        missing.patrol -= seats;
        send('car', LABELS.car, to, Array.from({ length: seats }, () => 'patrol' as const));
    }
    // The vans (see `vanLoads`), then the snipers on foot in pairs, each to the point with the fewest arrivals.
    const fewest = (): StagingPoint => points.reduce((a, b) => (vehicles.get(b.id)! < vehicles.get(a.id)! ? b : a));
    for (const load of vanLoads(missing)) send('van', load.swat ? 'SWAT van' : LABELS.van, fewest(), load.units);
    for (let n = missing.sniper; n > 0; n -= 2) send('foot', LABELS.foot, fewest(), Array.from({ length: Math.min(2, n) }, () => 'sniper' as const));
    if (level >= HELICOPTER_FROM && !state.police.vehicles.some(v => v.kind === 'helicopter')) send('helicopter', LABELS.helicopter, null, []);
    return out;
}

/** The middle of the map: where the helicopter hovers. */
const overPlot = (world: ReadonlyWorld): Pos => ({ x: Math.floor(world.width / 2), y: Math.floor(world.height / 2) });

/** A new officer of a wave, aboard `vehicle` (null: on foot) for `staging`, at full hit points. */
export function newUnit(state: State, kind: PoliceKind, vehicle: string | null, staging: string | null): PoliceUnit {
    return { id: newId(state, 'police'), kind, vehicle, staging, arrived: state.turn, pos: null, hp: OFFICER_STATS[kind].hp, leaning: null, suppressed: null, moved: null };
}

/** Sends a wave (see `planWave`): its vehicles arrive now with their units aboard. */
function sendWave(ctx: Ctx, level: number, reason: WaveReason): void {
    const { world, state } = ctx;
    for (const plan of planWave(world, state, level)) {
        if (plan.kind === 'foot') {
            const units = plan.units.map(kind => newUnit(state, kind, null, plan.staging!.id));
            state.police.units.push(...units);
            ctx.emit({ type: 'policeOnFoot', units: units.map(u => u.id), kind: 'sniper', staging: plan.staging!.id, pos: { ...plan.staging!.pos }, level, reason });
            continue;
        }
        const vehicle: PoliceVehicle = {
            id: newId(state, plan.kind), kind: plan.kind, label: plan.label, staging: plan.staging?.id ?? null,
            pos: plan.staging ? { ...plan.staging.pos } : overPlot(world), arrived: state.turn, status: 'arriving'
        };
        state.police.vehicles.push(vehicle);
        for (const kind of plan.units) state.police.units.push(newUnit(state, kind, vehicle.id, vehicle.staging));
        ctx.emit({
            type: 'policeArriving', vehicle: vehicle.id, kind: vehicle.kind, label: vehicle.label, staging: vehicle.staging, pos: { ...vehicle.pos },
            units: plan.units.length, level, reason
        });
    }
}

/** What the next heat step brings and when (§13.1 "Heat 3 in 2 turns: SWAT van, rear lot"), once the police are on their way. */
export interface NextWave {
    /** The level it is for (5 for a refill past Heat 5). */
    level: number;
    reason: WaveReason;
    /** World phases until it, from the passing of time alone. */
    inPhases: number;
    vehicles: PlannedVehicle[];
}

export function nextWave(world: ReadonlyWorld, state: DeepReadonly<State>): NextWave | null {
    const r = state.response, p = state.police;
    if (!r || !world.staging?.length) return null;
    // Before the first arrival: the force of the level the track will have reached when "Police in N" runs out.
    if (p.sent === 0) {
        const phases = Math.max(1, r.policeIn);
        const level = heatOf(heatAhead(world, state, phases)).level;
        return { level, reason: 'arrival', inPhases: phases, vehicles: planWave(world, state, level) };
    }
    const top = (MAX_HEAT - 1) * TICKS_PER_LEVEL;
    const refill = p.sent >= MAX_HEAT;
    const level = refill ? MAX_HEAT : p.sent + 1;
    const ticks = refill ? top + (p.refills + 1) * TICKS_PER_LEVEL : (level - 1) * TICKS_PER_LEVEL;
    return { level, reason: refill ? 'refill' : 'level', inPhases: Math.max(1, phasesUntilHeat(world, state, ticks)), vehicles: planWave(world, state, level) };
}

// ---------------------------------------------------------------------------------------------------------- Getting out

/**
 * The free tile nearest `from` that a unit can get out onto (no closed door between): not blocked, nobody standing
 * there, crew, NPC or officer. Null when there is none near: the unit waits aboard.
 */
export function exitTile(world: ReadonlyWorld, state: State, from: DeepReadonly<Pos>): Pos | null {
    const taken = new Set<number>();
    const put = (p: DeepReadonly<Pos>): void => void taken.add(p.y * world.width + p.x);
    for (const c of state.crew) put(c.pos);
    for (const n of state.npcs) if (!ABSENT_STATUSES.has(n.status)) put(n.pos);
    for (const u of state.police.units) if (u.pos) put(u.pos);
    const free = (p: Pos): boolean => inBounds(world, p) && !taken.has(p.y * world.width + p.x) && !tileAt(world, p)!.blocksMove;
    const start = { x: from.x, y: from.y };
    if (free(start)) return start;
    const seen = new Set<number>([start.y * world.width + start.x]), queue: Pos[] = [start];
    const steps = (['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'] as const).map(f => FACING_STEP[f]);
    for (let i = 0; i < queue.length && i < 256; i++) {
        const at = queue[i]!;
        for (const d of steps) {
            const next = { x: at.x + d.x, y: at.y + d.y }, k = next.y * world.width + next.x;
            if (!inBounds(world, next) || seen.has(k) || stepCost(world, state, at, next) === undefined) continue;
            seen.add(k);
            if (free(next)) return next;
            queue.push(next);
        }
    }
    return null;
}

/** Arrived vehicles park or unload, everyone due gets out (aboard or on foot), and empty vans unloaded before drive off. */
function unload(ctx: Ctx, turn: number): boolean {
    const { world, state } = ctx, p = state.police;
    let out = false;
    for (const v of [...p.vehicles]) {
        if (v.kind !== 'van' || v.status !== 'unloaded' || v.arrived + 2 > turn || p.units.some(u => u.vehicle === v.id)) continue;
        p.vehicles.splice(p.vehicles.indexOf(v), 1);
        ctx.emit({ type: 'vehicleLeft', vehicle: v.id });
    }
    for (const v of p.vehicles) if (v.status === 'arriving' && v.arrived < turn) v.status = v.kind === 'van' ? 'unloaded' : 'parked';
    for (const unit of p.units) {
        if (unit.pos !== null || unit.arrived >= turn) continue;
        const from = unit.vehicle !== null ? p.vehicles.find(v => v.id === unit.vehicle)?.pos : world.staging?.find(s => s.id === unit.staging)?.pos;
        const tile = from ? exitTile(world, state, from) : null;
        if (!tile) continue;
        ctx.emit({ type: 'policeDeployed', unit: unit.id, kind: unit.kind, vehicle: unit.vehicle, pos: { ...tile } });
        unit.vehicle = null;
        unit.pos = tile;
        out = true;
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------- Modes

/** The hostages held now (§13.4 Negotiate): NPCs Commanded or tied. */
export const hostagesHeld = (state: DeepReadonly<State>): number => state.npcs.filter(n => n.status === 'commanded' || n.status === 'tied').length;

/** Whether the negotiator is out on scene. */
const negotiatorOnScene = (state: DeepReadonly<State>): boolean => state.police.units.some(u => u.kind === 'negotiator' && u.pos !== null);

/** A mode's length now (§13.4), given the mode it follows. */
export function modePhases(state: DeepReadonly<State>, mode: PoliceMode, after: PoliceMode | null): number {
    const level = state.response ? heatOf(state.response.heat).level : 1;
    switch (mode) {
        case 'contain': return after === 'regroup' ? CONTAIN_AGAIN_PHASES : CONTAIN_PHASES;
        case 'negotiate': return NEGOTIATE_PHASES + Math.min(NEGOTIATE_HOSTAGE_CAP, hostagesHeld(state));
        case 'assault': return ASSAULT_PHASES + Math.max(0, level - 2);
        case 'regroup': return level >= 4 ? REGROUP_PHASES_HIGH : REGROUP_PHASES;
    }
}

/** The mode that follows one, given the mode that one followed (§13.4's cycle; see the header). */
export function modeAfter(state: DeepReadonly<State>, mode: PoliceMode, after: PoliceMode | null): PoliceMode {
    switch (mode) {
        case 'contain': return negotiatorOnScene(state) && after !== 'regroup' ? 'negotiate' : 'assault';
        case 'negotiate': return 'assault';
        case 'assault': return 'regroup';
        case 'regroup': return hostagesHeld(state) > 0 && negotiatorOnScene(state) ? 'negotiate' : 'contain';
    }
}

/** Starts a mode now, at its full length, announced (§13.4). */
function startMode(ctx: Ctx, mode: PoliceMode, after: PoliceMode | null): void {
    const { state } = ctx;
    const phases = modePhases(state, mode, after);
    state.police.mode = { kind: mode, left: phases, since: { turn: state.turn, phase: state.phase }, after };
    ctx.emit({ type: 'policeMode', mode, phases, level: state.response ? heatOf(state.response.heat).level : 1 });
    // Breaches are an Assault's (rules/routine.ts): out of it, every marker comes down.
    if (mode !== 'assault') callOffBreaches(ctx, () => true);
}

/** Takes down the announced breaches `which` picks, each told (`breachCalledOff`). */
function callOffBreaches(ctx: Ctx, which: (b: Breach) => boolean): void {
    const p = ctx.state.police;
    for (const b of p.breaches.filter(which)) {
        p.breaches.splice(p.breaches.indexOf(b), 1);
        ctx.emit({ type: 'breachCalledOff', door: b.door, unit: b.unit });
    }
}

/**
 * A crew member fired at an officer (aimed at it, or held it in a Suppress wedge; M3-05): shooting police ends
 * Negotiate in an immediate Assault whether it hits or not (§13.4), and the muzzle flash tells the police where the
 * shooter is (`known`). A hit is also `policeHit`.
 */
export function policeShotAt(ctx: Ctx, unitId: string, crewId: string, from: DeepReadonly<Pos>): void {
    const { state } = ctx;
    if (!state.police.units.some(u => u.id === unitId && u.pos !== null)) return;
    state.police.known[crewId] = { tile: { x: from.x, y: from.y }, turn: state.turn, down: false };
    if (state.police.mode?.kind === 'negotiate') startMode(ctx, 'assault', 'negotiate');
}

/** The director's mode for the HUD: "Assault in 2", "Negotiate (3)". */
export interface PoliceModeView { mode: PoliceMode; label: string; left: number; next: PoliceMode }

export function policeModeView(state: DeepReadonly<State>): PoliceModeView | null {
    const m = state.police.mode;
    if (!m) return null;
    return { mode: m.kind, label: MODE_LABELS[m.kind], left: m.left, next: modeAfter(state, m.kind, m.after) };
}

// ---------------------------------------------------------------------------------------------------------- Losses

/**
 * Takes a police officer off the force (M3-03's death and arrest, M3-05's), for good until the next heat step refills
 * it. A kill adds its heat (§13.2: +3 for the first, +1 after) and ends Negotiate in an immediate Assault (§13.4).
 */
export function policeDown(ctx: Ctx, unitId: string, killed: boolean): void {
    const { state } = ctx;
    const unit = state.police.units.find(u => u.id === unitId);
    if (!unit) return;
    if (killed) policeHit(ctx, unit.id);
    state.police.units.splice(state.police.units.indexOf(unit), 1);
    ctx.emit({ type: 'policeDown', unit: unit.id, kind: unit.kind, killed });
    // A breach it announced won't happen (rules/routine.ts): the marker comes down at once.
    callOffBreaches(ctx, b => b.unit === unit.id);
    if (!killed) return;
    state.heat.policeKilled++;
    addHeat(ctx, state.heat.policeKilled === 1 ? 'firstPoliceKilled' : 'policeKilled');
}

/**
 * A police officer was hit (M3-02's attack, or a kill through `policeDown`): shooting police ends Negotiate in an
 * immediate Assault (§13.4). A miss is not a hit.
 */
export function policeHit(ctx: Ctx, unitId: string): void {
    const { state } = ctx;
    if (!state.police.units.some(u => u.id === unitId)) return;
    ctx.emit({ type: 'policeHit', unit: unitId });
    if (state.police.mode?.kind === 'negotiate') startMode(ctx, 'assault', 'negotiate');
}

// ---------------------------------------------------------------------------------------------------------- The director

// After the heat track (heat.track), so a level reached this phase sends its wave this phase.
registerWorldHook('devices', 'police.director', (ctx, phase) => {
    const { state } = ctx, r = state.response;
    if (!r) return;
    const p = state.police;
    // The mode counts down from the world phase after it began; at 0 the next begins.
    const m = p.mode;
    if (m && !(m.since.turn === phase.turn && m.since.phase === 'world')) {
        m.left--;
        if (m.left <= 0) startMode(ctx, modeAfter(state, m.kind, m.after), m.kind);
    }
    if (unload(ctx, phase.turn) && !p.mode) startMode(ctx, 'contain', null);
    if (r.policeIn > 0) return;
    const heat = heatOf(r.heat);
    if (p.sent === 0) {
        sendWave(ctx, heat.level, 'arrival');
        p.sent = heat.level;
        p.refills = heat.beyond;
        return;
    }
    // Steps only go up (see the header): a level or a refill reached again after a fall brings nothing.
    while (p.sent < heat.level) sendWave(ctx, ++p.sent, 'level');
    while (p.refills < heat.beyond) {
        p.refills++;
        sendWave(ctx, 5, 'refill');
    }
}, { order: 3 });

// A save from before M3-05 has no officers' hit points, nor what the police know or the breaches they announced.
registerStateCheck('police', raw => {
    const p = (raw as unknown as Partial<State>).police as Partial<PoliceState> | undefined;
    if (!p || typeof p !== 'object') return 'no police';
    for (const key of ['units', 'vehicles', 'secured', 'breaches'] as const) if (!Array.isArray(p[key])) return `no police ${key} (saved by an older build)`;
    if (!p.known || typeof p.known !== 'object' || Array.isArray(p.known)) return 'no police knowledge (saved by an older build)';
    for (const u of p.units!) {
        for (const key of ['hp', 'leaning', 'suppressed', 'moved'] as const) if (!Object.hasOwn(u, key)) return `police unit ${u.id} has no ${key} (saved by an older build)`;
    }
    return undefined;
});

registerEvents({
    policeArriving: { undoBlocking: true },
    policeDeployed: { undoBlocking: true },
    vehicleLeft: { undoBlocking: true },
    policeMode: { undoBlocking: true },
    policeDown: { undoBlocking: true },
    policeOnFoot: { undoBlocking: true },
    policeHit: { undoBlocking: true }
});
