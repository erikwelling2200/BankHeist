import { describe, expect, it } from 'vitest';
import {
    clonePlain, commit, fixtureWorld, hashOf, initialState, legalActions, negotiatorCalling, tradeable, preview, whyNot, type Command, type PersonDef, type Pos, type ReadonlyWorld,
    type SimEvent, type State
} from '../../src/sim';
import { actionMenu, menuIsLegal } from '../../src/game/actions';
import { registerTestCommand, registerTestEvents, scouted, step, testCommand } from './helpers';

/*
 * M3-07: answering the negotiator (§13.4): Release, Trade, Stall and Hang up; hostages walking out; what they tell.
 */

const P = (x: number, y: number): Pos => ({ x, y });
/** Someone standing where they are, who would leave by `exit` at turn 99: their way out. */
const person = (id: string, observer: PersonDef['observer'], pos: Pos, exit: Pos = P(0, 5)): PersonDef => ({
    id, name: id, role: observer === 'staff' ? 'teller' : 'customer', observer, pos, facing: 's',
    schedule: [{ from: 1, activity: 'wait', label: 'waiting', room: '', at: pos, facing: 's' }, { from: 99, activity: 'leave', label: 'leaving', room: '', at: exit }]
});

registerTestCommand('testKill', (ctx, cmd) => {
    ctx.state.npcs.find(n => n.id === (cmd as unknown as { npc: string }).npc)!.status = 'dead';
});
registerTestEvents({});

const endTurn = { type: 'endTurn' } as const;
const STAGING = [{ id: 'west', name: 'Main street, west end', pos: P(0, 5) }, { id: 'east', name: 'Main street, east end', pos: P(11, 5) }];

/**
 * A bank on a street (rows 0–3 inside, 4–5 the street), the Alarm up with heat at `heat`, the negotiator out on the
 * street and the police in Negotiate (4 phases left): the teller tied at (8, 1), a customer tied at (2, 1), Jun with a
 * pistol at (5, 1) and Dex in custody.
 */
function negotiating(heat = 7, mode: 'negotiate' | 'contain' = 'negotiate'): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld(Array.from({ length: 6 }, () => '............'), {
        rooms: [...Array.from({ length: 4 }, () => 'bbbbbbbbbbbb'), '............', '............'],
        people: [person('teller', 'staff', P(8, 1)), person('customer', 'civilian', P(2, 1))], staging: STAGING
    });
    const s = clonePlain(scouted(world, initialState(world, { seed: 7, crew: [{ id: 'jun', pos: P(5, 1), items: ['pistol'] }, { id: 'dex', pos: P(11, 0) }] })));
    s.bank.alarm = true;
    s.bank.loud = true;
    s.response = { raised: s.turn - 1, by: 'tellerButton', policeIn: 0, heat };
    s.police.sent = 2;
    s.police.units = [{ id: 'negotiator', kind: 'negotiator', vehicle: null, staging: 'east', arrived: s.turn - 2, pos: P(11, 5) }];
    s.police.mode = { kind: mode, left: 4, since: { turn: s.turn - 1, phase: 'world' }, after: mode === 'negotiate' ? 'contain' : null };
    // Tied, so no command lapses (a roll) while they are held.
    for (const n of s.npcs) n.status = 'tied';
    // Dex arrested (rules/wounds.ts `arrestCrew`): off the map, in a police van.
    const dex = s.crew.splice(s.crew.findIndex(c => c.id === 'dex'), 1)[0]!;
    dex.wounds = { ...dex.wounds, hp: 0, downed: { left: 2, turn: s.turn - 1, phase: 'world' } };
    dex.actionsLeft = 0;
    s.custody = [{ crew: dex, by: 'negotiator', turn: s.turn - 1 }];
    return { world, state: s };
}

