import { doorless, ownerGrid, type Layout } from './layout';
import type { Rect, RoomType } from './model';
import type { Rng } from './rng';
import { isOpenPair, ROOM_RULES } from './rooms';

/*
 * Shape moves (§17.2 step 2; research/procedural-interiors.md, lessons 2 and 3): once an archetype has placed its rooms
 * as rectangles, neighbouring rooms trade corner blocks, so one gets a notch and the other an L, a corridor gets a bay,
 * a room an alcove. Each move is scored by a shape cost per room type (its corners and how concave it is: free in a
 * corridor, cheap in a break room or the records, dear in an office or a secure room) plus how far each room's area is
 * off its target, and kept when it lowers the cost or, now and then, on a seeded roll: a short, bounded walk.
 *
 * Hard rules: every room stays in one piece with nothing narrower than two tiles and room for a 3×3 square of
 * furniture, no U-shapes (whatever a room's bounding box doesn't cover lies in its corners), every pair of rooms that
 * met still meets, a secure room meets no new room (so the CCTV room never comes to touch the vault corridor, §17.7),
 * and the rooms the design keeps rectangular (the core, the teller line, the stairs and the gallery), the street row
 * and the lobby's row along the counter stay as they are.
 */

/** Rooms that keep their rectangle. */
const FIXED: readonly RoomType[] = ['vault', 'antechamber', 'mantrap', 'tellerLine', 'stairwell', 'mezzanine'];

/** What each step away from a rectangle costs a room type: nothing in a corridor, little where an L reads well. */
const SHAPE_COST: Partial<Record<RoomType, number>> = {
    staffCorridor: 0, lobby: 0.4, breakRoom: 0.4, recordsRoom: 0.4, restroom: 0.5, loadingBay: 0.5, cleanersCloset: 0.6, conferenceRoom: 0.8,
    staffOffice: 0.8, atmRoom: 0.8, managerOffice: 1.2, depositBoxes: 1.5, serverRoom: 1.5, alarmCloset: 1.5, countingRoom: 1.5, cctvRoom: 2
};

/** How readily a worse move is kept: one that raises the cost by this much is kept about one time in e. */
const TEMPERATURE = 1;
/** Moves proposed per bank, and the most kept, per room that isn't a corridor. */
const PROPOSALS = 500;
const MOVES_PER_ROOM = 0.6;
/** The most corners a room may have: an L has six, a T or a notched L eight. */
const MOST_CORNERS = 8;

