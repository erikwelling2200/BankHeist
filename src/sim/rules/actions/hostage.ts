import { registerWorldHook } from '../../core/engine';
import { sortedIds } from '../../core/json';
import { crewMember, registerCrewInit, registerNpcInit, registerRuleDefaults } from '../../core/state';
import type { CrewState, DeepReadonly, NpcState, PersonDef, Pos, ReadonlyWorld, State } from '../../core/types';
import { registerEvents } from '../../core/undo';
import { POCKETS, ZIP_TIES } from '../../data/items';
import { lineOfSight, sightMap } from '../../geo/los';
import { registerPreviewSecret } from '../knowledge';
import { isPresent, personOf } from '../npc/walk';
import { bodyPos, draggedBy } from '../place';
import { reportAssault } from '../evidence';
import { alertNpc, isEyesDown } from '../suspicion';
import { inReach, lacksActions, registerAction } from './act';
import { lootWeight, syncHands } from '../hands';
import { handsFree, pocketed } from './loot';

/*
 * Hostages (§10.6, §10.7): zip-ties and the frisk that comes with them, leading a hostage, and coercing one.
 *
 * - **What NPCs carry** (§10.6, §10.9, §16.2): a weapon (`NpcState.armed`: a guard's holstered pistol, or the hidden one
 *   of an off-duty cop, which nothing tells apart from any customer's look) and a keycard (`NpcState.keycard`). By
 *   default every enforcer has a holstered pistol and every staff member and enforcer a keycard (rules/npc/walk.ts: they
 *   pass the locked doors their keys open); the World says otherwise per person (`PersonDef.armed`, `.keycard`).
 * - **Zip-tie** (`zipTie { crew, npc }`): 1 action, in reach, hands free, one of the crew member's `ZIP_TIES` (4), on an
 *   NPC that is Commanded, Surprised (GO) or out cold. It is the illegal act 'zipTie', seen on both tiles. The NPC is
 *   **tied**: eyes down, never acts, no command to lapse, any carrier it holds countered (carriers.ts); one out cold is
 *   tied as it lies and comes round tied (implementation plan §6 decision 59). **Tying includes a frisk**: its weapon is
 *   removed (a hidden one is a secret no preview tells: `hiddenWeaponFound`), and its keycard taken by the crew member
 *   (`CrewState.keycards`), which then opens keycard doors (crew/movement.ts `crewHasKey`, decision 60).
 * - **Freeing** (§10.6): a free NPC that has noticed the tied one (evidence.ts: `tied:<id>`) and ends a world phase in
 *   reach of it is untying it (`NpcState.untying`, shown for a crew phase); at the end of the second such world phase in
 *   a row it is free: Alerted, reporting its assault like a knockout victim who comes round (decision 65). Police
 *   freeing hostages is M3's.
 * - **Escort** (`escort { crew, npc }`): 1 action, in reach, hands free, a Commanded or tied NPC. The hostage is led by
 *   the arm: in the hands like a body (`CrewState.dragging` and `leading`, so `Loadout.carrying` 'hostage': with its
 *   escort), at half movement and nothing else (no carry weight, decision 63), and leading it is commanding it, the
 *   illegal act 'command' for as long as
 *   it lasts (decision 63). Letting go is Drop (body.ts); a hostage passes to a teammate as a body does (loot.ts). A
 *   Commanded hostage whose command lapses into anything but staying down shakes free where the escort stands.
 * - **Coerce** (`coerce { crew, npc, at }`, §10.7): 1 action, a Commanded or tied NPC next to the crew member and in
 *   their sight (across teller glass too: the slot passes cash), the object `at` in the hostage's reach, the illegal act
 *   'command'. A teller opens their own drawer (the one at their window, `ownDrawer`): its cash is pocketed by the crew
 *   member. A key-holding staff member (the
 *   manager, the head teller) enters their part of the vault code at the console (`ObjectState.codes`); what opens the
 *   vault is M2-05's (decision 64).
 */

