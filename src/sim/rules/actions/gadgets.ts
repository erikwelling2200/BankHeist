import { inBounds, samePos, tileAt } from '../../core/grid';
import { sortedIds } from '../../core/json';
import { registerStateCheck } from '../../core/save';
import { crewMember, newId, registerRuleDefaults, registerStateInit } from '../../core/state';
import type { CrewState, DeepReadonly, Pos, ReadonlyWorld, State } from '../../core/types';
import { registerEvents } from '../../core/undo';
import { AMMO_BAG, NOISEMAKER, SPARE_MAGS, SPARES_OF } from '../../data/weapons';
import { vehicleAt } from '../../geo/drive';
import { lineOfSight, sightMap, throwMap, type SightMap } from '../../geo/los';
import { npcObserver, seesOn } from '../../geo/cones';
import { makeNoise } from '../../geo/sound';
import { addSuspicion, isEyesDown } from '../suspicion';
import { inReach, lacksActions, registerAction } from './act';

/*
 * Distractions and gadgets (GAME_DESIGN §8.13, §11.11, §12.2; implementation plan M4-06, decisions 260–266).
 *
 * - **The noisemaker** (`throwNoisemaker { crew, to }`, §8.13): a coin or a phone alarm thrown up to 6 tiles
 *   (Euclidean, as a grenade) to a tile the thrower sees that isn't full height; 1 action, hands free, 3 to a kit item
 *   (`Arms.throwables.noisemaker`, the last one takes the item off). It sounds **as it lands**: a quiet noise of 3 at
 *   the landing tile (decision 260), heard as any quiet noise is (§8.9, rules/evidence.ts `hearing`): the hearers turn
 *   to it at once and the nearest of the right role is sent to look, its walk telegraphed in this crew phase; it goes
 *   back once it stands beside the spot (decision 261). Not through glass or a shut door (geo/los.ts `throwMap`).
 *   Clean and no illegal act, but while the bank is quiet everyone who sees the thrower gains `NOISEMAKER.pips` (1)
 *   suspicion of them (decision 267), and those who turn to the noise see what is there. Legal in stealth: nothing lies
 *   through a world phase, so the preview (its ring, ears and pips) is the whole outcome.
 * - **The ammo bag** (§11.11, §12.2): `dropAmmoBag { crew }` puts it down on the crew member's tile (1 action, hands
 *   free, once the bank is Loud, decision 262; `State.ammoBags`), and `refillAmmo { crew, bag }` (1 action, in reach of
 *   it) tops up the spare magazines of every gun the crew member carries to what they started with, one of its
 *   `rules.ammoBagUses` (4) uses; the last use leaves nothing on the floor.
 */

/** An ammo bag on the floor (§11.11). */
export interface AmmoBag {
    id: string;
    at: Pos;
    /** Refills left. */
    uses: number;
    /** Who put it down. */
    by: string;
}

declare module '../../core/types' {
    interface State {
        /** Ammo bags put down (§11.11), in the order they were. */
        ammoBags: AmmoBag[];
    }
    interface Rules {
        /** Refills an ammo bag holds (§12.2: 4). */
        ammoBagUses: number;
    }
    interface CommandMap {
        /** Throw a noisemaker to `to` (1 action): a quiet noise of 3 as it lands (§8.13). */
        throwNoisemaker: { crew: string; to: Pos };
        /** Put the ammo bag down on the crew member's tile (1 action). */
        dropAmmoBag: { crew: string };
        /** Top up every gun's spare magazines from the ammo bag `bag` in reach (1 action). */
        refillAmmo: { crew: string; bag: string };
    }
    interface EventMap {
        noisemakerLanded: { crew: string; at: Pos; left: number };
        ammoBagDropped: { crew: string; bag: string; at: Pos; uses: number };
        /** A crew member refilled from a bag: `left` refills in it (0: it is used up and gone). */
        ammoRefilled: { crew: string; bag: string; magazines: number; left: number };
    }
}

registerRuleDefaults({ ammoBagUses: AMMO_BAG.uses });

registerStateInit('ammoBags', (_world, state) => {
    state.ammoBags = [];
});

