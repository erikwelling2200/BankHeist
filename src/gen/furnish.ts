import { TILE } from '../level/constants';
import { isOnTop, propBox, propSpan } from '../level/catalog';
import type { LevelProp } from '../level/plan';
import { boxesOverlap, PERSON_SIZE, place, type Box } from '../level/space';
import { blocksMoveAt, isGap, tilesOfBox, wallsAround, type PlacedProp } from '../level/tileProps';
import { wallFootprint, type Wall, type WallKind } from '../level/walls';
import type { GenRoom } from './model';
import { tilesOf, type Site } from './site';

/** Walls a picture, a clock or a camera can hang on: solid ones, not doors, glass or railings. */
export const HANGABLE: readonly WallKind[] = ['plaster', 'concrete', 'vault', 'brick', 'pier', 'brickPier', 'thick'];

/** A placed prop and the box it fills. */
export type Placed = PlacedProp;

/**
 * Places props on the site so they fit: each stands inside its tiles between the walls, intersects nothing already
 * placed (in 3D, as the tests check), keeps the tiles in front of doors free, and wall dressing hangs on a solid wall.
 * Things that stand on another prop (a monitor, a mug) need that prop's top under them instead (`supportOf`'s rule).
 * `try` reports whether a prop went in; the parcels try alternatives until one does. A group of props goes in as one:
 * `mark` before it, `rollback` if a piece it needs doesn't fit.
 */
export class Furnisher {
    readonly boxes: Placed[] = [];
    /** Tiles kept free of anything standing on the floor: in front of doors, on paths, where people stand. */
    private readonly kept = new Set<string>();
    /** Tiles where someone stands. */
    private readonly standing = new Set<string>();
    /** The boxes over each tile (by `y * width + x`), so a new prop is only checked against its neighbours. */
    private readonly byTile = new Map<number, Placed[]>();
    /** What was kept and stood on since the site was made, in order, so a rollback can take it back. */
    private readonly log: { set: Set<string>; key: string }[] = [];

    constructor(private readonly site: Site) {}

    keep(x: number, y: number): void {
        this.add(this.kept, `${x},${y}`);
    }

    /** Kept free: marked so, or in front of a door (doors are added as the site is built, so they are read each time). */
    isKept(x: number, y: number): boolean {
        if (this.doorCount !== this.site.doors.length) {
            for (const door of this.site.doors.slice(this.doorCount)) for (const t of tilesOf(door)) this.kept.add(`${t.x},${t.y}`);
            this.doorCount = this.site.doors.length;
        }
        return this.kept.has(`${x},${y}`);
    }

    private doorCount = 0;

    /** Marks a tile where someone will stand, so nothing is placed on it. */
    stand(x: number, y: number): boolean {
        const box = place({ tx: x, ty: y }, PERSON_SIZE);
        if (this.near(box).some(b => boxesOverlap(b.box, box)) || this.standing.has(`${x},${y}`) || this.inWall(box)) return false;
        this.add(this.standing, `${x},${y}`);
        this.keep(x, y);
        return true;
    }

    canStand(x: number, y: number): boolean {
        if (!this.site.inside(x, y) || this.site.owner[y]![x]! < 0 || this.site.tiles[y]![x] === 'z') return false;
        const box = place({ tx: x, ty: y }, PERSON_SIZE);
        return !this.standing.has(`${x},${y}`) && !this.near(box).some(b => boxesOverlap(b.box, box)) && !this.inWall(box);
    }

    isStanding(x: number, y: number): boolean {
        return this.standing.has(`${x},${y}`);
    }

    try(prop: LevelProp, room?: GenRoom): boolean {
        const box = this.fits(prop, room);
        if (!box) return false;
        const placed = { prop, box };
        this.boxes.push(placed);
        for (const t of tilesOfBox(box)) {
            const k = t.y * this.site.width + t.x;
            const list = this.byTile.get(k);
            if (list) list.push(placed);
            else this.byTile.set(k, [placed]);
        }
        this.site.props.push(prop);
        return true;
    }

