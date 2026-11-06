import { registerWorldHook, type Ctx } from '../core/engine';
import { registerStateCheck } from '../core/save';
import { crewMember, registerActorCheck, registerCrewInit } from '../core/state';
import type { AccessRoute, Transit } from '../core/transit';
import type { CrewState, DeepReadonly, Pos, ReadonlyWorld, State } from '../core/types';
import { FACING_STEP, inBounds, tileAt } from '../core/grid';
import { doorBetween, stepCost } from '../geo/move';
import { offMap } from '../core/transit';
import { registerEvents } from '../core/undo';
import { inReach, lacksActions, registerAction } from './actions/act';
import { cashLeaves, inBuilding } from './actions/loot';
import { inHands } from './hands';
import { perceiveEnd } from './perceive';
import { leaveOnFoot } from './getaway';
import { registerPreviewSecret } from './knowledge';
import { dropTargets } from './wounds';

/*
 * Off-map routes (GAME_DESIGN §14.7; implementation plan M4-05, decisions 300–303). The routes and the transit field
 * are core/transit.ts; here are going in, the transit track and coming out.
 *
 * - **Going in** (`enterRoute { crew, route }`, 1 action): from either end, within reach of its access point (on it or
 *   beside it, `inReach`), hands free of anything heavier than Light (§14.7: loot in the hands, a body or a hostage
 *   can't go), not by the roof or the duct while the helicopter is over the plot (§13.3 Heat 4). The crew member is
 *   seen going in where they stand, as a step ends there (`perceiveEnd`, as getting into the van is), and is then off
 *   the map: their other actions this turn are gone, a lean, a Watch or an aim with them, and what NPCs meant to do
 *   to them is dropped (`dropTargets`).
 * - **The transit track**: each world phase's devices step takes one off what is left (`Transit.left`, the route's
 *   `transit`: the roof and the duct 2, the sewer 3), after the police have come (so a helicopter that arrives now is
 *   already over the roof); at 0 they come out at the far end (`routeExit`): its access point, else the nearest tile
 *   of the same room reachable from it without a door, with nothing standing on it and no crew member there. The tile is
 *   chosen on what the crew knows for sure (the room, the furniture, the crew); if someone else stands on it when they
 *   come out, they wait in transit a phase longer (`routeHeld`). Whether and where they come out is a preview secret
 *   (the world phase can't be shown on the truth), and coming out is an action ending there: whoever sees the tile sees
 *   them (`perceiveEnd`). Out by the start of the next crew phase, the turns in transit are the route's. Coming out of
 *   the building that way with cash settles its dye pack as a step out does (`cashLeaves`, §15.1).
 * - **No coming straight back** (decision 300): in the crew phase right after coming out (`CrewState.cameOut`) a crew
 *   member can't go into a route again, so nobody stays off the map through every world phase.
 * - **Escaping** (§15.4 "Escape is always possible"; decision 303): `escape` takes the route off the plot instead of to its
 *   far end. When the transit is over the crew member is out of play, escaped with what they carry (rules/getaway.ts
 *   `leaveOnFoot`, as those who drive off); the heist ends once nobody else is still playing.
 * - **The helicopter** (§14.7): anyone on the roof or in the duct when it is over the plot is forced back, out again
 *   where they went in.
 */

declare module '../core/types' {
    interface CommandMap {
        /**
         * Go into an off-map route at the end in reach (1 action): out at the other end after its transit (§14.7), or,
         * with `escape`, away off the plot by it once the transit is over (§15.4).
         */
        enterRoute: { crew: string; route: string; escape?: boolean };
    }
    interface EventMap {
        /** A crew member went into a route at `from`: out at the far end in `turns` world phases. */
        routeEntered: { crew: string; route: string; from: Pos; inward: boolean; turns: number; escape: boolean };
        /** A crew member came out of a route at `at`. */
        routeLeft: { crew: string; route: string; at: Pos; inward: boolean };
        /** A crew member leaving by a route is off the plot: escaped (§15.4). */
        routeEscaped: { crew: string; route: string };
        /** A crew member due out found someone standing where they come out: still in transit, out next phase. */
        routeHeld: { crew: string; route: string };
        /** The helicopter forced a crew member on the roof back to where they went in (§14.7). */
        routeTurnedBack: { crew: string; route: string; at: Pos };
    }
}

declare module '../core/types' {
    interface CrewState {
        /** The turn of the crew phase they came out of a route into (decision 300: no route again then), or null. */
        cameOut: number | null;
    }
}

