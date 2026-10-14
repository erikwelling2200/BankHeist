import { clonePlain, deepFreeze } from './json';
import { Dice, OddsStop, type Mode, type PendingOdds } from './rng';
import { eventClass, registerEvents } from './undo';
import type { Command, CommandOf, CommandType, DeepReadonly, Intent, ReadonlyWorld, SimEvent, State } from './types';

/*
 * The rules engine (§6): a command goes in, a new state and the events that explain it come out. Nothing here knows
 * a rule; every command's reducer and every world-phase step registers itself from the module that owns it, so a new
 * system plugs in without editing a switch here.
 *
 * `commit` plays a command for real. `preview` plays the very same reducer on a copy, with dice that refuse to roll,
 * which is what makes previews exact (§6.6, the design's hard promises): there is no second implementation to drift,
 * and a reducer can't even tell which of the two it is in.
 */

/** What a reducer works with: the world, the copy of the state it changes in place, the dice and the event log. */
export interface Ctx {
    readonly world: ReadonlyWorld;
    readonly state: State;
    readonly dice: Dice;
    emit(event: SimEvent): void;
}

/** A command the rules don't allow here and now. Previews throw it too, so the UI can show why. */
export class IllegalCommand extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = 'IllegalCommand';
    }
}

export type Reducer<K extends CommandType> = (ctx: Ctx, cmd: CommandOf<K>) => void;

interface CommandEntry {
    reduce: (ctx: Ctx, cmd: Command) => void;
    /** Never undoable, whatever its events (ending the turn: there is no turn rewind, §6.6). */
    final: boolean;
}

const COMMANDS = new Map<string, CommandEntry>();

/** Registers the reducer of a command type. A second registration throws unless it says `replace`. */
export function registerCommand<K extends CommandType>(type: K, reduce: Reducer<K>, options: { final?: boolean; replace?: boolean } = {}): void {
    if (COMMANDS.has(type) && !options.replace) throw new Error(`Command '${type}' already has a reducer; pass replace: true to change it`);
    COMMANDS.set(type, { reduce: reduce as CommandEntry['reduce'], final: options.final ?? false });
}

/**
 * The world phase in the order of §6.1: passive NPCs (civilians, staff, guards who aren't fighting) all act at once,
 * NPCs in combat act one at a time, then devices (drills, timers, the carriers' countdowns), then every NPC commits its
 * next intent, which the crew phase shows. `crewPhase` runs once the next turn has begun (refreshing actions).
 */
export const WORLD_STEPS = ['passiveNpcs', 'combatNpcs', 'devices', 'commitIntents', 'crewPhase'] as const;
export type WorldStep = (typeof WORLD_STEPS)[number];

/**
 * What a world phase's steps share. `intents` is every NPC's intent as the last `commitIntents` left it, frozen at the
 * start of the phase: the act steps carry out these and nothing decided since (§6.2), even if a step rewrites
 * `npc.intent` on the way.
 */
export interface WorldPhase {
    readonly turn: number;
    readonly intents: Readonly<Record<string, DeepReadonly<Intent>>>;
}

export type WorldHook = (ctx: Ctx, phase: WorldPhase) => void;

interface HookEntry { name: string; order: number; run: WorldHook }

const WORLD_HOOKS: Record<WorldStep, HookEntry[]> = {
    passiveNpcs: [], combatNpcs: [], devices: [], commitIntents: [], crewPhase: []
};

/**
 * Adds a named hook to a world-phase step. Hooks run by `order`, then by name. A second hook of the same name throws
 * unless it says `replace` (the packages that fill in the engine's placeholders do).
 */
