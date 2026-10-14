import type { Approach, Door, GenCamera, GenRoom, GetawaySpot, PlotExit, RuleResult } from './model';
import type { Nav, P } from './nav';
import type { Furnished } from './parcels';
import { CAMERA_HALF_ANGLE, CAMERA_RANGE, cone, GUARD_HALF_ANGLE, GUARD_RANGE, type GuardPlan } from './security';
import type { Site } from './site';

/*
 * The checks of §17.7: a seed that fails any of them is rolled again. When too many seeds fail, rules are relaxed in a
 * fixed order (`RELAX_ORDER`): a relaxed rule still runs and is reported, but no longer rejects the bank.
 */

export const RULES = {
    approachesReachVault: 'Every guaranteed approach reaches the vault (at least 4, from 3 categories, one covert to the CCTV room or alarm closet)',
    cleanRoute: 'A Clean-profile stealth route from the lobby to the CCTV room or the alarm closet',
    loops: 'At least 2 loops between Public and Secure space, every zone with at least 2 connections',
    guardOverlap: 'No more than 3 guards can see the same tile',
    usefulCameras: 'Every camera covers a tile someone has to cross',
    alarmsAndExits: "Every silent-alarm station reachable from the lobby, the manager's desk among them; civilian exits within reach of the crowd",
    getaways: 'Getaway spots connect to at least 2 plot exits',
    vaultDepth: 'The vault is at least 2 doors from any Public tile; the CCTV room is not on the vault corridor'
} as const;

export type Rule = keyof typeof RULES;

/** Which rules give way first when too many seeds fail. */
export const RELAX_ORDER: Rule[] = ['guardOverlap', 'usefulCameras', 'alarmsAndExits', 'cleanRoute'];

/** How far (in steps) the crowd may be from a civilian exit (§17.7's "set distance band"). */
export const EXIT_BAND: [number, number] = [1, 28];

interface Ctx {
    site: Site;
    nav: Nav;
    bank: GenRoom[];
    doors: Door[];
    approaches: Approach[];
    cameras: GenCamera[];
    guards: GuardPlan[];
    furnished: Furnished;
    getaways: GetawaySpot[];
    exits: PlotExit[];
    traffic: Set<string>;
    tall: (x: number, y: number) => boolean;
}

