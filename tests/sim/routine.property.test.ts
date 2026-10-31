import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/gen/rng';
import {
    commit, fixtureWorld, hashOf, IllegalCommand, initialState, leanOptions, legalActions, newTeam, OFFICER_FLASHBANGS, OFFICER_STATS,
    type Command, type FixtureWall, type Material, type NpcStatus, type PersonDef, type PoliceKind, type PoliceMode, type Pos, type ReadonlyWorld, type SimEvent, type State
} from '../../src/sim';

/*
 * The police and guard routine keeps its promises (M3-05 accept; §13.5, §13.6): in random loud fixtures with masked crew,
 * officers of every fighting kind in every mode, Hostile guards, bystanders standing about, hostages face down, tied or
 * held up as shields, half cover, columns and a wall with a locked door, played through several world phases:
 *
 * - **Never through a standing non-crew body:** no shot an officer or a guard fires meets anyone but the crew. The
 *   routine fires only a shot whose preview (`previewShot`, every bullet's arc) meets the crew alone (`cleanShot`, asked
 *   as the bullets leave); that a preview holds every outcome is M3-01's property test, and here the outcome is checked:
 *   every body every such bullet met is a crew member.
 * - **Every breach announced a phase ahead:** each door blown in a world phase had its marker, by the same officer,
 *   standing through the crew phase before it; every marker is carried out or called off, once, and the state's markers
 *   are exactly those still open.
 * - **SWAT team play** (M3-06), with a team of 2 to 4 half the time: police grenades land in one world phase and go off
 *   as the next starts, so each lies through a crew phase; the team never all moves at once (only its movers walk, but
 *   the Hurt falling back, outside a pull back from a casualty). Its wedges' volleys are police shots like any other,
 *   checked above, and its breaches are checked as the routine's.
 * - The crew plays too, at random: Watch, Suppress, attacks (leaning now and then), moves, reloads and flashbangs.
 * - The same game played twice ends the same.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const KINDS: PoliceKind[] = ['patrol', 'patrol', 'swat', 'swatShield', 'heavy'];
const MODES: PoliceMode[] = ['contain', 'assault', 'assault', 'regroup', 'negotiate'];

/** Someone standing about, who would leave by (0, 0) at turn 99. */
const person = (id: string, pos: Pos, role: string, observer: PersonDef['observer'], facing: PersonDef['facing']): PersonDef => ({
    id, name: id, role, observer, pos, facing,
    schedule: [{ from: 1, activity: 'wait', label: 'waiting', room: '', at: pos, facing }, { from: 99, activity: 'leave', label: 'leaving', room: '', at: P(0, 0) }]
});

