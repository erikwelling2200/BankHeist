import type { DiceRoll, State } from './types';

/*
 * The heist's dice. Every random thing rolls on a named stream ('combat', 'panic', 'resist', …) whose position lives in
 * `State.rng`, so a saved heist continues with exactly the rolls it would have had, and adding a roll to one system
 * doesn't reshuffle the others (the generator's streams work the same way, `src/gen/rng.ts`). A stream starts the first
 * time it is rolled, from the heist's seed and its name.
 *
 * Previews never roll (§6.6, §8.8: a preview is the outcome, and the outcome may not depend on luck the preview hid).
 * Two ways to meet a roll in a preview:
 * - `odds` declares a roll whose chance the player sees ("62% to resist"): the preview stops there cleanly and returns
 *   the events so far with the pending odds; the commit rolls.
 * - `next`, `int` and `chance` throw `PreviewRollError`: a preview that reaches one is a bug. The dice remember the
 *   refusal, so a reducer that catches the error can't make the preview carry on and quietly differ from the commit.
 */

export type Mode = 'commit' | 'preview';

/** How many recent rolls `State.dice` keeps. */
export const DICE_WINDOW = 32;

export class PreviewRollError extends Error {
    constructor(stream: string, reason: string) {
        super(`A preview rolled the dice ('${stream}': ${reason}); previews must not depend on luck`);
        this.name = 'PreviewRollError';
    }
}

/** A roll a preview stopped at: the chance of success the player is shown. */
export interface PendingOdds { stream: string; p: number; reason: string }

/** Thrown by `odds` in a preview to stop the reducer; `preview` catches it. Reducers must let it through. */
export class OddsStop extends Error {
    constructor(readonly odds: PendingOdds) {
        super(`A preview stopped at a roll ('${odds.stream}': ${odds.reason}, p = ${odds.p})`);
        this.name = 'OddsStop';
    }
}

/** A stream's first position: its name hashed into the seed (FNV-1a over code points). */
function streamSeed(seed: number, name: string): number {
    let h = (0x811c9dc5 ^ seed) >>> 0;
    for (const c of name) h = Math.imul(h ^ c.codePointAt(0)!, 0x01000193);
    return h >>> 0;
}

/** The dice of one command, on the copy of the state that command is making. */
export class Dice {
    /** The roll a preview refused, if any; the engine throws it even if a reducer caught it. */
    refused: PreviewRollError | undefined;
    /** The roll a preview stopped at, if any, and the stop that was thrown for it. */
    pending: PendingOdds | undefined;
    stop: OddsStop | undefined;
    /** This command's rolls, all of them (`State.dice` keeps only a window). */
    readonly rolled: DiceRoll[] = [];

    constructor(private readonly state: State, private readonly mode: Mode) {}

    /** A float in [0, 1) from the named stream (mulberry32, as `src/gen/rng.ts`). */
    next(stream: string, reason: string): number {
        return this.log(stream, reason, this.draw(stream, reason));
    }

    /** An integer in [min, max], both included. Logs the integer. */
    int(stream: string, min: number, max: number, reason: string): number {
        if (max < min) throw new Error(`Empty range ${min}..${max}`);
        return this.log(stream, reason, min + Math.floor(this.draw(stream, reason) * (max - min + 1)));
    }

    /** True with probability `p`. Logs the raw draw. */
    chance(stream: string, p: number, reason: string): boolean {
        return this.log(stream, reason, this.draw(stream, reason)) < p;
    }

    /**
     * A roll whose odds a preview shows: in a preview it stops the reducer there; in a commit it is `chance`. A preview
     * stops once: reaching a second roll means the reducer caught the first stop, and is refused like any roll.
     */
    odds(stream: string, p: number, reason: string): boolean {
        if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error(`Odds of ${p} for '${reason}': a chance is between 0 and 1`);
        if (this.mode === 'preview') {
            if (this.stop) throw (this.refused ??= new PreviewRollError(stream, reason));
            this.pending = { stream, p, reason };
            throw (this.stop = new OddsStop(this.pending));
        }
        return this.chance(stream, p, reason);
    }

    private draw(stream: string, reason: string): number {
        if (this.mode === 'preview') throw (this.refused ??= new PreviewRollError(stream, reason));
        const s = ((this.state.rng[stream] ?? streamSeed(this.state.seed, stream)) + 0x6d2b79f5) | 0;
        this.state.rng[stream] = s >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    private log(stream: string, reason: string, value: number): number {
        const roll = { turn: this.state.turn, stream, reason, value }, dice = this.state.dice;
        this.rolled.push(roll);
        dice.push({ ...roll });
        if (dice.length > DICE_WINDOW) dice.splice(0, dice.length - DICE_WINDOW);
        return value;
    }
}
