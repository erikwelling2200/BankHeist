import { InvariantError, registerWorldHook, type Ctx } from '../core/engine';
import { crewMember, newId, registerRuleDefaults, registerStateInit } from '../core/state';
import type { CrewState, DeepReadonly, Pos, ReadonlyWorld, State, WorldObject } from '../core/types';
import { registerEvents } from '../core/undo';
import { registerMoveHook } from '../crew/movement';
import { tileAt } from '../core/grid';
import { doorStatus } from '../geo/move';
import { makeNoise } from '../geo/sound';
import { NOISES } from '../data/noise';
import type { CodePart, TimeWindow } from '../../gen/model';
import { inReach, lacksActions, registerAction } from './actions/act';
import { besideDoor, LOCKPICK } from './actions/door';
import { registerInteraction } from './actions/interact';
import { HACKING_KIT, hasTrait, workActions } from './alarms';
import { raiseCarrier, registerCarrierCheck } from './carriers';
import { cctvControlled, cctvDesk } from './cctv';
import { registerEvidenceSource, type Evidence } from './evidence';
import { entered, enterPart, partOf, timeLockOpen, unlockVault, vaultLock, vaultShut } from './keys';

/*
 * Vault access (§15.2, §15.3, §9.1's vault sensors, §7.2's kits and Steady Hands): the key graph's keys as actions.
 *
 * - **The console** (`interact … unlock` at the `vaultConsole`, 1 action): a code vault takes the parts of its code the
 *   crew knows that aren't in yet (`State.codesKnown`; key-holders enter theirs when coerced, actions/hostage.ts); the
 *   last part unlocks the vault (rules/keys.ts). A Three Keys vault takes the manager's card, swiped by a crew member
 *   who took it, while the crew holds the CCTV room (`cctvControlled`: no operator watching, one of the crew at the
 *   desk; nothing to hold in a bank without one), in the time-lock window (implementation plan §6 decision 79).
 *   Either works only while the time lock stands open (decision 77). A power cut darkening the console is M4's.
 *   The console also carries the vault sensors' wiring (decision 81): `interact … sensors` (hacking kit,
 *   `rules.sensorActions` (4) actions of work, Steady Hands half, the illegal act 'hack') cuts them for good.
 * - **The manager's PC** (`interact … hack`, hacking kit, `rules.pcActions` (2) actions of work kept on the PC, Steady
 *   Hands half; the illegal act 'hack', a quiet noise of radius 1 like panel work): it tells the manager's part of the
 *   code, or the whole code, into `State.codesKnown`, and the time-lock schedule (`pcHacked`).
 * - **The time lock** (decision 77): it holds the vault outside its window, so codes and the card work only in it; it
 *   doesn't open the vault (the armoured car's couriers opening it for their delivery is M6's). As each crew phase
 *   begins outside the window, a shut vault door that isn't locked locks again (`timeLockShut`), whatever unlocked it,
 *   and the code entered so far is cleared; an open one stays open until shut.
 * - **The drill and thermite** (§15.3, §12.2): `drill { crew, at }` (1 action, the illegal act 'drill', from beside the
 *   vault door, or at a wall of deposit boxes) leaves the drill working there (`State.devices`; `takeDrill` takes the
 *   kit back, finished or not, 1 action in reach), `thermite { crew, door }` (1 action, the illegal act 'plantCharge',
 *   the charge used up) burns the vault door. Each works one phase every world phase (`devices` step), a loud noise
 *   where it stands (the key graph's radius: 6, or Three Keys' 9); the vault door is breached after the key graph's
 *   phases (the drill: 3, 5, 8 or 12 by class; thermite: 3, 5 on Class III; half as long again in Three Keys), a
 *   deposit wall after `rules.depositWallPhases` (4). Thermite can't be stopped. A drill **jams** (15%,
 *   `rules.drillJamChance`) as each crew phase begins, the last roll there (after the lapses and panic), rolled with its
 *   odds shown (the end-of-turn preview stops there);
 *   fixing it takes 1 action in reach (`fixDrill`), and Steady Hands in reach of it as the crew phase begins fixes it
 *   for free and keeps it from jamming then (decision 80). A running drill or charge is major evidence ('drill').
 *   Scorched loot and fire on the tile are M4's; heat ticks are M3's; the Silent and Beast drills are planning's (M6).
 * - **The sensors** (§9.1): drilling or burning a Class II+ vault starts the seismic carrier (`rules.seismicCountdown`,
 *   4); on Class III, a crew member stepping into the vault outside the time-lock window starts the motion carrier (2).
 *   Both are wired: the dead alarm panel kills them (carriers.ts), and so does cutting the sensors at the console, in
 *   their countdown too; the motion carrier also stops once the time-lock window opens (§9.1's counters).
 * - **Deposit boxes** (§15.3, decision 78): `worldFromBank` splits the deposit loot into boxes (Light, $5k) and the
 *   wall's haul (Heavy, the whole). `interact … pick` at a wall of boxes (lockpick set, `rules.lockpickActions` (2)
 *   actions of work, Steady Hands half; the illegal act 'lockpick', a quiet noise of radius 1) opens the next box in the
 *   room: its jewels lie there to take. Drilling the wall gives the haul instead: the two exclude each other.
 */

