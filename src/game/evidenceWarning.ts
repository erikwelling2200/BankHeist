import {
    bandAt, cameraObserver, CLEAR, decodeBits, DIAGONAL_COST, doorDoubt, driveByDue, edgeBetween, edgeKey, evidenceOnMap, evidenceWorldPhase, fieldOn, isEyesDown,
    isKnownNow, isMajor, isPresent, LEAVING_ACTIVITIES, lineOfSight, npcCanPass, npcLabel, observerName, ORTHOGONAL_COST, paceBudget, personOf, posesAlong,
    previewPicture, profilesOf, sightMap, unknownReach, visibilityMap, worldPoses, type AutoStop, type DeepReadonly, type DoorDoubt, type Evidence, type EvidenceKind, type NpcState, type Pos, type ReadonlyWorld, type SightMap, type State
} from '../sim';
import { doubtStops, viewDoubted, viewOpen } from '../sim/rules/knowledge';
import { rolePortrait } from './views';
import type { ExplainVM } from './worldUi';

/*
 * "It will be found" (§8.10, UI.md "Evidence"): which major evidence the crew knows of the coming world phase will
 * notice, and who. Judged as the safe floor judges the world phase (§8.8, decision 44), on the crew's picture
 * (`previewPicture`: NPCs the crew sees or predicts, the cameras it knows, an unknown feed taken as live, doors it can't
 * vouch for shut), with the very function the world phase applies (`evidenceWorldPhase`), so it neither uses nor leaks
 * what the crew doesn't know.
 *
 * - **Known of**: the major evidence on the picture's map (a body or a tied person the crew sees or predicts, a hole,
 *   things on the floor) with a tile that isn't hidden. A ghost's body isn't: the crew doesn't know how it lies now.
 * - **Certain**: noticed on the picture by a known NPC within the steps of its walk that no door the crew can't vouch
 *   for could stop (`doubtStops`, as the floor's `CertainWalks`), by a known camera once the CCTV room is scouted (its
 *   feed is known), or by the patrol car driving past this phase (`driveByDue`, `patrolSightings`' fields). Sight only
 *   grows as doors open, so the truth notices it too.
 * - **Uncertain**: a known camera of unknown feed status would see it; a known NPC or camera could see it through such
 *   a door, or from beyond one that could stop its walk (`viewDoubted`, `viewOpen`, as the floor's `nextDoubted`); the
 *   patrol could with every door open (someone may open one first); or someone the crew doesn't know about could: an
 *   unknown camera on a hidden tile in sight of it, or an unknown NPC standing or walking within sight of it
 *   (`unknownWalkers`).
 * - **Where an unknown NPC can be** (`unknownAt`, decision 24 sharpened): on a tile that isn't fresh, and that it could
 *   have walked to unseen: nobody unknown stood on the fresh tiles of the last two crew phases (`fresh1`, `fresh2`)
 *   then, so it is within one fastest pace of what wasn't fresh in the last, two of what wasn't in the one before; or
 *   within that of a way in (someone arriving) or of where an NPC the crew no longer knows was last known.
 * - **None**: neither. Then the world phase doesn't notice it (the property test holds it to that).
 */

export type WarningLevel = 'certain' | 'uncertain' | 'none';

/** Who notices an item in the coming world phase, and where they stand when they first see it. */
export interface Finder {
    id: string;
    by: 'npc' | 'camera' | 'patrol';
    from: Pos;
    /** Why it is only a possibility: a door not seen this turn, a camera feed whose status isn't known, a door opened first. */
    why?: 'door' | 'feed' | 'opened';
}

export interface EvidenceWarning {
    /** The evidence's id ('body:<npc>', 'hole:<edge>', a placed item's id). */
    id: string;
    kind: EvidenceKind;
    /** Where it is drawn: the body, or its first tile that isn't hidden. */
    pos: Pos;
    /** The NPC a body or a tied person is. */
    about?: string;
    level: WarningLevel;
    /** Known NPCs and cameras, and the patrol car, that notice it for certain. */
    certain: Finder[];
    /** Those that could notice it, depending on a door the crew can't vouch for or a camera's feed (`why`). */
    doubted: Finder[];
    /** Someone the crew doesn't know about could notice it. */
    unknown: boolean;
}

