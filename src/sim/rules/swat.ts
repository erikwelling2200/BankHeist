import { registerCommandHook, registerWorldHook, type Ctx, type WorldPhase } from '../core/engine';
import { inBounds, samePos, tileAt } from '../core/grid';
import { sortedIds } from '../core/json';
import { newId } from '../core/state';
import type { CrewState, DeepReadonly, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { registerMoveHook } from '../crew/movement';
import { HALF_STEPS_PER_TILE } from '../data/movement';
import { NOISES } from '../data/noise';
import { BREACH_FROM, COMBAT_SIGHT, OFFICER_STATS, WEAPON_WEIGHT } from '../data/police';
import { SUPPRESSED_AIM, THROWABLES, WATCH_AIM, WATCH_ARC, WATCH_NARROW, weaponDef } from '../data/weapons';
import { lineOfSight, sightMap, type SightMap } from '../geo/los';
import { pathTo, reachable } from '../geo/move';
import { coverAgainst, shotFabric, shotMap, tileKey } from '../geo/shot';
import { makeNoise } from '../geo/sound';
import { inWedge, NOISE_OF } from './actions/attack';
import { doorSides } from './actions/door';
import { officerSeen } from './knowledge';
import { blastTiles } from './actions/throwables';
import { dealHarm } from './damage';
import { heatNow } from './heat';
import type { PoliceUnit, PoliceWatch, SwatTeam } from './police';
import {
    advance, announceBreach, dueBreach, fallBack, fight, freeHostages, goalOf, hitbox, hurt, inSight, look, moveOptions, react, registerTeamPlay, seesTile, standing,
    threats, underGrenades, walk, cleanShot, type Fighter, type HoldReason
} from './routine';
import { resolveShot, shotRefusal, type Shot } from './shot';
import { isDown, isHurt } from './wounds';

/*
 * SWAT team play (GAME_DESIGN §13.6 "SWAT: a coordinated team", §11.8, §11.10; implementation plan M3-06, decisions
 * 180–186). A SWAT van brings a team (`PoliceUnit.team`, the van's id; `PoliceState.teams`). Its members act in the
 * combat step in the officers' order like everyone else (rules/routine.ts calls `teamActs` in place of the routine), but
 * by one plan a world phase, made as the first of them acts, from what the police know then (§13.6: decided as they
 * act; nothing of it is announced but the breaches).
 *
 * - **The plan** (`SwatTeam`): who moves and who covers, and the focus.
 *   - **Fire and movement:** half the team moves (in Assault), the other half covers: members alternate by their order
 *     in the team and the turn's parity, so they never all move at once; a team of one moves alone. Out of Assault
 *     nobody moves.
 *   - **Focus fire:** the crew member the team concentrates on until they are down or out of every member's sight; a
 *     new one by §13.6's priority: exposed (leaning, or without cover against a member who sees them) → Hurt →
 *     carrying something → the heaviest weapon drawn (`WEAPON_WEIGHT`) → nearest → by id. Only crew a member sees now
 *     are weighed.
 * - **Each member's act:** a breach it announced is carried out first, as shown, and a flashbang thrown through the
 *   door after it (flashbang first: it goes off as the next world phase starts, before they go in). Hurt, it falls back
 *   as in the routine; in Negotiate it holds. Otherwise:
 *   - **Kit:** in Assault, a flashbang on clustered crew (two or more the police saw this turn within its reach, no
 *     officer in it, none already lying there), thrown up to its range to a tile it sees: it lands now and goes off as
 *     the next world phase starts (§11.10), so the crew has a crew phase to move out (`policeGrenade`).
 *   - **A mover** with a crew member in sight moves to fire at the focus (or the nearest), looking first for a tile
 *     outside the target's cover (**flanking**), then its own cover; with none in sight it advances as in the routine.
 *   - **A coverer** fires at the focus (or the nearest) from where it stands; with no clean shot, or nobody in sight, it
 *     sets a **Watch wedge** on the focus's last known tile, else the nearest known (`PoliceUnit.watch`, its gun's
 *     Watch arc), out to what it sees (`COMBAT_SIGHT`). The wedge is held through the crew phase after it: the first
 *     crew member it would take for the crew, not aboard a vehicle, to move in it (from a tile in it or onto one) or
 *     act inside it (`tripWedges`, from every move and every other command) draws its volley as the next world phase's
 *     combat step starts, before any fighter acts (the grenades and the passive NPCs come first): half its gun's
 *     bullets rounded up, Aim ×1.5 (×1 at 15° or narrower), aimed where they were (decision 182), through
 *     `cleanShot` like every police shot.
 *   - Then it frees the hostages beside it, as in the routine.
 * - **Timed breaches:** from Heat 3 in Assault a mover whose way runs through a locked door stops beside it and stacks
 *   (`SwatTeam.stack`). After everyone has acted the team announces its stacked doors together, once two doors are
 *   stacked, a member has waited there a whole phase, or every member is stacked; each is blown in the next world
 *   phase by its own officer, in the same phase, while the rest of the team holds (no movers in a phase the team
 *   breaches).
 * - **Casualties:** a member down (`policeDown` sets `lost`) makes the team pull back once: the next plan, or at once
 *   for the members still to act if it went down in the world phase after the plan; each member steps one tile away,
 *   out of sight of the crew positions the police know if it can, and covers with a wedge. Then the team re-plans.
 * - Officers don't walk to a tile a police grenade lying on the floor will reach (routine.ts `underGrenades`).
 * - Every shot, wedge, throw and breach is an act: a crew Watch on the member fires first (`react`, decision 159).
 */

declare module '../core/types' {
    interface EventMap {
        /** An officer set a Watch wedge on `at`, `arc` degrees wide, held through the next crew phase. */
        policeWatching: { unit: string; at: Pos; arc: number };
        /**
         * A police grenade landed at `at`: it goes off as the next world phase starts (§11.10). Told without its thrower,
         * so the crew is warned of it wherever it was thrown from.
         */
        policeGrenade: { grenade: string; kind: string; at: Pos; radius: number };
    }
}

const police = (unit: PoliceUnit): Fighter => ({ kind: 'police', id: unit.id, unit });

const d2 = (a: Pos, b: Pos): number => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);

