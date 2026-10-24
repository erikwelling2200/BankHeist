import type { DeepReadonly, Pos, ReadonlyWorld, State } from '../core/types';
import { atan2Deg } from '../geo/angles';
import { OVERPENETRATION } from '../data/weapons';
import { BODY_RADIUS, brokenFabric, copyFabric, coverAgainst, hasCover, INDESTRUCTIBLE, traceBullet, type Body, type BulletStop, type ShotStep, type ShotView } from '../geo/shot';
import { crewPicture, isKnownNow, VISIBILITY, visibilityMap } from '../rules/knowledge';
import { decodeBits } from '../rules/knowledgeBits';
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
 * - **Breakage:** a later bullet of the same attack may meet teller glass shattered by the earlier ones, or cover they
 *   wore through, and fly on (§11.7: nobody is hit by surprise). Each segment also gives what a bullet meets with all
 *   the attack could break broken (`FanSegment.broken`), and a body reached only so is `ifBroken`.
 *
 * The property test (tests/sim/shot.property.test.ts) holds it to its promise: every bullet of an attack meets what its
 * segment says (as it stands, as it could stand broken, or part of the way between), and `traceShot` with the rolled
 * points is `resolveShot`.
 */

/** Part of the widest arc where every bullet meets the same things in the same order. */
export interface FanSegment {
    /**
     * Its edges as angles off the aim line, degrees (from < to). They run round from `turn − half the widest arc` to
     * `turn + half` and may pass ±180°: an angle is the same direction as itself ± 360°.
     */
    from: number;
    to: number;
    /** What a bullet meets here through the fabric as it stands (the first bullet's), cover never blocking. */
    steps: ShotStep[];
    stop: BulletStop;
    /**
     * What it meets once everything this attack could break is broken (`brokenFabric`: panes, teller glass at its 4th
     * hit, cover worn through), when that differs. A later bullet meets these steps or a part of the way to them.
     */
    broken?: { steps: ShotStep[]; stop: BulletStop };
}

export interface CoverView {
    /** Covered against this shot, or flanked: cover there but none facing it. */
    state: 'covered' | 'flanked';
    kind?: 'tile' | 'edge' | 'lean';
    at?: string;
    /** Its hit points; null can't be destroyed. */
    hp?: number | null;
    /** This attack could destroy it (the cracked shield): every bullet that can reach it, blocked, takes it to 0. */
    mayBreak?: boolean;
}

