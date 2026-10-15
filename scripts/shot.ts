/*
 * `npm run shot -- '<url or path>' [--out file.png] [--size 844x390] [--setup <preset>] [--wait settled|<selector>|<ms>|none]`
 * `npm run shot -- --many '<url>' '<url>' … [--out-dir screenshots]`
 * `npm run shot -- --setup beside-guard --setup alarm-countdown`
 * `npm run shot -- --list`
 *
 * A screenshot of a page without the test runner: reuses the Vite dev server on `E2E_PORT` (5173 by default) or starts
 * one and leaves it running for the next shot and `npm run test:e2e:dev`; loads the page in Playwright's Chromium (the
 * same software-rendered WebGL as the e2e tests), waits for the bank's walls to settle (or a selector, or a time), and
 * writes the PNG. A `--setup` (e2e/setups.ts) jumps the game straight to a situation through `window.sim` first. Several
 * pages (`--many`, or several `--setup`s) share one browser. Prints the time each stage took.
 *
 * Runs under Node's own type stripping: plain JavaScript plus type annotations.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { SETUPS } from '../e2e/setups.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT ?? 5173);
const BASE = `http://localhost:${PORT}`;
/** As the e2e tests launch it (playwright.config.ts). */
const LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

interface Options { urls: string[]; out?: string; outDir: string; size: { width: number; height: number }; setups: string[]; wait: string; many: boolean }

function usage(message?: string): never {
    if (message) console.error(`shot: ${message}\n`);
    console.error([
        "usage: npm run shot -- '<url or path>' [--out file.png] [--size 960x540] [--setup <preset>] [--wait settled|<selector>|<ms>|none]",
        "       npm run shot -- --many '<url>' '<url>' … [--out-dir screenshots]",
        '       npm run shot -- --list   (the setup presets)'
    ].join('\n'));
    process.exit(message ? 1 : 0);
}

function parse(argv: string[]): Options {
    const opts: Options = { urls: [], outDir: 'screenshots', size: { width: 960, height: 540 }, setups: [], wait: 'settled', many: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!, value = () => argv[++i] ?? usage(`${arg} needs a value`);
        if (arg === '--out' || arg === '-o') opts.out = value();
        else if (arg === '--out-dir') opts.outDir = value();
        else if (arg === '--size') {
            const m = /^(\d+)x(\d+)$/.exec(value());
            if (!m) usage('--size is WIDTHxHEIGHT, e.g. 844x390');
            opts.size = { width: Number(m[1]), height: Number(m[2]) };
        } else if (arg === '--setup') opts.setups.push(value());
        else if (arg === '--wait') opts.wait = value();
        else if (arg === '--many') opts.many = true;
        else if (arg === '--list') {
            for (const [name, s] of Object.entries(SETUPS)) console.log(`${name.padEnd(18)} ${s.about}`);
            process.exit(0);
        } else if (arg === '--help' || arg === '-h') usage();
        else if (arg.startsWith('--')) usage(`unknown option ${arg}`);
        else opts.urls.push(arg);
    }
    for (const s of opts.setups) if (!SETUPS[s]) usage(`no setup "${s}"; there are: ${Object.keys(SETUPS).join(', ')}`);
    if (!opts.urls.length && !opts.setups.length) usage('give a url or path, or a --setup');
    if (opts.urls.length > 1 && !opts.many) usage('several urls need --many');
    if (opts.many && opts.out) usage('--many writes to --out-dir, not --out');
    return opts;
}

