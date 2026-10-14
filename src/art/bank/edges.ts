import { deepen } from '../palette';
import type { PixelBitmap } from '../PixelBitmap';

/** How a figure's silhouette is set off from what is behind it, applied once to the finished drawing. */
export type Edge = (b: PixelBitmap) => void;

/** A ring one pixel outside the figure, all round, each pixel a deepened copy of the one it borders: the bold sel-out. */
export function ring(amount = 0.62, height = 0.15): Edge {
    return b => {
        const edge: [number, number, number][] = [];
        for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
            if (b.opaque(x, y)) continue;
            const neighbours = [[x, y + 1], [x, y - 1], [x - 1, y], [x + 1, y]].filter(([nx, ny]) => b.opaque(nx!, ny!));
            if (!neighbours.length) continue;
            const [nx, ny] = neighbours[0]!;
            edge.push([x, y, deepen(b.color(nx!, ny!), amount)]);
        }
        for (const [x, y, c] of edge) b.set(x, y, c, height);
    };
}

/**
 * The furniture's edge: the figure's own outermost pixels on its sides and bottom take a darker shade of their colour,
 * nothing is added outside it and the top stays open to the light. With `shadeOnly` only the right side (away from the
 * light) and the bottom darken, so the lit side meets the background with no line at all.
 */
export function inner(amount = 0.3, shadeOnly = false): Edge {
    return b => {
        const edge: [number, number][] = [];
        for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) {
            if (!b.opaque(x, y)) continue;
            if ((!shadeOnly && !b.opaque(x - 1, y)) || !b.opaque(x + 1, y) || !b.opaque(x, y + 1)) edge.push([x, y]);
        }
        for (const [x, y] of edge) b.set(x, y, deepen(b.color(x, y), amount), b.heightAt(x, y));
    };
}

/** No edge: the silhouette reads by its values against the floor and its contact shadow alone. */
export const none: Edge = () => {};
