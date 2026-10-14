import Phaser from 'phaser';
import { bakeLighting, LampReach, lightBlockers, LIT, roomLamps, tileLight, windowPatches, type Exposure, type Lamp } from '../art/bank/lamps';
import { buildExposure, buildLightMaps, farFront, streetFront, type Caster, type Occluder } from '../art/bank/lightmap';
import { LOOKS, person, PERSON_HEIGHT } from '../art/bank/people';
import { propArt, type PropArt } from '../art/bank/props';
import { BANK_TILE_INDEX, bankTileset, type BankTileName } from '../art/bank/tiles';
import { doorSill, wallArt, wallLook, wallMargin } from '../art/bank/walls';
import { deepen, mix, PAL } from '../art/palette';
import { PixelBitmap, toCanvas } from '../art/PixelBitmap';
import { bayer4, mulberry32, valueNoise } from '../art/random';
import { BANK_PEOPLE, BANK_PLAN, BANK_PROPS, BANK_ROOMS } from '../level/bank';
import { propBox, propSize } from '../level/catalog';
import { TILE } from '../level/level';
import { floorHeight, isOffMap, isOutdoors, parsePlan, type Level, type LevelPerson, type LevelProp, type PersonFacing as Facing } from '../level/plan';
import { baseLine, PERSON_SIZE, px, WALL_STEPS, type Box } from '../level/space';
import { wallFootprint, type Footprint, type Wall } from '../level/walls';
import { mapZoom, nearestStep, zoomSteps } from '../logic/zoom';
import { CameraControls } from '../ui/CameraControls';

const KEY = { floor: 'bank-floor', walls: 'bank-walls', shade: 'bank-shade', glow: 'bank-glow', clouds: 'bank-clouds', mote: 'bank-mote', shadow: 'person-shadow' } as const;

/**
 * Mid-morning. Everything is lit at half exposure, ambient being half the sun on the street, and baked (lamps.ts):
 * lamps blocked by walls, then exposed for where each thing stands, outdoors doubled and indoors the building's shade.
 */
const AMBIENT = 0x8a8274;
/** The cloud shadow pattern's size; it repeats seamlessly. */
const CLOUD_TILE = 256;
const DEPTH = { floor: 0, shade: 2, sunFloor: 3, shadows: 4, standing: 10, haze: 1910, emissive: 1920, clouds: 1930, motes: 1940 } as const;
/** Arrow keys pan this many screen pixels a second, whatever the zoom. */
const PAN_SPEED = 480;
/** The camera opens on the lobby, about this many tiles high. */
const START_TILES = 17;
const ATLAS_WIDTH = 1024;

/**
 * Walls the camera looks past are cut down. A wall stands full height while its base line is at least `STAND_ABOVE`
 * pixels above the middle of the screen, and is cut once it is less than `CUT_ABOVE` above it; in between it keeps its
 * height, so nudging the camera doesn't make walls flicker. A changing wall moves one step of `WALL_STEPS` every `STEP_MS`.
 */
const STAND_ABOVE = 16;
const CUT_ABOVE = 4;
const STEP_MS = 40;

/** Dressing that matters for play stays in view on a cut wall, as a marker of where it is. */
const ALWAYS_SHOWN: LevelProp['kind'][] = ['camera', 'keycardLed', 'alarmPanel'];

/** People walk at about 1.4m/s and wait this long at each end of a patrol. */
const WALK_SPEED = px(1.4);
const PATROL_WAIT_MS = 1500;

/**
 * A person on screen: their drawing (and its normals) for each facing, the texture their lit sprite is written into,
 * the image and drop shadow that follow them, where they stand (the middle of their footprint, in map pixels) and,
 * when they patrol, how far along they are.
 */
interface PersonSprite {
    person: LevelPerson;
    views: Record<Facing, { bitmap: PixelBitmap; normals: Uint8ClampedArray }>;
    texture: Phaser.Textures.CanvasTexture;
    image: Phaser.GameObjects.Image;
    shadow: Phaser.GameObjects.Image;
    x: number;
    y: number;
    facing: Facing;
    /** Mean brightness of the lit sprite (0-255), so tests can see the light change. */
    light: number;
    patrol?: { from: [number, number]; to: [number, number]; t: number; out: boolean; wait: number };
}

/** A prop placed in the level, with its art for the way it faces. */
interface PlacedProp { p: LevelProp; box: Box; art: PropArt; left: number; top: number }

/** A wall segment on screen: the step it is drawn at, the step it is heading for, and what hangs on it. */
interface WallSprite {
    wall: Wall;
    image: Phaser.GameObjects.Image;
    /** Its frame in the wall atlas for each of `WALL_STEPS`. */
    frames: string[];
    base: number;
    step: number;
    target: number;
    /** Outer walls with nothing behind them always stand. */
    standing: boolean;
    /** Part of the street front, whose height the cloud shadows' top follows. */
    front: boolean;
    /** Part of the front across the street, whose height the cloud shadows' bottom follows. */
    far: boolean;
    dressing: { top: number; images: Phaser.GameObjects.Image[] }[];
}

/**
 * The example bank and its block (bank.ts): the street, the bank with its neighbours, the alley behind. No rules yet,
 * just the look, the people and the camera. Depth follows each object's base line, so walls, furniture and people
 * overlap correctly in the ¾ view. Walls stand on the edges between tiles; those north of the middle of the screen
 * stand full height as the backdrop, the rest are cut down so nothing the camera is looking at hides behind them.
 *
 * Camera (§20.1): drag or the arrow keys to pan; the mouse wheel, a pinch, the + and − buttons or keys to zoom in
 * whole-number steps between about 11 and 34 tiles high; Map (or M) for the tactical map of the whole plot.
 */
