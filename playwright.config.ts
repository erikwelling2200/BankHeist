import { defineConfig } from '@playwright/test';

/*
 * By default the tests run against the production build (`npm run build` + `vite preview`), so they also prove the build
 * works: CI and the full run before a push do that. `npm run test:e2e:dev`, `test:smoke:dev` and `e2e:one` (or
 * `E2E_DEV=1` on any run) use the Vite dev server instead, with no build: a server already up on the port is reused, so a
 * warm `npm run dev` makes a run start at once.
 *
 * `E2E_PORT` serves on another port than the default (4173 for the build, 5173 for the dev server), so test runs in two
 * checkouts at once don't reuse each other's server.
 */
const dev = !!process.env.E2E_DEV || /^(test:e2e:dev|test:smoke:dev|e2e:one)$/.test(process.env.npm_lifecycle_event ?? '');
// For the workers (spawned after this runs): the tests of what only the build has (the service worker) skip themselves.
if (dev) process.env.E2E_DEV = '1';
const port = Number(process.env.E2E_PORT ?? (dev ? 5173 : 4173));

/** The size the layout and visual tests (tagged `@layout`, `@visual`) run at, unless they pick their own. */
export const FULL_SIZE = { width: 960, height: 540 };
/**
 * Everything else runs smaller: the software renderer's cost goes with the canvas's pixels, and a test of the rules
 * through the page doesn't need them. The canvas is the screen over a whole-number zoom (§20.1), so smaller isn't always
 * fewer pixels: 640x360 opens at zoom 1 on a 640x360 canvas, more than 960x540's 480x270 at zoom 2. 368 is the least
 * height that opens at zoom 2 (`START_TILES`), on a 328x184 canvas: half the frame time. Tests that set their own
 * viewport (the phone tests) keep it.
 */
export const SMALL_SIZE = { width: 656, height: 368 };
const SIZED = /@layout|@visual/;

export default defineConfig({
    testDir: 'e2e',
    timeout: 30000,
    use: {
        baseURL: `http://localhost:${port}`,
        launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
    },
    projects: [
        { name: 'small', grepInvert: SIZED, use: { viewport: SMALL_SIZE } },
        { name: 'full', grep: SIZED, use: { viewport: FULL_SIZE } }
    ],
    // The baselines are named without the project, as before there were two.
    snapshotPathTemplate: '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-snapshotSuffix}{ext}',
    webServer: dev
        ? { command: `npx vite --port ${port} --strictPort`, url: `http://localhost:${port}`, reuseExistingServer: true, timeout: 60000 }
        : { command: `npm run build && npx vite preview --host --port ${port} --strictPort`, url: `http://localhost:${port}`, reuseExistingServer: true, timeout: 120000 }
});
