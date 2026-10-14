import { defineConfig } from '@playwright/test';

// `E2E_PORT` serves the build on another port, so test runs in two checkouts at once don't reuse each other's server.
const port = Number(process.env.E2E_PORT ?? 4173);

// Runs against the production build so the e2e test also proves the build works.
export default defineConfig({
    testDir: 'e2e',
    timeout: 30000,
    use: {
        baseURL: `http://localhost:${port}`,
        viewport: { width: 960, height: 540 },
        launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
    },
    webServer: { command: `npm run build && npx vite preview --host --port ${port} --strictPort`, url: `http://localhost:${port}`, reuseExistingServer: true, timeout: 120000 }
});
