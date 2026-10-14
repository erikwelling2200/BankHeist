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

/** Classifies event types. Every event a reducer emits must be classified, or the engine throws. */
export function registerEvents(classes: { [K in EventType]?: EventClass }): void {
    for (const [type, cls] of Object.entries(classes)) if (cls) EVENT_CLASSES.set(type, cls);
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
    return undoable ? [...stack, before] : [];
}

/** Takes back the last undoable action: the state before it, and the stack without it. */
export function popUndo(stack: UndoStack): { state: State; stack: UndoStack } | undefined {
    const state = stack.at(-1);
    return state && { state, stack: stack.slice(0, -1) };
}
