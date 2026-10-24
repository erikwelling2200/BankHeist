import { IllegalCommand, registerCommandHook, registerWorldHook, type Ctx } from '../core/engine';
import { edgeBetween, edgeKey, inBounds, samePos, tileAt } from '../core/grid';
import { clonePlain } from '../core/json';
import { edgeNow, newId, registerCrewInit, registerNpcInit, registerRuleDefaults, registerStateInit } from '../core/state';
import type { CrewState, DeepReadonly, NpcState, Phase, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { CREW_ARMOUR, NPC_ARMOUR, weaponDef, type WeaponDef } from '../data/weapons';
import { ABSENT_STATUSES, LYING_STATUSES, stepCost } from '../geo/move';
import {
    copyFabric, INDESTRUCTIBLE, NO_COVER, shotFabric, shotMap, tileKey, traceBullet, viewedFabric, type Body, type BulletTrace, type Fabric, type ShotScene, type ShotView
} from '../geo/shot';
import { hasTrait } from './alarms';
import { draggedBy } from './place';

/*
 * Shots (GAME_DESIGN §11.2–11.7, §12.1, §12.3; implementation plan M3-01, decisions 85–92): who an attack can hit, how
 * wide each bullet's arc is, and the one function that plays an attack's bullets for given rolled points (`traceShot`).
 * `previewShot` (preview/shot.ts) and `resolveShot` here both go through it, so the preview of a shot is its outcome
 * for the same points; only the points and the cover rolls are random (§11, the two random layers).
 *
 * - **Arcs** (§11.2): bullet k flies within Aim × (the moving penalty, unless braced) × `aimFactor` + (k − 1) × Recoil
 *   degrees, centred on the aim line (the LMG's recoil 1 braced, a Marksman's halved while braced). Its point is
 *   rolled uniformly over the arc: offset = turn + (u − 0.5) × arc.
 * - **The aim line** runs from the middle of the origin tile to the middle of the aimed-at tile, turned by `turn`
 *   whole degrees (§11.1's fine aim).
 * - **Bodies** (geo/shot.ts): everyone on the map but the shooter, at their hitbox tile (the lean tile while leaning);
 *   lying people (face down, tied, out, dead, dragged) are passed over unless aimed at; a stashed body isn't there.
 * - **Armour** (§12.3): the crew's worn piece (`CREW_ARMOUR`), an NPC's by role (`NPC_ARMOUR`, a guard's from
 *   `rules.guardArmour`, 1 from City tier).
 * - **Leaning** (§11.4): `leanOptions` are the open tiles beside a full-cover corner a person can lean out to;
 *   `CrewState.leaning` / `NpcState.leaning` hold the chosen one until the start of their side's next phase or until
 *   they move. M3-02's attack sets it.
 * - **Resolving** rolls the points (and a cover roll only where a hit meets cover) on the 'combat' stream, keeps them
 *   in `State.shots` (§11.2: a reopened game can't reroll), writes what broke into the state (shattered panes and
 *   teller glass's hits in `State.edges`, cover's hit points in `State.cover`) and returns every hit. It applies no
 *   damage: wounds are M3-03's. Nothing here is a command: M3-02's attack spends the action and the ammunition, makes
 *   the noise and calls it.
 */

/** An attack's geometry: who fires what from where at what. */
export interface Shot {
    /** The shooter: a crew member or an NPC. */
    shooter: string;
    weapon: string;
    /** The tile aimed at (a tapped target's tile). */
    at: Pos;
    /** The person tapped, if any: aimed at, they are hit even lying down (§11.3). */
    target?: string;
    /** Lean out to this tile and fire from it (one of `leanOptions`, §11.4). */
    lean?: Pos;
    /** Fine aim: whole degrees off the line to `at` (§11.1). */
    turn?: number;
    /** The fire selector: 1 up to the weapon's Bullets (§11.1). Default all. */
    bullets?: number;
    /** The shooter moved this turn: the moving penalty (§11.2). */
    moved?: boolean;
    /** Braced on a bipod (§6.3): no moving penalty, the LMG's braced recoil. */
    braced?: boolean;
    /** Another multiplier on Aim (a Watch volley's ×1.5, §11.8). Default 1. */
    aimFactor?: number;
}

/** The dice of one attack: a point per bullet in [0, 1), and the cover rolls in the order the trace asked for them. */
export interface ShotRolls { points: number[]; covers: number[] }

/** A hit on a person, summed over an attack's bullets. */
export interface ShotHit { id: string; hits: number; damage: number; knockout: boolean }

/** An attack's outcome. */
export interface ShotTrace {
    origin: Pos;
    /** Each bullet's arc, degrees. */
    arcs: number[];
    bullets: BulletTrace[];
    /** Everyone hit (not blocked by cover), by id. */
    hits: ShotHit[];
    /** Edges whose panes the attack shattered. */
    shattered: string[];
}

/** A resolved attack, kept so it can't be rerolled and can be replayed (§11.2). */
export interface ShotRecord { id: string; turn: number; phase: Phase; shot: Shot; rolls: ShotRolls }

/** Leaning out past a corner (§11.4). */
export interface Lean {
    /** The open tile beside the corner, which shots are traced from and at. */
    at: Pos;
    /** The diagonal step from `at` toward the corner: the corner gives half cover over that quadrant. */
    corner: Pos;
}

/** How many resolved attacks `State.shots` keeps. */
export const SHOT_WINDOW = 8;

declare module '../core/types' {
    interface State {
        /** The last `SHOT_WINDOW` attacks with their rolls (§11.2). */
        shots: ShotRecord[];
        /** Half cover's hit points left where bullets hit it, by tile ("x y"); 0 is destroyed (§11.4). */
        cover: Record<string, number>;
    }
    interface CrewState {
        /** Leaning out past a corner until the next crew phase or a move (§11.4), or null. */
        leaning: Lean | null;
    }
    interface NpcState {
        /** Leaning out past a corner until the next world phase or a move (§11.4), or null. */
        leaning: Lean | null;
    }
    interface Rules {
        /** A guard's armour (§12.3): 0, 1 from City tier. */
        guardArmour: number;
    }
    interface EventMap {
        /** An attack's bullets flew (rules/shot.ts): each one's path, and who was hit. */
        shotFired: { shot: string; shooter: string; weapon: string; origin: Pos; bullets: BulletTrace[]; hits: ShotHit[] };
    }
}

registerRuleDefaults({ guardArmour: 0 });

registerStateInit('shot', (_world, state) => {
    state.shots = [];
    state.cover = {};
});
registerCrewInit('shot', (_world, _start, member) => {
    member.leaning = null;
});
registerNpcInit('shot', (_world, _person, npc) => {
    npc.leaning = null;
});

registerEvents({ shotFired: { undoBlocking: true } });

// A lean lasts until the start of the leaner's side's next phase (§11.4): NPCs' at the world phase's, the crew's at the
// crew phase's. NPCs lean only while acting in the world phase (M3-05), so theirs ends as the next one begins.
registerWorldHook('passiveNpcs', 'shot.leanNpcs', ctx => {
    for (const npc of ctx.state.npcs) npc.leaning = null;
}, { order: -1000 });
registerWorldHook('crewPhase', 'shot.leanCrew', ctx => {
    for (const member of ctx.state.crew) member.leaning = null;
}, { order: -100 });
// Moving away ends the lean (§11.4): whoever a command moved.
registerCommandHook('shot.leanMoved', (ctx, _cmd, _events, before) => {
    for (const member of ctx.state.crew) {
        const was = before.crew.find(c => c.id === member.id);
        if (member.leaning && was && !samePos(was.pos, member.pos)) member.leaning = null;
    }
    for (const npc of ctx.state.npcs) {
        const was = before.npcs.find(n => n.id === npc.id);
        if (npc.leaning && was && !samePos(was.pos, npc.pos)) npc.leaning = null;
    }
});

type Person = { kind: 'crew'; crew: DeepReadonly<CrewState> } | { kind: 'npc'; npc: DeepReadonly<NpcState> };

function personOf(state: DeepReadonly<State>, id: string): Person | undefined {
    const crew = state.crew.find(c => c.id === id);
    if (crew) return { kind: 'crew', crew };
    const npc = state.npcs.find(n => n.id === id);
    return npc ? { kind: 'npc', npc } : undefined;
}

/** A person's armour (§12.3): the crew's worn piece, an NPC's by role. */
export function armourOf(world: ReadonlyWorld, state: DeepReadonly<State>, id: string): number {
    const person = personOf(state, id);
    if (!person) throw new Error(`No one is '${id}'`);
    if (person.kind === 'crew') return Math.max(0, ...person.crew.loadout.items.map(i => CREW_ARMOUR[i] ?? 0));
    const role = world.people.find(p => p.id === id)?.role ?? '', armour = Object.hasOwn(NPC_ARMOUR, role) ? NPC_ARMOUR[role]! : 0;
    return armour === 'guard' ? world.rules.guardArmour : armour;
}

/** Statuses the DMR's precision bonus applies to (§11.5), with Surprised (`NpcState.surprised`). */
const UNWARY = new Set(['calm', 'curious']);

/** Where a person's hitbox is: where they lean out to, or where they stand (a dragged body: with its dragger). */
function hitboxOf(state: DeepReadonly<State>, person: Person): Pos {
    if (person.kind === 'crew') return person.crew.leaning?.at ?? person.crew.pos;
    const npc = person.npc;
    // A body dragged or a hostage led is where its dragger is: on the lean tile while they lean (§11.4).
    const by = draggedBy(state, npc.id);
    return npc.leaning?.at ?? (by ? by.leaning?.at ?? by.pos : npc.pos);
}

/** Everyone a shot can meet, by tile index, in the order a bullet meets them (geo/shot.ts `ShotScene.bodies`). */
export function shotBodies(world: ReadonlyWorld, state: DeepReadonly<State>, shooter: string, target?: string): Map<number, Body[]> {
    const out = new Map<number, Body[]>();
    const put = (body: Body): void => {
        const i = body.pos.y * world.width + body.pos.x, list = out.get(i);
        if (list) list.push(body);
        else out.set(i, [body]);
    };
    for (const c of state.crew) {
        if (c.id === shooter) continue;
        const pos = hitboxOf(state, { kind: 'crew', crew: c });
        const body: Body = { id: c.id, pos: { x: pos.x, y: pos.y }, standing: true, shield: false, armour: armourOf(world, state, c.id), precise: false };
        if (c.leaning) body.lean = { x: c.leaning.corner.x, y: c.leaning.corner.y };
        put(body);
    }
    for (const n of state.npcs) {
        if (n.id === shooter || ABSENT_STATUSES.has(n.status) || n.stashed !== null) continue;
        const pos = hitboxOf(state, { kind: 'npc', npc: n }), by = draggedBy(state, n.id);
        // A hostage led by the arm stands in front of its escort (§10.7 "a real shield"); a dragged body lies.
        const led = !!by && by.leading;
        const standing = n.id === target || led || (!by && !LYING_STATUSES.has(n.status));
        const body: Body = {
            id: n.id, pos: { x: pos.x, y: pos.y }, standing, shield: led, armour: armourOf(world, state, n.id),
            precise: UNWARY.has(n.status) || (n.surprised ?? 0) > 0
        };
        if (n.leaning) body.lean = { x: n.leaning.corner.x, y: n.leaning.corner.y };
        put(body);
    }
    for (const list of out.values()) list.sort((a, b) => Number(b.shield) - Number(a.shield) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out;
}

const SIDES: readonly Pos[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];

/**
 * The tiles a person can lean out to (§11.4, decision 90): an orthogonal neighbour they could step to (`stepCost`: no
 * wall between, no furniture, no raised edge without stairs; nobody standing there) where the side of their own tile
 * toward one perpendicular way is full cover (a wall that blocks sight, a full-height object beyond it, the map's edge)
 * and the same side of the neighbour is open. Each with the diagonal toward the corner; one per tile, the first corner
 * in north, east, south, west order.
 *
 * With `hidden` (the crew's hidden tiles, `ShotView`) only what the crew knows counts: a hidden tile is neither full
 * cover nor open, and is never leaned to, so every lean offered is one the truth allows too (doors as pictured aside).
 */
export function leanOptions(world: ReadonlyWorld, state: DeepReadonly<State>, id: string, hidden?: Uint8Array): Lean[] {
    const person = personOf(state, id);
    if (!person) throw new Error(`No one is '${id}'`);
    const from = person.kind === 'crew' ? person.crew.pos : person.npc.pos;
    const s = state as State;
    const unknown = (p: Pos): boolean => !!hidden && inBounds(world, p) && hidden[p.y * world.width + p.x] === 1;
    const wall = (a: Pos, b: Pos): boolean => !inBounds(world, b) || !!edgeNow(world, s, edgeKey(edgeBetween(a, b)))?.blocksSight;
    const fullCover = (a: Pos, b: Pos): boolean => wall(a, b) || (!unknown(b) && !!tileAt(world, b)!.tall);
    const open = (a: Pos, b: Pos): boolean => !wall(a, b) && !unknown(b) && !tileAt(world, b)!.tall;
    const standing = new Set<string>();
    for (const c of state.crew) if (c.id !== id) standing.add(tileKey(c.pos));
    for (const n of state.npcs) if (n.id !== id && !ABSENT_STATUSES.has(n.status) && !LYING_STATUSES.has(n.status) && n.stashed === null) standing.add(tileKey(n.pos));
    const out: Lean[] = [];
    for (const e of SIDES) {
        const at = { x: from.x + e.x, y: from.y + e.y };
        if (!inBounds(world, at) || unknown(at) || standing.has(tileKey(at)) || stepCost(world, s, from, at) === undefined) continue;
        for (const p of SIDES) {
            if (p.x * e.x + p.y * e.y !== 0) continue;
            if (!fullCover(from, { x: from.x + p.x, y: from.y + p.y }) || !open(at, { x: at.x + p.x, y: at.y + p.y })) continue;
            out.push({ at, corner: { x: p.x - e.x, y: p.y - e.y } });
            break;
        }
    }
    return out;
}

/** Each bullet's arc in degrees (§11.2). */
export function shotArcs(state: DeepReadonly<State>, shot: Shot): number[] {
    const w = weaponDef(shot.weapon), n = shot.bullets ?? w.bullets;
    const member = state.crew.find(c => c.id === shot.shooter);
    const aim = w.aim * (shot.moved && !shot.braced ? w.moved : 1) * (shot.aimFactor ?? 1);
    let recoil = shot.braced && w.bracedRecoil !== undefined ? w.bracedRecoil : w.recoil;
    if (shot.braced && member && hasTrait(member, 'marksman')) recoil /= 2;
    return Array.from({ length: n }, (_, k) => aim + k * recoil);
}

/** Where a shooter fires from: the lean tile, or where they stand. */
function originOf(world: ReadonlyWorld, state: DeepReadonly<State>, shot: Shot, hidden?: Uint8Array): Pos {
    const person = personOf(state, shot.shooter);
    if (!person) throw new IllegalCommand(`No one is '${shot.shooter}'`);
    const pos = person.kind === 'crew' ? person.crew.pos : person.npc.pos;
    if (!shot.lean) return { x: pos.x, y: pos.y };
    if (!leanOptions(world, state, shot.shooter, hidden).some(l => samePos(l.at, shot.lean!))) throw new IllegalCommand(`Nowhere to lean out at (${shot.lean.x}, ${shot.lean.y})`);
    return { x: shot.lean.x, y: shot.lean.y };
}

/** The checks an attack's geometry must pass; an IllegalCommand otherwise (before any roll). */
function checkShot(world: ReadonlyWorld, state: DeepReadonly<State>, shot: Shot): WeaponDef {
    let w: WeaponDef;
    try {
        w = weaponDef(shot.weapon);
    } catch {
        throw new IllegalCommand(`'${shot.weapon}' is no weapon to fire`);
    }
    const n = shot.bullets ?? w.bullets;
    if (!Number.isInteger(n) || n < 1 || n > w.bullets) throw new IllegalCommand(`The ${shot.weapon} fires 1 to ${w.bullets} bullets, not ${n}`);
    if (shot.turn !== undefined && (!Number.isInteger(shot.turn) || Math.abs(shot.turn) > 180)) throw new IllegalCommand(`Fine aim turns whole degrees up to 180, not ${shot.turn}`);
    if (shot.aimFactor !== undefined && !(shot.aimFactor > 0)) throw new IllegalCommand(`An aim factor of ${shot.aimFactor}`);
    if (shot.braced && !w.brace) throw new IllegalCommand(`The ${shot.weapon} has no bipod to brace on`);
    // An arc is a cone in front of the shooter: the widest must stay under a full turn.
    if (shotArcs(state, shot)[n - 1]! >= 360) throw new IllegalCommand(`A ${shotArcs(state, shot)[n - 1]}° arc is no aim`);
    if (!inBounds(world, shot.at)) throw new IllegalCommand(`(${shot.at.x}, ${shot.at.y}) is off the map`);
    if (shot.target !== undefined) {
        const person = personOf(state, shot.target);
        const gone = person?.kind === 'npc' && (ABSENT_STATUSES.has(person.npc.status) || person.npc.stashed !== null);
        if (!person || gone || shot.target === shot.shooter) throw new IllegalCommand(`'${shot.target}' is no one to aim at`);
        if (!samePos(hitboxOf(state, person), shot.at)) throw new IllegalCommand(`${shot.target} isn't at (${shot.at.x}, ${shot.at.y})`);
    }
    return w;
}

/** Everything one attack's bullets read, before the first flies. */
export function shotScene(world: ReadonlyWorld, state: DeepReadonly<State>, shot: Shot, view?: ShotView): ShotScene {
    const w = checkShot(world, state, shot), origin = originOf(world, state, shot, view?.hidden);
    if (samePos(origin, shot.at)) throw new IllegalCommand('A shot needs somewhere to aim other than where it is fired from');
    const map = shotMap(world, state as State);
    const ax = shot.at.x - origin.x, ay = shot.at.y - origin.y, len = Math.sqrt(ax * ax + ay * ay);
    const raised = (p: Pos): boolean => map.raised[p.y * world.width + p.x] === 1;
    const bullet: ShotScene['bullet'] = { damage: w.damage, pierce: w.pierce };
    if (w.close) bullet.close = w.close;
    if (w.precision) bullet.precision = true;
    if (w.knockout) bullet.knockout = true;
    const fabric = shotFabric(world, state as State, map, state.cover);
    if (!view) {
        return {
            map, fabric, bodies: shotBodies(world, state, shot.shooter, shot.target),
            origin, aim: [ax / len, ay / len], rangeSq: w.range * w.range, high: raised(origin) || raised(shot.at), bullet
        };
    }
    // As the crew knows the map: a hidden aimed-at tile tells nothing of its height.
    const atHidden = view.hidden[shot.at.y * world.width + shot.at.x] === 1;
    return {
        map, fabric: viewedFabric(world, map, fabric, view), bodies: shotBodies(world, state, shot.shooter, shot.target),
        origin, aim: [ax / len, ay / len], rangeSq: w.range * w.range, high: raised(origin) || (!atHidden && raised(shot.at)), bullet, hidden: view.hidden
    };
}

/** A shot with only the fields it sets, as plain JSON (a caller's `undefined` fields dropped). */
export function plainShot(shot: Shot): Shot {
    const out: Shot = { shooter: shot.shooter, weapon: shot.weapon, at: { x: shot.at.x, y: shot.at.y } };
    if (shot.target !== undefined) out.target = shot.target;
    if (shot.lean !== undefined) out.lean = { x: shot.lean.x, y: shot.lean.y };
    if (shot.turn !== undefined) out.turn = shot.turn;
    if (shot.bullets !== undefined) out.bullets = shot.bullets;
    if (shot.moved !== undefined) out.moved = shot.moved;
    if (shot.braced !== undefined) out.braced = shot.braced;
    if (shot.aimFactor !== undefined) out.aimFactor = shot.aimFactor;
    return out;
}

/** Bullet k's angle off the aim line for its rolled point (§11.2). */
export const bulletOffset = (shot: Shot, arc: number, point: number): number => (shot.turn ?? 0) + (point - 0.5) * arc + 0;

/**
 * Plays an attack's bullets in order for the given rolls, through one fabric (so a pane the first shatters is open to
 * the second, a desk broken by one covers no more). `cover` gives the next cover roll; with fixed rolls it reads them in
 * order and runs out only if the rolls weren't this shot's.
 */
function playShot(scene: ShotScene, arcs: readonly number[], shot: Shot, point: (k: number) => number, cover: (body: Body) => number): { bullets: BulletTrace[]; fabric: Fabric } {
    const fabric = copyFabric(scene.fabric);
    const bullets = arcs.map((arc, k) => traceBullet(scene, fabric, bulletOffset(shot, arc, point(k)), cover));
    return { bullets, fabric };
}

/** Who an attack's bullets hit, summed, by id. */
function hitsOf(bullets: readonly BulletTrace[]): ShotHit[] {
    const by = new Map<string, ShotHit>();
    for (const b of bullets) for (const s of b.steps) {
        if (s.kind !== 'body' || s.effect === 'blocked') continue;
        const hit = by.get(s.id) ?? { id: s.id, hits: 0, damage: 0, knockout: false };
        hit.hits++;
        hit.damage += s.damage;
        if (s.knockout) hit.knockout = true;
        by.set(s.id, hit);
    }
    return [...by.keys()].sort().map(id => by.get(id)!);
}

function outcome(scene: ShotScene, arcs: number[], bullets: BulletTrace[], fabric: Fabric): ShotTrace {
    const shattered = scene.map.edges.filter((_, i) => fabric.shattered[i] && !scene.fabric.shattered[i]).map(e => e.key);
    return { origin: { ...scene.origin }, arcs, bullets, hits: hitsOf(bullets), shattered };
}

/**
 * An attack's outcome for given rolls, without changing the state: what `resolveShot` does with the same rolls. The
 * preview's promise (§11.7): for any points, this is what happens.
 */
export function traceShot(world: ReadonlyWorld, state: DeepReadonly<State>, shot: Shot, rolls: ShotRolls): ShotTrace {
    const scene = shotScene(world, state, shot), arcs = shotArcs(state, shot);
    if (rolls.points.length !== arcs.length) throw new Error(`${arcs.length} bullets need ${arcs.length} points, not ${rolls.points.length}`);
    let next = 0;
    const { bullets, fabric } = playShot(scene, arcs, shot, k => rolls.points[k]!, () => {
        if (next >= rolls.covers.length) throw new Error('The shot asked for more cover rolls than it was given');
        return rolls.covers[next++]!;
    });
    if (next !== rolls.covers.length) throw new Error(`The shot used ${next} cover rolls of ${rolls.covers.length}`);
    return outcome(scene, arcs, bullets, fabric);
}

/** Writes what an attack broke into the state: shattered panes, teller glass's hits, cover's hit points left. */
function applyFabric(world: ReadonlyWorld, state: State, scene: ShotScene, fabric: Fabric): void {
    scene.map.edges.forEach((e, i) => {
        const shattered = fabric.shattered[i] === 1 && scene.fabric.shattered[i] !== 1, hit = fabric.hits[i] !== scene.fabric.hits[i];
        if (!shattered && !hit) return;
        const change = { ...(Object.hasOwn(state.edges, e.key) ? state.edges[e.key] : {}) };
        if (hit) change.hits = fabric.hits[i]!;
        // A shot-out pane passes sound freely; it still stops people (decision 91).
        if (shattered) Object.assign(change, { shattered: true, blocksSound: false });
        state.edges[e.key] = change;
    });
    for (let i = 0; i < fabric.cover.length; i++) {
        if (fabric.cover[i] === scene.fabric.cover[i] || scene.fabric.cover[i] === INDESTRUCTIBLE) continue;
        state.cover[`${i % world.width} ${Math.floor(i / world.width)}`] = fabric.cover[i] === NO_COVER ? 0 : fabric.cover[i]!;
    }
}

/**
 * Fires an attack for real: rolls each bullet's point and, where a hit meets cover, the cover roll (stream 'combat'),
 * plays them through `traceShot`'s trace, writes what broke into the state, keeps the rolls in `State.shots` and emits
 * `shotFired`. Returns the outcome; the hits' damage is for the caller to apply (M3-03). All checks come before the
 * first roll. A preview can't call it (it rolls): previews use `previewShot`.
 */
export function resolveShot(ctx: Ctx, shot: Shot): ShotTrace {
    const { world, state, dice } = ctx;
    const scene = shotScene(world, state, shot), arcs = shotArcs(state, shot);
    const rolls: ShotRolls = { points: [], covers: [] };
    const { bullets, fabric } = playShot(scene, arcs, shot, k => {
        const u = dice.next('combat', `${shot.shooter} bullet ${k + 1}`);
        rolls.points.push(u);
        return u;
    }, body => {
        const u = dice.next('combat', `cover ${body.id}`);
        rolls.covers.push(u);
        return u;
    });
    const trace = outcome(scene, arcs, bullets, fabric);
    applyFabric(world, state, scene, fabric);
    const record: ShotRecord = { id: newId(state, 'shot'), turn: state.turn, phase: state.phase, shot: plainShot(shot), rolls };
    state.shots.push(record);
    if (state.shots.length > SHOT_WINDOW) state.shots.splice(0, state.shots.length - SHOT_WINDOW);
    ctx.emit({ type: 'shotFired', shot: record.id, shooter: shot.shooter, weapon: shot.weapon, origin: trace.origin, bullets: clonePlain(trace.bullets), hits: clonePlain(trace.hits) });
    return trace;
}
