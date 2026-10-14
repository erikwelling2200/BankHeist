import { IllegalCommand } from './engine';
import { inBounds } from './grid';
import { sortedIds } from './json';
import type { CameraState, CrewState, DoorState, EdgeKey, EdgeProps, Facing, NpcState, Pos, ReadonlyWorld, State } from './types';

/*
 * The state a heist starts in, built from the World and the crew the player brought, and lookups reducers share.
 */

export interface CrewStart { id: string; name?: string; pos: Pos; facing?: Facing; items?: string[] }

export function initialState(world: ReadonlyWorld, options: { seed: number; crew: readonly CrewStart[] }): State {
    const ids = new Set<string>();
    const place = (kind: string, id: string, pos: Pos): void => {
        if (ids.has(id)) throw new Error(`Two people have the id '${id}'`);
        ids.add(id);
        if (!inBounds(world, pos)) throw new Error(`${kind} '${id}' starts off the map at (${pos.x}, ${pos.y})`);
    };
    const crew: CrewState[] = options.crew.map(c => {
        place('Crew member', c.id, c.pos);
        return {
            id: c.id,
            name: c.name ?? c.id,
            pos: { x: c.pos.x, y: c.pos.y },
            facing: c.facing ?? 'n',
            actionsLeft: world.rules.actionsPerTurn,
            loadout: { items: [...(c.items ?? [])] }
        };
    });
    const npcs: NpcState[] = world.people.map(p => {
        place('NPC', p.id, p.pos);
        return {
            id: p.id,
            pos: { x: p.pos.x, y: p.pos.y },
            facing: p.facing,
            status: 'calm',
            suspicion: {},
            exposedTo: [],
            intent: { path: [] }
        };
    });
    const doors: Record<string, DoorState> = {};
    for (const id of sortedIds(world.doors)) doors[id] = { status: world.doors[id]!.start };
    const cameras: Record<string, CameraState> = {};
    for (const c of world.cameras) cameras[c.id] = { facing: 0, live: true };
    return {
        turn: 1,
        phase: 'crew',
        bank: { loud: false, alarm: false },
        crew, npcs, doors,
        edges: {},
        objects: {},
        cameras,
        carriers: [],
        seed: options.seed >>> 0,
        rng: {},
        dice: [],
        nextId: 1
    };
}

/**
 * What passes an edge now: the World's wall with the heist's overrides, and nothing at all through an open or breached
 * door. Undefined where there is no wall.
 */
export function edgeNow(world: ReadonlyWorld, state: State, key: EdgeKey): EdgeProps | undefined {
    const built = world.edges[key];
    if (!built) return undefined;
    const now: EdgeProps = { material: built.material, blocksSight: built.blocksSight, blocksMove: built.blocksMove, ...state.edges[key] };
    const door = built.door && state.doors[built.door]?.status;
    if (door === 'open' || door === 'breached') return { ...now, blocksSight: false, blocksMove: false };
    return now;
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