/** What an NPC carries of a weapon: a guard's holstered pistol, or a hidden one (an off-duty cop's, §10.9). */
export type NpcWeapon = 'holstered' | 'hidden';

declare module '../../core/types' {
    interface PersonDef {
        /** The weapon on them; absent: an enforcer's holstered pistol, nobody else's (§16.2). */
        armed?: NpcWeapon;
        /** Whether they carry a keycard; absent: every staff member and enforcer does. */
        keycard?: boolean;
    }
    interface NpcState {
        /** The weapon still on them, or null once a frisk took it (or they never had one). */
        armed: NpcWeapon | null;
        /** They still have their keycard (§10.6: a frisk takes it). */
        keycard: boolean;
        /** A free NPC untying them (§10.6): who, and the world phases it has spent in reach so far; or null. */
        untying: { by: string; phases: number } | null;
    }
    interface CrewState {
        /** Zip-ties left (§7.3: 4). */
        zipTies: number;
        /** The NPCs whose keycards they took in a frisk, by id. */
        keycards: string[];
    }
    interface ObjectState {
        /** At a vault console: the key-holders coerced into entering their part of the code (§10.7), by NPC id. */
        codes?: string[];
    }
    interface Rules {
        /** World phases a free NPC spends in reach of a tied one to free it (§10.6). */
        untiePhases: number;
    }
    interface CommandMap {
        /** Zip-tie the NPC `npc` in reach (1 action, an illegal act): tied, and frisked. */
        zipTie: { crew: string; npc: string };
        /** Lead the Commanded or tied NPC `npc` in reach by the arm (1 action): it goes where they go. */
        escort: { crew: string; npc: string };
        /** Make the Commanded or tied NPC `npc` next to them open the drawer or enter the code at the console `at` (1 action). */
        coerce: { crew: string; npc: string; at: string };
    }
    interface EventMap {
        zipTied: { crew: string; npc: string };
        /** A frisk took a weapon everybody could see (a guard's holstered pistol). */
        weaponTaken: { crew: string; npc: string };
        /** A frisk found a hidden weapon (an off-duty cop's). A preview never shows it. */
        hiddenWeaponFound: { crew: string; npc: string };
        keycardTaken: { crew: string; npc: string };
        escorting: { crew: string; npc: string };
        /** A Commanded hostage whose command lapsed shook free of its escort at `at`. */
        hostageFree: { crew: string; npc: string; at: Pos };
        coerced: { crew: string; npc: string; at: string };
        /** A key-holder entered their part of the vault code at the console (§10.7). */
        codeEntered: { crew: string; npc: string; console: string };
        /** A free NPC is untying a tied one: `phases` of `rules.untiePhases` so far. */
        untying: { npc: string; by: string; phases: number };
        /** A tied NPC was freed. */
        freed: { npc: string; by: string };
    }
}

registerRuleDefaults({ untiePhases: 2 });

/** The weapon a person starts with (see the header). */
const startingWeapon = (person: DeepReadonly<PersonDef>): NpcWeapon | null => person.armed ?? (person.observer === 'enforcer' ? 'holstered' : null);

/** Whether a person starts with a keycard (see the header). */
const startingKeycard = (person: DeepReadonly<PersonDef>): boolean => person.keycard ?? person.observer !== 'civilian';

registerNpcInit('hostage', (_world, person, npc) => {
    npc.armed = startingWeapon(person);
    npc.keycard = startingKeycard(person);
    npc.untying = null;
});

registerCrewInit('hostage', (_world, _start, member) => {
    member.zipTies = ZIP_TIES;
    member.keycards = [];
});

/** Roles that keep a cash drawer (§10.7) and roles that hold part of the vault code (§15.2 dual control). */
const DRAWER_ROLES: ReadonlySet<string> = new Set(['teller', 'headTeller', 'driveTeller']);
const CODE_ROLES: ReadonlySet<string> = new Set(['manager', 'headTeller']);

/** Statuses of an NPC who does as it is told: a hostage to lead or coerce. */
const COMPLIANT: ReadonlySet<string> = new Set(['commanded', 'tied']);

