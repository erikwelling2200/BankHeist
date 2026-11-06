import { IllegalCommand, registerCommand, type Ctx } from '../core/engine';
import { edgeBetween, edgeKey, inBounds, tileAt } from '../core/grid';
import { crewMember, edgeNow, spendActions } from '../core/state';
import type { CrewState, DeepReadonly, EdgeKey, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { RAM_DAMAGE, RAM_EXTRA_SEGMENTS, RAM_HIT_DAMAGE, RAM_OPENS, RAM_RUN_UP, RAM_SELF_DAMAGE } from '../data/vehicles';
import { footprint, forwardOf, manoeuvre, policeFootprint, rightOf, vehicleAt, type Pose } from '../geo/drive';
import { ABSENT_STATUSES } from '../geo/move';
import { tileKey } from '../geo/shot';
import { makeNoise } from '../geo/sound';
import { hasTrait } from './alarms';
import { openSegment } from './actions/charges';
import { lacksActions } from './actions/act';
import { dealHarm } from './damage';
import { markerKind, officerSeen, registerCertainView } from './knowledge';
import { damageVehicle } from './vehicleDamage';
import { bodyPos } from './place';
import { asideUnknown, canDrive, carryAlong, driveBudget, refusalAboard, vehicleDef } from './vehicles';
import { isDown } from './wounds';

/*
 * Ramming (§14.4, §14.2; decisions 281–282). `ram { crew, vehicle }`, 1 action of the driver: straight forward only,
 * into the first thing ahead within the Drive's tiles of path, with at least `RAM_RUN_UP` (2) clear tiles of run-up in
 * front of it. A row ahead is clear as a Drive's tile is (rules/vehicles.ts `driveMap`): Drivable, nothing on it, nobody
 * there, no wall across the way to it or along it. What it drives into (`RamPlan.into`), in this order:
 *
 * - **a wall** across its front (any segment that stops movement): Glass or Soft all of it (doors and windows too,
 *   barricaded or not) opens a gap as wide as the vehicle plus one segment (`RAM_EXTRA_SEGMENTS`: the next along the
 *   wall on its right, else its left, if that one is Glass or Soft and shut too); a door among them is breached. The
 *   vehicle stops with its nose in the breach (on the near side: it plugs the gap as full cover, the extra segment the
 *   way through). The impact area is the tiles across the opened segments. Anything harder stops it dead.
 * - **someone** standing or lying in the row ahead (one the crew knows of): hit.
 * - **a police car, van, wreck or the roadblock**: rammed, and shoved aside (`shoveSpot`) where there is room: a police
 *   vehicle slid sideways the least that takes it out of the vehicle's lane, its right first; roadblock pieces in the
 *   row are knocked away. A police vehicle with no room either side is pushed clear off the street (out of play; any
 *   officers still aboard get out at its staging point): a ram always clears its lane (decision 281).
 * - **another crew vehicle**: rammed, not moved.
 * - **anything harder** (a tile that isn't Drivable or is blocked, a wall along the row, the map's north or south
 *   edge): stops it dead.
 *
 * In every case the vehicle stops the tile before the row it drove into; everyone in the impact area (the row ahead, or
 * the tiles across a breach, and the tiles a shoved vehicle slid onto) takes `RAM_DAMAGE` (6, lethal, civilians
 * included) as harm of cause 'ram'; each vehicle rammed takes `RAM_HIT_DAMAGE` (10) and the ramming one
 * `RAM_SELF_DAMAGE` (10; halved with a Wheelman driving and again in the ram truck, decision 284), flat, armour aside;
 * it makes the loud `vehicleRam` noise (16) at its nose and the bank goes Loud. Nothing to ram within reach (the plot's
 * edge, or open street) is refused: that is a Drive.
 *
 * **What the crew knows** (decision 282, as decision 192 for drives). The ram is planned on the crew's picture: those
 * it doesn't see aren't in the way. Someone unseen in the run-up cuts it (`driveCut`): the vehicle stops before them,
 * nothing is rammed and the action is spent; and so does someone unseen in the row ahead of anything but a wall. Those
 * in the impact area beyond a wall, and on a shoved vehicle's new tiles, are hit whoever they are. The player's preview
 * sets everyone unknown on any tile the ram touches aside (`asideUnknown`), so it is the ram with nobody there.
 */

export type RamTarget = 'wall' | 'person' | 'police' | 'vehicle' | 'hard';

/** A ram as planned: the run, what it drives into and everything that follows. */
export interface RamPlan {
    /** Tiles driven before the impact (at least `RAM_RUN_UP`). */
    run: number;
    /** The pose after each tile of the run, and the tiles each sweeps. */
    poses: Pose[];
    steps: Pos[][];
    into: RamTarget;
    /** The row it drives into: the tiles in front of its nose where it stops (across the wall for a wall). */
    row: Pos[];
    /** A wall: the segments across its front that stop it; `opens` when it breaks through them. */
    segments: EdgeKey[];
    opens: boolean;
    /** The segments opened (the front's and the extra one), row-major by key; empty unless `opens`. */
    gap: EdgeKey[];
    /** Where everyone takes the ram's damage: the tiles across the gap, or the row, and where a shoved vehicle went. */
    area: Pos[];
    /** Everyone in the area (as planned: those the crew knows of; as driven: everyone). */
    people: string[];
    /** The vehicles rammed (police ones, then crew ones), by id. */
    rammed: string[];
    /** Police vehicles shoved aside, and their new north-west tile (null: pushed clear off the street). */
    shoved: { vehicle: string; to: Pos | null }[];
    /** Roadblock pieces knocked away. */
    pieces: Pos[];
    /** What the ramming vehicle takes. */
    self: number;
}

declare module '../core/types' {
    interface CommandMap {
        /** The driver rams: straight ahead into the first thing in the way (1 action, §14.4). */
        ram: { crew: string; vehicle: string };
    }
    interface EventMap {
        /** A vehicle rammed something (`RamPlan`): the gap it opened and the doors breached, the area hit. */
        rammed: { crew: string; vehicle: string; into: RamTarget; at: Pose; row: Pos[]; gap: EdgeKey[]; doors: string[]; area: Pos[]; rammed: string[] };
        /** A police vehicle was shoved aside by a ram (`to` null: pushed clear off the street). */
        vehicleShoved: { vehicle: string; from: Pos; to: Pos | null };
        /** Pieces of the roadblock knocked away by a ram. */
        roadblockCleared: { tiles: Pos[] };
    }
}

const add = (p: DeepReadonly<Pos>, d: Pos, k = 1): Pos => ({ x: p.x + d.x * k, y: p.y + d.y * k });
const dot = (p: DeepReadonly<Pos>, d: Pos): number => p.x * d.x + p.y * d.y;
const rowMajor = (a: Pos, b: Pos): number => a.y - b.y || a.x - b.x;

/** Who stands or lies on `p`: crew on foot, NPCs on the map, officers out; `known` only those the crew knows of. */
function peopleOn(world: ReadonlyWorld, state: State, tiles: readonly Pos[], known: boolean): string[] {
    const on = new Set(tiles.map(tileKey)), out: string[] = [];
    for (const c of state.crew) if (c.aboard === null && !c.wounds.dead && on.has(tileKey(c.pos))) out.push(c.id);
    // The living only, where their body lies (as a blast, rules/actions/charges.ts): the dead and the stashed are no one to hit.
    for (const n of state.npcs) {
        if (ABSENT_STATUSES.has(n.status) || n.status === 'dead' || n.stashed !== null || !on.has(tileKey(bodyPos(state, n)))) continue;
        if (!known || markerKind(world, state, n.id) === 'live') out.push(n.id);
    }
    for (const u of state.police.units) if (u.pos && on.has(tileKey(u.pos)) && (!known || officerSeen(world, state, u.id))) out.push(u.id);
    return out;
}

/** Whether a vehicle can't stand on `p` at all (as `driveMap`): off the map, not Drivable, blocked, raised or a climb. */
function hardTile(world: ReadonlyWorld, p: Pos): boolean {
    if (!inBounds(world, p)) return true;
    const t = tileAt(world, p)!;
    return !t.drivable || t.blocksMove || !!t.raised || !!t.climb;
}

const blocks = (world: ReadonlyWorld, state: State, a: Pos, b: Pos): boolean =>
    inBounds(world, a) && inBounds(world, b) && !!edgeNow(world, state, edgeKey(edgeBetween(a, b)))?.blocksMove;

/** The front row of a pose's footprint: its tiles with nothing of it ahead, ordered across it from its left. */
function frontRow(size: { width: number; length: number }, pose: DeepReadonly<Pose>): Pos[] {
    const fp = footprint(size, pose), f = forwardOf(pose.heading), r = rightOf(pose.heading);
    const keys = new Set(fp.map(tileKey));
    return fp.filter(t => !keys.has(tileKey(add(t, f)))).sort((a, b) => dot(a, r) - dot(b, r));
}

/** A ram's damage to the vehicle ramming (see the header). */
function selfDamage(world: ReadonlyWorld, vehicle: string, driver: DeepReadonly<CrewState>): number {
    let d = RAM_SELF_DAMAGE;
    if (hasTrait(driver, 'wheelman')) d = Math.floor(d / 2);
    if (vehicleDef(world, vehicle)?.type === 'ramTruck') d = Math.floor(d / 2);
    return d;
}

/**
 * Where a rammed police vehicle is shoved (see the header): its footprint slid sideways the least that takes it out of
 * the lane (`across`, the lane's span across the ram), its right first, onto tiles a vehicle can stand on with nothing
 * there (no crew or other police vehicle, no roadblock), no wall crossed on the way. Null with no room either side.
 */
function shoveSpot(world: ReadonlyWorld, state: State, id: string, r: Pos, across: readonly [number, number], gone: ReadonlySet<string>): Pos | null {
    const v = state.police.vehicles.find(p => p.id === id)!, fp = policeFootprint(v);
    const others = new Set<string>([
        ...state.police.vehicles.filter(p => p.id !== id).flatMap(p => policeFootprint(p).map(tileKey)),
        ...state.police.roadblock.map(tileKey).filter(k => !gone.has(k))
    ]);
    const span = fp.map(t => dot(t, r));
    for (const side of [1, -1]) {
        // The least slide that takes every tile out of the lane on this side.
        const d = side === 1 ? across[1] - Math.min(...span) + 1 : Math.max(...span) - across[0] + 1;
        if (d <= 0) continue;
        const to = fp.map(t => add(t, r, side * d));
        if (to.some(t => hardTile(world, t) || vehicleAt(world, state, t) !== undefined || others.has(tileKey(t)))) continue;
        let walled = false;
        for (let k = 1; k <= d && !walled; k++) walled = fp.some(t => blocks(world, state, add(t, r, side * (k - 1)), add(t, r, side * k)));
        if (walled) continue;
        return add(v.pos, r, side * d);
    }
    return null;
}

type RamCmd = DeepReadonly<{ crew: string; vehicle: string }>;

/**
 * Why a ram isn't allowed now, or its plan on what the crew knows (`known`, the default) or on the truth (`truth`,
 * everyone in the way). The preview and the commit both drive this plan.
 */
export function ramPlan(world: ReadonlyWorld, state: State, cmd: RamCmd, mode: 'known' | 'truth' = 'known'): RamPlan | string {
    const member = state.crew.find(c => c.id === cmd.crew);
    if (!member) return `No crew member '${cmd.crew}'`;
    const refusal = refusalAboard(member) ?? lacksActions(member, 1);
    if (refusal) return refusal;
    const def = vehicleDef(world, cmd.vehicle), v = state.vehicles[cmd.vehicle];
    if (!def || !v) return `There is no vehicle called '${cmd.vehicle}'`;
    const name = def.name.toLowerCase();
    if (v.gone) return `The ${name} has gone`;
    if (member.aboard !== cmd.vehicle || v.driver !== member.id || isDown(member) || !canDrive(member, cmd.vehicle)) return `${member.name} isn't in the driver's seat`;
    if (v.hp <= 0) return `The ${name} is disabled`;
    const f = forwardOf(v.pose.heading), r = rightOf(v.pose.heading), budget = driveBudget(world, member);
    const lane = frontRow(def, v.pose).map(t => dot(t, r)), across: [number, number] = [Math.min(...lane), Math.max(...lane)];
    const police = new Map<string, string>();
    for (const pv of state.police.vehicles) for (const t of policeFootprint(pv)) police.set(tileKey(t), pv.id);
    const pieces = new Set(state.police.roadblock.map(tileKey));
    const poses: Pose[] = [], steps: Pos[][] = [];
    let pose: Pose = { ...v.pose };
    for (let k = 1; k <= budget + 1; k++) {
        const back = frontRow(def, pose), next: Pose = { x: pose.x + f.x, y: pose.y + f.y, heading: pose.heading }, row = frontRow(def, next);
        // Past the plot's west or east edge the street goes on: nothing there to ram.
        if (row.some(t => t.x < 0 || t.x >= world.width)) return `Nothing to ram ahead of the ${name}`;
        const plan = (into: RamTarget, extra: Partial<RamPlan> = {}): RamPlan | string => {
            const run = k - 1;
            if (run < RAM_RUN_UP) return `The ${name} needs ${RAM_RUN_UP} clear tiles of run-up`;
            const area = extra.area ?? row;
            return {
                run, poses, steps, into, row, segments: [], opens: false, gap: [], area, people: peopleOn(world, state, area, mode === 'known'), rammed: [], shoved: [],
                pieces: [], self: Math.min(selfDamage(world, cmd.vehicle, member), Math.max(0, v.hp - 1)), ...extra
            };
        };
        // A wall across its front.
        const segments = back.map((b, i) => [b, row[i]!] as const).filter(([a, b]) => blocks(world, state, a, b)).map(([a, b]) => edgeKey(edgeBetween(a, b)));
        if (segments.length) {
            const opens = segments.every(key => RAM_OPENS.includes(edgeNow(world, state, key)!.material));
            if (!opens) return plan('hard', { segments: segments.sort(), area: [] });
            const gap = [...segments];
            for (let n = 0; n < RAM_EXTRA_SEGMENTS; n++) {
                for (const side of [1, -1]) {
                    const edge = side === 1 ? back[back.length - 1]! : back[0]!, near = add(edge, r, side * (n + 1)), far = add(near, f);
                    const key = edgeKey(edgeBetween(near, far));
                    if (!world.edges[key] || gap.includes(key) || !blocks(world, state, near, far) || !RAM_OPENS.includes(edgeNow(world, state, key)!.material)) continue;
                    gap.push(key);
                    break;
                }
            }
            const across2 = gap.map(key => {
                const e = world.edges[key]!, a = e.run === 'northSouth' ? { x: e.tx - 1, y: e.ty } : { x: e.tx, y: e.ty - 1 }, b = { x: e.tx, y: e.ty };
                return dot(a, f) > dot(b, f) ? a : b;
            }).filter(p => inBounds(world, p)).sort(rowMajor);
            return plan('wall', { segments: segments.sort(), opens: true, gap: gap.sort(), area: across2 });
        }
        const sideWall = row.some((t, i) => i > 0 && blocks(world, state, row[i - 1]!, t));
        // Someone it can see in the row is hit, whatever they stand on.
        if (peopleOn(world, state, row, mode === 'known').length) return plan('person');
        if (row.some(t => hardTile(world, t)) || sideWall) return plan('hard');
        const crewHit = row.map(t => vehicleAt(world, state, t)).filter((id, i, all): id is string => !!id && id !== cmd.vehicle && all.indexOf(id) === i);
        if (crewHit.length) return plan('vehicle', { rammed: crewHit });
        const copsHit = [...new Set(row.flatMap(t => police.get(tileKey(t)) ?? []))];
        const hitPieces = row.filter(t => pieces.has(tileKey(t))).sort(rowMajor);
        if (copsHit.length || hitPieces.length) {
            const gone = new Set(hitPieces.map(tileKey)), shoved: { vehicle: string; to: Pos | null }[] = [];
            for (const id of copsHit) shoved.push({ vehicle: id, to: shoveSpot(world, state, id, r, across, gone) });
            const moved = shoved.flatMap(s => (s.to ? policeFootprint({ kind: state.police.vehicles.find(p => p.id === s.vehicle)!.kind, pos: s.to }) : []));
            const area = [...new Map([...row, ...moved].map(t => [tileKey(t), t])).values()].sort(rowMajor);
            return plan('police', { rammed: copsHit, shoved, pieces: hitPieces, area });
        }
        if (k > budget) break;
        // A clear tile of run-up.
        const swept = manoeuvre(def, pose, 'forward');
        pose = swept.end;
        poses.push({ ...pose });
        steps.push(swept.tiles);
    }
    return `Nothing to ram within ${budget} tiles of the ${name}`;
}

/** The ram as driven: the plan on what the crew knew, cut before the first one unseen in its way (see the header). */
function ramCut(world: ReadonlyWorld, state: State, plan: RamPlan): { steps: number; by: string | null; at: Pos | null } {
    // Beyond a wall, or in the row of someone it drives into, everyone is hit: elsewhere anyone found was unseen.
    const check = [...plan.steps, ...(plan.into === 'wall' || plan.into === 'person' || !plan.area.length ? [] : [plan.row])];
    // Only someone the crew didn't see cuts it: those it sees were in the plan.
    const unseen = (t: Pos): string[] => {
        const known = new Set(peopleOn(world, state, [t], true));
        return peopleOn(world, state, [t], false).filter(id => !known.has(id));
    };
    for (let i = 0; i < check.length; i++) {
        const hit = check[i]!.find(t => unseen(t).length > 0);
        if (hit) return { steps: Math.min(i, plan.steps.length), by: unseen(hit)[0] ?? null, at: { ...hit } };
    }
    return { steps: plan.steps.length, by: null, at: null };
}

/** The tiles a ram touches (its run, the row ahead and the impact area): who is unknown on them is set aside for its preview. */
const ramTiles = (plan: RamPlan): Pos[] => [...plan.steps.flat(), ...plan.row, ...plan.area];

function goLoud(ctx: Ctx, cause: string): void {
    if (ctx.state.bank.loud) return;
    ctx.state.bank.loud = true;
    ctx.emit({ type: 'wentLoud', cause });
}

registerCommand('ram', (ctx, cmd) => {
    const { world, state } = ctx;
    const plan = ramPlan(world, state, cmd);
    if (typeof plan === 'string') throw new IllegalCommand(plan);
    const member = crewMember(state, cmd.crew), v = state.vehicles[cmd.vehicle]!;
    spendActions(member, 1);
    const from = { ...v.pose }, cut = ramCut(world, state, plan);
    const poses = plan.poses.slice(0, cut.steps), steps = plan.steps.slice(0, cut.steps);
    v.pose = poses.length ? { ...poses[poses.length - 1]! } : from;
    carryAlong(world, state, cmd.vehicle);
    const swept = [...new Map(steps.flat().map(t => [tileKey(t), t])).values()].sort(rowMajor);
    if (poses.length) ctx.emit({ type: 'driven', crew: member.id, vehicle: cmd.vehicle, from, to: { ...v.pose }, path: poses, swept, cost: poses.length, off: false });
    if (cut.at) {
        ctx.emit({ type: 'driveCut', vehicle: cmd.vehicle, by: cut.by, at: cut.at });
        return;
    }
    // The impact.
    const doors: string[] = [];
    for (const key of plan.gap) {
        const door = openSegment(world, state, key);
        if (door && !doors.includes(door)) doors.push(door);
    }
    for (const s of plan.shoved) {
        if (!s.to) continue;
        const pv = state.police.vehicles.find(p => p.id === s.vehicle)!, was = { ...pv.pos };
        pv.pos = { ...s.to };
        ctx.emit({ type: 'vehicleShoved', vehicle: s.vehicle, from: was, to: { ...s.to } });
    }
    if (plan.pieces.length) {
        const gone = new Set(plan.pieces.map(tileKey));
        state.police.roadblock = state.police.roadblock.filter(t => !gone.has(tileKey(t)));
        ctx.emit({ type: 'roadblockCleared', tiles: plan.pieces.map(t => ({ ...t })) });
    }
    ctx.emit({
        type: 'rammed', crew: member.id, vehicle: cmd.vehicle, into: plan.into, at: { ...v.pose }, row: plan.row.map(t => ({ ...t })), gap: [...plan.gap], doors,
        area: plan.area.map(t => ({ ...t })), rammed: [...plan.rammed]
    });
    // Everyone in the impact area, whoever they are (the plan named only those the crew knew of).
    for (const target of peopleOn(world, state, plan.area, false)) dealHarm(ctx, { target, by: member.id, cause: 'ram', weapon: 'vehicleRam', hits: 1, damage: RAM_DAMAGE, lethal: true });
    for (const id of plan.rammed) damageVehicle(ctx, id, { ram: RAM_HIT_DAMAGE }, 'ram');
    damageVehicle(ctx, cmd.vehicle, { ram: plan.self }, 'ram');
    // A police vehicle with no room to be shoved aside is pushed clear off the street; its officers still aboard get
    // out at its staging point.
    for (const s of plan.shoved) {
        if (s.to) continue;
        const i = state.police.vehicles.findIndex(p => p.id === s.vehicle), pv = state.police.vehicles[i]!;
        state.police.vehicles.splice(i, 1);
        for (const u of state.police.units) if (u.vehicle === pv.id && u.pos === null) u.vehicle = null;
        ctx.emit({ type: 'vehicleShoved', vehicle: pv.id, from: { ...pv.pos }, to: null });
    }
    makeNoise(ctx, 'vehicleRam', frontRow(vehicleDef(world, cmd.vehicle)!, v.pose).filter(t => inBounds(world, t)), `ram ${member.id}`, undefined, member.id);
    goLoud(ctx, `ram ${member.id}`);
});

// Someone the crew can't know of on a tile the ram touches: previewed as the ram with nobody there (decision 282).
registerCertainView('ram', (world, state, cmd) => {
    if (cmd.type !== 'ram') return undefined;
    const plan = ramPlan(world, state, cmd);
    return typeof plan === 'string' ? undefined : asideUnknown(world, state, ramTiles(plan));
});

registerEvents({
    rammed: { undoBlocking: true },
    vehicleShoved: { undoBlocking: true },
    roadblockCleared: { undoBlocking: true }
});
