import type { GeneratedBank } from '../gen/model';
import {
    bitsCount, challengerOf, commit, crewCanUnlatch, crewMember, dashRefusal, decodeBits, doorBetween, doorSides, IllegalCommand, knownDoorStatus, markerKind, MOVE_ACTIONS,
    noisemakerTargets, planMoveOptions, planningState, previewCertain, previewDanger, PreviewRollError, projectPreviewEvents, safeFloor, stepCost, tileAt,
    tileVisibility, type Command, type DeepReadonly, type DoorDef, type DoorStatus, type FloorTile, type Pos, type ReadonlyWorld,
    type SimEvent, type State
} from '../sim';
import { heistFromSetup, planOptions, type HeistSetup, type PlanOptions } from './plan';

/*
 * The playability bot (implementation plan M5-05, decisions 420–424): a scripted Clean infiltrator that plays a heist as
 * a player would and must reach the alarm closet or the CCTV room unexposed. Unlike the Clean route of §17.7
 * (src/gen/validate.ts, decision 342), which knows the whole bank and holds every card, it plays the real start of a
 * planned heist (`heistFromSetup`: one crew member on foot by the van, `botSetup`) through the real commands, and acts
 * only on what the crew knows: the safe floor and the previews (§8.8, judged on the crew's picture), the tiles and doors
 * as the crew knows them. With `intel` the heist buys the Blueprints (§18.2: the whole layout, M5-03's planning asset).
 *
 * - **Where to go.** A goal room is known once a tile of it is (seen, or on the blueprint's layout); until then it
 *   explores: the nearest door with hidden tiles beyond it (dearer the bigger the room's outline, `outlineCost`), or a
 *   seen tile beside a hidden one. Distances (`field`) run over the tiles the crew can plan on (`planningState`,
 *   `planMoveOptions`: never a hidden tile), through closed doors and the locked ones its kit can open.
 * - **How to move.** Each Move ends on the green tile of the safe floor nearest the target; off the public floor only
 *   as the turn's first action (or onto the goal), keeping the second for getting away. Where none gets nearer it
 *   steps into unknown risk (hatched grey: a player can't explore without it), the shortest step that gets nearer, but
 *   only as the turn's first action and, where staying is green, after `RISK_WAIT` turns' wait; never onto amber, a hand,
 *   a camera or red. Otherwise it waits where staying is green, or steps to the green tile nearest the target, or
 *   back toward the public floor, or Dashes to a green tile.
 * - **Doors.** It opens a closed door with hidden tiles beyond (to see in). A lock on its way it picks (mechanical) or
 *   hacks (a card reader) when the preview warns of nothing (`previewDanger`) and staying is green, or in unknown risk
 *   after `LOCK_PATIENCE` turns' wait: both are illegal acts. Where someone would see it, it throws a noisemaker that
 *   turns them away if it has one (`distraction`), else waits, and after `LOCK_PATIENCE` turns looks for another way for
 *   `AVOID_TURNS` turns. It never holds a card it didn't take.
 * - **Challenged** (§8.6), it makes for the public floor, working a lock in its way whoever sees it.
 *
 * It is deterministic (the rules' own dice, from the bank's seed) and pure. It fails at the first exposure (`EXPOSED`),
 * a refused command, or when it gives up: `BOT_TURNS` turns in all, or `BOT_STALL` turns in a row without ending one
 * nearer its target or seeing anything new.
 */

/** Who plays: Jun (Steady Hands halves the work on a lock), Clean: nothing on him but two gadgets (`botSetup`). */
export const BOT_CREW = 'jun';

/**
 * What ends the run as a failure: the crew member is made (an exposure, a camera's sighting), an alarm, an alert. A
 * challenge doesn't: it is complied with, and a challenge not complied with ends as an exposure.
 */
const EXPOSED: ReadonlySet<string> = new Set(['exposed', 'cameraSaw', 'carrierStarted', 'alerted', 'wentLoud']);

/** What a preview may not show (as auto-advance's `UNSAFE_EVENTS`). */
const UNSAFE: ReadonlySet<string> = new Set(['suspicionRaised', 'exposed', 'challenged', 'carrierStarted', 'cameraSaw']);

/** How many turns the bot plays at most, and how many in a row it may go without getting nearer its target. */
export const BOT_TURNS = 80;
export const BOT_STALL = 30;

