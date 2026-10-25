import { registerWorldHook, type Ctx } from '../../core/engine';
import { inBounds, tileAt } from '../../core/grid';
import { sortedIds } from '../../core/json';
import { crewMember, newId, registerStateInit } from '../../core/state';
import type { ClimbSide, CrewState, DeepReadonly, Pos, ReadonlyWorld, State } from '../../core/types';
import { registerEvents } from '../../core/undo';
import { FLIP_PIPS, isThrowable, SMOKE_PHASES, THROWABLES, type ThrowableId } from '../../data/weapons';
import { npcObserver, seesOn } from '../../geo/cones';
import { lineOfSight, sightMap, type SightMap } from '../../geo/los';
import { ABSENT_STATUSES } from '../../geo/move';
import { tileKey } from '../../geo/shot';
import { makeNoise } from '../../geo/sound';
import { commandNpc } from '../command';
import { personOf } from '../npc/walk';
import { bodyPos } from '../place';
import { addSuspicion, isEyesDown } from '../suspicion';
import { inReach, lacksActions, registerAction } from './act';

/*
 * Grenades and improvised cover (GAME_DESIGN §11.4, §11.10, §12.2; implementation plan M3-02, decisions 101–104).
 *
 * - **Fused grenades** (`throwGrenade { crew, item, to }`): a flashbang or a smoke grenade, once the bank is Loud or
 *   the Alarm is up (decision 101), 1 action, hands free, up to
 *   6 tiles (Euclidean, decision 53) to a tile the thrower sees that isn't full height; the illegal act 'attack'. It
 *   **lands** at once, visibly, its radius drawn (`State.grenades`, `grenadeLanded`), and **goes off at the start of
 *   the next world phase** (the engine's `fuses` step, before the phase is frozen), so a crew grenade goes off before
 *   any NPC acts and a police one (M3-06) gives the crew a crew phase to move out: "grenades land a phase before they go
 *   off" (§6.2). What it reaches is decided as it goes off: the tiles within its radius (Euclidean) the landing tile
 *   sees.
 *   - **Flashbang** (loud, 14): everyone up in reach is Surprised for that world phase (`NpcState.surprised`: their
 *     intent dropped, they lose the phase, a Hostile one can be knocked out) and civilians are Commanded; the bank goes
 *     Loud. The crew aren't affected by their own (decision 103).
 *   - **Smoke** (quiet, 4): fills the tiles it reaches (`State.smoke`, geo/los.ts) and blocks sight like a full-height
 *     object for 3 world phases, clearing as the third ends (decision 104). Bullets fly through it.
 * - **Flip a table** (`flipTable { crew, at }`, §11.4): 1 action, hands free, a table or light desk in reach
 *   (`Tile.flipHp`) not flipped yet: it becomes half cover on its tile with the hit points it keeps, covering only the
 *   side it was flipped from: its arc faces away from the flipper (`State.flipped`, geo/shot.ts `coverSide`; decision 102). A quiet noise of 4; during stealth everyone who sees the flipper gains
 *   +2 suspicion of them.
 */

/** A grenade on the floor, waiting for its fuse. */
export interface Grenade {
    id: string;
    kind: ThrowableId;
    /** Who threw it. */
    by: string;
    at: Pos;
    /** The turn at the start of whose world phase it goes off. */
    turn: number;
}

declare module '../../core/types' {
    interface State {
        /** Grenades thrown and not gone off yet (§11.10). */
        grenades: Grenade[];
        /** Tables flipped into cover (§11.4), in the order they were: each covers its side `side` only (decision 102). */
        flipped: { at: Pos; side: ClimbSide }[];
    }
    interface CommandMap {
        /** Throw a flashbang or a smoke grenade to `to` (1 action): it goes off as the world phase starts. */
        throwGrenade: { crew: string; item: string; to: Pos };
        /** Flip the table or light desk on `at` in reach into half cover (1 action). */
        flipTable: { crew: string; at: Pos };
    }
    interface EventMap {
        grenadeLanded: { grenade: string; kind: string; crew: string; at: Pos; radius: number };
        grenadeWentOff: { grenade: string; kind: string; at: Pos; tiles: Pos[] };
        /** A flashbang caught someone (Surprised; a civilian Commanded too). */
        flashed: { npc: string; by: string };
        smokeCleared: { cloud: string };
        tableFlipped: { crew: string; at: Pos };
    }
}

// Named to run before the knowledge init, which looks (sight reads the smoke).
registerStateInit('grenades', (_world, state) => {
    state.grenades = [];
    state.smoke = [];
    state.flipped = [];
});

// ---------------------------------------------------------------------------------------------------------- Throwing

type ThrowCmd = DeepReadonly<{ crew: string; item: string; to: Pos }>;

