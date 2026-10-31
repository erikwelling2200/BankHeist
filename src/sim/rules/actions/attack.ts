import { registerWorldHook, type Ctx, type WorldPhase } from '../../core/engine';
import { facingToward, inBounds, samePos } from '../../core/grid';
import { clonePlain } from '../../core/json';
import { crewMember, registerNpcInit } from '../../core/state';
import type { CrewState, DeepReadonly, NpcState, Pos, ReadonlyWorld, State } from '../../core/types';
import { registerEvents } from '../../core/undo';
import { NOISES, type NoiseSource } from '../../data/noise';
import {
    BRACEABLE, HEAVY_FIRE, STRIKE, SUPPRESS, TASER_STOPPED_BY, WATCH_AIM, WATCH_ARC, WATCH_NARROW, weaponDef, type WeaponDef
} from '../../data/weapons';
import { atan2Deg } from '../../geo/angles';
import { lineOfSight, sightMap, type SightMap } from '../../geo/los';
import { ABSENT_STATUSES, LYING_STATUSES } from '../../geo/move';
import { coverAgainst, shotFabric, shotMap } from '../../geo/shot';
import { makeNoise } from '../../geo/sound';
import { firing, movedThisTurn } from '../arms';
import { commandNpc, crewThreat } from '../command';
import { dealHarm } from '../damage';
import { woundAim } from '../wounds';
import { personOf } from '../npc/walk';
import { officerSeen } from '../knowledge';
import { policeShotAt } from '../police';
import { bodyPos } from '../place';
import { armourOf, leanOptions, resolveShot, shotRefusal, type Shot, type ShotTrace } from '../shot';
import { isEyesDown } from '../suspicion';
import { inReach, lacksActions, registerAction } from './act';
import { knockOut, registerKnockoutWindow } from './knockout';

/*
 * The crew's attacks (GAME_DESIGN §6.3, §11.1, §11.8–11.11, §12.1; implementation plan M3-02, decisions 93–108).
 *
 * - **Attack** (`attack { crew, at, target?, lean?, turn?, bullets? }`): the drawn weapon (rules/arms.ts) at a tile,
 *   a tapped person, leaning out past a corner, turned by whole degrees, and the **fire selector**: 1 up to the
 *   weapon's Bullets and no more than the magazine holds (default: as many of both). 1 action, the LMG 2. The moving
 *   penalty if they moved this turn and aren't braced. In order: the checks (`attackPlan`, the shot's own geometry
 *   included), the action, the rounds, the lean, the facing, the noise (the weapon's radius: loud ones make the bank
 *   Loud), the witnesses and the end of the action in view, then the bullets (`finish`: `resolveShot`). The bullets
 *   are rolled; a preview stops just before them (`Dice.pictured`, decision 97): an attack's preview is everything
 *   before them and the cone (`attackCone`), never an outcome or a number (§11.7). The hits are dealt after the volley (decision 89): the taser's knock out (not through armour 2+),
 *   every other weapon's go to `dealHarm` (rules/damage.ts; wounds are M3-03's).
 * - **Melee strike** (`strike { crew, npc }`, §11.11): 1 action, in reach, on anyone not dead (fighting or not), 3 damage
 *   (Pierce 0, so armour counts), lethal, a quiet noise of 2. Never rolled: its preview is its outcome.
 * - **Taser**: the drawn taser's attack (§11.10): 4 tiles, a knockout on anyone up it hits, Hostile or reaching for a
 *   weapon too, but not through armour 2 or more; a quiet noise of 2.
 * - **Watch** (`watch { crew, at, arc, lean? }`, §11.8): all remaining actions (at least 1); the wedge is at most the
 *   weapon's widest (pistol, SMG, shotgun, LMG 60°, AR 45°, DMR 15°). It holds through the world phase after it
 *   (`Arms.watch`), unless suppressed. The first Hostile NPC that moves or acts inside it (decision 99) draws a volley:
 *   half the weapon's Bullets rounded up (no more than the magazine), Aim ×1.5 (×1 at 15° or narrower). A runner (an
 *   NPC fleeing) whose run passed through it inside the holder's Threat radius is shouted down instead: Commanded
 *   for free, where its run ended (decision 100).
 * - **Suppress** (`suppress { crew, at, arc?, lean? }`, §11.9): the LMG, 2 actions, a wedge of up to 60°: every bullet
 *   it has (up to its Bullets) with the spread doubled. Hostile NPCs in the wedge are **Suppressed** for the world phase
 *   after it (`NpcState.suppressed`; officers too, `PoliceUnit.suppressed`): Aim ×1.5 for their own shots
 *   (rules/routine.ts), no Watch, and one leaving the cover it had
 *   against the suppressor draws a free 1-bullet reaction shot; civilians in it are Commanded (2 pips). Who is in the
 *   wedge is decided before the roll, so the preview shows it.
 * - **Knockout windows** (§11.10): a Hostile NPC Surprised or Suppressed can be knocked out.
 *
 * In the wedge (`inWedge`): the tile's middle within half the arc of the wedge's middle line from the origin (exact
 * angles from geo/angles.ts), within the weapon's range, in line of sight from the origin.
 */