const CACHE = new WeakMap<State, { world: ReadonlyWorld; out: EvidenceWarning[] }>();

/** Every piece of major evidence the crew knows of, with what the coming world phase does about it. Cached per state. */
export function evidenceWarnings(world: ReadonlyWorld, state: State): EvidenceWarning[] {
    const hit = CACHE.get(state);
    if (hit?.world === world) return hit.out;
    const out = state.phase === 'crew' ? judge(world, state) : [];
    CACHE.set(state, { world, out });
    return out;
}

/** The warnings that show: certain or uncertain. */
export const shownWarnings = (world: ReadonlyWorld, state: State): EvidenceWarning[] => evidenceWarnings(world, state).filter(w => w.level !== 'none');

function judge(world: ReadonlyWorld, state: State): EvidenceWarning[] {
    const picture = previewPicture(world, state), vis = visibilityMap(world, state), w = world.width;
    const hidden = (p: DeepReadonly<Pos>): boolean => vis[p.y * w + p.x] === 0;
    const items = evidenceOnMap(world, picture).filter(e => isMajor(e.kind) && e.tiles.some(p => !hidden(p)));
    if (!items.length) return [];
    const sight = sightMap(world, picture), poses = worldPoses(world, picture, sight), d = doorDoubt(world, state);
    const found = evidenceWorldPhase(world, picture, sight, { poses });
    const npcOf = (id: string) => picture.npcs.find(n => n.id === id);
    // The steps of an NPC's walk no doubted door could stop, or undefined: all of them.
    const cut = (npc: DeepReadonly<NpcState>): number | undefined => {
        if (!d || !npc.intent.path.length) return undefined;
        const pass = npcCanPass(personOf(world, npc.id), npc);
        let prev: DeepReadonly<Pos> = npc.pos;
        for (let i = 0; i < npc.intent.path.length; i++) {
            const p = npc.intent.path[i]!;
            if (doubtStops(world, d, prev, p, pass)) return i;
            prev = p;
        }
        return undefined;
    };
    const patrol = driveByDue(world, state, state.turn);
    return items.map(item => {
        const certain: Finder[] = [], doubted: Finder[] = [], body = item.about ? npcOf(item.about) : undefined;
        const tiles = item.tiles.filter(p => !hidden(p));
        for (const s of found) {
            if (s.evidence !== item.id) continue;
            if (s.by === 'camera') {
                // An unknown feed counts as live on the picture, but it may be looped or dead: only possible.
                const cam = world.cameras.find(c => c.id === s.observer)!, from = { x: cam.pos.x, y: cam.pos.y };
                if (state.knowledge.cctv) certain.push({ id: s.observer, by: 'camera', from });
                else doubted.push({ id: s.observer, by: 'camera', from, why: 'feed' });
                continue;
            }
            const npc = npcOf(s.observer)!, walk = poses.byNpc.get(npc.id) ?? [], k = cut(npc);
            const sure = k === undefined ? walk : walk.slice(0, 1 + k);
            const at = sure.find(p => item.tiles.some(t => bandAt(p.field, t) !== null));
            const seenFrom = at ?? walk.find(p => item.tiles.some(t => bandAt(p.field, t) !== null));
            const finder: Finder = { id: npc.id, by: 'npc', from: { ...(seenFrom ?? walk[0]!).pose.pos } };
            if (at) certain.push(finder);
            else doubted.push({ ...finder, why: 'door' });
        }
        if (d) for (const f of doorFinders(world, picture, sight, d, item, tiles, poses.byNpc, cut)) {
            if (!certain.some(c => c.id === f.id) && !doubted.some(c => c.id === f.id)) doubted.push(f);
        }
        // The patrol car looks as it passes, after the walks and the wake-ups: a body that wakes this phase is gone.
        const waking = item.kind === 'body' && body !== undefined && body.outCold !== null && body.outCold <= state.turn;
        if (patrol && !waking) {
            const sure = patrolSees(world, sight, tiles), could = sure ?? patrolSees(world, openSight(world, state).sight, tiles);
            if (sure) certain.push({ id: 'patrol', by: 'patrol', from: sure });
            else if (could) doubted.push({ id: 'patrol', by: 'patrol', from: could, why: 'opened' });
        }
        const unknown = tiles.some(t => unknownCamera(world, state, t) || unknownWalkers(world, state, t));
        const level: WarningLevel = certain.length ? 'certain' : doubted.length || unknown ? 'uncertain' : 'none';
        const pos = body ? { x: body.pos.x, y: body.pos.y } : { x: tiles[0]!.x, y: tiles[0]!.y };
        return { id: item.id, kind: item.kind, pos, ...(item.about ? { about: item.about } : {}), level, certain, doubted, unknown };
    });
}