/** Plays commands, each checked against its preview (nothing here rolls: they agree exactly). */
function run(world: ReadonlyWorld, state: State, ...cmds: Command[]): { state: State; events: SimEvent[] } {
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
const of = <K extends SimEvent['type']>(events: readonly SimEvent[], type: K) => events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
const release = (npc: string): Command => ({ type: 'negotiate', crew: 'jun', offer: 'release', npc });
const npcOf = (state: State, id: string) => state.npcs.find(n => n.id === id)!;

describe('the negotiator\'s call', () => {
    it('rings only in Negotiate with the negotiator out, once a crew phase', () => {
        const { world, state } = negotiating();
        expect(negotiatorCalling(state)).toBe(true);
        expect(whyNot(world, negotiating(7, 'contain').state, { type: 'negotiate', crew: 'jun', offer: 'hangUp' })).toBe('Nobody is calling');
        const away = clonePlain(state);
        away.police.units[0]!.pos = null;
        expect(negotiatorCalling(away)).toBe(false);
        const offers = legalActions(world, state, 'jun').filter(c => c.type === 'negotiate');
        expect(offers).toContainEqual({ type: 'negotiate', crew: 'jun', offer: 'stall' });
        expect(offers).toContainEqual({ type: 'negotiate', crew: 'jun', offer: 'release', npc: 'teller' });
        expect(offers).toContainEqual({ type: 'negotiate', crew: 'jun', offer: 'trade', npc: 'customer', member: 'dex' });
        const outside = clonePlain(state);
        outside.crew[0]!.pos = P(5, 4);
        expect(whyNot(world, outside, { type: 'negotiate', crew: 'jun', offer: 'hangUp' })).toBe('jun isn\'t inside, by a phone');
        const hung = run(world, state, { type: 'negotiate', crew: 'jun', offer: 'hangUp' });
        expect(hung.state.crew[0]!.actionsLeft).toBe(state.crew[0]!.actionsLeft - 1);
        expect(whyNot(world, hung.state, { type: 'negotiate', crew: 'jun', offer: 'stall' })).toBe('Nobody is calling');
        // It calls again as the next crew phase begins.
        const next = run(world, hung.state, endTurn);
        expect(of(next.events, 'negotiatorCalls')).toHaveLength(1);
        expect(negotiatorCalling(next.state)).toBe(true);
    });

    it('Stall: Negotiate runs 2 world phases longer, once a heist', () => {
        const { world, state } = negotiating();
        const stalled = run(world, state, { type: 'negotiate', crew: 'jun', offer: 'stall' });
        expect(stalled.state.police.mode!.left).toBe(6);
        expect(of(stalled.events, 'stalled')).toEqual([{ type: 'stalled', by: 2, left: 6 }]);
        const next = run(world, stalled.state, endTurn).state;
        expect(next.police.mode).toMatchObject({ kind: 'negotiate', left: 5 });
        expect(whyNot(world, next, { type: 'negotiate', crew: 'jun', offer: 'stall' })).toBe('The negotiator won\'t be stalled again');
    });
});

describe('a release', () => {
    it('takes 3 ticks off at once and the hostage walks out its way out, telling the police what it saw', () => {
        const { world, state } = negotiating();
        const { state: freed, events } = run(world, state, release('teller'));
        expect(freed.response!.heat).toBe(4);
        expect(freed.heat.releases).toEqual([state.turn]);
        expect(of(events, 'hostageReleased')).toEqual([{ type: 'hostageReleased', npc: 'teller', crew: 'jun', exit: P(0, 5), relief: 3, trade: false }]);
        const teller = npcOf(freed, 'teller');
        expect(teller.status).toBe('alerted');
        expect(teller.lapse).toEqual({ kind: 'released', exit: P(0, 5) });
        // Its walk is the intent the crew phase shows, toward the way out.
        expect(teller.intent.path.length).toBeGreaterThan(0);
        let s = freed;
        const all: SimEvent[] = [];
        for (let i = 0; i < 4 && npcOf(s, 'teller').status !== 'away'; i++) {
            const r = run(world, s, endTurn);
            all.push(...r.events);
            s = r.state;
        }
        expect(npcOf(s, 'teller').status).toBe('away');
        expect(of(all, 'npcLeft').map(e => e.npc)).toEqual(['teller']);
        // Reaching the police is no escape (+1), only the world phases' heat.
        expect(of(all, 'heatChanged').map(e => e.cause).filter(c => c !== 'phase')).toEqual([]);
        expect(s.negotiation.reports.map(r => r.npc)).toEqual(['teller']);
        expect(of(all, 'policeTold')).toHaveLength(1);
        // Gone for good: no schedule brings it back.
        expect(npcOf(run(world, s, endTurn).state, 'teller').status).toBe('away');
    });

    it('shows the capped relief and stops at three a heist', () => {
        const low = negotiating(1);
        const done = run(low.world, low.state, release('teller'));
        expect(of(done.events, 'hostageReleased')[0]!.relief).toBe(1);
        expect(done.state.response!.heat).toBe(0);
        const { world, state } = negotiating();
        state.heat.releases = [1, 2, 3].map(t => state.turn - t);
        expect(whyNot(world, state, release('teller'))).toBe('The heat falls for 3 releases a heist');
        expect(actionMenu(world, state, 'jun').find(e => e.id === 'negotiate:release')?.reason).toBe('The heat falls for 3 releases a heist');
    });

    it('lets go only a hostage the crew holds', () => {
        const { world, state } = negotiating();
        const customer = npcOf(state, 'customer');
        customer.status = 'commanded';
        customer.command = { pips: 2, by: 'jun' };
        expect(whyNot(world, state, release('customer'))).toBeUndefined();
        customer.status = 'calm';
        customer.command = null;
        expect(whyNot(world, state, release('customer'))).toBe('Only a hostage the crew holds can be let go');
        expect(whyNot(world, state, release('nobody'))).toBe('Only a hostage the crew holds can be let go');
    });

    it('frees a hostage led along where its escort stands', () => {
        const { world, state } = negotiating();
        const led = run(world, state, { type: 'move', crew: 'jun', path: [P(6, 1), P(7, 1)] }, { type: 'escort', crew: 'jun', npc: 'teller' }).state;
        expect(led.crew[0]!.dragging).toBe('teller');
        const next = run(world, led, endTurn).state;
        const go = run(world, next, release('teller')).state;
        expect(go.crew[0]!.dragging).toBeNull();
        expect(npcOf(go, 'teller').pos).toEqual(go.crew[0]!.pos);
    });

    it('a hostage walking out ignores commands, and killing it is a hostage killed', () => {
        const { world, state } = negotiating();
        const freed = run(world, state, release('teller')).state;
        const shout = run(world, freed, { type: 'command', crew: 'jun' });
        expect(of(shout.events, 'ignoredCommand').map(e => e.npc)).toContain('teller');
        expect(npcOf(shout.state, 'teller').lapse?.kind).toBe('released');
        const killed = run(world, freed, testCommand({ type: 'testKill', npc: 'teller' } as never));
        expect(of(killed.events, 'heatChanged').map(e => [e.cause, e.by])).toEqual([['civilianKilled', 5]]);
    });
});

describe('a trade', () => {
    /** Plays world phases until `done` holds (at most 6), gathering the events. */
    const until = (world: ReadonlyWorld, state: State, done: (s: State) => boolean) => {
        const all: SimEvent[] = [];
        for (let i = 0; i < 6 && !done(state); i++) {
            const r = run(world, state, endTurn);
            all.push(...r.events);
            state = r.state;
        }
        return { state, events: all };
    };
    const trade = { type: 'negotiate', crew: 'jun', offer: 'trade', npc: 'customer', member: 'dex' } as const;

    it('lets the hostage walk out without heat and hands the crew member back at its way out once it is out', () => {
        const { world, state } = negotiating();
        const { state: traded, events } = run(world, state, trade);
        expect(traded.response!.heat).toBe(7);
        expect(traded.heat.releases).toEqual([]);
        // Still in the van until the hostage is out, but traded for.
        expect(traded.custody.map(c => c.crew.id)).toEqual(['dex']);
        expect(tradeable(traded)).toEqual([]);
        expect(of(events, 'hostageReleased')).toEqual([{ type: 'hostageReleased', npc: 'customer', crew: 'jun', exit: P(0, 5), relief: 0, trade: true }]);
        const back = until(world, traded, s => s.crew.some(c => c.id === 'dex'));
        const out = back.events.findIndex(e => e.type === 'npcLeft' && e.npc === 'customer'), returned = back.events.findIndex(e => e.type === 'crewReturned');
        expect(out).toBeGreaterThanOrEqual(0);
        expect(returned).toBeGreaterThan(out);
        const dex = back.state.crew.find(c => c.id === 'dex')!;
        expect(back.events[returned]).toEqual({ type: 'crewReturned', crew: 'dex', at: dex.pos });
        expect(Math.max(Math.abs(dex.pos.x - 0), Math.abs(dex.pos.y - 5))).toBeLessThanOrEqual(1);
        expect(back.state.negotiation.returns).toEqual([]);
        expect(back.state.custody).toEqual([]);
        // Taken down, handed back down: no actions.
        expect(dex.actionsLeft).toBe(0);
        expect(whyNot(world, back.state, { type: 'negotiate', crew: 'jun', offer: 'trade', npc: 'teller', member: 'dex' })).toBe('Nobody of the crew is in custody to trade for');
    });

    it('can\'t be undone by taking the hostage again, and falls through if it never gets out', () => {
        const { world, state } = negotiating();
        const traded = run(world, state, trade).state;
        // Next to the hostage walking out: no knockout (so no tying), and commands are ignored.
        const beside = clonePlain(traded);
        beside.crew[0]!.pos = P(3, 1);
        expect(whyNot(world, beside, { type: 'knockout', crew: 'jun', npc: 'customer' })).toBe('They were let go: they walk out under the deal');
        expect(whyNot(world, beside, { type: 'zipTie', crew: 'jun', npc: 'customer' })).toBeDefined();
        // Killed on the way: the trade is off and Dex can be traded for again.
        const killed = run(world, traded, testCommand({ type: 'testKill', npc: 'customer' } as never)).state;
        const next = run(world, killed, endTurn);
        expect(of(next.events, 'tradeOff')).toEqual([{ type: 'tradeOff', crew: 'dex', npc: 'customer' }]);
        expect(of(next.events, 'crewReturned')).toEqual([]);
        expect(next.state.custody.map(c => c.crew.id)).toEqual(['dex']);
        expect(tradeable(next.state)).toEqual(['dex']);
    });

    it('a release can\'t be taken back either', () => {
        const { world, state } = negotiating();
        const freed = run(world, state, release('teller')).state;
        const beside = clonePlain(freed);
        beside.crew[0]!.pos = P(7, 1);
        expect(whyNot(world, beside, { type: 'knockout', crew: 'jun', npc: 'teller' })).toBe('They were let go: they walk out under the deal');
        expect(whyNot(world, beside, { type: 'zipTie', crew: 'jun', npc: 'teller' })).toBeDefined();
    });

    it('a wounded hostage let go crawls out and leaves, and tells', () => {
        const { world, state } = negotiating();
        const hurt = clonePlain(state);
        npcOf(hurt, 'customer').hp = 1;
        const freed = run(world, hurt, { ...release('customer') }).state;
        const walk = npcOf(freed, 'customer').intent.path;
        expect(walk.length).toBe(1);
        const out = until(world, freed, s => npcOf(s, 'customer').status === 'away');
        expect(npcOf(out.state, 'customer').status).toBe('away');
        expect(out.state.negotiation.reports.map(r => r.npc)).toEqual(['customer']);
        expect(of(out.events, 'policeTold')).toEqual([{ type: 'policeTold', npc: 'customer' }]);
    });
});

describe('the action grid', () => {
    it('offers the negotiator\'s offers with their effects while it calls, as the sim allows them', () => {
        const { world, state } = negotiating();
        const menu = actionMenu(world, state, 'jun');
        expect(menu.filter(e => e.id.startsWith('negotiate:')).map(e => [e.id, e.label, e.reason ?? ''])).toEqual([
            ['negotiate:release', 'Release (-3 heat)', ''], ['negotiate:trade', 'Trade for dex', ''], ['negotiate:stall', 'Stall (+2 turns)', ''], ['negotiate:hangUp', 'Hang up', '']
        ]);
        expect(menuIsLegal(world, state, 'jun', menu)).toBe(true);
        const tapped = actionMenu(world, state, 'jun', 'customer').find(e => e.id === 'negotiate:release')!;
        expect(tapped.command).toEqual(release('customer'));
        expect(actionMenu(world, negotiating(7, 'contain').state, 'jun').some(e => e.id.startsWith('negotiate:'))).toBe(false);
        expect(() => commit(world, state, menu[0]!.command)).not.toThrow();
    });
});
