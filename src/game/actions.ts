import {
    besideDoor, crewPicture, doorStatus, DRAGGABLE, inReach, interactionVerbs, legalActions, reachesObject, STASH_KINDS, whyNot, type Command, type Pos,
    type ReadonlyWorld, type State
} from '../sim';
import type { HudIcon as HudIconName } from '../ui/hud/viewModels';

/*
 * The selected crew member's action grid (§6.3, UI.md "Actions"): every action the sim registers that fits where they
 * stand, each with the command it gives, enabled when the sim allows it (`whyNot`, the very check the reducer runs, so
 * the grid offers what `legalActions` would) and otherwise with the reason for the long-press tag. Actions on a thing
 * (a door, an NPC, a stash) are for the current **target**: the one the player tapped, else the first in reach.
 *
 * - Doors beside them: open or close (whichever the door's state calls for), and lock or unlock.
 * - Knockout: an NPC the crew knows of (§8.15), in reach, still on their feet.
 * - Drag: a body (knocked out, dead, tied) in reach; while dragging, Drop and Stash (a stash object in reach, or the
 *   stash room they stand in).
 * - Interact: one entry per verb of each object in reach whose kind a package handles (none in M1-07).
 * - Wait, always last.
 */

/** One entry of the grid: its id (stable while the target is), what it shows and the command it gives. */
export interface ActionEntry {
    id: string;
    label: string;
    icon: HudIconName;
    command: Command;
    /** Why the sim refuses it now, or undefined when it is allowed. */
    reason?: string;
    /** The thing it acts on (a door id, an NPC id, an object id), when it has one. */
    target?: string;
}

/** What a door, an NPC or an object in reach of the member is: the targets a tap can pick. */
export interface Targets {
    doors: string[];
    npcs: string[];
    objects: string[];
}

/** The doors, NPCs (known to the crew) and stash or handled objects a crew member could act on from where they stand. */
export function targetsOf(world: ReadonlyWorld, state: State, crewId: string): Targets {
    const member = state.crew.find(c => c.id === crewId);
    if (!member) return { doors: [], npcs: [], objects: [] };
    const doors = Object.keys(world.doors).sort().filter(id => besideDoor(world, world.doors[id]!, member.pos));
    // Only NPCs the crew sees or predicts (§8.15): the grid gives nothing away about anyone else.
    const npcs = crewPicture(world, state).npcs
        .filter(n => n.status !== 'away' && n.stashed === null && !state.crew.some(c => c.dragging === n.id) && inReach(world, state, member.pos, n.pos))
        .map(n => n.id);
    const objects = world.objects
        .filter(o => (STASH_KINDS.has(o.kind) || interactionVerbs(world, o.id).length) && reachesObject(world, state, member.pos, o))
        .map(o => o.id);
    return { doors, npcs, objects };
}

const DOOR_LABEL = { open: 'Open', close: 'Close', lock: 'Lock', unlock: 'Unlock' } as const;

/** The grid's entries (movement is the HUD's own first entry), for `target` when it is one of the member's targets. */
export function actionMenu(world: ReadonlyWorld, state: State, crewId: string, target?: string | null): ActionEntry[] {
    const member = state.crew.find(c => c.id === crewId);
    if (!member) return [];
    const targets = targetsOf(world, state, crewId), out: ActionEntry[] = [];
    const add = (id: string, label: string, icon: HudIconName, command: Command, on?: string) => {
        const reason = whyNot(world, state, command);
        out.push({ id, label, icon, command, ...(reason ? { reason } : {}), ...(on ? { target: on } : {}) });
    };
    const pick = (ids: string[]) => (target && ids.includes(target) ? target : ids[0]);

    const door = pick(targets.doors);
    if (door) {
        const status = doorStatus(world, state, door);
        const toggle = status === 'open' ? 'close' : 'open';
        add(`door:${toggle}`, DOOR_LABEL[toggle], 'interact', { type: 'door', crew: crewId, door, action: toggle }, door);
        const turn = status === 'locked' ? 'unlock' : status === 'closed' ? 'lock' : undefined;
        if (turn) add(`door:${turn}`, DOOR_LABEL[turn], 'lock', { type: 'door', crew: crewId, door, action: turn }, door);
    }

    if (member.dragging !== null) {
        add('drop', 'Drop', 'flip', { type: 'drop', crew: crewId });
        const stash = pick(targets.objects.filter(id => STASH_KINDS.has(world.objects.find(o => o.id === id)!.kind)));
        add('stash', 'Stash', 'concealed', stash ? { type: 'stash', crew: crewId, at: stash } : { type: 'stash', crew: crewId }, stash);
    } else {
        const standing = targets.npcs.filter(id => !DRAGGABLE.has(state.npcs.find(n => n.id === id)!.status));
        const bodies = targets.npcs.filter(id => DRAGGABLE.has(state.npcs.find(n => n.id === id)!.status));
        const npc = pick(standing);
        if (npc) add('knockout', 'Knockout', 'knockout', { type: 'knockout', crew: crewId, npc }, npc);
        const body = pick(bodies);
        if (body) add('drag', 'Drag', 'heavy', { type: 'drag', crew: crewId, npc: body }, body);
    }

    const object = pick(targets.objects.filter(id => interactionVerbs(world, id).length));
    if (object) {
        for (const verb of interactionVerbs(world, object)) {
            add(`interact:${verb}`, verb.charAt(0).toUpperCase() + verb.slice(1), 'interact', { type: 'interact', crew: crewId, object, verb }, object);
        }
    }

    add('wait', 'Wait', 'wait', { type: 'wait', crew: crewId });
    return out;
}

/** Whether `menu` agrees with the sim's `legalActions`: every enabled entry is one of them (for tests). */
export function menuIsLegal(world: ReadonlyWorld, state: State, crewId: string, menu: readonly ActionEntry[]): boolean {
    const legal = new Set(legalActions(world, state, crewId).map(c => JSON.stringify(c)));
    return menu.every(e => !!e.reason || legal.has(JSON.stringify(e.command)));
}

/** The tile a door stands on the edge of, as the middle of that edge in tile units (for taps and markers). */
export function doorMiddle(world: ReadonlyWorld, door: string): Pos | undefined {
    const def = world.doors[door], edge = def && world.edges[def.edge];
    if (!edge) return undefined;
    return edge.run === 'eastWest' ? { x: edge.tx + 0.5, y: edge.ty } : { x: edge.tx, y: edge.ty + 0.5 };
}
