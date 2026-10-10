/**
 * Builds an RGBA normal map from a height field using a Sobel filter.
 * Pixels outside the field count as height 0, so sprites get a bevel along their silhouette.
 */
export function buildNormalMap(heights: Float32Array, width: number, height: number, strength = 2): Uint8ClampedArray {
    const out = new Uint8ClampedArray(width * height * 4);
    const h = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : heights[y * width + x]!);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x - 1, y) + h(x - 1, y + 1));
            const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1)) - (h(x - 1, y - 1) + 2 * h(x, y - 1) + h(x + 1, y - 1));
            let nx = -dx * strength;
            let ny = -dy * strength;
            let nz = 1;
            const len = Math.hypot(nx, ny, nz);
            nx /= len; ny /= len; nz /= len;
            const i = (y * width + x) * 4;
            out[i] = Math.round((nx * 0.5 + 0.5) * 255);
            // Normal maps for WebGL use +Y up, while the height field is stored with +Y down.
            out[i + 1] = Math.round((-ny * 0.5 + 0.5) * 255);
            out[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
            out[i + 3] = 255;
        }
    }
    return out;
}