export function validate(ctx: Ctx): RuleResult[] {
    const { site, nav, bank, doors } = ctx;
    const ofType = (t: string) => bank.filter(r => r.type === t);
    const tiles = (rooms: GenRoom[]) => rooms.flatMap(r => nav.tilesOf(r));
    const vault = tiles(ofType('vault'));
    const lobby = tiles(ofType('lobby'));
    const result = (rule: Rule, ok: boolean, detail: string): RuleResult => ({ rule: RULES[rule], ok, detail });
    const results: RuleResult[] = [];

    // Every approach reaches the vault (through any door: every lock has its keys).
    const fromVault = nav.distances(vault).dist, at = (p: P) => fromVault[p.y * site.width + p.x]!;
    const stuck = ctx.approaches.filter(a => at({ x: a.inside.tx, y: a.inside.ty }) < 0);
    const categories = new Set(ctx.approaches.map(a => a.category));
    // At least one covert way reaches the CCTV room or the alarm closet, which the inside-man plan needs (§17.5).
    const coreRooms = new Set(bank.filter(r => r.type === 'cctvRoom' || r.type === 'alarmCloset').map(r => r.id));
    const toCore = nav.distances(tiles(bank.filter(r => coreRooms.has(r.id)))).dist;
    const covertToCore = ctx.approaches.some(a => a.category === 'covert' && (coreRooms.has(a.room) || toCore[a.inside.ty * site.width + a.inside.tx]! >= 0));
    results.push(result('approachesReachVault', !stuck.length && ctx.approaches.length >= 4 && categories.size >= 3 && covertToCore,
        `${ctx.approaches.length} approaches in ${categories.size} categories${covertToCore ? ', a covert one reaching the CCTV room or alarm closet' : ', no covert way to the CCTV room or alarm closet'}${stuck.length ? `; cut off: ${stuck.map(a => a.name).join(', ')}` : ''}`));

    // A Clean-profile route: no vault door or mantrap, and no Secure room on the way but the one it ends in.
    const clean = (target: string) => {
        const goal = ofType(target);
        if (!goal.length) return false;
        const goalIds = new Set(goal.map(r => r.id)), secure = new Set(bank.filter(r => r.zone === 'secure' && !goalIds.has(r.id)).map(r => r.id));
        const through = (d: Door) => d.lock !== 'vault' && !secure.has(d.a) && !secure.has(d.b);
        const dist = nav.distances(lobby, { through }).dist;
        return tiles(goal).some(p => dist[p.y * site.width + p.x]! >= 0);
    };
    const cleanTo = ['cctvRoom', 'alarmCloset'].filter(clean);
    results.push(result('cleanRoute', cleanTo.length > 0, cleanTo.length ? `reaches the ${cleanTo.join(' and ')}` : 'no clean route'));

    // Loops: two door-disjoint ways from the Public rooms to the Secure ones, and every zone connected at least twice.
    const flow = maxFlow(bank, doors, r => r.zone === 'public', r => r.zone === 'secure');
    const zones = ['public', 'staff', 'secure'] as const;
    const links = zones.map(z => doors.filter(d => {
        const a = site.rooms.find(r => r.id === d.a)!, b = site.rooms.find(r => r.id === d.b)!;
        return (a.bank || b.bank) && (a.zone === z) !== (b.zone === z);
    }).length);
    results.push(result('loops', flow >= 2 && links.every(n => n >= 2), `${flow} disjoint ways from Public to Secure; connections per zone ${zones.map((z, i) => `${z} ${links[i]}`).join(', ')}`));

    // Guards: how many can see each tile from their posts and along their routes.
    const seenBy = new Map<string, Set<number>>();
    ctx.guards.forEach((g, i) => {
        const points: { p: P; facing: 'north' | 'south' | 'east' | 'west' }[] = [{ p: { x: g.tx, y: g.ty }, facing: g.facing === 'front' ? 'south' : 'north' }];
        let prev: P = { x: g.tx, y: g.ty };
        for (const q of g.route) {
            points.push({ p: q, facing: q.x > prev.x ? 'east' : q.x < prev.x ? 'west' : q.y > prev.y ? 'south' : 'north' });
            prev = q;
        }
        for (const { p, facing } of points) for (const t of cone(nav, p, facing, GUARD_RANGE, GUARD_HALF_ANGLE, () => false)) {
            const k = `${t.x},${t.y}`;
            if (!seenBy.has(k)) seenBy.set(k, new Set());
            seenBy.get(k)!.add(i);
        }
    });
    const most = Math.max(0, ...[...seenBy.values()].map(s => s.size));
    results.push(result('guardOverlap', most <= 3, `at most ${most} guards see one tile`));

    // Cameras: each covers a tile people have to cross.
    const pointless = ctx.cameras.filter(c => !cone(nav, { x: c.tx, y: c.ty }, c.facing, CAMERA_RANGE, CAMERA_HALF_ANGLE, ctx.tall).some(t => ctx.traffic.has(`${t.x},${t.y}`)));
    results.push(result('usefulCameras', !pointless.length, `${ctx.cameras.length} cameras${pointless.length ? `, ${pointless.length} pointless` : ''}`));

    // Silent-alarm stations reachable from the lobby; the crowd within the band of an exit.
    const fromLobby = nav.distances(lobby).dist;
    // An alarm on the wall is reached from the tile in front of it.
    const reached = (a: { tx: number; ty: number }) => [[0, 0], [0, 1], [1, 0], [-1, 0], [0, -1]].some(([dx, dy]) => (fromLobby[(a.ty + dy!) * site.width + a.tx + dx!] ?? -1) >= 0);
    const unreachable = ctx.furnished.alarms.filter(a => !reached(a));
    const exitTiles = doors.filter(d => {
        const a = site.rooms.find(r => r.id === d.a)!, b = site.rooms.find(r => r.id === d.b)!;
        return (a.zone === 'public' && b.zone === 'outdoors') || (b.zone === 'public' && a.zone === 'outdoors');
    }).map(d => (d.run === 'eastWest' ? { x: d.tx, y: d.ty - 1 } : { x: d.tx - 1, y: d.ty }));
    const toExit = nav.distances(exitTiles).dist;
    const far = lobby.filter(p => {
        const d = toExit[p.y * site.width + p.x]!;
        return d < EXIT_BAND[0] - 1 || d > EXIT_BAND[1] || d < 0;
    });
    // Every manager's office has its desk, with the desk button (and the PC the rules read).
    const deskless = ofType('managerOffice').filter(r => !ctx.furnished.alarms.some(a => a.room === r.id && a.name === "Manager's desk button"));
    results.push(result('alarmsAndExits', !unreachable.length && !far.length && !deskless.length,
        `${ctx.furnished.alarms.length} alarm stations${unreachable.length ? `, ${unreachable.length} unreachable` : ''}${deskless.length ? `, ${deskless.length} manager's office without its desk` : ''}; ${far.length} crowd tiles outside the exit band`));

    // Getaway spots: by road, alley or garage to at least two plot exits.
    const drivable = (x: number, y: number) => ['r', 'l', 'a', 'p', 'c', 'e'].includes(site.tiles[y]?.[x] ?? 'x');
    const reach = (from: P) => {
        const seen = new Set<string>([`${from.x},${from.y}`]), queue = [from];
        while (queue.length) {
            const p = queue.shift()!;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const q = { x: p.x + dx, y: p.y + dy }, k = `${q.x},${q.y}`;
                if (seen.has(k) || !site.inside(q.x, q.y) || !drivable(q.x, q.y) || site.wallAt({ ...(dx ? { run: 'northSouth' as const, tx: Math.max(p.x, q.x), ty: p.y } : { run: 'eastWest' as const, tx: p.x, ty: Math.max(p.y, q.y) }) })) continue;
                seen.add(k);
                queue.push(q);
            }
        }
        return ctx.exits.filter(e => seen.has(`${e.tx},${e.ty}`)).length;
    };
    const stranded = ctx.getaways.filter(g => reach({ x: g.tx, y: g.ty }) < 2);
    results.push(result('getaways', ctx.getaways.length > 0 && !stranded.length, `${ctx.getaways.length} spots${stranded.length ? `; stranded: ${stranded.map(g => g.name).join(', ')}` : ''}`));

    // The vault behind at least two doors from the public floor; the CCTV room off the vault corridor.
    const doorsFromPublic = nav.distances(tiles(bank.filter(r => r.zone === 'public')), { doorCost: 1 }).doors;
    const nearest = Math.min(...vault.map(p => doorsFromPublic[p.y * site.width + p.x]!).filter(d => d >= 0));
    const coreIds = new Set(bank.filter(r => ['antechamber', 'mantrap', 'vault'].includes(r.type)).map(r => r.id));
    const vaultCorridors = new Set(doors.filter(d => coreIds.has(d.a) !== coreIds.has(d.b)).map(d => (coreIds.has(d.a) ? d.b : d.a)));
    const cctv = ofType('cctvRoom').map(r => r.id);
    const onCorridor = doors.some(d => (cctv.includes(d.a) && vaultCorridors.has(d.b)) || (cctv.includes(d.b) && vaultCorridors.has(d.a)));
    results.push(result('vaultDepth', nearest >= 2 && !onCorridor, `${Number.isFinite(nearest) ? nearest : 'no'} doors from the public floor to the vault${onCorridor ? '; the CCTV room opens onto the vault corridor' : ''}`));
    return results;
}

/** The most door-disjoint ways from the `from` rooms to the `to` rooms: each door carries one way (§17.7 loops). */
export function maxFlow(rooms: GenRoom[], doors: Door[], from: (r: GenRoom) => boolean, to: (r: GenRoom) => boolean): number {
    const ids = new Set(rooms.map(r => r.id));
    const edges = doors.filter(d => ids.has(d.a) && ids.has(d.b));
    const source = new Set(rooms.filter(from).map(r => r.id)), sink = new Set(rooms.filter(to).map(r => r.id));
    // Each door is an undirected edge of capacity 1; augment along breadth-first paths until none are left.
    const cap = new Map<string, number>();
    const key = (a: string, b: string) => `${a}|${b}`;
    for (const e of edges) { cap.set(key(e.a, e.b), (cap.get(key(e.a, e.b)) ?? 0) + 1); cap.set(key(e.b, e.a), (cap.get(key(e.b, e.a)) ?? 0) + 1); }
    const neighbours = new Map<string, string[]>();
    for (const e of edges) { (neighbours.get(e.a) ?? neighbours.set(e.a, []).get(e.a)!).push(e.b); (neighbours.get(e.b) ?? neighbours.set(e.b, []).get(e.b)!).push(e.a); }
    let flow = 0;
    for (;;) {
        const prev = new Map<string, string>(), queue = [...source];
        for (const s of source) prev.set(s, '');
        let end: string | undefined;
        while (queue.length && !end) {
            const a = queue.shift()!;
            for (const b of neighbours.get(a) ?? []) {
                if (prev.has(b) || (cap.get(key(a, b)) ?? 0) <= 0) continue;
                prev.set(b, a);
                if (sink.has(b)) { end = b; break; }
                queue.push(b);
            }
        }
        if (!end) return flow;
        for (let b = end; prev.get(b); b = prev.get(b)!) {
            const a = prev.get(b)!;
            cap.set(key(a, b), cap.get(key(a, b))! - 1);
            cap.set(key(b, a), (cap.get(key(b, a)) ?? 0) + 1);
        }
        flow++;
    }
}