export interface ShotPreviewBody {
    id: string;
    crew: boolean;
    /** Some bullet could hit them first. */
    first: boolean;
    /** Some bullet could hit them after passing through someone (overpenetration). */
    through: boolean;
    /** Only once something breaks (teller glass shattered, cover worn through) can a later bullet reach them. */
    ifBroken: boolean;
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

const sameSteps = (a: { steps: ShotStep[]; stop: BulletStop } | undefined, b: { steps: ShotStep[]; stop: BulletStop } | undefined): boolean =>
    a === b || (!!a && !!b && a.stop === b.stop && JSON.stringify(a.steps) === JSON.stringify(b.steps));

/**
 * The shot's preview, **omniscient**: it is the truth, like an engine preview (decision 92). Its bodies name NPCs behind
 * walls the crew may not know of, its shields give hit points, and a shot at an unknown target is refused by id. Show
 * the player `crewShotPreview`, which runs it on the crew's picture.
 */
export function previewShot(world: ReadonlyWorld, state: DeepReadonly<State>, shot: Shot, view?: ShotView): ShotPreview {
    const scene = shotScene(world, state, shot, view), arcs = shotArcs(state, shot);
    const { origin, aim, map } = scene;
    const turn = shot.turn ?? 0, half = arcs[arcs.length - 1]! / 2, lo = turn - half, hi = turn + half;
    const range = Math.sqrt(scene.rangeSq);
    const px = origin.x + 0.5, py = origin.y + 0.5;
    /** The angle of a direction off the aim line, taken round to the one nearest `turn` (the fan may pass ±180°). */
    const angleOf = (vx: number, vy: number): number => {
        let d = atan2Deg(aim[0] * vy - aim[1] * vx, aim[0] * vx + aim[1] * vy) - turn;
        while (d > 180) d -= 360;
        while (d <= -180) d += 360;
        return turn + d;
    };
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
    const broken = brokenFabric(map, scene.fabric, arcs.length, scene.bullet);
    const fan: FanSegment[] = [];
    let from = cuts[0]!;
    for (const to of cuts.slice(1)) {
        if (to - from < SAME_ANGLE) continue;
        const middle = (from + to) / 2;
        const trace = traceBullet(scene, copyFabric(scene.fabric), middle, () => 1);
        const after = traceBullet(scene, copyFabric(broken), middle, () => 1);
        const segment: FanSegment = { from, to, steps: trace.steps, stop: trace.stop };
        if (!sameSteps(trace, after)) segment.broken = { steps: after.steps, stop: after.stop };
        const last = fan[fan.length - 1];
        if (last && sameSteps(last, segment) && sameSteps(last.broken, segment.broken)) last.to = to;
        else fan.push(segment);
        from = to;
    }

    // Who the fan reaches, and the most each bullet could take off their cover (the damage it meets them with, the
    // shotgun's close bonus only within its reach), over the segments each bullet's arc overlaps.
    const crewIds = new Set(state.crew.map(c => c.id));
    // Cover is worn per piece, whoever stands behind it: each bullet that can reach any body it covers can be blocked
    // there once, with the damage it meets that body with (the shotgun's +1 only within its reach).
    const seen = new Map<string, { first: boolean; through: boolean; ifBroken: boolean }>();
    const wear = new Map<string, number[]>();
    const sources = new Map<string, ReturnType<typeof coverAgainst>>();
    const sourceOf = (body: Body): ReturnType<typeof coverAgainst> => {
        if (!sources.has(body.id)) sources.set(body.id, coverAgainst(map, scene.fabric, body, origin));
        return sources.get(body.id)!;
    };
    const close = scene.bullet.close;
    const visit = (s: FanSegment, steps: readonly ShotStep[], ifBroken: boolean): void => {
        let after = false, damage = scene.bullet.damage;
        for (const step of steps) {
            if (step.kind === 'wall') damage = step.damage;
            if (step.kind !== 'body') continue;
            const mark = seen.get(step.id) ?? { first: false, through: false, ifBroken: true };
            if (!ifBroken) mark.ifBroken = false;
            if (after) mark.through = true;
            else mark.first = true;
            const body = bodyOf(step.id), dx = body.pos.x - origin.x, dy = body.pos.y - origin.y;
            const raw = damage + (close && dx * dx + dy * dy <= close.within * close.within ? close.damage : 0);
            const source = sourceOf(body);
            if (source) {
                const each = wear.get(source.at) ?? arcs.map(() => 0);
                arcs.forEach((arc, k) => {
                    if (s.from < turn + arc / 2 && s.to > turn - arc / 2) each[k] = Math.max(each[k]!, raw);
                });
                wear.set(source.at, each);
            }
            seen.set(step.id, mark);
            after = true;
            if (step.effect === 'through') damage -= OVERPENETRATION.loss;
        }
    };
    const all = [...scene.bodies.values()].flat();
    const bodyOf = (id: string): Body => all.find(b => b.id === id)!;
    for (const s of fan) {
        visit(s, s.steps, false);
        if (s.broken) visit(s, s.broken.steps, true);
    }
    const bodies: ShotPreviewBody[] = [];
    for (const id of [...seen.keys()].sort()) {
        const mark = seen.get(id)!, body = bodyOf(id), source = sourceOf(body);
        let cover: CoverView | null = null;
        if (source) {
            const hp = source.tile >= 0 && scene.fabric.cover[source.tile] !== INDESTRUCTIBLE ? scene.fabric.cover[source.tile]! : null;
            cover = { state: 'covered', kind: source.kind, at: source.at, hp, mayBreak: hp !== null && !scene.bullet.knockout && (wear.get(source.at) ?? []).reduce((a, b) => a + b, 0) >= hp };
        } else if (hasCover(map, scene.fabric, body, origin)) cover = { state: 'flanked' };
        bodies.push({ id, crew: crewIds.has(id), ...mark, cover });
    }
    return { origin: { ...origin }, aim: [aim[0], aim[1]], turn, arcs, range, fan, bodies };
}

/**
 * The shot preview the player may see (§8.15, decision 92): `previewShot` on the crew's picture, with only the NPCs the
 * crew sees or predicts on the map (a hostage led by a crew member stays), every door not seen this turn as last seen,
 * and the map as the crew knows it (`ShotView`): the fan stops ('unknown') where it would enter a tile neither on the
 * blueprint nor ever seen, a hidden aimed-at tile says nothing of its height, and panes, teller glass's hits and
 * cover's wear show only where the crew has seen them (as built elsewhere; no cover on hidden tiles). A target the
 * crew doesn't know is refused like any missing one. The outcome may still meet someone or something unknown: that is
 * the risk of firing into what the crew can't see.
 */
export function crewShotPreview(world: ReadonlyWorld, state: State, shot: Shot): ShotPreview {
    const picture = crewPicture(world, state);
    const led = state.npcs.filter(n => !picture.npcs.includes(n) && state.crew.some(c => c.dragging === n.id) && isKnownNow(world, state, n.id));
    const n = world.width * world.height, visibility = visibilityMap(world, state);
    const hidden = new Uint8Array(n), seen = decodeBits(state.knowledge.seen, n).slice(), fresh = decodeBits(state.knowledge.fresh, n);
    for (let i = 0; i < n; i++) {
        if (VISIBILITY[visibility[i]!] === 'hidden') hidden[i] = 1;
        if (fresh[i]) seen[i] = 1;
    }
    return previewShot(world, led.length ? { ...picture, npcs: [...picture.npcs, ...led] } : picture, shot, { hidden, seen });
}
