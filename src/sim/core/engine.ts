import { assertPlainJson, clonePlain, deepFreeze, devChecksOn, samePlain } from './json';
import { Dice, type Mode, type OddsStop, type PendingOdds } from './rng';
import { eventClass, registerEvents } from './undo';
import type { Command, CommandOf, CommandType, DeepReadonly, DiceRoll, Intent, NpcStatus, ReadonlyWorld, SimEvent, State } from './types';

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

/**
 * A command the rules don't allow here and now. Previews throw it too, so the UI can show why. A reducer checks
 * everything that makes a command illegal before its first roll: refusing after a roll would make a preview (which
 * can't roll) and the commit disagree, so the engine treats that as a bug (`InvariantError`).
 */
export class IllegalCommand extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = 'IllegalCommand';
    }
}

/** A rule broke one of the engine's promises: a bug in the rules, never something the player did. */
export class InvariantError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvariantError';
    }
}

export type Reducer<K extends CommandType> = (ctx: Ctx, cmd: CommandOf<K>) => void;

interface CommandEntry {
    reduce: (ctx: Ctx, cmd: Command) => void;
    /** Never undoable, whatever its events (ending the turn: there is no turn rewind, §6.6). */
    final: boolean;
    placeholder: boolean;
}

/**
 * How a registration meets an earlier one of the same name. A `placeholder` (a stub, an empty hook) gives way to the
 * first real registration whichever module loads first, and never overrides a real one. Two real registrations
 * conflict unless the second says `replace`, which needs something to replace.
 */
export interface RegisterOptions { replace?: boolean; placeholder?: boolean }

/** Whether a new registration takes the place of an existing one (or of none). */
function supersedes(kind: string, name: string, existing: { placeholder: boolean } | undefined, options: RegisterOptions): boolean {
    if (options.replace && !existing) throw new Error(`There is no ${kind} '${name}' to replace`);
    if (!existing) return true;
    if (options.placeholder) return false;
    if (existing.placeholder || options.replace) return true;
    throw new Error(`${kind} '${name}' is already registered; pass replace: true to change it`);
}

const COMMANDS = new Map<string, CommandEntry>();

/** Registers the reducer of a command type (see `RegisterOptions`). */
export function registerCommand<K extends CommandType>(type: K, reduce: Reducer<K>, options: RegisterOptions & { final?: boolean } = {}): void {
    if (!supersedes('Command', type, COMMANDS.get(type), options)) return;
    COMMANDS.set(type, { reduce: reduce as CommandEntry['reduce'], final: options.final ?? false, placeholder: options.placeholder ?? false });
}

/**
 * The world phase in the order of §6.1: passive NPCs (civilians, staff, guards who aren't fighting) all act at once,
 * NPCs in combat act one at a time, then devices (drills, timers, the carriers' countdowns), then every NPC commits its
 * next intent, which the crew phase shows. `crewPhase` runs once the next turn has begun (refreshing actions).
 */
export const WORLD_STEPS = ['passiveNpcs', 'combatNpcs', 'devices', 'commitIntents', 'crewPhase'] as const;
export type WorldStep = (typeof WORLD_STEPS)[number];

/** The statuses that put an NPC in combat (§6.1: anyone Hostile acts one at a time). A package may add to it. */
export const COMBAT_STATUSES = new Set<NpcStatus>(['hostile']);

/**
 * What a world phase's steps share, frozen at the start of the phase (§6.2):
 * - `intents`: every NPC's intent as the last `commitIntents` left it. Telegraphed actions (raising the alarm, drawing a
 *   weapon, a radio call, a breach, a grenade) are carried out only from here, never from anything decided since, even
 *   if a step rewrites `npc.intent` on the way. Movement and shots in combat may be decided when the NPC acts (§13.6).
 * - `status`, `passive` and `combat`: each NPC's status, and who acts with the passive group or alone, in resolution
 *   order. The act steps take membership from here, so an NPC that turns Hostile mid-phase acts as a combatant only
 *   from the next phase.
 */
export interface WorldPhase {
    readonly turn: number;
    readonly intents: Readonly<Record<string, DeepReadonly<Intent>>>;
    readonly status: Readonly<Record<string, NpcStatus>>;
    readonly passive: readonly string[];
    readonly combat: readonly string[];
}

export type WorldHook = (ctx: Ctx, phase: WorldPhase) => void;

interface HookEntry { name: string; order: number; run: WorldHook; placeholder: boolean }

const WORLD_HOOKS: Record<WorldStep, HookEntry[]> = {
    passiveNpcs: [], combatNpcs: [], devices: [], commitIntents: [], crewPhase: []
};

/**
 * Adds a named hook to a world-phase step (see `RegisterOptions`). Hooks run by `order`, then by name. A real hook of
 * the name of one of the engine's placeholders ('npcs.passive', …) fills it in.
 */
