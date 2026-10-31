import type { NegotiatorOfferVM, NegotiatorVM } from '../ui/hud/viewModels';
import { actionMenu } from './actions';
import {
    COMBAT_SIGHT, isKnownNow, negotiatorCalling, offerEffect, releasable, tradeable, drivePlan, footprint, isDown, OFFICER_STATS, poseKey, seenWedges, THROWABLES, vehicleDef, vehicleReach, weaponDef,
    type Command, type KnownView, type Pose, type Pos, type ReadonlyWorld, type State
} from '../sim';

/*
 * The loud layer of the world UI (UI.md "Loud", M3-09): Watch wedges, police grenades where they lie, and the driving
 * overlay. Only what the crew knows: police wedges come from `seenWedges` (their officer in sight), a grenade shows
 * where the crew sees it land (or threw it), and the van's reach and path are planned on the crew's picture
 * (`vehicleReach`, `drivePlan`: the NPCs and officers it doesn't see are taken to be absent).
 */

/** A Watch wedge: the crew's steel blue (dragged into place), the police's red. */
export interface WedgeVM {
    side: 'crew' | 'police';
    /** Who holds it (a crew member or an officer). */
    by: string;
    from: Pos;
    at: Pos;
    /** Degrees wide. */
    arc: number;
    /** Tiles it reaches. */
    range: number;
    /** The previewed (not yet set) wedge. */
    preview?: boolean;
}

/** A fused grenade lying where it landed: its radius and the world phases until it goes off. */
export interface GrenadeVM {
    at: Pos;
    kind: string;
    radius: number;
    police: boolean;
    fuse: number;
}

/** A drive previewed (UI.md "Driving the van"). */
export interface DriveVM {
    /** Every tile a footprint the van can reach with this drive covers (on the plot). */
    reach: Pos[];
    /** The chosen pose's footprint, bracketed, and the way it faces. */
    chosen: Pos[];
    heading: Pose['heading'];
    /** The tiles its path sweeps, and the middle of each pose along it (the van's start first). */
    swept: Pos[];
    path: { x: number; y: number }[];
    /** The drive leaves the plot, and where (the path's end brought inside the plot's edge), in tiles. */
    off: boolean;
    exit?: { x: number; y: number };
    /** Crew on foot: flagged, the van would leave them. */
    onFoot: Pos[];
    /** Why the chosen pose can't be driven to, if it can't. */
    refusal?: string;
}

export interface LoudVM {
    wedges: WedgeVM[];
    grenades: GrenadeVM[];
    drive?: DriveVM;
}

/** The middle of a pose's footprint, in tiles (a tile's middle is +0.5). */
export function poseMiddle(world: ReadonlyWorld, vehicle: string, pose: Pose): { x: number; y: number } {
    const def = vehicleDef(world, vehicle)!, tiles = footprint(def, pose);
    const xs = tiles.map(t => t.x), ys = tiles.map(t => t.y);
    return { x: (Math.min(...xs) + Math.max(...xs) + 1) / 2, y: (Math.min(...ys) + Math.max(...ys) + 1) / 2 };
}

/** How far a crew member's wedge reaches: the drawn gun's load's range. */
function crewRange(state: State, crew: string): number {
    const m = state.crew.find(c => c.id === crew), drawn = m?.arms.drawn, gun = drawn ? m.arms.guns[drawn] : undefined;
    return gun ? weaponDef(gun.load).range : 0;
}

/** The loud layer now; `pending` is the previewed command (a Watch's wedge, a Drive's path). */
export function loudView(world: ReadonlyWorld, state: State, known: KnownView, pending: Command | null): LoudVM | undefined {
    const wedges: WedgeVM[] = [];
    for (const m of state.crew) {
        const w = m.arms.watch;
        if (!w) continue;
        wedges.push({ side: 'crew', by: m.id, from: { ...(w.lean ?? m.pos) }, at: { ...w.at }, arc: w.arc, range: crewRange(state, m.id) });
    }
    if (pending?.type === 'watch') {
        const m = state.crew.find(c => c.id === pending.crew);
        if (m) {
            const from = pending.lean ?? m.leaning?.at ?? m.pos;
            wedges.push({ side: 'crew', by: m.id, from: { ...from }, at: { ...pending.at }, arc: pending.arc, range: crewRange(state, m.id), preview: true });
        }
    }
    // Police wedges only where the crew sees the officer (`seenWedges`).
    for (const w of state.police ? seenWedges(world, state) : []) {
        const unit = state.police.units.find(u => u.id === w.unit);
        if (!unit?.pos) continue;
        const gun = OFFICER_STATS[unit.kind].weapon;
        const range = gun ? Math.min(weaponDef(gun).range, COMBAT_SIGHT) : COMBAT_SIGHT;
        wedges.push({ side: 'police', by: unit.id, from: { ...(unit.leaning?.at ?? unit.pos) }, at: w.at, arc: w.arc, range });
    }
    // Grenades: those the crew threw, and those landing where the crew sees now.
    const crewIds = new Set(state.crew.map(c => c.id));
    const grenades: GrenadeVM[] = (state.grenades ?? [])
        .filter(g => crewIds.has(g.by) || known.inView[g.at.y * known.width + g.at.x] === 1 || known.fresh[g.at.y * known.width + g.at.x] === 1)
        .map(g => ({ at: { ...g.at }, kind: g.kind, radius: THROWABLES[g.kind].radius, police: !crewIds.has(g.by), fuse: Math.max(1, g.turn - state.turn + 1) }));
    const drive = pending?.type === 'drive' ? driveView(world, state, pending) : undefined;
    if (!wedges.length && !grenades.length && !drive) return undefined;
    return { wedges, grenades, ...(drive ? { drive } : {}) };
}