/** What works on a lock across world phases: a drill, or a thermite charge. */
export interface Device {
    id: string;
    kind: 'drill' | 'thermite';
    /** The door or the object (a wall of deposit boxes) it works on. */
    at: string;
    /** Where it stands: where its crew member set it up. */
    pos: Pos;
    /** Who set it up. */
    crew: string;
    /** World phases worked so far, of `needed`. */
    done: number;
    needed: number;
    /** A drill that jammed: it does nothing until fixed. */
    jammed: boolean;
    /** Its noise's radius each phase (the key graph's; 6 at a deposit wall). */
    noise: number;
}

export const DRILL = 'drill';
export const THERMITE = 'thermite';

declare module '../core/types' {
    interface State {
        /** Drills and thermite at work (§15.3). */
        devices: Device[];
        /** The parts of the vault code the crew knows (the manager's PC). */
        codesKnown: CodePart[];
    }
    interface Rules {
        /** Actions of hacking that open the manager's PC (§7.2); Steady Hands halves them. */
        pcActions: number;
        /** Actions of lockpicking a lock or a deposit box takes (§7.2, §12.2); Steady Hands halves them. */
        lockpickActions: number;
        /** A drill's chance to jam as each crew phase begins (§15.3). */
        drillJamChance: number;
        /** World phases a drill takes through a wall of deposit boxes (§15.3). */
        depositWallPhases: number;
        /** The seismic sensor's countdown (§9.1: "shown before drilling, for example 4"). */
        seismicCountdown: number;
        /** Actions of hacking that cut the vault's sensors at the console's wiring (§7.2: 4); Steady Hands halves them. */
        sensorActions: number;
    }
    interface ObjectState {
        /** At a vault console: its sensors' wiring is cut (§9.1). */
        sensorsCut?: boolean;
    }
    interface CommandMap {
        /** Set the drill up at the vault door beside them, or at a wall of deposit boxes in reach (`at`): 1 action. */
        drill: { crew: string; at: string };
        /** Set a thermite charge burning on the vault door beside them: 1 action. */
        thermite: { crew: string; door: string };
        /** Fix the jammed drill `device` in reach: 1 action. */
        fixDrill: { crew: string; device: string };
        /** Take the drill `device` in reach back into the kit (1 action): finished, or stopped with its work lost. */
        takeDrill: { crew: string; device: string };
    }
    interface EventMap {
        /** The manager's PC told the crew its part of the code (`part`, or null for none) and the time-lock window. */
        pcHacked: { crew: string; object: string; part: CodePart | null; window: TimeWindow | null };
        /** Work on the PC or a deposit box: `progress` of `needed` actions. */
        lockWorked: { crew: string; at: string; progress: number; needed: number };
        /** A deposit box opened: its jewels (`loot`) lie there to take. */
        boxOpened: { crew: string; object: string; loot: string };
        deviceSet: { crew: string; device: string; kind: Device['kind']; at: string };
        /** A drill or a charge worked a phase: `done` of `needed`. */
        deviceWorked: { device: string; kind: Device['kind']; done: number; needed: number };
        drillJammed: { device: string };
        /** A jammed drill fixed: by a crew member's action, or for free by Steady Hands in reach (`free`). */
        drillFixed: { device: string; crew: string; free: boolean };
        /** The vault door is through: breached for good. */
        vaultBreached: { door: string; by: Device['kind'] };
        /** A wall of deposit boxes is drilled open: the haul (`loot`) lies there to take. */
        wallDrilled: { object: string; loot: string };
        /** A drill was taken back into a crew member's kit. */
        drillTaken: { crew: string; device: string };
        /** The vault's sensors were cut at the console's wiring. */
        sensorsCut: { crew: string; console: string };
    }
}

