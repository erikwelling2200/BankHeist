import { describe, expect, it } from 'vitest';
import { roomLamps } from '../src/art/bank/lamps';
import { SHORTCUT_DETOUR } from '../src/gen/build';
import { Furnisher } from '../src/gen/furnish';
import { archetypesFor, buildShell, generateBank, parseSeed, rollShape, seedText, type Shell } from '../src/gen/generate';
import { REPEATABLE } from '../src/gen/layout';
import { ARCHETYPES, PLOTS, TIERS, type GeneratedBank, type GenRoom, type RoomType, type Tier, type Archetype, type PlotKind } from '../src/gen/model';
import { Nav } from '../src/gen/nav';
import { PARCELS } from '../src/gen/parcels';
import { Rng } from '../src/gen/rng';
import { ROOM_RULES } from '../src/gen/rooms';
import { tilesOf } from '../src/gen/site';
import { TIER_SPECS } from '../src/gen/tiers';
import { TILE } from '../src/level/level';
import { propBox } from '../src/level/catalog';
import { isOffMap, parsePlan, toPlan } from '../src/level/plan';
import { boxesOverlap, PERSON_SIZE, place, WALL_HEIGHT, type Box } from '../src/level/space';
import { wallFootprint } from '../src/level/walls';

/*
 * The procedural bank (GAME_DESIGN §17): every tier, archetype and plot builds, passes the checks of §17.7, places its
 * furniture and people as the hand-made bank does, and is replayable from its seeds.
 */

const cache = new Map<string, GeneratedBank>();
const bank = (layout: number, population: number, pin: Partial<Pick<GeneratedBank, 'tier' | 'archetype' | 'plot'>> = {}) => {
    const key = JSON.stringify([layout, population, pin]);
    if (!cache.has(key)) cache.set(key, generateBank({ layout, population, ...pin }));
    return cache.get(key)!;
};

describe('the generator', () => {
    it('builds every tier, archetype and plot and passes the checks of §17.7', () => {
        const failures: string[] = [];
        let n = 0;
        for (const tier of TIERS) for (const archetype of archetypesFor(tier)) {
            const plot = PLOTS[n++ % PLOTS.length]!;
            const b = bank(1000 + n, n, { tier, archetype, plot });
            expect([b.tier, b.archetype, b.plot]).toEqual([tier, archetype, plot]);
            for (const r of b.validation.results) if (!r.ok && !b.validation.relaxed.includes(r.rule)) failures.push(`${tier} ${archetype} ${plot}: ${r.rule} (${r.detail})`);
        }
        expect(failures).toEqual([]);
    }, 120000);

    it('replays a bank from its seeds, and keeps the building when only the population seed changes (§17.2)', () => {
        const a = bank(4242, 7), again = generateBank({ layout: 4242, population: 7 }), other = bank(4242, 8);
        expect(JSON.stringify(again)).toBe(JSON.stringify(a));
        expect(toPlan(other.level)).toEqual(toPlan(a.level));
        expect(other.props).toEqual(a.props);
        expect(other.people.map(p => p.name)).not.toEqual(a.people.map(p => p.name));
        expect(parseSeed(seedText(a.seed))).toEqual(a.seed);
    }, 60000);

    it('writes a level that reads back as the same plan', () => {
        const b = bank(77, 1);
        const back = parsePlan(toPlan(b.level));
        expect(back.tiles).toEqual(b.level.tiles);
        const key = (w: { run: string; tx: number; ty: number; kind: string }) => `${w.run} ${w.tx} ${w.ty} ${w.kind}`;
        expect(back.walls.map(key).sort()).toEqual(b.level.walls.map(key).sort());
    }, 60000);
});

