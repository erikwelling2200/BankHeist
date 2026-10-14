import { expect, test } from 'vitest';
import { archetypesFor, generateBank } from '../src/gen/generate';
import { PLOTS, TIERS, type Archetype, type GeneratedBank, type PlotKind, type RoomType, type Tier } from '../src/gen/model';
import { ROOM_RULES } from '../src/gen/rooms';

/*
 * `npm run sweep`: generates every tier × archetype × plot from several seeds and prints what the generator made of
 * them: whether each bank passed §17.7 and how hard it was, how long it took, and how its rooms came out (sizes against
 * their targets, shapes, how full they are and the emptiest of each type, how much tall cover they have and how much of
 * them their doors see). Not part of `npm test`; it is the quick look after changing the generator.
 *
 * SWEEP_SEEDS sets how many seeds per combination (default 4); SWEEP_TIER, SWEEP_ARCHETYPE and SWEEP_PLOT pin one.
 */

const seeds = Number(process.env.SWEEP_SEEDS ?? 4);
const pick = <T extends string>(all: readonly T[], env?: string) => (env ? all.filter(v => v === env) : all);

interface RoomStats { count: number; area: number; maxArea: number; shaped: number; furniture: number; tall: number; seen: number; emptiest: number }

test('sweep', () => {
    const failures: string[] = [], times: number[] = [];
    const rooms = new Map<RoomType, RoomStats>();
    let attempts = 0, relaxed = 0, shortcuts = 0, n = 0;
    for (const tier of pick(TIERS, process.env.SWEEP_TIER)) for (const archetype of pick(archetypesFor(tier), process.env.SWEEP_ARCHETYPE)) {
        for (const plot of pick(PLOTS, process.env.SWEEP_PLOT)) for (let s = 0; s < seeds; s++) {
            const layout = 1000 + s * 7919, start = performance.now();
            const bank = generateBank({ layout, population: s, tier: tier as Tier, archetype: archetype as Archetype, plot: plot as PlotKind });
            times.push(performance.now() - start);
            n++;
            attempts += bank.validation.attempts;
            if (bank.validation.relaxed.length) relaxed++;
            shortcuts += bank.doors.filter(d => d.detour !== undefined).length;
            const failed = bank.validation.results.filter(r => !r.ok && !bank.validation.relaxed.includes(r.rule));
            if (failed.length) failures.push(`${tier} ${archetype} ${plot} seed ${layout}-${s}: ${failed.map(r => r.rule).join('; ')}`);
            tally(bank, rooms);
        }
    }
    const sorted = [...times].sort((a, b) => a - b), mean = times.reduce((s, t) => s + t, 0) / times.length;
    const lines = [
        '',
        `Generated ${n} banks: ${failures.length} failed §17.7, ${relaxed} needed a relaxed rule, ${(attempts / n).toFixed(2)} attempts each.`,
        `Time per bank: mean ${mean.toFixed(0)} ms, median ${sorted[Math.floor(n / 2)]!.toFixed(0)} ms, slowest ${sorted.at(-1)!.toFixed(0)} ms.`,
        `Shortcut doors: ${(shortcuts / n).toFixed(1)} per bank.`,
        '',
        'Room type          per bank  mean area  target  largest  max  shaped  tiles/piece  emptiest  tall cover  seen from doors',
        ...[...rooms.entries()].sort((a, b) => b[1].count - a[1].count).map(([type, r]) => {
            const area = ROOM_RULES[type].area;
            return `${type.padEnd(18)} ${(r.count / n).toFixed(1).padStart(8)} ${(r.area / r.count).toFixed(0).padStart(10)} ${String(area?.target ?? '-').padStart(7)}`
                + ` ${String(r.maxArea).padStart(8)}${area && r.maxArea > area.max ? '!' : ' '}${String(area?.max ?? '-').padStart(4)}`
                + ` ${`${Math.round((100 * r.shaped) / r.count)}%`.padStart(7)} ${(r.area / Math.max(1, r.furniture)).toFixed(1).padStart(12)}`
                + ` ${r.emptiest.toFixed(1).padStart(9)} ${(r.tall / r.count).toFixed(1).padStart(11)} ${`${Math.round((100 * r.seen) / r.count)}%`.padStart(16)}`;
        }),
        '',
        ...(failures.length ? ['Failures:', ...failures] : [])
    ];
    console.log(lines.join('\n'));
    expect(failures).toEqual([]);
}, 3_600_000);

/** Adds a bank's rooms to the tally: area, shape, and the room metrics (furniture, tall cover, floor seen from the doors). */
function tally(bank: GeneratedBank, out: Map<RoomType, RoomStats>): void {
    for (const r of bank.rooms.filter(r => r.bank)) {
        const m = bank.validation.metrics.find(m => m.room === r.id)!;
        const stats = out.get(r.type) ?? { count: 0, area: 0, maxArea: 0, shaped: 0, furniture: 0, tall: 0, seen: 0, emptiest: 0 };
        stats.count++;
        stats.area += m.area;
        stats.maxArea = Math.max(stats.maxArea, m.area);
        if ((r.parts?.length ?? 1) > 1) stats.shaped++;
        stats.furniture += m.furniture;
        stats.tall += m.tallTiles;
        stats.seen += m.seenFromDoors;
        stats.emptiest = Math.max(stats.emptiest, m.tilesPerPiece);
        out.set(r.type, stats);
    }
}
