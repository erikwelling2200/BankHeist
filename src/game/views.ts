import {
    CARRIERS, commandPreview, crewLoot, crewLook, DASH_ACTIONS, hasWeaponInHand, holdPreview, isKnownNow, knownCarriers, lootOf, markerKind, mayBeDyed, steadyHand, walkingToAlarm, MOVE_ACTIONS, nextDriveBy, type CarrierChanges, type CarrierPreview,
    type CommandRings, type Command, type HoldRing, type ReadonlyWorld, type SimEvent, type State
} from '../sim';
import {
    CREW_COLOURS, OVERLAY_IDS, type ActionVM, type BankStatus, type CommitKind, type ConfirmVM, type HudIcon, type BankStatusVM, type CrewVM, type HudViewModel, type LootVM, MAX_ACTIONS, type OverlayId,
    type RecapEventVM, type RecapVM, type RingsVM, type ThreatVM
} from '../ui/hud/viewModels';
import { actionMenu, cameraName, VERBS } from './actions';
import type { UiState } from './session';

/*
 * View models for the HUD (implementation plan §2.5): plain objects made from the state, so the HUD never reads
 * `State` itself and a rule can change the state's shape without touching the HUD. The types are the HUD's contract
 * (src/ui/hud/viewModels.ts); fields the later packages fill in (HP until M3) are placeholders for now.
 */

