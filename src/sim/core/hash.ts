/*
 * A fingerprint of plain JSON data: equal for equal data whatever order its keys were written in. Used to check that a
 * replay or a reload continues exactly as the original did.
 */

/** JSON with every object's keys sorted. */
export function stableJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
}

/** A 64-bit FNV-1a-style hash of the stable JSON, as 16 hex digits (two 32-bit lanes). */
export function hashOf(value: unknown): string {
    const text = stableJson(value);
    let a = 0x811c9dc5, b = 0x050c5d1f;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        a = Math.imul(a ^ c, 0x01000193);
        b = Math.imul(b ^ c, 0x01000193) ^ (a >>> 13);
    }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
