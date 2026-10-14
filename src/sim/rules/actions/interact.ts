import type { Ctx } from '../../core/engine';
import { sortedIds } from '../../core/json';
import type { CrewState, DeepReadonly, Pos, ReadonlyWorld, State, WorldObject } from '../../core/types';
import type { IllegalAct } from '../../data/matrix';
import { inReach, lacksActions, registerAction } from './act';

/*
 * Interacting with objects (§6.3 Interact, 1–2 actions): `interact { crew, object, verb }` on a World object in reach
 * (`inReach`: its tile or a neighbour with no wall between). What an object kind allows is its package's: it registers
 * a handler per kind (`registerInteraction`, M1-08 for the alarm panel, the CCTV desk and the recorder, M2 for loot),
 * with the verbs it offers, each verb's cost, whether it is an illegal act, why it can't be done now, and what it does.
 * The command takes the steps of every crew action (rules/actions/act.ts): legality, spend, do, witnesses, perception.
 * Doors are not objects: they have their own command (door.ts).
 */

declare module '../../core/types' {
    interface CommandMap {
        /** Use an object in reach: `verb` is one its kind's handler offers (`interactionVerbs`). */
        interact: { crew: string; object: string; verb: string };
    }
}

/** One verb of an object kind's handler. */
export interface InteractionVerb {
    /** Actions it costs (1–2, §6.3; traits may make it faster, given the crew member). */
    cost(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, object: DeepReadonly<WorldObject>): number;
    /** The illegal act it is (hacking, taking loot), if any. */
    illegal?: IllegalAct;
    /** Why it can't be done now (no kit, already disabled), or undefined. */
    whyNot?(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, object: DeepReadonly<WorldObject>): string | undefined;
    /** Does it (after the checks and the spend). */
    run(ctx: Ctx, member: CrewState, object: DeepReadonly<WorldObject>): void;
}

/** What crew can do with one kind of object, by verb. */
export type InteractionHandler = Readonly<Record<string, InteractionVerb>>;

const HANDLERS = new Map<string, InteractionHandler>();

/** Sets what crew can do with objects of a kind (one handler per kind; `replace` to change it). */
export function registerInteraction(kind: string, handler: InteractionHandler, options: { replace?: boolean } = {}): void {
    if (HANDLERS.has(kind) && !options.replace) throw new Error(`Interaction '${kind}' already exists; pass replace: true to change it`);
    HANDLERS.set(kind, handler);
}

/** The verbs an object offers, sorted (empty when nothing handles its kind). */
export function interactionVerbs(world: ReadonlyWorld, objectId: string): string[] {
    const obj = world.objects.find(o => o.id === objectId);
    const handler = obj && HANDLERS.get(obj.kind);
    return handler ? sortedIds(handler) : [];
}

function lookup(world: ReadonlyWorld, objectId: string, verb: string): { object: DeepReadonly<WorldObject>; def: InteractionVerb } | string {
    const object = world.objects.find(o => o.id === objectId);
    if (!object) return `No object '${objectId}'`;
    const handler = HANDLERS.get(object.kind);
    if (!handler) return `There is nothing to do with the ${object.kind}`;
    const def = Object.hasOwn(handler, verb) ? handler[verb] : undefined;
    if (!def) return `Can't ${verb} the ${object.kind}`;
    return { object, def };
}

/** Where an object is used from: its tile or a tile in reach of it. */
export const reachesObject = (world: ReadonlyWorld, state: State, from: DeepReadonly<Pos>, object: DeepReadonly<WorldObject>): boolean =>
    inReach(world, state, from, object.pos);

registerAction('interact', {
    whyNot(world, state, cmd) {
        const member = state.crew.find(c => c.id === cmd.crew)!;
        const found = lookup(world, cmd.object, cmd.verb);
        if (typeof found === 'string') return found;
        const lack = lacksActions(member, found.def.cost(world, state, member, found.object));
        if (lack) return lack;
        if (!reachesObject(world, state, member.pos, found.object)) return `${member.name} can't reach the ${found.object.kind}`;
        return found.def.whyNot?.(world, state, member, found.object);
    },
    candidates(world, state, member) {
        const out: { type: 'interact'; crew: string; object: string; verb: string }[] = [];
        for (const o of world.objects) {
            if (!HANDLERS.has(o.kind) || !reachesObject(world, state, member.pos, o)) continue;
            for (const verb of interactionVerbs(world, o.id)) out.push({ type: 'interact', crew: member.id, object: o.id, verb });
        }
        return out;
    },
    cost(world, state, cmd) {
        const found = lookup(world, cmd.object, cmd.verb) as { object: DeepReadonly<WorldObject>; def: InteractionVerb };
        return found.def.cost(world, state, state.crew.find(c => c.id === cmd.crew)!, found.object);
    },
    illegal(world, _state, cmd) {
        const found = lookup(world, cmd.object, cmd.verb) as { def: InteractionVerb };
        return found.def.illegal ? { act: found.def.illegal } : undefined;
    },
    run(ctx, member, cmd) {
        const found = lookup(ctx.world, cmd.object, cmd.verb) as { object: DeepReadonly<WorldObject>; def: InteractionVerb };
        found.def.run(ctx, member, found.object);
    }
});
