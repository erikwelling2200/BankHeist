import Phaser from 'phaser';
import { buildLightMaps, type Caster, type Occluder } from '../art/bank/lightmap';
import { LOOKS, person, PERSON_HEIGHT } from '../art/bank/people';
import { propArt, WALL_DRESSING, type PropArt } from '../art/bank/props';
import { BANK_TILE_INDEX, bankTileset, type BankTileName } from '../art/bank/tiles';
import { PixelBitmap, toCanvas } from '../art/PixelBitmap';
import { bayer4, mulberry32, valueNoise } from '../art/random';
import { TILE } from '../level/level';
import { isStructure, LOBBY_PEOPLE, LOBBY_PROPS, LOBBY_TILES, parseLobby, type LobbyTile } from '../level/lobby';

const KEY = { tiles: 'bank-tiles', shade: 'lobby-shade', glow: 'lobby-glow', exposure: 'lobby-exposure', clouds: 'lobby-clouds', mote: 'lobby-mote', shadow: 'person-shadow' } as const;

/**
 * Mid-morning. The scene renders at half exposure: ambient is half the sun on the street, so the street needs no
 * lights of its own (Light2D lights would shine through the façade). The exposure layer then doubles the street and
 * scales indoors down to the building's shade, while lamps and sun shafts still have headroom to make pools.
 */
const AMBIENT = 0x8a8274;
const DEPTH = { floor: 0, flat: 1, shade: 2, sunFloor: 3, shadows: 4, standing: 10, exposure: 1900, haze: 1910, emissive: 1920, clouds: 1930, motes: 1940 } as const;
const PAN_SPEED = 120;

/**
 * Visual preview of the bank lobby: no rules, just the look. Drag or use the arrow keys to look around.
 * Depth follows each object's base row, so people and furniture overlap correctly in the ¾ view.
 */
export class LobbyScene extends Phaser.Scene {
    private tiles!: LobbyTile[][];
    private readonly casters: Caster[] = [];
    private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
    private clouds!: Phaser.GameObjects.TileSprite;
    private mapWidth = 0;
    private mapHeight = 0;

    constructor() {
        super('lobby');
    }

    create(): void {
        this.tiles = parseLobby(LOBBY_TILES);
        this.mapWidth = this.tiles[0]!.length * TILE;
        this.mapHeight = this.tiles.length * TILE;
        if (!this.textures.exists(KEY.tiles)) bankTileset().addTo(this.textures, KEY.tiles);

        this.lights.enable().setAmbientColor(AMBIENT);
        this.buildFloorAndWalls();
        const occluders = [...this.buildProps(), ...this.buildPeople()];
        this.buildLightMaps(occluders);
        this.casters.length = 0;
        this.buildDaylight();
        this.buildAtmosphere();
        this.setupCamera();
    }

    override update(_time: number, deltaMs: number): void {
        const dt = Math.min(deltaMs, 50) / 1000;
        this.clouds.tilePositionX -= dt * 4;
        this.clouds.tilePositionY -= dt * 1.5;
        if (!this.cursors) return;
        const cam = this.cameras.main;
        const dx = (this.cursors.right.isDown ? 1 : 0) - (this.cursors.left.isDown ? 1 : 0);
        const dy = (this.cursors.down.isDown ? 1 : 0) - (this.cursors.up.isDown ? 1 : 0);
        cam.scrollX += dx * PAN_SPEED * dt;
        cam.scrollY += dy * PAN_SPEED * dt;
    }

    /** Exposed so automated tests can frame shots without reaching into private fields. */
    get debugState() {
        const cam = this.cameras.main;
        return { ready: true, width: this.mapWidth, height: this.mapHeight, scrollX: cam.scrollX, scrollY: cam.scrollY, lights: this.lights.getLightCount() };
    }

    /** Moves the camera so the given map pixel is centred; for tests and screenshots. */
    lookAt(x: number, y: number): void {
        this.cameras.main.centerOn(x, y);
    }