/** The portrait an NPC's role wears in the ledger (src/ui/hud/img); roles without one show their initial. */
export function rolePortrait(role: string): string | undefined {
    const r = role.toLowerCase();
    if (r.includes('guard') || r === 'chief') return 'guard';
    if (r.includes('teller')) return 'teller';
    if (r === 'manager' || r === 'operator' || r === 'cleaner') return r;
    if (r.includes('customer') || r === 'passer-by') return 'customer';
    return undefined;
}

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Every live clock (§20.3 "Threat ledger"), most urgent first: running before halted, then by countdown, a carrier
 * before anything else at the same count. Every carrier shows (§9.1: the crew is told each one, `carrierStarted` names
 * its holder): its label, its holder's portrait, its countdown and whether it is halted. With the world: the check-in
 * calls of the guards the crew knows of (§8.11: the next call, or a downed guard's radio ringing), the patrol car's next
 * drive-by (§16.3, on the bank's timeline or announced by the police scanner), anyone walking to raise the alarm
 * (`walkingToAlarm`) and, after the Alarm, the police.
 */
export function threatLedger(state: State, world?: ReadonlyWorld): ThreatVM[] {
    const live: ThreatVM[] = [];
    const person = (id: string) => world?.people.find(p => p.id === id);
    // With the world, as the crew may know them (`knownCarriers`): who holds one, and where, only for a holder it sees or
    // predicts (or one that is nobody: dispatch, the car); the carrier shows, not who carries it.
    const carriers = world ? knownCarriers(world, state) : state.carriers.map(c => ({ ...c, label: CARRIERS[c.kind].label }));
    for (const c of carriers) {
        if (c.halted === 'countered') continue;
        const holder = c.source !== null ? person(c.source) : undefined, portrait = holder && rolePortrait(holder.role);
        const subject = c.subject ? person(c.subject)?.name ?? c.subject : undefined;
        live.push({
            id: c.id, kind: c.kind, source: c.source ?? '', label: subject ? `${c.label}: ${subject}` : c.label, countdown: c.countdown,
            halted: c.halted === 'paused' ? 'paused' : null, pos: c.pos ? { x: c.pos.x, y: c.pos.y } : null, ...(c.source !== null ? { targetId: c.source } : {}),
            ...(portrait ? { portrait } : {})
        });
    }
    if (world) live.push(...clocks(world, state));
    const carrier = (t: ThreatVM) => (t.kind === 'checkIn' || t.kind === 'driveBy' || t.kind === 'reinforcement' ? 1 : 0);
    // Something that wants the crew now (a jammed drill) sorts with the running clocks, though it stands still.
    const still = (t: ThreatVM) => Number(!!t.halted && !t.urgent);
    return live.sort((a, b) => still(a) - still(b) || a.countdown - b.countdown || carrier(a) - carrier(b) || byId(a, b));
}

/** World phases until something that happens in the world phase of turn `at`, counted as carriers count (§9.1). */
const phasesUntil = (state: State, at: number): number => Math.max(1, at - state.turn + 1);

/** The ledger's clocks that aren't carriers (see `threatLedger`). */
function clocks(world: ReadonlyWorld, state: State): ThreatVM[] {
    const out: ThreatVM[] = [...lapseClocks(world, state), ...deviceClocks(world, state)];
    const r = state.response;
    if (r) {
        out.push({ id: 'police', kind: 'reinforcement', source: 'police', label: r.policeIn > 0 ? 'Police arrive' : 'Police on site', countdown: r.policeIn, halted: null,
            pos: policePos(world), portrait: 'police' });
        // After the Alarm nobody calls a guard or drives past to check: the police are coming anyway.
        return out;
    }
    // Someone on their way to raise the alarm (a teller walking to her button): the carrier it will start, and when the
    // Alarm would go off (§9.1: the walk is the telegraph). Holder and place only where the crew knows them.
    walkingToAlarm(world, state).forEach((w, i) => {
        // One already holding a carrier of that kind keeps it (`raiseCarrier`): the carrier's row says it all.
        if (w.npc !== null && state.carriers.some(c => c.source === w.npc && c.kind === w.kind)) return;
        const holder = w.npc !== null ? world.people.find(p => p.id === w.npc) : undefined, portrait = holder && rolePortrait(holder.role);
        out.push({
            id: `walk:${w.npc ?? i}`, kind: w.kind, source: w.npc ?? '', label: `${w.label}: on the way (${w.eta})`, countdown: w.alarmIn, halted: null,
            pos: w.pos ? { x: w.pos.x, y: w.pos.y } : null, ...(w.npc !== null ? { targetId: w.npc } : {}), ...(portrait ? { portrait } : {})
        });
    });
    const radio = (state as Partial<State>).radio;
    for (const guard of Object.keys(radio?.calls ?? {}).sort()) {
        const call = radio!.calls[guard]!, npc = state.npcs.find(n => n.id === guard), def = world.people.find(p => p.id === guard);
        if (!npc || !def || markerKind(world, state, guard) === null) continue;
        const known = state.knowledge.npcs[guard]!, pos = { x: known.at.x, y: known.at.y };
        if (call.ringing !== null) {
            out.push({ id: `checkIn:${guard}`, kind: 'checkIn', source: guard, label: `Radio ringing: ${def.name}`, countdown: 1, halted: null, pos, targetId: guard, portrait: 'guard', urgent: true });
            continue;
        }
        out.push({ id: `checkIn:${guard}`, kind: 'checkIn', source: guard, label: `Check-in: ${def.name}${call.missed ? ` (missed ${call.missed})` : ''}`,
            countdown: phasesUntil(state, call.next), halted: null, pos, targetId: guard, portrait: 'guard' });
    }
    const driveBy = radio ? nextDriveBy(world, state) : null;
    if (driveBy !== null) {
        const sent = radio!.driveBy === driveBy;
        out.push({ id: 'driveBy', kind: 'driveBy', source: 'patrol', label: sent ? 'Patrol car (dispatch)' : 'Patrol drive-by', countdown: phasesUntil(state, driveBy), halted: null,
            pos: policePos(world), ...(sent ? { urgent: true } : {}) });
    }
    return out;
}

/**
 * When the crew's commands lapse (§10.2, §10.5): per crew member, the Commanded NPCs they put face down that the crew
 * knows of, counted down to the soonest whose pips run out (a pip goes every world phase; at 0 it is Twitchy, and one
 * that stayed down rolls again after the next). Paused while a hold this turn keeps them all; "Lapses?" while the only
 * ones it may not keep are those it reaches through a door the crew can't vouch for (`holdPreview`'s `unsure`).
 */
function lapseClocks(world: ReadonlyWorld, state: State): ThreatVM[] {
    const out: ThreatVM[] = [];
    for (const c of state.crew) {
        const down = state.npcs.filter(n => n.status === 'commanded' && n.command?.by === c.id && isKnownNow(world, state, n.id));
        if (!down.length) continue;
        const ring = c.holding === state.turn ? holdPreview(world, state, c.id) : { held: [], unsure: [] };
        const doubted = down.filter(n => ring.unsure.includes(n.id)), loose = down.filter(n => !ring.held.includes(n.id) && !ring.unsure.includes(n.id));
        const soonest = (loose.length ? loose : doubted.length ? doubted : down).reduce((a, n) => (Math.max(1, n.command!.pips) < Math.max(1, a.command!.pips) ? n : a));
        const at = state.knowledge.npcs[soonest.id]?.at ?? soonest.pos;
        const word = loose.length ? 'Lapses' : doubted.length ? 'Lapses?' : 'Held';
        out.push({
            id: `lapse:${c.id}`, kind: 'lapse', source: c.id, label: `${word}: ${down.length} face down (${c.name})`,
            countdown: Math.max(1, soonest.command!.pips), halted: loose.length || doubted.length ? null : 'paused', pos: { x: at.x, y: at.y }, targetId: soonest.id
        });
    }
    return out;
}

/**
 * The drills and thermite at work (§15.3): the world phases each has left; a running drill's jam odds as the crew phase
 * begins (none with Steady Hands in reach); a jammed one stands still until fixed, and wants the crew now.
 */
function deviceClocks(world: ReadonlyWorld, state: State): ThreatVM[] {
    // A finished drill left at its door until taken back is no clock.
    return state.devices.filter(d => d.done < d.needed).map(d => {
        const left = d.needed - d.done, name = d.kind === 'drill' ? 'Drill' : 'Thermite', work = `${d.done}/${d.needed}`;
        const steady = d.kind === 'drill' && !!steadyHand(world, state, d);
        const label = d.jammed ? `${name} jammed: fix it (${work})`
            : d.kind === 'drill' && !steady ? `${name} ${work}: jams ${Math.round(world.rules.drillJamChance * 100)}%` : `${name} ${work}`;
        // Jammed, it stands still (no countdown runs) and wants the crew now.
        return { id: `device:${d.id}`, kind: 'drill', source: d.id, label, countdown: left, halted: d.jammed ? 'paused' : null, pos: { x: d.pos.x, y: d.pos.y }, ...(d.jammed ? { urgent: true } : {}) } satisfies ThreatVM;
    });
}

/** Where the police come from: the middle of the patrol car's lane, else the middle of the map. */
function policePos(world: ReadonlyWorld): { x: number; y: number } {
    const lane = world.patrol?.lane ?? [];
    const p = lane[Math.floor(lane.length / 2)];
    return p ? { x: p.x, y: p.y } : { x: Math.floor(world.width / 2), y: Math.floor(world.height / 2) };
}

/**
 * The state pill (§20.3): "QUIET", "QUIET: alarm in 2" with a carrier running, "ALARM: police in 6" once the Alarm is
 * up (§9.2), "LOUD". Heat is a placeholder until the police arrive (M3): Heat 1 from then.
 */
export function bankView(state: State, goPreview = false): BankStatusVM {
    const running = threatLedger(state).filter(t => !t.halted);
    const nextAlarmIn = state.bank.alarm ? null : running.length ? running[0]!.countdown : null;
    const status: BankStatus = state.bank.alarm ? 'alarm' : state.bank.loud ? 'loud' : 'quiet';
    const r = (state as Partial<State>).response ?? null;
    const label = status === 'alarm'
        ? r ? (r.policeIn > 0 ? `ALARM: police in ${r.policeIn}` : 'ALARM: police on site') : 'ALARM'
        : status === 'loud' ? 'LOUD' : nextAlarmIn !== null ? `QUIET: alarm in ${nextAlarmIn}` : 'QUIET';
    const heat = r && r.policeIn <= 0 ? { level: r.heat.level, ticks: r.heat.tick, next: null } : null;
    // GO (§9.3): the takeover turn, or GO previewed.
    const go = goPreview || state.takeover === state.turn;
    return { status, label, nextAlarmIn, ...(r ? { policeEta: r.policeIn, heat } : {}), ...(go ? { go: true } : {}) };
}

/** Each crew member's colour, from their place in the crew's order. */
const crewColour = (index: number): string => CREW_COLOURS[index % CREW_COLOURS.length]!;

/** The crew members with a portrait of their own (src/ui/hud/img), by id; the rest show their initial. */
const PORTRAITS: ReadonlySet<string> = new Set(['mara', 'jun', 'dex', 'sol']);
/** A crew member's portrait: their own, masked (`-m`) while the mask is on (§6.3). */
const portraitOf = (c: State['crew'][number]): { portrait?: string } =>
    (PORTRAITS.has(c.id) ? { portrait: c.loadout.masked ? `${c.id}-m` : c.id } : {});

/** What the crew card shows carried: loot, in the hands or pocketed (a body only raises the profile, §7.4). */
const carriedOf = (state: State, c: State['crew'][number]): CrewVM['carrying'] => (lootOf(state, c.id).length ? 'loot' : null);

/** Whether some cash a crew member carries may be dyed (`mayBeDyed`: uninspected, in a bank with dye packs), never whether it is. */
const unsureOf = (world: ReadonlyWorld, state: State, c: State['crew'][number]): boolean => lootOf(state, c.id).some(id => mayBeDyed(world, state, id));

const exposedTo = (state: State, crew: string): string[] => state.npcs.filter(n => n.exposedTo.includes(crew)).map(n => n.id);

/**
 * The crew rail's cards. With `go` (the state GO would leave, while it is previewed) each card shows that crew member as
 * GO leaves them, mask, actions and look, and nothing else of that state: what NPCs make of it is the preview's.
 */
export function crewCards(world: ReadonlyWorld, state: State, selected: string | null, go?: State): CrewVM[] {
    const takeover = (go ?? state).takeover === state.turn;
    return state.crew.map((now, i) => {
        const c = go?.crew.find(x => x.id === now.id) ?? now;
        return {
            id: c.id,
            name: c.name,
            colour: crewColour(i),
            ...portraitOf(c),
            actionsLeft: c.actionsLeft,
            // The takeover turn's third action (§9.3).
            actionsMax: world.rules.actionsPerTurn + (takeover ? 1 : 0),
            // The profile from what shows (§7.4), before any observer's reading; the same look the safe floor reads.
            profile: crewLook(c).profile,
            exposedTo: exposedTo(state, c.id),
            hp: null,
            selected: c.id === selected,
            carrying: carriedOf(state, c),
            ...(unsureOf(world, state, c) ? { mayBeDyed: true } : {})
        };
    });
}

/** The loot counter (§15.1): what the crew carries, what a dye pack ruined, whether some may be dyed; null for none. */
export function lootView(world: ReadonlyWorld, state: State): LootVM | null {
    const { carried, ruined } = crewLoot(world, state);
    if (!carried && !ruined) return null;
    return { carried, ruined, mayBeDyed: state.crew.some(c => unsureOf(world, state, c)) };
}

/**
 * A previewed command's rings counted (§10.1), from `commandPreview` (the NPCs the crew knows of, each resister's chance
 * the one the commit rolls with); or a previewed hold's (`holdPreview`): how many it keeps face down.
 */
export function ringsView(world: ReadonlyWorld, plan: CommandRings | HoldRing): RingsVM {
    if ('held' in plan) return { kind: 'hold', down: plan.held.length, panics: 0, alerted: 0, ignores: 0, unsure: plan.unsure.length, resisters: [] };
    const count = (o: string) => plan.targets.filter(t => t.outcome === o).length;
    const resisters = plan.targets.filter(t => t.outcome === 'resists').map(t => {
        const person = world.people.find(p => p.id === t.npc), portrait = person && rolePortrait(person.role);
        return { id: t.npc, name: person?.name ?? t.npc, ...(portrait ? { portrait } : {}), chance: t.chance ?? 0 };
    });
    return { kind: 'command', down: count('complies'), panics: count('panics'), alerted: count('alerted'), ignores: count('ignores'), unsure: plan.unsure.length, resisters };
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
    /** What the pending command does to the alarm carriers, as the crew may know it (`Session.carrierChanges`). */
    carriers?: CarrierChanges;
    /** The pending command's uninspected cash it would carry out (`ActionPreview.mayBeDyed`). */
    mayBeDyed?: readonly string[];
    /** GO is previewed: the state after it (`Session.preview`), for the gold rail's masks and third actions. */
    goPreview?: State;
    /** The pending command's rings (`Session.commandRings`) or the pending hold's (`Session.holdRing`). */
    rings?: CommandRings | HoldRing;
}

/**
 * An entry of the action grid: 'move' (movement: a tap picks Move or Dash by how far it goes, src/game/movement.ts, so
 * Dash has no button of its own), or one of `actionMenu`'s ids ('door:open', 'knockout', 'drag', 'stash', 'wait', …).
 */
export type ActionId = string;

/** How a command is named on its button and on Confirm, and what it costs when no preview says (Wait: no pip of its own). */
function describeCommand(cmd: Command, world?: ReadonlyWorld): { label: string; icon: HudIcon; cost: number } {
    switch (cmd.type) {
        case 'move': return { label: 'Move', icon: 'move', cost: MOVE_ACTIONS };
        case 'dash': return { label: 'Dash', icon: 'dash', cost: DASH_ACTIONS };
        case 'wait': return { label: 'Wait', icon: 'wait', cost: 0 };
        case 'door': return { label: `${cmd.action} door`, icon: cmd.action === 'lock' || cmd.action === 'unlock' ? 'lock' : 'interact', cost: 1 };
        case 'knockout': return { label: 'Knockout', icon: 'knockout', cost: 1 };
        case 'drag': return { label: 'Drag', icon: 'heavy', cost: 1 };
        case 'drop': return { label: 'Drop', icon: 'flip', cost: 1 };
        case 'stash': return { label: 'Stash', icon: 'concealed', cost: 1 };
        case 'interact': {
            const kind = world?.objects.find(o => o.id === cmd.object)?.kind;
            const named = kind && VERBS[`${kind}.${cmd.verb}`];
            return named ? { label: named.label, icon: named.icon, cost: 1 } : { label: cmd.verb, icon: 'interact', cost: 1 };
        }
        case 'loopFeed': return { label: world ? `Loop ${cameraName(world, cmd.camera)}` : 'Loop feed', icon: 'hack', cost: 1 };
        case 'answerRadio': return { label: 'Answer radio', icon: 'chat', cost: 1 };
        case 'placeJammer': return { label: 'Jammer', icon: 'radio', cost: 1 };
        case 'command': return { label: 'Command', icon: 'command', cost: 1 };
        case 'hold': return { label: 'Hold', icon: 'hold', cost: 1 };
        case 'maskUp': return { label: 'Mask up', icon: 'mask', cost: 1 };
        case 'go': return { label: 'GO', icon: 'star', cost: 0 };
        case 'zipTie': return { label: 'Zip-tie', icon: 'ziptie', cost: 1 };
        case 'escort': return { label: 'Lead', icon: 'hold', cost: 1 };
        case 'coerce': return { label: 'Coerce', icon: 'command', cost: 1 };
        case 'changeClothes': return { label: 'Change clothes', icon: 'swap', cost: 2 };
        case 'takeLoot': return { label: 'Take', icon: 'bag', cost: 1 };
        case 'dropLoot': return { label: 'Put down', icon: 'flip', cost: 1 };
        case 'throwLoot': return { label: 'Throw', icon: 'throw', cost: 1 };
        case 'pass': return { label: 'Pass', icon: 'heavy', cost: 1 };
        case 'inspectLoot': return { label: 'Inspect', icon: 'eye', cost: 1 };
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
    const move = describeCommand(pending?.type === 'dash' ? pending : { type: 'move', crew: member.id, path: [] }, world);
    const stuck = member.actionsLeft === 0 ? 'No actions left' : undefined;
    const out: ActionVM[] = [{ id: 'move', label: move.label, icon: move.icon, cost: move.cost, enabled: !stuck, ...(stuck ? { reason: stuck } : {}), selected: moving }];
    for (const e of actionMenu(world, state, member.id, extras.target)) {
        // Hold spends whatever is left (§10.3), at least 1.
        const fallback = e.command.type === 'hold' ? Math.max(1, member.actionsLeft) : describeCommand(e.command, world).cost;
        const cost = e.command.type === 'wait' ? 0 : (!e.reason && extras.costOf?.(e.command)) || fallback;
        const vm: ActionVM = {
            id: e.id, label: e.label, icon: e.icon, cost, enabled: !e.reason, ...(e.reason ? { reason: e.reason } : {}), selected: sameCommand(pending, e.command),
            ...(e.progress ? { progress: e.progress } : {})
        };
        // GO (§9.3) is gold. Once a takeover is at hand it heads the grid, a wide row of its own (decision 84);
        // until then it keeps its place after the stealth entries, and a full grid drops it first.
        if (e.command.type !== 'go') out.push(vm);
        else if (takeoverAtHand(world, state)) out.unshift({ ...vm, go: true, wide: true });
        else out.push({ ...vm, go: true });
    }
    return out.slice(0, MAX_ACTIONS - (out[0]?.wide ? 1 : 0));
}

/**
 * Whether a takeover is at hand (decision 84): a crew member with a weapon in hand would, shouting on the takeover turn
 * (GO's radius, ×1.5), have someone the crew knows of in their command ring for certain who isn't down yet: up and
 * taking orders (or resisting them), in their line of sight, as the command's own preview reads it (`commandPreview`:
 * not through a door the crew can't vouch for). Face down, tied, out cold or Hostile, nobody brings it up.
 */
export function takeoverAtHand(world: ReadonlyWorld, state: State): boolean {
    const go = { ...state, takeover: state.turn };
    const down = (id: string): boolean => state.npcs.find(n => n.id === id)?.status === 'commanded';
    return state.crew.some(c => hasWeaponInHand(c)
        && commandPreview(world, go, c.id).targets.some(t => t.ring === 'command' && (t.outcome === 'complies' || t.outcome === 'resists') && !down(t.npc)));
}

/** Events in a preview that give the crew away, or are an illegal act seen or not (§8.4): Confirm turns amber. */
const COSTLY_EVENTS: ReadonlySet<string> = new Set(['heard', 'perceptionCheck', 'cameraSaw', 'knockedOut', 'bodyLifted', 'bodyStashed', 'carrierStarted', 'confronted']);

/** A carrier as a preview names it (§8.8): "Teller button (2)". */
const carrierText = (c: Pick<CarrierPreview, 'label' | 'countdown'>): string => `${c.label} (${c.countdown})`;

/**
 * Confirm for the pending command: its name and cost (a Dash shows 2 pips), coloured by what it gives away (UI.md
 * "Confirm's colour"): amber when someone hears or sees it, or it is an illegal act; cream otherwise. Dimmed while
 * nothing is previewed.
 */
/** Commands to people (§10): Confirm in steel blue (UI.md "Confirm's colour"). */
const COMMANDS: ReadonlySet<string> = new Set(['command', 'hold', 'coerce']);

export function confirmView(
    ui: UiState, previewEvents: readonly SimEvent[] = [], costOf?: (cmd: Command) => number | undefined, carriers?: CarrierChanges, world?: ReadonlyWorld,
    mayBeDyed: readonly string[] = []
): ConfirmVM {
    const cmd = ui.pendingCommand;
    if (!cmd || cmd.type === 'endTurn') return { kind: 'clean', label: '', cost: 0, enabled: false };
    const action = describeCommand(cmd, world);
    const cost = cmd.type === 'wait' ? 0 : costOf?.(cmd) ?? action.cost;
    // A carrier it would start, at once or in the coming world phase, is a cost the player must see (§8.8).
    const starts = carriers ? [...carriers.starts, ...carriers.worldPhase].map(carrierText) : [];
    const stops = carriers ? carriers.stops.map(c => CARRIERS[c.kind].label) : [];
    const kind: CommitKind = cmd.type === 'go' ? 'go' : COMMANDS.has(cmd.type) ? 'command'
        : starts.length || previewEvents.some(e => COSTLY_EVENTS.has(e.type)) ? 'costly' : 'clean';
    // Cash nobody has looked through, carried out (§15.1): it may be dyed. The preview can't say, so neither does this.
    const warns = mayBeDyed.length ? [mayBeDyed.length === 1 ? 'the cash may be dyed' : `${mayBeDyed.length} stacks of cash may be dyed`] : [];
    return {
        kind, label: action.label.toUpperCase(), icon: action.icon, cost, enabled: true, ...(starts.length ? { starts } : {}), ...(stops.length ? { stops } : {}),
        ...(warns.length ? { warns } : {})
    };
}

export function hudView(world: ReadonlyWorld, state: State, ui: UiState, extras: HudExtras = {}): HudViewModel {
    // GO previewed (§9.3, UI.md "GO previewed"): the rail turns gold and shows the crew as GO leaves them, masked with a
    // third action each; on the takeover turn it stays gold.
    const goNow = state.takeover === state.turn, previewing = !!extras.goPreview && ui.pendingCommand?.type === 'go';
    const crew = crewCards(world, state, ui.selected, previewing ? extras.goPreview : undefined);
    return {
        turn: state.turn,
        bank: bankView(state, previewing),
        crew,
        selected: ui.selected,
        actions: actionsView(world, state, ui, extras),
        confirm: confirmView(ui, extras.previewEvents, extras.costOf, extras.carriers, world, extras.mayBeDyed),
        goRail: previewing ? 'preview' : goNow ? 'on' : null,
        rings: extras.rings ? ringsView(world, extras.rings) : null,
        loot: lootView(world, state),
        undoEnabled: extras.undoEnabled ?? false,
        ledger: threatLedger(state, world),
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
            id: c.id, name: c.name, colour: crewColour(i), ...portraitOf(c),
            status: c.actionsLeft > 0 ? 'ready' : 'done',
            actionsLeft: c.actionsLeft,
            exposed: exposedTo(state, c.id).length > 0,
            hp: null
        })),
        threats: threatLedger(state, world)
    };
}

