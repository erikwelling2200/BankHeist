import { registerStateCheck } from '../core/save';
import { registerStateInit } from '../core/state';
import type { Pos, State } from '../core/types';

/*
 * The heist's record for the debrief (implementation plan M6-05): its state and the two notes other rules make
 * (perceive.ts a witness, wounds.ts a kill), kept apart from its hooks so those rules can write it without loading
 * them. See rules/record.ts for the rules.
 */

/** What the debrief reads of a heist (see the header). */
export interface HeistRecord {
    /** Who saw which unmasked crew member commit an illegal act, once each. */
    witnesses: { npc: string; crew: string }[];
    /** NPCs who ran off the map: fleeing, panicked, or freed by the police. */
    escapees: string[];
    /** Check-ins missed and dispatch losing contact (§8.11). */
    missed: number;
    /** Whether the alarm panel was dead as the first Heavy crew member stood in the building; null until one has. */
    insideJob: boolean | null;
    /** How the first crew member came into the building: through a door or window, or through a breach; null until then. */
    wayIn: 'door' | 'breach' | null;
    /** Police assaults run to their end while crew were still up on the map. */
    assaultsHeld: number;
    /** Every death a crew member dealt: who, and where they stood. */
    kills: { crew: string; at: Pos }[];
}

declare module '../core/types' {
    interface State {
        /** What the debrief reads (rules/record.ts). */
        record: HeistRecord;
    }
    interface World {
        /** The crew's sniper nests (§14.5): rooms a kill counts from for Overwatch (§19.8). Absent: none. */
        nests?: string[];
    }
}

registerStateInit('record', (_world, state) => {
    state.record = { witnesses: [], escapees: [], missed: 0, insideJob: null, wayIn: null, assaultsHeld: 0, kills: [] };
});

const isPos = (p: unknown): boolean => typeof p === 'object' && p !== null && Number.isInteger((p as Pos).x) && Number.isInteger((p as Pos).y);
const isId = (v: unknown): v is string => typeof v === 'string';

// A save from before M6-05 has no record; one whose entries aren't the rules' would make the debrief throw.
registerStateCheck('record', raw => {
    const r = (raw as { record?: Partial<HeistRecord> }).record;
    if (!r || typeof r !== 'object') return 'no heist record (a save from before M6-05)';
    const ok = Array.isArray(r.witnesses) && r.witnesses.every(w => typeof w === 'object' && w !== null && isId(w.npc) && isId(w.crew))
        && Array.isArray(r.escapees) && r.escapees.every(isId)
        && Number.isInteger(r.missed) && (r.missed as number) >= 0 && Number.isInteger(r.assaultsHeld) && (r.assaultsHeld as number) >= 0
        && (r.insideJob === null || typeof r.insideJob === 'boolean') && (r.wayIn === null || r.wayIn === 'door' || r.wayIn === 'breach')
        && Array.isArray(r.kills) && r.kills.every(k => typeof k === 'object' && k !== null && isId(k.crew) && isPos(k.at));
    return ok ? undefined : 'the heist record is broken';
});

/** An NPC saw a crew member commit an illegal act (perceive.ts): noted when the crew member is unmasked. */
export function noteWitness(state: State, npc: string, crew: string): void {
    const member = state.crew.find(c => c.id === crew);
    if (!member || member.loadout.masked) return;
    if (state.record.witnesses.some(w => w.npc === npc && w.crew === crew)) return;
    state.record.witnesses.push({ npc, crew });
}

/** A crew member dealt a death (rules/wounds.ts `creditKill`), standing at `at` (where they are now, on the map or not). */
export function noteKill(state: State, crew: string, at: Pos): void {
    state.record.kills.push({ crew, at: { x: at.x, y: at.y } });
}

