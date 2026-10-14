import type { Carrier, CarrierKind, ReadonlyWorld, SimEvent, State } from '../sim';
import type { UiState } from './session';

/*
 * View models for the HUD (implementation plan §2.5): plain objects made from the state, so the HUD never reads
 * `State` itself and a rule can change the state's shape without touching the HUD. Fields the later packages fill in
 * (profile, HP, heat, police phase) are here already as placeholders, so the HUD can lay them out now.
 */

export type BankStatus = 'quiet' | 'loud' | 'alarm';

export interface BankView {
    status: BankStatus;
    /** What the state pill says. */
    label: string;
    /** The most urgent live carrier's countdown, if any (the pill shows it, UI.md). */
    nextAlarmIn: number | null;
}

/** The profile icon on a crew card (§8.6); 'unknown' until the profile package. */
export type ProfileView = 'unknown';

export interface CrewCardView {
    id: string;
    name: string;
    actionsLeft: number;
    actionsMax: number;
    selected: boolean;
    profile: ProfileView;
    /** The NPCs who know this crew member is a criminal (§8.7), by id; non-empty shows the Exposed marker. */
    exposedTo: string[];
    /** Hit points, null until crew health exists. */
    hp: { now: number; max: number } | null;
}

export interface ThreatView {
    id: string;
    kind: CarrierKind;
    /** Who or what carries it. */
    source: string;
    /** Where the camera goes when the row is tapped. */
    pos: { x: number; y: number };
    countdown: number;
    halted: Carrier['halted'];
    /** A short line for the ledger row. */
    label: string;
}

export interface HudView {
    turn: number;
    bank: BankView;
    crew: CrewCardView[];
    /** Live alarm carriers, most urgent first (§20.3 threat ledger). */
    threats: ThreatView[];
    selected: string | null;
}

const CARRIER_LABELS: Readonly<Record<CarrierKind, string>> = {
    tellerButton: 'Teller button', managerButton: 'Manager button', guardRadio: 'Guard radio', operatorCamera: 'Camera operator',
    phoneCall: 'Phone call', escapee: 'Escapee', missedCheckIn: 'Missed check-in', seismicSensor: 'Seismic sensor',
    motionSensor: 'Motion sensor', patrolCar: 'Patrol car'
};

/** Live carriers, most urgent first: running before halted, then by countdown, then by id. */
export function threatLedger(state: State): ThreatView[] {
    return state.carriers
        .filter(c => c.halted !== 'countered')
        .map(c => ({
            id: c.id, kind: c.kind, source: c.source, pos: { x: c.pos.x, y: c.pos.y }, countdown: c.countdown, halted: c.halted,
            label: `${CARRIER_LABELS[c.kind] ?? c.kind} ${c.countdown}${c.halted ? ' (paused)' : ''}`
        }))
        .sort((a, b) => Number(!!a.halted) - Number(!!b.halted) || a.countdown - b.countdown || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function bankView(state: State): BankView {
    const running = threatLedger(state).filter(t => !t.halted);
    const nextAlarmIn = running.length ? running[0]!.countdown : null;
    const status: BankStatus = state.bank.alarm ? 'alarm' : state.bank.loud ? 'loud' : 'quiet';
    const label = status === 'alarm' ? 'ALARM' : status === 'loud' ? 'LOUD' : nextAlarmIn !== null ? `QUIET: alarm in ${nextAlarmIn}` : 'QUIET';
    return { status, label, nextAlarmIn };
}

export function crewCards(world: ReadonlyWorld, state: State, selected: string | null): CrewCardView[] {
    return state.crew.map(c => ({
        id: c.id,
        name: c.name,
        actionsLeft: c.actionsLeft,
        actionsMax: world.rules.actionsPerTurn,
        selected: c.id === selected,
        profile: 'unknown',
        exposedTo: state.npcs.filter(n => n.exposedTo.includes(c.id)).map(n => n.id),
        hp: null
    }));
}

export function hudView(world: ReadonlyWorld, state: State, ui: UiState): HudView {
    return { turn: state.turn, bank: bankView(state), crew: crewCards(world, state, ui.selected), threats: threatLedger(state), selected: ui.selected };
}

// ------------------------------------------------------------------------------------------------------------ Recap

/** A crew member's status on the recap card; 'down' and 'arrested' come with crew health. */
export type CrewStatus = 'ready' | 'done';

export interface RecapCrewView {
    id: string;
    name: string;
    status: CrewStatus;
    actionsLeft: number;
    exposed: boolean;
}

export interface RecapView {
    turn: number;
    bank: BankView;
    /** The last three events, oldest first, each with a line of text. */
    recent: { event: SimEvent; text: string }[];
    crew: RecapCrewView[];
    threats: ThreatView[];
}

/** How many events the recap card shows (§20.6). */
export const RECAP_EVENTS = 3;

/** The resume recap card (§20.6). */
export function recapView(world: ReadonlyWorld, state: State, recent: readonly SimEvent[]): RecapView {
    return {
        turn: state.turn,
        bank: bankView(state),
        recent: recent.slice(-RECAP_EVENTS).map(event => ({ event, text: describeEvent(world, state, event) })),
        crew: state.crew.map(c => ({
            id: c.id, name: c.name,
            status: c.actionsLeft > 0 ? 'ready' : 'done',
            actionsLeft: c.actionsLeft,
            exposed: state.npcs.some(n => n.exposedTo.includes(c.id))
        })),
        threats: threatLedger(state)
    };
}

/** A line of text for the event log and the recap. Event types without a line of their own show their type. */
export function describeEvent(world: ReadonlyWorld, state: State, event: SimEvent): string {
    const name = (id: string): string => state.crew.find(c => c.id === id)?.name ?? world.people.find(p => p.id === id)?.name ?? id;
    switch (event.type) {
        case 'moved': return `${name(event.crew)} moved to (${event.to.x}, ${event.to.y})`;
        case 'waited': return `${name(event.crew)} waited`;
        case 'phaseStarted': return event.phase === 'crew' ? `Turn ${event.turn}` : `World phase of turn ${event.turn}`;
        case 'carrierStarted': return `${CARRIER_LABELS[event.kind] ?? event.kind}: alarm in ${event.countdown}`;
        case 'carrierTicked': return `Alarm in ${event.countdown}`;
        case 'alarmRaised': return 'The alarm is raised';
        case 'wentLoud': return `The bank went loud: ${event.cause}`;
        default: return event.type;
    }
}
