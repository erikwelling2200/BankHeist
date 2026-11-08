import Phaser from 'phaser';
import { LampReach, lightBlockers, LIT, tileLight } from '../art/bank/lamps';
import { buildExposure } from '../art/bank/lightmap';
import type { BankData } from '../level/bankData';
import { TILE } from '../level/constants';
import type { PersonHeading as Facing } from '../art/bank/people';
import { Atmosphere } from './bank/atmosphere';
import { Baker, forgetLastBank } from './bank/bake';
import { BankCamera } from './bank/camera';
import { addFloor } from './bank/floor';
import { Heights } from './bank/heights';
import { Knowledge } from './bank/knowledge';
import { People } from './bank/people';
import { addProps, bankLamps, placeProps, type ShownProp } from './bank/props';
import { Vehicles } from './bank/vehicles';
import { darkensAt, VEHICLE_PROPS, type DeepReadonly, type MarkerKind, type VehicleState } from '../sim';
import { PowerCut } from './bank/power';
import { RaisedFloors } from './bank/raised';
import { PlayMode, type PlayParts } from './bank/sim';
import { Walls } from './bank/walls';
import { M1_CREW } from '../game/heist';
import { crewColour } from '../ui/hud/viewModels';
import { crewLookOf } from '../game/plan';

/** What the game (`/`) hands the scene through the registry (`play`): the Session and the bank it is played in. */
export type PlaySetup = Pick<PlayParts, 'session' | 'bank' | 'resumed' | 'next'> & { /** How long finding or making the heist took (ms). */ setupMs?: number };

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
    /** Play mode (the game, `/`): the bank driven by a Session. */
    private play?: PlayMode;
    /**
     * The planning screen (`?plan`, M4-07): the plot on the tactical map at what the crew knows at the start, nobody moving, the
     * HTML planner (src/ui/planning) over it.
     */
    private planning = false;
    /** The planning map's tile visibility codes (`showPlan`), row-major. */
    private planVisibility?: Uint8Array;
    /** The planned heist's vehicles as drawn on the planning screen. */
    private planVehicles?: Vehicles;
    /** The bank with the power out (play mode). */
    private power?: PowerCut;

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
        this.planning = this.registry.get('planning') === true;
        const { level } = this.bank;
        this.mapWidth = level.tiles[0]!.length * TILE;
        this.mapHeight = level.tiles.length * TILE;

        this.timings = {};
        const props = this.timed('prop art', () => placeProps(this.bank));
        const { lamps, electric, reach } = this.timed('lamp reach', () => {
            const { lamps, electric } = bankLamps(this.bank, props), reach = new LampReach(lightBlockers(level), lamps);
            this.litTiles = tileLight(level, lamps, reach).map(row => row.map(light => light >= LIT));
            return { lamps, electric, reach };
        });
        const exposure = this.timed('exposure', () => buildExposure(level));
        const baker = (this.baker = new Baker(this, lamps, reach, exposure));
        const atmosphere = (this.atmosphere = new Atmosphere(this, level, this.still));
        // Raised floors (§14.7) are drawn a storey up, and cut down as walls are; what stands on them goes with them.
        const heights = (this.heights = new Heights(level)), raised = new RaisedFloors(this, level, heights);
        this.walls = new Walls(this, level, heights, { front: y => atmosphere.frontTop(y), far: y => atmosphere.farTop(y) });
        const knowledge = (this.knowledge = new Knowledge(this, this.bank.outlines ?? [], heights));
        this.people = new People(this, baker, (x, y) => knowledge.hides(x, y), heights);
        this.camera = new BankCamera(this, this.mapWidth, this.mapHeight, !play && !this.planning);

        const floor = this.timed('floor', () => addFloor(baker, level, props.filter(({ box }) => box.h === 0)));
        this.timed('walls', () => this.walls.build(baker));
        const standing = props.filter(({ box }) => box.h > 0);
        const { occluders, casters, shown } = this.timed('props', () => addProps(this, baker, this.walls, standing, heights));
        // The crew's vehicles, as rules/vehicles.ts names them: in the order the generator placed them.
        const built = new Map<string, ShownProp>();
        standing.forEach(({ p }, i) => { if (VEHICLE_PROPS.has(p.kind)) built.set(built.size ? `van-${built.size}` : 'van', shown[i]!); });
        knowledge.trackProps(shown);
        knowledge.trackRaised(raised);
        this.timed('people', () => this.people.build(this.bank.people, play ? play.session.state.crew.map((c, i) => ({
            look: crewLookOf(c.id) ?? M1_CREW.find(m => m.id === c.id)?.look ?? 'crewSol', tx: c.pos.x, ty: c.pos.y, facing: 'back' as const, ring: crewColour(c.id, i)
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
        if (this.planning) {
            // The blueprint's knowledge (§17.8) until the planner says what the crew knows at the start (`showPlan`: the
            // intel's too); nobody shows until it says whom, and the vehicles stand where the plan parks them.
            knowledge.show(false);
            // A predicted NPC on a hidden tile (the Guard rota, a routine learned before) is drawn over its block, as in play.
            this.people.alsoAbove((index, x, y) => index < this.bank.people.length && this.planHiddenAt(x, y));
            this.planVehicles = new Vehicles(baker, this.bank, built);
            this.bank.people.forEach((_, i) => this.people.setAway(i, true));
            this.camera.toggleMap();
            this.walls.update(0, this.cameras.main.midPoint.y, this.camera.onMap);
            this.walls.settle();
        }
        if (play) this.timed('play', () => {
            // A power cut (§14.6) darkens the rules' building: drawn when the state first has one.
            const world = play.session.world;
            this.power = new PowerCut(this, baker, electric, {
                walls: this.walls, people: this.people, props: shown, width: this.mapWidth, height: this.mapHeight, dark: (tx, ty) => darkensAt(world, { x: tx, y: ty })
            });
            this.play = new PlayMode(this, {
                ...play, people: this.people, walls: this.walls, camera: this.camera, knowledge, vehicles: new Vehicles(baker, this.bank, built), power: this.power
            });
            this.camera.prepareZoomIn();
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
            if (!this.play && !this.planning) this.people.update(deltaMs);
        }
        this.play?.update(deltaMs);
        this.camera.update(dt);
        this.walls.update(deltaMs, this.cameras.main.midPoint.y, this.camera.onMap);
    }

    /** Exposed so automated tests can frame shots without reaching into private fields. */
    get debugState() {
        const cam = this.cameras.main, { zoom, zoomLevels, map, plot } = this.camera.state;
        return {
            ready: true, width: this.mapWidth, height: this.mapHeight, lamps: this.baker.lamps.length,
            /** Each stage's ms, and once the power first went out, how long drawing that took (`power cut`). */
            timings: this.power?.built !== undefined ? { ...this.timings, 'power cut': this.power.built } : this.timings,
            /** The power is out as drawn (§14.6). */
            powerOut: this.power?.isOut ?? false,
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
            /** Play mode's selection, preview, playback and doors (the game, `/`). */
            play: this.play?.state
        };
    }

    /** Where the middle of tile (tx, ty) is on the page, in CSS pixels (for tests: where to tap). */
    tileOnPage(tx: number, ty: number): { x: number; y: number } {
        const cam = this.cameras.main, box = this.game.canvas.getBoundingClientRect();
        const sx = box.width / this.scale.width, sy = box.height / this.scale.height;
        return { x: box.left + ((tx + 0.5) * TILE - cam.worldView.x) * sx, y: box.top + ((ty + 0.5) * TILE - cam.worldView.y) * sy };
    }

    /**
     * The planning screen's picture of the heist's start (decision 328): only the NPCs the crew knows then (by the bank's
     * people's order), as play draws them at turn 1 (a predicted one translucent), and the vehicles where the plan parks them.
     */
    showPlan(view: { npcs: readonly (MarkerKind | null)[]; vehicles: DeepReadonly<Record<string, VehicleState>>; visibility: Uint8Array }): void {
        // Each tile as the crew knows it at the start (decision 402): hidden ones blocked, as play draws them.
        this.planVisibility = view.visibility;
        this.knowledge.show(true);
        this.knowledge.showHidden(view.visibility, this.mapWidth / TILE);
        this.bank.people.forEach((_, i) => {
            const kind = view.npcs[i] ?? null;
            this.people.setAway(i, kind === null);
            if (kind) this.people.setAlpha(i, kind === 'live' ? 1 : kind === 'predicted' ? 0.55 : 0.3);
        });
        this.planVehicles?.sync(view.vehicles);
        this.people.reveal();
    }

    /** Whether map point (x, y) is on a tile the planning map shows as hidden. */
    private planHiddenAt(x: number, y: number): boolean {
        const v = this.planVisibility, w = this.mapWidth / TILE, tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
        return !!v && tx >= 0 && ty >= 0 && tx < w && v[ty * w + tx] === 0;
    }

    /** The tile under page point (x, y), in CSS pixels (the planner's taps): the inverse of `tileOnPage`. */
    tileAtPage(x: number, y: number): { x: number; y: number } {
        const cam = this.cameras.main, box = this.game.canvas.getBoundingClientRect();
        const sx = box.width / this.scale.width, sy = box.height / this.scale.height;
        return { x: Math.floor(((x - box.left) / sx + cam.worldView.x) / TILE), y: Math.floor(((y - box.top) / sy + cam.worldView.y) / TILE) };
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
