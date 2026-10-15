import Phaser from 'phaser';
import { drawNumber, drawRows, GLYPHS, glyphSize, numberWidth, type GlyphName } from '../../art/ui/glyphs';
import type { BadgeVM, CameraVM, ConeVM, HearerVM, PlateVM, Signal } from '../../game/worldUi';
import { TILE } from '../../level/level';
import type { Pos } from '../../sim';

/**
 * The world UI layer (UI.md "Two layers", "Visual language", M1-14): a canvas over the game's at twice the art's
 * resolution (one UI pixel is half an art pixel), redrawn after each frame from where the camera looked. Hairlines with
 * a 1px ink drop shadow, muted signal colours, faint scanline fills, dark plates with a thin border in the signal
 * colour; every state also has a shape or a pattern, and the colour-blind preset swaps the palette (UI.md "Signal
 * palette"). It takes no input: taps go through to the map. Drawn, bottom to top:
 *
 * - **Floor:** unscouted tiles grey; the safe-floor tints (`safeFloor`, the hook M1-09 fills); sound pings; the
 *   selected crew member's movement range, XCOM style (Move's tiles steel blue with a solid edge, those only a Dash
 *   reaches hatched gold with a dashed edge); an NPC's cones on long-press (scanlines and a solid edge for the core, a
 *   dotted edge for the peripheral band, red when Alerted); the known cameras' cones (vertical scanlines and a dashed
 *   edge: red on the operator's monitors, amber when live or unknown, grey and faint while looped; a panning camera's
 *   next facing dotted); a previewed noise's ring (dotted, faint fill); a moment's flashes (a guard's shout ring, the
 *   Alarm's rings).
 * - **Paths:** NPC intents (a dotted hairline, an open chevron and a pin where the walk ends; fainter when predicted);
 *   predicted markers (a dashed footprint); the previewed or dragged path, ending on a tile outline in the crew colour
 *   (doubled for a dash; steps past the first bad one red).
 * - **Over heads:** state plates and carrier countdowns, a downed guard's radio, suspicion pips in each crew member's
 *   colour, the ear badges of a noise's hearers naming what they'll do, the witnesses of a preview, ghosts' "seen N
 *   turns ago", each known camera's plate (`?` unknown feed, `!` on the monitors, a looped feed's phases left).
 */

/** A known camera's plate: `?` while its feed status is unknown, `!` on the monitors, a looped feed's phases left. */
function cameraPlate(cam: CameraVM): PlateVM {
    if (cam.dead) return { glyph: 'camera', signal: 'cream', then: 'cross' };
    if (cam.loopLeft !== undefined) return { glyph: 'camera', signal: 'cream', count: cam.loopLeft };
    if (cam.status === 'unknown') return { glyph: 'camera', signal: 'amber', sym: '?' };
    return cam.monitored ? { glyph: 'camera', signal: 'red', sym: '!' } : { glyph: 'camera', signal: 'amber' };
}

/** UI pixels per art pixel. */
const UI_SCALE = 2;

