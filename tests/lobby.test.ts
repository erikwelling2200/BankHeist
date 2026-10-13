import { describe, expect, it } from 'vitest';
import { buildLightMaps, type Caster } from '../src/art/bank/lightmap';
import { TILE } from '../src/level/level';
import { propBox } from '../src/level/catalog';
import { isStructure, LOBBY_PEOPLE, LOBBY_PROPS, LOBBY_TILES, parseLobby } from '../src/level/lobby';
import { boxesOverlap, PERSON_SIZE, place, WALL_HEIGHT, type Box } from '../src/level/space';

const tiles = parseLobby(LOBBY_TILES);
const facadeRow = tiles.findIndex(row => row.includes('g'));
const glow = (maps: ReturnType<typeof buildLightMaps>, x: number, y: number) => maps.glow[(y * maps.width + x) * 4]!;
const shade = (maps: ReturnType<typeof buildLightMaps>, x: number, y: number) => maps.shade[(y * maps.width + x) * 4]!;

describe('lobby layout', () => {
    it('rejects ragged rows and unknown tiles', () => {
        expect(() => parseLobby(['##', '#'])).toThrow();
        expect(() => parseLobby(['#?'])).toThrow();
    });

    it('puts the street along the bottom, below the façade', () => {
        expect(facadeRow).toBeGreaterThan(0);
        expect(tiles[facadeRow + 1]!.every(t => t === 's')).toBe(true);
        expect(tiles.at(-1)!.every(t => t === 'r')).toBe(true);
    });

    const things: { name: string; box: Box }[] = [
        ...LOBBY_PROPS.map(p => ({ name: `${p.kind} at ${p.tx},${p.ty}`, box: propBox(p) })),
        ...LOBBY_PEOPLE.map(p => ({ name: `${p.look} at ${p.tx},${p.ty}`, box: place({ tx: p.tx, ty: p.ty }, PERSON_SIZE) }))
    ];

    it('stands every footprint on open floor, never inside a wall', () => {
        for (const { name, box } of things) {
            for (let y = box.y; y < box.y + box.d; y++) for (let x = box.x; x < box.x + box.w; x++) {
                expect(isStructure(tiles[Math.floor(y / TILE)]![Math.floor(x / TILE)]!), name).toBe(false);
            }
        }
    });

    it('keeps every object out of every other object in 3D', () => {
        for (let i = 0; i < things.length; i++) for (let j = i + 1; j < things.length; j++) {
            expect(boxesOverlap(things[i]!.box, things[j]!.box), `${things[i]!.name} and ${things[j]!.name}`).toBe(false);
        }
    });

    it('hangs wall dressing against its wall and below the cut-away top', () => {
        for (const { name, box } of things.filter(t => t.box.z > 0 && t.box.d <= 1)) {
            expect(box.y % TILE, name).toBe(0);
            expect(isStructure(tiles[box.y / TILE - 1]![Math.floor(box.x / TILE)]!), name).toBe(true);
            expect(box.z + box.h, name).toBeLessThanOrEqual(WALL_HEIGHT);
        }
    });

    it('stands people in the middle of their tile', () => {
        const box = place({ tx: 3, ty: 5 }, PERSON_SIZE);
        expect(box.y + box.d / 2).toBe(5 * TILE + TILE / 2);
    });
});

describe('light maps', () => {
    const facadeY = facadeRow * TILE;
    const doorX = tiles[facadeRow]!.indexOf('D') * TILE;

    it('lets sun in only through the glass and only onto the floor inside', () => {
        const maps = buildLightMaps(tiles, [], []);
        // Just inside the doors the floor is lit; just inside a stone pier it is not.
        expect(glow(maps, doorX + 8 - 2, facadeY - 4)).toBeGreaterThan(0);
        const pierX = tiles[facadeRow]!.indexOf('p', 1) * TILE;
        expect(glow(maps, pierX + 8 - 2, facadeY - 4)).toBe(0);
        for (let x = 0; x < maps.width; x++) expect(glow(maps, x, facadeY + TILE + 4)).toBe(0);
    });

    it('lets someone standing in a shaft block it', () => {
        const x = doorX + 8 - 4, y = facadeY - 10;
        const open = buildLightMaps(tiles, [], []);
        const blocked = buildLightMaps(tiles, [{ x: x + 2, y: y + 6, w: 8, h: 3, height: 22 }], []);
        expect(glow(open, x, y)).toBeGreaterThan(0);
        expect(glow(blocked, x, y)).toBe(0);
    });

    it('casts sun shadows outdoors only, up and to the left of the caster', () => {
        const base = (facadeRow + 3) * TILE;
        const post: Caster = { left: 100, top: base - 40, width: 2, height: 40, base, opaque: () => true };
        const maps = buildLightMaps(tiles, [], [post]);
        const plain = buildLightMaps(tiles, [], []);
        // A pixel 20px up lands 12px up the screen and leans left with the shafts.
        const x = Math.round(100 - 12 * 0.38);
        expect(shade(maps, x, base - 12)).toBeLessThan(shade(plain, x, base - 12));
        expect(shade(maps, 100 + 6, base - 12)).toBe(shade(plain, 100 + 6, base - 12));
        const indoor: Caster = { ...post, top: facadeY - 60, base: facadeY - 20 };
        expect(buildLightMaps(tiles, [], [indoor]).shade).toEqual(plain.shade);
    });

    it('keeps the street at full exposure and shades the inside', () => {
        const maps = buildLightMaps(tiles, [], []);
        const exposure = (x: number, y: number) => maps.exposure[(y * maps.width + x) * 4 + 2]!;
        expect(exposure(40, facadeY + TILE * 2)).toBe(255);
        expect(exposure(40, 6 * TILE)).toBeLessThan(128);
        // Just inside the shop front (whose 1.5-tile face rises above its own tile) the window light lifts the shade.
        expect(exposure(40, facadeY - 14)).toBeGreaterThan(exposure(40, 6 * TILE));
        expect(exposure(40, facadeY - 14)).toBeLessThan(255);
    });
});
