import { deepFreeze, devChecksOn, sortedIds } from './json';
import type { EventType, State } from './types';

/*
 * Undo (§6.6): free for any action that revealed nothing new, triggered no perception check and rolled no dice;
 * everything else is final, and there is no turn rewind. Each event type says once whether it blocks undo, so a new
 * system decides that where it defines its events and the engine never has to know about it.
 */

export interface EventClass {
    /** Seeing this event means the action told the player something, or the world reacted: it can't be taken back. */
    undoBlocking: boolean;
}

const EVENT_CLASSES = new Map<string, EventClass>();

/**
 * Classifies event types. Every event a reducer emits must be classified, or the engine throws. Classifying a type
 * again the same way is harmless; classifying it differently throws, since two systems disagree about undo.
 */
export function registerEvents(classes: { [K in EventType]?: EventClass }): void {
    for (const type of sortedIds(classes)) {
        const cls = classes[type as EventType]!, known = EVENT_CLASSES.get(type);
        if (known && known.undoBlocking !== cls.undoBlocking) {
            throw new Error(`Event '${type}' is already classified with undoBlocking ${known.undoBlocking}`);
        }
        EVENT_CLASSES.set(type, { undoBlocking: cls.undoBlocking });
    }
}

export function eventClass(type: string): EventClass {
    const cls = EVENT_CLASSES.get(type);
    if (!cls) throw new Error(`Event '${type}' has no undo class: give it one with registerEvents`);
    return cls;
}

/**
 * The states before each undoable action this turn, oldest first. A final action empties it: undo never steps back
 * past something the player has seen happen.
 */
export type UndoStack = readonly State[];

/** The stack after committing an action from `before`. */
export function recordUndo(stack: UndoStack, before: State, undoable: boolean): UndoStack {
    if (!undoable) return [];
    // In development, a snapshot is frozen so a stray write to a state that is meant to be finished shows at once.
    return [...stack, devChecksOn() ? deepFreeze(before) : before];
}

/** Takes back the last undoable action: the state before it, and the stack without it. */
export function popUndo(stack: UndoStack): { state: State; stack: UndoStack } | undefined {
    const state = stack.at(-1);
    return state && { state, stack: stack.slice(0, -1) };
}
