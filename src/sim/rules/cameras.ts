import { registerCommandHook, registerWorldHook, type Ctx } from '../core/engine';
import { crewMember, registerRuleDefaults, registerStateInit } from '../core/state';
import type { CrewState, DeepReadonly, NpcState, Pos, ReadonlyWorld, State, WorldObject } from '../core/types';
import { registerEvents } from '../core/undo';
import { cameraObserver, fieldOn } from '../geo/cones';
import { makeNoise } from '../geo/sound';
import { inReach, lacksActions, registerAction } from './actions/act';
import { registerInteraction } from './actions/interact';
import { carrierPos, HACKING_KIT } from './alarms';
import { raiseCarrier } from './carriers';
import { atDesk, attentiveOperator, cctvControlled, feedsAt, liveFeeds } from './cctv';
import { sendToLook } from './evidence';
import { registerLookout } from './knowledge';
import { decidesFor } from './npc/behaviour';
import { isPresent, personOf } from './npc/walk';
import { isEyesDown } from './suspicion';

/*
 * Cameras and the CCTV room (§8.12, §8.15).
 *
 * - **Panning.** A camera with two facings pans one step per world phase (devices), so in a crew phase it looks along
 *   `facing` and in the coming world phase along the next one: the telegraph, which perception and evidence already
 *   judge it by (`cameraObserver(…, next = true)`). Dead cameras don't pan; looped ones still do.
 * - **The monitors.** The operator watches `monitors` feeds at a time, cycling round-robin each turn (cctv.ts
 *   `feedsAt`). Cameras report only through a present, attentive operator at the desk.
 * - **Verify** (§9.1): a camera's `!` (perception's `State.cameraReports`) on a monitor that turn, with the operator
 *   at the desk, makes him verify: the operator carrier (2), about that crew member. Reports are dealt with at the start
 *   of the world phase (`cameras.operator`, passiveNpcs order −94, after the world phase's own sightings and evidence),
 *   so an operator dropped in the crew phase that saw the crew never verifies (§6.2). A report off the monitors is
 *   gone: only the recorder keeps it.
 * - **Major evidence** on a monitor (`State.cameraEvidence`, rules/evidence.ts) makes the operator send the nearest
 *   guard who is free to look (`sendToLook`): the guard walks there and finds it himself. Evidence on a camera off the
 *   monitors waits until its feed comes up, while it is still there. An operator verifying stays at his desk
 *   (`pinVerifiers`); his carrier is drawn at the desk.
 * - **Looping a feed** (§7.2): `loopFeed { crew, object, camera }` at the CCTV desk or a server rack, with a hacking
 *   kit, 1 action, the illegal act 'hack', quiet noise 1: the camera shows a loop for `rules.loopPhases` (4) world
 *   phases (`CameraState.loopedUntil`): it sees nothing (`cameraObserver` is null), reports nothing and records
 *   nothing, and isn't evidence (the feed still transmits).
 * - **Footage** (§8.12): every camera records to the recorder in the CCTV desk. A camera that sees an unmasked crew
 *   member commit an illegal act (a `cameraSaw` of an illegal act) records it (`State.footage`, for the debrief's
 *   Notoriety, §19.7) while the recorder is there. `recorder` objects: `take` or `destroy` (1 action each; taking is
 *   'takeLoot', smashing it is 'attack' and a quiet noise of 2): `footageKept` is then false.
 * - **The controlled CCTV room** (§8.15): no operator left to watch and a crew member at the desk: the crew sees
 *   through every camera that isn't looped or dead (a lookout of rules/knowledge.ts).
 * - Shooting a camera is combat's (M3); a dead camera is already minor evidence (rules/evidence.ts).
 */

/** An illegal act a camera recorded (§8.12): who, on which camera, where and when. */
export interface Footage { camera: string; crew: string; tile: Pos; turn: number }

declare module '../core/types' {
    interface ObjectState {
        /** Taken by this crew member (the recorder). */
        taken?: string;
        /** Smashed (the recorder). */
        destroyed?: boolean;
    }
    interface State {
        /** Illegal acts of unmasked crew the cameras recorded (§8.12). */
        footage: Footage[];
    }
    interface Rules {
        /** World phases a looped feed lasts (§7.2). */
        loopPhases: number;
    }
    interface CommandMap {
        /** Loops a camera's feed from the CCTV desk or a server rack in reach (§7.2): 1 action, a hacking kit. */
        loopFeed: { crew: string; object: string; camera: string };
    }
    interface EventMap {
        /** A panning camera turned to its next facing. */
        cameraPanned: { camera: string; facing: number };
        feedLooped: { crew: string; camera: string; until: number };
        /** A looped feed shows the camera again. */
        feedRestored: { camera: string };
        /** The operator saw a `!` on a monitor and verifies it (§8.12): the operator carrier. */
        operatorVerifies: { npc: string; camera: string; crew: string };
        /** The operator saw major evidence on a monitor and sent a guard to look (§8.12). */
        operatorSentGuard: { npc: string; guard: string; camera: string; evidence: string };
        /** A camera recorded an unmasked crew member's illegal act (§8.12). */
        footageRecorded: { camera: string; crew: string };
        recorderTaken: { crew: string; object: string };
        recorderDestroyed: { crew: string; object: string };
    }
}

