import { registerWorldHook, type Ctx } from '../core/engine';
import { samePos } from '../core/grid';
import { registerStateCheck } from '../core/save';
import { actorRefusal, crewMember, registerNpcInit, registerRuleDefaults, registerStateInit } from '../core/state';
import type { CrewState, DeepReadonly, NpcState, Pos, ReadonlyWorld, State, WorldObject } from '../core/types';
import { registerEvents } from '../core/undo';
import { lineOfSight, sightMap } from '../geo/los';
import { doorStatus } from '../geo/move';
import type { CodePart } from '../../gen/model';
import { inReach, lacksActions, registerAction } from './actions/act';
import { registerInteraction } from './actions/interact';
import { hasTrait } from './alarms';
import { registerPreviewSecret } from './knowledge';
import { activityAt } from './npc/schedule';
import { isPresent } from './npc/walk';

/*
 * Opportunities as mechanics (§17.6; implementation plan M5-02, decisions 380–388). The generator rolls 3–5 per bank
 * (`GeneratedBank.opportunities`); `worldFromBank` makes each an `OpportunityDef` with how it is found and what it
 * wires in. What the crew has found is `State.opportunitiesFound` (in order), the Intel journal's content (src/game/views.ts
 * `journalView`); nothing else of an opportunity reaches the player until it is found.
 *
 * **Finding one** (`opportunityFound`, a preview secret that blocks undo):
 * - **Eavesdropping** (`speakers`): a crew member who stands within `rules.eavesdropRange` (2) tiles of a speaker, with
 *   a line of sight between them, both when a world phase begins and when it ends (a whole turn), while the speaker is
 *   calm and about (talking shop: to a colleague, a customer, on the phone), overhears it. Checked in the world phase,
 *   which is final anyway.
 * - **Documents** (`document`): `interact … read` at a `document` object (the note by a monitor, the papers on the
 *   manager's desk, the records room's files; 1 action, no illegal act: being there is what the zones judge). Every
 *   document can be read, whether or not it tells anything, and reading is always final (`documentRead`), so neither
 *   the offer nor an undo tells whether it held anything (decision 381).
 * - **Intel** (§17.4): the deposit box that holds the bank's intel (rules/vault.ts `findIntel`) tells every
 *   opportunity found by intel, and those with no other way to be found in this bank (`learnIntel`).
 *
 * **What they wire in:**
 * - The keycard in the drawer (rules/actions/keycards.ts): it can be taken only once `keycard-drawer` is found (the
 *   crew doesn't know to look); the card object exists in every bank with a manager's desk, so its refusals are alike.
 * - The propped fire door (`smoke-break`): when the operator, calm, reaches his smoke spot outside the back door, he
 *   wedges it open (`DoorState.propped`, `proppedBy`); it stays open while he is out, even if he never comes back, and
 *   he pulls the wedge as he goes back in. A door an NPC propped can be unpropped unseen, so it stays doubtful
 *   (knowledge.ts `isDoubted`).
 * - The bribe (`bribe { crew, npc }`, 1 action, in reach, a Smooth Talker, §7.2): once `bribe` is found, the teller in
 *   debt, calm and about, takes it and stays off the alarm (`NpcState.bribed`: she watches instead of reacting or
 *   reporting, npc/behaviour.ts). Any other NPC, or her before the bribe is found, refuses alike.
 * - The IT tech's card (rules/alarms.ts): the technician's access card logs into the alarm panel, no hacking kit
 *   needed, at once. A property of the card, not of the opportunity, so holding it tells nothing.
 * - The vault code note (`sticky-note`, `part`): reading it gives the crew the part of the code it holds
 *   (`State.codesKnown`), as the manager's PC does.
 */

/** How an opportunity is found (§17.6). */
export type OpportunityWay = 'eavesdropping' | 'documents' | 'intel';

