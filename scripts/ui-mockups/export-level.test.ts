import { writeFileSync } from 'fs';
import { test } from 'vitest';
import { exampleBank } from '../../src/level/bankData';
import { propBox } from '../../src/level/catalog';

// Writes the example bank as the mockup rules read it: floor tiles as rows of plan characters, walls on tile edges,
// rooms with their zones, and every prop's box in map pixels (x, y the north-west corner of its footprint, w across,
// d deep, h tall, z its elevation). Run: npx vitest run --config scripts/ui-mockups/vitest.export.config.ts
test('export the example bank', () => {
    const bank = exampleBank(), { level } = bank;
    const props = bank.props.map(p => ({ ...p, ...propBox(p, level.walls) }));
    const out = { tiles: level.tiles.map(row => row.join('')), walls: level.walls, rooms: bank.rooms, props, people: bank.people };
    writeFileSync(process.env.LEVEL_OUT ?? 'scripts/ui-mockups/level.json', JSON.stringify(out));
});
