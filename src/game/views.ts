import { DASH_ACTIONS, MOVE_ACTIONS, type CarrierKind, type Command, type ReadonlyWorld, type SimEvent, type State } from '../sim';
import {
    CREW_COLOURS, OVERLAY_IDS, type ActionVM, type BankStatus, type CommitKind, type ConfirmVM, type HudIcon, type BankStatusVM, type CrewVM, type HudViewModel, MAX_ACTIONS, type OverlayId, type RecapEventVM,
    type RecapVM, type ThreatVM
} from '../ui/hud/viewModels';
import { actionMenu } from './actions';
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
    /** The door, NPC or object the player tapped: the grid's actions on a thing are for it (src/game/actions.ts). */
    target?: string | null;
    /** What a command would cost, from its preview (actions spent), or undefined when the sim refuses it. */
    costOf?: (cmd: Command) => number | undefined;
}

/**
 * An entry of the action grid: 'move' (movement: a tap picks Move or Dash by how far it goes, src/game/movement.ts, so
 * Dash has no button of its own), or one of `actionMenu`'s ids ('door:open', 'knockout', 'drag', 'stash', 'wait', …).
 */
export type ActionId = string;

/** How a command is named on its button and on Confirm, and what it costs when no preview says (Wait: no pip of its own). */
function describeCommand(cmd: Command): { label: string; icon: HudIcon; cost: number } {
    switch (cmd.type) {
        case 'move': return { label: 'Move', icon: 'move', cost: MOVE_ACTIONS };
        case 'dash': return { label: 'Dash', icon: 'dash', cost: DASH_ACTIONS };
        case 'wait': return { label: 'Wait', icon: 'wait', cost: 0 };
        case 'door': return { label: `${cmd.action} door`, icon: cmd.action === 'lock' || cmd.action === 'unlock' ? 'lock' : 'interact', cost: 1 };
        case 'knockout': return { label: 'Knockout', icon: 'knockout', cost: 1 };
        case 'drag': return { label: 'Drag', icon: 'heavy', cost: 1 };
        case 'drop': return { label: 'Drop', icon: 'flip', cost: 1 };
        case 'stash': return { label: 'Stash', icon: 'concealed', cost: 1 };
        case 'interact': return { label: cmd.verb, icon: 'interact', cost: 1 };
        default: return { label: cmd.type, icon: 'interact', cost: 1 };
    }
}

const sameCommand = (a: Command | null, b: Command): boolean => !!a && JSON.stringify(a) === JSON.stringify(b);

/**
 * The selected crew member's actions: movement first, then what `actionMenu` offers where they stand (enabled as the
 * sim allows, with its reason when not), each with its cost from its preview, and which is being previewed. While a
 * Dash is previewed the movement entry reads Dash, with Dash's cost.
 */
export function actionsView(world: ReadonlyWorld, state: State, ui: UiState, extras: Pick<HudExtras, 'target' | 'costOf'> = {}): ActionVM[] {
    const member = state.crew.find(c => c.id === ui.selected);
    if (!member || state.phase !== 'crew') return [];
    const pending = ui.pendingCommand, moving = !pending || pending.type === 'move' || pending.type === 'dash';
    const move = describeCommand(pending?.type === 'dash' ? pending : { type: 'move', crew: member.id, path: [] });
    const stuck = member.actionsLeft === 0 ? 'No actions left' : undefined;
    const out: ActionVM[] = [{ id: 'move', label: move.label, icon: move.icon, cost: move.cost, enabled: !stuck, ...(stuck ? { reason: stuck } : {}), selected: moving }];
    for (const e of actionMenu(world, state, member.id, extras.target)) {
        const cost = e.command.type === 'wait' ? 0 : (!e.reason && extras.costOf?.(e.command)) || describeCommand(e.command).cost;
        out.push({ id: e.id, label: e.label, icon: e.icon, cost, enabled: !e.reason, ...(e.reason ? { reason: e.reason } : {}), selected: sameCommand(pending, e.command) });
    }
    return out.slice(0, MAX_ACTIONS);
}

/** Events in a preview that give the crew away, or are an illegal act seen or not (§8.4): Confirm turns amber. */
const COSTLY_EVENTS: ReadonlySet<string> = new Set(['heard', 'perceptionCheck', 'cameraSaw', 'knockedOut', 'bodyLifted', 'bodyStashed']);

/**
 * Confirm for the pending command: its name and cost (a Dash shows 2 pips), coloured by what it gives away (UI.md
 * "Confirm's colour"): amber when someone hears or sees it, or it is an illegal act; cream otherwise. Dimmed while
 * nothing is previewed.
 */
export function confirmView(ui: UiState, previewEvents: readonly SimEvent[] = [], costOf?: (cmd: Command) => number | undefined): ConfirmVM {
    const cmd = ui.pendingCommand;
    if (!cmd || cmd.type === 'endTurn') return { kind: 'clean', label: '', cost: 0, enabled: false };
    const action = describeCommand(cmd);
    const cost = cmd.type === 'wait' ? 0 : costOf?.(cmd) ?? action.cost;
    const kind: CommitKind = previewEvents.some(e => COSTLY_EVENTS.has(e.type)) ? 'costly' : 'clean';
    return { kind, label: action.label.toUpperCase(), icon: action.icon, cost, enabled: true };
}