/** Turns of waiting before working a lock (then it looks for another way `AVOID_TURNS` turns), and what that way may cost more. */
const LOCK_PATIENCE = 3;
const AVOID_TURNS = 10;
const AVOID_COST = 30;
/** What a lock on the way costs in the field, and an outline room at most. */
const LOCK_COST = 6;
const OUTLINE_COST = 30;
/** Turns it waits for a green way before going on into unknown risk. */
const RISK_WAIT = 2;

/** The rooms the bot makes for. */
const GOALS: readonly string[] = ['alarmCloset', 'cctvRoom'];

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

/** How the run ended: whether it reached a goal room unexposed, the room, the turns it took, why it stopped and what it did. */
export interface BotRun {
    ok: boolean;
    goal: string | null;
    turns: number;
    why: string;
    /** Turn by turn: `m x,y` a Move's end, `o`/`p`/`h` a door opened, picked or hacked, `w` a wait. */
    log: string[];
    /** Suspicion pips it drew on the way, and challenges it complied with (neither fails it). */
    pips: number;
    challenges: number;
}

/** The cost to the target from each tile (-1 where it can't get there), whether it is exploring, and its targets' start costs. */
interface Field { cost: Int32Array; exploring: boolean; start: ReadonlyMap<number, number> }

/** One action of the bot's: the command, and how the log shows it. */
interface Step { cmd: Command; note: string }

/** What the bot's heist buys: the Blueprints (§18.2: the whole layout, every lock) or nothing. */
export interface BotIntel { blueprints?: boolean }

/**
 * The heist the bot plays: one Clean crew member on foot by the van with the lockpick and the hacking kit, nothing else
 * bought but the Blueprints when `intel` says so; those show every lock, so then a noisemaker replaces the lockpick
 * where no lock is mechanical. No intel from earlier heists.
 */
export function botSetup(bank: GeneratedBank, options: PlanOptions = planOptions(bank), intel: BotIntel = {}): HeistSetup {
    const van = options.spots.van[0];
    if (!van) throw new Error('This bank has no spot for the van');
    const blueprints = !!intel.blueprints;
    const picks = !blueprints || Object.values(options.world.doors).some(d => d.lock === 'mechanical');
    return {
        crew: [{ id: BOT_CREW, loadout: { primary: null, sidearm: null, armour: null, gadgets: [picks ? 'lockpick' : 'noisemaker', 'hackingKit'] }, start: { at: 'van', aboard: false } }],
        vehicles: { van: van.id },
        jammer: null,
        nest: false,
        blueprints,
        guardRota: false,
        intel: {}
    };
}

/** Plays the bot in `bank` from the start of its heist (`botSetup`). */
export function playBot(bank: GeneratedBank, intel: BotIntel = {}): BotRun {
    const options = planOptions(bank);
    const { world, state } = heistFromSetup(bank, botSetup(bank, options, intel), options);
    const types = new Map(bank.rooms.map(r => [r.id, r.type as string]));
    return new Bot(world, state, types).play();
}

class Bot {
    private readonly log: string[] = [];
    private pips = 0;
    /** Doors it gave up on: opened and still nothing seen beyond, or locked against it. */
    private readonly dead = new Set<string>();
    /** Doors it waited at too long to work their lock, and the turn until which it looks for another way. */
    private readonly avoid = new Map<string, number>();
    /** Turns waited at each door so far. */
    private readonly waits = new Map<string, number>();
    private readonly outlines = new Map<string, number>();
    private stalled = 0;
    private challenges = 0;

    constructor(private readonly world: ReadonlyWorld, private state: State, private readonly types: ReadonlyMap<string, string>) {}

