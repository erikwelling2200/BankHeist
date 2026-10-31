import { describe, expect, it } from 'vitest';
import {
    bagsSecured, clonePlain, heatAhead, occupancy, phasesUntilHeat, policeHit, registerWorldHook, fixtureWorld, hashOf, heatOf, initialState, nextWave, policeDown, preview, raiseCarrier, releaseBlocked, releaseHeat, releaseRelief,
    strength, worldFromBank, type PersonDef, type Pos, type ReadonlyWorld, type SimEvent, type State, type WorldObject
} from '../../src/sim';
import { bankView } from '../../src/game/views';
import { cachedBank } from '../bankCache';
import { registerTestCommand, registerTestEvents, scouted, step, testCommand } from './helpers';

/*
 * M3-04: the heat track (§13.1, §13.2), the force by level and greed (§13.3), arrivals, vehicles and the director's
 * modes (§13.4).
 */

const P = (x: number, y: number): Pos => ({ x, y });
const person = (id: string, observer: PersonDef['observer'], pos: Pos, facing: PersonDef['facing'] = 's'): PersonDef =>
    ({ id, name: id, role: observer === 'enforcer' ? 'guard' : observer === 'staff' ? 'teller' : 'customer', observer, pos, facing, schedule: [] });

// Test-only levers for what later packages do: a kill (M3-02/03), an officer down (M3-03/05), a release (M3-07),
// someone leaving the map, an alarm carrier.
registerTestCommand('testKill', (ctx, cmd) => {
    ctx.state.npcs.find(n => n.id === (cmd as unknown as { npc: string }).npc)!.status = 'dead';
});
registerTestCommand('testPoliceDown', (ctx, cmd) => policeDown(ctx, (cmd as unknown as { unit: string }).unit, true));
registerTestCommand('testRelease', ctx => void releaseHeat(ctx));
registerTestCommand('testLeave', (ctx, cmd) => {
    const npc = ctx.state.npcs.find(n => n.id === (cmd as unknown as { npc: string }).npc)!;
    npc.status = 'away';
    ctx.emit({ type: 'npcLeft', npc: npc.id, at: { ...npc.pos } });
});
registerTestCommand('testCarrier', ctx => void raiseCarrier(ctx, { kind: 'phoneCall', source: 'dispatch', pos: P(0, 0) }));
registerTestCommand('testHit', (ctx, cmd) => policeHit(ctx, (cmd as unknown as { unit: string }).unit));
// Someone dying in the world phase (a bleed-out, a trap): an NPC called 'doomed' dies in the first one after the Alarm.
registerWorldHook('devices', 'test.doom', ctx => {
    const npc = ctx.state.npcs.find(n => n.id === 'doomed' && n.status !== 'dead');
    if (npc && ctx.state.response) npc.status = 'dead';
});
registerTestEvents({});

const kill = (npc: string) => testCommand({ type: 'testKill', npc } as never);
const leave = (npc: string) => testCommand({ type: 'testLeave', npc } as never);
const endTurn = { type: 'endTurn' } as const;

const STAGING = [{ id: 'west', name: 'Main street, west end', pos: P(0, 5) }, { id: 'east', name: 'Main street, east end', pos: P(11, 5) }];

/** A street of a bank: rows 0–3 inside (room 'b'), rows 4–5 the street outside; staging at the street's two ends. */
function setup(people: PersonDef[] = [], options: { objects?: WorldObject[]; staging?: boolean; eta?: number } = {}): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(Array.from({ length: 6 }, () => '............'), {
        rooms: [...Array.from({ length: 4 }, () => 'bbbbbbbbbbbb'), '............', '............'],
        people, objects: options.objects ?? [], rules: { policeEta: options.eta ?? 2 },
        ...(options.staging === false ? {} : { staging: STAGING })
    });
    return { world, state: scouted(world, initialState(world, { seed: 7, crew: [{ id: 'jun', pos: P(5, 1) }] })) };
}

/** The state with the Alarm raised before this turn: "Police in" `eta`, heat at `heat` ticks. */
function alarmed(state: State, eta = 2, heat = 0): State {
    const s = clonePlain(state);
    s.bank.alarm = true;
    s.response = { raised: s.turn - 1, by: 'tellerButton', policeIn: eta, heat };
    return s;
}

