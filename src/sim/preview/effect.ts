import type { Ctx } from '../core/engine';
import { clonePlain } from '../core/json';
import { Dice } from '../core/rng';
import type { DeepReadonly, SimEvent, State } from '../core/types';
import { applySightings, type Sighting } from '../rules/perceive';
import { isExposedTo } from '../rules/suspicion';

/*
 * What sightings do to one crew member, read off the events of the one writer (`applySightings`, rules/perceive.ts):
 * previews apply them to a scratch copy and read the events back, so a tint can't disagree with the rules about pips
 * adding up to Exposed, a second challenge or a camera reporting twice. The property test reads the real outcome's
 * events with the same `effectOf`.
 */

/** What happens to one crew member in one phase. */
export interface Effect {
    /** NPCs that newly Expose them (a `!`, pips reaching 3, a failed trespass deadline, a frisk, being told). */
    exposed: string[];
    /** NPCs that already know them (Exposed before) and see them again: it keeps them on their trail. */
    watching: string[];
    /** Pips added, by NPC. */
    pips: Record<string, number>;
    /** The NPC that challenges them ("Hey, you can't be back here"), if any. */
    challenged: string | null;
    /** Cameras that see a `!`: a report for the operator's verify (§8.12). */
    cameras: string[];
}

export const noEffect = (): Effect => ({ exposed: [], watching: [], pips: {}, challenged: null, cameras: [] });

/** Whether an effect is nothing at all (green). */
export const isQuiet = (e: DeepReadonly<Effect>): boolean =>
    !e.exposed.length && !e.watching.length && !e.cameras.length && e.challenged === null && !Object.keys(e.pips).length;

const add = (list: string[], id: string): void => {
    if (!list.includes(id)) {
        list.push(id);
        list.sort();
    }
};

/** The effect on `crew` of a list of events, `before` being the state they started from (who knew the crew member). */
export function effectOf(events: readonly SimEvent[], crew: string, before: DeepReadonly<State>): Effect {
    const out = noEffect();
    for (const e of events) {
        switch (e.type) {
            case 'exposed': if (e.crew === crew) add(out.exposed, e.npc); break;
            case 'suspicionRaised': if (e.crew === crew) out.pips[e.npc] = (out.pips[e.npc] ?? 0) + e.added; break;
            case 'challenged': if (e.crew === crew) out.challenged = e.npc; break;
            case 'cameraSaw': if (e.crew === crew) add(out.cameras, e.camera); break;
            case 'perceptionCheck': {
                if (e.crew !== crew) break;
                const npc = before.npcs.find(n => n.id === e.npc);
                if (npc && isExposedTo(npc, crew)) add(out.watching, e.npc);
                break;
            }
            default: break;
        }
    }
    return out;
}

/** A context on a scratch state that collects its events instead of reporting them. */
export function scratchCtx(ctx: Pick<Ctx, 'world'>, state: State): { ctx: Ctx; events: SimEvent[] } {
    const events: SimEvent[] = [];
    return { ctx: { world: ctx.world, state, dice: new Dice(state, 'preview'), emit: e => { events.push(e); } }, events };
}

/**
 * Applies the coming world phase's sightings to a scratch copy of `state` (only the NPCs that saw something, and the
 * camera reports, are copied: in a world phase nobody reconsiders) and returns what they did to the crew member. The
 * world-phase sightings that need no seeing (a deadline, a frisk, being told) by an NPC that already knows the crew
 * member change nothing in the real phase, so they are left out here too.
 */
export function applyWorldSightings(ctx: Pick<Ctx, 'world'>, state: State, crew: string, sightings: readonly Sighting[]): Effect {
    const acting = sightings.filter(s => !(s.band === null && s.known));
    if (!acting.length) return noEffect();
    const observers = new Set(acting.map(s => s.observer));
    const scratch: State = {
        ...state, phase: 'world',
        npcs: state.npcs.map(n => (observers.has(n.id) ? clonePlain(n) : n)),
        cameraReports: [...state.cameraReports]
    };
    const { ctx: c, events } = scratchCtx(ctx, scratch);
    applySightings(c, acting);
    return effectOf(events, crew, state);
}
