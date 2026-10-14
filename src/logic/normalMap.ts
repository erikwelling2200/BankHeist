/**
 * Builds an RGBA normal map from a height field using a Sobel filter.
 * Pixels outside the field count as height 0, so sprites get a bevel along their silhouette.
 */
export function buildNormalMap(heights: Float32Array, width: number, height: number, strength = 2): Uint8ClampedArray {
    const out = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) sobelNormal(heights, width, height, x, y, out, (y * width + x) * 4, strength);
    return out;
}

/** Writes the normal at (x, y) of the height field into `out` at `at`, as `buildNormalMap` does for every pixel. */
export function sobelNormal(heights: Float32Array, width: number, height: number, x: number, y: number, out: Uint8ClampedArray, at: number, strength = 2): void {
    let dx: number, dy: number;
    if (x > 0 && y > 0 && x < width - 1 && y < height - 1) {
        // Inside the edge every neighbour is on the field: read them straight, as whole bitmaps of floor go through here.
        const up = (y - 1) * width + x, mid = up + width, down = mid + width;
        dx = (heights[up + 1]! + 2 * heights[mid + 1]! + heights[down + 1]!) - (heights[up - 1]! + 2 * heights[mid - 1]! + heights[down - 1]!);
        dy = (heights[down - 1]! + 2 * heights[down]! + heights[down + 1]!) - (heights[up - 1]! + 2 * heights[up]! + heights[up + 1]!);
    } else {
        const h = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : heights[y * width + x]!);
        dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x - 1, y) + h(x - 1, y + 1));
        dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x, y - 1) + h(x + 1, y - 1));
    }
    out[at + 3] = 255;
    if (dx === 0 && dy === 0) {
        // Flat: straight out of the screen, what the general case below works out to.
        out[at] = 128;
        out[at + 1] = 128;
        out[at + 2] = 255;
        return;
    }
    let nx = -dx * strength;
    let ny = -dy * strength;
    let nz = 1;
    const len = Math.hypot(nx, ny, nz);
    nx /= len; ny /= len; nz /= len;
    out[at] = Math.round((nx * 0.5 + 0.5) * 255);
    // Normal maps for WebGL use +Y up, while the height field is stored with +Y down.
    out[at + 1] = Math.round((-ny * 0.5 + 0.5) * 255);
    out[at + 2] = Math.round((nz * 0.5 + 0.5) * 255);
}
