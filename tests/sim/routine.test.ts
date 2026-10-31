import { describe, expect, it } from 'vitest';
import {
    clonePlain, commit, crewShotPreview, dealHarm, previewShot, projectPreviewEvents, deserialiseState, fixtureWorld, initialState, legalActions, OFFICER_STATS, policeDown, preview, projectEvents, serialiseState,
    type CrewStart, type FixtureOptions, type FixtureWall, type Material, type PersonDef, type PoliceKind, type PoliceMode, type Pos, type ReadonlyWorld, type SimEvent, type State
} from '../../src/sim';
import { actionMenu } from '../../src/game/actions';
import { describeEvent, threatLedger } from '../../src/game/views';
import { registerTestCommand, testCommand } from './helpers';

/*
 * M3-05, the police and guard routine (GAME_DESIGN §13.5, §13.6, §10.10): what the police know, officers and guards
 * fighting by the simple routine, never through a standing non-crew body, freeing hostages, walking up to arrest,
 * breaches announced a phase ahead, and officers taking harm.
 */

const P = (x: number, y: number): Pos => ({ x, y });

/** Someone standing where they are, who would leave by (0, 2) at turn 99: their way out. */
const person = (id: string, pos: Pos, role = 'customer', observer: PersonDef['observer'] = 'civilian', facing: PersonDef['facing'] = 'n'): PersonDef => ({
    id, name: id, role, observer, pos, facing,
    schedule: [{ from: 1, activity: 'wait', label: 'waiting', room: '', at: pos, facing }, { from: 99, activity: 'leave', label: 'leaving', room: '', at: P(0, 4) }]
});

registerTestCommand('testHurt', (ctx, cmd) => {
    const c = cmd as unknown as { target: string; damage: number };
    dealHarm(ctx, { target: c.target, by: 'test', cause: 'shot', weapon: 'pistol', hits: 1, damage: c.damage, lethal: true });
});
registerTestCommand('testOfficerDown', (ctx, cmd) => policeDown(ctx, (cmd as unknown as { unit: string }).unit, true));
const hurt = (target: string, damage: number) => testCommand({ type: 'testHurt', target, damage } as never);

const OPEN = Array.from({ length: 5 }, () => '................');
const endTurn = { type: 'endTurn' } as const;
const types = (events: readonly SimEvent[]): string[] => events.map(e => e.type);
const of = <K extends SimEvent['type']>(events: readonly SimEvent[], type: K) => events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);

interface Setup extends FixtureOptions { crew?: CrewStart[]; heat?: number; mode?: PoliceMode }

/** A loud bank after the Alarm, the police in `mode` (9 phases left), no more waves coming; the crew masked. */
function setup(map: readonly string[], options: Setup = {}): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(map, options);
    const s = clonePlain(initialState(world, { seed: 5, crew: options.crew ?? [{ id: 'jun', pos: P(1, 2), items: ['pistol'] }] }));
    for (const c of s.crew) c.loadout.masked = true;
    s.bank.alarm = true;
    s.bank.loud = true;
    s.response = { raised: s.turn - 5, by: 'tellerButton', policeIn: 0, heat: options.heat ?? 5 };
    s.police.sent = 5;
    s.police.mode = { kind: options.mode ?? 'contain', left: 9, since: { turn: s.turn - 1, phase: 'world' }, after: null };
    return { world, state: s };
}

function officer(state: State, id: string, pos: Pos, kind: PoliceKind = 'patrol'): void {
    state.police.units.push({ id, kind, vehicle: null, staging: null, arrived: state.turn - 3, pos, hp: OFFICER_STATS[kind].hp, leaning: null, suppressed: null, moved: null });
}

const unit = (state: State, id: string) => state.police.units.find(u => u.id === id);
const npc = (state: State, id: string) => state.npcs.find(n => n.id === id)!;

/** A wall down between columns 5 and 6, with the door 'd' at row 2 (locked). */
const DIVIDED: FixtureWall[] = [0, 1, 2, 3, 4].map(y => ({
    between: [P(5, y), P(6, y)] as [Pos, Pos], material: (y === 2 ? 'doorWood' : 'plaster') as Material,
    ...(y === 2 ? { door: { id: 'd', lock: 'mechanical' as const, start: 'locked' as const } } : {})
}));

