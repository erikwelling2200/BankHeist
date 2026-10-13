/*
 * Camera zoom (§20, §20.1): the player zooms between a close view about 11 tiles high and a wide one about 34 tiles
 * high, in steps that keep the pixel art crisp: each art pixel covers a whole number of screen pixels. So the zoom
 * levels are whole numbers, and which of them fall in that range depends on how many pixels tall the screen is.
 */

export const CLOSE_TILES = 11;
export const WIDE_TILES = 34;

/** The whole-number zooms that show between `CLOSE_TILES` and `WIDE_TILES` tiles of height, widest first. */
export function zoomSteps(screenHeight: number, tile: number): number[] {
    const close = Math.max(1, Math.floor(screenHeight / (tile * CLOSE_TILES)));
    const wide = Math.max(1, Math.min(close, Math.ceil(screenHeight / (tile * WIDE_TILES))));
    return Array.from({ length: close - wide + 1 }, (_, i) => wide + i);
}

/** The step showing closest to `tiles` tiles of height. */
export function nearestStep(steps: readonly number[], screenHeight: number, tile: number, tiles: number): number {
    if (!steps.length) throw new Error('No zoom steps to choose from');
    return steps.reduce((best, z) => (Math.abs(screenHeight / (tile * z) - tiles) < Math.abs(screenHeight / (tile * best) - tiles) ? z : best));
}

/** The tactical map's zoom: the largest whole number that fits the whole plot on screen, at least 1. */
export function mapZoom(screenWidth: number, screenHeight: number, plotWidth: number, plotHeight: number): number {
    return Math.max(1, Math.floor(Math.min(screenWidth / plotWidth, screenHeight / plotHeight)));
}

