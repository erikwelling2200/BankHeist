import { describe, expect, it } from 'vitest';
import { archetypesFor } from '../../src/gen/generate';
import { TIERS, type KeyLock } from '../../src/gen/model';
import {
    actionPreview, autoAdvanceBlocked, CARRIERS, cctvDesk, npcCanPass, pathTo, planMoveOptions, reachable, timeLockOpen, clonePlain, commit, doorSides, doorStatus, fixtureWorld, initialState, inReach, interruptsOf, legalActions, lineOfSight, preview, sightMap, tileAt,
    vaultLock, whyNot, worldFromBank, type Command, type CrewStart, type DeepReadonly, type PersonDef, type Pos, type ReadonlyWorld, type State,
    type WorldObject
} from '../../src/sim';
import { cachedBank } from '../bankCache';
import { scouted, step } from './helpers';

/*
 * Vault access (M2-05; §15.2, §15.3, §9.1's sensors, §7.2): the key graph's keys as the rules play them. The acceptance
 * test opens every generated bank's vault three ways, each scripted on its own copy: its social key (the code, coerced
 * out of its key-holders or pulled from the manager's PC; the time-lock window; Three Keys' card), its technical key
 * (the drill) and its violent key (thermite); then a crew member walks in. The rest are fixtures: the console, the PC,
 * the time lock, jams and Steady Hands, the sensors, card readers, lockpicking and deposit boxes.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const fresh = (state: State): State => ({ ...state, crew: state.crew.map(c => ({ ...c, actionsLeft: 2 })) });
const run = (world: ReadonlyWorld, state: State, ...cmds: Command[]): State => cmds.reduce((s, c) => step(world, fresh(s), c).state, state);

// ---------------------------------------------------------------------------------------------------------- Every bank

const SEEDS = [0, 1, 2];

/** Tiles a crew member could stand on: walkable, in a room, nobody on them. */
function standable(world: ReadonlyWorld, state: State, p: Pos, taken: readonly Pos[] = []): boolean {
    const tile = tileAt(world, p);
    return !!tile?.room && !tile.blocksMove && !state.npcs.some(n => n.pos.x === p.x && n.pos.y === p.y)
        && !state.crew.some(c => c.pos.x === p.x && c.pos.y === p.y) && !taken.some(t => t.x === p.x && t.y === p.y);
}

/** The tiles in reach of `p` (or only beside it) someone could stand on, in reading order. */
function around(world: ReadonlyWorld, state: State, p: DeepReadonly<Pos>, taken: readonly Pos[] = [], reach = true): Pos[] {
    const out: Pos[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const q = P(p.x + dx, p.y + dy);
        if (standable(world, state, q, taken) && (!reach || inReach(world, state, q, p))) out.push(q);
    }
    return out;
}

/** The nearest tile to `p` someone could stand on that isn't in reach of it (rings outward). */
function free(world: ReadonlyWorld, state: State, p: DeepReadonly<Pos>): Pos {
    for (let r = 2; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const q = P(p.x + dx, p.y + dy);
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && standable(world, state, q)) return q;
    }
    throw new Error(`No free tile near ${JSON.stringify(p)}`);
}

/** The heist's start with everyone on the map out cold for good (nobody to raise the alarm while the test works). */
function quiet(world: ReadonlyWorld, crew: CrewStart[]): State {
    const state = initialState(world, { seed: 7, crew });
    for (const n of state.npcs) if (n.status !== 'away') Object.assign(n, { status: 'unconscious', outCold: 9999, intent: { path: [] } });
    return state;
}

const place = (state: State, crew: string, pos: Pos): State => ({ ...state, crew: state.crew.map(c => (c.id === crew ? { ...c, pos } : c)) });

/** Puts an NPC (tied) on a tile. */
const putNpc = (state: State, id: string, pos: Pos): State => ({ ...state, npcs: state.npcs.map(n => (n.id === id ? { ...n, pos, status: 'tied' as const, intent: { path: [] } } : n)) });

/** The vault door's tiles: the one outside (where the crew works) and the one inside. */
function vaultSides(world: ReadonlyWorld): { outside: Pos; inside: Pos; lock: DeepReadonly<KeyLock> } {
    const lock = vaultLock(world)!, [a, b] = doorSides(world, world.doors[lock.target]!)!;
    return tileAt(world, a)!.room === lock.room ? { outside: b, inside: a, lock } : { outside: a, inside: b, lock };
}

/** Walks the crew member at the vault door's outer tile in, and checks they got there (and the motion sensor saw them). */
function walkIn(world: ReadonlyWorld, state: State, crew: string): void {
    const { outside, inside, lock } = vaultSides(world);
    // Scouted: a move is planned against what the crew knows, and nobody has seen into the vault yet.
    const at = scouted(world, place(fresh(state), crew, outside));
    const r = commit(world, at, { type: 'move', crew, path: [inside] });
    expect(r.state.crew.find(c => c.id === crew)!.pos).toEqual(inside);
    // Not in the window, and not once the seismic sensor (or anything) has raised the Alarm: nothing starts then.
    const motion = lock.technical.kind === 'drill' && lock.technical.sensors.includes('motion') && !(lock.timeLock && timeLockOpen(world, at.turn)) && !at.bank.alarm;
    expect(r.state.carriers.some(c => c.kind === 'motionSensor')).toBe(motion);
    if (motion) routes.add('motion sensor');
}