registerRuleDefaults({ loopPhases: 4 });

registerStateInit('footage', (_world, state) => {
    state.footage = [];
});

// ---------------------------------------------------------------------------------------------------------- Panning

registerWorldHook('devices', 'cameras.pan', (ctx, phase) => {
    const { world, state } = ctx;
    for (const def of world.cameras) {
        const now = state.cameras[def.id];
        if (!now) continue;
        if (now.loopedUntil !== null && now.loopedUntil <= phase.turn) {
            now.loopedUntil = null;
            ctx.emit({ type: 'feedRestored', camera: def.id });
        }
        if (!now.live || def.facings.length < 2) continue;
        now.facing = (now.facing + 1) % def.facings.length;
        ctx.emit({ type: 'cameraPanned', camera: def.id, facing: now.facing });
    }
}, { order: 20 });

// ---------------------------------------------------------------------------------------------------------- Operator

/** The nearest guard free to be sent (up, on the map, deciding for itself), by distance to `tile`, then by order. */
export function nearestFreeGuard(world: ReadonlyWorld, state: State, tile: Pos, except?: string): NpcState | undefined {
    let best: NpcState | undefined, d = Infinity;
    for (const n of state.npcs) {
        if (n.id === except || personOf(world, n.id).observer !== 'enforcer' || !decidesFor(n) || !isPresent(n) || isEyesDown(n)) continue;
        const dx = n.pos.x - tile.x, dy = n.pos.y - tile.y, e = dx * dx + dy * dy;
        if (e < d) { d = e; best = n; }
    }
    return best;
}

/** What the operator does about the cameras' reports and evidence (see the header). */
export function operatorWatch(ctx: Ctx): void {
    const { world, state } = ctx;
    const op = attentiveOperator(world, state) as NpcState | undefined;
    for (const report of state.cameraReports) {
        if (!op || !feedsAt(world, report.turn).includes(report.camera)) continue;
        ctx.emit({ type: 'operatorVerifies', npc: op.id, camera: report.camera, crew: report.crew });
        raiseCarrier(ctx, { kind: 'operatorCamera', source: op.id, pos: carrierPos(world, 'operatorCamera', op), about: report.crew });
    }
    if (state.cameraReports.length) state.cameraReports = [];
    if (!op) return;
    const feeds = liveFeeds(world, state);
    for (const seen of state.cameraEvidence) {
        if (seen.handled || !feeds.includes(seen.camera)) continue;
        seen.handled = true;
        const guard = nearestFreeGuard(world, state, seen.tile);
        if (!guard) continue;
        ctx.emit({ type: 'operatorSentGuard', npc: op.id, guard: guard.id, camera: seen.camera, evidence: seen.evidence });
        sendToLook(ctx, guard, `cctv:${seen.evidence}`, seen.tile);
    }
}

registerWorldHook('passiveNpcs', 'cameras.operator', ctx => operatorWatch(ctx), { order: -94 });

/**
 * An operator verifying stays at his desk until it is done (§8.12): whatever else he wants, his committed intent
 * walks nowhere while his carrier runs. Applied as intents are committed and after every crew action.
 */
export function pinVerifiers(world: ReadonlyWorld, state: State): void {
    for (const c of state.carriers) {
        if (c.kind !== 'operatorCamera') continue;
        const npc = state.npcs.find(n => n.id === c.source);
        if (!npc || !decidesFor(npc) || !atDesk(world, state, npc) || !npc.intent.path.length) continue;
        const facing = npc.intent.facing;
        npc.intent = facing ? { path: [], facing } : { path: [] };
    }
}

registerWorldHook('commitIntents', 'cameras.pin', ctx => pinVerifiers(ctx.world, ctx.state), { order: 10 });

// ---------------------------------------------------------------------------------------------------------- Footage

/** Whether the recorder still holds the footage (§8.12): there is one, and nobody took or smashed it. */
export function footageKept(world: ReadonlyWorld, state: DeepReadonly<State>): boolean {
    const recorders = world.objects.filter(o => o.kind === 'recorder');
    return recorders.length > 0 && recorders.every(r => !Object.hasOwn(state.objects, r.id) || (!state.objects[r.id]!.taken && !state.objects[r.id]!.destroyed));
}

/** The crew members the debrief finds on the footage (§8.12, §19.7): none once the recorder is gone. */
export function filmedCrew(world: ReadonlyWorld, state: DeepReadonly<State>): string[] {
    return footageKept(world, state) ? [...new Set(state.footage.map(f => f.crew))].sort() : [];
}

