import { TILE } from './level';

/**
 * The world's 3D scale and how objects occupy it. One pixel is about 8cm in every direction, so a tile is about 1.3m,
 * a person about 1.75m (22px), and full walls are cut away at about 1.9m (24px), just above head height.
 *
 * The camera is a ¾ view: a point at floor position (x, y) and height z above the floor is drawn at screen (x, y - z),
 * so floor tiles are square and heights are drawn at full scale. The tops of things standing on the floor are the one
 * exception: they are drawn at `TOP_DEPTH` of their real depth (see `topRows`), so a box shows a shallower top over its
 * full-height front face. This is the familiar pixel-art cheat for a camera a little lower than 45°: a long thing that
 * points at the camera (a van, a bench) still looks longer than it does side-on, but reads as lying down rather than
 * standing up.
 */
export const PX_PER_METRE = 12.5;
export const px = (metres: number): number => Math.round(metres * PX_PER_METRE);

export const WALL_HEIGHT = px(1.92);

/** How deep the top of an object is drawn, as a share of its real depth. Floor-level things keep their full depth. */
export const TOP_DEPTH = 2 / 3;

/** Screen rows the top of something `depth` pixels deep takes. */
export const topRows = (depth: number): number => Math.round(depth * TOP_DEPTH);
/** The shop front is a thin wall: only this much of its tile, along the street edge, is wall. */
export const THIN_WALL = px(0.3);

/**
 * Size of an object in pixels, in its own frame: `w` across its front, `d` from back to front, `h` tall. Facing south
 * (its front towards the camera) that is west-to-east, north-to-south and up; facing east or west, `w` and `d` swap.
 */
export interface Size { w: number; d: number; h: number }

/** Which way an object's front points. Facing south it shows the camera its front; north, its back; east and west, a side. */
export type Facing = 'south' | 'east' | 'north' | 'west';
export const FACINGS: readonly Facing[] = ['south', 'east', 'north', 'west'];

/** The footprint and span an object takes up in the world once turned to `facing`. */
export function turned<T extends { w: number; d: number }>(size: T, facing: Facing): T {
    return facing === 'east' || facing === 'west' ? { ...size, w: size.d, d: size.w } : size;
}

/** An object's place in the world: a footprint on the floor (x, y, w, d, in world axes) and the height range z..z + h. */
export interface Box { x: number; y: number; z: number; w: number; d: number; h: number; facing: Facing }

export type AlignX = 'west' | 'center' | 'east';
export type AlignY = 'north' | 'center' | 'south';

/**
 * Where an object stands. `tx`/`ty` is the north-west tile of the tiles it occupies; `span` is how many tiles across
 * and deep that is in the object's own frame (by default as many as its footprint needs), turned with it. Within that
 * span the footprint is pushed to a side or centred (in world directions): a one-tile object centred stands in the
 * middle of its tile, one given a two-tile span and centred stands on the line between them. Wall dressing stands on
 * the floor tile in front of its wall, against that wall, at an elevation, facing away from it.
 */
export interface Placement { tx: number; ty: number; span?: [number, number]; alignX?: AlignX; alignY?: AlignY; elevation?: number; facing?: Facing }

function align(start: number, room: number, size: number, side: 'low' | 'center' | 'high'): number {
    if (side === 'low') return start;
    if (side === 'high') return start + room - size;
    return start + Math.floor((room - size) / 2);
}

export function place(p: Placement, local: Size): Box {
    const facing = p.facing ?? 'south';
    const size = turned(local, facing);
    const span = p.span ? turned({ w: p.span[0], d: p.span[1] }, facing) : undefined;
    const spanX = span?.w ?? Math.max(1, Math.ceil(size.w / TILE));
    const spanY = span?.d ?? Math.max(1, Math.ceil(size.d / TILE));
    if (size.w > spanX * TILE || size.d > spanY * TILE) throw new Error(`A ${size.w}x${size.d} footprint does not fit a ${spanX}x${spanY} tile span`);
    const ax = p.alignX ?? 'center', ay = p.alignY ?? 'center';
    const x = align(p.tx * TILE, spanX * TILE, size.w, ax === 'west' ? 'low' : ax === 'east' ? 'high' : 'center');
    const y = align(p.ty * TILE, spanY * TILE, size.d, ay === 'north' ? 'low' : ay === 'south' ? 'high' : 'center');
    return { x, y, z: p.elevation ?? 0, w: size.w, d: size.d, h: size.h, facing };
}

/** True when two boxes share volume; touching faces don't count, and flat things (no height) never collide. */
export function boxesOverlap(a: Box, b: Box): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d && a.z < b.z + b.h && b.z < a.z + a.h;
}

/** The screen row of a box's front edge at floor level: its base line, which also orders drawing back to front. */
export const baseLine = (box: Box): number => box.y + box.d;

/** People stand in the middle of their tile: about 0.5m across the shoulders, 0.3m front to back, 1.75m tall. */
export const PERSON_SIZE: Size = { w: px(0.5), d: px(0.3), h: px(1.75) };
