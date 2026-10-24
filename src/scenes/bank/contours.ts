import type { Pos } from '../../sim';

/*
 * Tile-set outlines for the world overlay (its band edges, cones and noise ring): a set's sides chained into runs, so
 * a dashed edge flows round corners instead of restarting on every tile, and inset loops for rings drawn inside the
 * tiles. Everything here is in tile units; the overlay turns it into pixels.
 */

/** One side of a tile, walked with the tile on its right (screen coordinates, y down). */
export interface Side { x0: number; y0: number; x1: number; y1: number; tile: Pos }

/**
 * The sides of `tiles` whose neighbour across is not `inside`, each walked with its tile on the right, chained end to
 * start into runs (closed loops, or open runs where the sides kept stop). At a vertex where two runs touch corner to
 * corner, the run turns right, round its own tile, so touching regions stay apart.
 */
export function sideRuns(tiles: readonly Pos[], inside: (x: number, y: number) => boolean): Side[][] {
    const sides: Side[] = [], once = new Set<string>();
    for (const p of tiles) {
        // A tile given twice is one tile: its sides twice would break the chains.
        if (once.has(`${p.x},${p.y}`)) continue;
        once.add(`${p.x},${p.y}`);
        const { x, y } = p;
        if (!inside(x, y - 1)) sides.push({ x0: x, y0: y, x1: x + 1, y1: y, tile: p });
        if (!inside(x + 1, y)) sides.push({ x0: x + 1, y0: y, x1: x + 1, y1: y + 1, tile: p });
        if (!inside(x, y + 1)) sides.push({ x0: x + 1, y0: y + 1, x1: x, y1: y + 1, tile: p });
        if (!inside(x - 1, y)) sides.push({ x0: x, y0: y + 1, x1: x, y1: y, tile: p });
    }
    const key = (x: number, y: number) => `${x},${y}`;
    const from = new Map<string, Side[]>(), ends = new Set<string>();
    for (const s of sides) {
        const k = key(s.x0, s.y0);
        from.set(k, [...(from.get(k) ?? []), s]);
        ends.add(key(s.x1, s.y1));
    }
    const used = new Set<Side>();
    const next = (s: Side): Side | undefined => {
        const options = (from.get(key(s.x1, s.y1)) ?? []).filter(o => !used.has(o));
        if (options.length < 2) return options[0];
        const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
        // Right turn, then straight on, then left.
        const turn = (o: Side) => {
            const ox = o.x1 - o.x0, oy = o.y1 - o.y0;
            return ox === -dy && oy === dx ? 0 : ox === dx && oy === dy ? 1 : 2;
        };
        return options.sort((a, b) => turn(a) - turn(b))[0];
    };
    const runs: Side[][] = [];
    // Open runs first, from the sides nothing leads into; then the closed loops.
    const starts = [...sides.filter(s => !ends.has(key(s.x0, s.y0))), ...sides];
    for (const start of starts) {
        if (used.has(start)) continue;
        const run: Side[] = [];
        for (let s: Side | undefined = start; s && !used.has(s); s = next(s)) {
            used.add(s);
            run.push(s);
        }
        runs.push(run);
    }
    return runs;
}

/** A closed loop's corners, each pushed `inset` tiles inwards (to the right of the walk), and the tile it is drawn by. */
export interface Corner { x: number; y: number; tile: Pos }

/**
 * Each closed loop of `tiles`' outline as its corners moved `inset` tiles into the set: both sides meeting at a corner
 * shift inwards, so convex corners move in and concave ones out, and a hole's loop grows. Open runs are dropped.
 */
export function insetLoops(tiles: readonly Pos[], inside: (x: number, y: number) => boolean, inset: number): Corner[][] {
    const loops: Corner[][] = [];
    for (const run of sideRuns(tiles, inside)) {
        const first = run[0]!, last = run.at(-1)!;
        if (last.x1 !== first.x0 || last.y1 !== first.y0) continue;
        // Inward normal of a side walked with its tile on the right: (-dy, dx).
        const normal = (s: Side) => [-(s.y1 - s.y0), s.x1 - s.x0] as const;
        const corners: Corner[] = [];
        run.forEach((s, i) => {
            const prev = run[(i + run.length - 1) % run.length]!;
            const [ax, ay] = normal(prev), [bx, by] = normal(s);
            // A straight join is no corner.
            if (ax === bx && ay === by) return;
            corners.push({ x: s.x0 + inset * (ax + bx), y: s.y0 + inset * (ay + by), tile: s.tile });
        });
        if (corners.length >= 3) loops.push(corners);
    }
    return loops;
}

/**
 * `inside`, with every hole in `tiles` of at most `max` tiles filled: a group of tiles not inside, side by side, that
 * the set closes round (a counter, a pillar, a person in the middle of a band), so an outline is the set's outer edge.
 */
export function withoutHoles(tiles: readonly Pos[], inside: (x: number, y: number) => boolean, max = 6): (x: number, y: number) => boolean {
    if (!tiles.length) return inside;
    const x0 = Math.min(...tiles.map(p => p.x)) - 1, x1 = Math.max(...tiles.map(p => p.x)) + 1;
    const y0 = Math.min(...tiles.map(p => p.y)) - 1, y1 = Math.max(...tiles.map(p => p.y)) + 1;
    const w = x1 - x0 + 1, seen = new Uint8Array(w * (y1 - y0 + 1)), holes = new Set<string>();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (seen[(y - y0) * w + x - x0] || inside(x, y)) continue;
        // One group of tiles not inside, flooded side to side; a hole when it doesn't reach the box's edge.
        const group: Pos[] = [], todo: Pos[] = [{ x, y }];
        let open = false;
        seen[(y - y0) * w + x - x0] = 1;
        while (todo.length) {
            const p = todo.pop()!;
            group.push(p);
            if (p.x === x0 || p.x === x1 || p.y === y0 || p.y === y1) open = true;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const q = { x: p.x + dx, y: p.y + dy }, i = (q.y - y0) * w + q.x - x0;
                if (q.x < x0 || q.x > x1 || q.y < y0 || q.y > y1 || seen[i] || inside(q.x, q.y)) continue;
                seen[i] = 1;
                todo.push(q);
            }
        }
        if (!open && group.length <= max) for (const p of group) holes.add(`${p.x},${p.y}`);
    }
    return holes.size ? (x, y) => inside(x, y) || holes.has(`${x},${y}`) : inside;
}