registerCrewInit('transit', (_world, _start, member) => {
    member.transit = null;
    member.cameOut = null;
});

registerActorCheck('transit', member => (member.transit ? `${member.name} is in transit` : undefined));

registerStateCheck('transit', raw => {
    const crew = (raw as { crew?: unknown }).crew;
    if (!Array.isArray(crew)) return undefined;
    return crew.every(c => c && typeof c === 'object' && Object.hasOwn(c, 'transit')) ? undefined : 'crew without a transit (a save from before M4-05)';
});

/** A route of the World, or undefined. */
export const routeOf = (world: ReadonlyWorld, id: string): DeepReadonly<AccessRoute> | undefined => world.routes?.find(r => r.id === id);

/** Whether the helicopter is over the plot (§13.3 Heat 4): the roof and the duct are closed. */
export const helicopterOver = (state: DeepReadonly<State>): boolean => state.police.vehicles.some(v => v.kind === 'helicopter');

/** Whether a route runs over the roof (the roof route itself, or the duct from it). */
const overRoof = (route: DeepReadonly<AccessRoute>): boolean => route.kind !== 'sewer';

/** The end of a route a crew member would go in at now: the outside end in reach (true: heading in), else the inside one; or null. */
export function routeEndInReach(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, route: DeepReadonly<AccessRoute>): boolean | null {
    if (inReach(world, state, member.pos, route.outside)) return true;
    if (inReach(world, state, member.pos, route.inside)) return false;
    return null;
}

/** Why a crew member can't go into a route now, or undefined. */
export function routeBlocked(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, id: string): string | undefined {
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    const route = routeOf(world, id);
    if (!route) return `There is no route '${id}'`;
    if (routeEndInReach(world, state, member, route) === null) return `${member.name} can't reach the way in from here`;
    if (member.dragging !== null) return `${member.name} can't take someone ${route.kind === 'sewer' ? 'down the sewer' : 'over the roof'}`;
    if (inHands(world, state, member.id) !== undefined) return 'Nothing heavier than Light goes by this route';
    if (overRoof(route) && helicopterOver(state)) return 'The helicopter is over the roof';
    if (member.cameOut === state.turn) return `${member.name} has only just come out`;
    return undefined;
}

registerAction('enterRoute', {
    whyNot: (world, state, cmd) => routeBlocked(world, state, crewMember(state, cmd.crew), cmd.route),
    candidates: (world, _state, member) => (world.routes ?? []).flatMap(r => [false, true].map(escape => ({ type: 'enterRoute' as const, crew: member.id, route: r.id, ...(escape ? { escape } : {}) }))),
    cost: () => 1,
    run(ctx, member, cmd) {
        const { world, state } = ctx, route = routeOf(world, cmd.route)!;
        const inward = routeEndInReach(world, state, member, route)!, from = { x: member.pos.x, y: member.pos.y };
        // Seen going in where they stand, before they are gone.
        perceiveEnd(ctx, member.id);
        const escape = !!cmd.escape, transit: Transit = { route: route.id, inward, left: route.transit, from, escape };
        member.transit = transit;
        member.actionsLeft = 0;
        member.leaning = null;
        member.holding = null;
        member.arms.watch = null;
        member.arms.aiming = null;
        member.arms.braced = false;
        dropTargets(state, member.id);
        ctx.emit({ type: 'routeEntered', crew: member.id, route: route.id, from, inward, turns: route.transit, escape });
    }
}, { perceive: false });

/**
 * Where a crew member comes out at the end `end` of a route (see the header): the end itself, else the nearest tile of
 * its room reachable from it step by step without crossing a door, not blocked by furniture or a vehicle and with no
 * other crew member on the map there; by rings of steps, in the order of the steps. Pure, and on what the crew knows:
 * NPCs and officers aren't asked. Null when there is none.
 */