registerRuleDefaults({ pcActions: 2, lockpickActions: 2, drillJamChance: 0.15, depositWallPhases: 4, seismicCountdown: 4, sensorActions: 4 });

registerStateInit('vault', (_world, state) => {
    state.devices = [];
    state.codesKnown = [];
});

const carries = (member: DeepReadonly<CrewState>, item: string): boolean => member.loadout.items.includes(item);

/** The work one action does on a job of `actions` (Steady Hands: two actions' worth). */
const workStep = (member: DeepReadonly<CrewState>, actions: number): number => Math.ceil(actions / workActions(member, actions));

/** Work done on an object so far (`ObjectState.progress`). */
const progressOn = (state: DeepReadonly<State>, id: string): number => (Object.hasOwn(state.objects, id) ? state.objects[id]!.progress ?? 0 : 0);

/** Adds one action of work on an object toward `needed`; whether that finished it (and the work starts over). */
function work(ctx: Ctx, member: CrewState, object: DeepReadonly<WorldObject>, needed: number): boolean {
    const progress = Math.min(needed, progressOn(ctx.state, object.id) + workStep(member, needed));
    ctx.state.objects[object.id] = { ...ctx.state.objects[object.id], progress };
    ctx.emit({ type: 'lockWorked', crew: member.id, at: object.id, progress, needed });
    return progress >= needed;
}

// ---------------------------------------------------------------------------------------------------------- The console

/** Why the crew member can't unlock the vault at its console now, or undefined. */
function consoleBlocked(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, console: string): string | undefined {
    const vault = vaultLock(world);
    if (!vault) return 'This console opens nothing';
    const shut = vaultShut(world, state);
    if (shut) return shut;
    if (vault.social.kind === 'threeKeys') {
        const cards = vault.social.keycard;
        if (!member.keycards.some(id => cards.includes(id))) return `${member.name} has no keycard that opens the vault`;
        // A bank without a CCTV desk has no CCTV room to disable.
        return !cctvDesk(world) || cctvControlled(world, state) ? undefined : 'The vault answers only while the crew holds the CCTV room';
    }
    if (vault.social.kind !== 'code') return 'This console opens nothing';
    if (!state.codesKnown.length) return 'The crew knows no part of the code';
    return state.codesKnown.some(p => !entered(state, console).includes(p)) ? undefined : 'Every part of the code the crew knows is in';
}

/** Whether the vault's sensors are cut at a console's wiring. */
export const sensorsCut = (world: ReadonlyWorld, state: DeepReadonly<State>): boolean =>
    world.objects.some(o => o.kind === 'vaultConsole' && Object.hasOwn(state.objects, o.id) && state.objects[o.id]!.sensorsCut === true);

