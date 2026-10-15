import Phaser from 'phaser';
import { PAL } from '../../art/palette';
import { TILE } from '../../level/constants';
import { mapZoom, nearestStep, zoomSteps } from '../../logic/zoom';
import { CameraControls } from '../../ui/CameraControls';

/** Arrow keys pan this many screen pixels a second, whatever the zoom. */
const PAN_SPEED = 480;
/** The tactical map keeps this many CSS pixels clear round the plot. */
const MAP_MARGIN = 8;
/** The camera opens on the lobby, about this many tiles high. */
const START_TILES = 17;
/** Act view (§20.1): selecting a crew member zooms in to about this many tiles high if the view is wider. */
const ACT_TILES = 13;
/** The vignette over the view (keep `strength` low: Phaser's goes near black at its radius). */
const VIGNETTE = { x: 0.5, y: 0.5, radius: 1, strength: 0.16 };
/** How many of the renderer's drawing contexts (the camera's filters draw through them) `prepareActView` makes. */
const ACT_CONTEXTS = 3;

/**
 * The bank's camera (§20.1). Zoom steps are whole screen pixels per art pixel: the canvas renders at the screen's size
 * over the zoom, and the camera's middle can reach every tile. Drag pans, as do the arrow keys; the wheel, a pinch, the
 * buttons and +/- zoom; M or the Map button shows the whole plot.
 */
export class BankCamera {
    private controls?: CameraControls;
    private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
    /** The screen's size in device pixels. */
    private screen = { width: 0, height: 0 };
    /** Screen pixels per art pixel: the zoom (§20.1). The canvas renders at the screen's size over this. */
    private zoom = 1;
    /** The camera's vignette: it is worked out over the whole canvas, so a camera in its corner moves and shrinks it. */
    private vignette?: Phaser.Filters.Vignette;
    /** The zoom the canvas was last sized for (0: not yet); a closer zoom keeps it (see `applyZoom`). */
    private canvasZoom = 0;
    /** The whole-number zooms that fit this screen, widest first. */
    private zoomLevels: number[] = [];
    /** While the tactical map shows: the view to go back to. */
    private mapView?: { zoom: number; x: number; y: number };
    /** The fingers' spread, in screen pixels, when the pinch last zoomed. */
    private pinch?: number;
    /** Where the dragging pointer was, in screen pixels: game pixels change size with the zoom, screen pixels don't. */
    private dragFrom?: { x: number; y: number };
    /**
     * Where each pointer that is down last was, in screen pixels from the canvas's corner. Read from the browser's event,
     * not from Phaser's pointer: Phaser converts every finger of a touch event to game pixels before handling any of
     * them, so when one finger's move zooms, the other's position is already in the old zoom's pixels.
     */
    private readonly held = new Map<number, { x: number; y: number }>();
    /** While this says so, a single finger's drag doesn't pan: it belongs to someone else (play mode's path drawing). */
    holdPan?: () => boolean;
    /** Told whenever the tactical map is shown or left. */
    onMapChange?: (on: boolean) => void;

    /**
     * For the plot of `width` by `height` map pixels. `buttons` adds the HTML zoom and map buttons; play mode leaves them
     * out, its HUD having the map button where UI.md puts it.
     */
    constructor(private readonly scene: Phaser.Scene, private readonly width: number, private readonly height: number, private readonly buttons = true) {}

    /** Whether the tactical map shows. */
    get onMap(): boolean {
        return !!this.mapView;
    }

    /** The zoom and its steps, whether the map shows, and where the plot shows in CSS pixels from the canvas's corner. */
    get state(): { zoom: number; zoomLevels: number[]; map: boolean; plot: { left: number; top: number; right: number; bottom: number } } {
        return { zoom: this.zoom, zoomLevels: this.zoomLevels, map: this.onMap, plot: this.plotOnScreen() };
    }