/** Why a crew member can't throw this grenade there now, or undefined. */
export function throwBlocked(world: ReadonlyWorld, state: State, cmd: ThrowCmd, sight: SightMap = sightMap(world, state)): string | undefined {
    const member = state.crew.find(c => c.id === cmd.crew);
    if (!member) return `No crew member '${cmd.crew}'`;
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    if (!isThrowable(cmd.item)) return `'${cmd.item}' isn't thrown`;
    // Combat tools (decision 101): a grenade lying through a quiet crew phase would change the world phase after it outside
    // what the safe floor judges, and stealth's previews are whole (§8.8).
    if (!state.bank.loud && !state.bank.alarm) return 'Grenades are for when the bank is loud';
    if (!((member.arms.throwables[cmd.item] ?? 0) > 0)) return `${member.name} has no ${cmd.item} left`;
    if (member.dragging !== null || member.loadout.carrying !== null) return `${member.name}'s hands are full`;
    const dx = cmd.to.x - member.pos.x, dy = cmd.to.y - member.pos.y, range = THROWABLES[cmd.item].range;
    if (!inBounds(world, cmd.to) || (!dx && !dy) || dx * dx + dy * dy > range * range) return `A ${cmd.item} can't be thrown there`;
    if (tileAt(world, cmd.to)!.tall) return 'Something stands there to the ceiling';
    return lineOfSight(sight, member.pos, cmd.to) ? undefined : `${member.name} can't see where it would land`;
}

/** The tiles a crew member could throw a grenade of `item` to now, row by row. */
export function grenadeTargets(world: ReadonlyWorld, state: State, crewId: string, item: string): Pos[] {
    const member = state.crew.find(c => c.id === crewId);
    if (!member || !isThrowable(item)) return [];
    const range = THROWABLES[item].range, sight = sightMap(world, state), out: Pos[] = [];
    for (let dy = -range; dy <= range; dy++) for (let dx = -range; dx <= range; dx++) {
        const to = { x: member.pos.x + dx, y: member.pos.y + dy };
        if (!throwBlocked(world, state, { crew: crewId, item, to }, sight)) out.push(to);
    }
    return out;
}

registerAction('throwGrenade', {
    whyNot: (world, state, cmd) => throwBlocked(world, state, cmd),
    // At the NPCs it could reach (the random player and the grid's default): every tile would be too many.
    candidates(_world, state, member) {
        const out: { type: 'throwGrenade'; crew: string; item: string; to: Pos }[] = [];
        for (const item of sortedIds(THROWABLES)) {
            if (!((member.arms.throwables[item] ?? 0) > 0)) continue;
            for (const n of state.npcs) if (!ABSENT_STATUSES.has(n.status) && n.stashed === null) out.push({ type: 'throwGrenade', crew: member.id, item, to: { ...bodyPos(state, n) } });
        }
        return out;
    },
    cost: () => 1,
    illegal: () => ({ act: 'attack' }),
    run(ctx, member, cmd) {
        const { state } = ctx, item = cmd.item as ThrowableId;
        spendThrowable(member, item);
        const grenade: Grenade = { id: newId(state, item), kind: item, by: member.id, at: { x: cmd.to.x, y: cmd.to.y }, turn: state.turn };
        state.grenades.push(grenade);
        ctx.emit({ type: 'grenadeLanded', grenade: grenade.id, kind: item, crew: member.id, at: { ...grenade.at }, radius: THROWABLES[item].radius });
    }
});

/** Takes one throwable from a crew member's kit; the last one takes the item off them (its profile with it). */
function spendThrowable(member: CrewState, item: ThrowableId): void {
    const left = member.arms.throwables[item]! - 1;
    if (left > 0) {
        member.arms.throwables[item] = left;
        return;
    }
    delete member.arms.throwables[item];
    member.loadout.items = member.loadout.items.filter(id => id !== item);
}

/** The tiles a grenade going off at `at` reaches: within its radius (Euclidean), in sight of the landing tile. */
export function blastTiles(world: ReadonlyWorld, sight: SightMap, at: DeepReadonly<Pos>, radius: number): Pos[] {
    const out: Pos[] = [];
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const p = { x: at.x + dx, y: at.y + dy };
        if (dx * dx + dy * dy <= radius * radius && inBounds(world, p) && lineOfSight(sight, { x: at.x, y: at.y }, p)) out.push(p);
    }
    return out;
}

