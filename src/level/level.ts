import type { Point } from '../logic/vision';
import { TILE } from './constants';
export { TILE };

/**
 * Legend: `#` wall, `.` floor, `P` player start, `G` gold bar, `L` ceiling lamp, `E` exit,
 * digits mark guard patrol waypoints (each digit is one guard, walking its waypoints in a loop).
 */
export const LEVEL1 = [
    '########################################',
    '#..........#...........#...............#',
    '#....L.....#.....L.....#......L........#',
    '#..........#...........#...............#',
    '#..P.......#..1.....1..#..G.........G..#',
    '#..........#...........#...............#',
    '#..........#...........#.....G...G.....#',
    '#..............................L.......#',
    '#E.........#...........#.....G...G.....#',
    '#..........#...........#...............#',
    '#....L.....#..1.....1..#..G.........G..#',
    '#..........#.....L.....#...............#',
    '#####..#########..##########...#########',
    '#..........................2...........#',
    '#....L...........L.........L.......L...#',
    '#..2...................................#',
    '#......................................#',
    '########################################'
];

export interface LevelData {
    width: number;
    height: number;
    walls: boolean[][];
    playerStart: Point;
    exit: Point;
    gold: Point[];
    lamps: Point[];
    patrols: Point[][];
}

const center = (tx: number, ty: number): Point => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });

export function parseLevel(rows: string[]): LevelData {
    const height = rows.length;
    const width = rows[0]!.length;
    const walls: boolean[][] = [];
    const gold: Point[] = [];
    const lamps: Point[] = [];
    const patrolMap = new Map<string, Point[]>();
    let playerStart: Point | undefined;
    let exit: Point | undefined;
    rows.forEach((row, ty) => {
        if (row.length !== width) throw new Error(`Level row ${ty} has length ${row.length}, expected ${width}`);
        walls.push([...row].map((c, tx) => {
            if (c === 'P') playerStart = center(tx, ty);
            else if (c === 'E') exit = center(tx, ty);
            else if (c === 'G') gold.push(center(tx, ty));
            else if (c === 'L') lamps.push(center(tx, ty));
            else if (c >= '0' && c <= '9') patrolMap.set(c, [...(patrolMap.get(c) ?? []), center(tx, ty)]);
            return c === '#';
        }));
    });
    if (!playerStart) throw new Error('Level has no player start (P)');
    if (!exit) throw new Error('Level has no exit (E)');
    const patrols = [...patrolMap.keys()].sort().map(k => orderPatrol(patrolMap.get(k)!));
    return { width, height, walls, playerStart, exit, gold, lamps, patrols };
}

/** Orders waypoints into a loop around their centroid so a guard walks the perimeter instead of zig-zagging in reading order. */
function orderPatrol(points: Point[]): Point[] {
    const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
    const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
    return [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
}
