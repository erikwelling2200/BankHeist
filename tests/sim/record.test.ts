import { describe, expect, it } from 'vitest';
import {
    clonePlain, creditKill, filmedCrew, fixtureWorld, freezeWorld, hashOf, heistReport, initialState, preview, stylesEarned, witnessedCrew, type Command, type CrewStart, type Facing,
    type FixtureOptions, type ObserverClass, type PersonDef, type Pos, type ReadonlyWorld, type State, type World, type WorldObject
} from '../../src/sim';
import { registerTestCommand, scouted, step, testCommand } from './helpers';

/*
 * M6-05: the heist's record for the debrief (rules/record.ts): witnesses, the way in, Inside Job, escapees, missed
 * check-ins, assaults held, kills, and the styles of §19.8 read from them.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const person = (id: string, role: string, observer: ObserverClass, pos: Pos, facing: Facing): PersonDef =>
    ({ id, name: id, role, observer, pos, facing, schedule: [] });
const obj = (id: string, kind: string, pos: Pos, extra: Partial<WorldObject> = {}): WorldObject => ({ id, kind, pos, facing: 's', ...extra });

registerTestCommand('recLeave', (ctx, cmd) => {
    const npc = ctx.state.npcs.find(n => n.id === (cmd as unknown as { npc: string }).npc)!;
    npc.status = 'away';
    ctx.emit({ type: 'npcLeft', npc: npc.id, at: { ...npc.pos } });
});
registerTestCommand('recKill', (ctx, cmd) => creditKill(ctx.state, (cmd as unknown as { crew: string }).crew));
// The director's mode changing (rules/police.ts), and a check-in missed (rules/checkins.ts), as one command each.
registerTestCommand('recMode', (ctx, cmd) => {
    const kind = (cmd as unknown as { mode: 'assault' | 'regroup' }).mode;
    ctx.state.police.mode = { kind, left: 2, since: { turn: ctx.state.turn, phase: 'crew' }, after: null };
});
registerTestCommand('recMissed', ctx => ctx.emit({ type: 'checkInMissed', guard: 'guard', missed: 1 }));
const mode = (m: 'assault' | 'regroup'): Command => testCommand({ type: 'recMode', mode: m } as never);
const leave = (npc: string): Command => testCommand({ type: 'recLeave', npc } as never);
const killBy = (crew: string): Command => testCommand({ type: 'recKill', crew } as never);

function setup(map: readonly string[], people: PersonDef[], crew: CrewStart[], options: FixtureOptions = {}): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(map, { people, ...options });
    return { world, state: scouted(world, initialState(world, { seed: 3, crew })) };
}

/** Commits and checks that the preview said exactly the same, the record with it. */
function act(world: ReadonlyWorld, state: State, cmd: Command) {
    const seen = preview(world, state, cmd);
    const done = step(world, state, cmd);
    expect(hashOf(seen.state)).toBe(hashOf(done.state));
    return done;
}

// A customer and a teller in a lobby; Jun beside the customer, Mara masked beside the teller.
const lobby = (junMasked = false) => setup(
    ['........', '........', '........'],
    [person('cust', 'customer', 'civilian', P(2, 1), 'w'), person('teller', 'teller', 'staff', P(6, 1), 'w')],
    [{ id: 'jun', pos: P(3, 1), masked: junMasked }, { id: 'mara', pos: P(5, 2), masked: true }]
);

