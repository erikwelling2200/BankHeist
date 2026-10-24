import { defineConfig } from 'vitest/config';

// The M1 run's search only (scripts/m1search.test.ts): far too slow for `npm test`.
export default defineConfig({ test: { include: ['scripts/m1search.test.ts'], silent: false, printConsoleTrace: false } });
