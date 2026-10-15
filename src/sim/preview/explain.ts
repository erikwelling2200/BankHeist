import type { Pos, ReadonlyWorld, State } from '../core/types';
import type { Outcome } from '../data/matrix';
import { floorKnowledge, type FloorKnowledge } from '../rules/knowledge';
import type { Sighting, Why } from '../rules/perceive';
import { pipsOf } from '../rules/suspicion';
import type { MoveMode } from '../crew/movement';
import type { Effect } from './effect';
import { judgePath, judgeStay, safeFloor, type FloorOptions, type Judged } from './floor';
import { previewPicture } from './picture';

/*
 * "Who and why" (§8.8): long-press a tile of the safe floor (or the end of a drawn path) to see who would notice the
 * crew member there and why: the NPC's or camera's portrait, the sightline, and a line like "Guard: sees Armed". Built
 * from the very sightings the tint was judged from, on the crew's picture, so it never names someone the crew doesn't
 * know. Grey and hatched-grey tiles say why the crew can't tell.
 */

export interface Explanation {
    /** Who: an NPC's or a camera's id (the portrait), or null for what the crew doesn't know. */
    observer: string | null;
    by: 'npc' | 'camera' | 'unknown';
    /** `now`: during the move; `next`: in the coming world phase. */
    phase: 'now' | 'next';
    /** The sightline: where the observer looks from, and the tile it sees (null: no sight needed, e.g. a deadline). */
    from: Pos | null;
    to: Pos;
    /** What it does: `!` (Exposed), `+1`/`+2`, `T` (trespass), `-` for a reason of knowledge. */
    outcome: Outcome;
    /** The observer already knows the crew member (Exposed before). */
    known: boolean;
    why: Why[];
    text: string;
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const ZONE: Record<string, string> = { public: 'Public zone', staff: 'Staff zone', secure: 'Secure zone' };

const ACTS: Record<string, string> = {
    dragBody: 'you dragging a body', knockout: 'the knockout', hack: 'the hacking', lockpick: 'the lockpicking', zipTie: 'the zip-tie',
    command: 'you giving orders', attack: 'the attack', breach: 'the breach', drill: 'the drill', plantCharge: 'the charge', maskUp: 'you mask up',
    takeLoot: 'you take the loot', pickPocket: 'you pick a pocket'
};

/** "Guard", "Teller", "Camera 3". */
export function observerName(world: ReadonlyWorld, s: Pick<Sighting, 'observer' | 'by'>): string {
    if (s.by === 'camera') return `Camera ${world.cameras.findIndex(c => c.id === s.observer) + 1}`;
    const person = world.people.find(p => p.id === s.observer);
    return person ? capital(person.role.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()) : 'Someone';
}

/** The reason line of one sighting. */
export function sightingText(world: ReadonlyWorld, state: State, s: Sighting, crew: string): string {
    const who = observerName(world, s);
    if (s.by === 'camera') return `${who} would see you`;
    const notes: string[] = [];
    if (s.why.includes('onEdge')) notes.push('on edge');
    if (s.why.includes('notoriety')) notes.push('knows your face');
    if (s.why.includes('peripheral')) notes.push('corner of the eye');
    if (s.why.includes('uniform')) notes.push('the uniform helps');
    if (s.why.includes('seenThrough')) notes.push('sees through the uniform');
    if (s.why.includes('friskRange')) notes.push('close enough to frisk');
    const tail = notes.length ? ` (${notes.join(', ')})` : '';
    if (s.known) return `${who}: already knows you, sees you here`;
    if (s.why.includes('trespass')) return `${who}: you didn't leave the staff area in time`;
    if (s.why.includes('frisk')) return `${who}: frisks you and finds it`;
    if (s.why.includes('told')) return `${who}: hears about you`;
    if (s.why.includes('illegal')) return `${who}: sees ${ACTS[s.act ?? ''] ?? 'an illegal act'}`;
    if (s.why.includes('secondOffence')) return `${who}: warned you before`;
    if (s.outcome === 'T') return `${who}: "Hey, you can't be back here"`;
    if (s.outcome === '!') return `${who}: sees ${capital(s.profile)}${tail}`;
    if (s.outcome === '+1' || s.outcome === '+2') {
        const npc = state.npcs.find(n => n.id === s.observer);
        const total = npc ? pipsOf(npc, crew) : 0;
        const exposes = total + (s.outcome === '+1' ? 1 : 2) >= 3 ? ', enough to expose you' : '';
        return `${who}: ${s.outcome} (${ZONE[s.readAs] ?? s.readAs}${notes.length ? `, ${notes.join(', ')}` : ''})${exposes}`;
    }
    return `${who}: sees you`;
}

const KNOWLEDGE: Record<Exclude<FloorKnowledge, 'scouted'>, string> = {
    unscouted: 'No data: nobody has scouted here',
    unknownRisk: 'Could be watched from somewhere nobody has checked since the last world phase'
};

/** Only the sightings that did something to the crew member (the effect read from the rules' events). */
function acted(s: Sighting, effect: Effect | null): boolean {
    if (!effect) return false;
    if (s.by === 'camera') return effect.cameras.includes(s.observer);
    return effect.exposed.includes(s.observer) || effect.watching.includes(s.observer) || Object.hasOwn(effect.pips, s.observer)
        || effect.challenged === s.observer;
}

function entries(world: ReadonlyWorld, picture: State, crew: string, judged: Judged): Explanation[] {
    const out: Explanation[] = [];
    const push = (s: Sighting, phase: 'now' | 'next'): void => {
        if (!acted(s, phase === 'now' ? judged.now : judged.next)) return;
        // The strongest line per observer and phase.
        if (out.some(e => e.observer === s.observer && e.phase === phase)) return;
        out.push({
            observer: s.observer, by: s.by, phase, from: s.band === null ? null : { ...s.from }, to: { ...s.tile }, outcome: s.outcome,
            known: s.known, why: [...s.why], text: sightingText(world, picture, s, crew)
        });
    };
    const rank: Record<Outcome, number> = { '!': 4, '+2': 3, T: 2, '+1': 1, '-': 0 };
    for (const s of [...judged.nowSightings].sort((a, b) => rank[b.outcome] - rank[a.outcome])) push(s, 'now');
    for (const s of [...judged.nextSightings].sort((a, b) => rank[b.outcome] - rank[a.outcome])) push(s, 'next');
    return out;
}

/**
 * Who would notice the crew member on `tile` and why: along `path` when given (a drawn path), else along the safe
 * floor's path to it (or staying put on their own tile). Empty for a green tile; a reason line for grey ones.
 */
export function explain(
    world: ReadonlyWorld, state: State, crewId: string, tile: Pos, options: FloorOptions & { path?: readonly Pos[]; mode?: MoveMode } = {}
): Explanation[] {
    const picture = previewPicture(world, state);
    const member = state.crew.find(c => c.id === crewId);
    if (!member) return [];
    let judged: Judged, knowledge: FloorKnowledge, unknownPath: boolean;
    if (!options.path && member.pos.x === tile.x && member.pos.y === tile.y) {
        judged = judgeStay(world, state, crewId, options);
        knowledge = floorKnowledge(world, state, tile);
        unknownPath = false;
    } else {
        const path = options.path ?? safeFloor(world, state, crewId, options).at(tile)?.path;
        if (!path?.length) return [];
        const along = judgePath(world, state, crewId, path, options);
        if (!along.ok) return [];
        judged = along.judged;
        knowledge = along.end.knowledge;
        unknownPath = along.end.unknownPath;
    }
    const out = entries(world, picture, crewId, judged);
    if (!out.length && (knowledge !== 'scouted' || unknownPath)) {
        out.push({
            observer: null, by: 'unknown', phase: 'now', from: null, to: { x: tile.x, y: tile.y }, outcome: '-', known: false, why: [],
            text: KNOWLEDGE[knowledge === 'scouted' ? 'unknownRisk' : knowledge]
        });
    }
    return out;
}