export class BankScene extends Phaser.Scene {
    private level!: Level;
    private lamps: Lamp[] = [];
    private reach!: LampReach;
    private exposure!: ReturnType<typeof buildExposure>;
    private litTiles: boolean[][] = [];
    private people: PersonSprite[] = [];
    private readonly casters: Caster[] = [];
    private walls: WallSprite[] = [];
    private wallClock = 0;
    private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
    /** Cloud shadows: a pre-tiled image, shifted and cropped as they drift (a TileSprite showed seams under MULTIPLY). */
    private clouds: Phaser.GameObjects.Image[] = [];
    private cloudDrift = { x: 0, y: 0 };
    /** Where the cloud shadows start: the top of the street front, so they fall on it and on the street. */
    private cloudTop = 0;
    /**
     * Where they stop: the top of the front across the street, whose face we see from inside. Beyond it they go on only
     * over the open ground (`cloudSpans`, pixel ranges across the map) either side of the building.
     */
    private cloudBottom = 0;
    private cloudSpans: [number, number][] = [];
    private controls?: CameraControls;
    /** The screen's size in device pixels. */
    private screen = { width: 0, height: 0 };
    /** Screen pixels per art pixel: the zoom (§20.1). The canvas renders at the screen's size over this. */
    private zoom = 1;
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
    private held = new Map<number, { x: number; y: number }>();
    private mapWidth = 0;
    private mapHeight = 0;

    constructor() {
        super('bank');
    }

    create(): void {
        this.level = parsePlan(BANK_PLAN);
        this.walls = [];
        this.people = [];
        this.mapView = undefined;
        this.mapWidth = this.level.tiles[0]!.length * TILE;
        this.mapHeight = this.level.tiles.length * TILE;

        const props = BANK_PROPS.map((p): PlacedProp => {
            const box = propBox(p, this.level.walls), art = propArt(p, propSize(p), box.facing);
            return { p, box, art, left: box.x - art.originX, top: baseLine(box) - box.z - art.lit.height };
        });
        const far = farFront(this.level);
        this.lamps = [
            ...roomLamps(BANK_ROOMS), ...windowPatches(this.level, streetFront(this.level).line), ...(far ? windowPatches(this.level, far.line, 'south') : []),
            ...props.flatMap(propLamps)
        ];
        this.reach = new LampReach(lightBlockers(this.level), this.lamps);
        this.exposure = buildExposure(this.level);
        this.litTiles = tileLight(this.level, this.lamps, this.reach).map(row => row.map(light => light >= LIT));

        this.buildFloor(props.filter(({ box }) => box.h === 0));
        this.buildWalls();
        const occluders = this.buildProps(props.filter(({ box }) => box.h > 0));
        this.buildPeople();
        this.buildLightMaps(occluders);
        this.casters.length = 0;
        this.buildAtmosphere();
        this.setupCamera();
        this.updateWalls(0);
        for (const w of this.walls) this.setWallStep(w, w.target);
    }

    override update(): void {
        // Real time since the last frame. Phaser's smoothed delta is capped at 60fps's for its first 120 frames and while
        // the window is out of focus, so on a slow device everything would crawl; a long pause still counts as a short one.
        const deltaMs = Math.min(this.game.loop.rawDelta, 100), dt = deltaMs / 1000;
        this.cloudDrift.x += dt * 4;
        this.cloudDrift.y += dt * 1.5;
        this.placeClouds();
        if (this.cursors) {
            const cam = this.cameras.main;
            const dx = (this.cursors.right.isDown ? 1 : 0) - (this.cursors.left.isDown ? 1 : 0);
            const dy = (this.cursors.down.isDown ? 1 : 0) - (this.cursors.up.isDown ? 1 : 0);
            cam.scrollX += (dx * PAN_SPEED * dt) / this.zoom;
            cam.scrollY += (dy * PAN_SPEED * dt) / this.zoom;
        }
        for (const p of this.people) if (p.patrol) this.walk(p, deltaMs);
        this.updateWalls(deltaMs);
    }

    /** Exposed so automated tests can frame shots without reaching into private fields. */
    get debugState() {
        const cam = this.cameras.main;
        return {
            ready: true, width: this.mapWidth, height: this.mapHeight, lamps: this.lamps.length,
            zoom: this.zoom, zoomLevels: this.zoomLevels, tilesHigh: cam.height / TILE, map: !!this.mapView,
            midX: cam.midPoint.x, midY: cam.midPoint.y,
            /** Which tiles lamp light reaches, for the rules: rows of '#' (lit) and '.'. */
            lit: this.litTiles.map(row => row.map(lit => (lit ? '#' : '.')).join('')),
            people: this.people.map(p => ({ look: p.person.look, x: p.x, y: p.y, facing: p.facing, light: p.light })),
            walls: this.walls.map(w => ({ kind: w.wall.kind, run: w.wall.run, tx: w.wall.tx, ty: w.wall.ty, height: WALL_STEPS[w.step]! }))
        };
    }

    /** Moves the camera so the given map pixel is centred; for tests and screenshots. */
    lookAt(x: number, y: number): void {
        this.cameras.main.centerOn(x, y);
    }

