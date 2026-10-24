/*
 * The world UI's glyphs (UI.md "Visual language", "Over heads"), as pixel grids drawn at the UI layer's resolution (one
 * UI pixel is half an art pixel). The same grids as the mockups (scripts/ui-mockups/ui2.py): each is drawn in one
 * signal colour with a 1px ink shadow down-right, never as a white-on-colour sticker. Every state has its own shape, so
 * none is told by colour alone.
 */

export const GLYPHS = {
    eye: ['....xxxxx....', '..xx.....xx..', '.x...xxx...x.', 'x...xxxxx...x', '.x...xxx...x.', '..xx.....xx..', '....xxxxx....'],
    hand: ['....x.....', '..x.x.x...', '..x.x.x.x.', '..x.x.x.x.', '..x.x.x.x.', 'x.xxxxxxx.', 'xxxxxxxxx.', '.xxxxxxxx.', '.xxxxxxx..', '..xxxxxx..', '...xxxx...'],
    q: ['.xxxx.', 'x....x', '.....x', '....x.', '...x..', '..x...', '......', '..x...'],
    bang: ['xx', 'xx', 'xx', 'xx', 'xx', '..', 'xx'],
    bell: ['.....x.....', '....xxx....', '...x...x...', '..x.....x..', '..x.....x..', '..x.....x..', '.x.......x.', 'xxxxxxxxxxx', '.....x.....'],
    radio: ['x.......', 'x.......', 'xxxxxxx.', 'x.....x.', 'x.xxx.x.', 'x.....x.', 'x.xxx.x.', 'x.....x.', 'x.x.x.x.', 'xxxxxxx.'],
    run: ['.......xx.', '.......xx.', '....xxxx..', '...x.xxx.x', '..x..xxxx.', '.....xx...', '....x..x..', '...x....x.', '..x.....x.', '.x.......x'],
    phone: ['xxx.......', 'xxxx......', '.xxx......', '..xx......', '..xx......', '...xx.....', '....xx..xx', '.....xxxxx', '......xxxx'],
    drops: ['..x.....x..', '..x.....x..', '.xxx...xxx.', 'xxxxx.xxxxx', 'xxxxx.xxxxx', '.xxx...xxx.'],
    down: ['x.......x', '.x.....x.', '..x...x..', '...x.x...', '....x....', '.........', 'xxxxxxxxx'],
    knot: ['.xxx...xxx.', 'x...x.x...x', 'x...xxx...x', 'x...x.x...x', '.xxx...xxx.'],
    cross: ['....x....', '..xxxxx..', '.x..x..x.', '.x.....x.', 'xxx...xxx', '.x.....x.', '.x..x..x.', '..xxxxx..', '....x....'],
    star: ['....x....', '.x..x..x.', '..x.x.x..', '...x.x...', 'xxx...xxx', '...x.x...', '..x.x.x..', '.x..x..x.', '....x....'],
    speaker: ['...x...', '..xx...', 'xxxx.x.', 'xxxx..x', 'xxxx.x.', '..xx...', '...x...'],
    pin: ['.xxx.', 'x...x', 'x...x', '.x.x.', '..x..'],
    camera: ['xxxxxxxx....', 'x......xxx..', 'x......x.x..', 'xxxxxxxxxx..', '...x........', '.xxxxx......'],
    /** A pistol, side on (UI.md "Over heads": draws is a hand on a gun). */
    gun: ['xxxxxxxx', 'xxxxxxxx', 'xxx.x...', 'xx..x...', 'xx......', 'xx......']
} as const satisfies Record<string, readonly string[]>;

export type GlyphName = keyof typeof GLYPHS;

export const DIGITS: Readonly<Record<string, readonly string[]>> = {
    '0': ['.xxx.', 'x...x', 'x..xx', 'x.x.x', 'xx..x', 'x...x', 'x...x', '.xxx.'], '1': ['..x..', '.xx..', 'x.x..', '..x..', '..x..', '..x..', '..x..', 'xxxxx'],
    '2': ['.xxx.', 'x...x', '....x', '...x.', '..x..', '.x...', 'x....', 'xxxxx'], '3': ['xxxx.', '....x', '....x', '.xxx.', '....x', '....x', '....x', 'xxxx.'],
    '4': ['...x.', '..xx.', '.x.x.', 'x..x.', 'xxxxx', '...x.', '...x.', '...x.'], '5': ['xxxxx', 'x....', 'xxxx.', '....x', '....x', '....x', 'x...x', '.xxx.'],
    '6': ['..xx.', '.x...', 'x....', 'xxxx.', 'x...x', 'x...x', 'x...x', '.xxx.'], '7': ['xxxxx', '....x', '...x.', '...x.', '..x..', '..x..', '.x...', '.x...'],
    '8': ['.xxx.', 'x...x', 'x...x', '.xxx.', 'x...x', 'x...x', 'x...x', '.xxx.'], '9': ['.xxx.', 'x...x', 'x...x', 'x...x', '.xxxx', '....x', '...x.', '.xx..'],
    '!': ['x', 'x', 'x', 'x', 'x', '.', '.', 'x'], '?': ['.xxx.', 'x...x', '....x', '...x.', '..x..', '.....', '.....', '..x..'],
    '%': ['xx...', 'xx..x', '...x.', '..x..', '.x...', 'x..xx', '...xx', '.....']
};

/** The ink of the drop shadows and plates (UI.md: near-black, not pure black). */
export const UI_INK = 'rgba(8, 7, 10, 0.8)';

/** Draws pixel rows at (x, y) in `colour`, with a 1px ink shadow down-right unless `shadow` is false. */
export function drawRows(ctx: CanvasRenderingContext2D, rows: readonly string[], x: number, y: number, colour: string, shadow = true): void {
    const pass = (dx: number, dy: number, fill: string) => {
        ctx.fillStyle = fill;
        rows.forEach((row, j) => {
            for (let i = 0; i < row.length; i++) if (row[i] === 'x') ctx.fillRect(x + i + dx, y + j + dy, 1, 1);
        });
    };
    if (shadow) pass(1, 1, UI_INK);
    pass(0, 0, colour);
}

export const glyphSize = (rows: readonly string[]): { w: number; h: number } => ({ w: rows[0]!.length, h: rows.length });

/** Draws a number (or `!`/`?`) in the digit font; returns its width. */
export function drawNumber(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string, shadow = false): number {
    let at = x;
    for (const ch of text) {
        const rows = DIGITS[ch] ?? DIGITS['?']!;
        drawRows(ctx, rows, at, y, colour, shadow);
        at += rows[0]!.length + 1;
    }
    return at - x - 1;
}

export const numberWidth = (text: string): number => [...text].reduce((w, ch) => w + (DIGITS[ch] ?? DIGITS['?']!)[0]!.length + 1, 0) - 1;