    play(): BotRun {
        const start = this.state.turn;
        // Each turn is judged on the field it began with: progress is ending it nearer the target, or seeing more.
        let begun: { field: Field; cost: number; seen: number } | null = null;
        for (;;) {
            if (this.state.turn - start >= BOT_TURNS) return this.end(false, null, `out of turns (${BOT_TURNS})`);
            const goal = this.goalAt(this.me().pos);
            if (goal) {
                // The world phase after it gets there too.
                const why = this.play1({ type: 'endTurn' });
                return why ? this.end(false, null, why) : this.end(true, goal, `reached the ${goal}`);
            }
            const field = this.me().actionsLeft < MOVE_ACTIONS ? null : this.field();
            if (field && !begun) begun = { field, cost: field.cost[this.index(this.me().pos)]!, seen: this.seen() };
            const step = field ? this.choose(field) : { cmd: { type: 'endTurn' } as Command, note: '' };
            if (step.cmd.type === 'endTurn' && begun) {
                const now = begun.field.cost[this.index(this.me().pos)]!;
                const nearer = now >= 0 && (begun.cost < 0 || now < begun.cost);
                this.stalled = nearer || this.seen() > begun.seen ? 0 : this.stalled + 1;
                begun = null;
                if (this.stalled > BOT_STALL) return this.end(false, null, `stuck ${BOT_STALL} turns ${field?.exploring ? 'exploring' : 'short of the goal'}`);
            }
            const why = this.play1(step.cmd);
            if (why) return this.end(false, null, step.note ? `${why} (${step.note})` : why);
            if (step.note) this.log.push(`${this.state.turn}:${step.note}`);
        }
    }

    /** How many tiles the crew has seen. */
    private seen(): number {
        return bitsCount(decodeBits(this.state.knowledge.seen, this.world.width * this.world.height));
    }

    private end(ok: boolean, goal: string | null, why: string): BotRun {
        return { ok, goal, turns: this.state.turn, why, log: this.log, pips: this.pips, challenges: this.challenges };
    }

    private me() { return crewMember(this.state, BOT_CREW); }

    private index(p: Pos): number { return p.y * this.world.width + p.x; }

    private goalAt(p: Pos): string | null {
        const type = this.types.get(tileAt(this.world, p)?.room ?? '');
        return type && GOALS.includes(type) ? type : null;
    }

    /**
     * Commits a command; why it failed the run (an `EXPOSED` event, or the rules refusing it), or null. Pips drawn are
     * counted, not failed.
     */
    private play1(cmd: Command): string | null {
        let events: SimEvent[];
        const before = this.state;
        try {
            const result = commit(this.world, this.state, cmd);
            events = result.events;
            this.state = result.state;
        } catch (e) {
            if (e instanceof IllegalCommand) return `refused: ${e.message}`;
            throw e;
        }
        for (const e of events) {
            if (e.type === 'suspicionRaised') this.pips++;
            if (e.type === 'challenged') {
                this.challenges++;
                const npc = (e as unknown as { npc: string }).npc;
                this.log.push(`${this.state.turn}:challenged by ${npc} (${markerKind(this.world, before, npc) !== null ? 'known' : 'unseen'}) after ${cmd.type === 'endTurn' ? 'a wait' : 'a move'}`);
            }
        }
        const bad = events.find(e => EXPOSED.has(e.type));
        if (!bad) return null;
        const f = bad as unknown as { npc?: string; camera?: string };
        // Whether the crew knew of whoever it was before the command (known: the bot took the risk, or had no way out).
        const known = f.npc ? markerKind(this.world, before, f.npc) !== null : f.camera ? before.knowledge.cameras.includes(f.camera) : false;
        return `${bad.type}${f.npc ? ` by ${f.npc}` : f.camera ? ` by ${f.camera}` : ''}${known ? ' (known)' : ' (unseen)'} on turn ${this.state.turn}`;
    }

    /**
     * The cost to the target from every tile the crew can plan on (-1 where it can't get there): the goal's tiles once
     * a goal room is known, else the frontier (`exploring`).
     */
    private field(): Field {
        const { world } = this, width = world.width, n = width * world.height;
        const plan = this.planning(), visible = new Uint8Array(n);
        for (let i = 0; i < n; i++) visible[i] = tileVisibility(world, this.state, { x: i % width, y: Math.floor(i / width) }) === 'hidden' ? 0 : 1;
        // A goal room is known once a tile of it is (seen, or on the blueprint's layout).
        const goal: number[] = [];
        world.tiles.forEach((t, i) => { if (t.room && GOALS.includes(this.types.get(t.room) ?? '') && !t.blocksMove && visible[i]) goal.push(i); });
        if (goal.length) {
            // A goal it can't get to from where it stands (yet) leaves it exploring.
            const cost = this.spread(goal.map(i => [i, 0]), visible, plan);
            if (cost[this.index(this.me().pos)]! >= 0) return { cost, exploring: false, start: new Map(goal.map(i => [i, 0])) };
        }
        const frontier = this.frontier(visible);
        return { cost: this.spread(frontier, visible, plan), exploring: true, start: new Map(frontier) };
    }

