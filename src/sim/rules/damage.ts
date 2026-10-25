import type { Ctx } from '../core/engine';
import { registerEvents } from '../core/undo';

/*
 * Harm (GAME_DESIGN §11.5, §11.11, §11.12; implementation plan M3-02, decision 96): the one door every attack's damage
 * goes through. A shot's hits (rules/shot.ts `resolveShot` returns them, summed per person), a melee strike's 3 and,
 * later, a charge's blast are each handed to `dealHarm` as one `Harm` per person, after the attack is over (decision
 * 89: nobody falls mid-volley). It emits `harmed`, which the log and playback show, and passes the harm to every
 * registered `HarmHandler` in name order.
 *
 * M3-02 registers none: nobody's hit points change yet. M3-03 (wounds, downed, arrested) registers its handler here
 * (hit points, Hurt, downed, NPC death, the screaming wounded); taser darts and flashbangs are not harm (§11.12
 * "non-lethal"): they knock out or surprise (rules/actions/attack.ts, throwables.ts).
 */

/** What one attack did to one person. */
export interface Harm {
    /** Who was hit: a crew member or an NPC. */
    target: string;
    /** Who dealt it. */
    by: string;
    /** How: a volley of bullets or a blow. */
    cause: 'shot' | 'strike';
    /** The weapon row it came from ('pistol', 'shotgunSlug'), or 'strike'. */
    weapon: string;
    /** Bullets (or blows) that landed. */
    hits: number;
    /** Damage after armour, summed (§11.5). */
    damage: number;
    /** Can kill an NPC at 0 HP (§11.12): every bullet and blow; false for what only stuns. */
    lethal: boolean;
}

declare module '../core/types' {
    interface EventMap {
        /** Someone took damage from an attack (rules/damage.ts); what it does to them is M3-03's. */
        harmed: Harm;
    }
}

export type HarmHandler = (ctx: Ctx, harm: Readonly<Harm>) => void;

const HANDLERS = new Map<string, HarmHandler>();

/** Adds what follows from harm (M3-03's wounds). Handlers run by name. */
export function registerHarmHandler(name: string, handler: HarmHandler, options: { replace?: boolean } = {}): void {
    if (HANDLERS.has(name) && !options.replace) throw new Error(`Harm handler '${name}' already exists; pass replace: true to change it`);
    HANDLERS.set(name, handler);
}

/** The harm handlers' names, in the order they run. */
export const harmHandlers = (): string[] => [...HANDLERS.keys()].sort();

/** Deals one person's harm from an attack: the event, then each handler. Harm of 0 damage is still told (armour stopped it). */
export function dealHarm(ctx: Ctx, harm: Harm): void {
    ctx.emit({ type: 'harmed', ...harm });
    for (const name of harmHandlers()) HANDLERS.get(name)!(ctx, harm);
}

registerEvents({ harmed: { undoBlocking: true } });