/** Plays commands, each checked against its preview (§8.8: nothing here rolls, so they agree exactly). */
function run(world: ReadonlyWorld, state: State, ...cmds: Parameters<typeof step>[2][]): { state: State; events: SimEvent[] } {
    const events: SimEvent[] = [];
    for (const cmd of cmds) {
        const seen = preview(world, state, cmd);
        const done = step(world, state, cmd);
        expect(seen.events).toEqual(done.events);
        expect(hashOf(seen.state)).toBe(hashOf(done.state));
        events.push(...done.events);
        state = done.state;
    }
    return { state, events };
}
const turns = (n: number) => Array.from({ length: n }, () => endTurn);
const of = <K extends SimEvent['type']>(events: readonly SimEvent[], type: K) => events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);

describe('the heat track', () => {
    it('reads 5 ticks a level, Heat 5 at 20, and counts refills past it', () => {
        expect(heatOf(0)).toEqual({ level: 1, tick: 0, beyond: 0 });
        expect(heatOf(4)).toEqual({ level: 1, tick: 4, beyond: 0 });
        expect(heatOf(5)).toEqual({ level: 2, tick: 0, beyond: 0 });
        expect(heatOf(19)).toEqual({ level: 4, tick: 4, beyond: 0 });
        expect(heatOf(20)).toEqual({ level: 5, tick: 0, beyond: 0 });
        expect(heatOf(27)).toEqual({ level: 5, tick: 2, beyond: 1 });
        expect(heatOf(30)).toEqual({ level: 5, tick: 0, beyond: 2 });
    });

    it('has no heat before the Alarm, then +1 each world phase after the one that raised it', () => {
        const { world, state } = setup();
        const quiet = run(world, state, ...turns(2));
        expect(quiet.state.response).toBeNull();
        expect(of(quiet.events, 'heatChanged')).toEqual([]);
        // A carrier raises the Alarm in turn 2's world phase (countdown 2): heat 0 there, 1 in the next.
        const { state: raised, events } = run(world, quiet.state, testCommand({ type: 'testCarrier' }), ...turns(2));
        expect(raised.response).toMatchObject({ heat: 0 });
        expect(of(events, 'heatChanged')).toEqual([]);
        const after = run(world, raised, endTurn, endTurn);
        expect(after.state.response!.heat).toBe(2);
        expect(of(after.events, 'heatChanged').map(e => e.cause)).toEqual(['phase', 'phase']);
    });

    it('adds +5 for a civilian or a hostage killed by any cause', () => {
        const { world, state } = setup([person('customer', 'civilian', P(2, 1)), person('teller', 'staff', P(8, 1), 'n')]);
        const s = alarmed(state, 5, 3);
        s.npcs.find(n => n.id === 'teller')!.status = 'tied';
        const { state: after, events } = run(world, s, kill('customer'), kill('teller'));
        expect(of(events, 'heatChanged').map(e => [e.cause, e.by, e.victim])).toEqual([['civilianKilled', 5, 'customer'], ['civilianKilled', 5, 'teller']]);
        expect(after.response!.heat).toBe(13);
    });

    it('adds +1 for a guard or staff member killed after the Alarm, in the crew phase or the world phase', () => {
        const { world, state } = setup([person('guard', 'enforcer', P(5, 2)), person('doomed', 'staff', P(9, 2), 'e')]);
        const s = alarmed(state, 5);
        const killed = run(world, s, kill('guard'));
        expect(of(killed.events, 'heatChanged').map(e => [e.cause, e.by, e.victim])).toEqual([['staffKilled', 1, 'guard']]);
        // 'doomed' dies in the world phase (the test hook): counted there, after the phase's own tick.
        const phase = run(world, killed.state, endTurn);
        expect(of(phase.events, 'heatChanged').map(e => [e.cause, e.victim ?? null])).toEqual([['phase', null], ['staffKilled', 'doomed']]);
    });

    it('owes only witnessed kills before the Alarm, in secret, and adds them as a lump in the phase that raises it', () => {
        // The same kill, once with a customer looking at it and once with the customer looking away.
        for (const [facing, owed] of [['w', 5], ['e', 0]] as const) {
            const { world, state } = setup([person('victim', 'civilian', P(2, 1)), person('watcher', 'civilian', P(4, 1), facing)]);
            const { state: after, events } = run(world, state, kill('victim'), testCommand({ type: 'testCarrier' }));
            expect(events.filter(e => e.type.startsWith('heat'))).toEqual([]);
            expect(bankView(after, false, world).heat ?? null).toBeNull();
            const raised = run(world, after, endTurn, endTurn);
            expect(raised.state.response!.heat).toBe(owed);
            expect(of(raised.events, 'heatChanged').map(e => [e.cause, e.by, e.victim])).toEqual(owed ? [['witnessedKills', 5, undefined]] : []);
            expect(raised.state.heat.owed).toEqual([]);
        }
    });

    it('shows the crew the same before the Alarm whether or not the operator watched a kill on a feed', () => {
        const desk: WorldObject = { id: 'desk', kind: 'cctvDesk', pos: P(10, 0), facing: 's', monitors: 4 };
        const seen: unknown[] = [];
        for (const at of [P(10, 1), P(1, 3)]) {
            const world = fixtureWorld(Array.from({ length: 6 }, () => '............'), {
                rooms: [...Array.from({ length: 4 }, () => 'bbbbbbbbbbbb'), '............', '............'],
                people: [person('guard', 'enforcer', P(5, 2), 'n'), { ...person('op', 'staff', at, 'n'), role: 'operator' }],
                objects: [desk], cameras: [{ id: 'cam', pos: P(5, 0), facings: ['s'], room: 'b' }], staging: STAGING
            });
            const state = scouted(world, initialState(world, { seed: 7, crew: [{ id: 'jun', pos: P(0, 3) }] }));
            const { state: after, events } = run(world, state, kill('guard'));
            seen.push({ events: events.filter(e => e.type.startsWith('heat') || e.type.startsWith('police')), bank: bankView(after, false, world) });
            // The difference lands with the Alarm, as a lump (the design's reveal).
            const raised = run(world, after, testCommand({ type: 'testCarrier' }), endTurn, endTurn).state;
            seen.push(raised.response!.heat);
        }
        expect(seen[0]).toEqual(seen[2]);
        expect([seen[1], seen[3]]).toEqual([1, 0]);
    });

    it('adds +1 for each world phase a drill works on a Class II+ vault door, never on a Class I', () => {
        for (const sensors of [['seismic'], []] as ('seismic' | 'motion')[][]) {
            const world = fixtureWorld(['....', '....'], {
                walls: [{ between: [P(1, 0), P(2, 0)], material: 'vault', door: { id: 'vd', lock: 'vault' } }],
                locks: [{
                    id: 'vault', name: 'Vault', target: 'vd', room: 'v', holders: [], social: { kind: 'code', parts: ['whole'], text: 'code' },
                    technical: { kind: 'drill', phases: 3, noise: 6, sensors, text: 'drill' }, violent: { kind: 'thermite', phases: 3, noise: 6, text: 'thermite' }
                }]
            });
            const s = alarmed(initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 1) }] }), 9);
            s.devices = [{ id: 'drill-1', kind: 'drill', at: 'vd', pos: P(1, 0), crew: 'jun', done: 0, needed: 3, jammed: false, noise: 6 }];
            // Not `run`: the drill's jam roll ends the world phase, where a preview stops at its odds.
            const causes = of(step(world, s, endTurn).events, 'heatChanged').map(e => e.cause);
            expect(causes).toEqual(sensors.length ? ['phase', 'vaultWork'] : ['phase']);
        }
    });

    it('adds +1 for a hostage who escapes to the police', () => {
        const { world, state } = setup([person('customer', 'civilian', P(2, 1))]);
        const s = alarmed(state, 5, 2);
        s.npcs[0]!.status = 'commanded';
        const { events } = run(world, s, leave('customer'));
        expect(of(events, 'heatChanged').map(e => e.cause)).toEqual(['hostageEscaped']);
        // A lapse's runner is a hostage escaping too; a customer leaving on their own isn't.
        const ran = clonePlain(s);
        ran.npcs[0]!.status = 'alerted';
        ran.npcs[0]!.lapse = { kind: 'flee', exit: P(0, 5) };
        expect(of(run(world, ran, leave('customer')).events, 'heatChanged').map(e => e.cause)).toEqual(['hostageEscaped']);
        ran.npcs[0]!.lapse = null;
        expect(of(run(world, ran, leave('customer')).events, 'heatChanged')).toEqual([]);
    });

    it('lets a release lower it by 3, capped at Heat 1 tick 0, once a turn and three times a heist', () => {
        const { world, state } = setup();
        expect(releaseBlocked(state)).toMatch(/before the Alarm/);
        let s = alarmed(state, 5, 7);
        expect(releaseRelief(s)).toBe(3);
        s = run(world, s, testCommand({ type: 'testRelease' })).state;
        expect(s.response!.heat).toBe(4);
        expect(releaseBlocked(s)).toMatch(/this turn/);
        expect(releaseRelief(s)).toBe(0);
        s = run(world, s, endTurn).state;
        expect(s.response!.heat).toBe(5);
        s = run(world, s, testCommand({ type: 'testRelease' }), endTurn).state;
        expect(s.response!.heat).toBe(3);
        // The capped amount: 3 ticks left to Heat 1, tick 0... after a phase's +1, 3 again.
        s.response!.heat = 1;
        expect(releaseRelief(s)).toBe(1);
        const last = run(world, s, testCommand({ type: 'testRelease' }));
        expect(of(last.events, 'heatChanged').map(e => e.by)).toEqual([-1]);
        expect(last.state.response!.heat).toBe(0);
        expect(releaseBlocked(run(world, last.state, endTurn).state)).toMatch(/3 releases/);
    });
});