declare module '../../core/types' {
    interface CommandMap {
        /** Fire the drawn weapon (see the header). */
        attack: { crew: string; at: Pos; target?: string; lean?: Pos; turn?: number; bullets?: number };
        /** Strike the NPC `npc` in reach: 3 damage, lethal (1 action). */
        strike: { crew: string; npc: string };
        /** Watch a wedge `arc` degrees wide aimed at `at` through the world phase (all remaining actions). */
        watch: { crew: string; at: Pos; arc: number; lean?: Pos };
        /** Suppress a wedge with the LMG (2 actions). */
        suppress: { crew: string; at: Pos; arc?: number; lean?: Pos };
    }
    interface NpcState {
        /** Suppressed (§11.9) by `by` from `from` for the world phase of `turn`; `reacted` once its reaction shot is spent. */
        suppressed: { turn: number; by: string; from: Pos; reacted: boolean } | null;
        /**
         * Reeling from a flashbang (decision 103): the turn through whose crew phase it can still be knocked out though
         * Hostile, or null. Surprised lasts only the world phase the flashbang went off in; this is the crew's chance.
         */
        dazed: number | null;
    }
    interface EventMap {
        /** A crew member fired (the bullets are `shotFired`'s). */
        attacked: { crew: string; weapon: string; bullets: number; at: Pos; target?: string; mode: 'attack' | 'watch' | 'suppress' | 'reaction' };
        /** A taser dart knocked someone out or was stopped by armour. */
        tased: { crew: string; npc: string; stopped: boolean };
        struck: { crew: string; npc: string; damage: number };
        watching: { crew: string; at: Pos; arc: number };
        watchEnded: { crew: string; fired: boolean };
        /** A runner through a Watch wedge was shouted down (§11.8). */
        shoutedDown: { crew: string; npc: string };
        suppressedNpc: { crew: string; npc: string };
    }
}

/** The combat package's commands (M3-02): tests/sim/combat.property.test.ts plays them all. */
export const COMBAT_COMMANDS: ReadonlySet<string> = new Set([
    'attack', 'strike', 'watch', 'suppress', 'throwGrenade', 'flipTable', 'swap', 'reload', 'scavenge', 'handMag', 'brace'
]);

/**
 * The combat commands the stealth property tests' random players leave out (decision 108): those whose preview stops
 * at the bullets (an attack, the taser's included, and Suppress), and grenades, whose fuse changes the world phase after
 * them outside what the safe floor judges (decision 101). Everything else plays there.
 */
export const PICTURED_COMMANDS: ReadonlySet<string> = new Set(['attack', 'suppress', 'throwGrenade']);

// ---------------------------------------------------------------------------------------------------------- Wedges

/** Whether `p`'s tile middle lies in a wedge from `origin` aimed at `at`, `arc` degrees wide, within `range`, in sight. */
export function inWedge(sight: SightMap, origin: Pos, at: Pos, arc: number, range: number, p: Pos): boolean {
    const vx = p.x - origin.x, vy = p.y - origin.y, ax = at.x - origin.x, ay = at.y - origin.y;
    if ((!vx && !vy) || (!ax && !ay) || vx * vx + vy * vy > range * range) return false;
    const off = atan2Deg(ax * vy - ay * vx, ax * vx + ay * vy);
    return Math.abs(off) <= arc / 2 && lineOfSight(sight, origin, p);
}

/** Where a person stands to be shot or counted in a wedge: with whoever drags them, else where they are. */
const npcAt = (state: DeepReadonly<State>, npc: DeepReadonly<NpcState>): Pos => bodyPos(state, npc);

/** NPCs standing on the map, up: present, not stashed, not lying. */
const upright = (npc: DeepReadonly<NpcState>): boolean => !ABSENT_STATUSES.has(npc.status) && npc.stashed === null && !LYING_STATUSES.has(npc.status);

// ---------------------------------------------------------------------------------------------------------- Attack

/** The noise a weapon row makes (§8.9, §12.1), at its own radius. */
export const NOISE_OF: Readonly<Record<string, NoiseSource>> = {
    taser: 'taser', pistol: 'pistol', suppressedPistol: 'suppressedPistol', machinePistol: 'machinePistol', smg: 'smg',
    shotgun: 'shotgun', shotgunSlug: 'shotgun', assaultRifle: 'assaultRifle', dmr: 'dmr', lmg: 'lmg'
};

/** What an attack command fires: the shot, its cost and the weapon row. */
export interface AttackPlan { shot: Shot; cost: number; weapon: WeaponDef; load: string; item: string }

