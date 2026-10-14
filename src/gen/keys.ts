import type { Archetype, Door, GenPerson, GenRoom, KeyLock } from './model';
import { DRILL_PHASES } from './tiers';

/*
 * The key graph (§15.2, §17.2 step 4): every hard lock (the vault, the CCTV room's door, the mantrap, the alarm panel,
 * the counting room's door) gets a social, a technical and a violent key, so stealthy, mixed and loud crews can all
 * plan; the social keys name who holds them.
 */

interface Ctx {
    archetype: Archetype;
    vaultClass: 'M' | 'I' | 'II' | 'III';
    timeLock: boolean;
    dualControl: boolean;
    rooms: GenRoom[];
    doors: Door[];
    people: GenPerson[];
}

export function keyGraph(ctx: Ctx): KeyLock[] {
    const { rooms, doors, people } = ctx;
    const ids = (...roles: string[]) => people.filter(p => roles.includes(p.role)).map(p => p.id);
    const room = (type: string) => rooms.find(r => r.type === type);
    const doorInto = (type: string) => {
        const r = room(type);
        return r && doors.find(d => (d.a === r.id || d.b === r.id) && d.lock !== 'none');
    };
    const locks: KeyLock[] = [];
    const vaultDoor = doorInto('vault');
    if (vaultDoor) {
        const drill = DRILL_PHASES[ctx.vaultClass], thermite = ctx.vaultClass === 'III' ? 5 : 3;
        const social = ctx.archetype === 'threeKeys'
            ? "Three parts: the manager's keycard, the CCTV room disabled, and the time-lock window"
            : ctx.dualControl
                ? 'Dual control: the manager and the head teller each enter half the code (coerced: 1 action each, adjacent)'
                : "The code, from the manager's PC (hacking kit, 2 actions in the office) or a bribed or inside staff member";
        locks.push({
            id: 'vault', name: `Vault (class ${ctx.vaultClass})`, target: vaultDoor.id,
            social: ctx.timeLock ? `${social}; codes only work in the time-lock window` : social,
            technical: `Drill: ${drill} phases${ctx.vaultClass === 'II' || ctx.vaultClass === 'III' ? ', seismic sensor starts an alarm carrier' : ''}`,
            violent: `Thermite: ${thermite} phases, loud, scorches loot near the door`,
            holders: ctx.dualControl ? ids('manager', 'headTeller') : ids('manager')
        });
    }
    const mantrap = room('mantrap');
    if (mantrap) {
        const d = doors.find(x => (x.a === mantrap.id || x.b === mantrap.id) && x.lock === 'keycard');
        if (d) locks.push({
            id: 'mantrap', name: 'Mantrap', target: d.id, social: 'The operator buzzes staff through (a staff uniform and a calm face)',
            technical: 'Loop the mantrap camera, then the hacking kit on the reader', violent: 'Breach charge on either door', holders: ids('operator')
        });
    }
    const cctvDoor = doorInto('cctvRoom');
    if (cctvDoor) locks.push({
        id: 'cctv', name: 'CCTV room door', target: cctvDoor.id, social: "A keycard: the operator's, a guard's, or the manager's",
        technical: 'Hacking kit on the card reader (2 actions)', violent: 'Shotgun breach on the lock', holders: ids('operator', 'lobbyGuard', 'patrolGuard', 'chief', 'manager')
    });
    const counting = doorInto('countingRoom');
    if (counting) locks.push({
        id: 'counting', name: 'Counting room door', target: counting.id, social: "A keycard: the head teller's or the manager's, or a teller sent with a cash tray",
        technical: 'Hacking kit on the card reader (2 actions)', violent: 'Breach charge on the steel door (loud)', holders: ids('headTeller', 'manager')
    });
    const alarm = room('alarmCloset');
    if (alarm) locks.push({
        id: 'alarm', name: 'Alarm panel', target: alarm.id, social: 'The disarm code, from an inside man or a bribed operator',
        technical: 'Hacking kit at the panel (2 actions); it has its own battery, so cutting the power does not silence it',
        violent: 'Smash the panel (loud, and an alarm carrier if anyone hears)', holders: ids('operator', 'manager')
    });
    return locks;
}
