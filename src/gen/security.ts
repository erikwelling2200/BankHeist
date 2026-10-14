import type { PersonFacing } from '../level/plan';
import type { Facing } from '../level/space';
import type { Furnisher } from './furnish';
import type { GenCamera, GenRoom } from './model';
import type { Nav, P } from './nav';
import type { CameraSlot } from './parcels';
import type { Rng } from './rng';
import type { Site } from './site';

/*
 * Security (§17.2 step 6, §8.3, §8.12): cameras in the slots the parcels left, each covering a tile people have to
 * cross; guard posts and patrol routes. Guards patrol the staff and secure rooms; the lobby guard keeps a post by the
 * doors with a short loop; the security chief (HQ) roams.
 */

export const CAMERA_RANGE = 7;
export const CAMERA_HALF_ANGLE = (70 / 2) * (Math.PI / 180);
export const GUARD_RANGE = 8;
export const GUARD_HALF_ANGLE = (140 / 2) * (Math.PI / 180);

const ANGLE: Record<Facing, number> = { east: 0, south: Math.PI / 2, west: Math.PI, north: -Math.PI / 2 };

/** The tiles an observer at `from` facing `facing` sees within `range` and `half` either side (§8.3). */
export function cone(nav: Nav, from: P, facing: Facing, range: number, half: number, tall: (x: number, y: number) => boolean): P[] {
    const out: P[] = [];
    for (let y = from.y - range; y <= from.y + range; y++) for (let x = from.x - range; x <= from.x + range; x++) {
        if (!nav.site.inside(x, y) || nav.site.owner[y]![x]! < 0) continue;
        const dx = x - from.x, dy = y - from.y;
        if (dx * dx + dy * dy > range * range) continue;
        if (dx || dy) {
            let d = Math.atan2(dy, dx) - ANGLE[facing];
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            if (Math.abs(d) > half) continue;
        }
        if (nav.sees(from, { x, y }, tall)) out.push({ x, y });
    }
    return out;
}

/**
 * Tiles someone has to cross (§17.7): both sides of every door, the corridors, the counter gate and the lobby's
 * doorway. A camera that covers none of them is pointless.
 */
export function trafficTiles(site: Site, nav: Nav, bank: GenRoom[]): Set<string> {
    const out = new Set<string>(), inBank = new Set(bank.map(r => r.id));
    for (const d of site.doors) {
        if (!inBank.has(d.a) && !inBank.has(d.b)) continue;
        const [p, q] = d.run === 'eastWest' ? [{ x: d.tx, y: d.ty - 1 }, { x: d.tx, y: d.ty }] : [{ x: d.tx - 1, y: d.ty }, { x: d.tx, y: d.ty }];
        for (const t of [p, q]) if (nav.walkable(t.x, t.y)) out.add(`${t.x},${t.y}`);
    }
    for (const room of bank.filter(r => r.type === 'staffCorridor')) for (const t of nav.tilesOf(room)) out.add(`${t.x},${t.y}`);
    return out;
}

/** Which rooms want cameras most: the takeover floor, the core, the corridors. */
const CAMERA_PRIORITY = ['lobby', 'tellerLine', 'antechamber', 'staffCorridor', 'depositBoxes', 'loadingBay', 'atmRoom', 'mantrap', 'breakRoom'];

/**
 * Hangs `count` cameras: each in a free slot, covering traffic tiles no camera covers yet, highest-priority rooms
 * first. Panning cameras alternate between two facings (§8.3); here a third pan.
 */
export function placeCameras(site: Site, furnish: Furnisher, nav: Nav, slots: CameraSlot[], traffic: Set<string>, count: number, rng: Rng, tall: (x: number, y: number) => boolean): GenCamera[] {
    const cameras: GenCamera[] = [], covered = new Set<string>();
    const ranked = slots.map(s => {
        const room = site.rooms.find(r => r.id === s.room)!;
        const sees = cone(nav, { x: s.tx, y: s.ty }, s.facing, CAMERA_RANGE, CAMERA_HALF_ANGLE, tall).map(t => `${t.x},${t.y}`).filter(k => traffic.has(k));
        return { s, sees, rank: CAMERA_PRIORITY.indexOf(room.type) < 0 ? CAMERA_PRIORITY.length : CAMERA_PRIORITY.indexOf(room.type) };
    }).filter(c => c.sees.length);
    while (cameras.length < count) {
        const best = ranked.filter(c => !cameras.some(k => k.tx === c.s.tx && k.ty === c.s.ty))
            .map(c => ({ ...c, gain: c.sees.filter(k => !covered.has(k)).length - c.rank * 0.5 + rng.next() }))
            .sort((a, b) => b.gain - a.gain)[0];
        if (!best) break;
        if (furnish.try(best.s.prop)) {
            cameras.push({ id: `camera-${cameras.length}`, tx: best.s.tx, ty: best.s.ty, facing: best.s.facing as GenCamera['facing'], panning: rng.chance(0.33), room: best.s.room });
            for (const k of best.sees) covered.add(k);
        }
        ranked.splice(ranked.indexOf(ranked.find(c => c.s === best.s)!), 1);
    }
    return cameras;
}

