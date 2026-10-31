import {
    besideDoor, COMBAT_COMMANDS, crewPicture, negotiatorCalling, offerEffect, releasable, tradeable, withDoubtedShut, doorStatus, DRAGGABLE, draggedBy, goBlocked, HACKING_KIT, inHands, inReach, interactionVerbs, isKnownNow, JAMMER, officerSeen, legalActions, LOCKPICK, lockActions, LOOP_FROM, lootWeight,
    pocketed, preview, IllegalCommand, reachesObject, STASH_KINDS, throwTargets, tieIneligible, tileVisibility, whyNot, driveBudget, driveMap, driveReach, exitTiles, poseKey, vehicleBeside,
    vehicleDef, type Command, type DriveNode, type Pose, type Pos, type ReadonlyWorld, type State
} from '../sim';
import type { HudIcon as HudIconName } from '../ui/hud/viewModels';

/*
 * The selected crew member's action grid (§6.3, UI.md "Actions"): every action the sim registers that fits where they
 * stand, each with the command it gives, enabled when the sim allows it (`whyNot`, the very check the reducer runs, so
 * the grid offers what `legalActions` would) and otherwise with the reason for the long-press tag. Actions on a thing
 * (a door, an NPC, a stash) are for the current **target**: the one the player tapped, else the first in reach.
 *
 * - Doors beside them: open or close (whichever the door's state calls for), and lock or unlock; with the kit, pick a
 *   mechanical lock or hack a card reader (its work so far, M2-05).
 * - Vault access (M2-05): the console's Unlock vault, the manager's PC's Hack PC and a deposit wall's Pick a box (as
 *   interactions, with their work so far), Cut sensors at the console; Drill and Thermite where the sim allows them, Fix
 *   drill for a jammed one, Take drill to put one back in the kit.
 * - Knockout: an NPC the crew knows of (§8.15), in reach, still on their feet.
 * - Drag: a body (knocked out, dead, tied) in reach; while dragging, Drop and Stash (a stash object in reach, or the
 *   stash room they stand in).
 * - Interact: one entry per verb of the object in reach whose kind a package handles: the alarm panel's Disable (its work
 *   so far as "2/4", §9.1), the recorder's Take and Smash (§8.12).
 * - Answer radio (§8.11): while a guard the crew knows of has a radio ringing (or a missed check-in carrier running).
 * - The negotiator (§13.4, M3-07): while it calls, Release and Trade (a hostage the crew holds and knows of), Stall and
 *   Hang up.
 * - Loop feed (§7.2, §8.12): at the CCTV desk or a server rack, for a camera the crew knows of: the tapped one, else
 *   the first it can loop; tapping the entry again cycles through them (the scene's `nextCamera`).
 * - Jammer (§12.2): while the member carries one.
 * - Loot (§15.1, M2-04): Take the loot in reach nobody has (the tapped one, else the first); with loot in the hands, Put
 *   down, Throw (a bag) to a teammate it would reach, and Pass (it, or a body) to a teammate in reach; Inspect a
 *   pocketed stack of cash not yet looked through; Drop ruined cash a dye pack spoilt. With nobody to catch it, Throw starts at the furthest tile the bag reaches;
 *   while a throw is previewed a tap on any tile it reaches throws it there (the scene, M2-06).
 * - Hostages and disguises (§10.6, §10.7, §8.14, M2-03): Zip-tie an NPC in reach that can be tied (face down,
 *   surprised, out cold); Lead (escort) one face down or tied (Drop lets go); Coerce a hostage the crew knows of into
 *   opening a drawer or entering the vault code (the first the sim allows); Change clothes from a downed guard or the
 *   staff lockers in reach (the first the sim allows).
 * - Wounds (§11.12, M3-03): Revive a downed teammate in reach; Medkit on the teammate tapped, else the most hurt in
 *   reach (oneself included).
 * - Wait.
 * - The takeover (§9.3, §10.1–10.3, M2-01), after Wait: Command always; Hold while anyone is Commanded; Mask up while
 *   unmasked; GO while it can still be pressed.
 * - Combat (§6.3, §11, M3-02; the loud interface with aim mode, the loupe and the wedges is M3-09's): Fire the drawn
 *   weapon at the tapped NPC (else the first the crew knows of that it could aim at), Reload when the magazine isn't
 *   full, Swap to another weapon carried, Take gun / Take mags off a downed NPC in reach; once the bank is loud also
 *   Strike someone in reach, Watch and Suppress toward the target, Brace, Flashbang and Smoke at it, Flip a table in
 *   reach and Hand a magazine to a teammate. In stealth they come after the takeover (a full grid drops them first);
 *   once loud, after Command and Hold (before Mask up and GO). Each only where the rules allow it with the doors the
 *   crew can't vouch for shut, so no offer tells how such a door stands.
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
    /** Loot in reach that nobody has (where the bank keeps it, or on the floor), ruined cash aside. */
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
    // Not a ruined stack put down: it is nothing to take, and would hide real loot behind a greyed Take.
    const loot = Object.keys(state.loot).sort().filter(id => state.loot[id]!.holder === null && !state.loot[id]!.ruined && inReach(world, state, member.pos, state.loot[id]!.pos));
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
    'recorder.destroy': { label: 'Smash recorder', icon: 'attack' },
    'vaultConsole.unlock': { label: 'Unlock vault', icon: 'lock' },
    'vaultConsole.sensors': { label: 'Cut sensors', icon: 'hack' },
    'managerPc.hack': { label: 'Hack PC', icon: 'hack' },
    'depositBoxes.pick': { label: 'Pick a box', icon: 'lockpick' }
};

