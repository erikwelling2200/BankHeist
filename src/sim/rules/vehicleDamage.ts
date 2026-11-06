import type { Ctx } from '../core/engine';
import { sortedIds } from '../core/json';
import { registerStateCheck } from '../core/save';
import type { DeepReadonly, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { POLICE_VEHICLES, VEHICLES, type VehicleSpec } from '../data/vehicles';
import { footprint, policeFootprint } from '../geo/drive';
import { tileKey } from '../geo/shot';

/*
 * Vehicle damage (§14.4, decision 280): every vehicle on the street has hit points and armour (`VEHICLES`,
 * `POLICE_VEHICLES`). Bullets and explosions damage them like anything else: each hit takes the vehicle's armour off
 * its damage first. A ram deals a flat 10 to the vehicle rammed and 10 to the one ramming (rules/ram.ts).
 *
 * - **Bullets.** A bullet that stops on a crew vehicle's footprint (it is full cover, geo/shot.ts) hits it with the
 *   damage it had left (rules/shot.ts `resolveShot`). Police vehicles aren't cover in the shot map yet, so no bullet
 *   stops on one (deferred with police cover).
 * - **Explosions.** A blast (a grenade, a wall charge's far side, a tripwire) hits every vehicle with a footprint tile
 *   among its tiles, once.
 * - **Disabled** (a crew vehicle at 0): it stays where it is as full cover; it can't drive or ram, and the crew can still
 *   get out (rules/vehicles.ts). A police car or van at 0 is a **wreck** (`PoliceVehicle.status`): it stays as a
 *   burnt-out shell in the way of every drive, frees its staging slot, and a ram still shoves it aside.
 */

declare module '../core/types' {
    interface EventMap {
        /** A vehicle took `damage` (after armour) from a shot, a blast or a ram, `hp` left; `police` for a police vehicle. */
        vehicleDamaged: { vehicle: string; police: boolean; damage: number; hp: number; cause: 'shot' | 'blast' | 'ram' };
        /** A crew vehicle reached 0 hit points: disabled where it stands. */
        vehicleDisabled: { vehicle: string };
        /** A police vehicle reached 0 hit points: a wreck. */
        policeWrecked: { vehicle: string; pos: Pos };
    }
}

/** Whether a crew vehicle is disabled (0 hit points). */
export const vehicleDisabled = (state: DeepReadonly<State>, id: string): boolean => (state.vehicles[id]?.hp ?? 1) <= 0;

/** A crew vehicle's numbers by its definition's type. */
export const crewSpec = (world: ReadonlyWorld, id: string): VehicleSpec | undefined => {
    const def = world.vehicles?.find(v => v.id === id);
    return def ? VEHICLES[def.type] : undefined;
};

/** A police vehicle's numbers by its kind, if it has a body (not the helicopter). */
export const policeSpec = (kind: string): VehicleSpec | undefined => (POLICE_VEHICLES as Readonly<Record<string, VehicleSpec>>)[kind];

/**
 * Deals damage to a vehicle (crew or police, by id): `hits` (a number each, bullets or a blast) each less its armour;
 * a ram's flat `ram` damage isn't. Emits one `vehicleDamaged` (even at 0: the armour stopped it), and
 * `vehicleDisabled` or `policeWrecked` as it reaches 0. Nothing happens to a vehicle already at 0, gone, or unknown.
 */
export function damageVehicle(ctx: Ctx, id: string, hits: readonly number[] | { ram: number }, cause: 'shot' | 'blast' | 'ram'): void {
    const { world, state } = ctx;
    const dealt = (armour: number): number => ('ram' in hits ? hits.ram : hits.reduce((sum, h) => sum + Math.max(0, h - armour), 0));
    const crew = state.vehicles[id], spec = crew ? crewSpec(world, id) : undefined;
    if (crew && spec) {
        if (crew.gone || crew.hp <= 0) return;
        const damage = dealt(spec.armour);
        crew.hp = Math.max(0, crew.hp - damage);
        ctx.emit({ type: 'vehicleDamaged', vehicle: id, police: false, damage, hp: crew.hp, cause });
        if (crew.hp <= 0) ctx.emit({ type: 'vehicleDisabled', vehicle: id });
        return;
    }
    const cop = state.police.vehicles.find(v => v.id === id), pspec = cop ? policeSpec(cop.kind) : undefined;
    if (!cop || !pspec || cop.hp <= 0) return;
    const damage = dealt(pspec.armour);
    cop.hp = Math.max(0, cop.hp - damage);
    ctx.emit({ type: 'vehicleDamaged', vehicle: id, police: true, damage, hp: cop.hp, cause });
    if (cop.hp > 0) return;
    cop.status = 'wreck';
    ctx.emit({ type: 'policeWrecked', vehicle: id, pos: { ...cop.pos } });
}

/** The vehicles (crew ones on the map, then police ones with a body) with a footprint tile among `tiles`, by id. */
export function vehiclesOn(world: ReadonlyWorld, state: DeepReadonly<State>, tiles: readonly DeepReadonly<Pos>[]): string[] {
    const on = new Set(tiles.map(p => tileKey({ x: p.x, y: p.y }))), out: string[] = [];
    for (const def of world.vehicles ?? []) {
        const v = state.vehicles[def.id];
        if (v && !v.gone && footprint(def, v.pose).some(t => on.has(tileKey(t)))) out.push(def.id);
    }
    for (const v of state.police.vehicles) if (policeFootprint(v).some(t => on.has(tileKey(t)))) out.push(v.id);
    return out;
}

/** A blast of `damage` on `tiles` hits every vehicle standing on one of them, once (see the header). */
export function blastVehicles(ctx: Ctx, tiles: readonly DeepReadonly<Pos>[], damage: number): void {
    for (const id of vehiclesOn(ctx.world, ctx.state, tiles)) damageVehicle(ctx, id, [damage], 'blast');
}

// A save from before M4-04 has no vehicle hit points.
registerStateCheck('vehicleDamage', raw => {
    const s = raw as unknown as Partial<State>;
    for (const id of sortedIds(s.vehicles ?? {})) if (typeof (s.vehicles![id] as { hp?: unknown }).hp !== 'number') return `vehicle ${id} has no hit points (a save from before M4-04)`;
    return undefined;
});

registerEvents({
    vehicleDamaged: { undoBlocking: true },
    vehicleDisabled: { undoBlocking: true },
    policeWrecked: { undoBlocking: true }
});
