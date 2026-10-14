import { IllegalCommand } from './engine';
import type { CameraState, CrewState, DoorState, Facing, NpcState, Pos, State, World } from './types';

/*
 * The state a heist starts in, built from the World and the crew the player brought, and lookups reducers share.
 */

export interface CrewStart { id: string; name?: string; pos: Pos; facing?: Facing; items?: string[] }

export function initialState(world: World, options: { seed: number; crew: readonly CrewStart[] }): State {
    const crew: CrewState[] = options.crew.map(c => ({
        id: c.id,
        name: c.name ?? c.id,
        pos: { ...c.pos },
        facing: c.facing ?? 'n',
        actionsLeft: world.rules.actionsPerTurn,
        loadout: { items: [...(c.items ?? [])] }
    }));
    const npcs: NpcState[] = world.people.map(p => ({
        id: p.id,
        pos: { ...p.pos },
        facing: p.facing,
        status: 'calm',
        suspicion: {},
        exposedTo: [],
        intent: { kind: 'idle' }
    }));
    const doors: Record<string, DoorState> = {};
    for (const d of Object.values(world.doors)) doors[d.id] = { open: d.open, locked: d.locked };
    const cameras: Record<string, CameraState> = {};
    for (const c of world.cameras) cameras[c.id] = { facing: 0, live: true };
    return {
        turn: 1,
        phase: 'crew',
        bank: { loud: false, alarm: false },
        crew, npcs, doors, cameras,
        carriers: [],
        seed: options.seed >>> 0,
        rng: {},
        dice: [],
        nextId: 1
    };
}

/** The crew member a command names, or an IllegalCommand. */
export function crewMember(state: State, id: string): CrewState {
    const member = state.crew.find(c => c.id === id);
    if (!member) throw new IllegalCommand(`No crew member '${id}'`);
    return member;
}

/** Spends a crew member's actions, or refuses when they don't have enough left. */
export function spendActions(member: CrewState, cost: number): void {
    if (member.actionsLeft < cost) throw new IllegalCommand(`${member.name} has ${member.actionsLeft} of ${cost} actions left`);
    member.actionsLeft -= cost;
}

/** A new id for something made during play ('carrier-3'), the same on every replay. */
export function newId(state: State, prefix: string): string {
    return `${prefix}-${state.nextId++}`;
}