/** The driving overlay for a previewed drive: the reach, the chosen footprint and its swept path, crew left on foot. */
export function driveView(world: ReadonlyWorld, state: State, cmd: Extract<Command, { type: 'drive' }>): DriveVM | undefined {
    const def = vehicleDef(world, cmd.vehicle), reach = vehicleReach(world, state, cmd.vehicle);
    if (!def || !reach) return undefined;
    const inPlot = (p: Pos) => p.x >= 0 && p.y >= 0 && p.x < world.width && p.y < world.height;
    const tiles = new Map<string, Pos>();
    for (const node of reach.nodes.values()) for (const t of footprint(def, node.pose)) if (inPlot(t)) tiles.set(`${t.x},${t.y}`, t);
    const plan = drivePlan(world, state, cmd);
    const onFoot = state.crew.filter(c => c.aboard === null && !isDown(c)).map(c => ({ ...c.pos }));
    const chosen = footprint(def, cmd.to).filter(inPlot);
    if (typeof plan === 'string') return { reach: [...tiles.values()], chosen, heading: cmd.to.heading, swept: [], path: [], off: false, onFoot, refusal: plan };
    const path = [reach.from, ...plan.poses].map(p => poseMiddle(world, cmd.vehicle, p));
    const end = path[path.length - 1]!;
    const exit = plan.off ? { x: Math.min(world.width - 0.6, Math.max(0.6, end.x)), y: Math.min(world.height - 0.6, Math.max(0.6, end.y)) } : undefined;
    return { reach: [...tiles.values()], chosen, heading: cmd.to.heading, swept: plan.swept.filter(inPlot), path, off: plan.off, ...(exit ? { exit } : {}), onFoot };
}

/**
 * The poses a drive can end on whose footprint covers `tile`, the cheapest first (a tap on the map picks the first; a
 * tap again on the chosen footprint the next, turning the van round).
 */
export function posesCovering(world: ReadonlyWorld, state: State, vehicle: string, tile: Pos): Pose[] {
    const def = vehicleDef(world, vehicle), reach = vehicleReach(world, state, vehicle);
    if (!def || !reach) return [];
    const start = poseKey(reach.from);
    return [...reach.nodes.entries()]
        .filter(([k, n]) => k !== start && footprint(def, n.pose).some(t => t.x === tile.x && t.y === tile.y))
        .sort((a, b) => a[1].cost - b[1].cost || a[0].localeCompare(b[0]))
        .map(([, n]) => ({ ...n.pose }));
}

/** The offers in the dialog's order (UI.md "Negotiator on the line"). */
const OFFERS = ['release', 'trade', 'stall', 'hangUp'] as const;

/**
 * The negotiator on the line (§13.4), or null when nobody calls: the offers with their effect, as the action grid has
 * them for whoever answers (the selected crew member if they can, else the first who can, else the selected one, the
 * offers then carrying why not).
 */
export function negotiatorView(world: ReadonlyWorld, state: State, selected: string | null): NegotiatorVM | null {
    if (!state.police || !negotiatorCalling(state)) return null;
    const menus = state.crew.map(c => ({ crew: c, menu: actionMenu(world, state, c.id).filter(e => e.id.startsWith('negotiate:')) }));
    const can = (m: (typeof menus)[number]) => m.menu.some(e => !e.reason);
    const pick = menus.find(m => m.crew.id === selected && can(m)) ?? menus.find(can) ?? menus.find(m => m.crew.id === selected) ?? menus[0];
    if (!pick) return null;
    const held = state.npcs.filter(n => releasable(n) && isKnownNow(world, state, n.id)).length;
    const relief = offerEffect(state, 'release').heat, stall = offerEffect(state, 'stall').phases;
    const back = tradeable(state)[0];
    const backName = back ? state.custody.find(c => c.crew.id === back)?.crew.name : undefined;
    const offers: NegotiatorOfferVM[] = OFFERS.map(offer => {
        const id = `negotiate:${offer}`, entry = pick.menu.find(e => e.id === id);
        const label = offer === 'release' ? 'Release a hostage' : offer === 'trade' ? (backName ? `Trade for ${backName}` : 'Trade') : offer === 'stall' ? 'Stall' : 'Hang up';
        const effect = offer === 'release' ? (relief ? `${relief < 0 ? '−' : '+'}${Math.abs(relief)} heat` : '')
            : offer === 'stall' ? `+${stall} turns` : offer === 'trade' ? (backName ? `${backName} back` : '') : '';
        const reason = entry?.reason ?? (entry ? undefined
            : offer === 'trade' && !backName ? 'Nobody of the crew is in custody' : offer === 'release' || offer === 'trade' ? 'No hostage held' : 'Not now');
        return { id, offer, label, effect, ...(reason ? { reason } : {}) };
    });
    return { crew: pick.crew.id, crewName: pick.crew.name, offers, left: state.police.mode?.left ?? 0, hostages: held };
}
