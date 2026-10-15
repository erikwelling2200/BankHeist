import type { CarrierKind } from '../../sim';

/**
 * The stealth HUD's view-model contract (UI.md "Screen layout", GAME_DESIGN.md §20.3). Plain JSON: the Session's view
 * layer (`src/game/views.ts`) builds a `HudViewModel` from the state and hands it to `mountHud(...).update(vm)`; the HUD
 * never reads the rules' state itself. Types and constants only, so the Session can import this file without the DOM.
 *
 * Icons and portraits are named, not linked: the HUD maps each name, and each threat kind, to its picture.
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
 * `teller`, `cleaner`, `customer`, `manager`, `operator`, `police`, `swat`, `negotiator`). An unknown name, or none,
 * draws a placeholder with the person's initial.
 */
export type PortraitName = string;

export interface Pos { x: number; y: number }

// ---------------------------------------------------------------------------------------------------------- Bank

/** Quiet until anything goes wrong; Alarm once the police are called (§9.2); Loud once shots or shouts are heard. */
export type BankStatus = 'quiet' | 'alarm' | 'loud';

/** Heat once the police are on site (§13): its level, the ticks towards the next, and what the next level brings. */
export interface HeatVM {
    level: number;
    /** Filled ticks of the bar, 0–5. */
    ticks: number;
    next: { label: string; inTurns: number } | null;
}

export interface BankStatusVM {
    status: BankStatus;
    /** What the state pill says ("QUIET", "QUIET: alarm in 2", "ALARM", "LOUD"); the HUD shows it as given. */
    label: string;
    /** The most urgent running carrier's countdown, if any; the pill shows it with a bell (UI.md "Top strip"). */
    nextAlarmIn: number | null;
    /** Turns until the police arrive once the Alarm is up (0 on site); absent or null before. */
    policeEta?: number | null;
    /** GO is on (§10.4): the pill turns gold. */
    go?: boolean;
    /** After the police arrive (§13). */
    heat?: HeatVM | null;
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

// ---------------------------------------------------------------------------------------------------------- Crew

/** The crew member's profile (§8.6): what someone who sees them makes of them; 'unknown' until profiles exist. */
export type CrewProfile = 'clean' | 'concealed' | 'armed' | 'heavy' | 'unknown';

/** The crew colours in rail order (UI.md "Crew"); the view layer assigns them from the crew's order. */
export const CREW_COLOURS: readonly string[] = ['#60c0ce', '#ce74b8', '#9684e0', '#dac8a2', '#b0c870'];

export interface CrewVM {
    id: string;
    name: string;
    /** The crew colour as CSS, assigned by the view layer from the crew's order (`CREW_COLOURS`). */
    colour: string;
    /** Their portrait; masked crew use the `-m` portraits. Absent draws the initial. */
    portrait?: PortraitName;
    actionsLeft: number;
    /** 2, or 3 on GO (the third pip is gold). */
    actionsMax: number;
    profile: CrewProfile;
    /** The NPCs who know this crew member is a criminal (§8.7), by id; the rail shows an eye and the count. */
    exposedTo: string[];
    /** Hit points, or null while unknown (shown as such). */
    hp: { now: number; max: number } | null;
    selected: boolean;
    /** Carried loot, or sitting in the van. */
    carrying?: 'loot' | 'van' | null;
    /** Rounds in the magazine and spare magazines; `lastMag` warns on the last one (§20.3). */
    ammo?: { mag: number; spare: number; lastMag: boolean } | null;
}

// ---------------------------------------------------------------------------------------------------------- Actions

/** One button in the contextual action grid for the selected crew member (at most `MAX_ACTIONS` are shown). */
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
    /** Work done so far on a job spread over several actions ("2/4" on the alarm panel), shown on the button. */
    progress?: string;
}

/** How many actions the grid shows (four rows of two). */
export const MAX_ACTIONS = 8;

/**
 * What kind of commitment Confirm makes, which sets its colour and glyph (UI.md "Confirm's colour"): `clean` cream (no
 * suspicion, no noise anyone hears), `costly` amber (a pip, an exposed tile, a noise someone hears), `lethal` red,
 * `command` steel blue (commands and Watch).
 */
export type CommitKind = 'clean' | 'costly' | 'lethal' | 'command';

export interface ConfirmVM {
    kind: CommitKind;
    /** The selected action's name ("MOVE", "FIRE ×6", "KILL PANEL"); never truncated. */
    label: string;
    icon?: HudIcon;
    cost: number;
    /** The alarm carriers it would start, now or in the coming world phase (§8.8): "Teller button (2)". */
    starts?: string[];
    /** The carriers it would stop (a dead panel, an answered radio). */
    stops?: string[];
    /** False while nothing is previewed: Confirm is dimmed. */
    enabled: boolean;
}

// ---------------------------------------------------------------------------------------------------------- Threats

