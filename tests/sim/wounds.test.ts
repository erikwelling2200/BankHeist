import { describe, expect, it } from 'vitest';
import {
    commit, crewBudget, dealHarm, fixtureWorld, initialState, legalActions, preview, whyNot,
    type CrewStart, type FixtureOptions, type PersonDef, type Pos, type ReadonlyWorld, type SimEvent, type State
} from '../../src/sim';
import { registerTestCommand, testCommand } from './helpers';

/*
 * Wounds, downed and arrested (M3-03, GAME_DESIGN §11.12): hit points through the harm handler, Hurt (the limp, the aim,
 * bleeding, the blood trail), downed and bleeding out, revive and medkits, arrest, and NPCs' death, screams and crawl.
 */

const P = (x: number, y: number): Pos => ({ x, y });

const person = (id: string, pos: Pos, role = 'customer', observer: PersonDef['observer'] = 'civilian', extra: Partial<PersonDef> = {}): PersonDef => ({
    id, name: id, role, observer, pos, facing: 's', schedule: [], ...extra
});

// A test-only way to hurt the crew (NPCs don't fire before M3-05): harm as an attack would deal it.
registerTestCommand('testHarm', (ctx, cmd) => {
    const c = cmd as unknown as { target: string; damage: number };
    dealHarm(ctx, { target: c.target, by: 'test', cause: 'shot', weapon: 'pistol', hits: 1, damage: c.damage, lethal: true });
});
const harm = (target: string, damage: number) => testCommand({ type: 'testHarm', target, damage } as never);

interface Setup extends FixtureOptions { jun?: Partial<CrewStart>; mara?: Partial<CrewStart> }

function setup(options: Setup = {}): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(OPEN, options);
    const state = initialState(world, {
        seed: 3, crew: [{ id: 'jun', pos: P(0, 1), items: ['pistol'], ...options.jun }, { id: 'mara', pos: P(1, 1), items: ['medkit'], ...options.mara }]
    });
    return { world, state };
}

const OPEN = ['............', '............', '............', '............'];
const types = (events: readonly SimEvent[]): string[] => events.map(e => e.type);
const crew = (state: State, id: string) => state.crew.find(c => c.id === id)!;
const npc = (state: State, id: string) => state.npcs.find(n => n.id === id)!;
const endTurn = (world: ReadonlyWorld, state: State): State => commit(world, state, { type: 'endTurn' }).state;

