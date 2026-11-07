import { describe, expect, it } from 'vitest';
import {
    actionPreview, clonePlain, commit, doorStatus, fixtureWorld, freezeWorld, initialState, legalActions, preview, projectPreviewEvents, whyNot, type Command,
    type CrewStart, type FixtureWall, type OpportunityDef, type PersonDef, type Pos, type ReadonlyWorld, type SimEvent, type State, type WorldObject
} from '../../src/sim';
import { reactionOf } from '../../src/sim/rules/npc/behaviour';
import { actionMenu } from '../../src/game/actions';
import { describeEvent, journalView } from '../../src/game/views';
import { scouted, step } from './helpers';

/*
 * Opportunities as mechanics (§17.6; implementation plan M5-02, decisions 380–388): found by eavesdropping, documents
 * and intel, and what they wire in (the bribe, the propped fire door, the IT tech's card, the vault code note; the
 * drawer keycard is tests/sim/phones.test.ts's). Nothing of an opportunity shows before it is found.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const of = <K extends SimEvent['type']>(events: readonly SimEvent[], type: K) => events.filter((e): e is Extract<SimEvent, { type: K }> => e.type === type);
const endTurn = { type: 'endTurn' } as const;
const npc = (state: State, id: string) => state.npcs.find(n => n.id === id)!;
const person = (id: string, role: string, at: Pos, more: Partial<PersonDef> = {}): PersonDef => ({
    id, name: id, role, observer: 'staff', pos: at, facing: 's',
    schedule: [{ from: 1, activity: role === 'teller' ? 'window' : 'post', label: 'at post', room: 'p', at, facing: 's' }], ...more
});

function world(rows: string[], options: Parameters<typeof fixtureWorld>[1], opportunities: OpportunityDef[]): ReadonlyWorld {
    return freezeWorld({ ...fixtureWorld(rows, options), opportunities });
}

const start = (w: ReadonlyWorld, crew: (CrewStart & { traits?: string[] })[]): State => clonePlain(initialState(w, { seed: 3, crew }));

/** Commits, checking the preview said the same; and what a preview shows never names an opportunity. */
function act(w: ReadonlyWorld, state: State, cmd: Command) {
    const seen = preview(w, state, cmd), done = step(w, state, cmd), shown = actionPreview(w, state, cmd);
    expect(seen.events).toEqual(done.events);
    if (!shown.ok) throw new Error(shown.reason);
    expect(shown.undoable).toBe(done.undoable);
    expect(projectPreviewEvents(w, state, seen).some(e => e.type === 'opportunityFound')).toBe(false);
    return done;
}

// A public floor: the teller in debt at her window (4, 1), a clerk at (3, 1); a wall between (6, 1) and (7, 1).
const FLOOR = ['........', '........', '........', '........'];
const BRIBE: OpportunityDef = { id: 'bribe', text: 'Tess, a teller, is in debt.', found: 'eavesdropping', speakers: ['tess'], npc: 'tess', at: P(4, 1) };
const floor = (opportunities: OpportunityDef[] = [BRIBE]) => world(FLOOR, {
    zones: FLOOR.map(r => r.replace(/\./g, '.')), rooms: FLOOR.map(r => r.replace(/\./g, '.')),
    walls: [{ between: [P(6, 1), P(7, 1)] }],
    people: [person('tess', 'teller', P(4, 1)), person('clerk', 'clerk', P(3, 1))]
}, opportunities);

describe('eavesdropping (§17.6)', () => {
    it('overhears a calm speaker within 2 tiles, in sight, for a whole turn; the journal tells it', () => {
        const w = floor(), state = start(w, [{ id: 'mara', pos: P(4, 3) }]);
        expect(journalView(w, state, 'full').entries).toEqual([]);
        const done = step(w, state, endTurn);
        expect(of(done.events, 'opportunityFound')).toEqual([{ type: 'opportunityFound', opportunity: 'bribe', crew: 'mara', how: 'overheard' }]);
        expect(done.state.opportunitiesFound).toEqual([{ id: 'bribe', how: 'overheard', turn: 1 }]);
        expect(describeEvent(w, done.state, of(done.events, 'opportunityFound')[0]!)).toBe('mara overheard something');
        const journal = journalView(w, done.state, 'full');
        expect(journal.entries.map(e => [e.id, e.text, e.how, e.pos])).toEqual([['bribe', BRIBE.text, 'overheard', P(4, 1)]]);
        // Minimal guidance tells the same, without where.
        expect(journalView(w, done.state, 'minimal').entries[0]!.pos).toBeNull();
    });

    it('hears nothing from 3 tiles, through a wall, or from a speaker who isn\'t calm', () => {
        const w = floor();
        expect(step(w, start(w, [{ id: 'mara', pos: P(1, 3) }]), endTurn).state.opportunitiesFound).toEqual([]);
        expect(step(w, start(w, [{ id: 'mara', pos: P(7, 3) }]), endTurn).state.opportunitiesFound).toEqual([]);
        const walled = world(FLOOR, {
            zones: FLOOR.map(r => r.replace(/\./g, '.')), rooms: FLOOR.map(r => r.replace(/\./g, '.')),
            walls: [{ between: [P(4, 1), P(4, 2)] }, { between: [P(3, 1), P(3, 2)] }, { between: [P(5, 1), P(5, 2)] }],
            people: [person('tess', 'teller', P(4, 1))]
        }, [BRIBE]);
        expect(step(walled, start(walled, [{ id: 'mara', pos: P(4, 3) }]), endTurn).state.opportunitiesFound).toEqual([]);
        const curious = start(w, [{ id: 'mara', pos: P(4, 3) }]);
        npc(curious, 'tess').status = 'curious';
        expect(step(w, curious, endTurn).state.opportunitiesFound).toEqual([]);
    });
});