    /**
     * Zooms one step in (1) or out (-1), keeping the map point under canvas point (sx, sy) where it is. On the tactical
     * map, zooming in goes back to the view before it.
     */
    zoomStep(direction: 1 | -1, sx?: number, sy?: number): void {
        const cam = this.cameras.main;
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
        const cam = this.cameras.main;
        if (this.mapView) {
            const { zoom, x, y } = this.mapView;
            this.mapView = undefined;
            this.applyZoom(zoom);
            cam.centerOn(x, y);
        } else {
            this.mapView = { zoom: this.zoom, x: cam.midPoint.x, y: cam.midPoint.y };
            this.applyZoom(mapZoom(this.screen.width, this.screen.height, this.mapWidth, this.mapHeight));
            cam.centerOn(this.mapWidth / 2, this.mapHeight / 2);
        }
        this.controls?.showMap(!!this.mapView);
    }

    /**
     * Stands person `index` with the middle of their footprint at map point (x, y), facing `facing`, and relights them:
     * only their own sprite, by the lamps that reach where they now stand. People cast nothing into the baked maps, so
     * nothing else changes.
     */
    movePerson(index: number, x: number, y: number, facing?: Facing): void {
        const p = this.people[index];
        if (!p) throw new Error(`No person ${index} in the bank`);
        p.x = x;
        p.y = y;
        if (facing) p.facing = facing;
        const box: Box = { x: Math.round(x - PERSON_SIZE.w / 2), y: Math.round(y - PERSON_SIZE.d / 2), z: 0, ...PERSON_SIZE, facing: 'south' };
        const { bitmap, normals } = p.views[p.facing];
        const left = Math.round(box.x + box.w / 2 - bitmap.width / 2), top = baseLine(box) - PERSON_HEIGHT;
        const lit = bakeLighting(bitmap, left, top, AMBIENT, this.lamps, this.reachingAny(footprintPoints(box)), this.standingAt(x, y), normals);
        p.texture.context.putImageData(new ImageData(new Uint8ClampedArray(lit), bitmap.width, bitmap.height), 0, 0);
        p.texture.refresh();
        p.image.setPosition(left, top).setDepth(DEPTH.standing + baseLine(box));
        p.shadow.setPosition(box.x + box.w / 2, box.y + box.d / 2);
        p.light = meanBrightness(lit);
    }

    /** Walks a patrolling person along their line, waiting at each end; they are moved (and relit) only when they cross a pixel or turn. */
    private walk(p: PersonSprite, deltaMs: number): void {
        const patrol = p.patrol!;
        if (patrol.wait > 0) {
            patrol.wait -= deltaMs;
            return;
        }
        const [fx, fy] = patrol.from, [tx, ty] = patrol.to;
        const length = Math.hypot(tx - fx, ty - fy);
        patrol.t += ((patrol.out ? 1 : -1) * WALK_SPEED * deltaMs) / 1000 / length;
        const heading = patrol.out ? ty - fy : fy - ty;
        if (patrol.t >= 1 || patrol.t <= 0) {
            patrol.t = Math.min(1, Math.max(0, patrol.t));
            patrol.out = !patrol.out;
            patrol.wait = PATROL_WAIT_MS;
        }
        const x = Math.round(fx + (tx - fx) * patrol.t), y = Math.round(fy + (ty - fy) * patrol.t);
        const facing: Facing = heading > 0 ? 'front' : heading < 0 ? 'back' : p.facing;
        if (x !== p.x || y !== p.y || facing !== p.facing) this.movePerson(this.people.indexOf(p), x, y, facing);
    }

    /**
     * Picks each wall's height from where the camera looks (on the tactical map every wall is cut, so the plan reads)
     * and moves changing walls a step towards it every `STEP_MS`.
     */
    private updateWalls(deltaMs: number): void {
        const middle = this.cameras.main.midPoint.y, top = WALL_STEPS.length - 1;
        for (const w of this.walls) {
            if (w.standing) w.target = top;
            else if (this.mapView) w.target = 0;
            else if (w.base < middle - STAND_ABOVE) w.target = top;
            else if (w.base > middle - CUT_ABOVE) w.target = 0;
        }
        this.wallClock += deltaMs;
        while (this.wallClock >= STEP_MS) {
            this.wallClock -= STEP_MS;
            let moving = false;
            for (const w of this.walls) if (w.step !== w.target) {
                this.setWallStep(w, w.step + Math.sign(w.target - w.step));
                moving = true;
            }
            if (!moving) this.wallClock = 0;
        }
    }

    private setWallStep(w: WallSprite, step: number): void {
        w.step = step;
        const height = WALL_STEPS[step]!;
        w.image.setFrame(w.frames[step]!);
        for (const d of w.dressing) for (const image of d.images) image.setVisible(d.top <= height);
        // Cloud shadows fall on the street and the fronts, not on the floor seen over a cut-down front, nor on the inside
        // of the front across the street.
        if (w.front) this.cloudTop = wallFootprint(w.wall).y - height;
        if (w.far) this.cloudBottom = wallFootprint(w.wall).y - height;
        if (w.front || w.far) this.placeClouds();
    }

