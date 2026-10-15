import Phaser from 'phaser';
import { cameraViews, npcBadges, npcCone, noiseHearers, type CameraVM, type HearerVM } from '../../game/worldUi';
import {
    actionMenu, AutoRun, autoBarView, bankView, barkText, cameraName, doorMiddle, nextCamera, moveAlong, moveRange, moveTo, routeViews, stopNeedsAttention, targetsOf, waitMenu, type ActionId, type MoveRange,
    type PlaybackItem, type PlaybackSpeed, type Session, type SessionChange
} from '../../game';
import type { GeneratedBank } from '../../gen/model';
import { TILE } from '../../level/level';
import type { PersonFacing, PersonPose } from '../../level/plan';
import {
    COMBAT_STATUSES, crewPicture, dashRefusal, IllegalCommand, knownView, doorStatus, planRoute, routeBreak, soundRing,
    type AutoStop, type Command, type CrewState, type KnownView, type MarkerKind, type State, type Facing, type Pos, type SimEvent
} from '../../sim';
import { mountAutoBar, type AutoBarHandle } from '../../ui/hud/autoBar';
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
/** How long the Alarm's banner and rings stay (§9.2), and a shout's ring, in ms. */
const ALARM_MS = 2600;
const FLASH_MS = 1500;
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
/** Where the colour-blind preset is remembered. */
const COLOUR_BLIND_KEY = 'bankheist.colourBlind';

function readColourBlind(): boolean {
    if (new URLSearchParams(location.search).has('cb')) return true;
    try {
        return localStorage.getItem(COLOUR_BLIND_KEY) === '1';
    } catch {
        return false;
    }
}

