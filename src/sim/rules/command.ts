import { registerWorldHook, type Ctx } from '../core/engine';
import { inBounds, samePos } from '../core/grid';
import { crewMember, registerCrewInit, registerNpcInit, registerRuleDefaults, registerStateInit } from '../core/state';
import type { CrewState, DeepReadonly, NpcState, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { panicWeights } from '../data/archetypes';
import { CARRY_WEIGHT, itemDef, UNARMED_THREAT } from '../data/items';
import { HALF_STEPS_PER_TILE } from '../data/movement';
import { lineOfSight, sightMap, type SightMap } from '../geo/los';
import { reachable, reachAt } from '../geo/move';
import { DEAF_STATUSES, makeNoise, noiseRadius, npcsInside, soundRing } from '../geo/sound';
import { lacksActions, registerAction } from './actions/act';
import { startEscapee } from './alarms';
import { npcMoveOptions, isPresent, personOf } from './npc/walk';
import { reconsider } from './npc/intent';
import { witnessAct } from './perceive';
import { alertNpc, expose, isEyesDown } from './suspicion';

/*
 * Crowd control (§9.3, §10.1–10.5, §6.3 Mask up): the command, its rings, the Commanded state, Hold, lapses and GO.
 *
 * - **Threat** (§12.1) is the highest of the weapons a crew member has in hand (`Loadout.items`; one in the duffel or
 *   its case doesn't count, nor a long gun with a crate or a body in the hands, §15.1), unarmed 1. The **command
 *   radius** is the Threat, ×1.5 on the takeover turn, rounded down (an LMG's 6 becomes 9, a pistol's 3 becomes 4).
 * - **Command** ("Get down!", `command { crew }`): 1 action, an illegal act, and doesn't end the turn. Its rings
 *   (`commandPlan`, the one reading of them: the reducer applies it, the preview shows it):
 *   - **Command ring:** NPCs within the radius (Euclidean, r² ≤ R²) in line of sight of the shouter. Ordinary NPCs
 *     always comply: Commanded, `rules.commandPips` (2) pips, face down, their intent dropped (a button not yet
 *     pressed stays unpressed), a civilian no longer Alerted (§8.7); re-commanding refreshes the pips. Resisters
 *     (enforcers: guards, the security chief, couriers) roll their shown chance (§10.4): 40%; 10% with 2+ crew aiming
 *     at them (a crew member with a weapon in hand, within their own radius, in line of sight) or Surprised; halved
 *     when the shouter is Intimidating. Hostile NPCs and NPCs reaching for a weapon ignore it.
 *   - **Panic and noise ring:** the shout is a loud noise of radius R + 3 (§8.9 flood): everyone it reaches outside
 *     the command ring hears it as any loud noise (Alerted, one reports it: rules/evidence.ts), and the bank is Loud.
 *     How a panicking civilian reacts (cower, flee, hide) is M2-02's; until then a civilian reacts as to any loud noise.
 *   The compliant are commanded first, then each resister rolls in resolution order: a preview stops at the first roll
 *   (`Dice.odds`), so `commandPlan` is what shows every chance.
 * - **Commanded** (§10.2): `NpcState.command { pips, by }`, eyes down, and every carrier it holds countered (§9.1
 *   "command", carriers.ts): a lapse that goes for the alarm again starts a fresh one. A pip goes at the end of every
 *   world phase unless a crew member **Holds** it (§10.3: `hold { crew }`, their last action, spending what is left,
 *   `CrewState.holding`): every Commanded NPC within the holder's command radius that turn (×1.5 on the takeover turn)
 *   and line of sight as the crew phase ends (`holdTargets`, judged as the world phase begins) keeps its pips.
 * - **Lapses** (§10.5): a Commanded NPC whose pips are 0 at the end of a world phase (and nobody holds it) is
 *   **Twitchy**: its next intent is rolled then, as the next crew phase begins, and shown during that crew phase. The
 *   odds are its archetype's panic weights (data/archetypes.ts): cower and hide (no hiding place yet: M2-02) **stay
 *   down** (it stays Commanded at 0 pips, `stayDown` intent, and rolls again after the next world phase); **flee** runs
 *   for the nearest way out, the run path its intent (`flee`), and starts an escapee carrier of max(2, ⌈way left ÷ 8⌉)
 *   as it sets off (decision 30's pattern: the intent is the telegraph, the carrier is seen at its full count); one
 *   at the way out leaves the map a phase after its carrier started, never with it; **go for the alarm** (staff) gets
 *   up Alerted and Exposed to whoever commanded it, and reacts by role (the teller's button, the operator's console,
 *   telling a guard), or phones it in where it lies (the manager's "phone", `phone` lapse). An enforcer whose command lapses
 *   **reaches for his weapon**: telegraphed for one world phase (`reachForWeapon`), in which he draws and turns Hostile
 *   (combat is M3); commands no longer work on him, but he can still be knocked out while reaching. Police outside
 *   shifting the odds toward fleeing, heroes and their tackle are M2-02's and M3's.
 * - **GO** (§9.3, `go { crew }`): once per heist while the bank isn't Loud, free. The current crew phase becomes the
 *   takeover turn (`State.takeover`): every crew member masks up (an illegal act seen like any other) and gets +1
 *   action; command radii are ×1.5; every NPC Calm or Curious is **Surprised** (`NpcState.surprised`): its intent is
 *   dropped and it loses the coming world phase standing (it still sees and hears, and acts on it a phase later), and
 *   a surprised civilian counts as Commanded for one phase (1 pip). A crew member who already Held gets no third action.
 * - **Mask up** (§6.3, `maskUp { crew }`): 1 action, an illegal act; Heavy. GO's masks are free.
 */

/** A crew member's hold on the commanded around them (§10.3). */
export interface Commanded { pips: number; by: string }

/** What a lapse rolled that outlasts the crew phase it is shown in (§10.5). */
export type Lapse = { kind: 'flee'; exit: Pos } | { kind: 'reach'; crew: string } | { kind: 'phone'; crew: string };

/** What a lapse can roll (§10.5), as the `lapsed` event names it. */
export type LapseOutcome = 'stayDown' | 'flee' | 'alarm' | 'phone' | 'reachForWeapon';

declare module '../core/types' {
    interface NpcState {
        /** Commanded (§10.2): its pips and who commanded it, or null. Pips 0: Twitchy, its lapse rolled (§10.5). */
        command: Commanded | null;
        /** A lapse it is carrying out (fleeing, reaching for a weapon), or null. */
        lapse: Lapse | null;
        /** Surprised by GO (§9.3): the turn whose world phase it loses, or null. */
        surprised: number | null;
    }
    interface CrewState {
        /** Holding (§10.3): the turn whose world phase it holds the commanded around it, or null. */
        holding: number | null;
    }
    interface State {
        /** The takeover turn (§9.3 GO), or null while GO hasn't been pressed. */
        takeover: number | null;
    }
    interface Rules {
        /** Pips a command gives (§10.2). */
        commandPips: number;
    }
    interface CommandMap {
        /** "Get down!" (§10.1): 1 action. */
        command: { crew: string };
        /** Hold the room (§10.3): the crew member's last action. */
        hold: { crew: string };
        /** GO (§9.3): the takeover turn. Free, once per heist. */
        go: { crew: string };
        /** Mask up (§6.3): 1 action, free on the takeover turn. */
        maskUp: { crew: string };
    }
    interface IntentActionMap {
        /** A Twitchy NPC stays down this world phase (§10.5). */
        stayDown: Record<never, never>;
        /** Runs for the way out `exit` (§10.5): the escapee carrier starts as it sets off; it leaves the map there. */
        flee: { exit: Pos };
        /** Draws in the coming world phase and turns Hostile (§10.5, §10.9). */
        reachForWeapon: { crew: string };
    }
    interface EventMap {
        /** An NPC went face down for a crew member (§10.2): `pips` command pips. */
        commanded: { crew: string; npc: string; pips: number };
        /** A resister rolled its chance and resisted (§10.4). */
        resisted: { crew: string; npc: string; chance: number };
        /** An NPC in the command ring ignored it (Hostile, or reaching for a weapon). */
        ignoredCommand: { crew: string; npc: string };
        /** A Commanded NPC's pips at the end of a world phase; `held` when a hold kept them. */
        commandPips: { npc: string; pips: number; held: boolean };
        /** A Twitchy NPC's lapse was rolled (§10.5). */
        lapsed: { npc: string; outcome: LapseOutcome };
        /** An NPC drew its weapon (§10.9) and is Hostile. */
        drewWeapon: { npc: string };
        holding: { crew: string };
        tookOver: { crew: string };
        surprised: { npc: string };
        maskedUp: { crew: string };
    }
}

registerRuleDefaults({ commandPips: 2 });

registerNpcInit('command', (_world, _person, npc) => {
    npc.command = null;
    npc.lapse = null;
    npc.surprised = null;
});

registerCrewInit('command', (_world, _start, member) => {
    member.holding = null;
});

registerStateInit('takeover', (_world, state) => {
    state.takeover = null;
});

// ---------------------------------------------------------------------------------------------------------- Threat

/**
 * The weapons a crew member has in hand: everything with a Threat they carry, only the sidearms with a Very heavy
 * carry (a crate or a body: "pistol only", §15.1).
 */
function weaponsInHand(member: DeepReadonly<CrewState>): string[] {
    const sidearmsOnly = member.loadout.carrying !== null && CARRY_WEIGHT[member.loadout.carrying] === 'very heavy';
    return member.loadout.items.filter(id => itemDef(id).threat !== undefined && (!sidearmsOnly || itemDef(id).slot === 'sidearm'));
}

/** A crew member's Threat (§12.1): the highest of the weapons in hand, unarmed 1. */
export function crewThreat(member: DeepReadonly<CrewState>): number {
    let threat = UNARMED_THREAT;
    for (const id of weaponsInHand(member)) threat = Math.max(threat, itemDef(id).threat!);
    return threat;
}

/** Whether a crew member has a weapon in hand (one that can be aimed: anything with a Threat). */
const armed = (member: DeepReadonly<CrewState>): boolean => weaponsInHand(member).length > 0;

/** A crew member's command radius now (§10.1): the Threat, ×1.5 on the takeover turn, rounded down. */
export function commandRadius(state: DeepReadonly<State>, member: DeepReadonly<CrewState>): number {
    const threat = crewThreat(member);
    return state.takeover === state.turn ? Math.floor((threat * 3) / 2) : threat;
}

/** Whether `p` is within `radius` of `from` (Euclidean, §6 decision 3) and in line of sight of it. */
function inCommandReach(sight: SightMap, from: DeepReadonly<Pos>, radius: number, p: DeepReadonly<Pos>): boolean {
    const dx = p.x - from.x, dy = p.y - from.y;
    return dx * dx + dy * dy <= radius * radius && lineOfSight(sight, { x: from.x, y: from.y }, { x: p.x, y: p.y });
}

/** Every tile within `radius` of `from` and in its line of sight, row-major. */
function reachTiles(world: ReadonlyWorld, sight: SightMap, from: DeepReadonly<Pos>, radius: number): Pos[] {
    const out: Pos[] = [];
    for (let y = from.y - radius; y <= from.y + radius; y++) {
        for (let x = from.x - radius; x <= from.x + radius; x++) {
            const p = { x, y };
            if (inBounds(world, p) && inCommandReach(sight, from, radius, p)) out.push(p);
        }
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------- The rings

/** What a command does to one NPC (§10.1): the ring it is in and what it makes of it. */
export interface CommandTarget {
    npc: string;
    ring: 'command' | 'panic';
    /**
     * Command ring: `complies` (Commanded, or its pips refreshed), `resists` (rolls `chance`), `ignores` (Hostile,
     * reaching for a weapon). Panic ring: `alerted` (hears a loud noise), `still` (face down: hears, doesn't react).
     */
    outcome: 'complies' | 'resists' | 'ignores' | 'alerted' | 'still';
    /** A resister's chance to resist (§10.4), the one the commit rolls with. */
    chance?: number;
}

export interface CommandPlan {
    crew: string;
    radius: number;
    /** The shout's noise radius (§10.1: the command radius + 3). */
    panicRadius: number;
    /** The command ring: the tiles within the radius in line of sight. */
    commandTiles: Pos[];
    /** The panic ring: the tiles the shout reaches outside the command ring. */
    panicTiles: Pos[];
    /** Every NPC either ring holds, in resolution order. */
    targets: CommandTarget[];
}

/** Who resists commands (§10.4): guards, the security chief and couriers. Heroes are M2-02's. */
export const isResister = (world: ReadonlyWorld, npc: DeepReadonly<NpcState>): boolean => personOf(world, npc.id).observer === 'enforcer';

/** Statuses a command can't reach: down for good, tied (already done), or off the map. */
const BEYOND_COMMAND = new Set(['unconscious', 'dead', 'tied', 'away']);

/**
 * A resister's chance to resist a command from `crewId` (§10.4): 40% alone; 10% when Surprised or with 2+ crew aiming
 * at it (armed, within their own command radius, in line of sight); halved by an Intimidating shouter.
 */
export function resistChance(world: ReadonlyWorld, state: State, crewId: string, npc: DeepReadonly<NpcState>, sight = sightMap(world, state)): number {
    const aiming = state.crew.filter(c => armed(c) && inCommandReach(sight, c.pos, commandRadius(state, c), npc.pos)).length;
    const base = npc.surprised !== null || aiming >= 2 ? 0.1 : 0.4;
    return crewMember(state, crewId).traits.includes('intimidating') ? base / 2 : base;
}

/** What a command from `crewId` where they stand would do (see the header): the rings and every NPC in them. Pure. */
export function commandPlan(world: ReadonlyWorld, state: State, crewId: string): CommandPlan {
    const member = crewMember(state, crewId), sight = sightMap(world, state);
    const radius = commandRadius(state, member), panicRadius = radius + 3;
    const commandTiles = reachTiles(world, sight, member.pos, radius);
    const inCommand = new Set(commandTiles.map(p => p.y * world.width + p.x));
    const ring = soundRing(world, state, member.pos, noiseRadius('commandShout', panicRadius));
    const panicTiles = ring.tiles.map(t => t.pos).filter(p => !inCommand.has(p.y * world.width + p.x)).map(p => ({ x: p.x, y: p.y }));
    const hears = new Set(npcsInside(state, ring));
    const targets: CommandTarget[] = [];
    for (const npc of state.npcs) {
        if (BEYOND_COMMAND.has(npc.status) || !isPresent(npc) || npc.stashed !== null || state.crew.some(c => c.dragging === npc.id)) continue;
        if (inCommand.has(npc.pos.y * world.width + npc.pos.x)) {
            if (npc.status === 'hostile' || npc.lapse?.kind === 'reach') targets.push({ npc: npc.id, ring: 'command', outcome: 'ignores' });
            else if (isResister(world, npc) && npc.status !== 'commanded') {
                targets.push({ npc: npc.id, ring: 'command', outcome: 'resists', chance: resistChance(world, state, crewId, npc, sight) });
            } else targets.push({ npc: npc.id, ring: 'command', outcome: 'complies' });
        } else if (hears.has(npc.id) && !DEAF_STATUSES.has(npc.status)) {
            targets.push({ npc: npc.id, ring: 'panic', outcome: isEyesDown(npc) ? 'still' : 'alerted' });
        }
    }
    return { crew: crewId, radius, panicRadius, commandTiles, panicTiles, targets };
}

/** The Commanded NPCs a hold by this crew member where they stand would keep down (§10.3), in resolution order. */
export function holdTargets(world: ReadonlyWorld, state: State, crewId: string): string[] {
    const member = crewMember(state, crewId), sight = sightMap(world, state), radius = commandRadius(state, member);
    return state.npcs.filter(n => n.command !== null && inCommandReach(sight, member.pos, radius, n.pos)).map(n => n.id);
}

/** Puts an NPC face down for a crew member (§10.2), or refreshes its pips. */
export function commandNpc(ctx: Ctx, npc: NpcState, crewId: string, pips: number): void {
    const { world } = ctx;
    if (npc.status !== 'commanded') {
        npc.status = 'commanded';
        ctx.emit({ type: 'npcStatus', npc: npc.id, status: 'commanded' });
    }
    npc.command = { pips: Math.max(pips, npc.command?.pips ?? 0), by: crewId };
    npc.lapse = null;
    // Face down: whatever it meant to do it doesn't (§10.2), and a civilian calms down (§8.7).
    npc.intent = { path: [] };
    npc.goal = { kind: 'still' };
    npc.route = null;
    npc.search = null;
    if (personOf(world, npc.id).observer === 'civilian') {
        npc.alerted = false;
        npc.alertCause = null;
    }
    ctx.emit({ type: 'commanded', crew: crewId, npc: npc.id, pips: npc.command.pips });
}

registerAction('command', {
    whyNot: (_world, state, cmd) => lacksActions(crewMember(state, cmd.crew), 1),
    candidates: (_world, _state, member) => [{ type: 'command', crew: member.id }],
    cost: () => 1,
    illegal: () => ({ act: 'command' }),
    run(ctx, member) {
        const { world, state } = ctx;
        const plan = commandPlan(world, state, member.id);
        const npcOf = (id: string): NpcState => state.npcs.find(n => n.id === id)!;
        // The compliant first, then each resister's roll: a preview stops at the first (`commandPlan` shows them all).
        for (const t of plan.targets) {
            if (t.outcome === 'complies') commandNpc(ctx, npcOf(t.npc), member.id, world.rules.commandPips);
            else if (t.outcome === 'ignores') ctx.emit({ type: 'ignoredCommand', crew: member.id, npc: t.npc });
        }
        for (const t of plan.targets) {
            if (t.outcome !== 'resists') continue;
            if (ctx.dice.odds('resist', t.chance!, `resist ${t.npc}`)) ctx.emit({ type: 'resisted', crew: member.id, npc: t.npc, chance: t.chance! });
            else commandNpc(ctx, npcOf(t.npc), member.id, world.rules.commandPips);
        }
        makeNoise(ctx, 'commandShout', member.pos, `command ${member.id}`, plan.panicRadius);
        if (!state.bank.loud) {
            state.bank.loud = true;
            ctx.emit({ type: 'wentLoud', cause: `command ${member.id}` });
        }
    }
});

registerAction('hold', {
    whyNot: (_world, state, cmd) => lacksActions(crewMember(state, cmd.crew), 1)
        ?? (state.npcs.some(n => n.command !== null) ? undefined : 'Nobody is face down to hold'),
    candidates: (_world, state, member) => (state.npcs.some(n => n.command !== null) ? [{ type: 'hold', crew: member.id }] : []),
    // Their last action: whatever is left (at least 1).
    cost: (_world, state, cmd) => Math.max(1, crewMember(state, cmd.crew).actionsLeft),
    run(ctx, member) {
        member.holding = ctx.state.turn;
        ctx.emit({ type: 'holding', crew: member.id });
    }
});

registerAction('maskUp', {
    whyNot(_world, state, cmd) {
        const member = crewMember(state, cmd.crew);
        if (member.loadout.masked) return `${member.name} is masked already`;
        return lacksActions(member, 1);
    },
    candidates: (_world, _state, member) => (member.loadout.masked ? [] : [{ type: 'maskUp', crew: member.id }]),
    cost: () => 1,
    illegal: () => ({ act: 'maskUp' }),
    run(ctx, member) {
        member.loadout.masked = true;
        ctx.emit({ type: 'maskedUp', crew: member.id });
    }
});

/** Why GO can't be pressed now (§9.3), or undefined. */
export function goBlocked(state: DeepReadonly<State>): string | undefined {
    if (state.takeover !== null) return 'GO is spent: once per heist';
    if (state.bank.loud) return 'The bank is loud already';
    return undefined;
}

registerAction('go', {
    whyNot: (_world, state) => goBlocked(state),
    candidates: (_world, state, member) => (goBlocked(state) ? [] : [{ type: 'go', crew: member.id }]),
    cost: () => 0,
    run(ctx, member) {
        const { world, state } = ctx;
        state.takeover = state.turn;
        ctx.emit({ type: 'tookOver', crew: member.id });
        // Calm or Curious when GO was pressed: Surprised (§9.3).
        for (const npc of state.npcs) {
            if ((npc.status !== 'calm' && npc.status !== 'curious') || !isPresent(npc)) continue;
            npc.surprised = state.turn;
            npc.intent = { path: [] };
            npc.goal = { kind: 'still' };
            ctx.emit({ type: 'surprised', npc: npc.id });
            if (personOf(world, npc.id).observer === 'civilian') commandNpc(ctx, npc, member.id, 1);
        }
        const masking = state.crew.filter(c => !c.loadout.masked);
        // The third action, for everyone whose turn isn't over (a Hold ends it).
        for (const c of state.crew) if (c.holding !== state.turn) c.actionsLeft++;
        for (const c of masking) {
            c.loadout.masked = true;
            ctx.emit({ type: 'maskedUp', crew: c.id });
        }
        // Masking up is an illegal act wherever anyone sees it (§8.4).
        for (const c of masking) witnessAct(ctx, c.id, 'maskUp');
    }
}, { perceive: false });

// ---------------------------------------------------------------------------------------------------------- Counters

// ---------------------------------------------------------------------------------------------------------- The world phase

// Surprised for one world phase (§9.3): it is over before the next intents are committed.
registerWorldHook('commitIntents', 'command.surprise', (ctx, phase) => {
    for (const npc of ctx.state.npcs) if (npc.surprised !== null && npc.surprised <= phase.turn) npc.surprised = null;
}, { order: -50 });

// Reaching for a weapon (§10.9): telegraphed for a world phase, then he draws, after the passive walks.
registerWorldHook('passiveNpcs', 'command.draw', (ctx, phase) => {
    for (const id of phase.passive) {
        if (phase.intents[id]?.action?.kind !== 'reachForWeapon') continue;
        const npc = ctx.state.npcs.find(n => n.id === id)!;
        if (isEyesDown(npc) || npc.lapse?.kind !== 'reach') continue;
        npc.lapse = null;
        npc.status = 'hostile';
        npc.intent = { path: [] };
        ctx.emit({ type: 'drewWeapon', npc: npc.id });
        ctx.emit({ type: 'npcStatus', npc: npc.id, status: 'hostile' });
    }
}, { order: 7 });

/**
 * Running for it (§10.5, §9.1 escapee), after the passive walks: a runner still up that walked its committed flee starts
 * the escapee carrier as it sets off (max(2, ⌈the way left ÷ 8⌉), alarms.ts `startEscapee`; one per runner), and one at
 * the way out (or a tile next to it) leaves the map for good. Telegraphed by the flee intent a phase before.
 */
registerWorldHook('passiveNpcs', 'command.flee', (ctx, phase) => {
    const { world, state } = ctx;
    for (const id of phase.passive) {
        const action = phase.intents[id]?.action;
        if (action?.kind !== 'flee') continue;
        const npc = state.npcs.find(n => n.id === id)!;
        if (isEyesDown(npc) || !isPresent(npc) || npc.lapse?.kind !== 'flee') continue;
        const out = Math.max(Math.abs(npc.pos.x - action.exit.x), Math.abs(npc.pos.y - action.exit.y)) <= 1;
        // Its carrier is seen for a crew phase with the runner still on the map, where the counters reach it (§9.1).
        const running = state.carriers.some(c => c.kind === 'escapee' && c.source === npc.id);
        startEscapee(ctx, npc, out ? 0 : wayOut(world, state, npc)?.tiles ?? 0);
        if (!out || !(running || state.bank.alarm)) continue;
        // Gone for good: its lapse keeps it away (behaviour.ts).
        npc.status = 'away';
        ctx.emit({ type: 'npcLeft', npc: npc.id, at: { x: npc.pos.x, y: npc.pos.y } });
        ctx.emit({ type: 'npcStatus', npc: npc.id, status: 'away' });
    }
}, { order: 6 });

// Who is held this world phase (§10.3), by the draft state of the `endTurn` command playing it.
const HELD = new WeakMap<State, Set<string>>();

// A hold covers what `holdTargets` says as the crew phase ends: the radius of that turn (×1.5 on the takeover turn)
// and the sight as the holder gave it, before anyone walks. The pips are counted at the end of the world phase.
registerWorldHook('passiveNpcs', 'command.hold', ctx => {
    const { world, state } = ctx, held = new Set<string>();
    for (const c of state.crew) if (c.holding === state.turn) for (const id of holdTargets(world, state, c.id)) held.add(id);
    HELD.set(state, held);
}, { order: -200 });

/**
 * Pips and lapses (§10.2–10.5), as the next crew phase begins and after everything else (the roll is the world
 * phase's last word, so a preview of the world phase stops only there): a pip goes from every Commanded NPC nobody
 * holds; one at 0 rolls its lapse. Holds end with it.
 */
registerWorldHook('crewPhase', 'command.lapse', ctx => {
    const { state } = ctx;
    const holds = HELD.get(state) ?? new Set<string>();
    HELD.delete(state);
    const lapsing: NpcState[] = [];
    for (const npc of state.npcs) {
        if (npc.command === null) continue;
        if (npc.status !== 'commanded') {
            // Up again by other means (knocked out, tied): no longer anyone's to hold.
            npc.command = null;
            continue;
        }
        const keep = holds.has(npc.id);
        if (!keep && npc.command.pips > 0) npc.command.pips--;
        ctx.emit({ type: 'commandPips', npc: npc.id, pips: npc.command.pips, held: keep });
        if (!keep && npc.command.pips === 0) lapsing.push(npc);
    }
    for (const c of state.crew) c.holding = null;
    for (const npc of lapsing) lapse(ctx, npc, rollLapse(ctx, npc));
    if (lapsing.length) reconsider(ctx);
}, { order: 100 });

/** The archetype's roll (§10.5, §16.2): one chance after another, each the share of what is left, so each is shown odds. */
function rollLapse(ctx: Ctx, npc: NpcState): LapseOutcome {
    const person = personOf(ctx.world, npc.id), weights = panicWeights(person.role, person.observer);
    if (!weights) return 'reachForWeapon';
    // Hiding needs a hiding place (M2-02): it counts as staying down.
    const options: [LapseOutcome, number][] = [['stayDown', weights.cower + weights.hide], ['flee', weights.flee], [weights.via ?? 'alarm', weights.special]];
    let left = options.reduce((sum, [, w]) => sum + w, 0);
    for (const [outcome, w] of options) {
        if (w <= 0) continue;
        if (w >= left || ctx.dice.odds('lapse', w / left, `lapse ${npc.id} ${outcome}`)) return outcome;
        left -= w;
    }
    return 'stayDown';
}

/** The nearest way out for a runner (§10.5 flee): a tile where anyone leaves the map, by walking cost; with its cost. */
function wayOut(world: ReadonlyWorld, state: State, npc: DeepReadonly<NpcState>): { exit: Pos; tiles: number } | undefined {
    const exits: Pos[] = [];
    for (const p of world.people) for (const b of p.schedule) {
        if ((b.activity === 'leave' || b.activity === 'offMap') && b.at && !exits.some(e => samePos(e, b.at!))) exits.push({ x: b.at.x, y: b.at.y });
    }
    if (!exits.length) return undefined;
    const reach = reachable(world, state, { x: npc.pos.x, y: npc.pos.y }, (world.width + world.height) * 4 * HALF_STEPS_PER_TILE,
        { ...npcMoveOptions(world, npc), ignorePeople: true });
    let best: { exit: Pos; cost: number } | undefined;
    for (const e of exits.sort((a, b) => a.y - b.y || a.x - b.x)) {
        const t = reachAt(reach, e);
        if (t && (!best || t.cost < best.cost)) best = { exit: e, cost: t.cost };
    }
    return best && { exit: best.exit, tiles: Math.ceil(best.cost / HALF_STEPS_PER_TILE) };
}

/** Carries out the decision of a lapse (see the header); its intent is planned by `reconsider` straight after. */
function lapse(ctx: Ctx, npc: NpcState, rolled: LapseOutcome): void {
    const { world, state } = ctx;
    const by = npc.command!.by;
    const out = rolled === 'flee' ? wayOut(world, state, npc) : undefined;
    // No way out to run for: it stays down.
    const outcome: LapseOutcome = rolled === 'flee' && !out ? 'stayDown' : rolled;
    ctx.emit({ type: 'lapsed', npc: npc.id, outcome });
    if (outcome === 'stayDown') {
        npc.intent = { path: [], action: { kind: 'stayDown' } };
        return;
    }
    npc.command = null;
    npc.status = 'alerted';
    ctx.emit({ type: 'npcStatus', npc: npc.id, status: 'alerted' });
    if (outcome === 'flee') {
        alertNpc(ctx, npc, 'command lapsed');
        npc.lapse = { kind: 'flee', exit: out!.exit };
    } else if (outcome === 'reachForWeapon') {
        alertNpc(ctx, npc, 'command lapsed');
        npc.lapse = { kind: 'reach', crew: by };
    } else {
        // Goes for the alarm (by role: the button, the console, telling a guard) or the phone where it lies (the
        // manager, §16.2): either way it knows who put it on the floor.
        expose(ctx, npc, by, ['commanded'], crewMember(state, by).pos);
        alertNpc(ctx, npc, 'command lapsed');
        if (outcome === 'phone') npc.lapse = { kind: 'phone', crew: by };
    }
}

registerEvents({
    commanded: { undoBlocking: true },
    resisted: { undoBlocking: true },
    ignoredCommand: { undoBlocking: true },
    commandPips: { undoBlocking: false },
    lapsed: { undoBlocking: true },
    drewWeapon: { undoBlocking: true },
    holding: { undoBlocking: false },
    tookOver: { undoBlocking: true },
    surprised: { undoBlocking: true },
    maskedUp: { undoBlocking: false }
});
