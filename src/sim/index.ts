/*
 * The rules engine (GAME_DESIGN §6): pure and deterministic, with no rendering, no clock and no unseeded randomness
 * (tsconfig.sim.json and tests/sim/purity.test.ts hold it to that). Import it from here: this module loads every
 * system so its commands, events and world-phase hooks are registered before the first command is played.
 */

import './core/engine';
import './crew/actions';
import './rules/carriers';

export * from './core/types';
export * from './core/grid';
export { Dice, DICE_WINDOW, OddsStop, PreviewRollError, type Mode, type PendingOdds } from './core/rng';
export {
    commit, preview, COMBAT_STATUSES, IllegalCommand, InvariantError, registerCommand, registerWorldHook, worldHooks, WORLD_STEPS,
    type Ctx, type CommitResult, type PreviewResult, type Reducer, type WorldHook, type WorldPhase, type WorldStep
} from './core/engine';
export { registerEvents, eventClass, recordUndo, popUndo, type EventClass, type UndoStack } from './core/undo';
export { initialState, crewMember, edgeNow, spendActions, newId, type CrewStart } from './core/state';
export { serialise, deserialise, appendRecent, RECENT_EVENTS, SAVE_FORMAT, SaveFormatError, type Save, type Saved } from './core/save';
export { assertPlainJson, clonePlain, deepFreeze, hashOf, sortedIds, stableJson } from './core/json';
export { startCarrier } from './rules/carriers';
export { freezeWorld } from './world/freeze';
export { fixtureWorld, type FixtureOptions, type FixtureWall } from './world/fixture';
export { registerMoveHook, type MoveHook, type MoveMode } from './crew/actions';
export {
    dashBudget, inHeavyArmour, LYING_STATUSES, moveBudget, occupancy, pathTo, reachable, reachAt, stepCost, validatePath,
    type MoveOptions, type Occupant, type PathCheck, type Reach, type ReachTile
} from './geo/move';
export { DEAF_STATUSES, inRing, makeNoise, npcsInside, soundEdgeCost, soundRing, type Ring, type SoundTile } from './geo/sound';
export * from './data/movement';
export * from './data/noise';