/** Walks a crew member to `goal` turn by turn over the scouted map, through the doors their cards open. */
function walkTo(world: ReadonlyWorld, state: State, crew: string, goal: Pos): State {
    let s = scouted(world, fresh(state));
    for (let turns = 0; turns < 40; turns++) {
        for (let a = 0; a < 2; a++) {
            const member = s.crew.find(c => c.id === crew)!;
            if (member.pos.x === goal.x && member.pos.y === goal.y) return s;
            const path = pathTo(reachable(world, s, member.pos, 100000, planMoveOptions(world, s, member)), goal);
            expect(path, `a way from ${JSON.stringify(member.pos)} to ${JSON.stringify(goal)}`).toBeDefined();
            const r = [6, 5, 4, 3, 2, 1].map(k => { try { return commit(world, s, { type: 'move', crew, path: path!.slice(0, k) }); } catch { return undefined; } }).find(x => x);
            s = scouted(world, r!.state);
        }
        s = scouted(world, commit(world, s, { type: 'endTurn' }).state);
    }
    throw new Error(`${crew} never got to ${JSON.stringify(goal)}`);
}

/** The social routes the banks took, to check every kind came up. */
const routes = new Set<string>();

/** A crew member zip-ties the manager, out cold where he lies: the frisk takes his card. */
function friskManager(world: ReadonlyWorld, state: State, crew: string): State {
    const manager = world.people.find(p => p.role === 'manager')!, lying = state.npcs.find(n => n.id === manager.id)!.pos;
    let s = place(state, crew, around(world, state, lying)[0]!);
    s = run(world, s, { type: 'zipTie', crew, npc: manager.id });
    expect(s.crew.find(c => c.id === crew)!.keycards).toContain(manager.id);
    return s;
}

/** Into the time-lock window, a world phase at a time from just before it (codes are refused until then). */
function intoWindow(world: ReadonlyWorld, state: State): State {
    const window = vaultLock(world)!.timeLock;
    if (!window || state.turn >= window.from) return state;
    const before = { ...state, turn: window.from - 1 };
    return commit(world, before, { type: 'endTurn' }).state;
}

/** The social key (§15.2), scripted for the bank's kind of vault; codes and the card only in the time-lock window. */
function socialKey(world: ReadonlyWorld, tier: string): State {
    const { lock } = vaultSides(world);
    const console = world.objects.find(o => o.kind === 'vaultConsole')!;
    let state = quiet(world, [{ id: 'mara', pos: P(0, 0), items: ['pistol', 'hackingKit'] }, { id: 'jun', pos: P(0, 0) }]);
    if (lock.social.kind === 'threeKeys') {
        // The manager's card (a frisk takes it), the CCTV room held (its operators out cold), in the window.
        routes.add('threeKeys');
        state = intoWindow(world, friskManager(world, state, 'jun'));
        // At the desk is anywhere beside it (cctv.ts): the operator, out cold in his chair, may hold the one tile in reach.
        const desk = cctvDesk(world);
        if (desk) state = place(state, 'mara', around(world, state, desk.pos, [], false)[0]!);
        state = place(state, 'jun', around(world, state, console.pos)[0]!);
        expect(whyNot(world, state, { type: 'interact', crew: 'jun', object: console.id, verb: 'unlock' })).toBeUndefined();
        return run(world, state, { type: 'interact', crew: 'jun', object: console.id, verb: 'unlock' });
    }
    if (lock.social.kind !== 'code') throw new Error(`A vault's social key is '${lock.social.kind}'`);
    if (lock.social.parts.includes('whole')) {
        // The manager's PC: Mara frisks the manager for his card, hacks his PC (2 actions), then walks to the console and
        // enters the code, in the window.
        routes.add(`${tier} pc`);
        const pc = world.objects.find(o => o.kind === 'managerPc')!;
        state = friskManager(world, state, 'mara');
        state = place(state, 'mara', P(0, 0));
        // The manager, tied at his desk, may sit on the one tile the PC is reached from: he is moved aside (dragging him
        // there is body.ts's business, tested on its own).
        if (!around(world, state, pc.pos).length) {
            const manager = world.people.find(p => p.role === 'manager')!.id, aside = free(world, state, pc.pos);
            state = putNpc(state, manager, aside);
        }
        state = place(state, 'mara', around(world, state, pc.pos)[0]!);
        state = run(world, state, { type: 'interact', crew: 'mara', object: pc.id, verb: 'hack' }, { type: 'interact', crew: 'mara', object: pc.id, verb: 'hack' });
        expect(state.codesKnown).toEqual(['whole']);
        state = walkTo(world, state, 'mara', around(world, state, console.pos)[0]!);
        if (lock.timeLock && state.turn < lock.timeLock.from) {
            expect(whyNot(world, fresh(state), { type: 'interact', crew: 'mara', object: console.id, verb: 'unlock' })).toBe(`The time lock holds the vault shut until turn ${lock.timeLock.from}`);
        }
        state = intoWindow(world, state);
        return run(world, state, { type: 'interact', crew: 'mara', object: console.id, verb: 'unlock' });
    }
    // Dual control: each key-holder, tied beside the console, is made to enter their half, in the window.
    routes.add(`${tier} dualControl`);
    state = intoWindow(world, state);
    for (const role of lock.social.parts) {
        const holder = world.people.find(p => p.role === role)!;
        state = place(state, 'mara', P(0, 0));
        const spot = around(world, state, console.pos).find(h => around(world, state, h, [h], false).some(c => lineOfSight(sightMap(world, state), c, h)))!;
        state = putNpc(state, holder.id, spot);
        state = place(state, 'mara', around(world, state, spot, [], false).find(c => lineOfSight(sightMap(world, state), c, spot))!);
        state = run(world, state, { type: 'coerce', crew: 'mara', npc: holder.id, at: console.id });
        // Back where they lay, out of the next one's way.
        state = putNpc(state, holder.id, world.people.find(p => p.id === holder.id)!.pos);
    }
    return state;
}

