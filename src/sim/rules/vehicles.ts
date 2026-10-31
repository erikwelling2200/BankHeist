import { IllegalCommand, registerCommand, registerCommandHook, type Ctx } from '../core/engine';
import { edgeBetween, edgeKey, inBounds, tileAt } from '../core/grid';
import { clonePlain, sortedIds } from '../core/json';
import { actorRefusal, crewMember, edgeNow, registerActorCheck, registerCrewInit, registerRuleDefaults, registerStateInit, spendActions } from '../core/state';
import type { CrewState, DeepReadonly, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { DRIVE_TILES, WHEELMAN_DRIVE_TILES } from '../data/vehicles';
import {
    cabTile, doorTiles, drivePath, driveReach, footprint, poseKey, vehicleAt, type DriveMap, type DrivePath, type DriveReach, type DriveTile, type Pose, type VehicleDef
} from '../geo/drive';
import { ABSENT_STATUSES, occupancy } from '../geo/move';
import { inHands, syncHands } from './hands';
import { perceiveEnd } from './perceive';
import { lacksActions, registerAction } from './actions/act';
import { hasTrait } from './alarms';
import { markerKind, officerSeen, registerCertainView, registerPreviewSecret } from './knowledge';
import { dropTargets, isDown } from './wounds';

/*
 * The crew's vehicles (§14.4, §15.4): the van waits at its getaway spot from the start (`World.vehicles`, the
 * generator's van); the crew get in and out by its doors, drive it, and put loot in its hold. Leaving the plot and the
 * outcome are rules/getaway.ts's.
 *
 * - **A vehicle on the map** stands on its footprint (geo/drive.ts): nobody walks onto it (geo/move.ts `stepCost`), it
 *   blocks sight and bullets (geo/los.ts, geo/shot.ts) and nothing lands on it. The World's
 *   tiles under it are street, so it can drive away from where it was built.
 * - **Getting in** (`board { crew, vehicle }`, 1 action, §14.4) from a tile its doors open onto (`doorTiles`: the
 *   sliding door on its right, the rear doors), with nobody in hand: they are seen getting in as they stand there, then
 *   sit in its cab (`cabTile`, facing the way it points: they see out of the cab only, decision 190), out of sight and
 *   out of reach (perception skips them, nobody shoots them, nobody reaches them through the doors, `inReach`; what
 *   NPCs meant to do to them is dropped, `dropTargets`), and can only get out or drive (the actor check 'aboard'). A
 *   bag or crate in their hands goes into the hold; cash stays pocketed. The seat goes to whoever aboard can drive
 *   (`settleSeats`, decision 191).
 * - **Getting out** (`getOut { crew, to }`, 1 action) onto a free tile its doors open onto, with no wall between; they
 *   are seen there. The driver getting out leaves the seat to the next crew member aboard, in crew order.
 * - **The hold** (`stow { crew, vehicle }`, 1 action, §14.4 "loot can be thrown in"): from a door tile, the bag or
 *   crate in the hands goes in. Loot in the hold has the vehicle's id as its holder, lies where the vehicle stands and is
 *   never evidence; it stays in until the vehicle leaves.
 * - **Driving** (`drive { crew, vehicle, to }`, 1 action of the driver, §14.4): to any pose `vehicleReach` finds within
 *   8 tiles of path (a Wheelman 16) on what the crew knows, along the one path it found, sweeping exactly the tiles the
 *   preview shows (`drivePlan`, the event's `swept`), unless someone unseen is in the way: it stops short of them
 *   (`driveCut`, decision 192). Everyone aboard rides along. A tile is clear to drive on when it is Drivable,
 *   nothing blocks movement on it, no other vehicle stands on it and nobody stands or lies on it: people in the way
 *   aren't hit, the path goes round them (decision 172; ramming is M4-04). Off the map's west and east edges the street
 *   goes on (decision 173): a drive there leaves the plot.
 * - In stealth a parked vehicle is ignored (§14.4): driving is no illegal act and makes no noise (decision 174).
 */

declare module '../core/types' {
    interface Rules {
        /** Tiles of path one Drive covers (§14.4), and with a Wheelman driving. */
        driveTiles: number;
        wheelmanDriveTiles: number;
    }
    interface CommandMap {
        /** Get into a vehicle from a tile its doors open onto (1 action). */
        board: { crew: string; vehicle: string };
        /** Get out of the vehicle one sits in onto `to`, a free tile its doors open onto (1 action). */
        getOut: { crew: string; to: Pos };
        /** Put the loot in the hands into a vehicle's hold from a tile its doors open onto (1 action). */
        stow: { crew: string; vehicle: string };
        /** The driver drives the vehicle to `to` (1 action): a pose `vehicleReach` finds. */
        drive: { crew: string; vehicle: string; to: Pose };
    }
    interface EventMap {
        boarded: { crew: string; vehicle: string; from: Pos; driver: boolean };
        gotOut: { crew: string; vehicle: string; to: Pos };
        /** Loot went into a vehicle's hold. */
        stowed: { crew: string; vehicle: string; loot: string };
        /** A vehicle drove from `from` to `to` through `path` (the pose after each manoeuvre), sweeping `swept`. */
        driven: { crew: string; vehicle: string; from: Pose; to: Pose; path: Pose[]; swept: Pos[]; cost: number; off: boolean };
        /** The driver's seat changed hands (null: nobody aboard). */
        driverChanged: { vehicle: string; driver: string | null };
        /** A drive stopped short of someone the crew didn't see (`by`) on `at`. */
        driveCut: { vehicle: string; by: string | null; at: Pos };
    }
}

registerRuleDefaults({ driveTiles: DRIVE_TILES, wheelmanDriveTiles: WHEELMAN_DRIVE_TILES });

// Named to run before 'knowledge' (inits run by name): what the crew sees at the start goes round the van.
registerStateInit('crewVehicles', (world, state) => {
    state.vehicles = {};
    for (const v of world.vehicles ?? []) state.vehicles[v.id] = { pose: { ...v.start }, driver: null, hold: [], gone: false };
});

registerCrewInit('aboard', (_world, _start, member) => {
    member.aboard = null;
});

// Aboard, a crew member acts only through the vehicle: getting out and driving check everything else themselves.
registerActorCheck('aboard', member => (member.aboard !== null ? `${member.name} is in a vehicle: get out first` : undefined));

/** Why a crew member can't act at all, the vehicle they sit in aside (for getting out and driving). */
const refusalAboard = (member: DeepReadonly<CrewState>): string | undefined => actorRefusal({ ...member, aboard: null } as DeepReadonly<CrewState>);

// ---------------------------------------------------------------------------------------------------------- Lookups

/** A vehicle's definition, or undefined. */
export const vehicleDef = (world: ReadonlyWorld, id: string): DeepReadonly<VehicleDef> | undefined => world.vehicles?.find(v => v.id === id);

/** The crew members aboard a vehicle, in crew order. */
export const aboard = (state: DeepReadonly<State>, vehicle: string): DeepReadonly<CrewState>[] => state.crew.filter(c => c.aboard === vehicle);

/** The tiles a vehicle's doors open onto now (see the header). */
export function vehicleDoors(world: ReadonlyWorld, state: DeepReadonly<State>, id: string): Pos[] {
    const def = vehicleDef(world, id), v = state.vehicles[id];
    return def && v && !v.gone ? doorTiles(def, v.pose) : [];
}

/** The vehicle on the map whose doors open onto `p` (the first in the World's order), if any. */
export function vehicleBeside(world: ReadonlyWorld, state: DeepReadonly<State>, p: DeepReadonly<Pos>): string | undefined {
    return world.vehicles?.find(v => vehicleDoors(world, state, v.id).some(t => t.x === p.x && t.y === p.y))?.id;
}

/** Whether the loot is in a crew vehicle: in its hold, or carried by someone aboard (§13.3 greed's "secured"). */
export function inGetaway(state: DeepReadonly<State>, lootId: string): boolean {
    const loot = state.loot[lootId];
    if (!loot || loot.holder === null) return false;
    if (Object.hasOwn(state.vehicles, loot.holder)) return true;
    return state.crew.some(c => c.id === loot.holder && c.aboard !== null);
}

/** Where a vehicle's crew and hold are: its driver's seat (`cabTile`), kept on the map. */
function seatOf(world: ReadonlyWorld, def: DeepReadonly<VehicleDef>, pose: DeepReadonly<Pose>): Pos {
    const cab = cabTile(def, pose);
    return { x: Math.max(0, Math.min(world.width - 1, cab.x)), y: Math.max(0, Math.min(world.height - 1, cab.y)) };
}

/**
 * Puts the crew aboard and the hold where the vehicle stands: in the cab, facing the way it points, so they look out
 * of the cab's windows and nowhere else (decision 190).
 */
function carryAlong(world: ReadonlyWorld, state: State, id: string): void {
    const v = state.vehicles[id]!, at = seatOf(world, vehicleDef(world, id)!, v.pose);
    for (const c of state.crew) {
        if (c.aboard !== id) continue;
        c.pos = { ...at };
        c.facing = v.pose.heading;
    }
    for (const loot of v.hold) state.loot[loot]!.pos = { ...at };
}

/** Who can take a vehicle's wheel: aboard it and up (not down or dead). */
const canDrive = (member: DeepReadonly<CrewState> | undefined, id: string): boolean => !!member && member.aboard === id && !isDown(member);

/**
 * The driver's seat after any command (decision 191): kept by its holder while they can drive, else taken by the first
 * crew member aboard who can, in crew order, else free. A driver downed, dead, arrested or out frees it.
 */
function settleSeats(ctx: Ctx): void {
    const { state } = ctx;
    for (const id of sortedIds(state.vehicles ?? {})) {
        const v = state.vehicles[id]!;
        if (v.gone || canDrive(state.crew.find(c => c.id === v.driver), id)) continue;
        const next = state.crew.find(c => canDrive(c, id))?.id ?? null;
        if (next === v.driver) continue;
        v.driver = next;
        ctx.emit({ type: 'driverChanged', vehicle: id, driver: next });
    }
}

registerCommandHook('vehicles.seats', settleSeats, { order: 40 });

// ---------------------------------------------------------------------------------------------------------- Doors

/** Why a crew member can't use a vehicle's door from where they stand, or undefined. */
function doorRefusal(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, id: string): string | undefined {
    const def = vehicleDef(world, id), v = state.vehicles[id];
    if (!def || !v) return `There is no vehicle called '${id}'`;
    if (v.gone) return `The ${def.name.toLowerCase()} has gone`;
    const door = doorTiles(def, v.pose).find(t => t.x === member.pos.x && t.y === member.pos.y);
    if (!door) return `${member.name} isn't at a door of the ${def.name.toLowerCase()}`;
    return wallToDoor(world, state, def, v.pose, door) ? `A wall stands between ${member.name} and the door` : undefined;
}

/** Whether a wall that stops movement stands between a door tile and the vehicle. */
function wallToDoor(world: ReadonlyWorld, state: State, def: DeepReadonly<VehicleDef>, pose: DeepReadonly<Pose>, door: Pos): boolean {
    const body = footprint(def, pose).find(t => Math.abs(t.x - door.x) + Math.abs(t.y - door.y) === 1);
    return !!body && !!edgeNow(world, state, edgeKey(edgeBetween(body, door)))?.blocksMove;
}

registerAction('board', {
    whyNot(world, state, cmd) {
        const member = state.crew.find(c => c.id === cmd.crew)!;
        const lack = lacksActions(member, 1);
        if (lack) return lack;
        if (member.dragging !== null) return `${member.name} can't get in with someone in hand`;
        return doorRefusal(world, state, member, cmd.vehicle);
    },
    candidates: (world, _state, member) => (world.vehicles ?? []).map(v => ({ type: 'board' as const, crew: member.id, vehicle: v.id })),
    cost: () => 1,
    run(ctx, member, cmd) {
        const { world, state } = ctx, v = state.vehicles[cmd.vehicle]!;
        const from = { x: member.pos.x, y: member.pos.y };
        // Seen getting in where they stand (§14.4), before the doors shut behind them.
        perceiveEnd(ctx, member.id);
        const bag = inHands(world, state, member.id);
        if (bag !== undefined) stowLoot(ctx, member, cmd.vehicle, bag);
        member.aboard = cmd.vehicle;
        member.leaning = null;
        member.holding = null;
        member.arms.watch = null;
        member.arms.aiming = null;
        member.arms.braced = false;
        // Out of every NPC's reach: what they meant to do to them is off (what they know of them stays).
        dropTargets(state, member.id);
        carryAlong(world, state, cmd.vehicle);
        // A free seat, or one whose holder can no longer drive, is theirs.
        const driver = !canDrive(state.crew.find(c => c.id === v.driver), cmd.vehicle);
        if (driver) v.driver = member.id;
        ctx.emit({ type: 'boarded', crew: member.id, vehicle: cmd.vehicle, from, driver });
    }
}, { perceive: false });

/** The tiles a crew member aboard could get out onto now: the vehicle's door tiles that are free and not walled off. */
export function exitTiles(world: ReadonlyWorld, state: State, crewId: string): Pos[] {
    const member = state.crew.find(c => c.id === crewId);
    const id = member?.aboard;
    if (!member || !id) return [];
    const def = vehicleDef(world, id)!, v = state.vehicles[id]!;
    const people = occupancy(world, state, { mover: member.id });
    return doorTiles(def, v.pose).filter(t => {
        const tile = tileAt(world, t);
        return !!tile && !tile.blocksMove && !vehicleAt(world, state, t) && !people.has(t.y * world.width + t.x) && !wallToDoor(world, state, def, v.pose, t);
    });
}

function getOutRefusal(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, to: DeepReadonly<Pos>): string | undefined {
    const refusal = refusalAboard(member) ?? lacksActions(member, 1);
    if (refusal) return refusal;
    if (member.aboard === null) return `${member.name} isn't in a vehicle`;
    return exitTiles(world, state, member.id).some(t => t.x === to.x && t.y === to.y) ? undefined : `${member.name} can't get out there`;
}

registerCommand('getOut', (ctx, cmd) => {
    const { world, state } = ctx, member = crewMember(state, cmd.crew);
    const why = getOutRefusal(world, state, member, cmd.to);
    if (why) throw new IllegalCommand(why);
    spendActions(member, 1);
    const id = member.aboard!;
    member.aboard = null;
    member.pos = { x: cmd.to.x, y: cmd.to.y };
    ctx.emit({ type: 'gotOut', crew: member.id, vehicle: id, to: { ...member.pos } });
    // The seat they leave passes on (`settleSeats`, after the command).
    // Seen getting out where they stand (§14.4).
    perceiveEnd(ctx, member.id);
});

// ---------------------------------------------------------------------------------------------------------- The hold

function stowLoot(ctx: Ctx, member: CrewState, vehicle: string, lootId: string): void {
    const { world, state } = ctx, v = state.vehicles[vehicle]!, loot = state.loot[lootId]!;
    loot.holder = vehicle;
    loot.pos = { x: Math.max(0, Math.min(world.width - 1, v.pose.x)), y: Math.max(0, Math.min(world.height - 1, v.pose.y)) };
    v.hold.push(lootId);
    syncHands(world, state, member);
    ctx.emit({ type: 'stowed', crew: member.id, vehicle, loot: lootId });
}

registerAction('stow', {
    whyNot(world, state, cmd) {
        const member = state.crew.find(c => c.id === cmd.crew)!;
        const lack = lacksActions(member, 1);
        if (lack) return lack;
        if (inHands(world, state, member.id) === undefined) return `${member.name} has no bag or crate in their hands`;
        return doorRefusal(world, state, member, cmd.vehicle);
    },
    candidates: (world, state, member) => (inHands(world, state, member.id) === undefined ? [] : (world.vehicles ?? []).map(v => ({ type: 'stow' as const, crew: member.id, vehicle: v.id }))),
    cost: () => 1,
    run(ctx, member, cmd) {
        stowLoot(ctx, member, cmd.vehicle, inHands(ctx.world, ctx.state, member.id)!);
    }
});

// ---------------------------------------------------------------------------------------------------------- Driving

/**
 * How a vehicle sees the map now (see the header): the tiles it may drive on, off the plot, or in its way. `known`
 * (the default) plans on what the crew knows (decision 192): the crew, the NPCs and officers it sees now and the police
 * vehicles (always shown) are in the way, anyone else is taken to be absent; `truth` puts everyone in the way, as the
 * drive meets them. Nothing counts as standing on the vehicle's own footprint: nobody can.
 */
export function driveMap(world: ReadonlyWorld, state: State, id: string, mode: 'known' | 'truth' = 'known'): DriveMap {
    const { width, height } = world;
    const blocked = new Uint8Array(width * height);
    world.tiles.forEach((t, i) => { if (!t.drivable || t.blocksMove || t.raised || t.climb) blocked[i] = 1; });
    const own = vehicleDef(world, id), now = state.vehicles[id];
    const mine = new Set((own && now ? footprint(own, now.pose) : []).map(t => t.y * width + t.x));
    const put = (p: DeepReadonly<Pos>): void => { if (inBounds(world, p) && !mine.has(p.y * width + p.x)) blocked[p.y * width + p.x] = 1; };
    for (const def of world.vehicles ?? []) {
        const v = state.vehicles[def.id];
        if (def.id !== id && v && !v.gone) for (const t of footprint(def, v.pose)) put(t);
    }
    // Nobody is driven over: crew on foot, NPCs on the map standing or lying, police out on scene and their vehicles.
    const sees = mode === 'truth' ? () => true : (npc: string) => markerKind(world, state, npc) === 'live';
    for (const c of state.crew) if (c.aboard === null) put(c.pos);
    for (const n of state.npcs) if (!ABSENT_STATUSES.has(n.status) && sees(n.id)) put(n.pos);
    for (const u of state.police?.units ?? []) if (u.pos && (mode === 'truth' || officerSeen(world, state, u.id))) put(u.pos);
    for (const pv of state.police?.vehicles ?? []) if (pv.kind !== 'helicopter') put(pv.pos);
    const edge = (y: number, x: number): boolean => !!world.tiles[y * width + x]!.drivable;
    return {
        tile(p): DriveTile {
            if (p.y < 0 || p.y >= height) return 'blocked';
            if (p.x < 0) return edge(p.y, 0) ? 'off' : 'blocked';
            if (p.x >= width) return edge(p.y, width - 1) ? 'off' : 'blocked';
            return blocked[p.y * width + p.x] ? 'blocked' : 'clear';
        },
        wall: (a, b) => inBounds(world, a) && inBounds(world, b) && !!edgeNow(world, state, edgeKey(edgeBetween(a, b)))?.blocksMove
    };
}

/** A driver's tiles of path per Drive (§14.4): 8, or 16 for a Wheelman. */
export const driveBudget = (world: ReadonlyWorld, member: DeepReadonly<CrewState>): number =>
    (hasTrait(member, 'wheelman') ? world.rules.wheelmanDriveTiles : world.rules.driveTiles);

/** Every pose a vehicle can reach with one Drive by its driver now (the overlay's highlight), or null when it can't drive. */
export function vehicleReach(world: ReadonlyWorld, state: State, id: string): DriveReach | null {
    const def = vehicleDef(world, id), v = state.vehicles[id];
    const driver = state.crew.find(c => c.id === v?.driver);
    if (!def || !v || v.gone || !driver || !canDrive(driver, id)) return null;
    return driveReach(def, v.pose, driveBudget(world, driver), driveMap(world, state, id));
}

/** Why a drive isn't allowed now, or its path: the poses, the tiles it sweeps and whether it leaves the plot. Also its preview. */
export function drivePlan(world: ReadonlyWorld, state: State, cmd: DeepReadonly<{ crew: string; vehicle: string; to: Pose }>): DrivePath | string {
    const member = state.crew.find(c => c.id === cmd.crew);
    if (!member) return `No crew member '${cmd.crew}'`;
    const refusal = refusalAboard(member) ?? lacksActions(member, 1);
    if (refusal) return refusal;
    const def = vehicleDef(world, cmd.vehicle), v = state.vehicles[cmd.vehicle];
    if (!def || !v) return `There is no vehicle called '${cmd.vehicle}'`;
    if (v.gone) return `The ${def.name.toLowerCase()} has gone`;
    if (member.aboard !== cmd.vehicle || v.driver !== member.id || isDown(member)) return `${member.name} isn't in the driver's seat`;
    if (poseKey(cmd.to) === poseKey(v.pose)) return 'The vehicle is there already';
    const path = drivePath(vehicleReach(world, state, cmd.vehicle)!, cmd.to);
    return path ?? `The ${def.name.toLowerCase()} can't get there with one drive`;
}

/** What happens once a drive has taken a vehicle off the plot (rules/getaway.ts), by name. */
export type LeaveHook = (ctx: Ctx, vehicle: string) => void;
const LEAVE_HOOKS = new Map<string, LeaveHook>();

/** Adds a named hook run, by name, when a vehicle leaves the plot. */
export function registerLeaveHook(name: string, hook: LeaveHook): void {
    if (LEAVE_HOOKS.has(name)) throw new Error(`Leave hook '${name}' already exists`);
    LEAVE_HOOKS.set(name, hook);
}

/**
 * The drive as it happens (decision 192): the planned path, a manoeuvre at a time, stopping before the first whose
 * sweep meets someone the crew didn't see (`by`); the whole plan when nobody is in the way.
 */
export function driveCut(world: ReadonlyWorld, state: State, vehicle: string, plan: DrivePath): { steps: number; by: string | null; at: Pos | null } {
    const truth = driveMap(world, state, vehicle, 'truth');
    for (let i = 0; i < plan.steps.length; i++) {
        const hit = plan.steps[i]!.find(t => truth.tile(t) === 'blocked');
        if (hit) return { steps: i, by: whoIsOn(state, hit), at: { x: hit.x, y: hit.y } };
    }
    return { steps: plan.steps.length, by: null, at: null };
}

/** Who stands on `p` (an NPC or an officer), for a cut drive. */
function whoIsOn(state: State, p: Pos): string | null {
    const npc = state.npcs.find(n => !ABSENT_STATUSES.has(n.status) && n.pos.x === p.x && n.pos.y === p.y);
    if (npc) return npc.id;
    return state.police?.units.find(u => u.pos && u.pos.x === p.x && u.pos.y === p.y)?.id ?? null;
}

registerCommand('drive', (ctx, cmd) => {
    const { world, state } = ctx;
    const plan = drivePlan(world, state, cmd);
    if (typeof plan === 'string') throw new IllegalCommand(plan);
    const member = crewMember(state, cmd.crew), v = state.vehicles[cmd.vehicle]!;
    spendActions(member, 1);
    const from = { ...v.pose }, cut = driveCut(world, state, cmd.vehicle, plan);
    const poses = plan.poses.slice(0, cut.steps), steps = plan.steps.slice(0, cut.steps);
    const swept = [...new Map(steps.flat().map(t => [`${t.x},${t.y}`, t])).values()].sort((a, b) => a.y - b.y || a.x - b.x);
    const off = cut.steps === plan.steps.length && plan.off;
    v.pose = poses.length ? { ...poses[poses.length - 1]! } : from;
    carryAlong(world, state, cmd.vehicle);
    // The tiles of path actually driven: the whole plan's, or those up to the cut.
    const cost = plan.costs.slice(0, cut.steps).reduce((a, b) => a + b, 0);
    ctx.emit({ type: 'driven', crew: member.id, vehicle: cmd.vehicle, from, to: { ...v.pose }, path: poses, swept, cost, off });
    if (cut.at) ctx.emit({ type: 'driveCut', vehicle: cmd.vehicle, by: cut.by, at: cut.at });
    if (off) for (const name of [...LEAVE_HOOKS.keys()].sort()) LEAVE_HOOKS.get(name)!(ctx, cmd.vehicle);
});

// Someone the crew didn't see in the way is found by driving into them: a preview can't tell (decision 192). The
// player's preview (`previewCertain`) drives it as if they weren't there: everyone unknown on the plan's sweep is set
// aside (an NPC away, an officer off the map) for the preview and put back after, so it is the very preview of the same
// drive with nobody there: its events, the van's pose, its undo.
registerPreviewSecret('driveCut');
registerCertainView('drive', (world, state, cmd) => {
    if (cmd.type !== 'drive') return undefined;
    const plan = drivePlan(world, state, cmd);
    if (typeof plan === 'string') return undefined;
    const truth = driveMap(world, state, cmd.vehicle, 'truth'), known = driveMap(world, state, cmd.vehicle);
    const hidden = new Set(plan.steps.flat().filter(t => truth.tile(t) === 'blocked' && known.tile(t) !== 'blocked').map(t => `${t.x},${t.y}`));
    if (!hidden.size) return undefined;
    const on = (p: DeepReadonly<Pos> | null): boolean => !!p && hidden.has(`${p.x},${p.y}`);
    const npcs = state.npcs.filter(n => !ABSENT_STATUSES.has(n.status) && on(n.pos)).map(n => n.id);
    const units = (state.police?.units ?? []).filter(u => on(u.pos)).map(u => u.id);
    const aside = clonePlain(state);
    for (const n of aside.npcs) if (npcs.includes(n.id)) n.status = 'away';
    for (const u of aside.police.units) if (units.includes(u.id)) u.pos = null;
    return {
        state: aside,
        restore(previewed) {
            for (const id of npcs) previewed.npcs[previewed.npcs.findIndex(n => n.id === id)] = clonePlain(state.npcs.find(n => n.id === id)!);
            for (const id of units) {
                const i = previewed.police.units.findIndex(u => u.id === id);
                if (i >= 0) previewed.police.units[i] = clonePlain(state.police.units.find(u => u.id === id)!);
            }
        }
    };
});

/** Every loot id in a vehicle's hold, sorted (for views). */
export const holdOf = (state: DeepReadonly<State>, id: string): string[] => sortedIds(state.loot).filter(l => state.loot[l]!.holder === id);

/** The value of what a vehicle's hold holds (ruined stacks are worth nothing). */
export function holdValue(world: ReadonlyWorld, state: DeepReadonly<State>, id: string): number {
    let sum = 0;
    for (const l of holdOf(state, id)) if (!state.loot[l]!.ruined) sum += world.objects.find(o => o.id === l)?.loot?.value ?? 0;
    return sum;
}

registerEvents({
    // Getting in and out is seen (perception runs); the hold and the seat change nobody else.
    boarded: { undoBlocking: false },
    gotOut: { undoBlocking: false },
    stowed: { undoBlocking: false },
    driverChanged: { undoBlocking: false },
    driven: { undoBlocking: false },
    driveCut: { undoBlocking: true }
});
