import Phaser from 'phaser';
import { bakeLighting, LampReach, lightBlockers, LIT, tileLight, type Lamp } from '../art/bank/lamps';
import { buildExposure, buildLightMaps, facade, type Caster, type Occluder } from '../art/bank/lightmap';
import { LOOKS, person, PERSON_HEIGHT } from '../art/bank/people';
import { propArt, type PropArt } from '../art/bank/props';
import { BANK_TILE_INDEX, bankTileset, type BankTileName } from '../art/bank/tiles';
import { wallArt, wallLook } from '../art/bank/walls';
import { PAL } from '../art/palette';
import { PixelBitmap, toCanvas } from '../art/PixelBitmap';
import { bayer4, mulberry32, valueNoise } from '../art/random';
import { propBox, propSize } from '../level/catalog';
import { TILE } from '../level/level';
import { isOffMap, LOBBY_PEOPLE, LOBBY_PLAN, LOBBY_PROPS, parseLobby, type Lobby, type LobbyProp } from '../level/lobby';
import { baseLine, PERSON_SIZE, place, WALL_STEPS, type Box } from '../level/space';
import { wallFootprint, type Footprint, type Wall } from '../level/walls';

const KEY = { floor: 'lobby-floor', shade: 'lobby-shade', glow: 'lobby-glow', exposure: 'lobby-exposure', clouds: 'lobby-clouds', mote: 'lobby-mote', shadow: 'person-shadow' } as const;

/**
 * Mid-morning. The scene renders at half exposure: ambient is half the sun on the street, so the street needs no
 * lights of its own. The exposure layer then doubles the street and scales indoors down to the building's shade, while
 * lamps and sun shafts still have headroom to make pools. Lamp light is baked (lamps.ts), so walls block it.
 */
const AMBIENT = 0x8a8274;
const DEPTH = { floor: 0, shade: 2, sunFloor: 3, shadows: 4, standing: 10, exposure: 1900, haze: 1910, emissive: 1920, clouds: 1930, motes: 1940 } as const;
const PAN_SPEED = 120;

/**
 * Walls the camera looks past are cut down. A wall stands full height while its base line is at least `STAND_ABOVE`
 * pixels above the middle of the screen, and is cut once it is less than `CUT_ABOVE` above it; in between it keeps its
 * height, so nudging the camera doesn't make walls flicker. A changing wall moves one step of `WALL_STEPS` every `STEP_MS`.
 */
const STAND_ABOVE = 16;
const CUT_ABOVE = 4;
const STEP_MS = 40;

/** Dressing that matters for play stays in view on a cut wall, as a marker of where it is. */
const ALWAYS_SHOWN: LobbyProp['kind'][] = ['camera', 'keycardLed'];

/** A prop placed in the lobby, with its art for the way it faces. */
interface PlacedProp { p: LobbyProp; box: Box; art: PropArt; left: number; top: number }

/** A wall segment on screen: the step it is drawn at, the step it is heading for, and what hangs on it. */
interface WallSprite {
    wall: Wall;
    image: Phaser.GameObjects.Image;
    keys: string[];
    base: number;
    step: number;
    target: number;
    /** Outer walls with nothing behind them always stand. */
    standing: boolean;
    facade: boolean;
    dressing: { top: number; images: Phaser.GameObjects.Image[] }[];
}

/**
 * Visual preview of the bank lobby: no rules, just the look. Drag or use the arrow keys to look around.
 * Depth follows each object's base line, so walls, furniture and people overlap correctly in the ¾ view. Walls stand on
 * the edges between tiles; those north of the middle of the screen stand full height as the backdrop, the rest are cut
 * down so nothing the camera is looking at hides behind them.
 */
export class LobbyScene extends Phaser.Scene {
    private level!: Lobby;
    private lamps: Lamp[] = [];
    private reach!: LampReach;
    private litTiles: boolean[][] = [];
    private readonly casters: Caster[] = [];
    private walls: WallSprite[] = [];
    private exposures: Phaser.GameObjects.Image[] = [];
    private wallClock = 0;
    private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
    private clouds!: Phaser.GameObjects.TileSprite;
    private mapWidth = 0;
    private mapHeight = 0;