/** The drill (no Steady Hands: its jams fixed as they come, then taken back) or thermite at the vault door, worked through. */
function deviceKey(world: ReadonlyWorld, kind: 'drill' | 'thermite'): State {
    const { outside, lock } = vaultSides(world);
    let state = quiet(world, [{ id: 'jun', pos: outside, items: [kind] }]);
    state = run(world, state, kind === 'drill' ? { type: 'drill', crew: 'jun', at: lock.target } : { type: 'thermite', crew: 'jun', door: lock.target });
    const key = kind === 'drill' ? lock.technical : lock.violent;
    const phases = key.kind === 'drill' || key.kind === 'thermite' ? key.phases : 0;
    let turns = 0;
    while (doorStatus(world, state, lock.target) === 'locked' && turns < 60) {
        const r = commit(world, state, { type: 'endTurn' });
        state = r.state;
        turns++;
        if (r.events.some(e => e.type === 'drillJammed')) {
            routes.add('drill jammed');
            state = commit(world, state, { type: 'fixDrill', crew: 'jun', device: state.devices[0]!.id }).state;
        }
    }
    expect(turns).toBe(phases);
    if (kind === 'drill') {
        state = run(world, state, { type: 'takeDrill', crew: 'jun', device: state.devices[0]!.id });
        expect(state.crew[0]!.loadout.items).toEqual(['drill']);
    }
    return state;
}

/** Opens a bank's vault three ways (see the header). */
function openEveryWay(tier: string, bank: ReturnType<typeof cachedBank>): void {
    const world = worldFromBank(bank);
    const { lock } = vaultSides(world);
    expect(lock.social.kind === 'threeKeys').toBe(bank.archetype === 'threeKeys');
    routes.add(`class ${bank.vaultClass}`);

    const social = socialKey(world, tier);
    expect(doorStatus(world, social, lock.target)).toBe('closed');
    walkIn(world, social, 'mara');

    const drilled = deviceKey(world, 'drill');
    expect(doorStatus(world, drilled, lock.target)).toBe('breached');
    walkIn(world, drilled, 'jun');

    const burnt = deviceKey(world, 'thermite');
    expect(doorStatus(world, burnt, lock.target)).toBe('breached');
    walkIn(world, burnt, 'jun');
}

describe('every generated vault opens to each of its three keys (§15.2)', { timeout: 120000 }, () => {
    for (const tier of TIERS) for (const archetype of archetypesFor(tier)) for (const s of SEEDS) {
        it(`${tier} ${archetype} ${s}`, () => openEveryWay(tier, cachedBank({ layout: 3100 + s * 7919, population: s + 11, tier, archetype })));
    }
    it('a Class III vault (the first HQ seed that has one), with its motion sensor', () => {
        const bank = [3, 4, 5, 6, 7, 8, 9, 10].map(s => cachedBank({ layout: 3100 + s * 7919, population: s + 11, tier: 'hq', archetype: 'twoWing' })).find(b => b.vaultClass === 'III');
        expect(bank).toBeDefined();
        openEveryWay('hq', bank!);
        // Opened by its code in the window and left open, the vault is walked into after it: the motion sensor sees that.
        // No patrol car this time: the bodies the test leaves about would be seen from the street and raise the Alarm.
        const world = Object.fromEntries(Object.entries(worldFromBank(bank!)).filter(([k]) => k !== 'patrol')) as unknown as ReadonlyWorld;
        const { outside, lock } = vaultSides(world);
        let state = place(fresh(socialKey(world, 'hq')), 'mara', outside);
        state = run(world, state, { type: 'door', crew: 'mara', door: lock.target, action: 'open' });
        while (timeLockOpen(world, state.turn)) state = commit(world, state, { type: 'endTurn' }).state;
        expect(doorStatus(world, state, lock.target)).toBe('open');
        walkIn(world, state, 'mara');
    });
    it('took every route among them: the PC on small banks, dual control on HQ, Three Keys; Class III; jams', () => {
        for (const r of ['small pc', 'hq dualControl', 'threeKeys', 'class III', 'motion sensor', 'drill jammed']) expect(routes, r).toContain(r);
    });
});

// ---------------------------------------------------------------------------------------------------------- Fixtures

/*
 * An antechamber (x 0–4, room 'a') before a vault (x 5–8, room 'v') behind its door at (4, 2) | (5, 2); the console at
 * (1, 0), the manager's PC at (0, 4), a motion sensor in the vault; a deposit room is another fixture.
 */
const MAP = ['.........', '.........', '.........', '.........', '.........'];
const ZONES = ['xxxxxxxxx', 'xxxxxxxxx', 'xxxxxxxxx', 'xxxxxxxxx', 'xxxxxxxxx'];
const ROOMS = ['aaaaavvvv', 'aaaaavvvv', 'aaaaavvvv', 'aaaaavvvv', 'aaaaavvvv'];
const VAULT_WALLS = Array.from({ length: 5 }, (_, y) => (y === 2
    ? { between: [P(4, y), P(5, y)] as [Pos, Pos], material: 'vault' as const, door: { id: 'vaultDoor', lock: 'vault' as const, start: 'locked' as const } }
    : { between: [P(4, y), P(5, y)] as [Pos, Pos], material: 'vault' as const }));
const OBJECTS: WorldObject[] = [
    { id: 'console', kind: 'vaultConsole', pos: P(1, 0), facing: 's', room: 'a' },
    { id: 'pc', kind: 'managerPc', pos: P(0, 4), facing: 's', room: 'a' },
    { id: 'sensor', kind: 'motionSensor', pos: P(8, 0), facing: 's', room: 'v' }
];
const person = (id: string, role: string, pos: Pos): PersonDef => ({ id, name: id, role, observer: 'staff', pos, facing: 'n', schedule: [] });

function vaultLockDef(extra: Partial<KeyLock> = {}): KeyLock {
    return {
        id: 'vault', name: 'Vault (class III)', target: 'vaultDoor', room: 'v', holders: ['manager'],
        social: { kind: 'code', parts: ['whole'], text: 'code' },
        technical: { kind: 'drill', phases: 3, noise: 6, sensors: ['seismic', 'motion'], text: 'drill' },
        violent: { kind: 'thermite', phases: 2, noise: 6, text: 'thermite' },
        ...extra
    };
}