/**
 * The known NPCs and cameras a door the crew can't vouch for could let see an item (the floor's `nextDoubted`): an NPC
 * from a pose of its walk (every other door open, as it opens those it walks through), or from beyond a door that
 * could stop it as it would walk on were the door open; a camera where it pans to.
 */
function doorFinders(
    world: ReadonlyWorld, picture: State, sight: SightMap, d: DoorDoubt, item: Evidence, tiles: readonly Pos[],
    byNpc: ReturnType<typeof worldPoses>['byNpc'], cut: (npc: DeepReadonly<NpcState>) => number | undefined
): Finder[] {
    const out: Finder[] = [];
    for (const cam of world.cameras) {
        const pose = cameraObserver(world, picture, cam.id, true);
        if (!pose || picture.cameraEvidence.some(r => r.camera === cam.id && r.evidence === item.id)) continue;
        if (tiles.some(t => viewDoubted(world, d, pose, t))) out.push({ id: cam.id, by: 'camera', from: { x: cam.pos.x, y: cam.pos.y }, why: 'door' });
    }
    for (const npc of picture.npcs) {
        const walk = byNpc.get(npc.id);
        if (!walk || !isPresent(npc) || isEyesDown(npc) || item.about === npc.id || npc.noticed.includes(item.id)) continue;
        const k = cut(npc);
        const poses = k === undefined ? walk : posesAlong(world, picture, sight, npc, npc.intent);
        const at = poses.find((p, j) => tiles.some(t => (k === undefined || j <= k ? viewDoubted(world, d, p.pose, t, true) : viewOpen(world, d, p.pose, t))));
        if (at) out.push({ id: npc.id, by: 'npc', from: { ...at.pose.pos }, why: 'door' });
    }
    return out;
}

/**
 * Where on its lane the patrol car sees any of `tiles` on `sight`, or null: every other lane tile, facing north and
 * south, with calm eyes, as `patrolSightings` looks. The lane is part of the layout.
 */
function patrolSees(world: ReadonlyWorld, sight: SightMap, tiles: readonly Pos[]): Pos | null {
    const lane = world.patrol?.lane ?? [], calm = profilesOf(world).calm;
    for (let i = 0; i < lane.length; i += 2) {
        const pos = lane[i]!;
        for (const facing of ['n', 's'] as const) {
            const field = fieldOn(sight, { pos: { x: pos.x, y: pos.y }, facing, profile: calm });
            if (tiles.some(t => bandAt(field, t) !== null)) return { x: pos.x, y: pos.y };
        }
    }
    return null;
}

// ---------------------------------------------------------------------------------------------------------- Unknown walkers

/** Sight with every door open, on the layout as the player knows it (a hidden tile's contents and inner walls let it through). */
const OPEN_SIGHT = new WeakMap<State, { world: ReadonlyWorld; sight: SightMap; vis: Uint8Array }>();