/** A flashbang going off: everyone up in reach Surprised for the phase, civilians Commanded (§11.10). */
function flash(ctx: Ctx, grenade: Grenade, tiles: readonly Pos[]): void {
    const { world, state } = ctx, inside = new Set(tiles.map(tileKey));
    for (const npc of state.npcs) {
        if (ABSENT_STATUSES.has(npc.status) || npc.stashed !== null || isEyesDown(npc) || !inside.has(tileKey(bodyPos(state, npc)))) continue;
        npc.surprised = state.turn;
        npc.intent = { path: [] };
        npc.goal = { kind: 'still' };
        ctx.emit({ type: 'flashed', npc: npc.id, by: grenade.by });
        ctx.emit({ type: 'surprised', npc: npc.id });
        if (personOf(world, npc.id).observer === 'civilian' && state.crew.some(c => c.id === grenade.by)) commandNpc(ctx, npc, grenade.by, world.rules.commandPips);
    }
    makeNoise(ctx, 'flashbang', grenade.at, `flashbang ${grenade.by}`, undefined, grenade.by);
    if (!state.bank.loud) {
        state.bank.loud = true;
        ctx.emit({ type: 'wentLoud', cause: `flashbang ${grenade.by}` });
    }
}

// Grenades thrown in the crew phase go off as the world phase starts, before anyone acts (§11.10).
registerWorldHook('fuses', 'throwables.fuses', (ctx, phase) => {
    const { world, state } = ctx;
    const due = state.grenades.filter(g => g.turn <= phase.turn);
    state.grenades = state.grenades.filter(g => g.turn > phase.turn);
    for (const grenade of due) {
        const tiles = blastTiles(world, sightMap(world, state), grenade.at, THROWABLES[grenade.kind].radius);
        ctx.emit({ type: 'grenadeWentOff', grenade: grenade.id, kind: grenade.kind, at: { ...grenade.at }, tiles: tiles.map(p => ({ ...p })) });
        if (grenade.kind === 'flashbang') flash(ctx, grenade, tiles);
        else {
            state.smoke.push({ id: grenade.id, at: { ...grenade.at }, tiles, until: phase.turn + SMOKE_PHASES - 1 });
            makeNoise(ctx, 'smoke', grenade.at, `smoke ${grenade.by}`, undefined, grenade.by);
        }
    }
});

// Smoke clears as its last world phase ends.
registerWorldHook('devices', 'throwables.smoke', (ctx, phase) => {
    const { state } = ctx;
    for (const cloud of state.smoke) if (cloud.until <= phase.turn) ctx.emit({ type: 'smokeCleared', cloud: cloud.id });
    state.smoke = state.smoke.filter(c => c.until > phase.turn);
}, { order: 50 });

// ---------------------------------------------------------------------------------------------------------- Flip a table

/** Why a crew member can't flip the table on `at` now, or undefined. */
export function flipBlocked(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, at: DeepReadonly<Pos>): string | undefined {
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    if (member.dragging !== null || member.loadout.carrying !== null) return `${member.name}'s hands are full`;
    const tile = inBounds(world, at) ? tileAt(world, at) : undefined;
    if (tile?.flipHp === undefined) return 'There is no table there to flip';
    if (state.flipped.some(f => f.at.x === at.x && f.at.y === at.y)) return 'It is flipped already';
    return inReach(world, state, member.pos, at) ? undefined : `${member.name} can't reach it from here`;
}

registerAction('flipTable', {
    whyNot: (world, state, cmd) => flipBlocked(world, state, crewMember(state, cmd.crew), cmd.at),
    candidates(world, _state, member) {
        const out: { type: 'flipTable'; crew: string; at: Pos }[] = [];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const at = { x: member.pos.x + dx, y: member.pos.y + dy };
            if ((dx || dy) && inBounds(world, at) && tileAt(world, at)!.flipHp !== undefined) out.push({ type: 'flipTable', crew: member.id, at });
        }
        return out;
    },
    cost: () => 1,
    run(ctx, member, cmd) {
        const { world, state } = ctx;
        // Its arc faces away from the flipper: it covers the side they flipped it from, north or south of it if they stand
        // so (diagonals too), else east or west.
        const dx = member.pos.x - cmd.at.x, dy = member.pos.y - cmd.at.y;
        const side: ClimbSide = dy < 0 ? 'n' : dy > 0 ? 's' : dx > 0 ? 'e' : 'w';
        state.flipped.push({ at: { x: cmd.at.x, y: cmd.at.y }, side });
        ctx.emit({ type: 'tableFlipped', crew: member.id, at: { x: cmd.at.x, y: cmd.at.y } });
        // People don't flip furniture in a bank for no reason (§11.4): seen during stealth, +2.
        if (!state.bank.loud && !state.bank.alarm) {
            const sight = sightMap(world, state);
            for (const npc of state.npcs) {
                const observer = isEyesDown(npc) ? null : npcObserver(world, npc);
                if (observer && seesOn(sight, observer, member.pos)) addSuspicion(ctx, npc, member.id, FLIP_PIPS, ['flipTable'], member.pos);
            }
        }
        makeNoise(ctx, 'flipTable', cmd.at, `flip ${member.id}`);
    }
});

registerEvents({
    grenadeLanded: { undoBlocking: false },
    grenadeWentOff: { undoBlocking: true },
    flashed: { undoBlocking: true },
    smokeCleared: { undoBlocking: false },
    tableFlipped: { undoBlocking: false }
});