describe('the force', () => {
    it('scales by greed, +10% a bag secured, at most +50%, never the negotiator', () => {
        expect(strength(1, 0)).toMatchObject({ patrol: 4, negotiator: 0 });
        expect(strength(1, 50)).toMatchObject({ patrol: 6 });
        expect(strength(3, 10)).toMatchObject({ patrol: 9, negotiator: 1, swat: 3, swatShield: 1 });
        expect(strength(5, 50)).toMatchObject({ patrol: 12, negotiator: 1, swat: 12, swatShield: 3, heavy: 3, sniper: 6 });
    });

    it('counts a bag secured once it is in the getaway (the hold, or carried aboard), not out on the street or ruined', () => {
        const bag = (id: string, pos: Pos): WorldObject => ({ id, kind: 'loot', pos, facing: 's', loot: { value: 10000, weight: 'heavy' } });
        const { world, state } = setup([], { objects: [bag('a', P(1, 1)), bag('b', P(2, 1)), { id: 'c', kind: 'loot', pos: P(3, 1), facing: 's', loot: { value: 500, weight: 'light' } }] });
        const s = clonePlain(state);
        s.vehicles = { van: { pose: { x: 6, y: 4, heading: 'w' }, driver: null, hold: [], gone: false } };
        expect(bagsSecured(world, s)).toBe(0);
        // Out of the building isn't secured; in the hold is (M3-08, decision 176).
        s.loot.a = { ...s.loot.a!, taken: true, pos: P(1, 5) };
        expect(bagsSecured(world, s)).toBe(0);
        s.loot.a = { ...s.loot.a, holder: 'van' };
        s.loot.b = { ...s.loot.b!, taken: true, holder: 'jun' };
        s.loot.c = { ...s.loot.c!, taken: true, holder: 'van' };
        expect(bagsSecured(world, s)).toBe(1);
        s.crew[0]!.aboard = 'van';
        expect(bagsSecured(world, s)).toBe(2);
        // Once secured, a bag stays secured.
        const kept = step(world, s, { type: 'endTurn' }).state;
        kept.crew[0]!.aboard = null;
        expect(bagsSecured(world, kept)).toBe(2);
        s.loot.a.ruined = true;
        expect(bagsSecured(world, s)).toBe(1);
    });
});

