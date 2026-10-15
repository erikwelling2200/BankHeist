import { describe, expect, it } from 'vitest';
import { buildExposure, buildLightMaps, streetFront, type Caster } from '../src/art/bank/lightmap';
import { TILE } from '../src/level/constants';
import { propBox } from '../src/level/catalog';
import { BANK_PEOPLE, BANK_PLAN, BANK_PROPS, BANK_ROOMS } from '../src/level/bank';
import { floorHeight, isOffMap, parsePlan, RAISED_HEIGHT } from '../src/level/plan';
import { boxesOverlap, CUT_HEIGHT, PERSON_SIZE, place, WALL_HEIGHT, type Box } from '../src/level/space';
import { wallFootprint, wallInsets, WALL_THICKNESS, type Wall } from '../src/level/walls';

const level = parsePlan(BANK_PLAN);
const { tiles, walls } = level;
const front = streetFront(level);
const glow = (maps: ReturnType<typeof buildLightMaps>, x: number, y: number) => maps.glow[(y * maps.width + x) * 4]!;
const shade = (maps: ReturnType<typeof buildLightMaps>, x: number, y: number) => maps.shade[(y * maps.width + x) * 4]!;

describe('bank plan', () => {
    it('rejects ragged rows, unknown floors and walls, and walls where a corner belongs', () => {
        expect(() => parsePlan([' - ', '|.', ' - '])).toThrow();
        expect(() => parsePlan(['   ', ' ? ', '   '])).toThrow();
        expect(() => parsePlan([' ? ', ' . ', '   '])).toThrow();
        expect(() => parsePlan(['-  ', ' . ', '   '])).toThrow();
    });

    it('reads floors from the odd cells and walls from the edges between them', () => {
        const plan = parsePlan(['+-+', '|.d', '+ +']);
        expect(plan.tiles).toEqual([['.']]);
        expect(plan.walls).toEqual([
            { kind: 'plaster', run: 'eastWest', tx: 0, ty: 0 },
            { kind: 'plaster', run: 'northSouth', tx: 0, ty: 0 },
            { kind: 'doorWood', run: 'northSouth', tx: 1, ty: 0 }
        ]);
    });

    it('puts the street along the bottom, in front of the fronts, and the alley along the top (§17.1)', () => {
        // Every segment of the street front with a building behind it: all but the two in front of tiles off the map.
        expect(front.walls.length).toBe(tiles[0]!.filter((_, x) => !isOffMap(tiles[front.line / TILE - 1]![x]!)).length);
        expect(tiles[front.line / TILE]!.every(t => t === 's')).toBe(true);
        // The road, then across it the far curb and sidewalk, in front of the office tower and its plazas.
        expect([31, 32, 33, 34, 35].every(y => tiles[y]!.every(t => t === 'r' || t === 'l'))).toBe(true);
        expect(tiles[36]!.every(t => t === 'c') && tiles[37]!.every(t => t === 's')).toBe(true);
        expect(tiles[1]!.every(t => t === 'a')).toBe(true);
    });

    it('names every room, each a rectangle of the floor its zone is drawn with, none overlapping', () => {
        const zoneFloor: Record<string, string[]> = { public: ['.', '=', 't'], staff: [','], secure: ['q', 'v', ','], neighbour: ['t', 'f', 'u', 'm', 'n', 'h', 'z', 'q'], outdoors: ['a', 's', 'c', 'r', 'l', 'y'] };
        const owner = new Map<string, string>();
        for (const room of BANK_ROOMS) for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) {
            expect(owner.get(`${x},${y}`), `${room.name} at ${x},${y}`).toBeUndefined();
            owner.set(`${x},${y}`, room.name);
            expect(zoneFloor[room.zone], `${room.name} at ${x},${y}`).toContain(tiles[y]![x]!);
        }
        // Every tile on the map is a room or off the map.
        tiles.forEach((row, y) => row.forEach((t, x) => expect(owner.has(`${x},${y}`) || isOffMap(t), `${x},${y}`).toBe(true)));
    });
});

