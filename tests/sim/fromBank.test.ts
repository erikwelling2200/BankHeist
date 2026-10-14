import { describe, expect, it } from 'vitest';
import { archetypesFor, generateBank } from '../../src/gen/generate';
import { PLOTS, TIERS, type GeneratedBank } from '../../src/gen/model';
import { SEE_THROUGH } from '../../src/gen/nav';
import { WALL_CHARS } from '../../src/level/plan';
import type { WallKind } from '../../src/level/walls';
import { DOOR_KINDS, edgeKey, tileAt, WALL_MATERIALS, worldFromBank, type ReadonlyWorld, type Zone } from '../../src/sim';

/*
 * M1-02: every generated bank becomes a World the rules can play on, and the World says what the bank says: each tile's
 * zone is its room's, each door's segment carries the door, every wall kind has a material.
 */

const SEEDS = [0, 1];
const banks: { label: string; bank: GeneratedBank; world: ReadonlyWorld }[] = [];
for (const tier of TIERS) for (const archetype of archetypesFor(tier)) for (const plot of PLOTS) for (const s of SEEDS) {
    const bank = generateBank({ layout: 2000 + s * 7919, population: s, tier, archetype, plot });
    banks.push({ label: `${tier} ${archetype} ${plot} ${s}`, bank, world: worldFromBank(bank) });
}

const ZONE: Record<GeneratedBank['rooms'][number]['zone'], Zone> = { public: 'public', staff: 'staff', secure: 'secure', neighbour: 'public', outdoors: 'public' };

describe('worldFromBank', () => {
    it('builds a frozen world of the right size from every tier, archetype and plot', () => {
        expect(banks.length).toBe(TIERS.reduce((n, t) => n + archetypesFor(t).length, 0) * PLOTS.length * SEEDS.length);
        for (const { label, bank, world } of banks) {
            expect(world.height, label).toBe(bank.level.tiles.length);
            expect(world.width, label).toBe(bank.level.tiles[0]!.length);
            expect(Object.isFrozen(world.tiles[0]), label).toBe(true);
            expect(world.people.length, label).toBe(bank.people.length);
            expect(world.cameras.length, label).toBe(bank.cameras.length);
        }
    });

    it('gives each tile its room and its room\'s zone, the street and the neighbours counting as public', () => {
        for (const { label, bank, world } of banks) {
            const byId = new Map(bank.rooms.map(r => [r.id, r]));
            let rooms = 0;
            world.tiles.forEach((tile, i) => {
                const x = i % world.width, y = Math.floor(i / world.width);
                if (tile.room === null) {
                    expect(tile.blocksMove && tile.tall, `${label} off-map (${x}, ${y})`).toBe(true);
                    return;
                }
                rooms++;
                const room = byId.get(tile.room)!;
                expect(room.parts.some(p => x >= p.x && y >= p.y && x < p.x + p.w && y < p.y + p.h), `${label} (${x}, ${y})`).toBe(true);
                expect(tile.zone, `${label} (${x}, ${y}) in ${room.id}`).toBe(ZONE[room.zone]);
                expect(tile.lit, `${label} (${x}, ${y})`).toBe(room.light !== 'none' || room.zone === 'outdoors');
                if (tile.halfCover) expect(tile.blocksMove && !tile.tall).toBe(true);
            });
            expect(rooms, label).toBeGreaterThan(0);
            // People and the alarm stations stand where they can.
            for (const p of world.people) expect(tileAt(world, p.pos)?.blocksMove, `${label} ${p.id}`).toBe(false);
            for (const o of world.objects.filter(o => o.kind === 'alarmButton')) expect(tileAt(world, o.pos)?.room, `${label} ${o.id}`).not.toBeNull();
        }
    });

    it('puts a door in every door segment, closed or locked by its lock', () => {
        for (const { label, bank, world } of banks) {
            for (const wall of bank.level.walls) {
                const edge = world.edges[edgeKey(wall)]!;
                expect(edge, label).toBeDefined();
                expect(edge.material, `${label} ${wall.kind}`).toBe(WALL_MATERIALS[wall.kind].material);
                if (DOOR_KINDS.includes(wall.kind)) expect(edge.door, `${label} ${wall.kind} at ${edgeKey(wall)}`).toBeDefined();
            }
            // Double doors are one door: no segment needed a door of its own.
            for (const id of Object.keys(world.doors)) expect(bank.doors.some(d => d.id === id), `${label} ${id}`).toBe(true);
            for (const door of bank.doors) {
                const def = world.doors[door.id];
                if (door.open) {
                    expect(def, `${label} ${door.id} is an opening`).toBeUndefined();
                    continue;
                }
                expect(def, `${label} ${door.id}`).toBeDefined();
                expect(world.edges[def!.edge]?.door, `${label} ${door.id}`).toBe(door.id);
                expect(def!.lock).toBe(door.lock);
                expect(def!.start).toBe(door.lock === 'none' ? 'closed' : 'locked');
            }
        }
    });

    it('carries the objects, the alarm stations, the loot and the cameras\' pans', () => {
        for (const { label, bank, world } of banks) {
            const kinds = (k: string) => world.objects.filter(o => o.kind === k);
            expect(kinds('alarmButton').length, label).toBe(bank.alarms.length);
            expect(kinds('loot').length, label).toBe(bank.loot.length);
            expect(new Set(world.objects.map(o => o.id)).size, label).toBe(world.objects.length);
            if (bank.rooms.some(r => r.type === 'cctvRoom')) expect(kinds('cctvDesk')[0]?.monitors, label).toBe(bank.monitors);
            if (bank.rooms.some(r => r.type === 'antechamber')) expect(kinds('vaultConsole').length, label).toBeGreaterThan(0);
            for (const c of world.cameras) expect(c.facings.length, `${label} ${c.id}`).toBe(bank.cameras.find(k => k.id === c.id)!.panning ? 2 : 1);
        }
        expect(banks.some(b => b.world.cameras.some(c => c.facings.length === 2))).toBe(true);
        expect(banks.some(b => b.bank.hatches.length && b.bank.grates.length && b.bank.stations.length)).toBe(true);
    });
});

describe('wall materials', () => {
    it('map every wall kind, and see through exactly what the generator sees through', () => {
        const kinds = Object.keys(WALL_CHARS) as WallKind[];
        expect(Object.keys(WALL_MATERIALS).sort()).toEqual([...kinds].sort());
        for (const kind of kinds) {
            expect(WALL_MATERIALS[kind].blocksSight, kind).toBe(!SEE_THROUGH.includes(kind));
            expect(WALL_MATERIALS[kind].blocksMove, kind).toBe(true);
        }
    });
});
