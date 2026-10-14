import { defineConfig } from 'vitest/config';

// `npm run sweep` only: generating hundreds of banks is too slow for `npm test`.
export default defineConfig({ test: { include: ['scripts/sweep.test.ts'], silent: false, printConsoleTrace: false } });
