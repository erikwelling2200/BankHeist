import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateBank } from '../src/gen/generate';
import type { GeneratedBank, GenPerson } from '../src/gen/model';
import { cleanRoute, pointlessCameras, walksUnseen } from '../src/gen/validate';
import { initialState, tileAt, worldFromBank, type Pos } from '../src/sim';

/*
 * The checks of §17.7 that ask what is seen, on the rules' own vision (M5-01, decisions 340–342): they pass the
 * pinned M1 bank and reject a bank changed so that they must fail.
 */

/** `PLAY_BANK` in src/boot.ts: the bank the game opens on. */
const PLAY = { layout: 31, population: 2, tier: 'small', archetype: 'twoWing' } as const;

/** A bank as JSON with its keys sorted, its §17.7 report left out (its wording may change; the bank may not). */
const stable = (bank: GeneratedBank): string => {
    const { validation: _report, ...rest } = bank;
    return JSON.stringify(rest, (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
};

const play = generateBank(PLAY);

/** Both tiles beside a door of the bank's, and every corridor tile: what a camera must cover (`trafficTiles`). */
function traffic(bank: GeneratedBank): Set<string> {
    const world = worldFromBank(bank), out = new Set<string>(), corridors = new Set(bank.rooms.filter(r => r.type === 'staffCorridor').map(r => r.id));
    const add = (p: Pos) => { const t = tileAt(world, p); if (t && !t.blocksMove) out.add(`${p.x},${p.y}`); };
    for (const d of bank.doors) {
        if (d.run === 'eastWest') { add({ x: d.tx, y: d.ty - 1 }); add({ x: d.tx, y: d.ty }); } else { add({ x: d.tx - 1, y: d.ty }); add({ x: d.tx, y: d.ty }); }
    }
    world.tiles.forEach((t, i) => { if (t.room && corridors.has(t.room)) add({ x: i % world.width, y: Math.floor(i / world.width) }); });
    return out;
}

describe('the checks of sight (§17.7, M5-01)', { timeout: 120000 }, () => {
    it('keeps the M1 bank exactly as it is: a change to the rules may not reroll it unseen', () => {
        expect(play.validation.attempts).toBe(1);
        expect(createHash('sha1').update(stable(play)).digest('hex').slice(0, 16)).toBe('90dbaca07250bf94');
    });

    it('finds the M1 bank a Clean route, Moves that start in the lobby and end in the CCTV room or the alarm closet', () => {
        const world = worldFromBank(play), route = cleanRoute(world, play.rooms, play.doors);
        expect(route).not.toBeNull();
        const room = (p: Pos) => play.rooms.find(r => r.id === tileAt(world, p)?.room)?.type;
        expect(room(route!.from)).toBe('lobby');
        expect(['cctvRoom', 'alarmCloset']).toContain(room(route!.moves.at(-1)!.at(-1)!));
    });

    it('finds no Clean route when a guard watches every door into the CCTV room and the alarm closet', () => {
        const world = worldFromBank(play), goal = new Set(play.rooms.filter(r => r.type === 'cctvRoom' || r.type === 'alarmCloset').map(r => r.id));
        const free = (p: Pos) => { const t = tileAt(world, p); return !!t?.room && !t.blocksMove && !play.people.some(q => q.tx === p.x && q.ty === p.y); };
        const guards: GenPerson[] = [];
        for (const d of play.doors.filter(d => goal.has(d.a) || goal.has(d.b))) {
            const [p, q] = d.run === 'eastWest' ? [{ x: d.tx, y: d.ty - 1 }, { x: d.tx, y: d.ty }] : [{ x: d.tx - 1, y: d.ty }, { x: d.tx, y: d.ty }];
            const outside = goal.has(tileAt(world, p)!.room ?? '') ? q : p;
            // Two tiles off the doorway's outside tile, facing it: Core view, so a Clean stranger there is challenged.
            const post = ([[0, -2, 'front'], [0, 2, 'back'], [0, -1, 'front'], [0, 1, 'back']] as const)
                .map(([dx, dy, facing]) => ({ x: outside.x + dx, y: outside.y + dy, facing }))
                .find(c => free(c) && tileAt(world, c)!.room === tileAt(world, outside)!.room)!;
            expect(post, `a post outside ${d.id}`).toBeDefined();
            guards.push({ id: `watch-${guards.length}`, role: 'patrolGuard', name: 'Guard', look: 'guard', observer: 'enforcer', tx: post.x, ty: post.y, facing: post.facing, schedule: [], traits: {} } as GenPerson);
        }
        const watched = { ...play, people: [...play.people, ...guards] };
        expect(cleanRoute(worldFromBank(watched), watched.rooms, watched.doors)).toBeNull();
    });

    it('rejects a route a guard comes to watch after turn 1: the walk is judged as it is played, not on turn 1', () => {
        const world = worldFromBank(play), route = cleanRoute(world, play.rooms, play.doors)!;
        expect(walksUnseen(world, route.from, route.moves)).toBe(true);
        // A guard at the far end of the alarm closet's corridor, facing the wall on turn 1, who turns to watch the
        // corridor from turn `from` on: the corridor is as quiet on turn 1 as without him.
        const end = route.moves.flat().at(-1)!, post = { x: 47, y: 11 };
        expect(play.rooms.find(r => r.id === tileAt(world, end)?.room)?.type).toBe('alarmCloset');
        expect(tileAt(world, post)?.room).toBe(tileAt(world, { x: end.x, y: end.y + 1 })?.room);
        const guarded = (from: number) => {
            const room = tileAt(world, post)!.room!, at = { tx: post.x, ty: post.y };
            const guard = {
                id: 'watch-0', role: 'patrolGuard', name: 'Guard', look: 'guard', observer: 'enforcer', tx: post.x, ty: post.y, facing: 'front', schedule: [], traits: {},
                routine: [{ from: 1, activity: 'post', label: 'post', room, at, facing: 'e' }, { from, activity: 'post', label: 'post', room, at, facing: 'w' }]
            } as GenPerson;
            const bank = { ...play, people: [...play.people, guard] };
            return { bank, world: worldFromBank(bank) };
        };
        // Turning only long after the walk, he changes nothing.
        const late = guarded(99);
        expect(walksUnseen(late.world, route.from, route.moves)).toBe(true);
        expect(cleanRoute(late.world, late.bank.rooms, late.bank.doors)).not.toBeNull();
        // Turning on turn 2, he sees the walker come down the corridor: the same Moves are spotted, and no walk gets by him.
        const soon = guarded(2);
        expect(walksUnseen(soon.world, route.from, route.moves)).toBe(false);
        expect(cleanRoute(soon.world, soon.bank.rooms, soon.bank.doors)).toBeNull();
    });

    it('finds a camera pointless that faces a wall, and none of the M1 bank\'s', () => {
        const world = worldFromBank(play), busy = traffic(play);
        expect(pointlessCameras(world, initialState(world, { seed: 0, crew: [] }), busy)).toEqual([]);
        // A camera on a tile with a wall to its north, facing it: it sees its own tile and nothing else.
        const walled = new Set(play.level.walls.filter(w => w.run === 'eastWest').map(w => `${w.tx},${w.ty}`));
        let at: Pos | undefined;
        world.tiles.forEach((t, i) => {
            const p = { x: i % world.width, y: Math.floor(i / world.width) };
            if (!at && t.room && play.rooms.find(r => r.id === t.room)?.bank && walled.has(`${p.x},${p.y}`) && !busy.has(`${p.x},${p.y}`)) at = p;
        });
        const blind = { ...play, cameras: [...play.cameras, { id: 'camera-blind', tx: at!.x, ty: at!.y, facing: 'north' as const, panning: false, room: tileAt(world, at!)!.room! }] };
        const blindWorld = worldFromBank(blind);
        expect(pointlessCameras(blindWorld, initialState(blindWorld, { seed: 0, crew: [] }), busy)).toEqual(['camera-blind']);
    });
});
