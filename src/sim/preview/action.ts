import { IllegalCommand, type PreviewResult } from '../core/engine';
import type { PendingOdds } from '../core/rng';
import type { CarrierKind, Command, Pos, ReadonlyWorld, SimEvent, State } from '../core/types';
import { eventClass } from '../core/undo';
import type { NoiseKind } from '../data/noise';
import { DEAF_STATUSES, inRing, soundRing, type Ring } from '../geo/sound';
import { carrierPreview, projectCarriers, type CarrierPreview } from '../rules/carriers';
import { hearing } from '../rules/evidence';
import { doorDoubt, doubtStates, narrowDoubt, previewCertain, projectPreviewEvents } from '../rules/knowledge';
import { pathSafety, type PathSafety } from './floor';
import { previewPicture } from './picture';

/*
 * The preview of any command (§8.8, §8.9, §20.2 step 3), as the player may see it. The command is previewed on the
 * truth with every door the crew can't vouch for shut (`previewCertain`: the same reducer on a copy; decision 44) and
 * everything shown is projected through what the crew knows (`projectPreviewEvents`, `projectCarriers`): events naming
 * NPCs or cameras it doesn't know are dropped, a carrier's unknown holder is redacted, a move cut short by someone
 * unseen or by a door found locked shows along the drawn path. Sight and hearing only grow as doors open, so what is
 * seen or heard with those doors shut is seen or heard however they stand: a sighting through one never shows, a
 * certain one always does, and a preview never tells how such a door really stands. A known NPC whose walk in a
 * previewed world phase one could stop counts as unknown for it (`projectEvents`).
 *
 * - **Noise** (§8.9): every noise's ring (the tiles it reaches, the doors the crew can't vouch for shut) and an ear per
 *   NPC the crew knows inside it, labelled with what it will do (`hearing`, the function the noise hook applies, judged among
 *   the NPCs the crew knows; `still` for one face down). When a door the crew can't vouch for could change who of them
 *   hears it, or how loud, who is sent isn't certain: no ear is marked sent (`sentUnsure`).
 * - **Witnesses**: who would notice (Exposed, pips, a challenge, a camera report, or seeing it at all).
 * - **Carriers** (§9.1): those the command starts or stops at once, and those the coming world phase would start
 *   because of it (`carrierPreview`).
 * - **Undoable** as far as the crew can tell: nothing it would be told blocks undo. The commit can still turn out final
 *   (something new comes into view, or someone unseen noticed: `noticedUnseen`).
 * - Moves and dashes also carry their `pathSafety`.
 */

export interface Ear {
    npc: string;
    /** The badge: what it moves to; `still` for someone face down (commanded, tied), who hears but doesn't react. */
    status: 'curious' | 'investigating' | 'alerted' | 'still';
    /** It is the one who goes to look (quiet) or reports it (loud). */
    sent: boolean;
}

export interface NoisePreview {
    kind: NoiseKind;
    cause: string;
    radius: number;
    sources: Pos[];
    /** Every tile the sound reaches (the ring as drawn). */
    tiles: Pos[];
    ears: Ear[];
    /** Who is sent could change with a door the crew can't vouch for: none of `ears` is marked sent. */
    sentUnsure?: boolean;
}

export interface Witness {
    observer: string;
    by: 'npc' | 'camera';
    crew: string;
    what: 'exposed' | 'pips' | 'challenge' | 'camera' | 'seen';
    pips?: number;
}

export type ActionPreview =
    | { ok: false; reason: string }
    | {
        ok: true;
        /** Projected events, in order. */
        events: SimEvent[];
        noises: NoisePreview[];
        witnesses: Witness[];
        carriers: { starts: CarrierPreview[]; stops: { carrier: string; kind: CarrierKind; why: string }[]; worldPhase: CarrierPreview[] };
        undoable: boolean;
        /** Actions it spends. */
        cost: number;
        /** A roll it stops at (the odds shown, rolled on confirm). */
        odds?: PendingOdds;
        path?: PathSafety;
    };