/** A line of text for the event log and the recap. Event types without a line of their own show their type. */
/** Loot as the recap names it: what the generator calls it, lower-cased ("the cash drawer"). */
const lootName = (world: ReadonlyWorld, id: string): string => {
    const o = world.objects.find(x => x.id === id);
    return o?.name ? `the ${o.name.charAt(0).toLowerCase()}${o.name.slice(1)}` : 'the loot';
};

export function describeEvent(world: ReadonlyWorld, state: State, event: SimEvent): string {
    const name = (id: string): string => state.crew.find(c => c.id === id)?.name ?? world.people.find(p => p.id === id)?.name ?? id;
    switch (event.type) {
        case 'moved': return `${name(event.crew)} moved to (${event.to.x}, ${event.to.y})`;
        case 'waited': return `${name(event.crew)} waited`;
        case 'moveCut': return event.reason === 'bump'
            ? `${name(event.crew)} ran into ${name(event.npc)} and stopped at (${event.at.x}, ${event.at.y})`
            : `${name(event.crew)} found ${doorName(world, event.door)} ${event.status} and stopped at (${event.at.x}, ${event.at.y})`;
        case 'phaseStarted': return event.phase === 'crew' ? `Turn ${event.turn}` : `World phase of turn ${event.turn}`;
        case 'carrierStarted': return `${CARRIERS[event.kind].label}: alarm in ${event.countdown}`;
        case 'carrierTicked': return `Alarm in ${event.countdown}`;
        case 'carrierStopped': return `${CARRIERS[event.kind].label} stopped${STOP_WHY[event.why] ? `: ${STOP_WHY[event.why]}` : ''}`;
        case 'carrierPaused': return `A carrier is paused: ${event.why}`;
        case 'carrierResumed': return 'A carrier runs again';
        case 'alarmRaised': return state.response ? `The alarm is raised: police in ${state.response.policeIn}` : 'The alarm is raised';
        case 'policeCountdown': return event.policeIn > 0 ? `Police in ${event.policeIn}` : 'The police are here';
        case 'alarmAttempt': return `${name(event.npc)} raises the alarm`;
        case 'alarmDead': return event.kind === 'seismicSensor' || event.kind === 'motionSensor'
            ? `The ${CARRIERS[event.kind].label.toLowerCase()} is dead: nothing happened` : `${name(event.source)} pressed the button: nothing happened`;
        case 'confronted': return `${name(event.npc)} to ${name(event.crew)}: “Hands up!”`;
        case 'panelWorked': return `${name(event.crew)} worked on the alarm panel (${event.progress}/${event.needed})`;
        case 'panelDisabled': return `${name(event.crew)} killed the alarm panel`;
        case 'jammerPlaced': return `${name(event.crew)} set a jammer running`;
        case 'checkIn': return `${name(event.guard)} checked in on the radio`;
        case 'checkInRinging': return `${name(event.guard)}’s radio is ringing`;
        case 'radioAnswered': return `${name(event.crew)} answered ${name(event.guard)}’s radio`;
        case 'checkInMissed': return `${name(event.guard)} missed a check-in (${event.missed})`;
        case 'checkInSearch': return `${name(event.sent)} was sent to look for ${name(event.guard)}`;
        case 'dispatchLostContact': return `Dispatch lost contact: a patrol car comes past on turn ${event.driveBy}`;
        case 'patrolPassed': return event.saw === null ? 'A patrol car drove past' : 'A patrol car drove past and saw something';
        case 'feedLooped': return `${name(event.crew)} looped ${cameraName(world, event.camera)} until turn ${event.until}`;
        case 'feedRestored': return `${capitalise(cameraName(world, event.camera))} shows the room again`;
        case 'operatorVerifies': return `${name(event.npc)} saw something on ${cameraName(world, event.camera)}`;
        case 'operatorSentGuard': return `${name(event.npc)} sent ${name(event.guard)} to look`;
        case 'footageRecorded': return `${capitalise(cameraName(world, event.camera))} recorded ${name(event.crew)}`;
        case 'recorderTaken': return `${name(event.crew)} took the recorder`;
        case 'zipTied': return `${name(event.crew)} zip-tied ${name(event.npc)}`;
        case 'weaponTaken': return `${name(event.crew)} took ${name(event.npc)}’s pistol`;
        case 'hiddenWeaponFound': return `${name(event.crew)} found a hidden pistol on ${name(event.npc)}`;
        case 'keycardTaken': return `${name(event.crew)} took ${name(event.npc)}’s keycard`;
        case 'escorting': return `${name(event.crew)} is leading ${name(event.npc)}`;
        case 'hostageFree': return `${name(event.npc)} shook free of ${name(event.crew)}`;
        case 'coerced': return `${name(event.crew)} made ${name(event.npc)} do as told`;
        case 'codeEntered': return event.npc ? `${name(event.npc)} entered their part of the vault code` : `${name(event.crew)} entered ${CODE_PART[event.part]}`;
        case 'vaultUnlocked': return event.how === 'keycard' && event.by ? `${name(event.by)} swiped the card: the vault is unlocked` : 'The code is in: the vault is unlocked';
        case 'timeLockShut': return 'The time lock locked the vault again';
        case 'drillTaken': return `${name(event.crew)} took the drill back`;
        case 'sensorsCut': return `${name(event.crew)} cut the vault’s sensors`;
        case 'pcHacked': return `${name(event.crew)} got into the manager’s PC: ${event.part ? CODE_PART[event.part] : 'no code'}${event.window ? `; the time lock takes codes on turns ${event.window.from}–${event.window.until - 1}` : ''}`;
        case 'lockWorked': return `${name(event.crew)} worked on the lock (${event.progress}/${event.needed})`;
        case 'doorWorked': return `${name(event.crew)} worked on the lock of ${doorName(world, event.door)} (${event.progress}/${event.needed})`;
        case 'boxOpened': return `${name(event.crew)} opened a deposit box`;
        case 'deviceSet': return `${name(event.crew)} set ${event.kind === 'drill' ? 'the drill' : 'thermite'} to work`;
        case 'deviceWorked': return `${event.kind === 'drill' ? 'Drilling' : 'Thermite'}: ${event.done}/${event.needed}`;
        case 'drillJammed': return 'The drill jammed';
        case 'drillFixed': return `${name(event.crew)} fixed the drill`;
        case 'vaultBreached': return `The ${event.by === 'drill' ? 'drill' : 'thermite'} is through the vault door`;
        case 'wallDrilled': return 'The drill is through the deposit boxes';
        case 'untying': return `${name(event.by)} is untying ${name(event.npc)}`;
        case 'freed': return `${name(event.by)} freed ${name(event.npc)}`;
        case 'changedClothes': return `${name(event.crew)} changed into a ${event.uniform} uniform`;
        case 'guardStripped': return `${name(event.crew)} took ${name(event.npc)}’s uniform`;
        case 'lootTaken': return `${name(event.crew)} took ${lootName(world, event.loot)}`;
        case 'lootDropped': return `${name(event.crew)} put down ${lootName(world, event.loot)}`;
        case 'lootThrown': return event.caughtBy ? `${name(event.crew)} threw the bag to ${name(event.caughtBy)}` : `${name(event.crew)} threw the bag`;
        case 'lootPassed': return `${name(event.crew)} passed ${lootName(world, event.loot)} to ${name(event.to)}`;
        case 'bodyPassed': return `${name(event.crew)} handed the body to ${name(event.to)}`;
        case 'lootInspected': return `${name(event.crew)} looked through ${lootName(world, event.loot)}`;
        case 'cashOut': return `${name(event.crew)} carried uninspected cash out of the building`;
        case 'dyePackFound': return `${name(event.crew)} found a dye pack in the cash and took it out`;
        case 'dyePackBurst': return `A dye pack burst in ${name(event.crew)}’s pocket: the cash is ruined`;
        case 'recorderDestroyed': return `${name(event.crew)} smashed the recorder`;
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
        case 'commanded': return `${name(event.npc)} got down for ${name(event.crew)}`;
        case 'resisted': return `${name(event.npc)} resisted ${name(event.crew)}`;
        case 'ignoredCommand': return `${name(event.npc)} ignored ${name(event.crew)}`;
        case 'lapsed': return `${name(event.npc)} is twitchy: ${LAPSE_TEXT[event.outcome]}`;
        case 'drewWeapon': return `${name(event.npc)} drew a weapon`;
        case 'panicked': return `${name(event.npc)} panics`;
        case 'panicReaction': return `${name(event.npc)} panics: ${PANIC_TEXT[event.reaction]}`;
        case 'hid': return event.called ? `${name(event.npc)} hid and phoned it in` : `${name(event.npc)} hid, but was seen`;
        case 'gaveUp': return `${name(event.npc)} found the way out blocked`;
        case 'tackled': return `${name(event.crew)} tackled ${name(event.npc)}`;
        case 'heroTackled': return `${name(event.npc)} tackled ${name(event.crew)}`;
        case 'actionLost': return `${name(event.crew)} lost an action getting up`;
        case 'holding': return `${name(event.crew)} holds the room`;
        case 'tookOver': return `GO: ${name(event.crew)} starts the takeover`;
        case 'surprised': return `${name(event.npc)} is surprised`;
        case 'maskedUp': return `${name(event.crew)} masked up`;
        default: return event.type;
    }
}

/** What a lapsed command rolled (§10.5), as the log says it. */
const LAPSE_TEXT: Readonly<Record<string, string>> = {
    stayDown: 'stays down', flee: 'about to run for it', hide: 'about to hide', tackle: 'about to tackle', alarm: 'about to go for the alarm',
    phone: 'about to phone it in', reachForWeapon: 'reaching for a weapon'
};

/** What a panicked NPC picked (§10.8), as the log says it. */
const PANIC_TEXT: Readonly<Record<string, string>> = {
    cower: 'cowers', flee: 'about to run for it', hide: 'about to hide', tackle: 'about to tackle', reach: 'reaching for a weapon'
};

/** A part of the vault code, as the log says it. */
const CODE_PART: Readonly<Record<string, string>> = { whole: 'the vault code', manager: 'the manager’s half of the vault code', headTeller: 'the head teller’s half of the vault code' };

/** Why a carrier stopped, as the log says it. */
const STOP_WHY: Readonly<Record<string, string>> = {
    panel: 'the alarm panel is dead', 'source down': 'its holder is down', answered: 'the radio was answered', alarm: 'the alarm is up', commanded: 'its holder is face down',
    'route blocked': 'the way out is blocked', 'route longer': 'the way out is longer now'
};

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
