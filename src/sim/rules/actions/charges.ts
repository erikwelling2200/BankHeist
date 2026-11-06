import { registerWorldHook, type Ctx } from '../../core/engine';
import { offMap } from '../../core/transit';
import { edgeBetween, edgeKey, inBounds, samePos, tileAt } from '../../core/grid';
import { clonePlain, sortedIds } from '../../core/json';
import { registerStateCheck } from '../../core/save';
import { edgeNow, newId, registerCrewInit, registerStateInit } from '../../core/state';
import type { CrewState, DeepReadonly, EdgeKey, Pos, ReadonlyWorld, State } from '../../core/types';
import { registerEvents } from '../../core/undo';
import { CHARGES, isCharge, TRIPWIRE, type ChargeId } from '../../data/weapons';
import { vehicleAt } from '../../geo/drive';
import { sightMap } from '../../geo/los';
import { ABSENT_STATUSES } from '../../geo/move';
import { tileKey } from '../../geo/shot';
import { makeNoise } from '../../geo/sound';
import { dealHarm } from '../damage';
import { blastVehicles } from '../vehicleDamage';
import { registerEvidenceSource, type Evidence } from '../evidence';
import { bodyPos } from '../place';
import { dropField, edgeSides } from '../fortify';
import { registerStepHook } from '../steps';
import { lacksActions, registerAction } from './act';
import { blastTiles } from './throwables';

/*
 * Charges, gaps and explosions (GAME_DESIGN §12.2, §14.2; implementation plan M4-01, decisions 200–208).
 *
 * - **Wall charges** (`placeCharge { crew, item, edge }`): a breach charge (Glass and Soft walls and doors) or a shaped
 *   charge (Reinforced too, and teller glass), 1 action, hands free, from a tile beside the segment, on a segment its
 *   material lets it open that isn't open already; the illegal act 'plantCharge'. It is **placed** at once, visibly
 *   (`State.charges`, `chargePlaced`), and **goes off at the start of the next world phase** (the engine's `fuses` step,
 *   with the grenades), so it lies a crew phase before it goes off, as grenades do (§6.2). What it does is decided as it
 *   goes off, by `chargeBlast` (also what the preview draws, so they agree):
 *   - the segment opens: a door there is breached, any other wall gets a **gap** (`State.edges`: nothing blocks
 *     movement, sight, sound or bullets across it, `EdgeProps.gap`);
 *   - everyone standing on the **far side** (the tile across the segment and its two neighbours along the wall, each
 *     unless a wall stands between it and the tile across) takes the charge's damage (4, a shaped charge 6), lethal;
 *     the near side, where it was set from, is spared (the charge is shaped to blow outwards);
 *   - **loot** lying within one tile of the gap (both sides' three tiles; loot nobody holds, where the bank keeps it
 *     or dropped) is destroyed (`LootState.ruined`, `lootDestroyed`): the preview shows which;
 *   - a shaped charge that opens a wall leaves **debris** on the tile across it (`State.debris`): half cover that
 *     can't be shot away (geo/shot.ts), unless something stands there already;
 *   - a loud noise where it stood (14; a shaped charge 18), and the bank goes Loud.
 * - **Tripwires** (`placeTripwire { crew, at }`): a combat tool like grenades (decision 101), placed only once the bank
 *   is Loud, 1 action, hands free, on the crew member's tile or one next to it they could step to; the illegal act
 *   'plantCharge'. It goes off as an NPC or an officer steps onto its tile (rules/steps.ts), at that moment, in
 *   the passive walks as in a fighter's (one entering the map onto it too): 6 damage, lethal, to everyone within its
 *   radius of 1 the tile sees (as a grenade's blast), the crew included, and a loud noise of 14.
 * - **Several charges** lying go off in the order they were set, each on the bank as the ones before left it; the
 *   overlay plays them so too (`blastsInOrder`, decision 208).
 * - **Thermite** at the vault door (rules/vault.ts) scorches the loot within one tile of the door every world phase it
 *   burns (`scorchTiles`, `scorch`), as its preview shows.
 */

/** A charge on a wall segment, waiting for its fuse. */
export interface Charge {
    id: string;
    kind: ChargeId;
    /** Who set it. */
    by: string;
    edge: EdgeKey;
    /** The tile it was set from: the near side, spared by the blast. */
    from: Pos;
    /** The turn at the start of whose world phase it goes off. */
    turn: number;
}

