import {
    besideDoor, crewPicture, doorStatus, DRAGGABLE, draggedBy, goBlocked, inHands, inReach, interactionVerbs, isKnownNow, JAMMER, legalActions, LOOP_FROM, lootWeight,
    pocketed, reachesObject, STASH_KINDS, throwTargets, whyNot, type Command, type Pos, type ReadonlyWorld, type State
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
 * - Interact: one entry per verb of the object in reach whose kind a package handles: the alarm panel's Disable (its work
 *   so far as "2/4", §9.1), the recorder's Take and Smash (§8.12).
 * - Answer radio (§8.11): while a guard the crew knows of has a radio ringing (or a missed check-in carrier running).
 * - Loop feed (§7.2, §8.12): at the CCTV desk or a server rack, for a camera the crew knows of: the tapped one, else
 *   the first it can loop; tapping the entry again cycles through them (the scene's `nextCamera`).
 * - Jammer (§12.2): while the member carries one.
 * - Loot (§15.1, M2-04): Take the loot in reach nobody has (the tapped one, else the first); with loot in the hands, Put
 *   down, Throw (a bag) to a teammate it would reach, and Pass (it, or a body) to a teammate in reach; Inspect a
 *   pocketed stack of cash not yet looked through. Throwing to a floor tile is `window.sim` only until the throw arc
 *   (M2-06).
 * - Wait.
 * - The takeover (§9.3, §10.1–10.3, M2-01), after Wait: Command always; Hold while anyone is Commanded; Mask up while
 *   unmasked; GO while it can still be pressed.
 */

/** One entry of the grid: its id (stable while the target is), what it shows and the command it gives. */
export interface ActionEntry {
    id: string;
    label: string;
    icon: HudIconName;
    command: Command;
    /** Why the sim refuses it now, or undefined when it is allowed. */
    reason?: string;
    /** The thing it acts on (a door id, an NPC id, an object id, a camera id), when it has one. */
    target?: string;
    /** Work done so far on a job that spans actions ("2/4" on the alarm panel). */
    progress?: string;
}

/** What a door, an NPC or an object in reach of the member is: the targets a tap can pick. */
export interface Targets {
    doors: string[];
    npcs: string[];
    objects: string[];
    /** The cameras the crew knows of, when the member can loop a feed from where they stand. */
    cameras: string[];
    /** Loot in reach that nobody has (where the bank keeps it, or on the floor). */
    loot: string[];
}

/** The doors, NPCs (known to the crew) and stash or handled objects a crew member could act on from where they stand. */
export function targetsOf(world: ReadonlyWorld, state: State, crewId: string): Targets {
    const member = state.crew.find(c => c.id === crewId);
    if (!member) return { doors: [], npcs: [], objects: [], cameras: [], loot: [] };
    const doors = Object.keys(world.doors).sort().filter(id => besideDoor(world, world.doors[id]!, member.pos));
    // Only NPCs the crew sees or predicts (§8.15): the grid gives nothing away about anyone else.
    const npcs = crewPicture(world, state).npcs
        .filter(n => n.status !== 'away' && n.stashed === null && !state.crew.some(c => c.dragging === n.id) && inReach(world, state, member.pos, n.pos))
        .map(n => n.id);
    const objects = world.objects
        .filter(o => (STASH_KINDS.has(o.kind) || interactionVerbs(world, o.id).length) && reachesObject(world, state, member.pos, o))
        .map(o => o.id);
    const atConsole = world.objects.some(o => LOOP_FROM.has(o.kind) && inReach(world, state, member.pos, o.pos));
    const loot = Object.keys(state.loot).sort().filter(id => state.loot[id]!.holder === null && inReach(world, state, member.pos, state.loot[id]!.pos));
    return { doors, npcs, objects, cameras: atConsole ? knownCameras(world, state) : [], loot };
}

/** The cameras the crew knows of (§8.15), in the World's order. */
export const knownCameras = (world: ReadonlyWorld, state: State): string[] =>
    world.cameras.map(c => c.id).filter(id => state.knowledge.cameras.includes(id));

/** A camera as the player calls it: "cam 3", by its place among the World's cameras. */
export function cameraName(world: ReadonlyWorld, id: string): string {
    const i = world.cameras.findIndex(c => c.id === id);
    return i < 0 ? 'a camera' : `cam ${i + 1}`;
}

/** The camera after `current` among those the crew knows of that the member could loop now, for cycling the Loop entry. */
export function nextCamera(world: ReadonlyWorld, state: State, crewId: string, current: string | null): string | undefined {
    const ids = knownCameras(world, state), object = loopFrom(world, state, crewId);
    if (!object) return undefined;
    const ok = ids.filter(id => !whyNot(world, state, { type: 'loopFeed', crew: crewId, object, camera: id }));
    const from = current ? ids.indexOf(current) : -1;
    return [...ok.filter(id => ids.indexOf(id) > from), ...ok][0];
}

/** The CCTV desk or server rack in reach a feed would be looped from, if any (the desk first). */
function loopFrom(world: ReadonlyWorld, state: State, crewId: string): string | undefined {
    const member = state.crew.find(c => c.id === crewId);
    if (!member) return undefined;
    const near = world.objects.filter(o => LOOP_FROM.has(o.kind) && inReach(world, state, member.pos, o.pos));
    return (near.find(o => o.kind === 'cctvDesk') ?? near[0])?.id;
}

/**
 * The guards whose radio the crew could answer (§8.11): ringing, or a missed check-in carrier running about them, and
 * known to the crew (or in the member's hands).
 */
function ringingGuards(world: ReadonlyWorld, state: State, crewId: string): string[] {
    const radio = (state as Partial<State>).radio;
    if (!radio) return [];
    return Object.keys(radio.calls).sort().filter(id => {
        const call = radio.calls[id]!;
        const calling = call.ringing !== null || state.carriers.some(c => c.kind === 'missedCheckIn' && c.subject === id);
        return calling && (isKnownNow(world, state, id) || draggedBy(state, id)?.id === crewId);
    });
}

/** Object verbs' names and icons, by `kind.verb`, on their buttons and on Confirm (§9.1, §8.12). */
export const VERBS: Readonly<Record<string, { label: string; icon: HudIconName }>> = {
    'alarmPanel.disable': { label: 'Disable panel', icon: 'hack' },
    'recorder.take': { label: 'Take recorder', icon: 'bag' },
    'recorder.destroy': { label: 'Smash recorder', icon: 'attack' }
};

const DOOR_LABEL = { open: 'Open', close: 'Close', lock: 'Lock', unlock: 'Unlock' } as const;

/** What a Take button names, by weight (§15.1). */
const LOOT_NAME = { light: 'cash', heavy: 'bag', 'very heavy': 'crate' } as const;

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
        const kind = world.objects.find(o => o.id === object)!.kind;
        for (const verb of interactionVerbs(world, object)) {
            const named = VERBS[`${kind}.${verb}`];
            add(`interact:${verb}`, named?.label ?? verb.charAt(0).toUpperCase() + verb.slice(1), named?.icon ?? 'interact', { type: 'interact', crew: crewId, object, verb }, object);
            if (kind === 'alarmPanel' && verb === 'disable') out.at(-1)!.progress = `${state.objects[object]?.progress ?? 0}/${world.rules.panelActions}`;
        }
    }

    const ringing = ringingGuards(world, state, crewId), guard = pick(ringing);
    if (guard) add('answer', 'Answer radio', 'chat', { type: 'answerRadio', crew: crewId, npc: guard }, guard);

    // Only cameras the crew knows of: none known, no entry.
    const desk = loopFrom(world, state, crewId);
    const camera = desk && (target && targets.cameras.includes(target) ? target : nextCamera(world, state, crewId, null) ?? targets.cameras[0]);
    if (desk && camera) add('loop', 'Loop feed', 'hack', { type: 'loopFeed', crew: crewId, object: desk, camera }, camera);

    if (member.loadout.items.includes(JAMMER)) add('jammer', 'Jammer', 'radio', { type: 'placeJammer', crew: crewId });

    const loot = pick(targets.loot);
    if (loot) add('take', `Take ${LOOT_NAME[lootWeight(world, loot)]}`, 'bag', { type: 'takeLoot', crew: crewId, loot }, loot);
    const held = inHands(world, state, crewId);
    if (held) add('putDown', 'Put down', 'flip', { type: 'dropLoot', crew: crewId });
    const mates = state.crew.filter(c => c.id !== crewId);
    if (held && lootWeight(world, held) === 'heavy') {
        const reach = new Set(throwTargets(world, state, crewId).map(p => `${p.x},${p.y}`));
        const catcher = pick(mates.filter(c => reach.has(`${c.pos.x},${c.pos.y}`)).map(c => c.id));
        if (catcher) add('throw', `Throw to ${state.crew.find(c => c.id === catcher)!.name}`, 'throw', { type: 'throwLoot', crew: crewId, to: { ...state.crew.find(c => c.id === catcher)!.pos } }, catcher);
    }
    if (held || member.dragging !== null) {
        const to = pick(mates.filter(c => inReach(world, state, member.pos, c.pos)).map(c => c.id));
        if (to) add('pass', `Pass to ${state.crew.find(c => c.id === to)!.name}`, 'heavy', { type: 'pass', crew: crewId, to }, to);
    }
    const stack = pocketed(world, state, crewId).find(id => !state.loot[id]!.inspected && !state.loot[id]!.ruined);
    if (stack) add('inspect', 'Inspect cash', 'eye', { type: 'inspectLoot', crew: crewId, loot: stack }, stack);


    add('wait', 'Wait', 'wait', { type: 'wait', crew: crewId });

    // After Wait, so a full grid drops these first and the stealth entries keep their places (M2-06 gives GO its rail).
    add('command', 'Command', 'command', { type: 'command', crew: crewId });
    if (state.npcs.some(n => n.command !== null)) add('hold', 'Hold', 'hold', { type: 'hold', crew: crewId });
    if (!member.loadout.masked) add('mask', 'Mask up', 'mask', { type: 'maskUp', crew: crewId });
    if (!goBlocked(state)) add('go', 'GO', 'star', { type: 'go', crew: crewId });
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