registerStateCheck('gadgets', state => (Array.isArray(state.ammoBags) ? undefined : 'no ammo bags (a save from before M4-06)'));

const handsFull = (member: DeepReadonly<CrewState>): boolean => member.dragging !== null || member.loadout.carrying !== null;

/** Takes one of a kit item a crew member carries off them: the item itself (its profile with it). */
function dropItem(member: CrewState, item: string): void {
    const i = member.loadout.items.indexOf(item);
    if (i >= 0) member.loadout.items.splice(i, 1);
    else {
        const j = member.loadout.packed.indexOf(item);
        if (j >= 0) member.loadout.packed.splice(j, 1);
    }
}

// ---------------------------------------------------------------------------------------------------------- Noisemaker

type NoisemakerCmd = DeepReadonly<{ crew: string; to: Pos }>;

/** Noisemakers a crew member has left. */
export const noisemakersLeft = (member: DeepReadonly<CrewState>): number => member.arms.throwables[NOISEMAKER.item] ?? 0;

/** Why a crew member can't throw a noisemaker there now, or undefined. */
export function noisemakerBlocked(world: ReadonlyWorld, state: State, cmd: NoisemakerCmd, sight: SightMap = sightMap(world, state)): string | undefined {
    const member = state.crew.find(c => c.id === cmd.crew);
    if (!member) return `No crew member '${cmd.crew}'`;
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    if (noisemakersLeft(member) < 1) return `${member.name} has no noisemaker left`;
    if (handsFull(member)) return `${member.name}'s hands are full`;
    const dx = cmd.to.x - member.pos.x, dy = cmd.to.y - member.pos.y, range = NOISEMAKER.range;
    if (!inBounds(world, cmd.to) || (!dx && !dy) || dx * dx + dy * dy > range * range) return 'A noisemaker can\'t be thrown there';
    if (tileAt(world, cmd.to)!.tall) return 'Something stands there to the ceiling';
    if (!lineOfSight(sight, member.pos, cmd.to)) return `${member.name} can't see where it would land`;
    // Through no glass or shut door, though they see through it (los.ts `throwMap`).
    return lineOfSight(throwMap(world, state), member.pos, cmd.to) ? undefined : 'Glass or a door is in the way';
}

/** The tiles a crew member could throw a noisemaker to now, row by row (on `state`: the UI passes its doubted doors shut). */
export function noisemakerTargets(world: ReadonlyWorld, state: State, crewId: string): Pos[] {
    const member = state.crew.find(c => c.id === crewId);
    if (!member || noisemakersLeft(member) < 1) return [];
    const range = NOISEMAKER.range, sight = sightMap(world, state), out: Pos[] = [];
    for (let dy = -range; dy <= range; dy++) for (let dx = -range; dx <= range; dx++) {
        const to = { x: member.pos.x + dx, y: member.pos.y + dy };
        if (!noisemakerBlocked(world, state, { crew: crewId, to }, sight)) out.push(to);
    }
    return out;
}

registerAction('throwNoisemaker', {
    whyNot: (world, state, cmd) => noisemakerBlocked(world, state, cmd),
    // Every tile it reaches, as a bag's throw lists them (`legalActions` holds every throw the grid can offer).
    candidates: (world, state, member) => noisemakerTargets(world, state, member.id).map(to => ({ type: 'throwNoisemaker', crew: member.id, to })),
    cost: () => 1,
    run(ctx, member, cmd) {
        const left = noisemakersLeft(member) - 1, at = { x: cmd.to.x, y: cmd.to.y };
        if (left > 0) member.arms.throwables[NOISEMAKER.item] = left;
        else {
            // Every kit item of them goes with the last one (two kits are six throws, one count).
            delete member.arms.throwables[NOISEMAKER.item];
            member.loadout.items = member.loadout.items.filter(id => id !== NOISEMAKER.item);
            member.loadout.packed = member.loadout.packed.filter(id => id !== NOISEMAKER.item);
        }
        // Seen throwing something in a quiet bank: a little odd (decision 267), judged before anyone turns to the noise.
        if (!ctx.state.bank.loud && !ctx.state.bank.alarm) {
            const sight = sightMap(ctx.world, ctx.state);
            for (const npc of ctx.state.npcs) {
                const observer = isEyesDown(npc) ? null : npcObserver(ctx.world, npc);
                if (observer && seesOn(sight, observer, member.pos)) addSuspicion(ctx, npc, member.id, NOISEMAKER.pips, ['noisemaker'], member.pos);
            }
        }
        ctx.emit({ type: 'noisemakerLanded', crew: member.id, at, left });
        makeNoise(ctx, 'noisemaker', at, `noisemaker ${member.id}`);
    }
});