function randomGame(rng: Rng): { world: ReadonlyWorld; state: State } {
    const w = 16 + rng.int(0, 4), h = 8 + rng.int(0, 3);
    const rows = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
        if (y === 0 && x === 0) return '.';
        return rng.chance(0.05) ? '#' : rng.chance(0.03) ? 'T' : '.';
    }).join(''));
    // A wall across the middle with a locked door, half the time.
    const walls: FixtureWall[] = [];
    if (rng.chance(0.5)) {
        const x = rng.int(6, w - 8), door = rng.int(1, h - 2);
        for (let y = 0; y < h; y++) {
            walls.push({
                between: [P(x, y), P(x + 1, y)], material: (y === door ? 'doorWood' : 'plaster') as Material,
                ...(y === door ? { door: { id: 'd', lock: 'mechanical' as const, start: 'locked' as const } } : {})
            });
        }
    }
    const taken = new Set<string>(['0 0']);
    const free = (x0: number, x1: number): Pos => {
        for (;;) {
            const p = P(rng.int(x0, x1), rng.int(0, h - 1));
            if (rows[p.y]![p.x] === '.' && !taken.has(`${p.x} ${p.y}`)) {
                taken.add(`${p.x} ${p.y}`);
                return p;
            }
        }
    };
    const crewAt = [free(0, 4)];
    // Half the time side by side (a cluster for a flashbang, M3-06), else anywhere near the west end.
    const beside = [P(crewAt[0]!.x + 1, crewAt[0]!.y), P(crewAt[0]!.x, crewAt[0]!.y + 1), P(crewAt[0]!.x, crewAt[0]!.y - 1)]
        .find(p => p.y >= 0 && p.y < h && rows[p.y]![p.x] === '.' && !taken.has(`${p.x} ${p.y}`));
    if (beside && rng.chance(0.5)) {
        taken.add(`${beside.x} ${beside.y}`);
        crewAt.push(beside);
    } else crewAt.push(free(0, 6));
    const people: PersonDef[] = [];
    const n = rng.int(3, 7);
    for (let i = 0; i < n; i++) people.push(person(`c${i}`, free(1, w - 2), 'customer', 'civilian', rng.pick(['n', 'e', 's', 'w'] as const)));
    if (rng.chance(0.5)) people.push(person('guard', free(4, w - 1), 'lobbyGuard', 'enforcer', 'w'));
    const world = fixtureWorld(rows, { walls, people });
    const s = initialState(world, {
        seed: rng.int(1, 1e6), crew: [{ id: 'jun', pos: crewAt[0]!, items: ['pistol', 'flashbang'] }, { id: 'mara', pos: crewAt[1]!, items: ['lmg', 'smg'] }]
    });
    for (const c of s.crew) c.loadout.masked = rng.chance(0.85);
    s.bank.alarm = true;
    s.bank.loud = true;
    s.response = { raised: s.turn - 5, by: 'tellerButton', policeIn: 0, heat: rng.int(3, 16) };
    s.police.sent = 5;
    s.police.mode = { kind: rng.pick(MODES), left: rng.int(2, 6), since: { turn: s.turn - 1, phase: 'world' }, after: null };
    if (rng.chance(0.5)) s.police.known.jun = { tile: { ...crewAt[0]! }, turn: 0, down: false };
    for (const npc of s.npcs) {
        if (npc.id === 'guard') {
            npc.status = 'hostile';
            continue;
        }
        const status: NpcStatus = rng.pick(['calm', 'calm', 'commanded', 'tied', 'alerted']);
        npc.status = status;
        if (status === 'commanded') npc.command = { pips: 3, by: 'jun' };
    }
    // A hostage held up as a shield, now and then.
    const near = s.npcs.find(n => n.status === 'commanded' && Math.max(Math.abs(n.pos.x - crewAt[0]!.x), Math.abs(n.pos.y - crewAt[0]!.y)) <= 1);
    if (near && rng.chance(0.7)) {
        s.crew[0]!.dragging = near.id;
        s.crew[0]!.leading = true;
    }
    const units = rng.int(1, 4);
    for (let i = 0; i < units; i++) {
        const kind = rng.pick(KINDS);
        s.police.units.push({ id: `police-${i + 1}`, kind, vehicle: null, staging: null, arrived: -3, pos: free(w - 5, w - 1), hp: OFFICER_STATS[kind].hp, leaning: null, suppressed: null, moved: null, team: null, watch: null, flashbangs: 0, surprised: null });
    }
    // A SWAT team (M3-06) of 2 to 4, a shield first, half the time.
    if (rng.chance(0.5)) {
        s.police.teams.van = newTeam();
        const size = rng.int(2, 4);
        for (let i = 0; i < size; i++) {
            const kind: PoliceKind = i === 0 ? 'swatShield' : 'swat';
            s.police.units.push({
                id: `swat-${i + 1}`, kind, vehicle: null, staging: null, arrived: -3, pos: free(7, w - 1), hp: OFFICER_STATS[kind].hp, leaning: null, suppressed: null, moved: null,
                team: 'van', watch: null, flashbangs: OFFICER_FLASHBANGS[kind], surprised: null
            });
        }
    }
    return { world, state: s };
}

const fighters = (state: State): Set<string> => new Set([...state.police.units.map(u => u.id), ...state.npcs.map(n => n.id)]);

const GAMES = 60, PHASES = 6;

