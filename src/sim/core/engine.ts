import { Dice, type Mode } from './rng';
import { eventClass, registerEvents } from './undo';
import type { Command, CommandOf, CommandType, SimEvent, State, World } from './types';

/*
 * The rules engine (§6): a command goes in, a new state and the events that explain it come out. Nothing here knows
 * a rule; every command's reducer and every world-phase step registers itself from the module that owns it, so a new
 * system plugs in without editing a switch here.
 *
 * `commit` plays a command for real. `preview` plays the very same reducer on a copy, with dice that refuse to roll,
 * which is what makes previews exact (§6.6, the design's hard promises): there is no second implementation to drift.
 */

/** What a reducer works with: the world, the copy of the state it changes in place, the dice and the event log. */
export interface Ctx {
    readonly world: World;
    readonly state: State;
    readonly dice: Dice;
    readonly mode: Mode;
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

/** Registers the reducer of a command type; registering a type again replaces it. */
export function registerCommand<K extends CommandType>(type: K, reduce: Reducer<K>, options: { final?: boolean } = {}): void {
    COMMANDS.set(type, { reduce: reduce as CommandEntry['reduce'], final: options.final ?? false });
}

/**
 * The world phase in the order of §6.1: passive NPCs (civilians, staff, guards who aren't fighting) all move at once,
 * NPCs in combat act one at a time, then devices (drills, timers, the carriers' countdowns), and last every NPC commits
 * its next intent, which the crew phase shows.
 */
export const WORLD_STEPS = ['passiveNpcs', 'combatNpcs', 'devices', 'commitIntents'] as const;
export type WorldStep = (typeof WORLD_STEPS)[number];

export type WorldHook = (ctx: Ctx) => void;

const WORLD_HOOKS: Record<WorldStep, { name: string; run: WorldHook }[]> = {
    passiveNpcs: [], combatNpcs: [], devices: [], commitIntents: []
};

/** Adds a named hook to a world-phase step, after the ones already there; a hook of the same name is replaced in place. */
export function registerWorldHook(step: WorldStep, name: string, run: WorldHook): void {
    const hooks = WORLD_HOOKS[step], i = hooks.findIndex(h => h.name === name);
    if (i >= 0) hooks[i] = { name, run };
    else hooks.push({ name, run });
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

function run(world: World, state: State, cmd: Command, mode: Mode): { state: State; events: SimEvent[]; dice: Dice; entry: CommandEntry } {
    const entry = COMMANDS.get(cmd.type);
    if (!entry) throw new Error(`No reducer for command '${cmd.type}': is its module imported (src/sim/index.ts)?`);
    if (state.phase !== 'crew') throw new IllegalCommand(`Commands are given in the crew phase, not the ${state.phase} phase`);
    const draft = structuredClone(state);
    const dice = new Dice(draft, mode);
    const events: SimEvent[] = [];
    const ctx: Ctx = {
        world, state: draft, dice, mode,
        emit(event) {
            eventClass(event.type);
            events.push(event);
        }
    };
    entry.reduce(ctx, cmd);
    return { state: draft, events, dice, entry };
}

/** Plays a command for real. The input state is left as it was. */
export function commit(world: World, state: State, cmd: Command): CommitResult {
    const { state: next, events, dice, entry } = run(world, state, cmd, 'commit');
    const undoable = !entry.final && dice.rolls === 0 && !events.some(e => eventClass(e.type).undoBlocking);
    return { state: next, events, undoable };
}

/**
 * What a command would do, without doing it: the same reducer on a copy. Throws `PreviewRollError` if the outcome
 * would need a roll, and `IllegalCommand` if the command isn't allowed.
 */
export function preview(world: World, state: State, cmd: Command): { state: State; events: SimEvent[] } {
    const { state: next, events } = run(world, state, cmd, 'preview');
    return { state: next, events };
}

// The engine's own command: ending the turn runs the world phase and starts the next crew phase.
registerCommand('endTurn', ctx => {
    const { state, world } = ctx;
    state.phase = 'world';
    ctx.emit({ type: 'phaseStarted', phase: 'world', turn: state.turn });
    for (const step of WORLD_STEPS) for (const hook of WORLD_HOOKS[step]) hook.run(ctx);
    state.turn++;
    state.phase = 'crew';
    for (const member of state.crew) member.actionsLeft = world.rules.actionsPerTurn;
    ctx.emit({ type: 'phaseStarted', phase: 'crew', turn: state.turn });
}, { final: true });

// Each step's hook, empty until the package that owns it fills it in under the same name.
registerWorldHook('passiveNpcs', 'npcs.passive', () => {});
registerWorldHook('combatNpcs', 'npcs.combat', () => {});
registerWorldHook('devices', 'devices.carriers', () => {});
registerWorldHook('commitIntents', 'npcs.intents', () => {});

registerEvents({
    phaseStarted: { undoBlocking: false },
    revealed: { undoBlocking: true },
    perceptionCheck: { undoBlocking: true },
    carrierStarted: { undoBlocking: true },
    carrierTicked: { undoBlocking: true },
    alarmRaised: { undoBlocking: true },
    wentLoud: { undoBlocking: true }
});