    /**
     * Dijkstra by buckets (steps cost 2 or 3, a lock to work on more), out from `targets` (each a tile and what it costs
     * to start there) over the visible tiles.
     */
    private spread(targets: readonly (readonly [number, number])[], visible: Uint8Array, plan: { step(a: Pos, b: Pos): number | undefined }): Int32Array {
        const { world } = this, width = world.width;
        const cost = new Int32Array(width * world.height).fill(-1);
        const buckets: number[][] = [];
        for (const [i, c] of targets) if (cost[i] === -1 || c < cost[i]!) { cost[i] = c; (buckets[c] ??= []).push(i); }
        for (let c = 0; c < buckets.length; c++) {
            for (const i of buckets[c] ?? []) {
                if (cost[i] !== c) continue;
                const q = { x: i % width, y: Math.floor(i / width) };
                for (const [dx, dy] of NEIGHBOURS) {
                    const p = { x: q.x + dx, y: q.y + dy }, j = this.index(p);
                    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= world.height || !visible[j]) continue;
                    const step = plan.step(p, q);
                    if (step === undefined) continue;
                    const d = c + step;
                    if (cost[j] !== -1 && cost[j]! <= d) continue;
                    cost[j] = d;
                    (buckets[d] ??= []).push(j);
                }
            }
        }
        return cost;
    }

    /**
     * Steps on the crew's picture of the bank with nobody in the way: through closed doors, locked ones it can work, and
     * locked ones it leaves by their exit side (decision 461), which cost nothing extra.
     */
    private planning(): { step(a: Pos, b: Pos): number | undefined } {
        const { world } = this, me = this.me();
        const picture = { ...planningState(world, this.state), npcs: [] };
        const base = planMoveOptions(world, this.state, me);
        const options = {
            ...base,
            canPassDoor: (door: DeepReadonly<DoorDef>, status: DoorStatus, from: DeepReadonly<Pos>) =>
                !this.dead.has(door.id) && (status === 'closed' || (status === 'locked' && (this.workable(door) || crewCanUnlatch(world, me, door, from))))
        };
        return {
            step: (a, b) => {
                const c = stepCost(world, picture, a, b, options);
                if (c === undefined) return undefined;
                const door = a.x === b.x || a.y === b.y ? doorBetween(world, a, b) : undefined;
                if (!door) return c;
                // A lock to work on costs the turn or two it takes; one it gave up waiting at, the walk round.
                const work = knownDoorStatus(world, this.state, door.id) === 'locked' && !crewCanUnlatch(world, me, door, a);
                return c + (work ? LOCK_COST : 0) + ((this.avoid.get(door.id) ?? 0) > this.state.turn ? AVOID_COST : 0);
            }
        };
    }

    /** Whether its kit opens a lock: a mechanical one picked, a card reader hacked. */
    private workable(door: DeepReadonly<DoorDef>): boolean {
        const items = this.me().loadout.items;
        return (door.lock === 'mechanical' && items.includes('lockpick')) || ((door.lock === 'keycard' || door.lock === 'maglock') && items.includes('hackingKit'));
    }

    /**
     * The tiles to explore from, each with what it costs to start there: a seen tile beside a door with a hidden tile
     * beyond (dearer the bigger the room's outline, unless it is narrow as a corridor: the goal rooms are small, and a
     * big room holds more people), or a seen tile beside a hidden one it can step to.
     */
    private frontier(visible: Uint8Array): [number, number][] {
        const { world } = this, out = new Map<number, number>(), picture = planningState(world, this.state);
        for (const door of Object.values(world.doors)) {
            if (this.dead.has(door.id)) continue;
            const sides = doorSides(world, door);
            if (!sides) continue;
            const [a, b] = sides, va = !!tileAt(world, a) && visible[this.index(a)], vb = !!tileAt(world, b) && visible[this.index(b)];
            if (va === vb) continue;
            const near = va ? a : b, far = va ? b : a, i = this.index(near), c = this.outlineCost(tileAt(world, far)?.room);
            if (!tileAt(world, near)!.blocksMove && this.passable(door) && c < (out.get(i) ?? Infinity)) out.set(i, c);
        }
        world.tiles.forEach((t, i) => {
            if (!visible[i] || t.blocksMove || !t.room) return;
            const p = { x: i % world.width, y: Math.floor(i / world.width) };
            for (const [dx, dy] of NEIGHBOURS.slice(0, 4)) {
                const q = { x: p.x + dx, y: p.y + dy }, u = tileAt(world, q);
                if (u && u.room && !u.blocksMove && !visible[this.index(q)] && !doorBetween(world, p, q) && stepCost(world, picture, p, q) !== undefined) { out.set(i, 0); return; }
            }
        });
        return [...out];
    }

    /** What exploring a room costs by its outline (the blueprint shows its shape, not what it is): its area, unless narrow. */
    private outlineCost(room: string | null | undefined): number {
        if (!room) return 0;
        let cached = this.outlines.get(room);
        if (cached === undefined) {
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, area = 0;
            this.world.tiles.forEach((t, i) => {
                if (t.room !== room) return;
                const x = i % this.world.width, y = Math.floor(i / this.world.width);
                x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
                area++;
            });
            cached = Math.min(x1 - x0, y1 - y0) < 2 ? 0 : Math.min(OUTLINE_COST, area);
            this.outlines.set(room, cached);
        }
        return cached;
    }

    /** Whether it could get through a door as the crew knows it: open, closed, or locked with a lock its kit works. */
    private passable(door: DeepReadonly<DoorDef>): boolean {
        const status = knownDoorStatus(this.world, this.state, door.id);
        return status === 'open' || status === 'breached' || status === 'closed' || (status === 'locked' && this.workable(door));
    }

    /** This action: a door to open or work on, a Move, or the end of the turn (a wait). */
    private choose(field: Field): Step {
        const { world } = this, me = this.me(), at = me.pos, here = field.cost[this.index(at)]!;
        // Standing where it explores from: its target, not a step on the way to another.
        const arrived = field.exploring && field.start.get(this.index(at)) === here;
        const floor = safeFloor(world, this.state, BOT_CREW, { dash: false, bands: ['stay', 'move'] });
        const stay = floor.tiles.find(t => t.band === 'stay');
        const move = (t: FloorTile, note: string): Step =>
            ({ cmd: { type: 'move', crew: BOT_CREW, path: t.path.map(p => ({ x: p.x, y: p.y })) }, note: `${note} ${t.pos.x},${t.pos.y}` });
        // Challenged ("you can't be back here", §8.6): back to the public floor before the deadline, and wait there.
        if (challengerOf(this.state, BOT_CREW)) {
            if (tileAt(world, at)?.zone === 'public') return { cmd: { type: 'endTurn' }, note: 'w challenged' };
            const out = this.toPublic(), from = out[this.index(at)]!, worst = (t: FloorTile) => (t.tint.kind === 'red' || t.tint.kind === 'camera' ? 1 : 0);
            // A lock on the way out is worked whoever sees it: not getting out is worse.
            const lock = this.lockBeside(at, p => out[this.index(p)]!, from);
            if (lock) return { cmd: lock, note: `${lock.action[0]} ${lock.door} out` };
            const back = floor.tiles.filter(t => t.band === 'move' && out[this.index(t.pos)]! >= 0 && (from < 0 || out[this.index(t.pos)]! < from))
                .sort((a, b) => worst(a) - worst(b) || out[this.index(a.pos)]! - out[this.index(b.pos)]!)[0];
            if (back) return move(back, 'a');
        }
        const stayGreen = stay?.tint.kind === 'safe';
        // A door beside it: one to look through (exploring, hidden tiles beyond), or a lock on the way down the field.
        for (const door of Object.values(world.doors)) {
            if (this.dead.has(door.id)) continue;
            const sides = doorSides(world, door);
            if (!sides || !sides.some(s => s.x === at.x && s.y === at.y)) continue;
            const other = sides.find(s => s.x !== at.x || s.y !== at.y)!;
            const status = knownDoorStatus(world, this.state, door.id), beyond = tileAt(world, other) ? tileVisibility(world, this.state, other) : 'hidden';
            const there = tileAt(world, other) ? field.cost[this.index(other)]! : -1;
            if (beyond === 'hidden' && arrived) {
                if (status === 'closed') {
                    const cmd: Command = { type: 'door', crew: BOT_CREW, door: door.id, action: 'open' };
                    if (!previewDanger(world, this.state, cmd)) return { cmd, note: `o ${door.id}` };
                } else if (status !== 'locked') {
                    // Open and still hidden beyond: nothing to see through it.
                    this.dead.add(door.id);
                    return this.choose(this.field());
                }
            }
            const onWay = beyond === 'hidden' ? arrived : there >= 0 && there < here;
            // A latched door it leaves by its exit side is walked through (decision 461): no lock to work.
            if (status === 'locked' && onWay && !crewCanUnlatch(world, me, door, at)) {
                if (!this.workable(door)) { this.dead.add(door.id); return this.choose(this.field()); }
                const action = door.lock === 'mechanical' ? 'pick' : 'hack';
                const cmd: Command = { type: 'door', crew: BOT_CREW, door: door.id, action };
                // When the preview warns of nothing and staying is green; after a few turns' wait, in unknown risk too.
                const danger = previewDanger(world, this.state, cmd), waited = this.waits.get(door.id) ?? 0;
                if (!danger && (stayGreen || (stay?.tint.kind === 'unknownRisk' && waited >= LOCK_PATIENCE))) {
                    this.waits.delete(door.id);
                    return { cmd, note: `${action[0]} ${door.id}` };
                }
                // Someone sees it: wait for the coast to clear a few turns, then look for another way a while.
                if (danger && waited >= LOCK_PATIENCE && (this.avoid.get(door.id) ?? 0) <= this.state.turn) {
                    this.waits.delete(door.id);
                    this.avoid.set(door.id, this.state.turn + AVOID_TURNS);
                    return this.choose(this.field());
                }
                this.waits.set(door.id, waited + 1);
                if (danger && me.actionsLeft >= world.rules.actionsPerTurn) {
                    const distraction = this.distraction(cmd);
                    if (distraction) return distraction;
                }
                if (stay && (stay.tint.kind === 'safe' || stay.tint.kind === 'unknownRisk')) return { cmd: { type: 'endTurn' }, note: `w ${door.id}` };
            }
        }
        const left = (t: FloorTile) => field.cost[this.index(t.pos)]!;
        const fit = (t: FloorTile) => t.band === 'move' && (t.tint.kind === 'safe' || t.tint.kind === 'unknownRisk') && left(t) >= 0;
        const nearer = floor.tiles.filter(t => fit(t) && (here < 0 || left(t) < here));
        // Green first, as far down the way as it goes; else into unknown risk a step at a time (the nearest tile that
        // gets nearer), seeing what is there before going on.
        const green = nearer.filter(t => t.tint.kind === 'safe').sort((a, b) => left(a) - left(b) || a.cost - b.cost)[0];
        const risky = nearer.sort((a, b) => a.cost - b.cost || left(a) - left(b))[0];
        // Off the public floor the turn's last action is kept for getting away (a Move there could show someone it could
        // then do nothing about before the world phase), unless the Move gets to the goal.
        const offPublic = (t: FloorTile) => [at, ...t.path].some(p => tileAt(world, p)?.zone !== 'public');
        const last = me.actionsLeft < world.rules.actionsPerTurn;
        if (green && (!last || !offPublic(green) || (!field.exploring && left(green) === 0))) return move(green, 'm');
        // Unknown risk after a wait or two where staying is green (something known may clear the way), at once where not.
        // Only as the turn's first action, so it has the second to get away if what it sees there is trouble.
        if (risky && me.actionsLeft >= world.rules.actionsPerTurn && (!stayGreen || this.stalled >= RISK_WAIT)) return move(risky, 'm?');
        // Waiting: where staying is green, else on the green tile nearest the target; failing that, nearer the public
        // floor; failing that, it waits anyway.
        if (!stay || stayGreen) return { cmd: { type: 'endTurn' }, note: 'w' };
        const open = floor.tiles.filter(t => t.band === 'move' && (t.tint.kind === 'safe' || t.tint.kind === 'unknownRisk'));
        const rank = (t: FloorTile) => (left(t) < 0 ? 1e6 : left(t));
        const aside = open.filter(t => t.tint.kind === 'safe').sort((a, b) => rank(a) - rank(b) || a.cost - b.cost)[0];
        if (aside) return move(aside, 'a');
        const out = this.toPublic(), from = out[this.index(at)]!;
        const back = open.filter(t => out[this.index(t.pos)]! >= 0 && (from < 0 || out[this.index(t.pos)]! < from))
            .sort((a, b) => Number(a.tint.kind !== 'safe') - Number(b.tint.kind !== 'safe') || out[this.index(a.pos)]! - out[this.index(b.pos)]!)[0];
        if (back) return move(back, 'a');
        // Nowhere a Move reaches is any good: a Dash (noisy) to a green tile, the nearest the target.
        const dash = dashRefusal(world, this.state, BOT_CREW) ? undefined : safeFloor(world, this.state, BOT_CREW, { dash: true, bands: ['dash'] }).tiles
            .filter(t => t.band === 'dash' && t.tint.kind === 'safe').sort((a, b) => rank(a) - rank(b) || a.cost - b.cost)[0];
        if (dash) return { cmd: { type: 'dash', crew: BOT_CREW, path: dash.path.map(p => ({ x: p.x, y: p.y })) }, note: `d ${dash.pos.x},${dash.pos.y}` };
        return { cmd: { type: 'endTurn' }, note: 'w!' };
    }

    /**
     * A noisemaker that turns whoever would see `cmd` away from it (§8.13): thrown where the preview shows nobody making
     * the crew member (a pip from someone who sees the throw is allowed), after which the preview of `cmd` warns of
     * nothing. The nearest such tile to the crew member.
     */
    private distraction(cmd: Command): Step | null {
        const { world } = this, at = this.me().pos;
        const targets = noisemakerTargets(world, this.state, BOT_CREW)
            .sort((a, b) => Math.max(Math.abs(a.x - at.x), Math.abs(a.y - at.y)) - Math.max(Math.abs(b.x - at.x), Math.abs(b.y - at.y)) || a.y - b.y || a.x - b.x);
        for (const to of targets) {
            const toss: Command = { type: 'throwNoisemaker', crew: BOT_CREW, to };
            try {
                const result = previewCertain(world, this.state, toss);
                if (projectPreviewEvents(world, this.state, result).some(e => e.type !== 'suspicionRaised' && UNSAFE.has(e.type))) continue;
                if (!previewDanger(world, { ...result.state, knowledge: this.state.knowledge }, cmd)) return { cmd: toss, note: `n ${to.x},${to.y}` };
            } catch (e) {
                if (e instanceof IllegalCommand || e instanceof PreviewRollError) continue;
                throw e;
            }
        }
        return null;
    }

    /** Working the lock of a locked door beside `at` it can work whose far side is nearer by `cost` than `here`, if any. */
    private lockBeside(at: Pos, cost: (p: Pos) => number, here: number): Extract<Command, { type: 'door' }> | null {
        const { world } = this;
        for (const door of Object.values(world.doors)) {
            const sides = doorSides(world, door);
            if (!sides || !sides.some(s => s.x === at.x && s.y === at.y) || knownDoorStatus(world, this.state, door.id) !== 'locked' || !this.workable(door)) continue;
            // Leaving by its exit side, a Move walks through it (decision 461).
            if (crewCanUnlatch(world, this.me(), door, at)) continue;
            const other = sides.find(s => s.x !== at.x || s.y !== at.y)!;
            if (!tileAt(world, other) || cost(other) < 0 || (here >= 0 && cost(other) >= here)) continue;
            return { type: 'door', crew: BOT_CREW, door: door.id, action: door.lock === 'mechanical' ? 'pick' : 'hack' };
        }
        return null;
    }

    /** The cost to the public floor from every tile the crew can plan on (as `field`). */
    private toPublic(): Int32Array {
        const { world } = this, n = world.width * world.height, visible = new Uint8Array(n), targets: [number, number][] = [];
        for (let i = 0; i < n; i++) {
            const p = { x: i % world.width, y: Math.floor(i / world.width) }, t = world.tiles[i]!;
            visible[i] = tileVisibility(world, this.state, p) === 'hidden' ? 0 : 1;
            if (visible[i] && t.zone === 'public' && t.room && !t.blocksMove) targets.push([i, 0]);
        }
        return this.spread(targets, visible, this.planning());
    }
}