export function hudView(world: ReadonlyWorld, state: State, ui: UiState, extras: HudExtras = {}): HudViewModel {
    return {
        turn: state.turn,
        bank: bankView(state),
        crew: crewCards(world, state, ui.selected),
        selected: ui.selected,
        actions: actionsView(world, state, ui, extras),
        confirm: confirmView(ui, extras.previewEvents, extras.costOf),
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
        case 'doorOpened': return `${name(event.by)} opened ${doorName(world, event.door)}`;
        case 'doorClosed': return event.by ? `${name(event.by)} closed ${doorName(world, event.door)}` : `${capitalise(doorName(world, event.door))} swung shut`;
        case 'doorLocked': return `${name(event.by)} locked ${doorName(world, event.door)}`;
        case 'doorUnlocked': return `${name(event.by)} unlocked ${doorName(world, event.door)}`;
        case 'knockedOut': return `${name(event.crew)} knocked out ${name(event.npc)}`;
        case 'woke': return `${name(event.npc)} came round`;
        case 'bodyLifted': return `${name(event.crew)} took hold of ${name(event.npc)}`;
        case 'bodyDropped': return `${name(event.crew)} let go of ${name(event.npc)}`;
        case 'bodyStashed': return `${name(event.crew)} hid ${name(event.npc)} in ${stashName(world, event.stash)}`;
        case 'evidenceNoticed': return `${name(event.npc)} noticed ${EVIDENCE_NAMES[event.kind] ?? event.kind}`;
        case 'bark': return `${name(event.npc)}: “${barkText(world, state, event)}”`;
        case 'toldEvidence': return `${name(event.npc)} told ${name(event.guard)}`;
        default: return event.type;
    }
}

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** What each kind of evidence is called in the log (§8.10). */
const EVIDENCE_NAMES: Readonly<Record<string, string>> = {
    secureDoor: 'a door left open', emptyWindow: 'an empty teller window', missingColleague: 'someone missing', cameraDown: 'a camera off',
    lightsOut: 'the lights out', body: 'a body', tied: 'someone tied up', hole: 'a hole', weapon: 'a weapon', blood: 'blood', lootBag: 'a bag',
    drill: 'a drill', assault: 'being attacked'
};

/** A room's name from its id ('vaultCorridor-2' → 'vault corridor'). */
export const roomLabel = (id: string): string => id.replace(/-\d+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

const ZONE_RANK: Readonly<Record<string, number>> = { secure: 3, staff: 2, public: 1 };

/** A door by the room it guards (the more private side): 'the vault corridor door'. */
export function doorName(world: ReadonlyWorld, id: string): string {
    const def = world.doors[id], edge = def && world.edges[def.edge];
    if (!edge) return 'a door';
    const sides = [edge.run === 'eastWest' ? { x: edge.tx, y: edge.ty - 1 } : { x: edge.tx - 1, y: edge.ty }, { x: edge.tx, y: edge.ty }]
        .map(p => world.tiles[p.y * world.width + p.x]).filter(t => t?.room);
    const side = sides.sort((a, b) => (ZONE_RANK[b!.zone] ?? 0) - (ZONE_RANK[a!.zone] ?? 0))[0];
    return side?.room ? `the ${roomLabel(side.room)} door` : 'the door';
}

function stashName(world: ReadonlyWorld, id: string): string {
    const obj = world.objects.find(o => o.id === id);
    return obj ? `the ${obj.name ?? obj.kind}` : `the ${roomLabel(id)}`;
}

/**
 * What an NPC says when it notices something (§8.10): the first time a kind is barked in the heist the line names it
 * ("Was the vault corridor door open before?"); later ones are generic.
 */
export function barkText(world: ReadonlyWorld, _state: State, e: Extract<SimEvent, { type: 'bark' }>): string {
    if (!e.first) return MAJOR_KINDS.has(e.cause) ? 'Hey! Over here!' : 'Huh. That’s odd.';
    const about = e.evidence.slice(e.evidence.indexOf(':') + 1);
    const person = world.people.find(p => p.id === about)?.name ?? 'they';
    switch (e.cause) {
        case 'secureDoor': {
            const door = doorName(world, about);
            return `Was ${door} open before?`;
        }
        case 'emptyWindow': return 'Where did the teller go?';
        case 'missingColleague': return `Where’s ${person}?`;
        case 'cameraDown': return 'Is that camera off?';
        case 'lightsOut': return 'Who turned the lights off?';
        case 'body': return 'Someone’s down! Get help!';
        case 'tied': return 'Someone’s been tied up!';
        case 'hole': return 'There’s a hole in the wall!';
        case 'weapon': return 'Is that a gun?';
        case 'blood': return 'Is that… blood?';
        case 'lootBag': return 'Whose bag is this?';
        case 'drill': return 'Why is there a drill here?';
        case 'assault': return 'Someone hit me!';
        default: return 'What’s that?';
    }
}

const MAJOR_KINDS: ReadonlySet<string> = new Set(['body', 'tied', 'hole', 'weapon', 'blood', 'lootBag', 'drill', 'assault']);