/** The crew's turn, at random: Watch, Suppress, attacks (leaning now and then), moves, or nothing. */
function crewTurn(world: ReadonlyWorld, state: State, rng: Rng, seen: (events: readonly SimEvent[]) => void): State {
    let s = state;
    for (const member of state.crew.map(c => c.id)) {
        for (let n = 0; n < 2; n++) {
            const me = s.crew.find(c => c.id === member);
            if (!me || me.actionsLeft < 1) break;
            const legal = legalActions(world, s, member).filter(c => PLAYED.has(c.type));
            const leans = leanOptions(world, s, member);
            const attacks = legal.filter((c): c is Extract<Command, { type: 'attack' }> => c.type === 'attack');
            const leaning = leans.length && attacks.length && rng.chance(0.3) ? [{ ...rng.pick(attacks), lean: { ...rng.pick(leans).at } }] : [];
            const options = [...legal, ...leaning];
            if (!options.length || rng.chance(0.25)) break;
            try {
                const r = commit(world, s, rng.pick(options));
                seen(r.events);
                s = r.state;
            } catch (e) {
                if (!(e instanceof IllegalCommand)) throw e;
            }
        }
    }
    return s;
}

const PLAYED = new Set(['watch', 'suppress', 'attack', 'move', 'reload', 'throwGrenade']);