describe('the bribe (§17.6, §7.2)', () => {
    const bribe = (who = 'tess'): Command => ({ type: 'bribe', crew: 'mara', npc: who });

    it('is refused alike before it is found and for anyone else; once found, a Smooth Talker bribes her and she stays off the alarm', () => {
        const w = floor(), state = start(w, [{ id: 'mara', pos: P(4, 2), traits: ['smoothTalker'] }]);
        expect(whyNot(w, state, bribe())).toBe('They won\'t take a bribe');
        expect(whyNot(w, state, bribe('clerk'))).toBe('They won\'t take a bribe');
        expect(legalActions(w, state, 'mara').some(c => c.type === 'bribe')).toBe(false);
        expect(actionMenu(w, scouted(w, state), 'mara').some(e => e.id === 'bribe')).toBe(false);
        state.opportunitiesFound = [{ id: 'bribe', how: 'overheard', turn: 1 }];
        expect(whyNot(w, state, bribe('clerk'))).toBe('They won\'t take a bribe');
        const plain = clonePlain(state);
        plain.crew[0]!.traits = [];
        expect(whyNot(w, plain, bribe())).toBe('mara isn\'t a Smooth Talker');
        expect(actionMenu(w, scouted(w, state), 'mara').find(e => e.id === 'bribe')?.command).toEqual(bribe());
        const want = { kind: 'react' as const, crew: 'mara', tile: P(4, 2), decided: { turn: 1, phase: 'crew' as const } };
        expect(reactionOf(w, state, npc(state, 'tess'), want).action?.kind).toBe('raiseAlarm');
        const done = act(w, state, bribe());
        expect(of(done.events, 'bribed')).toEqual([{ type: 'bribed', crew: 'mara', npc: 'tess' }]);
        expect(npc(done.state, 'tess').bribed).toBe(true);
        expect(reactionOf(w, done.state, npc(done.state, 'tess'), want).action).toBeNull();
        expect(whyNot(w, done.state, bribe())).toBe('Bribed already');
    });
});

// An office with the papers on the manager's desk (the vault code note) and a document that tells nothing.
const DOCS: WorldObject[] = [
    { id: 'note', kind: 'document', pos: P(1, 1), facing: 's', room: 'p', name: 'A note by a monitor' },
    { id: 'blank', kind: 'document', pos: P(5, 1), facing: 's', room: 'p', name: 'The records' }
];
const NOTE: OpportunityDef = { id: 'sticky-note', text: 'A note has the vault code on it.', found: 'documents', document: 'note', part: 'whole' };

describe('documents (§17.6)', () => {
    const read = (object: string): Command => ({ type: 'interact', crew: 'jun', object, verb: 'read' });

    it('reading one tells what is written in it (the note: its part of the code); final whatever it told', () => {
        const w = world(FLOOR, { zones: FLOOR.map(r => r.replace(/\./g, 's')), objects: DOCS }, [NOTE]);
        const state = start(w, [{ id: 'jun', pos: P(1, 2) }, { id: 'kim', pos: P(5, 2) }]);
        expect(actionMenu(w, scouted(w, state), 'jun').find(e => e.id === 'read')?.label).toBe('Read');
        const done = act(w, state, read('note'));
        expect(done.undoable).toBe(false);
        expect(of(done.events, 'opportunityFound')).toEqual([{ type: 'opportunityFound', opportunity: 'sticky-note', crew: 'jun', how: 'read' }]);
        expect(done.state.codesKnown).toEqual(['whole']);
        expect(whyNot(w, done.state, read('note'))).toBe('Read already');
        const blank = act(w, state, { type: 'interact', crew: 'kim', object: 'blank', verb: 'read' });
        expect(blank.undoable).toBe(false);
        expect(of(blank.events, 'opportunityFound')).toEqual([]);
    });
});

