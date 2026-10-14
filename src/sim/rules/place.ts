import type { CrewState, DeepReadonly, NpcState, Pos, State } from '../core/types';

/*
 * Where people are, with a body being dragged (rules/actions/body.ts) where its dragger is: `NpcState.pos` of a dragged
 * NPC is the tile it was lifted from, set again only when it is dropped, stashed or comes round. Kept apart from the
 * actions so perception, knowledge and evidence can read it without importing them.
 */

/** Who drags this NPC's body, if anyone. */
export const draggedBy = (state: DeepReadonly<State>, npc: string): DeepReadonly<CrewState> | undefined => state.crew.find(c => c.dragging === npc);

/** Where an NPC's body is: with whoever drags it, else where it is. */
export function bodyPos(state: DeepReadonly<State>, npc: DeepReadonly<NpcState>): Pos {
    const at = draggedBy(state, npc.id)?.pos ?? npc.pos;
    return { x: at.x, y: at.y };
}

/**
 * The state with a crew member on another tile, and so the body they drag with them (an overlay asking about a tile):
 * a shallow copy, the crew member's record new. The one way overlays put a crew member somewhere else.
 */
export function placeCrew(state: State, crewId: string, tile: Pos): State {
    return { ...state, crew: state.crew.map(c => (c.id === crewId ? { ...c, pos: { x: tile.x, y: tile.y } } : c)) };
}

/**
 * The state with the NPCs being dragged taken off the floor (a shallow copy): their own `pos` is stale, so who stands
 * where (`occupancy`, walks, a move's bump) is worked out on this. The same state when nobody drags anyone.
 */
export function onFloor(state: State): State {
    if (!state.crew.some(c => c.dragging !== null)) return state;
    const dragged = new Set(state.crew.map(c => c.dragging));
    return { ...state, npcs: state.npcs.filter(n => !dragged.has(n.id)) };
}