describe('the police and guard routine and SWAT team play (property, M3-05, M3-06)', { timeout: 180000 }, () => {
    it('never fires through a standing non-crew body, and announces every breach a phase ahead', () => {
        let shots = 0, held = 0, breaches = 0, announced = 0, volleys = 0, wedges = 0, wedgeVolleys = 0, grenades = 0, teamPhases = 0;
        for (let g = 0; g < GAMES; g++) {
            const rng = new Rng(9100 + g);
            const { world, state } = randomGame(rng);
            let s = state;
            // Every marker announced is carried out or called off, each once.
            const open = new Map<string, number>();
            // Police grenades by the world phase they landed in.
            const landed = new Map<string, number>();
            // The team's members lost, and its pull backs: each loss answered by one pull back at most.
            let losses = 0, pulls = 0;
            const lost = (events: readonly SimEvent[]): void => {
                losses += events.filter(e => e.type === 'policeDown' && e.unit.startsWith('swat')).length;
            };
            const settle = (events: readonly SimEvent[], k: number): void => {
                for (const e of events) {
                    if (e.type === 'breachAnnounced') {
                        expect(open.has(e.door), `game ${g} phase ${k}: ${e.door} announced twice`).toBe(false);
                        open.set(e.door, k);
                    }
                    if (e.type === 'doorBreached' || e.type === 'breachCalledOff') {
                        expect(open.has(e.door), `game ${g} phase ${k}: ${e.type} ${e.door} with no marker`).toBe(true);
                        open.delete(e.door);
                    }
                }
            };
            for (let k = 0; k < PHASES && s.crew.length && !s.outcome; k++) {
                s = crewTurn(world, s, rng, events => {
                    settle(events, k);
                    lost(events);
                    volleys += events.filter(e => e.type === 'attacked').length;
                });
                const before = s, crewIds = new Set(before.crew.map(c => c.id)), others = fighters(before);
                const r = commit(world, before, { type: 'endTurn' });
                settle(r.events, k);
                lost(r.events);
                // Each police wedge tripped in the crew phase answers at once as the combat step starts: fires or holds.
                for (const u of before.police.units) {
                    const trip = u.watch?.turn === before.turn - 1 ? u.watch.tripped : null;
                    if (!trip || u.surprised === before.turn || before.police.mode?.kind === 'negotiate') continue;
                    const crewUp = before.crew.some(c => c.id === trip.crew && !c.wounds.dead && c.wounds.downed === null);
                    const answered = r.events.some(e => (e.type === 'fighterFired' && e.shooter === u.id && e.at.x === trip.at.x && e.at.y === trip.at.y)
                        || (e.type === 'heldFire' && e.shooter === u.id && e.target === trip.crew));
                    if (crewUp && answered) wedgeVolleys++;
                }
                for (const e of r.events) {
                    if (e.type === 'shotFired' && others.has(e.shooter)) {
                        shots++;
                        for (const b of e.bullets) for (const step of b.steps) {
                            if (step.kind === 'body') expect(crewIds.has(step.id), `game ${g} phase ${k}: ${e.shooter} hit ${step.id}`).toBe(true);
                        }
                    }
                    if (e.type === 'heldFire') held++;
                    if (e.type === 'policeWatching') wedges++;
                    // A police grenade lies through a crew phase: it lands in one world phase and goes off as the next starts.
                    if (e.type === 'policeGrenade') {
                        grenades++;
                        landed.set(e.grenade, k);
                        expect(r.state.grenades.find(x => x.id === e.grenade)?.turn, `game ${g} phase ${k}: ${e.grenade} not fused`).toBe(before.turn + 1);
                    }
                    if (e.type === 'grenadeWentOff' && landed.has(e.grenade)) expect(k, `game ${g}: ${e.grenade} went off early`).toBe(landed.get(e.grenade)! + 1);
                    if (e.type === 'breachAnnounced') announced++;
                    if (e.type === 'doorBreached') {
                        breaches++;
                        const marker = before.police.breaches.find(b => b.door === e.door && b.unit === e.unit);
                        expect(marker && marker.turn < before.turn, `game ${g} phase ${k}: ${e.door} breached unannounced`).toBe(true);
                    }
                }
                // A SWAT team never all moves at once (fire and movement): only its movers walk, and the members hurt falling
                // back, but in a pull back from a casualty; and a casualty is answered by one pull back, not two.
                const team = r.state.police.teams.van, out = before.police.units.filter(u => u.team === 'van' && u.pos);
                if (team && team.planned === before.turn && team.pulling) {
                    pulls++;
                    expect(pulls, `game ${g} phase ${k}: a pull back with no casualty to answer`).toBeLessThanOrEqual(losses);
                }
                if (team && out.length >= 2 && team.planned === before.turn && !team.pulling) {
                    teamPhases++;
                    const hurt = (id: string): boolean => [before, r.state].some(x => x.police.units.some(u => u.id === id && u.hp * 2 <= OFFICER_STATS[u.kind].hp));
                    const walked = new Set(r.events.flatMap(e => (e.type === 'policeMoved' && e.unit.startsWith('swat') ? [e.unit] : [])));
                    for (const id of walked) expect(team.movers.includes(id) || hurt(id), `game ${g} phase ${k}: ${id} moved out of turn`).toBe(true);
                    const sound = [...walked].filter(id => !hurt(id));
                    expect(sound.length, `game ${g} phase ${k}: the whole team moved`).toBeLessThan(out.length);
                }
                // Breaches are only ever announced in the world phase, for the next one; the state holds what is open.
                for (const b of r.state.police.breaches) expect(b.turn).toBe(before.turn);
                expect([...open.keys()].sort()).toEqual(r.state.police.breaches.map(b => b.door).sort());
                s = r.state;
            }
        }
        // The rule is exercised: shots fired, shots held, doors breached, the crew firing back.
        expect(shots).toBeGreaterThan(40);
        expect(held).toBeGreaterThan(2);
        expect(announced).toBeGreaterThan(4);
        expect(breaches).toBeGreaterThan(4);
        expect(volleys).toBeGreaterThan(40);
        expect(wedges).toBeGreaterThan(10);
        expect(wedgeVolleys).toBeGreaterThan(3);
        expect(grenades).toBeGreaterThan(2);
        expect(teamPhases).toBeGreaterThan(40);
    });

    it('plays the same twice', () => {
        const a = randomGame(new Rng(4242)), b = randomGame(new Rng(4242));
        let sa = a.state, sb = b.state;
        const ea: SimEvent[][] = [], eb: SimEvent[][] = [];
        for (let k = 0; k < 4; k++) {
            const ra = commit(a.world, sa, { type: 'endTurn' }), rb = commit(b.world, sb, { type: 'endTurn' });
            ea.push(ra.events);
            eb.push(rb.events);
            sa = ra.state;
            sb = rb.state;
        }
        expect(ea).toEqual(eb);
        expect(hashOf(sa)).toBe(hashOf(sb));
    });
});
