import type { ActionVM, CommitKind, CrewVM, HudIcon, HudViewModel, ScheduleVM, ThreatKind, ThreatVM } from './viewModels';
import { MAX_ACTIONS } from './viewModels';

/** Each threat kind's icon in the ledger (UI.md "Over heads": bell, radio, runner, phone). Unknown kinds get the bell. */
const THREAT_ICONS: Partial<Record<ThreatKind, HudIcon>> = {
    tellerButton: 'bell', managerButton: 'bell', guardRadio: 'radio', operatorCamera: 'eye', phoneCall: 'phone', escapee: 'run',
    missedCheckIn: 'radio', seismicSensor: 'drill', motionSensor: 'eye', patrolCar: 'police',
    reinforcement: 'police', drill: 'drill', lapse: 'command', schedule: 'fork'
};

export function threatIcon(kind: ThreatKind): HudIcon {
    return THREAT_ICONS[kind] ?? 'bell';
}

/** Kinds that are not alarm carriers: everything else in the ledger raises the Alarm when it runs out (§9.1). */
const NOT_CARRIERS: ReadonlySet<ThreatKind> = new Set(['reinforcement', 'drill', 'lapse', 'schedule']);

/** Whether a threat raises the Alarm or brings the police: every carrier (a missed check-in too), and reinforcements. */
export function isAlarming(t: Pick<ThreatVM, 'kind'>): boolean {
    return !NOT_CARRIERS.has(t.kind) || t.kind === 'reinforcement';
}

/** How many alarm carriers are running (the count on the ledger button). */
export function liveCarriers(ledger: readonly ThreatVM[]): number {
    return ledger.filter(t => !NOT_CARRIERS.has(t.kind) && !t.halted).length;
}

/**
 * A ledger row's tone, carried by colour and by the countdown box's shape (UI.md principle 3): `red` (solid, doubled)
 * for what raises the Alarm, `amber` (dashed) for a drill or a lapsing command, `neutral` (thin) for the rest, `paused`
 * (dotted) for a halted carrier.
 */
export function threatTone(t: ThreatVM): 'red' | 'amber' | 'neutral' | 'paused' {
    return t.halted ? 'paused' : isAlarming(t) ? 'red' : t.kind === 'lapse' || t.kind === 'drill' ? 'amber' : 'neutral';
}

export const TONE_WORDS = { red: 'raises the alarm', amber: 'warning', neutral: '', paused: 'paused' } as const;

export interface StatePill {
    tone: 'quiet' | 'alarm' | 'loud' | 'go' | 'clock';
    icon: HudIcon;
    /** The word or the countdown it shows. */
    text: string;
    /** For screen readers: the Session's label. */
    label: string;
}

/**
 * The state pill (UI.md "Top strip"): GO in gold; ALARM and LOUD in red; while Quiet with a carrier running, a bell and
 * the most urgent countdown; otherwise the Session's label.
 */
export function statePill(vm: Pick<HudViewModel, 'bank'>): StatePill {
    const b = vm.bank;
    if (b.status === 'alarm') return { tone: 'alarm', icon: 'bell', text: b.label, label: b.label };
    if (b.nextAlarmIn !== null) return { tone: 'clock', icon: 'bell', text: String(b.nextAlarmIn), label: b.label };
    if (b.go) return { tone: 'go', icon: 'mask', text: 'GO', label: b.label };
    if (b.status === 'loud') return { tone: 'loud', icon: 'ear', text: b.label, label: b.label };
    return { tone: 'quiet', icon: 'eye', text: b.label, label: b.label };
}

/** Where a turn sits on the schedule's track, 0–100 (%), from turn 1 at the left to closing at the right. */
export function trackPercent(schedule: Pick<ScheduleVM, 'end'>, turn: number): number {
    const span = Math.max(1, schedule.end - 1);
    return Math.min(100, Math.max(0, ((turn - 1) / span) * 100));
}

/** The crew who still have actions left (and can act), for End turn's prompt. */
export function crewWithActionsLeft(crew: readonly CrewVM[]): CrewVM[] {
    return crew.filter(c => c.actionsLeft > 0 && (c.hp === null || c.hp.now > 0));
}

/** The actions the grid shows: at most `MAX_ACTIONS`, the selected one always among them. */
export function shownActions(actions: readonly ActionVM[]): ActionVM[] {
    if (actions.length <= MAX_ACTIONS) return [...actions];
    const shown = actions.slice(0, MAX_ACTIONS), selected = actions.find(a => a.selected);
    if (selected && !shown.includes(selected)) shown[MAX_ACTIONS - 1] = selected;
    return shown;
}

/** Confirm's glyph and spoken kind, so its colour is never the only cue (UI.md principle 3). */
export const COMMIT_CUES: Record<CommitKind, { icon: HudIcon; words: string }> = {
    clean: { icon: 'confirm', words: 'clean' },
    costly: { icon: 'eye', words: 'costs: someone notices' },
    lethal: { icon: 'skull', words: 'lethal' },
    command: { icon: 'command', words: 'command' }
};

/** Confirm's label size: long names shrink, and the longest wrap to two lines, so a name is never cut. */
export function labelFit(label: string): 'normal' | 'small' | 'wrap' {
    return label.length <= 9 ? 'normal' : label.length <= 13 ? 'small' : 'wrap';
}