/** A team's members out on scene, in the officers' order. */
const membersOf = (state: State, team: string): PoliceUnit[] => state.police.units.filter(u => u.team === team && u.pos !== null);

// ---------------------------------------------------------------------------------------------------------- The plan

/** A body for asking about cover: standing on `pos`, nothing else. */
const coverBody = (id: string, pos: Pos) => ({ id, pos, standing: true, shield: false, armour: 0, precise: false });

/** The focus by §13.6's target priority among the crew members `seen` (see the header). */
function pickFocus(world: ReadonlyWorld, state: State, members: readonly PoliceUnit[], seen: readonly CrewState[]): CrewState | undefined {
    const map = shotMap(world, state), fabric = shotFabric(world, state, map, state.cover);
    const exposed = (c: CrewState): boolean => c.leaning !== null
        || members.some(m => seesTile(world, state, m.pos!, hitbox(c)) && !coverAgainst(map, fabric, coverBody(c.id, hitbox(c)), m.pos!));
    const weight = (c: CrewState): number => {
        const gun = c.arms.drawn === null ? undefined : c.arms.guns[c.arms.drawn];
        return gun ? WEAPON_WEIGHT[gun.load] ?? 0 : 0;
    };
    const rank = (c: CrewState): number => (exposed(c) ? 0 : isHurt(world, c) ? 1 : c.loadout.carrying !== null ? 2 : 3);
    const near = (c: CrewState): number => Math.min(...members.map(m => d2(m.pos!, c.pos)));
    return [...seen].sort((a, b) => rank(a) - rank(b) || weight(b) - weight(a) || near(a) - near(b) || (a.id < b.id ? -1 : 1))[0];
}

