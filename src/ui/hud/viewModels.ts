/**
 * The stealth HUD's view models (UI.md "Screen layout", GAME_DESIGN.md §20.3). Plain JSON objects: the Session
 * (`src/game/`) builds a `HudViewModel` from the state and hands it to `mountHud(...).update(vm)`; the HUD never reads
 * the rules' state itself. Types only, so the Session can import this file without pulling in the DOM.
 *
 * Icons and portraits are named, not linked: the HUD maps each name to its picture (`icons.ts`).
 */

/** The 24px HUD icon set (UI.md "Visual language"), by name. */
export type HudIcon =
    | 'armed' | 'attack' | 'bag' | 'bell' | 'car' | 'cart' | 'charge' | 'chat' | 'clean' | 'command' | 'concealed'
    | 'confirm' | 'dash' | 'dmr' | 'dollar' | 'drill' | 'ear' | 'end' | 'eye' | 'ff' | 'flip' | 'fork' | 'grenade'
    | 'hack' | 'heat' | 'heavy' | 'hold' | 'interact' | 'kit' | 'knockout' | 'layers' | 'lmg' | 'lock' | 'lockpick'
    | 'loot' | 'map' | 'mask' | 'medkit' | 'moon' | 'move' | 'phone' | 'pistol' | 'play' | 'police' | 'radio'
    | 'reload' | 'revive' | 'rotl' | 'rotr' | 'run' | 'shield' | 'shotgun' | 'skip' | 'skull' | 'smg' | 'star'
    | 'suppress' | 'swap' | 'swat' | 'throw' | 'truck' | 'undo' | 'vest' | 'wait' | 'watch' | 'ziptie';

/**
 * A 48px portrait by name: the crew (`mara`, `jun`, `dex`, `sol`, and `-m` for masked) and NPC roles (`guard`,
 * `teller`, `cleaner`, `customer`, `manager`, `operator`, `police`, `swat`, `negotiator`). An unknown name draws a
 * placeholder with the person's initial.
 */
export type PortraitName = string;

/** Quiet until anything goes wrong; Alarm once the police are called (§9.2); Loud once shots or shouts are heard. */
export type BankStatus = 'quiet' | 'alarm' | 'loud';

export interface BankStatusVM {
    status: BankStatus;
    /** Turns until the police arrive, once the Alarm is up; `null` before. */
    policeEta: number | null;
}

/** One event on the day's schedule (§17.2 timeline): the lunch break, the cash run, the armoured car, closing. */
export interface ScheduleEntryVM {
    turn: number;
    label: string;
    icon: HudIcon;
}

/** The day's schedule, shown as a timeline in the top strip before the Alarm. */
export interface ScheduleVM {
    /** The last turn on the timeline (closing time); the track runs from turn 1 to here. */
    end: number;
    events: ScheduleEntryVM[];
}

/** The crew member's profile (§8.2): what someone who sees them makes of them. */
export type CrewProfile = 'clean' | 'concealed' | 'armed' | 'heavy';

export interface CrewVM {
    id: string;
    name: string;
    /** The crew colour (UI.md "Crew"), as CSS: `#60c0ce` for Mara. */
    colour: string;
    /** Their portrait; masked crew use the `-m` portraits. Defaults to the lower-cased name. */
    portrait?: PortraitName;
    actionsLeft: number;
    /** 2, or 3 on GO (the third pip is gold). */
    actionsMax: number;
    profile: CrewProfile;
    /** The NPCs who know this crew member is a criminal (§8.7); the rail shows an eye and the count. */
    exposedTo: string[];
    hp: number;
    hpMax: number;
    selected: boolean;
    /** Carried loot, or sitting in the van. */
    carrying?: 'loot' | 'van' | null;
}

