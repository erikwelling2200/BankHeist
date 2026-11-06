import type { Ctx } from '../core/engine';
import { edgeBetween, edgeKey, FACING_STEP, samePos } from '../core/grid';
import { sortedIds } from '../core/json';
import { crewMember, edgeNow, registerCrewInit, registerRuleDefaults } from '../core/state';
import type { CrewState, DeepReadonly, DoorStatus, EdgeKey, EdgeState, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { FLIP_PIPS } from '../data/weapons';
import { npcObserver, seesOn } from '../geo/cones';
import { sightMap } from '../geo/los';
import { doorStatus } from '../geo/move';
import { makeNoise } from '../geo/sound';
import { registerStateCheck } from '../core/save';
import { lacksActions, registerAction } from './actions/act';
import { addSuspicion, isEyesDown } from './suspicion';

/*
 * Fortifying (GAME_DESIGN §14.3, §13.5; implementation plan M4-02, decisions 220–226). The crew works on a wall segment
 * from either tile beside it (`fortify { crew, edge, action }`); what it changes lives on the edge (`State.edges`, the
 * fields `barricade`, `blinds` and `reinforced` of `EdgeProps`), so sight, movement, sound and bullets read it through
 * `edgeNow` like any other change to a wall.
 *
 * - **Barricade** a door or a window (1 action, hands free, unlimited: furniture is everywhere, decision 220): a shut
 *   door (closed or locked; not the vault's, a jammed or a blown one) or a pane of glass that isn't a door. It blocks
 *   movement and sight whatever the door does (`edgeNow`), and nobody opens the door behind it; bullets pass it as half
 *   cover for the tiles either side (geo/shot.ts), what it stands in still stops or slows them as before. It has
 *   `rules.barricadeHp` (2) hit points against the police (§13.5), who break it announced, like a breach (rules/routine.ts).
 *   **Clear** takes it down again (1 action, hands free, as noisy and suspicious). While the police have a strike or
 *   a breach announced at a door, the crew can't barricade, clear or reinforce it: what is announced happens; the last
 *   strike breaks the door with it, so a barricade can't be put up again and again (decision 223).
 * - **Reinforce** a Soft wall or door (`rules.reinforceActions` 2 actions, one use of a reinforcement kit's
 *   `rules.reinforceUses` 2, `CrewState.reinforcements`): its material becomes Reinforced, so bullets stop and sound
 *   doesn't carry (§14.2, §8.9; through a door either, decision 222). A door so is barred shut for everyone: only heavy
 *   SWAT break it; a door must be shut to be reinforced. A wall's can't be undone; a door's bar is lifted (**Unbar**,
 *   1 action) from the side it was put on (`EdgeProps.barredFrom`), where the bar is, and the kit's use is spent.
 * - **Blinds** on a window (1 action, quiet): down, the pane blocks sight both ways, so the street (the patrol car's
 *   drive-by, rules/checkins.ts) sees nothing inside; up again the same.
 *
 * Barricading, clearing, reinforcing and unbarring make a quiet noise (`barricade`, `reinforce`, 4) and, seen during stealth, cost the
 * suspicion of flipping a table (`FLIP_PIPS`, §11.4): people don't move furniture against a bank's doors for no reason.
 * Blinds make none. Nothing here rolls a die, so every preview is the outcome.
 */

export type FortifyAction = 'barricade' | 'clear' | 'reinforce' | 'unbar' | 'lowerBlinds' | 'raiseBlinds';

export const FORTIFY_ACTIONS: readonly FortifyAction[] = ['barricade', 'clear', 'reinforce', 'unbar', 'lowerBlinds', 'raiseBlinds'];

/** The kit that reinforces (§12.2 "Reinforcement kit ×2"). */
export const REINFORCEMENT_KIT = 'reinforcementKit';

declare module '../core/types' {
    interface Rules {
        /** A barricade's hit points against the police (§13.5: 2). */
        barricadeHp: number;
        /** Actions reinforcing a wall or door takes (§14.3: 2). */
        reinforceActions: number;
        /** Uses of each reinforcement kit (§12.2: ×2). */
        reinforceUses: number;
    }
    interface CrewState {
        /** Reinforcements left: the kits carried at the start times `rules.reinforceUses`. */
        reinforcements: number;
    }
    interface CommandMap {
        /** Barricade, clear, reinforce, or lower or raise the blinds on a wall segment beside the crew member (§14.3). */
        fortify: { crew: string; edge: EdgeKey; action: FortifyAction };
    }
    interface EventMap {
        /** The crew barricaded a door or window. */
        barricaded: { crew: string; edge: EdgeKey };
        /** The crew took a barricade down. */
        barricadeCleared: { crew: string; edge: EdgeKey };
        /** The crew reinforced a Soft wall or door: it is Reinforced now. */
        reinforced: { crew: string; edge: EdgeKey };
        /** The crew lifted the bar off a door it reinforced. */
        unbarred: { crew: string; edge: EdgeKey };
        /** The crew lowered (`down`) or raised the blinds on a window. */
        blinds: { crew: string; edge: EdgeKey; down: boolean };
        /** An officer struck a barricade on a door it announced (rules/routine.ts): `left` hit points, gone at 0. */
        barricadeStruck: { door: string; edge: EdgeKey; unit: string; left: number };
    }
}

registerRuleDefaults({ barricadeHp: 2, reinforceActions: 2, reinforceUses: 2 });

// After 'profile', which fills in the packed items.
registerCrewInit('reinforcements', (world, _start, member) => {
    const kits = [...member.loadout.items, ...member.loadout.packed].filter(i => i === REINFORCEMENT_KIT).length;
    member.reinforcements = kits * world.rules.reinforceUses;
});

/**
 * Spends one reinforcement (decision 263): a kit whose uses are all spent comes off the crew member, its profile with it
 * (as the last grenade does), so they carry only the kits they still have uses of.
 */
function spendReinforcement(world: ReadonlyWorld, member: CrewState): void {
    member.reinforcements--;
    const uses = world.rules.reinforceUses;
    const kits = [...member.loadout.items, ...member.loadout.packed].filter(i => i === REINFORCEMENT_KIT).length;
    if (kits * uses - member.reinforcements < uses) return;
    const i = member.loadout.items.indexOf(REINFORCEMENT_KIT);
    if (i >= 0) member.loadout.items.splice(i, 1);
    else member.loadout.packed.splice(member.loadout.packed.indexOf(REINFORCEMENT_KIT), 1);
}

registerStateCheck('fortify', raw => {
    const crew = (raw as unknown as Partial<State>).crew ?? [];
    for (const c of crew) if (typeof c.reinforcements !== 'number') return `crew member ${c.id} has no reinforcements (saved by an older build)`;
    return undefined;
});

/** The two tiles either side of an edge: north or west of it, then south or east. */
export function edgeSides(world: ReadonlyWorld, key: EdgeKey): [Pos, Pos] | undefined {
    const e = world.edges[key];
    if (!e) return undefined;
    return [e.run === 'eastWest' ? { x: e.tx, y: e.ty - 1 } : { x: e.tx - 1, y: e.ty }, { x: e.tx, y: e.ty }];
}

/** Whether `p` is one of the two tiles beside an edge. */
export const besideEdge = (world: ReadonlyWorld, key: EdgeKey, p: DeepReadonly<Pos>): boolean => !!edgeSides(world, key)?.some(s => samePos(s, p));

/** The wall segments on the four sides of a tile, north, east, south, west. */
export function edgesAround(world: ReadonlyWorld, p: DeepReadonly<Pos>): EdgeKey[] {
    const out: EdgeKey[] = [];
    for (const f of ['n', 'e', 's', 'w'] as const) {
        const key = edgeKey(edgeBetween(p, { x: p.x + FACING_STEP[f].x, y: p.y + FACING_STEP[f].y }));
        if (Object.hasOwn(world.edges, key)) out.push(key);
    }
    return out;
}

/** A window: a pane of glass that isn't a door (teller glass isn't one). */
export const isWindow = (world: ReadonlyWorld, key: EdgeKey): boolean => {
    const e = Object.hasOwn(world.edges, key) ? world.edges[key] : undefined;
    return !!e && !e.door && e.material === 'glass';
};

/** The fortifications on an edge now: what the heist changed of it. */
export const fortificationOf = (state: DeepReadonly<State>, key: EdgeKey): DeepReadonly<EdgeState> =>
    (Object.hasOwn(state.edges, key) ? state.edges[key]! : {});

/** Why a shut door can't take a barricade or a reinforcement, or undefined. */
function doorRefusal(status: DoorStatus, vault: boolean): string | undefined {
    if (vault) return 'Not the vault door';
    if (status === 'open') return 'Close the door first';
    if (status === 'breached') return 'The door is blown open';
    return status === 'jammed' ? 'The door is jammed shut already' : undefined;
}

/** Whether the police have a strike or a breach announced at a door (rules/routine.ts): the crew can't change it now. */
const underBreach = (state: DeepReadonly<State>, door: string): boolean => !!state.police?.breaches.some(b => b.door === door);

/** Why a crew member can't fortify `edge` so now, or undefined. */
export function fortifyBlocked(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, edge: EdgeKey, action: FortifyAction): string | undefined {
    if (!FORTIFY_ACTIONS.includes(action)) return `No fortify action '${String(action)}'`;
    const lack = lacksActions(member, action === 'reinforce' ? world.rules.reinforceActions : 1);
    if (lack) return lack;
    const built = Object.hasOwn(world.edges, edge) ? world.edges[edge]! : undefined;
    if (!built) return 'There is no wall there';
    if (!besideEdge(world, edge, member.pos)) return `${member.name} isn't beside it`;
    const now = edgeNow(world, state, edge)!, mine = fortificationOf(state, edge);
    // A gap blown through it (M4-01) is a hole: nothing to barricade, reinforce or hang blinds on.
    if (now.gap) return 'There is a hole blown through it';
    const handsFull = member.dragging !== null || member.loadout.carrying !== null;
    const door = built.door ? world.doors[built.door] : undefined;
    if (door && (action === 'barricade' || action === 'clear' || action === 'reinforce') && underBreach(state, door.id)) return 'The police are breaking in here';
    switch (action) {
        case 'barricade': {
            if (handsFull) return `${member.name}'s hands are full`;
            if (mine.barricade) return 'It is barricaded already';
            if (door) return doorRefusal(doorStatus(world, state, door.id), door.lock === 'vault');
            return isWindow(world, edge) ? undefined : 'Only a door or a window can be barricaded';
        }
        case 'clear':
            if (handsFull) return `${member.name}'s hands are full`;
            return mine.barricade ? undefined : 'There is no barricade';
        case 'reinforce': {
            if (handsFull) return `${member.name}'s hands are full`;
            if (member.reinforcements < 1) return `${member.name} has no reinforcement kit left`;
            if (mine.reinforced) return 'It is reinforced already';
            if (now.material !== 'soft') return 'Only a Soft wall or door can be reinforced';
            return door ? doorRefusal(doorStatus(world, state, door.id), door.lock === 'vault') : undefined;
        }
        case 'unbar':
            if (!door || !mine.reinforced) return 'There is no bar on a door here';
            if (handsFull) return `${member.name}'s hands are full`;
            return mine.barredFrom && samePos(mine.barredFrom, member.pos) ? undefined : 'The bar is on the other side';
        case 'lowerBlinds':
        case 'raiseBlinds':
            if (!isWindow(world, edge)) return 'Only a window has blinds';
            if (action === 'lowerBlinds') return mine.blinds ? 'The blinds are down already' : undefined;
            return mine.blinds ? undefined : 'The blinds are up already';
    }
}

/** People don't fortify a bank for no reason (§11.4's table flip): seen doing it during stealth, +2. */
function seenFortifying(ctx: Ctx, member: CrewState, why: string): void {
    const { world, state } = ctx;
    if (state.bank.loud || state.bank.alarm) return;
    const sight = sightMap(world, state);
    for (const npc of state.npcs) {
        const observer = isEyesDown(npc) ? null : npcObserver(world, npc);
        if (observer && seesOn(sight, observer, member.pos)) addSuspicion(ctx, npc, member.id, FLIP_PIPS, [why], member.pos);
    }
}

/** Sets fields of the heist's change of an edge. */
function setEdge(state: State, key: EdgeKey, change: EdgeState): void {
    state.edges[key] = { ...fortificationOf(state, key), ...change };
}

/** Takes fields off the heist's change of an edge, dropping the change when nothing is left of it. */
export function dropField(state: State, key: EdgeKey, ...fields: (keyof EdgeState)[]): void {
    const next = { ...fortificationOf(state, key) } as EdgeState;
    for (const f of fields) delete next[f];
    if (sortedIds(next).length) state.edges[key] = next;
    else delete state.edges[key];
}

/** Takes a barricade off an edge. */
export const dropBarricade = (state: State, key: EdgeKey): void => dropField(state, key, 'barricade');

registerAction('fortify', {
    whyNot: (world, state, cmd) => fortifyBlocked(world, state, crewMember(state, cmd.crew), cmd.edge, cmd.action),
    candidates(world, _state, member) {
        const out: { type: 'fortify'; crew: string; edge: EdgeKey; action: FortifyAction }[] = [];
        for (const edge of edgesAround(world, member.pos)) for (const action of FORTIFY_ACTIONS) out.push({ type: 'fortify', crew: member.id, edge, action });
        return out;
    },
    cost: (world, _state, cmd) => (cmd.action === 'reinforce' ? world.rules.reinforceActions : 1),
    run(ctx, member, cmd) {
        const { world, state } = ctx, edge = cmd.edge;
        switch (cmd.action) {
            case 'barricade':
                // Seen pushing furniture into the window, before it hides them.
                seenFortifying(ctx, member, 'barricade');
                setEdge(state, edge, { barricade: world.rules.barricadeHp });
                ctx.emit({ type: 'barricaded', crew: member.id, edge });
                makeNoise(ctx, 'barricade', member.pos, `barricade ${member.id}`);
                break;
            case 'clear':
                seenFortifying(ctx, member, 'barricade');
                dropBarricade(state, edge);
                ctx.emit({ type: 'barricadeCleared', crew: member.id, edge });
                makeNoise(ctx, 'barricade', member.pos, `clear ${member.id}`);
                break;
            case 'reinforce':
                seenFortifying(ctx, member, 'reinforce');
                spendReinforcement(world, member);
                // A door's bar goes on the side the crew member stands on; only from there is it lifted again.
                setEdge(state, edge, { material: 'reinforced', reinforced: true, ...(world.edges[edge]!.door ? { barredFrom: { x: member.pos.x, y: member.pos.y } } : {}) });
                ctx.emit({ type: 'reinforced', crew: member.id, edge });
                makeNoise(ctx, 'reinforce', member.pos, `reinforce ${member.id}`);
                break;
            case 'unbar':
                seenFortifying(ctx, member, 'reinforce');
                dropField(state, edge, 'reinforced', 'material', 'barredFrom');
                ctx.emit({ type: 'unbarred', crew: member.id, edge });
                makeNoise(ctx, 'barricade', member.pos, `unbar ${member.id}`);
                break;
            case 'lowerBlinds':
            case 'raiseBlinds': {
                const down = cmd.action === 'lowerBlinds';
                if (down) setEdge(state, edge, { blinds: true });
                else dropField(state, edge, 'blinds');
                ctx.emit({ type: 'blinds', crew: member.id, edge, down });
                break;
            }
        }
    }
});

/** The edges the heist fortified, by key: what the overlay draws (src/game). */
export function fortifiedEdges(state: DeepReadonly<State>): { edge: EdgeKey; barricade: number | null; blinds: boolean; reinforced: boolean }[] {
    return sortedIds(state.edges).flatMap(edge => {
        const e = state.edges[edge]!;
        if (!e.barricade && !e.blinds && !e.reinforced) return [];
        return [{ edge, barricade: e.barricade ?? null, blinds: !!e.blinds, reinforced: !!e.reinforced }];
    });
}

registerEvents({
    barricaded: { undoBlocking: false },
    barricadeCleared: { undoBlocking: false },
    reinforced: { undoBlocking: false },
    unbarred: { undoBlocking: false },
    blinds: { undoBlocking: false },
    barricadeStruck: { undoBlocking: true }
});