/** The team's plan for this world phase, made as its first member acts (see the header). */
function plan(ctx: Ctx, phase: WorldPhase, id: string, team: SwatTeam): void {
    const { world, state } = ctx;
    if (team.planned === phase.turn) return;
    const members = membersOf(state, id);
    team.planned = phase.turn;
    team.pulling = team.lost !== null;
    team.lost = null;
    // What every member sees goes on the radio first: the plan is made from all of it.
    for (const m of members) look(ctx, police(m));
    const seen = new Map<string, CrewState>();
    for (const m of members) for (const c of inSight(world, state, police(m))) if (!isDown(c)) seen.set(c.id, c);
    if (team.focus === null || !seen.has(team.focus)) team.focus = pickFocus(world, state, members, [...seen.values()])?.id ?? null;
    // A team breaching this phase holds (flashbang first); pulling back, nobody moves on.
    const breaching = state.police.breaches.some(b => b.turn < phase.turn && members.some(m => m.id === b.unit));
    if (team.pulling || breaching) team.movers = [];
    else if (members.length < 2) team.movers = members.map(m => m.id);
    else team.movers = members.filter((_, i) => i % 2 === phase.turn % 2).map(m => m.id);
}

// ---------------------------------------------------------------------------------------------------------- Wedges

/**
 * An officer covers `at` with a Watch wedge (§13.6 "locking down angles"): its gun's widest Watch arc, held through the
 * next crew phase. Setting it is acting.
 */
function cover(ctx: Ctx, phase: WorldPhase, unit: PoliceUnit, at: Pos): void {
    const weapon = OFFICER_STATS[unit.kind].weapon;
    if (!weapon || samePos(at, unit.pos!) || !react(ctx, phase, police(unit))) return;
    unit.watch = { at: { x: at.x, y: at.y }, arc: WATCH_ARC[weapon]!, turn: phase.turn, tripped: null };
    ctx.emit({ type: 'policeWatching', unit: unit.id, at: { x: at.x, y: at.y }, arc: unit.watch.arc });
}

/** Where a coverer with nobody in sight aims its wedge: the focus's last known tile, else the nearest known. */
function coverTarget(state: State, team: SwatTeam, unit: PoliceUnit): Pos | undefined {
    const focus = team.focus === null || !Object.hasOwn(state.police.known, team.focus) ? null : state.police.known[team.focus]!.tile;
    if (focus) return focus;
    return threats(state, police(unit)).sort((a, b) => d2(a, unit.pos!) - d2(b, unit.pos!) || a.y - b.y || a.x - b.x)[0];
}

/**
 * The police wedges the crew sees now (their officer in sight, `officerSeen`): what the HUD may draw (M3-09). A wedge
 * whose officer is hidden isn't told.
 */
export function seenWedges(world: ReadonlyWorld, state: State): { unit: string; at: Pos; arc: number }[] {
    return liveWedges(state).filter(w => officerSeen(world, state, w.unit.id)).map(w => ({ unit: w.unit.id, at: { ...w.watch.at }, arc: w.watch.arc }));
}

/** How far a wedge reaches: its gun's range, no further than the officer sees in combat (decision 151). */
const wedgeReach = (unit: PoliceUnit): number => Math.min(weaponDef(OFFICER_STATS[unit.kind].weapon!).range, COMBAT_SIGHT);

/** The police wedges whose crew phase this is: set in the last world phase, by an officer still out. */
const liveWedges = (state: State): { unit: PoliceUnit; watch: PoliceWatch }[] =>
    state.police.units.flatMap(u => (u.watch && u.pos && u.watch.turn === state.turn - 1 ? [{ unit: u, watch: u.watch }] : []));

/**
 * A crew member moved onto or acted on `tile` in the crew phase: every police wedge that holds it, not tripped yet,
 * takes it for its volley (if it would take them for the crew: masked or known to the police, decision 151). Nothing is
 * told: the volley comes as the world phase starts.
 */
