import Phaser from 'phaser';
import { drawNumber, drawRows, GLYPHS, glyphSize, numberWidth, type GlyphName } from '../../art/ui/glyphs';
import {
    witnessPlate, type PhaseVM, type BadgeVM, type CameraVM, type ConeVM, type ExplainVM, type FloorTileVM, type HearerVM, type HoldRingVM, type PathVM, type PlateVM, type RingsOverlayVM, type Signal,
    type WitnessVM
} from '../../game/worldUi';
import type { EvidenceWarning } from '../../game/evidenceWarning';
import type { TintKind } from '../../sim';
import { TILE } from '../../level/constants';
import type { Pos } from '../../sim';
import { insetLoops, sideRuns, withoutHoles, type Corner, type Side } from './contours';

/**
 * The world UI layer (UI.md "Two layers", "Visual language", M1-14): a canvas over the game's at twice the art's
 * resolution (one UI pixel is half an art pixel), drawn with a margin round the view and slid along as the view moves,
 * redrawn when what it shows changes or the view nears the drawing's edge (`draw`). Hairlines with a 1px ink drop
 * shadow, muted signal colours, dark plates with a thin border in the signal colour; every state also has a shape or a
 * pattern, and the colour-blind preset swaps the palette (UI.md "Signal palette"). One visual channel per kind of
 * information: tile fill is safety only, the diagonal hatch is "could be worse than shown" only, each reach band is one
 * contour. It takes no input: taps go through to the map. Drawn, bottom to top:
 *
 * - **Floor:** a grey veil on tiles not seen this turn (hidden ones are the scene's opaque blocks); sound pings; the
 *   selected crew member's movement range, XCOM style, with the safe floor (§8.8) in it: each tile a flat fill in the
 *   move's tint, whichever band (grey hatched where it could be worse than shown); the cones (`drawViews`: of the
 *   observers who react to the crew member where they could go or on the drawn path, every NPC's and camera's from
 *   the drawer, or one long-pressed; all as one area, exactly the tiles any of them sees, outlined inset with rounded
 *   corners in pale white over ink; stronger when someone is Alerted or a camera on the operator's monitors); over
 *   them each band's outer edge (Move's solid steel blue, Dash's dashed gold); a previewed noise's ring (a rounded
 *   lilac contour inset in its tiles); a moment's flashes (a guard's shout ring, the Alarm's rings); a previewed
 *   command's two rings (the panic ring dashed amber round the command ring in steel blue) and hold rings (dotted steel
 *   blue); a previewed throw's reach (dotted gold), its arc and where it lands; a led hostage's tether.
 * - **Paths:** NPC intents (a dotted hairline, an open chevron and a pin where the walk ends; fainter when predicted);
 *   predicted markers (a dashed footprint); the previewed or dragged path, each step tinted by its safety (the floor
 *   underneath dimmed), ending on a tile outline in the crew colour (doubled for a dash; steps past the first bad one
 *   red), the eye's plate on its first unsafe step.
 * - **Glyphs:** on every tile of the reach, previews included, what it warns of (pips, a hand, an eye, a camera) on a
 *   dark plate, and the coming world phase's verdict when worse as a corner marker; on the path, its end's.
 * - **Over heads:** state plates and carrier countdowns (a hearer's give way to its ear badge), a downed guard's radio,
 *   suspicion pips in each crew member's colour, the ear badges of a noise's hearers naming what they'll do, the
 *   witnesses of a preview, ghosts' "seen N turns ago", each known camera's plate (`?` unknown feed, `!` on the
 *   monitors, a looped feed's phases left), and on evidence the coming world phase notices next turn's eye plate (`!`
 *   certain, `?` and hatched when someone could), a faint dotted line from each certain finder to it; the stay tile;
 *   a long-pressed tile's "who and why" sightlines.
 */

/** A known camera's plate: `?` while its feed status is unknown, `!` on the monitors, a looped feed's phases left. */
function cameraPlate(cam: CameraVM): PlateVM {
    if (cam.dead) return { glyph: 'camera', signal: 'cream', then: 'cross' };
    if (cam.loopLeft !== undefined) return { glyph: 'camera', signal: 'cream', count: cam.loopLeft };
    if (cam.status === 'unknown') return { glyph: 'camera', signal: 'amber', sym: '?' };
    return cam.monitored ? { glyph: 'camera', signal: 'red', sym: '!' } : { glyph: 'camera', signal: 'amber' };
}

/** A view to draw (`drawViews`): who looks from where and the tiles they see; `strong` when Alerted or on the monitors. */
interface View { from: Pos; tiles: Pos[]; strong: boolean }

/** The mini glyphs of the coming world phase's corner marker (`drawNext`), in ink on its triangle. */
const NEXT_GLYPHS = {
    eye: ['.xxx.', 'x.x.x', '.xxx.'],
    hand: ['x.x.x', 'xxxxx', '.xxx.'],
    camera: ['xxxx.', 'x..xx', 'xxxx.']
} as const;

