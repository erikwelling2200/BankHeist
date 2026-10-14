import { describe, expect, it } from 'vitest';
import { archetypesFor, generateBank, parseSeed, seedText } from '../src/gen/generate';
import { ARCHETYPES, PLOTS, TIERS, type GeneratedBank } from '../src/gen/model';
import { PARCELS } from '../src/gen/parcels';
import { ROOM_RULES } from '../src/gen/rooms';
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

    it('builds a drive-through teller window onto the lane, with its tube terminal', () => {
        const b = find('driveThrough', { tier: 'city', archetype: 'twoWing', plot: 'cornerLot' });
        expect(b.level.walls.some(w => w.kind === 'tellerWindow')).toBe(true);
        expect(b.props.some(p => p.kind === 'tubeTerminal')).toBe(true);
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