describe('a generated bank', () => {
    const samples = [bank(11, 1, { tier: 'small' }), bank(12, 2, { tier: 'city', archetype: 'atrium' }), bank(13, 3, { tier: 'hq', archetype: 'fortress' }), bank(14, 4, { tier: 'city', archetype: 'mezzanineWatch' })];

    it('has every room the design gives the tier a job for (§17.4), with the CCTV room in another wing than the vault', () => {
        for (const b of samples) {
            const types = new Set(b.rooms.filter(r => r.bank).map(r => r.type));
            const want = ['lobby', 'tellerLine', 'restroom', 'managerOffice', 'breakRoom', 'staffCorridor', 'alarmCloset', 'antechamber', 'vault'];
            if (TIER_SPECS[b.tier].operator) want.push('cctvRoom', 'mantrap', 'serverRoom', 'depositBoxes', 'loadingBay');
            for (const t of want) expect(types.has(t as never), `${b.tier} ${b.archetype} has a ${t}`).toBe(true);
            const cctv = b.rooms.find(r => r.type === 'cctvRoom'), vault = b.rooms.find(r => r.type === 'vault')!;
            if (cctv) expect(cctv.wing).not.toBe(vault.wing);
        }
    });

    it('stands every prop inside the map, clear of the walls and of every other prop and person', () => {
        for (const b of samples) {
            const things: { name: string; box: Box }[] = [
                ...b.props.map(p => ({ name: `${p.kind} at ${p.tx},${p.ty}`, box: propBox(p, b.level.walls) })),
                ...b.people.map(p => ({ name: `${p.role} at ${p.tx},${p.ty}`, box: place({ tx: p.tx, ty: p.ty }, PERSON_SIZE) }))
            ];
            const clashes: string[] = [];
            for (const { name, box } of things) {
                if (box.h > 0 && b.level.walls.some(w => {
                    const f = wallFootprint(w);
                    return box.x < f.x + f.w && f.x < box.x + box.w && box.y < f.y + f.d && f.y < box.y + box.d;
                })) clashes.push(`${name} in a wall`);
                const t = b.level.tiles[Math.floor(box.y / TILE)]?.[Math.floor(box.x / TILE)];
                if (t === undefined || isOffMap(t)) clashes.push(`${name} off the map`);
                if (box.z > 0 && box.d <= 2 && box.z + box.h > WALL_HEIGHT) clashes.push(`${name} above the wall`);
            }
            for (let i = 0; i < things.length; i++) for (let j = i + 1; j < things.length; j++) {
                if (boxesOverlap(things[i]!.box, things[j]!.box)) clashes.push(`${things[i]!.name} and ${things[j]!.name}`);
            }
            expect(clashes, `${b.tier} ${b.archetype} seed ${b.seed.layout}`).toEqual([]);
        }
    });

    it('gives every hard lock a social, a technical and a violent key (§15.2), with the social key held by someone', () => {
        for (const b of samples) {
            expect(b.locks.some(l => l.id === 'vault')).toBe(true);
            for (const lock of b.locks) {
                expect(lock.social && lock.technical && lock.violent).toBeTruthy();
                expect(lock.holders.every(id => b.people.some(p => p.id === id))).toBe(true);
            }
        }
    });

    it('opens at least four ways in from three categories, with off-map routes behind the covert ones (§17.5, §14.7)', () => {
        for (const b of samples) {
            expect(b.approaches.length).toBeGreaterThanOrEqual(4);
            expect(new Set(b.approaches.map(a => a.category)).size).toBe(3);
            expect(b.routes.some(r => r.kind === 'roof')).toBe(true);
            for (const r of b.routes) expect(r.transit).toBe(r.kind === 'roof' ? 2 : 3);
        }
    });

    it('rolls 1-2 headline features, 3-5 opportunities and a timeline that ends at closing time (§17.6, §16.3)', () => {
        for (const b of samples) {
            expect(b.headlines.length).toBeGreaterThanOrEqual(1);
            expect(b.headlines.length).toBeLessThanOrEqual(2);
            expect(b.opportunities.length).toBeGreaterThanOrEqual(3);
            expect(b.opportunities.length).toBeLessThanOrEqual(5);
            expect(b.timeline.at(-1)!.name).toBe('Closing time');
            expect(b.timeline.map(e => e.turn)).toEqual([...b.timeline.map(e => e.turn)].sort((x, y) => x - y));
        }
    });

    it('shows only the public floor and the outside on the blueprint (§17.8)', () => {
        for (const b of samples) for (const r of b.rooms) {
            expect(r.known, r.name).toBe(r.bank && r.zone !== 'public' ? 'outline' : 'blueprint');
        }
    });

    it('stands its teller counter where the teller line meets the lobby, with one gate through it', () => {
        for (const b of samples) {
            const teller = b.rooms.find(r => r.type === 'tellerLine')!, lobbies = b.rooms.filter(r => r.type === 'lobby').map(r => r.id);
            const gates = b.doors.filter(d => (d.a === teller.id && lobbies.includes(d.b)) || (d.b === teller.id && lobbies.includes(d.a)));
            const counter = b.props.find(p => p.kind === 'counter');
            expect(gates.length, `${b.tier} ${b.archetype}`).toBe(1);
            expect(counter, `${b.tier} ${b.archetype}`).toMatchObject({ ty: teller.y + teller.h - 1, gate: gates[0]!.tx });
        }
    });

    it('has one of each staff and secure room, so no wing doubles another (offices, records and meetings may repeat)', () => {
        for (const b of samples) {
            const types = b.rooms.filter(r => r.bank && !['lobby', 'staffCorridor', 'restroom'].includes(r.type)).map(r => r.type);
            for (const t of new Set(types)) expect(types.filter(x => x === t).length, `${b.tier} ${b.archetype} ${t}`).toBeLessThanOrEqual(REPEATABLE[t] ?? 1);
        }
    });

    it('hangs every ceiling lamp over its own room', () => {
        for (const b of samples) for (const room of b.rooms.filter(r => r.bank)) for (const lamp of roomLamps([room])) {
            const tx = Math.floor(lamp.x / TILE), ty = Math.floor(lamp.y / TILE);
            expect(room.parts.some(p => tx >= p.x && tx < p.x + p.w && ty >= p.y && ty < p.y + p.h), `${room.id} lamp at ${tx},${ty}`).toBe(true);
        }
    });

    it('walks its patrols through tiles clear of furniture and walls, one straight leg at a time', () => {
        for (const b of samples) for (const p of b.people.filter(p => p.route)) {
            let prev = { tx: p.tx, ty: p.ty };
            for (const step of p.route!) {
                expect(step.tx === prev.tx || step.ty === prev.ty, `${p.role} leg from ${prev.tx},${prev.ty}`).toBe(true);
                prev = step;
            }
        }
    });
});