describe('officers fighting (§13.6)', () => {
    it('fire at the nearest masked crew member in sight, from where they stand in Contain', () => {
        const { world, state } = setup(OPEN);
        officer(state, 'cop', P(8, 2));
        const r = commit(world, state, endTurn);
        const fired = of(r.events, 'fighterFired');
        expect(fired).toEqual([{ type: 'fighterFired', shooter: 'cop', target: 'jun', weapon: 'pistol', bullets: 2, at: P(1, 2) }]);
        expect(of(r.events, 'shotFired')[0]).toMatchObject({ shooter: 'cop', weapon: 'pistol' });
        // Told once fired: the bullets, then the report.
        const order = types(r.events);
        expect(order.indexOf('fighterFired')).toBeLessThan(order.indexOf('shotFired'));
        expect(order.indexOf('shotFired')).toBeLessThan(order.indexOf('noise'));
        expect(unit(r.state, 'cop')!.pos).toEqual(P(8, 2));
        expect(r.state.police.known.jun).toEqual({ tile: P(1, 2), turn: 1, down: false });
        // Every hit is dealt through the harm interface.
        const hits = of(r.events, 'shotFired')[0]!.hits;
        expect(of(r.events, 'harmed').map(h => [h.target, h.by, h.damage])).toEqual(hits.map(h => [h.id, 'cop', h.damage]));
        expect(r.state.shots.at(-1)!.shot).toMatchObject({ shooter: 'cop', target: 'jun', moved: false });
    });

    it('leave an unmasked stranger alone, and hold fire in Negotiate', () => {
        const plain = setup(OPEN);
        plain.state.crew[0]!.loadout.masked = false;
        officer(plain.state, 'cop', P(8, 2));
        expect(types(commit(plain.world, plain.state, endTurn).events)).not.toContain('fighterFired');
        const talks = setup(OPEN, { mode: 'negotiate' });
        officer(talks.state, 'cop', P(8, 2));
        expect(types(commit(talks.world, talks.state, endTurn).events)).not.toContain('fighterFired');
    });

    it('never fire through a standing bystander: hold in Contain, move to a clean line in Assault', () => {
        const people = [person('ann', P(4, 2), 'customer', 'civilian', 'n')];
        const held = setup(OPEN, { people });
        officer(held.state, 'cop', P(8, 2));
        const r = commit(held.world, held.state, endTurn);
        expect(of(r.events, 'heldFire')).toEqual([{ type: 'heldFire', shooter: 'cop', target: 'jun', why: 'body', blockers: ['ann'] }]);
        expect(types(r.events)).not.toContain('shotFired');

        const moving = setup(OPEN, { people, mode: 'assault' });
        officer(moving.state, 'cop', P(8, 2));
        const m = commit(moving.world, moving.state, endTurn);
        expect(of(m.events, 'fighterFired')).toHaveLength(1);
        expect(unit(m.state, 'cop')!.pos).not.toEqual(P(8, 2));
        expect(of(m.events, 'policeMoved').length).toBeGreaterThan(0);
        // Moving first: the moving penalty is in the shot.
        expect(m.state.shots.at(-1)!.shot.moved).toBe(true);
        for (const s of of(m.events, 'shotFired')) for (const b of s.bullets) for (const step of b.steps) if (step.kind === 'body') expect(step.id).toBe('jun');
    });

    it('never fire at a crew member holding a hostage up as a shield (§10.7)', () => {
        const { world, state } = setup(OPEN, { people: [person('ann', P(2, 2))], mode: 'assault' });
        npc(state, 'ann').status = 'commanded';
        npc(state, 'ann').command = { pips: 3, by: 'jun' };
        const led = commit(world, state, { type: 'escort', crew: 'jun', npc: 'ann' }).state;
        officer(led, 'cop', P(8, 2));
        const r = commit(world, led, endTurn);
        expect(types(r.events)).not.toContain('shotFired');
        expect(types(r.events)).toContain('heldFire');
    });

    it('advance on a reported position in Assault, the shortest way', () => {
        const { world, state } = setup(OPEN, { crew: [{ id: 'jun', pos: P(1, 2), items: ['pistol'] }], mode: 'assault' });
        // Out of sight (13 tiles off): a hostage let go told them where Jun was.
        state.negotiation.reports.push({ npc: 'ann', turn: 0, seen: [{ crew: 'jun', tile: P(1, 2), turn: 0 }] });
        officer(state, 'cop', P(14, 2));
        const r = commit(world, state, endTurn);
        expect(types(r.events)).not.toContain('fighterFired');
        // Heard and acted on: 4 tiles closer, and then Jun in sight, seen this turn.
        expect(unit(r.state, 'cop')!.pos).toEqual(P(10, 2));
        expect(r.state.police.known.jun).toEqual({ tile: P(1, 2), turn: 1, down: false });
        // A reported tile they see empty gives way to what they see.
        const gone = setup(OPEN, { crew: [{ id: 'jun', pos: P(15, 4), items: ['pistol'] }], mode: 'contain' });
        gone.state.crew[0]!.loadout.masked = false;
        gone.state.police.known.jun = { tile: P(3, 2), turn: 0, down: false };
        officer(gone.state, 'cop', P(8, 2));
        // (Jun, known now, is seen where he really is.)
        expect(commit(gone.world, gone.state, endTurn).state.police.known.jun).toEqual({ tile: P(15, 4), turn: 1, down: false });
    });

    it('fall back out of sight when Hurt', () => {
        const map = ['................', '................', '.......T........', '................', '................'];
        const { world, state } = setup(map);
        officer(state, 'cop', P(9, 1));
        unit(state, 'cop')!.hp = 3;
        const r = commit(world, state, endTurn);
        expect(types(r.events)).not.toContain('fighterFired');
        // The nearest tile behind the column, out of Jun's sight.
        expect(unit(r.state, 'cop')!.pos).toEqual(P(9, 2));
        expect(types(r.events)).toContain('policeMoved');
    });
});

