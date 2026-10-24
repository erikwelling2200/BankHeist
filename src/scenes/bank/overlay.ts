import Phaser from 'phaser';
import { drawNumber, drawRows, GLYPHS, glyphSize, numberWidth, type GlyphName } from '../../art/ui/glyphs';
import { witnessPlate, type BadgeVM, type CameraVM, type ConeVM, type ExplainVM, type FloorTileVM, type HearerVM, type PathVM, type PlateVM, type Signal, type WitnessVM } from '../../game/worldUi';
import type { TintKind } from '../../sim';
import { TILE } from '../../level/constants';
import type { Pos } from '../../sim';
import { insetLoops, sideRuns, withoutHoles, type Corner, type Side } from './contours';

/**
 * The world UI layer (UI.md "Two layers", "Visual language", M1-14): a canvas over the game's at twice the art's
 * resolution (one UI pixel is half an art pixel), drawn with a margin round the view and slid along as the view moves,
 * redrawn when what it shows changes or the view nears the drawing's edge (`draw`). Hairlines with
 * a 1px ink drop shadow, muted signal colours, faint scanline fills, dark plates with a thin border in the signal
 * colour; every state also has a shape or a pattern, and the colour-blind preset swaps the palette (UI.md "Signal
 * palette"). It takes no input: taps go through to the map. Drawn, bottom to top:
 *
 * - **Floor:** a grey veil on tiles not seen this turn (hidden ones are the scene's opaque blocks); sound pings; the
 *   selected crew member's movement range, XCOM style, with the
 *   safe floor (§8.8) in it: each tile filled with its tint (scanlines on Move's tiles, a sparser dotted fill on those
 *   only a Dash reaches; hatched when the coming world phase does it) and a glyph for what it warns of (pips, a hand,
 *   an eye, a camera, `?`), and the band edges over them (Move's solid steel blue, Dash's dashed gold), so both read
 *   at once; before the floor arrives a band is filled steel blue or hatched gold; an NPC's cones on long-press and the
 *   known cameras' (`drawViews`: exactly the tiles seen, outlined inset with rounded corners in pale white over ink, a
 *   faint fade; stronger when Alerted or on the operator's monitors, grey while looped, cameras dashed, a panning
 *   camera's next facing dotted), under the band edges; a previewed noise's ring (dotted, faint fill); a moment's flashes (a guard's shout ring, the
 *   Alarm's rings).
 * - **Paths:** NPC intents (a dotted hairline, an open chevron and a pin where the walk ends; fainter when predicted);
 *   predicted markers (a dashed footprint); the previewed or dragged path, each step tinted by its safety (the floor
 *   underneath dimmed), ending on a tile outline in the crew colour (doubled for a dash; steps past the first bad one
 *   red), the eye's plate on its first unsafe step; a long-pressed tile's "who and why" sightlines.
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

/** A view to draw (`drawViews`): who looks from where, the tiles they see, the edge's colour and line, and a fade. */
interface View { from: Pos; tiles: Pos[]; colour: string; line: 'solid' | 'dashed' | 'dotted'; wash: boolean }

/** UI pixels per art pixel. */
const UI_SCALE = 2;

/**
 * The cleaner overlay mockup (`?overlay=v2`, read once at boot), one visual channel per kind of information: tile fill
 * is safety only, the diagonal hatch is "could be worse than shown" only, each reach band is one contour (Move solid,
 * Dash dashed), the noise ring a rounded contour inset in the tiles in its own colour, cones faint outlines shown only
 * where they meet the reach or the path, the glyphs drawn last over the floor, and a hearer's state plate gives way to
 * its ear badge. Temporary: for comparing screenshots.
 */
export const OVERLAY_V2 = typeof location !== 'undefined' && new URLSearchParams(location.search).get('overlay') === 'v2';
/** v2's noise ring: a colour no other layer uses, inset in the tiles so it never sits on a band's edge (UI pixels). */
const NOISE = '#c49cff';
/** The cones' edge: a pale white no other layer uses (the bands are gold and steel blue, the safety tints their own). */
const VIEW = '#eef0f6';
const VIEW_INSET = 5, VIEW_RADIUS = 7;
const NOISE_INSET = 5, NOISE_RADIUS = 7;

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
    /** Those who would notice the previewed command (§8.4): a plate over each saying what they'd make of it. */
    witnesses?: WitnessVM[];
    /** The target of the grid's actions: a door (the middle of its edge, in tiles) or a person or object's tile. */
    targetDoor?: Pos;
    targetTile?: Pos;
    /** The index of the first step that can't be taken; it and those after it are drawn red. */
    badFrom?: number;
    /**
     * Multi-turn routes (§6.5): each crew member's, from where they stand, in the Moves each turn walks it in; a dashed
     * line in the crew colour with the turn number where each turn's walk ends. `rest` is what can't be planned now.
     */
    routes?: { crew: string; colour: string; from: Pos; legs: { turn: number; path: Pos[] }[]; rest: Pos[]; unsafe?: Pos[]; now?: number }[];
    /** The dragged path is a route being drawn: only steps past `badFrom` are red, not those past this turn's reach. */
    routeDrag?: boolean;
    /** The NPCs' committed walks for the next world phase: a dotted line and a pin where each ends. */
    intents?: { from: Pos; path: Pos[]; predicted?: boolean }[];
    /** Each tile's visibility code (row-major, `VISIBILITY`, decision 44): a stale tile (1) is veiled grey. */
    visibility?: { width: number; codes: Uint8Array };
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
    /** The safe floor (§8.8, UI.md "Safe floor"): the reach's tiles tinted, drawn under the band edges. */
    safeFloor?: FloorTileVM[];
    /** A path is previewed or drawn: the floor steps back (fainter, no glyphs) and the path's own tints lead. */
    floorDim?: boolean;
    /** The path's safety (`pathSafety`): each step's tint and the eye on the first unsafe one. */
    pathSafety?: PathVM;
    /** A long-pressed tile's "who and why": the tile marked, each observer's sightline to it. */
    explain?: ExplainVM;
    /** The colour-blind preset (UI.md "Signal palette"). */
    colourBlind?: boolean;
    /** The selected crew member's own tile: what ending the turn there does, drawn round them and as a plate over the head. */
    stay?: FloorTileVM;
    /** v2: draw only the cones (NPCs' and cameras') that meet the reach or the drawn path. */
    coneFilter?: boolean;
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
/** The veil on a tile not seen this turn. */
const STALE_VEIL = 'rgba(96, 98, 110, 0.45)';
/** The safe floor's grey: no data, or unknown risk. */
const GREY = '#8a8894';
/** Where someone unknown could watch from (long-press on unknown risk): the grey, lightened. */
const WATCHER = '#d0ced8';
const PING = 'rgba(226, 162, 64, 0.8)';

