import type { CameraState, NpcState, ReadonlyWorld, State } from '../core/types';
import { isKnownNow, withPicturedDoors } from '../rules/knowledge';
import { draggedBy } from '../rules/place';

/*
 * The bank as a preview may judge it (§8.8, §8.15): the crew's picture. Every player-facing preview in this folder
 * judges on this state and never on the truth, so it can't use an NPC or a camera the crew doesn't know:
 *
 * - NPCs: only those the crew sees or predicts are where they are (`isKnownNow`, the NPCs moves are planned around,
 *   `crewPicture`). Any other is off the map (`away`, with nothing to do): absent from sight, sound, walks and
 *   doorways, as `crewPicture` leaves it out, while the world phase's other rules (check-ins, carriers) still find
 *   the record they expect, so the whole engine can run on the picture (the property test's oracle does). A body being
 *   dragged stays with its dragger.
 * - Cameras: one the crew doesn't know isn't there (`live: false`). Until the CCTV room is scouted the crew can't tell
 *   a looped or dead feed from a live one, so every camera it knows counts as live (§8.8 "cameras whose feed status is
 *   unknown count as live"); once it is scouted, cameras are as they are.
 * - Doors: one no tile beside which is seen this turn is as last seen (`withPicturedDoors`, decision 44), as moves are
 *   planned (`crewPicture`). A verdict that a door the crew can't vouch for could change is the judge's to hatch
 *   (floor.ts, `doorDoubt`).
 *
 * It is a shallow copy (the truth itself when nothing differs): never change it. Cached per state object.
 */

const PICTURES = new WeakMap<State, { world: ReadonlyWorld; picture: State }>();

export function previewPicture(world: ReadonlyWorld, state: State): State {
    const cached = PICTURES.get(state);
    if (cached?.world === world) return cached.picture;
    let npcs: NpcState[] | null = null;
    state.npcs.forEach((n, i) => {
        if (isKnownNow(world, state, n.id) || n.status === 'away' || draggedBy(state, n.id)) return;
        (npcs ??= [...state.npcs])[i] = { ...n, status: 'away', intent: { path: [] } };
    });
    const base: State = withPicturedDoors(world, state, npcs ? { ...state, npcs } : state);
    const k = state.knowledge;
    let cameras: Record<string, CameraState> | null = null;
    for (const def of world.cameras) {
        const now = Object.hasOwn(state.cameras, def.id) ? state.cameras[def.id]! : undefined;
        if (!now) continue;
        let shown: CameraState = now;
        if (!k.cameras.includes(def.id)) {
            if (now.live) shown = { ...now, live: false };
        } else if (!k.cctv && (!now.live || now.loopedUntil !== null)) {
            shown = { ...now, live: true, loopedUntil: null };
        }
        if (shown !== now) (cameras ??= { ...state.cameras })[def.id] = shown;
    }
    const picture = cameras ? { ...base, cameras } : base;
    PICTURES.set(state, { world, picture });
    return picture;
}