export function tripWedges(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, tile: DeepReadonly<Pos>): void {
    // Aboard a vehicle with its doors shut, nobody sees or shoots them (as `inSight`).
    if (state.phase !== 'crew' || isDown(member) || member.aboard) return;
    if (!member.loadout.masked && !Object.hasOwn(state.police.known, member.id)) return;
    let sight: SightMap | undefined;
    for (const { unit, watch } of liveWedges(state)) {
        if (watch.tripped) continue;
        sight ??= sightMap(world, state);
        if (inWedge(sight, unit.pos!, watch.at, watch.arc, wedgeReach(unit), { x: tile.x, y: tile.y })) watch.tripped = { crew: member.id, at: { x: tile.x, y: tile.y } };
    }
}

// Moving in a wedge draws it (§11.8): from a tile in it (stepping out too) or onto one.
registerMoveHook('swat.wedges', {
    start: (ctx, member) => tripWedges(ctx.world, ctx.state, member, member.pos),
    step: (ctx, member, path, i) => tripWedges(ctx.world, ctx.state, member, path[i]!)
});

// Any other command a crew member gives is acting where they stand (or lean).
registerCommandHook('swat.wedges', (ctx, cmd) => {
    if (cmd.type === 'endTurn' || cmd.type === 'move' || cmd.type === 'dash') return;
    const id = (cmd as { crew?: unknown }).crew;
    const member = typeof id === 'string' ? ctx.state.crew.find(c => c.id === id) : undefined;
    if (member) tripWedges(ctx.world, ctx.state, member, member.leaning?.at ?? member.pos);
});

/** Puts a crew member back on the tile where they crossed a wedge for a moment, to fire at them there. */
function crossing<T>(member: CrewState, at: Pos, ask: () => T): T {
    const was = member.pos, lean = member.leaning;
    member.pos = { x: at.x, y: at.y };
    member.leaning = null;
    try {
        return ask();
    } finally {
        member.pos = was;
        member.leaning = lean;
    }
}

/** A wedge's volley at whoever tripped it, where they crossed (decision 182). */
function volley(ctx: Ctx, phase: WorldPhase, unit: PoliceUnit, watch: PoliceWatch): void {
    const { world, state } = ctx, trip = watch.tripped!, weapon = OFFICER_STATS[unit.kind].weapon;
    const member = state.crew.find(c => c.id === trip.crew);
    if (!member || isDown(member) || member.aboard || !weapon) return;
    // Firing is acting: a crew Watch on the officer fires first.
    if (!react(ctx, phase, police(unit))) return;
    const w = weaponDef(weapon), aim = watch.arc <= WATCH_NARROW ? 1 : WATCH_AIM;
    const shot: Shot = { shooter: unit.id, weapon, at: { ...trip.at }, target: member.id, bullets: Math.ceil(w.bullets / 2), moved: false, aimFactor: aim };
    if (unit.suppressed?.turn === phase.turn) shot.aimFactor = aim * SUPPRESSED_AIM;
    const why = crossing(member, trip.at, (): HoldReason | null => {
        const reach = wedgeReach(unit);
        if (d2(unit.pos!, trip.at) > reach * reach) return 'range';
        if (!lineOfSight(sightMap(world, state), unit.pos!, trip.at)) return 'sight';
        if (shotRefusal(world, state, shot)) return 'refused';
        return cleanShot(world, state, shot) ? null : 'body';
    });
    if (why) {
        ctx.emit({ type: 'heldFire', shooter: unit.id, target: member.id, why });
        return;
    }
    // As `fire` (routine.ts): told as the bullets leave, the dice rolled (a preview of the world phase stops here,
    // §13.6), and the report after the bullets, so nothing it sets off comes before the stop.
    ctx.emit({ type: 'fighterFired', shooter: unit.id, target: member.id, weapon, bullets: shot.bullets!, at: { ...trip.at } });
    ctx.dice.pictured('combat', `${unit.id} fires from Watch`);
    const trace = crossing(member, trip.at, () => resolveShot(ctx, shot));
    for (const hit of trace.hits) dealHarm(ctx, { target: hit.id, by: unit.id, cause: 'shot', weapon, hits: hit.hits, damage: hit.damage, lethal: true });
    makeNoise(ctx, NOISE_OF[weapon]!, unit.pos!, `${weapon} ${unit.id}`, w.noise);
    if (NOISES[NOISE_OF[weapon]!].kind === 'loud' && !state.bank.loud) {
        state.bank.loud = true;
        ctx.emit({ type: 'wentLoud', cause: `${weapon} ${unit.id}` });
    }
}