describe('crew wounds', () => {
    it('starts everyone at 8 HP, with 2 medkit uses per kit carried', () => {
        const { state } = setup();
        expect(crew(state, 'jun').wounds).toEqual({ hp: 8, bandaged: false, bleed: 0, downed: null, dead: false, medkits: 0 });
        expect(crew(state, 'mara').wounds.medkits).toBe(2);
    });

    it('makes a crew member at half HP Hurt: a blood pool, a limp, worse aim and a trail', () => {
        const { world, state } = setup({ people: [person('guard', P(8, 1), 'lobbyGuard', 'enforcer')] });
        const fresh = crewBudget(world, crew(state, 'jun'), 'move');
        const r = commit(world, state, harm('jun', 4));
        expect(r.events.find(e => e.type === 'crewWounded')).toMatchObject({ crew: 'jun', hp: 4, hurt: true, cause: 'harm' });
        expect(r.state.evidence.filter(e => e.kind === 'blood').map(e => e.pos)).toEqual([P(0, 1)]);
        expect(crewBudget(world, crew(r.state, 'jun'), 'move')).toBe(fresh - 2);
        // Every tile walked onto is bloodied, once.
        const moved = commit(world, r.state, { type: 'move', crew: 'jun', path: [P(0, 2), P(1, 2)] }).state;
        expect(moved.evidence.filter(e => e.kind === 'blood').map(e => e.pos)).toEqual([P(0, 1), P(0, 2), P(1, 2)]);
        // Aim ×1.25 in the shot (what the preview's cone and the replay read).
        const shot = commit(world, r.state, { type: 'attack', crew: 'jun', at: P(8, 1), target: 'guard' }).state.shots[0]!.shot;
        expect(shot.aimFactor).toBe(1.25);
        expect(commit(world, state, { type: 'attack', crew: 'jun', at: P(8, 1), target: 'guard' }).state.shots[0]!.shot.aimFactor).toBeUndefined();
    });

    it('spares Cool Head the aim penalty', () => {
        const { world, state } = setup({ jun: { traits: ['coolHead'] }, people: [person('guard', P(8, 1), 'lobbyGuard', 'enforcer')] });
        const hurt = commit(world, state, harm('jun', 5)).state;
        expect(commit(world, hurt, { type: 'attack', crew: 'jun', at: P(8, 1), target: 'guard' }).state.shots[0]!.shot.aimFactor).toBeUndefined();
    });

    it('bleeds 1 HP every 2 world phases until bandaged', () => {
        const { world, state } = setup();
        let s = commit(world, state, harm('jun', 4)).state;
        s = endTurn(world, s);
        expect(crew(s, 'jun').wounds.hp).toBe(4);
        const r = commit(world, s, { type: 'endTurn' });
        expect(r.events.find(e => e.type === 'crewWounded')).toMatchObject({ crew: 'jun', hp: 3, cause: 'bleeding' });
        // Mara bandages him: healed 4 and no more bleeding.
        const healed = commit(world, r.state, { type: 'medkit', crew: 'mara', ally: 'jun' });
        expect(healed.events.find(e => e.type === 'crewHealed')).toEqual({ type: 'crewHealed', crew: 'jun', by: 'mara', hp: 7 });
        expect(crew(healed.state, 'mara').wounds.medkits).toBe(1);
        expect(preview(world, r.state, { type: 'medkit', crew: 'mara', ally: 'jun' }).events).toEqual(healed.events);
        let later = healed.state;
        for (let i = 0; i < 4; i++) later = endTurn(world, later);
        expect(crew(later, 'jun').wounds.hp).toBe(7);
        expect(whyNot(world, later, { type: 'medkit', crew: 'jun', ally: 'jun' })).toMatch(/no medkit/);
    });

    it('downs a crew member at 0 HP: no actions, bleeding out over 3 world phases, then dead', () => {
        const { world, state } = setup();
        const r = commit(world, state, harm('jun', 9));
        expect(types(r.events)).toContain('crewDowned');
        expect(crew(r.state, 'jun')).toMatchObject({ actionsLeft: 0, wounds: { hp: 0, downed: { left: 3 } } });
        expect(legalActions(world, r.state, 'jun')).toEqual([]);
        expect(() => commit(world, r.state, { type: 'move', crew: 'jun', path: [P(0, 2)] })).toThrow(/down/);
        let s = endTurn(world, r.state);
        expect(crew(s, 'jun')).toMatchObject({ actionsLeft: 0, wounds: { downed: { left: 2 } } });
        s = endTurn(world, s);
        const last = commit(world, s, { type: 'endTurn' });
        expect(types(last.events)).toContain('crewDied');
        expect(crew(last.state, 'jun').wounds).toMatchObject({ dead: true, downed: null });
        expect(whyNot(world, last.state, { type: 'revive', crew: 'mara', ally: 'jun' })).toMatch(/dead/);
    });

    it('revives a downed ally in reach with 3 HP, or 4 with a medkit, 6 for a medic', () => {
        const { world, state } = setup();
        const down = commit(world, state, harm('jun', 8)).state;
        const r = commit(world, down, { type: 'revive', crew: 'mara', ally: 'jun' });
        expect(r.events.find(e => e.type === 'crewRevived')).toEqual({ type: 'crewRevived', crew: 'jun', by: 'mara', hp: 3, medkit: false });
        expect(crew(r.state, 'jun').wounds).toMatchObject({ hp: 3, downed: null, bandaged: false });
        // Back up, but no actions until the next crew phase.
        expect(crew(r.state, 'jun').actionsLeft).toBe(0);
        expect(crew(endTurn(world, r.state), 'jun').actionsLeft).toBe(2);
        const kit = commit(world, down, { type: 'medkit', crew: 'mara', ally: 'jun' }).state;
        expect(crew(kit, 'jun').wounds).toMatchObject({ hp: 4, downed: null, bandaged: true });
        const medic = setup({ mara: { traits: ['medic'] } });
        const medicDown = commit(medic.world, medic.state, harm('jun', 8)).state;
        expect(crew(commit(medic.world, medicDown, { type: 'revive', crew: 'mara', ally: 'jun' }).state, 'jun').wounds.hp).toBe(6);
        // Not out of reach, not someone up.
        expect(whyNot(world, state, { type: 'revive', crew: 'mara', ally: 'jun' })).toMatch(/isn't down/);
        const far = setup({ mara: { pos: P(5, 3) } });
        expect(whyNot(far.world, commit(far.world, far.state, harm('jun', 8)).state, { type: 'revive', crew: 'mara', ally: 'jun' })).toMatch(/can't reach/);
    });

    it('lets police in reach arrest a downed crew member: off the map, into custody', () => {
        const { world, state } = setup();
        const down = commit(world, state, harm('jun', 8)).state;
        down.police.units.push({ id: 'unit-1', kind: 'patrol', vehicle: null, staging: null, arrived: -1, pos: P(0, 2), hp: 6, leaning: null, suppressed: null, moved: null });
        const r = commit(world, down, { type: 'endTurn' });
        expect(r.events.find(e => e.type === 'crewArrested')).toEqual({ type: 'crewArrested', crew: 'jun', by: 'unit-1' });
        expect(r.state.crew.map(c => c.id)).toEqual(['mara']);
        expect(r.state.custody.map(c => [c.crew.id, c.by])).toEqual([['jun', 'unit-1']]);
    });

    it('arrests only with an officer on foot since before the phase', () => {
        const { world, state } = setup();
        const down = commit(world, state, harm('jun', 8)).state;
        down.police.units.push({ id: 'unit-1', kind: 'patrol', vehicle: null, staging: null, arrived: 0, pos: P(0, 2), hp: 6, leaning: null, suppressed: null, moved: null });
        down.police.units.push({ id: 'unit-2', kind: 'negotiator', vehicle: null, staging: null, arrived: -5, pos: P(1, 2), hp: 6, leaning: null, suppressed: null, moved: null });
        expect(commit(world, down, { type: 'endTurn' }).state.custody).toEqual([]);
    });

    it('forgets an arrested crew member everywhere: the world phases after go on', () => {
        const { world, state } = setup({ people: [person('ann', P(4, 1)), person('bob', P(4, 2)), person('cat', P(5, 3), 'lobbyGuard', 'enforcer')] });
        let s = commit(world, state, harm('jun', 8)).state;
        const ann = npc(s, 'ann'), bob = npc(s, 'bob'), cat = npc(s, 'cat');
        ann.status = 'panicked';
        ann.panic = { since: { turn: 1, phase: 'crew' }, crew: 'jun', tile: P(0, 1), reaction: { kind: 'tackle', crew: 'jun' } };
        bob.status = 'commanded';
        bob.command = { pips: 2, by: 'jun' };
        cat.suspicion = { jun: 2 };
        cat.exposedTo = ['jun'];
        cat.lastSeen = { jun: { tile: P(0, 1), turn: 1 } };
        s.police.units.push({ id: 'unit-1', kind: 'swat', vehicle: null, staging: null, arrived: -1, pos: P(0, 2), hp: 6, leaning: null, suppressed: null, moved: null });
        const r = commit(world, s, { type: 'endTurn' });
        expect(r.state.custody.map(c => c.crew.id)).toEqual(['jun']);
        expect(JSON.stringify(r.state.npcs)).not.toContain('"jun"');
        expect(npc(r.state, 'bob').command?.by).toBe('mara');
        s = r.state;
        for (let i = 0; i < 4; i++) s = endTurn(world, s);
        expect(s.turn).toBe(6);
    });
});

describe('NPC wounds', () => {
    it('gives NPCs their role\'s hit points', () => {
        const { state } = setup({ people: [person('guard', P(8, 1), 'lobbyGuard', 'enforcer'), person('chief', P(8, 2), 'chief', 'enforcer'), person('cop', P(8, 3), 'customer', 'civilian', { armed: 'hidden' }), person('teller', P(9, 3), 'teller', 'staff')] });
        expect(state.npcs.map(n => [n.id, n.hp])).toEqual([['guard', 5], ['chief', 6], ['cop', 5], ['teller', 3]]);
    });

    it('kills an NPC at 0 HP, which heat reads off the state', () => {
        const { world, state } = setup({ people: [person('bob', P(0, 2)), person('ann', P(3, 2), 'customer', 'civilian', { facing: 'w' })] });
        const r = commit(world, state, { type: 'strike', crew: 'jun', npc: 'bob' });
        expect(npc(r.state, 'bob')).toMatchObject({ status: 'dead', hp: 0, intent: { path: [] } });
        expect(r.events.find(e => e.type === 'npcDied')).toEqual({ type: 'npcDied', npc: 'bob', by: 'jun' });
        // A civilian killed before the Alarm where Ann sees it: owed heat, in secret (rules/heat.ts reads it off the state).
        expect(r.state.heat.owed).toEqual([{ cause: 'civilianKilled', victim: 'bob' }]);
        expect(preview(world, state, { type: 'strike', crew: 'jun', npc: 'bob' }).events).toEqual(r.events);
    });

    it('makes a wounded NPC scream each world phase and crawl a tile at a time for a way out', () => {
        const exit = P(11, 1);
        const { world, state } = setup({
            people: [person('guard', P(1, 2), 'lobbyGuard', 'enforcer', { schedule: [{ activity: 'leave', from: 0, at: exit }] as unknown as PersonDef['schedule'] })]
        });
        const r = commit(world, state, { type: 'strike', crew: 'mara', npc: 'guard' });
        expect(npc(r.state, 'guard')).toMatchObject({ hp: 2, status: expect.not.stringMatching('dead') });
        expect(r.events.find(e => e.type === 'npcWounded')).toEqual({ type: 'npcWounded', npc: 'guard', hp: 2, wounded: true });
        const w = commit(world, r.state, { type: 'endTurn' });
        expect(w.events.find(e => e.type === 'screamed')).toEqual({ type: 'screamed', npc: 'guard' });
        expect(w.events.find(e => e.type === 'noise' && e.cause === 'scream guard')).toMatchObject({ kind: 'loud', radius: 6 });
        const g = npc(w.state, 'guard');
        expect(g.goal.kind).toBe('crawl');
        expect(g.intent.path).toHaveLength(1);
        expect(g.intent.path[0]!.x).toBeGreaterThan(g.pos.x);
    });
});