type AttackCmd = DeepReadonly<{ crew: string; at: Pos; target?: string; lean?: Pos; turn?: number; bullets?: number }>;

/** The shot an attack command fires and what it costs, or why it can't be fired now. */
export function attackPlan(world: ReadonlyWorld, state: State, cmd: AttackCmd, options: { cost?: number; spread?: number; allBullets?: boolean; paid?: boolean } = {}): AttackPlan | string {
    const member = state.crew.find(c => c.id === cmd.crew);
    if (!member) return `No crew member '${cmd.crew}'`;
    const fire = firing(member);
    if (typeof fire === 'string') return fire;
    const { item, gun } = fire, weapon = weaponDef(gun.load);
    const cost = options.cost ?? (HEAVY_FIRE.has(item) ? 2 : 1);
    // Once its reducer has paid for it, the actions are spent: nothing else the plan reads has changed.
    const lack = options.paid ? undefined : lacksActions(member, cost);
    if (lack) return lack;
    if (gun.loaded < 1) return `The ${item} is empty: reload`;
    if (cmd.bullets !== undefined && cmd.bullets > gun.loaded) return `The ${item} has ${gun.loaded} rounds left`;
    const bullets = options.allBullets ? Math.min(weapon.bullets, gun.loaded) : cmd.bullets ?? Math.min(weapon.bullets, gun.loaded);
    const shot: Shot = { shooter: member.id, weapon: gun.load, at: { x: cmd.at.x, y: cmd.at.y }, bullets, moved: movedThisTurn(state, member), braced: bracedWith(member, item) };
    // Hurt, they aim worse (§11.12).
    const hurt = woundAim(world, member);
    if (hurt !== 1) shot.aimFactor = hurt;
    if (cmd.target !== undefined) shot.target = cmd.target;
    // Already leaning out, they fire from the lean tile unless told otherwise (their hitbox is there, decision 90).
    const lean = cmd.lean ?? member.leaning?.at;
    if (lean !== undefined) shot.lean = { x: lean.x, y: lean.y };
    if (cmd.turn !== undefined) shot.turn = cmd.turn;
    if (options.spread !== undefined) shot.spread = options.spread;
    const refused = shotRefusal(world, state, shot);
    if (refused) return refused;
    return { shot, cost, weapon, load: gun.load, item };
}

/** Whether a shot with this weapon is braced: on the bipod, and the weapon has one (the DMR, the LMG). */
const bracedWith = (member: DeepReadonly<CrewState>, item: string): boolean => member.arms.braced && BRACEABLE.has(item);

/** Leans the shooter out, if the shot does (§11.4: until their side's next phase or a move). */
function leanOut(world: ReadonlyWorld, state: State, member: CrewState, lean: DeepReadonly<Pos> | undefined): void {
    if (!lean) return;
    member.leaning = leanOptions(world, state, member.id).find(l => samePos(l.at, lean)) ?? null;
}

type FireMode = 'attack' | 'watch' | 'suppress' | 'reaction';

/**
 * Sets up a planned shot (decision 97): the rounds, the facing, the noise (and Loud), and the shot itself in
 * `Arms.aiming`, which `loose` fires. An action does this in its run, so its witnesses and its end in view come before
 * the bullets and its preview, stopping at them, shows them all.
 */
function aimShot(ctx: Ctx, member: CrewState, plan: AttackPlan, mode: FireMode): void {
    const { state } = ctx, { shot } = plan;
    const gun = member.arms.guns[plan.item]!, bullets = shot.bullets!;
    gun.loaded -= bullets;
    const origin = shot.lean ?? member.pos;
    if (mode === 'attack' || mode === 'suppress') member.facing = facingToward(origin, shot.at) ?? member.facing;
    const event: { type: 'attacked'; crew: string; weapon: string; bullets: number; at: Pos; target?: string; mode: FireMode } = {
        type: 'attacked', crew: member.id, weapon: plan.load, bullets, at: { ...shot.at }, mode
    };
    if (shot.target !== undefined) event.target = shot.target;
    ctx.emit(event);
    // Aimed at an officer the crew sees, hit or miss: Negotiate is over and they see where it came from (rules/police.ts).
    // One it doesn't see answers only once the bullets fly (`loose`), so no preview tells of it.
    if (shot.target !== undefined && officerSeen(ctx.world, state, shot.target)) policeShotAt(ctx, shot.target, member.id, origin);
    const source = NOISE_OF[plan.load]!;
    makeNoise(ctx, source, origin, `${plan.load} ${member.id}`, plan.weapon.noise, member.id);
    if (NOISES[source].kind === 'loud' && !state.bank.loud) {
        state.bank.loud = true;
        ctx.emit({ type: 'wentLoud', cause: `${plan.load} ${member.id}` });
    }
    member.arms.aiming = { shot: clonePlain(shot), mode };
}

