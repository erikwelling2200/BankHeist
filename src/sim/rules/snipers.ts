import { registerWorldHook, type Ctx, type WorldPhase } from '../core/engine';
import { offMap } from '../core/transit';
import type { CrewState, DeepReadonly, Pos, ReadonlyWorld, State } from '../core/types';
import { registerEvents } from '../core/undo';
import { OFFICER_STATS } from '../data/police';
import { weaponDef } from '../data/weapons';
import { rangeOn } from '../geo/cones';
import { lineOfSight, sightMap } from '../geo/los';
import { previewShot } from '../preview/shot';
import type { PoliceUnit } from './police';
import { cleanShot, fire, hitbox, look, registerKindPlay, standing, type Fighter } from './routine';
import { shotRefusal, type Shot } from './shot';
import { isDown } from './wounds';

/*
 * Police snipers (GAME_DESIGN §13.4, §13.5, §13.6 "Police snipers", "Sniper lines are always visible (scope glint and
 * laser), even when the sniper is beyond the crew's sight", §14.7; implementation plan M4-05, decisions 304–306).
 *
 * - **Posts.** A sniper team walks in to posts outside the building that see its windows, raised floor first
 *   (rules/sniperPosts.ts), and stays there: no cover to cover, no falling back, no arrests.
 * - **The laser** is the telegraph. In each world phase's combat step a sniper puts its laser on one crew member it sees
 *   (long sight: its DMR's range, halved onto a dark tile, in line of sight; masked or known, up, on the map): one leaning
 *   out first (§13.6 "take crew who lean out"), then the nearest. The laser holds through the crew phase after it
 *   (`PoliceUnit.laser`, `sniperAimed`), and the crew is always told of it, wherever the sniper is (`sniperLasers`).
 * - **The shot** comes only in a later world phase, only at the crew member lasered, and only if the sniper still sees
 *   them then: getting out of its sight (behind a wall, the blinds down, into transit, aboard) is the answer. It is fired
 *   through `fire` (rules/routine.ts), so it is a shot only if `cleanShot` holds: never through a standing non-crew
 *   body (§13.5), else it holds its fire. A raised post ignores the half cover of a target on the ground (§14.7,
 *   geo/shot.ts). In Negotiate snipers hold their fire (§13.4) but keep their lasers on.
 * - Then it lasers again, so a crew member who stays in view is shot every world phase, each shot a phase after the
 *   laser that warned of it.
 */

/** A sniper's laser (§13.6): on `target`, at `at` as the world phase of `turn` left them, held through the crew phase after. */
export interface SniperLaser { target: string; at: Pos; turn: number }

declare module './police' {
    interface PoliceUnit {
        /** A sniper's laser (rules/snipers.ts); absent when it has nobody in its sights. */
        laser?: SniperLaser;
    }
}

declare module '../core/types' {
    interface EventMap {
        /** A sniper put its laser on a crew member (told always: the line is visible from anywhere, §13.6). */
        sniperAimed: { sniper: string; from: Pos; target: string; at: Pos };
        /** A sniper's laser went off: nobody in its sights. */
        sniperAimOff: { sniper: string };
    }
}

/** Whether a sniper on `from` sees `to`: its gun's range (halved onto a dark tile, §14.6), in line of sight. */
export function sniperSees(world: ReadonlyWorld, state: State, from: DeepReadonly<Pos>, to: DeepReadonly<Pos>): boolean {
    const sight = sightMap(world, state), r = rangeOn(weaponDef(OFFICER_STATS.sniper.weapon!).range, sight.lit[to.y * sight.width + to.x] === 1);
    const dx = to.x - from.x, dy = to.y - from.y;
    return dx * dx + dy * dy <= r * r && lineOfSight(sight, { x: from.x, y: from.y }, { x: to.x, y: to.y });
}

/** Whether the police take a crew member for one of the crew (decision 151): masked, or already known to them. */
const marked = (state: State, member: DeepReadonly<CrewState>): boolean => member.loadout.masked || Object.hasOwn(state.police.known, member.id);

/** Whether a sniper can put its laser on (or fire at) a crew member now. */
function inSights(world: ReadonlyWorld, state: State, unit: DeepReadonly<PoliceUnit>, member: DeepReadonly<CrewState>): boolean {
    return !member.wounds.dead && !isDown(member) && !offMap(member) && marked(state, member) && !!unit.pos && sniperSees(world, state, unit.pos, hitbox(member));
}