registerInteraction('vaultConsole', {
    sensors: {
        cost: () => 1,
        illegal: 'hack',
        whyNot(world, state, member) {
            if (!sensors(world).length) return 'The vault has no sensors';
            if (sensorsCut(world, state)) return 'The sensors are cut already';
            return carries(member, HACKING_KIT) ? undefined : `${member.name} has no hacking kit`;
        },
        run(ctx, member, object) {
            makeNoise(ctx, 'panelWork', member.pos, `sensors ${member.id}`);
            if (!work(ctx, member, object, ctx.world.rules.sensorActions)) return;
            ctx.state.objects[object.id] = { ...ctx.state.objects[object.id], sensorsCut: true };
            ctx.emit({ type: 'sensorsCut', crew: member.id, console: object.id });
        }
    },
    unlock: {
        cost: () => 1,
        whyNot: (world, state, member, object) => consoleBlocked(world, state, member, object.id),
        run(ctx, member, object) {
            const vault = vaultLock(ctx.world)!;
            if (vault.social.kind === 'threeKeys') {
                unlockVault(ctx, 'keycard', member.id);
                return;
            }
            for (const part of ctx.state.codesKnown) {
                if (entered(ctx.state, object.id).includes(part)) continue;
                ctx.emit({ type: 'codeEntered', crew: member.id, npc: null, console: object.id, part });
                enterPart(ctx, object.id, part, member.id);
            }
        }
    }
});

// ---------------------------------------------------------------------------------------------------------- The manager's PC

registerInteraction('managerPc', {
    hack: {
        cost: () => 1,
        illegal: 'hack',
        whyNot(world, state, member, object) {
            if (!carries(member, HACKING_KIT)) return `${member.name} has no hacking kit`;
            return progressOn(state, object.id) >= world.rules.pcActions ? 'The PC has told all it knows' : undefined;
        },
        run(ctx, member, object) {
            const { world, state } = ctx;
            makeNoise(ctx, 'panelWork', member.pos, `pc ${member.id}`);
            if (!work(ctx, member, object, world.rules.pcActions)) return;
            const part = partOf(world, 'manager') ?? null;
            if (part && !state.codesKnown.includes(part)) state.codesKnown = [...state.codesKnown, part].sort();
            const span = vaultLock(world)?.timeLock;
            ctx.emit({ type: 'pcHacked', crew: member.id, object: object.id, part, window: span ? { from: span.from, until: span.until } : null });
        }
    }
});

// ---------------------------------------------------------------------------------------------------------- The time lock

// Outside the window, a shut vault door locks again as a crew phase begins (decision 77).
registerWorldHook('crewPhase', 'vault.timeLock', ctx => {
    const { world, state } = ctx;
    const vault = vaultLock(world);
    if (!vault?.timeLock || timeLockOpen(world, state.turn) || doorStatus(world, state, vault.target) !== 'closed') return;
    state.doors[vault.target] = { ...state.doors[vault.target], status: 'locked' };
    // Relocked, the vault takes its code afresh.
    for (const o of world.objects) {
        if (o.kind !== 'vaultConsole' || !Object.hasOwn(state.objects, o.id)) continue;
        const now = { ...state.objects[o.id] };
        delete now.codes;
        state.objects[o.id] = now;
    }
    ctx.emit({ type: 'timeLockShut', door: vault.target });
});

// ---------------------------------------------------------------------------------------------------------- Sensors

/** The vault's sensors (§9.1), from its technical key: seismic on Class II+, motion on Class III. */
const sensors = (world: ReadonlyWorld): readonly string[] => {
    const technical = vaultLock(world)?.technical;
    return technical?.kind === 'drill' ? technical.sensors : [];
};

// Stepping into a Class III vault outside its window starts the motion sensor (§9.1), at the sensor hung there.
registerMoveHook('vault', {
    step(ctx, _member, path, index) {
        const { world, state } = ctx;
        const vault = vaultLock(world), at = path[index]!;
        if (!vault || !sensors(world).includes('motion') || sensorsCut(world, state) || tileAt(world, at)?.room !== vault.room || (vault.timeLock && timeLockOpen(world, state.turn))) return;
        const sensor = world.objects.find(o => o.kind === 'motionSensor' && o.room === vault.room);
        raiseCarrier(ctx, { kind: 'motionSensor', source: sensor?.id ?? vault.target, pos: sensor ? { ...sensor.pos } : { x: at.x, y: at.y } });
    }
});

// ---------------------------------------------------------------------------------------------------------- Deposit boxes

/** The deposit boxes in a room, by loot id: the shut ones are not in `State.loot` yet. */
const boxesIn = (world: ReadonlyWorld, room: string | undefined): string[] =>
    world.objects.filter(o => o.kind === 'loot' && o.loot?.behind === 'depositBox' && o.room === room).map(o => o.id).sort();

