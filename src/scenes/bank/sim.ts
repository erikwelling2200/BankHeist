import Phaser from 'phaser';
import { dashRefusal, moveAlong, moveRange, moveTo, type ActionId, type MoveRange, type PlaybackItem, type PlaybackSpeed, type Session, type SessionChange } from '../../game';
import type { GeneratedBank } from '../../gen/model';
import { TILE } from '../../level/level';
import type { PersonFacing } from '../../level/plan';
import {
    COMBAT_STATUSES, crewPicture, IllegalCommand, knownView, doorStatus, soundRing,
    type Command, type CrewState, type KnownView, type MarkerKind, type State, type Facing, type Pos, type SimEvent
} from '../../sim';
import { mountHud } from '../../ui/hud/mountHud';
import { CREW_COLOURS, type HudHandle, type OverlayId } from '../../ui/hud/viewModels';
import type { BankCamera } from './camera';
import { MapInput } from './input';
import { WorldOverlay, type OverlayContent } from './overlay';
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
/** Of which the passive NPCs' walk takes at most this much, at 1×. */
const NPC_WALK_BUDGET_MS = 1200;
/** A tap snaps to a valid tile no further than this (tiles) from where it landed. */
const SNAP_TILES = 1.5;
/** How many tiles north of the crew the first view of a heist is centred. */
const OPENING_LIFT = 3;
/** How solid an NPC the crew knows of is drawn: seen now, predicted from its routine, or a ghost of where it was. */
const MARKER_ALPHA: Record<MarkerKind, number> = { live: 1, predicted: 0.55, ghost: 0.3 };
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

/**
 * People walking on screen together, a step at a time: a crew member's move, or the passive NPCs of a world phase in one
 * simultaneous motion (§20.5). Each walker stops at the end of their own path.
 */