    constructor() {
        super('lobby');
    }

    create(): void {
        this.level = parseLobby(LOBBY_PLAN);
        this.walls = [];
        this.exposures = [];
        this.mapWidth = this.level.tiles[0]!.length * TILE;
        this.mapHeight = this.level.tiles.length * TILE;

        const props = LOBBY_PROPS.map((p): PlacedProp => {
            const box = propBox(p, this.level.walls), art = propArt(p, propSize(p), box.facing);
            return { p, box, art, left: box.x - art.originX, top: baseLine(box) - box.z - art.lit.height };
        });
        this.lamps = [...this.ceilingLamps(), ...props.flatMap(propLamps)];
        this.reach = new LampReach(lightBlockers(this.level), this.lamps);
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

    override update(_time: number, deltaMs: number): void {
        const dt = Math.min(deltaMs, 50) / 1000;
        this.clouds.tilePositionX -= dt * 4;
        this.clouds.tilePositionY -= dt * 1.5;
        if (this.cursors) {
            const cam = this.cameras.main;
            const dx = (this.cursors.right.isDown ? 1 : 0) - (this.cursors.left.isDown ? 1 : 0);
            const dy = (this.cursors.down.isDown ? 1 : 0) - (this.cursors.up.isDown ? 1 : 0);
            cam.scrollX += dx * PAN_SPEED * dt;
            cam.scrollY += dy * PAN_SPEED * dt;
        }
        this.updateWalls(deltaMs);
    }

    /** Exposed so automated tests can frame shots without reaching into private fields. */
    get debugState() {
        const cam = this.cameras.main;
        return {
            ready: true, width: this.mapWidth, height: this.mapHeight, scrollX: cam.scrollX, scrollY: cam.scrollY, lamps: this.lamps.length,
            /** Which tiles lamp light reaches, for the rules: rows of '#' (lit) and '.'. */
            lit: this.litTiles.map(row => row.map(lit => (lit ? '#' : '.')).join('')),
            walls: this.walls.map(w => ({ kind: w.wall.kind, run: w.wall.run, tx: w.wall.tx, ty: w.wall.ty, height: WALL_STEPS[w.step]! }))
        };
    }

    /** Moves the camera so the given map pixel is centred; for tests and screenshots. */
    lookAt(x: number, y: number): void {
        this.cameras.main.centerOn(x, y);
    }

    /** Picks each wall's height from where the camera looks and moves changing walls a step towards it every `STEP_MS`. */
    private updateWalls(deltaMs: number): void {
        const middle = this.cameras.main.midPoint.y, top = WALL_STEPS.length - 1;
        for (const w of this.walls) {
            if (w.standing || w.base < middle - STAND_ABOVE) w.target = top;
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
        w.image.setTexture(w.keys[step]!);
        for (const d of w.dressing) for (const image of d.images) image.setVisible(d.top <= height);
        if (w.facade) {
            this.exposures.forEach((image, i) => image.setVisible(i === step));
            // Cloud shadows fall on the street and the shop front, not on the floor seen over a cut-down front.
            const top = wallFootprint(w.wall).y - height;
            this.clouds.setPosition(0, top).setSize(this.mapWidth, this.mapHeight - top);
        }
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
            case 's': return (['sidewalkTL', 'sidewalkTR', 'sidewalkBL', 'sidewalkBR'] as const)[(x % 2) + (y % 2) * 2]!;
            case 'c': return 'curb';
            case 'r': return variant(5) === 0 ? 'road1' : 'road0';
            case 'l': return x % 2 === 0 ? 'roadDash' : 'roadGap';
        }
    }

    /**
     * The floor as one image: every tile, with flat props (mats, a manhole cover) laid into it, lit per pixel by the
     * lamps that reach it.
     */
    private buildFloor(flat: PlacedProp[]): void {
        const tiles = bankTileset(), floor = new PixelBitmap(this.mapWidth, this.mapHeight);
        this.level.tiles.forEach((row, y) => row.forEach((_, x) => {
            const index = BANK_TILE_INDEX[this.tileName(x, y)];
            for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
                floor.set(x * TILE + i, y * TILE + j, tiles.color(index * TILE + i, j), tiles.heightAt(index * TILE + i, j));
            }
        }));
        for (const { art, left, top } of flat) floor.stamp(art.lit, left, top);
        this.addBaked(KEY.floor, floor, 0, 0, (lamp, x, y) => this.reach.reaches(lamp, x, y)).setDepth(DEPTH.floor);
    }