describe('officers taking harm', () => {
    it('are bodies the crew can shoot: hit points, Negotiate ends, down at 0 with its heat', () => {
        const { world, state } = setup(OPEN, { mode: 'negotiate' });
        officer(state, 'cop', P(6, 2));
        expect(legalActions(world, state, 'jun').some(c => c.type === 'attack' && c.target === 'cop')).toBe(true);
        const r = commit(world, state, hurt('cop', 2));
        expect(of(r.events, 'officerWounded')).toEqual([{ type: 'officerWounded', unit: 'cop', hp: 4, hurt: false }]);
        expect(r.state.police.mode!.kind).toBe('assault');
        const dead = commit(world, r.state, hurt('cop', 9));
        expect(types(dead.events)).toEqual(expect.arrayContaining(['policeDown', 'heatChanged']));
        expect(unit(dead.state, 'cop')).toBeUndefined();
        expect(dead.state.heat.policeKilled).toBe(1);
        // A real attack meets the officer as a body with armour 1.
        const shot = commit(world, state, { type: 'attack', crew: 'jun', at: P(6, 2), target: 'cop' });
        expect(of(shot.events, 'shotFired')[0]!.bullets.some(b => b.steps.some(s => s.kind === 'body' && s.id === 'cop'))).toBe(true);
    });

    it('answer a crew Watch as they walk into it', () => {
        const { world, state } = setup(OPEN, { mode: 'assault', crew: [{ id: 'jun', pos: P(1, 2), items: ['pistol'] }] });
        state.negotiation.reports.push({ npc: 'ann', turn: 0, seen: [{ crew: 'jun', tile: P(1, 0), turn: 0 }] });
        state.crew[0]!.loadout.masked = false;
        officer(state, 'cop', P(15, 0));
        const watching = commit(world, state, { type: 'watch', crew: 'jun', at: P(12, 0), arc: 60 }).state;
        const r = commit(world, watching, endTurn);
        expect(of(r.events, 'attacked').find(a => a.mode === 'watch')).toMatchObject({ crew: 'jun', target: 'cop' });
    });
});

