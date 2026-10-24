/*
 * The game session (implementation plan §2.1, M1-12): between the pure rules in src/sim and the scene and HUD.
 */

export { Session, HEIST_KEY, UI_KEY, PREVIEW_CACHE, worldKey, projectPreview, type PlayerPreview, type ResumeOptions, type CameraView, type SessionChange, type SessionListener, type SessionOptions, type UiState } from './session';
export { MemoryStorage, webStorage, type SaveStorage } from './storage';
export {
    importance, PlaybackQueue, registerImportance, SPEED_FACTOR, type ImportanceRule, type ImportantReason, type PlaybackItem, type PlaybackSpeed
} from './playback';
export {
    actionsView, bankView, barkText, confirmView, doorName, crewCards, describeEvent, hudView, RECAP_EVENTS, recapView, rolePortrait, threatLedger, type ActionId, type HudExtras
} from './views';
export { actionMenu, cameraName, doorMiddle, knownCameras, menuIsLegal, nextCamera, targetsOf, throwTiles, VERBS, type ActionEntry, type Targets } from './actions';
export { moveAlong, moveKind, moveRange, moveTo, type MoveRange } from './movement';
export { deserialiseHeist, deserialiseUi, heistWorldId, serialiseHeist, serialiseUi, serialiseWorld, type HeistExtras } from './persist';
export type { FloorJob } from '../sim';
export { installDebugHandle, type SimHandle } from './debug';
export { AutoRun, autoBarView, routeViews, stopLine, stopNeedsAttention, waitMenu, type RouteView } from './autoAdvance';
