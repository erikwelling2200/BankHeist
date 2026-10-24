import { registerWorldHook, type Ctx } from '../core/engine';
import { FACING_STEP, inBounds, tileAt } from '../core/grid';
import { sortedIds } from '../core/json';
import { newId, registerStateInit } from '../core/state';
import type { DeepReadonly, Phase, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import {
    ASSAULT_PHASES, CAR_SEATS, CARS_PER_STAGING, CONTAIN_AGAIN_PHASES, CONTAIN_PHASES, FORCE, GREED_CAP, GREED_PER_BAG, HELICOPTER_FROM, MODE_LABELS,
    NEGOTIATE_HOSTAGE_CAP, NEGOTIATE_PHASES, POLICE_KINDS, REGROUP_PHASES, REGROUP_PHASES_HIGH, SWAT_KINDS, UNSCALED, VAN_SEATS, type PoliceKind, type PoliceMode
} from '../data/police';
import { ABSENT_STATUSES, stepCost } from '../geo/move';
import { inBuilding } from './actions/loot';
import { lootWeight } from './hands';
import { addHeat, heatOf } from './heat';

/*
 * The police director (§13.3, §13.4): who comes, in what, where to, and the rhythm they keep once on scene. Police
 * movement and fighting are M3-05 (officers) and M3-06 (SWAT); here the units are state at their staging points.
 *
 * - **Staging points** are the generator's (`GeneratedBank.staging`: the main street's two ends and the alley mouth),
 *   `World.staging`. A bank without them (a test fixture) gets no police.
 * - **Waves.** When "Police in N" reaches 0 the first wave brings the force of every level reached so far; after that
 *   each heat level reached brings that level's force, and past Heat 5 every 5 ticks does the same (§13.1). A wave is
 *   what is missing from the level's strength (`FORCE`, scaled by greed): new units, and refills of every lost one.
 *   Units already there stay even when heat falls (§13.1), and nothing refills between steps (§13.3). A level reached
 *   between world phases (a kill in the crew phase) sends its wave in the next world phase's devices step.
 * - **Greed** (§13.3): +10% per bag secured, at most +50%, rounded half up, for every kind but the negotiator. A bag
 *   secured is a Heavy or Very heavy loot item taken, not ruined, and out of the building (with its carrier or on the
 *   ground): the van's hold is M3-08's.
 * - **Vehicles** (§13.4) appear at their staging point at the end of the world phase of their wave, with the siren
 *   marker (`policeArriving`); their units get out in the next world phase (`policeDeployed`), on the free tiles nearest
 *   it. Patrol officers come 2 to a **perimeter car**, which parks and stays: at most 2 per staging point (a wreck frees
 *   its slot, M3-08). The rest come in **transport vans** of 4 (a SWAT van for the assault teams, a police van for the
 *   others), which unload in the next phase and drive off in the one after. The **helicopter** comes at Heat 4 and
 *   hovers over the plot. Where each goes is fixed by the state, not rolled: a car to the point with the most free
 *   slots, a van to the point with the fewest cars and vans of its wave, ties in the generator's order (the vans on
 *   the street now don't count: they leave before the next wave, so the forecast holds). `planWave` is the one function
 *   for the wave sent and for the HUD's "Heat 3 in 2: SWAT van, the alley mouth" (`nextWave`).
 * - **Modes** (§13.4): Contain (3) once the first units are out, then Negotiate (2 + 1 per hostage, at most +6) when the
 *   negotiator is on scene, else straight to Assault (4, +1 per heat level above 2), then Regroup (3; 2 from Heat 4),
 *   then Negotiate again if hostages are held and the negotiator is there, else Contain (1) and on to Assault. A mode
 *   counts down once per world phase from the one after it began, and the next begins when it reaches 0, announced
 *   with its length (`policeMode`). Shooting police during Negotiate starts an immediate Assault (`policeDown`).
 *   Answering the negotiator, Stall and the hostage kill that police see are M3-07's and M3-05's.
 * - **Units** aren't NPCs: they are `State.police.units`, each a kind, the vehicle it rides in until it gets out, then
 *   its tile. M3-05 and M3-06 give them sight, movement and fire; `policeDown` takes one off the force.
 *
 * Nothing here rolls or decides anything that isn't on the table: the breaches that §13.6 announces a phase ahead are
 * M3-05's, and police decide movement and targets when they act.
 */

/** A police staging point (§13.4): where vehicles park and units get out. */
export interface StagingPoint { id: string; name: string; pos: Pos }

export type VehicleKind = 'car' | 'van' | 'helicopter';

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
    /** The vehicle it rides in, until it gets out. */
    vehicle: string | null;
    /** Its tile once out, else null. */
    pos: Pos | null;
}

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
        /** A police officer got out of `vehicle` at `pos`. */
        policeDeployed: { unit: string; kind: PoliceKind; vehicle: string; pos: Pos };
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
    state.police = { units: [], vehicles: [], mode: null, sent: 0, refills: 0 };
});