// ---------------------------------------------------------------------------------------------------------- Ammo bag

/** Spare magazines a gun item starts with (§11.11): what a refill tops it up to. */
const fullSpares = (item: string): number => (Object.hasOwn(SPARES_OF, item) ? SPARES_OF[item]! : SPARE_MAGS);

/** The magazines a refill would give a crew member: every gun's spares topped up to its start. */
export function refillMagazines(member: DeepReadonly<CrewState>): number {
    let n = 0;
    for (const item of sortedIds(member.arms.guns)) n += Math.max(0, fullSpares(item) - member.arms.guns[item]!.spare);
    return n;
}

function dropBagBlocked(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>): string | undefined {
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    if (!member.loadout.items.includes(AMMO_BAG.item) && !member.loadout.packed.includes(AMMO_BAG.item)) return `${member.name} has no ammo bag`;
    // A bag lying through a quiet world phase would be evidence nobody judges (decision 262, as grenades, decision 101).
    if (!state.bank.loud) return 'The ammo bag is for when the bank is loud';
    if (handsFull(member)) return `${member.name}'s hands are full`;
    if (vehicleAt(world, state, member.pos) !== undefined) return 'Not in the vehicle';
    return state.ammoBags.some(b => samePos(b.at, member.pos)) ? 'An ammo bag lies here already' : undefined;
}

registerAction('dropAmmoBag', {
    whyNot: (world, state, cmd) => dropBagBlocked(world, state, crewMember(state, cmd.crew)),
    candidates: (_world, _state, member) => [{ type: 'dropAmmoBag', crew: member.id }],
    cost: () => 1,
    run(ctx, member) {
        const { world, state } = ctx;
        dropItem(member, AMMO_BAG.item);
        const bag: AmmoBag = { id: newId(state, 'ammoBag'), at: { x: member.pos.x, y: member.pos.y }, uses: world.rules.ammoBagUses, by: member.id };
        state.ammoBags.push(bag);
        ctx.emit({ type: 'ammoBagDropped', crew: member.id, bag: bag.id, at: { ...bag.at }, uses: bag.uses });
    }
});

/** Why a crew member can't refill from this bag now, or undefined. */
export function refillBlocked(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, bagId: string): string | undefined {
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    const bag = state.ammoBags.find(b => b.id === bagId);
    if (!bag) return 'There is no ammo bag there';
    if (!inReach(world, state, member.pos, bag.at)) return `${member.name} can't reach the ammo bag from here`;
    return refillMagazines(member) > 0 ? undefined : `${member.name}'s spare magazines are full`;
}

registerAction('refillAmmo', {
    whyNot: (world, state, cmd) => refillBlocked(world, state, crewMember(state, cmd.crew), cmd.bag),
    candidates: (_world, state, member) => state.ammoBags.map(b => ({ type: 'refillAmmo' as const, crew: member.id, bag: b.id })),
    cost: () => 1,
    run(ctx, member, cmd) {
        const { state } = ctx, bag = state.ammoBags.find(b => b.id === cmd.bag)!;
        const magazines = refillMagazines(member);
        for (const item of sortedIds(member.arms.guns)) {
            const gun = member.arms.guns[item]!;
            gun.spare = Math.max(gun.spare, fullSpares(item));
        }
        bag.uses--;
        if (bag.uses < 1) state.ammoBags = state.ammoBags.filter(b => b.id !== bag.id);
        ctx.emit({ type: 'ammoRefilled', crew: member.id, bag: bag.id, magazines, left: bag.uses });
    }
});

registerEvents({
    noisemakerLanded: { undoBlocking: false },
    ammoBagDropped: { undoBlocking: false },
    ammoRefilled: { undoBlocking: false }
});