    /** Shifts the cloud shadows by their drift, within one tile of the pattern, and crops them to the open ground and the fronts. */
    private placeClouds(): void {
        if (!this.clouds.length) return;
        const ox = Phaser.Math.Wrap(this.cloudDrift.x, 0, CLOUD_TILE), oy = Phaser.Math.Wrap(this.cloudDrift.y, 0, CLOUD_TILE);
        const x = ox - CLOUD_TILE, y = oy - CLOUD_TILE;
        const rects = [
            { x: 0, y: this.cloudTop, w: this.mapWidth, h: this.cloudBottom - this.cloudTop },
            ...this.cloudSpans.map(([x0, x1]) => ({ x: x0, y: this.cloudBottom, w: x1 - x0, h: this.mapHeight - this.cloudBottom }))
        ];
        rects.forEach((r, i) => this.clouds[i]!.setPosition(x, y).setCrop(r.x - x, r.y - y, r.w, r.h));
    }

    /** The floor of every tile; walls stand on top of it along the edges. */
    private tileName(x: number, y: number): BankTileName {
        const tiles = this.level.tiles, t = tiles[y]![x]!;
        const variant = (n: number) => (Math.imul(x * 73856093 ^ y * 19349663, 0x9e3779b1) >>> 0) % n;
        switch (t) {
            case 'x': return 'offMap';
            case ',': return (['linoleum0', 'linoleum1'] as const)[variant(2)]!;
            case '.': return (['marble0', 'marble1', 'marble2'] as const)[variant(3)]!;
            case '=': return tiles[y]![x - 1] === '=' ? 'runnerRight' : 'runnerLeft';
            case 'q': return variant(2) ? 'concrete1' : 'concrete0';
            case 'v': return 'steelPlate';
            case 't': return 'whiteTile';
            case 'f': return y % 2 ? 'floorboards1' : 'floorboards0';
            case 'u': return variant(2) ? 'dusty1' : 'dusty0';
            case 'a': return variant(6) === 0 ? 'alley1' : 'alley0';
            case 's': return (['sidewalkTL', 'sidewalkTR', 'sidewalkBL', 'sidewalkBR'] as const)[(x % 2) + (y % 2) * 2]!;
            case 'c': return tiles[y - 1]?.[x] === 'r' ? 'curbFar' : 'curb';
            case 'm': return variant(2) ? 'granite1' : 'granite0';
            case 'n': return (x + y) % 2 ? 'officeCarpet1' : 'officeCarpet0';
            case 'h': return variant(2) ? 'concrete1' : 'concrete0';
            case 'z': return 'stairs';
            case 'y': return variant(2) ? 'pavers1' : 'pavers0';
            case 'r': return variant(5) === 0 ? 'road1' : 'road0';
            case 'l': return x % 2 === 0 ? 'roadDash' : 'roadGap';
        }
    }