function vault(crew: CrewStart[], lock: KeyLock = vaultLockDef(), people: PersonDef[] = [person('manager', 'manager', P(0, 1))]): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(MAP, { zones: ZONES, rooms: ROOMS, walls: VAULT_WALLS, objects: OBJECTS, people, locks: [lock] });
    return { world, state: initialState(world, { seed: 3, crew }) };
}

/** A command's preview, which must equal its commit unless it stopped at a roll. */
function same(world: ReadonlyWorld, state: State, cmd: Command): ReturnType<typeof commit> {
    const shown = preview(world, state, cmd), done = commit(world, state, cmd);
    if (!shown.pending) expect(shown.events).toEqual(done.events);
    return done;
}

describe('the console and the manager\'s PC (§15.2)', () => {
    it('the PC tells the whole code after 2 actions of hacking (Steady Hands 1); the console takes it and unlocks the vault', () => {
        const { world, state } = vault([{ id: 'mara', pos: P(0, 3), items: ['hackingKit'] }, { id: 'jun', pos: P(1, 3), items: ['hackingKit'], traits: ['steadyHands'] }]);
        expect(whyNot(world, state, { type: 'interact', crew: 'mara', object: 'console', verb: 'unlock' })).toBe("mara can't reach the vaultConsole");
        const one = same(world, state, { type: 'interact', crew: 'mara', object: 'pc', verb: 'hack' });
        expect(one.events).toContainEqual({ type: 'lockWorked', crew: 'mara', at: 'pc', progress: 1, needed: 2 });
        expect(one.state.codesKnown).toEqual([]);
        const two = same(world, one.state, { type: 'interact', crew: 'mara', object: 'pc', verb: 'hack' });
        expect(two.events).toContainEqual({ type: 'pcHacked', crew: 'mara', object: 'pc', part: 'whole', window: null });
        expect(two.state.codesKnown).toEqual(['whole']);
        expect(whyNot(world, two.state, { type: 'interact', crew: 'jun', object: 'pc', verb: 'hack' })).toBe('The PC has told all it knows');
        // Jun alone does it in one action.
        expect(same(world, state, { type: 'interact', crew: 'jun', object: 'pc', verb: 'hack' }).state.codesKnown).toEqual(['whole']);
        const at = place(fresh(two.state), 'mara', P(1, 1));
        const r = same(world, at, { type: 'interact', crew: 'mara', object: 'console', verb: 'unlock' });
        expect(r.events).toContainEqual({ type: 'codeEntered', crew: 'mara', npc: null, console: 'console', part: 'whole' });
        expect(r.events).toContainEqual({ type: 'vaultUnlocked', door: 'vaultDoor', how: 'code', by: 'mara' });
        expect(doorStatus(world, r.state, 'vaultDoor')).toBe('closed');
        expect(r.undoable).toBe(true);
    });

    it('dual control takes both halves; the PC gives only the manager\'s', () => {
        const lock = vaultLockDef({ social: { kind: 'code', parts: ['headTeller', 'manager'], text: 'dual' }, holders: ['manager', 'head'] });
        const { world, state } = vault([{ id: 'mara', pos: P(0, 3), items: ['hackingKit', 'pistol'] }], lock, [person('manager', 'manager', P(3, 4)), person('head', 'headTeller', P(2, 1))]);
        let s = run(world, state, { type: 'interact', crew: 'mara', object: 'pc', verb: 'hack' }, { type: 'interact', crew: 'mara', object: 'pc', verb: 'hack' });
        expect(s.codesKnown).toEqual(['manager']);
        s = run(world, place(s, 'mara', P(1, 1)), { type: 'interact', crew: 'mara', object: 'console', verb: 'unlock' });
        expect(doorStatus(world, s, 'vaultDoor')).toBe('locked');
        expect(whyNot(world, fresh(s), { type: 'interact', crew: 'mara', object: 'console', verb: 'unlock' })).toBe('Every part of the code the crew knows is in');
        // The head teller, face down beside the console, enters her half: the vault unlocks.
        s = run(world, s, { type: 'command', crew: 'mara' });
        expect(s.npcs.find(n => n.id === 'head')!.status).toBe('commanded');
        const r = commit(world, fresh(s), { type: 'coerce', crew: 'mara', npc: 'head', at: 'console' });
        expect(r.events).toContainEqual({ type: 'codeEntered', crew: 'mara', npc: 'head', console: 'console', part: 'headTeller' });
        expect(doorStatus(world, r.state, 'vaultDoor')).toBe('closed');
    });

    it('the time lock: codes only in the window, where they open the vault; a shut vault locks again outside it', () => {
        const lock = vaultLockDef({ timeLock: { from: 3, until: 5 } });
        const { world, state } = vault([{ id: 'mara', pos: P(1, 1), items: ['pistol'] }], lock);
        const down = run(world, state, { type: 'command', crew: 'mara' });
        const coerce: Command = { type: 'coerce', crew: 'mara', npc: 'manager', at: 'console' };
        expect(whyNot(world, fresh(down), coerce)).toBe('The time lock holds the vault shut until turn 3');
        const tied = (s: State): State => ({ ...s, npcs: s.npcs.map(n => ({ ...n, status: 'tied' as const, command: null })) });
        const three = run(world, tied(down), { type: 'endTurn' }, { type: 'endTurn' });
        // The window doesn't open the vault: the code does.
        expect(doorStatus(world, three, 'vaultDoor')).toBe('locked');
        const r = commit(world, three, coerce);
        expect(r.events).toContainEqual({ type: 'vaultUnlocked', door: 'vaultDoor', how: 'code', by: 'mara' });
        // Left shut, it locks again as the first crew phase after the window begins.
        const five = run(world, r.state, { type: 'endTurn' }, { type: 'endTurn' });
        expect(doorStatus(world, five, 'vaultDoor')).toBe('locked');
        expect(whyNot(world, fresh(five), coerce)).toBe('The time lock holds the vault shut for the day');
        // Opened in the window and shut after it, it locks again as the next crew phase begins.
        const opened = run(world, place(r.state, 'mara', P(4, 2)), { type: 'door', crew: 'mara', door: 'vaultDoor', action: 'open' });
        const later = run(world, opened, { type: 'endTurn' }, { type: 'endTurn' }, { type: 'endTurn' });
        expect(doorStatus(world, later, 'vaultDoor')).toBe('open');
        const shut = run(world, later, { type: 'door', crew: 'mara', door: 'vaultDoor', action: 'close' });
        expect(doorStatus(world, shut, 'vaultDoor')).toBe('closed');
        const next = commit(world, shut, { type: 'endTurn' });
        expect(next.events).toContainEqual({ type: 'timeLockShut', door: 'vaultDoor' });
        expect(doorStatus(world, next.state, 'vaultDoor')).toBe('locked');
    });

    it('Three Keys: the manager\'s card at the console, in the window, while the crew holds the CCTV room', () => {
        const lock = vaultLockDef({ social: { kind: 'threeKeys', keycard: ['manager'], text: 'three' }, timeLock: { from: 1, until: 9 } });
        const desk: WorldObject = { id: 'desk', kind: 'cctvDesk', pos: P(3, 4), facing: 's', room: 'a', monitors: 1 };
        const world = fixtureWorld(MAP, { zones: ZONES, rooms: ROOMS, walls: VAULT_WALLS, objects: [...OBJECTS, desk], locks: [lock],
            people: [person('manager', 'manager', P(0, 1)), person('op', 'operator', P(3, 3))] });
        let state = initialState(world, { seed: 3, crew: [{ id: 'jun', pos: P(1, 1) }, { id: 'mara', pos: P(2, 4) }] });
        // A Three Keys vault doesn't open itself in its window.
        expect(doorStatus(world, state, 'vaultDoor')).toBe('locked');
        const unlock: Command = { type: 'interact', crew: 'jun', object: 'console', verb: 'unlock' };
        expect(whyNot(world, state, unlock)).toBe('jun has no keycard that opens the vault');
        state = { ...state, crew: state.crew.map(c => (c.id === 'jun' ? { ...c, keycards: ['manager'] } : c)) };
        expect(whyNot(world, state, unlock)).toBe('The vault answers only while the crew holds the CCTV room');
        state = { ...state, npcs: state.npcs.map(n => (n.id === 'op' ? { ...n, status: 'tied' as const } : n)) };
        const r = same(world, state, unlock);
        expect(r.events).toContainEqual({ type: 'vaultUnlocked', door: 'vaultDoor', how: 'keycard', by: 'jun' });
    });
});

