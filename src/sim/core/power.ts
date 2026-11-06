import { registerRuleDefaults, registerStateInit } from './state';
import type { DeepReadonly, DoorDef, Pos, ReadonlyWorld, State } from './types';

/*
 * The power grid's state (GAME_DESIGN §8.13, §14.6; implementation plan M4-03, decisions 240–246), kept in core so sight
 * (geo/los.ts), the cameras (geo/cones.ts) and the doors (geo/move.ts) can read it; the breaker, the generator and their
 * hooks are rules/power.ts.
 *
 * - **Powered** while the mains breaker is on or the backup generator runs. The generator starts by itself as the crew
 *   phase `rules.generatorPhases` (3) turns after the cut begins, unless the crew disabled it; a bank without one has no
 *   backup. The alarm panel has its own battery: nothing here touches it.
 * - **Dark** with the power out: every tile of the bank's building (`World.building`; every tile in a world without one,
 *   the test fixtures) is unlit, so sight there is halved (§8.3); outdoors and next door stay as they were.
 * - **Cameras** are off with the power out (`cameraObserver` is null): every one, whatever its tier.
 * - **Maglocks** (decision 242): a card or maglock door between two zones below Secure is a staff door and fails safe:
 *   with the power out it doesn't hold, so a locked one reads closed (`doorStatus`) and can't be locked; when the power
 *   comes back it holds again. One with a Secure side fails secure: it stays locked, its reader on the security
 *   circuit's battery as the alarm panel is.
 */

/** The power grid now (§14.6). */
export interface PowerState {
    /** The mains breaker is on. */
    breaker: boolean;
    /** The backup generator: standing by, running while the breaker is off, or disabled by the crew for good. */
    generator: 'standby' | 'running' | 'disabled';
    /** The turn the breaker was cut, in that turn's crew phase; null while it is on. */
    cutAt: number | null;
    /** The turn the lights went out this time (the outage's evidence is named by it); null while powered. */
    outSince: number | null;
}

declare module './types' {
    interface State {
        power: PowerState;
    }
    interface Rules {
        /** Turns after the breaker is cut that the backup generator starts, as that crew phase begins (§8.13: 3). */
        generatorPhases: number;
    }
}

registerRuleDefaults({ generatorPhases: 3 });

registerStateInit('power', (_world, state) => {
    state.power = { breaker: true, generator: 'standby', cutAt: null, outSince: null };
});

/** Whether the building has power: the breaker on, or the generator running. A state from before power is powered. */
export const powerOn = (state: DeepReadonly<State>): boolean => {
    const power = (state as Partial<State>).power;
    return !power || power.breaker || power.generator === 'running';
};

/** Whether a tile goes dark with the power out: it is in the bank's building (every tile, in a world without one). */
export function darkensAt(world: ReadonlyWorld, p: DeepReadonly<Pos>): boolean {
    const tile = world.tiles[p.y * world.width + p.x];
    if (!tile) return false;
    return world.building ? tile.room !== null && world.building.includes(tile.room) : true;
}

/** Whether a tile is lit now (§8.3): lit as built, and not in the dark building of a power cut. */
export const litNow = (world: ReadonlyWorld, state: DeepReadonly<State>, p: DeepReadonly<Pos>): boolean =>
    !!world.tiles[p.y * world.width + p.x]?.lit && (powerOn(state) || !darkensAt(world, p));

const FAIL_SAFE = new WeakMap<ReadonlyWorld, ReadonlySet<string>>();

/** The doors whose locks fail safe (see the header): card or maglock doors with no Secure side. */
export function failSafeDoors(world: ReadonlyWorld): ReadonlySet<string> {
    let doors = FAIL_SAFE.get(world);
    if (doors) return doors;
    const out = new Set<string>();
    for (const id of Object.keys(world.doors)) {
        const door: DeepReadonly<DoorDef> = world.doors[id]!, edge = world.edges[door.edge];
        if ((door.lock !== 'keycard' && door.lock !== 'maglock') || !edge) continue;
        const sides = [edge.run === 'eastWest' ? { x: edge.tx, y: edge.ty - 1 } : { x: edge.tx - 1, y: edge.ty }, { x: edge.tx, y: edge.ty }];
        const inside = (p: Pos) => p.x >= 0 && p.y >= 0 && p.x < world.width && p.y < world.height;
        if (sides.every(p => !inside(p) || world.tiles[p.y * world.width + p.x]!.zone !== 'secure')) out.add(id);
    }
    FAIL_SAFE.set(world, doors = out);
    return doors;
}

/** Whether a door's lock is released now: it fails safe and the power is out. */
export const lockReleased = (world: ReadonlyWorld, state: DeepReadonly<State>, door: string): boolean =>
    !powerOn(state) && failSafeDoors(world).has(door);