export interface OverlayContent {
    /** The crew colour (CSS). */
    colour: string;
    /** The tiles a Move can end on, and those only a Dash reaches. */
    reach?: { move: Pos[]; dash: Pos[]; at?: Pos; unfilled?: Pos[] };
    /** Where the path starts (the crew member's tile) and its steps. */
    from?: Pos;
    path?: Pos[];
    /** A dash: the end is marked twice. */
    dash?: boolean;
    /** The tiles the previewed command's noise reaches (a dash's or a knockout's quiet noise, §6.3). */
    noise?: Pos[];
    /** Where those who would see the previewed command stand (§8.4): a `!` plate over each. */
    witnesses?: Pos[];
    /** The target of the grid's actions: a door (the middle of its edge, in tiles) or a person or object's tile. */
    targetDoor?: Pos;
    targetTile?: Pos;
    /** The index of the first step that can't be taken; it and those after it are drawn red. */
    badFrom?: number;
    /**
     * Multi-turn routes (§6.5): each crew member's, from where they stand, in the Moves each turn walks it in; a dashed
     * line in the crew colour with the turn number where each turn's walk ends. `rest` is what can't be planned now.
     */
    routes?: { crew: string; colour: string; from: Pos; legs: { turn: number; path: Pos[] }[]; rest: Pos[] }[];
    /** The dragged path is a route being drawn: only steps past `badFrom` are red, not those past this turn's reach. */
    routeDrag?: boolean;
    /** The NPCs' committed walks for the next world phase: a dotted line and a pin where each ends. */
    intents?: { from: Pos; path: Pos[]; predicted?: boolean }[];
    /** Which tiles the crew has seen (row-major, 1 = seen); the rest are unscouted, drawn grey (§8.15). */
    seen?: { width: number; bits: Uint8Array };
    /** Ghosts: where an NPC was last seen, and how long ago. */
    ghosts?: { pos: Pos; seenAgo: number }[];
    /** Loud noises the crew heard (§8.15). */
    pings?: { at: Pos }[];
    /** The plates and pips over the NPCs and carriers the crew knows of (src/game/worldUi.ts). */
    badges?: BadgeVM[];
    /** The crew's colours by id, for the pips. */
    crewColours?: Record<string, string>;
    /** Who hears a previewed noise and what they'll do (an ear badge each). */
    hearers?: HearerVM[];
    /** NPC cones to show (one on long-press, or all from the overlay drawer). */
    cones?: ConeVM[];
    /** The cameras the crew knows of: a plate each, and their cones when the drawer's Cameras overlay is on. */
    cameras?: CameraVM[];
    /** A moment on the map, drawn for a second or two: a guard's "Hands up!" ring (its tiles), the Alarm's rings. */
    flashes?: { at: Pos; kind: 'shout' | 'alarm'; tiles?: Pos[] }[];
    /** Predicted NPC markers (§8.15): a dashed footprint where the routine puts them. */
    predicted?: Pos[];
    /**
     * The safe-floor overlay (§8.8, UI.md "Safe floor"): one entry per tile with its state. M1-09 provides the data; until
     * then nothing passes it.
     */
    safeFloor?: { pos: Pos; state: 'safe' | 'pip1' | 'pip2' | 'challenge' | 'exposed' | 'unscouted' | 'unknown'; next?: boolean }[];
    /** The colour-blind preset (UI.md "Signal palette"). */
    colourBlind?: boolean;
}

/** The signal palette, and its colour-blind preset (UI.md). */
const PALETTES: Record<'default' | 'colourBlind', Record<Signal, string>> = {
    default: { safe: '#80be8a', amber: '#e2a240', red: '#d44638', command: '#8ab6d6', cream: '#f2e6c8' },
    colourBlind: { safe: '#6a9fd0', amber: '#d8c060', red: '#c8508a', command: '#b8d8e8', cream: '#f2e6c8' }
};

/** With an alpha: '#rrggbb' → 'rgba(r, g, b, a)'. */
const alpha = (hex: string, a: number): string => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** How far above a tile's top edge the head of someone standing on it reaches, and of someone lying (UI pixels). */
const HEAD = 30, LYING = 10;

/** Move's range: steel blue ("your control"), a flat tint and a solid edge. */
const WALK = 'rgba(138, 182, 214, 0.3)';
const WALK_EDGE = 'rgba(138, 182, 214, 0.9)';
/** Dash's band: gold, hatched, with a dashed edge. */
const RUN = 'rgba(242, 201, 76, 0.1)';
const RUN_HATCH = 'rgba(242, 201, 76, 0.42)';
const RUN_EDGE = 'rgba(242, 201, 76, 0.95)';
const INK = 'rgba(13, 12, 20, 0.85)';
const CREAM = '#f2e6c8';
const INTENT = 'rgba(242, 230, 200, 0.7)';
const INTENT_PREDICTED = 'rgba(242, 230, 200, 0.4)';
const UNSCOUTED = 'rgba(96, 98, 110, 0.45)';
const PING = 'rgba(226, 162, 64, 0.8)';

export class WorldOverlay {
    readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private content: OverlayContent | null = null;
    /** What the last drawing was made from: redraw only when the view or the content changes. */
    private drawn = '';
    private readonly onRender = () => this.draw();