const DOOR_LABEL = { open: 'Open', close: 'Close', lock: 'Lock', unlock: 'Unlock' } as const;

/** What a Take button names, by weight (§15.1). */
const LOOT_NAME = { light: 'cash', heavy: 'bag', 'very heavy': 'crate' } as const;

/** How many tiles of path the getaway route looks ahead for the way off the plot. */
const ROUTE_TILES = 64;

/**
 * The getaway's next Drive (M3-08, until M3-09's driving overlay picks poses by hand), planned on what the crew knows
 * (`driveMap`'s default): along the cheapest path off the plot, as far as one Drive goes (a pose on the cheapest path
 * within one Drive's tiles is reached by that Drive at the same cost, so the sim drives it), with the tiles still to go;
 * with no way off in sight, the pose one Drive reaches nearest the map's west or east edge (`tilesLeft` null). Null
 * when it can't move at all.
 */
export function getawayDrive(world: ReadonlyWorld, state: State, vehicle: string): { to: Pose; off: boolean; tilesLeft: number | null } | null {
    const def = vehicleDef(world, vehicle), v = state.vehicles[vehicle];
    const driver = v?.driver ? state.crew.find(c => c.id === v.driver) : undefined;
    if (!def || !v || v.gone || !driver) return null;
    const route = driveReach(def, v.pose, ROUTE_TILES, driveMap(world, state, vehicle)), budget = driveBudget(world, driver);
    let end = [...route.nodes.values()].find(n => n.off);
    if (end) {
        const total = end.cost;
        while (end.cost > budget && end.parent) end = route.nodes.get(end.parent)!;
        return poseKey(end.pose) === poseKey(v.pose) ? null : { to: end.pose, off: end.off, tilesLeft: total - end.cost };
    }
    // No way off in sight: as near an edge as one Drive gets (the first such pose settled, so the cheapest).
    const edge = (p: Pose) => Math.min(p.x, world.width - 1 - p.x);
    const near = [...route.nodes.values()].filter(n => n.cost <= budget && n.parent).reduce<DriveNode | undefined>((a, n) => (!a || edge(n.pose) < edge(a.pose) ? n : a), undefined);
    return near && edge(near.pose) < edge(v.pose) ? { to: near.pose, off: false, tilesLeft: null } : null;
}