/** A guard's place: a post, and a route walked from it and back (tile corners, each leg straight). */
export interface GuardPlan { role: 'lobbyGuard' | 'patrolGuard' | 'chief'; tx: number; ty: number; facing: PersonFacing; route: P[]; rooms: string[] }

/** Squeezes a tile path into its corners, so each leg runs straight along a row or a column. */
export function corners(path: P[]): P[] {
    const out: P[] = [];
    path.forEach((p, i) => {
        const prev = path[i - 1], next = path[i + 1];
        if (!prev || !next || (prev.x === p.x) !== (p.x === next.x)) out.push(p);
    });
    return out;
}

/**
 * Plans the guards: a lobby guard by the doors, patrols through the staff and secure rooms, the chief through the
 * whole bank. Routes run between corridor ends and the rooms that matter (the antechamber, the loading bay).
 */
export function planGuards(nav: Nav, bank: GenRoom[], furnish: Furnisher, rng: Rng, guards: number, chief: boolean, frontDoor: P): GuardPlan[] {
    const plans: GuardPlan[] = [];
    const free = (p: P) => furnish.canStand(p.x, p.y) && nav.walkable(p.x, p.y);
    const near = (room: GenRoom, to: P): P | undefined => nav.tilesOf(room).filter(free).sort((a, b) => Math.hypot(a.x - to.x, a.y - to.y) - Math.hypot(b.x - to.x, b.y - to.y))[0];
    const lobby = bank.filter(r => r.type === 'lobby').sort((a, b) => b.w * b.h - a.w * a.h)[0]!;
    // The lobby guard: a post beside the doors, a short loop along the counter.
    const post = near(lobby, { x: frontDoor.x + (rng.chance(0.5) ? 3 : -2), y: frontDoor.y - 2 });
    if (post) {
        const end = near(lobby, { x: post.x, y: lobby.y + 1 });
        const path = end && nav.path(post, end);
        plans.push({ role: 'lobbyGuard', tx: post.x, ty: post.y, facing: 'front', route: path ? corners(path).slice(1) : [], rooms: [lobby.id] });
    }
    // Patrols: from one end of the staff side to a room of the core and on to the far end.
    const stops = bank.filter(r => ['staffCorridor', 'antechamber', 'loadingBay', 'breakRoom', 'mantrap'].includes(r.type));
    for (let g = 1; g < guards; g++) {
        const picks = rng.shuffle(stops).slice(0, 3);
        const points = picks.map(r => near(r, { x: r.x + rng.int(0, r.w - 1), y: r.y + rng.int(0, r.h - 1) })).filter((p): p is P => !!p);
        if (points.length < 2) continue;
        const route: P[] = [];
        let ok = true;
        for (let i = 1; i < points.length; i++) {
            const leg = nav.path(points[i - 1]!, points[i]!);
            if (!leg) { ok = false; break; }
            route.push(...(route.length ? leg.slice(1) : leg));
        }
        if (!ok || route.length < 2) continue;
        if (!furnish.stand(points[0]!.x, points[0]!.y)) continue;
        plans.push({ role: 'patrolGuard', tx: points[0]!.x, ty: points[0]!.y, facing: 'front', route: corners(route).slice(1), rooms: picks.map(r => r.id) });
    }
    if (chief) {
        const teller = bank.find(r => r.type === 'tellerLine')!;
        const start = near(teller, { x: teller.x + 1, y: teller.y + 1 }), end = near(lobby, { x: lobby.x + lobby.w - 2, y: lobby.y + lobby.h - 2 });
        const path = start && end && nav.path(start, end);
        if (start && path && furnish.stand(start.x, start.y)) plans.push({ role: 'chief', tx: start.x, ty: start.y, facing: 'front', route: corners(path).slice(1), rooms: [teller.id, lobby.id] });
    }
    if (post) furnish.stand(post.x, post.y);
    return plans;
}
