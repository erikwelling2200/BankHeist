import {
    attackPlan, crewPicture, fortifiedEdges, weaponDef, crewShotPreview, officerMarkers, sniperLasers, suppressPlan, type Command, type CoverView, type Pos, type ReadonlyWorld, type ShotPreview, type State
} from '../sim';
import { doorMiddle } from './actions';

/*
 * What the world UI draws once the bank is loud (UI.md "Loud", M3-09, first half), from what the crew knows only:
 *
 * - **Aim** (§11.2, §11.7): an attack's or a suppression's cone as `crewShotPreview` gives it on the crew's picture
 *   (never `attackCone`, the truth): an arc per bullet, nested, each cut short where its bullets stop, the reach past
 *   what this attack could break (`ifBroken`) dashed; a marker on everyone in it (a red diamond for a hostile, a pale
 *   circle for a civilian, a blue triangle for the crew) and their cover against this shot as a shield on the side it
 *   faces the shooter: covered, flanked (dashed grey), cracked when the attack could break it, and with a `?` where it
 *   may already be gone.
 * - **Police** (§13.6): officers the crew sees where they stand, those it saw lately as faded ghosts where it saw them
 *   (`officerMarkers`), and every breach announced for the next world phase at its door (announced: the threat ledger
 *   shows them too).
 */

/** The cover a body in the cone has against this shot, drawn on the side of its tile that faces the shooter. */
export interface ShieldVM {
    state: CoverView['state'];
    side: 'n' | 's' | 'e' | 'w';
    /** This attack could break it (the cracked shield). */
    mayBreak: boolean;
    /** It stands where the crew doesn't see this turn: it may be gone already. */
    mayBeGone: boolean;
}

/** Someone the cone reaches. */
export interface AimBodyVM {
    id: string;
    pos: Pos;
    kind: 'hostile' | 'civilian' | 'crew';
    /** Only a bullet that passes through someone first reaches them. */
    through: boolean;
    /** Reached only once something this attack could break is broken. */
    ifBroken: boolean;
    shield?: ShieldVM;
}

/** A shot's cone (`crewShotPreview`), in the overlay's terms. */
export interface AimVM {
    /** The shooter's tile (the lean tile when leaning out). */
    origin: Pos;
    /** The tile aimed at. */
    at: Pos;
    /** The aim line's direction, radians on the map (x east, y south). */
    aim: number;
    /** Each bullet's middle off the aim line (degrees), and each bullet's whole arc, bullet 1 first. */
    turn: number;
    arcs: number[];
    /** Where bullets stop: `[angle off the aim line (degrees), distance (tiles)]`, round the widest arc. */
    outline: [number, number][];
    /** Where bullets stop once all this attack could break is broken, where that is further: dashed. */
    broken: [number, number][][];
    bodies: AimBodyVM[];
    /** The bullets this attack fires (the fire selector), and the most it could. */
    bullets: number;
}

/** The shot an attack or suppress command fires, planned on the crew's picture, or undefined when it can't be fired. */
function shotOf(world: ReadonlyWorld, state: State, cmd: Command) {
    const picture = crewPicture(world, state);
    if (cmd.type === 'attack') {
        const plan = attackPlan(world, picture, cmd);
        return typeof plan === 'string' ? undefined : plan.shot;
    }
    if (cmd.type === 'suppress') {
        const plan = suppressPlan(world, picture, cmd);
        return typeof plan === 'string' ? undefined : plan.shot;
    }
    return undefined;
}

/** The shot preview the player may see for a command (`crewShotPreview`), or undefined: not an attack, or refused. */
export function crewAim(world: ReadonlyWorld, state: State, cmd: Command): ShotPreview | undefined {
    const shot = shotOf(world, state, cmd);
    if (!shot) return undefined;
    try {
        return crewShotPreview(world, state, shot);
    } catch {
        return undefined;
    }
}

const sideToward = (from: Pos, to: Pos): ShieldVM['side'] => {
    const dx = to.x - from.x, dy = to.y - from.y;
    return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : dy > 0 ? 's' : 'n';
};

