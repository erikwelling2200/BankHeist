import { registerWorldHook, type Ctx, type WorldPhase } from '../core/engine';
import { edgeBetween, edgeKey, samePos, tileAt } from '../core/grid';
import { registerStateCheck } from '../core/save';
import { actorRefusal, crewMember, registerNpcInit, registerRuleDefaults, registerStateInit } from '../core/state';
import type { CrewState, DeepReadonly, NpcState, Pos, ReadonlyWorld, State, WorldObject } from '../core/types';
import { registerEvents } from '../core/undo';
import { soundEdgeCost } from '../geo/sound';
import { doorStatus } from '../geo/move';
import type { CodePart } from '../../gen/model';
import { inReach, lacksActions, registerAction } from './actions/act';
import { registerInteraction } from './actions/interact';
import { hasTrait } from './alarms';
import { isEyesDown } from './suspicion';
import { crewPicture, isKnownNow, knownAsNow, registerPreviewSecret } from './knowledge';
import { activityAt } from './npc/schedule';
import { isPresent } from './npc/walk';

/*
 * Opportunities as mechanics (§17.6; implementation plan M5-02, decisions 380–388). The generator rolls 3–5 per bank
 * (`GeneratedBank.opportunities`); `worldFromBank` makes each an `OpportunityDef` with how it is found and what it
 * wires in. What the crew has found is `State.opportunitiesFound` (in order), the Intel journal's content (src/game/views.ts
 * `journalView`); nothing else of an opportunity reaches the player until it is found.
 *
 * **Finding one** (`opportunityFound`, a preview secret that blocks undo):
 * - **Eavesdropping** (`speakers`, decision 382): NPCs the crew sees or predicts talk in **conversations**: a calm NPC on
 *   its feet with another the crew knows of within `rules.eavesdropRange` (2) steps, or at its own desk phone (nobody
 *   unseen talks or makes another talk, so chatter never tells of them). Talk carries only through open air and open
 *   doors (`earshot`: no wall, no glass, no shut door; sound, not sight). A crew member in earshot of a talker at the
 *   end of one world phase, as the next begins and as it ends (a whole turn), overhears the conversation: always some
 *   chatter (`overheard`), whoever talks, and with `rules.overhearChance` (½, rolled for every conversation overheard
 *   whatever it is about, as the next crew phase begins after every other rule: decision 49) the first unfound
 *   opportunity the talker knows. So a turn of small talk tells nothing for certain about what is still to find.
 * - **Documents** (`document`): `interact … read` at a `document` object (every stack of papers on the staff side, the
 *   note among them; the papers on the manager's desk; the records room's files; 1 action, no illegal act: being there is what the zones judge). Every
 *   document can be read, whether or not it tells anything, and reading is always final (`documentRead`), so neither
 *   the offer nor an undo tells whether it held anything (decision 381).
 * - **Intel** (§17.4): the deposit box that holds the bank's intel (rules/vault.ts `findIntel`) tells every
 *   opportunity found by intel, and those with no other way to be found in this bank (`learnIntel`).
 *
 * **What they wire in:**
 * - The keycard in the drawer (rules/actions/keycards.ts): it can be taken only once `keycard-drawer` is found (the
 *   crew doesn't know to look); the card object exists in every bank with a manager's desk, so its refusals are alike.
 * - The propped fire door (`smoke-break`): when the operator, calm, reaches his smoke spot outside the back door, he
 *   wedges it open, once a break (`DoorState.propped`, `proppedBy`, `wedgedOn`); it stays open while he is out, even if
 *   he never comes back, and he pulls the wedge as his walk takes him back in through it (`crossedIn`, whatever his
 *   state), or after his break when he passes by it on the inside. A door an NPC propped can be unpropped unseen, so it stays doubtful
 *   (knowledge.ts `isDoubted`).
 * - The bribe (`bribe { crew, npc }`, 1 action, in reach, a Smooth Talker, §7.2; decision 386): once `bribe` is found,
 *   the teller in debt, calm and about, takes it and stays off the alarm (`NpcState.bribed`: she watches instead of
 *   reacting, reporting or phoning on a lapse, npc/behaviour.ts). Cash changing hands is the illegal act 'pickPocket',
 *   seen by whoever watches. Any other NPC, or her before the bribe is found, refuses alike.
 * - The IT tech's card (rules/alarms.ts `serviceCard`): the visiting technician's access card (`it-tech`'s `npc`) logs
 *   into the alarm panel, no hacking kit needed, at once, once the crew knows of his visit (so holding the card of a
 *   technician tells nothing about whether one visits).
 * - The vault code note (`sticky-note`, `part`, `window`): reading it gives the crew the part of the code it holds
 *   (`State.codesKnown`), or under Three Keys the time-lock window, as the manager's PC does (`noteRead`).
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
    /**
     * The smoke break: the door the operator props. `npc`: who it turns on (the operator, the teller in debt, the
     * manager, the visiting technician, the cash run's teller).
     */
    door?: string;
    npc?: string;
    /** The vault code note: the part of the code it holds, or the time-lock window (Three Keys). */
    part?: CodePart;
    window?: { from: number; until: number };
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
        /** Who was in earshot of whom as the last world phase ended, as `crew|talker` keys, sorted (decision 382). */
        earshot: string[];
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
        /** How near a talker a crew member overhears them, and how near two NPCs talk (§17.6: 2 tiles). */
        eavesdropRange: number;
        /** The chance a conversation overheard for a turn is about something the talker knows (decision 382). */
        overhearChance: number;
    }
    interface DoorState {
        /** The turn of the smoke break on which the operator wedged it (he wedges it once a break). */
        wedgedOn?: number;
    }
    interface CommandMap {
        /** Bribe the NPC `npc` in reach (1 action, a Smooth Talker, §7.2, §17.6). */
        bribe: { crew: string; npc: string };
    }
    interface EventMap {
        /** The crew found an opportunity (§17.6). A preview never shows it. */
        opportunityFound: { opportunity: string; crew: string | null; how: FoundHow };
        /** A crew member overheard a conversation for a turn (whatever it was about). */
        overheard: { crew: string };
        /** A crew member read a document (whatever it told). */
        documentRead: { crew: string; object: string };
        /** The vault code note told the crew its part of the code, or the time-lock window. A preview never shows it. */
        noteRead: { crew: string; object: string; part: CodePart | null; window: { from: number; until: number } | null };
        /** An NPC took a crew member's bribe. */
        bribed: { crew: string; npc: string };
        /** An NPC wedged a door open. */
        doorPropped: { door: string; by: string };
    }
}

