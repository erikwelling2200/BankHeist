import { InvariantError, preview, registerCommandHook, registerWorldHook, type Ctx, type PreviewResult } from '../core/engine';
import { newId, registerRuleDefaults, registerStateInit } from '../core/state';
import type { Carrier, CarrierKind, DeepReadonly, EventOf, Pos, ReadonlyWorld, SimEvent, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { isKnownNow } from './knowledge';
import { neutralised } from './cctv';

/*
 * Alarm carriers (§9.1): someone or something in the middle of raising the Alarm, always shown with a countdown in
 * world phases. The design's hard promise: every carrier starts at `rules.minCarrierCountdown` (2) or more, and every
 * carrier has counters that still work once its countdown runs.
 *
 * - **Starting.** Every rule starts carriers through `raiseCarrier`: nothing starts once the Alarm is up; a wired
 *   carrier (`CARRIERS[kind].wired`: the teller buttons, the manager's button, the operator's panel, the vault sensors)
 *   doesn't start while the alarm panel is dead (§9.1: "kills every wired carrier"), which says so with `alarmDead`;
 *   and a source already carrying one of the same kind (about the same subject) keeps that one. `startCarrier` is the bare engine call.
 * - **Ticking.** The devices step ticks every running carrier once per world phase, never in the world phase that
 *   started it, so one started in a world phase is seen at its full countdown for a whole crew phase. At 0 it raises
 *   the Alarm (§9.2): `bank.alarm`, "Police in N" (`rules.policeEta`, by tier: small 8, city 6, HQ 4) counting down in
 *   `State.response` one per world phase from the next, and heat at Heat 1, tick 0 (§13.1; police arrival is M3). Every
 *   other carrier stops: there is nothing left to raise.
 * - **Counters** are checks (`registerCarrierCheck`) run after every command and before the devices tick: a check
 *   may counter a carrier (it is removed: `carrierStopped`) or pause it (it doesn't tick: `carrierPaused`, and
 *   `carrierResumed` when nothing pauses it any more). This module's own check is the source: a carrier whose NPC is
 *   out cold, dead, tied, stashed or dragged off is countered, and so is one whose NPC is Commanded (§9.1, §10.2,
 *   rules/command.ts). Others: the dead alarm panel (alarms.ts), a jammer (alarms.ts), the neutralised operator
 *   (here too, being the source), answering the radio (checkins.ts, as an action).
 * - **Previews** (§8.8, "this would start: Teller button (2)"): `carrierPreview(world, before, result)` names the
 *   carriers a previewed command starts or stops at once, and those the coming world phase would start that it
 *   wouldn't have started without the command (`pendingCarriers`: the world phase's own reducers on a copy, so the
 *   hatched overlay and the outcome can't differ). Both are the truth: `projectCarriers` redacts the holders the crew
 *   doesn't know, as `projectEvents` does `carrierStarted`; `knownCarriers` is the ledger's running carriers, the same
 *   way; `walkingToAlarm` (alarms.ts) the NPCs on their way to start one.
 */

/** A carrier kind as data (§9.1): what the HUD calls it, what kills it, and its counters as the design lists them. */
export interface CarrierDef {
    label: string;
    /** Wired to the alarm panel: a dead panel kills it, in progress too. */
    wired: boolean;
    /** A radio or a mobile phone: a jammer in range pauses it (not a call on a landline, `Carrier.line`). */
    radio: boolean;
    /** The design's counters (§9.1); `now` for those the rules have so far, else the milestone that brings them. */
    counters: readonly { name: string; now: true | string }[];
}

export const CARRIERS: Readonly<Record<CarrierKind, CarrierDef>> = {
    tellerButton: {
        label: 'Teller button', wired: true, radio: false,
        counters: [{ name: 'knock out', now: true }, { name: 'disable the alarm panel', now: true }, { name: 'command', now: true }, { name: 'zip-tie', now: 'M2' }]
    },
    managerButton: {
        label: 'Manager button', wired: true, radio: false,
        counters: [{ name: 'knock out', now: true }, { name: 'disable the alarm panel', now: true }, { name: 'command', now: true }, { name: 'zip-tie', now: 'M2' }]
    },
    guardRadio: {
        label: 'Guard radio', wired: false, radio: true,
        counters: [{ name: 'knock out', now: true }, { name: 'jammer', now: true }, { name: 'command', now: true }, { name: 'kill', now: 'M3' }]
    },
    operatorCamera: {
        label: 'Operator verifies', wired: true, radio: false,
        counters: [{ name: 'neutralise the operator', now: true }, { name: 'disable the alarm panel', now: true }]
    },
    phoneCall: {
        label: 'Phone call', wired: false, radio: true,
        counters: [{ name: 'knock out', now: true }, { name: 'jammer (mobiles)', now: true }, { name: 'command', now: true }, { name: 'cut the phone line (landlines)', now: 'M4' }]
    },
    escapee: {
        label: 'Escapee', wired: false, radio: false,
        counters: [{ name: 'knock out', now: true }, { name: 'block the route', now: true }, { name: 'command', now: true }, { name: 'tackle', now: true }]
    },
    missedCheckIn: {
        label: 'Missed check-in', wired: false, radio: true,
        counters: [{ name: 'neutralise the operator', now: true }, { name: 'answer the radio', now: true }, { name: 'jammer', now: true }]
    },
    seismicSensor: {
        label: 'Seismic sensor', wired: true, radio: false,
        counters: [{ name: 'disable the alarm panel', now: true }, { name: 'disable at the wiring box', now: 'M2' }]
    },
    motionSensor: {
        label: 'Motion sensor', wired: true, radio: false,
        counters: [{ name: 'disable the alarm panel', now: true }, { name: 'disable at the wiring box', now: 'M2' }]
    },
    patrolCar: {
        label: 'Patrol car', wired: false, radio: true,
        counters: [{ name: 'jammer', now: true }, { name: 'take both officers down', now: 'M3' }]
    }
};

/** The Alarm's aftermath (§9.2): when, what raised it, "Police in N" and the heat track (§13.1). */
export interface AlarmResponse {
    /** The turn whose world phase raised it. */
    raised: number;
    by: CarrierKind;
    /** World phases until the police arrive (M3 brings them); 0 once they are due. */
    policeIn: number;
    heat: { level: number; tick: number };
}

declare module '../core/types' {
    interface Rules {
        /** World phases from the Alarm until the police arrive (§9.2; the bank's tier sets it, `worldFromBank`). */
        policeEta: number;
    }
    interface State {
        /** The Alarm's aftermath, or null while it hasn't been raised. */
        response: AlarmResponse | null;
    }
    interface EventMap {
        /** A carrier stopped without raising the Alarm: countered (`why` names the counter) or moot (`alarm`). */
        carrierStopped: { carrier: string; kind: CarrierKind; why: string };
        carrierPaused: { carrier: string; why: string };
        carrierResumed: { carrier: string };
        /** A wired carrier didn't start: the alarm panel is dead (the button does nothing). */
        alarmDead: { source: string; kind: CarrierKind };
        /** Police in N (§9.2), each world phase after the Alarm. */
        policeCountdown: { policeIn: number };
    }
}

registerRuleDefaults({ policeEta: 6 });

registerStateInit('response', (_world, state) => {
    state.response = null;
});

/** Starts a carrier, with no questions asked (see `raiseCarrier` for the rules' way). */
export function startCarrier(ctx: Ctx, carrier: { kind: CarrierKind; source: string; pos: Pos; countdown: number; about?: string; subject?: string; line?: 'landline' }): Carrier {
    const min = ctx.world.rules.minCarrierCountdown;
    if (carrier.countdown < min) throw new InvariantError(`A carrier's countdown is at least ${min}, not ${carrier.countdown}`);
    const { state } = ctx;
    const started: Carrier = {
        id: newId(state, 'carrier'),
        kind: carrier.kind,
        source: carrier.source,
        pos: { x: carrier.pos.x, y: carrier.pos.y },
        countdown: carrier.countdown,
        started: { turn: state.turn, phase: state.phase },
        halted: null
    };
    if (carrier.about !== undefined) started.about = carrier.about;
    if (carrier.subject !== undefined) started.subject = carrier.subject;
    if (carrier.line !== undefined) started.line = carrier.line;
    state.carriers.push(started);
    const event: EventOf<'carrierStarted'> = { type: 'carrierStarted', carrier: started.id, kind: started.kind, countdown: started.countdown, holder: started.source, pos: { ...started.pos } };
    if (started.about !== undefined) event.about = started.about;
    ctx.emit(event);
    return started;
}

/** Whether the bank's alarm panel is dead (§9.1): it has one, and every one is disabled. */
export function panelDead(world: ReadonlyWorld, state: DeepReadonly<State>): boolean {
    const panels = world.objects.filter(o => o.kind === 'alarmPanel');
    return panels.length > 0 && panels.every(p => Object.hasOwn(state.objects, p.id) && state.objects[p.id]!.disabled === true);
}

/** What a rule asks for: a carrier of a kind from a source, at least the minimum countdown unless it says more. */
export interface CarrierRequest { kind: CarrierKind; source: string; pos: Pos; countdown?: number; about?: string; subject?: string; line?: 'landline' }

/** Why a carrier can't start now, or undefined (see the header): the Alarm is up, or a wired one with a dead panel. */
export function carrierBlocked(world: ReadonlyWorld, state: DeepReadonly<State>, kind: CarrierKind): 'alarm' | 'panel' | undefined {
    if (state.bank.alarm) return 'alarm';
    if (CARRIERS[kind].wired && panelDead(world, state)) return 'panel';
    return undefined;
}

/**
 * Starts a carrier the rules' way (see the header): the one every rule calls. Returns the carrier now running for the
 * request (a new one, or the source's own of that kind), or null when it couldn't start.
 */
export function raiseCarrier(ctx: Ctx, request: CarrierRequest): Carrier | null {
    const { world, state } = ctx;
    const blocked = carrierBlocked(world, state, request.kind);
    if (blocked === 'alarm') return null;
    if (blocked === 'panel') {
        ctx.emit({ type: 'alarmDead', source: request.source, kind: request.kind });
        return null;
    }
    // One per source and kind, and per subject: the operator calls in each missing guard on his own.
    const running = state.carriers.find(c => c.source === request.source && c.kind === request.kind && c.subject === request.subject && c.halted !== 'countered');
    if (running) return running;
    const countdown = Math.max(world.rules.minCarrierCountdown, request.countdown ?? 0);
    const out: Parameters<typeof startCarrier>[1] = { kind: request.kind, source: request.source, pos: request.pos, countdown };
    if (request.about !== undefined) out.about = request.about;
    if (request.subject !== undefined) out.subject = request.subject;
    if (request.line !== undefined) out.line = request.line;
    return startCarrier(ctx, out);
}

// ---------------------------------------------------------------------------------------------------------- Counters

/** What a check makes of a running carrier: countered for good, paused for now, or nothing. */
export type CarrierVerdict = { halt: 'countered' | 'paused'; why: string } | null;

export type CarrierCheck = (world: ReadonlyWorld, state: DeepReadonly<State>, carrier: DeepReadonly<Carrier>) => CarrierVerdict;

const CHECKS = new Map<string, CarrierCheck>();

/** Adds a counter that is a standing condition (a dead panel, a jammer, a source down). Checks run by name. */
export function registerCarrierCheck(name: string, check: CarrierCheck): void {
    if (CHECKS.has(name)) throw new Error(`Carrier check '${name}' already exists`);
    CHECKS.set(name, check);
}

/** What the checks make of a carrier now: countered beats paused; the first check by name gives the reason. */
export function carrierVerdict(world: ReadonlyWorld, state: DeepReadonly<State>, carrier: DeepReadonly<Carrier>): CarrierVerdict {
    let paused: CarrierVerdict = null;
    for (const name of [...CHECKS.keys()].sort()) {
        const v = CHECKS.get(name)!(world, state, carrier);
        if (v?.halt === 'countered') return v;
        if (v && !paused) paused = v;
    }
    return paused;
}

/** Stops a carrier for good (a counter that is an action, like answering the radio). */
export function stopCarrier(ctx: Ctx, carrier: Carrier, why: string): void {
    const i = ctx.state.carriers.indexOf(carrier);
    if (i < 0) return;
    ctx.state.carriers.splice(i, 1);
    ctx.emit({ type: 'carrierStopped', carrier: carrier.id, kind: carrier.kind, why });
}

/** Applies every check to every carrier (see the header). Runs after every command and before the devices tick. */
export function settleCarriers(ctx: Ctx): void {
    const { world, state } = ctx;
    for (const carrier of [...state.carriers]) {
        const v = carrierVerdict(world, state, carrier);
        if (v?.halt === 'countered') {
            stopCarrier(ctx, carrier, v.why);
        } else if (v) {
            if (carrier.halted !== 'paused') {
                carrier.halted = 'paused';
                ctx.emit({ type: 'carrierPaused', carrier: carrier.id, why: v.why });
            }
        } else if (carrier.halted === 'paused') {
            carrier.halted = null;
            ctx.emit({ type: 'carrierResumed', carrier: carrier.id });
        }
    }
}

// The source (§9.1 "knock out", "neutralise the operator", "command"): a carrier whose NPC is down or face down is
// countered. Commanded is a counter, not a pause: a lapse that goes for the alarm again starts a fresh carrier at its
// full countdown, telegraphed by its intent (rules/command.ts). Non-NPC sources ('dispatch', 'patrol') pass.
registerCarrierCheck('source', (_world, state, carrier) => {
    const npc = state.npcs.find(n => n.id === carrier.source);
    if (!npc) return null;
    if (npc.status === 'commanded') return { halt: 'countered', why: 'commanded' };
    return neutralised(state, npc) ? { halt: 'countered', why: 'source down' } : null;
});

registerCommandHook('carriers', ctx => settleCarriers(ctx));

// ---------------------------------------------------------------------------------------------------------- Ticking

registerWorldHook('devices', 'devices.carriers', (ctx, phase) => {
    const { state } = ctx;
    settleCarriers(ctx);
    for (const carrier of [...state.carriers]) {
        if (!state.carriers.includes(carrier) || carrier.halted) continue;
        if (carrier.started.turn === phase.turn && carrier.started.phase === 'world') continue;
        carrier.countdown--;
        ctx.emit({ type: 'carrierTicked', carrier: carrier.id, countdown: carrier.countdown });
        if (carrier.countdown > 0) continue;
        state.carriers.splice(state.carriers.indexOf(carrier), 1);
        state.bank.alarm = true;
        ctx.emit({ type: 'alarmRaised', carrier: carrier.id });
        state.response = { raised: phase.turn, by: carrier.kind, policeIn: ctx.world.rules.policeEta, heat: { level: 1, tick: 0 } };
        // The Alarm is one event (§4): whatever else was raising it has nothing left to raise.
        for (const other of [...state.carriers]) stopCarrier(ctx, other, 'alarm');
    }
});

// "Police in N" counts down from the world phase after the Alarm; the arrival itself is M3's.
registerWorldHook('devices', 'devices.police', (ctx, phase) => {
    const r = ctx.state.response;
    if (!r || r.raised === phase.turn || r.policeIn <= 0) return;
    r.policeIn--;
    ctx.emit({ type: 'policeCountdown', policeIn: r.policeIn });
}, { order: 1 });

// ---------------------------------------------------------------------------------------------------------- Previews

/**
 * A carrier as a preview or the ledger names it: "Teller button (2)". `source` and `pos` are null where the crew doesn't
 * know the holder (`projectCarriers`, `knownCarriers`): the carrier shows, not who carries it.
 */
export interface CarrierPreview { kind: CarrierKind; label: string; source: string | null; pos: Pos | null; countdown: number; about?: string }

/** The carriers a command's events started, as they started. */
export function carriersStarted(events: readonly SimEvent[]): CarrierPreview[] {
    const out: CarrierPreview[] = [];
    for (const e of events) {
        if (e.type !== 'carrierStarted') continue;
        const c: CarrierPreview = {
            kind: e.kind, label: CARRIERS[e.kind].label, source: e.holder, pos: e.pos ? { x: e.pos.x, y: e.pos.y } : null, countdown: e.countdown
        };
        if (e.about !== undefined) c.about = e.about;
        out.push(c);
    }
    return out;
}

const PENDING = new WeakMap<State, { world: ReadonlyWorld; found: CarrierPreview[] }>();

/**
 * The carriers the coming world phase starts, from the state as it is (the hatched overlay's carriers, §8.8): the world
 * phase played on a copy by its own reducers, so it is exactly what ending the turn would start. The truth. Cached per
 * state object (states are never changed once a command returns them).
 */
export function pendingCarriers(world: ReadonlyWorld, state: State): CarrierPreview[] {
    let cached = PENDING.get(state);
    if (cached?.world !== world) PENDING.set(state, cached = { world, found: carriersStarted(preview(world, state, { type: 'endTurn' }).events) });
    return cached.found.map(c => ({ ...c, ...(c.pos ? { pos: { ...c.pos } } : {}) }));
}

/** What tells two previews of a carrier apart: a change of countdown or of the crew member counts. */
const key = (c: CarrierPreview): string => `${c.kind} ${c.source} ${c.countdown} ${c.about ?? ''}`;

export interface CarrierChanges {
    /** Started by the command itself. */
    starts: CarrierPreview[];
    /** Stopped by the command (countered), by carrier id with why. */
    stops: { carrier: string; kind: CarrierKind; why: string }[];
    /** Started by the coming world phase because of the command (not without it, or not with that countdown or crew member). */
    worldPhase: CarrierPreview[];
}

/**
 * What a previewed command does to the carriers (§8.8, the action preview's "this would start: Teller button (2)"):
 * those it starts or stops at once, and those the coming world phase would start after it but not before it.
 */
export function carrierPreview(world: ReadonlyWorld, before: State, result: PreviewResult): CarrierChanges {
    const starts = carriersStarted(result.events);
    const stops = result.events.flatMap(e => (e.type === 'carrierStopped' ? [{ carrier: e.carrier, kind: e.kind, why: e.why }] : []));
    if (result.pending) return { starts, stops, worldPhase: [] };
    const had = new Set(pendingCarriers(world, before).map(key));
    const worldPhase = pendingCarriers(world, result.state).filter(c => !had.has(key(c)));
    return { starts, stops, worldPhase };
}

/** Whether the crew may be told who holds a carrier: an NPC it sees or predicts, or no NPC at all (dispatch, the car). */
export const holderKnown = (world: ReadonlyWorld, state: State, source: string | null): boolean =>
    source === null || !world.people.some(p => p.id === source) || isKnownNow(world, state, source);

/**
 * What the player may be shown of carrier previews: every one, with its holder and place redacted (null) where the
 * crew doesn't know the holder, the way `projectEvents` redacts `carrierStarted`.
 */
export function projectCarriers(world: ReadonlyWorld, state: State, carriers: readonly CarrierPreview[]): CarrierPreview[] {
    return carriers.map(c => (holderKnown(world, state, c.source) ? { ...c } : { ...c, source: null, pos: null }));
}

/** A running carrier as the threat ledger shows it (§9.1, §20.3): projected like `projectCarriers`. */
export interface KnownCarrier extends CarrierPreview { id: string; halted: Carrier['halted']; subject?: string }

/** Every running carrier, most urgent first (running before paused, then by countdown, then id), holders projected. */
export function knownCarriers(world: ReadonlyWorld, state: State): KnownCarrier[] {
    const out = state.carriers.map((c): KnownCarrier => {
        const shown = holderKnown(world, state, c.source);
        const k: KnownCarrier = {
            id: c.id, kind: c.kind, label: CARRIERS[c.kind].label, source: shown ? c.source : null, pos: shown ? { x: c.pos.x, y: c.pos.y } : null,
            countdown: c.countdown, halted: c.halted
        };
        if (c.about !== undefined) k.about = c.about;
        if (c.subject !== undefined && holderKnown(world, state, c.subject)) k.subject = c.subject;
        return k;
    });
    const rank = (c: KnownCarrier): number => (c.halted ? 1 : 0);
    return out.sort((a, b) => rank(a) - rank(b) || a.countdown - b.countdown || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

registerEvents({
    carrierStarted: { undoBlocking: true },
    carrierTicked: { undoBlocking: true },
    alarmRaised: { undoBlocking: true },
    carrierStopped: { undoBlocking: true },
    carrierPaused: { undoBlocking: true },
    carrierResumed: { undoBlocking: true },
    alarmDead: { undoBlocking: true },
    policeCountdown: { undoBlocking: true }
});
