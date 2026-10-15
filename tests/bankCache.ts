import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateBank, type GenerateOptions } from '../src/gen/generate';
import type { GeneratedBank } from '../src/gen/model';

/*
 * Generated banks shared across the unit tests: each (seed, tier, archetype, plot) is generated once per run (per test
 * worker, in memory) and kept on disk in `.cache/banks/` (gitignored), so later runs skip the generator entirely. The
 * disk key is a hash of every source file the generator imports (followed from `src/gen/generate.ts`) and of this file,
 * plus the options: change any of them and the old banks are no longer found (the last three versions are kept).
 * `BANK_CACHE=0` turns the disk cache off (memory only); `BANK_CACHE=refresh` regenerates and rewrites every bank.
 *
 * A bank from the cache is the generator's own output for those options, its §17.7 report included; a test of the
 * generator itself (that it builds and passes its checks) calls `generateBank` directly instead.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'src/gen/generate.ts');
export const CACHE_DIR = join(ROOT, '.cache/banks');
/** How many generator versions' banks are kept. */
const KEEP = 3;

/** The project's source files `entry` imports, directly or not, itself included (relative imports only). */
export function importClosure(entry: string, read: (file: string) => string = f => readFileSync(f, 'utf8')): string[] {
    const seen = new Set<string>(), queue = [entry];
    const resolveImport = (from: string, spec: string): string | undefined => {
        const base = resolve(dirname(from), spec);
        return [base, `${base}.ts`, join(base, 'index.ts')].find(file => existsSync(file) && statSync(file).isFile());
    };
    while (queue.length) {
        const file = queue.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        // `import … from './x'`, `export … from './x'`, `import './x'` and `import('./x')`, across lines.
        for (const m of read(file).matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
            const dep = resolveImport(file, m[1]!);
            if (dep && !seen.has(dep)) queue.push(dep);
        }
    }
    return [...seen].sort();
}

/** A hash of the generator's sources (and this cache's own), the disk cache's version. */
export function generatorHash(read: (file: string) => string = f => readFileSync(f, 'utf8')): string {
    const hash = createHash('sha256');
    for (const file of [...importClosure(ENTRY, read), fileURLToPath(import.meta.url)]) hash.update(`${relative(ROOT, file)}\0${read(file)}\0`);
    return hash.digest('hex').slice(0, 16);
}

/** The options in a fixed order, so `{ tier, layout }` and `{ layout, tier }` are the same bank. */
const keyOf = (opts: GenerateOptions): string => JSON.stringify([opts.layout, opts.population, opts.tier ?? null, opts.archetype ?? null, opts.plot ?? null]);

const memory = new Map<string, GeneratedBank>();
let version: string | undefined;

/** Where the bank for `opts` is kept on disk, under the generator's current hash. */
export function cachePath(opts: GenerateOptions, hash = (version ??= generatorHash())): string {
    return join(CACHE_DIR, hash, `${createHash('sha256').update(keyOf(opts)).digest('hex').slice(0, 24)}.json`);
}

const mode = (): 'off' | 'refresh' | 'on' => (process.env.BANK_CACHE === '0' ? 'off' : process.env.BANK_CACHE === 'refresh' ? 'refresh' : 'on');

/** Freezes `value` and everything in it, so a test changing a shared bank fails instead of changing it for the next. */
function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const v of Object.values(value)) deepFreeze(v);
    }
    return value;
}

/**
 * The bank `generateBank(opts)` builds, from memory or disk when it was built before with the same generator. Shared
 * between the tests of a file, so frozen. Throws as the generator does (nothing is cached then).
 */
export function cachedBank(opts: GenerateOptions): GeneratedBank {
    const key = keyOf(opts);
    const known = memory.get(key);
    if (known) return known;
    const how = mode();
    const file = how === 'off' ? undefined : cachePath(opts);
    if (file && how === 'on' && existsSync(file)) {
        try {
            const bank = deepFreeze(JSON.parse(readFileSync(file, 'utf8')) as GeneratedBank);
            memory.set(key, bank);
            return bank;
        } catch {
            // A torn or unreadable file: build it again.
        }
    }
    const bank = generateBank(opts);
    if (file) store(file, bank);
    memory.set(key, deepFreeze(bank));
    return bank;
}

/** Writes `bank` atomically (other test workers may read it at once), and drops banks of older generators. */
function store(file: string, bank: GeneratedBank): void {
    try {
        const dir = dirname(file);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
            // The banks of the last few generators stay (undoing a change finds its banks again); older ones go.
            const others = readdirSync(CACHE_DIR).map(name => join(CACHE_DIR, name)).filter(d => d !== dir)
                .map(d => ({ d, at: statSync(d).mtimeMs })).sort((a, b) => b.at - a.at);
            for (const { d } of others.slice(KEEP - 1)) rmSync(d, { recursive: true, force: true });
        }
        const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        writeFileSync(tmp, JSON.stringify(bank));
        renameSync(tmp, file);
    } catch {
        // The cache is only a speed-up: a read-only checkout still runs the tests.
    }
}
