import {
    assertPlainJson, clonePlain, commit, encodeBits, fixtureWorld, initialState, registerCommand, registerEvents, setDevChecks, type Command,
    type CommandType, type CommitResult, type Ctx, type EventClass, type ReadonlyWorld, type Reducer, type SimEvent, type State
} from '../../src/sim';

// Tests run the engine's development checks (previews checked for plain JSON, frozen undo snapshots and loads).
setDevChecks(true);

/*
 * Test-only commands and events, through a typed escape hatch rather than augmenting CommandMap or EventMap: an
 * augmentation in tests/ would add test members to the production `Command` and `SimEvent` unions.
 */
export type TestCommand = { type: string; crew?: string };

export const testCommand = (cmd: TestCommand): Command => cmd as unknown as Command;
export const testEvent = (event: { type: string } & Record<string, unknown>): SimEvent => event as unknown as SimEvent;

export function registerTestCommand(type: string, reduce: (ctx: Ctx, cmd: TestCommand) => void, options: { final?: boolean; placeholder?: boolean; replace?: boolean } = {}): void {
    registerCommand(type as CommandType, reduce as unknown as Reducer<CommandType>, options);
}

export function registerTestEvents(classes: Record<string, EventClass>): void {
    registerEvents(classes as Parameters<typeof registerEvents>[0]);
}

/** A small bank: a public lobby, a staff room behind a door and a secure closet behind glass. */
export function smallBank(): { world: ReadonlyWorld; state: State } {
    const world = fixtureWorld([
        '......sss',
        '..#...sTs',
        '......sxx'
    ], {
        zones: ['......sss', '......sss', '......sxx'],
        walls: [
            { between: [{ x: 5, y: 0 }, { x: 6, y: 0 }] },
            { between: [{ x: 5, y: 1 }, { x: 6, y: 1 }], door: { id: 'staffDoor', lock: 'mechanical' } },
            { between: [{ x: 5, y: 2 }, { x: 6, y: 2 }] },
            { between: [{ x: 7, y: 1 }, { x: 7, y: 2 }], material: 'glass' }
        ],
        people: [
            { id: 'teller', name: 'Kim', role: 'teller', observer: 'staff', pos: { x: 7, y: 0 }, facing: 's', schedule: [] },
            { id: 'guard', name: 'Ray', role: 'guard', observer: 'enforcer', pos: { x: 1, y: 1 }, facing: 'e', schedule: [] }
        ]
    });
    const state = initialState(world, {
        seed: 1234,
        crew: [{ id: 'jun', pos: { x: 0, y: 0 } }, { id: 'mara', pos: { x: 0, y: 2 }, facing: 'e' }]
    });
    return { world, state };
}

/** A heist's worth of commands across three turns. */
export const SCRIPT: Command[] = [
    { type: 'move', crew: 'jun', path: [{ x: 1, y: 0 }, { x: 2, y: 0 }] },
    { type: 'move', crew: 'mara', path: [{ x: 1, y: 2 }] },
    { type: 'wait', crew: 'jun' },
    { type: 'endTurn' },
    { type: 'move', crew: 'jun', path: [{ x: 3, y: 1 }, { x: 4, y: 1 }] },
    { type: 'endTurn' },
    { type: 'move', crew: 'mara', path: [{ x: 2, y: 2 }, { x: 3, y: 2 }] },
    { type: 'move', crew: 'mara', path: [{ x: 4, y: 2 }] },
    { type: 'endTurn' }
];

/** Commits a command and checks the new state is still plain JSON. */
export function step(world: ReadonlyWorld, state: State, cmd: Command): CommitResult {
    const result = commit(world, state, cmd);
    assertPlainJson(result.state);
    assertPlainJson(result.events);
    return result;
}

export function play(world: ReadonlyWorld, state: State, commands: readonly Command[]): State {
    return commands.reduce((s, cmd) => step(world, s, cmd).state, state);
}

/**
 * The state with the whole map already scouted and every NPC's routine known (rules/knowledge.ts), for tests about
 * something else: a move through it reveals nothing, so it stays undoable unless its own rules say otherwise.
 */
export function scouted(world: ReadonlyWorld, state: State): State {
    const s = clonePlain(state);
    s.knowledge.seen = encodeBits(new Uint8Array(world.width * world.height).fill(1));
    for (const n of s.npcs) {
        s.knowledge.npcs[n.id] = { at: { ...n.pos }, facing: n.facing, turn: s.turn, live: false, routine: true, watched: 3, watchedTurn: s.turn };
    }
    return s;
}