/** The crew member a sniper lasers now: one leaning out first, then the nearest, then by id; or undefined. */
function pickTarget(world: ReadonlyWorld, state: State, unit: DeepReadonly<PoliceUnit>): CrewState | undefined {
    const here = unit.pos!, d2 = (c: CrewState): number => {
        const at = hitbox(c), dx = at.x - here.x, dy = at.y - here.y;
        return dx * dx + dy * dy;
    };
    return state.crew.filter(c => inSights(world, state, unit, c))
        .sort((a, b) => Number(!!b.leaning) - Number(!!a.leaning) || d2(a) - d2(b) || (a.id < b.id ? -1 : 1))[0];
}

/** The shot a sniper fires at a lasered crew member from its post. */
const sniperShot = (unit: DeepReadonly<PoliceUnit>, target: DeepReadonly<CrewState>): Shot => {
    const weapon = OFFICER_STATS.sniper.weapon!;
    return { shooter: unit.id, weapon, at: hitbox(target), target: target.id, bullets: weaponDef(weapon).bullets, moved: false };
};

/** A sniper's act in the combat step (see the header). */
function sniperActs(ctx: Ctx, phase: WorldPhase, unit: PoliceUnit): void {
    const { world, state } = ctx, f: Fighter = { kind: 'police', id: unit.id, unit };
    look(ctx, f);
    const mode = state.police.mode?.kind ?? 'contain', laser = unit.laser;
    // The shot a laser of an earlier world phase warned of: at the one lasered, if still in its sights.
    if (laser && laser.turn < phase.turn && mode !== 'negotiate') {
        const target = state.crew.find(c => c.id === laser.target);
        if (target && inSights(world, state, unit, target)) {
            const shot = sniperShot(unit, target);
            if (!shotRefusal(world, state, shot)) {
                if (cleanShot(world, state, shot)) fire(ctx, phase, f, shot);
                else {
                    const blockers = [...new Set(previewShot(world, state, shot).bodies.filter(b => !b.crew).map(b => b.id))].sort();
                    ctx.emit({ type: 'heldFire', shooter: unit.id, target: target.id, why: 'body', blockers });
                }
            }
        }
    }
    if (!standing(state, f)) return;
    // What it sees from its post goes to the radio, as far as its scope reaches.
    for (const c of state.crew) if (inSights(world, state, unit, c)) state.police.known[c.id] = { tile: { ...c.pos }, turn: state.turn, down: false };
    const next = pickTarget(world, state, unit);
    if (next) {
        const at = hitbox(next), was = unit.laser;
        unit.laser = { target: next.id, at, turn: phase.turn };
        // Told when it moves: a laser held on the same spot is the same warning.
        if (!was || was.target !== next.id || was.at.x !== at.x || was.at.y !== at.y) ctx.emit({ type: 'sniperAimed', sniper: unit.id, from: { ...unit.pos! }, target: next.id, at: { ...at } });
    } else if (unit.laser) {
        delete unit.laser;
        ctx.emit({ type: 'sniperAimOff', sniper: unit.id });
    }
}

registerKindPlay('sniper', sniperActs);

// A laser on someone who has since gone off the map, down or out of sight in the crew phase still stands (it is shown
// as it was set); what the sniper does with it is decided when it acts. A sniper caught by a flashbang loses its phase
// and its laser with it, so nothing it shows is stale by more than the phase it lost.
registerWorldHook('combatNpcs', 'snipers.dazed', (ctx, phase) => {
    for (const unit of ctx.state.police.units) {
        if (unit.kind !== 'sniper' || unit.surprised !== phase.turn || !unit.laser) continue;
        delete unit.laser;
        ctx.emit({ type: 'sniperAimOff', sniper: unit.id });
    }
}, { order: -1 });

/** A laser the crew sees (§13.6: always, wherever the sniper is): from the post to the crew member it is on. */
export interface KnownLaser { sniper: string; from: Pos; target: string; at: Pos; turn: number }

/** Every sniper's laser now, for the crew's view (nothing hidden: the line is visible from anywhere, §13.6). */
export function sniperLasers(state: DeepReadonly<State>): KnownLaser[] {
    return state.police.units.flatMap(u => (u.laser && u.pos ? [{ sniper: u.id, from: { ...u.pos }, target: u.laser.target, at: { ...u.laser.at }, turn: u.laser.turn }] : []))
        .sort((a, b) => (a.sniper < b.sniper ? -1 : 1));
}

registerEvents({
    sniperAimed: { undoBlocking: true },
    sniperAimOff: { undoBlocking: true }
});
