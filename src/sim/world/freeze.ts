import { assertPlainJson, deepFreeze } from '../core/json';
import type { ReadonlyWorld, World } from '../core/types';

/*
 * Every World goes through here once built (the fixtures now, the generated bank's `worldFromBank` later, a loaded
 * save): it is checked to be plain JSON with a whole grid, then frozen, so no rule can change the bank by accident.
 */

/** Worlds already checked and frozen here, so saving one doesn't walk it again. */
const FROZEN = new WeakSet<object>();

export function freezeWorld(world: World | ReadonlyWorld): ReadonlyWorld {
    if (FROZEN.has(world)) return world as ReadonlyWorld;
    assertPlainJson(world, 'world');
    if (world.tiles.length !== world.width * world.height) {
        throw new Error(`The world is ${world.width}x${world.height} but has ${world.tiles.length} tiles`);
    }
    deepFreeze(world);
    FROZEN.add(world);
    return world as ReadonlyWorld;
}
