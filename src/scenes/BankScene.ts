import Phaser from 'phaser';
import { LampReach, lightBlockers, LIT, tileLight } from '../art/bank/lamps';
import { buildExposure } from '../art/bank/lightmap';
import type { BankData } from '../level/bankData';
import { TILE } from '../level/level';
import type { PersonFacing as Facing } from '../level/plan';
import { Atmosphere } from './bank/atmosphere';
import { Baker, forgetLastBank } from './bank/bake';
import { BankCamera } from './bank/camera';
import { addFloor } from './bank/floor';
import { Heights } from './bank/heights';
import { Knowledge } from './bank/knowledge';
import { People } from './bank/people';
import { addProps, bankLamps, placeProps } from './bank/props';
import { RaisedFloors } from './bank/raised';
import { PlayMode, type PlayParts } from './bank/sim';
import { Walls } from './bank/walls';
import { M1_CREW } from '../game/heist';
import { CREW_COLOURS } from '../ui/hud/viewModels';

/** What `?play` hands the scene through the registry (`play`): the Session and the bank it is played in. */
export type PlaySetup = Pick<PlayParts, 'session' | 'bank' | 'resumed'> & { /** How long finding or making the heist took (ms). */ setupMs?: number };

/**
 * The example bank and its block (bank.ts), or a generated one: the street, the bank with its neighbours, the alley
 * behind. No rules yet, just the look, the people and the camera. Depth follows each object's base line, so walls,
 * furniture and people overlap correctly in the ¾ view. Walls stand on the edges between tiles; those north of the
 * middle of the screen stand full height as the backdrop, the rest are cut down so nothing the camera is looking at
 * hides behind them.
 *
 * The scene puts the bank together from its parts in `bank/`: the baked textures (`bake.ts`, lit on the CPU), the floor,
 * the walls and their heights, the props, the people and their patrols, the knowledge layer, the air and the camera.
 *
 * Camera (§20.1): drag or the arrow keys to pan; the mouse wheel, a pinch, the + and − buttons or keys to zoom in
 * whole-number steps between about 11 and 34 tiles high; Map (or M) for the tactical map of the whole plot.
 */
export class BankScene extends Phaser.Scene {
    private bank!: BankData;
    private baker!: Baker;
    private litTiles: boolean[][] = [];
    private walls!: Walls;
    private heights!: Heights;
    private people!: People;
    private knowledge!: Knowledge;
    private atmosphere!: Atmosphere;
    private camera!: BankCamera;
    private mapWidth = 0;
    private mapHeight = 0;
    /** How long each stage of the last `create` took, in milliseconds (`debugState.timings`), and the first frame after it. */
    private timings: Record<string, number> = {};
    /** Nothing moves by itself (`?still`, for screenshot tests): the clouds hold still, nobody patrols, no dust drifts. */
    private still = false;
    /** Play mode (`?play`): the bank driven by a Session. */
    private play?: PlayMode;

    constructor() {
        super('bank');
    }

    create(): void {
        const started = performance.now();
        this.bank = this.registry.get('bankData') as BankData;
        if (!this.bank) throw new Error("No bank to draw: set the registry's 'bankData' before starting the scene");
        forgetLastBank(this.textures);
        this.still = this.registry.get('still') === true;
        const play = this.registry.get('play') as PlaySetup | undefined;
        const { level } = this.bank;
        this.mapWidth = level.tiles[0]!.length * TILE;
        this.mapHeight = level.tiles.length * TILE;

        this.timings = {};
        const props = this.timed('prop art', () => placeProps(this.bank));
        const { lamps, reach } = this.timed('lamp reach', () => {
            const lamps = bankLamps(this.bank, props), reach = new LampReach(lightBlockers(level), lamps);
            this.litTiles = tileLight(level, lamps, reach).map(row => row.map(light => light >= LIT));
            return { lamps, reach };
        });
        const exposure = this.timed('exposure', () => buildExposure(level));
        const baker = (this.baker = new Baker(this, lamps, reach, exposure));
        const atmosphere = (this.atmosphere = new Atmosphere(this, level, this.still));
        // Raised floors (§14.7) are drawn a storey up, and cut down as walls are; what stands on them goes with them.
        const heights = (this.heights = new Heights(level)), raised = new RaisedFloors(this, level, heights);
        this.walls = new Walls(this, level, heights, { front: y => atmosphere.frontTop(y), far: y => atmosphere.farTop(y) });
        const knowledge = (this.knowledge = new Knowledge(this, this.bank.outlines ?? [], heights));
        this.people = new People(this, baker, (x, y) => knowledge.hides(x, y), heights);
        this.camera = new BankCamera(this, this.mapWidth, this.mapHeight, !play);

        const floor = this.timed('floor', () => addFloor(baker, level, props.filter(({ box }) => box.h === 0)));
        this.timed('walls', () => this.walls.build(baker));
        const { occluders, casters } = this.timed('props', () => addProps(this, baker, this.walls, props.filter(({ box }) => box.h > 0), heights));
        this.timed('people', () => this.people.build(this.bank.people, play ? play.session.state.crew.map((c, i) => ({
            look: M1_CREW.find(m => m.id === c.id)?.look ?? 'crewSol', tx: c.pos.x, ty: c.pos.y, facing: 'back' as const, ring: CREW_COLOURS[i % CREW_COLOURS.length]!
        })) : []));
        const { shade } = this.timed('light maps', () => baker.addLightMaps(level, occluders, casters));
        this.timed('raised floors', () => raised.build(baker, floor, shade));
        this.timed('atmosphere', () => atmosphere.build(baker));
        this.timed('camera', () => {
            this.camera.setup((this.bank.focus.tx + 0.5) * TILE, (this.bank.focus.ty + 0.5) * TILE);
            this.walls.update(0, this.cameras.main.midPoint.y, this.camera.onMap);
            this.walls.settle();
        });
        if (play?.setupMs !== undefined) this.timings.heist = play.setupMs;
        if (play) this.timed('play', () => {
            this.play = new PlayMode(this, { ...play, people: this.people, walls: this.walls, camera: this.camera });
            // Play mode opens on the crew: the walls stand as that view asks from the first frame.
            this.walls.update(0, this.cameras.main.midPoint.y, this.camera.onMap);
            this.walls.settle();
        });
        this.timings.create = performance.measure('bank: create', { start: started }).duration;
        // The first frame uploads the textures and compiles the camera's filters, which the player waits for too.
        this.game.events.once(Phaser.Core.Events.POST_RENDER, () => (this.timings['first frame'] = performance.now() - started - this.timings.create!));
    }