describe('the sniper nest across the street (§14.5, §14.7)', () => {
    const nest = BANK_ROOMS.find(r => r.name === 'sniper nest')!;
    const DOORS = ['doorWood', 'doorKeycard', 'doorService', 'doorGlass', 'doorTower', 'vaultDoor'];
    const edge = new Map(walls.map(w => [`${w.run} ${w.tx} ${w.ty}`, w]));

    it('is a room of raised tiles with glass facing the bank', () => {
        for (let y = nest.y; y < nest.y + nest.h; y++) for (let x = nest.x; x < nest.x + nest.w; x++) expect(floorHeight(tiles, x, y)).toBe(RAISED_HEIGHT);
        for (let x = nest.x; x < nest.x + nest.w; x++) expect(edge.get(`eastWest ${x} ${nest.y}`)?.kind).toBe('curtain');
        expect(nest.y).toBeGreaterThan(front.line / TILE);
    });

    it('climbs a flight of stairs a step at a time', () => {
        const flight = tiles.flatMap((row, y) => row.map((t, x) => ({ t, x, y }))).filter(c => c.t === 'z');
        expect(flight.length).toBeGreaterThan(0);
        for (const { x, y } of flight) {
            expect(floorHeight(tiles, x, y)).toBeGreaterThan(floorHeight(tiles, x, y + 1));
            expect(floorHeight(tiles, x, y - 1)).toBeGreaterThan(floorHeight(tiles, x, y));
        }
    });

    it('is reached from the sidewalk through doors and up the stairs, not over a railing or by jumping a storey', () => {
        // Walk tile to tile: through no wall or a door, and never up or down more than a step.
        const maxStep = RAISED_HEIGHT / 3;
        const seen = new Set<string>(), queue: [number, number][] = [[20, 38]];
        seen.add('20,38');
        while (queue.length) {
            const [x, y] = queue.shift()!;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const nx = x + dx, ny = y + dy, t = tiles[ny]?.[nx];
                if (t === undefined || isOffMap(t) || seen.has(`${nx},${ny}`)) continue;
                const wall = dx ? edge.get(`northSouth ${Math.max(x, nx)} ${y}`) : edge.get(`eastWest ${x} ${Math.max(y, ny)}`);
                if (wall && !DOORS.includes(wall.kind)) continue;
                if (Math.abs(floorHeight(tiles, nx, ny) - floorHeight(tiles, x, y)) > maxStep) continue;
                seen.add(`${nx},${ny}`);
                queue.push([nx, ny]);
            }
        }
        expect(seen.has(`${nest.x},${nest.y}`)).toBe(true);
        // The railing keeps anyone from stepping off the landing onto the stairwell floor below.
        const landing = BANK_ROOMS.find(r => r.name === 'stair landing')!;
        expect(edge.get(`eastWest ${landing.x} ${landing.y + 1}`)?.kind).toBe('rail');
    });
});

describe('walls between tiles', () => {
    it('centres a segment on its edge at its own thickness', () => {
        const wall: Wall = { kind: 'concrete', run: 'eastWest', tx: 2, ty: 3 };
        const f = wallFootprint(wall), t = WALL_THICKNESS.concrete;
        expect(f).toEqual({ x: 2 * TILE, y: 3 * TILE - Math.floor(t / 2), w: TILE, d: t });
        const side = wallFootprint({ kind: 'plaster', run: 'northSouth', tx: 2, ty: 3 });
        expect(side.w).toBe(WALL_THICKNESS.plaster);
        expect(side.d).toBe(TILE);
    });

    it('pushes something against a wall off its face', () => {
        const wall: Wall = { kind: 'plaster', run: 'eastWest', tx: 0, ty: 1 };
        const insets = wallInsets([wall], 0, 1, 1, 1);
        const f = wallFootprint(wall);
        expect(insets.north).toBe(f.y + f.d - TILE);
        const box = place({ tx: 0, ty: 1, alignY: 'north' }, { w: 4, d: 4, h: 4 }, insets);
        expect(box.y).toBe(f.y + f.d);
        // Centred things stay centred on their tile.
        expect(place({ tx: 0, ty: 1 }, { w: 4, d: 4, h: 4 }, insets).y).toBe(TILE + 6);
    });

    it('steps walls down to a cut that still shows them', () => {
        expect(CUT_HEIGHT).toBeGreaterThan(0);
        expect(CUT_HEIGHT).toBeLessThan(WALL_HEIGHT / 2);
    });
});