/** `http://…` as it is, `/path?query` or `?query` on the dev server. */
const urlOf = (arg: string): string => (/^https?:\/\//.test(arg) ? arg : `${BASE}${arg.startsWith('/') ? '' : '/'}${arg}`);

/** A file name from a url: `/?view&seed=31-2` → `shot-view-seed-31-2.png`. */
const nameOf = (arg: string): string => `shot-${arg.replace(/^https?:\/\/[^/]+/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'index'}.png`;

const up = async (): Promise<boolean> => {
    try {
        return (await fetch(BASE, { signal: AbortSignal.timeout(1000) })).ok;
    } catch {
        return false;
    }
};

/** Reuses the dev server on the port, or starts one in the background and leaves it running. */
async function devServer(): Promise<string> {
    if (await up()) return 'reused';
    const vite = join(ROOT, 'node_modules/vite/bin/vite.js');
    const child = spawn(process.execPath, [vite, '--port', String(PORT), '--strictPort'], { cwd: ROOT, detached: true, stdio: 'ignore' });
    child.unref();
    for (const until = Date.now() + 60000; Date.now() < until;) {
        if (await up()) return `started (pid ${child.pid}, left running; stop it with: kill ${child.pid})`;
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`the dev server didn't come up on ${BASE}`);
}

/** Waits until the page's scene runs and, for `settled`, the bank's walls have reached their height; then two frames. */
async function waitFor(page: Page, wait: string): Promise<void> {
    if (wait === 'none') return;
    if (/^\d+$/.test(wait)) return page.waitForTimeout(Number(wait));
    if (wait !== 'settled') {
        await page.waitForSelector(wait, { timeout: 60000 });
        return;
    }
    await page.waitForFunction(() => {
        const game = (window as any).game;
        const scene = game?.scene.getScenes(true)[0];
        if (!scene) return false;
        return scene.sys.settings.key !== 'bank' || (scene.debugState?.settled ?? true);
    }, undefined, { timeout: 60000 });
    await page.evaluate(() => new Promise<void>(done => {
        const game = (window as any).game;
        game.events.once('postrender', () => game.events.once('postrender', () => done()));
    }));
}

/** Waits until the camera holds still (it eases to what was just selected). */
async function cameraStill(page: Page): Promise<void> {
    const at = () => page.evaluate(() => { const d = (window as any).game.scene.getScene('bank')?.debugState; return d ? `${d.midX},${d.midY},${d.zoom}` : ''; });
    for (const until = Date.now() + 5000; Date.now() < until;) {
        const a = await at();
        await page.waitForTimeout(120);
        if (a === (await at())) return;
    }
}

/** Plays a setup (e2e/setups.ts): finds the place, restarts the heist there, reloads, then plays on. */
async function setUp(page: Page, name: string): Promise<void> {
    const setup = SETUPS[name]!;
    await page.waitForFunction(() => (window as any).sim, undefined, { timeout: 60000 });
    const found = await page.evaluate(setup.script) as { state: unknown; info: unknown } | null;
    if (!found) throw new Error(`setup ${name}: this bank has no place for it`);
    await page.evaluate(state => (window as any).sim.restart(state), found.state);
    await page.reload();
    await page.waitForFunction(() => (window as any).game?.scene.getScene('bank')?.debugState?.play && (window as any).sim, undefined, { timeout: 60000 });
    await waitFor(page, 'settled');
    await page.evaluate(() => { (window as any).sim.session.playback.speed = 'instant'; });
    await setup.then?.(page, found.info);
    await page.waitForFunction(() => !(window as any).game.scene.getScene('bank').debugState.play.playing, undefined, { timeout: 30000 });
    await cameraStill(page);
}

const ms = (since: number) => `${Math.round(performance.now() - since)} ms`;

async function main(): Promise<void> {
    const opts = parse(process.argv.slice(2));
    const start = performance.now();
    const server = await devServer();
    console.log(`dev server ${BASE}: ${server}, ${ms(start)}`);
    let t = performance.now();
    const browser = await chromium.launch({ args: LAUNCH_ARGS });
    console.log(`browser: ${ms(t)}`);
    const jobs = opts.setups.length
        ? opts.setups.map(setup => ({ arg: opts.urls[0] ?? '/?new&still', setup, file: opts.out && opts.setups.length === 1 ? opts.out : join(opts.outDir, `shot-${setup}.png`) }))
        : opts.urls.map(arg => ({ arg, setup: undefined, file: opts.out ?? (opts.many ? join(opts.outDir, nameOf(arg)) : join(opts.outDir, 'shot.png')) }));
    let failed = 0;
    try {
        for (const job of jobs) {
            const page = await browser.newPage({ viewport: opts.size });
            const errors: string[] = [];
            page.on('pageerror', e => errors.push(e.message));
            page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
            const steps: string[] = [];
            const began = performance.now();
            try {
                t = performance.now();
                await page.goto(urlOf(job.arg));
                await waitFor(page, job.setup ? 'settled' : opts.wait);
                steps.push(`load ${ms(t)}`);
                if (job.setup) {
                    t = performance.now();
                    await setUp(page, job.setup);
                    steps.push(`setup ${ms(t)}`);
                }
                t = performance.now();
                mkdirSync(dirname(resolve(ROOT, job.file)), { recursive: true });
                await page.screenshot({ path: resolve(ROOT, job.file) });
                steps.push(`shot ${ms(t)}`);
                console.log(`${job.file}  (${job.setup ? `${job.setup} on ` : ''}${job.arg}): ${steps.join(', ')}, total ${ms(began)}`);
            } catch (e) {
                failed++;
                console.error(`${job.file}  (${job.arg}${job.setup ? `, ${job.setup}` : ''}) failed after ${steps.join(', ') || 'nothing'}: ${(e as Error).message.split('\n')[0]}`);
            }
            for (const e of errors) console.error(`  page error: ${e}`);
            await page.close();
        }
    } finally {
        await browser.close();
    }
    console.log(`${jobs.length - failed} of ${jobs.length} written in ${ms(start)}`);
    process.exit(failed ? 1 : 0);
}

await main();
