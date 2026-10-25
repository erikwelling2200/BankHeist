import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/gen/rng';
import { archetypesFor } from '../../src/gen/generate';
import { cachedBank } from '../bankCache';
import { PLOTS, TIERS } from '../../src/gen/model';
import { COMBAT_COMMANDS, PICTURED_COMMANDS,
    carriersStarted, clonePlain, commit, crewBudget, crewMoveOptions, deserialiseState, driveByDue, hashOf, initialState, isKnownNow, legalActions,
    pendingCarriers, preview, projectCarriers, projectEvents, serialiseState, tileAt, validatePath, worldFromBank,
    type Command, type Pos, type ReadonlyWorld, type State
} from '../../src/sim';

/*
 * M1-08's promises fuzzed on generated banks (every tier × archetype, the plots in turn): a random crew (one at the alarm panel
 * with a hacking kit, one masked and armed near a random NPC, one at the CCTV desk with a kit and a jammer) plays
 * random legal actions and moves, and every world phase is checked:
 *
 * - every carrier starts at 2 or more, and is first seen in a crew phase at 2 or more unless the crew started it;
 * - `pendingCarriers` names exactly the carriers ending the turn starts, and each was telegraphed (an NPC's committed
 *   alarm or flee intent, a camera report, a ringing radio, a drive-by due);
 * - every running carrier has a counter that still works mid-countdown (tried on copies: the holder knocked out, the
 *   panel dead, a jammer on it, the operator down; answering for a missed check-in);
 * - projections: `carrierStarted` and `projectCarriers` never name a holder the crew doesn't know, and drop nothing;
 * - no carrier outlives the Alarm; a save loaded mid-countdown continues identically; replaying the log is identical.
 *
 * CARRIER_FUZZ_SEEDS and CARRIER_FUZZ_TURNS make it larger (default 1 seed, 12 turns per bank; CARRIER_FUZZ_PLOTS=all for every plot).
 */

const SEEDS = Number(process.env.CARRIER_FUZZ_SEEDS ?? 1);
const TURNS = Number(process.env.CARRIER_FUZZ_TURNS ?? 12);

function bfsPath(world: ReadonlyWorld, state: State, from: Pos, to: Pos, max: number): Pos[] {
    const occ = new Set([...state.npcs, ...state.crew].map(p => `${p.pos.x},${p.pos.y}`));
    const prev = new Map<string, string | null>([[`${from.x},${from.y}`, null]]);
    const q: Pos[] = [from];
    let best: Pos = from, bd = Infinity;
    while (q.length) {
        const p = q.shift()!;
        const d = Math.abs(p.x - to.x) + Math.abs(p.y - to.y);
        if (d < bd) { bd = d; best = p; }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = { x: p.x + dx!, y: p.y + dy! }, k = `${n.x},${n.y}`;
            if (prev.has(k)) continue;
            const t = tileAt(world, n);
            if (!t || t.blocksMove || occ.has(k)) continue;
            prev.set(k, `${p.x},${p.y}`);
            q.push(n);
        }
        if (prev.size > 4000) break;
    }
    const path: Pos[] = [];
    let k: string | null = `${best.x},${best.y}`;
    while (k && k !== `${from.x},${from.y}`) {
        const [x, y] = k.split(',').map(Number);
        path.unshift({ x: x!, y: y! });
        k = prev.get(k)!;
    }
    return path.slice(0, max);
}

interface Stats { [k: string]: number }

