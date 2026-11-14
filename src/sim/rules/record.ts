import { registerCommandHook } from '../core/engine';
import { edgeBetween, edgeKey, tileAt } from '../core/grid';
import type { DeepReadonly, Pos, ReadonlyWorld, State } from '../core/types';
import { registerMoveHook } from '../crew/movement';
import { doorStatus } from '../geo/move';
import { inBuilding } from './actions/loot';
import { filmedCrew } from './cameras';
import { panelDead } from './carriers';
import { crewProfile } from './profile';
import './recordState';

/*
 * The heist's record for the debrief (GAME_DESIGN §15.5, §19.7, §19.8; implementation plan M6-05): what the rules
 * note as the heist is played that the debrief reads at its end and nothing in play does. Plain JSON in
 * `State.record`, written by the rules alone, so a preview of a command writes it as the command would.
 *
 * - **Witnesses** (§19.7): an NPC who sees an unmasked crew member commit an illegal act (a `!` sighting of an
 *   illegal act, perceive.ts `applySightings`) is noted with them. At the debrief a witness still alive has reached the
 *   police (an escapee, a hostage let go, a survivor: decision 521): that crew member gains Notoriety.
 * - **Footage** is the cameras' (`State.footage`, rules/cameras.ts): `filmedCrew`, none once the recorder is taken or
 *   smashed.
 * - **The styles** (§19.8, `stylesEarned`): the Alarm never raised (Ghost); the alarm panel dead as the first Heavy
 *   crew member stands in the building (Inside Job, decided then: `insideJob`); nobody dead, crew, NPC or officer
 *   (Clean Hands); the first crew member into the building came through a hole in a wall or a breached door (Cowboys:
 *   `wayIn`); two police assaults run to their end with crew still up on the map (Fortress: `assaultsHeld`); every
 *   kill, at least one, dealt by a crew member standing in the sniper nest (Overwatch: `kills`); no check-in missed and
 *   no lost contact, and nobody ran off the map (Smooth Operator: `missed`, `escapees`); at least twice the target
 *   out (Greedy). Decision 522.
 */

/** The styles of §19.8, in the order the debrief lists them. */
export const STYLE_IDS = ['ghost', 'insideJob', 'cleanHands', 'cowboys', 'fortress', 'overwatch', 'smoothOperator', 'greedy'] as const;
export type StyleId = (typeof STYLE_IDS)[number];

/** Whether a crew member is Heavy (§7.4) and in the building. */
const heavyInside = (world: ReadonlyWorld, state: DeepReadonly<State>): boolean =>
    state.crew.some(c => !c.wounds.dead && inBuilding(world, c.pos) && crewProfile(c) === 'heavy');

// The way in: the first step from outside the building into it, through a hole in a wall or a breached door, or not.
// And Inside Job, step by step: a Heavy crew member whose one move goes in and out again has stood inside.
registerMoveHook('record', {
    step(ctx, member, path, index, _mode, from) {
        const { world, state } = ctx;
        if (state.record.insideJob === null && !member.wounds.dead && crewProfile(member) === 'heavy' && inBuilding(world, path[index]!)) {
            state.record.insideJob = panelDead(world, state);
        }
        if (state.record.wayIn !== null) return;
        const prev = index === 0 ? from : path[index - 1]!, now = path[index]!;
        if (inBuilding(world, prev) || !inBuilding(world, now) || Math.abs(prev.x - now.x) + Math.abs(prev.y - now.y) !== 1) return;
        const key = edgeKey(edgeBetween(prev, now)), edge = state.edges[key], door = world.edges[key]?.door;
        state.record.wayIn = edge?.gap === true || (door !== undefined && doorStatus(world, state, door) === 'breached') ? 'breach' : 'door';
    }
});

registerCommandHook('record', (ctx, _cmd, events, before) => {
    const { world, state } = ctx;
    const r = state.record;
    // Anyone in the building some other way (a start inside, a climb): not through a breach.
    if (r.wayIn === null && state.crew.some(c => inBuilding(world, c.pos))) r.wayIn = 'door';
    if (r.insideJob === null && heavyInside(world, state)) r.insideJob = panelDead(world, before);
    for (const e of events) {
        if (e.type === 'checkInMissed' || e.type === 'dispatchLostContact') r.missed += 1;
        if (e.type !== 'npcLeft' || r.escapees.includes(e.npc)) continue;
        const was = before.npcs.find(n => n.id === e.npc);
        if (!was) continue;
        const running = was.status === 'panicked' || was.lapse?.kind === 'flee' || (was.lapse?.kind === 'released' && was.lapse.freed !== undefined)
            || before.carriers.some(c => c.kind === 'escapee' && c.source === e.npc);
        if (running) r.escapees.push(e.npc);
    }
    const crewUp = state.crew.some(c => !c.wounds.dead && c.wounds.downed === null && tileAt(world, c.pos) !== undefined && c.aboard === null);
    if (before.police.mode?.kind === 'assault' && state.police.mode?.kind !== 'assault' && state.outcome === null && crewUp) r.assaultsHeld += 1;
}, { order: 50 });

/** Every crew member on the job, wherever they are now: in the bank, away, or in custody. */
const everyone = (state: DeepReadonly<State>) => [...state.crew, ...state.escaped.map(e => e.crew), ...state.custody.map(c => c.crew)];

/** The crew members seen unmasked committing an illegal act by a witness still alive (§19.7, decision 521). */
export function witnessedCrew(state: DeepReadonly<State>): string[] {
    const alive = new Set(state.npcs.filter(n => n.status !== 'dead').map(n => n.id));
    return [...new Set(state.record.witnesses.filter(w => alive.has(w.npc)).map(w => w.crew))].sort();
}

/** Whether a tile is in one of the crew's sniper nests. */
const inNest = (world: ReadonlyWorld, p: DeepReadonly<Pos>): boolean => {
    const room = tileAt(world, p)?.room ?? null;
    return room !== null && (world.nests ?? []).includes(room);
};

/** The styles the heist earned so far (§19.8), in `STYLE_IDS` order (see the header). */
export function stylesEarned(world: ReadonlyWorld, state: DeepReadonly<State>): StyleId[] {
    const r = state.record;
    const value = state.outcome?.value ?? 0, target = world.rules.contractTarget;
    const nobodyDied = !state.npcs.some(n => n.status === 'dead') && !everyone(state).some(c => c.wounds.dead) && state.heat.policeKilled === 0;
    const earned: Record<StyleId, boolean> = {
        ghost: !state.bank.alarm,
        insideJob: r.insideJob ?? panelDead(world, state),
        cleanHands: nobodyDied,
        cowboys: r.wayIn === 'breach',
        fortress: r.assaultsHeld >= 2,
        overwatch: r.kills.length > 0 && r.kills.every(k => inNest(world, k.at)),
        smoothOperator: r.missed === 0 && r.escapees.length === 0,
        greedy: target > 0 && value >= 2 * target
    };
    return STYLE_IDS.filter(s => earned[s]);
}

/** What the debrief takes from a heist (§15.5, §19.7, §19.8): the styles earned, who a witness saw, who is on tape. */
export interface HeistReport {
    styles: StyleId[];
    witnessed: string[];
    filmed: string[];
}

/** The heist's report as it stands (at its end: the debrief's). */
export function heistReport(world: ReadonlyWorld, state: DeepReadonly<State>): HeistReport {
    return { styles: stylesEarned(world, state), witnessed: witnessedCrew(state), filmed: filmedCrew(world, state) };
}
