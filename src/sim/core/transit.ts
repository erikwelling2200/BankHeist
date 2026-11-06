import type { CrewState, DeepReadonly, Pos } from './types';

/*
 * The off-map routes' shape (GAME_DESIGN §14.7; implementation plan M4-05, decisions 300–303), kept in core so
 * movement (geo/move.ts), sight and shots can leave a crew member in transit out; entering, the transit track and
 * arriving are rules/transit.ts.
 *
 * A route is a pair of access points on the map, its two ends: the roof's ladder in the alley (or the scaffolding)
 * and a hatch or skylight inside, the sewer's manhole in the street and a floor grate in a utility room, and the air
 * duct's roof end (the same ladder) and the vent grille in the server room. A crew member in transit is off the map:
 * no one sees them, they are no body for a bullet or a blast, they stand on no tile, and they can't act.
 */

/** The kinds of off-map route (§14.7): over the roof, under the street, along a duct (the roof's vent). */
export type RouteKind = 'roof' | 'sewer' | 'duct';

/** An off-map route (§14.7): its two access points and the turns spent between them. */
export interface AccessRoute {
    id: string;
    kind: RouteKind;
    /** What the player reads ("Roof route, down the hatch in the alarm closet"). */
    name: string;
    /** The access point outside the bank (the ladder, the manhole). */
    outside: Pos;
    /** The access point inside (the hatch, the skylight, the grate, the vent). */
    inside: Pos;
    /** World phases spent in transit (§14.7: the roof 2, the sewer 3). */
    transit: number;
}

/** A crew member on the transit track (§14.7). */
export interface Transit {
    route: string;
    /** Heading in: entered at the outside end, coming out at the inside one. */
    inward: boolean;
    /** World phases left before they come out at the other end (each world phase takes one; at 0 they are out). */
    left: number;
    /** Where they stood as they went in: where a turned-back crew member comes out again. */
    from: Pos;
    /** Leaving the plot by it (§15.4 "the sewer can also be used as an escape exit"): at 0 they are away, not out. */
    escape: boolean;
}

declare module './types' {
    interface World {
        /** The off-map routes (§14.7), as the generator placed their ends. Absent: none. */
        routes?: AccessRoute[];
    }
    interface CrewState {
        /** On an off-map route (§14.7), or null on the map. */
        transit: Transit | null;
    }
}

/**
 * Whether a crew member is off the map's floor for everyone else: aboard a vehicle with its doors shut (§14.4), or in
 * transit on a route (§14.7). Neither seen, nor a body to hit, nor standing in anyone's way.
 */
export const offMap = (member: DeepReadonly<CrewState>): boolean => !!member.aboard || !!member.transit;

/** Whether a crew member is in transit (a state from before M4-05 has nobody there). */
export const inTransit = (member: DeepReadonly<CrewState>): boolean => !!member.transit;