    /** Makes texture `key`: `bitmap` drawn at (left, top), lit the way Light2D would light it by the lamps `reaches` lets through. */
    private bake(key: string, bitmap: PixelBitmap, left: number, top: number, reaches: (lamp: Lamp, x: number, y: number) => boolean): string {
        if (!this.textures.exists(key)) this.textures.addCanvas(key, toCanvas(bakeLighting(bitmap, left, top, AMBIENT, this.lamps, reaches), bitmap.width, bitmap.height));
        return key;
    }

    private addBaked(key: string, bitmap: PixelBitmap, left: number, top: number, reaches: (lamp: Lamp, x: number, y: number) => boolean): Phaser.GameObjects.Image {
        return this.add.image(left, top, this.bake(key, bitmap, left, top, reaches)).setOrigin(0, 0);
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
     * One image per wall segment, standing on its footprint's south edge and ordered by it, with a texture for each of
     * its heights, lit by the lamps on its open sides.
     */
    private buildWalls(): void {
        const { tiles, walls } = this.level;
        const front = facade(this.level).walls;
        walls.forEach((wall, i) => {
            const look = wallLook(wall, walls), f = wallFootprint(wall), base = f.y + f.d;
            const reaches = this.reachingAny(wallSides(wall, f));
            const keys = WALL_STEPS.map(height => {
                const art = wallArt(wall, look, height);
                return this.bake(`wall-${i}-${height}`, art, f.x, base - art.height, reaches);
            });
            const image = this.add.image(f.x, base, keys[0]!).setOrigin(0, 1).setDepth(DEPTH.standing + base);
            const north = wall.run === 'eastWest' ? tiles[wall.ty - 1]?.[wall.tx] : undefined;
            const isFacade = front.includes(wall);
            this.walls.push({
                wall, image, keys, base, step: 0, target: 0, dressing: [],
                // The shop front moves as one, even where it fronts a neighbour.
                standing: !isFacade && (north === undefined || isOffMap(north)),
                facade: isFacade
            });
        });
    }

    /**
     * Places every standing prop by its box (catalog size, level placement): its bitmap's bottom edge on the box's front
     * edge at the box's elevation, drawn in order of that front edge and lit by the lamps that reach its footprint.
     * Returns the floor footprints that shade and block the sun.
     */
    private buildProps(props: PlacedProp[]): Occluder[] {
        const occluders: Occluder[] = [];
        props.forEach(({ p, box, art, left, top }, i) => {
            const key = `lobby-prop-${i}`, depth = DEPTH.standing + baseLine(box);
            const images = [this.addBaked(key, art.lit, left, top, this.reachingAny(footprintPoints(box))).setDepth(depth)];
            this.casters.push(caster(art.lit, left, top, baseLine(box)));
            if (hasPixels(art.glow)) {
                art.glow.addTo(this.textures, `${key}-glow`);
                images.push(this.add.image(left, top, `${key}-glow`).setOrigin(0, 0).setDepth(depth + 0.5));
                // The exposure layer dims everything indoors; a second, additive pass puts the glow back over it.
                images.push(this.add.image(left, top, `${key}-glow`).setOrigin(0, 0).setDepth(DEPTH.emissive).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.7));
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
     * They will move, so they cast nothing into the baked maps (no sun shadow, no gap in a shaft), only their drop
     * shadow; moving one means relighting its own sprite with the lamps that reach where it now stands.
     */
    private buildPeople(): void {
        if (!this.textures.exists(KEY.shadow)) personShadow().addTo(this.textures, KEY.shadow);
        LOBBY_PEOPLE.forEach((p, i) => {
            const spec = LOOKS[p.look];
            if (!spec) throw new Error(`No look named '${p.look}'`);
            const bitmap = person(spec, p.facing);
            const box = place({ tx: p.tx, ty: p.ty }, PERSON_SIZE);
            const left = box.x + box.w / 2 - bitmap.width / 2, top = baseLine(box) - PERSON_HEIGHT;
            this.add.image(box.x + box.w / 2, box.y + box.d / 2, KEY.shadow).setDepth(DEPTH.shadows).setAlpha(0.55);
            this.addBaked(`person-${i}`, bitmap, left, top, this.reachingAny(footprintPoints(box))).setDepth(DEPTH.standing + baseLine(box));
        });
    }

    private buildLightMaps(occluders: Occluder[]): void {
        const maps = buildLightMaps(this.level, occluders, this.casters);
        if (!this.textures.exists(KEY.shade)) this.textures.addCanvas(KEY.shade, toCanvas(maps.shade, maps.width, maps.height));
        if (!this.textures.exists(KEY.glow)) this.textures.addCanvas(KEY.glow, toCanvas(maps.glow, maps.width, maps.height));
        // One exposure layer for each height of the shop front, as everything above its top on screen is indoors.
        const front = wallFootprint(facade(this.level).walls[0]!);
        this.exposures = WALL_STEPS.map(height => {
            const key = `${KEY.exposure}-${height}`;
            if (!this.textures.exists(key)) this.textures.addCanvas(key, toCanvas(buildExposure(this.level, front.y - height), maps.width, maps.height));
            return this.add.image(0, 0, key).setOrigin(0, 0).setDepth(DEPTH.exposure).setBlendMode(doubleMultiply(this)).setVisible(false);
        });
        this.add.image(0, 0, KEY.shade).setOrigin(0, 0).setDepth(DEPTH.shade).setBlendMode(Phaser.BlendModes.MULTIPLY);
        this.add.image(0, 0, KEY.glow).setOrigin(0, 0).setDepth(DEPTH.sunFloor).setBlendMode(Phaser.BlendModes.ADD);
        // The same shafts, faint, over everything: the light in the air that also falls on people standing in it.
        this.add.image(0, 0, KEY.glow).setOrigin(0, 0).setDepth(DEPTH.haze).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.35);
    }

    /** Indoors: warm ceiling pools with darker floor between them, and sun patches where the shafts land. */
    private ceilingLamps(): Lamp[] {
        const lamp = (x: number, y: number, radius: number, color: number, intensity: number, z: number): Lamp => ({ x, y, z, radius, color, intensity, from: { x, y } });
        const facadeY = facade(this.level).line;
        return [
            // Daylight bouncing off the floor just inside the glass.
            ...[2.5, 6.5, 10, 13.5, 19.5].map(x => lamp(x * TILE - 20, facadeY - 2 * TILE, 52, 0xffd9a0, 0.8, 30)),
            ...[[3.5, 8.5], [9.5, 8], [15.5, 8.5], [6.5, 11.5], [13.5, 11.5]].map(([x, y]) => lamp(x! * TILE, y! * TILE, 80, 0xffd8b0, 1.5, 48)),
            // The teller line is lit brighter than the lobby, and these reach up the back wall to its dressing.
            ...[4, 10, 16].map(x => lamp(x * TILE, 4.2 * TILE, 84, 0xffdcb8, 1.8, 50)),
            // Cool strip lights along the staff corridor.
            ...[6, 15].map(x => lamp(x * TILE, 2.6 * TILE, 70, 0xdde6ff, 1.3, 40))
        ];
    }

    private buildAtmosphere(): void {
        const facadeY = facade(this.level).line;
        if (!this.textures.exists(KEY.clouds)) this.textures.addCanvas(KEY.clouds, cloudCanvas(128));
        // Slow cloud shadows drifting over the street and the shop front; their top follows the front's height.
        this.clouds = this.add.tileSprite(0, facadeY, this.mapWidth, this.mapHeight - facadeY, KEY.clouds)
            .setOrigin(0, 0).setDepth(DEPTH.clouds).setBlendMode(Phaser.BlendModes.MULTIPLY);

        if (!this.textures.exists(KEY.mote)) {
            const mote = new PixelBitmap(1, 1);
            mote.set(0, 0, 0xfff2d0, 1);
            mote.addTo(this.textures, KEY.mote);
        }
        // Dust drifting in the sun shafts just inside the glass.
        this.add.particles(0, 0, KEY.mote, {
            x: { min: TILE, max: this.mapWidth - TILE },
            y: { min: facadeY - 4 * TILE, max: facadeY - 4 },
            lifespan: 5000,
            speedX: { min: -2, max: 2 },
            speedY: { min: -3, max: 1 },
            alpha: { start: 0, end: 0, ease: (t: number) => Math.sin(t * Math.PI) * 0.45 },
            quantity: 1,
            frequency: 120,
            blendMode: Phaser.BlendModes.ADD
        }).setDepth(DEPTH.motes);
    }

    private setupCamera(): void {
        const cam = this.cameras.main;
        // The middle of the screen can reach every tile, so the camera can look at (and past the walls to) any of them.
        const bounds = () => cam.setBounds(-cam.width / 2, -cam.height / 2, this.mapWidth + cam.width, this.mapHeight + cam.height);
        bounds();
        this.scale.on(Phaser.Scale.Events.RESIZE, bounds);
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, bounds));
        cam.setBackgroundColor(PAL.void).setRoundPixels(true);
        cam.centerOn(this.mapWidth / 2, 9.5 * TILE);
        Phaser.Actions.AddEffectBloom(cam, { threshold: 0.62, blurRadius: 2, blurSteps: 4, blendAmount: 0.6 });
        cam.filters.external.addVignette(0.5, 0.5, 1, 0.16);
        this.cursors = this.input.keyboard?.createCursorKeys();
        this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
            if (!p.isDown) return;
            cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
            cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
        });
    }
}