    /** Opens on map point (x, y), about `START_TILES` high, and takes the input. */
    setup(x: number, y: number): void {
        const { scene } = this, cam = scene.cameras.main;
        cam.setBackgroundColor(PAL.void).setRoundPixels(true);
        Phaser.Actions.AddEffectBloom(cam, { threshold: 0.62, blurRadius: 2, blurSteps: 4, blendAmount: 0.6 });
        this.vignette = cam.filters.external.addVignette(VIGNETTE.x, VIGNETTE.y, VIGNETTE.radius, VIGNETTE.strength);
        this.fitScreen();
        this.applyZoom(nearestStep(this.zoomLevels, this.screen.height, TILE, START_TILES), true);
        cam.centerOn(x, y);

        const onResize = () => this.fitScreen();
        window.addEventListener('resize', onResize);
        if (this.buttons) this.controls = new CameraControls({ zoomIn: () => this.zoomStep(1), zoomOut: () => this.zoomStep(-1), toggleMap: () => this.toggleMap() });
        scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            window.removeEventListener('resize', onResize);
            this.controls?.destroy();
        });

        const { input } = scene;
        this.cursors = input.keyboard?.createCursorKeys();
        input.keyboard?.on('keydown', (e: KeyboardEvent) => {
            if (e.key === '+' || e.key === '=') this.zoomStep(1);
            else if (e.key === '-' || e.key === '_') this.zoomStep(-1);
            else if (e.key === 'm' || e.key === 'M') this.toggleMap();
        });
        input.on(Phaser.Input.Events.POINTER_WHEEL, (p: Phaser.Input.Pointer, ...rest: [unknown, number, number]) => this.zoomStep(rest[2] > 0 ? -1 : 1, p.x, p.y));
        // A drag starts where a single pointer goes down; a second finger, or lifting one, starts over.
        const screenAt = (p: Phaser.Input.Pointer) => {
            const e = p.event as MouseEvent | TouchEvent, box = scene.game.canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
            const at = 'changedTouches' in e ? [...e.touches, ...e.changedTouches].find(t => t.identifier === p.identifier) : e;
            if (!at) throw new Error(`No touch ${p.identifier} in the event for pointer ${p.id}`);
            return { x: (at.clientX - box.left) * ratio, y: (at.clientY - box.top) * ratio };
        };
        const restart = () => {
            const down = [...this.held.values()];
            this.pinch = undefined;
            this.dragFrom = down.length === 1 ? down[0] : undefined;
        };
        input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
            this.held.set(p.id, screenAt(p));
            restart();
        });
        input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => {
            this.held.delete(p.id);
            restart();
        });
        input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
            if (!p.isDown || !this.held.has(p.id)) return;
            const at = screenAt(p);
            this.held.set(p.id, at);
            const fingers = [...this.held.values()];
            if (fingers.length >= 2) {
                // A pinch zooms a step each time the fingers' spread changes by a quarter from where it last zoomed.
                const [a, b] = fingers as [{ x: number; y: number }, { x: number; y: number }];
                const spread = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
                this.pinch ??= spread;
                if (spread > this.pinch * 1.25 || spread < this.pinch * 0.8) {
                    this.zoomStep(spread > this.pinch ? 1 : -1, (a.x + b.x) / 2 / this.zoom, (a.y + b.y) / 2 / this.zoom);
                    this.pinch = spread;
                }
                return;
            }
            if (this.dragFrom && !this.holdPan?.()) {
                cam.scrollX -= (at.x - this.dragFrom.x) / this.zoom;
                cam.scrollY -= (at.y - this.dragFrom.y) / this.zoom;
            }
            this.dragFrom = at;
        });
    }

    /** Pans by the arrow keys held, for `dt` seconds. */
    update(dt: number): void {
        if (this.cursors) {
            const cam = this.scene.cameras.main;
            const dx = (this.cursors.right.isDown ? 1 : 0) - (this.cursors.left.isDown ? 1 : 0);
            const dy = (this.cursors.down.isDown ? 1 : 0) - (this.cursors.up.isDown ? 1 : 0);
            cam.scrollX += (dx * PAN_SPEED * dt) / this.zoom;
            cam.scrollY += (dy * PAN_SPEED * dt) / this.zoom;
        }
    }

    /**
     * Zooms one step in (1) or out (-1), keeping the map point under canvas point (sx, sy) where it is. On the tactical
     * map, zooming in goes back to the view before it.
     */
    zoomStep(direction: 1 | -1, sx?: number, sy?: number): void {
        const cam = this.scene.cameras.main;
        if (this.mapView) {
            if (direction > 0) this.toggleMap();
            return;
        }
        const index = this.zoomLevels.indexOf(this.zoom);
        const next = this.zoomLevels[Math.max(0, Math.min(this.zoomLevels.length - 1, index + direction))]!;
        if (next === this.zoom) return;
        // The map point under (sx, sy) stays there: it sits at the same fraction of the screen before and after.
        const fx = (sx ?? cam.width / 2) / cam.width, fy = (sy ?? cam.height / 2) / cam.height;
        const wx = cam.scrollX + fx * cam.width, wy = cam.scrollY + fy * cam.height;
        this.applyZoom(next);
        cam.setScroll(wx - fx * cam.width, wy - fy * cam.height);
    }

    /** Shows the tactical map of the whole plot, with every wall cut down, or goes back to the view before it. */
    toggleMap(): void {
        const cam = this.scene.cameras.main;
        if (this.mapView) {
            const { zoom, x, y } = this.mapView;
            this.mapView = undefined;
            // The screen may have changed size while the map showed, and with it the steps.
            this.applyZoom(this.zoomLevels.includes(zoom) ? zoom : nearestStep(this.zoomLevels, this.screen.height, TILE, this.screen.height / zoom / TILE));
            cam.centerOn(x, y);
        } else {
            this.mapView = { zoom: this.zoom, x: cam.midPoint.x, y: cam.midPoint.y };
            this.showPlot();
        }
        this.controls?.showMap(!!this.mapView);
        this.onMapChange?.(!!this.mapView);
    }

    /** Where the camera looks, as a save keeps it: on the tactical map, the view it goes back to. */
    get view(): { x: number; y: number; zoom: number; map: boolean } {
        if (this.mapView) return { ...this.mapView, map: true };
        const mid = this.scene.cameras.main.midPoint;
        return { x: mid.x, y: mid.y, zoom: this.zoom, map: false };
    }

    /** Goes back to a saved view: its zoom (the nearest step if this screen has no such step), its middle and the map. */
    restore(zoom: number, x: number, y: number, map = false): void {
        this.mapView = undefined;
        this.applyZoom(this.zoomLevels.includes(zoom) ? zoom : nearestStep(this.zoomLevels, this.screen.height, TILE, this.screen.height / zoom / TILE), true);
        this.scene.cameras.main.centerOn(x, y);
        if (map) this.toggleMap();
        else this.onMapChange?.(false);
    }

    /**
     * Act view (§20.1): centres on map point (x, y), first zooming in to about `ACT_TILES` high if the view is further
     * out (leaving the tactical map); a closer view stays as close and pans there over `ms`.
     */
    actView(x: number, y: number, ms = 0): void {
        if (this.mapView) this.toggleMap();
        const act = nearestStep(this.zoomLevels, this.screen.height, TILE, ACT_TILES);
        if (this.zoom < act) {
            this.applyZoom(act);
            this.scene.cameras.main.centerOn(x, y);
        } else this.centreOn(x, y, ms);
    }

    /** Map point (x, y) moved so a view centred on it stays on the plot along any axis the plot is wider than the view. */
    clampToPlot(x: number, y: number): [number, number] {
        const cam = this.scene.cameras.main;
        const clamp = (v: number, view: number, size: number) => (size > view ? Math.min(size - view / 2, Math.max(view / 2, v)) : v);
        return [clamp(x, cam.width, this.width), clamp(y, cam.height, this.height)];
    }

    /** Moves the view so map point (x, y) is in the middle: at once, or panning over `ms`. Leaves the tactical map first. */
    centreOn(x: number, y: number, ms = 0): void {
        if (this.mapView) this.toggleMap();
        const cam = this.scene.cameras.main;
        if (ms > 0) cam.pan(x, y, ms, 'Sine.easeInOut', true);
        else cam.centerOn(x, y);
    }

    /** Centres the vignette on the camera's part of the canvas, `fx` by `fy` of it from its top-left corner. */
    private fitVignette(fx: number, fy: number): void {
        const v = this.vignette;
        if (!v) return;
        v.x = VIGNETTE.x * fx;
        v.y = VIGNETTE.y * fy;
        v.radius = VIGNETTE.radius * fx;
    }

    /** After the canvas's CSS scale changed: where it is on the page, and canvas pixels per CSS pixel, for the input. */
    private updateInput(): void {
        const { scale } = this.scene;
        scale.updateBounds();
        scale.displayScale.set(scale.baseSize.width / scale.canvasBounds.width, scale.baseSize.height / scale.canvasBounds.height);
    }

    /**
     * Readies Act view while the bank builds, so the first selection doesn't stall (see `applyZoom`): the drawing
     * contexts the camera's filters (bloom, vignette) need at its size, which the renderer pools by size, and the shader
     * that copies a camera smaller than the canvas onto it, compiled and drawn once. Each would wait for the GPU.
     */
    prepareActView(): void {
        const renderer = this.scene.game.renderer;
        if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) return;
        const act = nearestStep(this.zoomLevels, this.screen.height, TILE, ACT_TILES);
        if (act <= this.zoom || !Number.isInteger(act) || !Number.isInteger(this.zoom)) return;
        const pool = renderer.drawingContextPool, width = Math.round(this.screen.width / act), height = Math.round(this.screen.height / act);
        const made = Array.from({ length: ACT_CONTEXTS }, () => pool.get(width, height));
        const [target, source] = made as [Phaser.Renderer.WebGL.DrawingContext, Phaser.Renderer.WebGL.DrawingContext];
        const copy = renderer.renderNodes.getNode('BatchHandlerQuadSingle') as Phaser.Renderer.WebGL.RenderNodes.BatchHandlerQuadSingle | null;
        if (copy && source.texture) {
            target.use();
            const options = { alphaStrategy: target.alphaStrategy, smoothPixelArt: !!renderer.game.config.smoothPixelArt };
            copy.batch(target, source.texture, 0, height, 0, 0, width, height, width, 0, 0, 1, 1, -1, 0, 0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff,
                options as Phaser.Types.Renderer.WebGL.RenderNodes.BatchHandlerQuadRenderOptions);
            renderer.renderNodes.finishBatch();
        }
        for (const context of made) {
            context.lastUsed = Date.now();
            pool.add(context);
        }
    }

    /** The plot's rectangle on screen, in CSS pixels from the canvas's top-left corner. */
    private plotOnScreen(): { left: number; top: number; right: number; bottom: number } {
        // The scroll, not the world view, which only catches up when the camera next renders.
        const { scrollX, scrollY } = this.scene.cameras.main, scale = this.zoom / (window.devicePixelRatio || 1);
        return { left: -scrollX * scale, top: -scrollY * scale, right: (this.width - scrollX) * scale, bottom: (this.height - scrollY) * scale };
    }

    /** Measures the screen in device pixels (its CSS size times the pixel ratio) and works out the zoom steps that fit it. */
    private fitScreen(): void {
        const parent = this.scene.game.canvas.parentElement;
        if (!parent) throw new Error('The game canvas has no parent to fill');
        const ratio = window.devicePixelRatio || 1;
        this.screen = { width: Math.round(parent.clientWidth * ratio), height: Math.round(parent.clientHeight * ratio) };
        this.zoomLevels = zoomSteps(this.screen.height, TILE);
        if (this.mapView) {
            this.showPlot();
            return;
        }
        const zoom = this.zoomLevels.includes(this.zoom) ? this.zoom : nearestStep(this.zoomLevels, this.screen.height, TILE, this.screen.height / this.zoom / TILE);
        const mid = this.scene.cameras.main.midPoint;
        const [x, y] = [mid.x, mid.y];
        this.applyZoom(zoom, true);
        this.scene.cameras.main.centerOn(x, y);
    }

    /**
     * The tactical map: the whole plot at the zoom that fits it in the screen below the HTML across its top (the
     * generator bar), a margin clear of the edges, and centred in that area.
     */
    private showPlot(): void {
        const ratio = window.devicePixelRatio || 1, margin = MAP_MARGIN * ratio, top = this.coveredTop() + margin;
        const zoom = mapZoom(this.screen.width - 2 * margin, this.screen.height - top - margin, this.width, this.height);
        this.applyZoom(zoom, true);
        // The middle of the free area lies (top - margin) / 2 screen pixels below the middle of the screen.
        this.scene.cameras.main.centerOn(this.width / 2, this.height / 2 - (top - margin) / 2 / zoom);
    }

    /** How far down the canvas, in device pixels, the generator bar reaches. The hand-made example bank has none. */
    private coveredTop(): number {
        // The generator bar, or play mode's HUD strip.
        const bar = document.querySelector('.generator-bar') ?? document.querySelector('.sh-top');
        if (!bar) return 0;
        const ratio = window.devicePixelRatio || 1;
        return Math.max(0, bar.getBoundingClientRect().bottom - this.scene.game.canvas.getBoundingClientRect().top) * ratio;
    }

    /**
     * Zooms by rendering the canvas at the screen's size over `zoom`: the browser scales it up by a whole number, so the
     * art stays crisp, and a closer view draws fewer pixels. The EXPAND scale mode sizes the canvas from the game config's
     * base size on every refresh, so that is what changes; EXPAND still follows the screen's aspect ratio. Only the
     * tactical map goes below 1; there the browser scales the canvas down smoothly, since dropping whole rows and
     * columns of pixels would break up the thin walls and railings.
     *
     * Resizing a WebGL canvas waits for the GPU to finish every frame queued before it (60–120 ms in the sandbox's
     * software renderer), so a whole-number zoom closer than the canvas is sized for keeps the canvas (unless `exact`):
     * the camera draws into its top-left corner at the closer zoom's size, and a CSS scale from that corner makes each
     * canvas pixel `zoom` screen pixels; the rest of the canvas lies off the screen. Selecting a crew member zooms in to
     * Act view (§20.1) this way. Zooming out past the canvas, the tactical map, a new screen size, the opening view and
     * a restored one size it afresh.
     */
    private applyZoom(zoom: number, exact = false): void {
        const { game, scale } = this.scene, canvas = game.canvas;
        this.zoom = zoom;
        const interpolation = Phaser.Display.Canvas.CanvasInterpolation;
        if (zoom < 1) interpolation.setBicubic(canvas);
        else interpolation.setCrisp(canvas);
        const config = game.config as unknown as { width: number; height: number };
        const width = Math.round(this.screen.width / zoom), height = Math.round(this.screen.height / zoom);
        const cam = this.scene.cameras.main;
        if (!exact && zoom > this.canvasZoom && this.canvasZoom >= 1 && Number.isInteger(this.canvasZoom) && Number.isInteger(zoom)) {
            Object.assign(canvas.style, { transformOrigin: '0 0', transform: `scale(${(zoom * scale.width) / this.screen.width}, ${(zoom * scale.height) / this.screen.height})` });
            this.updateInput();
            cam.setSize(width, height);
            this.fitVignette(width / scale.width, height / scale.height);
        } else {
            const scaled = canvas.style.transform !== '';
            canvas.style.transform = '';
            this.canvasZoom = zoom;
            if (config.width !== width || config.height !== height) {
                config.width = width;
                config.height = height;
                scale.refresh();
            } else if (scaled) this.updateInput();
            cam.setSize(scale.width, scale.height);
            this.fitVignette(1, 1);
        }
        // The middle of the screen can reach every tile; past the map's edge is the void.
        cam.setBounds(-cam.width / 2, -cam.height / 2, this.width + cam.width, this.height + cam.height);
    }
}
