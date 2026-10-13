import { describe, expect, it } from 'vitest';
import { buildExposure, buildLightMaps, facade, type Caster } from '../src/art/bank/lightmap';
import { TILE } from '../src/level/level';
import { propBox } from '../src/level/catalog';
import { isOffMap, isOutdoors, LOBBY_PEOPLE, LOBBY_PLAN, LOBBY_PROPS, parseLobby } from '../src/level/lobby';
import { boxesOverlap, CUT_HEIGHT, PERSON_SIZE, place, WALL_HEIGHT, type Box } from '../src/level/space';
import { wallFootprint, wallInsets, WALL_THICKNESS, type Wall } from '../src/level/walls';

const level = parseLobby(LOBBY_PLAN);
const { tiles, walls } = level;
const front = facade(level);
const glow = (maps: ReturnType<typeof buildLightMaps>, x: number, y: number) => maps.glow[(y * maps.width + x) * 4]!;
const shade = (maps: ReturnType<typeof buildLightMaps>, x: number, y: number) => maps.shade[(y * maps.width + x) * 4]!;

describe('lobby plan', () => {
    it('rejects ragged rows, unknown floors and walls, and walls where a corner belongs', () => {
        expect(() => parseLobby([' - ', '|.', ' - '])).toThrow();
        expect(() => parseLobby(['   ', ' ? ', '   '])).toThrow();
        expect(() => parseLobby([' ? ', ' . ', '   '])).toThrow();
        expect(() => parseLobby(['-  ', ' . ', '   '])).toThrow();
    });

    it('reads floors from the odd cells and walls from the edges between them', () => {
        const plan = parseLobby(['+-+', '|.d', '+ +']);
        expect(plan.tiles).toEqual([['.']]);
        expect(plan.walls).toEqual([
            { kind: 'plaster', run: 'eastWest', tx: 0, ty: 0 },
            { kind: 'plaster', run: 'northSouth', tx: 0, ty: 0 },
            { kind: 'doorWood', run: 'northSouth', tx: 1, ty: 0 }
        ]);
    });

    it('puts the street along the bottom, in front of the shop front', () => {
        expect(front.walls.length).toBe(tiles[0]!.length);
        expect(tiles[front.line / TILE]!.every(t => t === 's')).toBe(true);
        expect(tiles.at(-1)!.every(t => t === 'r')).toBe(true);
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

describe('lobby layout', () => {
    const things: { name: string; box: Box }[] = [
        ...LOBBY_PROPS.map(p => ({ name: `${p.kind} at ${p.tx},${p.ty}`, box: propBox(p, walls) })),
        ...LOBBY_PEOPLE.map(p => ({ name: `${p.look} at ${p.tx},${p.ty}`, box: place({ tx: p.tx, ty: p.ty }, PERSON_SIZE) }))
    ];
    const inWall = (box: Box) => walls.some(w => {
        const f = wallFootprint(w);
        return box.x < f.x + f.w && f.x < box.x + box.w && box.y < f.y + f.d && f.y < box.y + box.d;
    });

    it('stands every footprint on the map and clear of every wall', () => {
        for (const { name, box } of things) {
            for (let y = box.y; y < box.y + box.d; y++) for (let x = box.x; x < box.x + box.w; x++) {
                expect(isOffMap(tiles[Math.floor(y / TILE)]![Math.floor(x / TILE)]!), name).toBe(false);
            }
            expect(inWall(box), name).toBe(false);
        }
    });

    it('keeps every object out of every other object in 3D', () => {
        for (let i = 0; i < things.length; i++) for (let j = i + 1; j < things.length; j++) {
            expect(boxesOverlap(things[i]!.box, things[j]!.box), `${things[i]!.name} and ${things[j]!.name}`).toBe(false);
        }
    });

    it('hangs wall dressing on the face of a wall, below the cut-away top', () => {
        for (const { name, box } of things.filter(t => t.box.z > 0 && t.box.d <= 1)) {
            const wall = walls.find(w => w.run === 'eastWest' && w.tx === Math.floor(box.x / TILE) && w.ty === Math.floor(box.y / TILE));
            expect(wall, name).toBeDefined();
            const f = wallFootprint(wall!);
            expect(box.y, name).toBe(f.y + f.d);
            expect(box.z + box.h, name).toBeLessThanOrEqual(WALL_HEIGHT);
        }
    });

    it('walks every patrol through tiles clear of furniture and walls', () => {
        for (const p of LOBBY_PEOPLE.filter(p => p.patrol)) {
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
        expect(buildLightMaps(level, [], [indoor]).shade).toEqual(plain.shade);
    });

    it('keeps the street at full exposure and shades the inside, up to the top of the shop front as drawn', () => {
        const width = tiles[0]!.length * TILE;
        const exposureAt = (map: Uint8ClampedArray, x: number, y: number) => map[(y * width + x) * 4 + 2]!;
        const full = buildExposure(level, facadeY - WALL_HEIGHT), cut = buildExposure(level, facadeY - CUT_HEIGHT);
        const deep = (8 * TILE);
        expect(isOutdoors(tiles[deep / TILE]![2]!)).toBe(false);
        expect(exposureAt(full, 40, facadeY + TILE * 2)).toBe(255);
        expect(exposureAt(full, 40, deep)).toBeLessThan(128);
        // Floor just inside the glass is outdoors on screen while the full front covers it, indoors once the front is cut.
        expect(exposureAt(full, 40, facadeY - 12)).toBe(255);
        expect(exposureAt(cut, 40, facadeY - 12)).toBeLessThan(255);
        expect(exposureAt(cut, 40, facadeY - 12)).toBeGreaterThan(exposureAt(cut, 40, deep));
    });
});
