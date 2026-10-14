/*
 * The state is plain JSON, and these keep it so: a check that rejects anything JSON would lose or change (undefined,
 * NaN and the infinities, -0, class instances, holes in arrays), a copy that relies on it, and a stable fingerprint
 * that a replay or a reload must reproduce.
 */

function isPlainObject(value: object): boolean {
    const proto = Object.getPrototypeOf(value) as unknown;
    return proto === Object.prototype || proto === null;
}

/** Throws, naming the path, if `value` isn't plain JSON that round-trips exactly. */
export function assertPlainJson(value: unknown, path = '$'): void {
    switch (typeof value) {
        case 'string': case 'boolean': return;
        case 'number':
            if (!Number.isFinite(value)) throw new TypeError(`${path} is ${value}, which JSON can't hold`);
            if (Object.is(value, -0)) throw new TypeError(`${path} is -0, which JSON saves as 0`);
            return;
        case 'object':
            if (value === null) return;
            if (Array.isArray(value)) {
                for (let i = 0; i < value.length; i++) {
                    if (!(i in value)) throw new TypeError(`${path}[${i}] is a hole`);
                    assertPlainJson(value[i], `${path}[${i}]`);
                }
                return;
            }
            if (!isPlainObject(value)) throw new TypeError(`${path} is a ${value.constructor?.name ?? 'non-plain object'}, not plain data`);
            for (const [k, v] of Object.entries(value)) {
                if (k === '__proto__') throw new TypeError(`${path} has a '__proto__' key`);
                assertPlainJson(v, `${path}.${k}`);
            }
            return;
        default:
            throw new TypeError(`${path} is ${typeof value}, which JSON can't hold`);
    }
}

/** A deep copy of plain JSON (faster than a JSON round trip, and needs no host API). */
export function clonePlain<T>(value: T): T {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(clonePlain) as T;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value)) {
        if (k === '__proto__') throw new TypeError("A '__proto__' key can't be copied as data");
        out[k] = clonePlain((value as Record<string, unknown>)[k]);
    }
    return out as T;
}

/** The ids of a record in a fixed order, for iterating it the same way on every engine. */
export function sortedIds(record: Readonly<Record<string, unknown>>): string[] {
    return Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** JSON with every object's keys sorted. Throws on anything `assertPlainJson` rejects. */
export function stableJson(value: unknown): string {
    assertPlainJson(value);
    return stable(value);
}

function stable(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${sortedIds(record).map(k => `${JSON.stringify(k)}:${stable(record[k])}`).join(',')}}`;
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

/** Freezes plain data all the way down (even under an object that is already frozen) and returns it. */
export function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object') {
        for (const v of Object.values(value)) deepFreeze(v);
        Object.freeze(value);
    }
    return value;
}