export function routeExit(world: ReadonlyWorld, state: DeepReadonly<State>, crewId: string, end: DeepReadonly<Pos>): Pos | null {
    const room = tileAt(world, end)?.room ?? null;
    const crewAt = new Set(state.crew.filter(c => c.id !== crewId && !offMap(c)).map(c => c.pos.y * world.width + c.pos.x));
    const free = (p: Pos): boolean => {
        const t = tileAt(world, p);
        return !!t && !t.blocksMove && !t.tall && !crewAt.has(p.y * world.width + p.x);
    };
    const start = { x: end.x, y: end.y };
    if (free(start)) return start;
    const seen = new Set<number>([start.y * world.width + start.x]), queue: Pos[] = [start];
    const steps = (['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'] as const).map(f => FACING_STEP[f]);
    for (let i = 0; i < queue.length; i++) {
        const at = queue[i]!;
        for (const d of steps) {
            const next = { x: at.x + d.x, y: at.y + d.y }, k = next.y * world.width + next.x;
            if (!inBounds(world, next) || seen.has(k) || tileAt(world, next)!.room !== room) continue;
            // From a blocked end tile (a ladder, a grate under a desk) out onto the floor; otherwise as people step.
            const orthogonal = d.x === 0 || d.y === 0;
            if (orthogonal && doorBetween(world, at, next)) continue;
            if (!(i === 0 && !free(start) && orthogonal) && stepCost(world, state as State, at, next) === undefined) continue;
            seen.add(k);
            if (free(next)) return next;
            queue.push(next);
        }
    }
    return null;
}

/** Whether a person not of the crew stands on `p` now (an NPC present, an officer out). */
function someoneOn(state: DeepReadonly<State>, p: DeepReadonly<Pos>): boolean {
    return state.npcs.some(n => n.status !== 'away' && n.stashed === null && n.pos.x === p.x && n.pos.y === p.y)
        || state.police.units.some(u => !!u.pos && u.pos.x === p.x && u.pos.y === p.y);
}

/**
 * Puts a crew member in transit back on the map at `end` (`routeExit`), seen as an action ending there: where, or null
 * when they can't come out this phase (no tile, or someone standing on it).
 */
function comeOut(ctx: Ctx, member: CrewState, end: DeepReadonly<Pos>): Pos | null {
    const { world, state } = ctx, at = routeExit(world, state, member.id, end);
    if (!at || someoneOn(state, at)) return null;
    const was = member.transit!.from;
    member.pos = { x: at.x, y: at.y };
    member.transit = null;
    // Out in the crew phase about to begin: not straight back in then.
    member.cameOut = state.turn + 1;
    if (inBuilding(world, was) && !inBuilding(world, at)) cashLeaves(ctx, member, at);
    perceiveEnd(ctx, member.id);
    return at;
}

// The transit track (see the header): after the police (`police.director`), so the helicopter that came this phase counts.
registerWorldHook('devices', 'transit.track', ctx => {
    const { world, state } = ctx;
    for (const member of [...state.crew]) {
        const t = member.transit;
        if (!t) continue;
        const route = routeOf(world, t.route)!;
        if (overRoof(route) && helicopterOver(state)) {
            const at = comeOut(ctx, member, t.from);
            ctx.emit(at ? { type: 'routeTurnedBack', crew: member.id, route: route.id, at } : { type: 'routeHeld', crew: member.id, route: route.id });
            continue;
        }
        t.left = Math.max(0, t.left - 1);
        if (t.left > 0) continue;
        // Leaving by it (§15.4): off the plot, for good; rules/getaway.ts counts them escaped.
        if (t.escape) {
            // Off the plot is out of the building: cash taken out this way settles its dye pack as a step out does.
            const out = t.inward ? route.inside : route.outside;
            if (inBuilding(world, t.from)) cashLeaves(ctx, member, { x: out.x, y: out.y });
            ctx.emit({ type: 'routeEscaped', crew: member.id, route: route.id });
            leaveOnFoot(ctx, member, route.id);
            continue;
        }
        const at = comeOut(ctx, member, t.inward ? route.inside : route.outside);
        ctx.emit(at ? { type: 'routeLeft', crew: member.id, route: route.id, at, inward: t.inward } : { type: 'routeHeld', crew: member.id, route: route.id });
    }
}, { order: 4 });

// In transit they have no actions to spend: the turn's actions come back to everyone else.
registerWorldHook('crewPhase', 'transit.actions', ctx => {
    for (const member of ctx.state.crew) if (member.transit) member.actionsLeft = 0;
});

registerEvents({
    routeEntered: { undoBlocking: false },
    routeLeft: { undoBlocking: true },
    routeEscaped: { undoBlocking: true },
    routeHeld: { undoBlocking: true },
    routeTurnedBack: { undoBlocking: true }
});

// Whether, and where, someone comes out depends on who stands at the far end, which the crew may not know: a preview of
// the world phase doesn't tell it.
registerPreviewSecret('routeLeft');
registerPreviewSecret('routeHeld');
registerPreviewSecret('routeTurnedBack');
