import { defineConfig } from 'vitest/config';

// The UI mockups only: writes the example bank's level, rooms and prop boxes as JSON for the Python rules.
export default defineConfig({ test: { include: ['scripts/ui-mockups/export-level.test.ts'], silent: false } });