/** UI pixels per art pixel. */
const UI_SCALE = 2;

/** The noise ring: a colour no other layer uses, inset in the tiles so it never sits on a band's edge (UI pixels). */
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
    intents?: { from: Pos; path: Pos[]; predicted?: boolean; /** A lapse's run (red) or a hider's (amber). */ tone?: 'red' | 'amber' }[];
    /** Each tile's visibility code (row-major, `VISIBILITY`, decision 44): a stale tile (1) is veiled grey. */
    visibility?: { width: number; codes: Uint8Array };
    /** Ghosts: where an NPC was last seen, and how long ago. */
    ghosts?: { pos: Pos; seenAgo: number }[];
    /** Loud noises the crew heard (§8.15). */
    pings?: { at: Pos }[];
    /** Loot the crew left on the floor (§15.1): a bag, or a crate. */
    loot?: { at: Pos; crate: boolean }[];
    /** A previewed throw (§15.1): the bag's arc, to the teammate who catches it or the floor. */
    throwArc?: { from: Pos; to: Pos; caught: boolean };
    /** The plates and pips over the NPCs and carriers the crew knows of (src/game/worldUi.ts). */
    badges?: BadgeVM[];
    /** The crew's colours by id, for the pips. */
    crewColours?: Record<string, string>;
    /** Who hears a previewed noise and what they'll do (an ear badge each). */
    hearers?: HearerVM[];
    /** A previewed command's two rings (§10.1) and each known NPC's outcome over its head. */
    rings?: RingsOverlayVM;
    /** Hold rings (§10.3): of those holding the room this turn, and a hold previewed. */
    holds?: HoldRingVM[];
    /** Where the bag in the selected crew member's hands could be thrown (`throwTargets`), while a throw is previewed. */
    throwRange?: Pos[];
    /** A hostage led along (§10.6): a tether from the escort to them. */
    tethers?: { from: Pos; to: Pos }[];
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
    /** A path is previewed or drawn: the floor steps back (fainter) and the path's own tints lead. */
    floorDim?: boolean;
    /** The path's safety (`pathSafety`): each step's tint and the eye on the first unsafe one. */
    pathSafety?: PathVM;
    /** A long-pressed tile's "who and why": the tile marked, each observer's sightline to it. */
    explain?: ExplainVM;
    /** The colour-blind preset (UI.md "Signal palette"). */
    colourBlind?: boolean;
    /** The selected crew member's own tile: what ending the turn there does, drawn round them and as a plate over the head. */
    stay?: FloorTileVM;
    /** Draw only the cones (NPCs' and cameras') of the `reactors`. */
    coneFilter?: boolean;
    /** The observers that react to the selected crew member where they could go (or on the drawn path): whose cones show. */
    reactors?: string[];
    /** Evidence the coming world phase notices (src/game/evidenceWarning.ts): a next-phase plate on each, hatched when uncertain. */
    found?: readonly EvidenceWarning[];
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

