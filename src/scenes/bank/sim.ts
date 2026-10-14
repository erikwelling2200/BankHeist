import Phaser from 'phaser';
import type { ActionId, PlaybackItem, PlaybackSpeed, Session, SessionChange } from '../../game';
import type { GeneratedBank } from '../../gen/model';
import { TILE } from '../../level/level';
import type { PersonFacing } from '../../level/plan';
import {
    crewMoveOptions, dashBudget, doorStatus, DASH_ACTIONS, MOVE_ACTIONS, moveBudget, pathTo, reachable, reachAt, validatePath,
    type Command, type CrewState, type Facing, type Pos, type Reach, type SimEvent
} from '../../sim';
import { mountHud } from '../../ui/hud/mountHud';
import { CREW_COLOURS, type HudHandle, type OverlayId } from '../../ui/hud/viewModels';
import type { BankCamera } from './camera';
import { MapInput } from './input';
import { WorldOverlay } from './overlay';
import type { People } from './people';
import type { Walls } from './walls';

/*
 * Play mode (`?play`, implementation plan §2.5, M1-13): the bank scene driven by a Session. The people stand where the
 * state says (no real-time patrols), the crew with their rings; doors show open or closed; taps and drags on the map
 * become previews and commands (UI.md "Touch grammar"); the HUD (src/ui/hud) shows the Session's view models and
 * reports back; and the events of each commit and world phase play back (§20.5) at 1×, 2× or instantly.
 */

/** A crew member walks a tile in this long at 1× (a little brisk: a whole turn's moves stay short). */
const STEP_MS = 150;
/** How long the camera takes to reach an important event, and stays on it, at 1×. */
const VISIT_PAN_MS = 300;
const VISIT_HOLD_MS = 450;
/** The whole quiet world phase fits in this (§20.5). */
const QUIET_BUDGET_MS = 2000;
/** A tap snaps to a valid tile no further than this (tiles) from where it landed. */
const SNAP_TILES = 1.5;
/** How many tiles north of the crew the first view of a heist is centred. */
const OPENING_LIFT = 3;
const SPEEDS: readonly PlaybackSpeed[] = ['1x', '2x', 'instant'];
const SPEED_LABEL: Record<PlaybackSpeed, string> = { '1x': '1×', '2x': '2×', instant: '⏭' };

/** The rules' eight facings as drawn: people are drawn facing the camera or away from it. */
function drawnFacing(f: Facing, current: PersonFacing): PersonFacing {
    if (f === 'n' || f === 'ne' || f === 'nw') return 'back';
    if (f === 's' || f === 'se' || f === 'sw') return 'front';
    return current;
}

const centre = (p: Pos): [number, number] => [(p.x + 0.5) * TILE, (p.y + 0.5) * TILE];
const same = (a: Pos | undefined, b: Pos | undefined): boolean => !!a && !!b && a.x === b.x && a.y === b.y;

/** A crew member walking a path on screen. */
interface Walk { index: number; points: [number, number][]; leg: number; t: number; msPerLeg: number }

export interface PlayParts {
    session: Session;
    bank: GeneratedBank;
    people: People;
    walls: Walls;
    camera: BankCamera;
    /** The heist was resumed: show the recap card first (§20.6). */
    resumed: boolean;
}

export class PlayMode {
    private readonly session: Session;
    private readonly people: People;
    private readonly walls: Walls;
    private readonly camera: BankCamera;
    private readonly hud: HudHandle;
    private readonly overlay: WorldOverlay;
    private readonly input: MapInput;
    /** Each NPC's and crew member's sprite index, by id. */
    private readonly sprite = new Map<string, number>();
    private readonly unsubscribe: () => void;
    private readonly chrome: HTMLElement[] = [];
    /** The action picked before a tile (Move or Dash), kept in the Session's UI state so a resume does the same. */
    private get mode(): ActionId {
        return this.session.ui.action === 'dash' ? 'dash' : 'move';
    }