    private tileName(x: number, y: number): BankTileName {
        const t = this.tiles[y]![x]!;
        const variant = (n: number) => (Math.imul(x * 73856093 ^ y * 19349663, 0x9e3779b1) >>> 0) % n;
        const south = this.tiles[y + 1]?.[x];
        switch (t) {
            case '#': return south !== undefined && !isStructure(south) ? 'wallFace' : 'wallCap';
            case 'd': return 'doorWood';
            case 'k': return 'doorKeycard';
            case 'w': return 'sideDoor';
            case ',': return (['linoleum0', 'linoleum1'] as const)[variant(2)]!;
            case '.': return (['marble0', 'marble1', 'marble2'] as const)[variant(3)]!;
            case '=': return this.tiles[y]![x - 1] === '=' ? 'runnerRight' : 'runnerLeft';
            case 'p': return 'pier';
            case 'g': return 'window';
            case 'D': return this.tiles[y]![x - 1] === 'D' ? 'doorGlassRight' : 'doorGlassLeft';
            case 'A': return 'atm';
            case 's': return (['sidewalkTL', 'sidewalkTR', 'sidewalkBL', 'sidewalkBR'] as const)[(x % 2) + (y % 2) * 2]!;
            case 'c': return 'curb';
            case 'r': return variant(5) === 0 ? 'road1' : 'road0';
            case 'l': return x % 2 === 0 ? 'roadDash' : 'roadGap';
        }
    }