/**
 * Fires the shot `aimShot` set up: the bullets are rolled (a preview stops here and shows the cone instead, §11.7),
 * then the hits are dealt after the volley (decision 89). Returns the outcome (commit only).
 */
function loose(ctx: Ctx, member: CrewState): ShotTrace {
    const { world, state } = ctx, aiming = member.arms.aiming;
    if (!aiming) throw new Error(`${member.id} has no shot set up to fire`);
    const { shot, mode } = aiming;
    ctx.dice.pictured('combat', `${mode} ${member.id}`);
    member.arms.aiming = null;
    // Past the preview's stop: every officer shot at answers now, seen or not (`aimShot` told of the seen ones).
    const from = shot.lean ?? member.pos;
    if (shot.target !== undefined) policeShotAt(ctx, shot.target, member.id, from);
    for (const u of [...state.police.units]) if (u.suppressed?.by === member.id && u.suppressed.turn === state.turn && mode === 'suppress') policeShotAt(ctx, u.id, member.id, from);
    const trace = resolveShot(ctx, shot);
    for (const hit of trace.hits) {
        if (!hit.knockout) {
            dealHarm(ctx, { target: hit.id, by: member.id, cause: 'shot', weapon: shot.weapon, hits: hit.hits, damage: hit.damage, lethal: true });
            continue;
        }
        const npc = state.npcs.find(n => n.id === hit.id);
        // A dart in a crew member does nothing to the rules yet (M3-03); one in someone already down is spent.
        // Nor in someone face down or tied: nothing to knock out, as with a knockout by hand (and it would untie them);
        // nor in a hostage let go, walking out under the deal (rules/negotiation.ts, `knockOut`).
        if (!npc || npc.lapse?.kind === 'released' || npc.status === 'unconscious' || npc.status === 'dead' || npc.status === 'tied' || npc.status === 'commanded' || ABSENT_STATUSES.has(npc.status)) continue;
        const stopped = armourOf(world, state, npc.id) >= TASER_STOPPED_BY;
        ctx.emit({ type: 'tased', crew: member.id, npc: npc.id, stopped });
        if (!stopped) knockOut(ctx, npc, member.id);
    }
    return trace;
}

/** Sets up and fires at once: a reaction in the world phase (Watch, a suppressed NPC leaving cover). */
function fireNow(ctx: Ctx, member: CrewState, plan: AttackPlan, mode: FireMode): ShotTrace {
    aimShot(ctx, member, plan, mode);
    return loose(ctx, member);
}

registerAction('attack', {
    whyNot(world, state, cmd) {
        const plan = attackPlan(world, state, cmd);
        return typeof plan === 'string' ? plan : undefined;
    },
    candidates: (world, state, member) => [
        ...targetsInRange(world, state, member).map(n => ({ type: 'attack' as const, crew: member.id, at: { ...npcAt(state, n) }, target: n.id })),
        ...officersInRange(world, state, member).map(u => ({ type: 'attack' as const, crew: member.id, at: { ...u.pos! }, target: u.id }))
    ],
    cost(world, state, cmd) {
        const plan = attackPlan(world, state, cmd);
        return typeof plan === 'string' ? 1 : plan.cost;
    },
    illegal: () => ({ act: 'attack' }),
    run(ctx, member, cmd) {
        const plan = attackPlan(ctx.world, ctx.state, cmd, { paid: true });
        if (typeof plan === 'string') throw new Error(`An attack checked and paid for failed: ${plan}`);
        leanOut(ctx.world, ctx.state, member, plan.shot.lean);
        aimShot(ctx, member, plan, 'attack');
    },
    finish(ctx, member) {
        loose(ctx, member);
    }
});

/**
 * The NPCs a crew member could aim at from where they stand with the drawn weapon: up, within its range and in line of
 * sight (the truth; the grid keeps those the crew knows of). In resolution order.
 */
export function targetsInRange(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>): DeepReadonly<NpcState>[] {
    const fire = firing(member);
    if (typeof fire === 'string') return [];
    const range = weaponDef(fire.gun.load).range, sight = sightMap(world, state);
    return state.npcs.filter(n => {
        if (!upright(n) || state.crew.some(c => c.dragging === n.id)) return false;
        const p = n.pos, dx = p.x - member.pos.x, dy = p.y - member.pos.y;
        return (dx || dy) && dx * dx + dy * dy <= range * range && lineOfSight(sight, member.pos, p);
    });
}

/** The officers out on scene a crew member could aim at with the drawn weapon (as `targetsInRange`). */
export function officersInRange(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>): DeepReadonly<State['police']['units'][number]>[] {
    const fire = firing(member);
    if (typeof fire === 'string') return [];
    const range = weaponDef(fire.gun.load).range, sight = sightMap(world, state);
    return state.police.units.filter(u => {
        if (!u.pos) return false;
        const dx = u.pos.x - member.pos.x, dy = u.pos.y - member.pos.y;
        return (dx || dy) && dx * dx + dy * dy <= range * range && lineOfSight(sight, member.pos, u.pos);
    });
}