/** The haul of the deposit wall in a room, if it has one. */
const haulIn = (world: ReadonlyWorld, room: string | undefined): string | undefined =>
    world.objects.find(o => o.kind === 'loot' && o.loot?.behind === 'depositWall' && o.room === room)?.id;

/** Why a wall of deposit boxes can't be picked or drilled now, or undefined. */
function wallBlocked(world: ReadonlyWorld, state: State, object: DeepReadonly<WorldObject>, how: 'pick' | 'drill'): string | undefined {
    const haul = haulIn(world, object.room), boxes = boxesIn(world, object.room);
    if (!haul) return 'There are no boxes to open here';
    if (Object.hasOwn(state.loot, haul)) return 'The wall is drilled open';
    if (state.devices.some(d => d.done < d.needed && world.objects.find(o => o.id === d.at)?.room === object.room)) return 'A drill is on the wall';
    const opened = boxes.filter(id => Object.hasOwn(state.loot, id));
    if (how === 'drill') return opened.length ? 'Boxes are open: pick the rest' : undefined;
    return opened.length === boxes.length ? 'Every box here is open' : undefined;
}

registerInteraction('depositBoxes', {
    pick: {
        cost: () => 1,
        illegal: 'lockpick',
        whyNot: (world, state, member, object) => (carries(member, LOCKPICK) ? wallBlocked(world, state, object, 'pick') : `${member.name} has no lockpick set`),
        run(ctx, member, object) {
            const { world, state } = ctx;
            makeNoise(ctx, 'lockpick', member.pos, `lockpick ${member.id}`);
            if (!work(ctx, member, object, world.rules.lockpickActions)) return;
            state.objects[object.id] = { ...state.objects[object.id], progress: 0 };
            const box = boxesIn(world, object.room).find(id => !Object.hasOwn(state.loot, id))!;
            state.loot[box] = { holder: null, pos: { x: object.pos.x, y: object.pos.y }, taken: false, dyePack: false, inspected: false, ruined: false };
            ctx.emit({ type: 'boxOpened', crew: member.id, object: object.id, loot: box });
        }
    }
});

// ---------------------------------------------------------------------------------------------------------- Drill and thermite

/** What a device would work on: the vault door (beside it) or a wall of deposit boxes (in reach), and its phases; or why not. */
function deviceTarget(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, kind: Device['kind'], at: string): { needed: number; noise: number; vault: boolean } | string {
    const vault = vaultLock(world);
    if (vault && at === vault.target) {
        if (!besideDoor(world, world.doors[at]!, member.pos)) return `${member.name} isn't beside the vault door`;
        if (doorStatus(world, state, at) !== 'locked') return 'The vault isn\'t locked';
        if (state.devices.some(d => d.at === at && d.done < d.needed)) return 'Something is already at work on the door';
        const key = kind === 'drill' ? vault.technical : vault.violent;
        if (key.kind !== 'drill' && key.kind !== 'thermite') throw new InvariantError(`The vault's ${kind} key is '${key.kind}'`);
        return { needed: key.phases, noise: key.noise, vault: true };
    }
    const object = world.objects.find(o => o.id === at);
    if (kind !== 'drill' || object?.kind !== 'depositBoxes') return kind === 'drill' ? 'There is nothing to drill there' : 'Thermite is for the vault door';
    if (!inReach(world, state, member.pos, object.pos)) return `${member.name} can't reach the wall`;
    return wallBlocked(world, state, object, 'drill') ?? { needed: world.rules.depositWallPhases, noise: NOISES.drill.min, vault: false };
}

