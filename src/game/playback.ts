import type { EventType, SimEvent, State } from '../sim';

/*
 * The world phase on screen (§20.5): the events of a commit or an end of turn wait here for the scene to animate them,
 * at 1×, 2× or instantly. The camera visits only the important ones; which those are is decided per event type by a
 * classifier the package that defines the event registers, so this file never needs to know a rule.
 */

/** Why the camera should visit an event (§20.5). */
export type ImportantReason = 'suspicion' | 'carrier' | 'arrival' | 'shotAtCrew' | 'escape' | 'twitchy' | 'surprise';

/** Decides whether one event of a type is important; null when it isn't. `state` is the state after the events. */
export type ImportanceRule<E extends SimEvent = SimEvent> = (event: E, state: State) => ImportantReason | null;

const RULES = new Map<string, ImportanceRule>();

/**
 * Registers what makes events of a type important: a fixed reason, or a rule that looks at the event (a suspicion
 * event is important only when it lands on crew, an NPC's intent only when it is Twitchy). Registering a type again
 * replaces its rule. Unregistered types are never important.
 */
export function registerImportance<K extends EventType>(type: K, rule: ImportantReason | ImportanceRule<Extract<SimEvent, { type: K }>>): void {
    RULES.set(type, typeof rule === 'string' ? () => rule : (rule as ImportanceRule));
}

/** Why the camera should visit `event`, or null. */
export function importance(event: SimEvent, state: State): ImportantReason | null {
    return RULES.get(event.type)?.(event, state) ?? null;
}

// A carrier starting or advancing is always worth a look; the Alarm going off is that carrier's last advance.
registerImportance('carrierStarted', 'carrier');
registerImportance('carrierTicked', 'carrier');
registerImportance('alarmRaised', 'carrier');
// A crew move cut short by someone it didn't know was there (§8.15): the camera looks at who stopped and why.
registerImportance('moveCut', 'surprise');

export type PlaybackSpeed = '1x' | '2x' | 'instant';

/** How long an animation takes at each speed, as a factor of its 1× duration. */
export const SPEED_FACTOR: Readonly<Record<PlaybackSpeed, number>> = { '1x': 1, '2x': 0.5, instant: 0 };

export interface PlaybackItem {
    /** Increases with every event queued, across batches. */
    seq: number;
    event: SimEvent;
    /** Why the camera should visit it, or null for the log and edge-of-screen arrows only. */
    important: ImportantReason | null;
    /** The turn the event happened in: a world phase's events belong to the turn that ended, until the next begins. */
    turn: number;
}

export class PlaybackQueue {
    private items: PlaybackItem[] = [];
    private seq = 0;
    speed: PlaybackSpeed = '1x';

    /**
     * Queues the events of one commit, classified against the state they left. `turn` is the turn the commit was given
     * in; a crew phase starting moves the events after it into its turn.
     */
    push(events: readonly SimEvent[], state: State, turn = state.turn): PlaybackItem[] {
        const added = events.map(event => {
            if (event.type === 'phaseStarted' && event.phase === 'crew') turn = event.turn;
            return { seq: this.seq++, event, important: importance(event, state), turn };
        });
        this.items.push(...added);
        return added;
    }

    /** Drops the items with these sequence numbers (an undone commit's), leaving the rest queued. */
    remove(seqs: readonly number[]): void {
        const drop = new Set(seqs);
        this.items = this.items.filter(i => !drop.has(i.seq));
    }

    /** The next event to animate, removed from the queue. */
    next(): PlaybackItem | undefined {
        return this.items.shift();
    }

    peek(): PlaybackItem | undefined {
        return this.items[0];
    }

    /** Everything still waiting, without taking it. */
    pending(): PlaybackItem[] {
        return [...this.items];
    }

    /** Takes everything at once (skip, or the instant speed). */
    drain(): PlaybackItem[] {
        return this.items.splice(0);
    }

    clear(): void {
        this.items = [];
    }

    get length(): number {
        return this.items.length;
    }

    /** Whether anything waiting wants the camera. */
    get hasImportant(): boolean {
        return this.items.some(i => i.important);
    }

    /** An animation's duration in ms at the current speed. */
    duration(ms: number): number {
        return ms * SPEED_FACTOR[this.speed];
    }
}