interface Shape { ok: boolean; area: number; box: Rect; corners: number }

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** The shape of the tiles the grid gives room `i` within `within`: its area, bounding box and corners, and whether it is allowed. */
function shapeOf(grid: Int16Array, W: number, i: number, within: Rect, corridor: boolean): Shape {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, area = 0;
    for (let y = within.y; y < within.y + within.h; y++) for (let x = within.x; x < within.x + within.w; x++) {
        if (grid[y * W + x] !== i) continue;
        area++;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    const box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    const bad: Shape = { ok: false, area, box, corners: 0 };
    if (!area) return bad;
    const m = (x: number, y: number) => x >= 0 && y >= 0 && x < box.w && y < box.h && grid[(box.y + y) * W + box.x + x] === i;
    // One piece.
    const seen = new Uint8Array(box.w * box.h), queue: number[] = [];
    for (let k = 0; k < box.w * box.h && !queue.length; k++) if (m(k % box.w, Math.floor(k / box.w))) { queue.push(k); seen[k] = 1; }
    let reached = 0;
    while (queue.length) {
        const k = queue.pop()!, x = k % box.w, y = Math.floor(k / box.w);
        reached++;
        for (const [dx, dy] of STEPS) if (m(x + dx, y + dy) && !seen[(y + dy) * box.w + x + dx]) { seen[(y + dy) * box.w + x + dx] = 1; queue.push((y + dy) * box.w + x + dx); }
    }
    if (reached !== area) return bad;
    // Two tiles wide everywhere: every tile in a 2×2 square of the room. A room (not a corridor) is three wide but for
    // an alcove: every tile within two steps of a 3×3 square of it, so no arm is a two-tile sliver.
    const square = (x: number, y: number, n: number) => {
        for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) if (!m(x + k, y + j)) return false;
        return true;
    };
    const near = new Int8Array(box.w * box.h).fill(-1), wide: number[] = [];
    for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
        if (!m(x, y)) continue;
        if (!square(x - 1, y - 1, 2) && !square(x, y - 1, 2) && !square(x - 1, y, 2) && !square(x, y, 2)) return bad;
        if (!corridor && square(x, y, 3)) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) if (near[(y + j) * box.w + x + k] !== 0) {
            near[(y + j) * box.w + x + k] = 0;
            wide.push((y + j) * box.w + x + k);
        }
    }
    if (!corridor) {
        for (let head = 0; head < wide.length; head++) {
            const k = wide[head]!, x = k % box.w, y = Math.floor(k / box.w);
            for (const [dx, dy] of STEPS) if (m(x + dx, y + dy) && near[(y + dy) * box.w + x + dx] === -1) {
                near[(y + dy) * box.w + x + dx] = near[k]! + 1;
                wide.push((y + dy) * box.w + x + dx);
            }
        }
        if (wide.length !== area || wide.some(k => near[k]! > 2)) return bad;
    }
    // Corners: the outline's vertices, where one or three of the four tiles round a point are the room's.
    let corners = 0;
    for (let y = 0; y <= box.h; y++) for (let x = 0; x <= box.w; x++) {
        const n = +m(x - 1, y - 1) + +m(x, y - 1) + +m(x - 1, y) + +m(x, y);
        if (n === 1 || n === 3) corners++;
        else if (n === 2 && m(x - 1, y - 1) === m(x, y)) corners += 2;
    }
    if (corners > MOST_CORNERS) return bad;
    // No U: every part of the bounding box the room leaves out reaches one of its corners (and none is a hole).
    const out = new Uint8Array(box.w * box.h);
    for (let k = 0; k < box.w * box.h; k++) {
        const kx = k % box.w, ky = Math.floor(k / box.w);
        if (m(kx, ky) || out[k]) continue;
        let corner = false;
        const stack = [k];
        out[k] = 1;
        while (stack.length) {
            const c = stack.pop()!, x = c % box.w, y = Math.floor(c / box.w);
            if ((x === 0 || x === box.w - 1) && (y === 0 || y === box.h - 1)) corner = true;
            for (const [dx, dy] of STEPS) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= box.w || ny >= box.h || m(nx, ny) || out[ny * box.w + nx]) continue;
                out[ny * box.w + nx] = 1;
                stack.push(ny * box.w + nx);
            }
        }
        if (!corner) return bad;
    }
    return { ok: true, area, box, corners };
}

/** What a room's shape costs: steps away from a rectangle and concavity by its type, and its area off target. */
function cost(type: RoomType, s: Shape): number {
    const area = ROOM_RULES[type].area, concave = (s.box.w * s.box.h - s.area) / s.area;
    return (SHAPE_COST[type] ?? 1) * ((s.corners - 4) / 2 + concave) + (area ? (0.5 * Math.abs(s.area - area.target)) / area.target : 0);
}

/** How many edges each pair of rooms shares, as a flat N×N table. */
function adjacency(grid: Int16Array, W: number, D: number, n: number): Uint16Array {
    const out = new Uint16Array(n * n);
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) {
        const i = grid[y * W + x]!;
        if (x + 1 < W) { const j = grid[y * W + x + 1]!; if (i !== j) { out[i * n + j]!++; out[j * n + i]!++; } }
        if (y + 1 < D) { const j = grid[(y + 1) * W + x]!; if (i !== j) { out[i * n + j]!++; out[j * n + i]!++; } }
    }
    return out;
}