    /**
     * The floor as one image: every tile, with flat props (mats, a manhole cover) laid into it, lit per pixel by the
     * lamps that reach it and exposed for indoors or out.
     */
    private buildFloor(flat: PlacedProp[]): void {
        const tiles = bankTileset(), floor = new PixelBitmap(this.mapWidth, this.mapHeight);
        this.level.tiles.forEach((row, y) => row.forEach((_, x) => {
            const index = BANK_TILE_INDEX[this.tileName(x, y)];
            for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
                floor.set(x * TILE + i, y * TILE + j, tiles.color(index * TILE + i, j), tiles.heightAt(index * TILE + i, j));
            }
        }));
        // Thresholds under the doors in north-south walls: seen side-on, the door itself barely shows.
        for (const wall of this.level.walls) {
            const sill = doorSill(wall), f = wallFootprint(wall);
            if (sill !== undefined) for (let y = f.y + 1; y < f.y + f.d - 1; y++) for (let x = f.x - 3; x < f.x + f.w + 3; x++) {
                const edge = x === f.x - 3 || x === f.x + f.w + 2 || y === f.y + f.d - 2;
                floor.set(x, y, edge ? mix(sill, PAL.ink, 0.45) : sill, 1);
            }
        }
        this.drawRaisedEdges(floor);
        for (const { art, left, top } of flat) floor.stamp(art.lit, left, top);
        this.addBaked(KEY.floor, floor, 0, 0, (lamp, x, y) => this.reach.reaches(lamp, x, y), (x, y) => this.exposureAt(x, y)).setDepth(DEPTH.floor);
    }

    /**
     * The edges of raised tiles and stairs where they drop to lower floor with no wall between (§14.7): seen from the
     * south, a drop on a raised tile's south side shows the slab's face, nosing on top, a shadow at its foot; on its east
     * or west side it throws a shadow on the lower floor and catches the light along its lip.
     */
    private drawRaisedEdges(floor: PixelBitmap): void {
        const { tiles, walls } = this.level;
        const closed = new Set(walls.filter(w => w.kind !== 'rail').map(w => `${w.run} ${w.tx} ${w.ty}`));
        const shadow = (x: number, y: number, amount: number) => floor.set(x, y, deepen(floor.color(x, y), amount), 0.3);
        tiles.forEach((row, ty) => row.forEach((_, tx) => {
            const h = floorHeight(tiles, tx, ty);
            if (!h) return;
            const lower = (nx: number, ny: number) => tiles[ny]?.[nx] !== undefined && floorHeight(tiles, nx, ny) < h;
            const x0 = tx * TILE, y0 = ty * TILE;
            // Within a flight, the steps drawn on the tiles already show the climb.
            const flight = tiles[ty]![tx] === 'z' && tiles[ty + 1]?.[tx] === 'z';
            if (lower(tx, ty + 1) && !flight && !closed.has(`eastWest ${tx} ${ty + 1}`)) {
                const drop = h - floorHeight(tiles, tx, ty + 1), face = Math.max(2, Math.min(4, Math.round(drop / 10)));
                for (let x = x0; x < x0 + TILE; x++) {
                    floor.set(x, y0 + TILE, PAL.concrete[5], 0.8);
                    for (let k = 1; k < face; k++) floor.set(x, y0 + TILE + k, k === face - 1 ? PAL.concrete[1] : PAL.concrete[2], 0.5);
                    shadow(x, y0 + TILE + face, 0.45);
                    shadow(x, y0 + TILE + face + 1, 0.2);
                }
            }
            for (const [dx, edge] of [[-1, tx], [1, tx + 1]] as const) {
                if (!lower(tx + dx, ty) || closed.has(`northSouth ${edge} ${ty}`)) continue;
                const lip = dx < 0 ? x0 : x0 + TILE - 1, foot = dx < 0 ? x0 - 1 : x0 + TILE;
                for (let y = y0; y < y0 + TILE; y++) {
                    floor.set(lip, y, PAL.concrete[5], 0.8);
                    shadow(foot, y, 0.45);
                    shadow(foot + dx, y, 0.2);
                }
            }
            if (lower(tx, ty - 1) && !closed.has(`eastWest ${tx} ${ty}`)) for (let x = x0; x < x0 + TILE; x++) floor.set(x, y0, PAL.concrete[5], 0.8);
        }));
    }

    /** The exposure at a floor point (clamped to the map). */
    private exposureAt(x: number, y: number): readonly [number, number, number] {
        const { width, height, rgb } = this.exposure;
        const i = (Math.min(height - 1, Math.max(0, Math.floor(y))) * width + Math.min(width - 1, Math.max(0, Math.floor(x)))) * 3;
        return [rgb[i]!, rgb[i + 1]!, rgb[i + 2]!];
    }

    /** The exposure of something standing at floor point (x, y), the same for all of it however tall it is drawn. */
    private standingAt(x: number, y: number): Exposure {
        const e = this.exposureAt(x, y);
        return () => e;
    }

    /** Makes texture `key`: `bitmap` drawn at (left, top), lit the way Light2D would light it by the lamps `reaches` lets through, then exposed. */
    private bake(key: string, bitmap: PixelBitmap, left: number, top: number, reaches: (lamp: Lamp, x: number, y: number) => boolean, exposure: Exposure): string {
        if (!this.textures.exists(key)) this.textures.addCanvas(key, toCanvas(bakeLighting(bitmap, left, top, AMBIENT, this.lamps, reaches, exposure), bitmap.width, bitmap.height));
        return key;
    }

    private addBaked(key: string, bitmap: PixelBitmap, left: number, top: number, reaches: (lamp: Lamp, x: number, y: number) => boolean, exposure: Exposure): Phaser.GameObjects.Image {
        return this.add.image(left, top, this.bake(key, bitmap, left, top, reaches, exposure)).setOrigin(0, 0);
    }

    /** Lamps reaching any of `points` on the floor: how a standing object is lit, by what can see where it stands. */
    private reachingAny(points: [number, number][]): (lamp: Lamp) => boolean {
        const seen = new Map<Lamp, boolean>();
        return lamp => {
            let reached = seen.get(lamp);
            if (reached === undefined) seen.set(lamp, reached = points.some(([x, y]) => this.reach.reaches(lamp, x, y)));
            return reached;
        };
    }

    /**
     * One image per wall segment, standing on its footprint's south edge and ordered by it. Each segment is baked at each
     * of its heights, lit by the lamps on its open sides and exposed for the side it faces; all of them share one atlas.
     */
    private buildWalls(): void {
        const { tiles, walls } = this.level;
        const { walls: front, line } = streetFront(this.level), far = farFront(this.level)?.walls ?? [];
        const fresh = !this.textures.exists(KEY.walls);
        const pieces: { frame: string; rgba: Uint8ClampedArray; w: number; h: number }[] = [];
        const placed = walls.map((wall, i) => {
            const look = wallLook(wall, walls), f = wallFootprint(wall), base = f.y + f.d;
            const sides = wallSides(wall, f), reaches = this.reachingAny(sides);
            const [ex, ey] = sides.find(([x, y]) => !isOffMap(tiles[Math.floor(y / TILE)]?.[Math.floor(x / TILE)] ?? 'x')) ?? sides[0]!;
            const exposure = this.standingAt(ex, ey);
            const frames = WALL_STEPS.map(height => {
                const frame = `${i}-${height}`;
                if (fresh) {
                    const art = wallArt(wall, look, height);
                    pieces.push({ frame, rgba: bakeLighting(art, f.x - wallMargin(wall), base - art.height, AMBIENT, this.lamps, reaches, exposure), w: art.width, h: art.height });
                }
                return frame;
            });
            return { wall, f, base, frames };
        });
        if (fresh) this.packAtlas(KEY.walls, pieces);
        for (const { wall, f, base, frames } of placed) {
            const image = this.add.image(f.x - wallMargin(wall), base, KEY.walls, frames[0]!).setOrigin(0, 1).setDepth(DEPTH.standing + base);
            const north = wall.run === 'eastWest' ? tiles[wall.ty - 1]?.[wall.tx] : undefined;
            // The fronts on the street, and the piers at its ends that front tiles off the map, move as one.
            const isFront = front.includes(wall) || (wall.run === 'eastWest' && wall.ty * TILE === line);
            this.walls.push({
                wall, image, frames, base, step: 0, target: 0, dressing: [],
                standing: !isFront && (north === undefined || isOffMap(north)),
                front: isFront,
                far: far.includes(wall)
            });
        }
    }

    /** Packs baked pieces into one texture in rows, a pixel apart, each a named frame. */
    private packAtlas(key: string, pieces: { frame: string; rgba: Uint8ClampedArray; w: number; h: number }[]): void {
        let x = 0, y = 0, row = 0;
        const spots = pieces.map(p => {
            if (x + p.w > ATLAS_WIDTH) {
                x = 0;
                y += row + 1;
                row = 0;
            }
            const spot = { x, y };
            x += p.w + 1;
            row = Math.max(row, p.h);
            return spot;
        });
        const canvas = document.createElement('canvas');
        canvas.width = ATLAS_WIDTH;
        canvas.height = y + row;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No 2D context to pack the wall atlas with');
        pieces.forEach((p, i) => context.putImageData(new ImageData(new Uint8ClampedArray(p.rgba), p.w, p.h), spots[i]!.x, spots[i]!.y));
        const texture = this.textures.addCanvas(key, canvas);
        if (!texture) throw new Error(`Failed to create texture '${key}'`);
        pieces.forEach((p, i) => texture.add(p.frame, 0, spots[i]!.x, spots[i]!.y, p.w, p.h));
    }

    /**
     * Places every standing prop by its box (catalog size, level placement): its bitmap's bottom edge on the box's front
     * edge at the box's elevation, drawn in order of that front edge, lit by the lamps that reach its footprint and
     * exposed for where it stands. Returns the floor footprints that shade and block the sun.
     */
    private buildProps(props: PlacedProp[]): Occluder[] {
        const occluders: Occluder[] = [];
        props.forEach(({ p, box, art, left, top }, i) => {
            const key = `bank-prop-${i}`, depth = DEPTH.standing + baseLine(box);
            const images = [this.addBaked(key, art.lit, left, top, this.reachingAny(footprintPoints(box)), this.standingAt(box.x + box.w / 2, box.y + box.d / 2)).setDepth(depth)];
            this.casters.push(caster(art.lit, left, top, baseLine(box)));
            if (hasPixels(art.glow)) {
                if (!this.textures.exists(`${key}-glow`)) art.glow.addTo(this.textures, `${key}-glow`);
                images.push(this.add.image(left, top, `${key}-glow`).setOrigin(0, 0).setDepth(depth + 0.5));
                // A second, additive pass makes screens and lamps glow into the bloom.
                images.push(this.add.image(left, top, `${key}-glow`).setOrigin(0, 0).setDepth(DEPTH.emissive).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.45));
            }
            if (box.z === 0) occluders.push(floorOccluder(box));
            if (box.z > 0 && !ALWAYS_SHOWN.includes(p.kind)) this.hangOnWall(box, images);
        });
        return occluders;
    }

    /** Dressing hung on the face of an east-west wall goes out of view while that wall is cut below its top. */
    private hangOnWall(box: Box, images: Phaser.GameObjects.Image[]): void {
        const wall = this.walls.find(w => w.wall.run === 'eastWest' && w.base === box.y && w.image.x < box.x + box.w && w.image.x + TILE > box.x);
        if (!wall) throw new Error(`Nothing to hang the dressing at (${box.x}, ${box.y}) on`);
        wall.dressing.push({ top: box.z + box.h, images });
    }

    /**
     * People stand in the middle of their tile: the sprite's soles on the front edge of their box, centred across it.
     * They move, so they cast nothing into the baked maps (no sun shadow, no gap in a shaft), only their drop shadow, and
     * each has a texture of their own that `movePerson` relights wherever they stand.
     */
    private buildPeople(): void {
        if (!this.textures.exists(KEY.shadow)) personShadow().addTo(this.textures, KEY.shadow);
        BANK_PEOPLE.forEach((p, i) => {
            const spec = LOOKS[p.look];
            if (!spec) throw new Error(`No look named '${p.look}'`);
            const view = (facing: Facing) => {
                const bitmap = person(spec, facing);
                return { bitmap, normals: bitmap.normalMap() };
            };
            const views = { front: view('front'), back: view('back') };
            const key = `person-${i}`, { width, height } = views.front.bitmap;
            const texture = this.textures.exists(key) ? (this.textures.get(key) as Phaser.Textures.CanvasTexture) : this.textures.createCanvas(key, width, height);
            if (!texture) throw new Error(`Failed to create texture '${key}'`);
            const x = (p.tx + 0.5) * TILE, y = (p.ty + 0.5) * TILE;
            this.people.push({
                person: p, views, texture, x, y, facing: p.facing, light: 0,
                image: this.add.image(0, 0, key).setOrigin(0, 0),
                shadow: this.add.image(0, 0, KEY.shadow).setDepth(DEPTH.shadows).setAlpha(0.55),
                patrol: p.patrol && { from: [x, y], to: [(p.patrol.tx + 0.5) * TILE, (p.patrol.ty + 0.5) * TILE], t: 0, out: true, wait: PATROL_WAIT_MS }
            });
            this.movePerson(i, x, y);
        });
    }

    private buildLightMaps(occluders: Occluder[]): void {
        const maps = buildLightMaps(this.level, occluders, this.casters);
        if (!this.textures.exists(KEY.shade)) this.textures.addCanvas(KEY.shade, toCanvas(maps.shade, maps.width, maps.height));
        if (!this.textures.exists(KEY.glow)) this.textures.addCanvas(KEY.glow, toCanvas(maps.glow, maps.width, maps.height));
        this.add.image(0, 0, KEY.shade).setOrigin(0, 0).setDepth(DEPTH.shade).setBlendMode(Phaser.BlendModes.MULTIPLY);
        this.add.image(0, 0, KEY.glow).setOrigin(0, 0).setDepth(DEPTH.sunFloor).setBlendMode(Phaser.BlendModes.ADD);
        // The same shafts, faint, over everything: the light in the air that also falls on people standing in it.
        this.add.image(0, 0, KEY.glow).setOrigin(0, 0).setDepth(DEPTH.haze).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.35);
    }

    private buildAtmosphere(): void {
        const front = streetFront(this.level).line;
        if (!this.textures.exists(KEY.clouds)) this.textures.addCanvas(KEY.clouds, tiled(cloudCanvas(CLOUD_TILE), this.mapWidth + CLOUD_TILE, this.mapHeight + CLOUD_TILE));
        // Slow cloud shadows drifting over the street and the fronts; their top follows the fronts' height. Across the
        // street they stop at the far front and carry on over the open ground beside it.
        const far = farFront(this.level), row = far ? this.level.tiles[far.line / TILE]! : [];
        this.cloudSpans = [];
        row.forEach((t, x) => {
            if (!isOutdoors(t)) return;
            const span = this.cloudSpans.at(-1);
            if (span && span[1] === x * TILE) span[1] += TILE;
            else this.cloudSpans.push([x * TILE, (x + 1) * TILE]);
        });
        this.clouds = Array.from({ length: 1 + this.cloudSpans.length }, () => this.add.image(0, 0, KEY.clouds).setOrigin(0, 0).setDepth(DEPTH.clouds).setBlendMode(Phaser.BlendModes.MULTIPLY));
        this.cloudTop = front;
        this.cloudBottom = far?.line ?? this.mapHeight;
        this.placeClouds();

        if (!this.textures.exists(KEY.mote)) {
            const mote = new PixelBitmap(1, 1);
            mote.set(0, 0, 0xfff2d0, 1);
            mote.addTo(this.textures, KEY.mote);
        }
        // Dust drifting in the sun shafts just inside the glass.
        this.add.particles(0, 0, KEY.mote, {
            x: { min: TILE, max: this.mapWidth - TILE },
            y: { min: front - 4 * TILE, max: front - 4 },
            lifespan: 5000,
            speedX: { min: -2, max: 2 },
            speedY: { min: -3, max: 1 },
            alpha: { start: 0, end: 0, ease: (t: number) => Math.sin(t * Math.PI) * 0.45 },
            quantity: 1,
            frequency: 60,
            blendMode: Phaser.BlendModes.ADD
        }).setDepth(DEPTH.motes);
    }

    /**
     * Zoom steps are whole screen pixels per art pixel (§20.1): the canvas renders at the screen's size over the zoom, and
     * the camera's middle can reach every tile. Drag pans, as do the arrow keys; the wheel, a pinch, the buttons and +/- zoom; M
     * or the Map button shows the whole plot.
     */
    private setupCamera(): void {
        const cam = this.cameras.main;
        cam.setBackgroundColor(PAL.void).setRoundPixels(true);
        Phaser.Actions.AddEffectBloom(cam, { threshold: 0.62, blurRadius: 2, blurSteps: 4, blendAmount: 0.6 });
        cam.filters.external.addVignette(0.5, 0.5, 1, 0.16);
        this.fitScreen();
        this.applyZoom(nearestStep(this.zoomLevels, this.screen.height, TILE, START_TILES));
        cam.centerOn(30 * TILE, 21 * TILE);

        const onResize = () => this.fitScreen();
        window.addEventListener('resize', onResize);
        this.controls = new CameraControls({ zoomIn: () => this.zoomStep(1), zoomOut: () => this.zoomStep(-1), toggleMap: () => this.toggleMap() });
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            window.removeEventListener('resize', onResize);
            this.controls?.destroy();
        });

        this.cursors = this.input.keyboard?.createCursorKeys();
        this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
            if (e.key === '+' || e.key === '=') this.zoomStep(1);
            else if (e.key === '-' || e.key === '_') this.zoomStep(-1);
            else if (e.key === 'm' || e.key === 'M') this.toggleMap();
        });
        this.input.on(Phaser.Input.Events.POINTER_WHEEL, (p: Phaser.Input.Pointer, ...rest: [unknown, number, number]) => this.zoomStep(rest[2] > 0 ? -1 : 1, p.x, p.y));
        // A drag starts where a single pointer goes down; a second finger, or lifting one, starts over.
        const screenAt = (p: Phaser.Input.Pointer) => {
            const e = p.event as MouseEvent | TouchEvent, box = this.game.canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
            const at = 'changedTouches' in e ? [...e.touches, ...e.changedTouches].find(t => t.identifier === p.identifier) : e;
            if (!at) throw new Error(`No touch ${p.identifier} in the event for pointer ${p.id}`);
            return { x: (at.clientX - box.left) * ratio, y: (at.clientY - box.top) * ratio };
        };
        const restart = () => {
            const down = [...this.held.values()];
            this.pinch = undefined;
            this.dragFrom = down.length === 1 ? down[0] : undefined;
        };
        this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
            this.held.set(p.id, screenAt(p));
            restart();
        });
        this.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => {
            this.held.delete(p.id);
            restart();
        });
        this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
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
            if (this.dragFrom) {
                cam.scrollX -= (at.x - this.dragFrom.x) / this.zoom;
                cam.scrollY -= (at.y - this.dragFrom.y) / this.zoom;
            }
            this.dragFrom = at;
        });
    }

    /** Measures the screen in device pixels (its CSS size times the pixel ratio) and works out the zoom steps that fit it. */
    private fitScreen(): void {
        const parent = this.game.canvas.parentElement;
        if (!parent) throw new Error('The game canvas has no parent to fill');
        const ratio = window.devicePixelRatio || 1;
        this.screen = { width: Math.round(parent.clientWidth * ratio), height: Math.round(parent.clientHeight * ratio) };
        this.zoomLevels = zoomSteps(this.screen.height, TILE);
        const zoom = this.mapView ? mapZoom(this.screen.width, this.screen.height, this.mapWidth, this.mapHeight)
            : this.zoomLevels.includes(this.zoom) ? this.zoom : nearestStep(this.zoomLevels, this.screen.height, TILE, this.screen.height / this.zoom / TILE);
        const mid = this.cameras.main.midPoint;
        const [x, y] = [mid.x, mid.y];
        this.applyZoom(zoom);
        this.cameras.main.centerOn(x, y);
    }

    /**
     * Zooms by rendering the canvas at the screen's size over `zoom`: the browser scales it up by a whole number, so the
     * art stays crisp, and a closer view draws fewer pixels. The EXPAND scale mode sizes the canvas from the game config's
     * base size on every refresh, so that is what changes; EXPAND still follows the screen's aspect ratio.
     */
    private applyZoom(zoom: number): void {
        this.zoom = zoom;
        const config = this.game.config as unknown as { width: number; height: number };
        const width = Math.round(this.screen.width / zoom), height = Math.round(this.screen.height / zoom);
        if (config.width !== width || config.height !== height) {
            config.width = width;
            config.height = height;
            this.scale.refresh();
        }
        const cam = this.cameras.main;
        cam.setSize(this.scale.width, this.scale.height);
        // The middle of the screen can reach every tile; past the map's edge is the void.
        cam.setBounds(-cam.width / 2, -cam.height / 2, this.mapWidth + cam.width, this.mapHeight + cam.height);
    }
}

