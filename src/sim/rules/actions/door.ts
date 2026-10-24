import { samePos, tileAt } from '../../core/grid';
import { sortedIds } from '../../core/json';
import type { CrewState, DeepReadonly, DoorDef, DoorStatus, Pos, ReadonlyWorld, State, Zone } from '../../core/types';
import { registerEvents } from '../../core/undo';
import { crewHasKey } from '../../crew/movement';
import { doorStatus } from '../../geo/move';
import { lacksActions, registerAction } from './act';
import { HACKING_KIT, workActions } from '../alarms';
import { lockOn } from '../keys';
import { makeNoise } from '../../geo/sound';
import { registerRuleDefaults } from '../../core/state';

/*
 * Interacting with doors (§6.3 Interact, 1 action), from a tile beside the door:
 *
 * - **open** a closed door; a locked one only with its key (`crewHasKey`, crew/movement.ts: a keycard taken in a frisk).
 * - **close** an open door (a propped one too: the wedge comes out). Breached and jammed doors stay as they are.
 * - **lock** a closed door: with its key, or without one a mechanical lock from its inner side (the side of the higher
 *   zone, Public < Staff < Secure; either side between equals), where a thumb-turn needs none. Keycards, maglocks and
 *   the vault's time lock need their key (implementation plan §6 decision 25).
 * - **unlock** a locked door: only with its key.
 * - **pick** a locked mechanical lock (lockpick set) or **hack** a locked card reader (hacking kit), §7.2, §15.2: 1 action
 *   at a time, the work kept on the door (`DoorState.work`) until `rules.lockpickActions` or the key graph's reader
 *   actions (2) are done, Steady Hands half (at least 1); then the door is unlocked (closed). Each action is the illegal
 *   act 'lockpick' or 'hack' and a quiet noise of radius 1. The mantrap's reader waits until every live camera in it is
 *   looped (its technical key). Like any unlocked door it latches again when it swings shut.
 *
 * Closing a door by hand eases it shut without latching it: it stays closed, not locked, until someone locks it (doors
 * that swing shut on their own at the end of a world phase do latch, rules/doors.ts). None but picking and hacking is
 * an illegal act; what the door hides or shows is perception's and knowledge's business, as for a door a move walks
 * through.
 */

export type DoorAction = 'open' | 'close' | 'lock' | 'unlock' | 'pick' | 'hack';

declare module '../../core/types' {
    interface Rules {
        /** Actions of hacking a card reader takes (§7.2: 2) where the key graph doesn't say; Steady Hands halves them. */
        readerActions: number;
    }
    interface CommandMap {
        /** Open, close, lock, unlock, pick or hack a door from a tile beside it (1 action). */
        door: { crew: string; door: string; action: DoorAction };
    }
    interface EventMap {
        doorLocked: { door: string; by: string };
        doorUnlocked: { door: string; by: string };
        /** Work on a door's lock (picking it, hacking its reader): `progress` of `needed` actions. */
        doorWorked: { crew: string; door: string; progress: number; needed: number };
    }
    interface DoorState {
        /** Actions of work done on its lock so far (picking, hacking the reader). */
        work?: number;
    }
}

/** The kits that work on locks (§7.2). */
export const LOCKPICK = 'lockpick';

export const DOOR_ACTIONS: readonly DoorAction[] = ['open', 'close', 'lock', 'unlock', 'pick', 'hack'];

/** The two tiles either side of a door: the edge's tile south or east of it, and the one across. */
export function doorSides(world: ReadonlyWorld, door: DeepReadonly<DoorDef>): [Pos, Pos] | undefined {
    const edge = world.edges[door.edge];
    if (!edge) return undefined;
    const b = { x: edge.tx, y: edge.ty };
    return [edge.run === 'eastWest' ? { x: edge.tx, y: edge.ty - 1 } : { x: edge.tx - 1, y: edge.ty }, b];
}

/** Whether a crew member stands beside a door. */
export const besideDoor = (world: ReadonlyWorld, door: DeepReadonly<DoorDef>, p: DeepReadonly<Pos>): boolean =>
    !!doorSides(world, door)?.some(s => samePos(s, p));

const ZONE_RANK: Readonly<Record<Zone, number>> = { public: 0, staff: 1, secure: 2 };

/** Whether `p` is on a door's inner side: the side of the higher zone, or either side between two of one zone. */
export function innerSide(world: ReadonlyWorld, door: DeepReadonly<DoorDef>, p: DeepReadonly<Pos>): boolean {
    const both = doorSides(world, door);
    if (!both) return false;
    const [a, b] = both.map(q => ZONE_RANK[tileAt(world, q)!.zone]) as [number, number];
    const mine = samePos(both[0], p) ? a : samePos(both[1], p) ? b : -1;
    return mine >= 0 && mine >= Math.max(a, b);
}

/** Actions of work a door's lock takes to pick or hack (see the header). */
export function lockActions(world: ReadonlyWorld, door: DeepReadonly<DoorDef>): number {
    const technical = lockOn(world, door.id)?.technical;
    if (door.lock === 'mechanical') return world.rules.lockpickActions;
    return technical?.kind === 'reader' || technical?.kind === 'loopedReader' ? technical.actions : world.rules.readerActions;
}

