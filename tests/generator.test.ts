import { describe, expect, it } from 'vitest';
import { roomLamps } from '../src/art/bank/lamps';
import { connect, defaultWalls, SHORTCUT_DETOUR } from '../src/gen/build';
import { cctvConsole, countingTable, deskPair, kitchenette, lounge, managerDesk, meeting, viewingTable, workstation } from '../src/gen/activities';
import { RoomPlan, type GroupDef } from '../src/gen/groups';
import { Furnisher, type Placed } from '../src/gen/furnish';
import { archetypesFor, buildShell, generateBank, parseSeed, rollShape, seedText, type Shell } from '../src/gen/generate';
import { REPEATABLE } from '../src/gen/layout';
import { ARCHETYPES, PLOTS, TIERS, type GeneratedBank, type GenRoom, type RoomType, type Tier, type Archetype, type PlotKind } from '../src/gen/model';
import { Nav } from '../src/gen/nav';
import { GALLERY_TYPES, GALLERY_VARIANTS, roomGallery } from '../src/gen/gallery';
import { emptyFurnished, PARCELS } from '../src/gen/parcels';
import { Rng } from '../src/gen/rng';
import { ROOM_RULES } from '../src/gen/rooms';
import { edgeBetween, edgeKey, Site, tilesOf } from '../src/gen/site';
import { TIER_SPECS } from '../src/gen/tiers';
import { TILE } from '../src/level/level';
import { isOnTop, propBox } from '../src/level/catalog';
import { isOffMap, parsePlan, toPlan } from '../src/level/plan';
import { boxesOverlap, FACINGS, PERSON_SIZE, place, supportOf, WALL_HEIGHT, type Box, type Facing } from '../src/level/space';
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

describe('the room gallery', () => {
    it('builds every room type in every variant, each with a door, furnished by the parcels', () => {
        const { data, cells } = roomGallery();
        expect(cells.length).toBe(GALLERY_TYPES.length * GALLERY_VARIANTS.length);
        // A way out through the front wall onto the corridor: a door, or an open doorway where the wall has a gap.
        const front = (c: (typeof cells)[number]) => Array.from({ length: c.w }, (_, i) => data.level.walls.find(w => w.run === 'eastWest' && w.ty === c.y + c.h && w.tx === c.x + i));
        for (const c of cells) expect(front(c).some(w => !w || w.kind.startsWith('door') || w.kind === 'vaultDoor' || w.kind === 'shutter'), `${c.type} ${c.variant}`).toBe(true);
        expect(data.props.length).toBeGreaterThan(cells.length * 2);
        expect(JSON.stringify(roomGallery().data)).toBe(JSON.stringify(data));
    });
});

/** Every tier, archetype and plot once (layout seeds apart), for the checks that need a sweep. */
const sweep: GeneratedBank[] = [];
{
    let k = 0;
    for (const tier of TIERS) for (const archetype of archetypesFor(tier)) for (const plot of PLOTS) sweep.push(bank(5000 + 37 * k, ++k, { tier, archetype, plot }));
}

/** A generated level as the furniture leaves it: which room each tile is in, the tiles furniture blocks, the walls. */
function siteOf(b: GeneratedBank): { roomAt: (x: number, y: number) => GenRoom | undefined; blocked: Set<string>; walls: Set<string> } {
    const owner = new Map<string, GenRoom>();
    for (const r of b.rooms) for (const p of r.parts) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) owner.set(`${x},${y}`, r);
    const blocked = new Set<string>();
    for (const p of b.props) {
        const box = propBox(p, b.level.walls);
        if (box.h === 0 || box.z >= PERSON_SIZE.h) continue;
        for (let y = Math.floor(box.y / TILE) - 1; y <= Math.floor((box.y + box.d) / TILE) + 1; y++) for (let x = Math.floor(box.x / TILE) - 1; x <= Math.floor((box.x + box.w) / TILE) + 1; x++) {
            if (p.kind === 'counter' && p.gate === x && p.ty === y) continue;
            if (boxesOverlap(box, place({ tx: x, ty: y }, PERSON_SIZE))) blocked.add(`${x},${y}`);
        }
    }
    const doors = new Set(b.doors.map(d => edgeKey(d)));
    const walls = new Set(b.level.walls.map(w => edgeKey(w)).filter(k => !doors.has(k)));
    return { roomAt: (x, y) => owner.get(`${x},${y}`), blocked, walls };
}

/*
 * Furnishing by activity (generator.md, Interiors steps 3–5): rooms are furnished with functional groups turned as one,
 * the walks between their doors kept free, desks staffed by a share of the people, a story or two per room, and the
 * room metrics in the validation report.
 */