    /** Where a prop would stand if it fits (as `try` decides), without placing it. */
    fits(prop: LevelProp, room?: GenRoom): Box | undefined {
        let box: Box, span: { tx: number; ty: number; w: number; d: number };
        try {
            span = propSpan(prop);
            box = propBox(prop, this.wallsAround(span.tx, span.ty, span.tx + span.w - 1, span.ty + span.d - 1));
        } catch {
            return undefined;
        }
        const tiles = tilesOfBox(box);
        for (const { x, y } of tiles) {
            if (!this.site.inside(x, y) || this.site.owner[y]![x]! < 0) return undefined;
            if (room && this.site.roomAt(x, y) !== room) return undefined;
            // Nothing on stairs, and nothing standing in front of a door or where someone stands.
            if (this.site.tiles[y]![x] === 'z' && box.h > 0) return undefined;
            if (box.z === 0 && box.h > 0 && !isGap(prop, x, y) && (this.isKept(x, y) || this.standing.has(`${x},${y}`))) return undefined;
        }
        // Flat things lie on one floor level, whatever they are.
        if (box.h === 0 && new Set(tiles.map(t => this.site.heightAt(t.x, t.y))).size > 1) return undefined;
        const near = this.near(box);
        if (near.some(b => boxesOverlap(b.box, box))) return undefined;
        if (isOnTop(prop.kind)) {
            // A second-tier thing stands on a top at its elevation that holds its whole footprint (`supportOf`).
            if (!near.some(({ box: b }) => b.z + b.h === box.z && b.x <= box.x && box.x + box.w <= b.x + b.w && b.y <= box.y && box.y + box.d <= b.y + b.d)) return undefined;
        } else if (box.z > 0 && box.d <= 2 && !this.hangsOnWall(box)) return undefined;
        // Nothing standing may cut through a wall.
        if (box.h > 0 && this.inWall(box)) return undefined;
        return box;
    }

    /** Whether a box cuts into a wall's footprint: metre-thick walls reach well into the tiles beside them. */
    private inWall(box: Box): boolean {
        const x0 = Math.floor(box.x / TILE), y0 = Math.floor(box.y / TILE), x1 = Math.floor((box.x + box.w - 1) / TILE), y1 = Math.floor((box.y + box.d - 1) / TILE);
        return this.wallsAround(x0, y0, x1, y1).some(w => {
            const f = wallFootprint(w);
            return box.x < f.x + f.w && f.x < box.x + box.w && box.y < f.y + f.d && f.y < box.y + box.d;
        });
    }

    /** Tries each prop in turn; the first that fits goes in. */
    first(props: LevelProp[], room?: GenRoom): LevelProp | undefined {
        return props.find(p => this.try(p, room));
    }

    /** A point to come back to: everything placed, kept or stood on after it can be taken back. */
    mark(): { boxes: number; props: number; log: number } {
        return { boxes: this.boxes.length, props: this.site.props.length, log: this.log.length };
    }

    /** Takes back everything placed, kept or stood on since `mark`. */
    rollback(mark: { boxes: number; props: number; log: number }): void {
        for (const placed of this.boxes.splice(mark.boxes)) for (const t of tilesOfBox(placed.box)) {
            const list = this.byTile.get(t.y * this.site.width + t.x)!;
            list.splice(list.indexOf(placed), 1);
        }
        this.site.props.splice(mark.props);
        for (const { set, key } of this.log.splice(mark.log)) set.delete(key);
    }

    /** Dressing hangs on the face of a solid east-west wall on its tile's north edge, below the cut-away top. */
    private hangsOnWall(box: Box): boolean {
        const tx = Math.floor(box.x / TILE), ty = Math.floor(box.y / TILE);
        const wall = this.site.wallAt({ run: 'eastWest', tx, ty });
        if (!wall || !HANGABLE.includes(wall.kind)) return false;
        const f = wallFootprint(wall);
        return box.y === f.y + f.d && Math.floor((box.x + box.w - 1) / TILE) === tx;
    }

    /** Whether a tile has something standing on it a person can't walk through. */
    blocked(x: number, y: number): boolean {
        return this.near(place({ tx: x, ty: y }, PERSON_SIZE)).some(b => blocksMoveAt(b, x, y));
    }

    /** Whether anything stands on the floor of a tile (however little of it), for a quick look before trying a prop. */
    occupied(x: number, y: number): boolean {
        return (this.byTile.get(y * this.site.width + x) ?? []).some(b => b.box.z === 0 && b.box.h > 0);
    }

    /** The props placed over the tiles a box touches. */
    private near(box: Box): Placed[] {
        const out = new Set<Placed>();
        for (const t of tilesOfBox(box)) for (const b of this.byTile.get(t.y * this.site.width + t.x) ?? []) out.add(b);
        return [...out];
    }

    /** The walls on the edges of tiles x0..x1, y0..y1 and of the tiles round them. */
    private wallsAround(x0: number, y0: number, x1: number, y1: number): Wall[] {
        return wallsAround(e => this.site.wallAt(e), x0, y0, x1, y1);
    }

    private add(set: Set<string>, key: string): void {
        if (set.has(key)) return;
        set.add(key);
        this.log.push({ set, key });
    }
}