/** A tripwire charge lying on a tile. */
export interface Tripwire { id: string; by: string; at: Pos }

declare module '../../core/types' {
    interface State {
        /** Wall charges set and not gone off yet (§12.2). */
        charges: Charge[];
        /** Tripwires lying (§12.2). */
        tripwires: Tripwire[];
        /** Tiles where a blast left debris: half cover (§12.2, §14.2). */
        debris: Pos[];
    }
    interface CrewState {
        /** Wall charges and tripwires left, by item (§12.2: 2 breach charges, 1 shaped charge, 2 tripwires per kit). */
        charges: Record<string, number>;
    }
    interface EdgeProps {
        /** A gap blown through the segment (§14.2): it stops nothing any more. */
        gap?: boolean;
    }
    interface CommandMap {
        /** Set a breach or shaped charge on the wall segment `edge` beside them (1 action): it goes off as the world phase starts. */
        placeCharge: { crew: string; item: string; edge: EdgeKey };
        /** Lay a tripwire on `at`, their tile or one next to it (1 action), once the bank is Loud. */
        placeTripwire: { crew: string; at: Pos };
    }
    interface EventMap {
        chargePlaced: { charge: string; kind: string; crew: string; edge: EdgeKey; from: Pos };
        /** A wall charge `by` a crew member went off: the segment is open (`door` breached, else a gap), `tiles` the far side it hit. */
        chargeWentOff: { charge: string; kind: string; by: string; edge: EdgeKey; door: string | null; tiles: Pos[] };
        /** Debris fell on `at`: half cover. */
        debrisFell: { at: Pos };
        /** Loot was destroyed by a blast or scorched by thermite. */
        lootDestroyed: { loot: string; at: Pos; cause: 'blast' | 'thermite' };
        tripwirePlaced: { tripwire: string; crew: string; at: Pos };
        /** A tripwire went off as `by` (an NPC or an officer) stepped onto it. */
        tripwireWentOff: { tripwire: string; at: Pos; by: string; tiles: Pos[] };
    }
}

registerStateInit('charges', (_world, state) => {
    state.charges = [];
    state.tripwires = [];
    state.debris = [];
});

registerCrewInit('charges', (_world, _start, member) => {
    const charges: Record<string, number> = {};
    for (const id of member.loadout.items) {
        const count = isCharge(id) ? CHARGES[id].count : id === TRIPWIRE.item ? TRIPWIRE.count : 0;
        if (count) charges[id] = (Object.hasOwn(charges, id) ? charges[id]! : 0) + count;
    }
    member.charges = charges;
});

// A save from before charges has none of their state.
registerStateCheck('charges', state => {
    if (!Array.isArray(state.charges) || !Array.isArray(state.tripwires) || !Array.isArray(state.debris)) return 'no charges, tripwires or debris (a save from before M4-01)';
    const crew = state.crew as { charges?: unknown }[] | undefined;
    return crew?.some(c => typeof c.charges !== 'object' || c.charges === null) ? 'a crew member without charges (a save from before M4-01)' : undefined;
});

// ---------------------------------------------------------------------------------------------------------- Geometry

/** Whether nothing that stops sight stands between two orthogonal neighbours now. */
const openBetween = (world: ReadonlyWorld, state: State, a: Pos, b: Pos): boolean => !edgeNow(world, state, edgeKey(edgeBetween(a, b)))?.blocksSight;

/**
 * The strip of three tiles on one side of edge `key`: the tile `side` and its two neighbours along the wall, each only
 * where no wall that stops sight stands between it and `side` (and on the map).
 */