// As the combat step starts, before any fighter acts (after the grenades and the passive NPCs), each police wedge held through the crew phase fires at whoever tripped
// it, and comes down: an officer sets a new one as it acts. In Negotiate the police hold fire.
registerWorldHook('combatNpcs', 'swat.wedges', (ctx, phase) => {
    const { state } = ctx;
    for (const unit of [...state.police.units]) {
        const watch = unit.watch;
        if (!watch || watch.turn >= phase.turn) continue;
        unit.watch = null;
        if (!watch.tripped || unit.pos === null || unit.surprised === phase.turn || state.police.mode?.kind === 'negotiate') continue;
        if (state.police.units.includes(unit)) volley(ctx, phase, unit, watch);
    }
}, { order: -1 });

// ---------------------------------------------------------------------------------------------------------- Kit

/** Whether an officer at `from` may throw a grenade to `to`: in range, a tile it sees that isn't full height. */
function throwable(world: ReadonlyWorld, sight: SightMap, from: Pos, to: Pos): boolean {
    const range = THROWABLES.flashbang.range;
    return inBounds(world, to) && !samePos(from, to) && d2(from, to) <= range * range && !tileAt(world, to)!.tall && lineOfSight(sight, from, to);
}

/** Whether a flashbang at `at` would catch an officer, or lands where a police one already lies. */
function fouled(state: State, tiles: readonly Pos[], at: Pos): boolean {
    const inside = new Set(tiles.map(tileKey)), r = THROWABLES.flashbang.radius;
    return state.police.units.some(u => u.pos && inside.has(tileKey(u.pos)))
        || state.grenades.some(g => g.turn > state.turn && state.police.units.some(u => u.id === g.by) && d2(g.at, at) <= r * r);
}

/** Throws one of an officer's flashbangs to `at`: it lands now and goes off as the next world phase starts. An act. */
function throwFlash(ctx: Ctx, phase: WorldPhase, unit: PoliceUnit, at: Pos): void {
    const { state } = ctx;
    if (!react(ctx, phase, police(unit))) return;
    unit.flashbangs--;
    const grenade = { id: newId(state, 'flashbang'), kind: 'flashbang' as const, by: unit.id, at: { x: at.x, y: at.y }, turn: phase.turn + 1 };
    state.grenades.push(grenade);
    ctx.emit({ type: 'policeGrenade', grenade: grenade.id, kind: grenade.kind, at: { ...grenade.at }, radius: THROWABLES.flashbang.radius });
}

/** The crew positions the police saw this turn, not down: what a flashbang is aimed at. */
function seenNow(state: State): Pos[] {
    const known = state.police.known;
    return sortedIds(known).flatMap(id => {
        const k = known[id]!;
        return k.tile && k.turn === state.turn && !k.down && state.crew.some(c => c.id === id) ? [k.tile] : [];
    });
}

