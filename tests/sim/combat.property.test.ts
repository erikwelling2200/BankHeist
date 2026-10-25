import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/gen/rng';
import {
    attackCone, COMBAT_COMMANDS, commit, fixtureWorld, hashOf, initialState, legalActions, preview, traceShot,
    type Command, type FixtureWall, type NpcStatus, type PersonDef, type Pos, type ReadonlyWorld, type SimEvent, type State
} from '../../src/sim';

/*
 * The combat actions' previews keep the promise (M3-02; §2.2, §11.7): random play of every combat command `legalActions`
 * offers (and moves, waits and ends of turn) in random fixtures with armed crew and Hostile, armed and unarmed NPCs.
 *
 * - A command that rolls nothing previews to its commit exactly (state and events).
 * - One that fires stops its preview at the bullets with no chance shown (`p` null), and everything before the stop
 *   is the commit's own beginning; each attack's recorded rolls, traced on the state the preview stopped at (where the
 *   cone is drawn), replay to the hits it dealt (`traceShot`).
 * - An end of turn's preview is likewise the start of the real one.
 * - Grenades land a phase before they go off: every one that goes off was lying there, drawn, through a crew phase.
 */

const P = (x: number, y: number): Pos => ({ x, y });
const LOADOUTS = [['pistol', 'flashbang'], ['smg', 'taser', 'smoke'], ['lmg', 'pistol'], ['shotgun', 'flashbang', 'smoke'], ['dmr', 'machinePistol'], ['assaultRifle']];
const STATUSES: NpcStatus[] = ['calm', 'hostile', 'hostile', 'alerted', 'curious'];

function randomGame(rng: Rng): { world: ReadonlyWorld; state: State } {
    const w = 12 + rng.int(0, 6), h = 7 + rng.int(0, 3);
    const rows = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (y > 0 && x > 2 && rng.chance(0.06) ? '#' : '.')).join(''));
    const walls: FixtureWall[] = [], edges = new Set<string>();
    for (let k = 0; k < 4; k++) {
        const x = rng.int(3, w - 2), y = rng.int(0, h - 1);
        if (edges.has(`${x} ${y}`)) continue;
        edges.add(`${x} ${y}`);
        walls.push({ between: [P(x, y), P(x + 1, y)], material: rng.pick(['soft', 'glass', 'reinforced', 'tellerGlass'] as const) });
    }
    const taken = new Set<string>();
    const free = (): Pos => {
        for (;;) {
            const p = P(rng.int(0, w - 1), rng.int(0, h - 1));
            if (rows[p.y]![p.x] === '.' && !taken.has(`${p.x} ${p.y}`)) {
                taken.add(`${p.x} ${p.y}`);
                return p;
            }
        }
    };
    const people: PersonDef[] = Array.from({ length: 3 + rng.int(0, 3) }, (_, i) => {
        const guard = rng.chance(0.5);
        return { id: `n${i}`, name: `n${i}`, role: guard ? 'lobbyGuard' : 'customer', observer: guard ? 'enforcer' : 'civilian', pos: free(), facing: 'w', schedule: [] };
    });
    const world = fixtureWorld(rows, { walls, people });
    const crew = [0, 1].map(i => ({ id: `c${i}`, pos: free(), items: [...rng.pick(LOADOUTS)] }));
    const state = initialState(world, { seed: rng.int(1, 1e6), crew });
    for (const n of state.npcs) n.status = rng.pick(STATUSES);
    // Most games are a firefight already (grenades want a loud bank); some start quiet.
    state.bank.loud = rng.chance(0.75);
    return { world, state };
}

const firedRolls = (events: readonly SimEvent[]): number => events.filter(e => e.type === 'shotFired').length;

