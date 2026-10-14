/*
 * Where the Session autosaves (§20.6). The Session only ever talks to this small interface, so the game uses the
 * browser's localStorage and the tests an in-memory fake that counts writes.
 */

export interface SaveStorage {
    get(key: string): string | null;
    /** Throws if the value can't be stored (a full quota); the Session reports that instead of crashing the turn. */
    set(key: string, value: string): void;
    remove(key: string): void;
    /** Every key this storage holds (only those under its prefix, for a shared store). */
    keys(): string[];
}

/** An in-memory storage that remembers how often each key was written. */
export class MemoryStorage implements SaveStorage {
    readonly data = new Map<string, string>();
    readonly writes = new Map<string, number>();

    get(key: string): string | null {
        return this.data.get(key) ?? null;
    }

    set(key: string, value: string): void {
        this.data.set(key, value);
        this.writes.set(key, (this.writes.get(key) ?? 0) + 1);
    }

    remove(key: string): void {
        this.data.delete(key);
    }

    keys(): string[] {
        return [...this.data.keys()];
    }

    /** How many times `key` was written. */
    writesOf(key: string): number {
        return this.writes.get(key) ?? 0;
    }
}

/**
 * A storage over a Web Storage (localStorage by default), with every key under `prefix` so the game's saves never
 * collide with anything else on the origin. Returns null where there is no Web Storage, or it can't be used (some
 * private windows throw on first access).
 */
export function webStorage(prefix = 'bankheist:', store?: Storage): SaveStorage | null {
    let backing: Storage;
    try {
        backing = store ?? globalThis.localStorage;
        if (!backing) return null;
        backing.getItem(`${prefix}probe`);
    } catch {
        return null;
    }
    return {
        get: key => backing.getItem(prefix + key),
        set: (key, value) => backing.setItem(prefix + key, value),
        remove: key => backing.removeItem(prefix + key),
        keys: () => {
            const out: string[] = [];
            for (let i = 0; i < backing.length; i++) {
                const key = backing.key(i);
                if (key?.startsWith(prefix)) out.push(key.slice(prefix.length));
            }
            return out;
        }
    };
}