// ---------------------------------------------------------------------------------------------------------- Melee strike

/** Why a crew member can't strike this NPC now, or undefined (§11.11: it always works on anyone up in reach). */
export function strikeBlocked(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, npcId: string): string | undefined {
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    if (member.dragging !== null) return `${member.name}'s hands are full`;
    const npc = state.npcs.find(n => n.id === npcId);
    if (!npc) return `No one called '${npcId}'`;
    if (ABSENT_STATUSES.has(npc.status) || npc.stashed !== null || npc.status === 'dead') return 'There is no one to strike';
    if (state.crew.some(c => c.dragging === npcId)) return 'They are being dragged';
    return inReach(world, state, member.pos, npc.pos) ? undefined : `${member.name} can't reach them from here`;
}

registerAction('strike', {
    whyNot: (world, state, cmd) => strikeBlocked(world, state, crewMember(state, cmd.crew), cmd.npc),
    candidates: (_world, state, member) => state.npcs.map(n => ({ type: 'strike', crew: member.id, npc: n.id })),
    cost: () => 1,
    illegal: (_world, state, cmd) => ({
        act: 'attack', tiles: [crewMember(state, cmd.crew).pos, state.npcs.find(n => n.id === cmd.npc)!.pos].map(p => ({ x: p.x, y: p.y }))
    }),
    run(ctx, member, cmd) {
        const { world, state } = ctx, npc = state.npcs.find(n => n.id === cmd.npc)!;
        member.facing = facingToward(member.pos, npc.pos) ?? member.facing;
        // §11.5's formula with Pierce 0: armour counts.
        const damage = Math.max(0, STRIKE.damage - Math.max(0, armourOf(world, state, npc.id) - STRIKE.pierce));
        ctx.emit({ type: 'struck', crew: member.id, npc: npc.id, damage });
        makeNoise(ctx, 'meleeStrike', npc.pos, `strike ${npc.id}`);
        dealHarm(ctx, { target: npc.id, by: member.id, cause: 'strike', weapon: 'strike', hits: 1, damage, lethal: true });
    }
});

// ---------------------------------------------------------------------------------------------------------- Watch

type WatchCmd = DeepReadonly<{ crew: string; at: Pos; arc: number; lean?: Pos }>;

/** Why a crew member can't set this Watch wedge now, or undefined. */
export function watchBlocked(world: ReadonlyWorld, state: State, cmd: WatchCmd): string | undefined {
    const member = state.crew.find(c => c.id === cmd.crew);
    if (!member) return `No crew member '${cmd.crew}'`;
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    const fire = firing(member);
    if (typeof fire === 'string') return fire;
    if (fire.gun.loaded < 1) return `The ${fire.item} is empty: reload`;
    const widest = WATCH_ARC[fire.gun.load] ?? 60;
    if (!Number.isInteger(cmd.arc) || cmd.arc < 1 || cmd.arc > widest) return `A ${fire.item}'s wedge is 1° to ${widest}°, not ${cmd.arc}`;
    if (!inBounds(world, cmd.at)) return `(${cmd.at.x}, ${cmd.at.y}) is off the map`;
    // The wedge's geometry is a shot's: a lean they can make, an aim away from where they fire.
    const lean = cmd.lean ?? member.leaning?.at;
    return shotRefusal(world, state, { shooter: member.id, weapon: fire.gun.load, at: { x: cmd.at.x, y: cmd.at.y }, bullets: 1, ...(lean ? { lean: { x: lean.x, y: lean.y } } : {}) });
}

registerAction('watch', {
    whyNot: (world, state, cmd) => watchBlocked(world, state, cmd),
    candidates(world, state, member) {
        const fire = firing(member);
        if (typeof fire === 'string') return [];
        const arc = WATCH_ARC[fire.gun.load] ?? 60;
        return targetsInRange(world, state, member).map(n => ({ type: 'watch', crew: member.id, at: { ...n.pos }, arc }));
    },
    // All remaining actions, at least 1 (§11.8).
    cost: (_world, state, cmd) => Math.max(1, crewMember(state, cmd.crew).actionsLeft),
    run(ctx, member, cmd) {
        const lean = cmd.lean ?? member.leaning?.at;
        leanOut(ctx.world, ctx.state, member, lean);
        const origin = lean ?? member.pos;
        member.facing = facingToward(origin, cmd.at) ?? member.facing;
        member.arms.watch = { at: { x: cmd.at.x, y: cmd.at.y }, arc: cmd.arc, lean: lean ? { x: lean.x, y: lean.y } : null, turn: ctx.state.turn };
        ctx.emit({ type: 'watching', crew: member.id, at: { x: cmd.at.x, y: cmd.at.y }, arc: cmd.arc });
    }
});