/**
 * How far past the view the overlay is drawn on each side, as a share of the view: while the view moves the drawing is
 * slid along, and drawn afresh only when the view nears its edge. Half a view lets an arrow-key pan (480 screen px/s) run
 * a second or more between redraws on any screen, for four times a view's pixels.
 */
const MARGIN = 0.5;
/** The most UI pixels the drawing may have (a 4K frame, 33 MB): a larger view gets a narrower margin. */
const MAX_PIXELS = 3840 * 2160;
/** The drawing's corner sits on a multiple of this many art pixels, so the fill patterns stay put on the map across redraws. */
const SNAP = 12;
/** How far past the plot's edge there is anything to draw (art pixels): plates and pips over heads, the Alarm's rings. */
const PAD = 3 * SNAP;

export class WorldOverlay {
    readonly canvas: HTMLCanvasElement;
    /** Clips the drawing to the camera's part of the game's canvas. */
    private readonly frame: HTMLDivElement;
    private readonly ctx: CanvasRenderingContext2D;
    private content: OverlayContent | null = null;
    /** What the last drawing was made from (all but where the camera looked): redraw when it changes. */
    private drawn = '';
    /** The map area the drawing covers, in art pixels. */
    private area = { x: 0, y: 0, w: 0, h: 0 };
    /** Where the camera looked at the last frame. */
    private lastView = { x: 0, y: 0 };
    private readonly onRender = () => this.draw();