function witnessesOf(events: readonly SimEvent[]): Witness[] {
    const out: Witness[] = [];
    const put = (w: Witness): void => {
        const i = out.findIndex(o => o.observer === w.observer && o.crew === w.crew);
        const rank = { seen: 0, pips: 1, challenge: 2, camera: 3, exposed: 4 } as const;
        if (i < 0) out.push(w);
        else if (rank[w.what] > rank[out[i]!.what]) out[i] = w;
        else if (w.what === 'pips' && out[i]!.what === 'pips') out[i]!.pips = (out[i]!.pips ?? 0) + (w.pips ?? 0);
    };
    for (const e of events) {
        if (e.type === 'exposed') put({ observer: e.npc, by: 'npc', crew: e.crew, what: 'exposed' });
        else if (e.type === 'suspicionRaised') put({ observer: e.npc, by: 'npc', crew: e.crew, what: 'pips', pips: e.added });
        else if (e.type === 'challenged') put({ observer: e.npc, by: 'npc', crew: e.crew, what: 'challenge' });
        else if (e.type === 'cameraSaw') put({ observer: e.camera, by: 'camera', crew: e.crew, what: 'camera' });
        else if (e.type === 'perceptionCheck') put({ observer: e.npc, by: 'npc', crew: e.crew, what: 'seen' });
    }
    return out;
}

/** How loud a ring is at `p` (-1: not heard). */
const loudness = (ring: Ring, p: Pos): number => (inRing(ring, p) ? ring.byIndex.get(p.y * ring.width + p.x)!.remaining : -1);

function noisesOf(world: ReadonlyWorld, before: State, result: PreviewResult, shown: readonly SimEvent[]): NoisePreview[] {
    const picture = previewPicture(world, before), doubt = doorDoubt(world, before);
    // The doubted doors still shut after the command, open and shut: a sound reaches no further than the one, no less than the other.
    const left = doubt && narrowDoubt(world, doubt, result.state), states = left ? doubtStates(world, result.state, left) : null;
    const out: NoisePreview[] = [];
    for (const e of shown) {
        if (e.type !== 'noise') continue;
        // The truth's event for the same noise: who could hear it then (a knocked-out victim no longer can).
        const truth = result.events.find(t => t.type === 'noise' && t.cause === e.cause) as Extract<SimEvent, { type: 'noise' }> | undefined;
        // Drawn as it is heard: the doors the crew can't vouch for shut (`previewCertain`), so they never show through it.
        const ring = soundRing(world, result.state, e.sources, e.radius);
        const able = new Set(truth?.heard ?? e.heard);
        const listeners: State = { ...picture, npcs: picture.npcs.filter(n => !inRing(ring, n.pos) || able.has(n.id)) };
        const react = new Map(hearing(world, listeners, ring, e.kind, e.cause).map(h => [h.npc, h]));
        let unsure = false;
        if (states) {
            const open = soundRing(world, states.open, e.sources, e.radius), shut = soundRing(world, states.shut, e.sources, e.radius);
            // Only those who could hear count: the picture keeps the unknown at their real tiles, marked 'away'.
            unsure = picture.npcs.some(n => !DEAF_STATUSES.has(n.status) && loudness(open, n.pos) !== loudness(shut, n.pos));
        }
        const ears = e.heard.map((npc): Ear => {
            const h = react.get(npc);
            return h ? { npc, status: h.status, sent: h.sent && !unsure } : { npc, status: 'still', sent: false };
        });
        out.push({
            kind: e.kind, cause: e.cause, radius: e.radius, sources: e.sources.map(p => ({ ...p })), tiles: ring.tiles.map(t => ({ x: t.pos.x, y: t.pos.y })), ears,
            ...(unsure ? { sentUnsure: true } : {})
        });
    }
    return out;
}

/** What the player sees before confirming `cmd` (see the header). */
export function actionPreview(world: ReadonlyWorld, state: State, cmd: Command): ActionPreview {
    let result: PreviewResult;
    try {
        result = previewCertain(world, state, cmd);
    } catch (e) {
        if (e instanceof IllegalCommand) return { ok: false, reason: e.message };
        throw e;
    }
    const events = projectPreviewEvents(world, state, result);
    const changes = carrierPreview(world, state, result);
    const crew = 'crew' in cmd && typeof cmd.crew === 'string' ? cmd.crew : null;
    const before = crew ? state.crew.find(c => c.id === crew) : undefined, after = crew ? result.state.crew.find(c => c.id === crew) : undefined;
    const out: ActionPreview = {
        ok: true,
        events,
        noises: noisesOf(world, state, result, events),
        witnesses: witnessesOf(events),
        carriers: { starts: projectCarriers(world, state, changes.starts), stops: changes.stops, worldPhase: projectCarriers(world, state, changes.worldPhase) },
        undoable: !result.pending && !events.some(e => eventClass(e.type).undoBlocking),
        cost: before && after ? before.actionsLeft - after.actionsLeft : 0
    };
    if (result.pending) out.odds = result.pending;
    if ((cmd.type === 'move' || cmd.type === 'dash') && crew) out.path = pathSafety(world, state, crew, cmd.path, { mode: cmd.type });
    return out;
}