registerCommandHook('cameras', (ctx, _cmd, events) => {
    const { world, state } = ctx;
    if (state.phase === 'crew') pinVerifiers(world, state);
    if (!footageKept(world, state)) return;
    for (const e of events) {
        if (e.type !== 'cameraSaw' || !e.why.includes('illegal')) continue;
        const member = state.crew.find(c => c.id === e.crew);
        if (!member || member.loadout.masked) continue;
        if (state.footage.some(f => f.camera === e.camera && f.crew === e.crew && f.turn === state.turn)) continue;
        state.footage.push({ camera: e.camera, crew: e.crew, tile: { x: e.tile.x, y: e.tile.y }, turn: state.turn });
        ctx.emit({ type: 'footageRecorded', camera: e.camera, crew: e.crew });
    }
});

const recorderGone = (state: DeepReadonly<State>, object: DeepReadonly<WorldObject>): string | undefined => {
    const now = Object.hasOwn(state.objects, object.id) ? state.objects[object.id]! : undefined;
    return now?.taken ? 'The recorder is gone' : now?.destroyed ? 'The recorder is smashed' : undefined;
};

registerInteraction('recorder', {
    take: {
        cost: () => 1,
        illegal: 'takeLoot',
        whyNot: (_world, state, _member, object) => recorderGone(state, object),
        run(ctx, member, object) {
            (ctx.state.objects[object.id] ??= {}).taken = member.id;
            ctx.emit({ type: 'recorderTaken', crew: member.id, object: object.id });
        }
    },
    destroy: {
        cost: () => 1,
        illegal: 'attack',
        whyNot: (_world, state, _member, object) => recorderGone(state, object),
        run(ctx, member, object) {
            (ctx.state.objects[object.id] ??= {}).destroyed = true;
            ctx.emit({ type: 'recorderDestroyed', crew: member.id, object: object.id });
            makeNoise(ctx, 'meleeStrike', object.pos, `recorder ${member.id}`);
        }
    }
});

// ---------------------------------------------------------------------------------------------------------- Looping

/** The objects a feed can be looped from (§7.2: the console, a junction box; the server rack). */
export const LOOP_FROM: ReadonlySet<string> = new Set(['cctvDesk', 'serverRack']);

function loopBlocked(world: ReadonlyWorld, state: State, member: DeepReadonly<CrewState>, objectId: string, cameraId: string): string | undefined {
    const lack = lacksActions(member, 1);
    if (lack) return lack;
    if (!member.loadout.items.includes(HACKING_KIT)) return `${member.name} has no hacking kit`;
    const object = world.objects.find(o => o.id === objectId);
    if (!object || !LOOP_FROM.has(object.kind)) return 'Feeds are looped at the CCTV desk or a server rack';
    if (!inReach(world, state, member.pos, object.pos)) return `${member.name} can't reach the ${object.kind}`;
    const camera = state.cameras[cameraId];
    if (!camera || !world.cameras.some(c => c.id === cameraId)) return `No camera '${cameraId}'`;
    if (!camera.live) return 'That camera is dead';
    if (camera.loopedUntil !== null) return 'That feed is looped already';
    return undefined;
}

registerAction('loopFeed', {
    whyNot: (world, state, cmd) => loopBlocked(world, state, crewMember(state, cmd.crew), cmd.object, cmd.camera),
    candidates(world, state, member) {
        const out: { type: 'loopFeed'; crew: string; object: string; camera: string }[] = [];
        for (const o of world.objects) {
            if (!LOOP_FROM.has(o.kind) || !inReach(world, state, member.pos, o.pos)) continue;
            for (const c of world.cameras) out.push({ type: 'loopFeed', crew: member.id, object: o.id, camera: c.id });
        }
        return out;
    },
    cost: () => 1,
    illegal: () => ({ act: 'hack' }),
    run(ctx, member, cmd) {
        const until = ctx.state.turn + ctx.world.rules.loopPhases - 1;
        ctx.state.cameras[cmd.camera]!.loopedUntil = until;
        ctx.emit({ type: 'feedLooped', crew: member.id, camera: cmd.camera, until });
        makeNoise(ctx, 'panelWork', member.pos, `loop ${member.id}`);
    }
});

// ---------------------------------------------------------------------------------------------------------- Control

// The crew at the console of a CCTV room nobody watches sees what every working camera sees (§8.15).
registerLookout('cctv', (world, state, sight) => {
    if (!world.cameras.length || !cctvControlled(world, state)) return [];
    return world.cameras.flatMap(c => {
        const pose = cameraObserver(world, state, c.id);
        return pose ? [fieldOn(sight, pose)] : [];
    });
});

registerEvents({
    cameraPanned: { undoBlocking: false },
    feedLooped: { undoBlocking: false },
    feedRestored: { undoBlocking: false },
    operatorVerifies: { undoBlocking: true },
    operatorSentGuard: { undoBlocking: true },
    footageRecorded: { undoBlocking: true },
    recorderTaken: { undoBlocking: false },
    recorderDestroyed: { undoBlocking: false }
});
