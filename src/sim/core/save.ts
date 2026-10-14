import type { State, World } from './types';

/*
 * The autosave (§20.6): the world as built and the state after the last committed action, as JSON. The format number
 * goes up whenever `World` or `State` changes shape; a save of another format is refused with a clear error rather
 * than half-loaded.
 */

export const SAVE_FORMAT = 1;

export interface Save { format: number; world: World; state: State }

export class SaveFormatError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SaveFormatError';
    }
}

export function serialise(world: World, state: State): string {
    const save: Save = { format: SAVE_FORMAT, world, state };
    return JSON.stringify(save);
}

export function deserialise(text: string): { world: World; state: State } {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new SaveFormatError(`The save isn't JSON: ${(e as Error).message}`);
    }
    if (!data || typeof data !== 'object') throw new SaveFormatError('The save is not an object');
    const save = data as Partial<Save>;
    if (save.format !== SAVE_FORMAT) {
        throw new SaveFormatError(`The save has format ${String(save.format)}, this build reads format ${SAVE_FORMAT}`);
    }
    if (!save.world || typeof save.world !== 'object') throw new SaveFormatError('The save has no world');
    if (!save.state || typeof save.state !== 'object') throw new SaveFormatError('The save has no state');
    return { world: save.world, state: save.state };
}