function strip(world: ReadonlyWorld, state: State, key: EdgeKey, side: Pos): Pos[] {
    const e = world.edges[key]!, out: Pos[] = [];
    if (!inBounds(world, side)) return out;
    out.push({ x: side.x, y: side.y });
    for (const k of [-1, 1]) {
        const p = e.run === 'eastWest' ? { x: side.x + k, y: side.y } : { x: side.x, y: side.y + k };
        if (inBounds(world, p) && openBetween(world, state, side, p)) out.push(p);
    }
    return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Loot lying on any of `tiles` that nobody holds and isn't ruined yet, by id. */
export function lootOn(state: DeepReadonly<State>, tiles: readonly Pos[]): string[] {
    const on = new Set(tiles.map(tileKey));
    return sortedIds(state.loot).filter(id => {
        const l = state.loot[id]!;
        return l.holder === null && !l.ruined && on.has(tileKey(l.pos));
    });
}

/** What a charge on `edge`, set from `from`, would do if it went off now: the same function its fuse calls. */
export interface ChargeBlast {
    /** The door it would breach, or null: a gap. */
    door: string | null;
    /** The far side it hits. */
    tiles: Pos[];
    /** Loot it would destroy. */
    loot: string[];
    /** Where it would leave debris, or null. */
    debris: Pos | null;
}

export function chargeBlast(world: ReadonlyWorld, state: State, kind: ChargeId, edge: EdgeKey, from: DeepReadonly<Pos>): ChargeBlast {
    const sides = edgeSides(world, edge)!, near = samePos(sides[0], from) ? sides[0] : sides[1], far = near === sides[0] ? sides[1] : sides[0];
    const door = world.edges[edge]!.door ?? null;
    const tiles = strip(world, state, edge, far), around = [...strip(world, state, edge, near), ...tiles];
    const t = inBounds(world, far) ? tileAt(world, far)! : undefined;
    const covered = !t || t.blocksMove || t.tall || t.halfCover || state.debris.some(p => samePos(p, far)) || state.flipped.some(f => samePos(f.at, far))
        || vehicleAt(world, state, far) !== undefined;
    return { door, tiles, loot: lootOn(state, around), debris: CHARGES[kind].debris && !door && !covered ? { ...far } : null };
}

/** The tiles thermite at a vault door scorches (§12.2 "loot within 1 tile of the door"): both sides of each of its segments. */
export function scorchTiles(world: ReadonlyWorld, state: State, door: string): Pos[] {
    const out = new Map<string, Pos>();
    for (const key of sortedIds(world.edges)) {
        if (world.edges[key]!.door !== door) continue;
        for (const side of edgeSides(world, key)!) for (const p of strip(world, state, key, side)) out.set(tileKey(p), p);
    }
    return [...out.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Destroys loot (a blast, or thermite's fire). */
function destroyLoot(ctx: Ctx, ids: readonly string[], cause: 'blast' | 'thermite'): void {
    for (const id of ids) {
        const loot = ctx.state.loot[id]!;
        loot.ruined = true;
        ctx.emit({ type: 'lootDestroyed', loot: id, at: { ...loot.pos }, cause });
    }
}

/** Thermite burning at a vault door scorches the loot within a tile of it (rules/vault.ts calls it every phase it burns). */
export function scorch(ctx: Ctx, door: string): void {
    destroyLoot(ctx, lootOn(ctx.state, scorchTiles(ctx.world, ctx.state, door)), 'thermite');
}

/**
 * Everyone standing on `tiles` takes `damage` from a blast set by `by`: crew members on foot, NPCs on the map (bodies
 * where they lie), officers out of their vehicles. In crew, NPC, then officer order.
 */
function blastHarm(ctx: Ctx, tiles: readonly Pos[], damage: number, by: string, weapon: string): void {
    const { state } = ctx, on = new Set(tiles.map(tileKey));
    const hit: string[] = [];
    for (const c of state.crew) if (!offMap(c) && on.has(tileKey(c.pos))) hit.push(c.id);
    for (const n of state.npcs) if (!ABSENT_STATUSES.has(n.status) && n.status !== 'dead' && n.stashed === null && on.has(tileKey(bodyPos(state, n)))) hit.push(n.id);
    for (const u of state.police.units) if (u.pos && on.has(tileKey(u.pos))) hit.push(u.id);
    for (const target of hit) dealHarm(ctx, { target, by, cause: 'blast', weapon, hits: 1, damage, lethal: true });
    blastVehicles(ctx, tiles, damage);
}

function goLoud(ctx: Ctx, cause: string): void {
    if (ctx.state.bank.loud) return;
    ctx.state.bank.loud = true;
    ctx.emit({ type: 'wentLoud', cause });
}

/** Takes one charge or tripwire from a crew member's kit; the last one takes the item off them (its profile with it). */
function spendCharge(member: CrewState, item: string): void {
    const left = member.charges[item]! - 1;
    if (left > 0) {
        member.charges[item] = left;
        return;
    }
    delete member.charges[item];
    member.loadout.items = member.loadout.items.filter(id => id !== item);
}

// ---------------------------------------------------------------------------------------------------------- Wall charges

type ChargeCmd = DeepReadonly<{ crew: string; item: string; edge: EdgeKey }>;

/** Why a crew member can't set this charge on that segment now, or undefined. */
export function chargeBlocked(world: ReadonlyWorld, state: State, cmd: ChargeCmd): string | undefined {
    const member = state.crew.find(c => c.id === cmd.crew);
    if (!member) return `No crew member '${cmd.crew}'`;
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    if (!isCharge(cmd.item)) return `'${cmd.item}' isn't a wall charge`;
    if (!((member.charges[cmd.item] ?? 0) > 0)) return `${member.name} has no ${cmd.item} left`;
    if (member.aboard) return `${member.name} is in the van`;
    if (member.dragging !== null || member.loadout.carrying !== null) return `${member.name}'s hands are full`;
    const sides = edgeSides(world, cmd.edge);
    if (!sides || !sides.some(p => samePos(p, member.pos))) return `${member.name} isn't beside that wall`;
    const now = edgeNow(world, state, cmd.edge)!;
    if (!now.blocksMove) return 'It is open already';
    if (!(CHARGES[cmd.item].opens as readonly string[]).includes(now.material)) return `A ${cmd.item === 'shapedCharge' ? 'shaped charge' : 'breach charge'} can't open ${now.material} walls`;
    if (state.charges.some(c => c.edge === cmd.edge)) return 'A charge is set there already';
    return undefined;
}

/** The segments beside a crew member a charge could go on, the one they face first, then north, east, south, west. */
export function chargeEdges(world: ReadonlyWorld, member: DeepReadonly<CrewState>): EdgeKey[] {
    const order = { n: 0, e: 1, s: 2, w: 3 } as Record<string, number>, first = member.facing.length === 1 ? member.facing : '';
    const sides = (['n', 'e', 's', 'w'] as const).slice().sort((a, b) => (a === first ? -1 : b === first ? 1 : order[a]! - order[b]!));
    const step = { n: { x: 0, y: -1 }, e: { x: 1, y: 0 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 } } as const;
    const out: EdgeKey[] = [];
    for (const s of sides) {
        const key = edgeKey(edgeBetween(member.pos, { x: member.pos.x + step[s].x, y: member.pos.y + step[s].y }));
        if (world.edges[key]) out.push(key);
    }
    return out;
}

registerAction('placeCharge', {
    whyNot: (world, state, cmd) => chargeBlocked(world, state, cmd),
    candidates(world, _state, member) {
        const out: { type: 'placeCharge'; crew: string; item: string; edge: EdgeKey }[] = [];
        for (const item of sortedIds(CHARGES)) {
            if (!((member.charges[item] ?? 0) > 0)) continue;
            for (const edge of chargeEdges(world, member)) out.push({ type: 'placeCharge', crew: member.id, item, edge });
        }
        return out;
    },
    cost: () => 1,
    illegal: () => ({ act: 'plantCharge' }),
    run(ctx, member, cmd) {
        const { state } = ctx, item = cmd.item as ChargeId;
        spendCharge(member, item);
        const charge: Charge = { id: newId(state, item), kind: item, by: member.id, edge: cmd.edge, from: { x: member.pos.x, y: member.pos.y }, turn: state.turn };
        state.charges.push(charge);
        ctx.emit({ type: 'chargePlaced', charge: charge.id, kind: item, crew: member.id, edge: cmd.edge, from: { ...charge.from } });
    }
});

/**
 * Opens a wall segment (a charge's blast, a vehicle's ram, rules/ram.ts): a door there is breached (what the crew
 * fortified on its segments goes with it, M4-02: a barricade, blinds, the reinforcing), any other segment gets a gap.
 * Returns the door breached, or null.
 */
export function openSegment(world: ReadonlyWorld, state: State, edge: EdgeKey): string | null {
    const door = world.edges[edge]!.door ?? null;
    const segments = door ? sortedIds(world.edges).filter(k => world.edges[k]!.door === door) : [edge];
    for (const key of segments) {
        if (state.edges[key]?.reinforced) dropField(state, key, 'reinforced', 'material', 'barredFrom');
        if (Object.hasOwn(state.edges, key)) dropField(state, key, 'barricade', 'blinds');
    }
    if (door) state.doors[door] = { ...state.doors[door], status: 'breached' };
    else {
        const was = Object.hasOwn(state.edges, edge) ? state.edges[edge]! : {};
        state.edges[edge] = { ...was, blocksMove: false, blocksSight: false, blocksSound: false, midHeight: false, gap: true };
    }
    return door;
}

/** What a blast does to the fabric of the bank, without its harm or its noise: the segment opened, the loot ruined, the debris. */
function openUp(world: ReadonlyWorld, state: State, charge: DeepReadonly<Charge>, blast: ChargeBlast): void {
    openSegment(world, state, charge.edge);
    for (const id of blast.loot) state.loot[id]!.ruined = true;
    if (blast.debris) state.debris.push({ ...blast.debris });
}

/**
 * The charges lying (and `extra`, a charge previewed, set after them), each as it would go off in the next world
 * phase's fuses step: one after another in the order they were set, each on the bank as the ones before left it
 * (decision 208). What the overlay draws; the fuse plays the same order with the same function.
 */
export function blastsInOrder(world: ReadonlyWorld, state: State, extra?: DeepReadonly<Charge>): { charge: DeepReadonly<Charge>; blast: ChargeBlast }[] {
    const lying: DeepReadonly<Charge>[] = [...state.charges, ...(extra ? [extra] : [])];
    if (!lying.length) return [];
    const copy = clonePlain(state), out: { charge: DeepReadonly<Charge>; blast: ChargeBlast }[] = [];
    for (const charge of lying) {
        const blast = chargeBlast(world, copy, charge.kind, charge.edge, charge.from);
        openUp(world, copy, charge, blast);
        out.push({ charge, blast });
    }
    return out;
}

/** A wall charge going off (see the header). */
function blow(ctx: Ctx, charge: Charge): void {
    const { world, state } = ctx, def = CHARGES[charge.kind];
    const blast = chargeBlast(world, state, charge.kind, charge.edge, charge.from);
    const lost = blast.loot.map(id => ({ id, at: { ...state.loot[id]!.pos } }));
    openUp(world, state, charge, blast);
    ctx.emit({ type: 'chargeWentOff', charge: charge.id, kind: charge.kind, by: charge.by, edge: charge.edge, door: blast.door, tiles: blast.tiles.map(p => ({ ...p })) });
    blastHarm(ctx, blast.tiles, def.damage, charge.by, charge.kind);
    for (const l of lost) ctx.emit({ type: 'lootDestroyed', loot: l.id, at: l.at, cause: 'blast' });
    if (blast.debris) ctx.emit({ type: 'debrisFell', at: { ...blast.debris } });
    makeNoise(ctx, charge.kind, charge.from, `${charge.kind} ${charge.by}`, undefined, charge.by);
    goLoud(ctx, `${charge.kind} ${charge.by}`);
}

// Wall charges set in the crew phase go off as the world phase starts, with the grenades, before anyone acts.
registerWorldHook('fuses', 'charges.fuses', (ctx, phase) => {
    const { state } = ctx;
    const due = state.charges.filter(c => c.turn <= phase.turn);
    state.charges = state.charges.filter(c => c.turn > phase.turn);
    for (const charge of due) blow(ctx, charge);
}, { order: 10 });

// ---------------------------------------------------------------------------------------------------------- Tripwires

type TripCmd = DeepReadonly<{ crew: string; at: Pos }>;

/** Why a crew member can't lay a tripwire on `at` now, or undefined. */
export function tripwireBlocked(world: ReadonlyWorld, state: State, cmd: TripCmd): string | undefined {
    const member = state.crew.find(c => c.id === cmd.crew);
    if (!member) return `No crew member '${cmd.crew}'`;
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    // A combat tool (decision 101): one lying through quiet crew phases would change world phases the safe floor judges.
    if (!state.bank.loud) return 'Tripwires are for when the bank is loud';
    if (!((member.charges[TRIPWIRE.item] ?? 0) > 0)) return `${member.name} has no tripwire left`;
    if (member.aboard) return `${member.name} is in the van`;
    if (member.dragging !== null || member.loadout.carrying !== null) return `${member.name}'s hands are full`;
    const dx = cmd.at.x - member.pos.x, dy = cmd.at.y - member.pos.y;
    if (!inBounds(world, cmd.at) || Math.abs(dx) > 1 || Math.abs(dy) > 1) return 'A tripwire is laid on their tile or the next';
    const tile = tileAt(world, cmd.at)!;
    if (tile.blocksMove) return 'Nobody walks there';
    if ((dx || dy) && (Math.abs(dx) + Math.abs(dy) === 2 ? !diagonalOpen(world, state, member.pos, cmd.at) : !openStep(world, state, member.pos, cmd.at))) return `${member.name} can't reach it from here`;
    if (state.tripwires.some(t => samePos(t.at, cmd.at))) return 'A tripwire lies there already';
    return undefined;
}

const openStep = (world: ReadonlyWorld, state: State, a: DeepReadonly<Pos>, b: DeepReadonly<Pos>): boolean =>
    !edgeNow(world, state, edgeKey(edgeBetween({ x: a.x, y: a.y }, { x: b.x, y: b.y })))?.blocksMove;

/** A diagonal neighbour with an open way round either corner. */
const diagonalOpen = (world: ReadonlyWorld, state: State, a: DeepReadonly<Pos>, b: DeepReadonly<Pos>): boolean =>
    [{ x: b.x, y: a.y }, { x: a.x, y: b.y }].some(c => !tileAt(world, c)?.blocksMove && openStep(world, state, a, c) && openStep(world, state, c, b));

registerAction('placeTripwire', {
    whyNot: (world, state, cmd) => tripwireBlocked(world, state, cmd),
    candidates(world, _state, member) {
        if (!((member.charges[TRIPWIRE.item] ?? 0) > 0)) return [];
        const out: { type: 'placeTripwire'; crew: string; at: Pos }[] = [];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const at = { x: member.pos.x + dx, y: member.pos.y + dy };
            if (inBounds(world, at)) out.push({ type: 'placeTripwire', crew: member.id, at });
        }
        return out;
    },
    cost: () => 1,
    illegal: () => ({ act: 'plantCharge' }),
    run(ctx, member, cmd) {
        const { state } = ctx;
        spendCharge(member, TRIPWIRE.item);
        const wire: Tripwire = { id: newId(state, 'tripwire'), by: member.id, at: { x: cmd.at.x, y: cmd.at.y } };
        state.tripwires.push(wire);
        ctx.emit({ type: 'tripwirePlaced', tripwire: wire.id, crew: member.id, at: { ...wire.at } });
    }
});

/** The tripwire lying on `at`, if any. */
export const tripwireAt = (state: DeepReadonly<State>, at: DeepReadonly<Pos>): DeepReadonly<Tripwire> | undefined => state.tripwires.find(t => t.at.x === at.x && t.at.y === at.y);

/**
 * An NPC or an officer (`by`) stepped onto `at`: a tripwire there goes off. The walks of the world phase call it
 * (rules/steps.ts), and a passive walk stops there.
 */
function tripStep(ctx: Ctx, by: string, at: DeepReadonly<Pos>): void {
    const { world, state } = ctx, wire = tripwireAt(state, at);
    if (!wire) return;
    state.tripwires = state.tripwires.filter(t => t.id !== wire.id);
    const tiles = blastTiles(world, sightMap(world, state), wire.at, TRIPWIRE.radius);
    ctx.emit({ type: 'tripwireWentOff', tripwire: wire.id, at: { x: wire.at.x, y: wire.at.y }, by, tiles: tiles.map(p => ({ ...p })) });
    blastHarm(ctx, tiles, TRIPWIRE.damage, wire.by, TRIPWIRE.item);
    makeNoise(ctx, 'tripwire', { x: wire.at.x, y: wire.at.y }, `tripwire ${wire.by}`, undefined, wire.by);
    goLoud(ctx, `tripwire ${wire.by}`);
}

registerStepHook('tripwires', tripStep, (state, at) => !!tripwireAt(state, at));

// A charge set on a wall is major evidence (as a drill at work is, §8.10); the gap it leaves is a hole (rules/evidence.ts).
registerEvidenceSource('charges', (_world, state) => state.charges.map((c): Evidence => ({ id: `charge:${c.id}`, kind: 'drill', tiles: [{ x: c.from.x, y: c.from.y }] })));

registerEvents({
    chargePlaced: { undoBlocking: false },
    chargeWentOff: { undoBlocking: true },
    debrisFell: { undoBlocking: true },
    lootDestroyed: { undoBlocking: true },
    tripwirePlaced: { undoBlocking: false },
    tripwireWentOff: { undoBlocking: true }
});