/**
 * The lights a prop gives off (banker's lamps, screens, the exit sign) as lamps: placed where the art puts them, at
 * Light2D's default height, spreading from the prop's footprint.
 */
function propLamps({ box, art, left, top }: PlacedProp): Lamp[] {
    return art.lights.map(l => ({ x: left + l.x, y: top + l.y, z: l.radius * 0.1, radius: l.radius, color: l.color, intensity: l.intensity, from: { x: left + l.x, y: box.y + box.d / 2 } }));
}

/** Floor points across a footprint: its middle and towards each end, so a long counter is lit by lamps along it. */
function footprintPoints(box: Box): [number, number][] {
    const y = box.y + box.d / 2;
    return [[box.x + box.w / 2, y], [box.x + Math.min(4, box.w / 2), y], [box.x + box.w - Math.min(4, box.w / 2), y]];
}

/** Floor points beside a wall segment: in front of an east-west wall, either side (east first) of a north-south one. */
function wallSides(wall: Wall, f: Footprint): [number, number][] {
    if (wall.run === 'eastWest') return [2, 8, 14].map(u => [f.x + u, f.y + f.d + 0.5]);
    return [[f.x + f.w + 0.5, f.y + 8], [f.x - 0.5, f.y + 8]];
}

/** Mean brightness (0-255) of the opaque pixels of RGBA colours. */
function meanBrightness(rgba: Uint8ClampedArray): number {
    let total = 0, count = 0;
    for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3]! > 0) { total += (rgba[i]! + rgba[i + 1]! + rgba[i + 2]!) / 3; count++; }
    return count ? total / count : 0;
}

