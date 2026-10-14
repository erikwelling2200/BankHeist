import { TILE } from '../level/level';
import { propBox } from '../level/catalog';
import type { LevelProp } from '../level/plan';
import { boxesOverlap, PERSON_SIZE, place, type Box } from '../level/space';
import { wallFootprint, type WallKind } from '../level/walls';
import type { GenRoom } from './model';
import { tilesOf, type Site } from './site';

/** Walls a picture, a clock or a camera can hang on: solid ones, not doors, glass or railings. */
const HANGABLE: readonly WallKind[] = ['plaster', 'concrete', 'vault', 'brick', 'pier', 'brickPier', 'thick'];

/**
 * Places props on the site so they fit: each stands inside its tiles between the walls, intersects nothing already
 * placed (in 3D, as the tests check), keeps the tiles in front of doors free, and wall dressing hangs on a solid wall.
 * `try` reports whether a prop went in; the parcels try alternatives until one does.
 */
export class Furnisher {
    readonly boxes: { prop: LevelProp; box: Box }[] = [];
    /** Tiles kept free of anything standing on the floor: in front of doors, on paths, where people stand. */
    private readonly kept = new Set<string>();
    /** Tiles where someone stands. */
    private readonly standing = new Set<string>();

    constructor(private readonly site: Site) {}

    keep(x: number, y: number): void {
        this.kept.add(`${x},${y}`);
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
        if (this.boxes.some(b => boxesOverlap(b.box, box)) || this.standing.has(`${x},${y}`)) return false;
        this.standing.add(`${x},${y}`);
        this.keep(x, y);
        return true;
    }

    canStand(x: number, y: number): boolean {
        if (!this.site.inside(x, y) || this.site.owner[y]![x]! < 0 || this.site.tiles[y]![x] === 'z') return false;
        const box = place({ tx: x, ty: y }, PERSON_SIZE);
        return !this.standing.has(`${x},${y}`) && !this.boxes.some(b => boxesOverlap(b.box, box));
    }

    try(prop: LevelProp, room?: GenRoom): boolean {
        let box: Box;
        try {
            box = propBox(prop, [...this.site.walls.values()]);
        } catch {
            return false;
        }
        const x0 = Math.floor(box.x / TILE), y0 = Math.floor(box.y / TILE), x1 = Math.floor((box.x + box.w - 1) / TILE), y1 = Math.floor((box.y + box.d - 1) / TILE);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            if (!this.site.inside(x, y) || this.site.owner[y]![x]! < 0) return false;
            if (room && this.site.roomAt(x, y) !== room) return false;
            // Nothing on stairs, and nothing standing in front of a door or where someone stands.
            if (this.site.tiles[y]![x] === 'z' && box.h > 0) return false;
            if (box.z === 0 && box.h > 0 && (this.isKept(x, y) || this.standing.has(`${x},${y}`))) return false;
        }
        // Flat things lie on one floor level, whatever they are.
        if (box.h === 0 && new Set(tilesOfBox(box).map(t => this.site.heightAt(t.x, t.y))).size > 1) return false;
        if (this.boxes.some(b => boxesOverlap(b.box, box))) return false;
        if (box.z > 0 && box.d <= 2 && !this.hangsOnWall(box)) return false;
        // Nothing standing may cut through a wall.
        if (box.h > 0 && [...this.site.walls.values()].some(w => {
            const f = wallFootprint(w);
            return box.x < f.x + f.w && f.x < box.x + box.w && box.y < f.y + f.d && f.y < box.y + box.d;
        })) return false;
        this.boxes.push({ prop, box });
        this.site.props.push(prop);
        return true;
    }

    /** Tries each prop in turn; the first that fits goes in. */
    first(props: LevelProp[], room?: GenRoom): LevelProp | undefined {
        return props.find(p => this.try(p, room));
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
        const person = place({ tx: x, ty: y }, PERSON_SIZE);
        return this.boxes.some(b => b.box.h > 0 && b.box.z < PERSON_SIZE.h && boxesOverlap(b.box, person));
    }
}

function tilesOfBox(box: Box): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (let y = Math.floor(box.y / TILE); y <= Math.floor((box.y + box.d - 1) / TILE); y++) for (let x = Math.floor(box.x / TILE); x <= Math.floor((box.x + box.w - 1) / TILE); x++) out.push({ x, y });
    return out;
}