// A wedge holds through the world phase after it; the next crew phase begins without it.
registerWorldHook('crewPhase', 'attack.watchEnds', ctx => {
    for (const member of ctx.state.crew) {
        if (!member.arms.watch) continue;
        member.arms.watch = null;
        ctx.emit({ type: 'watchEnded', crew: member.id, fired: false });
    }
}, { order: -90 });

// ---------------------------------------------------------------------------------------------------------- Suppress

type SuppressCmd = DeepReadonly<{ crew: string; at: Pos; arc?: number; lean?: Pos }>;

/** The shot a Suppress command fires and its wedge's arc, or why it can't be fired. */
export function suppressPlan(world: ReadonlyWorld, state: State, cmd: SuppressCmd, paid = false): (AttackPlan & { arc: number }) | string {
    const member = state.crew.find(c => c.id === cmd.crew);
    if (!member) return `No crew member '${cmd.crew}'`;
    if (member.arms.drawn === null || !SUPPRESS.weapons.includes(member.arms.drawn)) return `Only an LMG can suppress`;
    const arc = cmd.arc ?? SUPPRESS.arc;
    if (!Number.isInteger(arc) || arc < 1 || arc > SUPPRESS.arc) return `A suppressing wedge is 1° to ${SUPPRESS.arc}°, not ${arc}`;
    const plan = attackPlan(world, state, { crew: cmd.crew, at: cmd.at, ...(cmd.lean ? { lean: cmd.lean } : {}) }, { cost: SUPPRESS.cost, spread: SUPPRESS.spread, allBullets: true, paid });
    return typeof plan === 'string' ? plan : { ...plan, arc };
}

/** Who a Suppress wedge holds: the Hostile it suppresses and the civilians it puts down, in resolution order. */
export function suppressTargets(world: ReadonlyWorld, state: State, crewId: string, plan: AttackPlan & { arc: number }): { suppressed: string[]; commanded: string[] } {
    const member = crewMember(state, crewId), origin = plan.shot.lean ?? member.pos, sight = sightMap(world, state);
    const out = { suppressed: [] as string[], commanded: [] as string[] };
    for (const npc of state.npcs) {
        if (!upright(npc) || !inWedge(sight, origin, plan.shot.at, plan.arc, plan.weapon.range, npcAt(state, npc))) continue;
        if (npc.status === 'hostile') out.suppressed.push(npc.id);
        else if (personOf(world, npc.id).observer === 'civilian' && !isEyesDown(npc)) out.commanded.push(npc.id);
    }
    // Officers out on scene are foes as a Hostile NPC is (rules/routine.ts).
    for (const u of state.police.units) if (u.pos && inWedge(sight, origin, plan.shot.at, plan.arc, plan.weapon.range, u.leaning?.at ?? u.pos)) out.suppressed.push(u.id);
    return out;
}

registerAction('suppress', {
    whyNot(world, state, cmd) {
        const plan = suppressPlan(world, state, cmd);
        return typeof plan === 'string' ? plan : undefined;
    },
    candidates: (world, state, member) => (member.arms.drawn !== null && SUPPRESS.weapons.includes(member.arms.drawn)
        ? targetsInRange(world, state, member).map(n => ({ type: 'suppress', crew: member.id, at: { ...n.pos } }))
        : []),
    cost: () => SUPPRESS.cost,
    illegal: () => ({ act: 'attack' }),
    run(ctx, member, cmd) {
        const { world, state } = ctx;
        const plan = suppressPlan(world, state, cmd, true);
        if (typeof plan === 'string') throw new Error(`A Suppress checked and paid for failed: ${plan}`);
        leanOut(world, state, member, plan.shot.lean);
        // Who is in the wedge is decided before the roll: the preview shows it (§11.9).
        const held = suppressTargets(world, state, member.id, plan);
        for (const id of held.suppressed) {
            const npc = state.npcs.find(n => n.id === id) ?? state.police.units.find(u => u.id === id)!;
            npc.suppressed = { turn: state.turn, by: member.id, from: { ...npc.pos! }, reacted: false };
            ctx.emit({ type: 'suppressedNpc', crew: member.id, npc: id });
            // As at an aimed shot: a seen officer's answer shows in the preview, a hidden one's waits for the bullets.
            if (officerSeen(world, state, id)) policeShotAt(ctx, id, member.id, plan.shot.lean ?? member.pos);
        }
        for (const id of held.commanded) commandNpc(ctx, state.npcs.find(n => n.id === id)!, member.id, SUPPRESS.pips);
        aimShot(ctx, member, plan, 'suppress');
    },
    finish(ctx, member) {
        loose(ctx, member);
    }
});