function openSight(world: ReadonlyWorld, state: State): { sight: SightMap; vis: Uint8Array } {
    const hit = OPEN_SIGHT.get(state);
    if (hit?.world === world) return hit;
    const doors: State['doors'] = {};
    for (const id of Object.keys(state.doors)) doors[id] = { ...state.doors[id]!, status: state.doors[id]!.status === 'breached' ? 'breached' : 'open' };
    const base = sightMap(world, { ...state, doors }), vis = visibilityMap(world, state), w = world.width;
    const tiles = base.tiles.slice(), raised = base.raised.slice(), northSouth = base.northSouth.slice(), eastWest = base.eastWest.slice();
    for (let i = 0; i < vis.length; i++) {
        if (vis[i] !== 0) continue;
        tiles[i] = CLEAR;
        raised[i] = 0;
        const x = i % w, y = (i - x) / w;
        if (x > 0 && vis[i - 1] === 0) northSouth[y * (w + 1) + x] = CLEAR;
        if (y > 0 && vis[i - w] === 0) eastWest[y * w + x] = CLEAR;
    }
    const sight: SightMap = { width: w, height: world.height, tiles, raised, lit: base.lit, northSouth, eastWest };
    const out = { world, sight, vis };
    OPEN_SIGHT.set(state, out);
    return out;
}

/** The fastest pace's budget per world phase, in half-steps. */
const fastest = (world: ReadonlyWorld): number => Math.max(paceBudget(world, 'walk'), paceBudget(world, 'hurry'), paceBudget(world, 'run'));

/** Whether a step between neighbouring tiles could be walked on the layout the player knows (see `walkFrom`). */
function stepOpen(world: ReadonlyWorld, state: State, vis: Uint8Array, a: number, b: number): boolean {
    const w = world.width, ax = a % w, ay = (a - ax) / w, bx = b % w, by = (b - bx) / w;
    if (vis[b] !== 0 && world.tiles[b]!.blocksMove) return false;
    if (ax === bx || ay === by) return edgeOpen(world, state, { x: ax, y: ay }, { x: bx, y: by });
    const viaX = ay * w + bx, viaY = by * w + ax;
    return [viaX, viaY].some(m => (vis[m] === 0 || !world.tiles[m]!.blocksMove) && stepOpen(world, state, vis, a, m) && stepOpen(world, state, vis, m, b));
}

/**
 * The half-steps from the nearest of `from` to every tile, up to `budget` (-1 beyond), over the layout the player
 * knows: every door passable (anyone may open one), raised floor too, a hidden tile's contents no obstacle, diagonals
 * past a corner either way. A walk no NPC could beat.
 */
function walkFrom(world: ReadonlyWorld, state: State, vis: Uint8Array, from: readonly number[], budget: number): Int32Array {
    const w = world.width, h = world.height, cost = new Int32Array(w * h).fill(-1), queue = [...from];
    for (const i of from) cost[i] = 0;
    for (let c = 0; c <= budget && queue.length; c++) {
        for (let q = 0; q < queue.length; q++) {
            const a = queue[q]!;
            if (cost[a] !== c) continue;
            const ax = a % w, ay = (a - ax) / w;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const x = ax + dx, y = ay + dy;
                if ((!dx && !dy) || x < 0 || y < 0 || x >= w || y >= h) continue;
                const b = y * w + x, next = c + (dx && dy ? DIAGONAL_COST : ORTHOGONAL_COST);
                if (next > budget || (cost[b]! >= 0 && cost[b]! <= next) || !stepOpen(world, state, vis, a, b)) continue;
                cost[b] = next;
                queue.push(b);
            }
        }
    }
    return cost;
}

const UNKNOWN_AT = new WeakMap<State, { world: ReadonlyWorld; at: Uint8Array }>();

/**
 * Per tile, 1 where an NPC the crew doesn't know about could stand now (see the header): not fresh, a tile a person
 * can stand on (anywhere hidden), and reachable unseen: within one fastest pace of a tile that wasn't fresh in the
 * last crew phase (`fresh1`) and within two of one that wasn't in the one before (`fresh2`), where a way in (an NPC
 * arriving from off the map) and the last known tile of every NPC the crew knew but doesn't now count as not fresh.
 * Older saves without `fresh1`/`fresh2` count nothing as fresh then.
 */