describe('bank layout', () => {
    it('fits every prop in its tiles between the walls', () => {
        const misfits = BANK_PROPS.flatMap(p => {
            try {
                propBox(p, walls);
                return [];
            } catch (e) {
                return [`${p.kind} at ${p.tx},${p.ty}: ${(e as Error).message}`];
            }
        });
        expect(misfits).toEqual([]);
    });

    const things: { name: string; box: Box }[] = [
        // Props that don't fit at all are reported by the test above; the rest are checked against each other here.
        ...BANK_PROPS.flatMap(p => {
            try {
                return [{ name: `${p.kind} at ${p.tx},${p.ty}`, box: propBox(p, walls) }];
            } catch {
                return [];
            }
        }),
        ...BANK_PEOPLE.map(p => ({ name: `${p.look} at ${p.tx},${p.ty}`, box: place({ tx: p.tx, ty: p.ty }, PERSON_SIZE) }))
    ];
    const inWall = (box: Box) => walls.some(w => {
        const f = wallFootprint(w);
        return box.x < f.x + f.w && f.x < box.x + box.w && box.y < f.y + f.d && f.y < box.y + box.d;
    });

    it('stands every footprint on the map and clear of every wall', () => {
        const wrong = things.filter(({ box }) => {
            for (let y = box.y; y < box.y + box.d; y++) for (let x = box.x; x < box.x + box.w; x++) if (isOffMap(tiles[Math.floor(y / TILE)]![Math.floor(x / TILE)]!)) return true;
            return inWall(box);
        }).map(t => t.name);
        expect(wrong).toEqual([]);
    });

    it('keeps every object out of every other object in 3D', () => {
        const clashes: string[] = [];
        for (let i = 0; i < things.length; i++) for (let j = i + 1; j < things.length; j++) {
            if (boxesOverlap(things[i]!.box, things[j]!.box)) clashes.push(`${things[i]!.name} and ${things[j]!.name}`);
        }
        expect(clashes).toEqual([]);
    });

    it('hangs wall dressing on the face of a wall, below the cut-away top', () => {
        for (const { name, box } of things.filter(t => t.box.z > 0 && t.box.d <= 2 && !t.name.startsWith('camera'))) {
            const wall = walls.find(w => w.run === 'eastWest' && w.tx === Math.floor(box.x / TILE) && w.ty === Math.floor(box.y / TILE));
            expect(wall, name).toBeDefined();
            const f = wallFootprint(wall!);
            expect(box.y, name).toBe(f.y + f.d);
            expect(box.z + box.h, name).toBeLessThanOrEqual(WALL_HEIGHT);
        }
    });

    it('walks every patrol through tiles clear of furniture and walls', () => {
        for (const p of BANK_PEOPLE.filter(p => p.patrol)) {
            const steps = Math.max(Math.abs(p.patrol!.tx - p.tx), Math.abs(p.patrol!.ty - p.ty));
            for (let s = 0; s <= steps; s++) {
                const tx = Math.round(p.tx + ((p.patrol!.tx - p.tx) * s) / steps), ty = Math.round(p.ty + ((p.patrol!.ty - p.ty) * s) / steps);
                const box = place({ tx, ty }, PERSON_SIZE), name = `${p.look} walking through ${tx},${ty}`;
                expect(inWall(box), name).toBe(false);
                for (const t of things.filter(t => !t.name.startsWith(`${p.look} `))) expect(boxesOverlap(box, t.box), `${name} and ${t.name}`).toBe(false);
            }
        }
    });

    it('stands people in the middle of their tile', () => {
        const box = place({ tx: 3, ty: 7 }, PERSON_SIZE);
        expect(box.y + box.d / 2).toBe(7 * TILE + TILE / 2);
    });
});

describe('light maps', () => {
    const facadeY = front.line;
    const doorX = front.walls.find(w => w.kind === 'doorGlass')!.tx * TILE;

    it('lets sun in only through the glass and only onto the floor inside', () => {
        const maps = buildLightMaps(level, [], []);
        // Just inside the doors the floor is lit; just inside a stone pier it is not.
        expect(glow(maps, doorX + 8 - 2, facadeY - 4)).toBeGreaterThan(0);
        const pierX = front.walls.filter(w => w.kind === 'pier')[1]!.tx * TILE;
        expect(glow(maps, pierX + 8 - 2, facadeY - 4)).toBe(0);
        for (let x = 0; x < maps.width; x++) expect(glow(maps, x, facadeY + 4)).toBe(0);
    });

    it('lets someone standing in a shaft block it', () => {
        const x = doorX + 8 - 4, y = facadeY - 10;
        const open = buildLightMaps(level, [], []);
        const blocked = buildLightMaps(level, [{ x: x + 2, y: y + 6, w: 8, h: 3, height: 22 }], []);
        expect(glow(open, x, y)).toBeGreaterThan(0);
        expect(glow(blocked, x, y)).toBe(0);
    });

    it('casts sun shadows outdoors only, up and to the left of the caster', () => {
        const base = facadeY + 3 * TILE;
        const post: Caster = { left: 100, top: base - 40, width: 2, height: 40, base, opaque: () => true };
        const maps = buildLightMaps(level, [], [post]);
        const plain = buildLightMaps(level, [], []);
        // A pixel 20px up lands 12px up the screen and leans left with the shafts.
        const x = Math.round(100 - 12 * 0.38);
        expect(shade(maps, x, base - 12)).toBeLessThan(shade(plain, x, base - 12));
        expect(shade(maps, 100 + 6, base - 12)).toBe(shade(plain, 100 + 6, base - 12));
        const indoor: Caster = { ...post, top: facadeY - 60, base: facadeY - 20 };
        const indoors = buildLightMaps(level, [], [indoor]).shade;
        expect(indoors.findIndex((v, i) => v !== plain.shade[i])).toBe(-1);
    });

    it("exposes the street at full daylight and the inside at the building's shade, lifting towards the street glass", () => {
        const { width, rgb } = buildExposure(level);
        const at = (x: number, y: number) => rgb[(y * width + x) * 3 + 2]!;
        const lobbyX = 30 * TILE + 4, deep = 17 * TILE;
        expect(at(lobbyX, facadeY + 2 * TILE)).toBe(2);
        expect(at(lobbyX, 2 * TILE)).toBe(2);
        expect(at(lobbyX, deep)).toBeLessThan(1);
        expect(at(lobbyX, facadeY - 8)).toBeGreaterThan(at(lobbyX, deep));
        expect(at(lobbyX, facadeY - 8)).toBeLessThan(1);
    });
});