function hasPixels(bitmap: PixelBitmap): boolean {
    for (let y = 0; y < bitmap.height; y++) for (let x = 0; x < bitmap.width; x++) if (bitmap.opaque(x, y)) return true;
    return false;
}

function caster(bitmap: PixelBitmap, left: number, top: number, base: number): Caster {
    return { left, top, width: bitmap.width, height: bitmap.height, base, opaque: (x, y) => bitmap.opaque(x, y) };
}

/** Something standing on the floor shades its footprint and blocks the sun up to its height. */
function floorOccluder(box: Box): Occluder {
    return { x: box.x, y: box.y, w: box.w, h: box.d, height: box.h };
}

function personShadow(): PixelBitmap {
    const b = new PixelBitmap(12, 5);
    b.ellipse(6, 2.5, 6, 2.5, 0x0d0c14, 0);
    return b;
}

/** A canvas of `width` by `height` covered with copies of `tile`. */
function tiled(tile: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = ctx.createPattern(tile, 'repeat')!;
    ctx.fillRect(0, 0, width, height);
    return canvas;
}

/** Cloud shadow: two octaves of smooth noise cut into two flat levels, dithered only along the edge; about a third in shadow. */
function cloudCanvas(size: number): HTMLCanvasElement {
    const rand = mulberry32(23);
    const broad = valueNoise(rand, 4), fine = valueNoise(rand, 8);
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const n = 0.7 * broad(x / size, y / size) + 0.3 * fine(x / size, y / size);
        const edge = (n - 0.56) / 0.03;
        const inShadow = edge > 1 || (edge > 0 && edge > bayer4(x, y));
        const v = inShadow ? 214 : 255;
        pixels.set([v, v, v - (inShadow ? 4 : 0), 255], (y * size + x) * 4);
    }
    return toCanvas(pixels, size, size);
}