/** The rectangles of room `i`, largest first: the biggest rectangle of its tiles, then the biggest of the rest. */
function decompose(grid: Int16Array, W: number, i: number, box: Rect): Rect[] {
    const left = new Uint8Array(box.w * box.h);
    for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) left[y * box.w + x] = grid[(box.y + y) * W + box.x + x] === i ? 1 : 0;
    const parts: Rect[] = [];
    while (left.includes(1)) {
        let best = { x: 0, y: 0, w: 0, h: 0 };
        for (let y0 = 0; y0 < box.h; y0++) for (let x0 = 0; x0 < box.w; x0++) {
            let width = Infinity;
            for (let y1 = y0; y1 < box.h && left[y1 * box.w + x0]; y1++) {
                let run = 0;
                while (x0 + run < box.w && left[y1 * box.w + x0 + run]) run++;
                width = Math.min(width, run);
                if (width * (y1 - y0 + 1) > best.w * best.h) best = { x: x0, y: y0, w: width, h: y1 - y0 + 1 };
            }
        }
        for (let y = best.y; y < best.y + best.h; y++) left.fill(0, y * box.w + best.x, y * box.w + best.x + best.w);
        parts.push({ x: box.x + best.x, y: box.y + best.y, w: best.w, h: best.h });
    }
    return parts;
}