/** The aim view of a command (`crewAim`), with each body placed where the crew pictures it. */
export function aimView(world: ReadonlyWorld, state: State, cmd: Command): AimVM | undefined {
    if (cmd.type !== 'attack' && cmd.type !== 'suppress') return undefined;
    const shot = crewAim(world, state, cmd);
    if (!shot) return undefined;
    const picture = crewPicture(world, state);
    const posOf = (id: string): { pos: Pos; kind: AimBodyVM['kind'] } | undefined => {
        const c = picture.crew.find(m => m.id === id);
        if (c) return { pos: c.pos, kind: 'crew' };
        const u = picture.police.units.find(m => m.id === id);
        if (u?.pos) return { pos: u.pos, kind: 'hostile' };
        const n = picture.npcs.find(m => m.id === id) ?? state.npcs.find(m => m.id === id && state.crew.some(c => c.dragging === id));
        if (n) return { pos: n.pos, kind: n.status === 'hostile' ? 'hostile' : 'civilian' };
        return undefined;
    };
    const bodies: AimBodyVM[] = [];
    for (const b of shot.bodies) {
        const at = posOf(b.id);
        if (!at) continue;
        const body: AimBodyVM = { id: b.id, pos: { ...at.pos }, kind: at.kind, through: !b.first && b.through, ifBroken: b.ifBroken };
        if (b.cover) body.shield = { state: b.cover.state, side: sideToward(at.pos, shot.origin), mayBreak: !!b.cover.mayBreak, mayBeGone: !!b.cover.mayBeGone };
        bodies.push(body);
    }
    const outline = shot.fan.flatMap(s => s.outline);
    const broken = shot.fan.filter(s => s.broken && s.broken.outline.some(([, d], i) => d > s.outline[Math.min(i, s.outline.length - 1)]![1] + 0.01)).map(s => s.broken!.outline);
    return {
        origin: { ...shot.origin }, at: { x: cmd.at.x, y: cmd.at.y }, aim: Math.atan2(shot.aim[1], shot.aim[0]), turn: shot.turn, arcs: [...shot.arcs], outline, broken, bodies,
        bullets: shot.arcs.length
    };
}

/** A police officer as the crew knows it: in sight, or a ghost of where it was seen. */
export interface PoliceMarkerVM { id: string; kind: string; pos: Pos; live: boolean; seenAgo: number }

/** The officers the crew knows of (`officerMarkers`). */
export const policeMarkers = (world: ReadonlyWorld, state: State): PoliceMarkerVM[] => officerMarkers(world, state);

/** A breach announced for the next world phase (§13.6): the middle of its door's edge, in tiles. */
export interface BreachVM { door: string; at: Pos }

export function breachMarkers(world: ReadonlyWorld, state: State): BreachVM[] {
    return (state.police?.breaches ?? []).flatMap(b => {
        const at = doorMiddle(world, b.door);
        return at ? [{ door: b.door, at }] : [];
    });
}

/**
 * A wall segment the crew fortified (§14.3, M4-02), from end `a` to end `b` in tiles: a barricade (its hit points left
 * against the police), blinds down, or the crew's reinforcement. The crew made each, so it knows them all.
 */
export interface FortifyVM { edge: string; a: Pos; b: Pos; barricade: number | null; blinds: boolean; reinforced: boolean }

export function fortifyMarkers(world: ReadonlyWorld, state: State): FortifyVM[] {
    return fortifiedEdges(state).flatMap(f => {
        const e = world.edges[f.edge];
        if (!e) return [];
        const a = { x: e.tx, y: e.ty }, b = e.run === 'eastWest' ? { x: e.tx + 1, y: e.ty } : { x: e.tx, y: e.ty + 1 };
        return [{ ...f, a, b }];
    });
}

/**
 * The crew's gadgets left on the floor (M4-06): a running jammer (§12.2) with its radius (Euclidean, tiles), so the player
 * sees which radios and phones it silences, and an ammo bag (§11.11) with its refills left. The crew put each there,
 * so it knows them all.
 */
export interface GadgetVM { kind: 'jammer' | 'ammoBag'; at: Pos; radius?: number; uses?: number }

export function gadgetMarkers(world: ReadonlyWorld, state: State): GadgetVM[] {
    return [
        ...(state.jammers ?? []).map(j => ({ kind: 'jammer' as const, at: { x: j.pos.x, y: j.pos.y }, radius: world.rules.jammerRadius })),
        ...(state.ammoBags ?? []).map(b => ({ kind: 'ammoBag' as const, at: { x: b.at.x, y: b.at.y }, uses: b.uses }))
    ];
}

/**
 * A police sniper's laser (§13.6 "Sniper lines are always visible (scope glint and laser), even when the sniper is beyond
 * the crew's sight"; M4-05): from its post to the tile it is on, the shot coming next world phase at whoever it is on
 * if the sniper still sees them. Told whether or not the crew sees the sniper.
 */
export interface LaserVM { from: Pos; to: Pos; target: string }

export const laserMarkers = (state: State): LaserVM[] => sniperLasers(state).map(l => ({ from: l.from, to: l.at, target: l.target }));

/**
 * The fire selector of an attack (§11.1, UI.md "Shot cones": 1 round up to the weapon's Bullets, as many as are loaded):
 * the most it can fire and how many it fires now; undefined for a weapon that fires one (the taser) or no attack.
 */
export function fireSelector(state: State, cmd: Command): { max: number; bullets: number } | undefined {
    if (cmd.type !== 'attack') return undefined;
    const member = state.crew.find(c => c.id === cmd.crew), item = member?.arms.drawn, gun = item ? member!.arms.guns[item] : undefined;
    if (!gun) return undefined;
    const max = Math.min(weaponDef(gun.load).bullets, gun.loaded);
    return max < 2 ? undefined : { max, bullets: Math.min(max, cmd.bullets ?? max) };
}
