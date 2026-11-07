import { generateBank, parseSeed, seedText, type GenerateOptions } from './gen/generate';
import { SIDE_OBJECTIVES, type SideObjectiveKind } from './gen/objectives';
import { CHAINS, MAX_ESCALATION } from './campaign/contracts';
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
    const generated = generateFromParams(params);
    params.set('seed', seedText(generated.seed));
    // A bare flag (`?view`) stays bare rather than turning into `view=`.
    history.replaceState(null, '', `${location.pathname}?${params.toString().replace(/(^|&)(view|play|new|plan)=(?=&|$)/g, '$1$2')}`);
    const lobby = generated.rooms.find(r => r.type === 'lobby')!;
    const focus = { tx: lobby.x + Math.floor(lobby.w / 2), ty: lobby.y };
    const outlines = generated.rooms.filter(r => r.known === 'outline').map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h, name: r.name, parts: r.parts }));
    return { data: { level: generated.level, rooms: generated.rooms, props: generated.props, people: generated.people, focus, outlines }, generated };
}

/**
 * The bank the address's picks name (`seed`, `tier`, `archetype`, `plot` and a contract's terms), taking out of `params`
 * whatever had to be dropped to build one; throws when even that fails. `generate` is the generator (a test's stand-in).
 */
export function generateFromParams(params: URLSearchParams, generate: (options: GenerateOptions) => GeneratedBank = generateBank): GeneratedBank {
    const seed = parseSeed(params.get('seed') ?? `${Math.floor(Math.random() * 1e6)}-${Math.floor(Math.random() * 1e3)}`);
    const pins = {
        tier: (params.get('tier') ?? undefined) as GeneratedBank['tier'] | undefined,
        archetype: (params.get('archetype') ?? undefined) as GeneratedBank['archetype'] | undefined,
        plot: (params.get('plot') ?? undefined) as GeneratedBank['plot'] | undefined
    };
    const terms = contractTerms(params);
    // Picks that can't go together (typed into the address by hand): drop the tier and roll it to fit. Outside the
    // campaign a side objective the bank has no place for (blackmail in a bank without a manager's desk) is dropped
    // too: the viewer and the sandbox show the bank without it. A contract's bank (`&campaign`) keeps its terms
    // whatever happens, so it is that bank or none (decision 504).
    const sandbox = !params.has('campaign');
    const { objectives: _objectives, ...bare } = terms;
    const tries: { drop: ('tier' | 'objectives')[]; options: GenerateOptions }[] = [
        { drop: [], options: { ...seed, ...pins, ...terms } },
        ...(sandbox && terms.objectives ? [{ drop: ['objectives' as const], options: { ...seed, ...pins, ...bare } }] : []),
        { drop: ['tier'], options: { ...seed, ...pins, ...terms, tier: undefined } },
        ...(sandbox && terms.objectives ? [{ drop: ['tier' as const, 'objectives' as const], options: { ...seed, ...pins, ...bare, tier: undefined } }] : [])
    ];
    let generated: GeneratedBank | undefined, error: unknown;
    for (const { drop, options } of tries) {
        try {
            generated = generate(options);
            for (const k of drop) params.delete(k);
            break;
        } catch (e) {
            error = e;
            console.warn(`${(e as Error).message}; trying again with fewer picks`);
        }
    }
    if (!generated) throw error;
    return generated;
}

/**
 * A contract's terms in the address (M6-02, `BankAddress`): `chain`, `escalation` and `objectives`. What isn't one of
 * them (an unknown chain, steps out of range, an unknown or repeated objective) is left out of the address and the bank.
 */
function contractTerms(params: URLSearchParams): Pick<GenerateOptions, 'chain' | 'escalation' | 'objectives'> {
    const chain = params.get('chain'), steps = Number(params.get('escalation')), kinds = (params.get('objectives') ?? '').split(',').filter(Boolean);
    const terms: Pick<GenerateOptions, 'chain' | 'escalation' | 'objectives'> = {};
    if (chain !== null && CHAINS.includes(chain)) terms.chain = chain;
    else params.delete('chain');
    if (Number.isInteger(steps) && steps >= 1 && steps <= MAX_ESCALATION) terms.escalation = steps;
    else params.delete('escalation');
    if (kinds.length && kinds.every(k => Object.hasOwn(SIDE_OBJECTIVES, k)) && new Set(kinds).size === kinds.length) terms.objectives = kinds as SideObjectiveKind[];
    else params.delete('objectives');
    return terms;
}
