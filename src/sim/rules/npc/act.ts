import { registerWorldHook, type Ctx, type WorldPhase } from '../../core/engine';
import { facingToward, tileAt } from '../../core/grid';
import { crewMember } from '../../core/state';
import type { DeepReadonly, Intent, Pos, ReadonlyWorld, State } from '../../core/types';
import { registerEvents } from '../../core/undo';
import { profileRank } from '../../data/items';
import { doorBetween, doorStatus } from '../../geo/move';
import type { Sighting } from '../perceive';
import { crewLook, friskFinds, type CrewLook } from '../profile';
import { expose, isEyesDown, isExposedTo, pipsOf } from '../suspicion';
import { isPresent, worldWalks, type Walked } from './walk';

/*
 * The passive NPCs act (§6.1 step 2): civilians, staff and guards who aren't fighting carry out the intents frozen
 * at the start of the world phase (`WorldPhase.intents`, §6.2), all at once, after perception has judged what they see
 * along them (`perception.world`, order −100) and the trespass deadlines (−90). Never anything decided since.
 *
 * - **Walks** (walk.ts `resolveWalks`): each takes its committed path step by step, opening the doors it walks
 *   through (they swing shut at the end of the phase, doors.ts) and facing along each step, then its committed
 *   facing. A walk stops short only when the world changed under it: a crew member stands on the next tile, or a door
 *   on it was locked or jammed. Perception has judged the whole committed walk either way, as the overlay showed.
 * - **Leaving and coming back**: a walk that ends at the way out with `leave` takes the NPC off the map (status away);
 *   `enter` puts it back on its tile.
 * - **Actions at the end of the walk**: a frisk (an enforcer next to the crew member: anything Concealed Exposes them,
 *   §8.5) and telling a guard (next to them: the guard is Exposed to the crew member too, §8.7). Raising the alarm and
 *   panicking are other packages' (M1-08, M2-02): their hooks run after this one (order > 0) on the same intents.
 *
 * What the actions do to perception is in the hatched overlay too: `npcActSightings` works out the same walks with the
 * crew member on the tile asked about, through the same functions, and `assessWorldPhase` adds what it finds.
 */

declare module '../../core/types' {
    interface EventMap {
        /** An NPC walked `path` from `from` in the world phase (all of its committed path unless it was stopped). */
        npcWalked: { npc: string; from: Pos; path: Pos[] };
        /**
         * An NPC's walk stopped short of its committed path at `at`: the next step, onto `next`, couldn't be taken
         * because of `by`: a crew member or an NPC (by id) on it, a door (by id) or a wall in the way.
         */
        npcBlocked: { npc: string; at: Pos; next: Pos; by: string };
        npcLeft: { npc: string; at: Pos };
        npcEntered: { npc: string; at: Pos };
        /** An enforcer frisked a crew member (§8.5). */
        frisked: { npc: string; crew: string; found: boolean };
        /** An NPC told a guard about a crew member (§8.7). */
        told: { npc: string; guard: string; crew: string };
    }
}

const near = (a: DeepReadonly<Pos>, b: DeepReadonly<Pos>): boolean => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;

/** Whether a frisk finds something on a crew member who looks like `look` (a previewed loadout) or as they are. */
function finds(state: State, crew: string, look?: CrewLook): boolean {
    return look ? profileRank(look.profile) >= profileRank('concealed') : friskFinds(crewMember(state, crew));
}

/** One action's effect on perception: who is Exposed to whom, judged on where everyone ends the walks. */
interface ActEffect { npc: string; crew: string; why: 'frisk' | 'told'; by: string; found: boolean }

function actionEffects(
    state: State, intents: Readonly<Record<string, DeepReadonly<Intent>>>, walked: readonly string[], endOf: (id: string) => Pos | null,
    crewAt: (crew: string) => Pos | null, look?: { crew: string; look: CrewLook }
): ActEffect[] {
    const out: ActEffect[] = [];
    const byId = new Map(state.npcs.map(n => [n.id, n]));
    for (const id of walked) {
        const npc = byId.get(id)!, action = intents[id]?.action, at = endOf(id);
        if (!action || !at || isEyesDown(npc)) continue;
        if (action.kind === 'frisk') {
            const where = crewAt(action.crew);
            if (!where || !near(at, where)) continue;
            out.push({ npc: id, crew: action.crew, why: 'frisk', by: id, found: finds(state, action.crew, look?.crew === action.crew ? look.look : undefined) });
        } else if (action.kind === 'tell') {
            const guard = byId.get(action.npc), there = guard && endOf(guard.id);
            if (!guard || !there || isEyesDown(guard) || !near(at, there)) continue;
            out.push({ npc: guard.id, crew: action.crew, why: 'told', by: id, found: true });
        }
    }
    return out;
}

/** Where an NPC ends the walks: its last step, or where it stands; null if it is (still) away. */
function ends(state: State, walks: readonly Walked[]): (id: string) => Pos | null {
    const byWalk = new Map(walks.map(w => [w.npc, w]));
    const byId = new Map(state.npcs.map(n => [n.id, n]));
    return id => {
        const w = byWalk.get(id), npc = byId.get(id);
        const last = w?.steps[w.steps.length - 1];
        if (last) return last;
        return npc && isPresent(npc) ? npc.pos : null;
    };
}

/**
 * What the NPCs' actions in the coming world phase do to a crew member standing on `tile` (the hatched overlay): a
 * `!` from an enforcer whose frisk finds something, and from a guard who is told about them. Judged with the walks
 * the world phase will take (`resolveWalks`, with the crew member on `tile`), on the NPCs' committed intents.
 */
