import { TILE } from '../level/level';
import type { Placed } from './furnish';
import type { GenRoom, RoomType } from './model';
import type { Nav } from './nav';
import { tilesOf } from './site';

/*
 * How a bank's rooms play, measured (research/procedural-interiors.md, lesson 13), so a change that makes rooms read as
 * empty again, or leaves nowhere to hide, shows in the tests and the sweep: per room, how many tiles of floor each piece
 * of standing furniture has, how many tiles full-height furniture covers (cover that blocks sight), and how much of
 * the floor someone at its doors sees.
 */

export interface RoomMetrics {
    room: string;
    type: RoomType;
    area: number;
    /** Pieces of furniture standing on its floor (wall dressing and what stands on a top don't count). */
    furniture: number;
    /** Tiles of floor per piece of furniture: a high number reads as an empty room. */
    tilesPerPiece: number;
    /** Tiles that full-height furniture stands on: cover that blocks sight. */
    tallTiles: number;
    /** The share of its floor seen from the tiles inside its doors. */
    seenFromDoors: number;
}

/** The metrics of every bank room. `tall` says which tiles full-height furniture blocks sight on. */
export function roomMetrics(nav: Nav, bank: GenRoom[], boxes: readonly Placed[], tall: (x: number, y: number) => boolean): RoomMetrics[] {
    const { site } = nav, pieces = new Map<GenRoom, number>();
    for (const { box } of boxes) {
        if (box.z > 0 || box.h === 0) continue;
        const room = site.roomAt(Math.floor((box.x + box.w / 2) / TILE), Math.floor((box.y + box.d / 2) / TILE));
        if (room) pieces.set(room, (pieces.get(room) ?? 0) + 1);
    }
    return bank.map(room => {
        const tiles = site.tilesOfRoom(room), furniture = pieces.get(room) ?? 0;
        const doors = site.doors.filter(d => d.a === room.id || d.b === room.id).map(d => tilesOf(d).find(t => site.roomAt(t.x, t.y) === room)!);
        const seen = tiles.filter(t => doors.some(d => nav.sees(d, t, tall))).length;
        return {
            room: room.id, type: room.type, area: tiles.length, furniture, tilesPerPiece: tiles.length / Math.max(1, furniture),
            tallTiles: tiles.filter(t => tall(t.x, t.y)).length, seenFromDoors: tiles.length ? seen / tiles.length : 0
        };
    });
}
