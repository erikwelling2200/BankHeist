import { TILE } from './constants';

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

/**
 * A wall the camera looks past is cut down to this height, so the floor and anyone behind it stay in view. Walls step
 * between their full and cut heights through `WALL_STEPS`, lowest first.
 */
export const CUT_HEIGHT = px(0.6);
export const WALL_STEPS = [CUT_HEIGHT, Math.round((CUT_HEIGHT + WALL_HEIGHT) / 2), WALL_HEIGHT] as const;

/** How deep the top of an object is drawn, as a share of its real depth. Floor-level things keep their full depth. */
export const TOP_DEPTH = 2 / 3;

/** Screen rows the top of something `depth` pixels deep takes. */
export const topRows = (depth: number): number => Math.round(depth * TOP_DEPTH);

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
 * the floor tile in front of its wall, against that wall, at an elevation, facing away from it. `offset` moves it by
 * whole pixels (world axes) from there: a mug or a monitor stands where it stands on a desk, not only in a tile's middle.
 */
export interface Placement {
    tx: number;
    ty: number;
    span?: [number, number] | undefined;
    alignX?: AlignX | undefined;
    alignY?: AlignY | undefined;
    elevation?: number | undefined;
    facing?: Facing | undefined;
    offset?: [number, number] | undefined;
}

/** How far walls reach into a span of tiles from each side; something pushed against a side stands against the wall's face. */
export interface Insets { north: number; south: number; west: number; east: number }

export const NO_INSETS: Insets = { north: 0, south: 0, west: 0, east: 0 };

/** The tiles a placement takes: its north-west tile and how many tiles across and deep, in world directions. */
export function spanOf(p: Placement, local: Size): { tx: number; ty: number; w: number; d: number } {
    const facing = p.facing ?? 'south';
    const size = turned(local, facing);
    const span = p.span ? turned({ w: p.span[0], d: p.span[1] }, facing) : undefined;
    return { tx: p.tx, ty: p.ty, w: span?.w ?? Math.max(1, Math.ceil(size.w / TILE)), d: span?.d ?? Math.max(1, Math.ceil(size.d / TILE)) };
}

function align(start: number, room: number, size: number, side: 'low' | 'center' | 'high'): number {
    if (side === 'low') return start;
    if (side === 'high') return start + room - size;
    return start + Math.floor((room - size) / 2);
}

/** Places an object in its span. Pushed against a side, it stands against the face of any wall on that side (`insets`). */
export function place(p: Placement, local: Size, insets: Insets = NO_INSETS): Box {
    const facing = p.facing ?? 'south';
    const size = turned(local, facing);
    const span = spanOf(p, local);
    const room = { x: p.tx * TILE + insets.west, y: p.ty * TILE + insets.north, w: span.w * TILE - insets.west - insets.east, d: span.d * TILE - insets.north - insets.south };
    if (size.w > room.w || size.d > room.d) throw new Error(`A ${size.w}x${size.d} footprint does not fit a ${room.w}x${room.d} space between walls`);
    const ax = p.alignX ?? 'center', ay = p.alignY ?? 'center';
    // Centred things stay centred on their tiles unless a wall is in the way, then they stand just clear of it.
    const clamp = (v: number, start: number, room: number, size: number) => Math.min(start + room - size, Math.max(start, v));
    const x = ax === 'center' ? clamp(align(p.tx * TILE, span.w * TILE, size.w, 'center'), room.x, room.w, size.w) : align(room.x, room.w, size.w, ax === 'west' ? 'low' : 'high');
    const y = ay === 'center' ? clamp(align(p.ty * TILE, span.d * TILE, size.d, 'center'), room.y, room.d, size.d) : align(room.y, room.d, size.d, ay === 'north' ? 'low' : 'high');
    return { x: x + (p.offset?.[0] ?? 0), y: y + (p.offset?.[1] ?? 0), z: p.elevation ?? 0, w: size.w, d: size.d, h: size.h, facing };
}

/** True when two boxes share volume; touching faces don't count, and flat things (no height) never collide. */
export function boxesOverlap(a: Box, b: Box): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d && a.z < b.z + b.h && b.z < a.z + a.h;
}

/** The screen row of a box's front edge at floor level: its base line, which also orders drawing back to front. */
export const baseLine = (box: Box): number => box.y + box.d;

/**
 * The box something raised stands on (a monitor on a desk): the one among `boxes` whose top is at its elevation and
 * whose footprint holds its own.
 */
export function supportOf(box: Box, boxes: readonly Box[]): Box {
    const under = boxes.find(b => b !== box && b.z + b.h === box.z && b.x <= box.x && box.x + box.w <= b.x + b.w && b.y <= box.y && box.y + box.d <= b.y + b.d);
    if (!under) throw new Error(`Nothing under the ${box.w}x${box.d} box at (${box.x}, ${box.y}) has its top at ${box.z} and room for it`);
    return under;
}

/**
 * The screen row a box's front edge is drawn on, at its elevation. On the floor or a wall that is its base line less its
 * elevation. On another box's top it is where that top is drawn, and tops are drawn at `TOP_DEPTH` of their depth, so a
 * mug at the back of a desk stands at the back of the desk's top as drawn rather than floating above it.
 */
export function frontRow(box: Box, support?: Box): number {
    if (support === undefined) return baseLine(box) - box.z;
    return baseLine(support) - box.z - Math.round((baseLine(support) - baseLine(box)) * TOP_DEPTH);
}

/**
 * Where a box comes when drawing back to front. Usually its base line; but a thing standing on another box has its base
 * line on that box's top, behind its front edge, so ordering by it would hide a mug behind the desk it stands on.
 * Instead it comes just after its support, in the gap before the next whole row (a person in front of the desk still
 * covers both), and things on one top keep their own order, back to front.
 */
export function drawLine(box: Box, support?: Box): number {
    if (support === undefined) return baseLine(box);
    return baseLine(support) + 0.5 + (0.4 * (baseLine(box) - support.y)) / (support.d + 1);
}

/** How far a prop's unlit layer (its screens and lamps) is drawn in front of it: within its row, after its own lit pixels. */
export const GLOW_DEPTH = 0.05;

/** People stand in the middle of their tile: about 0.5m across the shoulders, 0.3m front to back, 1.75m tall. */
export const PERSON_SIZE: Size = { w: px(0.5), d: px(0.3), h: px(1.75) };