/** A step in each of the rules' facings. */
const FACING_DELTA: Record<Facing, Pos> = {
    n: { x: 0, y: -1 }, ne: { x: 1, y: -1 }, e: { x: 1, y: 0 }, se: { x: 1, y: 1 }, s: { x: 0, y: 1 }, sw: { x: -1, y: 1 }, w: { x: -1, y: 0 }, nw: { x: -1, y: -1 }
};
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
    /** The overlay drawer's toggles; the known cameras' cones are on to begin with (§8.12: where not to be seen). */
    private overlays: Partial<Record<OverlayId, boolean>> = { cameras: true };
    /** Where each carrier was last seen to be, by id: the Alarm's carrier is gone from the state when the camera visits it. */
    private readonly carrierAt = new Map<string, Pos>();
    /** Moments drawn for a second or two (a shout's ring, the Alarm's rings), until `until` (performance.now()). */
    private flashes: { at: Pos; kind: 'shout' | 'alarm'; tiles?: Pos[]; until: number }[] = [];
    private camerasFor?: { state: State; cones: string; views: CameraVM[] };
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
    /** The tile the body each crew member drags is drawn on, by crew id: the one they last stepped from. */
    private trail = new Map<string, Pos>();
    /** The pose each NPC is drawn in, by id (undefined: standing). */
    private posed = new Map<string, PersonPose | undefined>();
    private knownFor?: State;
    private knownCache?: KnownView;
    /** The NPC whose cones a long-press shows, until the next tap. */
    private coneOf: string | null = null;
    /** The colour-blind preset: `&cb` in the address, or the B key (remembered). */
    private colourBlind = readColourBlind();
    /** The door, NPC or object the player tapped: the grid's actions on a thing are for it. */
    private target: string | null = null;
    /** The selected member's range, worked out once per state and member. */
    private rangeFor?: { state: State; id: string; range: MoveRange };
    /** Go and Wait for… (§6.5): the run in progress, and why the last one stopped. */
    private readonly autoBar: AutoBarHandle;
    private auto: AutoRun | null = null;
    private lastStop: AutoStop | null = null;
    /** Any tap stops a run (§6.5), wherever it lands but on the auto-advance controls themselves. */
    private readonly onAnyTap = (e: PointerEvent) => {
        if (this.auto && !(e.target as Element | null)?.closest?.('.sh-autoroot')) this.stopAuto();
    };
    /** And so does any key (a hotkey acts on the bank as the player left it). */
    private readonly onAnyKey = (e: KeyboardEvent) => {
        if (this.auto && !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) this.stopAuto();
    };

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

        this.overlay = new WorldOverlay(scene, (tx, ty) => walls.liftAt((tx + 0.5) * TILE, (ty + 0.5) * TILE));
        this.input = new MapInput(scene, {
            tap: (x, y) => this.tap(x, y),
            claim: (x, y) => this.claim(x, y),
            drag: (x, y) => this.dragTo(x, y),
            release: cancelled => this.release(cancelled),
            longPress: (x, y) => this.longPress(x, y)
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
        this.autoBar = mountAutoBar(document.body, {
            go: () => this.startAuto(null, null),
            stop: () => this.stopAuto(),
            wait: id => {
                const option = waitMenu(this.session).find(o => o.id === id);
                if (option) this.startAuto(option.target, option.label);
            }
        });
        document.addEventListener('pointerdown', this.onAnyTap, true);
        document.addEventListener('keydown', this.onAnyKey, true);
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
            target: this.target, witnesses: this.overlay.state.witnesses, badges: this.overlay.state.badges, hearers: this.overlay.state.hearers,
            cones: this.overlay.state.cones, coneOf: this.coneOf, colourBlind: this.overlay.state.colourBlind,
            /** The known cameras drawn, how many with their cones, and the flashes on the map now. */
            cameras: this.overlay.state.cameras, cameraCones: this.overlay.state.cameraCones, flashes: this.overlay.state.flashes,
            /** The grid's entries as shown: id, enabled and reason. */
            actions: this.session.hud({ target: this.target }).actions.map(a => ({ id: a.id, enabled: a.enabled, reason: a.reason, selected: !!a.selected })),
            intents: this.overlay.state.intents,
            /** The NPC markers the crew knows of (§8.15), in the order of `state.npcs`; null for one it doesn't. */
            npcs: this.session.state.npcs.map(n => {
                const m = this.known().npcs.find(k => k.id === n.id);
                return m ? { id: m.id, kind: m.kind, pos: m.pos } : null;
            }),
            doorsOpen: [...this.shownDoors].filter(([, open]) => open).map(([id]) => id),
            /** Auto-advance (§6.5): running, the last stop, the routes and how they split into turns. */
            auto: {
                running: !!this.auto, stop: this.lastStop, routes: this.session.routes,
                legs: routeViews(this.session).map(r => ({ crew: r.crew, turns: r.legs.map(l => l.turn) }))
            }
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
        // Auto-advance plays its next turn once the last one has been shown.
        if (this.auto && !this.busy) this.autoTurn();
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
        // Where a dragged body lay before this move (applyEvent moves the trail on).
        const trailed = e.type === 'moved' ? this.trail.get(e.crew) : undefined;
        this.applyEvent(e);
        if (e.type === 'moved') {
            const index = this.sprite.get(e.crew);
            if (index === undefined || speed === 0) return;
            const tiles = [e.from, ...e.path], points = tiles.map(centre);
            // A body being dragged trails one step behind the dragger (rules/actions/body.ts keeps it on their tile).
            const member = this.session.state.crew.find(c => c.id === e.crew), dragged = member?.dragging, body = dragged ? this.sprite.get(dragged) : undefined;
            const walkers = [{ index, points }];
            if (member && body !== undefined) {
                const behind = trailed ?? this.trailOf({ ...member, pos: e.from });
                walkers.push({ index: body, points: [behind, ...tiles.slice(0, -1)].map(centre) });
            }
            this.startWalk(walkers, STEP_MS * speed);
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

    /**
     * What an event changes at once: doors, NPCs arriving or leaving the map, someone found by a cut move, a knockout,
     * a body stashed, someone coming round, a bark.
     */
    private applyEvent(e: SimEvent): void {
        if (e.type === 'moveCut') return this.showCut(e);
        if (e.type === 'knockedOut') return this.setPose(e.npc, 'prone');
        if (e.type === 'woke') {
            this.setPose(e.npc, undefined);
            const index = this.sprite.get(e.npc);
            if (index !== undefined) this.people.move(index, ...centre(e.at));
            return;
        }
        if (e.type === 'moved') {
            const member = this.session.state.crew.find(c => c.id === e.crew);
            if (member?.dragging) this.trail.set(e.crew, [e.from, ...e.path].at(-2)!);
            return;
        }
        if (e.type === 'bodyLifted') {
            // Taken hold of where it lies: it stays on its tile, behind the dragger.
            const index = this.sprite.get(e.npc);
            if (index !== undefined) {
                const at = this.people.at(index);
                this.trail.set(e.crew, { x: Math.floor(at.x / TILE), y: Math.floor(at.y / TILE) });
            }
            return;
        }
        if (e.type === 'bodyDropped') {
            this.trail.delete(e.crew);
            const index = this.sprite.get(e.npc);
            if (index !== undefined) this.people.move(index, ...centre(e.at));
            return;
        }
        if (e.type === 'bodyStashed') {
            this.trail.delete(e.crew);
            const index = this.sprite.get(e.npc);
            if (index !== undefined) this.people.setAway(index, true);
            return;
        }
        if (e.type === 'bark') {
            const npc = this.known().npcs.find(m => m.id === e.npc);
            if (npc) this.bark(npc.pos, barkText(this.session.world, this.session.state, e));
            return;
        }
        if (this.applyAlarmEvent(e)) return;
        if (e.type === 'doorOpened') this.showDoor(e.door, true);
        else if (e.type === 'doorClosed') this.showDoor(e.door, false);
        else if (e.type === 'npcEntered' || e.type === 'npcLeft') {
            const index = this.sprite.get(e.npc);
            if (index === undefined) return;
            this.people.move(index, ...centre(e.at));
            this.people.setAway(index, e.type === 'npcLeft');
        }
    }

    /**
     * The alarm side of the world (§8.11, §8.12, §9.1, §9.2, §16.3) on screen: "Hands up!" and its ring, the radio's calls,
     * the panel's work, a button that does nothing, the Alarm itself (its banner and rings), the patrol car driving
     * past. True when `e` was one of these.
     */
    private applyAlarmEvent(e: SimEvent): boolean {
        const { world, state } = this.session;
        const at = (id: string): Pos | undefined => this.known().npcs.find(m => m.id === id)?.pos ?? state.crew.find(c => c.id === id)?.pos;
        const say = (id: string, text: string) => {
            const p = at(id);
            if (p) this.bark(p, text);
        };
        switch (e.type) {
            case 'carrierStarted': {
                // Where it is, unless the projection redacted it (a holder the crew doesn't know).
                const p = e.pos as Pos | null;
                if (p) this.carrierAt.set(e.carrier, { x: p.x, y: p.y });
                return true;
            }
            case 'confronted': say(e.npc, 'Hands up!'); return true;
            case 'noise':
                // The guard's shout (§16.2): loud, radius 6, the ring shown a moment.
                if (e.cause.startsWith('hands up')) this.flash({ at: e.sources[0]!, kind: 'shout', tiles: soundRing(world, state, e.sources, e.radius).tiles.map(t => t.pos) }, FLASH_MS);
                return true;
            case 'checkInRinging': say(e.guard, '“Control to… come in?” (radio)'); return true;
            case 'checkIn': return true;
            case 'checkInMissed': say(e.guard, e.missed > 1 ? 'No answer. Calling it in.' : 'No answer…'); return true;
            case 'radioAnswered': say(e.crew, '“All quiet here.”'); return true;
            case 'dispatchLostContact': this.toast(`Dispatch lost contact: patrol car on turn ${e.driveBy}`); return true;
            case 'patrolPassed': {
                const lane = world.patrol?.lane ?? [], mid = lane[Math.floor(lane.length / 2)];
                if (mid) this.bark(mid, e.saw === null ? 'Patrol car drives past' : 'Patrol car: they saw something!');
                return true;
            }
            case 'alarmDead': say(e.source, '*click*… nothing'); return true;
            case 'panelWorked': say(e.crew, `Panel ${e.progress}/${e.needed}`); return true;
            case 'panelDisabled': say(e.crew, 'Alarm panel dead'); return true;
            case 'carrierStopped': {
                const p = this.carrierAt.get(e.carrier);
                if (p && e.why === 'panel') this.bark(p, 'Button dead');
                else if (p && e.why === 'answered') this.bark(p, 'Check-in covered');
                return true;
            }
            case 'feedLooped': {
                const cam = world.cameras.find(c => c.id === e.camera);
                if (cam) this.bark(cam.pos, `${cameraName(world, e.camera)} looped`);
                return true;
            }
            case 'jammerPlaced': this.bark(e.pos, 'Jammer on'); return true;
            case 'alarmRaised': {
                const p = this.carrierAt.get(e.carrier);
                if (p) this.flash({ at: p, kind: 'alarm' }, ALARM_MS);
                this.alarmBanner();
                return true;
            }
            default: return false;
        }
    }

    /** Draws a moment on the map for `ms`, then takes it off again. */
    private flash(f: { at: Pos; kind: 'shout' | 'alarm'; tiles?: Pos[] }, ms: number): void {
        this.flashes.push({ ...f, until: performance.now() + ms });
        this.overlay.set(this.overlayContent());
        window.setTimeout(() => this.refresh(), ms + 20);
    }

    /** The Alarm's banner (§9.2): "ALARM: police in N", across the top of the map for a moment. */
    private alarmBanner(): void {
        const el = document.createElement('div');
        el.className = 'play-alarm';
        el.setAttribute('role', 'alert');
        el.textContent = bankView(this.session.state).label;
        document.body.append(el);
        this.chrome.push(el);
        window.setTimeout(() => el.remove(), ALARM_MS);
    }

    /**
     * A crew move cut short (§8.15): it has already stopped where the walk ended; the NPC who stopped it shows where they
     * stand, and the crew member barks.
     */
    private showCut(e: Extract<SimEvent, { type: 'moveCut' }>): void {
        const npc = this.session.state.npcs.find(n => n.id === e.npc), index = this.sprite.get(e.npc);
        if (npc && index !== undefined) {
            const [x, y] = centre(npc.pos), now = this.people.at(index);
            this.people.setAway(index, false);
            this.people.setAlpha(index, 1);
            this.people.move(index, x, y, drawnFacing(npc.facing, now.facing));
        }
        this.bark(e.at, e.reason === 'bump' ? "Someone's there!" : 'Hold up, someone there!');
    }

    /**
     * Draws an NPC lying down (knocked out, dead: 'prone'; tied: 'tied') or standing (undefined).
     */
    private setPose(npcId: string, pose: PersonPose | undefined): void {
        const index = this.sprite.get(npcId);
        if (index !== undefined && this.posed.get(npcId) !== pose) {
            this.posed.set(npcId, pose);
            this.people.setPose(index, pose);
        }
    }

    /** A short line over a tile that fades by itself. */
    private bark(at: Pos, text: string): void {
        const cam = this.scene.cameras.main, box = this.scene.game.canvas.getBoundingClientRect();
        const sx = box.width / this.scene.scale.width, sy = box.height / this.scene.scale.height;
        const el = document.createElement('div');
        el.className = 'play-bark';
        el.setAttribute('role', 'status');
        el.textContent = text;
        el.style.left = `${box.left + ((at.x + 0.5) * TILE - cam.worldView.x) * sx}px`;
        el.style.top = `${box.top + (at.y * TILE - 20 - cam.worldView.y) * sy}px`;
        document.body.append(el);
        this.chrome.push(el);
        window.setTimeout(() => el.remove(), 1800);
    }

    /**
     * After a commit that is final because someone the crew doesn't know of noticed it (Undo greys out with no reason
     * shown otherwise): a brief "Something stirred…" beside Undo.
     */
    private stirred(): void {
        const undo = document.querySelector('.sh-undo')?.getBoundingClientRect();
        const el = document.createElement('div');
        el.className = 'play-stirred';
        el.setAttribute('role', 'status');
        el.textContent = 'Something stirred…';
        if (undo && undo.width) {
            el.style.left = `${undo.left + undo.width / 2}px`;
            el.style.top = `${undo.top - 8}px`;
        }
        document.body.append(el);
        this.chrome.push(el);
        window.setTimeout(() => el.remove(), 2400);
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

    /**
     * Where an event happened, for the camera: a carrier's holder as the crew may know it (and where it was, once the
     * Alarm took it), a guard.
     */
    private eventPos(e: SimEvent): Pos | undefined {
        const state = this.session.state;
        if (e.type === 'carrierStarted' || e.type === 'carrierTicked' || e.type === 'alarmRaised') return this.carrierAt.get(e.carrier);
        if (e.type === 'patrolPassed') {
            const lane = this.session.world.patrol?.lane ?? [];
            return lane[Math.floor(lane.length / 2)];
        }
        if (e.type === 'alarmDead') return this.known().npcs.find(m => m.id === e.source)?.pos;
        const who = (e as { npc?: string; crew?: string }).npc ?? (e as { crew?: string }).crew ?? (e as { guard?: string }).guard;
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
            // A stashed body is out of sight, as one away from the map is (rules/actions/body.ts).
            this.people.setAway(index, !m || n.status === 'away' || n.stashed !== null);
            if (!m) continue;
            this.setPose(n.id, n.status === 'tied' ? 'tied' : n.status === 'unconscious' || n.status === 'dead' ? 'prone' : undefined);
            // A dragged body lies on the tile behind its carrier (the rules keep it on theirs).
            const dragger = state.crew.find(c => c.dragging === n.id);
            place(index, dragger ? this.trailOf(dragger) : m.pos, m.facing);
            // The crew has hold of a dragged body: it is never a guess.
            this.people.setAlpha(index, dragger ? 1 : MARKER_ALPHA[m.kind]);
        }
        for (const id of Object.keys(world.doors)) {
            const status = doorStatus(world, state, id);
            this.showDoor(id, status === 'open' || status === 'breached');
        }
    }

    /**
     * Where the body a crew member drags is drawn: the tile they came from (`trail`, kept from the playback), else the
     * tile behind them, else their own.
     */
    private trailOf(member: CrewState): Pos {
        const known = this.trail.get(member.id);
        if (known) return known;
        const d = FACING_DELTA[member.facing], { world } = this.session, behind = { x: member.pos.x - d.x, y: member.pos.y - d.y };
        const ok = behind.x >= 0 && behind.y >= 0 && behind.x < world.width && behind.y < world.height && !world.tiles[behind.y * world.width + behind.x]!.blocksMove;
        return ok ? behind : member.pos;
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
            this.target = null;
            // The camera centres on the newly selected crew member, zooming in to Act view if further out (§20.1).
            this.camera.actView(...centre(member.pos), 250);
        }
        this.refresh();
    }

    private tap(x: number, y: number): void {
        if (this.busy) return this.skip();
        if (this.recap) return;
        if (this.coneOf) {
            this.coneOf = null;
            this.refresh();
        }
        // Where on the ground the tap is: a raised floor is drawn up the screen (walls.liftAt).
        const gy = this.groundY(x, y), tile = { x: Math.floor(x / TILE), y: Math.floor(gy / TILE) }, { crew } = this.session.state;
        // Someone standing on the tile tapped; then a second tap on the previewed tile, which commits it (UI.md); then
        // someone whose drawing (standing up over the tiles behind them) was tapped.
        const onTile = crew.find(c => same(c.pos, tile));
        if (onTile) return onTile.id === this.session.selected ? undefined : this.select(onTile.id);
        const pending = this.session.pendingCommand;
        if (pending && 'path' in pending && same(pending.path.at(-1), tile)) return this.confirm();
        const member = this.selectedMember();
        const canAct = !!member && this.session.state.phase === 'crew' && member.actionsLeft > 0;
        // A door, an NPC or a stash in reach: pick it as the target and preview what to do with it (UI.md "Touch grammar").
        if (member && canAct && this.tapTarget(member, x, y, gy)) return;
        const target = canAct ? this.snap(member, x / TILE - 0.5, gy / TILE - 0.5) : undefined;
        // A drawing stands over the tiles behind it: tapping one selects them, unless that tile is somewhere the selected
        // crew member can go.
        const drawn = this.crewAt(x, y);
        if (drawn && drawn.id !== this.session.selected && !same(target?.pos, tile)) return this.select(drawn.id);
        // Only a tap on the previewed tile itself commits; one that snaps to it from a tile beside it just previews again.
        if (!target || (pending && 'path' in pending && same(pending.path.at(-1), target.pos))) return;
        this.preview(target.command);
    }

    /**
     * The ground's map y under drawn map point (x, y): a raised floor is drawn `walls.liftAt` pixels up the screen, so
     * the point may be on a tile further south, lifted into view. The raised tile drawn there wins over the ground behind.
     */
    private groundY(x: number, y: number): number {
        const cx = (Math.floor(x / TILE) + 0.5) * TILE;
        for (let ty = Math.floor(y / TILE) + 4; ty >= Math.floor(y / TILE); ty--) {
            const lift = this.walls.liftAt(cx, (ty + 0.5) * TILE);
            if (lift > 0 && Math.floor((y + lift) / TILE) === ty) return y + lift;
        }
        return y;
    }

    /**
     * A tap on something the selected member can act on: a door beside them (near its edge), an NPC in reach (their tile
     * or their drawing), a stash or an object in reach. It becomes the grid's target and its first allowed action is
     * previewed; a tap on the target of the pending action commits it. False when the tap hit none of these.
     */
    private tapTarget(member: CrewState, x: number, y: number, gy: number): boolean {
        const { world, state } = this.session, targets = targetsOf(world, state, member.id);
        const fx = x / TILE, fy = gy / TILE, tile = { x: Math.floor(fx), y: Math.floor(fy) };
        const markers = new Map(this.known().npcs.map(m => [m.id, m]));
        const hit =
            targets.doors.find(id => {
                const m = doorMiddle(world, id);
                return !!m && Math.hypot(m.x - fx, m.y - fy) < 0.45;
            }) ??
            targets.npcs.find(id => same(markers.get(id)?.pos, tile)) ??
            targets.npcs.find(id => this.people.hit(this.sprite.get(id) ?? -1, x, y)) ??
            targets.objects.find(id => same(world.objects.find(o => o.id === id)?.pos, tile)) ??
            targets.cameras.find(id => same(world.cameras.find(c => c.id === id)?.pos, tile));
        if (!hit) return false;
        const pending = this.session.pendingCommand;
        const menu = actionMenu(world, state, member.id, hit).filter(e => e.target === hit);
        if (pending && menu.some(e => JSON.stringify(e.command) === JSON.stringify(pending))) {
            this.confirm();
            return true;
        }
        this.target = hit;
        const first = menu.find(e => !e.reason);
        if (first) this.preview(first.command);
        else {
            if (menu[0]?.reason) this.toast(menu[0].reason);
            this.session.setPendingCommand(null);
            this.refresh();
        }
        return true;
    }

    /**
     * The selected member's movement range (src/game/movement.ts): Move's tiles, and beyond them, when they have the
     * actions and the rules allow it, those only a Dash reaches. Planned on the crew's picture, as the commit checks it.
     */
    private range(member: CrewState): MoveRange {
        const state = this.session.state, cached = this.rangeFor;
        if (cached && cached.state === state && cached.id === member.id) return cached.range;
        const canDash = dashRefusal(this.session.world, state, member.id) === null;
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
        const to = { x: Math.floor(x / TILE), y: Math.floor(this.groundY(x, y) / TILE) };
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
        // Beyond this turn's reach: a route over as many turns as it takes (§6.5), up to the first step nobody could take.
        if (!along.command) {
            const cut = routeBreak(world, this.session.state, member.id, path), route = cut < 0 ? path : path.slice(0, cut);
            const plan = route.length ? planRoute(world, this.session.state, member.id, route) : undefined;
            if (plan && plan.legs.some(l => l.turn > this.session.state.turn)) {
                this.session.setPendingCommand(null);
                this.session.setRoute(member.id, route);
                this.lastStop = null;
                this.toast(`Route: ${plan.legs.at(-1)!.turn - this.session.state.turn + 1} turns. Go to walk it`);
                return this.refresh();
            }
        }
        for (let n = along.badFrom ?? path.length - 1; n > 0; n--) {
            const part = moveAlong(world, state, member, range, path.slice(0, n)).command;
            if (part && this.preview(part)) return;
        }
        this.refresh();
    }

    /**
     * The grid: movement (the default) drops a pending action, so a tap on a tile moves again; any other entry previews
     * its command (for the current target), or says why it can't be done.
     */
    private pickAction(id: ActionId): void {
        if (this.busy) this.skip();
        if (this.recap) return;
        const member = this.selectedMember();
        if (!member) return;
        if (id === 'move') {
            const pending = this.session.pendingCommand;
            if (pending && pending.type !== 'move' && pending.type !== 'dash') this.session.setPendingCommand(null);
            this.refresh();
            return;
        }
        // Loop feed again while it is previewed: the next camera the crew knows of (src/game/actions.ts).
        const pending = this.session.pendingCommand;
        if (id === 'loop' && pending?.type === 'loopFeed') {
            const next = nextCamera(this.session.world, this.session.state, member.id, pending.camera);
            if (next) this.target = next;
        }
        const entry = actionMenu(this.session.world, this.session.state, member.id, this.target).find(e => e.id === id);
        if (!entry) return;
        if (entry.reason) return this.toast(entry.reason);
        if (entry.target) this.target = entry.target;
        this.preview(entry.command);
    }

    private confirm(): void {
        const cmd = this.session.pendingCommand;
        if (!cmd || this.busy) return;
        try {
            this.session.commit(cmd);
            // A stashed body or a closed door is no longer anything to act on.
            this.target = null;
        } catch (e) {
            // Refused on the truth: someone the crew didn't know of is in the way (M1-07 will stop the move short).
            console.warn(`Can't do that: ${(e as Error).message}`);
            this.toast(e instanceof IllegalCommand ? 'Blocked' : "Can't do that");
            this.session.setPendingCommand(null);
        }
        this.refresh();
    }

    // ------------------------------------------------------------------------------------------------- Auto-advance

    /** Starts a Go (no target: walk the routes) or a Wait for… (§6.5). */
    private startAuto(target: AutoRun['target'], label: string | null): void {
        if (this.recap) return;
        if (this.busy) this.skip();
        this.session.setPendingCommand(null);
        this.target = null;
        this.lastStop = null;
        this.auto = new AutoRun(this.session, target, label);
        this.refresh();
    }

    /** Stops the run in progress (a tap, or Stop). */
    private stopAuto(): void {
        if (!this.auto) return;
        this.lastStop = this.auto.cancel();
        this.auto = null;
        this.refresh();
    }

    /** Plays the run's next turn; when it stops, says why and looks at it if it needs looking at. */
    private autoTurn(): void {
        const run = this.auto!;
        let stop: AutoStop | null;
        try {
            stop = run.step();
        } catch (e) {
            console.warn('Auto-advance failed', e);
            stop = { kind: 'blocked', text: (e as Error).message };
        }
        if (stop) {
            this.auto = null;
            this.lastStop = stop;
            if (stop.at && stopNeedsAttention(stop)) this.camera.centreOn(...centre(stop.at), 300);
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
        else if (e.key === 'b' || e.key === 'B') this.setColourBlind(!this.colourBlind);
        else if (e.key === 'Escape' && this.session.pendingCommand) this.session.setPendingCommand(null);
    }

    /** The colour-blind preset (UI.md "Signal palette"), remembered on this device. */
    private setColourBlind(on: boolean): void {
        this.colourBlind = on;
        try {
            localStorage.setItem(COLOUR_BLIND_KEY, on ? '1' : '0');
        } catch { /* private mode: for this visit only */ }
        this.refresh();
    }

    private cycleSpeed(): void {
        const queue = this.session.playback;
        queue.speed = SPEEDS[(SPEEDS.indexOf(queue.speed) + 1) % SPEEDS.length]!;
        this.refresh();
    }

    // ------------------------------------------------------------------------------------------------- Showing

    private onChange(change: SessionChange): void {
        if (change.kind === 'undo') {
            this.trail.clear();
            this.syncAll();
        }
        if (change.kind === 'commit' && change.noticedUnseen) this.stirred();
        this.refresh();
    }

    /** The HUD, the rings and the overlay, from the Session. */
    private refresh(): void {
        const { session } = this, vm = session.hud({ mapOn: this.mapOn, overlays: this.overlays, target: this.target });
        // Where each carrier is, as the ledger may say (a holder the crew doesn't know has none): the camera's visits use it.
        for (const t of vm.ledger) if (t.pos && session.state.carriers.some(c => c.id === t.id)) this.carrierAt.set(t.id, { x: t.pos.x, y: t.pos.y });
        this.hud.update(this.recap ? { ...vm, recap: session.recap() } : vm);
        this.autoBar.update(autoBarView(session, this.auto, this.lastStop));
        session.state.crew.forEach(c => this.people.highlight(this.sprite.get(c.id)!, c.id === session.selected));
        const speed = this.chrome[0];
        if (speed) speed.textContent = SPEED_LABEL[session.playback.speed];
        this.overlay.set(this.overlayContent());
    }

    private overlayContent(): Parameters<WorldOverlay['set']>[0] {
        if (this.recap) return null;
        const layer = { ...this.knowledgeLayer(), routes: routeViews(this.session) };
        if (this.busy || this.session.state.phase !== 'crew') return { colour: '', ...layer };
        const intents = this.intents(), member = this.selectedMember();
        if (!member) return { colour: '', intents, ...layer };
        const colour = CREW_COLOURS[this.session.state.crew.indexOf(member) % CREW_COLOURS.length]!;
        // The whole range stays drawn while a tile is previewed or a path dragged (XCOM style): the path goes on top.
        // A long-pressed NPC's cones are the question being asked: the range steps aside for them.
        const range = member.actionsLeft > 0 && !this.coneOf ? this.range(member) : undefined;
        const bodies = this.session.state.crew.filter(c => c.dragging !== null).map(c => this.trailOf(c));
        const base = { colour, intents, ...layer, ...(range ? { reach: { move: range.walk, dash: range.run, at: member.pos, unfilled: bodies } } : {}) };
        if (this.dragPath) {
            const along = moveAlong(this.session.world, this.picture(), member, range ?? { move: null, dash: null }, this.dragPath);
            if (!along.command && this.dragPath.length) {
                // Beyond this turn's reach: drawn as the route it would become, its turns numbered.
                const cut = routeBreak(this.session.world, this.session.state, member.id, this.dragPath);
                const route = cut < 0 ? this.dragPath : this.dragPath.slice(0, cut);
                const plan = planRoute(this.session.world, this.session.state, member.id, route);
                const others = layer.routes.filter(r => r.crew !== member.id);
                return {
                    ...base, routes: [...others, { crew: member.id, colour, from: member.pos, legs: plan.legs, rest: route.slice(plan.walkable) }],
                    from: member.pos, path: this.dragPath, badFrom: cut < 0 ? undefined : cut, routeDrag: true
                };
            }
            return { ...base, from: member.pos, path: this.dragPath, dash: along.command?.type === 'dash', badFrom: along.badFrom };
        }
        const pending = this.session.pendingCommand;
        if (pending && 'path' in pending) {
            const dash = pending.type === 'dash';
            return {
                ...base, from: member.pos, path: pending.path as Pos[], dash, ...(dash ? { noise: this.noiseOf(pending), hearers: this.hearersOf(pending) } : {}),
                witnesses: this.witnessesOf(pending)
            };
        }
        // An action on a thing: its target marked, the noise it makes (a knockout's), and who would see it (§8.4).
        const targetDoor = this.target ? doorMiddle(this.session.world, this.target) : undefined;
        const targetTile = this.target && !targetDoor ? this.targetTile(this.target) : undefined;
        const marks = { ...(targetDoor ? { targetDoor } : {}), ...(targetTile ? { targetTile } : {}) };
        // An action on a thing: its noise ring and who'd hear or see it, without the movement range under them.
        const { reach: _range, ...rest } = base;
        if (pending) return { ...rest, ...marks, noise: this.noiseOf(pending), hearers: this.hearersOf(pending), witnesses: this.witnessesOf(pending) };
        return { ...base, ...marks };
    }

    /** Who hears the pending command's noise and what they'll do: the player's preview, through the crew's knowledge. */
    private hearersOf(cmd: Command): HearerVM[] {
        try {
            return noiseHearers(this.session.world, this.session.state, this.known(), this.session.playerPreview(cmd));
        } catch {
            return [];
        }
    }

    /** Where a target NPC (as the crew knows it) or object stands. */
    private targetTile(id: string): Pos | undefined {
        return this.known().npcs.find(m => m.id === id)?.pos ?? this.session.world.objects.find(o => o.id === id)?.pos;
    }

    /**
     * Who would see the pending command and react (§8.4, §8.5): the NPCs whose perception check the player's preview
     * shows, where the crew knows them to stand, and the cameras that would register it.
     */
    private witnessesOf(cmd: Command): Pos[] {
        try {
            const events = this.session.playerPreview(cmd).events, markers = this.known().npcs, out: Pos[] = [];
            for (const e of events) {
                if (e.type === 'perceptionCheck') {
                    const at = markers.find(m => m.id === e.npc)?.pos;
                    if (at && !out.some(p => same(p, at))) out.push(at);
                } else if (e.type === 'cameraSaw') {
                    const cam = this.session.world.cameras.find(c => c.id === e.camera);
                    if (cam && !out.some(p => same(p, cam.pos))) out.push(cam.pos);
                }
            }
            return out;
        } catch {
            return [];
        }
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
    private knowledgeLayer(): Pick<OverlayContent, 'seen' | 'ghosts' | 'pings' | 'badges' | 'crewColours' | 'cones' | 'predicted' | 'colourBlind' | 'cameras' | 'flashes'> {
        const view = this.known(), { world, state } = this.session, busy = this.busy;
        const shown = (id: string) => this.people.shown(this.sprite.get(id) ?? -1);
        // Cones: the one long-pressed, or every NPC's the crew knows of from the overlay drawer (§20.4).
        const coneIds = this.overlays.cones ? view.npcs.filter(m => m.kind !== 'ghost' && shown(m.id)).map(m => m.id) : this.coneOf ? [this.coneOf] : [];
        return {
            seen: { width: view.width, bits: view.seen },
            ghosts: view.npcs.filter(m => m.kind === 'ghost' && shown(m.id)).map(m => ({ pos: m.pos, seenAgo: m.seenAgo })),
            pings: view.pings.map(p => ({ at: p.at })),
            colourBlind: this.colourBlind,
            cameras: this.cameras(),
            flashes: this.liveFlashes(),
            crewColours: Object.fromEntries(state.crew.map((c, i) => [c.id, CREW_COLOURS[i % CREW_COLOURS.length]!])),
            // People walking during playback: their plates come back when it is over.
            ...(busy ? {} : {
                badges: npcBadges(world, state, view).filter(b => !state.npcs.some(n => n.id === b.id) || shown(b.id)),
                predicted: view.npcs.filter(m => m.kind === 'predicted' && shown(m.id)).map(m => m.pos),
                cones: coneIds.flatMap(id => npcCone(world, state, view, id) ?? [])
            })
        };
    }

    /**
     * The known cameras (§8.12): a plate each, with their cones when the drawer's Cameras overlay is on, or the one
     * long-pressed. Worked out once per state and choice.
     */
    private cameras(): CameraVM[] {
        const state = this.session.state, all = !!this.overlays.cameras, cones = all ? '*' : this.coneOf ?? '';
        if (this.camerasFor?.state !== state || this.camerasFor.cones !== cones) {
            const view = this.known(), long = !all && view.cameras.some(c => c.id === this.coneOf);
            let views = cameraViews(this.session.world, state, view, all || long);
            if (long) views = views.map(v => (v.id === this.coneOf ? v : { ...v, core: [], peripheral: [], next: [] }));
            this.camerasFor = { state, cones, views };
        }
        return this.camerasFor.views;
    }

    private liveFlashes(): OverlayContent['flashes'] {
        const now = performance.now();
        this.flashes = this.flashes.filter(f => f.until > now);
        return this.flashes.map(({ until: _until, ...f }) => f);
    }

    /**
     * Long-press (UI.md "why"): on an NPC the crew knows of, its cones until the next tap; on a known camera, its cone;
     * elsewhere, nothing yet.
     */
    private longPress(x: number, y: number): void {
        if (this.busy || this.recap) return;
        const gy = this.groundY(x, y), tile = { x: Math.floor(x / TILE), y: Math.floor(gy / TILE) };
        const hit = this.known().npcs.find(m => m.kind !== 'ghost' && (same(m.pos, tile) || this.people.hit(this.sprite.get(m.id) ?? -1, x, y)))?.id
            ?? this.known().cameras.find(c => same(c.pos, tile))?.id;
        this.coneOf = hit && this.coneOf !== hit ? hit : null;
        this.refresh();
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
        this.autoBar.destroy();
        document.removeEventListener('pointerdown', this.onAnyTap, true);
        document.removeEventListener('keydown', this.onAnyKey, true);
        for (const el of this.chrome) el.remove();
        this.scene.input.keyboard?.off('keydown', this.onKey, this);
        document.body.classList.remove('play');
    }
}
