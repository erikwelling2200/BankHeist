import { sortedIds } from '../core/json';
import { edgeNow } from '../core/state';
import type { EdgeKey, Material, Pos, ReadonlyWorld, State } from '../core/types';
import { COVER_BLOCK, OVERPENETRATION, PRECISION, SOFT_WALL, TELLER_GLASS } from '../data/weapons';
import { rotate } from './angles';

/*
 * The bullet trace (GAME_DESIGN §11.2–11.6, §14.2 Bullets; implementation plan §6 decisions 85–92). One function
 * follows one bullet from the shooter's tile along a ray and says what it met, in order; `previewShot` and
 * `resolveShot` (rules/shot.ts) both call it, so for the same rolled points they see the same trace.
 *
 * - **The ray** starts in the middle of the origin tile (the shooter's, or the tile they lean out to) and runs along
 *   the aim line turned by the bullet's offset. It is walked tile by tile in order (a supercover walk, as sight's,
 *   geo/los.ts), and stops on the first tile beyond the weapon's range (decision 85), off the map, or at what stops it.
 * - **Bodies** are discs half a tile wide in the middle of their tile (§11.3: 14.4° at 2 tiles, 7.2° at 4, 3.6° at 8),
 *   hit when the ray passes within a quarter tile of the middle. Lying people are passed over, except the one aimed at
 *   (`Body.standing`); anyone on the origin tile is fired past. An escorted hostage stands on its escort's tile and is
 *   met first (`Body.shield`, §10 "a real shield", decision 88).
 * - **Walls** (§11.6): glass passes and shatters on its first hit; teller glass counts its hits, lets only Pierce 3
 *   through and shatters at the 4th; a Soft wall or wooden door lets Pierce 1 through with 1 damage less (a bullet left
 *   with none stops in it); Reinforced, Vault and the plot's edge stop all; a fence, a railing, an open door, a hole
 *   or a shattered pane are nothing to it. Full-height objects stop bullets; middle-height ones (vehicles) too, unless
 *   the shooter's tile or the aimed-at tile is raised (sight's rule, §14.7).
 * - **Corners** (decision 6's rule for bullets, decision 86): a ray exactly through a grid corner passes only if all four
 *   edges that meet there and both tiles beside it would let it by untouched; otherwise it stops there.
 * - **Half cover** (§11.4, decision 87) is judged per target from the attack's geometry, not the bullet's: from the
 *   origin tile to the target's tile, exact in integers. A tile of half cover beside the target, a railing on one of
 *   its edges, or the corner a leaning person leans past covers it when the origin lies in the 90° arc facing it,
 *   edges included; a shooter on raised floor ignores the half cover of a target on the ground (§14.7). A covered hit
 *   is blocked on a draw below 0.5 (`coverDraw`, rolled only when there is cover); a blocked bullet stops and damages
 *   the cover by its damage, until it breaks.
 * - **Damage** per hit is max(0, Damage − max(0, Armour − Pierce)) (§11.5), the shotgun's +1 within 3 tiles added to
 *   Damage first, the DMR's ×1.5 on Calm, Curious or Surprised targets applied to what is dealt, rounded down. Pierce 3
 *   passes the first body hit with 3 damage less (overpenetration); a bullet stops at the second.
 *
 * What changes as bullets fly (panes, teller glass's hits, cover's hit points) is the `Fabric`, which the trace updates
 * bullet by bullet, so a later bullet of the same attack meets a shattered pane or a broken desk. Bodies don't fall
 * mid-attack: the bullets of one attack all fly before anyone hit goes down (decision 89).
 *
 * Only + − × ÷ and `Math.sqrt` here (geo/angles.ts for turning): the same bits in every engine.
 */

declare module '../core/types' {
    interface EdgeProps {
        /** A pane shot out (§11.4): glass or teller glass that bullets and sound now pass freely. */
        shattered?: boolean;
        /** Teller glass's hits so far (§11.4: it shatters after 4). */
        hits?: number;
    }
    interface Tile {
        /** The hit points of the half cover on it (§11.4); absent on a half-cover tile: it can't be destroyed. */
        coverHp?: number;
    }
}

/** A body's half width: a standing body is half a tile wide (§11.3). */
export const BODY_RADIUS = 0.25;
const BODY_R2 = BODY_RADIUS * BODY_RADIUS;