export function registerWorldHook(step: WorldStep, name: string, run: WorldHook, options: RegisterOptions & { order?: number } = {}): void {
    if (!(WORLD_STEPS as readonly string[]).includes(step)) throw new Error(`No world-phase step '${step}'`);
    const hooks = WORLD_HOOKS[step], i = hooks.findIndex(h => h.name === name);
    if (!supersedes('World hook', `${step}/${name}`, hooks[i], options)) return;
    const entry = { name, order: options.order ?? (i >= 0 ? hooks[i]!.order : 0), run, placeholder: options.placeholder ?? false };
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
    /** Every roll this command made, in order (the state keeps only the last `DICE_WINDOW`). */
    rolls: DiceRoll[];
    /** Whether the action can be taken back (§6.6): nothing revealed, no perception check, no dice, not final. */
    undoable: boolean;
}

/**
 * A preview is engine-internal: it is the truth, including what the crew can't know (who is behind the wall, what an
 * NPC decided). What the player is shown must be projected through the crew's knowledge first (a later package).
 */
export interface PreviewResult extends CommitResult {
    /** Set when the command stopped at a roll: its odds. `state` and `events` are then as far as it got. */
    pending?: PendingOdds;
}

const caughtStop = (cmd: Command, stop: OddsStop): Error =>
    new InvariantError(`Command '${cmd.type}' caught the preview's stop at '${stop.odds.reason}' and carried on`);

function run(world: ReadonlyWorld, state: State, cmd: Command, mode: Mode): PreviewResult {
    const entry = COMMANDS.get(cmd.type);
    if (!entry) throw new Error(`No reducer for command '${cmd.type}': is its module imported (src/sim/index.ts)?`);
    if (state.phase !== 'crew') throw new IllegalCommand(`Commands are given in the crew phase, not the ${state.phase} phase`);
    const check = mode === 'commit' || devChecksOn();
    if (check) assertPlainJson(cmd, 'command');
    // The reducer gets its own frozen copy, so nothing it keeps can change under it and it can't change the caller's.
    const command = deepFreeze(clonePlain(cmd));
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
        entry.reduce(ctx, command);
    } catch (e) {
        // A reducer that caught the dice's refusal or stop and carried on (to another roll, an error or the end) would
        // make the preview differ from the commit; only the very stop the dice threw may end a preview early.
        if (dice.refused) throw dice.refused;
        if (dice.stop && e !== dice.stop) throw caughtStop(cmd, dice.stop);
        if (!dice.stop) {
            if (e instanceof IllegalCommand && dice.rolled.length) {
                throw new InvariantError(`Command '${cmd.type}' was refused after a roll ('${e.message}'): legality checks must come before the first roll`);
            }
            throw e;
        }
        stopped = true;
    }
    if (dice.refused) throw dice.refused;
    if (dice.stop && !stopped) throw caughtStop(cmd, dice.stop);
    if (check) {
        assertPlainJson(draft, 'state');
        assertPlainJson(events, 'events');
    }
    const pending = dice.pending;
    const rolls = dice.rolled;
    // Undo also needs the world untouched: whatever the events say, an action that changed an NPC, a carrier or the
    // bank's status told the player something and can't be taken back.
    const undoable = !entry.final && !pending && !rolls.length && !events.some(e => eventClass(e.type).undoBlocking)
        && samePlain(draft.npcs, state.npcs) && samePlain(draft.carriers, state.carriers) && samePlain(draft.bank, state.bank);
    return pending ? { state: draft, events, rolls, undoable, pending } : { state: draft, events, rolls, undoable };
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
    const intents: Record<string, Intent> = {}, status: Record<string, NpcStatus> = {};
    for (const npc of state.npcs) {
        intents[npc.id] = clonePlain(npc.intent);
        status[npc.id] = npc.status;
    }
    const phase: WorldPhase = deepFreeze({
        turn: state.turn,
        intents,
        status,
        passive: state.npcs.filter(n => !COMBAT_STATUSES.has(n.status)).map(n => n.id),
        combat: state.npcs.filter(n => COMBAT_STATUSES.has(n.status)).map(n => n.id)
    });
    for (const step of WORLD_STEPS) {
        if (step === 'crewPhase') {
            state.turn++;
            state.phase = 'crew';
            ctx.emit({ type: 'phaseStarted', phase: 'crew', turn: state.turn });
        }
        for (const hook of WORLD_HOOKS[step]) {
            try {
                hook.run(ctx, phase);
            } catch (e) {
                // The world phase has no player command to refuse: a refusal from a hook is a bug in the rules.
                if (e instanceof IllegalCommand) throw new InvariantError(`World hook '${hook.name}' refused: ${e.message}`);
                throw e;
            }
        }
    }
}, { final: true });

// Each act step's hook, empty until the package that owns it fills it in under the same name.
registerWorldHook('passiveNpcs', 'npcs.passive', () => {}, { placeholder: true });
registerWorldHook('combatNpcs', 'npcs.combat', () => {}, { placeholder: true });
registerWorldHook('commitIntents', 'npcs.intents', () => {}, { placeholder: true });

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