/** Registers (once per renderer) a blend mode giving `2 * source * destination`: a multiply that can also brighten. */
function doubleMultiply(scene: Phaser.Scene): number {
    const renderer = scene.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const registry = renderer as unknown as { bankDoubleMultiply?: number };
    if (registry.bankDoubleMultiply === undefined) {
        const gl = renderer.gl;
        // addBlendMode returns the wrong index in Phaser 4.2.1; the new mode is the last one in the list.
        renderer.addBlendMode([gl.DST_COLOR, gl.SRC_COLOR], gl.FUNC_ADD);
        registry.bankDoubleMultiply = renderer.blendModes.length - 1;
    }
    return registry.bankDoubleMultiply;
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

/** Floor points beside a wall segment: in front of an east-west wall, either side of a north-south one. */
function wallSides(wall: Wall, f: Footprint): [number, number][] {
    if (wall.run === 'eastWest') return [2, 8, 14].map(u => [f.x + u, f.y + f.d + 0.5]);
    return [[f.x - 0.5, f.y + 8], [f.x + f.w + 0.5, f.y + 8]];
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

/** Cloud shadow: smooth noise cut into two flat levels, dithered only along the edge. */
function cloudCanvas(size: number): HTMLCanvasElement {
    const noise = valueNoise(mulberry32(99), 4);
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const n = noise(x / size, y / size);
        const edge = (n - 0.5) / 0.05;
        const inShadow = edge > 1 || (edge > 0 && edge > bayer4(x, y));
        const v = inShadow ? 214 : 255;
        pixels.set([v, v, v - (inShadow ? 4 : 0), 255], (y * size + x) * 4);
    }
    return toCanvas(pixels, size, size);
}