/** `ShotMap.cover` values besides hit points left (≥ 1). */
export const NO_COVER = -1, INDESTRUCTIBLE = -2;

/** A wall segment as a bullet meets it now. */
export interface BulletEdge {
    key: EdgeKey;
    material: Material;
    /** Nothing there to meet: an open or breached door, a hole. */
    open: boolean;
    /** A railing or low wall: half cover for the tiles either side (§11.4). */
    halfCover: boolean;
    /** The tiles either side (row-major indices), −1 off the map. */
    sides: [number, number];
}

/** What bullets need from the World and the State, flattened; built once per shot (`shotMap`). */
export interface ShotMap {
    readonly width: number;
    readonly height: number;
    /** Per tile: 1 full height, 2 middle height, 0 nothing that stops a bullet. */
    readonly tiles: Uint8Array;
    readonly raised: Uint8Array;
    /** Per boundary, as `SightMap`'s: the index into `edges`, or −1. */
    readonly northSouth: Int32Array;
    readonly eastWest: Int32Array;
    readonly edges: readonly BulletEdge[];
}

/** What bullets change: panes, teller glass's hits and cover's hit points. Each trace gets its own copy. */
export interface Fabric {
    /** Per edge index: 1 once shattered. */
    shattered: Uint8Array;
    /** Per edge index: teller glass's hits. */
    hits: Uint8Array;
    /** Per tile: the half cover's hit points left, or `NO_COVER` (none, or broken), or `INDESTRUCTIBLE`. */
    cover: Int32Array;
}

/** Someone a bullet can meet. */
export interface Body {
    id: string;
    /** The tile their hitbox is on (where they lean out to, while leaning). */
    pos: Pos;
    /** Up, or the one aimed at: lying people are passed over (§11.3). */
    standing: boolean;
    /** Met before anyone else on the tile: a hostage held in front of its escort. */
    shield: boolean;
    armour: number;
    /** The DMR's precision bonus applies (Calm, Curious or Surprised, §11.5). */
    precise: boolean;
    /** Leaning past a corner: the diagonal toward it, whose quadrant the corner covers (§11.4 leaning). */
    lean?: Pos;
}

/** One bullet's numbers. */
export interface BulletSpec {
    damage: number;
    pierce: number;
    close?: { within: number; damage: number };
    precision?: true;
    knockout?: true;
}

/** Everything one attack's trace reads. */
export interface ShotScene {
    map: ShotMap;
    /** The fabric before the first bullet. */
    fabric: Fabric;
    /** By tile index, in the order a bullet meets them: shields first, then by id. */
    bodies: ReadonlyMap<number, readonly Body[]>;
    origin: Pos;
    /** The aim line, a unit vector. */
    aim: readonly [number, number];
    /** Squared range in tiles: a tile further than this from the origin stops the bullet. */
    rangeSq: number;
    /** A middle-height object doesn't stop it: the origin or the aimed-at tile is raised. */
    high: boolean;
    bullet: BulletSpec;
    /**
     * Tiles a preview may not trace into (1): the crew's hidden tiles (`ShotView`). A bullet stops as it would enter
     * one ('unknown'); outcomes never set it.
     */
    hidden?: Uint8Array;
}

/**
 * What the crew knows of the map, for a preview the player sees (preview/shot.ts `crewShotPreview`): `hidden` tiles
 * (neither on the blueprint nor ever seen) and the tiles it sees this turn (`seen`) (1 each, row-major). Past a hidden tile
 * nothing is traced; panes, teller glass's hits and cover's wear show as they are only where a tile beside them is
 * seen this turn, and as built elsewhere (what moves or breaks is known only while seen, decision 44).
 */
export interface ShotView { hidden: Uint8Array; seen: Uint8Array }

/** Where cover protected a target, and what is left of it. */
export interface CoverHit {
    kind: 'tile' | 'edge' | 'lean';
    /** The cover tile ("x y"), the railing's edge key, or the leaning person's tile. */
    at: string;
    /** Hit points left after this bullet; null can't be destroyed. */
    hp: number | null;
    destroyed?: true;
}