// ---------------------------------------------------------------------------------------------------------- The force

/** Bags secured (§13.3 greed; see the header). */
export function bagsSecured(world: ReadonlyWorld, state: DeepReadonly<State>): number {
    let bags = 0;
    for (const id of sortedIds(state.loot)) {
        const loot = state.loot[id]!;
        if (!loot.taken || loot.ruined || lootWeight(world, id) === 'light') continue;
        const holder = loot.holder === null ? undefined : state.crew.find(c => c.id === loot.holder);
        if (!inBuilding(world, holder ? holder.pos : loot.pos)) bags++;
    }
    return bags;
}

/** The greed scaling now, in percent (§13.3). */
export const greedPercent = (world: ReadonlyWorld, state: DeepReadonly<State>): number => Math.min(GREED_CAP, GREED_PER_BAG * bagsSecured(world, state));

/** A level's strength by kind (§13.3), scaled by greed: rounded half up, in whole numbers. */
export function strength(level: number, greed: number): Record<PoliceKind, number> {
    const base = FORCE[Math.max(1, Math.min(5, level))]!;
    const out = {} as Record<PoliceKind, number>;
    for (const kind of POLICE_KINDS) out[kind] = UNSCALED.has(kind) ? base[kind] : Math.floor((base[kind] * (100 + greed) + 50) / 100);
    return out;
}

/** A vehicle a wave would send: what it is, where it goes and who rides in it. */
export interface PlannedVehicle { kind: VehicleKind; label: string; staging: StagingPoint | null; units: PoliceKind[] }

const LABELS: Readonly<Record<VehicleKind, string>> = { car: 'Police car', van: 'Police van', helicopter: 'Helicopter' };

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
    const send = (kind: VehicleKind, label: string, staging: StagingPoint | null, units: PoliceKind[]): void => {
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
    // The vans: the assault teams together, everyone else together, 4 to a van, to the point with the fewest vehicles.
    const riders = (swat: boolean): PoliceKind[] => POLICE_KINDS.filter(k => SWAT_KINDS.has(k) === swat).flatMap(k => Array.from({ length: missing[k] }, () => k));
    for (const swat of [true, false]) {
        const all = riders(swat);
        for (let i = 0; i < all.length; i += VAN_SEATS) {
            const to = points.reduce((a, b) => (vehicles.get(b.id)! < vehicles.get(a.id)! ? b : a));
            send('van', swat ? 'SWAT van' : LABELS.van, to, all.slice(i, i + VAN_SEATS));
        }
    }
    if (level >= HELICOPTER_FROM && !state.police.vehicles.some(v => v.kind === 'helicopter')) send('helicopter', LABELS.helicopter, null, []);
    return out;
}

/** The middle of the map: where the helicopter hovers. */
const overPlot = (world: ReadonlyWorld): Pos => ({ x: Math.floor(world.width / 2), y: Math.floor(world.height / 2) });

