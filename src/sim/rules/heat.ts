import { registerCommandHook, registerWorldHook, type Ctx } from '../core/engine';
import { registerStateInit } from '../core/state';
import type { DeepReadonly, NpcState, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { HEAT_EVENTS, MAX_HEAT, RELEASES_PER_HEIST, TICKS_PER_LEVEL, type HeatCause } from '../data/police';
import { cameraObserver, npcObserver, sees } from '../geo/cones';
import { attentiveOperator, liveFeeds, neutralised } from './cctv';
import { vaultLock } from './keys';
import { isPresent } from './npc/walk';

/*
 * The heat track (§13.1, §13.2). Before the Alarm there is no heat; at the Alarm `State.response.heat` starts at 0,
 * which is Heat 1, tick 0, and counts ticks from there: 5 per level, Heat 5 at 20, and on past it (`heatOf` reads the
 * level, the tick and how many times the track has filled past Heat 5). What the police do with it is rules/police.ts.
 *
 * - **The events** are `HEAT_EVENTS` (data/police.ts), all through `addHeat`. Heat can fall (a release), never below
 *   Heat 1, tick 0: `releaseRelief` is the capped amount a release would take off, which is what its preview shows.
 * - **Each world phase after the Alarm** +1, in the devices step (not the phase that raised it). **Drilling or burning a
 *   Class II+ vault** +1 for each world phase a drill or charge works on the vault door of a vault with a seismic sensor
 *   (rules/vault.ts), once per phase however many work.
 * - **Kills** are read off the state after every command (a command hook), so whatever kills (M3-02's attacks, M3-03's
 *   bleeding, a trap) counts without telling this module: an NPC that is dead now and wasn't before. After the Alarm a
 *   civilian, or anyone held as a hostage (Commanded, tied or running in a command's lapse), is +5 by any cause, and a
 *   guard or staff member +1 (decision 121: the police are listening by then). Before it, a kill counts only if
 *   witnessed (§13.2): seen through a live camera on the monitors of an attentive operator, or by anyone present and
 *   looking. Whether anyone saw is what the crew can't know, so it is owed in secret (`HeatState.owed`, no event) and
 *   lands as a lump in the world phase that raises the Alarm, which is when the design shows the heat track at all.
 *   Police officers aren't NPCs: the rules that take one down call `policeDown` (rules/police.ts), which adds +3 for
 *   the first and +1 after.
 * - **A hostage escapes to the police** +1: an NPC Commanded, tied or fleeing in a command's lapse before a command
 *   that leaves the map in it, once the Alarm is up.
 * - **Release** (§10.7) is M3-07's command: it asks `canRelease` and calls `releaseHeat`. Once per turn, three per heist.
 *
 * No dice anywhere: every number here is shown before it happens.
 */

/** What the heat track keeps besides the ticks themselves (`State.response.heat`). */
export interface HeatState {
    /** Kills witnessed before the Alarm (§13.2), each added with its cause when it fires. Secret until then. */
    owed: { cause: HeatCause; victim: string }[];
    /** Police officers killed so far (the first is +3). */
    policeKilled: number;
    /** The turns of each release so far (§13.2: once per turn, three per heist). */
    releases: number[];
}

declare module '../core/types' {
    interface State {
        heat: HeatState;
    }
    interface EventMap {
        /** The heat track moved by `by` ticks, now `heat` (`heatOf` reads the level); `victim` the NPC a kill was of. */
        heatChanged: { by: number; cause: HeatCause; heat: number; victim?: string };
    }
}

registerStateInit('heat', (_world, state) => {
    state.heat = { owed: [], policeKilled: 0, releases: [] };
});

/** The heat level of a tick count (§13.1): Heat 1–5, the tick within it, and the refills past Heat 5. */
export interface HeatLevel {
    level: number;
    /** Ticks into the level: 0–4 (past Heat 5, into the next refill). */
    tick: number;
    /** Times the track has filled a level past Heat 5, each one a refill (§13.1). */
    beyond: number;
}

export function heatOf(ticks: number): HeatLevel {
    const t = Math.max(0, ticks), top = (MAX_HEAT - 1) * TICKS_PER_LEVEL;
    if (t < top) return { level: 1 + Math.floor(t / TICKS_PER_LEVEL), tick: t % TICKS_PER_LEVEL, beyond: 0 };
    return { level: MAX_HEAT, tick: (t - top) % TICKS_PER_LEVEL, beyond: Math.floor((t - top) / TICKS_PER_LEVEL) };
}

/** The heat now, or null before the Alarm. */
export const heatNow = (state: DeepReadonly<State>): HeatLevel | null => (state.response ? heatOf(state.response.heat) : null);

/**
 * Moves the heat track for a cause, by its canonical ticks unless `by` says otherwise. Before the Alarm nothing moves
 * (kills are owed by the kill rule itself). Never below Heat 1, tick 0. Returns the ticks it moved.
 */
export function addHeat(ctx: Ctx, cause: HeatCause, options: { victim?: string; by?: number } = {}): number {
    const { state } = ctx, by = options.by ?? HEAT_EVENTS[cause].ticks;
    if (!state.response) return 0;
    const moved = Math.max(-state.response.heat, by);
    if (moved === 0) return 0;
    state.response.heat += moved;
    ctx.emit({ type: 'heatChanged', by: moved, cause, heat: state.response.heat, ...(options.victim !== undefined ? { victim: options.victim } : {}) });
    return moved;
}

/** Why a release can't lower the heat now (§13.2), or undefined: before the Alarm, a release this turn, three already. */
export function releaseBlocked(state: DeepReadonly<State>): string | undefined {
    if (!state.response) return 'There is no heat before the Alarm';
    if (state.heat.releases.includes(state.turn)) return 'The heat already fell for a release this turn';
    if (state.heat.releases.length >= RELEASES_PER_HEIST) return `The heat falls for ${RELEASES_PER_HEIST} releases a heist`;
    return undefined;
}

/** The ticks a release would take off now, capped at Heat 1, tick 0 (§13.1: "shows the capped amount"); 0 when blocked. */
export const releaseRelief = (state: DeepReadonly<State>): number =>
    (releaseBlocked(state) || !state.response ? 0 : Math.min(-HEAT_EVENTS.release.ticks, state.response.heat));

/** A release's heat (§13.2), for M3-07's command: the capped fall, recorded against the turn and the heist's three. */
export function releaseHeat(ctx: Ctx): number {
    const relief = releaseRelief(ctx.state);
    if (releaseBlocked(ctx.state)) return 0;
    ctx.state.heat.releases.push(ctx.state.turn);
    if (relief > 0) addHeat(ctx, 'release', { by: -relief });
    return relief;
}

// ---------------------------------------------------------------------------------------------------------- Kills

const HOSTAGE_STATUSES: ReadonlySet<string> = new Set(['commanded', 'tied']);

/** Whether an NPC was a hostage as the state had them (§13.2): Commanded or tied, or running from a command's lapse. */
const wasHostage = (npc: DeepReadonly<NpcState>): boolean => HOSTAGE_STATUSES.has(npc.status) || npc.lapse?.kind === 'flee';

/** Whether the operator sees a tile through a live feed now (§8.12). */
function cameraWitness(world: ReadonlyWorld, state: State, tile: Pos): boolean {
    if (!attentiveOperator(world, state)) return false;
    return liveFeeds(world, state).some(id => {
        const eye = cameraObserver(world, state, id);
        return !!eye && sees(world, state, eye, tile) !== null;
    });
}

/** Whether anyone present and looking sees a tile now, but the one lying there. */
function bystander(world: ReadonlyWorld, state: State, tile: Pos, except: string): boolean {
    return state.npcs.some(n => {
        if (n.id === except || !isPresent(n) || neutralised(state, n)) return false;
        const eye = npcObserver(world, n);
        return !!eye && sees(world, state, eye, tile) !== null;
    });
}

// Kills and escapes, read off what any command did (see the header).
registerCommandHook('heat', (ctx, _cmd, events, before) => {
    const { world, state } = ctx;
    for (const npc of state.npcs) {
        if (npc.status !== 'dead') continue;
        const was = before.npcs.find(n => n.id === npc.id);
        if (!was || was.status === 'dead') continue;
        const person = world.people.find(p => p.id === npc.id);
        const cause = wasHostage(was) || person?.observer === 'civilian' ? 'civilianKilled' : 'staffKilled';
        if (state.response) addHeat(ctx, cause, { victim: npc.id });
        else if (cameraWitness(world, state, npc.pos) || bystander(world, state, npc.pos, npc.id)) state.heat.owed.push({ cause, victim: npc.id });
    }
    for (const e of events) {
        if (e.type !== 'npcLeft') continue;
        const was = before.npcs.find(n => n.id === e.npc);
        if (was && wasHostage(was) && state.bank.alarm) addHeat(ctx, 'hostageEscaped');
    }
}, { order: 5 });

// ---------------------------------------------------------------------------------------------------------- The track

/**
 * The ticks the track will have gained `phases` world phases from now by what is known to come (§13.1's forecast):
 * +1 a phase, and +1 a phase while a drill or charge on a Class II+ vault door still has work to do (a jam it hasn't
 * had isn't counted). Kills, escapes and releases aren't foreseen. Before the Alarm, 0.
 */
export function heatAhead(world: ReadonlyWorld, state: DeepReadonly<State>, phases: number): number {
    if (!state.response) return 0;
    const door = classTwoVaultDoor(world);
    const vault = door === undefined ? 0 : Math.max(0, ...state.devices.filter(d => d.at === door && !d.jammed).map(d => d.needed - d.done));
    return state.response.heat + phases + Math.min(phases, vault);
}

/** World phases until the track is forecast to reach `ticks` (`heatAhead`), counting the coming one as 1; 0 if it has. */
export function phasesUntilHeat(world: ReadonlyWorld, state: DeepReadonly<State>, ticks: number): number {
    if (!state.response || state.response.heat >= ticks) return 0;
    let n = 1;
    while (heatAhead(world, state, n) < ticks) n++;
    return n;
}

/** The vault door when its vault has a seismic sensor (Class II+), from the key graph. */
function classTwoVaultDoor(world: ReadonlyWorld): string | undefined {
    const vault = vaultLock(world);
    return vault?.technical.kind === 'drill' && vault.technical.sensors.includes('seismic') ? vault.target : undefined;
}

// Each world phase after the Alarm (+1), the debts of kills witnessed before it, and work on a Class II+ vault (+1):
// after the police countdown (devices.police) and before the devices work (vault.devices), so a device about to work
// this phase is one that will.
registerWorldHook('devices', 'heat.track', (ctx, phase) => {
    const { world, state } = ctx, r = state.response;
    if (!r) return;
    if (r.raised === phase.turn) {
        // The Alarm's own world phase: the kills witnessed before it come due, as a lump.
        const owed = state.heat.owed;
        state.heat.owed = [];
        for (const o of owed) addHeat(ctx, o.cause, { victim: o.victim });
        return;
    }
    addHeat(ctx, 'phase');
    const door = classTwoVaultDoor(world);
    if (door !== undefined && state.devices.some(d => d.at === door && !d.jammed && d.done < d.needed)) addHeat(ctx, 'vaultWork');
}, { order: 2 });

registerEvents({
    heatChanged: { undoBlocking: true }
});