describe('the grid on officers', () => {
    it('offers Watch and Suppress on an officer the crew sees, as Fire', () => {
        const { world, state } = setup(OPEN, { crew: [{ id: 'jun', pos: P(1, 2), items: ['lmg'] }], mode: 'negotiate' });
        officer(state, 'cop', P(8, 2));
        const menu = actionMenu(world, state, 'jun', 'cop');
        for (const id of ['attack', 'watch', 'suppress']) expect(menu.find(e => e.id === id), id).toMatchObject({ target: 'cop' });
        expect(menu.find(e => e.id === 'watch')!.command).toMatchObject({ type: 'watch', at: P(8, 2) });
    });
});

describe('crew Watch on fighters that act (§11.8)', () => {
    it('fires at an officer that shoots from where it stands, before its shot', () => {
        const { world, state } = setup(OPEN, { crew: [{ id: 'jun', pos: P(1, 2), items: ['pistol'] }] });
        officer(state, 'cop', P(8, 2));
        const watching = commit(world, state, { type: 'watch', crew: 'jun', at: P(8, 2), arc: 30 }).state;
        const r = commit(world, watching, endTurn), order = types(r.events);
        const volley = r.events.findIndex(e => e.type === 'attacked' && e.mode === 'watch');
        expect(volley).toBeGreaterThanOrEqual(0);
        expect(of(r.events, 'attacked')[0]).toMatchObject({ crew: 'jun', target: 'cop', mode: 'watch' });
        // The volley comes first; the officer, still up, fires after it.
        if (unit(r.state, 'cop')) expect(order.indexOf('fighterFired')).toBeGreaterThan(volley);
    });

    it('fires at a Hostile NPC that shoots from where it stands', () => {
        const { world, state } = setup(OPEN, { people: [person('guard', P(8, 2), 'lobbyGuard', 'enforcer', 'w')] });
        npc(state, 'guard').status = 'hostile';
        const watching = commit(world, state, { type: 'watch', crew: 'jun', at: P(8, 2), arc: 30 }).state;
        const r = commit(world, watching, endTurn);
        expect(of(r.events, 'attacked')[0]).toMatchObject({ crew: 'jun', target: 'guard', mode: 'watch' });
        const volley = r.events.findIndex(e => e.type === 'attacked'), shot = r.events.findIndex(e => e.type === 'fighterFired');
        if (shot >= 0) expect(shot).toBeGreaterThan(volley);
    });

    it('fires at an officer leaning out past a corner into the wedge to shoot', () => {
        // A column hides Jun from the officer's own tile; leaning out to (8, 1) it sees him and fires from there, into
        // Jun's narrow wedge on that tile.
        const map = ['................', '................', '.......T........', '................', '................'];
        const seen = setup(map);
        officer(seen.state, 'cop', P(8, 2));
        const r1 = commit(seen.world, seen.state, endTurn);
        expect(r1.state.shots.at(-1)!.shot).toMatchObject({ shooter: 'cop', lean: P(8, 1) });
        const watching = commit(seen.world, seen.state, { type: 'watch', crew: 'jun', at: P(8, 1), arc: 6 }).state;
        const r = commit(seen.world, watching, endTurn);
        expect(of(r.events, 'attacked')[0]).toMatchObject({ crew: 'jun', target: 'cop', mode: 'watch' });
    });

    it('does not fire at a fighter that neither moves nor acts', () => {
        const { world, state } = setup(OPEN, { mode: 'negotiate' });
        officer(state, 'cop', P(8, 2));
        const watching = commit(world, state, { type: 'watch', crew: 'jun', at: P(8, 2), arc: 30 }).state;
        expect(types(commit(world, watching, endTurn).events)).not.toContain('attacked');
    });
});

