import {
    AUTO_TURN_CAP, autoAdvanceBlocked, planRoute, waitOptions, type AutoStop, type Pos, type RouteLeg, type WaitOption, type WaitTarget
} from '../sim';
import type { AutoBarVM } from '../ui/hud/autoBar';
import { CREW_COLOURS } from '../ui/hud/viewModels';
import type { Session } from './session';

/*
 * Auto-advance and "Wait for…" in play (GAME_DESIGN §6.5, M1-11): a run plays one turn at a time through the Session
 * (`Session.autoStep`), so every command is autosaved and played back like the player's own, and the scene starts the
 * next turn only when the last one's playback is over (at the chosen speed; the camera visits only the important
 * events, §20.5). Any tap stops it; so does anything `interruptsOf` finds. The rules are in src/sim/rules/autoAdvance.ts.
 */

/** One Go or Wait for, from its first turn to its stop. */
export class AutoRun {
    turnsPlayed = 0;
    stop: AutoStop | null = null;
    /** Crew members waiting a turn for someone in their way. */
    private waiting: string[] = [];

    constructor(private readonly session: Session, readonly target: WaitTarget | null = null, readonly label: string | null = null) {}

    /** Plays a turn; the stop, when there is one (the run is then over). */
    step(): AutoStop | null {
        if (this.stop) return this.stop;
        const result = this.session.autoStep({ target: this.target, turnsPlayed: this.turnsPlayed, cap: AUTO_TURN_CAP, waiting: this.waiting });
        this.turnsPlayed = result.turnsPlayed;
        this.waiting = result.waiting;
        if (result.stop) this.session.setAutoStop(result.stop);
        this.stop = result.stop;
        return this.stop;
    }

    /** Stops it from outside (a tap). */
    cancel(): AutoStop {
        if (!this.stop) {
            this.stop = { kind: 'cancelled', text: 'you stopped it' };
            this.session.setAutoStop(this.stop);
        }
        return this.stop;
    }
}

/** Kinds of stop that are the run doing what it was asked, not something to look at. */
const QUIET_STOPS: ReadonlySet<string> = new Set(['arrived', 'target', 'cap', 'cancelled']);

/** The line a stop shows: "Stopped: the cleaner turned toward Jun", "Done: the manager left", "Route walked". */
export function stopLine(stop: AutoStop): string {
    if (stop.kind === 'arrived') return 'Route walked';
    if (stop.kind === 'target') return `Done: ${stop.text}`;
    if (stop.kind === 'cancelled') return 'Stopped';
    return `Stopped: ${stop.text}`;
}

export const stopNeedsAttention = (stop: AutoStop): boolean => !QUIET_STOPS.has(stop.kind);

/** The "Wait for…" menu's entries with ids for the HUD, for the selected crew member (who "passes" is measured from). */
export function waitMenu(session: Session): (WaitOption & { id: string })[] {
    const near = session.state.crew.find(c => c.id === session.selected)?.pos;
    return waitOptions(session.world, session.state, near).map((o, i) => ({ ...o, id: `wait-${i}` }));
}

/** The auto-advance controls' view model (src/ui/hud/autoBar.ts). */
export function autoBarView(session: Session, run: AutoRun | null, last: AutoStop | null, menu = waitMenu(session)): AutoBarVM {
    const blocked = autoAdvanceBlocked(session.world, session.state);
    const routes = Object.keys(session.routes).length;
    const goReason = blocked ?? (routes ? undefined : 'Drag a route beyond this turn first');
    const waitReason = blocked ?? (menu.length ? undefined : 'Nothing known to wait for');
    const running = !!run && !run.stop;
    const status = running
        ? run!.label ? `Waiting: ${run!.label.replace(/^Until /, '').replace(/^Next event, /, '')}` : `Auto-advance: turn ${session.state.turn}`
        : last ? stopLine(last) : null;
    return {
        go: { enabled: !goReason, ...(goReason ? { reason: goReason } : {}) },
        wait: {
            enabled: !waitReason, ...(waitReason ? { reason: waitReason } : {}), options: menu.map(o => ({ id: o.id, label: o.label })),
            // A wait only ends turns: the crew stays put, routes and all.
            ...(routes ? { note: 'The crew stays put; Go walks the routes' } : {})
        },
        running,
        status,
        alert: !running && !!last && stopNeedsAttention(last)
    };
}

/** A crew member's route as the overlay draws it: where it starts, its colour, and its legs by turn. */
export interface RouteView {
    crew: string; colour: string; from: Pos; legs: RouteLeg[]; rest: Pos[];
    /** This turn's tiles a Move would be warned of (auto-advance stops before them). */
    unsafe: Pos[];
    /** The turn being played: later turns' numbers are estimates (the NPCs will have moved). */
    now: number;
}

/** Every crew member's planned route, split into the turns it will be walked in (`planRoute`), for the overlay. */
export function routeViews(session: Session): RouteView[] {
    // Worked out once per state and set of routes: marking the unsafe tiles previews this turn's Moves.
    const cached = VIEWS.get(session);
    if (cached && cached.state === session.state && cached.routes === session.routes) return cached.views;
    const views = planViews(session);
    VIEWS.set(session, { state: session.state, routes: session.routes, views });
    return views;
}

const VIEWS = new WeakMap<Session, { state: unknown; routes: unknown; views: RouteView[] }>();

function planViews(session: Session): RouteView[] {
    const { world, state } = session, out: RouteView[] = [];
    state.crew.forEach((c, i) => {
        const route = session.routes[c.id];
        if (!route?.length) return;
        const plan = planRoute(world, state, c.id, route, { safety: true });
        out.push({
            crew: c.id, colour: CREW_COLOURS[i % CREW_COLOURS.length]!, from: { ...c.pos }, legs: plan.legs, rest: route.slice(plan.walkable).map(p => ({ ...p })),
            unsafe: plan.unsafe, now: state.turn
        });
    });
    return out;
}