function setDevice(ctx: Ctx, member: CrewState, kind: Device['kind'], at: string): void {
    const { world, state } = ctx;
    const target = deviceTarget(world, state, member, kind, at) as { needed: number; noise: number; vault: boolean };
    member.loadout.items.splice(member.loadout.items.indexOf(kind === 'drill' ? DRILL : THERMITE), 1);
    const device: Device = { id: newId(state, kind), kind, at, pos: { x: member.pos.x, y: member.pos.y }, crew: member.id, done: 0, needed: target.needed, jammed: false, noise: target.noise };
    state.devices.push(device);
    ctx.emit({ type: 'deviceSet', crew: member.id, device: device.id, kind, at });
    // Drilling or burning starts the seismic sensor (§9.1), shown with the action that starts it.
    if (target.vault && sensors(world).includes('seismic') && !sensorsCut(world, state)) {
        raiseCarrier(ctx, { kind: 'seismicSensor', source: at, pos: { ...device.pos }, countdown: world.rules.seismicCountdown });
    }
}

registerAction('drill', {
    whyNot(world, state, cmd) {
        const member = crewMember(state, cmd.crew);
        const lack = lacksActions(member, 1) ?? (carries(member, DRILL) ? undefined : `${member.name} has no drill`);
        if (lack) return lack;
        const target = deviceTarget(world, state, member, 'drill', cmd.at);
        return typeof target === 'string' ? target : undefined;
    },
    candidates(world, _state, member) {
        if (!carries(member, DRILL)) return [];
        const vault = vaultLock(world);
        const walls = world.objects.filter(o => o.kind === 'depositBoxes').map(o => o.id);
        return [...(vault ? [vault.target] : []), ...walls].map(at => ({ type: 'drill' as const, crew: member.id, at }));
    },
    cost: () => 1,
    illegal: () => ({ act: 'drill' }),
    run: (ctx, member, cmd) => setDevice(ctx, member, 'drill', cmd.at)
});

registerAction('thermite', {
    whyNot(world, state, cmd) {
        const member = crewMember(state, cmd.crew);
        const lack = lacksActions(member, 1) ?? (carries(member, THERMITE) ? undefined : `${member.name} has no thermite`);
        if (lack) return lack;
        const target = deviceTarget(world, state, member, 'thermite', cmd.door);
        return typeof target === 'string' ? target : undefined;
    },
    candidates(world, _state, member) {
        const vault = vaultLock(world);
        return vault && carries(member, THERMITE) ? [{ type: 'thermite', crew: member.id, door: vault.target }] : [];
    },
    cost: () => 1,
    illegal: () => ({ act: 'plantCharge' }),
    run: (ctx, member, cmd) => setDevice(ctx, member, 'thermite', cmd.door)
});

registerAction('fixDrill', {
    whyNot(world, state, cmd) {
        const member = crewMember(state, cmd.crew);
        const lack = lacksActions(member, 1);
        if (lack) return lack;
        const device = state.devices.find(d => d.id === cmd.device);
        if (!device) return 'There is no drill there';
        if (!device.jammed) return 'The drill isn\'t jammed';
        return inReach(world, state, member.pos, device.pos) ? undefined : `${member.name} can't reach the drill`;
    },
    candidates: (_world, state, member) => state.devices.filter(d => d.jammed).map(d => ({ type: 'fixDrill' as const, crew: member.id, device: d.id })),
    cost: () => 1,
    illegal: () => ({ act: 'drill' }),
    run(ctx, member, cmd) {
        ctx.state.devices.find(d => d.id === cmd.device)!.jammed = false;
        ctx.emit({ type: 'drillFixed', device: cmd.device, crew: member.id, free: false });
    }
});

registerAction('takeDrill', {
    whyNot(world, state, cmd) {
        const member = crewMember(state, cmd.crew);
        const lack = lacksActions(member, 1);
        if (lack) return lack;
        const device = state.devices.find(d => d.id === cmd.device);
        if (device?.kind !== 'drill') return 'There is no drill there';
        return inReach(world, state, member.pos, device.pos) ? undefined : `${member.name} can't reach the drill`;
    },
    candidates: (_world, state, member) => state.devices.filter(d => d.kind === 'drill').map(d => ({ type: 'takeDrill' as const, crew: member.id, device: d.id })),
    cost: () => 1,
    run(ctx, member, cmd) {
        ctx.state.devices = ctx.state.devices.filter(d => d.id !== cmd.device);
        member.loadout.items.push(DRILL);
        ctx.emit({ type: 'drillTaken', crew: member.id, device: cmd.device });
    }
});

