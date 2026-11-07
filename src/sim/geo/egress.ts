import { edgeBetween, edgeKey, FACING_STEP, inBounds, samePos } from '../core/grid';
import type { DeepReadonly, DoorDef, Pos, ReadonlyWorld, Tile, Zone } from '../core/types';

/*
 * Exit hardware (GAME_DESIGN §8.6, implementation plan decision 461). Every leaf door with a lock lets people out
 * without its key from one side, its **exit side**, as a thumb-turn, a lever or a push bar does in any office: the
 * latch keeps people out, never in. So a challenged crew member can always walk back to the Public floor ("they walk
 * out themselves, using their normal actions"), and nobody has to pick a lock in the challenger's sight to comply.
 *
 * The exit side is the side away from the Public floor, worked out once per world from the layout alone (not from
 * who holds which card, nor from what the crew knows: a door's hardware is part of its layout, seen on it like its
 * lock, decision 44): `egressDistance` is the walk to the nearest Public tile (orthogonal steps, walls stop it, every
 * door passes but the vault's, raised floor only by its climb tiles), where a walk outwards from the Public floor never
 * crosses a door into a lower zone. A door's exit side is the side strictly farther from the Public floor whose zone
 * is no lower than the other's (Public < Staff < Secure), so between zones it is always the higher zone's side (the
 * inner side of decision 25), and a way back from any tile the walk reaches crosses every door from its exit side. A
 * door with both sides as far, or a vault door, has none.
 */

const ZONE_RANK: Readonly<Record<Zone, number>> = { public: 0, staff: 1, secure: 2 };

const ORTHOGONAL: readonly Pos[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];

/** Whether a tile's climb leads to `q` (raised floor is entered and left only by its climb tiles). */
const climbsTo = (tile: DeepReadonly<Tile>, p: Pos, q: Pos): boolean =>
    !!tile.climb && p.x + FACING_STEP[tile.climb.to].x === q.x && p.y + FACING_STEP[tile.climb.to].y === q.y;

const DISTANCES = new WeakMap<ReadonlyWorld, Int32Array>();

/** Steps from each tile to the nearest Public tile over the layout (-1: none), as the header says. Per world. */
export function egressDistance(world: ReadonlyWorld): Int32Array {
    const hit = DISTANCES.get(world);
    if (hit) return hit;
    const w = world.width, n = w * world.height, dist = new Int32Array(n).fill(-1), queue: number[] = [];
    for (let i = 0; i < n; i++) {
        const t = world.tiles[i]!;
        if (t.zone === 'public' && !t.blocksMove) { dist[i] = 0; queue.push(i); }
    }
    for (let q = 0; q < queue.length; q++) {
        const i = queue[q]!, a = { x: i % w, y: Math.floor(i / w) }, from = world.tiles[i]!;
        for (const d of ORTHOGONAL) {
            const b = { x: a.x + d.x, y: a.y + d.y };
            if (!inBounds(world, b)) continue;
            const j = b.y * w + b.x, to = world.tiles[j]!;
            if (dist[j] !== -1 || to.blocksMove) continue;
            if (from.raised !== to.raised && !climbsTo(from, a, b) && !climbsTo(to, b, a)) continue;
            const edge = world.edges[edgeKey(edgeBetween(a, b))];
            if (edge?.blocksMove) {
                const door = edge.door ? world.doors[edge.door] : undefined;
                if (!door || door.lock === 'vault' || ZONE_RANK[to.zone] < ZONE_RANK[from.zone]) continue;
            }
            dist[j] = dist[i]! + 1;
            queue.push(j);
        }
    }
    DISTANCES.set(world, dist);
    return dist;
}

/** The two tiles either side of a door's edge: the one north or west of it, then the one south or east. */
function sidesOf(world: ReadonlyWorld, door: DeepReadonly<DoorDef>): [Pos, Pos] | undefined {
    const edge = world.edges[door.edge];
    if (!edge) return undefined;
    const b = { x: edge.tx, y: edge.ty };
    return [edge.run === 'eastWest' ? { x: edge.tx, y: edge.ty - 1 } : { x: edge.tx - 1, y: edge.ty }, b];
}

/** Whether `p` is a door's exit side (see the header): a locked door opens from there without its key. */
export function exitSide(world: ReadonlyWorld, door: DeepReadonly<DoorDef>, p: DeepReadonly<Pos>): boolean {
    if (door.lock === 'none' || door.lock === 'vault') return false;
    const sides = sidesOf(world, door);
    if (!sides || !sides.every(s => inBounds(world, s))) return false;
    const [a, b] = sides;
    if (!samePos(a, p) && !samePos(b, p)) return false;
    const here = samePos(a, p) ? a : b, there = here === a ? b : a, w = world.width, dist = egressDistance(world);
    const out = dist[there.y * w + there.x]!, mine = dist[here.y * w + here.x]!;
    if (out < 0 || (mine >= 0 && mine <= out)) return false;
    return ZONE_RANK[world.tiles[here.y * w + here.x]!.zone] >= ZONE_RANK[world.tiles[there.y * w + there.x]!.zone];
}