/** A flashbang on clustered crew (§13.6 "using their kit"): the tile that catches the most, at least two. Whether thrown. */
function clusterFlash(ctx: Ctx, phase: WorldPhase, unit: PoliceUnit): boolean {
    const { world, state } = ctx, crew = seenNow(state), r = THROWABLES.flashbang.radius, from = unit.pos!;
    if (crew.length < 2) return false;
    const sight = sightMap(world, state), tried = new Set<string>();
    let best: { at: Pos; n: number } | undefined;
    for (const c of crew) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const at = { x: c.x + dx, y: c.y + dy }, key = tileKey(at);
        if (tried.has(key)) continue;
        tried.add(key);
        if (!throwable(world, sight, from, at)) continue;
        const tiles = blastTiles(world, sight, at, r), inside = new Set(tiles.map(tileKey));
        const n = crew.filter(p => inside.has(tileKey(p))).length;
        if (n < 2 || fouled(state, tiles, at)) continue;
        if (!best || n > best.n || (n === best.n && (d2(from, at) < d2(from, best.at) || (d2(from, at) === d2(from, best.at) && (at.y < best.at.y || (at.y === best.at.y && at.x < best.at.x)))))) best = { at, n };
    }
    if (!best) return false;
    throwFlash(ctx, phase, unit, best.at);
    return true;
}

/**
 * Flashbang first (§13.6 timed breaches): through a door just blown, at the nearest crew position the police know on
 * the far side it can reach, else two tiles in, else the tile beyond the door; never where it would catch an officer.
 */
function flashThrough(ctx: Ctx, phase: WorldPhase, unit: PoliceUnit, doorId: string): void {
    const { world, state } = ctx, door = world.doors[doorId], from = unit.pos!;
    const sides = door ? doorSides(world, door) : undefined;
    if (unit.flashbangs < 1 || !sides) return;
    const beyond = samePos(sides[0], from) ? sides[1] : sides[0];
    const sight = sightMap(world, state), r = THROWABLES.flashbang.radius;
    const step = { x: beyond.x - from.x, y: beyond.y - from.y };
    const known = threats(state, police(unit)).filter(p => d2(p, beyond) < d2(p, from)).sort((a, b) => d2(a, from) - d2(b, from) || a.y - b.y || a.x - b.x);
    for (const at of [...known, { x: beyond.x + step.x, y: beyond.y + step.y }, beyond]) {
        if (!throwable(world, sight, from, at) || fouled(state, blastTiles(world, sight, at, r), at)) continue;
        throwFlash(ctx, phase, unit, at);
        return;
    }
}

// ---------------------------------------------------------------------------------------------------------- Moving

/** Casualties (§13.6): one step back, out of sight of the crew positions known if it can, then covering. */
function pullBack(ctx: Ctx, phase: WorldPhase, unit: PoliceUnit): void {
    const { world, state } = ctx, f = police(unit), known = threats(state, f);
    if (!known.length) return;
    const from = unit.pos!, seen = (p: Pos): boolean => known.some(t => seesTile(world, state, t, p));
    const nearest = (p: Pos): number => Math.min(...known.map(t => d2(t, p)));
    const reach = reachable(world, state, from, 2 * HALF_STEPS_PER_TILE, moveOptions(world, f));
    const avoid = underGrenades(world, state, f);
    const steps = reach.tiles.filter(t => t.canEnd && t.cost > 0 && !avoid.has(tileKey(t.pos)) && Math.max(Math.abs(t.pos.x - from.x), Math.abs(t.pos.y - from.y)) === 1);
    steps.sort((a, b) => Number(seen(a.pos)) - Number(seen(b.pos)) || nearest(b.pos) - nearest(a.pos) || a.pos.y - b.pos.y || a.pos.x - b.pos.x);
    const to = steps[0], path = to && nearest(to.pos) >= nearest(from) ? pathTo(reach, to.pos) : undefined;
    if (path && !walk(ctx, phase, f, path)) return;
    const at = known.sort((a, b) => d2(a, unit.pos!) - d2(b, unit.pos!) || a.y - b.y || a.x - b.x)[0]!;
    if (standing(state, f)) cover(ctx, phase, unit, at);
}