/** Sends a wave (see `planWave`): its vehicles arrive now with their units aboard. */
function sendWave(ctx: Ctx, level: number, reason: WaveReason): void {
    const { world, state } = ctx;
    for (const plan of planWave(world, state, level)) {
        const vehicle: PoliceVehicle = {
            id: newId(state, plan.kind), kind: plan.kind, label: plan.label, staging: plan.staging?.id ?? null,
            pos: plan.staging ? { ...plan.staging.pos } : overPlot(world), arrived: state.turn, status: 'arriving'
        };
        state.police.vehicles.push(vehicle);
        for (const kind of plan.units) state.police.units.push({ id: newId(state, 'police'), kind, vehicle: vehicle.id, pos: null });
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
    const r = state.response;
    if (!r || state.police.sent === 0) return null;
    const heat = heatOf(r.heat);
    const level = Math.min(5, heat.level + 1);
    return { level, reason: heat.level >= 5 ? 'refill' : 'level', inPhases: 5 - heat.tick, vehicles: planWave(world, state, level) };
}

// ---------------------------------------------------------------------------------------------------------- Getting out

/** The free tile nearest a vehicle that a unit can get out onto (no closed door between): not blocked, nobody standing there. */
function exitTile(world: ReadonlyWorld, state: State, from: Pos): Pos {
    const taken = new Set<number>();
    const put = (p: DeepReadonly<Pos>): void => void taken.add(p.y * world.width + p.x);
    for (const c of state.crew) put(c.pos);
    for (const n of state.npcs) if (!ABSENT_STATUSES.has(n.status)) put(n.pos);
    for (const u of state.police.units) if (u.pos) put(u.pos);
    const free = (p: Pos): boolean => inBounds(world, p) && !taken.has(p.y * world.width + p.x) && !tileAt(world, p)!.blocksMove;
    if (free(from)) return { ...from };
    const seen = new Set<number>([from.y * world.width + from.x]), queue: Pos[] = [from];
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
    return { ...from };
}

/** Units in arrived vehicles get out; vans that unloaded last phase drive off. */
function unload(ctx: Ctx, turn: number): boolean {
    const { world, state } = ctx;
    let out = false;
    for (const v of [...state.police.vehicles]) {
        if (v.status === 'unloaded' && v.arrived + 2 <= turn) {
            state.police.vehicles.splice(state.police.vehicles.indexOf(v), 1);
            ctx.emit({ type: 'vehicleLeft', vehicle: v.id });
            continue;
        }
        if (v.status !== 'arriving' || v.arrived >= turn) continue;
        v.status = v.kind === 'van' ? 'unloaded' : 'parked';
        for (const unit of state.police.units.filter(u => u.vehicle === v.id)) {
            unit.vehicle = null;
            unit.pos = exitTile(world, state, v.pos);
            out = true;
            ctx.emit({ type: 'policeDeployed', unit: unit.id, kind: unit.kind, vehicle: v.id, pos: { ...unit.pos } });
        }
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
    state.police.units.splice(state.police.units.indexOf(unit), 1);
    ctx.emit({ type: 'policeDown', unit: unit.id, kind: unit.kind, killed });
    if (!killed) return;
    state.heat.policeKilled++;
    addHeat(ctx, state.heat.policeKilled === 1 ? 'firstPoliceKilled' : 'policeKilled');
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
    p.sent = Math.min(p.sent, heat.level);
    while (p.sent < heat.level) sendWave(ctx, ++p.sent, 'level');
    p.refills = Math.min(p.refills, heat.beyond);
    while (p.refills < heat.beyond) {
        p.refills++;
        sendWave(ctx, 5, 'refill');
    }
}, { order: 3 });

registerEvents({
    policeArriving: { undoBlocking: true },
    policeDeployed: { undoBlocking: true },
    vehicleLeft: { undoBlocking: true },
    policeMode: { undoBlocking: true },
    policeDown: { undoBlocking: true }
});