/** A crew member aboard a vehicle: drive it toward the plot's edge (the driver), and get out. */
function vehicleMenu(world: ReadonlyWorld, state: State, crewId: string, vehicle: string): ActionEntry[] {
    const out: ActionEntry[] = [];
    const add = (id: string, label: string, command: Command, refusal?: string) => {
        const reason = refusal ?? vehicleRefusal(world, state, command);
        out.push({ id, label, icon: 'car', command, ...(reason ? { reason } : {}) });
    };
    const drive = getawayDrive(world, state, vehicle), v = state.vehicles[vehicle]!;
    if (v.driver === crewId) {
        if (drive) add('drive', drive.off ? 'Drive off' : drive.tilesLeft === null ? 'Drive' : `Drive (${drive.tilesLeft} to go)`, { type: 'drive', crew: crewId, vehicle, to: drive.to });
        else add('drive', 'Drive off', { type: 'drive', crew: crewId, vehicle, to: { ...v.pose } }, 'No way off the plot from here');
    }
    const exit = exitTiles(world, state, crewId)[0];
    add('getOut', 'Get out', { type: 'getOut', crew: crewId, to: exit ?? { x: -1, y: -1 } }, exit ? undefined : 'Every door is blocked');
    return out;
}

/** Why a vehicle command can't be given: the sim's own refusal, from a preview (they aren't registered actions). */
function vehicleRefusal(world: ReadonlyWorld, state: State, command: Command): string | undefined {
    try {
        preview(world, state, command);
        return undefined;
    } catch (e) {
        if (e instanceof IllegalCommand) return e.message;
        throw e;
    }
}

