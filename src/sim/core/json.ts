/*
 * The state is plain JSON, and these keep it so: a check that rejects anything JSON would lose or change (undefined,
 * NaN and the infinities, -0, class instances, holes in arrays, keys `Object.prototype` already has), a copy that
 * relies on it, and a stable fingerprint that a replay or a reload must reproduce.
 */

function isPlainObject(value: object): boolean {
    const proto = Object.getPrototypeOf(value) as unknown;
    return proto === Object.prototype || proto === null;
}

/**
 * Keys a record may not have: anything `Object.prototype` has ('constructor', 'toString', '__proto__', …), which a
 * plain `record[id]` read would find on the prototype even when the record doesn't hold it.
 */
const RESERVED = new Set(Object.getOwnPropertyNames(Object.prototype));

export const isReservedKey = (key: string): boolean => RESERVED.has(key);

/**
 * Checks the engine runs only in development and tests (previews, frozen undo snapshots): turned on by the test
 * helpers, off in a release build, where `commit` still checks every state it makes.
 */
let devChecks = false;

export function setDevChecks(on: boolean): void {
    devChecks = on;
}

export const devChecksOn = (): boolean => devChecks;

/** Whether `value` is plain JSON that round-trips exactly. A tight walk with no allocation: commit runs it every action. */
export function isPlainJson(value: unknown): boolean {
    switch (typeof value) {
        case 'string': case 'boolean': return true;
        case 'number': return Number.isFinite(value) && !Object.is(value, -0);
        case 'object': {
            if (value === null) return true;
            if (Array.isArray(value)) {
                for (let i = 0; i < value.length; i++) if (!(i in value) || !isPlainJson(value[i])) return false;
                return true;
            }
            if (!isPlainObject(value)) return false;
            const record = value as Record<string, unknown>;
            for (const k in record) if (RESERVED.has(k) || !isPlainJson(record[k])) return false;
            return true;
        }
        default: return false;
    }
}

/** Throws, naming the path, if `value` isn't plain JSON that round-trips exactly. */
export function assertPlainJson(value: unknown, path = '$'): void {
    if (!isPlainJson(value)) throw new TypeError(explain(value, path) ?? `${path} isn't plain JSON`);
}

/** Why a value isn't plain JSON, and where: the slow walk, only run once the fast one has failed. */
function explain(value: unknown, path: string): string | undefined {
    switch (typeof value) {
        case 'string': case 'boolean': return undefined;
        case 'number':
            if (!Number.isFinite(value)) return `${path} is ${value}, which JSON can't hold`;
            if (Object.is(value, -0)) return `${path} is -0, which JSON saves as 0`;
            return undefined;
        case 'object': {
            if (value === null) return undefined;
            if (Array.isArray(value)) {
                for (let i = 0; i < value.length; i++) {
                    const why = i in value ? explain(value[i], `${path}[${i}]`) : `${path}[${i}] is a hole`;
                    if (why) return why;
                }
                return undefined;
            }
            if (!isPlainObject(value)) return `${path} is a ${value.constructor?.name ?? 'non-plain object'}, not plain data`;
            const record = value as Record<string, unknown>;
            for (const k in record) {
                const why = RESERVED.has(k) ? `${path} has the reserved key '${k}'` : explain(record[k], `${path}.${k}`);
                if (why) return why;
            }
            return undefined;
        }
        default: return `${path} is ${typeof value}, which JSON can't hold`;
    }
}

/** Whether two plain JSON values are equal (key order aside). */
export function samePlain(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!samePlain(a[i], b[i])) return false;
        return true;
    }
    if (Array.isArray(b)) return false;
    const ra = a as Record<string, unknown>, rb = b as Record<string, unknown>;
    let n = 0;
    for (const k in ra) {
        if (!Object.hasOwn(rb, k) || !samePlain(ra[k], rb[k])) return false;
        n++;
    }
    for (const k in rb) if (--n < 0 || !Object.hasOwn(ra, k)) return false;
    return n === 0;
}

/** A deep copy of plain JSON (faster than a JSON round trip, and needs no host API). */
export function clonePlain<T>(value: T): T {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        const out = new Array<unknown>(value.length);
        for (let i = 0; i < value.length; i++) out[i] = clonePlain(value[i]);
        return out as T;
    }
    const record = value as Record<string, unknown>, out: Record<string, unknown> = {};
    for (const k in record) {
        if (k === '__proto__') throw new TypeError("A '__proto__' key can't be copied as data");
        out[k] = clonePlain(record[k]);
    }
    return out as T;
}

/** The ids of a record in a fixed order, for iterating it the same way on every engine. */
export function sortedIds(record: object): string[] {
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
