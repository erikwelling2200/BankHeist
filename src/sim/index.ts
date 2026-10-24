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
import './rules/actions/act';
import './rules/actions/body';
import './rules/actions/door';
import './rules/actions/interact';
import './rules/actions/knockout';
import './rules/actions/loot';
import './rules/actions/wait';
import './rules/autoAdvance';
import './rules/alarms';
import './rules/cameras';
import './rules/carriers';
import './rules/cctv';
import './rules/checkins';
import './rules/command';
import './rules/doors';
import './rules/evidence';
import './rules/knowledge';
import './rules/npc/act';
import './rules/npc/behaviour';
import './rules/npc/intent';
import './rules/npc/schedule';
import './rules/npc/walk';
import './rules/perceive';
import './rules/profile';
import './rules/suspicion';
import './rules/trespass';
// --- systems: end

export * from './core/types';
export * from './core/grid';
export { Dice, DICE_WINDOW, OddsStop, PreviewRollError, type Mode, type PendingOdds } from './core/rng';
export {
    commit, preview, COMBAT_STATUSES, IllegalCommand, InvariantError, registerCommand, registerCommandHook, commandHooks, registerWorldHook, worldHooks, WORLD_STEPS,
    type CommandHook, type Ctx, type CommitResult, type PreviewResult, type Reducer, type RegisterOptions, type WorldHook, type WorldPhase, type WorldStep
} from './core/engine';
export { registerEvents, eventClass, recordUndo, popUndo, type EventClass, type UndoStack } from './core/undo';
export {
    initialState, crewMember, edgeNow, spendActions, newId, defaultRules, registerRuleDefaults, registerStateInit,
    registerNpcInit, registerCrewInit, type CrewStart, type StateInit, type NpcInit, type CrewInit
} from './core/state';
export {
    serialise, deserialise, serialiseState, deserialiseState, serialiseWorld, deserialiseWorld, appendRecent, RECENT_EVENTS,
    registerStateCheck, SAVE_FORMAT, SaveFormatError, type Save, type Saved, type SavedState, type StateCheck
} from './core/save';
export {
    assertPlainJson, clonePlain, deepFreeze, devChecksOn, hashOf, isPlainJson, isReservedKey, samePlain, setDevChecks, sortedIds,
    stableJson
} from './core/json';
export {
    CARRIERS, carrierBlocked, carrierPreview, carriersStarted, carrierVerdict, holderKnown, knownCarriers, panelDead, pendingCarriers, projectCarriers, raiseCarrier,
    registerCarrierCheck, settleCarriers, startCarrier, stopCarrier, type AlarmResponse, type CarrierChanges, type CarrierCheck, type CarrierDef,
    type CarrierPreview, type CarrierRequest, type CarrierVerdict, type KnownCarrier
} from './rules/carriers';
export {
    carrierPos, HACKING_KIT, hasTrait, JAMMER, jammed, panelWorkLeft, startEscapee, TRAITS, walkingToAlarm, workActions, type AlarmWalk, type Jammer, type Trait
} from './rules/alarms';
export {
    filmedCrew, footageKept, LOOP_FROM, nearestFreeGuard, operatorWatch, pinVerifiers, type Footage
} from './rules/cameras';
export {
    atDesk, attentiveOperator, cctvControlled, cctvDesk, feedsAt, guardIds, isGuard, liveFeeds, NEUTRALISED, neutralised, operatorGone, operatorIds
} from './rules/cctv';
export {
    answersLeft, checkInPeriod, driveByDue, nextDriveBy, patrolSightings, type CheckIn, type PatrolRoute, type Radio
} from './rules/checkins';
export { freezeWorld } from './world/freeze';
export { fixtureWorld, type FixtureOptions, type FixtureWall } from './world/fixture';
export {
    crewBudget, crewHasKey, crewMoveOptions, dashRefusal, planMoveOptions, planningState, registerBudgetModifier, registerDashCheck, registerMoveHook, registerMoveLimit, registerPlanView, type DashCheck,
    type BudgetModifier, type MoveCut, type MoveHook, type MoveLimit, type MoveMode, type PlanView
} from './crew/movement';
export {
    ABSENT_STATUSES, dashBudget, doorBetween, doorStatus, inHeavyArmour, LYING_STATUSES, moveBudget, occupancy, pathTo, reachable, reachAt, stepCost,
    validatePath, type MoveOptions, type Occupant, type PathCheck, type Reach, type ReachTile
} from './geo/move';
export {
    DEAF_STATUSES, inRing, makeNoise, noiseRadius, npcsInside, registerNoiseHook, soundBudget, soundEdgeCost, soundRing, type NoiseHook, type Ring,
    type SoundTile
} from './geo/sound';
export * from './data/movement';
export * from './data/noise';
export { BLOCKS, buildSightMap, CLEAR, hasLineOfSight, lineOfSight, MID, sightInputs, sightMap, type SightMap } from './geo/los';
export {
    ARC_TAN, bandAt, bandOf, BLIND_STATUSES, cameraObserver, crewObserver, fieldOn,
    inArc, npcObserver, profilesOf, rangeOn, sees, seenTiles, seesOn, visionProfiles,
    type Arc, type Band, type HalfAngle, type Observer, type SightField, type VisionProfile, type VisionProfiles
} from './geo/cones';
export { worldFromBank, NOT_CARRIERS, OBJECT_KINDS, STASH_ROOMS } from './world/fromBank';
export { inReach, lacksActions, legalActions, registerAction, whyNot, witnessActOn, witnessOn, type ActionDef } from './rules/actions/act';
export { besideDoor, DOOR_ACTIONS, doorActionBlocked, doorSides, innerSide, type DoorAction } from './rules/actions/door';
export { bodyAway, DRAGGABLE, releaseBody, STASH_KINDS, stashes } from './rules/actions/body';
export { bodyPos, draggedBy, onFloor, placeCrew } from './rules/place';
export {
    carryWeight, crewLoot, handsFree, inBuilding, inHands, lootObject, lootOf, lootWeight, pocketed, throwFlies, throwPlan, throwTargets,
    type LootState, type ThrowPlan
} from './rules/actions/loot';
export { knockoutBlocked, knockoutIneligible, registerKnockoutWindow, type KnockoutWindow } from './rules/actions/knockout';
export { interactionVerbs, reachesObject, registerInteraction, type InteractionHandler, type InteractionVerb } from './rules/actions/interact';
export {
    applyEvidence, bodyLying, clearEvidence, evidenceOnMap, evidenceWorldPhase, hearing, isMajor, MAJOR_EVIDENCE, noiseReactions, notices, placeEvidence,
    projectEvidenceSightings, registerEvidenceSource, sendToLook,
    REPORT_CARRIERS, reportAssault, type CameraEvidence, type Evidence, type EvidenceKind, type EvidenceOptions, type EvidenceSighting, type EvidenceSource,
    type EvidenceWant, type Hearing, type MajorEvidence, type MinorEvidence, type PlacedEvidence
} from './rules/evidence';
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
    applySightings, assessEnd, assessPath, assessWorldPhase, lookSightings, onePerObserver, perceiveEnd, posesAlong, queueLook, reaction,
    sightingsAlong, sightsAlongWalk, turnLookers, witness, witnessAct, withLookers, worldPoses, type AlongOptions, type AssessOptions, type PoseAt,
    type Reaction, type ReactionInput, type Sighting, type WorldPhaseOptions, type WorldPoses, type Why
} from './rules/perceive';
export {
    activityAt, blockIndexAt, LEAVING_ACTIVITIES, nextActivity, nextScheduleTurn, ROUTE_ACTIVITIES, routeMode, scheduleTurns, startingOn,
    wayBackIn, type ScheduledActivity
} from './rules/npc/schedule';
export {
    behaviourGoal, decidesFor, evidenceGoal, evidenceReport, friskSatisfied, investigatorOf, pickInvestigator, reactionOf, registerReaction, ROUTINE_STATUSES, statusFor,
    topWant, type Goal, type GoalKind, type Reaction as NpcReaction, type ReactionPlan, type RouteProgress, type Search
} from './rules/npc/behaviour';
export { committedEnd, reconsider } from './rules/npc/intent';
export {
    blueprint, crewPicture, floorKnowledge, registerLookout, type Lookout, isKnownNow, isUnknownRisk, knownBlockers, knownDoorStatus, knownNpcIds, knownView, markerKind, noticedUnseen, onRoutine,
    tileVisibility, visibilityMap, VISIBILITY, type TileVisibility, doorDoubt, doorMayRefuse, mayLookIntoHidden, narrowDoubt, previewCertain, sightDoubted, viewDoubted, withDoubtedShut, withLayoutCameras, withPicturedDoors,
    type DoorDoubt,
    projectEvents, projectPreviewEvents, unknownReach, unknownWatcher, unknownWatchers, updateKnowledge, type UnknownOptions, type UnknownWatcher, type Blueprint, type FloorKnowledge, type Intel, type Knowledge, type KnownCamera,
    type KnownDoor, type KnownView, type MarkerKind, type NpcKnowledge, type NpcMarker, type Ping, type ProjectOptions, type UpdateOptions
} from './rules/knowledge';
export { bitsCount, decodeBits, encodeBits } from './rules/knowledgeBits';
export { npcActSightings } from './rules/npc/act';
export {
    crewTiles, intentEnd, isPresent, npcCanPass, npcMoveOptions, othersTiles, paceBudget, personOf, planWalk, resolveWalks, walksIntent,
    type Pace, type PlannedWalk, type Walked, type WalkTarget
} from './rules/npc/walk';
export {
    AUTO_TURN_CAP, autoAdvance, autoAdvanceBlocked, autoStep, interruptsOf, knownSchedule, NEAR_TILES, npcLabel, planRoute, previewDanger, routeBreak, routeLeg, safeLeg, waitOptions,
    waitReached, type AutoOptions, type AutoStepResult, type AutoStop, type Interrupt, type InterruptKind, type InterruptOptions, type KnownEvent,
    type RouteLeg, type Routes, type StopKind, type WaitOption, type WaitTarget
} from './rules/autoAdvance';
export { previewPicture } from './preview/picture';
export { addsTo, effectOf, isQuiet, noEffect, teammateEffects, type Effect, type TeammateEffect } from './preview/effect';
export {
    effectKind, judgePath, judgeStay, overlayTiles, pathSafety, safeFloor, safeFloorJob, TINT_RANK, tintOf, tintRank, type FloorBand, type FloorJob, type FloorOptions, type FloorTile, type Judged,
    type PathOptions,
    type PathSafety, type PathStep, type SafeFloor, type Tint, type TintKind
} from './preview/floor';
export { explain, observerName, sightingText, type Explanation } from './preview/explain';
export { actionPreview, type ActionPreview, type Ear, type NoisePreview, type Witness } from './preview/action';
export { commandPreview, holdPreview } from './preview/command';
export {
    commandNpc, commandPlan, commandRadius, crewThreat, goBlocked, holdTargets, isResister, resistChance,
    type Commanded, type CommandPlan, type CommandTarget, type Lapse, type LapseOutcome
} from './rules/command';
export { PANIC, panicWeights, type PanicWeights } from './data/archetypes';