describe('headline features (§17.6)', () => {
    const find = (headline: string, pin: Partial<Pick<GeneratedBank, 'tier' | 'archetype' | 'plot'>>) => {
        for (let seed = 1; seed < 400; seed++) {
            const b = bank(seed, 1, pin);
            if (b.headlines.includes(headline as never)) return b;
        }
        throw new Error(`No seed rolled ${headline}`);
    };

    it('builds a drive-through teller window onto the lane, staffed, with its counter and tube terminal', () => {
        const b = find('driveThrough', { tier: 'city', archetype: 'twoWing', plot: 'cornerLot' });
        const windows = b.level.walls.filter(w => w.kind === 'tellerWindow');
        expect(windows.length).toBe(2);
        expect(b.props.some(p => p.kind === 'tubeTerminal')).toBe(true);
        expect(b.props.some(p => p.kind === 'backCounter' && p.tx === windows[0]!.tx - 1 && p.facing === 'west')).toBe(true);
        expect(b.people.some(p => p.traits.includes('drive-through window') && p.tx === windows[0]!.tx - 2)).toBe(true);
    }, 120000);

    it('gives a bank in a mall a second pair of front doors', () => {
        const b = find('mallBank', { tier: 'small', archetype: 'twoWing', plot: 'stripMallEnd' });
        const lobby = b.rooms.find(r => r.type === 'lobby')!, street = b.rooms.filter(r => r.zone === 'outdoors').map(r => r.id);
        expect(b.doors.filter(d => (d.a === lobby.id && street.includes(d.b)) || (d.b === lobby.id && street.includes(d.a))).length).toBe(2);
    }, 120000);

    it('gives the old bank metre-thick walls round its vault', () => {
        const b = find('oldBank', { tier: 'small', archetype: 'fortress', plot: 'midBlock' });
        expect(b.level.walls.some(w => w.kind === 'thick')).toBe(true);
    }, 120000);
});