describe('witnesses (§19.7)', () => {
    it('notes who saw an unmasked crew member commit an illegal act, and counts those who lived', () => {
        const { world, state } = lobby();
        const ko = act(world, state, { type: 'knockout', crew: 'jun', npc: 'cust' });
        expect(ko.state.record.witnesses).toEqual([{ npc: 'teller', crew: 'jun' }]);
        expect(witnessedCrew(ko.state)).toEqual(['jun']);
        // A witness who didn't live tells nobody.
        const dead = clonePlain(ko.state);
        dead.npcs.find(n => n.id === 'teller')!.status = 'dead';
        expect(witnessedCrew(dead)).toEqual([]);
        // Tied up or out cold, they still testify at the debrief.
        const tied = clonePlain(ko.state);
        tied.npcs.find(n => n.id === 'teller')!.status = 'tied';
        expect(witnessedCrew(tied)).toEqual(['jun']);
    });

    it('notes nobody when the crew member was masked', () => {
        const { world, state } = lobby(true);
        const ko = act(world, state, { type: 'knockout', crew: 'jun', npc: 'cust' });
        expect(ko.state.record.witnesses).toEqual([]);
        expect(heistReport(world, ko.state)).toMatchObject({ witnessed: [], filmed: [] });
    });

    it('reports the footage the recorder kept', () => {
        const { world, state } = setup(
            ['......', '......', '......'],
            [person('cust', 'customer', 'civilian', P(2, 2), 'w')],
            [{ id: 'jun', pos: P(3, 2) }],
            { cameras: [{ id: 'cam', pos: P(0, 0), facings: ['se'], room: null }], objects: [obj('desk', 'cctvDesk', P(5, 0), { monitors: 1 }), obj('rec', 'recorder', P(5, 0))] }
        );
        const ko = act(world, state, { type: 'knockout', crew: 'jun', npc: 'cust' });
        expect(heistReport(world, ko.state).filmed).toEqual(filmedCrew(world, ko.state));
        expect(heistReport(world, ko.state).filmed).toEqual(['jun']);
    });
});

// A building (room 'b', rows 0–1) with a wall along its front, a door at x 1 and a hole blown at x 4; the street below.
function front(gap: boolean, extra: FixtureOptions = {}) {
    const walls = Array.from({ length: 6 }, (_, x) => ({
        between: [P(x, 1), P(x, 2)] as [Pos, Pos], material: 'soft' as const, ...(x === 1 ? { door: { id: 'front' } } : {})
    }));
    const built = setup(['......', '......', '......', '......'], [], [{ id: 'jun', pos: P(1, 3), masked: true }, { id: 'mara', pos: P(4, 3) }],
        { rooms: ['bbbbbb', 'bbbbbb', '......', '......'], walls, ...extra });
    if (gap) built.state.edges['eastWest 4 2'] = { blocksMove: false, blocksSight: false, blocksSound: false, midHeight: false, gap: true } as never;
    return built;
}

describe('the way in and Inside Job (§19.8)', () => {
    it('Cowboys: the first crew member in came through a hole in the wall', () => {
        const { world, state } = front(true);
        const inThrough = act(world, state, { type: 'move', crew: 'mara', path: [P(4, 2), P(4, 1)] });
        expect(inThrough.state.record.wayIn).toBe('breach');
        expect(stylesEarned(world, inThrough.state)).toContain('cowboys');
        // Through the door first, the hole later: not Cowboys.
        const door = act(world, state, { type: 'move', crew: 'jun', path: [P(1, 2), P(1, 1)] });
        expect(door.state.record.wayIn).toBe('door');
        const after = act(world, door.state, { type: 'move', crew: 'mara', path: [P(4, 2), P(4, 1)] });
        expect(after.state.record.wayIn).toBe('door');
        expect(stylesEarned(world, after.state)).not.toContain('cowboys');
    });

    it('Inside Job: the panel dead before the first Heavy crew member stands inside, decided then', () => {
        const panel = { objects: [obj('panel', 'alarmPanel', P(5, 0))] };
        const { world, state } = front(false, panel);
        // Masked Jun walks in with the panel live: never Inside Job, even once it is disabled.
        const early = act(world, state, { type: 'move', crew: 'jun', path: [P(1, 2), P(1, 1)] });
        expect(early.state.record.insideJob).toBe(false);
        const late = clonePlain(early.state);
        late.objects.panel = { disabled: true };
        expect(stylesEarned(world, late)).not.toContain('insideJob');
        // The panel dead first (Mara, Clean, inside already did it): Jun walking in masked earns it.
        const off = clonePlain(state);
        off.objects.panel = { disabled: true };
        const walked = act(world, off, { type: 'move', crew: 'jun', path: [P(1, 2), P(1, 1)] });
        expect(walked.state.record.insideJob).toBe(true);
        expect(stylesEarned(world, walked.state)).toContain('insideJob');
        // No Heavy crew member ever inside: the panel's state at the end decides.
        expect(stylesEarned(world, off)).toContain('insideJob');
        expect(stylesEarned(world, state)).not.toContain('insideJob');
    });
});