/** A mover stopped beside a locked door on its way: it stacks there (kept from an earlier phase if it didn't move). */
function stackAt(team: SwatTeam, unit: PoliceUnit, door: string, moved: boolean, phase: WorldPhase): void {
    const had = team.stack.find(s => s.unit === unit.id);
    if (had && had.door === door && !moved) return;
    team.stack = team.stack.filter(s => s.unit !== unit.id);
    team.stack.push({ unit: unit.id, door, turn: phase.turn });
}

// After everyone has acted, each team announces its stacked doors together (timed breaches, see the header).
registerWorldHook('combatNpcs', 'swat.breaches', (ctx, phase) => {
    const { world, state } = ctx;
    const assault = state.police.mode?.kind === 'assault' && (heatNow(state)?.level ?? 1) >= BREACH_FROM;
    for (const id of sortedIds(state.police.teams)) {
        const team = state.police.teams[id]!, members = membersOf(state, id);
        // Still beside a locked door nobody announced, and still in the team.
        team.stack = team.stack.filter(s => {
            const unit = members.find(m => m.id === s.unit), door = world.doors[s.door];
            return !!unit && !!door && state.doors[s.door]?.status === 'locked' && !!doorSides(world, door)?.some(p => samePos(p, unit.pos!))
                && !state.police.breaches.some(b => b.door === s.door);
        });
        if (!assault || !team.stack.length) continue;
        const doors = new Set(team.stack.map(s => s.door));
        if (doors.size < 2 && !team.stack.some(s => s.turn < phase.turn) && team.stack.length < members.length) continue;
        for (const door of [...doors].sort()) announceBreach(ctx, phase, team.stack.find(s => s.door === door)!.unit, door);
        team.stack = [];
    }
}, { order: 1 });

// ---------------------------------------------------------------------------------------------------------- Acting

/** A SWAT team member's act (see the header), in place of the routine. */
function teamActs(ctx: Ctx, phase: WorldPhase, unit: PoliceUnit): void {
    const { world, state } = ctx, f = police(unit), id = unit.team!, team = state.police.teams[id];
    if (!team) return;
    plan(ctx, phase, id, team);
    look(ctx, f);
    const door = dueBreach(ctx, phase, unit);
    if (door === 'down') return;
    if (door !== null) return flashThrough(ctx, phase, unit, door);
    const mode = state.police.mode?.kind ?? 'contain', assault = mode === 'assault';
    if (hurt(world, f)) return fallBack(ctx, phase, f, threats(state, f));
    if (mode === 'negotiate') return;
    // A member went down since the plan: those still to act pull back now, and that answers it (once, decision 185).
    if (team.lost !== null) {
        team.lost = null;
        team.pulling = true;
        team.movers = [];
    }
    if (team.pulling) return pullBack(ctx, phase, unit);
    const moving = assault && team.movers.includes(unit.id);
    let fired = false, alive = true;
    if (assault && unit.flashbangs > 0 && clusterFlash(ctx, phase, unit)) fired = true;
    else {
        const seen = inSight(world, state, f).filter(c => !isDown(c));
        const here = unit.pos!, focus = seen.find(c => c.id === team.focus);
        const target = focus ?? [...seen].sort((a, b) => d2(a.pos, here) - d2(b.pos, here) || (a.id < b.id ? -1 : 1))[0];
        if (target) {
            fired = fight(ctx, phase, f, [target], moving, moving);
            if (!fired && !moving && standing(state, f)) cover(ctx, phase, unit, hitbox(target));
        } else if (moving) {
            const goal = goalOf(state, f), level = heatNow(state)?.level ?? 1;
            if (goal) alive = advance(ctx, phase, f, goal, level >= BREACH_FROM ? (d, moved) => stackAt(team, unit, d, moved, phase) : null);
        } else {
            const at = coverTarget(state, team, unit);
            if (at) cover(ctx, phase, unit, at);
        }
    }
    if (!alive || !standing(state, f)) return;
    look(ctx, f);
    freeHostages(ctx, phase, unit, fired);
}

registerTeamPlay(teamActs);

registerEvents({
    policeWatching: { undoBlocking: true },
    policeGrenade: { undoBlocking: true }
});