/** A crew member with Steady Hands in reach of a device, first in the crew's order (§7.2: fixes a jammed drill for free). */
export const steadyHand = (world: ReadonlyWorld, state: State, device: DeepReadonly<Device>): CrewState | undefined =>
    state.crew.find(c => hasTrait(c, 'steadyHands') && inReach(world, state, c.pos, device.pos));

// Each device works a phase in the world phase it runs in, a loud noise where it stands; the last one gets through.
registerWorldHook('devices', 'vault.devices', ctx => {
    const { world, state } = ctx;
    for (const device of [...state.devices]) {
        if (device.jammed || device.done >= device.needed) continue;
        device.done++;
        ctx.emit({ type: 'deviceWorked', device: device.id, kind: device.kind, done: device.done, needed: device.needed });
        makeNoise(ctx, device.kind, device.pos, `${device.kind} ${device.id}`, device.noise);
        if (device.done < device.needed) continue;
        // A finished drill stays where it worked until taken back; a charge is burnt out.
        if (device.kind === 'thermite') state.devices.splice(state.devices.indexOf(device), 1);
        if (Object.hasOwn(world.doors, device.at)) {
            state.doors[device.at] = { ...state.doors[device.at], status: 'breached' };
            ctx.emit({ type: 'vaultBreached', door: device.at, by: device.kind });
            continue;
        }
        const object = world.objects.find(o => o.id === device.at)!, haul = haulIn(world, object.room)!;
        state.loot[haul] = { holder: null, pos: { x: object.pos.x, y: object.pos.y }, taken: false, dyePack: false, inspected: false, ruined: false };
        ctx.emit({ type: 'wallDrilled', object: object.id, loot: haul });
    }
}, { order: 20 });

// As the crew phase begins: Steady Hands in reach fixes a jammed drill for free and keeps a running one from jamming;
// every other running drill rolls its jam, its odds shown (the end-of-turn preview stops there). The last hook of the
// step (after the lapses and the panic reactions), so a world phase's preview only ever stops at rolls at its very end.
registerWorldHook('crewPhase', 'vault.jams', ctx => {
    const { world, state } = ctx;
    for (const device of state.devices) {
        if (device.kind !== 'drill' || device.done >= device.needed) continue;
        const hand = steadyHand(world, state, device);
        if (hand) {
            if (device.jammed) {
                device.jammed = false;
                ctx.emit({ type: 'drillFixed', device: device.id, crew: hand.id, free: true });
            }
            continue;
        }
        if (device.jammed || !ctx.dice.odds('drill', world.rules.drillJamChance, `jam ${device.id}`)) continue;
        device.jammed = true;
        ctx.emit({ type: 'drillJammed', device: device.id });
    }
}, { order: 120 });

// A drill or a charge at work is major evidence (§8.10 "a drill").
registerEvidenceSource('devices', (_world, state) => state.devices.map((d): Evidence => ({ id: `drill:${d.id}`, kind: 'drill', tiles: [{ x: d.pos.x, y: d.pos.y }] })));

registerEvents({
    pcHacked: { undoBlocking: true },
    lockWorked: { undoBlocking: false },
    boxOpened: { undoBlocking: false },
    deviceSet: { undoBlocking: false },
    deviceWorked: { undoBlocking: true },
    drillJammed: { undoBlocking: true },
    drillFixed: { undoBlocking: false },
    vaultBreached: { undoBlocking: true },
    wallDrilled: { undoBlocking: true },
    drillTaken: { undoBlocking: false },
    sensorsCut: { undoBlocking: false }
});

// Cutting the sensors at the console kills their carriers, running ones too; the time-lock window stops the motion
// sensor's (§9.1's counters).
registerCarrierCheck('vaultSensors', (world, state, carrier) => {
    if (carrier.kind !== 'seismicSensor' && carrier.kind !== 'motionSensor') return null;
    if (sensorsCut(world, state)) return { halt: 'countered', why: 'sensors cut' };
    return carrier.kind === 'motionSensor' && vaultLock(world)?.timeLock && timeLockOpen(world, state.turn) ? { halt: 'countered', why: 'time lock' } : null;
});