    /** `lift` says how many art pixels up the screen tile (tx, ty) is drawn now (a raised floor; 0 on the ground). */
    constructor(private readonly scene: Phaser.Scene, private readonly lift: (tx: number, ty: number) => number = () => 0) {
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'world-overlay';
        Object.assign(this.canvas.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2', imageRendering: 'pixelated' });
        this.ctx = this.canvas.getContext('2d')!;
        document.body.append(this.canvas);
        scene.game.events.on(Phaser.Core.Events.POST_RENDER, this.onRender);
        scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    }

    set(content: OverlayContent | null): void {
        this.content = content;
        this.drawn = '';
    }

    /** The path shown, for tests. */
    get state(): { badges: number; hearers: number; cones: number; cameras: number; cameraCones: number; flashes: number; colourBlind: boolean; path: Pos[]; reach: number; dashReach: number; range: { walk: Pos[]; run: Pos[] }; dash: boolean; noise: number; witnesses: number; intents: number } {
        const c = this.content;
        return {
            badges: c?.badges?.length ?? 0, hearers: c?.hearers?.length ?? 0, cones: c?.cones?.length ?? 0, colourBlind: !!c?.colourBlind,
            cameras: c?.cameras?.length ?? 0, cameraCones: c?.cameras?.filter(v => v.core.length + v.peripheral.length > 0).length ?? 0, flashes: c?.flashes?.length ?? 0,
            path: c?.path ?? [], reach: c?.reach?.move.length ?? 0, dashReach: c?.reach?.dash.length ?? 0,
            range: { walk: c?.reach?.move ?? [], run: c?.reach?.dash ?? [] }, dash: !!c?.dash, noise: c?.noise?.length ?? 0, witnesses: c?.witnesses?.length ?? 0,
            intents: c?.intents?.length ?? 0
        };
    }

    destroy(): void {
        this.scene.game.events.off(Phaser.Core.Events.POST_RENDER, this.onRender);
        this.canvas.remove();
    }

    /** Draws over the frame just rendered: sized and placed over the game's canvas, shifted by the camera's view. */
    private draw(): void {
        const game = this.scene.game, cam = this.scene.cameras.main, box = game.canvas.getBoundingClientRect();
        const w = Math.round(this.scene.scale.width * UI_SCALE), h = Math.round(this.scene.scale.height * UI_SCALE);
        const vx = Math.round(cam.worldView.x), vy = Math.round(cam.worldView.y);
        // A raised floor rises and drops as it is cut: what is drawn on it follows (the lifts are part of the key).
        const c0 = this.content;
        let lifts = 0;
        for (const p of [...(c0?.reach?.move ?? []), ...(c0?.reach?.dash ?? []), ...(c0?.path ?? [])]) lifts += this.lift(p.x, p.y);
        const key = `${w}x${h}@${vx},${vy}:${box.left},${box.top},${box.width},${box.height}:${lifts}`;
        if (key === this.drawn) return;
        this.drawn = key;
        const { canvas, ctx } = this;
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        Object.assign(canvas.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
        ctx.clearRect(0, 0, w, h);
        const c = this.content;
        if (!c) return;
        const S = TILE * UI_SCALE;
        const left = (p: Pos) => (p.x * TILE - vx) * UI_SCALE, top = (p: Pos) => (p.y * TILE - this.lift(p.x, p.y) - vy) * UI_SCALE;
        const mid = (p: Pos): [number, number] => [left(p) + S / 2, top(p) + S / 2];
        const pal = PALETTES[c.colourBlind ? 'colourBlind' : 'default'];

        if (c.seen) {
            // Unscouted: a grey veil over every tile in view the crew hasn't seen.
            const { width, bits } = c.seen, height = bits.length / width;
            ctx.fillStyle = UNSCOUTED;
            const x0 = Math.max(0, Math.floor(vx / TILE)), y0 = Math.max(0, Math.floor(vy / TILE));
            const x1 = Math.min(width - 1, Math.floor((vx + w / UI_SCALE) / TILE)), y1 = Math.min(height - 1, Math.floor((vy + h / UI_SCALE) / TILE));
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!bits[y * width + x]) ctx.fillRect(left({ x, y }), top({ x, y }), S, S);
        }

        if (c.safeFloor?.length) this.drawSafeFloor(c.safeFloor, pal, left, top, S);

        for (const p of c.pings ?? []) {
            const [x, y] = mid(p.at);
            ctx.lineWidth = 2;
            for (const r of [10, 20]) {
                ctx.strokeStyle = INK;
                ctx.beginPath();
                ctx.arc(x, y + 2, r, 0, Math.PI * 2);
                ctx.stroke();
                ctx.strokeStyle = PING;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        /** Each side of a tile in `tiles` that `inside` doesn't continue past: the set's outline, a side at a time. */
        const outline = (tiles: Pos[], inside: (x: number, y: number) => boolean, draw: (x0: number, y0: number, x1: number, y1: number) => void) => {
            for (const p of tiles) {
                const x = left(p), y = top(p);
                if (!inside(p.x, p.y - 1)) draw(x, y, x + S, y);
                if (!inside(p.x, p.y + 1)) draw(x, y + S, x + S, y + S);
                if (!inside(p.x - 1, p.y)) draw(x, y, x, y + S);
                if (!inside(p.x + 1, p.y)) draw(x + S, y, x + S, y + S);
            }
        };
        const has = (tiles: Pos[]) => {
            const set = new Set(tiles.map(p => `${p.x},${p.y}`));
            return (x: number, y: number) => set.has(`${x},${y}`);
        };
        /** Strokes an outline in `colour` over a 1px ink drop shadow (UI.md "Visual language"). */
        const stroke = (tiles: Pos[], inside: (x: number, y: number) => boolean, colour: string, width: number, dash: number[]) => {
            ctx.lineWidth = width;
            ctx.setLineDash(dash);
            for (const [style, dy] of [[INK, 2], [colour, 0]] as const) {
                ctx.strokeStyle = style;
                ctx.beginPath();
                outline(tiles, inside, (x0, y0, x1, y1) => {
                    ctx.moveTo(x0, y0 + dy);
                    ctx.lineTo(x1, y1 + dy);
                });
                ctx.stroke();
            }
            ctx.setLineDash([]);
        };

        if (c.reach) {
            // The mover's own tile counts as inside, so the edge doesn't box them in.
            // Tiles with someone lying on them (a dragged body) keep their edge but no tint, so the body shows.
            const bare = has(c.reach.unfilled ?? []), filled = (tiles: Pos[]) => tiles.filter(p => !bare(p.x, p.y));
            const { at } = c.reach, move = c.reach.move, dash = c.reach.dash, inMove = has([...move, ...(at ? [at] : [])]), inAll = has([...move, ...dash, ...(at ? [at] : [])]);
            // Dash's band: a faint tint and a diagonal hatch, so it reads apart from Move's without its colour.
            ctx.fillStyle = RUN;
            for (const p of filled(dash)) ctx.fillRect(left(p), top(p), S, S);
            ctx.fillStyle = RUN_HATCH;
            for (const p of filled(dash)) {
                const x = left(p), y = top(p);
                // Lines at 45°, every 8 UI pixels, continuing across neighbouring tiles.
                for (let k = 0; k < S; k++) {
                    const off = (((x + y + S - 1 - k) % 8) + 8) % 8;
                    for (let t = (8 - off) % 8; t < S; t += 8) ctx.fillRect(x + t, y + S - 1 - k, 1, 1);
                }
            }
            ctx.fillStyle = WALK;
            for (const p of filled(move)) ctx.fillRect(left(p), top(p), S, S);
            // The range's outer edge, dashed gold; then Move's edge, solid steel blue: where a step costs a second action.
            stroke(dash, inAll, RUN_EDGE, 2, [6, 4]);
            stroke(move, inMove, WALK_EDGE, 2, []);
        }

        // Cones: the core in scanlines with a solid edge, the peripheral band fainter with a dotted edge; red when Alerted.
        for (const cone of c.cones ?? []) {
            const colour = cone.alerted ? pal.red : pal.amber, all = [...cone.core, ...cone.peripheral];
            ctx.fillStyle = alpha(colour, 0.22);
            for (const p of cone.core) for (let k = 0; k < S; k += 2) ctx.fillRect(left(p), top(p) + k, S, 1);
            ctx.fillStyle = alpha(colour, 0.1);
            for (const p of cone.peripheral) for (let k = 0; k < S; k += 4) ctx.fillRect(left(p), top(p) + k, S, 1);
            const from = [cone.from];
            stroke(all, has([...all, ...from]), alpha(colour, 0.9), 1, [2, 2]);
            stroke(cone.core, has([...cone.core, ...from]), colour, 2, []);
        }

        // Cameras: vertical scanlines (NPC cones run across), a dashed edge; red when the operator watches its feed now,
        // amber when live or its feed status is unknown (it counts as live, §8.8), grey while looped.
        for (const cam of c.cameras ?? []) {
            const all = [...cam.core, ...cam.peripheral];
            if (!all.length) continue;
            const looped = cam.loopLeft !== undefined, colour = looped ? '#807e88' : cam.monitored ? pal.red : pal.amber, from = [cam.pos];
            ctx.fillStyle = alpha(colour, looped ? 0.1 : 0.2);
            for (const p of cam.core) for (let k = 0; k < S; k += 3) ctx.fillRect(left(p) + k, top(p), 1, S);
            ctx.fillStyle = alpha(colour, looped ? 0.06 : 0.1);
            for (const p of cam.peripheral) for (let k = 0; k < S; k += 6) ctx.fillRect(left(p) + k, top(p), 1, S);
            stroke(all, has([...all, ...from]), alpha(colour, looped ? 0.45 : 0.9), looped ? 1 : 2, [5, 3]);
            if (cam.next?.length) stroke(cam.next, has([...cam.next, ...from]), alpha(colour, 0.55), 1, [1, 3]);
        }

        for (const f of c.flashes ?? []) {
            if (f.tiles?.length) {
                ctx.fillStyle = alpha(pal.red, 0.16);
                for (const p of f.tiles) ctx.fillRect(left(p), top(p), S, S);
                stroke(f.tiles, has(f.tiles), pal.red, 3, [2, 2]);
            }
            if (f.kind === 'alarm') {
                const [x, y] = mid(f.at);
                ctx.lineWidth = 3;
                for (const r of [16, 34, 56]) {
                    for (const [style, dy] of [[INK, 2], [pal.red, 0]] as const) {
                        ctx.strokeStyle = style;
                        ctx.beginPath();
                        ctx.arc(x, y + dy, r, 0, Math.PI * 2);
                        ctx.stroke();
                    }
                }
            }
        }

        if (c.noise?.length) {
            ctx.fillStyle = alpha(pal.amber, 0.2);
            for (const p of c.noise) ctx.fillRect(left(p), top(p), S, S);
            stroke(c.noise, has(c.noise), pal.amber, 3, [2, 2]);
        }

        // The target: a bracket in the crew colour round the tile, or across the door's edge.
        if (c.targetTile) {
            const x = left(c.targetTile), y = top(c.targetTile);
            for (const [style, dy] of [[INK, 2], [c.colour, 0]] as const) {
                ctx.fillStyle = style;
                for (const [bx, by] of [[0, 0], [S - 6, 0], [0, S - 2], [S - 6, S - 2]]) ctx.fillRect(x + bx!, y + by! + dy, 6, 2);
                for (const [bx, by] of [[0, 0], [S - 2, 0], [0, S - 6], [S - 2, S - 6]]) ctx.fillRect(x + bx!, y + by! + dy, 2, 6);
            }
        }
        if (c.targetDoor) {
            const x = (c.targetDoor.x * TILE - vx) * UI_SCALE, y = (c.targetDoor.y * TILE - this.lift(Math.floor(c.targetDoor.x), Math.floor(c.targetDoor.y)) - vy) * UI_SCALE;
            const across = Number.isInteger(c.targetDoor.x);
            const w = across ? 6 : S - 4, h = across ? S - 4 : 6;
            ctx.lineWidth = 2;
            ctx.strokeStyle = INK;
            ctx.strokeRect(x - w / 2, y - h / 2 + 2, w, h);
            ctx.strokeStyle = c.colour;
            ctx.strokeRect(x - w / 2, y - h / 2, w, h);
        }

        // Intents (§4, §6.2): a dotted hairline along the walk, an open chevron on its last step and a pin where it ends.
        for (const intent of c.intents ?? []) {
            const points = [intent.from, ...intent.path].map(mid), colour = intent.predicted ? INTENT_PREDICTED : INTENT;
            ctx.lineWidth = 2;
            ctx.setLineDash([3, 3]);
            for (const [style, dy] of [[INK, 2], [colour, 0]] as const) {
                ctx.strokeStyle = style;
                ctx.beginPath();
                points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y + dy) : ctx.moveTo(x, y + dy)));
                ctx.stroke();
            }
            ctx.setLineDash([]);
            const [bx, by] = points.at(-1)!, [ax, ay] = points.at(-2) ?? [bx, by - 1], angle = Math.atan2(by - ay, bx - ax);
            for (const [style, dy] of [[INK, 2], [colour, 0]] as const) {
                ctx.strokeStyle = style;
                ctx.beginPath();
                for (const side of [-1, 1]) {
                    ctx.moveTo(bx, by + dy);
                    ctx.lineTo(bx - 10 * Math.cos(angle + side * 0.55), by + dy - 10 * Math.sin(angle + side * 0.55));
                }
                ctx.stroke();
            }
            drawRows(ctx, GLYPHS.pin, Math.round(bx) - 2, Math.round(by) + 6, colour);
        }

        // Predicted markers: a dashed footprint where the routine puts them (the person is drawn translucent).
        for (const p of c.predicted ?? []) {
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = INTENT_PREDICTED;
            ctx.strokeRect(left(p) + 3.5, top(p) + 3.5, S - 7, S - 7);
            ctx.setLineDash([]);
        }

        ctx.font = '600 10px ui-monospace, Menlo, Consolas, monospace';
        ctx.textAlign = 'center';
        for (const g of c.ghosts ?? []) {
            const [x] = mid(g.pos), y = top(g.pos) - 30, text = `seen ${g.seenAgo} turn${g.seenAgo === 1 ? '' : 's'} ago`;
            ctx.fillStyle = INK;
            ctx.fillText(text, x, y + 2);
            ctx.fillStyle = INTENT;
            ctx.fillText(text, x, y);
        }

        // Over heads, one row per person: their state plates, then the ear badge of a noise they'd hear (naming what
        // they'll do), then the eye of a preview they'd witness; their pips above.
        const rows = new Map<string, { pos: Pos; lying: boolean; faded: boolean; plates: PlateVM[]; pips: BadgeVM['pips'] }>();
        const row = (pos: Pos, lying: boolean) => {
            const key = `${pos.x},${pos.y}`;
            let r = rows.get(key);
            if (!r) rows.set(key, r = { pos, lying, faded: false, plates: [], pips: [] });
            return r;
        };
        for (const b of c.badges ?? []) Object.assign(row(b.pos, b.lying), { faded: b.faded, pips: b.pips }).plates.push(...b.plates);
        // The one sent to look also wears the pin (Investigating).
        for (const e of c.hearers ?? []) row(e.pos, e.lying).plates.push({ glyph: 'speaker', signal: e.signal, ...(e.sym ? { sym: e.sym } : {}), ...(e.sent ? { then: 'pin' as const } : {}) });
        for (const w of c.witnesses ?? []) row(w, false).plates.push({ glyph: 'eye', signal: 'red', sym: '!' });
        for (const cam of c.cameras ?? []) row(cam.pos, true).plates.push(cameraPlate(cam));
        for (const r of rows.values()) {
            const x = Math.round(mid(r.pos)[0]), y = Math.round(top(r.pos)) - (r.lying ? LYING : HEAD);
            ctx.globalAlpha = r.faded ? 0.55 : 1;
            const h = this.drawPlates(r.plates, x, y, pal);
            this.drawPips(r.pips, x, y - h - (h ? 2 : 0), c.crewColours ?? {});
            ctx.globalAlpha = 1;
        }

        for (const r of c.routes ?? []) this.drawRoute(r, mid, pal);

        if (c.from && c.path?.length && !(c.routeDrag && c.badFrom === undefined)) {
            const points = [c.from, ...c.path].map(mid), bad = c.badFrom ?? Infinity;
            const segment = (i: number, colour: string, dy: number) => {
                ctx.strokeStyle = colour;
                ctx.beginPath();
                ctx.moveTo(points[i]![0], points[i]![1] + dy);
                ctx.lineTo(points[i + 1]![0], points[i + 1]![1] + dy);
                ctx.stroke();
            };
            ctx.lineWidth = 2;
            ctx.lineCap = 'square';
            // A hairline with a 1px ink drop shadow (UI.md "Visual language").
            for (let i = 0; i < points.length - 1; i++) segment(i, INK, 2);
            for (let i = 0; i < points.length - 1; i++) segment(i, i >= bad ? pal.red : CREAM, 0);
            for (let i = 1; i < points.length - 1; i++) {
                const [x, y] = points[i]!;
                ctx.fillStyle = INK;
                ctx.fillRect(x - 2, y, 4, 4);
                ctx.fillStyle = i - 1 >= bad ? pal.red : CREAM;
                ctx.fillRect(x - 2, y - 2, 4, 4);
            }
            const end = c.path.at(-1)!, x = left(end), y = top(end), endColour = c.path.length - 1 >= bad ? pal.red : c.colour;
            ctx.strokeStyle = INK;
            ctx.strokeRect(x + 3, y + 4, S - 6, S - 6);
            ctx.strokeStyle = endColour;
            ctx.strokeRect(x + 3, y + 3, S - 6, S - 6);
            if (c.dash) ctx.strokeRect(x + 7, y + 7, S - 14, S - 14);
        }
    }

