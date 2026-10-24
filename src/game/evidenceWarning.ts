import {
    bandAt, cameraObserver, CLEAR, DIAGONAL_COST, doorDoubt, edgeBetween, edgeKey, evidenceOnMap, evidenceWorldPhase, isEyesDown, isMajor, isPresent,
    isUnknownRisk, lineOfSight, npcCanPass, npcLabel, observerName, ORTHOGONAL_COST, paceBudget, personOf, posesAlong, previewPicture, sightMap, unknownReach, visibilityMap,
    worldPoses, type AutoStop, type DeepReadonly, type DoorDoubt, type Evidence, type EvidenceKind, type NpcState, type Pos, type ReadonlyWorld, type SightMap, type State
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
 *   for could stop (`doubtStops`, as the floor's `CertainWalks`), or by a known camera. Sight only grows as doors open,
 *   so the truth notices it too.
 * - **Uncertain**: a known NPC or camera could see it through such a door, or from beyond one that could stop its walk
 *   (`viewDoubted`, `viewOpen`, as the floor's `nextDoubted`); or someone the crew doesn't know about could: an unknown
 *   camera or someone standing in unknown space in sight of it (`isUnknownRisk`), or someone walking there first: from
 *   any tile that isn't fresh (decision 24: nobody unknown stands on a fresh one), as far as the fastest pace walks in a
 *   world phase, over the layout the player knows with every door open, then in sight within an Alerted NPC's reach
 *   (`unknownWalkers`).
 * - **None**: neither. Then the world phase doesn't notice it (the property test holds it to that).
 */

export type WarningLevel = 'certain' | 'uncertain' | 'none';

/** Who notices an item in the coming world phase, and where they stand when they first see it. */
export interface Finder { id: string; by: 'npc' | 'camera'; from: Pos }

export interface EvidenceWarning {
    /** The evidence's id ('body:<npc>', 'hole:<edge>', a placed item's id). */
    id: string;
    kind: EvidenceKind;
    /** Where it is drawn: the body, or its first tile that isn't hidden. */
    pos: Pos;
    /** The NPC a body or a tied person is. */
    about?: string;
    level: WarningLevel;
    /** Known NPCs and cameras that notice it for certain. */
    certain: Finder[];
    /** Known NPCs and cameras that could notice it, depending on a door the crew can't vouch for. */
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
        const pass = npcCanPass(personOf(world, npc.id));
        let prev: DeepReadonly<Pos> = npc.pos;
        for (let i = 0; i < npc.intent.path.length; i++) {
            const p = npc.intent.path[i]!;
            if (doubtStops(world, d, prev, p, pass)) return i;
            prev = p;
        }
        return undefined;
    };
    return items.map(item => {
        const certain: Finder[] = [], doubted: Finder[] = [];
        const tiles = item.tiles.filter(p => !hidden(p));
        for (const s of found) {
            if (s.evidence !== item.id) continue;
            if (s.by === 'camera') {
                const cam = world.cameras.find(c => c.id === s.observer)!;
                certain.push({ id: s.observer, by: 'camera', from: { x: cam.pos.x, y: cam.pos.y } });
                continue;
            }
            const npc = npcOf(s.observer)!, walk = poses.byNpc.get(npc.id) ?? [], k = cut(npc);
            const sure = k === undefined ? walk : walk.slice(0, 1 + k);
            const at = sure.find(p => item.tiles.some(t => bandAt(p.field, t) !== null));
            const seenFrom = at ?? walk.find(p => item.tiles.some(t => bandAt(p.field, t) !== null));
            const finder: Finder = { id: npc.id, by: 'npc', from: { ...(seenFrom ?? walk[0]!).pose.pos } };
            (at ? certain : doubted).push(finder);
        }
        if (d) for (const f of doorFinders(world, picture, sight, d, item, tiles, poses.byNpc, cut)) {
            if (!certain.some(c => c.id === f.id) && !doubted.some(c => c.id === f.id)) doubted.push(f);
        }
        const unknown = tiles.some(t => isUnknownRisk(world, state, t) || unknownWalkers(world, state, t));
        const level: WarningLevel = certain.length ? 'certain' : doubted.length || unknown ? 'uncertain' : 'none';
        const body = item.about ? npcOf(item.about) : undefined;
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
        if (tiles.some(t => viewDoubted(world, d, pose, t))) out.push({ id: cam.id, by: 'camera', from: { x: cam.pos.x, y: cam.pos.y } });
    }
    for (const npc of picture.npcs) {
        const walk = byNpc.get(npc.id);
        if (!walk || !isPresent(npc) || isEyesDown(npc) || item.about === npc.id || npc.noticed.includes(item.id)) continue;
        const k = cut(npc);
        const poses = k === undefined ? walk : posesAlong(world, picture, sight, npc, npc.intent);
        const at = poses.find((p, j) => tiles.some(t => (k === undefined || j <= k ? viewDoubted(world, d, p.pose, t, true) : viewOpen(world, d, p.pose, t))));
        if (at) out.push({ id: npc.id, by: 'npc', from: { ...at.pose.pos } });
    }
    return out;
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

/**
 * Whether someone the crew doesn't know about could walk, this world phase, to where they see `p`: from any tile that
 * isn't fresh (anywhere hidden; a stale one a person can stand on), at most the fastest pace's budget over the known
 * layout (every door passable, raised floor too), to a tile they could stand on with `p` in sight within an Alerted
 * NPC's reach, every door open. A Dijkstra outwards from the tiles that see `p`.
 */
export function unknownWalkers(world: ReadonlyWorld, state: State, p: Pos): boolean {
    const { sight, vis } = openSight(world, state), w = world.width, h = world.height;
    const lit = world.tiles[p.y * w + p.x]!.lit, r = unknownReach(world, 'npc', lit);
    if (r < 0 || vis[p.y * w + p.x] === 0) return false;
    const budget = Math.max(paceBudget(world, 'walk'), paceBudget(world, 'hurry'), paceBudget(world, 'run'));
    const fresh = (i: number): boolean => vis[i] === 2;
    const source = (i: number): boolean => !fresh(i) && (vis[i] === 0 || !world.tiles[i]!.blocksMove);
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
    const passable = (a: number, b: number): boolean => {
        const ax = a % w, ay = (a - ax) / w, bx = b % w, by = (b - bx) / w;
        if (vis[b] !== 0 && world.tiles[b]!.blocksMove) return false;
        if (ax === bx || ay === by) return edgeOpen(world, state, { x: ax, y: ay }, { x: bx, y: by });
        const viaX = ay * w + bx, viaY = by * w + ax;
        return [viaX, viaY].some(m => (vis[m] === 0 || !world.tiles[m]!.blocksMove) && passable(a, m) && passable(m, b));
    };
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

const NOUNS: Partial<Record<EvidenceKind, string>> = {
    body: 'the body', tied: 'the tied-up person', hole: 'the hole', weapon: 'the weapon', blood: 'the blood', lootBag: 'the loot bag', drill: 'the drill'
};

/** The long-press lines of a warning (§8.8 "who and why"): each finder and its sightline, then who could. */
export function warningLines(world: ReadonlyWorld, w: EvidenceWarning): ExplainVM['lines'] {
    const what = NOUNS[w.kind] ?? 'it', to = { ...w.pos };
    const line = (f: Finder | null, text: string, outcome: '!' | '-'): ExplainVM['lines'][number] => {
        const person = f?.by === 'npc' ? world.people.find(p => p.id === f.id) : undefined, portrait = person && rolePortrait(person.role);
        return {
            observer: f?.id ?? null, by: f ? f.by : 'unknown', ...(portrait ? { portrait } : {}),
            ...(f?.by === 'camera' ? { icon: 'camera' as const } : f ? {} : { icon: 'unknown' as const }),
            text: `Next phase: ${text}`, phase: 'next', outcome, from: f ? { ...f.from } : null, to
        };
    };
    return [
        ...w.certain.map(f => line(f, `${observerName(world, { observer: f.id, by: f.by })} finds ${what}`, '!')),
        ...w.doubted.map(f => line(f, `${observerName(world, { observer: f.id, by: f.by })} could find ${what} (a door not seen this turn)`, '-')),
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
    return f.by === 'npc'
        ? { kind: 'evidence', text: `${npcLabel(world, f.id)} would find ${what}`, npc: f.id, at: { ...w.pos } }
        : { kind: 'evidence', text: `a camera would catch ${what}`, at: { ...w.pos } };
}
