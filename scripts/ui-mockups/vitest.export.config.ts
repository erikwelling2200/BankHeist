import { defineConfig } from 'vitest/config';

// The UI mockups only: writes the example bank's level, rooms and prop boxes as JSON for the Python rules, and (with
// SPRITES set) unlit sprites for hibit.py.
export default defineConfig({ test: { include: ['scripts/ui-mockups/export-*.test.ts'], silent: false } });