/** An opportunity of the bank (§17.6), from the generator, with what the rules need to find it and wire it in. */
export interface OpportunityDef {
    /** The generator's id: 'keycard-drawer', 'smoke-break', 'bribe', 'it-tech', 'sticky-note', … */
    id: string;
    /** What the journal says once it is found. */
    text: string;
    found: OpportunityWay;
    /** When it happens, and until when, if it is an event of the day. */
    turn?: number;
    until?: number;
    /** Eavesdropping: the people who talk about it. */
    speakers?: string[];
    /** Documents: the document object it is written in. */
    document?: string;
    /** Where it plays out (the journal's Full guidance points the camera there). */
    at?: Pos;
    /** The smoke break: the door the operator props, and the operator. The bribe: who takes it (`npc`). */
    door?: string;
    npc?: string;
    /** The vault code note: the part of the code it holds. */
    part?: CodePart;
}

/** How a crew member found one (the journal's mark). */
export type FoundHow = 'overheard' | 'read' | 'intel';

/** An opportunity the crew has found: which, how, and on which turn. */
export interface FoundOpportunity { id: string; how: FoundHow; turn: number }

declare module '../core/types' {
    interface World {
        /** The bank's opportunities (§17.6). Absent: a world without any (the fixtures). */
        opportunities?: OpportunityDef[];
    }
    interface State {
        /** The opportunities the crew has found, in the order found (the Intel journal). */
        opportunitiesFound: FoundOpportunity[];
    }
    interface NpcState {
        /** Took a bribe (§17.6): stays off the alarm. */
        bribed: boolean;
    }
    interface ObjectState {
        /** A document: read already. */
        read?: boolean;
    }
    interface Rules {
        /** How near a speaker a crew member overhears them (§17.6: 2 tiles). */
        eavesdropRange: number;
    }
    interface CommandMap {
        /** Bribe the NPC `npc` in reach (1 action, a Smooth Talker, §7.2, §17.6). */
        bribe: { crew: string; npc: string };
    }
    interface EventMap {
        /** The crew found an opportunity (§17.6). A preview never shows it. */
        opportunityFound: { opportunity: string; crew: string | null; how: FoundHow };
        /** A crew member read a document (whatever it told). */
        documentRead: { crew: string; object: string };
        /** An NPC took a crew member's bribe. */
        bribed: { crew: string; npc: string };
        /** An NPC wedged a door open. */
        doorPropped: { door: string; by: string };
    }
}

registerRuleDefaults({ eavesdropRange: 2 });

registerStateInit('opportunities', (_world, state) => {
    state.opportunitiesFound = [];
});

registerNpcInit('opportunities', (_world, _person, npc) => {
    npc.bribed = false;
});

registerStateCheck('opportunitiesFound', state => (Array.isArray(state.opportunitiesFound) ? undefined : 'no opportunities found (a save from before M5-02)'));

/** The bank's opportunities. */
export const opportunitiesOf = (world: ReadonlyWorld): readonly DeepReadonly<OpportunityDef>[] => world.opportunities ?? [];

/** Whether the crew has found an opportunity. */
export const opportunityFound = (state: DeepReadonly<State>, id: string): boolean => state.opportunitiesFound.some(o => o.id === id);

/** The crew finds an opportunity (once). */
function learn(ctx: Ctx, opportunity: DeepReadonly<OpportunityDef>, crew: string | null, how: FoundHow): void {
    if (opportunityFound(ctx.state, opportunity.id)) return;
    ctx.state.opportunitiesFound = [...ctx.state.opportunitiesFound, { id: opportunity.id, how, turn: ctx.state.turn }];
    ctx.emit({ type: 'opportunityFound', opportunity: opportunity.id, crew, how });
}

// ---------------------------------------------------------------------------------------------------------- Eavesdropping

/** A speaker talks while calm and about, on their feet (see the header). */
const talking = (npc: DeepReadonly<NpcState>): boolean => npc.status === 'calm' && isPresent(npc);