/** One button in the contextual action grid for the selected crew member. */
export interface ActionVM {
    id: string;
    /** The action's name, shown on Confirm and in the long-press tag ("Move", "Knockout"). */
    label: string;
    icon: HudIcon;
    /** Action pips it costs (0 for free actions like Wait for). */
    cost: number;
    enabled: boolean;
    /** Why it can't be done now, shown in the tag when it is disabled ("Too far", "Needs a keycard"). */
    reason?: string;
    /** The action being previewed. */
    selected?: boolean;
    /** GO: wider, with a gold border (UI.md "Actions"). */
    go?: boolean;
}

/**
 * What kind of commitment Confirm makes, which sets its colour (UI.md "Confirm's colour"): `clean` cream (no suspicion,
 * no noise anyone hears), `costly` amber (a pip, an exposed tile, a noise someone hears), `lethal` red, `command` steel
 * blue (commands and Watch).
 */
export type CommitKind = 'clean' | 'costly' | 'lethal' | 'command';

export interface ConfirmVM {
    kind: CommitKind;
    /** The selected action's name ("MOVE", "FIRE ×6", "KILL PANEL"). */
    label: string;
    icon?: HudIcon;
    cost: number;
    /** False while nothing is previewed: Confirm is dimmed. */
    enabled: boolean;
}

/**
 * What a ledger row counts down to (§20.3 "Threat ledger"): an alarm carrier (§9.1) or someone escaping, police
 * reinforcements, a check-in call, a drill jam, a command lapsing, or a scheduled event.
 */
export type ThreatKind = 'carrier' | 'escape' | 'reinforcement' | 'checkIn' | 'drill' | 'lapse' | 'schedule';

export interface ThreatVM {
    id: string;
    label: string;
    /** World phases left (never under 2 for a new carrier). */
    countdown: number;
    kind: ThreatKind;
    icon: HudIcon;
    /** Who carries it, if anyone. */
    portrait?: PortraitName;
    /** What the camera jumps to when the row is tapped (an NPC, object or tile id). */
    targetId: string;
}

/** The overlay drawer's toggles (§20.3, §20.4). */
export type OverlayId = 'zones' | 'cones' | 'cameras' | 'cover' | 'sound' | 'materials';
export const OVERLAY_IDS: readonly OverlayId[] = ['zones', 'cones', 'cameras', 'cover', 'sound', 'materials'];

/** One of the last events on the recap card. */
export interface RecapEventVM {
    turn: number;
    label: string;
    icon: HudIcon;
    portrait?: PortraitName;
    /** A number the event changed, signed (−4 HP, drill 3). */
    delta?: number;
}

/** The recap card shown on resume (§20.6): the last 3 events, the bank and heat, the crew and the live threats. */
export interface RecapVM {
    events: RecapEventVM[];
    /** Heat 0–5 (§13), once the police are involved. */
    heat?: number;
}

export interface HudViewModel {
    turn: number;
    bank: BankStatusVM;
    schedule: ScheduleVM;
    /** In rail order; hotkeys 1–5 select them in this order. */
    crew: CrewVM[];
    /** The selected crew member's actions. */
    actions: ActionVM[];
    confirm: ConfirmVM;
    undoEnabled: boolean;
    /** Every live clock; the HUD sorts by urgency. */
    ledger: ThreatVM[];
    overlays: Record<OverlayId, boolean>;
    /** Whether the camera shows the tactical map. */
    mapOn?: boolean;
    /** Shown over everything until the player resumes. */
    recap?: RecapVM | null;
}

/** What the HUD reports back. Every input arrives here; the HUD changes nothing in the game itself. */
export interface HudCallbacks {
    selectCrew(id: string): void;
    action(id: string): void;
    confirm(): void;
    undo(): void;
    /** After the hold completes, and after the extra prompt when crew still have actions left. */
    endTurn(): void;
    toggleOverlay(id: OverlayId, on: boolean): void;
    /** A ledger row was tapped: move the camera to its target. */
    ledgerJump(targetId: string): void;
    toggleMap?(): void;
    /** The recap card's Resume. */
    resume?(): void;
}

export interface HudHandle {
    update(vm: HudViewModel): void;
    /** Scales the HUD's text (§20.8), 1 by default. */
    setTextScale(scale: number): void;
    destroy(): void;
}