const union = (a: Rect, b: Rect): Rect => {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/**
 * Applies shape moves to a layout's rooms, in place: each proposal hands a block two to four tiles each way from a
 * corner of one room's run along a neighbour to that neighbour. A room left with more than one rectangle gets `parts`.
 */
export function reshape(layout: Layout, rng: Rng): void {
    const { width: W, depth: D, pieces } = layout, n = pieces.length;
    const grid = ownerGrid(layout);
    const movable = pieces.map(p => !FIXED.includes(p.type) && !p.stairs);
    const corridor = pieces.map(p => p.type === 'staffCorridor');
    const secure = pieces.map(p => ROOM_RULES[p.type].zone === 'secure');
    // The street row, and the lobby's row along the counter, where the counter stands.
    const frozen = new Uint8Array(W * D).fill(1, (D - 1) * W);
    const typeAt = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < D ? pieces[grid[y * W + x]!]!.type : undefined);
    for (let y = 0; y < D; y++) for (let x = 0; x < W; x++) {
        if (typeAt(x, y) === 'lobby' && STEPS.some(([dx, dy]) => typeAt(x + dx, y + dy) === 'tellerLine')) frozen[y * W + x] = 1;
    }
    const boxes: Rect[] = pieces.map(p => ({ x: p.x, y: p.y, w: p.w, h: p.h }));
    const shapes = pieces.map((_, i) => shapeOf(grid, W, i, boxes[i]!, corridor[i]!));
    let meets = adjacency(grid, W, D, n);
    // Each move starts from a room (not a corridor or the lobby, which only trade with rooms) and a wall it shares
    // with a neighbour it may trade with: rooms that meet without a wall (two corridors) would change nothing.
    const rooms = pieces.map((_, i) => i).filter(i => movable[i] && !corridor[i] && pieces[i]!.type !== 'lobby');
    const budget = Math.round(MOVES_PER_ROOM * rooms.length);
    const changed = new Set<number>();
    for (let tries = 0, moves = 0; tries < PROPOSALS && moves < budget && rooms.length; tries++) {
        const r = rng.pick(rooms);
        const contacts: { x: number; y: number; dx: number; dy: number; b: number }[] = [];
        const br = boxes[r]!;
        for (let y = br.y; y < br.y + br.h; y++) for (let x = br.x; x < br.x + br.w; x++) {
            if (grid[y * W + x] !== r) continue;
            for (const [dx, dy] of STEPS) {
                const nx = x + dx, ny = y + dy, b = nx >= 0 && ny >= 0 && nx < W && ny < D ? grid[ny * W + nx]! : -1;
                if (b >= 0 && b !== r && movable[b] && !!pieces[r]!.raised === !!pieces[b]!.raised && !isOpenPair(pieces[r]!.type, pieces[b]!.type)) contacts.push({ x, y, dx, dy, b });
            }
        }
        if (!contacts.length) continue;
        // The room gives the block, or takes it from the other side.
        const picked = rng.pick(contacts), gives = rng.chance(0.5);
        const c = gives ? picked : { x: picked.x + picked.dx, y: picked.y + picked.dy, dx: -picked.dx, dy: -picked.dy, b: r };
        const a = gives ? r : picked.b, b = c.b, ba = boxes[a]!, ex = c.dy ? 1 : 0, ey = c.dx ? 1 : 0;
        // The run of room `a` along room `b` through the contact; the block starts at one of its ends, a corner.
        const onRun = (k: number) => {
            const x = c.x + ex * k, y = c.y + ey * k, nx = x + c.dx, ny = y + c.dy;
            return x >= 0 && y >= 0 && x < W && y < D && nx >= 0 && ny >= 0 && nx < W && ny < D && grid[y * W + x] === a && grid[ny * W + nx] === b;
        };
        let lo = 0, hi = 0;
        while (onRun(lo - 1)) lo--;
        while (onRun(hi + 1)) hi++;
        if (hi - lo + 1 < 2) continue;
        const span = rng.int(2, Math.min(4, hi - lo + 1)), deep = rng.int(2, 4), start = rng.chance(0.5) ? lo : hi - span + 1;
        const block: number[] = [];
        for (let k = start; k < start + span; k++) for (let d = 0; d < deep; d++) {
            const x = c.x + ex * k - c.dx * d, y = c.y + ey * k - c.dy * d;
            if (x < 0 || y < 0 || x >= W || y >= D || grid[y * W + x] !== a || frozen[y * W + x]) { block.length = 0; break; }
            block.push(y * W + x);
        }
        if (block.length !== span * deep) continue;
        for (const k of block) grid[k] = b;
        const bx = Math.min(...block.map(k => k % W)), by = Math.min(...block.map(k => Math.floor(k / W)));
        const grown = union(boxes[b]!, { x: bx, y: by, w: Math.max(...block.map(k => k % W)) - bx + 1, h: Math.max(...block.map(k => Math.floor(k / W))) - by + 1 });
        const sa = shapeOf(grid, W, a, ba, corridor[a]!), sb = shapeOf(grid, W, b, grown, corridor[b]!);
        const ra = ROOM_RULES[pieces[a]!.type].area, rb = ROOM_RULES[pieces[b]!.type].area;
        let ok = sa.ok && sb.ok && sa.area >= Math.max(9, Math.round((ra?.target ?? 0) * 0.6)) && sb.area <= (rb?.max ?? Infinity);
        const after = ok ? adjacency(grid, W, D, n) : meets;
        // Rooms that met still meet (two edges, or as many as they had), and secure rooms meet nobody new.
        for (let k = 0; ok && k < n * n; k++) {
            const before = meets[k]!, now = after[k]!;
            if (before && now < Math.min(before, 2)) ok = false;
            if (!before && now && (secure[Math.floor(k / n)] || secure[k % n])) ok = false;
        }
        const delta = ok ? cost(pieces[a]!.type, sa) + cost(pieces[b]!.type, sb) - cost(pieces[a]!.type, shapes[a]!) - cost(pieces[b]!.type, shapes[b]!) : 0;
        if (!ok || (delta >= 0 && rng.next() >= Math.exp(-delta / TEMPERATURE))) {
            for (const k of block) grid[k] = a;
            continue;
        }
        shapes[a] = sa;
        shapes[b] = sb;
        boxes[a] = sa.box;
        boxes[b] = sb.box;
        meets = after;
        moves++;
        changed.add(a).add(b);
    }
    const before = pieces.map(p => ({ x: p.x, y: p.y, w: p.w, h: p.h, parts: p.parts }));
    for (const i of changed) {
        const parts = decompose(grid, W, i, boxes[i]!);
        Object.assign(pieces[i]!, boxes[i]!, { parts: parts.length > 1 ? parts : undefined });
    }
    // The moves keep every meeting, so the doors stay possible; should one not, the rectangles stand.
    if (doorless(layout)) pieces.forEach((p, i) => Object.assign(p, before[i]!));
}
