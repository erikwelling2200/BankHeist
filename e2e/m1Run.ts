/**
 * The M1 run (implementation plan M1-16) in the pinned bank, played through `window.sim`'s commands alone by the M1 test
 * in `play.spec.ts`: one string per turn, each move `crew:x,y` (a Move to that tile, along the path the safe floor
 * judged), then End turn. Found by a search over the real rules and recorded; the bank and the rules are deterministic,
 * so it plays the same every time.
 *
 * When a rule change breaks it, `scripts/m1search.test.ts` replays it headlessly with the test's checks, says on which
 * turn it diverges, and searches for the continuation from a turn that changes the fewest turns after it:
 * `M1_FROM=35 npx vitest run --config scripts/vitest.m1search.config.ts` (from PowerShell on Windows; see the script).
 */
const blank = (turns: number): string[] => Array.from({ length: turns }, () => '');

/** Mara and Jun walk in from the van to the lobby (turns 1 and 2); the test then waits to turn 10. */
export const M1_OPENING = ['mara:37,31 jun:36,29 mara:34,28 jun:33,26', 'jun:32,25 jun:34,23 mara:33,25 mara:33,23'];

/**
 * From turn 10: Jun slips through the staff door behind the cleaner (turn 11) and waits at the east end of the corridor
 * by the alarm closet. On turn 35, before the cleaner's view reaches the corridor, he ducks into the side passage at
 * (39,13), then keeps out of sight between it and the corridor's end until the guard's sweep reaches the closet (turn 70).
 */
export const M1_INSIDE = [
    'jun:30,22', 'jun:26,23 jun:25,20', 'jun:23,17 jun:23,12', 'jun:28,12 jun:33,12', 'jun:38,12 jun:42,11', 'jun:43,11', ...blank(19),
    'jun:42,11 jun:39,13', 'jun:40,13', 'jun:39,13', 'jun:40,11', 'jun:43,11', 'jun:40,13', 'jun:40,14', 'jun:40,12',
    'jun:42,11 jun:43,11', 'jun:42,11 jun:40,14', 'jun:40,13 jun:40,14', '',
    ...Array.from({ length: 3 }, () => ['jun:42,11 jun:43,11', '', 'jun:40,13 jun:40,14', '']).flat(),
    'jun:42,11 jun:43,11', 'jun:39,13', ...blank(5), 'jun:41,12 jun:37,12', 'jun:41,12', 'jun:40,11', 'jun:43,11'
];
