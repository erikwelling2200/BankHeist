import { STYLE_IDS, type StyleId } from '../sim';

/*
 * Styles (GAME_DESIGN §19.8, implementation plan M6-05, decisions 522–523): the ways of playing the debrief rewards.
 * The rules decide which a heist earned (src/sim/rules/record.ts `stylesEarned`); the campaign pays each once per
 * contract stakes: a share of the take on a low- or medium-stakes job, a contact on a high-stakes one. A failed job
 * earns none.
 */

export { STYLE_IDS, type StyleId };

/** Each style's name and condition, as the debrief shows them (§19.8). */
export const STYLES: Readonly<Record<StyleId, { name: string; text: string }>> = {
    ghost: { name: 'Ghost', text: 'The Alarm was never raised.' },
    insideJob: { name: 'Inside Job', text: 'The alarm panel was disabled before any Heavy crew member entered.' },
    cleanHands: { name: 'Clean Hands', text: 'Nobody died.' },
    cowboys: { name: 'Cowboys', text: 'The way in was a vehicle ram or wall breach.' },
    fortress: { name: 'Fortress', text: 'Held through two full police assaults.' },
    overwatch: { name: 'Overwatch', text: 'Every kill was made from the sniper nest.' },
    smoothOperator: { name: 'Smooth Operator', text: 'Every check-in answered, no escapees.' },
    greedy: { name: 'Greedy', text: 'Took at least twice the target.' }
};

/** What a style pays the first time it is earned at a stakes below high, in percent of the take (decision 523). */
export const STYLE_BONUS = 10;

/** A style's bonus on a take: `STYLE_BONUS` percent, floored to the dollar. */
export const styleBonusOf = (take: number): number => Math.floor((take * STYLE_BONUS) / 100);

export const isStyle = (v: unknown): v is StyleId => typeof v === 'string' && (STYLE_IDS as readonly string[]).includes(v);