describe('officers through what the crew knows (§8.15, two worlds)', () => {
    // An officer on a dark tile 8 off: in the pistol's range and line of fire, but the crew sees only 6 into the dark.
    const DARK = [7, 8, 9, 10, 11].flatMap(x => [0, 1, 2, 3, 4].map(y => P(x, y)));

    function worlds(mode: PoliceMode, at: Pos, extra: (s: State) => void = () => {}) {
        const make = (withOfficer: boolean) => {
            const { world, state } = setup(Array.from({ length: 5 }, () => '..............................'), { dark: DARK, mode });
            state.crew[0]!.loadout.masked = false;
            extra(state);
            if (withOfficer) officer(state, 'cop', at);
            return { world, state };
        };
        return { hidden: make(true), absent: make(false) };
    }

    it('gives the same grid and the same shot preview whether a hidden officer is there or not', () => {
        const { hidden, absent } = worlds('contain', P(9, 2));
        expect(legalActions(hidden.world, hidden.state, 'jun').some(c => c.type === 'attack' && c.target === 'cop')).toBe(true);
        expect(actionMenu(hidden.world, hidden.state, 'jun', 'cop')).toEqual(actionMenu(absent.world, absent.state, 'jun', 'cop'));
        const shot = { shooter: 'jun', weapon: 'pistol', at: P(12, 2) };
        expect(crewShotPreview(hidden.world, hidden.state, shot)).toEqual(crewShotPreview(absent.world, absent.state, shot));
        // The truth has it in the line.
        expect(previewShot(hidden.world, hidden.state, shot).bodies.map(b => b.id)).toContain('cop');
    });

    it('previews the same Suppress in Negotiate whether a hidden officer is in the wedge or not; the commit answers', () => {
        const make = (withOfficer: boolean) => {
            const { world, state } = setup(Array.from({ length: 5 }, () => '..............................'), {
                dark: DARK, mode: 'negotiate', crew: [{ id: 'jun', pos: P(1, 2), items: ['lmg'] }]
            });
            state.crew[0]!.loadout.masked = false;
            if (withOfficer) officer(state, 'cop', P(9, 2));
            return { world, state };
        };
        const hidden = make(true), absent = make(false), cmd = { type: 'suppress', crew: 'jun', at: P(12, 2) } as const;
        const a = preview(hidden.world, hidden.state, cmd), b = preview(absent.world, absent.state, cmd);
        expect(projectPreviewEvents(hidden.world, hidden.state, a)).toEqual(projectPreviewEvents(absent.world, absent.state, b));
        expect(a.state.police.mode!.kind).toBe('negotiate');
        expect(commit(hidden.world, hidden.state, cmd).state.police.mode!.kind).toBe('assault');
    });

    it('tells the crew\'s own Watch volley at a hidden officer, without naming it', () => {
        const { world, state } = setup(Array.from({ length: 5 }, () => '..............................'), { dark: DARK, crew: [{ id: 'jun', pos: P(1, 2), items: ['lmg'] }] });
        officer(state, 'cop', P(8, 2));
        const watching = commit(world, state, { type: 'watch', crew: 'jun', at: P(8, 2), arc: 30 }).state;
        const r = commit(world, watching, endTurn);
        expect(of(r.events, 'attacked')[0]).toMatchObject({ mode: 'watch', target: 'cop' });
        const told = projectEvents(world, r.state, r.events, watching);
        const volley = of(told, 'attacked')[0]!;
        expect(volley).toMatchObject({ crew: 'jun', mode: 'watch' });
        expect(volley.target).toBeUndefined();
        expect(types(told)).not.toContain('fighterFired');
        // Its bullets are told, but not whom they met, nor what they did to them (the volley as if it had hit).
        const real = of(r.events, 'shotFired').find(e => e.shooter === 'jun')!;
        const hit = {
            ...real, hits: [{ id: 'cop', hits: 1, damage: 2, knockout: false }],
            bullets: real.bullets.map(b => ({ ...b, steps: [{ kind: 'body' as const, id: 'cop', effect: 'hit' as const, damage: 2 }], stop: 'body' as const }))
        };
        const harm = { type: 'harmed' as const, target: 'cop', by: 'jun', cause: 'shot' as const, weapon: 'lmg', hits: 1, damage: 2, lethal: true };
        const shown = projectEvents(world, r.state, [hit, harm], watching);
        expect(shown).toHaveLength(1);
        expect(JSON.stringify(shown)).not.toContain('"cop"');
        expect(of(shown, 'shotFired')[0]!.bullets[0]!.steps[0]).toMatchObject({ kind: 'body', id: '' });
    });

    it('says why an officer held fire only when the crew sees who was in the way', () => {
        const people = [person('ann', P(8, 2))];
        const { world, state } = setup(Array.from({ length: 5 }, () => '..............................'), { dark: [P(7, 2), P(8, 2), P(7, 1), P(8, 1), P(7, 3), P(8, 3)], people });
        officer(state, 'cop', P(10, 2));
        const r = commit(world, state, endTurn);
        expect(of(r.events, 'heldFire')[0]).toMatchObject({ shooter: 'cop', why: 'body', blockers: ['ann'] });
        const told = of(projectEvents(world, r.state, r.events, state), 'heldFire');
        expect(told).toEqual([{ type: 'heldFire', shooter: 'cop', target: 'jun' }]);
        expect(describeEvent(world, r.state, told[0]!)).toMatch(/held fire$/);
    });

    it('tells the same events whether a hidden officer moved about or wasn\'t there', () => {
        // Off past what the crew sees, walking on a stale report of Mara.
        const { hidden, absent } = worlds('assault', P(18, 2), s => {
            s.crew.push(clonePlain({ ...s.crew[0]!, id: 'mara', name: 'Mara', pos: P(1, 4) }));
            s.police.known.mara = { tile: P(29, 2), turn: 0, down: false };
        });
        const a = commit(hidden.world, hidden.state, endTurn), b = commit(absent.world, absent.state, endTurn);
        expect(types(a.events)).toContain('policeMoved');
        expect(projectEvents(hidden.world, a.state, a.events, hidden.state)).toEqual(projectEvents(absent.world, b.state, b.events, absent.state));
    });
});