/** Who could overhear whom now, as `crew|opportunity|speaker` keys. */
function inEarshot(world: ReadonlyWorld, state: State): Set<string> {
    const out = new Set<string>(), range = world.rules.eavesdropRange;
    const open = opportunitiesOf(world).filter(o => o.speakers?.length && !opportunityFound(state, o.id));
    if (!open.length) return out;
    const sight = sightMap(world, state);
    for (const o of open) {
        for (const id of o.speakers!) {
            const npc = state.npcs.find(n => n.id === id);
            if (!npc || !talking(npc)) continue;
            for (const c of state.crew) {
                if (actorRefusal(c) || Math.max(Math.abs(c.pos.x - npc.pos.x), Math.abs(c.pos.y - npc.pos.y)) > range) continue;
                if (lineOfSight(sight, c.pos, npc.pos)) out.add(`${c.id}|${o.id}|${id}`);
            }
        }
    }
    return out;
}

/** Who was in earshot as each world phase began (per command: dropped with it). */
const EARSHOT = new WeakMap<Ctx, Set<string>>();

registerWorldHook('fuses', 'opportunities.listen', ctx => {
    EARSHOT.set(ctx, inEarshot(ctx.world, ctx.state));
}, { order: -100 });

// After everyone has acted and the doors have swung shut: still in earshot of the same speaker, a whole turn on.
registerWorldHook('devices', 'opportunities.overhear', ctx => {
    const before = EARSHOT.get(ctx);
    EARSHOT.delete(ctx);
    if (!before?.size) return;
    const now = inEarshot(ctx.world, ctx.state);
    for (const o of opportunitiesOf(ctx.world)) {
        for (const c of ctx.state.crew) {
            if (o.speakers?.some(s => before.has(`${c.id}|${o.id}|${s}`) && now.has(`${c.id}|${o.id}|${s}`))) {
                learn(ctx, o, c.id, 'overheard');
                break;
            }
        }
    }
}, { order: 900 });

// ---------------------------------------------------------------------------------------------------------- Documents

/** Why a document can't be read now, or undefined. */
export const documentBlocked = (state: DeepReadonly<State>, object: DeepReadonly<WorldObject>): string | undefined =>
    (Object.hasOwn(state.objects, object.id) && state.objects[object.id]!.read ? 'Read already' : undefined);

registerInteraction('document', {
    read: {
        cost: () => 1,
        whyNot: (_world, state, _member, object) => documentBlocked(state, object),
        run(ctx, member, object) {
            ctx.state.objects[object.id] = { ...ctx.state.objects[object.id], read: true };
            ctx.emit({ type: 'documentRead', crew: member.id, object: object.id });
            for (const o of opportunitiesOf(ctx.world)) {
                if (o.document !== object.id) continue;
                learn(ctx, o, member.id, 'read');
                // The vault code note (§17.6): the part of the code written on it.
                if (o.part && !ctx.state.codesKnown.includes(o.part)) ctx.state.codesKnown = [...ctx.state.codesKnown, o.part].sort();
            }
        }
    }
});

// ---------------------------------------------------------------------------------------------------------- Intel

/** Whether an opportunity can be found in this bank other than by intel: someone to overhear, a document to read. */
function foundOtherwise(world: ReadonlyWorld, o: DeepReadonly<OpportunityDef>): boolean {
    if (o.found === 'intel') return false;
    if (o.document !== undefined) return world.objects.some(x => x.id === o.document);
    return !!o.speakers?.some(s => world.people.some(p => p.id === s));
}

/** The bank's intel is found (§17.4, rules/vault.ts): it tells what only intel can. */
export function learnIntel(ctx: Ctx, crew: string | null): void {
    for (const o of opportunitiesOf(ctx.world)) if (!foundOtherwise(ctx.world, o)) learn(ctx, o, crew, 'intel');
}

