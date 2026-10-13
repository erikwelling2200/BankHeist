import { TILE } from './level';

/**
 * The world's 3D scale and how objects occupy it. One pixel is about 8cm in every direction, so a tile is about 1.3m,
 * a person about 1.75m (22px), and full walls are cut away at about 1.9m (24px), just above head height.
 *
 * The camera is a ¾ view with no foreshortening: a point at floor position (x, y) and height z above the floor is drawn
 * at screen (x, y - z). A box therefore shows its top surface (as deep on screen as the box is deep) above its front
 * face (as tall on screen as the box is tall).
 */
export const PX_PER_METRE = 12.5;
export const px = (metres: number): number => Math.round(metres * PX_PER_METRE);

export const WALL_HEIGHT = px(1.92);
/** The shop front is a thin wall: only this much of its tile, along the street edge, is wall. */
export const THIN_WALL = px(0.3);

/** Size of an object in pixels: across (west to east), deep (north to south) and tall. */
export interface Size { w: number; d: number; h: number }

/** An object's place in the world: a footprint on the floor (x, y, w, d) and the height range z..z + h above it. */
export interface Box { x: number; y: number; z: number; w: number; d: number; h: number }

export type AlignX = 'west' | 'center' | 'east';
export type AlignY = 'north' | 'center' | 'south';

/**
 * Where an object stands. `tx`/`ty` is the north-west tile of the tiles it occupies; `span` is how many tiles across
 * and deep that is (by default as many as its footprint needs). Within that span the footprint is pushed to a side or
 * centred: a one-tile object centred stands in the middle of its tile, one given a two-tile span and centred stands on
 * the line between them. Wall dressing stands on the floor tile in front of its wall, aligned north, at an elevation.
 */
export interface Placement { tx: number; ty: number; span?: [number, number]; alignX?: AlignX; alignY?: AlignY; elevation?: number }

function align(start: number, room: number, size: number, side: 'low' | 'center' | 'high'): number {
    if (side === 'low') return start;
    if (side === 'high') return start + room - size;
    return start + Math.floor((room - size) / 2);
}

export function place(p: Placement, size: Size): Box {
    const spanX = p.span?.[0] ?? Math.max(1, Math.ceil(size.w / TILE));
    const spanY = p.span?.[1] ?? Math.max(1, Math.ceil(size.d / TILE));
    if (size.w > spanX * TILE || size.d > spanY * TILE) throw new Error(`A ${size.w}x${size.d} footprint does not fit a ${spanX}x${spanY} tile span`);
    const ax = p.alignX ?? 'center', ay = p.alignY ?? 'center';
    const x = align(p.tx * TILE, spanX * TILE, size.w, ax === 'west' ? 'low' : ax === 'east' ? 'high' : 'center');
    const y = align(p.ty * TILE, spanY * TILE, size.d, ay === 'north' ? 'low' : ay === 'south' ? 'high' : 'center');
    return { x, y, z: p.elevation ?? 0, ...size };
}

/** True when two boxes share volume; touching faces don't count, and flat things (no height) never collide. */
export function boxesOverlap(a: Box, b: Box): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d && a.z < b.z + b.h && b.z < a.z + a.h;
}

/** The screen row of a box's front edge at floor level: its base line, which also orders drawing back to front. */
export const baseLine = (box: Box): number => box.y + box.d;

/** People stand in the middle of their tile: about 0.5m across the shoulders, 0.3m front to back, 1.75m tall. */
export const PERSON_SIZE: Size = { w: px(0.5), d: px(0.3), h: px(1.75) };