describe('the police', () => {
    it('arrive when "Police in" runs out: cars at the staging points, officers out in the next phase, then Contain', () => {
        const { world, state } = setup();
        const s = alarmed(state, 2);
        const first = run(world, s, endTurn, endTurn);
        const arriving = of(first.events, 'policeArriving');
        expect(arriving.map(e => [e.kind, e.staging, e.units, e.reason])).toEqual([['car', 'west', 2, 'arrival'], ['car', 'east', 2, 'arrival']]);
        expect(first.state.police.units.every(u => u.pos === null)).toBe(true);
        const out = run(world, first.state, endTurn);
        const deployed = of(out.events, 'policeDeployed');
        expect(deployed).toHaveLength(4);
        // Each on a tile of their own, on the street by the car.
        expect(new Set(deployed.map(e => `${e.pos.x},${e.pos.y}`)).size).toBe(4);
        expect(deployed.every(e => e.pos.y >= 4)).toBe(true);
        expect(of(out.events, 'policeMode')).toEqual([{ type: 'policeMode', mode: 'contain', phases: 3, level: 1 }]);
        expect(out.state.police.vehicles.map(v => v.status)).toEqual(['parked', 'parked']);
    });

    it('cycle Contain (3), Assault without a negotiator, then Regroup, then Contain (1) with nobody to negotiate for', () => {
        const { world, state } = setup();
        const { events } = run(world, alarmed(state, 1), ...turns(16));
        // Heat 1 on arrival, so no negotiator yet: Contain goes straight to Assault (at Heat 2 by then: 4), Regroup (3),
        // Contain (1) with no hostages held, and Assault again at Heat 3 (5).
        expect(of(events, 'policeMode').map(e => [e.mode, e.phases, e.level])).toEqual([
            ['contain', 3, 1], ['assault', 4, 2], ['regroup', 3, 2], ['contain', 1, 3], ['assault', 5, 3]
        ]);
    });

    it('bring the first arrival as every level reached so far, by car and by van, and forecast each step exactly', () => {
        const { world, state } = setup();
        // Heat 2 by the time they arrive: 8 officers (4 cars, 2 a staging point) and the negotiator in a van.
        const s = alarmed(state, 1, 4);
        const arrived = run(world, s, endTurn);
        expect(of(arrived.events, 'policeArriving').map(e => [e.label, e.staging, e.units])).toEqual([
            ['Police car', 'west', 2], ['Police car', 'east', 2], ['Police car', 'west', 2], ['Police car', 'east', 2], ['Police van', 'west', 1]
        ]);
        // The next step's forecast is the wave the step sends.
        let now = run(world, arrived.state, endTurn).state;
        const forecast = nextWave(world, now)!;
        expect(forecast).toMatchObject({ level: 3, reason: 'level', inPhases: 4 });
        expect(forecast.vehicles.map(v => [v.label, v.staging?.id, v.units.length])).toEqual([['SWAT van', 'west', 4]]);
        const until = run(world, now, ...turns(3));
        expect(of(until.events, 'policeArriving')).toEqual([]);
        now = until.state;
        const step3 = run(world, now, endTurn);
        expect(of(step3.events, 'policeArriving').map(e => [e.label, e.staging, e.units, e.level, e.reason])).toEqual([['SWAT van', 'west', 4, 3, 'level']]);
        // The van unloads in the next phase and drives off in the one after; the cars stay.
        const later = run(world, step3.state, endTurn, endTurn);
        expect(of(later.events, 'vehicleLeft').length).toBe(1);
        expect(later.state.police.vehicles.map(v => v.kind)).toEqual(['car', 'car', 'car', 'car']);
    });

    it('refill only lost units at a heat step, and an officer killed is +3, then +1, and ends Negotiate in an Assault', () => {
        const { world, state } = setup();
        let s = run(world, alarmed(state, 1, 4), endTurn, endTurn).state;
        expect(s.police.mode!.kind).toBe('contain');
        s = run(world, s, ...turns(3)).state;
        expect(s.police.mode!.kind).toBe('negotiate');
        const [a, b] = s.police.units.filter(u => u.kind === 'patrol');
        const shot = run(world, s, testCommand({ type: 'testPoliceDown', unit: a!.id } as never), testCommand({ type: 'testPoliceDown', unit: b!.id } as never));
        expect(of(shot.events, 'heatChanged').map(e => [e.cause, e.by])).toEqual([['firstPoliceKilled', 3], ['policeKilled', 1]]);
        expect(of(shot.events, 'policeMode').map(e => e.mode)).toEqual(['assault']);
        // Heat 3 is reached: its wave goes out in the next world phase, with the SWAT team and the two lost officers, in
        // a van: every car slot is taken (the lost officers' car stays).
        expect(shot.state.response!.heat).toBe(13);
        const next = nextWave(world, shot.state)!;
        expect(next).toMatchObject({ level: 3, reason: 'level', inPhases: 1 });
        expect(next.vehicles.filter(v => v.units.includes('patrol')).map(v => [v.label, v.units.filter(u => u === 'patrol').length])).toEqual([['Police van', 2]]);
        expect(next.vehicles.every(v => v.kind !== 'car')).toBe(true);
    });

    it('end Negotiate in an Assault when an officer is hit, not only killed', () => {
        const { world, state } = setup();
        const s = run(world, alarmed(state, 1, 4), ...turns(5)).state;
        expect(s.police.mode!.kind).toBe('negotiate');
        const hit = run(world, s, testCommand({ type: 'testHit', unit: s.police.units[0]!.id } as never));
        expect(hit.events.map(e => e.type)).toEqual(['policeHit', 'policeMode']);
        expect(hit.state.police.mode).toMatchObject({ kind: 'assault' });
        expect(hit.state.response!.heat).toBe(s.response!.heat);
    });

    it('forecast the first arrival through "Police in N", and a first arrival at Heat 4 brings teams, snipers on foot and the helicopter', () => {
        const { world, state } = setup();
        const s = alarmed(state, 2, 13);
        // Heat shows from the Alarm, and so does what the police will bring: Heat 4 by the time they come.
        expect(bankView(s, false, world).heat).toMatchObject({ level: 3, ticks: 3, next: { label: 'Police at Heat 4: Police car, main street, west end +9', inTurns: 2 } });
        const forecast = nextWave(world, s)!;
        expect(forecast).toMatchObject({ level: 4, reason: 'arrival', inPhases: 2 });
        const { state: arrived, events } = run(world, s, endTurn, endTurn);
        const sent = events.flatMap(e => (e.type === 'policeArriving' ? [[e.kind, e.label, e.staging, e.units]] : e.type === 'policeOnFoot' ? [['foot', 'Sniper team', e.staging, e.units.length]] : []));
        expect(sent).toEqual(forecast.vehicles.map(v => [v.kind, v.label, v.staging?.id ?? null, v.units.length]));
        expect(forecast.vehicles.filter(v => v.label === 'SWAT van').map(v => v.units)).toEqual([['swatShield', 'swat', 'swat', 'swat'], ['swatShield', 'swat', 'swat', 'swat']]);
        expect(forecast.vehicles.filter(v => v.kind === 'foot').map(v => v.units)).toEqual([['sniper', 'sniper'], ['sniper', 'sniper']]);
        expect(forecast.vehicles.some(v => v.kind === 'helicopter')).toBe(true);
        // Everyone out a phase later, the snipers too, each on a tile of their own.
        const out = run(world, arrived, endTurn).state;
        expect(out.police.units.every(u => u.pos !== null)).toBe(true);
        expect(new Set(out.police.units.map(u => `${u.pos!.x},${u.pos!.y}`)).size).toBe(out.police.units.length);
    });

    it('count known vault work in the forecast', () => {
        const world = fixtureWorld(['....', '....'], {
            walls: [{ between: [P(1, 0), P(2, 0)], material: 'vault', door: { id: 'vd', lock: 'vault' } }],
            locks: [{
                id: 'vault', name: 'Vault', target: 'vd', room: 'v', holders: [], social: { kind: 'code', parts: ['whole'], text: 'code' },
                technical: { kind: 'drill', phases: 3, noise: 6, sensors: ['seismic'], text: 'drill' }, violent: { kind: 'thermite', phases: 3, noise: 6, text: 'thermite' }
            }]
        });
        const s = alarmed(initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 1) }] }), 9);
        expect(phasesUntilHeat(world, s, 5)).toBe(5);
        s.devices = [{ id: 'drill-1', kind: 'drill', at: 'vd', pos: P(1, 0), crew: 'jun', done: 1, needed: 3, jammed: false, noise: 6 }];
        expect([heatAhead(world, s, 1), heatAhead(world, s, 2), heatAhead(world, s, 3)]).toEqual([2, 4, 5]);
        expect(phasesUntilHeat(world, s, 5)).toBe(3);
    });

    it('send nothing when a level is reached again after a release', () => {
        const { world, state } = setup();
        let s = run(world, alarmed(state, 1, 5), endTurn).state;
        expect(s.police.sent).toBe(2);
        s = run(world, s, testCommand({ type: 'testRelease' })).state;
        expect(s.response!.heat).toBe(3);
        const again = run(world, s, ...turns(3));
        expect(again.state.response!.heat).toBe(6);
        expect(of(again.events, 'policeArriving')).toEqual([]);
        expect(nextWave(world, again.state)).toMatchObject({ level: 3, inPhases: 4 });
    });

    it('stand in everyone\'s way, and wait aboard when there is no free tile to get out on', () => {
        const world = fixtureWorld(['..'], { staging: [{ id: 'end', name: 'The end', pos: P(0, 0) }], rules: { policeEta: 1 } });
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(0, 0) }, { id: 'mara', pos: P(1, 0) }] });
        const full = run(world, alarmed(state, 1), endTurn, endTurn).state;
        expect(full.police.units.length).toBe(4);
        expect(full.police.units.every(u => u.pos === null && u.vehicle !== null)).toBe(true);
        // Mara steps aside (off the map's two tiles there is nowhere, so she is lifted out): one officer gets out there.
        const room = clonePlain(full);
        room.crew = room.crew.filter(c => c.id !== 'mara');
        const out = run(world, room, endTurn).state;
        expect(out.police.units.filter(u => u.pos !== null).map(u => u.pos)).toEqual([P(1, 0)]);
        expect(occupancy(world, out).get(1)).toBe('blocking');
        expect(occupancy(world, out, { mover: 'jun' }).get(1)).toBe('blocking');
    });

    it('never come to a bank without staging points', () => {
        const { world, state } = setup([], { staging: false });
        const { state: after, events } = run(world, alarmed(state, 1, 10), ...turns(4));
        expect(of(events, 'policeArriving')).toEqual([]);
        expect(after.police.units).toEqual([]);
        expect(after.response!.heat).toBe(14);
    });

    it('stage at a generated bank\'s staging points and get out on the street, every tier', () => {
        for (const tier of ['small', 'city', 'hq'] as const) {
            const world = worldFromBank(cachedBank({ layout: 3100, population: 17, tier }));
            expect(world.staging!.map(p => p.id)).toEqual(['street-west', 'street-east', 'alley-mouth']);
            const state = initialState(world, { seed: 5, crew: [] });
            const { state: after } = run(world, alarmed(state, 1, 7), endTurn, endTurn);
            expect(after.police.vehicles.length).toBeGreaterThan(0);
            const units = after.police.units;
            expect(units.length).toBe(9);
            for (const u of units) {
                expect(u.pos, u.id).not.toBeNull();
                const tile = world.tiles[u.pos!.y * world.width + u.pos!.x]!;
                expect(tile.blocksMove).toBe(false);
                expect(world.building!.includes(tile.room ?? '')).toBe(false);
            }
            expect(new Set(units.map(u => `${u.pos!.x},${u.pos!.y}`)).size).toBe(units.length);
            // The heat strip: Heat 2, and what Heat 3 brings and where.
            expect(bankView(after, false, world).heat).toMatchObject({ level: 2, ticks: 4, next: { label: 'Heat 3: SWAT van, main street, east end', inTurns: 1 } });
        }
    }, 60000);
});