/** An NPC on the map and not in a stash, by id, or the reason it can't be handled. */
function hostageOf(state: State, id: string): NpcState | string {
    const npc = state.npcs.find(n => n.id === id);
    if (!npc || !isPresent(npc)) return `No one called '${id}' is here`;
    if (npc.stashed !== null) return 'They are stashed';
    return npc;
}

/** Why this NPC can't be zip-tied by anyone now, or undefined (§10.6: Commanded, Surprised or out cold). */
export function tieIneligible(npc: DeepReadonly<NpcState>): string | undefined {
    if (npc.status === 'tied') return 'They are tied up already';
    if (npc.status === 'dead') return 'They are dead';
    if (npc.status === 'hostile') return 'They are hostile: subdue them first';
    if (npc.status === 'commanded' || npc.status === 'unconscious' || npc.surprised !== null) return undefined;
    return 'Only someone face down, surprised or out cold can be tied';
}

function tieBlocked(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, id: string): string | undefined {
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    if (member.zipTies <= 0) return `${member.name} has no zip-ties left`;
    if (!handsFree(member)) return `${member.name}'s hands are full`;
    const npc = hostageOf(state, id);
    if (typeof npc === 'string') return npc;
    const why = tieIneligible(npc);
    if (why) return why;
    return inReach(world, state, member.pos, bodyPos(state, npc)) ? undefined : `${member.name} can't reach them from here`;
}

registerAction('zipTie', {
    whyNot: (world, state, cmd) => tieBlocked(world, state, crewMember(state, cmd.crew), cmd.npc),
    candidates: (_world, state, member) => state.npcs.filter(n => !tieIneligible(n)).map(n => ({ type: 'zipTie', crew: member.id, npc: n.id })),
    cost: () => 1,
    // Seen on either tile: whoever sees the crew member or the one being tied.
    illegal: (_world, state, cmd) => ({
        act: 'zipTie',
        tiles: [crewMember(state, cmd.crew).pos, bodyPos(state, state.npcs.find(n => n.id === cmd.npc)!)].map(p => ({ x: p.x, y: p.y }))
    }),
    run(ctx, member, cmd) {
        const npc = ctx.state.npcs.find(n => n.id === cmd.npc)!;
        member.zipTies--;
        npc.status = 'tied';
        // Tied, it never acts (§10.6): nothing it meant to do, no command to lapse, no knockout to wake from.
        npc.command = null;
        npc.lapse = null;
        npc.surprised = null;
        npc.outCold = null;
        npc.untying = null;
        npc.intent = { path: [] };
        npc.goal = { kind: 'still' };
        npc.route = null;
        npc.search = null;
        ctx.emit({ type: 'zipTied', crew: member.id, npc: npc.id });
        ctx.emit({ type: 'npcStatus', npc: npc.id, status: 'tied' });
        // The frisk (§10.6): weapons out, the keycard taken.
        if (npc.armed !== null) {
            ctx.emit({ type: npc.armed === 'hidden' ? 'hiddenWeaponFound' : 'weaponTaken', crew: member.id, npc: npc.id });
            npc.armed = null;
        }
        if (npc.keycard) {
            npc.keycard = false;
            member.keycards = [...member.keycards, npc.id].sort();
            ctx.emit({ type: 'keycardTaken', crew: member.id, npc: npc.id });
        }
    }
});

// ---------------------------------------------------------------------------------------------------------- Escort

function escortBlocked(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, id: string): string | undefined {
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    if (!handsFree(member)) return `${member.name}'s hands are full`;
    const npc = hostageOf(state, id);
    if (typeof npc === 'string') return npc;
    if (!COMPLIANT.has(npc.status)) return 'Only someone face down or tied can be led';
    if (draggedBy(state, id)) return 'Someone is already leading them';
    return inReach(world, state, member.pos, npc.pos) ? undefined : `${member.name} can't reach them from here`;
}