/** The grid's entries (movement is the HUD's own first entry), for `target` when it is one of the member's targets. */
export function actionMenu(world: ReadonlyWorld, state: State, crewId: string, target?: string | null): ActionEntry[] {
    const member = state.crew.find(c => c.id === crewId);
    if (!member) return [];
    if (member.aboard) return vehicleMenu(world, state, crewId, member.aboard);
    const targets = targetsOf(world, state, crewId), out: ActionEntry[] = [];
    const add = (id: string, label: string, icon: HudIconName, command: Command, on?: string) => {
        const reason = whyNot(world, state, command);
        out.push({ id, label, icon, command, ...(reason ? { reason } : {}), ...(on ? { target: on } : {}) });
    };
    // The getaway (§14.4): get in by a door of the van, or load the bag in hand into it.
    const van = vehicleBeside(world, state, member.pos);
    if (van) {
        add('board', 'Get in', 'car', { type: 'board', crew: crewId, vehicle: van });
        if (inHands(world, state, crewId) !== undefined) add('stow', 'Load the van', 'bag', { type: 'stow', crew: crewId, vehicle: van });
    }
    const pick = (ids: string[]) => (target && ids.includes(target) ? target : ids[0]);

    const door = pick(targets.doors);
    if (door) {
        const status = doorStatus(world, state, door);
        const toggle = status === 'open' ? 'close' : 'open';
        add(`door:${toggle}`, DOOR_LABEL[toggle], 'interact', { type: 'door', crew: crewId, door, action: toggle }, door);
        const turn = status === 'locked' ? 'unlock' : status === 'closed' ? 'lock' : undefined;
        if (turn) add(`door:${turn}`, DOOR_LABEL[turn], 'lock', { type: 'door', crew: crewId, door, action: turn }, door);
        // Working on the lock (M2-05), with the kit for it: a mechanical lock picked, a card reader hacked.
        const lock = world.doors[door]!.lock;
        const work = status !== 'locked' ? undefined : lock === 'mechanical' && member.loadout.items.includes(LOCKPICK) ? 'pick'
            : (lock === 'keycard' || lock === 'maglock') && member.loadout.items.includes(HACKING_KIT) ? 'hack' : undefined;
        if (work) {
            add(`door:${work}`, work === 'pick' ? 'Pick lock' : 'Hack reader', work === 'pick' ? 'lockpick' : 'hack', { type: 'door', crew: crewId, door, action: work }, door);
            out.at(-1)!.progress = `${state.doors[door]?.work ?? 0}/${lockActions(world, world.doors[door]!)}`;
        }
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
        // Someone running for it (§9.1 escapee) can be tackled to the floor.
        const runner = pick(standing.filter(id => state.npcs.find(n => n.id === id)!.lapse?.kind === 'flee'));
        if (runner) add('tackle', 'Tackle', 'knockout', { type: 'tackle', crew: crewId, npc: runner }, runner);
        const body = pick(bodies);
        if (body) add('drag', 'Drag', 'heavy', { type: 'drag', crew: crewId, npc: body }, body);
    }

    // Hostages and disguises (M2-03).
    if (handsFreeOf(member)) {
        const tieable = pick(targets.npcs.filter(id => !tieIneligible(state.npcs.find(n => n.id === id)!)));
        if (tieable) add('zipTie', `Zip-tie (${member.zipTies})`, 'ziptie', { type: 'zipTie', crew: crewId, npc: tieable }, tieable);
        const led = pick(targets.npcs.filter(id => ['commanded', 'tied'].includes(state.npcs.find(n => n.id === id)!.status)));
        if (led) add('escort', 'Lead', 'hold', { type: 'escort', crew: crewId, npc: led }, led);
    }
    const legal = legalActions(world, state, crewId);
    const coerce = legal.find((c): c is Extract<Command, { type: 'coerce' }> => c.type === 'coerce' && isKnownNow(world, state, c.npc) && (!target || c.npc === target || c.at === target));
    if (coerce) add('coerce', world.objects.find(o => o.id === coerce.at)?.kind === 'vaultConsole' ? 'Make them enter the code' : 'Make them open the drawer', 'command', coerce, coerce.npc);
    const change = legal.find((c): c is Extract<Command, { type: 'changeClothes' }> => c.type === 'changeClothes' && (!target || c.from === target));
    if (change) add('changeClothes', 'Change clothes', 'swap', change, change.from);

    const object = pick(targets.objects.filter(id => interactionVerbs(world, id).length));
    if (object) {
        const kind = world.objects.find(o => o.id === object)!.kind;
        for (const verb of interactionVerbs(world, object)) {
            const named = VERBS[`${kind}.${verb}`];
            add(`interact:${verb}`, named?.label ?? verb.charAt(0).toUpperCase() + verb.slice(1), named?.icon ?? 'interact', { type: 'interact', crew: crewId, object, verb }, object);
            if (kind === 'alarmPanel' && verb === 'disable') out.at(-1)!.progress = `${state.objects[object]?.progress ?? 0}/${world.rules.panelActions}`;
            if (kind === 'managerPc') out.at(-1)!.progress = `${state.objects[object]?.progress ?? 0}/${world.rules.pcActions}`;
            if (kind === 'vaultConsole' && verb === 'sensors') out.at(-1)!.progress = `${state.objects[object]?.progress ?? 0}/${world.rules.sensorActions}`;
            if (kind === 'depositBoxes') out.at(-1)!.progress = `${state.objects[object]?.progress ?? 0}/${world.rules.lockpickActions}`;
        }
    }

    const ringing = ringingGuards(world, state, crewId), guard = pick(ringing);
    if (guard) add('answer', 'Answer radio', 'chat', { type: 'answerRadio', crew: crewId, npc: guard }, guard);

    // The negotiator on the line (§13.4): each offer with its effect; a release or trade lets go the hostage tapped, else
    // the first the crew holds. The dialog is M3-09's.
    if (negotiatorCalling(state)) {
        const held = state.npcs.filter(n => releasable(n) && (isKnownNow(world, state, n.id) || draggedBy(state, n.id)?.id === crewId)).map(n => n.id);
        const hostage = pick(held);
        if (hostage) {
            const heat = offerEffect(state, 'release').heat;
            add('negotiate:release', heat ? `Release (${heat} heat)` : 'Release', 'phone', { type: 'negotiate', crew: crewId, offer: 'release', npc: hostage }, hostage);
            const back = state.custody.find(c => tradeable(state).includes(c.crew.id))?.crew;
            if (back) add('negotiate:trade', `Trade for ${back.name}`, 'phone', { type: 'negotiate', crew: crewId, offer: 'trade', npc: hostage, member: back.id }, hostage);
        }
        add('negotiate:stall', `Stall (+${offerEffect(state, 'stall').phases} turns)`, 'phone', { type: 'negotiate', crew: crewId, offer: 'stall' });
        add('negotiate:hangUp', 'Hang up', 'phone', { type: 'negotiate', crew: crewId, offer: 'hangUp' });
    }

    // Only cameras the crew knows of: none known, no entry.
    const desk = loopFrom(world, state, crewId);
    const camera = desk && (target && targets.cameras.includes(target) ? target : nextCamera(world, state, crewId, null) ?? targets.cameras[0]);
    if (desk && camera) add('loop', 'Loop feed', 'hack', { type: 'loopFeed', crew: crewId, object: desk, camera }, camera);

    if (member.loadout.items.includes(JAMMER)) add('jammer', 'Jammer', 'radio', { type: 'placeJammer', crew: crewId });

    // The drill and thermite (M2-05): at the vault door or a wall of deposit boxes the sim allows; a jammed drill in reach.
    const drill = legal.find((c): c is Extract<Command, { type: 'drill' }> => c.type === 'drill' && (!target || c.at === target));
    if (drill) add('drill', 'Drill', 'drill', drill, drill.at);
    const charge = legal.find((c): c is Extract<Command, { type: 'thermite' }> => c.type === 'thermite');
    if (charge) add('thermite', 'Thermite', 'charge', charge, charge.door);
    const fix = legal.find((c): c is Extract<Command, { type: 'fixDrill' }> => c.type === 'fixDrill');
    if (fix) add('fixDrill', 'Fix drill', 'drill', fix);
    const back = legal.find((c): c is Extract<Command, { type: 'takeDrill' }> => c.type === 'takeDrill');
    if (back) add('takeDrill', 'Take drill', 'drill', back);

    const loot = pick(targets.loot);
    if (loot) add('take', `Take ${LOOT_NAME[lootWeight(world, loot)]}`, 'bag', { type: 'takeLoot', crew: crewId, loot }, loot);
    const held = inHands(world, state, crewId);
    if (held) add('putDown', 'Put down', 'flip', { type: 'dropLoot', crew: crewId });
    const mates = state.crew.filter(c => c.id !== crewId);
    if (held && lootWeight(world, held) === 'heavy') {
        const tiles = throwTiles(world, state, crewId), reach = new Set(tiles.map(p => `${p.x},${p.y}`));
        const catcher = pick(mates.filter(c => reach.has(`${c.pos.x},${c.pos.y}`)).map(c => c.id));
        if (catcher) add('throw', `Throw to ${state.crew.find(c => c.id === catcher)!.name}`, 'throw', { type: 'throwLoot', crew: crewId, to: { ...state.crew.find(c => c.id === catcher)!.pos } }, catcher);
        else {
            // Nobody to catch it: onto the floor, as far as it goes to start with; a tap on another tile it reaches moves it.
            const d = (p: Pos) => (p.x - member.pos.x) ** 2 + (p.y - member.pos.y) ** 2;
            const far = tiles.reduce<Pos | undefined>((best, p) => (!best || d(p) > d(best) ? p : best), undefined);
            if (far) add('throw', 'Throw', 'throw', { type: 'throwLoot', crew: crewId, to: { x: far.x, y: far.y } });
        }
    }
    if (held || member.dragging !== null) {
        const to = pick(mates.filter(c => inReach(world, state, member.pos, c.pos)).map(c => c.id));
        if (to) add('pass', `Pass to ${state.crew.find(c => c.id === to)!.name}`, 'heavy', { type: 'pass', crew: crewId, to }, to);
    }
    const stack = pocketed(world, state, crewId).find(id => !state.loot[id]!.inspected && !state.loot[id]!.ruined);
    if (stack) add('inspect', 'Inspect cash', 'eye', { type: 'inspectLoot', crew: crewId, loot: stack }, stack);
    const ruined = pocketed(world, state, crewId).find(id => state.loot[id]!.ruined);
    if (ruined) add('dropRuined', 'Drop ruined cash', 'flip', { type: 'dropLoot', crew: crewId, loot: ruined }, ruined);


    // Wounds (§11.12, M3-03): revive a downed teammate in reach; a medkit on the one tapped (or the most hurt), else oneself.
    const revive = legal.find((c): c is Extract<Command, { type: 'revive' }> => c.type === 'revive' && (!target || c.ally === target))
        ?? legal.find((c): c is Extract<Command, { type: 'revive' }> => c.type === 'revive');
    if (revive) add('revive', `Revive ${state.crew.find(c => c.id === revive.ally)!.name}`, 'revive', revive, revive.ally);
    const kits = legal.filter((c): c is Extract<Command, { type: 'medkit' }> => c.type === 'medkit');
    const hpOf = (id: string): number => state.crew.find(c => c.id === id)!.wounds.hp;
    const kit = kits.find(c => c.ally === target) ?? [...kits].sort((a, b) => hpOf(a.ally) - hpOf(b.ally))[0];
    if (kit) add('medkit', kit.ally === crewId ? `Medkit (${member.wounds.medkits})` : `Medkit ${state.crew.find(c => c.id === kit.ally)!.name} (${member.wounds.medkits})`, 'medkit', kit, kit.ally);

    const loud = state.bank.loud || state.bank.alarm;
    add('wait', 'Wait', 'wait', { type: 'wait', crew: crewId });

    // After Wait, so a full grid drops these first and the stealth entries keep their places; the HUD puts GO first (views.ts).
    add('command', 'Command', 'command', { type: 'command', crew: crewId });
    if (state.npcs.some(n => n.command !== null)) add('hold', 'Hold', 'hold', { type: 'hold', crew: crewId });
    if (loud) combatEntries(world, state, crewId, target, legal, add);
    if (!member.loadout.masked) add('mask', 'Mask up', 'mask', { type: 'maskUp', crew: crewId });
    if (!goBlocked(state)) add('go', 'GO', 'star', { type: 'go', crew: crewId });
    if (!loud) combatEntries(world, state, crewId, target, legal, add);
    return out;
}

