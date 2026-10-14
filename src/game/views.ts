import type { CarrierKind, ReadonlyWorld, SimEvent, State } from '../sim';
import {
    CREW_COLOURS, OVERLAY_IDS, type BankStatus, type BankStatusVM, type CrewVM, type HudViewModel, type OverlayId, type RecapEventVM,
    type RecapVM, type ThreatVM
} from '../ui/hud/viewModels';
import type { UiState } from './session';

/*
 * View models for the HUD (implementation plan §2.5): plain objects made from the state, so the HUD never reads
 * `State` itself and a rule can change the state's shape without touching the HUD. The types are the HUD's contract
 * (src/ui/hud/viewModels.ts); fields the later packages fill in (profile, HP, heat, actions) are placeholders for now.
 */

const CARRIER_LABELS: Readonly<Record<CarrierKind, string>> = {
    tellerButton: 'Teller button', managerButton: 'Manager button', guardRadio: 'Guard radio', operatorCamera: 'Camera operator',
    phoneCall: 'Phone call', escapee: 'Escapee', missedCheckIn: 'Missed check-in', seismicSensor: 'Seismic sensor',
    motionSensor: 'Motion sensor', patrolCar: 'Patrol car'
};

/** Live carriers, most urgent first: running before halted, then by countdown, then by id. */
export function threatLedger(state: State): ThreatVM[] {
    const live: ThreatVM[] = [];
    for (const c of state.carriers) {
        if (c.halted === 'countered') continue;
        live.push({
            id: c.id, kind: c.kind, source: c.source, label: CARRIER_LABELS[c.kind] ?? c.kind, countdown: c.countdown,
            halted: c.halted === 'paused' ? 'paused' : null, pos: { x: c.pos.x, y: c.pos.y }, targetId: c.source
        });
    }
    return live.sort((a, b) => Number(!!a.halted) - Number(!!b.halted) || a.countdown - b.countdown || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function bankView(state: State): BankStatusVM {
    const running = threatLedger(state).filter(t => !t.halted);
    const nextAlarmIn = running.length ? running[0]!.countdown : null;
    const status: BankStatus = state.bank.alarm ? 'alarm' : state.bank.loud ? 'loud' : 'quiet';
    const label = status === 'alarm' ? 'ALARM' : status === 'loud' ? 'LOUD' : nextAlarmIn !== null ? `QUIET: alarm in ${nextAlarmIn}` : 'QUIET';
    return { status, label, nextAlarmIn };
}

/** Each crew member's colour, from their place in the crew's order. */
const crewColour = (index: number): string => CREW_COLOURS[index % CREW_COLOURS.length]!;

const exposedTo = (state: State, crew: string): string[] => state.npcs.filter(n => n.exposedTo.includes(crew)).map(n => n.id);

export function crewCards(world: ReadonlyWorld, state: State, selected: string | null): CrewVM[] {
    return state.crew.map((c, i) => ({
        id: c.id,
        name: c.name,
        colour: crewColour(i),
        actionsLeft: c.actionsLeft,
        actionsMax: world.rules.actionsPerTurn,
        profile: 'unknown',
        exposedTo: exposedTo(state, c.id),
        hp: null,
        selected: c.id === selected
    }));
}

/** What the Session knows beyond the state that the HUD shows. */
export interface HudExtras {
    undoEnabled?: boolean;
    overlays?: Partial<Record<OverlayId, boolean>>;
}

export function hudView(world: ReadonlyWorld, state: State, ui: UiState, extras: HudExtras = {}): HudViewModel {
    return {
        turn: state.turn,
        bank: bankView(state),
        crew: crewCards(world, state, ui.selected),
        selected: ui.selected,
        // TODO(actions package): the selected crew member's actions and what Confirm commits to.
        actions: [],
        confirm: { kind: 'clean', label: '', cost: 0, enabled: false },
        undoEnabled: extras.undoEnabled ?? false,
        ledger: threatLedger(state),
        overlays: Object.fromEntries(OVERLAY_IDS.map(id => [id, extras.overlays?.[id] ?? false])) as Record<OverlayId, boolean>
    };
}

// ------------------------------------------------------------------------------------------------------------ Recap

/** How many events the recap card shows (§20.6). */
export const RECAP_EVENTS = 3;

/**
 * The turn each event happened in, worked out backwards from the current turn: a `phaseStarted` names its turn, and the
 * events before a crew phase's start belong to the previous turn's world phase.
 */
function eventTurns(state: State, events: readonly SimEvent[]): number[] {
    const turns = new Array<number>(events.length);
    let turn = state.turn;
    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i]!;
        if (event.type === 'phaseStarted') {
            turns[i] = event.turn;
            turn = event.phase === 'crew' ? event.turn - 1 : event.turn;
        } else turns[i] = turn;
    }
    return turns;
}

/** The resume recap card (§20.6). */
export function recapView(world: ReadonlyWorld, state: State, recent: readonly SimEvent[]): RecapVM {
    const turns = eventTurns(state, recent), from = Math.max(0, recent.length - RECAP_EVENTS);
    const events: RecapEventVM[] = recent.slice(from).map((event, i) => ({ turn: turns[from + i]!, text: describeEvent(world, state, event) }));
    return {
        turn: state.turn,
        bank: bankView(state),
        events,
        crew: state.crew.map((c, i) => ({
            id: c.id, name: c.name, colour: crewColour(i),
            status: c.actionsLeft > 0 ? 'ready' : 'done',
            actionsLeft: c.actionsLeft,
            exposed: exposedTo(state, c.id).length > 0,
            hp: null
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
