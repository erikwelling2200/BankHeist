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
import './crew/movement';
import './geo/cones';
import './geo/move';
import './geo/sound';
import './rules/carriers';
import './rules/doors';
import './rules/perceive';
import './rules/profile';
import './rules/suspicion';
import './rules/trespass';
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
export {
    crewHasKey, crewMoveOptions, registerDashCheck, registerMoveHook, type DashCheck, type MoveHook, type MoveMode
} from './crew/movement';
export {
    dashBudget, doorBetween, doorStatus, inHeavyArmour, LYING_STATUSES, moveBudget, occupancy, pathTo, reachable, reachAt, stepCost,
    validatePath, type MoveOptions, type Occupant, type PathCheck, type Reach, type ReachTile
} from './geo/move';
export {
    DEAF_STATUSES, inRing, makeNoise, noiseRadius, npcsInside, soundBudget, soundEdgeCost, soundRing, type Ring, type SoundTile
} from './geo/sound';
export * from './data/movement';
export * from './data/noise';
export { BLOCKS, buildSightMap, CLEAR, hasLineOfSight, lineOfSight, MID, sightInputs, sightMap, type SightMap } from './geo/los';
export {
    ARC_TAN, bandAt, bandOf, BLIND_STATUSES, cameraObserver, crewObserver, fieldOn,
    inArc, npcObserver, profilesOf, rangeOn, sees, seenTiles, seesOn, visionProfiles,
    type Arc, type Band, type HalfAngle, type Observer, type SightField, type VisionProfile, type VisionProfiles
} from './geo/cones';
export { worldFromBank, NOT_CARRIERS, OBJECT_KINDS } from './world/fromBank';
export { WALL_MATERIALS, DOOR_KINDS, type WallMaterial } from './world/materials';
export { packWorld, unpackWorld, packTiles, unpackTiles, type PackedTiles, type PackedWorld } from './world/compact';
export * from './data/items';
export * from './data/matrix';
export { checkLoadout, crewLook, crewProfile, friskFinds, notorietySteps, readProfile, type CrewLook } from './rules/profile';
export {
    addSuspicion, alertNpc, expose, EYES_DOWN, isEyesDown, isExposedTo, markSeen, MAX_PIPS, pipsOf, refreshWant, setEscort,
    type CameraReport, type Challenge, type LastSeen, type Want, type WantKind
} from './rules/suspicion';
export { challenge, challengeDeadline, challengerOf, deadlineOutcome, dueChallenge, hasWarned, isWarned } from './rules/trespass';
export {
    applySightings, assessEnd, assessPath, assessStep, assessWorldPhase, perceiveEnd, posesAlong, reaction, sightingsAlong,
    sightsAlongWalk, witness, witnessAct, worldPoses, type AlongOptions, type AssessOptions, type PathAssessment, type PoseAt,
    type Reaction, type ReactionInput, type Sighting, type WorldPhaseOptions, type WorldPoses, type Why
} from './rules/perceive';
