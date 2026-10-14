import type { CrewVM, HudIcon, HudViewModel, ScheduleVM, ThreatKind, ThreatVM } from './viewModels';

/** Clocks that raise the Alarm or bring the police; the ledger button counts them and the state pill shows the first. */
const ALARMING: ReadonlySet<ThreatKind> = new Set(['carrier', 'escape', 'reinforcement']);

/** The ledger, most urgent first: the soonest clock, alarm carriers before other clocks on the same turn, then by id. */
export function sortLedger(ledger: readonly ThreatVM[]): ThreatVM[] {
    return [...ledger].sort((a, b) => a.countdown - b.countdown || Number(ALARMING.has(b.kind)) - Number(ALARMING.has(a.kind)) || a.id.localeCompare(b.id));
}

/** How many live alarm carriers there are (the count on the ledger button). */
export function liveCarriers(ledger: readonly ThreatVM[]): number {
    return ledger.filter(t => t.kind === 'carrier' || t.kind === 'escape').length;
}

/** A ledger row's colour: red for what raises the Alarm, amber for a command lapsing, neutral for the rest. */
export function threatTone(t: ThreatVM): 'red' | 'amber' | 'neutral' {
    return ALARMING.has(t.kind) ? 'red' : t.kind === 'lapse' || t.kind === 'drill' ? 'amber' : 'neutral';
}

export interface StatePill {
    tone: 'quiet' | 'alarm' | 'loud';
    icon: HudIcon;
    /** The word or the countdown it shows. */
    text: string;
    /** For screen readers. */
    label: string;
}

/**
 * The state pill (UI.md "Top strip"): QUIET; or, while a carrier runs, its icon and countdown (the most urgent clock);
 * ALARM with the police ETA; LOUD.
 */
export function statePill(vm: Pick<HudViewModel, 'bank' | 'ledger'>): StatePill {
    if (vm.bank.status === 'alarm') {
        // The strip beside it counts the turns until the police arrive.
        const eta = vm.bank.policeEta;
        return { tone: 'alarm', icon: 'bell', text: 'ALARM', label: eta === null ? 'Alarm' : eta > 0 ? `Alarm: police in ${eta}` : 'Alarm: police on site' };
    }
    const urgent = sortLedger(vm.ledger.filter(t => t.kind === 'carrier' || t.kind === 'escape'))[0];
    if (urgent) return { tone: 'alarm', icon: urgent.icon, text: String(urgent.countdown), label: `${urgent.label} in ${urgent.countdown}` };
    if (vm.bank.status === 'loud') return { tone: 'loud', icon: 'ear', text: 'LOUD', label: 'Loud' };
    return { tone: 'quiet', icon: 'eye', text: 'QUIET', label: 'Quiet' };
}

/** Where a turn sits on the schedule's track, 0–100 (%), from turn 1 at the left to closing at the right. */
export function trackPercent(schedule: Pick<ScheduleVM, 'end'>, turn: number): number {
    const span = Math.max(1, schedule.end - 1);
    return Math.min(100, Math.max(0, ((turn - 1) / span) * 100));
}

/** The crew who still have actions left, for End turn's prompt. */
export function crewWithActionsLeft(crew: readonly CrewVM[]): CrewVM[] {
    return crew.filter(c => c.actionsLeft > 0 && c.hp > 0);
}