    /**
     * `lift` says how many art pixels up the screen tile (tx, ty) is drawn now (a raised floor; 0 on the ground), and
     * `steps` the step every raised floor is cut to now, as a string that changes whenever a lift does; `plot` is the
     * map's size in art pixels, past which there is nothing to draw.
     */
    constructor(
        private readonly scene: Phaser.Scene,
        private readonly lift: (tx: number, ty: number) => number = () => 0,
        private readonly plot?: { width: number; height: number },
        private readonly steps: () => string = () => ''
    ) {
        this.frame = document.createElement('div');
        Object.assign(this.frame.style, { position: 'fixed', overflow: 'hidden', pointerEvents: 'none', zIndex: '2' });
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'world-overlay';
        Object.assign(this.canvas.style, { position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', imageRendering: 'pixelated' });
        this.ctx = this.canvas.getContext('2d')!;
        this.frame.append(this.canvas);
        document.body.append(this.frame);
        scene.game.events.on(Phaser.Core.Events.POST_RENDER, this.onRender);
        scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    }

    set(content: OverlayContent | null): void {
        this.content = content;
        this.drawn = '';
    }

    /** The path shown, for tests. */
    get state(): { safeFloor: FloorTileVM[]; floorDim: boolean; pathSafety: PathVM | null; explain: ExplainVM | null; badges: number; hearers: number; cones: number; cameras: number; cameraCones: number; flashes: number; colourBlind: boolean; path: Pos[]; reach: number; dashReach: number; range: { walk: Pos[]; run: Pos[] }; dash: boolean; noise: number; witnesses: number; intents: number } {
        const c = this.content;
        return {
            safeFloor: c?.safeFloor ?? [], floorDim: !!c?.floorDim, pathSafety: c?.pathSafety ?? null, explain: c?.explain ?? null,
            badges: c?.badges?.length ?? 0, hearers: c?.hearers?.length ?? 0, cones: c?.cones?.length ?? 0, colourBlind: !!c?.colourBlind,
            cameras: c?.cameras?.length ?? 0, cameraCones: c?.cameras?.filter(v => v.core.length + v.peripheral.length > 0).length ?? 0, flashes: c?.flashes?.length ?? 0,
            path: c?.path ?? [], reach: c?.reach?.move.length ?? 0, dashReach: c?.reach?.dash.length ?? 0,
            range: { walk: c?.reach?.move ?? [], run: c?.reach?.dash ?? [] }, dash: !!c?.dash, noise: c?.noise?.length ?? 0, witnesses: c?.witnesses?.length ?? 0,
            intents: c?.intents?.length ?? 0
        };
    }

    destroy(): void {
        this.scene.game.events.off(Phaser.Core.Events.POST_RENDER, this.onRender);
        this.frame.remove();
    }

    /** Where there is anything to draw along an axis, in art pixels: the plot and its pad, on `SNAP`; unbounded without a plot. */
    private static bounds(plot: number | undefined): [number, number] {
        return plot === undefined ? [-Infinity, Infinity] : [-PAD, Math.ceil((plot + PAD) / SNAP) * SNAP];
    }

    /** Whether the drawing covers what a view at (vx, vy), vw by vh art pixels, shows of the plot. */
    private covers(vx: number, vy: number, vw: number, vh: number): boolean {
        // Per axis: 0 when the view shows none of the plot along it, 1 when the drawing covers what it shows, -1 otherwise.
        const axis = (v: number, size: number, plot: number | undefined, at: number, len: number) => {
            const [lo, hi] = WorldOverlay.bounds(plot), a = Math.max(lo, v), b = Math.min(hi, v + size);
            return a >= b ? 0 : a >= at && b <= at + len ? 1 : -1;
        };
        const { area: d } = this, x = axis(vx, vw, this.plot?.width, d.x, d.w), y = axis(vy, vh, this.plot?.height, d.y, d.h);
        return x === 0 || y === 0 || (x === 1 && y === 1);
    }

    /**
     * The area to draw for a view at v of `size` art pixels along an axis: `margin` past it on each side, its corner on
     * `SNAP`, slid inside the plot's bounds (so its size depends only on the view's and the plot's).
     */
    private static place(v: number, size: number, margin: number, plot: number | undefined): [number, number] {
        const [lo, hi] = WorldOverlay.bounds(plot), len = Math.min(hi - lo, (Math.ceil((size + 2 * margin) / SNAP) + 1) * SNAP);
        return [Math.max(lo, Math.min(hi - len, Math.floor((v - margin) / SNAP) * SNAP)), len];
    }

    /**
     * Draws over the frame just rendered, clipped to the camera's part of the game's canvas. The drawing covers the view
     * and a margin round it (`MARGIN`); while the view moves (a pan, a drag) it is slid along rather than drawn again
     * every frame (a drawing is a few thousand fills, which a software GPU takes a frame or more to raster), and drawn
     * afresh, round the view, when what it shows changes or when the view, two frames further on at its current speed
     * (headroom for an uneven frame), would show the plot past the drawing's edge.
     */
    private draw(): void {
        const game = this.scene.game, cam = this.scene.cameras.main, canvasBox = game.canvas.getBoundingClientRect();
        // Over the camera's part of the canvas (all of it, but when zoomed closer than the canvas is sized for, see BankCamera.applyZoom).
        const { scale } = this.scene, sx = canvasBox.width / scale.width, sy = canvasBox.height / scale.height;
        const box = { left: canvasBox.left, top: canvasBox.top, width: cam.width * sx, height: cam.height * sy };
        // CSS pixels per art pixel.
        const kx = box.width / cam.width, ky = box.height / cam.height;
        const vw = cam.width, vh = cam.height, vx = Math.round(cam.worldView.x), vy = Math.round(cam.worldView.y);
        const step = { x: vx - this.lastView.x, y: vy - this.lastView.y };
        this.lastView = { x: vx, y: vy };
        // A raised floor rises and drops as it is cut: everything drawn on it follows (the cut steps are part of the key).
        const key = `${vw}x${vh}:${box.left},${box.top},${box.width},${box.height}:${this.steps()}`;
        const { canvas, ctx, frame } = this;
        const place = () => (canvas.style.transform = `translate(${(this.area.x - vx) * kx}px, ${(this.area.y - vy) * ky}px)`);
        if (key === this.drawn && this.covers(vx, vy, vw, vh) && this.covers(vx + 2 * step.x, vy + 2 * step.y, vw, vh)) {
            place();
            return;
        }
        this.drawn = key;
        // The margin narrows so the drawing stays within `MAX_PIXELS`.
        const fit = (Math.sqrt(MAX_PIXELS / (vw * vh * UI_SCALE * UI_SCALE)) - 1) / 2, margin = Math.max(0, Math.min(MARGIN, fit));
        // Drawn in the area's own pixels: its corner is map point (ox, oy).
        const [ox, aw] = WorldOverlay.place(vx, vw, Math.round(vw * margin), this.plot?.width);
        const [oy, ah] = WorldOverlay.place(vy, vh, Math.round(vh * margin), this.plot?.height);
        this.area = { x: ox, y: oy, w: aw, h: ah };
        const w = aw * UI_SCALE, h = ah * UI_SCALE;
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
        Object.assign(frame.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
        Object.assign(canvas.style, { width: `${aw * kx}px`, height: `${ah * ky}px` });
        place();
        ctx.clearRect(0, 0, w, h);
        const c = this.content;
        if (!c) return;
        const S = TILE * UI_SCALE;
        const left = (p: Pos) => (p.x * TILE - ox) * UI_SCALE, top = (p: Pos) => (p.y * TILE - this.lift(p.x, p.y) - oy) * UI_SCALE;
        const mid = (p: Pos): [number, number] => [left(p) + S / 2, top(p) + S / 2];
        const pal = PALETTES[c.colourBlind ? 'colourBlind' : 'default'];

        if (c.visibility) {
            // A grey veil over every tile in the drawn area not seen this turn.
            const { width, codes } = c.visibility, height = codes.length / width;
            ctx.fillStyle = STALE_VEIL;
            const x0 = Math.max(0, Math.floor(ox / TILE)), y0 = Math.max(0, Math.floor(oy / TILE));
            const x1 = Math.min(width - 1, Math.floor((ox + aw) / TILE)), y1 = Math.min(height - 1, Math.floor((oy + ah) / TILE));
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (codes[y * width + x] === 1) ctx.fillRect(left({ x, y }), top({ x, y }), S, S);
        }

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

        // The band edges, and the default overlay's floor glyphs, wait for the cones: those go over the fills, under them.
        let overCones = () => {};
        if (c.reach) {
            // The mover's own tile counts as inside, so the edge doesn't box them in.
            // Tiles with someone lying on them (a dragged body) keep their edge but no tint, so the body shows.
            const bare = has(c.reach.unfilled ?? []), tinted = has((c.safeFloor ?? []).map(t => t.pos));
            const filled = (tiles: Pos[]) => tiles.filter(p => !bare(p.x, p.y) && !tinted(p.x, p.y));
            const { at } = c.reach, move = c.reach.move, dash = c.reach.dash, inMove = has([...move, ...(at ? [at] : [])]), inAll = has([...move, ...dash, ...(at ? [at] : [])]);
            // Until the safe floor arrives (the Dash band a frame after the Move band): Dash's band a faint tint and a
            // diagonal hatch in gold, Move's a flat steel blue.
            if (OVERLAY_V2) {
                // v2: the safety fill alone (glyphs come last, over everything on the floor), then one contour per band.
                if (c.safeFloor?.length) this.drawSafeFloor(c.safeFloor.filter(t => !bare(t.pos.x, t.pos.y)), pal, left, top, S, c.floorDim ? 0.5 : 1, false);
                // Each band's outer edge only: small holes in it (furniture, someone standing) read by having no fill.
                const all = [...move, ...dash, ...(at ? [at] : [])], moved = at ? [...move, at] : move;
                overCones = () => {
                    this.strokeRuns(sideRuns(dash, withoutHoles(all, inAll)), RUN_EDGE, 2, [6, 4], ox, oy);
                    this.strokeRuns(sideRuns(moved, withoutHoles(moved, inMove)), WALK_EDGE, 2, [], ox, oy);
                };
            } else {
                ctx.fillStyle = RUN;
                for (const p of filled(dash)) ctx.fillRect(left(p), top(p), S, S);
                // Lines at 45°, every 8 UI pixels (where x + y is a multiple of 8), running on across neighbouring tiles.
                ctx.fillStyle = this.pattern('run', RUN_HATCH);
                for (const p of filled(dash)) ctx.fillRect(left(p), top(p), S, S);
                ctx.fillStyle = WALK;
                for (const p of filled(move)) ctx.fillRect(left(p), top(p), S, S);
                const tiles = (c.safeFloor ?? []).filter(t => !bare(t.pos.x, t.pos.y));
                this.drawSafeFloor(tiles, pal, left, top, S, c.floorDim ? 0.45 : 1, false);
                overCones = () => {
                    // The range's outer edge, dashed gold; then Move's edge, solid steel blue: where a step costs a second
                    // action; the glyphs over them, but while a path leads.
                    stroke(dash, inAll, RUN_EDGE, 2, [6, 4]);
                    stroke(move, inMove, WALK_EDGE, 2, []);
                    if (!c.floorDim) for (const t of tiles) this.drawGlyph(t, left(t.pos), top(t.pos), S, this.tintColour(t.kind, pal));
                };
            }
        }

        // v2: a cone is drawn where being seen matters: when it meets a step of the drawn path, or with none a tile of the
        // reach, that isn't safe (or the drawer shows all, or it was long-pressed).
        const risky = c.path?.length ? (c.pathSafety ? c.pathSafety.steps.filter(t => t.kind !== 'safe').map(t => t.pos) : c.path)
            : c.safeFloor?.length ? c.safeFloor.filter(t => t.kind !== 'safe').map(t => t.pos) : [...(c.reach?.move ?? []), ...(c.reach?.dash ?? [])];
        const near = has(risky);
        const relevant = (tiles: Pos[]) => !c.coneFilter || tiles.some(p => near(p.x, p.y));
        // Cones, NPCs' and cameras' (v2: only those `relevant`): the tiles seen, outlined inset in pale white, no colour
        // any other layer uses, stronger when Alerted or on the operator's monitors; cameras dashed, grey and fainter
        // while looped; a panning camera's next facing dotted.
        const views: View[] = [];
        for (const cone of c.cones ?? []) {
            const all = [...cone.core, ...cone.peripheral];
            if (relevant(all)) views.push({ from: cone.from, tiles: all, colour: alpha(VIEW, cone.alerted ? 0.9 : 0.65), line: 'solid', wash: true });
        }
        for (const cam of c.cameras ?? []) {
            const all = [...cam.core, ...cam.peripheral];
            if (!all.length || !relevant([...all, ...(cam.next ?? [])])) continue;
            const looped = cam.loopLeft !== undefined, colour = looped ? alpha('#a8a6b0', 0.45) : alpha(VIEW, cam.monitored ? 0.9 : 0.65);
            views.push({ from: cam.pos, tiles: all, colour, line: 'dashed', wash: !looped });
            if (cam.next?.length) views.push({ from: cam.pos, tiles: cam.next, colour: alpha(VIEW, 0.4), line: 'dotted', wash: false });
        }
        this.drawViews(views, mid, S, ox, oy);
        overCones();

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

        if (c.noise?.length && OVERLAY_V2) {
            // v2: no fill (fill is safety's), a rounded contour inset in the tiles in the noise's own colour.
            this.strokeLoops(insetLoops(c.noise, withoutHoles(c.noise, has(c.noise)), NOISE_INSET / S), NOISE, 2, [], NOISE_RADIUS, ox, oy);
        } else if (c.noise?.length) {
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
            const x = (c.targetDoor.x * TILE - ox) * UI_SCALE, y = (c.targetDoor.y * TILE - this.lift(Math.floor(c.targetDoor.x), Math.floor(c.targetDoor.y)) - oy) * UI_SCALE;
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
        // v2: a hearer's state plate gives way to its ear badge, which says what it will do.
        const hearing = new Set(OVERLAY_V2 ? (c.hearers ?? []).map(e => e.id) : []);
        for (const b of c.badges ?? []) Object.assign(row(b.pos, b.lying), { faded: b.faded, pips: b.pips }).plates.push(...(hearing.has(b.id) ? [] : b.plates));
        // The one sent to look also wears the pin (Investigating).
        // Face down (commanded, tied): hears it, stays down.
        for (const e of c.hearers ?? []) row(e.pos, e.lying).plates.push({ glyph: 'speaker', signal: e.signal, ...(e.sym ? { sym: e.sym } : {}), ...(e.sent ? { then: 'pin' as const } : e.still ? { then: 'down' as const } : {}) });
        for (const w of c.witnesses ?? []) row(w.pos, w.lying).plates.push(witnessPlate(w));
        for (const cam of c.cameras ?? []) row(cam.pos, true).plates.push(cameraPlate(cam));
        const overHeads = () => {
            for (const r of rows.values()) {
                const x = Math.round(mid(r.pos)[0]), y = Math.round(top(r.pos)) - (r.lying ? LYING : HEAD);
                ctx.globalAlpha = r.faded ? 0.55 : 1;
                const h = this.drawPlates(r.plates, x, y, pal);
                this.drawPips(r.pips, x, y - h - (h ? 2 : 0), c.crewColours ?? {});
                ctx.globalAlpha = 1;
            }
        };
        // v2 draws them after the floor's glyphs, so nothing on the floor covers a plate.
        if (!OVERLAY_V2) {
            overHeads();
            if (c.stay) this.drawStay(c.stay, left, top, mid, S, pal);
        }

        for (const r of c.routes ?? []) this.drawRoute(r, mid, pal);

        if (c.from && c.path?.length && !(c.routeDrag && c.badFrom === undefined)) {
            const points = [c.from, ...c.path].map(mid), bad = c.badFrom ?? Infinity, safety = c.pathSafety;
            // The path's own tints (§8.8 "along the whole drawn path"), at full strength over the dimmed floor; its end
            // as the floor tints it, glyph and all.
            if (safety) {
                for (const step of safety.steps.slice(0, -1)) this.tintTile(step.kind, step.hatched, 'move', left(step.pos), top(step.pos), S, pal, 1.25, step.doorRisk);
                this.drawSafeFloor([safety.end], pal, left, top, S, 1.25, !OVERLAY_V2);
            }
            const stepColour = (i: number): string => {
                const k = safety?.steps[i]?.kind;
                return i >= bad || k === 'red' || k === 'camera' ? pal.red : CREAM;
            };
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
                ctx.fillStyle = stepColour(i - 1);
                ctx.fillRect(x - 2, y - 2, 4, 4);
            }
            const end = c.path.at(-1)!, x = left(end), y = top(end), endColour = c.path.length - 1 >= bad ? pal.red : c.colour;
            ctx.strokeStyle = INK;
            ctx.strokeRect(x + 3, y + 4, S - 6, S - 6);
            ctx.strokeStyle = endColour;
            ctx.strokeRect(x + 3, y + 3, S - 6, S - 6);
            if (c.dash) ctx.strokeRect(x + 7, y + 7, S - 14, S - 14);
            // The eye on the first unsafe step, so the player can stop one short (§8.8): a plate on the tile's top edge,
            // leaving its tint and glyph in view.
            const eye = safety && safety.eyeAt !== null ? safety.steps[safety.eyeAt] : undefined;
            if (eye) {
                const camera = eye.kind === 'camera';
                this.drawPlates([{ glyph: camera ? 'camera' : 'eye', signal: eye.kind === 'red' || camera ? 'red' : 'amber', ...(eye.hatched ? {} : { sym: '!' as const }) }], Math.round(mid(eye.pos)[0]), Math.round(top(eye.pos)) + 4, pal);
            }
        }

        if (OVERLAY_V2) {
            // The floor's glyphs on every tile of the reach, over the floor, cones, paths and intents; the path's own
            // steps show its verdict instead (its tint, the eye plate), its end the path's own glyph.
            const path = c.from && c.path?.length ? c.pathSafety : undefined, end = path?.end;
            const steps = has(path ? path.steps.slice(0, -1).map(t => t.pos) : []), bare = has(c.reach?.unfilled ?? []);
            const tiles = c.reach ? (c.safeFloor ?? []).filter(t => !bare(t.pos.x, t.pos.y) && !steps(t.pos.x, t.pos.y) && !(end && t.pos.x === end.pos.x && t.pos.y === end.pos.y)) : [];
            for (const t of end ? [...tiles, end] : tiles) this.drawGlyph(t, left(t.pos), top(t.pos), S, this.tintColour(t.kind, pal));
            overHeads();
            if (c.stay) this.drawStay(c.stay, left, top, mid, S, pal);
        }

        if (c.explain) this.drawExplain(c.explain, left, top, mid, S, pal);
    }

    /**
     * The crew member's own tile (UI.md "Safe floor"): what ending the turn there does, readable with them standing on
     * it. A band of the tint round the tile's edge (the person stays clear; hatched when the coming world phase does it,
     * grey hatched for unknown risk), and, for a warning, its plate over their head: the eye with the pips, the hand,
     * the eye or camera with `!`, `?` for unknown risk.
     */
    private drawStay(t: FloorTileVM, left: (p: Pos) => number, top: (p: Pos) => number, mid: (p: Pos) => [number, number], S: number, pal: Record<Signal, string>): void {
        const ctx = this.ctx, x = left(t.pos), y = top(t.pos), colour = this.tintColour(t.kind, pal), B = 5;
        const hatched = t.hatched || t.kind === 'unknownRisk' || t.doorRisk;
        ctx.beginPath();
        ctx.rect(x, y, S, S);
        ctx.rect(x + B, y + B, S - 2 * B, S - 2 * B);
        ctx.fillStyle = alpha(colour, hatched ? 0.3 : 0.6);
        ctx.fill('evenodd');
        if (hatched) {
            ctx.fillStyle = this.pattern('duo', alpha(t.doorRisk && t.kind !== 'unknownRisk' ? GREY : colour, 0.95), 'rgba(13, 12, 20, 0.85)');
            ctx.fill('evenodd');
        }
        ctx.lineWidth = 1;
        ctx.strokeStyle = alpha(colour, 0.95);
        ctx.strokeRect(x + 0.5, y + 0.5, S - 1, S - 1);
        ctx.strokeRect(x + B - 0.5, y + B - 0.5, S - 2 * B + 1, S - 2 * B + 1);
        const plate: PlateVM | undefined = t.kind === 'amber' ? { glyph: 'eye', signal: 'amber', count: Math.max(1, t.pips) }
            : t.kind === 'trespass' ? { glyph: 'hand', signal: 'amber' }
            : t.kind === 'red' ? { glyph: 'eye', signal: 'red', sym: '!' }
            : t.kind === 'camera' ? { glyph: 'camera', signal: 'red', sym: '!' }
            : t.kind === 'unknownRisk' ? { glyph: 'eye', signal: 'cream', sym: '?' } : undefined;
        if (!plate) return;
        const px = Math.round(mid(t.pos)[0]), py = Math.round(y) - HEAD - 2;
        this.drawPlates([plate], px, py, pal);
        // The coming world phase's: a hatched strip under the plate, the floor's pattern for "next phase".
        if (hatched) {
            ctx.fillStyle = this.pattern('duo', alpha(colour, 0.95), 'rgba(13, 12, 20, 0.85)');
            ctx.fillRect(px - 10, py + 1, 20, 4);
        }
    }

    /**
     * Views (cones): each exactly the tiles its watcher sees (the rules' own field, `ConeVM`/`CameraVM`, and the tile
     * they stand on, so it closes round them), as a closed outline inset in those tiles with rounded corners like the
     * noise ring: it never sits on a band's edge or a tile's, and a tile is inside it exactly when it is seen. A faint
     * fade from the watcher outwards (8% to nothing at the furthest tile), then a thin edge over a dark under-stroke,
     * thinner than the band edges, which are drawn over it.
     */
    private drawViews(views: readonly View[], mid: (p: Pos) => [number, number], S: number, ox: number, oy: number): void {
        const ctx = this.ctx, px = (p: Corner): [number, number] => [(p.x * TILE - ox) * UI_SCALE, (p.y * TILE - this.lift(p.tile.x, p.tile.y) - oy) * UI_SCALE];
        for (const v of views) {
            if (!v.tiles.length) continue;
            const all = [...v.tiles, v.from], seen = new Set(all.map(p => `${p.x},${p.y}`));
            const loops = insetLoops(all, (x, y) => seen.has(`${x},${y}`), VIEW_INSET / S);
            if (!loops.length) continue;
            this.loopPath(loops, VIEW_RADIUS, px);
            if (v.wash) {
                const [cx, cy] = mid(v.from), range = Math.max(...v.tiles.map(p => Math.hypot(p.x - v.from.x, p.y - v.from.y))) + 0.5;
                const fade = ctx.createRadialGradient(cx, cy, 0, cx, cy, range * S);
                fade.addColorStop(0, alpha(VIEW, 0.08));
                fade.addColorStop(1, alpha(VIEW, 0));
                ctx.fillStyle = fade;
                // Even-odd, so a hole (a tile not seen inside the view) stays unwashed.
                ctx.fill('evenodd');
            }
            ctx.setLineDash(v.line === 'dashed' ? [6, 4] : v.line === 'dotted' ? [2, 4] : []);
            ctx.lineWidth = 3.5;
            ctx.strokeStyle = 'rgba(13, 12, 20, 0.55)';
            ctx.stroke();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = v.colour;
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    /** v2: chained sides (`sideRuns`) stroked over a 1px ink drop shadow, each side at its own tile's lift. */
    private strokeRuns(runs: Side[][], colour: string, width: number, dash: number[], ox: number, oy: number): void {
        const ctx = this.ctx, px = (x: number, y: number, t: Pos): [number, number] => [(x * TILE - ox) * UI_SCALE, (y * TILE - this.lift(t.x, t.y) - oy) * UI_SCALE];
        ctx.lineWidth = width;
        ctx.setLineDash(dash);
        for (const [style, dy] of [[INK, 2], [colour, 0]] as const) {
            ctx.strokeStyle = style;
            ctx.beginPath();
            for (const run of runs) {
                let pen: [number, number] | undefined;
                for (const s of run) {
                    const [ax, ay] = px(s.x0, s.y0, s.tile), [bx, by] = px(s.x1, s.y1, s.tile);
                    if (!pen || pen[0] !== ax || pen[1] !== ay) ctx.moveTo(ax, ay + dy);
                    ctx.lineTo(bx, by + dy);
                    pen = [bx, by];
                }
            }
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    /** v2: closed inset loops (`insetLoops`) stroked over an ink shadow, their corners rounded by `radius` UI pixels. */
    private strokeLoops(loops: Corner[][], colour: string, width: number, dash: number[], radius: number, ox: number, oy: number): void {
        const ctx = this.ctx, px = (p: Corner): [number, number] => [(p.x * TILE - ox) * UI_SCALE, (p.y * TILE - this.lift(p.tile.x, p.tile.y) - oy) * UI_SCALE];
        ctx.lineWidth = width;
        ctx.setLineDash(dash);
        const shadow = width > 1 ? [INK, 2] as const : ['rgba(13, 12, 20, 0.5)', 1] as const;
        for (const [style, dy] of [shadow, [colour, 0] as const]) {
            ctx.strokeStyle = style;
            this.loopPath(loops, radius, px, dy);
            ctx.stroke();
        }
        ctx.setLineDash([]);
    }

    /** Closed loops' corners (`px` places them) as the current path, `dy` lower, each corner rounded by `radius`. */
    private loopPath(loops: Corner[][], radius: number, px: (p: Corner) => [number, number], dy = 0): void {
        const ctx = this.ctx;
        ctx.beginPath();
        for (const loop of loops) {
            const pts = loop.map(px), n = pts.length;
            if (!radius) {
                pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y + dy) : ctx.moveTo(x, y + dy)));
                ctx.closePath();
                continue;
            }
            // From the middle of the last side, each corner rounded (no wider than half its shorter side).
            const [lx, ly] = pts[n - 1]!, [fx, fy] = pts[0]!;
            ctx.moveTo((lx + fx) / 2, (ly + fy) / 2 + dy);
            pts.forEach(([x, y], i) => {
                const [ax, ay] = pts[(i + n - 1) % n]!, [bx, by] = pts[(i + 1) % n]!;
                const r = Math.min(radius, Math.hypot(x - ax, y - ay) / 2, Math.hypot(bx - x, by - y) / 2);
                ctx.arcTo(x, y + dy, bx, by + dy, r);
            });
            ctx.closePath();
        }
    }

    /**
     * "Who and why" on the map (§8.8): the long-pressed tile bracketed in cream, and each observer's sightline to it in the
     * colour of what they'd make of it; for the coming world phase, dashed, from where the NPC will be (a dashed ghost
     * footprint there).
     */
    private drawExplain(e: ExplainVM, left: (p: Pos) => number, top: (p: Pos) => number, mid: (p: Pos) => [number, number], S: number, pal: Record<Signal, string>): void {
        const ctx = this.ctx;
        // Each watcher tile once: the held tile's line comes first, so a tile watching it too stays bright.
        const marked = new Set<string>();
        for (const line of e.lines) if (line.watchers) this.drawWatchers(line.watchers, e.tile, marked, left, top, mid, S);
        for (const line of e.lines) {
            if (!line.from) continue;
            const colour = line.outcome === '!' ? pal.red : line.outcome === '-' ? CREAM : pal.amber, next = line.phase === 'next';
            const [ax, ay] = mid(line.from), [bx, by] = mid(line.to);
            ctx.lineWidth = 2;
            ctx.setLineDash(next ? [5, 4] : []);
            for (const [style, dy] of [[INK, 2], [colour, 0]] as const) {
                ctx.strokeStyle = style;
                ctx.beginPath();
                ctx.moveTo(ax, ay + dy);
                ctx.lineTo(bx, by + dy);
                ctx.stroke();
            }
            ctx.setLineDash(next ? [3, 3] : []);
            ctx.lineWidth = 1;
            ctx.strokeStyle = colour;
            // Where the observer looks from: a ring (a dashed footprint when it is where they'll be next phase).
            if (next) ctx.strokeRect(left(line.from) + 3.5, top(line.from) + 3.5, S - 7, S - 7);
            else {
                ctx.beginPath();
                ctx.arc(ax, ay, 5, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }
        const x = left(e.tile), y = top(e.tile);
        for (const [style, dy] of [[INK, 2], [CREAM, 0]] as const) {
            ctx.fillStyle = style;
            for (const [bx, by] of [[0, 0], [S - 8, 0], [0, S - 2], [S - 8, S - 2]]) ctx.fillRect(x + bx!, y + by! + dy, 8, 2);
            for (const [bx, by] of [[0, 0], [S - 2, 0], [0, S - 8], [S - 2, S - 8]]) ctx.fillRect(x + bx!, y + by! + dy, 2, 8);
        }
    }

    /**
     * Where someone unknown could watch the long-pressed tile from (unknown risk): each such tile outlined in pale grey
     * (the unknown-risk grey, lightened to read over its hatch) with a dot, over an ink shadow, fainter for those
     * watching a tile passed on the way; a faint dotted sightline from the worst.
     */
    private drawWatchers(watchers: readonly { from: Pos; to: Pos }[], tile: Pos, marked: Set<string>, left: (p: Pos) => number, top: (p: Pos) => number, mid: (p: Pos) => [number, number], S: number): void {
        const ctx = this.ctx, worst = watchers[0];
        if (worst) {
            const [ax, ay] = mid(worst.from), [bx, by] = mid(worst.to);
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            for (const [style, dy] of [[INK, 1], [alpha(WATCHER, 0.7), 0]] as const) {
                ctx.strokeStyle = style;
                ctx.beginPath();
                ctx.moveTo(ax, ay + dy);
                ctx.lineTo(bx, by + dy);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }
        for (const w of watchers) {
            const key = `${w.from.x},${w.from.y}`;
            if (marked.has(key)) continue;
            marked.add(key);
            const x = left(w.from), y = top(w.from), passed = w.to.x !== tile.x || w.to.y !== tile.y;
            for (const [style, d] of [[INK, 1], [alpha(WATCHER, passed ? 0.55 : 0.95), 0]] as const) {
                ctx.strokeStyle = style;
                ctx.fillStyle = style;
                ctx.strokeRect(x + 4.5 + d, y + 4.5 + d, S - 9, S - 9);
                ctx.fillRect(x + S / 2 - 1 + d, y + S / 2 - 1 + d, 2, 2);
            }
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
        // This turn's steps a preview warns of: amber, struck through like the overlay's unsafe floor (auto-advance stops before them).
        for (const p of r.unsafe ?? []) {
            const [x, y] = mid(p), S = 32;
            ctx.fillStyle = alpha(pal.amber, 0.25);
            ctx.fillRect(x - S / 2, y - S / 2, S, S);
            ctx.strokeStyle = pal.amber;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - 5, y - 5);
            ctx.lineTo(x + 5, y + 5);
            ctx.moveTo(x + 5, y - 5);
            ctx.lineTo(x - 5, y + 5);
            ctx.stroke();
        }
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
            // Later turns are estimates: the NPCs will have moved by then.
            const [x, y] = mid(leg.path.at(-1)!), text = r.now !== undefined && leg.turn > r.now ? `~${leg.turn}` : String(leg.turn), w = Math.max(16, ctx.measureText(text).width + 8), py = y - 16;
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
     * The safe-floor tints (§8.8, UI.md "Safe floor"), two channels each: the signal colour (sage, amber, red, grey) and
     * a shape: amber's pips (one square per pip), a challenge's hand, the eye of someone who Exposes them, a camera's
     * glyph; unknown risk is grey hatched, with no glyph, and a tint a door not seen this turn could make worse
     * (`doorRisk`) has the same grey hatch over it, glyph and all. Move's tiles in scanlines, the Dash band's in a sparser dotted fill (its edge
     * says so too), the coming world phase's outcomes hatched. `strength` scales the fill (a dimmed floor while a path
     * leads); `glyphs` false leaves the shapes off.
     */
    private drawSafeFloor(tiles: readonly FloorTileVM[], pal: Record<Signal, string>, left: (p: Pos) => number, top: (p: Pos) => number, S: number, strength = 1, glyphs = true): void {
        for (const t of tiles) {
            const x = left(t.pos), y = top(t.pos), colour = this.tintTile(t.kind, t.hatched, t.band, x, y, S, pal, strength, t.doorRisk);
            if (glyphs) this.drawGlyph(t, x, y, S, colour);
        }
    }

    /** A safe-floor tile's glyph (see `drawSafeFloor`) on the tile at (x, y); v2 sets it, pips too, on a darker plate. */
    private drawGlyph(t: FloorTileVM, x: number, y: number, S: number, colour: string): void {
        const ctx = this.ctx;
        // Unknown risk has no glyph: its grey hatch (a shape, not only a colour) says it.
        if (t.kind === 'unknownRisk') return;
        const glyph: GlyphName | undefined = t.kind === 'trespass' ? 'hand' : t.kind === 'red' ? 'eye' : t.kind === 'camera' ? 'camera' : undefined;
        if (glyph) {
            const g = glyphSize(GLYPHS[glyph]);
            // A small dark plate under the glyph, so it reads on any tint.
            ctx.fillStyle = OVERLAY_V2 ? 'rgba(12, 11, 15, 0.78)' : 'rgba(12, 11, 15, 0.55)';
            ctx.fillRect(x + Math.floor((S - g.w) / 2) - 2, y + Math.floor((S - g.h) / 2) - 2, g.w + 4, g.h + 4);
            drawRows(ctx, GLYPHS[glyph], x + Math.floor((S - g.w) / 2), y + Math.floor((S - g.h) / 2), colour);
        } else if (t.kind === 'amber') {
            const n = Math.max(1, Math.min(3, t.pips)), x0 = x + Math.round(S / 2 - (n * 7 - 3) / 2), py = OVERLAY_V2 ? y + S / 2 - 2 : y + 14;
            if (OVERLAY_V2) {
                ctx.fillStyle = 'rgba(12, 11, 15, 0.78)';
                ctx.fillRect(x0 - 3, py - 3, n * 7 + 3, 10);
            }
            for (let i = 0; i < n; i++) {
                ctx.fillStyle = 'rgba(8, 7, 10, 0.8)';
                ctx.fillRect(x0 + i * 7 + 1, py + 1, 4, 4);
                ctx.fillStyle = colour;
                ctx.fillRect(x0 + i * 7, py, 4, 4);
            }
        }
    }

    /** A tint's signal colour (see `drawSafeFloor`). */
    private tintColour(kind: TintKind, pal: Record<Signal, string>): string {
        return kind === 'safe' ? pal.safe : kind === 'amber' || kind === 'trespass' ? pal.amber : kind === 'red' || kind === 'camera' ? pal.red : GREY;
    }

    /**
     * Fills one tile with a tint (see `drawSafeFloor`), and unknown risk's grey hatch over it when a door could make it
     * worse (`doorRisk`); returns the tint's colour.
     */
    private tintTile(kind: TintKind, hatched: boolean, band: 'move' | 'dash', x: number, y: number, S: number, pal: Record<Signal, string>, strength: number, doorRisk = false): string {
        const ctx = this.ctx;
        const colour = this.tintColour(kind, pal);
        const a = (kind === 'safe' ? 0.26 : kind === 'grey' || kind === 'unknownRisk' ? 0.3 : 0.5) * strength;
        if (OVERLAY_V2) {
            // v2: a flat fill in the safety colour, whichever band; the one hatch (unknown risk's two-tone lines, in the
            // tint's own colour for the coming world phase) only where it could be worse than shown.
            const could = kind === 'unknownRisk' || hatched;
            ctx.fillStyle = alpha(colour, a * (could ? 0.3 : 0.7));
            ctx.fillRect(x, y, S, S);
            if (could) {
                const ink = Math.min(1, a * 1.5);
                ctx.fillStyle = this.pattern('duo', alpha(colour, ink), `rgba(13, 12, 20, ${(ink * 0.9).toFixed(3)})`);
                ctx.fillRect(x, y, S, S);
            }
        }
        // The coming world phase (and unknown risk): a faint wash and a diagonal hatch; Dash's band dotted; Move's in
        // scanlines. Patterns are anchored to the canvas, so they run on across neighbouring tiles.
        // Unknown risk's hatch is two-tone (a dark pixel beside each grey one), so it reads on pale floors too, where a
        // grey hatch alone fades into the pavement: it has no glyph to fall back on.
        const [wash, style, ink] = kind === 'unknownRisk' ? [0.25, 'duo', 1.5] as const : hatched ? [0.25, 'hatch', 1.5] as const
            : band === 'dash' ? [0.3, 'dots', 1.4] as const : [0.35, 'scan', 1] as const;
        if (!OVERLAY_V2) {
            ctx.fillStyle = alpha(colour, a * wash);
            ctx.fillRect(x, y, S, S);
            ctx.fillStyle = this.pattern(style, alpha(colour, Math.min(1, a * ink)), `rgba(13, 12, 20, ${(Math.min(1, a * ink) * 0.9).toFixed(3)})`);
            ctx.fillRect(x, y, S, S);
        }
        if (doorRisk && kind !== 'unknownRisk') {
            // Unknown risk's hatch at its own strength; over a hatched tint it runs between that tint's lines (3 pixels on).
            const grey = 0.3 * strength * 1.5, shift = hatched ? 3 : 0;
            ctx.fillStyle = this.pattern('duo', alpha(GREY, Math.min(1, grey)), `rgba(13, 12, 20, ${(Math.min(1, grey) * 0.9).toFixed(3)})`);
            ctx.translate(shift, 0);
            ctx.fillRect(x - shift, y, S, S);
            ctx.translate(-shift, 0);
        }
        return colour;
    }

    /** The fill patterns of the safe floor, made once per style and colour. */
    private readonly patterns = new Map<string, CanvasPattern | string>();

    private pattern(style: 'scan' | 'dots' | 'hatch' | 'duo' | 'run', colour: string, dark = INK): CanvasPattern | string {
        const key = `${style} ${colour} ${style === 'duo' ? dark : ''}`;
        let found = this.patterns.get(key);
        if (found) return found;
        const size = style === 'scan' ? [1, 2] : style === 'dots' ? [4, 8] : style === 'run' ? [8, 8] : [6, 6];
        const tile = document.createElement('canvas');
        tile.width = size[0]!;
        tile.height = size[1]!;
        const t = tile.getContext('2d')!;
        t.fillStyle = colour;
        if (style === 'scan') t.fillRect(0, 0, 1, 1);
        else if (style === 'dots') {
            t.fillRect(0, 1, 2, 2);
            t.fillRect(2, 5, 2, 2);
        } else if (style === 'run') {
            // One pixel where x + y is a multiple of 8: Dash's hatch before the safe floor arrives.
            for (let k = 0; k < 8; k++) t.fillRect((8 - k) % 8, k, 1, 1);
        } else if (style === 'duo') {
            // Lines at 45° every 6: a pixel of the colour beside a dark one.
            for (let k = 0; k < 6; k++) t.fillRect((6 - k) % 6, k, 1, 1);
            t.fillStyle = dark;
            for (let k = 0; k < 6; k++) t.fillRect((7 - k) % 6, k, 1, 1);
        } else {
            // Lines at 45°, two pixels wide, every 6.
            for (let k = 0; k < 6; k++) {
                t.fillRect((6 - k) % 6, k, 1, 1);
                t.fillRect((7 - k) % 6, k, 1, 1);
            }
        }
        found = this.ctx.createPattern(tile, 'repeat') ?? colour;
        this.patterns.set(key, found);
        return found;
    }
}