registerRuleDefaults({ eavesdropRange: 2, overhearChance: 0.5 });

registerStateInit('opportunities', (_world, state) => {
    state.opportunitiesFound = [];
    state.earshot = [];
});

registerNpcInit('opportunities', (_world, _person, npc) => {
    npc.bribed = false;
});

registerStateCheck('opportunitiesFound', state => (Array.isArray(state.opportunitiesFound) && Array.isArray(state.earshot) ? undefined : 'no opportunities found (a save from before M5-02)'));

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

/** An NPC talks while calm and on its feet, not under the crew's control. */
const canTalk = (npc: DeepReadonly<NpcState>): boolean => npc.status === 'calm' && isPresent(npc) && !isEyesDown(npc);

/**
 * The tiles talk at `from` reaches (see the header): within `rules.eavesdropRange` steps (a diagonal one where either
 * way round the corner is open), through open air and open doors only: an edge sound crosses for free, not glass.
 */
function earshot(world: ReadonlyWorld, state: State, from: Pos): Set<string> {
    const key = (p: Pos) => `${p.x},${p.y}`;
    const open = (a: Pos, b: Pos): boolean => {
        if (!tileAt(world, b)) return false;
        const edge = edgeKey(edgeBetween(a, b)), built = world.edges[edge];
        const changed = Object.hasOwn(state.edges, edge) ? state.edges[edge] : undefined;
        if (built && !built.door && (changed?.material ?? built.material) === 'glass' && !changed?.shattered) return false;
        return soundEdgeCost(world, state, edge) === 0;
    };
    const seen = new Set([key(from)]);
    let ring: Pos[] = [from];
    for (let step = 0; step < world.rules.eavesdropRange; step++) {
        const next: Pos[] = [];
        for (const p of ring) {
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
                const q = { x: p.x + dx, y: p.y + dy };
                if (seen.has(key(q))) continue;
                const reaches = dx && dy
                    ? [{ x: q.x, y: p.y }, { x: p.x, y: q.y }].some(c => open(p, c) && open(c, q))
                    : open(p, q);
                if (!reaches) continue;
                seen.add(key(q));
                next.push(q);
            }
        }
        ring = next;
    }
    return seen;
}

/**
 * Who is talking now, as far as the crew can tell: NPCs it sees or predicts in a conversation with another it sees or
 * predicts in earshot, or at their own desk phone. Someone the crew doesn't know of neither talks nor makes another
 * talk, so whether chatter is heard never tells of an unseen NPC.
 */