describe('room parcels (§17.1)', () => {
    it('give every furnished room type three or more parcels, six or more variants with mirroring', () => {
        for (const [type, parcels] of Object.entries(PARCELS)) expect(parcels!.length, type).toBeGreaterThanOrEqual(3);
        expect(Object.keys(ROOM_RULES).length).toBeGreaterThan(Object.keys(PARCELS).length);
        expect(ARCHETYPES.length).toBe(5);
    });
});

/*
 * Interiors (generator.md, Interiors step 1): rooms are unions of rectangles, each wing a program of rooms with jobs
 * rather than one stretched hall, shape moves between neighbours, and locked shortcuts where a walk goes the long way.
 * Checked on the shells (rooms, walls and doors) of every tier, archetype and plot over several seeds.
 */
describe('interiors', () => {
    const shell = (layout: number, tier: Tier, archetype: Archetype, plot: PlotKind): Shell => {
        const rng = new Rng(layout), shape = rollShape(rng, { layout, population: 1, tier, archetype, plot });
        for (let attempt = 0; attempt < 20; attempt++) {
            const built = buildShell(rng.fork(`attempt-${attempt}`), shape);
            if (built) return built;
        }
        throw new Error(`No shell for ${layout} ${tier} ${archetype} ${plot}`);
    };
    const shells: Shell[] = [];
    let n = 0;
    for (const tier of TIERS) for (const archetype of archetypesFor(tier)) for (const plot of PLOTS) for (let seed = 0; seed < 3; seed++) shells.push(shell(3000 + 101 * n++, tier, archetype, plot));
    const name = (s: Shell) => `${s.tier} ${s.archetype} ${s.plotKind}`;
    /** The rooms that keep their rectangle (§17.2), and those big by design. */
    const FIXED: RoomType[] = ['vault', 'antechamber', 'mantrap', 'tellerLine', 'stairwell', 'mezzanine'];
    const STAFF = (r: GenRoom) => r.bank && r.zone !== 'public' && r.type !== 'staffCorridor' && !FIXED.includes(r.type);

    it('gives every room parts that match the owner grid: one piece, no U, nothing narrower than two tiles', () => {
        const bad: string[] = [];
        for (const s of shells) for (const room of s.bank) {
            const index = s.site.rooms.indexOf(room), tiles = s.site.tilesOfRoom(room), area = room.parts.reduce((t, p) => t + p.w * p.h, 0);
            const inParts = (x: number, y: number) => room.parts.some(p => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
            if (tiles.length !== area || !tiles.every(t => inParts(t.x, t.y))) bad.push(`${name(s)} ${room.id}: parts don't match the grid`);
            for (const p of room.parts) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (s.site.owner[y]![x] !== index) bad.push(`${name(s)} ${room.id}: ${x},${y} not its own`);
            if (FIXED.includes(room.type) && room.parts.length !== 1) bad.push(`${name(s)} ${room.id} isn't a rectangle`);
            const mine = (x: number, y: number) => s.site.roomAt(x, y) === room;
            // One piece.
            const seen = new Set([`${tiles[0]!.x},${tiles[0]!.y}`]), queue = [tiles[0]!];
            while (queue.length) {
                const t = queue.pop()!;
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (mine(t.x + dx!, t.y + dy!) && !seen.has(`${t.x + dx!},${t.y + dy!}`)) { seen.add(`${t.x + dx!},${t.y + dy!}`); queue.push({ x: t.x + dx!, y: t.y + dy! }); }
            }
            if (seen.size !== tiles.length) bad.push(`${name(s)} ${room.id} is in pieces`);
            // Two tiles wide: every tile in a 2×2 square of the room.
            const square = (x: number, y: number) => mine(x, y) && mine(x + 1, y) && mine(x, y + 1) && mine(x + 1, y + 1);
            if (room.type !== 'staffCorridor' || room.parts.length > 1) {
                for (const t of tiles) if (![[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([dx, dy]) => square(t.x + dx!, t.y + dy!))) bad.push(`${name(s)} ${room.id}: a sliver at ${t.x},${t.y}`);
            }
            // No U: every gap in the bounding box reaches one of its corners.
            const gap = new Set<string>();
            for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) {
                if (mine(x, y) || gap.has(`${x},${y}`)) continue;
                let corner = false;
                const fill = [{ x, y }];
                gap.add(`${x},${y}`);
                while (fill.length) {
                    const t = fill.pop()!;
                    if ((t.x === room.x || t.x === room.x + room.w - 1) && (t.y === room.y || t.y === room.y + room.h - 1)) corner = true;
                    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const u = { x: t.x + dx!, y: t.y + dy! };
                        if (u.x < room.x || u.y < room.y || u.x >= room.x + room.w || u.y >= room.y + room.h || mine(u.x, u.y) || gap.has(`${u.x},${u.y}`)) continue;
                        gap.add(`${u.x},${u.y}`);
                        fill.push(u);
                    }
                }
                if (!corner) bad.push(`${name(s)} ${room.id} is a U (or has a hole)`);
            }
        }
        expect(bad).toEqual([]);
    });

    it('shapes some of the staff rooms, about one in three, and keeps the rest rectangles', () => {
        const staff = shells.flatMap(s => s.bank.filter(STAFF)), shaped = staff.filter(r => r.parts.length > 1);
        expect(shaped.length / staff.length).toBeGreaterThan(0.2);
        expect(shaped.length / staff.length).toBeLessThan(0.5);
    });

    it('keeps every staff and secure room within its most area: spare space becomes more rooms, not bigger ones', () => {
        const over: string[] = [];
        for (const s of shells) for (const room of s.bank) {
            const most = ROOM_RULES[room.type].area?.max, area = s.site.tilesOfRoom(room).length;
            if (most !== undefined && area > most) over.push(`${name(s)} ${room.id}: ${area} > ${most}`);
            if (!most && STAFF(room) && room.type !== 'loadingBay') over.push(`${name(s)} ${room.type} has no most area`);
        }
        expect(over).toEqual([]);
    });

    it('builds the new rooms with jobs, each with a door', () => {
        const rooms = shells.flatMap(s => s.bank.map(room => ({ s, room })));
        for (const type of ['countingRoom', 'recordsRoom', 'staffOffice', 'conferenceRoom'] as const) {
            const found = rooms.filter(({ room }) => room.type === type);
            expect(found.length, type).toBeGreaterThan(0);
            for (const { s, room } of found) expect(s.site.doors.some(d => d.a === room.id || d.b === room.id), `${name(s)} ${room.id}`).toBe(true);
        }
    });

    it('opens locked shortcuts only between rooms that were a long walk apart', () => {
        let count = 0;
        for (const s of shells) {
            const cuts = s.site.doors.filter(d => d.detour !== undefined);
            if (!cuts.length) continue;
            count += cuts.length;
            // Wall the shortcuts up again and walk between their two sides.
            for (const d of cuts) {
                expect(d.lock === 'keycard' || d.lock === 'mechanical').toBe(true);
                s.site.doors.splice(s.site.doors.indexOf(d), 1);
                s.site.setWall(d, 'plaster');
            }
            const nav = new Nav(s.site, new Furnisher(s.site));
            for (const d of cuts) {
                const [p, q] = tilesOf(d), steps = nav.distances([p]).dist[q.y * s.site.width + q.x]!;
                expect(d.detour!, `${name(s)} ${d.a}-${d.b}`).toBeGreaterThanOrEqual(SHORTCUT_DETOUR);
                expect(steps, `${name(s)} ${d.a}-${d.b}`).toBeGreaterThanOrEqual(SHORTCUT_DETOUR);
            }
        }
        expect(count).toBeGreaterThan(0);
    });
});
