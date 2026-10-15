import { generateBank, parseSeed, seedText } from './gen/generate';
import type { GeneratedBank } from './gen/model';
import { exampleBank, type BankData } from './level/bankData';

/**
 * Which bank the page shows: the hand-made example (`?bank=example`) or a generated one (§17), in the viewer (`?view`)
 * or the game. A generated bank's seed is in the address (`?seed=layout-population`, plus `tier`, `archetype` and
 * `plot` to pin those), so a bank can be shared and replayed; without one a fresh seed is rolled and written into the
 * address.
 */
export function bankFromAddress(): { data: BankData; generated?: GeneratedBank } {
    const params = new URLSearchParams(location.search);
    if (params.get('bank') === 'example') return { data: exampleBank() };
    const seed = parseSeed(params.get('seed') ?? `${Math.floor(Math.random() * 1e6)}-${Math.floor(Math.random() * 1e3)}`);
    const pins = {
        tier: (params.get('tier') ?? undefined) as GeneratedBank['tier'] | undefined,
        archetype: (params.get('archetype') ?? undefined) as GeneratedBank['archetype'] | undefined,
        plot: (params.get('plot') ?? undefined) as GeneratedBank['plot'] | undefined
    };
    let generated: GeneratedBank;
    try {
        generated = generateBank({ ...seed, ...pins });
    } catch (e) {
        // Picks that can't go together (typed into the address by hand): drop the tier and roll it to fit.
        console.warn(`${(e as Error).message}; rolling the tier instead`);
        params.delete('tier');
        generated = generateBank({ ...seed, ...pins, tier: undefined });
    }
    params.set('seed', seedText(generated.seed));
    // A bare flag (`?view`) stays bare rather than turning into `view=`.
    history.replaceState(null, '', `${location.pathname}?${params.toString().replace(/(^|&)(view|play|new)=(?=&|$)/g, '$1$2')}`);
    const lobby = generated.rooms.find(r => r.type === 'lobby')!;
    const focus = { tx: lobby.x + Math.floor(lobby.w / 2), ty: lobby.y };
    const outlines = generated.rooms.filter(r => r.known === 'outline').map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h, name: r.name, parts: r.parts }));
    return { data: { level: generated.level, rooms: generated.rooms, props: generated.props, people: generated.people, focus, outlines }, generated };
}