/** The icon of a weapon's Fire entry. */
const WEAPON_ICON: Readonly<Record<string, HudIconName>> = { pistol: 'pistol', suppressedPistol: 'pistol', smg: 'smg', machinePistol: 'smg', shotgun: 'shotgun', lmg: 'lmg', dmr: 'dmr' };

/**
 * The combat entries (see the header): each command one `legalActions` offers (so `menuIsLegal` holds), on the target
 * when it is one of theirs, else the first whose NPC the crew knows of.
 */
function combatEntries(
    world: ReadonlyWorld, state: State, crewId: string, target: string | null | undefined, legal: readonly Command[],
    add: (id: string, label: string, icon: HudIconName, command: Command, on?: string) => void
): void {
    const member = state.crew.find(c => c.id === crewId)!, loud = state.bank.loud || state.bank.alarm;
    // Offered only as the rules offer and allow them with every door the crew can't vouch for shut (decision 44): a
    // target in sight through such a door, or a throw past it, would tell how the door really stands. Sight only grows
    // as doors open, so each is allowed on the truth too (`legal` keeps the grid to `legalActions`).
    const certain = withDoubtedShut(world, state);
    const truth = new Set(legal.map(c => JSON.stringify(c)));
    const combat = legalActions(world, certain, crewId).filter(c => COMBAT_COMMANDS.has(c.type) && truth.has(JSON.stringify(c)));
    const onTarget = <T extends Command>(type: T['type'], npcOf: (c: T) => string | undefined, keep: (c: T) => boolean = () => true): T | undefined => {
        const mine = combat.filter((c): c is T => c.type === type && keep(c as T));
        const known = mine.filter(c => {
            const id = npcOf(c);
            return id === undefined || isKnownNow(world, state, id) || officerSeen(world, state, id);
        });
        return known.find(c => !!target && npcOf(c) === target) ?? known[0];
    };
    // Whoever a wedge or a throw is aimed at: an NPC, or an officer out on scene (offered only when the crew sees it).
    const npcAt = (p: Pos): string | undefined => state.npcs.find(n => n.pos.x === p.x && n.pos.y === p.y)?.id
        ?? state.police.units.find(u => u.pos?.x === p.x && u.pos?.y === p.y)?.id;
    const drawn = member.arms.drawn;
    if (drawn) {
        const gun = member.arms.guns[drawn]!;
        const attack = onTarget<Extract<Command, { type: 'attack' }>>('attack', c => c.target);
        if (attack) add('attack', drawn === 'taser' ? `Tase (${gun.loaded})` : `Fire (${gun.loaded})`, WEAPON_ICON[drawn] ?? 'attack', attack, attack.target);
        if (gun.spare > 0 && combat.some(c => c.type === 'reload' && !c.load)) add('reload', `Reload (${gun.spare})`, 'reload', { type: 'reload', crew: crewId });
    }
    const swap = combat.find((c): c is Extract<Command, { type: 'swap' }> => c.type === 'swap');
    if (swap) add('swap', `Swap to ${swap.to}`, 'swap', swap);
    const gun = onTarget<Extract<Command, { type: 'scavenge' }>>('scavenge', c => c.npc, c => c.take === 'weapon');
    if (gun) add('scavenge:weapon', 'Take gun', 'pistol', gun, gun.npc);
    const mags = onTarget<Extract<Command, { type: 'scavenge' }>>('scavenge', c => c.npc, c => c.take === 'ammo');
    if (mags) add('scavenge:ammo', 'Take mags', 'reload', mags, mags.npc);
    if (!loud) return;
    const strike = onTarget<Extract<Command, { type: 'strike' }>>('strike', c => c.npc);
    if (strike) add('strike', 'Strike', 'attack', strike, strike.npc);
    const watch = onTarget<Extract<Command, { type: 'watch' }>>('watch', c => npcAt(c.at));
    if (watch) add('watch', 'Watch', 'watch', watch, npcAt(watch.at));
    const suppress = onTarget<Extract<Command, { type: 'suppress' }>>('suppress', c => npcAt(c.at));
    if (suppress) add('suppress', 'Suppress', 'suppress', suppress, npcAt(suppress.at));
    if (combat.some(c => c.type === 'brace')) add('brace', 'Brace', 'shield', { type: 'brace', crew: crewId });
    for (const item of ['flashbang', 'smoke']) {
        const thrown = onTarget<Extract<Command, { type: 'throwGrenade' }>>('throwGrenade', c => npcAt(c.to), c => c.item === item);
        if (thrown) add(`throw:${item}`, `${item === 'smoke' ? 'Smoke' : 'Flashbang'} (${member.arms.throwables[item] ?? 0})`, 'grenade', thrown, npcAt(thrown.to));
    }
    const flip = combat.find((c): c is Extract<Command, { type: 'flipTable' }> => c.type === 'flipTable');
    if (flip) add('flip', 'Flip table', 'flip', flip);
    const hand = combat.find((c): c is Extract<Command, { type: 'handMag' }> => c.type === 'handMag');
    if (hand) add('handMag', `Hand a magazine to ${state.crew.find(c => c.id === hand.to)!.name}`, 'reload', hand, hand.to);
}