describe('combat previews (property)', () => {
    it('are the outcome up to the dice, and the dice replay', () => {
        const rng = new Rng(20261024);
        const failures: string[] = [];
        const stats: Record<string, number> = {};
        for (let game = 0; game < 40; game++) {
            let { world, state } = randomGame(rng);
            for (let turn = 0; turn < 4; turn++) {
                for (let k = 0; k < 4; k++) {
                    const member = rng.pick(state.crew);
                    const options = legalActions(world, state, member.id).filter(c => COMBAT_COMMANDS.has(c.type));
                    if (!options.length) continue;
                    const cmd: Command = rng.pick(options);
                    stats[cmd.type] = (stats[cmd.type] ?? 0) + 1;
                    const label = `game ${game} turn ${turn} ${JSON.stringify(cmd)}`;
                    const seen = preview(world, state, cmd), real = commit(world, state, cmd);
                    if (seen.pending) {
                        if (seen.pending.p !== null) failures.push(`${label}: a chance was shown for the bullets`);
                        if (JSON.stringify(seen.events) !== JSON.stringify(real.events.slice(0, seen.events.length))) failures.push(`${label}: the preview isn't the start of the commit`);
                        if (!firedRolls(real.events)) failures.push(`${label}: stopped at bullets that never flew`);
                    } else if (hashOf(seen.state) !== hashOf(real.state) || JSON.stringify(seen.events) !== JSON.stringify(real.events)) failures.push(`${label}: preview != commit`);
                    for (const record of real.state.shots.slice(state.shots.length)) {
                        const fired = real.events.find((e): e is Extract<SimEvent, { type: 'shotFired' }> => e.type === 'shotFired' && e.shot === record.id)!;
                        // The cone is drawn on the state the preview stopped at: what the command did before the bullets
                        // (Suppress's civilians down) is in it.
                        const replay = traceShot(world, seen.state, record.shot, record.rolls);
                        if (JSON.stringify(replay.hits) !== JSON.stringify(fired.hits)) failures.push(`${label}: the rolls don't replay`);
                        // The cone shows, for every bullet's rolled angle, whom it meets in order.
                        const cone = cmd.type === 'attack' || cmd.type === 'suppress' ? attackCone(world, state, cmd) : undefined;
                        if (!cone && (cmd.type === 'attack' || cmd.type === 'suppress')) failures.push(`${label}: no cone`);
                        for (const b of cone ? replay.bullets : []) {
                            const bodies = (steps: readonly { kind: string; id?: string }[]): string => steps.filter(t => t.kind === 'body').map(t => t.id).join(',');
                            const segment = cone!.fan.find(f => b.offset >= f.from && b.offset <= f.to);
                            // Panes shattered by an earlier bullet of the volley change what a later one meets (M3-01's fan
                            // is drawn on the fabric before the first): only bullet 1 is held to the fan here.
                            if (b === replay.bullets[0] && (!segment || bodies(segment.steps) !== bodies(b.steps))) failures.push(`${label}: bullet 1 left its cone`);
                        }
                    }
                    state = real.state;
                }
                const lying = new Set(state.grenades.map(g => g.id));
                const seen = preview(world, state, { type: 'endTurn' }), real = commit(world, state, { type: 'endTurn' });
                if (JSON.stringify(seen.events) !== JSON.stringify(real.events.slice(0, seen.events.length))) failures.push(`game ${game} turn ${turn}: the world phase's preview isn't its start`);
                if (!seen.pending && hashOf(seen.state) !== hashOf(real.state)) failures.push(`game ${game} turn ${turn}: the world phase's preview != commit`);
                for (const e of real.events) if (e.type === 'grenadeWentOff' && !lying.has(e.grenade)) failures.push(`game ${game} turn ${turn}: ${e.grenade} went off unseen`);
                stats.grenades = (stats.grenades ?? 0) + real.events.filter(e => e.type === 'grenadeWentOff').length;
                stats.volleys = (stats.volleys ?? 0) + real.events.filter(e => e.type === 'attacked' && e.mode !== 'attack' && e.mode !== 'suppress').length;
                state = real.state;
            }
        }
        expect(failures.slice(0, 10)).toEqual([]);
        // The sample has to play the combat actions, not just stand there.
        for (const type of ['attack', 'strike', 'throwGrenade', 'swap', 'reload', 'watch', 'suppress']) expect(stats[type] ?? 0, type).toBeGreaterThan(0);
        expect(stats.grenades).toBeGreaterThan(0);
    }, 300_000);
});
