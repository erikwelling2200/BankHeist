import type { GeneratedBank } from '../gen/model';
import {
    hashOf, initialState, reachable, tileAt, worldFromBank, type CrewStart, type Facing, type Pos, type ReadonlyWorld, type State
} from '../sim';
import { Session, type ResumeOptions } from './session';
import type { SaveStorage } from './storage';

/*
 * A heist in a generated bank (implementation plan M1-13, M1-16): the World built from the bank, and the crew of two
 * starting beside their van. The scene asks for it on `?play`; resuming picks up the autosaved heist when it was played
 * in this same bank.
 */

/** The generator's version as saves name it; a save of another version is still read, the world being in the save. */
export const GEN_VERSION = 'gen-1';

/** The M1 crew: two, with placeholder loadouts until the item tables (M1-05) and the planning screen. */
export const M1_CREW: readonly { id: string; name: string; look: string; items: string[] }[] = [
    { id: 'mara', name: 'Mara', look: 'crewMara', items: ['pistol', 'zipTies'] },
    { id: 'jun', name: 'Jun', look: 'crewJun', items: ['pistol', 'duffel'] }
];

/** The tile the crew starts beside: the crew van at the curb, or else the first getaway spot, or else the lobby's door. */
export function crewOrigin(bank: GeneratedBank): Pos {
    const spot = bank.getaways.find(g => g.id === 'curb') ?? bank.getaways[0];
    if (spot) return { x: spot.tx, y: spot.ty };
    const lobby = bank.rooms.find(r => r.type === 'lobby') ?? bank.rooms[0]!;
    return { x: lobby.x + Math.floor(lobby.w / 2), y: lobby.y + lobby.h };
}

/** Whether someone can stand on `p` at the start: walkable ground floor in the plot, nobody there. */
function free(world: ReadonlyWorld, taken: readonly Pos[], p: Pos): boolean {
    const tile = tileAt(world, p);
    return !!tile && !!tile.room && !tile.blocksMove && !tile.raised && !taken.some(q => q.x === p.x && q.y === p.y);
}

/**
 * Where each crew member starts: the free tile nearest the van (by rings round it, row-major within a ring), then each
 * next one the free tile nearest the first that can be walked to from it, beside it rather than behind it, so the crew
 * stands together on open ground.
 */
export function crewStarts(world: ReadonlyWorld, origin: Pos, count: number): Pos[] {
    const npcs = world.people.map(p => p.pos);
    let first: Pos | undefined;
    for (let r = 0; r < Math.max(world.width, world.height) && !first; r++) {
        for (let y = origin.y - r; y <= origin.y + r && !first; y++) for (let x = origin.x - r; x <= origin.x + r && !first; x++) {
            if (Math.max(Math.abs(x - origin.x), Math.abs(y - origin.y)) === r && free(world, npcs, { x, y })) first = { x, y };
        }
    }
    if (!first) throw new Error('No free tile for the crew to start on');
    const starts = [first];
    // The others: the cheapest tiles to walk to from the first, on an empty bank but for the NPCs.
    const probe = initialState(world, { seed: 0, crew: [{ id: 'probe', pos: first }] });
    const reach = reachable(world, probe, first, 40, { mover: 'probe' });
    // Side by side rather than one behind the other, so neither hides the other: nearest first, then the same row.
    const order = [...reach.tiles].sort((a, b) => a.cost - b.cost || Math.abs(a.pos.y - first!.y) - Math.abs(b.pos.y - first!.y));
    for (const t of order) {
        if (starts.length >= count) break;
        if (t.canEnd && free(world, [...npcs, ...starts], t.pos)) starts.push({ x: t.pos.x, y: t.pos.y });
    }
    if (starts.length < count) throw new Error(`Only ${starts.length} of ${count} crew members have somewhere to start`);
    return starts;
}

/** A new heist's World and State for a generated bank: the crew beside the van, facing the bank (north). */
export function newHeist(bank: GeneratedBank): { world: ReadonlyWorld; state: State } {
    const world = worldFromBank(bank);
    const starts = crewStarts(world, crewOrigin(bank), M1_CREW.length);
    const facing: Facing = 'n';
    const crew: CrewStart[] = M1_CREW.map((c, i) => ({ id: c.id, name: c.name, pos: starts[i]!, facing, items: [...c.items] }));
    const state = initialState(world, { seed: (bank.seed.layout * 1000 + bank.seed.population) >>> 0, crew });
    return { world, state };
}

/**
 * The heist to play in `bank`: the autosaved one if it was played in this bank (and `fresh` isn't asked), else a new one,
 * which replaces any other heist in `storage`. `resumed` says which.
 */
export function playHeist(bank: GeneratedBank, storage: SaveStorage, options: ResumeOptions & { fresh?: boolean } = {}): { session: Session; resumed: boolean } {
    const { world, state } = newHeist(bank);
    if (!options.fresh) {
        const saved = Session.resume(storage, options);
        if (saved && saved.worldId === hashOf(world)) return { session: saved, resumed: true };
    }
    return { session: Session.start({ world, state, storage, genVersion: GEN_VERSION, uiSaveDelay: options.uiSaveDelay, onListenerError: options.onListenerError }), resumed: false };
}
