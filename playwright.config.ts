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

export default defineConfig({
    testDir: 'e2e',
    timeout: 30000,
    use: {
        baseURL: `http://localhost:${port}`,
        viewport: { width: 960, height: 540 },
        launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
    },
    webServer: dev
        ? { command: `npx vite --port ${port} --strictPort`, url: `http://localhost:${port}`, reuseExistingServer: true, timeout: 60000 }
        : { command: `npm run build && npx vite preview --host --port ${port} --strictPort`, url: `http://localhost:${port}`, reuseExistingServer: true, timeout: 120000 }
});