describe('M1-08 fuzz on generated banks', () => {
    it('keeps the carrier promises', () => {
        const failures: string[] = [];
        const stats: Stats = {};
        const bump = (k: string, n = 1) => { stats[k] = (stats[k] ?? 0) + n; };
        const counterOk: Record<string, Record<string, number>> = {};
        const timing: Record<string, number[]> = {};
        // Every tier × archetype, the plots taken in turn (all of them with CARRIER_FUZZ_PLOTS=all).
        let combo = 0;
        const plotsFor = (): readonly (typeof PLOTS)[number][] => (process.env.CARRIER_FUZZ_PLOTS === 'all' ? PLOTS : [PLOTS[combo++ % PLOTS.length]!]);
        for (const tier of TIERS) for (const archetype of archetypesFor(tier)) for (const plot of plotsFor()) for (let s = 0; s < SEEDS; s++) {
            const label = `${tier}/${archetype}/${plot}/${s}`;
            const bank = cachedBank({ layout: 3000 + s * 101, population: s + 5, tier, archetype, plot });
            const world = worldFromBank(bank);
            const rng = new Rng(9000 + s * 31 + tier.length * 7 + archetype.length);
            const free: Pos[] = [];
            world.tiles.forEach((t, i) => { if (!t.blocksMove && t.room !== null) free.push({ x: i % world.width, y: Math.floor(i / world.width) }); });
            const taken = new Set(world.people.map(p => `${p.pos.x},${p.pos.y}`));
            const pick = (near?: Pos): Pos => {
                const cands = free.filter(p => !taken.has(`${p.x},${p.y}`) && (!near || Math.max(Math.abs(p.x - near.x), Math.abs(p.y - near.y)) <= 3));
                const p = rng.pick(cands.length ? cands : free.filter(p => !taken.has(`${p.x},${p.y}`)));
                taken.add(`${p.x},${p.y}`);
                return p;
            };
            const panel = world.objects.find(o => o.kind === 'alarmPanel');
            const desk = world.objects.find(o => o.kind === 'cctvDesk');
            const guards = world.people.filter(p => p.observer === 'enforcer');
            const victim = process.env.CARRIER_FUZZ_QUIET && guards.length ? rng.pick(guards) : rng.pick(world.people);
            const crew = [
                { id: 'c0', pos: pick(panel?.pos), items: ['hackingKit'], traits: rng.chance(0.3) ? ['steadyHands'] : [] },
                { id: 'c1', pos: pick(victim.pos), ...(process.env.CARRIER_FUZZ_QUIET ? {} : { masked: true }), items: [...(process.env.CARRIER_FUZZ_QUIET ? [] : ['assaultRifle']), ...(rng.chance(0.4) ? ['jammer'] : [])] },
                { id: 'c2', pos: pick(desk?.pos), items: ['hackingKit', 'jammer'], traits: rng.chance(0.3) ? ['smoothTalker'] : [] }
            ];
            let state = initialState(world, { seed: s, crew });
            const initial = clonePlain(state);
            const log: Command[] = [];
            const seenCountdown = new Map<string, number>();
            const doCmd = (cmd: Command): boolean => {
                let r;
                try {
                    const pv = preview(world, state, cmd);
                    r = commit(world, state, cmd);
                    // A roll the preview stopped at (a resister's chance) leaves its state short of the commit.
                    if (cmd.type !== 'endTurn' && !pv.pending && hashOf(pv.state) !== hashOf(r.state)) failures.push(`${label} preview!=commit ${cmd.type}`);
                } catch (e) { bump(`refused ${cmd.type}`); return false; }
                log.push(cmd);
                for (const e of r.events) if (e.type === 'carrierStarted') {
                    if (e.countdown < 2) failures.push(`${label} ${e.kind} started at ${e.countdown}`);
                    if (cmd.type !== 'endTurn') { bump(`crewPhaseStart ${e.kind}`); }
                }
                // Projection leak: carrierStarted naming an NPC the crew doesn't know (nor saw during the command: a runner
                // seen running out of the map, M2-01).
                const seenDuring = (id: string): boolean => Object.hasOwn(r.state.knowledge.npcs, id) && r.state.knowledge.npcs[id]!.tick > state.knowledge.tick;
                const proj = projectEvents(world, r.state, r.events, state);
                for (const e of proj) {
                    if (e.type === 'carrierStarted' && e.holder !== null && world.people.some(p => p.id === e.holder) && !isKnownNow(world, r.state, e.holder)
                        && !isKnownNow(world, state, e.holder) && !seenDuring(e.holder)) failures.push(`${label} carrierStarted names unknown holder (${e.kind})`);
                }
                const shown = proj.filter(e => e.type === 'carrierStarted').length, started = r.events.filter(e => e.type === 'carrierStarted').length;
                if (shown !== started) failures.push(`${label} ${started - shown} carrierStarted hidden by the projection`);
                state = r.state;
                return true;
            };
            for (let turn = 0; turn < TURNS && !state.bank.alarm; turn++) {
                for (let k = 0; k < 5; k++) {
                    const member = rng.pick(state.crew);
                    if (member.actionsLeft < 1) continue;
                    if (rng.chance(0.4)) {
                        // The combat commands that play here (swap, reload, Watch, a strike, a flip…) now and then, so the stealth ones keep their share.
                        const armed = rng.chance(0.15);
                        const opts = legalActions(world, state, member.id).filter(c => c.type !== 'wait' && !PICTURED_COMMANDS.has(c.type) && (armed || !COMBAT_COMMANDS.has(c.type)));
                        if (!opts.length) continue;
                        const kinds = [...new Set(opts.map(c => c.type))];
                        const kind = rng.pick(kinds);
                        const cmd = rng.pick(opts.filter(c => c.type === kind));
                        if (doCmd(cmd)) bump(`act ${cmd.type}`);
                        continue;
                    }
                    const goal = member.id === 'c0' && panel ? panel.pos : member.id === 'c2' && desk ? desk.pos
                        : rng.chance(0.6) ? (state.npcs.find(n => n.id === victim.id)?.pos ?? rng.pick(free)) : rng.pick(free);
                    const path = bfsPath(world, state, member.pos, goal, rng.int(1, 5));
                    if (!path.length || !validatePath(world, state, member.pos, path, crewBudget(world, member, 'move'), crewMoveOptions(world, member)).ok) continue;
                    doCmd({ type: 'move', crew: member.id, path });
                }
                // Counters mid-countdown, on copies (abstract: the condition, not whether the crew can reach it).
                for (const c of state.carriers) {
                    if (c.halted) { bump(`already halted ${c.kind}`); continue; }
                    const tries: Record<string, (s: State) => void> = {
                        knockout: s => { const n = s.npcs.find(n => n.id === c.source); if (n) { n.status = 'unconscious'; n.outCold = s.turn + 5; } else throw 0; },
                        panel: s => { const ps = world.objects.filter(o => o.kind === 'alarmPanel'); if (!ps.length) throw 0; for (const p of ps) (s.objects[p.id] ??= {}).disabled = true; },
                        jammer: s => { s.jammers.push({ id: 'jx', pos: { ...c.pos }, crew: 'c2', turn: s.turn }); },
                        operator: s => { const ops = world.people.filter(p => p.role === 'operator'); if (!ops.length) throw 0; for (const o of ops) { const n = s.npcs.find(n => n.id === o.id)!; n.status = 'unconscious'; n.outCold = s.turn + 5; } }
                    };
                    const ok: string[] = [];
                    for (const [name, mutate] of Object.entries(tries)) {
                        const s2 = clonePlain(state);
                        s2.carriers = s2.carriers.filter(x => x.id === c.id);
                        try { mutate(s2); } catch { continue; }
                        // Play the rest of the countdown: does it still fire?
                        let s3 = s2, works = false;
                        for (let i = 0; i < c.countdown + 1; i++) {
                            const r = commit(world, s3, { type: 'endTurn' });
                            if (r.events.some(e => e.type === 'carrierStopped' && e.carrier === c.id && e.why !== 'alarm')) { works = true; break; }
                            if (r.events.some(e => e.type === 'alarmRaised')) break;
                            s3 = r.state;
                            const still = s3.carriers.find(x => x.id === c.id);
                            if (still && still.halted === 'paused' && still.countdown === c.countdown) { works = true; break; }
                        }
                        if (works) ok.push(name);
                    }
                    if (c.kind === 'missedCheckIn') ok.push('answer?');
                    (counterOk[c.kind] ??= {});
                    const key = ok.sort().join('+') || 'NONE';
                    counterOk[c.kind]![key] = (counterOk[c.kind]![key] ?? 0) + 1;
                    if (!ok.length) failures.push(`${label} ${c.kind} with no counter that works mid-countdown`);
                    if (ok.length < 2) bump(`carrier with <2 working counters: ${c.kind} [${key}]`);
                    if (!seenCountdown.has(c.id)) {
                        seenCountdown.set(c.id, c.countdown);
                        if (c.countdown < 2 && !(c.started.phase === 'crew' && c.started.turn === state.turn)) failures.push(`${label} ${c.kind} first seen in crew phase at ${c.countdown}`);
                    }
                }
                // The coming world phase: pending == started; each NPC start has a telegraphed intent.
                const pending = pendingCarriers(world, state).map(c => `${c.kind} ${c.source} ${c.countdown}`).sort();
                const projected = projectCarriers(world, state, pendingCarriers(world, state));
                if (projected.length !== pending.length) failures.push(`${label} pending carriers hidden by projectCarriers`);
                for (const c of projected) if (c.source !== null && world.people.some(p => p.id === c.source) && !isKnownNow(world, state, c.source)) failures.push(`${label} projectCarriers names an unknown holder`);
                const before = state;
                const t0 = performance.now();
                doCmd({ type: 'endTurn' });
                (timing[tier] ??= []).push(performance.now() - t0);
                const r = commit(world, before, { type: 'endTurn' });
                const started = carriersStarted(r.events).map(c => `${c.kind} ${c.source} ${c.countdown}`).sort();
                if (JSON.stringify(pending) !== JSON.stringify(started)) failures.push(`${label} t${before.turn} pending ${pending} != started ${started}`);
                for (const c of carriersStarted(r.events)) {
                    bump(`started ${c.kind}`);
                    const npc = before.npcs.find(n => n.id === c.source);
                    const action = npc?.intent.action;
                    let telegraphed = false;
                    if (action && (action.kind === 'raiseAlarm' || action.kind === 'reportEvidence') && action.carrier === c.kind) telegraphed = true;
                    if (c.kind === 'escapee' && action?.kind === 'flee') telegraphed = true;
                    if (c.kind === 'phoneCall' && action?.kind === 'hide') telegraphed = true;
                    if (c.kind === 'operatorCamera' && (before.cameraReports.length || r.events.some(e => e.type === 'cameraSaw'))) telegraphed = true;
                    if (c.kind === 'missedCheckIn' && Object.values(before.radio.calls).some(cl => cl.ringing !== null)) telegraphed = true;
                    if (c.kind === 'patrolCar' && driveByDue(world, before, before.turn)) telegraphed = true;
                    if (!telegraphed) failures.push(`${label} t${before.turn} ${c.kind} by ${c.source} without telegraph (intent ${JSON.stringify(action)})`);
                    if (c.kind === 'operatorCamera' && !before.cameraReports.length) bump('operatorCamera from a world-phase camera sighting');
                }
                // An escapee raises the Alarm only once its runner is off the map (§9.1: it got out).
                for (const e of r.events) {
                    if (e.type !== 'alarmRaised') continue;
                    const c = before.carriers.find(x => x.id === e.carrier);
                    const runner = c?.kind === 'escapee' ? r.state.npcs.find(n => n.id === c.source) : undefined;
                    if (runner && runner.status !== 'away') failures.push(`${label} t${before.turn} escapee alarm with ${runner.id} still at ${runner.pos.x},${runner.pos.y}`);
                    if (c?.kind === 'escapee') bump('escapee alarms');
                }
                if (r.events.some(e => e.type === 'confronted')) bump('confronted');
                if (state.bank.alarm) { bump(`alarm by ${state.response?.by}`); if (state.carriers.length) failures.push(`${label} carriers after alarm`); }
                // Save/load mid-countdown.
                if (state.carriers.length) {
                    const back = deserialiseState(serialiseState({ state })).state;
                    if (hashOf(back) !== hashOf(state)) failures.push(`${label} save/load hash differs`);
                    const a = commit(world, state, { type: 'endTurn' }), b = commit(world, back, { type: 'endTurn' });
                    if (hashOf(a.state) !== hashOf(b.state)) failures.push(`${label} save/load diverges`);
                    bump('saveload mid-countdown');
                }
            }
            // Determinism.
            let replay = initial;
            for (const cmd of log) replay = commit(world, replay, cmd).state;
            if (hashOf(replay) !== hashOf(state)) failures.push(`${label} replay differs`);
        }
        if (process.env.CARRIER_FUZZ_VERBOSE) console.log(JSON.stringify({ stats, counterOk, timing: Object.fromEntries(Object.entries(timing).map(([t, xs]) => [t, xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]])) }, null, 1));
        expect(failures.slice(0, 20)).toEqual([]);
        // The sample has to exercise the rules: carriers start, and some run long enough to be countered and saved.
        expect(Object.keys(stats).filter(k => k.startsWith('started ')).length).toBeGreaterThan(1);
        expect(stats['saveload mid-countdown'] ?? 0).toBeGreaterThan(0);
    }, 600_000);
});