describe('the intel (§17.4)', () => {
    it('tells what only intel finds, and what nothing else in this bank would', () => {
        const objects: WorldObject[] = [
            { id: 'wall', kind: 'depositBoxes', pos: P(1, 0), facing: 's', room: 'd' },
            { id: 'haul', kind: 'loot', pos: P(1, 1), facing: 's', room: 'd', loot: { value: 10000, weight: 'heavy', behind: 'depositWall' } },
            { id: 'box-0', kind: 'loot', pos: P(1, 1), facing: 's', room: 'd', loot: { value: 5000, weight: 'light', behind: 'depositBox', intel: true } },
            ...DOCS
        ];
        const opportunities: OpportunityDef[] = [
            { id: 'it-tech', text: 'An IT tech visits.', found: 'intel', turn: 5 },
            { id: 'records', text: 'The records room files the rota.', found: 'documents', document: 'gone' },
            { id: 'check-in', text: 'Nobody here to say it.', found: 'eavesdropping', speakers: ['ghost'] },
            NOTE
        ];
        const w = world(['......', '......', '......'], { zones: ['xxxxxx', 'xxxxxx', 'xxxxxx'], rooms: ['dddddd', 'dddddd', 'dddddd'], objects }, opportunities);
        const state = start(w, [{ id: 'jun', pos: P(1, 1), items: ['lockpick'], traits: ['steadyHands'] }]);
        const done = act(w, state, { type: 'interact', crew: 'jun', object: 'wall', verb: 'pick' });
        expect(of(done.events, 'opportunityFound').map(e => [e.opportunity, e.how])).toEqual([['it-tech', 'intel'], ['records', 'intel'], ['check-in', 'intel']]);
        expect(done.state.opportunitiesFound.map(o => o.id)).toEqual(['it-tech', 'records', 'check-in']);
    });
});

describe('the propped fire door (§17.6)', () => {
    // Inside (staff, rows 0–3) and the alley (row 4) with the back door between (2, 3) and (2, 4); the operator's post at
    // (2, 1), his smoke break at (2, 4) from turn 2 to 4.
    const ROWS = ['.....', '.....', '.....', '.....', '.....'];
    const op = person('op', 'operator', P(2, 1), {
        schedule: [
            { from: 1, activity: 'post', label: 'at the console', room: 'b', at: P(2, 1), facing: 's' },
            { from: 2, activity: 'smokeBreak', label: 'smoke break', room: 'a', at: P(2, 4), facing: 's' },
            { from: 4, activity: 'post', label: 'back at the console', room: 'b', at: P(2, 1), facing: 's' }
        ]
    });
    const w = world(ROWS, {
        zones: ['sssss', 'sssss', 'sssss', 'sssss', '.....'], rooms: ['bbbbb', 'bbbbb', 'bbbbb', 'bbbbb', 'aaaaa'],
        walls: [
            ...[0, 1, 3, 4].map((x): FixtureWall => ({ between: [P(x, 3), P(x, 4)] })),
            { between: [P(2, 3), P(2, 4)], door: { id: 'back', lock: 'mechanical', start: 'locked' } }
        ],
        people: [op]
    }, [{ id: 'smoke-break', text: 'The operator props the fire door.', found: 'eavesdropping', turn: 2, until: 4, speakers: ['op'], door: 'back', npc: 'op', at: P(2, 4) }]);

    it('is wedged open while he smokes, whatever the crew knows, and shut and locked once he is back in', () => {
        let s = start(w, [{ id: 'jun', pos: P(4, 4) }]);
        const statuses: string[] = [];
        for (let i = 0; i < 6; i++) {
            s = step(w, s, endTurn).state;
            statuses.push(`${s.turn}:${doorStatus(w, s, 'back')}${s.doors.back?.propped ? '+' : ''}`);
        }
        expect(statuses).toContain('3:open+');
        expect(statuses).toContain('4:open+');
        expect(statuses.at(-1)).toBe('7:locked');
    });

    it('stays propped if he never comes back in', () => {
        let s = start(w, [{ id: 'jun', pos: P(4, 4) }]);
        while (!s.doors.back?.propped) s = step(w, s, endTurn).state;
        npc(s, 'op').status = 'unconscious';
        for (let i = 0; i < 4; i++) s = step(w, s, endTurn).state;
        expect([doorStatus(w, s, 'back'), s.doors.back!.propped, s.doors.back!.proppedBy]).toEqual(['open', true, 'op']);
    });
});

describe('the IT tech\'s card (§17.6)', () => {
    it('logs into the alarm panel without a kit, and kills it in one action', () => {
        const rows = ['....', '....', '....'];
        const w = world(rows, {
            zones: rows.map(r => r.replace(/\./g, 'x')), objects: [{ id: 'panel', kind: 'alarmPanel', pos: P(1, 0), facing: 's' }],
            people: [person('tech', 'technician', P(3, 2)), person('clerk', 'clerk', P(0, 2))]
        }, []);
        const state = start(w, [{ id: 'jun', pos: P(1, 1) }]);
        const disable: Command = { type: 'interact', crew: 'jun', object: 'panel', verb: 'disable' };
        expect(whyNot(w, state, disable)).toBe('jun has no hacking kit');
        state.crew[0]!.keycards = ['clerk'];
        expect(whyNot(w, state, disable)).toBe('jun has no hacking kit');
        state.crew[0]!.keycards = ['clerk', 'tech'];
        const done = commit(w, state, disable);
        expect(of(done.events, 'panelDisabled').length).toBe(1);
        expect(done.state.crew[0]!.actionsLeft).toBe(1);
    });
});
