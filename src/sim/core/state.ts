import { IllegalCommand } from './engine';
import { inBounds } from './grid';
import { isReservedKey, sortedIds } from './json';
import {
    DEFAULT_RULES, type CameraState, type CrewState, type DeepReadonly, type DoorState, type EdgeKey, type EdgeProps,
    type Facing, type NpcState, type PersonDef, type Pos, type ReadonlyWorld, type Rules, type State
} from './types';

/*
 * The state a heist starts in, built from the World and the crew the player brought, and lookups reducers share.
 * A package that adds fields to `State`, `NpcState` or `CrewState` (by augmenting them) fills them in from its own
 * module with `registerStateInit`, `registerNpcInit` or `registerCrewInit`; they run in order of name, so the result
 * doesn't depend on the order modules were imported in. A package that adds rule numbers registers their defaults.
 */

export type StateInit = (world: ReadonlyWorld, state: State) => void;
export type NpcInit = (world: ReadonlyWorld, person: DeepReadonly<PersonDef>, npc: NpcState) => void;
export type CrewInit = (world: ReadonlyWorld, start: CrewStart, member: CrewState) => void;

const STATE_INITS = new Map<string, StateInit>();
const NPC_INITS = new Map<string, NpcInit>();
const CREW_INITS = new Map<string, CrewInit>();
const RULE_DEFAULTS: Record<string, unknown> = {};

function register<F>(inits: Map<string, F>, kind: string, name: string, init: F): void {
    if (inits.has(name)) throw new Error(`There is already a ${kind} init named '${name}'`);
    inits.set(name, init);
}

/** Fills in a package's fields of a new heist's state, after every NPC and crew member is made. */
export const registerStateInit = (name: string, init: StateInit): void => register(STATE_INITS, 'state', name, init);
/** Fills in a package's fields of each new NPC. */
export const registerNpcInit = (name: string, init: NpcInit): void => register(NPC_INITS, 'NPC', name, init);
/** Fills in a package's fields of each crew member. */
export const registerCrewInit = (name: string, init: CrewInit): void => register(CREW_INITS, 'crew', name, init);

const inOrder = <F>(inits: Map<string, F>): F[] => [...inits.keys()].sort().map(k => inits.get(k)!);

/** Registers a package's rule numbers; a number registered twice must have the same value. */
export function registerRuleDefaults(defaults: Partial<Rules>): void {
    for (const key of sortedIds(defaults)) {
        const value = (defaults as Record<string, unknown>)[key];
        if (Object.hasOwn(DEFAULT_RULES, key) || (Object.hasOwn(RULE_DEFAULTS, key) && RULE_DEFAULTS[key] !== value)) {
            throw new Error(`The rule '${key}' already has a default`);
        }
        RULE_DEFAULTS[key] = value;
    }
}

/** Every rule number at its default: the engine's and every registered package's. World builders start from this. */
export function defaultRules(): Rules {
    return { ...DEFAULT_RULES, ...RULE_DEFAULTS } as Rules;
}

/** The fields of `State` the engine fills in itself; packages fill in theirs with `registerStateInit`. */
type CoreStateKey = 'turn' | 'phase' | 'bank' | 'crew' | 'npcs' | 'doors' | 'edges' | 'objects' | 'cameras' | 'carriers' | 'seed' | 'rng' | 'dice' | 'nextId';

export interface CrewStart { id: string; name?: string; pos: Pos; facing?: Facing; items?: string[] }

