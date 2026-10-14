/*
 * A set of tiles as a short string, for the state (implementation plan §5: big per-tile data is stored compactly,
 * since the state is copied on every command). Six tiles per character, in the base64 alphabet (no character JSON has
 * to escape): character i holds tiles 6i to 6i + 5, the lowest bit first. Decoding is cached by string, so asking the
 * same set again costs a lookup; the arrays it returns are shared and must not be changed (copy them with `slice`).
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const VALUE = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) VALUE[ALPHABET.charCodeAt(i)] = i;

/** Encodes one byte per tile (non-zero: in the set) as the string. */
export function encodeBits(bits: Uint8Array): string {
    const chars: string[] = [];
    for (let i = 0; i < bits.length; i += 6) {
        let v = 0;
        for (let j = 0; j < 6 && i + j < bits.length; j++) if (bits[i + j]) v |= 1 << j;
        chars.push(ALPHABET[v]!);
    }
    return chars.join('');
}

const CACHE = new Map<string, Uint8Array>();
const KEEP = 16;

/** Decodes a string of `length` tiles: one byte per tile, 1 in the set. Shared: don't change it. */
export function decodeBits(text: string, length: number): Uint8Array {
    const key = `${length}:${text}`, hit = CACHE.get(key);
    if (hit) return hit;
    if (text.length !== Math.ceil(length / 6)) throw new Error(`A set of ${length} tiles is ${Math.ceil(length / 6)} characters, not ${text.length}`);
    const bits = new Uint8Array(length);
    for (let c = 0; c < text.length; c++) {
        const v = VALUE[text.charCodeAt(c)] ?? -1;
        if (v < 0) throw new Error(`'${text[c]}' isn't a tile-set character`);
        for (let j = 0; j < 6; j++) {
            const i = c * 6 + j;
            if (i < length && v & (1 << j)) bits[i] = 1;
        }
    }
    if (CACHE.size >= KEEP) CACHE.delete(CACHE.keys().next().value!);
    CACHE.set(key, bits);
    return bits;
}

/** How many tiles are in the set. */
export function bitsCount(bits: Uint8Array): number {
    let n = 0;
    for (let i = 0; i < bits.length; i++) if (bits[i]) n++;
    return n;
}
