import type { Activity, DeepReadonly, PersonDef, Pos, ReadonlyWorld, ScheduleBlock } from '../../core/types';
import { personOf } from './walk';

/*
 * Reading the schedules (§16.1, §16.3): which block someone is in on a turn, what comes next, and the turns the bank's
 * day changes on. Every NPC's routine comes from here (`intent.ts`), and so do the questions the rest of the game asks
 * about it: "Manager → vault inspection in 6" (§16.1), "Wait for… the next schedule event" (§6.5, M1-11), and an NPC's
 * known routine (M1-10).
 *
 * A schedule is a list of blocks in order of their first turn; a block lasts until the next one starts. What each
 * activity means is in `core/types.ts` (`ScheduleBlock`); the rules sort them into three ways of spending a turn:
 * standing somewhere (`at`, facing `facing`), walking a route (`route`), or leaving the map (`at` is the way out, and
 * the way back in for whoever comes back).
 */

/** Activities that walk a route: there and back (patrol, sweep) or once (the closing sweep). */
export const ROUTE_ACTIVITIES: ReadonlySet<Activity> = new Set<Activity>(['patrol', 'sweep', 'closingSweep']);

/** Activities that take someone off the map. */
export const LEAVING_ACTIVITIES: ReadonlySet<Activity> = new Set<Activity>(['leave', 'offMap']);

/** How a route is walked: back and forth, or once through and then stay at its end. */
export const routeMode = (activity: Activity): 'pingPong' | 'once' => (activity === 'closingSweep' ? 'once' : 'pingPong');

/** The turn someone sets off for a block: travel time before it starts, so they are there on its turn. */
export const setOffOf = (b: DeepReadonly<ScheduleBlock>): number => b.setOff ?? b.from;

/**
 * The index of the block a person is following on `turn` (on the way to it, or at it), or -1 before the first one: the
 * last block, in schedule order, they have set off for.
 */
export function blockIndexAt(person: DeepReadonly<PersonDef>, turn: number): number {
    let at = -1;
    person.schedule.forEach((b, i) => { if (setOffOf(b) <= turn) at = i; });
    return at;
}

export interface ScheduledActivity {
    block: DeepReadonly<ScheduleBlock>;
    /** Its index in the person's schedule. */
    index: number;
}

/** What an NPC's schedule has it doing on `turn` (whatever it is actually doing: see `NpcState.goal`). */
export function activityAt(world: ReadonlyWorld, npcId: string, turn: number): ScheduledActivity | null {
    const person = personOf(world, npcId), index = blockIndexAt(person, turn);
    return index < 0 ? null : { block: person.schedule[index]!, index };
}

/** The next block of an NPC's schedule after `turn`, and in how many turns it starts ("vault inspection in 6"). */
export function nextActivity(world: ReadonlyWorld, npcId: string, turn: number): (ScheduledActivity & { in: number }) | null {
    const person = personOf(world, npcId);
    const index = person.schedule.findIndex(b => b.from > turn);
    return index < 0 ? null : { block: person.schedule[index]!, index, in: person.schedule[index]!.from - turn };
}

/** Every turn after the first on which someone's schedule changes, in order: the turns "Wait for…" can stop at. */
export function scheduleTurns(world: ReadonlyWorld): number[] {
    const turns = new Set<number>();
    for (const p of world.people) for (const b of p.schedule) if (b.from > 1) turns.add(b.from);
    return [...turns].sort((a, b) => a - b);
}

/** The first turn after `turn` on which someone's schedule changes, or null. */
export function nextScheduleTurn(world: ReadonlyWorld, turn: number): number | null {
    return scheduleTurns(world).find(t => t > turn) ?? null;
}

/** The NPCs whose schedule starts a block on `turn`, in world order, with the block. */
export function startingOn(world: ReadonlyWorld, turn: number): { npc: string; block: DeepReadonly<ScheduleBlock> }[] {
    const out: { npc: string; block: DeepReadonly<ScheduleBlock> }[] = [];
    for (const p of world.people) for (const b of p.schedule) if (b.from === turn) out.push({ npc: p.id, block: b });
    return out;
}

/**
 * Where someone who is away comes back onto the map for block `index`: the tile they last left by (the way out of the
 * latest leaving block before it), or where they started the heist.
 */
export function wayBackIn(person: DeepReadonly<PersonDef>, index: number): Pos {
    for (let i = index - 1; i >= 0; i--) {
        const b = person.schedule[i]!;
        if (LEAVING_ACTIVITIES.has(b.activity) && b.at) return { x: b.at.x, y: b.at.y };
    }
    return { x: person.pos.x, y: person.pos.y };
}
