import type { DeepReadonly, Pos, ReadonlyWorld, State } from '../core/types';
import { atan2Deg } from '../geo/angles';
import { BODY_RADIUS, copyFabric, coverAgainst, hasCover, INDESTRUCTIBLE, traceBullet, type BulletStop, type ShotStep } from '../geo/shot';
import { shotArcs, shotScene, type Shot } from '../rules/shot';

/*
 * The shot preview (GAME_DESIGN §11.7): the geometry of an attack before Confirm, never its outcome. It is the truth
 * (who stands behind a wall included); what the player is shown goes through the crew's knowledge first (M3-09).
 *
 * - **Arcs:** each bullet's arc (bright for bullet 1, widening to the last).
 * - **The fan:** the widest arc cut into the angles where what a bullet meets changes (`FanSegment`): across each, a
 *   bullet meets the same walls, bodies and objects in the same order, as `traceBullet` traces it. Cut at every grid
 *   corner and every body's edge inside the arc, each segment is traced once along its middle, through the fabric as
 *   it stands (the first bullet's) and with cover never blocking (so a covered body's step says so, and what lies
 *   beyond it shows). That gives the cone cut short at the first full-height blocker, the through-wall paths with the
 *   damage left after each material, and overpenetration's second target.
 * - **Bodies:** everyone the fan can hit, first or through someone, with their cover against this shot: covered (the
 *   shield), flanked (greyed out) or none, and whether this attack could break it (cracked).
 *
 * The property test (tests/sim/shot.property.test.ts) holds it to its promise: a bullet rolled anywhere in a segment
 * meets what the segment says, and `traceShot` with the rolled points is `resolveShot`.
 */

/** Part of the widest arc where every bullet meets the same things in the same order. */
export interface FanSegment {
    /** Its edges as angles off the aim line, degrees (from < to). */
    from: number;
    to: number;
    steps: ShotStep[];
    stop: BulletStop;
}

export interface CoverView {
    /** Covered against this shot, or flanked: cover there but none facing it. */
    state: 'covered' | 'flanked';
    kind?: 'tile' | 'edge' | 'lean';
    at?: string;
    /** Its hit points; null can't be destroyed. */
    hp?: number | null;
    /** This attack could destroy it (the cracked shield). */
    mayBreak?: boolean;
}

export interface ShotPreviewBody {
    id: string;
    crew: boolean;
    /** Some bullet could hit them first. */
    first: boolean;
    /** Some bullet could hit them after passing through someone (overpenetration). */
    through: boolean;
    cover: CoverView | null;
}

export interface ShotPreview {
    origin: Pos;
    /** The aim line's direction, a unit vector (turned by the fine aim to get bullet 1's middle). */
    aim: [number, number];
    turn: number;
    arcs: number[];
    range: number;
    fan: FanSegment[];
    bodies: ShotPreviewBody[];
}

/** Angles closer than this are one cut. */
const SAME_ANGLE = 1e-9;

export function previewShot(world: ReadonlyWorld, state: DeepReadonly<State>, shot: Shot): ShotPreview {
    const scene = shotScene(world, state, shot), arcs = shotArcs(state, shot);
    const { origin, aim, map } = scene;
    const turn = shot.turn ?? 0, half = arcs[arcs.length - 1]! / 2, lo = turn - half, hi = turn + half;
    const range = Math.sqrt(scene.rangeSq);
    const px = origin.x + 0.5, py = origin.y + 0.5;
    const angleOf = (vx: number, vy: number): number => atan2Deg(aim[0] * vy - aim[1] * vx, aim[0] * vx + aim[1] * vy);
    const cuts = [lo, hi];
    const cut = (a: number): void => {
        if (a > lo && a < hi) cuts.push(a);
    };
    // Every grid corner in reach (the first tile beyond range lies within range + 2.2 of the origin): where the tiles a
    // ray crosses change.
    const reach = Math.ceil(range) + 3;
    for (let cy = origin.y - reach; cy <= origin.y + reach + 1; cy++) for (let cx = origin.x - reach; cx <= origin.x + reach + 1; cx++) {
        const vx = cx - px, vy = cy - py;
        if (vx * vx + vy * vy <= (range + 3) * (range + 3)) cut(angleOf(vx, vy));
    }
    // Every standing body's two edges.
    for (const list of scene.bodies.values()) {
        const b = list[0]!;
        if (!list.some(x => x.standing) || (b.pos.x === origin.x && b.pos.y === origin.y)) continue;
        const vx = b.pos.x + 0.5 - px, vy = b.pos.y + 0.5 - py, d2 = vx * vx + vy * vy;
        const middle = angleOf(vx, vy), spread = atan2Deg(BODY_RADIUS, Math.sqrt(d2 - BODY_RADIUS * BODY_RADIUS));
        cut(middle - spread);
        cut(middle + spread);
    }
    cuts.sort((a, b) => a - b);
    const fan: FanSegment[] = [];
    let from = cuts[0]!;
    for (const to of cuts.slice(1)) {
        if (to - from < SAME_ANGLE) continue;
        const trace = traceBullet(scene, copyFabric(scene.fabric), (from + to) / 2, () => 1);
        const last = fan[fan.length - 1];
        if (last && last.stop === trace.stop && JSON.stringify(last.steps) === JSON.stringify(trace.steps)) last.to = to;
        else fan.push({ from, to, steps: trace.steps, stop: trace.stop });
        from = to;
    }

    const crewIds = new Set(state.crew.map(c => c.id));
    const seen = new Map<string, { first: boolean; through: boolean }>();
    for (const segment of fan) {
        let after = false;
        for (const s of segment.steps) {
            if (s.kind !== 'body') continue;
            const mark = seen.get(s.id) ?? { first: false, through: false };
            if (after) mark.through = true;
            else mark.first = true;
            seen.set(s.id, mark);
            after = true;
        }
    }
    const most = arcs.length * (scene.bullet.damage + (scene.bullet.close?.damage ?? 0));
    const bodies: ShotPreviewBody[] = [];
    for (const id of [...seen.keys()].sort()) {
        const body = [...scene.bodies.values()].flat().find(b => b.id === id)!;
        const source = coverAgainst(map, scene.fabric, body, origin);
        let cover: CoverView | null = null;
        if (source) {
            const hp = source.tile >= 0 && scene.fabric.cover[source.tile] !== INDESTRUCTIBLE ? scene.fabric.cover[source.tile]! : null;
            cover = { state: 'covered', kind: source.kind, at: source.at, hp, mayBreak: hp !== null && !scene.bullet.knockout && most >= hp };
        } else if (hasCover(map, scene.fabric, body, origin)) cover = { state: 'flanked' };
        bodies.push({ id, crew: crewIds.has(id), ...seen.get(id)!, cover });
    }
    return { origin: { ...origin }, aim: [aim[0], aim[1]], turn, arcs, range, fan, bodies };
}