/**
 * The tiles a crew member could throw the bag in their hands to that the player may pick (§15.1): `throwTargets`, none
 * of them hidden (decision 44: no throw is aimed into a room nobody has looked into).
 */
export const throwTiles = (world: ReadonlyWorld, state: State, crewId: string): Pos[] =>
    throwTargets(world, state, crewId).filter(p => tileVisibility(world, state, p) !== 'hidden');

/** Whether a crew member's hands are free (nothing carried, nobody dragged or led). */
const handsFreeOf = (member: State['crew'][number]): boolean => member.loadout.carrying === null && member.dragging === null;

/** Whether `menu` agrees with the sim's `legalActions`: every enabled entry is one of them (for tests). */
export function menuIsLegal(world: ReadonlyWorld, state: State, crewId: string, menu: readonly ActionEntry[]): boolean {
    const legal = new Set(legalActions(world, state, crewId).map(c => JSON.stringify(c)));
    // Driving and getting out aren't registered actions: their own check is the preview.
    return menu.every(e => !!e.reason || legal.has(JSON.stringify(e.command)) || ((e.command.type === 'drive' || e.command.type === 'getOut') && !vehicleRefusal(world, state, e.command)));
}

/** The tile a door stands on the edge of, as the middle of that edge in tile units (for taps and markers). */
export function doorMiddle(world: ReadonlyWorld, door: string): Pos | undefined {
    const def = world.doors[door], edge = def && world.edges[def.edge];
    if (!edge) return undefined;
    return edge.run === 'eastWest' ? { x: edge.tx + 0.5, y: edge.ty } : { x: edge.tx, y: edge.ty + 0.5 };
}
