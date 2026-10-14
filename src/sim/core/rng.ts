import type { State } from './types';

/*
 * The heist's dice. Every random thing rolls on a named stream ('combat', 'panic', 'resist', …) whose position lives in
 * `State.rng`, so a saved heist continues with exactly the rolls it would have had, and adding a roll to one system
 * doesn't reshuffle the others (the generator's streams work the same way, `src/gen/rng.ts`). A stream starts the first
 * time it is rolled, from the heist's seed and its name.
 *
 * Previews never roll (§6.6, §8.8: a preview is the outcome, and the outcome may not depend on luck the preview hid).
 * A preview's dice throw instead; a system whose result depends on a roll shows its odds without rolling.
 */

export type Mode = 'commit' | 'preview';

export class PreviewRollError extends Error {
    constructor(stream: string, reason: string) {
        super(`A preview rolled the dice ('${stream}': ${reason}); previews must not depend on luck`);
        this.name = 'PreviewRollError';
    }
}

/** A stream's first position: its name hashed into the seed (FNV-1a). */
function streamSeed(seed: number, name: string): number {
    let h = (0x811c9dc5 ^ seed) >>> 0;
    for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
    return h >>> 0;
}

/** The dice of one command, on the copy of the state that command is making. */
export class Dice {
    private count = 0;

    constructor(private readonly state: State, readonly mode: Mode) {}

    /** How many times this command rolled. */
    get rolls(): number {
        return this.count;
    }

    /** A float in [0, 1) from the named stream (mulberry32, as `src/gen/rng.ts`). Logged in `State.dice`. */
    next(stream: string, reason: string): number {
        return this.log(stream, reason, this.draw(stream, reason));
    }

    /** An integer in [min, max], both included. */
    int(stream: string, min: number, max: number, reason: string): number {
        if (max < min) throw new Error(`Empty range ${min}..${max}`);
        return this.log(stream, reason, min + Math.floor(this.draw(stream, reason) * (max - min + 1)));
    }

    /** True with probability `p`. Logged as 1 or 0. */
    chance(stream: string, p: number, reason: string): boolean {
        return this.log(stream, reason, this.draw(stream, reason) < p ? 1 : 0) === 1;
    }

    private draw(stream: string, reason: string): number {
        if (this.mode === 'preview') throw new PreviewRollError(stream, reason);
        const s = ((this.state.rng[stream] ?? streamSeed(this.state.seed, stream)) + 0x6d2b79f5) | 0;
        this.state.rng[stream] = s >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    private log(stream: string, reason: string, value: number): number {
        this.count++;
        this.state.dice.push({ turn: this.state.turn, stream, reason, value });
        return value;
    }
}