export function unknownAt(world: ReadonlyWorld, state: State): Uint8Array {
    const hit = UNKNOWN_AT.get(state);
    if (hit?.world === world) return hit.at;
    const vis = visibilityMap(world, state), n = world.width * world.height, k = state.knowledge, pace = fastest(world);
    const extra = new Set<number>();
    for (const person of world.people) {
        for (const b of person.schedule) if (LEAVING_ACTIVITIES.has(b.activity) && b.at) extra.add(b.at.y * world.width + b.at.x);
    }
    for (const id of Object.keys(k.npcs)) {
        const rec = k.npcs[id]!;
        if (!isKnownNow(world, state, id)) extra.add(rec.at.y * world.width + rec.at.x);
    }
    const reach = (bits: string | undefined, budget: number): Int32Array => {
        const was = bits === undefined ? new Uint8Array(n) : decodeBits(bits, n), from = [...extra];
        for (let i = 0; i < n; i++) if (!was[i]) from.push(i);
        return walkFrom(world, state, vis, from, budget);
    };
    const one = reach(k.fresh1, pace), two = reach(k.fresh2, 2 * pace), at = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        if (vis[i] === 2 || (vis[i] !== 0 && world.tiles[i]!.blocksMove)) continue;
        if (one[i]! >= 0 && two[i]! >= 0) at[i] = 1;
    }
    UNKNOWN_AT.set(state, { world, at });
    return at;
}

/** Whether a camera the crew doesn't know about (one on a hidden tile) could see `p`: within a camera's reach, every door open. */
function unknownCamera(world: ReadonlyWorld, state: State, p: Pos): boolean {
    const { sight, vis } = openSight(world, state), w = world.width, r = unknownReach(world, 'camera', world.tiles[p.y * w + p.x]!.lit);
    if (r < 0 || vis[p.y * w + p.x] === 0) return false;
    for (let y = Math.max(0, p.y - r); y <= Math.min(world.height - 1, p.y + r); y++) {
        for (let x = Math.max(0, p.x - r); x <= Math.min(w - 1, p.x + r); x++) {
            if ((x - p.x) ** 2 + (y - p.y) ** 2 <= r * r && vis[y * w + x] === 0 && lineOfSight(sight, { x, y }, p)) return true;
        }
    }
    return false;
}

/**
 * Whether someone the crew doesn't know about could see `p` this world phase: from where one could stand (`unknownAt`),
 * at most the fastest pace's budget over the known layout (`walkFrom`'s rules), to a tile they could stand on with `p`
 * in sight within an Alerted NPC's reach, every door open. A Dijkstra outwards from the tiles that see `p`.
 */
export function unknownWalkers(world: ReadonlyWorld, state: State, p: Pos): boolean {
    const { sight, vis } = openSight(world, state), w = world.width, h = world.height;
    const lit = world.tiles[p.y * w + p.x]!.lit, r = unknownReach(world, 'npc', lit);
    if (r < 0 || vis[p.y * w + p.x] === 0) return false;
    const budget = fastest(world), can = unknownAt(world, state);
    const source = (i: number): boolean => can[i] === 1;
    const cost = new Int32Array(w * h).fill(-1), queue: number[] = [];
    for (let y = Math.max(0, p.y - r); y <= Math.min(h - 1, p.y + r); y++) {
        for (let x = Math.max(0, p.x - r); x <= Math.min(w - 1, p.x + r); x++) {
            const i = y * w + x;
            if ((x - p.x) ** 2 + (y - p.y) ** 2 > r * r || (world.tiles[i]!.blocksMove && vis[i] !== 0)) continue;
            if ((x !== p.x || y !== p.y) && !lineOfSight(sight, { x, y }, p)) continue;
            if (source(i)) return true;
            cost[i] = 0;
            queue.push(i);
        }
    }
    const passable = (a: number, b: number): boolean => stepOpen(world, state, vis, a, b);
    // Few tiles and small costs: a sorted pass per cost is plenty.
    for (let c = 0; c <= budget && queue.length; c++) {
        for (let q = 0; q < queue.length; q++) {
            const a = queue[q]!;
            if (cost[a] !== c) continue;
            const ax = a % w, ay = (a - ax) / w;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const x = ax + dx, y = ay + dy;
                if ((!dx && !dy) || x < 0 || y < 0 || x >= w || y >= h) continue;
                const b = y * w + x, next = c + (dx && dy ? DIAGONAL_COST : ORTHOGONAL_COST);
                if (next > budget || (cost[b]! >= 0 && cost[b]! <= next) || !passable(a, b)) continue;
                if (source(b)) return true;
                cost[b] = next;
                queue.push(b);
            }
        }
    }
    return false;
}