registerNpcInit('attack', (_world, _person, npc) => {
    npc.suppressed = null;
    npc.dazed = null;
});

// Dazed by a flashbang (decision 103): still reeling through the crew phase after the world phase it lost.
registerWorldHook('fuses', 'attack.dazedEnds', (ctx, phase) => {
    for (const npc of ctx.state.npcs) if (npc.dazed !== null && npc.dazed <= phase.turn) npc.dazed = null;
}, { order: -10 });

// Suppressed for one world phase (§11.9): over before the next intents are committed.
registerWorldHook('commitIntents', 'attack.suppressionEnds', (ctx, phase) => {
    for (const npc of ctx.state.npcs) if (npc.suppressed && npc.suppressed.turn <= phase.turn) npc.suppressed = null;
    for (const unit of ctx.state.police.units) if (unit.suppressed && unit.suppressed.turn <= phase.turn) unit.suppressed = null;
}, { order: -50 });

registerKnockoutWindow('surprised', npc => npc.surprised !== null);
registerKnockoutWindow('suppressed', npc => npc.suppressed !== null);
registerKnockoutWindow('dazed', npc => npc.dazed !== null);

// ---------------------------------------------------------------------------------------------------------- Reactions

/** The tiles of its committed path an NPC walked this phase: up to where it stands now. */
function walkedTiles(npc: DeepReadonly<NpcState>, phase: WorldPhase): Pos[] {
    const path = phase.intents[npc.id]?.path ?? [];
    const i = path.findIndex(p => samePos(p, npc.pos));
    return i < 0 ? [] : path.slice(0, i + 1).map(p => ({ x: p.x, y: p.y }));
}

/** Whether an NPC moved or acted this world phase: walked, carried out an action, or turned Hostile (drew). */
function movedOrActed(npc: DeepReadonly<NpcState>, phase: WorldPhase): boolean {
    const intent = phase.intents[npc.id];
    return walkedTiles(npc, phase).length > 0 || !!intent?.action || phase.status[npc.id] !== npc.status;
}

/** Someone the crew's reactions fire at: a Hostile NPC or a police officer out on scene, where they are hit. */
interface Foe { id: string; at: Pos }

/** The foes on the map now, in resolution order: Hostile NPCs up, then officers out on scene (rules/police.ts). */
function foes(state: State): Foe[] {
    const out: Foe[] = state.npcs.filter(n => n.status === 'hostile' && upright(n)).map(n => ({ id: n.id, at: { ...npcAt(state, n) } }));
    for (const u of state.police.units) if (u.pos) out.push({ id: u.id, at: { ...(u.leaning?.at ?? u.pos) } });
    return out;
}

/** A crew member's Watch volley or reaction shot at a foe: the planned shot, or why it can't fly (then it doesn't). */
function reactionPlan(world: ReadonlyWorld, state: State, member: CrewState, npc: Foe, bullets: (w: WeaponDef) => number, aimFactor: number, lean: Pos | null): AttackPlan | undefined {
    const fire = firing(member);
    if (typeof fire === 'string' || fire.gun.loaded < 1) return undefined;
    const weapon = weaponDef(fire.gun.load);
    const shot: Shot = {
        shooter: member.id, weapon: fire.gun.load, at: { ...npc.at }, target: npc.id, bullets: Math.min(bullets(weapon), fire.gun.loaded),
        moved: movedThisTurn(state, member), braced: bracedWith(member, fire.item), aimFactor: aimFactor * woundAim(world, member)
    };
    const from = lean ?? member.leaning?.at;
    if (from) shot.lean = { ...from };
    // Someone stepped onto the lean tile, or the target is beside them on it: no clean shot, so none is fired.
    if (shotRefusal(world, state, shot)) return undefined;
    return { shot, cost: 0, weapon, load: fire.gun.load, item: fire.item };
}

/**
 * The crew's reactions in the world phase, after the passive walks and draws (§11.8, §11.9): runners through a Watch
 * wedge shouted down; each wedge's volley at the first Hostile that moved or acted in it; each suppressed Hostile that
 * left its cover drawing its suppressor's one bullet. Fighters acting one at a time (rules/routine.ts) call `watchReact` as they act.
 */
