/*
 * Camera zoom (§20, §20.1): the player zooms between a close view about 11 tiles high and a wide one about 34 tiles
 * high, in steps that keep the pixel art crisp: each art pixel covers a whole number of screen pixels. So the zoom
 * levels are whole numbers, and which of them fall in that range depends on how many pixels tall the screen is. Only
 * the tactical map may go below 1 (`mapZoom`).
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

/**
 * The tactical map's zoom: the largest whole number that fits the whole plot in a `width` by `height` area, or, when
 * not even 1 fits, the fraction that does. Seeing the whole plot matters more on the overview than crisp pixels, so
 * there the browser scales the canvas down.
 */
export function mapZoom(width: number, height: number, plotWidth: number, plotHeight: number): number {
    const fit = Math.min(width / plotWidth, height / plotHeight);
    if (!(fit > 0)) throw new Error(`No room to show a ${plotWidth}x${plotHeight} plot in ${width}x${height}`);
    return fit >= 1 ? Math.floor(fit) : fit;
}