describe('what the police know', () => {
    it('a report older than an empty sighting brings nothing back', () => {
        const { world, state } = setup(OPEN, { crew: [{ id: 'jun', pos: P(15, 4), items: ['pistol'] }] });
        state.crew[0]!.loadout.masked = false;
        state.police.known.jun = { tile: P(3, 0), turn: 0, down: false };
        state.negotiation.reports.push({ npc: 'ann', turn: 0, seen: [{ crew: 'jun', tile: P(3, 0), turn: 0 }] });
        // Jun is out of the officer's sight; the reported tile isn't, and it is empty.
        officer(state, 'cop', P(3, 2));
        let s = commit(world, state, endTurn).state;
        expect(s.police.known.jun).toEqual({ tile: null, turn: 1, down: false });
        s = commit(world, s, endTurn).state;
        expect(s.police.known.jun).toEqual({ tile: null, turn: 1, down: false });
    });

    it('a shot at an officer, hit or miss, ends Negotiate and gives the shooter away', () => {
        const { world, state } = setup(OPEN, { mode: 'negotiate' });
        state.crew[0]!.loadout.masked = false;
        officer(state, 'cop', P(8, 2));
        const seen = preview(world, state, { type: 'attack', crew: 'jun', at: P(8, 2), target: 'cop' });
        expect(seen.state.police.mode!.kind).toBe('assault');
        expect(seen.state.police.known.jun).toEqual({ tile: P(1, 2), turn: 1, down: false });
    });

    it('a save from before M3-05 is refused, not loaded to crash later', () => {
        const { state } = setup(OPEN);
        const old = clonePlain(state) as unknown as { police: Record<string, unknown> };
        delete old.police.known;
        delete old.police.breaches;
        expect(() => deserialiseState(serialiseState({ state: old as unknown as State }))).toThrow(/older build/);
    });
});

