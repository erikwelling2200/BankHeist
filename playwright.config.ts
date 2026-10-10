import { defineConfig } from '@playwright/test';

// Runs against the production build so the e2e test also proves the build works.
export default defineConfig({
    testDir: 'e2e',
    timeout: 30000,
    use: {
        baseURL: 'http://localhost:4173',
        viewport: { width: 960, height: 540 },
        launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
    },
    webServer: { command: 'npm run build && npm run preview', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 120000 }
});