registerAction('escort', {
    whyNot: (world, state, cmd) => escortBlocked(world, state, crewMember(state, cmd.crew), cmd.npc),
    candidates: (_world, state, member) => state.npcs.filter(n => COMPLIANT.has(n.status)).map(n => ({ type: 'escort', crew: member.id, npc: n.id })),
    cost: () => 1,
    illegal: () => ({ act: 'command' }),
    run(ctx, member, cmd) {
        member.dragging = cmd.npc;
        member.leading = true;
        syncHands(ctx.world, ctx.state, member);
        ctx.emit({ type: 'escorting', crew: member.id, npc: cmd.npc });
    }
});

// ---------------------------------------------------------------------------------------------------------- Coercion

/**
 * A teller's own cash drawer (§10.7 "their drawer"): the Light loot next to the window or desk their day starts at
 * (Chebyshev 1 of its tile), the nearest, then the first by id; undefined when there is none.
 */
export function ownDrawer(world: ReadonlyWorld, npcId: string): string | undefined {
    const station = personOf(world, npcId).schedule.find(b => (b.activity === 'window' || b.activity === 'post') && b.at)?.at;
    if (!station) return undefined;
    let best: { id: string; d: number } | undefined;
    for (const o of world.objects) {
        if (o.kind !== 'loot' || o.loot?.weight !== 'light' || o.loot.value <= 0) continue;
        const dx = o.pos.x - station.x, dy = o.pos.y - station.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) > 1) continue;
        const d = dx * dx + dy * dy;
        if (!best || d < best.d || (d === best.d && o.id < best.id)) best = { id: o.id, d };
    }
    return best?.id;
}

/** What coercing a hostage at `at` would do: open a drawer, enter a code; or why it can't. */
function coercion(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, npc: DeepReadonly<NpcState>, at: string): 'drawer' | 'code' | string {
    const role = personOf(world, npc.id).role, from = bodyPos(state, npc);
    if (Object.hasOwn(state.loot, at)) {
        const loot = state.loot[at]!;
        if (lootWeight(world, at) !== 'light' || loot.taken) return 'There is no drawer to open there';
        if (!DRAWER_ROLES.has(role)) return 'Only a teller can open a cash drawer';
        if (ownDrawer(world, npc.id) !== at) return 'It isn\'t their drawer';
        if (!inReach(world, state, from, loot.pos)) return 'They can\'t reach the drawer';
        return pocketed(world, state, member.id).length >= POCKETS ? `${member.name}'s pockets are full` : 'drawer';
    }
    const console = world.objects.find(o => o.id === at);
    if (!console || console.kind !== 'vaultConsole') return 'There is nothing they could open there';
    if (!CODE_ROLES.has(role)) return 'They don\'t know any part of the code';
    if (state.objects[at]?.codes?.includes(npc.id)) return 'They have entered their part already';
    return inReach(world, state, from, console.pos) ? 'code' : 'They can\'t reach the console';
}

function coerceBlocked(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, id: string, at: string): string | undefined {
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    const npc = hostageOf(state, id);
    if (typeof npc === 'string') return npc;
    if (!COMPLIANT.has(npc.status)) return 'Only someone face down or tied does as they are told';
    const p = bodyPos(state, npc);
    // Next to them and in sight: across a teller window too.
    if (Math.max(Math.abs(p.x - member.pos.x), Math.abs(p.y - member.pos.y)) > 1 || !lineOfSight(sightMap(world, state), { x: member.pos.x, y: member.pos.y }, p)) {
        return `${member.name} isn't next to them`;
    }
    const what = coercion(world, state, member, npc, at);
    return what === 'drawer' || what === 'code' ? undefined : what;
}