    /**
     * A multi-turn route (§6.5): a dashed line in the crew colour over an ink shadow, a dot where each Move ends, and a
     * plate with the turn number where each turn's walk ends; what can't be planned now is a faint dotted tail.
     */
    private drawRoute(r: NonNullable<OverlayContent['routes']>[number], mid: (p: Pos) => [number, number], pal: Record<Signal, string>): void {
        const { ctx } = this;
        const walked = r.legs.flatMap(l => l.path), points = [r.from, ...walked].map(mid);
        const line = (pts: [number, number][], colour: string, dash: number[]) => {
            if (pts.length < 2) return;
            ctx.lineWidth = 2;
            ctx.setLineDash(dash);
            for (const [style, dy] of [[INK, 2], [colour, 0]] as const) {
                ctx.strokeStyle = style;
                ctx.beginPath();
                pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y + dy) : ctx.moveTo(x, y + dy)));
                ctx.stroke();
            }
            ctx.setLineDash([]);
        };
        line(points, r.colour, [6, 4]);
        if (r.rest.length) line([points.at(-1)!, ...r.rest.map(mid)], alpha(pal.red, 0.7), [2, 4]);
        for (const leg of r.legs) {
            const [x, y] = mid(leg.path.at(-1)!);
            ctx.fillStyle = INK;
            ctx.fillRect(x - 3, y - 1, 6, 6);
            ctx.fillStyle = r.colour;
            ctx.fillRect(x - 3, y - 3, 6, 6);
        }
        ctx.font = '700 11px ui-monospace, Menlo, Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        r.legs.forEach((leg, i) => {
            if (r.legs[i + 1]?.turn === leg.turn) return;
            const [x, y] = mid(leg.path.at(-1)!), text = String(leg.turn), w = Math.max(16, ctx.measureText(text).width + 8), py = y - 16;
            ctx.fillStyle = 'rgba(11, 13, 23, 0.9)';
            ctx.fillRect(Math.round(x - w / 2), py - 7, w, 14);
            ctx.strokeStyle = r.colour;
            ctx.lineWidth = 1;
            ctx.strokeRect(Math.round(x - w / 2) + 0.5, py - 6.5, w - 1, 13);
            ctx.fillStyle = CREAM;
            ctx.fillText(text, x, py + 1);
        });
        ctx.textBaseline = 'alphabetic';
    }

    /**
     * A row of plates centred on x with their bottom at y (UI.md "Over heads"): near-black, a thin border in the signal
     * colour, the glyph in that colour, then a countdown in cream after a divider, or a symbol. Returns their height.
     */
    private drawPlates(plates: readonly PlateVM[], x: number, y: number, pal: Record<Signal, string>): number {
        if (!plates.length) return 0;
        const ctx = this.ctx;
        const widthOf = (p: PlateVM) => {
            const g = glyphSize(GLYPHS[p.glyph]);
            return 4 + g.w + (p.count !== undefined ? 4 + numberWidth(String(p.count)) : 0) + (p.sym ? 3 + numberWidth(p.sym) : 0)
                + (p.then ? 3 + glyphSize(GLYPHS[p.then]).w : 0) + 4;
        };
        const H = 16, gap = 2, total = plates.reduce((w, p) => w + widthOf(p), 0) + gap * (plates.length - 1);
        let at = Math.round(x - total / 2);
        for (const p of plates) {
            const w = widthOf(p), colour = pal[p.signal], top = y - H;
            ctx.fillStyle = 'rgba(12, 11, 15, 0.86)';
            ctx.fillRect(at, top, w, H);
            ctx.strokeStyle = alpha(colour, 0.92);
            ctx.lineWidth = 1;
            ctx.strokeRect(at + 0.5, top + 0.5, w - 1, H - 1);
            const rows = GLYPHS[p.glyph], g = glyphSize(rows);
            let cx = at + 4;
            drawRows(ctx, rows, cx, top + Math.floor((H - g.h) / 2), colour, false);
            cx += g.w;
            if (p.count !== undefined) {
                ctx.fillStyle = alpha(colour, 0.45);
                ctx.fillRect(cx + 1, top + 3, 1, H - 6);
                drawNumber(ctx, String(p.count), cx + 4, top + 4, '#f2e6c8');
                cx += 4 + numberWidth(String(p.count));
            }
            if (p.sym) {
                drawNumber(ctx, p.sym, cx + 3, top + 4, colour);
                cx += 3 + numberWidth(p.sym);
            }
            if (p.then) {
                const t = GLYPHS[p.then];
                drawRows(ctx, t, cx + 3, top + Math.floor((H - glyphSize(t).h) / 2), colour, false);
            }
            at += w + gap;
        }
        return H;
    }

    /** Suspicion pips (§8.5): a row of three 4px squares per crew member, filled in their colour, bottom at y. */
    private drawPips(pips: BadgeVM['pips'], x: number, y: number, colours: Record<string, string>): void {
        const ctx = this.ctx;
        pips.forEach((row, r) => {
            const top = y - 5 - r * 7, x0 = Math.round(x - (3 * 7 - 3) / 2), colour = colours[row.crew] ?? '#f2e6c8';
            for (let i = 0; i < 3; i++) {
                const px = x0 + i * 7;
                if (i < row.n) {
                    ctx.fillStyle = 'rgba(8, 7, 10, 0.75)';
                    ctx.fillRect(px + 1, top + 1, 4, 4);
                    ctx.fillStyle = colour;
                    ctx.fillRect(px, top, 4, 4);
                } else {
                    ctx.strokeStyle = 'rgba(110, 106, 118, 0.9)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(px + 0.5, top + 0.5, 3, 3);
                }
            }
        });
    }

    /**
     * The safe-floor tints (§8.8, UI.md "Safe floor"): sage for safe, amber with its pips, a hand or an eye, red for
     * exposed, grey for unscouted or unknown (`?`); the next phase's states hatched. Faint scanlines, the edge where
     * the outcome changes carrying the meaning.
     */
    private drawSafeFloor(tiles: NonNullable<OverlayContent['safeFloor']>, pal: Record<Signal, string>, left: (p: Pos) => number, top: (p: Pos) => number, S: number): void {
        const ctx = this.ctx;
        const signal = (state: string): Signal => (state === 'safe' ? 'safe' : state === 'exposed' ? 'red' : state === 'unscouted' || state === 'unknown' ? 'cream' : 'amber');
        for (const t of tiles) {
            const colour = t.state === 'unscouted' || t.state === 'unknown' ? '#807e88' : pal[signal(t.state)], x = left(t.pos), y = top(t.pos);
            ctx.fillStyle = alpha(colour, t.state === 'safe' ? 0.3 : 0.42);
            if (t.next) for (let k = 0; k < S; k++) for (let i = (6 - (k % 6)) % 6; i < S; i += 6) ctx.fillRect(x + i, y + k, 1, 1);
            else for (let k = 0; k < S; k += 2) ctx.fillRect(x, y + k, S, 1);
            const glyph: GlyphName | undefined = t.state === 'challenge' ? 'hand' : t.state === 'exposed' ? 'eye' : t.state === 'unknown' || t.state === 'unscouted' ? 'q' : undefined;
            if (glyph) {
                const g = glyphSize(GLYPHS[glyph]);
                drawRows(ctx, GLYPHS[glyph], x + Math.floor((S - g.w) / 2), y + Math.floor((S - g.h) / 2), colour);
            } else if (t.state === 'pip1' || t.state === 'pip2') {
                const n = t.state === 'pip1' ? 1 : 2, x0 = x + S / 2 - (n * 7 - 3) / 2;
                for (let i = 0; i < n; i++) {
                    ctx.fillStyle = 'rgba(8, 7, 10, 0.75)';
                    ctx.fillRect(x0 + i * 7 + 1, y + 15, 4, 4);
                    ctx.fillStyle = colour;
                    ctx.fillRect(x0 + i * 7, y + 14, 4, 4);
                }
            }
        }
    }
}