function reactions(ctx: Ctx, phase: WorldPhase): void {
    const { world, state } = ctx;
    for (const member of state.crew) {
        const watch = member.arms.watch;
        if (!watch || watch.turn !== phase.turn) continue;
        const fire = firing(member);
        if (typeof fire === 'string') continue;
        const origin = watch.lean ?? member.pos, range = weaponDef(fire.gun.load).range, sight = sightMap(world, state);
        const threat = crewThreat(member);
        // A runner inside the Threat radius is shouted down, not shot (§11.8): once the bank is loud, when the shout costs
        // nothing more than the guns already did (decision 100). In a quiet bank a Watch shouts no one down.
        for (const npc of state.bank.loud ? state.npcs : []) {
            if (phase.intents[npc.id]?.action?.kind !== 'flee' || !upright(npc) || npc.status === 'hostile') continue;
            const through = walkedTiles(npc, phase).some(p => {
                const dx = p.x - member.pos.x, dy = p.y - member.pos.y;
                return dx * dx + dy * dy <= threat * threat && inWedge(sight, origin, watch.at, watch.arc, range, p);
            });
            if (!through) continue;
            commandNpc(ctx, npc, member.id, world.rules.commandPips);
            ctx.emit({ type: 'shoutedDown', crew: member.id, npc: npc.id });
        }
        // Officers act later in the phase, one at a time: they call `watchReact` as they go.
        watchReactNow(ctx, member, sight, id => {
            const npc = state.npcs.find(n => n.id === id);
            return !!npc && movedOrActed(npc, phase);
        });
    }
    for (const npc of state.npcs) suppressReact(ctx, phase, npc.id);
}

/**
 * A Suppressed foe leaving its cover (§11.9, decision 105): if `npcId` (a Hostile NPC or an officer) has walked off the
 * tile it was suppressed on, where it had half cover against its suppressor, the suppressor fires its one free bullet
 * at it, once. The passive step asks it of every NPC; the fighters acting one at a time (rules/routine.ts) call it as
 * each one moves. Whether a shot was fired.
 */
export function suppressReact(ctx: Ctx, phase: WorldPhase, npcId: string): boolean {
    const { world, state } = ctx, npc = state.npcs.find(n => n.id === npcId), unit = npc ? undefined : state.police.units.find(u => u.id === npcId);
    const s = npc?.suppressed ?? unit?.suppressed, pos = npc?.pos ?? unit?.pos;
    if (!s || !pos || s.reacted || s.turn !== phase.turn || samePos(s.from, pos) || (npc && !upright(npc))) return false;
    const member = state.crew.find(c => c.id === s.by);
    if (!member) return false;
    // Leaving cover: it had half cover against the suppressor where it was suppressed (§11.9).
    const map = shotMap(world, state), fabric = shotFabric(world, state, map, state.cover);
    const had = coverAgainst(map, fabric, { id: npcId, pos: s.from, standing: true, shield: false, armour: 0, precise: false }, member.leaning?.at ?? member.pos);
    if (!had) return false;
    const foe = foes(state).find(f => f.id === npcId);
    if (!foe) return false;
    const plan = reactionPlan(world, state, member, foe, () => 1, 1, member.leaning?.at ?? null);
    if (!plan) return false;
    s.reacted = true;
    fireNow(ctx, member, plan, 'reaction');
    return true;
}

/** A Watch wedge's volley at the first foe in it that `stirred` says moved or acted; ends the Watch when it fires. */
function watchReactNow(ctx: Ctx, member: CrewState, sight: SightMap, stirred: (id: string) => boolean): boolean {
    const { world, state } = ctx, watch = member.arms.watch;
    if (!watch) return false;
    const fire = firing(member);
    if (typeof fire === 'string') return false;
    const origin = watch.lean ?? member.pos, range = weaponDef(fire.gun.load).range;
    const npc = foes(state).find(f => stirred(f.id) && inWedge(sight, origin, watch.at, watch.arc, range, f.at));
    if (!npc) return false;
    const aim = watch.arc <= WATCH_NARROW ? 1 : WATCH_AIM;
    const plan = reactionPlan(world, state, member, npc, w => Math.ceil(w.bullets / 2), aim, watch.lean);
    if (!plan) return false;
    member.arms.watch = null;
    ctx.emit({ type: 'watchEnded', crew: member.id, fired: true });
    fireNow(ctx, member, plan, 'watch');
    return true;
}

/**
 * For the fighters that act one at a time (rules/routine.ts: Hostile NPCs and officers): call as `npcId` moves or acts
 * in the world phase; every crew Watch wedge it is in fires its volley at it (§11.8). Whether anyone fired.
 */
export function watchReact(ctx: Ctx, phase: WorldPhase, npcId: string): boolean {
    let fired = false;
    for (const member of ctx.state.crew) {
        if (!member.arms.watch || member.arms.watch.turn !== phase.turn) continue;
        if (watchReactNow(ctx, member, sightMap(ctx.world, ctx.state), id => id === npcId)) fired = true;
    }
    return fired;
}

registerWorldHook('passiveNpcs', 'attack.reactions', reactions, { order: 7.5 });

registerEvents({
    attacked: { undoBlocking: true },
    tased: { undoBlocking: true },
    struck: { undoBlocking: true },
    watching: { undoBlocking: false },
    watchEnded: { undoBlocking: false },
    shoutedDown: { undoBlocking: true },
    suppressedNpc: { undoBlocking: true }
});
