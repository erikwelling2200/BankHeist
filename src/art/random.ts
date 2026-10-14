/** Deterministic PRNG so generated art is identical on every load. */
export function mulberry32(seed: number): () => number {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Smooth, tileable 2D value noise over a `cells` x `cells` lattice; inputs in [0, 1) wrap. */
export function valueNoise(rand: () => number, cells: number): (u: number, v: number) => number {
    const lattice = Array.from({ length: cells * cells }, rand);
    const at = (x: number, y: number) => lattice[((y % cells) * cells) + (x % cells)]!;
    const smooth = (t: number) => t * t * (3 - 2 * t);
    return (u, v) => {
        const x = u * cells, y = v * cells;
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const tx = smooth(x - x0), ty = smooth(y - y0);
        const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
        const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
        return top * (1 - ty) + bottom * ty;
    };
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** 4x4 Bayer threshold in [0, 1), for dithering only where two bands meet. */
export function bayer4(x: number, y: number): number {
    return BAYER4[(y & 3) * 4 + (x & 3)]! / 16;
}
