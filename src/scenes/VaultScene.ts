import Phaser from 'phaser';
import { createTextures, TEX, TILE_INDEX } from '../art/textures';
import { Guard } from '../entities/Guard';
import { MoveInput } from '../input/MoveInput';
import { LEVEL1, parseLevel, TILE, type LevelData } from '../level/level';
import { Hud } from '../ui/Hud';

const PLAYER_SPEED = 60;
const AMBIENT = 0x262438;

interface Lamp { light: Phaser.GameObjects.Light; base: number; phase: number }

export class VaultScene extends Phaser.Scene {
    private level!: LevelData;
    private player!: Phaser.Physics.Arcade.Image;
    private playerLight!: Phaser.GameObjects.Light;
    private flashlight!: Phaser.GameObjects.Light;
    private guards: Guard[] = [];
    private gold!: Phaser.Physics.Arcade.StaticGroup;
    private lamps: Lamp[] = [];
    private input2!: MoveInput;
    private hud!: Hud;
    private collected = 0;
    private facing = 0;
    private ended = false;
    private readonly move = new Phaser.Math.Vector2();

    constructor() {
        super('vault');
    }

    create(): void {
        if (!this.textures.exists(TEX.robber)) createTextures(this.textures);
        this.level = parseLevel(LEVEL1);
        this.guards = [];
        this.lamps = [];
        this.collected = 0;
        this.ended = false;

        this.lights.enable().setAmbientColor(AMBIENT);
        const walls = this.buildTilemap();
        this.buildProps();
        this.buildPlayer(walls);
        this.level.patrols.forEach(p => this.guards.push(new Guard(this, p)));
        this.buildAtmosphere();

        const cam = this.cameras.main;
        cam.setBounds(0, 0, this.level.width * TILE, this.level.height * TILE).setRoundPixels(true);
        cam.startFollow(this.player, true, 0.15, 0.15);
        Phaser.Actions.AddEffectBloom(cam, { threshold: 0.45, blurRadius: 2, blurSteps: 4, blendAmount: 1 });
        // The vignette shader ramps towards full colour at `radius`, so keep strength low for a soft edge rather than a black frame.
        cam.filters.external.addVignette(0.5, 0.5, 1, 0.22);
        cam.fadeIn(400);

        this.input2 = new MoveInput(this);
        this.hud = new Hud();
        this.hud.setGold(0, this.level.gold.length);
        this.hud.flash('Grab the gold. Stay out of the light.');
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.hud.destroy());
    }

    override update(_time: number, deltaMs: number): void {
        const dt = Math.min(deltaMs, 50) / 1000;
        this.updatePlayer();
        this.guards.forEach(g => g.update(dt));
        this.updateLamps(this.time.now / 1000);
        if (!this.ended && this.guards.some(g => g.canSee(this.player, this.isWall))) this.spotted();
    }

    /** Exposed so automated tests can inspect state without reaching into private fields. */
    get debugState() {
        return { player: { x: this.player.x, y: this.player.y }, collected: this.collected, total: this.level.gold.length, ended: this.ended };
    }

    private readonly isWall = (x: number, y: number): boolean => this.level.walls[Math.floor(y / TILE)]?.[Math.floor(x / TILE)] ?? true;

    private buildTilemap(): Phaser.Tilemaps.TilemapLayer {
        const { walls } = this.level;
        const data = walls.map((row, ty) => row.map((wall, tx) => {
            if (!wall) return (tx + ty) % 2 === 0 ? TILE_INDEX.floorA : TILE_INDEX.floorB;
            return walls[ty + 1]?.[tx] === false ? TILE_INDEX.wallFace : TILE_INDEX.wallTop;
        }));
        const map = this.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE });
        const tileset = map.addTilesetImage(TEX.tiles, TEX.tiles, TILE, TILE, 0, 0)!;
        const layer = (map.createLayer(0, tileset, 0, 0) as Phaser.Tilemaps.TilemapLayer).setLighting(true);
        layer.setCollision([TILE_INDEX.wallTop, TILE_INDEX.wallFace]);
        return layer;
    }

    private buildProps(): void {
        this.gold = this.physics.add.staticGroup();
        for (const p of this.level.gold) {
            this.gold.add(this.physics.add.staticImage(p.x, p.y, TEX.gold).setLighting(true));
            this.lights.addLight(p.x, p.y, 20, 0xffc94a, 0.6);
        }
        for (const p of this.level.lamps) {
            this.add.image(p.x, p.y, TEX.lamp).setDepth(10);
            this.lamps.push({ light: this.lights.addLight(p.x, p.y, 100, 0xffb36b, 2), base: 2, phase: Math.random() * 100 });
        }
        const exit = this.level.exit;
        this.add.image(exit.x, exit.y - 4, TEX.exit).setDepth(10);
        this.lights.addLight(exit.x + 8, exit.y, 48, 0x3cff7a, 1.2);
    }

    private buildPlayer(walls: Phaser.Tilemaps.TilemapLayer): void {
        const start = this.level.playerStart;
        this.player = this.physics.add.image(start.x, start.y, TEX.robber).setLighting(true).setOrigin(0.5, 0.8).setDepth(5);
        // Collide with the feet only, so the head can overlap the wall row above, which reads as standing in front of it.
        this.player.body!.setSize(8, 5).setOffset(1, 9);
        this.physics.add.collider(this.player, walls);
        this.physics.add.overlap(this.player, this.gold, (_p, g) => this.collect(g as Phaser.Physics.Arcade.Image));
        this.playerLight = this.lights.addLight(start.x, start.y, 34, 0x8fa8ff, 0.7);
        this.flashlight = this.lights.addConeLight(start.x, start.y, 110, 0xdfe8ff, 1.8, 0, 0.5, 0.9);
    }

    private buildAtmosphere(): void {
        // Slow dust motes catching the light.
        this.add.particles(0, 0, TEX.mote, {
            x: { min: 0, max: this.level.width * TILE },
            y: { min: 0, max: this.level.height * TILE },
            lifespan: 6000,
            speedX: { min: -3, max: 3 },
            speedY: { min: -4, max: 1 },
            alpha: { start: 0, end: 0, ease: (t: number) => Math.sin(t * Math.PI) * 0.35 },
            quantity: 1,
            frequency: 60,
            blendMode: Phaser.BlendModes.ADD
        }).setDepth(20);
    }

    private updatePlayer(): void {
        const body = this.player.body as Phaser.Physics.Arcade.Body;
        if (this.ended) {
            body.setVelocity(0, 0);
            return;
        }
        this.input2.read(this.move);
        body.setVelocity(this.move.x * PLAYER_SPEED, this.move.y * PLAYER_SPEED);
        if (this.move.lengthSq() > 0.01) {
            this.facing = Math.atan2(this.move.y, this.move.x);
            if (Math.abs(this.move.x) > 0.1) this.player.setFlipX(this.move.x < 0);
        }
        this.playerLight.setPosition(this.player.x, this.player.y - 4);
        this.flashlight.setPosition(this.player.x, this.player.y - 4);
        this.flashlight.setConeRotation(this.facing);
        if (Phaser.Math.Distance.BetweenPoints(this.player, this.level.exit) < TILE) this.tryExit();
    }

    private updateLamps(t: number): void {
        for (const lamp of this.lamps) {
            const flicker = Math.sin(t * 7 + lamp.phase) * 0.06 + Math.sin(t * 23 + lamp.phase * 3) * 0.04;
            // Occasional brief dip, like a failing bulb.
            const dip = Math.sin(t * 0.7 + lamp.phase) > 0.995 ? 0.5 : 1;
            lamp.light.intensity = lamp.base * (1 + flicker) * dip;
        }
    }

    private collect(gold: Phaser.Physics.Arcade.Image): void {
        gold.destroy();
        this.collected++;
        this.hud.setGold(this.collected, this.level.gold.length);
        this.cameras.main.flash(80, 255, 210, 90);
    }

    private tryExit(): void {
        if (this.ended) return;
        if (this.collected < this.level.gold.length) {
            this.hud.flash(`The vault isn't empty yet (${this.collected}/${this.level.gold.length})`);
            return;
        }
        this.endRun('Clean getaway!', 0x3cff7a);
    }

    private spotted(): void {
        this.cameras.main.shake(250, 0.01);
        this.endRun('Spotted!', 0xff3c3c);
    }

    private endRun(message: string, color: number): void {
        this.ended = true;
        this.hud.flash(message, color);
        this.time.delayedCall(1400, () => this.cameras.main.fadeOut(400));
        this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart());
    }
}
