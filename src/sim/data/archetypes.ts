import type { ObserverClass } from '../core/types';

/*
 * The panic column of the archetype table (§16.2) as data: the weights an NPC picks its reaction with when it panics or
 * when a command on it lapses (§10.5, §10.8). Cower, flee and hide are every archetype's; `special` is the staff's own
 * (the teller's alarm, the manager's phone, the operator's panel). Enforcers (guards, the security chief, couriers)
 * have no weights: they resist (§10.4), and an armed NPC whose command lapses reaches for his weapon.
 *
 * Roles the table doesn't name read their observer class's row: civilians as customers, staff as the cleaner.
 */

export interface PanicWeights {
    cower: number;
    flee: number;
    hide: number;
    /** Going for the alarm: the button, the desk phone or the console (§10.5 "Go for alarm or phone"). */
    special: number;
}

export const PANIC: Readonly<Record<string, PanicWeights>> = {
    customer: { cower: 50, flee: 35, hide: 15, special: 0 },
    teller: { cower: 40, flee: 10, hide: 10, special: 40 },
    headTeller: { cower: 40, flee: 10, hide: 10, special: 40 },
    driveTeller: { cower: 40, flee: 10, hide: 10, special: 40 },
    manager: { cower: 30, flee: 20, hide: 10, special: 40 },
    cleaner: { cower: 50, flee: 30, hide: 20, special: 0 },
    technician: { cower: 40, flee: 40, hide: 20, special: 0 },
    operator: { cower: 30, flee: 20, hide: 10, special: 40 }
};

/** The panic weights of a role (see the header); undefined for an enforcer, who resists instead. */
export function panicWeights(role: string, observer: ObserverClass): PanicWeights | undefined {
    if (observer === 'enforcer') return undefined;
    return PANIC[role] ?? (observer === 'civilian' ? PANIC.customer : PANIC.cleaner);
}