export function npcActSightings(world: ReadonlyWorld, state: State, crewId: string, tile: Pos, look?: CrewLook): Sighting[] {
    const intents: Record<string, DeepReadonly<Intent>> = {};
    let any = false;
    for (const n of state.npcs) {
        intents[n.id] = n.intent;
        const kind = n.intent.action?.kind;
        if ((kind === 'frisk' || kind === 'tell') && n.intent.action!.crew === crewId) any = true;
    }
    if (!any) return [];
    const walks = worldWalks(world, state, intents, null, { crew: crewId, tile }).walks;
    const walking = walks.map(w => w.npc);
    const endOf = ends(state, walks);
    const crewAt = (crew: string): Pos | null => (crew === crewId ? tile : state.crew.find(c => c.id === crew)?.pos ?? null);
    const seen = look ?? crewLook(crewMember(state, crewId));
    const zone = tileAt(world, tile)!.zone;
    const out: Sighting[] = [];
    for (const e of actionEffects(state, intents, walking, endOf, crewAt, look ? { crew: crewId, look } : undefined)) {
        if (e.crew !== crewId || !e.found) continue;
        const npc = state.npcs.find(n => n.id === e.npc)!, from = endOf(e.npc)!;
        out.push({
            observer: e.npc, by: 'npc', crew: crewId, tile: { x: tile.x, y: tile.y }, from: { x: from.x, y: from.y }, band: null, zone,
            readAs: zone, profile: seen.profile, cell: '!', outcome: '!', why: [e.why], known: isExposedTo(npc, crewId)
        });
    }
    return out;
}

/** Carries out the walks of the passive group (see the header). */
function walk(ctx: Ctx, phase: WorldPhase): void {
    const { world, state } = ctx;
    const walks = worldWalks(world, state, phase.intents, phase.passive).walks;
    const walking = walks.map(w => w.npc);
    const endOf = ends(state, walks);
    const crewAt = (crew: string): Pos | null => state.crew.find(c => c.id === crew)?.pos ?? null;
    // Judged before anyone is moved, like the overlay: on where the walks end.
    const effects = actionEffects(state, phase.intents, walking, endOf, crewAt);
    const byId = new Map(state.npcs.map(n => [n.id, n]));
    for (const w of walks) {
        const npc = byId.get(w.npc)!, intent = phase.intents[w.npc]!;
        if (w.entered) {
            const at = w.steps[0];
            if (!at) continue;
            npc.pos = { x: at.x, y: at.y };
            npc.status = npc.alerted ? 'alerted' : 'calm';
            ctx.emit({ type: 'npcEntered', npc: npc.id, at: { x: at.x, y: at.y } });
            continue;
        }
        const from = { x: npc.pos.x, y: npc.pos.y };
        let prev: Pos = from;
        for (const p of w.steps) {
            const door = Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y) === 1 ? doorBetween(world, prev, p) : undefined;
            if (door) {
                const status = doorStatus(world, state, door.id);
                if (status === 'closed' || status === 'locked') {
                    state.doors[door.id] = { ...state.doors[door.id], status: 'open' };
                    ctx.emit({ type: 'doorOpened', door: door.id, by: npc.id });
                }
            }
            npc.facing = facingToward(prev, p) ?? npc.facing;
            npc.pos = { x: p.x, y: p.y };
            prev = p;
        }
        if (w.steps.length) ctx.emit({ type: 'npcWalked', npc: npc.id, from, path: w.steps.map(p => ({ x: p.x, y: p.y })) });
        if (!w.complete) {
            const next = w.stop?.next ?? intent.path[w.steps.length]!;
            npc.facing = facingToward(npc.pos, next) ?? npc.facing;
            ctx.emit({ type: 'npcBlocked', npc: npc.id, at: { x: npc.pos.x, y: npc.pos.y }, next: { x: next.x, y: next.y }, by: w.stop?.by ?? 'wall' });
            continue;
        }
        if (intent.facing) npc.facing = intent.facing;
        if (intent.action?.kind === 'leave') {
            npc.status = 'away';
            ctx.emit({ type: 'npcLeft', npc: npc.id, at: { x: npc.pos.x, y: npc.pos.y } });
        }
    }
    for (const e of effects) {
        const npc = byId.get(e.npc)!, member = state.crew.find(c => c.id === e.crew);
        if (!member) continue;
        if (e.why === 'frisk') {
            ctx.emit({ type: 'frisked', npc: npc.id, crew: e.crew, found: e.found });
            if (e.found) expose(ctx, npc, e.crew, ['frisk'], member.pos);
            else npc.frisked[e.crew] = pipsOf(npc, e.crew);
        } else {
            const teller = byId.get(e.by)!;
            ctx.emit({ type: 'told', npc: teller.id, guard: npc.id, crew: e.crew });
            if (!teller.reported.includes(e.crew)) teller.reported.push(e.crew);
            const seen = Object.hasOwn(teller.lastSeen, e.crew) ? teller.lastSeen[e.crew]!.tile : member.pos;
            expose(ctx, npc, e.crew, ['told'], seen);
        }
    }
}

registerWorldHook('passiveNpcs', 'npcs.passive', walk);

registerEvents({
    npcWalked: { undoBlocking: false },
    npcBlocked: { undoBlocking: false },
    npcLeft: { undoBlocking: false },
    npcEntered: { undoBlocking: true },
    frisked: { undoBlocking: true },
    told: { undoBlocking: true }
});