    /** Runs one stage of `create`, timed into `timings` and the browser's performance timeline (`bank: <stage>`). */
    private timed<T>(stage: string, run: () => T): T {
        const start = performance.now(), result = run();
        this.timings[stage] = performance.measure(`bank: ${stage}`, { start }).duration;
        return result;
    }

    override update(): void {
        // Real time since the last frame. Phaser's smoothed delta is capped at 60fps's for its first 120 frames and while
        // the window is out of focus, so on a slow device everything would crawl; a long pause still counts as a short one.
        const deltaMs = Math.min(this.game.loop.rawDelta, 100), dt = deltaMs / 1000;
        if (!this.still) {
            this.atmosphere.update(dt);
            // In play mode the state says where people stand: no real-time patrols.
            if (!this.play) this.people.update(deltaMs);
        }
        this.play?.update(deltaMs);
        this.camera.update(dt);
        this.walls.update(deltaMs, this.cameras.main.midPoint.y, this.camera.onMap);
    }

    /** Exposed so automated tests can frame shots without reaching into private fields. */
    get debugState() {
        const cam = this.cameras.main, { zoom, zoomLevels, map, plot } = this.camera.state;
        return {
            ready: true, width: this.mapWidth, height: this.mapHeight, lamps: this.baker.lamps.length, timings: this.timings,
            zoom, zoomLevels, tilesHigh: cam.height / TILE, map,
            midX: cam.midPoint.x, midY: cam.midPoint.y,
            /** Where the plot shows, in CSS pixels from the canvas's top-left corner. */
            plot,
            /** Which tiles lamp light reaches, for the rules: rows of '#' (lit) and '.'. */
            lit: this.litTiles.map(row => row.map(lit => (lit ? '#' : '.')).join('')),
            people: this.people.state,
            walls: this.walls.state,
            /** Each raised region (§14.7): its north edge (tile row) and the storey height it is drawn at now. */
            raised: this.heights.state,
            /** Every wall has reached the height the view asks of it (as of the last frame), so a screenshot can be taken. */
            settled: this.walls.settled,
            /** Play mode's selection, preview, playback and doors (`?play`). */
            play: this.play?.state
        };
    }

    /** Where the middle of tile (tx, ty) is on the page, in CSS pixels (for tests: where to tap). */
    tileOnPage(tx: number, ty: number): { x: number; y: number } {
        const cam = this.cameras.main, box = this.game.canvas.getBoundingClientRect();
        const sx = box.width / this.scale.width, sy = box.height / this.scale.height;
        return { x: box.left + ((tx + 0.5) * TILE - cam.worldView.x) * sx, y: box.top + ((ty + 0.5) * TILE - cam.worldView.y) * sy };
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
        this.camera.zoomStep(direction, sx, sy);
    }

    /** Shows the tactical map of the whole plot, with every wall cut down, or goes back to the view before it. */
    toggleMap(): void {
        this.camera.toggleMap();
    }

    /**
     * Stands person `index` with the middle of their footprint at map point (x, y), facing `facing`, and relights them:
     * only their own sprite, by the lamps that reach where they now stand.
     */
    movePerson(index: number, x: number, y: number, facing?: Facing): void {
        this.people.move(index, x, y, facing);
    }

    /**
     * The knowledge layer (§17.8): with `full` off, the rooms the blueprint shows only as outlines are drawn as grey
     * blocks with a `?`, and the people in them are hidden.
     */
    showKnowledge(full: boolean): void {
        this.knowledge.show(full);
        this.people.reveal();
    }
}