/** Move's range: a solid steel blue edge ("your control"). */
const WALK_EDGE = 'rgba(138, 182, 214, 0.9)';
/** Dash's band: a dashed gold edge. */
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
/** Loot's gold. */
const LOOT = '#e8c04a';

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
    get state(): { safeFloor: FloorTileVM[]; floorDim: boolean; pathSafety: PathVM | null; explain: ExplainVM | null; found: { pos: Pos; level: string }[]; badges: number; hearers: number; cones: number; cameras: number; cameraCones: number; flashes: number; colourBlind: boolean; path: Pos[]; reach: number; dashReach: number; range: { walk: Pos[]; run: Pos[] }; dash: boolean; noise: number; witnesses: number; intents: number; loot: Pos[]; throwArc: { from: Pos; to: Pos; caught: boolean } | null; throwRange: Pos[]; rings: { command: number; panic: number; outcomes: { id: string; glyph: string; count?: number | string }[] } | null; holds: number } {
        const c = this.content;
        return {
            safeFloor: c?.safeFloor ?? [], floorDim: !!c?.floorDim, pathSafety: c?.pathSafety ?? null, explain: c?.explain ?? null,
            found: (c?.found ?? []).map(w => ({ pos: w.pos, level: w.level })),
            badges: c?.badges?.length ?? 0, hearers: c?.hearers?.length ?? 0, colourBlind: !!c?.colourBlind,
            // The NPC cones drawn: with `coneFilter`, only the `reactors`'.
            cones: c?.cones?.filter(v => !c.coneFilter || c.reactors?.includes(v.id)).length ?? 0,
            cameras: c?.cameras?.length ?? 0, cameraCones: c?.cameras?.filter(v => v.core.length + v.peripheral.length > 0).length ?? 0, flashes: c?.flashes?.length ?? 0,
            path: c?.path ?? [], reach: c?.reach?.move.length ?? 0, dashReach: c?.reach?.dash.length ?? 0,
            range: { walk: c?.reach?.move ?? [], run: c?.reach?.dash ?? [] }, dash: !!c?.dash, noise: c?.noise?.length ?? 0, witnesses: c?.witnesses?.length ?? 0,
            intents: c?.intents?.length ?? 0,
            loot: (c?.loot ?? []).map(l => l.at), throwArc: c?.throwArc ?? null, throwRange: c?.throwRange ?? [],
            rings: c?.rings ? { command: c.rings.command.length, panic: c.rings.panic.length, outcomes: c.rings.outcomes.map(o => ({ id: o.id, glyph: o.plate.glyph, ...(o.plate.count !== undefined ? { count: o.plate.count } : {}) })) } : null,
            holds: c?.holds?.length ?? 0
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

        const has0 = (tiles: Pos[]) => {
            const set = new Set(tiles.map(p => `${p.x},${p.y}`));
            return (x: number, y: number) => set.has(`${x},${y}`);
        };
        // Loot on the floor: a gold sack (a crate square), outlined in ink.
        for (const l of c.loot ?? []) {
            const [x, y] = mid(l.at), r = S * 0.2;
            ctx.fillStyle = LOOT;
            ctx.strokeStyle = INK;
            ctx.lineWidth = 2;
            ctx.beginPath();
            if (l.crate) ctx.rect(x - r, y - r, 2 * r, 2 * r);
            else {
                ctx.ellipse(x, y + r * 0.3, r, r * 0.9, 0, 0, Math.PI * 2);
                ctx.moveTo(x - r * 0.4, y - r * 0.7);
                ctx.lineTo(x + r * 0.4, y - r * 0.7);
            }
            ctx.fill();
            ctx.stroke();
        }

        if (c.throwRange?.length) {
            // Where the bag could go: a dotted gold contour round the tiles it reaches, inset like the noise ring.
            this.strokeLoops(insetLoops(c.throwRange, withoutHoles(c.throwRange, has0(c.throwRange)), NOISE_INSET / S), alpha(LOOT, 0.75), 1.5, [2, 3], NOISE_RADIUS, ox, oy);
        }
        if (c.throwArc) {
            // The bag's flight (§15.1, UI.md "Bag relay"): its shadow straight along the floor, a dotted arc over it rising
            // with the distance, the bag at the top of the arc, and where it lands: a ring round the teammate who catches
            // it, or a dashed gold square on the floor.
            const [x0, y0] = mid(c.throwArc.from), [x1, y1] = mid(c.throwArc.to);
            const rise = Math.min(1.6 * S, 0.35 * Math.hypot(x1 - x0, y1 - y0) + S * 0.4), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 - 2 * rise;
            ctx.setLineDash([2, 4]);
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(13, 12, 20, 0.45)';
            ctx.beginPath();
            ctx.moveTo(x0, y0 + 4);
            ctx.lineTo(x1, y1 + 4);
            ctx.stroke();
            ctx.setLineDash([4, 4]);
            for (const [colour, dy, width] of [[INK, 2, 4], [LOOT, 0, 2]] as const) {
                ctx.strokeStyle = colour;
                ctx.lineWidth = width;
                ctx.beginPath();
                ctx.moveTo(x0, y0 - 6 + dy);
                ctx.quadraticCurveTo(cx, cy + dy, x1, y1 - 6 + dy);
                ctx.stroke();
            }
            ctx.setLineDash([]);
            // The bag at the top of the arc.
            const bx = (x0 + 2 * cx + x1) / 4, by = (y0 + 2 * cy + y1) / 4 - 6, r = S * 0.16;
            ctx.fillStyle = LOOT;
            ctx.strokeStyle = INK;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(bx, by + r * 0.3, r, r * 0.9, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            if (c.throwArc.caught) {
                for (const [style, dy, width] of [[INK, 2, 4], [pal.safe, 0, 2]] as const) {
                    ctx.strokeStyle = style;
                    ctx.lineWidth = width;
                    ctx.beginPath();
                    ctx.ellipse(x1, y1 + S * 0.25 + dy, S * 0.42, S * 0.2, 0, 0, Math.PI * 2);
                    ctx.stroke();
                }
            } else {
                const l = left(c.throwArc.to), t = top(c.throwArc.to);
                ctx.setLineDash([4, 3]);
                for (const [style, dy] of [[INK, 2], [LOOT, 0]] as const) {
                    ctx.strokeStyle = style;
                    ctx.lineWidth = 2;
                    ctx.strokeRect(l + 4, t + 4 + dy, S - 8, S - 8);
                }
                ctx.setLineDash([]);
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

        // The band edges wait for the cones: those go over the fills, under them.
        let overCones = () => {};
        if (c.reach) {
            // The mover's own tile counts as inside, so the edge doesn't box them in.
            // Tiles with someone lying on them (a dragged body) keep their edge but no tint, so the body shows.
            const bare = has(c.reach.unfilled ?? []);
            const { at } = c.reach, move = c.reach.move, dash = c.reach.dash, inMove = has([...move, ...(at ? [at] : [])]), inAll = has([...move, ...dash, ...(at ? [at] : [])]);
            // The safety fill alone (glyphs come last, over everything on the floor), then one contour per band; until
            // the safe floor arrives (the Dash band a frame after the Move band) a band is its contour alone.
            if (c.safeFloor?.length) this.drawSafeFloor(c.safeFloor.filter(t => !bare(t.pos.x, t.pos.y)), pal, left, top, S, c.floorDim ? 0.5 : 1);
            // Each band's outer edge only: small holes in it (furniture, someone standing) read by having no fill.
            const all = [...move, ...dash, ...(at ? [at] : [])], moved = at ? [...move, at] : move;
            overCones = () => {
                this.strokeRuns(sideRuns(dash, withoutHoles(all, inAll)), RUN_EDGE, 2, [6, 4], ox, oy);
                this.strokeRuns(sideRuns(moved, withoutHoles(moved, inMove)), WALK_EDGE, 2, [], ox, oy);
            };
        }

        // A cone shows when its observer reacts to the selected crew member on the drawn path (any step, its end, the
        // world phase after) or on the stay tile, or with no path anywhere they could go (or the drawer shows all, or it
        // was long-pressed). A hatch is about watchers the crew hasn't seen, so it pulls in no known observer's cone.
        const reacting = new Set(c.reactors ?? []);
        const relevant = (id: string) => !c.coneFilter || reacting.has(id);
        // Cones, NPCs' and cameras' (only those `relevant`): all of them as one area, the tiles any of them sees,
        // outlined inset in pale white (no colour any other layer uses), stronger when someone is Alerted or a camera is
        // on the operator's monitors. A looped camera reports nothing and a panning camera's next facing is still to
        // come, so neither is part of it. Who sees a tile is the long-press's "who and why".
        const views: View[] = [];
        for (const cone of c.cones ?? []) {
            const all = [...cone.core, ...cone.peripheral];
            if (all.length && relevant(cone.id)) views.push({ from: cone.from, tiles: all, strong: cone.alerted });
        }
        for (const cam of c.cameras ?? []) {
            const all = [...cam.core, ...cam.peripheral];
            if (all.length && cam.loopLeft === undefined && relevant(cam.id)) views.push({ from: cam.pos, tiles: all, strong: cam.monitored });
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

        if (c.noise?.length) {
            // No fill (fill is safety's): a rounded contour inset in the tiles in the noise's own colour.
            this.strokeLoops(insetLoops(c.noise, withoutHoles(c.noise, has(c.noise)), NOISE_INSET / S), NOISE, 2, [], NOISE_RADIUS, ox, oy);
        }

        // A command's two rings (§10.1, UI.md "Rings"): the panic ring's outer edge dashed amber, then the command ring's
        // solid steel blue inside it; outlines only (fill is safety's), inset like the noise ring.
        if (c.rings) {
            const all = [...c.rings.command, ...c.rings.panic];
            if (all.length) this.strokeLoops(insetLoops(all, withoutHoles(all, has(all)), NOISE_INSET / S), pal.amber, 2, [6, 4], NOISE_RADIUS, ox, oy);
            if (c.rings.command.length) this.strokeLoops(insetLoops(c.rings.command, withoutHoles(c.rings.command, has(c.rings.command)), (NOISE_INSET + 4) / S), pal.command, 2.5, [], NOISE_RADIUS, ox, oy);
        }
        // Hold rings (§10.3): the room each holder keeps down, dotted steel blue (a hold previewed, brighter).
        for (const hold of c.holds ?? []) {
            if (hold.tiles.length) this.strokeLoops(insetLoops(hold.tiles, withoutHoles(hold.tiles, has(hold.tiles)), (NOISE_INSET + 2) / S), alpha(pal.command, hold.preview ? 1 : 0.8), hold.preview ? 2.5 : 2, [2, 4], NOISE_RADIUS, ox, oy);
        }
        // A hostage led along: a steel-blue tether from the escort's hand.
        for (const t of c.tethers ?? []) {
            const [ax, ay] = mid(t.from), [bx, by] = mid(t.to);
            for (const [style, dy, width] of [[INK, 2, 3], [pal.command, 0, 1.5]] as const) {
                ctx.strokeStyle = style;
                ctx.lineWidth = width;
                ctx.beginPath();
                ctx.moveTo(ax, ay - 8 + dy);
                ctx.lineTo(bx, by - 8 + dy);
                ctx.stroke();
            }
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
            const points = [intent.from, ...intent.path].map(mid);
            const colour = intent.tone ? alpha(pal[intent.tone], intent.predicted ? 0.55 : 0.95) : intent.predicted ? INTENT_PREDICTED : INTENT;
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
        // A hearer's state plate gives way to its ear badge, which says what it will do.
        const hearing = new Set([...(c.hearers ?? []).map(e => e.id), ...(c.rings?.outcomes ?? []).map(o => o.id)]);
        for (const b of c.badges ?? []) Object.assign(row(b.pos, b.lying), { faded: b.faded, pips: b.pips }).plates.push(...(hearing.has(b.id) ? [] : b.plates));
        // The one sent to look also wears the pin (Investigating).
        // Face down (commanded, tied): hears it, stays down.
        for (const e of c.hearers ?? []) row(e.pos, e.lying).plates.push({ glyph: 'speaker', signal: e.signal, ...(e.sym ? { sym: e.sym } : {}), ...(e.sent ? { then: 'pin' as const } : e.still ? { then: 'down' as const } : {}) });
        for (const o of c.rings?.outcomes ?? []) row(o.pos, o.lying).plates.push(o.plate);
        for (const w of c.witnesses ?? []) row(w.pos, w.lying).plates.push(witnessPlate(w));
        for (const cam of c.cameras ?? []) row(cam.pos, true).plates.push(cameraPlate(cam));
        // Evidence the coming world phase notices: a faint dotted line from each certain finder to it, under the plates.
        for (const f of c.found ?? []) {
            if (f.level !== 'certain') continue;
            const [bx, by] = mid(f.pos);
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            for (const finder of f.certain) {
                const [fx, fy] = mid(finder.from);
                for (const [style, dy] of [[INK, 1], [alpha(pal.red, 0.6), 0]] as const) {
                    ctx.strokeStyle = style;
                    ctx.beginPath();
                    ctx.moveTo(fx, fy + dy);
                    ctx.lineTo(bx, by + dy);
                    ctx.stroke();
                }
            }
            ctx.setLineDash([]);
        }
        // Drawn after the floor's glyphs (below), so nothing on the floor covers a plate.
        const overHeads = () => {
            const heights = new Map<string, number>();
            for (const r of rows.values()) {
                const x = Math.round(mid(r.pos)[0]), y = Math.round(top(r.pos)) - (r.lying ? LYING : HEAD);
                ctx.globalAlpha = r.faded ? 0.55 : 1;
                const h = this.drawPlates(r.plates, x, y, pal);
                this.drawPips(r.pips, x, y - h - (h ? 2 : 0), c.crewColours ?? {});
                ctx.globalAlpha = 1;
                heights.set(`${r.pos.x},${r.pos.y}`, h ? h + 2 : 0);
            }
            // Over the body (above its own plates), at the lying height: it is next turn's, so drawn as the stay tile's next plate.
            for (const f of c.found ?? []) {
                const x = Math.round(mid(f.pos)[0]), y = Math.round(top(f.pos)) - LYING - (heights.get(`${f.pos.x},${f.pos.y}`) ?? 0);
                this.drawFound(f, x, y, pal);
            }
        };

        for (const r of c.routes ?? []) this.drawRoute(r, mid, pal);

        if (c.from && c.path?.length && !(c.routeDrag && c.badFrom === undefined)) {
            const points = [c.from, ...c.path].map(mid), bad = c.badFrom ?? Infinity, safety = c.pathSafety;
            // The path's own tints (§8.8 "along the whole drawn path"), at full strength over the dimmed floor; its end
            // as the floor tints it (its glyph with the floor's, below).
            if (safety) {
                for (const step of safety.steps.slice(0, -1)) this.tintTile(step.kind, left(step.pos), top(step.pos), S, pal, 1.25, step.doorRisk);
                this.drawSafeFloor([safety.end], pal, left, top, S, 1.25);
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

        // The floor's glyphs on every tile of the reach, over the floor, cones, paths and intents; the path's own steps
        // show its verdict instead (its tint, the eye plate), its end the path's own glyph.
        const path = c.from && c.path?.length ? c.pathSafety : undefined, end = path?.end;
        const steps = has(path ? path.steps.slice(0, -1).map(t => t.pos) : []), bare = has(c.reach?.unfilled ?? []);
        const tiles = c.reach ? (c.safeFloor ?? []).filter(t => !bare(t.pos.x, t.pos.y) && !steps(t.pos.x, t.pos.y) && !(end && t.pos.x === end.pos.x && t.pos.y === end.pos.y)) : [];
        for (const t of end ? [...tiles, end] : tiles) this.drawGlyph(t, left(t.pos), top(t.pos), S, pal);
        overHeads();
        if (c.stay) this.drawStay(c.stay, left, top, mid, S, pal);

        if (c.explain) this.drawExplain(c.explain, left, top, mid, S, pal);
    }

    /**
     * The crew member's own tile (UI.md "Safe floor"): what ending the turn there does, readable with them standing on
     * it. A band of the move's tint round the tile's edge (the person stays clear; grey hatched when it could be worse
     * than shown), the coming world phase's corner marker in the tile's corner beside them, and over their head the
     * plate of what staying does: the eye with the pips, the hand, the eye or camera with `!`, `?` for unknown risk;
     * the world phase's smaller and fainter, with the corner marker's triangle on it, as staying's verdict is next turn's.
     */
    private drawStay(t: FloorTileVM, left: (p: Pos) => number, top: (p: Pos) => number, mid: (p: Pos) => [number, number], S: number, pal: Record<Signal, string>): void {
        const ctx = this.ctx, x = left(t.pos), y = top(t.pos), colour = this.tintColour(t.now.kind, pal), B = 5;
        const hatched = t.now.kind === 'unknownRisk' || t.doorRisk;
        ctx.beginPath();
        ctx.rect(x, y, S, S);
        ctx.rect(x + B, y + B, S - 2 * B, S - 2 * B);
        ctx.fillStyle = alpha(colour, hatched ? 0.3 : 0.6);
        ctx.fill('evenodd');
        if (hatched) {
            ctx.fillStyle = this.hatch(alpha(t.doorRisk && t.now.kind !== 'unknownRisk' ? GREY : colour, 0.95), 'rgba(13, 12, 20, 0.85)');
            ctx.fill('evenodd');
        }
        ctx.lineWidth = 1;
        ctx.strokeStyle = alpha(colour, 0.95);
        ctx.strokeRect(x + 0.5, y + 0.5, S - 1, S - 1);
        ctx.strokeRect(x + B - 0.5, y + B - 0.5, S - 2 * B + 1, S - 2 * B + 1);
        if (t.next) this.drawNext(t.next, x, y, S, pal);
        const plateOf = (v: PhaseVM): PlateVM | undefined => v.kind === 'amber' ? { glyph: 'eye', signal: 'amber', count: Math.max(1, v.pips) }
            : v.kind === 'trespass' ? { glyph: 'hand', signal: 'amber' }
            : v.kind === 'red' ? { glyph: 'eye', signal: 'red', sym: '!' }
            : v.kind === 'camera' ? { glyph: 'camera', signal: 'red', sym: '!' }
            : v.kind === 'unknownRisk' ? { glyph: 'eye', signal: 'cream', sym: '?' } : undefined;
        const px = Math.round(mid(t.pos)[0]), py = Math.round(y) - HEAD - 2, now = plateOf(t.now), next = t.next && plateOf(t.next);
        let h = 0;
        if (now) h = this.drawPlates([now], px, py, pal) + 2;
        if (next) {
            // Next turn's: three-quarters size and fainter, the corner marker's triangle in its corner.
            const k = 0.75, ny = py - h;
            ctx.save();
            ctx.globalAlpha = 0.8;
            ctx.translate(px, ny);
            ctx.scale(k, k);
            const w = this.platesWidth([next]);
            this.drawPlates([next], 0, 0, pal);
            ctx.fillStyle = this.tintColour(t.next!.kind, pal);
            ctx.beginPath();
            ctx.moveTo(w / 2 + 3, -7);
            ctx.lineTo(w / 2 + 3, 1);
            ctx.lineTo(w / 2 - 5, 1);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
    }

    /**
     * Evidence the coming world phase notices (UI.md "Evidence"), centred on x with its bottom at y: next turn's plate as
     * the stay tile draws it (three-quarters size, the corner marker's triangle in its corner), the eye in red with `!`
     * when a known NPC or camera finds it for certain; with `?` and the triangle hatched when someone could.
     */
    private drawFound(w: EvidenceWarning, x: number, y: number, pal: Record<Signal, string>): void {
        const ctx = this.ctx, certain = w.level === 'certain', plate: PlateVM = { glyph: 'eye', signal: 'red', sym: certain ? '!' : '?' }, k = 0.75;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(k, k);
        const half = this.platesWidth([plate]) / 2;
        this.drawPlates([plate], 0, 0, pal);
        ctx.beginPath();
        ctx.moveTo(half + 3, -7);
        ctx.lineTo(half + 3, 1);
        ctx.lineTo(half - 5, 1);
        ctx.closePath();
        ctx.fillStyle = certain ? pal.red : this.hatch(alpha(pal.red, 0.95), 'rgba(13, 12, 20, 0.85)');
        ctx.fill();
        ctx.restore();
    }

    /**
     * The coming world phase's verdict on a tile, when worse than the move's (UI.md "Safe floor"): a right triangle in
     * the tile's bottom-right corner, 40% of its edge, in that verdict's colour over a dark edge, with a mini glyph in
     * ink inside it (the eye, the hand, the camera, or a square per pip), so shape carries it as well as colour.
     */
    private drawNext(v: PhaseVM, x: number, y: number, S: number, pal: Record<Signal, string>): void {
        const ctx = this.ctx, L = Math.round(S * 0.42), r = x + S, b = y + S, colour = this.tintColour(v.kind, pal);
        ctx.beginPath();
        ctx.moveTo(r, b - L);
        ctx.lineTo(r, b);
        ctx.lineTo(r - L, b);
        ctx.closePath();
        ctx.fillStyle = alpha(colour, 0.85);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(13, 12, 20, 0.8)';
        ctx.beginPath();
        ctx.moveTo(r - 0.5, b - L - 0.5);
        ctx.lineTo(r - L - 0.5, b - 0.5);
        ctx.stroke();
        const ink = 'rgba(13, 12, 20, 0.95)';
        if (v.kind === 'amber') {
            const n = Math.max(1, Math.min(3, v.pips));
            ctx.fillStyle = ink;
            // Packed into the corner: along the bottom, then up the side.
            for (const [dx, dy] of [[4, 4], [7, 4], [4, 7]].slice(0, n)) ctx.fillRect(r - dx!, b - dy!, 2, 2);
            return;
        }
        const mini = v.kind === 'red' ? NEXT_GLYPHS.eye : v.kind === 'trespass' ? NEXT_GLYPHS.hand : v.kind === 'camera' ? NEXT_GLYPHS.camera : undefined;
        if (mini) drawRows(ctx, mini, r - 1 - mini[0]!.length, b - 1 - mini.length, ink, false);
    }

    /**
     * Views (cones), all as one area: exactly the tiles any of the watchers sees (the rules' own fields, `ConeVM` and
     * `CameraVM`, and the tile each stands on when a tile it sees is beside it, so it closes round them; a camera whose
     * view starts diagonally gets no ring of its own), as one closed outline inset in those tiles with
     * rounded corners like the noise ring: it never sits on a band's edge or a tile's, and a tile is inside it exactly
     * when someone shown sees it. A lone view gets a faint fade from its watcher outwards (8% to nothing at its furthest
     * tile); then a thin edge over a dark under-stroke, thinner than the band edges, which are drawn over it.
     */
    private drawViews(views: readonly View[], mid: (p: Pos) => [number, number], S: number, ox: number, oy: number): void {
        if (!views.length) return;
        const ctx = this.ctx, px = (p: Corner): [number, number] => [(p.x * TILE - ox) * UI_SCALE, (p.y * TILE - this.lift(p.tile.x, p.tile.y) - oy) * UI_SCALE];
        const seen = new Map<string, Pos>();
        for (const v of views) {
            const joined = v.tiles.some(t => Math.abs(t.x - v.from.x) + Math.abs(t.y - v.from.y) === 1);
            for (const p of joined ? [...v.tiles, v.from] : v.tiles) seen.set(`${p.x},${p.y}`, p);
        }
        const loops = insetLoops([...seen.values()], (x, y) => seen.has(`${x},${y}`), VIEW_INSET / S);
        if (!loops.length) return;
        this.loopPath(loops, VIEW_RADIUS, px);
        const only = views.length === 1 ? views[0] : undefined;
        if (only) {
            const [cx, cy] = mid(only.from), range = Math.max(...only.tiles.map(p => Math.hypot(p.x - only.from.x, p.y - only.from.y))) + 0.5;
            const fade = ctx.createRadialGradient(cx, cy, 0, cx, cy, range * S);
            fade.addColorStop(0, alpha(VIEW, 0.08));
            fade.addColorStop(1, alpha(VIEW, 0));
            ctx.fillStyle = fade;
            // Even-odd, so a hole (a tile not seen inside the view) stays unwashed.
            ctx.fill('evenodd');
        }
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(13, 12, 20, 0.55)';
        ctx.stroke();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = alpha(VIEW, views.some(v => v.strong) ? 0.9 : 0.65);
        ctx.stroke();
    }

    /** Chained sides (`sideRuns`) stroked over a 1px ink drop shadow, each side at its own tile's lift. */
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

    /** Closed inset loops (`insetLoops`) stroked over an ink shadow, their corners rounded by `radius` UI pixels. */
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
    /** The width a row of plates takes (`drawPlates`). */
    private platesWidth(plates: readonly PlateVM[]): number {
        const widthOf = (p: PlateVM) => 4 + glyphSize(GLYPHS[p.glyph]).w + (p.count !== undefined ? 4 + numberWidth(String(p.count)) : 0)
            + (p.sym ? 3 + numberWidth(p.sym) : 0) + (p.then ? 3 + glyphSize(GLYPHS[p.then]).w : 0) + 4;
        return plates.reduce((w, p) => w + widthOf(p), 0) + 2 * (plates.length - 1);
    }

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
     * (`doorRisk`) has the same grey hatch over it, glyph and all: the hatch means only "could be worse than shown".
     * A flat fill whichever band (the band's edge says which). The tint and glyph are the move's own; the coming world
     * phase's, when worse, is a corner marker (`drawNext`). This draws the fills; the glyphs go over the rest of the
     * floor (`drawGlyph`). `strength` scales the fill (a dimmed floor while a path leads).
     */
    private drawSafeFloor(tiles: readonly FloorTileVM[], pal: Record<Signal, string>, left: (p: Pos) => number, top: (p: Pos) => number, S: number, strength = 1): void {
        for (const t of tiles) this.tintTile(t.now.kind, left(t.pos), top(t.pos), S, pal, strength, t.doorRisk);
    }

    /**
     * A safe-floor tile's glyph (see `drawSafeFloor`) on the tile at (x, y), the move's own, on a dark plate so it reads
     * on any tint, and the coming world phase's corner marker when that is worse.
     */
    private drawGlyph(t: FloorTileVM, x: number, y: number, S: number, pal: Record<Signal, string>): void {
        const ctx = this.ctx, kind = t.now.kind, colour = this.tintColour(kind, pal);
        if (t.next) this.drawNext(t.next, x, y, S, pal);
        // Unknown risk has no glyph: its grey hatch (a shape, not only a colour) says it.
        if (kind === 'unknownRisk') return;
        const glyph: GlyphName | undefined = kind === 'trespass' ? 'hand' : kind === 'red' ? 'eye' : kind === 'camera' ? 'camera' : undefined;
        if (glyph) {
            const g = glyphSize(GLYPHS[glyph]);
            // A small dark plate under the glyph, so it reads on any tint.
            ctx.fillStyle = 'rgba(12, 11, 15, 0.78)';
            ctx.fillRect(x + Math.floor((S - g.w) / 2) - 2, y + Math.floor((S - g.h) / 2) - 2, g.w + 4, g.h + 4);
            drawRows(ctx, GLYPHS[glyph], x + Math.floor((S - g.w) / 2), y + Math.floor((S - g.h) / 2), colour);
        } else if (kind === 'amber') {
            // The pips, centred, on the same plate.
            const n = Math.max(1, Math.min(3, t.now.pips)), x0 = x + Math.round(S / 2 - (n * 7 - 3) / 2), py = y + S / 2 - 2;
            ctx.fillStyle = 'rgba(12, 11, 15, 0.78)';
            ctx.fillRect(x0 - 3, py - 3, n * 7 + 3, 10);
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
     * Fills one tile with a tint (see `drawSafeFloor`): a flat fill in the safety colour; unknown risk fainter under its
     * hatch, two-tone lines (a dark pixel beside each grey one, so it reads on pale floors too, where a grey hatch alone
     * fades into the pavement: it has no glyph to fall back on); the same grey hatch over the tint when a door could make
     * it worse (`doorRisk`). The hatch is anchored to the canvas, so it runs on across neighbouring tiles.
     */
    private tintTile(kind: TintKind, x: number, y: number, S: number, pal: Record<Signal, string>, strength: number, doorRisk = false): void {
        const ctx = this.ctx, unknown = kind === 'unknownRisk';
        const a = (kind === 'safe' ? 0.26 : kind === 'grey' || unknown ? 0.3 : 0.5) * strength;
        ctx.fillStyle = alpha(this.tintColour(kind, pal), a * (unknown ? 0.3 : 0.7));
        ctx.fillRect(x, y, S, S);
        if (unknown || doorRisk) {
            const ink = Math.min(1, 0.45 * strength);
            ctx.fillStyle = this.hatch(alpha(GREY, ink), `rgba(13, 12, 20, ${(ink * 0.9).toFixed(3)})`);
            ctx.fillRect(x, y, S, S);
        }
    }

    /** The hatch's patterns, made once per colour pair. */
    private readonly patterns = new Map<string, CanvasPattern | string>();

    /** The hatch: lines at 45° every 6 UI pixels, a pixel of `colour` beside a `dark` one. */
    private hatch(colour: string, dark = INK): CanvasPattern | string {
        const key = `${colour} ${dark}`;
        let found = this.patterns.get(key);
        if (found) return found;
        const tile = document.createElement('canvas');
        tile.width = tile.height = 6;
        const t = tile.getContext('2d')!;
        t.fillStyle = colour;
        for (let k = 0; k < 6; k++) t.fillRect((6 - k) % 6, k, 1, 1);
        t.fillStyle = dark;
        for (let k = 0; k < 6; k++) t.fillRect((7 - k) % 6, k, 1, 1);
        found = this.ctx.createPattern(tile, 'repeat') ?? colour;
        this.patterns.set(key, found);
        return found;
    }
}