describe('freeing hostages (§10.10)', () => {
    it('frees a Commanded hostage beside an officer for free; it walks out, escapes and tells', () => {
        const { world, state } = setup(OPEN, { people: [person('bob', P(9, 4))], mode: 'contain', crew: [{ id: 'jun', pos: P(15, 0), items: [] }] });
        state.crew[0]!.loadout.masked = false;
        npc(state, 'bob').status = 'commanded';
        npc(state, 'bob').command = { pips: 3, by: 'jun' };
        npc(state, 'bob').lastSeen = { jun: { tile: P(14, 0), turn: 0 } };
        officer(state, 'cop', P(8, 4));
        const r = commit(world, state, endTurn);
        expect(of(r.events, 'hostageFreed')).toEqual([{ type: 'hostageFreed', npc: 'bob', unit: 'cop', exit: P(0, 4), cut: false }]);
        expect(npc(r.state, 'bob')).toMatchObject({ status: 'alerted', command: null, lapse: { kind: 'released', exit: P(0, 4), freed: 'cop' } });
        expect(describeEvent(world, r.state, of(r.events, 'hostageFreed')[0]!)).toMatch(/bob/);
        let s = r.state, left: SimEvent[] = [];
        for (let i = 0; i < 6 && npc(s, 'bob').status !== 'away'; i++) {
            const next = commit(world, s, endTurn);
            left = next.events;
            s = next.state;
        }
        expect(npc(s, 'bob').status).toBe('away');
        expect(of(left, 'heatChanged').some(h => h.cause === 'hostageEscaped')).toBe(true);
        expect(s.negotiation.reports.find(x => x.npc === 'bob')!.seen.map(x => x.crew)).toEqual(['jun']);
    });

    it('leaves a hostage the crew holds this phase (§10.3)', () => {
        const { world, state } = setup(OPEN, { people: [person('bob', P(9, 4))], crew: [{ id: 'jun', pos: P(11, 4), items: ['pistol'] }] });
        state.crew[0]!.loadout.masked = false;
        npc(state, 'bob').status = 'commanded';
        npc(state, 'bob').command = { pips: 3, by: 'jun' };
        officer(state, 'cop', P(8, 4));
        const holding = commit(world, state, { type: 'hold', crew: 'jun' }).state;
        expect(types(commit(world, holding, endTurn).events)).not.toContain('hostageFreed');
        expect(types(commit(world, state, endTurn).events)).toContain('hostageFreed');
    });

    it('cuts a tied one loose as its act, and lets one led by the crew be', () => {
        const { world, state } = setup(OPEN, { people: [person('bob', P(9, 4)), person('cat', P(7, 4))], crew: [{ id: 'jun', pos: P(15, 0), items: [] }] });
        state.crew[0]!.loadout.masked = false;
        npc(state, 'bob').status = 'tied';
        npc(state, 'cat').status = 'tied';
        officer(state, 'cop', P(8, 4));
        const r = commit(world, state, endTurn);
        // One a phase: the first by id.
        expect(of(r.events, 'hostageFreed').map(e => [e.npc, e.cut])).toEqual([['bob', true]]);
        expect(npc(r.state, 'cat').status).toBe('tied');
    });
});

describe('breaches (§13.4, §13.6)', () => {
    function divided(heat: number) {
        const { world, state } = setup(OPEN, { walls: DIVIDED, mode: 'assault', heat });
        state.police.known.jun = { tile: P(1, 2), turn: 0, down: false };
        officer(state, 'cop', P(9, 2));
        return { world, state };
    }

    it('are announced a phase ahead beside the locked door, then carried out as shown', () => {
        const { world, state } = divided(10);
        const one = commit(world, state, endTurn);
        expect(of(one.events, 'breachAnnounced')).toEqual([{ type: 'breachAnnounced', door: 'd', unit: 'cop' }]);
        expect(unit(one.state, 'cop')!.pos).toEqual(P(6, 2));
        // Through the crew phase the marker stands, and the door is still locked.
        expect(one.state.police.breaches).toEqual([{ door: 'd', unit: 'cop', turn: 1 }]);
        expect(one.state.doors.d?.status ?? 'locked').toBe('locked');
        // The ledger shows the marker at the door, due in 1.
        expect(threatLedger(one.state, world)).toContainEqual(expect.objectContaining({ id: 'breach:d', countdown: 1, pos: P(5, 2) }));
        const two = commit(world, one.state, endTurn);
        expect(of(two.events, 'doorBreached')).toEqual([{ type: 'doorBreached', door: 'd', unit: 'cop' }]);
        expect(two.state.doors.d!.status).toBe('breached');
        expect(two.state.police.breaches).toEqual([]);
        // Through the hole the officer sees Jun and fights.
        const three = commit(world, two.state, endTurn);
        expect(types(three.events)).toContain('fighterFired');
    });

    it('are not made below Heat 3: they use open or unlocked doors only', () => {
        const { world, state } = divided(5);
        const r = commit(world, state, endTurn);
        expect(types(r.events)).not.toContain('breachAnnounced');
        expect(unit(r.state, 'cop')!.pos).toEqual(P(9, 2));
    });

    it('are called off when Assault ends', () => {
        const { world, state } = divided(10);
        // The world phase that announces it is Assault's last.
        state.police.mode!.left = 1;
        const r = commit(world, state, endTurn);
        expect(types(r.events)).toContain('breachAnnounced');
        expect(of(r.events, 'breachCalledOff')).toEqual([{ type: 'breachCalledOff', door: 'd', unit: 'cop' }]);
        expect(r.state.police.breaches).toEqual([]);
    });

    it('are called off when the breacher goes down', () => {
        const { world, state } = divided(10);
        const one = commit(world, state, endTurn).state;
        const down = commit(world, one, testCommand({ type: 'testOfficerDown', unit: 'cop' } as never));
        // The marker comes down at once.
        expect(of(down.events, 'breachCalledOff')).toEqual([{ type: 'breachCalledOff', door: 'd', unit: 'cop' }]);
        expect(down.state.police.breaches).toEqual([]);
        const r = commit(world, down.state, endTurn);
        expect(types(r.events)).not.toContain('doorBreached');
        expect(r.state.police.breaches).toEqual([]);
    });
});