describe('the drill and thermite (§15.3)', () => {
    it('drills through in its phases, a loud noise each; jams are rolled with their odds shown and fixed in 1 action', () => {
        const { world, state } = vault([{ id: 'jun', pos: P(4, 2), items: ['drill'] }], vaultLockDef({ technical: { kind: 'drill', phases: 6, noise: 6, sensors: [], text: 'drill' } }), []);
        const set = same(world, state, { type: 'drill', crew: 'jun', at: 'vaultDoor' });
        expect(set.state.devices).toEqual([{ id: 'drill-1', kind: 'drill', at: 'vaultDoor', pos: P(4, 2), crew: 'jun', done: 0, needed: 6, jammed: false, noise: 6 }]);
        expect(set.state.crew[0]!.loadout.items).toEqual([]);
        // The end of the turn: the drill works a phase, then the jam is rolled as the crew phase begins.
        const shown = preview(world, set.state, { type: 'endTurn' });
        expect(shown.pending).toEqual({ stream: 'drill', p: 0.15, reason: 'jam drill-1' });
        expect(shown.events).toContainEqual(expect.objectContaining({ type: 'noise', kind: 'loud', radius: 6 }));
        let s = set.state, jams = 0, turns = 0;
        while (doorStatus(world, s, 'vaultDoor') !== 'breached' && turns < 60) {
            const before = s, r = commit(world, s, { type: 'endTurn' });
            turns++;
            s = r.state;
            if (r.events.some(e => e.type === 'drillJammed')) {
                jams++;
                // A jam stops a Wait or a Go (auto-advance), where the drill stands.
                expect(interruptsOf(world, before, r)).toContainEqual({ kind: 'jam', text: 'the drill jammed', at: P(4, 2) });
                expect(whyNot(world, s, { type: 'fixDrill', crew: 'jun', device: 'drill-1' })).toBeUndefined();
                s = commit(world, s, { type: 'fixDrill', crew: 'jun', device: 'drill-1' }).state;
                expect(s.devices[0]!.jammed).toBe(false);
            }
        }
        // Fixed at once, a jam costs an action, not a phase.
        expect(doorStatus(world, s, 'vaultDoor')).toBe('breached');
        expect(turns).toBe(6);
        // The drill stays at the door until taken back into the kit.
        expect(s.devices.map(d => d.id)).toEqual(['drill-1']);
        s = run(world, s, { type: 'takeDrill', crew: 'jun', device: 'drill-1' });
        expect(s.devices).toEqual([]);
        expect(s.crew[0]!.loadout.items).toEqual(['drill']);
        expect(s.dice.filter(d => d.reason === 'jam drill-1').filter(d => d.value < 0.15).length).toBe(jams);
    });

    it('a jam stops a Wait or a Go where the drill stands, and a jammed drill keeps one from starting', () => {
        const { world, state } = vault([{ id: 'jun', pos: P(4, 2), items: ['drill'] }], vaultLockDef({ technical: { kind: 'drill', phases: 6, noise: 6, sensors: [], text: 'drill' } }), []);
        const set = same(world, state, { type: 'drill', crew: 'jun', at: 'vaultDoor' }).state;
        const jammed = { ...set, devices: set.devices.map(d => ({ ...d, jammed: true })) };
        expect(interruptsOf(world, set, { state: jammed, events: [{ type: 'drillJammed', device: 'drill-1' }] }))
            .toContainEqual({ kind: 'jam', text: 'the drill jammed', at: P(4, 2) });
        // Already jammed: a Wait or a Go won't start.
        expect(autoAdvanceBlocked(world, jammed)).toBe('The drill is jammed');
    });

    it('Steady Hands beside a drill keeps it from jamming and fixes a jam for free', () => {
        const { world, state } = vault([{ id: 'jun', pos: P(4, 2), items: ['drill'], traits: ['steadyHands'] }]);
        const set = run(world, state, { type: 'drill', crew: 'jun', at: 'vaultDoor' });
        expect(preview(world, set, { type: 'endTurn' }).pending).toBeUndefined();
        const jammed = { ...set, devices: set.devices.map(d => ({ ...d, jammed: true })) };
        const r = commit(world, jammed, { type: 'endTurn' });
        expect(r.events).toContainEqual({ type: 'drillFixed', device: 'drill-1', crew: 'jun', free: true });
    });

    it('starts the seismic sensor on a Class II+ vault as it starts, shown in its preview; thermite too, and it never jams', () => {
        const { world, state } = vault([{ id: 'jun', pos: P(4, 2), items: ['thermite'] }]);
        const shown = actionPreview(world, state, { type: 'thermite', crew: 'jun', door: 'vaultDoor' });
        expect(shown.ok && shown.carriers.starts.map(c => [c.kind, c.countdown])).toEqual([['seismicSensor', 4]]);
        const set = same(world, state, { type: 'thermite', crew: 'jun', door: 'vaultDoor' });
        expect(set.state.carriers.map(c => c.kind)).toEqual(['seismicSensor']);
        expect(preview(world, set.state, { type: 'endTurn' }).pending).toBeUndefined();
        const done = run(world, set.state, { type: 'endTurn' }, { type: 'endTurn' });
        expect(doorStatus(world, done, 'vaultDoor')).toBe('breached');
    });

    it('each sensor carrier has at least two counters that work in its countdown: the panel, the console\'s wiring, the window', () => {
        for (const kind of ['seismicSensor', 'motionSensor'] as const) expect(CARRIERS[kind].counters.filter(c => c.now === true).length, kind).toBeGreaterThanOrEqual(2);
        const panel: WorldObject = { id: 'panel', kind: 'alarmPanel', pos: P(0, 2), facing: 's', room: 'a' };
        const world = fixtureWorld(MAP, { zones: ZONES, rooms: ROOMS, walls: VAULT_WALLS, objects: [...OBJECTS, panel], locks: [vaultLockDef({ timeLock: { from: 3, until: 6 } })] });
        const crew: CrewStart[] = [{ id: 'jun', pos: P(4, 2), items: ['thermite'] }, { id: 'mara', pos: P(1, 1), items: ['hackingKit'] }, { id: 'kit', pos: P(2, 1), items: ['hackingKit'] }];
        const burning = run(world, initialState(world, { seed: 3, crew }), { type: 'thermite', crew: 'jun', door: 'vaultDoor' });
        expect(burning.carriers.map(c => c.kind)).toEqual(['seismicSensor']);
        // The wiring at the console: 4 actions of hacking (two crew members, one crew phase), the carrier stopped.
        const cut: Command = { type: 'interact', crew: 'mara', object: 'console', verb: 'sensors' }, cut2: Command = { ...cut, crew: 'kit' };
        let s = run(world, burning, cut, cut, cut2);
        expect(s.carriers.length).toBe(1);
        const done = commit(world, fresh(s), cut2);
        expect(done.events).toContainEqual({ type: 'sensorsCut', crew: 'kit', console: 'console' });
        expect(done.events).toContainEqual(expect.objectContaining({ type: 'carrierStopped', kind: 'seismicSensor', why: 'sensors cut' }));
        // Cut, nothing starts them again: stepping into the vault starts no motion carrier.
        s = scouted(world, { ...done.state, doors: { ...done.state.doors, vaultDoor: { status: 'breached' as const } } });
        expect(commit(world, place(fresh(s), 'jun', P(4, 2)), { type: 'move', crew: 'jun', path: [P(5, 2)] }).state.carriers).toEqual([]);
        // The panel, killed in the countdown, counters it too.
        const panelled = run(world, { ...burning, crew: burning.crew.map(c => (c.id === 'mara' ? { ...c, pos: P(1, 2) } : c)) }, ...Array.from({ length: 4 }, () => ({ type: 'interact', crew: 'mara', object: 'panel', verb: 'disable' }) as Command));
        expect(panelled.carriers).toEqual([]);
        // The motion sensor's carrier stops once the time-lock window opens.
        const inside = scouted(world, { ...initialState(world, { seed: 3, crew }), turn: 2, doors: { vaultDoor: { status: 'breached' as const } } });
        const seen = commit(world, place(inside, 'jun', P(4, 2)), { type: 'move', crew: 'jun', path: [P(5, 2)] });
        expect(seen.state.carriers.map(c => c.kind)).toEqual(['motionSensor']);
        const opens = commit(world, seen.state, { type: 'endTurn' });
        expect(opens.state.turn).toBe(3);
        expect(opens.events).toContainEqual(expect.objectContaining({ type: 'carrierStopped', kind: 'motionSensor', why: 'time lock' }));
    });

    it('a motion sensor in a Class III vault starts its carrier as the crew steps in, outside the time-lock window', () => {
        const { world, state } = vault([{ id: 'jun', pos: P(4, 2) }]);
        const open = scouted(world, { ...state, doors: { ...state.doors, vaultDoor: { status: 'breached' as const } } });
        const r = same(world, open, { type: 'move', crew: 'jun', path: [P(5, 2)] });
        expect(r.state.carriers).toEqual([expect.objectContaining({ kind: 'motionSensor', source: 'sensor', countdown: 2 })]);
        const windowed = vault([{ id: 'jun', pos: P(4, 2) }], vaultLockDef({ timeLock: { from: 1, until: 3 } }));
        const calm = commit(windowed.world, scouted(windowed.world, { ...windowed.state, doors: { ...windowed.state.doors, vaultDoor: { status: 'breached' as const } } }), { type: 'move', crew: 'jun', path: [P(5, 2)] });
        expect(calm.state.carriers).toEqual([]);
    });

    it('refuses what it can\'t do: no kit, not beside the door, an unlocked vault, a second device', () => {
        const { world, state } = vault([{ id: 'jun', pos: P(3, 2), items: ['drill', 'thermite'] }]);
        expect(whyNot(world, state, { type: 'drill', crew: 'jun', at: 'vaultDoor' })).toBe('jun isn\'t beside the vault door');
        const at = place(state, 'jun', P(4, 2));
        expect(legalActions(world, at, 'jun')).toEqual(expect.arrayContaining([{ type: 'drill', crew: 'jun', at: 'vaultDoor' }, { type: 'thermite', crew: 'jun', door: 'vaultDoor' }]));
        const drilling = run(world, at, { type: 'drill', crew: 'jun', at: 'vaultDoor' });
        expect(whyNot(world, fresh(drilling), { type: 'thermite', crew: 'jun', door: 'vaultDoor' })).toBe('Something is already at work on the door');
        expect(whyNot(world, fresh(drilling), { type: 'drill', crew: 'jun', at: 'vaultDoor' })).toBe('jun has no drill');
    });
});