export function registerWorldHook(step: WorldStep, name: string, run: WorldHook, options: { order?: number; replace?: boolean } = {}): void {
    if (!(WORLD_STEPS as readonly string[]).includes(step)) throw new Error(`No world-phase step '${step}'`);
    const hooks = WORLD_HOOKS[step], i = hooks.findIndex(h => h.name === name);
    if (i >= 0 && !options.replace) throw new Error(`World hook '${name}' is already in step '${step}'; pass replace: true to change it`);
    const entry = { name, order: options.order ?? (i >= 0 ? hooks[i]!.order : 0), run };
    if (i >= 0) hooks[i] = entry;
    else hooks.push(entry);
    hooks.sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The hook names of each step, in the order they run. */
export function worldHooks(): Record<WorldStep, string[]> {
    return Object.fromEntries(WORLD_STEPS.map(s => [s, WORLD_HOOKS[s].map(h => h.name)])) as Record<WorldStep, string[]>;
}

export interface CommitResult {
    state: State;
    events: SimEvent[];
    /** Whether the action can be taken back (§6.6): nothing revealed, no perception check, no dice, not final. */
    undoable: boolean;
}

export interface PreviewResult extends CommitResult {
    /** Set when the command stopped at a roll: its odds. `state` and `events` are then as far as it got. */
    pending?: PendingOdds;
}

function run(world: ReadonlyWorld, state: State, cmd: Command, mode: Mode): PreviewResult {
    const entry = COMMANDS.get(cmd.type);
    if (!entry) throw new Error(`No reducer for command '${cmd.type}': is its module imported (src/sim/index.ts)?`);
    if (state.phase !== 'crew') throw new IllegalCommand(`Commands are given in the crew phase, not the ${state.phase} phase`);
    const draft = clonePlain(state);
    const dice = new Dice(draft, mode);
    const events: SimEvent[] = [];
    const ctx: Ctx = {
        world, state: draft, dice,
        emit(event) {
            eventClass(event.type);
            events.push(clonePlain(event));
        }
    };
    let stopped = false;
    try {
        entry.reduce(ctx, cmd);
    } catch (e) {
        if (dice.refused) throw dice.refused;
        if (!(e instanceof OddsStop && dice.pending)) throw e;
        stopped = true;
    }
    // A reducer that caught the dice's refusal or stop and carried on would make the preview differ from the commit.
    if (dice.refused) throw dice.refused;
    const pending = dice.pending;
    if (pending && !stopped) throw new Error(`Command '${cmd.type}' caught the preview's stop at '${pending.reason}' and carried on`);
    const undoable = !entry.final && !pending && dice.rolls === 0 && !events.some(e => eventClass(e.type).undoBlocking);
    return pending ? { state: draft, events, undoable, pending } : { state: draft, events, undoable };
}

/** Plays a command for real. The input state is left as it was. */
export function commit(world: ReadonlyWorld, state: State, cmd: Command): CommitResult {
    return run(world, state, cmd, 'commit');
}

/**
 * What a command would do, without doing it: the same reducer on a copy. Stops cleanly at a roll declared with
 * `Dice.odds` (returning `pending`); throws `PreviewRollError` at any other roll, and `IllegalCommand` if the command
 * isn't allowed.
 */
export function preview(world: ReadonlyWorld, state: State, cmd: Command): PreviewResult {
    return run(world, state, cmd, 'preview');
}

// The engine's own command: ending the turn runs the world phase and starts the next crew phase.
registerCommand('endTurn', ctx => {
    const { state } = ctx;
    state.phase = 'world';
    ctx.emit({ type: 'phaseStarted', phase: 'world', turn: state.turn });
    const intents: Record<string, Intent> = {};
    for (const npc of state.npcs) intents[npc.id] = clonePlain(npc.intent);
    const phase: WorldPhase = { turn: state.turn, intents: deepFreeze(intents) };
    for (const step of WORLD_STEPS) {
        if (step === 'crewPhase') {
            state.turn++;
            state.phase = 'crew';
            ctx.emit({ type: 'phaseStarted', phase: 'crew', turn: state.turn });
        }
        for (const hook of WORLD_HOOKS[step]) hook.run(ctx, phase);
    }
}, { final: true });

// Each act step's hook, empty until the package that owns it fills it in under the same name.
registerWorldHook('passiveNpcs', 'npcs.passive', () => {});
registerWorldHook('combatNpcs', 'npcs.combat', () => {});
registerWorldHook('commitIntents', 'npcs.intents', () => {});

// A new crew phase: everyone's actions back. Downed or arrested crew will be skipped here once crew health exists.
registerWorldHook('crewPhase', 'crew.actions', ctx => {
    for (const member of ctx.state.crew) member.actionsLeft = ctx.world.rules.actionsPerTurn;
});

registerEvents({
    phaseStarted: { undoBlocking: false },
    revealed: { undoBlocking: true },
    perceptionCheck: { undoBlocking: true },
    wentLoud: { undoBlocking: true }
});