/** Why a crew member can't work on a door's lock (pick or hack) now, or undefined. */
function lockWorkBlocked(
    world: ReadonlyWorld, state: DeepReadonly<State>, member: DeepReadonly<CrewState>, door: DeepReadonly<DoorDef>, status: DoorStatus, action: 'pick' | 'hack'
): string | undefined {
    if (status !== 'locked') return 'The door isn\'t locked';
    if (action === 'pick') {
        if (door.lock !== 'mechanical') return 'Only a mechanical lock can be picked';
        return member.loadout.items.includes(LOCKPICK) ? undefined : `${member.name} has no lockpick set`;
    }
    if (door.lock !== 'keycard' && door.lock !== 'maglock') return 'It has no card reader';
    if (!member.loadout.items.includes(HACKING_KIT)) return `${member.name} has no hacking kit`;
    const lock = lockOn(world, door.id);
    if (lock?.technical.kind !== 'loopedReader') return undefined;
    const watching = world.cameras.filter(c => c.room === lock.room && state.cameras[c.id]?.live !== false && state.cameras[c.id]?.loopedUntil === null);
    return watching.length ? 'Loop the camera watching the reader first' : undefined;
}

/** Why a door action isn't possible for the door as it is now, from `at`, or undefined. */
export function doorActionBlocked(
    world: ReadonlyWorld, state: DeepReadonly<State>, member: DeepReadonly<CrewState>, door: DeepReadonly<DoorDef>, status: DoorStatus, action: DoorAction,
    at: DeepReadonly<Pos> = member.pos
): string | undefined {
    if (status === 'breached') return 'The door is breached: there is nothing left to move';
    if (status === 'jammed') return 'The door is jammed shut';
    switch (action) {
        case 'open':
            if (status === 'open') return 'The door is already open';
            return status === 'locked' && !crewHasKey(world, member, door) ? 'The door is locked' : undefined;
        case 'close':
            return status !== 'open' ? 'The door is already shut' : undefined;
        case 'lock':
            if (door.lock === 'none') return 'The door has no lock';
            if (status === 'open') return 'Close the door first';
            if (status === 'locked') return 'The door is already locked';
            if (crewHasKey(world, member, door)) return undefined;
            if (door.lock !== 'mechanical') return `${member.name} has no key to this door`;
            return innerSide(world, door, at) ? undefined : 'It locks with a key from this side';
        case 'unlock':
            if (status !== 'locked') return 'The door isn\'t locked';
            return crewHasKey(world, member, door) ? undefined : `${member.name} has no key to this door`;
        case 'pick':
        case 'hack':
            return lockWorkBlocked(world, state, member, door, status, action);
    }
}

registerAction('door', {
    whyNot(world, state, cmd) {
        const member = state.crew.find(c => c.id === cmd.crew)!;
        const lack = lacksActions(member, 1);
        if (lack) return lack;
        if (!DOOR_ACTIONS.includes(cmd.action)) return `No door action '${String(cmd.action)}'`;
        const door = Object.hasOwn(world.doors, cmd.door) ? world.doors[cmd.door]! : undefined;
        if (!door) return `No door '${cmd.door}'`;
        if (!besideDoor(world, door, member.pos)) return `${member.name} isn't beside the door`;
        return doorActionBlocked(world, state, member, door, doorStatus(world, state, door.id), cmd.action);
    },
    candidates(world, _state: State, member) {
        const out: { type: 'door'; crew: string; door: string; action: DoorAction }[] = [];
        for (const id of sortedIds(world.doors)) {
            if (!besideDoor(world, world.doors[id]!, member.pos)) continue;
            for (const action of DOOR_ACTIONS) out.push({ type: 'door', crew: member.id, door: id, action });
        }
        return out;
    },
    cost: () => 1,
    illegal: (_world, _state, cmd) => (cmd.action === 'pick' ? { act: 'lockpick' } : cmd.action === 'hack' ? { act: 'hack' } : undefined),
    run(ctx, member, cmd) {
        const { state, world } = ctx;
        const was = state.doors[cmd.door];
        switch (cmd.action) {
            case 'open':
                state.doors[cmd.door] = { ...was, status: 'open' };
                ctx.emit({ type: 'doorOpened', door: cmd.door, by: member.id });
                break;
            case 'close': {
                const next = { ...was, status: 'closed' as const };
                delete next.propped;
                state.doors[cmd.door] = next;
                ctx.emit({ type: 'doorClosed', door: cmd.door, by: member.id });
                break;
            }
            case 'lock':
                state.doors[cmd.door] = { ...was, status: 'locked' };
                ctx.emit({ type: 'doorLocked', door: cmd.door, by: member.id });
                break;
            case 'unlock':
                state.doors[cmd.door] = { ...was, status: 'closed' };
                ctx.emit({ type: 'doorUnlocked', door: cmd.door, by: member.id });
                break;
            case 'pick':
            case 'hack': {
                makeNoise(ctx, cmd.action === 'pick' ? 'lockpick' : 'panelWork', member.pos, `${cmd.action} ${member.id}`);
                const needed = lockActions(world, world.doors[cmd.door]!);
                const progress = Math.min(needed, (was?.work ?? 0) + Math.ceil(needed / workActions(member, needed)));
                ctx.emit({ type: 'doorWorked', crew: member.id, door: cmd.door, progress, needed });
                if (progress < needed) {
                    state.doors[cmd.door] = { ...was, status: 'locked', work: progress };
                    break;
                }
                const next = { ...was, status: 'closed' as const };
                delete next.work;
                state.doors[cmd.door] = next;
                ctx.emit({ type: 'doorUnlocked', door: cmd.door, by: member.id });
                break;
            }
        }
    }
});

registerEvents({ doorLocked: { undoBlocking: false }, doorUnlocked: { undoBlocking: false }, doorWorked: { undoBlocking: false } });

registerRuleDefaults({ readerActions: 2 });