/** Whether a wall stops a step between orthogonal neighbours: a door doesn't (anyone may open it), nor a hole. */
function edgeOpen(world: ReadonlyWorld, state: State, a: Pos, b: Pos): boolean {
    const key = edgeKey(edgeBetween(a, b)), e = world.edges[key];
    return !e || !e.blocksMove || !!e.door || (Object.hasOwn(state.edges, key) && state.edges[key]!.blocksMove === false);
}

// ---------------------------------------------------------------------------------------------------------- Explain

/** Why a finder only could, in "who and why". */
const WHY: Record<NonNullable<Finder['why']>, string> = { door: 'a door not seen this turn', feed: 'if its feed is live', opened: 'if a door is opened first' };

/** How a finder reads in "who and why". */
const finderName = (world: ReadonlyWorld, f: Finder): string => (f.by === 'patrol' ? 'The patrol car' : observerName(world, { observer: f.id, by: f.by }));

const NOUNS: Partial<Record<EvidenceKind, string>> = {
    body: 'the body', tied: 'the tied-up person', hole: 'the hole', weapon: 'the weapon', blood: 'the blood', lootBag: 'the loot bag', drill: 'the drill'
};

/** The long-press lines of a warning (§8.8 "who and why"): each finder and its sightline, then who could. */
export function warningLines(world: ReadonlyWorld, w: EvidenceWarning): ExplainVM['lines'] {
    const what = NOUNS[w.kind] ?? 'it', to = { ...w.pos };
    const line = (f: Finder | null, text: string, outcome: '!' | '-'): ExplainVM['lines'][number] => {
        const person = f?.by === 'npc' ? world.people.find(p => p.id === f.id) : undefined, portrait = person && rolePortrait(person.role);
        return {
            observer: f?.id ?? null, by: f ? (f.by === 'patrol' ? 'camera' : f.by) : 'unknown', ...(portrait ? { portrait } : {}),
            ...(f && f.by !== 'npc' ? { icon: 'camera' as const } : f ? {} : { icon: 'unknown' as const }),
            text: `Next phase: ${text}`, phase: 'next', outcome, from: f ? { ...f.from } : null, to
        };
    };
    return [
        ...w.certain.map(f => line(f, `${finderName(world, f)} ${f.by === 'npc' ? 'finds' : 'spots'} ${what}`, '!')),
        ...w.doubted.map(f => line(f, `${finderName(world, f)} could ${f.by === 'npc' ? 'find' : 'spot'} ${what} (${WHY[f.why ?? 'door']})`, '-')),
        ...(w.unknown ? [line(null, `someone unseen could find ${what}`, '-')] : [])
    ];
}

/**
 * Auto-advance's hold before the end of a turn (`AutoOptions.beforeEnd`): the first evidence a known NPC or camera
 * will certainly notice in that world phase, or null.
 */
export function foundStop(world: ReadonlyWorld, state: State): AutoStop | null {
    const w = evidenceWarnings(world, state).find(x => x.level === 'certain');
    if (!w) return null;
    const f = w.certain[0]!, what = NOUNS[w.kind] ?? 'it';
    if (f.by === 'npc') return { kind: 'evidence', text: `${npcLabel(world, f.id)} would find ${what}`, npc: f.id, at: { ...w.pos } };
    return { kind: 'evidence', text: `${f.by === 'patrol' ? 'the patrol car would spot' : 'a camera would catch'} ${what}`, at: { ...w.pos } };
}
