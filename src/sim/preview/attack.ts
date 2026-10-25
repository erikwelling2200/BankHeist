import { IllegalCommand, preview } from '../core/engine';
import type { Command, ReadonlyWorld, State } from '../core/types';
import { previewShot, type ShotPreview } from './shot';

/*
 * An attack command's cone (§11.7, M3-02, decision 97): `previewShot` of the shot it sets up (`Arms.aiming`), on the
 * state its preview stopped at, just before the bullets (`Dice.pictured`): whatever the command does first (Suppress's
 * civilians going down, the shooter leaning out) is in it, so a bullet rolled anywhere meets what the cone shows. The
 * truth, like an engine preview: what the player sees goes through the crew's knowledge first (M3-09's aim mode).
 * Undefined for a command that fires nothing or isn't allowed.
 */
export function attackCone(world: ReadonlyWorld, state: State, cmd: Command): ShotPreview | undefined {
    if (cmd.type !== 'attack' && cmd.type !== 'suppress') return undefined;
    let stopped: State;
    try {
        stopped = preview(world, state, cmd).state;
    } catch (e) {
        if (e instanceof IllegalCommand) return undefined;
        throw e;
    }
    const aiming = stopped.crew.find(c => c.id === cmd.crew)?.arms.aiming;
    return aiming ? previewShot(world, stopped, aiming.shot) : undefined;
}
