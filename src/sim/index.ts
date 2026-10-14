/*
 * The rules engine (GAME_DESIGN §6): pure and deterministic, with no rendering, no clock and no unseeded randomness
 * (tsconfig.sim.json and tests/sim/purity.test.ts hold it to that). Import it from here: this module loads every
 * system so its commands, events and world-phase hooks are registered before the first command is played.
 */

// Systems. A package appends its module here, keeping the block in alphabetical order (registrations don't depend on
// the order: placeholders give way to real ones, and inits and hooks run sorted by name).
// --- systems: begin
import './core/engine';
import './crew/actions';
import './geo/cones';
import './rules/carriers';
// --- systems: end

export * from './core/types';
export * from './core/grid';
export { Dice, DICE_WINDOW, OddsStop, PreviewRollError, type Mode, type PendingOdds } from './core/rng';
export {
    commit, preview, COMBAT_STATUSES, IllegalCommand, InvariantError, registerCommand, registerWorldHook, worldHooks, WORLD_STEPS,
    type Ctx, type CommitResult, type PreviewResult, type Reducer, type RegisterOptions, type WorldHook, type WorldPhase, type WorldStep
} from './core/engine';
export { registerEvents, eventClass, recordUndo, popUndo, type EventClass, type UndoStack } from './core/undo';
export {
    initialState, crewMember, edgeNow, spendActions, newId, defaultRules, registerRuleDefaults, registerStateInit,
    registerNpcInit, registerCrewInit, type CrewStart, type StateInit, type NpcInit, type CrewInit
} from './core/state';
export {
    serialise, deserialise, serialiseState, deserialiseState, serialiseWorld, deserialiseWorld, appendRecent, RECENT_EVENTS,
    SAVE_FORMAT, SaveFormatError, type Save, type Saved, type SavedState
} from './core/save';
export {
    assertPlainJson, clonePlain, deepFreeze, devChecksOn, hashOf, isPlainJson, isReservedKey, samePlain, setDevChecks, sortedIds,
    stableJson
} from './core/json';
export { startCarrier } from './rules/carriers';
export { freezeWorld } from './world/freeze';
export { fixtureWorld, type FixtureOptions, type FixtureWall } from './world/fixture';
export { BLOCKS, buildSightMap, CLEAR, hasLineOfSight, lineOfSight, MID, sightInputs, sightMap, type SightMap } from './geo/los';
export {
    ALERTED_STATUSES, ARC_TAN, bandAt, bandOf, BLIND_STATUSES, cameraObserver, crewObserver, fieldOn,
    inArc, npcObserver, profilesOf, rangeOn, sees, seenTiles, seesOn, visionProfiles,
    type Arc, type Band, type HalfAngle, type Observer, type SightField, type VisionProfile, type VisionProfiles
} from './geo/cones';