/**
 * What a ledger row counts down to (§20.3 "Threat ledger"): an alarm carrier by its kind (§9.1, the rules'
 * `CarrierKind`), or police reinforcements, a drill jam, a command lapsing, a scheduled event, a guard's radio check-in
 * (§8.11) or the patrol car's drive-by (§16.3). The HUD picks the icon.
 */
export type ThreatKind = CarrierKind | 'reinforcement' | 'drill' | 'lapse' | 'schedule' | 'checkIn' | 'driveBy';

export interface ThreatVM {
    id: string;
    kind: ThreatKind;
    /** Who or what carries it (an NPC or object id); empty where the crew doesn't know who. */
    source: string;
    /** A short name for the row, without the countdown ("Teller button"). */
    label: string;
    /** World phases left (never under 2 for a new carrier). */
    countdown: number;
    /** A paused carrier doesn't tick (its holder is commanded, a jammer runs). */
    halted: 'paused' | null;
    /** Needs the crew now (a downed guard's radio ringing): drawn amber, whatever its kind. */
    urgent?: boolean;
    /** Where the camera goes when the row is tapped; null where the crew doesn't know (a holder it can't see). */
    pos: Pos | null;
    /** The NPC or object to focus, if any. */
    targetId?: string;
    /** Who carries it, if a person. */
    portrait?: PortraitName;
}

// ---------------------------------------------------------------------------------------------------------- Overlays

/** The overlay drawer's toggles (§20.3, §20.4). */
export type OverlayId = 'zones' | 'cones' | 'cameras' | 'cover' | 'sound' | 'materials';
export const OVERLAY_IDS: readonly OverlayId[] = ['zones', 'cones', 'cameras', 'cover', 'sound', 'materials'];

// ---------------------------------------------------------------------------------------------------------- Recap

/** One of the last events on the recap card, with the turn it happened in. */
export interface RecapEventVM {
    turn: number;
    /** A line of text ("mara moved to (1, 2)"). */
    text: string;
    icon?: HudIcon;
    portrait?: PortraitName;
    /** A number the event changed, signed (−4 HP, drill 3). */
    delta?: number;
}

export interface RecapCrewVM {
    id: string;
    name: string;
    colour: string;
    portrait?: PortraitName;
    status: 'ready' | 'done';
    actionsLeft: number;
    exposed: boolean;
    hp: { now: number; max: number } | null;
}

/** The recap card shown on resume (§20.6): the last 3 events, the bank and heat, each crew member, the live threats. */
export interface RecapVM {
    turn: number;
    bank: BankStatusVM;
    /** Oldest first; the card shows the last three. */
    events: RecapEventVM[];
    crew: RecapCrewVM[];
    /** In the Session's order, like the ledger. */
    threats: ThreatVM[];
}

// ---------------------------------------------------------------------------------------------------------- The HUD

export interface HudViewModel {
    turn: number;
    bank: BankStatusVM;
    /** Absent or null: the strip shows an empty track. */
    schedule?: ScheduleVM | null;
    /** In rail order; hotkeys 1–5 select them in this order. */
    crew: CrewVM[];
    /** The selected crew member's id. */
    selected?: string | null;
    /** The selected crew member's actions. */
    actions: ActionVM[];
    confirm: ConfirmVM;
    undoEnabled: boolean;
    /**
     * Every live clock, in the Session's order (most urgent first: running before paused, then by countdown); the HUD
     * doesn't re-sort.
     */
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
    /** After the hold (or the keyboard's two steps), and after the prompt when crew still have actions left. */
    endTurn(): void;
    toggleOverlay(id: OverlayId, on: boolean): void;
    /** A ledger row was tapped: move the camera to `pos` (and focus `targetId`, if given). */
    ledgerJump(pos: Pos, targetId?: string): void;
    toggleMap?(): void;
    /** The recap card's Resume. */
    resume?(): void;
}

/** The HUD's hotkeys (§20.7), by what they do; `KeyboardEvent.key` values, lower-case for letters. */
export interface HudKeymap {
    selectCrew: string[];
    endTurn: string;
    confirm: string;
    undo: string;
    ledger: string;
    drawer: string;
    close: string;
}

export const DEFAULT_KEYMAP: Readonly<HudKeymap> = { selectCrew: ['1', '2', '3', '4', '5'], endTurn: ' ', confirm: 'Enter', undo: 'z', ledger: 'Tab', drawer: 'o', close: 'Escape' };

export interface HudOptions {
    /** Rebinds hotkeys (§20.8 "full rebinding on desktop"). */
    keymap?: Partial<HudKeymap>;
    /** Text scale, 1 by default (§20.8). */
    textScale?: number;
    /** The colour-blind preset of the signal palette (UI.md "Signal palette"). */
    colourBlind?: boolean;
}

export interface HudHandle {
    update(vm: HudViewModel): void;
    /** Scales the HUD's text (§20.8), 1 by default. */
    setTextScale(scale: number): void;
    setColourBlind(on: boolean): void;
    destroy(): void;
}