// ---------------------------------------------------------------------------------------------------------- Doors and boxes

describe('card readers, lockpicks and the key graph\'s cards (§15.2, §7.2)', () => {
    // A staff room (x 0–3) with a mechanical door to the corridor (x 4–8) and a keycard door to the CCTV room (x 5–8, y 3–4).
    const map = ['.........', '.........', '.........', '.........', '.........'];
    const rooms = ['ssssccccc', 'ssssccccc', 'ssssccccc', 'ssssctttt', 'ssssctttt'];
    const walls = [
        ...Array.from({ length: 5 }, (_, y) => (y === 1 ? { between: [P(3, y), P(4, y)] as [Pos, Pos], door: { id: 'office', lock: 'mechanical' as const, start: 'locked' as const } } : { between: [P(3, y), P(4, y)] as [Pos, Pos] })),
        ...Array.from({ length: 4 }, (_, i) => (i === 1 ? { between: [P(5 + i, 2), P(5 + i, 3)] as [Pos, Pos], door: { id: 'cctvDoor', lock: 'keycard' as const, start: 'locked' as const } } : { between: [P(5 + i, 2), P(5 + i, 3)] as [Pos, Pos] })),
        { between: [P(4, 3), P(5, 3)] as [Pos, Pos] }, { between: [P(4, 4), P(5, 4)] as [Pos, Pos] }
    ];
    const cctv: KeyLock = {
        id: 'cctv', name: 'CCTV room door', target: 'cctvDoor', room: 't', holders: ['guard'],
        social: { kind: 'keycard', holders: ['guard'], text: '' }, technical: { kind: 'reader', actions: 2, text: '' }, violent: { kind: 'breach', tool: 'shotgun', text: '' }
    };
    const setup = (crew: CrewStart[]) => {
        const world = fixtureWorld(map, { zones: ZONES, rooms, walls, locks: [cctv] });
        return { world, state: initialState(world, { seed: 1, crew }) };
    };

    it('a card opens a door the key graph names only if its holder holds the social key; any card opens the rest', () => {
        const { world, state } = setup([{ id: 'jun', pos: P(6, 2) }, { id: 'mara', pos: P(3, 1) }]);
        const teller = { ...state, crew: state.crew.map(c => ({ ...c, keycards: ['teller'] })) };
        expect(whyNot(world, teller, { type: 'door', crew: 'jun', door: 'cctvDoor', action: 'open' })).toBe('The door is locked');
        expect(whyNot(world, teller, { type: 'door', crew: 'mara', door: 'office', action: 'open' })).toBeUndefined();
        const guard = { ...state, crew: state.crew.map(c => ({ ...c, keycards: ['guard'] })) };
        expect(whyNot(world, guard, { type: 'door', crew: 'jun', door: 'cctvDoor', action: 'open' })).toBeUndefined();
    });

    it('NPCs pass a door the key graph names only on a holder\'s card, as the crew does; the mantrap\'s staff are buzzed through', () => {
        const { world } = setup([]);
        const door = world.doors.cctvDoor!;
        const staff = (id: string): PersonDef => ({ id, name: id, role: id, observer: 'staff', pos: P(0, 0), facing: 's', schedule: [] });
        expect(npcCanPass(world, staff('teller'))(door, 'locked')).toBe(false);
        expect(npcCanPass(world, { ...staff('guard'), observer: 'enforcer' })(door, 'locked')).toBe(true);
        const mantrap: KeyLock = { ...cctv, id: 'mantrap', social: { kind: 'buzz', holders: ['op'], text: '' } };
        const buzzed = fixtureWorld(map, { zones: ZONES, rooms, walls, locks: [mantrap] });
        expect(npcCanPass(buzzed, staff('teller'))(door, 'locked')).toBe(true);
    });

    it('hacks a card reader in 2 actions (Steady Hands 1) and picks a mechanical lock, each an illegal act and a quiet noise', () => {
        const { world, state } = setup([{ id: 'jun', pos: P(6, 2), items: ['hackingKit'] }, { id: 'mara', pos: P(3, 1), items: ['lockpick'], traits: ['steadyHands'] }]);
        expect(whyNot(world, state, { type: 'door', crew: 'jun', door: 'cctvDoor', action: 'pick' })).toBe('Only a mechanical lock can be picked');
        const one = same(world, state, { type: 'door', crew: 'jun', door: 'cctvDoor', action: 'hack' });
        expect(one.events).toContainEqual({ type: 'doorWorked', crew: 'jun', door: 'cctvDoor', progress: 1, needed: 2 });
        expect(one.events).toContainEqual(expect.objectContaining({ type: 'noise', kind: 'quiet', radius: 1 }));
        expect(doorStatus(world, one.state, 'cctvDoor')).toBe('locked');
        const two = same(world, one.state, { type: 'door', crew: 'jun', door: 'cctvDoor', action: 'hack' });
        expect(two.events).toContainEqual({ type: 'doorUnlocked', door: 'cctvDoor', by: 'jun' });
        expect(two.state.doors.cctvDoor).toEqual({ status: 'closed' });
        const picked = same(world, state, { type: 'door', crew: 'mara', door: 'office', action: 'pick' });
        expect(doorStatus(world, picked.state, 'office')).toBe('closed');
    });

    it('waits on the mantrap\'s reader until its camera is looped', () => {
        const mantrap: KeyLock = { ...cctv, id: 'mantrap', technical: { kind: 'loopedReader', actions: 2, text: '' } };
        const world = fixtureWorld(map, { zones: ZONES, rooms, walls, locks: [mantrap], cameras: [{ id: 'cam', pos: P(7, 4), facings: ['n'], room: 't' }] });
        const state = initialState(world, { seed: 1, crew: [{ id: 'jun', pos: P(6, 2), items: ['hackingKit'] }] });
        expect(whyNot(world, state, { type: 'door', crew: 'jun', door: 'cctvDoor', action: 'hack' })).toBe('Loop the camera watching the reader first');
        const looped = { ...state, cameras: { ...state.cameras, cam: { ...state.cameras.cam!, loopedUntil: 4 } } };
        expect(whyNot(world, looped, { type: 'door', crew: 'jun', door: 'cctvDoor', action: 'hack' })).toBeUndefined();
    });
});