export function initialState(world: ReadonlyWorld, options: { seed: number; crew: readonly CrewStart[] }): State {
    const ids = new Set<string>();
    const place = (kind: string, id: string, pos: Pos): void => {
        if (ids.has(id)) throw new Error(`Two people have the id '${id}'`);
        if (isReservedKey(id)) throw new Error(`'${id}' can't be an id`);
        ids.add(id);
        if (!inBounds(world, pos)) throw new Error(`${kind} '${id}' starts off the map at (${pos.x}, ${pos.y})`);
    };
    const crewInits = inOrder(CREW_INITS), npcInits = inOrder(NPC_INITS);
    const crew: CrewState[] = options.crew.map(c => {
        place('Crew member', c.id, c.pos);
        // Packages' own fields are filled in by their crew inits, just below.
        const member: Pick<CrewState, 'id' | 'name' | 'pos' | 'facing' | 'actionsLeft' | 'loadout'> = {
            id: c.id,
            name: c.name ?? c.id,
            pos: { x: c.pos.x, y: c.pos.y },
            facing: c.facing ?? 'n',
            actionsLeft: world.rules.actionsPerTurn,
            loadout: { items: [...(c.items ?? [])] } as CrewState['loadout']
        };
        for (const init of crewInits) init(world, c, member as CrewState);
        return member as CrewState;
    });
    const npcs: NpcState[] = world.people.map(p => {
        place('NPC', p.id, p.pos);
        // Packages' own fields are filled in by their NPC inits, just below.
        const npc: Pick<NpcState, 'id' | 'pos' | 'facing' | 'status' | 'suspicion' | 'exposedTo' | 'intent'> = {
            id: p.id,
            pos: { x: p.pos.x, y: p.pos.y },
            facing: p.facing,
            status: 'calm',
            suspicion: {},
            exposedTo: [],
            intent: { path: [] }
        };
        for (const init of npcInits) init(world, p, npc as NpcState);
        return npc as NpcState;
    });
    const doors: Record<string, DoorState> = {};
    for (const id of sortedIds(world.doors)) doors[id] = { status: world.doors[id]!.start };
    const cameras: Record<string, CameraState> = {};
    for (const c of world.cameras) cameras[c.id] = { facing: 0, live: true, loopedUntil: null };
    // Packages' own fields are filled in by their state inits, just below.
    const state: Pick<State, CoreStateKey> = {
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
    for (const init of inOrder(STATE_INITS)) init(world, state as State);
    return state as State;
}

/**
 * What passes an edge now: the World's wall with the heist's overrides, and nothing at all through an open or breached
 * door. Undefined where there is no wall.
 */
export function edgeNow(world: ReadonlyWorld, state: State, key: EdgeKey): EdgeProps | undefined {
    const built = world.edges[key];
    if (!built) return undefined;
    const now: EdgeProps = { material: built.material, blocksSight: built.blocksSight, blocksMove: built.blocksMove };
    if (Object.hasOwn(state.edges, key)) Object.assign(now, state.edges[key]);
    const door = built.door && Object.hasOwn(state.doors, built.door) ? state.doors[built.door]!.status : undefined;
    if (door === 'open' || door === 'breached') return { ...now, blocksSight: false, blocksMove: false };
    return now;
}

/** The crew member a command names, or an IllegalCommand. */
export function crewMember(state: State, id: string): CrewState {
    const member = state.crew.find(c => c.id === id);
    if (!member) throw new IllegalCommand(`No crew member '${id}'`);
    return member;
}

/** Why a crew member can't act at all now (downed, dead: rules/wounds.ts), or undefined. */
export type ActorCheck = (member: DeepReadonly<CrewState>) => string | undefined;

const ACTOR_CHECKS = new Map<string, ActorCheck>();

/** Adds a reason a crew member can't take any action (checks run by name, before each action's own `whyNot`). */
export function registerActorCheck(name: string, check: ActorCheck): void {
    if (ACTOR_CHECKS.has(name)) throw new Error(`Actor check '${name}' already exists`);
    ACTOR_CHECKS.set(name, check);
}

/** Why a crew member can't act at all now, or undefined: what every action, Move and Dash refuse with first. */
export function actorRefusal(member: DeepReadonly<CrewState>): string | undefined {
    for (const name of [...ACTOR_CHECKS.keys()].sort()) {
        const reason = ACTOR_CHECKS.get(name)!(member);
        if (reason) return reason;
    }
    return undefined;
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