    private set mode(mode: ActionId) {
        this.session.setAction(mode === 'move' ? null : mode);
    }
    private mapOn = false;
    private overlays: Partial<Record<OverlayId, boolean>> = {};
    private recap: boolean;
    /** The path being dragged, and whether it is legal so far. */
    private dragPath?: Pos[];
    private walk?: Walk;
    private holdMs = 0;
    /** How long each camera visit of the world phase being played may take, so the quiet phase fits its budget. */
    private visitMs = VISIT_PAN_MS + VISIT_HOLD_MS;
    private playing = false;
    /** The door states shown, by door id. */
    private shownDoors = new Map<string, boolean>();

    constructor(private readonly scene: Phaser.Scene, parts: PlayParts) {
        const { session, bank, people, walls, camera } = parts;
        this.session = session;
        this.people = people;
        this.walls = walls;
        this.camera = camera;
        this.recap = parts.resumed && session.recent.length > 0;
        bank.people.forEach((p, i) => this.sprite.set(p.id, i));
        session.state.crew.forEach((c, i) => this.sprite.set(c.id, bank.people.length + i));
        document.body.classList.add('play');

        this.overlay = new WorldOverlay(scene);
        this.input = new MapInput(scene, {
            tap: (x, y) => this.tap(x, y),
            claim: (x, y) => this.claim(x, y),
            drag: (x, y) => this.dragTo(x, y),
            release: cancelled => this.release(cancelled)
        });
        camera.holdPan = () => this.input.drawing;
        camera.onMapChange = on => {
            this.mapOn = on;
            this.refresh();
        };

        this.hud = mountHud(document.body, {
            selectCrew: id => this.select(id),
            action: id => this.pickAction(id as ActionId),
            confirm: () => this.confirm(),
            undo: () => this.undo(),
            endTurn: () => this.endTurn(),
            toggleOverlay: (id, on) => {
                this.overlays = { ...this.overlays, [id]: on };
                this.refresh();
            },
            ledgerJump: pos => this.camera.centreOn(...centre(pos), 250),
            toggleMap: () => this.camera.toggleMap(),
            resume: () => {
                this.recap = false;
                this.refresh();
            }
        });
        this.addChrome();
        this.unsubscribe = session.subscribe(change => this.onChange(change));
        scene.input.keyboard?.on('keydown', this.onKey, this);
        // Right-click cancels the preview (§20.7), instead of opening the browser's menu.
        scene.input.mouse?.disableContextMenu();
        scene.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
            if (p.rightButtonDown() && this.session.pendingCommand) this.session.setPendingCommand(null);
        });

        this.syncAll();
        this.session.playback.clear();
        const selected = session.selected;
        const at = selected ? session.state.crew.find(c => c.id === selected)?.pos : session.state.crew[0]?.pos;
        const saved = session.camera;
        if (saved) this.camera.restore(saved.zoom, saved.x, saved.y, saved.map);
        // A new heist opens on the crew, a little north of them so the bank they face shows, kept on the plot.
        else if (at) this.camera.centreOn(...this.camera.clampToPlot(centre(at)[0], centre(at)[1] - OPENING_LIFT * TILE));
        this.refresh();
        scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    }

    /** For tests: what play mode shows and is doing. */
    get state() {
        return {
            selected: this.session.selected, pending: this.session.pendingCommand, mode: this.mode, playing: this.busy,
            speed: this.session.playback.speed, path: this.overlay.state.path, dash: this.overlay.state.dash, reach: this.overlay.state.reach,
            doorsOpen: [...this.shownDoors].filter(([, open]) => open).map(([id]) => id)
        };
    }

    /** Per frame: plays back what the Session queued, a walk or a camera visit at a time. */
    update(deltaMs: number): void {
        if (this.walk) {
            this.advanceWalk(deltaMs);
            return;
        }
        if (this.holdMs > 0) {
            this.holdMs -= deltaMs;
            return;
        }
        const queue = this.session.playback;
        if (queue.speed === 'instant' && queue.length) {
            for (const item of queue.drain()) this.applyInstantly(item);
            this.playing = true;
        }
        const item = queue.next();
        if (item) {
            this.playing = true;
            this.play(item);
            return;
        }
        if (this.playing) {
            this.playing = false;
            this.syncAll();
            this.refresh();
        }
        // Where the camera looks goes into the UI save (debounced), so a resume opens on the same view.
        const view = this.camera.view, cam = this.session.camera;
        const x = Math.round(view.x), y = Math.round(view.y);
        if (!cam || cam.x !== x || cam.y !== y || cam.zoom !== view.zoom || !!cam.map !== view.map) {
            this.session.setCamera({ x, y, zoom: view.zoom, ...(view.map ? { map: true } : {}) });
        }
    }

    // ------------------------------------------------------------------------------------------------- Playback

    private play(item: PlaybackItem): void {
        const e = item.event, speed = this.session.playback.duration(1);
        this.applyDoors(e);
        if (e.type === 'moved') {
            const index = this.sprite.get(e.crew);
            if (index === undefined || speed === 0) return;
            const points = [e.from, ...e.path].map(centre);
            this.walk = { index, points, leg: 0, t: 0, msPerLeg: STEP_MS * speed };
            return;
        }
        if (e.type === 'phaseStarted' && e.phase === 'world') {
            // The quiet world phase fits its budget: share it out among the visits it holds (§20.5).
            const visits = this.session.playback.pending().filter(i => i.important && i.turn === item.turn).length;
            this.visitMs = visits ? Math.min(VISIT_PAN_MS + VISIT_HOLD_MS, QUIET_BUDGET_MS / visits) : 0;
        }
        const at = item.important && this.eventPos(e);
        if (at && speed > 0) {
            const ms = this.visitMs * speed, pan = Math.min(ms * 0.4, VISIT_PAN_MS * speed);
            this.camera.centreOn(...centre(at), pan);
            this.holdMs = ms;
        }
    }

    /** Finishes an event at once: doors and positions are synced when the queue empties. */
    private applyInstantly(item: PlaybackItem): void {
        this.applyDoors(item.event);
    }

    private applyDoors(e: SimEvent): void {
        if (e.type === 'doorOpened') this.showDoor(e.door, true);
        else if ((e as { type: string }).type === 'doorClosed') this.showDoor((e as unknown as { door: string }).door, false);
    }

    private advanceWalk(deltaMs: number): void {
        const w = this.walk!;
        w.t += deltaMs / Math.max(1, w.msPerLeg);
        while (w.t >= 1 && w.leg < w.points.length - 1) {
            w.t -= 1;
            w.leg++;
        }
        if (w.leg >= w.points.length - 1) {
            const [x, y] = w.points.at(-1)!;
            this.people.move(w.index, x, y);
            this.walk = undefined;
            return;
        }
        const [fx, fy] = w.points[w.leg]!, [tx, ty] = w.points[w.leg + 1]!;
        const x = Math.round(fx + (tx - fx) * w.t), y = Math.round(fy + (ty - fy) * w.t);
        const now = this.people.at(w.index);
        const facing: PersonFacing = ty > fy ? 'front' : ty < fy ? 'back' : now.facing;
        if (x !== now.x || y !== now.y || facing !== now.facing) this.people.move(w.index, x, y, facing);
    }

    /** Where an event happened, for the camera: a carrier's holder. */
    private eventPos(e: SimEvent): Pos | undefined {
        const state = this.session.state;
        if (e.type === 'carrierStarted' || e.type === 'carrierTicked' || e.type === 'alarmRaised') return state.carriers.find(c => c.id === e.carrier)?.pos;
        const who = (e as { npc?: string; crew?: string }).npc ?? (e as { crew?: string }).crew;
        return who ? (state.npcs.find(n => n.id === who) ?? state.crew.find(c => c.id === who))?.pos : undefined;
    }

    /** Every person and door where the state has them (after a skip, an undo, a resume). */
    private syncAll(): void {
        this.walk = undefined;
        const { state, world } = this.session;
        for (const p of [...state.npcs, ...state.crew]) {
            const index = this.sprite.get(p.id);
            if (index === undefined) continue;
            const [x, y] = centre(p.pos), now = this.people.at(index), facing = drawnFacing(p.facing, now.facing);
            if (now.x !== x || now.y !== y || now.facing !== facing) this.people.move(index, x, y, facing);
        }
        for (const id of Object.keys(world.doors)) {
            const status = doorStatus(world, state, id);
            this.showDoor(id, status === 'open' || status === 'breached');
        }
    }

    private showDoor(id: string, open: boolean): void {
        if ((this.shownDoors.get(id) ?? false) === open) return;
        this.shownDoors.set(id, open);
        for (const edge of Object.values(this.session.world.edges)) if (edge.door === id) this.walls.setDoorOpen(edge.run, edge.tx, edge.ty, open);
    }

    // ------------------------------------------------------------------------------------------------- Input

    private get busy(): boolean {
        return this.playing || !!this.walk || this.session.playback.length > 0;
    }

    /** Tap to skip (§20.5): everything queued is shown at once. */
    private skip(): void {
        for (const item of this.session.playback.drain()) this.applyInstantly(item);
        this.holdMs = 0;
        this.scene.cameras.main.panEffect.reset();
        this.syncAll();
        this.playing = false;
        this.refresh();
    }

    private selectedMember(): CrewState | undefined {
        const id = this.session.selected;
        return id ? this.session.state.crew.find(c => c.id === id) : undefined;
    }

    private crewAt(x: number, y: number): CrewState | undefined {
        return this.session.state.crew.find(c => this.people.hit(this.sprite.get(c.id)!, x, y));
    }

    private select(id: string): void {
        if (this.busy) this.skip();
        if (this.recap) return;
        const member = this.session.state.crew.find(c => c.id === id);
        if (!member) return;
        if (this.session.selected !== id) {
            this.session.select(id);
            this.session.setPendingCommand(null);
            this.mode = 'move';
            // The camera centres on the newly selected crew member, zooming in to Act view if further out (§20.1).
            this.camera.actView(...centre(member.pos), 250);
        }
        this.refresh();
    }

    private tap(x: number, y: number): void {
        if (this.busy) return this.skip();
        if (this.recap) return;
        const tile = { x: Math.floor(x / TILE), y: Math.floor(y / TILE) }, { crew } = this.session.state;
        // Someone standing on the tile tapped; then a second tap on the previewed tile, which commits it (UI.md); then
        // someone whose drawing (standing up over the tiles behind them) was tapped.
        const onTile = crew.find(c => same(c.pos, tile));
        if (onTile) return onTile.id === this.session.selected ? undefined : this.select(onTile.id);
        const pending = this.session.pendingCommand;
        if (pending && 'path' in pending && same(pending.path.at(-1), tile)) return this.confirm();
        const member = this.selectedMember();
        const canAct = !!member && this.session.state.phase === 'crew' && member.actionsLeft > 0;
        const target = canAct ? this.snap(member, x / TILE - 0.5, y / TILE - 0.5) : undefined;
        // A drawing stands over the tiles behind it: tapping one selects them, unless that tile is somewhere the selected
        // crew member can go.
        const drawn = this.crewAt(x, y);
        if (drawn && drawn.id !== this.session.selected && !same(target?.pos, tile)) return this.select(drawn.id);
        // Only a tap on the previewed tile itself commits; one that snaps to it from a tile beside it just previews again.
        if (!target || (pending && 'path' in pending && same(pending.path.at(-1), target.pos))) return;
        this.preview(target.command);
    }

    /** The reach of the selected member for both moves: Dash's when they have the actions, else Move's. */
    private reach(member: CrewState): { reach: Reach; move: number; dash: number | null } {
        const { world, state } = this.session, move = moveBudget(world, member);
        const dash = member.actionsLeft >= DASH_ACTIONS ? dashBudget(world) : null;
        const reach = reachable(world, state, member.pos, Math.max(move, dash ?? 0), crewMoveOptions(member));
        return { reach, move, dash };
    }

    /** The valid tile nearest map tile point (fx, fy) and the move to it: a Move if it is in Move's reach and Dash wasn't picked. */
    private snap(member: CrewState, fx: number, fy: number): { pos: Pos; command: Command } | undefined {
        const { reach, move, dash } = this.reach(member);
        let best: { pos: Pos; d: number } | undefined;
        for (const t of reach.tiles) {
            if (!t.canEnd || t.cost === 0) continue;
            const isMove = t.cost <= move && member.actionsLeft >= MOVE_ACTIONS && this.mode !== 'dash';
            if (!isMove && dash === null) continue;
            const d = Math.hypot(t.pos.x - fx, t.pos.y - fy);
            if (d <= SNAP_TILES && (!best || d < best.d)) best = { pos: t.pos, d };
        }
        if (!best) return undefined;
        const path = pathTo(reach, best.pos)!, cost = reachAt(reach, best.pos)!.cost;
        const type = this.mode === 'dash' || cost > move ? 'dash' : 'move';
        return { pos: best.pos, command: { type, crew: member.id, path } };
    }

    /** Shows `cmd` as the pending preview, if the rules allow it. */
    private preview(cmd: Command): boolean {
        try {
            this.session.playerPreview(cmd);
        } catch {
            return false;
        }
        this.session.setPendingCommand(cmd);
        if (cmd.type === 'move' || cmd.type === 'dash') this.mode = cmd.type;
        this.refresh();
        return true;
    }

    private claim(x: number, y: number): boolean {
        const member = this.selectedMember();
        if (this.busy || this.recap || !member || member.actionsLeft === 0 || this.session.state.phase !== 'crew') return false;
        if (!this.people.hit(this.sprite.get(member.id)!, x, y)) return false;
        this.dragPath = [];
        return true;
    }

    /** Extends the dragged path to the tile under (x, y), a step at a time; going back over the last step takes it back. */
    private dragTo(x: number, y: number): void {
        const member = this.selectedMember(), path = this.dragPath;
        if (!member || !path) return;
        const to = { x: Math.floor(x / TILE), y: Math.floor(y / TILE) };
        for (let guard = 0; guard < 64; guard++) {
            const last = path.at(-1) ?? member.pos;
            if (same(last, to)) break;
            const step = { x: last.x + Math.sign(to.x - last.x), y: last.y + Math.sign(to.y - last.y) };
            if (same(path.at(-2) ?? (path.length ? member.pos : undefined), step)) path.pop();
            else path.push(step);
        }
        this.refresh();
    }

    private release(cancelled: boolean): void {
        const member = this.selectedMember(), path = this.dragPath;
        this.dragPath = undefined;
        if (cancelled || !member || !path?.length) return this.refresh();
        const { world, state } = this.session, options = crewMoveOptions(member);
        const asMove = this.mode !== 'dash' && validatePath(world, state, member.pos, path, moveBudget(world, member), options);
        const asDash = member.actionsLeft >= DASH_ACTIONS ? validatePath(world, state, member.pos, path, dashBudget(world), options) : undefined;
        if (asMove && asMove.ok) this.preview({ type: 'move', crew: member.id, path });
        else if (asDash?.ok) this.preview({ type: 'dash', crew: member.id, path });
        else {
            // The longest legal start of what was drawn.
            const at = Math.max(asMove && !asMove.ok ? asMove.at : 0, asDash && !asDash.ok ? asDash.at : 0);
            for (let n = at; n > 0; n--) {
                const part = path.slice(0, n);
                const type = validatePath(world, state, member.pos, part, moveBudget(world, member), options).ok && this.mode !== 'dash' ? 'move' : 'dash';
                if (this.preview({ type, crew: member.id, path: part })) return;
            }
            this.refresh();
        }
    }

    private pickAction(id: ActionId): void {
        if (this.busy) this.skip();
        if (this.recap) return;
        const member = this.selectedMember();
        if (!member) return;
        if (id === 'wait') {
            this.preview({ type: 'wait', crew: member.id });
            return;
        }
        this.mode = id;
        const pending = this.session.pendingCommand;
        if (pending && 'path' in pending) {
            if (!this.preview({ type: id, crew: member.id, path: [...pending.path] })) this.session.setPendingCommand(null);
        }
        this.refresh();
    }

    private confirm(): void {
        const cmd = this.session.pendingCommand;
        if (!cmd || this.busy) return;
        try {
            this.session.commit(cmd);
        } catch (e) {
            console.warn(`Can't do that: ${(e as Error).message}`);
            this.session.setPendingCommand(null);
        }
        this.mode = 'move';
        this.refresh();
    }

    private undo(): void {
        if (this.busy) this.skip();
        this.session.undo();
    }

    private endTurn(): void {
        if (this.busy) this.skip();
        this.session.setPendingCommand(null);
        this.session.endTurn();
    }

    private onKey(e: KeyboardEvent): void {
        if (e.key === 'f' || e.key === 'F') this.cycleSpeed();
        else if (e.key === 'Escape' && this.session.pendingCommand) this.session.setPendingCommand(null);
    }

    private cycleSpeed(): void {
        const queue = this.session.playback;
        queue.speed = SPEEDS[(SPEEDS.indexOf(queue.speed) + 1) % SPEEDS.length]!;
        this.refresh();
    }

    // ------------------------------------------------------------------------------------------------- Showing

    private onChange(change: SessionChange): void {
        if (change.kind === 'undo') this.syncAll();
        this.refresh();
    }

    /** The HUD, the rings and the overlay, from the Session. */
    private refresh(): void {
        const { session } = this, vm = session.hud({ mode: this.mode, mapOn: this.mapOn, overlays: this.overlays });
        this.hud.update(this.recap ? { ...vm, recap: session.recap() } : vm);
        session.state.crew.forEach(c => this.people.highlight(this.sprite.get(c.id)!, c.id === session.selected));
        const speed = this.chrome[0];
        if (speed) speed.textContent = SPEED_LABEL[session.playback.speed];
        this.overlay.set(this.overlayContent());
    }

    private overlayContent(): Parameters<WorldOverlay['set']>[0] {
        const member = this.selectedMember();
        if (!member || this.busy || this.recap || this.session.state.phase !== 'crew') return null;
        const colour = CREW_COLOURS[this.session.state.crew.indexOf(member) % CREW_COLOURS.length]!;
        if (this.dragPath) {
            const { world, state } = this.session, budget = member.actionsLeft >= DASH_ACTIONS ? dashBudget(world) : moveBudget(world, member);
            const check = validatePath(world, state, member.pos, this.dragPath, budget, crewMoveOptions(member));
            return { colour, from: member.pos, path: this.dragPath, badFrom: check.ok ? undefined : check.at };
        }
        const pending = this.session.pendingCommand;
        if (pending && 'path' in pending) return { colour, from: member.pos, path: pending.path as Pos[], dash: pending.type === 'dash' };
        if (member.actionsLeft === 0 || pending) return null;
        const { reach, move } = this.reach(member);
        const ends = reach.tiles.filter(t => t.canEnd && t.cost > 0);
        return {
            colour,
            reach: { move: ends.filter(t => t.cost <= move && this.mode !== 'dash').map(t => t.pos), dash: ends.filter(t => t.cost > move || this.mode === 'dash').map(t => t.pos) }
        };
    }

    /** Play mode's own buttons beside the HUD's camera tools: the playback speed (§20.5). */
    private addChrome(): void {
        const speed = document.createElement('button');
        speed.className = 'play-speed';
        speed.setAttribute('aria-label', 'Playback speed (F)');
        speed.addEventListener('pointerdown', e => e.stopPropagation());
        speed.addEventListener('click', () => this.cycleSpeed());
        document.body.append(speed);
        this.chrome.push(speed);
    }

    private destroy(): void {
        this.unsubscribe();
        this.hud.destroy();
        for (const el of this.chrome) el.remove();
        this.scene.input.keyboard?.off('keydown', this.onKey, this);
        document.body.classList.remove('play');
    }
}
