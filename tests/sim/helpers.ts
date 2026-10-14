import { assertPlainJson, commit, fixtureWorld, initialState, type Command, type CommitResult, type ReadonlyWorld, type State } from '../../src/sim';

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
