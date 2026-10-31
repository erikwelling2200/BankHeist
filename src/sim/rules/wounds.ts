import { registerWorldHook, type Ctx, type WorldPhase } from '../core/engine';
import { samePos } from '../core/grid';
import { registerActorCheck, registerCrewInit, registerNpcInit, registerRuleDefaults, registerStateInit } from '../core/state';
import type { CrewState, DeepReadonly, NpcState, Phase, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { HALF_STEPS_PER_TILE } from '../data/movement';
import { makeNoise } from '../geo/sound';
import { registerBudgetModifier, registerMoveHook } from '../crew/movement';
import { inReach, registerAction } from './actions/act';
import { releaseBody } from './actions/body';
import { registerHarmHandler, type Harm } from './damage';
import { placeEvidence } from './evidence';
import type { PoliceUnit } from './police';
import { isPresent } from './npc/walk';
import { isWounded, npcMaxHp } from './woundsState';

/*
 * Wounds, downed and arrested (GAME_DESIGN §11.12; implementation plan M3-03, decisions 140–148). Every attack's
 * damage reaches here through `dealHarm` (rules/damage.ts, the `wounds` handler).
 *
 * - **Hit points.** A crew member has `rules.crewHp` (8, §7.1); an NPC its role's (§12.3 `NPC_HP`: guards 5, the
 *   security chief 6, an armed civilian such as the off-duty cop 5, anyone else 3), kept in `NpcState.hp`.
 * - **Hurt** (half their hit points or less, `isHurt`): a crew member limps (−1 tile per move action: a Move's budget
 *   −1, a Dash's −2, `registerBudgetModifier`), aims worse (Aim ×1.25 unless Cool Head; the attack folds it into the
 *   shot's `aimFactor`, so a preview's cone and a replay agree), leaves blood on every tile they walk onto (major
 *   evidence, §8.10: one `blood` item per tile) and bleeds: −1 HP every `bleedPhases` (2) world phases they spend Hurt
 *   and unbandaged, counted in the devices step. A medkit bandages them (the bleeding stops until they are hit again).
 * - **Downed** at 0 HP: no actions (`registerActorCheck`, and none given back in the crew phase), whatever they held
 *   let go of, a pool of blood where they fall. They bleed out over `bleedOutPhases` (3) world phases, counted from the
 *   first world phase after the one they went down in, and die as the last ends (`crewDied`). Further hits on someone
 *   down do nothing more (decision 143).
 * - **Revive** (`revive { crew, ally }`, 1 action, in reach): back up with 3 HP (Medic 6), still Hurt and bleeding.
 *   **Medkit** (`medkit { crew, ally }`, 1 action, in reach or on oneself, one of the kit's 2 uses): a downed ally is
 *   revived with 4 HP (Medic 6), anyone else up heals 4 (Medic 6) to at most their full hit points; either way they
 *   are bandaged.
 * - **NPCs at 0 HP die** when the harm is lethal (every bullet and blow is; the taser and flashbangs aren't harm):
 *   status `dead`, intent and plans dropped, as a knockout does. Heat counts the kill off the state (rules/heat.ts),
 *   whatever caused it. A non-lethal harm at 0 knocks them out instead. **Wounded NPCs** (half their hit points or
 *   less, alive, conscious and on the map) scream once per world phase in the devices step: a loud noise of radius 6
 *   (`scream`), so the hearers react before the next intents are committed and the crew phase shows them (Alerted; the
 *   scream doesn't make the bank Loud by itself).
 * - **Arrest** (`arrestCrew`): a downed crew member with a police officer out of a vehicle in reach as a world phase's
 *   devices step runs (an officer, on foot since an earlier world phase) is taken to a police van: off the map, out of
 *   `State.crew` into `State.custody` (traded back by M3-07, jailed at the end, §19.6), and forgotten by every NPC
 *   (`forgetCrew`). Officers walk up to the downed they know of (rules/routine.ts); one that walked this world phase
 *   arrests in the next, so the crew has a crew phase to see it standing there.
 */

/** A crew member's wounds. */
export interface CrewWounds {
    hp: number;
    /** A medkit's bandage: no bleeding until they are hit again. */
    bandaged: boolean;
    /** World phases spent Hurt and bleeding since the last HP lost to it. */
    bleed: number;
    /** Down at 0 HP: world phases left to bleed out and when they went down; null while up. */
    downed: { left: number; turn: number; phase: Phase } | null;
    /** Bled out or killed. */
    dead: boolean;
    /** Medkit uses left (2 per kit carried). */
    medkits: number;
}

/** An arrested crew member (§11.12), in a police van. */
export interface Custody { crew: CrewState; by: string; turn: number }

declare module '../core/types' {
    interface CrewState {
        wounds: CrewWounds;
    }
    interface NpcState {
        /** Hit points left (§12.3). */
        hp: number;
    }
    interface State {
        /** Crew members the police took (§11.12). */
        custody: Custody[];
    }
    interface Rules {
        /** A crew member's hit points (§7.1). */
        crewHp: number;
        /** World phases Hurt and unbandaged per HP lost to bleeding (§11.12). */
        bleedPhases: number;
        /** World phases a downed crew member has before bleeding out (§11.12). */
        bleedOutPhases: number;
        /** Aim multiplier while Hurt (§11.12). */
        hurtAim: number;
        /** HP a revive gives back (§6.3), and with Medic. */
        reviveHp: number;
        medicReviveHp: number;
        /** HP a medkit heals (§12.2), and with Medic. */
        medkitHp: number;
        medicMedkitHp: number;
        /** Uses of each medkit carried (§12.2 "Medkit ×2"). */
        medkitUses: number;
    }
    interface CommandMap {
        /** Bring a downed ally in reach back up (1 action, §6.3). */
        revive: { crew: string; ally: string };
        /** Use a medkit on an ally in reach or oneself (1 action, §12.2): revive or heal, and bandage. */
        medkit: { crew: string; ally: string };
    }
    interface EventMap {
        /** A crew member lost hit points (`cause` 'harm' or 'bleeding'). */
        crewWounded: { crew: string; hp: number; hurt: boolean; cause: 'harm' | 'bleeding' };
        /** A crew member is down at 0 HP, bleeding out in `phases` world phases. */
        crewDowned: { crew: string; phases: number };
        /** A downed crew member's bleed-out countdown. */
        bleedingOut: { crew: string; phases: number };
        crewDied: { crew: string };
        /** Up again (revive or medkit) with `hp`. */
        crewRevived: { crew: string; by: string; hp: number; medkit: boolean };
        /** A medkit on someone up: healed to `hp` and bandaged. */
        crewHealed: { crew: string; by: string; hp: number };
        /** Taken by the police (§11.12). */
        crewArrested: { crew: string; by: string };
        /** An NPC lost hit points; `wounded` at half or less. */
        npcWounded: { npc: string; hp: number; wounded: boolean };
        npcDied: { npc: string; by: string };
        /** A wounded NPC screamed (§11.12). */
        screamed: { npc: string };
    }
}

registerRuleDefaults({
    crewHp: 8, bleedPhases: 2, bleedOutPhases: 3, hurtAim: 1.25, reviveHp: 3, medicReviveHp: 6, medkitHp: 4, medicMedkitHp: 6, medkitUses: 2
});

registerCrewInit('wounds', (world, _start, member) => {
    const kits = [...member.loadout.items, ...member.loadout.packed].filter(i => i === 'medkit').length;
    member.wounds = { hp: world.rules.crewHp, bandaged: false, bleed: 0, downed: null, dead: false, medkits: kits * world.rules.medkitUses };
});

registerNpcInit('wounds', (world, person, npc) => {
    npc.hp = npcMaxHp(world, person.id);
});

registerStateInit('wounds', (_world, state) => {
    state.custody = [];
});

// ---------------------------------------------------------------------------------------------------------- Crew

/** Down: at 0 HP, bleeding out, or dead. */
export const isDown = (member: DeepReadonly<CrewState>): boolean => member.wounds.downed !== null || member.wounds.dead;

/** Hurt (§11.12): half their hit points or less, still up. */
export function isHurt(world: ReadonlyWorld, member: DeepReadonly<CrewState>): boolean {
    return !isDown(member) && member.wounds.hp * 2 <= world.rules.crewHp;
}

/** The Aim multiplier wounds give a crew member's shots (§11.12; Cool Head ignores it, §7.2). */
export function woundAim(world: ReadonlyWorld, member: DeepReadonly<CrewState>): number {
    return isHurt(world, member) && !member.traits.includes('coolHead') ? world.rules.hurtAim : 1;
}

registerActorCheck('wounds', member => {
    if (member.wounds.dead) return `${member.name} is dead`;
    if (member.wounds.downed) return `${member.name} is down`;
    return undefined;
});

// Limping: a tile less per move action (a Dash is two).
registerBudgetModifier('wounds', (world, member, mode, budget) =>
    (isHurt(world, member) ? Math.max(0, budget - (mode === 'dash' ? 2 : 1) * HALF_STEPS_PER_TILE) : budget));

/** Leaves blood on a tile (§8.10), once per tile. */
function bleedOn(ctx: Ctx, member: DeepReadonly<CrewState>): void {
    const pos = member.pos;
    if (ctx.state.evidence.some(e => e.kind === 'blood' && samePos(e.pos, pos))) return;
    placeEvidence(ctx, 'blood', pos);
}

// The blood trail: every tile a Hurt crew member walks onto.
registerMoveHook('wounds', {
    step: (ctx, member) => {
        if (isHurt(ctx.world, member)) bleedOn(ctx, member);
    }
});

/** Takes a crew member down at 0 HP (§11.12). */
function goDown(ctx: Ctx, member: CrewState): void {
    const { state, world } = ctx;
    member.wounds.hp = 0;
    member.wounds.bleed = 0;
    member.wounds.downed = { left: world.rules.bleedOutPhases, turn: state.turn, phase: state.phase };
    member.actionsLeft = 0;
    // Whatever they held goes: the body or hostage, the lean, the Watch, the brace, the aim.
    releaseBody(world, state, member);
    member.leaning = null;
    member.holding = null;
    member.arms.watch = null;
    member.arms.braced = false;
    member.arms.aiming = null;
    bleedOn(ctx, member);
    ctx.emit({ type: 'crewDowned', crew: member.id, phases: world.rules.bleedOutPhases });
}

/** Takes hit points from a crew member (harm or bleeding); at 0 they go down. */
function hurtCrew(ctx: Ctx, member: CrewState, damage: number, cause: 'harm' | 'bleeding'): void {
    if (isDown(member) || damage <= 0) return;
    const was = isHurt(ctx.world, member);
    member.wounds.hp = Math.max(0, member.wounds.hp - damage);
    if (cause === 'harm') member.wounds.bandaged = false;
    ctx.emit({ type: 'crewWounded', crew: member.id, hp: member.wounds.hp, hurt: member.wounds.hp * 2 <= ctx.world.rules.crewHp, cause });
    if (member.wounds.hp === 0) return goDown(ctx, member);
    if (!was && isHurt(ctx.world, member)) bleedOn(ctx, member);
}

/** Puts a downed crew member in a police van (§11.12): off the map, into `State.custody`. */
export function arrestCrew(ctx: Ctx, crewId: string, by: string): void {
    const { state } = ctx, i = state.crew.findIndex(c => c.id === crewId);
    if (i < 0) return;
    const [member] = state.crew.splice(i, 1);
    state.custody.push({ crew: member!, by, turn: state.turn });
    forgetCrew(state, crewId);
    ctx.emit({ type: 'crewArrested', crew: crewId, by });
}

/**
 * Takes every reference to a crew member off the map out of the NPCs and the state (decision 148): what an NPC wants,
 * fears, saw or was told of them, the intent actions aimed at them (the walk stays), a command they gave (passed to the
 * first crew member left, or ended), a lapse, panic or suppression of theirs. No rule then looks for them on the map.
 */
export function forgetCrew(state: State, crewId: string): void {
    const heir = state.crew[0]?.id ?? null;
    for (const npc of state.npcs) {
        delete npc.suspicion[crewId];
        delete npc.lastSeen[crewId];
        delete npc.frisked[crewId];
        npc.exposedTo = npc.exposedTo.filter(id => id !== crewId);
        npc.warned = npc.warned.filter(id => id !== crewId);
        npc.reported = npc.reported.filter(id => id !== crewId);
        npc.challenges = npc.challenges.filter(c => c.crew !== crewId);
        npc.wants = npc.wants.filter(w => w.crew !== crewId);
        if (npc.command?.by === crewId) npc.command = heir === null ? null : { ...npc.command, by: heir };
        if (npc.lapse && 'crew' in npc.lapse && npc.lapse.crew === crewId) npc.lapse = null;
        if (npc.suppressed?.by === crewId) npc.suppressed = null;
        if (npc.panic) {
            if (npc.panic.crew === crewId) npc.panic.crew = null;
            if (npc.panic.reaction?.kind === 'tackle' && npc.panic.reaction.crew === crewId) npc.panic.reaction = { kind: 'cower' };
        }
        if (npc.goal.crew === crewId) npc.goal = { kind: 'still' };
        const action = npc.intent.action as { crew?: string } | undefined;
        if (action?.crew === crewId) npc.intent = { path: npc.intent.path, ...(npc.intent.facing ? { facing: npc.intent.facing } : {}) };
    }
    state.cameraReports = state.cameraReports.filter(r => r.crew !== crewId);
    delete state.police.known[crewId];
    for (const unit of state.police.units) if (unit.suppressed?.by === crewId) unit.suppressed = null;
    for (const r of state.negotiation.reports) r.seen = r.seen.filter(s => s.crew !== crewId);
}

// ---------------------------------------------------------------------------------------------------------- NPCs

/** An NPC dies (§11.12): it lies where it fell and never acts on anything it meant to do. Heat reads the kill off the state. */
export function killNpc(ctx: Ctx, npc: NpcState, by: string): void {
    npc.hp = 0;
    npc.status = 'dead';
    npc.intent = { path: [] };
    npc.goal = { kind: 'still' };
    npc.route = null;
    npc.search = null;
    npc.lapse = null;
    npc.panic = null;
    npc.leaning = null;
    // A hostage led by the arm falls: the crew member holds a body now.
    for (const c of ctx.state.crew) if (c.dragging === npc.id) c.leading = false;
    ctx.emit({ type: 'npcDied', npc: npc.id, by });
    ctx.emit({ type: 'npcStatus', npc: npc.id, status: 'dead' });
}

function hurtNpc(ctx: Ctx, npc: NpcState, harm: Readonly<Harm>): void {
    if (npc.status === 'dead' || harm.damage <= 0) return;
    npc.hp = Math.max(0, npc.hp - harm.damage);
    ctx.emit({ type: 'npcWounded', npc: npc.id, hp: npc.hp, wounded: isWounded(ctx.world, npc) });
    if (npc.hp > 0) return;
    if (harm.lethal) return killNpc(ctx, npc, harm.by);
    // Non-lethal harm at 0 stuns: out cold with 1 HP (no rule hands any out yet).
    npc.hp = 1;
}

registerHarmHandler('wounds', (ctx, harm) => {
    const member = ctx.state.crew.find(c => c.id === harm.target);
    if (member) return hurtCrew(ctx, member, harm.damage, 'harm');
    const npc = ctx.state.npcs.find(n => n.id === harm.target);
    if (npc) hurtNpc(ctx, npc, harm);
});

// ---------------------------------------------------------------------------------------------------------- World phase

/** The units that arrest (§11.12): officers, not the negotiator or a sniper. */
const ARRESTING: ReadonlySet<string> = new Set(['patrol', 'swat', 'swatShield', 'heavy']);

/**
 * Out of its vehicle before this world phase (its wave came two or more world phases ago: it got out in the one after)
 * and standing where it is since then: an officer that walked up this world phase arrests in the next (decision 157).
 */
const onFootBefore = (u: DeepReadonly<PoliceUnit>, phase: WorldPhase): boolean => u.pos !== null && u.vehicle === null && u.arrived + 1 < phase.turn && u.moved !== phase.turn;

const beganIn = (since: { turn: number; phase: Phase }, phase: WorldPhase): boolean => since.turn === phase.turn && since.phase === 'world';

// Bleeding, bleeding out, arrests and screams, as a timer would (the devices step).
registerWorldHook('devices', 'wounds', (ctx, phase) => {
    const { state, world } = ctx;
    for (const member of [...state.crew]) {
        const w = member.wounds;
        if (w.dead) continue;
        if (w.downed) {
            if (beganIn(w.downed, phase)) continue;
            w.downed.left--;
            if (w.downed.left > 0) {
                ctx.emit({ type: 'bleedingOut', crew: member.id, phases: w.downed.left });
                continue;
            }
            w.downed = null;
            w.dead = true;
            ctx.emit({ type: 'crewDied', crew: member.id });
            continue;
        }
        if (!isHurt(world, member) || w.bandaged) continue;
        w.bleed++;
        if (w.bleed < world.rules.bleedPhases) continue;
        w.bleed = 0;
        hurtCrew(ctx, member, 1, 'bleeding');
    }
    // Police reaching a downed crew member arrest them.
    for (const member of [...state.crew]) {
        if (!member.wounds.downed) continue;
        const unit = state.police.units.find(u => ARRESTING.has(u.kind) && onFootBefore(u, phase) && inReach(world, state, u.pos!, member.pos));
        if (unit) arrestCrew(ctx, member.id, unit.id);
    }
    for (const npc of state.npcs) {
        if (!isPresent(npc) || npc.status === 'unconscious' || !isWounded(world, npc)) continue;
        ctx.emit({ type: 'screamed', npc: npc.id });
        makeNoise(ctx, 'scream', npc.pos, `scream ${npc.id}`);
    }
}, { order: 5 });

// A new crew phase gives the downed and the dead no actions (after the engine's `crew.actions`).
registerWorldHook('crewPhase', 'wounds.actions', ctx => {
    for (const member of ctx.state.crew) if (isDown(member)) member.actionsLeft = 0;
}, { order: 1 });

// ---------------------------------------------------------------------------------------------------------- Actions

/** Why `crewId` can't revive (or, with a medkit, treat) `allyId` now, or undefined. */
function treatBlocked(world: ReadonlyWorld, state: State, crewId: string, allyId: string, medkit: boolean): string | undefined {
    const member = state.crew.find(c => c.id === crewId);
    if (!member) return `No crew member '${crewId}'`;
    if (member.actionsLeft < 1) return `${member.name} has ${member.actionsLeft} of 1 actions left`;
    const ally = state.crew.find(c => c.id === allyId);
    if (!ally) return `No crew member '${allyId}'`;
    if (ally.wounds.dead) return `${ally.name} is dead`;
    if (medkit && member.wounds.medkits < 1) return `${member.name} has no medkit left`;
    if (!medkit && !ally.wounds.downed) return `${ally.name} isn't down`;
    if (medkit && !ally.wounds.downed && ally.wounds.hp >= world.rules.crewHp) return `${ally.name} isn't hurt`;
    if (ally.id !== member.id && !inReach(world, state, member.pos, ally.pos)) return `${member.name} can't reach ${ally.name} from here`;
    if (member.dragging !== null) return `${member.name}'s hands are full`;
    return undefined;
}

function standUp(ally: CrewState, hp: number): void {
    ally.wounds.downed = null;
    ally.wounds.hp = hp;
    ally.wounds.bleed = 0;
}

const medic = (member: DeepReadonly<CrewState>): boolean => member.traits.includes('medic');

registerAction('revive', {
    whyNot: (world, state, cmd) => treatBlocked(world, state, cmd.crew, cmd.ally, false),
    candidates: (_world, state, member) => state.crew.filter(c => c.id !== member.id).map(c => ({ type: 'revive', crew: member.id, ally: c.id })),
    cost: () => 1,
    run: (ctx, member, cmd) => {
        const ally = ctx.state.crew.find(c => c.id === cmd.ally)!;
        const hp = medic(member) ? ctx.world.rules.medicReviveHp : ctx.world.rules.reviveHp;
        standUp(ally, hp);
        ally.wounds.bandaged = false;
        ctx.emit({ type: 'crewRevived', crew: ally.id, by: member.id, hp, medkit: false });
    }
});

registerAction('medkit', {
    whyNot: (world, state, cmd) => treatBlocked(world, state, cmd.crew, cmd.ally, true),
    candidates: (_world, state, member) => state.crew.map(c => ({ type: 'medkit', crew: member.id, ally: c.id })),
    cost: () => 1,
    run: (ctx, member, cmd) => {
        const { world } = ctx, ally = ctx.state.crew.find(c => c.id === cmd.ally)!;
        const heal = medic(member) ? world.rules.medicMedkitHp : world.rules.medkitHp;
        member.wounds.medkits--;
        if (ally.wounds.downed) {
            standUp(ally, heal);
            ally.wounds.bandaged = true;
            ctx.emit({ type: 'crewRevived', crew: ally.id, by: member.id, hp: heal, medkit: true });
            return;
        }
        ally.wounds.hp = Math.min(world.rules.crewHp, ally.wounds.hp + heal);
        ally.wounds.bandaged = true;
        ally.wounds.bleed = 0;
        ctx.emit({ type: 'crewHealed', crew: ally.id, by: member.id, hp: ally.wounds.hp });
    }
});

registerEvents({
    crewWounded: { undoBlocking: true },
    crewDowned: { undoBlocking: true },
    bleedingOut: { undoBlocking: true },
    crewDied: { undoBlocking: true },
    crewRevived: { undoBlocking: false },
    crewHealed: { undoBlocking: false },
    crewArrested: { undoBlocking: true },
    npcWounded: { undoBlocking: true },
    npcDied: { undoBlocking: true },
    screamed: { undoBlocking: true }
});