export type ShotStep =
    | { kind: 'wall'; edge: EdgeKey; material: Material; effect: 'shattered' | 'passed' | 'slowed' | 'stopped'; damage: number; broke?: true }
    | { kind: 'body'; id: string; effect: 'hit' | 'through' | 'blocked'; damage: number; knockout?: true; cover?: CoverHit }
    | { kind: 'object'; tile: Pos }
    | { kind: 'corner'; at: Pos };

export type BulletStop = 'body' | 'cover' | 'wall' | 'object' | 'corner' | 'range' | 'map' | 'unknown';

/** One bullet's path: what it met, in order, and where it ended (in tiles, to 1/1000). */
export interface BulletTrace {
    /** Its angle off the aim line, degrees. */
    offset: number;
    steps: ShotStep[];
    stop: BulletStop;
    end: { x: number; y: number };
}

export const tileKey = (p: Pos): string => `${p.x} ${p.y}`;

/** The shot map of a world in a state. Built per shot, not cached: it is cheap next to the fan. */
export function shotMap(world: ReadonlyWorld, state: State): ShotMap {
    const { width, height } = world;
    const tiles = new Uint8Array(width * height), raised = new Uint8Array(width * height);
    world.tiles.forEach((t, i) => {
        tiles[i] = t.tall ? 1 : t.midHeight ? 2 : 0;
        raised[i] = t.raised ? 1 : 0;
    });
    const northSouth = new Int32Array((width + 1) * height).fill(-1), eastWest = new Int32Array(width * (height + 1)).fill(-1);
    const edges: BulletEdge[] = [];
    for (const key of sortedIds(world.edges)) {
        const e = world.edges[key]!, now = edgeNow(world, state, key)!;
        const index = edges.length;
        if (e.run === 'northSouth') {
            if (e.tx < 0 || e.tx > width || e.ty < 0 || e.ty >= height) continue;
            northSouth[e.ty * (width + 1) + e.tx] = index;
        } else {
            if (e.tx < 0 || e.tx >= width || e.ty < 0 || e.ty > height) continue;
            eastWest[e.ty * width + e.tx] = index;
        }
        const a = e.run === 'northSouth' ? (e.tx > 0 ? e.ty * width + e.tx - 1 : -1) : (e.ty > 0 ? (e.ty - 1) * width + e.tx : -1);
        const b = e.run === 'northSouth' ? (e.tx < width ? e.ty * width + e.tx : -1) : (e.ty < height ? e.ty * width + e.tx : -1);
        edges.push({ key, material: now.material, open: !now.blocksMove && !now.blocksSight, halfCover: !!e.halfCover, sides: [a, b] });
    }
    return { width, height, tiles, raised, northSouth, eastWest, edges };
}

/** The fabric of a world in a state: shattered panes, teller glass's hits, and cover's hit points (`State.cover`). */
export function shotFabric(world: ReadonlyWorld, state: State, map: ShotMap, coverLeft: Readonly<Record<string, number>>): Fabric {
    const shattered = new Uint8Array(map.edges.length), hits = new Uint8Array(map.edges.length);
    map.edges.forEach((e, i) => {
        const now = edgeNow(world, state, e.key)!;
        if (now.shattered) shattered[i] = 1;
        hits[i] = now.hits ?? 0;
    });
    const cover = new Int32Array(world.width * world.height).fill(NO_COVER);
    world.tiles.forEach((t, i) => {
        if (!t.halfCover) return;
        const key = `${i % world.width} ${Math.floor(i / world.width)}`;
        if (t.coverHp === undefined) cover[i] = INDESTRUCTIBLE;
        else {
            const left = Object.hasOwn(coverLeft, key) ? coverLeft[key]! : t.coverHp;
            cover[i] = left > 0 ? left : NO_COVER;
        }
    });
    return { shattered, hits, cover };
}

export const copyFabric = (f: Fabric): Fabric => ({ shattered: f.shattered.slice(), hits: f.hits.slice(), cover: f.cover.slice() });

/** The four sides of a tile, in the order cover is preferred on a tie: north, east, south, west. */
const SIDES: readonly Pos[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];

/** The edge index on the side of tile (x, y) toward (x + sx, y + sy), one of sx, sy zero; −1 for none. */
function sideEdge(map: ShotMap, x: number, y: number, sx: number, sy: number): number {
    if (sx) return map.northSouth[y * (map.width + 1) + (sx > 0 ? x + 1 : x)]!;
    return map.eastWest[(sy > 0 ? y + 1 : y) * map.width + x]!;
}