function talkers(world: ReadonlyWorld, state: State): Map<string, Set<string>> {
    // Judged on sight as things stand (`knownAsNow`), not on the stored knowledge, which is a world phase behind at its end.
    const out = new Map<string, Set<string>>(), able = state.npcs.filter(n => canTalk(n) && knownAsNow(world, state, n));
    const ears = new Map(able.map(n => [n.id, earshot(world, state, n.pos)]));
    for (const n of able) {
        const ear = ears.get(n.id)!;
        const partner = able.some(m => m.id !== n.id && ear.has(`${m.pos.x},${m.pos.y}`));
        const onPhone = world.objects.some(o => o.kind === 'deskPhone' && o.owner === n.id && inReach(world, state, n.pos, o.pos));
        if (partner || onPhone) out.set(n.id, ear);
    }
    return out;
}

/** Who is in earshot of whom now, as `crew|talker` keys. */
function inEarshot(world: ReadonlyWorld, state: State): Set<string> {
    const out = new Set<string>();
    for (const [talker, ear] of talkers(world, state)) {
        for (const c of state.crew) if (!actorRefusal(c) && ear.has(`${c.pos.x},${c.pos.y}`)) out.add(`${c.id}|${talker}`);
    }
    return out;
}

/** Who was in earshot as each world phase began (per command: dropped with it). */
const EARSHOT = new WeakMap<Ctx, Set<string>>();

/** Where each NPC stood as the world phase began (per command), for the operator's walk back in. */
const STARTS = new WeakMap<Ctx, Map<string, Pos>>();

registerWorldHook('fuses', 'opportunities.listen', ctx => {
    EARSHOT.set(ctx, inEarshot(ctx.world, ctx.state));
    STARTS.set(ctx, new Map(ctx.state.npcs.map(n => [n.id, { x: n.pos.x, y: n.pos.y }])));
}, { order: -100 });

// As the next crew phase begins, after every other rule (its roll is the world phase's last word, decision 49, so a
// preview of the world phase runs whole up to it): in earshot of the same talker since the last world phase ended, as
// this one began and as it ends. Every conversation overheard rolls, whatever it is about.
registerWorldHook('crewPhase', 'opportunities.overhear', ctx => {
    const { world, state } = ctx;
    const before = EARSHOT.get(ctx) ?? new Set<string>(), last = new Set(state.earshot);
    EARSHOT.delete(ctx);
    const now = inEarshot(world, state);
    state.earshot = [...now].sort();
    const heard = [...now].filter(k => before.has(k) && last.has(k)).sort();
    const told = new Set<string>();
    for (const k of heard) {
        const [crew, talker] = k.split('|') as [string, string];
        if (!told.has(crew)) {
            told.add(crew);
            ctx.emit({ type: 'overheard', crew });
        }
        const topic = ctx.dice.odds('talk', world.rules.overhearChance, `talk ${talker}`);
        const o = topic ? opportunitiesOf(world).find(x => x.speakers?.includes(talker) && !opportunityFound(state, x.id)) : undefined;
        if (o) learn(ctx, o, crew, 'overheard');
    }
}, { order: 1000 });

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
                // The vault code note (§17.6): the part of the code written on it, or the time-lock window.
                if (o.part && !ctx.state.codesKnown.includes(o.part)) ctx.state.codesKnown = [...ctx.state.codesKnown, o.part].sort();
                if (o.part || o.window) {
                    ctx.emit({ type: 'noteRead', crew: member.id, object: object.id, part: o.part ?? null, window: o.window ? { from: o.window.from, until: o.window.until } : null });
                }
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
    // Cash changing hands, as a pickpocket's (decision 386): anyone who sees it Exposes the crew member; she, bribed by
    // then, only watches.
    illegal: (_world, state, cmd) => ({ act: 'pickPocket', tiles: [crewMember(state, cmd.crew).pos, state.npcs.find(n => n.id === cmd.npc)!.pos].map(p => ({ x: p.x, y: p.y })) }),
    run(ctx, member, cmd) {
        ctx.state.npcs.find(n => n.id === cmd.npc)!.bribed = true;
        ctx.emit({ type: 'bribed', crew: member.id, npc: cmd.npc });
    }
});

// ---------------------------------------------------------------------------------------------------------- The fire door