describe('furnishing by activity', () => {
    /** A room `w` by `h` with walls round it and a door in its south wall, alone on a site. */
    const lone = (w: number, h: number) => {
        const site = new Site(w + 4, h + 4), rng = new Rng(5);
        const room = site.addRoom('staffOffice', { x: 2, y: 2, w, h }, { wing: 'centre', bank: true });
        const ring = [site.addRoom('staffCorridor', { x: 0, y: 0, w: w + 4, h: 2 }, { wing: 'centre', bank: true }), site.addRoom('staffCorridor', { x: 0, y: h + 2, w: w + 4, h: 2 }, { wing: 'centre', bank: true }),
            site.addRoom('staffCorridor', { x: 0, y: 2, w: 2, h }, { wing: 'centre', bank: true }), site.addRoom('staffCorridor', { x: w + 2, y: 2, w: 2, h }, { wing: 'centre', bank: true })];
        defaultWalls(site, { rng, oldBank: false, softOutside: false, softNeighbours: new Set() });
        if (!connect(site, room, ring[1]!, 'none', rng)) throw new Error('No door for the test room');
        const f = new Furnisher(site);
        return { site, f, plan: new RoomPlan(room, f, rng, emptyFurnished(), site) };
    };
    const STEP: Record<Facing, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
    const tilesOfBox = (b: Box) => {
        const out: string[] = [];
        for (let y = Math.floor(b.y / TILE); y <= Math.floor((b.y + b.d - 1) / TILE); y++) for (let x = Math.floor(b.x / TILE); x <= Math.floor((b.x + b.w - 1) / TILE); x++) out.push(`${x},${y}`);
        return out;
    };
    const GROUPS: GroupDef[] = [
        workstation('clerk', 'lamp'), workstation('clerk', 'papers'), deskPair('clerk'), managerDesk(true), meeting(1, 'meetingTable'), meeting(1, 'diningTable', 'dining'),
        countingTable(), kitchenette('staff'), lounge(), cctvConsole(), viewingTable()
    ];

    it('turns every group as one in all four facings, mirrored or not: chairs face their desk, tops stand on it, people stand at it', () => {
        const bad: string[] = [];
        for (const def of GROUPS) for (const facing of FACINGS) for (const mirror of [false, true]) {
            const { f, plan } = lone(9, 9), label = `${def.name} facing ${facing}${mirror ? ' mirrored' : ''}`;
            plan.walks();
            const g = plan.group(def, { facings: [facing], mirror });
            if (!g) { bad.push(`${label} doesn't fit an empty room`); continue; }
            const anchors = g.placed.filter((b, i): b is Placed => !!b && !!def.pieces[i]!.tag && !def.pieces[i]!.on);
            const anchorTiles = new Set(anchors.flatMap(a => tilesOfBox(a.box)));
            for (const [i, b] of g.placed.entries()) {
                if (!b) continue;
                const piece = def.pieces[i]!;
                if (piece.on && supportOf(b.box, f.boxes.map(x => x.box)) !== g.placed[piece.on.piece]!.box) bad.push(`${label}: ${piece.kind} isn't on its ${def.pieces[piece.on.piece]!.kind}`);
                if ((b.prop.kind === 'chair' || b.prop.kind === 'officeChair') && anchors.length) {
                    const [dx, dy] = STEP[b.box.facing];
                    if (!anchorTiles.has(`${b.prop.tx + dx},${b.prop.ty + dy}`)) bad.push(`${label}: a chair at ${b.prop.tx},${b.prop.ty} faces ${b.box.facing}, away from its table`);
                }
            }
            for (const s of g.stations) {
                const at = (Object.entries(STEP) as [Facing, [number, number]][]).find(([, [dx, dy]]) => anchorTiles.has(`${s.tx + dx},${s.ty + dy}`));
                if (!at) bad.push(`${label}: the ${s.role} stands away from the desk`);
                else if (at[0] === 'north' && s.facing !== 'back') bad.push(`${label}: the ${s.role} turns their back on the desk`);
                else if (at[0] === 'south' && s.facing !== 'front') bad.push(`${label}: the ${s.role} turns their back on the desk`);
            }
        }
        expect(bad).toEqual([]);
    });

    it('keeps the walk between a room\'s doors free, so every door of every room reaches every other inside it', () => {
        const cut: string[] = [];
        for (const b of sweep) {
            const site = siteOf(b);
            for (const room of b.rooms.filter(r => r.bank && r.zone !== 'outdoors' && !['lobby', 'tellerLine', 'stairwell', 'mezzanine'].includes(r.type))) {
                const inside = b.doors.filter(d => d.a === room.id || d.b === room.id).map(d => tilesOf(d).find(t => site.roomAt(t.x, t.y)?.id === room.id)!);
                if (inside.length < 2) continue;
                const seen = new Set([`${inside[0]!.x},${inside[0]!.y}`]), queue = [inside[0]!];
                while (queue.length) {
                    const p = queue.pop()!;
                    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                        const q = { x: p.x + dx, y: p.y + dy }, k = `${q.x},${q.y}`;
                        if (seen.has(k) || site.roomAt(q.x, q.y)?.id !== room.id || site.blocked.has(k) || site.walls.has(edgeKey(edgeBetween(p, q)))) continue;
                        seen.add(k);
                        queue.push(q);
                    }
                }
                for (const t of inside) if (!seen.has(`${t.x},${t.y}`)) cut.push(`${b.tier} ${b.archetype} ${b.plot}: ${room.id} door at ${t.x},${t.y}`);
            }
        }
        expect(cut).toEqual([]);
    });

    it('fills the staff and secure rooms (no more than 12 tiles of floor per piece of furniture) and gives the staff rooms tall cover', () => {
        const empty: string[] = [], bare: string[] = [];
        const PASSAGES: RoomType[] = ['staffCorridor', 'loadingBay', 'mantrap', 'stairwell', 'mezzanine'];
        for (const b of sweep) {
            const metrics = b.validation.metrics, type = (id: string) => b.rooms.find(r => r.id === id)!;
            expect(metrics.length, `${b.tier} ${b.archetype} ${b.plot}`).toBe(b.rooms.filter(r => r.bank).length);
            for (const m of metrics) if (type(m.room).zone !== 'public' && !PASSAGES.includes(m.type) && m.tilesPerPiece > 12) empty.push(`${b.tier} ${b.archetype} ${b.plot}: ${m.room} ${m.area} tiles, ${m.furniture} pieces`);
            const staff = metrics.filter(m => type(m.room).zone === 'staff' && !PASSAGES.includes(m.type));
            const tall = staff.reduce((s, m) => s + m.tallTiles, 0) / staff.length;
            if (tall < 1) bare.push(`${b.tier} ${b.archetype} ${b.plot}: ${tall.toFixed(2)} tall tiles per staff room`);
            for (const m of metrics) expect(m.seenFromDoors, m.room).toBeLessThanOrEqual(1);
        }
        expect(empty).toEqual([]);
        expect(bare).toEqual([]);
    });

    it('stands everything on a top on a top at its height, and passes §17.7 across every tier, archetype and plot', () => {
        const failures: string[] = [];
        for (const b of sweep) {
            const boxes = b.props.map(p => propBox(p, b.level.walls));
            b.props.forEach((p, i) => { if (isOnTop(p.kind)) expect(() => supportOf(boxes[i]!, boxes), `${p.kind} at ${p.tx},${p.ty}`).not.toThrow(); });
            for (const r of b.validation.results) if (!r.ok && !b.validation.relaxed.includes(r.rule)) failures.push(`${b.tier} ${b.archetype} ${b.plot}: ${r.rule}`);
        }
        expect(failures).toEqual([]);
    });

    it('uses the arms of an L: something stands in the arm, not only in the largest part', () => {
        const { data, cells } = roomGallery();
        const missing: string[] = [];
        for (const c of cells.filter(c => c.variant === 'L-shaped' && !['mantrap', 'restroom', 'antechamber'].includes(c.type))) {
            const room = data.rooms.find(r => r.name.endsWith('(L-shaped)') && r.x === c.x && r.y === c.y)!;
            const arm = room.parts![1]!;
            const inArm = data.props.some(p => p.tx >= arm.x && p.tx < arm.x + arm.w && p.ty >= arm.y && p.ty < arm.y + arm.h && !isOnTop(p.kind));
            if (!inArm) missing.push(c.type);
        }
        expect(missing).toEqual([]);
    });

    it('records who works at each desk, and staffs a share of them from the population seed', () => {
        const roles = new Set(sweep.flatMap(b => b.people.map(p => p.role)));
        for (const role of ['clerk', 'counter']) expect(roles.has(role), role).toBe(true);
        const a = bank(4242, 7), other = bank(4242, 8);
        const desks = (b: GeneratedBank) => b.people.filter(p => p.role === 'clerk').map(p => `${p.tx},${p.ty}`).sort();
        expect(other.props).toEqual(a.props);
        expect(desks(other)).not.toEqual(desks(a));
        // Not every desk is staffed: across the sweep some stand empty.
        const clerks = sweep.reduce((s, b) => s + b.people.filter(p => p.role === 'clerk').length, 0);
        const chairs = sweep.reduce((s, b) => s + b.props.filter(p => p.kind === 'officeChair').length, 0);
        expect(clerks).toBeGreaterThan(0);
        expect(clerks).toBeLessThan(chairs);
    });

    it('tells a story or two per room, never the same one twice in a bank, and turns the note on a desk into an opportunity', () => {
        let notes = 0;
        for (const b of sweep) {
            expect(b.stories.length, `${b.tier} ${b.archetype} ${b.plot}`).toBeGreaterThan(3);
            const ids = b.stories.map(s => s.id);
            expect(new Set(ids).size, `${b.tier} ${b.archetype} ${b.plot}`).toBe(ids.length);
            for (const room of new Set(b.stories.map(s => s.room))) expect(b.stories.filter(s => s.room === room).length).toBeLessThanOrEqual(2);
            if (ids.includes('sticky-note')) {
                notes++;
                expect(b.opportunities.find(o => o.id === 'sticky-note'), `${b.tier} ${b.archetype} ${b.plot}`).toMatchObject({ found: 'documents' });
            }
        }
        expect(notes).toBeGreaterThan(sweep.length / 4);
    });
});
