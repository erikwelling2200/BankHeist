import { registerWorldHook, type Ctx, type WorldPhase } from '../core/engine';
import { facingToward, samePos } from '../core/grid';
import { sortedIds } from '../core/json';
import { registerRuleDefaults } from '../core/state';
import type { CrewState, DeepReadonly, DoorDef, DoorStatus, NpcState, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { HALF_STEPS_PER_TILE } from '../data/movement';
import { NOISES } from '../data/noise';
import { BREACH_FROM, COMBAT_SIGHT, OFFICER_STATS, ROUTINE_KINDS } from '../data/police';
import { SUPPRESSED_AIM, weaponDef } from '../data/weapons';
import { lineOfSight, sightMap } from '../geo/los';
import { doorBetween, doorStatus, occupancy, pathTo, reachable, stepCost, type MoveOptions } from '../geo/move';
import { coverAgainst, shotFabric, shotMap } from '../geo/shot';
import { makeNoise } from '../geo/sound';
import { previewShot } from '../preview/shot';
import { NOISE_OF, suppressReact, watchReact } from './actions/attack';
import { inReach } from './actions/act';
import { besideDoor } from './actions/door';
import { dealHarm, registerHarmHandler } from './damage';
import { heatNow } from './heat';
import { releaseExit } from './negotiation';
import { isPresent, npcCanPass, paceBudget, personOf } from './npc/walk';
import { draggedBy } from './place';
import { policeDown, policeHit, type PoliceUnit } from './police';
import { leanOptions, resolveShot, shotRefusal, type Shot } from './shot';
import { alertNpc } from './suspicion';
import { isDown } from './wounds';
import { isWounded } from './woundsState';

/*
 * The police and guard routine (GAME_DESIGN §13.5, §13.6 "Patrol officers and guards", §10.10; implementation plan
 * M3-05, decisions 150–161). In the world phase's combat step, after the passive NPCs, the fighters act one at a time:
 * Hostile NPCs (a guard or an armed civilian who drew, §10.9) in resolution order, then the officers out on scene in
 * the order they came (`State.police.units`). Each decides when it acts, from what it knows then (§13.6: nothing of a
 * firefight is previewed but the breaches).
 *
 * - **What the police know** (`PoliceState.known`, by crew member: a tile, a turn, whether down): what any officer sees
 *   (all round, `COMBAT_SIGHT` tiles, in line of sight; a crew member is someone they shoot at once masked or already
 *   known), shared over the radio, and the reports of hostages let go or freed and of escapees (rules/negotiation.ts
 *   `reports`), newer over older. An officer who sees a known tile empty forgets it. A guard knows what it saw
 *   (`NpcState.lastSeen`). Noises and blood trails are deferred.
 * - **The routine**, every world phase (§13.6):
 *   1. Hurt (half their hit points or less): fall back out of sight of every crew member they know of, and stay there.
 *   2. A crew member up in sight: move to the nearest tile, cover first, that has a clean shot at the nearest one, and
 *      shoot them, leaning from a corner if need be. Officers move only in Assault; in Contain and Regroup they fire
 *      from where they stand; in Negotiate they hold fire (shooting them starts an Assault at once, rules/police.ts).
 *   3. None in sight (Assault only, for officers): advance on the nearest crew member down they know of (to arrest
 *      them, rules/wounds.ts), else the nearest last known position, the shortest way.
 * - **Never through a standing non-crew body** (§13.5, §10.7): a shot is fired only if its preview (`previewShot`, the
 *   fan of every bullet's arc) meets no one but the crew: not a hostage, a bystander, a hostage led as a shield, nor
 *   another officer. With no such shot from anywhere in reach, they don't fire (`heldFire`) and reposition next phase.
 * - **Shots** go through `resolveShot` and every hit through `dealHarm`, as the crew's do. Officers fire their kind's
 *   gun (`OFFICER_STATS`, §12.3) with rounds to spare; a guard fires its own (`NpcState.ammo`) and reloads when empty
 *   (its act). Suppressed, a fighter aims ×1.5 (§11.9). Moving first gives the moving penalty.
 * - **Reactions**: each step a fighter takes calls the crew's Watch (`watchReact`) and a suppressor's reaction shot
 *   (`suppressReact`), and so does every act before it resolves (firing, breaching, freeing, reloading; decision 159);
 *   a fighter downed by one stops there.
 * - **Officers take harm** like anyone (rules/shot.ts makes them bodies, armour by kind): their hit points, `policeHit`
 *   on any hit (Negotiate ends), `policeDown` at 0.
 * - **Freeing hostages** (§10.10): an officer ending its move beside a Commanded hostage frees it for free, every such
 *   one; a tied one takes its action (only if it didn't fire). Freed, a hostage walks out to the nearest way out (the
 *   `released` lapse with `freed`), counts as escaping to the police (+1, rules/heat.ts) and tells them what it saw. One
 *   led by a crew member, or kept by a Hold this phase (§10.3, the counter §10.10 names), isn't free to go.
 * - **Breaches** (§13.4, §13.6): from Heat 3 in Assault, an officer whose way to its goal runs through a locked door
 *   stops beside it and announces the breach (`State.police.breaches`, `breachAnnounced`), shown through the crew
 *   phase; in the next world phase it blows the door (breached, a loud noise) as its act. Its breacher down, the breach
 *   is called off at once (rules/police.ts `policeDown`). Nothing is breached that wasn't announced a phase before.
 *   At Heat 1–2 they use open or unlocked doors only.
 * - **Arrests** stay rules/wounds.ts's: an officer that walks up to a downed crew member arrests them in the next
 *   world phase, having stood there through a crew phase (`PoliceUnit.moved`).
 */

declare module '../core/types' {
    interface Rules {
        /** How far an officer moves in a world phase before it fires (§13.6), in tiles. */
        officerMoveTiles: number;
    }
    interface EventMap {
        /** An officer walked `path` from `from` (one step at a time: reactions may fire between). */
        policeMoved: { unit: string; from: Pos; path: Pos[] };
        /** A fighter (an officer or a Hostile NPC) fired at a crew member (the bullets are `shotFired`'s). */
        fighterFired: { shooter: string; target: string; weapon: string; bullets: number; at: Pos };
        /**
         * A fighter had a crew member in sight but didn't fire: out of its gun's range, no line of fire, no shot the
         * rules allow from anywhere it could stand, or someone not of the crew standing in the way (§13.5): `why`, with
         * `blockers` those in the way; the player is told `why` only when they know every blocker (rules/knowledge.ts).
         */
        heldFire: { shooter: string; target: string; why?: HoldReason; blockers?: string[] };
        /** A Hostile NPC put a fresh magazine in. */
        npcReloaded: { npc: string };
        /** An officer lost hit points; `hurt` at half or less. */
        officerWounded: { unit: string; hp: number; hurt: boolean };
        /** An officer freed a hostage (§10.10): it walks out at `exit`; `cut` when it was tied. */
        hostageFreed: { npc: string; unit: string; exit: Pos; cut: boolean };
        /** "Breach next phase" (§13.6): `unit` will blow `door` in the next world phase. */
        breachAnnounced: { door: string; unit: string };
        /** An officer blew a door it announced. */
        doorBreached: { door: string; unit: string };
        /** An announced breach won't happen: its breacher is down. */
        breachCalledOff: { door: string; unit: string };
    }
}

registerRuleDefaults({ officerMoveTiles: 4 });

/** Why a fighter held its fire, the reason nearest to firing over every place it could fire from. */
export type HoldReason = 'range' | 'sight' | 'refused' | 'body';
const HOLD_RANK: Readonly<Record<HoldReason, number>> = { range: 0, sight: 1, refused: 2, body: 3 };

/**
 * At most this many shots are previewed for one act (each tile, and each lean from it, that has a line of fire), nearest
 * first: a preview traces the fan, so this bounds the work of one fighter's act.
 */
const SHOT_TRIES = 24;

// ---------------------------------------------------------------------------------------------------------- Fighters

/** One who acts in the combat step: a Hostile NPC or an officer out on scene. */
type Fighter = { kind: 'npc'; id: string; npc: NpcState } | { kind: 'police'; id: string; unit: PoliceUnit };

const posOf = (f: Fighter): Pos => (f.kind === 'npc' ? f.npc.pos : f.unit.pos!);

/** Whether a fighter can still act: an NPC Hostile and up, an officer still on the force. */
function standing(state: State, f: Fighter): boolean {
    if (f.kind === 'police') return state.police.units.includes(f.unit) && f.unit.pos !== null;
    return f.npc.status === 'hostile' && isPresent(f.npc) && f.npc.stashed === null;
}

/** Half their hit points or less (§13.6 "If Hurt"). */
function hurt(world: ReadonlyWorld, f: Fighter): boolean {
    return f.kind === 'npc' ? isWounded(world, f.npc) : f.unit.hp * 2 <= OFFICER_STATS[f.unit.kind].hp;
}

/** The gun a fighter fires, or null (an officer of no fighting kind, an NPC with nothing to shoot). */
function gunOf(f: Fighter): string | null {
    return f.kind === 'npc' ? f.npc.ammo?.weapon ?? null : OFFICER_STATS[f.unit.kind].weapon;
}

const suppressedNow = (f: Fighter, phase: WorldPhase): boolean => {
    const s = f.kind === 'npc' ? f.npc.suppressed : f.unit.suppressed;
    return !!s && s.turn === phase.turn;
};

/** Where a crew member is hit and seen: the lean tile while leaning, else where they stand. */
const hitbox = (member: DeepReadonly<CrewState>): Pos => ({ ...(member.leaning?.at ?? member.pos) });

/** Whether a fighter takes a crew member for one of the crew (decision 151): masked, or already known to it. */
function marked(state: State, f: Fighter, member: DeepReadonly<CrewState>): boolean {
    if (member.loadout.masked) return true;
    if (f.kind === 'police') return Object.hasOwn(state.police.known, member.id);
    return f.npc.exposedTo.includes(member.id) || Object.hasOwn(f.npc.lastSeen, member.id);
}

/** Whether `from` sees `to` in combat (all round, `COMBAT_SIGHT` tiles, line of sight). */
function seesTile(world: ReadonlyWorld, state: State, from: Pos, to: Pos): boolean {
    const dx = to.x - from.x, dy = to.y - from.y;
    return dx * dx + dy * dy <= COMBAT_SIGHT * COMBAT_SIGHT && lineOfSight(sightMap(world, state), from, to);
}

/** The crew members a fighter sees now, from its tile or leaning out past a corner, and takes for the crew; not dead. */
function inSight(world: ReadonlyWorld, state: State, f: Fighter): CrewState[] {
    const eyes = [posOf(f), ...leanOptions(world, state, f.id).map(l => l.at)];
    // Aboard a vehicle with its doors shut nobody sees or shoots them (§14.4, M3-08).
    return state.crew.filter(c => !c.wounds.dead && !c.aboard && marked(state, f, c) && eyes.some(e => seesTile(world, state, e, hitbox(c))));
}

/** Writes what a fighter sees into what its side knows: the police's shared picture, or a guard's own. */
function look(ctx: Ctx, f: Fighter): void {
    const { world, state } = ctx, seen = inSight(world, state, f);
    if (f.kind === 'npc') {
        for (const c of seen) f.npc.lastSeen[c.id] = { tile: { ...c.pos }, turn: state.turn };
        return;
    }
    const known = state.police.known, from = posOf(f);
    for (const c of seen) known[c.id] = { tile: { ...c.pos }, turn: state.turn, down: isDown(c) };
    // A known tile in sight with nobody of the crew there: they have moved on, as of now (an older report won't say
    // otherwise, `hear`).
    for (const id of sortedIds(known)) {
        const k = known[id]!;
        if (seen.some(c => c.id === id) || !k.tile) continue;
        if (seesTile(world, state, from, k.tile)) known[id] = { tile: null, turn: state.turn, down: false };
    }
}

/**
 * The reports of hostages and escapees, folded into what the police know: only a sighting newer than what they have,
 * so a report never brings back a place an officer has since seen empty.
 */
function hear(state: State): void {
    const known = state.police.known;
    for (const report of state.negotiation.reports) for (const s of report.seen) {
        if (!state.crew.some(c => c.id === s.crew)) continue;
        const had = Object.hasOwn(known, s.crew) ? known[s.crew]! : undefined;
        if (!had || had.turn < s.turn) known[s.crew] = { tile: { ...s.tile }, turn: s.turn, down: false };
    }
}

// ---------------------------------------------------------------------------------------------------------- Moving

/** The doors a fighter may walk through, opening them: an officer any closed one, a guard as it may in peace. */
function passDoor(world: ReadonlyWorld, f: Fighter): (door: DeepReadonly<DoorDef>, status: DoorStatus) => boolean {
    if (f.kind === 'npc') return npcCanPass(world, personOf(world, f.id), f.npc);
    return (door, status) => door.lock !== 'vault' && status === 'closed';
}

const moveOptions = (world: ReadonlyWorld, f: Fighter): MoveOptions => ({ mover: f.id, canPassDoor: passDoor(world, f) });

/** A fighter's move in one act, in half-steps. */
const budgetOf = (world: ReadonlyWorld, f: Fighter): number =>
    (f.kind === 'npc' ? paceBudget(world, 'hurry') : world.rules.officerMoveTiles * HALF_STEPS_PER_TILE);

/**
 * Walks a fighter along `path` a step at a time, opening the doors it passes, each step answered by the crew's Watch
 * and a suppressor's reaction. Stops when it is downed. Whether it is still standing.
 */
function walk(ctx: Ctx, phase: WorldPhase, f: Fighter, path: readonly Pos[]): boolean {
    const { world, state } = ctx;
    for (const p of path) {
        const from = posOf(f);
        const door = Math.abs(p.x - from.x) + Math.abs(p.y - from.y) === 1 ? doorBetween(world, from, p) : undefined;
        // As the passive NPCs' walk (npc/act.ts): a closed door is opened, a locked one it may pass (a guard's key) too.
        const status = door ? doorStatus(world, state, door.id) : undefined;
        if (door && (status === 'closed' || status === 'locked')) {
            state.doors[door.id] = { ...state.doors[door.id], status: 'open' };
            ctx.emit({ type: 'doorOpened', door: door.id, by: f.id });
        }
        if (f.kind === 'npc') {
            f.npc.facing = facingToward(from, p) ?? f.npc.facing;
            f.npc.pos = { x: p.x, y: p.y };
            f.npc.leaning = null;
            ctx.emit({ type: 'npcWalked', npc: f.id, from: { ...from }, path: [{ x: p.x, y: p.y }] });
        } else {
            f.unit.pos = { x: p.x, y: p.y };
            f.unit.leaning = null;
            f.unit.moved = phase.turn;
            ctx.emit({ type: 'policeMoved', unit: f.id, from: { ...from }, path: [{ x: p.x, y: p.y }] });
        }
        watchReact(ctx, phase, f.id);
        suppressReact(ctx, phase, f.id);
        if (!standing(state, f)) return false;
    }
    return true;
}

/** The steps of `path` a fighter takes within `budget`, cut back to the last tile it may stop on. */
function within(world: ReadonlyWorld, state: State, f: Fighter, path: readonly Pos[], budget: number): Pos[] {
    const people = occupancy(world, state, { mover: f.id });
    let at = posOf(f), cost = 0, end = 0;
    const out: Pos[] = [];
    for (const p of path) {
        const c = stepCost(world, state, at, p, moveOptions(world, f));
        if (c === undefined || cost + c > budget || people.get(p.y * world.width + p.x) === 'blocking') break;
        cost += c;
        out.push(p);
        if ((people.get(p.y * world.width + p.x) ?? 'none') === 'none') end = out.length;
        at = p;
    }
    return out.slice(0, end);
}

const chebyshev = (a: Pos, b: Pos): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * Advances a fighter toward `goal` (§13.6 step 2): the shortest way to a tile beside it, as far as its move goes. An
 * officer allowed to breach plans through locked doors too, and stops beside the first one on its way, announcing the
 * breach. Whether it is still standing.
 */
function advance(ctx: Ctx, phase: WorldPhase, f: Fighter, goal: Pos, breach: boolean): boolean {
    const { world, state } = ctx, from = posOf(f);
    if (chebyshev(from, goal) <= 1) return true;
    const pass = passDoor(world, f);
    const plan: MoveOptions = { mover: f.id, canPassDoor: (door, status) => pass(door, status) || (breach && door.lock !== 'vault' && status === 'locked') };
    const far = (world.width + world.height) * 4 * HALF_STEPS_PER_TILE;
    const reach = reachable(world, state, from, far, plan, t => t.canEnd && chebyshev(t.pos, goal) <= 1);
    const route = reach.stopped && pathTo(reach, reach.stopped.pos);
    if (!route?.length) return true;
    const steps = within(world, state, f, route, budgetOf(world, f));
    const alive = walk(ctx, phase, f, steps);
    if (!alive || f.kind !== 'police' || !breach) return alive;
    // Stopped short of a locked door on the way: beside it, the breach is announced for the next world phase.
    const at = posOf(f), next = route[steps.length];
    const door = next && Math.abs(next.x - at.x) + Math.abs(next.y - at.y) === 1 ? doorBetween(world, at, next) : undefined;
    if (door && doorStatus(world, state, door.id) === 'locked' && besideDoor(world, door, at) && !state.police.breaches.some(b => b.door === door.id)) {
        state.police.breaches.push({ door: door.id, unit: f.id, turn: phase.turn });
        ctx.emit({ type: 'breachAnnounced', door: door.id, unit: f.id });
    }
    return true;
}

/** Falls back out of sight of every crew position it knows (§13.6 step 3): the nearest such tile in its move. */
function fallBack(ctx: Ctx, phase: WorldPhase, f: Fighter, threats: readonly Pos[]): void {
    const { world, state } = ctx;
    const seen = (p: Pos): boolean => threats.some(t => seesTile(world, state, t, p));
    if (!seen(posOf(f))) return;
    const reach = reachable(world, state, posOf(f), budgetOf(world, f), moveOptions(world, f));
    const to = reach.tiles.find(t => t.canEnd && t.cost > 0 && !seen(t.pos));
    const path = to && pathTo(reach, to.pos);
    if (path) walk(ctx, phase, f, path);
}

// ---------------------------------------------------------------------------------------------------------- Shooting

/**
 * Whether a fighter's shot spares every standing non-crew body (§13.5, §10.7): its preview (`previewShot`: every
 * bullet's arc, through what it can break) meets only crew. Lying people are passed over unless aimed at, so only the
 * standing (and a hostage held up as a shield) count.
 */
export function cleanShot(world: ReadonlyWorld, state: DeepReadonly<State>, shot: Shot): boolean {
    return blockersOf(world, state, shot).length === 0;
}

/** Who stands in a shot's way: the non-crew bodies its preview meets. */
const blockersOf = (world: ReadonlyWorld, state: DeepReadonly<State>, shot: Shot): string[] => previewShot(world, state, shot).bodies.filter(b => !b.crew).map(b => b.id);

/**
 * A budget of shot previews (`SHOT_TRIES`) one act may spend, and who stood in the way of those it previewed (what
 * `heldFire` names, so the player is told why only when they see the one in the way).
 */
interface Tries { left: number; blockers: string[] }

/**
 * The shot a fighter would fire from where it stands now at `target`, leaning if it must; or why it can't. Each shot
 * previewed spends one of `tries`; none left, it stops looking.
 */
function shotFrom(world: ReadonlyWorld, state: State, f: Fighter, phase: WorldPhase, target: CrewState, moved: boolean, tries: Tries): Shot | HoldReason {
    const weapon = gunOf(f);
    if (!weapon) return 'refused';
    const w = weaponDef(weapon), at = hitbox(target), from = posOf(f);
    const bullets = f.kind === 'npc' ? Math.min(w.bullets, f.npc.ammo!.loaded) : w.bullets;
    if (bullets < 1) return 'refused';
    const base: Shot = { shooter: f.id, weapon, at, target: target.id, bullets, moved };
    if (suppressedNow(f, phase)) base.aimFactor = SUPPRESSED_AIM;
    const leans = [undefined, ...leanOptions(world, state, f.id).map(l => l.at)];
    const sight = sightMap(world, state);
    let why: HoldReason = 'range';
    const worse = (r: HoldReason): void => { if (HOLD_RANK[r] > HOLD_RANK[why]) why = r; };
    for (const lean of leans) {
        const origin = lean ?? from, dx = at.x - origin.x, dy = at.y - origin.y;
        if (dx * dx + dy * dy > w.range * w.range) continue;
        if (!lineOfSight(sight, origin, at)) { worse('sight'); continue; }
        const shot: Shot = lean ? { ...base, lean: { ...lean } } : base;
        if (shotRefusal(world, state, shot)) { worse('refused'); continue; }
        if (tries.left <= 0) return why;
        tries.left--;
        const blockers = blockersOf(world, state, shot);
        if (!blockers.length) return shot;
        for (const id of blockers) if (!tries.blockers.includes(id)) tries.blockers.push(id);
        worse('body');
    }
    return why;
}

/** Puts a fighter on `p` for a moment to ask something, and back. */
function from<T>(f: Fighter, p: Pos, ask: () => T): T {
    const holder = f.kind === 'npc' ? f.npc : f.unit, was = holder.pos, lean = holder.leaning;
    holder.pos = { x: p.x, y: p.y };
    holder.leaning = null;
    try {
        return ask();
    } finally {
        holder.pos = was;
        holder.leaning = lean;
    }
}

/**
 * Where a fighter fires from (§13.6 step 1): the path to the nearest tile in its move, cover against the target first,
 * from which it has a clean shot at it; or why it has none. Without moving only where it stands.
 */
function firingTile(world: ReadonlyWorld, state: State, f: Fighter, phase: WorldPhase, target: CrewState, move: boolean): Pos[] | Held {
    const reach = reachable(world, state, posOf(f), move ? budgetOf(world, f) : 0, moveOptions(world, f));
    const map = shotMap(world, state), fabric = shotFabric(world, state, map, state.cover), at = hitbox(target);
    const covered = (p: Pos): boolean => !!coverAgainst(map, fabric, { id: f.id, pos: p, standing: true, shield: false, armour: 0, precise: false }, at);
    const tiles = reach.tiles.filter(t => t.canEnd).map(t => ({ t, cover: covered(t.pos) }));
    tiles.sort((a, b) => Number(b.cover) - Number(a.cover) || a.t.cost - b.t.cost || a.t.pos.y - b.t.pos.y || a.t.pos.x - b.t.pos.x);
    const tries: Tries = { left: SHOT_TRIES, blockers: [] };
    let why: HoldReason = 'range';
    for (const { t } of tiles) {
        if (tries.left <= 0) break;
        const shot = from(f, t.pos, () => shotFrom(world, state, f, phase, target, t.cost > 0, tries));
        if (typeof shot === 'string') {
            if (HOLD_RANK[shot] > HOLD_RANK[why]) why = shot;
            continue;
        }
        return t.cost > 0 ? pathTo(reach, t.pos)! : [];
    }
    return held(why, tries);
}

/** Why a fighter held its fire, and who stood in the way. */
interface Held { why: HoldReason; blockers: string[] }

const held = (why: HoldReason, tries: Tries): Held => ({ why, blockers: why === 'body' ? [...tries.blockers].sort() : [] });

/** Tells that a fighter held its fire. */
function holdFire(ctx: Ctx, f: Fighter, target: CrewState, h: Held): void {
    ctx.emit({ type: 'heldFire', shooter: f.id, target: target.id, why: h.why, ...(h.blockers.length ? { blockers: h.blockers } : {}) });
}

/** A fighter acts in sight of the crew's Watch wedges (§11.8: moving or acting in one draws its volley). Whether it still stands. */
function react(ctx: Ctx, phase: WorldPhase, f: Fighter): boolean {
    watchReact(ctx, phase, f.id);
    return standing(ctx.state, f);
}

/** Fires a fighter's shot, if it is still clean as it stands: the lean, the facing, the noise, the bullets, the harm. */
function fire(ctx: Ctx, phase: WorldPhase, f: Fighter, shot: Shot): boolean {
    const { world, state } = ctx;
    if (shotRefusal(world, state, shot)) return false;
    const origin = shot.lean ?? posOf(f);
    // It leans out first: firing is acting, so a crew Watch on the tile it fires from fires first, and the shot is
    // asked again of what is left standing.
    const lean = shot.lean ? leanOptions(world, state, f.id).find(l => samePos(l.at, shot.lean!)) ?? null : null;
    if (f.kind === 'npc') {
        f.npc.leaning = lean;
        f.npc.facing = facingToward(origin, shot.at) ?? f.npc.facing;
    } else f.unit.leaning = lean;
    if (!react(ctx, phase, f) || shotRefusal(world, state, shot) || !cleanShot(world, state, shot)) return false;
    if (f.kind === 'npc') f.npc.ammo!.loaded -= shot.bullets!;
    // Clean as the bullets leave: only now is the shot told. The bullets are rolled; a preview of the world phase (the
    // hatched overlay's carriers) stops here, as at a crew Watch volley: a firefight isn't previewed (§13.6).
    ctx.emit({ type: 'fighterFired', shooter: f.id, target: shot.target!, weapon: shot.weapon, bullets: shot.bullets!, at: { ...shot.at } });
    ctx.dice.pictured('combat', `${f.id} fires`);
    const trace = resolveShot(ctx, shot);
    for (const hit of trace.hits) dealHarm(ctx, { target: hit.id, by: f.id, cause: 'shot', weapon: shot.weapon, hits: hit.hits, damage: hit.damage, lethal: true });
    // The report follows the bullets, so nobody it startles can step into the line of a shot already fired.
    const source = NOISE_OF[shot.weapon]!;
    makeNoise(ctx, source, origin, `${shot.weapon} ${f.id}`, weaponDef(shot.weapon).noise);
    if (NOISES[source].kind === 'loud' && !state.bank.loud) {
        state.bank.loud = true;
        ctx.emit({ type: 'wentLoud', cause: `${shot.weapon} ${f.id}` });
    }
    return true;
}

/**
 * Step 1 of the routine: move (if it may) to where it has a clean shot at the nearest crew member it sees, and fire.
 * Whether it fired.
 */
function fight(ctx: Ctx, phase: WorldPhase, f: Fighter, targets: readonly CrewState[], move: boolean): boolean {
    const { world, state } = ctx, here = posOf(f);
    const d2 = (c: CrewState): number => (c.pos.x - here.x) * (c.pos.x - here.x) + (c.pos.y - here.y) * (c.pos.y - here.y);
    const target = [...targets].sort((a, b) => d2(a) - d2(b) || (a.id < b.id ? -1 : 1))[0]!;
    const path = firingTile(world, state, f, phase, target, move);
    if (!Array.isArray(path)) {
        holdFire(ctx, f, target, path);
        return false;
    }
    if (!walk(ctx, phase, f, path)) return false;
    // Decided before the walk; the walk's reactions may have changed the scene, so it is asked again as it stands, of a
    // target still on the map and up.
    if (!state.crew.includes(target) || isDown(target) || target.wounds.dead) return false;
    const tries: Tries = { left: SHOT_TRIES, blockers: [] };
    const shot = shotFrom(world, state, f, phase, target, path.length > 0, tries);
    if (typeof shot === 'string') {
        holdFire(ctx, f, target, held(shot, tries));
        return false;
    }
    return fire(ctx, phase, f, shot);
}

// ---------------------------------------------------------------------------------------------------------- Hostages

/** Frees a hostage beside an officer (§10.10): up, no one's, walking out to its way out. Freeing is acting (`react`). */
function free(ctx: Ctx, phase: WorldPhase, unit: PoliceUnit, npc: NpcState, cut: boolean): boolean {
    const exit = releaseExit(ctx.world, ctx.state, npc);
    if (!exit || !react(ctx, phase, { kind: 'police', id: unit.id, unit })) return false;
    npc.command = null;
    npc.untying = null;
    npc.status = 'alerted';
    npc.lapse = { kind: 'released', exit: { x: exit.x, y: exit.y }, freed: unit.id };
    ctx.emit({ type: 'npcStatus', npc: npc.id, status: 'alerted' });
    alertNpc(ctx, npc, 'freed');
    ctx.emit({ type: 'hostageFreed', npc: npc.id, unit: unit.id, exit: { x: exit.x, y: exit.y }, cut });
    return true;
}

/** An officer frees every Commanded hostage beside it, and cuts one tied one loose if its act is still free. */
function freeHostages(ctx: Ctx, phase: WorldPhase, unit: PoliceUnit, spent: boolean): void {
    const { world, state } = ctx;
    const up = (): boolean => state.police.units.includes(unit);
    // Held this phase (§10.3) or led by the arm, a hostage stays under the crew's guns.
    const beside = (n: NpcState): boolean => isPresent(n) && n.stashed === null && !draggedBy(state, n.id) && !state.held.includes(n.id)
        && n.lapse?.kind !== 'released' && inReach(world, state, unit.pos!, n.pos);
    for (const npc of state.npcs) if (up() && npc.status === 'commanded' && beside(npc)) free(ctx, phase, unit, npc, false);
    if (spent || !up()) return;
    const tied = state.npcs.find(n => n.status === 'tied' && beside(n));
    if (tied) free(ctx, phase, unit, tied, true);
}

// ---------------------------------------------------------------------------------------------------------- Acting

/** Blows a door the officer announced last world phase; its act. */
function breach(ctx: Ctx, unit: PoliceUnit, door: string): void {
    const { state } = ctx;
    state.doors[door] = { ...state.doors[door], status: 'breached' };
    ctx.emit({ type: 'doorBreached', door, unit: unit.id });
    makeNoise(ctx, 'breachCharge', unit.pos!, `breach ${door}`);
}

/** The crew positions a fighter knows of, as threats to keep out of sight of. */
function threats(state: State, f: Fighter): Pos[] {
    if (f.kind === 'police') return sortedIds(state.police.known).flatMap(id => state.police.known[id]!.tile ?? []);
    return sortedIds(f.npc.lastSeen).map(id => f.npc.lastSeen[id]!.tile);
}

/** Where a fighter advances to with nobody in sight (§13.6 step 2): a known downed crew member, else the nearest known. */
function goalOf(state: State, f: Fighter): Pos | undefined {
    const here = posOf(f), d2 = (p: Pos): number => (p.x - here.x) * (p.x - here.x) + (p.y - here.y) * (p.y - here.y);
    const known = f.kind === 'police'
        ? sortedIds(state.police.known).map(id => ({ ...state.police.known[id]!, id }))
        : sortedIds(f.npc.lastSeen).map(id => ({ ...f.npc.lastSeen[id]!, id, down: false }));
    const live = known.flatMap(k => (k.tile && state.crew.some(c => c.id === k.id) ? [{ id: k.id, tile: k.tile, down: k.down }] : []));
    const pick = (list: typeof live): Pos | undefined => list.sort((a, b) => d2(a.tile) - d2(b.tile) || (a.id < b.id ? -1 : 1))[0]?.tile;
    return pick(live.filter(k => k.down)) ?? pick(live.filter(k => !k.down));
}

function officerActs(ctx: Ctx, phase: WorldPhase, unit: PoliceUnit): void {
    const { world, state } = ctx, f: Fighter = { kind: 'police', id: unit.id, unit };
    // A breach announced last world phase is carried out as shown.
    const due = state.police.breaches.find(b => b.unit === unit.id && b.turn < phase.turn);
    if (due) {
        // Breaching is acting: a crew Watch on it fires first, and an officer downed by it is called off (`policeDown`).
        if (!react(ctx, phase, f)) return;
        state.police.breaches.splice(state.police.breaches.indexOf(due), 1);
        breach(ctx, unit, due.door);
        return;
    }
    if (!ROUTINE_KINDS.has(unit.kind)) return;
    const mode = state.police.mode?.kind ?? 'contain', assault = mode === 'assault';
    look(ctx, f);
    if (hurt(world, f)) return fallBack(ctx, phase, f, threats(state, f));
    if (mode === 'negotiate') return;
    const targets = inSight(world, state, f).filter(c => !isDown(c));
    let fired = false, alive = true;
    if (targets.length) fired = fight(ctx, phase, f, targets, assault);
    else if (assault) {
        const goal = goalOf(state, f);
        const level = heatNow(state)?.level ?? 1;
        if (goal) alive = advance(ctx, phase, f, goal, level >= BREACH_FROM);
    }
    if (!alive || !standing(state, f)) return;
    look(ctx, f);
    freeHostages(ctx, phase, unit, fired);
}

function npcActs(ctx: Ctx, phase: WorldPhase, npc: NpcState): void {
    const { world, state } = ctx, f: Fighter = { kind: 'npc', id: npc.id, npc };
    const ammo = npc.ammo;
    if (!ammo || npc.surprised !== null) return;
    look(ctx, f);
    if (hurt(world, f)) return fallBack(ctx, phase, f, threats(state, f));
    if (ammo.loaded < 1) {
        if (ammo.spare < 1 || !react(ctx, phase, f)) return;
        ammo.spare--;
        ammo.loaded = weaponDef(ammo.weapon).mag;
        ctx.emit({ type: 'npcReloaded', npc: npc.id });
        return;
    }
    const targets = inSight(world, state, f).filter(c => !isDown(c));
    if (targets.length) fight(ctx, phase, f, targets, true);
    else {
        const goal = goalOf(state, f);
        if (goal) advance(ctx, phase, f, goal, false);
    }
    if (standing(state, f)) look(ctx, f);
}

// The combat step (§6.1): the fighters one at a time (see the header).
registerWorldHook('combatNpcs', 'npcs.combat', (ctx, phase) => {
    const { state } = ctx;
    hear(state);
    for (const id of phase.combat) {
        const npc = state.npcs.find(n => n.id === id);
        if (npc && standing(state, { kind: 'npc', id, npc })) npcActs(ctx, phase, npc);
    }
    for (const unit of [...state.police.units]) {
        if (!state.police.units.includes(unit) || unit.pos === null) continue;
        officerActs(ctx, phase, unit);
    }
    // Breaches whose breacher is gone are called off.
    for (const b of [...state.police.breaches]) {
        if (state.police.units.some(u => u.id === b.unit && u.pos !== null)) continue;
        state.police.breaches.splice(state.police.breaches.indexOf(b), 1);
        ctx.emit({ type: 'breachCalledOff', door: b.door, unit: b.unit });
    }
});

// ---------------------------------------------------------------------------------------------------------- Harm

// Officers take harm like anyone (§12.3): their hit points; any hit ends Negotiate, and at 0 they are down for good.
registerHarmHandler('police', (ctx, harm) => {
    const unit = ctx.state.police.units.find(u => u.id === harm.target);
    if (!unit || harm.hits < 1) return;
    if (harm.damage > 0) {
        unit.hp = Math.max(0, unit.hp - harm.damage);
        ctx.emit({ type: 'officerWounded', unit: unit.id, hp: unit.hp, hurt: unit.hp * 2 <= OFFICER_STATS[unit.kind].hp });
    }
    if (unit.hp > 0 || !harm.lethal) policeHit(ctx, unit.id);
    if (unit.hp === 0) policeDown(ctx, unit.id, harm.lethal);
});

registerEvents({
    policeMoved: { undoBlocking: true },
    fighterFired: { undoBlocking: true },
    heldFire: { undoBlocking: true },
    npcReloaded: { undoBlocking: true },
    officerWounded: { undoBlocking: true },
    hostageFreed: { undoBlocking: true },
    breachAnnounced: { undoBlocking: true },
    doorBreached: { undoBlocking: true },
    breachCalledOff: { undoBlocking: true }
});
