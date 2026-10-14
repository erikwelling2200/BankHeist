/*
 * The rules engine (GAME_DESIGN §6): pure and deterministic, with no rendering, no clock and no unseeded randomness
 * (tests/sim/purity.test.ts holds it to that). Import it from here: this module loads every system so its commands,
 * events and world-phase hooks are registered before the first command is played.
 */

import './core/engine';
import './crew/actions';

export * from './core/types';
export * from './core/grid';
export { Dice, PreviewRollError, type Mode } from './core/rng';
export {
    commit, preview, IllegalCommand, registerCommand, registerWorldHook, worldHooks, WORLD_STEPS,
    type Ctx, type CommitResult, type Reducer, type WorldHook, type WorldStep
} from './core/engine';
export { registerEvents, eventClass, recordUndo, popUndo, type EventClass, type UndoStack } from './core/undo';
export { initialState, crewMember, spendActions, newId, type CrewStart } from './core/state';
export { serialise, deserialise, SAVE_FORMAT, SaveFormatError, type Save } from './core/save';
export { hashOf, stableJson } from './core/hash';
export { fixtureWorld, type FixtureOptions, type FixtureWall } from './world/fixture';