interface Walk { walkers: { index: number; points: [number, number][] }[]; leg: number; t: number; msPerLeg: number; legs: number }

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
    private mapOn = false;
    private overlays: Partial<Record<OverlayId, boolean>> = {};
    private recap: boolean;
    /** The path being dragged, and whether it is legal so far. */
    private dragPath?: Pos[];
    private walk?: Walk;
    private holdMs = 0;
    /** How long each camera visit of the world phase being played may take, so the quiet phase fits its budget. */
    private visitMs = VISIT_PAN_MS + VISIT_HOLD_MS;
    /** How long a step of the passive NPCs' walk takes in the world phase being played, at 1×. */
    private npcStepMs = STEP_MS;
    private playing = false;
    /** The door states shown, by door id. */
    private shownDoors = new Map<string, boolean>();
    private knownFor?: State;
    private knownCache?: KnownView;
    /** The selected member's range, worked out once per state and member. */
    private rangeFor?: { state: State; id: string; range: MoveRange };

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
            selected: this.session.selected, pending: this.session.pendingCommand, playing: this.busy,
            speed: this.session.playback.speed, path: this.overlay.state.path, dash: this.overlay.state.dash, reach: this.overlay.state.reach,
            /** How many of the range's tiles only a Dash reaches, and how many tiles the previewed dash's noise reaches. */
            dashReach: this.overlay.state.dashReach, range: this.overlay.state.range, noise: this.overlay.state.noise,
            intents: this.overlay.state.intents,
            /** The NPC markers the crew knows of (§8.15), in the order of `state.npcs`; null for one it doesn't. */
            npcs: this.session.state.npcs.map(n => {
                const m = this.known().npcs.find(k => k.id === n.id);
                return m ? { id: m.id, kind: m.kind, pos: m.pos } : null;
            }),
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
        this.applyEvent(e);
        if (e.type === 'moved') {
            const index = this.sprite.get(e.crew);
            if (index === undefined || speed === 0) return;
            this.startWalk([{ index, points: [e.from, ...e.path].map(centre) }], STEP_MS * speed);
            return;
        }
        if (e.type === 'npcWalked') {
            if (speed === 0) return;
            // NPCs in combat (§20.5) act one at a time, the camera following each; none are yet (M3).
            if (this.inCombat(e.npc)) {
                const index = this.sprite.get(e.npc);
                if (index === undefined) return;
                this.camera.centreOn(...centre(e.path.at(-1)!), VISIT_PAN_MS * speed);
                this.startWalk([{ index, points: [e.from, ...e.path].map(centre) }], STEP_MS * speed);
                return;
            }
            // The passive NPCs move together: every passive walk of this world phase, in one motion. The doors they
            // open on the way open as they set off.
            const group = [e], taken: number[] = [];
            for (const other of this.session.playback.pending()) {
                if (other.turn !== item.turn) break;
                const o = other.event;
                if (o.type === 'phaseStarted') break;
                if (o.type === 'npcWalked' && !this.inCombat(o.npc)) { group.push(o); taken.push(other.seq); }
                else if (o.type === 'doorOpened' && this.sprite.has(o.by) && !this.session.state.crew.some(c => c.id === o.by)) { this.applyEvent(o); taken.push(other.seq); }
            }
            this.session.playback.remove(taken);
            const walkers = group.flatMap(w => {
                const index = this.sprite.get(w.npc);
                return index === undefined ? [] : [{ index, points: [w.from, ...w.path].map(centre) }];
            });
            this.startWalk(walkers, this.npcStepMs * speed);
            return;
        }
        if (e.type === 'phaseStarted' && e.phase === 'world') {
            // The quiet world phase fits its budget (§20.5): the NPCs' walk, then the visits share what is left.
            const items = this.session.playback.pending().filter(i => i.turn === item.turn);
            const visits = items.filter(i => i.important).length;
            const legs = Math.max(0, ...items.map(i => (i.event.type === 'npcWalked' && !this.inCombat(i.event.npc) ? i.event.path.length : 0)));
            this.npcStepMs = legs ? Math.min(STEP_MS, NPC_WALK_BUDGET_MS / legs) : STEP_MS;
            const left = QUIET_BUDGET_MS - legs * this.npcStepMs;
            this.visitMs = visits ? Math.min(VISIT_PAN_MS + VISIT_HOLD_MS, left / visits) : 0;
        }
        const at = item.important && this.eventPos(e);
        if (at && speed > 0) {
            const ms = this.visitMs * speed, pan = Math.min(ms * 0.4, VISIT_PAN_MS * speed);
            this.camera.centreOn(...centre(at), pan);
            this.holdMs = ms;
        }
    }

    private inCombat(npc: string): boolean {
        const n = this.session.state.npcs.find(x => x.id === npc);
        return !!n && COMBAT_STATUSES.has(n.status);
    }

    private startWalk(walkers: Walk['walkers'], msPerLeg: number): void {
        const legs = Math.max(0, ...walkers.map(w => w.points.length - 1));
        if (legs) this.walk = { walkers, leg: 0, t: 0, msPerLeg, legs };
    }

    /** Finishes an event at once: doors and positions are synced when the queue empties. */
    private applyInstantly(item: PlaybackItem): void {
        this.applyEvent(item.event);
    }

    /** What an event changes at once: doors, and NPCs arriving or leaving the map. */
    private applyEvent(e: SimEvent): void {
        if (e.type === 'doorOpened') this.showDoor(e.door, true);
        else if (e.type === 'doorClosed') this.showDoor(e.door, false);
        else if (e.type === 'npcEntered' || e.type === 'npcLeft') {
            const index = this.sprite.get(e.npc);
            if (index === undefined) return;
            this.people.move(index, ...centre(e.at));
            this.people.setAway(index, e.type === 'npcLeft');
        }
    }

    private advanceWalk(deltaMs: number): void {
        const w = this.walk!;
        w.t += deltaMs / Math.max(1, w.msPerLeg);
        while (w.t >= 1 && w.leg < w.legs) {
            w.t -= 1;
            w.leg++;
        }
        for (const { index, points } of w.walkers) {
            const last = points.length - 1, leg = Math.min(w.leg, last), t = w.leg >= last ? 0 : w.t;
            const [fx, fy] = points[leg]!, [tx, ty] = points[Math.min(leg + 1, last)]!;
            const x = Math.round(fx + (tx - fx) * t), y = Math.round(fy + (ty - fy) * t);
            const now = this.people.at(index);
            const facing: PersonFacing = ty > fy ? 'front' : ty < fy ? 'back' : now.facing;
            if (x !== now.x || y !== now.y || facing !== now.facing) this.people.move(index, x, y, facing);
        }
        if (w.leg >= w.legs) this.walk = undefined;
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
        // The crew where they are; the NPCs as the crew knows them (§8.15): live ones where they stand, predicted ones
        // where their routine puts them (translucent), ghosts where they were last seen (faded), the rest not at all.
        const markers = new Map(this.known().npcs.map(m => [m.id, m]));
        const place = (index: number, pos: Pos, f: Facing) => {
            const [x, y] = centre(pos), now = this.people.at(index), facing = drawnFacing(f, now.facing);
            if (now.x !== x || now.y !== y || now.facing !== facing) this.people.move(index, x, y, facing);
        };
        for (const c of state.crew) {
            const index = this.sprite.get(c.id);
            if (index !== undefined) place(index, c.pos, c.facing);
        }
        for (const n of state.npcs) {
            const index = this.sprite.get(n.id), m = markers.get(n.id);
            if (index === undefined) continue;
            this.people.setAway(index, !m || n.status === 'away');
            if (!m) continue;
            place(index, m.pos, m.facing);
            this.people.setAlpha(index, MARKER_ALPHA[m.kind]);
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

    /**
     * The selected member's movement range (src/game/movement.ts): Move's tiles, and beyond them, when they have the
     * actions and the rules allow it, those only a Dash reaches. Planned on the crew's picture, as the commit checks it.
     */
    private range(member: CrewState): MoveRange {
        const state = this.session.state, cached = this.rangeFor;
        if (cached && cached.state === state && cached.id === member.id) return cached.range;
        const canDash = !dashRefusal(member, cmd => this.session.preview(cmd));
        const range = moveRange(this.session.world, this.picture(), member, canDash);
        this.rangeFor = { state, id: member.id, range };
        return range;
    }

    /** The tile in range nearest map tile point (fx, fy), and the move there: a Move if it fits Move's budget, else a Dash. */
    private snap(member: CrewState, fx: number, fy: number): { pos: Pos; command: Command } | undefined {
        const range = this.range(member);
        let best: { pos: Pos; d: number } | undefined;
        for (const pos of [...range.walk, ...range.run]) {
            const d = Math.hypot(pos.x - fx, pos.y - fy);
            if (d <= SNAP_TILES && (!best || d < best.d)) best = { pos, d };
        }
        const command = best && moveTo(range, member, best.pos);
        return best && command ? { pos: best.pos, command } : undefined;
    }

    /**
     * The state as the crew pictures it (§8.15): only the NPCs it sees or predicts stand anywhere. Reach, snapping and
     * drags are planned on it, so a tile an unseen NPC stands on reads as open; the commit, on the truth, may refuse.
     */
    private picture(): State {
        return crewPicture(this.session.world, this.session.state);
    }

    /**
     * Shows `cmd` as the pending preview, if the rules allow it. A move the crew's picture allows is shown even when the
     * truth refuses it (someone unseen stands in the way): committing it then says it is blocked.
     */
    private preview(cmd: Command): boolean {
        try {
            this.session.playerPreview(cmd);
        } catch {
            const member = this.selectedMember();
            const pictured = !!member && (cmd.type === 'move' || cmd.type === 'dash') &&
                moveAlong(this.session.world, this.picture(), member, this.range(member), cmd.path).command?.type === cmd.type;
            if (!pictured) return false;
        }
        this.session.setPendingCommand(cmd);
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

    /** A drawn path becomes a Move when it fits Move's budget, else a Dash; one too long is cut to its longest legal start. */
    private release(cancelled: boolean): void {
        const member = this.selectedMember(), path = this.dragPath;
        this.dragPath = undefined;
        if (cancelled || !member || !path?.length) return this.refresh();
        const { world } = this.session, state = this.picture(), range = this.range(member);
        const along = moveAlong(world, state, member, range, path);
        if (along.command && this.preview(along.command)) return;
        for (let n = along.badFrom ?? path.length - 1; n > 0; n--) {
            const part = moveAlong(world, state, member, range, path.slice(0, n)).command;
            if (part && this.preview(part)) return;
        }
        this.refresh();
    }

    /** The grid: Wait previews waiting; movement (the default) drops a pending Wait, so a tap on a tile moves again. */
    private pickAction(id: ActionId): void {
        if (this.busy) this.skip();
        if (this.recap) return;
        const member = this.selectedMember();
        if (!member) return;
        if (id === 'wait') {
            this.preview({ type: 'wait', crew: member.id });
            return;
        }
        if (this.session.pendingCommand?.type === 'wait') this.session.setPendingCommand(null);
        this.refresh();
    }

    private confirm(): void {
        const cmd = this.session.pendingCommand;
        if (!cmd || this.busy) return;
        try {
            this.session.commit(cmd);
        } catch (e) {
            // Refused on the truth: someone the crew didn't know of is in the way (M1-07 will stop the move short).
            console.warn(`Can't do that: ${(e as Error).message}`);
            this.toast(e instanceof IllegalCommand ? 'Blocked' : "Can't do that");
            this.session.setPendingCommand(null);
        }
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
        const { session } = this, vm = session.hud({ mapOn: this.mapOn, overlays: this.overlays });
        this.hud.update(this.recap ? { ...vm, recap: session.recap() } : vm);
        session.state.crew.forEach(c => this.people.highlight(this.sprite.get(c.id)!, c.id === session.selected));
        const speed = this.chrome[0];
        if (speed) speed.textContent = SPEED_LABEL[session.playback.speed];
        this.overlay.set(this.overlayContent());
    }

    private overlayContent(): Parameters<WorldOverlay['set']>[0] {
        if (this.recap) return null;
        const layer = this.knowledgeLayer();
        if (this.busy || this.session.state.phase !== 'crew') return { colour: '', ...layer };
        const intents = this.intents(), member = this.selectedMember();
        if (!member) return { colour: '', intents, ...layer };
        const colour = CREW_COLOURS[this.session.state.crew.indexOf(member) % CREW_COLOURS.length]!;
        // The whole range stays drawn while a tile is previewed or a path dragged (XCOM style): the path goes on top.
        const range = member.actionsLeft > 0 ? this.range(member) : undefined;
        const base = { colour, intents, ...layer, ...(range ? { reach: { move: range.walk, dash: range.run, at: member.pos } } : {}) };
        if (this.dragPath) {
            const along = moveAlong(this.session.world, this.picture(), member, range ?? { move: null, dash: null }, this.dragPath);
            return { ...base, from: member.pos, path: this.dragPath, dash: along.command?.type === 'dash', badFrom: along.badFrom };
        }
        const pending = this.session.pendingCommand;
        if (pending && 'path' in pending) {
            const dash = pending.type === 'dash';
            return { ...base, from: member.pos, path: pending.path as Pos[], dash, ...(dash ? { noise: this.noiseOf(pending) } : {}) };
        }
        return base;
    }

    /**
     * The tiles a previewed command's noise reaches (a Dash's, §6.3): the ring of the noise the player's preview emits,
     * on the state after it (the doors it opened), so the ring shown is the one the commit makes.
     */
    private noiseOf(cmd: Command): Pos[] | undefined {
        try {
            const result = this.session.playerPreview(cmd);
            const noise = result.events.find(e => e.type === 'noise');
            if (!noise || noise.type !== 'noise') return undefined;
            return soundRing(this.session.world, result.state, noise.sources, noise.radius).tiles.map(t => t.pos);
        } catch {
            return undefined;
        }
    }

    /**
     * The walks the NPCs on screen have committed to for the next world phase (§4 Intent, §6.2), hostile ones aside.
     * TODO(M1-10): only those the crew can know; TODO(M1-14): the overlay's own intent arrows.
     */
    private intents(): { from: Pos; path: Pos[]; predicted: boolean }[] {
        return this.known().npcs.flatMap(m => {
            const index = this.sprite.get(m.id);
            if (index === undefined || !this.people.shown(index) || m.kind === 'ghost' || m.status === 'hostile' || !m.intent?.path.length) return [];
            return [{ from: m.pos, path: m.intent.path.map(p => ({ x: p.x, y: p.y })), predicted: m.kind === 'predicted' }];
        });
    }

    /** What the crew knows now (§8.15), worked out once per state. */
    private known(): KnownView {
        const state = this.session.state;
        if (this.knownFor !== state) {
            this.knownFor = state;
            this.knownCache = knownView(this.session.world, state);
        }
        return this.knownCache!;
    }

    /** The overlay's knowledge layer: unscouted tiles, ghosts' "seen N turns ago", the sound pings. */
    private knowledgeLayer(): Pick<OverlayContent, 'seen' | 'ghosts' | 'pings'> {
        const view = this.known();
        return {
            seen: { width: view.width, bits: view.seen },
            ghosts: view.npcs.filter(m => m.kind === 'ghost' && this.people.shown(this.sprite.get(m.id) ?? -1)).map(m => ({ pos: m.pos, seenAgo: m.seenAgo })),
            pings: view.pings.map(p => ({ at: p.at }))
        };
    }

    /** A short message over the map that fades by itself ("Blocked"). */
    private toast(text: string): void {
        const el = document.createElement('div');
        el.className = 'play-toast';
        el.setAttribute('role', 'status');
        el.textContent = text;
        document.body.append(el);
        this.chrome.push(el);
        window.setTimeout(() => el.remove(), 1600);
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