// The operator wedges the back door open on his smoke break and pulls the wedge as he goes back in (see the header).
// Before the doors swing shut.
/** On its feet and awake (not down, held or gone). */
const awake = (npc: DeepReadonly<NpcState>): boolean => isPresent(npc) && !isEyesDown(npc) && npc.status !== 'unconscious' && npc.status !== 'dead';

/** Whether `p` is inside, within a tile of the door's inside tile. */
function besideInside(world: ReadonlyWorld, p: Pos, o: DeepReadonly<OpportunityDef>): boolean {
    const def = world.doors[o.door!], edge = def ? world.edges[def.edge] : undefined;
    if (!edge || onSide(world, p, o)) return false;
    const a = edge.run === 'eastWest' ? { x: edge.tx, y: edge.ty - 1 } : { x: edge.tx - 1, y: edge.ty }, b = { x: edge.tx, y: edge.ty };
    const inside = onSide(world, a, o) ? b : a;
    return Math.max(Math.abs(p.x - inside.x), Math.abs(p.y - inside.y)) <= 1;
}

/** Whether `p` is on the smoke spot's side of the door (the spot's room). */
const onSide = (world: ReadonlyWorld, p: Pos, o: DeepReadonly<OpportunityDef>): boolean => !!o.at && tileAt(world, p)?.room === tileAt(world, o.at)?.room;

/** Whether the NPC's walk this world phase took it in through the propped door: from its outside tile to the inside one. */
function crossedIn(ctx: Ctx, phase: WorldPhase, npc: DeepReadonly<NpcState>, o: DeepReadonly<OpportunityDef>): boolean {
    const { world } = ctx, from = STARTS.get(ctx)?.get(npc.id);
    const def = world.doors[o.door!], edge = def ? world.edges[def.edge] : undefined;
    if (!edge || !o.at) return false;
    const a = edge.run === 'eastWest' ? { x: edge.tx, y: edge.ty - 1 } : { x: edge.tx - 1, y: edge.ty }, b = { x: edge.tx, y: edge.ty };
    const [outside, inside] = onSide(world, a, o) ? [a, b] : [b, a];
    const path = [...(from ? [from] : []), ...(phase.intents[npc.id]?.path ?? [])];
    const reached = path.findIndex(p => samePos(p, npc.pos));
    return path.some((p, i) => i > 0 && i <= reached && samePos(p, inside) && samePos(path[i - 1]!, outside));
}

registerWorldHook('devices', 'opportunities.fireDoor', (ctx, phase) => {
    const { world, state } = ctx;
    for (const o of opportunitiesOf(world)) {
        if (o.door === undefined || o.npc === undefined || !Object.hasOwn(world.doors, o.door)) continue;
        const npc = state.npcs.find(n => n.id === o.npc);
        if (!npc) continue;
        const door = { ...state.doors[o.door], status: doorStatus(world, state, o.door) };
        if (door.status === 'breached' || door.status === 'jammed') continue;
        const block = activityAt(world, npc.id, state.turn)?.block, calm = npc.status === 'calm' && isPresent(npc);
        const out = block?.activity === 'smokeBreak' && !!block.at && samePos(npc.pos, block.at);
        // Once a break: a door the crew shut again stays shut.
        if (calm && out && !door.propped && door.wedgedOn !== block!.from) {
            state.doors[o.door] = { ...door, status: 'open', propped: true, proppedBy: npc.id, wedgedOn: block!.from };
            ctx.emit({ type: 'doorPropped', door: o.door, by: npc.id });
        } else if (door.proppedBy === npc.id && (crossedIn(ctx, phase, npc, o) || (awake(npc) && block?.activity !== 'smokeBreak' && besideInside(world, npc.pos, o)))) {
            // He pulls the wedge as he walks back in through it, whatever his state; back inside some other way, only
            // once his break is over and he passes by it on the inside. Down outside, or elsewhere, he never does.
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
    doorPropped: { undoBlocking: true },
    overheard: { undoBlocking: true },
    noteRead: { undoBlocking: true }
});
registerPreviewSecret('noteRead');
registerPreviewSecret('overheard');

/** The crew member's bribe offer, for the grid: when the crew knows who takes one and sees her in reach now. */
export function bribeFor(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>): { type: 'bribe'; crew: string; npc: string } | undefined {
    const id = bribeTaker(world, state);
    if (!id || !hasTrait(member, 'smoothTalker') || !isKnownNow(world, state, id)) return undefined;
    const npc = crewPicture(world, state).npcs.find(n => n.id === id);
    return npc && isPresent(npc) && inReach(world, state, member.pos, npc.pos) ? { type: 'bribe', crew: member.id, npc: id } : undefined;
}