describe('deposit boxes (§15.3)', () => {
    const rooms = ['ddddd', 'ddddd', 'ddddd'];
    const objects: WorldObject[] = [
        { id: 'wall', kind: 'depositBoxes', pos: P(2, 0), facing: 's', room: 'd' },
        { id: 'haul', kind: 'loot', pos: P(4, 0), facing: 's', room: 'd', name: 'Deposit-box haul', loot: { value: 10000, weight: 'heavy', behind: 'depositWall' } },
        { id: 'box-a', kind: 'loot', pos: P(4, 0), facing: 's', room: 'd', name: 'Deposit box', loot: { value: 5000, weight: 'light', behind: 'depositBox' } },
        { id: 'box-b', kind: 'loot', pos: P(4, 0), facing: 's', room: 'd', name: 'Deposit box', loot: { value: 5000, weight: 'light', behind: 'depositBox' } }
    ];
    const setup = (crew: CrewStart[]) => {
        const world = fixtureWorld(['.....', '.....', '.....'], { zones: ['xxxxx', 'xxxxx', 'xxxxx'], rooms, objects, rules: { depositWallPhases: 2 } });
        return { world, state: initialState(world, { seed: 1, crew }) };
    };

    it('picks one box at a time (2 actions, Steady Hands 1): its jewels lie there to take, Light; then the wall can\'t be drilled', () => {
        const { world, state } = setup([{ id: 'mara', pos: P(2, 1), items: ['lockpick', 'drill'], traits: ['steadyHands'] }]);
        expect(Object.keys(state.loot)).toEqual([]);
        const r = same(world, state, { type: 'interact', crew: 'mara', object: 'wall', verb: 'pick' });
        expect(r.events).toContainEqual({ type: 'boxOpened', crew: 'mara', object: 'wall', loot: 'box-a' });
        expect(r.state.loot['box-a']).toMatchObject({ holder: null, pos: P(2, 0), taken: false });
        const took = commit(world, r.state, { type: 'takeLoot', crew: 'mara', loot: 'box-a' });
        expect(took.state.loot['box-a']!.holder).toBe('mara');
        expect(took.state.crew[0]!.loadout.carrying).toBeNull();
        expect(whyNot(world, fresh(r.state), { type: 'drill', crew: 'mara', at: 'wall' })).toBe('Boxes are open: pick the rest');
        const both = run(world, r.state, { type: 'interact', crew: 'mara', object: 'wall', verb: 'pick' });
        expect(whyNot(world, fresh(both), { type: 'interact', crew: 'mara', object: 'wall', verb: 'pick' })).toBe('Every box here is open');
    });

    it('drills the whole wall for the haul, Heavy; boxes can\'t be picked meanwhile or after', () => {
        const { world, state } = setup([{ id: 'mara', pos: P(2, 1), items: ['lockpick', 'drill'], traits: ['steadyHands'] }]);
        const set = run(world, state, { type: 'drill', crew: 'mara', at: 'wall' });
        expect(whyNot(world, fresh(set), { type: 'interact', crew: 'mara', object: 'wall', verb: 'pick' })).toBe('A drill is on the wall');
        const done = clonePlain(run(world, set, { type: 'endTurn' }, { type: 'endTurn' }));
        expect(done.loot.haul).toMatchObject({ holder: null, taken: false, pos: P(2, 0) });
        expect(whyNot(world, fresh(done), { type: 'interact', crew: 'mara', object: 'wall', verb: 'pick' })).toBe('The wall is drilled open');
        expect(commit(world, fresh(done), { type: 'takeLoot', crew: 'mara', loot: 'haul' }).state.crew[0]!.loadout.carrying).toBe('lootBag');
    });
});
