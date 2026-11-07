import { expect, test } from 'vitest';
import { archetypesFor, generateBank } from '../src/gen/generate';
import { PLOTS, TIERS, type Archetype, type GeneratedBank, type PlotKind, type RoomType, type Tier } from '../src/gen/model';
import { ROOM_RULES } from '../src/gen/rooms';
import { playBot, type BotRun } from '../src/game/bot';

/*
 * `npm run sweep`: generates every tier × archetype × plot from several seeds and prints what the generator made of
 * them: whether each bank passed §17.7 and how hard it was, how long it took, and how its rooms came out (sizes against
 * their targets, shapes, how full they are and the emptiest of each type, how much tall cover they have and how much of
 * them their doors see). Not part of `npm test`; it is the quick look after changing the generator.
 *
 * SWEEP_SEEDS sets how many seeds per combination (default 4); SWEEP_TIER, SWEEP_ARCHETYPE and SWEEP_PLOT pin one.
 *
 * It also plays the playability bot (src/game/bot.ts, M5-05) in every bank and prints how often it reaches the alarm
 * closet or the CCTV room unexposed, per tier and archetype, and why it failed where it did. SWEEP_BOT picks how it
 * plays: `blueprints` (the default: as if the heist bought the Blueprints, §18.2), `cold` (knowing only the public
 * floor, as M1's heist starts), `both`, or `off`. The bot's failures don't fail the sweep.
 */

const seeds = Number(process.env.SWEEP_SEEDS ?? 4);
const pick = <T extends string>(all: readonly T[], env?: string) => (env ? all.filter(v => v === env) : all);
const BOT_MODES = { blueprints: ['blueprints'], cold: ['cold'], both: ['blueprints', 'cold'], off: [] } as const;
const botModes: readonly ('blueprints' | 'cold')[] = BOT_MODES[(process.env.SWEEP_BOT ?? 'blueprints') as keyof typeof BOT_MODES] ?? BOT_MODES.blueprints;

interface RoomStats { count: number; area: number; maxArea: number; shaped: number; furniture: number; tall: number; seen: number; emptiest: number }

test('sweep', () => {
    const failures: string[] = [], times: number[] = [];
    const rooms = new Map<RoomType, RoomStats>();
    let attempts = 0, relaxed = 0, shortcuts = 0, n = 0;
    // The bot's runs by mode, then by tier and archetype; its failures, each with the bank and why.
    const bot = new Map(botModes.map(m => [m, new Map<string, BotRun[]>()])), botFailures: string[] = [], botTimes: number[] = [];
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
            for (const mode of botModes) {
                const begun = performance.now(), run = playBot(bank, { blueprints: mode === 'blueprints' });
                botTimes.push(performance.now() - begun);
                const key = `${tier} ${archetype}`, runs = bot.get(mode)!;
                runs.set(key, [...(runs.get(key) ?? []), run]);
                if (!run.ok) botFailures.push(`${mode.padEnd(10)} ${tier} ${archetype} ${plot} seed ${layout}-${s}: ${run.why}`);
            }
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
        ...botLines(bot, botTimes),
        ...(botFailures.length ? ['', 'Where the bot failed:', ...botFailures] : []),
        '',
        ...(failures.length ? ['Failures:', ...failures] : [])
    ];
    console.log(lines.join('\n'));
    expect(failures).toEqual([]);
}, 3_600_000);

/** The bot's success rate per tier and archetype in each mode it played, and in all. */
function botLines(bot: ReadonlyMap<string, ReadonlyMap<string, readonly BotRun[]>>, times: readonly number[]): string[] {
    if (!bot.size) return [];
    const modes = [...bot.keys()], keys = [...bot.get(modes[0]!)!.keys()];
    const rate = (runs: readonly BotRun[]) => `${runs.filter(r => r.ok).length}/${runs.length}`.padStart(8) + ` ${`${Math.round((100 * runs.filter(r => r.ok).length) / runs.length)}%`.padStart(4)}`;
    const mean = times.reduce((s, t) => s + t, 0) / times.length;
    return [
        `The playability bot (M5-05), reaching the alarm closet or the CCTV room unexposed: ${(mean / 1000).toFixed(1)} s a run.`,
        `${'Tier and archetype'.padEnd(24)}${modes.map(m => m.padStart(14)).join('')}`,
        ...keys.map(k => `${k.padEnd(24)}${modes.map(m => rate(bot.get(m)!.get(k)!).padStart(14)).join('')}`),
        `${'All'.padEnd(24)}${modes.map(m => rate([...bot.get(m)!.values()].flat()).padStart(14)).join('')}`
    ];
}

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
