/**
 * The generator's randomness: deterministic from a seed, so a bank can be replayed and shared (§17.2). Each stage forks
 * its own stream by name, so adding a roll to one stage doesn't reshuffle every stage after it.
 */
export class Rng {
    private state: number;

    constructor(seed: number) {
        this.state = seed >>> 0;
    }

    /** A float in [0, 1). */
    next(): number {
        this.state = (this.state + 0x6d2b79f5) | 0;
        let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** An integer in [min, max], both included. */
    int(min: number, max: number): number {
        if (max < min) throw new Error(`Empty range ${min}..${max}`);
        return min + Math.floor(this.next() * (max - min + 1));
    }

    chance(p: number): boolean {
        return this.next() < p;
    }

    pick<T>(items: readonly T[]): T {
        if (!items.length) throw new Error('Nothing to pick from');
        return items[Math.floor(this.next() * items.length)]!;
    }

    /** Picks by weight; weights need not sum to 1. */
    weighted<T>(items: readonly (readonly [T, number])[]): T {
        const total = items.reduce((sum, [, w]) => sum + w, 0);
        if (total <= 0) throw new Error('Nothing to pick from');
        let roll = this.next() * total;
        for (const [item, w] of items) if ((roll -= w) < 0) return item;
        return items.at(-1)![0];
    }

    shuffle<T>(items: readonly T[]): T[] {
        const out = [...items];
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [out[i], out[j]] = [out[j]!, out[i]!];
        }
        return out;
    }

    /** An independent stream for one stage, from this one's seed and the stage's name. */
    fork(label: string): Rng {
        let h = this.state ^ 0x9e3779b9;
        for (const c of label) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
        return new Rng(h >>> 0);
    }
}

/** A seed from text: digits are taken as they are, anything else is hashed. */
export function seedOf(text: string): number {
    if (/^\d+$/.test(text)) return Number(text) >>> 0;
    let h = 0x811c9dc5;
    for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
    return h >>> 0;
}