    private buildFloorAndWalls(): void {
        const data = this.tiles.map((row, y) => row.map((_, x) => BANK_TILE_INDEX[this.tileName(x, y)]));
        const map = this.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE });
        const tileset = map.addTilesetImage(KEY.tiles, KEY.tiles, TILE, TILE, 0, 0)!;
        (map.createLayer(0, tileset, 0, 0) as Phaser.Tilemaps.TilemapLayer).setLighting(true).setDepth(DEPTH.floor);
    }

    /** Places every prop with its glow layer and lights, and returns what each one shades on the floor. */
    private buildProps(): Occluder[] {
        const occluders: Occluder[] = [];
        LOBBY_PROPS.forEach((p, i) => {
            const art = propArt(p);
            const key = `lobby-prop-${i}`;
            const left = p.tx * TILE + (art.offsetX ?? 0);
            const bottom = (p.ty + 1) * TILE;
            const top = bottom - art.lit.height;
            const depth = art.flat ? DEPTH.flat : WALL_DRESSING.has(p.kind) ? DEPTH.standing + bottom - TILE : DEPTH.standing + bottom;
            this.addBitmap(art.lit, key, left, top, depth, true);
            if (!art.flat) this.casters.push(caster(art.lit, left, top, bottom));
            if (art.glow) {
                this.addBitmap(art.glow, `${key}-glow`, left, top, depth + 0.5, false);
                // The exposure layer dims everything indoors; a second, additive pass puts the glow back over it.
                this.add.image(left, top, `${key}-glow`).setOrigin(0, 0).setDepth(DEPTH.emissive).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.7);
            }
            for (const l of art.lights ?? []) this.lights.addLight(left + l.x, top + l.y, l.radius, l.color, l.intensity);
            if (art.shadow) occluders.push(propOccluder(art, left, top));
        });
        return occluders;
    }

    private buildPeople(): Occluder[] {
        if (!this.textures.exists(KEY.shadow)) personShadow().addTo(this.textures, KEY.shadow);
        return LOBBY_PEOPLE.map(p => {
            const spec = LOOKS[p.look];
            if (!spec) throw new Error(`No look named '${p.look}'`);
            const key = `person-${p.look}-${p.facing}`;
            const bitmap = person(spec, p.facing);
            if (!this.textures.exists(key)) bitmap.addTo(this.textures, key);
            const x = p.tx * TILE, feet = (p.ty + 1) * TILE - 2;
            this.casters.push(caster(bitmap, x, feet - PERSON_HEIGHT + 1, feet + 1));
            this.add.image(x + 8, feet + 1, KEY.shadow).setDepth(DEPTH.shadows).setAlpha(0.55);
            this.add.image(x, feet - PERSON_HEIGHT + 1, key).setOrigin(0, 0).setLighting(true).setDepth(DEPTH.standing + feet);
            return { x: x + 4, y: feet - 2, w: 8, h: 3, height: PERSON_HEIGHT - 2 };
        });
    }

    private addBitmap(bitmap: PixelBitmap, key: string, x: number, y: number, depth: number, lit: boolean): Phaser.GameObjects.Image {
        if (!this.textures.exists(key)) bitmap.addTo(this.textures, key);
        return this.add.image(x, y, key).setOrigin(0, 0).setDepth(depth).setLighting(lit);
    }

    private buildLightMaps(occluders: Occluder[]): void {
        const maps = buildLightMaps(this.tiles, occluders, this.casters);
        if (!this.textures.exists(KEY.shade)) this.textures.addCanvas(KEY.shade, toCanvas(maps.shade, maps.width, maps.height));
        if (!this.textures.exists(KEY.glow)) this.textures.addCanvas(KEY.glow, toCanvas(maps.glow, maps.width, maps.height));
        if (!this.textures.exists(KEY.exposure)) this.textures.addCanvas(KEY.exposure, toCanvas(maps.exposure, maps.width, maps.height));
        this.add.image(0, 0, KEY.exposure).setOrigin(0, 0).setDepth(DEPTH.exposure).setBlendMode(doubleMultiply(this));
        this.add.image(0, 0, KEY.shade).setOrigin(0, 0).setDepth(DEPTH.shade).setBlendMode(Phaser.BlendModes.MULTIPLY);
        this.add.image(0, 0, KEY.glow).setOrigin(0, 0).setDepth(DEPTH.sunFloor).setBlendMode(Phaser.BlendModes.ADD);
        // The same shafts, faint, over everything: the light in the air that also falls on people standing in it.
        this.add.image(0, 0, KEY.glow).setOrigin(0, 0).setDepth(DEPTH.haze).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.35);
    }

    /** Indoors: warm ceiling pools with darker floor between them, and sun patches where the shafts land. */
    private buildDaylight(): void {
        const facadeRow = this.tiles.findIndex(row => row.includes('g'));
        for (const x of [2.5, 6.5, 10, 13.5, 19.5]) this.lights.addLight(x * TILE - 20, (facadeRow - 2) * TILE, 52, 0xffd9a0, 0.8, 30);
        const lobby = [[3.5, 6.5], [9.5, 6], [15.5, 6.5], [6.5, 9.5], [13.5, 9.5]] as const;
        for (const [x, y] of lobby) this.lights.addLight(x * TILE, y * TILE, 64, 0xffcf98, 1.1, 40);
        // The teller line is lit brighter than the lobby, and these reach up the back wall to its dressing.
        for (const x of [4, 10, 16]) this.lights.addLight(x * TILE, 2.2 * TILE, 72, 0xffd6a8, 1.5, 45);
    }

    private buildAtmosphere(): void {
        const facadeRow = this.tiles.findIndex(row => row.includes('g'));
        if (!this.textures.exists(KEY.clouds)) this.textures.addCanvas(KEY.clouds, cloudCanvas(128));
        // Slow cloud shadows drifting over the street, cut off at the building line.
        const outsideTop = facadeRow * TILE + 4;
        this.clouds = this.add.tileSprite(0, outsideTop, this.mapWidth, this.mapHeight - outsideTop, KEY.clouds)
            .setOrigin(0, 0).setDepth(DEPTH.clouds).setBlendMode(Phaser.BlendModes.MULTIPLY);

        if (!this.textures.exists(KEY.mote)) {
            const mote = new PixelBitmap(1, 1);
            mote.set(0, 0, 0xfff2d0, 1);
            mote.addTo(this.textures, KEY.mote);
        }
        // Dust drifting in the sun shafts just inside the glass.
        this.add.particles(0, 0, KEY.mote, {
            x: { min: TILE, max: this.mapWidth - TILE },
            y: { min: (facadeRow - 4) * TILE, max: facadeRow * TILE - 2 },
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
        cam.setBounds(0, 0, this.mapWidth, this.mapHeight).setRoundPixels(true);
        cam.centerOn(this.mapWidth / 2, 7.5 * TILE);
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

function caster(bitmap: PixelBitmap, left: number, top: number, base: number): Caster {
    return { left, top, width: bitmap.width, height: bitmap.height, base, opaque: (x, y) => bitmap.opaque(x, y) };
}

/** A prop blocks the sun up to the top of its bitmap, measured from its footprint. */
function propOccluder(art: PropArt, left: number, top: number): Occluder {
    const s = art.shadow!;
    return { x: left + s.x, y: top + s.y, w: s.w, h: s.h, height: s.y };
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
