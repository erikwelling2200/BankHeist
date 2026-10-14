import { DASH_ACTIONS, MOVE_ACTIONS, type CarrierKind, type Command, type ReadonlyWorld, type SimEvent, type State } from '../sim';
import {
    CREW_COLOURS, OVERLAY_IDS, type ActionVM, type BankStatus, type CommitKind, type ConfirmVM, type HudIcon, type BankStatusVM, type CrewVM, type HudViewModel, type OverlayId, type RecapEventVM,
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

/** The crew members with a portrait of their own (src/ui/hud/img), by id; the rest show their initial. */
const PORTRAITS: ReadonlySet<string> = new Set(['mara', 'jun', 'dex', 'sol']);
const portraitOf = (id: string): { portrait?: string } => (PORTRAITS.has(id) ? { portrait: id } : {});

const exposedTo = (state: State, crew: string): string[] => state.npcs.filter(n => n.exposedTo.includes(crew)).map(n => n.id);

export function crewCards(world: ReadonlyWorld, state: State, selected: string | null): CrewVM[] {
    return state.crew.map((c, i) => ({
        id: c.id,
        name: c.name,
        colour: crewColour(i),
        ...portraitOf(c.id),
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
    /** The events the pending command's preview would emit (the player's preview), to colour Confirm. */
    previewEvents?: readonly SimEvent[];
    /** Whether the tactical map shows. */
    mapOn?: boolean;
}

/**
 * The entries of M1's action grid (§6.3): movement and Wait. Later packages add theirs. Movement is one entry: a tap
 * picks Move or Dash by how far it goes (src/game/movement.ts), so Dash has no button of its own.
 */
export type ActionId = 'move' | 'wait';

/** How each command the grid can make is named and costed, on its button and on Confirm. */
const COMMANDS: Readonly<Record<string, { label: string; icon: HudIcon; cost: number }>> = {
    move: { label: 'Move', icon: 'move', cost: MOVE_ACTIONS },
    dash: { label: 'Dash', icon: 'dash', cost: DASH_ACTIONS },
    // Wait spends what is left of the turn (§6.3); it costs no pip of its own.
    wait: { label: 'Wait', icon: 'wait', cost: 0 }
};

/** The grid entry a command belongs to: a Dash is movement. */
const entryOf = (cmd: Command | null): ActionId | null =>
    cmd?.type === 'move' || cmd?.type === 'dash' ? 'move' : cmd?.type === 'wait' ? 'wait' : null;

/**
 * The selected crew member's actions: what each costs, whether it can be done now, and which is being previewed.
 * Movement is the default; while a Dash is previewed its entry reads Dash, with Dash's cost.
 */
export function actionsView(state: State, ui: UiState): ActionVM[] {
    const member = state.crew.find(c => c.id === ui.selected);
    if (!member || state.phase !== 'crew') return [];
    const pending = ui.pendingCommand, active = entryOf(pending) ?? 'move';
    return (['move', 'wait'] as const).map(id => {
        const a = COMMANDS[id === 'move' && pending?.type === 'dash' ? 'dash' : id]!;
        const reason = member.actionsLeft === 0 ? 'No actions left' : undefined;
        return { id, label: a.label, icon: a.icon, cost: a.cost, enabled: !reason, ...(reason ? { reason } : {}), selected: id === active };
    });
}

/**
 * Confirm for the pending command: its name and cost (a Dash shows 2 pips), coloured by what it gives away (UI.md
 * "Confirm's colour"): amber when someone hears it, cream otherwise. Dimmed while nothing is previewed.
 */
export function confirmView(ui: UiState, previewEvents: readonly SimEvent[] = []): ConfirmVM {
    const action = entryOf(ui.pendingCommand) && COMMANDS[ui.pendingCommand!.type];
    if (!action) return { kind: 'clean', label: '', cost: 0, enabled: false };
    const kind: CommitKind = previewEvents.some(e => e.type === 'heard') ? 'costly' : 'clean';
    return { kind, label: action.label.toUpperCase(), icon: action.icon, cost: action.cost, enabled: true };
}

export function hudView(world: ReadonlyWorld, state: State, ui: UiState, extras: HudExtras = {}): HudViewModel {
    return {
        turn: state.turn,
        bank: bankView(state),
        crew: crewCards(world, state, ui.selected),
        selected: ui.selected,
        actions: actionsView(state, ui),
        confirm: confirmView(ui, extras.previewEvents),
        undoEnabled: extras.undoEnabled ?? false,
        ledger: threatLedger(state),
        overlays: Object.fromEntries(OVERLAY_IDS.map(id => [id, extras.overlays?.[id] ?? false])) as Record<OverlayId, boolean>,
        mapOn: extras.mapOn ?? false
    };
}

// ------------------------------------------------------------------------------------------------------------ Recap

/** How many events the recap card shows (§20.6). */
export const RECAP_EVENTS = 3;

/** The resume recap card (§20.6). `turns` is the turn each of `recent` happened in, as the Session recorded it. */
export function recapView(world: ReadonlyWorld, state: State, recent: readonly SimEvent[], turns: readonly number[]): RecapVM {
    const from = Math.max(0, recent.length - RECAP_EVENTS);
    const events: RecapEventVM[] = recent.slice(from).map((event, i) => ({ turn: turns[from + i] ?? state.turn, text: describeEvent(world, state, event) }));
    return {
        turn: state.turn,
        bank: bankView(state),
        events,
        crew: state.crew.map((c, i) => ({
            id: c.id, name: c.name, colour: crewColour(i), ...portraitOf(c.id),
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
        case 'moveCut': return event.reason === 'bump'
            ? `${name(event.crew)} ran into ${name(event.npc)} and stopped at (${event.at.x}, ${event.at.y})`
            : `${name(event.crew)} spotted ${name(event.npc)} and stopped at (${event.at.x}, ${event.at.y})`;
        case 'phaseStarted': return event.phase === 'crew' ? `Turn ${event.turn}` : `World phase of turn ${event.turn}`;
        case 'carrierStarted': return `${CARRIER_LABELS[event.kind] ?? event.kind}: alarm in ${event.countdown}`;
        case 'carrierTicked': return `Alarm in ${event.countdown}`;
        case 'alarmRaised': return 'The alarm is raised';
        case 'wentLoud': return `The bank went loud: ${event.cause}`;
        default: return event.type;
    }
}
