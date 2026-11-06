import { registerWorldHook, type Ctx } from '../core/engine';
import { powerOn } from '../core/power';
import type { DeepReadonly, ReadonlyWorld, State } from '../core/types';
import { registerStateCheck } from '../core/save';
import { registerEvents } from '../core/undo';
import { registerInteraction } from './actions/interact';
import { registerEvidenceSource } from './evidence';

/*
 * The power grid (GAME_DESIGN §8.13, §14.6; implementation plan M4-03, decisions 240–246). Its state and what reads it
 * (sight, cameras, maglocks) are core/power.ts; this is how it changes.
 *
 * - **The breaker** (`interact … cut` at the `breakerPanel`, 1 action, the illegal act 'hack'): the mains go off. The
 *   generator then starts by itself as the crew phase `rules.generatorPhases` (3) turns on begins (`power.generator`, a
 *   crew-phase hook), so the dark lasts three world phases; `interact … reset` (1 action) turns the mains back on, and a
 *   running generator stands by again.
 * - **The generator** (`interact … disable` at the `generator`, 1 action, 'hack'): disabled for good. Before a cut, the
 *   next cut lasts; while it runs, the lights go out again. A bank without one has no backup.
 * - **What the dark does** (core/power.ts): the building's tiles are unlit (sight halved, §8.3), every camera is off,
 *   staff doors' maglocks release, and the vault console is dark (rules/keys.ts `vaultShut`). The alarm panel keeps its
 *   battery.
 * - **Lights out** is minor evidence bank-wide (`lightsOut`, `Evidence.everywhere`): every staff member and guard in
 *   the building notices it in the next world phase, seen or not, and one (a guard first, `pickInvestigator`) walks to
 *   the breaker to look, which the intent arrow shows; the others look its way. Each outage is its own (named by
 *   `PowerState.outSince`).
 *
 * Nothing here rolls a die, so a preview is the outcome.
 */

declare module '../core/types' {
    interface EventMap {
        /** The crew cut the mains at the breaker. */
        breakerCut: { crew: string; object: string };
        /** The crew turned the mains back on. */
        breakerReset: { crew: string; object: string };
        /** The crew disabled the backup generator for good. */
        generatorDisabled: { crew: string; object: string };
        /** The backup generator started: the power is back. */
        generatorStarted: { object: string };
        /** The lights went out (§14.6): `generatorAt` is the turn the generator starts, as its crew phase begins, or null when none will. */
        powerOut: { generatorAt: number | null };
        /** The power is back. */
        powerBack: Record<never, never>;
    }
}

registerStateCheck('power', state => {
    const power = state.power as Partial<State['power']> | undefined;
    return power && typeof power.breaker === 'boolean' && typeof power.generator === 'string' ? undefined : 'no power grid (a save from before M4-03)';
});

/** The backup generator, if the bank has one. */
export const generatorOf = (world: ReadonlyWorld): DeepReadonly<{ id: string }> | undefined => world.objects.find(o => o.kind === 'generator');

/** The turn whose crew phase the generator starts on, or null when it won't (the mains on, it's running, disabled or missing). */
export function generatorAt(world: ReadonlyWorld, state: DeepReadonly<State>): number | null {
    const { power } = state;
    if (power.breaker || power.cutAt === null || power.generator !== 'standby' || !generatorOf(world)) return null;
    return power.cutAt + world.rules.generatorPhases;
}

/** Changes the grid with `change`, then says whether the lights went out or came back. */
function rewire(ctx: Ctx, change: (power: State['power']) => void): void {
    const { state } = ctx, was = powerOn(state);
    change(state.power);
    const now = powerOn(state);
    if (was === now) return;
    state.power.outSince = now ? null : state.turn;
    ctx.emit(now ? { type: 'powerBack' } : { type: 'powerOut', generatorAt: generatorAt(ctx.world, state) });
}

registerInteraction('breakerPanel', {
    cut: {
        cost: () => 1,
        illegal: 'hack',
        whyNot: (_world, state) => (state.power.breaker ? undefined : 'The mains are off already'),
        run(ctx, member, object) {
            ctx.emit({ type: 'breakerCut', crew: member.id, object: object.id });
            rewire(ctx, power => {
                power.breaker = false;
                power.cutAt = ctx.state.turn;
            });
        }
    },
    reset: {
        cost: () => 1,
        whyNot: (_world, state) => (state.power.breaker ? 'The mains are on' : undefined),
        run(ctx, member, object) {
            ctx.emit({ type: 'breakerReset', crew: member.id, object: object.id });
            rewire(ctx, power => {
                power.breaker = true;
                power.cutAt = null;
                if (power.generator === 'running') power.generator = 'standby';
            });
        }
    }
});

registerInteraction('generator', {
    disable: {
        cost: () => 1,
        illegal: 'hack',
        whyNot: (_world, state) => (state.power.generator === 'disabled' ? 'The generator is disabled already' : undefined),
        run(ctx, member, object) {
            ctx.emit({ type: 'generatorDisabled', crew: member.id, object: object.id });
            rewire(ctx, power => {
                power.generator = 'disabled';
            });
        }
    }
});

// The generator starts as its crew phase begins: the lights are on for the whole of it.
registerWorldHook('crewPhase', 'power.generator', ctx => {
    const { world, state } = ctx, at = generatorAt(world, state);
    if (at === null || state.turn < at) return;
    ctx.emit({ type: 'generatorStarted', object: generatorOf(world)!.id });
    rewire(ctx, power => {
        power.generator = 'running';
    });
}, { order: -10 });

// Lights out (§8.13): minor evidence everyone in the building notices, at the breaker, while the power is out.
registerEvidenceSource('power', (world, state) => {
    if (powerOn(state) || state.power.outSince === null) return [];
    const breaker = world.objects.find(o => o.kind === 'breakerPanel');
    if (!breaker) return [];
    return [{ id: `lightsOut:${state.power.outSince}`, kind: 'lightsOut', tiles: [{ ...breaker.pos }], everywhere: true }];
});

registerEvents({
    breakerCut: { undoBlocking: false },
    breakerReset: { undoBlocking: false },
    generatorDisabled: { undoBlocking: false },
    generatorStarted: { undoBlocking: false },
    powerOut: { undoBlocking: false },
    powerBack: { undoBlocking: false }
});
