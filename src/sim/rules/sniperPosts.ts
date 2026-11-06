import { tileAt } from '../core/grid';
import { sortedIds } from '../core/json';
import type { DeepReadonly, Pos, ReadonlyWorld, State } from '../core/types';
import { weaponDef } from '../data/weapons';
import { vehicleAt } from '../geo/drive';
import { buildSightMap, lineOfSight } from '../geo/los';
import { ABSENT_STATUSES } from '../geo/move';
import { offMap } from '../core/transit';
import { inBuilding } from './actions/loot';

/*
 * Where police snipers set up (GAME_DESIGN §13.4 "snipers walk in on foot to their raised positions", §13.6 "Police
 * snipers hold angles on windows and doors from raised positions", §14.7; implementation plan M4-05, decision 304).
 *
 * A post is a tile outside the bank's building a sniper can stand on, from which it sees at least one of the bank's
 * windows: the tile just inside a pane of glass in the building's outer wall, within the DMR's range. Posts are ranked
 * once per World: raised floor first (a neighbour's upper floor, the scaffolding: §14.7's height), then the most
 * windows seen. A sniper takes the best free post, nearest its staging point among equals; a bank without one (no
 * windows, or a test fixture without a building) keeps its snipers at their staging point.
 */

interface Post { pos: Pos; raised: boolean; windows: number }

const POSTS = new WeakMap<ReadonlyWorld, Post[]>();

/** The tiles just inside the glass of the building's outer wall: what a sniper outside watches. */
function windowsOf(world: ReadonlyWorld): Pos[] {
    const out: Pos[] = [];
    for (const key of sortedIds(world.edges)) {
        const edge = world.edges[key]!;
        if (edge.material !== 'glass' || edge.door) continue;
        const [run, xs, ys] = key.split(' '), x = Number(xs), y = Number(ys);
        const a = run === 'northSouth' ? { x: x - 1, y } : { x, y: y - 1 }, b = { x, y };
        if (!tileAt(world, a) || !tileAt(world, b)) continue;
        const ia = inBuilding(world, a), ib = inBuilding(world, b);
        if (ia !== ib) out.push(ia ? a : b);
    }
    return out;
}

/** Every post of the World, best first (see the header). Worked out on the first sniper's arrival and kept. */
export function sniperPosts(world: ReadonlyWorld): readonly Post[] {
    let posts = POSTS.get(world);
    if (posts) return posts;
    posts = [];
    // The bank as built, nothing parked, no door or pane changed: the posts hang on the World alone, so a save loaded
    // later finds the same ones.
    const built = { doors: {}, edges: {}, smoke: [], vehicles: {} } as unknown as State;
    const windows = windowsOf(world), range = weaponDef('dmr').range, sight = buildSightMap(world, built);
    if (world.building && windows.length) {
        for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
            const pos = { x, y }, tile = tileAt(world, pos)!;
            if (tile.room === null || tile.blocksMove || tile.tall || tile.climb || inBuilding(world, pos)) continue;
            let seen = 0;
            for (const w of windows) {
                const dx = w.x - x, dy = w.y - y;
                if (dx * dx + dy * dy <= range * range && lineOfSight(sight, pos, w)) seen++;
            }
            if (seen) posts.push({ pos, raised: tile.raised, windows: seen });
        }
    }
    posts.sort((a, b) => Number(b.raised) - Number(a.raised) || b.windows - a.windows || a.pos.y - b.pos.y || a.pos.x - b.pos.x);
    POSTS.set(world, posts);
    return posts;
}

/**
 * The post a sniper arriving at `staging` takes now: the best one nobody stands on (crew, NPC, officer) and no vehicle
 * covers, nearest the staging point among posts as good; null when there is none.
 */
export function sniperPost(world: ReadonlyWorld, state: State, staging: DeepReadonly<Pos>): Pos | null {
    const taken = new Set<number>();
    for (const c of state.crew) if (!offMap(c)) taken.add(c.pos.y * world.width + c.pos.x);
    for (const n of state.npcs) if (!ABSENT_STATUSES.has(n.status)) taken.add(n.pos.y * world.width + n.pos.x);
    for (const u of state.police.units) if (u.pos) taken.add(u.pos.y * world.width + u.pos.x);
    const d2 = (p: Pos): number => (p.x - staging.x) * (p.x - staging.x) + (p.y - staging.y) * (p.y - staging.y);
    const free = sniperPosts(world).filter(p => !taken.has(p.pos.y * world.width + p.pos.x) && vehicleAt(world, state, p.pos) === undefined);
    const best = free[0];
    if (!best) return null;
    const pick = free.filter(p => p.raised === best.raised && p.windows === best.windows).sort((a, b) => d2(a.pos) - d2(b.pos) || a.pos.y - b.pos.y || a.pos.x - b.pos.x)[0]!;
    return { ...pick.pos };
}