registerAction('coerce', {
    whyNot: (world, state, cmd) => coerceBlocked(world, state, crewMember(state, cmd.crew), cmd.npc, cmd.at),
    candidates(world, state, member) {
        const near = (p: DeepReadonly<Pos>, r: number): boolean => Math.max(Math.abs(p.x - member.pos.x), Math.abs(p.y - member.pos.y)) <= r;
        const hostages = state.npcs.filter(n => COMPLIANT.has(n.status) && near(bodyPos(state, n), 1));
        const things = [
            ...sortedIds(state.loot).filter(id => !state.loot[id]!.taken && near(state.loot[id]!.pos, 2)),
            ...world.objects.filter(o => o.kind === 'vaultConsole' && near(o.pos, 2)).map(o => o.id)
        ];
        return hostages.flatMap(n => things.map(at => ({ type: 'coerce' as const, crew: member.id, npc: n.id, at })));
    },
    cost: () => 1,
    illegal: () => ({ act: 'command' }),
    run(ctx, member, cmd) {
        const { world, state } = ctx;
        const npc = state.npcs.find(n => n.id === cmd.npc)!;
        const what = coercion(world, state, member, npc, cmd.at);
        ctx.emit({ type: 'coerced', crew: member.id, npc: npc.id, at: cmd.at });
        if (what === 'drawer') {
            const loot = state.loot[cmd.at]!, from = { x: loot.pos.x, y: loot.pos.y };
            loot.holder = member.id;
            loot.taken = true;
            ctx.emit({ type: 'lootTaken', crew: member.id, loot: cmd.at, from });
            return;
        }
        const codes = state.objects[cmd.at]?.codes ?? [];
        state.objects[cmd.at] = { ...state.objects[cmd.at], codes: [...codes, npc.id].sort() };
        ctx.emit({ type: 'codeEntered', crew: member.id, npc: npc.id, console: cmd.at });
    }
});

// ---------------------------------------------------------------------------------------------------------- Freeing

/** The free NPC who is in reach of a tied one and knows it is there (it noticed it), first in resolution order. */
function untier(world: ReadonlyWorld, state: State, tied: DeepReadonly<NpcState>): NpcState | undefined {
    return state.npcs.find(h => h.id !== tied.id && isPresent(h) && !isEyesDown(h) && h.status !== 'hostile'
        && h.noticed.includes(`tied:${tied.id}`) && inReach(world, state, h.pos, tied.pos));
}

// Freeing (§10.6), with the devices, after everyone has walked and noticed: two world phases in a row in reach of the
// tied NPC. The first is shown for a crew phase (`untying`), so the crew can answer before it is free.
registerWorldHook('devices', 'hostage.untie', ctx => {
    const { world, state } = ctx;
    for (const npc of state.npcs) {
        if (npc.status !== 'tied' || !isPresent(npc) || npc.stashed !== null || draggedBy(state, npc.id)) {
            npc.untying = null;
            continue;
        }
        const helper = untier(world, state, npc);
        if (!helper) {
            npc.untying = null;
            continue;
        }
        const phases = npc.untying?.by === helper.id ? npc.untying.phases + 1 : 1;
        if (phases < world.rules.untiePhases) {
            npc.untying = { by: helper.id, phases };
            ctx.emit({ type: 'untying', npc: npc.id, by: helper.id, phases });
            continue;
        }
        // Free: up and Alerted, it reports what was done to it, as a knockout victim does on waking (knockout.ts).
        npc.untying = null;
            npc.status = 'alerted';
        ctx.emit({ type: 'freed', npc: npc.id, by: helper.id });
        ctx.emit({ type: 'npcStatus', npc: npc.id, status: 'alerted' });
        alertNpc(ctx, npc, 'freed');
        reportAssault(ctx, npc);
    }
}, { order: 45 });

// The player isn't told who hides a weapon until a frisk finds it: a preview never shows it.
registerPreviewSecret('hiddenWeaponFound');

registerEvents({
    zipTied: { undoBlocking: true },
    weaponTaken: { undoBlocking: true },
    hiddenWeaponFound: { undoBlocking: true },
    keycardTaken: { undoBlocking: true },
    // Unseen, taking a hostage by the arm changes no NPC (it is where its escort is): it can be taken back.
    escorting: { undoBlocking: false },
    hostageFree: { undoBlocking: true },
    coerced: { undoBlocking: true },
    codeEntered: { undoBlocking: true },
    untying: { undoBlocking: true },
    freed: { undoBlocking: true }
});