// ---------------------------------------------------------------------------------------------------------- The bribe

/** Who takes the bribe, once the crew knows (the `bribe` opportunity found), or undefined. */
const bribeTaker = (world: ReadonlyWorld, state: DeepReadonly<State>): string | undefined =>
    (opportunityFound(state, 'bribe') ? opportunitiesOf(world).find(o => o.id === 'bribe')?.npc : undefined);

registerAction('bribe', {
    whyNot(world, state, cmd) {
        const member = crewMember(state, cmd.crew);
        const lack = lacksActions(member, 1);
        if (lack) return lack;
        if (!hasTrait(member, 'smoothTalker')) return `${member.name} isn't a Smooth Talker`;
        const npc = state.npcs.find(n => n.id === cmd.npc);
        if (!npc || !isPresent(npc) || !inReach(world, state, member.pos, npc.pos)) return `${member.name} can't reach them`;
        // The same answer for anyone who isn't the one in debt, and for her before the crew knows (nothing leaks).
        if (bribeTaker(world, state) !== npc.id) return 'They won\'t take a bribe';
        if (npc.bribed) return 'Bribed already';
        return npc.status === 'calm' ? undefined : 'They are in no state to talk money';
    },
    candidates(world, state, member) {
        const npc = bribeTaker(world, state);
        return npc && hasTrait(member, 'smoothTalker') ? [{ type: 'bribe', crew: member.id, npc }] : [];
    },
    cost: () => 1,
    run(ctx, member, cmd) {
        ctx.state.npcs.find(n => n.id === cmd.npc)!.bribed = true;
        ctx.emit({ type: 'bribed', crew: member.id, npc: cmd.npc });
    }
});

// ---------------------------------------------------------------------------------------------------------- The fire door

// The operator wedges the back door open on his smoke break and pulls the wedge as he goes back in (see the header).
// Before the doors swing shut.
registerWorldHook('devices', 'opportunities.fireDoor', ctx => {
    const { world, state } = ctx;
    for (const o of opportunitiesOf(world)) {
        if (o.door === undefined || o.npc === undefined || !Object.hasOwn(world.doors, o.door)) continue;
        const npc = state.npcs.find(n => n.id === o.npc);
        if (!npc) continue;
        const door = { ...state.doors[o.door], status: doorStatus(world, state, o.door) };
        if (door.status === 'breached' || door.status === 'jammed') continue;
        const block = activityAt(world, npc.id, state.turn)?.block, calm = npc.status === 'calm' && isPresent(npc);
        const out = block?.activity === 'smokeBreak' && !!block.at && samePos(npc.pos, block.at);
        if (calm && out && !door.propped) {
            state.doors[o.door] = { ...door, status: 'open', propped: true, proppedBy: npc.id };
            ctx.emit({ type: 'doorPropped', door: o.door, by: npc.id });
        } else if (calm && block?.activity !== 'smokeBreak' && door.proppedBy === npc.id) {
            const next = { ...door };
            delete next.propped;
            delete next.proppedBy;
            state.doors[o.door] = next;
        }
    }
}, { order: 40 });

registerPreviewSecret('opportunityFound');

registerEvents({
    opportunityFound: { undoBlocking: true },
    // Final whatever it told, so an undo doesn't tell whether it told anything.
    documentRead: { undoBlocking: true },
    // It changes the NPC, which no undo takes back (core/engine.ts).
    bribed: { undoBlocking: true },
    doorPropped: { undoBlocking: true }
});

/** The crew member's bribe offer, for the grid: the command when the crew knows who takes one. */
export function bribeFor(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>): { type: 'bribe'; crew: string; npc: string } | undefined {
    const npc = state.npcs.find(n => n.id === bribeTaker(world, state));
    return npc && hasTrait(member, 'smoothTalker') && inReach(world, state, member.pos, npc.pos) ? { type: 'bribe', crew: member.id, npc: npc.id } : undefined;
}