/** A cover source facing the shot, before the roll. */
interface CoverSource { kind: CoverHit['kind']; at: string; tile: number; score: number }

/**
 * The half cover protecting a body against a shot from `origin` (decision 87), or null when flanked or uncovered: the
 * source whose arc holds the origin most squarely; on a tie a tile before a railing before a lean, north first.
 */
export function coverAgainst(map: ShotMap, fabric: Fabric, body: Body, origin: Pos): CoverSource | null {
    const { width, height } = map;
    const t = body.pos, ti = t.y * width + t.x;
    if (map.raised[origin.y * width + origin.x] && !map.raised[ti]) return null;
    const vx = origin.x - t.x, vy = origin.y - t.y;
    if (!vx && !vy) return null;
    let best: CoverSource | null = null;
    const offer = (c: CoverSource): void => {
        if (!best || c.score > best.score) best = c;
    };
    for (const kind of ['tile', 'edge'] as const) {
        for (const n of SIDES) {
            const along = vx * n.x + vy * n.y, side = Math.abs(vx * n.y - vy * n.x);
            if (along <= 0 || side > along) continue;
            const e = sideEdge(map, t.x, t.y, n.x, n.y), edge = e >= 0 ? map.edges[e]! : undefined;
            if (kind === 'edge') {
                if (edge?.halfCover) offer({ kind, at: edge.key, tile: -1, score: along * along });
                continue;
            }
            const cx = t.x + n.x, cy = t.y + n.y;
            if (cx < 0 || cy < 0 || cx >= width || cy >= height || (edge && !edge.open)) continue;
            const ci = cy * width + cx;
            if (fabric.cover[ci] !== NO_COVER) offer({ kind, at: `${cx} ${cy}`, tile: ci, score: along * along });
        }
    }
    const lean = body.lean;
    if (lean && vx * lean.x >= 0 && vy * lean.y >= 0) {
        const along = vx * lean.x + vy * lean.y;
        offer({ kind: 'lean', at: tileKey(t), tile: -1, score: (along * along) / 2 });
    }
    return best;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000 + 0;

/**
 * One bullet of an attack, `offset` degrees off the aim line, through `fabric` (changed in place). `coverDraw` gives
 * the cover roll, a number in [0, 1), and is called only for a covered hit; the bullet is blocked below 0.5.
 */
export function traceBullet(scene: ShotScene, fabric: Fabric, offset: number, coverDraw: (body: Body) => number): BulletTrace {
    const { map, origin, bullet } = scene, { width, height } = map;
    const [dx, dy] = rotate(scene.aim[0], scene.aim[1], offset);
    const px = origin.x + 0.5, py = origin.y + 0.5;
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const tDeltaX = sx ? 1 / Math.abs(dx) : Infinity, tDeltaY = sy ? 1 / Math.abs(dy) : Infinity;
    let tMaxX = sx ? 0.5 * tDeltaX : Infinity, tMaxY = sy ? 0.5 * tDeltaY : Infinity;
    let x = origin.x, y = origin.y, t = 0, damage = bullet.damage, passedBody = false;
    const steps: ShotStep[] = [];
    const done = (stop: BulletStop): BulletTrace => ({ offset, steps, stop, end: { x: round3(px + dx * t), y: round3(py + dy * t) } });

    /** Meets a wall segment: whether the bullet goes on. */
    const wall = (index: number): boolean => {
        if (index < 0) return true;
        const e = map.edges[index]!;
        if (e.open || fabric.shattered[index] || e.material === 'fence' || e.material === 'rail') return true;
        // A taser's darts stop at any pane or wall, and break nothing (decision 86).
        if (bullet.knockout) {
            steps.push({ kind: 'wall', edge: e.key, material: e.material, effect: 'stopped', damage });
            return false;
        }
        const step = (effect: 'shattered' | 'passed' | 'slowed' | 'stopped', broke = false): void => {
            steps.push(broke ? { kind: 'wall', edge: e.key, material: e.material, effect, damage, broke: true } : { kind: 'wall', edge: e.key, material: e.material, effect, damage });
        };
        switch (e.material) {
            case 'glass':
                fabric.shattered[index] = 1;
                step('shattered');
                return true;
            case 'tellerGlass': {
                const hits = ++fabric.hits[index]!, broke = hits >= TELLER_GLASS.hits;
                if (broke) fabric.shattered[index] = 1;
                const through = bullet.pierce >= TELLER_GLASS.pierce;
                step(through ? 'passed' : 'stopped', broke);
                return through;
            }
            case 'soft':
                if (bullet.pierce >= SOFT_WALL.pierce && damage > SOFT_WALL.loss) {
                    damage -= SOFT_WALL.loss;
                    step('slowed');
                    return true;
                }
                step('stopped');
                return false;
            default:
                step('stopped');
                return false;
        }
    };
    /** Whether a wall segment would let the bullet by untouched (a corner's test). */
    const clear = (index: number): boolean => {
        if (index < 0) return true;
        const e = map.edges[index]!;
        return e.open || !!fabric.shattered[index] || e.material === 'fence' || e.material === 'rail';
    };
    const stopsAt = (i: number): boolean => map.tiles[i] === 1 || (map.tiles[i] === 2 && !scene.high);

    /** Meets the bodies on tile (x, y): null when the bullet goes on, else what stopped it. */
    const bodies = (): 'body' | 'cover' | null => {
        const here = scene.bodies.get(y * width + x);
        if (!here) return null;
        const wx = x + 0.5 - px, wy = y + 0.5 - py;
        const along = wx * dx + wy * dy, across = wx * dy - wy * dx;
        if (along <= 0 || across * across > BODY_R2) return null;
        const meet = along - Math.sqrt(BODY_R2 - across * across);
        const ox = x - origin.x, oy = y - origin.y, distSq = ox * ox + oy * oy;
        for (const body of here) {
            if (!body.standing) continue;
            t = meet;
            const raw = damage + (bullet.close && distSq <= bullet.close.within * bullet.close.within ? bullet.close.damage : 0);
            const source = coverAgainst(map, fabric, body, origin);
            let cover: CoverHit | undefined;
            if (source) {
                const hp = source.tile >= 0 && fabric.cover[source.tile] !== INDESTRUCTIBLE ? fabric.cover[source.tile]! : null;
                cover = { kind: source.kind, at: source.at, hp };
                if (coverDraw(body) < COVER_BLOCK) {
                    if (hp !== null) {
                        const left = hp - raw;
                        fabric.cover[source.tile] = left > 0 ? left : NO_COVER;
                        cover = left > 0 ? { ...cover, hp: left } : { ...cover, hp: 0, destroyed: true };
                    }
                    steps.push({ kind: 'body', id: body.id, effect: 'blocked', damage: 0, cover });
                    return 'cover';
                }
            }
            let dealt = bullet.knockout ? 0 : Math.max(0, raw - Math.max(0, body.armour - bullet.pierce));
            if (bullet.precision && body.precise) dealt = Math.floor(dealt * PRECISION);
            const through = !passedBody && !bullet.knockout && bullet.pierce >= OVERPENETRATION.pierce && damage > OVERPENETRATION.loss;
            const step: ShotStep = { kind: 'body', id: body.id, effect: through ? 'through' : 'hit', damage: dealt };
            if (bullet.knockout) step.knockout = true;
            if (cover) step.cover = cover;
            steps.push(step);
            if (!through) return 'body';
            passedBody = true;
            damage -= OVERPENETRATION.loss;
        }
        return null;
    };

    for (;;) {
        const met = x !== origin.x || y !== origin.y ? bodies() : null;
        if (met) return done(met);
        let nx = x, ny = y;
        const corner = tMaxX === tMaxY;
        if (tMaxX < tMaxY || corner) { nx += sx; t = tMaxX; }
        if (tMaxY < tMaxX || corner) { ny += sy; t = tMaxY; }
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return done('map');
        const ox = nx - origin.x, oy = ny - origin.y;
        if (ox * ox + oy * oy > scene.rangeSq) return done('range');
        const hidden = scene.hidden;
        if (hidden && (hidden[ny * width + nx] || (corner && (hidden[y * width + nx] || hidden[ny * width + x])))) return done('unknown');
        if (corner) {
            const across = sideEdge(map, x, y, sx, 0), down = sideEdge(map, x, y, 0, sy);
            const acrossOn = sideEdge(map, nx, y, 0, sy), downOn = sideEdge(map, x, ny, sx, 0);
            const blocked = [across, acrossOn, down, downOn].find(i => !clear(i));
            if (blocked !== undefined || stopsAt(y * width + nx) || stopsAt(ny * width + x)) {
                steps.push({ kind: 'corner', at: { x: sx > 0 ? x + 1 : x, y: sy > 0 ? y + 1 : y } });
                return done('corner');
            }
            tMaxX += tDeltaX;
            tMaxY += tDeltaY;
        } else if (nx !== x) {
            if (!wall(sideEdge(map, x, y, sx, 0))) return done('wall');
            tMaxX += tDeltaX;
        } else {
            if (!wall(sideEdge(map, x, y, 0, sy))) return done('wall');
            tMaxY += tDeltaY;
        }
        x = nx;
        y = ny;
        if (stopsAt(y * width + x)) {
            steps.push({ kind: 'object', tile: { x, y } });
            return done('object');
        }
    }
}

/**
 * Whether anything gives a body half cover from some side against a shot from `origin` (a cover tile beside it, a
 * railing on an edge, a lean): with `coverAgainst` null, it is flanked (§11.4: the preview's greyed-out shield). From
 * raised floor at a target on the ground there is none to flank (§14.7).
 */
export function hasCover(map: ShotMap, fabric: Fabric, body: Body, origin: Pos): boolean {
    const { width, height } = map, t = body.pos;
    if (map.raised[origin.y * width + origin.x] && !map.raised[t.y * width + t.x]) return false;
    if (body.lean) return true;
    return SIDES.some(n => {
        const e = sideEdge(map, t.x, t.y, n.x, n.y), edge = e >= 0 ? map.edges[e]! : undefined;
        if (edge?.halfCover) return true;
        const cx = t.x + n.x, cy = t.y + n.y;
        return cx >= 0 && cy >= 0 && cx < width && cy < height && (!edge || edge.open) && fabric.cover[cy * width + cx] !== NO_COVER;
    });
}

/**
 * The fabric as it could stand once an attack of `bullets` bullets has broken all it might (§11.7: nobody is hit by
 * surprise): every pane shattered, teller glass shattered where `bullets` more hits reach its 4th, and the cover those
 * bullets could destroy (each blocked at most once per bullet, by the bullet's most damage) gone. A taser breaks
 * nothing. Later bullets of an attack meet the fabric somewhere between this and the one it started with.
 */
export function brokenFabric(map: ShotMap, fabric: Fabric, bullets: number, bullet: BulletSpec): Fabric {
    const out = copyFabric(fabric);
    if (bullet.knockout) return out;
    map.edges.forEach((e, i) => {
        if (e.material === 'glass' || (e.material === 'tellerGlass' && fabric.hits[i]! + bullets >= TELLER_GLASS.hits)) out.shattered[i] = 1;
    });
    const most = bullets * (bullet.damage + (bullet.close?.damage ?? 0));
    for (let i = 0; i < out.cover.length; i++) if (out.cover[i]! > 0 && out.cover[i]! <= most) out.cover[i] = NO_COVER;
    return out;
}

/**
 * The fabric as the crew knows it (`ShotView`): a pane's state and teller glass's hits only where a tile beside it was
 * seen (elsewhere as built), cover's wear only on seen tiles (elsewhere as built), and no cover on hidden tiles.
 */
export function viewedFabric(world: ReadonlyWorld, map: ShotMap, fabric: Fabric, view: ShotView): Fabric {
    const out = copyFabric(fabric);
    const seen = (i: number): boolean => i >= 0 && view.seen[i] === 1;
    map.edges.forEach((e, i) => {
        if (seen(e.sides[0]) || seen(e.sides[1])) return;
        out.shattered[i] = 0;
        out.hits[i] = 0;
    });
    world.tiles.forEach((t, i) => {
        if (view.hidden[i]) out.cover[i] = NO_COVER;
        else if (!seen(i) && t.halfCover) out.cover[i] = t.coverHp === undefined ? INDESTRUCTIBLE : t.coverHp;
    });
    return out;
}
