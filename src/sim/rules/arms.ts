import { registerCommandHook } from '../core/engine';
import { samePos } from '../core/grid';
import { sortedIds } from '../core/json';
import { registerStateCheck } from '../core/save';
import { crewMember, registerCrewInit, registerNpcInit } from '../core/state';
import type { CrewState, DeepReadonly, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { itemDef } from '../data/items';
import {
    BRACEABLE, DEFAULT_NPC_GUN, isThrowable, loadsOf, NPC_GUN, NPC_SPARE_MAGS, SPARE_MAGS, SPARES_OF, THROWABLES, weaponDef, type WeaponId
} from '../data/weapons';
import { inReach, lacksActions, registerAction } from './actions/act';
import { weaponsInHand } from './command';
import { personOf } from './npc/walk';
import type { Shot } from './shot';

/*
 * What the crew fights with (GAME_DESIGN §6.3, §11.11, §12.1, §12.2; implementation plan M3-02, decisions 93–95):
 *
 * - **The drawn weapon** (`Arms.drawn`) is the weapon item a crew member attacks with: at the start, the primary they
 *   carry unpacked, else their first sidearm, else none (unarmed). Threat still comes from every weapon in hand
 *   (rules/command.ts); only one is fired.
 * - **Rounds** (`Arms.guns`, by weapon item): the load in it (a row of the weapon table: the pump shotgun's buckshot or
 *   slugs), the rounds left in the magazine and the spare magazines (3 each, §11.11; the taser's 3 cartridges are all
 *   it has). An attack takes its bullets from the magazine; an empty gun still looks like a gun (§11.11 "Bluffing").
 * - **Swap** (`swap { crew, to }`): draws another weapon carried unpacked; free once per turn, 1 action after that.
 * - **Reload** (`reload { crew, load? }`): 1 action, a spare magazine into the drawn weapon (the pump: shells or slugs);
 *   what was left in the old one is lost (decision 94).
 * - **Scavenge** (`scavenge { crew, npc, take }`, §11.11): 1 action, in reach of a downed NPC (out cold, dead or tied):
 *   take its weapon with what is left in the magazine (`weapon`: not one the crew member already carries), or its spare
 *   magazines for a weapon of the same kind they carry (`ammo`). Rifling a body is the illegal act 'pickPocket'.
 * - **Hand over a magazine** (`handMag { crew, to }`): 1 action, a spare of the drawn weapon to a teammate in reach who
 *   carries the same weapon.
 * - **Brace** (`brace { crew }`, §6.3): the DMR or LMG drawn; their last action (what is left, at least 1). Braced until
 *   they move: no moving penalty, the LMG's braced recoil (rules/shot.ts `shotArcs`).
 * - **Moving** (`Arms.moved`): the turn a crew member last moved, for the moving penalty (§11.2); moving ends a brace.
 * - **Throwables** (`Arms.throwables`): flashbangs and smoke left (2 per kit item, §12.2), rules/actions/throwables.ts.
 * - **NPCs' guns** (`NpcState.ammo`): an armed NPC's weapon (guards and the off-duty cop: a pistol) with a full magazine
 *   and 2 spares (decision 95). A frisk takes the weapon (`armed`), not the magazines on the belt.
 */

/** One weapon's rounds. */
export interface Gun {
    /** The row of the weapon table it fires: the item's own, or the pump shotgun's slugs. */
    load: WeaponId;
    /** Rounds left in the magazine. */
    loaded: number;
    /** Spare magazines. */
    spare: number;
}

/** A Watch wedge (§11.8): set in the crew phase, held through the world phase after it. */
export interface Watch {
    /** The tile the wedge is aimed at (its middle line). */
    at: Pos;
    /** Its width, whole degrees. */
    arc: number;
    /** The tile leaned out to, if they lean (the wedge is traced from it). */
    lean: Pos | null;
    /** The turn it was set, whose world phase it watches. */
    turn: number;
}

export interface Arms {
    /** The weapon item they fire, or null: unarmed. */
    drawn: string | null;
    /** Rounds by weapon item, for every weapon carried (packed ones too). */
    guns: Record<string, Gun>;
    /** Flashbangs and smoke grenades left, by item. */
    throwables: Record<string, number>;
    /** The turn of this turn's free swap, or null. */
    swapped: number | null;
    /** The turn they last moved, or null (the moving penalty, §11.2). */
    moved: number | null;
    /** On the bipod until they move (§6.3 Brace). */
    braced: boolean;
    /** Their Watch wedge, until the next crew phase or its volley (§11.8), or null. */
    watch: Watch | null;
    /**
     * The shot an attack set up and fires as the action ends (rules/actions/attack.ts, decision 97): only ever set inside
     * one command, null between them (a preview stopped at the bullets shows it).
     */
    aiming: { shot: Shot; mode: 'attack' | 'watch' | 'suppress' | 'reaction' } | null;
}

/** What a scavenge takes off a body. */
export type Scavenge = 'weapon' | 'ammo';

declare module '../core/types' {
    interface CrewState {
        arms: Arms;
    }
    interface NpcState {
        /** The rounds an armed NPC carries for its gun (decision 95), or null: it never had one. */
        ammo: { weapon: WeaponId; loaded: number; spare: number } | null;
    }
    interface CommandMap {
        /** Draw another weapon carried unpacked (free once per turn, then 1 action). */
        swap: { crew: string; to: string };
        /** A spare magazine into the drawn weapon (1 action); `load` picks the pump shotgun's shells or slugs. */
        reload: { crew: string; load?: string };
        /** Take a downed NPC's weapon or its spare magazines (1 action). */
        scavenge: { crew: string; npc: string; take: Scavenge };
        /** Hand a spare magazine of the drawn weapon to a teammate in reach (1 action). */
        handMag: { crew: string; to: string };
        /** Brace the DMR or LMG on its bipod: their last action. */
        brace: { crew: string };
    }
    interface EventMap {
        swapped: { crew: string; to: string; free: boolean };
        reloaded: { crew: string; weapon: string; load: string; spare: number };
        scavenged: { crew: string; npc: string; take: Scavenge; weapon: string; rounds: number };
        magHanded: { crew: string; to: string; weapon: string };
        braced: { crew: string; weapon: string };
    }
}

/** A row's magazine. */
const magOf = (load: WeaponId): number => weaponDef(load).mag;

/** A fresh gun for a weapon item: its first load, a full magazine and its spares. */
function freshGun(item: string): Gun {
    const load = loadsOf(item)[0]!;
    return { load, loaded: magOf(load), spare: Object.hasOwn(SPARES_OF, item) ? SPARES_OF[item]! : SPARE_MAGS };
}

/** Whether an item is a weapon that fires (anything with a row of the weapon table). */
export const isGun = (item: string): boolean => loadsOf(item).length > 0;

/** The weapon a crew member starts with drawn: the primary carried unpacked, else the first sidearm, else none. */
function startingDrawn(member: DeepReadonly<CrewState>): string | null {
    const guns = member.loadout.items.filter(isGun);
    return guns.find(id => itemDef(id).slot === 'primary') ?? guns[0] ?? null;
}

registerCrewInit('weapons', (_world, _start, member) => {
    const guns: Record<string, Gun> = {}, throwables: Record<string, number> = {};
    for (const id of [...member.loadout.items, ...member.loadout.packed]) {
        if (isGun(id) && !Object.hasOwn(guns, id)) guns[id] = freshGun(id);
        if (isThrowable(id)) throwables[id] = (Object.hasOwn(throwables, id) ? throwables[id]! : 0) + THROWABLES[id].count;
    }
    member.arms = { drawn: startingDrawn(member), guns, throwables, swapped: null, moved: null, braced: false, watch: null, aiming: null };
});

/** The gun an NPC carries (§12.3): by role, a pistol by default. */
export const npcGun = (world: ReadonlyWorld, npcId: string): WeaponId => {
    const role = personOf(world, npcId).role;
    return Object.hasOwn(NPC_GUN, role) ? NPC_GUN[role]! : DEFAULT_NPC_GUN;
};

registerNpcInit('weapons', (world, person, npc) => {
    // After the hostage init ('hostage' < 'weapons'), which gives the weapon.
    const gun = npcGun(world, person.id);
    npc.ammo = npc.armed === null ? null : { weapon: gun, loaded: magOf(gun), spare: NPC_SPARE_MAGS };
});

registerStateCheck('arms', raw => {
    const state = raw as unknown as State;
    if (!Array.isArray(state.crew)) return 'there is no crew to check the arms of';
    for (const c of state.crew) {
        if (!c.arms) return `${c.id} has no arms`;
        if (c.arms.aiming !== null) return `${c.id} has a shot set up between commands`;
        if (c.arms.drawn !== null && (!Object.hasOwn(c.arms.guns, c.arms.drawn) || !c.loadout.items.includes(c.arms.drawn))) return `${c.id} has '${c.arms.drawn}' drawn but doesn't carry it unpacked`;
        for (const id of sortedIds(c.arms.guns)) if (!loadsOf(id).includes(c.arms.guns[id]!.load)) return `${c.id}'s ${id} is loaded with '${c.arms.guns[id]!.load}'`;
    }
    return undefined;
});

/** The weapon a crew member would fire now and its rounds, or why they can't fire one. */
export function firing(member: DeepReadonly<CrewState>): { item: string; gun: DeepReadonly<Gun> } | string {
    const item = member.arms.drawn;
    if (item === null) return `${member.name} has no weapon drawn`;
    if (!weaponsInHand(member).includes(item)) return `${member.name} can't fire the ${item} with their hands full`;
    return { item, gun: member.arms.guns[item]! };
}

/** Whether a crew member moved this turn (the moving penalty, §11.2). */
export const movedThisTurn = (state: DeepReadonly<State>, member: DeepReadonly<CrewState>): boolean => member.arms.moved === state.turn;

// Moving (any command that changed where they stand) sets the moving penalty and ends a brace (§6.3).
registerCommandHook('arms.moved', (ctx, _cmd, _events, before) => {
    for (const member of ctx.state.crew) {
        const was = before.crew.find(c => c.id === member.id);
        if (!was || samePos(was.pos, member.pos)) continue;
        member.arms.moved = ctx.state.turn;
        member.arms.braced = false;
    }
});

// ---------------------------------------------------------------------------------------------------------- Swap

/** What a swap costs now: free once a turn (§6.3). */
const swapCost = (state: DeepReadonly<State>, member: DeepReadonly<CrewState>): number => (member.arms.swapped === state.turn ? 1 : 0);

function swapBlocked(state: DeepReadonly<State>, member: DeepReadonly<CrewState>, to: string): string | undefined {
    if (!isGun(to) || !member.loadout.items.includes(to)) return `${member.name} has no ${to} to hand`;
    if (member.arms.drawn === to) return `${member.name} has the ${to} drawn already`;
    return lacksActions(member, swapCost(state, member));
}

registerAction('swap', {
    whyNot: (_world, state, cmd) => swapBlocked(state, crewMember(state, cmd.crew), cmd.to),
    candidates: (_world, _state, member) => member.loadout.items.filter(id => isGun(id) && id !== member.arms.drawn).map(to => ({ type: 'swap', crew: member.id, to })),
    cost: (_world, state, cmd) => swapCost(state, crewMember(state, cmd.crew)),
    run(ctx, member, cmd) {
        const free = member.arms.swapped !== ctx.state.turn;
        member.arms.drawn = cmd.to;
        if (free) member.arms.swapped = ctx.state.turn;
        ctx.emit({ type: 'swapped', crew: member.id, to: cmd.to, free });
    }
}, { perceive: false });

// ---------------------------------------------------------------------------------------------------------- Reload

function reloadBlocked(member: DeepReadonly<CrewState>, load: string | undefined): string | undefined {
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    const item = member.arms.drawn;
    if (item === null) return `${member.name} has no weapon drawn`;
    const gun = member.arms.guns[item]!, to = load ?? gun.load;
    if (!loadsOf(item).includes(to as WeaponId)) return `The ${item} doesn't take ${to}`;
    if (gun.spare < 1) return `${member.name} has no spare magazine for the ${item}`;
    if (to === gun.load && gun.loaded >= magOf(gun.load)) return `The ${item} is loaded`;
    return undefined;
}

registerAction('reload', {
    whyNot: (_world, state, cmd) => reloadBlocked(crewMember(state, cmd.crew), cmd.load),
    candidates: (_world, _state, member) => {
        const item = member.arms.drawn;
        if (item === null) return [];
        const gun = member.arms.guns[item]!;
        return loadsOf(item).map(load => (load === gun.load ? { type: 'reload' as const, crew: member.id } : { type: 'reload' as const, crew: member.id, load }));
    },
    cost: () => 1,
    run(ctx, member, cmd) {
        const item = member.arms.drawn!, gun = member.arms.guns[item]!, load = (cmd.load ?? gun.load) as WeaponId;
        gun.load = load;
        gun.loaded = magOf(load);
        gun.spare--;
        ctx.emit({ type: 'reloaded', crew: member.id, weapon: item, load, spare: gun.spare });
    }
});

// ---------------------------------------------------------------------------------------------------------- Scavenge

/** Statuses of an NPC down for good enough to be searched: out cold, dead or tied (§11.11 "a downed guard"). */
export const SEARCHABLE: ReadonlySet<string> = new Set(['unconscious', 'dead', 'tied']);

/** Why a crew member can't take this off the NPC now, or undefined. */
export function scavengeBlocked(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, npcId: string, take: Scavenge): string | undefined {
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    if (member.dragging !== null) return `${member.name}'s hands are full`;
    const npc = state.npcs.find(n => n.id === npcId);
    if (!npc) return `No one called '${npcId}'`;
    if (!SEARCHABLE.has(npc.status) || npc.stashed !== null || state.crew.some(c => c.dragging === npcId)) return 'Only someone down can be searched';
    // A hidden weapon (an off-duty cop's) is no one's to see until a frisk finds it (§10.6): the same answer as none.
    if (!npc.ammo || npc.armed === 'hidden') return 'They carry no weapon';
    if (!inReach(world, state, member.pos, npc.pos)) return `${member.name} can't reach them from here`;
    const item = npc.ammo.weapon;
    if (take === 'weapon') {
        if (npc.armed === null) return 'Their weapon is gone';
        if (member.loadout.items.includes(item) || member.loadout.packed.includes(item)) return `${member.name} carries a ${item} already: take the magazines`;
        return undefined;
    }
    if (npc.ammo.spare < 1) return 'They have no magazines left';
    if (!Object.hasOwn(member.arms.guns, item)) return `${member.name} carries no ${item} to take magazines for`;
    return undefined;
}

registerAction('scavenge', {
    whyNot: (world, state, cmd) => scavengeBlocked(world, state, crewMember(state, cmd.crew), cmd.npc, cmd.take),
    candidates: (_world, state, member) => state.npcs.filter(n => n.ammo !== null && SEARCHABLE.has(n.status))
        .flatMap(n => (['weapon', 'ammo'] as const).map(take => ({ type: 'scavenge' as const, crew: member.id, npc: n.id, take }))),
    cost: () => 1,
    illegal: (_world, state, cmd) => ({
        act: 'pickPocket', tiles: [crewMember(state, cmd.crew).pos, state.npcs.find(n => n.id === cmd.npc)!.pos].map(p => ({ x: p.x, y: p.y }))
    }),
    run(ctx, member, cmd) {
        const npc = ctx.state.npcs.find(n => n.id === cmd.npc)!, ammo = npc.ammo!, item = ammo.weapon;
        if (cmd.take === 'weapon') {
            // With what is left in its magazine; the spares stay on the belt.
            member.loadout.items.push(item);
            member.arms.guns[item] = { load: item, loaded: ammo.loaded, spare: 0 };
            if (member.arms.drawn === null) member.arms.drawn = item;
            npc.armed = null;
            ctx.emit({ type: 'scavenged', crew: member.id, npc: npc.id, take: 'weapon', weapon: item, rounds: ammo.loaded });
            ammo.loaded = 0;
            return;
        }
        member.arms.guns[item]!.spare += ammo.spare;
        ctx.emit({ type: 'scavenged', crew: member.id, npc: npc.id, take: 'ammo', weapon: item, rounds: ammo.spare });
        ammo.spare = 0;
    }
});

// ---------------------------------------------------------------------------------------------------------- Hand over a magazine

function handBlocked(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, to: string): string | undefined {
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    const item = member.arms.drawn;
    if (item === null || member.arms.guns[item]!.spare < 1) return `${member.name} has no spare magazine to hand over`;
    const mate = state.crew.find(c => c.id === to);
    if (!mate || mate.id === member.id) return `No teammate called '${to}'`;
    if (!Object.hasOwn(mate.arms.guns, item)) return `${mate.name} carries no ${item}`;
    return inReach(world, state, member.pos, mate.pos) ? undefined : `${mate.name} is out of reach`;
}

registerAction('handMag', {
    whyNot: (world, state, cmd) => handBlocked(world, state, crewMember(state, cmd.crew), cmd.to),
    candidates: (_world, state, member) => state.crew.filter(c => c.id !== member.id).map(c => ({ type: 'handMag', crew: member.id, to: c.id })),
    cost: () => 1,
    run(ctx, member, cmd) {
        const item = member.arms.drawn!, mate = ctx.state.crew.find(c => c.id === cmd.to)!;
        member.arms.guns[item]!.spare--;
        mate.arms.guns[item]!.spare++;
        ctx.emit({ type: 'magHanded', crew: member.id, to: mate.id, weapon: item });
    }
});

// ---------------------------------------------------------------------------------------------------------- Brace

function braceBlocked(member: DeepReadonly<CrewState>): string | undefined {
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    const fire = firing(member);
    if (typeof fire === 'string') return fire;
    if (!BRACEABLE.has(fire.item)) return `The ${fire.item} has no bipod`;
    return member.arms.braced ? `${member.name} is braced already` : undefined;
}

registerAction('brace', {
    whyNot: (_world, state, cmd) => braceBlocked(crewMember(state, cmd.crew)),
    candidates: (_world, _state, member) => [{ type: 'brace', crew: member.id }],
    // Their last action: whatever is left, at least 1.
    cost: (_world, state, cmd) => Math.max(1, crewMember(state, cmd.crew).actionsLeft),
    run(ctx, member) {
        member.arms.braced = true;
        ctx.emit({ type: 'braced', crew: member.id, weapon: member.arms.drawn! });
    }
});

registerEvents({
    swapped: { undoBlocking: false },
    reloaded: { undoBlocking: false },
    scavenged: { undoBlocking: true },
    magHanded: { undoBlocking: false },
    braced: { undoBlocking: false }
});