describe('the styles (§19.8)', () => {
    const base = () => lobby();

    it('a quiet start has Ghost, Clean Hands and Smooth Operator, and loses each to what breaks it', () => {
        const { world, state } = base();
        expect(stylesEarned(world, state)).toEqual(['ghost', 'cleanHands', 'smoothOperator']);
        const alarm = clonePlain(state);
        alarm.bank.alarm = true;
        expect(stylesEarned(world, alarm)).not.toContain('ghost');
        const dead = clonePlain(state);
        dead.npcs[0]!.status = 'dead';
        expect(stylesEarned(world, dead)).not.toContain('cleanHands');
        const officer = clonePlain(state);
        officer.heat.policeKilled = 1;
        expect(stylesEarned(world, officer)).not.toContain('cleanHands');
        const crewDead = clonePlain(state);
        crewDead.crew[0]!.wounds.dead = true;
        expect(stylesEarned(world, crewDead)).not.toContain('cleanHands');
        const missed = clonePlain(state);
        missed.record.missed = 1;
        expect(stylesEarned(world, missed)).not.toContain('smoothOperator');
    });

    it('an NPC running off the map is an escapee; one leaving calmly is not', () => {
        const { world, state } = base();
        expect(act(world, state, leave('cust')).state.record.escapees).toEqual([]);
        const fleeing = clonePlain(state);
        fleeing.npcs[0]!.lapse = { kind: 'flee', exit: P(0, 1) };
        const ran = act(world, fleeing, leave('cust')).state;
        expect(ran.record.escapees).toEqual(['cust']);
        expect(stylesEarned(world, ran)).not.toContain('smoothOperator');
    });

    it('Fortress counts assaults run to their end with crew still up; a missed check-in loses Smooth Operator', () => {
        const { world, state } = base();
        let s = act(world, act(world, state, mode('assault')).state, mode('regroup')).state;
        expect(s.record.assaultsHeld).toBe(1);
        s = act(world, act(world, s, mode('assault')).state, mode('regroup')).state;
        expect(stylesEarned(world, s)).toContain('fortress');
        // An assault ending with every crew member down holds nothing.
        const down = clonePlain(act(world, state, mode('assault')).state);
        for (const c of down.crew) c.wounds.downed = { left: 3, turn: 1, phase: 'world' };
        expect(act(world, down, mode('regroup')).state.record.assaultsHeld).toBe(0);
        const missed = act(world, state, testCommand({ type: 'recMissed' } as never)).state;
        expect(missed.record.missed).toBe(1);
        expect(stylesEarned(world, missed)).not.toContain('smoothOperator');
    });

    it('Greedy at twice the target out; Fortress after two assaults held', () => {
        const world = freezeWorld({ ...(clonePlain(base().world) as World), rules: { ...base().world.rules, contractTarget: 1000 } });
        const s = clonePlain(base().state);
        s.outcome = { result: 'success', turn: 3, vehicle: 'van', escaped: ['jun'], arrested: [], dead: [], loot: [], value: 1999, ruined: 0, target: 1000, heat: 0 };
        expect(stylesEarned(world, s)).not.toContain('greedy');
        s.outcome.value = 2000;
        expect(stylesEarned(world, s)).toContain('greedy');
        s.record.assaultsHeld = 1;
        expect(stylesEarned(world, s)).not.toContain('fortress');
        s.record.assaultsHeld = 2;
        expect(stylesEarned(world, s)).toContain('fortress');
    });

    it('Overwatch: every kill made from the sniper nest, at least one', () => {
        const built = setup(['......', '......'], [], [{ id: 'sol', pos: P(0, 0) }, { id: 'dex', pos: P(4, 1) }], { rooms: ['nn....', 'nn....'] });
        const world = freezeWorld({ ...(clonePlain(built.world) as World), nests: ['n'] });
        expect(stylesEarned(world, built.state)).not.toContain('overwatch');
        const one = act(world, built.state, killBy('sol')).state;
        expect(one.record.kills).toEqual([{ crew: 'sol', at: P(0, 0) }]);
        expect(one.crew[0]!.wounds.kills).toBe(1);
        expect(stylesEarned(world, one)).toContain('overwatch');
        const two = act(world, one, killBy('dex')).state;
        expect(stylesEarned(world, two)).not.toContain('overwatch');
    });
});