describe('arrests (§11.12, §13.4)', () => {
    it('walk up to a downed crew member they know of, and arrest a world phase later', () => {
        const { world, state } = setup(OPEN, { mode: 'assault', crew: [{ id: 'jun', pos: P(2, 2), items: ['pistol'] }, { id: 'mara', pos: P(0, 0) }] });
        state.crew[1]!.loadout.masked = false;
        const down = commit(world, state, hurt('jun', 9)).state;
        officer(down, 'cop', P(7, 2));
        const one = commit(world, down, endTurn);
        expect(unit(one.state, 'cop')!.pos).toEqual(P(3, 2));
        expect(one.state.custody).toEqual([]);
        const two = commit(world, one.state, endTurn);
        expect(of(two.events, 'crewArrested')).toEqual([{ type: 'crewArrested', crew: 'jun', by: 'cop' }]);
        expect(two.state.police.known.jun).toBeUndefined();
    });
});

describe('guards fighting (§13.6)', () => {
    const guard = (pos: Pos) => person('guard', pos, 'lobbyGuard', 'enforcer', 'w');

    it('unlock and open a locked door they hold a key to, as on their rounds', () => {
        const { world, state } = setup(OPEN, { walls: DIVIDED, people: [guard(P(8, 2))] });
        npc(state, 'guard').status = 'hostile';
        npc(state, 'guard').lastSeen = { jun: { tile: P(1, 2), turn: 0 } };
        const r = commit(world, state, endTurn);
        expect(of(r.events, 'doorOpened')).toEqual([{ type: 'doorOpened', door: 'd', by: 'guard' }]);
        expect(npc(r.state, 'guard').pos.x).toBeLessThan(6);
    });

    it('fire their own pistol at the crew, reload when empty, aim worse suppressed', () => {
        const { world, state } = setup(OPEN, { people: [guard(P(8, 2))] });
        npc(state, 'guard').status = 'hostile';
        const r = commit(world, state, endTurn);
        expect(of(r.events, 'fighterFired')[0]).toMatchObject({ shooter: 'guard', target: 'jun', weapon: 'pistol', bullets: 2 });
        expect(npc(r.state, 'guard').ammo!.loaded).toBe(10);
        expect(npc(r.state, 'guard').lastSeen.jun!.tile).toEqual(P(1, 2));

        const empty = clonePlain(state);
        npc(empty, 'guard').ammo!.loaded = 0;
        const reload = commit(world, empty, endTurn);
        expect(types(reload.events)).toContain('npcReloaded');
        expect(types(reload.events)).not.toContain('fighterFired');
        expect(npc(reload.state, 'guard').ammo).toMatchObject({ loaded: 12, spare: 1 });

        const pinned = clonePlain(state);
        npc(pinned, 'guard').suppressed = { turn: pinned.turn, by: 'jun', from: P(8, 2), reacted: false };
        expect(commit(world, pinned, endTurn).state.shots.at(-1)!.shot.aimFactor).toBe(1.5);
    });
});
