import type { Archetype, CodePart, Door, GenPerson, GenRoom, KeyLock, TimelineEvent, TimeWindow } from './model';
import { DRILL_PHASES } from './tiers';

/*
 * The key graph (§15.2, §17.2 step 4): every hard lock (the vault, the CCTV room's door, the mantrap, the alarm panel,
 * the counting room's door) gets a social, a technical and a violent key, so stealthy, mixed and loud crews can all
 * plan. Each key is data the rules read (`src/sim/rules/keys.ts`: whose card opens which door, the code's parts, the
 * drill's phases and sensors, the time-lock window) with the briefing's line for it; the social keys name who holds them.
 */

interface Ctx {
    archetype: Archetype;
    vaultClass: 'M' | 'I' | 'II' | 'III';
    timeLock: boolean;
    dualControl: boolean;
    rooms: GenRoom[];
    doors: Door[];
    people: GenPerson[];
    timeline: TimelineEvent[];
}

/** The drill's and thermite's noise each phase (§15.3: a loud 6), and Three Keys' louder one (§17.2). */
const DEVICE_NOISE = 6, LOUDER_NOISE = 9;

/** Actions of hacking a card reader takes (§7.2: 2, Steady Hands 1). */
const READER_ACTIONS = 2;

/** The timeline's window the vault's time lock stands open in: the armoured car's, or its own scheduled one (§16.3). */
function timeWindow(timeline: readonly TimelineEvent[]): TimeWindow | undefined {
    const event = timeline.find(t => t.name === 'Armoured car') ?? timeline.find(t => t.name === 'Time-lock window');
    return event ? { from: event.turn, until: event.turn + (event.duration ?? 1) } : undefined;
}

export function keyGraph(ctx: Ctx): KeyLock[] {
    const { rooms, doors, people } = ctx;
    const ids = (...roles: string[]) => people.filter(p => roles.includes(p.role)).map(p => p.id);
    const room = (type: string) => rooms.find(r => r.type === type);
    const doorInto = (type: string) => {
        const r = room(type);
        return r && doors.find(d => (d.a === r.id || d.b === r.id) && d.lock !== 'none');
    };
    const reader = { kind: 'reader' as const, actions: READER_ACTIONS, text: `Hacking kit on the card reader (${READER_ACTIONS} actions)` };
    const locks: KeyLock[] = [];
    const vault = room('vault'), vaultDoor = doorInto('vault');
    if (vault && vaultDoor) {
        // Three Keys: "the drill and thermite still work, slower and louder" (§17.2): half as long again, a radius of 9.
        const three = ctx.archetype === 'threeKeys', slower = (n: number) => (three ? Math.ceil(n * 1.5) : n), noise = three ? LOUDER_NOISE : DEVICE_NOISE;
        const drill = slower(DRILL_PHASES[ctx.vaultClass]), thermite = slower(ctx.vaultClass === 'III' ? 5 : 3);
        const sensors: ('seismic' | 'motion')[] = ctx.vaultClass === 'III' ? ['seismic', 'motion'] : ctx.vaultClass === 'II' ? ['seismic'] : [];
        const window = ctx.timeLock ? timeWindow(ctx.timeline) : undefined;
        // The code is split only among the people the bank has: dual control needs a manager and a head teller.
        const parts: CodePart[] = ctx.dualControl && ids('manager').length && ids('headTeller').length ? ['manager', 'headTeller'] : ['whole'];
        const social: KeyLock['social'] = ctx.archetype === 'threeKeys'
            ? { kind: 'threeKeys', keycard: ids('manager'), text: "Three parts: the manager's keycard, the CCTV room disabled, and the time-lock window" }
            : parts.length > 1
                ? { kind: 'code', parts, text: 'Dual control: the manager and the head teller each enter half the code (coerced: 1 action each, adjacent)' }
                : { kind: 'code', parts, text: "The code, from the manager's PC (hacking kit, 2 actions in the office) or a bribed or inside staff member" };
        if (window && social.kind === 'code') social.text = `${social.text}; codes only work in the time-lock window, and someone still has to enter them`;
        locks.push({
            id: 'vault', name: `Vault (class ${ctx.vaultClass})`, target: vaultDoor.id, room: vault.id, social,
            technical: { kind: 'drill', phases: drill, noise, sensors, text: `Drill: ${drill} phases${sensors.length ? ', seismic sensor starts an alarm carrier' : ''}` },
            violent: { kind: 'thermite', phases: thermite, noise, text: `Thermite: ${thermite} phases, loud, scorches loot near the door` },
            holders: social.kind === 'threeKeys' ? social.keycard : parts.length > 1 ? ids('manager', 'headTeller') : ids('manager'),
            ...(window ? { timeLock: window } : {})
        });
    }
    // Both of the mantrap's doors are one lock's: the first keeps the id 'mantrap', the second is 'mantrap-2'.
    const mantrap = room('mantrap');
    if (mantrap) doors.filter(x => (x.a === mantrap.id || x.b === mantrap.id) && x.lock === 'keycard').forEach((d, i) => locks.push({
        id: i ? `mantrap-${i + 1}` : 'mantrap', name: i ? 'Mantrap (inner door)' : 'Mantrap', target: d.id, room: mantrap.id,
        social: { kind: 'buzz', holders: ids('operator'), text: 'The operator buzzes staff through (a staff uniform and a calm face)' },
        technical: { kind: 'loopedReader', actions: READER_ACTIONS, text: 'Loop the mantrap camera, then the hacking kit on the reader' },
        violent: { kind: 'breach', tool: 'breachCharge', text: 'Breach charge on either door' }, holders: ids('operator')
    }));
    const cctv = room('cctvRoom'), cctvDoor = doorInto('cctvRoom');
    if (cctv && cctvDoor) {
        const holders = ids('operator', 'lobbyGuard', 'patrolGuard', 'chief', 'manager');
        locks.push({
            id: 'cctv', name: 'CCTV room door', target: cctvDoor.id, room: cctv.id,
            social: { kind: 'keycard', holders, text: "A keycard: the operator's, a guard's, or the manager's" },
            technical: reader, violent: { kind: 'breach', tool: 'shotgun', text: 'Shotgun breach on the lock' }, holders
        });
    }
    const counting = room('countingRoom'), countingDoor = doorInto('countingRoom');
    if (counting && countingDoor) {
        // The guards' master cards too: their closing sweep goes through every room (§16.3).
        const holders = ids('headTeller', 'manager', 'lobbyGuard', 'patrolGuard', 'chief');
        locks.push({
            id: 'counting', name: 'Counting room door', target: countingDoor.id, room: counting.id,
            social: { kind: 'keycard', holders, text: "A keycard: the head teller's, the manager's or a guard's master card, or a teller sent with a cash tray" },
            technical: reader, violent: { kind: 'breach', tool: 'breachCharge', text: 'Breach charge on the steel door (loud)' }, holders
        });
    }
    const alarm = room('alarmCloset');
    if (alarm) locks.push({
        id: 'alarm', name: 'Alarm panel', target: alarm.id, room: alarm.id,
        social: { kind: 'disarmCode', holders: ids('operator', 'manager'), text: 'The disarm code, from an inside man or a bribed operator' },
        technical: { kind: 'panel', actions: 4, text: 'Hacking kit at the panel (4 actions; 2 with Steady Hands); it has its own battery, so cutting the power does not silence it' },
        violent: { kind: 'smash', text: 'Smash the panel (loud, and an alarm carrier if anyone hears)' }, holders: ids('operator', 'manager')
    });
    return locks;
}
